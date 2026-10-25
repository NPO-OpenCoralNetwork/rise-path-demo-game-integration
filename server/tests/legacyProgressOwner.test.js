// Legacy course progress has an owner (Phase 5, design p5 §3.9, G25): services/progressService.ts
// stamps each rp_learning_progress entry with the learner this browser syncs, sends it only to that
// learner's account through apiFetchAs (the primary session must be theirs), drops other learners'
// and unowned entries at the next learner's hydrate (owner O3), and writes nothing in a tab that
// still shows another learner. The Blender course's stages earn XP on the server, so another
// person's stages must never reach it. The legacy PUT replaces completed_stages, so a change goes
// only on top of the learner's own data: their stored entry, or their server entry read first
// (until then, and until the server took it, it waits as their unmerged change). Without a synced
// learner a learner's entry is never built on or shown; a tab's own primary learner (not a Nexloom
// learner AuthContext may show beside it) decides whether it is stale. Learning events are posted
// for the learner they were recorded for.
// The modules are bundled with esbuild (Vite modules: import.meta.env, the bundled course outline)
// with the outline, Supabase and React stubbed, and run against a fake window, storage and fetch
// (the harness of lessonProgressSyncClient.test.js).
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const COURSE = 'course-a';
const ACCOUNT_KEY = 'rp:progressSync:account';
const LEGACY_KEY = 'rp_learning_progress';
const EVENTS_KEY = 'rp_learning_events';

const STUBS = {
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
      async getSession() {
        auth.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { data: { session: auth.session } };
      },
    },
  };

  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url).replace(/^\/api\/v2/, ''),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.url}`];
    if (route) return route(call);
    if (call.url === '/user/lesson-progress' && call.method === 'GET') return json(200, { ok: true, epoch: null, records: [] });
    if (call.url === '/user/progress' && call.method === 'GET') return json(200, { ok: true, progress: {} });
    if (call.url === '/user/events' && call.method === 'GET') return json(200, { ok: true, events: [] });
    if (call.url.startsWith('/user/progress/') && call.method === 'PUT') return json(200, { ok: true });
    if (call.url === '/user/events' && call.method === 'POST') return json(200, { ok: true, event: {} });
    return json(404, { ok: false });
  };

  loads += 1;
  const client = await import(`data:text/javascript;base64,${Buffer.from(`${bundle}\n// page ${loads}`).toString('base64')}`);
  return {
    client,
    storage,
    auth,
    calls,
    stagePuts: () => calls.filter((c) => c.method === 'PUT' && c.url.startsWith('/user/progress/')),
    eventPosts: () => calls.filter((c) => c.method === 'POST' && c.url === '/user/events'),
    gets: () => calls.filter((c) => c.url === '/user/lesson-progress' && c.method === 'GET'),
    legacy: () => JSON.parse(storage.getItem(LEGACY_KEY) ?? 'null'),
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

const EVENT = { type: 'stage_complete', title: { en: 'Stage', jp: 'ステージ' }, description: { en: '', jp: '' } };

describe('legacy Blender progress and learning events belong to a learner (G25)', () => {
  let current = null;

  before(async () => {
    const result = await build({
      stdin: {
        contents: [
          "export * from './components/lesson/progressSyncClient';",
          "export { markStageCompleted, setCompletedStepsForStage, hydrateFromApi, addLearningEvent, getCourseProgress, getCompletedStepsForStage, syncedOwner } from './services/progressService';",
          "export { setAuthProvider, currentAuthUserId, apiFetchAs } from './services/apiClient';",
        ].join('\n'),
        resolveDir: ROOT,
        loader: 'ts',
      },
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
    current?.client.stopProgressSync();
    current = null;
    await wait(50);
  });

  /** The learner signs in (primary session) and this page load's GET succeeded. */
  async function signedIn(t, userId, token) {
    t.client.setAuthProvider(() => userId);
    t.client.signInProgressSync(userId, token);
    assert.equal(await t.client.whenAccountKnown(), 'known');
  }

  it('the owner\'s stage: one PUT with the owner\'s own session, the entry stamped, the badges told; another learner\'s session gets nothing', async () => {
    const t = (current = await page());
    await signedIn(t, U1, 'tok-1');
    let stale = 0;
    window.addEventListener('rp:achievements-stale', () => {
      stale += 1;
    });
    t.client.markStageCompleted('blender', '3');
    await until(() => t.stagePuts().length === 1 && stale === 1);
    assert.equal(t.stagePuts()[0].url, '/user/progress/blender');
    assert.equal(t.stagePuts()[0].headers.Authorization, 'Bearer tok-session');
    assert.deepEqual(t.stagePuts()[0].body.completedStages, ['3']);
    assert.equal(t.legacy().blender.ownerId, U1);
    // Another tab switched the primary session to another learner before this tab heard of it.
    t.auth.session = { user: { id: U2 }, access_token: 'tok-u2' };
    t.client.markStageCompleted('blender', '4');
    await wait(60);
    assert.equal(t.stagePuts().length, 1, 'nothing reaches the other learner\'s account');
    assert.equal(stale, 1);
  });

  it('a session that ended with Blender stages and no lesson activity, then another learner: nothing pushed, the entry gone', async () => {
    const t = (current = await page());
    await signedIn(t, U1, 'tok-1');
    t.client.markStageCompleted('blender', '1');
    await until(() => t.stagePuts().length === 1);
    // The session expires (no logout here): no lesson records wait, so the account key goes.
    t.client.stopProgressSync();
    assert.equal(t.storage.getItem(ACCOUNT_KEY), null);
    assert.equal(t.legacy().blender.ownerId, U1);
    // Another learner signs in on this device.
    t.auth.session = { user: { id: U2 }, access_token: 'tok-u2' };
    await signedIn(t, U2, 'tok-u2');
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: t.client.syncedLearnerId() });
    await wait(50);
    assert.equal(t.stagePuts().length, 1, 'U1\'s stage never reaches U2');
    assert.deepEqual(t.legacy(), {});
  });

  /** U1 finishes Blender stages 1 and 2; their session ends without a logout (the entry stays, owned by U1); U2 signs in. */
  async function u1LeftThenU2(t) {
    await signedIn(t, U1, 'tok-1');
    t.client.markStageCompleted('blender', '1');
    await until(() => t.stagePuts().length === 1);
    t.client.markStageCompleted('blender', '2');
    await until(() => t.stagePuts().length === 2);
    assert.deepEqual(t.stagePuts()[1].body.completedStages, ['1', '2']);
    t.client.stopProgressSync();
    assert.equal(t.legacy().blender.ownerId, U1);
    t.auth.session = { user: { id: U2 }, access_token: 'tok-u2' };
    await signedIn(t, U2, 'tok-u2');
  }

  it('U1\'s stages left behind, U2 signs in and the events GET fails: the hydrate still drops them; U2\'s stage goes alone', async () => {
    const t = (current = await page({ routes: { 'GET /user/events': () => json(500, { ok: false }) } }));
    await u1LeftThenU2(t);
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: t.client.syncedLearnerId() });
    assert.deepEqual(t.legacy(), {}, 'U1\'s entry is gone although the events GET failed');
    t.client.markStageCompleted('blender', '3');
    await until(() => t.stagePuts().length === 3);
    assert.equal(t.stagePuts()[2].headers.Authorization, 'Bearer tok-u2');
    assert.deepEqual(t.stagePuts()[2].body.completedStages, ['3']);
  });

  it('U1\'s stages left behind and no hydrate yet (or its GETs failed): U2\'s stage goes on top of U2\'s own server entry, with none of U1\'s', async () => {
    const t = (current = await page({
      routes: {
        'GET /user/progress': (call) => json(200, {
          ok: true,
          progress: call.headers.Authorization === 'Bearer tok-u2' ? { blender: { completedStages: ['4'], completedSteps: { 4: ['s9'] } } } : {},
        }),
        'GET /user/events': () => json(500, { ok: false }),
      },
    }));
    await u1LeftThenU2(t);
    assert.deepEqual(t.client.getCourseProgress('blender').completedStages, [], 'U1\'s stages are not shown to U2 either');
    t.client.markStageCompleted('blender', '3');
    await until(() => t.stagePuts().length === 3);
    const put = t.stagePuts()[2];
    assert.equal(put.headers.Authorization, 'Bearer tok-u2');
    assert.deepEqual(put.body.completedStages, ['4', '3'], 'U2\'s server stages stay (the PUT replaces them); none of U1\'s');
    assert.deepEqual(put.body.completedSteps, { 4: ['s9'] });
    assert.equal(t.legacy().blender.ownerId, U2);
    await until(() => t.legacy().blender.unmerged === undefined); // once the server took it
  });

  it('the read of the learner\'s server entry fails: nothing is sent; the stages wait as their unmerged changes and the next hydrate puts them on top', async () => {
    let readFails = true;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => (readFails ? json(500, { ok: false }) : json(200, { ok: true, progress: { blender: { completedStages: ['1'], completedSteps: {} } } })),
      },
    }));
    await signedIn(t, U1, 'tok-1');
    t.client.markStageCompleted('blender', '3');
    t.client.markStageCompleted('blender', '4');
    await wait(60);
    assert.equal(t.stagePuts().length, 0);
    assert.deepEqual(t.legacy().blender.completedStages, ['3', '4']);
    assert.equal(t.legacy().blender.unmerged, true);
    assert.equal(t.legacy().blender.ownerId, U1);
    assert.deepEqual(t.client.getCourseProgress('blender').completedStages, ['3', '4'], 'shown here meanwhile');
    readFails = false;
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    await until(() => t.stagePuts().length === 1);
    assert.deepEqual(t.stagePuts()[0].body.completedStages, ['1', '3', '4']);
    await until(() => t.legacy().blender.unmerged === undefined); // once the server took it
    assert.deepEqual(t.legacy().blender.completedStages, ['1', '3', '4']);
  });

  it('changes made while the learner\'s server entry is read go with it: one read, one PUT', async () => {
    const t = (current = await page({
      routes: {
        'GET /user/progress': async () => {
          await wait(20);
          return json(200, { ok: true, progress: { blender: { completedStages: ['1'], completedSteps: { 1: ['a'] } } } });
        },
      },
    }));
    await signedIn(t, U1, 'tok-1');
    let stale = 0;
    window.addEventListener('rp:achievements-stale', () => {
      stale += 1;
    });
    t.client.setCompletedStepsForStage('blender', '2', ['x']);
    t.client.markStageCompleted('blender', '2');
    await until(() => t.stagePuts().length === 1 && stale >= 1);
    await wait(60);
    assert.equal(t.calls.filter((c) => c.method === 'GET' && c.url === '/user/progress').length, 1);
    assert.equal(t.stagePuts().length, 1);
    assert.deepEqual(t.stagePuts()[0].body, { completedStages: ['1', '2'], completedSteps: { 1: ['a'], 2: ['x'] } });
  });

  it('the progress GET fails: entries that are not the learner\'s go all the same; their own stay; an added unowned one waits as their unmerged change', async () => {
    const t = (current = await page({ routes: { 'GET /user/progress': () => json(500, { ok: false }) } }));
    t.storage.setItem(LEGACY_KEY, JSON.stringify({
      blender: { courseId: 'blender', progress: 0, completedStages: ['1', '2'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z', ownerId: U2 },
      mine: { courseId: 'mine', progress: 0, completedStages: ['m'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z', ownerId: U1 },
      guest: { courseId: 'guest', progress: 0, completedStages: ['g'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z' },
    }));
    await signedIn(t, U1, 'tok-1');
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    assert.deepEqual(Object.keys(t.legacy()).sort(), ['mine']);
    t.storage.setItem(LEGACY_KEY, JSON.stringify({
      ...t.legacy(),
      guest: { courseId: 'guest', progress: 0, completedStages: ['g'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z' },
    }));
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1, adoptUnowned: true });
    assert.deepEqual(Object.keys(t.legacy()).sort(), ['guest', 'mine']);
    assert.deepEqual([t.legacy().guest.ownerId, t.legacy().guest.unmerged], [U1, true]);
    assert.equal(t.legacy().mine.unmerged, undefined);
    assert.equal(t.stagePuts().length, 0);
  });

  it('the browser switches to another learner while the learner\'s server entry is read: nothing is merged or sent', async () => {
    let release = null;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => new Promise((resolve) => {
          release = () => resolve(json(200, { ok: true, progress: { blender: { completedStages: ['1'], completedSteps: {} } } }));
        }),
      },
    }));
    await signedIn(t, U1, 'tok-1');
    t.client.markStageCompleted('blender', '3');
    await until(() => release !== null);
    t.storage.setItem(ACCOUNT_KEY, JSON.stringify({ userId: U2, epoch: '?' }));
    release();
    await wait(60);
    assert.equal(t.stagePuts().length, 0);
    assert.equal(t.legacy().blender.unmerged, true);
  });

  it('a stage written without a synced account (Nexloom-only), then a primary sign-in: not pushed, not kept', async () => {
    const t = (current = await page({ session: null }));
    t.client.setAuthProvider(() => 'nexloom-only-learner');
    t.client.markStageCompleted('blender', '2');
    await wait(50);
    assert.equal(t.legacy().blender.ownerId, undefined, 'unowned');
    const before = t.stagePuts().length;
    t.auth.session = { user: { id: U1 }, access_token: 'tok-1' };
    await signedIn(t, U1, 'tok-1');
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: t.client.syncedLearnerId() });
    await wait(50);
    assert.equal(t.stagePuts().length, before);
    assert.deepEqual(t.legacy(), {});
  });

  it('a learner\'s entry left behind, then a stage without a synced learner (guest, Nexloom-only): built from nothing; the next learner\'s "Add" takes only that stage', async () => {
    const t = (current = await page());
    await signedIn(t, U1, 'tok-1');
    t.client.markStageCompleted('blender', '1');
    await until(() => t.stagePuts().length === 1);
    t.client.markStageCompleted('blender', '2');
    await until(() => t.stagePuts().length === 2);
    // U1's session expires with no lesson records waiting: the account key goes, the entry stays U1's.
    t.client.stopProgressSync();
    assert.equal(t.storage.getItem(ACCOUNT_KEY), null);
    assert.equal(t.legacy().blender.ownerId, U1);
    // Nobody synced here now (a Nexloom-only session): U1's stages are not shown nor built on.
    t.auth.session = null;
    t.client.setAuthProvider(() => 'nexloom-only-learner');
    assert.deepEqual(t.client.getCourseProgress('blender').completedStages, []);
    t.client.markStageCompleted('blender', '5');
    await until(() => t.stagePuts().length === 3);
    assert.deepEqual(t.stagePuts()[2].body.completedStages, ['5'], 'U1\'s stages are not sent with it');
    assert.deepEqual([t.legacy().blender.completedStages, t.legacy().blender.ownerId], [['5'], undefined]);
    // U2 signs in and chooses "Add": only the stage made without an owner comes along.
    t.auth.session = { user: { id: U2 }, access_token: 'tok-u2' };
    await signedIn(t, U2, 'tok-u2');
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U2, adoptUnowned: true });
    await until(() => t.stagePuts().length === 4);
    assert.equal(t.stagePuts()[3].headers.Authorization, 'Bearer tok-u2');
    assert.deepEqual(t.stagePuts()[3].body.completedStages, ['5'], 'none of U1\'s stages reach U2');
    assert.equal(t.legacy().blender.ownerId, U2);
  });

  it('unmerged changes stay marked until the server took them: not sent at a hydrate whose page load\'s GET failed, nor when the PUT fails; a step-only change still goes', async () => {
    let putStatus = 500;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => json(200, { ok: true, progress: { blender: { completedStages: ['1'], completedSteps: { 1: ['s1'] } } } }),
        'PUT /user/progress/blender': () => json(putStatus, { ok: putStatus === 200 }),
      },
    }));
    // A step of stage 1 recorded while U1's server entry was not known here.
    t.storage.setItem(LEGACY_KEY, JSON.stringify({
      blender: { courseId: 'blender', progress: 0, completedStages: [], completedSteps: { 1: ['s2'] }, lastAccessedAt: '2026-10-20T09:00:00.000Z', ownerId: U1, unmerged: true },
    }));
    await signedIn(t, U1, 'tok-1');
    await t.client.hydrateFromApi({ pushLocal: false, learnerId: U1 });
    await wait(30);
    assert.equal(t.stagePuts().length, 0);
    assert.deepEqual([t.legacy().blender.completedSteps, t.legacy().blender.unmerged], [{ 1: ['s1', 's2'] }, true], 'shown on top of the server entry, still marked');
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    await until(() => t.stagePuts().length === 1);
    await wait(30);
    assert.equal(t.legacy().blender.unmerged, true, 'the PUT failed: still marked');
    putStatus = 200;
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    await until(() => t.stagePuts().length === 2);
    assert.deepEqual(t.stagePuts()[1].body, { completedStages: ['1'], completedSteps: { 1: ['s1', 's2'] } });
    await until(() => t.legacy().blender.unmerged === undefined);
  });

  it('a merged change whose PUT fails stays marked: a stage goes later although the server meanwhile has as many stages', async () => {
    let server = { completedStages: ['1'], completedSteps: {} };
    let putStatus = 500;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => json(200, { ok: true, progress: { blender: server } }),
        'PUT /user/progress/blender': () => json(putStatus, { ok: putStatus === 200 }),
      },
    }));
    await signedIn(t, U1, 'tok-1');
    t.client.markStageCompleted('blender', '3');
    await until(() => t.stagePuts().length === 1);
    await wait(30);
    assert.deepEqual([t.legacy().blender.completedStages, t.legacy().blender.unmerged], [['1', '3'], true]);
    // Another device finished stage 2 meanwhile: the server has as many stages as this entry.
    server = { completedStages: ['1', '2'], completedSteps: {} };
    putStatus = 200;
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    await until(() => t.stagePuts().length === 2);
    assert.deepEqual(t.stagePuts()[1].body.completedStages, ['1', '2', '3']);
    await until(() => t.legacy().blender.unmerged === undefined);
  });

  it('a change made while a merged PUT is on its way goes in a second round', async () => {
    let release = null;
    let puts = 0;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => json(200, { ok: true, progress: { blender: { completedStages: ['1'], completedSteps: {} } } }),
        'PUT /user/progress/blender': () => {
          puts += 1;
          if (puts > 1) return json(200, { ok: true });
          return new Promise((resolve) => {
            release = () => resolve(json(200, { ok: true }));
          });
        },
      },
    }));
    await signedIn(t, U1, 'tok-1');
    let stale = 0;
    window.addEventListener('rp:achievements-stale', () => {
      stale += 1;
    });
    t.client.markStageCompleted('blender', '3');
    await until(() => release !== null);
    t.client.setCompletedStepsForStage('blender', '4', ['x']);
    await wait(20);
    release();
    await until(() => t.stagePuts().length === 2 && stale === 1);
    assert.deepEqual(t.stagePuts()[1].body, { completedStages: ['1', '3'], completedSteps: { 4: ['x'] } });
    await until(() => t.legacy().blender.unmerged === undefined);
  });

  it('a tab whose AuthContext shows a Nexloom learner beside its primary one writes for the primary learner the sync runs for', async () => {
    const t = (current = await page());
    await signedIn(t, U1, 'tok-1');
    t.client.setAuthProvider(() => 'nexloom-learner');
    t.client.markStageCompleted('blender', '3');
    t.client.addLearningEvent(EVENT);
    await until(() => t.stagePuts().length === 1 && t.eventPosts().length === 1);
    assert.equal(t.stagePuts()[0].headers.Authorization, 'Bearer tok-session');
    assert.equal(t.legacy().blender.ownerId, U1);
    // This tab's own primary learner is not the one this browser now syncs (another tab switched it): nothing.
    t.storage.setItem(ACCOUNT_KEY, JSON.stringify({ userId: U2, epoch: null }));
    t.client.setAuthProvider(() => U2);
    t.client.markStageCompleted('blender', '4');
    t.client.addLearningEvent(EVENT);
    await wait(50);
    assert.equal(t.stagePuts().length + t.eventPosts().length, 2);
  });

  it('the first load after the deploy: before the hydrate a stage page reads the unowned (pre-Phase 5) entry, as before; another learner\'s never', async () => {
    const t = (current = await page({
      routes: { 'GET /user/progress': () => json(200, { ok: true, progress: { blender: { completedStages: ['1'], completedSteps: { 2: ['s1', 's2'] } } } }) },
    }));
    t.storage.setItem(LEGACY_KEY, JSON.stringify({
      blender: { courseId: 'blender', progress: 0, completedStages: ['1'], completedSteps: { 2: ['s1', 's2'] }, lastAccessedAt: '2026-10-20T09:00:00.000Z' },
    }));
    await signedIn(t, U1, 'tok-1');
    assert.deepEqual(t.client.getCompletedStepsForStage('blender', '2'), ['s1', 's2'], 'not an empty stage (a toggle would replace its steps)');
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    assert.equal(t.legacy().blender.ownerId, U1);
    // The page read [s1, s2] before the hydrate; its toggle keeps them.
    t.client.setCompletedStepsForStage('blender', '2', ['s1', 's2', 's3']);
    await until(() => t.stagePuts().length === 1);
    assert.deepEqual(t.stagePuts()[0].body.completedSteps, { 2: ['s1', 's2', 's3'] });
    // Another learner's entry is never shown.
    t.storage.setItem(LEGACY_KEY, JSON.stringify({ blender: { ...t.legacy().blender, ownerId: U2 } }));
    assert.deepEqual(t.client.getCompletedStepsForStage('blender', '2'), []);
  });

  it('a stale tab (this browser now syncs another learner) writes and sends nothing: stages, steps or events', async () => {
    const t = (current = await page());
    t.storage.setItem(ACCOUNT_KEY, JSON.stringify({ userId: U2, epoch: null }));
    t.client.setAuthProvider(() => U1);
    t.client.markStageCompleted('blender', '1');
    t.client.setCompletedStepsForStage('blender', '1', ['s1']);
    t.client.addLearningEvent(EVENT);
    await wait(50);
    assert.equal(t.stagePuts().length + t.eventPosts().length, 0);
    assert.equal(t.storage.getItem(LEGACY_KEY), null);
    assert.equal(t.storage.getItem(EVENTS_KEY), null);
  });

  it('the account switched while hydrateFromApi\'s GETs ran: nothing is written', async () => {
    let release = null;
    const t = (current = await page({
      routes: {
        'GET /user/progress': () => new Promise((resolve) => {
          release = () => resolve(json(200, { ok: true, progress: { blender: { completedStages: ['1', '2'], completedSteps: {} } } }));
        }),
        'GET /user/events': () => json(200, { ok: true, events: [{ id: 'e1', ...EVENT, timestamp: '2026-10-20T09:00:00.000Z' }] }),
      },
    }));
    await signedIn(t, U1, 'tok-1');
    const hydrating = t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    await until(() => release !== null);
    t.storage.setItem(ACCOUNT_KEY, JSON.stringify({ userId: U2, epoch: '?' }));
    release();
    await hydrating;
    assert.equal(t.storage.getItem(LEGACY_KEY), null);
    assert.equal(t.storage.getItem(EVENTS_KEY), null);
  });

  it('the learner\'s own hydrate: remote entries are stamped, the learner\'s own local stages pushed with their session', async () => {
    const t = (current = await page({
      routes: { 'GET /user/progress': () => json(200, { ok: true, progress: { other: { completedStages: ['x'], completedSteps: {} } } }) },
    }));
    t.storage.setItem(LEGACY_KEY, JSON.stringify({
      blender: { courseId: 'blender', progress: 0, completedStages: ['1', '2'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z', ownerId: U1 },
    }));
    await signedIn(t, U1, 'tok-1');
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: U1 });
    await until(() => t.stagePuts().length === 1);
    assert.equal(t.stagePuts()[0].headers.Authorization, 'Bearer tok-session');
    assert.deepEqual(Object.keys(t.legacy()).sort(), ['blender', 'other']);
    assert.equal(t.legacy().other.ownerId, U1);
    assert.equal(t.legacy().blender.ownerId, U1);
  });

  it('"Add" adopts unowned legacy progress: stamped with the learner and pushed with their session', async () => {
    const t = (current = await page());
    t.storage.setItem('rp:progress:course-a:l1', JSON.stringify({ v: 1, seen: ['g1'], answers: {}, checks: {}, lastBlockId: null, updatedAt: new Date().toISOString() }));
    t.storage.setItem(LEGACY_KEY, JSON.stringify({
      blender: { courseId: 'blender', progress: 0, completedStages: ['s1'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z' },
    }));
    t.client.setAuthProvider(() => U1);
    t.client.signInProgressSync(U1, 'tok-1');
    t.client.chooseProgressAdoption(true);
    await until(() => t.stagePuts().length === 1);
    assert.equal(t.stagePuts()[0].headers.Authorization, 'Bearer tok-session');
    await until(() => t.legacy()?.blender?.ownerId === U1);
  });

  it('a learning event is posted for the learner it was recorded for, with their session; not into another learner\'s', async () => {
    const t = (current = await page());
    await signedIn(t, U1, 'tok-1');
    t.client.addLearningEvent(EVENT);
    await until(() => t.eventPosts().length === 1);
    assert.equal(t.eventPosts()[0].headers.Authorization, 'Bearer tok-session');
    t.auth.session = { user: { id: U2 }, access_token: 'tok-u2' };
    t.client.addLearningEvent(EVENT);
    await wait(60);
    assert.equal(t.eventPosts().length, 1);
  });

  it('without a synced learner (dev guests, mock users) the hydrate keeps local entries and pushes nothing', async () => {
    const t = (current = await page({
      routes: { 'GET /user/progress': () => json(200, { ok: true, progress: { other: { completedStages: ['x'], completedSteps: {} } } }) },
    }));
    t.storage.setItem(LEGACY_KEY, JSON.stringify({
      blender: { courseId: 'blender', progress: 0, completedStages: ['1'], completedSteps: {}, lastAccessedAt: '2026-10-20T09:00:00.000Z' },
    }));
    await t.client.hydrateFromApi({ pushLocal: true, learnerId: null });
    await wait(50);
    assert.equal(t.stagePuts().length, 0);
    assert.deepEqual(Object.keys(t.legacy()).sort(), ['blender', 'other']);
  });

  it('apiFetchAs sends nothing without a session or for another learner, and keeps the caller\'s headers', async () => {
    const t = (current = await page());
    assert.equal(await t.client.apiFetchAs(U2, '/user/progress'), null);
    t.auth.session = null;
    assert.equal(await t.client.apiFetchAs(U1, '/user/progress'), null);
    t.auth.session = { user: { id: U1 }, access_token: 'tok-s' };
    const res = await t.client.apiFetchAs(U1, '/user/progress', { headers: { 'X-Test': '1' } });
    assert.equal(res.status, 200);
    assert.deepEqual([t.calls.at(-1).headers.Authorization, t.calls.at(-1).headers['X-Test']], ['Bearer tok-s', '1']);
    assert.equal(t.calls.length, 1);
    t.client.setAuthProvider(() => U2);
    assert.equal(t.client.currentAuthUserId(), U2);
    t.client.setAuthProvider(() => null);
    assert.equal(t.client.currentAuthUserId(), null);
  });
});
