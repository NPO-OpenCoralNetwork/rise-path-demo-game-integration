/**
 * HTTP rate limit for POST /messages/:sessionId (SSE MCP), per minute.
 *
 * A learner's own JWT session counts per session. The bridge session (Hermes, authenticated with
 * the bridge token, so its user is the PHASE1 placeholder) carries every learner's calls, so a
 * call there counts for the learner its turn token is bound to: the rp_turn argument of a
 * tools/call, else an `X-Hermes-Session-Key: rp:turn:<token>` header (tools/core/mcpUserScope.js
 * learnerForTurn). One learner using up their count does not block the others. Bridge calls
 * without a live turn token (initialize, tools/list, a call that fails closed anyway) share the
 * session's own count.
 *
 * The request body must already be parsed (express.json) so the key can read rp_turn.
 */
import rateLimit from 'express-rate-limit';
import { isBridgePlaceholderUserId, learnerForTurn, TURN_ARG } from '../tools/core/mcpUserScope.js';

/** The rp_turn argument of a JSON-RPC tools/call body, or undefined. */
function turnArgument(body) {
    return body?.method === 'tools/call' ? body.params?.arguments?.[TURN_ARG] : undefined;
}

/**
 * The limiter key of one POST /messages/:sessionId request.
 * @param {import('express').Request} req
 * @param {Map<string, { userId: string }>} sessions the SSE sessions (mcp-server/index.js)
 * @returns {Promise<string>} `learner:<uuid>` for a bridge call with a live turn token, else
 *   `session:<id>`
 */
export async function messageRateLimitKey(req, sessions) {
    const sessionId = String(req.params?.sessionId || '');
    const session = sessions.get(sessionId);
    if (session && isBridgePlaceholderUserId(session.userId)) {
        const learner = await learnerForTurn({ turnToken: turnArgument(req.body), headers: req.headers });
        if (learner) return `learner:${learner}`;
    }
    return `session:${sessionId}`;
}

/**
 * @param {{ sessions: Map<string, { userId: string }>, limit: number, windowMs?: number }} options
 * @returns {import('express').RequestHandler}
 */
export function createMessageRateLimiter({ sessions, limit, windowMs = 60_000 }) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => messageRateLimitKey(req, sessions),
        message: { error: `MCP rate limit exceeded. Max ${limit} tool calls/min.` },
        validate: { keyGeneratorIpFallback: false },
    });
}
