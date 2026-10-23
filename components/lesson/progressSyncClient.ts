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
 * - Every request goes out only while the primary session still belongs to the learner the sync
 *   runs for: another tab can switch that session to another learner before this tab hears of it.
 *   The page-hide upload is the exception: fetch must start inside the pagehide/visibilitychange
 *   handler, and getSession waits for a lock (a later task, after the page is gone). It sends the
 *   token of this learner's last session event instead (cachedAuth); it is this learner's own
 *   token, so the upload can only reach their own account.
 */
import { useSyncExternalStore } from 'react';
import { getCourse, getLessonEntry } from '../../content';
import { resolveText } from '../../shared/lesson/text.js';
import { isApiAvailable } from '../../services/apiClient';
import { hydrateFromApi } from '../../services/progressService';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  LessonProgressApiError,
  deleteLessonProgressRecords,
  getLessonProgressRecords,
  putLessonProgressRecords,
} from '../../services/lessonProgressApi';
import { PROGRESS_EVENT, type ProgressEventDetail } from './progressStore.ts';
import {
  SYNC_ACCOUNT_EVENT,
  SYNC_ACCOUNT_KEY,
  createProgressSync,
  isSafeSlug,
  type DeleteResult,
  type ProgressSync,
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
    },
    apiEnabled: isApiAvailable,
    isSyncable,
    lessonTitle,
    events: {
      progress: (detail) => dispatch(PROGRESS_EVENT, detail),
      account: () => dispatch(SYNC_ACCOUNT_EVENT),
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
    });
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
  instance?.stop();
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
 * "Don't add" also clears the learning events (the other person's streak and history); the
 * learner's own come back from the server (hydrateFromApi sends no event: the account event
 * makes the streak and course maps read them again).
 */
export function chooseProgressAdoption(add: boolean): void {
  const applied = instance?.choose(add) ?? false;
  if (applied && !add) void hydrateFromApi().then(() => dispatch(SYNC_ACCOUNT_EVENT));
}

/** The Privacy page's delete: the account's records on the server (then here), or this device's. */
export function deleteLessonProgress(): Promise<DeleteResult> {
  return progressSync().deleteAll();
}

const OFF: SyncState = { status: 'off', userId: null };

const subscribe = (listener: () => void) => progressSync().subscribe(listener);
const snapshot = () => instance?.getState() ?? OFF;

export function useProgressSyncState(): SyncState {
  return useSyncExternalStore(subscribe, snapshot, () => OFF);
}
