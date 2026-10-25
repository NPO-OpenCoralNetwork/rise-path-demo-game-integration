/**
 * The logout gate (Phase 5, owner decision O4; doc/brushup-2026/ai-access-plan.ja.md §9). Before
 * anything is cleared, AuthContext.logout asks confirmUnsavedLearning(): the lesson sync uploads
 * what is pending (≤ 3 s, also while a load runs: progressSync.ts prepareSignOut), and only when
 * lesson records are still unsaved the learner chooses 「ログアウトしない」 (the default) or
 * 「このままログアウト」. Unsaved records stay on this device for the same learner's next sign-in.
 *
 * React-free: UnsavedLogoutDialog (mounted once in App) registers itself and reads the phase with
 * useSyncExternalStore(subscribeLogoutPhase, getLogoutPhase).
 * - idle: nothing to show. checking: the upload runs (shown as a status line, not a dialog, after
 *   400 ms so a fast upload never flashes). asking: one question; `ask` changes for every
 *   question, so the dialog mounts fresh each time (focus on its cancel button).
 * - No question: a "sign in again" button (reason 'reauth': the session has probably expired, an
 *   upload cannot succeed, and signing in again is what saves the records), no dialog host,
 *   nothing that syncs (guests, Nexloom-only, no API: the save view is 'local'), or nothing unsaved.
 * - A second call while one is open gets the same answer. The last dialog going away answers: while
 *   the upload runs, no question (true); while asking, 「ログアウトしない」 (false).
 * Account deletion never comes here (AuthContext.endDeletedAccountSession does not log out).
 */
import { getProgressSaveView, prepareProgressSignOut } from './progressSyncClient';

export type LogoutPhase = { kind: 'idle' } | { kind: 'checking' } | { kind: 'asking'; unsaved: number; ask: number };

/** The status line shows only after this long (no flash for a fast upload). */
export const LOGOUT_CHECKING_DELAY_MS = 400;

const IDLE: LogoutPhase = Object.freeze({ kind: 'idle' }) as LogoutPhase;

let phase: LogoutPhase = IDLE;
let asks = 0;
let hosts = 0;
let open: Promise<boolean> | null = null;
let answer: ((logOut: boolean) => void) | null = null;
let returnTarget: HTMLElement | null = null;
const listeners = new Set<() => void>();

function setPhase(next: LogoutPhase): void {
  if (phase === next) return;
  phase = next;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A broken listener must not stop the logout.
    }
  }
}

/** The focused element (not the page body), captured in the click's own task. */
function focusedElement(): HTMLElement | null {
  try {
    if (typeof document === 'undefined') return null;
    const active = document.activeElement;
    if (!active || active === document.body || typeof (active as HTMLElement).focus !== 'function') return null;
    return active as HTMLElement;
  } catch {
    return null;
  }
}

async function check(): Promise<boolean> {
  const timer = setTimeout(() => {
    if (phase.kind === 'idle') setPhase({ kind: 'checking' });
  }, LOGOUT_CHECKING_DELAY_MS);
  let unsaved = 0;
  try {
    ({ unsaved } = await prepareProgressSignOut());
  } catch {
    unsaved = 0;
  } finally {
    clearTimeout(timer);
  }
  // Nothing unsaved, or the last dialog went away during the upload: no question (nothing could
  // answer it, and the logout would never end).
  if (!(unsaved > 0) || hosts === 0) {
    setPhase(IDLE);
    return true;
  }
  asks += 1;
  const chosen = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  setPhase({ kind: 'asking', unsaved, ask: asks });
  return chosen;
}

/**
 * True: go on with the logout. False only when the learner chose to stay signed in. Never throws.
 */
export function confirmUnsavedLearning(options: { reason?: 'reauth' } = {}): Promise<boolean> {
  if (options?.reason === 'reauth') return Promise.resolve(true);
  if (open) return open;
  if (hosts === 0) return Promise.resolve(true);
  let local = true;
  try {
    const view = getProgressSaveView();
    local = view.state === 'local' || !view.userId;
  } catch {
    local = true;
  }
  if (local) return Promise.resolve(true);
  returnTarget = focusedElement();
  const run = check();
  open = run;
  void run.finally(() => {
    if (open === run) open = null;
  });
  return run;
}

/** The dialog's answer: true = 「このままログアウト」, false = 「ログアウトしない」 (also Esc). */
export function answerUnsavedLearning(logOut: boolean): void {
  if (phase.kind !== 'asking' || !answer) return;
  const resolve = answer;
  answer = null;
  setPhase(IDLE);
  resolve(logOut === true);
}

/**
 * The dialog registers while it is mounted (no host: no question). A question still open when the
 * last host goes is answered "stay signed in" (nothing was cleared).
 */
export function registerLogoutDialog(): () => void {
  hosts += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    hosts -= 1;
    if (hosts === 0) answerUnsavedLearning(false);
  };
}

export function getLogoutPhase(): LogoutPhase {
  return phase;
}

export function subscribeLogoutPhase(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The element that had focus when the logout was asked for (not body), for the dialog's focus return. */
export function logoutReturnTarget(): HTMLElement | null {
  return returnTarget;
}

/**
 * Moves focus back after the question closes: to the first of the remembered element, each
 * `button[aria-controls="app-sidebar"]` (the phone menu button, then the rail toggle) and
 * `#main-content` that really takes focus (an element in a closed drawer is invisible and
 * refuses it). Returns the element that has focus, or null.
 */
export function restoreLogoutFocus(target: HTMLElement | null = returnTarget): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const candidates: HTMLElement[] = [];
  if (target) candidates.push(target);
  try {
    candidates.push(...Array.from(document.querySelectorAll<HTMLElement>('button[aria-controls="app-sidebar"]')));
    const main = document.getElementById('main-content');
    if (main) candidates.push(main);
  } catch {
    // No DOM queries: only the remembered element.
  }
  for (const element of candidates) {
    if (element.isConnected === false) continue;
    try {
      element.focus({ preventScroll: true });
    } catch {
      continue;
    }
    if (document.activeElement === element) return element;
  }
  return null;
}
