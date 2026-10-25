import React, { useEffect, useRef } from 'react';
import { CloudAlert, CloudOff, RotateCcw } from 'lucide-react';
import { useLanguage, type Language } from '../../context/LanguageContext';
import { saveLongText } from './SaveChip';
import type { SaveView, StopReason } from './progressSync.ts';

/**
 * The reader's status line (Phase 5, design §4.2, finding 11): one line under the LessonBar, in its
 * notice slot beside the "resumed" pill. The role="status" region is always in the DOM and has no
 * size while it is empty, so screen readers announce what appears in it (a region that mounts
 * already filled is not announced). The card wraps (never an ellipsis: at 390 px the long texts
 * take two or three lines).
 * Messages, one at a time (LessonReader picks them; each clears itself after 8 s):
 *   - stall: saving moved to "on this device" or "stopped" while something is unsaved;
 *   - reset: the lesson was started over (LessonEnd).
 * "Close" empties it and moves focus to the page's main area (the button is gone). When the card
 * goes by itself (8 s, or saving works again) after its button had focus and focus fell to the
 * page body, the main area takes it too (as SaveStoppedNotice does).
 */

const copy = {
  en: {
    resetDone: "This lesson's record was deleted. You can start from the beginning.",
    close: 'Close',
  },
  jp: {
    resetDone: 'このレッスンの記録を消しました。最初から学べます。',
    close: '閉じる',
  },
} as const;

export type ReaderStatusMessage =
  | { kind: 'stall'; state: 'offline' | 'stopped'; reason: StopReason | null; id: number }
  | { kind: 'reset'; id: number };

/**
 * The reader's stall: saving moved to "on this device" or stopped while something is unsaved, as
 * 'offline:' or 'stopped:<reason>'; null otherwise (also for lessons the server does not store).
 * A string, so the reader re-renders only when it changes, not on every save; a new key is a new
 * message (saving ↔ saved flips never are).
 */
export function stallKeyOf(view: Pick<SaveView, 'state' | 'reason' | 'pending'>, syncable: boolean): string | null {
  if (!syncable || !(view.state === 'offline' || view.state === 'stopped') || !(view.pending > 0)) return null;
  return `${view.state}:${view.state === 'stopped' ? view.reason ?? '' : ''}`;
}

/** The message for a stall key. */
export function stallMessageOf(key: string, id: number): ReaderStatusMessage {
  const [state, reason] = key.split(':');
  return { kind: 'stall', state: state === 'stopped' ? 'stopped' : 'offline', reason: (reason || null) as StopReason | null, id };
}

/** The text of a message (exported for server/tests/phase5Front.test.js). */
export function readerStatusText(language: Language, message: ReaderStatusMessage): string {
  if (message.kind === 'reset') return copy[language].resetDone;
  return saveLongText(language, message.state, message.reason);
}

/** The Layout's main (tabIndex -1), without scrolling it. */
function focusMain(): void {
  if (typeof document === 'undefined') return;
  document.getElementById('main-content')?.focus({ preventScroll: true });
}

export function ReaderStatusView({ language, message, onDismiss, onButtonFocus }: {
  language: Language;
  message: ReaderStatusMessage | null;
  onDismiss: () => void;
  onButtonFocus?: () => void;
}) {
  const text = copy[language];
  let content: React.ReactNode = null;
  if (message) {
    const Icon = message.kind === 'reset' ? RotateCcw : message.state === 'offline' ? CloudOff : CloudAlert;
    content = (
      <p className="rp-status-card" data-kind={message.kind} data-state={message.kind === 'stall' ? message.state : undefined}>
        <Icon size={16} aria-hidden="true" className="rp-status-icon" />
        <span className="rp-status-text">{readerStatusText(language, message)}</span>
        <button
          type="button"
          className="rp-link-btn rp-notice-x"
          aria-label={text.close}
          onFocus={onButtonFocus}
          onClick={() => {
            onDismiss();
            focusMain();
          }}
        >
          ×
        </button>
      </p>
    );
  }
  // The same element in every state: only its content changes.
  return (
    <div className="rp-status" role="status" aria-live="polite">
      {content}
    </div>
  );
}

export function ReaderStatus({ message, onDismiss }: { message: ReaderStatusMessage | null; onDismiss: () => void }) {
  const { language } = useLanguage();
  const hadFocus = useRef(false);
  // The card went away by itself (8 s, or saving works again) after its button had focus, and focus
  // fell to the page body (a removed element takes focus with it): the page's main area takes it.
  useEffect(() => {
    if (message || !hadFocus.current) return;
    hadFocus.current = false;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (!active || active === document.body) focusMain();
  }, [message]);
  return (
    <ReaderStatusView
      language={language}
      message={message}
      onDismiss={() => {
        hadFocus.current = false; // the button's own click moves focus
        onDismiss();
      }}
      onButtonFocus={() => {
        hadFocus.current = true;
      }}
    />
  );
}

export default ReaderStatus;
