import React, { useEffect, useRef, useState } from 'react';
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
 *   - network / server: 「もう一度保存する」 (retryProgressSync: one GET now, or one PUT as soon as
 *     the core's 20 s PUT spacing allows, up to 20 s after the press); 「保存しています…」 and
 *     aria-disabled (focus stays on it) from the press until the request it asked for ends, also
 *     while that PUT waits for its spacing; the core's own retries on its backoff only set
 *     aria-disabled while they run and change no text in the live region (nothing is read again
 *     while the learner reads);
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
export function SaveStoppedNoticeView({ language, view, onRetry, onSignIn, buttonRef, onButtonFocus, retrying = false }: {
  language: Language;
  view: SaveView;
  onRetry: () => void;
  onSignIn: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** The button got focus (the notice moves focus to main if it goes away from under it). */
  onButtonFocus?: () => void;
  /** The learner's press asked for a request that has not ended yet (its label says so). */
  retrying?: boolean;
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
        {/* grow from a 16rem basis: at 390 px the button wraps under the text instead of squeezing it. */}
        <p className="min-w-0 grow basis-64">
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
            aria-disabled={view.busy || retrying || undefined}
            onClick={() => {
              if (!view.busy && !retrying) onRetry();
            }}
            onFocus={onButtonFocus}
          >
            <RotateCw size={14} aria-hidden="true" />
            {retrying ? t.retrying : t.retry}
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
  const retryShown = shown && (view.reason === 'network' || view.reason === 'server');
  const hadFocus = useRef(false);
  /**
   * The learner pressed 「もう一度保存する」 and the request it asked for has not ended: the failure
   * count at the press, and whether that request has started. A GET starts at once (the notice then
   * goes: loading); a PUT keeps the core's 20 s spacing, so it may start up to 20 s after the press.
   */
  const [pressed, setPressed] = useState<{ failures: number; started: boolean } | null>(null);

  // It ended when the notice went away or lost its button (saved, loading, another reason), when
  // its request was seen running and stopped, or when the upload failed again (one more failure,
  // also if no render saw it running).
  useEffect(() => {
    if (!pressed) return;
    if (!retryShown || (!view.busy && (pressed.started || view.failures !== pressed.failures))) setPressed(null);
    else if (view.busy && !pressed.started) setPressed({ failures: pressed.failures, started: true });
  }, [pressed, retryShown, view.busy, view.failures]);

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
      retrying={pressed !== null}
      onRetry={() => {
        // Nothing asked for (a GET at most every 10 s): the label stays.
        if (retryProgressSync()) setPressed({ failures: view.failures, started: false });
      }}
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
