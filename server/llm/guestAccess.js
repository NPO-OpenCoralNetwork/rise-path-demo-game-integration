/**
 * Guest access to the LLM gateway (PLAN §6.4.4 CORS allow-list, §6.5 cost limits).
 *
 * /api/v2/llm works without a token so guests can use the lesson tutor. Without these guards
 * any third-party page could use its visitors' browsers as a free model proxy. So:
 * - CORS answers only the app's own origins (same host, LLM_ALLOWED_ORIGINS, and in development
 *   the Vite dev server), and a POST from any other browser origin is refused with 403.
 * - Anonymous POSTs share a daily budget per IP and in total (in memory, reset at 00:00 UTC):
 *   LLM_GUEST_DAILY_PER_IP (default 100) and LLM_GUEST_DAILY_TOTAL (default 2000).
 * Signed-in requests (req.userId) skip the budget; the per-minute AI limiter still applies.
 */

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
 * Daily request budget for anonymous callers, per IP and in total.
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
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
      byIp.clear();
    }
  };

  return function guestBudget(req, res, next) {
    if (req.method !== 'POST' || req.userId) return next();
    roll();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const mine = byIp.get(ip) ?? 0;
    if (mine >= limitPerIp || used >= limitTotal) {
      const midnight = new Date(`${day}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000;
      res.set('Retry-After', String(Math.max(60, Math.ceil((midnight - now()) / 1000))));
      res.status(429).json({
        error: 'The daily limit for guest AI questions has been reached. Sign in, or try again tomorrow.',
        error_type: 'rate_limited',
      });
      return;
    }
    byIp.set(ip, mine + 1);
    used += 1;
    next();
  };
}

/** Tighter request limits for anonymous tutor calls (applied after validation). */
export const GUEST_TUTOR_LIMITS = Object.freeze({ historyTurns: 6, historyChars: 2000, maxTokens: 1024 });
