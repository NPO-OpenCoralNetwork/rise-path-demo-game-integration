// @ts-check
/**
 * After requireAuth: only a real learner's Supabase session passes (Phase 4; the rule of
 * server/routes/billing.js signedIn). The dev fallback, the bridge user (PHASE1_USER_ID, compared
 * in canonical form) and an anonymous Supabase user get 401 sign_in_required with `message`.
 */
import { PHASE1_USER_ID } from '../db.js';
import { canonicalUserId } from '../../tools/core/accountDeletions.js';

/**
 * @param {string} message the 401 text, e.g. 'Sign in with a Rise Path account to delete it.'
 * @returns {import('express').RequestHandler}
 */
export const requireSignedIn = (message) => (req, res, next) => {
    const r = /** @type {any} */ (req);
    const id = canonicalUserId(r.userId);
    if (r.authMethod !== 'supabase-jwt' || !id || id === canonicalUserId(PHASE1_USER_ID) || r.isAnonymous === true) {
        return res.status(401).json({ error: message, error_type: 'sign_in_required' });
    }
    return next();
};
