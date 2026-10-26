/**
 * XP, level, streak and badges in the browser (Phase 5, doc/brushup-2026/ai-access-plan.ja.md §9):
 * one memory-only store per page (no storage key) over GET /api/v2/user/achievements
 * (services/achievementsApi.ts). The server counts everything from its own records; the browser
 * computes no XP. useAchievements() is read by ProgressCluster, ProfilePassport and the badges page.
 *
 * - no_account: no synced learner (guests, Nexloom-only, signed out): no request, no retry.
 * - Only for the learner the lesson sync runs for: the request goes through runAsSyncedLearner
 *   (the primary session must be theirs), and an answer whose learnerId is not the synced learner
 *   at answer time is dropped and fetched once more.
 * - unsupported: the sync's GET said the server has no achievements (capabilities), or the route
 *   answered 404 without error_type (an older server: latched for this page load, which also
 *   spares its AI limiter). While the sync's GET has not succeeded yet, one background probe per
 *   page load; the "try again" button may probe again (an older VM's 404 is latched before that).
 *   A capability that turns off while the page is open (a rollback) clears what was shown.
 * - When it fetches: a consumer mounts and there is no data for this learner or it is older than
 *   30 s; a server-sourced lesson record arrives, or the server took this tab's lesson records
 *   (PROGRESS_SAVED_EVENT: an ordinary save changes nothing here, yet its hook may award XP),
 *   while a consumer is mounted (trailing 2 s, at most every 15 s: the post-save hook commits
 *   first; without a consumer the data is marked stale); ACHIEVEMENTS_STALE_EVENT (a Blender stage
 *   was saved); reloadAchievements (the "try again" button); the sync's capabilities become known,
 *   or start offering achievements.
 *   Never on focus. One request at a time (a request asked for meanwhile runs once after it).
 * - Errors (401, network, 5xx, a malformed answer): 'unavailable' when there is nothing to show;
 *   data of the same learner is kept and shown (status stays 'ready').
 * - The learner changes (SYNC_ACCOUNT_EVENT, the sync's state): cleared only on a real change.
 *
 * Phase 6: the same store serves the review queue (components/review/reviewClient.ts): the data
 * type is a parameter (any answer that names its learnerId) and capabilityKey picks which
 * capability of the sync's GET gates the requests ('achievements' by default, or 'review').
 */
import { useEffect, useSyncExternalStore } from 'react';
import { ACHIEVEMENTS_STALE_EVENT, getAchievements, type Achievements } from '../../services/achievementsApi';
import { PROGRESS_EVENT, type ProgressEventDetail } from '../lesson/progressStore.ts';
import { PROGRESS_SAVED_EVENT, SYNC_ACCOUNT_EVENT, type SyncCapabilities } from '../lesson/progressSync.ts';
import {
  progressCapabilities,
  runAsSyncedLearner,
  subscribeProgressSaveView,
  syncedLearnerId,
} from '../lesson/progressSyncClient';

export type AchievementsStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'unsupported' | 'no_account';
export type AchievementsSnapshot<T extends { learnerId: string } = Achievements> = Readonly<{
  status: AchievementsStatus;
  /** The learner `data` belongs to (lower case), or null. */
  learnerId: string | null;
  data: T | null;
  /** When `data` was received (store clock); null without data or after it was marked stale. */
  at: number | null;
}>;

export const ACHIEVEMENTS_FRESH_MS = 30_000;
export const ACHIEVEMENTS_DEBOUNCE_MS = 2_000;
export const ACHIEVEMENTS_MIN_INTERVAL_MS = 15_000;

/** The capability of the sync's GET that gates a store's requests (Phase 6 adds 'review'). */
export type StoreCapabilityKey = 'achievements' | 'review';

export type AchievementsDeps<T extends { learnerId: string } = Achievements> = {
  load: () => Promise<T>;
  learnerId: () => string | null;
  /** What the sync's GET said the server offers; only `capabilityKey` is read. */
  capabilities: () => Partial<Pick<SyncCapabilities, StoreCapabilityKey>> | null;
  /** Which capability gates the requests (default 'achievements'). */
  capabilityKey?: StoreCapabilityKey;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type AchievementsStore<T extends { learnerId: string } = Achievements> = {
  getSnapshot(): AchievementsSnapshot<T>;
  subscribe(listener: () => void): () => void;
  /** A consumer mounted (fetches when needed); the returned function unmounts it. */
  consumerMounted(): () => void;
  /** A server-sourced lesson record was stored (PROGRESS_EVENT source 'server'), or the server took this tab's records (PROGRESS_SAVED_EVENT). */
  serverProgress(): void;
  /** Something the server counts changed (ACHIEVEMENTS_STALE_EVENT). */
  stale(): void;
  /** The sync's learner or state changed. */
  syncChanged(): void;
  /** The "try again" button. */
  reload(): Promise<void>;
  /** Resolves when no request is running (tests). */
  settled(): Promise<void>;
};

/** Holds no data, so it is a snapshot of any store. */
const INITIAL = Object.freeze({ status: 'idle', learnerId: null, data: null, at: null }) as AchievementsSnapshot<never>;

const canonical = (id: string | null) => (id ? id.toLowerCase() : null);

export function createAchievementsStore<T extends { learnerId: string } = Achievements>(deps: AchievementsDeps<T>): AchievementsStore<T> {
  const now = deps.now ?? (() => Date.now());
  const capabilityKey: StoreCapabilityKey = deps.capabilityKey ?? 'achievements';
  const setTimer = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let snap: AchievementsSnapshot<T> = INITIAL;
  const listeners = new Set<() => void>();
  let consumers = 0;
  let inFlight: Promise<void> | null = null;
  let again = false;
  /** The request asked for meanwhile is the learner's "try again" (it may probe again). */
  let againExplicit = false;
  /** A 404 without error_type this page load: the route does not exist here. */
  let latched = false;
  /** A request went out while the sync did not know the capabilities yet. */
  let probed = false;
  /** The route answered 200 on this page. */
  let routeSeen = false;
  /** What the sync's capabilities said at the last syncChanged: unknown, the capability off, or on. */
  let capsSeen: 'unknown' | 'off' | 'on' = 'unknown';
  let debounce: unknown = null;
  let lastServerFetchAt = Number.NEGATIVE_INFINITY;

  const learner = () => {
    try {
      return canonical(deps.learnerId());
    } catch {
      return null;
    }
  };
  const caps = () => {
    try {
      return deps.capabilities();
    } catch {
      return null;
    }
  };

  function set(patch: Partial<AchievementsSnapshot<T>>): void {
    const next = { ...snap, ...patch };
    if (next.status === snap.status && next.learnerId === snap.learnerId && next.data === snap.data && next.at === snap.at) return;
    snap = Object.freeze(next);
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }

  /** What a request would meet now: go, or the status to show without one. */
  function gate(): 'go' | 'wait' | 'no_account' | 'unsupported' {
    if (!learner()) return 'no_account';
    if (latched) return 'unsupported';
    const offered = caps();
    if (offered && offered[capabilityKey] !== true) return 'unsupported';
    if (!offered && probed && !routeSeen) return 'wait'; // one probe per page load until the sync knows
    return 'go';
  }

  async function request(): Promise<void> {
    const id = learner();
    if (!caps()) probed = true;
    if (snap.learnerId !== id) set({ status: 'loading', learnerId: id, data: null, at: null });
    else if (!snap.data) set({ status: 'loading' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await deps.load();
        routeSeen = true;
        const current = learner();
        if (!current) {
          set({ status: 'no_account', learnerId: null, data: null, at: null });
          return;
        }
        if (canonical(data.learnerId) !== current) continue; // another learner meanwhile: once more
        set({ status: 'ready', learnerId: current, data, at: now() });
        return;
      } catch (err) {
        const failure = (err ?? {}) as { status?: unknown; errorType?: unknown };
        if (failure.status === 404 && !failure.errorType) {
          latched = true;
          set({ status: 'unsupported', learnerId: learner(), data: null, at: null });
          return;
        }
        const current = learner();
        if (!current) set({ status: 'no_account', learnerId: null, data: null, at: null });
        else if (snap.data && snap.learnerId === current) set({ status: 'ready' });
        else set({ status: 'unavailable', learnerId: current, data: null, at: null });
        return;
      }
    }
    // Still another learner's answer: nothing to show for this one.
    const current = learner();
    if (!(snap.data && snap.learnerId === current)) set({ status: current ? 'unavailable' : 'no_account', learnerId: current, data: null, at: null });
  }

  /** explicit: the "try again" button, which may probe again while the capabilities are unknown. */
  function fetchNow(explicit = false): Promise<void> {
    if (inFlight) {
      again = true;
      if (explicit) againExplicit = true;
      return inFlight;
    }
    const verdict = gate();
    if (verdict === 'no_account') {
      set({ status: 'no_account', learnerId: null, data: null, at: null });
      return Promise.resolve();
    }
    if (verdict === 'unsupported') {
      // For this learner: syncChanged must not read it as a learner change (a flip on every save).
      set({ status: 'unsupported', learnerId: learner(), data: null, at: null });
      return Promise.resolve();
    }
    if (verdict === 'wait' && !explicit) return Promise.resolve();
    const run = request().finally(() => {
      if (inFlight === run) inFlight = null;
      if (again) {
        const repeatExplicit = againExplicit;
        again = false;
        againExplicit = false;
        void fetchNow(repeatExplicit);
      }
    });
    inFlight = run;
    return run;
  }

  const fresh = () => snap.status === 'ready' && snap.learnerId === learner() && snap.at !== null && now() - snap.at < ACHIEVEMENTS_FRESH_MS;

  function clearDebounce(): void {
    if (debounce !== null) clearTimer(debounce);
    debounce = null;
  }

  return {
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    consumerMounted() {
      consumers += 1;
      if (!fresh()) void fetchNow();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        consumers -= 1;
        if (consumers === 0) clearDebounce();
      };
    },
    serverProgress() {
      if (consumers === 0) {
        if (snap.at !== null) set({ at: null }); // the next consumer fetches
        return;
      }
      clearDebounce();
      const t = now();
      const due = Math.max(t + ACHIEVEMENTS_DEBOUNCE_MS, lastServerFetchAt + ACHIEVEMENTS_MIN_INTERVAL_MS);
      debounce = setTimer(() => {
        debounce = null;
        lastServerFetchAt = now();
        void fetchNow();
      }, due - t);
    },
    stale() {
      if (consumers > 0) void fetchNow();
      else if (snap.at !== null) set({ at: null });
    },
    syncChanged() {
      const id = learner();
      const offered = caps();
      const seen = offered === null ? 'unknown' : offered[capabilityKey] === true ? 'on' : 'off';
      // The capabilities became known, or the server now offers the capability (an upgraded VM).
      const capsArrived = (seen !== 'unknown' && capsSeen === 'unknown') || (seen === 'on' && capsSeen === 'off');
      // The server stopped offering it (a rollback to an older image while this page is open).
      const capsWithdrawn = seen === 'off' && capsSeen === 'on';
      capsSeen = seen;
      if (capsWithdrawn && id) {
        clearDebounce();
        set({ status: 'unsupported', learnerId: id, data: null, at: null });
        return;
      }
      if (snap.learnerId !== id && (snap.data || snap.status !== 'idle')) {
        // Another learner (or none): what was shown goes.
        clearDebounce();
        set(id ? { status: 'idle', learnerId: null, data: null, at: null } : { status: 'no_account', learnerId: null, data: null, at: null });
        if (consumers > 0 && id) void fetchNow();
        return;
      }
      if (consumers > 0 && id && (capsArrived || snap.status === 'idle' || snap.status === 'no_account')) {
        if (!(snap.status === 'ready' && fresh() && !capsArrived)) void fetchNow();
      }
    },
    reload() {
      return fetchNow(true);
    },
    async settled() {
      for (let i = 0; i < 10 && inFlight; i += 1) await inFlight;
    },
  };
}

// --- The page's store ---------------------------------------------------------------------------

/** The window events the page's store follows (exported for tests). */
export function listenForAchievementChanges(s: AchievementsStore<Achievements>, target: Pick<Window, 'addEventListener'>): void {
  target.addEventListener(PROGRESS_EVENT, (event) => {
    const detail = (event as CustomEvent<ProgressEventDetail | undefined>).detail;
    if (detail?.source === 'server') s.serverProgress();
  });
  target.addEventListener(PROGRESS_SAVED_EVENT, () => s.serverProgress());
  target.addEventListener(ACHIEVEMENTS_STALE_EVENT, () => s.stale());
  target.addEventListener(SYNC_ACCOUNT_EVENT, () => s.syncChanged());
}

let store: AchievementsStore<Achievements> | null = null;

function pageStore(): AchievementsStore<Achievements> {
  if (store) return store;
  const created = createAchievementsStore({
    load: () => runAsSyncedLearner(getAchievements),
    learnerId: syncedLearnerId,
    capabilities: progressCapabilities,
  });
  store = created;
  if (typeof window !== 'undefined') {
    listenForAchievementChanges(created, window);
    subscribeProgressSaveView(() => created.syncChanged());
  }
  return created;
}

const subscribe = (listener: () => void) => pageStore().subscribe(listener);
const snapshot = () => pageStore().getSnapshot();
const serverSnapshot = (): AchievementsSnapshot<Achievements> => INITIAL;

/** The learner's XP, streak and badges from the server, and how far loading got. */
export function useAchievements(): AchievementsSnapshot<Achievements> {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => pageStore().consumerMounted(), []);
  return value;
}

/** The "try again" button. */
export function reloadAchievements(): Promise<void> {
  return pageStore().reload();
}
