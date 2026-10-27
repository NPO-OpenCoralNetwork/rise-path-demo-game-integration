// Phase 6 front end, the React-free part (design p6 §5.1, §5.2, §7.1 "Client: capability and
// learner", "Client: session"):
// - components/review/reviewClient.ts: the review store is the Phase 5 achievements store with
//   capabilityKey 'review' (an older API: no request; a 404 without error_type latches), its window
//   events (REVIEW_STALE_EVENT at once), a grade answer for another Japan-time day marks it stale,
//   grades go out only for the session's learner (session_changed before any request), and after
//   a grade the page's store and the XP/streak store catch up; a capability withdrawn while the
//   page is open clears what was shown.
// - services/reviewApi.ts: the answers' shapes, the refusals' fields, only four fields sent.
// - components/review/reviewModel.ts: today's card state, the grade block rules, the page's
//   session (refusals move on without counting, the cap ends it, a failure stays and names the
//   button, another learner ends it, an HTML 404 ends it), the session against the store
//   (sessionSyncAction), the counter after a reload, minutes, due-day formatting in any device
//   time zone.
// The modules are bundled with esbuild (a Vite dependency) with the sync client, React and Supabase
// stubbed, and loaded fresh for each describe (module-level state).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';

const STUBS = {
  // The sync as the review store sees it: globalThis.__learner (the synced learner),
  // __caps (capabilities), __session (the primary session's learner; runAsSyncedLearner refuses another).
  sync: `
    export const syncedLearnerId = () => globalThis.__learner ?? null;
    export const progressCapabilities = () => globalThis.__caps ?? null;
    export const runAsSyncedLearner = async (call) => {
      const expected = globalThis.__learner ?? null;
      const current = globalThis.__session === undefined ? expected : globalThis.__session;
      if (!expected || (current !== null && current !== expected)) {
        const err = new Error('The signed-in learner changed');
        err.status = 401;
        err.errorType = 'session_changed';
        throw err;
      }
      return call();
    };
    export const subscribeProgressSaveView = () => () => {};
  `,
  // globalThis.__runEffects runs an effect at once (a mounted consumer of the page's store).
  react: `
    export const useEffect = (fn) => { if (globalThis.__runEffects) fn(); };
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

const ENTRY = [
  "export * from './components/ui/achievementsClient';",
  "export * from './components/review/reviewClient';",
  "export * from './components/review/reviewModel';",
  "export * from './services/reviewApi';",
].join('\n');
const STUBBED = [[/\/progressSyncClient$/, 'sync'], [/^react$/, 'react'], [/supabaseClient$/, 'supabase']];

const CARD = (n, patch = {}) => ({
  courseSlug: 'claude-code',
  lessonId: 'cc-03-plan-first',
  cardId: `card-${n}`,
  lessonTitle: '第3回｜探索→計画→実装→コミット',
  lessonLocale: 'jp',
  front: `問い ${n}`,
  back: { jp: `答え ${n}`, en: `Answer ${n}` },
  dueOn: '2026-10-25',
  ...patch,
});
const SUMMARY = (patch = {}) => ({
  today: '2026-10-27', dailyLimit: 10, doneToday: 0, remainingToday: 3, dueTotal: 3, carriedOver: 0, inQueue: 12, nextDueOn: '2026-10-29', ...patch,
});
const QUEUE = (learnerId = U1, patch = {}, cards = [CARD(1), CARD(2), CARD(3)]) => ({
  ok: true, learnerId, timeZone: 'Asia/Tokyo', ...SUMMARY({ remainingToday: cards.length, dueTotal: cards.length }), ...patch, cards,
});

describe('reviewApi: the answers and the refusals', () => {
  let mod = null;
  before(async () => {
    mod = await fresh(await bundle("export * from './services/reviewApi';", [[/supabaseClient$/, 'supabase']]));
  });

  const respond = (status, body, { text = false } = {}) => {
    respond.calls = [];
    globalThis.fetch = async (url, init = {}) => {
      respond.calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      return new Response(text ? body : JSON.stringify(body), { status, headers: { 'Content-Type': text ? 'text/html' : 'application/json' } });
    };
  };

  it('GET 200: parsed with the card text as written (string or { jp, en }); the learner id in lower case', async () => {
    respond(200, QUEUE(U1.toUpperCase()));
    const queue = await mod.getReviewQueue();
    assert.deepEqual(respond.calls.map((c) => `${c.method} ${c.url}`), ['GET /api/v2/user/review']);
    assert.equal(queue.learnerId, U1);
    assert.equal(queue.cards.length, 3);
    assert.deepEqual(queue.cards[0].back, { jp: '答え 1', en: 'Answer 1' });
    assert.equal(queue.cards[0].front, '問い 1');
    assert.equal(queue.nextDueOn, '2026-10-29');
    respond(200, QUEUE(U1, { nextDueOn: null }));
    assert.equal((await mod.getReviewQueue()).nextDueOn, null);
  });

  it('POST /grade sends only the card and the rating, never a time; the 200 is parsed', async () => {
    respond(200, { ok: true, learnerId: U1, graded: { courseSlug: 'claude-code', lessonId: 'cc-03-plan-first', cardId: 'card-1', rating: 'good', dueOn: '2026-11-07', intervalDays: 11 }, summary: SUMMARY({ doneToday: 1, remainingToday: 2 }) });
    const result = await mod.gradeReviewCard({ courseSlug: 'claude-code', lessonId: 'cc-03-plan-first', cardId: 'card-1', rating: 'good', today: '2030-01-01', reveal: true });
    assert.deepEqual(respond.calls, [{ url: '/api/v2/user/review/grade', method: 'POST', body: { courseSlug: 'claude-code', lessonId: 'cc-03-plan-first', cardId: 'card-1', rating: 'good' } }]);
    assert.equal(result.graded.intervalDays, 11);
    assert.equal(result.summary.doneToday, 1);
  });

  it('409 refusals carry learnerId, reviewedToday, dueOn and the summary; one without a summary has none', async () => {
    respond(409, { ok: false, error: 'x', error_type: 'not_due', learnerId: U1.toUpperCase(), reviewedToday: true, dueOn: '2026-11-07', summary: SUMMARY({ doneToday: 4 }) });
    await assert.rejects(mod.gradeReviewCard({ courseSlug: 'c', lessonId: 'l', cardId: 'card-1', rating: 'again' }), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.errorType, 'not_due');
      assert.equal(err.learnerId, U1);
      assert.equal(err.reviewedToday, true);
      assert.equal(err.dueOn, '2026-11-07');
      assert.equal(err.summary.doneToday, 4);
      return true;
    });
    respond(409, { ok: false, error: 'x', error_type: 'not_due', learnerId: U1, reviewedToday: true, dueOn: '2026-11-07' });
    await assert.rejects(mod.gradeReviewCard({ courseSlug: 'c', lessonId: 'l', cardId: 'card-1', rating: 'again' }), (err) => err.summary === undefined && err.reviewedToday === true);
    respond(409, { ok: false, error: 'x', error_type: 'review_limit', learnerId: U1, doneToday: 10, dailyLimit: 10, summary: SUMMARY({ doneToday: 10, remainingToday: 0, carriedOver: 2 }) });
    await assert.rejects(mod.gradeReviewCard({ courseSlug: 'c', lessonId: 'l', cardId: 'card-1', rating: 'good' }), (err) => err.errorType === 'review_limit' && err.summary.carriedOver === 2);
  });

  it('an older server\'s HTML 404 has no errorType; 401 and 503 keep theirs; a malformed 200 is bad_response; the network is 0', async () => {
    respond(404, '<!DOCTYPE html><title>Error</title>', { text: true });
    await assert.rejects(mod.getReviewQueue(), (err) => err.status === 404 && err.errorType === undefined);
    respond(401, { error: 'Sign in', error_type: 'sign_in_required' });
    await assert.rejects(mod.getReviewQueue(), (err) => err.status === 401 && err.errorType === 'sign_in_required');
    respond(503, { ok: false, error: 'down', error_type: 'review_unavailable' });
    await assert.rejects(mod.getReviewQueue(), (err) => err.status === 503 && err.errorType === 'review_unavailable');
    respond(200, { ok: true, learnerId: U1 });
    await assert.rejects(mod.getReviewQueue(), (err) => err.errorType === 'bad_response');
    respond(200, { ok: true, learnerId: U1, graded: { rating: 'good' }, summary: SUMMARY() });
    await assert.rejects(mod.gradeReviewCard({ courseSlug: 'c', lessonId: 'l', cardId: 'card-1', rating: 'good' }), (err) => err.errorType === 'bad_response');
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(mod.getReviewQueue(), (err) => err.status === 0 && err.errorType === 'network');
  });

  it('parseReviewQueue refuses anything but the documented shape (one bad card fails the answer)', () => {
    assert.ok(mod.parseReviewQueue(QUEUE()));
    for (const patch of [
      { learnerId: '' }, { today: '27/10/2026' }, { doneToday: -1 }, { remainingToday: 1.5 }, { nextDueOn: 'soon' },
      { cards: 'x' }, { cards: [CARD(1, { front: 3 })] }, { cards: [CARD(1, { back: { jp: 1 } })] },
      { cards: [CARD(1, { lessonLocale: 'de' })] }, { cards: [CARD(1, { dueOn: null })] }, { cards: [CARD(1, { cardId: '' })] },
    ]) {
      assert.equal(mod.parseReviewQueue({ ...QUEUE(), ...patch }), null, JSON.stringify(patch));
    }
  });
});

describe('reviewClient: the review store (the Phase 5 store with capabilityKey "review")', () => {
  let mod = null;
  before(async () => {
    mod = await fresh(await bundle(ENTRY, STUBBED));
  });

  /** A review store with fake timers, clock and load. */
  function store({ learner = U1, caps = { lessonReset: true, achievements: true, review: true }, load } = {}) {
    let t = 0;
    const queue = [];
    const env = { learner, caps, loads: 0 };
    const s = mod.createAchievementsStore({
      load: async () => {
        env.loads += 1;
        return load ? load(env) : mod.parseReviewQueue(QUEUE(env.learner?.toUpperCase()));
      },
      learnerId: () => env.learner,
      capabilities: () => env.caps,
      capabilityKey: 'review',
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

  it('the review capability gates the requests: review false, or a Phase 5 server that offers only achievements → unsupported, no request', async () => {
    for (const caps of [{ lessonReset: true, achievements: true, review: false }, { lessonReset: true, achievements: true }]) {
      const { s, env } = store({ caps });
      s.consumerMounted();
      s.stale();
      s.serverProgress();
      await s.reload();
      await env.advance(60_000);
      assert.equal(s.getSnapshot().status, 'unsupported', JSON.stringify(caps));
      assert.equal(env.loads, 0, JSON.stringify(caps));
    }
    const { s, env } = store();
    s.consumerMounted();
    await s.settled();
    assert.deepEqual([s.getSnapshot().status, env.loads, s.getSnapshot().data.remainingToday], ['ready', 1, 3]);
  });

  it('a server upgraded to reviews (the sync\'s next GET offers them): fetched at once, once', async () => {
    const { s, env } = store({ caps: { lessonReset: true, achievements: true, review: false } });
    s.consumerMounted();
    s.syncChanged(); // the sync's GET: achievements on, reviews off (the Phase 5 API)
    await s.settled();
    assert.deepEqual([s.getSnapshot().status, env.loads], ['unsupported', 0]);
    env.caps = { lessonReset: true, achievements: true, review: true };
    s.syncChanged();
    await s.settled();
    assert.deepEqual([s.getSnapshot().status, env.loads], ['ready', 1]);
    s.syncChanged();
    await s.settled();
    assert.equal(env.loads, 1, 'once');
  });

  it('a server that stops offering reviews while the page is open (a rollback): unsupported at once, the list and the count go, no request', async () => {
    const { s, env } = store();
    s.syncChanged(); // the sync's GET: reviews on
    s.consumerMounted();
    await s.settled();
    assert.deepEqual([s.getSnapshot().status, env.loads, s.getSnapshot().data.remainingToday], ['ready', 1, 3]);
    env.caps = { lessonReset: true, achievements: true, review: false };
    s.syncChanged(); // the sync's next GET answered by the Phase 5 image
    assert.deepEqual(s.getSnapshot(), { status: 'unsupported', learnerId: U1, data: null, at: null });
    s.serverProgress();
    s.stale();
    await env.advance(60_000);
    assert.equal(env.loads, 1, 'no request while the capability is off');
    env.caps = { lessonReset: true, achievements: true, review: true };
    s.syncChanged(); // rolled forward again
    await s.settled();
    assert.deepEqual([s.getSnapshot().status, env.loads], ['ready', 2]);
    // The Phase 5 achievements store (default key) the same way.
    let loadsCount = 0;
    let offered = { lessonReset: true, achievements: true };
    const a = mod.createAchievementsStore({ load: async () => { loadsCount += 1; return { learnerId: U1 }; }, learnerId: () => U1, capabilities: () => offered });
    a.syncChanged();
    a.consumerMounted();
    await a.settled();
    assert.equal(a.getSnapshot().status, 'ready');
    offered = { lessonReset: true, achievements: false };
    a.syncChanged();
    assert.deepEqual([a.getSnapshot().status, a.getSnapshot().data, loadsCount], ['unsupported', null, 1]);
  });

  it('achievements stay gated by their own capability (the default key): a Phase 6 server without achievements is unsupported there', async () => {
    let loadsCount = 0;
    const s = mod.createAchievementsStore({
      load: async () => { loadsCount += 1; return { learnerId: U1 }; },
      learnerId: () => U1,
      capabilities: () => ({ lessonReset: true, achievements: false, review: true }),
    });
    s.consumerMounted();
    await s.settled();
    assert.equal(s.getSnapshot().status, 'unsupported');
    assert.equal(loadsCount, 0);
  });

  it('a 404 without error_type is an older server: unsupported for the page load, no more requests', async () => {
    const { s, env } = store({ caps: null, load: () => { throw new mod.ReviewApiError('Request failed (404)', 404); } });
    s.consumerMounted();
    await s.settled();
    assert.equal(s.getSnapshot().status, 'unsupported');
    env.caps = { lessonReset: true, achievements: true, review: true };
    s.consumerMounted();
    s.stale();
    s.serverProgress();
    s.syncChanged();
    await s.reload();
    await env.advance(60_000);
    assert.equal(env.loads, 1);
    assert.equal(s.getSnapshot().status, 'unsupported');
  });

  it('no synced learner: no_account and no request; an answer for another learner is dropped', async () => {
    const guest = store({ learner: null });
    guest.s.consumerMounted();
    await guest.s.settled();
    assert.deepEqual([guest.s.getSnapshot().status, guest.env.loads], ['no_account', 0]);
    let answers = [U2, U1];
    const { s, env } = store({ load: () => mod.parseReviewQueue(QUEUE(answers.shift())) });
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 2);
    assert.equal(s.getSnapshot().data.learnerId, U1);
  });

  /** The window events through a stand-in target. */
  const events = (s) => {
    const handlers = new Map();
    const target = { addEventListener: (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]) };
    mod.listenForReviewChanges(s, target);
    return (type, detail) => (handlers.get(type) ?? []).forEach((fn) => fn({ type, detail }));
  };

  it('window events: REVIEW_STALE_EVENT fetches at once while mounted; a save only marks the list out of date; a server-sourced record fetches 2 s later; a local write does not', async () => {
    const { s, env } = store();
    const fire = events(s);
    assert.equal(mod.REVIEW_STALE_EVENT, 'rp:review-stale');
    const unmount = s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 1);
    fire(mod.REVIEW_STALE_EVENT);
    await s.settled();
    assert.equal(env.loads, 2, 'a reset or a delete-all removed cards: at once');
    fire('rp:progress-saved');
    await env.advance(60_000);
    assert.equal(env.loads, 2, 'a save: no request (a card enters due tomorrow at the earliest)');
    assert.equal(s.getSnapshot().at, null, 'out of date: the next consumer reads');
    fire('rp:progress-change', { courseSlug: 'c', lessonId: 'l', source: 'server' });
    await env.advance(1_999);
    assert.equal(env.loads, 2, 'trailing');
    await env.advance(15_000);
    assert.equal(env.loads, 3, 'a server-sourced record (another tab\'s reset) can lower today\'s count');
    fire('rp:progress-change', { courseSlug: 'c', lessonId: 'l' });
    await env.advance(60_000);
    assert.equal(env.loads, 3, 'a local write is not a save');
    unmount();
    fire(mod.REVIEW_STALE_EVENT);
    assert.equal(s.getSnapshot().at, null, 'without a consumer: marked stale, the next consumer fetches');
    assert.equal(env.loads, 3);
  });

  it('a lesson page (the sidebar mounted): 30 saves 20 s apart send no review request; the dashboard card or /review mounting reads once; a server-sourced record still reads (regressions #16)', async () => {
    const { s, env } = store();
    const fire = events(s);
    s.consumerMounted(); // the sidebar, on every page
    await s.settled();
    assert.equal(env.loads, 1);
    for (let i = 0; i < 30; i += 1) {
      fire('rp:progress-saved');
      await env.advance(20_000);
    }
    await env.advance(60_000);
    assert.equal(env.loads, 1, 'no review GET per save: a classroom keeps its per-IP budget');
    assert.equal(s.getSnapshot().at, null);
    s.consumerMounted(); // the dashboard card or /review
    await s.settled();
    assert.equal(env.loads, 2, 'the next consumer reads the out-of-date list');
    assert.notEqual(s.getSnapshot().at, null);
    fire('rp:progress-change', { courseSlug: 'c', lessonId: 'l', source: 'server' });
    await env.advance(15_000);
    assert.equal(env.loads, 3);
  });

  it('a lesson\'s first save on this device (the server\'s answer, echo, then saved): no review request; a server-sourced record without echo still reads (in-app check 1)', async () => {
    const { s, env } = store();
    const fire = events(s);
    s.consumerMounted(); // the sidebar on the lesson page
    await s.settled();
    assert.equal(env.loads, 1);
    // What the sync core sends when the PUT answer stamps the lesson's generation (born → known(null)).
    fire('rp:progress-change', { courseSlug: 'c', lessonId: 'l', source: 'server', echo: true });
    fire('rp:progress-saved');
    await env.advance(60_000);
    assert.equal(env.loads, 1, 'no review GET for this tab\'s own save');
    assert.equal(s.getSnapshot().at, null, 'out of date: the next consumer reads');
    s.consumerMounted(); // the dashboard card
    await s.settled();
    assert.equal(env.loads, 2);
    fire('rp:progress-change', { courseSlug: 'c', lessonId: 'l', source: 'server' });
    await env.advance(15_000);
    assert.equal(env.loads, 3, 'a hydrate, a refresh or a lesson_reset refusal still reads');
  });

  it('a save while a read is in flight: its answer is kept out of date, so the next consumer reads again', async () => {
    let release = null;
    const { s, env } = store({ load: (e) => new Promise((resolve) => { release = () => resolve(mod.parseReviewQueue(QUEUE(e.learner.toUpperCase()))); }) });
    const fire = events(s);
    s.consumerMounted();
    assert.equal(env.loads, 1);
    fire('rp:progress-saved');
    release();
    await s.settled();
    assert.equal(s.getSnapshot().status, 'ready');
    assert.equal(s.getSnapshot().at, null, 'the answer may predate the save');
    s.consumerMounted();
    assert.equal(env.loads, 2);
    release();
    await s.settled();
    assert.notEqual(s.getSnapshot().at, null, 'a read that began after the save is fresh');
  });

  it('after grades, a consumer that mounts reads at once (the dashboard after the done view, a second /review visit), not when the 15 s debounce ends (client #5)', async () => {
    const { s, env } = store();
    s.consumerMounted(); // the sidebar
    const unmountPage = s.consumerMounted(); // /review
    await s.settled();
    for (let i = 0; i < 10; i += 1) {
      await env.advance(4_000);
      mod.noteGradeAnswer(s, '2026-10-27');
    }
    unmountPage();
    await env.advance(1_000);
    const before = env.loads;
    assert.equal(s.getSnapshot().at, null, 'each grade made the held list out of date');
    s.consumerMounted(); // the dashboard card, 1 s after the last grade
    assert.equal(env.loads, before + 1, 'read at mount, not when the debounce ends');
    await s.settled();
    assert.notEqual(s.getSnapshot().at, null);
  });

  it('a grade answered while a read is in flight: one more read after it (that read may predate the grade)', async () => {
    let release = null;
    const { s, env } = store({ load: (e) => new Promise((resolve) => { release = () => resolve(mod.parseReviewQueue(QUEUE(e.learner.toUpperCase()))); }) });
    s.consumerMounted();
    assert.equal(env.loads, 1);
    mod.noteGradeAnswer(s, '2026-10-27');
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.loads, 2, 'the read that may predate the grade runs once more');
    release();
    await s.settled();
    assert.notEqual(s.getSnapshot().at, null);
  });

  it('a grade answer for another Japan-time day than the list marks the store stale (at once); the same day waits for the debounce', async () => {
    const { s, env } = store();
    s.consumerMounted();
    await s.settled();
    assert.equal(env.loads, 1);
    mod.noteGradeAnswer(s, '2026-10-27');
    await s.settled();
    assert.equal(env.loads, 1, 'same day: the save debounce');
    await env.advance(15_000);
    assert.equal(env.loads, 2);
    mod.noteGradeAnswer(s, '2026-10-28');
    await s.settled();
    assert.equal(env.loads, 3, 'the day turned while the page was open: read again now');
  });
});

describe('reviewClient: grades go out only for the session\'s learner', () => {
  let mod = null;
  before(async () => {
    mod = await fresh(await bundle(ENTRY, STUBBED));
  });

  const ARGS = { courseSlug: 'claude-code', lessonId: 'cc-03-plan-first', cardId: 'card-1', rating: 'good' };
  function serve() {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true, learnerId: U1, graded: { ...ARGS, dueOn: '2026-11-07', intervalDays: 11 }, summary: SUMMARY({ doneToday: 1 }) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return calls;
  }

  it('the sync now runs for another learner (or none): 401 session_changed and no request', async () => {
    const calls = serve();
    for (const learner of [U2, null]) {
      globalThis.__learner = learner;
      globalThis.__session = undefined;
      await assert.rejects(mod.gradeAsSyncedLearner(U1, ARGS), (err) => err.status === 401 && err.errorType === 'session_changed', String(learner));
    }
    assert.equal(calls.length, 0);
  });

  it('the primary session is another learner\'s: refused by the synced-learner rule, no request', async () => {
    const calls = serve();
    globalThis.__learner = U1;
    globalThis.__session = U2;
    await assert.rejects(mod.gradeAsSyncedLearner(U1, ARGS), (err) => err.errorType === 'session_changed');
    assert.equal(calls.length, 0);
  });

  it('the session\'s learner (compared in lower case): one POST with the card and the rating only', async () => {
    const calls = serve();
    globalThis.__learner = U1.toUpperCase();
    globalThis.__session = undefined;
    globalThis.__caps = { lessonReset: true, achievements: true, review: true };
    const result = await mod.gradeAsSyncedLearner(U1, ARGS);
    assert.equal(result.learnerId, U1);
    assert.deepEqual(calls.filter((c) => c.method === 'POST'), [{ url: '/api/v2/user/review/grade', method: 'POST', body: ARGS }]);
    delete globalThis.__learner;
    delete globalThis.__session;
    delete globalThis.__caps;
  });

  it('createGrader: a learner function that throws counts as no learner', async () => {
    let sent = 0;
    const grade = mod.createGrader({ learnerId: () => { throw new Error('x'); }, run: (call) => call(), grade: async () => { sent += 1; } });
    await assert.rejects(grade(U1, ARGS), (err) => err.errorType === 'session_changed');
    assert.equal(sent, 0);
  });
});

describe('reviewClient: after a grade, the stores catch up (design §5.2)', () => {
  let mod = null;
  before(async () => {
    mod = await fresh(await bundle(ENTRY, STUBBED));
  });

  const ARGS = { courseSlug: 'claude-code', lessonId: 'cc-03-plan-first', cardId: 'card-1', rating: 'good' };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const NEXT_DAY = SUMMARY({ today: '2026-10-28', doneToday: 1, remainingToday: 2 });

  it('a 200 or a refusal with counts for another Japan-time day reads the list again at once; a failure without counts does not; only a 200 marks the XP/streak store stale (its day became a learning day); an HTML 404 reads again and latches unsupported', async () => {
    const calls = [];
    let answer = null;
    globalThis.fetch = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'GET') return answer?.get ? answer.get() : json(200, QUEUE()); // today 2026-10-27
      return answer.post();
    };
    const win = new EventTarget();
    let xpStale = 0;
    win.addEventListener('rp:achievements-stale', () => { xpStale += 1; });
    globalThis.window = win;
    globalThis.__learner = U1;
    globalThis.__caps = { lessonReset: true, achievements: true, review: true };
    globalThis.__runEffects = true;
    const gets = () => calls.filter((c) => c === 'GET /api/v2/user/review').length;
    try {
      mod.useReviewQueue(); // the page mounts: its first read
      await mod.reviewQueueSettled();
      assert.deepEqual([gets(), mod.useReviewQueue().data.today], [1, '2026-10-27']);

      answer = { post: () => json(200, { ok: true, learnerId: U1, graded: { ...ARGS, dueOn: '2026-11-07', intervalDays: 11 }, summary: NEXT_DAY }) };
      await mod.gradeAsSyncedLearner(U1, ARGS);
      assert.equal(gets(), 2, 'the 200 named another day: read at once');
      assert.equal(xpStale, 1, 'the grade\'s day is a learning day: the streak store reads again');
      await mod.reviewQueueSettled();

      answer = { post: () => json(409, { ok: false, error: 'x', error_type: 'not_due', learnerId: U1, reviewedToday: true, dueOn: '2026-11-07', summary: NEXT_DAY }) };
      await assert.rejects(mod.gradeAsSyncedLearner(U1, ARGS), (err) => err.errorType === 'not_due');
      assert.equal(gets(), 3, 'a refusal with counts for another day: read at once');
      await mod.reviewQueueSettled();

      answer = { post: () => { throw new TypeError('Failed to fetch'); } };
      await assert.rejects(mod.gradeAsSyncedLearner(U1, ARGS), (err) => err.status === 0);
      await mod.reviewQueueSettled();
      assert.equal(gets(), 3, 'no counts: nothing to catch up with');
      assert.equal(xpStale, 1, 'only a 200 records a learning day');

      answer = {
        post: () => new Response('<!DOCTYPE html><title>Error</title>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
        get: () => new Response('<!DOCTYPE html><title>Error</title>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
      };
      await assert.rejects(mod.gradeAsSyncedLearner(U1, ARGS), (err) => err.status === 404 && err.errorType === undefined);
      await mod.reviewQueueSettled();
      assert.equal(gets(), 4, 'an older server answered the grade: the list is read again');
      assert.equal(mod.useReviewQueue().status, 'unsupported', 'and its 404 latches: the sidebar entry and the card go');
    } finally {
      delete globalThis.window;
      delete globalThis.__learner;
      delete globalThis.__caps;
      delete globalThis.__runEffects;
    }
  });
});

describe('reviewClient: the page\'s store', () => {
  let mod = null;
  before(async () => {
    mod = await fresh(await bundle(ENTRY, STUBBED));
  });

  it('is gated by the review capability: a Phase 5 API (achievements only) gets no review request, even from 「読み込み直す」', async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(QUEUE()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    globalThis.__learner = U1;
    globalThis.__caps = { lessonReset: true, achievements: true };
    try {
      await mod.reloadReviewQueue();
      assert.equal(mod.useReviewQueue().status, 'unsupported');
      assert.deepEqual(calls, []);
      globalThis.__caps = { lessonReset: true, achievements: true, review: true };
      await mod.reloadReviewQueue();
      assert.equal(mod.useReviewQueue().status, 'ready');
      assert.deepEqual(calls, ['/api/v2/user/review']);
    } finally {
      delete globalThis.__learner;
      delete globalThis.__caps;
    }
  });
});

describe('reviewModel: what the screens show', () => {
  let mod = null;
  before(async () => {
    mod = await fresh(await bundle(ENTRY, STUBBED));
  });

  const ready = (patch) => ({ status: 'ready', data: { ...mod.parseReviewQueue(QUEUE()), ...patch } });

  it('todayCardOf: the store states, then due / done / empty / none_today from the counts', () => {
    for (const status of ['idle', 'loading']) assert.equal(mod.todayCardOf({ status, data: null }), 'loading');
    for (const status of ['no_account', 'unsupported', 'unavailable']) assert.equal(mod.todayCardOf({ status, data: null }), status);
    assert.equal(mod.todayCardOf(ready({ remainingToday: 3 })), 'due');
    assert.equal(mod.todayCardOf(ready({ remainingToday: 0, doneToday: 10, carriedOver: 2 })), 'done');
    assert.equal(mod.todayCardOf(ready({ remainingToday: 0, doneToday: 0, inQueue: 0 })), 'empty');
    assert.equal(mod.todayCardOf(ready({ remainingToday: 0, doneToday: 0, inQueue: 7 })), 'none_today');
  });

  it('reviewMinutes: 10 cards are about 3 minutes (R2); none is 0', () => {
    assert.deepEqual([0, 1, 7, 10].map(mod.reviewMinutes), [0, 1, 2, 3]);
  });

  it('formatDueDay: the server\'s day as a calendar date, the same in any device time zone', () => {
    const before = process.env.TZ;
    try {
      for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        assert.equal(mod.formatDueDay('2026-10-28', 'jp'), '10月28日（水）', tz);
        assert.equal(mod.formatDueDay('2026-10-28', 'en'), 'Wed, Oct 28', tz);
      }
      process.env.TZ = 'America/Los_Angeles';
      assert.equal(new Date(Date.UTC(2026, 9, 28)).getDate(), 27, 'the zone took effect (a local-date formatter would say the 27th)');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
    assert.equal(mod.formatDueDay('soon', 'jp'), 'soon');
  });

  it('gradeBlockOf: the reset control\'s rules, for the session\'s learner', () => {
    const VIEW = (patch = {}) => ({ state: 'saved', reason: null, online: true, ...patch });
    const ON = { status: 'on', userId: U1 };
    const cases = [
      [ON, VIEW(), U1, null],
      [{ status: 'on', userId: U1.toUpperCase() }, VIEW(), U1, null],
      [{ status: 'hydrating', userId: U1 }, VIEW(), U1, null],
      [ON, VIEW({ online: false }), U1, 'offline'],
      [ON, VIEW({ state: 'offline' }), U1, 'offline'],
      [{ status: 'offline', userId: U1 }, VIEW(), U1, 'offline'],
      [ON, VIEW(), U2, 'later'],
      [{ status: 'on', userId: null }, VIEW(), U1, 'later'],
      [{ status: 'hydrating', userId: U1 }, VIEW({ state: 'loading' }), U1, 'loading'],
      [{ status: 'hydrating', userId: U1 }, VIEW({ state: 'local' }), U1, 'loading'],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'network' }), U1, 'offline'],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'server' }), U1, 'offline'],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'auth' }), U1, 'auth'],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'account' }), U1, 'later'],
      [{ status: 'stopped', userId: U1 }, VIEW({ state: 'stopped', reason: 'storage' }), U1, 'later'],
      [{ status: 'needs_choice', userId: U1 }, VIEW(), U1, 'later'],
    ];
    for (const [sync, view, learner, want] of cases) {
      assert.equal(mod.gradeBlockOf({ sync, view, sessionLearnerId: learner }), want, JSON.stringify([sync, view, learner]));
    }
  });

  const queue = (patch, cards) => mod.parseReviewQueue(QUEUE(U1, patch, cards));
  const run = (state, ...actions) => actions.reduce((s, a) => mod.sessionReducer(s, a), state);
  const err = (status, errorType, extra = {}) => Object.assign(new Error('x'), { status, errorType, ...extra });

  it('a session: the answer before the buttons; a grade advances and counts; the counter after a reload with 3 done shows 4 / 10', () => {
    let s = mod.startSession(queue({ doneToday: 3 }, Array.from({ length: 7 }, (_, i) => CARD(i + 1))));
    assert.deepEqual(mod.counterOf(s), { k: 4, total: 10 });
    assert.equal(run(s, { type: 'gradeStart', rating: 'good' }).busy, null, 'no grade before the answer was seen');
    s = run(s, { type: 'flip' }, { type: 'flip' });
    assert.deepEqual([s.flipped, s.revealed], [false, true], 'flipped back: the buttons stay');
    s = run(s, { type: 'gradeStart', rating: 'good' });
    assert.equal(s.busy, 'good');
    assert.equal(run(s, { type: 'gradeStart', rating: 'again' }).busy, 'good', 'one request at a time');
    s = run(s, mod.gradeSuccessAction({ learnerId: U1.toUpperCase(), summary: SUMMARY({ doneToday: 4 }) }, 'good', U1));
    assert.deepEqual([s.index, s.busy, s.revealed, s.line.kind, s.summary.doneToday], [1, null, false, 'recorded', 4]);
    assert.deepEqual(mod.counterOf(s), { k: 5, total: 10 });
  });

  it('refusals that move on without counting: not_due (today / later), not_in_queue, not_found; the last card ends the session', () => {
    const s0 = run(mod.startSession(queue({}, [CARD(1), CARD(2), CARD(3), CARD(4)])), { type: 'flip' }, { type: 'gradeStart', rating: 'good' });
    const today = run(s0, mod.gradeFailureAction(err(409, 'not_due', { learnerId: U1, reviewedToday: true, summary: SUMMARY({ doneToday: 1 }) }), 'good', U1));
    assert.deepEqual([today.index, today.line.kind, today.summary.doneToday, today.end], [1, 'alreadyToday', 1, null]);
    const later = run(s0, mod.gradeFailureAction(err(409, 'not_due', { learnerId: U1, reviewedToday: false }), 'good', U1));
    assert.deepEqual([later.index, later.line.kind], [1, 'notYet']);
    assert.equal(run(s0, mod.gradeFailureAction(err(409, 'not_in_queue', { learnerId: U1 }), 'good', U1)).line.kind, 'gone');
    assert.equal(run(s0, mod.gradeFailureAction(err(404, 'not_found'), 'good', U1)).line.kind, 'gone');
    const last = run(mod.startSession(queue({}, [CARD(1)])), { type: 'flip' }, { type: 'gradeStart', rating: 'again' }, { type: 'graded', rating: 'again', summary: SUMMARY({ doneToday: 1, remainingToday: 0 }) });
    assert.equal(last.end, 'done');
    assert.equal(mod.currentCard(last), null);
  });

  it('review_limit ends the session with the counts; a network failure, 429 and 401 stay on the card and name the button', () => {
    const s0 = run(mod.startSession(queue({}, [CARD(1), CARD(2)])), { type: 'flip' }, { type: 'gradeStart', rating: 'good' });
    const limit = run(s0, mod.gradeFailureAction(err(409, 'review_limit', { learnerId: U1, summary: SUMMARY({ doneToday: 10, remainingToday: 0, carriedOver: 2 }) }), 'good', U1));
    assert.deepEqual([limit.end, limit.summary.carriedOver], ['limit', 2]);
    for (const [e, kind] of [[err(0, 'network'), 'gradeFailed'], [err(503, 'review_unavailable'), 'gradeFailed'], [err(500, 'review_failed'), 'gradeFailed'], [err(429, 'rate_limited'), 'rateLimited'], [err(401, 'sign_in_required'), 'auth']]) {
      const s = run(s0, mod.gradeFailureAction(e, 'good', U1));
      assert.deepEqual([s.index, s.busy, s.end, s.revealed, s.line.kind], [0, null, null, true, kind], e.errorType);
      if (kind === 'gradeFailed') assert.equal(s.line.button, 'good');
    }
  });

  it('an HTML 404 (no error_type) on a grade is an older server: the session ends (unsupported), not "press once more"', () => {
    const s0 = run(mod.startSession(queue({}, [CARD(1), CARD(2)])), { type: 'flip' }, { type: 'gradeStart', rating: 'good' });
    assert.deepEqual(mod.gradeFailureAction(err(404, undefined), 'good', U1), { type: 'unsupported' });
    const s = run(s0, mod.gradeFailureAction(err(404, undefined), 'good', U1));
    assert.deepEqual([s.end, s.busy, mod.currentCard(s)], ['unsupported', null, null]);
    assert.equal(run(s0, mod.gradeFailureAction(err(404, 'not_found'), 'good', U1)).line.kind, 'gone', 'a card refusal is still a skip');
  });

  it('sessionSyncAction: another learner or a sign-out ends a running session (and says which); a settled list starts one; the same learner\'s list never restarts it; nothing before the read settled', () => {
    const list = (learner = U1, patch = {}) => mod.parseReviewQueue(QUEUE(learner, patch));
    const ready = (data) => ({ status: 'ready', learnerId: data.learnerId, data });
    const running = mod.startSession(list());
    // (a) the store's learner changed under a running session
    assert.deepEqual(mod.sessionSyncAction({ session: running, settled: true, store: ready(list(U2)) }), { type: 'switched', why: 'other' });
    assert.deepEqual(mod.sessionSyncAction({ session: running, settled: true, store: { status: 'loading', learnerId: U2, data: null } }), { type: 'switched', why: 'other' });
    assert.deepEqual(mod.sessionSyncAction({ session: running, settled: true, store: { status: 'no_account', learnerId: null, data: null } }), { type: 'switched', why: 'signedOut' }, 'signed out, expired or another tab\'s logout');
    assert.deepEqual(mod.sessionSyncAction({ session: running, settled: true, store: { status: 'unsupported', learnerId: U1, data: null } }), { type: 'unsupported' }, 'the server stopped offering reviews');
    // (b) a settled list for another learner (or the first list of the visit) starts a session
    const b = list(U2);
    assert.deepEqual(mod.sessionSyncAction({ session: null, settled: true, store: ready(b) }), { type: 'start', queue: b });
    const switched = mod.sessionReducer(running, { type: 'switched' });
    assert.deepEqual(mod.sessionSyncAction({ session: switched, settled: true, store: ready(b) }), { type: 'start', queue: b });
    // (c) the same learner's list does not restart a session (running or ended)
    assert.equal(mod.sessionSyncAction({ session: running, settled: true, store: ready(list()) }), null);
    assert.equal(mod.sessionSyncAction({ session: { ...running, end: 'done' }, settled: true, store: ready(list()) }), null);
    assert.equal(mod.sessionSyncAction({ session: switched, settled: true, store: ready(list()) }), null, 'after a switch back: 「復習する」, not by itself');
    // (d) nothing starts before the visit's read settled, or without cards today
    assert.equal(mod.sessionSyncAction({ session: null, settled: false, store: ready(list()) }), null);
    assert.equal(mod.sessionSyncAction({ session: null, settled: true, store: ready(list(U1, { remainingToday: 0 })) }), null);
    assert.equal(mod.sessionSyncAction({ session: null, settled: true, store: { status: 'unavailable', learnerId: U1, data: null } }), null);
    // 「復習する」 after an end: never the list held when it was pressed, a newer read
    const held = list();
    assert.equal(mod.sessionSyncAction({ session: null, settled: true, store: ready(held), staleList: held }), null);
    const newer = list();
    assert.deepEqual(mod.sessionSyncAction({ session: null, settled: true, store: ready(newer), staleList: held }), { type: 'start', queue: newer });
    // An ended session takes no switch; 'clear' drops it
    assert.equal(mod.sessionSyncAction({ session: switched, settled: true, store: { status: 'no_account', learnerId: null, data: null } }), null);
    assert.equal(mod.sessionReducer({ ...running, end: 'done' }, { type: 'clear' }), null);
  });

  it('another learner ends the session: session_changed, a refusal or a 200 that names another learner', () => {
    const s0 = run(mod.startSession(queue({}, [CARD(1), CARD(2)])), { type: 'flip' }, { type: 'gradeStart', rating: 'good' });
    assert.equal(run(s0, mod.gradeFailureAction(err(401, 'session_changed'), 'good', U1)).end, 'switched');
    assert.equal(run(s0, mod.gradeFailureAction(err(409, 'not_in_queue', { learnerId: U2 }), 'good', U1)).end, 'switched');
    assert.equal(run(s0, mod.gradeSuccessAction({ learnerId: U2, summary: SUMMARY() }, 'good', U1)).end, 'switched');
    const ended = run(s0, { type: 'switched' });
    assert.equal(run(ended, { type: 'flip' }), ended, 'an ended session takes no more actions');
    assert.equal(mod.startSession(queue({}, [])).end, 'done', 'an empty list has nothing to show');
  });
});
