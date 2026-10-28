// @ts-check
/**
 * Billing settings (Phase 3), read once per app from billing.env (deploy/risepath-vm, api service
 * only) or .env.local. Two states (C2/C15/C30), so stopping sales never stops serving people who
 * already pay:
 *
 *   serviceable  a valid Stripe key (sk_/rk_, test or live), at least one whsec_ webhook secret
 *                (comma-separated during a rotation), STRIPE_PRICE_ID, BILLING_RETURN_ORIGIN
 *                (https; http only to localhost outside production), and BILLING_LIVE=true when
 *                the key is a live key. Drives the webhook, GET /me, /portal, /sync and the
 *                supporter caps. Does not depend on BILLING_ENABLED or the disclosure.
 *   salesOpen    serviceable, BILLING_ENABLED exactly "true", and no sales problem: in test mode
 *                a non-empty BILLING_TEST_USER_IDS of uuids; in live mode no 【要記入】 left in
 *                the 特商法 owner facts and BILLING_TOS_URL set; supporter caps that raise
 *                something (billingPlan.js supporterCapProblems). Drives only POST /checkout and
 *                the buy button.
 *
 * Test mode (a test key) runs on the production API, so every user-facing billing action, the
 * supporter caps included, is limited to BILLING_TEST_USER_IDS there (C1/C31/C42): everyone else
 * sees no paid service, even with a test-mode subscription row.
 *
 * Problems are reported by name only (never a value). acceptedPriceIds are the prices that keep
 * a subscriber entitled: STRIPE_PRICE_IDS_ACCEPTED plus STRIPE_PRICE_ID, so moving new sales to a
 * new Price does not strand people on the old one (C10/C21/C39).
 */
import { getPool } from '../db.js';
import { isUuid } from '../utils/ids.js';
import { billingAlerts } from './billingAlerts.js';
import { disclosurePlaceholders, OWNER_FACTS } from './billingDisclosure.js';
import { supporterCapProblems } from './billingPlan.js';

/** @typedef {Record<string, string | undefined>} Env */
/**
 * @typedef {{
 *   configured: boolean,
 *   serviceable: boolean,
 *   salesOpen: boolean,
 *   live: boolean,
 *   mode: 'test' | 'live' | null,
 *   testUserIds: Set<string>,
 *   secretKey: string,
 *   webhookSecrets: string[],
 *   priceId: string,
 *   acceptedPriceIds: Set<string>,
 *   returnOrigin: string,
 *   tosUrl: string,
 *   serviceProblems: string[],
 *   salesProblems: string[],
 *   warnings: string[],
 * }} BillingConfig
 */

/** Names read by readBillingConfig (billing.env.example lists the same; tests save and restore them). */
export const BILLING_ENV_KEYS = Object.freeze([
  'BILLING_ENABLED', 'BILLING_LIVE', 'BILLING_TEST_USER_IDS', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID', 'STRIPE_PRICE_IDS_ACCEPTED', 'BILLING_RETURN_ORIGIN', 'BILLING_TOS_URL',
  'AI_CAP_SUPPORTER_GLOBAL_LLM', 'AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION',
]);

const SECRET_KEY = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=_-]+$/;
/** Stripe object ids are opaque (C27): a printable token, at most 255 characters. */
const OBJECT_ID = /^[A-Za-z0-9_]{1,255}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** @param {unknown} raw */
const list = (raw) => String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * An https origin (http only to localhost outside production), or null.
 * @param {string} raw @param {boolean} production
 */
function parseOrigin(raw, production) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local && !production))) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  if (raw.trim().replace(/\/$/, '') !== url.origin) return null;
  return url.origin;
}

/**
 * An https URL (http only to localhost outside production), or null.
 * @param {string} raw @param {boolean} production
 */
function parseHttpsUrl(raw, production) {
  try {
    const url = new URL(raw);
    const local = LOCAL_HOSTS.has(url.hostname);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local && !production)) return url.href;
  } catch {
    // not a URL
  }
  return null;
}

/**
 * @param {Env} [env]
 * @param {{ nodeEnv?: string, ownerFacts?: Parameters<typeof disclosurePlaceholders>[0] }} [options]
 *   ownerFacts: the 特商法 owner facts to check (tests; default the real ones)
 * @returns {BillingConfig}
 */
export function readBillingConfig(env = process.env, { nodeEnv = env.NODE_ENV, ownerFacts = OWNER_FACTS } = {}) {
  const production = nodeEnv === 'production';
  /** @type {string[]} */
  const serviceProblems = [];
  /** @type {string[]} */
  const salesProblems = [];
  /** @type {string[]} */
  const warnings = [];

  const configured = BILLING_ENV_KEYS.some((key) => /^(?:BILLING|STRIPE)_/.test(key) && String(env[key] ?? '').trim() !== '');

  const secretKey = String(env.STRIPE_SECRET_KEY ?? '').trim();
  const keyMatch = SECRET_KEY.exec(secretKey);
  if (!keyMatch) serviceProblems.push('STRIPE_SECRET_KEY');
  const live = keyMatch?.[1] === 'live';
  if (live && env.BILLING_LIVE !== 'true') serviceProblems.push('BILLING_LIVE');

  const secrets = list(env.STRIPE_WEBHOOK_SECRET);
  const webhookSecrets = secrets.filter((s) => WEBHOOK_SECRET.test(s));
  if (webhookSecrets.length === 0) serviceProblems.push('STRIPE_WEBHOOK_SECRET');
  else if (webhookSecrets.length < secrets.length) warnings.push('STRIPE_WEBHOOK_SECRET (an entry that is not whsec_… is ignored)');

  const priceId = String(env.STRIPE_PRICE_ID ?? '').trim();
  if (!OBJECT_ID.test(priceId)) serviceProblems.push('STRIPE_PRICE_ID');
  const extraPrices = list(env.STRIPE_PRICE_IDS_ACCEPTED);
  const acceptedPriceIds = new Set(extraPrices.filter((id) => OBJECT_ID.test(id)));
  if (acceptedPriceIds.size < extraPrices.length) warnings.push('STRIPE_PRICE_IDS_ACCEPTED (an entry that is not a price id is ignored)');
  if (OBJECT_ID.test(priceId)) acceptedPriceIds.add(priceId);

  const returnOrigin = parseOrigin(String(env.BILLING_RETURN_ORIGIN ?? '').trim(), production) ?? '';
  if (!returnOrigin) serviceProblems.push('BILLING_RETURN_ORIGIN');

  const serviceable = serviceProblems.length === 0;

  if (env.BILLING_ENABLED !== 'true') salesProblems.push('sales_closed');
  const testers = list(env.BILLING_TEST_USER_IDS);
  const testUserIds = new Set(testers.filter(isUuid).map((id) => id.toLowerCase()));
  // Empty, or an entry that is not a uuid (a repeated id is not a problem).
  if (!live && (testers.length === 0 || !testers.every(isUuid))) salesProblems.push('test_user_ids');
  const rawTos = String(env.BILLING_TOS_URL ?? '').trim();
  const tosUrl = rawTos ? parseHttpsUrl(rawTos, production) ?? '' : '';
  if (rawTos && !tosUrl) salesProblems.push('tos_url');
  if (live) {
    if (!rawTos) salesProblems.push('tos_url');
    if (disclosurePlaceholders(ownerFacts).length > 0) salesProblems.push('disclosure_placeholders');
  }
  for (const { kind, reason } of supporterCapProblems(env)) salesProblems.push(`supporter_caps_${reason}:${kind}`);

  return {
    configured,
    serviceable,
    salesOpen: serviceable && salesProblems.length === 0,
    live: serviceable && live,
    mode: serviceable ? (live ? 'live' : 'test') : null,
    testUserIds: live ? new Set() : testUserIds,
    secretKey: serviceable ? secretKey : '',
    webhookSecrets: serviceable ? webhookSecrets : [],
    priceId: serviceable ? priceId : '',
    acceptedPriceIds: serviceable ? acceptedPriceIds : new Set(),
    returnOrigin,
    tosUrl,
    serviceProblems,
    salesProblems: [...new Set(salesProblems)],
    warnings,
  };
}

/**
 * The caller may use billing in this mode: anyone in live mode, only testers in test mode.
 * @param {BillingConfig} config @param {unknown} userId
 */
export const billingAudienceAllows = (config, userId) => Boolean(userId)
  && (config.live || config.testUserIds.has(String(userId).toLowerCase()));

/**
 * The startup line: "billing: off", "billing: test (serviceable, sales open)",
 * "billing: live (serviceable, sales closed: tos_url)" or "billing: unserviceable (…)". Names only.
 * @param {BillingConfig} config
 */
export function billingStartupLine(config) {
  const warn = config.warnings.length ? `; ignored: ${config.warnings.join(', ')}` : '';
  if (!config.serviceable) {
    return config.configured
      ? `[Billing] billing: off, not serviceable (missing or invalid: ${config.serviceProblems.join(', ')})${warn}`
      : '[Billing] billing: off';
  }
  const sales = config.salesOpen ? 'sales open' : `sales closed: ${config.salesProblems.join(', ')}`;
  const audience = config.live ? '' : `, ${config.testUserIds.size} test users`;
  return `[Billing] billing: ${config.mode} (serviceable, ${sales}${audience})${warn}`;
}

/**
 * At startup: when billing is not serviceable while subscriptions that may still be charged exist
 * (any mode), tell the owner. Their supporter caps, the portal and the webhook are off until the
 * config is fixed, while Stripe keeps renewing. Never throws.
 * @param {BillingConfig} config
 * @param {{ pool?: any, alerts?: import('./billingAlerts.js').BillingAlerts, logger?: Pick<Console, 'warn'> }} [options]
 */
export async function checkBillingServiceable(config, { pool = getPool(), alerts = billingAlerts, logger = console } = {}) {
  if (config.serviceable || !pool) return false;
  try {
    const result = await pool.query(
      `SELECT livemode, count(*)::int AS n FROM billing_subscriptions
       WHERE status NOT IN ('canceled', 'incomplete_expired') GROUP BY livemode ORDER BY livemode`,
    );
    const rows = result?.rows ?? [];
    if (rows.length === 0) return false;
    const counts = rows.map((row) => `${row.livemode ? 'live' : 'test'} ${Number(row.n) || 0}`).join(', ');
    alerts.alert('billing_unserviceable', 'startup',
      `billing is not serviceable (${config.serviceProblems.join(', ')}) while subscriptions are not ended (${counts}). Subscribers get the free caps and cannot open the portal; fix billing.env or cancel them in the Stripe Dashboard.`);
    return true;
  } catch (error) {
    logger.warn(`[Billing] could not check for open subscriptions (${error instanceof Error ? error.message : String(error)}). Is migration 017 applied?`);
    return false;
  }
}
