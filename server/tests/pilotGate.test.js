// @ts-check
// The pilot list (Phase 9, D1; design §3.5 after the Scope guard's TR5/TR6): server/middleware/pilotGate.js
// and the three auth middlewares that ask it (requireAuth and optionalAuth in auth.js, requireBridgeOrAuth
// in bridgeAuth.js), the preflight's copy of the id pattern (scripts/deploy/preflight-rules.mjs
// PILOT_ID_RE, readPilotEntries), the startup lines, and the app's full-page notice
// (components/common/PilotOnlyView.tsx, services/pilotAccess.ts, apiFetch, App.tsx).
//   - PILOT_ACCOUNT_IDS unset or blank: off (today's behaviour). Set: on, fail closed: an entry that is
//     not a UUID is ignored and counted by position; set with no valid id refuses everyone.
//   - Checked: every Supabase session, an anonymous one included; never the bridge, the dev fallback or
//     a guest. No exempt route (PUT /user/lesson-progress included). optionalAuth refuses with the same
//     403, not the guest path.
//   - A refused session leaves nothing in the database: no re-open of a deleted account, no auth.users
//     stub, no transaction. requireAuth and requireBridgeOrAuth make one read-only tombstone lookup: a
//     session that signed in before its account's deletion gets 401 account_deleted, as without the list
//     (final review, finding 19); optionalAuth reads nothing.
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createApp } from '../../server.js';
import { resetPoolForTests, setPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { PILOT_ENV, PILOT_ONLY_REFUSAL, pilotRefuses, pilotStartupLines, readPilotList } from '../middleware/pilotGate.js';
import { TERMS_EXEMPT, invalidateTermsAcceptance } from '../middleware/termsGate.js';
import { UUID_RE } from '../utils/ids.js';
import { PILOT_ID_RE, readPilotEntries } from '../../scripts/deploy/preflight-rules.mjs';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { LEGAL_POOL_SQL, createLegalPool } from './helpers/legalPool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PILOT_IDS = /** @type {{ valid: string[], invalid: string[] }} */ (JSON.parse(read('server/tests/fixtures/pilot-ids.json')));

const A = 'abcdef01-2345-4678-9abc-def012345678'; // on the list
const B = 'bcdef012-3456-4789-8bcd-ef0123456789'; // not on the list
const ANON = 'cdef0123-4567-489a-9bcd-ef0123456789'; // an anonymous Supabase user, listed
const FORMER = 'def01234-5678-49ab-8cde-f01234567890'; // a former tester whose data was deleted, not on the list
const FORMER_OLD = 'ef012345-6789-4abc-9def-012345678901'; // the same, a device still holding a session from before the deletion
const ID = '11111111-2222-4000-8000-000000000001';

// ---------------------------------------------------------------------------------------------
// The list

describe('readPilotList and pilotRefuses (server/middleware/pilotGate.js)', () => {
  it('unset, empty or blank: off, nobody refused', () => {
    for (const env of [{}, { [PILOT_ENV]: '' }, { [PILOT_ENV]: '   ' }, { [PILOT_ENV]: '\t' }]) {
      assert.deepEqual(readPilotList(env), { on: false, ids: new Set(), ignored: [] }, JSON.stringify(env));
      for (const user of [{ id: A }, { id: B }, { id: ANON, isAnonymous: true }, {}]) assert.equal(pilotRefuses(user, env), false);
    }
  });

  it('set: comma-separated, trimmed, lower-cased; members pass (any case), everyone else is refused', () => {
    const env = { [PILOT_ENV]: ` ${A.toUpperCase()} ,${ID}` };
    assert.deepEqual(readPilotList(env), { on: true, ids: new Set([A, ID]), ignored: [] });
    assert.equal(pilotRefuses({ id: A }, env), false);
    assert.equal(pilotRefuses({ id: A.toUpperCase() }, env), false);
    assert.equal(pilotRefuses({ id: ID, isAnonymous: false }, env), false);
    assert.equal(pilotRefuses({ id: B }, env), true);
    for (const id of [undefined, null, '', 42, `${A} `, `${A},${ID}`]) assert.equal(pilotRefuses({ id }, env), true, String(id));
  });

  it('an anonymous Supabase user is refused while the list is on, even if its id were listed', () => {
    const env = { [PILOT_ENV]: `${A},${ANON}` };
    assert.equal(pilotRefuses({ id: ANON, isAnonymous: true }, env), true);
    assert.equal(pilotRefuses({ id: ANON, isAnonymous: false }, env), false);
  });

  it('fail closed: entries that are not UUIDs are ignored and counted by position; none valid refuses everyone', () => {
    assert.deepEqual(readPilotList({ [PILOT_ENV]: `${A},nope,,${B.replace(/-/g, '')},${ID}` }), { on: true, ids: new Set([A, ID]), ignored: [2, 3, 4] });
    for (const raw of ['nope', ',', `{${A}}`, `${A};${B}`, `urn:uuid:${A}`]) {
      const env = { [PILOT_ENV]: raw };
      assert.equal(readPilotList(env).on, true, raw);
      assert.equal(readPilotList(env).ids.size, 0, raw);
      for (const id of [A, B, ID]) assert.equal(pilotRefuses({ id }, env), true, `${raw} refuses ${id}`);
    }
  });

  it('PILOT_ID_RE (the preflight) is UUID_RE (the api): same source and flags, same answers on the shared fixture', () => {
    assert.equal(PILOT_ID_RE.source, UUID_RE.source);
    assert.equal(PILOT_ID_RE.flags, UUID_RE.flags);
    assert.ok(PILOT_IDS.valid.length >= 5 && PILOT_IDS.invalid.length >= 10);
    for (const value of PILOT_IDS.valid) {
      assert.equal(UUID_RE.test(value), true, value);
      assert.equal(PILOT_ID_RE.test(value), true, value);
    }
    for (const value of PILOT_IDS.invalid) {
      assert.equal(UUID_RE.test(value), false, JSON.stringify(value));
      assert.equal(PILOT_ID_RE.test(value), false, JSON.stringify(value));
    }
  });

  it('the preflight reads a list exactly as the api does (on/set, the ignored positions)', () => {
    const values = [undefined, '', '  ', A, `${A},${B}`, ` ${A} , ${B} `, `${A},`, ',', 'nope', `${A},nope,${B}`, `${A.toUpperCase()}`,
      ...PILOT_IDS.valid, ...PILOT_IDS.invalid, PILOT_IDS.valid.join(','), [...PILOT_IDS.valid, ...PILOT_IDS.invalid].join(',')];
    for (const value of values) {
      const api = readPilotList(value === undefined ? {} : { [PILOT_ENV]: value });
      const preflight = readPilotEntries(value);
      assert.equal(preflight.set, api.on, JSON.stringify(value));
      assert.deepEqual(preflight.invalid, api.ignored, JSON.stringify(value));
      assert.equal(preflight.valid + preflight.invalid.length >= api.ids.size, true);
    }
  });
});

describe('pilotStartupLines: what server.js logs at start (never an id)', () => {
  it('off, on with the count, the ignored positions, and the refuse-everyone line', () => {
    assert.deepEqual(pilotStartupLines({}), ['[Pilot] off']);
    assert.deepEqual(pilotStartupLines({ [PILOT_ENV]: ' ' }), ['[Pilot] off']);
    assert.deepEqual(pilotStartupLines({ [PILOT_ENV]: A }), ['[Pilot] on: 1 account']);
    assert.deepEqual(pilotStartupLines({ [PILOT_ENV]: `${A},${B},${A.toUpperCase()}` }), ['[Pilot] on: 2 accounts']);
    assert.deepEqual(pilotStartupLines({ [PILOT_ENV]: `${A},x,${B},,y` }), ['[Pilot] on: 2 accounts', '[Pilot] ignored: 3 entries (positions 2, 4, 5)']);
    assert.deepEqual(pilotStartupLines({ [PILOT_ENV]: 'x' }), [
      '[Pilot] on: 0 accounts',
      '[Pilot] ignored: 1 entry (position 1)',
      '[Pilot] no valid account id: every signed-in session is refused (403 pilot_only)',
    ]);
  });

  it('no line carries an id or an entry', () => {
    const text = pilotStartupLines({ [PILOT_ENV]: `${A},SENTINELX9F3SECRET,${B}` }).join('\n');
    for (const secret of [A, B, 'SENTINELX9F3', A.slice(0, 8)]) assert.ok(!text.includes(secret), secret);
  });

  it('server.js logs them in main(), next to the legal lines', () => {
    const code = read('server.js');
    const main = code.slice(code.indexOf('async function main()'));
    assert.match(code, /import \{ pilotStartupLines \} from '\.\/server\/middleware\/pilotGate\.js';/);
    assert.match(main, /for \(const line of pilotStartupLines\(process\.env\)\) console\.log\(line\);/);
    assert.ok(main.indexOf('pilotStartupLines') > main.indexOf('legalStartupWarnings'));
    assert.ok(main.indexOf('pilotStartupLines') < main.indexOf('await createApp()'));
  });
});

// ---------------------------------------------------------------------------------------------
// The three choke points on the server.js stack

const nowS = () => Math.floor(Date.now() / 1000);
/** @param {unknown} value */
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A Supabase session token (unsigned: the stand-in below does not check signatures). @param {string} sub */
const token = (sub) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
  sub, aud: 'authenticated', role: 'authenticated', iat: nowS(), exp: 4_000_000_000, amr: [{ method: 'password', timestamp: nowS() - 3600 }],
})}.c2ln`;
/** @param {string} sub */
const auth = (sub) => ({ Authorization: `Bearer ${token(sub)}` });
/** A session token that signed in at signedInAt (epoch seconds). @param {string} sub @param {number} signedInAt */
const authSignedInAt = (sub, signedInAt) => ({ Authorization: `Bearer ${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
  sub, aud: 'authenticated', role: 'authenticated', iat: nowS(), exp: 4_000_000_000, amr: [{ method: 'password', timestamp: signedInAt }],
})}.c2ln` });
const supabase = {
  auth: {
    getUser: async (/** @type {string} */ t) => {
      const id = decodeTokenClaims(t)?.sub;
      if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
      return { data: { user: { id, is_anonymous: id === ANON } }, error: null };
    },
  },
};
const BRIDGE = 'test-bridge-token-for-pilot-gate';
const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET',
  'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'LEGAL_TERMS_REQUIRED', 'LLM_GUEST_AI', 'AI_ACCESS_DEV_AUDIENCE', 'VITE_FEATURE_AGENT_CHAT',
  'KOKORO_TTS_URL', 'MEMANTO_ENABLED', PILOT_ENV];

/**
 * One request to the stack; no answer within 10 s throws (a check that a call was not refused always
 * means the stack answered).
 * @param {string} base @param {string} method @param {string} url
 * @param {{ headers?: Record<string, string>, body?: unknown }} [options]
 */
async function call(base, method, url, { headers = {}, body } = {}) {
  /** @type {RequestInit} */
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(10_000) };
  if (body !== undefined) {
    init.headers = { ...headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`${base}${url}`, init);
  } catch (error) {
    throw new Error(`${method} ${url}: no answer from the stack`, { cause: error });
  }
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json };
}

/** @param {(base: string) => Promise<void>} handler */
async function withServer(handler) {
  const app = await createApp({ serveStatic: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    await handler(`http://127.0.0.1:${/** @type {any} */ (server).address().port}`);
  } finally {
    await new Promise((resolve, reject) => /** @type {any} */ (server).close((/** @type {any} */ error) => (error ? reject(error) : resolve(undefined))));
  }
}

const VALID_PUT = { epoch: null, records: [{ courseSlug: 'vibe-coding', lessonId: 'vibe-ch1', progress: { v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z' } }] };

/** One route per kind of auth (the row names the middleware a missing check would let through). */
const ROUTES = [
  ['requireAuth mount (+ requireSignedIn)', 'GET', '/api/v2/user/achievements'],
  ['requireAuth mount (+ requireSignedIn)', 'POST', '/api/v2/user/review/grade', { courseSlug: 'vibe-coding', lessonId: 'vibe-ch1', cardId: 'c1', rating: 'good' }],
  ['requireAuth mount', 'POST', '/api/v2/user/events', { events: [] }],
  ['requireAuth mount (the sync upload, no exemption)', 'PUT', '/api/v2/user/lesson-progress', VALID_PUT],
  ['requireAuth mount', 'GET', '/api/v2/user/profile'],
  ['requireAuth mount (D-E)', 'GET', '/api/v2/admin/safety/reports'],
  ['requireAuth mount (AI)', 'POST', '/api/v2/ai/generate', { topic: 'x' }],
  ['billing per-route requireAuth', 'POST', '/api/v2/billing/checkout', {}],
  ['optionalAuth (refused, never the guest path)', 'POST', '/api/v2/llm/tutor', { question: 'x' }],
  ['requireBridgeOrAuth per route', 'GET', '/api/v2/life-journal/range?from=2026-10-01&to=2026-10-02'],
  ['requireBridgeOrAuth router-level', 'POST', '/api/v2/learner-memory', { content: 'x' }],
  ['requireBridgeOrAuth mount', 'POST', '/api/v2/agent/chat', { message: 'x' }],
  ['requireAuth catch-all', 'GET', '/api/v2/curricula'],
  ['requireAuth then optionalAuth (TTS)', 'POST', '/api/v2/tts/synthesize', { text: 'x' }],
  ['requireAuth catch-all (fail closed)', 'GET', '/api/v2/no-such-route-yet'],
];

/**
 * Routes the terms check exempts (server/middleware/termsGate.js TERMS_EXEMPT): the list exempts none. Built from
 * TERMS_EXEMPT itself (review round 1, finding 5), so a route a later phase adds there is checked here too; `:id` → ID.
 * @type {[string, string][]}
 */
const TERMS_EXEMPT_ROUTES = TERMS_EXEMPT.map(({ method, path: route }) => /** @type {[string, string]} */ ([method, route.replace(/:[A-Za-z]+/g, ID)]));

describe('the pilot list on the server.js stack (requireAuth, optionalAuth, requireBridgeOrAuth)', () => {
  /** @type {Record<string, string | undefined>} */
  const saved = {};
  /** @type {ReturnType<typeof createLegalPool>} */
  let pool;
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  /** Statements that name an account id (any parameter, any case). @param {string} id */
  const statementsFor = (id) => pool.queries.filter((q) => q.params.some((p) => typeof p === 'string' && p.toLowerCase() === id));
  /** The same, without the read-only tombstone lookup of refusePilotSession (final review, finding 19). @param {string} id */
  const writesFor = (id) => statementsFor(id).filter((q) => q.sql !== LEGAL_POOL_SQL.tombstone);

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'development';
    process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE;
    process.env.KOKORO_TTS_URL = 'http://127.0.0.1:9';
    process.env[PILOT_ENV] = `${A},${ANON}`;
    // FORMER deleted their account (data deleted with scripts/delete-account-data.mjs) and signs in again.
    pool = createLegalPool({ tombstones: {
      [FORMER]: { deletedAt: new Date(Date.now() - 86_400_000) },
      [FORMER_OLD]: { deletedAt: new Date(Date.now() - 86_400_000) },
    } });
    setPoolForTests(pool);
    setSupabaseForTests(supabase);
    for (const id of [A, B, ANON, FORMER, FORMER_OLD]) invalidateTermsAcceptance(id);
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    Object.assign(console, quiet);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    setSupabaseForTests(null);
    resetPoolForTests();
  });

  it('a session not on the list: 403 pilot_only on one route per kind of auth, and nothing written for it (no stub)', async () => {
    await withServer(async (base) => {
      for (const [kind, method, url, body] of ROUTES) {
        const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: auth(B), body });
        assert.deepEqual([res.status, res.json], [403, { ...PILOT_ONLY_REFUSAL }], `${kind}: ${method} ${url}`);
      }
    });
    assert.deepEqual(writesFor(B), [], 'no account-state write (re-open) and no auth.users stub for a refused id');
    assert.equal(pool.connects, 0, 'no transaction was started');
    assert.equal(pool.state.stubs.has(B), false);
  });

  it('no exempt route: every route the terms check exempts refuses a non-member too (PUT /user/lesson-progress included)', async () => {
    assert.ok(TERMS_EXEMPT_ROUTES.length >= 28 && TERMS_EXEMPT_ROUTES.length === TERMS_EXEMPT.length, `${TERMS_EXEMPT_ROUTES.length} routes`);
    assert.ok(TERMS_EXEMPT_ROUTES.some(([method, url]) => method === 'PUT' && url === '/api/v2/user/lesson-progress'));
    assert.ok(TERMS_EXEMPT_ROUTES.some(([, url]) => url === `/api/v2/user/connected-apps/${ID}/revoke`), 'a :id route gets a real id');
    assert.ok(TERMS_EXEMPT_ROUTES.every(([, url]) => !url.includes(':')), 'no route parameter left');
    await withServer(async (base) => {
      for (const [method, url] of TERMS_EXEMPT_ROUTES) {
        const body = method === 'GET' || method === 'DELETE' ? undefined : (url.endsWith('/lesson-progress') ? VALID_PUT : {});
        const res = await call(base, method, url, { headers: auth(B), body });
        assert.deepEqual([res.status, res.json?.error_type], [403, 'pilot_only'], `${method} ${url}`);
      }
    });
    assert.deepEqual(writesFor(B), []);
  });

  it('a member passes every route (any other answer is fine) and gets its stub as before; an upper-case listing matches', async () => {
    process.env[PILOT_ENV] = ` ${A.toUpperCase()} , ${ANON}`;
    await withServer(async (base) => {
      for (const [kind, method, url, body] of ROUTES) {
        const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: auth(A), body });
        assert.notEqual(res.json?.error_type, 'pilot_only', `${kind}: ${method} ${url} (${res.status})`);
      }
    });
    assert.ok(pool.queries.some((q) => q.sql === LEGAL_POOL_SQL.stubInsert && q.params[0] === A), 'the member\'s auth.users stub');
  });

  it('an anonymous Supabase session is refused (its id is even on the list), on every kind of auth', async () => {
    await withServer(async (base) => {
      for (const [kind, method, url, body] of ROUTES) {
        const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: auth(ANON), body });
        assert.deepEqual([res.status, res.json?.error_type], [403, 'pilot_only'], `anonymous ${kind}: ${method} ${url}`);
      }
    });
    assert.deepEqual(writesFor(ANON), []);
  });

  it('a former tester whose data was deleted, off the list, signs in again: refused before the account check (no re-open, no stub)', async () => {
    await withServer(async (base) => {
      for (const [, method, url, body] of [ROUTES[0], ROUTES[8], ROUTES[9]]) {
        const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: auth(FORMER), body });
        assert.deepEqual([res.status, res.json?.error_type], [403, 'pilot_only'], `${method} ${url}`);
      }
    });
    // Only the read-only tombstone lookup of requireAuth and requireBridgeOrAuth (refusePilotSession).
    assert.deepEqual([...new Set(statementsFor(FORMER).map((q) => q.sql))], [LEGAL_POOL_SQL.tombstone], 'no write, no re-open, no stub');
    assert.equal(pool.state.tombstones.get(FORMER)?.reopened_at, null);
    assert.equal(pool.connects, 0, 'no transaction was started');
  });

  // Final review, finding 19: the owner takes a tester off the list, deploys, then staff delete their data
  // (runbook 10.4 step 6). A device still holding the tester's old session must hear 401 account_deleted,
  // as without the list, so the app forgets the account there and signs out (Phase 4 §5.11).
  it('a former tester\'s session from before the deletion, off the list: 401 account_deleted (requireAuth, requireBridgeOrAuth), read only', async () => {
    const before = nowS() - 2 * 86_400;
    await withServer(async (base) => {
      for (const [, method, url, body] of [ROUTES[0], ROUTES[3], ROUTES[9], ROUTES[10]]) {
        const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: authSignedInAt(FORMER_OLD, before), body });
        assert.deepEqual([res.status, res.json?.error_type], [401, 'account_deleted'], `${method} ${url}`);
      }
      // optionalAuth keeps the plain 403 (it never answered 401 account_deleted).
      const [, method, url, body] = ROUTES[8];
      const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: authSignedInAt(FORMER_OLD, before), body });
      assert.deepEqual([res.status, res.json?.error_type], [403, 'pilot_only']);
      // The same account, signed in after the deletion: still 403 pilot_only (never the deleted page in a loop).
      const fresh = await call(base, 'GET', '/api/v2/user/achievements', { headers: auth(FORMER_OLD) });
      assert.deepEqual([fresh.status, fresh.json?.error_type], [403, 'pilot_only']);
    });
    assert.deepEqual([...new Set(statementsFor(FORMER_OLD).map((q) => q.sql))], [LEGAL_POOL_SQL.tombstone], 'only the tombstone read: no write, no re-open, no stub');
    assert.equal(pool.state.tombstones.get(FORMER_OLD)?.reopened_at, null);
    assert.equal(pool.connects, 0, 'no transaction was started');
  });

  it('a database error during that lookup answers 403 pilot_only (fail closed, nothing written)', async () => {
    const failing = createLegalPool({ tombstones: { [FORMER_OLD]: { deletedAt: new Date(Date.now() - 86_400_000) } } });
    failing.onStatement('tombstone', () => { throw new Error('db down'); });
    setPoolForTests(failing);
    await withServer(async (base) => {
      const res = await call(base, 'GET', '/api/v2/user/achievements', { headers: authSignedInAt(FORMER_OLD, nowS() - 2 * 86_400) });
      assert.deepEqual([res.status, res.json?.error_type], [403, 'pilot_only']);
    });
    assert.equal(failing.connects, 0);
  });

  it('fail closed: a list with no valid id refuses every session', async () => {
    for (const value of ['not-an-id', ',', `{${A}}`]) {
      process.env[PILOT_ENV] = value;
      await withServer(async (base) => {
        for (const [, method, url, body] of [ROUTES[0], ROUTES[8], ROUTES[10]]) {
          const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: auth(A), body });
          assert.deepEqual([res.status, res.json?.error_type], [403, 'pilot_only'], `${value}: ${method} ${url}`);
        }
      });
    }
    assert.deepEqual(writesFor(A), []);
  });

  it('never checked: the bridge token, the dev fallback and guests, while the list is on', async () => {
    await withServer(async (base) => {
      const bridge = await call(base, 'GET', '/api/v2/life-journal/range?from=2026-10-01&to=2026-10-02', { headers: { 'x-nexloom-bridge-token': BRIDGE } });
      assert.notEqual(bridge.json?.error_type, 'pilot_only');
      const bridgeMemory = await call(base, 'POST', '/api/v2/learner-memory', { headers: { 'x-nexloom-bridge-token': BRIDGE }, body: { content: 'x' } });
      assert.notEqual(bridgeMemory.json?.error_type, 'pilot_only');
      const bridgeBearer = await call(base, 'POST', '/api/v2/agent/chat', { headers: { Authorization: `Bearer ${BRIDGE}` }, body: { message: 'x' } });
      assert.notEqual(bridgeBearer.json?.error_type, 'pilot_only');
      const dev = await call(base, 'GET', '/api/v2/curricula');
      assert.notEqual(dev.json?.error_type, 'pilot_only', 'the dev fallback (development, no token)');
      const guest = await call(base, 'POST', '/api/v2/llm/tutor', { body: { question: 'x' } });
      assert.notEqual(guest.json?.error_type, 'pilot_only', 'a guest on optionalAuth');
    });
  });

  it('off (unset, empty, blank): no session is refused (today\'s behaviour)', async () => {
    for (const value of [undefined, '', '  ']) {
      if (value === undefined) delete process.env[PILOT_ENV];
      else process.env[PILOT_ENV] = value;
      await withServer(async (base) => {
        for (const who of [A, B, ANON]) {
          for (const [kind, method, url, body] of ROUTES) {
            const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (url), { headers: auth(who), body });
            assert.notEqual(res.json?.error_type, 'pilot_only', `${String(value)} ${who} ${kind}: ${method} ${url}`);
          }
        }
      });
    }
  });

  it('the list is read on every request (the api restarts on each deploy; tests change it under the app)', async () => {
    await withServer(async (base) => {
      const before = await call(base, 'GET', '/api/v2/user/achievements', { headers: auth(B) });
      assert.equal(before.json?.error_type, 'pilot_only');
      process.env[PILOT_ENV] = `${A},${B}`;
      const after = await call(base, 'GET', '/api/v2/user/achievements', { headers: auth(B) });
      assert.notEqual(after.json?.error_type, 'pilot_only');
    });
  });
});

describe('where the three middlewares ask the list (static)', () => {
  it('right after Supabase named the user and before the account check, in requireAuth, optionalAuth and requireBridgeOrAuth', () => {
    const authCode = read('server/middleware/auth.js');
    const bridgeCode = read('server/middleware/bridgeAuth.js');
    // requireAuth and requireBridgeOrAuth answer through refusePilotSession (read only: 401 account_deleted for
    // a session older than the deletion, else 403); optionalAuth with the plain 403 (final review, finding 19).
    const check = /if \(pilotRefuses\(\{ id: (?:data\.user|user)\.id, isAnonymous: (?:data\.user|user)\.is_anonymous === true \}\)\) return (?:res\.status\(403\)\.json\(PILOT_ONLY_REFUSAL\)|refusePilotSession\(res, token, (?:data\.user|user)\.id\));/g;
    for (const [name, body] of [
      ['requireAuth', authCode.slice(authCode.indexOf('export const requireAuth'), authCode.indexOf('export const optionalAuth'))],
      ['optionalAuth', authCode.slice(authCode.indexOf('export const optionalAuth'))],
      ['requireBridgeOrAuth', bridgeCode.slice(bridgeCode.indexOf('export const requireBridgeOrAuth'))],
    ]) {
      const found = [...body.matchAll(check)];
      const at = found.map((m) => m.index);
      assert.equal(at.length, 1, `${name}: one pilot check`);
      assert.equal(found[0][0].includes('refusePilotSession('), name !== 'optionalAuth', `${name}: the answer`);
      const pilot = /** @type {number} */ (at[0]);
      assert.ok(pilot > body.indexOf('getUserOnce('), `${name}: after Supabase named the user`);
      assert.ok(pilot < body.indexOf('readSessionAccountStateOnce('), `${name}: before the account check (no re-open)`);
      // The session's stub write: the last one in requireAuth/optionalAuth (the dev fallbacks' come before
      // getUserOnce), authorizeRequest with the Supabase user in requireBridgeOrAuth.
      const stub = name === 'requireBridgeOrAuth' ? body.indexOf("authMethod: 'supabase-jwt'") : body.lastIndexOf('syncAuthUserStubOnce(req, req.userId)');
      assert.ok(stub > 0 && pilot < stub, `${name}: before the stub write`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The app: apiFetch notes 403 pilot_only, App.tsx shows the full-page notice

const CLIENT_STUBS = {
  react: `
    export const useEffect = () => {};
    export const useRef = (value) => ({ current: value ?? null });
    let ids = 0;
    export const useId = () => ':p' + (ids += 1) + ':';
    export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
    export default { useEffect, useRef, useId, useState };
  `,
  'react/jsx-runtime': "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });",
  ui: "export const Button = 'Button'; export const PublicPageShell = 'PublicPageShell'; export const SupportContact = 'SupportContact'; export default 'Button';",
  supabase: `
    export const getSupabaseClient = () => globalThis.__main ?? null;
    export const isSupabaseConfigured = () => true;
  `,
  deletion: 'export const reportAccountDeleted = () => { globalThis.__deleted = (globalThis.__deleted ?? 0) + 1; };',
};

describe('the app: the pilot_only notice', () => {
  /** @type {any} */
  let mod;
  before(async () => {
    const result = await build({
      stdin: {
        contents: [
          "export { PilotOnlyBody, default as PilotOnlyView } from './components/common/PilotOnlyView';",
          "export * from './services/pilotAccess';",
          "export { apiFetch } from './services/apiClient';",
        ].join('\n'),
        resolveDir: ROOT,
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'import.meta.env': JSON.stringify({ PROD: true }) },
      plugins: [{
        name: 'stubs',
        setup(b) {
          const stub = (/** @type {RegExp} */ filter, /** @type {string} */ name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
          stub(/^react$/, 'react');
          stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
          stub(/context\/LanguageContext$/, 'language');
          stub(/ui\/(Button|PublicPageShell|SupportContact)$/, 'ui');
          stub(/supabaseClient$/, 'supabase');
          stub(/accountDeletionState$/, 'deletion');
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: /** @type {Record<string, string>} */ (CLIENT_STUBS)[args.path], loader: 'js', resolveDir: ROOT }));
        },
      }],
      logLevel: 'silent',
    });
    mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  });

  /** @param {any} node @param {any[]} [out] @returns {any[]} */
  const walk = (node, out = []) => {
    if (Array.isArray(node)) for (const child of node) walk(child, out);
    else if (node && typeof node === 'object' && 'type' in node) {
      if (typeof node.type === 'function') return walk(node.type(node.props ?? {}), out);
      out.push({ el: node });
      walk(node.props?.children, out);
    } else if (typeof node === 'string') out.push({ text: node });
    return out;
  };
  /** @param {any[]} tokens */
  const textOf = (tokens) => tokens.filter((t) => 'text' in t).map((t) => t.text).join('');

  it('says what happened and offers sign-out, in jp and en; the heading is focusable (tabIndex -1)', () => {
    for (const [language, title, body, signOut] of [
      ['jp', 'このアカウントは、いまの試験運用の対象ではありません', 'Rise Path は、いまは試験運用に参加している方だけが使えます。ログアウトするか、担当者にお問い合わせください。', 'ログアウト'],
      ['en', 'This account is not part of the current trial', 'For now, Rise Path is open only to the people taking part in the trial. Sign out, or contact the Rise Path team.', 'Sign out'],
    ]) {
      let signedOut = 0;
      const tokens = walk(mod.PilotOnlyBody({ language, onSignOut: () => { signedOut += 1; }, titleId: 't1' }));
      const els = tokens.filter((t) => 'el' in t).map((t) => t.el);
      const h1 = els.find((el) => el.type === 'h1');
      assert.equal(textOf(walk(h1.props.children)), title, language);
      assert.equal(h1.props.tabIndex, -1);
      assert.equal(h1.props.id, 't1');
      assert.ok(els.some((el) => el.type === 'section' && el.props['aria-labelledby'] === 't1'));
      assert.ok(textOf(tokens).includes(body), language);
      // Rehearsal item 26: no VITE_SUPPORT_CONTACT (this bundle has none) → no contact line, so no second contact
      // (SupportContact's fallback names the learning site's staff, which does not fit Nexloom and P-School accounts).
      assert.ok(!els.some((el) => el.type === 'SupportContact'), 'no contact line while VITE_SUPPORT_CONTACT is unset');
      const button = els.find((el) => el.type === 'Button');
      assert.equal(textOf(walk(button.props.children)), signOut);
      button.props.onClick();
      assert.equal(signedOut, 1);
    }
  });

  it('shows the contact line with the channel set as VITE_SUPPORT_CONTACT, and only then (rehearsal item 26)', () => {
    const contact = { href: 'mailto:help@example.org', label: 'help@example.org', kind: 'mail' };
    const els = walk(mod.PilotOnlyBody({ language: 'jp', onSignOut() {}, contact })).filter((t) => 'el' in t).map((t) => t.el);
    const line = els.filter((el) => el.type === 'SupportContact');
    assert.equal(line.length, 1);
    assert.deepEqual(line[0].props.contact, contact);
    for (const none of [null, undefined]) {
      const without = walk(mod.PilotOnlyBody({ language: 'en', onSignOut() {}, contact: none })).filter((t) => 'el' in t);
      assert.ok(!without.some((t) => t.el.type === 'SupportContact'), String(none));
    }
  });

  it('a page, not a dialog: focus on the heading at mount, no Escape handler; design tokens only', () => {
    const code = read('components/common/PilotOnlyView.tsx');
    assert.match(code, /useEffect\(\(\) => \{\s*\n\s*titleRef\.current\?\.focus\(\);\s*\n\s*\}, \[\]\);/);
    assert.doesNotMatch(code, /Escape|onKeyDown|keydown|role="dialog"/);
    assert.doesNotMatch(code, /\[#|rounded-\[|text-\[(?:9|10|11)px\]|text-slate-400/);
    const view = walk(mod.PilotOnlyView({ onSignOut() {} }));
    assert.equal(view[0].el.type, 'PublicPageShell');
  });

  it('bearerSubject: the sub of a Bearer JWT, else null', () => {
    assert.equal(mod.bearerSubject(`Bearer ${token(A)}`), A);
    assert.equal(mod.bearerSubject(`bearer ${token(B)}`), B);
    for (const value of [undefined, null, '', 'Bearer', 'Bearer x', 'Bearer a.b.c', `Basic ${token(A)}`, `Bearer ${b64({ alg: 'x' })}.${b64({ sub: 7 })}.s`]) {
      assert.equal(mod.bearerSubject(value), null, String(value));
    }
  });

  it('apiFetch: a 403 pilot_only reports the token\'s user; terms_required, other 403s, 401 and non-JSON do not; the response is unchanged', async () => {
    const realFetch = globalThis.fetch;
    /** @type {{ status: number, body: string }} */
    let answer = { status: 200, body: '{}' };
    globalThis.fetch = /** @type {any} */ (async () => new Response(answer.body, { status: answer.status, headers: { 'content-type': 'application/json' } }));
    globalThis.__main = { auth: { getSession: async () => ({ data: { session: { access_token: token(B) } } }) } };
    try {
      mod.resetPilotRefusalForTests();
      for (const [status, body] of [[403, '{"error_type":"terms_required"}'], [403, '{"error":"Forbidden"}'], [401, '{"error_type":"pilot_only"}'], [403, '<html>proxy</html>'], [200, '{"error_type":"pilot_only"}']]) {
        answer = { status: Number(status), body: String(body) };
        const res = await mod.apiFetch('/user/profile');
        assert.equal(res.status, status);
        assert.equal(mod.pilotRefusedUserId(), null, `${status} ${body}`);
      }
      let heard = 0;
      const stop = mod.subscribePilotRefusal(() => { heard += 1; });
      answer = { status: 403, body: JSON.stringify(PILOT_ONLY_REFUSAL) };
      const res = await mod.apiFetch('/user/profile');
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ...PILOT_ONLY_REFUSAL }, 'callers still read the body');
      assert.equal(mod.pilotRefusedUserId(), B);
      await mod.apiFetch('/user/achievements');
      assert.equal(heard, 1, 'one notice per refused user');
      stop();
      // A caller's own Authorization (the page-hide upload) names the user too.
      mod.resetPilotRefusalForTests();
      await mod.apiFetch('/user/lesson-progress', { method: 'PUT', headers: { Authorization: `Bearer ${token(ANON)}` } });
      assert.equal(mod.pilotRefusedUserId(), ANON);
    } finally {
      globalThis.fetch = realFetch;
      delete globalThis.__main;
      mod.resetPilotRefusalForTests();
    }
  });

  it('forgetPilotRefusal: the refusal goes (listeners hear it once); nothing to forget is silent', () => {
    mod.resetPilotRefusalForTests();
    let heard = 0;
    const stop = mod.subscribePilotRefusal(() => { heard += 1; });
    try {
      mod.forgetPilotRefusal();
      assert.equal(heard, 0, 'nothing refused: no notice');
      mod.reportPilotOnly(B);
      assert.equal(mod.pilotRefusedUserId(), B);
      mod.forgetPilotRefusal();
      assert.equal(mod.pilotRefusedUserId(), null);
      assert.equal(heard, 2, 'the refusal, then its end');
      // The same account refused again after signing in again: the notice comes back.
      mod.reportPilotOnly(B);
      assert.equal(mod.pilotRefusedUserId(), B);
    } finally {
      stop();
      mod.resetPilotRefusalForTests();
    }
  });

  it('App.tsx forgets the refusal once nobody (or a guest) is signed in, so a later sign-in on the page asks the server again', () => {
    const code = read('App.tsx');
    assert.match(code, /useEffect\(\(\) => \{\s*\n\s*if \(!isLoggedIn \|\| user\?\.isGuest\) forgetPilotRefusal\(\);\s*\n\s*\}, \[isLoggedIn, user\?\.isGuest\]\);/);
  });

  it('App.tsx shows the notice for the refused signed-in user, before every other branch but the loading screen', () => {
    const code = read('App.tsx');
    assert.match(code, /const pilotRefused = useSyncExternalStore\(subscribePilotRefusal, pilotRefusedUserId, \(\) => null\);/);
    assert.match(code, /const pilotOnly = isLoggedIn && !user\?\.isGuest && pilotRefused !== null && pilotRefused === user\?\.id;/);
    const ret = code.slice(code.indexOf('{authLoading ? ('));
    const notice = ret.indexOf(') : pilotOnly ? (\n        <PilotOnlyView onSignOut={handlePilotSignOut} />');
    assert.ok(notice > 0, 'the branch');
    assert.ok(notice < ret.indexOf("legal.status === 'needed'"), 'before the consent page');
    assert.ok(notice < ret.indexOf('consentPath ?'), 'before the AI-app consent page');
  });

  // Final review, finding 2: everyone the page refuses is an account of Nexloom or P-School on the shared
  // project; its sign-out must end only this browser's session (auth-js scope 'local'), never theirs elsewhere.
  it('App.tsx: the page\'s sign-out is the logout with scope \'local\' (handlePilotSignOut), not the app-wide handleLogout', () => {
    const code = read('App.tsx');
    const fn = code.slice(code.indexOf('const handlePilotSignOut = () => {'));
    assert.ok(code.includes('const handlePilotSignOut = () => {'), 'the handler');
    assert.match(fn.slice(0, fn.indexOf('\n  };')), /^const handlePilotSignOut = \(\) => \{\s*\n\s*logout\(\{ scope: 'local' \}\)\s*\.then\(\(done\) => \{ if \(done !== false\) navigate\('\/', \{ replace: true \}\); \}\)/);
    assert.doesNotMatch(code, /<PilotOnlyView onSignOut=\{handleLogout\}/);
  });
});

describe('AuthContext.logout: the sign-out scope (bundled; final review, finding 2)', () => {
  /** @type {any} */
  let authMod;
  const STUBS = {
    react: `
      export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
      export const useEffect = () => {};
      export const useCallback = (fn) => fn;
      export const createContext = () => ({ Provider: 'Provider' });
      export const useContext = () => null;
      export default { useState, useEffect, useCallback, createContext, useContext };
    `,
    'react/jsx-runtime': "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
    supabase: `
      export const getSupabaseClient = () => globalThis.__main ?? null;
      export const getNexloomSupabaseClient = () => globalThis.__nexloom ?? null;
      export const isSupabaseConfigured = () => true;
      export const createReauthClient = () => null;
    `,
    quiet: `
      export const hydrateFromApi = async () => {}; export const hydrateNotifications = async () => {};
      export const clearUserProfileCache = () => {}; export const clearSharedDeviceAiData = () => {};
      export const forgetDeletedAccountOnDevice = () => {}; export const signOutThisBrowser = async () => {};
      export const apiPut = async () => ({}); export const setAuthProvider = () => {};
      export const forgetProgressAccount = () => {}; export const progressChoicePending = () => false;
      export const signInProgressSync = () => {}; export const signOutProgressSync = async () => {};
      export const stopProgressSync = () => {}; export const whenAccountKnown = async () => 'known';
      export const syncedLearnerId = () => null;
      export const confirmUnsavedLearning = async () => true; export const endUnsavedLearningQuestion = () => {};
    `,
  };
  before(async () => {
    const result = await build({
      stdin: { contents: "export { AuthProvider } from './context/AuthContext';", resolveDir: ROOT, loader: 'tsx' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'import.meta.env': JSON.stringify({ PROD: true }) },
      plugins: [{
        name: 'stubs',
        setup(b) {
          const stub = (/** @type {RegExp} */ filter, /** @type {string} */ name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
          stub(/^react$/, 'react');
          stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
          stub(/supabaseClient$/, 'supabase');
          stub(/services\/(progressService|notificationService|userProfileService|sharedDeviceData|accountDeviceData|apiClient)$/, 'quiet');
          stub(/lesson\/progressSyncClient$/, 'quiet');
          stub(/lesson\/logoutGuard$/, 'quiet');
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: /** @type {Record<string, string>} */ (STUBS)[args.path], loader: 'js', resolveDir: ROOT }));
        },
      }],
      logLevel: 'silent',
    });
    authMod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  });

  /** @param {(logout: (options?: object) => Promise<boolean>) => Promise<void>} run */
  async function withClients(run) {
    /** @type {{ client: string, args: unknown[] }[]} */
    const calls = [];
    const client = (/** @type {string} */ name) => ({ auth: { signOut: async (/** @type {unknown[]} */ ...args) => { calls.push({ client: name, args }); return { error: null }; } } });
    const g = /** @type {any} */ (globalThis);
    g.__main = client('primary');
    g.__nexloom = client('nexloom');
    g.localStorage = { removeItem() {}, getItem: () => null, setItem() {} };
    try {
      const { logout } = authMod.AuthProvider({ children: null }).props.value;
      await run(logout);
    } finally {
      delete g.__main;
      delete g.__nexloom;
      delete g.localStorage;
    }
    return calls;
  }

  it('scope \'local\': both clients sign out with { scope: \'local\' } (never the global default)', async () => {
    const calls = await withClients(async (logout) => { assert.equal(await logout({ scope: 'local' }), true); });
    assert.deepEqual(calls.map((c) => c.client).sort(), ['nexloom', 'primary']);
    for (const call of calls) assert.deepEqual(call.args, [{ scope: 'local' }], call.client);
  });

  it('no options (the app-wide logout): unchanged, auth-js\'s own default', async () => {
    const calls = await withClients(async (logout) => { assert.equal(await logout(), true); });
    assert.equal(calls.length, 2);
    for (const call of calls) assert.equal(call.args[0], undefined, call.client);
    const reauth = await withClients(async (logout) => { assert.equal(await logout({ reason: 'reauth' }), true); });
    assert.equal(reauth.length, 2);
    for (const call of reauth) assert.equal(call.args[0], undefined, call.client);
  });
});

// ---------------------------------------------------------------------------------------------
// The operator's documents (Phase 9 stage 3, completeness pass)

describe('the VM documents name the list', () => {
  it('deploy/risepath-vm/README.md: a stack.env row for PILOT_ACCOUNT_IDS that says what it refuses, how it fails, what it logs and where the steps are', () => {
    const readme = read('deploy/risepath-vm/README.md');
    const lines = readme.split('\n');
    const row = lines.find((line) => line.startsWith('| `PILOT_ACCOUNT_IDS` |'));
    assert.ok(row, 'the README env table has the row');
    // In the stack.env table, after the terms switch (the other D1-era switch the api reads).
    assert.ok(lines.indexOf(row) > lines.findIndex((line) => line.startsWith('| `LEGAL_TERMS_REQUIRED` |')));
    assert.ok(row.includes(`\`403 ${PILOT_ONLY_REFUSAL.error_type}\``), '403 pilot_only');
    assert.match(row, /匿名のログインも/);
    assert.match(row, /例外がなく/, 'no exempt route (TR6)');
    assert.match(row, /ひとつも ID がないと全員を断ります（事前チェックの V2 がデプロイを止めます）/, 'fail closed, and V2');
    assert.match(row, /`byoa` を使いません（V4）/);
    // Review round 1, finding 4: the SSE MCP on :3100 takes a learner's Supabase token without the list; only the network keeps it closed.
    assert.match(row, /Tailscale の中の MCP（`mcp`、3100）も、学習者のログインを名簿で確かめません。3100 は、Tailscale の ACL で名前を決めた管理者だけに開け、GCP のファイアウォールでは開けません（手順書 3\.4・4\.3）/);
    // The log line it quotes is the one server.js prints.
    const quoted = /`(\[Pilot\] on: N accounts)`/.exec(row);
    assert.ok(quoted, 'the startup line');
    assert.match(pilotStartupLines({ [PILOT_ENV]: `${A},${B}` })[0], new RegExp(`^${quoted[1].replace(/[[\]]/g, '\\$&').replace('N', '\\d+')}$`));
    assert.match(row, /手順書 10\.1〜10\.4（\[`doc\/guides\/first-launch\.ja\.md`\]\(\.\.\/\.\.\/doc\/guides\/first-launch\.ja\.md\)）/);
    assert.match(row, /この行を消します（手順書 11\.8）/);
    // The quoted page title is the app's.
    const view = read('components/common/PilotOnlyView.tsx');
    const title = /jp: \{\s*\n\s*title: '([^']+)'/.exec(view);
    assert.ok(title && row.includes(`「${title[1]}」`), 'the notice title as the app shows it');
  });

  it('stack.env.example documents the key (commented) with the same behaviour', () => {
    const example = read('deploy/risepath-vm/stack.env.example');
    const block = example.slice(example.indexOf('# --- Pilot list (Phase 9'), example.indexOf('# PILOT_ACCOUNT_IDS=') + '# PILOT_ACCOUNT_IDS='.length);
    assert.ok(block.startsWith('# --- Pilot list'), 'the block');
    const text = block.split('\n').map((line) => line.replace(/^#\s?/, '')).join(' ');
    assert.match(text, /Unset or empty = off\. Set = on/);
    assert.match(text, /an anonymous one included, gets 403 pilot_only/);
    assert.match(text, /set with no valid id refuses everyone/);
    assert.match(text, /\(V2\)/);
    assert.match(text, /"\[Pilot\] on: N accounts"/);
    assert.ok(!/^PILOT_ACCOUNT_IDS=/m.test(example), 'off in the template (the line stays commented)');
  });
});
