#!/usr/bin/env node
/**
 * Re-embed material_chunks whose embedding_model is not the current EMBEDDING_MODEL
 * (server/llm/models.config.js via tools/core/ragSearch.js): rows from a retired embedding model,
 * or rows stored without an embedding (scripts/seed_rag.js).
 *
 * Retrieval never compares vectors from different models. Until chunks are re-embedded, vector
 * search skips them and they are matched by keyword only, merged with the vector results (the
 * server logs a "[RAG] ... Re-embedding is required" warning once per process). Run this after
 * deploying a change of EMBEDDING_MODEL.
 *
 * Usage (no npm script needed; reads DATABASE_URL_PHASE1 and GEMINI_API_KEY from the environment
 * or .env.local):
 *   node scripts/rag/reembed.mjs --dry-run                 # count stale chunks by model, change nothing
 *   node scripts/rag/reembed.mjs                           # re-embed every stale chunk, 100 per batch
 *   node scripts/rag/reembed.mjs --limit 500 --batch-size 50
 *
 * Idempotent: chunks are embedded with the same embedTexts() as ingestion (server/ragService.js),
 * each batch commits on its own, and an UPDATE only touches rows that are still stale. A rerun
 * picks up only what is left, so the script is safe to stop and resume.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPool } from '../../server/db.js';
import { EMBEDDING_DIM, EMBEDDING_MODEL, embedTexts, isEmbeddingConfigured } from '../../tools/core/ragSearch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_BATCH_SIZE = 100;

const USAGE = 'Usage: node scripts/rag/reembed.mjs [--dry-run] [--limit N] [--batch-size N]';

/**
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, limit: number, batchSize: number }}
 */
export function parseArgs(argv) {
    const options = { dryRun: false, limit: Infinity, batchSize: DEFAULT_BATCH_SIZE };
    /** @param {string} flag @param {string | undefined} raw */
    const positiveInt = (flag, raw) => {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} needs a positive integer. ${USAGE}`);
        return value;
    };
    for (let i = 0; i < argv.length; i++) {
        const [flag, inline] = argv[i].split(/=(.*)/s, 2);
        const value = () => (inline !== undefined ? inline : argv[++i]);
        if (flag === '--dry-run') options.dryRun = true;
        else if (flag === '--limit') options.limit = positiveInt(flag, value());
        else if (flag === '--batch-size') options.batchSize = positiveInt(flag, value());
        else throw new Error(`Unknown argument: ${argv[i]}. ${USAGE}`);
    }
    return options;
}

/**
 * Stale chunks per stored model ('(none)' for rows without one), most first.
 * @param {{ query: Function }} pool
 * @returns {Promise<Array<{ embedding_model: string, chunks: number }>>}
 */
export async function countStaleChunks(pool) {
    const { rows } = await pool.query(
        `SELECT COALESCE(embedding_model, '(none)') AS embedding_model, COUNT(*)::int AS chunks
         FROM material_chunks
         WHERE embedding_model IS DISTINCT FROM $1
         GROUP BY 1
         ORDER BY 2 DESC`,
        [EMBEDDING_MODEL]
    );
    return rows.map((row) => ({ embedding_model: row.embedding_model, chunks: Number(row.chunks) || 0 }));
}

/**
 * Next batch of stale chunks after `afterId` (keyset on id, so every batch makes progress even if
 * a row could not be updated, e.g. because its material was re-ingested meanwhile).
 * @param {{ query: Function }} pool
 * @param {{ afterId: string | null, batchSize: number }} options
 * @returns {Promise<Array<{ id: string, content: string }>>}
 */
export async function selectStaleChunks(pool, { afterId, batchSize }) {
    const { rows } = await pool.query(
        `SELECT id, content
         FROM material_chunks
         WHERE embedding_model IS DISTINCT FROM $1
           AND ($2::uuid IS NULL OR id > $2::uuid)
         ORDER BY id
         LIMIT $3`,
        [EMBEDDING_MODEL, afterId, batchSize]
    );
    return rows;
}

/**
 * Store one batch of vectors in a transaction. Rows already on EMBEDDING_MODEL are left alone.
 * @param {{ connect: Function }} pool
 * @param {Array<{ id: string }>} rows
 * @param {number[][]} vectors one per row, same order
 * @param {boolean} hasVector pgvector column (vector) vs FLOAT8[] fallback, as in ingestMaterial
 * @returns {Promise<number>} rows updated
 */
export async function writeEmbeddings(pool, rows, vectors, hasVector) {
    const client = await pool.connect();
    let updated = 0;
    try {
        await client.query('BEGIN');
        for (let i = 0; i < rows.length; i++) {
            const result = await client.query(
                `UPDATE material_chunks
                 SET embedding = ${hasVector ? '$1::vector' : '$1'}, embedding_model = $2, embedding_dim = $3
                 WHERE id = $4 AND embedding_model IS DISTINCT FROM $2`,
                [hasVector ? JSON.stringify(vectors[i]) : vectors[i], EMBEDDING_MODEL, EMBEDDING_DIM, rows[i].id]
            );
            updated += result.rowCount ?? 0;
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    return updated;
}

/**
 * @param {{ pool: any, embed?: (texts: string[]) => Promise<number[][]>, dryRun?: boolean,
 *   limit?: number, batchSize?: number, log?: (line: string) => void }} options
 * @returns {Promise<{ stale: number, processed: number, reembedded: number, batches: number }>}
 */
export async function reembedChunks({ pool, embed = embedTexts, dryRun = false, limit = Infinity, batchSize = DEFAULT_BATCH_SIZE, log = console.log }) {
    const byModel = await countStaleChunks(pool);
    const stale = byModel.reduce((sum, row) => sum + row.chunks, 0);
    log(`${stale} chunk(s) not embedded with ${EMBEDDING_MODEL}${byModel.length ? `: ${byModel.map((r) => `${r.embedding_model} ×${r.chunks}`).join(', ')}` : ''}.`);
    if (dryRun || stale === 0) {
        if (dryRun && stale > 0) log(`Dry run: would re-embed ${Math.min(stale, limit)} chunk(s) in batches of ${batchSize}. Nothing changed.`);
        return { stale, processed: 0, reembedded: 0, batches: 0 };
    }

    const typeCheck = await pool.query("SELECT 1 FROM pg_type WHERE typname = 'vector'");
    const hasVector = typeCheck.rowCount > 0;

    /** @type {string | null} */
    let afterId = null;
    let processed = 0;
    let reembedded = 0;
    let batches = 0;
    while (processed < limit) {
        const rows = await selectStaleChunks(pool, { afterId, batchSize: Math.min(batchSize, limit - processed) });
        if (rows.length === 0) break;
        // Embed before opening the transaction so no DB connection is held during API calls.
        const vectors = await embed(rows.map((row) => row.content));
        reembedded += await writeEmbeddings(pool, rows, vectors, hasVector);
        processed += rows.length;
        afterId = rows[rows.length - 1].id;
        batches++;
        log(`Batch ${batches}: ${processed} chunk(s) processed, ${reembedded} re-embedded with ${EMBEDDING_MODEL}.`);
    }
    log(`Done: ${reembedded} chunk(s) re-embedded${processed < stale ? `; about ${stale - processed} left (rerun to continue)` : ''}.`);
    return { stale, processed, reembedded, batches };
}

/** Load .env.local without overriding variables already set (same rules as server.js). */
async function loadEnvLocal() {
    try {
        const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
            const eq = normalized.indexOf('=');
            if (eq < 1) continue;
            const key = normalized.slice(0, eq).trim();
            if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
            let value = normalized.slice(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
            process.env[key] = value;
        }
    } catch (error) {
        if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    await loadEnvLocal();
    const pool = getPool();
    if (!pool) throw new Error('DATABASE_URL_PHASE1 is not set (environment or .env.local).');
    try {
        if (!options.dryRun && !isEmbeddingConfigured()) {
            throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set; it is needed to embed chunks.');
        }
        await reembedChunks({ pool, ...options });
    } finally {
        await pool.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
