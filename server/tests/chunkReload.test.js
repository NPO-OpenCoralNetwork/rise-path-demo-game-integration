// Stale-chunk recovery after a redeploy (index.tsx, ErrorBoundary): which errors count as a failed
// lazy chunk, the one-reload-per-build guard in sessionStorage, and the boundary's language outside
// the provider. Phase 8 (S1, design p8 §1.3): a chunk that fails offline, or while the page already
// waits for the connection, never reloads and never uses the per-build claim; the offline
// controller probes the app's origin and reloads only after it answered, only where a screen with
// nothing usable on it asked for it; the boundary's wording per state.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_RELOAD_KEY,
  PROBE_TIMEOUT_MS,
  RECONNECT_RETRY_MS,
  boundaryKind,
  boundaryLanguage,
  buildId,
  chunkReloadStarted,
  chunkReloadTried,
  claimChunkReload,
  claimReloadForPreloadError,
  createOfflineReload,
  handlePreloadError,
  isChunkLoadError,
  markChunkReloadStarted,
  navigatorOnline,
  pageOfflineReload,
  preloadErrorAction,
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

// ---------------------------------------------------------------------------------------------
// Phase 8 (S1): offline
// ---------------------------------------------------------------------------------------------

const CHUNK = new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/MermaidDiagram-abc123.js');
const BUG = new TypeError("Cannot read properties of undefined (reading 'x')");
const BUILD = '/assets/index-old111.js';

describe('chunkReload: navigatorOnline', () => {
  it('only an explicit onLine false means offline', () => {
    assert.equal(navigatorOnline(undefined), true);
    assert.equal(navigatorOnline({ onLine: false }), false);
    assert.equal(navigatorOnline({ onLine: true }), true);
    assert.equal(navigatorOnline({}), true);
  });
});

describe('chunkReload: preloadErrorAction (index.tsx decision)', () => {
  it('offline: await the connection, write no claim; a later online failure on the same build still reloads once', () => {
    const storage = memoryStorage();
    assert.equal(preloadErrorAction(CHUNK, storage, BUILD, { online: false, waiting: false }), 'await-online');
    assert.equal(preloadErrorAction(CHUNK, storage, BUILD, { online: false, waiting: true }), 'await-online');
    assert.equal(storage.data.has(CHUNK_RELOAD_KEY), false, 'the per-build claim is not used offline');
    assert.equal(preloadErrorAction(CHUNK, storage, BUILD, { online: true, waiting: false }), 'reload', 'the claim was kept for a real stale build');
    assert.equal(preloadErrorAction(CHUNK, storage, BUILD, { online: true, waiting: false }), 'none');
  });

  it('online while the page already waits: await the connection too, write no claim (critique 1)', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(preloadErrorAction(CHUNK, storage, BUILD, { online: true, waiting: true }), 'await-online');
    }
    assert.equal(storage.data.has(CHUNK_RELOAD_KEY), false);
  });

  it('a module that threw while it evaluated is never a reason to wait or reload', () => {
    const storage = memoryStorage();
    for (const s of [{ online: false, waiting: false }, { online: true, waiting: true }, { online: false, waiting: true }, { online: true, waiting: false }]) {
      assert.equal(preloadErrorAction(BUG, storage, BUILD, s), 'none', JSON.stringify(s));
      assert.equal(preloadErrorAction(undefined, storage, BUILD, s), 'none', JSON.stringify(s));
    }
    assert.equal(storage.data.has(CHUNK_RELOAD_KEY), false);
  });

  it('online and not waiting: today\'s rule, one reload per build', () => {
    const storage = memoryStorage();
    assert.equal(preloadErrorAction(CHUNK, storage, BUILD, { online: true, waiting: false }), 'reload');
    assert.equal(preloadErrorAction(CHUNK, storage, BUILD, { online: true, waiting: false }), 'none');
    assert.equal(preloadErrorAction(CHUNK, null, BUILD, { online: true, waiting: false }), 'none', 'no storage, no loop guard, no reload');
  });

  it('claimReloadForPreloadError is the online, not-waiting decision', () => {
    const storage = memoryStorage();
    assert.equal(claimReloadForPreloadError(CHUNK, storage, BUILD), true);
    assert.equal(claimReloadForPreloadError(CHUNK, storage, BUILD), false);
  });
});

describe('chunkReload: handlePreloadError (the event)', () => {
  const run = (/** @type {{ online: boolean, waiting: boolean, storage?: any, payload?: unknown }} */ o) => {
    const calls = { preventDefault: 0, reload: 0, awaitOnline: 0 };
    const storage = o.storage ?? memoryStorage();
    const action = handlePreloadError(
      { payload: 'payload' in o ? o.payload : CHUNK, preventDefault: () => { calls.preventDefault += 1; } },
      {
        storage,
        build: BUILD,
        online: o.online,
        waiting: o.waiting,
        reload: () => { calls.reload += 1; },
        awaitOnline: () => { calls.awaitOnline += 1; },
      },
    );
    return { action, calls, storage };
  };

  it('offline: no preventDefault (the import must still reject to its caller), no reload, the controller is told once', () => {
    const { action, calls, storage } = run({ online: false, waiting: false });
    assert.equal(action, 'await-online');
    assert.deepEqual(calls, { preventDefault: 0, reload: 0, awaitOnline: 1 });
    assert.equal(storage.data.has(CHUNK_RELOAD_KEY), false);
  });

  it('online while waiting: the same, and no rp:chunkReload', () => {
    const { action, calls, storage } = run({ online: true, waiting: true });
    assert.equal(action, 'await-online');
    assert.deepEqual(calls, { preventDefault: 0, reload: 0, awaitOnline: 1 });
    assert.equal(storage.data.has(CHUNK_RELOAD_KEY), false);
  });

  it('online, not waiting: preventDefault and reload the first time, neither the second', () => {
    const storage = memoryStorage();
    const first = run({ online: true, waiting: false, storage });
    assert.equal(first.action, 'reload');
    assert.deepEqual(first.calls, { preventDefault: 1, reload: 1, awaitOnline: 0 });
    const second = run({ online: true, waiting: false, storage });
    assert.equal(second.action, 'none');
    assert.deepEqual(second.calls, { preventDefault: 0, reload: 0, awaitOnline: 0 });
  });

  it('a non-chunk error does nothing offline either', () => {
    const { action, calls } = run({ online: false, waiting: false, payload: BUG });
    assert.equal(action, 'none');
    assert.deepEqual(calls, { preventDefault: 0, reload: 0, awaitOnline: 0 });
  });
});

/**
 * A controller on a fake clock with a probe the test answers.
 * @param {{ online?: boolean }} [o]
 */
function harness(o = {}) {
  let now = 0;
  let nextId = 1;
  /** @type {Map<number, { fn: () => void, at: number }>} */
  const timers = new Map();
  /** @type {Array<{ signal: AbortSignal, resolve: (v?: unknown) => void, reject: (e: unknown) => void, settled: boolean }>} */
  const probes = [];
  const h = {
    online: o.online ?? false,
    reloads: 0,
    changes: /** @type {string[]} */ ([]),
    probes,
    timers,
    get now() { return now; },
    /** Moves the clock; runs every timer that is due, in order. */
    async advance(/** @type {number} */ ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
    /** The last probe answers (the app: a status below 500). */
    async answer() { const p = probes.at(-1); assert.ok(p && !p.settled, 'a probe is running'); p.settled = true; p.resolve({ status: 200 }); await flush(); },
    /** The last probe fails (network error). */
    async fail() { const p = probes.at(-1); assert.ok(p && !p.settled, 'a probe is running'); p.settled = true; p.reject(new TypeError('Failed to fetch')); await flush(); },
  };
  const controller = createOfflineReload({
    online: () => h.online,
    probe: (signal) => new Promise((resolve, reject) => {
      const entry = { signal, resolve, reject, settled: false };
      probes.push(entry);
      // Like fetch: an abort rejects.
      signal.addEventListener('abort', () => { if (!entry.settled) { entry.settled = true; reject(new DOMException('aborted', 'AbortError')); } });
    }),
    reload: () => { h.reloads += 1; },
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(/** @type {number} */ (id)); },
    retryMs: RECONNECT_RETRY_MS,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
  });
  controller.subscribe(() => h.changes.push(controller.state()));
  return { h, c: controller };
}
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };

describe('chunkReload: createOfflineReload (the offline controller)', () => {
  it('nothing failed: online/offline events change nothing, never probe, never reload', async () => {
    const { h, c } = harness({ online: true });
    c.offline();
    h.online = false;
    c.online();
    h.online = true;
    c.online();
    await h.advance(60_000);
    assert.equal(c.state(), 'none');
    assert.equal(h.probes.length, 0);
    assert.equal(h.reloads, 0);
    assert.deepEqual(h.changes, []);
  });

  it('no probe while the browser says offline', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    assert.equal(c.state(), 'offline');
    await h.advance(60_000);
    c.online(); // an early event while navigator still says offline
    await flush();
    assert.equal(h.probes.length, 0);
    assert.equal(c.state(), 'offline');
    assert.equal(h.reloads, 0);
  });

  it('a page that degraded in place: offline → checking → the app answers → back, and no reload by itself', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    h.online = true;
    c.online();
    assert.equal(c.state(), 'checking');
    assert.equal(h.probes.length, 1);
    await h.answer();
    assert.equal(c.state(), 'back');
    await h.advance(60_000);
    assert.equal(h.reloads, 0, 'a usable page is never reloaded by itself');
    assert.deepEqual(h.changes, ['offline', 'checking', 'back'], 'listeners hear each state change');
    c.reloadNow(); // 「読み込み直す」
    assert.equal(h.reloads, 1);
  });

  it('a screen with nothing usable on it (requireReload) reloads once, as soon as the app answers', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    c.requireReload();
    h.online = true;
    c.online();
    await h.answer();
    assert.equal(h.reloads, 1);
    c.online();
    c.reloadNow();
    await h.advance(60_000);
    assert.equal(h.reloads, 1, 'once per page');
    assert.equal(h.probes.length, 1, 'no probe after the reload started');
  });

  it('requireReload while back: checks again, then reloads; a released blocker no longer reloads', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    h.online = true;
    c.online();
    const release = c.requireReload();
    release();
    release(); // twice is once
    await h.answer();
    assert.equal(c.state(), 'back');
    assert.equal(h.reloads, 0, 'the released screen asked for nothing');
    c.requireReload();
    assert.equal(c.state(), 'checking', 'the answer may be old: check again');
    assert.equal(h.probes.length, 2);
    await h.answer();
    assert.equal(h.reloads, 1);
  });

  it('the app keeps failing: unreachable (never back or checking again), a probe every retryMs, no reload (critique 6)', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    c.requireReload();
    h.online = true;
    c.online();
    assert.equal(c.state(), 'checking');
    await h.fail();
    assert.equal(c.state(), 'unreachable');
    for (let i = 2; i <= 4; i += 1) {
      await h.advance(RECONNECT_RETRY_MS - 1);
      assert.equal(h.probes.length, i - 1, 'not before retryMs');
      await h.advance(1);
      assert.equal(h.probes.length, i, `probe ${i} after retryMs`);
      assert.equal(c.state(), 'unreachable', 'a retry is not shown as checking');
      await h.fail();
      assert.equal(c.state(), 'unreachable');
    }
    assert.equal(h.reloads, 0);
    assert.deepEqual(h.changes, ['offline', 'checking', 'unreachable']);
    await h.advance(RECONNECT_RETRY_MS);
    await h.answer();
    assert.equal(h.reloads, 1, 'it answers at last: the blocked screen reloads');
  });

  it('a probe that never answers is aborted after probeTimeoutMs, counts as unreachable and is retried (critique 2a)', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    h.online = true;
    c.online();
    const first = h.probes[0];
    await h.advance(PROBE_TIMEOUT_MS - 1);
    assert.equal(first.signal.aborted, false);
    assert.equal(c.state(), 'checking');
    await h.advance(1);
    assert.equal(first.signal.aborted, true);
    assert.equal(c.state(), 'unreachable');
    await h.advance(RECONNECT_RETRY_MS);
    assert.equal(h.probes.length, 2, 'retried');
    assert.equal(h.reloads, 0);
  });

  it('offline during a probe aborts it and returns to offline; nothing reloads while offline', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    c.requireReload();
    h.online = true;
    c.online();
    const first = h.probes[0];
    h.online = false;
    c.offline();
    assert.equal(first.signal.aborted, true);
    assert.equal(c.state(), 'offline');
    await h.advance(60_000);
    assert.equal(h.reloads, 0);
    assert.equal(h.probes.length, 1);
  });

  it('an answer already on its way when offline → online happened is old evidence: only the new attempt counts (critique 2b)', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    c.requireReload();
    h.online = true;
    c.online();
    const first = h.probes[0];
    first.settled = true;
    first.resolve({ status: 200 }); // the answer is on its way (its continuation is queued) …
    h.online = false;
    c.offline(); // … but the page went offline …
    h.online = true;
    c.online(); // … and online again before it heard it
    assert.equal(h.probes.length, 2);
    await flush();
    assert.equal(h.reloads, 0, 'no reload on old evidence');
    assert.equal(c.state(), 'checking');
    await h.answer();
    assert.equal(h.reloads, 1, 'the new attempt answered');
  });

  it('a late answer of a superseded probe never reloads by itself (resolution arrives after the newer attempt started)', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    c.requireReload();
    h.online = true;
    c.online();
    const first = h.probes[0];
    // A second online event: a fresh check drops the first probe.
    c.online();
    assert.equal(first.signal.aborted, true);
    assert.equal(h.probes.length, 2);
    await flush();
    assert.equal(h.reloads, 0);
    assert.equal(c.state(), 'checking');
    await h.answer();
    assert.equal(h.reloads, 1);
  });

  it('offline cancels the retry timer while unreachable', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    h.online = true;
    c.online();
    await h.fail();
    assert.equal(c.state(), 'unreachable');
    assert.equal(h.timers.size, 1, 'the retry is scheduled');
    h.online = false;
    c.offline();
    assert.equal(h.timers.size, 0, 'and cancelled');
    await h.advance(60_000);
    assert.equal(h.probes.length, 1);
    assert.equal(c.state(), 'offline');
  });

  it('chunkFailed while the browser already says online goes straight to checking (event lag); in unreachable or back it changes nothing', async () => {
    const lag = harness({ online: true });
    lag.c.chunkFailed();
    assert.equal(lag.c.state(), 'checking');
    assert.equal(lag.h.probes.length, 1);

    const { h, c } = harness();
    c.chunkFailed();
    h.online = true;
    c.online();
    await h.fail();
    c.chunkFailed();
    assert.equal(c.state(), 'unreachable');
    assert.equal(h.probes.length, 1, 'no new probe: the retry timer runs');
    await h.advance(RECONNECT_RETRY_MS);
    await h.answer();
    assert.equal(c.state(), 'back');
    c.chunkFailed();
    assert.equal(c.state(), 'back');
    assert.equal(h.probes.length, 2);
    assert.equal(h.reloads, 0);
  });

  it('chunkFailed offline while waiting returns to offline and stops the probe', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    h.online = true;
    c.online();
    h.online = false;
    c.chunkFailed();
    assert.equal(c.state(), 'offline');
    assert.equal(h.probes[0].signal.aborted, true);
  });

  it('reloadNow: never while the browser says offline, at most once', async () => {
    const { h, c } = harness();
    c.chunkFailed();
    c.reloadNow();
    assert.equal(h.reloads, 0);
    h.online = true;
    c.reloadNow();
    c.reloadNow();
    assert.equal(h.reloads, 1);
    c.online();
    c.chunkFailed();
    await h.advance(60_000);
    assert.equal(h.probes.length, 0);
  });

  it('a listener that throws does not stop the others; unsubscribe stops one', () => {
    const { h, c } = harness();
    /** @type {string[]} */
    const heard = [];
    c.subscribe(() => { throw new Error('boom'); });
    const off = c.subscribe(() => heard.push(c.state()));
    c.chunkFailed();
    assert.deepEqual(heard, ['offline']);
    off();
    h.online = true;
    c.online();
    assert.deepEqual(heard, ['offline']);
    assert.deepEqual(h.changes, ['offline', 'checking']);
  });

  it('failures() counts every chunkFailed in every state, never after a reload started; listeners hear each one once (final review, finding 1)', async () => {
    // The reader notice shows only after a part failed while it is mounted (OfflineReloadNotice):
    // it needs a count that grows in every state, also when the state stays the same.
    const { h, c } = harness();
    let heard = 0;
    c.subscribe(() => { heard += 1; });
    const step = (/** @type {string} */ state, /** @type {number} */ failures, /** @type {string} */ why) => {
      const before = heard;
      c.chunkFailed();
      assert.equal(c.state(), state, why);
      assert.equal(c.failures(), failures, why);
      assert.equal(heard - before, 1, `${why}: listeners told once`);
    };
    assert.equal(c.failures(), 0);
    step('offline', 1, 'none → offline');
    step('offline', 2, 'offline, no change of state');
    h.online = true;
    c.online();
    assert.equal(c.state(), 'checking');
    step('checking', 3, 'checking');
    await h.fail();
    assert.equal(c.state(), 'unreachable');
    step('unreachable', 4, 'unreachable');
    await h.advance(RECONNECT_RETRY_MS);
    await h.answer();
    assert.equal(c.state(), 'back');
    step('back', 5, 'back, while the browser says online');
    c.reloadNow();
    assert.equal(h.reloads, 1);
    const before = heard;
    c.chunkFailed();
    assert.equal(c.failures(), 5, 'not after reloadNow()');
    assert.equal(heard, before);
    assert.equal(h.reloads, 1);
  });

  it('there is no page controller outside a browser', () => {
    assert.equal(pageOfflineReload(), null);
  });
});

describe('chunkReload: pageOfflineReload (the browser wiring)', () => {
  // Review round 1, finding 6. A fresh copy of the module (its own singleton), with a fake window,
  // navigator and fetch; the copy above keeps "no page controller outside a browser".
  it('one controller per page; window online/offline drive it; the probe is a same-origin HEAD of the page, no-store; reload is location.reload', async () => {
    const saved = ['window', 'navigator', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    /** @type {Map<string, Array<() => void>>} */
    const listeners = new Map();
    /** @type {Array<{ url: unknown, init: any, resolve: (v: unknown) => void }>} */
    const fetches = [];
    /** @type {Map<number, { fn: () => void, ms: number }>} */
    const timers = new Map();
    let nextId = 1;
    let onLine = false;
    let reloads = 0;
    const fakeWindow = {
      addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        /** @type {Array<() => void>} */ (listeners.get(type)).push(fn);
      },
      location: { href: 'https://app.example/learn/claude-code/cc-01-first-session', reload: () => { reloads += 1; } },
      setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
      clearTimeout: (/** @type {number} */ id) => { timers.delete(id); },
    };
    const fire = (/** @type {string} */ type) => { for (const fn of listeners.get(type) ?? []) fn(); };
    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return onLine; } }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: (/** @type {unknown} */ url, /** @type {any} */ init) => new Promise((resolve, reject) => {
        fetches.push({ url, init, resolve });
        // Like fetch: an abort rejects.
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    });
    try {
      const mod = await import('../../components/common/chunkReload.ts?page-wiring');
      const c = mod.pageOfflineReload();
      assert.ok(c, 'a controller in a browser');
      assert.equal(mod.pageOfflineReload(), c, 'one controller per page');
      assert.deepEqual([...listeners.keys()].sort(), ['offline', 'online']);
      assert.equal(listeners.get('online')?.length, 1);
      assert.equal(listeners.get('offline')?.length, 1);

      c.chunkFailed(); // navigator says offline
      assert.equal(c.state(), 'offline');
      assert.equal(fetches.length, 0);
      onLine = true;
      fire('online');
      assert.equal(c.state(), 'checking', "window 'online' → online()");
      assert.equal(fetches.length, 1);
      const first = fetches[0];
      assert.equal(first.url, fakeWindow.location.href, 'the page URL (same origin)');
      assert.deepEqual(Object.keys(first.init).sort(), ['cache', 'credentials', 'method', 'signal']);
      assert.equal(first.init.method, 'HEAD');
      assert.equal(first.init.cache, 'no-store', 'never answered from the HTTP cache while the app is unreachable');
      assert.equal(first.init.credentials, 'same-origin');
      assert.ok(first.init.signal instanceof AbortSignal);
      assert.deepEqual([...timers.values()].map((t) => t.ms), [mod.PROBE_TIMEOUT_MS], 'the probe timeout on window.setTimeout');

      onLine = false;
      fire('offline');
      assert.equal(c.state(), 'offline', "window 'offline' → offline()");
      assert.equal(first.init.signal.aborted, true, 'going offline aborts the probe');
      await flush();
      assert.equal(timers.size, 0, 'its timeout cleared (window.clearTimeout)');

      onLine = true;
      fire('online');
      assert.equal(fetches.length, 2);
      c.requireReload();
      fetches[1].resolve({ status: 200 });
      await flush();
      assert.equal(reloads, 1, 'location.reload() once the app answered');
      fire('online');
      fire('offline');
      await flush();
      assert.equal(reloads, 1);
      assert.equal(fetches.length, 2);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, /** @type {string} */ (key), /** @type {PropertyDescriptor} */ (descriptor));
        else delete (/** @type {any} */ (globalThis))[/** @type {string} */ (key)];
      }
    }
    assert.equal(typeof window, 'undefined', 'restored');
    assert.equal(pageOfflineReload(), null, 'the other copy is untouched');
  });
});

/**
 * A fresh copy of the module (its own page controller) on a fake window, navigator and fetch whose
 * answers the test gives; the shape of the wiring test above.
 * @param {string} tag
 * @param {(page: { c: any, mod: any, fire: (type: string) => void, fetches: Array<{ resolve: (v: unknown) => void }>, timers: Map<number, { fn: () => void, ms: number }>, setOnLine: (v: boolean) => void, reloads: () => number }) => Promise<void>} fn
 */
async function onFakePage(tag, fn) {
  const saved = ['window', 'navigator', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  /** @type {Map<string, Array<() => void>>} */
  const listeners = new Map();
  /** @type {Array<{ resolve: (v: unknown) => void }>} */
  const fetches = [];
  /** @type {Map<number, { fn: () => void, ms: number }>} */
  const timers = new Map();
  let nextId = 1;
  let onLine = false;
  let reloads = 0;
  const fakeWindow = {
    addEventListener: (/** @type {string} */ type, /** @type {() => void} */ f) => {
      if (!listeners.has(type)) listeners.set(type, []);
      /** @type {Array<() => void>} */ (listeners.get(type)).push(f);
    },
    location: { href: 'https://app.example/learn/claude-code/cc-01-first-session', reload: () => { reloads += 1; } },
    setTimeout: (/** @type {() => void} */ f, /** @type {number} */ ms) => { const id = nextId++; timers.set(id, { fn: f, ms }); return id; },
    clearTimeout: (/** @type {number} */ id) => { timers.delete(id); },
  };
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return onLine; } }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (/** @type {unknown} */ _url, /** @type {any} */ init) => new Promise((resolve, reject) => {
      fetches.push({ resolve });
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
  });
  try {
    const mod = await import(`../../components/common/chunkReload.ts?${tag}`);
    await fn({
      c: mod.pageOfflineReload(),
      mod,
      fire: (type) => { for (const f of listeners.get(type) ?? []) f(); },
      fetches,
      timers,
      setOnLine: (v) => { onLine = v; },
      reloads: () => reloads,
    });
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, /** @type {string} */ (key), /** @type {PropertyDescriptor} */ (descriptor));
      else delete (/** @type {any} */ (globalThis))[/** @type {string} */ (key)];
    }
  }
}

describe('chunkReload: pageOfflineReload probe answers (final review, finding 2)', () => {
  it('a 5xx is not the app (an edge or proxy error page): unreachable, no reload, a retry; the next 200 reloads', async () => {
    await onFakePage('page-wiring-5xx', async ({ c, mod, fire, fetches, timers, setOnLine, reloads }) => {
      c.chunkFailed(); // offline
      c.requireReload(); // a screen with nothing usable on it
      setOnLine(true);
      fire('online');
      assert.equal(fetches.length, 1);
      fetches[0].resolve({ status: 503 });
      await flush();
      assert.equal(c.state(), 'unreachable', 'never back or a reload on a 503');
      assert.equal(reloads(), 0, 'the tab never reloads onto the host error page');
      assert.deepEqual([...timers.values()].map((t) => t.ms), [mod.RECONNECT_RETRY_MS], 'probes again later');
      for (const status of [502, 504]) {
        const [id, retry] = [...timers.entries()][0];
        timers.delete(id);
        retry.fn();
        fetches.at(-1)?.resolve({ status });
        await flush();
        assert.equal(c.state(), 'unreachable', String(status));
        assert.equal(reloads(), 0, String(status));
      }
      const [id, retry] = [...timers.entries()][0];
      timers.delete(id);
      retry.fn();
      assert.equal(fetches.length, 4);
      fetches[3].resolve({ status: 200 });
      await flush();
      assert.equal(reloads(), 1, 'the app answered: reload once');
    });
  });

  it('a 4xx is the app answering (Express answers a HEAD of a page with 404): reloads where a screen asked for it', async () => {
    await onFakePage('page-wiring-404', async ({ c, fire, fetches, setOnLine, reloads }) => {
      c.chunkFailed();
      c.requireReload();
      setOnLine(true);
      fire('online');
      fetches[0].resolve({ status: 404 });
      await flush();
      assert.equal(reloads(), 1);
    });
  });
});

describe('chunkReload: boundaryKind (the root ErrorBoundary)', () => {
  const base = { reloadStarted: false, reloadTried: false };

  it('waiting beats "a new version" for a failed chunk', () => {
    assert.equal(boundaryKind(CHUNK, { ...base, wait: 'offline' }), 'offline');
    assert.equal(boundaryKind(CHUNK, { ...base, wait: 'checking' }), 'checking');
    assert.equal(boundaryKind(CHUNK, { ...base, wait: 'unreachable' }), 'unreachable');
    assert.equal(boundaryKind(CHUNK, { ...base, wait: 'back' }), 'checking', 'back: requireReload checks again at once');
    assert.equal(boundaryKind(CHUNK, { reloadStarted: true, reloadTried: true, wait: 'offline' }), 'offline');
  });

  it('other errors keep their wording while waiting', () => {
    assert.equal(boundaryKind(BUG, { ...base, wait: 'offline' }), 'error');
    assert.equal(boundaryKind(BUG, { ...base, wait: 'unreachable' }), 'error');
  });

  it('today\'s rows when nothing waits', () => {
    assert.equal(boundaryKind(CHUNK, { ...base, wait: 'none' }), 'stale');
    assert.equal(boundaryKind(CHUNK, { reloadStarted: false, reloadTried: true, wait: 'none' }), 'error');
    assert.equal(boundaryKind(BUG, { reloadStarted: true, reloadTried: true, wait: 'none' }), 'stale');
    assert.equal(boundaryKind(BUG, { ...base, wait: 'none' }), 'error');
    assert.equal(boundaryKind(null, { ...base, wait: 'none' }), 'error');
  });
});
