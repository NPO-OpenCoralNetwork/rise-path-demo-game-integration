/**
 * MCP Policy Engine (Phase 11)
 *
 * Rate limiting per tool per session + structured audit logging.
 * Reads limits from tool-registry.json.
 */
import { toolMeta } from './profileFilter.js';

// In-memory rate limit counters: Map<"sessionId:toolName", count>
const callCounts = new Map();

/**
 * Check rate limit policy for a tool call.
 *
 * @param {string} toolName
 * @param {string} sessionId - Session identifier (or 'stdio' for stdio mode)
 * @returns {{ allowed: boolean, audit: boolean, reason?: string, message?: string }}
 */
export function checkPolicy(toolName, sessionId = 'stdio') {
    const meta = toolMeta.get(toolName);
    if (!meta) return { allowed: true, audit: false };

    // Rate limiting
    if (meta.max_calls_per_session) {
        const key = `${sessionId}:${toolName}`;
        const count = callCounts.get(key) || 0;
        if (count >= meta.max_calls_per_session) {
            return {
                allowed: false,
                audit: true,
                reason: 'rate_limit_exceeded',
                message: `${toolName} は1セッションで最大${meta.max_calls_per_session}回まで実行可能です`,
            };
        }
        callCounts.set(key, count + 1);
    }

    return { allowed: true, audit: meta.audit || false };
}

/**
 * Emit structured audit log for write operations.
 *
 * @param {string} toolName
 * @param {string} userId
 * @param {object} args - Tool arguments (keys only logged, not values)
 * @param {object} result - Tool result
 */
export function auditLog(toolName, userId, args, result) {
    const entry = {
        type: 'mcp_audit',
        timestamp: new Date().toISOString(),
        tool: toolName,
        user_id: userId?.slice(0, 8) + '...',
        args_keys: Object.keys(args || {}),
        success: !result?.error && !result?.error_type,
        risk: toolMeta.get(toolName)?.risk || 'unknown',
    };
    console.error(`[AUDIT] ${JSON.stringify(entry)}`);
}

/**
 * Clear rate limit counters for a session (call on disconnect).
 */
export function clearSession(sessionId) {
    for (const key of callCounts.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
            callCounts.delete(key);
        }
    }
}
