// @ts-check

/**
 * Whether a supabase.auth.getUser error means Supabase Auth could not answer, as opposed to refusing
 * the token. The guards (server/middleware/auth.js, bridgeAuth.js, mcp-server/sseUserAuth.js) then
 * answer 503 auth_unavailable ("try again"), never 401, which asks the learner to sign in again.
 *
 * auth-js (2.89) does not throw for these: getUser resolves with { error }.
 *   - AuthRetryableFetchError: the request failed (status 0: no connection, DNS, reset), a 502, 503
 *     or 504, or an OK answer whose body is not JSON;
 *   - AuthUnknownError (no status): another error answer whose body is not JSON, such as a gateway's
 *     or CDN's error page (Supabase Auth itself answers JSON);
 *   - AuthApiError with status 429 (rate limited) or 5xx.
 * Supabase Auth's verdicts on the token stay refusals: AuthApiError 400-499 (bad_jwt, user_not_found,
 * no_authorization) and AuthSessionMissingError (session_not_found). Errors are matched by name,
 * as mcp-server/oauthVerifier.js does, so no auth-js import is needed.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAuthUnavailable(error) {
    if (!error || typeof error !== 'object') return false;
    const { name, status } = /** @type {{ name?: unknown, status?: unknown }} */ (error);
    if (name === 'AuthRetryableFetchError' || name === 'AuthUnknownError') return true;
    return typeof status === 'number' && (status === 0 || status === 429 || status >= 500);
}
