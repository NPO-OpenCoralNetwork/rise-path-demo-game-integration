// Lesson progress sync in the browser (components/lesson/progressSyncClient.ts): the wiring the
// core tests (lessonProgressSync.test.js) cannot see.
// - The page-hide upload calls fetch inside the pagehide handler (keepalive, this learner's token
//   from the last session event): getSession waits for a navigator lock, which runs in a later
//   task, after the page is gone.
// - No session during a token refresh is retried like a network error; another learner's
//   session is a 401.
// - The tab becoming visible or focused again refreshes (at most once a minute).
// - "Don't add" clears the other person's learning events and loads this learner's own again.
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
});
