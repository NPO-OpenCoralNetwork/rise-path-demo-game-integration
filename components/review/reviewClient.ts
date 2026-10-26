/**
 * The review queue in the browser (Phase 6, doc/brushup-2026/ai-access-plan.ja.md §10): one
 * memory-only store per page (no storage key) over GET /api/v2/user/review
 * (services/reviewApi.ts), built from the Phase 5 achievements store
 * (components/ui/achievementsClient.ts) with capabilityKey 'review'. Read by the sidebar count
 * (components/common/Layout.tsx), the dashboard card (ReviewTodayCard) and the /review page.
 *
 * - no_account: no synced learner (guests, Nexloom-only, signed out): no request.
 * - unsupported: the sync's GET says the server has no reviews (capabilities.review not true), or
 *   the route answered 404 without error_type (an older server): latched for the page load.
 * - It fetches when a consumer mounts and the data is absent or older than 30 s; after a lesson
 *   save the server took or a server-sourced lesson record (2 s trailing, at least 15 s apart: a
 *   save may finish a lesson or mark a card, and the next read enters it); after each grade (the
 *   same debounce); at once on REVIEW_STALE_EVENT (a one-lesson reset or a delete-all succeeded)
 *   and when a grade answer names another Japan-time day than the list; when the learner or the
 *   capabilities change; on 「読み込み直す」. Never on focus, no timer: the server decides the due
 *   days and the cap, so a list left open past midnight shows yesterday's counts until the next
 *   mount, save or grade.
 * - Grades go out only for the learner the page's session was started for, and only while the
 *   primary session is that learner's (gradeAsSyncedLearner): otherwise 401 session_changed with
 *   no request. A graded card's day is a learning day on the server (written after the answer),
 *   so a 200 also marks the XP/streak store stale (ACHIEVEMENTS_STALE_EVENT, as a Blender stage
 *   save does). A grade answered 404 without error_type (an older server) reads the list again,
 *   which latches 'unsupported'.
 * Nothing goes to browser storage.
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  REVIEW_STALE_EVENT,
  ReviewApiError,
  getReviewQueue,
  gradeReviewCard,
  type GradeResult,
  type ReviewQueue,
  type ReviewRating,
} from '../../services/reviewApi';
import { ACHIEVEMENTS_STALE_EVENT } from '../../services/achievementsApi';
import { createAchievementsStore, type AchievementsSnapshot, type AchievementsStore } from '../ui/achievementsClient';
import { PROGRESS_EVENT, type ProgressEventDetail } from '../lesson/progressStore.ts';
import { PROGRESS_SAVED_EVENT, SYNC_ACCOUNT_EVENT } from '../lesson/progressSync.ts';
import {
  progressCapabilities,
  runAsSyncedLearner,
  subscribeProgressSaveView,
  syncedLearnerId,
} from '../lesson/progressSyncClient';

export type ReviewSnapshot = AchievementsSnapshot<ReviewQueue>;
export type ReviewStore = AchievementsStore<ReviewQueue>;

/** The window events the page's review store follows (exported for tests). */
export function listenForReviewChanges(s: ReviewStore, target: Pick<Window, 'addEventListener'>): void {
  target.addEventListener(PROGRESS_EVENT, (event) => {
    const detail = (event as CustomEvent<ProgressEventDetail | undefined>).detail;
    if (detail?.source === 'server') s.serverProgress();
  });
  target.addEventListener(PROGRESS_SAVED_EVENT, () => s.serverProgress());
  target.addEventListener(REVIEW_STALE_EVENT, () => s.stale());
  target.addEventListener(SYNC_ACCOUNT_EVENT, () => s.syncChanged());
}

export type GradeDeps = {
  /** The learner the sync runs for now (lower case or not), or null. */
  learnerId: () => string | null;
  /** Runs the request only while the primary session is the synced learner's. */
  run: <T>(call: () => Promise<T>) => Promise<T>;
  grade: (args: { courseSlug: string; lessonId: string; cardId: string; rating: ReviewRating }) => Promise<GradeResult>;
};

const canonical = (value: string | null | undefined) => (value ? value.toLowerCase() : null);

/**
 * One grade for `sessionLearnerId` (the learner the page's list belongs to): refused with 401
 * session_changed, before any request, when the sync now runs for another learner (or none);
 * otherwise sent through the synced-learner rule (another primary session also fails with 401
 * session_changed, no session at all with status 0).
 */
export function createGrader(deps: GradeDeps) {
  return async function grade(sessionLearnerId: string, args: { courseSlug: string; lessonId: string; cardId: string; rating: ReviewRating }): Promise<GradeResult> {
    let current: string | null = null;
    try {
      current = canonical(deps.learnerId());
    } catch {
      current = null;
    }
    if (!current || current !== canonical(sessionLearnerId)) {
      throw new ReviewApiError('The signed-in learner changed', 401, 'session_changed');
    }
    return deps.run(() => deps.grade(args));
  };
}

/**
 * After a grade answered by the server (a 200, or a refusal that carried counts): the store
 * refetches with the save debounce, or at once when the answer is for another Japan-time day than
 * the store's list (the day turned while the page was open).
 */
export function noteGradeAnswer(s: ReviewStore, today: string | null | undefined): void {
  const data = s.getSnapshot().data;
  if (today && data && data.today !== today) s.stale();
  else s.serverProgress();
}

// --- The page's store ---------------------------------------------------------------------------

let store: ReviewStore | null = null;

function pageStore(): ReviewStore {
  if (store) return store;
  const created = createAchievementsStore<ReviewQueue>({
    load: () => runAsSyncedLearner(getReviewQueue),
    learnerId: syncedLearnerId,
    capabilities: progressCapabilities,
    capabilityKey: 'review',
  });
  store = created;
  if (typeof window !== 'undefined') {
    listenForReviewChanges(created, window);
    subscribeProgressSaveView(() => created.syncChanged());
  }
  return created;
}

const INITIAL: ReviewSnapshot = Object.freeze({ status: 'idle', learnerId: null, data: null, at: null });
const subscribe = (listener: () => void) => pageStore().subscribe(listener);
const snapshot = () => pageStore().getSnapshot();
const serverSnapshot = () => INITIAL;

/** Today's review list and counts from the server, and how far loading got. */
export function useReviewQueue(): ReviewSnapshot {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => pageStore().consumerMounted(), []);
  return value;
}

/** 「読み込み直す」. */
export function reloadReviewQueue(): Promise<void> {
  return pageStore().reload();
}

/** Something removed review cards on the server: fetch again (at once while a consumer shows them). */
export function markReviewStale(): void {
  pageStore().stale();
}

/** Resolves when no request of the store is running (the page starts its session from a fresh list). */
export function reviewQueueSettled(): Promise<void> {
  return pageStore().settled();
}

const grader = createGrader({ learnerId: syncedLearnerId, run: runAsSyncedLearner, grade: gradeReviewCard });

function dispatchWindowEvent(type: string): void {
  try {
    window.dispatchEvent(new CustomEvent(type));
  } catch {
    // No window or CustomEvent: nothing listens either.
  }
}

/**
 * Grades one card of the page's session (see createGrader), then lets the store catch up
 * (noteGradeAnswer) when the server answered with counts, and marks the XP/streak store stale
 * after a 200 (the grade's day became a learning day). A 404 without error_type reads the list
 * again (the store latches 'unsupported'). Throws what the request threw.
 */
export async function gradeAsSyncedLearner(
  sessionLearnerId: string,
  args: { courseSlug: string; lessonId: string; cardId: string; rating: ReviewRating },
): Promise<GradeResult> {
  try {
    const result = await grader(sessionLearnerId, args);
    noteGradeAnswer(pageStore(), result.summary.today);
    dispatchWindowEvent(ACHIEVEMENTS_STALE_EVENT);
    return result;
  } catch (err) {
    const failure = (err ?? {}) as { status?: unknown; errorType?: unknown; summary?: { today?: string } };
    if (failure.summary) noteGradeAnswer(pageStore(), failure.summary.today);
    else if (failure.status === 404 && failure.errorType == null) pageStore().stale();
    throw err;
  }
}
