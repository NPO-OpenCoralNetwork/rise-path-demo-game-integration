import React from 'react';
import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload, type LucideIcon } from 'lucide-react';
import { useLanguage, type Language } from '../../context/LanguageContext';
import { useProgressSaveView } from './progressSyncClient';
import type { SaveState, SaveView, StopReason } from './progressSync.ts';

/**
 * Where the learner's record is (Phase 5, design §4.2): a small chip in LessonBar, before the
 * progress ring, for lessons the server stores. Not interactive and not a live region (it changes
 * with every save): an icon, a short label (visible from 640 px, read by screen readers below), the
 * long text as its title and as screen-reader text. The icon and the words carry the meaning;
 * colour only repeats it (danger only while saving has stopped).
 * The long texts are shared with the reader's status line (ReaderStatus) and the app notice
 * (SaveStoppedNotice).
 */

type StateCopy = { label: string; long: string };

const copy = {
  en: {
    states: {
      saved: { label: 'Saved', long: 'Your learning record is saved to your account.' },
      saving: { label: 'Saving', long: 'Saving your learning record to your account.' },
      loading: { label: 'Loading', long: 'Loading your learning record.' },
      offline: {
        label: 'On this device for now',
        long: "The server can't be reached right now, so this device keeps your record. It is saved to your account once you're connected.",
      },
      stopped: { label: 'Saving stopped', long: "Your learning record isn't being saved to your account. It's still on this device." },
      local: { label: 'This device only', long: 'Your learning record is kept on this device only.' },
    },
    stopped: {
      auth: "We couldn't confirm your sign-in, so saving stopped. Your record is still on this device and is saved when you sign in again.",
      account: "Another tab logged out or signed in with a different account, so this tab isn't saving. Your record is still on this device.",
      storage: "This device's storage is full or blocked, so saving to your account stopped.",
    },
  },
  jp: {
    states: {
      saved: { label: '保存済み', long: '学習の記録は、アカウントに保存されています。' },
      saving: { label: '保存しています', long: '学習の記録を、アカウントに保存しています。' },
      loading: { label: '読み込み中', long: '学習の記録を読み込んでいます。' },
      offline: {
        label: 'この端末に保存中',
        long: 'いまはサーバーにつながらないため、この端末に記録しています。つながると、アカウントに保存します。',
      },
      stopped: { label: '保存が止まっています', long: '学習の記録を、アカウントに保存できていません。この端末には残っています。' },
      local: { label: 'この端末だけ', long: '学習の記録は、この端末だけに保存されます。' },
    },
    stopped: {
      auth: 'ログインの確認ができないため、保存が止まっています。この端末には残っていて、ログインし直すと保存します。',
      account: 'ほかのタブでログアウトしたか、別のアカウントでログインしたため、このタブでは保存していません。この端末には残っています。',
      storage: 'この端末の保存領域がいっぱいか使えないため、アカウントへの保存が止まっています。',
    },
  },
} as const satisfies Record<Language, { states: Record<SaveState, StateCopy>; stopped: Record<Exclude<StopReason, 'network' | 'server'>, string> }>;

/** The chip's texts (the status line and the app notice use the long ones). */
export const SAVE_COPY = copy;

export const SAVE_ICONS: Record<SaveState, LucideIcon> = {
  saved: CloudCheck,
  saving: CloudUpload,
  loading: Cloud,
  offline: CloudOff,
  stopped: CloudAlert,
  local: CloudOff,
};

/** The short label of a save state. */
export function saveLabel(language: Language, state: SaveState): string {
  return copy[language].states[state].label;
}

/** The long text of a save state; 'stopped' says why (auth, account, storage; network and server share one text). */
export function saveLongText(language: Language, state: SaveState, reason: StopReason | null): string {
  const text = copy[language];
  if (state === 'stopped' && (reason === 'auth' || reason === 'account' || reason === 'storage')) return text.stopped[reason];
  return text.states[state].long;
}

/** The chip for a given view (exported for server/tests/phase5Front.test.js). */
export function SaveChipView({ view, language }: { view: Pick<SaveView, 'state' | 'reason'>; language: Language }) {
  const Icon = SAVE_ICONS[view.state];
  const long = saveLongText(language, view.state, view.reason);
  return (
    <span className="rp-save" data-state={view.state} title={long}>
      <Icon size={16} aria-hidden="true" />
      <span className="rp-save-label" aria-hidden="true">{saveLabel(language, view.state)}</span>
      <span className="sr-only">{long}</span>
    </span>
  );
}

export function SaveChip() {
  const { language } = useLanguage();
  const view = useProgressSaveView();
  return <SaveChipView view={view} language={language} />;
}

export default SaveChip;
