import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleAlert, CreditCard, Eye, EyeOff, Info, Trash2 } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { features } from '../../../config/features';
import PageHeader from '../../ui/PageHeader';
import { Button } from '../../ui/Button';
import { SupportContact } from '../../ui/SupportContact';
import { ConfirmDialog } from '../../safety/ConfirmDialog';
import { LegalNewTabLink } from '../../legal/LegalLinks';
import { getSupabaseClient } from '../../../services/supabaseClient';
import { openBillingPortal } from '../../../services/billingApi';
import {
  deleteAccount,
  deletionAppNames,
  getConnectedAppRecords,
  getDeletionPreflight,
  getSupabaseGrants,
  usedConnectedApps,
  type DeletionAppName,
  type DeletionErrorKind,
  type PreflightResult,
} from '../../../services/accountDeletionApi';
import type { ConnectedAppRecord } from '../../../services/oauthConsentRules';

/**
 * /settings/delete-account — delete one's own Rise Path data (Phase 4, owner decisions D1–D3,
 * design §5.11). The page says what is deleted and what stays (the shared login, P-School's
 * records, the proofs the law asks to keep), asks for the password again and confirms in a
 * dialog. The flow itself is services/accountDeletionApi.ts deleteAccount: an ephemeral password
 * sign-in, POST /api/v2/user/account/deletion, then AuthContext.endDeletedAccountSession, which
 * opens /account/deleted.
 *
 * States, from the preflight (GET /api/v2/user/account/deletion, the local copy of the plan):
 *   - guests, Nexloom-only and dev mock sessions: no records on the server, the Privacy page link;
 *   - preflight 404 (an api without this route: the front deploys first), network error or 5xx:
 *     "not available yet" with a retry, no form;
 *   - enabled false (the server's ACCOUNT_DELETION_ENABLED is not true: deletion starts off until
 *     the owner turns it on): "not from this page right now", no form;
 *   - a renewing supporter plan: cancel first (the Stripe portal when billing is on), no form;
 *   - otherwise the form. A 409 subscription_active (Stripe has a renewing plan the local copy
 *     missed) shows the same portal button in the error box when billing is on.
 * Errors are role="alert" and get focus; when the AI memories were already deleted before a
 * failure, the "nothing was deleted" line says so instead.
 */

const copy = {
  en: {
    eyebrow: 'Settings',
    back: 'Back to Settings',
    title: 'Delete your Rise Path account',
    description: 'Deletion happens right away and cannot be undone.',
    loading: 'Loading…',
    deletedTitle: 'What is deleted',
    deleted: [
      'Lesson progress and answers, learning history, XP, badges, learning days and the lessons you started over',
      'Courses you made and materials you uploaded',
      'Life journal (diary and daily records)',
      'AI memories and AI chat settings',
      'Birth year and month',
      'Connected AI app settings',
      'Profile, assessment results, notifications',
      'Rise Path records saved on this device',
    ],
    keptTitle: 'What stays',
    keptLogin:
      'Your sign-in (email, password and the name you registered with). It is shared with Nexloom and P-School, so this does not delete it. Signing in to Rise Path again with the same email starts an empty account. To delete the sign-in too, use the contact below.',
    keptPSchool:
      'Your P-School game records (user name, stage records). P-School is played inside Rise Path, so using it means signing in to Rise Path, which creates a new, empty Rise Path account.',
    keptProofs:
      'Records that you accepted the Terms of Use, of a guardian’s consent, and of this deletion (account ID, version and dates only; 5 years)',
    keptApps: 'The names of AI apps you used, with the first and last day of use (3 years)',
    keptPayments:
      'Payment records of the supporter plan (only if you used it; kept for tax and accounting, for about 7 years — the exact period is still being decided). Rise Path’s database unlinks them from your account, but the records at the payment service Stripe keep your account ID.',
    keptSafety: 'Safety records (unlinked from your account, up to 365 days)',
    keptUsage: 'Today’s AI usage count (kept up to 30 days)',
    keptLogs: 'Server logs (the oldest are removed automatically)',
    keptAiCompany: 'What was sent to the AI company (up to 30 days under its rules; up to 2 years when checking for violations)',
    keptBackups: 'Copies of the database that the operator made by hand (backups) may keep data from before the deletion for a while.',
    keptPolicyLead: 'How long each record is kept: section 8 of the ',
    keptPolicyLink: 'Privacy Policy',
    keptPolicyTail: ' (in Japanese).',
    newTab: '(opens in a new tab)',
    otherDevices: 'Other devices are signed out and cleared the next time Rise Path opens there.',
    minors: 'If you are under 18, please check this with a parent or guardian.',
    passwordLabel: 'Enter your password to confirm it’s you',
    passwordShow: 'Show password',
    passwordMissing: 'Please enter your password.',
    submit: 'Delete account',
    dialogTitle: 'Delete your account?',
    dialogBody: 'Your Rise Path data, except what is listed under “What stays”, will be deleted. This cannot be undone.',
    confirm: 'Delete',
    busy: 'Deleting…',
    cancel: 'Cancel',
    renewing: 'Your supporter plan is still renewing. Cancel it under “Payment and cancellation” first, then delete your account.',
    renewingNoBilling: 'Your supporter plan is still renewing. Please use the contact below to cancel it.',
    portal: 'Payment and cancellation',
    portalBusy: 'Opening Stripe…',
    portalFailed: 'We could not reach the payment service. Please try again in a little while.',
    disabled: 'Deleting from this page is turned off right now.',
    unavailable: 'This page is not available yet. Please open it again later.',
    retry: 'Try again',
    noServer: 'This sign-in has no records on Rise Path’s server. You can clear this device’s records on the Privacy page.',
    toPrivacy: 'Go to Privacy',
    nothingDeleted: 'Nothing was deleted.',
    memoryDeleted: 'Your AI memories were deleted; nothing else was.',
    tryLater: 'Please try again later.',
    reload: 'Reload the page',
    errors: {
      wrong_password: 'That password is not correct.',
      reauth_required: 'We could not confirm it’s you. Enter your password again.',
      subscription_active: 'Your supporter plan is still renewing. Cancel it under “Payment and cancellation” first, then delete your account.',
      subscription_active_contact: 'Your supporter plan is still renewing. Please use the contact below to cancel it.',
      payment_provider_unavailable: 'We could not check your plan with the payment service.',
      memory_service_unavailable: 'We could not reach the AI memory service.',
      deletion_disabled: 'Deleting from this page is turned off right now.',
      rate_limited: 'Too many tries. Wait a minute and try again.',
      unavailable: 'We can’t delete right now.',
      connection_lost: 'The connection dropped. Reload the page to check whether your account was deleted.',
    },
  },
  jp: {
    eyebrow: '設定',
    back: '設定に戻る',
    title: 'Rise Path のアカウントを削除する',
    description: '削除すると、すぐに消え、元に戻せません。',
    loading: '読み込んでいます…',
    deletedTitle: '消えるもの',
    deleted: [
      '学習の進み具合と解答、学習の履歴、XP とバッジ、学んだ日、やり直したレッスンの記録',
      '作ったコースとアップロードした教材',
      'ライフジャーナル（日記と生活の記録）',
      'AI の記憶と AI チャットの設定',
      '生まれた年と月',
      'つないだ AI アプリの設定',
      'プロフィール、診断の結果、通知',
      'この端末に保存された Rise Path の記録',
    ],
    keptTitle: '消えないもの',
    keptLogin:
      'ログイン（メールアドレス、パスワード、登録したときの名前）。Nexloom と P-School と共通なので、この操作では消えません。同じメールアドレスで Rise Path にもう一度ログインすると、空のアカウントから始まります。ログインも消したいときは、下のお問い合わせ先にご連絡ください。',
    keptPSchool:
      'P-School のゲームの記録（ユーザー名、ステージの記録）。P-School は Rise Path の中で遊ぶため、P-School を使うときは Rise Path にログインします。そのとき、新しい空の Rise Path アカウントが作られます。',
    keptProofs: '利用規約に同意した記録、保護者の同意の記録、アカウントを削除した記録（アカウント ID・版・日時だけ。5 年）',
    keptApps: '使ったことのある AI アプリの名前と、使い始めた日・最後に使った日（3 年）',
    keptPayments:
      '有料プランのお支払いの記録（使った方だけ。税と会計のために残します。期間は目安 7 年で、いま決めているところです）。Rise Path のデータベースではアカウントとのつながりを外しますが、決済サービス Stripe の記録にはアカウント ID が残ります。',
    keptSafety: '安全のための記録（アカウントとのつながりを外して、最長 365 日）',
    keptUsage: 'AI の 1 日の利用回数（今日の分だけ。30 日まで）',
    keptLogs: 'サーバーのログ（古いものから自動で消えます）',
    keptAiCompany: 'AI の会社に送った内容（その会社の決まりで最長 30 日。違反の確認では最長 2 年）',
    keptBackups: '運営者が手作業でとったデータベースの控え（バックアップ）には、削除の前のデータがしばらく残ることがあります。',
    keptPolicyLead: '残す期間は、',
    keptPolicyLink: 'プライバシーポリシーの「8. 保存期間」',
    keptPolicyTail: 'に書いています。',
    newTab: '（新しいタブで開きます）',
    otherDevices: 'ほかの端末では、次に開いたときにログアウトされ、その端末の記録も消えます。',
    minors: '18 歳未満の方は、保護者の方といっしょに確かめてください。',
    passwordLabel: '確認のため、パスワードを入れてください',
    passwordShow: 'パスワードを表示',
    passwordMissing: 'パスワードを入れてください。',
    submit: 'アカウントを削除する',
    dialogTitle: '本当に削除しますか？',
    dialogBody: '上の「消えないもの」以外の Rise Path のデータを削除します。元に戻せません。',
    confirm: '削除する',
    busy: '削除しています…',
    cancel: 'やめる',
    renewing: '有料プランが続いています。先に「お支払いと解約」から解約してから削除してください。',
    renewingNoBilling: '有料プランが続いています。解約の手続きは、下のお問い合わせ先にご連絡ください。',
    portal: 'お支払いと解約',
    portalBusy: 'Stripe の画面を開いています…',
    portalFailed: '決済サービスにつながりませんでした。少し時間をおいて、もう一度お試しください。',
    disabled: 'いまはこの画面から削除できません。',
    unavailable: 'この画面は準備中です。しばらくしてから、もう一度開いてください。',
    retry: 'もう一度読み込む',
    noServer: 'このログインでは、Rise Path のサーバーに記録はありません。この端末の記録は「プライバシー」の画面で消せます。',
    toPrivacy: 'プライバシーの画面へ',
    nothingDeleted: '何も消えていません。',
    memoryDeleted: 'AI の記憶は消えました。それ以外は消えていません。',
    tryLater: 'しばらくしてから、もう一度お試しください。',
    reload: 'ページを読み込み直す',
    errors: {
      wrong_password: 'パスワードがちがいます。',
      reauth_required: '確認できませんでした。もう一度パスワードを入れてください。',
      subscription_active: '有料プランが続いています。先に「お支払いと解約」から解約してから削除してください。',
      subscription_active_contact: '有料プランが続いています。解約の手続きは、お問い合わせ先にご連絡ください。',
      payment_provider_unavailable: 'お支払いのサービスで、契約の状態を確かめられませんでした。',
      memory_service_unavailable: 'AI の記憶を消すサービスにつながりませんでした。',
      deletion_disabled: 'いまはこの画面から削除できません。',
      rate_limited: '続けて試せる回数をこえました。1 分ほど待ってから、もう一度お試しください。',
      unavailable: 'いまは削除できません。',
      connection_lost: '通信が切れました。削除できたかを確かめるため、ページを読み込み直してください。',
    },
  },
} as const;

type Lang = keyof typeof copy;
type Copy = (typeof copy)[Lang];

export type DeletePageState =
  | { kind: 'loading' }
  | { kind: 'no_server_account' }
  | { kind: 'unavailable' }
  | { kind: 'disabled'; usedApps: boolean }
  | { kind: 'renewing'; usedApps: boolean }
  | { kind: 'ready'; usedApps: boolean };

export type DeletionError = { error: DeletionErrorKind; memoryDeleted: boolean };

/**
 * The preflight → the page (pure): not answered (404 from an api without the route, network,
 * 5xx) → 'unavailable' with no form; turned off → 'disabled'; a renewing plan → 'renewing'.
 * The kept AI apps line shows when a record was used, and when the list could not be read
 * (records null): the server keeps whatever used records it has.
 */
export function deletePageState(preflight: PreflightResult, records: readonly ConnectedAppRecord[] | null): DeletePageState {
  const usedApps = records === null || usedConnectedApps(records).length > 0;
  if (preflight.kind !== 'ready') return { kind: 'unavailable' };
  if (!preflight.preflight.enabled) return { kind: 'disabled', usedApps };
  if (preflight.preflight.subscription === 'renewing') return { kind: 'renewing', usedApps };
  return { kind: 'ready', usedApps };
}

/**
 * Which account this page may delete (pure): only the primary Supabase session is the identity the
 * api knows (apiFetch sends it); it must be the learner shown here and have an email for the
 * password check. Guests, mock and Nexloom-only sessions (no primary session), another account's
 * primary session and a session without an email → null: no records on the server to delete here.
 */
export function sessionAccount(
  user: { id: string; isGuest: boolean } | null,
  session: { user?: { id?: string | null; email?: string | null } | null } | null | undefined,
): { id: string; email: string } | null {
  if (!user || user.isGuest) return null;
  const id = session?.user?.id ?? '';
  const email = session?.user?.email ?? '';
  if (!id || id !== user.id || !email) return null;
  return { id, email };
}

/** How an error reads: its lines, and whether the contact line, the Stripe portal button or a reload follows. */
export function deletionErrorLines(
  t: Copy,
  { error, memoryDeleted }: DeletionError,
  billing: boolean,
): { lines: string[]; contact: boolean; portal: boolean; reload: boolean } {
  const nothing = memoryDeleted ? t.memoryDeleted : t.nothingDeleted;
  const only = { contact: false, portal: false, reload: false };
  switch (error) {
    case 'wrong_password':
    case 'reauth_required':
      return { ...only, lines: [t.errors[error], nothing] };
    case 'subscription_active':
      // Stripe has a renewing plan the local copy missed: cancel it right here (billing on).
      return billing
        ? { ...only, lines: [t.errors.subscription_active, nothing], portal: true }
        : { ...only, lines: [t.errors.subscription_active_contact, nothing], contact: true };
    case 'payment_provider_unavailable':
    case 'memory_service_unavailable':
    case 'unavailable':
      return { ...only, lines: [t.errors[error], nothing, t.tryLater] };
    case 'deletion_disabled':
      return { ...only, lines: [t.errors.deletion_disabled], contact: true };
    case 'rate_limited':
      return { ...only, lines: [t.errors.rate_limited] };
    case 'connection_lost':
    default:
      return { ...only, lines: [t.errors.connection_lost], reload: true };
  }
}

/** The Stripe portal (billing on): opened from the renewing-plan box and the subscription_active error. */
export type PortalControl = { busy: boolean; failed: boolean; onOpen: () => void };

/**
 * 「お支払いと解約」 and, after a failed try, why it did not open. `inAlert`: inside a role="alert"
 * box, which already announces what is added to it, so the failure line has no role of its own.
 */
const PortalButton: React.FC<{ language: Lang; portal: PortalControl; inAlert?: boolean }> = ({ language, portal, inAlert = false }) => {
  const t = copy[language];
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<CreditCard size={14} aria-hidden="true" />}
        aria-disabled={portal.busy || undefined}
        onClick={portal.busy ? undefined : portal.onOpen}
      >
        {portal.busy ? t.portalBusy : t.portal}
      </Button>
      {portal.failed ? (
        <p role={inAlert ? undefined : 'alert'} className="text-small text-danger">
          {t.portalFailed}
        </p>
      ) : null}
    </>
  );
};

const cardClasses = 'rounded-card border border-line bg-surface p-5 shadow-1';
const dangerButton =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-transparent bg-danger px-4 text-body font-semibold text-on-primary ' +
  'transition-opacity duration-120 hover:opacity-90 motion-reduce:transition-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** A boxed message (focusable, so an alert can take focus). */
const Box = React.forwardRef<HTMLDivElement, { tone: 'info' | 'error'; role?: 'alert' | 'status'; children: React.ReactNode }>(
  function Box({ tone, role, children }, ref) {
    return (
      <div ref={ref} tabIndex={-1} role={role} className={`rounded-control border border-line px-4 py-3 ${tone === 'error' ? 'bg-surface' : 'bg-sunken'}`}>
        <div className="flex items-start gap-2 text-body text-fg">
          {tone === 'error' ? (
            <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          )}
          <div className="min-w-0 space-y-2 text-pretty">{children}</div>
        </div>
      </div>
    );
  },
);

/** What is deleted and what stays (shown whenever the preflight answered). */
export const DeletionExplainer: React.FC<{ language: Lang; usedApps: boolean }> = ({ language, usedApps }) => {
  const t = copy[language];
  const deletedId = useId();
  const keptId = useId();
  const kept = [
    t.keptLogin,
    t.keptPSchool,
    t.keptProofs,
    ...(usedApps ? [t.keptApps] : []),
    t.keptPayments,
    t.keptSafety,
    t.keptUsage,
    t.keptLogs,
    t.keptAiCompany,
    t.keptBackups,
  ];
  return (
    <>
      <section aria-labelledby={deletedId} className={cardClasses}>
        <h2 id={deletedId} className="flex items-center gap-2 text-h3 text-fg">
          <Trash2 size={18} aria-hidden="true" className="shrink-0 text-danger" />
          {t.deletedTitle}
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-body text-fg-2 marker:text-fg-3">
          {t.deleted.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby={keptId} className={cardClasses}>
        <h2 id={keptId} className="text-h3 text-fg">
          {t.keptTitle}
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-body text-fg-2 marker:text-fg-3">
          {kept.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {/* Phase 4: once the policy is published (VITE_FEATURE_LEGAL_PAGES=true); a new tab keeps the password field. */}
        {features.legalPages ? (
          <p className="mt-3 text-body text-fg-2">
            {t.keptPolicyLead}
            <LegalNewTabLink to="/privacy#section-8" newTab={t.newTab} className="rounded-chip font-medium text-primary-text underline underline-offset-4">
              {t.keptPolicyLink}
            </LegalNewTabLink>
            {t.keptPolicyTail}
          </p>
        ) : null}
      </section>
      <div className="space-y-2 text-body text-fg-2">
        <p>{t.otherDevices}</p>
        <p>{t.minors}</p>
      </div>
      <SupportContact />
    </>
  );
};

/** Everything but the form: loading, no server account, not available, turned off, renewing plan. */
export const DeletionStateBody: React.FC<{
  language: Lang;
  state: Exclude<DeletePageState, { kind: 'ready' }>;
  billing: boolean;
  onRetry: () => void;
  portalBusy?: boolean;
  portalFailed?: boolean;
  onPortal?: () => void;
}> = ({ language, state, billing, onRetry, portalBusy = false, portalFailed = false, onPortal }) => {
  const t = copy[language];
  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-body text-fg-3">
        {t.loading}
      </p>
    );
  }
  if (state.kind === 'no_server_account') {
    return (
      <Box tone="info">
        <p>{t.noServer}</p>
        <p>
          <Link to="/settings/privacy" className="rounded-chip font-medium text-primary-text underline underline-offset-4">
            {t.toPrivacy}
          </Link>
        </p>
      </Box>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <>
        <Box tone="info">
          <p>{t.unavailable}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t.retry}
          </Button>
        </Box>
        <SupportContact />
      </>
    );
  }
  if (state.kind === 'disabled') {
    return (
      <>
        <Box tone="info">
          <p>{t.disabled}</p>
        </Box>
        <DeletionExplainer language={language} usedApps={state.usedApps} />
      </>
    );
  }
  // A renewing supporter plan: cancel first. No form.
  return (
    <>
      <Box tone="info">
        <p>{billing ? t.renewing : t.renewingNoBilling}</p>
        {billing ? <PortalButton language={language} portal={{ busy: portalBusy, failed: portalFailed, onOpen: onPortal ?? (() => undefined) }} /> : null}
      </Box>
      <DeletionExplainer language={language} usedApps={state.usedApps} />
    </>
  );
};

/** The error box after a failed try (role="alert"; the page moves focus to it). */
export const DeletionErrorNotice = React.forwardRef<HTMLDivElement, { language: Lang; error: DeletionError; billing: boolean; portal: PortalControl }>(
  function DeletionErrorNotice({ language, error, billing, portal }, ref) {
    const t = copy[language];
    const { lines, contact, portal: showPortal, reload } = deletionErrorLines(t, error, billing);
    return (
      <Box ref={ref} tone="error" role="alert">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {contact ? <SupportContact /> : null}
        {showPortal ? <PortalButton language={language} portal={portal} inAlert /> : null}
        {reload ? (
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            {t.reload}
          </Button>
        ) : null}
      </Box>
    );
  },
);

/** The password field, the delete button and the confirmation dialog. */
export const DeletionForm: React.FC<{
  language: Lang;
  busy: boolean;
  billing: boolean;
  error: DeletionError | null;
  /** The Stripe portal, for the subscription_active error with billing on. */
  portal: PortalControl;
  onConfirm: (password: string) => void;
  onClearError: () => void;
  /** Bumped after a wrong password: the field empties. */
  resetKey?: number;
}> = ({ language, busy, billing, error, portal, onConfirm, onClearError, resetKey = 0 }) => {
  const t = copy[language];
  const inputId = useId();
  const missingId = useId();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [missing, setMissing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // Where focus goes when the dialog closes: the error after a failed try, else the button.
  const returnFocusRef = useMemo(
    () => ({
      get current(): HTMLElement | null {
        return errorRef.current ?? buttonRef.current;
      },
    }),
    [],
  );

  useEffect(() => {
    setPassword('');
  }, [resetKey]);

  // A failed try closes the dialog; its close event then moves focus to the error.
  useEffect(() => {
    if (error) setConfirmOpen(false);
  }, [error]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      setMissing(true);
      inputRef.current?.focus();
      return;
    }
    setMissing(false);
    onClearError();
    setConfirmOpen(true);
  };

  return (
    <form noValidate onSubmit={submit} className={`${cardClasses} space-y-4`}>
      {error ? <DeletionErrorNotice ref={errorRef} language={language} error={error} billing={billing} portal={portal} /> : null}
      <div>
        <label htmlFor={inputId} className="block text-body font-semibold text-fg">
          {t.passwordLabel}
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={inputId}
            name="current-password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            aria-invalid={missing || undefined}
            aria-describedby={missing ? missingId : undefined}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (missing) setMissing(false);
            }}
            className="h-10 min-w-0 flex-1 basis-56 rounded-control border border-line-strong bg-surface px-3 text-body text-fg"
          />
          <button
            type="button"
            aria-pressed={show}
            aria-controls={inputId}
            onClick={() => setShow((value) => !value)}
            className="inline-flex h-10 items-center gap-2 rounded-control border border-line bg-surface px-3 text-small font-semibold text-fg hover:bg-sunken"
          >
            {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            {t.passwordShow}
          </button>
        </div>
        {missing ? (
          // Announced when it appears: focus is already in the field, so moving it there says nothing.
          <p id={missingId} role="alert" className="mt-2 text-small text-danger">
            {t.passwordMissing}
          </p>
        ) : null}
      </div>
      <button ref={buttonRef} type="submit" aria-disabled={busy || undefined} className={dangerButton}>
        <Trash2 size={16} aria-hidden="true" />
        {t.submit}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title={t.dialogTitle}
        body={t.dialogBody}
        confirmLabel={busy ? t.busy : t.confirm}
        cancelLabel={t.cancel}
        busy={busy}
        confirmTone="danger"
        onConfirm={() => onConfirm(password)}
        onClose={() => setConfirmOpen(false)}
        returnFocusRef={returnFocusRef}
      />
    </form>
  );
};

const DeleteAccountView: React.FC = () => {
  const { language } = useLanguage();
  const { user, endDeletedAccountSession } = useAuth();
  const navigate = useNavigate();
  const t = copy[language];
  const billing = features.billing;
  const [state, setState] = useState<DeletePageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null);
  const [appIds, setAppIds] = useState<string[]>([]);
  const [appNames, setAppNames] = useState<DeletionAppName[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DeletionError | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalFailed, setPortalFailed] = useState(false);
  // "Try again" unmounts itself (the page shows the loading line): focus moves to the page title.
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ kind: 'loading' });
    (async () => {
      let session: { user?: { id?: string; email?: string } } | null = null;
      if (user && !user.isGuest) {
        try {
          session = (await getSupabaseClient()?.auth.getSession())?.data.session ?? null;
        } catch {
          session = null;
        }
      }
      if (!active) return;
      const found = sessionAccount(user, session);
      if (!found) {
        setState({ kind: 'no_server_account' });
        return;
      }
      setAccount(found);
      const [preflight, records, grants] = await Promise.all([
        getDeletionPreflight(controller.signal),
        getConnectedAppRecords(controller.signal),
        getSupabaseGrants(),
      ]);
      if (!active) return;
      setAppIds((records ?? []).map((record) => record.clientId));
      // Supabase's names of the apps used, kept with the provision record (the server knows only ids).
      setAppNames(deletionAppNames(records, grants));
      setState(deletePageState(preflight, records));
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [user?.id, user?.isGuest, attempt]);

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
    setPortalFailed(false);
    try {
      window.location.assign(await openBillingPortal(language));
    } catch {
      setPortalBusy(false);
      setPortalFailed(true);
    }
  };

  const run = async (password: string) => {
    if (busy || !account) return;
    setBusy(true);
    const outcome = await deleteAccount({
      email: account.email,
      userId: account.id,
      password,
      apps: appNames,
      connectedAppIds: appIds,
      endSession: endDeletedAccountSession,
    });
    // 'self' and 'other': the deleted page is opening; stay busy until it does.
    if (outcome.kind !== 'error') return;
    setBusy(false);
    if (outcome.error === 'wrong_password') setResetKey((n) => n + 1);
    setError({ error: outcome.error, memoryDeleted: outcome.memoryDeleted });
  };

  return (
    <div className="mx-auto max-w-form px-4 pb-20 pt-8 sm:px-6">
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="inline-flex items-center gap-2 rounded-control text-small font-medium text-fg-2 hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {t.back}
      </button>

      <PageHeader className="mt-4" eyebrow={t.eyebrow} title={t.title} description={t.description} titleRef={titleRef} />

      <div className="mt-6 space-y-6">
        {state.kind === 'ready' ? (
          <>
            <DeletionExplainer language={language} usedApps={state.usedApps} />
            <DeletionForm
              language={language}
              busy={busy}
              billing={billing}
              error={error}
              portal={{ busy: portalBusy, failed: portalFailed, onOpen: () => void openPortal() }}
              resetKey={resetKey}
              onConfirm={(password) => void run(password)}
              onClearError={() => setError(null)}
            />
          </>
        ) : (
          <DeletionStateBody
            language={language}
            state={state}
            billing={billing}
            onRetry={() => {
              titleRef.current?.focus();
              setAttempt((n) => n + 1);
            }}
            portalBusy={portalBusy}
            portalFailed={portalFailed}
            onPortal={() => void openPortal()}
          />
        )}
      </div>
    </div>
  );
};

export default DeleteAccountView;
