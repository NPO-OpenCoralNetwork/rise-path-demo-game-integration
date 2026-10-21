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
 *
 * @module server/middleware/auth
 */

import { PHASE1_USER_ID, syncAuthUserStub } from '../db.js';
import { allowDevAuthFallback } from './authPolicy.js';
import { isBridgeToken } from './bridgeToken.js';

// ─── Supabase Client (lazy singleton) ───────────────────────

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

let _supabase = null;
let _initAttempted = false;
/** @type {any} undefined = use the real client */
let _supabaseOverride;

/** Tests: replace the Supabase client (anything with `auth.getUser`); null = not configured. */
export function setSupabaseForTests(client) {
    _supabaseOverride = client;
}

export function resetSupabaseForTests() {
    _supabaseOverride = undefined;
}

/**
 * Get or create a cached Supabase client instance.
 * Exported for reuse in MCP Server's resolveUserId().
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export const getSupabase = () => {
    if (_supabaseOverride !== undefined) return _supabaseOverride;
    if (_supabase) return _supabase;
    if (_initAttempted) return null; // Already tried, Supabase not available
    return null; // Call initSupabase() first
};

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

// ─── JWT verification (once per request) ─────────────────────

const JWT_VERIFICATION = Symbol('jwtVerification');

/**
 * @typedef {{ status: 'missing' | 'unconfigured' | 'invalid' | 'error' } & { detail?: string }
 *   | { status: 'valid', userId: string }} JwtVerification
 */

/** @returns {Promise<JwtVerification>} */
async function verifyJwt(req) {
    const token = extractBearerToken(req);
    if (!token) return { status: 'missing' };
    const supabase = getSupabase();
    if (!supabase) return { status: 'unconfigured' };
    // The bridge token travels as a bearer token too; it is not a user token, so skip the lookup.
    if (isBridgeToken(token)) return { status: 'invalid', detail: 'The bridge token is not a user token' };
    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) return { status: 'invalid', detail: error?.message };
        return { status: 'valid', userId: data.user.id };
    } catch (err) {
        return { status: 'error', detail: err.message };
    }
}

/**
 * The request's bearer token checked against Supabase at most once, however many guards run on
 * the request: later calls reuse the first result.
 * @param {import('express').Request} req
 * @returns {Promise<JwtVerification>}
 */
export function verifyJwtOnce(req) {
    if (!req[JWT_VERIFICATION]) req[JWT_VERIFICATION] = verifyJwt(req);
    return req[JWT_VERIFICATION];
}

async function grant(req, next, userId, authMethod) {
    req.userId = userId;
    req.authMethod = authMethod;
    await syncAuthUserStub(userId);
    return next();
}

// ─── Middleware ──────────────────────────────────────────────

/**
 * Require authentication. Sets req.userId and req.authMethod.
 */
export const requireAuth = async (req, res, next) => {
    const jwt = await verifyJwtOnce(req);

    if (jwt.status === 'valid') return grant(req, next, jwt.userId, 'supabase-jwt');

    // No token provided
    if (jwt.status === 'missing') {
        if (allowDevAuthFallback()) return grant(req, next, PHASE1_USER_ID, 'dev-fallback');
        return res.status(401).json({
            error: 'Authentication required',
            hint: 'Include Authorization: Bearer <supabase-jwt> header',
        });
    }

    // Token provided but Supabase is not configured
    if (jwt.status === 'unconfigured') {
        if (allowDevAuthFallback()) {
            console.warn('[Auth] Token provided but Supabase not configured. Using dev fallback.');
            return grant(req, next, PHASE1_USER_ID, 'no-supabase-fallback');
        }
        return res.status(503).json({
            error: 'Authentication service not configured',
        });
    }

    if (jwt.status === 'invalid') {
        return res.status(401).json({
            error: 'Invalid or expired token',
            detail: jwt.detail,
        });
    }

    console.error('[Auth] JWT validation error:', jwt.detail);
    return res.status(500).json({ error: 'Authentication service error' });
};

/**
 * Optional auth: set req.userId when a valid token is present; otherwise anonymous.
 * Invalid or expired tokens do not block the request (unlike requireAuth).
 */
export const optionalAuth = async (req, res, next) => {
    const jwt = await verifyJwtOnce(req);

    if (jwt.status === 'valid') return grant(req, next, jwt.userId, 'supabase-jwt');
    if (jwt.status === 'unconfigured' && allowDevAuthFallback()) {
        return grant(req, next, PHASE1_USER_ID, 'no-supabase-fallback');
    }
    if (jwt.status === 'error') console.warn('[Auth] optionalAuth JWT validation failed:', jwt.detail);

    req.userId = null;
    req.authMethod = 'anonymous';
    return next();
};
