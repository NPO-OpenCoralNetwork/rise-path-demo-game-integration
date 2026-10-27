// @ts-check
/**
 * Shared Business Logic — the review queue (Phase 6, doc/brushup-2026/ai-access-plan.ja.md §10):
 * a lesson's flashcards come back when the learner is about to forget them. Tables review_cards and
 * review_log, and the trigger column lesson_progress.progress_changed_at
 * (server/migrations/020_review_queue.sql). The scheduler is FSRS-6 (shared/review/fsrs.js); the
 * daily cap, the order and the lesson as a card's first rating are shared/review/queue.js.
 *
 * - reviewCatalog: the review cards of the published lessons (tools/core/courseCatalog.js, never
 *   drafts), keyed 'course/lesson/card', in catalog order. Card text is read from here, never
 *   stored: a text edit keeps the memory; a card removed from its lesson, or a lesson no longer
 *   published, is hidden (its row stays, and comes back with its memory when the card does).
 * - enterReviewCards (R1): every current card of a lesson whose server record is finished (read,
 *   checked or mastered: the XP "done" rule, shared/lesson/progress.js LESSON_DONE_STATES), and
 *   every card the record holds the learner's mark on ('card:<block>/<card>' in progress.checks,
 *   either button), enters once. Never from a client's or an AI app's claim: only the server's own
 *   lesson_progress rows. The lesson counts as the card's first rating (LESSON_PRIORS), dated the
 *   row's progress_changed_at: Good, or Again when the latest mark is 「もう一度」; due that Japan-time
 *   day plus FSRS's interval (2 or 1 days). Until the card's first review, a change of its latest
 *   mark gives it that first rating again, dated the change. A card the author added to the lesson
 *   after the learner learned it (the entry already saw the learner's current record of the lesson,
 *   or a card of it entered without a mark, so with the finished lesson) enters with no memory, due
 *   the day after it entered, unless the learner marks it. It runs under the learner's
 *   lesson-progress lock (LEARNER_LOCK_SQL, the lock the one-lesson reset and delete-all take first),
 *   so it never re-inserts the cards of a reset that committed meanwhile.
 * - getReviewQueue (GET /api/v2/user/review): one transaction: the lock, the entry, today, the
 *   learner's rows; then today's list (R2: at most REVIEW_DAILY_LIMIT graded cards per Japan-time
 *   day, the most at risk of being forgotten first, the rest carried over).
 * - gradeReviewCard (R3: 'again' = 「もう一度」, 'good' = 「覚えた」): one card due today and not
 *   reviewed today, under the same lock; the card row is locked, the new memory computed (FSRS-6,
 *   deterministic fuzz), written with an UPDATE that repeats the due and once-a-day rules, and one
 *   review_log row appended (source 'web' or 'mcp'). reveal: true (the MCP tool's "show the answer")
 *   answers the card's back after the same checks and records nothing.
 * - reviewDueForAgent, reviewGradeForAgent (the remote MCP tools course-review-due and
 *   course-review-grade, learner-remote only): the same queue and grade for an AI app the learner
 *   allowed, in snake case, each card's text resolved to one locale. The due list has fronts only
 *   (no back, no memory, no learning day, no history) and REVIEW_PROTOCOL; a back is returned only
 *   by a reveal or a recorded rating of a card due today. source 'mcp'; no learning day (Phase 5
 *   R8), no XP.
 *
 * Clock: PostgreSQL decides every day and time (now() in Japan time, the learning_days boundary;
 * clock_timestamp() for entered_at and, in migration 020's trigger, progress_changed_at). JavaScript gets whole days and booleans and computes only
 * FSRS. No XP, no badge: no statement here names xp_awards; the learning day of a web review is
 * tools/core/achievements.js noteReviewDay, after the answer (MCP reviews write none).
 *
 * Lock order: LEARNER_LOCK_SQL, then review_cards rows (the grade's FOR UPDATE), then review_log.
 * The one-lesson reset and delete-all (tools/core/lessonProgress.js) delete the rows last, under
 * the same learner lock; account deletion cascades (the log's only foreign key is its card row).
 *
 * Failures return { error, error_type } (tools/core/dbErrors.js), never the driver's text. A missing
 * column (42703, e.g. lesson_progress.progress_changed_at before migration 020) is table_not_found,
 * like a missing table (reviewTransaction).
 */
import { canonicalUserId } from './accountDeletions.js';
import { STREAK_TIME_ZONE, TODAY_SQL } from './achievements.js';
import { getPublishedLesson, isSafeSlug, listPublishedLessons } from './courseCatalog.js';
import { inTransaction } from './dbTransaction.js';
import { LEARNER_LOCK_SQL } from './lessonProgress.js';
import { learnerLocale } from '../../shared/lesson/learnerView.js';
import { resolveText } from '../../shared/lesson/text.js';
import { lessonReviewCards } from '../../shared/review/cards.js';
import { GRADE_OF, scheduler, seededUnit } from '../../shared/review/fsrs.js';
import { LESSON_PRIORS, REVIEW_DAILY_LIMIT, pickToday } from '../../shared/review/queue.js';

/**
 * @typedef {import('./courseCatalog.js').PublishedLesson} PublishedLesson
 * @typedef {import('./dbTransaction.js').CoreError} CoreError
 * @typedef {import('./dbTransaction.js').Queryable} Queryable
 * @typedef {import('../../shared/lesson/text.js').LText} LText
 * @typedef {import('../../shared/lesson/text.js').Locale} Locale
 *
 * @typedef {object} CatalogCard a review card of a published lesson
 * @property {string} courseSlug
 * @property {string} lessonId
 * @property {string} blockId the flashcards block (not part of the key)
 * @property {string} cardId
 * @property {string} checkKey the in-lesson mark's key, 'card:<blockId>/<cardId>'
 * @property {LText} front the card text as written in the lesson (string or { jp?, en? })
 * @property {LText} back
 * @property {LText} lessonTitle
 * @property {Locale} lessonLocale
 * @property {number} order position in the whole catalog, from 0 (the last tie-break of today's list)
 *
 * @typedef {Map<string, CatalogCard>} ReviewCatalog 'course/lesson/card' → card, in catalog order
 *
 * @typedef {object} ReviewRow a row of REVIEW_ROWS_SQL (snake case, as the database names it)
 * @property {string} course_slug
 * @property {string} lesson_id
 * @property {string} card_id
 * @property {number | null} stability null: no memory yet
 * @property {number | null} difficulty
 * @property {number} reps
 * @property {string} due_on 'YYYY-MM-DD'
 * @property {number | null} days_since whole Japan-time days since the last rating (the lesson or a review)
 * @property {boolean} due
 * @property {boolean} reviewed_today
 *
 * @typedef {object} ReviewSummary today's counts (Japan time, database clock)
 * @property {string} today 'YYYY-MM-DD'
 * @property {number} dailyLimit
 * @property {number} doneToday cards graded today, hidden ones included
 * @property {number} remainingToday cards still to grade today (the list's length)
 * @property {number} dueTotal due cards not graded today
 * @property {number} carriedOver due cards beyond today's cap
 * @property {number} inQueue visible cards in the learner's queue
 * @property {string | null} nextDueOn the earliest due day of a visible card not due today
 *
 * @typedef {object} QueueCard
 * @property {string} courseSlug
 * @property {string} lessonId
 * @property {string} cardId
 * @property {LText} lessonTitle
 * @property {Locale} lessonLocale
 * @property {LText} front
 * @property {LText} back
 * @property {string} dueOn
 *
 * @typedef {Omit<ReviewSummary, 'today'> & { learnerId: string, today: string, timeZone: string, cards: QueueCard[] }} ReviewQueue
 */

/** Where a review was recorded: the web page, or an AI app (MCP). */
export const REVIEW_SOURCES = Object.freeze(['web', 'mcp']);

/** A card id the queue can hold: migration 020's card_id CHECK (the lesson schema's ID_PATTERN, at most 80 characters). */
export const CARD_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/** The queue's day boundary: Japan time, as learning_days and the streak. */
export const REVIEW_TIME_ZONE = STREAK_TIME_ZONE;

/**
 * R1: every current card of a finished lesson, and every marked card, enters once. The lesson counts
 * as the first rating, dated the row's progress_changed_at (rows from before migration 020: their
 * updated_at). `studied` (the lesson is the card's first rating): the learner marked the card, or no
 * row of the lesson shows that the card came after the learning, which a row shows when
 * - its checked_at already holds the record's change time: the entry saw this record before (a read
 *   after each change), so a card first seen now was added to the lesson since; or
 * - it is a card the learner did not mark (or one no longer in the lesson): it entered with the
 *   finished lesson, so a card not there then was added since.
 * A card not studied enters with no memory, due tomorrow (its first rating is a review). Until a
 * card's first review (reps 0), a studied card whose latest mark changed gets its first rating
 * again, dated that change (ON CONFLICT … DO UPDATE). prior_rating there comes from the new
 * stability: reading EXCLUDED.prior_rating needs SELECT on it, which the remote MCP role never has.
 * An unchanged card is left alone (the WHERE), and a card not studied never loses its memory.
 * Inserted rows get checked_at; the others get it from MARK_REVIEW_CARDS_CHECKED_SQL right after.
 * $2..$5 the catalog arrays (course, lesson, check key, card id); $6..$8 LESSON_PRIORS.good
 * (stability, difficulty, intervalDays); $9..$11 LESSON_PRIORS.again. The state list is
 * LESSON_DONE_STATES.
 */
export const ENTER_REVIEW_CARDS_SQL = `WITH candidates AS (
  SELECT p.user_id, c.course_slug, c.lesson_id, c.card_id,
         COALESCE(p.progress_changed_at, p.updated_at) AS learned_at,
         CASE WHEN (p.progress -> 'checks' -> c.check_key) = 'false'::jsonb THEN 1 ELSE 3 END AS prior,
         COALESCE((p.progress -> 'checks') ? c.check_key, false)
         OR NOT EXISTS (SELECT 1 FROM review_cards x
                         WHERE x.user_id = p.user_id AND x.course_slug = p.course_slug AND x.lesson_id = p.lesson_id
                           AND (x.checked_at >= COALESCE(p.progress_changed_at, p.updated_at)
                                OR NOT EXISTS (SELECT 1 FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS s (course_slug, lesson_id, check_key, card_id)
                                                WHERE s.course_slug = x.course_slug AND s.lesson_id = x.lesson_id AND s.card_id = x.card_id
                                                  AND (p.progress -> 'checks') ? s.check_key))) AS studied
    FROM lesson_progress p
    JOIN unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS c (course_slug, lesson_id, check_key, card_id)
      ON c.course_slug = p.course_slug AND c.lesson_id = p.lesson_id
   WHERE p.user_id = $1
     AND (p.state IN ('read', 'checked', 'mastered') OR (p.progress -> 'checks') ? c.check_key)
)
INSERT INTO review_cards (user_id, course_slug, lesson_id, card_id, checked_at, learned_at, prior_rating, stability, difficulty, due_day)
SELECT user_id, course_slug, lesson_id, card_id, learned_at,
       CASE WHEN studied THEN learned_at END,
       CASE WHEN studied THEN prior END,
       CASE WHEN NOT studied THEN NULL WHEN prior = 1 THEN $9::float8 ELSE $6::float8 END,
       CASE WHEN NOT studied THEN NULL WHEN prior = 1 THEN $10::float8 ELSE $7::float8 END,
       CASE WHEN NOT studied THEN (now() AT TIME ZONE 'Asia/Tokyo')::date + 1
            ELSE (learned_at AT TIME ZONE 'Asia/Tokyo')::date + CASE WHEN prior = 1 THEN $11::int ELSE $8::int END END
  FROM candidates
 ORDER BY course_slug, lesson_id, card_id
ON CONFLICT (user_id, course_slug, lesson_id, card_id) DO UPDATE
   SET learned_at = EXCLUDED.learned_at,
       prior_rating = CASE WHEN EXCLUDED.stability = $9::float8 THEN 1 ELSE 3 END,
       stability = EXCLUDED.stability, difficulty = EXCLUDED.difficulty, due_day = EXCLUDED.due_day
 WHERE review_cards.reps = 0
   AND EXCLUDED.learned_at IS NOT NULL
   AND EXCLUDED.stability IS DISTINCT FROM review_cards.stability`;

/**
 * Right after the entry, in its transaction: each of the learner's rows records the change time of
 * its lesson's record that the entry has now seen (checked_at), so a card the author adds to the
 * lesson later is not taken for one the learner studied at that change. It only moves forward, and
 * leaves the rows of an unchanged record alone.
 */
export const MARK_REVIEW_CARDS_CHECKED_SQL = `UPDATE review_cards r
   SET checked_at = COALESCE(p.progress_changed_at, p.updated_at)
  FROM lesson_progress p
 WHERE r.user_id = $1 AND p.user_id = r.user_id AND p.course_slug = r.course_slug AND p.lesson_id = r.lesson_id
   AND (r.checked_at IS NULL OR r.checked_at < COALESCE(p.progress_changed_at, p.updated_at))`;

/** Every card of the learner with the day facts the queue needs (Japan time, database clock). */
export const REVIEW_ROWS_SQL = `SELECT course_slug, lesson_id, card_id, stability, difficulty, reps,
       to_char(due_day, 'YYYY-MM-DD') AS due_on,
       (now() AT TIME ZONE 'Asia/Tokyo')::date
         - COALESCE(last_review_day, (learned_at AT TIME ZONE 'Asia/Tokyo')::date) AS days_since,
       due_day <= (now() AT TIME ZONE 'Asia/Tokyo')::date AS due,
       last_review_day IS NOT DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date AS reviewed_today
  FROM review_cards
 WHERE user_id = $1
 ORDER BY course_slug, lesson_id, card_id`;

/** The card to grade or reveal, locked. */
export const LOCK_REVIEW_CARD_SQL = `SELECT stability, difficulty, reps, lapses,
       to_char(due_day, 'YYYY-MM-DD') AS due_on,
       (now() AT TIME ZONE 'Asia/Tokyo')::date
         - COALESCE(last_review_day, (learned_at AT TIME ZONE 'Asia/Tokyo')::date) AS days_since,
       due_day <= (now() AT TIME ZONE 'Asia/Tokyo')::date AS due,
       last_review_day IS NOT DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date AS reviewed_today
  FROM review_cards
 WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3 AND card_id = $4
   FOR UPDATE`;

/** Cards the learner graded today (every row, hidden ones too: the cap counts what was done). */
export const DONE_TODAY_SQL = "SELECT count(*)::int AS done FROM review_cards WHERE user_id = $1 AND last_review_day = (now() AT TIME ZONE 'Asia/Tokyo')::date";

/** The review. The WHERE repeats the due and once-a-day rules: a code path that skipped them still cannot grade. */
export const GRADE_REVIEW_CARD_SQL = `UPDATE review_cards
   SET stability = $5, difficulty = $6, reps = reps + 1, lapses = lapses + $7::int, last_rating = $8,
       last_review_day = (now() AT TIME ZONE 'Asia/Tokyo')::date,
       due_day = (now() AT TIME ZONE 'Asia/Tokyo')::date + $9::int
 WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3 AND card_id = $4
   AND due_day <= (now() AT TIME ZONE 'Asia/Tokyo')::date
   AND last_review_day IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date
RETURNING to_char(due_day, 'YYYY-MM-DD') AS due_on`;

/** One review appended (review_day and reviewed_at are the database's: column defaults). */
export const INSERT_REVIEW_LOG_SQL = `INSERT INTO review_log (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

/** @param {string} message @returns {CoreError} */
const invalid = (message) => ({ error: message, error_type: 'validation' });

/**
 * inTransaction for the review statements. Before migration 020 the entry fails with 42703
 * (undefined_column: lesson_progress.progress_changed_at), not 42P01: PostgreSQL resolves the CTE's
 * columns before it finds review_cards missing. A missing review column means what a missing review
 * table means (020 not applied): table_not_found, so the route answers 503 and the MCP tools
 * review_unavailable, as for 42P01. The driver's text stays in the server log.
 * @param {string} operation
 * @param {(db: Queryable) => Promise<{ commit: boolean, value: any }>} work
 * @returns {Promise<any>}
 */
const reviewTransaction = (operation, work) => inTransaction(operation, async (db) => {
    try {
        return await work(db);
    } catch (error) {
        const err = /** @type {any} */ (error);
        if (err?.code !== '42703') throw error;
        console.error(`[db] ${operation}: 42703 a column is missing (migration 020 not applied? run db:migrate):`, err?.message || err);
        return { commit: false, value: { error: `Review tables or columns are missing during ${operation}. Run db:migrate.`, error_type: 'table_not_found' } };
    }
});

/**
 * The queue key of a card.
 * @param {string} courseSlug @param {string} lessonId @param {string} cardId
 */
export const reviewKey = (courseSlug, lessonId, cardId) => `${courseSlug}/${lessonId}/${cardId}`;

/** @type {WeakMap<PublishedLesson, Omit<CatalogCard, 'order'>[]>} the cards of each catalog lesson object */
const lessonCards = new WeakMap();

/**
 * The review cards of one published lesson, computed once per catalog object (a rebuilt catalog,
 * clearCatalogCacheForTests, gives new objects). A card whose id the database would refuse (not
 * CARD_ID: the lesson schema allows longer ids) is left out and logged once, so it can never make
 * the entry statement fail for every learner who finished the lesson. The repeated-id check is
 * defensive only: validateLesson refuses a lesson that repeats any id (one namespace per lesson), so
 * the catalog never holds one (server/tests/reviewQueueCore.test.js pins that).
 * @param {PublishedLesson} entry
 */
function cardsOf(entry) {
    const cached = lessonCards.get(entry);
    if (cached) return cached;
    /** @type {Omit<CatalogCard, 'order'>[]} */
    const cards = [];
    /** @type {Set<string>} */
    const ids = new Set();
    for (const card of lessonReviewCards(entry.lesson)) {
        if (!CARD_ID.test(card.cardId) || ids.has(card.cardId)) {
            console.warn(`[reviewQueue] left out: ${entry.courseSlug}/${entry.lesson.id} card ${JSON.stringify(String(card.cardId).slice(0, 100))} (a review card id is lowercase letters, digits, ".", "_" or "-", at most 80 characters, once per lesson)`);
            continue;
        }
        ids.add(card.cardId);
        cards.push(Object.freeze({
            courseSlug: entry.courseSlug,
            lessonId: entry.lesson.id,
            blockId: card.blockId,
            cardId: card.cardId,
            checkKey: card.checkKey,
            front: card.front,
            back: card.back,
            lessonTitle: entry.lesson.title,
            lessonLocale: entry.lesson.locale,
        }));
    }
    lessonCards.set(entry, cards);
    return cards;
}

/**
 * Every review card of the published lessons, keyed 'course/lesson/card', in catalog order (courses
 * by folder, lessons in module order, cards in lesson order).
 * @returns {ReviewCatalog}
 */
export function reviewCatalog() {
    /** @type {ReviewCatalog} */
    const catalog = new Map();
    for (const entry of listPublishedLessons()) {
        for (const card of cardsOf(entry)) {
            catalog.set(reviewKey(card.courseSlug, card.lessonId, card.cardId), Object.freeze({ ...card, order: catalog.size }));
        }
    }
    return catalog;
}

/**
 * R1, inside the caller's transaction and after LEARNER_LOCK_SQL: enters the cards the learner's
 * lesson_progress rows imply (ENTER_REVIEW_CARDS_SQL), then marks what it saw
 * (MARK_REVIEW_CARDS_CHECKED_SQL). Idempotent. Throws on a database error.
 * @param {Queryable} db
 * @param {string} userId canonical
 * @param {ReviewCatalog} catalog
 * @returns {Promise<number>} the number of cards that entered or got their first rating again
 */
export async function enterReviewCards(db, userId, catalog) {
    const cards = [...catalog.values()];
    const { good, again } = LESSON_PRIORS;
    const { rowCount } = await db.query(ENTER_REVIEW_CARDS_SQL, [
        userId,
        cards.map((card) => card.courseSlug),
        cards.map((card) => card.lessonId),
        cards.map((card) => card.checkKey),
        cards.map((card) => card.cardId),
        good.stability, good.difficulty, good.intervalDays,
        again.stability, again.difficulty, again.intervalDays,
    ]);
    await db.query(MARK_REVIEW_CARDS_CHECKED_SQL, [userId]);
    return rowCount ?? 0;
}

/**
 * Today's counts and list from the learner's rows (pure). Visible = the card is in the catalog.
 * doneToday counts every row graded today, hidden ones too (a card reviewed before it was hidden
 * still used a slot).
 * @param {readonly ReviewRow[]} rows
 * @param {ReviewCatalog} catalog
 * @returns {Omit<ReviewSummary, 'today'> & { picked: { card: CatalogCard, dueOn: string }[] }}
 */
export function summaryOf(rows, catalog) {
    let doneToday = 0;
    /** @type {{ card: CatalogCard, due: boolean, reviewedToday: boolean, stability: number | null, daysSince: number | null, dueOn: string, order: number }[]} */
    const visible = [];
    for (const row of rows) {
        const reviewedToday = row.reviewed_today === true;
        if (reviewedToday) doneToday += 1;
        const card = catalog.get(reviewKey(row.course_slug, row.lesson_id, row.card_id));
        if (!card) continue;
        visible.push({
            card,
            due: row.due === true,
            reviewedToday,
            stability: row.stability === null || row.stability === undefined ? null : Number(row.stability),
            daysSince: row.days_since === null || row.days_since === undefined ? null : Number(row.days_since),
            dueOn: String(row.due_on),
            order: card.order,
        });
    }
    const { picked, dueTotal, remainingToday, carriedOver } = pickToday(visible, { doneToday });
    /** @type {string | null} */
    let nextDueOn = null;
    for (const item of visible) {
        if (!item.due && (nextDueOn === null || item.dueOn < nextDueOn)) nextDueOn = item.dueOn;
    }
    return {
        dailyLimit: REVIEW_DAILY_LIMIT,
        doneToday,
        remainingToday,
        dueTotal,
        carriedOver,
        inQueue: visible.length,
        nextDueOn,
        picked: picked.map(({ card, dueOn }) => ({ card, dueOn })),
    };
}

/**
 * Today and the counts, read inside the caller's transaction (TODAY_SQL, REVIEW_ROWS_SQL).
 * @param {Queryable} db @param {string} userId @param {ReviewCatalog} catalog
 * @returns {Promise<ReviewSummary>}
 */
async function readSummary(db, userId, catalog) {
    const today = String((await db.query(TODAY_SQL)).rows[0]?.today ?? '');
    const { rows } = await db.query(REVIEW_ROWS_SQL, [userId]);
    const { picked, ...counts } = summaryOf(rows, catalog);
    return { today, ...counts };
}

/**
 * The learner's review queue for today (GET /api/v2/user/review). One transaction: the learner's
 * lesson-progress lock, the entry (R1), today, the rows; it commits the entry. The cards carry
 * their text as written in the lesson (the caller resolves the locale).
 * @param {{ userId: unknown }} params
 * @returns {Promise<ReviewQueue | CoreError>}
 */
export async function getReviewQueue({ userId: rawUserId }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return invalid('A signed-in learner is required.');
    const catalog = reviewCatalog();
    /** @type {{ today: string, rows: ReviewRow[] } | CoreError} */
    const read = await reviewTransaction('getReviewQueue', async (db) => {
        await db.query(LEARNER_LOCK_SQL, [userId]);
        await enterReviewCards(db, userId, catalog);
        const today = String((await db.query(TODAY_SQL)).rows[0]?.today ?? '');
        const { rows } = await db.query(REVIEW_ROWS_SQL, [userId]);
        return { commit: true, value: { today, rows } };
    });
    if ('error_type' in read) return read;
    const { picked, ...counts } = summaryOf(read.rows, catalog);
    return {
        learnerId: userId,
        today: read.today,
        timeZone: REVIEW_TIME_ZONE,
        ...counts,
        cards: picked.map(({ card, dueOn }) => ({
            courseSlug: card.courseSlug,
            lessonId: card.lessonId,
            cardId: card.cardId,
            lessonTitle: card.lessonTitle,
            lessonLocale: card.lessonLocale,
            front: card.front,
            back: card.back,
            dueOn,
        })),
    };
}

/**
 * Grades one card of the learner's queue (R3), or with reveal: true answers its back and records
 * nothing (the MCP tool shows the answer before the learner chooses). Refusals, each rolled back:
 * validation (before any SQL), not_found (not a current card of a published lesson, before any
 * SQL), not_in_queue (the learner's queue does not hold it: never entered, started over, deleted),
 * not_due (reviewedToday true: graded today already; false: due later; dueOn the card's due day),
 * review_limit (REVIEW_DAILY_LIMIT cards graded today). The refusals after the lock carry learnerId
 * and the summary, except the defensive not_due of a duplicate log row (no statement can run after
 * it). Unknown fields are ignored: the time comes from the database only.
 *
 * @param {{ userId: unknown, courseSlug: unknown, lessonId: unknown, cardId: unknown, rating?: unknown, reveal?: unknown, source: unknown }} params
 */
export async function gradeReviewCard({ userId: rawUserId, courseSlug, lessonId, cardId, rating, reveal, source }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return invalid('A signed-in learner is required.');
    if (!isSafeSlug(courseSlug) || !isSafeSlug(lessonId) || typeof cardId !== 'string' || !CARD_ID.test(cardId)) {
        return invalid('courseSlug, lessonId and cardId must name a review card.');
    }
    if (typeof source !== 'string' || !REVIEW_SOURCES.includes(source)) return invalid('Unknown review source.');
    if (reveal !== undefined && typeof reveal !== 'boolean') return invalid('reveal must be true or left out.');
    const revealOnly = reveal === true;
    const hasRating = rating === 'again' || rating === 'good';
    if ((rating !== undefined && rating !== null && !hasRating) || revealOnly === hasRating) {
        return invalid('Send rating ("again" or "good") or reveal: true, exactly one of them.');
    }
    const catalog = reviewCatalog();
    const card = catalog.get(reviewKey(courseSlug, lessonId, cardId));
    if (!card) return { error: 'This card is not in a published lesson.', error_type: 'not_found' };
    const text = { front: card.front, back: card.back, lessonTitle: card.lessonTitle, lessonLocale: card.lessonLocale };
    const key = [userId, courseSlug, lessonId, cardId];

    return reviewTransaction('gradeReviewCard', async (db) => {
        await db.query(LEARNER_LOCK_SQL, [userId]);
        /** @param {Record<string, unknown>} refusal */
        const refuse = async (refusal) => ({ commit: false, value: { ...refusal, learnerId: userId, summary: await readSummary(db, userId, catalog) } });
        const row = (await db.query(LOCK_REVIEW_CARD_SQL, key)).rows[0];
        if (!row) return refuse({ error: 'This card is not in the learner\'s reviews.', error_type: 'not_in_queue' });
        const dueOn = String(row.due_on);
        if (row.reviewed_today === true) {
            return refuse({ error: 'This card was already recorded today.', error_type: 'not_due', reviewedToday: true, dueOn });
        }
        if (row.due !== true) return refuse({ error: 'This card is not due today.', error_type: 'not_due', reviewedToday: false, dueOn });
        const done = Number((await db.query(DONE_TODAY_SQL, [userId])).rows[0]?.done ?? 0);
        if (done >= REVIEW_DAILY_LIMIT) {
            return refuse({
                error: `The learner has reviewed ${REVIEW_DAILY_LIMIT} cards today. The rest come back on later days.`,
                error_type: 'review_limit',
                doneToday: done,
                dailyLimit: REVIEW_DAILY_LIMIT,
            });
        }
        if (revealOnly) {
            return { commit: false, value: { learnerId: userId, revealed: { courseSlug, lessonId, cardId, dueOn }, ...text } };
        }
        const grade = GRADE_OF[/** @type {'again' | 'good'} */ (rating)];
        // A lesson prior or an earlier review; null for a card added to its lesson later (never studied).
        const memory = row.stability === null ? null : { stability: Number(row.stability), difficulty: Number(row.difficulty) };
        // At least 1 for a memory: a due card's due day is after the day of its last rating.
        const elapsed = memory ? Number(row.days_since) : 0;
        const next = scheduler.review(memory, grade, elapsed, { fuzzUnit: seededUnit(`${courseSlug}/${lessonId}/${cardId}#${Number(row.reps) + 1}`) });
        const lapse = memory && rating === 'again' ? 1 : 0;
        const updated = await db.query(GRADE_REVIEW_CARD_SQL, [...key, next.stability, next.difficulty, lapse, grade, next.intervalDays]);
        if (updated.rowCount !== 1) {
            return refuse({ error: 'This card was already recorded today.', error_type: 'not_due', reviewedToday: true, dueOn });
        }
        try {
            await db.query(INSERT_REVIEW_LOG_SQL, [...key, grade, memory ? elapsed : null, next.intervalDays, next.stability, next.difficulty, source]);
        } catch (error) {
            // A review of this card is already logged today (the UPDATE's guard makes this
            // unreachable unless rows were edited by hand). The transaction is aborted: no summary.
            if (/** @type {any} */ (error)?.code !== '23505') throw error;
            return { commit: false, value: { error: 'This card was already recorded today.', error_type: 'not_due', reviewedToday: true, dueOn, learnerId: userId } };
        }
        const summary = await readSummary(db, userId, catalog);
        return {
            commit: true,
            value: {
                learnerId: userId,
                graded: { courseSlug, lessonId, cardId, rating, dueOn: String(updated.rows[0]?.due_on ?? ''), intervalDays: next.intervalDays },
                summary,
                ...text,
            },
        };
    });
}

// ─── AI apps (the remote MCP tools course-review-due and course-review-grade) ──────────────────

/**
 * How an AI app runs a review: returned by course-review-due (the socratic-tutor prompt and the
 * tutor protocol are unchanged). The tools' descriptions say the same in short.
 */
export const REVIEW_PROTOCOL = [
    'You are running a short Rise Path review with the learner (lesson flashcards that come back when they are about to forget them).',
    '1. Show one card\'s front at a time, in the order given. Do not show or hint at the answer.',
    '2. Wait for the learner to answer from memory, in their own words. Never answer for them.',
    '3. Then call course-review-grade with reveal: true and show the answer.',
    '4. Ask which fits: "もう一度 / Again" (they did not remember it) or "覚えた / Got it" (they remembered it). Send only their choice as rating; never choose for them.',
    '5. Never record a card the learner did not try. Each result is permanent; a card can be recorded once a day, and a card that is not due is refused (not_due).',
    '6. Do not read card answers from course-lesson-get before the learner has answered.',
    '7. At most 10 cards a day. Stop when the list is done or the learner wants to stop; the rest come back on later days.',
    '8. Reply in the learner\'s language.',
].join('\n');

/** Core error types that mean the review tables cannot be reached here (no database, 020 not applied, the role SQL not re-run). */
const AGENT_UNAVAILABLE = new Set(['db_connection', 'table_not_found', 'permission_denied']);

/** The agent's answer to a database failure: fixed text, never the driver's. @param {CoreError} error @param {string} failed */
const agentFailure = (error, failed) => (AGENT_UNAVAILABLE.has(error.error_type)
    ? { error: 'Reviews are not available on this server right now. Please try again later.', error_type: 'review_unavailable' }
    : { error: failed, error_type: 'review_failed' });

/**
 * A card's text for an AI app in one locale: the requested one when the card's lesson has it
 * (learnerLocale, as course-lesson-get), else the lesson's source locale. A list can mix locales
 * (a lesson without an English translation stays Japanese), so each card says which one it is in.
 * @param {{ courseSlug: string, lessonId: string, lessonLocale: Locale }} card @param {unknown} locale
 */
function agentText({ courseSlug, lessonId, lessonLocale }, locale) {
    const entry = getPublishedLesson(courseSlug, lessonId);
    /** @type {Locale} */
    const used = entry ? learnerLocale(entry.lesson, locale) : lessonLocale;
    /** @param {LText} text */
    const text = (text) => resolveText(text, used, lessonLocale).value;
    return { used, text };
}

/**
 * course-review-due: today's cards for an AI app, the ones the learner is closest to forgetting
 * first (at most REVIEW_DAILY_LIMIT graded a day), question side only. Runs getReviewQueue, so it
 * also enters the cards the learner's lesson records imply (their learning day comes from the
 * records, not from this call). Never a back, the memory, the learning day or the history.
 * @param {{ userId: unknown, locale?: unknown }} params
 */
export async function reviewDueForAgent({ userId, locale }) {
    const queue = await getReviewQueue({ userId });
    if ('error_type' in queue) {
        return queue.error_type === 'validation' ? queue : agentFailure(queue, 'The review cards could not be read.');
    }
    return {
        today: queue.today,
        time_zone: queue.timeZone,
        daily_limit: queue.dailyLimit,
        done_today: queue.doneToday,
        remaining_today: queue.remainingToday,
        carried_over: queue.carriedOver,
        next_due_on: queue.nextDueOn,
        cards: queue.cards.map((item) => {
            const { used, text } = agentText(item, locale);
            return {
                course_slug: item.courseSlug,
                lesson_id: item.lessonId,
                lesson_title: text(item.lessonTitle),
                card_id: item.cardId,
                front: text(item.front),
                locale: used,
            };
        }),
        review_protocol: REVIEW_PROTOCOL,
    };
}

/**
 * course-review-grade: for one of today's cards, reveal: true answers the back and records
 * nothing; rating ('again' = 「もう一度」, 'good' = 「覚えた」, the learner's own choice) records one
 * review (source 'mcp': no learning day, no XP) and answers the back and the next review day.
 * Exactly one of them. Refusals: validation, not_found, not_in_queue, not_due (due_on and
 * reviewed_today only: never what was recorded today, nor the back), review_limit,
 * review_unavailable, review_failed.
 * @param {{ userId: unknown, courseSlug: unknown, lessonId: unknown, cardId: unknown, rating?: unknown, reveal?: unknown, locale?: unknown }} params
 */
export async function reviewGradeForAgent({ userId, courseSlug, lessonId, cardId, rating, reveal, locale }) {
    if (!canonicalUserId(userId)) return invalid('A signed-in learner is required.');
    const hasRating = rating !== undefined && rating !== null;
    if (hasRating === (reveal === true) || (hasRating && rating !== 'again' && rating !== 'good') || (reveal !== undefined && typeof reveal !== 'boolean')) {
        return invalid('Send rating ("again" or "good", the learner\'s own choice) or reveal: true, exactly one of them.');
    }
    const result = /** @type {Record<string, any>} */ (await gradeReviewCard({
        userId, courseSlug, lessonId, cardId, source: 'mcp', ...(hasRating ? { rating } : { reveal: true }),
    }));
    switch (result.error_type) {
        case undefined:
            break;
        case 'validation':
            return invalid('course_slug, lesson_id and card_id must name a card from course-review-due.');
        case 'not_found':
            return { error: 'This card is not in a published lesson.', error_type: 'not_found' };
        case 'not_in_queue':
            return { error: 'This card is not in the learner\'s reviews. course-review-due lists today\'s cards.', error_type: 'not_in_queue' };
        case 'not_due':
            return {
                error: result.reviewedToday === true
                    ? `This card was already recorded today (next review: ${result.dueOn}).`
                    : `This card is not due today (next review: ${result.dueOn}).`,
                error_type: 'not_due',
                due_on: result.dueOn,
                reviewed_today: result.reviewedToday === true,
            };
        case 'review_limit':
            return {
                error: `The learner has reviewed ${REVIEW_DAILY_LIMIT} cards today. The rest come back on later days.`,
                error_type: 'review_limit',
                done_today: result.doneToday,
                daily_limit: result.dailyLimit,
            };
        default:
            return agentFailure(/** @type {CoreError} */ (result), 'The review could not be recorded.');
    }
    const { used, text } = agentText({ courseSlug: String(courseSlug), lessonId: String(lessonId), lessonLocale: result.lessonLocale }, locale);
    const ids = { course_slug: courseSlug, lesson_id: lessonId, card_id: cardId };
    if (!hasRating) {
        return { ...ids, front: text(result.front), back: text(result.back), locale: used, recorded: false };
    }
    return {
        ...ids,
        rating,
        recorded: true,
        front: text(result.front),
        back: text(result.back),
        next_review_day: result.graded.dueOn,
        next_review_in_days: result.graded.intervalDays,
        done_today: result.summary.doneToday,
        remaining_today: result.summary.remainingToday,
        daily_limit: result.summary.dailyLimit,
        locale: used,
    };
}
