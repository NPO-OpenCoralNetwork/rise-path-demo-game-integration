/**
 * Recovery from stale lazy chunks after a redeploy. A tab opened on the old build still asks for
 * the old hashed files, which now 404 (Express) or come back as index.html (Vercel rewrite).
 *
 * - index.tsx listens for Vite's `vite:preloadError` and reloads once (`claimChunkReload`).
 *   The time of that reload is kept in sessionStorage, so a second failure within
 *   CHUNK_RELOAD_WINDOW_MS is left to ErrorBoundary instead of looping.
 * - ErrorBoundary uses `isChunkLoadError` to show "a new version is available" with a Reload
 *   button, and `boundaryLanguage` because it renders outside LanguageProvider.
 *
 * No React or import.meta.env, and window is only touched behind a guard: server/tests imports
 * this file directly.
 */

export const CHUNK_RELOAD_KEY = 'rp:chunkReloadAt';
export const CHUNK_RELOAD_WINDOW_MS = 10_000;
/** Same key as context/LanguageContext.tsx. */
export const LANGUAGE_STORAGE_KEY = 'risepath:language';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

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

/** True unless a reload was already tried less than `windowMs` ago. */
export function shouldReload(lastReloadAt: number | null, now: number, windowMs = CHUNK_RELOAD_WINDOW_MS): boolean {
  if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) return true;
  const elapsed = now - lastReloadAt;
  return elapsed < 0 || elapsed >= windowMs;
}

/**
 * Records a reload attempt and returns true when the caller should reload now. Without a
 * working storage there is no loop guard, so it returns false and ErrorBoundary takes over.
 */
export function claimChunkReload(
  storage: StorageLike | null,
  now = Date.now(),
  windowMs = CHUNK_RELOAD_WINDOW_MS,
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(CHUNK_RELOAD_KEY);
    const last = raw === null ? null : Number(raw);
    if (!shouldReload(last, now, windowMs)) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
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
