/**
 * Shared Business Logic — RAG Search
 *
 * Wraps the existing ragService (material_chunks + pgvector) for MCP/Express dual use.
 * Falls back to basic keyword retrieval if pgvector or the embedding key is not available.
 * Vectors from different models are never compared: chunks embedded with an older model (or none)
 * are matched by keyword and merged with the vector results until scripts/rag/reembed.mjs
 * re-embeds them.
 *
 * Also owns the embedding call shared with server/ragService.js (ingest + retrieval), so both
 * sides always embed with the same model and dimension.
 */
import { getPool } from '../../server/db.js';
import { MODEL_IDS } from '../../server/llm/models.config.js';
import { classifyDbError } from './dbErrors.js';

/** Embedding model for material_chunks; each row records it in `embedding_model`. */
export const EMBEDDING_MODEL = MODEL_IDS.gemini.embedding;
/** material_chunks.embedding is vector(768) (server/migrations/001_core_curriculum.sql). */
export const EMBEDDING_DIM = 768;
/** batchEmbedContents accepts at most 100 inputs per request. */
const EMBED_BATCH_SIZE = 100;

// Same key lookup as the LLM gateway (server/llm/index.js). Never a VITE_* variable.
const readGeminiKey = () => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

/** @type {Promise<any> | null} */
let embeddingClientPromise = null;
let embeddingClientKey = '';
/** @type {any} undefined = use the real SDK client */
let embeddingClientOverride;

/** Tests: replace the @google/genai client (anything with `models.embedContent`); null = unconfigured. */
export function setEmbeddingClientForTests(client) {
    embeddingClientOverride = client;
}

export function resetEmbeddingClientForTests() {
    embeddingClientOverride = undefined;
    embeddingClientPromise = null;
    embeddingClientKey = '';
}

/** Whether a Gemini key (or a test client) is available for embeddings. */
export const isEmbeddingConfigured = () =>
    embeddingClientOverride !== undefined ? Boolean(embeddingClientOverride) : Boolean(readGeminiKey());

async function getEmbeddingClient() {
    if (embeddingClientOverride !== undefined) return embeddingClientOverride;
    const apiKey = readGeminiKey();
    if (!apiKey) return null;
    if (!embeddingClientPromise || embeddingClientKey !== apiKey) {
        embeddingClientKey = apiKey;
        embeddingClientPromise = import('@google/genai').then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey }));
    }
    return embeddingClientPromise;
}

/**
 * Embed texts with EMBEDDING_MODEL at EMBEDDING_DIM dimensions, batching requests.
 * @param {string[]} texts
 * @returns {Promise<number[][]>} one vector per input, in input order
 */
export async function embedTexts(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    const client = await getEmbeddingClient();
    if (!client) throw new Error('Gemini API key missing (set GEMINI_API_KEY on the server)');

    /** @type {number[][]} */
    const vectors = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
        const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
        const response = await client.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: batch,
            config: { outputDimensionality: EMBEDDING_DIM },
        });
        const values = (response?.embeddings ?? []).map((embedding) => embedding?.values);
        if (values.length !== batch.length || values.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIM)) {
            throw new Error(`Embedding response mismatch: expected ${batch.length} x ${EMBEDDING_DIM} values`);
        }
        vectors.push(...values);
    }
    return vectors;
}

/** Re-embeds chunks stored with another model (scripts/rag/reembed.mjs, header documents the flags). */
export const REEMBED_COMMAND = 'node scripts/rag/reembed.mjs';

let legacyEmbeddingWarningShown = false;

/** Tests: let the legacy-embedding warning fire again. */
export function resetLegacyEmbeddingWarningForTests() {
    legacyEmbeddingWarningShown = false;
}

/**
 * Warn once per process that chunks not embedded with EMBEDDING_MODEL exist (an older embedding
 * model, or none, e.g. scripts/seed_rag.js). Their vectors are not comparable with EMBEDDING_MODEL
 * query vectors, so they are found by keyword only until they are re-embedded.
 * @param {boolean} hasLegacy whether the searched scope holds such chunks
 * @returns {boolean} whether the warning was logged now
 */
export function warnLegacyEmbeddingsOnce(hasLegacy) {
    if (legacyEmbeddingWarningShown || !hasLegacy) return false;
    legacyEmbeddingWarningShown = true;
    console.warn(
        `[RAG] Some material chunks are not embedded with ${EMBEDDING_MODEL} (older model or none). ` +
        'Vectors from different models are not comparable, so those chunks are matched by keyword only ' +
        `(merged with the vector results). Re-embedding is required: ${REEMBED_COMMAND} --dry-run, then ` +
        `${REEMBED_COMMAND}. (Logged once per process.)`
    );
    return true;
}

/**
 * @typedef {{ conditions: string[], params: unknown[] }} ChunkScope
 * WHERE parts over `c` (material_chunks) and `m` (materials) using placeholders $1..$params.length.
 */

/** @param {ChunkScope} scope @param {string[]} [extra] */
const whereClause = (scope, extra = []) => {
    const conditions = [...scope.conditions, ...extra];
    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
};

/**
 * "Not embedded with the model in `placeholder`" (another model, or NULL). Same rows as
 * `IS DISTINCT FROM`, written so the material_chunks_embedding_model_idx btree index
 * (migration 010) can answer it with range scans.
 * @param {string} placeholder e.g. '$2'
 */
const otherModel = (placeholder) =>
    `(c.embedding_model IS NULL OR c.embedding_model < ${placeholder} OR c.embedding_model > ${placeholder})`;

/**
 * The chunks in `scope` that are not embedded with EMBEDDING_MODEL (another model, or NULL).
 * @param {ChunkScope} scope
 * @returns {ChunkScope}
 */
export function legacyChunkScope(scope) {
    const params = [...scope.params, EMBEDDING_MODEL];
    return { conditions: [...scope.conditions, otherModel(`$${params.length}`)], params };
}

/**
 * Whether the scope holds chunks embedded with EMBEDDING_MODEL (`current`) and chunks with any
 * other model or none (`legacy`). Two EXISTS probes over the embedding_model index (migration 010),
 * so the cost does not grow with the table.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} pool
 * @param {ChunkScope} scope
 * @returns {Promise<{ current: boolean, legacy: boolean }>}
 */
export async function embeddingCoverage(pool, scope) {
    const params = [...scope.params, EMBEDDING_MODEL];
    const model = `$${params.length}`;
    const probe = (condition) =>
        `EXISTS (SELECT 1 FROM material_chunks c JOIN materials m ON c.material_id = m.id ${whereClause(scope, [condition])})`;
    const result = await pool.query(
        `SELECT ${probe(`c.embedding_model = ${model}`)} AS has_current,
                ${probe(otherModel(model))} AS has_legacy`,
        params
    );
    const row = result.rows?.[0] ?? {};
    return { current: row.has_current === true, legacy: row.has_legacy === true };
}

/** Relevance given to a keyword hit; vector hits score 1 - cosine distance. */
export const KEYWORD_RELEVANCE = 0.5;

/**
 * Merge vector hits (current-model chunks) with keyword hits (older-model chunks) by relevance,
 * vector hits first on ties, and keep `limit`. The two sets never overlap.
 * @template {{ distance?: number }} V
 * @template K
 * @param {V[]} vectorRows
 * @param {K[]} keywordRows
 * @param {number} limit
 * @returns {Array<(V | K) & { relevance: number, match: 'vector' | 'keyword' }>}
 */
export function mergeByRelevance(vectorRows, keywordRows, limit) {
    const scored = [
        ...vectorRows.map((row) => ({ ...row, relevance: Math.round((1 - (Number(row.distance) || 0)) * 100) / 100, match: /** @type {const} */ ('vector') })),
        ...keywordRows.map((row) => ({ ...row, relevance: KEYWORD_RELEVANCE, match: /** @type {const} */ ('keyword') })),
    ];
    // Array.prototype.sort is stable: vector hits stay ahead of keyword hits with the same score.
    return scored.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
}

/** Characters that belong to Japanese words (kanji, kana, the prolonged sound mark, 々). */
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]/u;

/**
 * Split a query into at most 5 ILIKE keywords of 2+ characters.
 * - Words split on spaces and Japanese punctuation; edge punctuation is trimmed, inner symbols
 *   stay, so 'C#', 'C++' and 'Node.js' survive, and any script (Latin, Hangul, Cyrillic) works.
 * - Japanese has no spaces, so a word with kana or kanji is cut into kanji runs, katakana runs and
 *   the other-script runs between them, dropping hiragana (mostly particles):
 *   「Blenderのモディファイアとは？」 gives ['Blender', 'モディファイア']. A word that leaves no
 *   run of 2+ characters (hiragana only, or 「違い」) is kept whole.
 * @param {string} query
 * @returns {string[]}
 */
export function extractKeywords(query) {
    const trim = (word) => word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}#+]+$/u, '');
    const words = String(query ?? '').split(/[\s\u3000-\u3003\u3008-\u3011\u3014-\u301F\uFF01\uFF08\uFF09\uFF0C\uFF0E\uFF1A\uFF1B\uFF1F\u30FB]+/u);
    /** @type {string[]} */
    const candidates = [];
    for (const raw of words) {
        const word = trim(raw);
        if (!JAPANESE.test(word)) {
            candidates.push(word);
            continue;
        }
        const runs = (word.match(/[\p{Script=Han}々〆]+|[\p{Script=Katakana}ー]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]+/gu) ?? [])
            .map(trim)
            .filter((run) => run.length >= 2);
        candidates.push(...(runs.length > 0 ? runs : [word]));
    }
    /** @type {string[]} */
    const keywords = [];
    for (const word of candidates) {
        if (word.length < 2) continue;
        if (!keywords.some((k) => k.toLowerCase() === word.toLowerCase())) keywords.push(word);
        if (keywords.length === 5) break;
    }
    return keywords;
}

/**
 * Keyword (ILIKE) search over material_chunks in scope, chunks matching more keywords first. Used
 * where vectors cannot be compared: no pgvector, no embedding key, or chunks from another model.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} pool
 * @param {{ query: string, scope: ChunkScope, limit: number }} options
 * @returns {Promise<Array<{ content: string, chunk_index: number, material_id: string }>>} [] when the query has no keywords
 */
export async function keywordSearchChunks(pool, { query, scope, limit }) {
    const keywords = extractKeywords(query);
    if (keywords.length === 0) return [];

    const params = [...scope.params];
    const likes = keywords.map((k) => {
        // Escape LIKE wildcards so they match literally.
        params.push(`%${k.replace(/[%_\\]/g, '\\$&')}%`);
        return `c.content ILIKE $${params.length}`;
    });
    params.push(limit);

    const result = await pool.query(
        `SELECT c.content, c.chunk_index, m.id as material_id
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         ${whereClause(scope, [`(${likes.join(' OR ')})`])}
         ORDER BY (${likes.map((like) => `(${like})::int`).join(' + ')}) DESC, c.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows;
}

/**
 * Search educational content using existing RAG pipeline.
 * Uses material_chunks table with pgvector cosine distance when available.
 *
 * @param {Object} params
 * @param {string} params.query - Search query text
 * @param {string} params.domain - Learning domain filter (e.g. 'blender-3d')
 * @param {number} [params.maxResults=3] - Maximum results to return
 * @param {string} [params.userId] - User ID for scoping materials
 */
export async function searchContent({ query, domain, maxResults = 3, userId }) {
    const pool = getPool();
    if (!pool) return { results: [], error: 'DB not configured', error_type: 'db_connection' };

    try {
        // First check if pgvector extension is available
        const typeCheck = await pool.query(
            "SELECT 1 FROM pg_type WHERE typname = 'vector'"
        );
        const hasVector = typeCheck.rowCount > 0;

        if (hasVector) {
            return await vectorSearch({ pool, query, domain, maxResults, userId });
        } else {
            return await keywordFallback({ pool, query, domain, maxResults, userId });
        }
    } catch (err) {
        const classified = classifyDbError(err, 'ragSearch');
        return { results: [], ...classified };
    }
}

/**
 * Vector search using pgvector cosine distance.
 * Generates embedding for query via Gemini, then searches material_chunks.
 */
async function vectorSearch({ pool, query, domain, maxResults, userId }) {
    if (!isEmbeddingConfigured()) {
        // No API key — fall back to keyword search
        return await keywordFallback({ pool, query, domain, maxResults, userId });
    }

    /** @type {ChunkScope} */
    const scope = { conditions: ['m.status = \'ready\''], params: [] };
    if (userId) {
        scope.params.push(userId);
        scope.conditions.push(`m.user_id = $${scope.params.length}`);
    }

    // Vectors from different models are never compared. With no EMBEDDING_MODEL chunks in scope
    // (everything still from an older model), match those chunks by keyword instead.
    const coverage = await embeddingCoverage(pool, scope);
    warnLegacyEmbeddingsOnce(coverage.legacy);
    if (!coverage.current) {
        return await keywordFallback({ pool, query, domain, maxResults, userId, scope, reason: 'reembed_required' });
    }

    let queryVector;
    try {
        [queryVector] = await embedTexts([query]);
    } catch {
        // Embedding generation failed — fall back to keyword
        return await keywordFallback({ pool, query, domain, maxResults, userId });
    }

    // Only compare against chunks embedded by the same model (scripts/rag/reembed.mjs migrates older rows).
    const conditions = ['m.status = \'ready\'', 'c.embedding_model = $2'];
    const params = [JSON.stringify(queryVector), EMBEDDING_MODEL];
    let paramIdx = 3;

    if (userId) {
        conditions.push(`m.user_id = $${paramIdx++}`);
        params.push(userId);
    }

    // Note: domain filter on materials table (if metadata column exists)
    // For now, search across all materials and let relevance do the filtering

    params.push(maxResults);

    const result = await pool.query(
        `SELECT c.content, c.chunk_index,
                (c.embedding <=> $1::vector) as distance,
                m.id as material_id
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
         ORDER BY distance ASC
         LIMIT $${paramIdx}`,
        params
    );

    // Older-model chunks in the same scope are matched by keyword and merged in by relevance,
    // so they do not disappear once some chunks use the current model.
    const legacyRows = coverage.legacy
        ? await keywordSearchChunks(pool, { query, scope: legacyChunkScope(scope), limit: maxResults })
        : [];
    const rows = mergeByRelevance(result.rows, legacyRows, maxResults);

    return {
        results: rows.map(row => ({
            title: `Chunk ${row.chunk_index}`,
            content: row.content?.substring(0, 500) || '',
            relevance_score: row.relevance,
            source: row.material_id,
            domain: domain,
            ...(row.match === 'keyword' ? { match: 'keyword' } : {}),
        })),
        search_type: legacyRows.length > 0 ? 'vector+keyword' : 'vector',
        ...(coverage.legacy ? { reembed_required: true } : {}),
        query_used: query.substring(0, 100),
    };
}

/**
 * Keyword-based fallback when pgvector or Gemini API is unavailable, or when no chunk in `scope`
 * is embedded with EMBEDDING_MODEL (`reason: 'reembed_required'`).
 * Uses PostgreSQL ILIKE for basic text matching.
 * @param {{ pool: any, query: string, domain?: string, maxResults: number, userId?: string,
 *   scope?: ChunkScope, reason?: string }} params
 */
async function keywordFallback({ pool, query, domain, maxResults, userId, scope, reason }) {
    if (extractKeywords(query).length === 0) {
        return { results: [], search_type: 'keyword', message: 'No valid search keywords', ...(reason ? { fallback_reason: reason } : {}) };
    }

    /** @type {ChunkScope} */
    const searchScope = scope ?? { conditions: userId ? ['m.user_id = $1'] : [], params: userId ? [userId] : [] };
    const rows = await keywordSearchChunks(pool, { query, scope: searchScope, limit: maxResults });

    return {
        ...(reason ? { fallback_reason: reason } : {}),
        results: rows.map(row => ({
            title: `Chunk ${row.chunk_index}`,
            content: row.content?.substring(0, 500) || '',
            relevance_score: KEYWORD_RELEVANCE, // keyword match = moderate relevance
            source: row.material_id,
            domain: domain,
        })),
        search_type: 'keyword',
        query_used: query.substring(0, 100),
    };
}
