// Phase 5 front end (design p5 §3.7, §4.4). Stage 3: the React-free stores the UI reads.
// - components/lesson/logoutGuard.ts: the logout gate (O4). A "sign in again" button never asks
//   (G28); no dialog host, nothing that syncs or nothing unsaved: no question; the upload always
//   runs first; one question at a time, each with a new `ask` (G29: the dialog mounts fresh); the
//   return target is the element focused at the call; focus falls back to the menu button, then
//   #main-content (G30).
// - components/ui/achievementsClient.ts (createAchievementsStore): no_account without a synced
//   learner, the learner binding of answers, the capability rule, a 404 without error_type latched
//   as "unsupported" for the page load (G14), errors, the debounce, single flight.
// - services/achievementsApi.ts: the answer's shape, refusals and an older server's HTML 404.
// The modules are bundled with esbuild (a Vite dependency) with their imports stubbed, and loaded
// fresh for each test (module-level state).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';

const STUBS = {
  // logoutGuard's view of the sync: globalThis.__view / __prepare.
  syncForGuard: `
    export const getProgressSaveView = () => globalThis.__view ?? { state: 'local', userId: null };
    export const prepareProgressSignOut = async () => {
      globalThis.__prepared = (globalThis.__prepared ?? 0) + 1;
      return globalThis.__prepare ? globalThis.__prepare() : { unsaved: 0 };
    };
  `,
  syncForAchievements: `
    export const syncedLearnerId = () => globalThis.__learner ?? null;
    export const progressCapabilities = () => globalThis.__caps ?? null;
    export const runAsSyncedLearner = (call) => call();
    export const subscribeProgressSaveView = () => () => {};
  `,
  react: `
    export const useEffect = () => {};
    export const useSyncExternalStore = (subscribe, get) => get();
  `,
  supabase: `
    export const getSupabaseClient = () => null;
    export const getNexloomSupabaseClient = () => null;
    export const isSupabaseConfigured = () => false;
  `,
};

async function bundle(entry, stubs) {
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: { 'import.meta.env': '{"PROD":true}' },
    plugins: [{
      name: 'stubs',
      setup(b) {
        for (const [filter, name] of stubs) b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
      },
    }],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

let loads = 0;
const fresh = (code) => import(`data:text/javascript;base64,${Buffer.from(`${code}\n// load ${(loads += 1)}`).toString('base64')}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The promise's value, or 'still waiting' after `ms` (a missing guard fails instead of hanging). */
const within = (promise, ms = 200) => Promise.race([promise, wait(ms).then(() => 'still waiting')]);

/** A tiny DOM: focusable elements that take focus unless `refuses`. */
function fakeDocument() {
  const doc = { activeElement: null, body: { tag: 'body' }, buttons: [], main: null };
  doc.activeElement = doc.body;
  doc.element = (name, { refuses = false, connected = true } = {}) => ({
    name,
    isConnected: connected,
    focus() {
      if (!refuses) doc.activeElement = this;
    },
  });
  doc.querySelectorAll = (selector) => (selector === 'button[aria-controls="app-sidebar"]' ? doc.buttons : []);
  doc.getElementById = (id) => (id === 'main-content' ? doc.main : null);
  return doc;
}

describe('logoutGuard: the question before a logout (O4)', () => {
  let code = '';
  before(async () => {
    code = await bundle("export * from './components/lesson/logoutGuard';", [[/\/progressSyncClient$/, 'syncForGuard']]);
  });

  async function guard({ view = { state: 'saving', userId: U1 }, prepare = () => ({ unsaved: 0 }) } = {}) {
    globalThis.__view = view;
    globalThis.__prepare = prepare;
    globalThis.__prepared = 0;
    globalThis.document = fakeDocument();
    return fresh(code);
  }

  it('G28: a "sign in again" button never asks and never uploads first', async () => {
    const g = await guard({ prepare: () => ({ unsaved: 3 }) });
    g.registerLogoutDialog();
    assert.equal(await within(g.confirmUnsavedLearning({ reason: 'reauth' })), true);
    assert.equal(globalThis.__prepared, 0);
    assert.equal(g.getLogoutPhase().kind, 'idle');
  });

  it('no dialog host, or nothing that syncs ("local", no learner): true at once, no upload', async () => {
    const noHost = await guard({ prepare: () => ({ unsaved: 3 }) });
    assert.equal(await within(noHost.confirmUnsavedLearning()), true);
    assert.equal(globalThis.__prepared, 0);
    for (const view of [{ state: 'local', userId: U1 }, { state: 'saved', userId: null }]) {
      const g = await guard({ view, prepare: () => ({ unsaved: 3 }) });
      g.registerLogoutDialog();
      assert.equal(await within(g.confirmUnsavedLearning()), true);
      assert.equal(globalThis.__prepared, 0);
    }
  });

  it('the upload always runs first; nothing unsaved: true, no question', async () => {
    const g = await guard({ view: { state: 'saved', userId: U1 } });
    g.registerLogoutDialog();
    assert.equal(await g.confirmUnsavedLearning(), true);
    assert.equal(globalThis.__prepared, 1);
    assert.equal(g.getLogoutPhase().kind, 'idle');
  });

  it('unsaved records: one question ("asking" with the count and a new ask each time), answered by the learner', async () => {
    const g = await guard({ prepare: () => ({ unsaved: 2 }) });
    g.registerLogoutDialog();
    const phases = [];
    g.subscribeLogoutPhase(() => phases.push(g.getLogoutPhase()));
    const first = g.confirmUnsavedLearning();
    assert.equal(g.confirmUnsavedLearning(), first, 'a second call gets the same answer');
    await wait(5);
    assert.deepEqual(g.getLogoutPhase(), { kind: 'asking', unsaved: 2, ask: 1 });
    g.answerUnsavedLearning(false);
    assert.equal(await first, false, '「ログアウトしない」');
    assert.equal(g.getLogoutPhase().kind, 'idle');
    const second = g.confirmUnsavedLearning();
    await wait(5);
    assert.deepEqual(g.getLogoutPhase(), { kind: 'asking', unsaved: 2, ask: 2 }, 'a fresh question');
    g.answerUnsavedLearning(true);
    assert.equal(await second, true, '「このままログアウト」');
    assert.equal(globalThis.__prepared, 2);
    assert.deepEqual(phases.map((p) => p.kind), ['asking', 'idle', 'asking', 'idle']);
    g.answerUnsavedLearning(true); // nothing open: ignored
  });

  it('"checking" shows only when the upload takes longer than 400 ms; nothing can answer then', async () => {
    let release;
    const g = await guard({ prepare: () => new Promise((resolve) => { release = () => resolve({ unsaved: 1 }); }) });
    g.registerLogoutDialog();
    const answer = g.confirmUnsavedLearning();
    await wait(200);
    assert.equal(g.getLogoutPhase().kind, 'idle', 'no flash for a fast upload');
    await wait(g.LOGOUT_CHECKING_DELAY_MS);
    assert.equal(g.getLogoutPhase().kind, 'checking');
    g.answerUnsavedLearning(true);
    assert.equal(g.getLogoutPhase().kind, 'checking');
    release();
    await wait(5);
    assert.equal(g.getLogoutPhase().kind, 'asking');
    g.answerUnsavedLearning(false);
    assert.equal(await answer, false);
  });

  it('the dialog going away while asking answers "stay signed in"', async () => {
    const g = await guard({ prepare: () => ({ unsaved: 1 }) });
    const unregister = g.registerLogoutDialog();
    const answer = g.confirmUnsavedLearning();
    await wait(5);
    unregister();
    unregister();
    assert.equal(await within(answer), false);
  });

  it('the dialog going away during the upload: no question, the logout goes on; the next logout asks afresh', async () => {
    let release;
    const g = await guard({ prepare: () => new Promise((resolve) => { release = () => resolve({ unsaved: 2 }); }) });
    const unregister = g.registerLogoutDialog();
    const answer = g.confirmUnsavedLearning();
    await wait(5);
    unregister(); // 'idle' or 'checking': nothing to answer yet
    release();
    assert.equal(await within(answer), true, 'not left waiting for a question nobody can answer');
    assert.equal(g.getLogoutPhase().kind, 'idle');
    g.registerLogoutDialog();
    const next = g.confirmUnsavedLearning();
    assert.notEqual(next, answer, 'not the old pending answer');
    release();
    await wait(5);
    assert.deepEqual(g.getLogoutPhase(), { kind: 'asking', unsaved: 2, ask: 1 });
    g.answerUnsavedLearning(false);
    assert.equal(await within(next), false);
  });

  it('G30: the return target is the element focused at the call; focus falls back to the menu button, then #main-content', async () => {
    const g = await guard({ prepare: () => ({ unsaved: 1 }) });
    g.registerLogoutDialog();
    const doc = globalThis.document;
    const logoutButton = doc.element('logout', { refuses: true }); // in a closed drawer: invisible
    doc.activeElement = logoutButton;
    const answer = g.confirmUnsavedLearning();
    doc.activeElement = doc.body; // the drawer closed
    assert.equal(g.logoutReturnTarget(), logoutButton);
    await wait(5);
    g.answerUnsavedLearning(false);
    await answer;
    const menu = doc.element('menu');
    const rail = doc.element('rail');
    doc.buttons = [doc.element('detached', { connected: false }), menu, rail];
    doc.main = doc.element('main');
    assert.equal(g.restoreLogoutFocus(), menu);
    doc.buttons = [];
    assert.equal(g.restoreLogoutFocus(logoutButton), doc.main);
    const ok = doc.element('ok');
    assert.equal(g.restoreLogoutFocus(ok), ok);
    doc.main = null;
    assert.equal(g.restoreLogoutFocus(logoutButton), null);
  });

  it('the page body is never a return target', async () => {
    const g = await guard({ prepare: () => ({ unsaved: 0 }) });
    g.registerLogoutDialog();
    globalThis.document.activeElement = globalThis.document.body;
    await g.confirmUnsavedLearning();
    assert.equal(g.logoutReturnTarget(), null);
  });
});

const ACHIEVEMENTS = (learnerId = U1, total = 230) => ({
  ok: true,
  learnerId,
  xp: { total, level: 3, intoLevel: 30, levelSize: 100, toNextLevel: 70 },
  counts: { lessonsStarted: 5, lessonsDone: 4, stagesDone: 1 },
  streak: { current: 3, best: 5, activeToday: true, today: '2026-10-25', timeZone: 'Asia/Tokyo' },
  badges: [
    { id: 'first_lesson', earned: true, current: 1, goal: 1 },
    { id: 'first_course', earned: false, current: 9, goal: 13, course: 'vibe-coding' },
    { id: 'future_badge', earned: true, current: 1, goal: 1 },
  ],
});

describe('achievementsClient: the XP store', () => {
  let mod = null;
  before(async () => {
    const code = await bundle(
      "export * from './components/ui/achievementsClient'; export { AchievementsApiError, parseAchievements } from './services/achievementsApi';",
      [[/\/progressSyncClient$/, 'syncForAchievements'], [/^react$/, 'react'], [/supabaseClient$/, 'supabase']],
    );
    mod = await fresh(code);
  });

  /** A store with fake timers, clock and load. */
  function store({ learner = U1, caps = { lessonReset: true, achievements: true }, load } = {}) {
    let t = 0;
    const queue = [];
    const env = { learner, caps, loads: 0 };
    const s = mod.createAchievementsStore({
      load: async () => {
        env.loads += 1;
        return load ? load(env) : mod.parseAchievements(ACHIEVEMENTS(env.learner?.toUpperCase()));
      },
      learnerId: () => env.learner,
      capabilities: () => env.caps,
      now: () => t,
      setTimeout: (fn, ms) => {
        const h = { at: t + ms, fn };
        queue.push(h);
        return h;
      },
      clearTimeout: (h) => {
        const i = queue.indexOf(h);
        if (i >= 0) queue.splice(i, 1);
      },
    });
    env.advance = async (ms) => {
      const end = t + ms;
      for (;;) {
        await s.settled();
        queue.sort((a, b) => a.at - b.at);
        if (!queue[0] || queue[0].at > end) break;
        const h = queue.shift();
        t = h.at;
        h.fn();
      }
      t = end;
      await s.settled();
    };
    return { s, env };
  }

  it('no synced learner: no_account, no request', async () => {
    const { s, env } = store({ learner: null });
    s.consumerMounted();
    await s.settled();
    assert.equal(s.getSnapshot().status, 'no_account');
    assert.equal(env.loads, 0);
  });

  it('a consumer mounts: loading, then ready; fresh for 30 s; the learner id is compared in lower case', async () => {
    const { s, env } = store();
    s.consumerMounted();
    assert.equal(s.getSnapshot().status, 'loading');
    await s.settled();
    const snap = s.getSnapshot();
    assert.equal(snap.status, 'ready');
    assert.equal(snap.learnerId, U1);
    assert.equal(snap.data.xp.total, 230);
    assert.deepEqual(snap.data.badges.map((b) => b.id), ['first_lesson', 'first_course'], 'unknown badges left out');
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 1);
    await env.advance(30_000);
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 2);
  });

  it('an answer for another learner is dropped and fetched once more; still another: nothing shown', async () => {
    let answers = [U2, U1];
    const { s, env } = store({ load: () => mod.parseAchievements(ACHIEVEMENTS(answers.shift())) });
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 2);
    assert.equal(s.getSnapshot().status, 'ready');
    assert.equal(s.getSnapshot().data.learnerId, U1);
    answers = [U2, U2];
    const other = store({ load: () => mod.parseAchievements(ACHIEVEMENTS(answers.shift())) });
    other.s.consumerMounted();
    await other.s.settled();
    assert.equal(other.env.loads, 2);
    assert.equal(other.s.getSnapshot().status, 'unavailable');
    assert.equal(other.s.getSnapshot().data, null);
  });

  it('G14: a 404 without error_type is an older server: unsupported for the page load, no more requests', async () => {
    const { s, env } = store({ caps: null, load: () => { throw new mod.AchievementsApiError('Request failed (404)', 404); } });
    s.consumerMounted();
    await s.settled();
    assert.equal(s.getSnapshot().status, 'unsupported');
    env.caps = { lessonReset: true, achievements: true };
    s.consumerMounted();
    s.stale();
    s.serverProgress();
    s.syncChanged();
    await s.reload();
    await env.advance(60_000);
    assert.equal(env.loads, 1);
    assert.equal(s.getSnapshot().status, 'unsupported');
  });

  it('a 404 with an error_type is a refusal, not a missing route', async () => {
    let fails = true;
    const { s, env } = store({ load: () => {
      if (fails) throw new mod.AchievementsApiError('nope', 404, 'not_found');
      return mod.parseAchievements(ACHIEVEMENTS(U1));
    } });
    s.consumerMounted();
    await s.settled();
    assert.equal(s.getSnapshot().status, 'unavailable');
    fails = false;
    await s.reload();
    assert.equal(s.getSnapshot().status, 'ready');
    assert.equal(env.loads, 2);
  });

  it('capabilities: achievements false → unsupported without a request; unknown → one probe until the sync knows', async () => {
    const off = store({ caps: { lessonReset: false, achievements: false } });
    off.s.consumerMounted();
    await off.s.settled();
    assert.equal(off.s.getSnapshot().status, 'unsupported');
    assert.equal(off.env.loads, 0);

    let fails = true;
    const { s, env } = store({ caps: null, load: () => {
      if (fails) throw new mod.AchievementsApiError('Network error', 0, 'network');
      return mod.parseAchievements(ACHIEVEMENTS(U1));
    } });
    s.consumerMounted();
    await s.settled();
    assert.equal(s.getSnapshot().status, 'unavailable');
    s.consumerMounted();
    await s.reload();
    assert.equal(env.loads, 1, 'one probe per page load while the capabilities are unknown');
    fails = false;
    env.caps = { lessonReset: true, achievements: true };
    s.syncChanged();
    await s.settled();
    assert.equal(env.loads, 2, 'the capabilities arrived: fetched');
    assert.equal(s.getSnapshot().status, 'ready');
  });

  it('an older VM (achievements false): "unsupported" stays still on every save; an upgraded VM\'s capabilities fetch at once', async () => {
    const { s, env } = store({ caps: { lessonReset: false, achievements: false } });
    s.consumerMounted();
    await s.settled();
    assert.deepEqual([s.getSnapshot().status, s.getSnapshot().learnerId], ['unsupported', U1]);
    const seen = [];
    s.subscribe(() => seen.push(s.getSnapshot().status));
    for (let i = 0; i < 3; i += 1) s.syncChanged(); // the save view changes with every save
    await s.settled();
    assert.deepEqual(seen, [], 'no flip between idle and unsupported');
    assert.equal(env.loads, 0);
    env.caps = { lessonReset: true, achievements: true }; // the next GET after the VM was upgraded
    s.syncChanged();
    await s.settled();
    assert.equal(env.loads, 1);
    assert.equal(s.getSnapshot().status, 'ready');
    s.syncChanged();
    await s.settled();
    assert.equal(env.loads, 1, 'once');
  });

  it('errors keep the same learner\'s data on screen; with nothing to show they are "unavailable"', async () => {
    let fail = false;
    const { s } = store({ load: () => {
      if (fail) throw new mod.AchievementsApiError('down', 503, 'achievements_unavailable');
      return mod.parseAchievements(ACHIEVEMENTS(U1));
    } });
    s.consumerMounted();
    await s.settled();
    const data = s.getSnapshot().data;
    fail = true;
    await s.reload();
    assert.equal(s.getSnapshot().status, 'ready');
    assert.equal(s.getSnapshot().data, data);
  });

  it('server-sourced lesson records: one fetch 2 s after the last, at most every 15 s; none without a consumer', async () => {
    const { s, env } = store();
    const unmount = s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 1);
    s.serverProgress();
    await env.advance(1_000);
    s.serverProgress();
    await env.advance(1_999);
    assert.equal(env.loads, 1, 'trailing');
    await env.advance(1);
    assert.equal(env.loads, 2);
    s.serverProgress();
    await env.advance(2_000);
    assert.equal(env.loads, 2, 'not within 15 s of the last');
    await env.advance(13_000);
    assert.equal(env.loads, 3);
    unmount();
    s.serverProgress();
    await env.advance(60_000);
    assert.equal(env.loads, 3);
    assert.equal(s.getSnapshot().at, null, 'marked stale: the next consumer fetches');
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 4);
  });

  it('ACHIEVEMENTS_STALE_EVENT (a Blender stage): fetched at once with a consumer; a request asked for meanwhile runs once after', async () => {
    let release = null;
    const { s, env } = store({ load: () => new Promise((resolve) => { release = () => resolve(mod.parseAchievements(ACHIEVEMENTS(U1))); }) });
    s.consumerMounted();
    s.stale();
    s.stale();
    assert.equal(env.loads, 1);
    release();
    await wait(5);
    assert.equal(env.loads, 2, 'once more after the running one');
    release();
    await s.settled();
    assert.equal(env.loads, 2);
  });

  it('another learner: what was shown goes at once and their own is fetched; nobody: no_account', async () => {
    const { s, env } = store();
    s.consumerMounted();
    await s.settled();
    env.learner = U2;
    s.syncChanged();
    assert.equal(s.getSnapshot().data, null);
    await s.settled();
    assert.equal(s.getSnapshot().learnerId, U2);
    assert.equal(s.getSnapshot().status, 'ready');
    env.learner = null;
    s.syncChanged();
    assert.equal(s.getSnapshot().status, 'no_account');
    assert.equal(s.getSnapshot().data, null);
    const loads = env.loads;
    env.learner = U2;
    s.syncChanged();
    await s.settled();
    assert.equal(env.loads, loads + 1);
  });
});

describe('achievementsApi: the answer and its refusals', () => {
  let mod = null;
  before(async () => {
    const code = await bundle("export * from './services/achievementsApi';", [[/supabaseClient$/, 'supabase']]);
    mod = await fresh(code);
  });

  const respond = (status, body, { text = false } = {}) => {
    globalThis.fetch = async (url) => {
      respond.url = String(url);
      return new Response(text ? body : JSON.stringify(body), { status, headers: { 'Content-Type': text ? 'text/html' : 'application/json' } });
    };
  };

  it('200: parsed, the learner id in lower case', async () => {
    respond(200, ACHIEVEMENTS(U1.toUpperCase()));
    const data = await mod.getAchievements();
    assert.equal(respond.url, '/api/v2/user/achievements');
    assert.equal(data.learnerId, U1);
    assert.equal(data.streak.timeZone, 'Asia/Tokyo');
  });

  it('an older server\'s HTML 404: status 404 and no errorType; refusals carry their error_type; a malformed 200 is bad_response; the network is 0', async () => {
    respond(404, '<!DOCTYPE html><title>Error</title>', { text: true });
    await assert.rejects(mod.getAchievements(), (err) => err.status === 404 && err.errorType === undefined);
    respond(503, { ok: false, error: 'down', error_type: 'achievements_unavailable' });
    await assert.rejects(mod.getAchievements(), (err) => err.status === 503 && err.errorType === 'achievements_unavailable');
    respond(401, { error: 'Sign in', error_type: 'sign_in_required' });
    await assert.rejects(mod.getAchievements(), (err) => err.status === 401 && err.errorType === 'sign_in_required');
    respond(200, { ok: true, learnerId: U1, xp: { total: -1 } });
    await assert.rejects(mod.getAchievements(), (err) => err.errorType === 'bad_response');
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(mod.getAchievements(), (err) => err.status === 0 && err.errorType === 'network');
  });

  it('parseAchievements refuses anything but the documented shape', () => {
    assert.ok(mod.parseAchievements(ACHIEVEMENTS()));
    for (const patch of [{ learnerId: '' }, { xp: null }, { counts: { lessonsStarted: 1 } }, { streak: { current: 1, best: 1 } }, { badges: 'x' }, { xp: { ...ACHIEVEMENTS().xp, level: 0 } }]) {
      assert.equal(mod.parseAchievements({ ...ACHIEVEMENTS(), ...patch }), null, JSON.stringify(patch));
    }
    const capped = mod.parseAchievements({ ...ACHIEVEMENTS(), badges: [{ id: 'five_lessons', earned: true, current: 9, goal: 5 }] });
    assert.equal(capped.badges[0].current, 5);
  });
});
