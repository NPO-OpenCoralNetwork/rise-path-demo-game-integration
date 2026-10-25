import React, { useEffect, useRef } from 'react';
import { CloudAlert, LogIn, RotateCw } from 'lucide-react';
import { useLanguage, type Language } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { retryProgressSync, useProgressSaveView } from './progressSyncClient';
import { saveLongText } from './SaveChip';
import type { SaveView } from './progressSync.ts';

/**
 * The app notice while saving has stopped (Phase 5, design §4.3), in the Layout's notice slot on
 * every page: only when the save view is 'stopped' and this learner has lesson records the server
 * does not have yet. It says how many, why (the reason's long text), when the server last
 * confirmed them, and offers one action:
 *   - network / server: 「もう一度保存する」 (retryProgressSync: one GET or PUT now, at most every
 *     10 s); aria-disabled while a request runs, so focus stays on it;
 *   - auth: 「ログインし直す」 (logout with reason 'reauth': no question first; the records stay on
 *     this device and are saved at the same learner's next sign-in);
 *   - account (another tab's logout or learner), storage: no button (nothing here can fix it).
 * The role="status" region is always mounted and empty otherwise (no height), like the legal
 * notice bar, so what appears in it is announced. When it empties while its button had focus
 * (the retry worked), focus moves to the page's main area.
 */

const copy = {
  en: {
    count: (n: number) => `Some learning isn't saved yet (${n === 1 ? 'one lesson' : `${n} lessons`}).`,
    lastSaved: (time: string) => `Last saved at ${time}.`,
    retry: 'Try saving again',
    retrying: 'Saving…',
    signIn: 'Sign in again',
  },
  jp: {
    count: (n: number) => `まだ保存できていない学習があります（${n} 件）。`,
    lastSaved: (time: string) => `最後に保存できたのは ${time} です。`,
    retry: 'もう一度保存する',
    retrying: '保存しています…',
    signIn: 'ログインし直す',
  },
} as const;

const pad = (n: number) => String(n).padStart(2, '0');
/** HH:mm in the device's time zone. */
export function savedTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const barClasses = 'mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-sunken px-4 py-3 text-body text-fg print:hidden';
const buttonClasses = 'inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-small font-semibold text-fg hover:bg-raised aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/** The notice for a given view (exported for server/tests/phase5Front.test.js). */
export function SaveStoppedNoticeView({ language, view, onRetry, onSignIn, buttonRef, onButtonFocus }: {
  language: Language;
  view: SaveView;
  onRetry: () => void;
  onSignIn: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** The button got focus (the notice moves focus to main if it goes away from under it). */
  onButtonFocus?: () => void;
}) {
  const t = copy[language];
  const shown = view.state === 'stopped' && view.pending > 0;
  let content: React.ReactNode = null;
  if (shown) {
    const reason = view.reason;
    const retry = reason === 'network' || reason === 'server';
    content = (
      <div className={barClasses}>
        <CloudAlert size={18} aria-hidden="true" className="shrink-0 text-danger" />
        <p className="min-w-0 flex-1">
          {t.count(view.pending)}
          {language === 'jp' ? '' : ' '}
          {saveLongText(language, 'stopped', reason)}
          {view.savedAt !== null ? <>{language === 'jp' ? '' : ' '}{t.lastSaved(savedTime(view.savedAt))}</> : null}
        </p>
        {retry ? (
          <button
            ref={buttonRef}
            type="button"
            className={buttonClasses}
            aria-disabled={view.busy || undefined}
            onClick={() => {
              if (!view.busy) onRetry();
            }}
            onFocus={onButtonFocus}
          >
            <RotateCw size={14} aria-hidden="true" />
            {view.busy ? t.retrying : t.retry}
          </button>
        ) : reason === 'auth' ? (
          <button
            ref={buttonRef}
            type="button"
            className={buttonClasses}
            onClick={onSignIn}
            onFocus={onButtonFocus}
          >
            <LogIn size={14} aria-hidden="true" />
            {t.signIn}
          </button>
        ) : null}
      </div>
    );
  }
  // The same element in every state: only its content changes.
  return <div role="status">{content}</div>;
}

const SaveStoppedNotice: React.FC = () => {
  const { language } = useLanguage();
  const { logout } = useAuth();
  const view = useProgressSaveView();
  const shown = view.state === 'stopped' && view.pending > 0;
  const hadFocus = useRef(false);

  // The notice went away (saved, or the learner left) after its button had focus, and focus fell
  // to the page body (a removed element takes focus with it): the page's main area takes it.
  useEffect(() => {
    if (shown || !hadFocus.current) return;
    hadFocus.current = false;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (!active || active === document.body) document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [shown]);

  return (
    <SaveStoppedNoticeView
      language={language}
      view={view}
      onRetry={retryProgressSync}
      onSignIn={() => {
        hadFocus.current = false;
        void logout({ reason: 'reauth' });
      }}
      onButtonFocus={() => {
        hadFocus.current = true;
      }}
    />
  );
};

export default SaveStoppedNotice;
