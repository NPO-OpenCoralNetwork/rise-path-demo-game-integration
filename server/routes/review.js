// @ts-check
/**
 * The learner's review queue (Phase 6, doc/brushup-2026/ai-access-plan.ja.md §10; owner decisions
 * R1-R4): a lesson's flashcards come back when the learner is about to forget them (FSRS-6,
 * shared/review/fsrs.js). Mounted by server.js at /api/v2/user/review behind its own 2 kb JSON
 * parser (REVIEW_BODY_LIMIT: 413 body_too_large, 400 invalid_body, before the 50 MB parser),
 * requireAuth, requireSignedIn (the dev fallback, the bridge user and an anonymous user get 401
 * sign_in_required: the queue is an account record, never shared by dev guests) and a per-learner
 * limit on reads and grades together (REVIEW_REQUESTS_PER_MINUTE, 429 rate_limited). An agent's own
 * OAuth token gets 401 oauth_client_token from requireAuth: AI apps use the MCP course-review-*
 * tools. The browser sends no time: PostgreSQL decides every day (Japan time, 00:00 JST).
 *
 * GET /       → 200 { ok, learnerId, today, timeZone: 'Asia/Tokyo', dailyLimit, doneToday,
 *                     remainingToday, dueTotal, carriedOver, inQueue, nextDueOn,
 *                     cards: [{ courseSlug, lessonId, cardId, lessonTitle, lessonLocale, front, back, dueOn }] }
 *               The read first enters the cards the learner's own lesson records imply (R1: a
 *               finished lesson's cards, a card marked in a lesson; never a client's claim), so
 *               it is a write transaction (the achievements precedent). cards: today's list (R2:
 *               at most dailyLimit graded cards a day, the most at risk of being forgotten first;
 *               cards.length === remainingToday; carriedOver due cards wait for later days). The
 *               card texts are as written in the lesson (a string or { jp, en }): the browser
 *               resolves them, so it can mark Japanese text with lang. learnerId lets the browser
 *               drop an answer that arrived after another learner signed in.
 * POST /grade  body { courseSlug, lessonId, cardId, rating: 'again' | 'good' } (R3: 'again' is
 *               「もう一度」, 'good' is 「覚えた」). Other fields are ignored (a time sent with it
 *               changes nothing; the web never reveals without grading).
 *          → 200 { ok, learnerId, graded: { courseSlug, lessonId, cardId, rating, dueOn, intervalDays },
 *                  summary: { today, dailyLimit, doneToday, remainingToday, dueTotal, carriedOver, inQueue, nextDueOn } }
 *               One card due today and not graded today: its new memory and next review day, and one
 *               review_log row (source 'web'). No XP, no badge (Phase 5 O1). After the answer only,
 *               the afterGrade hook runs with the grade's own day (summary.today, the Japan-time
 *               day the grade's transaction recorded; default tools/core/achievements.js
 *               noteReviewDay: that day as a learning day, so a grade that commits just before
 *               00:00 JST counts on its own day); it never changes the answer, and its failure is
 *               only logged.
 *
 * Refusals are { ok: false, error, error_type, … } with fixed English text, never the driver's:
 * 400 validation      a body that is not an object, an id that cannot name a card, a rating other
 *                     than 'again' or 'good';
 * 404 not_found       not a current card of a published lesson (a removed card or an unpublished
 *                     lesson is hidden: its row and memory stay);
 * 409 not_in_queue    + learnerId, summary: a real card this learner's queue does not hold (never
 *                     entered, the lesson was started over, the progress was deleted);
 * 409 not_due         + learnerId, reviewedToday, dueOn, summary: graded today already
 *                     (reviewedToday true; a retry after a lost answer lands here) or due later;
 * 409 review_limit    + learnerId, doneToday, dailyLimit, summary: dailyLimit cards graded today;
 * 503 review_unavailable  no database, the database is down, migration 020 not applied, a missing grant;
 * 500 review_failed   anything else (also right after an account deletion: the next request is
 *                     401 account_deleted).
 * summary is the counts after the refusal, so a device that was behind catches up in one round trip;
 * only the defensive not_due of a duplicate log row (unreachable unless rows were edited by hand)
 * has none. 400 invalid_body / 413 body_too_large (the parser), 401 and 429 come from server.js's
 * middleware, in their own shape.
 * Logic and SQL: tools/core/reviewQueue.js. Tables: server/migrations/020_review_queue.sql.
 */
import express from 'express';
import { getPool } from '../db.js';
import { getReviewQueue, gradeReviewCard } from '../../tools/core/reviewQueue.js';
import { noteReviewDay } from '../../tools/core/achievements.js';
import { REVIEW_DAILY_LIMIT } from '../../shared/review/queue.js';

/** Largest body (three ids and a rating). */
export const REVIEW_BODY_LIMIT = '2kb';

/** Reads and grades per learner per minute: a ten-card session is about twenty requests. */
export const REVIEW_REQUESTS_PER_MINUTE = 60;

/** The two ratings (R3), as the API names them. */
const RATINGS = new Set(['again', 'good']);

/** Core error types that mean "the database cannot serve this now" (503, try again later). */
const UNAVAILABLE = new Set(['db_connection', 'table_not_found', 'permission_denied']);

/** @param {import('express').Request} req */
const userIdOf = (req) => /** @type {string} */ (/** @type {any} */ (req).userId);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {import('express').Response} res */
const unavailable = (res) => res.status(503).json({
    ok: false,
    error: 'Reviews are unavailable right now. Please try again later.',
    error_type: 'review_unavailable',
});

/** @param {import('express').Response} res */
const badRequest = (res) => res.status(400).json({
    ok: false,
    error: 'Send a JSON object { courseSlug, lessonId, cardId, rating } naming a review card, with rating "again" or "good".',
    error_type: 'validation',
});

/**
 * A database failure, without its text.
 * @param {import('express').Response} res
 * @param {{ error_type: string }} result
 * @param {string} message
 */
function failed(res, result, message) {
    if (UNAVAILABLE.has(result.error_type)) return unavailable(res);
    return res.status(500).json({ ok: false, error: message, error_type: 'review_failed' });
}

/**
 * The fields a 409 carries besides { ok, error, error_type } (the core's, in a fixed order; summary
 * only when the core read one).
 * @param {Record<string, any>} result
 * @param {string[]} fields
 */
function conflictFields(result, fields) {
    /** @type {Record<string, unknown>} */
    const out = { learnerId: result.learnerId };
    for (const field of fields) out[field] = result[field];
    if (result.summary) out.summary = result.summary;
    return out;
}

/**
 * Maps a refusal of gradeReviewCard to its answer.
 * @param {import('express').Response} res
 * @param {Record<string, any> & { error_type: string }} result
 */
function refused(res, result) {
    switch (result.error_type) {
        case 'validation':
            return badRequest(res);
        case 'not_found':
            return res.status(404).json({ ok: false, error: 'This card is not in a published lesson.', error_type: 'not_found' });
        case 'not_in_queue':
            return res.status(409).json({ ok: false, error: 'This card is not in your reviews.', error_type: 'not_in_queue', ...conflictFields(result, []) });
        case 'not_due':
            return res.status(409).json({
                ok: false,
                error: result.reviewedToday === true ? 'This card was already recorded today.' : 'This card is not due today.',
                error_type: 'not_due',
                ...conflictFields(result, ['reviewedToday', 'dueOn']),
            });
        case 'review_limit':
            return res.status(409).json({
                ok: false,
                error: `You have reviewed ${REVIEW_DAILY_LIMIT} cards today. The rest come back on later days.`,
                error_type: 'review_limit',
                ...conflictFields(result, ['doneToday', 'dailyLimit']),
            });
        default:
            return failed(res, result, 'The review could not be recorded.');
    }
}

/**
 * @typedef {(params: { userId: string, day: string }) => unknown} AfterGrade
 *   userId: the canonical learner id; day: the Japan-time day the grade's transaction recorded
 *   (summary.today, the log row's review_day), YYYY-MM-DD
 */

/**
 * Runs the after-grade hook without waiting for it: a throw or a rejection is logged, never
 * answered (the grade was already answered).
 * @param {AfterGrade} afterGrade
 * @param {{ userId: string, day: string }} params
 */
function runAfterGrade(afterGrade, params) {
    /** @param {unknown} error */
    const log = (error) => console.warn('[review] after-grade hook failed:', /** @type {any} */ (error)?.code ?? 'error');
    try {
        Promise.resolve(afterGrade(params)).catch(log);
    } catch (error) {
        log(error);
    }
}

/**
 * @param {{ afterGrade?: AfterGrade }} [options]
 *   afterGrade: called after a grade was answered 200, with the learner and the grade's day
 *   (default noteReviewDay; route tests pass a recorder: server.js createApp({ review: { afterGrade } }))
 */
export function createReviewRouter({ afterGrade = noteReviewDay } = {}) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        if (!getPool()) return unavailable(res);
        const result = await getReviewQueue({ userId: userIdOf(req) });
        if ('error_type' in result) return failed(res, result, 'Reviews could not be read.');
        return res.json({ ok: true, ...result });
    });

    router.post('/grade', async (req, res) => {
        const body = req.body;
        if (!isPlainObject(body)) return badRequest(res);
        const { courseSlug, lessonId, cardId, rating } = body;
        if (typeof courseSlug !== 'string' || typeof lessonId !== 'string' || typeof cardId !== 'string'
            || typeof rating !== 'string' || !RATINGS.has(rating)) {
            return badRequest(res);
        }
        if (!getPool()) return unavailable(res);
        // Only these four fields reach the core: never reveal (the web shows the back itself) and
        // never a time (the database's clock decides the day).
        const result = await gradeReviewCard({ userId: userIdOf(req), courseSlug, lessonId, cardId, rating, source: 'web' });
        if ('error_type' in result) return refused(res, /** @type {Record<string, any> & { error_type: string }} */ (result));
        const { learnerId, graded, summary } = /** @type {Record<string, any>} */ (result);
        res.json({ ok: true, learnerId, graded, summary });
        // The grade's own day, not the hook's today: its transaction may begin after 00:00 JST.
        runAfterGrade(afterGrade, { userId: learnerId, day: summary.today });
    });

    return router;
}
