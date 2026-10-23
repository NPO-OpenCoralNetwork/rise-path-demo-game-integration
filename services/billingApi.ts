/**
 * The supporter plan's API (Phase 3, doc/brushup-2026/ai-access-plan.ja.md §7), for /settings/plan,
 * /settings/plan/confirm and the public /legal/commerce page. Every route is
 * server/routes/billing.js at /api/v2/billing:
 *   GET  /plan      public: the plan, its 特商法 rows and terms, as the running server enforces them
 *   GET  /me        the signed-in learner's plan, eligibility, subscription and today's usage
 *   POST /checkout  { locale } → { url } of a Stripe Checkout Session
 *   POST /portal    { locale } → { url } of the Stripe customer portal (payment method, cancellation)
 *   POST /sync      re-reads the learner's subscriptions from Stripe (after Checkout returns)
 *
 * No Stripe key or price lives in the browser: the client only opens the https URLs the server
 * returns. Refusals from the billing router carry its fixed error_type; sign-in (401), the global
 * limiter (429) and the body parser (400) answer with a status only, so the screens branch on the
 * status first. Never Stripe's text; status 0 when the server could not be reached.
 */
import { apiFetch } from './apiClient';
import { isSafeRedirect, type BillingLang, type BillingMe, type BillingPlanInfo } from './billingRules';

export * from './billingRules';

export class BillingApiError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = 'BillingApiError';
    this.status = status;
    this.errorType = errorType;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(`/billing${path}`, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new BillingApiError('The server could not be reached.', 0, 'network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (a proxy's error page): status only.
  }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new BillingApiError(
      `Billing request failed (${res.status})`,
      res.status,
      typeof record.error_type === 'string' ? record.error_type : undefined,
    );
  }
  if (!body || typeof body !== 'object') throw new BillingApiError('Unexpected response.', res.status, 'bad_response');
  return body as T;
}

export const getBillingPlan = (signal?: AbortSignal) => request<BillingPlanInfo>('/plan', { signal });

export const getBillingMe = (signal?: AbortSignal) => request<BillingMe>('/me', { signal });

async function redirectUrl(path: string, locale: BillingLang): Promise<string> {
  const body = await request<{ url?: unknown }>(path, { method: 'POST', body: JSON.stringify({ locale }) });
  if (!isSafeRedirect(body.url)) throw new BillingApiError('Unexpected response.', 502, 'bad_response');
  return body.url;
}

/** The Stripe Checkout URL for the supporter plan (server: one Session per learner per minute). */
export const startCheckout = (locale: BillingLang) => redirectUrl('/checkout', locale);

/** The Stripe customer portal URL (payment method, receipts, cancellation). */
export const openBillingPortal = (locale: BillingLang) => redirectUrl('/portal', locale);

export const syncBilling = () => request<{ ok: boolean; synced: number }>('/sync', { method: 'POST', body: '{}' });

/** The failure as the screens need it: status (0 = unreachable) and error_type. */
export function billingFailure(error: unknown): { status: number; errorType?: string } {
  if (error instanceof BillingApiError) return { status: error.status, errorType: error.errorType };
  return { status: 0, errorType: 'network' };
}
