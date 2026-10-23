/**
 * Lesson progress sync in the browser (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6): binds
 * the pure core (progressSync.ts) to localStorage, window events, the bundled course outline
 * (content/index.ts) and the API (services/lessonProgressApi.ts). One instance per page.
 *
 * - context/AuthContext.tsx calls signInProgressSync for the primary Supabase session only
 *   (before setUser), stopProgressSync when that session ends elsewhere, and
 *   signOutProgressSync at logout.
 * - Every progressStore.writeProgress (PROGRESS_EVENT without source 'server') of a syncable
 *   lesson marks it pending; page hide flushes.
 * - ProgressAdoptDialog shows the adoption choice (useProgressSyncState, chooseProgressAdoption);
 *   a choice made in another tab closes it here (storage event on the account key).
 * - The Privacy page calls deleteLessonProgress.
 * - Every request goes out only while the primary session still belongs to the learner the sync
 *   runs for: another tab can switch that session to another learner before this tab hears of it.
 */
import { useSyncExternalStore } from 'react';
import { getCourse, getLessonEntry } from '../../content';
import { resolveText } from '../../shared/lesson/text.js';
import { isApiAvailable } from '../../services/apiClient';
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

/**
 * Runs `call` only when the primary session (the token apiFetch sends) still belongs to the
 * learner the sync runs for. Otherwise it fails like a 401: sync stops until that tab's sign-in
 * of the other learner reaches this one (which clears this learner's records first).
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
  if (!expected || current !== expected) {
    throw new LessonProgressApiError('The signed-in learner changed', 401, 'session_changed');
  }
  return call();
}

function progressSync(): ProgressSync {
  if (instance) return instance;
  const sync = createProgressSync({
    storage: localStorageOrNull(),
    api: {
      get: () => asSyncedLearner(getLessonProgressRecords),
      put: (body, { keepalive }) => asSyncedLearner(() => putLessonProgressRecords(body, { keepalive })),
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
    });
  }
  return sync;
}

/** The primary Supabase session's user (synchronous owner rule, then one hydrate per page load). */
export function signInProgressSync(userId: string): void {
  try {
    progressSync().signIn(userId);
  } catch (err) {
    console.warn('[progressSync] sign-in failed:', err);
  }
}

/** The primary session ended without this tab's logout (another tab signed out). */
export function stopProgressSync(): void {
  instance?.stop();
}

/** Logout: upload what is pending (≤ 3 s), then clear this learner's lesson data. Never throws. */
export async function signOutProgressSync(): Promise<void> {
  if (!instance) return;
  try {
    await instance.signOut();
  } catch (err) {
    console.warn('[progressSync] sign-out failed:', err);
  }
}

export function chooseProgressAdoption(add: boolean): void {
  instance?.choose(add);
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
