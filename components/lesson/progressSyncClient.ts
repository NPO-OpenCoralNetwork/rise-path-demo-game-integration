/**
 * Lesson progress sync in the browser (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6): binds
 * the pure core (progressSync.ts) to localStorage, window events, the bundled course outline
 * (content/index.ts) and the API (services/lessonProgressApi.ts). One instance per page.
 *
 * - context/AuthContext.tsx calls signInProgressSync for the primary Supabase session only
 *   (before setUser, with its access token), stopProgressSync when that session ends elsewhere,
 *   and signOutProgressSync at logout.
 * - Every progressStore.writeProgress (PROGRESS_EVENT without source 'server') of a syncable
 *   lesson marks it pending; page hide flushes; the tab becoming visible or focused again
 *   refreshes (at most once a minute).
 * - ProgressAdoptDialog shows the adoption choice (useProgressSyncState, chooseProgressAdoption);
 *   a choice made in another tab closes it here (storage event on the account key).
 * - The Privacy page calls deleteLessonProgress.
 * - Account deletion (Phase 4, design §5.11): AuthContext.endDeletedAccountSession calls
 *   forgetProgressAccount (no upload); whenAccountKnown holds the legacy progress hydrate until
 *   this page load's GET has settled (§5.10).
 * - Every request goes out only while the primary session still belongs to the learner the sync
 *   runs for: another tab can switch that session to another learner before this tab hears of it.
 *   The page-hide upload is the exception: fetch must start inside the pagehide/visibilitychange
 *   handler, and getSession waits for a lock (a later task, after the page is gone). It sends the
 *   token of this learner's last session event instead (cachedAuth); it is this learner's own
 *   token, so the upload can only reach their own account.
 * - Phase 5: the save state (useProgressSaveView, SaveChip and the notices), online/offline and
 *   other tabs' pending markers feed it; retryProgressSync (the notice's button);
 *   prepareProgressSignOut (logoutGuard.ts: upload, then count what is unsaved, before logout asks);
 *   resetLessonProgress (LessonEnd's 「このレッスンを最初からやり直す」); progressCapabilities (what
 *   the server offers); syncedLearnerId and runAsSyncedLearner (XP, legacy progress: only the
 *   learner the sync runs for); PROGRESS_SAVED_EVENT when the server took records (the XP store
 *   refetches: the save's hook may have awarded XP).
 * - Phase 6: the review capability (progressCapabilities().review), and REVIEW_STALE_EVENT after a
 *   one-lesson reset (done, unconfirmed or reloaded) or a delete-all of the account's records
 *   succeeded (the server removed review cards; components/review/reviewClient.ts reads again).
 */
import { useSyncExternalStore } from 'react';
import { getCourse, getLessonEntry } from '../../content';
import { resolveText } from '../../shared/lesson/text.js';
import { isApiAvailable } from '../../services/apiClient';
import { hydrateFromApi, setProgressTabLearner } from '../../services/progressService';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  LessonProgressApiError,
  deleteLessonProgressRecords,
  getLessonProgressRecords,
  putLessonProgressRecords,
  resetLessonProgressRecord,
} from '../../services/lessonProgressApi';
import { REVIEW_STALE_EVENT } from '../../services/reviewApi';
import { PROGRESS_EVENT, type ProgressEventDetail } from './progressStore.ts';
import {
  PROGRESS_SAVED_EVENT,
  SYNC_ACCOUNT_EVENT,
  SYNC_ACCOUNT_KEY,
  SYNC_PENDING_PREFIX,
  createProgressSync,
  isSafeSlug,
  type DeleteResult,
  type LessonResetResult,
  type ProgressSync,
  type SaveView,
  type SyncCapabilities,
  type SyncState,
  type SyncStorage,
} from './progressSync.ts';

const LANGUAGE_STORAGE_KEY = 'risepath:language';

function localStorageOrNull(): SyncStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** A lesson the server stores: listed in the bundled course outline, ids within the one id rule. */
function isSyncable(courseSlug: string, lessonId: string): boolean {
  if (!isSafeSlug(courseSlug) || !isSafeSlug(lessonId)) return false;
  const course = getCourse(courseSlug);
  return Boolean(course && getLessonEntry(course, lessonId));
}

/** Phase 5: the reader shows the save chip and the reset control only for these lessons. */
export const isSyncableLesson = isSyncable;

/** The lesson title in the UI language (LanguageContext's stored choice; fr reads en). */
function lessonTitle(courseSlug: string, lessonId: string): string {
  const course = getCourse(courseSlug);
  const entry = course ? getLessonEntry(course, lessonId) : undefined;
  if (!course || !entry) return '';
  let language: 'jp' | 'en' = 'en';
  try {
    language = window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'jp' ? 'jp' : 'en';
  } catch {
    // Storage blocked: English, LanguageContext's default.
  }
  return resolveText(entry.ref.title, language, course.locale ?? 'jp').value;
}

function dispatch(type: string, detail?: unknown): void {
  try {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  } catch {
    // No window or CustomEvent: nothing listens either.
  }
}

let instance: ProgressSync | null = null;
/** The primary session's learner and access token from its last event (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED). */
let cachedAuth: { userId: string; token: string } | null = null;

/**
 * Runs `call` only when the primary session (the token apiFetch sends) still belongs to the
 * learner the sync runs for. Another learner's session fails like a 401: sync stops until that
 * tab's sign-in of the other learner reaches this one (which clears this learner's records
 * first). No session at all fails like a network error (status 0, retried): auth-js returns none
 * while a token refresh fails on a flaky network, and keeps the session; a real sign-out stops
 * the sync through stopProgressSync.
 */
async function asSyncedLearner<T>(call: () => Promise<T>): Promise<T> {
  const expected = instance?.getState().userId ?? null;
  let current: string | null = null;
  try {
    const result = await getSupabaseClient()?.auth.getSession();
    current = result?.data.session?.user?.id ?? null;
  } catch {
    current = null;
  }
  if (!expected || (current !== null && current !== expected)) {
    throw new LessonProgressApiError('The signed-in learner changed', 401, 'session_changed');
  }
  if (current === null) throw new LessonProgressApiError('No session right now', 0, 'no_session');
  return call();
}

/**
 * Page hide: the PUT with this learner's cached token, fetch started before the first await.
 * Every other request goes through asSyncedLearner.
 */
function putProgress(body: Parameters<typeof putLessonProgressRecords>[0], keepalive: boolean) {
  const auth = cachedAuth;
  if (keepalive && auth && auth.userId === instance?.getState().userId) {
    return putLessonProgressRecords(body, { keepalive: true, token: auth.token });
  }
  return asSyncedLearner(() => putLessonProgressRecords(body, { keepalive }));
}

function progressSync(): ProgressSync {
  if (instance) return instance;
  const sync = createProgressSync({
    storage: localStorageOrNull(),
    api: {
      get: () => asSyncedLearner(getLessonProgressRecords),
      put: (body, { keepalive }) => putProgress(body, keepalive),
      del: () => asSyncedLearner(deleteLessonProgressRecords),
      resetLesson: (body) => asSyncedLearner(() => resetLessonProgressRecord(body)),
    },
    apiEnabled: isApiAvailable,
    isSyncable,
    lessonTitle,
    events: {
      progress: (detail) => dispatch(PROGRESS_EVENT, detail),
      account: () => dispatch(SYNC_ACCOUNT_EVENT),
      saved: () => dispatch(PROGRESS_SAVED_EVENT),
    },
  });
  instance = sync;
  if (typeof window !== 'undefined') {
    window.addEventListener(PROGRESS_EVENT, (event) => {
      const detail = (event as CustomEvent<ProgressEventDetail | undefined>).detail;
      if (!detail || detail.source === 'server') return;
      sync.noteLocalWrite(detail.courseSlug, detail.lessonId);
    });
    window.addEventListener('storage', (event) => {
      if (event.key === SYNC_ACCOUNT_KEY || event.key === null) sync.accountChanged();
      // Phase 5: another tab's markers (or its logout) change what is still unsaved here.
      if (event.key === null || event.key === SYNC_ACCOUNT_KEY || event.key.startsWith(SYNC_PENDING_PREFIX)) sync.storageChanged();
    });
    // Phase 5: back online → one retry (with jitter). The value at creation is set without one.
    const onLine = () => (typeof navigator === 'undefined' || navigator.onLine !== false);
    sync.networkChanged(onLine());
    window.addEventListener('online', () => sync.networkChanged(onLine()));
    window.addEventListener('offline', () => sync.networkChanged(onLine()));
    window.addEventListener('pagehide', () => sync.flushOnHide());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sync.flushOnHide();
      else if (document.visibilityState === 'visible') sync.refresh();
    });
    // Back from another window (an AI app beside the browser): the page stayed visible.
    window.addEventListener('focus', () => sync.refresh());
  }
  return sync;
}

/**
 * The primary Supabase session's user (synchronous owner rule, then one hydrate per page load)
 * and its access token, kept for the page-hide upload.
 */
export function signInProgressSync(userId: string, accessToken?: string): void {
  cachedAuth = accessToken ? { userId, token: accessToken } : null;
  try {
    progressSync().signIn(userId);
  } catch (err) {
    console.warn('[progressSync] sign-in failed:', err);
  }
}

/** The primary session ended without this tab's logout (an expiry, or another tab signed out). */
export function stopProgressSync(): void {
  cachedAuth = null;
  try {
    progressSync().stop();
  } catch (err) {
    console.warn('[progressSync] stop failed:', err);
  }
}

/** Logout: upload what is pending (≤ 3 s), then clear this learner's lesson data. Never throws. */
export async function signOutProgressSync(): Promise<void> {
  cachedAuth = null;
  if (!instance) return;
  try {
    await instance.signOut();
  } catch (err) {
    console.warn('[progressSync] sign-out failed:', err);
  }
}

/**
 * The legacy progress and learning events (services/progressService.ts hydrateFromApi) wait for
 * the adoption choice: that hydrate uploads the device's legacy progress into the account, and
 * while the choice is open the device's data may be someone else's (AuthContext hydrateUserData).
 */
export function progressChoicePending(): boolean {
  return instance?.getState().status === 'needs_choice';
}

/**
 * Resolves when this page load's lesson-progress GET has settled: 'known' after a successful GET
 * (a re-opened account's old epoch rule has run, design §5.10), 'unknown' after its last failure
 * or when sync does not run for this learner (guests, mock and Nexloom-only sessions). No timer:
 * the GET retries are bounded. The legacy hydrate uploads local-only course progress only when
 * 'known' (AuthContext hydrateUserData, chooseProgressAdoption).
 */
export function whenAccountKnown(): Promise<'known' | 'unknown'> {
  return instance ? instance.whenKnown() : Promise.resolve('unknown');
}

/**
 * The account was deleted (here or on another device): stop syncing and clear this browser's
 * lesson records, markers, the account key, learning events and legacy progress. Nothing is
 * uploaded (an upload would only get 401 account_deleted). Never throws.
 */
export function forgetProgressAccount(): void {
  cachedAuth = null;
  try {
    progressSync().forget();
  } catch (err) {
    console.warn('[progressSync] forget failed:', err);
  }
}

/**
 * After the choice, the legacy hydrate runs: "Add" sends the device's legacy progress with the
 * rest; "Don't add" has cleared it and the learning events (the other person's streak and
 * history), so the learner's own come back from the server. hydrateFromApi sends no event: the
 * account event makes the streak and course maps read them again.
 */
export function chooseProgressAdoption(add: boolean): void {
  const applied = instance?.choose(add) ?? false;
  // "Add" also adopts the device's unowned legacy progress (Phase 5: it is then this learner's).
  if (applied) void whenAccountKnown().then((s) => hydrateFromApi({ pushLocal: s === 'known', learnerId: syncedLearnerId(), adoptUnowned: add })).then(() => dispatch(SYNC_ACCOUNT_EVENT));
}

/**
 * The Privacy page's delete: the account's records on the server (then here), or this device's.
 * Phase 6: the server's delete also removed every review card; the review store reads again.
 */
export async function deleteLessonProgress(): Promise<DeleteResult> {
  const result = await progressSync().deleteAll();
  if (result.ok && result.scope === 'account') dispatch(REVIEW_STALE_EVENT);
  return result;
}

const OFF: SyncState = { status: 'off', userId: null };

const subscribe = (listener: () => void) => progressSync().subscribe(listener);
const snapshot = () => instance?.getState() ?? OFF;

export function useProgressSyncState(): SyncState {
  return useSyncExternalStore(subscribe, snapshot, () => OFF);
}

// --- Phase 5 ------------------------------------------------------------------------------------

/** The learner the sync runs for (a primary session's), or null (guests, mock, Nexloom-only, signed out). */
export function syncedLearnerId(): string | null {
  return instance?.getState().userId ?? null;
}

// Legacy Blender progress writes only for this tab's own primary learner (progressService.ts
// ownerForWrite), not the learner AuthContext shows (it can be a Nexloom session beside it).
setProgressTabLearner(syncedLearnerId);

/**
 * Runs `call` only while the primary session is the synced learner's (the lesson-progress rule):
 * otherwise it fails with LessonProgressApiError (401 session_changed, or 0 no_session).
 */
export const runAsSyncedLearner = asSyncedLearner;

/** What the server offers, from this learner's last successful GET on this page; null before. */
export function progressCapabilities(): SyncCapabilities | null {
  return instance?.capabilities() ?? null;
}

/** The view shown before the sync exists, and on the server (no learner: this device only). */
const LOCAL_VIEW: SaveView = Object.freeze({
  state: 'local', reason: null, userId: null, pending: 0, failures: 0, busy: false, savedAt: null, online: true,
});

export function getProgressSaveView(): SaveView {
  return instance?.getView() ?? LOCAL_VIEW;
}

export function subscribeProgressSaveView(listener: () => void): () => void {
  return progressSync().subscribeView(listener);
}

/** The reader's save chip, the app notice, LessonEnd. */
export function useProgressSaveView(): SaveView {
  return useSyncExternalStore(subscribeProgressSaveView, getProgressSaveView, () => LOCAL_VIEW);
}

/**
 * The notice's 「もう一度保存する」: one GET now (at most once per 10 s), or one PUT as soon as the
 * 20 s PUT spacing allows. True when a request started or is scheduled. Never throws.
 */
export function retryProgressSync(): boolean {
  try {
    return instance?.retryNow() ?? false;
  } catch (err) {
    console.warn('[progressSync] retry failed:', err);
    return false;
  }
}

/** Logout, step 1 (logoutGuard.ts): upload (≤ 3 s), then how many lesson records are still unsaved. Never throws. */
export async function prepareProgressSignOut(): Promise<{ unsaved: number }> {
  if (!instance) return { unsaved: 0 };
  try {
    return await instance.prepareSignOut();
  } catch (err) {
    console.warn('[progressSync] prepare sign-out failed:', err);
    return { unsaved: 0 };
  }
}

/**
 * LessonEnd's 「このレッスンを最初からやり直す」: the server first, then this browser. Never throws.
 * Phase 6 (R4): the server's reset also removed the lesson's review cards; the review store reads
 * again after a done reset, and also when the server may have reset (unconfirmed: the connection
 * dropped after sending) or deleted everything meanwhile (reloaded). An extra read is harmless.
 */
export async function resetLessonProgress(courseSlug: string, lessonId: string): Promise<LessonResetResult> {
  try {
    const result = await progressSync().resetLesson(courseSlug, lessonId);
    const mayHaveReset = result.ok || ('reason' in result && (result.reason === 'unconfirmed' || result.reason === 'reloaded'));
    if (mayHaveReset) dispatch(REVIEW_STALE_EVENT);
    return result;
  } catch (err) {
    console.warn('[progressSync] lesson reset failed:', err);
    return { ok: false, reason: 'failed' };
  }
}
