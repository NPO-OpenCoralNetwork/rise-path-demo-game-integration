/**
 * Shared Business Logic — RAG Search
 *
 * Wraps the existing ragService (material_chunks + pgvector) for MCP/Express dual use.
 * Every search is scoped to one learner's own ready materials (materials.user_id is NOT NULL and
 * there is no shared or public material), like ragService.retrieveContext: without a learner id
 * nothing is searched.
 * Falls back to basic keyword retrieval if pgvector or embeddings are not available.
 * Vectors from different models are never compared: chunks embedded with an older model (or none)
 * are matched by keyword and merged with the vector results until scripts/rag/reembed.mjs
 * re-embeds them.
 *
 * Also owns the embedding call shared with server/ragService.js (ingest + retrieval), so both
 * sides always embed with the same model and dimension.
 *
 * Embeddings use Gemini, so they are on only when GEMINI_ALLOWED is exactly "true" and a server
 * key is set (server/llm/models.config.js isGeminiAllowed; the Gemini API terms do not allow
 * services that people under 18 use). Otherwise no Gemini client is made: ingestion stores
 * chunks without vectors and every search is a keyword search.
 */
import { getPool } from '../../server/db.js';
import { MODEL_IDS, isGeminiAllowed } from '../../server/llm/models.config.js';
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

/**
 * Tests: replace the @google/genai client (anything with `models.embedContent`); null = no key.
 * GEMINI_ALLOWED still decides whether it is used.
 */
export function setEmbeddingClientForTests(client) {
    embeddingClientOverride = client;
}

export function resetEmbeddingClientForTests() {
    embeddingClientOverride = undefined;
    embeddingClientPromise = null;
    embeddingClientKey = '';
}

/** Whether embeddings are on: Gemini is allowed and a server key (or a test client) is set. */
export const isEmbeddingConfigured = () => isGeminiAllowed(process.env)
    && (embeddingClientOverride !== undefined ? Boolean(embeddingClientOverride) : Boolean(readGeminiKey()));

async function getEmbeddingClient() {
    if (!isGeminiAllowed(process.env)) return null;
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
    if (!client) {
        throw new Error(isGeminiAllowed(process.env)
            ? 'Gemini API key missing (set GEMINI_API_KEY on the server)'
            : 'Embeddings are off: Gemini is used only when GEMINI_ALLOWED is "true" (and GEMINI_API_KEY is set)');
    }

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
const JAPANESE_CHARS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々〆';
const JAPANESE = new RegExp(`[${JAPANESE_CHARS}]`, 'u');
/** A Japanese run, or a run of anything else (Latin with its symbols, digits, other scripts). */
const SCRIPT_RUN = new RegExp(`[${JAPANESE_CHARS}]+|[^${JAPANESE_CHARS}]+`, 'gu');
const HIRAGANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;
const KATAKANA_ONLY = /^[\p{Script=Katakana}ー]+$/u;
const SINGLE_KANJI = /^[\p{Script=Han}々〆]$/u;
/** Words that match almost anything on their own: question words, request phrasing, endings. */
const STOPWORDS = new Set([
    '何', '誰', '事', '物', '方', '為', '等', '様', '的', '教え',
    'です', 'ます', 'する', 'した', 'して', 'ある', 'いる', 'なる', 'ない', 'こと', 'もの', 'よう', 'とき', 'ため', 'など',
    'について', 'という', 'ための', 'ください', 'でした', 'ました', 'ません', 'ですか', 'なので', 'どうやって', 'どうすれば',
]);
/** Most keywords one query gives (each is one ILIKE over the learner's chunks). */
const MAX_KEYWORDS = 8;
/** Japanese words (ICU's dictionary segmentation, built into Node: no dependency). */
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });

/**
 * The words of one Japanese run: the segmenter's words without particles and endings (hiragana of
 * 1-2 characters) or stopwords, single characters only when they are a kanji (面), and katakana
 * without a final long-vowel mark (モディファイアー matches モディファイア too). When nothing is
 * left of a hiragana-only run (a phrase the dictionary does not know, such as 「ひらがなだけ」),
 * the run itself; a run with kanji or katakana that leaves nothing (「何ですか」) gives nothing.
 * @param {string} run
 * @returns {string[]}
 */
function japaneseWords(run) {
    /** @type {string[]} */
    const words = [];
    for (const { segment, isWordLike } of segmenter.segment(run)) {
        if (!isWordLike || STOPWORDS.has(segment)) continue;
        if (HIRAGANA_ONLY.test(segment) && segment.length <= 2) continue;
        if (segment.length < 2 && !SINGLE_KANJI.test(segment)) continue;
        words.push(KATAKANA_ONLY.test(segment) && segment.length > 3 ? segment.replace(/ー+$/u, '') : segment);
    }
    if (words.length > 0 || !HIRAGANA_ONLY.test(run)) return words;
    return run.length >= 2 && !STOPWORDS.has(run) ? [run] : [];
}

/**
 * Split a query into at most MAX_KEYWORDS ILIKE keywords.
 * - Words split on spaces and Japanese punctuation, then each is read in NFKC (full-width Latin
 *   and half-width katakana become the usual forms). Edge punctuation is trimmed, inner symbols
 *   stay, so 'C#', 'C++' and 'Node.js' survive, and any script (Latin, Hangul, Cyrillic) works.
 * - Japanese has no spaces: a word is cut into Japanese runs and the other-script runs between
 *   them. Other-script runs of 2+ characters stay whole; Japanese runs are split into words
 *   (japaneseWords): 「押し出しツールの使い方」 gives ['押し出し', 'ツール', '使い方'] and
 *   「Blenderで面を選択」 ['Blender', '面', '選択'].
 * @param {string} query
 * @returns {string[]}
 */
export function extractKeywords(query) {
    const trim = (word) => word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}#+]+$/u, '');
    const words = String(query ?? '').split(/[\s\u3000-\u3003\u3008-\u3011\u3014-\u301F\uFF01\uFF08\uFF09\uFF0C\uFF0E\uFF1A\uFF1B\uFF1F\u30FB]+/u);
    /** @type {string[]} */
    const candidates = [];
    for (const raw of words) {
        const word = trim(raw.normalize('NFKC'));
        if (!JAPANESE.test(word)) {
            if (word.length >= 2) candidates.push(word);
            continue;
        }
        for (const run of word.match(SCRIPT_RUN) ?? []) {
            if (JAPANESE.test(run)) {
                candidates.push(...japaneseWords(run));
            } else {
                const other = trim(run);
                if (other.length >= 2) candidates.push(other);
            }
        }
    }
    /** @type {string[]} */
    const keywords = [];
    for (const word of candidates) {
        if (!keywords.some((k) => k.toLowerCase() === word.toLowerCase())) keywords.push(word);
        if (keywords.length === MAX_KEYWORDS) break;
    }
    return keywords;
}

/**
 * Keyword (ILIKE) search over material_chunks in scope. The chunk text is matched in NFKC form
 * (Postgres normalize, like the keywords), and chunks matching more keywords come first: a
 * single kanji counts 1, any longer keyword 2. Used where vectors cannot be compared: no pgvector,
 * no embedding key, or chunks from another model.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} pool
 * @param {{ query: string, scope: ChunkScope, limit: number }} options
 * @returns {Promise<Array<{ content: string, chunk_index: number, material_id: string }>>} [] when the query has no keywords
 */
export async function keywordSearchChunks(pool, { query, scope, limit }) {
    const keywords = extractKeywords(query);
    if (keywords.length === 0) return [];

    const params = [...scope.params];
    const matches = keywords.map((k) => {
        // Escape LIKE wildcards so they match literally.
        params.push(`%${k.replace(/[%_\\]/g, '\\$&')}%`);
        return { like: `n.text ILIKE $${params.length}`, weight: SINGLE_KANJI.test(k) ? 1 : 2 };
    });
    params.push(limit);

    const result = await pool.query(
        `SELECT c.content, c.chunk_index, m.id as material_id
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         CROSS JOIN LATERAL (SELECT normalize(c.content, NFKC) AS text) n
         ${whereClause(scope, [`(${matches.map(({ like }) => like).join(' OR ')})`])}
         ORDER BY (${matches.map(({ like, weight }) => `(${like})::int * ${weight}`).join(' + ')}) DESC, c.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows;
}

/** A learner id as stored in materials.user_id (uuid). Anything else matches no material. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Most results one search returns (the MCP tool schema enforces the same bound). */
export const MAX_SEARCH_RESULTS = 10;

const clampResults = (value) => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_SEARCH_RESULTS) : 3;
};

/**
 * The chunks one learner may read: their own materials with status 'ready'.
 * @param {string} userId a UUID
 * @returns {ChunkScope}
 */
export function learnerChunkScope(userId) {
    return { conditions: ["m.status = 'ready'", 'm.user_id = $1'], params: [userId] };
}

/**
 * Search the learner's own uploaded materials (material_chunks) with pgvector cosine distance
 * when available, else by keyword.
 *
 * @param {Object} params
 * @param {string} params.query - Search query text
 * @param {string} [params.domain] - Echoed in each result; not a filter (materials have no domain)
 * @param {number} [params.maxResults=3] - Maximum results to return (1-10)
 * @param {string} params.userId - The learner whose materials are searched. Required: a missing
 *   or non-UUID id returns no results without querying.
 */
export async function searchContent({ query, domain, maxResults = 3, userId }) {
    if (typeof userId !== 'string' || !UUID.test(userId)) {
        return { results: [], search_type: 'none', message: 'No learner in scope' };
    }
    const pool = getPool();
    if (!pool) return { results: [], error: 'DB not configured', error_type: 'db_connection' };

    const scope = learnerChunkScope(userId);
    const limit = clampResults(maxResults);
    try {
        // First check if pgvector extension is available
        const typeCheck = await pool.query(
            "SELECT 1 FROM pg_type WHERE typname = 'vector'"
        );
        const hasVector = typeCheck.rowCount > 0;

        if (hasVector) {
            return await vectorSearch({ pool, query, domain, maxResults: limit, scope });
        } else {
            return await keywordFallback({ pool, query, domain, maxResults: limit, scope });
        }
    } catch (err) {
        const classified = classifyDbError(err, 'ragSearch');
        return { results: [], ...classified };
    }
}

/**
 * Vector search using pgvector cosine distance.
 * Generates embedding for query via Gemini (when allowed), then searches material_chunks.
 */
async function vectorSearch({ pool, query, domain, maxResults, scope }) {
    if (!isEmbeddingConfigured()) {
        // Embeddings off (Gemini not allowed, or no key): keyword search over every chunk.
        return await keywordFallback({ pool, query, domain, maxResults, scope });
    }

    // Vectors from different models are never compared. With no EMBEDDING_MODEL chunks in scope
    // (everything still from an older model), match those chunks by keyword instead.
    const coverage = await embeddingCoverage(pool, scope);
    warnLegacyEmbeddingsOnce(coverage.legacy);
    if (!coverage.current) {
        return await keywordFallback({ pool, query, domain, maxResults, scope, reason: 'reembed_required' });
    }

    let queryVector;
    try {
        [queryVector] = await embedTexts([query]);
    } catch {
        // Embedding generation failed — fall back to keyword
        return await keywordFallback({ pool, query, domain, maxResults, scope });
    }

    // Only compare against chunks embedded by the same model (scripts/rag/reembed.mjs migrates older
    // rows), inside the learner scope. materials has no domain column: `domain` is echoed only.
    const params = [...scope.params, JSON.stringify(queryVector)];
    const vectorParam = `$${params.length}`;
    params.push(EMBEDDING_MODEL);
    const modelCondition = `c.embedding_model = $${params.length}`;
    params.push(maxResults);

    const result = await pool.query(
        `SELECT c.content, c.chunk_index,
                (c.embedding <=> ${vectorParam}::vector) as distance,
                m.id as material_id
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         ${whereClause(scope, [modelCondition])}
         ORDER BY distance ASC
         LIMIT $${params.length}`,
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
 * Keyword-based fallback when pgvector or embeddings are unavailable, or when no chunk in `scope`
 * is embedded with EMBEDDING_MODEL (`reason: 'reembed_required'`).
 * Uses PostgreSQL ILIKE for basic text matching.
 * @param {{ pool: any, query: string, domain?: string, maxResults: number,
 *   scope: ChunkScope, reason?: string }} params scope: the learner scope (learnerChunkScope)
 */
async function keywordFallback({ pool, query, domain, maxResults, scope, reason }) {
    if (extractKeywords(query).length === 0) {
        return { results: [], search_type: 'keyword', message: 'No valid search keywords', ...(reason ? { fallback_reason: reason } : {}) };
    }

    const rows = await keywordSearchChunks(pool, { query, scope, limit: maxResults });

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
