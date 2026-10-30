// @ts-check
/**
 * After requireAuth: only a real learner's Supabase session passes (Phase 4; the rule of
 * server/routes/billing.js signedIn). The dev fallback, the bridge user (PHASE1_USER_ID, compared
 * in canonical form) and an anonymous Supabase user get 401 sign_in_required with `message`.
 */
import { isRealLearner } from './termsGate.js';

/**
 * @param {string} message the 401 text, e.g. 'Sign in with a Rise Path account to delete it.'
 * @returns {import('express').RequestHandler}
 */
export const requireSignedIn = (message) => (req, res, next) => {
    // One definition of "a learner" with the terms check (server/middleware/termsGate.js).
    if (!isRealLearner(req)) return res.status(401).json({ error: message, error_type: 'sign_in_required' });
    return next();
};
