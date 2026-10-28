// XP on the server (Phase 5, tools/core/achievements.js; design §3.1-§3.6), against the in-memory
// tables of helpers/lessonProgressPool.js (exact SQL, the xp_awards amount CHECK).
// Stage 1, the reconcilers:
// - lesson awards come from lesson_progress.state only: start 10 once started, done 40 once read,
//   checked or mastered; a reconcile twice adds nothing (G6);
// - Blender stage awards only for blender/1..4 of course 'blender' (G7), 80 each, once; a stage
//   newly awarded adds today (Japan time, server clock) as a learning day, and only then;
// - delete-all's statement awards exactly the rows it deletes (deleteLessonsKeepingXp).
// Stage 2, the read path and the hooks:
// - getAchievements reconciles, then reads the ledger, the days and today in one transaction;
//   repeated reads never add; learning events earn nothing (no statement reads them);
// - levelOf (O1: floor(total / 100) + 1), streakOf (today or yesterday keeps the run; JST days),
//   summarizeAchievements (the seven badges, earned exactly at their goal; G33: an unearned streak
//   badge shows the current run, never the best);
// - Phase 8 (S2): lessonXpOf and getAchievements' lessonXp (each lesson's done award from the
//   ledger rows the read already holds; no new statement; kept after a reset and a delete-all, O2);
// - noteLearning (lesson XP + today) and noteBlenderProgress (stage XP + today when new) only log a
//   failure, never throw.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { inTransaction } from '../../tools/core/dbTransaction.js';
import {
    BADGES, BLENDER_STAGES, DAYS_SQL, DELETE_LESSONS_KEEPING_XP_SQL, LESSON_XP_SELECT, LESSON_XP_SQL, BLENDER_XP_SQL, TODAY_SQL,
    XP_AWARDS_SQL, XP_LOCK_SQL, XP_PER_LEVEL,
    badgeCourses, deleteLessonsKeepingXp, getAchievements, lessonXpOf, levelOf, noteBlenderProgress, noteLearning, reconcileBlenderXp,
    reconcileLessonXp, streakOf, summarizeAchievements,
} from '../../tools/core/achievements.js';
import { deleteAllLessonProgress, resetLessonProgress } from '../../tools/core/lessonProgress.js';
import { createLessonProgressPool, jstDay, norm, SQL } from './helpers/lessonProgressPool.js';
import { publishedLessons } from './helpers/publishedLessons.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const record = { v: 1, seen: ['x'], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z' };
const row = (lessonId, state, user = ALICE, course = 'vibe-coding') => ({ user_id: user, course_slug: course, lesson_id: lessonId, state, progress: record });

let pool;
const use = (seed) => {
    pool = createLessonProgressPool(seed);
    setPoolForTests(pool);
};
/** Runs a reconciler in its own transaction, as reset, delete-all and (stage 2) the read do. */
const inTx = (fn) => inTransaction('test', async (db) => ({ commit: true, value: await fn(db) }));

beforeEach(() => resetPoolForTests());
afterEach(() => resetPoolForTests());

describe('reconcileLessonXp', () => {
    it('start 10 once a lesson is started, done 40 once read, checked or mastered; not_started earns nothing; only the learner\'s rows', async () => {
        use({
            rows: [
                row('l-new', 'not_started'), row('l-started', 'in_progress'), row('l-read', 'read'),
                row('l-checked', 'checked'), row('l-mastered', 'mastered'), row('l-bob', 'mastered', BOB),
            ],
        });
        await inTx((db) => reconcileLessonXp(db, ALICE));
        assert.deepEqual(pool.awardsOf(ALICE), [
            'lesson vibe-coding/l-checked done 40', 'lesson vibe-coding/l-checked start 10',
            'lesson vibe-coding/l-mastered done 40', 'lesson vibe-coding/l-mastered start 10',
            'lesson vibe-coding/l-read done 40', 'lesson vibe-coding/l-read start 10',
            'lesson vibe-coding/l-started start 10',
        ]);
        assert.equal(pool.xpOf(ALICE), 160);
        assert.deepEqual(pool.awardsOf(BOB), []);
        assert.deepEqual(pool.daysOf(ALICE), [], 'the lesson reconcile adds no day (the save hook does, stage 2)');
    });

    it('G6: under the per-learner XP lock, ordered by item and milestone, inserted once: a second reconcile adds no row', async () => {
        use({ rows: [row('l-read', 'read'), row('l-started', 'in_progress')] });
        await inTx((db) => reconcileLessonXp(db, ALICE));
        const first = pool.awardsOf(ALICE);
        await inTx((db) => reconcileLessonXp(db, ALICE));
        assert.deepEqual(pool.awardsOf(ALICE), first);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.xpLock, SQL.xpReconcileLessons, 'commit', 'begin', SQL.xpLock, SQL.xpReconcileLessons, 'commit']);
        assert.deepEqual(pool.queries.filter((q) => q.sql === SQL.xpLock).map((q) => q.params), [[ALICE], [ALICE]]);
        // The shipped text: ON CONFLICT DO NOTHING on the primary key, ORDER BY the key (no deadlock
        // between two reconciles of one learner), the learner's rows only.
        assert.match(LESSON_XP_SQL, /\n ORDER BY 3, 4\nON CONFLICT \(user_id, source, item_key, milestone\) DO NOTHING$/);
        assert.match(LESSON_XP_SQL, /AND p\.user_id = \$1\n/);
        assert.match(XP_LOCK_SQL, /pg_advisory_xact_lock\(hashtext\('xp:' \|\| \$1::uuid::text\)\)/);
    });

    it('awards stay when the record is emptied later (the ledger is never reconciled downwards)', async () => {
        use({ rows: [row('l-read', 'read')] });
        await inTx((db) => reconcileLessonXp(db, ALICE));
        pool.row(ALICE, 'vibe-coding', 'l-read').state = 'not_started';
        await inTx((db) => reconcileLessonXp(db, ALICE));
        assert.equal(pool.xpOf(ALICE), 50);
    });
});

describe('XP_LOCK_SQL: one lock per learner, whatever the case of the id', () => {
    it('the key is the canonical uuid text: a reset and a delete-all sent with an upper-case id take the read\'s and the hooks\' lock', async () => {
        const UPPER = ALICE.toUpperCase();
        use({ rows: [row('vibe-ch1', 'read')], userProgress: [{ user_id: ALICE, course_id: 'blender', completed_stages: ['1'] }] });
        assert.equal(norm(XP_LOCK_SQL), SQL.xpLock);
        const reset = await resetLessonProgress({ userId: UPPER, epoch: null, courseSlug: 'vibe-coding', lessonId: 'vibe-ch1' });
        assert.equal('error_type' in reset, false, JSON.stringify(reset));
        const read = await getAchievements({ userId: ALICE });
        assert.equal('error_type' in read, false, JSON.stringify(read));
        const deleted = await deleteAllLessonProgress({ userId: UPPER });
        assert.equal('error_type' in deleted, false, JSON.stringify(deleted));
        assert.equal(await noteLearning({ userId: ALICE }), true);
        assert.equal(await noteBlenderProgress({ userId: UPPER }), true);
        await inTx((db) => reconcileLessonXp(db, UPPER));
        const sent = pool.queries.filter((q) => q.sql === SQL.xpLock).map((q) => q.params[0]);
        assert.ok(sent.includes(UPPER) && sent.includes(ALICE), `the ids arrived in both spellings: ${sent.join(', ')}`);
        assert.deepEqual(pool.xpLockKeys(), Array(sent.length).fill(`xp:${ALICE}`), 'every caller hashed the same key');
        // Postgres refuses a non-uuid in the cast (22P02); every caller validates the id first.
        assert.equal((await inTx((db) => reconcileLessonXp(db, 'not-a-uuid'))).error_type, 'validation');
    });
});

describe('deleteLessonsKeepingXp (delete-all)', () => {
    it('one statement under the XP lock deletes the learner\'s rows and awards exactly what they earned, with the reconcile\'s rule', async () => {
        use({ rows: [row('l-new', 'not_started'), row('l-started', 'in_progress'), row('l-read', 'read'), row('l-bob', 'mastered', BOB)] });
        const deleted = await inTx((db) => deleteLessonsKeepingXp(db, ALICE));
        assert.equal(deleted, 3);
        assert.deepEqual(pool.rows().map((r) => r.lesson_id), ['l-bob']);
        assert.deepEqual(pool.awardsOf(ALICE), ['lesson vibe-coding/l-read done 40', 'lesson vibe-coding/l-read start 10', 'lesson vibe-coding/l-started start 10']);
        assert.deepEqual(pool.awardsOf(BOB), []);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.xpLock, SQL.deleteLessonsKeepingXp, 'commit']);
        assert.equal(norm(DELETE_LESSONS_KEEPING_XP_SQL), SQL.deleteLessonsKeepingXp);
        // The same award rule as the reconcile and the backfill, read from the DELETE's RETURNING.
        assert.ok(norm(DELETE_LESSONS_KEEPING_XP_SQL).includes(norm(LESSON_XP_SELECT).replace('from lesson_progress p', 'from gone p')));
        assert.match(DELETE_LESSONS_KEEPING_XP_SQL, /^WITH gone AS \(\n {2}DELETE FROM lesson_progress WHERE user_id = \$1\n {2}RETURNING user_id, course_slug, lesson_id, state\n/);
        assert.equal(await inTx((db) => deleteLessonsKeepingXp(db, ALICE)), 0, 'nothing left: nothing deleted, nothing awarded');
        assert.equal(pool.xpOf(ALICE), 60);
    });
});

describe('reconcileBlenderXp', () => {
    it('G7: only stages 1-4 of course blender, 80 each, once: forged ids and other courses earn nothing', async () => {
        use({
            userProgress: [
                { user_id: ALICE, course_id: 'blender', completed_stages: ['1', '2', '9', '1', '1; drop', '', '01', 'blender/3'] },
                { user_id: ALICE, course_id: 'blender2', completed_stages: ['3', '4'] },
                { user_id: ALICE, course_id: 'vibe-coding', completed_stages: ['1'] },
                { user_id: BOB, course_id: 'blender', completed_stages: ['4'] },
            ],
        });
        const awarded = await inTx((db) => reconcileBlenderXp(db, ALICE));
        assert.deepEqual(awarded, ['blender/1', 'blender/2']);
        assert.deepEqual(pool.awardsOf(ALICE), ['blender_stage blender/1 done 80', 'blender_stage blender/2 done 80']);
        assert.equal(pool.xpOf(ALICE), 160);
        assert.deepEqual(pool.awardsOf(BOB), []);
        assert.match(BLENDER_XP_SQL, /WHERE u\.course_id = 'blender' AND s\.stage IN \('1', '2', '3', '4'\) AND u\.user_id = \$1\n ORDER BY 3\n/);
        assert.equal(norm(BLENDER_XP_SQL), SQL.xpReconcileStages);
    });

    it('a stage newly awarded makes today a learning day (Japan time of the server clock); nothing new, no day', async () => {
        const clock = { now: new Date('2026-10-24T14:59:59.000Z') };
        use({ userProgress: [{ user_id: ALICE, course_id: 'blender', completed_stages: ['1'] }], clock: () => clock.now });
        await inTx((db) => reconcileBlenderXp(db, ALICE));
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-24'], '23:59:59 in Tokyo');
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.xpLock, SQL.xpReconcileStages, SQL.learningDay, 'commit']);

        clock.now = new Date('2026-10-24T15:00:00.000Z');
        pool.queries.length = 0;
        assert.deepEqual(await inTx((db) => reconcileBlenderXp(db, ALICE)), [], 'stage 1 again: nothing new');
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-24'], 'no award, no day');
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.xpLock, SQL.xpReconcileStages, 'commit']);

        // The learner finishes stage 2 after midnight in Tokyo: a new award and a new day.
        await inTx((db) => db.query(SQL.legacyProgressUpsert, [ALICE, 'blender', ['1', '2'], '{}']));
        assert.deepEqual(await inTx((db) => reconcileBlenderXp(db, ALICE)), ['blender/2']);
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-24', '2026-10-25'], '00:00:00 in Tokyo is the next day');
    });
});

describe('the ledger\'s amounts (migration 019 CHECK, modelled by the fake)', () => {
    it('a wrong amount, milestone or item key is refused', () => {
        for (const award of [
            { source: 'lesson', item_key: 'c/l', milestone: 'start', xp: 40 },
            { source: 'lesson', item_key: 'c/l', milestone: 'finish', xp: 40 },
            { source: 'blender_stage', item_key: 'blender/1', milestone: 'start', xp: 80 },
            { source: 'diagnosis', item_key: 'c/l', milestone: 'done', xp: 40 },
            { source: 'lesson', item_key: 'C/l', milestone: 'done', xp: 40 },
        ]) {
            assert.throws(() => createLessonProgressPool({ awards: [{ user_id: ALICE, ...award }] }), { code: '23514' }, JSON.stringify(award));
        }
        assert.doesNotThrow(() => createLessonProgressPool({ awards: [{ user_id: ALICE, source: 'blender_stage', item_key: 'blender/4', milestone: 'done', xp: 80 }] }));
    });
});

// ─── Stage 2 ───────────────────────────────────────────────────

/** Silences console.warn and console.error; returns what was warned. */
const quietly = async (fn) => {
    const { warn, error } = console;
    const warned = [];
    console.warn = (...args) => warned.push(args.join(' '));
    console.error = () => {};
    try {
        return { value: await fn(), warned };
    } finally {
        console.warn = warn;
        console.error = error;
    }
};
const badge = (summary, id) => summary.badges.find((b) => b.id === id);
const award = (source, item_key, milestone) => ({ source, item_key, milestone, xp: { 'lesson start': 10, 'lesson done': 40, 'blender_stage done': 80 }[`${source} ${milestone}`] });
const lessonDone = (key) => [award('lesson', key, 'start'), award('lesson', key, 'done')];
const COURSES = [
    { slug: 'alpha', source: 'lesson', items: ['alpha/a1', 'alpha/a2', 'alpha/a3'] },
    { slug: 'beta', source: 'lesson', items: ['beta/b1', 'beta/b2'] },
    { slug: 'empty', source: 'lesson', items: [] },
    { slug: 'blender', source: 'blender_stage', items: ['blender/1', 'blender/2', 'blender/3', 'blender/4'] },
];
const summarize = ({ awards = [], days = [], today = '2026-10-25', courses = COURSES } = {}) => summarizeAchievements({ userId: ALICE.toUpperCase(), awards, days, today, courses });

describe('levelOf (owner decision O1: the level formula is unchanged)', () => {
    it('level = floor(total / 100) + 1; intoLevel, levelSize and toNextLevel', () => {
        assert.equal(XP_PER_LEVEL, 100);
        assert.deepEqual(levelOf(0), { total: 0, level: 1, intoLevel: 0, levelSize: 100, toNextLevel: 100 });
        assert.deepEqual(levelOf(99), { total: 99, level: 1, intoLevel: 99, levelSize: 100, toNextLevel: 1 });
        assert.deepEqual(levelOf(100), { total: 100, level: 2, intoLevel: 0, levelSize: 100, toNextLevel: 100 });
        assert.deepEqual(levelOf(450), { total: 450, level: 5, intoLevel: 50, levelSize: 100, toNextLevel: 50 });
        assert.deepEqual(levelOf(1520), { total: 1520, level: 16, intoLevel: 20, levelSize: 100, toNextLevel: 80 }, 'every published lesson and stage today (design §3.11)');
    });
});

describe('streakOf (Japan-time days from the server; today or yesterday keeps the run)', () => {
    it('a run ending today counts, and so does one ending yesterday (it survives until the end of today); a gap ends it', () => {
        assert.deepEqual(streakOf(['2026-10-23', '2026-10-24', '2026-10-25'], '2026-10-25'), { current: 3, best: 3, activeToday: true });
        assert.deepEqual(streakOf(['2026-10-23', '2026-10-24'], '2026-10-25'), { current: 2, best: 2, activeToday: false }, 'yesterday keeps it');
        assert.deepEqual(streakOf(['2026-10-22', '2026-10-23'], '2026-10-25'), { current: 0, best: 2, activeToday: false }, 'a day missed ends it');
        assert.deepEqual(streakOf(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-24', '2026-10-25'], '2026-10-25'), { current: 2, best: 3, activeToday: true });
        assert.deepEqual(streakOf([], '2026-10-25'), { current: 0, best: 0, activeToday: false });
    });

    it('runs cross month and year ends; repeated or malformed days are ignored; days after today count only toward the best', () => {
        assert.deepEqual(streakOf(['2025-12-30', '2025-12-31', '2026-01-01'], '2026-01-01'), { current: 3, best: 3, activeToday: true });
        assert.deepEqual(streakOf(['2026-02-28', '2026-03-01'], '2026-03-01'), { current: 2, best: 2, activeToday: true });
        assert.deepEqual(streakOf(['2026-10-25', '2026-10-25', '2026-10-24', 'x', '2026-02-30', '2026-10-24T00:00:00Z'], '2026-10-25'), { current: 2, best: 2, activeToday: true });
        assert.deepEqual(streakOf(['2026-10-26', '2026-10-27', '2026-10-28'], '2026-10-25'), { current: 0, best: 3, activeToday: false });
        assert.deepEqual(streakOf(['2026-10-25'], 'not a day'), { current: 0, best: 1, activeToday: false });
    });
});

describe('summarizeAchievements (design §3.4-§3.5)', () => {
    it('totals, counts, level and the streak; learnerId in lower case', () => {
        const s = summarize({
            awards: [...lessonDone('alpha/a1'), award('lesson', 'beta/b1', 'start'), award('blender_stage', 'blender/2', 'done')],
            days: ['2026-10-24', '2026-10-25'],
        });
        assert.equal(s.learnerId, ALICE);
        assert.deepEqual(s.xp, { total: 140, level: 2, intoLevel: 40, levelSize: 100, toNextLevel: 60 });
        assert.deepEqual(s.counts, { lessonsStarted: 2, lessonsDone: 1, stagesDone: 1 });
        assert.deepEqual(s.streak, { current: 2, best: 2, activeToday: true, today: '2026-10-25', timeZone: 'Asia/Tokyo' });
        assert.deepEqual(s.badges.map((b) => b.id), ['first_lesson', 'five_lessons', 'fifteen_lessons', 'first_course', 'three_courses', 'streak_3', 'streak_7']);
        assert.deepEqual(BADGES.map((b) => b.id), s.badges.map((b) => b.id));
    });

    it('nothing earned yet: no badge is earned, and none rewards a diagnosis or a generated course', () => {
        const s = summarize();
        assert.deepEqual(s.xp, levelOf(0));
        assert.ok(s.badges.every((b) => b.earned === false), JSON.stringify(s.badges));
        for (const id of ['first_build', 'ai_explorer', 'guardian', 'master']) assert.equal(badge(s, id), undefined, id);
        assert.deepEqual(badge(s, 'first_lesson'), { id: 'first_lesson', earned: false, current: 0, goal: 1 });
        assert.deepEqual(badge(s, 'first_course'), { id: 'first_course', earned: false, current: 0, goal: 4, course: 'blender' }, 'all at 0: the larger course');
    });

    it('done-count badges: lessons and stages done, earned exactly at 1, 5 and 15; current never passes the goal; a started lesson is not done', () => {
        const doneItems = (n) => Array.from({ length: n }, (_, i) => lessonDone(`gamma/g${i}`)).flat();
        assert.deepEqual(badge(summarize({ awards: [award('lesson', 'alpha/a1', 'start')] }), 'first_lesson'), { id: 'first_lesson', earned: false, current: 0, goal: 1 });
        assert.deepEqual(badge(summarize({ awards: [award('blender_stage', 'blender/1', 'done')] }), 'first_lesson'), { id: 'first_lesson', earned: true, current: 1, goal: 1 }, 'a stage counts');
        assert.deepEqual(badge(summarize({ awards: doneItems(4) }), 'five_lessons'), { id: 'five_lessons', earned: false, current: 4, goal: 5 });
        assert.deepEqual(badge(summarize({ awards: [...doneItems(4), award('blender_stage', 'blender/3', 'done')] }), 'five_lessons'), { id: 'five_lessons', earned: true, current: 5, goal: 5 });
        assert.deepEqual(badge(summarize({ awards: doneItems(14) }), 'fifteen_lessons'), { id: 'fifteen_lessons', earned: false, current: 14, goal: 15 });
        const fifteen = summarize({ awards: doneItems(20) });
        assert.deepEqual(badge(fifteen, 'fifteen_lessons'), { id: 'fifteen_lessons', earned: true, current: 15, goal: 15 });
        assert.deepEqual(badge(fifteen, 'first_lesson'), { id: 'first_lesson', earned: true, current: 1, goal: 1 });
    });

    it('first_course: the course with the highest done / total (ties to the larger total), earned when one is complete; Blender completes with its four stages', () => {
        const partial = summarize({ awards: [...lessonDone('alpha/a1'), ...lessonDone('beta/b1')] });
        assert.deepEqual(badge(partial, 'first_course'), { id: 'first_course', earned: false, current: 1, goal: 2, course: 'beta' }, '1/2 beats 1/3');
        const tie = summarize({ awards: [...lessonDone('alpha/a1'), ...lessonDone('alpha/a2'), ...lessonDone('beta/b1'), award('blender_stage', 'blender/1', 'done'), award('blender_stage', 'blender/2', 'done')] });
        assert.deepEqual(badge(tie, 'first_course'), { id: 'first_course', earned: false, current: 2, goal: 3, course: 'alpha' }, '2/3 beats 1/2 and 2/4');
        const halves = summarize({ awards: [...lessonDone('beta/b1'), award('blender_stage', 'blender/1', 'done'), award('blender_stage', 'blender/2', 'done')] });
        assert.deepEqual(badge(halves, 'first_course'), { id: 'first_course', earned: false, current: 2, goal: 4, course: 'blender' }, '1/2 and 2/4 tie: the larger course');
        const startedOnly = summarize({ awards: ['alpha/a1', 'alpha/a2', 'alpha/a3'].map((k) => award('lesson', k, 'start')) });
        assert.equal(badge(startedOnly, 'first_course').earned, false, 'started is not done');
        const blender = summarize({ awards: BLENDER_STAGES.map((stage) => award('blender_stage', `blender/${stage}`, 'done')) });
        assert.deepEqual(badge(blender, 'first_course'), { id: 'first_course', earned: true, current: 4, goal: 4, course: 'blender' });
        assert.deepEqual(badge(blender, 'three_courses'), { id: 'three_courses', earned: false, current: 1, goal: 3 });
        const alpha = summarize({ awards: ['alpha/a1', 'alpha/a2', 'alpha/a3'].flatMap(lessonDone) });
        assert.deepEqual(badge(alpha, 'first_course'), { id: 'first_course', earned: true, current: 3, goal: 3, course: 'alpha' });
        const unpublished = summarize({ awards: ['alpha/a1', 'alpha/a2', 'alpha/a3'].flatMap(lessonDone), courses: [{ ...COURSES[0], items: [...COURSES[0].items, 'alpha/a4'] }] });
        assert.deepEqual(badge(unpublished, 'first_course'), { id: 'first_course', earned: false, current: 3, goal: 4, course: 'alpha' }, 'a newly published lesson: "not yet" again (R6)');
    });

    it('three_courses: three complete courses (a course with no published lesson never counts)', () => {
        const two = ['alpha/a1', 'alpha/a2', 'alpha/a3', 'beta/b1', 'beta/b2'].flatMap(lessonDone);
        assert.deepEqual(badge(summarize({ awards: two }), 'three_courses'), { id: 'three_courses', earned: false, current: 2, goal: 3 });
        const three = [...two, ...BLENDER_STAGES.map((stage) => award('blender_stage', `blender/${stage}`, 'done'))];
        const s = summarize({ awards: three });
        assert.deepEqual(badge(s, 'three_courses'), { id: 'three_courses', earned: true, current: 3, goal: 3 });
        assert.deepEqual(badge(s, 'first_course'), { id: 'first_course', earned: true, current: 4, goal: 4, course: 'blender' }, 'complete courses: the larger');
    });

    it('streak badges: earned once the best run reached the goal (they stay earned); G33: an unearned one shows the current run, never the best', () => {
        const days = (from, n) => Array.from({ length: n }, (_, i) => `2026-10-${String(from + i).padStart(2, '0')}`);
        const g33 = summarize({ days: days(10, 5), today: '2026-10-25' });
        assert.deepEqual([g33.streak.current, g33.streak.best], [0, 5]);
        assert.deepEqual(badge(g33, 'streak_7'), { id: 'streak_7', earned: false, current: 0, goal: 7 }, 'best 5, current 0: streak_7 shows 0');
        assert.deepEqual(badge(g33, 'streak_3'), { id: 'streak_3', earned: true, current: 3, goal: 3 }, 'earned stays earned');
        const going = summarize({ days: [...days(10, 5), ...days(23, 2)], today: '2026-10-25' });
        assert.deepEqual(badge(going, 'streak_7'), { id: 'streak_7', earned: false, current: 2, goal: 7 }, 'yesterday and the day before: 2, not 5');
        const seven = summarize({ days: days(19, 7), today: '2026-10-25' });
        assert.deepEqual([badge(seven, 'streak_3').earned, badge(seven, 'streak_7')], [true, { id: 'streak_7', earned: true, current: 7, goal: 7 }]);
        const two = summarize({ days: days(24, 2), today: '2026-10-25' });
        assert.deepEqual(badge(two, 'streak_3'), { id: 'streak_3', earned: false, current: 2, goal: 3 });
    });

    it('badgeCourses: every course of the published catalog (helpers/publishedLessons.js) with its lessons, and Blender\'s four stages (the SQL\'s list)', () => {
        const want = new Map();
        for (const { course, lesson } of publishedLessons()) want.set(course, [...(want.get(course) ?? []), `${course}/${lesson.id}`]);
        const got = badgeCourses();
        const lessonCourses = got.filter((c) => c.source === 'lesson');
        assert.deepEqual(lessonCourses.map((c) => c.slug).sort(), [...want.keys()].sort());
        for (const c of lessonCourses) assert.deepEqual([...c.items].sort(), [...want.get(c.slug)].sort(), c.slug);
        assert.deepEqual(got.find((c) => c.slug === 'blender'), { slug: 'blender', source: 'blender_stage', items: ['blender/1', 'blender/2', 'blender/3', 'blender/4'] });
        assert.match(BLENDER_XP_SQL, new RegExp(`s\\.stage IN \\(${BLENDER_STAGES.map((stage) => `'${stage}'`).join(', ')}\\)`));
    });
});

describe('getAchievements (one transaction: reconcile, then read)', () => {
    const at = { now: new Date('2026-10-25T03:00:00.000Z') };
    const seed = (extra = {}) => use({
        rows: [row('vibe-ch1', 'in_progress'), row('vibe-ch2', 'read'), row('vibe-ch3', 'checked'), row('vibe-ch4', 'mastered'), row('vibe-ch5', 'not_started'), row('vibe-ch1', 'mastered', BOB)],
        userProgress: [{ user_id: ALICE, course_id: 'blender', completed_stages: ['1', '2', '9', '1'] }, { user_id: ALICE, course_id: 'blender2', completed_stages: ['3'] }],
        days: [{ user_id: ALICE, day: '2026-10-23' }, { user_id: BOB, day: '2026-10-24' }],
        clock: () => at.now,
        ...extra,
    });

    it('in_progress 10, read / checked / mastered 50 each, Blender 1 and 2 (not 9, not another course) 160; the reconcile and the reads in one transaction, in order', async () => {
        seed();
        const result = await getAchievements({ userId: ALICE });
        assert.equal('error_type' in result, false, JSON.stringify(result));
        assert.deepEqual(result.xp, { total: 320, level: 4, intoLevel: 20, levelSize: 100, toNextLevel: 80 });
        assert.deepEqual(result.counts, { lessonsStarted: 4, lessonsDone: 3, stagesDone: 2 });
        assert.equal(result.learnerId, ALICE);
        assert.deepEqual(result.streak, { current: 1, best: 1, activeToday: true, today: '2026-10-25', timeZone: 'Asia/Tokyo' }, 'the stages newly awarded by this read made today a day; Bob\'s 10-24 is not Alice\'s');
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-23', '2026-10-25'], 'the stage award added today');
        assert.deepEqual(pool.queries.filter((q) => q.via === 'client').map((q) => q.sql), [
            'begin', SQL.xpLock, SQL.xpReconcileLessons, SQL.xpLock, SQL.xpReconcileStages, SQL.learningDay,
            SQL.xpAwards, SQL.selectDays, SQL.selectToday, 'commit',
        ]);
        assert.ok(pool.queries.every((q) => q.params.length === 0 || q.params[0] === ALICE), 'only Alice\'s rows');
        assert.ok(!pool.queries.some((q) => /learning_events/.test(q.sql)), 'learning events are never read');
        assert.equal(norm(XP_AWARDS_SQL), SQL.xpAwards);
        assert.equal(norm(DAYS_SQL), SQL.selectDays);
        assert.equal(norm(TODAY_SQL), SQL.selectToday);
    });

    it('reads again: nothing new, the same answer, no new day; a lesson finished meanwhile adds its 40 once', async () => {
        seed();
        const first = await getAchievements({ userId: ALICE });
        pool.queries.length = 0;
        const second = await getAchievements({ userId: ALICE });
        assert.deepEqual(second, first);
        assert.ok(!pool.queries.some((q) => q.sql === SQL.learningDay), 'no award, no day');
        pool.row(ALICE, 'vibe-coding', 'vibe-ch1').state = 'read';
        assert.equal((await getAchievements({ userId: ALICE })).xp.total, 360);
        assert.equal((await getAchievements({ userId: ALICE })).xp.total, 360);
    });

    it('a learner with nothing: level 1 and no badge; an invalid id: validation, no SQL; no database: db_connection', async () => {
        seed();
        const empty = await getAchievements({ userId: 'aaaaaaaa-1111-4000-8000-0000000000ff' });
        assert.deepEqual([empty.xp, empty.counts, empty.badges.filter((b) => b.earned)], [levelOf(0), { lessonsStarted: 0, lessonsDone: 0, stagesDone: 0 }, []]);
        pool.queries.length = 0;
        assert.equal((await getAchievements({ userId: 'not-a-uuid' })).error_type, 'validation');
        assert.equal(pool.queries.length, 0);
        resetPoolForTests();
        setPoolForTests(null);
        assert.equal((await getAchievements({ userId: ALICE })).error_type, 'db_connection');
    });

    it('a failure rolls back (nothing awarded) and answers the error type, not the driver text', async () => {
        seed();
        pool.fail({ code: '42P01', message: 'relation "xp_awards" does not exist (db.internal)', when: (text) => text === SQL.xpAwards });
        const { value } = await quietly(() => getAchievements({ userId: ALICE }));
        assert.deepEqual(value, { error: 'Table not found during getAchievements. Run db:migrate.', error_type: 'table_not_found' });
        assert.deepEqual(pool.awardsOf(ALICE), []);
        assert.equal(pool.inTransaction(), false);
    });
});

describe('Phase 8 (S2): lessonXp, each lesson\'s done award for the lesson end', () => {
    it('lessonXpOf: lesson done awards only (no start, no Blender stage), keyed by course/lesson, the ledger\'s figure; xp 0 dropped', () => {
        assert.deepEqual(lessonXpOf([
            award('lesson', 'vibe-coding/vibe-ch1', 'start'),
            award('lesson', 'vibe-coding/vibe-ch2', 'start'), award('lesson', 'vibe-coding/vibe-ch2', 'done'),
            { source: 'lesson', item_key: 'claude-code/cc-01', milestone: 'done', xp: '40' },
            award('blender_stage', 'blender/1', 'done'),
            { source: 'lesson', item_key: 'vibe-coding/zero', milestone: 'done', xp: 0 },
            { source: 'diagnosis', item_key: 'vibe-coding/vibe-ch3', milestone: 'done', xp: 40 },
        ]), { 'vibe-coding/vibe-ch2': 40, 'claude-code/cc-01': 40 });
        assert.deepEqual(lessonXpOf([]), {});
        assert.equal(Object.getPrototypeOf(lessonXpOf([])), Object.prototype, 'a plain object for JSON');
    });

    const seed = () => use({
        rows: [
            row('vibe-ch1', 'in_progress'), row('vibe-ch2', 'read'), row('vibe-ch3', 'checked'), row('vibe-ch4', 'mastered'),
            row('vibe-ch5', 'not_started'), row('vibe-ch6', 'mastered', BOB),
        ],
        userProgress: [{ user_id: ALICE, course_id: 'blender', completed_stages: ['1', '2'] }],
    });

    it('getAchievements: a read, checked or mastered lesson has its 40; started, not started, Blender stages and another learner\'s lessons are absent; no new statement', async () => {
        seed();
        const result = await getAchievements({ userId: ALICE });
        assert.equal('error_type' in result, false, JSON.stringify(result));
        assert.deepEqual(Object.keys(result), ['learnerId', 'xp', 'counts', 'streak', 'badges', 'lessonXp']);
        assert.deepEqual(result.lessonXp, { 'vibe-coding/vibe-ch2': 40, 'vibe-coding/vibe-ch3': 40, 'vibe-coding/vibe-ch4': 40 });
        assert.equal(result.xp.total, 3 * 50 + 10 + 2 * 80, 'the total is the summary\'s, unchanged');
        assert.deepEqual(pool.queries.filter((q) => q.via === 'client').map((q) => q.sql), [
            'begin', SQL.xpLock, SQL.xpReconcileLessons, SQL.xpLock, SQL.xpReconcileStages, SQL.learningDay,
            SQL.xpAwards, SQL.selectDays, SQL.selectToday, 'commit',
        ], 'the same statements as before Phase 8');
    });

    it('the figure stays after a one-lesson reset and after a redo (XP is given once ever, O2), and after delete-all', async () => {
        seed();
        assert.equal((await getAchievements({ userId: ALICE })).lessonXp['vibe-coding/vibe-ch2'], 40);
        const reset = await resetLessonProgress({ userId: ALICE, epoch: null, courseSlug: 'vibe-coding', lessonId: 'vibe-ch2' });
        assert.equal('error_type' in reset, false, JSON.stringify(reset));
        assert.equal(pool.row(ALICE, 'vibe-coding', 'vibe-ch2').state, 'not_started');
        assert.equal((await getAchievements({ userId: ALICE })).lessonXp['vibe-coding/vibe-ch2'], 40, 'after the reset');
        pool.row(ALICE, 'vibe-coding', 'vibe-ch2').state = 'read';
        const redo = await getAchievements({ userId: ALICE });
        assert.equal(redo.lessonXp['vibe-coding/vibe-ch2'], 40, 'a redo: still 40, never 80');
        assert.equal(pool.awardsOf(ALICE).filter((a) => a.startsWith('lesson vibe-coding/vibe-ch2 done')).length, 1);
        const deleted = await deleteAllLessonProgress({ userId: ALICE });
        assert.equal('error_type' in deleted, false, JSON.stringify(deleted));
        assert.deepEqual((await getAchievements({ userId: ALICE })).lessonXp, { 'vibe-coding/vibe-ch2': 40, 'vibe-coding/vibe-ch3': 40, 'vibe-coding/vibe-ch4': 40 });
        // Each learner reads only their own ledger.
        assert.deepEqual((await getAchievements({ userId: BOB })).lessonXp, { 'vibe-coding/vibe-ch6': 40 });
    });
});

describe('noteLearning and noteBlenderProgress (after a save; never throw)', () => {
    it('noteLearning: the lesson awards and today (Japan time of the server clock: 14:59:59Z is the 24th, 15:00:00Z the 25th) in one transaction', async () => {
        const clock = { now: new Date('2026-10-24T14:59:59.000Z') };
        use({ rows: [row('vibe-ch1', 'read')], clock: () => clock.now });
        assert.equal(await noteLearning({ userId: ALICE }), true);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.xpLock, SQL.xpReconcileLessons, SQL.learningDay, 'commit']);
        assert.deepEqual([pool.xpOf(ALICE), pool.daysOf(ALICE)], [50, ['2026-10-24']]);
        clock.now = new Date('2026-10-24T15:00:00.000Z');
        assert.equal(await noteLearning({ userId: ALICE }), true);
        assert.deepEqual([pool.xpOf(ALICE), pool.daysOf(ALICE)], [50, ['2026-10-24', '2026-10-25']], 'the same lesson earns nothing again; the new day counts');
        const read = await getAchievements({ userId: ALICE });
        assert.deepEqual(read.streak, { current: 2, best: 2, activeToday: true, today: '2026-10-25', timeZone: 'Asia/Tokyo' }, 'today from the same clock as the days');
    });

    it('noteBlenderProgress: the stage awards, and today only when a stage was newly awarded', async () => {
        use({ userProgress: [{ user_id: ALICE, course_id: 'blender', completed_stages: ['3'] }] });
        assert.equal(await noteBlenderProgress({ userId: ALICE }), true);
        assert.deepEqual([pool.xpOf(ALICE), pool.daysOf(ALICE).length], [80, 1]);
        pool.queries.length = 0;
        assert.equal(await noteBlenderProgress({ userId: ALICE }), true);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.xpLock, SQL.xpReconcileStages, 'commit']);
    });

    it('a failure (no database, a missing table, a deleted account\'s foreign key, a broken pool) is only logged: false, rolled back, never a throw', async () => {
        setPoolForTests(null);
        const none = await quietly(() => noteLearning({ userId: ALICE }));
        assert.deepEqual(none, { value: false, warned: ['[achievements] note after save failed: db_connection'] });
        for (const [code, type] of [['42P01', 'table_not_found'], ['23503', 'unknown']]) {
            use({ rows: [row('vibe-ch1', 'read')], userProgress: [{ user_id: ALICE, course_id: 'blender', completed_stages: ['1'] }] });
            pool.fail({ code, message: 'insert or update on table "xp_awards" violates foreign key constraint (db.internal)' });
            const lesson = await quietly(() => noteLearning({ userId: ALICE }));
            const stage = await quietly(() => noteBlenderProgress({ userId: ALICE }));
            assert.deepEqual(lesson, { value: false, warned: [`[achievements] note after save failed: ${type}`] });
            assert.deepEqual(stage, { value: false, warned: [`[achievements] note after Blender progress failed: ${type}`] });
            assert.deepEqual([pool.awardsOf(ALICE), pool.daysOf(ALICE), pool.inTransaction()], [[], [], false]);
        }
        use();
        pool.failConnect(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }));
        assert.deepEqual(await quietly(() => noteBlenderProgress({ userId: ALICE })), { value: false, warned: ['[achievements] note after Blender progress failed: db_connection'] });
        assert.deepEqual(await quietly(() => noteLearning({ userId: 'not-a-uuid' })), { value: false, warned: [] });
    });
});
