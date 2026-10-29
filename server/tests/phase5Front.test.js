// Phase 5 front end (design p5 §3.7, §4.4). Stage 3: the React-free stores the UI reads.
// - components/lesson/logoutGuard.ts: the logout gate (O4). A "sign in again" button never asks
//   (G28); no dialog host, nothing that syncs or nothing unsaved: no question; the upload always
//   runs first; one question at a time, each with a new `ask` (G29: the dialog mounts fresh); the
//   return target is the element focused at the call; focus falls back to the menu button, then
//   #main-content (G30); the session ending elsewhere closes the question (the logout finishes).
// - components/ui/achievementsClient.ts (createAchievementsStore): no_account without a synced
//   learner, the learner binding of answers, the capability rule, a 404 without error_type latched
//   as "unsupported" for the page load (G14), errors, the debounce, single flight.
// - services/achievementsApi.ts: the answer's shape, refusals and an older server's HTML 404.
// The modules are bundled with esbuild (a Vite dependency) with their imports stubbed, and loaded
// fresh for each test (module-level state).
// Stage 4, the UI (rendered against a React stub; see the second half): SaveChip, ReaderStatus,
// SaveStoppedNotice (and its focus move), UnsavedLogoutDialog (G29, G30), LessonEnd (G32, the
// reset control, its helper by reason, a dialog closed before the request ends, focus fallback),
// LessonReader's keyed sections (G16), LeftRecordsNotice, ProgressCluster, ProfilePassport and
// the badges page (G20, G33), the logout callers (G12, G28) and the copy and token rules.
// Phase 8 (S2): achievementsApi's lessonXp (absent on an older server, a malformed field dropped
// alone) and LessonEnd's XP line (the server's figure only; 「+N」 only after this page saw an
// answer without the award; no request unless the lesson is done, synced and offered).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

  it('the session ends while asking (expiry, a logout elsewhere): the question goes and the logout finishes; later questions are fresh', async () => {
    const g = await guard({ prepare: () => ({ unsaved: 2 }) });
    g.registerLogoutDialog();
    const answer = g.confirmUnsavedLearning();
    await wait(5);
    assert.equal(g.getLogoutPhase().kind, 'asking');
    g.endUnsavedLearningQuestion();
    assert.equal(g.getLogoutPhase().kind, 'idle', 'the dialog goes away');
    assert.equal(await within(answer), true, 'the learner is signed out already: the logout they asked for finishes');
    g.endUnsavedLearningQuestion(); // nothing open: nothing happens
    assert.equal(g.getLogoutPhase().kind, 'idle');
    const next = g.confirmUnsavedLearning();
    await wait(5);
    assert.deepEqual(g.getLogoutPhase(), { kind: 'asking', unsaved: 2, ask: 2 }, 'a session end before a logout does not answer it');
    g.answerUnsavedLearning(false);
    assert.equal(await within(next), false);
  });

  it('the session ends while the upload runs: no question afterwards, the logout finishes', async () => {
    let release;
    const g = await guard({ prepare: () => new Promise((resolve) => { release = () => resolve({ unsaved: 2 }); }) });
    g.registerLogoutDialog();
    const answer = g.confirmUnsavedLearning();
    await wait(5);
    g.endUnsavedLearningQuestion();
    release();
    assert.equal(await within(answer), true);
    assert.equal(g.getLogoutPhase().kind, 'idle', 'never asked');
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
      "export * from './components/ui/achievementsClient'; export { AchievementsApiError, parseAchievements } from './services/achievementsApi'; export { LEGAL_ACCEPTED_EVENT } from './components/legal/legalEvents';",
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
    s.stale();
    s.serverProgress();
    await env.advance(60_000);
    assert.equal(env.loads, 1, 'one background probe per page load while the capabilities are unknown');
    fails = false;
    env.caps = { lessonReset: true, achievements: true };
    s.syncChanged();
    await s.settled();
    assert.equal(env.loads, 2, 'the capabilities arrived: fetched');
    assert.equal(s.getSnapshot().status, 'ready');
  });

  it('the try-again button probes again while the capabilities are unknown; background triggers do not', async () => {
    let fails = true;
    const { s, env } = store({ caps: null, load: () => {
      if (fails) throw new mod.AchievementsApiError('Network error', 0, 'network');
      return mod.parseAchievements(ACHIEVEMENTS(U1));
    } });
    s.consumerMounted();
    await s.settled();
    assert.deepEqual([s.getSnapshot().status, env.loads], ['unavailable', 1]);
    s.consumerMounted();
    s.stale();
    await s.settled();
    assert.equal(env.loads, 1, 'background: still the one probe');
    // The button: a request, at once "loading" (the page keeps its panel while it runs).
    const pressed = s.reload();
    assert.equal(s.getSnapshot().status, 'loading');
    await pressed;
    assert.deepEqual([s.getSnapshot().status, env.loads], ['unavailable', 2], 'failed again: said so');
    fails = false;
    await s.reload();
    assert.deepEqual([s.getSnapshot().status, env.loads], ['ready', 3]);
    // An older VM's 404 is latched before that: the button never probes it again (G14 holds).
    const old = store({ caps: null, load: () => { throw new mod.AchievementsApiError('Request failed (404)', 404); } });
    old.s.consumerMounted();
    await old.s.settled();
    await old.s.reload();
    assert.deepEqual([old.s.getSnapshot().status, old.env.loads], ['unsupported', 1]);
  });

  it('a try-again pressed while a request runs runs once after it, still as the button\'s', async () => {
    let release = null;
    let fails = true;
    const { s, env } = store({ caps: null, load: () => new Promise((resolve, reject) => {
      release = () => (fails ? reject(new mod.AchievementsApiError('Network error', 0, 'network')) : resolve(mod.parseAchievements(ACHIEVEMENTS(U1))));
    }) });
    s.consumerMounted();
    const pressed = s.reload();
    assert.equal(env.loads, 1);
    release();
    await wait(5);
    assert.equal(env.loads, 2, 'the probe that was running failed; the press runs after it');
    fails = false;
    release();
    await pressed;
    await s.settled();
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

  it('Phase 8: a store made after the capabilities are known (the lesson end\'s XP item) does not read the next save-view change as their arrival', async () => {
    const { s, env } = store();
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 1);
    s.syncChanged(); // the save view changes when the upload starts
    await s.settled();
    assert.equal(env.loads, 1, 'no second request, sent with the lesson-progress upload');
    assert.equal(s.getSnapshot().status, 'ready');
    // A rollback is still seen on the first change, without a request.
    const rolled = store();
    rolled.s.consumerMounted();
    await rolled.s.settled();
    rolled.env.caps = { lessonReset: true, achievements: false };
    rolled.s.syncChanged();
    await rolled.s.settled();
    assert.deepEqual(rolled.s.getSnapshot(), { status: 'unsupported', learnerId: U1, data: null, at: null });
    assert.equal(rolled.env.loads, 1);
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

  it('the page store\'s window events: the server took this tab\'s records (rp:progress-saved) → one fetch 2 s later with a consumer; without one, the next consumer fetches', async () => {
    const { s, env } = store();
    const handlers = new Map();
    const target = { addEventListener: (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]) };
    const fire = (type, detail) => (handlers.get(type) ?? []).forEach((fn) => fn({ type, detail }));
    mod.listenForAchievementChanges(s, target);
    const unmount = s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 1);
    // An ordinary save: no server progress event (nothing changed here), the save signal only.
    fire('rp:progress-saved');
    await env.advance(mod.ACHIEVEMENTS_DEBOUNCE_MS - 1);
    assert.equal(env.loads, 1, 'trailing: the post-save hook commits first');
    await env.advance(1);
    assert.equal(env.loads, 2);
    // A local write (no source) is not a save; a server-sourced record is.
    fire('rp:progress-change', { courseSlug: 'c', lessonId: 'l' });
    await env.advance(60_000);
    assert.equal(env.loads, 2);
    fire('rp:progress-change', { courseSlug: 'c', lessonId: 'l', source: 'server' });
    await env.advance(mod.ACHIEVEMENTS_DEBOUNCE_MS);
    assert.equal(env.loads, 3);
    unmount();
    fire('rp:progress-saved');
    assert.equal(s.getSnapshot().at, null, 'marked stale');
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 4, 'fetched within 30 s of the last');
  });

  it('Phase 8: LEGAL_ACCEPTED_EVENT reads again only when the last read was refused with terms_required (SG-5: nothing changes while the server check is off)', async () => {
    assert.equal(mod.LEGAL_ACCEPTED_EVENT, 'rp:legal-accepted');
    /** A store whose reads answer `outcomes` in turn ('ok', or a refusal to throw), then 'ok'. */
    const scripted = (outcomes) => {
      const queue = [...outcomes];
      const made = store({ load: () => {
        const next = queue.length > 0 ? queue.shift() : 'ok';
        if (next !== 'ok') throw next;
        return mod.parseAchievements(ACHIEVEMENTS(U1.toUpperCase()));
      } });
      const handlers = new Map();
      const target = { addEventListener: (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]) };
      mod.listenForAchievementChanges(made.s, target);
      return { ...made, fire: (type) => (handlers.get(type) ?? []).forEach((fn) => fn({ type })) };
    };
    const TERMS = new mod.AchievementsApiError('Accept the current terms of use to continue.', 403, 'terms_required');

    // Refused while the sign-up acceptance was still on its way: held 'unavailable' with a consumer mounted.
    const refused = scripted([TERMS]);
    refused.s.consumerMounted();
    await refused.s.settled();
    assert.deepEqual([refused.s.getSnapshot().status, refused.env.loads], ['unavailable', 1]);
    refused.fire(mod.LEGAL_ACCEPTED_EVENT);
    await refused.s.settled();
    assert.deepEqual([refused.s.getSnapshot().status, refused.env.loads], ['ready', 2], 'one read, and the cluster comes back without a reload');
    refused.fire(mod.LEGAL_ACCEPTED_EVENT);
    await refused.env.advance(60_000);
    assert.equal(refused.env.loads, 2, 'a second announcement reads nothing');

    // Without a consumer: only marked out of date (data shown before, a later read refused).
    const kept = scripted(['ok', TERMS]);
    const unmount = kept.s.consumerMounted();
    await kept.s.settled();
    kept.s.stale();
    await kept.s.settled();
    assert.deepEqual([kept.s.getSnapshot().status, kept.env.loads], ['ready', 2], 'refused, the earlier data is kept');
    unmount();
    kept.fire(mod.LEGAL_ACCEPTED_EVENT);
    await kept.s.settled();
    assert.equal(kept.env.loads, 2, 'no request without a consumer');
    assert.equal(kept.s.getSnapshot().at, null, 'marked out of date');
    kept.s.consumerMounted();
    await kept.s.settled();
    assert.equal(kept.env.loads, 3, 'the next consumer reads at once (within 30 s of the last)');

    // SG-5: a ready store, or one refused for another reason, reads nothing on the event.
    for (const [label, outcomes] of [
      ['ready', []],
      ['503', [{ status: 503 }]],
      ['network', [{ status: 0 }]],
      ['another 403', [new mod.AchievementsApiError('x', 403, 'ai_access_required')]],
      ['401', [new mod.AchievementsApiError('x', 401, 'sign_in_required')]],
    ]) {
      const other = scripted(outcomes);
      other.s.consumerMounted();
      await other.s.settled();
      other.fire(mod.LEGAL_ACCEPTED_EVENT);
      await other.env.advance(60_000);
      assert.equal(other.env.loads, 1, label);
    }

    // A later successful read clears the mark: an announcement after it reads nothing.
    const cleared = scripted([TERMS]);
    cleared.s.consumerMounted();
    await cleared.s.settled();
    await cleared.s.reload();
    assert.equal(cleared.s.getSnapshot().status, 'ready');
    cleared.fire(mod.LEGAL_ACCEPTED_EVENT);
    await cleared.env.advance(60_000);
    assert.equal(cleared.env.loads, 2);
  });

  it('Phase 8: LEGAL_ACCEPTED_EVENT while a read is on its way that then answers terms_required: exactly one more read (its check ran before the acceptance was stored)', async () => {
    const TERMS = new mod.AchievementsApiError('Accept the current terms of use to continue.', 403, 'terms_required');
    /** A store whose first read is held until settle(outcome); later reads answer `rest` in turn, then 'ok'. */
    const held = (rest = []) => {
      let settle = null;
      const queue = [...rest];
      const made = store({ load: (env) => {
        if (env.loads > 1) {
          const next = queue.length > 0 ? queue.shift() : 'ok';
          if (next !== 'ok') throw next;
          return mod.parseAchievements(ACHIEVEMENTS(U1.toUpperCase()));
        }
        return new Promise((resolve, reject) => {
          settle = (outcome) => (outcome === 'ok' ? resolve(mod.parseAchievements(ACHIEVEMENTS(U1.toUpperCase()))) : reject(outcome));
        });
      } });
      const handlers = new Map();
      const target = { addEventListener: (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]) };
      mod.listenForAchievementChanges(made.s, target);
      return { ...made, settle: (outcome) => settle(outcome), fire: (type) => (handlers.get(type) ?? []).forEach((fn) => fn({ type })) };
    };

    // The race: the event comes while the read is held, then the read is refused for the terms.
    const raced = held();
    raced.s.consumerMounted();
    assert.equal(raced.env.loads, 1);
    raced.fire(mod.LEGAL_ACCEPTED_EVENT);
    assert.equal(raced.env.loads, 1, 'nothing more while the read is on its way');
    raced.settle(TERMS);
    await raced.s.settled();
    assert.deepEqual([raced.s.getSnapshot().status, raced.env.loads], ['ready', 2], 'one more read: the cluster comes back without a reload');
    await raced.env.advance(60_000);
    assert.equal(raced.env.loads, 2, 'exactly one');

    // Without a consumer when the refusal comes back: marked out of date, read by the next consumer.
    const gone = held();
    const unmount = gone.s.consumerMounted();
    gone.fire(mod.LEGAL_ACCEPTED_EVENT);
    unmount();
    gone.settle(TERMS);
    await gone.s.settled();
    await gone.env.advance(60_000);
    assert.equal(gone.env.loads, 1, 'no request without a consumer');
    gone.s.consumerMounted();
    await gone.s.settled();
    assert.deepEqual([gone.s.getSnapshot().status, gone.env.loads], ['ready', 2]);

    // SG-5: the same event during a read that succeeds or is refused for another reason reads nothing more.
    for (const [label, outcome] of [
      ['ok', 'ok'],
      ['503', { status: 503 }],
      ['another 403', new mod.AchievementsApiError('x', 403, 'ai_access_required')],
    ]) {
      const other = held();
      other.s.consumerMounted();
      other.fire(mod.LEGAL_ACCEPTED_EVENT);
      other.settle(outcome);
      await other.s.settled();
      await other.env.advance(60_000);
      assert.equal(other.env.loads, 1, label);
    }

    // A refusal for the terms with no announcement on its way reads nothing more (as before).
    const quiet = held();
    quiet.s.consumerMounted();
    quiet.settle(TERMS);
    await quiet.s.settled();
    await quiet.env.advance(60_000);
    assert.deepEqual([quiet.s.getSnapshot().status, quiet.env.loads], ['unavailable', 1]);

    // The mark belongs to that read: an event during an earlier read that succeeded does not carry
    // over to a later read refused for the terms.
    const later = held([TERMS]);
    later.s.consumerMounted();
    later.fire(mod.LEGAL_ACCEPTED_EVENT);
    later.settle('ok');
    await later.s.settled();
    later.s.stale();
    await later.s.settled();
    await later.env.advance(60_000);
    assert.deepEqual([later.s.getSnapshot().status, later.env.loads], ['ready', 2], 'refused, the earlier data kept, no third read');
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

  it('Phase 8: lessonXp absent (an older server) stays absent; {} is kept; good entries kept, bad ones dropped; a malformed field drops only lessonXp', () => {
    const older = mod.parseAchievements(ACHIEVEMENTS());
    assert.equal('lessonXp' in older, false, 'an older server: no field, so the lesson end shows nothing');
    assert.deepEqual(mod.parseAchievements({ ...ACHIEVEMENTS(), lessonXp: {} }).lessonXp, {});
    const mixed = mod.parseAchievements({
      ...ACHIEVEMENTS(),
      lessonXp: {
        'vibe-coding/vibe-ch1': 40, 'claude-code/cc-01-first-session': 40,
        'Vibe-Coding/x': 40, 'vibe-coding': 40, 'a/b/c': 40, 'vibe-coding/zero': 0, 'vibe-coding/half': 1.5,
        'vibe-coding/text': '40', 'vibe-coding/minus': -40, 'vibe-coding/huge': 2 ** 53,
      },
    });
    assert.deepEqual(mixed.lessonXp, { 'vibe-coding/vibe-ch1': 40, 'claude-code/cc-01-first-session': 40 });
    assert.ok(Object.isFrozen(mixed.lessonXp));
    for (const bad of [[{ 'vibe-coding/vibe-ch1': 40 }], 'vibe-coding/vibe-ch1', 40, null, true]) {
      const parsed = mod.parseAchievements({ ...ACHIEVEMENTS(), lessonXp: bad });
      assert.ok(parsed, `the answer stays usable: ${JSON.stringify(bad)}`);
      assert.equal('lessonXp' in parsed, false, JSON.stringify(bad));
      assert.equal(parsed.xp.total, 230);
      assert.equal(parsed.badges.length, 2);
    }
    // A JSON key "__proto__" is an own key of the parsed body: dropped, and nothing is inherited.
    const proto = mod.parseAchievements(JSON.parse(`{"ok":true,"learnerId":"${U1}","xp":{"total":0,"level":1,"intoLevel":0,"levelSize":100,"toNextLevel":100},"counts":{"lessonsStarted":0,"lessonsDone":0,"stagesDone":0},"streak":{"current":0,"best":0,"activeToday":false,"today":"2026-10-25","timeZone":"Asia/Tokyo"},"badges":[],"lessonXp":{"__proto__":{"polluted":1},"vibe-coding/vibe-ch1":40}}`));
    assert.deepEqual(Object.keys(proto.lessonXp), ['vibe-coding/vibe-ch1']);
    assert.equal(Object.getPrototypeOf(proto.lessonXp), Object.prototype);
    assert.equal(proto.lessonXp.polluted, undefined);
  });
});

// ---------------------------------------------------------------------------------------------
// Stage 4: the UI (design §2.6, §3.7, §4.2–§4.4). The components are bundled with esbuild against
// a React stub whose jsx() returns { type, props, key } and whose hooks count calls (useState
// takes overrides by index from globalThis.__state and records setter calls in globalThis.__sets),
// as legalConsentFront.test.js does; function components are expanded into host elements.

const UI_ICONS = [
  'ArrowLeft', 'ArrowRight', 'Award', 'Bell', 'BookOpenCheck', 'CircleCheck', 'Cloud', 'CloudAlert', 'CloudCheck',
  'CloudOff', 'CloudUpload', 'Flag', 'Flame', 'GraduationCap', 'Layers', 'ListChecks', 'LockKeyhole', 'LogIn', 'LogOut',
  'Medal', 'MonitorSmartphone', 'PartyPopper', 'RotateCcw', 'RotateCw', 'Settings', 'ShieldCheck', 'Trophy',
];
const UI_STUBS = {
  react: `
    let index = 0;
    let refIndex = 0;
    export const __resetHooks = () => { index = 0; refIndex = 0; };
    export const useState = (initial) => {
      const i = index++;
      const o = globalThis.__state;
      const value = o && i in o ? o[i] : (typeof initial === 'function' ? initial() : initial);
      return [value, (v) => { (globalThis.__sets ??= []).push([i, typeof v === 'function' ? v(value) : v]); }];
    };
    // Refs persist across renders only when a test passes globalThis.__refs (by call order).
    export const useRef = (value) => {
      const i = refIndex++;
      const store = globalThis.__refs;
      if (!store) return { current: value ?? null };
      return (store[i] ??= { current: value ?? null });
    };
    let ids = 0;
    export const useId = () => ':r' + (ids += 1) + ':';
    export const useEffect = (fn) => { (globalThis.__effects ??= []).push(fn); };
    export const useLayoutEffect = useEffect;
    export const useCallback = (fn) => fn;
    export const useMemo = (fn) => fn();
    export const useSyncExternalStore = (subscribe, get) => get();
    export const forwardRef = (fn) => fn;
    export const createContext = () => ({});
    export const useContext = () => null;
    export const Fragment = 'Fragment';
    export default { useState, useRef, useId, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore, forwardRef, createContext, useContext, Fragment };
  `,
  'react/jsx-runtime': "export const jsx = (type, props, key) => ({ type, props, key }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'react-router-dom': "export const Link = 'Link';",
  'lucide-react': UI_ICONS.map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });",
  theme: 'export const useTheme = () => ({ setTheme() {} });',
  auth: 'export const useAuth = () => globalThis.__auth ?? ({ user: null, logout: async () => true });',
  dialog: "export const ConfirmDialog = 'ConfirmDialog'; export default 'ConfirmDialog';",
  reader: 'export const useReader = () => globalThis.__reader; export const useOptionalReader = () => globalThis.__reader ?? null;',
  md: "export const MdText = 'MdText'; export const Txt = 'Txt';",
  syncClient: `
    export const useProgressSaveView = () => globalThis.__view;
    export const getProgressSaveView = () => globalThis.__view;
    export const useProgressSyncState = () => globalThis.__sync ?? { status: 'on', userId: 'u1' };
    export const progressCapabilities = () => (globalThis.__caps === undefined ? { lessonReset: true, achievements: true } : globalThis.__caps);
    export const isSyncableLesson = () => globalThis.__syncable ?? true;
    export const retryProgressSync = () => { globalThis.__retries = (globalThis.__retries ?? 0) + 1; return globalThis.__retryResult ?? true; };
  `,
  guard: `
    export const answerUnsavedLearning = (v) => { (globalThis.__answers ??= []).push(v); };
    export const getLogoutPhase = () => globalThis.__phase;
    export const subscribeLogoutPhase = () => () => {};
    export const registerLogoutDialog = () => () => {};
    export const logoutReturnTarget = () => globalThis.__target ?? null;
    export const restoreLogoutFocus = (t) => { (globalThis.__restored ??= []).push(t); return t; };
  `,
  achievements: `
    // With globalThis.__achStore (a real store), the hook reads it and leaves its mount effect in
    // __consumerEffects for the test to run as React would (once while mounted).
    export const useAchievements = () => {
      globalThis.__achCalls = (globalThis.__achCalls ?? 0) + 1;
      const store = globalThis.__achStore;
      if (!store) return globalThis.__ach;
      (globalThis.__consumerEffects ??= []).push(() => store.consumerMounted());
      return store.getSnapshot();
    };
    export const reloadAchievements = async () => { globalThis.__reloads = (globalThis.__reloads ?? 0) + 1; };
  `,
  content: "export const getCourse = (slug) => (slug === 'vibe-coding' ? { id: 'vibe-coding', locale: 'jp', title: 'バイブコーディング入門：AIと作る' } : undefined);",
  plan: 'export const usePlanEntry = () => false;',
  llm: `
    export const clearLegacyBrowserKey = () => {};
    export const getLlmStatus = () => new Promise(() => {});
    export const primaryProviderLabel = () => null;
    export const summarizeLlmStatus = () => 'checking';
  `,
};

async function bundleUi(entry) {
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': '{"PROD":true}' },
    plugins: [{
      name: 'ui-stubs',
      setup(b) {
        const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        stub(/^react$/, 'react');
        stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
        stub(/^react-router-dom$/, 'react-router-dom');
        stub(/^lucide-react$/, 'lucide-react');
        stub(/context\/LanguageContext$/, 'language');
        stub(/context\/ThemeContext$/, 'theme');
        stub(/context\/AuthContext$/, 'auth');
        stub(/safety\/ConfirmDialog$/, 'dialog');
        stub(/\/ReaderContext$/, 'reader');
        stub(/\/Md$/, 'md');
        stub(/\/progressSyncClient$/, 'syncClient');
        stub(/\/logoutGuard$/, 'guard');
        stub(/\/achievementsClient$/, 'achievements');
        stub(/(^|\/)content$/, 'content');
        stub(/hooks\/usePlanEntry$/, 'plan');
        stub(/services\/llmApi$/, 'llm');
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: UI_STUBS[args.path], loader: 'js' }));
      },
    }],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/** Calls function components until only host elements and stubs ('Link', 'ConfirmDialog', …) are left. */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node && typeof node === 'object' && 'type' in node) {
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    return { type: node.type, key: node.key, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return node;
}
function walk(node, out = []) {
  if (Array.isArray(node)) for (const child of node) walk(child, out);
  else if (node && typeof node === 'object' && 'type' in node) {
    out.push({ el: node });
    walk(node.props?.children, out);
  } else if (typeof node === 'string' || typeof node === 'number') out.push({ text: String(node) });
  return out;
}
const textOf = (tokens) => tokens.filter((t) => 'text' in t).map((t) => t.text).join('');
const elementsOf = (tokens) => tokens.filter((t) => 'el' in t).map((t) => t.el);
const textOfElement = (el) => textOf(walk(el.props?.children));
const byClass = (els, cls) => els.filter((el) => typeof el.props?.className === 'string' && el.props.className.split(/\s+/).includes(cls));
const ICON_NAMES = new Set(UI_ICONS);
const iconsOf = (els) => els.filter((el) => typeof el.type === 'string' && ICON_NAMES.has(el.type)).map((el) => el.type);

/** Renders `component(props)` with globals set for the stubs; returns the element tokens. */
function renderUi(mod, component, props = {}, globals = {}) {
  Object.assign(globalThis, { __sets: [], __effects: [], ...globals });
  mod.__resetHooks();
  try {
    return walk(expand(component(props)));
  } finally {
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

const VIEW = (patch = {}) => ({ state: 'saved', reason: null, userId: U1, pending: 0, failures: 0, busy: false, savedAt: null, online: true, ...patch });
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TOKEN_RULE = /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/;

/** A fake document for focus calls. */
function focusDocument() {
  const main = { id: 'main-content', focused: 0, focus(opts) { this.focused += 1; this.opts = opts; } };
  return { main, body: {}, activeElement: null, getElementById: (id) => (id === 'main-content' ? main : null) };
}

let ui = null;
before(async () => {
  ui = await fresh(await bundleUi([
    "export { __resetHooks } from 'react';",
    "export { SaveChipView, saveLongText, saveLabel, SAVE_ICONS } from './components/lesson/SaveChip';",
    "export { ReaderStatus, ReaderStatusView, readerStatusText, stallKeyOf, stallMessageOf } from './components/lesson/ReaderStatus';",
    "export { SaveStoppedNoticeView, default as SaveStoppedNotice } from './components/lesson/SaveStoppedNotice';",
    "export { LeftRecordsNoticeView, default as LeftRecordsNotice } from './components/lesson/LeftRecordsNotice';",
    "export { UnsavedLogoutDialogView } from './components/lesson/UnsavedLogoutDialog';",
    "export { LessonEnd, savedWhereOf, resetControlOf, resetHelpOf, lacksLessonXp, lessonXpLineOf } from './components/lesson/LessonEnd';",
    "export { ProgressClusterView } from './components/ui/ProgressCluster';",
    "export { ProfileBadgesBody, nextBadge, badgeProgressText, default as ProfileBadgesView } from './components/features/dashboard/profile/ProfileBadgesView';",
    "export { default as ProfilePassport, notReadyText } from './components/features/dashboard/ProfilePassport';",
    "export { SYNC_ACCOUNT_KEY, SYNC_PENDING_PREFIX } from './components/lesson/progressSync';",
  ].join('\n')));
});

describe('SaveChip: where the record is (design §4.2)', () => {
  const CASES = [
    [{ state: 'saved' }, 'CloudCheck', '保存済み', '学習の記録は、アカウントに保存されています。'],
    [{ state: 'saving' }, 'CloudUpload', '保存しています', '学習の記録を、アカウントに保存しています。'],
    [{ state: 'loading' }, 'Cloud', '読み込み中', '学習の記録を読み込んでいます。'],
    [{ state: 'offline' }, 'CloudOff', 'この端末に保存中', 'いまはサーバーにつながらないため、この端末に記録しています。つながると、アカウントに保存します。'],
    [{ state: 'stopped', reason: 'network' }, 'CloudAlert', '保存が止まっています', '学習の記録を、アカウントに保存できていません。この端末には残っています。'],
    [{ state: 'stopped', reason: 'server' }, 'CloudAlert', '保存が止まっています', '学習の記録を、アカウントに保存できていません。この端末には残っています。'],
    [{ state: 'stopped', reason: 'auth' }, 'CloudAlert', '保存が止まっています', 'ログインの確認ができないため、保存が止まっています。この端末には残っていて、ログインし直すと保存します。'],
    [{ state: 'stopped', reason: 'account' }, 'CloudAlert', '保存が止まっています', 'ほかのタブでログアウトしたか、別のアカウントでログインしたため、このタブでは保存していません。この端末には残っています。'],
    [{ state: 'stopped', reason: 'storage' }, 'CloudAlert', '保存が止まっています', 'この端末の保存領域がいっぱいか使えないため、アカウントへの保存が止まっています。'],
    [{ state: 'local' }, 'MonitorSmartphone', 'この端末だけ', '学習の記録は、この端末だけに保存されます。'],
  ];

  it('each state and reason: icon, short label (visual), long text (title and screen readers); not interactive, no live region', () => {
    for (const [patch, icon, label, long] of CASES) {
      const els = elementsOf(renderUi(ui, ui.SaveChipView, { view: VIEW(patch), language: 'jp' }));
      const chip = els[0];
      assert.equal(chip.type, 'span', JSON.stringify(patch));
      assert.equal(chip.props['data-state'], patch.state);
      assert.equal(chip.props.title, long);
      assert.equal(chip.props.role, undefined, 'no live region: it changes with every save');
      assert.deepEqual(iconsOf(els), [icon]);
      assert.equal(els.find((el) => el.type === icon).props['aria-hidden'], 'true');
      assert.equal(textOfElement(byClass(els, 'rp-save-label')[0]), label);
      assert.equal(textOfElement(byClass(els, 'sr-only')[0]), long);
      assert.ok(!els.some((el) => el.type === 'button' || el.props?.tabIndex !== undefined), 'nothing to press');
    }
    const en = elementsOf(renderUi(ui, ui.SaveChipView, { view: VIEW({ state: 'offline' }), language: 'en' }));
    assert.equal(textOfElement(byClass(en, 'rp-save-label')[0]), 'On this device for now');
    // Below 640 px only the icon shows (in-app check): every state has its own.
    assert.equal(new Set(Object.values(ui.SAVE_ICONS)).size, Object.keys(ui.SAVE_ICONS).length);
  });

  it('colour repeats the state with tokens only: danger only while stopped; the label shows from 640 px', () => {
    const css = readFile('components/lesson/reader.css');
    const rules = [...css.matchAll(/(\.rp-save[^{]*)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
    const danger = rules.filter(([, body]) => body.includes('--rp-danger')).map(([sel]) => sel);
    assert.deepEqual(danger, ['.rp-save[data-state="stopped"]']);
    for (const [, body] of rules) assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, 'tokens only');
    assert.match(css, /\.rp-save-label \{\s*display: none;\s*\}\s*@media \(min-width: 640px\) \{\s*\.rp-save-label \{\s*display: inline;/);
  });
});

describe('ReaderStatus: the reader\'s status line (finding 11)', () => {
  it('the region is always mounted (role=status, polite) and empty until there is a message', () => {
    const els = elementsOf(renderUi(ui, ui.ReaderStatusView, { language: 'jp', message: null, onDismiss() {} }));
    assert.equal(els.length, 1);
    assert.equal(els[0].props.role, 'status');
    assert.equal(els[0].props['aria-live'], 'polite');
    assert.equal(els[0].props.children, null);
  });

  it('stall and reset messages: icon, text, a labelled close button that also moves focus to main', () => {
    const cases = [
      [{ kind: 'stall', state: 'offline', reason: null, id: 1 }, 'CloudOff', /この端末に記録しています/],
      [{ kind: 'stall', state: 'stopped', reason: 'auth', id: 2 }, 'CloudAlert', /ログインし直すと保存します/],
      [{ kind: 'reset', id: 3 }, 'RotateCcw', /^このレッスンの記録を消しました。最初から学べます。$/],
    ];
    for (const [message, icon, text] of cases) {
      let dismissed = 0;
      const doc = focusDocument();
      globalThis.document = doc;
      const els = elementsOf(renderUi(ui, ui.ReaderStatusView, { language: 'jp', message, onDismiss: () => { dismissed += 1; } }));
      assert.equal(els[0].props.role, 'status', 'the same region');
      const card = byClass(els, 'rp-status-card')[0];
      assert.ok(card, 'a card');
      assert.deepEqual(iconsOf(els), [icon]);
      assert.match(textOfElement(byClass(els, 'rp-status-text')[0]), text);
      const close = els.find((el) => el.type === 'button');
      assert.equal(close.props['aria-label'], '閉じる');
      close.props.onClick();
      assert.equal(dismissed, 1);
      assert.deepEqual([doc.main.focused, doc.main.opts], [1, { preventScroll: true }]);
      delete globalThis.document;
    }
    assert.equal(ui.readerStatusText('en', { kind: 'reset', id: 1 }), "This lesson's record was deleted. You can start from the beginning.");
  });

  it('the card goes by itself (8 s, or saving works again) while its close button had focus: focus moves to #main-content, once, only from the page body', () => {
    const message = { kind: 'reset', id: 1 };
    const mount = (refs, msg, onDismiss = () => {}) => {
      const els = elementsOf(renderUi(ui, ui.ReaderStatus, { message: msg, onDismiss }, { __refs: refs }));
      return { els, effects: globalThis.__effects };
    };
    const runEffects = (effects, activeElement) => {
      const doc = focusDocument();
      doc.activeElement = activeElement === 'body' ? doc.body : activeElement;
      globalThis.document = doc;
      try {
        for (const effect of effects) effect();
      } finally {
        delete globalThis.document;
      }
      return doc;
    };
    let refs = {};
    let { els, effects } = mount(refs, message);
    assert.equal(runEffects(effects, 'body').main.focused, 0, 'still shown: nothing moves');
    els.find((el) => el.type === 'button').props.onFocus();
    ({ effects } = mount(refs, null));
    const doc = runEffects(effects, 'body');
    assert.equal(doc.main.focused, 1, 'focus left with the button: main takes it');
    assert.deepEqual(doc.main.opts, { preventScroll: true });
    assert.equal(runEffects(effects, 'body').main.focused, 0, 'once');
    // Focus already elsewhere (the learner moved on): left alone.
    refs = {};
    ({ els } = mount(refs, message));
    els.find((el) => el.type === 'button').props.onFocus();
    ({ effects } = mount(refs, null));
    assert.equal(runEffects(effects, { name: 'a link' }).main.focused, 0);
    // The button never had focus: nothing moves.
    refs = {};
    mount(refs, message);
    ({ effects } = mount(refs, null));
    assert.equal(runEffects(effects, 'body').main.focused, 0);
    // Closed with the button: its click moves focus; the effect does not again.
    refs = {};
    let dismissed = 0;
    ({ els } = mount(refs, message, () => { dismissed += 1; }));
    const close = els.find((el) => el.type === 'button');
    close.props.onFocus();
    const clickDoc = focusDocument();
    globalThis.document = clickDoc;
    close.props.onClick();
    delete globalThis.document;
    assert.deepEqual([dismissed, clickDoc.main.focused], [1, 1]);
    ({ effects } = mount(refs, null));
    assert.equal(runEffects(effects, 'body').main.focused, 0);
  });

  it('a stall is said once per kind: "on this device" or "stopped" (by reason) with something unsaved; never saving ↔ saved', () => {
    const key = (patch, syncable = true) => ui.stallKeyOf(VIEW(patch), syncable);
    assert.equal(key({ state: 'offline', pending: 1 }), 'offline:');
    assert.equal(key({ state: 'stopped', reason: 'auth', pending: 2 }), 'stopped:auth');
    assert.equal(key({ state: 'stopped', reason: 'network', pending: 1 }), 'stopped:network');
    for (const patch of [{ state: 'offline', pending: 0 }, { state: 'stopped', reason: 'auth', pending: 0 }, { state: 'saving', pending: 3 }, { state: 'saved' }, { state: 'local', pending: 2 }, { state: 'loading', pending: 1 }]) {
      assert.equal(key(patch), null, JSON.stringify(patch));
    }
    assert.equal(key({ state: 'offline', pending: 1 }, false), null, 'a lesson the server does not store');
    assert.deepEqual(ui.stallMessageOf('stopped:auth', 4), { kind: 'stall', state: 'stopped', reason: 'auth', id: 4 });
    assert.deepEqual(ui.stallMessageOf('offline:', 5), { kind: 'stall', state: 'offline', reason: null, id: 5 });
    // The reader reads only the key (a string): it does not re-render on every save.
    const reader = readFile('components/lesson/LessonReader.tsx');
    assert.match(reader, /const stallKey = useSyncExternalStore\(\s*subscribeProgressSaveView,\s*\(\) => stallKeyOf\(getProgressSaveView\(\), syncable\),/);
    assert.doesNotMatch(reader, /useProgressSaveView\(/);
  });

  it('the reset message takes its own room under the bar (the title LessonReader focuses is never under it); a stall message floats', () => {
    const regionOf = (message) => elementsOf(renderUi(ui, ui.ReaderStatusView, { language: 'jp', message, onDismiss() {} }))[0];
    assert.equal(regionOf({ kind: 'reset', id: 1 }).props['data-flow'], 'true');
    for (const message of [null, { kind: 'stall', state: 'offline', reason: null, id: 2 }, { kind: 'stall', state: 'stopped', reason: 'server', id: 3 }]) {
      assert.equal(regionOf(message).props['data-flow'], undefined, JSON.stringify(message));
    }
    const css = readFile('components/lesson/reader.css');
    assert.match(css, /\.rp-status \{\s*position: absolute;/);
    assert.match(css, /\.rp-status\[data-flow\] \{\s*position: static;/);
    const reader = readFile('components/lesson/LessonReader.tsx');
    assert.match(reader, /showStatus\(\{ kind: 'reset', id: messageCount\.current \}\);\s*scrollToTop\(\);\s*document\.getElementById\(lessonTitleId\(lesson\.id\)\)\?\.focus/);
  });

  it('the card wraps at any width (no nowrap, no ellipsis) and does not move under reduced motion', () => {
    const css = readFile('components/lesson/reader.css');
    const block = css.slice(css.indexOf('.rp-status {'), css.indexOf('.rp-status-card .rp-notice-x'));
    assert.match(block, /\.rp-status-card \{[^}]*white-space: normal;/);
    assert.doesNotMatch(block, /nowrap|text-overflow|ellipsis/);
    // .rp-reader * animations are cut to 1 ms under prefers-reduced-motion (the card is inside the reader).
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.rp-reader \*,/);
    const reader = readFile('components/lesson/LessonReader.tsx');
    assert.match(reader, /<ReaderStatus message=\{statusMessage\} onDismiss=\{\(\) => setStatusMessage\(null\)\} \/>/);
    assert.match(reader, /\{resumed && !statusMessage \? \(/, 'a message hides the "resumed" pill');
  });
});

describe('SaveStoppedNotice: the app notice while saving has stopped (design §4.3)', () => {
  const render = (view, language = 'jp', extra = {}) => elementsOf(renderUi(ui, ui.SaveStoppedNoticeView, { language, view, onRetry() {}, onSignIn() {}, ...extra }));

  it('always mounted; empty unless stopped with something unsaved', () => {
    for (const view of [VIEW({ pending: 2 }), VIEW({ state: 'saving', pending: 2 }), VIEW({ state: 'offline', pending: 2 }), VIEW({ state: 'stopped', reason: 'network', pending: 0 })]) {
      const els = render(view);
      assert.equal(els.length, 1, JSON.stringify(view));
      assert.equal(els[0].props.role, 'status');
      assert.equal(els[0].props.children, null);
    }
  });

  it('count, reason and last save; one button by reason: retry (network, server), sign in again (auth), none (account, storage)', () => {
    const savedAt = new Date(2026, 9, 25, 9, 5).getTime();
    let retries = 0;
    const els = render(VIEW({ state: 'stopped', reason: 'network', pending: 3, savedAt }), 'jp', { onRetry: () => { retries += 1; } });
    const text = textOfElement(els[0]);
    assert.match(text, /^まだ保存できていない学習があります（3 件）。学習の記録を、アカウントに保存できていません。この端末には残っています。最後に保存できたのは 09:05 です。もう一度保存する$/);
    assert.deepEqual(iconsOf(els), ['CloudAlert', 'RotateCw']);
    assert.match(els.find((el) => el.type === 'CloudAlert').props.className, /text-danger/);
    const retry = els.find((el) => el.type === 'button');
    assert.equal(retry.props['aria-disabled'], undefined);
    retry.props.onClick();
    assert.equal(retries, 1);

    const busy = render(VIEW({ state: 'stopped', reason: 'server', pending: 1, busy: true }), 'jp', { onRetry: () => { retries += 1; }, retrying: true });
    const busyButton = busy.find((el) => el.type === 'button');
    assert.equal(busyButton.props['aria-disabled'], true, 'aria-disabled, not disabled: focus stays on it');
    assert.equal(busyButton.props.disabled, undefined);
    assert.match(textOfElement(busyButton), /保存しています…/);
    busyButton.props.onClick();
    assert.equal(retries, 1, 'nothing while a request runs');

    let signIns = 0;
    const auth = render(VIEW({ state: 'stopped', reason: 'auth', pending: 1 }), 'jp', { onSignIn: () => { signIns += 1; } });
    const signIn = auth.find((el) => el.type === 'button');
    assert.match(textOfElement(signIn), /ログインし直す/);
    assert.match(textOfElement(auth[0]), /ログインの確認ができないため/);
    signIn.props.onClick();
    assert.equal(signIns, 1);

    for (const reason of ['account', 'storage']) {
      const none = render(VIEW({ state: 'stopped', reason, pending: 1 }));
      assert.ok(!none.some((el) => el.type === 'button'), reason);
      assert.match(textOfElement(none[0]), /（1 件）/);
    }
  });

  it('an automatic retry (busy, nothing pressed) changes no text in the live region; the learner\'s press says 「保存しています…」 until its request ends', () => {
    const view = (busy, failures = 3) => VIEW({ state: 'stopped', reason: 'network', pending: 2, busy, failures });
    const mount = (busy, state, failures) => {
      const tokens = renderUi(ui, ui.SaveStoppedNotice, {}, { __view: view(busy, failures), __refs: {}, ...(state ? { __state: state } : {}) });
      return { els: elementsOf(tokens), text: textOf(tokens), effects: globalThis.__effects };
    };
    const runEffects = (effects) => {
      globalThis.__sets = [];
      for (const effect of effects) effect();
      return globalThis.__sets.filter(([i]) => i === 0).map(([, v]) => v);
    };
    // The core's own retry on its backoff: aria-disabled only (an attribute is not read again).
    const auto = mount(true);
    const autoButton = auto.els.find((el) => el.type === 'button');
    assert.equal(textOfElement(autoButton), 'もう一度保存する');
    assert.doesNotMatch(auto.text, /保存しています…/);
    assert.equal(autoButton.props['aria-disabled'], true);
    // The learner presses: pressed (with the failure count), and the retry runs.
    globalThis.__retries = 0;
    const idle = mount(false);
    idle.els.find((el) => el.type === 'button').props.onClick();
    assert.deepEqual(globalThis.__sets.filter(([i]) => i === 0).map(([, v]) => v), [{ failures: 3, started: false }]);
    assert.equal(globalThis.__retries, 1);
    // Its request runs: the label says so; it stays pressed.
    const running = mount(true, { 0: { failures: 3, started: false } });
    assert.match(textOfElement(running.els.find((el) => el.type === 'button')), /保存しています…/);
    assert.deepEqual(runEffects(running.effects), [{ failures: 3, started: true }]);
    assert.deepEqual(runEffects(mount(true, { 0: { failures: 3, started: true } }).effects), []);
    // The request ended (busy false): no longer pressed, the next automatic retry says nothing.
    assert.deepEqual(runEffects(mount(false, { 0: { failures: 3, started: true } }).effects), [null]);
  });

  it('the common case (in-app check): the upload stopped after 3 failures and the PUT waits up to 20 s for its spacing; the press says 「保存しています…」 at once and until that request ends', () => {
    const view = (busy, failures = 3) => VIEW({ state: 'stopped', reason: 'server', pending: 1, busy, failures });
    const mount = (busy, state, failures) => {
      const tokens = renderUi(ui, ui.SaveStoppedNotice, {}, { __view: view(busy, failures), __refs: {}, ...(state ? { __state: state } : {}) });
      const els = elementsOf(tokens);
      return { els, button: els.find((el) => el.type === 'button'), effects: globalThis.__effects };
    };
    const runEffects = (effects) => {
      globalThis.__sets = [];
      for (const effect of effects) effect();
      return globalThis.__sets.filter(([i]) => i === 0).map(([, v]) => v);
    };
    const waiting = { 0: { failures: 3, started: false } };
    // Pressed, nothing sent yet (busy false): the label and aria-disabled change at once, and stay.
    const wait = mount(false, waiting);
    assert.equal(textOfElement(wait.button), '保存しています…');
    assert.equal(wait.button.props['aria-disabled'], true, 'focus stays on it');
    assert.deepEqual(runEffects(wait.effects), [], 'still waiting for the 20 s spacing');
    globalThis.__retries = 0;
    wait.button.props.onClick();
    assert.equal(globalThis.__retries, 0, 'a second press while it waits sends nothing');
    // The PUT runs, then fails again: back to 「もう一度保存する」.
    assert.deepEqual(runEffects(mount(true, waiting).effects), [{ failures: 3, started: true }]);
    assert.deepEqual(runEffects(mount(false, { 0: { failures: 3, started: true } }, 4).effects), [null]);
    // A failure no render saw running (one more failure): it ended too.
    assert.deepEqual(runEffects(mount(false, waiting, 4).effects), [null]);
    // Saved (or loading, or another reason): the notice or its button went: no longer pressed.
    for (const patch of [{ state: 'saved', pending: 0 }, { state: 'loading', pending: 1 }, { state: 'stopped', reason: 'auth', pending: 1 }]) {
      renderUi(ui, ui.SaveStoppedNotice, {}, { __view: VIEW({ failures: 3, ...patch }), __refs: {}, __state: waiting });
      assert.deepEqual(runEffects(globalThis.__effects), [null], JSON.stringify(patch));
    }
    // A press that asked for nothing (a GET at most every 10 s): the label stays.
    globalThis.__retries = 0;
    globalThis.__retryResult = false;
    try {
      const idle = mount(false);
      idle.button.props.onClick();
      assert.equal(globalThis.__retries, 1);
      assert.deepEqual(globalThis.__sets.filter(([i]) => i === 0), []);
      assert.equal(textOfElement(idle.button), 'もう一度保存する');
    } finally {
      delete globalThis.__retryResult;
    }
  });

  it('at 390 px the button wraps under the text (the text grows from a 16rem basis, never a zero one)', () => {
    const els = render(VIEW({ state: 'stopped', reason: 'network', pending: 1 }));
    const text = els.find((el) => el.type === 'p');
    const classes = text.props.className.split(/\s+/);
    assert.ok(classes.includes('grow') && classes.includes('basis-64'), text.props.className);
    assert.ok(!classes.includes('flex-1'), 'flex-1 sets a zero basis: the row never wraps');
    assert.match(els[1].props.className, /\bflex-wrap\b/);
  });

  it('English counts have a singular', () => {
    assert.match(textOfElement(render(VIEW({ state: 'stopped', reason: 'storage', pending: 1 }), 'en')[0]), /^Some learning isn't saved yet \(one lesson\)\. /);
    assert.match(textOfElement(render(VIEW({ state: 'stopped', reason: 'storage', pending: 2 }), 'en')[0]), /\(2 lessons\)\./);
  });

  it('the page notice: retry is retryProgressSync; 「ログインし直す」 is logout with reason reauth (no question)', () => {
    const calls = [];
    const auth = { logout: async (options) => { calls.push(options); return true; } };
    const view = VIEW({ state: 'stopped', reason: 'network', pending: 1 });
    globalThis.__retries = 0;
    const els = elementsOf(renderUi(ui, ui.SaveStoppedNotice, {}, { __view: view, __auth: auth }));
    els.find((el) => el.type === 'button').props.onClick();
    assert.equal(globalThis.__retries, 1);
    const authEls = elementsOf(renderUi(ui, ui.SaveStoppedNotice, {}, { __view: VIEW({ state: 'stopped', reason: 'auth', pending: 1 }), __auth: auth }));
    authEls.find((el) => el.type === 'button').props.onClick();
    assert.deepEqual(calls, [{ reason: 'reauth' }]);
    const app = readFile('App.tsx');
    assert.match(app, /notice=\{<>\{features\.legalPages \? <LegalNoticeBar \/> : null\}<SaveStoppedNotice \/><\/>\}/);
  });

  it('the notice goes away while its button had focus (the retry worked): focus moves to #main-content, only from the page body', () => {
    const stopped = VIEW({ state: 'stopped', reason: 'network', pending: 1 });
    /** Renders the page notice with refs kept across renders; returns its elements and effects. */
    const mount = (refs, view) => {
      const els = elementsOf(renderUi(ui, ui.SaveStoppedNotice, {}, { __view: view, __refs: refs }));
      return { els, effects: globalThis.__effects };
    };
    const runEffects = (effects, activeElement) => {
      const doc = focusDocument();
      doc.activeElement = activeElement === 'body' ? doc.body : activeElement;
      globalThis.document = doc;
      try {
        for (const effect of effects) effect();
      } finally {
        delete globalThis.document;
      }
      return doc;
    };
    // The button had focus; then the records were saved: the notice empties.
    let refs = {};
    let { els, effects } = mount(refs, stopped);
    assert.equal(runEffects(effects, 'body').main.focused, 0, 'still shown: nothing moves');
    els.find((el) => el.type === 'button').props.onFocus();
    ({ effects } = mount(refs, VIEW({ state: 'saved', pending: 0 })));
    const doc = runEffects(effects, 'body');
    assert.equal(doc.main.focused, 1, 'focus left with the button: main takes it');
    assert.deepEqual(doc.main.opts, { preventScroll: true });
    assert.equal(runEffects(effects, 'body').main.focused, 0, 'once');
    // Focus already somewhere else (the learner moved on): left alone.
    refs = {};
    ({ els } = mount(refs, stopped));
    els.find((el) => el.type === 'button').props.onFocus();
    ({ effects } = mount(refs, VIEW({ state: 'saved', pending: 0 })));
    assert.equal(runEffects(effects, { name: 'a link' }).main.focused, 0);
    // The button never had focus: nothing moves.
    refs = {};
    mount(refs, stopped);
    ({ effects } = mount(refs, VIEW({ state: 'saved', pending: 0 })));
    assert.equal(runEffects(effects, 'body').main.focused, 0);
  });
});

describe('UnsavedLogoutDialog: the logout question (O4, findings 6, 9, 10, 14)', () => {
  const render = (phase, language = 'jp') => elementsOf(renderUi(ui, ui.UnsavedLogoutDialogView, { language, phase }));

  it('idle: only the empty status region; checking: a status line, never a dialog (G29)', () => {
    const idle = render({ kind: 'idle' });
    assert.equal(idle.filter((el) => el.type === 'ConfirmDialog').length, 0);
    const region = idle.find((el) => el.props?.role === 'status');
    assert.equal(region.props['aria-live'], 'polite');
    assert.equal(region.props.children, null);
    const checking = render({ kind: 'checking' });
    assert.equal(checking.filter((el) => el.type === 'ConfirmDialog').length, 0, 'not a dialog');
    assert.equal(textOfElement(checking.find((el) => el.props?.role === 'status')), '学習の記録を保存しています…');
    assert.ok(!checking.some((el) => el.type === 'button'), 'no buttons');
  });

  it('asking: a fresh dialog for every question (keyed by ask); stay signed in first; the body starts 「まだログアウトしていません。」', () => {
    const first = render({ kind: 'asking', unsaved: 2, ask: 1 }).find((el) => el.type === 'ConfirmDialog');
    const second = render({ kind: 'asking', unsaved: 2, ask: 2 }).find((el) => el.type === 'ConfirmDialog');
    assert.equal(first.key, 1);
    assert.equal(second.key, 2, 'a new key: mounted fresh (showModal, focus on Cancel)');
    const p = first.props;
    assert.equal(p.open, true);
    assert.equal(p.cancelLabel, 'ログアウトしない', 'ConfirmDialog focuses Cancel first');
    assert.equal(p.confirmLabel, 'このままログアウト');
    assert.equal(p.confirmTone, 'danger');
    assert.equal(p.returnFocusRef, undefined, 'focus goes back through restoreLogoutFocus');
    assert.equal(p.title, 'まだ保存できていない学習があります');
    assert.equal(p.body, 'まだログアウトしていません。2 件のレッスンの記録を、まだアカウントに保存できていません。このままログアウトすると、記録はこの端末に残り、次に同じアカウントでログインしたときに保存します。その前に別のアカウントでログインすると、この記録は消えます。');
    const en = render({ kind: 'asking', unsaved: 1, ask: 3 }, 'en').find((el) => el.type === 'ConfirmDialog').props;
    assert.equal(en.body, "You are still signed in. One lesson record isn't saved to your account yet. If you log out now, it stays on this device and is saved the next time you sign in with this account. If someone signs in with a different account first, it is deleted.");
    assert.match(render({ kind: 'asking', unsaved: 3, ask: 4 }, 'en').find((el) => el.type === 'ConfirmDialog').props.body, /^You are still signed in\. 3 lesson records aren't saved/);
    assert.deepEqual([en.cancelLabel, en.confirmLabel], ['Stay signed in', 'Log out anyway']);
  });

  it('Esc or 「ログアウトしない」 (the dialog closes): "stay", then focus back through the fallback chain (G30); 「このままログアウト」: "log out"', () => {
    globalThis.__answers = [];
    globalThis.__restored = [];
    const target = { name: 'logout button' };
    globalThis.__target = target;
    const dialog = render({ kind: 'asking', unsaved: 1, ask: 1 }).find((el) => el.type === 'ConfirmDialog');
    dialog.props.onClose();
    assert.deepEqual(globalThis.__answers, [false]);
    assert.deepEqual(globalThis.__restored, [target]);
    dialog.props.onConfirm();
    assert.deepEqual(globalThis.__answers, [false, true]);
    delete globalThis.__target;
    const host = readFile('App.tsx');
    assert.match(host, /<ProgressAdoptDialog \/>\s*\{\/\*[^*]*\*\/\}\s*<UnsavedLogoutDialog \/>/, 'mounted once in App, outside the Layout');
  });
});

describe('LessonEnd: where the rating went (G32) and 「このレッスンを最初からやり直す」 (design §2.6)', () => {
  const LESSON = {
    id: 'vibe-ch1',
    objectives: [{ id: 'o1', text: 'Goal one' }],
    sections: [{ id: 's1', blocks: [{ id: 'b1', type: 'markdown' }] }],
  };
  const reader = ({ ratings = {}, seen = ['b1'], resetLesson = async () => ({ ok: true }), rated = [] } = {}) => ({
    lesson: LESSON,
    courseSlug: 'vibe-coding',
    scrollToBlock() {},
    progress: {
      progress: { v: 1, seen, answers: {}, checks: {}, ratings, lastBlockId: null, updatedAt: '2026-10-25T00:00:00.000Z' },
      pct: 50,
      getCheck: () => undefined,
      setRating: (id, r) => rated.push([id, r]),
      resetLesson,
    },
  });
  const render = (props = {}, globals = {}) => elementsOf(renderUi(ui, ui.LessonEnd, { next: null, prev: null, backTo: '/c', resettable: true, ...props }, {
    __view: VIEW(),
    __sync: { status: 'on', userId: U1 },
    __reader: reader(),
    ...globals,
  }));
  const savedLine = (els) => textOfElement(byClass(els, 'rp-end-saved')[0]);
  const resetButton = (els) => byClass(els, 'rp-reset-btn')[0] ?? null;

  it('G32: the line is chosen when the learner rates and later save-state changes never change it', () => {
    const rated = [];
    const before = renderUi(ui, ui.LessonEnd, { next: null, prev: null, backTo: '/c' }, { __view: VIEW({ state: 'saved' }), __sync: { status: 'on', userId: U1 }, __reader: reader({ rated }) });
    assert.equal(savedLine(elementsOf(before)), '', 'nothing before a rating');
    const radio = elementsOf(before).find((el) => el.type === 'input' && el.props.type === 'radio');
    globalThis.__sets = [];
    globalThis.__view = VIEW({ state: 'saved' });
    globalThis.__reader = reader({ rated });
    radio.props.onChange();
    const [index, where] = globalThis.__sets.find(([, v]) => v === 'account' || v === 'device');
    assert.equal(where, 'account');
    assert.deepEqual(rated, [['o1', 1]]);
    delete globalThis.__view;
    delete globalThis.__reader;
    // Then the device goes offline: the text stays (no re-announcement on the flip).
    const later = render({}, { __view: VIEW({ state: 'offline', pending: 1 }), __reader: reader({ ratings: { o1: 1 } }), __state: { [index]: 'account' } });
    assert.equal(savedLine(later), '記録しました。「まだ不安」の目標は、あとで読み返しましょう。');
    // Rated while offline: "on this device", also once back online.
    const device = render({}, { __view: VIEW({ state: 'saved' }), __reader: reader({ ratings: { o1: 1 } }), __state: { [index]: 'device' } });
    assert.equal(savedLine(device), 'この端末に記録しました。「まだ不安」の目標は、あとで読み返しましょう。');
    // Ratings already there at mount: chosen once from the view then.
    assert.equal(savedLine(render({}, { __view: VIEW({ state: 'local' }), __reader: reader({ ratings: { o1: 2 } }) })), 'この端末に記録しました。「まだ不安」の目標は、あとで読み返しましょう。');
    assert.equal(savedLine(render({}, { __view: VIEW({ state: 'saving', pending: 1 }), __reader: reader({ ratings: { o1: 2 } }) })), '記録しました。「まだ不安」の目標は、あとで読み返しましょう。');
    // A lesson that never syncs (drafts, the gallery): this device.
    assert.equal(ui.savedWhereOf({ state: 'saved' }, false), 'device');
    for (const state of ['offline', 'stopped', 'local']) assert.equal(ui.savedWhereOf({ state }, true), 'device', state);
    for (const state of ['saved', 'saving', 'loading']) assert.equal(ui.savedWhereOf({ state }, true), 'account', state);
  });

  it('the control: hidden without the reader\'s permission, a synced learner, the server\'s offer or anything to delete', () => {
    assert.ok(resetButton(render()), 'shown');
    assert.equal(resetButton(render({ resettable: false })), null, 'not allowed by the reader (preview, gallery)');
    assert.equal(resetButton(render({}, { __sync: { status: 'off', userId: null } })), null, 'guests, mock, Nexloom-only');
    assert.equal(resetButton(render({}, { __caps: { lessonReset: false, achievements: true } })), null, 'an older server');
    assert.equal(resetButton(render({}, { __caps: null })), null, 'not known yet');
    assert.equal(resetButton(render({}, { __reader: reader({ seen: [] }) })), null, 'nothing to delete');
    const status = byClass(render({ resettable: false }), 'rp-end-reset-status')[0];
    assert.equal(status.props.role, 'status', 'the reason line is always mounted');
  });

  it('sync not on: aria-disabled with a helper line that says why; on (or a background refresh): enabled and opens the dialog', () => {
    const OFFLINE = 'いまはサーバーとつながっていないため、やり直せません。つながってから、もう一度お試しください。';
    const LATER = 'いまはやり直せません。';
    for (const [sync, view, text] of [
      [{ status: 'offline', userId: U1 }, VIEW({ state: 'offline' }), OFFLINE],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'network' }), OFFLINE],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'server' }), OFFLINE],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'auth' }), 'ログインし直すと、やり直せます。'],
      [{ status: 'offline', userId: U1 }, VIEW({ state: 'stopped', reason: 'auth' }), 'ログインし直すと、やり直せます。'],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'account' }), LATER],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'storage' }), LATER],
      [{ status: 'hydrating', userId: U1 }, VIEW({ state: 'loading' }), '読み込みが終わると、やり直せます。'],
      [{ status: 'needs_choice', userId: U1 }, VIEW({ state: 'local' }), LATER],
      // The browser is offline while the sync stays 'on' (only uploads fail): pending or not.
      [{ status: 'on', userId: U1 }, VIEW({ state: 'offline', pending: 1, online: false }), OFFLINE],
      [{ status: 'on', userId: U1 }, VIEW({ state: 'saved', online: false }), OFFLINE],
      // A retry load while offline with something pending.
      [{ status: 'hydrating', userId: U1 }, VIEW({ state: 'offline', pending: 1, online: false }), OFFLINE],
    ]) {
      const els = render({}, { __sync: sync, __view: view });
      const button = resetButton(els);
      assert.equal(button.props['aria-disabled'], true, sync.status);
      const help = els.find((el) => el.props?.id === button.props['aria-describedby']);
      assert.equal(textOfElement(help), text, `${sync.status} ${view.state} ${view.reason}`);
      globalThis.__sets = [];
      button.props.onClick();
      assert.deepEqual(globalThis.__sets, [], 'a click does nothing');
    }
    assert.equal(ui.resetHelpOf({ state: 'stopped', reason: 'auth' }), 'auth');
    const en = render({}, { __language: 'en', __sync: { status: 'stopped', userId: U1 }, __view: VIEW({ state: 'stopped', reason: 'auth' }) });
    assert.equal(textOfElement(en.find((el) => el.props?.id === resetButton(en).props['aria-describedby'])), 'You can start over after you sign in again.');
    for (const [sync, view] of [[{ status: 'on', userId: U1 }, VIEW()], [{ status: 'hydrating', userId: U1 }, VIEW({ state: 'saved' })]]) {
      const els = render({}, { __sync: sync, __view: view });
      const button = resetButton(els);
      assert.equal(button.props['aria-disabled'], undefined, sync.status);
      assert.equal(button.props['aria-describedby'], undefined);
      assert.equal(textOfElement(button), 'このレッスンを最初からやり直す');
      assert.deepEqual(iconsOf(elementsOf(walk(button))), ['RotateCcw']);
      globalThis.__sets = [];
      button.props.onClick();
      assert.ok(globalThis.__sets.some(([, v]) => v === true), 'opens the dialog');
    }
  });

  it('the dialog: Cancel first, danger, what goes and what stays; success tells the reader only once it has closed', async () => {
    let resets = 0;
    const els = render({ onLessonReset: () => { resets += 1; } }, { __reader: reader({ resetLesson: async () => ({ ok: true }) }) });
    const dialog = els.find((el) => el.type === 'ConfirmDialog');
    assert.equal(dialog.props.open, false, 'always mounted, closed');
    assert.equal(dialog.props.title, 'このレッスンを最初からやり直しますか？');
    assert.deepEqual([dialog.props.cancelLabel, dialog.props.confirmLabel, dialog.props.confirmTone], ['やめる', 'やり直す', 'danger']);
    const body = textOf(walk(dialog.props.body));
    assert.match(body, /^このレッスンで読んだところ、確認問題の答え、チェック、自己評価、続きの位置を消します。ログインしているすべての端末から消え、元に戻すことはできません。/);
    // XP is kept per milestone (start 10, done 40): a lesson only started still earns 'done' when
    // finished after the reset, so the copy promises only that earned XP is not given again.
    assert.match(body, /もらった XP とバッジ、学んだ日、学習の履歴は残ります。すでにもらった XP は、このレッスンでもう一度もらうことはありません。AI アプリにすでに渡した内容は消えません。$/);
    assert.doesNotMatch(body, /このレッスンで、もう一度 XP をもらうことはありません/);
    const enDialog = render({}, { __language: 'en' }).find((el) => el.type === 'ConfirmDialog');
    const enBody = textOf(walk(enDialog.props.body));
    assert.match(enBody, /XP you already earned for this lesson is not given again\./);
    assert.doesNotMatch(enBody, /This lesson does not give XP again/);
    // The button opens the dialog and is where focus returns (Cancel, Esc, a refusal).
    const button = resetButton(els);
    button.props.ref.current = { name: 'reset button', isConnected: true };
    button.props.onClick();
    assert.equal(dialog.props.returnFocusRef.current?.name, 'reset button', 'focus returns to the button');
    globalThis.__sets = [];
    globalThis.document = focusDocument();
    await dialog.props.onConfirm();
    await wait(1);
    assert.equal(resets, 0, 'not while the dialog is still open');
    assert.ok(globalThis.__sets.some(([, v]) => v === false), 'the dialog closes');
    assert.equal(dialog.props.returnFocusRef.current, null, 'no focus back to a button that goes');
    dialog.props.onClose();
    assert.equal(resets, 1, 'after the close: status line, top, focus on the title');
    dialog.props.onClose();
    assert.equal(resets, 1, 'once');
    delete globalThis.document;
  });

  it('the dialog closed before the request ended (Chromium: a repeated Esc while busy): the reader is told at once, and only once', async () => {
    let resets = 0;
    let release;
    const els = render({ onLessonReset: () => { resets += 1; } }, { __reader: reader({ resetLesson: () => new Promise((resolve) => { release = resolve; }) }) });
    const button = resetButton(els);
    const dialog = els.find((el) => el.type === 'ConfirmDialog');
    button.props.ref.current = { name: 'reset button', isConnected: true };
    button.props.onClick();
    globalThis.document = focusDocument();
    dialog.props.onConfirm();
    dialog.props.onClose(); // closed while busy
    assert.equal(resets, 0, 'nothing done yet');
    release({ ok: true });
    await wait(1);
    assert.equal(resets, 1, 'no close event will come: told when the request ends');
    assert.equal(dialog.props.returnFocusRef.current, null);
    // The next time the dialog is opened and cancelled, nothing is said.
    button.props.onClick();
    dialog.props.onClose();
    assert.equal(resets, 1, 'no stale success');
    delete globalThis.document;
  });

  it('opening the dialog starts clean: a success never closed by its dialog is not reported by the next one', async () => {
    let resets = 0;
    const els = render({ onLessonReset: () => { resets += 1; } }, { __reader: reader({ resetLesson: async () => ({ ok: true }) }) });
    const button = resetButton(els);
    const dialog = els.find((el) => el.type === 'ConfirmDialog');
    button.props.ref.current = { name: 'reset button', isConnected: true };
    button.props.onClick();
    dialog.props.onConfirm();
    await wait(1);
    assert.equal(resets, 0, 'still open: waits for the close');
    button.props.onClick(); // (no close event came, e.g. the dialog was replaced)
    globalThis.document = focusDocument();
    dialog.props.onClose();
    delete globalThis.document;
    assert.equal(resets, 0);
  });

  it('a refusal: the reason under the button, focus back to it, the reader is not told', async () => {
    let resets = 0;
    const els = render({ onLessonReset: () => { resets += 1; } }, { __reader: reader({ resetLesson: async () => ({ ok: false, reason: 'rate_limited' }) }) });
    const button = resetButton(els);
    const dialog = els.find((el) => el.type === 'ConfirmDialog');
    const ref = { name: 'reset button', isConnected: true };
    button.props.ref.current = ref;
    button.props.onClick();
    globalThis.__sets = [];
    await dialog.props.onConfirm();
    await wait(1);
    const [failureIndex] = globalThis.__sets.find(([, v]) => v === 'rate_limited');
    let doc = focusDocument();
    globalThis.document = doc;
    dialog.props.onClose();
    assert.equal(dialog.props.returnFocusRef.current, ref, 'ConfirmDialog returns focus to the button');
    assert.equal(doc.main.focused, 0, 'the button is there: main is left alone');
    // The button went meanwhile (another device deleted the progress: 'reloaded'): focus goes to main.
    button.props.onClick();
    await dialog.props.onConfirm();
    await wait(1);
    ref.isConnected = false;
    doc = focusDocument();
    globalThis.document = doc;
    dialog.props.onClose();
    assert.equal(doc.main.focused, 1);
    assert.deepEqual(doc.main.opts, { preventScroll: true });
    delete globalThis.document;
    assert.equal(resets, 0);
    const after = render({}, { __state: { [failureIndex]: 'rate_limited' } });
    assert.equal(textOfElement(byClass(after, 'rp-end-reset-status')[0]), '操作が続いたため、少し待ってからもう一度お試しください。');
    const reasons = { unsupported: 'いまはやり直せません。', not_published: 'このレッスンは、やり直しの対象ではありません。', failed: '何も変更していません', unconfirmed: 'このページを開き直してください', reloaded: 'ほかの端末で消されていたため' };
    for (const [reason, text] of Object.entries(reasons)) {
      assert.match(textOfElement(byClass(render({}, { __state: { [failureIndex]: reason } }), 'rp-end-reset-status')[0]), new RegExp(text), reason);
    }
  });

  it('the reader: sections keyed by drops (G16), the title focusable, LessonEnd and the header outside; only the learn route allows a reset', () => {
    const reader = readFile('components/lesson/LessonReader.tsx');
    const keyed = /<React\.Fragment key=\{progress\.drops\}>\s*\{lesson\.sections\.map\(\(section\) => \{[\s\S]*?<\/React\.Fragment>\s*<LessonEnd next=\{next\} prev=\{prev\} backTo=\{backTo\} resettable=\{allowReset && syncable\} onLessonReset=\{onLessonReset\} \/>/;
    assert.match(reader, keyed);
    assert.ok(reader.indexOf('<LessonHeader lesson={lesson} entry={entry} />') < reader.indexOf('<React.Fragment key={progress.drops}>'), 'the header stays mounted');
    assert.match(reader, /showSaveState=\{syncable\}/);
    assert.match(reader, /document\.getElementById\(lessonTitleId\(lesson\.id\)\)\?\.focus\(\{ preventScroll: true \}\);/);
    assert.match(readFile('components/lesson/LessonHeader.tsx'), /<h1 id=\{lessonTitleId\(lesson\.id\)\} className="rp-title" tabIndex=\{-1\}/);
    assert.match(readFile('components/routes/LearnRoute.tsx'), /allowReset=\{mode === 'learn'\}/);
    assert.doesNotMatch(readFile('components/routes/DevBlocksRoute.tsx'), /allowReset/);
  });
});

describe('LeftRecordsNotice: records left on this device, on the sign-in view', () => {
  function storageWith(entries) {
    const map = new Map(Object.entries(entries));
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    };
  }
  const record = (updatedAt) => JSON.stringify({ v: 1, seen: ['b1'], answers: {}, checks: {}, lastBlockId: null, updatedAt });
  const AT = '2026-10-25T01:00:00.000Z';

  it('shown for a logged-out account with unchanged markers (the count, no lesson names); hidden otherwise', () => {
    const left = {
      [ui.SYNC_ACCOUNT_KEY]: JSON.stringify({ userId: U1, epoch: null, loggedOut: true }),
      'rp:progress:vibe-coding:vibe-ch1': record(AT),
      [`${ui.SYNC_PENDING_PREFIX}vibe-coding:vibe-ch1`]: AT,
      'rp:progress:vibe-coding:vibe-ch2': record(AT),
      [`${ui.SYNC_PENDING_PREFIX}vibe-coding:vibe-ch2`]: AT,
    };
    globalThis.window = { localStorage: storageWith(left) };
    try {
      const tokens = renderUi(ui, ui.LeftRecordsNotice);
      const els = elementsOf(tokens);
      const text = textOf(tokens);
      assert.equal(text, 'この端末に、まだ保存できていない学習の記録があります（2 件）。前と同じアカウントでログインすると保存します。別のアカウントでログインすると、この記録は消えます。');
      assert.doesNotMatch(text, /vibe/);
      assert.ok(!els.some((el) => el.props?.role), 'present at mount: not a live region');
      assert.deepEqual(iconsOf(els), ['CloudOff']);
      globalThis.window = { localStorage: storageWith({ ...left, [ui.SYNC_ACCOUNT_KEY]: JSON.stringify({ userId: U1, epoch: null }) }) };
      assert.deepEqual(elementsOf(renderUi(ui, ui.LeftRecordsNotice)), [], 'still signed in: nothing');
      globalThis.window = { localStorage: storageWith({ ...left, 'rp:progress:vibe-coding:vibe-ch1': record('2026-10-25T02:00:00.000Z'), 'rp:progress:vibe-coding:vibe-ch2': record('2026-10-25T02:00:00.000Z') }) };
      assert.deepEqual(elementsOf(renderUi(ui, ui.LeftRecordsNotice)), [], 'changed since (another learner wrote): nothing');
      // A session that ended without a logout: only what was unsent then (the server has ch2).
      globalThis.window = { localStorage: storageWith({ ...left, [ui.SYNC_ACCOUNT_KEY]: JSON.stringify({ userId: U1, epoch: null, loggedOut: true, unsent: ['vibe-coding:vibe-ch1'] }) }) };
      assert.match(textOf(renderUi(ui, ui.LeftRecordsNotice)), /（1 件）/);
      globalThis.window = { localStorage: storageWith({ ...left, [ui.SYNC_ACCOUNT_KEY]: JSON.stringify({ userId: U1, epoch: null, loggedOut: true, unsent: [] }) }) };
      assert.deepEqual(elementsOf(renderUi(ui, ui.LeftRecordsNotice)), [], 'nothing was unsent: nothing');
      // Lessons the server does not store never save: not counted.
      globalThis.window = { localStorage: storageWith(left) };
      assert.deepEqual(elementsOf(renderUi(ui, ui.LeftRecordsNotice, {}, { __syncable: false })), [], 'not a lesson the server stores');
    } finally {
      delete globalThis.window;
    }
    assert.match(textOf(walk(expand(ui.LeftRecordsNoticeView({ language: 'en', count: 1 })))), /^This device has learning that isn't saved yet \(one lesson\)\. Sign in with the same account to save it\. If you sign in with a different account, it is deleted\.$/);
    assert.match(readFile('components/common/ExperienceLoginView.tsx'), /<LeftRecordsNotice \/>\s*\n\s*<div className="flex rounded-full/, 'above the form');
  });
});

const SNAP = (status, data = null) => ({ status, learnerId: data ? U1 : null, data, at: data ? 1 : null });
const DATA = (patch = {}) => ({
  learnerId: U1,
  xp: { total: 230, level: 3, intoLevel: 30, levelSize: 100, toNextLevel: 70 },
  counts: { lessonsStarted: 5, lessonsDone: 4, stagesDone: 1 },
  streak: { current: 0, best: 5, activeToday: false, today: '2026-10-25', timeZone: 'Asia/Tokyo' },
  badges: [
    { id: 'first_lesson', earned: true, current: 1, goal: 1 },
    { id: 'five_lessons', earned: true, current: 5, goal: 5 },
    { id: 'fifteen_lessons', earned: false, current: 5, goal: 15 },
    { id: 'first_course', earned: false, current: 9, goal: 13, course: 'vibe-coding' },
    { id: 'three_courses', earned: false, current: 0, goal: 3 },
    { id: 'streak_3', earned: true, current: 3, goal: 3 },
    { id: 'streak_7', earned: false, current: 0, goal: 7 },
  ],
  ...patch,
});
const NOT_READY = ['idle', 'loading', 'unavailable', 'unsupported', 'no_account'];

describe('XP and badges on screen (design §3.7): server data only, nothing made up', () => {
  it('ProgressCluster: the chips only with an answer; otherwise nothing (no zero)', () => {
    for (const status of NOT_READY) assert.equal(ui.ProgressClusterView({ snapshot: SNAP(status), language: 'jp' }), null, status);
    const tokens = renderUi(ui, ui.ProgressClusterView, { snapshot: SNAP('ready', DATA({ streak: { current: 3, best: 5, activeToday: false, today: '2026-10-25', timeZone: 'Asia/Tokyo' } })), language: 'jp' });
    const els = elementsOf(tokens);
    const text = textOf(tokens);
    assert.match(text, /連続 3 日 — 今日読むと続きます/);
    assert.match(text, /Lv 3/);
    assert.match(text, /30 \/ 100 XP/);
    const bar = els.find((el) => el.props?.role === 'progressbar');
    assert.deepEqual([bar.props['aria-valuenow'], bar.props['aria-valuemax']], [30, 100]);
    assert.match(textOf(renderUi(ui, ui.ProgressClusterView, { snapshot: SNAP('ready', DATA()), language: 'jp' })), /連続 0 日 — 今日の1レッスンでスタート/);
  });

  it('ProfilePassport: level, XP and streak from the server; otherwise 「—」 with a screen-reader text per status', () => {
    const passportTokens = (snapshot, language = 'jp') => renderUi(ui, ui.ProfilePassport, { onNavigate() {} }, {
      __ach: snapshot, __language: language, __auth: { user: { name: 'Aki', isGuest: false, avatar: '' }, logout: async () => true },
    });
    const passport = (snapshot, language) => elementsOf(passportTokens(snapshot, language));
    const ready = textOf(passportTokens(SNAP('ready', DATA({ streak: { current: 4, best: 5, activeToday: true, today: '2026-10-25', timeZone: 'Asia/Tokyo' } }))));
    assert.match(ready, /レベル3XP230/);
    // The front is a light card in every theme (its gradient is white): light tokens scoped to it,
    // or the name, level and XP turn near-white on white in dark mode (in-app check).
    const faces = passport(SNAP('ready', DATA())).filter((el) => el.props?.['data-theme']);
    assert.deepEqual(faces.map((el) => el.props['data-theme']), ['light', 'dark']);
    assert.match(textOfElement(faces[0]), /Aki.*レベル3XP230/);
    assert.match(ready, /連続日数4日合計XP230/);
    const expected = {
      idle: '読み込んでいます', loading: '読み込んでいます', unavailable: '読み込めませんでした',
      unsupported: 'XP とバッジは、まもなく使えるようになります', no_account: 'XP とバッジは、Rise Path のアカウントでログインすると記録されます',
    };
    for (const status of NOT_READY) {
      const els = passport(SNAP(status));
      const dashes = els.filter((el) => el.props?.['aria-hidden'] === 'true' && textOfElement(el) === '—');
      assert.equal(dashes.length, 4, `${status}: level, XP, streak, total`);
      const sr = byClass(els, 'sr-only').map(textOfElement).filter((t) => t === expected[status]);
      assert.equal(sr.length, 4, status);
      assert.doesNotMatch(textOf(passportTokens(SNAP(status))), /\d+日|レベル\d/, `${status}: no number`);
    }
    assert.equal(ui.notReadyText('en', 'no_account'), 'XP and badges are recorded when you sign in with a Rise Path account');
    assert.equal(ui.notReadyText('en', 'unsupported'), 'XP and badges will be available soon');
  });

  it('badges: award words only on earned badges (G20); unearned streak badges show the current streak (G33); the next badge', () => {
    const tokens = renderUi(ui, ui.ProfileBadgesBody, { language: 'jp', snapshot: SNAP('ready', DATA()), onRetry() {} });
    const els = elementsOf(tokens);
    const items = els.filter((el) => el.type === 'li');
    assert.equal(items.length, 7);
    for (const item of items) {
      const text = textOfElement(item);
      if (item.props['data-earned']) {
        assert.match(text, /獲得済み/);
        assert.ok(!elementsOf(walk(item)).some((el) => el.props?.role === 'progressbar'));
      } else {
        assert.doesNotMatch(text, /獲得済み|記念|レジェンド|おめでとう/, text);
        const bar = elementsOf(walk(item)).find((el) => el.props?.role === 'progressbar');
        assert.ok(bar, 'progress, with a name');
        assert.ok(bar.props['aria-label']);
        assert.ok(elementsOf(walk(item)).some((el) => el.type === 'LockKeyhole'), 'not only colour: a lock');
      }
    }
    // The JP rule has a counter before the verb (finding 10).
    assert.match(textOfElement(items[2]), /レッスンかステージを 15 個終える/);
    for (const item of items) assert.doesNotMatch(textOfElement(item), /\d+ 終える/, 'a number needs a counter before the verb');
    // Headings: the badge names sit under their own list heading, not under the next-badge card.
    const headingsOf = (list) => list.filter((el) => /^h[1-6]$/.test(el.type));
    const parentOfFirstBadge = (list) => {
      const headings = headingsOf(list);
      return headings.slice(0, headings.findIndex((el) => el.type === 'h3')).reverse().find((el) => el.type === 'h2');
    };
    assert.equal(textOfElement(parentOfFirstBadge(els)), 'すべてのバッジ', 'badge names sit under their own list heading');
    assert.equal(headingsOf(els).filter((el) => el.type === 'h3').length, 7);
    assert.equal(els.find((el) => el.props?.id === 'rp-next-badge').props.tabIndex, -1, 'focus target after a successful retry');
    const streak7 = textOfElement(items[6]);
    assert.match(streak7, /^7 日つづけて学習7 日つづけて学ぶ（日本時間）いまの連続 0 日。あと 7 日つづけると獲得$/, 'the current streak (0), not the best (5)');
    assert.match(textOfElement(items[3]), /バイブコーディング入門：9 \/ 13・あと 4/, 'the course nearest to done, by name');
    assert.match(textOf(tokens), /いちばん長い連続: 5 日/);
    const next = els.find((el) => el.type === 'section');
    assert.match(textOfElement(next), /^次のバッジ: コース修了1 つのコースの、いま公開されているレッスンをすべて終える/);
    assert.doesNotMatch(textOfElement(next), /獲得済み/);
    assert.equal(ui.nextBadge(DATA().badges).id, 'first_course', '9/13 is the nearest');
    assert.equal(ui.nextBadge(DATA().badges.map((b) => ({ ...b, earned: true }))), null);
    const allTokens = renderUi(ui, ui.ProfileBadgesBody, { language: 'jp', snapshot: SNAP('ready', DATA({ badges: DATA().badges.map((b) => ({ ...b, earned: true, current: b.goal })) })), onRetry() {} });
    const all = textOf(allTokens);
    assert.match(all, /すべてのバッジを獲得しました/);
    assert.equal(textOfElement(parentOfFirstBadge(elementsOf(allTokens))), 'すべてのバッジ', 'not under 「すべてのバッジを獲得しました」');
    assert.equal(elementsOf(allTokens).find((el) => el.props?.id === 'rp-next-badge').props.tabIndex, -1);
    assert.equal(ui.badgeProgressText('en', { id: 'streak_7', earned: false, current: 1, goal: 7 }), '1 day in a row now; 6 more days in a row to earn it');
    assert.equal(ui.badgeProgressText('en', { id: 'streak_3', earned: false, current: 2, goal: 3 }), '2 days in a row now; 1 more day in a row to earn it');
    assert.equal(ui.badgeProgressText('en', { id: 'five_lessons', earned: false, current: 2, goal: 5 }), '2 / 5 · 3 to go');
  });

  it('badges: an unearned badge\'s track shows on its card in both themes (the line token, not sunken: dark sunken is the card\'s colour)', () => {
    const els = elementsOf(renderUi(ui, ui.ProfileBadgesBody, { language: 'jp', snapshot: SNAP('ready', DATA()), onRetry() {} }));
    const tracks = els.filter((el) => el.props?.role === 'progressbar');
    assert.ok(tracks.length > 0);
    for (const track of tracks) {
      assert.match(track.props.className, /\bbg-line\b/);
      assert.doesNotMatch(track.props.className, /\bbg-sunken\b/);
    }
  });

  it('badges: loading is a status line; unavailable offers "try again"; unsupported and no_account say so with no button', () => {
    const bodyTokens = (status) => renderUi(ui, ui.ProfileBadgesBody, { language: 'jp', snapshot: SNAP(status), onRetry: () => { globalThis.__retried = (globalThis.__retried ?? 0) + 1; } });
    const body = (status) => elementsOf(bodyTokens(status));
    for (const status of ['idle', 'loading']) {
      const els = body(status);
      assert.equal(els[0].props.role, 'status');
      assert.equal(textOfElement(els[0]), '読み込んでいます…');
    }
    const unavailable = body('unavailable');
    assert.match(textOf(bodyTokens('unavailable')), /いまはバッジを表示できません。しばらくしてから、もう一度お試しください。/);
    const retry = unavailable.find((el) => el.type === 'button');
    assert.match(textOfElement(retry), /もう一度読み込む/);
    globalThis.__retried = 0;
    retry.props.onClick();
    assert.equal(globalThis.__retried, 1);
    // The learner's retry while it loads: the same panel, its button aria-disabled (focus stays
    // on it), a status line; a click does nothing. When it fails again, the status line says so.
    const busyTokens = renderUi(ui, ui.ProfileBadgesBody, { language: 'jp', snapshot: SNAP('loading'), retry: 'busy', onRetry: () => { globalThis.__retried += 1; } });
    const busy = elementsOf(busyTokens);
    assert.ok(busy.some((el) => el.type === 'section'), 'still the panel');
    const busyButton = busy.find((el) => el.type === 'button');
    assert.equal(busyButton.props['aria-disabled'], true);
    assert.match(textOfElement(busyButton), /読み込んでいます…/);
    globalThis.__retried = 0;
    busyButton.props.onClick();
    assert.equal(globalThis.__retried, 0, 'a click while it loads does nothing');
    assert.equal(textOfElement(busy.find((el) => el.props?.role === 'status')), '読み込んでいます…');
    const idleStatus = unavailable.find((el) => el.props?.role === 'status');
    assert.equal(textOfElement(idleStatus), '', 'always mounted; silent before a retry');
    assert.equal(retry.props['aria-disabled'], undefined);
    const failed = elementsOf(renderUi(ui, ui.ProfileBadgesBody, { language: 'jp', snapshot: SNAP('unavailable'), retry: 'failed', onRetry() {} }));
    const failedStatus = failed.find((el) => el.props?.role === 'status');
    assert.equal(textOfElement(failedStatus), 'まだバッジを表示できません。しばらくしてから、もう一度お試しください。');
    // Seen too (in-app check: the panel otherwise looks the same as before the retry); "loading"
    // is the button's own label, so its status line stays for screen readers.
    assert.doesNotMatch(failedStatus.props.className, /\bsr-only\b/);
    assert.match(busy.find((el) => el.props?.role === 'status').props.className, /^sr-only$/);
    assert.match(idleStatus.props.className, /^sr-only$/);
    // Not the learner's retry (a background load): the plain loading line.
    const background = elementsOf(renderUi(ui, ui.ProfileBadgesBody, { language: 'jp', snapshot: SNAP('loading'), retry: null, onRetry() {} }));
    assert.equal(background[0].type, 'p');
    assert.match(textOf(bodyTokens('unsupported')), /^バッジは、まもなく使えるようになります。$/);
    assert.match(textOf(bodyTokens('no_account')), /^XP とバッジは、Rise Path のアカウントでログインすると記録されます。$/);
    for (const status of ['unsupported', 'no_account']) assert.ok(!body(status).some((el) => el.type === 'button'), status);
  });

  it('the badges page: a retry is the learner\'s until it ends; failed again → the status line says so; the badges arrived → focus on the next-badge heading', () => {
    const runEffects = (effects) => {
      const heading = { focused: 0, focus(opts) { this.focused += 1; this.opts = opts; } };
      globalThis.document = { getElementById: (id) => (id === 'rp-next-badge' ? heading : null) };
      globalThis.__sets = [];
      try {
        for (const effect of effects) effect();
      } finally {
        delete globalThis.document;
      }
      return { heading, sets: globalThis.__sets.filter(([i]) => i === 0).map(([, v]) => v) };
    };
    globalThis.__reloads = 0;
    const els = elementsOf(renderUi(ui, ui.ProfileBadgesView, {}, { __ach: SNAP('unavailable') }));
    els.find((el) => el.type === 'button').props.onClick();
    assert.deepEqual(globalThis.__sets.filter(([i]) => i === 0).map(([, v]) => v), ['busy']);
    assert.equal(globalThis.__reloads, 1);
    // While it loads: the panel stays, nothing changes.
    const loading = renderUi(ui, ui.ProfileBadgesView, {}, { __ach: SNAP('loading'), __state: { 0: 'busy' } });
    assert.equal(elementsOf(loading).find((el) => el.type === 'button').props['aria-disabled'], true);
    assert.deepEqual(runEffects(globalThis.__effects).sets, []);
    renderUi(ui, ui.ProfileBadgesView, {}, { __ach: SNAP('unavailable'), __state: { 0: 'busy' } });
    assert.deepEqual(runEffects(globalThis.__effects).sets, ['failed']);
    renderUi(ui, ui.ProfileBadgesView, {}, { __ach: SNAP('ready', DATA()), __state: { 0: 'busy' } });
    const done = runEffects(globalThis.__effects);
    assert.deepEqual(done.sets, [null]);
    assert.equal(done.heading.focused, 1, 'the button is gone: focus on the next-badge heading');
    assert.deepEqual(done.heading.opts, { preventScroll: true });
    // A load that was not the learner's retry moves nothing.
    renderUi(ui, ui.ProfileBadgesView, {}, { __ach: SNAP('ready', DATA()) });
    const quiet = runEffects(globalThis.__effects);
    assert.deepEqual([quiet.sets, quiet.heading.focused], [[], 0]);
  });

  it('the old local XP is gone: no gamificationService, no ui/activity, no legacy badges or trophy', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'services/gamificationService.ts')), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'components/ui/activity.ts')), false);
    for (const file of ['components/ui/ProgressCluster.tsx', 'components/features/dashboard/ProfilePassport.tsx', 'components/features/dashboard/profile/ProfileBadgesView.tsx']) {
      const text = readFile(file);
      assert.doesNotMatch(text, /gamificationService|ui\/activity|from '\.\/activity'|getLearningEvents|getAllProgress/, file);
      assert.match(text, /useAchievements\(\)/, file);
    }
    const badges = readFile('components/features/dashboard/profile/ProfileBadgesView.tsx');
    assert.doesNotMatch(badges, /初ビルド|First Build|AI探究者|AI Explorer|学習の守護者|マスター|レジェンド|Legendary|記念|Milestone Trophy/);
    assert.match(badges, /setTheme\('default'\)/);
  });
});

describe('Phase 8 (S2): the lesson end shows the server\'s XP for the lesson', () => {
  const KEY = 'vibe-coding/vibe-ch1';
  const LESSON = { id: 'vibe-ch1', objectives: [{ id: 'o1', text: 'Goal one' }], sections: [{ id: 's1', blocks: [{ id: 'b1', type: 'markdown' }] }] };
  const reader = (state = 'read', lesson = LESSON) => ({
    lesson,
    courseSlug: 'vibe-coding',
    scrollToBlock() {},
    progress: {
      progress: { v: 1, seen: ['b1'], answers: {}, checks: {}, ratings: {}, lastBlockId: null, updatedAt: '2026-10-25T00:00:00.000Z' },
      pct: 100,
      state,
      getCheck: () => undefined,
      setRating() {},
      resetLesson: async () => ({ ok: true }),
    },
  });
  const WITH = (xp = 40) => SNAP('ready', DATA({ lessonXp: { [KEY]: xp, 'vibe-coding/vibe-ch2': 40 } }));
  const WITHOUT = () => SNAP('ready', DATA({ lessonXp: { 'vibe-coding/vibe-ch2': 40 } }));
  const OLDER = () => SNAP('ready', DATA());
  const render = (globals = {}) => {
    globalThis.__achCalls = 0;
    const els = elementsOf(renderUi(ui, ui.LessonEnd, { next: null, prev: null, backTo: '/c', resettable: true }, {
      __view: VIEW(),
      __sync: { status: 'on', userId: U1 },
      __reader: reader(),
      __ach: WITH(),
      ...globals,
    }));
    return { els, item: byClass(els, 'rp-end-xp')[0] ?? null, calls: globalThis.__achCalls };
  };
  /** The useState index of LessonXpItem's sawWithout: the setter its effect calls on an answer without the award. */
  const sawWithoutIndex = () => {
    render({ __ach: WITHOUT() });
    for (const effect of globalThis.__effects) effect();
    const set = globalThis.__sets.filter(([, value]) => value === true);
    assert.equal(set.length, 1, JSON.stringify(globalThis.__sets));
    return set[0][0];
  };

  it('lacksLessonXp: true only for a current answer from a server that sends lessonXp, without this lesson', () => {
    assert.equal(ui.lacksLessonXp(WITHOUT(), KEY), true);
    assert.equal(ui.lacksLessonXp(WITH(), KEY), false);
    assert.equal(ui.lacksLessonXp(OLDER(), KEY), false, 'an older server: never "without"');
    assert.equal(ui.lacksLessonXp({ ...WITHOUT(), at: null }, KEY), false, 'a stale answer');
    for (const status of NOT_READY) assert.equal(ui.lacksLessonXp(SNAP(status), KEY), false, status);
    assert.equal(ui.lacksLessonXp({ status: 'unavailable', data: WITHOUT().data, at: 1 }, KEY), false);
  });

  it('lessonXpLineOf: the server\'s figure, total or new by what the page saw; nothing without a current figure', () => {
    assert.deepEqual(ui.lessonXpLineOf(WITH(), KEY, false), { kind: 'total', xp: 40 });
    assert.deepEqual(ui.lessonXpLineOf(WITH(), KEY, true), { kind: 'new', xp: 40 });
    assert.deepEqual(ui.lessonXpLineOf(WITH(80), KEY, true), { kind: 'new', xp: 80 }, 'the server\'s number as it is');
    assert.equal(ui.lessonXpLineOf(WITHOUT(), KEY, true), null);
    assert.equal(ui.lessonXpLineOf(OLDER(), KEY, true), null, 'an older server');
    assert.equal(ui.lessonXpLineOf({ ...WITH(), at: null }, KEY, false), null, 'stale');
    for (const status of NOT_READY) assert.equal(ui.lessonXpLineOf(SNAP(status), KEY, true), null, status);
    assert.equal(ui.lessonXpLineOf({ status: 'unavailable', data: WITH().data, at: 1 }, KEY, false), null);
    // Object.prototype keys are not lessons.
    assert.equal(ui.lessonXpLineOf(WITHOUT(), 'constructor', false), null);
    assert.equal(ui.lacksLessonXp(WITHOUT(), 'constructor'), true);
  });

  it('a done lesson with the award in the ledger: the ledger fact, with no 「+」 (a revisit, another device, a redo); EN too', () => {
    const { item, calls } = render();
    assert.ok(item, 'the XP item');
    assert.equal(textOfElement(item), 'このレッスンを終えたときにもらった XP：40');
    assert.equal(item.type, 'li');
    assert.ok(byClass([item], 'tabular').length === 1);
    // Text only, like the progress item and ProgressCluster's XP: no icon (Sparkles is the AI tutor's glyph in the reader).
    assert.deepEqual(walk(item.props.children).filter((t) => 'el' in t).map((t) => t.el.type), []);
    assert.equal(item.props.role, undefined, 'not a live region');
    assert.equal(item.props['aria-live'], undefined);
    assert.equal(calls, 1);
    assert.equal(textOfElement(render({ __language: 'en' }).item), 'XP for finishing this lesson: 40');
    // Running the effect with the award already there never turns 「+」 on.
    render();
    for (const effect of globalThis.__effects) effect();
    assert.equal(globalThis.__sets.some(([, value]) => value === true), false);
  });

  it('「+40 XP」 only after this page saw a current answer without the award (the effect records it), then one with it', () => {
    const index = sawWithoutIndex();
    const { item } = render({ __state: { [index]: true } });
    assert.equal(textOfElement(item), 'このレッスンを終えて +40 XP');
    assert.equal(textOfElement(render({ __state: { [index]: true }, __language: 'en' }).item), '+40 XP for finishing this lesson');
    assert.equal(render({ __ach: WITHOUT() }).item, null, 'while the award is not there: nothing yet');
    // A stale answer without the award does not count as "seen without".
    render({ __ach: { ...WITHOUT(), at: null } });
    for (const effect of globalThis.__effects) effect();
    assert.equal(globalThis.__sets.some(([, value]) => value === true), false);
  });

  it('nothing on an older API (no lessonXp), or without a current answer: the browser never makes the line up from the local record', () => {
    assert.equal(render({ __ach: OLDER() }).item, null, 'an older server');
    assert.equal(render({ __ach: { ...WITH(), at: null } }).item, null, 'stale');
    for (const status of NOT_READY) assert.equal(render({ __ach: SNAP(status) }).item, null, status);
    assert.equal(render({ __ach: { status: 'unavailable', learnerId: U1, data: WITH().data, at: 1 } }).item, null);
  });

  it('D7: no achievements consumer unless the lesson is done, syncs, a learner is synced and the server offers achievements', () => {
    assert.equal(render().calls, 1);
    for (const state of ['read', 'checked', 'mastered']) assert.equal(render({ __reader: reader(state) }).calls, 1, state);
    for (const [why, globals] of [
      ['in_progress', { __reader: reader('in_progress') }],
      ['not_started', { __reader: reader('not_started') }],
      ['not syncable', { __syncable: false }],
      ['capability off', { __caps: { lessonReset: true, achievements: false } }],
      ['an older server (no capability)', { __caps: { lessonReset: true } }],
      ['capabilities unknown', { __caps: null }],
      ['no synced learner', { __sync: { status: 'off', userId: null } }],
    ]) {
      const { item, calls } = render(globals);
      assert.equal(calls, 0, why);
      assert.equal(item, null, why);
    }
  });

  it('once a current answer holds the award, the line is kept and the item stops reading (no consumer; final review, finding 5)', () => {
    render();
    globalThis.__sets = [];
    for (const effect of globalThis.__effects) effect();
    const kept = globalThis.__sets.filter(([, value]) => value && typeof value === 'object' && 'kind' in value);
    assert.deepEqual(kept.map(([, value]) => value), [{ kind: 'total', xp: 40 }], 'the reader hands its line over');
    const keptIndex = kept[0][0];
    for (const [line, text] of [[{ kind: 'total', xp: 40 }, 'このレッスンを終えたときにもらった XP：40'], [{ kind: 'new', xp: 40 }, 'このレッスンを終えて +40 XP']]) {
      const { item, calls } = render({ __state: { [keptIndex]: line }, __ach: { ...WITHOUT(), at: null } });
      assert.equal(textOfElement(item), text, 'the kept line, whatever the store holds now');
      assert.equal(calls, 0, 'no useAchievements: no consumer, so an upload sends no read');
    }
    // No line yet: nothing is handed over, and the reader stays.
    render({ __ach: WITHOUT() });
    globalThis.__sets = [];
    for (const effect of globalThis.__effects) effect();
    assert.equal(globalThis.__sets.some(([, value]) => value && typeof value === 'object' && 'kind' in value), false);
    // Keyed by the learner: another learner's page never shows a line kept for the first.
    const source = readFile('components/lesson/LessonEnd.tsx');
    assert.match(source, /<LessonXpItem key=\{sync\.userId \?\? ''\} lessonKey=\{`\$\{courseSlug\}\/\$\{lesson\.id\}`\} \/>/);
  });

  describe('with a real achievements store: reads per page (final review, finding 5)', () => {
    let mod = null;
    before(async () => {
      mod = await fresh(await bundle(
        "export * from './components/ui/achievementsClient';",
        [[/\/progressSyncClient$/, 'syncForAchievements'], [/^react$/, 'react'], [/supabaseClient$/, 'supabase']],
      ));
    });

    /**
     * LessonEnd on a page with a real store on a fake clock. commit() renders, mounts or unmounts
     * the store's consumer as React would (useAchievements rendered or not), runs the effects and
     * keeps what they set for the next render.
     * @param {(n: number) => Record<string, number>} lessonXpOfLoad the ledger the n-th read answers
     */
    function page(lessonXpOfLoad) {
      let t = 0;
      const queue = [];
      const env = { loads: 0 };
      const s = mod.createAchievementsStore({
        load: async () => {
          env.loads += 1;
          return { ...DATA({ lessonXp: lessonXpOfLoad(env.loads) }), learnerId: U1 };
        },
        learnerId: () => U1,
        capabilities: () => ({ lessonReset: true, achievements: true }),
        now: () => t,
        setTimeout: (fn, ms) => { const h = { at: t + ms, fn }; queue.push(h); return h; },
        clearTimeout: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
      });
      let state = {};
      let release = null;
      const commit = () => {
        globalThis.__consumerEffects = [];
        const { item, calls } = render({ __achStore: s, __state: state });
        if (calls > 0 && !release) release = globalThis.__consumerEffects[0]();
        if (calls === 0 && release) { release(); release = null; }
        globalThis.__sets = [];
        for (const effect of globalThis.__effects) effect();
        for (const [i, v] of globalThis.__sets) state = { ...state, [i]: v };
        delete globalThis.__achStore;
        return item;
      };
      const advance = async (ms) => {
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
      return { s, env, commit, advance };
    }

    it('a revisit of a finished lesson: one read when it opens, none for the uploads after it', async () => {
      const { s, env, commit, advance } = page(() => ({ [KEY]: 40 }));
      assert.equal(commit(), null, 'loading');
      await advance(0);
      assert.equal(env.loads, 1);
      assert.equal(textOfElement(commit()), 'このレッスンを終えたときにもらった XP：40');
      assert.equal(textOfElement(commit()), 'このレッスンを終えたときにもらった XP：40', 'kept: the reader has unmounted');
      for (let i = 0; i < 3; i += 1) {
        s.serverProgress(); // PROGRESS_SAVED_EVENT: an upload of this page (a scroll position, a card)
        await advance(20_000);
        assert.equal(textOfElement(commit()), 'このレッスンを終えたときにもらった XP：40');
      }
      assert.equal(env.loads, 1, 'no read per upload (without the latch: 4)');
    });

    it('finishing the lesson: a read without the award, the upload, a read with it (「+40 XP」), then none', async () => {
      const { s, env, commit, advance } = page((n) => (n === 1 ? {} : { [KEY]: 40 }));
      commit();
      await advance(0);
      assert.equal(commit(), null, 'the award is not there yet');
      commit(); // the effect recorded "seen without"
      s.serverProgress(); // the upload with the done state
      await advance(20_000);
      assert.equal(env.loads, 2);
      assert.equal(textOfElement(commit()), 'このレッスンを終えて +40 XP');
      assert.equal(textOfElement(commit()), 'このレッスンを終えて +40 XP', 'kept');
      for (let i = 0; i < 3; i += 1) {
        s.serverProgress();
        await advance(20_000);
        commit();
      }
      assert.equal(env.loads, 2, 'the two reads design D7 counts, no more');
    });
  });

  it('the stats list: the XP item right after the progress item, before the cards; copy in both languages', () => {
    const withCards = { ...LESSON, sections: [{ id: 's1', blocks: [{ id: 'b1', type: 'markdown' }, { id: 'fc', type: 'flashcards', cards: [{ id: 'c1', front: 'F', back: 'B' }] }] }] };
    const { els } = render({ __reader: reader('read', withCards) });
    const stats = byClass(els, 'rp-end-stats')[0];
    const items = walk(stats.props.children).filter((t) => 'el' in t && t.el.type === 'li').map((t) => t.el);
    assert.deepEqual(items.map((li) => textOfElement(li)), ['100% 完了', 'このレッスンを終えたときにもらった XP：40', '復習カード 覚えた 0/1 · 復習カードへ移動']);
    const source = readFile('components/lesson/LessonEnd.tsx');
    assert.match(source, /xpNew: \(n: number\) => `\+\$\{n\} XP for finishing this lesson`,/);
    assert.match(source, /xpTotal: \(n: number\) => `XP for finishing this lesson: \$\{n\}`,/);
    assert.match(source, /xpNew: \(n: number\) => `このレッスンを終えて \+\$\{n\} XP`,/);
    assert.match(source, /xpTotal: \(n: number\) => `このレッスンを終えたときにもらった XP：\$\{n\}`,/);
    // Not 「終えてもらった」: that reads as the favour form 〜てもらう ("had someone finish it").
    assert.doesNotMatch(source, /終えてもらった/);
    // The lesson end has no AI control: the reader's AI glyph stays out of it.
    assert.doesNotMatch(source, /\bSparkles\b/);
  });
});

describe('in-app check (static)', () => {
  it('the disabled reset control is dimmed (not only a lighter grey); the "resumed" pill wraps below 768 px instead of cutting its text', () => {
    const css = readFile('components/lesson/reader.css');
    assert.match(css, /\.rp-reset-btn\[aria-disabled="true"\] \{[^}]*opacity: 0\.6;/);
    const narrow = css.slice(css.indexOf('@media (max-width: 767px) {'));
    assert.match(narrow, /^@media \(max-width: 767px\) \{[\s\S]*?\.rp-notice \{\s*width: max-content;\s*white-space: normal;/);
    assert.match(narrow, /\.rp-notice \.rp-link-btn \{\s*white-space: nowrap;/);
  });

  it('the English menu names the student ID page as its heading does', () => {
    assert.match(readFile('components/common/Layout.tsx'), /profileOverview: 'Student ID',/);
    assert.match(readFile('components/features/dashboard/ProfilePassport.tsx'), /studentId: 'Student ID',/);
  });
});

describe('logout callers and copy rules (static)', () => {
  it('AuthContext: the question first ("stay" returns false before anything is cleared); account deletion never asks', () => {
    const auth = readFile('context/AuthContext.tsx');
    const logout = auth.slice(auth.indexOf('const logout = useCallback'));
    const gate = logout.indexOf('if (!(await confirmUnsavedLearning(options))) return false;');
    assert.ok(gate > 0 && gate < logout.indexOf('clearSharedDeviceAiData('), 'G12');
    assert.match(auth, /logout: \(options\?: \{ reason\?: 'reauth' \}\) => Promise<boolean>;/);
    const deletion = auth.slice(auth.indexOf('const endDeletedAccountSession'), auth.indexOf('const logout = useCallback'));
    assert.doesNotMatch(deletion, /confirmUnsavedLearning/);
    // The primary session ending elsewhere closes an open question (it would no longer be true).
    assert.match(auth, /\} else if \(!_event\.startsWith\('SIGNED_IN'\) && !session\) \{\s*(\/\/[^\n]*\n\s*)*stopProgressSync\(\);\s*(\/\/[^\n]*\n\s*)*endUnsavedLearningQuestion\(\);/);
  });

  it('the four callers that navigate stay when the learner chose to stay; the seven "sign in again" buttons never ask', () => {
    assert.match(readFile('App.tsx'), /logout\(\)\s*\.then\(\(done\) => \{ if \(done !== false\) navigate\('\/', \{ replace: true \}\); \}\)/);
    assert.match(readFile('components/legal/LegalConsentView.tsx'), /logout\(\)\s*\.then\(\(done\) => \{ if \(done !== false\) navigate\('\/', \{ replace: true \}\); \}\)/);
    assert.match(readFile('components/features/dashboard/ProfilePassport.tsx'), /if \(\(await logout\(\)\) === false\) return;\s*window\.location\.href = '\/';/);
    assert.match(readFile('components/features/oauth/OAuthConsentView.tsx'), /try \{\s*\/\/[^\n]*\n\s*if \(\(await logout\(\)\) === false\) return;/);
    const reauth = {
      'components/features/ai/CourseGeneratorView.tsx': 2,
      'components/features/dashboard/assessment/PersonalAssessmentView.tsx': 1,
      'components/common/LessonView.tsx': 1,
      'components/safety/AiAccessSetupView.tsx': 1,
      'components/lesson/TutorPanel.tsx': 2,
      'components/lesson/SaveStoppedNotice.tsx': 1,
    };
    for (const [file, n] of Object.entries(reauth)) {
      const text = readFile(file);
      assert.equal(text.split("logout({ reason: 'reauth' })").length - 1, n, file);
      assert.doesNotMatch(text, /logout\(\)/, `${file}: no bare logout()`);
    }
  });

  it('new and rewritten UI: design tokens only, copy in both languages, です・ます without 「簡単です」「誰でも」', () => {
    const files = [
      'components/lesson/SaveChip.tsx', 'components/lesson/ReaderStatus.tsx', 'components/lesson/SaveStoppedNotice.tsx',
      'components/lesson/LeftRecordsNotice.tsx', 'components/lesson/UnsavedLogoutDialog.tsx', 'components/lesson/LessonEnd.tsx',
      'components/lesson/LessonBar.tsx', 'components/ui/ProgressCluster.tsx', 'components/features/dashboard/profile/ProfileBadgesView.tsx',
      'components/features/dashboard/ProfilePassport.tsx',
    ];
    for (const file of files) {
      const text = readFile(file);
      if (file !== 'components/features/dashboard/ProfilePassport.tsx') assert.doesNotMatch(text, TOKEN_RULE, file);
      assert.doesNotMatch(text, /簡単です|誰でも/, file);
      assert.match(text, /const copy = \{\s*en: \{/, file);
      assert.match(text, /\bjp: \{/, file);
    }
    // ProfilePassport keeps its old palette classes (design §3.7) and gains none.
    assert.equal((readFile('components/features/dashboard/ProfilePassport.tsx').match(TOKEN_RULE) ?? []).length, 0);
    const css = readFile('components/lesson/reader.css');
    const added = css.slice(css.indexOf('/* Phase 5: where the record is saved (SaveChip).'), css.indexOf('/* Progress ring */'));
    assert.doesNotMatch(added, /#[0-9a-fA-F]{3,8}\b/, 'reader.css Phase 5 rules: tokens only');
  });
});
