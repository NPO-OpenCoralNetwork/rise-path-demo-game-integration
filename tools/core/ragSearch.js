/**
 * Shared Business Logic — RAG Search
 *
 * Wraps the existing ragService (material_chunks + pgvector) for MCP/Express dual use.
 * Falls back to basic keyword retrieval if pgvector is not available.
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

    let queryVector;
    try {
        [queryVector] = await embedTexts([query]);
    } catch {
        // Embedding generation failed — fall back to keyword
        return await keywordFallback({ pool, query, domain, maxResults, userId });
    }

    // Only compare against chunks embedded by the same model (older rows need re-ingestion).
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

    return {
        results: result.rows.map(row => ({
            title: `Chunk ${row.chunk_index}`,
            content: row.content?.substring(0, 500) || '',
            relevance_score: Math.round((1 - (row.distance || 0)) * 100) / 100,
            source: row.material_id,
            domain: domain,
        })),
        search_type: 'vector',
        query_used: query.substring(0, 100),
    };
}

/**
 * Keyword-based fallback when pgvector or Gemini API is unavailable.
 * Uses PostgreSQL ILIKE for basic text matching.
 */
async function keywordFallback({ pool, query, domain, maxResults, userId }) {
    const keywords = query.split(/\s+/).filter(w => w.length > 1).slice(0, 5);

    if (keywords.length === 0) {
        return { results: [], search_type: 'keyword', message: 'No valid search keywords' };
    }

    // Build ILIKE conditions for each keyword (escape LIKE wildcards)
    const likeConditions = keywords.map((_, i) => `c.content ILIKE $${i + 1}`);
    const params = keywords.map(k => `%${k.replace(/[%_\\]/g, '\\$&')}%`);

    let whereExtra = '';
    if (userId) {
        params.push(userId);
        whereExtra += ` AND m.user_id = $${params.length}`;
    }

    params.push(maxResults);

    const result = await pool.query(
        `SELECT c.content, c.chunk_index, m.id as material_id
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         WHERE (${likeConditions.join(' OR ')})${whereExtra}
         ORDER BY c.created_at DESC
         LIMIT $${params.length}`,
        params
    );

    return {
        results: result.rows.map(row => ({
            title: `Chunk ${row.chunk_index}`,
            content: row.content?.substring(0, 500) || '',
            relevance_score: 0.5, // keyword match = moderate relevance
            source: row.material_id,
            domain: domain,
        })),
        search_type: 'keyword',
        query_used: query.substring(0, 100),
    };
}
