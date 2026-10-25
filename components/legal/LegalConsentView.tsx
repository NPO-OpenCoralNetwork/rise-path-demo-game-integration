import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleAlert } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { features } from '../../config/features';
import { Button } from '../ui/Button';
import { PublicPageShell } from '../ui/PublicPageShell';
import { SupportContact } from '../ui/SupportContact';
import { LEGAL_DOCUMENTS, documentsToAcceptAgain, type LegalDocumentName } from '../../shared/legal/versions.js';
import { legalPageTitle, setPageTitle } from '../features/legal/pageTitle';
import { formatEffectiveDate } from './legalDate';
import { LegalNewTabLink } from './LegalLinks';
import { legalGate, useLegalGate, type AcceptOutcome } from './legalGateClient';

/**
 * The re-consent page (Phase 4, design §4.3): shown by App.tsx instead of the app while the
 * signed-in learner has not accepted a terms version that requires acceptance (existing,
 * P-School-created and admin-created accounts, a sign-up on another device, a terms change that
 * needs agreement again). A page, not a dialog: a dialog closes on Esc, and the service cannot be
 * used without the agreement terms 第1条 asks for.
 *
 * - The texts open in a new tab; the checkbox is unticked; "Agree and continue" stays disabled
 *   until it is ticked. "Sign out" is the app's own logout.
 * - Without agreeing, the person can still withdraw the guardian's AI consent, delete records,
 *   delete the account and reach the support contact (those pages are exempt: App.tsx
 *   LEGAL_GATE_EXEMPT).
 * - The first line names what changed: the Terms, the Privacy Policy or both
 *   (documentsToAcceptAgain), each with its own effective date; a first agreement says so.
 * - Focus starts on the heading; an error is announced (role="alert") and focused. A 409 (the
 *   server has newer texts than this page) says to reload and offers a reload button.
 * Nothing is collected here: the server records the account id, the versions and the time (D5).
 */

const copy = {
  en: {
    title: 'Please review our Terms of Use and Privacy Policy',
    first:
      'To use Rise Path, please agree to the Terms of Use. The Privacy Policy explains why and how we use personal information.',
    changed: {
      terms: (date: string | null) =>
        `We updated the Terms of Use${date ? ` (from ${date})` : ''}. To keep using Rise Path, please agree to the new Terms of Use.`,
      privacy: (date: string | null) =>
        `We updated the Privacy Policy${date ? ` (from ${date})` : ''}. To keep using Rise Path, please agree to the new Privacy Policy.`,
      both: (terms: string | null, privacy: string | null) =>
        `We updated the Terms of Use${terms ? ` (from ${terms})` : ''} and the Privacy Policy${privacy ? ` (from ${privacy})` : ''}. To keep using Rise Path, please agree to the new texts.`,
    },
    readTerms: 'Read the Terms of Use',
    readPrivacy: 'Read the Privacy Policy',
    newTab: '(opens in a new tab)',
    agreeBefore: 'I agree to the ',
    terms: 'Terms of Use',
    agreeMiddle: ' and have read the ',
    privacy: 'Privacy Policy',
    agreeAfter: '. (Both are in Japanese; the Japanese text is official.)',
    minors: 'If you are under 18, get your parent’s or guardian’s consent before you press “Agree and continue”.',
    agree: 'Agree and continue',
    saving: 'Saving…',
    signOut: 'Sign out',
    withoutTitle: 'Without agreeing, you can still:',
    withdraw: 'Withdraw the guardian’s consent to AI features',
    privacySettings: 'Privacy settings (delete records)',
    deleteAccount: 'Delete your account',
    mismatch: 'The text has changed. Reload the page, read it again, then agree.',
    reload: 'Reload',
    failed: 'We could not record your answer. Check your connection and try again.',
  },
  jp: {
    title: '利用規約とプライバシーポリシーのご確認',
    first:
      'Rise Path を使うには、利用規約への同意が必要です。プライバシーポリシーには、個人情報の利用目的と扱い方を書いています。',
    changed: {
      terms: (date: string | null) =>
        `利用規約を改定しました${date ? `（${date}から）` : ''}。続けて使うには、新しい利用規約への同意が必要です。`,
      privacy: (date: string | null) =>
        `プライバシーポリシーを改定しました${date ? `（${date}から）` : ''}。続けて使うには、新しいプライバシーポリシーへの同意が必要です。`,
      both: (terms: string | null, privacy: string | null) =>
        `利用規約${terms ? `（${terms}から）` : ''}とプライバシーポリシー${privacy ? `（${privacy}から）` : ''}を改定しました。続けて使うには、新しい内容への同意が必要です。`,
    },
    readTerms: '利用規約を読む',
    readPrivacy: 'プライバシーポリシーを読む',
    newTab: '（新しいタブで開きます）',
    agreeBefore: '',
    terms: '利用規約',
    agreeMiddle: 'に同意し、',
    privacy: 'プライバシーポリシー',
    agreeAfter: 'を読みました。',
    minors: '18 歳未満の方は、保護者の方の同意を得てから「同意して続ける」を押してください。',
    agree: '同意して続ける',
    saving: '記録しています…',
    signOut: 'ログアウト',
    withoutTitle: '同意しなくても、次のことはできます',
    withdraw: 'AI 機能への保護者の同意をやめる',
    privacySettings: 'プライバシーの設定（記録を消す）',
    deleteAccount: 'アカウントを削除する',
    mismatch: '文が新しくなりました。ページを読み込み直して、もう一度読んでから同意してください。',
    reload: '読み込み直す',
    failed: '記録できませんでした。通信を確かめて、もう一度お試しください。',
  },
} as const;

type Lang = keyof typeof copy;

/** Pages the person can open without agreeing (they are in App.tsx LEGAL_GATE_EXEMPT). */
export const CONSENT_PAGE_LINKS = Object.freeze({
  withdraw: '/settings/ai-access',
  privacySettings: '/settings/privacy',
  deleteAccount: '/settings/delete-account',
} as const);

const linkClasses = 'rounded-chip font-medium text-primary-text underline underline-offset-4';

/** What the page says (exported for server/tests/legalConsentFront.test.js). */
export const LegalConsentBody: React.FC<{
  language: Lang;
  /** The documents that need agreement again ([]: a first agreement). */
  changed: readonly LegalDocumentName[];
  ticked: boolean;
  busy: boolean;
  error: 'mismatch' | 'failed' | null;
  onTick: (ticked: boolean) => void;
  onAgree: () => void;
  onSignOut: () => void;
  /** The mismatch error's reload button (window.location.reload on the page). */
  onReload?: () => void;
  titleId?: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
  errorRef?: React.Ref<HTMLParagraphElement>;
  checkboxId?: string;
  minorsId?: string;
}> = ({ language, changed, ticked, busy, error, onTick, onAgree, onSignOut, onReload, titleId, titleRef, errorRef, checkboxId = 'legal-consent', minorsId = 'legal-consent-minors' }) => {
  const t = copy[language];
  const dateOf = (document: LegalDocumentName) => formatEffectiveDate(LEGAL_DOCUMENTS[document].effectiveDate, language);
  const lead = changed.includes('terms') && changed.includes('privacy')
    ? t.changed.both(dateOf('terms'), dateOf('privacy'))
    : changed.includes('terms')
      ? t.changed.terms(dateOf('terms'))
      : changed.includes('privacy')
        ? t.changed.privacy(dateOf('privacy'))
        : t.first;
  const errorId = `${checkboxId}-error`;
  return (
    <div className="mx-auto max-w-read px-4 pb-20 pt-8 sm:px-6">
      <header>
        <h1 ref={titleRef} id={titleId} tabIndex={-1} className="break-words text-h1 text-fg focus:outline-none">
          {t.title}
        </h1>
      </header>
      <div className="mt-6 space-y-4 rounded-card border border-line bg-surface p-5 shadow-1 sm:p-6">
        <p className="text-body-lg text-fg">{lead}</p>
        <ul className="flex flex-col gap-2 text-body sm:flex-row sm:gap-6">
          <li>
            <LegalNewTabLink to="/terms" newTab={t.newTab} className={linkClasses}>
              {t.readTerms}
            </LegalNewTabLink>
          </li>
          <li>
            <LegalNewTabLink to="/privacy" newTab={t.newTab} className={linkClasses}>
              {t.readPrivacy}
            </LegalNewTabLink>
          </li>
        </ul>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ticked && !busy) onAgree();
          }}
        >
          <div className="flex items-start gap-3">
            <input
              id={checkboxId}
              type="checkbox"
              checked={ticked}
              disabled={busy}
              onChange={(event) => onTick(event.target.checked)}
              aria-describedby={error ? `${minorsId} ${errorId}` : minorsId}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <label htmlFor={checkboxId} className="text-body text-fg">
              {t.agreeBefore}
              <LegalNewTabLink to="/terms" newTab={t.newTab} className={linkClasses}>
                {t.terms}
              </LegalNewTabLink>
              {t.agreeMiddle}
              <LegalNewTabLink to="/privacy" newTab={t.newTab} className={linkClasses}>
                {t.privacy}
              </LegalNewTabLink>
              {t.agreeAfter}
            </label>
          </div>
          <p id={minorsId} className="text-body text-fg-2">
            {t.minors}
          </p>
          {error ? (
            <p ref={errorRef} id={errorId} role="alert" tabIndex={-1} className="flex items-start gap-2 text-body text-danger focus:outline-none">
              <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              {error === 'mismatch' ? t.mismatch : t.failed}
            </p>
          ) : null}
          {error === 'mismatch' && onReload ? (
            <Button type="button" variant="secondary" onClick={onReload}>
              {t.reload}
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!ticked || busy}>
              {busy ? t.saving : t.agree}
            </Button>
            <Button type="button" variant="secondary" onClick={onSignOut} disabled={busy}>
              {t.signOut}
            </Button>
          </div>
        </form>
      </div>
      <section aria-labelledby={`${checkboxId}-without`} className="mt-6 space-y-3 text-body text-fg-2">
        <h2 id={`${checkboxId}-without`} className="text-h3 text-fg">
          {t.withoutTitle}
        </h2>
        <ul className="list-disc space-y-2 pl-5 marker:text-fg-3">
          <li>
            <Link to={CONSENT_PAGE_LINKS.withdraw} className={linkClasses}>
              {t.withdraw}
            </Link>
          </li>
          <li>
            <Link to={CONSENT_PAGE_LINKS.privacySettings} className={linkClasses}>
              {t.privacySettings}
            </Link>
          </li>
          <li>
            <Link to={CONSENT_PAGE_LINKS.deleteAccount} className={linkClasses}>
              {t.deleteAccount}
            </Link>
          </li>
        </ul>
        <SupportContact />
      </section>
    </div>
  );
};

const LegalConsentView: React.FC = () => {
  const { language } = useLanguage();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const gate = useLegalGate(features.legalPages);
  const titleId = useId();
  const checkboxId = useId();
  const minorsId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'mismatch' | 'failed' | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => (typeof window === 'undefined' ? undefined : setPageTitle(window.document, legalPageTitle(copy[language].title))), [language]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const agree = async () => {
    setBusy(true);
    setError(null);
    let outcome: AcceptOutcome = 'failed';
    try {
      outcome = await legalGate(features.legalPages).accept();
    } finally {
      setBusy(false);
    }
    // accepted: App.tsx shows the app; account_deleted: the deleted-account flow takes over.
    if (outcome === 'version_mismatch') {
      setTicked(false);
      setError('mismatch');
    } else if (outcome === 'failed') {
      setError('failed');
    }
  };

  // The app's own logout (App.tsx handleLogout): then the home page.
  const signOut = () => {
    logout()
      .catch((e) => console.warn('Logout failed:', e))
      .finally(() => navigate('/', { replace: true }));
  };

  return (
    <PublicPageShell>
      <LegalConsentBody
        language={language}
        changed={documentsToAcceptAgain(gate.lastAccepted)}
        ticked={ticked}
        busy={busy}
        error={error}
        onTick={(next) => {
          setTicked(next);
          if (next) setError((e) => (e === 'mismatch' ? null : e));
        }}
        onAgree={() => void agree()}
        onSignOut={signOut}
        onReload={() => window.location.reload()}
        titleId={titleId}
        titleRef={titleRef}
        errorRef={errorRef}
        checkboxId={checkboxId}
        minorsId={minorsId}
      />
    </PublicPageShell>
  );
};

export default LegalConsentView;
