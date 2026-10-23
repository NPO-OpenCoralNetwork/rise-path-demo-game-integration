import React, { useLayoutEffect, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ConfirmDialog } from '../safety/ConfirmDialog';
import { chooseProgressAdoption, useProgressSyncState } from './progressSyncClient';

/**
 * The adoption choice (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6): a learner signs in
 * on a browser that holds lesson progress nobody owns (saved before progress was synced, or by a
 * guest). Shared tablets hold other children's progress, so nothing is added to the account
 * silently. "Don't add" is the default: it has focus first, and Esc chooses it. It clears the
 * progress on this device. Mounted once in App.tsx, inside the providers.
 */

const copy = {
  en: {
    title: 'Add the learning progress saved on this device to your account?',
    body: 'If someone else studied on this device, choose "Don\'t add". "Don\'t add" removes the progress saved on this device.',
    add: 'Add',
    dontAdd: "Don't add",
  },
  jp: {
    title: 'この端末に保存されている学習の記録を、あなたのアカウントに追加しますか？',
    body: 'ほかの人がこの端末で学習していた場合は「追加しない」を選んでください。追加しない場合、この端末の記録は消えます。',
    add: '追加する',
    dontAdd: '追加しない',
  },
} as const;

const ProgressAdoptDialog: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language];
  const { status } = useProgressSyncState();
  const open = status === 'needs_choice';
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Layout effects run before ConfirmDialog's showModal (a passive effect): remember where focus was.
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  // Closing for any reason other than "Add" (Esc, "Don't add") is "Don't add". After "Add" the
  // choice is already made, and the close that follows does nothing.
  return (
    <ConfirmDialog
      open={open}
      title={t.title}
      body={<p>{t.body}</p>}
      confirmLabel={t.add}
      cancelLabel={t.dontAdd}
      confirmTone="primary"
      onConfirm={() => chooseProgressAdoption(true)}
      onClose={() => chooseProgressAdoption(false)}
      returnFocusRef={returnFocusRef}
    />
  );
};

export default ProgressAdoptDialog;
