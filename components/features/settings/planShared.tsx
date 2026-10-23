import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, FlaskConical, Info } from 'lucide-react';
import { formatTokyoDateTime } from '../../safety/format';
import {
  billingFailure,
  contactEmail,
  getBillingMe,
  getBillingPlan,
  type BillingFailure,
  type BillingLang,
  type BillingMe,
  type BillingPlanInfo,
} from '../../../services/billingApi';

/**
 * Shared parts of /settings/plan (PlanView) and /settings/plan/confirm (PlanConfirmView): loading
 * GET /plan and GET /me, the notices, the eligibility and contact lines, and the test-mode banner.
 * Every number and disclosure line comes from GET /api/v2/billing/plan; the copy here holds none.
 */

export const sharedCopy = {
  en: {
    eyebrow: 'Settings',
    back: 'Back',
    loading: 'Loading…',
    retry: 'Try again',
    loadFailed: 'We could not load the plan details. Please try again in a little while.',
    signIn: 'To see plans, please sign in with your Rise Path account.',
    closed: 'The paid plan is not open for sign-up right now. The free plan’s limits stay the same.',
    closedTest: 'The paid plan is being prepared and is not open for sign-up right now. The free plan’s limits stay the same.',
    testBanner: 'Test mode: no real charges are made.',
    ageRequired: 'To sign up, first enter your birth year and month in AI access settings.',
    ageLink: 'Open AI access settings',
    adultsOnly:
      'People aged 18 and over can sign up. In the month you turn 18, you can sign up from the last day of that month. The free plan’s limits stay the same.',
    paused: (until: string | null) =>
      until
        ? `AI is resting today, so you cannot sign up now. You can sign up after ${until} (Japan time).`
        : 'AI is resting today, so you cannot sign up now. You can sign up after 00:00 Japan time.',
    contactEmail: (email: string) => `If this does not help, please write to ${email}.`,
    contactStaff: 'If this does not help, please tell the staff at your learning place.',
    commerce: 'Notice under the Specified Commercial Transactions Act',
    toPlan: 'Go to the plan page',
  },
  jp: {
    eyebrow: '設定',
    back: '戻る',
    loading: '読み込んでいます…',
    retry: 'もう一度試す',
    loadFailed: 'プランの情報を読み込めませんでした。少し時間をおいて、もう一度お試しください。',
    signIn: 'プランを見るには、Rise Path のアカウントでサインインしてください。',
    closed: '現在、有料プランの申し込みは受け付けていません。無料プランの上限は変わりません。',
    closedTest: '有料プランは準備中のため、現在、申し込みは受け付けていません。無料プランの上限は変わりません。',
    testBanner: 'テストモード: 実際の請求はありません',
    ageRequired: '申し込むには、先に「AI の利用設定」で生まれた年と月を登録してください。',
    ageLink: 'AI の利用設定を開く',
    adultsOnly: '18 歳以上の方が申し込めます。18 歳になる月は、その月の末日から申し込めます。無料プランの上限は変わりません。',
    paused: (until: string | null) =>
      until
        ? `今日は AI をお休みしているため、いまは申し込めません。${until}（日本時間）以降に申し込めます。`
        : '今日は AI をお休みしているため、いまは申し込めません。日本時間 0 時以降に申し込めます。',
    contactEmail: (email: string) => `解決しないときは、${email} までご連絡ください。`,
    contactStaff: '解決しないときは、ご利用の拠点のスタッフにお伝えください。',
    commerce: '特定商取引法に基づく表記',
    toPlan: 'プランの画面へ',
  },
} as const;

export type SharedCopy = (typeof sharedCopy)[BillingLang];

export const cardClasses = 'rounded-card border border-line bg-surface p-5 shadow-1';

export interface BillingData {
  loading: boolean;
  plan: BillingPlanInfo | null;
  planFailed: boolean;
  me: BillingMe | null;
  meFailure: BillingFailure | null;
}

/** GET /plan and GET /me together; reload() repeats both. */
export function useBillingData(): BillingData & { reload: () => void; setMe: (me: BillingMe) => void } {
  const [data, setData] = useState<BillingData>({ loading: true, plan: null, planFailed: false, me: null, meFailure: null });
  const [attempt, setAttempt] = useState(0);
  // Bumped by setMe: a /me read after this load started (the Checkout return's polling) wins.
  const meVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = meVersion.current;
    setData((prev) => ({ ...prev, loading: true }));
    Promise.allSettled([getBillingPlan(controller.signal), getBillingMe(controller.signal)]).then(([plan, me]) => {
      if (controller.signal.aborted) return;
      const fresh = meVersion.current === version;
      setData((prev) => ({
        loading: false,
        plan: plan.status === 'fulfilled' ? plan.value : null,
        planFailed: plan.status === 'rejected',
        me: fresh ? (me.status === 'fulfilled' ? me.value : null) : prev.me,
        meFailure: fresh ? (me.status === 'rejected' ? billingFailure(me.reason) : null) : prev.meFailure,
      }));
    });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setMe = useCallback((me: BillingMe) => {
    meVersion.current += 1;
    setData((prev) => ({ ...prev, me, meFailure: null }));
  }, []);
  return { ...data, reload, setMe };
}

type Tone = 'info' | 'warn' | 'ok' | 'error';

const TONE_ICON: Record<Tone, React.ReactNode> = {
  info: <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />,
  warn: <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />,
  error: <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />,
  ok: <CircleCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />,
};

/** A boxed message. `role` 'status' or 'alert' when it appears after an action; focusable for that. */
export const Notice = forwardRef<HTMLDivElement, {
  tone: Tone;
  role?: 'status' | 'alert';
  children: React.ReactNode;
  className?: string;
}>(function Notice({ tone, role, children, className = '' }, ref) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={role}
      className={`rounded-control border border-line px-4 py-3 ${tone === 'error' ? 'bg-surface' : 'bg-sunken'} ${className}`}
    >
      <div className="flex items-start gap-2 text-body text-fg">
        {TONE_ICON[tone]}
        <div className="min-w-0 space-y-2 text-pretty">{children}</div>
      </div>
    </div>
  );
});

/** Above the content in test mode (Stripe test keys: nothing is really charged). */
export const TestModeBanner: React.FC<{ t: SharedCopy }> = ({ t }) => (
  <p className="flex items-start gap-2 rounded-control border border-line bg-sunken px-4 py-3 text-body font-semibold text-fg text-pretty">
    <FlaskConical size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
    {t.testBanner}
  </p>
);

/** Who to ask: the seller's email from the 特商法 rows once it is filled in, else the staff. */
export const ContactLine: React.FC<{ t: SharedCopy; plan: BillingPlanInfo | null; language: BillingLang }> = ({ t, plan, language }) => {
  const email = contactEmail(plan, language);
  return <p className="text-small text-fg-2">{email ? t.contactEmail(email) : t.contactStaff}</p>;
};

/** The pause's end in Japan time, or null. */
export const pausedUntilText = (me: BillingMe | null, language: BillingLang) =>
  formatTokyoDateTime(me?.pausedUntil ?? null, language, true);

/** Why this learner cannot subscribe (eligibility other than 'ok' and 'unavailable'). */
export function eligibilityText(t: SharedCopy, me: BillingMe | null, language: BillingLang): string {
  switch (me?.eligibility) {
    case 'age_required':
      return t.ageRequired;
    case 'paused':
      return t.paused(pausedUntilText(me, language));
    default:
      // adults_only, and guardian_consent (only a minor needs it).
      return t.adultsOnly;
  }
}
