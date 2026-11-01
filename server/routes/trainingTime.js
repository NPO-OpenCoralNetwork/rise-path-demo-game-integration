// @ts-check
/**
 * Job training: study time (doc/brushup-2026/training-plan.ja.md §4.9; D10–D13). Used by
 * createTrainingRouter (server/routes/training.js) after its switch, sign-in and per-learner limit and
 * before its 404 for any other path, so server.js does not change. It only calls the core
 * (tools/core/trainingTime.js; tables of server/migrations/022_training_study_time.sql) and turns
 * its results into answers.
 *
 * GET /cohorts/:cohortId/time → 200 { ok, learnerId, cohortId, today, timeZone: 'Asia/Tokyo',
 *   status: 'ready' | 'not_configured' | 'not_in_session', beatMs (ready only), units: [{ unitKey,
 *   title: { jp, en }, setMs, countedMs, capReached }], days: [{ day, countedMs, final }] (the newest
 *   14), totalMs, asOf }. The learner's final days are closed first.
 * POST /cohorts/:cohortId/time/signals, a body of exactly { unitKey, chainId, seq, stop, focus, input }
 *   (no time, no duration: the database clock decides) → 200 { ok, accepted: true, nextInMs, state:
 *   { counting, reason, todayMs, unit: { unitKey, countedMs, setMs, capReached } } | null } (null for
 *   a stop, when it could not be computed (logged), or when a deletion committed after the signal),
 *   or 200 { ok, accepted: false, reason, nextInMs } when the signal is not stored (duplicate,
 *   chain_ended, not_open, restart, too_soon, other_place). nextInMs is beatMs while the page keeps
 *   its chain (in session, not a stop), else null. The numbers never go down from one answer to the
 *   next (tools/core/trainingTime.js liveTime).
 * beatMs is the only rule value an answer carries (as beatMs or nextInMs).
 *
 * Refusals are { ok: false, error, error_type } with fixed English text, never the driver's:
 * 400 validation (the signal's body); 403 not_a_learner (a live membership with another role); 404
 * cohort_not_found (no such cohort or no live membership in it, not told apart; a cohort id that is
 * not a UUID, before any statement); 409 time_not_configured, not_in_session, unit_unknown,
 * chain_mismatch (nothing stored); 503 training_unavailable with Retry-After: 60 (the database, a
 * migration not applied, a missing grant, a lock wait over TRAINING_LOCK_TIMEOUT, no account row, a
 * database clock behind a closed day); 500 training_failed. A deletion committed while the request
 * waited answers 401 account_deleted in the sign-in's shape ({ error, error_type }). No account row,
 * a clock behind, a 500, a failed close or state are logged by kind, at most once a minute each.
 */
import express from 'express';
import { ACCOUNT_DELETED_REFUSAL } from '../middleware/auth.js';
import { canonicalUserId } from '../../tools/core/accountDeletions.js';
import { readSignalBody, readStudyTime, recordSignal } from '../../tools/core/trainingTime.js';

/** Core error types that mean "the database cannot serve this now" (503, try again later). */
const UNAVAILABLE = new Set(['db_connection', 'table_not_found', 'permission_denied', 'account_busy']);

/** @param {import('express').Response} res */
const unavailable = (res) => {
    res.set('Retry-After', '60');
    return res.status(503).json({ ok: false, error: 'Training is unavailable right now. Please try again later.', error_type: 'training_unavailable' });
};

/**
 * The answer to a core error (every training route): 503 training_unavailable when the database
 * cannot serve it now, else 500 training_failed with `failed`. Never the core's text.
 * @param {import('express').Response} res @param {string} errorType @param {string} failed
 */
export function answerCoreError(res, errorType, failed) {
    if (UNAVAILABLE.has(errorType)) return unavailable(res);
    return res.status(500).json({ ok: false, error: failed, error_type: 'training_failed' });
}

const NOT_FOUND = Object.freeze({ ok: false, error: 'No such cohort for this account.', error_type: 'cohort_not_found' });
const NOT_A_LEARNER = Object.freeze({ ok: false, error: 'Only a learner of this cohort has study time.', error_type: 'not_a_learner' });
const BAD_SIGNAL = Object.freeze({
    ok: false,
    error: 'Send a JSON object with exactly { unitKey, chainId, seq, stop, focus, input }: a unit key, a UUID, an integer from 0 to 2147483647 and three booleans.',
    error_type: 'validation',
});
/** @type {Readonly<Record<string, string>>} */
const REFUSED = Object.freeze({
    time_not_configured: 'Study time is not set up for this cohort today.',
    not_in_session: 'The cohort is not in session.',
    unit_unknown: 'This unit is not in the cohort\'s unit list today.',
    chain_mismatch: 'This chain belongs to another unit or cohort. Start a new chain.',
});

/** @param {import('express').Request} req */
const userIdOf = (req) => /** @type {string} */ (/** @type {any} */ (req).userId);

/** One warn line a minute at most for each kind: a fault repeats on every signal of every page. */
const LOG_EVERY_MS = 60_000;

/**
 * @param {{ logger?: Pick<Console, 'warn'>, now?: () => number }} [options]
 */
export function createTrainingTimeRouter({ logger = console, now = () => Date.now() } = {}) {
    const router = express.Router();
    /** @type {Map<string, number>} */
    const logged = new Map();
    /** @param {string} kind @param {string} line */
    const warn = (kind, line) => {
        const at = now();
        if (at - (logged.get(kind) ?? -Infinity) < LOG_EVERY_MS) return;
        logged.set(kind, at);
        logger.warn(line);
    };

    /**
     * The refusals both routes share; null when the result is none of them.
     * @param {import('express').Response} res @param {string} userId @param {any} result @param {string} failed
     */
    const refuse = (res, userId, result, failed) => {
        if ('error_type' in result) {
            if (!UNAVAILABLE.has(result.error_type)) warn(`failed:${result.error_type}`, `[Training] study time failed (${result.error_type})`);
            return answerCoreError(res, result.error_type, failed);
        }
        if (result.status === 'not_found') return res.status(404).json(NOT_FOUND);
        if (result.status === 'not_a_learner') return res.status(403).json(NOT_A_LEARNER);
        if (result.status === 'deleted_account') return res.status(401).json({ ...ACCOUNT_DELETED_REFUSAL });
        if (result.status === 'no_account') {
            warn(`no_account:${userId}`, `[Training] no account row for ${userId.slice(0, 8)}… (study time not served)`);
            return unavailable(res);
        }
        return null;
    };

    router.get('/cohorts/:cohortId/time', async (req, res) => {
        const userId = userIdOf(req);
        if (!canonicalUserId(req.params.cohortId)) return res.status(404).json(NOT_FOUND);
        const result = await readStudyTime({ userId, cohortId: req.params.cohortId });
        if ('error_type' in result || result.status !== 'read') {
            return refuse(res, userId, result, 'Study time could not be read.') ?? answerCoreError(res, 'unknown', 'Study time could not be read.');
        }
        return res.json({ ok: true, ...result.time });
    });

    router.post('/cohorts/:cohortId/time/signals', async (req, res) => {
        const userId = userIdOf(req);
        if (!canonicalUserId(req.params.cohortId)) return res.status(404).json(NOT_FOUND);
        const signal = readSignalBody(req.body);
        if (!signal) return res.status(400).json(BAD_SIGNAL);
        const failed = 'The signal could not be recorded.';
        const result = await recordSignal({ userId, cohortId: req.params.cohortId, signal });
        const refused = refuse(res, userId, result, failed);
        if (refused || 'error_type' in result) return refused;
        if (result.status === 'accepted') {
            if (result.closeError) warn(`close:${result.closeError}`, `[Training] closing days after a signal failed (${result.closeError})`);
            if (result.stateError) warn(`state:${result.stateError}`, `[Training] study time state failed (${result.stateError})`);
            return res.json({ ok: true, accepted: true, nextInMs: result.nextInMs, state: result.state });
        }
        if (result.status === 'ignored') return res.json({ ok: true, accepted: false, reason: result.reason, nextInMs: result.nextInMs });
        if (result.status === 'refused') return res.status(409).json({ ok: false, error: REFUSED[result.reason] ?? 'The signal was refused.', error_type: result.reason });
        // clock_behind: nothing stored until the database clock is past the closed day's window again.
        warn('clock_behind', '[Training] the database clock is behind a closed day (signal not stored)');
        return unavailable(res);
    });

    return router;
}
