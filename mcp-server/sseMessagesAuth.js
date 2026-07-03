/**
 * Auth gate for POST /messages/:sessionId (SSE MCP message relay).
 * @returns {null | { status: number, error: string }}
 */
export function verifyMessagesSessionAuth(resolvedUserId, sessionUserId) {
    if (!resolvedUserId) {
        return { status: 401, error: 'Authentication required' };
    }
    if (resolvedUserId !== sessionUserId) {
        return { status: 403, error: 'Session owner mismatch' };
    }
    return null;
}