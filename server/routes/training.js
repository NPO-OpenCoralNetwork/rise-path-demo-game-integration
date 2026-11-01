// @ts-check
/**
 * Job training (doc/brushup-2026/training-plan.ja.md D1, D5, §4.2). Mounted by server.js at
 * /api/v2/training, before the /api/v2/user mount and the /api/v2 catch-alls (their AI limiter must
 * never count a training call), behind its own JSON parser (TRAINING_BODY_LIMIT: 413
 * body_too_large, 400 invalid_body, before the 2 MB parser). The rest lives in this router, so
 * server.js changes by one parser line and one mount line:
 *   1. the switch: unless TRAINING_ENABLED is exactly "true" (the BILLING_ENABLED rule,
 *      server/services/billingConfig.js), every request that passes the parser above answers 404
 *      training_off, before auth (no Supabase call, no account read, no stub write, no limiter).
 *      Read on every request;
 *   2. requireAuth + requireSignedIn (the dev fallback, the bridge user and an anonymous user 401
 *      sign_in_required; an agent's OAuth token 401 oauth_client_token: AI apps never reach it);
 *   3. a per-learner limit on every route together (TRAINING_REQUESTS_PER_MINUTE, 429
 *      rate_limited), not relaxed in development;
 *   4. the routes, then 404 not_found for any other path or method (nothing falls through).
 *
 * GET /me → 200 { ok, learnerId, cohorts: [{ cohortId, name, role }] } (live memberships only).
 * Its refusals are { ok: false, error, error_type } with fixed English text, never the driver's:
 * 503 training_unavailable (no database, down, a migration not applied, a missing grant; with
 * Retry-After: 60, as server/routes/legal.js), 500 training_failed (answerCoreError).
 * Study time: GET /cohorts/:cohortId/time and POST /cohorts/:cohortId/time/signals
 * (server/routes/trainingTime.js, used here before the 404; its header lists its answers).
 * 401, 404 training_off and 429 come from the middleware, in their own shape.
 * Logic and SQL: tools/core/training.js and tools/core/trainingTime.js. Tables:
 * server/migrations/021_training_cohorts.sql and 022_training_study_time.sql.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { requireSignedIn } from '../middleware/signedIn.js';
import { canonicalUserId } from '../../tools/core/accountDeletions.js';
import { TRAINING_REQUESTS_PER_MINUTE, getTrainingMe } from '../../tools/core/training.js';
import { answerCoreError, createTrainingTimeRouter } from './trainingTime.js';

/** Largest body (a study time signal: six short fields). */
export const TRAINING_BODY_LIMIT = '4kb';
/** Requests per learner per minute, every training route together (defined with the core, which checks a rules file against it). */
export { TRAINING_REQUESTS_PER_MINUTE };

/**
 * Whether the training API is on: exactly "true" (off by default). Read on every request.
 * @param {Record<string, string | undefined>} [env]
 */
export const isTrainingEnabled = (env = process.env) => env.TRAINING_ENABLED === 'true';

/** @param {import('express').Request} req */
const userIdOf = (req) => /** @type {string} */ (/** @type {any} */ (req).userId);

/**
 * @param {{ env?: Record<string, string | undefined> }} [options]
 *   env: where the switch is read (tests pass their own; the app process.env)
 */
export function createTrainingRouter({ env = process.env } = {}) {
    const router = express.Router();
    const limiter = rateLimit({
        windowMs: 60 * 1000,
        limit: TRAINING_REQUESTS_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `training:${canonicalUserId(userIdOf(req)) ?? userIdOf(req)}`,
        message: { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' },
        validate: { keyGeneratorIpFallback: false },
    });

    router.use((req, res, next) => {
        if (isTrainingEnabled(env)) return next();
        return res.status(404).json({ error: 'Training is not offered here.', error_type: 'training_off' });
    });
    router.use(requireAuth, requireSignedIn('Sign in with a Rise Path account to use training.'), limiter);

    router.get('/me', async (req, res) => {
        const result = await getTrainingMe({ userId: userIdOf(req) });
        if ('error_type' in result) return answerCoreError(res, result.error_type, 'Training could not be read.');
        return res.json({ ok: true, ...result });
    });

    router.use(createTrainingTimeRouter());

    // Nothing under /api/v2/training falls through to the later mounts (and their AI limiter).
    router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.', error_type: 'not_found' }));

    return router;
}
