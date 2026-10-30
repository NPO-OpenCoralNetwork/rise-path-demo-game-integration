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
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]/u;
/** The runs of a word: katakana (with ー), kanji and hiragana, or anything else (Latin with its symbols, digits, other scripts). */
const RUNS = /[\p{Script=Katakana}ー]+|[\p{Script=Han}\p{Script=Hiragana}々〆]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]+/gu;
const KATAKANA_RUN = /^[\p{Script=Katakana}ー]+$/u;
const HIRAGANA_ONLY = /^\p{Script=Hiragana}+$/u;
const SINGLE_KANJI = /^[\p{Script=Han}々〆]$/u;
/** Question words and fillers, dropped: they match almost anything. */
const STOPWORDS = new Set(['何', '誰', '事', '物', '方', '為', '等', '様', '的']);
/** Hiragana that only carries grammar: particles, endings, and the pieces ICU cuts them into (ください → くだ, さい). */
const FUNCTION_WORDS = new Set([
    'とは', 'では', 'には', 'から', 'まで', 'より', 'って', 'ので', 'のに', 'けど', 'でも', 'とか', 'など', 'だけ', 'ほど', 'ずつ',
    'です', 'ます', 'でした', 'ました', 'ません', 'ですか', 'する', 'した', 'して', 'しない', 'したい', 'ない', 'いる', 'ある', 'なる',
    'できる', 'できない', 'られ', 'れる', 'せる', 'たい', 'くだ', 'さい', 'ください', 'ござ', 'こと', 'もの', 'よう', 'とき', 'ため',
    'について', 'という', 'ための', 'なので', 'どうやって', 'どうすれば', 'どう', 'なぜ', 'いつ', 'どこ', 'どれ', 'これ', 'それ', 'あれ',
    'この', 'その', 'あの', 'どの', 'ここ', 'そこ', 'うまく', 'しまう', 'みたい', 'わかる', 'わから', 'ちょっと', 'すこし', 'とても',
    'もう', 'まだ', 'また',
]);
/** Words of a request rather than its subject: they rank chunks, and select one only when the query has nothing else. */
const GENERIC_WORDS = new Set([
    '使い方', 'やり方', '方法', '違い', '仕方', '意味', '理由', '原因', '場合', '説明', '手順', '少し', '教え', '作り', '知り',
    '分かり', '簡単', '基本', '初心者', '入門', '必要',
]);
/** The part of a query that is read: a whole message at most. */
const MAX_QUERY_CHARS = 10_000;
/** Most keywords one query gives (each is one ILIKE over the learner's chunks). */
const MAX_KEYWORDS = 8;
/** ICU's dictionary word segmentation, built into Node: no dependency. */
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });

/**
 * A keyword. `weight` ranks the chunks it matches: 2 for a subject word, 1 for a hiragana word, a
 * single kanji or a generic word. `selects` is false for a single kanji (面 also matches 画面) and
 * a generic word (使い方, 方法…): they rank chunks but select one only when the query has nothing else.
 * @typedef {{ word: string, weight: number, selects: boolean }} Keyword
 */

/**
 * A katakana run as one keyword: the dictionary does not know most loanwords, so they are not split
 * (ボーン, リグ, ミラーモディファイア). A final long-vowel mark goes when the word is longer than
 * 3 characters (モディファイアー also finds モディファイア; ミラー stays).
 * @param {string} run
 * @returns {Keyword | null}
 */
function katakanaKeyword(run) {
    const word = run.length > 3 ? run.replace(/ー+$/u, '') : run;
    return word.length >= 2 && /\p{Script=Katakana}/u.test(word) ? { word, weight: 2, selects: true } : null;
}

/**
 * The keywords of a kanji-and-hiragana run, split into words by the dictionary: 押し出し, 選択 and
 * だし stay, particles and endings go, and a single kanji (面) and generic words (使い方) only rank.
 * A word the dictionary splits off before 方 (取り in 取り方) is a "how to" word too.
 * @param {string} run
 * @returns {Keyword[]}
 */
function kanjiHiraganaKeywords(run) {
    const segments = [...segmenter.segment(run)];
    /** @type {Keyword[]} */
    const keywords = [];
    for (const [index, { segment, isWordLike }] of segments.entries()) {
        if (!isWordLike || STOPWORDS.has(segment) || FUNCTION_WORDS.has(segment)) continue;
        const howTo = segment.length >= 2 && segment.endsWith('方') || segments[index + 1]?.segment === '方';
        if (HIRAGANA_ONLY.test(segment)) {
            if (segment.length >= 2) keywords.push({ word: segment, weight: 1, selects: true });
        } else if (GENERIC_WORDS.has(segment) || howTo) {
            keywords.push({ word: segment, weight: 1, selects: false });
        } else if (SINGLE_KANJI.test(segment)) {
            keywords.push({ word: segment, weight: 1, selects: false });
        } else if (segment.length >= 2) {
            keywords.push({ word: segment, weight: 2, selects: true });
        }
    }
    return keywords;
}

/**
 * The keywords of a query: subject words first, at most MAX_KEYWORDS.
 * - Words split on spaces and Japanese punctuation, and each is read in NFKC (full-width Latin and
 *   half-width katakana become the usual forms). Edge punctuation is trimmed, inner symbols stay,
 *   so 'C#', 'C++' and 'Node.js' survive, and any script (Latin, Hangul, Cyrillic) works.
 * - A Japanese word is cut into runs. Katakana runs stay whole (katakanaKeyword), kanji-and-hiragana
 *   runs are split into words (kanjiHiraganaKeywords), and the other-script runs between them stay
 *   whole: 「押し出しツールの使い方」 gives 押し出し, ツール and 使い方, and 「Prefabとは」 only
 *   Prefab. A hiragana word the dictionary does not know (「ひらがなだけ」) is kept as written.
 * - Subject words (weight 2) come first, then hiragana words, then single kanji and generic words,
 *   so a long message keeps its subjects within the limit.
 * @param {string} input
 * @returns {Keyword[]}
 */
export function keywordPlan(input) {
    const query = String(input ?? '').slice(0, MAX_QUERY_CHARS);
    const trim = (word) => word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}#+]+$/u, '');
    const words = query.split(/[\s　-〃〈-】〔-〟！（），．：；？・]+/u);
    /** @type {Keyword[]} */
    const found = [];
    for (const raw of words) {
        const word = trim(raw.normalize('NFKC'));
        if (!JAPANESE.test(word)) {
            if (word.length >= 2) found.push({ word, weight: 2, selects: true });
            continue;
        }
        const before = found.length;
        for (const run of word.match(RUNS) ?? []) {
            if (KATAKANA_RUN.test(run)) {
                const keyword = katakanaKeyword(run);
                if (keyword) found.push(keyword);
            } else if (JAPANESE.test(run)) {
                for (const keyword of kanjiHiraganaKeywords(run)) found.push(keyword);
            } else {
                const other = trim(run);
                if (other.length >= 2) found.push({ word: other, weight: 2, selects: true });
            }
        }
        if (found.length === before && HIRAGANA_ONLY.test(word) && word.length >= 2 && !FUNCTION_WORDS.has(word)) {
            found.push({ word, weight: 1, selects: true });
        }
    }
    const rank = (keyword) => (keyword.weight === 2 ? 0 : keyword.selects ? 1 : 2);
    const ordered = found.map((keyword, index) => ({ keyword, index }))
        .sort((a, b) => rank(a.keyword) - rank(b.keyword) || a.index - b.index);
    /** @type {Keyword[]} */
    const plan = [];
    for (const { keyword } of ordered) {
        if (!plan.some((k) => k.word.toLowerCase() === keyword.word.toLowerCase())) plan.push(keyword);
        if (plan.length === MAX_KEYWORDS) break;
    }
    return plan;
}

/**
 * The keyword strings of a query (keywordPlan), subject words first.
 * @param {string} query
 * @returns {string[]}
 */
export function extractKeywords(query) {
    return keywordPlan(query).map(({ word }) => word);
}

/**
 * Keyword (ILIKE) search over material_chunks in scope. Used where vectors cannot be compared: no
 * pgvector, no embedding key, or chunks from another model.
 * - The chunk text is matched in NFKC form, like the keywords: Postgres normalize, once per row
 *   (OFFSET 0 keeps the planner from copying it into every match). It needs a UTF8 database, as
 *   the VM's and CI's are.
 * - Subject and hiragana words select chunks; a single kanji (面) and generic words (使い方, 方法…)
 *   select only when the query has nothing else. Every keyword ranks: chunks with the larger sum
 *   of weights first.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} pool
 * @param {{ query: string, scope: ChunkScope, limit: number }} options
 * @returns {Promise<Array<{ content: string, chunk_index: number, material_id: string }>>} [] when the query has no keywords
 */
export async function keywordSearchChunks(pool, { query, scope, limit }) {
    const plan = keywordPlan(query);
    if (plan.length === 0) return [];

    const params = [...scope.params];
    const matches = plan.map((keyword) => {
        // Escape LIKE wildcards so they match literally (after NFKC, ％ and ＿ are already % and _).
        params.push(`%${keyword.word.replace(/[%_\\]/g, '\\$&')}%`);
        return { ...keyword, like: `n.text ILIKE $${params.length}` };
    });
    params.push(limit);
    const selecting = matches.some(({ selects }) => selects) ? matches.filter(({ selects }) => selects) : matches;

    const result = await pool.query(
        `SELECT c.content, c.chunk_index, m.id as material_id
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         CROSS JOIN LATERAL (SELECT normalize(c.content, NFKC) AS text OFFSET 0) n
         ${whereClause(scope, [`(${selecting.map(({ like }) => like).join(' OR ')})`])}
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
