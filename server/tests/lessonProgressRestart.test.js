// Lesson progress of a re-opened deleted account (Phase 4, design §5.10) on the server.js stack:
// a sign-in after the deletion re-opens the account in requireAuth (tools/core/accountDeletions.js:
// reopened_at and the new epoch's reset_at are the same now()), the GET then says restarted: true,
// and a device that still holds the deleted account's records (an old or null epoch) is refused
// with 409 progress_reset. A later normal reset ends the flag; it is absent otherwise, so the
// existing deepEqual pins of the GET body hold. A one-lesson reset (Phase 5) keeps it (G17).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { resetPoolForTests, setPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { RESTARTED_SQL } from '../../tools/core/lessonProgress.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { createLessonProgressPool, norm, SQL } from './helpers/lessonProgressPool.js';

const A = 'abcdef01-2345-4678-9abc-def012345678';
const B = 'bcdef012-3456-4789-8bcd-ef0123456789';
const OLD_EPOCH = 'cccccccc-0000-4000-8000-000000000001';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const nowS = () => Math.floor(Date.now() / 1000);
const DELETED_AT = new Date(Date.now() - 10 * 60 * 1000);

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (sub, signedIn) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
    sub, aud: 'authenticated', role: 'authenticated', iat: nowS(), exp: 4_000_000_000, amr: [{ method: 'password', timestamp: signedIn }],
})}.c2ln`;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const record = (overrides = {}) => ({ v: 1, seen: ['hook-b1'], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z', ...overrides });

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY'];
/** GET's capabilities (Phase 5 stage 1: the one-lesson reset). */
const CAPABILITIES = { lessonReset: true };

async function call(url, { method = 'GET', headers = {}, body } = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    return { status: response.status, json: JSON.parse(text), text };
}

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/user/lesson-progress`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

describe('lesson progress of a re-opened account (restarted)', () => {
    const saved = {};
    let quiet;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        setSupabaseForTests({ auth: { getUser: async (t) => ({ data: { user: { id: decodeTokenClaims(t)?.sub } }, error: null }) } });
        quiet = { log: console.log, warn: console.warn };
        console.log = () => {};
        console.warn = () => {};
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

    it('the module\'s restarted statement is the helper\'s (reopened_at = reset_at, the id cast)', () => {
        assert.equal(norm(RESTARTED_SQL), SQL.selectRestarted);
        assert.match(RESTARTED_SQL, /d\.user_id = \$1::uuid/);
        assert.match(RESTARTED_SQL, /d\.reopened_at = \(SELECT r\.reset_at FROM lesson_progress_resets r WHERE r\.user_id = d\.user_id\)/);
    });

    it('a sign-in after the deletion re-opens the account: GET says restarted: true; a stale PUT (old or null epoch) is 409 progress_reset', async () => {
        const pool = createLessonProgressPool({ tombstones: { [A]: { deletedAt: DELETED_AT } } });
        setPoolForTests(pool);
        const fresh = token(A, nowS());
        await withServer(async (base) => {
            const get = await call(base, { headers: auth(fresh) });
            assert.equal(get.status, 200, get.text);
            assert.deepEqual(Object.keys(get.json), ['ok', 'epoch', 'restarted', 'capabilities', 'records']);
            assert.equal(get.json.restarted, true);
            assert.deepEqual(get.json.records, []);
            assert.match(get.json.epoch, /^[0-9a-f-]{36}$/);
            assert.ok(pool.tombstoneOf(A).reopened_at instanceof Date, 'requireAuth re-opened the account');
            assert.ok(pool.queries.some((q) => q.sql === SQL.reopenEpoch && q.via === 'client'), 'the epoch was written in the re-open transaction');

            for (const epoch of [null, OLD_EPOCH]) {
                const put = await call(base, { method: 'PUT', headers: auth(fresh), body: { epoch, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } });
                assert.deepEqual([put.status, put.json.error_type, put.json.epoch], [409, 'progress_reset', get.json.epoch], String(epoch));
            }
            assert.equal(pool.row(A, VIBE, CH1), undefined, 'nothing of the deleted account was uploaded');

            // The device that knows the new epoch saves normally.
            const ok = await call(base, { method: 'PUT', headers: auth(fresh), body: { epoch: get.json.epoch, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } });
            assert.equal(ok.status, 200, ok.text);
        });
    });

    it('restarted ends with a normal reset, and is absent for an account never deleted or without an epoch', async () => {
        const pool = createLessonProgressPool({ tombstones: { [A]: { deletedAt: DELETED_AT } }, resets: { [B]: OLD_EPOCH } });
        setPoolForTests(pool);
        const fresh = token(A, nowS());
        await withServer(async (base) => {
            assert.equal((await call(base, { headers: auth(fresh) })).json.restarted, true);
            const reset = await call(base, { method: 'DELETE', headers: auth(fresh) });
            assert.equal(reset.status, 200);
            const after = await call(base, { headers: auth(fresh) });
            assert.deepEqual(after.json, { ok: true, epoch: reset.json.epoch, capabilities: CAPABILITIES, records: [] }, 'no restarted key after a normal reset');

            const never = await call(base, { headers: auth(token(B, nowS())) });
            assert.deepEqual(never.json, { ok: true, epoch: OLD_EPOCH, capabilities: CAPABILITIES, records: [] });
        });
        const noEpoch = createLessonProgressPool();
        setPoolForTests(noEpoch);
        await withServer(async (base) => {
            const res = await call(base, { headers: auth(token(B, nowS())) });
            assert.deepEqual(res.json, { ok: true, epoch: null, capabilities: CAPABILITIES, records: [] });
        });
        assert.ok(!noEpoch.queries.some((q) => q.sql === SQL.selectRestarted), 'no epoch, no restarted read');
    });

    it('G17: starting one lesson over (Phase 5) never moves the account epoch, so restarted stays', async () => {
        const pool = createLessonProgressPool({ tombstones: { [A]: { deletedAt: DELETED_AT } } });
        setPoolForTests(pool);
        const fresh = token(A, nowS());
        await withServer(async (base) => {
            const get = await call(base, { headers: auth(fresh) });
            assert.equal(get.json.restarted, true);
            const put = await call(base, { method: 'PUT', headers: auth(fresh), body: { epoch: get.json.epoch, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } });
            assert.equal(put.status, 200, put.text);
            const reset = await call(`${base}/lesson-reset`, { method: 'POST', headers: auth(fresh), body: { epoch: get.json.epoch, courseSlug: VIBE, lessonId: CH1 } });
            assert.equal(reset.status, 200, reset.text);
            assert.equal(reset.json.epoch, get.json.epoch);
            const after = await call(base, { headers: auth(fresh) });
            assert.deepEqual([after.json.epoch, after.json.restarted], [get.json.epoch, true], 'same epoch, still restarted');
            assert.equal(pool.queries.filter((q) => q.sql === SQL.upsertEpoch || q.sql === SQL.reopenEpoch).length, 1, 'only the re-open wrote the account epoch');
        });
    });

    it('a session from before the deletion is refused before any lesson-progress statement', async () => {
        const pool = createLessonProgressPool({ tombstones: { [A]: { deletedAt: DELETED_AT } } });
        setPoolForTests(pool);
        await withServer(async (base) => {
            const res = await call(base, { method: 'PUT', headers: auth(token(A, nowS() - 3600)), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } });
            assert.deepEqual([res.status, res.json.error_type], [401, 'account_deleted']);
        });
        assert.deepEqual(pool.progressStatements(), []);
        assert.equal(pool.tombstoneOf(A).reopened_at, null);
    });
});
