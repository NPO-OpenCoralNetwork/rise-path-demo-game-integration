/**
 * MCP user scoping — session-bound userId resolution (tools + resources).
 */
import { parseSessionKey } from './agentSessionStore.js';
import { getPool, syncAuthUserStub } from '../../server/db.js';

async function finalizeScopedUser(userId) {
    if (userId) {
        await syncAuthUserStub(userId);
    }
    return { userId };
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const bindingMemory = new Map();

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

export function getPhase1UserId() {
    return process.env.PHASE1_USER_ID || '00000000-0000-0000-0000-000000000001';
}

/** Bridge-token SSE sessions authenticate as PHASE1; real user comes from agent_session_binding. */
export function isBridgePlaceholderUserId(userId) {
    return cleanString(userId) === getPhase1UserId();
}

function getSessionContext(extra, sessions) {
    if (!extra?.sessionId || !sessions?.has(extra.sessionId)) return null;
    return sessions.get(extra.sessionId);
}

/**
 * X-Hermes-Session-Key of the POST /messages request that carried this call. The MCP SDK hands
 * that request's headers to the handler (extra.requestInfo), and the SSE server only passes a POST
 * to the SDK after its auth check. Reading it per call keeps concurrent chats on one shared SSE
 * connection apart; it is never stored on the session.
 */
function getRequestSessionKey(extra) {
    const value = extra?.requestInfo?.headers?.['x-hermes-session-key'];
    return cleanString(Array.isArray(value) ? value[0] : value);
}

/**
 * Single-tenant opt-in (RISE_PATH_MCP_LATEST_BINDING_FALLBACK=1|true) for production stacks whose
 * Hermes cannot send a session key: a bridge call without one then acts as the user of the most
 * recent agent_session_binding. With more than one user that can be someone else's data.
 */
function isLatestBindingFallbackEnabled() {
    const flag = cleanString(process.env.RISE_PATH_MCP_LATEST_BINDING_FALLBACK).toLowerCase();
    return flag === '1' || flag === 'true';
}

/**
 * @param {string} sessionKey
 * @param {{ requireBinding?: boolean }} [options] requireBinding: only a key Express registered in
 *   agent_session_binding counts (production SSE); otherwise an `rp:user:<uuid>` key names its user.
 */
async function resolveFromSessionKey(sessionKey, { requireBinding = false } = {}) {
    const key = cleanString(sessionKey);
    if (!key) return null;

    if (!requireBinding) {
        const parsed = parseSessionKey(key);
        if (parsed) {
            return finalizeScopedUser(parsed);
        }
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

export async function registerAgentSession(sessionKey, userId, { ttlMs = DEFAULT_TTL_MS } = {}) {
    const key = cleanString(sessionKey);
    const uid = cleanString(userId);
    if (!key || !uid) return;

    const expiresAt = Date.now() + ttlMs;
    bindingMemory.set(key, { userId: uid, expiresAt });

    await syncAuthUserStub(uid);

    const pool = getPool();
    if (!pool) return;

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
    } catch (err) {
        console.warn('[agentSession] failed to persist session binding:', err.message);
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
            // Only while still expired: the API may have just re-registered the same key.
            await pool.query('DELETE FROM agent_session_binding WHERE session_key = $1 AND expires_at <= NOW()', [key]);
            return null;
        }

        const userId = String(rows[0].user_id);
        bindingMemory.set(key, { userId, expiresAt });
        return userId;
    } catch {
        return null;
    }
}

async function getLatestActiveSessionBinding() {
    const pool = getPool();
    if (!pool) {
        let latest = null;
        for (const [key, entry] of bindingMemory.entries()) {
            if (isExpired(entry.expiresAt)) {
                bindingMemory.delete(key);
                continue;
            }
            if (!latest || entry.expiresAt > latest.expiresAt) {
                latest = entry;
            }
        }
        return latest?.userId ?? null;
    }

    try {
        const { rows } = await pool.query(
            `SELECT user_id, EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_ms
             FROM agent_session_binding
             WHERE expires_at > NOW()
             ORDER BY updated_at DESC
             LIMIT 1`,
        );
        if (!rows.length) return null;
        return String(rows[0].user_id);
    } catch {
        return null;
    }
}

// One resolution per call: the policy audit resolves again after the handler, and must record the
// user the handler acted as (bindings can change in between).
const resolvedPerCall = new WeakMap();

/**
 * Resolve the authenticated MCP user for tools/resources.
 * Never trusts LLM-supplied argsUserId outside SSE JWT sessions.
 */
export function resolveMcpUserId({ argsUserId: _argsUserId, extra, sessions }) {
    const memoizable = extra !== null && typeof extra === 'object';
    if (memoizable && resolvedPerCall.has(extra)) return resolvedPerCall.get(extra);
    const resolution = resolveUncached({ extra, sessions });
    if (memoizable) resolvedPerCall.set(extra, resolution);
    return resolution;
}

async function resolveUncached({ extra, sessions }) {
    const sessionCtx = getSessionContext(extra, sessions);

    // An SSE call whose session is already gone (disconnect) must not fall through to stdio rules.
    if (extra?.sessionId && !sessionCtx) {
        return {
            error: 'MCP session not found (reconnect to the SSE endpoint)',
            error_type: 'session_binding_required',
        };
    }

    // Bridge sessions are marked by the SSE server; the placeholder check covers older entries.
    const bridgeSession = Boolean(sessionCtx && (sessionCtx.bridge === true || isBridgePlaceholderUserId(sessionCtx.userId)));
    if (sessionCtx?.userId && !bridgeSession) {
        return finalizeScopedUser(sessionCtx.userId);
    }

    if (sessionCtx) {
        // Bridge SSE session: one connection may serve many chats. Production trusts only the key
        // sent with this request and registered by Express; the process-wide env key is a dev aid.
        const production = isProduction();
        const sessionKey = getRequestSessionKey(extra) || (production ? '' : getActiveSessionKeyFromEnv());
        const fromKey = await resolveFromSessionKey(sessionKey, { requireBinding: production });
        if (fromKey?.userId) {
            return fromKey;
        }

        // A call that named its user (a key) and could not be resolved never becomes someone else.
        if (!sessionKey && (!production || isLatestBindingFallbackEnabled())) {
            const latest = await getLatestActiveSessionBinding();
            if (latest) {
                console.error(`[MCP] bridge fallback: latest agent session binding user ${latest.slice(0, 8)}`);
                return finalizeScopedUser(latest);
            }
        }

        if (!production) {
            return finalizeScopedUser(getPhase1UserId());
        }

        return {
            error: 'MCP session binding required (send X-Hermes-Session-Key registered by the API, or set RISE_PATH_MCP_LATEST_BINDING_FALLBACK=1 on a single-user stack)',
            error_type: 'session_binding_required',
        };
    }

    const envKey = getActiveSessionKeyFromEnv();
    const fromEnv = await resolveFromSessionKey(envKey);
    if (fromEnv?.userId) {
        return fromEnv;
    }

    if (!isProduction()) {
        const latest = await getLatestActiveSessionBinding();
        if (latest) {
            console.error(`[MCP] dev fallback: using latest agent session binding for user ${latest.slice(0, 8)}`);
            return finalizeScopedUser(latest);
        }
        return finalizeScopedUser(getPhase1UserId());
    }

    return {
        error: 'MCP session binding required (use SSE MCP with JWT or set RISE_PATH_ACTIVE_SESSION_KEY)',
        error_type: 'session_binding_required',
    };
}

export function clearMcpUserScopeForTests() {
    bindingMemory.clear();
}