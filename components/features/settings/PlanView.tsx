import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, ExternalLink, Sparkles } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import PageHeader from '../../ui/PageHeader';
import { Button, ButtonLink } from '../../ui/Button';
import { formatTokyoDateTime } from '../../safety/format';
import { AI_ACCESS_SETUP_PATH } from '../../../services/aiAccessRules';
import {
  CHECKOUT_RETURN_PARAM,
  CHECKOUT_RETURN_VALUE,
  COMMERCE_PATH,
  PLAN_CONFIRM_PATH,
  PLAN_PATH,
  billingFailure,
  contactEmail,
  formatYen,
  getBillingMe,
  isOpenSubscription,
  openBillingPortal,
  paymentProblem,
  planViewState,
  subscriptionDate,
  syncBilling,
  type BillingLang,
  type BillingMe,
  type BillingPlanInfo,
  type PlanViewState,
  type SupporterCapKind,
} from '../../../services/billingApi';
import {
  ContactLine,
  Notice,
  TestModeBanner,
  cardClasses,
  eligibilityText,
  pausedUntilText,
  sharedCopy,
  useBillingData,
  type SharedCopy,
} from './planShared';

/**
 * /settings/plan — the supporter plan (Phase 3, doc/brushup-2026/ai-access-plan.ja.md §7). Shown
 * only with VITE_FEATURE_BILLING (App.tsx). Everything comes from GET /api/v2/billing/plan and
 * /me (server/routes/billing.js); the page holds no price and no cap.
 *
 * States, first match wins (services/billingRules.ts planViewState, design §3, C5/C32):
 *   1. load error, with a retry and who to contact;
 *   2. a subscription that may still charge: the manage card (status, next renewal or end date,
 *      the past-due notice, 「お支払いと解約」 → the Stripe portal), with any eligibility notice
 *      below it, so a learner whose age was corrected, or who is paused, can always cancel;
 *   3. sign-in required (a 401: a Nexloom-only session, an anonymous user);
 *   4. sales closed, or test mode and not a tester;
 *   5. eligibility (no age → AI access settings; under 18; paused until …);
 *   6. the free plan: what the plan gives, today's use and 「申し込み内容の確認へ」.
 * Coming back from Stripe Checkout (?checkout=done): 「手続きを確認しています…」, POST /sync, then
 * GET /me every 3 s for up to 30 s; then a success notice, or 「もう一度確かめる」 and the contact.
 * Otherwise, when /me shows a payment record but no running subscription, one POST /sync and
 * GET /me (C34: a late webhook must not hide the cancel path).
 */

const copy = {
  en: {
    title: 'Plan',
    description: 'Your plan, and how many times a day you can use the AI features.',
    freeNow: 'You are on the free plan.',
    price: (yen: string) => `¥${yen} a month (tax included)`,
    toConfirm: 'Review the details',
    toConfirmHint: 'The next screen shows every detail before you decide. Nothing is charged yet.',
    usageTitle: 'Today’s use (resets at 00:00 Japan time)',
    usageLine: (label: string, used: number, limit: number) => `${label}: ${used} of ${limit}`,
    usageOff: (label: string) => `${label}: not available right now`,
    courseLabel: 'AI steps in course creation',
    manageTitle: 'Your subscription',
    statusLabel: 'Status',
    status: {
      active: 'Active',
      trialing: 'Trial',
      past_due: 'Payment not confirmed',
      unpaid: 'Payment not confirmed',
      paused: 'Paused',
      incomplete: 'Payment in progress',
    } as Record<string, string>,
    statusOther: 'Being checked',
    renews: 'Next renewal',
    ends: 'Ends on',
    endsNote: (date: string) => `It ends on ${date}. You can use it until then, and you will not be charged again.`,
    pastDue: 'We could not confirm your payment. Please update your card under “Payment and cancellation”.',
    incomplete: 'We are waiting for the payment to be confirmed. If it does not finish, please check under “Payment and cancellation”.',
    pausedSubscription: 'Payments for this subscription are paused. Please check under “Payment and cancellation”.',
    notApplied: 'We are still confirming your subscription. If this does not change after a while, please contact us.',
    portal: 'Payment and cancellation',
    portalBusy: 'Opening Stripe…',
    portalHint: 'Change your card, see receipts or cancel on the page of Stripe, our payment service.',
    minorNotice: (name: string) =>
      `With the age on record, the ${name} limits do not apply. You can cancel the current subscription under “Payment and cancellation”.`,
    refundEmail: (email: string) => `For a refund, please write to ${email}.`,
    refundStaff: 'For a refund, please talk to the staff at your learning place.',
    ageMissingNotice: (name: string) =>
      `Your birth year and month are not recorded, so the ${name} limits do not apply. Please enter them in AI access settings.`,
    pausedNotice: (until: string | null) =>
      `AI is resting today${until ? ` (until ${until}, Japan time)` : ' (until 00:00 Japan time)'}. Your subscription continues as it is.`,
    planFallback: 'paid plan',
    checking: 'Checking your sign-up…',
    confirmed: 'Your subscription is confirmed. Thank you! Your daily AI limits are now higher.',
    pending: 'We have not confirmed your subscription yet. If you finished paying, it usually shows within a few minutes.',
    recheck: 'Check again',
    rechecking: 'Checking…',
    errors: {
      no_customer: 'We could not find a payment record for this account.',
      rate_limited: 'There were many tries in a row. Please wait a minute and try again.',
      provider: 'We could not reach the payment service. Please try again in a little while.',
      generic: 'That did not work. Please try again in a little while.',
    },
  },
  jp: {
    title: 'プラン',
    description: 'いまのプランと、AI の機能を 1 日に使える回数です。',
    freeNow: 'いまは無料プランです。',
    price: (yen: string) => `月額 ${yen} 円（税込）`,
    toConfirm: '申し込み内容の確認へ',
    toConfirmHint: '次の画面で、申し込む前に内容をすべて確認できます。まだ請求はされません。',
    usageTitle: '今日の利用（日本時間 0 時に戻ります）',
    usageLine: (label: string, used: number, limit: number) => `${label}：${used} / ${limit} 回`,
    usageOff: (label: string) => `${label}：いまは使えません`,
    courseLabel: 'コース作成の AI 処理',
    manageTitle: 'ご契約中のプラン',
    statusLabel: '状態',
    status: {
      active: '利用中',
      trialing: 'お試し中',
      past_due: 'お支払いを確認できていません',
      unpaid: 'お支払いを確認できていません',
      paused: '一時停止中',
      incomplete: 'お支払いの手続き中',
    } as Record<string, string>,
    statusOther: '確認中',
    renews: '次の更新日',
    ends: '終了日',
    endsNote: (date: string) => `${date}に終了します。それまでは使えます。次回からは請求されません。`,
    pastDue: 'お支払いを確認できませんでした。「お支払いと解約」からカードを更新してください。',
    incomplete: 'お支払いの確認を待っています。終わらないときは、「お支払いと解約」から確かめてください。',
    pausedSubscription: 'この契約のお支払いは一時停止されています。「お支払いと解約」から確かめてください。',
    notApplied: 'お申し込みの確認を続けています。しばらくたっても変わらないときは、お問い合わせください。',
    portal: 'お支払いと解約',
    portalBusy: 'Stripe の画面を開いています…',
    portalHint: 'カードの変更、領収書の確認、解約は、決済サービス Stripe の画面で行います。',
    minorNotice: (name: string) =>
      `登録された年れいでは、${name}の上限は使えません。いまの契約は「お支払いと解約」から解約できます。`,
    refundEmail: (email: string) => `返金は ${email} にご相談ください。`,
    refundStaff: '返金は、ご利用の拠点のスタッフにご相談ください。',
    ageMissingNotice: (name: string) =>
      `生まれた年と月が登録されていないため、${name}の上限は使えません。「AI の利用設定」で登録してください。`,
    pausedNotice: (until: string | null) =>
      `今日は AI をお休みしています（${until ? `${until}（日本時間）まで` : '日本時間 0 時まで'}）。契約はそのまま続きます。`,
    planFallback: '有料プラン',
    checking: '手続きを確認しています…',
    confirmed: 'お申し込みを確認しました。ありがとうございます。AI の 1 日の上限が上がりました。',
    pending: 'まだお申し込みを確認できていません。お支払いが終わっていれば、ふつうは数分で反映されます。',
    recheck: 'もう一度確かめる',
    rechecking: '確かめています…',
    errors: {
      no_customer: 'このアカウントのお支払いの記録が見つかりませんでした。',
      rate_limited: '操作が続いたため、少し待ってからもう一度お試しください。',
      provider: '決済サービスにつながりませんでした。少し時間をおいて、もう一度お試しください。',
      generic: 'うまくいきませんでした。少し時間をおいて、もう一度お試しください。',
    },
  },
} as const;

type PlanCopy = (typeof copy)[BillingLang];

const POLL_MS = 3000;
const POLL_FOR_MS = 30000;

type ReturnState = 'checking' | 'confirmed' | 'pending' | 'rechecking' | null;

/** The error text for a failed portal request. */
function portalErrorText(t: PlanCopy, s: SharedCopy, error: unknown): string {
  const { status, errorType } = billingFailure(error);
  if (status === 401) return s.signIn;
  if (errorType === 'no_customer') return t.errors.no_customer;
  if (status === 429) return t.errors.rate_limited;
  if (status === 0 || status === 502 || status === 503) return t.errors.provider;
  return t.errors.generic;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

const PlanView: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const t = copy[language];
  const s = sharedCopy[language];
  const data = useBillingData();
  const { setMe } = data;

  // Read once: the success page's ?checkout=done, dropped from the URL when the check ends.
  const [returning] = useState(() => new URLSearchParams(location.search).get(CHECKOUT_RETURN_PARAM) === CHECKOUT_RETURN_VALUE);
  const [returnState, setReturnState] = useState<ReturnState>(returning ? 'checking' : null);
  const returnRef = useRef<HTMLDivElement>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const portalErrorRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<AbortController | null>(null);

  /** POST /sync, then GET /me until the plan is 'supporter' or `forMs` passed. */
  const confirmSubscription = async (forMs: number) => {
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    const deadline = Date.now() + forMs;
    await syncBilling().catch(() => undefined);
    for (;;) {
      if (controller.signal.aborted) return;
      const me = await getBillingMe(controller.signal).catch(() => null);
      if (controller.signal.aborted) return;
      if (me) {
        setMe(me);
        if (me.plan === 'supporter') {
          setReturnState('confirmed');
          return;
        }
      }
      if (Date.now() >= deadline) break;
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted) setReturnState('pending');
  };

  useEffect(() => {
    if (!returning) return;
    void confirmSubscription(POLL_FOR_MS);
    return () => runRef.current?.abort();
    // Once per visit from Stripe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returning]);

  useEffect(() => {
    if (returnState !== 'confirmed' && returnState !== 'pending') return;
    // The check is over: a reload shows the page as it is, without checking again.
    if (new URLSearchParams(location.search).has(CHECKOUT_RETURN_PARAM)) navigate(PLAN_PATH, { replace: true });
    returnRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnState]);

  useEffect(() => {
    if (portalError) portalErrorRef.current?.focus();
  }, [portalError]);

  // Back from Stripe with the browser's back button (page restored from the cache): not busy.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPortalBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const openPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    setPortalError(null);
    try {
      const url = await openBillingPortal(language);
      window.location.assign(url);
    } catch (error) {
      setPortalBusy(false);
      setPortalError(portalErrorText(t, s, error));
    }
  };

  // C34: a payment record but no running subscription (the tab closed before Stripe's redirect
  // while the webhook was late): re-read it from Stripe once, so the cancel path shows.
  const syncedOnLoad = useRef(false);
  useEffect(() => {
    const me = data.me;
    if (returning || syncedOnLoad.current || data.loading || !me?.hasCustomer || isOpenSubscription(me.subscription)) return;
    syncedOnLoad.current = true;
    syncBilling()
      .then(() => getBillingMe())
      .then(setMe)
      .catch(() => undefined);
  }, [data.loading, data.me, returning, setMe]);

  const recheck = () => {
    setReturnState('rechecking');
    void confirmSubscription(0);
  };

  const handleBack = () => {
    // Opened by a full page load (back from Stripe Checkout or the portal): Settings, not Stripe.
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/settings');
  };

  const state = data.loading ? null : planViewState(data);
  // Only testers get past 'closed' in test mode (everyone else: eligibility 'unavailable').
  const showTestBanner = data.plan?.mode === 'test' && (state === 'manage' || state === 'eligibility' || state === 'free');
  // Back from Checkout and not confirmed yet: no second 「申し込み内容の確認へ」 meanwhile.
  const waitingForCheckout = returnState !== null && returnState !== 'confirmed' && state === 'free';

  return (
    <div className="mx-auto max-w-form px-4 pb-20 pt-8 sm:px-6">
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-2 rounded-control text-small font-medium text-fg-2 hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {s.back}
      </button>

      <PageHeader className="mt-4" eyebrow={s.eyebrow} title={t.title} description={t.description} />

      <div className="mt-6 space-y-6">
        {showTestBanner && <TestModeBanner t={s} />}

        {returnState && (
          <Notice
            ref={returnRef}
            role="status"
            tone={returnState === 'confirmed' ? 'ok' : returnState === 'pending' ? 'warn' : 'info'}
          >
            <p>
              {returnState === 'confirmed' ? t.confirmed : returnState === 'pending' ? t.pending : returnState === 'rechecking' ? t.rechecking : t.checking}
            </p>
            {returnState === 'pending' && (
              <>
                <ContactLine t={s} plan={data.plan} language={language} />
                <Button variant="secondary" size="sm" onClick={recheck}>
                  {t.recheck}
                </Button>
              </>
            )}
          </Notice>
        )}

        {portalError && (
          <Notice ref={portalErrorRef} role="alert" tone="error">
            <p>{portalError}</p>
            <ContactLine t={s} plan={data.plan} language={language} />
          </Notice>
        )}

        {state === null ? (
          <p role="status" className="text-body text-fg-3">
            {s.loading}
          </p>
        ) : waitingForCheckout ? null : (
          <PlanStateBody
            state={state}
            language={language}
            plan={data.plan}
            me={data.me}
            portalBusy={portalBusy}
            onPortal={() => void openPortal()}
            onRetry={data.reload}
          />
        )}

        <p className="text-small text-fg-2">
          <Link to={COMMERCE_PATH} className="font-medium text-primary-text underline underline-offset-4">
            {s.commerce}
          </Link>
        </p>
      </div>
    </div>
  );
};

/** The body for one state (exported for server/tests/billingFront.test.js). */
export const PlanStateBody: React.FC<{
  state: PlanViewState;
  language: BillingLang;
  plan: BillingPlanInfo | null;
  me: BillingMe | null;
  portalBusy: boolean;
  onPortal: () => void;
  onRetry: () => void;
}> = ({ state, language, plan, me, portalBusy, onPortal, onRetry }) => {
  const t = copy[language];
  const s = sharedCopy[language];

  if (state === 'error') {
    return (
      <Notice role="alert" tone="error">
        <p>{s.loadFailed}</p>
        <ContactLine t={s} plan={plan} language={language} />
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {s.retry}
        </Button>
      </Notice>
    );
  }
  if (state === 'manage' && me) {
    return <ManageCard t={t} s={s} language={language} plan={plan} me={me} busy={portalBusy} onPortal={onPortal} />;
  }
  if (state === 'signin') {
    return (
      <Notice tone="info">
        <p>{s.signIn}</p>
      </Notice>
    );
  }
  if (state === 'closed') {
    return (
      <Notice tone="info">
        <p>{plan?.mode === 'test' ? s.closedTest : s.closed}</p>
      </Notice>
    );
  }
  if (state === 'eligibility') {
    return (
      <Notice tone="info">
        <p>{eligibilityText(s, me, language)}</p>
        {me?.eligibility === 'age_required' && (
          <ButtonLink to={AI_ACCESS_SETUP_PATH} variant="secondary" size="sm">
            {s.ageLink}
          </ButtonLink>
        )}
      </Notice>
    );
  }
  if (state === 'free' && plan?.plan) {
    return <FreeCard t={t} language={language} plan={plan} me={me} />;
  }
  return null;
};

const UsageList: React.FC<{ t: PlanCopy; language: BillingLang; plan: BillingPlanInfo | null; me: BillingMe | null }> = ({ t, language, plan, me }) => {
  const titleId = useId();
  const usage = me?.usage;
  const uses = plan?.plan?.uses;
  if (!usage || !uses) return null;
  const labels: Record<SupporterCapKind, string> = {
    llm: uses.llm[language].join(language === 'jp' ? '・' : ', '),
    course_generation: t.courseLabel,
  };
  const kinds = (['llm', 'course_generation'] as const).filter((kind) => usage[kind]);
  if (kinds.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="mt-4">
      <h3 id={titleId} className="text-body font-semibold text-fg">
        {t.usageTitle}
      </h3>
      <ul className="mt-2 space-y-1 text-body text-fg-2">
        {kinds.map((kind) => {
          const { used, limit } = usage[kind] as { used: number; limit: number };
          return <li key={kind}>{limit > 0 ? t.usageLine(labels[kind], used, limit) : t.usageOff(labels[kind])}</li>;
        })}
      </ul>
    </section>
  );
};

const FreeCard: React.FC<{ t: PlanCopy; language: BillingLang; plan: BillingPlanInfo; me: BillingMe | null }> = ({ t, language, plan, me }) => {
  const titleId = useId();
  const details = plan.plan;
  if (!details) return null;
  const q = details.quantity;
  return (
    <>
      <p className="text-body text-fg">{t.freeNow}</p>
      <section aria-labelledby={titleId} className={cardClasses}>
        <h2 id={titleId} className="flex items-center gap-2 text-h2 text-fg">
          <Sparkles size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
          {details.name[language]}
        </h2>
        <p className="mt-2 text-h3 text-fg">{t.price(formatYen(details.priceJpy))}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-body text-fg-2 marker:text-fg-3">
          <li>{q.llm[language]}</li>
          <li>{q.course_generation[language]}</li>
        </ul>
        <p className="mt-2 text-small text-fg-2">{q.free[language]}</p>
        <p className="mt-1 text-small text-fg-2">{q.shared[language]}</p>
        <UsageList t={t} language={language} plan={plan} me={me} />
        <ButtonLink className="mt-5" to={PLAN_CONFIRM_PATH} variant="primary" size="md">
          {t.toConfirm}
        </ButtonLink>
        <p className="mt-2 text-small text-fg-3">{t.toConfirmHint}</p>
      </section>
    </>
  );
};

const ManageCard: React.FC<{
  t: PlanCopy;
  s: SharedCopy;
  language: BillingLang;
  plan: BillingPlanInfo | null;
  me: BillingMe;
  busy: boolean;
  onPortal: () => void;
}> = ({ t, s, language, plan, me, busy, onPortal }) => {
  const titleId = useId();
  const hintId = useId();
  const subscription = me.subscription;
  if (!subscription) return null;
  const name = plan?.plan?.name[language] ?? t.planFallback;
  const date = subscriptionDate(subscription);
  const dateText = date ? formatTokyoDateTime(date.iso, language) : null;
  const statusText = t.status[subscription.status] ?? t.statusOther;
  const statusNotice = paymentProblem(subscription)
    ? t.pastDue
    : subscription.status === 'incomplete'
      ? t.incomplete
      : subscription.status === 'paused'
        ? t.pausedSubscription
        : null;
  const minor = me.eligibility === 'adults_only' || me.eligibility === 'guardian_consent';
  const notApplied = me.plan !== 'supporter' && me.eligibility === 'ok'
    && (subscription.status === 'active' || subscription.status === 'trialing');

  return (
    <section aria-labelledby={titleId} className={cardClasses}>
      <h2 id={titleId} className="flex items-center gap-2 text-h2 text-fg">
        <CreditCard size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
        {t.manageTitle}
      </h2>
      <p className="mt-1 text-body-lg font-semibold text-fg">{name}</p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body sm:gap-x-6">
        <dt className="font-medium text-fg-2">{t.statusLabel}</dt>
        <dd className="text-fg">{statusText}</dd>
        {date && dateText && (
          <>
            <dt className="font-medium text-fg-2">{date.kind === 'ends' ? t.ends : t.renews}</dt>
            <dd className="text-fg">{dateText}</dd>
          </>
        )}
      </dl>

      {date?.kind === 'ends' && dateText && <p className="mt-3 text-body text-fg-2">{t.endsNote(dateText)}</p>}
      {statusNotice && (
        <Notice className="mt-3" tone="warn">
          <p>{statusNotice}</p>
        </Notice>
      )}
      {notApplied && !statusNotice && (
        <Notice className="mt-3" tone="info">
          <p>{t.notApplied}</p>
          <ContactLine t={s} plan={plan} language={language} />
        </Notice>
      )}

      {me.plan === 'supporter' && <UsageList t={t} language={language} plan={plan} me={me} />}

      <Button
        className="mt-5"
        variant="primary"
        size="md"
        leadingIcon={<ExternalLink size={16} aria-hidden="true" />}
        aria-describedby={hintId}
        aria-disabled={busy || undefined}
        onClick={busy ? undefined : onPortal}
      >
        {busy ? t.portalBusy : t.portal}
      </Button>
      <p id={hintId} className="mt-2 text-small text-fg-3">
        {t.portalHint}
      </p>

      {/* Eligibility notices come after the cancel path, never instead of it (C5/C32). */}
      {minor && (
        <Notice className="mt-4" tone="warn">
          <p>{t.minorNotice(name)}</p>
          <RefundContact t={t} plan={plan} language={language} />
        </Notice>
      )}
      {me.eligibility === 'age_required' && (
        <Notice className="mt-4" tone="warn">
          <p>{t.ageMissingNotice(name)}</p>
          <ButtonLink to={AI_ACCESS_SETUP_PATH} variant="secondary" size="sm">
            {s.ageLink}
          </ButtonLink>
        </Notice>
      )}
      {me.eligibility === 'paused' && (
        <Notice className="mt-4" tone="info">
          <p>{t.pausedNotice(pausedUntilText(me, language))}</p>
        </Notice>
      )}
    </section>
  );
};

const RefundContact: React.FC<{ t: PlanCopy; plan: BillingPlanInfo | null; language: BillingLang }> = ({ t, plan, language }) => {
  const email = contactEmail(plan, language);
  return <p className="text-small text-fg-2">{email ? t.refundEmail(email) : t.refundStaff}</p>;
};

export default PlanView;
