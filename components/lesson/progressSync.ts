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
 *   without a logout (stop) leaves every record with activity this way; the account then names
 *   the records that were really unsent (SyncAccount.unsent: the sign-in view counts only those).
 * - Delete (deleteAll, the Privacy page): DELETE first; only on success clear local data and
 *   store the new epoch. Without a primary session or API: this device only.
 * - Account deleted (forget, Phase 4 design §5.11): stop, then clear every lesson record, marker,
 *   the account key, rp:lastLesson, learning events and legacy progress, with no upload. A known
 *   epoch that changed on a re-opened account (the GET says `restarted`) also clears the learning
 *   events and legacy progress (§5.10): they belonged to the deleted account. whenKnown() tells
 *   the legacy hydrate (services/progressService.ts) whether this page load's GET succeeded.
 * - Phase 5 (doc/brushup-2026/ai-access-plan.ja.md §9), one lesson started over
 *   (resetLesson: POST …/lesson-reset first, local data only on success): every lesson has a
 *   generation on the server; each stored record carries the one its content builds on
 *   (`lessonGen`, progressStore.ts LessonGen), and every PUT record sends it (`lessonEpoch`). The
 *   generation is taken from each response that names one (an older server names none: stamps are
 *   left alone and nothing is dropped). A record of an older generation, or one with content from
 *   before the reset, is dropped for the server's (keepsLocal); a record started on this device
 *   after the reset is kept, stamped and uploaded. A generation change bumps `lessonMark` in the
 *   account key, so another tab's GET or PUT answer computed before it is repeated or dropped.
 * - Phase 5, save state on screen: getView() is a SaveView (saved, saving, loading, offline,
 *   stopped with a reason, local) with the count of this learner's unsaved records. A PUT 503
 *   from a server that sent capabilities is retried like a 500; three failures in a row show
 *   "stopped". networkChanged (online again: one GET or an early PUT, with jitter), retryNow (the
 *   notice's button) and storageChanged (another tab's markers). Logout is split in two:
 *   prepareSignOut uploads (≤ 3 s, also while a load or refresh runs) and counts what is left,
 *   then signOut clears without waiting again.
 *
 * Keys start with `rp:progressSync:` so the `rp:progress:` scans (ProgressCluster) skip them.
 * No React, DOM or import.meta, and explicit import extensions: storage, API, timers, clock and
 * events are injected, so server/tests/lessonProgressSync.test.js runs this file under node --test.
 * progressSyncClient.ts wires it to the browser.
 */
import { LESSON_STATES } from '../../shared/lesson/progress.js';
import { mergeProgress, progressContentEqual } from '../../shared/lesson/progressMerge.js';
import {
  LAST_LESSON_KEY,
  emptyProgress,
  keepsLocal,
  lessonGenOf,
  parseLastLesson,
  parseProgress,
  progressKey,
  sameLessonGen,
  setLastLesson,
  stampedRecord,
  withSummary,
} from './progressStore.ts';
import type { LessonGen, LessonProgress, LessonStateName, ProgressSummary, ServerGen } from './progressStore.ts';

export const SYNC_ACCOUNT_KEY = 'rp:progressSync:account';
export const SYNC_PENDING_PREFIX = 'rp:progressSync:pending:';
/** Fired on window when this tab changed the account (sign-in, reset, logout, delete). */
export const SYNC_ACCOUNT_EVENT = 'rp:progress-account';
/**
 * Fired on window when the server took lesson records from this tab (a PUT answered with them):
 * its post-save hook may have awarded XP or a learning day (the achievements store refetches).
 */
export const PROGRESS_SAVED_EVENT = 'rp:progress-saved';
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
 * written since, by someone else. lessonMark (Phase 5): changes whenever a tab changes a lesson's
 * generation here, so another tab's answer computed before it is repeated (GET) or dropped (PUT).
 * unsent (Phase 5, only with loggedOut): a session that ended without a logout (stop) marks every
 * record with activity as the learner's, also those the server already has; these are the
 * `<course>:<lesson>` of the records that were really unsent then (the sign-in view's count).
 * Without it every marker is an unsent record (a logout keeps only those).
 */
export type SyncAccount = { userId: string; epoch: SyncEpoch | '?'; loggedOut?: true; lessonMark?: string; unsent?: string[] };

/** At most this many entries in SyncAccount.unsent (more: the field is ignored). */
const MAX_UNSENT = 2_000;

/**
 * off: no primary session. needs_choice: waiting for the adoption choice. hydrating: GET running.
 * on: synced. offline: the GET failed (pending markers still accumulate). stopped: 401, 503 or
 * another learner took this browser over in another tab.
 */
export type SyncStatus = 'off' | 'needs_choice' | 'hydrating' | 'on' | 'offline' | 'stopped';
export type SyncState = { readonly status: SyncStatus; readonly userId: string | null };

export type SyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & { readonly length: number };

/** lessonEpoch / lessonResetAt (Phase 5): the lesson's generation; an older server sends neither. */
export type ServerRecord = {
  courseSlug: string;
  lessonId: string;
  progress: unknown;
  pct?: number;
  state?: string;
  updatedAt?: string;
  lessonEpoch?: string | null;
  lessonResetAt?: string | null;
};
/** lesson_reset rejections (Phase 5) carry the lesson's generation and the stored record, when there is one. */
export type RejectedRecord = {
  courseSlug: string | null;
  lessonId: string | null;
  error_type: string;
  lessonEpoch?: string | null;
  lessonResetAt?: string | null;
  record?: ServerRecord;
};
/** lessonEpoch: the generation the record's content builds on (null: unknown, born here, or never started over). */
export type PutBody = { epoch: SyncEpoch; records: { courseSlug: string; lessonId: string; progress: LessonProgress; lessonEpoch: string | null }[] };
/** What the server offers (GET capabilities, Phase 5; review: Phase 6); an older server sends none. */
export type SyncCapabilities = { lessonReset: boolean; achievements: boolean; review: boolean };

/** services/lessonProgressApi.ts. Failures throw an ApiFailure-shaped error. */
export type ProgressApi = {
  /** restarted: the account was deleted and opened again since its last reset (server GET, Phase 4). */
  get(): Promise<{ epoch: SyncEpoch; records: ServerRecord[]; restarted?: boolean; capabilities?: { lessonReset?: boolean; achievements?: boolean; review?: boolean } }>;
  put(body: PutBody, options: { keepalive: boolean }): Promise<{ epoch: SyncEpoch; records: ServerRecord[]; rejected: RejectedRecord[] }>;
  del(): Promise<{ deleted: number; epoch: string }>;
  /** POST …/lesson-reset (Phase 5). record: the lesson's emptied record (null when the answer had none). */
  resetLesson(body: { epoch: SyncEpoch; courseSlug: string; lessonId: string }): Promise<{ epoch: SyncEpoch; lessonEpoch: string; lessonResetAt: string | null; record: ServerRecord | null }>;
};
/** What the api functions throw: the HTTP status (0 = network) and the server's error_type. */
export type ApiFailure = { status?: number; errorType?: string; epoch?: SyncEpoch };

export type SyncTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};
/**
 * reset: the lesson was started over (its emptied record was stored): open readers restart.
 * echo: the server's answer to this tab's own PUT (a record it took, with no generation this tab
 * did not know), e.g. the first save of a lesson here stamping known(null): nothing another tab or
 * device reset or deleted (Phase 6: the review count does not read again for it).
 */
export type ServerProgressDetail = { courseSlug: string; lessonId: string; source: 'server'; reset?: true; echo?: true };
export type SyncEvents = {
  /** A server-sourced write of one lesson record (dispatch PROGRESS_EVENT with source 'server'). */
  progress?(detail: ServerProgressDetail): void;
  /** The account key changed in this tab (readers re-check it; course maps refresh). */
  account?(): void;
  /**
   * The server stored lesson records this tab sent (dispatch PROGRESS_SAVED_EVENT). A save that
   * changes nothing here emits no `progress` event, yet its hook may award XP ('done' 40).
   */
  saved?(): void;
};

export type DeleteResult = { ok: true; scope: 'account' | 'device' } | { ok: false };

/**
 * resetLesson (Phase 5). not_ready: sync is not on (offline, stopped, a load, needs_choice, no
 * API); unsupported: the server has no reset (no capability, or it answered 404); not_published:
 * not a lesson the server stores; reloaded: the progress was deleted on another device (loaded
 * again); unconfirmed: the connection dropped after sending; failed: nothing changed here.
 */
export type LessonResetResult =
  | { ok: true }
  | { ok: false; reason: 'not_ready' | 'unsupported' | 'not_published' | 'rate_limited' | 'failed' | 'unconfirmed' | 'reloaded' };

/** How the reader's save state looks (Phase 5, SaveChip and the notices). */
export type SaveState = 'saved' | 'saving' | 'loading' | 'offline' | 'stopped' | 'local';
/**
 * Why saving stopped. network/server: retrying with backoff (or the server cannot store
 * progress); auth: sign in again; account: another tab's logout or learner; storage: the account
 * key could not be stored.
 */
export type StopReason = 'network' | 'server' | 'auth' | 'account' | 'storage';
export type SaveView = Readonly<{
  state: SaveState;
  /** Set only when state is 'stopped'. */
  reason: StopReason | null;
  userId: string | null;
  /**
   * This learner's records here the server does not have yet: pending markers of syncable lessons
   * with a record, while the stored account's userId is this learner's (also when another tab
   * marked it loggedOut: what this tab writes still waits for them). 0 when userId is null.
   */
  pending: number;
  /** Consecutive failed PUTs (0 after a successful PUT or hydrate). */
  failures: number;
  /** A PUT, or a GET that is not a background refresh, is running. */
  busy: boolean;
  /** When the server last confirmed this learner's data on this page (successful GET or PUT); null before. */
  savedAt: number | null;
  /** The last navigator.onLine the client reported (true until told otherwise). */
  online: boolean;
}>;
/** Consecutive failed PUTs after which a view with pending records shows 'stopped' (about 1.5–2 min). */
export const STALL_AFTER_FAILURES = 3;
/** load: the page's first GET; retry: a stalled sync's next try; refresh: a background reload while on. */
export type HydrateMode = 'load' | 'retry' | 'refresh';
/** Inputs of saveViewOf (the core's private state). */
export type SaveViewInput = {
  status: SyncStatus;
  userId: string | null;
  apiEnabled: boolean;
  /** The mode of the running (or last) hydrate; null before the first. */
  hydrateMode: HydrateMode | null;
  /** The last failed GET (status 0: network); null after a successful one. */
  getFailure: { status: number; errorType?: string } | null;
  /** Why status is 'stopped'. */
  stopReason: StopReason | null;
  /** The last failed PUT that was retried with backoff. */
  putFailure: 'network' | 'server' | null;
  pending: number;
  failures: number;
  busy: boolean;
  savedAt: number | null;
  online: boolean;
};

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
  /** Phase 5: the save state (a new frozen object on every change). */
  getView(): SaveView;
  /** Called on every SaveView change (not on status changes alone). */
  subscribeView(listener: () => void): () => void;
  /**
   * navigator.onLine changed. Back online (at most once per 30 s, after 1–5 s of jitter): a
   * failed load is retried with one GET, a failing upload goes at once (the 20 s PUT spacing
   * still holds). 'stopped' is left alone.
   */
  networkChanged(online: boolean): void;
  /**
   * The notice's "try saving again": as networkChanged (a failing upload goes at once, the 20 s PUT
   * spacing still holds, so it may start up to 20 s later), and a server stop retries one GET (at
   * most one GET per 10 s). True when a request started or is scheduled: the notice says
   * 「保存しています…」 until it ends.
   */
  retryNow(): boolean;
  /** Another tab changed pending markers: recount. */
  storageChanged(): void;
  /**
   * Logout, step 1: upload what is pending (≤ 3 s in all, also while a load or refresh runs) and
   * count what is still unsaved. signOut() right after it does not wait again.
   */
  prepareSignOut(): Promise<{ unsaved: number }>;
  /** Phase 5: start one published lesson over (server first; local data only on success). */
  resetLesson(courseSlug: string, lessonId: string): Promise<LessonResetResult>;
  /** What the server offers, from this learner's last successful GET on this page; null before. */
  capabilities(): SyncCapabilities | null;
};

// --- Helpers shared with the reader -----------------------------------------------------------

export function parseSyncAccount(raw: string | null | undefined): SyncAccount | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const { userId, epoch, loggedOut, lessonMark, unsent } = data as { userId?: unknown; epoch?: unknown; loggedOut?: unknown; lessonMark?: unknown; unsent?: unknown };
    if (typeof userId !== 'string' || !userId) return null;
    const unsentOk = loggedOut === true && Array.isArray(unsent) && unsent.length <= MAX_UNSENT
      && unsent.every((entry) => typeof entry === 'string' && entry.length <= 2 * MAX_SLUG_LENGTH + 1);
    return {
      userId,
      epoch: epoch === null ? null : typeof epoch === 'string' && epoch ? epoch : '?',
      ...(loggedOut === true ? { loggedOut: true as const } : {}),
      ...(typeof lessonMark === 'string' && lessonMark && lessonMark.length <= 40 ? { lessonMark } : {}),
      ...(unsentOk ? { unsent: unsent as string[] } : {}),
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

// --- Phase 5: lesson generations ----------------------------------------------------------------

const GENERATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The generation a server answer (a record, a rejection) names: only when it has its own
 * `lessonEpoch` that is null or a uuid; resetAt when `lessonResetAt` parses as a date. null: this
 * answer says nothing about generations (an older server), so stamps stay and nothing is dropped.
 */
export function serverGenOf(value: unknown): ServerGen | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasOwn(value, 'lessonEpoch')) return null;
  const { lessonEpoch, lessonResetAt } = value as { lessonEpoch?: unknown; lessonResetAt?: unknown };
  if (!(lessonEpoch === null || (typeof lessonEpoch === 'string' && GENERATION_UUID.test(lessonEpoch)))) return null;
  const resetAt = typeof lessonResetAt === 'string' && Number.isFinite(Date.parse(lessonResetAt)) ? lessonResetAt : null;
  return { epoch: typeof lessonEpoch === 'string' ? lessonEpoch.toLowerCase() : null, resetAt };
}

/** The reader's stamp: born with bornAt null until its first write fixes the time. */
export type ReaderGen = LessonGen | { kind: 'born'; bornAt: null };

/** What a reader opened on this stored record (raw JSON) writes with. */
export function readerStartGen(raw: string | null): ReaderGen {
  const gen = lessonGenOf(raw);
  if (gen.kind !== 'unknown') return gen;
  if (raw === null || !hasActivity(parseProgress(raw))) return { kind: 'born', bornAt: null }; // nothing old to carry
  return gen; // legacy content
}

/**
 * How the stored record's stamp changed for an open reader. restart: drop the in-memory record
 * for the stored one. adopt: take the stored stamp and merge the stored record in. foreign: a
 * write took a known stamp of a lesson started over off (an old bundle, or a stale write of another
 * tab); overwrite it with the reader's own record (G22: it may hold content from before the reset).
 * merge: the same for a lesson never started over (known(null)): the other write is of the same
 * lesson, so it is merged into the reader's record and written back stamped; had the lesson been
 * reset meanwhile, the server refuses the null stamp and the sync drops the record (G10).
 * A born or legacy reader adopts a known stamp only where the core kept its record: the core's
 * rule (keepsLocal) and the content. A record of a newer generation that holds the same keys
 * (redone elsewhere) is not this reader's, and adopting it would merge answers from before the
 * reset back in. A clock running ahead passes keepsLocal but still restarts on a reset's emptied
 * record, which does not hold what the reader wrote (G31).
 */
export function readerGenChange(loaded: ReaderGen, raw: string | null, persisted: LessonProgress): 'none' | 'adopt' | 'restart' | 'foreign' | 'merge' {
  const stored = lessonGenOf(raw);
  if (stored.kind === 'known') {
    if (loaded.kind === 'known') return loaded.epoch === stored.epoch ? 'none' : 'restart';
    if (loaded.kind === 'born' && loaded.bornAt === null) return 'adopt'; // nothing written yet
    if (!keepsLocal(loaded, { epoch: stored.epoch, resetAt: stored.resetAt })) return 'restart'; // the core dropped it
    return readerCovers(parseProgress(raw), persisted) ? 'adopt' : 'restart'; // G31: an emptied record never covers
  }
  if (loaded.kind === 'known' && raw !== null) return loaded.epoch === null ? 'merge' : 'foreign';
  return 'none'; // as before Phase 5: the last writer wins
}

/**
 * Unsent lesson records this browser still holds for a learner who left it (the account is
 * loggedOut): pending markers whose record exists and still names the marker's updatedAt (what
 * they left), of lessons the server stores (`isSyncable`, when given), and, after a session that
 * ended without a logout, only those that were unsent then (SyncAccount.unsent). The sign-in
 * view's notice (LeftRecordsNotice). Never throws.
 */
export function leftRecordCount(storage: SyncStorage | null, isSyncable?: (courseSlug: string, lessonId: string) => boolean): number {
  if (!storage) return 0;
  try {
    const account = parseSyncAccount(storage.getItem(SYNC_ACCOUNT_KEY));
    if (!account?.loggedOut) return 0;
    const unsent = account.unsent ? new Set(account.unsent) : null;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(SYNC_PENDING_PREFIX)) keys.push(key);
    }
    let count = 0;
    for (const key of keys) {
      const ref = refOf(key, SYNC_PENDING_PREFIX);
      if (!ref || (unsent && !unsent.has(refKey(ref)))) continue;
      if (isSyncable && !isSyncable(ref.courseSlug, ref.lessonId)) continue;
      const raw = storage.getItem(progressKey(ref.courseSlug, ref.lessonId));
      if (raw !== null && storage.getItem(key) === parseProgress(raw).updatedAt) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

/** The save state, first match wins (design §4.1). Pure. */
export function saveViewOf(input: SaveViewInput): SaveView {
  const base = {
    userId: input.userId,
    pending: input.userId ? input.pending : 0,
    failures: input.failures,
    busy: input.busy,
    savedAt: input.savedAt,
    online: input.online,
  };
  const view = (state: SaveState, reason: StopReason | null = null): SaveView => Object.freeze({ state, reason, ...base });
  const { status } = input;
  if (status === 'off' || status === 'needs_choice' || !input.apiEnabled) return view('local');
  if (status === 'stopped') return view('stopped', input.stopReason ?? 'server');
  if (status === 'offline') {
    const failure = input.getFailure;
    const code = failure?.status ?? 0;
    // 401 and other 4xx will not recover with the network: sign in again, or the server refuses.
    if (failure && code !== 0 && code !== 429 && code < 500) {
      if (code === 401) return view('stopped', failure.errorType === 'session_changed' ? 'account' : 'auth');
      return view('stopped', 'server');
    }
    return view('offline');
  }
  if (base.pending > 0 && !input.online) return view('offline');
  if (status === 'hydrating' && input.hydrateMode !== 'refresh') return view('loading');
  if (base.pending > 0 && input.failures >= STALL_AFTER_FAILURES) return view('stopped', input.putFailure ?? 'server');
  if (base.pending > 0) return view('saving');
  return view('saved');
}

// --- Core -------------------------------------------------------------------------------------

type LessonRef = { courseSlug: string; lessonId: string };
/** lessonEpoch: what the PUT says the content builds on; sentGen: the stored stamp as it was read. */
type BatchItem = LessonRef & { progress: LessonProgress; sentAt: string; bytes: number; lessonEpoch: string | null; sentGen: LessonGen };
type FlushMode = 'scheduled' | 'all' | 'hide';
/** The account key as one flush read it (with the records); updated when this tab moves the mark itself. */
type FlushContext = { account: string | null };

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

/**
 * covers, and every self-rating too: the stored record holds all an open reader wrote. A record
 * the core kept merges the reader's ratings in; a new generation's record made elsewhere need not
 * hold them, and adopting it would bring ratings from before the reset back.
 */
function readerCovers(outer: LessonProgress, inner: LessonProgress): boolean {
  const ratings = outer.ratings ?? {};
  return covers(outer, inner) && Object.keys(inner.ratings ?? {}).every((key) => hasOwn(ratings, key));
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
  /** A lesson_reset rejection re-stamped a born record during this flush: it can go again now. */
  let restamped = false;
  let flushTimer: unknown = null;
  let firstChangeAt: number | null = null;
  let lastPutAt = Number.NEGATIVE_INFINITY;
  /** When the last GET was sent (refresh() waits SYNC_TIMING.refreshAfterMs after it). */
  let lastGetAt = Number.NEGATIVE_INFINITY;
  let retryAt = 0;
  let failures = 0;
  /** whenKnown() callers waiting for the GET that runs now. */
  let knownWaiters: Array<(result: 'known' | 'unknown') => void> = [];

  // Phase 5 state (save view, capabilities, generations, logout).
  /** From this learner's last successful GET on this page (null before; cleared when the learner changes). */
  let caps: SyncCapabilities | null = null;
  let hydrateMode: HydrateMode | null = null;
  let getFailure: SaveViewInput['getFailure'] = null;
  let stopReason: StopReason | null = null;
  let putFailure: SaveViewInput['putFailure'] = null;
  let savedAt: number | null = null;
  let online = true;
  let lastNetworkRetryAt = Number.NEGATIVE_INFINITY;
  let lastRetryNowAt = Number.NEGATIVE_INFINITY;
  let markCounter = 0;
  /** prepareSignOut ran at this generation: signOut() right after it does not wait again. */
  let prepared: { generation: number; at: number } | null = null;
  let view: SaveView = saveViewOf({
    status: 'off', userId: null, apiEnabled: true, hydrateMode: null, getFailure: null, stopReason: null,
    putFailure: null, pending: 0, failures: 0, busy: false, savedAt: null, online: true,
  });
  const viewListeners = new Set<() => void>();

  function notify(set: Set<() => void>): void {
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        // A broken listener must not stop the sync.
      }
    }
  }

  /** Recomputes the save view; listeners hear only a change of some field. */
  function updateView(): void {
    let apiOn = true;
    try {
      apiOn = apiEnabled();
    } catch {
      apiOn = false;
    }
    const next = saveViewOf({
      status: state.status,
      userId: state.userId,
      apiEnabled: apiOn,
      hydrateMode,
      getFailure,
      stopReason,
      putFailure,
      pending: countPending(),
      failures,
      busy: inFlight !== null || (hydration !== null && hydrateMode !== 'refresh'),
      savedAt,
      online,
    });
    const keys = Object.keys(next) as (keyof SaveView)[];
    if (keys.every((key) => next[key] === view[key])) return;
    view = next;
    notify(viewListeners);
  }

  /** The learner changed (or left): what this page knew about the last one goes. */
  function forgetLearnerState(): void {
    caps = null;
    savedAt = null;
    getFailure = null;
    stopReason = null;
    putFailure = null;
    prepared = null;
  }

  function setState(status: SyncStatus, userId: string | null = state.userId): void {
    if (state.status === status && state.userId === userId) return;
    const wasHydrating = state.status === 'hydrating';
    if (state.userId !== userId) forgetLearnerState();
    if (status !== 'stopped') stopReason = null;
    state = { status, userId };
    updateView();
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
  /**
   * Stores the account. A rewrite of the same learner and epoch keeps the stored lessonMark, so a
   * routine write (another tab's hydrate) does not look like a generation change.
   */
  function writeAccount(account: SyncAccount | null): void {
    if (account) {
      const stored = readAccount();
      const keep = !account.lessonMark && stored?.lessonMark && stored.userId === account.userId && stored.epoch === account.epoch
        ? { lessonMark: stored.lessonMark }
        : {};
      write(SYNC_ACCOUNT_KEY, JSON.stringify({ ...account, ...keep }));
    } else {
      remove(SYNC_ACCOUNT_KEY);
    }
    emitAccount();
  }

  /**
   * A lesson's generation changed here (a reset, or a generation this tab learned): a new
   * lessonMark in the account key, so another tab's GET still on its way is repeated and its PUT
   * answers are dropped and loaded again. Only on this learner's account. No account event.
   */
  function bumpLessonMark(): void {
    const userId = state.userId;
    const account = readAccount();
    if (!userId || !account || account.userId !== userId || account.loggedOut) return;
    markCounter += 1;
    const lessonMark = `${now().toString(36)}.${Math.floor(random() * 2 ** 31).toString(36)}.${markCounter.toString(36)}`.slice(0, 40);
    write(SYNC_ACCOUNT_KEY, JSON.stringify({ ...account, lessonMark }));
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

  /** SaveView.pending: this learner's marked, syncable records that exist (0 without a learner). */
  function countPending(): number {
    const userId = state.userId;
    if (!userId || readAccount()?.userId !== userId) return 0;
    let count = 0;
    for (const ref of pendingLessons()) {
      if (syncable(ref) && read(progressKey(ref.courseSlug, ref.lessonId)) !== null) count += 1;
    }
    return count;
  }

  const localGen = (ref: LessonRef): LessonGen => lessonGenOf(read(progressKey(ref.courseSlug, ref.lessonId)));

  /** The stored record goes (its content predates the lesson's generation), with its marker and "continue". */
  function dropLocal(ref: LessonRef): void {
    remove(progressKey(ref.courseSlug, ref.lessonId));
    removeMarker(ref);
    const last = parseLastLesson(read(LAST_LESSON_KEY));
    if (last && last.courseSlug === ref.courseSlug && last.lessonId === ref.lessonId) remove(LAST_LESSON_KEY);
  }

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
   * session end set its markers, and what was written since is not this learner's. unsent: the
   * records that were really unsent (stop() marks more), kept in the account for the count.
   */
  function leave(account: SyncAccount, unsent?: string[]): void {
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
    if (left) write(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: account.userId, epoch: account.epoch, loggedOut: true, ...(unsent ? { unsent } : {}) }));
    else remove(SYNC_ACCOUNT_KEY);
  }

  /**
   * Writes merge(server, stored local) with the server's pct/state, keeping the merged clocks,
   * and announces it as server data. Nothing is written when the stored record already says it.
   * gen (Phase 5): the server named the lesson's generation: the written record is stamped
   * known(gen), i.e. from now on it is that generation's content. Without gen the stored stamp
   * stays as it is. Returns true when it wrote a known non-null epoch the stored record did not
   * carry (a generation this tab learned: the caller bumps the lesson mark). echo: a record of
   * this tab's own PUT that the server took; the event says so (ServerProgressDetail) unless the
   * record brought a generation this tab learned (the lesson was started over elsewhere).
   */
  function takeIn(ref: LessonRef, server: LessonProgress, summary: ProgressSummary | null, gen?: ServerGen, options: { reset?: boolean; echo?: boolean } = {}): boolean {
    const key = progressKey(ref.courseSlug, ref.lessonId);
    const raw = read(key);
    const local = parseProgress(raw);
    const storedGen = lessonGenOf(raw);
    const nextGen: LessonGen = gen ? { kind: 'known', epoch: gen.epoch, resetAt: gen.resetAt } : storedGen;
    let next = mergeProgress(server, local);
    const keep = summary ?? local.summary ?? null;
    if (keep) next = withSummary(next, keep);
    if (raw !== null && sameStored(local, next) && sameLessonGen(storedGen, nextGen) && !options.reset) return false;
    if (!write(key, JSON.stringify(stampedRecord(next, nextGen)))) return false;
    const learnedGen = nextGen.kind === 'known' && nextGen.epoch !== null && !(storedGen.kind === 'known' && storedGen.epoch === nextGen.epoch);
    try {
      events.progress?.({
        courseSlug: ref.courseSlug,
        lessonId: ref.lessonId,
        source: 'server',
        ...(options.reset ? { reset: true as const } : {}),
        // A generation this tab did not know yet is a reset made elsewhere: not an echo.
        ...(options.echo && !learnedGen ? { echo: true as const } : {}),
      });
    } catch {
      // ignore
    }
    return learnedGen;
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
    hydrateMode = mode;
    setState('hydrating', userId);
    const run = hydrate(userId, gen, mode).catch((err: unknown) => {
      if (gen === generation) getFailed(mode, err);
    });
    hydration = run;
    updateView();
    void run.finally(() => {
      if (hydration === run) hydration = null;
      updateView();
    });
  }

  function getFailed(mode: HydrateMode, err: unknown): void {
    if (mode !== 'refresh') {
      const failure = (err ?? null) as ApiFailure | null;
      getFailure = { status: statusOf(err), ...(typeof failure?.errorType === 'string' ? { errorType: failure.errorType } : {}) };
      setState('offline');
      updateView();
      return;
    }
    setState('on');
    if (pendingLessons().length) scheduleFlush();
  }

  /** Status 'stopped' with its reason (the save view says why). */
  function stopWith(reason: StopReason): void {
    stopReason = reason;
    setState('stopped');
    updateView();
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
      getFailed(mode, null);
      return;
    }
    let result: Awaited<ReturnType<ProgressApi['get']>>;
    for (let pass = 1; ; pass += 1) {
      // Phase 5: a lessonMark another tab writes after a generation change also repeats the GET.
      const before = read(SYNC_ACCOUNT_KEY);
      try {
        result = await getWithRetry(gen, mode === 'load' ? SYNC_TIMING.getRetries : 0);
      } catch (err) {
        if (gen === generation) getFailed(mode, err);
        return;
      }
      if (gen !== generation || state.userId !== userId) return;
      // Another tab changed the account while the GET ran (a delete there, or its own hydrate): the
      // answer may predate a delete, and must not bring deleted records or the old epoch back.
      if (read(SYNC_ACCOUNT_KEY) === before || pass >= SYNC_TIMING.getPasses) break;
    }
    // What this server offers (Phase 5): only the reset control, XP, reviews (Phase 6) and the 503
    // rule depend on it.
    const offered = result.capabilities;
    caps = { lessonReset: offered?.lessonReset === true, achievements: offered?.achievements === true, review: offered?.review === true };
    getFailure = null;
    const account = readAccount();
    if (!account || account.userId !== userId || account.loggedOut) {
      // Another tab signed another learner in meanwhile, or signed this one out.
      stopWith('account');
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
      stopWith('storage');
      return;
    }
    savedAt = now();

    const server = new Map<string, LessonProgress>();
    let latest: { record: ServerRecord; at: number } | null = null;
    let learned = false;
    for (const record of result.records) {
      const ref = { courseSlug: record.courseSlug, lessonId: record.lessonId };
      if (!syncable(ref)) continue;
      const progress = parseProgress(record.progress);
      // Phase 5: a stored record whose content predates the lesson's generation goes first; a
      // kept one (same generation, born here after the reset, or legacy where no reset happened)
      // is merged into the server's record and stamped with its generation.
      const gen = serverGenOf(record);
      if (gen && read(progressKey(ref.courseSlug, ref.lessonId)) !== null && !keepsLocal(localGen(ref), gen)) dropLocal(ref);
      server.set(refKey(ref), progress);
      learned = takeIn(ref, progress, summaryOf(record), gen ?? undefined) || learned;
      // A lesson started over (emptied) never becomes "continue".
      if (record.state === 'not_started') continue;
      const at = Date.parse(record.updatedAt ?? progress.updatedAt);
      if (Number.isFinite(at) && (!latest || at > latest.at)) latest = { record, at };
    }
    if (learned) bumpLessonMark();
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
    failures = 0;
    setState('on');
    updateView();
    if (pendingLessons().length) await flush('all');
  }

  // --- Uploads ---

  /** soon: no debounce (a retry the learner or the network asked for); the PUT spacing and backoff still hold. */
  function scheduleFlush({ soon = false }: { soon?: boolean } = {}): void {
    if (state.status !== 'on') return;
    const t = now();
    if (firstChangeAt === null) firstChangeAt = t;
    const debounced = soon ? t : Math.min(t + SYNC_TIMING.flushDelayMs, firstChangeAt + SYNC_TIMING.flushMaxWaitMs);
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
      stopWith('account');
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
      // Phase 5: the generation the content builds on goes with it (an older server ignores it).
      const sentGen = lessonGenOf(raw);
      const lessonEpoch = sentGen.kind === 'known' ? sentGen.epoch : null;
      const bytes = JSON.stringify({ courseSlug: ref.courseSlug, lessonId: ref.lessonId, progress, lessonEpoch }).length + 1;
      items.push({ ...ref, progress, sentAt: record.updatedAt, bytes, lessonEpoch, sentGen });
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

  /** Returns true when it changed a lesson's generation here (the lesson mark moved). */
  function applyPutResult(batch: BatchItem[], result: Awaited<ReturnType<ProgressApi['put']>>): boolean {
    const returned = new Map<string, ServerRecord>();
    for (const record of result.records ?? []) returned.set(refKey(record), record);
    const rejected = new Map<string, RejectedRecord>();
    for (const item of result.rejected ?? []) rejected.set(`${item.courseSlug}:${item.lessonId}`, item);
    let learned = false;
    let refused = false;
    for (const item of batch) {
      const record = returned.get(refKey(item));
      if (record) {
        const server = parseProgress(record.progress);
        // A born or unknown record of a lesson never started over becomes known(null) here. The
        // stamp goes only on what was sent (or what that generation would keep anyway): an unstamped
        // write that landed meanwhile (an old bundle holding pre-reset content) keeps its own stamp,
        // so its next PUT is refused (lesson_reset) and dropped instead of saved as this generation.
        const gen = serverGenOf(record);
        const now = localGen(item);
        const stamp = gen && (sameLessonGen(now, item.sentGen) || keepsLocal(now, gen)) ? gen : undefined;
        learned = takeIn(item, server, summaryOf(record), stamp, { echo: true }) || learned;
        if (getMarker(item) === item.sentAt && covers(server, item.progress)) removeMarker(item);
        continue;
      }
      const rejection = rejected.get(refKey(item));
      const gen = rejection?.error_type === 'lesson_reset' ? serverGenOf(rejection) : null;
      if (rejection && gen) {
        // Phase 5: the lesson was started over since this content was made. Unless a newer write
        // came meanwhile (it goes again with its own stamp), the record follows the server.
        if (getMarker(item) !== item.sentAt || !sameLessonGen(localGen(item), item.sentGen)) continue;
        const stored = rejection.record ?? null;
        if (keepsLocal(localGen(item), gen)) {
          // Born on this device after the reset: all of it is new. Stamped, it goes again.
          learned = takeIn(item, stored ? parseProgress(stored.progress) : readRecord(item), stored ? summaryOf(stored) : null, gen) || learned;
          const stamp = localGen(item);
          if (stamp.kind !== 'known' || stamp.epoch !== gen.epoch) {
            // Storage refused the stamped record: sent again it would be refused again, forever.
            refused = true;
            continue;
          }
          setMarker(item, readRecord(item).updatedAt);
          flushAgain = true;
          restamped = true;
        } else {
          dropLocal(item);
          // The server's record of the new generation (an emptied one when it has none, e.g. after
          // a delete-all), so an open reader restarts instead of writing the old content again.
          learned = takeIn(item, stored ? parseProgress(stored.progress) : emptyProgress(), stored ? summaryOf(stored) : null, gen) || learned;
        }
        continue;
      }
      if (FINAL_REJECTIONS.has(rejection?.error_type ?? '')) {
        // Local stays as it is; a later change or hydrate offers it again.
        removeMarker(item);
      }
    }
    if (learned) bumpLessonMark();
    if (refused) stopWith('storage');
    return learned;
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
    if (status === 401) {
      // Until the next sign-in. session_changed: another learner's session (progressSyncClient.ts).
      clearFlushTimer();
      stopWith(failure.errorType === 'session_changed' ? 'account' : 'auth');
      return;
    }
    if (status === 503 && caps?.lessonReset !== true) {
      // A server without the Phase 5 tables, or an older one (Phase 2's rule): no lesson progress
      // on this server for this page load. A server that sent capabilities answers 503 only while
      // its database is briefly unreachable: retried with backoff below, like a 500.
      clearFlushTimer();
      stopWith('server');
      return;
    }
    if (status === 413 && batch.length === 1) {
      removeMarker(batch[0]);
      return;
    }
    failures += 1;
    putFailure = status === 0 ? 'network' : 'server';
    const backoff = Math.min(SYNC_TIMING.maxBackoffMs, SYNC_TIMING.minPutIntervalMs * 2 ** (failures - 1));
    retryAt = now() + backoff * (0.5 + random() * 0.5);
    scheduleFlush();
  }

  async function sendBatch(batch: BatchItem[], gen: number, keepaliveWanted: boolean, context: FlushContext): Promise<boolean> {
    const body: PutBody = {
      epoch: epoch ?? null,
      // Phase 5: always with the generation (null when unknown, born here or never started over).
      records: batch.map(({ courseSlug, lessonId, progress, lessonEpoch }) => ({ courseSlug, lessonId, progress, lessonEpoch })),
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
        stopWith('account');
        return false;
      }
      if (account.epoch !== (epoch ?? null)) {
        // Another tab deleted or reset the progress while this PUT ran: its answer may hold
        // deleted records. Drop it and load the server state again (local data stays as it is).
        rehydrate();
        return false;
      }
      if (read(SYNC_ACCOUNT_KEY) !== context.account) {
        // Another tab changed a lesson's generation meanwhile (lessonMark): this answer may hold a
        // record from before it. Drop it and load the server state again.
        rehydrate();
        return false;
      }
      failures = 0;
      retryAt = 0;
      putFailure = null;
      savedAt = now();
      if (applyPutResult(batch, result)) context.account = read(SYNC_ACCOUNT_KEY);
      if ((result.records ?? []).length > 0) {
        try {
          events.saved?.();
        } catch {
          // A broken listener must not stop the sync.
        }
      }
      // Stopped while taking the answer in (storage refused a record): no further batch.
      return state.status === 'on';
    } catch (err) {
      if (gen !== generation) return false;
      handlePutFailure(err, batch);
      return false;
    }
  }

  /**
   * scheduled: one batch (the timer keeps the 20 s spacing). all: every batch now (hydrate and
   * logout), and once more for records a lesson_reset re-stamped (born after the reset): the
   * logout question then counts only what really could not be saved. A second refusal drops
   * the record (its known stamp no longer passes keepsLocal), so this never loops. hide: one batch
   * now, keepalive when small.
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
      for (let pass = 0; pass < (mode === 'all' ? 2 : 1); pass += 1) {
        restamped = false;
        // Read with the records, in the same step: the lessonMark check in sendBatch compares with it.
        const context: FlushContext = { account: read(SYNC_ACCOUNT_KEY) };
        const batches = collectBatches();
        const toSend = mode === 'all' ? batches : batches.slice(0, 1);
        more = batches.length > toSend.length;
        for (const batch of toSend) {
          if (gen !== generation || !(await sendBatch(batch, gen, mode === 'hide', context))) {
            more = false;
            return;
          }
        }
        if (!restamped) return;
      }
    })();
    inFlight = run;
    updateView();
    try {
      await run;
    } finally {
      if (inFlight === run) inFlight = null;
      updateView();
    }
    if (state.status !== 'on') return;
    if (gen !== generation) {
      // Dropped (a reset, delete or reload meanwhile). A flush asked for since then waited for
      // this one: it goes now.
      if (flushAgain && !inFlight) {
        flushAgain = false;
        scheduleFlush();
      }
      return;
    }
    if (flushAgain || more) {
      flushAgain = false;
      scheduleFlush();
    }
  }

  function noteLocalWrite(courseSlug: string, lessonId: string): void {
    const userId = state.userId;
    if (!userId || state.status === 'needs_choice') return;
    const ref = { courseSlug, lessonId };
    const account = readAccount();
    if (!syncable(ref) || account?.userId !== userId) return;
    const raw = read(progressKey(courseSlug, lessonId));
    if (raw === null) return;
    setMarker(ref, parseProgress(raw).updatedAt);
    // Another tab ended this learner's session (stop) before this one heard of it: what this tab
    // writes meanwhile is unsent too, so the sign-in view counts it.
    if (account.loggedOut && account.unsent && !account.unsent.includes(refKey(ref)) && account.unsent.length < MAX_UNSENT) {
      write(SYNC_ACCOUNT_KEY, JSON.stringify({ ...account, unsent: [...account.unsent, refKey(ref)] }));
    }
    scheduleFlush();
    updateView();
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

  /**
   * The last upload before a logout, ≤ 3 s in all. A stalled sync (the GET failed, or a 401/503
   * stopped uploads) tries once more while the session is still valid; a load, retry or refresh
   * that runs now is waited for: each ends with the upload of what is pending (Phase 5: before,
   * a logout during a load sent nothing).
   */
  async function waitForUploads(): Promise<void> {
    const userId = state.userId;
    let timer: unknown = null;
    const deadline = new Promise<void>((resolve) => {
      timer = timers.setTimeout(resolve, SYNC_TIMING.logoutFlushMs);
    });
    try {
      const account = readAccount();
      if (stalled() && account?.userId === userId && !account.loggedOut) rehydrate();
      if (hydration) await Promise.race([hydration, deadline]);
      else if (state.status === 'on') await Promise.race([flush('all'), deadline]);
    } finally {
      timers.clearTimeout(timer);
    }
  }

  async function prepareSignOut(): Promise<{ unsaved: number }> {
    const userId = state.userId;
    try {
      if (!userId || state.status === 'needs_choice' || !apiEnabled()) return { unsaved: 0 };
      await waitForUploads();
      prepared = { generation, at: now() };
      updateView();
      return { unsaved: state.userId === userId ? countPending() : 0 };
    } catch {
      return { unsaved: 0 };
    }
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
      // prepareSignOut just waited (nothing reloaded since): the learner never waits twice.
      const fresh = prepared && prepared.generation === generation && now() - prepared.at <= 15_000;
      prepared = null;
      if (!fresh) await waitForUploads();
      stopActivity();
      clearLocal({ keepPending: true, learningEvents: true });
      const stored = readAccount();
      if (stored?.userId === userId) leave(stored);
    } catch {
      // Storage trouble: nothing more to clear.
    }
    epoch = undefined;
    setState('off', null);
    updateView();
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
        // What was really unsent before the markers below (the sign-in view counts only these).
        const unsent = pendingLessons()
          .filter((ref) => read(progressKey(ref.courseSlug, ref.lessonId)) !== null)
          .map(refKey)
          .slice(0, MAX_UNSENT);
        for (const ref of localLessons()) {
          const progress = readRecord(ref);
          if (hasActivity(progress)) setMarker(ref, progress.updatedAt);
        }
        leave(account, unsent);
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
    updateView();
    return { ok: true, scope: 'account' };
  }

  /**
   * Phase 5: starts one published lesson over. The server first (POST …/lesson-reset, its own
   * transaction); only on success this browser drops the lesson's record, marker and "continue"
   * and stores the emptied record stamped with the new generation (PROGRESS_EVENT reset: open
   * readers restart). Answers still on their way in this tab are dropped; other tabs repeat or
   * drop theirs (lessonMark); other devices drop their copy at their next load or save.
   */
  async function resetLesson(courseSlug: string, lessonId: string): Promise<LessonResetResult> {
    const userId = state.userId;
    const ref = { courseSlug, lessonId };
    let apiOn = false;
    try {
      apiOn = apiEnabled();
    } catch {
      apiOn = false;
    }
    const ready = state.status === 'on' || (state.status === 'hydrating' && hydrateMode === 'refresh');
    // The browser is offline: nothing is sent (the control is disabled then; a dialog opened before
    // the connection dropped gets 'not connected', not 'unconfirmed').
    if (!userId || !ready || !online || epoch === undefined || !apiOn) return { ok: false, reason: 'not_ready' };
    if (caps?.lessonReset !== true) return { ok: false, reason: 'unsupported' };
    if (!syncable(ref)) return { ok: false, reason: 'not_published' };
    let result: Awaited<ReturnType<ProgressApi['resetLesson']>>;
    try {
      result = await api.resetLesson({ epoch: epoch ?? null, courseSlug, lessonId });
    } catch (err) {
      const status = statusOf(err);
      const failure = (err ?? {}) as ApiFailure;
      if (status === 404 && !failure.errorType) {
        // An older server: no such route. The control stays hidden for this page load.
        if (state.userId === userId && caps) caps = { ...caps, lessonReset: false };
        updateView();
        return { ok: false, reason: 'unsupported' };
      }
      if (status === 409 && failure.errorType === 'progress_reset') {
        if (state.userId === userId) resetTo(failure.epoch ?? null);
        return { ok: false, reason: 'reloaded' };
      }
      if (failure.errorType === 'unknown_lesson') return { ok: false, reason: 'not_published' };
      if (status === 429) return { ok: false, reason: 'rate_limited' };
      if (status === 0 && failure.errorType === 'network') return { ok: false, reason: 'unconfirmed' };
      // A 2xx the client could not read: the server did start the lesson over. The next load
      // drops the old record here (its stamp is of the old generation).
      if (status >= 200 && status < 300) return { ok: false, reason: 'unconfirmed' };
      return { ok: false, reason: 'failed' };
    }
    if (state.userId !== userId) return { ok: true };
    const was = state.status;
    // An answer still on its way in this tab (GET or PUT) may hold the old record: dropped.
    stopActivity();
    dropLocal(ref);
    takeIn(ref, result.record ? parseProgress(result.record.progress) : emptyProgress(), result.record ? summaryOf(result.record) : null,
      { epoch: result.lessonEpoch.toLowerCase(), resetAt: result.lessonResetAt }, { reset: true });
    // Another tab's answer still on its way is repeated (GET) or dropped (PUT).
    bumpLessonMark();
    // A background refresh was running (the only hydrate a reset waits for): it runs again. The
    // account epoch stays known, so a failure leaves sync on and uploading, as a refresh does.
    if (was === 'hydrating') startHydrate(userId, 'refresh');
    else if (pendingLessons().length) scheduleFlush();
    updateView();
    return { ok: true };
  }

  /**
   * Back online (or the notice's button): one GET for a failed load, an early PUT for failing
   * uploads. True when a request started (GET) or is scheduled (PUT).
   */
  function retryAfterOutage(fromButton: boolean): boolean {
    const userId = state.userId;
    if (!userId) return false;
    const account = readAccount();
    const mine = account?.userId === userId && !account.loggedOut;
    if (state.status === 'offline' || (fromButton && state.status === 'stopped' && stopReason === 'server')) {
      // A 401 or another learner's session is not a network problem: session events restart them.
      if (!mine) return false;
      if (fromButton) {
        // A GET has no spacing of its own: the button sends at most one per 10 s.
        const t = now();
        if (t - lastRetryNowAt < 10_000) return false;
        lastRetryNowAt = t;
      }
      stopActivity();
      epoch = undefined;
      startHydrate(userId, 'retry');
      return true;
    }
    if (state.status === 'on' && failures > 0) {
      // The PUT keeps its 20 s spacing (no throttle needed: pressing again only reschedules it).
      retryAt = 0;
      scheduleFlush({ soon: true });
      return flushTimer !== null;
    }
    return false;
  }

  function networkChanged(next: boolean): void {
    const was = online;
    online = next === true;
    updateView();
    if (!online || was) return;
    const t = now();
    if (t - lastNetworkRetryAt < 30_000) return;
    lastNetworkRetryAt = t;
    // A classroom coming back online at once: spread over 1–5 s.
    const gen = generation;
    timers.setTimeout(() => {
      if (gen === generation) retryAfterOutage(false);
    }, 1_000 + random() * 4_000);
  }

  function retryNow(): boolean {
    return retryAfterOutage(true);
  }

  function storageChanged(): void {
    updateView();
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
    updateView();
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
    getView: () => view,
    subscribeView(listener) {
      viewListeners.add(listener);
      return () => {
        viewListeners.delete(listener);
      };
    },
    networkChanged,
    retryNow,
    storageChanged,
    prepareSignOut,
    resetLesson,
    capabilities: () => caps,
  };
}
