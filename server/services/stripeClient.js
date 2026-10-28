// @ts-check
/**
 * A small Stripe REST client on fetch (Phase 3; no SDK, no new dependency). Only the calls billing
 * makes, which are also the permissions a restricted key (rk_) needs:
 *   Customers: write (createCustomer)            Prices: read (retrievePrice)
 *   Checkout Sessions: write (create, list, expire)  Customer portal: write (createPortalSession)
 *   Subscriptions: read (retrieveSubscription, listSubscriptions)
 *
 * Every request sends Authorization: Bearer <key> and the pinned Stripe-Version below; there is no
 * env override (C50): payload shapes (items.data[].current_period_end, invoice.parent…) depend on
 * it, and the owner sets the same version on the webhook endpoint. Bodies are form-encoded with
 * Stripe's nested syntax (a[b][0][c]=v; arrays of plain values as key[]=v); GET parameters go in
 * the query string. Idempotency-Key is sent on POST only, when the caller gives one.
 *
 * Failures throw StripeError { status, type, code, requestId }: status 0 for a network error or
 * the timeout. Its message is generic; Stripe's own message (which can name ids, never the key:
 * any sk_/rk_/whsec_ text is masked anyway) goes to the server log only.
 */

export const STRIPE_API_VERSION = '2026-09-30.endive';
export const STRIPE_API_BASE = 'https://api.stripe.com';
const DEFAULT_TIMEOUT_MS = 8000;

/** @type {typeof fetch | null} */
let fetchForTests = null;

/** Tests: every client created without its own fetch uses this one (null: the real fetch). @param {typeof fetch | null} fn */
export function setStripeFetchForTests(fn) {
  fetchForTests = fn;
}

/** Masks anything key-shaped in a Stripe message before it is logged. @param {unknown} text */
export const redactStripeText = (text) => String(text ?? '')
  .replace(/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9*]+/g, '$1_$2_…')
  .replace(/\bwhsec_[A-Za-z0-9+/=*]+/g, 'whsec_…');

export class StripeError extends Error {
  /**
   * @param {{ status: number, type?: string | null, code?: string | null, requestId?: string | null }} details
   */
  constructor({ status, type = null, code = null, requestId = null }) {
    super(status === 0 ? 'Stripe could not be reached' : `Stripe answered ${status}`);
    this.name = 'StripeError';
    this.status = status;
    this.type = type;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Stripe's form encoding: nested objects as a[b]=v, arrays of objects as a[0][b]=v, arrays of
 * plain values as a[]=v, booleans as true/false. null and undefined are left out; '' is sent
 * (Stripe reads it as "unset").
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function encodeStripeForm(params) {
  /** @type {string[]} */
  const parts = [];
  const key = (/** @type {string} */ k) => encodeURIComponent(k).replace(/%5B/gi, '[').replace(/%5D/gi, ']');
  /** @param {string} prefix @param {unknown} value */
  const add = (prefix, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      const nested = value.some((v) => v !== null && typeof v === 'object');
      value.forEach((item, index) => add(nested ? `${prefix}[${index}]` : `${prefix}[]`, item));
      return;
    }
    if (value instanceof Date) {
      parts.push(`${key(prefix)}=${Math.floor(value.getTime() / 1000)}`);
      return;
    }
    if (typeof value === 'object') {
      for (const [name, inner] of Object.entries(value)) add(`${prefix}[${name}]`, inner);
      return;
    }
    parts.push(`${key(prefix)}=${encodeURIComponent(String(value))}`);
  };
  for (const [name, value] of Object.entries(params ?? {})) add(name, value);
  return parts.join('&');
}

/** @param {string} id */
const seg = (id) => {
  const value = String(id ?? '');
  if (!value) throw new TypeError('A Stripe object id is required');
  return encodeURIComponent(value);
};

/**
 * @param {{ secretKey: string, fetch?: typeof fetch, timeoutMs?: number, logger?: Pick<Console, 'warn'>, baseUrl?: string }} options
 */
export function createStripeClient({ secretKey, fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console, baseUrl = STRIPE_API_BASE }) {
  if (!secretKey) throw new TypeError('createStripeClient needs a secret key');

  /**
   * @param {'GET'|'POST'|'DELETE'} method
   * @param {string} path  starts with /v1/
   * @param {{ params?: Record<string, unknown>, idempotencyKey?: string }} [options]
   * @returns {Promise<any>}
   */
  async function request(method, path, { params, idempotencyKey } = {}) {
    const doFetch = fetchImpl ?? fetchForTests ?? globalThis.fetch;
    const body = params ? encodeStripeForm(params) : '';
    const url = method === 'GET' && body ? `${baseUrl}${path}?${body}` : `${baseUrl}${path}`;
    /** @type {Record<string, string>} */
    const headers = {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': STRIPE_API_VERSION,
      Accept: 'application/json',
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    }
    const where = `${method} ${path.replace(/\/(?:cus|sub|cs|price|in|ch|evt|bps)_[^/?]+/g, '/…')}`;
    let response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      logger.warn(`[Billing] Stripe ${where} failed (${timedOut ? 'timeout' : 'network error'}).`);
      throw new StripeError({ status: 0, type: 'network_error', code: timedOut ? 'timeout' : 'network' });
    }
    const requestId = response.headers?.get?.('request-id') ?? null;
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) {
      const error = json?.error ?? {};
      const type = typeof error.type === 'string' ? error.type : null;
      const code = typeof error.code === 'string' ? error.code : null;
      logger.warn(`[Billing] Stripe ${where} answered ${response.status} ${type ?? '-'} ${code ?? '-'} (request ${requestId ?? '-'}): ${redactStripeText(error.message)}`);
      throw new StripeError({ status: response.status, type, code, requestId });
    }
    if (json === null || typeof json !== 'object') {
      logger.warn(`[Billing] Stripe ${where} answered ${response.status} without JSON (request ${requestId ?? '-'}).`);
      throw new StripeError({ status: response.status, type: 'invalid_response', requestId });
    }
    return json;
  }

  return {
    request,
    /** @param {{ metadata?: Record<string, string>, idempotencyKey?: string }} input */
    createCustomer: ({ metadata, idempotencyKey } = {}) => request('POST', '/v1/customers', { params: { metadata }, idempotencyKey }),
    /** The Price with its currency_options (to refuse a multi-currency Price). @param {string} id */
    retrievePrice: (id) => request('GET', `/v1/prices/${seg(id)}`, { params: { expand: ['currency_options'] } }),
    /** @param {Record<string, unknown>} params @param {{ idempotencyKey?: string }} [options] */
    createCheckoutSession: (params, { idempotencyKey } = {}) => request('POST', '/v1/checkout/sessions', { params, idempotencyKey }),
    /** @param {{ customer: string, status?: string, limit?: number }} input */
    listCheckoutSessions: ({ customer, status = 'open', limit = 100 }) => request('GET', '/v1/checkout/sessions', { params: { customer, status, limit } }),
    /** @param {string} id */
    expireCheckoutSession: (id) => request('POST', `/v1/checkout/sessions/${seg(id)}/expire`),
    /** @param {{ customer: string, return_url: string, locale?: string }} params */
    createPortalSession: (params) => request('POST', '/v1/billing_portal/sessions', { params }),
    /** @param {string} id */
    retrieveSubscription: (id) => request('GET', `/v1/subscriptions/${seg(id)}`),
    /** @param {{ customer: string, status?: string, limit?: number }} input */
    listSubscriptions: ({ customer, status = 'all', limit = 100 }) => request('GET', '/v1/subscriptions', { params: { customer, status, limit } }),
  };
}

/** @typedef {ReturnType<typeof createStripeClient>} StripeClient */
