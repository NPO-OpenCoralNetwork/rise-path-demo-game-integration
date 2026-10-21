// Stale-chunk recovery after a redeploy (index.tsx, ErrorBoundary): which errors count as a failed
// lazy chunk, the one-reload-per-build guard in sessionStorage, and the boundary's language outside
// the provider.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_RELOAD_KEY,
  boundaryLanguage,
  buildId,
  chunkReloadStarted,
  chunkReloadTried,
  claimChunkReload,
  claimReloadForPreloadError,
  isChunkLoadError,
  markChunkReloadStarted,
  sessionStorageOrNull,
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

// The selector a browser would run, against a stand-in for the document's module scripts.
const fakeDocument = (...srcs) => ({
  querySelector(selectors) {
    assert.equal(selectors, 'script[type="module"][src]:not([src*="/@vite/"])');
    const src = srcs.find((value) => !value.includes('/@vite/'));
    return src === undefined ? null : { getAttribute: (name) => (name === 'src' ? src : null) };
  },
});

describe('chunkReload: buildId', () => {
  it('names the build by its entry module script', () => {
    assert.equal(buildId(fakeDocument('/assets/index-B1x2y3.js')), '/assets/index-B1x2y3.js');
    assert.equal(buildId(fakeDocument('/@vite/client', '/index.tsx')), '/index.tsx');
  });

  it('is empty without an entry script or a document', () => {
    assert.equal(buildId(fakeDocument()), '');
    assert.equal(buildId(null), '');
    assert.equal(buildId(undefined), '');
  });
});

describe('chunkReload: claimChunkReload', () => {
  const OLD = '/assets/index-old111.js';
  const NEW = '/assets/index-new222.js';

  it('claims the first reload and records its build', () => {
    const storage = memoryStorage();
    assert.equal(claimChunkReload(storage, OLD), true);
    assert.deepEqual(JSON.parse(storage.data.get(CHUNK_RELOAD_KEY)), { build: OLD });
  });

  it('refuses a second reload on the same build, however much later, so a still-missing chunk cannot loop', () => {
    const storage = memoryStorage();
    assert.equal(claimChunkReload(storage, OLD), true);
    // Each claim is a fresh page load reading the same tab storage; time plays no part.
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(claimChunkReload(storage, OLD), false);
    assert.deepEqual(JSON.parse(storage.data.get(CHUNK_RELOAD_KEY)), { build: OLD });
  });

  it('allows one more reload once another build has loaded (a newer deploy)', () => {
    const storage = memoryStorage();
    assert.equal(claimChunkReload(storage, OLD), true);
    assert.equal(claimChunkReload(storage, NEW), true);
    assert.equal(claimChunkReload(storage, NEW), false);
    assert.deepEqual(JSON.parse(storage.data.get(CHUNK_RELOAD_KEY)), { build: NEW });
  });

  it('treats a corrupt or old-format record as no record', () => {
    for (const raw of ['not-json', '1700000000000', 'null', '{"build":42}', '{}']) {
      assert.equal(claimChunkReload(memoryStorage({ [CHUNK_RELOAD_KEY]: raw }), OLD), true, raw);
    }
  });

  it('does not reload without a working storage (no loop guard)', () => {
    assert.equal(claimChunkReload(null, OLD), false);
    const throwsOnRead = { getItem() { throw new Error('SecurityError'); }, setItem() {} };
    assert.equal(claimChunkReload(throwsOnRead, OLD), false);
    const throwsOnWrite = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
    assert.equal(claimChunkReload(throwsOnWrite, OLD), false);
  });

  it('finds no sessionStorage outside a browser', () => {
    assert.equal(sessionStorageOrNull(), null);
  });
});

describe('chunkReload: claimReloadForPreloadError', () => {
  const OLD = '/assets/index-old111.js';

  it('reloads once for a failed chunk', () => {
    const storage = memoryStorage();
    const payload = new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/LearnRoute-abc123.js');
    assert.equal(claimReloadForPreloadError(payload, storage, OLD), true);
    assert.equal(claimReloadForPreloadError(payload, storage, OLD), false);
  });

  it('does not reload for a module that threw while it evaluated, and leaves the claim unused', () => {
    const storage = memoryStorage();
    const payload = new TypeError("Cannot read properties of undefined (reading 'x')");
    assert.equal(claimReloadForPreloadError(payload, storage, OLD), false);
    assert.equal(claimReloadForPreloadError(new SyntaxError("Unexpected token '?'"), storage, OLD), false);
    assert.equal(claimReloadForPreloadError(undefined, storage, OLD), false);
    assert.equal(storage.data.has(CHUNK_RELOAD_KEY), false);
  });
});

describe('chunkReload: chunkReloadTried', () => {
  const OLD = '/assets/index-old111.js';

  it('is true only after a reload was claimed for this build', () => {
    const storage = memoryStorage();
    assert.equal(chunkReloadTried(storage, OLD), false);
    claimChunkReload(storage, OLD);
    assert.equal(chunkReloadTried(storage, OLD), true);
    assert.equal(chunkReloadTried(storage, '/assets/index-new222.js'), false);
  });

  it('is false without a readable record', () => {
    assert.equal(chunkReloadTried(null, OLD), false);
    assert.equal(chunkReloadTried(memoryStorage({ [CHUNK_RELOAD_KEY]: 'not-json' }), OLD), false);
    assert.equal(chunkReloadTried({ getItem() { throw new Error('SecurityError'); }, setItem() {} }, OLD), false);
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
