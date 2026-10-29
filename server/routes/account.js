// @ts-check
/**
 * Deleting one's own Rise Path account from Settings (Phase 4, owner decisions D1 and D3; design
 * §5.4). Mounted by server.js at /api/v2/user/account behind requireAuth and requireSignedIn (the
 * dev fallback, the bridge user and an anonymous user get 401 sign_in_required; an agent's own
 * OAuth token 401 oauth_client_token), with its own 16 kb JSON body parser registered before the
 * 50 MB one (server/middleware/smallBody.js: 413 body_too_large, 400 invalid_body).
 *
 * GET  /deletion → 200 { ok, enabled, subscription: 'none' | 'renewing' | 'ending', reauthWindowSeconds }
 *      The page shows a renewing plan before asking for the password (the local copy; Stripe is
 *      read at the deletion). 503 deletion_unavailable without a database or when it fails.
 *      The POST can take longer than an ordinary call: the Stripe checks before the deletion (8 s
 *      per call at most) and, after it, up to AFTER_COMMIT_WAIT_MS (10 s) of re-checks.
 * POST /deletion body { "confirm": "delete-my-account", "apps"?: [{ "clientId", "clientName" }] },
 *      sent with the access token of a password sign-in made for this (the browser signs in again
 *      with an ephemeral client). apps: the learner's AI apps as the page read them from Supabase's
 *      listGrants, so the 3-year provision record names an app the remote MCP server only knew by
 *      id (the same trust as the revoke route's clientName); at most DELETION_APP_NAMES_MAX, UUID
 *      ids only, names cleaned like the revoke route's; anything else is dropped and never refuses
 *      the deletion. In order:
 *      per-learner limit 5/min (429 rate_limited); ACCOUNT_DELETION_ENABLED off → 503
 *      deletion_disabled (off by default: only true/1/on/yes, trimmed and in any case, turn it on;
 *      unset, empty and false/0/off/no leave it off; any other value → off with one warning);
 *      400 confirm_required; re-auth: the token's newest `password` amr time
 *      within [now − 120 s, now + 60 s] and its sub the signed-in user, else 401 reauth_required;
 *      then server/services/accountDeletion.js deleteAccountData (requestedBy 'self').
 *      200 { ok, status: 'deleted', deletedAt } (repeated: true when it was already deleted);
 *      409 subscription_active; 503 payment_provider_unavailable, memory_service_unavailable,
 *      account_busy, deletion_unavailable. Every refusal is { error, error_type } with fixed
 *      English text and, from the service, memory_deleted (true when the AI memories were
 *      already deleted before the failure). Never Stripe's, Memanto's or the database's text.
 *
 * Nobody is signed out of Supabase: the login is shared (D2). Every session from before the
 * deletion then gets 401 account_deleted (server/middleware/auth.js).
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPool } from '../db.js';
import { extractBearerToken } from '../middleware/auth.js';
import { DELETION_APP_NAMES_MAX, deleteAccountData as defaultDeleteAccountData, readDeletionState as defaultReadDeletionState, REAUTH_MAX_AGE_S } from '../services/accountDeletion.js';
import { cleanClientName } from './connectedApps.js';
import { isUuid } from '../utils/ids.js';
import { readEnvSwitch } from '../utils/envSwitch.js';
import { canonicalUserId } from '../../tools/core/accountDeletions.js';
import { decodeTokenClaims, passwordAuthTime, sessionAuthTime } from '../../tools/core/oauthToken.js';

/** Largest body: the confirm word and up to DELETION_APP_NAMES_MAX app ids with names of at most 100 characters. */
export const ACCOUNT_BODY_LIMIT = '16kb';
/** Deletion attempts per learner per minute. */
export const ACCOUNT_DELETIONS_PER_MINUTE = 5;
/** A password sign-in may lie this far ahead of the server clock (Supabase's clock). */
export const REAUTH_FUTURE_SKEW_S = 60;
export const CONFIRM_WORD = 'delete-my-account';

/**
 * Whether deleting from Settings is on (the parser of server/utils/envSwitch.js: only true/1/on/yes,
 * trimmed and in any case, turn it on; anything else leaves it off, an unrecognised value with
 * recognised: false). It is off until the owner sets the switch: without the
 * Supabase setting "Require current password when updating", anyone holding a signed-in session
 * can set a new password through /auth/v1/user and pass the password re-entry, and the production
 * `amr` check comes first too (ai-access-plan §8.2 items 2 and 3). The switch is also the BYOA
 * precondition (design §10.1), so a misspelt value ("ture", "enabled") leaves deletion off.
 * The staff script (scripts/delete-account-data.mjs) does not read it.
 * @type {(raw: string | undefined) => { on: boolean, recognised: boolean }}
 */
export const readDeletionSwitch = readEnvSwitch;

/** Fixed answers by the service's reason. @type {Record<string, { status: number, error: string }>} */
const REASONS = Object.freeze({
    invalid_user: { status: 400, error: 'This account cannot be deleted here.' },
    subscription_active: { status: 409, error: 'Your supporter plan is still renewing. Cancel it first, then delete your account.' },
    payment_provider_unavailable: { status: 503, error: 'Your plan could not be checked with the payment service. Nothing was deleted. Please try again later.' },
    memory_service_unavailable: { status: 503, error: 'The AI memory service cannot be reached. Nothing was deleted. Please try again later.' },
    account_busy: { status: 503, error: 'Your account is busy right now. Please try again in a minute.' },
    deletion_unavailable: { status: 503, error: 'Your account cannot be deleted right now. Please try again later.' },
});

/** @param {import('express').Response} res @param {number} status @param {string} errorType @param {string} error @param {Record<string, unknown>} [extra] */
const refuse = (res, status, errorType, error, extra = {}) => {
    if (status === 503) res.set('Retry-After', '60');
    return res.status(status).json({ error, error_type: errorType, ...extra });
};

/** @param {import('express').Request} req */
const userIdOf = (req) => String(/** @type {any} */ (req).userId ?? '');

/**
 * The body's app names for the deletion: UUID ids (lower case, one per id) with a cleaned name, at
 * most DELETION_APP_NAMES_MAX; anything else is dropped.
 * @param {unknown} apps
 * @returns {{ clientId: string, clientName: string }[]}
 */
export function deletionAppNames(apps) {
    /** @type {Map<string, string>} */
    const byId = new Map();
    for (const entry of Array.isArray(apps) ? apps.slice(0, DELETION_APP_NAMES_MAX * 2) : []) {
        if (byId.size >= DELETION_APP_NAMES_MAX) break;
        const clientId = typeof entry?.clientId === 'string' && isUuid(entry.clientId) ? entry.clientId.toLowerCase() : null;
        const clientName = cleanClientName(entry?.clientName);
        if (clientId && clientName && !byId.has(clientId)) byId.set(clientId, clientName);
    }
    return [...byId].map(([clientId, clientName]) => ({ clientId, clientName }));
}

/**
 * @param {{
 *   deleteAccountData?: typeof defaultDeleteAccountData,
 *   readDeletionState?: typeof defaultReadDeletionState,
 *   billing?: import('../services/accountDeletion.js').BillingDeps,
 *   now?: () => number,
 *   env?: Record<string, string | undefined>,
 *   getPool?: () => any,
 *   logger?: Pick<Console, 'warn'>,
 * }} [options]
 *   billing: { config, stripe } as server.js builds them (stripe null when billing is not serviceable)
 */
export function createAccountRouter({
    deleteAccountData = defaultDeleteAccountData,
    readDeletionState = defaultReadDeletionState,
    billing = { config: null, stripe: null },
    now = () => Date.now(),
    env = process.env,
    getPool: poolFn = getPool,
    logger = console,
} = {}) {
    const router = express.Router();
    /** Unrecognised values already warned about (one line per value, not per request). */
    const warned = new Set();
    const enabled = () => {
        const raw = env.ACCOUNT_DELETION_ENABLED;
        const { on, recognised } = readDeletionSwitch(raw);
        if (!recognised && !warned.has(raw)) {
            warned.add(raw);
            logger.warn("[Account] ACCOUNT_DELETION_ENABLED has an unrecognised value: account deletion is off (use 'true' or 'false')");
        }
        return on;
    };

    const limitDeletion = rateLimit({
        windowMs: 60 * 1000,
        limit: ACCOUNT_DELETIONS_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `account-delete:${canonicalUserId(userIdOf(req)) ?? userIdOf(req)}`,
        message: { error: 'Too many tries. Please wait a minute and try again.', error_type: 'rate_limited' },
        validate: { keyGeneratorIpFallback: false },
    });

    router.get('/deletion', async (req, res) => {
        const pool = poolFn();
        if (!pool) return refuse(res, 503, 'deletion_unavailable', REASONS.deletion_unavailable.error);
        try {
            // The same plan rows as the deletion's own check (billing decides whether test-mode rows count).
            const { subscription } = await readDeletionState({ pool, userId: userIdOf(req), billing });
            return res.json({ ok: true, enabled: enabled(), subscription, reauthWindowSeconds: REAUTH_MAX_AGE_S });
        } catch (error) {
            logger.warn(`[Account] deletion preflight failed (${/** @type {any} */ (error)?.code ?? 'error'})`);
            return refuse(res, 503, 'deletion_unavailable', REASONS.deletion_unavailable.error);
        }
    });

    router.post('/deletion', limitDeletion, async (req, res) => {
        if (!enabled()) return refuse(res, 503, 'deletion_disabled', 'Deleting an account from this page is turned off right now.');
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirm !== CONFIRM_WORD) {
            return refuse(res, 400, 'confirm_required', `Send { "confirm": "${CONFIRM_WORD}" } to delete your account.`);
        }
        // Re-authentication: this request's own token must come from a password sign-in made just
        // now (amr keeps the sign-in time across refreshes, so an old session never passes).
        const claims = decodeTokenClaims(extractBearerToken(req));
        const passwordAt = passwordAuthTime(claims);
        const nowS = now() / 1000;
        const userId = canonicalUserId(userIdOf(req));
        const fresh = passwordAt !== null && passwordAt >= nowS - REAUTH_MAX_AGE_S && passwordAt <= nowS + REAUTH_FUTURE_SKEW_S;
        if (!fresh || !userId || canonicalUserId(claims?.sub) !== userId) {
            return refuse(res, 401, 'reauth_required', 'Enter your password again to delete your account.');
        }

        let result;
        try {
            result = await deleteAccountData({ userId, requestedBy: 'self', authTime: sessionAuthTime(claims), appNames: deletionAppNames(body.apps), billing });
        } catch (error) {
            logger.warn(`[Account] deletion threw (${/** @type {any} */ (error)?.name ?? 'Error'})`);
            return refuse(res, 503, 'deletion_unavailable', REASONS.deletion_unavailable.error, { memory_deleted: false });
        }
        if (result.status === 'deleted' || result.status === 'already') {
            return res.json({ ok: true, status: 'deleted', deletedAt: result.deletedAt, ...(result.status === 'already' ? { repeated: true } : {}) });
        }
        const failure = /** @type {{ reason: string, memoryDeleted: boolean }} */ (result);
        const answer = REASONS[failure.reason] ?? REASONS.deletion_unavailable;
        const errorType = REASONS[failure.reason] ? failure.reason : 'deletion_unavailable';
        return refuse(res, answer.status, errorType, answer.error, { memory_deleted: failure.memoryDeleted === true });
    });

    return router;
}
