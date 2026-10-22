// @ts-check
/**
 * Daily caps on paid AI features: per signed-in user, per network address, and for all users.
 *
 * Kinds (CAP_KINDS), and what one unit is:
 *   llm               POST /api/v2/llm/tutor, /writing-feedback, /personality-insight (signed in)
 *   course_generation each /api/v2/ai/generate call that runs a Gemini stage
 *   image             each uncached /api/v2/image call (cache hits are free)
 *   agent_chat        each POST /api/v2/agent/chat that reaches Hermes
 *   embeddings        POST /api/v2/upload and POST /api/v2/rag/index (one file, at most
 *                     MAX_CHUNKS_PER_MATERIAL chunks: server/ragService.js)
 * Limits come from AI_CAP_USER_<KIND>, AI_CAP_IP_<KIND> (default: 3 × the user cap) and
 * AI_CAP_GLOBAL_<KIND> (defaults in DEFAULT_LIMITS), read on every reservation. 0 turns a feature
 * off for everyone, admins included (429 scope 'off', with no reset time). There is no
 * "unlimited" value: the global cap is the cost breaker and is always on.
 *
 * Subjects counted per call: the user id; 'ip:<address>' (an IPv6 caller by its /56, the block a
 * home or office connection usually gets), so a few accounts made from one network cannot use up
 * the global cap alone; and '*', all users. The address is req.ip (the visitor behind the edge:
 * originGate.js, or TRUST_PROXY). Loopback and private addresses (local dev, the tailnet, a proxy
 * without TRUST_PROXY) are not counted per address, so one proxy address can never turn the
 * per-address cap into a second global cap.
 *
 * The day is the Japan-time date, so every count resets at 00:00 JST. Counts live in
 * ai_daily_usage (server/migrations/013_ai_daily_usage.sql), one row per day, kind and subject.
 * Without a pool (local dev, tests) they are kept in this process's memory and reset on restart.
 * When a query fails (database down, migration 013 not applied) the caps stay on, but the count
 * for that call starts again from 0 in this process's memory: during an outage a user can get up
 * to one more full user cap, and the all-users cap drops to a tenth (at least 1) so that an
 * outage day allows at most about 1.1 × the global cap per process. A call refused by that
 * outage share is not the daily cap: it answers 503 ai_unavailable (Retry-After 60) and logs a
 * warning at most once a minute, without the 'reached' alert, which stays free for the real cap.
 *
 * Guests (no req.userId) are not counted here. On /llm the guest budget
 * (server/llm/guestAccess.js) covers them, and every other paid route requires auth. A feature
 * turned off (a limit of 0) is off for guests too.
 * Admins (user_profiles.role = 'admin') skip the user and address caps, not the global one.
 *
 * Over a cap: 429 { error, error_type: 'daily_limit_reached', kind, scope, reset_at } with
 * Retry-After set to the seconds left until 00:00 JST. scope is 'user', 'ip', 'global' or
 * 'guest'; a feature turned off answers scope 'off' without reset_at or Retry-After.
 * Reaching a global cap (and 80% of it) is logged as an error once a day per kind, and posted to
 * AI_CAP_ALERT_WEBHOOK_URL when it is set (a Slack- or Discord-style incoming webhook; https://
 * only, or http:// to a loopback address; the URL is a secret and is never logged).
 *
 * After fixing a problem that used up a global count without real use (a provider key that was
 * rejected, say), reset that kind's all-users count for today in the database:
 *   DELETE FROM ai_daily_usage WHERE usage_day = (now() AT TIME ZONE 'Asia/Tokyo')::date
 *     AND kind = '<kind>' AND subject = '*';
 * Each running process also forgets that day's 'reached' alert only at 00:00 JST.
 */
import net from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import { getPool } from '../db.js';
import { modelMayHaveRun } from '../llm/errors.js';

/** @typedef {'llm'|'course_generation'|'image'|'agent_chat'|'embeddings'} CapKind */
/** @typedef {'user'|'ip'|'global'|'guest'|'off'} CapScope */
/** @typedef {{ user: number, ip: number, global: number }} CapLimit */
/** @typedef {{ refund: () => Promise<void> }} CapHandle */

/** @type {readonly CapKind[]} */
export const CAP_KINDS = Object.freeze(['llm', 'course_generation', 'image', 'agent_chat', 'embeddings']);

/**
 * Sized for a small free launch. An owner who needs more sets a larger number. The per-address
 * cap defaults to IP_CAP_FACTOR × the user cap, so a household or a small class behind one
 * address still fits; a school behind one address needs a larger AI_CAP_IP_<KIND>.
 * @type {Readonly<Record<CapKind, { user: number, global: number }>>}
 */
const DEFAULT_LIMITS = Object.freeze({
  llm: { user: 50, global: 1500 },
  course_generation: { user: 20, global: 300 },
  image: { user: 30, global: 300 },
  agent_chat: { user: 40, global: 800 },
  embeddings: { user: 10, global: 100 },
});
const IP_CAP_FACTOR = 3;

const GLOBAL_SUBJECT = '*';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Japan has had no daylight saving time since 1951, so JST is always UTC+9. A fixed offset gives
// the Japan-time date without Intl or a time zone database, and the same answer on every host.
const JST_OFFSET_MS = 9 * HOUR_MS;
/** ai_daily_usage.count is a Postgres integer; a larger limit could not be reached anyway. */
const MAX_LIMIT = 2147483647;
const ROLE_TTL_MS = 5 * 60 * 1000;
const ROLE_CACHE_MAX = 1000;
const DB_WARN_INTERVAL_MS = 60 * 1000;
/** Share of the global cap a process may use from memory while the database does not answer. */
const OUTAGE_GLOBAL_SHARE = 0.1;
/** Retry-After (seconds) on the 503 sent when that outage share is used up. */
const OUTAGE_RETRY_AFTER_S = 60;
/** Share of a global cap at which the owner is warned before everyone is refused. */
const GLOBAL_WARN_SHARE = 0.8;
const ALERT_TIMEOUT_MS = 5000;

const DEFAULT_MESSAGE = Object.freeze({
  user: "Today's limit for this AI feature has been reached. It resets at 00:00 Japan time (JST).",
  ip: "Today's limit for this AI feature on your network has been reached. It resets at 00:00 Japan time (JST).",
  global: "This AI feature has reached today's limit for all users. It resets at 00:00 Japan time (JST).",
  guest: "Today's limit for guest AI requests has been reached. It resets at 00:00 Japan time (JST).",
  off: 'This AI feature is turned off on this server for now.',
});

/** Reserve one slot; zero rows back means the cap is reached. The row lock keeps it exact. */
const RESERVE_SQL = `INSERT INTO ai_daily_usage (usage_day, kind, subject, count) VALUES ($1::date, $2, $3, 1)
ON CONFLICT (usage_day, kind, subject)
DO UPDATE SET count = ai_daily_usage.count + 1, updated_at = now()
WHERE ai_daily_usage.count < $4
RETURNING count`;

/** Give slots back on the day they were charged, so a refund after midnight never adds to the new day. */
const REFUND_SQL = `UPDATE ai_daily_usage SET count = count - 1, updated_at = now()
WHERE usage_day = $1::date AND kind = $2 AND subject = ANY($3::text[]) AND count > 0`;

/**
 * The Japan-time date of `nowMs` as 'YYYY-MM-DD'.
 * @param {number} nowMs
 */
export const jstDay = (nowMs) => new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Milliseconds of the next 00:00 JST after `nowMs` (15:00 UTC).
 * @param {number} nowMs
 */
export const nextJstMidnight = (nowMs) => Date.parse(`${jstDay(nowMs)}T00:00:00.000Z`) - JST_OFFSET_MS + DAY_MS;

/** Addresses that are not one visitor: loopback, private, CGNAT/tailnet, link-local, unspecified. */
const INTERNAL_ADDRESSES = new net.BlockList();
for (const [network, prefix] of /** @type {const} */ ([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
])) INTERNAL_ADDRESSES.addSubnet(network, prefix, 'ipv4');
INTERNAL_ADDRESSES.addAddress('::', 'ipv6');
INTERNAL_ADDRESSES.addAddress('::1', 'ipv6');
INTERNAL_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
INTERNAL_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');

/** IPv6 callers are grouped by this prefix: a home or office line usually gets a /56 (or a /48). */
const IPV6_SUBNET = 56;

/**
 * The ai_daily_usage subject for a caller's address: 'ip:203.0.113.7', 'ip:2001:db8:1:200::/56'
 * (an IPv6 caller can switch addresses inside its /56: express-rate-limit's ipKeyGenerator, as
 * the per-minute limiters use), or null for an internal or unknown one. The guest budget
 * (server/llm/guestAccess.js) groups guests the same way.
 * @param {unknown} ip
 * @returns {string | null}
 */
export function ipSubject(ip) {
  let address = String(ip ?? '').trim();
  if (address.toLowerCase().startsWith('::ffff:') && net.isIPv4(address.slice(7))) address = address.slice(7);
  if (net.isIPv4(address)) return INTERNAL_ADDRESSES.check(address, 'ipv4') ? null : `ip:${address}`;
  if (net.isIPv6(address)) {
    const bare = address.split('%')[0];
    return INTERNAL_ADDRESSES.check(bare, 'ipv6') ? null : `ip:${ipKeyGenerator(bare, IPV6_SUBNET)}`;
  }
  return null;
}

/** Bad values already reported by resolveCapLimits callers that pass no `warned` set. */
const warnedLimitKeys = new Set();

/**
 * User, per-address and all-users limits for every kind, from AI_CAP_USER_<KIND>,
 * AI_CAP_IP_<KIND> and AI_CAP_GLOBAL_<KIND>. A value must be a whole number ('0' means 0, the
 * feature is off). Anything else (empty, negative, decimal, text) falls back to the default, with
 * one warning per bad key. The per-address default is IP_CAP_FACTOR × the user limit.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ logger?: Pick<Console, 'warn'>, warned?: Set<string> }} [options]
 * @returns {Record<CapKind, CapLimit>}
 */
export function resolveCapLimits(env = process.env, { logger = console, warned = warnedLimitKeys } = {}) {
  /** @param {string} key @param {number} fallback */
  const read = (key, fallback) => {
    const raw = env[key];
    if (raw == null) return fallback;
    const value = String(raw).trim();
    if (/^\d+$/.test(value)) return Math.min(Number(value), MAX_LIMIT);
    if (!warned.has(key)) {
      warned.add(key);
      logger.warn(`[AI caps] ${key}=${JSON.stringify(raw)} is not a whole number (0 or more): using the default ${fallback}.`);
    }
    return fallback;
  };
  return /** @type {Record<CapKind, CapLimit>} */ (Object.fromEntries(CAP_KINDS.map((kind) => {
    const name = kind.toUpperCase();
    const user = read(`AI_CAP_USER_${name}`, DEFAULT_LIMITS[kind].user);
    return [kind, {
      user,
      ip: read(`AI_CAP_IP_${name}`, Math.min(user * IP_CAP_FACTOR, MAX_LIMIT)),
      global: read(`AI_CAP_GLOBAL_${name}`, DEFAULT_LIMITS[kind].global),
    }];
  })));
}

/**
 * Answer 429 daily_limit_reached, with Retry-After and reset_at at the next 00:00 JST. Scope
 * 'off' (a cap set to 0) has neither: nothing resets it but a configuration change.
 * @param {import('express').Response} res
 * @param {{ kind: CapKind, scope: CapScope, now?: number, message?: string }} options
 */
export function sendDailyLimit(res, { kind, scope, now = Date.now(), message }) {
  const error = message ?? DEFAULT_MESSAGE[scope] ?? DEFAULT_MESSAGE.user;
  if (scope === 'off') {
    res.status(429).json({ error, error_type: 'daily_limit_reached', kind, scope });
    return;
  }
  const resetAt = nextJstMidnight(now);
  res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
  res.status(429).json({ error, error_type: 'daily_limit_reached', kind, scope, reset_at: new Date(resetAt).toISOString() });
}

/**
 * @typedef {object} CapStore
 * @property {(day: string, kind: string, subject: string, limit: number) => Promise<number | null>} reserve
 *   the count after taking a slot, or null when the cap is reached
 * @property {(day: string, kind: string, subjects: string[]) => Promise<void>} refund
 */

/**
 * Counts in this process, keyed `${day}|${kind}|${subject}`. A reservation on a later day drops
 * the other days, so a late refund for yesterday finds nothing. A request stamped with an
 * earlier day (it started just before midnight) counts under that day and drops nothing.
 */
function createMemoryStore() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  let currentDay = '';
  return {
    /** @type {CapStore['reserve']} */
    async reserve(day, kind, subject, limit) {
      // 'YYYY-MM-DD' strings compare in date order.
      if (day > currentDay) {
        for (const key of counts.keys()) if (!key.startsWith(`${day}|`)) counts.delete(key);
        currentDay = day;
      }
      const key = `${day}|${kind}|${subject}`;
      const used = counts.get(key) ?? 0;
      if (used >= limit) return null;
      counts.set(key, used + 1);
      return used + 1;
    },
    /** @type {CapStore['refund']} */
    async refund(day, kind, subjects) {
      for (const subject of subjects) {
        const key = `${day}|${kind}|${subject}`;
        const used = counts.get(key) ?? 0;
        if (used > 1) counts.set(key, used - 1);
        else counts.delete(key);
      }
    },
    clear() {
      counts.clear();
      currentDay = '';
    },
  };
}

/**
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows?: any[] }> }} pool
 * @returns {CapStore}
 */
const createPgStore = (pool) => ({
  async reserve(day, kind, subject, limit) {
    const result = await pool.query(RESERVE_SQL, [day, kind, subject, limit]);
    const row = result?.rows?.[0];
    if (!row) return null;
    const count = Number(row.count);
    return Number.isFinite(count) ? count : limit;
  },
  async refund(day, kind, subjects) {
    await pool.query(REFUND_SQL, [day, kind, subjects]);
  },
});

/** Handle for callers that are not counted (guests). */
const NOOP_HANDLE = Object.freeze({ refund: async () => {} });

/** Hosts an http:// alert webhook may use (a relay on this machine); anything else needs https://. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * AI_CAP_ALERT_WEBHOOK_URL as a URL, or the reason it cannot be used. An incoming-webhook URL is a
 * bearer secret, so no message ever contains it.
 * @param {string} raw
 * @returns {URL | string}
 */
function parseAlertWebhook(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'AI_CAP_ALERT_WEBHOOK_URL is not a valid URL';
  }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) return url;
  return 'AI_CAP_ALERT_WEBHOOK_URL must use https:// (http:// only to localhost)';
}

/**
 * Post an alert line to the webhook (Slack reads `text`, Discord `content`). A failure is logged
 * by its error name or code only: fetch messages can quote the URL.
 * @param {string} url  an href from parseAlertWebhook @param {string} line @param {typeof fetch} fetchImpl
 * @param {Pick<Console, 'warn'>} logger
 */
async function postAlert(url, line, fetchImpl, logger) {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: line, content: line }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    if (!response.ok) logger.warn(`[AI caps] the alert webhook answered ${response.status}.`);
  } catch (error) {
    const cause = /** @type {{ cause?: { code?: unknown } }} */ (error ?? {}).cause;
    const reason = typeof cause?.code === 'string' ? cause.code : error instanceof Error ? error.name : 'unknown error';
    logger.warn(`[AI caps] the alert webhook failed (${reason}).`);
  }
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   now?: () => number,
 *   getPool?: () => any,
 *   logger?: Pick<Console, 'warn' | 'error'>,
 *   fetch?: typeof fetch,
 * }} [options]
 */
export function createDailyCaps({
  env = process.env,
  now = () => Date.now(),
  getPool: poolFn = getPool,
  logger = console,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const memory = createMemoryStore();
  /** @type {Map<string, { admin: boolean, expires: number }>} */
  const roles = new Map();
  /** @type {Set<string>} */
  const warnedLimits = new Set();
  /** `${level}|${kind}` alerts already sent today. */
  const alerted = new Set();
  let alertedDay = '';
  let warnedNoPool = false;
  /** @type {Map<string, number>} */
  const lastDbWarnAt = new Map();
  /** The last AI_CAP_ALERT_WEBHOOK_URL value read, and what it parsed to. */
  let webhook = { raw: '', parsed: /** @type {URL | string} */ ('') };

  /**
   * A warning logged at most once a minute per key.
   * @param {string} key @param {() => string} line
   */
  const warnEveryMinute = (key, line) => {
    const t = now();
    if (t - (lastDbWarnAt.get(key) ?? -Infinity) < DB_WARN_INTERVAL_MS) return;
    lastDbWarnAt.set(key, t);
    logger.warn(line());
  };

  /**
   * A database problem, logged at most once a minute per kind of problem.
   * @param {string} what @param {unknown} error @param {string} consequence
   */
  const warnDb = (what, error, consequence) => warnEveryMinute(what, () => {
    const reason = error instanceof Error ? error.message : String(error);
    return `[AI caps] ${what} failed (${reason}): ${consequence}`;
  });
  const MEMORY_FALLBACK = 'this process counts in memory from 0 until the database answers (the all-users cap drops to a tenth meanwhile). Is migration 013 applied?';

  /** One store object per pool, so a refund groups the subjects it charged into one UPDATE. */
  const pgStores = new WeakMap();

  /** The database store, or memory (logged once) when there is no pool. @returns {CapStore} */
  const storeFor = (/** @type {any} */ pool) => {
    if (pool) {
      if (!pgStores.has(pool)) pgStores.set(pool, createPgStore(pool));
      return pgStores.get(pool);
    }
    if (!warnedNoPool) {
      warnedNoPool = true;
      logger.warn('[AI caps] DATABASE_URL_PHASE1 is not set: daily caps are kept in memory and reset on restart.');
    }
    return memory;
  };

  /**
   * Take one slot for `subject` in `store`. A failed query falls back to memory for this charge,
   * where the all-users subject gets OUTAGE_GLOBAL_SHARE of its limit.
   * @param {CapStore} store @param {string} day @param {string} kind @param {string} subject @param {number} limit
   * @returns {Promise<{ store: CapStore | null, count: number, outage: boolean }>} store null when
   *   refused; `outage` when the count came from memory because the database did not answer (a
   *   refusal of the all-users subject is then its outage share: the real cap may be far off)
   */
  const charge = async (store, day, kind, subject, limit) => {
    let memoryLimit = limit;
    let outage = false;
    if (store !== memory) {
      try {
        const count = await store.reserve(day, kind, subject, limit);
        return count === null ? { store: null, count: 0, outage: false } : { store, count, outage: false };
      } catch (error) {
        warnDb('reserving a daily cap slot', error, MEMORY_FALLBACK);
        outage = true;
        if (subject === GLOBAL_SUBJECT) memoryLimit = Math.max(1, Math.ceil(limit * OUTAGE_GLOBAL_SHARE));
      }
    }
    const count = await memory.reserve(day, kind, subject, memoryLimit);
    return count === null ? { store: null, count: 0, outage } : { store: memory, count, outage };
  };

  /** Give slots back to the stores that charged them. @param {{ store: CapStore, subject: string }[]} charges */
  const giveBack = async (/** @type {string} */ day, /** @type {string} */ kind, charges) => {
    /** @type {Map<CapStore, string[]>} */
    const byStore = new Map();
    for (const { store, subject } of charges) byStore.set(store, [...(byStore.get(store) ?? []), subject]);
    for (const [store, subjects] of byStore) {
      try {
        await store.refund(day, kind, subjects);
      } catch (error) {
        warnDb('refunding a daily cap slot', error, 'the slot stays used for today.');
      }
    }
  };

  /**
   * user_profiles.role === 'admin', cached 5 minutes. Errors and no pool: not admin, not cached.
   * @param {string} userId @param {any} pool
   */
  const isAdmin = async (userId, pool) => {
    const t = now();
    const cached = roles.get(userId);
    if (cached && cached.expires > t) return cached.admin;
    if (!pool) return false;
    try {
      const result = await pool.query('SELECT role FROM user_profiles WHERE user_id = $1', [userId]);
      const admin = result?.rows?.[0]?.role === 'admin';
      if (roles.size >= ROLE_CACHE_MAX) roles.clear();
      roles.set(userId, { admin, expires: t + ROLE_TTL_MS });
      return admin;
    } catch (error) {
      warnDb('reading the user role', error, 'the caller is treated as not an admin.');
      return false;
    }
  };

  /**
   * Tell the owner, once a day per kind and level: 'warning' at GLOBAL_WARN_SHARE of a global cap,
   * 'reached' when it refuses everyone. Logged as an error, and posted to the alert webhook.
   * @param {'warning'|'reached'} level @param {string} day @param {CapKind} kind @param {number} limit
   */
  const alertGlobal = (level, day, kind, limit) => {
    if (day !== alertedDay) {
      alerted.clear();
      alertedDay = day;
    }
    const key = `${level}|${kind}`;
    if (alerted.has(key)) return;
    alerted.add(key);
    const line = level === 'reached'
      ? `[AI caps] global daily cap reached: ${kind} (${limit}) on ${day} JST. Signed-in users are refused this feature until 00:00 JST (AI_CAP_GLOBAL_${kind.toUpperCase()}).`
      : `[AI caps] global daily cap ${Math.round(GLOBAL_WARN_SHARE * 100)}% used: ${kind} (${limit}) on ${day} JST (AI_CAP_GLOBAL_${kind.toUpperCase()}).`;
    logger.error(line);
    const raw = env.AI_CAP_ALERT_WEBHOOK_URL?.trim() ?? '';
    if (!raw || !fetchImpl) return;
    if (raw !== webhook.raw) {
      webhook = { raw, parsed: parseAlertWebhook(raw) };
      if (typeof webhook.parsed === 'string') logger.warn(`[AI caps] ${webhook.parsed}: alerts are not posted.`);
    }
    if (typeof webhook.parsed !== 'string') void postAlert(webhook.parsed.href, line, fetchImpl, logger);
  };

  /**
   * Charge one use of `kind` to the caller, to their address and to the all-users total. Answers
   * 429 itself and returns null when a cap is reached (or the feature is off, for guests too), or
   * 503 when only a database outage's share of the all-users cap is used up; otherwise returns a
   * handle whose refund() gives the use back once. Never throws.
   * @param {import('express').Request & { userId?: unknown }} req  req.userId from the auth middleware
   * @param {import('express').Response} res
   * @param {CapKind} kind
   * @param {{ refundOnStatus?: number[] }} [options] refund automatically when the response
   *   finishes with one of these statuses (paths that end before any paid call)
   * @returns {Promise<CapHandle | null>}
   */
  async function reserve(req, res, kind, { refundOnStatus = [] } = {}) {
    try {
      const limits = resolveCapLimits(env, { logger, warned: warnedLimits })[kind];
      if (!limits) throw new Error(`Unknown daily cap kind: ${kind}`);
      const t = now();
      // Off is off for everyone, guests included (they are not counted, but not served either).
      if (limits.user === 0 || limits.ip === 0 || limits.global === 0) {
        sendDailyLimit(res, { kind, scope: 'off', now: t });
        return null;
      }
      const userId = req.userId ? String(req.userId) : '';
      if (!userId) return NOOP_HANDLE;
      const day = jstDay(t);
      const pool = poolFn();
      const store = storeFor(pool);
      /** @type {{ store: CapStore, subject: string }[]} */
      const charges = [];
      if (!(await isAdmin(userId, pool))) {
        const user = await charge(store, day, kind, userId, limits.user);
        if (!user.store) {
          sendDailyLimit(res, { kind, scope: 'user', now: t });
          return null;
        }
        charges.push({ store: user.store, subject: userId });
        const address = ipSubject(req.ip || req.socket?.remoteAddress);
        if (address) {
          const network = await charge(store, day, kind, address, limits.ip);
          if (!network.store) {
            await giveBack(day, kind, charges);
            sendDailyLimit(res, { kind, scope: 'ip', now: t });
            return null;
          }
          charges.push({ store: network.store, subject: address });
        }
      }
      const all = await charge(store, day, kind, GLOBAL_SUBJECT, limits.global);
      if (!all.store) {
        // The caller's own slots go back: a refused request uses nothing.
        await giveBack(day, kind, charges);
        if (all.outage) {
          // Only this process's outage share is used up, not the daily cap: no 'reached' alert
          // (it would hide the real one for the rest of the day) and no reset time to promise.
          const KIND = kind.toUpperCase();
          warnEveryMinute(`outage share|${kind}`, () => `[AI caps] all-users outage share used up: ${kind} (${Math.max(1, Math.ceil(limits.global * OUTAGE_GLOBAL_SHARE))} of AI_CAP_GLOBAL_${KIND}=${limits.global}) in this process while the database does not answer. Callers get 503 until it does.`);
          res.set('Retry-After', String(OUTAGE_RETRY_AFTER_S));
          res.status(503).json({ error: 'This AI feature is busy right now. Please try again in a few minutes.', error_type: 'ai_unavailable' });
          return null;
        }
        alertGlobal('reached', day, kind, limits.global);
        sendDailyLimit(res, { kind, scope: 'global', now: t });
        return null;
      }
      charges.push({ store: all.store, subject: GLOBAL_SUBJECT });
      if (all.count >= Math.ceil(limits.global * GLOBAL_WARN_SHARE)) alertGlobal('warning', day, kind, limits.global);

      let refunded = false;
      /** @type {CapHandle} */
      const handle = {
        refund: async () => {
          if (refunded) return;
          refunded = true;
          await giveBack(day, kind, charges);
        },
      };
      if (refundOnStatus.length > 0) {
        res.once('finish', () => {
          if (refundOnStatus.includes(res.statusCode)) void handle.refund();
        });
      }
      if (res.locals) res.locals.refundDailyCap = handle.refund;
      return handle;
    } catch (error) {
      logger.error('[AI caps] daily cap check failed:', error);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      return null;
    }
  }

  /**
   * Express middleware that reserves `kind` before the route runs (see reserve).
   * @param {CapKind} kind
   * @param {{ refundOnStatus?: number[] }} [options]
   * @returns {import('express').RequestHandler}
   */
  function middleware(kind, options) {
    if (!CAP_KINDS.includes(kind)) throw new Error(`Unknown daily cap kind: ${kind}`);
    return async function dailyCapMiddleware(req, res, next) {
      const handle = await reserve(req, res, kind, options);
      if (handle) next();
    };
  }

  /** Clear the in-memory counts, the role cache and today's alerts (tests). */
  function reset() {
    memory.clear();
    roles.clear();
    alerted.clear();
    alertedDay = '';
  }

  return { reserve, middleware, reset };
}

const dailyCaps = createDailyCaps();

export const reserveDailyCap = dailyCaps.reserve;
export const dailyCap = dailyCaps.middleware;
export const resetDailyCapsForTests = dailyCaps.reset;

/**
 * Give the use back when no model ran (errors.js modelMayHaveRun), as refundGuestBudget does for
 * guests. No-op when nothing was reserved (guests, routes without a cap).
 * @param {import('express').Response} res
 * @param {unknown} error  LlmError
 */
export function refundDailyCap(res, error) {
  if (!modelMayHaveRun(error)) void res.locals?.refundDailyCap?.();
}
