import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestMaterial } from './ragService.js';

const { Pool } = pg;

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..'); // Assuming server/jobWorker.js

let _pool = null;
const getPool = () => {
    if (_pool) return _pool;
    const phase1DatabaseUrl = process.env.DATABASE_URL_PHASE1;
    if (!phase1DatabaseUrl) return null;
    _pool = new Pool({ connectionString: phase1DatabaseUrl });
    return _pool;
};

const POLLING_INTERVAL_MS = 2000;

export class JobWorker {
    constructor() {
        this.isRunning = false;
        this.timeoutId = null;
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

        try {
            await this.processNextJob();
        } catch (error) {
            console.error("Job Worker Error:", error);
        }

        // Schedule next tick
        if (this.isRunning) {
            this.timeoutId = setTimeout(() => this.loop(), POLLING_INTERVAL_MS);
        }
    }

    async processNextJob() {
        const pool = getPool();
        if (!pool) {
            // Wait for env/pool
            return; 
        }

        const client = await pool.connect();
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
                    client.release();
                    if (!this._tableWarnShown) {
                        console.log('Job Worker: jobs table not found — skipping (create with migrations)');
                        this._tableWarnShown = true;
                    }
                    return;
                }
                throw queryErr;
            }

            if (res.rowCount === 0) {
                await client.query('ROLLBACK');
                return; // No jobs
            }

            const job = res.rows[0];
            
            // Mark as running
            await client.query(`
                UPDATE jobs 
                SET status = 'running', updated_at = NOW() 
                WHERE id = $1
            `, [job.id]);
            
            await client.query('COMMIT');
            
            // Release client for long running task (don't hold connection)
            client.release();

            // Process Job
            console.log(`Processing Job ${job.id} (${job.type})...`);
            await this.handleJob(job);

        } catch (e) {
            // If claiming failed
            try { await client.query('ROLLBACK'); } catch (_) {}
            client.release();
            throw e;
        }
    }

    async handleJob(job) {
        const pool = getPool();
        
        try {
            if (job.type === 'ingest') {
                const { material_id } = job.payload;
                if (!material_id) throw new Error("Missing material_id");

                // Get Material details to find path
                const matRes = await pool.query('SELECT storage_path, type FROM materials WHERE id = $1', [material_id]);
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
