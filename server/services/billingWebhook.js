// @ts-check
/**
 * POST /api/v2/billing/webhook: Stripe's events (Phase 3). server.js registers
 * express.raw({ type: 'application/json', limit: '512kb' }) for this path before the global JSON
 * parser, and mounts this handler after the logger and the global limiter, before the requireAuth
 * catch-all (C8/C29/C43): Stripe sends no JWT, and the signature covers the exact bytes.
 *
 *   400 bad_request      the body was not read as raw JSON bytes
 *   503 billing_off      billing is not serviceable: Stripe retries (a 404 would be a failure it
 *                        stops retrying after a while; nothing is lost while the owner fixes it)
 *   400 bad_signature    Stripe-Signature does not verify (the reason code is logged only)
 *   400 bad_payload      the verified body is not an event
 *   200 { received: true, outcome }
 *        ignored_mode    a test event on a live config or the reverse (not recorded)
 *        duplicate       this event id was already processed
 *        synced | stale | missing | unknown_customer | unknown_status | no_subscription
 *                        a subscription event, re-read from Stripe (billingSync.js)
 *        alerted         charge.refunded, charge.dispute.created: an owner alert only (the
 *                        runbook: cancel the subscription in the Dashboard, then refund)
 *        ignored_type    any other type
 *   500                  Stripe or the database failed: the event stays unprocessed and Stripe
 *                        retries it (with a new signature)
 *
 * Signatures: t= once, every v1= (one per secret during a rotation), others (v0) ignored,
 * |now − t| ≤ 300 s, HMAC-SHA256 keyed with the whole whsec_… string over `${t}.${rawBody}`,
 * compared in constant time on equal-length buffers, any secret against any v1.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPool } from '../db.js';
import { billingAlerts } from './billingAlerts.js';
import { idOf, syncSubscription } from './billingSync.js';

/** @typedef {import('./billingConfig.js').BillingConfig} BillingConfig */

export const BILLING_WEBHOOK_PATH = '/api/v2/billing/webhook';
export const BILLING_WEBHOOK_BODY_LIMIT = '512kb';
export const SIGNATURE_TOLERANCE_SEC = 300;

export const SQL = Object.freeze({
  record: 'INSERT INTO billing_events (event_id, type, livemode) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
  processedAt: 'SELECT processed_at FROM billing_events WHERE event_id = $1',
  markProcessed: 'UPDATE billing_events SET processed_at = now(), outcome = $2 WHERE event_id = $1',
});

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
]);
const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_failed']);

/**
 * @param {Buffer | string} raw  the exact request body
 * @param {unknown} header  the Stripe-Signature header
 * @param {string[]} secrets  whsec_… values (several during a rotation)
 * @param {{ now?: number, toleranceSec?: number }} [options]  now in milliseconds
 * @returns {{ ok: true, timestamp: number } | { ok: false, reason: 'no_header' | 'malformed' | 'no_v1' | 'too_old' | 'too_new' | 'no_secret' | 'mismatch' }}
 */
export function verifyStripeSignature(raw, header, secrets, { now = Date.now(), toleranceSec = SIGNATURE_TOLERANCE_SEC } = {}) {
  if (typeof header !== 'string' || !header.trim()) return { ok: false, reason: 'no_header' };
  /** @type {string[]} */
  const timestamps = [];
  /** @type {string[]} */
  const v1 = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't') timestamps.push(value);
    else if (key === 'v1') v1.push(value);
  }
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0])) return { ok: false, reason: 'malformed' };
  if (v1.length === 0) return { ok: false, reason: 'no_v1' };
  const t = Number(timestamps[0]);
  // A tolerance of 0 (or less) would accept nothing on a real network; never allow it.
  const tolerance = toleranceSec > 0 ? toleranceSec : SIGNATURE_TOLERANCE_SEC;
  const nowSec = Math.floor(now / 1000);
  if (nowSec - t > tolerance) return { ok: false, reason: 'too_old' };
  if (t - nowSec > tolerance) return { ok: false, reason: 'too_new' };
  const usable = (secrets ?? []).filter((s) => typeof s === 'string' && s.length > 0);
  if (usable.length === 0) return { ok: false, reason: 'no_secret' };
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  const provided = v1.filter((hex) => /^[0-9a-f]+$/i.test(hex)).map((hex) => Buffer.from(hex, 'hex'));
  for (const secret of usable) {
    const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
    for (const candidate of provided) {
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return { ok: true, timestamp: t };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

/** The subscription an event is about, or null. @param {any} event */
export function subscriptionIdOf(event) {
  const type = String(event?.type ?? '');
  const object = event?.data?.object;
  if (type === 'checkout.session.completed') return idOf(object?.subscription);
  if (SUBSCRIPTION_EVENTS.has(type)) return idOf(object);
  if (INVOICE_EVENTS.has(type)) return idOf(object?.parent?.subscription_details?.subscription) ?? idOf(object?.subscription);
  return null;
}

/** @param {unknown} value @param {number} max */
const isBoundedString = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max;

/**
 * @param {{
 *   config: BillingConfig,
 *   stripe: import('./stripeClient.js').StripeClient | null,
 *   now?: () => number,
 *   getPool?: () => any,
 *   alerts?: import('./billingAlerts.js').BillingAlerts,
 *   logger?: Pick<Console, 'warn' | 'error'>,
 * }} options
 * @returns {import('express').RequestHandler}
 */
export function createBillingWebhook({ config, stripe, now = () => Date.now(), getPool: poolFn = getPool, alerts = billingAlerts, logger = console }) {
  return async function billingWebhook(req, res) {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Send the event as application/json.', error_type: 'bad_request' });
    }
    if (!config.serviceable || !stripe) {
      res.set('Retry-After', '600');
      return res.status(503).json({ error: 'Billing is not available on this server.', error_type: 'billing_off' });
    }
    const verified = verifyStripeSignature(req.body, req.get('stripe-signature'), config.webhookSecrets, { now: now() });
    if ('reason' in verified) {
      logger.warn(`[Billing] webhook signature refused (${verified.reason}).`);
      return res.status(400).json({ error: 'The signature does not verify.', error_type: 'bad_signature' });
    }
    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      event = null;
    }
    if (!event || !isBoundedString(event.id, 255) || !isBoundedString(event.type, 255) || typeof event.livemode !== 'boolean') {
      logger.warn('[Billing] webhook body is not a Stripe event.');
      return res.status(400).json({ error: 'The body is not a Stripe event.', error_type: 'bad_payload' });
    }
    if (event.livemode !== config.live) {
      logger.warn(`[Billing] webhook event ${event.id} is ${event.livemode ? 'live' : 'test'} but billing runs in ${config.mode} mode: ignored.`);
      return res.json({ received: true, outcome: 'ignored_mode' });
    }
    const pool = poolFn();
    if (!pool) {
      res.set('Retry-After', '60');
      return res.status(503).json({ error: 'Billing is not available right now.', error_type: 'billing_unavailable' });
    }

    try {
      const recorded = await pool.query(SQL.record, [event.id, event.type, event.livemode]);
      if (!recorded?.rows?.length) {
        const seen = await pool.query(SQL.processedAt, [event.id]);
        if (seen?.rows?.[0]?.processed_at) return res.json({ received: true, outcome: 'duplicate' });
      }

      /** @type {string} */
      let outcome;
      const type = String(event.type);
      const object = event.data?.object;
      if (type === 'charge.refunded' || type === 'charge.dispute.created') {
        const refund = type === 'charge.refunded';
        const charge = refund ? idOf(object) : idOf(object?.charge);
        alerts.alert(refund ? 'charge_refunded' : 'charge_dispute', String(event.id), refund
          ? `charge ${charge ?? '?'} was refunded (event ${event.id}). A refund does not cancel the subscription: cancel it in the Dashboard if it should end.`
          : `a dispute was opened on charge ${charge ?? '?'} (event ${event.id}). Cancel the subscription in the Dashboard so it is not charged again, and answer the dispute.`);
        outcome = 'alerted';
      } else if (type === 'checkout.session.completed' || SUBSCRIPTION_EVENTS.has(type) || INVOICE_EVENTS.has(type)) {
        const subscriptionId = subscriptionIdOf(event);
        outcome = subscriptionId
          ? (await syncSubscription(subscriptionId, { stripe, pool, config, now, alerts, logger })).outcome
          : 'no_subscription';
      } else {
        outcome = 'ignored_type';
      }
      await pool.query(SQL.markProcessed, [event.id, outcome]);
      return res.json({ received: true, outcome });
    } catch (error) {
      const e = /** @type {any} */ (error);
      const reason = e?.name === 'StripeError' ? `Stripe ${e.status}` : e instanceof Error ? e.message : String(e);
      logger.error(`[Billing] webhook event ${event.id} (${event.type}) failed (${reason}): left unprocessed for Stripe to retry.`);
      return res.status(500).json({ error: 'The event could not be processed.', error_type: 'billing_failed' });
    }
  };
}
