// @ts-check
/**
 * Who is a supporter (Phase 3). Read from billing_subscriptions (migration 017), which only the
 * server writes (billingSync.js), never from anything a learner can write (C14 of the scout).
 *
 * isEntitled: the row's mode is the configured mode, its price is accepted
 * (STRIPE_PRICE_IDS_ACCEPTED ∪ STRIPE_PRICE_ID), and
 *   - active or trialing until BILLING_GRACE_MS after current_period_end (a late renewal event);
 *   - past_due only until BILLING_GRACE_MS after current_period_start: the renewal moved the
 *     period forward before the payment failed, so the period end would give a whole unpaid month
 *     (C3/C16/C33/C47);
 *   - anything else (incomplete, canceled, unpaid, paused, …) is not.
 *   A scheduled cancellation (cancel_at, cancel_at_period_end) keeps the plan until the period ends.
 *
 * planForUser: 'supporter' or 'free'. 'free' unless billing is serviceable (billingConfig.js); never
 * for a guest or PHASE1_USER_ID (the dev and bridge user); in test mode only for
 * BILLING_TEST_USER_IDS; and only for a recorded adult under production rules (the age can be
 * corrected to a minor at any time: then the owner is alerted 'minor_with_subscription', once a
 * day per user, to cancel and refund). Cached 60 s per user and mode, with access.js's write
 * generations: invalidatePlan(userId) (after every subscription write) bumps the user's number,
 * and a read that ran across a bump is answered but not cached (C28). A database error answers
 * 'free' and is not cached.
 *
 * createSupporterCapResolver is what server.js hands to the daily caps (dailyCaps.js
 * setPlanResolver): only the kinds the plan raises are looked up, so mcp-public (which never sets
 * a resolver) and the other kinds never touch billing.
 */
import { getPool, PHASE1_USER_ID } from '../db.js';
import { resolveAiAccess } from '../safety/access.js';
import { remoteAccessEnv } from '../../tools/core/mcpAiAccess.js';
import { billingAlerts, userTag } from './billingAlerts.js';
import { billingAudienceAllows } from './billingConfig.js';
import { BILLING_GRACE_MS, effectiveSupporterCaps, isSupporterCapKind, supporterGlobalCaps } from './billingPlan.js';

/** @typedef {import('./billingConfig.js').BillingConfig} BillingConfig */
/** @typedef {'ok'|'age_required'|'adults_only'|'guardian_consent'|'paused'|'unavailable'} Eligibility */
/**
 * @typedef {{
 *   stripe_subscription_id: string, stripe_customer_id: string, status: string, price_id: string | null,
 *   livemode: boolean, current_period_start: Date | string | null, current_period_end: Date | string | null,
 *   cancel_at_period_end: boolean, cancel_at: Date | string | null, canceled_at: Date | string | null,
 *   stripe_created: Date | string | null, synced_at?: Date | string | null,
 * }} SubscriptionRow
 */

/** Statuses after which nothing is charged again. */
export const TERMINAL_STATUSES = Object.freeze(['canceled', 'incomplete_expired']);

export const SELECT_SUBSCRIPTIONS_SQL = `SELECT stripe_subscription_id, stripe_customer_id, status, price_id, livemode,
  current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, stripe_created, synced_at
FROM billing_subscriptions WHERE user_id = $1 AND livemode = $2
ORDER BY stripe_created DESC NULLS LAST, stripe_subscription_id`;

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 1000;
const WARN_INTERVAL_MS = 60 * 1000;

/** @param {unknown} value @returns {number | null} milliseconds */
export function toMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/** @param {unknown} value */
const toIso = (value) => {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
};

/**
 * @param {SubscriptionRow | null | undefined} row
 * @param {number | Date} now
 * @param {{ live: boolean, acceptedPriceIds: Set<string> }} config
 */
export function isEntitled(row, now, { live, acceptedPriceIds }) {
  if (!row || row.livemode !== live) return false;
  if (!row.price_id || !acceptedPriceIds.has(row.price_id)) return false;
  const t = now instanceof Date ? now.getTime() : now;
  if (row.status === 'active' || row.status === 'trialing') {
    const end = toMs(row.current_period_end);
    return end !== null && t < end + BILLING_GRACE_MS;
  }
  if (row.status === 'past_due') {
    const start = toMs(row.current_period_start);
    return start !== null && t < start + BILLING_GRACE_MS;
  }
  return false;
}

/**
 * The learner's AI access under production rules (no AI_ACCESS_DEV_AUDIENCE, no "no database
 * means adult"): a purchase and the supporter caps never trust a development bypass.
 * @param {string} userId @param {{ now?: number, env?: Record<string, string | undefined> }} [options]
 * @throws {import('../safety/access.js').AiAccessUnavailableError}
 */
export function readBillingAccess(userId, { now = Date.now(), env = process.env } = {}) {
  return resolveAiAccess(userId, { env: remoteAccessEnv(env), now: new Date(now) });
}

/** @param {import('../safety/access.js').AiAccess} access */
export const isAdultForBilling = (access) => Boolean(access?.birthYm) && access.audience === 'adult';

/**
 * May this learner subscribe? ('ok', or the reason not), from their AI access.
 * @param {import('../safety/access.js').AiAccess} access
 * @returns {{ eligibility: Eligibility, pausedUntil?: string }}
 */
export function eligibilityOf(access) {
  if (!access || access.status === 'needs_age' || (!access.birthYm && access.audience === 'adult')) return { eligibility: 'age_required' };
  if (access.audience !== 'adult') return { eligibility: 'adults_only' };
  if (access.status === 'needs_guardian_consent') return { eligibility: 'guardian_consent' };
  if (access.status === 'paused') return access.pausedUntil ? { eligibility: 'paused', pausedUntil: access.pausedUntil } : { eligibility: 'paused' };
  if (access.status === 'ready') return { eligibility: 'ok' };
  return { eligibility: 'unavailable' };
}

/** Display order when several subscriptions are not ended (a duplicate). */
const STATUS_ORDER = ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'];

/**
 * The subscription GET /me shows: the most relevant one that is not ended, else the most recent.
 * endsAt is when a scheduled cancellation takes effect: cancel_at (flexible billing mode, the
 * default from API 2025-09-30.clover), else the period end when cancel_at_period_end (classic) (C22).
 * @param {SubscriptionRow[]} rows  newest first (SELECT_SUBSCRIPTIONS_SQL)
 */
export function subscriptionSummary(rows) {
  if (!rows?.length) return null;
  const open = rows.filter((row) => !TERMINAL_STATUSES.includes(row.status));
  const pick = open.length
    ? [...open].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))[0]
    : rows[0];
  const endsAt = toIso(pick.cancel_at) ?? (pick.cancel_at_period_end ? toIso(pick.current_period_end) : null);
  return {
    status: pick.status,
    currentPeriodEnd: toIso(pick.current_period_end),
    endsAt,
    cancelAtPeriodEnd: Boolean(pick.cancel_at_period_end),
    canceledAt: toIso(pick.canceled_at),
  };
}

/** @type {Map<string, { plan: 'supporter' | 'free', expires: number }>} */
const cache = new Map();
/** Write generations per user (see access.js): a read that ran across a write is not cached. */
const generations = new Map();
let epoch = 0;
/** @param {string} userId */
const generationOf = (userId) => `${epoch}:${generations.get(userId) ?? 0}`;

/** Drop a user's cached plan; call after every write to their subscriptions. @param {unknown} userId */
export function invalidatePlan(userId) {
  if (!userId) return;
  const id = String(userId);
  for (const mode of ['test', 'live']) cache.delete(`${mode}|${id}`);
  if (generations.size >= CACHE_MAX && !generations.has(id)) {
    generations.clear();
    epoch += 1;
  }
  generations.set(id, (generations.get(id) ?? 0) + 1);
}

/** Tests: forget every cached plan. */
export function resetPlanCacheForTests() {
  cache.clear();
  generations.clear();
  epoch += 1;
  lastWarnAt = -Infinity;
}

let lastWarnAt = -Infinity;
/** @param {Pick<Console, 'warn'>} logger @param {string} what @param {unknown} error @param {number} now */
const warnDb = (logger, what, error, now) => {
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  const cause = /** @type {any} */ (error)?.cause ?? error;
  logger.warn(`[Billing] ${what} failed (${cause instanceof Error ? cause.message : String(cause)}): the learner gets the free plan meanwhile.`);
};

/**
 * @typedef {{
 *   config: BillingConfig,
 *   now?: number,
 *   env?: Record<string, string | undefined>,
 *   pool?: any,
 *   alerts?: import('./billingAlerts.js').BillingAlerts,
 *   logger?: Pick<Console, 'warn'>,
 * }} PlanOptions
 */

/**
 * The plan without the cache (GET /me). `rows` and `access` are what was read (for the summary
 * and the eligibility), `cacheable` false after a database error.
 * @param {string} userId @param {PlanOptions} options
 * @returns {Promise<{ plan: 'supporter' | 'free', cacheable: boolean, rows: SubscriptionRow[] | null, access: import('../safety/access.js').AiAccess | null, error?: unknown }>}
 */
export async function computePlan(userId, { config, now = Date.now(), env = process.env, pool = getPool(), alerts = billingAlerts, logger = console }) {
  if (!config?.serviceable || !userId || userId === PHASE1_USER_ID || !billingAudienceAllows(config, userId)) {
    return { plan: 'free', cacheable: true, rows: null, access: null };
  }
  if (!pool) return { plan: 'free', cacheable: false, rows: null, access: null, error: new Error('Database not configured') };
  /** @type {SubscriptionRow[]} */
  let rows;
  try {
    rows = (await pool.query(SELECT_SUBSCRIPTIONS_SQL, [userId, config.live]))?.rows ?? [];
  } catch (error) {
    warnDb(logger, 'reading the subscriptions', error, now);
    return { plan: 'free', cacheable: false, rows: null, access: null, error };
  }
  const entitled = rows.filter((row) => isEntitled(row, now, config));
  if (entitled.length === 0) return { plan: 'free', cacheable: true, rows, access: null };
  let access;
  try {
    access = await readBillingAccess(userId, { now, env });
  } catch (error) {
    warnDb(logger, 'reading the age for the supporter plan', error, now);
    return { plan: 'free', cacheable: false, rows, access: null, error };
  }
  if (!isAdultForBilling(access)) {
    alerts.alert('minor_with_subscription', String(userId),
      `${userTag(userId)} has a ${config.mode} subscription that counts (${entitled[0].stripe_subscription_id}) but is not a recorded adult (${access.status}, ${access.audience ?? 'no age'}): they get the free caps while Stripe keeps charging. Cancel it now in the Dashboard and refund.`);
    return { plan: 'free', cacheable: true, rows, access };
  }
  return { plan: 'supporter', cacheable: true, rows, access };
}

/**
 * @param {unknown} userId @param {PlanOptions} options
 * @returns {Promise<'supporter' | 'free'>}
 */
export async function planForUser(userId, options) {
  const { config, now = Date.now() } = options;
  if (!config?.serviceable || !userId || userId === PHASE1_USER_ID || !billingAudienceAllows(config, userId)) return 'free';
  const id = String(userId);
  const key = `${config.mode}|${id}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.plan;
  const generation = generationOf(id);
  const result = await computePlan(id, { ...options, now });
  if (result.cacheable && generationOf(id) === generation) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, { plan: result.plan, expires: now + CACHE_TTL_MS });
  }
  return result.plan;
}

/**
 * The daily caps' plan resolver (dailyCaps.js setPlanResolver): null for kinds the plan does not
 * raise (no lookup), { plan: 'free' }, or the supporter's user limit and all-supporters limit.
 * @param {{ config: BillingConfig, env?: Record<string, string | undefined>, now?: () => number }} options
 * @returns {(caller: { kind: string, userId: string }) => Promise<null | { plan: 'free' } | { plan: 'supporter', user: number, global: number }>}
 */
export function createSupporterCapResolver({ config, env = process.env, now = () => Date.now() }) {
  return async ({ kind, userId }) => {
    if (!isSupporterCapKind(kind)) return null;
    const plan = await planForUser(userId, { config, env, now: now() });
    if (plan !== 'supporter') return { plan: 'free' };
    const k = /** @type {'llm'|'course_generation'} */ (kind);
    return { plan: 'supporter', user: effectiveSupporterCaps(env)[k], global: supporterGlobalCaps(env)[k] };
  };
}
