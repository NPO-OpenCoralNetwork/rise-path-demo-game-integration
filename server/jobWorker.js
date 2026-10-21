import path from 'path';
import { fileURLToPath } from 'url';
import { ingestMaterial } from './ragService.js';
// The shared pool: connect and statement timeouts, and the idle-client error handler.
import { getPool } from './db.js';
import { isDbUnavailable } from '../tools/core/dbErrors.js';

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..'); // Assuming server/jobWorker.js

const POLLING_INTERVAL_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

/** Delay before the next poll: doubles (4 s, 8 s, … 1 min) for each poll in a row that found the database down. */
export const pollDelay = (failures) =>
    failures > 0 ? Math.min(POLLING_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS) : POLLING_INTERVAL_MS;

export class JobWorker {
    constructor() {
        this.isRunning = false;
        this.timeoutId = null;
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

        // Schedule next tick
        if (this.isRunning) {
            this.timeoutId = setTimeout(() => this.loop(), delay);
        }
    }

    /** One poll. Returns how long to wait before the next one. */
    async tick() {
        try {
            await this.processNextJob();
            if (this.failures > 0) console.log('Job Worker: database reachable again.');
            this.failures = 0;
        } catch (error) {
            if (isDbUnavailable(error)) {
                this.failures += 1;
                // Logged once per outage, not on every retry.
                if (this.failures === 1) console.warn('Job Worker: database not reachable, backing off:', error.message);
            } else {
                console.error("Job Worker Error:", error);
            }
        }
        return pollDelay(this.failures);
    }

    async processNextJob() {
        const pool = getPool();
        if (!pool) {
            // Wait for env/pool
            return; 
        }

        const job = await this.claimNextJob(pool);
        if (!job) return; // No jobs

        // Process Job (the claim's client is already back in the pool)
        console.log(`Processing Job ${job.id} (${job.type})...`);
        await this.handleJob(job);
    }

    /**
     * Marks the oldest queued job running and returns it, or null when there is none. The client
     * goes back exactly once, before the job runs: it used to stay out on every empty poll and was
     * released twice when a job failed. After an error it is released with that error, so pg drops
     * it instead of handing out a broken connection.
     */
    async claimNextJob(pool) {
        const client = await pool.connect();
        let releaseError;
        try {
            // Claim a job atomically
            await client.query('BEGIN');

            // Fetch next queued job with row locking to prevent race conditions in multi-worker setups
            const res = await client.query(`
                SELECT id, user_id, type, payload
                FROM jobs
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            `);

            if (res.rowCount === 0) {
                await client.query('ROLLBACK');
                return null;
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
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            // 42P01 = undefined_table — jobs table not yet created
            if (error.code === '42P01') {
                if (!this._tableWarnShown) {
                    console.log('Job Worker: jobs table not found — skipping (create with migrations)');
                    this._tableWarnShown = true;
                }
                return null;
            }
            releaseError = error;
            throw error;
        } finally {
            client.release(releaseError);
        }
    }

    async handleJob(job) {
        const pool = getPool();
        
        try {
            if (job.type === 'ingest') {
                const { material_id } = job.payload;
                if (!material_id) throw new Error("Missing material_id");

                // Get Material details to find path (only the job owner's own material)
                const matRes = await pool.query(
                    'SELECT storage_path, type FROM materials WHERE id = $1 AND user_id = $2',
                    [material_id, job.user_id]
                );
                if (matRes.rowCount === 0) throw new Error("Material not found");
                
                const material = matRes.rows[0];
                const filePath = path.resolve(PROJECT_ROOT, material.storage_path);
                const mimeType = material.type === 'pdf' ? 'application/pdf' : 'text/plain';

                await ingestMaterial(material_id, filePath, mimeType, job.user_id);
            } else {
                throw new Error(`Unknown job type: ${job.type}`);
            }

            // Mark Done
            await pool.query(`
                UPDATE jobs 
                SET status = 'done', progress = 100, updated_at = NOW() 
                WHERE id = $1
            `, [job.id]);
            console.log(`Job ${job.id} completed.`);

        } catch (error) {
            console.error(`Job ${job.id} failed:`, error);
            await pool.query(`
                UPDATE jobs 
                SET status = 'error', error = $2, updated_at = NOW() 
                WHERE id = $1
            `, [job.id, error.message]);
        }
    }
}

export const jobWorker = new JobWorker();
