// Phase 6 stage 2 (design §3.2–§3.5, §3.8, §7.1): the review queue on the server
// (tools/core/reviewQueue.js) against the in-memory lesson_progress / review_cards / review_log
// (helpers/lessonProgressPool.js, exact SQL, migration 020's CHECKs and trigger column).
// - R1: which cards enter (a finished lesson's current cards, a marked card), with the lesson as
//   their first rating (Good, or Again after a 「もう一度」 mark), dated the record's last change;
//   the learning day is not moved by reads or saves that change nothing (Critique 1); a card added
//   to a lesson later enters with no memory and sorts last (Critique 4);
// - R2: 10 graded cards a Japan-time day, most at risk first, the rest carried over;
// - R3: grading ('again' / 'good'): once a day, due cards only, the FSRS-6 memory, the log row,
//   no XP; reveal records nothing;
// - hidden cards (removed from a lesson, lesson unpublished), the catalog's card id guard;
// - noteReviewDay: a web review's learning day.
// The behaviour on PostgreSQL 16 is proved by scripts/db/verify-phase6.mjs.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    CARD_ID,
    DONE_TODAY_SQL,
    ENTER_REVIEW_CARDS_SQL,
    GRADE_REVIEW_CARD_SQL,
    INSERT_REVIEW_LOG_SQL,
    LOCK_REVIEW_CARD_SQL,
    REVIEW_ROWS_SQL,
    REVIEW_SOURCES,
    enterReviewCards,
    getReviewQueue,
    gradeReviewCard,
    reviewCatalog,
    summaryOf,
} from '../../tools/core/reviewQueue.js';
import { LEARNER_LOCK_SQL, deleteAllLessonProgress, getLessonProgress, markLessonProgress, resetLessonProgress, saveLessonProgress } from '../../tools/core/lessonProgress.js';
import { LEARNING_DAY_SQL, LESSON_XP_SELECT, TODAY_SQL, getAchievements, noteReviewDay } from '../../tools/core/achievements.js';
import { clearCatalogCacheForTests, getPublishedLesson, listPublishedLessons } from '../../tools/core/courseCatalog.js';
import { getCourseProgress } from '../../tools/core/courseLessons.js';
import { LESSON_DONE_STATES } from '../../shared/lesson/progress.js';
import { lessonReviewCards } from '../../shared/review/cards.js';
import { AGAIN, GOOD, scheduler, seededUnit } from '../../shared/review/fsrs.js';
import { LESSON_PRIORS, REVIEW_DAILY_LIMIT } from '../../shared/review/queue.js';
import { addDays, createLessonProgressPool, jstDay, norm, PHASE6_TABLES, SQL } from './helpers/lessonProgressPool.js';
import { ROOT } from './helpers/publishedLessons.js';

const ALICE = 'aaaaaaaa-6666-4000-8000-000000000001';
const BOB = 'aaaaaaaa-6666-4000-8000-000000000002';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const CH2 = 'vibe-ch2';
const CC = 'claude-code';
const CC1 = 'cc-01-first-session';
const CC2 = 'cc-02-permissions';
const CC3 = 'cc-03-plan-first';
const CC4 = 'cc-04-verify';
const DAY_MS = 86400000;

// The repository's content (a caller may have set a test directory).
delete process.env.RP_CONTENT_DIR;
clearCatalogCacheForTests();
const ch1 = getPublishedLesson(VIBE, CH1);
const cardsOf = (course, lesson) => lessonReviewCards(getPublishedLesson(course, lesson).lesson);
const CH1_IDS = cardsOf(VIBE, CH1).map((c) => c.cardId);

/** The fake's clock: every transaction's now(). */
let at = Date.parse('2026-10-20T03:00:00.000Z');
const setNow = (iso) => {
    at = Date.parse(iso);
};
const today = () => jstDay(new Date(at));

let pool;
const use = (seed = {}) => {
    pool = createLessonProgressPool({ clock: () => new Date(at), ...seed });
    setPoolForTests(pool);
    return pool;
};
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

const record = (overrides = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-19T00:00:00.000Z', ...overrides });
/** vibe-ch1 read to the end (state 'read'). */
const finished = (overrides = {}) => record({ seen: [...ch1.index.readingBlockIds], ...overrides });
const save = (courseSlug, lessonId, progress, userId = ALICE) => saveLessonProgress({ userId, epoch: null, now: new Date(at), records: [{ courseSlug, lessonId, progress }] });
const queue = (userId = ALICE) => getReviewQueue({ userId });
const grade = (args = {}) => gradeReviewCard({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', rating: 'good', source: 'web', ...args });
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.card_id, r]));

/**
 * A review_cards seed: the lesson as the first rating, `daysAgo` Japan-time days before now (due
 * daysAgo − 2 days ago for Good, daysAgo − 1 for Again), or no memory (`learned: false`).
 */
const priorRow = (course, lesson, card, { daysAgo = 3, again = false, learned = true, user = ALICE } = {}) => {
    const learnedAt = new Date(at - daysAgo * DAY_MS);
    const memory = again ? LESSON_PRIORS.again : LESSON_PRIORS.good;
    return learned
        ? { user_id: user, course_slug: course, lesson_id: lesson, card_id: card, learned_at: learnedAt, prior_rating: again ? 1 : 3, stability: memory.stability, difficulty: memory.difficulty, due_day: addDays(jstDay(learnedAt), memory.intervalDays) }
        : { user_id: user, course_slug: course, lesson_id: lesson, card_id: card, due_day: addDays(today(), -daysAgo) };
};
/** A card graded today (Good, after a prior learned five days ago). */
const reviewedTodayRow = (course, lesson, card, user = ALICE) => ({
    user_id: user, course_slug: course, lesson_id: lesson, card_id: card, learned_at: new Date(at - 5 * DAY_MS), prior_rating: 3,
    stability: 10.96, difficulty: 2.11, reps: 1, last_rating: 3, last_review_day: today(), due_day: addDays(today(), 11),
});

beforeEach(() => {
    resetPoolForTests();
    setNow('2026-10-20T03:00:00.000Z');
    use();
});

afterEach(() => {
    resetPoolForTests();
});

describe('the module\'s statements are the fake\'s (exact SQL)', () => {
    it('entry, rows, lock, done today, grade, log, and the learner lock and today they share', () => {
        assert.equal(norm(ENTER_REVIEW_CARDS_SQL), SQL.enterReviewCards);
        assert.equal(norm(REVIEW_ROWS_SQL), SQL.reviewRows);
        assert.equal(norm(LOCK_REVIEW_CARD_SQL), SQL.lockReviewCard);
        assert.equal(norm(DONE_TODAY_SQL), SQL.doneToday);
        assert.equal(norm(GRADE_REVIEW_CARD_SQL), SQL.gradeReviewCard);
        assert.equal(norm(INSERT_REVIEW_LOG_SQL), SQL.insertReviewLog);
        assert.equal(norm(LEARNER_LOCK_SQL), SQL.advisoryLock);
        assert.equal(norm(TODAY_SQL), SQL.selectToday);
        assert.deepEqual([...REVIEW_SOURCES], ['web', 'mcp']);
    });

    it('R1 "finished" is the XP "done" rule: the entry\'s state list is LESSON_DONE_STATES and LESSON_XP_SELECT\'s', () => {
        const list = (sql) => /p\.state IN \(([^)]*)\)/.exec(sql)?.[1].split(',').map((s) => s.trim().replace(/'/g, ''));
        assert.deepEqual(list(ENTER_REVIEW_CARDS_SQL), [...LESSON_DONE_STATES]);
        assert.deepEqual(list(LESSON_XP_SELECT), [...LESSON_DONE_STATES]);
    });

    it('the time is the database\'s: no statement takes a time or a day from JavaScript', () => {
        for (const sql of [ENTER_REVIEW_CARDS_SQL, REVIEW_ROWS_SQL, LOCK_REVIEW_CARD_SQL, DONE_TODAY_SQL, GRADE_REVIEW_CARD_SQL]) {
            assert.match(sql, /\(now\(\) AT TIME ZONE 'Asia\/Tokyo'\)::date/);
        }
        assert.doesNotMatch(INSERT_REVIEW_LOG_SQL, /review_day|reviewed_at/, 'the log\'s day and time are column defaults');
        assert.doesNotMatch(ENTER_REVIEW_CARDS_SQL, /entered_at/, 'entered_at is clock_timestamp() (the column default)');
    });
});

describe('reviewCatalog: the review cards of the published lessons', () => {
    it('every card of every published lesson once, keyed course/lesson/card, in catalog order (order 0..n−1), with its lesson title and locale', () => {
        const catalog = reviewCatalog();
        const expected = listPublishedLessons().flatMap((entry) => lessonReviewCards(entry.lesson)
            .map((card) => ({ key: `${entry.courseSlug}/${entry.lesson.id}/${card.cardId}`, card, entry })));
        assert.deepEqual([...catalog.keys()], expected.map((e) => e.key));
        const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/tests/fixtures/published-card-ids.json'), 'utf8'));
        assert.equal(catalog.size, fixture.published.length);
        [...catalog.values()].forEach((card, i) => {
            const { entry, card: source } = expected[i];
            assert.deepEqual(card, {
                courseSlug: entry.courseSlug, lessonId: entry.lesson.id, blockId: source.blockId, cardId: source.cardId, checkKey: source.checkKey,
                front: source.front, back: source.back, lessonTitle: entry.lesson.title, lessonLocale: entry.lesson.locale, order: i,
            });
            assert.match(card.cardId, CARD_ID);
        });
    });
});

describe('R1: which cards enter, with what first rating (getReviewQueue)', () => {
    it('a finished lesson: every current card, the Good prior dated the record\'s last change, due that Japan-time day + 2 (the 15:00Z boundary)', async () => {
        for (const [time, day, due] of [['2026-10-24T14:59:59.000Z', '2026-10-24', '2026-10-26'], ['2026-10-24T15:00:00.000Z', '2026-10-25', '2026-10-27']]) {
            use();
            setNow(time);
            assert.equal((await save(VIBE, CH1, finished())).records[0].state, 'read');
            assert.equal(pool.row(ALICE, VIBE, CH1).progress_changed_at.toISOString(), time, 'the trigger column');
            const q = await queue();
            assert.equal(q.error_type, undefined, JSON.stringify(q));
            const rows = pool.reviewRows(ALICE);
            assert.deepEqual(rows.map((r) => r.card_id), [...CH1_IDS].sort());
            for (const row of rows) {
                assert.deepEqual(
                    [row.learned_at.toISOString(), row.prior_rating, row.stability, row.difficulty, row.due_day, row.reps, row.lapses, row.last_rating, row.last_review_day],
                    [time, 3, LESSON_PRIORS.good.stability, LESSON_PRIORS.good.difficulty, due, 0, 0, null, null],
                    row.card_id,
                );
            }
            assert.deepEqual(
                [q.learnerId, q.today, q.timeZone, q.dailyLimit, q.doneToday, q.remainingToday, q.dueTotal, q.carriedOver, q.inQueue, q.nextDueOn, q.cards],
                [ALICE, day, 'Asia/Tokyo', 10, 0, 0, 0, 0, 5, due, []],
                'never due on the learning day',
            );
            assert.deepEqual(pool.logRows(ALICE), [], 'entry is not a review');
        }
    });

    it('the latest in-lesson mark picks the prior: 「もう一度」 → Again (+1 day), 「覚えた」 → Good; a mark in an unfinished lesson enters only that card', async () => {
        await save(VIBE, CH1, finished({ checks: { 'card:cards/card-api': false, 'card:cards/card-deploy': true } }));
        await save(VIBE, CH2, record({ seen: ['hook-b1'], checks: { 'card:summary-cards/card-goal': true } }));
        await save(CC, CC4, record({ checks: { 'card:summary-cards/card-checks': false } }));
        await queue();
        const rows = byId(pool.reviewRows(ALICE));
        assert.deepEqual(Object.keys(rows).sort(), [...CH1_IDS, 'card-goal', 'card-checks'].sort());
        const again = LESSON_PRIORS.again;
        const good = LESSON_PRIORS.good;
        for (const [id, memory, prior, due] of [
            ['card-api', again, 1, '2026-10-21'],
            ['card-deploy', good, 3, '2026-10-22'],
            ['card-frontend', good, 3, '2026-10-22'],
            ['card-goal', good, 3, '2026-10-22'],
            ['card-checks', again, 1, '2026-10-21'],
        ]) {
            assert.deepEqual([rows[id].prior_rating, rows[id].stability, rows[id].difficulty, rows[id].due_day], [prior, memory.stability, memory.difficulty, due], id);
        }
        assert.deepEqual([rows['card-goal'].lesson_id, rows['card-checks'].lesson_id], [CH2, CC4]);
    });

    it('nothing enters from a reset tombstone, a not_started record, an unpublished lesson, a lesson without cards, or a mark on a card id or block the lesson does not have', async () => {
        await save(VIBE, CH1, finished());
        await resetLessonProgress({ userId: ALICE, epoch: null, courseSlug: VIBE, lessonId: CH1 });
        await save(CC, CC1, record({ lastBlockId: 'hook-b1' }));
        assert.equal(pool.row(ALICE, CC, CC1).state, 'not_started');
        await save(VIBE, 'vibe-ch0', record({ seen: [...getPublishedLesson(VIBE, 'vibe-ch0').index.readingBlockIds] }));
        assert.ok(LESSON_DONE_STATES.has(pool.row(ALICE, VIBE, 'vibe-ch0').state), 'finished, but it has no cards');
        await save(CC, CC4, record({ checks: { 'card:summary-cards/card-gone': true, 'card:other-block/card-checks': true } }));
        // A finished record of a lesson the catalog does not have (unpublished since), with a mark.
        await pool.query(SQL.insertPlaceholder, [ALICE, VIBE, 'vibe-ch99', JSON.stringify(record())]);
        Object.assign(pool.row(ALICE, VIBE, 'vibe-ch99'), { state: 'read', progress: record({ checks: { 'card:cards/card-frontend': true } }) });
        const q = await queue();
        assert.deepEqual([q.error_type, q.inQueue, pool.reviewRows(ALICE)], [undefined, 0, []]);
    });

    it('the entry runs once per read and is idempotent: a second read adds nothing and keeps the memory (also after a review)', async () => {
        await save(VIBE, CH1, finished());
        await queue();
        const entry = pool.queries.filter((q) => q.sql === SQL.enterReviewCards).at(-1);
        const catalog = [...reviewCatalog().values()];
        const { good, again } = LESSON_PRIORS;
        assert.deepEqual(entry.params, [
            ALICE, catalog.map((c) => c.courseSlug), catalog.map((c) => c.lessonId), catalog.map((c) => c.checkKey), catalog.map((c) => c.cardId),
            good.stability, good.difficulty, good.intervalDays, again.stability, again.difficulty, again.intervalDays,
        ], 'the catalog arrays and LESSON_PRIORS');
        setNow('2026-10-22T03:00:00.000Z');
        assert.equal((await grade()).error_type, undefined);
        const before = pool.reviewRows(ALICE);
        const again2 = await queue();
        assert.deepEqual(pool.reviewRows(ALICE), before);
        assert.equal(byId(before)['card-frontend'].reps, 1);
        assert.deepEqual([again2.inQueue, again2.doneToday, again2.remainingToday], [5, 1, 4]);
    });

    it('a learner\'s entry reads only their own records', async () => {
        await save(VIBE, CH1, finished(), BOB);
        await queue(ALICE);
        assert.deepEqual(pool.reviewRows(ALICE), []);
        await queue(BOB);
        assert.equal(pool.reviewRows(BOB).length, 5);
    });
});

describe('the learning day is when the record changed, not when it was read (Critique 1, migration 020 trigger)', () => {
    it('a GET write-back, a save that changes nothing and an MCP read before the first review read leave the learning day', async () => {
        await save(VIBE, CH1, finished());
        const learned = pool.row(ALICE, VIBE, CH1).progress_changed_at.toISOString();
        setNow('2026-10-23T03:00:00.000Z');
        pool.row(ALICE, VIBE, CH1).content_hash = 'stale';
        await getLessonProgress({ userId: ALICE, withEpoch: true });
        assert.ok(pool.queries.some((q) => q.sql === SQL.writeBack), 'the GET wrote back pct/state');
        const unchanged = await save(VIBE, CH1, finished());
        assert.equal(unchanged.learned, false, 'the same record: nothing learned');
        pool.row(ALICE, VIBE, CH1).content_hash = 'stale';
        await getCourseProgress({ userId: ALICE, courseSlug: VIBE, lessonId: CH1 });
        const row = pool.row(ALICE, VIBE, CH1);
        assert.equal(row.content_hash, ch1.hash, 'the MCP read wrote back too');
        assert.deepEqual([row.progress_changed_at.toISOString(), row.updated_at.toISOString()], [learned, '2026-10-23T03:00:00.000Z'], 'updated_at moved, the learning time did not');
        const q = await queue();
        const rows = pool.reviewRows(ALICE);
        assert.ok(rows.every((r) => r.learned_at.toISOString() === learned && r.due_day === '2026-10-22'), JSON.stringify(rows.map((r) => [r.learned_at, r.due_day])));
        assert.deepEqual([q.dueTotal, q.remainingToday], [5, 5], 'due since the 22nd, not pushed to the 25th');
    });

    it('a real change before the first review read (a new mark) moves it; a row from before migration 020 keeps its updated_at through a write-back', async () => {
        await save(VIBE, CH1, finished());
        setNow('2026-10-23T03:00:00.000Z');
        await save(VIBE, CH1, finished({ checks: { 'card:cards/card-api': false }, updatedAt: '2026-10-23T02:00:00.000Z' }));
        await queue();
        const rows = byId(pool.reviewRows(ALICE));
        assert.deepEqual([rows['card-api'].due_day, rows['card-frontend'].due_day, rows['card-frontend'].learned_at.toISOString()], ['2026-10-24', '2026-10-25', '2026-10-23T03:00:00.000Z']);

        use({ rows: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, progress: finished(), state: 'read', pct: 90, content_hash: 'stale', updated_at: new Date('2026-10-18T05:00:00.000Z') }] });
        assert.equal(pool.row(ALICE, VIBE, CH1).progress_changed_at, null, 'a row from before migration 020');
        await getLessonProgress({ userId: ALICE });
        assert.equal(pool.row(ALICE, VIBE, CH1).progress_changed_at.toISOString(), '2026-10-18T05:00:00.000Z', 'the write-back froze the old updated_at in');
        await queue();
        assert.ok(pool.reviewRows(ALICE).every((r) => r.learned_at.toISOString() === '2026-10-18T05:00:00.000Z' && r.due_day === '2026-10-20'));
    });

    it('an AI app\'s write that began before a REST save and wrote after it is dated when it wrote (clock_timestamp()), so its finish gives the other cards their priors', async () => {
        const t0 = '2026-10-20T03:00:00.000Z';
        const t1 = '2026-10-20T03:00:01.000Z';
        const t2 = '2026-10-20T03:00:02.000Z';
        const last = ch1.index.sections.get('1-4').readingBlockIds;
        const almost = record({ seen: [...ch1.index.readingBlockIds].filter((id) => !last.includes(id)), checks: { 'card:cards/card-api': true } });
        // S1 at t1: a REST save marks card-api; a review read enters it, learned at t1.
        setNow(t1);
        assert.equal((await save(VIBE, CH1, almost)).records[0].state, 'in_progress');
        await queue();
        assert.deepEqual(pool.reviewRows(ALICE).map((r) => [r.card_id, r.learned_at.toISOString()]), [['card-api', t1]]);
        // M: course-progress-update (one row lock, no learner lock). Its transaction began at t0, before
        // S1; it wrote at t2, after S1 committed. Its now() is t0, its write time t2.
        setNow(t0);
        pool.interleave((text) => text === SQL.updateRow, () => setNow(t2));
        const marked = await markLessonProgress({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, readSectionIds: ['1-4'] });
        assert.deepEqual([marked.error_type, marked.state], [undefined, 'read']);
        assert.equal(pool.row(ALICE, VIBE, CH1).progress_changed_at.toISOString(), t2, 'the write\'s time, not the transaction\'s start');
        await queue();
        const rows = byId(pool.reviewRows(ALICE));
        for (const id of CH1_IDS.filter((c) => c !== 'card-api')) {
            assert.deepEqual([rows[id].prior_rating, rows[id].stability, rows[id].learned_at?.toISOString(), rows[id].due_day], [3, LESSON_PRIORS.good.stability, t2, '2026-10-22'], id);
        }
    });
});

describe('content changes: a card added later, a removed card, an unpublished lesson, a card id the table refuses (RP_CONTENT_DIR copy)', () => {
    let dir;
    const saved = process.env.RP_CONTENT_DIR;
    const src = path.join(ROOT, 'content/courses/vibe-coding');
    const ch1Json = () => JSON.parse(fs.readFileSync(path.join(src, 'lessons', 'vibe-ch1.lesson.json'), 'utf8'));
    /** The content copy with vibe-ch1 changed by `change` (its flashcards block's cards). */
    const useContent = (change) => {
        const lesson = ch1Json();
        const block = lesson.sections.flatMap((s) => s.blocks).find((b) => b.type === 'flashcards');
        block.cards = change(block.cards);
        fs.writeFileSync(path.join(dir, 'courses', 'vibe-coding', 'lessons', 'vibe-ch1.lesson.json'), JSON.stringify(lesson));
        process.env.RP_CONTENT_DIR = dir;
        clearCatalogCacheForTests();
    };
    const useRepoContent = () => {
        delete process.env.RP_CONTENT_DIR;
        clearCatalogCacheForTests();
    };
    const added = { id: 'card-added', front: { jp: '追加', en: 'Added' }, back: { jp: 'あとから加えたカード', en: 'A card added later' } };

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-review-'));
        const course = path.join(dir, 'courses', 'vibe-coding');
        fs.mkdirSync(path.join(course, 'lessons'), { recursive: true });
        fs.copyFileSync(path.join(src, 'course.json'), path.join(course, 'course.json'));
        for (const file of fs.readdirSync(path.join(src, 'lessons'))) fs.copyFileSync(path.join(src, 'lessons', file), path.join(course, 'lessons', file));
    });
    afterEach(useRepoContent);
    after(() => {
        if (saved === undefined) delete process.env.RP_CONTENT_DIR;
        else process.env.RP_CONTENT_DIR = saved;
        clearCatalogCacheForTests();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('Critique 4: a card added after the learner\'s last change in the lesson has no memory, is due the day after it entered, sorts last, and is rated as new', async () => {
        await save(VIBE, CH1, finished());
        await queue();
        useContent((cards) => [...cards, added]);
        setNow('2026-10-25T03:00:00.000Z');
        await queue();
        const row = byId(pool.reviewRows(ALICE))['card-added'];
        assert.deepEqual([row.learned_at, row.prior_rating, row.stability, row.difficulty, row.due_day], [null, null, null, null, '2026-10-26']);
        assert.ok(pool.reviewRows(ALICE).filter((r) => r.card_id !== 'card-added').every((r) => r.due_day === '2026-10-22'), 'the others keep their memory');
        setNow('2026-10-26T03:00:00.000Z');
        const q = await queue();
        assert.deepEqual([q.dueTotal, q.remainingToday], [6, 6]);
        assert.equal(q.cards.at(-1).cardId, 'card-added', 'never studied: not at risk of forgetting, so last');
        const graded = await grade({ cardId: 'card-added' });
        const after = byId(pool.reviewRows(ALICE))['card-added'];
        assert.deepEqual([after.stability, after.difficulty, after.reps, after.lapses, graded.graded.intervalDays], [LESSON_PRIORS.good.stability, LESSON_PRIORS.good.difficulty, 1, 0, 2], 'FSRS\'s new-card Good');
        assert.equal(pool.logRows(ALICE)[0].elapsed_days, null, 'no rating before it');
    });

    it('a change to the lesson after the card was added gives it a prior from that day; marks first, then the finish: the rest get priors', async () => {
        await save(VIBE, CH1, finished());
        await queue();
        useContent((cards) => [...cards, added]);
        setNow('2026-10-24T03:00:00.000Z');
        await save(VIBE, CH1, finished({ checks: { 'card:cards/card-api': true }, updatedAt: '2026-10-24T02:00:00.000Z' }));
        await queue();
        const row = byId(pool.reviewRows(ALICE))['card-added'];
        assert.deepEqual([row.learned_at.toISOString(), row.prior_rating, row.due_day], ['2026-10-24T03:00:00.000Z', 3, '2026-10-26']);

        useRepoContent();
        use();
        setNow('2026-10-20T03:00:00.000Z');
        await save(VIBE, CH1, record({ seen: ['hook-b1'], checks: { 'card:cards/card-api': true } }));
        await queue();
        assert.deepEqual(pool.reviewRows(ALICE).map((r) => r.card_id), ['card-api'], 'the mark alone');
        setNow('2026-10-21T03:00:00.000Z');
        await save(VIBE, CH1, finished({ checks: { 'card:cards/card-api': true }, updatedAt: '2026-10-21T02:00:00.000Z' }));
        await queue();
        const rows = pool.reviewRows(ALICE);
        assert.equal(rows.length, 5);
        for (const r of rows) {
            assert.equal(r.prior_rating, 3, r.card_id);
            assert.equal(r.due_day, r.card_id === 'card-api' ? '2026-10-22' : '2026-10-23', r.card_id);
        }
    });

    it('a card removed from its lesson, or a lesson no longer published, is hidden (row kept), refused not_found, and comes back with its memory', async () => {
        await save(VIBE, CH1, finished());
        setNow('2026-10-22T03:00:00.000Z');
        await queue();
        assert.equal((await grade({ cardId: 'card-deploy' })).error_type, undefined);
        // An unpublished lesson's card, graded today before it was hidden: it still used a slot.
        const seeded = [...pool.reviewRows(ALICE), reviewedTodayRow(VIBE, 'vibe-ch99', 'card-x')];
        use({ reviewCards: seeded });
        const rowsBefore = pool.reviewRows(ALICE);
        useContent((cards) => cards.filter((c) => c.id !== 'card-deploy'));
        const q = await queue();
        assert.deepEqual([q.inQueue, q.doneToday, q.dueTotal, q.remainingToday], [4, 2, 4, 4]);
        assert.ok(!q.cards.some((c) => c.cardId === 'card-deploy' || c.lessonId === 'vibe-ch99'));
        assert.deepEqual(pool.reviewRows(ALICE), rowsBefore, 'hidden, not deleted');
        for (const args of [{ cardId: 'card-deploy' }, { lessonId: 'vibe-ch99', cardId: 'card-x' }]) {
            pool.queries.length = 0;
            assert.equal((await grade(args)).error_type, 'not_found', JSON.stringify(args));
            assert.equal(pool.queries.length, 0, 'refused before any SQL');
        }
        useRepoContent();
        const back = await queue();
        assert.equal(back.inQueue, 5);
        assert.equal(byId(pool.reviewRows(ALICE))['card-deploy'].reps, 1, 'the memory is back');
    });

    it('a card id the table would refuse (longer than 80 characters; the lesson schema allows it) is left out of the catalog and logged once; the lesson\'s other cards still enter', async () => {
        const long = `c${'a'.repeat(80)}`;
        assert.doesNotMatch(long, CARD_ID);
        useContent((cards) => [...cards, { ...added, id: long }]);
        assert.ok(getPublishedLesson(VIBE, CH1), 'the lesson itself is published');
        const first = await quiet(async () => [reviewCatalog(), reviewCatalog()]);
        assert.equal(first.lines.filter((l) => l.includes('[reviewQueue] left out')).length, 1, first.lines.join('\n'));
        assert.match(first.lines[0], /vibe-coding\/vibe-ch1 card "caaaa/);
        assert.ok(!first.lines[0].includes(dir), 'no absolute path in the log');
        assert.equal(first.result[0].size, listPublishedLessons().flatMap((e) => lessonReviewCards(e.lesson)).length - 1, 'every other card of the content copy');
        assert.ok(![...first.result[0].values()].some((c) => c.cardId === long));
        await save(VIBE, CH1, finished());
        const q = await queue();
        assert.equal(q.error_type, undefined, 'no 23514 for the learners who finished the lesson');
        assert.equal(pool.reviewRows(ALICE).length, 5);
    });

    it('a lesson that repeats a card id never reaches the catalog (validateLesson: one id namespace per lesson), so the catalog\'s repeat check is defensive only', async () => {
        useContent((cards) => [...cards, { ...added, id: cards[0].id }]);
        const { result, lines } = await quiet(async () => [getPublishedLesson(VIBE, CH1), reviewCatalog()]);
        assert.equal(result[0], null, 'the lesson is left out of the published lessons');
        assert.ok(lines.some((l) => /Duplicate id/.test(l)), lines.join('\n'));
        assert.ok(![...result[1].values()].some((c) => c.lessonId === CH1), 'none of its cards is a review card');
        assert.ok(!lines.some((l) => l.includes('[reviewQueue] left out')), 'cardsOf never saw it');
    });
});

describe('R2: today\'s list (at most 10 a Japan-time day, most at risk first, the rest carried over)', () => {
    /** 15 due Good priors learned 3 to 7 days ago (cc-01 and cc-02), and one cc-03 card 8 days ago. */
    const fifteen = () => [
        ...cardsOf(CC, CC1).map((c, i) => priorRow(CC, CC1, c.cardId, { daysAgo: 3 + (i % 5) })),
        ...cardsOf(CC, CC2).map((c, i) => priorRow(CC, CC2, c.cardId, { daysAgo: 3 + (i % 5) })),
        priorRow(CC, CC3, 'card-skip', { daysAgo: 8 }),
    ];

    it('15 due, none done: 10 picked, most at risk first, 5 carried over', async () => {
        use({ reviewCards: fifteen() });
        const q = await queue();
        assert.deepEqual([q.dueTotal, q.remainingToday, q.carriedOver, q.doneToday, q.inQueue, q.cards.length], [15, 10, 5, 0, 15, 10]);
        // Same prior: the lowest R is the longest ago; then the earlier due day; then catalog order.
        const daysAgo = (c) => (Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${c.dueOn}T00:00:00Z`)) / DAY_MS + 2;
        const ages = q.cards.map(daysAgo);
        assert.deepEqual(ages, [...ages].sort((a, b) => b - a), 'oldest learning first');
        assert.equal(q.cards[0].cardId, 'card-skip');
        assert.deepEqual(Object.keys(q.cards[0]), ['courseSlug', 'lessonId', 'cardId', 'lessonTitle', 'lessonLocale', 'front', 'back', 'dueOn']);
        const cc3 = getPublishedLesson(CC, CC3).lesson;
        const skip = cardsOf(CC, CC3).find((c) => c.cardId === 'card-skip');
        assert.deepEqual(q.cards[0], { courseSlug: CC, lessonId: CC3, cardId: 'card-skip', lessonTitle: cc3.title, lessonLocale: cc3.locale, front: skip.front, back: skip.back, dueOn: addDays(today(), -6) });
        // Ties (same prior, same day): catalog order.
        const sevens = q.cards.filter((c) => daysAgo(c) === 7).map((c) => `${c.lessonId}/${c.cardId}`);
        const catalogOrder = [...reviewCatalog().values()].map((c) => `${c.lessonId}/${c.cardId}`).filter((k) => sevens.includes(k));
        assert.deepEqual(sevens, catalogOrder);
    });

    it('3 done today: 7 picked; 10 done: none, and a grade is refused review_limit; a hidden card graded today counts', async () => {
        const done = (n) => cardsOf(CC, CC4).slice(0, n).map((c) => reviewedTodayRow(CC, CC4, c.cardId));
        use({ reviewCards: [...fifteen(), ...done(3)] });
        let q = await queue();
        assert.deepEqual([q.doneToday, q.remainingToday, q.carriedOver, q.dueTotal, q.inQueue], [3, 7, 8, 15, 18]);
        use({ reviewCards: [...fifteen(), ...done(7), ...cardsOf(CC, 'cc-05-context').slice(0, 2).map((c) => reviewedTodayRow(CC, 'cc-05-context', c.cardId)), reviewedTodayRow(CC, 'cc-99-gone', 'card-x')] });
        q = await queue();
        assert.deepEqual([q.doneToday, q.remainingToday, q.carriedOver, q.inQueue, q.cards], [10, 0, 15, 24, []], 'the hidden one counts in doneToday, not in inQueue');
        const refused = await grade({ courseSlug: CC, lessonId: CC1, cardId: cardsOf(CC, CC1)[0].cardId });
        assert.deepEqual([refused.error_type, refused.doneToday, refused.dailyLimit, refused.learnerId, refused.summary.doneToday], ['review_limit', 10, REVIEW_DAILY_LIMIT, ALICE, 10]);
        assert.deepEqual(pool.logRows(ALICE), []);
    });

    it('nextDueOn: the earliest due day of a visible card that is not due today; null when every card is due', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-api', { daysAgo: 1 }), priorRow(VIBE, CH1, 'card-deploy', { daysAgo: 0 }), priorRow(VIBE, 'vibe-ch99', 'card-x', { daysAgo: 1 })] });
        let q = await queue();
        assert.deepEqual([q.dueTotal, q.nextDueOn], [0, addDays(today(), 1)]);
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-api', { daysAgo: 4 })] });
        q = await queue();
        assert.deepEqual([q.dueTotal, q.nextDueOn], [1, null]);
    });

    it('summaryOf (pure): hidden rows only in doneToday; a 「もう一度」 prior before a Good one of the same age', () => {
        const catalog = reviewCatalog();
        const row = (card, extra = {}) => ({ course_slug: VIBE, lesson_id: CH1, card_id: card, stability: LESSON_PRIORS.good.stability, difficulty: 2, reps: 0, last_rating: null, due_on: '2026-10-20', days_since: 2, due: true, reviewed_today: false, ...extra });
        const s = summaryOf([
            row('card-frontend'),
            row('card-api', { stability: LESSON_PRIORS.again.stability, days_since: 2 }),
            row('card-x', { course_slug: 'gone' }),
            row('card-commit', { due: false, reviewed_today: true, due_on: '2026-10-31' }),
            row('card-y', { lesson_id: 'vibe-ch99', due: false, reviewed_today: true }),
        ], catalog);
        assert.deepEqual(s.picked.map((p) => p.card.cardId), ['card-api', 'card-frontend']);
        assert.deepEqual([s.doneToday, s.inQueue, s.dueTotal, s.remainingToday, s.carriedOver, s.nextDueOn, s.dailyLimit], [2, 3, 2, 2, 0, '2026-10-31', 10]);
    });
});

describe('R3: grading (gradeReviewCard)', () => {
    it('the first review of a Good prior learned 2 days ago: FSRS-6 at t = 2 (S 10.964, I 11 ± fuzz), the log row, lapses 0, the learner lock first', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 }), priorRow(VIBE, CH1, 'card-api', { daysAgo: 4 })] });
        const result = await grade();
        assert.equal(result.error_type, undefined, JSON.stringify(result));
        assert.deepEqual(pool.progressStatements(), [
            'begin', SQL.advisoryLock, SQL.lockReviewCard, SQL.doneToday, SQL.gradeReviewCard, SQL.insertReviewLog, SQL.reviewRows, 'commit',
        ]);
        const expected = scheduler.review(LESSON_PRIORS.good, GOOD, 2, { fuzzUnit: seededUnit(`${VIBE}/${CH1}/card-frontend#1`) });
        const [lo, hi] = scheduler.fuzzRange(11, 2);
        assert.ok(Math.abs(expected.stability - 10.964332) < 1e-4);
        assert.ok(expected.intervalDays >= lo && expected.intervalDays <= hi, `${expected.intervalDays} in [${lo}, ${hi}]`);
        const row = byId(pool.reviewRows(ALICE))['card-frontend'];
        assert.deepEqual(
            [row.stability, row.difficulty, row.reps, row.lapses, row.last_rating, row.last_review_day, row.due_day],
            [expected.stability, expected.difficulty, 1, 0, 3, today(), addDays(today(), expected.intervalDays)],
        );
        assert.deepEqual(pool.logRows(ALICE), [{
            user_id: ALICE, course_slug: VIBE, lesson_id: CH1, card_id: 'card-frontend', review_day: today(), reviewed_at: new Date(at),
            rating: 3, elapsed_days: 2, interval_days: expected.intervalDays, stability: expected.stability, difficulty: expected.difficulty, source: 'web',
        }]);
        const card = cardsOf(VIBE, CH1)[0];
        assert.deepEqual(result, {
            learnerId: ALICE,
            graded: { courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', rating: 'good', dueOn: row.due_day, intervalDays: expected.intervalDays },
            summary: { today: today(), dailyLimit: 10, doneToday: 1, remainingToday: 1, dueTotal: 1, carriedOver: 0, inQueue: 2, nextDueOn: row.due_day },
            front: card.front, back: card.back, lessonTitle: ch1.lesson.title, lessonLocale: ch1.lesson.locale,
        });
    });

    it('「もう一度」 on a memory is a lapse (lapses 1, rating 1); a 「もう一度」 prior graded 「覚えた」 the next day (L2); a card with no memory is rated as new (elapsed NULL)', async () => {
        use({ reviewCards: [
            priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 8 }),
            priorRow(VIBE, CH1, 'card-api', { daysAgo: 1, again: true }),
            priorRow(VIBE, CH1, 'card-deploy', { learned: false, daysAgo: 0 }),
        ] });
        const lapse = await grade({ rating: 'again' });
        const L3 = scheduler.review(LESSON_PRIORS.good, AGAIN, 8, { fuzzUnit: seededUnit(`${VIBE}/${CH1}/card-frontend#1`) });
        assert.ok(Math.abs(L3.stability - 0.732872) < 1e-4 && L3.intervalDays === 1);
        const L2 = await grade({ cardId: 'card-api' });
        const fresh = await grade({ cardId: 'card-deploy' });
        assert.deepEqual([lapse.graded.intervalDays, L2.graded.intervalDays, fresh.graded.intervalDays], [1, 2, 2]);
        const rows = byId(pool.reviewRows(ALICE));
        assert.deepEqual([rows['card-frontend'].lapses, rows['card-frontend'].last_rating, rows['card-frontend'].stability], [1, 1, L3.stability]);
        assert.ok(Math.abs(rows['card-api'].stability - 1.886788) < 1e-4 && rows['card-api'].lapses === 0);
        assert.deepEqual([rows['card-deploy'].stability, rows['card-deploy'].difficulty, rows['card-deploy'].lapses], [LESSON_PRIORS.good.stability, LESSON_PRIORS.good.difficulty, 0]);
        assert.deepEqual(pool.logRows(ALICE).map((l) => [l.card_id, l.rating, l.elapsed_days]), [['card-api', 3, 1], ['card-deploy', 3, null], ['card-frontend', 1, 8]]);
    });

    it('once a day: a second grade the same day is not_due with reviewedToday (one log row); the next Japan-time day it is not due yet', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 })] });
        const first = await grade();
        const second = await grade({ rating: 'again' });
        assert.deepEqual([second.error_type, second.reviewedToday, second.dueOn, second.learnerId], ['not_due', true, first.graded.dueOn, ALICE]);
        assert.deepEqual(second.summary, first.summary);
        assert.equal(pool.logRows(ALICE).length, 1);
        assert.deepEqual(pool.progressStatements().slice(-5), ['begin', SQL.advisoryLock, SQL.lockReviewCard, SQL.reviewRows, 'rollback'], 'refused under the lock, with the summary, rolled back');
        setNow(`${addDays(today(), 1)}T03:00:00.000Z`);
        const next = await grade();
        assert.deepEqual([next.error_type, next.reviewedToday], ['not_due', false]);
    });

    it('the UPDATE repeats the rules: a grade that commits between the lock read and the UPDATE leaves the UPDATE with no row (not_due, nothing logged)', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 })] });
        pool.interleave((text) => text === SQL.gradeReviewCard, () => {
            Object.assign(pool.reviewCard(ALICE, VIBE, CH1, 'card-frontend'), { reps: 1, last_rating: 3, last_review_day: today(), stability: 10.9, due_day: addDays(today(), 11) });
        });
        const result = await grade();
        assert.deepEqual([result.error_type, result.reviewedToday], ['not_due', true]);
        assert.ok(!pool.queries.some((q) => q.sql === SQL.insertReviewLog));
        assert.deepEqual(pool.logRows(ALICE), []);
    });

    it('due only: a card due tomorrow is not_due (and GRADE_REVIEW_CARD_SQL alone matches no row); a card not in the queue is not_in_queue with the summary', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 1 })] });
        const early = await grade();
        assert.deepEqual([early.error_type, early.reviewedToday, early.dueOn, early.summary.inQueue], ['not_due', false, addDays(today(), 1), 1]);
        const direct = await pool.query(GRADE_REVIEW_CARD_SQL, [ALICE, VIBE, CH1, 'card-frontend', 5, 5, 0, 3, 5]);
        assert.equal(direct.rowCount, 0);
        const missing = await grade({ cardId: 'card-api' });
        assert.deepEqual([missing.error_type, missing.learnerId, missing.summary.inQueue, missing.summary.today], ['not_in_queue', ALICE, 1, today()]);
        assert.match(missing.error, /^This card is not in the learner's reviews\.$/);
    });

    it('the cap is read under the lock: another card graded just before the count makes this one review_limit at 9 done', async () => {
        use({ reviewCards: [
            ...cardsOf(CC, CC4).map((c) => reviewedTodayRow(CC, CC4, c.cardId)),
            ...cardsOf(CC, CC3).slice(0, 2).map((c) => reviewedTodayRow(CC, CC3, c.cardId)),
            priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 }),
            priorRow(VIBE, CH1, 'card-api', { daysAgo: 2 }),
        ] });
        assert.equal(pool.reviewRows(ALICE).filter((r) => r.last_review_day === today()).length, 9);
        pool.interleave((text) => text === SQL.doneToday, () => {
            Object.assign(pool.reviewCard(ALICE, VIBE, CH1, 'card-api'), { reps: 1, last_rating: 3, last_review_day: today(), stability: 10.9, due_day: addDays(today(), 11) });
        });
        const result = await grade();
        assert.deepEqual([result.error_type, result.doneToday], ['review_limit', 10]);
    });

    it('reveal: true answers the back after the same checks and records nothing; refused when not due', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 }), priorRow(VIBE, CH1, 'card-api', { daysAgo: 1 })] });
        const before = pool.reviewRows(ALICE);
        const shown = await gradeReviewCard({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', reveal: true, source: 'mcp' });
        const card = cardsOf(VIBE, CH1)[0];
        assert.deepEqual(shown, { learnerId: ALICE, revealed: { courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', dueOn: today() }, front: card.front, back: card.back, lessonTitle: ch1.lesson.title, lessonLocale: 'jp' });
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.lockReviewCard, SQL.doneToday, 'rollback']);
        assert.deepEqual([pool.reviewRows(ALICE), pool.logRows(ALICE)], [before, []]);
        const early = await gradeReviewCard({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, cardId: 'card-api', reveal: true, source: 'mcp' });
        assert.deepEqual([early.error_type, early.reviewedToday, 'back' in early, 'front' in early], ['not_due', false, false, false]);
    });

    it('validation and not_found before any SQL; the source is recorded (mcp)', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 })] });
        for (const [args, type] of [
            [{ userId: 'x' }, 'validation'],
            [{ courseSlug: 'Vibe' }, 'validation'],
            [{ lessonId: 'vibe ch1' }, 'validation'],
            [{ cardId: 'Card' }, 'validation'],
            [{ cardId: `c${'a'.repeat(80)}` }, 'validation'],
            [{ cardId: 7 }, 'validation'],
            [{ source: 'app' }, 'validation'],
            [{ source: undefined }, 'validation'],
            [{ rating: 'easy' }, 'validation'],
            [{ rating: 3 }, 'validation'],
            [{ rating: undefined }, 'validation'],
            [{ rating: 'good', reveal: true }, 'validation'],
            [{ rating: undefined, reveal: 'yes' }, 'validation'],
            [{ rating: undefined, reveal: false }, 'validation'],
            [{ cardId: 'card-nope' }, 'not_found'],
            [{ lessonId: 'vibe-ch99' }, 'not_found'],
        ]) {
            assert.equal((await grade(args)).error_type, type, JSON.stringify(args));
        }
        assert.equal(pool.queries.length, 0);
        const ok = await grade({ source: 'mcp', userId: ALICE.toUpperCase() });
        assert.equal(ok.learnerId, ALICE, 'one spelling per learner');
        assert.equal(pool.logRows(ALICE)[0].source, 'mcp');
        assert.deepEqual(pool.queries.find((q) => q.sql === SQL.advisoryLock).params, [ALICE], 'the lock key is the canonical id');
    });

    it('server clock: 23:59 and 00:01 in Japan decide the review day; forged times in the arguments change nothing', async () => {
        setNow('2026-10-25T14:59:00.000Z');
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 3 }), priorRow(VIBE, CH1, 'card-api', { daysAgo: 3 })] });
        const late = await grade({ today: '2030-01-01', dueDay: '2030-01-01', reviewedAt: '2030-01-01T00:00:00Z', now: new Date('2030-01-01') });
        setNow('2026-10-25T15:01:00.000Z');
        const early = await grade({ cardId: 'card-api' });
        const rows = byId(pool.reviewRows(ALICE));
        assert.deepEqual([rows['card-frontend'].last_review_day, rows['card-api'].last_review_day], ['2026-10-25', '2026-10-26']);
        assert.equal(rows['card-frontend'].due_day, addDays('2026-10-25', late.graded.intervalDays));
        assert.equal(rows['card-api'].due_day, addDays('2026-10-26', early.graded.intervalDays));
        assert.equal(pool.logRows(ALICE).find((l) => l.card_id === 'card-api').elapsed_days, 4, 'a day later in Japan: one more elapsed day');
        assert.ok(!JSON.stringify(pool.queries.map((q) => q.params)).includes('2030'), 'no forged value reached a statement');
    });

    it('no XP and no badge: no review statement names xp_awards; the achievements stay the same', async () => {
        use({ rows: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, progress: finished(), state: 'read', pct: 90, content_hash: ch1.hash, progress_changed_at: new Date(at - 2 * DAY_MS) }] });
        const before = await getAchievements({ userId: ALICE });
        pool.queries.length = 0;
        await queue();
        for (const card of CH1_IDS) assert.equal((await grade({ cardId: card })).error_type, undefined, card);
        assert.ok(!pool.queries.some((q) => /xp_awards|learning_days|'xp:'/.test(q.sql)), 'neither XP nor a learning day inside the review');
        const after = await getAchievements({ userId: ALICE });
        assert.deepEqual(after.xp, before.xp);
        assert.deepEqual(after.badges, before.badges);
    });

    it('a statement naming the review tables that the fake does not know throws (the fake is exact)', async () => {
        await assert.rejects(pool.query('SELECT * FROM review_log WHERE user_id = $1', [ALICE]), /unexpected statement/);
        assert.match('select 1 from review_cards', PHASE6_TABLES);
    });
});

describe('failures', () => {
    it('no database: db_connection; a missing table (migration 020 not applied): table_not_found; never the driver\'s text', async () => {
        setPoolForTests(null);
        assert.equal((await queue()).error_type, 'db_connection');
        assert.equal((await grade()).error_type, 'db_connection');
        use();
        pool.fail({ code: '42P01', message: 'relation "review_cards" does not exist (db.internal)', when: (text) => text === SQL.enterReviewCards });
        const { result } = await quiet(() => queue());
        assert.equal(result.error_type, 'table_not_found');
        assert.doesNotMatch(JSON.stringify(result), /review_cards|db\.internal/);
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 })] });
        pool.fail({ code: '23514', message: 'violates check constraint (db.internal)', when: (text) => text === SQL.insertReviewLog });
        const failed = await quiet(() => grade());
        assert.equal(failed.result.error_type, 'unknown');
        assert.equal(byId(pool.reviewRows(ALICE))['card-frontend'].reps, 0, 'the UPDATE rolled back with the failed log row');
    });

    it('a duplicate log row (only by hand) is a defensive not_due, rolled back', async () => {
        use({
            reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 })],
            reviewLog: [{ user_id: ALICE, course_slug: VIBE, lesson_id: CH1, card_id: 'card-frontend', review_day: today(), rating: 3, interval_days: 2, stability: 2.3, difficulty: 2.1, source: 'web' }],
        });
        const result = await grade();
        assert.deepEqual([result.error_type, result.reviewedToday, result.learnerId], ['not_due', true, ALICE]);
        assert.equal(byId(pool.reviewRows(ALICE))['card-frontend'].reps, 0);
        assert.equal(pool.progressStatements().at(-1), 'rollback');
    });

    it('enterReviewCards inside a caller\'s transaction returns how many entered', async () => {
        await save(VIBE, CH1, finished());
        const client = await pool.connect();
        await client.query('BEGIN');
        assert.equal(await enterReviewCards(client, ALICE, reviewCatalog()), 5);
        assert.equal(await enterReviewCards(client, ALICE, reviewCatalog()), 0);
        await client.query('COMMIT');
    });
});

describe('the statement order of a review read: the learner lock before the entry', () => {
    it('begin, learner lock, entry, today, rows, commit', async () => {
        await save(VIBE, CH1, finished());
        pool.queries.length = 0;
        await queue();
        assert.deepEqual(pool.progressStatements().filter((s) => s !== SQL.selectToday), ['begin', SQL.advisoryLock, SQL.enterReviewCards, SQL.reviewRows, 'commit']);
        assert.deepEqual(pool.queries.map((q) => q.sql).filter((s) => s !== 'begin' && s !== 'commit'), [SQL.advisoryLock, SQL.enterReviewCards, SQL.selectToday, SQL.reviewRows]);
    });
});

// LEARNER_LOCK_SQL hashes 'lesson_progress:' || $1 as given: a reset that took the key of another
// spelling would not wait for an entry, which could then put the restarted lesson's cards back (R4).
describe('one learner lock per learner: every writer under it takes the canonical (lower-case) id', () => {
    const lockParams = () => pool.queries.filter((q) => q.sql === SQL.advisoryLock).map((q) => q.params);

    it('a review read with an upper-case id: lock, entry and learnerId are the lower-case id', async () => {
        await save(VIBE, CH1, finished());
        pool.queries.length = 0;
        const q = await queue(ALICE.toUpperCase());
        assert.equal(q.error_type, undefined, JSON.stringify(q));
        assert.equal(q.learnerId, ALICE);
        assert.deepEqual(lockParams(), [[ALICE]], 'the lock key is the canonical id');
        assert.equal(pool.queries.find((x) => x.sql === SQL.enterReviewCards).params[0], ALICE, 'the entry\'s $1');
        assert.equal(pool.queries.find((x) => x.sql === SQL.reviewRows).params[0], ALICE, 'the rows\' $1');
        assert.equal(pool.reviewRows(ALICE).length, 5);
    });

    it('a save, a one-lesson reset and delete-all with an upper-case id take the same key as the entry (and the reset deletes what it entered)', async () => {
        const UPPER = ALICE.toUpperCase();
        pool.queries.length = 0;
        assert.equal((await save(VIBE, CH1, finished(), UPPER)).records[0].state, 'read');
        await queue(ALICE);
        assert.equal(pool.reviewRows(ALICE).length, 5);
        const reset = await resetLessonProgress({ userId: UPPER, epoch: null, courseSlug: VIBE, lessonId: CH1 });
        assert.equal(reset.error_type, undefined, JSON.stringify(reset));
        assert.deepEqual(pool.reviewRows(ALICE), [], 'the reset deleted the lesson\'s cards');
        await save(CC, CC4, record({ checks: { 'card:summary-cards/card-checks': true } }), UPPER);
        await queue(UPPER);
        assert.equal(pool.reviewRows(ALICE).length, 1);
        const deleted = await deleteAllLessonProgress({ userId: UPPER });
        assert.equal(deleted.error_type, undefined, JSON.stringify(deleted));
        assert.deepEqual(pool.reviewRows(ALICE), []);
        assert.deepEqual(lockParams(), Array(6).fill([ALICE]), 'save, read, reset, save, read, delete-all: one key');
    });
});

describe('noteReviewDay (a web review\'s learning day, after the answer)', () => {
    it('today (Japan time, database clock) in its own transaction; never XP', async () => {
        setNow('2026-10-25T15:30:00.000Z');
        assert.equal(await noteReviewDay({ userId: ALICE.toUpperCase() }), true);
        assert.deepEqual(pool.progressStatements(), ['begin', SQL.learningDay, 'commit']);
        assert.equal(norm(LEARNING_DAY_SQL), SQL.learningDay);
        assert.deepEqual(pool.daysOf(ALICE), ['2026-10-26']);
        assert.deepEqual(pool.awardsOf(ALICE), []);
    });

    it('not a learner: false with no SQL; a failure (a deleted account, 23503) only logs and returns false', async () => {
        assert.equal(await noteReviewDay({ userId: 'nope' }), false);
        assert.equal(pool.queries.length, 0);
        pool.fail({ code: '23503', message: 'violates foreign key constraint (db.internal)', when: (text) => text === SQL.learningDay });
        const { result, lines } = await quiet(() => noteReviewDay({ userId: ALICE }));
        assert.equal(result, false);
        assert.ok(lines.some((l) => l.includes('note after review')));
        assert.deepEqual(pool.daysOf(ALICE), []);
    });
});
