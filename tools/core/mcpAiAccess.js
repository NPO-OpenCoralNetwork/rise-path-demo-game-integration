/**
 * Adults-only rules on the MCP server (Phase 0.5 minor safeguards, Phase 1 remote endpoint;
 * doc/brushup-2026/ai-access-plan.ja.md §4–5).
 *
 * aiAccessRefusal(userId) is the rule: the learner's AI access (server/safety/access.js) must be
 * 'ready' with the 'adult' audience, else a tool error ({ error, error_type, message, settings_url? }).
 * A lookup that fails refuses (ai_access_unavailable): this check fails closed.
 *
 * - Outside-AI course drafts (adultDraftRefusal): save-curriculum-draft and lesson-upsert-draft
 *   (database store) for a learner's own session, the same rule as the learner JWT path of
 *   server/routes/chatgptCurriculum.js (aiAccessGate({ adultsOnly: true })). The learner is the one
 *   whose JWT opened the SSE session, or the user of a verified OAuth token (remote endpoint).
 *   Bridge-token sessions (Hermes, the operator) and stdio are the operator path and are not
 *   checked here.
 * - The remote endpoint (mcp-server/remote.js) runs aiAccessRefusal on every tools/call,
 *   resources/read and prompts/get with remoteAccessEnv(): production rules whatever NODE_ENV says
 *   (no AI_ACCESS_DEV_AUDIENCE, no "no database means adult").
 */
import { AiAccessUnavailableError, resolveAiAccess } from '../../server/safety/access.js';
import { isBridgePlaceholderUserId, oauthUserId } from './mcpUserScope.js';

/** Learner-facing text per refusal, in English and Japanese. */
export const ACCESS_MESSAGES = Object.freeze({
    age_required: {
        en: 'Record your birth year and month in Rise Path to use the AI features.',
        jp: 'AI 機能を使うには、Rise Path で生まれた年と月を登録してください。',
    },
    adults_only: {
        en: 'Connecting your own AI agent to Rise Path is for people aged 18 and over.',
        jp: '自分の AI エージェントを Rise Path につなぐ機能は、18 歳以上の方が使えます。',
    },
    ai_paused_safety: {
        en: 'The AI features are paused for today. They start again at 00:00 Japan time (JST).',
        jp: '今日は AI 機能を一時停止しています。日本時間の 0 時に再開します。',
    },
    ai_access_unavailable: {
        en: 'AI access cannot be checked right now. Please try again later.',
        jp: '今は AI の利用設定を確認できません。しばらくしてからもう一度お試しください。',
    },
});

/** The AI access settings page, from APP_PUBLIC_URL (an http(s) origin), or null. */
export function aiAccessSettingsUrl(env = process.env) {
    const raw = env.APP_PUBLIC_URL?.trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return new URL('/settings/ai-access', url.origin).href;
    } catch {
        return null;
    }
}

/**
 * The tool error for one refusal: `error` carries both languages so any client shows something
 * readable; `message` keeps them apart; `settings_url` when APP_PUBLIC_URL is set.
 * @param {keyof typeof ACCESS_MESSAGES} errorType
 * @param {{ settingsUrl?: string | null }} [options]
 */
export function accessRefusal(errorType, { settingsUrl = null } = {}) {
    const { en, jp } = ACCESS_MESSAGES[errorType];
    const link = settingsUrl ? ` ${settingsUrl}` : '';
    return {
        error: `${en}${link}\n${jp}${link}`,
        error_type: errorType,
        message: { en, jp },
        ...(settingsUrl ? { settings_url: settingsUrl } : {}),
    };
}

/**
 * The environment resolveAiAccess reads on the remote endpoint: production rules always, so a
 * test or misconfigured deployment never answers 'adult' without a database.
 * @param {Record<string, string | undefined>} [env]
 */
export function remoteAccessEnv(env = process.env) {
    const { AI_ACCESS_DEV_AUDIENCE: _ignored, ...rest } = env;
    return { ...rest, NODE_ENV: 'production' };
}

/**
 * null when `userId` may use AI features as a ready adult, else a tool error.
 * @param {string} userId
 * @param {{ env?: Record<string, string | undefined>, settingsUrl?: string | null }} [options]
 */
export async function aiAccessRefusal(userId, { env = process.env, settingsUrl = null } = {}) {
    const refuse = (errorType) => accessRefusal(errorType, { settingsUrl });
    if (!userId) return refuse('ai_access_unavailable');
    let access;
    try {
        access = await resolveAiAccess(userId, { env });
    } catch (error) {
        const cause = error instanceof AiAccessUnavailableError ? error.cause ?? error : error;
        console.error('[MCP] AI access unavailable; refused:', cause?.message ?? cause);
        return refuse('ai_access_unavailable');
    }
    if (access?.status === 'needs_age') return refuse('age_required');
    if (access?.audience !== 'adult') return refuse('adults_only');
    if (access.status === 'paused') return refuse('ai_paused_safety');
    if (access.status !== 'ready') return refuse('ai_access_unavailable');
    return null;
}

/**
 * The learner whose own credential this call carries: the user of a verified OAuth token (remote
 * endpoint), else the learner whose JWT opened this SSE session; null for the bridge token, the
 * dev fallback and stdio.
 */
export function learnerJwtSessionUser(extra, sessions) {
    const oauthUser = oauthUserId(extra);
    if (oauthUser) return oauthUser;
    const ctx = extra?.sessionId && sessions?.get?.(extra.sessionId);
    const userId = ctx?.userId;
    return userId && !isBridgePlaceholderUserId(userId) ? String(userId) : null;
}

/**
 * null when the call may write an outside-AI draft, else a tool error ({ error, error_type }).
 * A call that carries authInfo without a valid user id is refused (it never counts as the
 * operator path).
 * @param {{ extra?: any, sessions?: Map<string, any>, env?: Record<string, string | undefined> }} params
 */
export async function adultDraftRefusal({ extra, sessions, env = process.env } = {}) {
    const userId = learnerJwtSessionUser(extra, sessions);
    if (!userId) return extra?.authInfo ? accessRefusal('ai_access_unavailable') : null;
    return aiAccessRefusal(userId, { env: extra?.authInfo ? remoteAccessEnv(env) : env });
}
