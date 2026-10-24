/**
 * Lesson progress sync, the pure core (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6).
 *
 * The reader keeps every lesson's progress in localStorage (progressStore.ts). For a learner
 * signed in with the primary Supabase client (the identity apiFetch sends; guests, dev mock users
 * and Nexloom-only sessions never sync), this module keeps the published lessons' records in step
 * with /api/v2/user/lesson-progress (server/routes/lessonProgress.js), which is the merge
 * authority. Local data is never overwritten with a server record: server data is always merged
 * into what is stored at that moment (shared/lesson/progressMerge.js).
 *
 * - Sign-in (signIn, synchronous, before the app shows the learner): `rp:progressSync:account`
 *   = { userId, epoch } says whose progress this browser holds. Another learner's sign-in clears
 *   every local lesson record, pending marker, rp:lastLesson, rp_learning_events and the legacy
 *   rp_learning_progress first. Progress nobody owns (saved before this release, by a guest, or
 *   written after the learner left: see Logout) joins the account only when the learner says so:
 *   status 'needs_choice' until choose(add) here or in another tab.
 * - Hydrate (once per learner per page load): GET (retried on 429/5xx/network), then each server
 *   record is merged into the local one and announced as PROGRESS_EVENT { source: 'server' };
 *   local records whose merge with the server's adds something are uploaded. A reset epoch that
 *   differs from the one this browser last saw means the learner deleted their progress on
 *   another device: local records are cleared first, so nothing deleted comes back. epoch '?' =
 *   not known yet (nothing to compare). An answer (GET or PUT) that may predate a delete or reset
 *   another tab made meanwhile is never written locally: the GET is repeated, a PUT's answer is
 *   dropped and the server state is loaded again. A failed hydrate, or uploads stopped by a 401
 *   or 503, start again on the learner's next session event (signIn) and at logout. refresh()
 *   (the tab is visible again) repeats the GET at most once a minute while sync is on and idle.
 * - Writes: each local write of a syncable lesson sets `rp:progressSync:pending:<course>:<lesson>`
 *   to the record's updatedAt, even while sync is off. Flushes PUT the marked records 5 s after
 *   the last change (at most 60 s after the first), at most once per 20 s, with backoff up to
 *   5 min on failure; on page hide one keepalive PUT (body ≤ 60 KB). A marker is removed only
 *   when it still holds the updatedAt that was sent and the server's record holds every seen
 *   block, answer and check that was sent. 409 progress_reset resets local data and hydrates
 *   again; 401 and 503 stop uploads until the next sign-in or session event.
 * - Logout (signOut): flush (≤ 3 s; a stopped sync hydrates first), then clear every lesson
 *   record without a pending marker, rp:lastLesson, rp_learning_events and rp_learning_progress.
 *   Pending records and the account stay only while markers remain, and the account is marked
 *   loggedOut, each marker naming its record's updatedAt. The same learner's next sign-in uploads
 *   them; a record written or changed after that (no primary session: nobody syncs it) is not
 *   theirs and is asked about first. Another learner's sign-in clears them. A session that ends
 *   without a logout (stop) leaves every record with activity this way.
 * - Delete (deleteAll, the Privacy page): DELETE first; only on success clear local data and
 *   store the new epoch. Without a primary session or API: this device only.
 * - Account deleted (forget, Phase 4 design §5.11): stop, then clear every lesson record, marker,
 *   the account key, rp:lastLesson, learning events and legacy progress, with no upload. A known
 *   epoch that changed on a re-opened account (the GET says `restarted`) also clears the learning
 *   events and legacy progress (§5.10): they belonged to the deleted account. whenKnown() tells
 *   the legacy hydrate (services/progressService.ts) whether this page load's GET succeeded.
 *
 * Keys start with `rp:progressSync:` so the `rp:progress:` scans (ProgressCluster) skip them.
 * No React, DOM or import.meta, and explicit import extensions: storage, API, timers, clock and
 * events are injected, so server/tests/lessonProgressSync.test.js runs this file under node --test.
 * progressSyncClient.ts wires it to the browser.
 */
import { LESSON_STATES } from '../../shared/lesson/progress.js';
import { mergeProgress, progressContentEqual } from '../../shared/lesson/progressMerge.js';
import { LAST_LESSON_KEY, parseProgress, progressKey, setLastLesson, withSummary } from './progressStore.ts';
import type { LessonProgress, LessonStateName, ProgressSummary } from './progressStore.ts';

export const SYNC_ACCOUNT_KEY = 'rp:progressSync:account';
export const SYNC_PENDING_PREFIX = 'rp:progressSync:pending:';
/** Fired on window when this tab changed the account (sign-in, reset, logout, delete). */
export const SYNC_ACCOUNT_EVENT = 'rp:progress-account';
/** Lesson records (progressStore.progressKey). */
export const PROGRESS_KEY_PREFIX = 'rp:progress:';
/** services/progressService.ts learning events (streak and history), cleared at logout. */
export const LEARNING_EVENTS_KEY = 'rp_learning_events';
/**
 * services/progressService.ts course progress (STORAGE_KEY: Blender stages and steps), cleared
 * with the learning events: hydrateFromApi would otherwise send it to the next learner's account.
 */
export const LEGACY_PROGRESS_KEY = 'rp_learning_progress';

/** The one id rule for course slugs and lesson ids the server stores (tools/core/lessons.js). */
export const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_SLUG_LENGTH = 80;
export const isSafeSlug = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_SLUG_LENGTH && SAFE_SLUG.test(value);

export const SYNC_TIMING = Object.freeze({
  /** A flush runs this long after the last change… */
  flushDelayMs: 5_000,
  /** …but no later than this after the first unsent change (a learner who never pauses). */
  flushMaxWaitMs: 60_000,
  /** At most one PUT per this interval (a classroom shares one IP's request budget). */
  minPutIntervalMs: 20_000,
  maxBackoffMs: 300_000,
  /** Logout waits at most this long for the last upload. */
  logoutFlushMs: 3_000,
  /** GET retries on 429, 5xx and network errors, with backoff from this base. */
  getRetries: 3,
  getRetryBaseMs: 1_000,
  /** GETs per hydrate while another tab keeps changing the account during the request. */
  getPasses: 3,
  /** refresh() (the tab is visible again) loads the server state again at most this often. */
  refreshAfterMs: 60_000,
});

export const SYNC_LIMITS = Object.freeze({
  /** Records per PUT (the API takes 1–25). */
  batchRecords: 25,
  /** Body size per PUT, well under the route's 256 kb limit. */
  batchBytes: 192 * 1024,
  /** fetch keepalive bodies share a 64 KiB budget per page. */
  keepaliveBytes: 60 * 1024,
});

/** A server reset epoch (null: never reset), or '?' while this browser does not know it yet. */
export type SyncEpoch = string | null;
/**
 * loggedOut: the learner left this browser (logout, or the session ended) with records still
 * unsent; nobody syncs it now. Records whose pending marker no longer names their updatedAt were
 * written since, by someone else.
 */
export type SyncAccount = { userId: string; epoch: SyncEpoch | '?'; loggedOut?: true };

/**
 * off: no primary session. needs_choice: waiting for the adoption choice. hydrating: GET running.
 * on: synced. offline: the GET failed (pending markers still accumulate). stopped: 401, 503 or
 * another learner took this browser over in another tab.
 */
export type SyncStatus = 'off' | 'needs_choice' | 'hydrating' | 'on' | 'offline' | 'stopped';
export type SyncState = { readonly status: SyncStatus; readonly userId: string | null };

export type SyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & { readonly length: number };

export type ServerRecord = {
  courseSlug: string;
  lessonId: string;
  progress: unknown;
  pct?: number;
  state?: string;
  updatedAt?: string;
};
export type RejectedRecord = { courseSlug: string | null; lessonId: string | null; error_type: string };
export type PutBody = { epoch: SyncEpoch; records: { courseSlug: string; lessonId: string; progress: LessonProgress }[] };

/** services/lessonProgressApi.ts. Failures throw an ApiFailure-shaped error. */
export type ProgressApi = {
  /** restarted: the account was deleted and opened again since its last reset (server GET, Phase 4). */
  get(): Promise<{ epoch: SyncEpoch; records: ServerRecord[]; restarted?: boolean }>;
  put(body: PutBody, options: { keepalive: boolean }): Promise<{ epoch: SyncEpoch; records: ServerRecord[]; rejected: RejectedRecord[] }>;
  del(): Promise<{ deleted: number; epoch: string }>;
};
/** What the api functions throw: the HTTP status (0 = network) and the server's error_type. */
export type ApiFailure = { status?: number; errorType?: string; epoch?: SyncEpoch };

export type SyncTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};
export type ServerProgressDetail = { courseSlug: string; lessonId: string; source: 'server' };
export type SyncEvents = {
  /** A server-sourced write of one lesson record (dispatch PROGRESS_EVENT with source 'server'). */
  progress?(detail: ServerProgressDetail): void;
  /** The account key changed in this tab (readers re-check it; course maps refresh). */
  account?(): void;
};

export type DeleteResult = { ok: true; scope: 'account' | 'device' } | { ok: false };

export type ProgressSyncOptions = {
  storage: SyncStorage | null;
  api: ProgressApi;
  /** A lesson the server can store: published in the bundled course outline, SAFE_SLUG ids. */
  isSyncable: (courseSlug: string, lessonId: string) => boolean;
  /** False when the app runs without the API (VITE_API_ENABLED=false): local rules only. */
  apiEnabled?: () => boolean;
  /** Title for rp:lastLesson on a new device, in the UI language. */
  lessonTitle?: (courseSlug: string, lessonId: string) => string;
  now?: () => number;
  random?: () => number;
  timers?: SyncTimers;
  events?: SyncEvents;
};

export type ProgressSync = {
  /** The primary Supabase session's user signed in (or the session was restored). Synchronous owner rule, then hydrate. */
  signIn(userId: string): void;
  /**
   * The adoption choice for progress nobody owns: add it to the account, or clear it (with the
   * learning events). True when this tab applied it (false: nothing asked, or chosen elsewhere).
   */
  choose(add: boolean): boolean;
  /** Another tab changed the account key (a storage event): an adoption choice made there applies here. */
  accountChanged(): void;
  /** progressStore.writeProgress wrote this lesson (PROGRESS_EVENT without source 'server'). */
  noteLocalWrite(courseSlug: string, lessonId: string): void;
  /** visibilitychange hidden / pagehide: one PUT now, with keepalive when the body is small. */
  flushOnHide(): void;
  /** visibilitychange visible: load the server state again (merge only), at most once a minute. */
  refresh(): void;
  /** Logout: flush (≤ 3 s), then clear this learner's local data. Never throws. */
  signOut(): Promise<void>;
  /** The primary session ended without this tab's logout: stop, keep local data for this learner. */
  stop(): void;
  /** Delete every lesson record of the learner (server first), or this device's when not signed in. */
  deleteAll(): Promise<DeleteResult>;
  /**
   * The account was deleted (here or on another device): stop, clear every lesson record, marker,
   * the account key, rp:lastLesson, learning events and legacy progress. No upload. Never throws.
   */
  forget(): void;
  /**
   * 'known' once this page load's GET succeeded (the epoch rule ran), 'unknown' after its last
   * failure or when sync does not run for this learner. Waits while the GET (and its bounded
   * retries) runs; adds no timer of its own.
   */
  whenKnown(): Promise<'known' | 'unknown'>;
  getState(): SyncState;
  subscribe(listener: () => void): () => void;
  /** Resolves when no hydrate or upload is running (tests). */
  settled(): Promise<void>;
};

// --- Helpers shared with the reader -----------------------------------------------------------

export function parseSyncAccount(raw: string | null | undefined): SyncAccount | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const { userId, epoch, loggedOut } = data as { userId?: unknown; epoch?: unknown; loggedOut?: unknown };
    if (typeof userId !== 'string' || !userId) return null;
    return {
      userId,
      epoch: epoch === null ? null : typeof epoch === 'string' && epoch ? epoch : '?',
      ...(loggedOut === true ? { loggedOut: true as const } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * True when the account string changed in a way that makes an open reader's in-memory record
 * stale: another learner (or none: a logout, also one that left records pending) now owns the
 * browser, or a known epoch changed (the progress was deleted or reset). '?' → epoch is the
 * first successful hydrate and keeps local data.
 */
export function isAccountSwitch(before: string | null, after: string | null): boolean {
  if (before === after) return false;
  const a = parseSyncAccount(before);
  const b = parseSyncAccount(after);
  if (!a && !b) return false;
  if (!a || !b) return true;
  if (a.userId !== b.userId || Boolean(a.loggedOut) !== Boolean(b.loggedOut)) return true;
  return a.epoch !== '?' && a.epoch !== b.epoch;
}

/** Nobody is signed in to sync this browser: no account, or one whose learner left (loggedOut). */
export function isSignedOutAccount(raw: string | null): boolean {
  const account = parseSyncAccount(raw);
  return !account || account.loggedOut === true;
}

/**
 * For an open reader (useLessonProgress): must it drop its in-memory record (re-read storage and
 * never write it back)? Yes on an account switch. '?' → a known epoch is normally the first
 * hydrate, which only adds to stored records; when the stored record no longer holds what the
 * reader last read or wrote (`persisted`), another tab cleared it: the learner deleted their
 * progress there before this tab learned the epoch. Drop then too.
 */
export function readerMustDrop(
  before: string | null,
  after: string | null,
  stored: LessonProgress,
  persisted: LessonProgress,
): boolean {
  if (isAccountSwitch(before, after)) return true;
  if (before === after || parseSyncAccount(before)?.epoch !== '?') return false;
  return !covers(stored, persisted);
}

/** Anything worth keeping: seen blocks, answers, checks or ratings. */
export const hasActivity = (p: LessonProgress): boolean =>
  p.seen.length > 0
  || Object.keys(p.answers).length > 0
  || Object.keys(p.checks).length > 0
  || Object.keys(p.ratings ?? {}).length > 0;

export function pendingKey(courseSlug: string, lessonId: string): string {
  return `${SYNC_PENDING_PREFIX}${courseSlug}:${lessonId}`;
}

// --- Core -------------------------------------------------------------------------------------

type LessonRef = { courseSlug: string; lessonId: string };
type BatchItem = LessonRef & { progress: LessonProgress; sentAt: string; bytes: number };
type FlushMode = 'scheduled' | 'all' | 'hide';
type HydrateMode = 'load' | 'retry' | 'refresh';

const refKey = (ref: LessonRef) => `${ref.courseSlug}:${ref.lessonId}`;
function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** `rp:progress:<course>:<lesson>` (or a pending key) → its lesson; ids never contain ':'. */
function refOf(key: string, prefix: string): LessonRef | null {
  const rest = key.slice(prefix.length);
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon === rest.length - 1) return null;
  return { courseSlug: rest.slice(0, colon), lessonId: rest.slice(colon + 1) };
}

const statusOf = (err: unknown): number => {
  const status = (err as ApiFailure | null)?.status;
  return typeof status === 'number' ? status : 0;
};
const retryable = (err: unknown) => {
  const status = statusOf(err);
  return status === 0 || status === 429 || status >= 500;
};

function summaryOf(record: ServerRecord): ProgressSummary | null {
  const pct = Number(record.pct);
  if (!Number.isFinite(pct) || !(LESSON_STATES as readonly unknown[]).includes(record.state)) return null;
  return { pct: Math.max(0, Math.min(100, Math.round(pct))), state: record.state as LessonStateName };
}

/** Same per-key edit times (editedKeys). */
function sameClocks(a: Record<string, string> = {}, b: Record<string, string> = {}): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => hasOwn(b, key) && a[key] === b[key]);
}

/** Same stored record: content, every clock and the summary. */
const sameStored = (a: LessonProgress, b: LessonProgress) =>
  progressContentEqual(a, b)
  && a.updatedAt === b.updatedAt
  && (a.editedAt ?? null) === (b.editedAt ?? null)
  && sameClocks(a.editedKeys, b.editedKeys)
  && a.summary?.pct === b.summary?.pct
  && a.summary?.state === b.summary?.state;

/** `outer` holds every seen block, answer and check of `inner` (the server's record of what was sent). */
function covers(outer: LessonProgress, inner: LessonProgress): boolean {
  const seen = new Set(outer.seen);
  return inner.seen.every((id) => seen.has(id))
    && Object.keys(inner.answers).every((key) => hasOwn(outer.answers, key))
    && Object.keys(inner.checks).every((key) => hasOwn(outer.checks, key));
}

/** Rejections that will not change on a retry: the marker goes, the local record stays. */
const FINAL_REJECTIONS = new Set(['unknown_lesson', 'too_large']);

export function createProgressSync(options: ProgressSyncOptions): ProgressSync {
  const { storage, api, isSyncable } = options;
  const apiEnabled = options.apiEnabled ?? (() => true);
  const lessonTitle = options.lessonTitle ?? (() => '');
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const timers: SyncTimers = options.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const events = options.events ?? {};

  let state: SyncState = { status: 'off', userId: null };
  const listeners = new Set<() => void>();
  /** The server's reset epoch from this page load's GET (or a delete); undefined until known. */
  let epoch: SyncEpoch | undefined;
  /** Bumped when the learner changes or local data is reset: older responses and timers are dropped. */
  let generation = 0;
  let hydration: Promise<void> | null = null;
  let inFlight: Promise<void> | null = null;
  let flushAgain = false;
  let flushTimer: unknown = null;
  let firstChangeAt: number | null = null;
  let lastPutAt = Number.NEGATIVE_INFINITY;
  /** When the last GET was sent (refresh() waits SYNC_TIMING.refreshAfterMs after it). */
  let lastGetAt = Number.NEGATIVE_INFINITY;
  let retryAt = 0;
  let failures = 0;
  /** whenKnown() callers waiting for the GET that runs now. */
  let knownWaiters: Array<(result: 'known' | 'unknown') => void> = [];

  function setState(status: SyncStatus, userId: string | null = state.userId): void {
    if (state.status === status && state.userId === userId) return;
    const wasHydrating = state.status === 'hydrating';
    state = { status, userId };
    if (wasHydrating && status !== 'hydrating' && knownWaiters.length) {
      // The GET settled: 'on' only after a successful one (or a failed refresh, epoch still known).
      const result = status === 'on' && epoch !== undefined ? 'known' : 'unknown';
      const waiting = knownWaiters;
      knownWaiters = [];
      for (const resolve of waiting) resolve(result);
    }
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A broken listener must not stop the sync.
      }
    }
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    timers.setTimeout(resolve, ms);
  });

  // --- Storage (every access may throw: private mode, quota, blocked site data) ---

  function read(key: string): string | null {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }
  function write(key: string, value: string): boolean {
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  function remove(key: string): void {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }
  function allKeys(): string[] {
    if (!storage) return [];
    try {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key !== null) keys.push(key);
      }
      return keys;
    } catch {
      return [];
    }
  }

  const readAccount = () => parseSyncAccount(read(SYNC_ACCOUNT_KEY));
  const emitAccount = () => {
    try {
      events.account?.();
    } catch {
      // ignore
    }
  };
  function writeAccount(account: SyncAccount | null): void {
    if (account) write(SYNC_ACCOUNT_KEY, JSON.stringify(account));
    else remove(SYNC_ACCOUNT_KEY);
    emitAccount();
  }

  const syncable = (ref: LessonRef) => {
    if (!isSafeSlug(ref.courseSlug) || !isSafeSlug(ref.lessonId)) return false;
    try {
      return isSyncable(ref.courseSlug, ref.lessonId);
    } catch {
      return false;
    }
  };
  const readRecord = (ref: LessonRef) => parseProgress(read(progressKey(ref.courseSlug, ref.lessonId)));

  const sortRefs = (refs: LessonRef[]) => refs.sort((a, b) => (refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0));

  /** Syncable lessons with a local record. */
  function localLessons(): LessonRef[] {
    const refs: LessonRef[] = [];
    for (const key of allKeys()) {
      if (!key.startsWith(PROGRESS_KEY_PREFIX)) continue;
      const ref = refOf(key, PROGRESS_KEY_PREFIX);
      if (ref && syncable(ref)) refs.push(ref);
    }
    return sortRefs(refs);
  }
  function pendingLessons(): LessonRef[] {
    const refs: LessonRef[] = [];
    for (const key of allKeys()) {
      if (!key.startsWith(SYNC_PENDING_PREFIX)) continue;
      const ref = refOf(key, SYNC_PENDING_PREFIX);
      if (ref) refs.push(ref);
      else remove(key);
    }
    return sortRefs(refs);
  }
  const getMarker = (ref: LessonRef) => read(pendingKey(ref.courseSlug, ref.lessonId));
  const setMarker = (ref: LessonRef, updatedAt: string) => write(pendingKey(ref.courseSlug, ref.lessonId), updatedAt);
  const removeMarker = (ref: LessonRef) => remove(pendingKey(ref.courseSlug, ref.lessonId));

  const hasLocalActivity = () => localLessons().some((ref) => hasActivity(readRecord(ref)));

  /** The record is still as its learner left it (leave()): its pending marker names its updatedAt. */
  function leftUnchanged(ref: LessonRef): boolean {
    const raw = read(progressKey(ref.courseSlug, ref.lessonId));
    return raw !== null && getMarker(ref) === parseProgress(raw).updatedAt;
  }
  /** Activity written after the learner left (no marker, or changed since): not theirs. */
  const hasActivitySinceLeft = () => localLessons().some((ref) => hasActivity(readRecord(ref)) && !leftUnchanged(ref));
  /** This learner's account as they left it (loggedOut), or null. */
  function leftAccount(userId: string): SyncAccount | null {
    const account = readAccount();
    return account?.userId === userId && account.loggedOut ? account : null;
  }

  /**
   * Removes lesson records (all of them, or those without a pending marker), markers (unless
   * kept) and rp:lastLesson; with learningEvents also rp_learning_events and the legacy
   * rp_learning_progress (the streak, history and Blender progress of whoever studied here).
   */
  function clearLocal({ keepPending = false, learningEvents = false } = {}): void {
    const keys = allKeys();
    const pending = new Set(keys.filter((key) => key.startsWith(SYNC_PENDING_PREFIX)).map((key) => key.slice(SYNC_PENDING_PREFIX.length)));
    for (const key of keys) {
      if (key.startsWith(PROGRESS_KEY_PREFIX)) {
        if (!(keepPending && pending.has(key.slice(PROGRESS_KEY_PREFIX.length)))) remove(key);
      } else if (!keepPending && key.startsWith(SYNC_PENDING_PREFIX)) {
        remove(key);
      }
    }
    remove(LAST_LESSON_KEY);
    if (learningEvents) {
      remove(LEARNING_EVENTS_KEY);
      remove(LEGACY_PROGRESS_KEY);
    }
  }

  /**
   * The learner leaves this browser (logout, or the session ended). Records still unsent wait for
   * them: each marker is set to its record's updatedAt now (the records are theirs at this
   * moment) and the account is marked loggedOut, so a record written or changed later, by
   * someone without a primary session, is not taken for theirs. Without unsent records the
   * account goes. An account already marked loggedOut is left as it is: another tab's logout or
   * session end set its markers, and what was written since is not this learner's.
   */
  function leave(account: SyncAccount): void {
    if (account.loggedOut) return;
    let left = 0;
    for (const ref of pendingLessons()) {
      const raw = read(progressKey(ref.courseSlug, ref.lessonId));
      if (raw === null) {
        removeMarker(ref);
      } else {
        setMarker(ref, parseProgress(raw).updatedAt);
        left += 1;
      }
    }
    if (left) write(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: account.userId, epoch: account.epoch, loggedOut: true }));
    else remove(SYNC_ACCOUNT_KEY);
  }

  /**
   * Writes merge(server, stored local) with the server's pct/state, keeping the merged clocks,
   * and announces it as server data. Nothing is written when the stored record already says it.
   */
  function takeIn(ref: LessonRef, server: LessonProgress, summary: ProgressSummary | null): void {
    const key = progressKey(ref.courseSlug, ref.lessonId);
    const raw = read(key);
    const local = parseProgress(raw);
    let next = mergeProgress(server, local);
    const keep = summary ?? local.summary ?? null;
    if (keep) next = withSummary(next, keep);
    if (raw !== null && sameStored(local, next)) return;
    if (!write(key, JSON.stringify(next))) return;
    try {
      events.progress?.({ courseSlug: ref.courseSlug, lessonId: ref.lessonId, source: 'server' });
    } catch {
      // ignore
    }
  }

  // --- Lifecycle ---

  function clearFlushTimer(): void {
    if (flushTimer !== null) timers.clearTimeout(flushTimer);
    flushTimer = null;
  }

  /** Drops timers, backoff and every response still on its way. */
  function stopActivity(): void {
    generation += 1;
    clearFlushTimer();
    firstChangeAt = null;
    flushAgain = false;
    failures = 0;
    retryAt = 0;
  }

  /** The GET failed, or uploads stopped (401, 503): nothing uploads until a hydrate succeeds. */
  const stalled = () => state.status === 'offline' || state.status === 'stopped';

  function signIn(userId: string): void {
    if (!userId || !storage) return;
    const again = state.userId === userId && state.status !== 'off';
    if (again) {
      // INITIAL_SESSION, TOKEN_REFRESHED and SIGNED_IN on refocus: one hydrate per learner per page
      // load. A stalled one starts again (one GET per event), while the account here is still this
      // learner's (one a takeover in another tab gave to another learner stays theirs).
      if (!(stalled() && readAccount()?.userId === userId)) return;
    }
    stopActivity();
    epoch = undefined;
    const account = readAccount();
    if (account?.userId === userId) {
      // This browser already holds this learner's progress, or what they left at logout. Records
      // written or changed since they left are not theirs: ask first.
      if (account.loggedOut) {
        if (hasActivitySinceLeft()) {
          setState('needs_choice', userId);
          return;
        }
        writeAccount({ userId, epoch: account.epoch });
      }
    } else if (account) {
      // Another learner's progress (and streak): gone before this learner sees anything.
      clearLocal({ learningEvents: true });
      writeAccount({ userId, epoch: '?' });
    } else if (hasLocalActivity()) {
      // Nobody owns the progress here (saved before this release, or by a guest): ask first.
      setState('needs_choice', userId);
      return;
    } else {
      writeAccount({ userId, epoch: '?' });
    }
    startHydrate(userId, again ? 'retry' : 'load');
  }

  /**
   * The adoption choice was already made in another tab (or another learner signed in there):
   * follow what is stored instead of asking again, so "Don't add" in one tab never undoes "Add"
   * in another. False when nothing is stored yet, or only this learner's account as they left it.
   */
  function choiceMadeElsewhere(userId: string): boolean {
    const account = readAccount();
    if (!account || (account.userId === userId && account.loggedOut)) return false;
    if (account.userId === userId) startHydrate(userId);
    else stop();
    return true;
  }

  function choose(add: boolean): boolean {
    const userId = state.userId;
    if (!userId || state.status !== 'needs_choice') return false;
    if (choiceMadeElsewhere(userId)) return false;
    // The learner is back after a logout: their records as they left them stay theirs either way,
    // and so does the epoch (a delete made elsewhere meanwhile still clears them).
    const left = leftAccount(userId);
    if (add) {
      // Pending until uploaded, so a logout before the upload keeps them.
      for (const ref of localLessons()) {
        const progress = readRecord(ref);
        if (hasActivity(progress)) setMarker(ref, progress.updatedAt);
      }
    } else if (left) {
      // Only what was written after they left goes, with the streak and history kept since.
      for (const key of allKeys()) {
        if (!key.startsWith(PROGRESS_KEY_PREFIX)) continue;
        const ref = refOf(key, PROGRESS_KEY_PREFIX);
        if (ref && leftUnchanged(ref)) continue;
        remove(key);
        if (ref) removeMarker(ref);
      }
      remove(LAST_LESSON_KEY);
      remove(LEARNING_EVENTS_KEY);
      remove(LEGACY_PROGRESS_KEY);
    } else {
      // The other person's lesson records, and their streak and history.
      clearLocal({ learningEvents: true });
    }
    writeAccount({ userId, epoch: left ? left.epoch : '?' });
    startHydrate(userId);
    return true;
  }

  function accountChanged(): void {
    const userId = state.userId;
    if (userId && state.status === 'needs_choice') choiceMadeElsewhere(userId);
  }

  /** Loads the server state again, keeping local data (it was reset already, here or in another tab). */
  function rehydrate(): void {
    const userId = state.userId;
    if (!userId) return;
    stopActivity();
    epoch = undefined;
    startHydrate(userId);
  }

  /**
   * load: the GET is retried (429, 5xx, network). retry (a stalled sync's next session event) and
   * refresh (sync was on: refresh()) send one GET; the next event tries again. A failed refresh
   * leaves sync on (uploads go on) instead of offline.
   */
  function startHydrate(userId: string, mode: HydrateMode = 'load'): void {
    const gen = generation;
    setState('hydrating', userId);
    const run = hydrate(userId, gen, mode).catch(() => {
      if (gen === generation) getFailed(mode);
    });
    hydration = run;
    void run.finally(() => {
      if (hydration === run) hydration = null;
    });
  }

  function getFailed(mode: HydrateMode): void {
    if (mode !== 'refresh') {
      setState('offline');
      return;
    }
    setState('on');
    if (pendingLessons().length) scheduleFlush();
  }

  async function getWithRetry(gen: number, retries: number) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        lastGetAt = now();
        return await api.get();
      } catch (err) {
        if (attempt >= retries || !retryable(err) || gen !== generation) throw err;
        await sleep(SYNC_TIMING.getRetryBaseMs * 2 ** attempt * (0.5 + random()));
        if (gen !== generation) throw err;
      }
    }
  }

  async function hydrate(userId: string, gen: number, mode: HydrateMode): Promise<void> {
    if (!apiEnabled()) {
      getFailed(mode);
      return;
    }
    let result: Awaited<ReturnType<ProgressApi['get']>>;
    for (let pass = 1; ; pass += 1) {
      const before = read(SYNC_ACCOUNT_KEY);
      try {
        result = await getWithRetry(gen, mode === 'load' ? SYNC_TIMING.getRetries : 0);
      } catch {
        if (gen === generation) getFailed(mode);
        return;
      }
      if (gen !== generation || state.userId !== userId) return;
      // Another tab changed the account while the GET ran (a delete there, or its own hydrate): the
      // answer may predate a delete, and must not bring deleted records or the old epoch back.
      if (read(SYNC_ACCOUNT_KEY) === before || pass >= SYNC_TIMING.getPasses) break;
    }
    const account = readAccount();
    if (!account || account.userId !== userId || account.loggedOut) {
      // Another tab signed another learner in meanwhile, or signed this one out.
      setState('stopped');
      return;
    }
    const serverEpoch = result.epoch ?? null;
    // The learner deleted their progress elsewhere since this browser last synced. When the whole
    // account was deleted and opened again (restarted), the streak, history and legacy progress
    // here were the deleted account's too. A '?' device keeps what it has: it was written or
    // adopted by the learner signed in now (a first sign-in, an account switch, "Add").
    if (account.epoch !== '?' && account.epoch !== serverEpoch) clearLocal({ learningEvents: result.restarted === true });
    epoch = serverEpoch;
    writeAccount({ userId, epoch: serverEpoch });
    if (readAccount()?.epoch !== serverEpoch) {
      // Storage refused the account (full or blocked): uploads could not tell this tab's epoch from
      // another tab's (and would load again and again). Stop for this page load.
      setState('stopped');
      return;
    }

    const server = new Map<string, LessonProgress>();
    let latest: { record: ServerRecord; at: number } | null = null;
    for (const record of result.records) {
      const ref = { courseSlug: record.courseSlug, lessonId: record.lessonId };
      if (!syncable(ref)) continue;
      const progress = parseProgress(record.progress);
      server.set(refKey(ref), progress);
      takeIn(ref, progress, summaryOf(record));
      const at = Date.parse(record.updatedAt ?? progress.updatedAt);
      if (Number.isFinite(at) && (!latest || at > latest.at)) latest = { record, at };
    }
    // A new device: "continue" points at the lesson the learner read last anywhere.
    if (latest && read(LAST_LESSON_KEY) === null) {
      const { record } = latest;
      setLastLesson({
        courseSlug: record.courseSlug,
        lessonId: record.lessonId,
        title: lessonTitle(record.courseSlug, record.lessonId),
        pct: summaryOf(record)?.pct ?? 0,
        at: new Date(latest.at).toISOString(),
      }, storage);
    }
    // Upload what the server lacks; markers whose content the server already has go.
    for (const ref of localLessons()) {
      const local = readRecord(ref);
      const stored = server.get(refKey(ref)) ?? null;
      const lacking = hasActivity(local) && (!stored || !progressContentEqual(mergeProgress(stored, local), stored));
      if (lacking) setMarker(ref, local.updatedAt);
      else removeMarker(ref);
    }
    setState('on');
    if (pendingLessons().length) await flush('all');
  }

  // --- Uploads ---

  function scheduleFlush(): void {
    if (state.status !== 'on') return;
    const t = now();
    if (firstChangeAt === null) firstChangeAt = t;
    const debounced = Math.min(t + SYNC_TIMING.flushDelayMs, firstChangeAt + SYNC_TIMING.flushMaxWaitMs);
    const due = Math.max(debounced, lastPutAt + SYNC_TIMING.minPutIntervalMs, retryAt);
    clearFlushTimer();
    const gen = generation;
    flushTimer = timers.setTimeout(() => {
      flushTimer = null;
      if (gen === generation) void flush('scheduled');
    }, Math.max(0, due - t));
  }

  function canFlush(): boolean {
    if (state.status !== 'on' || epoch === undefined || !state.userId || !apiEnabled()) return false;
    const account = readAccount();
    if (!account || account.userId !== state.userId || account.loggedOut) {
      setState('stopped');
      return false;
    }
    return true;
  }

  /** The marked records, in batches of ≤ 25 records and ≤ 192 KB. */
  function collectBatches(): BatchItem[][] {
    const items: BatchItem[] = [];
    for (const ref of pendingLessons()) {
      const raw = syncable(ref) ? read(progressKey(ref.courseSlug, ref.lessonId)) : null;
      if (raw === null) {
        removeMarker(ref);
        continue;
      }
      const record = parseProgress(raw);
      // The server derives pct/state itself.
      const { summary: _summary, ...progress } = record;
      // The marker now names exactly what is sent.
      setMarker(ref, record.updatedAt);
      const bytes = JSON.stringify({ courseSlug: ref.courseSlug, lessonId: ref.lessonId, progress }).length + 1;
      items.push({ ...ref, progress, sentAt: record.updatedAt, bytes });
    }
    const batches: BatchItem[][] = [];
    let batch: BatchItem[] = [];
    let size = 0;
    for (const item of items) {
      if (batch.length && (batch.length >= SYNC_LIMITS.batchRecords || size + item.bytes > SYNC_LIMITS.batchBytes)) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(item);
      size += item.bytes;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  function applyPutResult(batch: BatchItem[], result: Awaited<ReturnType<ProgressApi['put']>>): void {
    const returned = new Map<string, ServerRecord>();
    for (const record of result.records ?? []) returned.set(refKey(record), record);
    const rejected = new Map<string, string>();
    for (const item of result.rejected ?? []) rejected.set(`${item.courseSlug}:${item.lessonId}`, item.error_type);
    for (const item of batch) {
      const record = returned.get(refKey(item));
      if (record) {
        const server = parseProgress(record.progress);
        takeIn(item, server, summaryOf(record));
        if (getMarker(item) === item.sentAt && covers(server, item.progress)) removeMarker(item);
      } else if (FINAL_REJECTIONS.has(rejected.get(refKey(item)) ?? '')) {
        // Local stays as it is; a later change or hydrate offers it again.
        removeMarker(item);
      }
    }
  }

  /** 409: local data predates a delete. Reset unless another tab already did, then hydrate again. */
  function resetTo(serverEpoch: SyncEpoch): void {
    const userId = state.userId;
    if (!userId) return;
    const account = readAccount();
    if (!(account && account.userId === userId && account.epoch === serverEpoch)) {
      clearLocal();
      writeAccount({ userId, epoch: serverEpoch });
    }
    rehydrate();
  }

  function handlePutFailure(err: unknown, batch: BatchItem[]): void {
    const status = statusOf(err);
    const failure = (err ?? {}) as ApiFailure;
    if (status === 409 && failure.errorType === 'progress_reset') {
      resetTo(failure.epoch ?? null);
      return;
    }
    if (status === 401 || status === 503) {
      // 401: until the next sign-in. 503: no lesson progress on this server for this page load.
      clearFlushTimer();
      setState('stopped');
      return;
    }
    if (status === 413 && batch.length === 1) {
      removeMarker(batch[0]);
      return;
    }
    failures += 1;
    const backoff = Math.min(SYNC_TIMING.maxBackoffMs, SYNC_TIMING.minPutIntervalMs * 2 ** (failures - 1));
    retryAt = now() + backoff * (0.5 + random() * 0.5);
    scheduleFlush();
  }

  async function sendBatch(batch: BatchItem[], gen: number, keepaliveWanted: boolean): Promise<boolean> {
    const body: PutBody = {
      epoch: epoch ?? null,
      records: batch.map(({ courseSlug, lessonId, progress }) => ({ courseSlug, lessonId, progress })),
    };
    const keepalive = keepaliveWanted && JSON.stringify(body).length <= SYNC_LIMITS.keepaliveBytes;
    lastPutAt = now();
    try {
      const result = await api.put(body, { keepalive });
      const account = readAccount();
      if (gen !== generation || account?.userId !== state.userId) return false;
      if (account.loggedOut) {
        // The learner logged out in another tab while this PUT ran: its answer may hold records
        // that logout cleared. Drop it; the markers stay as the logout left them.
        setState('stopped');
        return false;
      }
      if (account.epoch !== (epoch ?? null)) {
        // Another tab deleted or reset the progress while this PUT ran: its answer may hold
        // deleted records. Drop it and load the server state again (local data stays as it is).
        rehydrate();
        return false;
      }
      failures = 0;
      retryAt = 0;
      applyPutResult(batch, result);
      return true;
    } catch (err) {
      if (gen !== generation) return false;
      handlePutFailure(err, batch);
      return false;
    }
  }

  /**
   * scheduled: one batch (the timer keeps the 20 s spacing). all: every batch now (hydrate and
   * logout). hide: one batch now, keepalive when small.
   */
  async function flush(mode: FlushMode): Promise<void> {
    while (inFlight) {
      if (mode !== 'all') {
        flushAgain = true;
        return;
      }
      await inFlight;
    }
    if (!canFlush()) return;
    if (mode === 'hide' && now() < retryAt) return;
    clearFlushTimer();
    firstChangeAt = null;
    const gen = generation;
    let more = false;
    const run = (async () => {
      const batches = collectBatches();
      const toSend = mode === 'all' ? batches : batches.slice(0, 1);
      more = batches.length > toSend.length;
      for (const batch of toSend) {
        if (gen !== generation || !(await sendBatch(batch, gen, mode === 'hide'))) {
          more = false;
          return;
        }
      }
    })();
    inFlight = run;
    try {
      await run;
    } finally {
      if (inFlight === run) inFlight = null;
    }
    if (gen !== generation || state.status !== 'on') return;
    if (flushAgain || more) {
      flushAgain = false;
      scheduleFlush();
    }
  }

  function noteLocalWrite(courseSlug: string, lessonId: string): void {
    const userId = state.userId;
    if (!userId || state.status === 'needs_choice') return;
    const ref = { courseSlug, lessonId };
    if (!syncable(ref) || readAccount()?.userId !== userId) return;
    const raw = read(progressKey(courseSlug, lessonId));
    if (raw === null) return;
    setMarker(ref, parseProgress(raw).updatedAt);
    scheduleFlush();
  }

  function flushOnHide(): void {
    if (state.status === 'on') void flush('hide');
  }

  function refresh(): void {
    const userId = state.userId;
    // Idle: no GET or PUT running, no upload waiting and no backoff.
    if (!userId || state.status !== 'on' || hydration || inFlight || flushTimer !== null || failures > 0) return;
    if (now() - lastGetAt < SYNC_TIMING.refreshAfterMs || !apiEnabled()) return;
    startHydrate(userId, 'refresh');
  }

  async function signOut(): Promise<void> {
    const userId = state.userId;
    if (!userId) return;
    try {
      if (state.status === 'needs_choice') {
        // Nothing was adopted: the progress here stays as it was, still unowned.
        stopActivity();
        epoch = undefined;
        setState('off', null);
        return;
      }
      // A stalled sync (the GET failed, or a 401/503 stopped uploads) tries once more while the
      // session is still valid: the hydrate ends with the upload of what is pending.
      const account = readAccount();
      const retry = stalled() && account?.userId === userId && !account.loggedOut;
      if (retry) rehydrate();
      if (retry && hydration) {
        await Promise.race([hydration, sleep(SYNC_TIMING.logoutFlushMs)]);
      } else if (state.status === 'on') {
        await Promise.race([flush('all'), sleep(SYNC_TIMING.logoutFlushMs)]);
      }
      stopActivity();
      clearLocal({ keepPending: true, learningEvents: true });
      const stored = readAccount();
      if (stored?.userId === userId) leave(stored);
    } catch {
      // Storage trouble: nothing more to clear.
    }
    epoch = undefined;
    setState('off', null);
    emitAccount();
  }

  function stop(): void {
    const userId = state.userId;
    try {
      const account = readAccount();
      // The session ended without a logout here (an expiry, or a logout in another tab), or a page
      // opened after the account's session had already ended (userId null: this page never signed
      // in). Every record with activity is the account's at this moment, and waits for them like a
      // logout's. Not when the account is already marked loggedOut: what was written since is not
      // theirs.
      const owned = account && !account.loggedOut
        && (userId === null || (account.userId === userId && state.status !== 'needs_choice'));
      if (account && owned) {
        for (const ref of localLessons()) {
          const progress = readRecord(ref);
          if (hasActivity(progress)) setMarker(ref, progress.updatedAt);
        }
        leave(account);
        emitAccount();
      }
    } catch {
      // Storage trouble: nothing to keep.
    }
    if (!userId) return;
    stopActivity();
    epoch = undefined;
    setState('off', null);
  }

  async function deleteAll(): Promise<DeleteResult> {
    const userId = state.userId;
    if (!userId || !apiEnabled()) {
      // Guests, no primary session or no API: this device only.
      clearLocal();
      emitAccount();
      return { ok: true, scope: 'device' };
    }
    let result: Awaited<ReturnType<ProgressApi['del']>>;
    try {
      result = await api.del();
    } catch {
      // Nothing changes here: the server still has the records, so local data keeps matching it.
      return { ok: false };
    }
    if (state.userId !== userId) return { ok: true, scope: 'account' };
    stopActivity();
    clearLocal();
    epoch = typeof result?.epoch === 'string' ? result.epoch : null;
    writeAccount({ userId, epoch });
    // The server holds nothing now and the epoch is known: sync can run.
    setState('on');
    return { ok: true, scope: 'account' };
  }

  function forget(): void {
    try {
      stopActivity();
      epoch = undefined;
      clearLocal({ keepPending: false, learningEvents: true });
      remove(SYNC_ACCOUNT_KEY);
    } catch {
      // Storage trouble: nothing more to clear.
    }
    setState('off', null);
    emitAccount();
  }

  function whenKnown(): Promise<'known' | 'unknown'> {
    if (state.status === 'hydrating') return new Promise((resolve) => knownWaiters.push(resolve));
    return Promise.resolve(state.status === 'on' && epoch !== undefined ? 'known' : 'unknown');
  }

  async function settled(): Promise<void> {
    for (let i = 0; i < 50; i += 1) {
      const running = hydration ?? inFlight;
      if (!running) return;
      await running;
    }
  }

  return {
    signIn,
    choose,
    accountChanged,
    noteLocalWrite,
    flushOnHide,
    refresh,
    signOut,
    stop,
    deleteAll,
    forget,
    whenKnown,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settled,
  };
}
