// Sessions of a deleted Rise Path account (Phase 4, migration 018) at every app and SSE MCP entry
// point: requireAuth, optionalAuth, requireBridgeOrAuth (server/middleware) and the SSE resolver
// (mcp-server/sseUserAuth.js). Supabase keeps accepting the token (the shared login is not
// deleted), so the refusal must come from the tombstone check, before the auth.users stub.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth, optionalAuth, setSupabaseForTests, extractBearerToken } from '../middleware/auth.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import { aiAccessGate } from '../middleware/aiAccessGate.js';
import { PHASE1_USER_ID, setPoolForTests, resetPoolForTests } from '../db.js';
import { createSseUserResolver } from '../../mcp-server/sseUserAuth.js';
import { readAccountState } from '../../tools/core/accountDeletions.js';
import { decodeTokenClaims, isOAuthClientToken, sessionAuthTime } from '../../tools/core/oauthToken.js';
import { createAccountDeletionPool } from './helpers/accountDeletionPool.js';

const DELETED = 'dddddddd-0000-4000-8000-00000000000d';
const OTHER = 'eeeeeeee-0000-4000-8000-00000000000e';
const BRIDGE_TOKEN = 'test-bridge-token-for-account-auth';
const DELETED_AT = new Date('2026-10-01T00:00:00Z');
const DELETED_S = DELETED_AT.getTime() / 1000;
const REOPENED_AT = new Date('2026-10-01T00:10:00.500Z');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/**
 * A learner session token as Supabase issues it (unsigned: the fake Supabase does not check).
 * signedIn: the amr time (kept across refreshes); iat: the issue time (moves on refresh).
 */
const session = (sub, { signedIn, iat = signedIn, amr } = {}) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
    sub,
    aud: 'authenticated',
    role: 'authenticated',
    iat,
    exp: 4_000_000_000,
    ...(amr !== undefined ? { amr } : { amr: [{ method: 'password', timestamp: signedIn }] }),
})}.c2ln`;

/** Accepts every token and names its sub, like Supabase for a login that still exists. */
const supabase = {
    calls: 0,
    auth: {
        getUser: async (token) => {
            supabase.calls += 1;
            const sub = decodeTokenClaims(token)?.sub;
            return { data: { user: typeof sub === 'string' ? { id: sub } : null }, error: null };
        },
    },
};

const tombstoned = (extra = {}) => createAccountDeletionPool({
    tombstones: { [DELETED]: { deletedAt: DELETED_AT, ...extra } },
    now: () => REOPENED_AT,
});
const stubInserts = (pool) => pool.state.queries.filter((q) => q.sql.startsWith('insert into auth.users'));

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1'];

const withApp = async (handler) => {
    const app = express();
    const answer = (req, res) => res.json({
        userId: req.userId ?? null,
        authMethod: req.authMethod,
        accountGeneration: req.accountGeneration === undefined ? 'unset' : req.accountGeneration,
    });
    app.get('/required', requireAuth, answer);
    app.get('/optional', optionalAuth, answer);
    app.get('/bridge', requireBridgeOrAuth, answer);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(async (path, token, headers = {}) => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
            });
            return { status: response.status, json: await response.json() };
        });
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const ACCOUNT_DELETED = {
    error: 'This Rise Path account was deleted. Sign in again to start a new, empty account.',
    error_type: 'account_deleted',
};
const AUTH_UNAVAILABLE = { error: 'Sign-in cannot be checked right now. Please try again.', error_type: 'auth_unavailable' };

for (const mode of ['production', 'development']) {
    describe(`app API: sessions of a deleted account (${mode})`, () => {
        const saved = {};
        let warn;

        beforeEach(() => {
            for (const key of ENV_KEYS) saved[key] = process.env[key];
            for (const key of ENV_KEYS) delete process.env[key];
            process.env.NODE_ENV = mode;
            process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
            supabase.calls = 0;
            setSupabaseForTests(supabase);
            warn = console.warn;
            console.warn = () => {};
        });

        afterEach(() => {
            console.warn = warn;
            for (const key of ENV_KEYS) {
                if (saved[key] === undefined) delete process.env[key];
                else process.env[key] = saved[key];
            }
            setSupabaseForTests(null);
            resetPoolForTests();
        });

        it('requireAuth: a session from before the deletion is 401 account_deleted, and no stub is inserted', async () => {
            const pool = tombstoned();
            setPoolForTests(pool);
            await withApp(async (get) => {
                for (const signedIn of [DELETED_S - 86_400, DELETED_S + 30]) {
                    const { status, json } = await get('/required', session(DELETED, { signedIn }));
                    assert.equal(status, 401, String(signedIn));
                    assert.deepEqual(json, ACCOUNT_DELETED);
                }
            });
            assert.deepEqual(stubInserts(pool), [], 'the stub is never recreated');
            assert.equal(pool.state.connects, 0, 'never re-opened');
        });

        it('requireAuth: a refreshed token (fresh iat, the old amr) is still refused; no amr at all is refused too', async () => {
            const pool = tombstoned();
            setPoolForTests(pool);
            await withApp(async (get) => {
                const refreshed = session(DELETED, { signedIn: DELETED_S - 600, iat: DELETED_S + 86_400 });
                assert.deepEqual((await get('/required', refreshed)).json, ACCOUNT_DELETED);
                const noAmr = session(DELETED, { signedIn: DELETED_S + 86_400, amr: null });
                assert.deepEqual((await get('/required', noAmr)).json, ACCOUNT_DELETED);
            });
            assert.deepEqual(stubInserts(pool), []);
        });

        it('requireAuth: a session that signed in after the deletion re-opens an empty account and carries its generation', async () => {
            const pool = tombstoned();
            setPoolForTests(pool);
            await withApp(async (get) => {
                const { status, json } = await get('/required', session(DELETED, { signedIn: DELETED_S + 600 }));
                assert.equal(status, 200, JSON.stringify(json));
                assert.deepEqual(json, { userId: DELETED, authMethod: 'supabase-jwt', accountGeneration: Math.floor(REOPENED_AT.getTime() / 1000) });
                // The next request of the same session reads the re-opened tombstone: same generation.
                const again = await get('/required', session(DELETED, { signedIn: DELETED_S + 600 }));
                assert.equal(again.json.accountGeneration, json.accountGeneration);
                // The old session stays refused after the re-open.
                assert.deepEqual((await get('/required', session(DELETED, { signedIn: DELETED_S - 600 }))).json, ACCOUNT_DELETED);
            });
            const sqls = pool.state.queries.map((q) => q.sql);
            assert.ok(sqls.includes('begin') && sqls.includes('commit'));
            assert.ok(sqls.some((s) => s.startsWith('update account_deletions set reopened_at = now()')));
            assert.ok(pool.state.stubs.has(DELETED), 'the stub is back for the new account');
            assert.equal(pool.state.connects, 1, 're-opened once');
            const update = sqls.indexOf(sqls.find((s) => s.startsWith('update account_deletions')));
            const firstStub = sqls.indexOf(sqls.find((s) => s.startsWith('insert into auth.users')));
            assert.ok(update < firstStub, 're-opened before any stub insert');
        });

        it('requireAuth and requireBridgeOrAuth: a failing tombstone read is 503 auth_unavailable (fail closed, no stub)', async () => {
            const pool = createAccountDeletionPool({ failRead: true });
            setPoolForTests(pool);
            await withApp(async (get) => {
                for (const path of ['/required', '/bridge']) {
                    const { status, json } = await get(path, session(OTHER, { signedIn: DELETED_S }));
                    assert.equal(status, 503, path);
                    assert.deepEqual(json, AUTH_UNAVAILABLE, path);
                }
                assert.deepEqual((await get('/optional', session(OTHER, { signedIn: DELETED_S }))).json,
                    { userId: null, authMethod: 'anonymous', accountGeneration: 'unset' });
            });
            assert.deepEqual(stubInserts(pool), []);
        });

        it('optionalAuth + the AI gate: a failing tombstone read is 503 ai_access_unavailable (try again), never 401 sign_in_required or the guest path', async () => {
            const pool = createAccountDeletionPool({ failRead: true });
            setPoolForTests(pool);
            const app = express();
            app.post('/ai', optionalAuth, aiAccessGate(), (req, res) => res.json({ served: true, userId: req.userId ?? null }));
            const server = await new Promise((resolve) => {
                const s = app.listen(0, '127.0.0.1', () => resolve(s));
            });
            const savedGuest = process.env.LLM_GUEST_AI;
            try {
                for (const guest of [undefined, 'true']) {
                    if (guest === undefined) delete process.env.LLM_GUEST_AI;
                    else process.env.LLM_GUEST_AI = guest;
                    const response = await fetch(`http://127.0.0.1:${server.address().port}/ai`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${session(OTHER, { signedIn: DELETED_S })}` },
                    });
                    const label = `LLM_GUEST_AI=${guest}`;
                    assert.equal(response.status, 503, label);
                    assert.equal(response.headers.get('retry-after'), '60', label);
                    assert.equal((await response.json()).error_type, 'ai_access_unavailable', label);
                }
                // Without a token the gate is unchanged: 401 sign_in_required (guests off).
                delete process.env.LLM_GUEST_AI;
                const anonymous = await fetch(`http://127.0.0.1:${server.address().port}/ai`, { method: 'POST' });
                assert.equal(anonymous.status, 401);
            } finally {
                if (savedGuest === undefined) delete process.env.LLM_GUEST_AI;
                else process.env.LLM_GUEST_AI = savedGuest;
                await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
            }
            assert.deepEqual(stubInserts(pool), []);
        });

        it('no database configured (no pool): signed in as today', async () => {
            setPoolForTests(null);
            await withApp(async (get) => {
                for (const path of ['/required', '/optional', '/bridge']) {
                    const { status, json } = await get(path, session(DELETED, { signedIn: DELETED_S }));
                    assert.equal(status, 200, path);
                    assert.deepEqual(json, { userId: DELETED, authMethod: 'supabase-jwt', accountGeneration: null }, path);
                }
            });
        });

        it('an account that was never deleted: one tombstone read, then today\'s single stub INSERT; generation null', async () => {
            const pool = createAccountDeletionPool();
            setPoolForTests(pool);
            await withApp(async (get) => {
                const { status, json } = await get('/required', session(OTHER, { signedIn: DELETED_S }));
                assert.equal(status, 200);
                assert.deepEqual(json, { userId: OTHER, authMethod: 'supabase-jwt', accountGeneration: null });
            });
            assert.deepEqual(pool.state.queries.map((q) => [q.sql, q.params]), [
                ['select deleted_at, reopened_at from account_deletions where user_id = $1::uuid', [OTHER]],
                ['insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing', [OTHER]],
            ]);
        });

        it('optionalAuth: an old session of a deleted account is anonymous (no stub); a new session re-opens', async () => {
            const pool = tombstoned();
            setPoolForTests(pool);
            await withApp(async (get) => {
                const old = await get('/optional', session(DELETED, { signedIn: DELETED_S - 60 }));
                assert.equal(old.status, 200);
                assert.deepEqual(old.json, { userId: null, authMethod: 'anonymous', accountGeneration: 'unset' });
                assert.deepEqual(stubInserts(pool), []);
                const fresh = await get('/optional', session(DELETED, { signedIn: DELETED_S + 600 }));
                assert.deepEqual(fresh.json, { userId: DELETED, authMethod: 'supabase-jwt', accountGeneration: Math.floor(REOPENED_AT.getTime() / 1000) });
            });
        });

        it('requireBridgeOrAuth: a deleted account\'s JWT is 401 account_deleted, never the dev fallback user', async () => {
            const pool = tombstoned();
            setPoolForTests(pool);
            await withApp(async (get) => {
                const { status, json } = await get('/bridge', session(DELETED, { signedIn: DELETED_S - 60 }));
                assert.equal(status, 401);
                assert.deepEqual(json, ACCOUNT_DELETED);
                const fresh = await get('/bridge', session(DELETED, { signedIn: DELETED_S + 600 }));
                assert.deepEqual(fresh.json, { userId: DELETED, authMethod: 'supabase-jwt', accountGeneration: Math.floor(REOPENED_AT.getTime() / 1000) });
            });
            assert.ok(!stubInserts(pool).some((q) => q.params[0] === PHASE1_USER_ID), 'no PHASE1 fallback');
        });

        it('bridge and dev paths are unchanged (PHASE1, no tombstone read); their generation is null on every middleware', async () => {
            const pool = createAccountDeletionPool({ failRead: true });
            setPoolForTests(pool);
            await withApp(async (get) => {
                const header = await get('/bridge', null, { 'x-nexloom-bridge-token': BRIDGE_TOKEN });
                assert.deepEqual(header.json, { userId: PHASE1_USER_ID, authMethod: 'bridge-token', accountGeneration: null });
                const bearer = await get('/bridge', BRIDGE_TOKEN);
                assert.deepEqual(bearer.json, { userId: PHASE1_USER_ID, authMethod: 'bridge-bearer', accountGeneration: null });
                const none = await get('/required', null);
                if (mode === 'development') {
                    assert.deepEqual(none.json, { userId: PHASE1_USER_ID, authMethod: 'dev-fallback', accountGeneration: null });
                } else {
                    assert.equal(none.status, 401);
                }
                // No Supabase client: a token falls back to PHASE1 in development, with a null
                // generation (as requireBridgeOrAuth), never left unset.
                setSupabaseForTests(null);
                const token = session(OTHER, { signedIn: DELETED_S });
                const required = await get('/required', token);
                const optional = await get('/optional', token);
                if (mode === 'development') {
                    const fallback = { userId: PHASE1_USER_ID, authMethod: 'no-supabase-fallback', accountGeneration: null };
                    assert.deepEqual(required.json, fallback);
                    assert.deepEqual(optional.json, fallback);
                } else {
                    assert.equal(required.status, 503);
                    assert.deepEqual(optional.json, { userId: null, authMethod: 'anonymous', accountGeneration: 'unset' });
                }
            });
            assert.ok(!pool.state.queries.some((q) => q.sql.includes('account_deletions')), 'the bridge and dev users are never checked');
        });
    });
}

describe('SSE MCP resolver (mcp-server/sseUserAuth.js)', () => {
    /** @param {{ pool?: any, dev?: boolean, supabaseClient?: any, bridge?: string }} [options] */
    const resolverFor = ({ pool = null, dev = false, supabaseClient = supabase, bridge = BRIDGE_TOKEN } = {}) => {
        const errors = [];
        const resolve = createSseUserResolver({
            getSupabase: () => supabaseClient,
            getPool: () => pool,
            readAccountState,
            decodeTokenClaims,
            sessionAuthTime,
            isOAuthClientToken,
            extractBearerToken,
            bridgeToken: () => bridge,
            allowDevFallback: () => dev,
            phase1UserId: PHASE1_USER_ID,
            logger: { error: (...args) => errors.push(args.join(' ')) },
        });
        return { resolve, errors };
    };
    const request = (token, headers = {}) => ({ headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

    for (const dev of [false, true]) {
        it(`a session of a deleted account is null (401), never re-opens and never falls back${dev ? ' (dev fallback on)' : ''}`, async () => {
            const pool = tombstoned();
            const { resolve } = resolverFor({ pool, dev });
            for (const signedIn of [DELETED_S - 60, DELETED_S + 600]) {
                const req = request(session(DELETED, { signedIn }));
                assert.equal(await resolve(req), null, String(signedIn));
                assert.equal(req.authMethod, 'account-deleted');
            }
            assert.equal(pool.state.connects, 0, 'the SSE MCP never re-opens an account');
            assert.equal(pool.state.tombstones.get(DELETED).reopened_at, null);
        });

        it(`a failing tombstone read is null, not the dev user${dev ? ' (dev fallback on)' : ''}`, async () => {
            const { resolve, errors } = resolverFor({ pool: createAccountDeletionPool({ failRead: true }), dev });
            const req = request(session(OTHER, { signedIn: DELETED_S }));
            assert.equal(await resolve(req), null);
            assert.equal(errors.length, 1);
        });
    }

    it('a re-opened account\'s new session and a never-deleted account resolve to the learner', async () => {
        const pool = tombstoned({ reopenedAt: REOPENED_AT });
        const { resolve } = resolverFor({ pool });
        const req = request(session(DELETED, { signedIn: DELETED_S + 600 }));
        assert.equal(await resolve(req), DELETED);
        assert.equal(req.authMethod, 'supabase-jwt');
        assert.equal(await resolve(request(session(OTHER, { signedIn: 1 }))), OTHER);
        assert.equal(await resolve(request(session(DELETED, { signedIn: DELETED_S }))), null, 'the old session stays refused');
    });

    it('no pool: the learner as today', async () => {
        const { resolve } = resolverFor({ pool: null });
        assert.equal(await resolve(request(session(DELETED, { signedIn: DELETED_S }))), DELETED);
    });

    it('bridge header, bridge bearer, OAuth-client refusal and dev fallback keep their order', async () => {
        const pool = createAccountDeletionPool({ failRead: true });
        const prod = resolverFor({ pool }).resolve;
        const dev = resolverFor({ pool, dev: true }).resolve;
        const header = request(session(DELETED, { signedIn: 1 }), { 'x-nexloom-bridge-token': BRIDGE_TOKEN });
        assert.equal(await prod(header), PHASE1_USER_ID);
        assert.equal(header.authMethod, 'bridge-header');
        const bearer = request(BRIDGE_TOKEN);
        assert.equal(await prod(bearer), PHASE1_USER_ID);
        assert.equal(bearer.authMethod, 'bridge-bearer');
        const agent = request(`${b64({ alg: 'ES256' })}.${b64({ sub: OTHER, aud: 'https://mcp.example.org/mcp', client_id: OTHER })}.c2ln`);
        assert.equal(await dev(agent), null);
        assert.equal(agent.authMethod, 'oauth-client-refused');
        // Supabase refuses the token: dev fallback in development only, as before.
        const refusing = { auth: { getUser: async () => ({ data: { user: null }, error: { message: 'bad' } }) } };
        assert.equal(await resolverFor({ supabaseClient: refusing, dev: true }).resolve(request(session(OTHER, { signedIn: 1 }))), PHASE1_USER_ID);
        assert.equal(await resolverFor({ supabaseClient: refusing }).resolve(request(session(OTHER, { signedIn: 1 }))), null);
        assert.equal(await resolverFor({ dev: true }).resolve(request(null)), PHASE1_USER_ID);
        assert.equal(await resolverFor({}).resolve(request(null)), null);
        assert.ok(!pool.state.queries.length, 'bridge, agent and dev paths read no tombstone');
    });

    it('index.js builds the SSE resolver from sseUserAuth.js with the real account check', async () => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync(new URL('../../mcp-server/index.js', import.meta.url), 'utf8');
        assert.match(source, /import \{ createSseUserResolver\b[^}]*\} from '\.\/sseUserAuth\.js';/);
        assert.match(source, /const resolveUserId = createSseUserResolver\(\{[^}]*readAccountState,[^}]*sessionAuthTime,[^}]*\}\);/s);
        assert.doesNotMatch(source, /async function resolveUserId/, 'no second, unchecked resolver');
        assert.equal((source.match(/await resolveUserId\(req\)/g) || []).length, 2, '/sse and /messages both resolve');
    });
});
