import path from 'path';
import { getPool } from './db.js';
import { ingestMaterial } from './ragService.js';
import { uploadLocationOf, uploadRoot } from './uploads.js';
import { describeError } from './utils/redactUrl.js';
import { isDbUnavailable } from '../tools/core/dbErrors.js';

const POLLING_INTERVAL_MS = 2000;
const MAX_POLLING_INTERVAL_MS = 60_000;

/**
 * Wait before the next poll: 2 s, doubled after each consecutive poll that failed because the
 * database was unavailable, 60 s at most.
 * @param {number} failures consecutive failed polls
 */
export function pollDelay(failures) {
    if (!(failures > 0)) return POLLING_INTERVAL_MS;
    return Math.min(MAX_POLLING_INTERVAL_MS, POLLING_INTERVAL_MS * 2 ** Math.min(failures, 5));
}

/**
 * The short code stored in jobs.error (GET /api/v2/jobs/:id shows it to the learner). The raw
 * message, which can hold absolute server paths and file names, goes to the server log only.
 */
export function jobErrorCode(error) {
    if (error?.jobErrorCode) return error.jobErrorCode;
    if (error?.code === 'ENOENT') return 'file_missing';
    if (error?.ingestStage === 'extract') return 'extract_failed';
    if (error?.ingestStage === 'embed') return 'embed_failed';
    return 'job_failed';
}

const jobError = (message, code) => Object.assign(new Error(message), { jobErrorCode: code });

export class JobWorker {
    /** @param {{ getPool?: () => any }} [options]  getPool: tests pass a mock pool; default the shared pool (server/db.js) */
    constructor({ getPool: poolFn = getPool } = {}) {
        this.isRunning = false;
        this.timeoutId = null;
        this.getPool = poolFn;
        /** Consecutive polls that failed because the database was unavailable. */
        this.failures = 0;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log("Job Worker started.");
        this.loop();
    }

    stop() {
        this.isRunning = false;
        if (this.timeoutId) clearTimeout(this.timeoutId);
        console.log("Job Worker stopped.");
    }

    async loop() {
        if (!this.isRunning) return;
        const delay = await this.tick();
        if (this.isRunning) {
            this.timeoutId = setTimeout(() => this.loop(), delay);
        }
    }

    /**
     * One poll. While the database is unavailable the wait doubles (pollDelay) and the outage is
     * logged once, not every 2 s; other errors keep the normal interval.
     * @returns {Promise<number>} milliseconds to wait before the next poll
     */
    async tick() {
        try {
            await this.processNextJob();
            this.reachable();
        } catch (error) {
            if (!isDbUnavailable(error)) {
                // The database answered (the claim worked, or refused the query itself).
                console.error(`[JobWorker] poll failed: ${describeError(error)}`);
                this.reachable();
                return pollDelay(0);
            }
            this.failures += 1;
            if (this.failures === 1) {
                const reason = error?.code || String(error?.message || error?.name || 'Error').slice(0, 80);
                console.warn(`[JobWorker] database unavailable or its connection pool busy (${reason}); retrying with a longer wait, up to ${MAX_POLLING_INTERVAL_MS / 1000} s.`);
            }
        }
        return pollDelay(this.failures);
    }

    /** End an outage: log it once and go back to the normal interval. */
    reachable() {
        if (this.failures > 0) console.log('[JobWorker] database reachable again; polling every 2 s.');
        this.failures = 0;
    }

    async processNextJob() {
        const pool = this.getPool();
        if (!pool) {
            // Wait for env/pool
            return; 
        }

        const job = await this.claimNextJob(pool);
        if (!job) return;

        // Process Job
        console.log(`Processing Job ${job.id} (${job.type})...`);
        await this.handleJob(job);
    }

    /**
     * Claim the oldest queued job (row lock, SKIP LOCKED for several workers) and mark it running.
     * The client is released exactly once, before the job runs (no connection held during a long
     * job). When even ROLLBACK fails, it is released with that error so pg-pool discards it; after
     * a plain SQL error the healthy connection goes back to the pool.
     * @returns {Promise<{ id: string, user_id: string, type: string, payload: any } | null>} null: nothing to do
     */
    async claimNextJob(pool) {
        const client = await pool.connect();
        /** @type {unknown} */
        let broken;
        try {
            // Claim a job atomically
            await client.query('BEGIN');
            
            // Fetch next queued job with row locking to prevent race conditions in multi-worker setups
            let res;
            try {
                res = await client.query(`
                    SELECT id, user_id, type, payload 
                    FROM jobs 
                    WHERE status = 'queued' 
                    ORDER BY created_at ASC 
                    LIMIT 1 
                    FOR UPDATE SKIP LOCKED
                `);
            } catch (queryErr) {
                // 42P01 = undefined_table — jobs table not yet created
                if (queryErr.code === '42P01') {
                    await client.query('ROLLBACK');
                    if (!this._tableWarnShown) {
                        console.log('Job Worker: jobs table not found — skipping (create with migrations)');
                        this._tableWarnShown = true;
                    }
                    return null;
                }
                throw queryErr;
            }

            if (res.rowCount === 0) {
                await client.query('ROLLBACK');
                return null; // No jobs
            }

            const job = res.rows[0];
            
            // Mark as running
            await client.query(`
                UPDATE jobs 
                SET status = 'running', updated_at = NOW() 
                WHERE id = $1
            `, [job.id]);
            
            await client.query('COMMIT');
            return job;
        } catch (e) {
            await client.query('ROLLBACK').catch((rollbackError) => {
                broken = rollbackError;
            });
            throw e;
        } finally {
            client.release(broken);
        }
    }

    async handleJob(job) {
        const pool = this.getPool();
        
        try {
            if (job.type === 'ingest') {
                const { material_id } = job.payload;
                if (!material_id) throw jobError("Missing material_id", 'material_not_found');

                // Get Material details to find path. Only the job owner's material: the job
                // re-embeds it and rewrites its chunks.
                const matRes = await pool.query(
                    'SELECT storage_path, type FROM materials WHERE id = $1 AND user_id = $2',
                    [material_id, job.user_id]
                );
                if (matRes.rowCount === 0) throw jobError("Material not found", 'material_not_found');
                
                const material = matRes.rows[0];
                // Only a path the upload route writes (server/uploads.js), resolved like it stores it.
                if (!uploadLocationOf(material.storage_path)) throw jobError('Not an upload path', 'file_missing');
                const filePath = path.resolve(uploadRoot(), material.storage_path);
                const mimeType = material.type === 'pdf' ? 'application/pdf' : 'text/plain';

                await ingestMaterial(material_id, filePath, mimeType, job.user_id);
            } else {
                throw jobError(`Unknown job type: ${job.type}`, 'unknown_job_type');
            }

            // Mark Done
            await pool.query(`
                UPDATE jobs 
                SET status = 'done', progress = 100, updated_at = NOW() 
                WHERE id = $1
            `, [job.id]);
            console.log(`Job ${job.id} completed.`);

        } catch (error) {
            // Name, code and message only: a pg error's detail holds values (Phase 4).
            console.error(`Job ${job.id} failed: ${describeError(error)}`);
            await pool.query(`
                UPDATE jobs 
                SET status = 'error', error = $2, updated_at = NOW() 
                WHERE id = $1
            `, [job.id, jobErrorCode(error)]);
        }
    }
}

export const jobWorker = new JobWorker();
