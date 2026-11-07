// The job-training API's entry (doc/brushup-2026/training-plan.ja.md D1, D5, §4.2;
// server/routes/training.js) on the real server.js stack with helpers/trainingPool.js (exact SQL):
// - the switch: unless TRAINING_ENABLED is exactly "true", 404 training_off for every caller, before
//   auth (no Supabase call, no statement);
// - requireAuth + requireSignedIn: no token and the bridge token 401; an anonymous user, the bridge
//   user and the dev fallback 401 sign_in_required; an agent's OAuth token 401 oauth_client_token; a
//   deleted account 401 account_deleted;
// - GET /me: the caller's live memberships (a marked row never shows), learnerId in lower case;
// - the per-learner limit (not relaxed in development), the small body limit before the 2 MB parser
//   and before auth, 503 training_unavailable / 500 training_failed without the driver's text;
// - nothing under /api/v2/training reaches the /api/v2 catch-alls (their AI limiter).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../../server.js';
import { PHASE1_USER_ID, setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { TRAINING_BODY_LIMIT, TRAINING_REQUESTS_PER_MINUTE } from '../routes/training.js';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { createTrainingPool, norm, TRAINING_POOL_SQL } from './helpers/trainingPool.js';

const ALICE = 'aaaaaaaa-2121-4000-8000-000000000001';
const BOB = 'aaaaaaaa-2121-4000-8000-000000000002';
const ANON = 'aaaaaaaa-2121-4000-8000-0000000000a0';
const GONE = 'aaaaaaaa-2121-4000-8000-0000000000d0';
const CLAUDE = '11111111-2222-4000-8000-000000000001';
const MCP_URL = 'https://mcp.example.org/mcp';
const BRIDGE_TOKEN = 'test-bridge-token-for-training';
const COHORT = 'c0000000-0000-4000-8000-000000000001';
const OLD = 'c0000000-0000-4000-8000-000000000002';
const ME = '/api/v2/training/me';
const OFF = { error: 'Training is not offered here.', error_type: 'training_off' };

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ role: 'authenticated', exp: 4_000_000_000, ...payload })}.c2ln`;
const as = (sub, extra = {}) => ({ Authorization: `Bearer ${jwt({ sub, aud: 'authenticated', ...extra })}` });

/** Supabase accepts every token and names its sub; ANON is an anonymous user. */
const supabase = {
    calls: 0,
    auth: {
        getUser: async (token) => {
            supabase.calls += 1;
            const id = decodeTokenClaims(token)?.sub;
            if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
            return { data: { user: { id, is_anonymous: id === ANON } }, error: null };
        },
    },
};

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'TRAINING_ENABLED'];

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const call = async (url, { method = 'GET', headers = {}, body, rawBody } = {}) => {
    const init = { method, headers: { ...headers } };
    if (rawBody !== undefined || body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = rawBody ?? JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text, headers: response.headers };
};

const quiet = async (fn) => {
    const { error, warn } = console;
    console.error = () => {};
    console.warn = () => {};
    try {
        return await fn();
    } finally {
        console.error = error;
        console.warn = warn;
    }
};

describe('/api/v2/training on the server.js stack', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        process.env.TRAINING_ENABLED = 'true';
        resetPoolForTests();
        pool = createTrainingPool({
            tombstones: { [GONE]: { deletedAt: '2026-10-20T00:00:00Z' } },
            cohorts: [{ id: COHORT, name: '2026-11 Web', starts_on: '2026-11-01' }, { id: OLD, name: 'old', starts_on: '2026-04-01' }],
            memberships: [
                { cohort_id: COHORT, user_id: ALICE, role: 'learner' },
                { cohort_id: OLD, user_id: ALICE, role: 'learner', account_deleted_at: new Date('2026-10-01T00:00:00Z') },
            ],
        });
        setPoolForTests(pool);
        supabase.calls = 0;
        setSupabaseForTests(supabase);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });

    it('off unless TRAINING_ENABLED is exactly "true": 404 training_off for every caller, before auth (no Supabase call, no statement)', async () => {
        for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true']) {
            if (value === undefined) delete process.env.TRAINING_ENABLED;
            else process.env.TRAINING_ENABLED = value;
            await withServer(async (base) => {
                for (const headers of [{}, { 'x-nexloom-bridge-token': BRIDGE_TOKEN }, as(ALICE), as(ALICE, { aud: MCP_URL, client_id: CLAUDE })]) {
                    const res = await call(`${base}${ME}`, { headers });
                    assert.deepEqual([res.status, res.json], [404, OFF], JSON.stringify(value));
                }
            });
        }
        assert.equal(supabase.calls, 0);
        assert.deepEqual(pool.state.queries, []);
    });

    it('200: the caller\'s live memberships only (a marked row never shows), learnerId in lower case, no-store', async () => {
        await withServer(async (base) => {
            const res = await call(`${base}${ME}`, { headers: as(ALICE.toUpperCase()) });
            assert.equal(res.status, 200, res.text);
            assert.equal(res.headers.get('cache-control'), 'no-store');
            assert.deepEqual(Object.keys(res.json), ['ok', 'learnerId', 'cohorts']);
            assert.deepEqual(res.json, { ok: true, learnerId: ALICE, cohorts: [{ cohortId: COHORT, name: '2026-11 Web', role: 'learner' }] });
            const bob = await call(`${base}${ME}`, { headers: as(BOB) });
            assert.deepEqual(bob.json, { ok: true, learnerId: BOB, cohorts: [] });
        });
        assert.deepEqual(pool.trainingStatements(), [TRAINING_POOL_SQL.me, TRAINING_POOL_SQL.me]);
    });

    it('the audience: no token 401; bridge 401; anonymous, PHASE1 and the dev fallback 401 sign_in_required; an agent 401 oauth_client_token; a deleted account 401 account_deleted; no training statement', async () => {
        await withServer(async (base) => {
            assert.equal((await call(`${base}${ME}`)).status, 401);
            assert.equal((await call(`${base}${ME}`, { headers: { 'x-nexloom-bridge-token': BRIDGE_TOKEN } })).status, 401);
            const anon = await call(`${base}${ME}`, { headers: as(ANON) });
            assert.deepEqual([anon.status, anon.json], [401, { error: 'Sign in with a Rise Path account to use training.', error_type: 'sign_in_required' }]);
            const bridgeUser = await call(`${base}${ME}`, { headers: as(PHASE1_USER_ID) });
            assert.deepEqual([bridgeUser.status, bridgeUser.json.error_type], [401, 'sign_in_required']);
            const agent = await call(`${base}${ME}`, { headers: as(ALICE, { aud: MCP_URL, client_id: CLAUDE }) });
            assert.deepEqual([agent.status, agent.json.error_type], [401, 'oauth_client_token']);
            const gone = await call(`${base}${ME}`, { headers: as(GONE) });
            assert.deepEqual([gone.status, gone.json.error_type], [401, 'account_deleted']);
        });
        process.env.NODE_ENV = 'development';
        setSupabaseForTests(null);
        await withServer(async (base) => {
            const dev = await call(`${base}${ME}`);
            assert.deepEqual([dev.status, dev.json.error_type], [401, 'sign_in_required'], 'the dev fallback (shared by every dev guest)');
        });
        assert.deepEqual(pool.trainingStatements(), []);
    });

    it(`per learner: the ${TRAINING_REQUESTS_PER_MINUTE + 1}st request in a minute is 429 rate_limited; another learner is unaffected; not relaxed in development`, async () => {
        assert.equal(TRAINING_REQUESTS_PER_MINUTE, 60);
        for (const mode of ['production', 'development']) {
            process.env.NODE_ENV = mode;
            await withServer(async (base) => {
                for (let i = 0; i < TRAINING_REQUESTS_PER_MINUTE; i += 1) {
                    assert.equal((await call(`${base}${ME}`, { headers: as(ALICE) })).status, 200, `${mode} ${i + 1}`);
                }
                const limited = await call(`${base}${ME}`, { headers: as(ALICE) });
                assert.deepEqual([limited.status, limited.json], [429, { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' }], mode);
                assert.equal((await call(`${base}${ME}`, { headers: as(BOB) })).status, 200);
            });
        }
    });

    it(`the ${TRAINING_BODY_LIMIT} body limit runs before the 2 MB parser, before auth and the switch: 413 body_too_large, 400 invalid_body`, async () => {
        assert.equal(TRAINING_BODY_LIMIT, '4kb');
        for (const value of ['true', undefined]) {
            if (value === undefined) delete process.env.TRAINING_ENABLED;
            await withServer(async (base) => {
                const big = await call(`${base}${ME}`, { method: 'POST', body: { pad: 'x'.repeat(8 * 1024) } });
                assert.deepEqual([big.status, big.json], [413, { error: 'The request body is larger than 4kb.', error_type: 'body_too_large' }]);
                const notJson = await call(`${base}${ME}`, { method: 'POST', rawBody: '{"x":' });
                assert.deepEqual([notJson.status, notJson.json], [400, { error: 'The request body is not valid JSON.', error_type: 'invalid_body' }]);
            });
        }
        assert.equal(supabase.calls, 0);
    });

    it('503 training_unavailable without a database, when it is down, before migration 021 (42P01) or without a grant (42501); 500 training_failed otherwise; never the driver\'s text', async () => {
        await withServer(async (base) => {
            setPoolForTests(null);
            const none = await call(`${base}${ME}`, { headers: as(ALICE) });
            assert.deepEqual([none.status, none.json], [503, { ok: false, error: 'Training is unavailable right now. Please try again later.', error_type: 'training_unavailable' }]);
            assert.equal(none.headers.get('retry-after'), '60', 'as server/routes/legal.js');
            setPoolForTests(pool);
            await quiet(async () => {
                const secret = '(host db.internal:5432, password=hunter2)';
                for (const [code, status, type] of [['ECONNREFUSED', 503, 'training_unavailable'], ['42P01', 503, 'training_unavailable'], ['42501', 503, 'training_unavailable'], ['23505', 500, 'training_failed']]) {
                    pool.fail(/training_memberships/, Object.assign(new Error(`relation "training_memberships" ${code} ${secret}`), { code }));
                    const res = await call(`${base}${ME}`, { headers: as(ALICE) });
                    assert.deepEqual([res.status, res.json.error_type], [status, type], code);
                    assert.equal(res.headers.get('retry-after'), status === 503 ? '60' : null, code);
                    assert.doesNotMatch(res.text, /relation|training_memberships|db\.internal|hunter2|getTrainingMe|ECONNREFUSED/);
                }
            });
        });
    });

    it('other paths and methods (beside GET /me and the study time routes) answer 404 here, never the AI limiter of the /api/v2 catch-all, and run no training statement', async () => {
        await withServer(async (base) => {
            for (let i = 0; i < 12; i += 1) {
                const res = await call(`${base}/api/v2/training/nope`, { headers: as(BOB) });
                assert.deepEqual([res.status, res.json?.error_type], [404, 'not_found'], `${i + 1}: ${res.text.slice(0, 80)}`);
            }
            for (const method of ['POST', 'PUT', 'DELETE']) {
                assert.equal((await call(`${base}${ME}`, { method, headers: as(BOB), body: {} })).status, 404, method);
            }
        });
        assert.deepEqual(pool.trainingStatements(), []);
    });
});

describe('tools/core/training.js and the server.js mount', () => {
    it('the statement the helper answers is the module\'s, verbatim', () => {
        assert.equal(norm(TRAINING_SQL.me), TRAINING_POOL_SQL.me);
        assert.match(TRAINING_SQL.me, /m\.user_id = \$1::uuid AND m\.account_deleted_at IS NULL/);
    });

    it('server.js: the parser before the 2 MB one; the router before /api/v2/user and the /api/v2 catch-alls', () => {
        const text = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
        const create = text.slice(text.indexOf('export async function createApp'), text.indexOf('// --- Server Start'));
        const at = (needle) => {
            const index = create.indexOf(needle);
            assert.ok(index > 0, needle);
            return index;
        };
        const parser = at("app.use('/api/v2/training', express.json({ limit: TRAINING_BODY_LIMIT }), smallBodyErrors(TRAINING_BODY_LIMIT));");
        const router = at("app.use('/api/v2/training', createTrainingRouter());");
        assert.ok(parser < at('app.use(express.json({ limit: JSON_BODY_LIMIT }));'));
        for (const later of ["app.use('/api/v2/user', requireAuth, userRoutes);", "app.use('/api/v2', chatgptCurriculumRoutes);", "app.use('/api/v2', requireAuth, contentRoutes);", "app.use('/api/v2', optionalAuth, aiLimiter, ttsRoutes);"]) {
            assert.ok(router < at(later), `before ${later}`);
        }
    });
});
