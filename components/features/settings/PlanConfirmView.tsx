import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import PageHeader from '../../ui/PageHeader';
import { Button, ButtonLink } from '../../ui/Button';
import {
  COMMERCE_PATH,
  PLAN_PATH,
  billingFailure,
  disclosureValue,
  formatYen,
  planViewState,
  startCheckout,
  type BillingLang,
  type BillingMe,
  type BillingPlanInfo,
} from '../../../services/billingApi';
import {
  ContactLine,
  Notice,
  TestModeBanner,
  cardClasses,
  eligibilityText,
  sharedCopy,
  useBillingData,
  type SharedCopy,
} from './planShared';

/**
 * /settings/plan/confirm — the final confirmation screen (最終確認画面, 特定商取引法 第12条の6) of
 * the supporter plan (Phase 3, doc/brushup-2026/ai-access-plan.ja.md §7; design §3, C35/C36).
 * Shown only with VITE_FEATURE_BILLING (App.tsx). Rendered only from GET /api/v2/billing/plan and
 * /me: the plan name, 分量, 期間, 価格, 支払の時期と方法, 提供の時期, 申込期間, 解約 (with the
 * deadline and the refund rule), what happens when a payment fails, the 18+ condition, the hand-off
 * to Stripe and the links to the 特商法 page (and the terms when set) all come BEFORE the button,
 * in the DOM and on screen. No sticky or fixed button, nothing folded away. The button appears
 * only in the free state (eligibility 'ok', sales open for this learner, no running subscription),
 * and POST /checkout then opens Stripe Checkout (busy until the page changes).
 */

const copy = {
  en: {
    title: 'Final check before you subscribe',
    description: 'Please read everything below. Then press “Subscribe” at the bottom.',
    items: {
      plan: 'Plan',
      quantity: 'What you get (uses per day)',
      period: 'Term',
      price: 'Price',
      payment: 'When and how you pay',
      delivery: 'When it starts',
      offerPeriod: 'Offer period',
      cancellation: 'Cancellation',
      failedPayment: 'If a payment cannot be confirmed',
      conditions: 'Conditions',
      handoff: 'Payment page',
      links: 'Details',
    },
    period: {
      month: 'Renews automatically every month. There is no end date: it continues until you cancel.',
    } as Record<string, string>,
    handoff:
      'When you press “Subscribe”, the page of Stripe, our payment service, opens. You enter your card details there; they are not sent to Rise Path. The subscription is made when you confirm the payment on Stripe’s page.',
    terms: 'Terms of use',
    newTab: '(opens in a new tab)',
    submit: (yen: string) => `Subscribe (paid, ¥${yen} a month)`,
    submitBusy: 'Opening Stripe…',
    back: 'Back',
    alreadySubscribed: 'You already have this plan. You can manage it on the plan page.',
    errors: {
      already_subscribed: 'You already have this plan. You can manage it on the plan page.',
      not_eligible: 'This account cannot subscribe. The plan page explains why.',
      closed: 'The paid plan is not open for sign-up right now.',
      rate_limited: 'There were many tries in a row. Please wait a minute and try again.',
      provider: 'We could not reach the payment service. Nothing was charged. Please try again in a little while.',
      generic: 'That did not work. Nothing was charged. Please try again in a little while.',
    },
  },
  jp: {
    title: 'お申し込み内容の最終確認',
    description: '下の内容をすべてご確認ください。そのうえで、いちばん下の「申し込む」を押してください。',
    items: {
      plan: 'プラン',
      quantity: '分量（1 日に使える回数）',
      period: '契約期間',
      price: '価格',
      payment: '支払いの時期と方法',
      delivery: '提供の時期',
      offerPeriod: '申込期間',
      cancellation: '解約',
      failedPayment: 'お支払いを確認できないとき',
      conditions: '申し込みの条件',
      handoff: 'お支払いの画面',
      links: 'くわしい内容',
    },
    period: {
      month: '1 か月ごとの自動更新です。期間の定めはなく、解約するまで続きます。',
    } as Record<string, string>,
    handoff:
      '「申し込む」を押すと、決済サービス Stripe の画面に移ります。カード番号などは Stripe の画面で入力し、Rise Path には届きません。Stripe の画面で支払いを確定すると、申し込みが成立します。',
    terms: '利用規約',
    newTab: '（新しいタブで開きます）',
    submit: (yen: string) => `申し込む（有料・月額 ${yen} 円）`,
    submitBusy: 'Stripe の画面を開いています…',
    back: '戻る',
    alreadySubscribed: 'すでにお申し込みずみです。プランの画面で確認できます。',
    errors: {
      already_subscribed: 'すでにお申し込みずみです。プランの画面で確認できます。',
      not_eligible: 'このアカウントでは申し込めません。理由はプランの画面で確認できます。',
      closed: '現在、有料プランの申し込みは受け付けていません。',
      rate_limited: '操作が続いたため、少し待ってからもう一度お試しください。',
      provider: '決済サービスにつながりませんでした。請求はされていません。少し時間をおいて、もう一度お試しください。',
      generic: 'うまくいきませんでした。請求はされていません。少し時間をおいて、もう一度お試しください。',
    },
  },
} as const;

type ConfirmCopy = (typeof copy)[BillingLang];

/** The error text for a refused POST /checkout. */
function checkoutErrorText(t: ConfirmCopy, s: SharedCopy, error: unknown): string {
  const { status, errorType } = billingFailure(error);
  if (status === 401) return s.signIn;
  if (errorType === 'already_subscribed') return t.errors.already_subscribed;
  if (status === 403) return t.errors.not_eligible;
  if (errorType === 'billing_off' || errorType === 'billing_misconfigured') return t.errors.closed;
  if (status === 429) return t.errors.rate_limited;
  if (status === 0 || status === 502 || status === 503) return t.errors.provider;
  return t.errors.generic;
}

const PlanConfirmView: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const s = sharedCopy[language];
  const t = copy[language];
  const data = useBillingData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // Back from Stripe with the browser's back button (page restored from the cache): not busy.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = await startCheckout(language);
      // Stays busy until the browser leaves for Stripe.
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      setError(checkoutErrorText(t, s, err));
    }
  };

  const goBack = () => navigate(PLAN_PATH);

  return (
    <div className="mx-auto max-w-form px-4 pb-20 pt-8 sm:px-6">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-2 rounded-control text-small font-medium text-fg-2 hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {s.back}
      </button>

      <PageHeader className="mt-4" eyebrow={s.eyebrow} title={t.title} description={t.description} />

      <div className="mt-6 space-y-6">
        {data.loading ? (
          <p role="status" className="text-body text-fg-3">
            {s.loading}
          </p>
        ) : (
          <ConfirmContent
            language={language}
            plan={data.plan}
            me={data.me}
            meFailure={data.meFailure}
            planFailed={data.planFailed}
            busy={busy}
            error={error}
            errorRef={errorRef}
            onSubmit={() => void submit()}
            onBack={goBack}
            onRetry={data.reload}
          />
        )}
      </div>
    </div>
  );
};

/**
 * The screen once GET /plan and /me answered (exported for server/tests/billingFront.test.js,
 * which checks that every required item comes before the button, in both languages).
 */
export const ConfirmContent: React.FC<{
  language: BillingLang;
  plan: BillingPlanInfo | null;
  me: BillingMe | null;
  meFailure: { status: number; errorType?: string } | null;
  planFailed: boolean;
  busy: boolean;
  error: string | null;
  errorRef?: React.Ref<HTMLDivElement>;
  onSubmit: () => void;
  onBack: () => void;
  onRetry: () => void;
}> = ({ language, plan, me, meFailure, planFailed, busy, error, errorRef, onSubmit, onBack, onRetry }) => {
  const s = sharedCopy[language];
  const t = copy[language];
  const state = planViewState({ me, meFailure, plan, planFailed });

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
  if (state === 'signin') {
    return (
      <Notice tone="info">
        <p>{s.signIn}</p>
      </Notice>
    );
  }
  if (state !== 'free' || !plan?.plan) {
    const text = state === 'manage'
      ? t.alreadySubscribed
      : state === 'eligibility'
        ? eligibilityText(s, me, language)
        : plan?.mode === 'test' ? s.closedTest : s.closed;
    return (
      <Notice tone="info">
        <p>{text}</p>
        <ButtonLink to={PLAN_PATH} variant="secondary" size="sm">
          {s.toPlan}
        </ButtonLink>
      </Notice>
    );
  }

  const details = plan.plan;
  const terms = plan.terms;
  const q = details.quantity;
  const row = (key: string) => disclosureValue(plan, key, language);
  const period = t.period[details.interval] ?? row('renewal');

  return (
    <>
      {plan.mode === 'test' && <TestModeBanner t={s} />}

      <div className={cardClasses}>
        <dl className="space-y-5">
          <Item term={t.items.plan}>
            <p className="text-body-lg font-semibold text-fg">{details.productName[language]}</p>
          </Item>
          <Item term={t.items.quantity}>
            <ul className="list-disc space-y-1 pl-5 marker:text-fg-3">
              <li>{q.llm[language]}</li>
              <li>{q.course_generation[language]}</li>
            </ul>
            <p>{q.free[language]}</p>
            <p>{q.shared[language]}</p>
          </Item>
          {period && (
            <Item term={t.items.period}>
              <p>{period}</p>
            </Item>
          )}
          <Item term={t.items.price}>
            <p className="font-semibold text-fg">{row('price')}</p>
          </Item>
          <Item term={t.items.payment}>
            <p>{row('payment')}</p>
          </Item>
          <Item term={t.items.delivery}>
            <p>{row('delivery')}</p>
          </Item>
          <Item term={t.items.offerPeriod}>
            <p>{row('offer_period')}</p>
          </Item>
          <Item term={t.items.cancellation}>
            <p>{terms?.cancellation[language] ?? row('cancellation')}</p>
            <p>{terms?.refunds[language] ?? row('refunds')}</p>
          </Item>
          <Item term={t.items.failedPayment}>
            <p>{terms?.failedPayment[language] ?? row('renewal')}</p>
          </Item>
          <Item term={t.items.conditions}>
            <p>{row('conditions')}</p>
          </Item>
          <Item term={t.items.handoff}>
            <p>{t.handoff}</p>
          </Item>
          <Item term={t.items.links}>
            <ul className="space-y-1">
              <li>
                <Link to={COMMERCE_PATH} className="font-medium text-primary-text underline underline-offset-4">
                  {s.commerce}
                </Link>
              </li>
              {plan.termsUrl && (
                <li>
                  <a
                    href={plan.termsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary-text underline underline-offset-4"
                  >
                    {t.terms}
                    <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
                    <span className="sr-only">{t.newTab}</span>
                  </a>
                </li>
              )}
            </ul>
          </Item>
        </dl>
      </div>

      {error && (
        <Notice ref={errorRef} role="alert" tone="error">
          <p>{error}</p>
          <ContactLine t={s} plan={plan} language={language} />
        </Notice>
      )}

      {/* After every item above: never sticky, never fixed (C36). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          id="plan-confirm-submit"
          variant="primary"
          size="lg"
          aria-disabled={busy || undefined}
          onClick={busy ? undefined : onSubmit}
        >
          {busy ? t.submitBusy : t.submit(formatYen(details.priceJpy))}
        </Button>
        <Button variant="secondary" size="lg" onClick={onBack}>
          {t.back}
        </Button>
      </div>
    </>
  );
};

/** One required item: a term and its description (a <div> grouping inside the <dl>). */
const Item: React.FC<{ term: string; children: React.ReactNode }> = ({ term, children }) => (
  <div className="border-l-2 border-line pl-3">
    <dt className="text-small font-semibold text-fg-2">{term}</dt>
    <dd className="mt-1 space-y-1 text-body text-fg">{children}</dd>
  </div>
);

export default PlanConfirmView;
