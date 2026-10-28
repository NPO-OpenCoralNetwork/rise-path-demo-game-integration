/**
 * Recovery from stale lazy chunks after a redeploy. A tab opened on the old build still asks for
 * the old hashed files, which now 404 (Express, and Vercel too: its SPA fallback skips /assets/).
 *
 * - index.tsx listens for Vite's `vite:preloadError` and, when the payload is a failed chunk,
 *   reloads once (`handlePreloadError`). The build that reload was tried for
 *   is kept in sessionStorage, so the tab reloads at most once per build, however slowly each load
 *   runs; a chunk that still fails on the same build is left to ErrorBoundary instead of looping.
 * - Offline (Phase 8, S1), a failed chunk never reloads: that reload would land on the browser's
 *   own offline page and use up the build's one reload. Nor does a failure while the page already
 *   waits for the connection. The page's offline controller (`pageOfflineReload`) takes over: it
 *   says so (ErrorBoundary, LearnRoute, OfflineReloadNotice in the reader bar), probes the app's own
 *   origin once the browser says online, and reloads by itself only where nothing usable is on
 *   screen (`requireReload`). A failed module URL fails again even online, so a reload is the only
 *   retry. Learning records stay in this device's storage throughout.
 * - Known limit (design D2, plan 12.3 item 1): "offline" is what navigator.onLine says. When the
 *   browser reports online but the network is gone (a phone without data, a captive Wi-Fi), the
 *   first failed chunk of a page that is not waiting still takes today's one reload per build, and
 *   can land on the browser's offline page; failures while the page waits never reload.
 * - ErrorBoundary uses `boundaryKind` (offline, checking, unreachable, "a new version is
 *   available" while a reload can still help, or a plain error) and `boundaryLanguage` because it
 *   renders outside LanguageProvider.
 *
 * No React or import.meta.env, and window and navigator are only touched behind a guard:
 * server/tests imports this file directly.
 */

export const CHUNK_RELOAD_KEY = 'rp:chunkReload';
/** Same key as context/LanguageContext.tsx. */
export const LANGUAGE_STORAGE_KEY = 'risepath:language';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type DocumentLike = { querySelector(selectors: string): { getAttribute(name: string): string | null } | null };

// The entry script, skipping Vite's dev client (/@vite/client) that dev injects in front of it.
const ENTRY_SCRIPT = 'script[type="module"][src]:not([src*="/@vite/"])';

// Chromium, Firefox, Safari, Vite's CSS preload, and webpack-style errors (error.name).
const CHUNK_ERROR_MESSAGES = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === 'string') return CHUNK_ERROR_MESSAGES.some((pattern) => pattern.test(error));
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return typeof message === 'string' && CHUNK_ERROR_MESSAGES.some((pattern) => pattern.test(message));
}

/**
 * Identifies the running build by its entry module script: the hashed /assets/index-*.js in a
 * production build, so every deploy changes it (/index.tsx in dev). Empty when there is none.
 */
export function buildId(doc: DocumentLike | null | undefined): string {
  return doc?.querySelector(ENTRY_SCRIPT)?.getAttribute('src') ?? '';
}

/** The build a reload was recorded for; null when nothing readable is stored. Throws if storage does. */
function recordedBuild(storage: StorageLike): string | null {
  const raw = storage.getItem(CHUNK_RELOAD_KEY);
  if (raw === null) return null;
  try {
    const build = (JSON.parse(raw) as { build?: unknown } | null)?.build;
    return typeof build === 'string' ? build : null;
  } catch {
    return null;
  }
}

/** True when an automatic reload was already tried in this tab for `build`. */
export function chunkReloadTried(storage: StorageLike | null, build: string): boolean {
  if (!storage) return false;
  try {
    return recordedBuild(storage) === build;
  } catch {
    return false;
  }
}

/**
 * Records a reload for `build` and returns true when the caller should reload now: only when no
 * reload was tried for this build yet. A record for another build (a newer deploy loaded since)
 * allows one more. Without a working storage there is no loop guard, so it returns false and
 * ErrorBoundary takes over.
 */
export function claimChunkReload(storage: StorageLike | null, build: string): boolean {
  if (!storage) return false;
  try {
    if (recordedBuild(storage) === build) return false;
    storage.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ build }));
    return true;
  } catch {
    return false;
  }
}

/** navigator.onLine; true when unknown (no navigator). Only `false` means offline. */
export function navigatorOnline(
  nav: { onLine?: boolean } | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  return nav?.onLine !== false;
}

export type PreloadErrorAction = 'reload' | 'await-online' | 'none';

/**
 * index.tsx's decision for one `vite:preloadError`. Vite also fires that event for a lazy module
 * that throws while it evaluates (its payload is then that error); a reload cannot fix that bug, so
 * only a failed chunk counts. Offline, or while the page already waits for the connection (the
 * offline controller is not 'none'), a failed chunk never reloads and never uses the per-build
 * claim: the controller owns the one reload, after its probe, and the claim stays for a real stale
 * build later. Otherwise: one reload per build (`claimChunkReload`).
 */
export function preloadErrorAction(
  payload: unknown,
  storage: StorageLike | null,
  build: string,
  s: { online: boolean; waiting: boolean },
): PreloadErrorAction {
  if (!isChunkLoadError(payload)) return 'none';
  if (!s.online || s.waiting) return 'await-online';
  return claimChunkReload(storage, build) ? 'reload' : 'none';
}

/** The online decision alone (no wait): true when this failed chunk claims the build's one reload. */
export function claimReloadForPreloadError(payload: unknown, storage: StorageLike | null, build: string): boolean {
  return preloadErrorAction(payload, storage, build, { online: true, waiting: false }) === 'reload';
}

/**
 * Applies the decision. preventDefault only when reloading: otherwise Vite rethrows the error to the
 * import() that failed, so its caller shows its own state (the boundary, the lesson problem, a
 * diagram's or code block's plain form).
 */
export function handlePreloadError(
  event: { payload: unknown; preventDefault(): void },
  ctx: {
    storage: StorageLike | null;
    build: string;
    online: boolean;
    waiting: boolean;
    reload: () => void;
    awaitOnline: () => void;
  },
): PreloadErrorAction {
  const action = preloadErrorAction(event.payload, ctx.storage, ctx.build, ctx);
  if (action === 'reload') {
    event.preventDefault();
    ctx.reload();
  } else if (action === 'await-online') {
    ctx.awaitOnline();
  }
  return action;
}

/** window.sessionStorage, or null where reading the property itself throws (blocked storage). */
export function sessionStorageOrNull(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

let reloadStarted = false;

/** Set right before location.reload(), so a boundary render in the meantime says "new version". */
export function markChunkReloadStarted(): void {
  reloadStarted = true;
}

export function chunkReloadStarted(): boolean {
  return reloadStarted;
}

/**
 * The UI language for screens outside LanguageProvider: the saved choice first (same mapping as
 * LanguageContext: fr falls back to en), then the <html lang> the provider keeps in sync.
 */
export function boundaryLanguage(stored: string | null, documentLang = ''): 'en' | 'jp' {
  if (stored === 'jp') return 'jp';
  if (stored === 'en' || stored === 'fr') return 'en';
  return documentLang.toLowerCase().startsWith('ja') ? 'jp' : 'en';
}

// ---------------------------------------------------------------------------------------------
// Phase 8 (S1): waiting for the connection after a chunk failed offline
// ---------------------------------------------------------------------------------------------

/**
 * Where the page stands after a chunk failed offline (or while waiting):
 * - 'none': nothing failed offline (also after a plain offline/online with no failure);
 * - 'offline': a chunk failed and the browser says offline, or it went offline while waiting;
 * - 'checking': the browser says online again and one probe of the app's own origin runs;
 * - 'unreachable': the browser says online, but the last probe failed or timed out (probes again);
 * - 'back': a probe answered and no screen asked for an automatic reload.
 * Once a page leaves 'none' it never returns there: only a reload starts over.
 */
export type ChunkWait = 'none' | 'offline' | 'checking' | 'unreachable' | 'back';
/** The time between two probes while the app does not answer. */
export const RECONNECT_RETRY_MS = 5_000;
/** A probe that has not answered by then counts as unanswered (and is aborted). */
export const PROBE_TIMEOUT_MS = 8_000;

/**
 * The offline controller (pure: the clock, the probe and the reload are injected).
 * "Back online" is never claimed before the app itself answered: `online` events come early (a
 * captive portal, a Wi-Fi that is still joining), and a reload then would land on the browser's
 * offline page, which is the bug this fixes. The controller reloads at most once per page, never
 * while the browser says offline, and only after a probe answered while a screen with nothing
 * usable on it (the root ErrorBoundary, LearnRoute's lesson-load error) holds `requireReload()`.
 * A page that degraded in place (a diagram, highlighted code) is never reloaded by itself: the
 * reader bar offers 「読み込み直す」, so the AI tutor thread and typed text are lost only on request.
 */
export function createOfflineReload(deps: {
  online: () => boolean;
  /** Resolves once the app's own origin answered (any HTTP status); rejects on a network error or an abort. */
  probe: (signal: AbortSignal) => Promise<unknown>;
  reload: () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  retryMs?: number;
  probeTimeoutMs?: number;
}) {
  let wait: ChunkWait = 'none';
  let retry: unknown = null; // the timer between probes
  let attemptId = 0; // only the current attempt may use its answer
  let abortProbe: (() => void) | null = null;
  let blockers = 0; // mounted screens with nothing usable on them (requireReload)
  let reloading = false;
  const listeners = new Set<() => void>();

  const set = (next: ChunkWait) => {
    if (next === wait) return;
    wait = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* a listener's failure must not stop the others */
      }
    }
  };

  /** Cancels the retry timer and the probe in flight; an answer that arrives later is ignored. */
  const stop = () => {
    if (retry !== null) deps.clearTimer(retry);
    retry = null;
    attemptId += 1;
    abortProbe?.();
    abortProbe = null;
  };

  /** Never while offline, at most once per page. Writes no rp:chunkReload (the per-build claim stays). */
  const reloadNow = () => {
    if (reloading || !deps.online()) return;
    reloading = true;
    stop();
    deps.reload();
  };

  async function attempt(): Promise<void> {
    stop();
    if (reloading || wait === 'none' || wait === 'offline') return;
    if (!deps.online()) return set('offline');
    const id = attemptId;
    const controller = new AbortController();
    abortProbe = () => controller.abort();
    const timeout = deps.setTimer(() => controller.abort(), deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS);
    let reachable = false;
    try {
      await deps.probe(controller.signal);
      reachable = true;
    } catch {
      /* unreachable, timed out or aborted */
    }
    deps.clearTimer(timeout);
    if (id !== attemptId) return; // offline(), online() or a newer attempt came since: old evidence
    abortProbe = null;
    if (!deps.online()) return set('offline');
    if (reachable) return blockers > 0 ? reloadNow() : set('back');
    set('unreachable'); // never "back online" before the app answered
    retry = deps.setTimer(() => {
      retry = null;
      void attempt();
    }, deps.retryMs ?? RECONNECT_RETRY_MS);
  }

  /** A fresh check: drops the probe in flight (its answer may predate the latest transition). */
  const check = () => {
    if (reloading || wait === 'none') return;
    set('checking');
    void attempt();
  };

  return {
    state: (): ChunkWait => wait,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** handlePreloadError's await-online: a chunk failed offline, or online while the page already waits. */
    chunkFailed(): void {
      if (reloading) return;
      if (!deps.online()) {
        stop();
        set('offline');
        return;
      }
      if (wait === 'none' || wait === 'offline') {
        // The browser already says online again (event lag): check now. Not check(), which leaves
        // 'none' alone (a plain online event with no failure).
        set('checking');
        void attempt();
      }
    },
    /** window 'online'. */
    online: check,
    /** window 'offline'. */
    offline(): void {
      if (wait === 'none' || reloading) return;
      stop();
      set('offline');
    },
    /** A screen with nothing usable on it: reload by itself as soon as the app answers. Returns the release. */
    requireReload(): () => void {
      blockers += 1;
      if (wait === 'back') check(); // the app answered earlier: check again, then reload
      let released = false;
      return () => {
        if (released) return;
        released = true;
        blockers -= 1;
      };
    },
    /** The reader notice's 「読み込み直す」 ('back') and the boundary's 「再読み込み」 ('unreachable'). */
    reloadNow,
  };
}

export type OfflineReload = ReturnType<typeof createOfflineReload>;

let pageController: OfflineReload | null = null;

/**
 * The page's controller, created on first use with the window's online/offline events; null outside
 * a browser. The probe is a same-origin HEAD of the page URL (the SPA answers it with any status);
 * a captive portal's TLS failure or cross-origin redirect rejects it.
 */
export function pageOfflineReload(): OfflineReload | null {
  if (pageController) return pageController;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return null;
  const controller = createOfflineReload({
    online: () => navigatorOnline(),
    probe: (signal) =>
      fetch(window.location.href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', signal }),
    reload: () => window.location.reload(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  window.addEventListener('online', () => controller.online());
  window.addEventListener('offline', () => controller.offline());
  pageController = controller;
  return controller;
}

/** What the root ErrorBoundary says. Waiting for the connection comes before "a new version". */
export type BoundaryKind = 'offline' | 'checking' | 'unreachable' | 'stale' | 'error';

export function boundaryKind(
  error: unknown,
  s: { wait: ChunkWait; reloadStarted: boolean; reloadTried: boolean },
): BoundaryKind {
  if (isChunkLoadError(error) && s.wait !== 'none') {
    if (s.wait === 'offline') return 'offline';
    if (s.wait === 'unreachable') return 'unreachable';
    return 'checking'; // checking, or back (requireReload checks again at once)
  }
  // "New version" only while a reload can still help: one is running, or a chunk failed and none
  // was tried for this build yet. After that it is a plain error (blocked or missing file).
  if (s.reloadStarted || (isChunkLoadError(error) && !s.reloadTried)) return 'stale';
  return 'error';
}
