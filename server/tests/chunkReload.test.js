// Stale-chunk recovery after a redeploy (index.tsx, ErrorBoundary): which errors count as a failed
// lazy chunk, the one-reload guard in sessionStorage, and the boundary's language outside the provider.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  boundaryLanguage,
  chunkReloadStarted,
  claimChunkReload,
  isChunkLoadError,
  markChunkReloadStarted,
  sessionStorageOrNull,
  shouldReload,
} from '../../components/common/chunkReload.ts';

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
};

describe('chunkReload: isChunkLoadError', () => {
  it('recognises the browsers’ failed dynamic import messages', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://app.example/assets/ClaudeCodePathView-abc123.js', // Chromium
      'error loading dynamically imported module: https://app.example/assets/LearnRoute-abc123.js', // Firefox
      'Importing a module script failed.', // Safari
      'Unable to preload CSS for /assets/LearnRoute-abc123.css', // Vite CSS preload
    ]) {
      assert.equal(isChunkLoadError(new TypeError(message)), true, message);
      assert.equal(isChunkLoadError(message), true, message);
    }
  });

  it('recognises a ChunkLoadError by name', () => {
    const error = new Error('Loading chunk 7 failed.');
    error.name = 'ChunkLoadError';
    assert.equal(isChunkLoadError(error), true);
  });

  it('leaves other errors and non-errors alone', () => {
    assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
    assert.equal(isChunkLoadError(new Error('Failed to fetch')), false);
    assert.equal(isChunkLoadError(null), false);
    assert.equal(isChunkLoadError(undefined), false);
    assert.equal(isChunkLoadError(42), false);
    assert.equal(isChunkLoadError({ message: 404 }), false);
  });
});

describe('chunkReload: shouldReload', () => {
  const now = 1_700_000_000_000;

  it('reloads when nothing was recorded or the record is unreadable', () => {
    assert.equal(shouldReload(null, now), true);
    assert.equal(shouldReload(Number.NaN, now), true);
  });

  it('does not reload again inside the window', () => {
    assert.equal(shouldReload(now, now), false);
    assert.equal(shouldReload(now - CHUNK_RELOAD_WINDOW_MS + 1, now), false);
  });

  it('reloads again once the window has passed, or when the clock went backwards', () => {
    assert.equal(shouldReload(now - CHUNK_RELOAD_WINDOW_MS, now), true);
    assert.equal(shouldReload(now + 5_000, now), true);
    assert.equal(shouldReload(now - 2_000, now, 1_000), true);
  });
});

describe('chunkReload: claimChunkReload', () => {
  const now = 1_700_000_000_000;

  it('claims the first reload and records its time', () => {
    const storage = memoryStorage();
    assert.equal(claimChunkReload(storage, now), true);
    assert.equal(storage.data.get(CHUNK_RELOAD_KEY), String(now));
  });

  it('refuses a second reload within the window, so a still-missing chunk cannot loop', () => {
    const storage = memoryStorage();
    assert.equal(claimChunkReload(storage, now), true);
    assert.equal(claimChunkReload(storage, now + 3_000), false);
    assert.equal(storage.data.get(CHUNK_RELOAD_KEY), String(now));
    assert.equal(claimChunkReload(storage, now + CHUNK_RELOAD_WINDOW_MS), true);
  });

  it('treats a corrupt record as no record', () => {
    assert.equal(claimChunkReload(memoryStorage({ [CHUNK_RELOAD_KEY]: 'not-a-time' }), now), true);
  });

  it('does not reload without a working storage (no loop guard)', () => {
    assert.equal(claimChunkReload(null, now), false);
    const throwsOnRead = { getItem() { throw new Error('SecurityError'); }, setItem() {} };
    assert.equal(claimChunkReload(throwsOnRead, now), false);
    const throwsOnWrite = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
    assert.equal(claimChunkReload(throwsOnWrite, now), false);
  });

  it('finds no sessionStorage outside a browser', () => {
    assert.equal(sessionStorageOrNull(), null);
  });
});

describe('chunkReload: reload flag', () => {
  it('starts unset and stays set once marked', () => {
    assert.equal(chunkReloadStarted(), false);
    markChunkReloadStarted();
    assert.equal(chunkReloadStarted(), true);
  });
});

describe('chunkReload: boundaryLanguage', () => {
  it('uses the saved choice with LanguageContext’s mapping', () => {
    assert.equal(boundaryLanguage('jp'), 'jp');
    assert.equal(boundaryLanguage('en', 'ja'), 'en');
    assert.equal(boundaryLanguage('fr', 'ja'), 'en');
  });

  it('falls back to <html lang>, then English like the provider', () => {
    assert.equal(boundaryLanguage(null, 'ja'), 'jp');
    assert.equal(boundaryLanguage(null, 'ja-JP'), 'jp');
    assert.equal(boundaryLanguage(null, 'en'), 'en');
    assert.equal(boundaryLanguage('garbage', ''), 'en');
    assert.equal(boundaryLanguage(null), 'en');
  });
});
