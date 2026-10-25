// XP on the server (Phase 5, tools/core/achievements.js; design §3.1-§3.2), stage 1: the
// reconcilers, against the in-memory tables of helpers/lessonProgressPool.js (exact SQL, the
// xp_awards amount CHECK). The read path (getAchievements, levels, badges, the streak) comes in
// stage 2 and extends this file.
// - lesson awards come from lesson_progress.state only: start 10 once started, done 40 once read,
//   checked or mastered; a reconcile twice adds nothing (G6);
// - Blender stage awards only for blender/1..4 of course 'blender' (G7), 80 each, once; a stage
//   newly awarded adds today (Japan time, server clock) as a learning day, and only then;
// - delete-all's statement awards exactly the rows it deletes (deleteLessonsKeepingXp).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { inTransaction } from '../../tools/core/dbTransaction.js';
import {
    DELETE_LESSONS_KEEPING_XP_SQL, LESSON_XP_SELECT, LESSON_XP_SQL, BLENDER_XP_SQL, XP_LOCK_SQL,
    deleteLessonsKeepingXp, reconcileBlenderXp, reconcileLessonXp,
} from '../../tools/core/achievements.js';
import { createLessonProgressPool, norm, SQL } from './helpers/lessonProgressPool.js';

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
        assert.match(XP_LOCK_SQL, /pg_advisory_xact_lock\(hashtext\('xp:' \|\| \$1\)\)/);
    });

    it('awards stay when the record is emptied later (the ledger is never reconciled downwards)', async () => {
        use({ rows: [row('l-read', 'read')] });
        await inTx((db) => reconcileLessonXp(db, ALICE));
        pool.row(ALICE, 'vibe-coding', 'l-read').state = 'not_started';
        await inTx((db) => reconcileLessonXp(db, ALICE));
        assert.equal(pool.xpOf(ALICE), 50);
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
