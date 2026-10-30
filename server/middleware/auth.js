/**
 * Authentication Middleware — Supabase JWT
 *
 * Validates Supabase JWT tokens and sets req.userId.
 *
 * Behavior:
 *   Strict mode (NODE_ENV=production | RISEPATH_STRICT_AUTH=true | VITE_DEMO_MODE=false):
 *     - token required → 401 if missing
 *   Dev/demo mode:
 *     - token missing → PHASE1_USER_ID fallback
 *     - Supabase not configured → PHASE1_USER_ID fallback
 *   Always:
 *     - a token Supabase's OAuth server issued to a connected agent (payload has client_id, or aud
 *       is not 'authenticated'; tools/core/oauthToken.js) is never an app session: requireAuth
 *       answers 401 oauth_client_token, optionalAuth treats the caller as anonymous. Agents reach
 *       Rise Path only through the remote MCP endpoint (mcp-server/oauthVerifier.js).
 *     - a Supabase session of a deleted Rise Path account (tools/core/accountDeletions.js: it signed
 *       in no later than the deletion) is refused: requireAuth answers 401 account_deleted,
 *       optionalAuth treats the caller as anonymous; neither recreates the auth.users stub. A
 *       session that signed in after the deletion re-opens a new, empty account. When the check
 *       cannot run (database error), requireAuth answers 503 auth_unavailable (fail closed).
 *       req.accountGeneration is that account's generation (null unless it was re-opened; null on
 *       the dev fallbacks too, as in bridgeAuth.js).
 *       This release reads account_deletions on every signed-in request: apply migration 018
 *       (npm run db:migrate) before starting the api, also on a local dev database.
 *     - when Supabase Auth cannot answer (no connection, 5xx, rate limited; tools/core/authUnavailable.js),
 *       the token is not refused: requireAuth answers 503 auth_unavailable, as when the account check
 *       cannot run, and optionalAuth treats the caller as anonymous with req.accountCheckUnavailable
 *       set (the AI gate answers 503). Nothing is read or written for that token, and a learner is
 *       never asked to sign in again because of an outage. A token Supabase Auth refuses stays 401.
 *     - the guards of one request (several can run: server.js mounts requireAuth twice on /image,
 *       /upload and /rag, and optionalAuth after requireAuth on the TTS routes) check the session
 *       once: getUser, the account state and the stub write are shared (oncePerRequest below).
 *       Each guard still decides on its own; nothing is kept across requests.
 *     - with LEGAL_TERMS_REQUIRED on, a real learner's session then passes the terms check
 *       (server/middleware/termsGate.js: 403 terms_required until they accept, except on its
 *       TERMS_EXEMPT routes); the dev fallbacks and anonymous callers never meet it.
 *
 * @module server/middleware/auth
 */

import { getPool, PHASE1_USER_ID, syncAuthUserStub } from '../db.js';
import { allowDevAuthFallback } from './authPolicy.js';
import { decodeTokenClaims, isOAuthClientToken, sessionAuthTime } from '../../tools/core/oauthToken.js';
import { readAccountState } from '../../tools/core/accountDeletions.js';
import { isAuthUnavailable } from '../../tools/core/authUnavailable.js';
import { termsGateStep } from './termsGate.js';

// ─── Supabase Client (lazy singleton) ───────────────────────

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

let _supabase = null;
let _initAttempted = false;

/**
 * Get or create a cached Supabase client instance.
 * Exported for reuse in MCP Server's resolveUserId().
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export const getSupabase = () => {
    if (_supabase) return _supabase;
    if (_initAttempted) return null; // Already tried, Supabase not available
    return null; // Call initSupabase() first
};

/**
 * Tests: a stand-in client whose auth.getUser(token) names the user, or null for none (dev
 * fallback). Replaces what initSupabase() set up.
 * @param {{ auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }, error: unknown }> } } | null} client
 */
export function setSupabaseForTests(client) {
    _supabase = client;
    _initAttempted = true;
}

/**
 * Initialize Supabase client. Call once at server startup.
 * Safe to call multiple times; only first call has effect.
 */
export async function initSupabase() {
    if (_initAttempted) return _supabase;
    _initAttempted = true;

    // Re-read from process.env (may have been set by loadEnvFile after module load)
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
             || process.env.SUPABASE_ANON_KEY
             || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !key) {
        console.warn('[Auth] Supabase not configured (SUPABASE_URL or key missing). JWT validation disabled.');
        return null;
    }

    try {
        const { createClient } = await import('@supabase/supabase-js');
        _supabase = createClient(url, key);
        console.log('[Auth] Supabase client initialized');
        return _supabase;
    } catch (err) {
        console.warn('[Auth] @supabase/supabase-js import failed:', err.message);
        return null;
    }
}

// ─── Token Extraction ───────────────────────────────────────

/**
 * Extract Bearer token from Authorization header.
 * @param {import('express').Request} req
 * @returns {string | null}
 */
export const extractBearerToken = (req) => {
    const auth = req.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    return null;
};

/** The 401 body for a connected agent's OAuth token sent to the app API. */
export const OAUTH_CLIENT_TOKEN_REFUSAL = Object.freeze({
    error: 'This token belongs to a connected app. Sign in to Rise Path to use this API.',
    error_type: 'oauth_client_token',
});

/** The 401 body for a session of a deleted Rise Path account (signed in before the deletion). */
export const ACCOUNT_DELETED_REFUSAL = Object.freeze({
    error: 'This Rise Path account was deleted. Sign in again to start a new, empty account.',
    error_type: 'account_deleted',
});

/**
 * The 503 body when the session cannot be checked: Supabase Auth does not answer, or the account
 * check fails (database error). Never let through, and never 401 (which asks to sign in again).
 */
export const AUTH_UNAVAILABLE = Object.freeze({
    error: 'Sign-in cannot be checked right now. Please try again.',
    error_type: 'auth_unavailable',
});

/**
 * The account state for a Supabase session token that getUser accepted for userId
 * (tools/core/accountDeletions.js). The app API may re-open a deleted account for a session that
 * signed in after the deletion. Throws when the database cannot answer.
 * @param {string} token
 * @param {string} userId
 */
const readSessionAccountState = (token, userId) => readAccountState(
    getPool(),
    userId,
    sessionAuthTime(decodeTokenClaims(token)),
    { mayReopen: true },
);

// ─── One check per request ──────────────────────────────────

const CHECKS = Symbol('rise-path.authChecks');

/**
 * What run() answers, once per request and key: the first guard that asks runs it, later guards of
 * the same request get the same promise. A guard handles a shared rejection as if it had made the
 * call itself (syncAuthUserStub never rejects).
 * @template T
 * @param {object} req
 * @param {string} key
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
const oncePerRequest = (req, key, run) => {
    const checks = req[CHECKS] ?? (req[CHECKS] = new Map());
    if (!checks.has(key)) checks.set(key, run());
    return checks.get(key);
};

/** supabase.auth.getUser(token), once per request. */
export const getUserOnce = (req, supabase, token) => oncePerRequest(req, `user:${token}`, () => supabase.auth.getUser(token));

/** readSessionAccountState (which may re-open the account), once per request. */
export const readSessionAccountStateOnce = (req, token, userId) =>
    oncePerRequest(req, `account:${userId}:${token}`, () => readSessionAccountState(token, userId));

/** syncAuthUserStub, once per request and user. */
export const syncAuthUserStubOnce = (req, userId) => oncePerRequest(req, `stub:${userId}`, () => syncAuthUserStub(userId));

// ─── Middleware ──────────────────────────────────────────────

/**
 * Require authentication. Sets req.userId, req.authMethod and req.accountGeneration
 * (tools/core/accountDeletions.js: null on the dev fallbacks, whose PHASE1 user is never deleted),
 * and for a Supabase session req.isAnonymous (true for an anonymous user).
 */
export const requireAuth = async (req, res, next) => {
    const token = extractBearerToken(req);

    // No token provided
    if (!token) {
        if (allowDevAuthFallback()) {
            req.userId = PHASE1_USER_ID;
            req.authMethod = 'dev-fallback';
            req.accountGeneration = null;
            await syncAuthUserStubOnce(req, req.userId);
            return next();
        }
        return res.status(401).json({
            error: 'Authentication required',
            hint: 'Include Authorization: Bearer <supabase-jwt> header',
        });
    }

    // Checked before Supabase (and before any dev fallback): getUser accepts these tokens too.
    if (isOAuthClientToken(token)) {
        return res.status(401).json(OAUTH_CLIENT_TOKEN_REFUSAL);
    }

    // Token provided — validate with Supabase
    const supabase = getSupabase();
    if (!supabase) {
        if (allowDevAuthFallback()) {
            req.userId = PHASE1_USER_ID;
            req.authMethod = 'no-supabase-fallback';
            req.accountGeneration = null;
            console.warn('[Auth] Token provided but Supabase not configured. Using dev fallback.');
            await syncAuthUserStubOnce(req, req.userId);
            return next();
        }
        return res.status(503).json({
            error: 'Authentication service not configured',
        });
    }

    try {
        const { data, error } = await getUserOnce(req, supabase, token);
        if (error || !data?.user) {
            // Supabase Auth did not answer: 503, as when the account check cannot run below. The auth
            // provider's own text stays in the server log.
            if (isAuthUnavailable(error)) {
                console.warn('[Auth] Supabase Auth unavailable:', error?.message || error);
                return res.status(503).json(AUTH_UNAVAILABLE);
            }
            if (error) console.warn('[Auth] token rejected:', error?.message || error);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        // A session of a deleted account is refused before anything is written (no stub). Its own
        // try: a database error is 503 auth_unavailable, not the generic 500 below.
        let account;
        try {
            account = await readSessionAccountStateOnce(req, token, data.user.id);
        } catch (err) {
            console.warn('[Auth] account state check failed:', err?.message || err);
            return res.status(503).json(AUTH_UNAVAILABLE);
        }
        if (account.state === 'deleted') return res.status(401).json(ACCOUNT_DELETED_REFUSAL);
        req.userId = data.user.id;
        req.authMethod = 'supabase-jwt';
        req.accountGeneration = account.generation;
        // An anonymous Supabase user (if the project ever enables anonymous sign-in) cannot sign
        // back in after losing the session: routes that keep records for a person (billing) refuse it.
        req.isAnonymous = data.user.is_anonymous === true;
        await syncAuthUserStubOnce(req, req.userId);
        // Phase 8: the terms check (off unless LEGAL_TERMS_REQUIRED; server/middleware/termsGate.js).
        return termsGateStep(req, res, next);
    } catch (err) {
        console.error('[Auth] JWT validation error:', err.message);
        return res.status(500).json({ error: 'Authentication service error' });
    }
};

/**
 * Optional auth: set req.userId, req.accountGeneration and req.isAnonymous (as requireAuth) when a
 * valid token is present; otherwise anonymous (req.userId null, no generation).
 * Invalid or expired tokens do not block the request (unlike requireAuth).
 */
export const optionalAuth = async (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
        req.userId = null;
        req.authMethod = 'anonymous';
        return next();
    }

    if (isOAuthClientToken(token)) {
        req.userId = null;
        req.authMethod = 'anonymous';
        return next();
    }

    const supabase = getSupabase();
    if (!supabase) {
        if (allowDevAuthFallback()) {
            req.userId = PHASE1_USER_ID;
            req.authMethod = 'no-supabase-fallback';
            req.accountGeneration = null;
            await syncAuthUserStubOnce(req, req.userId);
            return next();
        }
        req.userId = null;
        req.authMethod = 'anonymous';
        return next();
    }

    try {
        const { data, error } = await getUserOnce(req, supabase, token);
        if (error || !data?.user) {
            // Supabase Auth did not answer: flagged like an account check that cannot run (below).
            if (isAuthUnavailable(error)) {
                console.warn('[Auth] optionalAuth: Supabase Auth unavailable:', error?.message || error);
                req.accountCheckUnavailable = true;
            }
            req.userId = null;
            req.authMethod = 'anonymous';
            return next();
        }
        // A deleted account's session, or a check that cannot run, is anonymous (no stub). A check
        // that could not run is flagged: the AI gate answers 503 ai_access_unavailable to it (try
        // again), never 401 sign_in_required or the guest path to a signed-in learner.
        let account;
        try {
            account = await readSessionAccountStateOnce(req, token, data.user.id);
        } catch (err) {
            console.warn('[Auth] optionalAuth account state check failed:', err?.message || err);
            account = null;
            req.accountCheckUnavailable = true;
        }
        if (!account || account.state === 'deleted') {
            req.userId = null;
            req.authMethod = 'anonymous';
            return next();
        }
        req.userId = data.user.id;
        req.authMethod = 'supabase-jwt';
        req.accountGeneration = account.generation;
        // As requireAuth (Phase 8): the terms check never gates an anonymous Supabase user.
        req.isAnonymous = data.user.is_anonymous === true;
        await syncAuthUserStubOnce(req, req.userId);
        // Phase 8: the terms check (off unless LEGAL_TERMS_REQUIRED; server/middleware/termsGate.js).
        return termsGateStep(req, res, next);
    } catch (err) {
        console.warn('[Auth] optionalAuth JWT validation failed:', err.message);
        req.userId = null;
        req.authMethod = 'anonymous';
        return next();
    }
};
