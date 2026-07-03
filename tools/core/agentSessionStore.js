/**
 * Agent chat session consent — Phase 16-6 privacy enforcement.
 * Express proxy writes; MCP tools read (works across stdio subprocess boundary).
 */
import { getPool } from '../../server/db.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const memory = new Map();

export function parseSessionKey(sessionKey) {
    const match = /^rp:user:([0-9a-f-]{36})$/i.exec(cleanString(sessionKey));
    return match ? match[1] : null;
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isExpired(entry) {
    return !entry || entry.expiresAt <= Date.now();
}

function normalizeEntry(includeDiaryExcerpts, ttlMs = DEFAULT_TTL_MS) {
    return {
        includeDiaryExcerpts: includeDiaryExcerpts === true,
        expiresAt: Date.now() + ttlMs,
    };
}

export async function setAgentChatConsent(userId, { includeDiaryExcerpts = false, ttlMs = DEFAULT_TTL_MS } = {}) {
    const uid = cleanString(userId);
    if (!uid) return;

    const entry = normalizeEntry(includeDiaryExcerpts, ttlMs);
    memory.set(uid, entry);

    const pool = getPool();
    if (!pool) return;

    try {
        await pool.query(
            `INSERT INTO agent_chat_consent (user_id, include_diary_excerpts, expires_at, updated_at)
             VALUES ($1, $2, to_timestamp($3 / 1000.0), NOW())
             ON CONFLICT (user_id) DO UPDATE
             SET include_diary_excerpts = EXCLUDED.include_diary_excerpts,
                 expires_at = EXCLUDED.expires_at,
                 updated_at = NOW()`,
            [uid, entry.includeDiaryExcerpts, entry.expiresAt],
        );
    } catch (err) {
        console.warn('[agentSession] failed to persist diary consent:', err.message);
    }
}

export async function getAgentChatConsent(userId) {
    const uid = cleanString(userId);
    if (!uid) return false;

    const cached = memory.get(uid);
    if (!isExpired(cached)) {
        return cached.includeDiaryExcerpts === true;
    }
    memory.delete(uid);

    const pool = getPool();
    if (!pool) return false;

    try {
        const { rows } = await pool.query(
            `SELECT include_diary_excerpts, EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_ms
             FROM agent_chat_consent
             WHERE user_id = $1`,
            [uid],
        );
        if (!rows.length) return false;

        const expiresAt = Number(rows[0].expires_ms);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            await pool.query('DELETE FROM agent_chat_consent WHERE user_id = $1', [uid]);
            return false;
        }

        const includeDiaryExcerpts = rows[0].include_diary_excerpts === true;
        memory.set(uid, { includeDiaryExcerpts, expiresAt });
        return includeDiaryExcerpts;
    } catch {
        return false;
    }
}

export function clearAgentChatConsentForTests() {
    memory.clear();
}

export { registerAgentSession } from './mcpUserScope.js';