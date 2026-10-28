// Global setup of the learner end-to-end checks (Phase 7). Playwright runs it once, after the
// webServer (vite preview) is up. Each check stops the run with a message that names the missing
// piece, so a red run says which step of scripts/ci/stack.sh to look at:
//   1. the production build for the stand-in (stack.sh build-front)
//   2. the api: production, strict auth, no pending migration (stack.sh deploy 1)
//   3. the preview's /api proxy   4. the auth stand-in (stack.sh auth)
//   5. the auth chain: a stand-in token that the api accepts (it asks the stand-in, server/middleware/auth.js)
//   6. the stack's database   7. 00:00 JST: wait past it when the suite could cross it (days are Japan time)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { E2E } from './support/env.ts';
import { STANDIN_PASSWORD } from './support/auth-stand-in.mjs';
import { waitPastJstMidnight } from '../scripts/ci/jst-midnight-guard.mjs';

const BUILD = 'run `bash scripts/ci/stack.sh build-front` (a production build that points at the stand-in)';
const STACK = 'the CI stack is not running: npm run e2e:local, or bash scripts/ci/stack.sh deploy 1, then auth';

async function get(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}

/** Throws `message` and what was seen when `fn` throws or `ok` is false. */
async function check<T>(name: string, fn: () => Promise<T>, ok: (value: T) => boolean, message: string): Promise<T> {
  let value: T;
  try {
    value = await fn();
  } catch (error) {
    throw new Error(`global setup, ${name}: ${message} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!ok(value)) throw new Error(`global setup, ${name}: ${message} (got ${JSON.stringify(value).slice(0, 400)})`);
  console.log(`ok   ${name}`);
  return value;
}

export default async function globalSetup() {
  const dist = path.resolve(E2E.distDir);
  await check('the front build', async () => {
    if (!fs.existsSync(path.join(dist, 'index.html'))) return 'no index.html';
    const assets = path.join(dist, 'assets');
    const files = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')) : [];
    return files.some((f) => fs.readFileSync(path.join(assets, f), 'utf8').includes(`127.0.0.1:${E2E.authPort}`)) ? 'ok' : `no asset names 127.0.0.1:${E2E.authPort}`;
  }, (v) => v === 'ok', BUILD);

  await check('api health', () => get(`${E2E.apiUrl}/api/v2/health`), (r) => r.status === 200 && r.body?.node_env === 'production'
    && r.body?.checks?.strict_auth_mode === true && r.body?.database?.migrations?.pending === 0, STACK);
  await check('the preview proxy', () => get(`${E2E.appUrl}/api/v2/health`), (r) => r.status === 200,
    `vite preview does not reach ${E2E.apiUrl} through /api (playwright.config.ts webServer, API_PROXY_TARGET)`);
  await check('the auth stand-in', () => get(`${E2E.authUrl}/auth/v1/health`), (r) => r.status === 200,
    `nothing answers on ${E2E.authUrl}: run bash scripts/ci/stack.sh auth`);

  const email = `e2e-preflight-${Date.now().toString(36)}@example.org`;
  const session = await check('a stand-in sign-in', () => get(`${E2E.authUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: STANDIN_PASSWORD }),
  }), (r) => r.status === 200 && typeof r.body?.access_token === 'string', 'the stand-in refused its own learner');
  const chain = await get(`${E2E.apiUrl}/api/v2/user/ai-access`, { headers: { authorization: `Bearer ${session.body.access_token}` } });
  // The api asks SUPABASE_URL about every token, and an answer it cannot get is a refusal (401).
  if (chain.status >= 500) throw new Error(`global setup, the auth chain: ${chain.status}: the api failed while it asked the stand-in (stack.sh auth, the network alias)`);
  if (chain.status === 401) throw new Error('global setup, the auth chain: 401: the api refused a stand-in token: its SUPABASE_URL does not reach the stand-in (stack.sh auth, the network alias; host mode: SUPABASE_URL=http://127.0.0.1:<port>)');
  if (chain.status !== 200) throw new Error(`global setup, the auth chain: GET /api/v2/user/ai-access answered ${chain.status}`);
  console.log('ok   the auth chain (stand-in token → api → stand-in)');

  const pool = new pg.Pool({ connectionString: E2E.databaseUrl, max: 1 });
  try {
    await check('the stack database', () => pool.query('SELECT 1 AS one'), (r: { rows: { one?: number }[] }) => r.rows[0]?.one === 1,
      'the specs reach the database on 127.0.0.1:5432 with the user of deploy/risepath-vm/ci/stack.ci.env');
    await waitPastJstMidnight({ query: (sql) => pool.query(sql), budgetS: E2E.dayBudgetS });
  } finally {
    await pool.end();
  }
}
