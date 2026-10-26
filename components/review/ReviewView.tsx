import React, { useEffect, useReducer, useRef, useState } from 'react';
import { CloudOff, LogIn, PartyPopper, RotateCw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import { Button, ButtonLink } from '../ui/Button';
import { plainText } from '../lesson/model';
import { syncedLearnerId, useProgressSaveView, useProgressSyncState } from '../lesson/progressSyncClient';
import type { ReviewQueue, ReviewRating, ReviewSummary } from '../../services/reviewApi';
import { gradeAsSyncedLearner, reloadReviewQueue, reviewQueueSettled, useReviewQueue } from './reviewClient';
import { reviewCopy } from './reviewCopy';
import { cardText } from './reviewText';
import { ReviewCardView, lineText } from './ReviewCardView';
import {
  counterOf,
  currentCard,
  formatDueDay,
  gradeBlockOf,
  gradeFailureAction,
  gradeSuccessAction,
  reviewMinutes,
  sessionReducer,
  sessionSyncAction,
  todayCardOf,
  type SessionAction,
  type SwitchReason,
  type TodayState,
} from './reviewModel';

/**
 * /review (Phase 6, doc/brushup-2026/ai-access-plan.ja.md §10): today's review cards, one at a
 * time. The list is taken once per visit from a fresh read of the store (later reads change the
 * counts elsewhere, never this list); a reload after 3 of 10 continues at 4 / 10. The card flips
 * (answer before rating); 「もう一度」 / 「覚えた」 send the learner's own button; the server
 * decides due days and the 10-a-day cap, and answers each grade with the new counts. A grade that
 * is refused because the card was already recorded, is not due yet or left the queue moves on
 * with a line saying so; the cap ends the session; a network failure stays on the card and names
 * the button to press once more. Grading is online only: offline, or while the lesson sync is not
 * on for this learner, the buttons are aria-disabled with a helper (the card still flips).
 * Another learner signing in, or a sign-out, ends the session with a line saying which; so does a
 * server without review routes after all. When the list ends while the server still has cards for
 * today (a skipped card used no slot of the cap), 「復習する」 reads the list again and goes on.
 * After each grade focus goes to the next card, or to the done heading; after an end that removed
 * the card, to the status line or the page title (only when focus was lost or on this page). The
 * page scrolls inside <main id="main-content">. No timer, no warm-up.
 */

/** Where focus goes after the page changed what it shows. */
type FocusTarget = 'face' | 'done' | 'status' | 'title';

/** Focus is moved only when it was lost (its element left the page) or is on this page. */
function focusIsOnPage(page: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  return !active || active === document.body || (page !== null && page.contains(active));
}

/** The page outside a session (and the done view), for a store state. Exported for tests. */
export function ReviewStateView({ language, state, summary, offline, onReload, onStart, doneRef }: {
  language: 'jp' | 'en';
  state: TodayState;
  /** The counts (the session's newest, else the store's). */
  summary: Pick<ReviewSummary, 'carriedOver' | 'nextDueOn' | 'remainingToday'> | null;
  offline: boolean;
  onReload: () => void;
  /** due outside a session (after another learner's session ended): start today's list. */
  onStart?: () => void;
  doneRef?: React.Ref<HTMLHeadingElement>;
}) {
  const t = reviewCopy[language];
  const nextLine = summary?.nextDueOn ? t.next(formatDueDay(summary.nextDueOn, language)) : '';
  const due = summary?.remainingToday ?? 0;
  switch (state) {
    case 'due':
      if (onStart && due > 0) {
        return (
          <EmptyState
            headingLevel={2}
            tone="sun"
            icon={<RotateCw size={18} />}
            title={t.card.dueTitle(due, reviewMinutes(due))}
            description={t.card.dueBody}
            action={<Button variant="secondary" onClick={onStart}>{t.card.start}</Button>}
          />
        );
      }
      return <ReviewStateView language={language} state="loading" summary={summary} offline={offline} onReload={onReload} />;
    case 'loading':
      return (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="sr-only">{t.loading}</p>
          <div aria-hidden="true" className="h-6 w-40 rounded-control bg-sunken motion-safe:animate-pulse" />
          <div aria-hidden="true" className="h-40 w-full rounded-card bg-sunken motion-safe:animate-pulse" />
        </div>
      );
    case 'no_account':
      return <EmptyState headingLevel={2} tone="sun" icon={<LogIn size={18} />} title={t.noAccountTitle} description={t.noAccountBody} />;
    case 'unsupported':
      return <EmptyState headingLevel={2} icon={<CloudOff size={18} />} title={t.unsupported} />;
    case 'unavailable':
      return offline
        ? <EmptyState headingLevel={2} icon={<CloudOff size={18} />} title={t.offlineLoad} />
        : (
          <EmptyState
            headingLevel={2}
            icon={<CloudOff size={18} />}
            title={t.loadFailed}
            action={<Button variant="secondary" onClick={onReload}>{t.reload}</Button>}
          />
        );
    case 'empty':
      return <EmptyState headingLevel={2} tone="sun" icon={<RotateCw size={18} />} title={t.emptyTitle} description={t.emptyBody} />;
    case 'none_today':
      return <EmptyState headingLevel={2} tone="sun" icon={<RotateCw size={18} />} title={t.noneToday} description={nextLine || undefined} />;
    case 'done':
    default: {
      const carried = summary && summary.carriedOver > 0 ? t.carried(summary.carriedOver) : '';
      return (
        <section aria-labelledby="rp-review-done" className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-5 shadow-1">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-control bg-sun-soft text-sun-text">
            <PartyPopper size={18} />
          </span>
          <h2 id="rp-review-done" ref={doneRef} tabIndex={-1} className="text-h3 text-fg focus:outline-none">{t.doneTitle}</h2>
          {carried || nextLine ? <p className="text-body text-fg-2">{carried || nextLine}</p> : null}
          <ButtonLink to="/" variant="secondary">{t.toDashboard}</ButtonLink>
        </section>
      );
    }
  }
}

export default function ReviewView() {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const t = reviewCopy[language];
  const snap = useReviewQueue();
  const sync = useProgressSyncState();
  const view = useProgressSaveView();
  const [settled, setSettled] = useState(false);
  const [session, dispatch] = useReducer(sessionReducer, null);
  const [endNote, setEndNote] = useState<SwitchReason | null>(null);
  const [live, setLive] = useState('');
  const pageRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  /** The list held when the learner asked for today's next cards: never started from again. */
  const staleList = useRef<ReviewQueue | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  // The list comes from a read this visit started (or one under 30 s old), not an older one.
  useEffect(() => {
    mounted.current = true;
    void reviewQueueSettled().then(() => {
      if (mounted.current) setSettled(true);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const data = snap.status === 'ready' ? snap.data : null;
  // The session against the store (reviewModel.ts sessionSyncAction).
  useEffect(() => {
    const action = sessionSyncAction({ session, settled, store: snap, staleList: staleList.current });
    if (!action) {
      // Today's next cards were asked for and the fresh read has none: its state view takes focus.
      if (settled && !session && focusNext.current === 'face') focusNext.current = 'done';
      return;
    }
    if (action.type === 'switched') {
      const why = action.why;
      setEndNote((note) => note ?? why);
      focusNext.current = 'status';
    } else if (action.type === 'unsupported') {
      focusNext.current = 'title';
    } else {
      staleList.current = null;
      if (focusNext.current !== 'face') focusNext.current = null;
    }
    dispatch(action);
  }, [settled, snap, session]);

  const offline = view.state === 'offline' || view.online === false;
  const card = currentCard(session);
  const block = session ? gradeBlockOf({ sync, view, sessionLearnerId: session.learnerId }) : null;

  // Focus and scroll after the page changed (inside <main id="main-content">, never the window).
  // A target not on the page yet waits for a later render.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    const el: HTMLElement | null = target === 'face'
      ? faceRef.current
      : target === 'done'
        ? doneRef.current ?? (card ? null : titleRef.current)
        : target === 'status' ? statusRef.current : titleRef.current;
    if (!el) return;
    focusNext.current = null;
    if (!focusIsOnPage(pageRef.current)) return;
    if (target === 'face') {
      el.focus({ preventScroll: true });
      cardRef.current?.scrollIntoView?.({ block: 'nearest' });
    } else {
      el.focus();
    }
  });

  const flip = () => {
    if (!card || !session) return;
    const turning = !session.flipped;
    dispatch({ type: 'flip' });
    setLive(turning ? t.answerLive(plainText(cardText(card.back, language, card.lessonLocale).value)) : '');
  };

  const grade = async (rating: ReviewRating) => {
    if (!session || !card || sending.current || block !== null || !session.revealed) return;
    sending.current = true;
    dispatch({ type: 'gradeStart', rating });
    const learnerId = session.learnerId;
    let action: SessionAction;
    try {
      const result = await gradeAsSyncedLearner(learnerId, {
        courseSlug: card.courseSlug,
        lessonId: card.lessonId,
        cardId: card.cardId,
        rating,
      });
      action = gradeSuccessAction(result, rating, learnerId);
    } catch (err) {
      action = gradeFailureAction(err, rating, learnerId);
    } finally {
      sending.current = false;
    }
    if (!mounted.current) return;
    if (action.type === 'graded' || action.type === 'skipped') {
      focusNext.current = session.index + 1 < session.cards.length ? 'face' : 'done';
      setLive('');
    } else if (action.type === 'limit') {
      focusNext.current = 'done';
      setLive('');
    } else if (action.type === 'switched') {
      const why: SwitchReason = syncedLearnerId() ? 'other' : 'signedOut';
      setEndNote((note) => note ?? why);
      focusNext.current = 'status';
    } else if (action.type === 'unsupported') {
      focusNext.current = 'title';
    }
    dispatch(action);
  };

  /** 「復習する」 after an end: read today's list again, then start from that read (never the list held now). */
  const restartToday = () => {
    staleList.current = data;
    focusNext.current = 'face';
    setEndNote(null);
    setLive('');
    setSettled(false);
    dispatch({ type: 'clear' });
    void reloadReviewQueue()
      .catch(() => undefined)
      .then(() => reviewQueueSettled())
      .then(() => {
        if (mounted.current) setSettled(true);
      });
  };

  let body: React.ReactNode;
  if (session && card && !session.end) {
    body = (
      <div ref={cardRef}>
        <ReviewCardView
          language={language}
          card={card}
          counter={counterOf(session)}
          flipped={session.flipped}
          revealed={session.revealed}
          busy={session.busy}
          block={block}
          line={session.line}
          live={live}
          onFlip={flip}
          onGrade={(rating) => void grade(rating)}
          faceRef={faceRef}
        />
      </div>
    );
  } else if (session && (session.end === 'done' || session.end === 'limit')) {
    // The list is through, yet the server's newest counts still have cards for today (a skipped
    // card used no slot): offer them (a fresh read first), or say they load once online.
    const more = session.end === 'done' && session.summary.remainingToday > 0;
    const state: TodayState = more ? (offline ? 'unavailable' : 'due') : 'done';
    body = (
      <>
        {session.line && session.line.kind !== 'recorded' ? (
          <p className="text-small text-fg-2">{lineText(session.line, language)}</p>
        ) : null}
        <ReviewStateView
          language={language}
          state={state}
          summary={session.summary}
          offline={offline}
          onReload={() => void reloadReviewQueue()}
          onStart={more ? restartToday : undefined}
          doneRef={doneRef}
        />
      </>
    );
  } else if (session && session.end === 'unsupported') {
    body = <ReviewStateView language={language} state="unsupported" summary={null} offline={offline} onReload={() => void reloadReviewQueue()} />;
  } else {
    // Before the first list: 'due' waits (loading) for the read this visit started. After
    // another learner's session ended here, or when a fresh read for today's next cards failed:
    // the store's state, with a way to (try to) start its list.
    const canStart = data !== null && ((session?.end === 'switched') || (!session && settled && data === staleList.current));
    body = (
      <ReviewStateView
        language={language}
        state={todayCardOf(snap)}
        summary={data}
        offline={offline}
        onReload={() => void reloadReviewQueue()}
        onStart={canStart ? restartToday : undefined}
        doneRef={doneRef}
      />
    );
  }

  return (
    <div ref={pageRef} className="mx-auto flex max-w-2xl flex-col gap-6 py-6 sm:py-8">
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} titleRef={titleRef} />
      <div ref={statusRef} role="status" tabIndex={-1} className="focus:outline-none">
        {endNote ? <p className="rounded-control border border-line bg-sunken px-3 py-2 text-small text-fg-2">{endNote === 'signedOut' ? t.signedOut : t.switched}</p> : null}
      </div>
      {body}
    </div>
  );
}
