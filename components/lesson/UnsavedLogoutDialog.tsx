import React, { useEffect, useSyncExternalStore } from 'react';
import { CloudUpload } from 'lucide-react';
import { useLanguage, type Language } from '../../context/LanguageContext';
import { ConfirmDialog } from '../safety/ConfirmDialog';
import {
  answerUnsavedLearning,
  getLogoutPhase,
  logoutReturnTarget,
  registerLogoutDialog,
  restoreLogoutFocus,
  subscribeLogoutPhase,
  type LogoutPhase,
} from './logoutGuard';

/**
 * The logout question (Phase 5, owner decision O4; design §4.4), mounted once in App next to
 * ProgressAdoptDialog: outside the Layout's main (its `inert` never applies) and also while the
 * consent page replaces the app. AuthContext.logout asks logoutGuard first; this shows its phase.
 * - checking (the upload takes longer than 400 ms): a status line, not a dialog (finding 10): an
 *   always-mounted role="status" region, empty and without size otherwise. No buttons.
 * - asking: a fresh ConfirmDialog for every question (keyed by `ask`), so it opens modal with
 *   focus on 「ログアウトしない」 (the default) and screen readers read its title and body.
 *   「ログアウトしない」 or Esc: nothing is cleared, the learner stays signed in; focus returns to
 *   the element that asked for the logout, else the menu button, else the page's main area
 *   (finding 9: at 390 px the drawer's logout button is hidden by then). 「このままログアウト」: the
 *   records stay on this device for the same learner's next sign-in; another learner's sign-in
 *   deletes them.
 */

const copy = {
  en: {
    checking: 'Saving your learning…',
    title: "Some learning isn't saved yet",
    body: (n: number) => `You are still signed in. ${n === 1 ? "One lesson record isn't" : `${n} lesson records aren't`} saved to your account yet. If you log out now, ${n === 1 ? 'it stays' : 'they stay'} on this device and ${n === 1 ? 'is' : 'are'} saved the next time you sign in with this account. If someone signs in with a different account first, ${n === 1 ? 'it is' : 'they are'} deleted.`,
    cancel: 'Stay signed in',
    confirm: 'Log out anyway',
  },
  jp: {
    checking: '学習の記録を保存しています…',
    title: 'まだ保存できていない学習があります',
    body: (n: number) => `まだログアウトしていません。${n} 件のレッスンの記録を、まだアカウントに保存できていません。このままログアウトすると、記録はこの端末に残り、次に同じアカウントでログインしたときに保存します。その前に別のアカウントでログインすると、この記録は消えます。`,
    cancel: 'ログアウトしない',
    confirm: 'このままログアウト',
  },
} as const;

/** The dialog for a phase (exported for server/tests/phase5Front.test.js). */
export function UnsavedLogoutDialogView({ language, phase }: { language: Language; phase: LogoutPhase }) {
  const t = copy[language];
  return (
    <>
      {/* The same element in every phase: only its content changes. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 top-16 z-50 mx-auto max-w-sm md:top-4 print:hidden">
        {phase.kind === 'checking' ? (
          <p className="pointer-events-auto flex items-center gap-2 rounded-card border border-line bg-raised px-4 py-3 text-body text-fg shadow-2">
            <CloudUpload size={18} aria-hidden="true" className="shrink-0 text-info" />
            <span>{t.checking}</span>
          </p>
        ) : null}
      </div>
      {phase.kind === 'asking' ? (
        <ConfirmDialog
          key={phase.ask}
          open
          title={t.title}
          body={t.body(phase.unsaved)}
          confirmLabel={t.confirm}
          cancelLabel={t.cancel}
          confirmTone="danger"
          onConfirm={() => answerUnsavedLearning(true)}
          onClose={() => {
            // Esc or 「ログアウトしない」 (after 「このままログアウト」 the answer is already given).
            answerUnsavedLearning(false);
            restoreLogoutFocus(logoutReturnTarget());
          }}
        />
      ) : null}
    </>
  );
}

const UnsavedLogoutDialog: React.FC = () => {
  const { language } = useLanguage();
  const phase = useSyncExternalStore(subscribeLogoutPhase, getLogoutPhase, getLogoutPhase);
  useEffect(() => registerLogoutDialog(), []);
  return <UnsavedLogoutDialogView language={language} phase={phase} />;
};

export default UnsavedLogoutDialog;
