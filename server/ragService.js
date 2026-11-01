import fs from 'fs/promises';
import { createRequire } from 'module';
import { getPool } from './db.js';
import { isUuid } from './utils/ids.js';
import { describeError } from './utils/redactUrl.js';
// Embeddings are shared with the MCP rag-search tool so ingest and query always use one model.
import {
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    REEMBED_COMMAND,
    embedTexts,
    isEmbeddingConfigured,
    learnerChunkScope,
    queryEmbedder,
    searchChunks,
} from '../tools/core/ragSearch.js';
// Native text splitter (replaces @langchain/textsplitters)

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// --- Ingestion ---

/**
 * Why a stored file cannot be indexed. The material gets status 'error' with this code in
 * meta.error (materials.status allows 'error': no migration):
 * - 'no_text': no letter in it, e.g. a scanned PDF, whose pages are images;
 * - 'extract_failed': pdf-parse could not read the PDF (damaged, or it needs a password to open).
 * @typedef {'no_text' | 'extract_failed'} UnreadableReason
 */

/** @param {UnreadableReason} reason @param {unknown} [cause] */
const unreadable = (reason, cause) => Object.assign(
    new Error(reason === 'no_text' ? 'The file holds no text to index' : 'The PDF could not be read', { cause }),
    { unreadable: reason },
);

/**
 * Why ingestMaterial could not index a file it read, or null for any other failure (a missing
 * file, the database).
 * @param {unknown} error
 * @returns {UnreadableReason | null}
 */
export const unreadableReason = (error) => {
    const reason = /** @type {{ unreadable?: unknown } | null | undefined} */ (error)?.unreadable;
    return reason === 'no_text' || reason === 'extract_failed' ? reason : null;
};

const extractText = async (filePath, mimeType) => {
    const data = await fs.readFile(filePath);
    if (mimeType !== 'application/pdf') return data.toString('utf8');
    try {
        // A Uint8Array, not the Buffer: pdf.js copies its input with `new input.constructor(input)`,
        // a copied Buffer under 4 KB lies inside Node's shared pool, and pdf.js then reads it from the
        // wrong offset (a valid small PDF failed with "bad XRef entry").
        const parsed = await pdf(new Uint8Array(data));
        return parsed.text;
    } catch (error) {
        throw unreadable('extract_failed', error);
    }
};

/** Whether extracted text has anything to search: a letter (page numbers alone are not text). */
const hasText = (text) => /\p{L}/u.test(text);

const chunkText = async (text, chunkSize = 1000, overlap = 200) => {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + chunkSize, text.length);
        // Try to break at paragraph or sentence boundary
        if (end < text.length) {
            const slice = text.slice(start, end);
            const lastPara = slice.lastIndexOf('\n\n');
            const lastNl = slice.lastIndexOf('\n');
            const lastPeriod = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('. '));
            const bp = lastPara > chunkSize * 0.5 ? lastPara
                : lastNl > chunkSize * 0.5 ? lastNl
                : lastPeriod > chunkSize * 0.5 ? lastPeriod : -1;
            if (bp > 0) end = start + bp + 1;
        }
        chunks.push(text.slice(start, end).trim());
        // Stop at the end of the text; stepping back by `overlap` here re-emitted ~overlap tail chunks.
        if (end >= text.length) break;
        start = Math.max(start + 1, end - overlap);
    }
    return chunks.filter(c => c.length > 0);
};

/**
 * Most chunks embedded for one material (about 160,000 characters at 1,000 per chunk with 200
 * overlap). One 'embeddings' unit of the daily caps (server/middleware/dailyCaps.js) is one
 * material, so this bounds what a unit costs for /upload, /rag/index and the job worker alike.
 * The rest of a longer file is not indexed.
 */
export const MAX_CHUNKS_PER_MATERIAL = 200;

/** The materials.meta keys ingestMaterial writes; each run replaces all three. */
const INGEST_META_KEYS = "'{error,embedding,truncated}'::text[]";

/** How many of a material's stored chunks have a vector. */
const embeddedChunks = async (pool, materialId) => {
    const stored = await pool.query(
        'SELECT count(*)::int AS embedded FROM material_chunks WHERE material_id = $1 AND embedding IS NOT NULL',
        [materialId]
    );
    return Number(stored.rows?.[0]?.embedded) || 0;
};

/** Status 'error' with meta.error. Failing to say so is logged, never thrown over the reason. */
const markUnreadable = (pool, materialId, reason) => pool.query(
    `UPDATE materials SET status = 'error', meta = (COALESCE(meta, '{}'::jsonb) - ${INGEST_META_KEYS}) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [materialId, JSON.stringify({ error: reason })]
).catch((error) => console.error(`[RAG] Material ${materialId}: could not set status 'error' (${reason}): ${describeError(error)}`));

/**
 * Read, chunk, embed and store one material, and mark it 'ready'.
 * - Embeddings off (Gemini not allowed, or no key: tools/core/ragSearch.js isEmbeddingConfigured):
 *   the chunks are stored without a vector or model (embedding_model NULL), keyword search finds
 *   them, and scripts/rag/reembed.mjs can embed them later. A material that already has chunks
 *   with a vector (embedded while Gemini was allowed) is left as it is: re-indexing it would
 *   replace those vectors with NULL ones.
 * - Embedding fails: the chunks are stored the same way, so keyword search still finds the
 *   material, the failure is logged, and meta.embedding is 'failed' until reembed.mjs embeds them.
 *   A material that already has chunks with a vector keeps them, and the error is thrown
 *   (ingestStage 'embed'): a re-index never replaces vectors with none.
 * - More than MAX_CHUNKS_PER_MATERIAL chunks: the first ones are indexed, and meta.truncated is
 *   { indexed, total } (chunk counts).
 * - Nothing to index (UnreadableReason): status 'error' with meta.error, and the error thrown
 *   carries the reason (unreadableReason).
 * A failure carries `ingestStage`: 'extract' (the file could not be read or split: nothing was
 * embedded), 'embed' or 'store'.
 * @returns {Promise<{ chunks: number, embedded: number, kept?: 'embeddings_off', embedding?: 'failed',
 *   truncated?: { indexed: number, total: number } }>} chunks stored, and how many have a vector
 *   (`kept` when the stored chunks were left as they are)
 */
export const ingestMaterial = async (materialId, filePath, mimeType, userId) => {
    const pool = getPool();
    if (!pool) throw new Error("DB not configured");
    
    let stage = 'store';
    try {
        if (!isEmbeddingConfigured()) {
            const embedded = await embeddedChunks(pool, materialId);
            if (embedded > 0) {
                console.warn(`[RAG] Material ${materialId}: embeddings are off; keeping its ${embedded} embedded chunks (not re-indexed).`);
                return { chunks: embedded, embedded, kept: 'embeddings_off' };
            }
        }

        stage = 'extract';
        const text = await extractText(filePath, mimeType);
        if (!hasText(text)) throw unreadable('no_text');
        const allChunks = await chunkText(text);
        const chunks = allChunks.slice(0, MAX_CHUNKS_PER_MATERIAL);
        const truncated = allChunks.length > chunks.length ? { indexed: chunks.length, total: allChunks.length } : null;
        if (truncated) {
            console.warn(`[RAG] Material ${materialId}: ${allChunks.length} chunks; indexing the first ${MAX_CHUNKS_PER_MATERIAL} (MAX_CHUNKS_PER_MATERIAL).`);
        }
        // Embed (batched) before opening the transaction so no DB connection is held during API calls.
        stage = 'embed';
        let vectors = null;
        let embeddingFailed = false;
        if (isEmbeddingConfigured()) {
            try {
                vectors = await embedTexts(chunks);
            } catch (e) {
                const embedded = await embeddedChunks(pool, materialId);
                if (embedded > 0) {
                    console.warn(`[RAG] Material ${materialId}: embedding failed; keeping its ${embedded} embedded chunks (not re-indexed).`);
                    throw e;
                }
                embeddingFailed = true;
                console.warn(`[RAG] Material ${materialId}: embedding failed (${describeError(e)}); storing its ${chunks.length} chunks without vectors for keyword search. Embed them later: ${REEMBED_COMMAND}.`);
            }
        }
        const meta = { ...(embeddingFailed ? { embedding: 'failed' } : {}), ...(truncated ? { truncated } : {}) };
        
        stage = 'store';
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM material_chunks WHERE material_id = $1', [materialId]);

            // Check for vector extension support
            const typeCheck = await client.query(
                "SELECT 1 FROM pg_type WHERE typname = 'vector'"
            );
            const hasVector = typeCheck.rowCount > 0;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                if (!vectors) {
                    // Embeddings off or failed: text only. The NULL model marks the row for reembed.mjs.
                    await client.query(
                        `INSERT INTO material_chunks 
                        (material_id, chunk_index, content, embedding, token_count, embedding_model, embedding_dim)
                        VALUES ($1, $2, $3, NULL, $4, NULL, NULL)`,
                        [materialId, i, chunk, chunk.length]
                    );
                    continue;
                }
                const vector = vectors[i];
                
                if (hasVector) {
                    await client.query(
                        `INSERT INTO material_chunks 
                        (material_id, chunk_index, content, embedding, token_count, embedding_model, embedding_dim)
                        VALUES ($1, $2, $3, $4::vector, $5, $6, $7)`,
                        [materialId, i, chunk, JSON.stringify(vector), chunk.length, EMBEDDING_MODEL, EMBEDDING_DIM]
                    );
                } else {
                    await client.query(
                        `INSERT INTO material_chunks 
                        (material_id, chunk_index, content, embedding, token_count, embedding_model, embedding_dim)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [materialId, i, chunk, vector, chunk.length, EMBEDDING_MODEL, EMBEDDING_DIM]
                    );
                }
            }
            
            await client.query(
                `UPDATE materials SET status = $1, meta = (COALESCE(meta, '{}'::jsonb) - ${INGEST_META_KEYS}) || $3::jsonb, updated_at = NOW() WHERE id = $2`,
                ['ready', materialId, JSON.stringify(meta)]
            );
            await client.query('COMMIT');
            console.log(`Ingested material ${materialId}: ${chunks.length} chunks${vectors ? '' : ' (no vectors: keyword search only)'}`);
        } catch (e) {
            // A lost connection makes ROLLBACK fail too; keep the original error.
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
        return { chunks: chunks.length, embedded: vectors ? vectors.length : 0, ...meta };
    } catch (e) {
        // Name, code and message only: a pg error's detail holds values (Phase 4).
        const cause = e instanceof Error && e.cause ? ` (${describeError(e.cause)})` : '';
        console.error(`Ingestion failed: ${describeError(e)}${cause}`);
        if (e && typeof e === 'object' && !('ingestStage' in e)) e.ingestStage = stage;
        const reason = unreadableReason(e);
        if (reason) await markUnreadable(pool, materialId, reason);
        throw e;
    }
};

// --- Retrieval ---

/** Most materials one message may attach (server/routes/ai.js refuses more). */
export const MAX_ATTACHED_MATERIALS = 5;

/**
 * `scope` with only the materials in `ids`, or (`without`) all but them.
 * @param {import('../tools/core/ragSearch.js').ChunkScope} scope
 * @param {string[]} ids
 */
const withMaterials = (scope, ids, { without = false } = {}) => {
    const params = [...scope.params, ids];
    const list = `$${params.length}::uuid[]`;
    return { conditions: [...scope.conditions, without ? `m.id <> ALL(${list})` : `m.id = ANY(${list})`], params };
};

/** The opening chunks of the materials in `scope`: chunk 0 of each, then chunk 1, and so on. */
const openingChunks = async (pool, scope, limit) => {
    const params = [...scope.params, limit];
    const result = await pool.query(
        `SELECT c.content, c.chunk_index, m.id AS material_id
         FROM material_chunks c
         JOIN materials m ON c.material_id = m.id
         WHERE ${scope.conditions.join(' AND ')}
         ORDER BY c.chunk_index, m.id
         LIMIT $${params.length}`,
        params
    );
    return result.rows;
};

/**
 * Up to `limit` chunk texts from the learner's own ready materials, for the course generator. The
 * attached materials come first: their best matches, then their opening chunks, so a file attached
 * to "make a course from this" is read even when no word of the message is in it. Then the
 * learner's other materials. Matching is tools/core/ragSearch.js searchChunks: by vector when
 * embeddings are on, by keyword when they are off or embedding the query fails.
 * @param {string} query
 * @param {number} [limit]
 * @param {string} userId
 * @param {{ materialIds?: unknown[] }} [options] materials attached to the message; ids that are not
 *   UUIDs are ignored, and another learner's material matches nothing
 * @returns {Promise<string[]>} [] without a database, or when reading fails (logged)
 */
export const retrieveContext = async (query, limit = 3, userId, { materialIds = [] } = {}) => {
    const pool = getPool();
    if (!pool || typeof userId !== 'string') return [];

    try {
        const own = learnerChunkScope(userId);
        const attached = [...new Set(materialIds.filter(isUuid))].slice(0, MAX_ATTACHED_MATERIALS);
        // One query embedding (and at most one logged failure) for both searches below.
        const embedQuery = queryEmbedder(query);
        /** @type {Array<{ content: string, chunk_index: number, material_id: string }>} */
        let rows = [];
        if (attached.length > 0) {
            const scope = withMaterials(own, attached);
            rows = (await searchChunks(pool, { query, scope, limit, embedQuery })).rows;
            if (rows.length < limit) {
                const taken = new Set(rows.map((row) => `${row.material_id}:${row.chunk_index}`));
                const opening = (await openingChunks(pool, scope, limit))
                    .filter((row) => !taken.has(`${row.material_id}:${row.chunk_index}`));
                rows = [...rows, ...opening].slice(0, limit);
            }
        }
        if (rows.length < limit) {
            const others = attached.length > 0 ? withMaterials(own, attached, { without: true }) : own;
            rows = [...rows, ...(await searchChunks(pool, { query, scope: others, limit: limit - rows.length, embedQuery })).rows];
        }
        console.log(`   [RAG] Found ${rows.length} relevant chunks${attached.length > 0 ? ` (attached material first)` : ''}.`);
        return rows.map((row) => row.content);
    } catch (e) {
        // Name, code and message only: a pg error's detail holds values (Phase 4).
        console.error(`   [RAG] Retrieval failed: ${describeError(e)}`);
        return [];
    }
};
