// @ts-check
/**
 * The supporter plan's API (Phase 3, doc/brushup-2026/ai-access-plan.ja.md §7). Mounted by
 * server.js at /api/v2/billing, after the logger and the global limiter and before the requireAuth
 * catch-all, through createBillingRouter({ config, stripe, now }) (config: billingConfig.js,
 * read once per app; stripe: stripeClient.js, null when billing is not serviceable). The webhook
 * (POST /webhook) is server/services/billingWebhook.js, mounted next to this router.
 *
 * GET  /plan      public: { serviceable:false, salesOpen:false } when billing is not serviceable;
 *                 otherwise the plan as the server enforces it (price, the caps from
 *                 effectiveSupporterCaps, the free caps from env, what one unit is), the 特商法 rows,
 *                 the cancellation, refund and failed-payment terms and the sales problems by name.
 *                 salesOpen is false unless live: test mode offers nothing to the public.
 * GET  /me        { plan, eligibility, pausedUntil?, salesOpen, subscription, hasCustomer, usage }
 *                 for the signed-in learner (computed without the plan cache). In test mode
 *                 everyone but BILLING_TEST_USER_IDS gets eligibility 'unavailable' and nothing else.
 * POST /checkout  { locale: 'jp'|'en' } → { url } of a Stripe Checkout Session (see below).
 * POST /portal    { locale } → { url } of the Stripe customer portal (payment method, cancellation).
 *                 No eligibility check: a subscriber whose age was corrected, or who is paused, can
 *                 always cancel (C5/C23). Needs a Customer in this mode.
 * POST /sync      re-reads the learner's subscriptions from Stripe (after Checkout returns, or a
 *                 missed webhook) → { ok, synced }.
 *
 * /me, /checkout, /portal and /sync need requireAuth with a Supabase session of a real learner:
 * the dev fallback, the bridge user (PHASE1_USER_ID) and an anonymous Supabase user get 401
 * sign_in_required (C12/C51). Not serviceable: 404 billing_off. Test mode: only testers, others
 * 404 billing_off (/me: 'unavailable'). Limited to 10 requests a minute per learner and route (GET
 * /me 20, for the return page's polling). Every refusal from this router (its own checks and its
 * per-learner limits) carries a fixed error_type; requireAuth's 401/503, the global limiter's 429
 * and the JSON parser's 400 carry only a fixed text. None ever carries Stripe's or the database's
 * text (C14). Checkout and portal URLs are never logged.
 *
 * POST /checkout, one at a time per learner (an in-process lock: the api runs as one container):
 *   salesOpen (else 404 billing_off when sales are closed, 503 billing_misconfigured for any other
 *   sales problem), a tester in test mode, eligibility 'ok' (else 403 with the eligibility as
 *   error_type), then
 *   1. the Price is checked against the plan (cached 10 min): ¥priceJpy, JPY only, monthly,
 *      tax-inclusive, active and recurring; anything else is 503 billing_misconfigured (C26);
 *   2. the learner's Customer for this mode, or a new one (metadata user_id only; Idempotency-Key
 *      customer:<mode>:<userId>; INSERT … ON CONFLICT (user_id, livemode) DO NOTHING, then the stored id is used);
 *   3. the Customer's other open Checkout Sessions are expired: all but this minute's in this
 *      locale (C24). A timeout, rate limit or 5xx on an expiry stops the checkout (503/502);
 *   4. every subscription of that Customer is re-read (billingSync.js); 409 already_subscribed when
 *      one on an accepted price is active, trialing, past_due, unpaid or paused, or incomplete and
 *      under 23 h old (C34);
 *   5. a Session whose parameters are a pure function of the Idempotency-Key
 *      checkout:<mode>:<userId>:<locale>:<minute> (expires 32 minutes after the minute began), so a
 *      double click or a retry within the minute gets the same Session back (C25/C40/C45).
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, PHASE1_USER_ID } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { dailyCapUsageFor } from '../middleware/dailyCaps.js';
import { billingAlerts } from '../services/billingAlerts.js';
import { billingAudienceAllows } from '../services/billingConfig.js';
import { checkoutSubmitMessage, disclosureRows, quantityLines, TERMS } from '../services/billingDisclosure.js';
import { computePlan, eligibilityOf, readBillingAccess, subscriptionSummary } from '../services/billingEntitlement.js';
import { CAP_KIND_USES, effectiveSupporterCaps, freeCaps, SUPPORTER_CAP_KINDS, SUPPORTER_PLAN } from '../services/billingPlan.js';
import { syncSubscription } from '../services/billingSync.js';

/** @typedef {import('../services/billingConfig.js').BillingConfig} BillingConfig */
/** @typedef {import('../services/stripeClient.js').StripeClient} StripeClient */

export const SQL = Object.freeze({
  customer: 'SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1 AND livemode = $2',
  insertCustomer: 'INSERT INTO billing_customers (stripe_customer_id, user_id, livemode) VALUES ($1, $2, $3) ON CONFLICT (user_id, livemode) DO NOTHING',
});

export const BILLING_REQUESTS_PER_MINUTE = 10;
export const BILLING_ME_REQUESTS_PER_MINUTE = 20;
const PRICE_CACHE_MS = 10 * 60 * 1000;
const BUCKET_SEC = 60;
const SESSION_LIFETIME_SEC = 32 * 60;
const INCOMPLETE_BLOCKS_MS = 23 * 60 * 60 * 1000;
/** Subscription statuses that block a new checkout (incomplete: only while young). */
const BLOCKING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);
const STRIPE_LOCALE = Object.freeze({ jp: 'ja', en: 'en' });

/** @param {import('express').Response} res @param {number} status @param {string} errorType @param {string} error @param {Record<string, unknown>} [extra] */
const refuse = (res, status, errorType, error, extra = {}) => res.status(status).json({ error, error_type: errorType, ...extra });

/** @param {import('express').Response} res */
const billingOff = (res) => refuse(res, 404, 'billing_off', 'The paid plan is not offered here.');
/** @param {import('express').Response} res */
const unavailable = (res) => {
  res.set('Retry-After', '60');
  return refuse(res, 503, 'billing_unavailable', 'Billing is not available right now. Please try again later.');
};

/** @param {import('express').Request} req */
const userIdOf = (req) => String(/** @type {any} */ (req).userId ?? '');

/** The request's locale ('jp' when absent), or null when it is not 'jp' or 'en'. @param {unknown} body */
function localeOf(body) {
  if (body === undefined || body === null) return 'jp';
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const locale = /** @type {any} */ (body).locale;
  if (locale === undefined) return 'jp';
  return locale === 'jp' || locale === 'en' ? locale : null;
}

/**
 * The Price must be the plan as the screens state it (C26). Returns the names of failed checks.
 * @param {any} price @param {BillingConfig} config
 */
export function priceProblems(price, config) {
  const problems = [];
  if (price?.unit_amount !== SUPPORTER_PLAN.priceJpy) problems.push('unit_amount');
  if (price?.currency !== 'jpy') problems.push('currency');
  const options = price?.currency_options;
  if (options && typeof options === 'object' && Object.keys(options).some((key) => key !== 'jpy')) problems.push('currency_options');
  if (price?.recurring?.interval !== SUPPORTER_PLAN.interval || price?.recurring?.interval_count !== 1) problems.push('recurring');
  if (price?.tax_behavior !== 'inclusive') problems.push('tax_behavior');
  if (price?.active !== true) problems.push('active');
  if (price?.type !== 'recurring') problems.push('type');
  if (price?.livemode !== config.live) problems.push('livemode');
  return problems;
}

/**
 * The Checkout Session parameters: a pure function of the Idempotency-Key's inputs (mode, user,
 * locale, minute) and the settings, so a replay within the minute sends identical parameters.
 * @param {{ config: BillingConfig, userId: string, customer: string, locale: 'jp'|'en', bucketSec: number, caps: Record<'llm'|'course_generation', number> }} input
 */
export function checkoutSessionParams({ config, userId, customer, locale, bucketSec, caps }) {
  const origin = config.returnOrigin;
  return {
    mode: 'subscription',
    customer,
    line_items: [{ price: config.priceId, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: { metadata: { user_id: userId } },
    success_url: `${origin}/settings/plan?checkout=done`,
    cancel_url: `${origin}/settings/plan/confirm`,
    locale: STRIPE_LOCALE[locale],
    expires_at: bucketSec + SESSION_LIFETIME_SEC,
    submit_type: 'subscribe',
    adaptive_pricing: { enabled: false },
    custom_text: { submit: { message: checkoutSubmitMessage(locale, { caps, origin }) } },
    ...(config.tosUrl ? { consent_collection: { terms_of_service: 'required' } } : {}),
  };
}

/** @param {BillingConfig} config @param {string} userId @param {'jp'|'en'} locale @param {number} bucketSec */
export const checkoutIdempotencyKey = (config, userId, locale, bucketSec) => `checkout:${config.mode}:${userId}:${locale}:${bucketSec}`;

/**
 * @param {{
 *   config: BillingConfig,
 *   stripe: StripeClient | null,
 *   now?: () => number,
 *   env?: Record<string, string | undefined>,
 *   getPool?: () => any,
 *   alerts?: import('../services/billingAlerts.js').BillingAlerts,
 *   logger?: Pick<Console, 'warn' | 'error'>,
 * }} options
 */
export function createBillingRouter({ config, stripe, now = () => Date.now(), env = process.env, getPool: poolFn = getPool, alerts = billingAlerts, logger = console }) {
  const router = express.Router();
  /** @type {{ until: number } | null} */
  let priceVerified = null;
  /** @type {Map<string, Promise<void>>} */
  const locks = new Map();

  /**
   * Keyed by a fixed route name, not req.path: Express also routes /SYNC and /sync/ to /sync, and
   * each spelling would otherwise get a bucket of its own.
   * @param {string} route @param {number} max
   */
  const perUser = (route, max) => rateLimit({
    windowMs: 60 * 1000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `billing:${route}:${userIdOf(req)}`,
    message: { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' },
    validate: { keyGeneratorIpFallback: false },
  });
  const limitMe = perUser('me', BILLING_ME_REQUESTS_PER_MINUTE);
  const limitCheckout = perUser('checkout', BILLING_REQUESTS_PER_MINUTE);
  const limitPortal = perUser('portal', BILLING_REQUESTS_PER_MINUTE);
  const limitSync = perUser('sync', BILLING_REQUESTS_PER_MINUTE);

  /** A real learner's Supabase session (not the dev fallback, the bridge user or an anonymous user). @type {import('express').RequestHandler} */
  const signedIn = (req, res, next) => {
    const r = /** @type {any} */ (req);
    if (r.authMethod !== 'supabase-jwt' || !r.userId || r.userId === PHASE1_USER_ID || r.isAnonymous === true) {
      return refuse(res, 401, 'sign_in_required', 'Sign in with a Rise Path account to manage a plan.');
    }
    return next();
  };
  /** @type {import('express').RequestHandler} */
  const serviceable = (req, res, next) => (config.serviceable && stripe ? next() : billingOff(res));
  const learner = [requireAuth, signedIn];

  /** Run `fn` after any earlier call for the same learner finished. @template T @param {string} userId @param {() => Promise<T>} fn */
  async function withUserLock(userId, fn) {
    const previous = locks.get(userId) ?? Promise.resolve();
    /** @type {() => void} */
    let release = () => {};
    const mine = new Promise((resolve) => { release = () => resolve(undefined); });
    const tail = previous.then(() => mine);
    locks.set(userId, /** @type {Promise<void>} */ (tail));
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(userId) === tail) locks.delete(userId);
    }
  }

  /**
   * Answer a failure without its text: Stripe unreachable 503, Stripe refusing 502, else (the
   * database) 503.
   * @param {import('express').Response} res @param {string} what @param {unknown} error
   */
  const failed = (res, what, error) => {
    const e = /** @type {any} */ (error);
    if (e?.name === 'StripeError') {
      if (e.status === 0) return refuse(res, 503, 'payment_provider_unavailable', 'The payment service cannot be reached right now. Please try again later.');
      return refuse(res, 502, 'payment_provider_error', 'The payment service refused the request. Please try again later.');
    }
    logger.error(`[Billing] ${what} failed (${e instanceof Error ? e.message : String(e)}).`);
    return unavailable(res);
  };

  /** @param {any} pool @param {string} userId @returns {Promise<string | null>} */
  const storedCustomer = async (pool, userId) => {
    const result = await pool.query(SQL.customer, [userId, config.live]);
    const id = result?.rows?.[0]?.stripe_customer_id;
    return id ? String(id) : null;
  };

  /** Re-read every subscription of a Customer. @param {any} pool @param {string} customer */
  const syncCustomer = async (pool, customer) => {
    const list = await /** @type {StripeClient} */ (stripe).listSubscriptions({ customer, status: 'all' });
    if (list?.has_more) logger.warn(`[Billing] customer ${customer} has more than ${list.data?.length ?? 0} subscriptions: only the first page was read.`);
    const results = [];
    for (const sub of list?.data ?? []) {
      if (typeof sub?.id !== 'string') continue;
      results.push(await syncSubscription(sub.id, { stripe: /** @type {StripeClient} */ (stripe), pool, config, now, alerts, logger }));
    }
    return results;
  };

  router.get('/plan', (req, res) => {
    if (!config.serviceable) return res.json({ serviceable: false, salesOpen: false });
    const caps = effectiveSupporterCaps(env);
    const free = freeCaps(env);
    res.json({
      serviceable: true,
      salesOpen: config.live && config.salesOpen,
      mode: config.mode,
      plan: {
        id: SUPPORTER_PLAN.id,
        name: SUPPORTER_PLAN.name,
        productName: SUPPORTER_PLAN.productName,
        priceJpy: SUPPORTER_PLAN.priceJpy,
        yearlyJpy: SUPPORTER_PLAN.priceJpy * 12,
        interval: SUPPORTER_PLAN.interval,
        caps,
        freeCaps: free,
        uses: CAP_KIND_USES,
        quantity: quantityLines({ caps, freeCaps: free }),
        resetsAt: '00:00 JST',
      },
      disclosure: { rows: disclosureRows({ caps, freeCaps: free }) },
      terms: TERMS,
      termsUrl: config.tosUrl || null,
      problems: config.salesProblems,
    });
  });

  router.get('/me', ...learner, limitMe, serviceable, async (req, res) => {
    const userId = userIdOf(req);
    if (!billingAudienceAllows(config, userId)) {
      return res.json({ plan: 'free', eligibility: 'unavailable', salesOpen: false, subscription: null, hasCustomer: false, usage: null });
    }
    const pool = poolFn();
    if (!pool) return unavailable(res);
    const t = now();
    try {
      const computed = await computePlan(userId, { config, now: t, env, pool, alerts, logger });
      if (computed.error) throw computed.error;
      const access = computed.access ?? await readBillingAccess(userId, { now: t, env });
      const { eligibility, pausedUntil } = eligibilityOf(access);
      const customer = await storedCustomer(pool, userId);
      /** @type {Record<string, { used: number, limit: number }>} */
      const usage = {};
      for (const kind of SUPPORTER_CAP_KINDS) {
        const { used, limit } = await dailyCapUsageFor({ kind, userId });
        usage[kind] = { used, limit };
      }
      res.json({
        plan: computed.plan,
        eligibility,
        ...(pausedUntil ? { pausedUntil } : {}),
        salesOpen: config.salesOpen,
        subscription: subscriptionSummary(computed.rows ?? []),
        hasCustomer: Boolean(customer),
        usage,
      });
    } catch (error) {
      return failed(res, 'GET /billing/me', error);
    }
  });

  router.post('/checkout', ...learner, limitCheckout, serviceable, async (req, res) => {
    const userId = userIdOf(req);
    if (!billingAudienceAllows(config, userId)) return billingOff(res);
    if (!config.salesOpen) {
      if (config.salesProblems.includes('sales_closed')) return billingOff(res);
      logger.warn(`[Billing] checkout refused: sales problems ${config.salesProblems.join(', ')}.`);
      return refuse(res, 503, 'billing_misconfigured', 'The paid plan cannot be sold right now.');
    }
    const locale = localeOf(req.body);
    if (!locale) return refuse(res, 400, 'validation', "locale must be 'jp' or 'en'.");
    const pool = poolFn();
    if (!pool) return unavailable(res);
    const stripeClient = /** @type {StripeClient} */ (stripe);

    let access;
    try {
      access = await readBillingAccess(userId, { now: now(), env });
    } catch (error) {
      return failed(res, 'reading the age for checkout', error);
    }
    const { eligibility, pausedUntil } = eligibilityOf(access);
    if (eligibility === 'unavailable') return unavailable(res);
    if (eligibility !== 'ok') {
      return refuse(res, 403, eligibility, 'This account cannot subscribe to the paid plan.', pausedUntil ? { paused_until: pausedUntil } : {});
    }

    try {
      return await withUserLock(userId, async () => {
        const t = now();
        if (!priceVerified || priceVerified.until <= t) {
          const price = await stripeClient.retrievePrice(config.priceId);
          const problems = priceProblems(price, config);
          if (problems.length) {
            logger.error(`[Billing] STRIPE_PRICE_ID does not match the plan (${problems.join(', ')}): checkout refused.`);
            return refuse(res, 503, 'billing_misconfigured', 'The paid plan cannot be sold right now.');
          }
          priceVerified = { until: t + PRICE_CACHE_MS };
        }

        let customer = await storedCustomer(pool, userId);
        if (!customer) {
          const created = await stripeClient.createCustomer({ metadata: { user_id: userId }, idempotencyKey: `customer:${config.mode}:${userId}` });
          if (typeof created?.id !== 'string') throw new Error('Stripe returned no customer id');
          await pool.query(SQL.insertCustomer, [created.id, userId, config.live]);
          customer = await storedCustomer(pool, userId);
          if (!customer) throw new Error('the customer row was not stored');
        }

        // Expire the other open Sessions first, so one that completes meanwhile is seen by the
        // subscription check below. Only this minute's Session in this locale is kept: it is the one
        // the Idempotency-Key replays.
        const bucketSec = Math.floor(t / 1000 / BUCKET_SEC) * BUCKET_SEC;
        const open = await stripeClient.listCheckoutSessions({ customer, status: 'open' });
        for (const session of open?.data ?? []) {
          if (typeof session?.id !== 'string') continue;
          if (Number(session.created) >= bucketSec && session.locale === STRIPE_LOCALE[locale]) continue;
          try {
            await stripeClient.expireCheckoutSession(session.id);
          } catch (error) {
            // Stripe's refusal (the Session completed or expired meanwhile) is fine: the check below
            // sees a completed one. A timeout, rate limit or 5xx leaves the Session payable, so no
            // second one is created.
            const status = /** @type {any} */ (error)?.status;
            if (!(typeof status === 'number' && status >= 400 && status < 500 && status !== 429)) throw error;
          }
        }

        const synced = await syncCustomer(pool, customer);
        const blocking = synced.find((r) => r.priceAccepted && r.status
          && (BLOCKING_STATUSES.has(r.status) || (r.status === 'incomplete' && r.createdMs != null && t - r.createdMs < INCOMPLETE_BLOCKS_MS)));
        if (blocking) {
          return refuse(res, 409, 'already_subscribed', 'You already have this plan. Manage it under Payment and cancellation.', { status: blocking.status });
        }

        const params = checkoutSessionParams({ config, userId, customer, locale, bucketSec, caps: effectiveSupporterCaps(env) });
        const session = await stripeClient.createCheckoutSession(params, { idempotencyKey: checkoutIdempotencyKey(config, userId, locale, bucketSec) });
        if (typeof session?.url !== 'string' || !session.url.startsWith('https://')) {
          logger.error('[Billing] Stripe returned a Checkout Session without an https url.');
          return refuse(res, 502, 'payment_provider_error', 'The payment service refused the request. Please try again later.');
        }
        return res.json({ url: session.url });
      });
    } catch (error) {
      return failed(res, 'POST /billing/checkout', error);
    }
  });

  router.post('/portal', ...learner, limitPortal, serviceable, async (req, res) => {
    const userId = userIdOf(req);
    if (!billingAudienceAllows(config, userId)) return billingOff(res);
    const locale = localeOf(req.body);
    if (!locale) return refuse(res, 400, 'validation', "locale must be 'jp' or 'en'.");
    const pool = poolFn();
    if (!pool) return unavailable(res);
    try {
      const customer = await storedCustomer(pool, userId);
      if (!customer) return refuse(res, 404, 'no_customer', 'There is no payment record for this account yet.');
      const session = await /** @type {StripeClient} */ (stripe).createPortalSession({
        customer,
        return_url: `${config.returnOrigin}/settings/plan`,
        locale: STRIPE_LOCALE[locale],
      });
      if (typeof session?.url !== 'string' || !session.url.startsWith('https://')) {
        logger.error('[Billing] Stripe returned a portal session without an https url.');
        return refuse(res, 502, 'payment_provider_error', 'The payment service refused the request. Please try again later.');
      }
      return res.json({ url: session.url });
    } catch (error) {
      return failed(res, 'POST /billing/portal', error);
    }
  });

  router.post('/sync', ...learner, limitSync, serviceable, async (req, res) => {
    const userId = userIdOf(req);
    if (!billingAudienceAllows(config, userId)) return billingOff(res);
    const pool = poolFn();
    if (!pool) return unavailable(res);
    try {
      const customer = await storedCustomer(pool, userId);
      if (!customer) return res.json({ ok: true, synced: 0 });
      const results = await syncCustomer(pool, customer);
      return res.json({ ok: true, synced: results.filter((r) => r.outcome === 'synced' || r.outcome === 'stale').length });
    } catch (error) {
      return failed(res, 'POST /billing/sync', error);
    }
  });

  return router;
}
