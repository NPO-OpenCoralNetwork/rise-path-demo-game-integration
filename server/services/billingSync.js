// @ts-check
/**
 * One subscription, re-read from Stripe and stored (Phase 3): shared by the webhook
 * (billingWebhook.js), POST /sync and POST /checkout (server/routes/billing.js). Stripe events can
 * be stale, duplicated and out of order, so an event only names the subscription; its state always
 * comes from a fresh GET (C11/C18/C52):
 *
 *   1. Note fetchStartedAt, then GET /v1/subscriptions/{id} with no database client held.
 *   2. Find the learner ONLY through billing_customers (customer id + mode): a Customer Rise Path
 *      did not create (a donation on the same Stripe account, say) is not stored ('unknown_customer',
 *      owner alert). The subscription's metadata user_id is only cross-checked ('user_mismatch',
 *      the mapping wins). A Customer whose user_id is NULL belonged to a deleted Rise Path account
 *      (Phase 4; migration 017 ON DELETE SET NULL): one log line, not a mismatch alert.
 *   3. One upsert whose synced_at is fetchStartedAt; it replaces a row only when the stored
 *      synced_at is not newer, so the read that started last wins. Every state change sends an
 *      event whose read starts after the change, so the row converges.
 *   4. invalidatePlan(user). A price that is not accepted is stored but never entitled
 *      ('unknown_price'); a second subscription that is not ended alerts 'duplicate_subscription'.
 *
 * Stripe 404 resource_missing (a deleted test object) is 'missing', not an error. Anything else
 * (Stripe unreachable, a database error) throws, so the webhook answers 500 and Stripe retries.
 */
import { billingAlerts, userTag } from './billingAlerts.js';
import { invalidatePlan, TERMINAL_STATUSES } from './billingEntitlement.js';

/** @typedef {import('./billingConfig.js').BillingConfig} BillingConfig */
/** @typedef {import('./stripeClient.js').StripeClient} StripeClient */

/** The statuses migration 017 accepts. */
export const SUBSCRIPTION_STATUSES = Object.freeze(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);

export const SQL = Object.freeze({
  customerOwner: 'SELECT user_id FROM billing_customers WHERE stripe_customer_id = $1 AND livemode = $2',
  upsert: `INSERT INTO billing_subscriptions (stripe_subscription_id, stripe_customer_id, user_id, status, price_id, livemode,
  current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, stripe_created, synced_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (stripe_subscription_id) DO UPDATE SET
  stripe_customer_id = EXCLUDED.stripe_customer_id, user_id = EXCLUDED.user_id, status = EXCLUDED.status,
  price_id = EXCLUDED.price_id, livemode = EXCLUDED.livemode, current_period_start = EXCLUDED.current_period_start,
  current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
  cancel_at = EXCLUDED.cancel_at, canceled_at = EXCLUDED.canceled_at, stripe_created = EXCLUDED.stripe_created,
  synced_at = EXCLUDED.synced_at
WHERE billing_subscriptions.synced_at <= EXCLUDED.synced_at
RETURNING stripe_subscription_id`,
  openForUser: `SELECT stripe_subscription_id FROM billing_subscriptions
WHERE user_id = $1 AND livemode = $2 AND status <> ALL($3::text[]) AND price_id = ANY($4::text[])
ORDER BY stripe_subscription_id`,
});

/** Unix seconds from Stripe as a Date, or null. @param {unknown} seconds */
const fromUnix = (seconds) => (typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null);

/** An expandable Stripe field's id. @param {unknown} value */
export const idOf = (value) => {
  if (typeof value === 'string') return value;
  const id = /** @type {any} */ (value)?.id;
  return typeof id === 'string' ? id : null;
};

/**
 * @typedef {{
 *   outcome: 'synced' | 'stale' | 'missing' | 'unknown_customer' | 'ignored_mode' | 'unknown_status',
 *   subscriptionId: string,
 *   userId?: string | null,
 *   status?: string,
 *   priceAccepted?: boolean,
 *   createdMs?: number | null,
 * }} SyncResult
 */

/**
 * @param {string} subscriptionId
 * @param {{
 *   stripe: StripeClient,
 *   pool: any,
 *   config: BillingConfig,
 *   now?: () => number,
 *   alerts?: import('./billingAlerts.js').BillingAlerts,
 *   logger?: Pick<Console, 'warn' | 'error'>,
 * }} options
 * @returns {Promise<SyncResult>}
 */
export async function syncSubscription(subscriptionId, { stripe, pool, config, now = () => Date.now(), alerts = billingAlerts, logger = console }) {
  const fetchStartedAt = new Date(now());
  let sub;
  try {
    sub = await stripe.retrieveSubscription(subscriptionId);
  } catch (error) {
    const e = /** @type {any} */ (error);
    if (e?.status === 404 && e?.code === 'resource_missing') {
      logger.warn(`[Billing] subscription ${subscriptionId} no longer exists at Stripe: nothing stored.`);
      return { outcome: 'missing', subscriptionId };
    }
    throw error;
  }

  const id = idOf(sub) ?? subscriptionId;
  const livemode = sub?.livemode === true;
  if (livemode !== config.live) return { outcome: 'ignored_mode', subscriptionId: id };
  const customerId = idOf(sub?.customer);
  const status = String(sub?.status ?? '');
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    logger.error(`[Billing] subscription ${id} has a status this version does not know (${status.slice(0, 40)}): not stored.`);
    return { outcome: 'unknown_status', subscriptionId: id };
  }

  const owner = customerId ? await pool.query(SQL.customerOwner, [customerId, livemode]) : { rows: [] };
  if (!owner?.rows?.length) {
    alerts.alert('unknown_customer', id,
      `subscription ${id} (${livemode ? 'live' : 'test'}) belongs to customer ${customerId ?? 'none'}, which Rise Path did not create: not stored. Check it in the Stripe Dashboard.`);
    return { outcome: 'unknown_customer', subscriptionId: id };
  }
  const userId = owner.rows[0].user_id ? String(owner.rows[0].user_id) : null;
  const metadataUser = typeof sub?.metadata?.user_id === 'string' ? sub.metadata.user_id : null;
  if (!userId) {
    // The account was deleted (server/services/accountDeletion.js); its subscription's later events
    // (an ending plan's customer.subscription.deleted, say) still name it in the metadata.
    const renewing = !TERMINAL_STATUSES.includes(status) && sub?.cancel_at_period_end !== true && (sub?.cancel_at === null || sub?.cancel_at === undefined);
    logger.warn(`[Billing] subscription ${id} (${status}) belongs to a deleted Rise Path account (customer ${customerId}): stored without a user${renewing ? '; it still renews: cancel it in the Stripe Dashboard' : ''}.`);
  } else if (metadataUser && metadataUser.toLowerCase() !== userId.toLowerCase()) {
    alerts.alert('user_mismatch', id,
      `subscription ${id} names another user in its metadata than its customer ${customerId} maps to (${userTag(userId)}): the customer mapping is used.`);
  }

  const item = sub?.items?.data?.[0];
  const priceId = idOf(item?.price);
  const priceAccepted = Boolean(priceId && config.acceptedPriceIds.has(priceId));
  if (!priceAccepted) {
    alerts.alert('unknown_price', id,
      `subscription ${id} (${userTag(userId)}) is on price ${priceId ?? 'none'}, which is not STRIPE_PRICE_ID or in STRIPE_PRICE_IDS_ACCEPTED: stored, but it gives no supporter caps.`);
  }

  const result = await pool.query(SQL.upsert, [
    id,
    customerId,
    userId,
    status,
    priceId,
    livemode,
    fromUnix(item?.current_period_start),
    fromUnix(item?.current_period_end),
    sub?.cancel_at_period_end === true,
    fromUnix(sub?.cancel_at),
    fromUnix(sub?.canceled_at),
    fromUnix(sub?.created),
    fetchStartedAt,
  ]);
  const written = Boolean(result?.rows?.length);
  if (userId) {
    invalidatePlan(userId);
    if (written && priceAccepted && !TERMINAL_STATUSES.includes(status)) {
      const open = await pool.query(SQL.openForUser, [userId, livemode, [...TERMINAL_STATUSES], [...config.acceptedPriceIds]]);
      const ids = (open?.rows ?? []).map((row) => String(row.stripe_subscription_id));
      if (ids.length > 1) {
        alerts.alert('duplicate_subscription', userId,
          `${userTag(userId)} has ${ids.length} subscriptions that are not ended (${ids.join(', ')}). Cancel and refund the extra one in the Stripe Dashboard.`);
      }
    }
  }
  return {
    outcome: written ? 'synced' : 'stale',
    subscriptionId: id,
    userId,
    status,
    priceAccepted,
    createdMs: typeof sub?.created === 'number' ? sub.created * 1000 : null,
  };
}
