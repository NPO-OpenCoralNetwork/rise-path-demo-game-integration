// tools/core/lessonProgress.js against an in-memory lesson_progress (helpers/lessonProgressPool.js,
// exact SQL): the MCP grading path (applyQuizCheck), section marking (markLessonProgress), the
// REST save merge, the reset epoch and the delete, plus the jsonb size estimate and the 42501
// mapping. Lessons come from the real published catalog (vibe-ch1: jp+en; cc-04: a multi question
// with shuffled option ids).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    applyQuizCheck,
    deleteAllLessonProgress,
    getLessonProgress,
    markLessonProgress,
    progressTextBytes,
    saveLessonProgress,
    PROGRESS_MAX_BYTES,
} from '../../tools/core/lessonProgress.js';
import { getPublishedLesson } from '../../tools/core/courseCatalog.js';
import { classifyDbError } from '../../tools/core/dbErrors.js';
import { lessonPct, lessonState, ratingClockKey } from '../../shared/lesson/progress.js';
import { PROGRESS_LIMITS, lessonIndex, mergeProgress, sanitizeProgress } from '../../shared/lesson/progressMerge.js';
import { createLessonProgressPool, jsonbText, norm, SQL } from './helpers/lessonProgressPool.js';
import { publishedLessons } from './helpers/publishedLessons.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const CC = 'claude-code';
const CC4 = 'cc-04-verify';
const NOW = new Date('2026-10-23T09:00:00.000Z');

const ch1 = getPublishedLesson(VIBE, CH1);
const cc4 = getPublishedLesson(CC, CC4);
const question = (entry, id) => [...entry.index.questions.values()].find((q) => q.question.id === id);
/** Positional label of an option id ("1".."n"). */
const label = (entry, questionId, optionId) => String(question(entry, questionId).question.options.findIndex((o) => o.id === optionId) + 1);
const wrongLabel = (entry, questionId) => {
    const q = question(entry, questionId).question;
    return String(q.options.findIndex((o) => !q.answer.includes(o.id)) + 1);
};
const rightLabels = (entry, questionId) => question(entry, questionId).question.answer.map((id) => label(entry, questionId, id));

const record = (overrides = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z', ...overrides });

let pool;
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

beforeEach(() => {
    resetPoolForTests();
    pool = createLessonProgressPool();
    setPoolForTests(pool);
});

afterEach(() => {
    resetPoolForTests();
});

describe('applyQuizCheck (MCP course-quiz-check)', () => {
    const check = (args) => applyQuizCheck({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, now: NOW, ...args });

    it('a correct first answer records firstTry and returns the explanation and correct labels', async () => {
        const result = await check({ questionId: 'q4', choices: rightLabels(ch1, 'q4'), locale: 'en' });
        assert.equal(result.outcome, 'correct');
        assert.equal(result.mode, 'exam');
        assert.equal(result.block_id, 'check-quiz', 'the block is resolved from the question id');
        assert.deepEqual(result.correct_labels, rightLabels(ch1, 'q4'));
        assert.equal(result.locale, 'en');
        assert.equal(result.explanation, question(ch1, 'q4').question.explanation.en);
        assert.equal(result.content_hash, ch1.hash);
        const stored = pool.row(ALICE, VIBE, CH1);
        assert.deepEqual(stored.progress.answers['check-quiz/q4'], { attempts: 1, correct: true, chosen: question(ch1, 'q4').question.answer, firstTry: true });
        assert.equal(stored.progress.updatedAt, NOW.toISOString());
        assert.equal(stored.content_hash, ch1.hash);
        assert.equal(stored.pct, result.pct);
        assert.equal(stored.state, result.state);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.insertPlaceholder, SQL.lockRow, SQL.updateRow, 'commit']);
    });

    it('a first miss is a normal result: feedback for the chosen wrong option and the hint, no answer', async () => {
        const result = await check({ questionId: 'q1', choices: [wrongLabel(ch1, 'q1')] });
        assert.equal(result.outcome, 'incorrect');
        assert.equal(result.error_type, undefined);
        assert.equal(result.attempts, 1);
        assert.equal(result.attempts_left, 1);
        assert.ok(result.hint, 'q1 has a hint');
        assert.equal(result.feedback.length, 1);
        assert.equal(result.feedback[0].label, wrongLabel(ch1, 'q1'));
        assert.equal(result.correct_labels, undefined);
        assert.equal(result.explanation, undefined);
        assert.equal(result.locale, 'jp', 'no locale asked: the lesson\'s source locale');
        assert.equal(pool.row(ALICE, VIBE, CH1).progress.answers['s1-check/q1'].firstTry, false);
    });

    it('the second miss reveals the answer; then the question is locked and nothing more is recorded', async () => {
        await check({ questionId: 'q4', choices: [wrongLabel(ch1, 'q4')] });
        const second = await check({ questionId: 'q4', choices: [wrongLabel(ch1, 'q4')] });
        assert.equal(second.outcome, 'revealed');
        assert.deepEqual(second.correct_labels, rightLabels(ch1, 'q4'));
        assert.equal(second.attempts_left, 0);
        const before = structuredClone(pool.row(ALICE, VIBE, CH1));
        pool.queries.length = 0;
        const third = await check({ questionId: 'q4', choices: rightLabels(ch1, 'q4') });
        assert.equal(third.outcome, 'locked');
        assert.equal(third.this_choice_correct, true, 'the new choice is judged but not recorded');
        assert.ok(third.explanation);
        assert.deepEqual(pool.row(ALICE, VIBE, CH1), before, 'nothing written');
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.insertPlaceholder, SQL.lockRow, 'rollback']);
        assert.deepEqual(before.progress.answers['check-quiz/q4'], { attempts: 2, correct: false, chosen: [question(ch1, 'q4').question.options[Number(wrongLabel(ch1, 'q4')) - 1].id], firstTry: false, revealed: true });
    });

    it('reveal after a miss adds no attempt; reveal before any answer or on a prediction is not allowed', async () => {
        const early = await check({ questionId: 'q2', reveal: true });
        assert.equal(early.outcome, 'not_allowed');
        assert.equal(early.correct_labels, undefined);
        assert.ok(early.note);
        assert.equal(pool.row(ALICE, VIBE, CH1), undefined, 'the placeholder row was rolled back');

        await check({ questionId: 'q2', choices: [wrongLabel(ch1, 'q2')] });
        const shown = await check({ questionId: 'q2', reveal: true });
        assert.equal(shown.outcome, 'revealed');
        assert.deepEqual(shown.correct_labels, rightLabels(ch1, 'q2'));
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.answers['s2-check/q2'].attempts, 1);
        assert.equal(pool.row(ALICE, VIBE, CH1).progress.answers['s2-check/q2'].revealed, true);

        await check({ questionId: 'q0', choices: ['1'] });
        assert.equal((await check({ questionId: 'q0', reveal: true })).outcome, 'not_allowed');
    });

    it('a prediction is recorded once with its real correctness, answer shown; a second one is locked', async () => {
        const first = await check({ questionId: 'q0', choices: [wrongLabel(ch1, 'q0')] });
        assert.equal(first.outcome, 'predicted');
        assert.equal(first.attempts_left, undefined, 'predictions are not graded');
        assert.deepEqual(first.correct_labels, rightLabels(ch1, 'q0'));
        assert.ok(first.explanation);
        assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress.answers['hook-predict/q0'].correct, false);
        assert.equal((await check({ questionId: 'q0', choices: rightLabels(ch1, 'q0') })).outcome, 'locked');
    });

    it('multi questions: labels map back to shuffled option ids, order and duplicates do not matter', async () => {
        const right = rightLabels(cc4, 'e6');
        const result = await applyQuizCheck({ userId: ALICE, courseSlug: CC, lessonId: CC4, questionId: 'e6', choices: [...right].reverse().concat(right[0]), now: NOW });
        assert.equal(result.outcome, 'correct');
        assert.deepEqual(new Set(pool.row(ALICE, CC, CC4).progress.answers['check-quiz/e6'].chosen), new Set(question(cc4, 'e6').question.answer));
        // Integer labels work too.
        const single = await applyQuizCheck({ userId: ALICE, courseSlug: CC, lessonId: CC4, questionId: 'e1', choices: [Number(rightLabels(cc4, 'e1')[0])], now: NOW });
        assert.equal(single.outcome, 'correct');
    });

    it('refusals record nothing: invalid choice, unknown question or lesson, both choices and reveal, lesson_changed', async () => {
        const refusals = [
            [{ questionId: 'q4', choices: ['9'] }, 'invalid_choice'],
            [{ questionId: 'q4', choices: ['1', '2'] }, 'invalid_choice'],
            [{ questionId: 'q4', choices: [] }, 'invalid_choice'],
            [{ questionId: 'q4', choices: ['a'] }, 'invalid_choice'],
            [{ questionId: 'q4' }, 'validation'],
            [{ questionId: 'q4', choices: ['1'], reveal: true }, 'validation'],
            [{ questionId: 'nope', choices: ['1'] }, 'not_found'],
            [{ questionId: 'q4', blockId: 's1-check', choices: ['1'] }, 'not_found'],
            [{ questionId: 'q4', choices: ['1'], contentHash: 'sha256:0000000000000000' }, 'lesson_changed'],
            [{ lessonId: 'vibe-ch99', questionId: 'q4', choices: ['1'] }, 'not_found'],
            [{ courseSlug: 'Vibe_Coding', questionId: 'q4', choices: ['1'] }, 'not_found'],
            [{ userId: 'not-a-uuid', questionId: 'q4', choices: ['1'] }, 'validation'],
        ];
        for (const [args, type] of refusals) {
            const result = await check(args);
            assert.equal(result.error_type, type, JSON.stringify(args));
            assert.equal(result.correct_labels, undefined);
            assert.equal(result.explanation, undefined);
        }
        const changed = await check({ questionId: 'q4', choices: ['1'], contentHash: 'sha256:0000000000000000' });
        assert.equal(changed.content_hash, ch1.hash, 'lesson_changed tells the agent the current hash');
        assert.equal(pool.queries.length, 0, 'no refusal reached the database');
        assert.equal((await check({ questionId: 'q4', choices: ['1'], contentHash: ch1.hash })).error_type, undefined, 'the current hash passes');
    });

    it('a row deleted between the placeholder INSERT and the lock (the learner\'s delete committed) is inserted again', async () => {
        pool = createLessonProgressPool({ rows: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, progress: record({ seen: ['hook-b1'] }) }] });
        setPoolForTests(pool);
        // Another session's delete commits right before each SELECT … FOR UPDATE (`times` of them).
        const vanishBeforeLock = (times) => {
            const connect = pool.connect;
            let left = times;
            pool.connect = async () => {
                const client = await connect();
                return {
                    ...client,
                    query: async (sql, params) => {
                        if (left > 0 && norm(sql) === SQL.lockRow) {
                            left -= 1;
                            await pool.query(SQL.deleteAll, [ALICE]);
                        }
                        return client.query(sql, params);
                    },
                };
            };
        };
        vanishBeforeLock(1);
        const result = await check({ questionId: 'q4', choices: rightLabels(ch1, 'q4') });
        assert.equal(result.outcome, 'correct');
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.insertPlaceholder, SQL.deleteAll, SQL.lockRow, SQL.insertPlaceholder, SQL.lockRow, SQL.updateRow, 'commit']);
        const stored = pool.row(ALICE, VIBE, CH1).progress;
        assert.deepEqual(stored.seen, [], 'the deleted record is not written back');
        assert.deepEqual(Object.keys(stored.answers), ['check-quiz/q4']);

        pool.queries.length = 0;
        vanishBeforeLock(2);
        const lost = await quiet(() => check({ questionId: 'q1', choices: [wrongLabel(ch1, 'q1')] }));
        assert.equal(lost.error_type, 'unknown', 'twice in a row: a plain failure, nothing written');
        assert.equal(pool.queries.some((q) => q.sql === SQL.updateRow), false);
        assert.equal(pool.inTransaction(), false);
    });

    it('without a database: db_connection, and a driver error never reaches the result', async () => {
        setPoolForTests(null);
        assert.equal((await check({ questionId: 'q4', choices: ['1'] })).error_type, 'db_connection');
        setPoolForTests(pool);
        pool.fail({});
        const failed = await quiet(() => check({ questionId: 'q4', choices: ['1'] }));
        assert.equal(failed.error_type, 'unknown');
        assert.doesNotMatch(JSON.stringify(failed), /relation|db\.internal/);
        assert.equal(pool.inTransaction(), false, 'rolled back');
        assert.deepEqual(pool.released, [false], 'the connection went back to the pool');
    });
});

describe('markLessonProgress (MCP course-progress-update)', () => {
    const mark = (args) => markLessonProgress({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, now: NOW, ...args });

    it('skips a section whose check question is open, marks it once answered, and sets the resume block', async () => {
        const first = await mark({ readSectionIds: ['hook', '1-1', '1-3'], lastBlockId: 's1-b1' });
        assert.deepEqual(first.marked_section_ids, ['1-3']);
        assert.deepEqual(first.skipped, [
            { section_id: 'hook', reason: 'answer_check_first', question_ids: ['q0'] },
            { section_id: '1-1', reason: 'answer_check_first', question_ids: ['q1'] },
        ]);
        assert.equal(first.last_block_id, 's1-b1');
        const stored = pool.row(ALICE, VIBE, CH1).progress;
        assert.deepEqual(stored.seen, ch1.index.sections.get('1-3').readingBlockIds);
        assert.equal(stored.lastBlockId, 's1-b1');
        assert.equal(stored.updatedAt, NOW.toISOString());
        assert.equal(stored.editedAt, undefined, 'seen and resume writes move only updatedAt');

        await applyQuizCheck({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, questionId: 'q1', choices: [wrongLabel(ch1, 'q1')], now: NOW });
        const second = await mark({ readSectionIds: ['1-1'] });
        assert.deepEqual(second.marked_section_ids, ['1-1']);
        assert.deepEqual(second.skipped, []);
        const after = pool.row(ALICE, VIBE, CH1);
        assert.deepEqual(after.progress.seen, [...ch1.index.sections.get('1-3').readingBlockIds, ...ch1.index.sections.get('1-1').readingBlockIds]);
        assert.equal(second.pct, lessonPct(ch1.lesson, after.progress));
        assert.equal(second.state, lessonState(ch1.lesson, after.progress));
        assert.equal(after.pct, second.pct);
    });

    it('exam questions do not block marking (the check section has none open); a no-op writes nothing', async () => {
        const result = await mark({ readSectionIds: ['check', 'summary'] });
        assert.deepEqual(result.marked_section_ids, ['check', 'summary']);
        pool.queries.length = 0;
        const again = await mark({ readSectionIds: ['summary'] });
        assert.deepEqual(again.marked_section_ids, ['summary']);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.insertPlaceholder, SQL.lockRow, 'rollback']);
    });

    it('validates ids against the lesson before any query', async () => {
        for (const [args, type] of [
            [{ readSectionIds: ['nope'] }, 'validation'],
            [{ readSectionIds: 'hook' }, 'validation'],
            [{ lastBlockId: 'nope' }, 'validation'],
            [{}, 'validation'],
            [{ lessonId: 'drafts' }, 'not_found'],
        ]) {
            assert.equal((await mark(args)).error_type, type, JSON.stringify(args));
        }
        assert.equal(pool.queries.length, 0);
    });
});

describe('saveLessonProgress (REST PUT) and the reset epoch', () => {
    const save = (args) => saveLessonProgress({ userId: ALICE, epoch: null, now: NOW, ...args });

    it('merges into the stored record: a correct server answer is final, seen is a union, unknown well-formed keys are kept', async () => {
        pool = createLessonProgressPool({
            rows: [{
                user_id: ALICE, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, pct: 10, state: 'in_progress',
                progress: record({ seen: ['hook-b1'], answers: { 'check-quiz/q4': { attempts: 1, correct: true, chosen: ['b'], firstTry: true } }, checks: { 'card:cards/c1': true }, editedAt: '2026-10-20T00:00:00.000Z' }),
            }],
        });
        setPoolForTests(pool);
        const client = record({
            seen: ['s1-b1', 'block-from-a-newer-version'],
            answers: {
                'check-quiz/q4': { attempts: 2, correct: false, chosen: ['a'], firstTry: false, revealed: true },
                'new-block/new-q': { attempts: 1, correct: true, chosen: ['x'], firstTry: true },
                'check-quiz/q3': { attempts: 0, correct: false, chosen: [], firstTry: false },
            },
            checks: { 'card:cards/c1': false, 'bad key': true },
            editedAt: '2026-10-21T00:00:00.000Z',
            updatedAt: '2026-10-21T00:00:00.000Z',
            summary: { pct: 100, state: 'mastered' },
        });
        const result = await save({ records: [{ courseSlug: VIBE, lessonId: CH1, progress: client }] });
        assert.equal(result.epoch, null);
        assert.deepEqual(result.rejected, []);
        const [merged] = result.records;
        assert.deepEqual(merged.progress.answers['check-quiz/q4'], { attempts: 1, correct: true, chosen: ['b'], firstTry: true, revealed: true });
        assert.deepEqual(merged.progress.answers['new-block/new-q'], { attempts: 1, correct: true, chosen: ['x'], firstTry: true });
        assert.equal(merged.progress.answers['check-quiz/q3'], undefined, 'attempts 0 without a reveal means not answered');
        assert.deepEqual(merged.progress.seen, ['hook-b1', 's1-b1', 'block-from-a-newer-version']);
        assert.deepEqual(merged.progress.checks, { 'card:cards/c1': false }, 'the newer edit wins; malformed keys dropped');
        assert.equal(merged.progress.summary, undefined, 'the client summary is ignored');
        assert.equal(merged.pct, lessonPct(ch1.lesson, merged.progress));
        assert.equal(merged.state, lessonState(ch1.lesson, merged.progress));
        assert.notEqual(merged.state, 'mastered');
        assert.equal(merged.updatedAt, '2026-10-21T00:00:00.000Z');
        const stored = pool.row(ALICE, VIBE, CH1);
        assert.deepEqual(stored.progress, merged.progress);
        assert.equal(stored.progress_updated_at.toISOString(), '2026-10-21T00:00:00.000Z');
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.selectEpoch, SQL.insertPlaceholder, SQL.lockRow, SQL.updateRow, 'commit']);
        assert.deepEqual(pool.queries.find((q) => q.sql === SQL.advisoryLock).params, [ALICE]);
    });

    it('keeps an edit time per check across saves, so a device left open does not undo a newer mark', async () => {
        const at = (hour) => `2026-10-23T0${hour}:00:00.000Z`;
        const cards = { 'card:cards/c1': false, 'card:cards/c2': false };
        const loaded = { checks: cards, updatedAt: at(1), editedAt: at(1), editedKeys: { 'card:cards/c1': at(1), 'card:cards/c2': at(1) } };
        const edited = (key, hour) => record({ ...loaded, checks: { ...cards, [key]: true }, updatedAt: at(hour), editedAt: at(hour), editedKeys: { ...loaded.editedKeys, [key]: at(hour) } });
        await save({ records: [{ courseSlug: VIBE, lessonId: CH1, progress: record(loaded) }] });
        // Device A marks c1 known; device B, still holding c1 "still learning", then marks c2 known.
        await save({ records: [{ courseSlug: VIBE, lessonId: CH1, progress: edited('card:cards/c1', 2) }] });
        const result = await save({ records: [{ courseSlug: VIBE, lessonId: CH1, progress: edited('card:cards/c2', 3) }] });
        const stored = pool.row(ALICE, VIBE, CH1).progress;
        assert.deepEqual(stored.checks, { 'card:cards/c1': true, 'card:cards/c2': true });
        assert.deepEqual(stored.editedKeys, { 'card:cards/c1': at(2), 'card:cards/c2': at(3) });
        assert.deepEqual(result.records[0].progress.editedKeys, stored.editedKeys);
    });

    it('locks rows in one order (course/lesson), rejects unknown lessons per record and returns each lesson once', async () => {
        const result = await save({
            records: [
                { courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) },
                { courseSlug: CC, lessonId: CC4, progress: record({ seen: ['hook-b1'] }) },
                { courseSlug: VIBE, lessonId: 'vibe-ch1.5', progress: record() },
                { courseSlug: VIBE, lessonId: 'not-published', progress: record() },
                { courseSlug: 42, lessonId: null, progress: record() },
                { courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['s1-b1'] }) },
            ],
        });
        assert.deepEqual(result.rejected, [
            { courseSlug: VIBE, lessonId: 'vibe-ch1.5', error_type: 'unknown_lesson' },
            { courseSlug: VIBE, lessonId: 'not-published', error_type: 'unknown_lesson' },
            { courseSlug: null, lessonId: null, error_type: 'unknown_lesson' },
        ]);
        assert.deepEqual(result.records.map((r) => `${r.courseSlug}/${r.lessonId}`), [`${CC}/${CC4}`, `${VIBE}/${CH1}`]);
        assert.deepEqual(result.records[1].progress.seen, ['hook-b1', 's1-b1'], 'a lesson sent twice merges both');
        const locks = pool.queries.filter((q) => q.sql === SQL.lockRow).map((q) => `${q.params[1]}/${q.params[2]}`);
        assert.deepEqual(locks, [`${CC}/${CC4}`, `${VIBE}/${CH1}`, `${VIBE}/${CH1}`]);
    });

    it('an epoch that is not the current one refuses the whole batch (progress_reset) and writes nothing', async () => {
        const deleted = await deleteAllLessonProgress({ userId: ALICE });
        pool.queries.length = 0;
        const stale = await save({ epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) }] });
        assert.equal(stale.error_type, 'progress_reset');
        assert.equal(stale.epoch, deleted.epoch);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.selectEpoch, 'rollback']);
        assert.equal(pool.rows().length, 0);

        const fresh = await save({ epoch: deleted.epoch.toUpperCase(), records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) }] });
        assert.equal(fresh.epoch, deleted.epoch, 'the epoch compares case-insensitively');
        assert.equal(pool.rows().length, 1);
    });

    it('too large: rejected before SQL when the record alone is too big, after the merge otherwise', async () => {
        const seen = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}${i}-${'x'.repeat(70)}`);
        const alone = await save({ records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: seen('a', 600), answers: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`b${i}-${'y'.repeat(60)}/q${i}`, { attempts: 1, correct: false, chosen: ['a'], firstTry: false }])) }) }] });
        assert.deepEqual(alone.rejected, [{ courseSlug: VIBE, lessonId: CH1, error_type: 'too_large' }]);
        assert.equal(pool.queries.filter((q) => q.sql === SQL.insertPlaceholder).length, 0);

        assert.equal((await save({ records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: seen('a', 450) }) }] })).records.length, 1);
        const merged = await save({ records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: seen('b', 450) }) }, { courseSlug: CC, lessonId: CC4, progress: record({ seen: ['hook-b1'] }) }] });
        assert.deepEqual(merged.rejected, [{ courseSlug: VIBE, lessonId: CH1, error_type: 'too_large' }]);
        assert.deepEqual(merged.records.map((r) => r.lessonId), [CC4], 'the rest of the batch is saved');
        assert.equal(pool.row(ALICE, VIBE, CH1).progress.seen.length, 450, 'the stored record is unchanged');
    });

    it('bad input never reaches the database', async () => {
        for (const args of [{ records: [] }, { records: Array.from({ length: 26 }, () => ({})) }, { epoch: 5, records: [{}] }, { userId: 'x', records: [{}] }]) {
            assert.equal((await save(args)).error_type, 'validation', JSON.stringify(args).slice(0, 60));
        }
        assert.equal(pool.queries.length, 0);
    });
});

describe('deleteAllLessonProgress and getLessonProgress', () => {
    it('delete removes only the caller\'s rows and sets a new epoch each time', async () => {
        pool = createLessonProgressPool({
            rows: [
                { user_id: ALICE, course_slug: VIBE, lesson_id: CH1, progress: record({ seen: ['hook-b1'] }) },
                { user_id: ALICE, course_slug: CC, lesson_id: CC4, progress: record({ seen: ['hook-b1'] }) },
                { user_id: BOB, course_slug: VIBE, lesson_id: CH1, progress: record({ seen: ['hook-b1'] }) },
            ],
        });
        setPoolForTests(pool);
        const first = await deleteAllLessonProgress({ userId: ALICE });
        assert.equal(first.deleted, 2);
        assert.match(first.epoch, /^[0-9a-f-]{36}$/);
        assert.deepEqual(pool.rows().map((r) => r.user_id), [BOB]);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.deleteAll, SQL.upsertEpoch, 'commit']);
        const second = await deleteAllLessonProgress({ userId: ALICE });
        assert.equal(second.deleted, 0);
        assert.notEqual(second.epoch, first.epoch);
        assert.equal(pool.epochOf(BOB), null);
    });

    it('get: epoch only when asked (the MCP role cannot read it); stale pct/state recomputed and written back', async () => {
        const progress = record({ seen: [...ch1.index.readingBlockIds] });
        pool = createLessonProgressPool({
            rows: [
                { user_id: ALICE, course_slug: VIBE, lesson_id: CH1, progress, pct: 3, state: 'in_progress', content_hash: 'sha256:old' },
                { user_id: ALICE, course_slug: CC, lesson_id: CC4, progress: record({ seen: ['hook-b1'] }), pct: 4, state: 'in_progress', content_hash: cc4.hash },
                { user_id: ALICE, course_slug: VIBE, lesson_id: 'retired-lesson', progress: record({ seen: ['x'] }), pct: 50, state: 'in_progress', content_hash: 'sha256:gone' },
            ],
            resets: { [ALICE]: 'cccccccc-0000-4000-8000-000000000001' },
        });
        setPoolForTests(pool);
        const all = await getLessonProgress({ userId: ALICE, withEpoch: true });
        assert.equal(all.epoch, 'cccccccc-0000-4000-8000-000000000001');
        assert.deepEqual(all.records.map((r) => r.lessonId), [CC4, 'retired-lesson', CH1]);
        const vibe = all.records.find((r) => r.lessonId === CH1);
        assert.equal(vibe.pct, lessonPct(ch1.lesson, progress));
        assert.equal(vibe.state, 'read');
        assert.equal(vibe.updatedAt, progress.updatedAt);
        assert.equal(all.records.find((r) => r.lessonId === CC4).pct, 4, 'current hash: stored values');
        assert.equal(all.records.find((r) => r.lessonId === 'retired-lesson').pct, 50, 'no longer published: stored values');
        assert.equal(pool.row(ALICE, VIBE, CH1).content_hash, ch1.hash);
        assert.equal(pool.row(ALICE, VIBE, CH1).state, 'read');
        assert.deepEqual(pool.queries.filter((q) => q.sql === SQL.writeBack).map((q) => q.params[2]), [CH1]);

        pool.queries.length = 0;
        const one = await getLessonProgress({ userId: ALICE, courseSlug: CC, lessonId: CC4 });
        assert.equal('epoch' in one, false);
        assert.deepEqual(one.records.map((r) => r.lessonId), [CC4]);
        assert.deepEqual(pool.progressStatements(), [SQL.selectLessonRows]);
        assert.deepEqual((await getLessonProgress({ userId: ALICE, courseSlug: CC })).records.map((r) => r.lessonId), [CC4]);
        assert.equal((await getLessonProgress({ userId: ALICE, lessonId: CC4 })).error_type, 'validation', 'lesson_id needs course_slug');
    });

    it('a failed write-back is logged, not returned', async () => {
        pool = createLessonProgressPool({ rows: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, progress: record({ seen: ['hook-b1'] }), content_hash: 'sha256:old' }] });
        setPoolForTests(pool);
        pool.fail({ code: '42501', when: (text) => text === SQL.writeBack });
        const result = await quiet(() => getLessonProgress({ userId: ALICE }));
        assert.equal(result.records.length, 1);
        assert.equal(result.records[0].pct, lessonPct(ch1.lesson, record({ seen: ['hook-b1'] })));
    });
});

describe('sizes and errors', () => {
    it('progressTextBytes matches jsonb text (a space after every ":" and ",")', () => {
        const samples = [
            {},
            record(),
            record({ seen: ['a', 'b'], answers: { 'x/y': { attempts: 1, correct: true, chosen: ['a', 'b'], firstTry: true, revealed: true } }, checks: { 'card:c/d': false }, ratings: { lesson: 3 }, editedAt: NOW.toISOString(), editedKeys: { 'card:c/d': NOW.toISOString(), 'rating:lesson': NOW.toISOString() } }),
            { nested: [[], [1, [2, {}]], { a: null }], text: 'é漢字' },
        ];
        for (const sample of samples) assert.equal(progressTextBytes(sample), Buffer.byteLength(jsonbText(sample), 'utf8'), JSON.stringify(sample));
        assert.equal(PROGRESS_MAX_BYTES, 65536);
    });

    it('the fullest record of every published lesson, with an edit time per check and rating, stays far below the cap', () => {
        const iso = NOW.toISOString();
        for (const { lesson } of publishedLessons()) {
            const index = lessonIndex(lesson);
            const full = record({
                seen: [...index.blockIds],
                answers: Object.fromEntries([...index.questions].map(([key, entry]) => [key, { attempts: PROGRESS_LIMITS.attempts, correct: true, chosen: entry.question.options.map((o) => o.id), firstTry: true, revealed: true }])),
                checks: Object.fromEntries([...index.checkKeys].map((key) => [key, true])),
                ratings: Object.fromEntries([...index.ratingKeys].map((key) => [key, 3])),
                lastBlockId: [...index.blockIds].at(-1),
                updatedAt: iso,
                editedAt: iso,
                editedKeys: Object.fromEntries([...index.checkKeys, ...[...index.ratingKeys].map(ratingClockKey)].map((key) => [key, iso])),
            });
            const clean = sanitizeProgress(full, { now: NOW });
            assert.equal(Object.keys(clean.editedKeys).length, index.checkKeys.size + index.ratingKeys.size, lesson.id);
            assert.ok(progressTextBytes(mergeProgress(clean, clean)) < PROGRESS_MAX_BYTES / 4, lesson.id);
        }
    });

    it('42501 (no grant yet) maps to permission_denied without the table name', async () => {
        const result = await quiet(() => classifyDbError(Object.assign(new Error('permission denied for table lesson_progress'), { code: '42501' }), 'applyQuizCheck'));
        assert.deepEqual(result, { error: 'server setup incomplete', error_type: 'permission_denied' });
    });
});
