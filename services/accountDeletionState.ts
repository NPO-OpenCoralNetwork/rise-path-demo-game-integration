/**
 * Account deletion in the browser, the parts with no React, no network and no import.meta
 * (Phase 4, design §5.11), so server/tests/accountDeletionFront.test.js runs them under node:
 *
 * - The "deleted elsewhere" signal. apiFetch (services/apiClient.ts) calls reportAccountDeleted()
 *   when the server answers 401 account_deleted; it dispatches ACCOUNT_DELETED_EVENT on window
 *   once per page, and AuthContext then ends the session (by=other). While this tab deletes its
 *   own account (markDeletionInFlight(), set before any network call of the deletion), the signal
 *   is held instead: a background progress refresh or flush that gets 401 after the deletion
 *   committed must not start the "elsewhere" flow, whose page change would abort the last steps
 *   of the deletion here. clearDeletionInFlight() ends the hold after a failed deletion and
 *   dispatches a held signal then (the account was deleted elsewhere at the same time).
 * - The deleted page's address. The outcome travels in the URL (by=self&at=… or by=other), never
 *   in storage: the page change is a full load, and a direct visit simply shows the neutral page.
 */

/** Dispatched on window when the server says this account was deleted (401 account_deleted). */
export const ACCOUNT_DELETED_EVENT = 'rp:account-deleted';
/** The public page shown after a deletion (App.tsx PUBLIC_PATHS). */
export const ACCOUNT_DELETED_PATH = '/account/deleted';
/** `at` counts only when it is this recent (a bookmarked or shared link shows no time). */
export const DELETED_AT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type DeletedBy = 'self' | 'other';

export type DeletionGate = {
  /** From now on the signal is held, not dispatched. Idempotent. */
  markDeletionInFlight(): void;
  /** Ends the hold. A signal held meanwhile is dispatched now; returns whether it was. */
  clearDeletionInFlight(): boolean;
  /** True while a deletion runs in this tab. */
  deletionInFlight(): boolean;
  /** The server answered 401 account_deleted to some request of this tab. */
  reportAccountDeleted(): void;
};

/** One gate per page; `dispatch` sends ACCOUNT_DELETED_EVENT (at most once per page). */
export function createDeletionGate(dispatch: () => void): DeletionGate {
  let inFlight = false;
  let held = false;
  let dispatched = false;
  const send = () => {
    if (dispatched) return false;
    dispatched = true;
    try {
      dispatch();
    } catch {
      // Nothing listens (no window): nothing to end either.
    }
    return true;
  };
  return {
    markDeletionInFlight() {
      inFlight = true;
    },
    clearDeletionInFlight() {
      inFlight = false;
      if (!held) return false;
      held = false;
      return send();
    },
    deletionInFlight: () => inFlight,
    reportAccountDeleted() {
      if (inFlight) {
        held = true;
        return;
      }
      send();
    },
  };
}

const pageGate = createDeletionGate(() => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_DELETED_EVENT));
});

export const markDeletionInFlight = pageGate.markDeletionInFlight;
export const clearDeletionInFlight = pageGate.clearDeletionInFlight;
export const deletionInFlight = pageGate.deletionInFlight;
export const reportAccountDeleted = pageGate.reportAccountDeleted;

/** An ISO time the server sent, or null. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * The deleted page's address under the app's base path (import.meta.env.BASE_URL, which honours
 * VITE_APP_BASE_PATH): `<base>account/deleted?by=self&at=<ISO>`, `?by=self` when the time is not
 * known, or `?by=other`.
 */
export function accountDeletedUrl(base: string, by: DeletedBy, at?: string | null): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  const params = new URLSearchParams({ by });
  const time = by === 'self' ? isoOrNull(at) : null;
  if (time) params.set('at', time);
  return `${root}${ACCOUNT_DELETED_PATH.slice(1)}?${params.toString()}`;
}

/**
 * What the deleted page shows, from its query string: `self` only for by=self (anything else is
 * the neutral page, also after a staff deletion), and the time only when `at` parses as an ISO
 * time within the last 24 hours (not in the future beyond a minute of clock skew).
 */
export function readDeletedPage(search: string, now: number = Date.now()): { by: DeletedBy; at: Date | null } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { by: 'other', at: null };
  }
  if (params.get('by') !== 'self') return { by: 'other', at: null };
  const raw = params.get('at');
  // ISO 8601 with a time and a zone, as accountDeletedUrl writes it.
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return { by: 'self', at: null };
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t > now + 60_000 || now - t > DELETED_AT_MAX_AGE_MS) return { by: 'self', at: null };
  return { by: 'self', at: new Date(t) };
}
