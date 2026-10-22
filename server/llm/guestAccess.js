/**
 * Guest access to the LLM gateway (PLAN §6.4.4 CORS allow-list, §6.5 cost limits).
 *
 * /api/v2/llm works without a token so guests can use the lesson tutor. Without these guards
 * any third-party page could use its visitors' browsers as a free model proxy. So:
 * - CORS answers only the app's own origins (same host, LLM_ALLOWED_ORIGINS, and in development
 *   the Vite dev server), and a POST from any other browser origin is refused with 403.
 * - Anonymous POSTs share a daily budget per IP and in total (in memory, reset at 00:00 JST):
 *   LLM_GUEST_DAILY_PER_IP (default 100) and LLM_GUEST_DAILY_TOTAL (default 2000). An IPv6 guest
 *   counts by its /56 (ipSubject in server/middleware/dailyCaps.js), so switching addresses inside
 *   one connection's block does not give a fresh budget.
 *   The routes mount the budget after body validation (and the guest lesson check), so only
 *   requests that will reach a model are charged, and give a request back with
 *   refundGuestBudget when the call fails before any model ran. Over the budget: 429 with
 *   error_type 'daily_limit_reached', scope 'guest' (server/middleware/dailyCaps.js sendDailyLimit).
 * Signed-in requests (req.userId) skip the budget; the per-minute AI limiter and the per-user
 * daily caps (server/middleware/dailyCaps.js) apply to them instead.
 */
import { modelMayHaveRun } from './errors.js';
import { ipSubject, jstDay, sendDailyLimit } from '../middleware/dailyCaps.js';

const DEFAULT_PER_IP = 100;
const DEFAULT_TOTAL = 2000;

/** "https://a.example, https://b.example/" → ['https://a.example', 'https://b.example'] */
export function parseOrigins(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {(origin: string | undefined, req?: import('express').Request) => boolean}
 */
export function createOriginPolicy({ env = process.env } = {}) {
  const production = env.NODE_ENV === 'production';
  const allowList = new Set(parseOrigins(env.LLM_ALLOWED_ORIGINS));
  return function isAllowedOrigin(origin, req) {
    // No Origin: not a cross-origin browser request (server-to-server, curl, same-origin GET).
    if (!origin) return true;
    const clean = origin.replace(/\/+$/, '');
    if (allowList.has(clean)) return true;
    let url;
    try {
      url = new URL(clean);
    } catch {
      return false;
    }
    // Same origin: the page and the API share a host (production serves dist/ from this app).
    const trustProxy = Boolean(req?.app?.get?.('trust proxy'));
    const forwarded = trustProxy ? String(req?.headers?.['x-forwarded-host'] ?? '').split(',')[0].trim() : '';
    const host = forwarded || String(req?.headers?.host ?? '');
    if (host && url.host === host) return true;
    // Development: the Vite dev server (port 3007, proxied to this API) on any local address.
    if (!production && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.port === '3007')) return true;
    return false;
  };
}

/**
 * Express middleware: 403 for a POST from a browser origin outside the policy.
 * @param {ReturnType<typeof createOriginPolicy>} isAllowedOrigin
 */
export function originGuard(isAllowedOrigin) {
  return (req, res, next) => {
    if (req.method !== 'POST' || isAllowedOrigin(req.headers.origin, req)) return next();
    res.status(403).json({ error: 'This origin may not use the AI tutor.', error_type: 'forbidden_origin' });
  };
}

/**
 * Daily request budget for anonymous callers, per IP and in total. Every POST that reaches the
 * middleware is charged, so mount it after the checks that can reject a request. It leaves
 * `res.locals.refundGuestBudget()` for refundGuestBudget below.
 * @param {{ env?: Record<string, string | undefined>, perIp?: number, total?: number, now?: () => number }} [options]
 */
export function createGuestBudget({ env = process.env, perIp, total, now = () => Date.now() } = {}) {
  const limitPerIp = perIp ?? positiveInt(env.LLM_GUEST_DAILY_PER_IP, DEFAULT_PER_IP);
  const limitTotal = total ?? positiveInt(env.LLM_GUEST_DAILY_TOTAL, DEFAULT_TOTAL);
  let day = '';
  let used = 0;
  /** Bounded by limitTotal: an IP is only added while the total budget lasts. */
  const byIp = new Map();

  const roll = () => {
    const today = jstDay(now());
    if (today !== day) {
      day = today;
      used = 0;
      byIp.clear();
    }
  };

  return function guestBudget(req, res, next) {
    if (req.method !== 'POST' || req.userId) return next();
    roll();
    // Public addresses as the daily caps count them (an IPv6 guest by its /56); internal ones
    // (local dev, a proxy without TRUST_PROXY) as they are.
    const raw = req.ip || req.socket?.remoteAddress || 'unknown';
    const ip = ipSubject(raw) ?? raw;
    const mine = byIp.get(ip) ?? 0;
    if (mine >= limitPerIp || used >= limitTotal) {
      sendDailyLimit(res, {
        kind: 'llm',
        scope: 'guest',
        now: now(),
        message: 'The daily limit for guest AI questions has been reached. Sign in, or try again after 00:00 Japan time (JST).',
      });
      return;
    }
    byIp.set(ip, mine + 1);
    used += 1;
    const chargedDay = day;
    let refunded = false;
    if (res.locals) {
      // Once per request, and only on the day it was charged (a new day starts from zero).
      res.locals.refundGuestBudget = () => {
        if (refunded || chargedDay !== day) return;
        refunded = true;
        used = Math.max(0, used - 1);
        const left = (byIp.get(ip) ?? 1) - 1;
        if (left > 0) byIp.set(ip, left);
        else byIp.delete(ip);
      };
    }
    next();
  };
}

/**
 * Give a guest request back to the daily budget when no model ran for it, so an outage does not
 * use up the guests' day. Refunded: no provider configured, every provider down or overloaded,
 * our key rejected, rate limited (errors.js modelMayHaveRun). Charged: timeouts, refusals,
 * truncated or invalid replies, unknown errors, and any request where an earlier attempt or a
 * structured first turn already ran (the gateway marks those `modelRan`). The tutor route also
 * keeps the charge once text was streamed. No-op for signed-in users.
 * @param {import('express').Response} res
 * @param {unknown} error  LlmError
 */
export function refundGuestBudget(res, error) {
  if (!modelMayHaveRun(error)) res.locals?.refundGuestBudget?.();
}

/**
 * Tighter limits for anonymous tutor calls (applied after validation).
 * - maxTokens is the hard ceiling of one call. Thinking tokens count against it, and adaptive
 *   thinking cannot be turned off on the current Claude models, so it leaves room for thinking
 *   (a 1024 cap cut answers off mid-sentence). It still bounds what one guest call can cost.
 * - The answer is kept short by `answerRule` (an extra system line) and low effort instead.
 */
export const GUEST_TUTOR_LIMITS = Object.freeze({
  historyTurns: 6,
  historyChars: 2000,
  maxTokens: 4096,
  effort: 'low',
  answerRule: 'The learner is not signed in. Keep every answer at the default short length (about 120 Japanese characters or 60 English words, at most three short paragraphs or bullets), even when they ask for more detail.',
});
