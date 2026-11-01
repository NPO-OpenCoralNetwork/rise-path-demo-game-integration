import React, { useEffect, useId, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/Button';
import { PublicPageShell } from '../ui/PublicPageShell';
import { SupportContact } from '../ui/SupportContact';

/**
 * Phase 9 (D1): shown by App.tsx instead of the app when the server's pilot list refused the
 * signed-in account (403 pilot_only, server/middleware/pilotGate.js; services/pilotAccess.ts).
 * Rise Path is open only to the staff and adult testers of the closed pilot; the Supabase project is
 * shared with Nexloom and P-School, so their logins can sign in but get this page.
 * A page, not a dialog: Esc does not close it (nothing behind it would work). The heading takes
 * focus on mount; "Sign out" is the app's logout with scope 'local' (App.tsx handlePilotSignOut): it ends
 * only this browser's session, never the account's Nexloom or P-School sessions on other devices.
 */

const copy = {
  en: {
    title: 'This account is not part of the current trial',
    body: 'For now, Rise Path is open only to the people taking part in the trial. Sign out, or contact the Rise Path team.',
    signOut: 'Sign out',
  },
  jp: {
    title: 'このアカウントは、いまの試験運用の対象ではありません',
    body: 'Rise Path は、いまは試験運用に参加している方だけが使えます。ログアウトするか、担当者にお問い合わせください。',
    signOut: 'ログアウト',
  },
} as const;

type Lang = keyof typeof copy;

/** What the page says (exported for server/tests/pilotGate.test.js). */
export const PilotOnlyBody: React.FC<{
  language: Lang;
  onSignOut: () => void;
  titleId?: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
}> = ({ language, onSignOut, titleId, titleRef }) => {
  const t = copy[language];
  return (
    <div className="mx-auto max-w-read px-4 pb-20 pt-8 sm:px-6">
      <section aria-labelledby={titleId} className="space-y-4 rounded-card border border-line bg-surface p-5 shadow-1 sm:p-6">
        <h1 ref={titleRef} id={titleId} tabIndex={-1} className="break-words text-h1 text-fg focus:outline-none">
          {t.title}
        </h1>
        <p className="text-body-lg text-fg">{t.body}</p>
        <SupportContact />
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={onSignOut}>
            {t.signOut}
          </Button>
        </div>
      </section>
    </div>
  );
};

const PilotOnlyView: React.FC<{ onSignOut: () => void }> = ({ onSignOut }) => {
  const { language } = useLanguage();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <PublicPageShell>
      <PilotOnlyBody language={language} onSignOut={onSignOut} titleId={titleId} titleRef={titleRef} />
    </PublicPageShell>
  );
};

export default PilotOnlyView;
