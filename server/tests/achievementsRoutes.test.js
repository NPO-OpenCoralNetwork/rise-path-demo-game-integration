// GET /api/v2/user/achievements (Phase 5 stage 2, design §3.4; server/routes/achievements.js) on the
// real server.js stack with the in-memory tables of helpers/lessonProgressPool.js (exact SQL):
// - requireAuth + requireSignedIn (G13): no token 401; the dev fallback, the bridge user and an
//   anonymous user 401 sign_in_required (the ledger is a permanent account record, never shared by
//   dev guests); an agent's OAuth token 401 oauth_client_token; a deleted account 401 account_deleted;
// - the 200 shape: XP, level, counts, the streak (Japan time) and the seven badges, for the caller
//   only, with learnerId; reconciled from the server's records on read;
// - the per-learner limit (the 31st read in a minute is 429 rate_limited, other learners unaffected);
// - 503 achievements_unavailable (no database, a missing table, a missing grant) and 500
//   achievements_failed, never the driver's text; GET only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { PHASE1_USER_ID, setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { ACHIEVEMENTS_READS_PER_MINUTE } from '../routes/achievements.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { createLessonProgressPool, jstDay, SQL } from './helpers/lessonProgressPool.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const ANON = 'aaaaaaaa-1111-4000-8000-0000000000a0';
const GONE = 'aaaaaaaa-1111-4000-8000-0000000000d0';
const CLAUDE = '11111111-2222-4000-8000-000000000001';
const MCP_URL = 'https://mcp.example.org/mcp';
const BRIDGE_TOKEN = 'test-bridge-token-for-achievements';
const VIBE = 'vibe-coding';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ role: 'authenticated', exp: 4_000_000_000, ...payload })}.c2ln`;
const as = (sub, extra = {}) => ({ Authorization: `Bearer ${jwt({ sub, aud: 'authenticated', ...extra })}` });

/** Supabase accepts every token and names its sub; ANON is an anonymous user. */
const supabase = {
    auth: {
        getUser: async (token) => {
            const id = decodeTokenClaims(token)?.sub;
            if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
            return { data: { user: { id, is_anonymous: id === ANON } }, error: null };
        },
    },
};

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY'];
const record = { v: 1, seen: ['x'], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z' };
const row = (user, lessonId, state) => ({ user_id: user, course_slug: VIBE, lesson_id: lessonId, state, progress: record });

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false, lessonProgress: { afterSave: () => {} } });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/user/achievements`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const call = async (url, { method = 'GET', headers = {} } = {}) => {
    const response = await fetch(url, { method, headers });
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

describe('GET /api/v2/user/achievements', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        resetPoolForTests();
        pool = createLessonProgressPool({
            rows: [row(ALICE, 'vibe-ch1', 'read'), row(ALICE, 'vibe-ch2', 'in_progress'), row(BOB, 'vibe-ch1', 'mastered')],
            userProgress: [{ user_id: ALICE, course_id: 'blender', completed_stages: ['1', '9'] }],
            days: [{ user_id: BOB, day: '2026-10-01' }],
            tombstones: { [GONE]: { deletedAt: '2026-10-20T00:00:00Z' } },
        });
        setPoolForTests(pool);
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

    it('200: the caller\'s XP, level, counts, streak and badges, reconciled from the server\'s records, with learnerId', async () => {
        await withServer(async (base) => {
            const res = await call(base, { headers: as(ALICE.toUpperCase()) });
            assert.equal(res.status, 200, res.text);
            assert.equal(res.headers.get('cache-control'), 'no-store');
            assert.deepEqual(Object.keys(res.json), ['ok', 'learnerId', 'xp', 'counts', 'streak', 'badges', 'lessonXp']);
            assert.equal(res.json.ok, true);
            assert.equal(res.json.learnerId, ALICE, 'the caller, in lower case');
            assert.deepEqual(res.json.xp, { total: 140, level: 2, intoLevel: 40, levelSize: 100, toNextLevel: 60 }, 'read 50 + started 10 + stage 1 80; stage 9 nothing');
            assert.deepEqual(res.json.counts, { lessonsStarted: 2, lessonsDone: 1, stagesDone: 1 });
            const today = jstDay(new Date());
            assert.deepEqual(res.json.streak, { current: 1, best: 1, activeToday: true, today, timeZone: 'Asia/Tokyo' }, 'the newly awarded stage made today a day');
            assert.deepEqual(res.json.badges.map((b) => [b.id, b.earned]), [
                ['first_lesson', true], ['five_lessons', false], ['fifteen_lessons', false], ['first_course', false],
                ['three_courses', false], ['streak_3', false], ['streak_7', false],
            ]);
            assert.deepEqual(res.json.badges.find((b) => b.id === 'five_lessons'), { id: 'five_lessons', earned: false, current: 2, goal: 5 });
            assert.deepEqual(pool.awardsOf(BOB), [], 'another learner\'s rows are never reconciled by Alice\'s read');
            // Phase 8 (S2): the done award of each finished lesson, for the lesson end; a started one is absent.
            assert.deepEqual(res.json.lessonXp, { 'vibe-coding/vibe-ch1': 40 });

            const bob = await call(base, { headers: as(BOB) });
            assert.deepEqual([bob.json.learnerId, bob.json.xp.total, bob.json.streak.best], [BOB, 50, 1]);
            assert.deepEqual(bob.json.lessonXp, { 'vibe-coding/vibe-ch1': 40 });
        });
    });

    it('G13: no token 401; the dev fallback, the bridge user and an anonymous user 401 sign_in_required; an agent token 401 oauth_client_token; a deleted account 401 account_deleted; no ledger statement', async () => {
        await withServer(async (base) => {
            assert.equal((await call(base)).status, 401);
            assert.equal((await call(base, { headers: { 'x-nexloom-bridge-token': BRIDGE_TOKEN } })).status, 401);
            const anon = await call(base, { headers: as(ANON) });
            assert.deepEqual([anon.status, anon.json], [401, { error: 'Sign in with a Rise Path account to see your XP.', error_type: 'sign_in_required' }]);
            const bridgeUser = await call(base, { headers: as(PHASE1_USER_ID) });
            assert.deepEqual([bridgeUser.status, bridgeUser.json.error_type], [401, 'sign_in_required']);
            const agent = await call(base, { headers: as(ALICE, { aud: MCP_URL, client_id: CLAUDE }) });
            assert.deepEqual([agent.status, agent.json.error_type], [401, 'oauth_client_token']);
            const gone = await call(base, { headers: as(GONE) });
            assert.deepEqual([gone.status, gone.json.error_type], [401, 'account_deleted']);
        });
        process.env.NODE_ENV = 'development';
        setSupabaseForTests(null);
        await withServer(async (base) => {
            const dev = await call(base);
            assert.deepEqual([dev.status, dev.json.error_type], [401, 'sign_in_required'], 'the dev fallback (shared by every dev guest) gets no ledger');
            const devToken = await quiet(() => call(base, { headers: as(ALICE) }));
            assert.deepEqual([devToken.status, devToken.json.error_type], [401, 'sign_in_required'], 'a token without Supabase falls back to the dev user: refused too');
        });
        assert.deepEqual(pool.progressStatements(), []);
        assert.deepEqual(pool.awardsOf(PHASE1_USER_ID), []);
    });

    it('GET only: other methods are not answered by this route and write nothing', async () => {
        await withServer(async (base) => {
            for (const method of ['POST', 'PUT', 'DELETE']) {
                const res = await call(base, { method, headers: as(ALICE) });
                assert.equal(res.status, 404, `${method}: ${res.text.slice(0, 120)}`);
            }
        });
        assert.deepEqual(pool.progressStatements(), []);
    });

    it(`per learner: the ${ACHIEVEMENTS_READS_PER_MINUTE + 1}st read in a minute is 429 rate_limited; another learner is unaffected`, async () => {
        assert.equal(ACHIEVEMENTS_READS_PER_MINUTE, 30);
        await withServer(async (base) => {
            for (let i = 0; i < ACHIEVEMENTS_READS_PER_MINUTE; i += 1) {
                const res = await call(base, { headers: as(ALICE) });
                assert.equal(res.status, 200, `read ${i + 1}: ${res.text.slice(0, 200)}`);
            }
            const limited = await call(base, { headers: as(ALICE) });
            assert.deepEqual([limited.status, limited.json.error_type], [429, 'rate_limited']);
            assert.equal((await call(base, { headers: as(BOB) })).status, 200);
        });
        assert.equal(pool.xpOf(ALICE), 140, 'thirty reads, the same XP');
    });

    it('503 achievements_unavailable without a database, before migration 019 or without a grant (42501); 500 achievements_failed otherwise; never the driver text; nothing awarded', async () => {
        await withServer(async (base) => {
            setPoolForTests(null);
            const none = await call(base, { headers: as(ALICE) });
            assert.equal(none.status, 503, none.text);
            setPoolForTests(pool);
            await quiet(async () => {
                pool.fail({ code: '42P01', message: 'relation "xp_awards" does not exist (host db.internal:5432, password=hunter2)', when: (text) => text === SQL.xpReconcileStages });
                const missing = await call(base, { headers: as(ALICE) });
                assert.deepEqual([missing.status, missing.json], [503, { ok: false, error: 'XP and badges are unavailable right now. Please try again later.', error_type: 'achievements_unavailable' }]);
                pool.fail({ code: '42501', message: 'permission denied for table xp_awards (host db.internal:5432, password=hunter2)', when: (text) => text === SQL.xpAwards });
                const denied = await call(base, { headers: as(ALICE) });
                assert.deepEqual([denied.status, denied.json], [503, { ok: false, error: 'XP and badges are unavailable right now. Please try again later.', error_type: 'achievements_unavailable' }], 'permission_denied');
                pool.fail({ code: '23503', message: 'insert or update on table "xp_awards" violates foreign key constraint (db.internal, password=hunter2)', when: (text) => text === SQL.xpReconcileLessons });
                const broken = await call(base, { headers: as(ALICE) });
                assert.deepEqual([broken.status, broken.json], [500, { ok: false, error: 'XP and badges could not be read.', error_type: 'achievements_failed' }]);
                pool.fail({ message: 'relation "learning_days" (db.internal, password=hunter2)', when: (text) => text === SQL.selectDays });
                const unknown = await call(base, { headers: as(ALICE) });
                assert.equal(unknown.status, 500);
                for (const res of [missing, denied, broken, unknown]) assert.doesNotMatch(res.text, /relation|permission|xp_awards|learning_days|violates|db\.internal|hunter2|getAchievements|setup/);
            });
            assert.equal(pool.inTransaction(), false);
            assert.deepEqual(pool.awardsOf(ALICE), [], 'rolled back');
        });
    });
});
