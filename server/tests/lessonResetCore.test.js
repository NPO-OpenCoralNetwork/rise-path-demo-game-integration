// Phase 5 stage 1 (design §2.2, §3.2, §7.2 item 2): starting ONE lesson over on the server,
// against the in-memory lesson_progress (helpers/lessonProgressPool.js, exact SQL).
// - resetLessonProgress: the tombstone row, the lesson's new generation, the lock order (learner
//   lock, the account stub's KEY SHARE, the row, the XP lock: G26) and XP reconciled first (G4);
// - saveLessonProgress: a record whose lessonEpoch is not the lesson's current one (stale, null,
//   absent: an old bundle) is refused 'lesson_reset' with the generation and the stored record, the
//   others save (G1, G2), pct and state of that record as GET computes them; `learned`;
// - getLessonProgress: the generation per record from one JOIN;
// - deleteAllLessonProgress: the DELETE awards exactly the rows it removes, also a row an AI app
//   changed just before it (G5); reset rows survive it (G18);
// - the MCP course tools read a restarted lesson like an untouched one and never name the Phase 5
//   tables (G9).
// Phase 6 stage 2 (R4, design §3.5): the reset deletes that lesson's review cards (their log by
// cascade) and only those; finishing it again enters them fresh; delete-all deletes every review
// card and log row; XP, generations and learning days stay.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    ACCOUNT_STUB_SHARE_SQL,
    DELETE_ALL_REVIEW_CARDS_SQL,
    DELETE_LESSON_REVIEW_CARDS_SQL,
    LEARNER_LOCK_SQL,
    LESSON_EPOCHS_SQL,
    RESET_LESSON_EPOCH_SQL,
    ROWS_WITH_LESSON_EPOCHS_SQL,
    STORED_RECORD_SQL,
    applyQuizCheck,
    deleteAllLessonProgress,
    getLessonProgress,
    markLessonProgress,
    resetLessonProgress,
    saveLessonProgress,
} from '../../tools/core/lessonProgress.js';
import { BLENDER_XP_SQL, DELETE_LESSONS_KEEPING_XP_SQL, LEARNING_DAY_SQL, LESSON_XP_SQL, XP_LOCK_SQL, noteLearning } from '../../tools/core/achievements.js';
import { lessonPct, lessonState, parseProgress } from '../../shared/lesson/progress.js';
import { mergeProgress, sanitizeProgress } from '../../shared/lesson/progressMerge.js';
import { getCourseProgress } from '../../tools/core/courseLessons.js';
import { getPublishedLesson } from '../../tools/core/courseCatalog.js';
import { getReviewQueue } from '../../tools/core/reviewQueue.js';
import { LESSON_PRIORS } from '../../shared/review/queue.js';
import { createLessonProgressPool, jstDay, norm, PHASE5_TABLES, SQL } from './helpers/lessonProgressPool.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const CC = 'claude-code';
const CC4 = 'cc-04-verify';
const ACCOUNT_EPOCH = 'cccccccc-0000-4000-8000-000000000001';
const OTHER_GEN = 'dddddddd-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-25T03:00:00.000Z');

const ch1 = getPublishedLesson(VIBE, CH1);
const record = (overrides = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z', ...overrides });
const EPOCH_ZERO = '1970-01-01T00:00:00.000Z';
const answered = { 'check-quiz/q4': { attempts: 1, correct: true, chosen: ['b'], firstTry: true } };
/** A row of Alice's vibe-ch1 in the given state. */
const ch1Row = (state, progress = record({ seen: ['hook-b1'], answers: answered })) => ({
    user_id: ALICE, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, pct: 5, state, progress,
});
/** A clock that moves one second per transaction, so reset_at values differ. */
const ticking = () => {
    let t = NOW.getTime();
    return () => new Date((t += 1000));
};

let pool;
const use = (seed = {}) => {
    pool = createLessonProgressPool({ clock: ticking(), ...seed });
    setPoolForTests(pool);
    return pool;
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
const reset = (args = {}) => resetLessonProgress({ userId: ALICE, epoch: null, courseSlug: VIBE, lessonId: CH1, ...args });
const save = (records, args = {}) => saveLessonProgress({ userId: ALICE, epoch: null, now: NOW, records, ...args });

beforeEach(() => {
    resetPoolForTests();
    use();
});

afterEach(() => {
    resetPoolForTests();
});

describe('the module\'s Phase 5 statements are the fake\'s (exact SQL)', () => {
    it('reset, generations, JOIN, stored record, stub lock and XP statements', () => {
        assert.equal(norm(LEARNER_LOCK_SQL), SQL.advisoryLock);
        assert.equal(norm(ACCOUNT_STUB_SHARE_SQL), SQL.stubKeyShare);
        assert.equal(norm(LESSON_EPOCHS_SQL), SQL.selectLessonEpochs);
        assert.equal(norm(RESET_LESSON_EPOCH_SQL), SQL.upsertLessonEpoch);
        assert.equal(norm(ROWS_WITH_LESSON_EPOCHS_SQL), SQL.selectRowsWithEpochs);
        assert.equal(norm(STORED_RECORD_SQL), SQL.selectStoredRow);
        assert.equal(norm(XP_LOCK_SQL), SQL.xpLock);
        assert.equal(norm(LESSON_XP_SQL), SQL.xpReconcileLessons);
        assert.equal(norm(BLENDER_XP_SQL), SQL.xpReconcileStages);
        assert.equal(norm(LEARNING_DAY_SQL), SQL.learningDay);
        assert.equal(norm(DELETE_LESSONS_KEEPING_XP_SQL), SQL.deleteLessonsKeepingXp);
        assert.equal(norm(DELETE_LESSON_REVIEW_CARDS_SQL), SQL.deleteLessonReviewCards);
        assert.equal(norm(DELETE_ALL_REVIEW_CARDS_SQL), SQL.deleteAllReviewCards);
    });
});

describe('resetLessonProgress (POST /lesson-reset)', () => {
    it('G26/G4: learner lock, the stub\'s KEY SHARE, the epoch, the row, the XP lock, reconcile, the tombstone, a new generation', async () => {
        use({ rows: [ch1Row('in_progress')] });
        const result = await reset();
        assert.equal(result.error_type, undefined, JSON.stringify(result));
        assert.deepEqual(pool.progressStatements(), [
            'begin', SQL.advisoryLock, SQL.stubKeyShare, SQL.selectEpoch, SQL.insertPlaceholder, SQL.lockRow,
            SQL.xpLock, SQL.xpReconcileLessons, SQL.updateRow, SQL.upsertLessonEpoch, SQL.deleteLessonReviewCards, 'commit',
        ]);
        const stub = pool.queries.find((q) => q.sql === SQL.stubKeyShare);
        assert.deepEqual(stub.params, [ALICE]);
        assert.equal(pool.queries.some((q) => q.sql === SQL.upsertEpoch), false, 'the account epoch is never moved (G17)');
        // The tombstone: empty, not_started, 0 %, the 1970 clock.
        const row = pool.row(ALICE, VIBE, CH1);
        assert.deepEqual(row.progress, record({ updatedAt: EPOCH_ZERO }));
        assert.deepEqual([row.pct, row.state, row.progress_updated_at.toISOString(), row.content_hash], [0, 'not_started', EPOCH_ZERO, ch1.hash]);
        const gen = pool.lessonResetOf(ALICE, VIBE, CH1);
        assert.equal(result.lessonEpoch, gen.lesson_epoch);
        assert.equal(result.lessonResetAt, gen.reset_at.toISOString());
        assert.deepEqual(result, {
            epoch: null,
            courseSlug: VIBE,
            lessonId: CH1,
            lessonEpoch: gen.lesson_epoch,
            lessonResetAt: gen.reset_at.toISOString(),
            record: { courseSlug: VIBE, lessonId: CH1, progress: record({ updatedAt: EPOCH_ZERO }), pct: 0, state: 'not_started', updatedAt: EPOCH_ZERO, lessonEpoch: gen.lesson_epoch, lessonResetAt: gen.reset_at.toISOString() },
        });
        // G4: what the record earned before the reset stays earned.
        assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} start 10`]);
    });

    it('G4: a read lesson started over before any XP read keeps its 50 XP; doing it again earns nothing more', async () => {
        use({ rows: [ch1Row('read', record({ seen: [...ch1.index.readingBlockIds] }))] });
        const first = await reset();
        assert.equal(first.error_type, undefined);
        assert.equal(pool.xpOf(ALICE), 50);
        // The learner reads it again and starts over again: still 50 (one award per item and milestone).
        const again = await save([{ courseSlug: VIBE, lessonId: CH1, lessonEpoch: first.lessonEpoch, progress: record({ seen: [...ch1.index.readingBlockIds], updatedAt: NOW.toISOString() }) }]);
        assert.equal(again.records[0].state, 'read');
        await reset();
        assert.equal(pool.xpOf(ALICE), 50);
        assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} done 40`, `lesson ${VIBE}/${CH1} start 10`]);
    });

    it('G4: an in_progress lesson started over keeps start 10 and still earns done 40 when finished (the dialog: XP already earned is not given again)', async () => {
        use({ rows: [ch1Row('in_progress')] });
        const first = await reset();
        assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} start 10`]);
        assert.equal(pool.xpOf(ALICE), 10);
        // Read to the end under the new generation; the save's hook reconciles.
        const done = await save([{ courseSlug: VIBE, lessonId: CH1, lessonEpoch: first.lessonEpoch, progress: record({ seen: [...ch1.index.readingBlockIds], updatedAt: NOW.toISOString() }) }]);
        assert.equal(done.records[0].state, 'read');
        assert.equal(await noteLearning({ userId: ALICE }), true);
        assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} done 40`, `lesson ${VIBE}/${CH1} start 10`]);
        assert.equal(pool.xpOf(ALICE), 50);
        // Started over again from 'read': both milestones are earned, nothing more.
        await reset();
        assert.equal(pool.xpOf(ALICE), 50);
    });

    it('a lesson never opened still gets a tombstone row and a generation; a second reset gives a new epoch and a later reset_at', async () => {
        const first = await reset();
        assert.equal(first.error_type, undefined);
        const row = pool.row(ALICE, VIBE, CH1);
        assert.deepEqual([row.state, row.pct, row.progress_updated_at.toISOString()], ['not_started', 0, EPOCH_ZERO]);
        assert.deepEqual(pool.awardsOf(ALICE), [], 'nothing earned, nothing awarded');
        const second = await reset();
        assert.notEqual(second.lessonEpoch, first.lessonEpoch);
        assert.ok(Date.parse(second.lessonResetAt) > Date.parse(first.lessonResetAt), `${second.lessonResetAt} > ${first.lessonResetAt}`);
        assert.equal(pool.lessonResetOf(ALICE, VIBE, CH1).lesson_epoch, second.lessonEpoch);
        assert.equal(pool.lessonResetOf(BOB, VIBE, CH1), undefined);
        assert.equal(pool.lessonResetOf(ALICE, CC, CC4), undefined, 'other lessons keep their generation');
    });

    it('only a published lesson: drafts, unknown ids and malformed input are refused before any SQL', async () => {
        for (const [args, type] of [
            [{ lessonId: 'vibe-ch99' }, 'unknown_lesson'],
            [{ courseSlug: 'Vibe', lessonId: CH1 }, 'unknown_lesson'],
            [{ courseSlug: 42 }, 'unknown_lesson'],
            [{ lessonId: undefined }, 'unknown_lesson'],
            [{ epoch: 'not-a-uuid' }, 'validation'],
            [{ userId: 'x' }, 'validation'],
        ]) {
            assert.equal((await reset(args)).error_type, type, JSON.stringify(args));
        }
        assert.equal(pool.queries.length, 0);
    });

    it('an account epoch that is not the current one: progress_reset with the epoch, rolled back, no XP, no generation', async () => {
        use({ rows: [ch1Row('in_progress')], resets: { [ALICE]: ACCOUNT_EPOCH } });
        const stale = await reset({ epoch: null });
        assert.deepEqual([stale.error_type, stale.epoch], ['progress_reset', ACCOUNT_EPOCH]);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.stubKeyShare, SQL.selectEpoch, 'rollback']);
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.seen, ['hook-b1'], 'the record is unchanged');
        assert.deepEqual(pool.awardsOf(ALICE), []);
        assert.equal(pool.lessonResetOf(ALICE, VIBE, CH1), undefined);
        const current = await reset({ epoch: ACCOUNT_EPOCH.toUpperCase() });
        assert.equal(current.epoch, ACCOUNT_EPOCH, 'the epoch compares case-insensitively');
    });

    it('a failure rolls everything back (the reconcile included) and never returns the driver text', async () => {
        use({ rows: [ch1Row('in_progress')] });
        pool.fail({ code: '23503', message: 'insert or update on table "lesson_progress_lesson_resets" violates foreign key constraint (db.internal)', when: (text) => text === SQL.upsertLessonEpoch });
        const failed = await quiet(() => reset());
        assert.equal(failed.error_type, 'unknown');
        assert.doesNotMatch(JSON.stringify(failed), /violates|db\.internal/);
        assert.equal(pool.inTransaction(), false);
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.seen, ['hook-b1']);
        assert.deepEqual(pool.awardsOf(ALICE), [], 'the award rolled back with the reset');
    });
});

describe('saveLessonProgress: the lesson generation (G1, G2)', () => {
    /** Alice's vibe-ch1 restarted once; cc-04 never. */
    const restarted = async () => {
        use({ rows: [ch1Row('in_progress')] });
        const done = await reset();
        pool.queries.length = 0;
        return done;
    };

    it('G1: a stale lessonEpoch is refused with the generation and the stored record; the other records save', async () => {
        const gen = await restarted();
        const result = await save([
            { courseSlug: VIBE, lessonId: CH1, lessonEpoch: OTHER_GEN, progress: record({ seen: ['hook-b1', 's1-b1'], answers: answered }) },
            { courseSlug: CC, lessonId: CC4, progress: record({ seen: ['hook-b1'] }) },
        ]);
        assert.deepEqual(result.rejected, [{
            courseSlug: VIBE,
            lessonId: CH1,
            error_type: 'lesson_reset',
            lessonEpoch: gen.lessonEpoch,
            lessonResetAt: gen.lessonResetAt,
            record: gen.record,
        }]);
        assert.deepEqual(result.records.map((r) => [r.lessonId, r.lessonEpoch, r.lessonResetAt]), [[CC4, null, null]]);
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress, record({ updatedAt: EPOCH_ZERO }), 'the tombstone is unchanged');
        assert.deepEqual(pool.progressStatements(), [
            'begin', SQL.advisoryLock, SQL.selectEpoch, SQL.selectLessonEpochs,
            SQL.insertPlaceholder, SQL.lockRow, SQL.updateRow, SQL.selectStoredRow, 'commit',
        ]);
    });

    it('G2: an old bundle (no lessonEpoch) or null cannot undo a reset; a malformed one counts as null', async () => {
        const gen = await restarted();
        for (const sent of [{}, { lessonEpoch: null }, { lessonEpoch: 'not-a-uuid' }, { lessonEpoch: 7 }]) {
            const result = await save([{ courseSlug: VIBE, lessonId: CH1, ...sent, progress: record({ seen: ['hook-b1'], answers: answered }) }]);
            assert.deepEqual(result.records, [], JSON.stringify(sent));
            assert.deepEqual(result.rejected.map((r) => [r.error_type, r.lessonEpoch, r.record?.state]), [['lesson_reset', gen.lessonEpoch, 'not_started']], JSON.stringify(sent));
        }
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress, record({ updatedAt: EPOCH_ZERO }));
    });

    it('the current generation saves (in any case) and comes back with every saved record; a lesson never restarted merges without the field', async () => {
        const gen = await restarted();
        const result = await save([
            { courseSlug: VIBE, lessonId: CH1, lessonEpoch: gen.lessonEpoch.toUpperCase(), progress: record({ seen: ['s1-b1'] }) },
            { courseSlug: CC, lessonId: CC4, progress: record({ seen: ['hook-b1'] }) },
        ]);
        assert.deepEqual(result.rejected, []);
        const byLesson = Object.fromEntries(result.records.map((r) => [r.lessonId, r]));
        assert.deepEqual([byLesson[CH1].lessonEpoch, byLesson[CH1].lessonResetAt], [gen.lessonEpoch, gen.lessonResetAt]);
        assert.deepEqual(byLesson[CH1].progress.seen, ['s1-b1'], 'merged into the empty record: nothing old came back');
        assert.equal(byLesson[CH1].progress.answers['check-quiz/q4'], undefined);
        assert.deepEqual([byLesson[CC4].lessonEpoch, byLesson[CC4].lessonResetAt], [null, null]);
        // A never-restarted lesson refuses a record that names a generation it never had.
        const wrong = await save([{ courseSlug: CC, lessonId: CC4, lessonEpoch: OTHER_GEN, progress: record({ seen: ['s1-b1'] }) }]);
        assert.deepEqual(wrong.rejected.map((r) => [r.error_type, r.lessonEpoch, r.lessonResetAt]), [['lesson_reset', null, null]]);
    });

    it('the rejected record\'s pct and state are computed against the published lesson, as the next GET answers them', async () => {
        // Stored against an older version of the lesson: every reading block seen, but pct 3 and
        // in_progress from then (content_hash differs from the published one).
        const progress = record({ seen: [...ch1.index.readingBlockIds] });
        use({
            rows: [{ ...ch1Row('in_progress', progress), pct: 3, content_hash: 'sha256:old' }],
            lessonResets: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, lesson_epoch: OTHER_GEN.replace('dddd', 'eeee') }],
        });
        const result = await save([{ courseSlug: VIBE, lessonId: CH1, lessonEpoch: OTHER_GEN, progress: record({ seen: ['hook-b1'] }) }]);
        const refused = result.rejected[0];
        assert.equal(refused.error_type, 'lesson_reset');
        assert.deepEqual([refused.record.pct, refused.record.state], [lessonPct(ch1.lesson, progress), lessonState(ch1.lesson, progress)]);
        assert.notEqual(refused.record.state, 'in_progress', 'not the stale stored state');
        const got = await getLessonProgress({ userId: ALICE, withEpoch: true });
        assert.deepEqual(refused.record, got.records.find((r) => r.lessonId === CH1), 'the same record the next GET answers');
    });

    it('learned: only a content change that leaves the lesson started (the post-save XP hook\'s trigger)', async () => {
        const first = await save([{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) }]);
        assert.equal(first.learned, true, 'a first seen block');
        const same = await save([{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'], updatedAt: '2026-10-21T00:00:00.000Z' }) }]);
        assert.equal(same.learned, false, 'nothing new (only the clock moved)');
        const resumeOnly = await save([{ courseSlug: CC, lessonId: CC4, progress: record({ lastBlockId: 'hook-b1' }) }]);
        assert.equal(resumeOnly.records[0].state, 'not_started');
        assert.equal(resumeOnly.learned, false, 'a resume position alone is not learning');
        const refused = await save([{ courseSlug: VIBE, lessonId: CH1, lessonEpoch: OTHER_GEN, progress: record({ seen: ['s1-b1'] }) }]);
        assert.equal(refused.learned, false, 'a refused record taught nothing');
        assert.deepEqual(pool.awardsOf(ALICE), [], 'a save never writes XP');
        assert.equal(pool.queries.some((q) => PHASE5_TABLES.test(q.sql) && !q.sql.startsWith('select course_slug, lesson_id, lesson_epoch')), false);
    });
});

describe('getLessonProgress with the generations (REST GET)', () => {
    it('one JOIN after the epoch: lessonEpoch and lessonResetAt per record (null for a lesson never restarted)', async () => {
        use({ rows: [ch1Row('in_progress'), { user_id: ALICE, course_slug: CC, lesson_id: CC4, content_hash: getPublishedLesson(CC, CC4).hash, progress: record({ seen: ['hook-b1'] }), state: 'in_progress', pct: 3 }] });
        const gen = await reset();
        pool.queries.length = 0;
        const all = await getLessonProgress({ userId: ALICE, withEpoch: true });
        assert.deepEqual(all.records.map((r) => [r.lessonId, r.state, r.lessonEpoch, r.lessonResetAt]), [
            [CC4, 'in_progress', null, null],
            [CH1, 'not_started', gen.lessonEpoch, gen.lessonResetAt],
        ]);
        assert.deepEqual(pool.progressStatements().filter((sql) => sql !== SQL.writeBack), [SQL.selectEpoch, SQL.selectRowsWithEpochs]);
        assert.equal((await getLessonProgress({ userId: ALICE, withEpoch: true, courseSlug: VIBE })).error_type, 'validation', 'withEpoch reads every course');
    });
});

describe('a VM rolled back to a pre-Phase 5 api (R14; the runbook row of plan 8.5)', () => {
    it('a pre-reset copy the old api merged into the tombstone comes back after going forward as the current generation\'s record', async () => {
        use({ rows: [ch1Row('in_progress')] });
        const gen = await reset();
        // The Phase 4 save path: lock, merge, write, no generation check.
        const preReset = record({ seen: ['hook-b1'], answers: answered, updatedAt: '2026-10-24T00:00:00.000Z' });
        const { rows } = await pool.query(SQL.lockRow, [ALICE, VIBE, CH1]);
        const merged = mergeProgress(parseProgress(rows[0].progress), sanitizeProgress(preReset, { now: NOW }));
        const pct = lessonPct(ch1.lesson, merged);
        await pool.query(SQL.updateRow, [ALICE, VIBE, CH1, JSON.stringify(merged), pct, lessonState(ch1.lesson, merged), ch1.hash, merged.updatedAt]);
        // Back on the Phase 5 api: the old answers are the current generation's record (the runbook
        // says so; the learner can start the lesson over again). Later pre-reset copies are refused.
        const all = await getLessonProgress({ userId: ALICE, withEpoch: true });
        const ch1Record = all.records.find((r) => r.lessonId === CH1);
        assert.equal(ch1Record.lessonEpoch, gen.lessonEpoch);
        assert.deepEqual(ch1Record.progress.answers, answered);
        const later = await save([{ courseSlug: VIBE, lessonId: CH1, lessonEpoch: null, progress: record({ seen: ['s1-b1'], updatedAt: NOW.toISOString() }) }]);
        assert.deepEqual(later.rejected.map((r) => r.error_type), ['lesson_reset']);
    });
});

describe('deleteAllLessonProgress keeps what was earned and the generations (G5, G18)', () => {
    it('G5: a read lesson deleted before any XP read keeps its 50 XP', async () => {
        use({ rows: [ch1Row('read', record({ seen: [...ch1.index.readingBlockIds] }))] });
        const deleted = await deleteAllLessonProgress({ userId: ALICE });
        assert.equal(deleted.deleted, 1);
        assert.equal(pool.xpOf(ALICE), 50);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.stubKeyShare, SQL.xpLock, SQL.deleteLessonsKeepingXp, SQL.deleteAllReviewCards, SQL.upsertEpoch, 'commit']);
    });

    it('G5: an AI app\'s write that commits just before the delete reaches the row is deleted with its awards', async () => {
        // The MCP writers lock only their row (never the learner lock): course-progress-update marks
        // the lesson read and commits while delete-all runs, right before the statement that deletes.
        use({ rows: [ch1Row('in_progress')] });
        pool.interleave((text) => text.includes('delete from lesson_progress'), () => {
            Object.assign(pool.row(ALICE, VIBE, CH1), { state: 'read', progress: record({ seen: [...ch1.index.readingBlockIds] }) });
        });
        const deleted = await deleteAllLessonProgress({ userId: ALICE });
        assert.equal(deleted.deleted, 1);
        assert.equal(pool.row(ALICE, VIBE, CH1), undefined);
        assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} done 40`, `lesson ${VIBE}/${CH1} start 10`], 'the done milestone of the row as deleted');
    });

    it('G18: the reset rows survive; afterwards the kept generation saves, null is refused with lessonResetAt and no record', async () => {
        use({ rows: [ch1Row('in_progress')] });
        const gen = await reset();
        const deleted = await deleteAllLessonProgress({ userId: ALICE });
        assert.equal(pool.row(ALICE, VIBE, CH1), undefined);
        assert.equal(pool.lessonResetOf(ALICE, VIBE, CH1).lesson_epoch, gen.lessonEpoch, 'the generation is kept');
        const old = await save([{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) }], { epoch: deleted.epoch });
        assert.deepEqual(old.rejected, [{ courseSlug: VIBE, lessonId: CH1, error_type: 'lesson_reset', lessonEpoch: gen.lessonEpoch, lessonResetAt: gen.lessonResetAt }]);
        assert.equal(pool.row(ALICE, VIBE, CH1), undefined, 'nothing stored');
        const kept = await save([{ courseSlug: VIBE, lessonId: CH1, lessonEpoch: gen.lessonEpoch, progress: record({ seen: ['s1-b1'] }) }], { epoch: deleted.epoch });
        assert.deepEqual(kept.rejected, []);
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.seen, ['s1-b1']);
        assert.deepEqual(pool.awardsOf(ALICE), [`lesson ${VIBE}/${CH1} start 10`], 'the ledger outlives both');
    });
});

describe('the MCP course tools after a reset (G9)', () => {
    it('course-progress-get reads a restarted lesson like an untouched one; course-quiz-check builds on the empty record; no MCP statement names the Phase 5 tables', async () => {
        use({ rows: [ch1Row('in_progress')] });
        await reset();
        pool.queries.length = 0;
        const one = await getCourseProgress({ userId: ALICE, courseSlug: VIBE, lessonId: CH1 });
        assert.deepEqual([one.state, one.pct, one.updated_at, one.exam_first_try?.answered ?? 0], ['not_started', 0, null, 0]);
        const list = await getCourseProgress({ userId: ALICE, courseSlug: VIBE });
        const listed = list.lessons.find((l) => l.lesson_id === CH1);
        assert.deepEqual([listed.state, listed.pct, listed.updated_at], ['not_started', 0, null]);
        const untouched = list.lessons.find((l) => l.lesson_id !== CH1);
        assert.deepEqual([untouched.state, untouched.updated_at], ['not_started', null], 'the same as a lesson never opened');

        const q4 = [...ch1.index.questions.values()].find((q) => q.question.id === 'q4').question;
        const wrong = String(q4.options.findIndex((o) => !q4.answer.includes(o.id)) + 1);
        const checked = await applyQuizCheck({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, questionId: 'q4', choices: [wrong], now: NOW });
        assert.equal(checked.outcome, 'incorrect');
        const stored = pool.row(ALICE, VIBE, CH1).progress;
        assert.deepEqual(Object.keys(stored.answers), ['check-quiz/q4'], 'only the new answer');
        assert.equal(stored.answers['check-quiz/q4'].attempts, 1, 'a fresh attempt, not the old correct answer');
        assert.deepEqual(stored.seen, []);
        await markLessonProgress({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, lastBlockId: 's1-b1', now: NOW });
        const after = await getCourseProgress({ userId: ALICE, courseSlug: VIBE, lessonId: CH1 });
        assert.equal(after.updated_at, NOW.toISOString(), 'a real change has a time again');
        const named = pool.queries.filter((q) => PHASE5_TABLES.test(q.sql) || /lesson_progress_resets|'xp:'|for key share/.test(q.sql));
        assert.deepEqual(named, [], 'the remote role has no grant on them');
    });
});

describe('Phase 6 R4: a restart and delete-all take the review state with them (migration 020)', () => {
    /** A Good prior learned on the 20th and reviewed on the 22nd (reps 1), and its log row. */
    const reviewed = (user, course, lesson, card) => ({
        card: {
            user_id: user, course_slug: course, lesson_id: lesson, card_id: card, learned_at: '2026-10-20T03:00:00.000Z', prior_rating: 3,
            stability: 10.96, difficulty: 2.11, reps: 1, last_rating: 3, last_review_day: '2026-10-22', due_day: '2026-11-02',
        },
        log: { user_id: user, course_slug: course, lesson_id: lesson, card_id: card, review_day: '2026-10-22', rating: 3, elapsed_days: 2, interval_days: 11, stability: 10.96, difficulty: 2.11, source: 'web' },
    });
    const seeded = () => {
        const items = [
            reviewed(ALICE, VIBE, CH1, 'card-frontend'), reviewed(ALICE, VIBE, CH1, 'card-api'),
            reviewed(ALICE, CC, CC4, 'card-checks'), reviewed(BOB, VIBE, CH1, 'card-frontend'),
        ];
        return {
            rows: [ch1Row('read', record({ seen: [...ch1.index.readingBlockIds] })), { ...ch1Row('read', record({ seen: [...ch1.index.readingBlockIds] })), user_id: BOB }],
            awards: [{ user_id: ALICE, source: 'lesson', item_key: `${VIBE}/${CH1}`, milestone: 'start', xp: 10 }, { user_id: ALICE, source: 'lesson', item_key: `${VIBE}/${CH1}`, milestone: 'done', xp: 40 }],
            days: [{ user_id: ALICE, day: '2026-10-22' }],
            reviewCards: items.map((i) => i.card),
            reviewLog: items.map((i) => i.log),
        };
    };
    const keys = (user) => pool.reviewRows(user).map((r) => `${r.lesson_id}/${r.card_id}`);

    it('the reset deletes that lesson\'s cards and their log rows only (other lessons, other learners, XP and days untouched), last in its transaction', async () => {
        use(seeded());
        const result = await reset();
        assert.equal(result.error_type, undefined, JSON.stringify(result));
        assert.deepEqual(pool.progressStatements().slice(-3), [SQL.upsertLessonEpoch, SQL.deleteLessonReviewCards, 'commit']);
        assert.deepEqual(pool.queries.find((q) => q.sql === SQL.deleteLessonReviewCards).params, [ALICE, VIBE, CH1]);
        assert.deepEqual(keys(ALICE), [`${CC4}/card-checks`]);
        assert.deepEqual(pool.logRows(ALICE).map((l) => l.card_id), ['card-checks'], 'the log went by cascade');
        assert.deepEqual([keys(BOB), pool.logRows(BOB).length], [[`${CH1}/card-frontend`], 1]);
        assert.equal(pool.xpOf(ALICE), 50, 'XP stays (O2)');
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-22']);
    });

    it('a failure of the review delete rolls the whole reset back', async () => {
        use(seeded());
        pool.fail({ code: '40001', message: 'could not serialize (db.internal)', when: (text) => text === SQL.deleteLessonReviewCards });
        const failed = await quiet(() => reset());
        assert.equal(failed.error_type, 'unknown');
        assert.deepEqual(keys(ALICE), [`${CC4}/card-checks`, `${CH1}/card-api`, `${CH1}/card-frontend`]);
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.seen, [...ch1.index.readingBlockIds], 'the record too');
        assert.equal(pool.logRows(ALICE).length, 3);
    });

    it('finishing the lesson again adds its cards fresh: a new Good prior dated the new finish, no reviews', async () => {
        use(seeded());
        const gen = await reset();
        assert.deepEqual(await getReviewQueue({ userId: ALICE }).then((q) => [q.inQueue, keys(ALICE).length]), [1, 1], 'the tombstone enters nothing');
        await save([{ courseSlug: VIBE, lessonId: CH1, lessonEpoch: gen.lessonEpoch, progress: record({ seen: [...ch1.index.readingBlockIds], updatedAt: NOW.toISOString() }) }]);
        const finishedAt = pool.row(ALICE, VIBE, CH1).progress_changed_at;
        const q = await getReviewQueue({ userId: ALICE });
        assert.equal(q.inQueue, 6);
        const fresh = pool.reviewRows(ALICE).filter((r) => r.lesson_id === CH1);
        assert.equal(fresh.length, 5);
        for (const row of fresh) {
            assert.deepEqual([row.reps, row.lapses, row.last_review_day, row.prior_rating, row.stability, row.learned_at.toISOString()],
                [0, 0, null, 3, LESSON_PRIORS.good.stability, finishedAt.toISOString()], row.card_id);
            assert.equal(row.due_day, new Date(Date.parse(`${jstDay(finishedAt)}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10));
        }
        assert.deepEqual(pool.logRows(ALICE).map((l) => l.card_id), ['card-checks'], 'the old reviews are gone for good');
    });

    it('delete-all deletes every review card and log row of the learner, right after the lesson rows; generations, XP and learning days stay', async () => {
        use({ ...seeded(), lessonResets: [{ user_id: ALICE, course_slug: CC, lesson_id: CC4, lesson_epoch: OTHER_GEN }] });
        const deleted = await deleteAllLessonProgress({ userId: ALICE });
        assert.equal(deleted.deleted, 1, 'the lesson rows only');
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.stubKeyShare, SQL.xpLock, SQL.deleteLessonsKeepingXp, SQL.deleteAllReviewCards, SQL.upsertEpoch, 'commit']);
        assert.deepEqual([keys(ALICE), pool.logRows(ALICE)], [[], []]);
        assert.deepEqual([keys(BOB).length, pool.logRows(BOB).length], [1, 1]);
        assert.equal(pool.lessonResetOf(ALICE, CC, CC4).lesson_epoch, OTHER_GEN);
        assert.equal(pool.xpOf(ALICE), 50);
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-22']);
    });

    it('a failure after the review delete rolls delete-all back as a whole', async () => {
        use(seeded());
        pool.fail({ code: '40001', message: 'could not serialize (db.internal)', when: (text) => text === SQL.upsertEpoch });
        const failed = await quiet(() => deleteAllLessonProgress({ userId: ALICE }));
        assert.equal(failed.error_type, 'unknown');
        assert.equal(keys(ALICE).length, 3);
        assert.equal(pool.logRows(ALICE).length, 3);
        assert.ok(pool.row(ALICE, VIBE, CH1));
    });
});
