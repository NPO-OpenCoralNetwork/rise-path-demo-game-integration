import fs from 'fs/promises';
import { createRequire } from 'module';
import { getPool } from './db.js';
// Embeddings are shared with the MCP rag-search tool so ingest and query always use one model.
import { EMBEDDING_DIM, EMBEDDING_MODEL, embedTexts } from '../tools/core/ragSearch.js';
// Native text splitter (replaces @langchain/textsplitters)

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// --- Ingestion ---

const extractText = async (filePath, mimeType) => {
    if (mimeType === 'application/pdf') {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
    }
    // Default to text
    return await fs.readFile(filePath, 'utf8');
};

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

export const ingestMaterial = async (materialId, filePath, mimeType, userId) => {
    const pool = getPool();
    if (!pool) throw new Error("DB not configured");
    
    try {
        const text = await extractText(filePath, mimeType);
        const chunks = await chunkText(text);
        // Embed (batched) before opening the transaction so no DB connection is held during API calls.
        const vectors = await embedTexts(chunks);
        
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
            
            await client.query('UPDATE materials SET status = $1, updated_at = NOW() WHERE id = $2', ['ready', materialId]);
            await client.query('COMMIT');
            console.log(`Ingested material ${materialId}: ${chunks.length} chunks`);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (e) {
        console.error("Ingestion failed:", e);
        throw e;
    }
};

export const retrieveContext = async (query, limit = 3, userId) => {
    const pool = getPool();
    if (!pool) return [];
    
    try {
        console.log(`   [RAG] Retrieving context for query: "${query.substring(0, 50)}..."`);

        // Check for vector extension support
        const typeCheck = await pool.query(
            "SELECT 1 FROM pg_type WHERE typname = 'vector'"
        );
        const hasVector = typeCheck.rowCount > 0;

        let result;
        if (hasVector) {
            const [queryVector] = await embedTexts([query]);
            // Only compare against chunks embedded by the same model (older rows need re-ingestion).
            result = await pool.query(
                `SELECT c.content, (c.embedding <=> $1::vector) as distance
                 FROM material_chunks c
                 JOIN materials m ON c.material_id = m.id
                 WHERE m.user_id = $2 AND c.embedding_model = $3
                 ORDER BY distance ASC
                 LIMIT $4`,
                [JSON.stringify(queryVector), userId, EMBEDDING_MODEL, limit]
            );
        } else {
            // Simple fallback if no pgvector: just return latest or match basic if needed
            // For now, let's just return top items by ID as similarity is hard in pure SQL float8[]
            console.warn("   [RAG] pgvector not available, falling back to basic retrieval");
            result = await pool.query(
                `SELECT c.content
                 FROM material_chunks c
                 JOIN materials m ON c.material_id = m.id
                 WHERE m.user_id = $1
                 ORDER BY c.created_at DESC
                 LIMIT $2`,
                [userId, limit]
            );
        }
        
        console.log(`   [RAG] Found ${result.rows.length} relevant chunks.`);
        return result.rows.map(row => row.content);
    } catch (e) {
        console.error("   [RAG] Retrieval failed:", e);
        return [];
    }
};

export const getFullMaterialText = async (materialId) => {
    const pool = getPool();
    if (!pool) return "";
    
    try {
        const result = await pool.query(
            `SELECT content FROM material_chunks 
             WHERE material_id = $1 
             ORDER BY chunk_index ASC`,
            [materialId]
        );
        return result.rows.map(row => row.content).join("\n");
    } catch (e) {
        console.error("Full text retrieval failed:", e);
        return "";
    }
};

export const getMaterialDetails = async (materialId) => {
    const pool = getPool();
    if (!pool) return null;
    
    try {
        const result = await pool.query(
            `SELECT storage_path, type FROM materials WHERE id = $1`,
            [materialId]
        );
        if (result.rows.length === 0) return null;
        return result.rows[0];
    } catch (e) {
        console.error("Material details retrieval failed:", e);
        return null;
    }
};