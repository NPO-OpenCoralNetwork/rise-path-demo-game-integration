/**
 * Shared Business Logic — RAG Search
 *
 * Wraps the existing ragService (material_chunks + pgvector) for MCP/Express dual use.
 * Every search is scoped to one learner's own ready materials (materials.user_id is NOT NULL and
 * there is no shared or public material), like ragService.retrieveContext: without a learner id
 * nothing is searched.
 * Falls back to keyword search when pgvector or embeddings are not available, or when embedding the
 * query fails, and says why (searchChunks `fallback_reason`).
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
import { describeError } from '../../server/utils/redactUrl.js';
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
 * Columns a search reads besides the chunk, to cite it (searchContent):
 * - title: the material's name (materials.title, AS material_title);
 * - page: the chunk's PDF pages (material_chunks.metadata, server/ragService.js pageMetadata): the
 *   page its text starts on (AS page) and where the next pages start in it (AS page_breaks).
 * The remote endpoint reads neither (mcp-server/remotePolicy.js REMOTE_RAG_CITE): its database role
 * is not granted those columns.
 * @typedef {{ title?: boolean, page?: boolean }} CiteColumns
 */

/** The SELECT list's columns for `cite`, each after a comma ('' for none). @param {CiteColumns} [cite] */
const citeColumns = (cite = {}) => [
    ...(cite.title ? ['m.title AS material_title'] : []),
    ...(cite.page ? ["c.metadata->>'page' AS page", "c.metadata->'breaks' AS page_breaks"] : []),
].map((column) => `, ${column}`).join('');

/**
 * How many chunks each material in `ids` has (with chunk_index: which part of it a chunk is), counted
 * in `scope` like every other statement over material_chunks (the learner's own ready materials).
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} pool
 * @param {ChunkScope} scope
 * @param {string[]} ids material ids
 * @returns {Promise<Map<string, number>>}
 */
export async function materialParts(pool, scope, ids) {
    if (ids.length === 0) return new Map();
    const params = [...scope.params, ids];
    const result = await pool.query(
        `SELECT c.material_id, count(*)::int AS parts
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         ${whereClause(scope, [`c.material_id = ANY($${params.length}::uuid[])`])}
         GROUP BY c.material_id`,
        params
    );
    return new Map((result.rows ?? []).map((row) => [String(row.material_id), Number(row.parts)]));
}

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
    const words = query.split(/[\s\u3000-\u3003\u3008-\u3011\u3014-\u301F\uFF01\uFF08\uFF09\uFF0C\uFF0E\uFF1A\uFF1B\uFF1F\u30FB]+/u);
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
 * @param {{ query: string, scope: ChunkScope, limit: number, cite?: CiteColumns }} options
 * @returns {Promise<Array<{ content: string, chunk_index: number, material_id: string }>>} [] when the query has no keywords
 */
export async function keywordSearchChunks(pool, { query, scope, limit, cite }) {
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
        `SELECT c.content, c.chunk_index, m.id as material_id${citeColumns(cite)}
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
 * Why a search matched by keyword instead of by vector (searchChunks):
 * - 'no_pgvector': the database has no vector type;
 * - 'embeddings_off': Gemini is not allowed on this server, or it has no key (isEmbeddingConfigured);
 * - 'reembed_required': the scope's chunks are all embedded with another model, or with none;
 * - 'embedding_error': embedding the query failed (logged).
 * @typedef {'no_pgvector' | 'embeddings_off' | 'reembed_required' | 'embedding_error'} FallbackReason
 */

/**
 * The query's vector, embedded at most once however many scopes are searched with it. A failure is
 * logged once, by name, code and message only (never the query), and thrown to every caller.
 * @param {string} query
 * @returns {() => Promise<number[]>}
 */
export function queryEmbedder(query) {
    /** @type {Promise<number[]> | undefined} */
    let vector;
    return () => (vector ??= embedTexts([query]).then(([first]) => first, (error) => {
        console.warn(`[RAG] Embedding the search query failed (${describeError(error)}); matching by keyword.`);
        throw error;
    }));
}

/**
 * A chunk found by searchChunks: `relevance` is 1 - cosine distance for a vector hit and
 * KEYWORD_RELEVANCE for a keyword hit (`match`).
 * @typedef {{ content: string, chunk_index: number, material_id: string, relevance: number,
 *   match: 'vector' | 'keyword' }} FoundChunk
 */

/**
 * The chunks in `scope` that best match `query`, at most `limit`: by pgvector cosine distance when
 * embeddings are on and the scope holds chunks embedded with EMBEDDING_MODEL (the scope's other
 * chunks, from an older model or none, are matched by keyword and merged in by relevance), else by
 * keyword with the reason. A scope with no chunk at all finds nothing ('none'), without embedding
 * the query. Shared by MCP rag-search (searchContent) and the course generator
 * (server/ragService.js retrieveContext).
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} pool
 * @param {{ query: string, scope: ChunkScope, limit: number,
 *   embedQuery?: () => Promise<number[]>, cite?: CiteColumns }} options embedQuery: a queryEmbedder,
 *   for a caller that searches several scopes with one embedding (default: a new one); cite: the
 *   columns read to cite each row (default: none)
 * @returns {Promise<{ rows: FoundChunk[], search_type: 'vector' | 'vector+keyword' | 'keyword' | 'none',
 *   fallback_reason?: FallbackReason, reembed_required?: true }>}
 */
export async function searchChunks(pool, { query, scope, limit, embedQuery = queryEmbedder(query), cite }) {
    const typeCheck = await pool.query(
        "SELECT 1 FROM pg_type WHERE typname = 'vector'"
    );
    if (typeCheck.rowCount === 0) return keywordMatches(pool, { query, scope, limit, cite }, 'no_pgvector');
    if (!isEmbeddingConfigured()) return keywordMatches(pool, { query, scope, limit, cite }, 'embeddings_off');

    // Vectors from different models are never compared. With no EMBEDDING_MODEL chunks in scope
    // (everything still from an older model), match those chunks by keyword instead.
    const coverage = await embeddingCoverage(pool, scope);
    warnLegacyEmbeddingsOnce(coverage.legacy);
    if (!coverage.current && !coverage.legacy) return { rows: [], search_type: 'none' };
    if (!coverage.current) return keywordMatches(pool, { query, scope, limit, cite }, 'reembed_required');

    let queryVector;
    try {
        queryVector = await embedQuery();
    } catch {
        // queryEmbedder logged it.
        return keywordMatches(pool, { query, scope, limit, cite }, 'embedding_error');
    }

    // Only compare against chunks embedded by the same model (scripts/rag/reembed.mjs migrates older
    // rows), inside the scope.
    const params = [...scope.params, JSON.stringify(queryVector)];
    const vectorParam = `$${params.length}`;
    params.push(EMBEDDING_MODEL);
    const modelCondition = `c.embedding_model = $${params.length}`;
    params.push(limit);

    const result = await pool.query(
        `SELECT c.content, c.chunk_index,
                (c.embedding <=> ${vectorParam}::vector) as distance,
                m.id as material_id${citeColumns(cite)}
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
        ? await keywordSearchChunks(pool, { query, scope: legacyChunkScope(scope), limit, cite })
        : [];
    return {
        rows: mergeByRelevance(result.rows, legacyRows, limit),
        search_type: legacyRows.length > 0 ? 'vector+keyword' : 'vector',
        ...(coverage.legacy ? { reembed_required: true } : {}),
    };
}

/**
 * Keyword (ILIKE) matches in `scope`, as searchChunks rows, with the reason vectors were not used.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} pool
 * @param {{ query: string, scope: ChunkScope, limit: number, cite?: CiteColumns }} options
 * @param {FallbackReason} reason
 */
async function keywordMatches(pool, { query, scope, limit, cite }, reason) {
    const rows = await keywordSearchChunks(pool, { query, scope, limit, cite });
    return {
        rows: rows.map((row) => ({ ...row, relevance: KEYWORD_RELEVANCE, match: /** @type {const} */ ('keyword') })),
        search_type: /** @type {const} */ ('keyword'),
        fallback_reason: reason,
    };
}

/** How much of a chunk a search result quotes (searchContent `content`), in UTF-16 units. */
export const EXCERPT_CHARS = 500;
/** Text kept before the first matched word, at most: the quote starts at a sentence in it. */
const EXCERPT_LEAD = 150;
const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/**
 * Where the first of `words` occurs in `text` (an index into `text`), matched in NFKC and lower case
 * like the keyword search (Postgres normalize, ILIKE): Blender finds ＢＬＥＮＤＥＲ and モディファイア
 * finds ﾓﾃﾞｨﾌｧｲｱ. Each grapheme is folded on its own, so a combining mark stays with its letter.
 * @param {string} text
 * @param {string[]} words
 * @returns {number} -1 when no word occurs
 */
function firstMatch(text, words) {
    const needles = words.map((word) => String(word).normalize('NFKC').toLowerCase()).filter(Boolean);
    if (needles.length === 0) return -1;
    let folded = '';
    /** @type {number[]} for each UTF-16 unit of `folded`, the index in `text` of its grapheme */
    const origin = [];
    for (const { segment, index } of graphemes.segment(text)) {
        const piece = segment.normalize('NFKC').toLowerCase();
        folded += piece;
        for (let i = 0; i < piece.length; i += 1) origin.push(index);
    }
    let first = -1;
    for (const needle of needles) {
        const at = folded.indexOf(needle);
        if (at >= 0 && (first < 0 || at < first)) first = at;
    }
    return first < 0 ? -1 : origin[first];
}

/**
 * Whether a sentence ends at text[i]: 。！？, . ! ? before a space, or a blank line. A single line
 * break is not one: PDF text breaks wherever the printed line ends.
 */
const sentenceEndsAt = (text, i) => '。！？'.includes(text[i])
    || ('.!?'.includes(text[i]) && /\s/.test(text[i + 1] ?? ''))
    || (text[i] === '\n' && text[i + 1] === '\n');

/**
 * Where a quote that may start anywhere in [from, to] starts: at the start of the sentence nearest
 * to `to` (`last`) or to `from` (`first`), else of such a line (a list item, a heading), else at
 * `from`. A sentence starts after the end of the one before, so the ends looked at are those at
 * from - 1 to to - 1.
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @param {'first' | 'last'} which
 */
function quoteStart(text, from, to, which) {
    const low = Math.max(0, from - 1);
    const count = Math.max(0, to - low);
    const order = which === 'last'
        ? Array.from({ length: count }, (_, k) => to - 1 - k)
        : Array.from({ length: count }, (_, k) => low + k);
    const end = order.find((i) => sentenceEndsAt(text, i)) ?? order.find((i) => text[i] === '\n');
    return end === undefined ? from : end + 1;
}

const isHighSurrogate = (unit) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit) => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * The part of a chunk a search result quotes: EXCERPT_CHARS units from the sentence that holds the
 * first of `words` (when it starts at most EXCERPT_LEAD units before the word); near the end of the
 * chunk, from the first sentence that starts in its last EXCERPT_CHARS units, so the quote may be
 * shorter; the first EXCERPT_CHARS when no word occurs (a vector match may hold none). A verbatim
 * slice of the chunk that never splits a character outside the BMP.
 * @param {string} text
 * @param {string[]} words
 */
export function excerptAround(text, words) {
    const value = String(text ?? '');
    if (value.length <= EXCERPT_CHARS) return value;
    const hit = firstMatch(value, words);
    let start = 0;
    if (hit > 0) {
        start = quoteStart(value, Math.max(0, hit - EXCERPT_LEAD), hit, 'last');
        const latest = value.length - EXCERPT_CHARS;
        if (start > latest) start = quoteStart(value, latest, start, 'first');
        // Not from a space or a closing bracket left after the sentence end.
        while (start < hit && /[\s」』）)\]】〕]/.test(value[start])) start += 1;
    }
    if (isLowSurrogate(value.charCodeAt(start))) start += 1;
    let end = Math.min(value.length, start + EXCERPT_CHARS);
    if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) end -= 1;
    return value.slice(start, end).trimEnd();
}

/**
 * The passage a result quotes and the page it is on. With the chunk's PDF pages (`page` it starts
 * on, `breaks` where the next pages start: server/ragService.js pageMetadata), the quote stays on
 * one page: the one holding the first of `words`, or with no word in the chunk (a vector match)
 * its longest page. Without pages (or with breaks that do not fit the chunk), excerptAround over the
 * whole chunk, on the chunk's own page if it has one.
 * @param {string} text the chunk
 * @param {string[]} words
 * @param {number | null} page
 * @param {unknown} breaks
 * @returns {{ quote: string, page: number | null }}
 */
export function citedPassage(text, words, page, breaks) {
    const value = String(text ?? '');
    const fits = Array.isArray(breaks) && breaks.length > 0
        && breaks.every((at, i) => Number.isInteger(at) && at > (i === 0 ? 0 : breaks[i - 1]) && at < value.length);
    if (!page || !fits) return { quote: excerptAround(value, words), page: page ?? null };
    const bounds = [0, ...breaks, value.length];
    const segments = bounds.slice(0, -1).map((from, i) => ({ from, to: bounds[i + 1], page: page + i }));
    const hit = firstMatch(value, words);
    const longest = () => segments.reduce((best, s) => (value.slice(s.from, s.to).trim().length > value.slice(best.from, best.to).trim().length ? s : best));
    const on = hit >= 0 ? segments.find((s) => hit >= s.from && hit < s.to) : longest();
    return { quote: excerptAround(value.slice(on.from, on.to).trim(), words), page: on.page };
}

/** What a result calls a material when it does not name it: the learner's own material. */
const OWN_MATERIAL = 'あなたの教材';

/**
 * The place of a passage, to cite it (searchContent `location`): the material, 「by its name」 or
 * あなたの教材 without one (always on the remote endpoint), then the page, counted from the file's
 * first page (not the number printed on it), else which of its parts: 「Blender入門.pdf」3 ページ目,
 * あなたの教材・4 つの部分のうち 2 番目. A material in one part, or with an unknown or stale count,
 * is named alone.
 * @param {{ title?: string | null, page?: number | null, part?: number, parts?: number | null }} place
 */
export function locationLabel({ title, page, part, parts }) {
    const name = title ? `「${title}」` : OWN_MATERIAL;
    const joiner = title ? '' : '・';
    if (page) return `${name}${joiner}${page} ページ目`;
    if (parts > 1 && part >= 1 && part <= parts) return `${name}${joiner}${parts} つの部分のうち ${part} 番目`;
    return name;
}

/**
 * What rag-search cites a result by besides its place in the material: the material's name (title)
 * and the PDF page (page). searchContent reads neither unless asked (NO_RAG_CITE); stdio and SSE ask
 * for both (LOCAL_RAG_CITE); the remote endpoint passes mcp-server/remotePolicy.js REMOTE_RAG_CITE.
 * @typedef {{ title: boolean, page: boolean }} RagCite
 */
/** @type {Readonly<RagCite>} */
export const LOCAL_RAG_CITE = Object.freeze({ title: true, page: true });
/** @type {Readonly<RagCite>} */
export const NO_RAG_CITE = Object.freeze({ title: false, page: false });

/** A positive whole page number (material_chunks.metadata->>'page'), else null. */
const pageNumber = (value) => {
    const page = value === null || value === undefined ? NaN : Number(value);
    return Number.isInteger(page) && page > 0 ? page : null;
};

/**
 * Search the learner's own uploaded materials (material_chunks): searchChunks over
 * learnerChunkScope, as the MCP rag-search result. Each result cites its passage:
 * - title: the material's name (only with cite.title);
 * - page: the PDF page of the quote, when the material was indexed with its pages (only with
 *   cite.page; citedPassage);
 * - part, parts: which part of the material the chunk is (parts: counted after the search, left out
 *   when that fails);
 * - location: the place to cite (locationLabel), naming the material only with cite.title;
 * - content: up to EXCERPT_CHARS characters around the first word of the query (excerptAround), on
 *   one page when the page is known.
 *
 * @param {Object} params
 * @param {string} params.query - Search query text
 * @param {string} [params.domain] - Echoed in each result; not a filter (materials have no domain)
 * @param {number} [params.maxResults=3] - Maximum results to return (1-10)
 * @param {string} params.userId - The learner whose materials are searched. Required: a missing
 *   or non-UUID id returns no results without querying.
 * @param {RagCite} [params.cite] - Whether the material's name and page are read and returned
 *   (default NO_RAG_CITE: neither)
 */
export async function searchContent({ query, domain, maxResults = 3, userId, cite = NO_RAG_CITE }) {
    if (typeof userId !== 'string' || !UUID.test(userId)) {
        return { results: [], search_type: 'none', message: 'No learner in scope' };
    }
    const pool = getPool();
    if (!pool) return { results: [], error: 'DB not configured', error_type: 'db_connection' };

    try {
        const scope = learnerChunkScope(userId);
        const columns = { title: cite.title === true, page: cite.page === true };
        const found = await searchChunks(pool, { query, scope, limit: clampResults(maxResults), cite: columns });
        const reason = found.fallback_reason ? { fallback_reason: found.fallback_reason } : {};
        if (found.search_type === 'keyword' && extractKeywords(query).length === 0) {
            return { results: [], search_type: 'keyword', message: 'No valid search keywords', ...reason };
        }
        /** @type {Map<string, number>} */
        let counts = new Map();
        try {
            counts = await materialParts(pool, scope, [...new Set(found.rows.map((row) => String(row.material_id)))]);
        } catch (error) {
            // The results stand without the count (name, code and message only: never the query).
            console.warn(`[RAG] Counting the parts of the materials found failed (${describeError(error)}); results give no part count.`);
        }
        // The words a keyword match selects chunks by (keywordSearchChunks): the quote starts at one.
        const plan = keywordPlan(query);
        const anchors = (plan.some(({ selects }) => selects) ? plan.filter(({ selects }) => selects) : plan).map(({ word }) => word);
        return {
            ...reason,
            results: found.rows.map((row) => {
                const title = columns.title && typeof row.material_title === 'string' && row.material_title.trim() ? row.material_title.trim() : null;
                const { quote, page } = citedPassage(row.content ?? '', anchors, columns.page ? pageNumber(row.page) : null, columns.page ? row.page_breaks : null);
                const part = Number(row.chunk_index) + 1;
                const count = counts.get(String(row.material_id));
                const parts = Number.isInteger(count) && count >= part ? count : null;
                return {
                    ...(title ? { title } : {}),
                    location: locationLabel({ title, page, part, parts }),
                    ...(page ? { page } : {}),
                    part,
                    ...(parts ? { parts } : {}),
                    content: quote,
                    relevance_score: row.relevance,
                    source: row.material_id,
                    domain: domain,
                    // Marked only where vector and keyword hits are mixed.
                    ...(found.search_type !== 'keyword' && row.match === 'keyword' ? { match: 'keyword' } : {}),
                };
            }),
            search_type: found.search_type,
            ...(found.reembed_required ? { reembed_required: true } : {}),
            query_used: query.substring(0, 100),
        };
    } catch (err) {
        const classified = classifyDbError(err, 'ragSearch');
        return { results: [], ...classified };
    }
}
