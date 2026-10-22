/**
 * MCP user scoping — which learner a tool call or resource read acts for.
 *
 * resolveMcpUserId, in order:
 * 1. An SSE session opened with a learner's own Supabase JWT: that learner, whatever else the call
 *    carries.
 * 2. A turn token: the `rp_turn` tool argument, or an `X-Hermes-Session-Key: rp:turn:<token>` header
 *    on that request. Express mints it for each chat turn after verifying the learner's JWT
 *    (registerAgentTurn in server/services/hermesAgentService.js) and gives it to Hermes in
 *    `instructions`. It is a random capability, not a user id. A token-shaped value that is unknown
 *    or expired fails closed (in development without a database, where this process cannot see
 *    Express's in-memory bindings, it falls back to step 3, then PHASE1_USER_ID); a value that is
 *    not token-shaped (an LLM's guess such as 'current') counts as absent.
 * 3. The operator's own RISE_PATH_ACTIVE_SESSION_KEY (stdio, or a single-learner deployment).
 * 4. Outside strict auth only (development: bridge-token SSE sessions and stdio): the learner with a live
 *    agent_session_binding, only when no other learner started a chat turn within
 *    RECENT_TURN_WINDOW_MS; with two or more the call fails closed. Then PHASE1_USER_ID.
 * 5. Strict auth (production, RISEPATH_STRICT_AUTH=true or VITE_DEMO_MODE=false): session_binding_required. A bridge-token session (Hermes, or an external client
 *    holding the bridge token) acts for a learner only through a turn token.
 *
 * Never from an LLM-supplied user_id, and never from an `rp:user:<uuid>` key sent by a client: a
 * UUID is not a secret, so a bridge-token caller could name any learner with it.
 */
import { randomBytes } from 'node:crypto';
import { parseSessionKey } from './agentSessionStore.js';
import { getPool, syncAuthUserStub } from '../../server/db.js';
import { isStrictAuthMode } from '../../server/middleware/authPolicy.js';

async function finalizeScopedUser(userId) {
    if (userId) {
        await syncAuthUserStub(userId);
    }
    return { userId };
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
/** Lifetime of a per-turn binding (registerAgentTurn). */
export const TURN_TTL_MS = 10 * 60 * 1000;
/**
 * Development fallback (step 4): a learner counts as chatting for this long after their turn
 * started, longer than the 5-minute binding TTL, so a long turn still blocks the fallback for
 * others. Production never uses it: there a turn longer than TURN_TTL_MS fails closed.
 */
export const RECENT_TURN_WINDOW_MS = 15 * 60 * 1000;
/** The tool argument that carries the turn token. */
export const TURN_ARG = 'rp_turn';
export const TURN_KEY_PREFIX = 'rp:turn:';
const TURN_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

/** @type {Map<string, { userId: string, expiresAt: number, updatedAt?: number }>} */
const bindingMemory = new Map();

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

// Fail closed in strict auth (production, RISEPATH_STRICT_AUTH=true or VITE_DEMO_MODE=false), not
// only when NODE_ENV is production: a dev MCP pointed at a real database must never act as a learner.
function isProduction() {
    return isStrictAuthMode();
}

export function getPhase1UserId() {
    return process.env.PHASE1_USER_ID || '00000000-0000-0000-0000-000000000001';
}

/** Bridge-token SSE sessions authenticate as PHASE1; the learner comes from a turn token. */
export function isBridgePlaceholderUserId(userId) {
    return cleanString(userId) === getPhase1UserId();
}

/** Whether `value` has the shape of a turn token (registerAgentTurn). */
export function isTurnToken(value) {
    return typeof value === 'string' && TURN_TOKEN.test(value);
}

function getSessionContext(extra, sessions) {
    if (!extra?.sessionId || !sessions?.has(extra.sessionId)) return null;
    return sessions.get(extra.sessionId);
}

/** The turn token in an X-Hermes-Session-Key request header (SSE), or ''. Other keys are ignored. */
function turnTokenFromHeaders(headers) {
    const raw = headers?.['x-hermes-session-key'];
    const key = cleanString(Array.isArray(raw) ? raw[0] : raw);
    return key.startsWith(TURN_KEY_PREFIX) ? key.slice(TURN_KEY_PREFIX.length) : '';
}

/**
 * The call's turn token: the rp_turn argument, else the header's. A value that is not shaped like
 * a minted token (an LLM's guess such as 'current') is skipped as if absent.
 */
function pickTurnToken(turnToken, headers) {
    return [cleanString(turnToken), turnTokenFromHeaders(headers)].find(isTurnToken) || '';
}

/**
 * The learner a turn token (rp_turn argument or rp:turn header) is bound to, or null. No fallback:
 * the MCP HTTP rate limiter uses it to count a bridge session's calls per learner.
 * @param {{ turnToken?: unknown, headers?: Record<string, unknown> }} params
 * @returns {Promise<string | null>}
 */
export async function learnerForTurn({ turnToken, headers } = {}) {
    const turn = pickTurnToken(turnToken, headers);
    return turn ? getUserIdFromSessionBinding(`${TURN_KEY_PREFIX}${turn}`) : null;
}

/** Operator-set key (env): `rp:user:<uuid>` is trusted here, any other key must be bound. */
async function resolveFromOperatorKey(sessionKey) {
    const key = cleanString(sessionKey);
    if (!key) return null;

    const parsed = parseSessionKey(key);
    if (parsed) {
        return finalizeScopedUser(parsed);
    }

    const bound = await getUserIdFromSessionBinding(key);
    if (bound) {
        return finalizeScopedUser(bound);
    }

    return null;
}

export function getActiveSessionKeyFromEnv() {
    return cleanString(
        process.env.RISE_PATH_ACTIVE_SESSION_KEY
        || process.env.HERMES_ACTIVE_SESSION_KEY
        || process.env.X_HERMES_SESSION_KEY,
    );
}

function isExpired(expiresAt) {
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

/**
 * Bind a session key to a learner for ttlMs.
 * @returns {Promise<boolean>} true when bound: in this process's memory without a database, else
 *   written to agent_session_binding. false when the key or user id is missing, or the database
 *   write failed. The MCP server is another process and reads bindings from the database, so a
 *   caller must not start an agent turn on a false.
 */
export async function registerAgentSession(sessionKey, userId, { ttlMs = DEFAULT_TTL_MS } = {}) {
    const key = cleanString(sessionKey);
    const uid = cleanString(userId);
    if (!key || !uid) return false;

    const now = Date.now();
    const expiresAt = now + ttlMs;
    bindingMemory.set(key, { userId: uid, expiresAt, updatedAt: now });

    await syncAuthUserStub(uid);

    const pool = getPool();
    if (!pool) return true;

    try {
        await pool.query(
            `INSERT INTO agent_session_binding (session_key, user_id, expires_at, updated_at)
             VALUES ($1, $2, to_timestamp($3 / 1000.0), NOW())
             ON CONFLICT (session_key) DO UPDATE
             SET user_id = EXCLUDED.user_id,
                 expires_at = EXCLUDED.expires_at,
                 updated_at = NOW()`,
            [key, uid, expiresAt],
        );
        return true;
    } catch (err) {
        bindingMemory.delete(key);
        console.error('[agentSession] failed to persist session binding:', err?.message || err);
        return false;
    }
}

/**
 * Express, once per chat turn, after verifying the learner's JWT: bind a new random turn token to
 * the learner and return it. Hermes passes it back as the `rp_turn` argument of each tool call.
 * Put it in the system `instructions` (buildTurnInstruction), never in the learner's `input`.
 * @returns {Promise<string | null>} the token; null without a user id, or when the binding could
 *   not be written (registerAgentSession), so the caller must not contact Hermes
 */
export async function registerAgentTurn(userId, { ttlMs = TURN_TTL_MS } = {}) {
    const uid = cleanString(userId);
    if (!uid) return null;
    const token = randomBytes(24).toString('base64url');
    if (!(await registerAgentSession(`${TURN_KEY_PREFIX}${token}`, uid, { ttlMs }))) return null;
    await purgeOldTurnBindings();
    return token;
}

/** The instruction line that hands Hermes the turn token. */
export function buildTurnInstruction(token) {
    return `For every rise_path tool call in this turn, pass ${TURN_ARG}="${token}".`;
}

/** Turn bindings are one row per turn: drop those expired for a day (and expired ones in memory). */
async function purgeOldTurnBindings() {
    for (const [key, entry] of bindingMemory.entries()) {
        if (key.startsWith(TURN_KEY_PREFIX) && isExpired(entry.expiresAt)) bindingMemory.delete(key);
    }
    const pool = getPool();
    if (!pool) return;
    try {
        await pool.query(
            `DELETE FROM agent_session_binding
             WHERE session_key LIKE 'rp:turn:%' AND expires_at < NOW() - INTERVAL '1 day'`,
        );
    } catch (err) {
        console.warn('[agentSession] failed to purge old turn bindings:', err.message);
    }
}

async function getUserIdFromSessionBinding(sessionKey) {
    const key = cleanString(sessionKey);
    if (!key) return null;

    const cached = bindingMemory.get(key);
    if (cached && !isExpired(cached.expiresAt)) {
        return cached.userId;
    }
    bindingMemory.delete(key);

    const pool = getPool();
    if (!pool) return null;

    try {
        const { rows } = await pool.query(
            `SELECT user_id, EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_ms
             FROM agent_session_binding
             WHERE session_key = $1`,
            [key],
        );
        if (!rows.length) return null;

        const expiresAt = Number(rows[0].expires_ms);
        if (isExpired(expiresAt)) {
            await pool.query('DELETE FROM agent_session_binding WHERE session_key = $1', [key]);
            return null;
        }

        const userId = String(rows[0].user_id);
        bindingMemory.set(key, { userId, expiresAt });
        return userId;
    } catch {
        return null;
    }
}

/**
 * Development fallback (step 4): the one learner who started a chat turn within
 * RECENT_TURN_WINDOW_MS, if their binding is still live.
 * @returns {Promise<{ userId: string } | { ambiguous: true } | null>} null when nobody is chatting
 */
async function getSoleRecentLearner() {
    const pool = getPool();
    if (!pool) {
        const now = Date.now();
        /** @type {Map<string, boolean>} user id -> has a live binding */
        const recent = new Map();
        for (const [key, entry] of bindingMemory.entries()) {
            const live = !isExpired(entry.expiresAt);
            const startedAt = entry.updatedAt ?? entry.expiresAt - DEFAULT_TTL_MS;
            if (!live && startedAt <= now - RECENT_TURN_WINDOW_MS) {
                bindingMemory.delete(key);
                continue;
            }
            recent.set(entry.userId, recent.get(entry.userId) === true || live);
        }
        return soleLearner([...recent].map(([userId, live]) => ({ user_id: userId, live })));
    }

    try {
        const { rows } = await pool.query(
            `SELECT user_id, bool_or(expires_at > NOW()) AS live
             FROM agent_session_binding
             WHERE expires_at > NOW() OR updated_at > NOW() - $1::int * INTERVAL '1 millisecond'
             GROUP BY user_id
             LIMIT 2`,
            [RECENT_TURN_WINDOW_MS],
        );
        return soleLearner(rows);
    } catch {
        return null;
    }
}

/** @param {Array<{ user_id: unknown, live: unknown }>} rows one row per recent learner */
function soleLearner(rows) {
    if (rows.length === 0) return null;
    if (rows.length > 1) return { ambiguous: true };
    // The only recent learner, but their binding expired: their turn may still be running, and
    // nobody else is bound, so there is no one to act for.
    return rows[0].live === true ? { userId: String(rows[0].user_id) } : null;
}

const bindingRequired = (detail) => ({
    error: `MCP session binding required: ${detail}`,
    error_type: 'session_binding_required',
});

/**
 * Resolve the learner for an MCP tool call or resource read (order in the header comment).
 * @param {{ argsUserId?: unknown, extra?: any, sessions?: Map<string, any>, turnToken?: unknown }} params
 *   argsUserId is ignored (LLM-supplied); turnToken is the call's rp_turn argument
 * @returns {Promise<{ userId: string } | { error: string, error_type: 'session_binding_required' }>}
 */
export async function resolveMcpUserId({ argsUserId: _argsUserId, extra, sessions, turnToken } = {}) {
    const sessionCtx = getSessionContext(extra, sessions);

    if (sessionCtx?.userId && !isBridgePlaceholderUserId(sessionCtx.userId)) {
        return finalizeScopedUser(sessionCtx.userId);
    }

    const turn = pickTurnToken(turnToken, extra?.requestInfo?.headers);
    if (turn) {
        const bound = await getUserIdFromSessionBinding(`${TURN_KEY_PREFIX}${turn}`);
        if (bound) {
            return finalizeScopedUser(bound);
        }
        if (isProduction() || getPool()) {
            return bindingRequired(`${TURN_ARG} is unknown or expired (pass the ${TURN_ARG} value given for this turn)`);
        }
        // Development without a database: Express keeps the turn binding in its own memory, so
        // this process cannot check the token. Act as before turn tokens existed (the operator
        // key, else PHASE1, Express's dev learner), never as another chatting learner.
        return (await resolveFromOperatorKey(getActiveSessionKeyFromEnv())) ?? finalizeScopedUser(getPhase1UserId());
    }

    const fromEnv = await resolveFromOperatorKey(getActiveSessionKeyFromEnv());
    if (fromEnv?.userId) {
        return fromEnv;
    }

    if (!isProduction()) {
        const sole = await getSoleRecentLearner();
        if (sole && 'userId' in sole) {
            console.error(`[MCP] no ${TURN_ARG}: using the only chatting learner ${sole.userId.slice(0, 8)} (development only)`);
            return finalizeScopedUser(sole.userId);
        }
        if (sole?.ambiguous) {
            return bindingRequired(`several learners are chatting, so this call needs ${TURN_ARG}`);
        }
        return finalizeScopedUser(getPhase1UserId());
    }

    return bindingRequired(sessionCtx
        ? `bridge SSE calls need ${TURN_ARG} (or a learner's own JWT session)`
        : 'use SSE MCP with a JWT, pass rp_turn, or set RISE_PATH_ACTIVE_SESSION_KEY');
}

export function clearMcpUserScopeForTests() {
    bindingMemory.clear();
}
