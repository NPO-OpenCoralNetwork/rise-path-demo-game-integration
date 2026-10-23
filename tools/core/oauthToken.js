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
