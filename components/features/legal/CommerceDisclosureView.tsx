import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, ExternalLink, FlaskConical } from 'lucide-react';
import { useLanguage, type SelectedLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { features } from '../../../config/features';
import BrandMark from '../../common/BrandMark';
import PageHeader from '../../ui/PageHeader';
import { Button, ButtonLink } from '../../ui/Button';
import { commerceState, getBillingPlan, type BillingLang, type BillingPlanInfo } from '../../../services/billingApi';

/**
 * /legal/commerce — 特定商取引法に基づく表記 for the supporter plan (Phase 3, design §3; 特商法
 * 第11条, 施行規則第23条). Public: open when signed out (App.tsx PUBLIC_PATHS renders it outside
 * the Layout then, with its own header, skip link and <main>, like /ai-safety). Stripe's commerce
 * disclosure link and the Checkout submit text point here.
 *
 * The rows are GET /api/v2/billing/plan's disclosure rows (server/services/billingDisclosure.js),
 * rendered as they come in a <dl>. They show only in live mode with every owner fact filled in
 * (services/billingRules.ts commerceState). Test mode or billing off: 「現在、有料のサービスは提供
 * していません」 (test mode adds a 準備中 banner); the placeholders are never shown publicly.
 */

const copy = {
  en: {
    skip: 'Skip to content',
    language: 'Language',
    home: 'Rise Path home',
    backHome: 'Back to the home page',
    title: 'Notice under the Specified Commercial Transactions Act',
    description: 'Who sells Rise Path’s paid service, and on what terms.',
    loading: 'Loading…',
    loadFailed: 'We could not load this page. Please try again in a little while.',
    retry: 'Try again',
    notOffered: 'No paid service is offered right now.',
    testBanner: 'In preparation. You cannot sign up for a paid service right now (we are testing).',
    closedLive: 'New sign-ups are closed right now. If you already subscribe, you can cancel under Settings → Plan → “Payment and cancellation”.',
    terms: 'Terms of use',
    newTab: '(opens in a new tab)',
  },
  jp: {
    skip: '本文へ移動',
    language: '表示言語',
    home: 'Rise Path のホーム',
    backHome: 'ホームに戻る',
    title: '特定商取引法に基づく表記',
    description: 'Rise Path の有料サービスの販売事業者と、取引の条件です。',
    loading: '読み込んでいます…',
    loadFailed: 'このページを読み込めませんでした。少し時間をおいて、もう一度お試しください。',
    retry: 'もう一度試す',
    notOffered: '現在、有料のサービスは提供していません。',
    testBanner: '準備中です。現在、有料サービスの申し込みはできません（テスト中）。',
    closedLive: '現在、新しいお申し込みは受け付けていません。お申し込みずみの方は、設定 → プラン の「お支払いと解約」から解約できます。',
    terms: '利用規約',
    newTab: '（新しいタブで開きます）',
  },
} as const;

type CommerceCopy = (typeof copy)[BillingLang];

/** What the page shows once GET /plan answered (exported for server/tests/billingFront.test.js). */
export const CommerceContent: React.FC<{ language: BillingLang; plan: BillingPlanInfo | null }> = ({ language, plan }) => {
  const t: CommerceCopy = copy[language];
  const state = commerceState(plan);
  const rows = plan?.disclosure?.rows ?? [];

  if (state === 'not_offered') {
    return (
      <div className="space-y-4">
        {plan?.mode === 'test' && (
          <p className="flex items-start gap-2 rounded-control border border-line bg-sunken px-4 py-3 text-body font-semibold text-fg text-pretty">
            <FlaskConical size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
            {t.testBanner}
          </p>
        )}
        <p className="rounded-card border border-line bg-surface p-5 text-body-lg text-fg shadow-1 text-pretty">{t.notOffered}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {state === 'closed_live' && (
        <p className="rounded-control border border-line bg-sunken px-4 py-3 text-body text-fg">{t.closedLive}</p>
      )}
      <section aria-labelledby="commerce-title" className="rounded-card border border-line bg-surface p-5 shadow-1 sm:p-6">
        <dl className="divide-y divide-line">
          {rows.map((row) => (
            <div key={row.key} className="py-3 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
              <dt className="text-small font-semibold text-fg-2">{row.label[language]}</dt>
              <dd className="mt-1 break-words text-body text-fg sm:mt-0">{row.value[language]}</dd>
            </div>
          ))}
        </dl>
        {plan?.termsUrl && (
          <p className="mt-4 text-body">
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
          </p>
        )}
      </section>
    </div>
  );
};

const CommerceDisclosureView: React.FC = () => {
  const { language, selectedLanguage, setLanguage } = useLanguage();
  const { isLoggedIn } = useAuth();
  const t = copy[language];
  const standalone = !isLoggedIn;
  const languages: SelectedLanguage[] = features.frLocale ? ['en', 'jp', 'fr'] : ['en', 'jp'];
  const [plan, setPlan] = useState<BillingPlanInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    getBillingPlan(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setPlan(value);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('failed');
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const body = (
    <div className="mx-auto max-w-read px-4 pb-20 pt-8 sm:px-6">
      <PageHeader title={t.title} description={t.description} titleId="commerce-title" />
      {standalone && (
        <div className="mt-4">
          <ButtonLink to="/" variant="secondary" size="sm">
            {t.backHome}
          </ButtonLink>
        </div>
      )}
      <div className="mt-6">
        {status === 'loading' ? (
          <p role="status" className="text-body text-fg-3">
            {t.loading}
          </p>
        ) : status === 'failed' ? (
          <div role="alert" className="rounded-card border border-line bg-surface p-5 shadow-1">
            <p className="flex items-start gap-2 text-body text-fg">
              <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
              {t.loadFailed}
            </p>
            <Button className="mt-3" variant="secondary" size="sm" onClick={retry}>
              {t.retry}
            </Button>
          </div>
        ) : (
          <CommerceContent language={language} plan={plan} />
        )}
      </div>
    </div>
  );

  if (!standalone) return body;

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-fg">
      <a
        href="#commerce-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-3"
      >
        {t.skip}
      </a>
      <header className="mx-auto flex max-w-wide items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
        <Link to="/" aria-label={t.home} className="flex items-center gap-2.5 rounded-control text-h3 font-bold text-fg">
          <BrandMark size={30} />
          <span>Rise Path</span>
        </Link>
        <div role="group" aria-label={t.language} className="flex items-center gap-1 text-small">
          {languages.map((lang) => {
            const active = selectedLanguage === lang;
            return (
              <button
                key={lang}
                type="button"
                lang={lang === 'jp' ? 'ja' : lang}
                aria-pressed={active}
                onClick={() => setLanguage(lang)}
                className={`h-8 min-w-10 rounded-full px-2.5 font-semibold transition-colors duration-120 ${
                  active ? 'border border-line bg-surface text-fg shadow-1' : 'text-fg-3 hover:text-fg'
                }`}
              >
                {lang.toUpperCase()}
              </button>
            );
          })}
        </div>
      </header>
      <main id="commerce-main" tabIndex={-1} className="focus:outline-none">
        {body}
      </main>
    </div>
  );
};

export default CommerceDisclosureView;
