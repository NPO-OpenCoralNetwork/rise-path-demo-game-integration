// The review queue's REST routes (Phase 6 stage 3, design §3.6, §7.1; server/routes/review.js) on the
// real server.js stack with the in-memory tables of helpers/lessonProgressPool.js (exact SQL, the fake
// clock is every transaction's now()):
// - GET /api/v2/user/review: the read enters the cards the caller's own lesson records imply (a
//   lesson finished through PUT /lesson-progress), today's list with the card texts, learnerId;
// - POST /grade: the review (source 'web'), the 200 shape (no card text), unknown fields ignored
//   (forged times, reveal, another learner's id), no XP;
// - the 2 kb body limit before the 50 MB parser (and before auth): 413 body_too_large, 400 invalid_body;
// - the audience: requireAuth + requireSignedIn (no token, the bridge token, the dev fallback, the
//   bridge user and an anonymous user 401; an agent's token 401 oauth_client_token; a deleted account
//   401 account_deleted);
// - the per-learner limit (reads and grades together: the 61st request in a minute is 429; not
//   relaxed in development);
// - every refusal with fixed text: 400 validation, 404 not_found, 409 not_in_queue / not_due /
//   review_limit with learnerId and summary, 503 review_unavailable, 500 review_failed;
// - the after-grade hook: once after a 200 with the grade's own day, never after a refusal or a
//   failure; the default (noteReviewDay) writes that day as a learning day in its own transaction
//   after the answer (a grade just before 00:00 JST counts on its own day); a hook that throws or
//   rejects only logs.
// The core rules (R1–R4, FSRS) are server/tests/reviewQueueCore.test.js; PostgreSQL is
// scripts/db/verify-phase6.mjs.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { PHASE1_USER_ID, setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { REVIEW_BODY_LIMIT, REVIEW_REQUESTS_PER_MINUTE } from '../routes/review.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { noteReviewDay } from '../../tools/core/achievements.js';
import { clearCatalogCacheForTests, getPublishedLesson } from '../../tools/core/courseCatalog.js';
import { lessonReviewCards } from '../../shared/review/cards.js';
import { GOOD, AGAIN, scheduler, seededUnit } from '../../shared/review/fsrs.js';
import { LESSON_PRIORS, REVIEW_DAILY_LIMIT } from '../../shared/review/queue.js';
import { addDays, createLessonProgressPool, jstDay, SQL } from './helpers/lessonProgressPool.js';

const ALICE = 'aaaaaaaa-6363-4000-8000-000000000001';
const BOB = 'aaaaaaaa-6363-4000-8000-000000000002';
const ANON = 'aaaaaaaa-6363-4000-8000-0000000000a0';
const GONE = 'aaaaaaaa-6363-4000-8000-0000000000d0';
const CLAUDE = '11111111-2222-4000-8000-000000000001';
const MCP_URL = 'https://mcp.example.org/mcp';
const BRIDGE_TOKEN = 'test-bridge-token-for-review-routes';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const CC = 'claude-code';
const CC4 = 'cc-04-verify';
const DAY_MS = 86400000;

delete process.env.RP_CONTENT_DIR;
clearCatalogCacheForTests();
const ch1 = getPublishedLesson(VIBE, CH1);
const cardsOf = (course, lesson) => lessonReviewCards(getPublishedLesson(course, lesson).lesson);
const CH1_CARDS = cardsOf(VIBE, CH1);

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

/** The fake's clock: every transaction's now() (the database decides every day). */
let at = Date.parse('2026-10-20T03:00:00.000Z');
const today = () => jstDay(new Date(at));

const record = (overrides = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-19T00:00:00.000Z', ...overrides });
/** A Good prior learned `daysAgo` Japan-time days before now (due daysAgo − 2 days ago). */
const priorRow = (course, lesson, card, { daysAgo = 2, user = ALICE } = {}) => {
    const learnedAt = new Date(at - daysAgo * DAY_MS);
    const { stability, difficulty, intervalDays } = LESSON_PRIORS.good;
    return { user_id: user, course_slug: course, lesson_id: lesson, card_id: card, learned_at: learnedAt, prior_rating: 3, stability, difficulty, due_day: addDays(jstDay(learnedAt), intervalDays) };
};
/** A card graded today. */
const reviewedTodayRow = (course, lesson, card, user = ALICE) => ({
    user_id: user, course_slug: course, lesson_id: lesson, card_id: card, learned_at: new Date(at - 5 * DAY_MS), prior_rating: 3,
    stability: 10.96, difficulty: 2.11, reps: 1, last_rating: 3, last_review_day: today(), due_day: addDays(today(), 11),
});
const gradeBody = (overrides = {}) => ({ courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', rating: 'good', ...overrides });

const SUMMARY_KEYS = ['today', 'dailyLimit', 'doneToday', 'remainingToday', 'dueTotal', 'carriedOver', 'inQueue', 'nextDueOn'];

/**
 * @param {(base: string) => Promise<void>} handler gets the review mount's URL
 * @param {{ afterGrade?: Function | null }} [options] afterGrade: the hook (default: a recorder the
 *   test reads through `grades`); null keeps the default hook (noteReviewDay)
 */
const withServer = async (handler, { afterGrade } = {}) => {
    const app = await createApp({ serveStatic: false, lessonProgress: { afterSave: () => {} }, review: afterGrade === null ? {} : { afterGrade: afterGrade ?? recordGrade } });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/user/review`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

/** The after-grade hook calls of the default recorder. */
let grades = [];
const recordGrade = (params) => {
    grades.push(params);
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
const post = (base, body, who = ALICE) => call(`${base}/grade`, { method: 'POST', headers: as(who), body });

const quiet = async (fn) => {
    const { error, warn } = console;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    console.warn = (...args) => lines.push(args.join(' '));
    try {
        return { result: await fn(), lines };
    } finally {
        console.error = error;
        console.warn = warn;
    }
};
/** Lets fire-and-forget work after an answer run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Review and XP statements (no lock, no begin/commit). */
const reviewStatements = (pool) => pool.progressStatements().filter((sql) => /review_cards|review_log|xp_awards|learning_days/.test(sql));
/** Every statement in order (normalized), without the sign-in's (the account stub, the deleted-account check). */
const statements = (pool) => pool.queries.map((q) => q.sql).filter((sql) => !/auth\.users|account_deletions/.test(sql));

describe('the review queue routes (/api/v2/user/review)', () => {
    const saved = {};
    let pool;
    const use = (seed = {}) => {
        pool = createLessonProgressPool({ clock: () => new Date(at), tombstones: { [GONE]: { deletedAt: '2026-10-01T00:00:00Z' } }, ...seed });
        setPoolForTests(pool);
        return pool;
    };

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        at = Date.parse('2026-10-20T03:00:00.000Z');
        grades = [];
        resetPoolForTests();
        use();
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

    it('GET 200: the read enters the cards of a lesson the caller finished (from the server\'s own record), lists today\'s due cards with their texts, and carries learnerId', async () => {
        await withServer(async (base) => {
            const put = await call(base.replace('/review', '/lesson-progress'), {
                method: 'PUT', headers: as(ALICE), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: [...ch1.index.readingBlockIds] }) }] },
            });
            assert.deepEqual([put.status, put.json.records[0].state], [200, 'read'], put.text);
            const learned = today();

            const first = await call(base, { headers: as(ALICE.toUpperCase()) });
            assert.equal(first.status, 200, first.text);
            assert.equal(first.headers.get('cache-control'), 'no-store');
            assert.deepEqual(Object.keys(first.json), ['ok', 'learnerId', 'today', 'timeZone', ...SUMMARY_KEYS.slice(1), 'cards']);
            assert.deepEqual(first.json, {
                ok: true, learnerId: ALICE, today: learned, timeZone: 'Asia/Tokyo', dailyLimit: REVIEW_DAILY_LIMIT, doneToday: 0, remainingToday: 0,
                dueTotal: 0, carriedOver: 0, inQueue: CH1_CARDS.length, nextDueOn: addDays(learned, 2), cards: [],
            }, 'the cards entered with the lesson as their first rating (Good): due two days after the learning day');
            assert.equal(pool.reviewRows(ALICE).length, CH1_CARDS.length);

            at += 2 * DAY_MS;
            const due = await call(base, { headers: as(ALICE) });
            assert.deepEqual([due.json.today, due.json.dueTotal, due.json.remainingToday, due.json.carriedOver, due.json.nextDueOn], [addDays(learned, 2), CH1_CARDS.length, CH1_CARDS.length, 0, null]);
            assert.equal(due.json.cards.length, due.json.remainingToday);
            const byId = Object.fromEntries(CH1_CARDS.map((c) => [c.cardId, c]));
            for (const card of due.json.cards) {
                assert.deepEqual(Object.keys(card), ['courseSlug', 'lessonId', 'cardId', 'lessonTitle', 'lessonLocale', 'front', 'back', 'dueOn']);
                assert.deepEqual(card, {
                    courseSlug: VIBE, lessonId: CH1, cardId: card.cardId, lessonTitle: ch1.lesson.title, lessonLocale: ch1.lesson.locale,
                    front: byId[card.cardId].front, back: byId[card.cardId].back, dueOn: addDays(learned, 2),
                }, 'the texts as written in the lesson: the browser resolves the locale');
            }

            const bob = await call(base, { headers: as(BOB) });
            assert.deepEqual([bob.json.learnerId, bob.json.inQueue, bob.json.cards], [BOB, 0, []], 'another learner\'s queue is their own');
        });
    });

    it('GET: one transaction, the learner lock before the entry (begin, lock, entry, checked mark, today, rows, commit); no XP statement', async () => {
        await withServer(async (base) => {
            assert.equal((await call(base, { headers: as(ALICE) })).status, 200);
        });
        assert.deepEqual(statements(pool), ['begin', SQL.advisoryLock, SQL.enterReviewCards, SQL.markReviewCardsChecked, SQL.selectToday, SQL.reviewRows, 'commit']);
    });

    it('POST /grade 200: records the review (source web) and answers { ok, learnerId, graded, summary } without the card text; the after-grade hook runs once, after the answer; no XP', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-backend')] });
        await withServer(async (base) => {
            const res = await post(base, gradeBody(), ALICE.toUpperCase());
            assert.equal(res.status, 200, res.text);
            assert.equal(res.headers.get('cache-control'), 'no-store');
            assert.deepEqual(Object.keys(res.json), ['ok', 'learnerId', 'graded', 'summary']);
            const next = scheduler.review(LESSON_PRIORS.good, GOOD, 2, { fuzzUnit: seededUnit(`${VIBE}/${CH1}/card-frontend#1`) });
            assert.deepEqual(res.json, {
                ok: true,
                learnerId: ALICE,
                graded: { courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', rating: 'good', dueOn: addDays(today(), next.intervalDays), intervalDays: next.intervalDays },
                summary: { today: today(), dailyLimit: REVIEW_DAILY_LIMIT, doneToday: 1, remainingToday: 1, dueTotal: 1, carriedOver: 0, inQueue: 2, nextDueOn: addDays(today(), next.intervalDays) },
            });
            const frontend = CH1_CARDS.find((c) => c.cardId === 'card-frontend');
            for (const text of [frontend.front, frontend.back].flatMap((t) => (typeof t === 'string' ? [t] : Object.values(t)))) {
                assert.equal(res.text.includes(JSON.stringify(text).slice(1, -1)), false, 'no card text in the grade answer');
            }
            await settle();
            assert.deepEqual(grades, [{ userId: ALICE, day: today() }], 'once, with the canonical id and the grade\'s day');
        });
        const [log] = pool.logRows(ALICE);
        assert.deepEqual([pool.logRows(ALICE).length, log.card_id, log.rating, log.elapsed_days, log.source, log.review_day], [1, 'card-frontend', GOOD, 2, 'web', today()]);
        assert.equal(pool.reviewRows(ALICE).find((r) => r.card_id === 'card-frontend').last_review_day, today());
        assert.deepEqual(pool.awardsOf(ALICE), [], 'reviews earn no XP');
        assert.deepEqual(pool.progressStatements().filter((sql) => /xp_awards|learning_days|'xp:'/.test(sql)), [], 'no XP or learning-day statement in the review (the hook here is a recorder)');
    });

    it('the body names the card and the rating only: forged times, reveal, a source and another learner\'s id are ignored; "again" records 「もう一度」', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-backend', { user: BOB })] });
        await withServer(async (base) => {
            const res = await post(base, gradeBody({
                rating: 'again', reveal: true, source: 'mcp', userId: BOB, learnerId: BOB,
                today: '2030-01-01', dueDay: '2030-01-01', dueOn: '2030-01-01', reviewedAt: '2030-01-01T00:00:00Z', intervalDays: 365,
            }));
            assert.equal(res.status, 200, res.text);
            const next = scheduler.review(LESSON_PRIORS.good, AGAIN, 2, { fuzzUnit: seededUnit(`${VIBE}/${CH1}/card-frontend#1`) });
            assert.deepEqual([res.json.learnerId, res.json.graded.rating, res.json.graded.intervalDays, res.json.graded.dueOn, res.json.summary.today], [ALICE, 'again', next.intervalDays, addDays(today(), next.intervalDays), today()]);
        });
        const [log] = pool.logRows(ALICE);
        assert.deepEqual([log.rating, log.source, log.review_day], [AGAIN, 'web', today()]);
        const row = pool.reviewRows(ALICE)[0];
        assert.deepEqual([row.lapses, row.last_rating, row.last_review_day], [1, AGAIN, today()]);
        assert.deepEqual([pool.logRows(BOB), pool.reviewRows(BOB)[0].reps], [[], 0], 'Bob untouched');
    });

    it('the database\'s clock decides the day: 23:59 and 00:01 in Japan record on two Japan-time days', async () => {
        at = Date.parse('2026-10-20T14:59:30.000Z'); // 23:59:30 JST
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 3 }), priorRow(VIBE, CH1, 'card-backend', { daysAgo: 3 })] });
        await withServer(async (base) => {
            assert.equal((await post(base, gradeBody({ today: '2026-10-21' }))).status, 200);
            at = Date.parse('2026-10-20T15:00:30.000Z'); // 00:00:30 JST, the next day
            const next = await post(base, gradeBody({ cardId: 'card-backend', today: '2026-10-20' }));
            assert.deepEqual([next.status, next.json.summary.today, next.json.summary.doneToday], [200, '2026-10-21', 1], 'a new Japan-time day: yesterday\'s grade no longer counts');
        });
        assert.deepEqual(pool.logRows(ALICE).map((r) => [r.card_id, r.review_day, r.elapsed_days]), [['card-backend', '2026-10-21', 4], ['card-frontend', '2026-10-20', 3]]);
    });

    it(`the ${REVIEW_BODY_LIMIT} body limit runs before the 50 MB parser and before auth: 3 kB 413 body_too_large, not JSON 400 invalid_body; a body just under it is read`, async () => {
        assert.equal(REVIEW_BODY_LIMIT, '2kb');
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend')] });
        await withServer(async (base) => {
            const big = gradeBody({ padding: 'x'.repeat(3 * 1024) });
            for (const headers of [as(ALICE), {}]) {
                const tooLarge = await call(`${base}/grade`, { method: 'POST', headers, body: big });
                assert.deepEqual([tooLarge.status, tooLarge.json], [413, { error: 'The request body is larger than 2kb.', error_type: 'body_too_large' }]);
                const notJson = await call(`${base}/grade`, { method: 'POST', headers, rawBody: '{"courseSlug": "vibe-coding",' });
                assert.deepEqual([notJson.status, notJson.json], [400, { error: 'The request body is not valid JSON.', error_type: 'invalid_body' }]);
            }
            assert.deepEqual(pool.progressStatements(), [], 'refused before any statement');
            const body = gradeBody();
            const fits = gradeBody({ padding: 'x'.repeat(2000 - JSON.stringify({ ...body, padding: '' }).length) });
            assert.equal(JSON.stringify(fits).length, 2000);
            const ok = await post(base, fits);
            assert.equal(ok.status, 200, ok.text);
        });
    });

    it('the audience: no token 401; the bridge token 401; an anonymous user, the bridge user and the dev fallback 401 sign_in_required; an agent\'s token 401 oauth_client_token; a deleted account 401 account_deleted; no review statement', async () => {
        const requests = (base, headers) => [
            call(base, { headers }),
            call(`${base}/grade`, { method: 'POST', headers, body: gradeBody() }),
        ];
        await withServer(async (base) => {
            for (const res of await Promise.all(requests(base, {}))) assert.equal(res.status, 401);
            for (const res of await Promise.all(requests(base, { 'x-nexloom-bridge-token': BRIDGE_TOKEN }))) assert.equal(res.status, 401);
            for (const res of await Promise.all(requests(base, as(ANON)))) {
                assert.deepEqual([res.status, res.json], [401, { error: 'Sign in with a Rise Path account to use reviews.', error_type: 'sign_in_required' }]);
            }
            for (const res of await Promise.all(requests(base, as(PHASE1_USER_ID)))) assert.deepEqual([res.status, res.json.error_type], [401, 'sign_in_required']);
            for (const res of await Promise.all(requests(base, as(ALICE, { aud: MCP_URL, client_id: CLAUDE })))) {
                assert.deepEqual([res.status, res.json.error_type], [401, 'oauth_client_token'], 'AI apps use the MCP course-review-* tools');
            }
            for (const res of await Promise.all(requests(base, as(GONE)))) assert.deepEqual([res.status, res.json.error_type], [401, 'account_deleted']);
        });
        process.env.NODE_ENV = 'development';
        setSupabaseForTests(null);
        await withServer(async (base) => {
            for (const res of await Promise.all(requests(base, {}))) {
                assert.deepEqual([res.status, res.json.error_type], [401, 'sign_in_required'], 'the dev fallback (shared by every dev guest) has no queue');
            }
            const devToken = await quiet(() => Promise.all(requests(base, as(ALICE))));
            for (const res of devToken.result) assert.deepEqual([res.status, res.json.error_type], [401, 'sign_in_required'], 'a token without Supabase falls back to the dev user: refused too');
        });
        assert.deepEqual(pool.progressStatements(), []);
        assert.deepEqual(grades, []);
    });

    it('400 validation for a body that cannot name a card or a rating other than "again"/"good" (also reveal without a rating), with fixed text and no statement', async () => {
        await withServer(async (base) => {
            const bodies = [
                [], {}, gradeBody({ courseSlug: 7 }), gradeBody({ lessonId: null }), gradeBody({ cardId: ['card-frontend'] }),
                gradeBody({ rating: undefined }), gradeBody({ rating: 'hard' }), gradeBody({ rating: 'Good' }), gradeBody({ rating: 3 }), gradeBody({ rating: 'easy' }),
                { courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', reveal: true },
                gradeBody({ courseSlug: 'Vibe-Coding' }), gradeBody({ lessonId: '../vibe-ch1' }), gradeBody({ cardId: 'Card Frontend' }), gradeBody({ cardId: 'c'.repeat(81) }),
            ];
            for (const body of bodies) {
                const res = await post(base, body);
                assert.deepEqual([res.status, res.json], [400, {
                    ok: false,
                    error: 'Send a JSON object { courseSlug, lessonId, cardId, rating } naming a review card, with rating "again" or "good".',
                    error_type: 'validation',
                }], JSON.stringify(body));
            }
        });
        assert.deepEqual(pool.progressStatements(), []);
        assert.deepEqual(grades, []);
    });

    it('404 not_found for a card that is not in a published lesson (no statement); 409 not_in_queue with learnerId and the summary', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-backend', { daysAgo: 0 })] });
        await withServer(async (base) => {
            for (const body of [gradeBody({ cardId: 'card-nope' }), gradeBody({ lessonId: 'vibe-ch99' }), gradeBody({ courseSlug: 'nope' })]) {
                const res = await post(base, body);
                assert.deepEqual([res.status, res.json], [404, { ok: false, error: 'This card is not in a published lesson.', error_type: 'not_found' }], JSON.stringify(body));
            }
            assert.deepEqual(pool.progressStatements(), []);
            const res = await post(base, gradeBody());
            assert.deepEqual(Object.keys(res.json), ['ok', 'error', 'error_type', 'learnerId', 'summary']);
            assert.deepEqual([res.status, res.json], [409, {
                ok: false, error: 'This card is not in your reviews.', error_type: 'not_in_queue', learnerId: ALICE,
                summary: { today: today(), dailyLimit: REVIEW_DAILY_LIMIT, doneToday: 0, remainingToday: 0, dueTotal: 0, carriedOver: 0, inQueue: 1, nextDueOn: addDays(today(), 2) },
            }]);
            assert.equal(pool.progressStatements().at(-1), 'rollback');
        });
        assert.deepEqual([pool.logRows(ALICE), grades], [[], []]);
    });

    it('409 not_due: a card due later (reviewedToday false, dueOn); a second grade the same day (reviewedToday true: a retry after a lost answer); one log row, one hook call', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-backend', { daysAgo: 0 })] });
        await withServer(async (base) => {
            const later = await post(base, gradeBody({ cardId: 'card-backend' }));
            assert.deepEqual(Object.keys(later.json), ['ok', 'error', 'error_type', 'learnerId', 'reviewedToday', 'dueOn', 'summary']);
            assert.deepEqual([later.status, later.json.error, later.json.error_type, later.json.learnerId, later.json.reviewedToday, later.json.dueOn], [409, 'This card is not due today.', 'not_due', ALICE, false, addDays(today(), 2)]);
            assert.deepEqual([later.json.summary.dueTotal, later.json.summary.doneToday], [1, 0]);

            const first = await post(base, gradeBody());
            assert.equal(first.status, 200, first.text);
            const again = await post(base, gradeBody({ rating: 'again' }));
            assert.deepEqual([again.status, again.json.error, again.json.error_type, again.json.learnerId, again.json.reviewedToday, again.json.dueOn],
                [409, 'This card was already recorded today.', 'not_due', ALICE, true, first.json.graded.dueOn]);
            assert.deepEqual(again.json.summary, first.json.summary, 'the counts as after the first grade');
            await settle();
        });
        assert.equal(pool.logRows(ALICE).length, 1);
        assert.equal(pool.logRows(ALICE)[0].rating, GOOD, 'the first rating stands');
        assert.deepEqual(grades, [{ userId: ALICE, day: today() }]);
    });

    it(`409 review_limit at ${REVIEW_DAILY_LIMIT} cards graded today, with learnerId, doneToday, dailyLimit and the summary`, async () => {
        const done = cardsOf(CC, CC4).slice(0, 7).map((c) => reviewedTodayRow(CC, CC4, c.cardId));
        use({ reviewCards: [...done, ...CH1_CARDS.slice(1, 4).map((c) => reviewedTodayRow(VIBE, CH1, c.cardId)), priorRow(VIBE, CH1, 'card-frontend')] });
        await withServer(async (base) => {
            const res = await post(base, gradeBody());
            assert.deepEqual(Object.keys(res.json), ['ok', 'error', 'error_type', 'learnerId', 'doneToday', 'dailyLimit', 'summary']);
            assert.deepEqual([res.status, res.json.error, res.json.error_type, res.json.learnerId, res.json.doneToday, res.json.dailyLimit],
                [409, `You have reviewed ${REVIEW_DAILY_LIMIT} cards today. The rest come back on later days.`, 'review_limit', ALICE, 10, 10]);
            assert.deepEqual([res.json.summary.doneToday, res.json.summary.remainingToday, res.json.summary.carriedOver], [10, 0, 1]);
            const read = await call(base, { headers: as(ALICE) });
            assert.deepEqual([read.json.remainingToday, read.json.carriedOver, read.json.cards], [0, 1, []], 'the list agrees');
        });
        assert.deepEqual([pool.logRows(ALICE), grades], [[], []]);
    });

    it('the defensive not_due of a duplicate log row (rows edited by hand) answers 409 without a summary', async () => {
        use({
            reviewCards: [priorRow(VIBE, CH1, 'card-frontend')],
            reviewLog: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, card_id: 'card-frontend', review_day: today(), rating: 3, interval_days: 2, stability: 2.3, difficulty: 2.1, source: 'web' }],
        });
        await withServer(async (base) => {
            const res = await post(base, gradeBody());
            assert.deepEqual([res.status, res.json], [409, {
                ok: false, error: 'This card was already recorded today.', error_type: 'not_due', learnerId: ALICE, reviewedToday: true, dueOn: today(),
            }]);
        });
        assert.equal(pool.reviewRows(ALICE)[0].reps, 0, 'rolled back');
        assert.deepEqual(grades, []);
    });

    it('503 review_unavailable without a database, when it is down, before migration 020 (42P01, or 42703 on the entry\'s lesson_progress column) or without a grant (42501); 500 review_failed otherwise; never the driver\'s text; no hook', async () => {
        const UNAVAILABLE = { ok: false, error: 'Reviews are unavailable right now. Please try again later.', error_type: 'review_unavailable' };
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend')] });
        await withServer(async (base) => {
            setPoolForTests(null);
            assert.deepEqual([(await call(base, { headers: as(ALICE) })).json, (await post(base, gradeBody())).json].map((j) => j), [UNAVAILABLE, UNAVAILABLE]);
            setPoolForTests(pool);
            await quiet(async () => {
                const secret = '(host db.internal:5432, password=hunter2)';
                const answers = [];
                pool.failConnect(Object.assign(new Error(`connect ECONNREFUSED ${secret}`), { code: 'ECONNREFUSED' }));
                answers.push([await call(base, { headers: as(ALICE) }), 503, UNAVAILABLE]);
                pool.failConnect(null);
                pool.fail({ code: '42P01', message: `relation "review_cards" does not exist ${secret}`, when: (text) => text === SQL.enterReviewCards });
                answers.push([await call(base, { headers: as(ALICE) }), 503, UNAVAILABLE]);
                // Before migration 020 PostgreSQL reports the entry's missing lesson_progress column first (42703).
                pool.fail({ code: '42703', message: `column p.progress_changed_at does not exist ${secret}`, when: (text) => text === SQL.enterReviewCards });
                answers.push([await call(base, { headers: as(ALICE) }), 503, UNAVAILABLE]);
                pool.fail({ code: '42501', message: `permission denied for table review_cards ${secret}`, when: (text) => text === SQL.lockReviewCard });
                answers.push([await post(base, gradeBody()), 503, UNAVAILABLE]);
                pool.fail({ code: '23503', message: `insert on table "review_log" violates foreign key constraint ${secret}`, when: (text) => text === SQL.insertReviewLog });
                answers.push([await post(base, gradeBody()), 500, { ok: false, error: 'The review could not be recorded.', error_type: 'review_failed' }]);
                pool.fail({ message: `relation "review_cards" ${secret}`, when: (text) => text === SQL.reviewRows });
                answers.push([await call(base, { headers: as(ALICE) }), 500, { ok: false, error: 'Reviews could not be read.', error_type: 'review_failed' }]);
                for (const [res, status, json] of answers) {
                    assert.deepEqual([res.status, res.json], [status, json]);
                    assert.doesNotMatch(res.text, /relation|permission|review_cards|review_log|violates|db\.internal|hunter2|getReviewQueue|gradeReviewCard|setup|ECONNREFUSED/);
                }
            });
            assert.equal(pool.inTransaction(), false);
            await settle();
        });
        assert.deepEqual([pool.logRows(ALICE), pool.reviewRows(ALICE)[0].reps, grades], [[], 0, []], 'nothing recorded, no hook');
    });

    it(`per learner: the ${REVIEW_REQUESTS_PER_MINUTE + 1}st request in a minute (reads and grades together) is 429 rate_limited; another learner is unaffected`, async () => {
        assert.equal(REVIEW_REQUESTS_PER_MINUTE, 60);
        await withServer(async (base) => {
            for (let i = 0; i < REVIEW_REQUESTS_PER_MINUTE; i += 1) {
                const res = i % 2 === 0 ? await call(base, { headers: as(ALICE) }) : await post(base, gradeBody());
                assert.equal(res.status, i % 2 === 0 ? 200 : 409, `request ${i + 1}: ${res.text.slice(0, 200)}`);
            }
            const limited = await call(base, { headers: as(ALICE) });
            assert.deepEqual([limited.status, limited.json], [429, { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' }]);
            const limitedGrade = await post(base, gradeBody());
            assert.deepEqual([limitedGrade.status, limitedGrade.json.error_type], [429, 'rate_limited']);
            assert.equal((await call(base, { headers: as(BOB) })).status, 200);
        });
        // Not relaxed in development (unlike the global and AI limits): the same 60 for a signed-in learner.
        process.env.NODE_ENV = 'development';
        await withServer(async (base) => {
            for (let i = 0; i < REVIEW_REQUESTS_PER_MINUTE; i += 1) {
                const res = await call(base, { headers: as(ALICE) });
                assert.deepEqual([res.status, res.json?.learnerId], [200, ALICE], `development, request ${i + 1}: ${res.text.slice(0, 200)}`);
            }
            const limited = await call(base, { headers: as(ALICE) });
            assert.deepEqual([limited.status, limited.json], [429, { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' }], 'development: the 61st is 429 too');
        });
    });

    it('the default after-grade hook (noteReviewDay) writes the grade\'s day as a learning day in its own transaction after the answer, never XP; a hook that throws or rejects only logs', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-backend'), priorRow(VIBE, CH1, 'card-api')] });
        await withServer(async (base) => {
            const res = await post(base, gradeBody());
            assert.equal(res.status, 200, res.text);
            await settle();
        }, { afterGrade: null });
        assert.deepEqual(pool.daysOf(ALICE), [today()]);
        const sent = statements(pool);
        assert.deepEqual(sent.slice(sent.lastIndexOf(SQL.insertReviewLog)), [SQL.insertReviewLog, SQL.selectToday, SQL.reviewRows, 'commit', 'begin', SQL.reviewLearningDay, 'commit'],
            'the grade commits, then the learning day in its own transaction');
        assert.deepEqual(pool.awardsOf(ALICE), []);

        const { lines } = await quiet(async () => {
            await withServer(async (base) => {
                assert.equal((await post(base, gradeBody({ cardId: 'card-backend' }))).status, 200);
                await settle();
            }, { afterGrade: () => { throw Object.assign(new Error('boom db.internal'), { code: 'EBOOM' }); } });
            await withServer(async (base) => {
                assert.equal((await post(base, gradeBody({ cardId: 'card-api' }))).status, 200);
                await settle();
            }, { afterGrade: async () => { throw Object.assign(new Error('later db.internal'), { code: '23503' }); } });
        });
        assert.deepEqual(lines.filter((l) => l.startsWith('[review]')), ['[review] after-grade hook failed: EBOOM', '[review] after-grade hook failed: 23503']);
        assert.equal(lines.some((l) => /db\.internal/.test(l)), false, 'the code only');
        assert.equal(pool.logRows(ALICE).length, 3, 'every grade stands');
    });

    it('the learning day is the grade\'s own Japan-time day: a grade that commits at 23:59:59 JST counts on that day when its hook runs after 00:00', async () => {
        at = Date.parse('2026-10-20T14:59:59.900Z'); // 23:59:59.9 JST on the 20th
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend')] });
        /** The default hook, its transaction beginning just after midnight (the next Japan-time day). */
        const afterMidnight = (params) => {
            at = Date.parse('2026-10-20T15:00:00.100Z');
            return noteReviewDay(params);
        };
        await withServer(async (base) => {
            const res = await post(base, gradeBody());
            assert.deepEqual([res.status, res.json?.summary?.today], [200, '2026-10-20'], res.text);
            await settle();
        }, { afterGrade: afterMidnight });
        assert.equal(jstDay(new Date(at)), '2026-10-21', 'the hook ran on the next day');
        assert.deepEqual(pool.logRows(ALICE).map((r) => r.review_day), ['2026-10-20']);
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-20'], 'the review\'s day, so the streak keeps the 20th');
    });

    it('R4 through the lesson-progress routes: starting a lesson over takes its cards out of the queue (a grade is then 409 not_in_queue); deleting all progress empties it; XP stays', async () => {
        const cc4 = cardsOf(CC, CC4)[0].cardId;
        use({
            rows: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, state: 'read', progress: record({ seen: [...ch1.index.readingBlockIds] }) }],
            reviewCards: [...CH1_CARDS.map((c) => priorRow(VIBE, CH1, c.cardId)), priorRow(CC, CC4, cc4)],
        });
        await withServer(async (base) => {
            const progress = base.replace('/review', '/lesson-progress');
            assert.equal((await post(base, gradeBody())).status, 200, 'a review of the lesson first');
            assert.equal((await call(base, { headers: as(ALICE) })).json.inQueue, CH1_CARDS.length + 1);
            const reset = await call(`${progress}/lesson-reset`, { method: 'POST', headers: as(ALICE), body: { epoch: null, courseSlug: VIBE, lessonId: CH1 } });
            assert.equal(reset.status, 200, reset.text);
            const xp = pool.awardsOf(ALICE);
            assert.deepEqual(xp, [`lesson ${VIBE}/${CH1} done 40`, `lesson ${VIBE}/${CH1} start 10`], 'the lesson\'s XP stays earned (Phase 5); the review earned none');
            const after = await call(base, { headers: as(ALICE) });
            assert.deepEqual([after.json.inQueue, after.json.doneToday, after.json.cards.map((c) => c.cardId)], [1, 0, [cc4]], 'the restarted lesson\'s cards and their review are gone');
            const refused = await post(base, gradeBody({ cardId: CH1_CARDS[1].cardId }));
            assert.deepEqual([refused.status, refused.json.error_type, refused.json.summary.inQueue], [409, 'not_in_queue', 1]);
            assert.equal((await call(progress, { method: 'DELETE', headers: as(ALICE) })).status, 200);
            const empty = await call(base, { headers: as(ALICE) });
            assert.deepEqual([empty.json.inQueue, empty.json.cards], [0, []]);
            assert.deepEqual(pool.awardsOf(ALICE), xp, 'XP stays (Phase 5 O2)');
        });
        assert.deepEqual([pool.reviewRows(ALICE), pool.logRows(ALICE)], [[], []]);
    });

    it('GET / and POST /grade only: other methods and paths are not answered by this router and write nothing', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend')] });
        await withServer(async (base) => {
            for (const [method, path] of [['POST', ''], ['PUT', ''], ['DELETE', ''], ['GET', '/grade'], ['PUT', '/grade'], ['POST', '/reveal']]) {
                const res = await call(`${base}${path}`, { method, headers: as(ALICE), body: method === 'GET' ? undefined : gradeBody() });
                assert.equal(res.status, 404, `${method} ${path}: ${res.text.slice(0, 120)}`);
            }
        });
        assert.deepEqual(reviewStatements(pool), []);
        assert.deepEqual(grades, []);
    });
});
