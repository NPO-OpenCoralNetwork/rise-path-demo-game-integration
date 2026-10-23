import React, { useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../safety/ConfirmDialog';
import { deleteLessonProgress, useProgressSyncState } from '../../lesson/progressSyncClient';

/**
 * Privacy page: delete the learner's lesson progress (Phase 2, doc/brushup-2026/ai-access-plan.ja.md
 * §6). Signed in with sync: the server's records go first (every course, every device, quiz
 * answers included), and only then this device's; a failure changes nothing. Otherwise (guests,
 * no API): this device only. A confirm dialog, not "type DELETE": children use this page.
 * The learning history (/user/events: lessons started and finished) and what AI apps saved
 * through the learner-state tools stay. The streak can get shorter: it also counts the days of
 * the deleted records (components/ui/ProgressCluster.tsx), so days when the learner only read go.
 * The button stays enabled while deleting (the open dialog makes it inert), so the dialog can
 * return focus to it however it closes.
 */

const copy = {
  en: {
    title: 'Delete lesson progress',
    body: 'Deletes what the lessons saved for you in every course: what you read, your quiz answers, checklists, self-ratings and where to continue.',
    scopeAccount: 'It is deleted on every device where you are signed in. This cannot be undone.',
    scopeDevice: 'It is deleted on this device. This cannot be undone.',
    kept: 'Not deleted: your learning history (lessons you started and finished) and records that AI apps saved with the learner-state tools. Your streak can get shorter, because days when you only read lessons no longer count.',
    button: 'Delete lesson progress',
    dialogTitle: 'Delete all your lesson progress?',
    dialogAccount: 'Every course, on every device, quiz answers included. This cannot be undone.',
    dialogDevice: 'Every course on this device, quiz answers included. This cannot be undone.',
    confirm: 'Delete',
    busy: 'Deleting…',
    cancel: 'Cancel',
    doneAccount: 'Your lesson progress was deleted.',
    doneDevice: 'The lesson progress on this device was deleted.',
    failed: 'Your lesson progress could not be deleted, so nothing was changed. Please try again later.',
  },
  jp: {
    title: '学習の進み具合を消す',
    body: 'すべてのコースについて、レッスンに記録された内容を消します。読んだところ、確認問題の答え、チェックリスト、自己評価、続きの位置です。',
    scopeAccount: 'ログインしているすべての端末から消えます。元に戻すことはできません。',
    scopeDevice: 'この端末から消えます。元に戻すことはできません。',
    kept: '学習の履歴（レッスンを始めた・終えた記録）と、AI アプリが学習状況ツール（learner-state）で保存した記録は消えません。連続記録は、レッスンを読んだだけの日が数えられなくなるため、短くなることがあります。',
    button: '学習の進み具合を消す',
    dialogTitle: '学習の進み具合をすべて消しますか？',
    dialogAccount: 'すべてのコース、すべての端末が対象で、確認問題の答えも消えます。元に戻すことはできません。',
    dialogDevice: 'この端末のすべてのコースが対象で、確認問題の答えも消えます。元に戻すことはできません。',
    confirm: '消す',
    busy: '消しています…',
    cancel: 'やめる',
    doneAccount: '学習の進み具合を消しました。',
    doneDevice: 'この端末の学習の進み具合を消しました。',
    failed: '消すことができなかったため、何も変更していません。しばらくしてからもう一度お試しください。',
  },
} as const;

type Notice = { tone: 'done' | 'failed'; text: string } | null;

const LessonProgressDeleteSection: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language];
  // A primary session is signed in to sync: the delete reaches the server and every device.
  const { userId } = useProgressSyncState();
  const signedIn = userId !== null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await deleteLessonProgress();
      setNotice(result.ok
        ? { tone: 'done', text: result.scope === 'account' ? t.doneAccount : t.doneDevice }
        : { tone: 'failed', text: t.failed });
    } catch {
      setNotice({ tone: 'failed', text: t.failed });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <section aria-labelledby={titleId} className="rounded-card border border-line bg-surface p-5 shadow-1">
      {/* Same size as the page's other section headings (16 px semibold), not a larger h3. */}
      <h2 id={titleId} className="flex items-center gap-2 text-body-lg font-semibold text-fg">
        <Trash2 size={18} aria-hidden="true" className="shrink-0 text-danger" />
        {t.title}
      </h2>
      <div id={bodyId} className="mt-2 space-y-2 text-small text-fg-2">
        <p>{t.body}</p>
        <p>{signedIn ? t.scopeAccount : t.scopeDevice}</p>
        <p>{t.kept}</p>
      </div>
      <Button
        ref={buttonRef}
        className="mt-4"
        variant="secondary"
        size="sm"
        leadingIcon={<Trash2 size={14} aria-hidden="true" />}
        aria-describedby={bodyId}
        onClick={() => setConfirmOpen(true)}
      >
        {t.button}
      </Button>
      <p
        role="status"
        className={notice ? `mt-3 text-small ${notice.tone === 'failed' ? 'text-danger' : 'text-success'}` : 'sr-only'}
      >
        {notice?.text ?? ''}
      </p>
      <ConfirmDialog
        open={confirmOpen}
        title={t.dialogTitle}
        body={signedIn ? t.dialogAccount : t.dialogDevice}
        confirmLabel={busy ? t.busy : t.confirm}
        cancelLabel={t.cancel}
        busy={busy}
        onConfirm={() => void run()}
        onClose={() => setConfirmOpen(false)}
        returnFocusRef={buttonRef}
      />
    </section>
  );
};

export default LessonProgressDeleteSection;
