import React, { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useLanguage, type Language } from '../../context/LanguageContext';
import { leftRecordCount, type SyncStorage } from './progressSync.ts';
import { isSyncableLesson } from './progressSyncClient';

/**
 * The sign-in view's note about lesson records a learner left on this device unsaved (Phase 5,
 * design §4.3): after a session expiry, a logout in another tab or on another device,
 * 「このままログアウト」 or 「ログインし直す」. It counts only records that were unsent when the
 * learner left, of lessons the server stores (leftRecordCount; a session end also marks records
 * the server already has as theirs). They are saved when the same learner signs in again;
 * someone else's sign-in deletes them (the owner rule), which the next person on a shared device
 * is told here. It names no lesson. An info box present at mount (not a live region); it follows
 * other tabs (a sign-in there saves or deletes them).
 */

const copy = {
  en: {
    body: (n: number) => `This device has learning that isn't saved yet (${n === 1 ? 'one lesson' : `${n} lessons`}). Sign in with the same account to save it. If you sign in with a different account, it is deleted.`,
  },
  jp: {
    body: (n: number) => `この端末に、まだ保存できていない学習の記録があります（${n} 件）。前と同じアカウントでログインすると保存します。別のアカウントでログインすると、この記録は消えます。`,
  },
} as const;

function deviceStorage(): SyncStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The note for a count (nothing for 0; exported for server/tests/phase5Front.test.js). */
export function LeftRecordsNoticeView({ language, count }: { language: Language; count: number }) {
  if (!(count > 0)) return null;
  // The sign-in view is always dark: the box takes the dark token values.
  return (
    <div data-theme="dark" className="mb-6 flex items-start gap-3 rounded-card border border-line bg-sunken px-4 py-3 text-small text-fg">
      <CloudOff size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
      <p className="min-w-0 flex-1">{copy[language].body(count)}</p>
    </div>
  );
}

const LeftRecordsNotice: React.FC = () => {
  const { language } = useLanguage();
  const [count, setCount] = useState(() => leftRecordCount(deviceStorage(), isSyncableLesson));
  useEffect(() => {
    const recount = () => setCount(leftRecordCount(deviceStorage(), isSyncableLesson));
    window.addEventListener('storage', recount);
    return () => window.removeEventListener('storage', recount);
  }, []);
  return <LeftRecordsNoticeView language={language} count={count} />;
};

export default LeftRecordsNotice;
