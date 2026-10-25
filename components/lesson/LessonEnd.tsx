import React, { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Flag, Layers, ListChecks, PartyPopper, RotateCcw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ConfirmDialog } from '../safety/ConfirmDialog';
import { useReader } from './ReaderContext';
import { MdText } from './Md';
import { allBlocks, isAnswered, isQuiz } from './model';
import type { SelfRating } from './progressStore';
import { hasActivity, type LessonResetResult, type SaveView, type SyncState } from './progressSync.ts';
import { isSyncableLesson, progressCapabilities, useProgressSaveView, useProgressSyncState } from './progressSyncClient';
import type { LText } from '../../shared/lesson/schema.js';

/**
 * End of every lesson, rendered by the reader (not authored): self-assessment against each
 * objective, what was practised, and the next lesson. The authored summary block stays in its
 * own section above.
 *
 * Phase 5:
 * - The line after rating says where the record went, chosen at the moment of rating (and once
 *   at mount when ratings exist) and never changed by later save-state changes, so an
 *   offline/online flip announces nothing (finding 11): 「記録しました。…」 when the lesson syncs and
 *   saving works, 「この端末に記録しました。…」 otherwise.
 * - 「このレッスンを最初からやり直す」 (design §2.6): only where the reader allows it (LearnRoute
 *   in learn mode), for a lesson the server stores, a synced learner, a server that offers it and
 *   a record with something in it. While sync is not on it is shown aria-disabled with a helper
 *   line that says why (resetHelpOf). A confirm dialog (Cancel first, Esc closes); on success
 *   the reader is told (onLessonReset: status line, scroll to the top, focus on the title) once
 *   the dialog has closed, also when it closed before the request ended; on failure focus
 *   returns to the button (or #main-content when the button has gone) and the line under it
 *   says why.
 */

const copy = {
  en: {
    title: 'Wrap-up',
    ask: 'How confident are you with each goal?',
    askLesson: 'How well could you explain this lesson to someone?',
    lessonGoal: 'This lesson',
    ratings: { 1: 'Not sure yet', 2: 'Mostly OK', 3: 'I can explain it' } as Record<SelfRating, string>,
    saved: 'Saved. Come back to the parts marked "not sure yet" later.',
    savedDevice: 'Saved on this device. Come back to the parts marked "not sure yet" later.',
    progress: (pct: number) => `${pct}% done`,
    checks: (n: number, m: number) => `Checks answered: ${n}/${m}`,
    cards: (n: number, m: number) => `Review cards known: ${n}/${m}`,
    goToCards: 'Go to the review cards',
    next: 'Next lesson',
    minutes: (min: number) => `${min} min`,
    continue: 'Continue',
    prev: 'Previous lesson: ',
    doneTitle: 'You finished the last lesson of this course.',
    backToCourse: 'Back to the course',
    reset: 'Start this lesson over',
    resetTitle: 'Start this lesson over?',
    resetBody: 'This deletes what you read in this lesson, your quiz answers, checks, self-ratings and where to continue. It is deleted on every device where you are signed in, and cannot be undone.',
    resetKept: 'Your XP, badges, learning days and history stay. XP you already earned for this lesson is not given again. What AI apps already received is not deleted.',
    resetConfirm: 'Start over',
    resetBusy: 'Deleting…',
    resetCancel: 'Cancel',
    notReadyHelp: {
      offline: 'You can start over once you are connected to the server again.',
      auth: 'You can start over after you sign in again.',
      loading: 'You can start over once loading has finished.',
      later: "You can't start over right now.",
    } as Record<ResetHelp, string>,
    failures: {
      unsupported: "Starting over isn't available right now. Please try again later.",
      not_published: "This lesson can't be started over.",
      rate_limited: 'Too many changes in a row. Please wait a moment and try again.',
      failed: "We couldn't start this lesson over, so nothing was changed. Please try again later.",
      unconfirmed: "The connection dropped, so we couldn't confirm it. Open this page again once you're connected.",
      reloaded: 'Your progress was deleted on another device, so it was loaded again.',
      not_ready: 'You can start over once you are connected to the server again.',
    } as Record<ResetFailure, string>,
  },
  jp: {
    title: 'ふりかえり',
    ask: 'それぞれの目標、どのくらい自信がありますか？',
    askLesson: 'このレッスンの内容を、人に説明できそうですか？',
    lessonGoal: 'このレッスン',
    ratings: { 1: 'まだ不安', 2: 'だいたいOK', 3: '説明できる' } as Record<SelfRating, string>,
    saved: '記録しました。「まだ不安」の目標は、あとで読み返しましょう。',
    savedDevice: 'この端末に記録しました。「まだ不安」の目標は、あとで読み返しましょう。',
    progress: (pct: number) => `${pct}% 完了`,
    checks: (n: number, m: number) => `確認問題 ${n}/${m} 回答`,
    cards: (n: number, m: number) => `復習カード 覚えた ${n}/${m}`,
    goToCards: '復習カードへ移動',
    next: '次のレッスン',
    minutes: (min: number) => `${min}分`,
    continue: '続ける',
    prev: '前のレッスン：',
    doneTitle: 'このコースの最後のレッスンまで読み終えました。',
    backToCourse: 'コースに戻る',
    reset: 'このレッスンを最初からやり直す',
    resetTitle: 'このレッスンを最初からやり直しますか？',
    resetBody: 'このレッスンで読んだところ、確認問題の答え、チェック、自己評価、続きの位置を消します。ログインしているすべての端末から消え、元に戻すことはできません。',
    resetKept: 'もらった XP とバッジ、学んだ日、学習の履歴は残ります。すでにもらった XP は、このレッスンでもう一度もらうことはありません。AI アプリにすでに渡した内容は消えません。',
    resetConfirm: 'やり直す',
    resetBusy: '消しています…',
    resetCancel: 'やめる',
    notReadyHelp: {
      offline: 'いまはサーバーとつながっていないため、やり直せません。つながってから、もう一度お試しください。',
      auth: 'ログインし直すと、やり直せます。',
      loading: '読み込みが終わると、やり直せます。',
      later: 'いまはやり直せません。',
    } as Record<ResetHelp, string>,
    failures: {
      unsupported: 'いまはやり直せません。しばらくしてから、もう一度お試しください。',
      not_published: 'このレッスンは、やり直しの対象ではありません。',
      rate_limited: '操作が続いたため、少し待ってからもう一度お試しください。',
      failed: 'やり直すことができなかったため、何も変更していません。しばらくしてから、もう一度お試しください。',
      unconfirmed: '通信が切れたため、やり直せたか確かめられませんでした。つながったら、このページを開き直してください。',
      reloaded: '学習の進み具合がほかの端末で消されていたため、読み込み直しました。',
      not_ready: 'いまはサーバーとつながっていないため、やり直せません。つながってから、もう一度お試しください。',
    } as Record<ResetFailure, string>,
  },
} as const;

type ResetFailure = Extract<LessonResetResult, { ok: false }>['reason'];

/**
 * Why the reset control is disabled, for its helper line (from the save view). offline: no
 * connection (the browser is offline, also with nothing pending, or a stop for the network or
 * the server); auth: the sign-in has to be renewed; loading: the first load runs; later: anything
 * else (another tab's logout or learner, device storage, the adoption question). Pure (tests).
 */
export type ResetHelp = 'offline' | 'auth' | 'loading' | 'later';
export function resetHelpOf(view: Pick<SaveView, 'state' | 'reason' | 'online'>): ResetHelp {
  if (view.state === 'offline' || view.online === false) return 'offline';
  if (view.state === 'loading') return 'loading';
  if (view.state === 'stopped') {
    if (view.reason === 'network' || view.reason === 'server') return 'offline';
    if (view.reason === 'auth') return 'auth';
  }
  return 'later';
}

/** Where a rating went, from the save view at the moment of rating (finding 11). */
export type SavedWhere = 'account' | 'device';
export function savedWhereOf(view: Pick<SaveView, 'state'>, syncs: boolean): SavedWhere {
  return syncs && (view.state === 'saved' || view.state === 'saving' || view.state === 'loading') ? 'account' : 'device';
}

/**
 * The reset control (design §2.6): hidden, disabled (sync not on, or the browser offline: the
 * status stays 'on' when only uploads fail) or enabled. Pure (tests).
 * A background refresh (status hydrating, the save view not 'loading') counts as on.
 */
export function resetControlOf({ resettable, sync, view, offered, active }: {
  resettable: boolean;
  sync: SyncState;
  view: Pick<SaveView, 'state' | 'online'>;
  offered: boolean;
  active: boolean;
}): 'hidden' | 'disabled' | 'enabled' {
  if (!resettable || sync.userId === null || !offered || !active) return 'hidden';
  if (view.state === 'offline' || view.online === false) return 'disabled';
  const ready = sync.status === 'on' || (sync.status === 'hydrating' && view.state !== 'loading' && view.state !== 'local');
  return ready ? 'enabled' : 'disabled';
}

export type LessonLinkInfo = { title: string; href: string; minutes?: number; lang?: string };

type LessonEndProps = {
  next: LessonLinkInfo | null;
  prev: LessonLinkInfo | null;
  backTo: string;
  /** Phase 5: the reader allows starting this lesson over (LearnRoute in learn mode, a lesson the server stores). */
  resettable?: boolean;
  /** Phase 5: the lesson was started over (called once the dialog has closed). */
  onLessonReset?: () => void;
};

function RatingRow({ id, label, value, onChange }: {
  id: string;
  label: LText | string;
  value: SelfRating | undefined;
  onChange: (rating: SelfRating) => void;
}) {
  const { language } = useLanguage();
  const text = copy[language];
  const uid = useId();
  const labelId = `${uid}-label`;
  return (
    <li className="rp-rate-row">
      <div id={labelId} className="rp-rate-goal">
        {typeof label === 'string' ? label : <MdText value={label} inline />}
      </div>
      <div className="rp-rate-options" role="radiogroup" aria-labelledby={labelId}>
        {([1, 2, 3] as SelfRating[]).map((rating) => {
          const inputId = `${uid}-${rating}`;
          return (
            <label key={rating} htmlFor={inputId} className="rp-rate" data-checked={value === rating || undefined} data-rating={rating}>
              <input
                id={inputId}
                type="radio"
                name={`${uid}-${id}`}
                className="sr-only"
                checked={value === rating}
                onChange={() => onChange(rating)}
              />
              {text.ratings[rating]}
            </label>
          );
        })}
      </div>
    </li>
  );
}

export function LessonEnd({ next, prev, backTo, resettable = false, onLessonReset }: LessonEndProps) {
  const { language } = useLanguage();
  const { lesson, courseSlug, progress, scrollToBlock } = useReader();
  const text = copy[language];
  const titleId = `${lesson.id}-end-title`;
  const ratings = progress.progress.ratings ?? {};
  const rated = Object.keys(ratings).length > 0;
  const sync = useProgressSyncState();
  const view = useProgressSaveView();
  const syncs = isSyncableLesson(courseSlug, lesson.id);
  // Fixed at the moment of rating (and at mount when ratings exist), never by later changes.
  const [savedWhere, setSavedWhere] = useState<SavedWhere | null>(() => (rated ? savedWhereOf(view, syncs) : null));
  const rate = (objectiveId: string, rating: SelfRating) => {
    setSavedWhere(savedWhereOf(view, syncs));
    progress.setRating(objectiveId, rating);
  };

  const control = resetControlOf({
    resettable,
    sync,
    view,
    offered: progressCapabilities()?.lessonReset === true,
    active: hasActivity(progress.progress),
  });
  const helperId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ResetFailure | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  // Where the dialog returns focus: the button; nothing after a success (the reader moves it).
  const returnRef = useRef<HTMLElement | null>(null);
  // The request succeeded while the dialog was open: the reader is told when it has closed.
  const succeeded = useRef(false);
  // Mirrors the dialog: open from the button's click until its close event (which can come
  // before the request ends: Chromium closes it on a repeated Esc even while busy).
  const dialogOpen = useRef(false);

  const runReset = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    let result: LessonResetResult;
    try {
      result = await progress.resetLesson();
    } catch {
      result = { ok: false, reason: 'failed' };
    }
    setBusy(false);
    if ('reason' in result) {
      setFailure(result.reason);
    } else if (dialogOpen.current) {
      succeeded.current = true;
      returnRef.current = null;
    } else {
      // The dialog closed already: no close event will come, so the reader is told now.
      returnRef.current = null;
      onLessonReset?.();
    }
    setConfirmOpen(false);
  };

  const blocks = allBlocks(lesson);
  const questions = blocks.filter(isQuiz).filter((b) => b.mode !== 'predict')
    .flatMap((b) => b.questions.map((q) => ({ block: b, question: q })));
  const answered = questions.filter(({ block, question }) => isAnswered(progress.progress, block.id, question.id)).length;
  const cardBlocks = blocks.filter((b): b is Extract<typeof b, { type: 'flashcards' }> => b.type === 'flashcards');
  const cards = cardBlocks.flatMap((b) => b.cards.map((c) => `card:${b.id}/${c.id}`));
  const known = cards.filter((key) => progress.getCheck(key) === true).length;

  return (
    <footer className="rp-end">
      <div role="group" className="rp-end-card" aria-labelledby={titleId}>
        <h2 id={titleId} className="rp-end-title">
          <Flag size={18} aria-hidden="true" />
          {text.title}
        </h2>
        <p className="rp-end-ask">{lesson.objectives.length ? text.ask : text.askLesson}</p>
        <ul className="rp-rate-list">
          {lesson.objectives.length > 0
            ? lesson.objectives.map((objective) => (
              <RatingRow
                key={objective.id}
                id={objective.id}
                label={objective.text}
                value={ratings[objective.id]}
                onChange={(rating) => rate(objective.id, rating)}
              />
            ))
            : (
              <RatingRow
                id="lesson"
                label={text.lessonGoal}
                value={ratings.lesson}
                onChange={(rating) => rate('lesson', rating)}
              />
            )}
        </ul>
        <p role="status" aria-live="polite" className="rp-end-saved">
          {rated && savedWhere ? (savedWhere === 'account' ? text.saved : text.savedDevice) : ''}
        </p>
        <ul className="rp-end-stats">
          <li className="tabular">{text.progress(progress.pct)}</li>
          {questions.length > 0 && (
            <li className="tabular"><ListChecks size={14} aria-hidden="true" />{text.checks(answered, questions.length)}</li>
          )}
          {cards.length > 0 && (
            <li>
              <button type="button" className="rp-link-btn tabular" onClick={() => scrollToBlock(cardBlocks[0].id)}>
                <Layers size={14} aria-hidden="true" />{text.cards(known, cards.length)}
                <span className="sr-only"> · {text.goToCards}</span>
              </button>
            </li>
          )}
        </ul>
        {control !== 'hidden' ? (
          <div className="rp-end-reset">
            <button
              ref={resetButtonRef}
              type="button"
              className="rp-link-btn rp-reset-btn"
              aria-disabled={control === 'disabled' || undefined}
              aria-describedby={control === 'disabled' ? helperId : undefined}
              onClick={() => {
                if (control !== 'enabled') return;
                setFailure(null);
                succeeded.current = false;
                dialogOpen.current = true;
                returnRef.current = resetButtonRef.current;
                setConfirmOpen(true);
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              {text.reset}
            </button>
            {control === 'disabled' ? <p id={helperId} className="rp-end-reset-help">{text.notReadyHelp[resetHelpOf(view)]}</p> : null}
          </div>
        ) : null}
        <p role="status" aria-live="polite" className="rp-end-reset-status">{failure ? text.failures[failure] : ''}</p>
      </div>
      {/* Always mounted: the reset empties the record (the button goes) while the dialog is open. */}
      <ConfirmDialog
        open={confirmOpen}
        title={text.resetTitle}
        body={(
          <>
            <p>{text.resetBody}</p>
            <p className="mt-2">{text.resetKept}</p>
          </>
        )}
        confirmLabel={busy ? text.resetBusy : text.resetConfirm}
        cancelLabel={text.resetCancel}
        busy={busy}
        confirmTone="danger"
        onConfirm={() => void runReset()}
        onClose={() => {
          dialogOpen.current = false;
          setConfirmOpen(false);
          if (succeeded.current) {
            succeeded.current = false;
            onLessonReset?.();
          } else if (!returnRef.current?.isConnected) {
            // The button went (another device deleted the progress): focus the page's main area.
            document.getElementById('main-content')?.focus({ preventScroll: true });
          }
        }}
        returnFocusRef={returnRef}
      />

      {next ? (
        <Link to={next.href} className="rp-next-card">
          <span className="min-w-0 flex-1">
            <span className="rp-next-label">
              {text.next}
              {next.minutes ? <span className="tabular"> · {text.minutes(next.minutes)}</span> : null}
            </span>
            <span className="rp-next-title" lang={next.lang}>{next.title}</span>
          </span>
          <span className="rp-next-go" aria-hidden="true">
            {text.continue}
            <ArrowRight size={16} />
          </span>
        </Link>
      ) : (
        <Link to={backTo} className="rp-next-card">
          <PartyPopper size={22} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="rp-next-title">{text.doneTitle}</span>
          </span>
          <span className="rp-next-go" aria-hidden="true">
            {text.backToCourse}
            <ArrowRight size={16} />
          </span>
        </Link>
      )}

      {prev && (
        <Link to={prev.href} className="rp-prev-link">
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="shrink-0">{text.prev}</span>
          <span lang={prev.lang} className="min-w-0 truncate">{prev.title}</span>
        </Link>
      )}
    </footer>
  );
}
