/**
 * Shared Business Logic — RAG Search
 *
 * Wraps the existing ragService (material_chunks + pgvector) for MCP/Express dual use.
 * Falls back to basic keyword retrieval if pgvector is not available.
 */
import { getPool } from '../../server/db.js';
import { classifyDbError } from './dbErrors.js';

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
    // Try dynamic import of Gemini for embedding generation
    let queryVector;
    try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
            // No API key — fall back to keyword search
            return await keywordFallback({ pool, query, domain, maxResults, userId });
        }

        const { GoogleGenAI } = await import('@google/genai');
        const genAI = new GoogleGenAI(apiKey);
        const result = await genAI.models.embedContent({
            model: 'text-embedding-004',
            contents: [{ parts: [{ text: query }] }],
        });
        queryVector = result.embeddings[0].values;
    } catch {
        // Embedding generation failed — fall back to keyword
        return await keywordFallback({ pool, query, domain, maxResults, userId });
    }

    // Build query with optional domain filter
    const conditions = ['m.status = \'ready\''];
    const params = [JSON.stringify(queryVector)];
    let paramIdx = 2;

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
