// POST /api/v2/user/lesson-progress/lesson-reset (Phase 5 stage 1, design §2.1) on the real
// server.js stack with the in-memory tables of helpers/lessonProgressPool.js (exact SQL): auth
// (JWT only: no bridge token, no agent token), validation, unknown_lesson, 409 progress_reset with
// the epoch, the 256 kb body limit, the shared per-learner write limit (PUT, DELETE and the reset
// together), 503/500 without driver text, and a PUT carrying a lessonEpoch afterwards.
// Stage 2 (design §3.3, finding 17): the after-save hook, injected through
// createApp({ lessonProgress: { afterSave } }): called once after a PUT that taught something, never
// for a no-op PUT, a refused record or a failed save; a hook that throws or rejects never changes the
// answer; the default (noteLearning) writes the XP and today's learning day after the answer.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { getPublishedLesson } from '../../tools/core/courseCatalog.js';
import { LESSON_PROGRESS_WRITES_PER_MINUTE } from '../routes/lessonProgress.js';
import { createLessonProgressPool, jstDay, SQL } from './helpers/lessonProgressPool.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const CLAUDE = '11111111-2222-4000-8000-000000000001';
const MCP_URL = 'https://mcp.example.org/mcp';
const BRIDGE_TOKEN = 'test-bridge-token-for-lesson-reset';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const EPOCH = 'cccccccc-0000-4000-8000-000000000001';
const EPOCH_ZERO = '1970-01-01T00:00:00.000Z';
const ch1 = getPublishedLesson(VIBE, CH1);

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ role: 'authenticated', exp: 4_000_000_000, ...payload })}.c2ln`;
const TOKENS = {
    alice: jwt({ sub: ALICE, aud: 'authenticated' }),
    bob: jwt({ sub: BOB, aud: 'authenticated' }),
    aliceAgent: jwt({ sub: ALICE, aud: MCP_URL, client_id: CLAUDE }),
};
const USERS = { [TOKENS.alice]: ALICE, [TOKENS.bob]: BOB, [TOKENS.aliceAgent]: ALICE };
const as = (who) => ({ Authorization: `Bearer ${TOKENS[who]}` });

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'RP_CONTENT_DIR'];
const record = (overrides = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z', ...overrides });
const answered = { 'check-quiz/q4': { attempts: 1, correct: true, chosen: ['b'], firstTry: true } };

/** afterSave: a no-op unless a test passes a recorder; `null` keeps the default hook (noteLearning). */
const withServer = async (handler, { afterSave = () => {} } = {}) => {
    const app = await createApp({ serveStatic: false, lessonProgress: afterSave === null ? {} : { afterSave } });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/user/lesson-progress`);
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
    return { status: response.status, json, text };
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

describe('POST /api/v2/user/lesson-progress/lesson-reset', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        resetPoolForTests();
        pool = createLessonProgressPool({
            rows: [
                { user_id: ALICE, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, pct: 5, state: 'in_progress', progress: record({ seen: ['hook-b1'], answers: answered }) },
                { user_id: BOB, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, pct: 1, state: 'in_progress', progress: record({ seen: ['s1-b1'] }) },
            ],
            resets: { [BOB]: EPOCH },
        });
        setPoolForTests(pool);
        setSupabaseForTests({
            auth: { getUser: async (token) => ({ data: { user: USERS[token] ? { id: USERS[token] } : null }, error: null }) },
        });
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });

    const resetBody = (overrides = {}) => ({ epoch: null, courseSlug: VIBE, lessonId: CH1, ...overrides });

    it('starts one lesson over: 200 with the new generation and the empty record; GET shows it; other lessons, learners and the account epoch are untouched', async () => {
        await withServer(async (base) => {
            const res = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body: resetBody() });
            assert.equal(res.status, 200, res.text);
            assert.deepEqual(Object.keys(res.json), ['ok', 'epoch', 'courseSlug', 'lessonId', 'lessonEpoch', 'lessonResetAt', 'record']);
            assert.equal(res.json.ok, true);
            assert.equal(res.json.epoch, null);
            assert.match(res.json.lessonEpoch, /^[0-9a-f-]{36}$/);
            assert.ok(Number.isFinite(Date.parse(res.json.lessonResetAt)));
            assert.deepEqual(res.json.record, {
                courseSlug: VIBE, lessonId: CH1, progress: record({ updatedAt: EPOCH_ZERO }), pct: 0, state: 'not_started',
                updatedAt: EPOCH_ZERO, lessonEpoch: res.json.lessonEpoch, lessonResetAt: res.json.lessonResetAt,
            });
            assert.equal(pool.epochOf(ALICE), null, 'the account epoch never moves');
            assert.deepEqual(pool.row(BOB, VIBE, CH1).progress.seen, ['s1-b1'], 'Bob untouched');
            assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} start 10`], 'what was earned stays earned');

            const get = await call(base, { headers: as('alice') });
            assert.deepEqual(get.json.capabilities, { lessonReset: true, achievements: true });
            assert.deepEqual(get.json.records.map((r) => [r.lessonId, r.state, r.lessonEpoch, r.lessonResetAt]), [[CH1, 'not_started', res.json.lessonEpoch, res.json.lessonResetAt]]);
        });
    });

    it('then a PUT of the old record is refused lesson_reset with the generation; one naming the new generation saves', async () => {
        await withServer(async (base) => {
            const res = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body: resetBody() });
            const old = { courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'], answers: answered }) };
            const put = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [old] } });
            assert.equal(put.status, 200, put.text);
            assert.deepEqual(put.json.records, []);
            assert.deepEqual(put.json.rejected, [{
                courseSlug: VIBE, lessonId: CH1, error_type: 'lesson_reset', lessonEpoch: res.json.lessonEpoch, lessonResetAt: res.json.lessonResetAt, record: res.json.record,
            }]);
            assert.equal('learned' in put.json, false, 'internal');
            const fresh = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [{ ...old, progress: record({ seen: ['s1-b1'] }), lessonEpoch: res.json.lessonEpoch }] } });
            assert.deepEqual(fresh.json.rejected, []);
            assert.deepEqual(fresh.json.records.map((r) => [r.progress.seen, r.lessonEpoch]), [[['s1-b1'], res.json.lessonEpoch]]);
        });
    });

    it('every refusal is { ok: false, error, error_type }: 400 validation for a malformed body or a bad lessonEpoch in a PUT record; 400 unknown_lesson for a lesson that is not published; no SQL', async () => {
        await withServer(async (base) => {
            for (const body of [
                [], 'x', resetBody({ epoch: 'not-a-uuid' }), resetBody({ epoch: 5 }), { courseSlug: VIBE, lessonId: CH1 },
                resetBody({ courseSlug: 7 }), resetBody({ lessonId: null }), resetBody({ lessonId: ['vibe-ch1'] }),
            ]) {
                const response = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body });
                assert.deepEqual([response.status, response.json?.error_type, response.json?.ok], [400, 'validation', false], JSON.stringify(body));
            }
            const notJson = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), rawBody: '{"epoch": null,' });
            assert.deepEqual([notJson.status, notJson.json.error_type, notJson.json.ok], [400, 'validation', false]);
            for (const body of [resetBody({ lessonId: 'vibe-ch99' }), resetBody({ courseSlug: 'Vibe' }), resetBody({ lessonId: 'vibe-ch1.5' })]) {
                const response = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body });
                assert.deepEqual([response.status, response.json.error_type, response.json.ok], [400, 'unknown_lesson', false], JSON.stringify(body));
            }
            for (const lessonEpoch of ['not-a-uuid', 5, {}, '']) {
                const put = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record(), lessonEpoch }] } });
                assert.deepEqual([put.status, put.json.error_type], [400, 'validation'], JSON.stringify(lessonEpoch));
            }
            assert.deepEqual(pool.progressStatements(), []);
        });
    });

    it('409 progress_reset with the current epoch when the progress was deleted elsewhere; nothing changes', async () => {
        await withServer(async (base) => {
            const stale = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('bob'), body: resetBody({ epoch: null }) });
            assert.deepEqual([stale.status, stale.json.ok, stale.json.error_type, stale.json.epoch], [409, false, 'progress_reset', EPOCH]);
            assert.deepEqual(pool.row(BOB, VIBE, CH1).progress.seen, ['s1-b1']);
            assert.equal(pool.lessonResetOf(BOB, VIBE, CH1), undefined);
            const current = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('bob'), body: resetBody({ epoch: EPOCH }) });
            assert.equal(current.status, 200, current.text);
            assert.equal(current.json.epoch, EPOCH);
        });
    });

    it('a body over 256 kb answers 413 body_too_large', async () => {
        await withServer(async (base) => {
            const big = resetBody({ padding: 'x'.repeat(300 * 1024) });
            const response = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body: big });
            assert.deepEqual([response.status, response.json.error_type, response.json.ok], [413, 'body_too_large', false]);
            assert.deepEqual(pool.progressStatements(), []);
        });
    });

    it('shares the per-learner write limit with PUT and DELETE: the 31st write in a minute is 429', async () => {
        await withServer(async (base) => {
            const put = { epoch: null, records: [{ courseSlug: VIBE, lessonId: 'vibe-ch2', progress: record() }] };
            for (let i = 0; i < LESSON_PROGRESS_WRITES_PER_MINUTE; i += 1) {
                const response = i % 2
                    ? await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body: resetBody() })
                    : await call(base, { method: 'PUT', headers: as('alice'), body: put });
                assert.equal(response.status, 200, `write ${i + 1}: ${response.text}`);
            }
            const limited = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body: resetBody() });
            assert.deepEqual([limited.status, limited.json.error_type], [429, 'rate_limited']);
            assert.equal((await call(base, { method: 'PUT', headers: as('alice'), body: put })).status, 429);
            assert.equal((await call(`${base}/lesson-reset`, { method: 'POST', headers: as('bob'), body: resetBody({ epoch: EPOCH }) })).status, 200, 'other learners are unaffected');
        });
    });

    it('no token, the bridge token or an agent\'s OAuth token: 401 before any statement', async () => {
        await withServer(async (base) => {
            const url = `${base}/lesson-reset`;
            assert.equal((await call(url, { method: 'POST', body: resetBody() })).status, 401);
            assert.equal((await call(url, { method: 'POST', headers: { 'x-nexloom-bridge-token': BRIDGE_TOKEN }, body: resetBody() })).status, 401);
            const agent = await call(url, { method: 'POST', headers: as('aliceAgent'), body: resetBody() });
            assert.deepEqual([agent.status, agent.json.error_type], [401, 'oauth_client_token']);
            assert.deepEqual(pool.progressStatements(), []);
            assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.seen, ['hook-b1']);
        });
    });

    it('without a database 503; database failures 503 or 500, never the driver text, rolled back', async () => {
        await withServer(async (base) => {
            const url = `${base}/lesson-reset`;
            setPoolForTests(null);
            const none = await call(url, { method: 'POST', headers: as('alice'), body: resetBody() });
            assert.deepEqual([none.status, none.json.error_type, none.json.ok], [503, 'lesson_progress_unavailable', false]);
            setPoolForTests(pool);
            await quiet(async () => {
                pool.fail({ code: '42P01', message: 'relation "lesson_progress_lesson_resets" does not exist (host db.internal:5432, password=hunter2)' });
                const missing = await call(url, { method: 'POST', headers: as('alice'), body: resetBody() });
                assert.deepEqual([missing.status, missing.json.error_type, missing.json.ok], [503, 'lesson_progress_unavailable', false]);
                assert.doesNotMatch(missing.text, /relation|db\.internal|hunter2/);
                pool.fail({ code: '23503', message: 'insert or update on table "xp_awards" violates foreign key constraint (db.internal, password=hunter2)', when: (text) => text === SQL.xpReconcileLessons });
                const broken = await call(url, { method: 'POST', headers: as('alice'), body: resetBody() });
                assert.deepEqual([broken.status, broken.json.error_type, broken.json.ok], [500, 'lesson_progress_failed', false]);
                assert.doesNotMatch(broken.text, /xp_awards|violates|db\.internal|hunter2/);
            });
            assert.equal(pool.inTransaction(), false);
            assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.seen, ['hook-b1'], 'nothing changed');
            assert.deepEqual(pool.awardsOf(ALICE), []);
        });
    });

    // ─── Stage 2: the after-save hook ───

    const learning = (overrides = {}) => ({ epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1', 's1-b1'], answers: answered }), ...overrides }] });

    it('afterSave is called once, after the save committed, for a PUT that taught something; never for a no-op PUT, an empty record, a refused record, a 409 or a failed save', async () => {
        const calls = [];
        const afterSave = (params) => calls.push({ ...params, committed: pool.queries.at(-1)?.sql === 'commit' });
        await withServer(async (base) => {
            const first = await call(base, { method: 'PUT', headers: as('alice'), body: learning() });
            assert.equal(first.status, 200, first.text);
            assert.deepEqual(calls, [{ userId: ALICE, committed: true }]);
            assert.equal('learned' in first.json, false, 'learned stays internal');

            const again = await call(base, { method: 'PUT', headers: as('alice'), body: learning() });
            assert.equal(again.status, 200, again.text);
            const empty = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: 'vibe-ch2', progress: record() }] } });
            assert.deepEqual([empty.status, empty.json.records.map((r) => r.state)], [200, ['not_started']]);
            const unknown = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: 'vibe-ch99', progress: record({ seen: ['x'] }) }] } });
            assert.deepEqual(unknown.json.rejected.map((r) => r.error_type), ['unknown_lesson']);
            const reset = await call(`${base}/lesson-reset`, { method: 'POST', headers: as('alice'), body: resetBody() });
            assert.equal(reset.status, 200, reset.text);
            const old = await call(base, { method: 'PUT', headers: as('alice'), body: learning({ progress: record({ seen: ['s2-b1'] }) }) });
            assert.deepEqual(old.json.rejected.map((r) => r.error_type), ['lesson_reset']);
            const stale = await call(base, { method: 'PUT', headers: as('bob'), body: learning() });
            assert.equal(stale.status, 409);
            await quiet(async () => {
                pool.fail({ code: '42P01' });
                const broken = await call(base, { method: 'PUT', headers: as('bob'), body: { ...learning(), epoch: EPOCH } });
                assert.equal(broken.status, 503);
            });
            assert.deepEqual(calls, [{ userId: ALICE, committed: true }], 'only the first PUT taught something');
        }, { afterSave });
    });

    it('a hook that throws or rejects never changes the answer and leaves nothing unhandled; it is only logged', async () => {
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        const warnings = [];
        const { warn } = console;
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            for (const afterSave of [() => { throw Object.assign(new Error('boom'), { code: 'EBOOM' }); }, async () => { throw Object.assign(new Error('boom'), { code: 'EBOOM' }); }]) {
                pool = createLessonProgressPool({ rows: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, pct: 5, state: 'in_progress', progress: record({ seen: ['hook-b1'] }) }] });
                setPoolForTests(pool);
                await withServer(async (base) => {
                    const put = await call(base, { method: 'PUT', headers: as('alice'), body: learning() });
                    assert.equal(put.status, 200, put.text);
                    assert.deepEqual(put.json.rejected, []);
                    assert.equal((await call(base, { headers: as('alice') })).status, 200, 'the server keeps answering');
                }, { afterSave });
            }
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            console.warn = warn;
            process.off('unhandledRejection', onUnhandled);
        }
        assert.deepEqual(unhandled, []);
        assert.deepEqual(warnings, ['[lessonProgress] after-save hook failed: EBOOM', '[lessonProgress] after-save hook failed: EBOOM']);
    });

    it('the default hook (noteLearning) runs after the answer in its own transaction: the lesson\'s XP and today (Japan time) as a learning day; a no-op PUT adds nothing', async () => {
        const settled = async () => {
            // The hook's COMMIT: the fake keeps one transaction at a time, so wait for it before the next request.
            for (let i = 0; i < 200 && !(pool.queries.at(-1)?.sql === 'commit' && pool.queries.at(-2)?.sql === SQL.learningDay); i += 1) {
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
        };
        await withServer(async (base) => {
            const put = await call(base, { method: 'PUT', headers: as('alice'), body: learning() });
            assert.equal(put.status, 200, put.text);
            await settled();
            const statements = pool.progressStatements();
            const hook = statements.slice(statements.lastIndexOf('begin'));
            assert.deepEqual(hook, ['begin', SQL.xpLock, SQL.xpReconcileLessons, SQL.learningDay, 'commit']);
            assert.ok(statements.indexOf('commit') < statements.lastIndexOf('begin'), 'the save committed first');
            assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} start 10`]);
            assert.deepEqual(pool.daysOf(ALICE), [jstDay(new Date())]);
            assert.deepEqual(pool.awardsOf(BOB), []);
            assert.equal(pool.inTransaction(), false);

            const before = pool.queries.length;
            const again = await call(base, { method: 'PUT', headers: as('alice'), body: learning() });
            assert.equal(again.status, 200, again.text);
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.ok(!pool.queries.slice(before).some((q) => q.sql === SQL.xpLock || q.sql === SQL.learningDay), 'a no-op PUT runs no hook');
        }, { afterSave: null });
    });
});
