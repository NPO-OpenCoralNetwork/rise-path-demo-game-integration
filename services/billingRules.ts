/**
 * Pure rules for the supporter plan's screens (Phase 3, doc/brushup-2026/ai-access-plan.ja.md §7):
 * the response shapes of /api/v2/billing (server/routes/billing.js), which state /settings/plan
 * shows, when the Settings and profile entry points appear, and when the public 特商法 page may
 * show its rows. No network, no React: services/billingApi.ts, the views and the tests
 * (server/tests/billingFront.test.js) share them.
 *
 * Every number, price and disclosure line on these screens comes from GET /api/v2/billing/plan of
 * the running server (server/services/billingPlan.js and billingDisclosure.js are server-only);
 * nothing here holds a price or a cap.
 */

export const PLAN_PATH = '/settings/plan';
export const PLAN_CONFIRM_PATH = '/settings/plan/confirm';
/** Public 特定商取引法に基づく表記 (open when signed out; Stripe's commerce disclosure link). */
export const COMMERCE_PATH = '/legal/commerce';
/** Stripe Checkout's success_url: /settings/plan?checkout=done. */
export const CHECKOUT_RETURN_PARAM = 'checkout';
export const CHECKOUT_RETURN_VALUE = 'done';

/** The server's marker for an owner fact not filled in yet (billingDisclosure.js PLACEHOLDER). */
export const DISCLOSURE_PLACEHOLDER = '【要記入】';

export type BillingLang = 'jp' | 'en';
export interface LocalizedText {
  jp: string;
  en: string;
}
export type SupporterCapKind = 'llm' | 'course_generation';
export type BillingEligibility = 'ok' | 'age_required' | 'adults_only' | 'guardian_consent' | 'paused' | 'unavailable';

export interface BillingSubscription {
  status: string;
  currentPeriodEnd: string | null;
  /** When a scheduled cancellation takes effect (cancel_at, or the period end), else null. */
  endsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string | null;
}

export interface BillingUsage {
  used: number;
  limit: number;
}

/** GET /api/v2/billing/me */
export interface BillingMe {
  plan: 'supporter' | 'free';
  eligibility: BillingEligibility;
  /** ISO time a safety pause ends (eligibility 'paused'). */
  pausedUntil?: string;
  /** Sales open for this learner (in test mode: a tester while sales are open). */
  salesOpen: boolean;
  subscription: BillingSubscription | null;
  hasCustomer: boolean;
  usage: Partial<Record<SupporterCapKind, BillingUsage>> | null;
}

export interface DisclosureRow {
  key: string;
  label: LocalizedText;
  value: LocalizedText;
}

export interface BillingPlanDetails {
  id: string;
  name: LocalizedText;
  productName: LocalizedText;
  priceJpy: number;
  yearlyJpy: number;
  interval: string;
  caps: Record<SupporterCapKind, number>;
  freeCaps: Record<SupporterCapKind, number>;
  uses: {
    llm: { jp: readonly string[]; en: readonly string[] };
    course_generation: LocalizedText;
  };
  /** 分量: one line per raised kind, the free comparison and the shared-pool caveat. */
  quantity: Record<SupporterCapKind | 'free' | 'shared', LocalizedText>;
  resetsAt: string;
}

export interface BillingTerms {
  cancellation: LocalizedText;
  refunds: LocalizedText;
  failedPayment: LocalizedText;
}

/** GET /api/v2/billing/plan (public). Only serviceable and salesOpen when billing is not serviceable. */
export interface BillingPlanInfo {
  serviceable: boolean;
  /** Open to the public: live mode with sales open (test mode is always false here). */
  salesOpen: boolean;
  mode?: 'test' | 'live' | null;
  plan?: BillingPlanDetails;
  disclosure?: { rows: DisclosureRow[] };
  terms?: BillingTerms;
  termsUrl?: string | null;
  problems?: string[];
}

/** A failed request: the HTTP status (0 for a network failure) and the server's error_type. */
export interface BillingFailure {
  status: number;
  errorType?: string;
}

/** Stripe statuses after which nothing is charged again (server: billingEntitlement.js). */
export const TERMINAL_STATUSES: readonly string[] = ['canceled', 'incomplete_expired'];

/** A subscription that may still charge: the manage card (and its cancel path) must show. */
export function isOpenSubscription(subscription: BillingSubscription | null | undefined): boolean {
  return Boolean(subscription && typeof subscription.status === 'string' && !TERMINAL_STATUSES.includes(subscription.status));
}

/**
 * Settings → Account 「プラン」 and the profile link: only with the build flag on and a GET /me
 * that answered eligibility 'ok' or a subscription (C31/C41). Everyone else (billing off, test
 * mode and not a tester, a minor without a subscription, a failed request) sees no entry point.
 */
export function planEntryVisible(flag: boolean, me: BillingMe | null | undefined): boolean {
  if (flag !== true || !me) return false;
  return me.eligibility === 'ok' || Boolean(me.subscription);
}

export type PlanViewState = 'error' | 'manage' | 'signin' | 'closed' | 'eligibility' | 'free';

const isBillingOff = (failure: BillingFailure | null | undefined) => failure?.status === 404 && failure.errorType === 'billing_off';

/**
 * What /settings/plan shows, in this order (design §3, C5/C32): a load error; a subscription that
 * may still charge (the manage card with 「お支払いと解約」, whatever the eligibility or the sales
 * state); sign-in required (401); sales closed, or test mode for a non-tester; the eligibility
 * states; the free plan with the button to the confirmation screen.
 *
 * A failed GET /plan only matters for the states that need the plan's details (the free plan):
 * the manage card, sign-in and the closed state do not, so a subscriber keeps the cancel path.
 */
export function planViewState(input: {
  me: BillingMe | null;
  meFailure: BillingFailure | null;
  plan: BillingPlanInfo | null;
  planFailed: boolean;
}): PlanViewState {
  const { me, meFailure, plan, planFailed } = input;
  if (meFailure && meFailure.status !== 401 && !isBillingOff(meFailure)) return 'error';
  if (!meFailure && !me) return 'error';
  if (me && isOpenSubscription(me.subscription)) return 'manage';
  if (meFailure?.status === 401) return 'signin';
  if (isBillingOff(meFailure) || plan?.serviceable === false) return 'closed';
  if (!me || me.eligibility === 'unavailable' || me.salesOpen !== true) return 'closed';
  if (me.eligibility !== 'ok') return 'eligibility';
  if (planFailed || !plan?.plan) return 'error';
  return 'free';
}

/** The confirmation screen's 申し込む button: only in the free state (eligibility 'ok', sales open). */
export function canSubscribe(plan: BillingPlanInfo | null, me: BillingMe | null): boolean {
  return planViewState({ me, meFailure: null, plan, planFailed: !plan }) === 'free';
}

/** 1234567 → "1,234,567" (both languages; the copy adds 円 or ¥). */
export function formatYen(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

/** A disclosure row's value in this language, or null when the server did not send that row. */
export function disclosureValue(plan: BillingPlanInfo | null | undefined, key: string, lang: BillingLang): string | null {
  const row = plan?.disclosure?.rows?.find((r) => r.key === key);
  const value = row?.value?.[lang];
  return typeof value === 'string' && value.trim() ? value : null;
}

const hasPlaceholder = (text: string | null | undefined) => typeof text === 'string' && text.includes(DISCLOSURE_PLACEHOLDER);

/** The seller's email from the 特商法 rows, or null while it is a placeholder or missing. */
export function contactEmail(plan: BillingPlanInfo | null | undefined, lang: BillingLang): string | null {
  const value = disclosureValue(plan, 'email', lang);
  return value && !hasPlaceholder(value) ? value : null;
}

export type CommerceState = 'rows' | 'closed_live' | 'not_offered';

/**
 * The public 特商法 page: its rows only in live mode with every owner fact filled in; 'closed_live'
 * when live sales are closed (existing subscribers are still billed, so the page does not say
 * that no paid service exists); otherwise no paid service is offered (billing off, or test mode:
 * placeholders are never shown publicly).
 */
export function commerceState(plan: BillingPlanInfo | null | undefined): CommerceState {
  if (!plan?.serviceable || plan.mode !== 'live') return 'not_offered';
  const rows = plan.disclosure?.rows ?? [];
  const complete = rows.length > 0 && rows.every((row) => !hasPlaceholder(row.value?.jp) && !hasPlaceholder(row.value?.en));
  if (plan.salesOpen === true && complete) return 'rows';
  return complete ? 'closed_live' : 'not_offered';
}

/**
 * The date line of the manage card: 'ends' (a scheduled cancellation: the plan stays until then,
 * nothing more is charged) before 'renews' (only while active or trialing), else none (C22).
 */
export function subscriptionDate(subscription: BillingSubscription | null | undefined): { kind: 'ends' | 'renews'; iso: string } | null {
  if (!subscription) return null;
  if (subscription.endsAt) return { kind: 'ends', iso: subscription.endsAt };
  if ((subscription.status === 'active' || subscription.status === 'trialing') && subscription.currentPeriodEnd) {
    return { kind: 'renews', iso: subscription.currentPeriodEnd };
  }
  return null;
}

/** Stripe could not collect a payment: the manage card asks to update the card in the portal. */
export function paymentProblem(subscription: BillingSubscription | null | undefined): boolean {
  return subscription?.status === 'past_due' || subscription?.status === 'unpaid';
}

/** A Checkout or portal URL the browser may open: https only (the server checks it too). */
export function isSafeRedirect(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
