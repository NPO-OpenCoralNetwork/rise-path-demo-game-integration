// @ts-check
// npm run smoke:edge (scripts/smoke-public-edge.mjs; Phase 9, design §6.2 and §6.3, Scope guard TR7/TR8):
// runEdgeSmoke against fake app, api and mcp servers on loopback. Each new check (0, 10-14) passes on the
// good servers and fails on its own broken switch, and only that check fails; the bearer and the bodies are
// never printed; http is refused before any request. Checks 11 and 12 are also run against the real
// api (server.js createApp, production) so the probe body and the CORS answers are the server's own.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FOREIGN_ORIGIN, TUTOR_GUEST_PROBE, runEdgeSmoke } from '../../scripts/smoke-public-edge.mjs';
import { PILOT_ONLY_REFUSAL } from '../middleware/pilotGate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'scripts/smoke-public-edge.mjs');

/** @type {Set<string>} */
const breaks = new Set();
/** @type {{ byoaOpen: boolean, requests: string[], auth: string[], bodySentinel: string }} */
const state = { byoaOpen: false, requests: [], auth: [], bodySentinel: '' };

const goodLlm = () => ({
  ok: true,
  mock: breaks.has('llm-mock'),
  forced_provider: breaks.has('llm-forced') ? 'gemini' : null,
  providers: {
    anthropic: { configured: !breaks.has('llm-anthropic') },
    gemini: { configured: false, allowed: breaks.has('llm-gemini') },
    mock: { available: false, forced: false },
  },
  tasks: {},
  note: state.bodySentinel,
});

/** @param {http.RequestListener} handler @returns {Promise<{ url: string, server: http.Server }>} */
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`, server }));
  });
}
/** @param {http.IncomingMessage} req */
const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => { s += c; });
  req.on('end', () => resolve(s));
});

let appUrl = '';
let apiUrl = '';
let mcpUrl = '';
let deadUrl = '';
/** @type {http.Server[]} */
const servers = [];

/** @param {http.ServerResponse} res @param {number} status @param {Record<string, string>} headers @param {string} body */
function send(res, status, headers, body) {
  if (breaks.has('powered')) headers['x-powered-by'] = 'Express';
  res.writeHead(status, headers);
  res.end(body);
}

before(async () => {
  // The app: Vercel with the api behind /api/* (the route adds x-origin-secret; the api is healthy).
  const app = await serve(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const origin = req.headers.origin;
    state.requests.push(`app ${req.method} ${url.pathname}`);
    if (req.headers.authorization) state.auth.push(req.headers.authorization);
    const json = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    /** CORS as the api answers it (server.js): only the app's own origin gets itself back. */
    const cors = () => {
      if (breaks.has('cors-foreign') && origin) return { 'access-control-allow-origin': origin };
      if (breaks.has('cors-own-wrong') && origin === appUrl) return { 'access-control-allow-origin': 'https://other.example' };
      if (breaks.has('cors-own-missing')) return {};
      return origin === appUrl ? { 'access-control-allow-origin': appUrl } : {};
    };
    if (url.pathname === '/api/v2/health') return send(res, 200, json, JSON.stringify({ ok: true, status: 'ok' }));
    if (url.pathname === '/api/v2/llm/status') return send(res, 200, { ...json, ...cors() }, JSON.stringify(goodLlm()));
    if (url.pathname === '/api/generate-audio') return send(res, 404, json, '{"error":"not_found"}');
    if (url.pathname === '/api/v2/user/profile') {
      if (!req.headers.authorization) return send(res, 401, json, '{"error_type":"unauthorized"}');
      // The api with the pilot list on, for a token whose account is not on it (server/middleware/pilotGate.js).
      if (breaks.has('profile-pilot')) return send(res, 403, json, JSON.stringify({ ...PILOT_ONLY_REFUSAL, detail: state.bodySentinel }));
      if (breaks.has('profile-terms')) return send(res, 403, json, JSON.stringify({ error_type: 'terms_required', detail: state.bodySentinel }));
      return send(res, 200, json, JSON.stringify({ id: state.bodySentinel }));
    }
    if (url.pathname === '/api/v2/llm/tutor' && req.method === 'POST') {
      const body = await readBody(req);
      let parsed = null;
      try { parsed = JSON.parse(String(body)); } catch { parsed = null; }
      // The api's body check and the lesson-only rule for guests come before the AI access gate (llm.js).
      if (!parsed?.message || !parsed?.lesson || !parsed?.anchor) return send(res, 400, json, JSON.stringify({ error_type: 'validation', detail: state.bodySentinel }));
      if (breaks.has('tutor-open')) return send(res, 200, { 'content-type': 'text/event-stream' }, `event: meta\ndata: ${state.bodySentinel}\n\n`);
      if (breaks.has('tutor-origin')) return send(res, 403, json, JSON.stringify({ error_type: 'forbidden_origin' }));
      return send(res, 401, { ...json, ...cors() }, JSON.stringify({ error: 'Sign in to use the AI features.', error_type: 'sign_in_required', detail: state.bodySentinel }));
    }
    if (url.pathname.startsWith('/assets/')) return send(res, 404, { 'content-type': 'text/plain' }, 'not found');
    const page = { 'content-type': 'text/html; charset=utf-8' };
    if (!breaks.has('frame')) page['x-frame-options'] = 'SAMEORIGIN';
    if (!breaks.has('sniff')) page['x-content-type-options'] = 'nosniff';
    // The SPA's index.html for every other path (/, /uploads/…). Vercel adds no X-Powered-By.
    res.writeHead(200, page);
    res.end(`<!doctype html><title>${state.bodySentinel}</title>`);
  });
  // api.<domain> straight: refused without the edge's secret (origin gate).
  const api = await serve((req, res) => {
    state.requests.push(`api ${req.method} ${req.url}`);
    send(res, 403, { 'content-type': 'application/json' }, JSON.stringify({ error: 'forbidden', detail: state.bodySentinel }));
  });
  // mcp.<domain>: the tunnel answers 502 for a host whose service is off (byoa off).
  const mcp = await serve((req, res) => {
    state.requests.push(`mcp ${req.method} ${req.url}`);
    if (state.byoaOpen || breaks.has('mcp-open')) return send(res, 200, { 'content-type': 'application/json' }, JSON.stringify({ resource: 'https://mcp.example/mcp' }));
    return send(res, 502, { 'content-type': 'text/plain' }, 'Bad gateway');
  });
  const dead = await serve(() => {});
  deadUrl = dead.url;
  await new Promise((resolve) => dead.server.close(resolve));
  servers.push(app.server, api.server, mcp.server);
  [appUrl, apiUrl, mcpUrl] = [app.url, api.url, mcp.url];
});
after(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
});
beforeEach(() => {
  breaks.clear();
  Object.assign(state, { byoaOpen: false, requests: [], auth: [], bodySentinel: '' });
});

/** @param {Partial<Parameters<typeof runEdgeSmoke>[0]>} [opts] */
async function smoke(opts = {}) {
  /** @type {string[]} */
  const lines = [];
  const result = await runEdgeSmoke({ app: appUrl, api: apiUrl, mcp: mcpUrl, allowHttpLoopback: true, log: (l) => lines.push(l), ...opts });
  return { ...result, out: lines.join('\n'), failed: lines.filter((l) => l.startsWith('❌')).map((l) => /^❌ (\d+[ab]?)\./.exec(l)?.[1]) };
}

describe('smoke:edge: the checks against fake servers', () => {
  it('good servers: no failure; checks 0 and 10-14 pass', async () => {
    const r = await smoke();
    assert.equal(r.failures, 0, r.out);
    for (const n of ['0', '10', '11a', '11b', '12', '13a', '13b', '14']) assert.match(r.out, new RegExp(`^✅ ${n}\\. `, 'm'), n);
    assert.ok(state.requests.includes('mcp GET /.well-known/oauth-protected-resource'));
  });

  it('each broken switch fails its own check, and only that one', async () => {
    /** @type {[string, string][]} */
    const table = [
      ['llm-anthropic', '10'], ['llm-gemini', '10'], ['llm-mock', '10'], ['llm-forced', '10'],
      ['cors-foreign', '11a'], ['cors-own-wrong', '11b'],
      ['tutor-open', '12'], ['tutor-origin', '12'],
      ['frame', '13a'], ['sniff', '13a'], ['powered', '13b'],
      ['mcp-open', '14'],
    ];
    for (const [name, check] of table) {
      breaks.clear();
      breaks.add(name);
      const r = await smoke();
      assert.deepEqual(r.failed, [check], `${name}: ${r.out}`);
    }
  });

  it('11b: no access-control-allow-origin for the app\'s own origin is a note (Vercel may not forward Origin), not a failure', async () => {
    breaks.add('cors-own-missing');
    const r = await smoke();
    assert.equal(r.failures, 0, r.out);
    assert.match(r.out, /^ℹ️ {2}11b\. /m);
  });

  it('12 sends a body that passes the body check: an empty body would stop at 400, not at the AI access gate', async () => {
    await smoke();
    assert.ok(state.requests.includes('app POST /api/v2/llm/tutor'));
    const r = await fetch(`${appUrl}/api/v2/llm/tutor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 400, 'the fake api, like the real one, checks the body first');
  });

  it('14: byoa off passes with no answer at all; SMOKE_BYOA=1 wants 200 JSON; no mcp host → a note', async () => {
    assert.equal((await smoke({ mcp: deadUrl })).failures, 0);
    assert.deepEqual((await smoke({ byoa: true })).failed, ['14']);
    state.byoaOpen = true;
    assert.equal((await smoke({ byoa: true })).failures, 0);
    const none = await smoke({ mcp: null });
    assert.equal(none.failures, 0);
    assert.match(none.out, /^ℹ️ {2}14\. skipped/m);
  });

  it('0: an http origin fails check 0 and nothing is requested (the tests\' loopback exception is a function option only)', async () => {
    for (const opts of [{ allowHttpLoopback: false }, { app: 'http://app.example.org' }, { api: 'http://api.example.org' }, { mcp: 'http://mcp.example.org' }, { app: 'not a url' }]) {
      state.requests = [];
      const r = await smoke(opts);
      assert.deepEqual(r.failed, ['0'], JSON.stringify(opts));
      assert.equal(r.passes, 0);
      assert.deepEqual(state.requests, [], `${JSON.stringify(opts)}: no request`);
    }
  });

  it('the bearer and the bodies are never printed', async () => {
    const S = `SENTINELX9F3${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    state.bodySentinel = S;
    const ok = await smoke({ bearer: `${S}.token` });
    assert.equal(ok.failures, 0, ok.out);
    assert.deepEqual(state.auth, [`Bearer ${S}.token`], 'the bearer was sent, once, on check 9');
    breaks.add('tutor-open').add('llm-anthropic');
    const bad = await smoke({ bearer: `${S}.token` });
    assert.ok(bad.failures > 0);
    for (const r of [ok, bad]) assert.ok(!r.out.includes(S), r.out);
  });

  // Review round 1, finding 3: with the pilot list on, a token of an account off the list (the dummy, the under-18
  // test account) gets 403 pilot_only; check 9 says so instead of a bare "403 (want 200)".
  it('9: a 403 pilot_only names the pilot list (手順書 10.1); another 403 gets no such hint; the bearer and the body are never printed', async () => {
    const S = `SENTINELX9F3${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    state.bodySentinel = S;
    breaks.add('profile-pilot');
    const pilot = await smoke({ bearer: `${S}.token` });
    assert.deepEqual(pilot.failed, ['9'], pilot.out);
    const line = pilot.out.split('\n').find((l) => l.startsWith('❌ 9. ')) ?? '';
    assert.match(line, /→ 403 \(want 200\) — error_type pilot_only: this token's account is not on PILOT_ACCOUNT_IDS; use the adult test account that is on the list \(手順書 10\.1\)$/);
    breaks.clear();
    breaks.add('profile-terms');
    const terms = await smoke({ bearer: `${S}.token` });
    assert.deepEqual(terms.failed, ['9'], terms.out);
    assert.doesNotMatch(terms.out, /PILOT_ACCOUNT_IDS|pilot_only/);
    for (const r of [pilot, terms]) assert.ok(!r.out.includes(S), r.out);
    // The checklist names whose token to use.
    const readme = fs.readFileSync(path.join(ROOT, 'deploy/vercel/README.md'), 'utf8');
    assert.match(readme, /# 任意: 18 歳以上のテスト用アカウント（試験運用の名簿 PILOT_ACCOUNT_IDS に入っているもの。手順書 10\.1）の\n\s*# Supabase アクセストークン。名簿にないアカウント（ダミー、18 歳未満のテスト用）だと 9 番が 403 pilot_only で落ちる。/);
  });
});

describe('smoke:edge: the CLI', () => {
  /** @param {Record<string, string>} env @returns {Promise<{ status: number | null, out: string }>} */
  const runCli = (env) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI], { env: { PATH: process.env.PATH ?? '', ...env } });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (status) => resolve({ status, out }));
  });

  it('refuses http before any request; derives the mcp. host from api.; never prints the bearer', async () => {
    const S = `SENTINELX9F3${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const r = await runCli({ PUBLIC_APP_URL: appUrl, PUBLIC_API_URL: 'http://api.example.org', SMOKE_BEARER: S });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^❌ 0\. PUBLIC_APP_URL and PUBLIC_API_URL use https:\/\/ — not https: PUBLIC_APP_URL, PUBLIC_API_URL, PUBLIC_MCP_URL \(no request sent\)$/m);
    assert.match(r.out, /^MCP: http:\/\/mcp\.example\.org$/m);
    assert.match(r.out, /^Bearer: set \(not printed\)$/m);
    assert.ok(!r.out.includes(S));
    assert.deepEqual(state.requests, [], 'nothing reached the app');
  });

  it('PUBLIC_MCP_URL wins; an API host without api. checks no mcp host; a non-http scheme is a usage error', async () => {
    const own = await runCli({ PUBLIC_APP_URL: 'http://a.example', PUBLIC_API_URL: 'http://api.example', PUBLIC_MCP_URL: 'http://m.example' });
    assert.match(own.out, /^MCP: http:\/\/m\.example$/m);
    const none = await runCli({ PUBLIC_APP_URL: 'http://a.example', PUBLIC_API_URL: 'http://b.example' });
    assert.match(none.out, /^MCP: \(not checked\)$/m);
    const ftp = await runCli({ PUBLIC_APP_URL: 'ftp://a.example', PUBLIC_API_URL: 'https://api.example' });
    assert.equal(ftp.status, 1);
    assert.match(ftp.out, /❌ PUBLIC_APP_URL must be an https URL/);
  });
});

// The real api (server.js, production): the body of check 12 reaches the AI access gate, and CORS answers
// checks 11a and 11b as the fake app does. Nothing here needs a database, Supabase or a model.
describe('smoke:edge checks 11-13 against the real api (server.js createApp, production)', () => {
  const KEYS = ['NODE_ENV', 'LLM_ALLOWED_ORIGINS', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'LLM_GUEST_AI', 'RISE_PATH_BRIDGE_TOKEN', 'TRUST_PROXY'];
  /** @type {Record<string, string | undefined>} */
  const saved = {};
  const APP = 'https://app.example.org';
  /** @type {{ warn: typeof console.warn, error: typeof console.error, log: typeof console.log }} */
  const quiet = { warn: console.warn, error: console.error, log: console.log };
  before(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    Object.assign(process.env, { NODE_ENV: 'production', LLM_ALLOWED_ORIGINS: APP, RISE_PATH_BRIDGE_TOKEN: 'test-bridge-token-smoke-edge' });
    for (const k of ['ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'LLM_GUEST_AI', 'TRUST_PROXY']) delete process.env[k];
    console.warn = () => {};
    console.error = () => {};
  });
  after(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    Object.assign(console, quiet);
  });

  it('the guest probe → 401 sign_in_required (an empty body → 400); CORS only for the app; no X-Powered-By', async () => {
    const { createApp } = await import('../../server.js');
    const app = await createApp({ serveStatic: false });
    const server = /** @type {http.Server} */ (await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }));
    try {
      const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
      const tutor = (/** @type {string} */ body) => fetch(`${base}/api/v2/llm/tutor`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP }, body });
      const probe = await tutor(JSON.stringify(TUTOR_GUEST_PROBE));
      assert.equal(probe.status, 401);
      assert.equal((await probe.json()).error_type, 'sign_in_required');
      assert.equal(probe.headers.get('x-powered-by'), null);
      const empty = await tutor('{}');
      assert.equal(empty.status, 400, 'the body check answers first');
      assert.notEqual((await empty.json()).error_type, 'sign_in_required');
      const foreign = await fetch(`${base}/api/v2/llm/status`, { headers: { origin: FOREIGN_ORIGIN } });
      assert.equal(foreign.status, 200);
      assert.equal(foreign.headers.get('access-control-allow-origin'), null);
      const own = await fetch(`${base}/api/v2/llm/status`, { headers: { origin: APP } });
      assert.equal(own.headers.get('access-control-allow-origin'), APP);
      assert.match(String(own.headers.get('cache-control')), /no-store/);
      assert.equal(own.headers.get('x-powered-by'), null);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
