// @ts-check
/**
 * AI access gate (Phase 0.5 minor safeguards): runs after auth and before the daily caps on every
 * route that calls a model, so a refused call is never charged. Rules: server/safety/access.js.
 *
 * Mounted by server.js on POST /api/v2/llm/* (createLlmRouter option `aiAccess`, inside guarded()),
 * POST /api/v2/ai/generate; with { adultsOnly: true } on POST /api/v2/image and POST
 * /api/v2/agent/chat (no minor screening there) and by server/routes/chatgptCurriculum.js for
 * learner JWT callers of the external course draft routes. GET /api/v2/llm/status stays public and ungated.
 *
 * On success: res.locals.aiAudience = 'adult' | 'minor' (moderation and the child-safety prompt
 * part key on it). Refusals:
 *   401 sign_in_required           a guest, unless LLM_GUEST_AI is exactly "true" (only for
 *                                  deployments people under 18 cannot reach; guests then count as adults)
 *   403 age_required               no birth month recorded
 *   403 adults_only                a minor on an adults-only route
 *   403 guardian_consent_required  a minor without an active guardian consent
 *   403 ai_paused_safety           too many blocked inputs today (paused_until: next 00:00 JST)
 *   503 ai_access_unavailable      production without a database, or the lookup failed (fail closed)
 */
import { AiAccessUnavailableError, resolveAiAccess } from '../safety/access.js';

const WARN_INTERVAL_MS = 60 * 1000;
let lastWarnAt = 0;

/** @type {Readonly<Record<string, string>>} */
const MESSAGES = Object.freeze({
  sign_in_required: 'Sign in to use the AI features.',
  age_required: 'Record your birth year and month to use the AI features.',
  adults_only: 'This AI feature is for people aged 18 and over.',
  guardian_consent_required: 'A guardian needs to agree before you can use the AI features.',
  ai_paused_safety: 'The AI features are paused for today. They start again at 00:00 Japan time (JST).',
  ai_access_unavailable: 'AI access cannot be checked right now. Please try again later.',
});

/**
 * @param {import('express').Response} res @param {number} status @param {string} errorType
 * @param {Record<string, unknown>} [extra]
 */
const refuse = (res, status, errorType, extra = {}) => {
  res.status(status).json({ error: MESSAGES[errorType], error_type: errorType, ...extra });
};

/** Guests may use AI only when LLM_GUEST_AI is exactly "true". @param {Record<string, string | undefined>} env */
export const guestAiAllowed = (env = process.env) => env.LLM_GUEST_AI === 'true';

/**
 * Startup warnings for settings that must not be used in production (server.js logs them).
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function aiAccessStartupWarnings(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  const warnings = [];
  if (env.AI_ACCESS_DEV_AUDIENCE?.trim()) {
    warnings.push('[AiAccess] AI_ACCESS_DEV_AUDIENCE is set in production and is ignored. Remove it.');
  }
  if (guestAiAllowed(env)) {
    warnings.push('[AiAccess] LLM_GUEST_AI=true: anonymous callers can use the AI features as adults. Use it only where people under 18 cannot reach the service.');
  }
  return warnings;
}

/**
 * @param {{ adultsOnly?: boolean }} [options]
 * @returns {import('express').RequestHandler}
 */
export function aiAccessGate({ adultsOnly = false } = {}) {
  return async (req, res, next) => {
    const userId = /** @type {any} */ (req).userId;
    if (!userId) {
      if (!guestAiAllowed(process.env)) return refuse(res, 401, 'sign_in_required');
      res.locals.aiAudience = 'adult';
      return next();
    }

    let access;
    try {
      access = await resolveAiAccess(userId, { env: process.env });
    } catch (error) {
      const now = Date.now();
      if (now - lastWarnAt >= WARN_INTERVAL_MS) {
        lastWarnAt = now;
        const cause = error instanceof AiAccessUnavailableError ? /** @type {any} */ (error).cause ?? error : error;
        console.warn('[AiAccess] access state unavailable; AI calls answer 503:', /** @type {any} */ (cause)?.message ?? cause);
      }
      res.set('Retry-After', '60');
      return refuse(res, 503, 'ai_access_unavailable');
    }

    if (access.status === 'needs_age') return refuse(res, 403, 'age_required');
    if (adultsOnly && access.audience !== 'adult') return refuse(res, 403, 'adults_only');
    if (access.status === 'needs_guardian_consent') return refuse(res, 403, 'guardian_consent_required');
    if (access.status === 'paused') return refuse(res, 403, 'ai_paused_safety', { paused_until: access.pausedUntil });
    if (access.status !== 'ready' || (access.audience !== 'adult' && access.audience !== 'minor')) {
      return refuse(res, 503, 'ai_access_unavailable');
    }
    res.locals.aiAudience = access.audience;
    return next();
  };
}
