// Deleting one's own account (Phase 4, server/routes/account.js at /api/v2/user/account) on the
// real server.js stack: requireAuth and requireSignedIn, the 16 kb body parser registered before
// the 50 MB one, the per-learner limit, the off switch, the password re-authentication (amr), the
// deletion itself against helpers/deletionPool.js, and what a deleted account's sessions get
// afterwards. The answer for every service result is checked on the router alone. Deletion starts
// off (ACCOUNT_DELETION_ENABLED unset); the cases that test the chain past the switch turn it on.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../../server.js';
import { PHASE1_USER_ID, resetPoolForTests, setPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { requireSignedIn } from '../middleware/signedIn.js';
import { ACCOUNT_DELETIONS_PER_MINUTE, createAccountRouter, deletionAppNames, readDeletionSwitch } from '../routes/account.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { createDeletionPool } from './helpers/deletionPool.js';

const A = 'abcdef01-2345-4678-9abc-def012345678';
const B = 'bcdef012-3456-4789-8bcd-ef0123456789';
const ANON = 'cdef0123-4567-489a-9bcd-ef0123456789';
const CLIENT = '11111111-2222-4000-8000-000000000001';
const nowS = () => Math.floor(Date.now() / 1000);

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A Supabase session token (unsigned: the fake Supabase below does not check signatures). */
const token = (sub, { amr = [{ method: 'password', timestamp: nowS() }], ...extra } = {}) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
    sub, aud: 'authenticated', role: 'authenticated', iat: nowS(), exp: 4_000_000_000, amr, ...extra,
})}.c2ln`;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const CONFIRM = { confirm: 'delete-my-account' };

/** Supabase accepts every token and names its sub (the shared login is never deleted). `as`: a token whose user differs. */
const supabase = {
    as: new Map(),
    auth: {
        getUser: async (t) => {
            const claims = decodeTokenClaims(t);
            const id = supabase.as.get(t) ?? claims?.sub;
            if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
            return { data: { user: { id, is_anonymous: id === ANON } }, error: null };
        },
    },
};

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET',
    'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'ACCOUNT_DELETION_ENABLED', 'MEMANTO_API_URL', 'MEMANTO_ENABLED', 'BILLING_ENABLED', 'STRIPE_SECRET_KEY'];

async function call(base, path, { method = 'GET', headers = {}, body, rawBody } = {}) {
    const init = { method, headers: { ...headers } };
    if (rawBody !== undefined || body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = rawBody ?? JSON.stringify(body);
    }
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text };
}

const listen = async (app, handler) => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};
const withServer = async (handler) => listen(await createApp({ serveStatic: false }), handler);

const DELETION = '/api/v2/user/account/deletion';

describe('/api/v2/user/account on the server.js stack', () => {
    const saved = {};
    let pool;
    let quiet;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        // On for the chain below; 'deletion starts off' deletes it again.
        process.env.ACCOUNT_DELETION_ENABLED = 'true';
        pool = createDeletionPool({
            stubs: [A, B],
            owned: { lesson_progress: [A, B], lesson_progress_lesson_resets: [A], xp_awards: [A, B], learning_days: [A], review_cards: [A, B], review_log: [A] },
            materials: [],
            subscriptions: [],
        });
        setPoolForTests(pool);
        supabase.as.clear();
        setSupabaseForTests(supabase);
        quiet = { log: console.log, warn: console.warn, error: console.error };
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

    it('no token 401; an agent\'s OAuth token 401 oauth_client_token; the dev fallback and an anonymous user 401 sign_in_required', async () => {
        await withServer(async (base) => {
            for (const method of ['GET', 'POST']) {
                assert.equal((await call(base, DELETION, { method, body: method === 'POST' ? CONFIRM : undefined })).status, 401, method);
            }
            const agent = await call(base, DELETION, { method: 'POST', headers: auth(token(A, { aud: 'https://mcp.example.org/mcp', client_id: CLIENT })), body: CONFIRM });
            assert.deepEqual([agent.status, agent.json.error_type], [401, 'oauth_client_token']);
            const anon = await call(base, DELETION, { method: 'POST', headers: auth(token(ANON)), body: CONFIRM });
            assert.deepEqual([anon.status, anon.json], [401, { error: 'Sign in with a Rise Path account to delete it.', error_type: 'sign_in_required' }]);
        });
        process.env.NODE_ENV = 'development';
        setSupabaseForTests(null);
        await withServer(async (base) => {
            const dev = await call(base, DELETION, { method: 'POST', body: CONFIRM });
            assert.deepEqual([dev.status, dev.json.error_type], [401, 'sign_in_required'], 'the dev fallback (PHASE1) can never delete');
        });
        assert.ok(pool.state.stubs.has(A));
        assert.equal(pool.state.tombstones.size, 0);
    });

    it('a real Supabase session of the bridge user (PHASE1_USER_ID, any case) with a fresh password sign-in → 401 sign_in_required before the service', async () => {
        for (const sub of [PHASE1_USER_ID, PHASE1_USER_ID.toUpperCase()]) {
            await withServer(async (base) => {
                // Without requireSignedIn's PHASE1 check this reaches the service: 400 invalid_user.
                const res = await call(base, DELETION, { method: 'POST', headers: auth(token(sub)), body: CONFIRM });
                assert.deepEqual([res.status, res.json], [401, { error: 'Sign in with a Rise Path account to delete it.', error_type: 'sign_in_required' }], sub);
            });
        }
        assert.equal(pool.state.tombstones.size, 0);
        assert.ok(pool.state.stubs.has(A) && pool.state.stubs.has(B));
    });

    it('re-authentication: a password sign-in older than 120 s, one without a password amr, or another user\'s token → 401 reauth_required', async () => {
        const stale = token(A, { amr: [{ method: 'password', timestamp: nowS() - 121 }] });
        const otp = token(A, { amr: [{ method: 'otp', timestamp: nowS() }] });
        const oauth = token(A, { amr: [{ method: 'oauth', timestamp: nowS() }, { method: 'password', timestamp: nowS() - 3600 }] });
        const future = token(A, { amr: [{ method: 'password', timestamp: nowS() + 120 }] });
        const strings = token(A, { amr: ['pwd'] });
        const otherUser = token(B);
        supabase.as.set(otherUser, A); // Supabase names A, the token's sub is B
        // One server per case: each counts against the per-learner limit (5 a minute).
        for (const [label, t] of Object.entries({ stale, otp, oauth, future, strings, otherUser })) {
            await withServer(async (base) => {
                const res = await call(base, DELETION, { method: 'POST', headers: auth(t), body: CONFIRM });
                assert.deepEqual([res.status, res.json], [401, { error: 'Enter your password again to delete your account.', error_type: 'reauth_required' }], label);
            });
        }
        assert.ok(pool.state.stubs.has(A));
        assert.equal(pool.state.tombstones.size, 0);
    });

    it('400 confirm_required without the confirm word; a body over 16 kb 413 body_too_large (JSON); a non-JSON body 400 invalid_body', async () => {
        const fresh = token(A);
        await withServer(async (base) => {
            for (const body of [{}, { confirm: 'yes' }, [CONFIRM], { confirm: 'DELETE-MY-ACCOUNT' }]) {
                const res = await call(base, DELETION, { method: 'POST', headers: auth(fresh), body });
                assert.deepEqual([res.status, res.json.error_type], [400, 'confirm_required'], JSON.stringify(body));
            }
            const big = await call(base, DELETION, { method: 'POST', headers: auth(fresh), body: { ...CONFIRM, pad: 'x'.repeat(17 * 1024) } });
            assert.deepEqual([big.status, big.json], [413, { error: 'The request body is larger than 16kb.', error_type: 'body_too_large' }]);
            const broken = await call(base, DELETION, { method: 'POST', headers: auth(fresh), rawBody: '{"confirm":' });
            assert.deepEqual([broken.status, broken.json], [400, { error: 'The request body is not valid JSON.', error_type: 'invalid_body' }]);
        });
        assert.ok(pool.state.stubs.has(A), 'nothing was deleted');
    });

    it('deletion starts off: with ACCOUNT_DELETION_ENABLED unset or empty, the preflight says enabled false and a POST with a fresh password sign-in is 503 deletion_disabled, without a warning; nothing is deleted', async () => {
        const warnings = [];
        console.warn = (...args) => warnings.push(args.join(' '));
        for (const value of [undefined, '', '  ']) {
            if (value === undefined) delete process.env.ACCOUNT_DELETION_ENABLED;
            else process.env.ACCOUNT_DELETION_ENABLED = value;
            await withServer(async (base) => {
                const preflight = await call(base, DELETION, { headers: auth(token(A)) });
                assert.deepEqual([preflight.status, preflight.json], [200, { ok: true, enabled: false, subscription: 'none', reauthWindowSeconds: 120 }], JSON.stringify(value));
                const res = await call(base, DELETION, { method: 'POST', headers: auth(token(A)), body: CONFIRM });
                assert.deepEqual([res.status, res.json], [503, { error: 'Deleting an account from this page is turned off right now.', error_type: 'deletion_disabled' }], JSON.stringify(value));
            });
        }
        assert.deepEqual(warnings.filter((line) => line.includes('ACCOUNT_DELETION_ENABLED')), [], 'unset and empty are the default, not a mistake');
        assert.ok(pool.state.stubs.has(A) && pool.state.stubs.has(B));
        assert.equal(pool.state.tombstones.size, 0);
        assert.deepEqual(pool.state.owned.lesson_progress, [A, B]);
        assert.deepEqual([pool.state.owned.lesson_progress_lesson_resets, pool.state.owned.xp_awards, pool.state.owned.learning_days], [[A], [A, B], [A]]);
        assert.deepEqual([pool.state.owned.review_cards, pool.state.owned.review_log], [[A, B], [A]]);
    });

    it(`the ${ACCOUNT_DELETIONS_PER_MINUTE + 1}th POST in a minute is 429 rate_limited (per learner); ACCOUNT_DELETION_ENABLED=false → 503 deletion_disabled`, async () => {
        await withServer(async (base) => {
            for (let i = 0; i < ACCOUNT_DELETIONS_PER_MINUTE; i += 1) {
                assert.equal((await call(base, DELETION, { method: 'POST', headers: auth(token(A)), body: {} })).status, 400);
            }
            const limited = await call(base, DELETION, { method: 'POST', headers: auth(token(A)), body: CONFIRM });
            assert.deepEqual([limited.status, limited.json.error_type], [429, 'rate_limited']);
            process.env.ACCOUNT_DELETION_ENABLED = 'false';
            const off = await call(base, DELETION, { method: 'POST', headers: auth(token(B)), body: CONFIRM });
            assert.deepEqual([off.status, off.json], [503, { error: 'Deleting an account from this page is turned off right now.', error_type: 'deletion_disabled' }]);
            const preflight = await call(base, DELETION, { headers: auth(token(B)) });
            assert.equal(preflight.json.enabled, false);
        });
        assert.ok(pool.state.stubs.has(A) && pool.state.stubs.has(B));
    });

    it('success: 200 deleted; the old session and the re-auth token then get 401 account_deleted; a sign-in after it starts an empty account', async () => {
        const old = token(A, { amr: [{ method: 'password', timestamp: nowS() - 3600 }] });
        const reauth = token(A);
        await withServer(async (base) => {
            assert.equal((await call(base, '/api/v2/user/account/deletion', { headers: auth(old) })).status, 200, 'the old session works before');
            const res = await call(base, DELETION, { method: 'POST', headers: auth(reauth), body: CONFIRM });
            assert.equal(res.status, 200, res.text);
            assert.deepEqual(Object.keys(res.json), ['ok', 'status', 'deletedAt']);
            assert.equal(res.json.status, 'deleted');
            assert.ok(Math.abs(Date.parse(res.json.deletedAt) - Date.now()) < 5000);
            for (const [label, t, path] of [['old', old, '/api/v2/user/profile'], ['reauth', reauth, DELETION], ['old', old, '/api/v2/user/lesson-progress']]) {
                const after = await call(base, path, { headers: auth(t) });
                assert.deepEqual([after.status, after.json], [401, {
                    error: 'This Rise Path account was deleted. Sign in again to start a new, empty account.',
                    error_type: 'account_deleted',
                }], `${label} ${path}`);
            }
            const repeat = await call(base, DELETION, { method: 'POST', headers: auth(reauth), body: CONFIRM });
            assert.equal(repeat.json.error_type, 'account_deleted', 'a second POST after the COMMIT');
            assert.ok(!pool.state.stubs.has(A), 'no stub came back');
            assert.equal(pool.state.tombstones.get(A).requested_by, 'self');
            assert.deepEqual(pool.state.owned.lesson_progress, [B]);
            assert.deepEqual([pool.state.owned.lesson_progress_lesson_resets, pool.state.owned.xp_awards, pool.state.owned.learning_days], [[], [B], []], 'resets, XP and learning days go with the account');
            assert.deepEqual([pool.state.owned.review_cards, pool.state.owned.review_log], [[B], []], 'review cards and their log go with the account');

            const later = token(A, { amr: [{ method: 'password', timestamp: nowS() + 31 }] });
            const fresh = await call(base, DELETION, { headers: auth(later) });
            assert.deepEqual([fresh.status, fresh.json], [200, { ok: true, enabled: true, subscription: 'none', reauthWindowSeconds: 120 }]);
            assert.ok(pool.state.stubs.has(A), 'a new, empty account under the same id');
            assert.ok(pool.state.tombstones.get(A).reopened_at instanceof Date);
            assert.deepEqual(pool.state.owned.lesson_progress, [B], 'nothing of the old account came back');
            assert.deepEqual(pool.state.owned.xp_awards, [B], 'a re-opened account starts at 0 XP');
            assert.deepEqual(pool.state.owned.review_cards, [B], 'and with no review cards');
        });
    });

    it('GET /deletion: the plan as the page needs it; 503 without a database', async () => {
        pool.state.subscriptions.push({ user_id: A, status: 'active', cancel_at_period_end: false, cancel_at: null });
        pool.state.subscriptions.push({ user_id: B, status: 'active', cancel_at_period_end: true, cancel_at: null });
        await withServer(async (base) => {
            assert.deepEqual((await call(base, DELETION, { headers: auth(token(A)) })).json, { ok: true, enabled: true, subscription: 'renewing', reauthWindowSeconds: 120 });
            assert.equal((await call(base, DELETION, { headers: auth(token(B)) })).json.subscription, 'ending');
            const blocked = await call(base, DELETION, { method: 'POST', headers: auth(token(A)), body: CONFIRM });
            assert.deepEqual([blocked.status, blocked.json.error_type, blocked.json.memory_deleted], [409, 'subscription_active', false]);
        });
        setPoolForTests(null);
        await withServer(async (base) => {
            const res = await call(base, DELETION, { headers: auth(token(A)) });
            assert.deepEqual([res.status, res.json.error_type], [503, 'deletion_unavailable']);
        });
    });

    it('a database failure inside the deletion answers 503 deletion_unavailable with memory_deleted and no driver text', async () => {
        pool.failOn(/^delete from auth\.users/, Object.assign(new Error('violates foreign key constraint "secret_fkey" on db.internal'), { code: '23503' }));
        await withServer(async (base) => {
            const res = await call(base, DELETION, { method: 'POST', headers: auth(token(A)), body: CONFIRM });
            assert.deepEqual([res.status, res.json], [503, {
                error: 'Your account cannot be deleted right now. Please try again later.',
                error_type: 'deletion_unavailable',
                memory_deleted: false,
            }]);
            assert.ok(!res.text.includes('secret_fkey') && !res.text.includes('db.internal'));
        });
        assert.ok(pool.state.stubs.has(A));
    });
});

describe('createAccountRouter: the answer for every service result', () => {
    const NOW = Date.parse('2026-10-24T05:00:00Z');
    const fresh = (sub = A, at = NOW / 1000) => token(sub, { amr: [{ method: 'password', timestamp: at }] });

    /** env: deletion on unless a case passes its own (the switch starts off). */
    const withRouter = async (deleteAccountData, handler, { env = { ACCOUNT_DELETION_ENABLED: 'true' }, userId = A, logger = { warn: () => {} } } = {}) => {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.userId = userId;
            req.authMethod = 'supabase-jwt';
            next();
        });
        app.use(createAccountRouter({ deleteAccountData, readDeletionState: async () => ({ subscription: 'none' }), now: () => NOW, env, getPool: () => ({}), logger }));
        await listen(app, handler);
    };

    it('ACCOUNT_DELETION_ENABLED: only true/1/on/yes (trimmed, any case) turn it on; unset, empty and false/0/off/no leave it off; any other value leaves it off with one warning', async () => {
        const cases = [
            ['true', true], [' TRUE ', true], ['True', true], ['1', true], ['On', true], ['yes', true], [' YES\n', true],
            [undefined, false], ['', false], ['   ', false],
            ['false', false], ['False', false], ['FALSE', false], [' false\n', false], ['0', false], ['off', false], ['No', false],
            ['flase', false, 'warn'], ['disabled', false, 'warn'], ['ture', false, 'warn'], ['enabled', false, 'warn'],
        ];
        for (const [value, on, warn] of cases) {
            const label = JSON.stringify(value);
            let calls = 0;
            const warnings = [];
            await withRouter(async () => {
                calls += 1;
                return { status: 'deleted', deletedAt: null };
            }, async (base) => {
                const preflight = await call(base, '/deletion', {});
                assert.equal(preflight.json.enabled, on, label);
                for (let i = 0; i < 2; i += 1) {
                    const res = await call(base, '/deletion', { method: 'POST', headers: auth(fresh()), body: CONFIRM });
                    assert.deepEqual([res.status, res.json.error_type], on ? [200, undefined] : [503, 'deletion_disabled'], label);
                }
            }, { env: { ACCOUNT_DELETION_ENABLED: value }, logger: { warn: (line) => warnings.push(line) } });
            assert.equal(calls, on ? 2 : 0, `${label}: the service runs only when on`);
            assert.deepEqual(warnings, warn ? ["[Account] ACCOUNT_DELETION_ENABLED has an unrecognised value: account deletion is off (use 'true' or 'false')"] : [], `${label}: one warning per value`);
        }
        assert.deepEqual(readDeletionSwitch('Off'), { on: false, recognised: true });
        assert.deepEqual(readDeletionSwitch('nope'), { on: false, recognised: false });
        assert.deepEqual(readDeletionSwitch(undefined), { on: false, recognised: true }, 'unset: off, the default');
        assert.deepEqual(readDeletionSwitch(''), { on: false, recognised: true }, 'empty: off, the default');
        assert.deepEqual(readDeletionSwitch(' Yes '), { on: true, recognised: true });
    });

    it('maps deleted, already, refused and failed to fixed answers with memory_deleted', async () => {
        const results = [
            [{ status: 'deleted', deletedAt: '2026-10-24T05:00:01.000Z' }, 200, { ok: true, status: 'deleted', deletedAt: '2026-10-24T05:00:01.000Z' }],
            [{ status: 'already', deletedAt: '2026-10-24T04:59:00.000Z' }, 200, { ok: true, status: 'deleted', deletedAt: '2026-10-24T04:59:00.000Z', repeated: true }],
            [{ status: 'refused', reason: 'subscription_active', memoryDeleted: false }, 409, { error_type: 'subscription_active', memory_deleted: false }],
            [{ status: 'refused', reason: 'subscription_active', memoryDeleted: true }, 409, { error_type: 'subscription_active', memory_deleted: true }],
            [{ status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false }, 503, { error_type: 'payment_provider_unavailable', memory_deleted: false }],
            [{ status: 'refused', reason: 'memory_service_unavailable', memoryDeleted: false }, 503, { error_type: 'memory_service_unavailable', memory_deleted: false }],
            [{ status: 'failed', reason: 'account_busy', memoryDeleted: true }, 503, { error_type: 'account_busy', memory_deleted: true }],
            [{ status: 'failed', reason: 'deletion_unavailable', memoryDeleted: true }, 503, { error_type: 'deletion_unavailable', memory_deleted: true }],
            [{ status: 'failed', reason: 'something_new', memoryDeleted: false }, 503, { error_type: 'deletion_unavailable', memory_deleted: false }],
        ];
        for (const [result, status, body] of results) {
            /** @type {any[]} */
            const calls = [];
            await withRouter(async (input) => {
                calls.push(input);
                return result;
            }, async (base) => {
                const res = await call(base, '/deletion', { method: 'POST', headers: auth(fresh()), body: CONFIRM });
                assert.equal(res.status, status, JSON.stringify(result));
                if (status === 200) assert.deepEqual(res.json, body);
                else {
                    assert.equal(typeof res.json.error, 'string');
                    for (const [k, v] of Object.entries(body)) assert.equal(res.json[k], v, `${k} for ${JSON.stringify(result)}`);
                }
            });
            assert.equal(calls.length, 1);
            assert.deepEqual({ ...calls[0], billing: undefined }, { userId: A, requestedBy: 'self', authTime: NOW / 1000, appNames: [], billing: undefined });
        }
    });

    it('the page\'s AI app names reach the service cleaned (trimmed, at most 100 characters, lower-case UUID ids); anything else is dropped and never refuses', async () => {
        const APP = '11111111-AAAA-4000-8000-000000000001';
        const OTHER = '11111111-0000-4000-8000-000000000002';
        const many = Array.from({ length: 30 }, (_, i) => ({ clientId: `22222222-0000-4000-8000-${String(i).padStart(12, '0')}`, clientName: `app ${i}` }));
        for (const [apps, want] of [
            [[{ clientId: APP, clientName: '  Claude\u202e Code \n' }, { clientId: OTHER, clientName: 'y'.repeat(150) }],
                [{ clientId: APP.toLowerCase(), clientName: 'Claude Code' }, { clientId: OTHER, clientName: 'y'.repeat(100) }]],
            [[{ clientId: 'not-a-uuid', clientName: 'x' }, { clientId: APP, clientName: '   ' }, { clientId: APP, clientName: 7 }, null, 'str', { clientId: OTHER, clientName: 'ok' }, { clientId: OTHER, clientName: 'again' }],
                [{ clientId: OTHER, clientName: 'ok' }]],
            ['not a list', []],
            [many, many.slice(0, 20)],
        ]) {
            const calls = [];
            await withRouter(async (input) => {
                calls.push(input);
                return { status: 'deleted', deletedAt: null };
            }, async (base) => {
                const res = await call(base, '/deletion', { method: 'POST', headers: auth(fresh()), body: { ...CONFIRM, apps } });
                assert.equal(res.status, 200);
            });
            assert.deepEqual(calls.map((c) => c.appNames), [want], JSON.stringify(apps).slice(0, 80));
        }
        assert.deepEqual(deletionAppNames(undefined), []);
    });

    it('the re-auth window is [now − 120 s, now + 60 s]; the service is never called outside it', async () => {
        let calls = 0;
        const service = async () => {
            calls += 1;
            return { status: 'deleted', deletedAt: null };
        };
        await withRouter(service, async (base) => {
            for (const [offset, ok] of [[-120, true], [-121, false], [60, true], [61, false], [0, true]]) {
                const res = await call(base, '/deletion', { method: 'POST', headers: auth(fresh(A, NOW / 1000 + offset)), body: CONFIRM });
                assert.equal(res.status, ok ? 200 : 401, String(offset));
            }
        });
        await withRouter(service, async (base) => {
            const upper = await call(base, '/deletion', { method: 'POST', headers: auth(fresh(A.toUpperCase())), body: CONFIRM });
            assert.equal(upper.status, 200, 'the sub is compared in canonical form');
        });
        assert.equal(calls, 4);
        await withRouter(service, async (base) => {
            const res = await call(base, '/deletion', { method: 'POST', headers: auth(fresh(A)), body: CONFIRM });
            assert.equal(res.status, 401, 'PHASE1 user id never matches a token sub of another user');
        }, { userId: PHASE1_USER_ID });
    });

    it('GET /deletion reads the plan with the same billing as the POST gives the deletion (a live api leaves test-mode rows out)', async () => {
        const billing = { config: { live: true }, stripe: { marker: 'stripe client' } };
        const seen = [];
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.userId = A;
            req.authMethod = 'supabase-jwt';
            next();
        });
        app.use(createAccountRouter({
            deleteAccountData: async (input) => {
                seen.push(['delete', input.billing]);
                return { status: 'deleted', deletedAt: null };
            },
            readDeletionState: async (input) => {
                seen.push(['state', input.billing]);
                return { subscription: 'none' };
            },
            billing,
            now: () => NOW,
            env: { ACCOUNT_DELETION_ENABLED: 'true' },
            getPool: () => ({}),
            logger: { warn: () => {} },
        }));
        await listen(app, async (base) => {
            assert.equal((await call(base, '/deletion', {})).status, 200);
            assert.equal((await call(base, '/deletion', { method: 'POST', headers: auth(fresh()), body: CONFIRM })).status, 200);
        });
        assert.deepEqual(seen.map(([what]) => what), ['state', 'delete']);
        assert.ok(seen.every(([, given]) => given === billing), 'the same billing object for both');
    });

    it('a service that throws answers 503 deletion_unavailable', async () => {
        await withRouter(async () => {
            throw new Error('boom at db.internal');
        }, async (base) => {
            const res = await call(base, '/deletion', { method: 'POST', headers: auth(fresh()), body: CONFIRM });
            assert.deepEqual([res.status, res.json.error_type, res.json.memory_deleted], [503, 'deletion_unavailable', false]);
            assert.ok(!res.text.includes('db.internal'));
        });
    });
});

describe('requireSignedIn: each refusal on its own', () => {
    /** Runs the middleware on a fake request; returns the answer or 'next'. */
    const runMiddleware = (req) => {
        const out = { status: null, body: null, next: false };
        const res = {
            status(code) {
                out.status = code;
                return this;
            },
            json(body) {
                out.body = body;
                return this;
            },
        };
        requireSignedIn('Sign in first.')(/** @type {any} */ (req), /** @type {any} */ (res), () => {
            out.next = true;
        });
        return out;
    };
    const REFUSED = { status: 401, body: { error: 'Sign in first.', error_type: 'sign_in_required' }, next: false };

    it('a dev or no-Supabase fallback is refused even with an ordinary learner id (not only because the fallback id is PHASE1)', () => {
        for (const authMethod of ['dev-fallback', 'no-supabase-fallback', 'anonymous', undefined]) {
            assert.deepEqual(runMiddleware({ authMethod, userId: A }), REFUSED, String(authMethod));
        }
    });

    it('a Supabase session of PHASE1_USER_ID (any case), an anonymous user, or no UUID is refused; a learner passes', () => {
        for (const req of [
            { authMethod: 'supabase-jwt', userId: PHASE1_USER_ID },
            { authMethod: 'supabase-jwt', userId: PHASE1_USER_ID.toUpperCase() },
            { authMethod: 'supabase-jwt', userId: A, isAnonymous: true },
            { authMethod: 'supabase-jwt', userId: 'not-a-uuid' },
            { authMethod: 'supabase-jwt', userId: null },
        ]) {
            assert.deepEqual(runMiddleware(req), REFUSED, JSON.stringify(req));
        }
        for (const req of [{ authMethod: 'supabase-jwt', userId: A }, { authMethod: 'supabase-jwt', userId: A.toUpperCase(), isAnonymous: false }]) {
            assert.deepEqual(runMiddleware(req), { status: null, body: null, next: true }, JSON.stringify(req));
        }
    });
});
