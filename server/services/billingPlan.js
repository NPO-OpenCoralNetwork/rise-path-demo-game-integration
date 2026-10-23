// @ts-check
/**
 * The one paid plan (Phase 3, doc/brushup-2026/ai-access-plan.ja.md §7): the single source for its
 * price, its daily caps and the text that describes them. Server-only (lint:arch keeps components
 * from importing server/), so the plan page, the final confirmation screen and the 特定商取引法
 * page render every number from GET /api/v2/billing/plan (server/routes/billing.js) of the running
 * server, never from a copy bundled into the client. The caps the screens show are the caps
 * server/middleware/dailyCaps.js enforces: both come from effectiveSupporterCaps(env).
 *
 * Changing the price or lowering a cap for people who already subscribe needs advance notice and
 * applies from their next period (民法548条の4); a new price is a new Stripe Price
 * (STRIPE_PRICE_ID for new sales, the old one kept in STRIPE_PRICE_IDS_ACCEPTED).
 */
import { resolveCapLimits } from '../middleware/dailyCaps.js';

/** @typedef {'llm'|'course_generation'} SupporterCapKind */
/** @typedef {{ jp: string, en: string }} Copy */

/** Per learner per Japan-time day. Kinds not listed here keep the free caps for supporters. */
const PLAN_CAPS = Object.freeze({ llm: 100, course_generation: 30 });

export const SUPPORTER_PLAN = Object.freeze({
  id: 'supporter',
  name: Object.freeze({ jp: 'サポータープラン', en: 'Supporter plan' }),
  productName: Object.freeze({ jp: 'サポータープラン（月額・自動更新）', en: 'Supporter plan (monthly, auto-renewing)' }),
  /** Japanese yen per month, consumption tax included (税込). The Stripe Price must match it. */
  priceJpy: 500,
  interval: /** @type {'month'} */ ('month'),
  /** @type {Readonly<Record<SupporterCapKind, number>>} */
  caps: PLAN_CAPS,
});

/** The kinds the plan raises, in display order. */
export const SUPPORTER_CAP_KINDS = /** @type {readonly SupporterCapKind[]} */ (Object.freeze(Object.keys(PLAN_CAPS)));

/**
 * Late renewals and failed payments: an active subscription stays a supporter this long after its
 * period ends, a past_due one this long after its (unpaid) period started.
 */
export const BILLING_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * What one unit of each raised kind is, for the screens (C35): every route that charges `llm` is
 * named here, so a new llm route updates the copy in one place.
 */
export const CAP_KIND_USES = Object.freeze({
  llm: Object.freeze({
    jp: Object.freeze(['AI チューター', '作文フィードバック', '診断の解説']),
    en: Object.freeze(['AI tutor', 'writing feedback', 'assessment explanations']),
  }),
  course_generation: Object.freeze({
    jp: '1 コースでふつう 3 回、修正 1 回ごとに 1 回',
    en: 'usually 3 per course, plus 1 per revision',
  }),
});

/** All-users pool for supporters, per kind per day ('*supporter' in ai_daily_usage). */
const SUPPORTER_GLOBAL_DEFAULTS = Object.freeze({ llm: 1000, course_generation: 200 });
const MAX_LIMIT = 2147483647;

/** @param {string} kind */
export const isSupporterCapKind = (kind) => Object.prototype.hasOwnProperty.call(PLAN_CAPS, kind);

/**
 * Free user caps of the raised kinds, as resolveCapLimits reads them from env (not the defaults).
 * @param {Record<string, string | undefined>} [env]
 * @param {{ logger?: Pick<Console, 'warn'> }} [options]
 * @returns {Record<SupporterCapKind, number>}
 */
export function freeCaps(env = process.env, { logger } = {}) {
  const limits = resolveCapLimits(env, logger ? { logger } : undefined);
  return /** @type {Record<SupporterCapKind, number>} */ (Object.fromEntries(SUPPORTER_CAP_KINDS.map((kind) => [kind, limits[kind].user])));
}

/**
 * The supporter's user limit per raised kind: the plan cap, or the free cap when an owner raised
 * that above it (a paying learner never gets less than a free one, C20).
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<SupporterCapKind, number>}
 */
export function effectiveSupporterCaps(env = process.env) {
  const free = freeCaps(env);
  return /** @type {Record<SupporterCapKind, number>} */ (Object.fromEntries(SUPPORTER_CAP_KINDS.map((kind) => [kind, Math.max(PLAN_CAPS[kind], free[kind])])));
}

/** Bad AI_CAP_SUPPORTER_GLOBAL_* values already reported. */
const warnedGlobalKeys = new Set();

/**
 * The supporters' all-users limit per raised kind, from AI_CAP_SUPPORTER_GLOBAL_<KIND> (a whole
 * number; 0 turns the kind off for supporters; unset or empty is the default; anything else falls
 * back to the default with one warning per key).
 * @param {Record<string, string | undefined>} [env]
 * @param {{ logger?: Pick<Console, 'warn'> }} [options]
 * @returns {Record<SupporterCapKind, number>}
 */
export function supporterGlobalCaps(env = process.env, { logger = console } = {}) {
  return /** @type {Record<SupporterCapKind, number>} */ (Object.fromEntries(SUPPORTER_CAP_KINDS.map((kind) => {
    const key = `AI_CAP_SUPPORTER_GLOBAL_${kind.toUpperCase()}`;
    const raw = env[key];
    const fallback = SUPPORTER_GLOBAL_DEFAULTS[kind];
    const value = String(raw ?? '').trim();
    // Unset or empty (billing.env.example lists the names with empty values): the default.
    if (value === '') return [kind, fallback];
    if (/^\d+$/.test(value)) return [kind, Math.min(Number(value), MAX_LIMIT)];
    if (!warnedGlobalKeys.has(key)) {
      warnedGlobalKeys.add(key);
      logger.warn(`[Billing] ${key}=${JSON.stringify(raw)} is not a whole number (0 or more): using the default ${fallback}.`);
    }
    return [kind, fallback];
  })));
}

/**
 * Why the plan cannot be sold as advertised with this env, per kind: 'off' when a free cap of the
 * kind is 0 (AI_CAP_USER/IP/GLOBAL_<KIND>: off for everyone) or the supporter pool is 0, and
 * 'not_above_free' when the plan cap is not above the free user cap (the plan would add nothing).
 * A sales problem only: existing subscribers keep the portal and the webhook (billingConfig.js).
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ kind: SupporterCapKind, reason: 'off' | 'not_above_free' }[]}
 */
export function supporterCapProblems(env = process.env) {
  const limits = resolveCapLimits(env);
  const pool = supporterGlobalCaps(env);
  /** @type {{ kind: SupporterCapKind, reason: 'off' | 'not_above_free' }[]} */
  const problems = [];
  for (const kind of SUPPORTER_CAP_KINDS) {
    const { user, ip, global } = limits[kind];
    if (user === 0 || ip === 0 || global === 0 || pool[kind] === 0) problems.push({ kind, reason: 'off' });
    else if (PLAN_CAPS[kind] <= user) problems.push({ kind, reason: 'not_above_free' });
  }
  return problems;
}
