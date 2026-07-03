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

async function resolveFromSessionKey(sessionKey) {
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

/**
 * Resolve the authenticated MCP user for tools/resources.
 * Never trusts LLM-supplied argsUserId outside SSE JWT sessions.
 */
export async function resolveMcpUserId({ argsUserId: _argsUserId, extra, sessions }) {
    const sessionCtx = getSessionContext(extra, sessions);

    if (sessionCtx?.userId && !isBridgePlaceholderUserId(sessionCtx.userId)) {
        return finalizeScopedUser(sessionCtx.userId);
    }

    if (sessionCtx) {
        const sessionKey = cleanString(sessionCtx.activeSessionKey) || getActiveSessionKeyFromEnv();
        const fromKey = await resolveFromSessionKey(sessionKey);
        if (fromKey?.userId) {
            return fromKey;
        }

        const latest = await getLatestActiveSessionBinding();
        if (latest) {
            if (!isProduction()) {
                console.error(`[MCP] bridge fallback: latest agent session binding user ${latest.slice(0, 8)}`);
            }
            return finalizeScopedUser(latest);
        }

        if (!isProduction()) {
            return finalizeScopedUser(getPhase1UserId());
        }

        return {
            error: 'MCP session binding required (Hermes bridge SSE needs agent_session_binding or X-Hermes-Session-Key)',
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