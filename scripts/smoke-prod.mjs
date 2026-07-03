#!/usr/bin/env node
/**
 * Production-readiness smoke test (Phase 15-1).
 * Requires .env.local and a running API server (npm run dev).
 *
 * Usage:
 *   node scripts/smoke-prod.mjs
 *   node scripts/smoke-prod.mjs --base http://localhost:3006
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

function parseArgs() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base');
  const base = baseIdx >= 0 ? args[baseIdx + 1] : 'http://localhost:3006';
  return { base: base.replace(/\/$/, '') };
}

async function loadEnvLocal() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body };
}

async function main() {
  const { base } = parseArgs();
  let env;
  try {
    env = await loadEnvLocal();
  } catch {
    console.error('❌ .env.local not found. Run: cp env.local.template .env.local');
    process.exit(1);
  }

  console.log('# Rise Path production smoke (Phase 15-1)');
  console.log(`API base: ${base}\n`);

  let ok = true;

  const health = await fetchJson(`${base}/api/v2/health`);
  if (health.res.status !== 200 || !health.body?.ok) {
    console.log(`❌ GET /api/v2/health → ${health.res.status}`, JSON.stringify(health.body || {}).slice(0, 400));
    ok = false;
  } else {
    const { database, supabase, frontend, ready_for_prod_data } = health.body;
    console.log('✅ GET /api/v2/health → 200');
    console.log(`   demo_mode=${frontend?.demo_mode} ready_for_prod_data=${ready_for_prod_data} strict_auth=${health.body.auth_policy?.strict_auth_mode}`);
    if (!health.body.auth_policy?.strict_auth_mode) {
      console.log('⚠️  strict_auth_mode=false — set VITE_DEMO_MODE=false for production boundaries');
      ok = false;
    }
    console.log(`   database=${database?.status} migrations_pending=${database?.migrations?.pending ?? '?'}`);
    console.log(`   supabase=${supabase?.status}`);
    if (!ready_for_prod_data) {
      console.log('⚠️  ready_for_prod_data=false — set VITE_DEMO_MODE=false in .env.local and restart dev server');
      ok = false;
    }
  }

  const strictAuth = health.body?.auth_policy?.strict_auth_mode === true;
  const curricula = await fetchJson(`${base}/api/v2/curricula`);
  if (curricula.res.status === 503) {
    console.log('❌ GET /api/v2/curricula → 503 DB not configured');
    ok = false;
  } else if (strictAuth && curricula.res.status === 401) {
    console.log('✅ GET /api/v2/curricula → 401 without JWT (strict auth enforced)');
  } else if (curricula.res.status === 200 && curricula.body?.ok) {
    console.log(`✅ GET /api/v2/curricula → 200 (count=${curricula.body.curricula?.length ?? 0})`);
  } else {
    console.log(`❌ GET /api/v2/curricula → ${curricula.res.status}`);
    ok = false;
  }

  const portals = await fetchJson(`${base}/api/learning-portals`);
  if (portals.res.status === 200 && portals.body?.ok) {
    console.log(`✅ GET /api/learning-portals → 200 (count=${portals.body.portals?.length ?? 0})`);
    if ((portals.body.portals?.length ?? 0) === 0) {
      console.log('⚠️  No learning portals — run npm run db:migrate (008_seed_learning_portals.sql)');
    }
  } else {
    console.log(`❌ GET /api/learning-portals → ${portals.res.status}`);
    ok = false;
  }

  if (env.VITE_DEMO_MODE === 'false') {
    console.log('\nℹ️  VITE_DEMO_MODE=false — restart Vite after .env.local changes: npm run dev');
  }

  console.log(ok ? '\n✅ Production smoke passed' : '\n❌ Production smoke failed');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});