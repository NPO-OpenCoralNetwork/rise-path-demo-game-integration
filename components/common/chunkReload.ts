/**
 * Recovery from stale lazy chunks after a redeploy. A tab opened on the old build still asks for
 * the old hashed files, which now 404 (Express) or come back as index.html (Vercel rewrite).
 *
 * - index.tsx listens for Vite's `vite:preloadError` and, when the payload is a failed chunk,
 *   reloads once (`claimReloadForPreloadError`). The build that reload was tried for
 *   is kept in sessionStorage, so the tab reloads at most once per build, however slowly each load
 *   runs; a chunk that still fails on the same build is left to ErrorBoundary instead of looping.
 * - ErrorBoundary uses `isChunkLoadError` and `chunkReloadTried` to show "a new version is
 *   available" only while a reload can still help, and `boundaryLanguage` because it renders
 *   outside LanguageProvider.
 *
 * No React or import.meta.env, and window is only touched behind a guard: server/tests imports
 * this file directly.
 */

export const CHUNK_RELOAD_KEY = 'rp:chunkReload';
/** Same key as context/languageStorage.ts (copied, since this file has no imports). */
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

/**
 * index.tsx's `vite:preloadError` decision. Vite also fires that event for a lazy module that
 * throws while it evaluates (its payload is then that error); a reload cannot fix that bug, so
 * only a failed chunk claims the reload.
 */
export function claimReloadForPreloadError(payload: unknown, storage: StorageLike | null, build: string): boolean {
  return isChunkLoadError(payload) && claimChunkReload(storage, build);
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
