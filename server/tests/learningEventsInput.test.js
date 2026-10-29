// The learning history (Phase 5 stage 2, design §3.10; tools/core/learningEvents.js and
// server/routes/user.js) and the legacy Blender progress hook (design §3.3):
// - POST /api/v2/user/events is history only (G8): it validates the type (one of the six of the
//   table; an unknown one is 400 validation, where it used to be a 500 from the CHECK), keeps only the
//   string en/jp of title and description (cut to 300 characters), takes an 8 kb body (413
//   body_too_large, 400 invalid_body; every body whose texts fit the 300 kept characters passes, the
//   limit counts bytes before the cut), 30 per learner per minute (429 rate_limited), and writes no
//   XP and no learning day; the 200 shape is unchanged;
// - GET and POST errors carry error_type (503 learning_events_unavailable, 500 learning_events_failed);
// - PUT /api/v2/user/progress/blender calls its hook after the answer, and only for course 'blender'
//   (setBlenderProgressHookForTests); the default hook awards the stage XP and today's day.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { LEARNING_EVENTS_BODY_LIMIT, LEARNING_EVENTS_PER_MINUTE, setBlenderProgressHookForTests } from '../routes/user.js';
import { LEARNING_EVENT_TEXT_MAX, LEARNING_EVENT_TYPES, parseLearningEventInput } from '../../tools/core/learningEvents.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { createLessonProgressPool, jstDay, SQL } from './helpers/lessonProgressPool.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const as = (sub) => ({ Authorization: `Bearer ${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ sub, aud: 'authenticated', role: 'authenticated', exp: 4_000_000_000 })}.c2ln` });
const supabase = {
    auth: {
        getUser: async (token) => {
            const id = decodeTokenClaims(token)?.sub;
            return typeof id === 'string' ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'bad token' } };
        },
    },
};
const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY'];
const SECRET = 'relation "learning_events" does not exist (host db.internal:5432, password=hunter2)';

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false, lessonProgress: { afterSave: () => {} } });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/user`);
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

/** What the reader sends today (services/progressService.ts addLearningEvent → syncEventToApi). */
const lessonStart = { type: 'lesson_start', title: { en: 'Started: Lesson 1', jp: '開始: レッスン 1' }, description: { en: 'Vibe Coding', jp: 'バイブコーディング' } };

describe('parseLearningEventInput (tools/core/learningEvents.js)', () => {
    it('the six types of the learning_events CHECK pass; anything else is refused', () => {
        assert.deepEqual([...LEARNING_EVENT_TYPES], ['lesson_start', 'lesson_complete', 'stage_complete', 'course_complete', 'diagnosis_complete', 'course_generated']);
        for (const type of LEARNING_EVENT_TYPES) assert.deepEqual(parseLearningEventInput({ type }), { ok: true, event: { type, title: {}, description: {} } }, type);
        for (const body of [{}, { type: 'xp_bonus' }, { type: 'Lesson_start' }, { type: ['lesson_start'] }, { type: 5 }, null, [], 'lesson_start', { type: 'lesson_start ' }]) {
            const parsed = parseLearningEventInput(body);
            assert.equal(parsed.ok, false, JSON.stringify(body));
        }
    });

    it('title and description keep only string en and jp, each cut to 300 characters (code points); the rest is dropped', () => {
        assert.equal(LEARNING_EVENT_TEXT_MAX, 300);
        const long = '学'.repeat(400);
        const emoji = '🎓'.repeat(301);
        const parsed = parseLearningEventInput({
            type: 'lesson_complete', id: 'e_1', timestamp: '2026-10-25T00:00:00Z', xp: 9999,
            title: { en: 'Done', jp: long, de: 'Fertig', extra: { nested: true } },
            description: { en: emoji, jp: 42 },
        });
        assert.deepEqual(parsed, { ok: true, event: { type: 'lesson_complete', title: { en: 'Done', jp: '学'.repeat(300) }, description: { en: '🎓'.repeat(300) } } });
        for (const text of [null, 'plain', ['a'], 7]) {
            assert.deepEqual(parseLearningEventInput({ type: 'lesson_start', title: text, description: text }).event, { type: 'lesson_start', title: {}, description: {} }, JSON.stringify(text));
        }
    });
});

describe('/api/v2/user/events and the legacy Blender progress on the server.js stack', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        resetPoolForTests();
        pool = createLessonProgressPool();
        setPoolForTests(pool);
        setSupabaseForTests(supabase);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        setBlenderProgressHookForTests(null);
        resetPoolForTests();
    });

    it('POST: the 200 shape is unchanged; the stored row is the cleaned event; GET lists it newest first', async () => {
        await withServer(async (base) => {
            const posted = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: { ...lessonStart, id: 'e_1', timestamp: '2020-01-01T00:00:00Z' } });
            assert.equal(posted.status, 200, posted.text);
            assert.deepEqual(Object.keys(posted.json), ['ok', 'event']);
            assert.deepEqual(Object.keys(posted.json.event), ['id', 'timestamp']);
            assert.ok(Number.isFinite(Date.parse(posted.json.event.timestamp)));
            const second = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: { type: 'stage_complete', title: { en: 'x'.repeat(500), jp: 'ステージ' }, description: 'not an object' } });
            assert.equal(second.status, 200, second.text);
            assert.deepEqual(pool.eventsOf(ALICE).map((e) => [e.type, e.title, e.description]), [
                ['lesson_start', lessonStart.title, lessonStart.description],
                ['stage_complete', { en: 'x'.repeat(300), jp: 'ステージ' }, {}],
            ]);
            const list = await call(`${base}/events`, { headers: as(ALICE) });
            assert.equal(list.status, 200, list.text);
            assert.deepEqual(Object.keys(list.json), ['ok', 'events']);
            assert.deepEqual(list.json.events.map((e) => e.type), ['stage_complete', 'lesson_start']);
            assert.deepEqual(Object.keys(list.json.events[0]), ['id', 'type', 'title', 'description', 'timestamp']);
            assert.deepEqual((await call(`${base}/events`, { headers: as(BOB) })).json.events, []);
        });
    });

    it('G8: events of every type earn nothing: no statement names xp_awards or learning_days, and the achievements read shows 0 XP and no day', async () => {
        await withServer(async (base) => {
            for (const type of LEARNING_EVENT_TYPES) {
                const posted = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: { type, title: { en: type, jp: type }, description: {} } });
                assert.equal(posted.status, 200, `${type}: ${posted.text}`);
            }
            assert.equal(pool.eventsOf(ALICE).length, LEARNING_EVENT_TYPES.length);
            assert.ok(!pool.queries.some((q) => /xp_awards|learning_days|'xp:'/.test(q.sql)), pool.queries.map((q) => q.sql).join('\n'));
            const achievements = await call(`${base}/achievements`, { headers: as(ALICE) });
            assert.equal(achievements.status, 200, achievements.text);
            assert.deepEqual([achievements.json.xp.total, achievements.json.streak.best, achievements.json.badges.filter((b) => b.earned)], [0, 0, []]);
            assert.deepEqual([pool.awardsOf(ALICE), pool.daysOf(ALICE)], [[], []]);
        });
    });

    it('POST: an unknown or missing type is 400 validation (it was a 500 from the CHECK); nothing is stored', async () => {
        await withServer(async (base) => {
            for (const body of [{ type: 'xp_bonus' }, {}, { type: '' }, [], { type: ['lesson_start'] }]) {
                const res = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body });
                assert.deepEqual([res.status, res.json.error_type], [400, 'validation'], JSON.stringify(body));
            }
        });
        assert.deepEqual(pool.eventsOf(ALICE), []);
        assert.ok(!pool.queries.some((q) => q.sql === SQL.eventsInsert));
    });

    it(`POST: a body over ${LEARNING_EVENTS_BODY_LIMIT} is 413 body_too_large and one that is not JSON 400 invalid_body, before the 2 MB parser and before auth`, async () => {
        assert.equal(LEARNING_EVENTS_BODY_LIMIT, '8kb');
        await withServer(async (base) => {
            const big = { ...lessonStart, description: { en: 'x'.repeat(9 * 1024) } };
            const tooLarge = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: big });
            assert.deepEqual([tooLarge.status, tooLarge.json], [413, { error: 'The request body is larger than 8kb.', error_type: 'body_too_large' }]);
            const notJson = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), rawBody: '{"type": "lesson_start",' });
            assert.deepEqual([notJson.status, notJson.json.error_type], [400, 'invalid_body']);
            const fits = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: { ...lessonStart, description: { en: 'x'.repeat(7 * 1024) } } });
            assert.equal(fits.status, 200, 'under 8 kb still saves (cut to 300 characters)');
        });
        assert.equal(pool.eventsOf(ALICE).length, 1);
    });

    it('POST: every body whose four texts fit the 300 kept characters passes the parser and is kept whole, also in its largest JSON (emoji, \\u escapes)', async () => {
        const full = (char) => char.repeat(LEARNING_EVENT_TEXT_MAX);
        await withServer(async (base) => {
            // 4 bytes per character (about 4.9 KB), and 6 bytes per character, the most JSON.stringify
            // writes for one code point (a \u escape of a control character: about 7.3 KB).
            for (const char of ['🎓', '\u0001']) {
                const body = { type: 'diagnosis_complete', title: { en: full(char), jp: full(char) }, description: { en: full(char), jp: full(char) } };
                const res = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body });
                assert.equal(res.status, 200, `${JSON.stringify(char)} (${Buffer.byteLength(JSON.stringify(body))} bytes): ${res.text}`);
            }
        });
        const stored = pool.eventsOf(ALICE);
        assert.equal(stored.length, 2);
        assert.deepEqual(stored[0].title, { en: '🎓'.repeat(300), jp: '🎓'.repeat(300) }, 'kept whole, not cut');
        assert.deepEqual(stored.map((e) => [e.title.en, e.title.jp, e.description.en, e.description.jp].map((t) => Array.from(t).length)), [[300, 300, 300, 300], [300, 300, 300, 300]]);
    });

    it(`POST: the ${LEARNING_EVENTS_PER_MINUTE + 1}st event of a learner in a minute is 429 rate_limited; another learner is unaffected`, async () => {
        assert.equal(LEARNING_EVENTS_PER_MINUTE, 30);
        await withServer(async (base) => {
            for (let i = 0; i < LEARNING_EVENTS_PER_MINUTE; i += 1) {
                assert.equal((await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: lessonStart })).status, 200, `event ${i + 1}`);
            }
            const limited = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: lessonStart });
            assert.deepEqual([limited.status, limited.json.error_type], [429, 'rate_limited']);
            assert.equal((await call(`${base}/events`, { method: 'POST', headers: as(BOB), body: lessonStart })).status, 200);
            assert.equal((await call(`${base}/events`, { headers: as(ALICE) })).status, 200, 'reading is not limited by it');
        });
        assert.equal(pool.eventsOf(ALICE).length, LEARNING_EVENTS_PER_MINUTE);
    });

    it('GET and POST errors carry error_type: 503 learning_events_unavailable (no database, a missing table, a missing grant), 500 learning_events_failed; never the driver text', async () => {
        await withServer(async (base) => {
            setPoolForTests(null);
            for (const [method, body] of [['GET', undefined], ['POST', lessonStart]]) {
                const res = await call(`${base}/events`, { method, headers: as(ALICE), body });
                assert.deepEqual([res.status, res.json.error_type], [503, 'learning_events_unavailable'], `${method} without a database`);
            }
            setPoolForTests(pool);
            await quiet(async () => {
                for (const [code, status, type] of [['42P01', 503, 'learning_events_unavailable'], ['42501', 503, 'learning_events_unavailable'], [undefined, 500, 'learning_events_failed'], ['23503', 500, 'learning_events_failed']]) {
                    pool.fail({ code, message: SECRET, when: (text) => /learning_events/.test(text) });
                    const get = await call(`${base}/events`, { headers: as(ALICE) });
                    const post = await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: lessonStart });
                    assert.deepEqual([get.status, get.json.error_type, post.status, post.json.error_type], [status, type, status, type], String(code));
                    for (const res of [get, post]) assert.doesNotMatch(res.text, /relation|permission|setup|db\.internal|hunter2/);
                }
            });
            assert.deepEqual([(await call(`${base}/events`, { headers: as(ALICE) })).json?.error, (await call(`${base}/events`, { method: 'POST', headers: as(ALICE), body: lessonStart })).json?.error], ['Failed to load events', 'Failed to add event'], 'the fixed 500 texts');
        });
    });

    it('PUT /progress/:courseId calls the Blender hook after the answer, only for course blender; a hook that throws or rejects never changes the answer', async () => {
        const calls = [];
        setBlenderProgressHookForTests((params) => calls.push({ ...params, stored: pool.queries.at(-1)?.sql === SQL.legacyProgressUpsert }));
        await withServer(async (base) => {
            for (const course of ['vibe-coding', 'blender2', 'Blender', 'blender']) {
                const res = await call(`${base}/progress/${course}`, { method: 'PUT', headers: as(ALICE), body: { completedStages: ['1'], completedSteps: {} } });
                assert.deepEqual([res.status, res.json], [200, { ok: true }], course);
            }
            assert.deepEqual(calls, [{ userId: ALICE, stored: true }]);
            const unhandled = [];
            const onUnhandled = (reason) => unhandled.push(reason);
            process.on('unhandledRejection', onUnhandled);
            try {
                for (const hook of [() => { throw new Error('boom'); }, async () => { throw new Error('boom'); }]) {
                    setBlenderProgressHookForTests(hook);
                    const res = await call(`${base}/progress/blender`, { method: 'PUT', headers: as(ALICE), body: { completedStages: ['1', '2'], completedSteps: {} } });
                    assert.deepEqual([res.status, res.json], [200, { ok: true }]);
                }
                await new Promise((resolve) => setImmediate(resolve));
            } finally {
                process.off('unhandledRejection', onUnhandled);
            }
            assert.deepEqual(unhandled, []);
        });
    });

    it('the default Blender hook (noteBlenderProgress) awards stages 1-4 once (80 each) and today as a learning day, after the answer', async () => {
        const settled = async () => {
            for (let i = 0; i < 200 && pool.queries.at(-1)?.sql !== 'commit'; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        };
        await withServer(async (base) => {
            const res = await call(`${base}/progress/blender`, { method: 'PUT', headers: as(ALICE), body: { completedStages: ['1', '2', '9'], completedSteps: {} } });
            assert.equal(res.status, 200, res.text);
            await settled();
            assert.deepEqual(pool.awardsOf(ALICE), ['blender_stage blender/1 done 80', 'blender_stage blender/2 done 80']);
            assert.deepEqual(pool.daysOf(ALICE), [jstDay(new Date())]);
            const statements = pool.progressStatements();
            assert.deepEqual(statements.slice(statements.lastIndexOf('begin')), ['begin', SQL.xpLock, SQL.xpReconcileStages, SQL.learningDay, 'commit']);
            pool.queries.length = 0;
            await call(`${base}/progress/blender`, { method: 'PUT', headers: as(ALICE), body: { completedStages: ['1', '2', '9'], completedSteps: {} } });
            await settled();
            assert.deepEqual(pool.progressStatements(), ['begin', SQL.xpLock, SQL.xpReconcileStages, 'commit'], 'the same stages again: nothing new, no day');
            assert.equal(pool.xpOf(ALICE), 160);
        });
    });
});
