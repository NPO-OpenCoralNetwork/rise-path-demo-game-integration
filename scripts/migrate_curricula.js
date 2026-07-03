/**
 * @deprecated Use `npm run db:migrate` — extra curricula columns are in
 * server/migrations/001_core_curriculum.sql
 */

import pg from 'pg';
import fs from 'fs/promises';

const { Pool } = pg;

const loadEnv = async () => {
  try {
    const raw = await fs.readFile('.env.local', 'utf8');
    raw.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2 && !line.trim().startsWith('#')) {
        const key = parts[0].trim().replace(/^export\s+/, '');
        const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    });
  } catch (e) { console.log("No .env.local found."); }
};

async function migrate() {
    await loadEnv();
    const phase1DatabaseUrl = process.env.DATABASE_URL_PHASE1;
    if (!phase1DatabaseUrl) {
        console.error("DATABASE_URL_PHASE1 missing");
        process.exit(1);
    }

    const pool = new Pool({ connectionString: phase1DatabaseUrl });
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        console.log("Adding columns to curricula table...");
        
        await client.query(`
            ALTER TABLE curricula 
            ADD COLUMN IF NOT EXISTS category text,
            ADD COLUMN IF NOT EXISTS thumbnail text,
            ADD COLUMN IF NOT EXISTS color text,
            ADD COLUMN IF NOT EXISTS model_used text,
            ADD COLUMN IF NOT EXISTS total_lessons int default 0,
            ADD COLUMN IF NOT EXISTS content jsonb
        `);

        await client.query('COMMIT');
        console.log("Migration complete.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Migration failed:", e);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
