/**
 * Adults-only rule for outside-AI course drafts on the MCP server (Phase 0.5 minor safeguards;
 * the same rule as the learner JWT path of server/routes/chatgptCurriculum.js, which uses
 * aiAccessGate({ adultsOnly: true })).
 *
 * A session opened with a learner's own Supabase JWT acts as that learner (mcpUserScope.js step 1),
 * so save-curriculum-draft and lesson-upsert-draft (database store) need the learner's AI access to
 * be ready and adult. Bridge-token sessions (Hermes, the operator) and stdio are the operator path
 * and are not checked here.
 */
import { AiAccessUnavailableError, resolveAiAccess } from '../../server/safety/access.js';
import { isBridgePlaceholderUserId } from './mcpUserScope.js';

const MESSAGES = Object.freeze({
    age_required: 'Record your birth year and month to use the AI features.',
    adults_only: 'This AI feature is for people aged 18 and over.',
    ai_paused_safety: 'The AI features are paused for today. They start again at 00:00 Japan time (JST).',
    ai_access_unavailable: 'AI access cannot be checked right now. Please try again later.',
});

const refuse = (errorType) => ({ error: MESSAGES[errorType], error_type: errorType });

/** The learner whose own JWT opened this SSE session, or null (bridge token, dev fallback, stdio). */
export function learnerJwtSessionUser(extra, sessions) {
    const ctx = extra?.sessionId && sessions?.get?.(extra.sessionId);
    const userId = ctx?.userId;
    return userId && !isBridgePlaceholderUserId(userId) ? String(userId) : null;
}

/**
 * null when the call may write an outside-AI draft, else a tool error ({ error, error_type }).
 * @param {{ extra?: any, sessions?: Map<string, any>, env?: Record<string, string | undefined> }} params
 */
export async function adultDraftRefusal({ extra, sessions, env = process.env } = {}) {
    const userId = learnerJwtSessionUser(extra, sessions);
    if (!userId) return null;

    let access;
    try {
        access = await resolveAiAccess(userId, { env });
    } catch (error) {
        const cause = error instanceof AiAccessUnavailableError ? error.cause ?? error : error;
        console.error('[MCP] AI access unavailable; outside-AI draft refused:', cause?.message ?? cause);
        return refuse('ai_access_unavailable');
    }
    if (access.status === 'needs_age') return refuse('age_required');
    if (access.audience !== 'adult') return refuse('adults_only');
    if (access.status === 'paused') return refuse('ai_paused_safety');
    if (access.status !== 'ready') return refuse('ai_access_unavailable');
    return null;
}
