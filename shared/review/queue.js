// @ts-check
/**
 * The review queue's pure rules (Phase 6, doc/brushup-2026/ai-access-plan.ja.md §10): the lesson as a
 * card's first rating, the daily cap and the order of today's cards. The server
 * (tools/core/reviewQueue.js) feeds them whole Japan-time days computed in SQL; the browser uses
 * reviewMinutes for 「約 N 分」. Pure: imports only ./fsrs.js, no Date, no Math.random.
 *
 * - R2: at most REVIEW_DAILY_LIMIT graded cards per learner per Japan-time day (about 3 minutes).
 *   When more are due, the most at risk of being forgotten come first (lowest retrievability) and
 *   the rest carry over to the next day.
 * - The lesson counts as the card's first FSRS rating (LESSON_PRIORS): Good, or Again when the
 *   learner's latest in-lesson mark on the card is 「もう一度」, dated the day the lesson record last
 *   changed. So one model both orders and schedules every card: riskOf is the R the next review uses.
 */
import { AGAIN, GOOD, scheduler } from './fsrs.js';

/** R2: graded cards per learner per Japan-time day. */
export const REVIEW_DAILY_LIMIT = 10;
/** 10 cards ≈ 3 minutes (R2). */
export const SECONDS_PER_CARD = 18;

/** @typedef {import('./fsrs.js').ReviewResult} ReviewResult */

/**
 * The lesson as a card's first rating: { stability, difficulty, intervalDays } for each in-lesson
 * button (「覚えた」 or no mark → good, 「もう一度」 → again). Good: S 2.3065, D 2.1181, due + 2 days;
 * Again: S 0.212, D 6.4133, due + 1 day.
 * @type {Readonly<{ good: Readonly<ReviewResult>, again: Readonly<ReviewResult> }>}
 */
export const LESSON_PRIORS = Object.freeze({
  good: Object.freeze(scheduler.review(null, GOOD, 0)),
  again: Object.freeze(scheduler.review(null, AGAIN, 0)),
});

/**
 * Minutes for n cards: 0 for none, else max(1, round(n·18/60)) (10 → 3, 7 → 2, 1 → 1).
 * @param {number} n
 */
export function reviewMinutes(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.round((n * SECONDS_PER_CARD) / 60));
}

/**
 * Ordering key: the card's retrievability today, R(daysSince, stability), the R its next review
 * uses. Lower = closer to forgetting. +Infinity for a card with no memory (added to a lesson after
 * the learner's last learning in it: never studied, so not at risk of forgetting) and for values
 * that are not a memory.
 * @param {{ stability: number | null | undefined, daysSince: number | null | undefined }} card
 * @returns {number}
 */
export function riskOf({ stability, daysSince }) {
  if (typeof stability !== 'number' || !(stability > 0) || typeof daysSince !== 'number' || !Number.isFinite(daysSince)) {
    return Infinity;
  }
  const r = scheduler.retrievability(Math.max(0, daysSince), stability);
  return Number.isFinite(r) ? r : Infinity;
}

/**
 * @typedef {object} QueueRow
 * @property {boolean} due due today or earlier (Japan time)
 * @property {boolean} reviewedToday graded today already
 * @property {number | null} stability null: no memory yet
 * @property {number | null} daysSince whole days since the last rating (the lesson or a review)
 * @property {string} dueOn 'YYYY-MM-DD'
 * @property {number} order catalog order
 */

/**
 * Today's list: the due cards not graded today, most at risk first (riskOf ascending, then the
 * earlier due day, then catalog order), at most max(0, limit − doneToday) of them.
 * @template {QueueRow} T
 * @param {readonly T[]} rows the learner's visible cards
 * @param {{ doneToday: number, limit?: number }} options doneToday counts every card graded today
 * @returns {{ picked: T[], dueTotal: number, remainingToday: number, carriedOver: number }}
 *   dueTotal: due cards not graded today; remainingToday = picked.length; carriedOver = dueTotal − remainingToday
 */
export function pickToday(rows, { doneToday, limit = REVIEW_DAILY_LIMIT }) {
  const done = Number.isFinite(doneToday) && doneToday > 0 ? Math.floor(doneToday) : 0;
  const room = Math.max(0, Math.floor(limit) - done);
  const due = rows
    .filter((row) => row.due && !row.reviewedToday)
    .map((row) => ({ row, risk: riskOf(row) }));
  due.sort((a, b) => compare(a.risk, b.risk) || compare(a.row.dueOn, b.row.dueOn) || compare(a.row.order, b.row.order));
  const picked = due.slice(0, room).map((entry) => entry.row);
  return { picked, dueTotal: due.length, remainingToday: picked.length, carriedOver: due.length - picked.length };
}

/**
 * Total order for numbers (Infinity included) and strings.
 * @template {number | string} V
 * @param {V} a
 * @param {V} b
 */
function compare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
