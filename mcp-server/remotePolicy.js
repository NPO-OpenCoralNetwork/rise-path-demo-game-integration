/**
 * Per-call policy of the remote MCP endpoint (mcp-server/remote.js, createMcpServer's `remote`):
 *
 * - gate(extra): the user of the verified access token (tools/core/mcpUserScope.js step 0) when
 *   they accepted the current terms (only with LEGAL_TERMS_REQUIRED on, Phase 8: else a tool error
 *   terms_required or legal_unavailable linking to <APP_PUBLIC_URL>/, tools/core/legalAcceptance.js;
 *   checked first) and their AI access is 'ready' and 'adult' (tools/core/mcpAiAccess.js, production rules always),
 *   else a tool error: age_required | adults_only | ai_paused_safety | ai_access_unavailable, in
 *   English and Japanese, linking to <APP_PUBLIC_URL>/settings/ai-access. Runs on every tools/call,
 *   resources/read and prompts/get, not only at consent: Supabase approves a known client again
 *   without showing our consent page. initialize and the list methods are not gated.
 * - charge(userId, toolName): the daily caps (server/middleware/dailyCaps.js): 'mcp' for every
 *   tools/call, plus 'mcp_write' for the write tools. A refusal is a tool error
 *   (daily_limit_reached); the slots of a call refused by its second kind are given back.
 *   course-quiz-check is charged 'mcp' only: it writes, but the reader's attempt rules bound its
 *   writes (at most two graded submissions per question), and a learner answering a lesson
 *   should not run out of the write cap.
 *   Reviews (Phase 6): course-review-due is charged 'mcp' only (its only write enters the cards
 *   the learner's lesson records already fix); every course-review-grade call, a reveal included,
 *   is charged 'mcp_write' too, so a 10-card review with reveals uses at most 20 of the 50 daily
 *   'mcp_write' calls (server/middleware/dailyCaps.js).
 */
import { reserveDailyCapFor } from '../server/middleware/dailyCaps.js';
import { resolveMcpUserId } from '../tools/core/mcpUserScope.js';
import { aiAccessRefusal, aiAccessSettingsUrl, remoteAccessEnv } from '../tools/core/mcpAiAccess.js';
import { createRemoteTermsCheck } from '../tools/core/legalAcceptance.js';

/** Remote tools that write learner data: charged to 'mcp_write' as well (not course-quiz-check: see above). */
export const REMOTE_WRITE_TOOLS = Object.freeze(['journal-log', 'learner-state-update', 'course-progress-update', 'course-review-grade']);

/**
 * daily_limit_reached text by the refusal's scope: the learner's own cap, the cap shared by every
 * connected agent, or a cap set to 0 ('off': no reset time, only a configuration change lifts it).
 * The remote kinds have no per-address cap, so any other scope reads as 'user'.
 */
const DAILY_LIMIT_MESSAGES = Object.freeze({
    user: {
        en: "Today's limit for connected AI agents has been reached. It resets at 00:00 Japan time (JST).",
        jp: '接続した AI エージェントの今日の利用上限に達しました。日本時間の 0 時にリセットされます。',
    },
    global: {
        en: "Today's limit shared by all connected AI agents on Rise Path has been used up. It resets at 00:00 Japan time (JST).",
        jp: 'Rise Path 全体で、接続した AI エージェントの今日の利用枠を使い切りました。日本時間の 0 時にリセットされます。',
    },
    off: {
        en: 'Connected AI agents are turned off on Rise Path for now.',
        jp: '接続した AI エージェントは、今は Rise Path で利用を止めています。',
    },
});

const CAP_MESSAGES = Object.freeze({
    ai_unavailable: {
        en: 'Rise Path is busy right now. Please try again in a few minutes.',
        jp: 'Rise Path が混み合っています。数分後にもう一度お試しください。',
    },
    cap_check_failed: {
        en: 'This request could not be checked right now. Please try again later.',
        jp: '今はこのリクエストを確認できません。しばらくしてからもう一度お試しください。',
    },
});

/**
 * A daily-cap refusal (dailyCaps reserveFor) as a tool error.
 * @param {{ status: number, body: Record<string, any> }} refusal
 */
function capToolError({ status, body }) {
    const errorType = body?.error_type === 'daily_limit_reached' || body?.error_type === 'ai_unavailable'
        ? body.error_type
        : 'cap_check_failed';
    const { en, jp } = errorType === 'daily_limit_reached'
        ? (Object.hasOwn(DAILY_LIMIT_MESSAGES, body?.scope) ? DAILY_LIMIT_MESSAGES[body.scope] : DAILY_LIMIT_MESSAGES.user)
        : CAP_MESSAGES[errorType];
    return {
        error: `${en}\n${jp}`,
        error_type: errorType,
        message: { en, jp },
        ...(body?.kind ? { kind: body.kind } : {}),
        ...(body?.scope ? { scope: body.scope } : {}),
        ...(body?.reset_at ? { reset_at: body.reset_at } : {}),
        ...(status === 503 ? { retry_after_seconds: 60 } : {}),
    };
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   reserveCap?: typeof reserveDailyCapFor,
 *   terms?: { refusal: (userId: string) => Promise<Record<string, unknown> | null> },
 * }} [options]  reserveCap: dailyCaps reserveFor (tests pass their own createDailyCaps);
 *   terms: the terms check (default: tools/core/legalAcceptance.js createRemoteTermsCheck over env)
 */
export function createRemotePolicy({ env = process.env, reserveCap = reserveDailyCapFor, terms = createRemoteTermsCheck({ env }) } = {}) {
    const accessEnv = remoteAccessEnv(env);
    const settingsUrl = aiAccessSettingsUrl(env);
    const writes = new Set(REMOTE_WRITE_TOOLS);

    return {
        /** @param {any} extra */
        async gate(extra) {
            const scope = await resolveMcpUserId({ extra, remote: true });
            if ('error' in scope) return { refusal: scope };
            // Terms first (Phase 8): a learner who has not accepted is sent to the app's consent
            // page, not to /settings/ai-access, whose age and consent writes need the terms too.
            const termsRefusal = await terms.refusal(scope.userId);
            if (termsRefusal) return { refusal: termsRefusal };
            const refusal = await aiAccessRefusal(scope.userId, { env: accessEnv, settingsUrl });
            return refusal ? { refusal } : { userId: scope.userId };
        },

        /** @param {string} userId @param {string} toolName */
        async charge(userId, toolName) {
            const kinds = writes.has(toolName) ? ['mcp', 'mcp_write'] : ['mcp'];
            const taken = [];
            for (const kind of kinds) {
                const { handle, refusal } = await reserveCap({ kind, userId });
                if (refusal) {
                    for (const earlier of taken) await earlier.refund();
                    return capToolError(refusal);
                }
                taken.push(handle);
            }
            return null;
        },
    };
}
