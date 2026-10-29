/**
 * Whether the signed-in learner has accepted the current terms (Phase 4, design §4.2–§4.3): an
 * external store read with useSyncExternalStore (as components/lesson/progressSyncClient.ts).
 * App.tsx tells it who is signed in (syncLegalGate) and shows LegalConsentView instead of the app
 * while the state is `needed`; the Layout shows LegalNoticeBar.
 *
 * States:
 *   off          the flag is off (VITE_FEATURE_LEGAL_PAGES), nobody or a guest is signed in, or the
 *                session is not the primary Supabase one (a Nexloom-only session, a mock login):
 *                apiFetch sends only the primary token, so the server cannot record anything.
 *   loading      the status is being read. Never blocks.
 *   accepted     the latest acceptance counts; `notice` lists changed documents the person has not
 *                dismissed yet (a privacy change, an editorial terms change).
 *   needed       the latest acceptance misses a version that requires acceptance (or there is
 *                none). The only state that blocks, and only on pages outside LEGAL_GATE_EXEMPT.
 *   unavailable  a network error, 404 (the front runs against an older api for a while after a
 *                merge: design §3 deploy order), 5xx, 401 for another reason, the server's current
 *                versions differ from this bundle's (deploy skew), or the primary session could not
 *                be read (getSession failed). Never blocks; retried on focus and after 60 s; one
 *                console.warn per page.
 *
 * Recording after sign-up (§4.2): when the server says "not accepted" and this device has a sign-up
 * marker (services/legalConsentApi.ts) for the session's email and the current versions, the
 * acceptance is posted at once, without asking again; any other marker is removed and the page asks.
 * A marker whose POST fails for a network reason stays for the next try (the person did tick the
 * box; only the recording is late).
 *
 * The notice bar's dismissal is kept per account and version in localStorage (NOTICE_SEEN_KEY,
 * entries `<account id>:<version>`, the last NOTICE_SEEN_MAX): on a tablet children share, one
 * learner's "Close" never hides the bar for another. Blocked storage only shows the bar again.
 *
 * A 409 legal_version_mismatch to "Agree and continue" means the api has other versions than this
 * page (deploy skew; the page always posts its own versions): the page stays and offers a reload,
 * which loads the new texts. Another status read would only answer `unavailable` and drop it.
 *
 * After a successful "Agree and continue" the consent page is replaced by the app: the gate keeps a
 * one-shot hint (takeFocusAfterAccept) so the notice bar, which mounts in the Layout's main, moves
 * focus there instead of leaving it on the document body.
 *
 * Phase 8: each acceptance this page recorded (that button, or the sign-up marker) is announced
 * once with LEGAL_ACCEPTED_EVENT (./legalEvents.ts): with the server's terms check on, the XP and
 * review reads that raced it may have been refused (terms_required), and those stores read again.
 */
import { useSyncExternalStore } from 'react';
import { currentLegalVersions } from '../../shared/legal/versions.js';
import { getSupabaseClient } from '../../services/supabaseClient';
import { LEGAL_ACCEPTED_EVENT } from './legalEvents';
import {
  forgetSignupAcceptance,
  getLegalStatus,
  hashEmail,
  postLegalAcceptance,
  readSignupAcceptance,
  type AcceptanceResult,
  type LegalLastAccepted,
  type LegalNotice,
  type LegalStatusResult,
  type LegalVersions,
  type SignupAcceptance,
} from '../../services/legalConsentApi';

export const NOTICE_SEEN_KEY = 'rp:legal:noticeSeen';
/** Dismissals kept (several children may share a device; dropping an old one only shows a bar again). */
export const NOTICE_SEEN_MAX = 50;
/** An unavailable status is read again after this long (and when the window gets focus). */
export const LEGAL_RETRY_MS = 60_000;

export type LegalGateStatus = 'off' | 'loading' | 'accepted' | 'needed' | 'unavailable';
export type LegalGateState = {
  status: LegalGateStatus;
  /** Changed documents not dismissed yet (only while accepted). */
  notice: LegalNotice[];
  /** The latest acceptance (while needed: a terms change, not a first time). */
  lastAccepted: LegalLastAccepted | null;
};
export type LegalGateUser = { id: string; email: string; isGuest: boolean } | null;
export type AcceptOutcome = 'accepted' | 'version_mismatch' | 'account_deleted' | 'failed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Timer = ReturnType<typeof setTimeout>;

export type LegalGateDeps = {
  enabled: boolean;
  current: LegalVersions;
  getStatus: () => Promise<LegalStatusResult>;
  postAcceptance: (versions: LegalVersions) => Promise<AcceptanceResult>;
  /**
   * The primary Supabase session's user, or null when that client has no session (a Nexloom-only
   * login, a mock one). Throws when the session could not be read (getSession failed, e.g. a token
   * refresh offline): the gate is then `unavailable` and asks again, never `off` for good.
   */
  primarySession: () => Promise<{ userId: string; email: string | null } | null>;
  storage: () => StorageLike | null;
  hashEmail: (email: string) => Promise<string | null>;
  readMarker: (storage: StorageLike | null, now: number) => SignupAcceptance | null;
  forgetMarker: (storage: StorageLike | null) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => Timer;
  clearTimer: (timer: Timer) => void;
  warn: (message: string) => void;
  retryMs?: number;
  /**
   * Called once per acceptance this page recorded (accept(), the sign-up marker), never for a
   * status read that answers "accepted". The page's gate sends LEGAL_ACCEPTED_EVENT (Phase 8).
   */
  announceAccepted?: () => void;
};

export const OFF_STATE: LegalGateState = Object.freeze({ status: 'off', notice: [], lastAccepted: null }) as LegalGateState;

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A dismissal entry: the account and the version (one learner's "Close" is not another's). */
export const seenNoticeEntry = (userId: string, version: string) => `${userId.toLowerCase()}:${version}`;

/** Dismissal entries on this device (seenNoticeEntry). */
export function readSeenNotices(storage: StorageLike | null): Set<string> {
  try {
    const raw = storage?.getItem(NOTICE_SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function rememberSeenNotice(storage: StorageLike | null, entry: string): void {
  try {
    const seen = readSeenNotices(storage);
    seen.delete(entry);
    seen.add(entry);
    storage?.setItem(NOTICE_SEEN_KEY, JSON.stringify([...seen].slice(-NOTICE_SEEN_MAX)));
  } catch {
    // Blocked storage: the bar comes back on the next load.
  }
}

export function createLegalGate(deps: LegalGateDeps) {
  const retryMs = deps.retryMs ?? LEGAL_RETRY_MS;
  let state: LegalGateState = OFF_STATE;
  let user: LegalGateUser = null;
  /** Bumped whenever the user changes or a load starts: answers of an older run are dropped. */
  let run = 0;
  let retry: Timer | null = null;
  let warned = false;
  /** Set by a successful accept(); read once by the notice bar in the Layout (focus). */
  let focusAfterAccept = false;
  const listeners = new Set<() => void>();

  const set = (next: LegalGateState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const announce = () => {
    try {
      deps.announceAccepted?.();
    } catch {
      // Only a hint for the stores (they read again on their next mount anyway).
    }
  };
  const cancelRetry = () => {
    if (retry !== null) deps.clearTimer(retry);
    retry = null;
  };
  const unseen = (notice: LegalNotice[], userId: string) => {
    const seen = readSeenNotices(deps.storage());
    return notice.filter((n) => !seen.has(seenNoticeEntry(userId, n.version)));
  };
  const unavailable = (why: string) => {
    if (!warned) {
      warned = true;
      deps.warn(`[legal] the terms status is not available (${why}); the app stays open and asks again later`);
    }
    set({ status: 'unavailable', notice: [], lastAccepted: null });
    cancelRetry();
    retry = deps.setTimer(() => {
      retry = null;
      void load();
    }, retryMs);
  };

  async function load(): Promise<void> {
    const me = user;
    if (!deps.enabled || !me || me.isGuest) return set(OFF_STATE);
    const mine = ++run;
    const stale = () => mine !== run;
    cancelRetry();
    if (state.status === 'off' || state.status === 'unavailable') set({ status: 'loading', notice: [], lastAccepted: null });

    let session: Awaited<ReturnType<LegalGateDeps['primarySession']>> = null;
    try {
      session = await deps.primarySession();
    } catch {
      // Not read (yet): App.tsx calls setUser again only when the person changes, so `off` here
      // would never be checked again on this page. Retried after 60 s and on focus.
      if (stale()) return;
      return unavailable('no session yet');
    }
    if (stale()) return;
    // No primary session (Nexloom-only, mock) or someone else's: the server cannot record anything.
    if (!session || !sameId(session.userId, me.id)) return set(OFF_STATE);

    const result = await deps.getStatus();
    if (stale()) return;
    if (result.kind === 'account_deleted') return unavailable('account deleted');
    if (result.kind !== 'ok') return unavailable('no answer');
    const { status } = result;
    if (status.current.terms !== deps.current.terms || status.current.privacy !== deps.current.privacy) {
      return unavailable('the server and this page show different versions');
    }
    if (status.accepted) return set({ status: 'accepted', notice: unseen(status.notice, me.id), lastAccepted: status.lastAccepted });

    // Not accepted: a sign-up on this device for this email and these versions counts as the answer.
    const storage = deps.storage();
    const marker = deps.readMarker(storage, deps.now());
    if (marker) {
      const hash = await deps.hashEmail(session.email ?? me.email);
      if (stale()) return;
      const matches = hash !== null && marker.emailHash === hash && marker.terms === deps.current.terms && marker.privacy === deps.current.privacy;
      if (matches) {
        const posted = await deps.postAcceptance(deps.current);
        if (stale()) return;
        if (posted.kind === 'accepted') {
          deps.forgetMarker(storage);
          set({ status: 'accepted', notice: [], lastAccepted: null });
          return announce();
        }
        if (posted.kind === 'failed') return unavailable('the sign-up acceptance could not be recorded yet');
        deps.forgetMarker(storage);
        if (posted.kind === 'account_deleted') return unavailable('account deleted');
        if (posted.kind === 'version_mismatch') return load();
        return unavailable('not published');
      }
      deps.forgetMarker(storage);
    }
    return set({ status: 'needed', notice: [], lastAccepted: status.lastAccepted });
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Who is signed in now (App.tsx). A new person starts over; the same one keeps the state. */
    setUser(next: LegalGateUser) {
      const same = next && user && sameId(next.id, user.id) && next.isGuest === user.isGuest;
      user = next;
      if (same && state.status !== 'off') return;
      run += 1;
      cancelRetry();
      // load() answers `off` at once for the flag off, nobody or a guest.
      void load();
    },
    /** Reads the status again now when it was not available (window focus). */
    retryIfUnavailable() {
      if (state.status === 'unavailable') void load();
    },
    refresh: () => load(),
    /** The re-consent page's "Agree and continue": the versions this bundle shows. */
    async accept(): Promise<AcceptOutcome> {
      const me = user;
      if (!me) return 'failed';
      const mine = run;
      const result = await deps.postAcceptance(deps.current);
      if (mine !== run) return 'failed';
      if (result.kind === 'accepted') {
        deps.forgetMarker(deps.storage());
        focusAfterAccept = true;
        set({ status: 'accepted', notice: [], lastAccepted: null });
        announce();
        return 'accepted';
      }
      // The server has newer versions than this page; only a reload shows them (the page offers it).
      // Status stays `needed`: another read would answer `unavailable` (skew) and drop the page.
      if (result.kind === 'version_mismatch') return 'version_mismatch';
      if (result.kind === 'account_deleted') return 'account_deleted';
      return 'failed';
    },
    /** The notice bar's "Close": remembered for this account and version on this device. */
    dismissNotice(version: string) {
      if (user) rememberSeenNotice(deps.storage(), seenNoticeEntry(user.id, version));
      if (state.status === 'accepted') set({ ...state, notice: state.notice.filter((n) => n.version !== version) });
    },
    /** True once after a successful accept() (the notice bar then focuses the Layout's main). */
    takeFocusAfterAccept() {
      const take = focusAfterAccept;
      focusAfterAccept = false;
      return take;
    },
  };
}

export type LegalGate = ReturnType<typeof createLegalGate>;

// --- The page's gate -------------------------------------------------------------------------

function localStorageOrNull(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

let instance: LegalGate | null = null;

/** The page's gate (created on first use). `enabled` is features.legalPages (App.tsx passes it). */
export function legalGate(enabled: boolean): LegalGate {
  if (instance) return instance;
  instance = createLegalGate({
    enabled,
    current: currentLegalVersions(),
    getStatus: getLegalStatus,
    postAcceptance: postLegalAcceptance,
    primarySession: async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (sessionUser) return { userId: sessionUser.id, email: sessionUser.email ?? null };
      // A stored session that could not be read (a failed refresh): unavailable, asked again.
      if (error) throw error;
      return null;
    },
    storage: localStorageOrNull,
    hashEmail: (email) => hashEmail(email),
    readMarker: (storage, now) => readSignupAcceptance(storage, now),
    forgetMarker: (storage) => forgetSignupAcceptance(storage),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer),
    warn: (message) => console.warn(message),
    announceAccepted: () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LEGAL_ACCEPTED_EVENT));
    },
  });
  if (enabled && typeof window !== 'undefined') {
    window.addEventListener('focus', () => instance?.retryIfUnavailable());
  }
  return instance;
}

/** App.tsx: who is signed in. */
export function syncLegalGate(enabled: boolean, user: LegalGateUser): void {
  legalGate(enabled).setUser(user);
}

export function useLegalGate(enabled: boolean): LegalGateState {
  const gate = legalGate(enabled);
  return useSyncExternalStore(gate.subscribe, gate.getState, () => OFF_STATE);
}
