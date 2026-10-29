// One check of a learner's session per request (server/middleware/auth.js). Several guards can run
// on one request: server.js mounts requireAuth on /image, /upload and /rag and again in front of the
// content routes, and optionalAuth in front of the TTS routes. Each guard asked Supabase, read the
// account state and wrote the auth.users stub again. Now the guards of one request share those
// answers, and each still decides as before. The bridge token is compared in constant time
// (tools/core/sameSecret.js) in bridgeAuth.js and in the SSE MCP resolver.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createApp } from '../../server.js';
import { optionalAuth, requireAuth, setSupabaseForTests, extractBearerToken } from '../middleware/auth.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import { PHASE1_USER_ID, resetPoolForTests, setPoolForTests } from '../db.js';
import { createSseUserResolver } from '../../mcp-server/sseUserAuth.js';
import { readAccountState } from '../../tools/core/accountDeletions.js';
import { decodeTokenClaims, isOAuthClientToken, sessionAuthTime } from '../../tools/core/oauthToken.js';
import { sameSecret } from '../../tools/core/sameSecret.js';
import { createAccountDeletionPool } from './helpers/accountDeletionPool.js';

const LEARNER = 'aaaaaaaa-0000-4000-8000-00000000000a';
const BRIDGE_TOKEN = 'test-bridge-token-for-auth-once';
const DELETED_AT = new Date('2026-10-01T00:00:00Z');
const DELETED_S = DELETED_AT.getTime() / 1000;
const REOPENED_AT = new Date('2026-10-01T00:10:00.500Z');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/**
 * A learner session token as Supabase issues it (unsigned: the stand-in does not check).
 * signedIn: when the learner signed in (seconds); by default before DELETED_AT.
 */
const session = (sub, signedIn = DELETED_S - 86_400) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
    sub,
    aud: 'authenticated',
    role: 'authenticated',
    iat: signedIn,
    exp: 4_000_000_000,
    amr: [{ method: 'password', timestamp: signedIn }],
})}.c2ln`;

/**
 * Supabase as the api sees it: getUser names the token's sub. mode 'refuse' rejects every token,
 * 'throw' fails like an unreachable auth server.
 */
const supabase = {
    calls: 0,
    mode: 'accept',
    auth: {
        getUser: async (token) => {
            supabase.calls += 1;
            if (supabase.mode === 'throw') throw new Error('fetch failed (auth server unreachable)');
            const sub = decodeTokenClaims(token)?.sub;
            if (supabase.mode === 'refuse' || typeof sub !== 'string') return { data: { user: null }, error: { message: 'invalid JWT' } };
            return { data: { user: { id: sub } }, error: null };
        },
    },
};

const accountReads = (pool) => pool.state.queries.filter((q) => q.sql.startsWith('select deleted_at, reopened_at from account_deletions')).length;
const stubInserts = (pool) => pool.state.queries.filter((q) => q.sql.startsWith('insert into auth.users')).length;
const checks = (pool) => ({ getUser: supabase.calls, accountReads: accountReads(pool), stubInserts: stubInserts(pool) });
const ONE_CHECK = { getUser: 1, accountReads: 1, stubInserts: 1 };

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'TRUST_PROXY',
    'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'HERMES_API_KEY', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI'];

const listen = async (app, handler) => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        await handler(async (path, { token, method = 'GET', body, headers = {} } = {}) => {
            const response = await fetch(`${base}${path}`, {
                method,
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
                    ...headers,
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            const text = await response.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* not JSON */ }
            return { status: response.status, json };
        });
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

/** A small app: the given guards in a row, then the request's auth fields. */
const guardedApp = (...guards) => {
    const app = express();
    app.get('/guarded', ...guards, (req, res) => res.json({
        userId: req.userId ?? null,
        authMethod: req.authMethod,
        accountGeneration: req.accountGeneration === undefined ? 'unset' : req.accountGeneration,
    }));
    return app;
};

const useEnv = (mode) => {
    const saved = {};
    let warn;
    let error;
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = mode;
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        supabase.calls = 0;
        supabase.mode = 'accept';
        setSupabaseForTests(supabase);
        warn = console.warn;
        error = console.error;
        console.warn = () => {};
        console.error = () => {};
    });
    afterEach(() => {
        console.warn = warn;
        console.error = error;
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });
};

describe('server.js: the guards of one request check the session once (production)', () => {
    useEnv('production');

    it('POST /rag/index (requireAuth on its own mount, then again before the content routes): one getUser, account read and stub write', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        await listen(await createApp({ serveStatic: false }), async (request) => {
            const response = await request('/api/v2/rag/index', { method: 'POST', token: session(LEARNER), body: {} });
            // The stand-in pool keeps no usage rows, so the route's embeddings cap answers: the
            // request passed both guards.
            assert.equal(response.status, 429);
            assert.equal(response.json?.error_type, 'daily_limit_reached');
            assert.deepEqual(checks(pool), ONE_CHECK);
        });
    });

    it('POST /tts/synthesize (requireAuth before the content routes, then optionalAuth): one check, and the route ran', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        await listen(await createApp({ serveStatic: false }), async (request) => {
            const response = await request('/api/v2/tts/synthesize', { method: 'POST', token: session(LEARNER), body: {} });
            assert.equal(response.status, 400, 'the TTS route answered (no text)');
            assert.equal(response.json?.error_type, 'validation');
            assert.deepEqual(checks(pool), ONE_CHECK);
        });
    });

    it('nothing is reused across requests: each request checks once, so a revoked session is refused on the next one', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        await listen(await createApp({ serveStatic: false }), async (request) => {
            const synthesize = () => request('/api/v2/tts/synthesize', { method: 'POST', token: session(LEARNER), body: {} });
            assert.equal((await synthesize()).status, 400);
            assert.equal((await synthesize()).status, 400);
            assert.deepEqual(checks(pool), { getUser: 2, accountReads: 2, stubInserts: 2 });
            supabase.mode = 'refuse';
            const refused = await synthesize();
            assert.equal(refused.status, 401);
            assert.deepEqual(refused.json, { error: 'Invalid or expired token' });
            assert.equal(supabase.calls, 3);
        });
    });

    it('a guest still gets 401 from the TTS routes, the health probe too: the app shows voice as unavailable to guests', async () => {
        setPoolForTests(createAccountDeletionPool());
        await listen(await createApp({ serveStatic: false }), async (request) => {
            assert.equal((await request('/api/v2/tts/health')).status, 401);
            assert.equal((await request('/api/v2/tts/synthesize', { method: 'POST', body: { text: 'こんにちは' } })).status, 401);
            assert.equal(supabase.calls, 0);
        });
    });
});

describe('several guards on one request: each decides as before, on one check (production)', () => {
    useEnv('production');

    it('requireAuth, then optionalAuth: the same learner, one check', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        await listen(guardedApp(requireAuth, optionalAuth), async (request) => {
            const response = await request('/guarded', { token: session(LEARNER) });
            assert.equal(response.status, 200);
            assert.deepEqual(response.json, { userId: LEARNER, authMethod: 'supabase-jwt', accountGeneration: null });
            assert.deepEqual(checks(pool), ONE_CHECK);
        });
    });

    it('optionalAuth, then requireAuth, with a token Supabase refuses: optionalAuth lets it through as a guest, requireAuth still answers 401', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        supabase.mode = 'refuse';
        await listen(guardedApp(optionalAuth, requireAuth), async (request) => {
            const response = await request('/guarded', { token: session(LEARNER) });
            assert.equal(response.status, 401);
            assert.deepEqual(response.json, { error: 'Invalid or expired token' });
            assert.deepEqual(checks(pool), { getUser: 1, accountReads: 0, stubInserts: 0 });
        });
    });

    it('optionalAuth, then requireAuth, when getUser throws: requireAuth still answers 500, Supabase was asked once', async () => {
        setPoolForTests(createAccountDeletionPool());
        supabase.mode = 'throw';
        await listen(guardedApp(optionalAuth, requireAuth), async (request) => {
            const response = await request('/guarded', { token: session(LEARNER) });
            assert.equal(response.status, 500);
            assert.deepEqual(response.json, { error: 'Authentication service error' });
            assert.equal(supabase.calls, 1);
        });
    });

    it('optionalAuth, then requireAuth, when the account check fails: requireAuth still answers 503 auth_unavailable (fail closed), one read', async () => {
        const pool = createAccountDeletionPool({ failRead: true });
        setPoolForTests(pool);
        await listen(guardedApp(optionalAuth, requireAuth), async (request) => {
            const response = await request('/guarded', { token: session(LEARNER) });
            assert.equal(response.status, 503);
            assert.equal(response.json?.error_type, 'auth_unavailable');
            assert.deepEqual(checks(pool), { getUser: 1, accountReads: 1, stubInserts: 0 });
        });
    });

    it('optionalAuth, then requireAuth, with a session from before the account was deleted: a guest, then 401 account_deleted; no stub', async () => {
        const pool = createAccountDeletionPool({ tombstones: { [LEARNER]: { deletedAt: DELETED_AT } }, now: () => REOPENED_AT });
        setPoolForTests(pool);
        await listen(guardedApp(optionalAuth, requireAuth), async (request) => {
            const response = await request('/guarded', { token: session(LEARNER) });
            assert.equal(response.status, 401);
            assert.equal(response.json?.error_type, 'account_deleted');
            assert.deepEqual(checks(pool), { getUser: 1, accountReads: 1, stubInserts: 0 });
            assert.equal(pool.state.stubs.has(LEARNER), false);
        });
    });

    it('requireBridgeOrAuth, then requireAuth, with a session from after the deletion: the account is re-opened once, both guards carry its generation', async () => {
        const pool = createAccountDeletionPool({ tombstones: { [LEARNER]: { deletedAt: DELETED_AT } }, now: () => REOPENED_AT });
        setPoolForTests(pool);
        const app = express();
        app.get(
            '/guarded',
            requireBridgeOrAuth,
            (req, _res, next) => { req.firstGeneration = req.accountGeneration; next(); },
            requireAuth,
            (req, res) => res.json({ userId: req.userId, first: req.firstGeneration, second: req.accountGeneration }),
        );
        await listen(app, async (request) => {
            const response = await request('/guarded', { token: session(LEARNER, DELETED_S + 600) });
            assert.equal(response.status, 200, JSON.stringify(response.json));
            const generation = Math.floor(REOPENED_AT.getTime() / 1000);
            assert.deepEqual(response.json, { userId: LEARNER, first: generation, second: generation });
            assert.equal(pool.state.connects, 1, 're-opened once');
            assert.equal(accountReads(pool), 1);
            assert.equal(pool.state.queries.filter((q) => q.sql.startsWith('insert into auth.users') && !q.tx).length, 1, 'one stub write after the re-open');
        });
    });

    it('requireBridgeOrAuth, then requireAuth (an unknown /api/v2/agent path runs both): one check', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        await listen(guardedApp(requireBridgeOrAuth, requireAuth), async (request) => {
            const response = await request('/guarded', { token: session(LEARNER) });
            assert.equal(response.status, 200);
            assert.deepEqual(response.json, { userId: LEARNER, authMethod: 'supabase-jwt', accountGeneration: null });
            assert.deepEqual(checks(pool), ONE_CHECK);
        });
    });
});

describe('several guards on one request (development)', () => {
    useEnv('development');

    it('no token: requireAuth falls back to the dev user, optionalAuth after it still makes the request a guest (the TTS routes in dev)', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        await listen(guardedApp(requireAuth, optionalAuth), async (request) => {
            const response = await request('/guarded');
            assert.equal(response.status, 200);
            assert.equal(response.json.userId, null);
            assert.equal(response.json.authMethod, 'anonymous');
            assert.deepEqual(checks(pool), { getUser: 0, accountReads: 0, stubInserts: 1 });
        });
    });

    it('no token: requireAuth, then requireBridgeOrAuth, both fall back to the dev user; its stub is written once', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        await listen(guardedApp(requireAuth, requireBridgeOrAuth), async (request) => {
            const response = await request('/guarded');
            assert.equal(response.status, 200);
            assert.deepEqual(response.json, { userId: PHASE1_USER_ID, authMethod: 'dev-fallback', accountGeneration: null });
            assert.equal(stubInserts(pool), 1);
        });
    });
});

describe('the bridge token is compared in constant time', () => {
    it('sameSecret: only the same non-empty string matches', () => {
        assert.equal(sameSecret(BRIDGE_TOKEN, BRIDGE_TOKEN), true);
        for (const wrong of [`${BRIDGE_TOKEN.slice(0, -1)}X`, BRIDGE_TOKEN.slice(0, -1), `${BRIDGE_TOKEN}-and-more`, ` ${BRIDGE_TOKEN}`, BRIDGE_TOKEN.toUpperCase()]) {
            assert.equal(sameSecret(wrong, BRIDGE_TOKEN), false, `${wrong} does not match`);
        }
        for (const [provided, expected] of [['', ''], ['', BRIDGE_TOKEN], [BRIDGE_TOKEN, ''], [undefined, BRIDGE_TOKEN], [BRIDGE_TOKEN, undefined], [[BRIDGE_TOKEN], BRIDGE_TOKEN]]) {
            assert.equal(sameSecret(provided, expected), false, 'an empty or missing value never matches');
        }
    });

    it('sameSecret compares two SHA-256 digests with timingSafeEqual, whatever the lengths', (t) => {
        const spy = t.mock.method(crypto, 'timingSafeEqual');
        assert.equal(sameSecret('short', BRIDGE_TOKEN), false);
        assert.equal(spy.mock.callCount(), 1);
        const [a, b] = spy.mock.calls[0].arguments;
        assert.equal(a.length, 32);
        assert.equal(b.length, 32);
    });

    describe('requireBridgeOrAuth (production)', () => {
        useEnv('production');

        it('the header and the Bearer form go through timingSafeEqual; the right token passes, a near miss does not', async (t) => {
            setPoolForTests(createAccountDeletionPool());
            setSupabaseForTests(null);
            const spy = t.mock.method(crypto, 'timingSafeEqual');
            const near = `${BRIDGE_TOKEN.slice(0, -1)}X`;
            await listen(guardedApp(requireBridgeOrAuth), async (request) => {
                const cases = [
                    [{ headers: { 'x-nexloom-bridge-token': BRIDGE_TOKEN } }, 200, 'bridge-token'],
                    [{ token: BRIDGE_TOKEN }, 200, 'bridge-bearer'],
                    [{ headers: { 'x-nexloom-bridge-token': near } }, 401],
                    [{ token: near }, 401],
                ];
                for (const [options, status, authMethod] of cases) {
                    const before = spy.mock.callCount();
                    const response = await request('/guarded', options);
                    assert.equal(response.status, status, JSON.stringify(options));
                    if (authMethod) assert.equal(response.json.authMethod, authMethod);
                    assert.ok(spy.mock.callCount() > before, `${JSON.stringify(options)}: compared with timingSafeEqual`);
                }
            });
        });
    });

    it('the SSE MCP resolver: the header and the Bearer form go through timingSafeEqual; a near miss is refused', async (t) => {
        const spy = t.mock.method(crypto, 'timingSafeEqual');
        const resolveUserId = createSseUserResolver({
            getSupabase: () => null,
            getPool: () => null,
            readAccountState,
            decodeTokenClaims,
            sessionAuthTime,
            isOAuthClientToken,
            extractBearerToken,
            bridgeToken: () => BRIDGE_TOKEN,
            allowDevFallback: () => false,
            phase1UserId: PHASE1_USER_ID,
            logger: { error: () => {} },
        });
        const near = `${BRIDGE_TOKEN.slice(0, -1)}X`;
        const cases = [
            [{ 'x-nexloom-bridge-token': BRIDGE_TOKEN }, PHASE1_USER_ID],
            [{ authorization: `Bearer ${BRIDGE_TOKEN}` }, PHASE1_USER_ID],
            [{ 'x-nexloom-bridge-token': near }, null],
            [{ authorization: `Bearer ${near}` }, null],
        ];
        for (const [headers, expected] of cases) {
            const before = spy.mock.callCount();
            assert.equal(await resolveUserId({ headers }), expected, JSON.stringify(headers));
            assert.ok(spy.mock.callCount() > before, `${JSON.stringify(headers)}: compared with timingSafeEqual`);
        }
    });
});
