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

// ─── Middleware ──────────────────────────────────────────────

/**
 * Require authentication. Sets req.userId and req.authMethod.
 */
export const requireAuth = async (req, res, next) => {
    const token = extractBearerToken(req);

    // No token provided
    if (!token) {
        if (allowDevAuthFallback()) {
            req.userId = PHASE1_USER_ID;
            req.authMethod = 'dev-fallback';
            await syncAuthUserStub(req.userId);
            return next();
        }
        return res.status(401).json({
            error: 'Authentication required',
            hint: 'Include Authorization: Bearer <supabase-jwt> header',
        });
    }

    // Token provided — validate with Supabase
    const supabase = getSupabase();
    if (!supabase) {
        if (allowDevAuthFallback()) {
            req.userId = PHASE1_USER_ID;
            req.authMethod = 'no-supabase-fallback';
            console.warn('[Auth] Token provided but Supabase not configured. Using dev fallback.');
            await syncAuthUserStub(req.userId);
            return next();
        }
        return res.status(503).json({
            error: 'Authentication service not configured',
        });
    }

    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) {
            return res.status(401).json({
                error: 'Invalid or expired token',
                detail: error?.message,
            });
        }
        req.userId = data.user.id;
        req.authMethod = 'supabase-jwt';
        await syncAuthUserStub(req.userId);
        next();
    } catch (err) {
        console.error('[Auth] JWT validation error:', err.message);
        return res.status(500).json({ error: 'Authentication service error' });
    }
};

/**
 * Optional auth: set req.userId when a valid token is present; otherwise anonymous.
 * Invalid or expired tokens do not block the request (unlike requireAuth).
 */
export const optionalAuth = async (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
        req.userId = null;
        req.authMethod = 'anonymous';
        return next();
    }

    const supabase = getSupabase();
    if (!supabase) {
        if (allowDevAuthFallback()) {
            req.userId = PHASE1_USER_ID;
            req.authMethod = 'no-supabase-fallback';
            await syncAuthUserStub(req.userId);
            return next();
        }
        req.userId = null;
        req.authMethod = 'anonymous';
        return next();
    }

    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) {
            req.userId = null;
            req.authMethod = 'anonymous';
            return next();
        }
        req.userId = data.user.id;
        req.authMethod = 'supabase-jwt';
        await syncAuthUserStub(req.userId);
        return next();
    } catch (err) {
        console.warn('[Auth] optionalAuth JWT validation failed:', err.message);
        req.userId = null;
        req.authMethod = 'anonymous';
        return next();
    }
};
