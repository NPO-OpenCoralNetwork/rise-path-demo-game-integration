#!/usr/bin/env node
/**
 * Apply server/migrations/*.sql in lexical order with schema_migrations tracking.
 *
 * Usage:
 *   node scripts/db-migrate.mjs
 *   node scripts/db-migrate.mjs --status
 *   node scripts/db-migrate.mjs --dry-run
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'server', 'migrations');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const statusOnly = args.has('--status');

async function loadEnvLocal() {
  try {
    const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedVersions(client) {
  const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(rows.map((r) => r.version));
}

async function main() {
  await loadEnvLocal();
  const connectionString = process.env.DATABASE_URL_PHASE1;
  if (!connectionString) {
    console.error('DATABASE_URL_PHASE1 is not set (.env.local)');
    process.exit(1);
  }

  const files = await listMigrationFiles();
  if (files.length === 0) {
    console.error('No migration files found in server/migrations/');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await ensureTrackingTable(client);
    const applied = await getAppliedVersions(client);
    const pending = files.filter((f) => !applied.has(path.basename(f, '.sql')));

    console.log(`# Rise Path migrations (${files.length} files, ${applied.size} applied, ${pending.length} pending)`);

    if (statusOnly) {
      for (const file of files) {
        const version = path.basename(file, '.sql');
        const mark = applied.has(version) ? '✅' : '⬜';
        console.log(`${mark} ${file}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log('Nothing to apply.');
      return;
    }

    for (const file of pending) {
      const version = path.basename(file, '.sql');
      const sqlPath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(sqlPath, 'utf8');

      console.log(`→ ${file}`);
      if (dryRun) continue;

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
          [version]
        );
        await client.query('COMMIT');
        console.log(`  applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  failed: ${err.message}`);
        process.exit(1);
      }
    }

    if (dryRun) {
      console.log('Dry run complete (no changes written).');
    } else {
      console.log('All pending migrations applied.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});