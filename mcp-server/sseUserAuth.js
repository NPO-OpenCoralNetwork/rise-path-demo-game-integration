// @ts-check
/**
 * Who an SSE MCP request (GET /sse and every POST /messages/:sessionId of mcp-server/index.js
 * --sse) acts for. Priority, as before this was extracted:
 *   1. x-nexloom-bridge-token header equal to the bridge token → PHASE1 (Hermes bridge)
 *   2. Authorization: Bearer <bridge token> → PHASE1
 *   3. a connected agent's OAuth token (tools/core/oauthToken.js isOAuthClientToken) → null: it
 *      belongs to the remote endpoint (mcp-server/oauthVerifier.js) only
 *   4. a learner's Supabase session token → that learner, unless it is a session of a deleted Rise
 *      Path account (tools/core/accountDeletions.js readAccountState, mayReopen false: only the app
 *      re-opens an account) → null; a database error → null (fail closed). Neither falls back to
 *      the dev user.
 *   5. development only (server/middleware/authPolicy.js allowDevAuthFallback) → PHASE1
 *   otherwise null, which the caller answers with 401.
 * Each message re-checks the token, so an open SSE session of an account deleted meanwhile is
 * refused at its next call.
 */

/**
 * @typedef {{ headers: Record<string, string | string[] | undefined>, authMethod?: string }} SseRequest
 * @typedef {{ state: 'ok', generation: number | null } | { state: 'deleted' }} AccountState
 */

/**
 * @param {{
 *   getSupabase: () => { auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null } | null, error: unknown }> } } | null,
 *   getPool: () => any,
 *   readAccountState: (pool: any, userId: string, authTime: number | null, options?: { mayReopen?: boolean }) => Promise<AccountState>,
 *   decodeTokenClaims: (token: unknown) => Record<string, unknown> | null,
 *   sessionAuthTime: (claims: unknown) => number | null,
 *   isOAuthClientToken: (token: unknown) => boolean,
 *   extractBearerToken: (req: any) => string | null,
 *   bridgeToken: () => string | undefined,
 *   allowDevFallback: () => boolean,
 *   phase1UserId: string,
 *   logger?: Pick<Console, 'error'>,
 * }} deps
 * @returns {(req: SseRequest) => Promise<string | null>}
 */
export function createSseUserResolver({
    getSupabase,
    getPool,
    readAccountState,
    decodeTokenClaims,
    sessionAuthTime,
    isOAuthClientToken,
    extractBearerToken,
    bridgeToken,
    allowDevFallback,
    phase1UserId,
    logger = console,
}) {
    return async function resolveUserId(req) {
        const token = extractBearerToken(req);
        const bridge = (bridgeToken() || '').trim();

        // 1. x-nexloom-bridge-token header (dedicated bridge header)
        if (bridge) {
            const header = req.headers['x-nexloom-bridge-token'];
            const provided = typeof header === 'string' ? header.trim() : '';
            if (provided && provided === bridge) {
                req.authMethod = 'bridge-header';
                return phase1UserId; // Bridge uses shared user
            }
        }

        // 2. Bearer token — check if it's the bridge token first
        if (token && bridge && token === bridge) {
            req.authMethod = 'bridge-bearer';
            return phase1UserId;
        }

        // 3. A connected agent's OAuth token is never an SSE session.
        if (token && isOAuthClientToken(token)) {
            req.authMethod = 'oauth-client-refused';
            return null;
        }

        // 4. A learner's Supabase session, unless its Rise Path account was deleted.
        if (token) {
            const supabase = getSupabase();
            if (supabase) {
                /** @type {{ id: string } | null} */
                let user = null;
                try {
                    const { data, error } = await supabase.auth.getUser(token);
                    if (!error && data?.user) user = data.user;
                } catch { /* fall through */ }
                if (user) {
                    try {
                        const account = await readAccountState(
                            getPool(),
                            user.id,
                            sessionAuthTime(decodeTokenClaims(token)),
                            { mayReopen: false },
                        );
                        if (account.state === 'deleted') {
                            req.authMethod = 'account-deleted';
                            return null;
                        }
                    } catch (error) {
                        logger.error('[MCP] account state check failed:', /** @type {any} */ (error)?.message || error);
                        req.authMethod = 'account-check-failed';
                        return null;
                    }
                    req.authMethod = 'supabase-jwt';
                    return user.id;
                }
            }
        }

        // 5. Dev mode fallback (disabled in strict auth — see server/middleware/authPolicy.js)
        if (allowDevFallback()) {
            req.authMethod = 'dev-fallback';
            return phase1UserId;
        }

        return null;
    };
}
