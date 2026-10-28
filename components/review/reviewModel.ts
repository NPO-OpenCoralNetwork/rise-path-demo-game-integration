/**
 * Pure helpers for the review screens (Phase 6): what the dashboard card and the page show for a
 * store snapshot, whether grading is possible now, the page's session (one list per visit) and
 * its counter. No React, no DOM, no clock: server/tests import this file through esbuild.
 */
import { reviewMinutes as minutesFor } from '../../shared/review/queue.js';
import type { ReviewCard, ReviewQueue, ReviewRating, ReviewSummary } from '../../services/reviewApi';
import type { AchievementsSnapshot } from '../ui/achievementsClient';
import type { SaveView, SyncState } from '../lesson/progressSync.ts';

/** Minutes for n cards (10 → 3, the 「約 3 分」 of R2). */
export const reviewMinutes = (n: number): number => minutesFor(n);

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * '2026-10-28' → 「10月28日（水）」 (jp) or "Wed, Oct 28" (en). The day is the server's Japan-time
 * day: it is formatted as a calendar date in UTC, never moved by the device's time zone.
 */
export function formatDueDay(day: string, language: 'jp' | 'en'): string {
  const match = DAY.exec(day);
  if (!match) return day;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return day;
  if (language === 'jp') {
    const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'UTC' }).format(date);
    return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekday}）`;
  }
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

export type TodayState = 'loading' | 'no_account' | 'unsupported' | 'unavailable' | 'due' | 'done' | 'none_today' | 'empty';

/**
 * What the dashboard card (and the page outside a session) shows. due: cards left today; done:
 * cards were graded today and none are left; empty: no card in the queue; none_today: cards in the
 * queue, none due today.
 */
export function todayCardOf(snapshot: Pick<AchievementsSnapshot<ReviewQueue>, 'status' | 'data'>): TodayState {
  switch (snapshot.status) {
    case 'no_account':
    case 'unsupported':
    case 'unavailable':
      return snapshot.status;
    case 'ready': {
      const data = snapshot.data;
      if (!data) return 'loading';
      if (data.remainingToday > 0) return 'due';
      if (data.doneToday > 0) return 'done';
      if (data.inQueue === 0) return 'empty';
      return 'none_today';
    }
    default:
      return 'loading';
  }
}

/** Why the two buttons are disabled now, or null when a grade can be sent. */
export type GradeBlock = null | 'offline' | 'auth' | 'loading' | 'later';

/**
 * The rules of LessonEnd's resetControlOf / resetHelpOf, here so the page never imports the
 * reader: offline (no connection, or a stop for the network or the server), auth (sign in
 * again), loading (the first load runs), later (another learner's session, another tab's logout,
 * device storage, the adoption question). A background refresh counts as on.
 */
export function gradeBlockOf({ sync, view, sessionLearnerId }: {
  sync: SyncState;
  view: Pick<SaveView, 'state' | 'reason' | 'online'>;
  sessionLearnerId: string | null;
}): GradeBlock {
  if (view.state === 'offline' || view.online === false || sync.status === 'offline') return 'offline';
  if (sync.userId === null || sync.userId.toLowerCase() !== (sessionLearnerId ?? '').toLowerCase()) return 'later';
  if (sync.status === 'on' || (sync.status === 'hydrating' && view.state !== 'loading' && view.state !== 'local')) return null;
  if (view.state === 'loading' || sync.status === 'hydrating') return 'loading';
  if (sync.status === 'stopped' && (view.reason === 'network' || view.reason === 'server')) return 'offline';
  if (sync.status === 'stopped' && view.reason === 'auth') return 'auth';
  return 'later';
}

// --- The page's session ---------------------------------------------------------------------------

/** The line under the buttons after something happened (each maps to one copy key). */
export type SessionLine =
  | null
  | { kind: 'recorded' }
  | { kind: 'alreadyToday' }
  | { kind: 'notYet' }
  | { kind: 'gone' }
  | { kind: 'rateLimited' }
  | { kind: 'auth' }
  | { kind: 'gradeFailed'; button: ReviewRating };

/**
 * Why a session ended: the list is through (done), today's cap (limit), the learner changed or
 * signed out (switched), or this server has no review routes after all (unsupported: a grade
 * answered 404 without error_type, or the sync's capabilities turned reviews off).
 */
export type SessionEnd = null | 'done' | 'limit' | 'switched' | 'unsupported';

/** The line above the page after a switched end: another learner, or nobody signed in. */
export type SwitchReason = 'other' | 'signedOut';

export type ReviewSession = Readonly<{
  /** The learner the list belongs to (lower case). */
  learnerId: string;
  cards: readonly ReviewCard[];
  /** The card shown (cards.length once the list is through). */
  index: number;
  flipped: boolean;
  /** The answer of the card shown was seen (the buttons show from the first flip on: answer before rating). */
  revealed: boolean;
  /** The button whose grade is being sent, or null. */
  busy: ReviewRating | null;
  /** Cards graded today when the list was taken (a reload after 3 of 10 shows 4 / 10). */
  doneAtStart: number;
  line: SessionLine;
  end: SessionEnd;
  /** The newest counts the server sent (the list's, then each answer's). */
  summary: ReviewSummary;
}>;

export type SkipKind = 'not_due_today' | 'not_due_later' | 'not_in_queue' | 'not_found';

export type SessionAction =
  | { type: 'start'; queue: ReviewQueue }
  | { type: 'flip' }
  | { type: 'gradeStart'; rating: ReviewRating }
  | { type: 'graded'; rating: ReviewRating; summary: ReviewSummary }
  | { type: 'skipped'; kind: SkipKind; summary?: ReviewSummary }
  | { type: 'limit'; summary?: ReviewSummary }
  | { type: 'failed'; kind: 'network' | 'rateLimited' | 'auth'; button: ReviewRating; summary?: ReviewSummary }
  | { type: 'switched'; why?: SwitchReason }
  | { type: 'unsupported' }
  /** The learner asked for today's next cards: the page reads the list again and starts from it. */
  | { type: 'clear' };

const summaryOfQueue = (queue: ReviewQueue): ReviewSummary => ({
  today: queue.today,
  dailyLimit: queue.dailyLimit,
  doneToday: queue.doneToday,
  remainingToday: queue.remainingToday,
  dueTotal: queue.dueTotal,
  carriedOver: queue.carriedOver,
  inQueue: queue.inQueue,
  nextDueOn: queue.nextDueOn,
});

const SKIP_LINES: Record<SkipKind, SessionLine> = {
  not_due_today: { kind: 'alreadyToday' },
  not_due_later: { kind: 'notYet' },
  not_in_queue: { kind: 'gone' },
  not_found: { kind: 'gone' },
};

/** The next card (not counted as graded when skipped); the list's end ends the session. */
function advance(state: ReviewSession, line: SessionLine, summary: ReviewSummary | undefined): ReviewSession {
  const index = Math.min(state.index + 1, state.cards.length);
  return {
    ...state,
    index,
    flipped: false,
    revealed: false,
    busy: null,
    line,
    summary: summary ?? state.summary,
    end: index >= state.cards.length ? 'done' : null,
  };
}

/** Starts a session from a list (null: nothing to review now). */
export function startSession(queue: ReviewQueue): ReviewSession {
  return {
    learnerId: queue.learnerId.toLowerCase(),
    cards: queue.cards,
    index: 0,
    flipped: false,
    revealed: false,
    busy: null,
    doneAtStart: queue.doneToday,
    line: null,
    end: queue.cards.length ? null : 'done',
    summary: summaryOfQueue(queue),
  };
}

export function sessionReducer(state: ReviewSession | null, action: SessionAction): ReviewSession | null {
  if (action.type === 'start') return startSession(action.queue);
  if (action.type === 'clear') return null;
  if (!state) return state;
  if (state.end) return state;
  if (action.type === 'switched') return { ...state, busy: null, end: 'switched' };
  if (action.type === 'unsupported') return { ...state, busy: null, end: 'unsupported' };
  switch (action.type) {
    case 'flip':
      return { ...state, flipped: !state.flipped, revealed: state.revealed || !state.flipped };
    case 'gradeStart':
      return state.busy || !state.revealed ? state : { ...state, busy: action.rating, line: null };
    case 'graded':
      return advance(state, { kind: 'recorded' }, action.summary);
    case 'skipped':
      return advance(state, SKIP_LINES[action.kind], action.summary);
    case 'limit':
      return { ...state, busy: null, flipped: false, end: 'limit', summary: action.summary ?? state.summary };
    case 'failed': {
      const line: SessionLine = action.kind === 'network'
        ? { kind: 'gradeFailed', button: action.button }
        : { kind: action.kind };
      return { ...state, busy: null, line, summary: action.summary ?? state.summary };
    }
    default:
      return state;
  }
}

/** 「今日の {k} / {total} 枚目」: the card's place among today's cards, graded ones included. */
export function counterOf(state: Pick<ReviewSession, 'doneAtStart' | 'index' | 'cards'>): { k: number; total: number } {
  const total = state.doneAtStart + state.cards.length;
  return { k: Math.min(state.doneAtStart + state.index + 1, total), total };
}

/** The card shown, or null once the session ended. */
export function currentCard(state: ReviewSession | null): ReviewCard | null {
  if (!state || state.end) return null;
  return state.cards[state.index] ?? null;
}

/**
 * What a failed grade means for the session: a refusal that moves on (skipped), the end of
 * today's cap, another learner, or a failure that stays on the card. `err` is what
 * gradeAsSyncedLearner threw ({ status, errorType, learnerId?, reviewedToday?, summary? }).
 */
export function gradeFailureAction(err: unknown, rating: ReviewRating, sessionLearnerId: string): SessionAction {
  const failure = (err ?? {}) as { status?: unknown; errorType?: unknown; learnerId?: unknown; reviewedToday?: unknown; summary?: ReviewSummary };
  const summary = failure.summary;
  const otherLearner = typeof failure.learnerId === 'string' && failure.learnerId.toLowerCase() !== sessionLearnerId.toLowerCase();
  if (failure.errorType === 'session_changed' || otherLearner) return { type: 'switched' };
  switch (failure.errorType) {
    case 'not_due':
      return { type: 'skipped', kind: failure.reviewedToday === true ? 'not_due_today' : 'not_due_later', summary };
    case 'not_in_queue':
      return { type: 'skipped', kind: 'not_in_queue', summary };
    case 'not_found':
      return { type: 'skipped', kind: 'not_found', summary };
    case 'review_limit':
      return { type: 'limit', summary };
    case 'rate_limited':
      return { type: 'failed', kind: 'rateLimited', button: rating, summary };
    default:
      break;
  }
  if (failure.status === 401) return { type: 'failed', kind: 'auth', button: rating, summary };
  // An HTML 404 (no error_type): this server has no review routes (a rollback to the Phase 5
  // image). Pressing the button once more cannot help: the session ends.
  if (failure.status === 404 && failure.errorType == null) return { type: 'unsupported' };
  return { type: 'failed', kind: 'network', button: rating, summary };
}

/** A 200: the next card with the new counts, or the end of the session when the server answered for another learner. */
export function gradeSuccessAction(result: { learnerId: string; summary: ReviewSummary }, rating: ReviewRating, sessionLearnerId: string): SessionAction {
  if (result.learnerId.toLowerCase() !== sessionLearnerId.toLowerCase()) return { type: 'switched' };
  return { type: 'graded', rating, summary: result.summary };
}

/** What the page's store shows, as the session effect reads it. */
type StoreView = Pick<AchievementsSnapshot<ReviewQueue>, 'status' | 'learnerId' | 'data'>;

/**
 * The page's session against the store (design §5.3), decided on every store or session change:
 * - a running session whose learner is no longer the store's ends (switched: 'signedOut' when the
 *   store has no account, else 'other'); one on a server whose reviews turned off ends too;
 * - before the visit's own read settled nothing starts (the list comes from a fresh read);
 * - a settled list with cards left today starts a session when there is none (the first list of
 *   the visit, or today's next cards after the learner pressed 「復習する」) or the session is
 *   another learner's; never from `staleList`, the list held when the learner asked for the next
 *   cards (its cards were graded or skipped; a newer read is needed);
 * - otherwise nothing (a list of the same learner never restarts a session by itself).
 */
export function sessionSyncAction({ session, settled, store, staleList = null }: {
  session: ReviewSession | null;
  settled: boolean;
  store: StoreView;
  staleList?: ReviewQueue | null;
}): null | { type: 'switched'; why: SwitchReason } | { type: 'unsupported' } | { type: 'start'; queue: ReviewQueue } {
  if (session && !session.end) {
    if (store.learnerId !== session.learnerId) {
      return { type: 'switched', why: store.status === 'no_account' ? 'signedOut' : 'other' };
    }
    if (store.status === 'unsupported') return { type: 'unsupported' };
  }
  const data = store.status === 'ready' ? store.data : null;
  if (!settled || !data || data.remainingToday === 0 || data === staleList) return null;
  if (!session || session.learnerId !== data.learnerId.toLowerCase()) return { type: 'start', queue: data };
  return null;
}
