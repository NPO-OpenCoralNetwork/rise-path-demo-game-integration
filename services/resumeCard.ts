// GET /api/v2/curricula/:id/resume answers { ok: true, ...card }: the card's fields sit at the top
// level (server/routes/chatgptCurriculum.js). No imports, so node:test can check it.

const RESUME_CARD_TYPES = new Set(['fresh_start', 'continue', 'gentle_return', 'recovery']);

/** The resume card in a resume answer, or null when the answer holds none. */
export const parseResumeCard = <T extends { type: string } = { type: string; message: string }>(payload: unknown): T | null => {
    if (!payload || typeof payload !== 'object') return null;
    const { ok, ...card } = payload as Record<string, unknown>;
    if (ok !== true || typeof card.type !== 'string' || !RESUME_CARD_TYPES.has(card.type)) return null;
    return card as unknown as T;
};
