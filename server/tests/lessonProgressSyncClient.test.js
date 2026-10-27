// Lesson progress sync in the browser (components/lesson/progressSyncClient.ts): the wiring the
// core tests (lessonProgressSync.test.js) cannot see.
// - The page-hide upload calls fetch inside the pagehide handler (keepalive, this learner's token
//   from the last session event): getSession waits for a navigator lock, which runs in a later
//   task, after the page is gone.
// - No session during a token refresh is retried like a network error; another learner's
//   session is a 401.
// - The tab becoming visible or focused again refreshes (at most once a minute).
// - "Don't add" clears the other person's learning events and loads this learner's own again.
// - Phase 4: the legacy progress push waits for this page load's GET (whenAccountKnown) and is
//   skipped when it failed; forgetProgressAccount (account deleted) uploads nothing.
// - Phase 5: the one-lesson reset is a POST to /lesson-reset through the session check (G3);
//   another tab's pending markers and online/offline feed the save view.
// The client imports Vite modules (import.meta.env, import.meta.glob in content/index.ts), so it is
// bundled with esbuild (a Vite dependency, as in agentChatError.test.js) with the bundled course
// outline, Supabase and React stubbed, and run against a fake window, document, storage and fetch.
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const COURSE = 'course-a';
const PROGRESS_KEY = (lessonId) => `rp:progress:${COURSE}:${lessonId}`;

const STUBS = {
  // The bundled course outline: course-a with lessons named l*.
  content: `
    export const getCourse = (slug) => (slug === '${COURSE}' ? { id: slug, locale: 'jp' } : undefined);
    export const getLessonEntry = (course, id) => (course && id.startsWith('l') ? { ref: { title: { en: id, jp: id } } } : undefined);
  `,
  supabase: `
    export const getSupabaseClient = () => globalThis.__supabase ?? null;
    export const getNexloomSupabaseClient = () => null;
    export const isSupabaseConfigured = () => true;
  `,
  react: 'export const useSyncExternalStore = () => undefined;',
};

const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/\.\.\/content$/ }, () => ({ path: 'content', namespace: 'stub' }));
    b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};

let bundle = '';
let loads = 0;

function memoryStorage() {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A fresh page: window, document, localStorage, fetch and the primary Supabase session, then a
 * fresh copy of the client module (its sync instance is per page).
 */
async function page({ session = { user: { id: U1 }, access_token: 'tok-session' }, routes = {} } = {}) {
  const storage = memoryStorage();
  const win = new EventTarget();
  win.localStorage = storage;
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = storage;

  const auth = { calls: 0, session };
  globalThis.__supabase = {
    auth: {
      // auth-js takes a navigator lock first: the answer comes in a later task.
      async getSession() {
        auth.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { data: { session: auth.session } };
      },
    },
  };

  const calls = [];
  let inHandler = false;
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url).replace(/^\/api\/v2/, ''),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      keepalive: init.keepalive === true,
      body: init.body ? JSON.parse(init.body) : null,
      inHandler,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.url}`];
    if (route) return route(call);
    if (call.url === '/user/lesson-progress' && call.method === 'GET') return json(200, { ok: true, epoch: null, records: [] });
    if (call.url === '/user/lesson-progress' && call.method === 'PUT') {
      const records = call.body.records.map((r) => ({ ...r, pct: 10, state: 'in_progress', updatedAt: r.progress.updatedAt }));
      return json(200, { ok: true, epoch: null, records, rejected: [] });
    }
    return json(404, { ok: false });
  };

  loads += 1;
  const client = await import(`data:text/javascript;base64,${Buffer.from(`${bundle}\n// page ${loads}`).toString('base64')}`);
  return {
    client,
    storage,
    auth,
    calls,
    puts: () => calls.filter((c) => c.url === '/user/lesson-progress' && c.method === 'PUT'),
    gets: () => calls.filter((c) => c.url === '/user/lesson-progress' && c.method === 'GET'),
    /** Dispatches an event on the page and records which fetch calls ran inside the handler. */
    dispatch(target, event) {
      inHandler = true;
      try {
        target.dispatchEvent(event);
      } finally {
        inHandler = false;
      }
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(5);
  }
}

const record = (patch = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: new Date().toISOString(), ...patch });

/** A local write by the reader (progressStore.writeProgress announces it). */
function writeLocal(t, lessonId, progress) {
  t.storage.setItem(PROGRESS_KEY(lessonId), JSON.stringify(progress));
  window.dispatchEvent(new CustomEvent('rp:progress-change', { detail: { courseSlug: COURSE, lessonId } }));
}

describe('progress sync in the browser (progressSyncClient.ts)', () => {
  let current = null;

  before(async () => {
    const result = await build({
      stdin: { contents: "export * from './components/lesson/progressSyncClient';", resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env': '{"PROD":true}' },
      plugins: [stubPlugin],
      logLevel: 'silent',
    });
    bundle = result.outputFiles[0].text;
  });

  afterEach(async () => {
    // Stop the page's sync (its timers and retries end with it) and let a request still on its
    // way finish against this page's fakes, not the next one's.
    current?.client.stopProgressSync();
    current = null;
    await wait(50);
  });

  it('the page-hide upload calls fetch inside the handler, with keepalive and the token of this learner\'s last session event', async () => {
    const t = (current = await page());
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    const sessionReads = t.auth.calls;
    t.dispatch(window, new Event('pagehide'));
    const put = t.puts().at(-1);
    assert.ok(put, 'a PUT was sent');
    assert.equal(put.inHandler, true, 'fetch ran inside the pagehide handler');
    assert.equal(put.keepalive, true);
    assert.equal(put.headers.Authorization, 'Bearer tok-1');
    assert.deepEqual(put.body.records.map((r) => r.lessonId), ['l1']);
    assert.equal(t.auth.calls, sessionReads, 'no getSession before the fetch');
  });

  it('visibilitychange to hidden sends it the same way; ordinary uploads still check the session', async () => {
    const t = (current = await page());
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    document.visibilityState = 'hidden';
    t.dispatch(document, new Event('visibilitychange'));
    assert.equal(t.puts().at(-1)?.inHandler, true);
    assert.equal(t.puts().at(-1)?.keepalive, true);
    // The GET went through the session check and sent the session's token.
    assert.equal(t.gets()[0].headers.Authorization, 'Bearer tok-session');
    assert.equal(t.gets()[0].inHandler, false);
  });

  it('no cached token (signed out, or another learner\'s): the page-hide upload waits for the session check', async () => {
    const t = (current = await page());
    t.client.signInProgressSync(U1);
    await until(() => t.gets().length === 1);
    await wait(20);
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    t.dispatch(window, new Event('pagehide'));
    assert.equal(t.puts().length, 0);
    await until(() => t.puts().length === 1);
    assert.equal(t.puts()[0].headers.Authorization, 'Bearer tok-session');
    assert.equal(t.puts()[0].keepalive, true);
  });

  it('no session right now (a token refresh failed on the network) is retried; another learner\'s session is a 401', async () => {
    const random = Math.random;
    Math.random = () => 0;
    try {
      // No session: the GET is retried after 0.5 s (base 1 s × 0.5 jitter).
      const t = (current = await page({ session: null }));
      t.client.signInProgressSync(U1, 'tok-1');
      await wait(700);
      assert.equal(t.auth.calls, 2);
      assert.equal(t.gets().length, 0);
      t.client.stopProgressSync();
      await wait(50);

      // Another learner's session: 401, not retried.
      const u = (current = await page({ session: { user: { id: U2 }, access_token: 'tok-u2' } }));
      u.client.signInProgressSync(U1, 'tok-1');
      await wait(700);
      assert.equal(u.auth.calls, 1);
      assert.equal(u.gets().length, 0);
    } finally {
      Math.random = random;
    }
  });

  it('the tab becoming visible or focused again loads the server state once more, at most once a minute', async () => {
    const realNow = Date.now;
    let shift = 0;
    Date.now = () => realNow() + shift;
    try {
      const t = (current = await page());
      t.client.signInProgressSync(U1, 'tok-1');
      await until(() => t.gets().length === 1);
      await wait(20);
      t.dispatch(document, new Event('visibilitychange'));
      await wait(30);
      assert.equal(t.gets().length, 1);
      shift = 61_000;
      t.dispatch(document, new Event('visibilitychange'));
      await until(() => t.gets().length === 2);
      // Back from another window beside the browser: the page stayed visible, the window gets focus.
      shift = 122_000;
      t.dispatch(window, new Event('focus'));
      await until(() => t.gets().length === 3);
    } finally {
      Date.now = realNow;
    }
  });

  it('"Don\'t add" clears the other person\'s learning events, then loads this learner\'s own and announces it', async () => {
    const mine = [{ id: 'mine', type: 'lesson_start', title: { en: 'Mine', jp: 'Mine' }, description: { en: '', jp: '' }, timestamp: '2026-10-20T09:00:00.000Z' }];
    let eventsGets = 0;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => json(200, { ok: true, progress: {} }),
        'GET /user/events': () => {
          eventsGets += 1;
          return json(200, { ok: true, events: mine });
        },
      },
    }));
    // A guest studied here before (unowned progress, their streak and history).
    t.storage.setItem(PROGRESS_KEY('l1'), JSON.stringify(record({ seen: ['g1'] })));
    t.storage.setItem('rp_learning_events', JSON.stringify([{ id: 'guest', title: { en: 'Done: their lesson', jp: '完了: ほかの子のレッスン' } }]));
    const seen = [];
    window.addEventListener('rp:progress-account', () => seen.push(t.storage.getItem('rp_learning_events')));
    t.client.signInProgressSync(U1, 'tok-1');
    t.client.chooseProgressAdoption(false);
    // The dialog's close after the choice changes nothing more.
    t.client.chooseProgressAdoption(false);
    assert.equal(t.storage.getItem(PROGRESS_KEY('l1')), null);
    await until(() => seen.at(-1) === JSON.stringify(mine));
    assert.equal(eventsGets, 1);
    assert.ok(!t.storage.getItem('rp_learning_events').includes('guest'));
  });
  it('Phase 4: after "Add", local-only legacy progress is pushed only when this page load\'s GET succeeded', async () => {
    const legacy = JSON.stringify({ blender: { courseId: 'blender', progress: 0, completedStages: ['s1'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z' } });
    for (const getOk of [false, true]) {
      const t = (current = await page({
        routes: {
          ...(getOk ? {} : { 'GET /user/lesson-progress': () => json(401, { error: 'Invalid token', error_type: 'invalid_token' }) }),
          'GET /user/progress': () => json(200, { ok: true, progress: {} }),
          'GET /user/events': () => json(200, { ok: true, events: [] }),
          'PUT /user/progress/blender': () => json(200, { ok: true }),
        },
      }));
      t.storage.setItem(PROGRESS_KEY('l1'), JSON.stringify(record({ seen: ['g1'] })));
      t.storage.setItem('rp_learning_progress', legacy);
      t.client.signInProgressSync(U1, 'tok-1');
      t.client.chooseProgressAdoption(true);
      assert.equal(await t.client.whenAccountKnown(), getOk ? 'known' : 'unknown');
      await until(() => t.calls.some((c) => c.url === '/user/events'));
      await wait(30);
      const pushes = t.calls.filter((c) => c.method === 'PUT' && c.url === '/user/progress/blender');
      assert.equal(pushes.length, getOk ? 1 : 0, `GET ${getOk ? 'ok' : 'failed'}`);
      // The legacy progress stays on the device either way.
      assert.ok(t.storage.getItem('rp_learning_progress').includes('"s1"'));
      current.client.stopProgressSync();
      current = null;
      await wait(30);
    }
  });

  it('Phase 4: forgetProgressAccount clears this browser\'s lesson data and uploads nothing, not even on page hide', async () => {
    const t = (current = await page());
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    t.storage.setItem('rp_learning_events', '[{"id":"e1"}]');
    t.client.forgetProgressAccount();
    t.dispatch(window, new Event('pagehide'));
    await wait(50);
    assert.equal(t.puts().length, 0);
    assert.deepEqual([...t.storage.map.keys()], []);
    assert.equal(await t.client.whenAccountKnown(), 'unknown');
  });

  it('Phase 5 (G3): the one-lesson reset is a POST to /lesson-reset with the session\'s token, never a DELETE; Phase 6: a done reset marks the reviews stale', async () => {
    const t = (current = await page({
      routes: {
        'GET /user/lesson-progress': () => json(200, { ok: true, epoch: null, capabilities: { lessonReset: true, achievements: true, review: true }, records: [] }),
        'POST /user/lesson-progress/lesson-reset': (call) => json(200, {
          ok: true, epoch: null, courseSlug: call.body.courseSlug, lessonId: call.body.lessonId,
          lessonEpoch: '33333333-3333-4333-8333-333333333333', lessonResetAt: '2026-10-20T09:00:00.000Z',
          record: { courseSlug: call.body.courseSlug, lessonId: call.body.lessonId, progress: { v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '1970-01-01T00:00:00.000Z' }, pct: 0, state: 'not_started', updatedAt: '1970-01-01T00:00:00.000Z' },
        }),
      },
    }));
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    assert.deepEqual(t.client.progressCapabilities(), { lessonReset: true, achievements: true, review: true });
    let stale = 0;
    globalThis.window.addEventListener('rp:review-stale', () => { stale += 1; });
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: true });
    assert.equal(stale, 1, 'Phase 6 (R4): the server removed the lesson\'s review cards: the review store reads again');
    const resets = t.calls.filter((c) => c.url.startsWith('/user/lesson-progress') && c.method !== 'GET' && c.method !== 'PUT');
    assert.deepEqual(resets.map((c) => `${c.method} ${c.url}`), ['POST /user/lesson-progress/lesson-reset']);
    assert.deepEqual(resets[0].body, { epoch: null, courseSlug: COURSE, lessonId: 'l1' });
    assert.equal(resets[0].headers.Authorization, 'Bearer tok-session');
    assert.equal(JSON.parse(t.storage.getItem(PROGRESS_KEY('l1'))).lessonGen.epoch, '33333333-3333-4333-8333-333333333333');
    // Another learner's session: the session check refuses it before any request.
    t.auth.session = { user: { id: U2 }, access_token: 'tok-u2' };
    const before = t.calls.length;
    assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: false, reason: 'failed' });
    assert.equal(t.calls.length, before);
    assert.equal(stale, 1, 'a reset that did not happen marks nothing');
  });

  it('Phase 5: how the API layer reads a reset answer: a 200 without a uuid lessonEpoch is "unconfirmed" and changes nothing here; a malformed record is an emptied one; Phase 6: a reset that may have happened marks the reviews stale', async () => {
    let answer = { lessonEpoch: 'x' };
    let resetRoute = null;
    const t = (current = await page({
      routes: {
        'GET /user/lesson-progress': () => json(200, { ok: true, epoch: null, capabilities: { lessonReset: true, achievements: true, review: true }, records: [] }),
        'POST /user/lesson-progress/lesson-reset': (call) => (resetRoute ? resetRoute(call) : json(200, { ok: true, epoch: null, courseSlug: call.body.courseSlug, lessonId: call.body.lessonId, ...answer })),
      },
    }));
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    let stale = 0;
    globalThis.window.addEventListener('rp:review-stale', () => { stale += 1; });
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    const before = t.storage.getItem(PROGRESS_KEY('l1'));
    for (const bad of [{ lessonEpoch: 'x' }, {}, { lessonEpoch: null }, { lessonEpoch: 42 }]) {
      answer = bad;
      assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: false, reason: 'unconfirmed' }, JSON.stringify(bad));
      assert.equal(t.storage.getItem(PROGRESS_KEY('l1')), before, 'the local record is untouched');
    }
    assert.equal(stale, 4, 'Phase 6: the server did start the lesson over (a 2xx it could not read): its review cards are gone, the review store reads again');
    resetRoute = () => {
      throw new TypeError('Failed to fetch');
    };
    assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: false, reason: 'unconfirmed' });
    assert.equal(stale, 5, 'the connection dropped after sending: the server may have reset');
    resetRoute = () => json(429, { error: 'Too many', error_type: 'rate_limited' });
    assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: false, reason: 'rate_limited' });
    assert.equal(stale, 5, 'refused: nothing was reset');
    resetRoute = () => json(409, { ok: false, error: 'Progress was reset', error_type: 'progress_reset', epoch: '55555555-5555-4555-8555-555555555555' });
    const getsBefore = t.gets().length;
    assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: false, reason: 'reloaded' });
    assert.equal(stale, 6, 'everything was deleted on another device meanwhile: so were the review cards');
    // The 409 loads again: wait for that GET to finish (sync on), not a fixed delay (slow under a full run).
    await until(() => t.gets().length > getsBefore && t.client.getProgressSaveView().state === 'saved');
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    resetRoute = null;
    answer = { lessonEpoch: '33333333-3333-4333-8333-333333333333', lessonResetAt: 'not a date', record: { courseSlug: COURSE, lessonId: 'l1', progress: 'garbage' } };
    assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: true });
    assert.equal(stale, 7);
    const stored = JSON.parse(t.storage.getItem(PROGRESS_KEY('l1')));
    assert.deepEqual(stored.seen, [], 'an emptied record');
    assert.deepEqual(stored.lessonGen, { epoch: '33333333-3333-4333-8333-333333333333', resetAt: null });
  });

  it('Phase 6: a delete-all of the account\'s records marks the reviews stale; a failed one or this device\'s does not', async () => {
    let fail = true;
    const t = (current = await page({
      routes: {
        'DELETE /user/lesson-progress': () => (fail ? json(503, { ok: false, error_type: 'db_connection' }) : json(200, { ok: true, deleted: 1, epoch: '44444444-4444-4444-8444-444444444444' })),
      },
    }));
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    let stale = 0;
    globalThis.window.addEventListener('rp:review-stale', () => { stale += 1; });
    assert.deepEqual(await t.client.deleteLessonProgress(), { ok: false });
    assert.equal(stale, 0, 'nothing was deleted');
    fail = false;
    assert.deepEqual(await t.client.deleteLessonProgress(), { ok: true, scope: 'account' });
    assert.equal(stale, 1, 'the server removed every review card: the review store reads again');
    const guest = (current = await page({ session: null }));
    let guestStale = 0;
    globalThis.window.addEventListener('rp:review-stale', () => { guestStale += 1; });
    assert.deepEqual(await guest.client.deleteLessonProgress(), { ok: true, scope: 'device' });
    assert.equal(guestStale, 0, 'this device only: no server review state');
  });

  it('Phase 5: capabilities other than true are false: the reset is "unsupported" and never sent', async () => {
    const t = (current = await page({
      routes: { 'GET /user/lesson-progress': () => json(200, { ok: true, epoch: null, capabilities: { lessonReset: 'yes', achievements: 1, review: 'true' }, records: [] }) },
    }));
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    assert.deepEqual(t.client.progressCapabilities(), { lessonReset: false, achievements: false, review: false });
    writeLocal(t, 'l1', record({ seen: ['b1'] }));
    assert.deepEqual(await t.client.resetLessonProgress(COURSE, 'l1'), { ok: false, reason: 'unsupported' });
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 0);
  });

  it('Phase 5: another tab\'s pending markers and the browser going offline reach the save view', async () => {
    const t = (current = await page());
    t.client.signInProgressSync(U1, 'tok-1');
    await until(() => t.gets().length === 1);
    await wait(20);
    assert.equal(t.client.getProgressSaveView().state, 'saved');
    // Another tab wrote a record of this learner and its marker (a storage event here).
    t.storage.setItem(PROGRESS_KEY('l2'), JSON.stringify(record({ seen: ['x'] })));
    t.storage.setItem('rp:progressSync:pending:course-a:l2', record().updatedAt);
    const views = [];
    const off = t.client.subscribeProgressSaveView(() => views.push(t.client.getProgressSaveView()));
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'rp:progressSync:pending:course-a:l2' }));
    assert.equal(t.client.getProgressSaveView().pending, 1);
    assert.equal(t.client.getProgressSaveView().state, 'saving');
    globalThis.navigator ??= {};
    const onLine = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    try {
      window.dispatchEvent(new Event('offline'));
      assert.equal(t.client.getProgressSaveView().state, 'offline');
      assert.equal(t.client.getProgressSaveView().online, false);
    } finally {
      if (onLine) Object.defineProperty(globalThis.navigator, 'onLine', onLine);
      else delete globalThis.navigator.onLine;
    }
    window.dispatchEvent(new Event('online'));
    assert.equal(t.client.getProgressSaveView().online, true);
    assert.ok(views.length >= 2);
    off();
    // prepareProgressSignOut uploads and counts; it never throws.
    assert.deepEqual(await t.client.prepareProgressSignOut(), { unsaved: 0 });
    assert.equal(t.puts().at(-1).body.records[0].lessonId, 'l2');
  });

  it('the legacy progress hydrate waits for the adoption choice; "Add" runs it after the choice', async () => {
    let legacyGets = 0;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => {
          legacyGets += 1;
          return json(200, { ok: true, progress: {} });
        },
        'GET /user/events': () => json(200, { ok: true, events: [] }),
      },
    }));
    t.storage.setItem(PROGRESS_KEY('l1'), JSON.stringify(record({ seen: ['g1'] })));
    t.client.signInProgressSync(U1, 'tok-1');
    assert.equal(t.client.progressChoicePending(), true);
    t.client.chooseProgressAdoption(true);
    assert.equal(t.client.progressChoicePending(), false);
    await until(() => legacyGets === 1);
    assert.ok(t.storage.getItem(PROGRESS_KEY('l1')));
  });
});
