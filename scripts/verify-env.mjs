#!/usr/bin/env node
/**
 * Verify Rise Path local environment for Issue #15.
 * Does not print secret values — only SET / MISSING / PLACEHOLDER.
 *
 * Usage:
 *   node scripts/verify-env.mjs
 *   node scripts/verify-env.mjs --db
 *   node scripts/verify-env.mjs --api
 *   node scripts/verify-env.mjs --auth
 *   node scripts/verify-env.mjs --health
 *   node scripts/verify-env.mjs --tts
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

const REQUIRED = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL_PHASE1',
];

const RECOMMENDED = [
  'VITE_DEMO_MODE',
  'VITE_API_ENABLED',
  'VITE_API_BASE_URL',
  'PORT',
  'HERMES_API_URL',
  'HERMES_API_KEY',
];

const TTS_RECOMMENDED = [
  'KOKORO_TTS_URL',
  'KOKORO_TTS_DEFAULT_VOICE_JA',
  'KOKORO_TTS_DEFAULT_VOICE_EN',
];

const OPTIONAL = [
  'GEMINI_API_KEY',
  'VITE_GEMINI_API_KEY',
];

const PLACEHOLDER_PATTERNS = [
  /^YOUR_/i,
  /your-project/i,
  /your-anon-key/i,
  /your-service-role-key/i,
  /your-gemini-api-key/i,
  /YOUR_PROJECT_REF/i,
  /YOUR_DB_PASSWORD/i,
  /CHANGE_ME/i,
];

/** DB names that must never be used for Rise Path app data */
const FORBIDDEN_DB_NAMES = new Set(['autogrants']);

const EXPECTED_DB = process.env.RISEPATH_EXPECTED_DB || 'risepath';

function parsePgUrl(connectionString) {
  try {
    const normalized = connectionString.replace(/^postgresql:/i, 'http:').replace(/^postgres:/i, 'http:');
    const u = new URL(normalized);
    const database = decodeURIComponent(u.pathname.replace(/^\//, '').split('/')[0] || '');
    return {
      host: u.hostname,
      database,
      user: decodeURIComponent(u.username || ''),
    };
  } catch {
    return null;
  }
}

function checkDatabaseTarget(env) {
  const cs = env.DATABASE_URL_PHASE1;
  if (!cs || classify('DATABASE_URL_PHASE1', cs) !== 'SET') return { ok: true, skipped: true };

  const parsed = parsePgUrl(cs);
  if (!parsed) {
    return { ok: false, message: 'DATABASE_URL_PHASE1 could not be parsed (check URI format)' };
  }

  console.log('\n## Database target (no secrets)');
  console.log(`   host: ${parsed.host}`);
  console.log(`   database: ${parsed.database}`);
  console.log(`   user: ${parsed.user}`);

  if (FORBIDDEN_DB_NAMES.has(parsed.database)) {
    return {
      ok: false,
      message: `database "${parsed.database}" is blocked for Rise Path — use "${EXPECTED_DB}" on risepath-vm (legacy: nexloom-gce; see doc/database_topology.md)`,
    };
  }

  if (/supabase\.co/i.test(parsed.host) && !env.RISEPATH_ALLOW_SUPABASE_DB) {
    console.log('⚠️  Host looks like Supabase Postgres. Data DB should be risepath-vm/risepath (legacy: nexloom-gce) unless intentional.');
    console.log('   Set RISEPATH_ALLOW_SUPABASE_DB=1 in .env.local to silence this warning.');
  }

  if (parsed.database !== EXPECTED_DB) {
    console.log(`⚠️  Expected database name "${EXPECTED_DB}", got "${parsed.database}".`);
  } else {
    console.log(`✅ Database name matches expected (${EXPECTED_DB}).`);
  }

  return { ok: true };
}

function parseEnvFile(raw) {
  const env = {};
  const keyOrder = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const idx = normalized.indexOf('=');
    if (idx === -1) continue;
    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!keyOrder.includes(key)) keyOrder.push(key);
    env[key] = value;
  }
  return { env, keyOrder };
}

function findDuplicateKeys(raw) {
  const counts = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return Object.entries(counts).filter(([, c]) => c > 1).map(([k]) => k);
}

function classify(key, value) {
  if (value === undefined || value === '') return 'MISSING';
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(value))) return 'PLACEHOLDER';
  return 'SET';
}

function statusIcon(status) {
  if (status === 'SET') return '✅';
  if (status === 'PLACEHOLDER') return '⚠️';
  return '❌';
}

function resolveEffectiveEnv(env) {
  const effective = { ...env };
  if (classify('SUPABASE_URL', effective.SUPABASE_URL) !== 'SET' && classify('VITE_SUPABASE_URL', effective.VITE_SUPABASE_URL) === 'SET') {
    effective.SUPABASE_URL = effective.VITE_SUPABASE_URL;
  }
  return effective;
}

async function loadEnvLocal() {
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf8');
    return { raw, ...parseEnvFile(raw) };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.error('❌ .env.local not found.');
      console.error('   Run: cp env.local.template .env.local');
      console.error('   Then fill in Supabase + DATABASE_URL_PHASE1 (see doc/env_local_setup_issue15.md)');
      process.exit(1);
    }
    throw err;
  }
}

async function checkDb(env) {
  const cs = env.DATABASE_URL_PHASE1;
  if (!cs || classify('DATABASE_URL_PHASE1', cs) !== 'SET') {
    console.log('\n--- DB ping ---');
    console.log('⏭️  Skipped (DATABASE_URL_PHASE1 not set)');
    return false;
  }

  console.log('\n--- DB ping ---');
  const pool = new pg.Pool({ connectionString: cs, connectionTimeoutMillis: 8000 });
  try {
    const r = await pool.query('select 1 as ok');
    console.log(`✅ PostgreSQL connected (ok=${r.rows[0]?.ok})`);
    return true;
  } catch (err) {
    console.log(`❌ PostgreSQL connection failed: ${err.message}`);
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function checkSupabaseAuth(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (classify('SUPABASE_URL', url) !== 'SET' || classify('SUPABASE_SERVICE_ROLE_KEY', key) !== 'SET') {
    console.log('\n--- Supabase Auth ---');
    console.log('⏭️  Skipped (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set)');
    return false;
  }

  console.log('\n--- Supabase Auth ---');
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      console.log(`❌ Supabase Auth API error: ${error.message}`);
      return false;
    }
    console.log(`✅ Supabase Auth reachable (users sample: ${data?.users?.length ?? 0})`);
    return true;
  } catch (err) {
    console.log(`❌ Supabase Auth check failed: ${err.message}`);
    return false;
  }
}

async function checkKokoroTts(env) {
  const base = (env.KOKORO_TTS_URL || 'http://127.0.0.1:8880').replace(/\/$/, '');
  console.log('\n--- Kokoro TTS ---');
  try {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    if (!res.ok || body.status !== 'ok') {
      console.log(`❌ GET ${base}/health → unhealthy`);
      return false;
    }
    if (!body.models_ready) {
      console.log('❌ Kokoro models not ready in sidecar');
      return false;
    }
    console.log(`✅ Kokoro sidecar healthy (${body.engine})`);
    return true;
  } catch (err) {
    console.log(`❌ Kokoro sidecar not reachable at ${base} (${err.message})`);
    console.log('   Start: docker run --rm -p 8880:8880 rise-path-kokoro-tts');
    return false;
  }
}

async function checkMigrations(env) {
  const cs = env.DATABASE_URL_PHASE1;
  if (!cs || classify('DATABASE_URL_PHASE1', cs) !== 'SET') {
    console.log('\n--- Migrations ---');
    console.log('⏭️  Skipped (DATABASE_URL_PHASE1 not set)');
    return true;
  }

  console.log('\n--- Migrations ---');
  try {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['scripts/db-migrate.mjs', '--status'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (output) console.log(output.split('\n').map((line) => `   ${line}`).join('\n'));
    const pending = (output.match(/(\d+) pending/) || [])[1];
    if (pending && Number(pending) > 0) {
      console.log('❌ Pending migrations — run: npm run db:migrate');
      return false;
    }
    console.log('✅ All migrations applied');
    return true;
  } catch (err) {
    console.log(`❌ Migration status failed: ${err.message}`);
    return false;
  }
}

async function checkHealth() {
  const base = 'http://localhost:3006';
  console.log('\n--- Health endpoint ---');
  try {
    const res = await fetch(`${base}/api/v2/health`);
    const body = await res.json();
    if (res.status === 200 && body?.ok) {
      console.log(`✅ GET /api/v2/health → 200 (ready_for_prod_data=${body.ready_for_prod_data})`);
      return true;
    }
    console.log(`❌ GET /api/v2/health → ${res.status}`, JSON.stringify(body).slice(0, 400));
    return false;
  } catch (err) {
    console.log(`❌ Health endpoint not reachable (${err.message})`);
    console.log('   Start stack: npm run dev');
    return false;
  }
}

async function checkApi(env) {
  const base = 'http://localhost:3006';
  console.log('\n--- API smoke ---');
  try {
    const res = await fetch(`${base}/api/v2/curricula`);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }

    if (res.status === 503 && body?.error === 'DB not configured') {
      console.log('❌ GET /api/v2/curricula → 503 DB not configured (DATABASE_URL_PHASE1 not loaded by server?)');
      console.log('   Restart: npm run dev');
      return false;
    }
    if (res.status === 401 && env.VITE_DEMO_MODE === 'false') {
      console.log('✅ GET /api/v2/curricula → 401 without JWT (strict auth / VITE_DEMO_MODE=false)');
      return true;
    }
    if (res.status === 200 && body?.ok) {
      console.log(`✅ GET /api/v2/curricula → 200 (count=${body.curricula?.length ?? 0})`);
      return true;
    }
    console.log(`⚠️  GET /api/v2/curricula → ${res.status}`, JSON.stringify(body).slice(0, 300));
    return false;
  } catch (err) {
    console.log(`❌ API not reachable at ${base} (${err.message})`);
    console.log('   Start stack: npm run dev');
    return false;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const { raw, env: rawEnv } = await loadEnvLocal();
  const env = resolveEffectiveEnv(rawEnv);

  for (const [k, v] of Object.entries(env)) {
    if (!Object.prototype.hasOwnProperty.call(process.env, k)) process.env[k] = v;
  }

  console.log('# Rise Path env check (.env.local)');
  console.log(`path: ${ENV_PATH}\n`);

  const dupes = findDuplicateKeys(raw);
  if (dupes.length) {
    console.log('## Warnings');
    console.log(`⚠️  Duplicate keys in .env.local (last value wins): ${dupes.join(', ')}`);
    console.log('   Remove placeholder duplicates — see doc/env_local_setup_issue15.md\n');
  }

  console.log('## Required (Issue #15)');
  let blockers = 0;
  for (const key of REQUIRED) {
    const status = classify(key, env[key]);
    if (status !== 'SET') blockers += 1;
    console.log(`${statusIcon(status)} ${key}: ${status}`);
  }

  console.log('\n## Recommended (v3 Hermes + local dev)');
  for (const key of RECOMMENDED) {
    const status = classify(key, env[key]);
    console.log(`${statusIcon(status)} ${key}: ${status}${env[key] !== undefined ? ` (value=${env[key]})` : ''}`);
  }

  console.log('\n## Recommended (Kokoro TTS — Issue #3)');
  for (const key of TTS_RECOMMENDED) {
    const status = classify(key, env[key]);
    console.log(`${statusIcon(status)} ${key}: ${status}`);
  }

  console.log('\n## Optional (legacy Gemini — FloatingChatbot, /ai/generate)');
  for (const key of OPTIONAL) {
    const status = classify(key, env[key]);
    console.log(`${statusIcon(status)} ${key}: ${status}`);
  }

  if (env.VITE_DEMO_MODE === 'false') {
    console.log('\nℹ️  VITE_DEMO_MODE=false → frontend will call /api/v2 (not bundled demo JSON).');
  } else {
    console.log('\nℹ️  VITE_DEMO_MODE is not false → app may still use demo course data on the frontend.');
  }

  if (classify('HERMES_API_KEY', env.HERMES_API_KEY) !== 'SET') {
    console.log('ℹ️  Hermes not configured → Life Journal chat / agent proxy will return 503 until gateway is running.');
  }

  const dbTarget = checkDatabaseTarget(env);
  if (!dbTarget.ok) {
    console.log(`\n❌ ${dbTarget.message}`);
    blockers += 1;
  }

  if (blockers > 0) {
    console.log(`\n❌ ${blockers} required variable(s) still missing or placeholder.`);
    console.log('   See doc/env_local_setup_issue15.md');
    if (!args.has('--db') && !args.has('--api') && !args.has('--auth') && !args.has('--health') && !args.has('--tts')) process.exit(1);
  } else {
    console.log('\n✅ All required variables look set (format not validated).');
  }

  let ok = blockers === 0;
  if (args.has('--db')) ok = (await checkDb(env)) && ok;
  if (args.has('--auth')) ok = (await checkSupabaseAuth(env)) && ok;
  if (args.has('--migrations') || args.has('--db')) ok = (await checkMigrations(env)) && ok;
  if (args.has('--api')) ok = (await checkApi(env)) && ok;
  if (args.has('--health')) ok = (await checkHealth()) && ok;
  if (args.has('--tts')) ok = (await checkKokoroTts(env)) && ok;

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});