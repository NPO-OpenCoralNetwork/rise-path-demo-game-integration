// @ts-check
/**
 * Owner alerts for billing (Phase 3): things a person has to look at in the Stripe Dashboard.
 * Logged as an error ("[Billing] <kind>: …") and posted to AI_CAP_ALERT_WEBHOOK_URL when it is set,
 * through the daily caps' webhook path (parseAlertWebhook / postAlert in dailyCaps.js; the URL is a
 * secret and never logged). Each alert is sent once per kind and key per Japan-time day; the key
 * is an event id, a subscription id or a user id, so a retried webhook or a cached plan lookup
 * does not repeat it. Lines carry Stripe object ids and a user id prefix only: no names, emails,
 * card details or URLs.
 *
 * Kinds: billing_unserviceable, unknown_customer, user_mismatch, unknown_price,
 * duplicate_subscription, minor_with_subscription, charge_refunded, charge_dispute,
 * deleted_account_renewing (a subscription of a deleted Rise Path account still renews: cancel it
 * in the Stripe Dashboard; from server/services/billingSync.js and the deletion's re-check after
 * COMMIT, server/services/accountDeletion.js; the key is the subscription id or the 8-character
 * account tag).
 */
import { jstDay, parseAlertWebhook, postAlert } from '../middleware/dailyCaps.js';

export const BILLING_ALERT_KINDS = Object.freeze([
  'billing_unserviceable', 'unknown_customer', 'user_mismatch', 'unknown_price',
  'duplicate_subscription', 'minor_with_subscription', 'charge_refunded', 'charge_dispute',
  'deleted_account_renewing',
]);

/** Keys kept per day before the set is cleared (a flood must not grow memory). */
const MAX_KEYS = 5000;

/** A user id as alerts show it: the first 8 characters. @param {unknown} userId */
export const userTag = (userId) => (userId ? `user ${String(userId).slice(0, 8)}` : 'no user');

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof fetch,
 *   logger?: Pick<Console, 'warn' | 'error'>,
 *   now?: () => number,
 * }} [options]
 */
export function createBillingAlerts({ env = process.env, fetch: fetchImpl, logger = console, now = () => Date.now() } = {}) {
  /** @type {Set<string>} */
  const sent = new Set();
  let day = '';
  let warnedWebhook = '';

  /**
   * Send one alert unless this kind and key already went out today. Returns whether it was sent.
   * @param {typeof BILLING_ALERT_KINDS[number]} kind @param {string} key @param {string} line
   */
  function alert(kind, key, line) {
    if (!BILLING_ALERT_KINDS.includes(kind)) throw new Error(`Unknown billing alert kind: ${kind}`);
    const today = jstDay(now());
    if (today !== day || sent.size >= MAX_KEYS) {
      sent.clear();
      day = today;
    }
    const id = `${kind}|${key}`;
    if (sent.has(id)) return false;
    sent.add(id);
    const full = `[Billing] ${kind}: ${line}`;
    logger.error(full);
    const raw = env.AI_CAP_ALERT_WEBHOOK_URL?.trim() ?? '';
    const post = fetchImpl ?? globalThis.fetch;
    if (!raw || !post) return true;
    const parsed = parseAlertWebhook(raw);
    if (typeof parsed === 'string') {
      if (warnedWebhook !== raw) {
        warnedWebhook = raw;
        logger.warn(`[Billing] ${parsed}: billing alerts are not posted.`);
      }
      return true;
    }
    void postAlert(parsed.href, full, post, logger);
    return true;
  }

  /** Forget what was sent (tests). */
  function reset() {
    sent.clear();
    day = '';
    warnedWebhook = '';
  }

  return { alert, reset };
}

/** @typedef {ReturnType<typeof createBillingAlerts>} BillingAlerts */

/** The process-wide alerts (one dedupe set for the webhook, the routes and the plan lookups). */
export const billingAlerts = createBillingAlerts();
export const resetBillingAlertsForTests = billingAlerts.reset;
