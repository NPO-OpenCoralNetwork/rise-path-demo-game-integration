// @ts-check
/**
 * Tells a learner's own Supabase session token from a token Supabase's OAuth 2.1 server issued to a
 * connected agent (doc/brushup-2026/ai-access-plan.ja.md §5, Phase 1).
 *
 * Both are signed by the same project keys, and supabase.auth.getUser accepts both. An agent token
 * carries `client_id`, and our Custom Access Token Hook (deploy/supabase/custom_access_token_hook.sql)
 * sets its `aud` to the canonical MCP URL. The app API (server/middleware/auth.js, bridgeAuth.js)
 * and the SSE MCP check refuse such tokens; only the remote MCP endpoint (mcp-server/oauthVerifier.js)
 * takes them.
 *
 * This only decodes the payload; it never verifies a signature. Refusing on an unverified payload
 * is safe: a forged client_id or aud can only make a token be refused, never accepted.
 */

/**
 * @param {string} segment base64url
 * @returns {Record<string, unknown> | null}
 */
function decodeSegment(segment) {
    try {
        const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

/** @param {unknown} aud */
const isAppAudience = (aud) => aud === 'authenticated'
    || (Array.isArray(aud) && aud.length === 1 && aud[0] === 'authenticated');

/**
 * True when the token must not be used as an app session: its payload carries a client_id (an
 * OAuth client's token) or its aud is anything other than 'authenticated' (missing included). A
 * string with three dot-separated parts whose payload does not decode also counts (fail closed).
 * A value that is not JWT-shaped at all (no three parts) answers false: the auth provider then
 * decides, and it accepts only JWTs.
 * @param {unknown} token
 * @returns {boolean}
 */
export function isOAuthClientToken(token) {
    if (typeof token !== 'string') return false;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return false;
    const payload = decodeSegment(parts[1]);
    if (!payload) return true;
    if (payload.client_id !== undefined && payload.client_id !== null) return true;
    return !isAppAudience(payload.aud);
}

/**
 * The payload of a token, or null when it is not JWT-shaped or does not decode. Like the check
 * above it never verifies a signature: call it only on a token that was already verified
 * (supabase.auth.getUser for the app, getClaims for mcp-public), and only to read its times.
 * @param {unknown} token
 * @returns {Record<string, unknown> | null}
 */
export function decodeTokenClaims(token) {
    if (typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    return decodeSegment(parts[1]);
}

/**
 * The newest numeric `amr[].timestamp` among object entries that `accept` takes, else null.
 * String entries (RFC 8176 style) and non-numeric or non-finite timestamps are ignored.
 * @param {unknown} claims
 * @param {(entry: Record<string, unknown>) => boolean} accept
 * @returns {number | null}
 */
function newestAmrTime(claims, accept) {
    const amr = claims && typeof claims === 'object' ? /** @type {Record<string, unknown>} */ (claims).amr : undefined;
    if (!Array.isArray(amr)) return null;
    /** @type {number | null} */
    let newest = null;
    for (const entry of amr) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !accept(entry)) continue;
        const time = entry.timestamp;
        if (typeof time === 'number' && Number.isFinite(time) && (newest === null || time > newest)) newest = time;
    }
    return newest;
}

/**
 * When the token's session signed in (epoch seconds): the newest `amr` timestamp. Supabase keeps
 * it across refreshes, so it tells a session started before an account deletion from one started
 * after it (tools/core/accountDeletions.js). Deliberately no `iat` fallback: `iat` moves on every
 * refresh, so an old session would look new. null when the token has no usable `amr`.
 * @param {unknown} claims decoded payload (decodeTokenClaims) or verified claims (getClaims)
 * @returns {number | null}
 */
export const sessionAuthTime = (claims) => newestAmrTime(claims, () => true);

/**
 * When the session last proved the password (epoch seconds): the newest `amr` entry with
 * method 'password', else null. Account deletion asks for a recent one (re-authentication).
 * @param {unknown} claims
 * @returns {number | null}
 */
export const passwordAuthTime = (claims) => newestAmrTime(claims, (entry) => entry.method === 'password');
