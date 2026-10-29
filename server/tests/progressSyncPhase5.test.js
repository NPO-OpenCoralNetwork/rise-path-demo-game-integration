// Lesson progress sync, Phase 5 (components/lesson/progressSync.ts; design p5 §2.3–§2.5, §4.1,
// §4.4): the save view (saveViewOf and the core's getView), the 503 retry with capabilities,
// networkChanged / retryNow / storageChanged, the logout split (prepareSignOut, signOut that waits
// for a running load), lesson generations (stamps, keepsLocal, lessonMark, per-response
// generations) and the one-lesson reset. Fakes: helpers/progressSyncFakes.js (with `phase5` the
// fake server keeps generations like tools/core/lessonProgress.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STALL_AFTER_FAILURES,
  SYNC_ACCOUNT_KEY,
  SYNC_TIMING,
  createProgressSync,
  pendingKey,
  saveViewOf,
} from '../../components/lesson/progressSync.ts';
import { LAST_LESSON_KEY, lessonGenOf, progressKey } from '../../components/lesson/progressStore.ts';
import { parseProgress } from '../../shared/lesson/progress.js';
import { mergeProgress, sanitizeProgress } from '../../shared/lesson/progressMerge.js';
import {
  COURSE,
  account,
  fakeApi,
  getLocal,
  iso,
  isSyncable,
  marker,
  memoryStorage,
  putLocal,
  setAccount,
  settle,
  setup,
  START,
  twoTabs,
} from './helpers/progressSyncFakes.js';

const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const E1 = '11111111-1111-4111-8111-111111111111';
const X1 = '33333333-3333-4333-8333-333333333333';

const record = (patch = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: iso(-60), ...patch });
const answer = (attempts, correct, chosen) => ({ attempts, correct, chosen, firstTry: correct && attempts === 1 });
const stamped = (progress, lessonGen) => ({ ...progress, lessonGen });
const genOf = (storage, lessonId) => lessonGenOf(storage.getItem(progressKey(COURSE, lessonId)));
const fail = (status, errorType) => ({ error: Object.assign(new Error(`HTTP ${status}`), { status, ...(errorType ? { errorType } : {}) }) });

/** A learner already synced on this browser, against a Phase 5 server (capabilities, generations). */
function p5(options = {}) {
  const storage = options.storage ?? memoryStorage();
  if (!storage.getItem(SYNC_ACCOUNT_KEY)) setAccount(storage, U1, options.epoch ?? null);
  return setup({ phase5: true, ...options, storage });
}

/** Signs in and lets the hydrate (and its upload) finish. */
async function on(t) {
  t.sync.signIn(U1);
  await t.clock.advance(1_000);
  assert.equal(t.sync.getState().status, 'on');
}

/** A local write of the reader, as progressStore.writeProgress + PROGRESS_EVENT would do it. */
function write(t, lessonId, progress) {
  putLocal(t.storage, lessonId, progress);
  t.sync.noteLocalWrite(COURSE, lessonId);
}

const VIEW = {
  status: 'on', userId: U1, apiEnabled: true, hydrateMode: 'load', getFailure: null, stopReason: null,
  putFailure: null, pending: 0, failures: 0, busy: false, savedAt: null, online: true,
};

describe('Phase 5 save view: saveViewOf (first match wins)', () => {
  const cases = [
    ['off', { status: 'off', userId: null, pending: 3 }, 'local', null],
    ['needs_choice', { status: 'needs_choice' }, 'local', null],
    ['no API (not a network failure)', { status: 'offline', apiEnabled: false, getFailure: { status: 0 } }, 'local', null],
    ['stopped: its reason', { status: 'stopped', stopReason: 'storage' }, 'stopped', 'storage'],
    ['stopped without a reason', { status: 'stopped' }, 'stopped', 'server'],
    ['offline after a 401 GET: sign in again', { status: 'offline', getFailure: { status: 401 } }, 'stopped', 'auth'],
    ['offline after another learner\'s session', { status: 'offline', getFailure: { status: 401, errorType: 'session_changed' } }, 'stopped', 'account'],
    ['offline after a 403 GET', { status: 'offline', getFailure: { status: 403 } }, 'stopped', 'server'],
    ['offline after a network failure', { status: 'offline', getFailure: { status: 0 } }, 'offline', null],
    ['offline after 429', { status: 'offline', getFailure: { status: 429 } }, 'offline', null],
    ['offline after 503', { status: 'offline', getFailure: { status: 503 } }, 'offline', null],
    ['offline with no recorded failure', { status: 'offline' }, 'offline', null],
    ['on, pending, the browser offline', { pending: 1, online: false }, 'offline', null],
    ['on, nothing pending, the browser offline', { online: false }, 'saved', null],
    ['a load', { status: 'hydrating', hydrateMode: 'load' }, 'loading', null],
    ['a retry', { status: 'hydrating', hydrateMode: 'retry' }, 'loading', null],
    ['a background refresh keeps the look', { status: 'hydrating', hydrateMode: 'refresh' }, 'saved', null],
    ['a background refresh with pending', { status: 'hydrating', hydrateMode: 'refresh', pending: 2 }, 'saving', null],
    [`${STALL_AFTER_FAILURES} failures with pending (network)`, { pending: 1, failures: STALL_AFTER_FAILURES, putFailure: 'network' }, 'stopped', 'network'],
    [`${STALL_AFTER_FAILURES} failures with pending (server)`, { pending: 1, failures: STALL_AFTER_FAILURES, putFailure: 'server' }, 'stopped', 'server'],
    ['two failures with pending', { pending: 1, failures: STALL_AFTER_FAILURES - 1, putFailure: 'server' }, 'saving', null],
    ['failures but nothing pending', { failures: 5, putFailure: 'server' }, 'saved', null],
    ['pending', { pending: 1 }, 'saving', null],
    ['nothing pending', {}, 'saved', null],
  ];
  for (const [name, patch, state, reason] of cases) {
    it(name, () => {
      const view = saveViewOf({ ...VIEW, ...patch });
      assert.equal(view.state, state);
      assert.equal(view.reason, reason);
      assert.ok(Object.isFrozen(view));
    });
  }

  it('no learner: pending is 0; the other fields pass through', () => {
    assert.equal(saveViewOf({ ...VIEW, status: 'off', userId: null, pending: 4 }).pending, 0);
    const view = saveViewOf({ ...VIEW, pending: 2, failures: 1, busy: true, savedAt: 5, online: true });
    assert.deepEqual({ ...view }, { state: 'saving', reason: null, userId: U1, pending: 2, failures: 1, busy: true, savedAt: 5, online: true });
  });
});

describe('Phase 5 save view: the core', () => {
  it('a page load: loading, then saved; a refresh keeps "saved"; no API is "local"', async () => {
    const t = p5();
    const seen = [];
    t.sync.subscribeView(() => seen.push(t.sync.getView().state));
    t.sync.signIn(U1);
    assert.equal(t.sync.getView().state, 'loading');
    assert.equal(t.sync.getView().busy, true);
    await t.clock.advance(1_000);
    assert.equal(t.sync.getView().state, 'saved');
    assert.equal(t.sync.getView().savedAt, START + 0);
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    const release = t.api.hold('get');
    t.sync.refresh();
    assert.equal(t.sync.getState().status, 'hydrating');
    assert.equal(t.sync.getView().state, 'saved', 'a background refresh is not "loading"');
    assert.equal(t.sync.getView().busy, false);
    release();
    await t.clock.advance(1_000);
    assert.deepEqual(seen.filter((s, i) => s !== seen[i - 1]), ['loading', 'saved']);

    const local = p5({ apiEnabled: () => false });
    local.sync.signIn(U1);
    await local.clock.advance(1_000);
    assert.equal(local.sync.getState().status, 'offline');
    assert.equal(local.sync.getView().state, 'local');
  });

  it('a write is "saving" until the PUT confirmed it, then "saved"', async () => {
    const t = p5();
    await on(t);
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    assert.equal(t.sync.getView().state, 'saving');
    assert.equal(t.sync.getView().pending, 1);
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.sync.getView().state, 'saved');
    assert.equal(t.sync.getView().pending, 0);
  });

  it('G27: with capabilities, one 503 is "saving" with a retry scheduled; three in a row are "stopped" (server); then a success', async () => {
    const t = p5();
    await on(t);
    for (let i = 0; i < 3; i += 1) t.api.script('put', fail(503, 'lesson_progress_unavailable'));
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.sync.getState().status, 'on', 'a passing outage, not a stop');
    assert.equal(t.sync.getView().state, 'saving');
    assert.equal(t.sync.getView().failures, 1);
    await t.clock.advance(20_000);
    assert.equal(t.api.puts().length, 2, 'retried with the backoff');
    assert.equal(t.sync.getView().state, 'saving');
    await t.clock.advance(40_000);
    assert.equal(t.api.puts().length, 3);
    assert.equal(t.sync.getView().state, 'stopped');
    assert.equal(t.sync.getView().reason, 'server');
    assert.equal(t.sync.getView().failures, 3);
    await t.clock.advance(120_000);
    assert.equal(t.api.puts().length, 4);
    assert.equal(t.sync.getView().state, 'saved');
    assert.equal(t.sync.getView().failures, 0);
    assert.ok(t.api.server.rows.get(`${COURSE}:l1`));
  });

  it('three 503s in a row are "stopped" whatever comes meanwhile: a refresh racing the first upload, focus refreshes, session events, an offline blip, storage events (in-app S1)', async () => {
    const t = p5();
    await on(t);
    // As in the app's S1: an upload failed offline and went through once the browser was back online.
    t.sync.networkChanged(false);
    t.api.server.offline = true;
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.sync.getView().failures, 1);
    t.api.server.offline = false;
    t.sync.networkChanged(true);
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    assert.deepEqual([t.sync.getView().state, t.sync.getView().failures], ['saved', 0]);

    // Every second: a focus or visibility refresh, a session event (TOKEN_REFRESHED, SIGNED_IN on
    // refocus), an 'online' event while online, a storage event. None of them may reset the count.
    const poke = () => {
      t.sync.refresh();
      t.sync.signIn(U1);
      t.sync.networkChanged(true);
      t.sync.storageChanged();
    };
    /** Three 503s from a write (seen block `block`): "saving", "saving", "stopped"; then the backoff's upload saves. */
    async function threeFailures(block, { race }) {
      for (let i = 0; i < 3; i += 1) t.api.script('put', fail(503, 'progress_unavailable'));
      let release = null;
      if (race) {
        // A background refresh is on its way (the tab came back) when the learner answers.
        release = t.api.hold('get');
        t.sync.refresh();
        assert.equal(t.sync.getState().status, 'hydrating');
      }
      write(t, 'l1', record({ seen: ['b1', block], updatedAt: new Date(t.clock.now()).toISOString() }));
      const gets = t.api.gets().length;
      const puts = t.api.puts().length;
      release?.();
      const counts = [];
      let blip = false;
      for (let i = 0; i < 300 && t.api.puts().length - puts < 3; i += 1) {
        const before = t.api.puts().length;
        poke();
        if (!blip && t.api.puts().length - puts === 1) {
          // An offline blip between the first and the second 503: "offline", then back to "saving".
          blip = true;
          t.sync.networkChanged(false);
          assert.equal(t.sync.getView().state, 'offline');
          t.sync.networkChanged(true);
        }
        await t.clock.advance(1_000);
        if (t.api.puts().length > before) counts.push([t.sync.getView().failures, t.sync.getView().state]);
      }
      assert.ok(blip);
      assert.equal(t.api.puts().length - puts, 3, 'three uploads, each answered 503');
      assert.deepEqual(counts, [[1, 'saving'], [2, 'saving'], [3, 'stopped']]);
      assert.deepEqual([t.sync.getView().state, t.sync.getView().reason, t.sync.getView().pending], ['stopped', 'server', 1]);
      assert.equal(t.api.gets().length, gets, 'no GET meanwhile: nothing started the load again');
      // It stays "stopped" while the events go on, until the backoff's next upload succeeds.
      for (let i = 0; i < 10; i += 1) {
        poke();
        await t.clock.advance(1_000);
        assert.equal(t.sync.getView().state, 'stopped');
      }
      await t.clock.advance(SYNC_TIMING.maxBackoffMs);
      assert.deepEqual([t.sync.getView().state, t.sync.getView().failures], ['saved', 0]);
      assert.ok(t.api.server.rows.get(`${COURSE}:l1`).progress.seen.includes(block));
    }
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    await threeFailures('b2', { race: true });
    // Again with the last GET long ago: a focus refresh would be due if the backoff let it run.
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    await threeFailures('b3', { race: false });
  });

  it('network failures three times: "stopped" (network)', async () => {
    const t = p5();
    await on(t);
    for (let i = 0; i < 3; i += 1) t.api.script('put', fail(0, 'network'));
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs + 60_000);
    assert.equal(t.api.puts().length, 3);
    assert.deepEqual([t.sync.getView().state, t.sync.getView().reason], ['stopped', 'network']);
  });

  it('a 503 from a server without capabilities stops at once (server); 401 is "auth"; another learner\'s session is "account"', async () => {
    const old = setup({ storage: memoryStorage() });
    setAccount(old.storage, U1, null);
    old.sync.signIn(U1);
    await old.clock.advance(1_000);
    old.api.script('put', fail(503));
    write(old, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await old.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(old.sync.getState().status, 'stopped');
    assert.deepEqual([old.sync.getView().state, old.sync.getView().reason], ['stopped', 'server']);

    for (const [errorType, reason] of [['invalid_token', 'auth'], ['session_changed', 'account']]) {
      const t = p5();
      await on(t);
      t.api.script('put', fail(401, errorType));
      write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
      await t.clock.advance(SYNC_TIMING.flushDelayMs);
      assert.equal(t.sync.getState().status, 'stopped');
      assert.deepEqual([t.sync.getView().state, t.sync.getView().reason], ['stopped', reason], errorType);
    }
  });

  it('a GET that fails with 401 shows "stopped" (auth); with the network, "offline"', async () => {
    const auth = p5();
    auth.api.script('get', fail(401, 'invalid_token'));
    auth.sync.signIn(U1);
    await auth.clock.advance(1_000);
    assert.deepEqual([auth.sync.getState().status, auth.sync.getView().state, auth.sync.getView().reason], ['offline', 'stopped', 'auth']);

    const net = p5();
    for (let i = 0; i < 4; i += 1) net.api.script('get', fail(0, 'network'));
    net.sync.signIn(U1);
    await net.clock.advance(60_000);
    assert.deepEqual([net.sync.getView().state, net.sync.getView().reason], ['offline', null]);
  });

  it('another tab\'s logout while this tab uploads: "stopped" (account); storage that refuses the account: "stopped" (storage)', async () => {
    const t = p5();
    await on(t);
    const release = t.api.hold('put');
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    t.storage.setItem(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: U1, epoch: null, loggedOut: true }));
    release();
    await t.clock.advance(1_000);
    assert.deepEqual([t.sync.getView().state, t.sync.getView().reason], ['stopped', 'account']);

    const storage = memoryStorage();
    const refuse = { ...storage, get length() { return storage.length; }, setItem(key, value) {
      if (key === SYNC_ACCOUNT_KEY && JSON.parse(value).epoch !== '?') throw new Error('QuotaExceededError');
      storage.setItem(key, value);
    } };
    const s = setup({ storage: refuse, phase5: true });
    s.sync.signIn(U1);
    await s.clock.advance(1_000);
    assert.deepEqual([s.sync.getView().state, s.sync.getView().reason], ['stopped', 'storage']);
  });

  it('pending counts only this learner\'s syncable records that exist; storageChanged recounts another tab\'s markers', async () => {
    const t = p5();
    await on(t);
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.storage.setItem(pendingKey(COURSE, 'l1'), iso(1));
    t.storage.setItem(pendingKey(COURSE, 'l2'), iso(1)); // no record
    putLocal(t.storage, 'x1', record({ seen: ['b1'] }));
    t.storage.setItem(pendingKey(COURSE, 'x1'), iso(-60)); // not syncable
    assert.equal(t.sync.getView().pending, 0, 'another tab\'s markers are not seen until told');
    t.sync.storageChanged();
    assert.equal(t.sync.getView().pending, 1);
    t.storage.setItem(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: U2, epoch: null }));
    t.sync.storageChanged();
    assert.equal(t.sync.getView().pending, 0, 'another learner\'s browser now');
  });
});

describe('Phase 5 XP refresh: the server took this tab\'s records (saved)', () => {
  it('an ordinary save that changes nothing here emits no server progress event, but tells the XP store once', async () => {
    const row = { courseSlug: COURSE, lessonId: 'l1', progress: record({ seen: ['a'], updatedAt: iso(-5), summary: { pct: 10, state: 'in_progress' } }), pct: 10, state: 'in_progress', updatedAt: iso(-5) };
    const t = p5({ rows: [row] });
    await on(t);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: null, resetAt: null });
    t.events.progress.length = 0;
    // The reader finishes the lesson: every block seen, summary 'read' (useLessonProgress).
    write(t, 'l1', stamped(record({ seen: ['a', 'b'], updatedAt: iso(1), summary: { pct: 100, state: 'read' } }), { epoch: null, resetAt: null }));
    // The server merges like tools/core/lessonProgress.js and counts the same summary.
    t.api.script('put', { respond: (body) => {
      const sent = body.records[0];
      const merged = mergeProgress(parseProgress(row.progress), sanitizeProgress(sent.progress, { now: t.clock.now() }));
      return { epoch: null, rejected: [], records: [{ courseSlug: COURSE, lessonId: 'l1', progress: merged, pct: 100, state: 'read', updatedAt: merged.updatedAt, lessonEpoch: null, lessonResetAt: null }] };
    } });
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs + SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(marker(t.storage, 'l1'), null, 'saved');
    assert.deepEqual(t.events.progress, [], 'nothing changed here: no server progress event');
    assert.equal(t.events.saved, 1, 'the XP store hears of the save (its hook may have awarded done 40)');
  });

  it('no saved signal for a PUT that took no record (refused, failed)', async () => {
    const t = p5();
    await on(t);
    write(t, 'l1', stamped(record({ seen: ['a'], updatedAt: iso(1) }), { epoch: null, resetAt: null }));
    t.api.script('put', fail(500));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.events.saved, 0);
    write(t, 'l-new', record({ seen: ['a'], updatedAt: iso(2) }));
    t.storage.removeItem(pendingKey(COURSE, 'l1'));
    await t.clock.advance(SYNC_TIMING.maxBackoffMs + SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().at(-1).body.records[0].lessonId, 'l-new');
    assert.equal(t.events.saved, 0, 'unknown_lesson: nothing stored');
  });
});

describe('Phase 5 recovery: networkChanged and retryNow', () => {
  /** A page whose load failed on the network (status offline), with `random` fixed. */
  async function offlinePage(random) {
    const t = p5({ random: () => random });
    for (let i = 0; i < 4; i += 1) t.api.script('get', fail(0, 'network'));
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.sync.getState().status, 'offline');
    assert.equal(t.api.gets().length, 4);
    return t;
  }

  it('back online: exactly one GET after 1–5 s of jitter (random 0 → 1 s, random 1 → 5 s), then saving goes on', async () => {
    for (const [random, delay] of [[0, 1_000], [1, 5_000]]) {
      const t = await offlinePage(random);
      putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
      t.sync.noteLocalWrite(COURSE, 'l1');
      t.sync.networkChanged(false);
      assert.equal(t.sync.getView().state, 'offline');
      t.sync.networkChanged(true);
      await t.clock.advance(delay - 1);
      assert.equal(t.api.gets().length, 4, `nothing before ${delay} ms`);
      await t.clock.advance(1);
      assert.equal(t.api.gets().length, 5, 'one GET');
      await t.clock.advance(1_000);
      assert.equal(t.sync.getState().status, 'on');
      assert.equal(t.api.gets().length, 5, 'exactly one');
      assert.equal(t.api.puts().length, 1, 'the hydrate uploads what is pending');
      assert.equal(t.sync.getView().state, 'saved');
    }
  });

  it('at most once per 30 s, whatever the browser reports', async () => {
    const t = await offlinePage(0);
    for (let i = 0; i < 3; i += 1) {
      t.sync.networkChanged(false);
      t.sync.networkChanged(true);
    }
    t.api.script('get', fail(0, 'network'));
    await t.clock.advance(29_000);
    assert.equal(t.api.gets().length, 5);
    t.sync.networkChanged(false);
    t.sync.networkChanged(true);
    await t.clock.advance(1_000);
    assert.equal(t.api.gets().length, 5, 'still inside the 30 s');
    t.sync.networkChanged(false);
    t.sync.networkChanged(true);
    await t.clock.advance(5_000);
    assert.equal(t.api.gets().length, 6);
  });

  it('uploads in backoff go early, but never before the last PUT + 20 s; "stopped" is not touched', async () => {
    const t = p5({ random: () => 1 });
    await on(t);
    t.api.script('put', fail(500));
    t.api.script('put', fail(500));
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    await t.clock.advance(20_000);
    assert.equal(t.api.puts().length, 2);
    const lastPut = t.api.puts().at(-1).at;
    // The backoff after two failures waits 40 s (random 1).
    t.sync.networkChanged(false);
    t.sync.networkChanged(true);
    await t.clock.advance(19_999 - (t.clock.now() - lastPut));
    assert.equal(t.api.puts().length, 2, 'not before lastPut + 20 s');
    await t.clock.advance(1);
    assert.equal(t.api.puts().length, 3);
    assert.equal(t.api.puts().at(-1).at - lastPut, 20_000);

    const stopped = p5();
    await on(stopped);
    stopped.api.script('put', fail(401, 'invalid_token'));
    write(stopped, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await stopped.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(stopped.sync.getState().status, 'stopped');
    const calls = stopped.api.calls.length;
    stopped.sync.networkChanged(false);
    stopped.sync.networkChanged(true);
    await stopped.clock.advance(60_000);
    assert.equal(stopped.api.calls.length, calls, 'a 401 is not a network problem');
  });

  it('retryNow with failing uploads: one PUT at once (no debounce) once the 20 s spacing allows it', async () => {
    const t = p5();
    await on(t);
    for (let i = 0; i < 3; i += 1) t.api.script('put', fail(500));
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs + 60_000);
    assert.equal(t.api.puts().length, 3);
    assert.equal(t.sync.getView().state, 'stopped');
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    t.sync.retryNow();
    await t.clock.advance(0);
    assert.equal(t.api.puts().length, 4, 'at once');
    assert.equal(t.sync.getView().state, 'saved');
  });

  it('retryNow says whether a request is on its way: a press just after the third failure waits for the 20 s spacing; a press after a quick failure is not throttled (the spacing holds); nothing to retry → false', async () => {
    const t = p5();
    await on(t);
    for (let i = 0; i < 5; i += 1) t.api.script('put', fail(503));
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    while (t.api.puts().length < 3) await t.clock.advance(100);
    assert.deepEqual([t.sync.getView().state, t.sync.getView().reason], ['stopped', 'server']);
    // The notice's button at once: scheduled, not sent (the in-app case: about 18 s of waiting).
    let lastPut = t.api.puts().at(-1).at;
    assert.equal(t.sync.retryNow(), true, 'a PUT is on its way');
    await t.clock.advance(lastPut + SYNC_TIMING.minPutIntervalMs - 1 - t.clock.now());
    assert.equal(t.api.puts().length, 3, 'not before lastPut + 20 s');
    await t.clock.advance(1);
    assert.equal(t.api.puts().length, 4);
    assert.equal(t.sync.getView().failures, 4);
    // The spacing has passed: a press sends at once; it fails at once; a press 1 s later still
    // schedules one (no 10 s throttle on uploads), again only at lastPut + 20 s.
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    assert.equal(t.sync.retryNow(), true);
    await t.clock.advance(0);
    assert.equal(t.api.puts().length, 5, 'at once');
    lastPut = t.api.puts().at(-1).at;
    await t.clock.advance(1_000);
    assert.equal(t.sync.retryNow(), true, 'not throttled');
    await t.clock.advance(lastPut + SYNC_TIMING.minPutIntervalMs - 1 - t.clock.now());
    assert.equal(t.api.puts().length, 5);
    await t.clock.advance(1);
    assert.equal(t.api.puts().length, 6);
    assert.equal(t.sync.getView().state, 'saved');
    assert.equal(t.sync.retryNow(), false, 'saved: nothing to retry');
    assert.equal(t.api.calls.length, t.api.gets().length + 6);
  });

  it('retryNow: one GET at once for a failed load, at most once per 10 s; a server stop gets one GET too', async () => {
    const t = await offlinePage(0);
    t.api.script('get', fail(0, 'network'));
    assert.equal(t.sync.retryNow(), true);
    await settle();
    assert.equal(t.api.gets().length, 5, 'no jitter');
    assert.equal(t.sync.retryNow(), false);
    await t.clock.advance(9_000);
    assert.equal(t.sync.retryNow(), false);
    await settle();
    assert.equal(t.api.gets().length, 5, 'throttled');
    await t.clock.advance(1_000);
    assert.equal(t.sync.retryNow(), true);
    await settle();
    assert.equal(t.api.gets().length, 6);

    const old = setup({ storage: memoryStorage() });
    setAccount(old.storage, U1, null);
    old.sync.signIn(U1);
    await old.clock.advance(1_000);
    old.api.script('put', fail(503));
    write(old, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await old.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.deepEqual([old.sync.getView().state, old.sync.getView().reason], ['stopped', 'server']);
    old.sync.retryNow();
    await old.clock.advance(1_000);
    assert.equal(old.api.gets().length, 2);
    assert.equal(old.api.puts().length, 2, 'the reload uploads again');
    assert.equal(old.sync.getView().state, 'saved');
  });
});

describe('Phase 5 logout: prepareSignOut and signOut', () => {
  it('prepareSignOut uploads, then counts what is still unsaved', async () => {
    const t = p5();
    await on(t);
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    assert.deepEqual(await t.sync.prepareSignOut(), { unsaved: 0 });
    assert.equal(t.api.puts().length, 1);

    const failing = p5();
    await on(failing);
    failing.api.script('put', fail(500));
    write(failing, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    write(failing, 'l2', record({ seen: ['c1'], updatedAt: iso(1) }));
    assert.deepEqual(await failing.sync.prepareSignOut(), { unsaved: 2 });
  });

  it('G11: a logout while the page load runs waits for it and its upload (prepareSignOut and signOut)', async () => {
    for (const via of ['prepareSignOut', 'signOut']) {
      const t = p5();
      putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
      t.storage.setItem(pendingKey(COURSE, 'l1'), iso(1));
      const release = t.api.hold('get');
      t.sync.signIn(U1);
      assert.equal(t.sync.getState().status, 'hydrating');
      const done = t.sync[via]();
      await t.clock.advance(1_000);
      release();
      await t.clock.advance(500);
      const result = await done;
      assert.equal(t.api.puts().length, 1, `${via}: the record was uploaded`);
      assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['b1']);
      if (via === 'prepareSignOut') assert.deepEqual(result, { unsaved: 0 });
    }
  });

  it('prepareSignOut: 0 while the adoption choice is open and without the API; nothing is sent', async () => {
    const choice = setup({ phase5: true });
    putLocal(choice.storage, 'l1', record({ seen: ['g1'] }));
    choice.sync.signIn(U1);
    assert.equal(choice.sync.getState().status, 'needs_choice');
    assert.deepEqual(await choice.sync.prepareSignOut(), { unsaved: 0 });

    const noApi = p5({ apiEnabled: () => false });
    noApi.sync.signIn(U1);
    await noApi.clock.advance(1_000);
    putLocal(noApi.storage, 'l1', record({ seen: ['b1'] }));
    noApi.sync.noteLocalWrite(COURSE, 'l1');
    assert.deepEqual(await noApi.sync.prepareSignOut(), { unsaved: 0 });
    assert.equal(noApi.api.calls.length + choice.api.calls.length, 0);
  });

  it('signOut right after prepareSignOut does not wait again; a reload in between makes it wait', async () => {
    const t = p5();
    await on(t);
    t.api.script('put', fail(500));
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    assert.deepEqual(await t.sync.prepareSignOut(), { unsaved: 1 });
    const puts = t.api.puts().length;
    await t.sync.signOut();
    assert.equal(t.api.puts().length, puts, 'no second upload attempt');
    assert.equal(marker(t.storage, 'l1'), iso(1), 'the unsaved record waits for the same learner');
    assert.equal(account(t.storage).loggedOut, true);

    // A failed load (offline): prepare loads once more (as the Phase 2 logout did); a session event
    // then reloads (a new generation), so the logout 14 s later waits again.
    const u = p5();
    for (let i = 0; i < 20; i += 1) u.api.script('get', fail(0, 'network'));
    u.sync.signIn(U1);
    await u.clock.advance(60_000);
    putLocal(u.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    u.sync.noteLocalWrite(COURSE, 'l1');
    const prepared = u.sync.prepareSignOut();
    await u.clock.advance(3_000);
    assert.deepEqual(await prepared, { unsaved: 1 });
    await u.clock.advance(10_000);
    assert.equal(u.sync.getState().status, 'offline');
    const before = u.api.gets().length;
    u.sync.signIn(U1); // TOKEN_REFRESHED: a stalled sync loads once more
    await u.clock.advance(1_000);
    assert.equal(u.api.gets().length, before + 1);
    const out = u.sync.signOut();
    await u.clock.advance(3_000);
    await out;
    assert.ok(u.api.gets().length > before + 1, 'the logout waited for one more try');
  });
});

const serverRow = (lessonId, progress, extra = {}) => ({ courseSlug: COURSE, lessonId, progress, pct: 40, state: 'in_progress', updatedAt: progress.updatedAt, ...extra });
const CAPS = { lessonReset: true, achievements: true, review: true };

describe('Phase 5 generations: what a device keeps after a lesson was started over', () => {
  it('G10: an unstamped record written after the reset (an old bundle) is refused and dropped for the server\'s', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['old'], updatedAt: iso(-10) }))] });
    await on(t);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: null, resetAt: null });
    const { gen } = t.api.resetOnServer(COURSE, 'l1');
    // An old bundle in another tab writes over it without a stamp (the old content and more).
    putLocal(t.storage, 'l1', record({ seen: ['old', 'more'], updatedAt: iso(5) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.puts()[0].body.records[0].lessonEpoch, null);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, [], 'never stored');
    assert.deepEqual(getLocal(t.storage, 'l1').seen, [], 'dropped for the server\'s emptied record');
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: gen.epoch, resetAt: gen.at });
    assert.equal(marker(t.storage, 'l1'), null);
    await t.clock.advance(120_000);
    assert.equal(t.api.puts().length, 1, 'not sent again');
  });

  it('G10: an unstamped write landing while a PUT of the same lesson is on its way is not stamped by its answer; refused and dropped next', async () => {
    const t = p5();
    const { gen } = t.api.resetOnServer(COURSE, 'l1', START - 60 * 60_000);
    // Work of this device after the reset, stamped with the current generation, waiting to upload.
    putLocal(t.storage, 'l1', stamped(record({ seen: ['new'], updatedAt: iso(-1) }), { epoch: gen.epoch, resetAt: gen.at }));
    t.storage.setItem(pendingKey(COURSE, 'l1'), iso(-1));
    const release = t.api.hold('put');
    await on(t);
    assert.equal(t.api.puts().length, 1, 'the PUT of l1 is on its way');
    assert.equal(t.api.puts()[0].body.records[0].lessonEpoch, gen.epoch);
    // An old-bundle tab (open since before the reset) writes its in-memory record: old content, no stamp.
    putLocal(t.storage, 'l1', record({ seen: ['old'], updatedAt: iso(0) }));
    t.storage.setItem(pendingKey(COURSE, 'l1'), iso(0));
    release();
    await t.clock.advance(1_000);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'unknown' }, 'the answer left the unstamped write unstamped');
    // The next upload (here started by a write of another lesson) offers it as it is: refused.
    write(t, 'l2', stamped(record({ seen: ['b1'], updatedAt: iso(1) }), { epoch: null, resetAt: null }));
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs + SYNC_TIMING.flushDelayMs);
    const puts = t.api.puts();
    assert.equal(puts.length, 2);
    assert.deepEqual(puts[1].body.records.map((r) => [r.lessonId, r.lessonEpoch]).sort(), [['l1', null], ['l2', null]]);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['new'], 'the pre-reset content never reached the server');
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l2`).progress.seen, ['b1']);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['new'], 'dropped for the server\'s record');
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: gen.epoch, resetAt: gen.at });
  });

  it('a lesson_reset without a stored record (a delete-all kept the generation): the record becomes an emptied one of that generation', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['old'], updatedAt: iso(-10) }))] });
    await on(t);
    const { gen } = t.api.resetOnServer(COURSE, 'l1');
    t.api.server.rows.clear(); // the learner deleted all progress afterwards; generations stay (019)
    t.events.progress.length = 0;
    putLocal(t.storage, 'l1', record({ seen: ['old', 'more'], updatedAt: iso(5) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.server.rows.size, 0, 'never stored');
    // Not just removed: an open reader hears of it and restarts instead of writing the old content again.
    assert.deepEqual(getLocal(t.storage, 'l1').seen, []);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: gen.epoch, resetAt: gen.at });
    assert.deepEqual(t.events.progress, [{ courseSlug: COURSE, lessonId: 'l1', source: 'server' }]);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('G21: a GET answered before the reset and delivered after another tab\'s emptied record keeps the emptied record', async () => {
    const t = twoTabs({ phase5: true, rows: [serverRow('l1', record({ seen: ['old'], updatedAt: iso(-10) }))] });
    setAccount(t.storage, U1, null);
    t.a.signIn(U1);
    t.b.signIn(U1);
    await t.clock.advance(SYNC_TIMING.refreshAfterMs + 1_000);
    // Tab B's background refresh: the server answered before the reset, the answer arrives after it.
    const before = { epoch: null, capabilities: CAPS, records: [{ ...serverRow('l1', record({ seen: ['old'], updatedAt: iso(-10) })), lessonEpoch: null, lessonResetAt: null }] };
    let release;
    t.api.script('get', { hold: new Promise((resolve) => { release = resolve; }), respond: () => JSON.parse(JSON.stringify(before)) });
    const gets = t.api.gets().length;
    t.b.refresh();
    assert.deepEqual(await t.a.resetLesson(COURSE, 'l1'), { ok: true });
    const tombstone = t.storage.getItem(progressKey(COURSE, 'l1'));
    assert.ok(account(t.storage).lessonMark, 'tab A moved the lesson mark');
    release();
    await t.clock.advance(1_000);
    assert.equal(t.api.gets().length, gets + 2, 'tab B asked again');
    assert.equal(t.storage.getItem(progressKey(COURSE, 'l1')), tombstone);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, []);
  });

  it('G21: a PUT answer after another tab moved the mark is dropped, and the state is loaded again', async () => {
    const t = twoTabs({ phase5: true, rows: [serverRow('l1', record({ seen: ['old'], updatedAt: iso(-10) }))] });
    setAccount(t.storage, U1, null);
    t.a.signIn(U1);
    t.b.signIn(U1);
    await t.clock.advance(1_000);
    // Tab B saves more of l1; the server took it before the reset, the answer arrives after it.
    let release;
    t.api.script('put', {
      hold: new Promise((resolve) => { release = resolve; }),
      respond: (body) => ({ epoch: null, rejected: [], records: body.records.map((r) => ({ ...serverRow(r.lessonId, r.progress), lessonEpoch: null, lessonResetAt: null })) }),
    });
    putLocal(t.storage, 'l1', stamped(record({ seen: ['old', 'b-more'], updatedAt: iso(1) }), { epoch: null, resetAt: null }));
    t.b.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(await t.a.resetLesson(COURSE, 'l1'), { ok: true });
    const gets = t.api.gets().length;
    release();
    await t.clock.advance(1_000);
    assert.equal(t.api.gets().length, gets + 1, 'tab B loaded the server state again');
    assert.deepEqual(getLocal(t.storage, 'l1').seen, [], 'the answer did not bring the old record back');
    assert.equal(genOf(t.storage, 'l1').epoch, t.api.server.resets.get(`${COURSE}:l1`).epoch);
  });

  it('G23: offline from page load on a lesson restarted earlier: the record born here is kept, stamped and uploaded', async () => {
    const t = p5();
    const { gen } = t.api.resetOnServer(COURSE, 'l1', START - 3_600_000);
    t.api.server.offline = true;
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.sync.getState().status, 'offline');
    write(t, 'l1', stamped(record({ seen: ['new'], updatedAt: iso(1) }), { bornAt: iso(1) }));
    t.api.server.offline = false;
    t.sync.networkChanged(false);
    t.sync.networkChanged(true);
    await t.clock.advance(6_000);
    assert.equal(t.sync.getState().status, 'on');
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.puts()[0].body.records[0].lessonEpoch, gen.epoch);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['new']);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: gen.epoch, resetAt: gen.at });
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('G23: 「このままログアウト」 with a record born after the reset, then the same learner signs in: saved', async () => {
    const t = p5();
    const { gen } = t.api.resetOnServer(COURSE, 'l1', START - 3_600_000);
    t.api.server.offline = true;
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    write(t, 'l1', stamped(record({ seen: ['new'], updatedAt: iso(1) }), { bornAt: iso(1) }));
    const prepared = t.sync.prepareSignOut();
    await t.clock.advance(3_000);
    assert.deepEqual(await prepared, { unsaved: 1 });
    const out = t.sync.signOut();
    await t.clock.advance(5_000);
    await out;
    assert.equal(account(t.storage).loggedOut, true);
    assert.equal(marker(t.storage, 'l1'), iso(1));
    // The next page load, with the network back: the same learner.
    t.api.server.offline = false;
    const next = createProgressSync({ storage: t.storage, api: t.api, isSyncable, now: t.clock.now, timers: t.clock.timers, random: () => 0.5 });
    next.signIn(U1);
    await t.clock.advance(1_000);
    assert.equal(next.getState().status, 'on');
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['new']);
    assert.equal(t.api.puts().at(-1).body.records[0].lessonEpoch, gen.epoch);
  });

  it('G23: a record born before the reset (by this device\'s clock) is dropped', async () => {
    const t = p5();
    const { gen } = t.api.resetOnServer(COURSE, 'l1', START + 2 * 60_000);
    t.api.server.offline = true;
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    write(t, 'l1', stamped(record({ seen: ['before'], updatedAt: iso(1) }), { bornAt: iso(1) }));
    t.api.server.offline = false;
    t.sync.networkChanged(false);
    t.sync.networkChanged(true);
    await t.clock.advance(6_000);
    assert.equal(t.api.puts().length, 0);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, []);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, []);
    assert.equal(genOf(t.storage, 'l1').epoch, gen.epoch);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('G23: PUT lesson_reset of a record born after the reset: stamped and sent again, then saved', async () => {
    const t = p5();
    await on(t);
    write(t, 'l1', stamped(record({ seen: ['new'], updatedAt: iso(2) }), { bornAt: iso(2) }));
    // Another device started l1 over before this record was born.
    const { gen } = t.api.resetOnServer(COURSE, 'l1', START + 60_000);
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.puts()[0].body.records[0].lessonEpoch, null);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: gen.epoch, resetAt: gen.at });
    assert.ok(marker(t.storage, 'l1'));
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    assert.equal(t.api.puts().length, 2);
    assert.equal(t.api.puts()[1].body.records[0].lessonEpoch, gen.epoch);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['new']);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('G23: a lesson_reset of a record born after the reset during the logout upload: sent again in the same upload, nothing unsaved', async () => {
    const t = p5();
    await on(t);
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    write(t, 'l1', stamped(record({ seen: ['new'], updatedAt: iso(30) }), { bornAt: iso(30) }));
    // Started over earlier (another device, or before a delete-all that left no row).
    const { gen } = t.api.resetOnServer(COURSE, 'l1', START + 10_000);
    const prepared = t.sync.prepareSignOut();
    await t.clock.advance(SYNC_TIMING.logoutFlushMs);
    assert.deepEqual(await prepared, { unsaved: 0 });
    assert.deepEqual(t.api.puts().map((p) => p.body.records[0].lessonEpoch), [null, gen.epoch]);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['new']);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('a lesson_reset of a record born after the reset whose stamped copy storage refuses: "stopped" (storage), not sent again and again', async () => {
    const storage = memoryStorage();
    let refuse = false;
    const quota = { ...storage, get length() { return storage.length; }, setItem(key, value) {
      if (refuse && key === progressKey(COURSE, 'l1')) throw new Error('QuotaExceededError');
      storage.setItem(key, value);
    } };
    const t = p5({ storage: quota });
    await on(t);
    write(t, 'l1', stamped(record({ seen: ['new'], updatedAt: iso(2) }), { bornAt: iso(2) }));
    t.api.resetOnServer(COURSE, 'l1', START + 60_000);
    refuse = true;
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.equal(genOf(t.storage, 'l1').kind, 'born', 'the stamped copy was refused');
    await t.clock.advance(10 * 60_000);
    assert.equal(t.api.puts().length, 1, 'not sent again with the old stamp');
    assert.deepEqual([t.sync.getView().state, t.sync.getView().reason], ['stopped', 'storage']);
  });

  it('G24: no capabilities at page load (an older VM), then a lesson_reset: the next PUT carries the server\'s stamp and saves', async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, null);
    const t = setup({ storage });
    t.sync.signIn(U1);
    await t.clock.advance(1_000);
    assert.deepEqual(t.sync.capabilities(), { lessonReset: false, achievements: false, review: false });
    // The VM is upgraded while the page is open; another device had started l2 over.
    t.api.server.phase5 = true;
    t.api.server.capabilities = CAPS;
    const { gen } = t.api.resetOnServer(COURSE, 'l2', START - 60_000);
    write(t, 'l2', stamped(record({ seen: ['n1'], updatedAt: iso(1) }), { bornAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs + SYNC_TIMING.minPutIntervalMs);
    assert.equal(t.api.puts().length, 2);
    assert.equal(t.api.puts()[1].body.records[0].lessonEpoch, gen.epoch);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l2`).progress.seen, ['n1']);
    assert.deepEqual(t.sync.capabilities(), { lessonReset: false, achievements: false, review: false }, 'no GET since');
  });

  it('G24: a GET without lessonEpoch (an older server) keeps local stamps and drops nothing', async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, null);
    putLocal(storage, 'l1', stamped(record({ seen: ['a'], updatedAt: iso(-5) }), { epoch: X1, resetAt: iso(-30) }));
    const t = setup({ storage, rows: [serverRow('l1', record({ seen: ['b'], updatedAt: iso(-1) }))] });
    t.sync.signIn(U1);
    await t.clock.advance(1_000);
    assert.deepEqual(genOf(storage, 'l1'), { kind: 'known', epoch: X1, resetAt: iso(-30) });
    assert.deepEqual([...getLocal(storage, 'l1').seen].sort(), ['a', 'b']);
    assert.equal(t.api.puts()[0].body.records[0].lessonEpoch, X1, 'the stamp goes with it (ignored there)');
  });

  it('a lesson started over (emptied) never becomes "continue" on a new device', async () => {
    const t = p5();
    t.api.resetOnServer(COURSE, 'l1');
    t.sync.signIn(U1);
    await t.clock.advance(1_000);
    assert.equal(getLocal(t.storage, 'l1').summary.state, 'not_started');
    assert.equal(t.storage.getItem(LAST_LESSON_KEY), null);
    const u = p5({ rows: [serverRow('l2', record({ seen: ['c'], updatedAt: iso(-5) }))] });
    u.api.resetOnServer(COURSE, 'l1');
    u.sync.signIn(U1);
    await u.clock.advance(1_000);
    assert.equal(JSON.parse(u.storage.getItem(LAST_LESSON_KEY)).lessonId, 'l2');
  });

  it('writeAccount keeps lessonMark on a rewrite for the same learner and epoch; another learner starts without one', async () => {
    const storage = memoryStorage();
    storage.setItem(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: U1, epoch: null, lessonMark: 'm1' }));
    const raw = storage.getItem(SYNC_ACCOUNT_KEY);
    const t = setup({ storage, phase5: true });
    t.sync.signIn(U1);
    await t.clock.advance(1_000);
    assert.equal(storage.getItem(SYNC_ACCOUNT_KEY), raw, 'a routine rewrite looks like no change');
    const u = setup({ storage, phase5: true });
    u.sync.signIn(U2);
    assert.equal(account(storage).userId, U2);
    assert.equal(account(storage).lessonMark, undefined);
  });
});

describe('the Phase 5 fake server', () => {
  it('reads a malformed lessonEpoch as null, like tools/core/lessonProgress.js: saved for a lesson never started over, refused for one that was', async () => {
    const api = fakeApi({ phase5: true });
    const progress = record({ seen: ['b1'], updatedAt: iso(1) });
    const fresh = await api.put({ epoch: null, records: [{ courseSlug: COURSE, lessonId: 'l1', progress, lessonEpoch: 'not-a-uuid' }] }, {});
    assert.deepEqual([fresh.records.length, fresh.rejected], [1, []]);
    const { gen } = api.resetOnServer(COURSE, 'l2');
    const after = await api.put({ epoch: null, records: [{ courseSlug: COURSE, lessonId: 'l2', progress, lessonEpoch: 'not-a-uuid' }] }, {});
    assert.deepEqual([after.records.length, after.rejected[0]?.error_type, after.rejected[0]?.lessonEpoch], [0, 'lesson_reset', gen.epoch]);
    const upper = await api.put({ epoch: null, records: [{ courseSlug: COURSE, lessonId: 'l2', progress, lessonEpoch: gen.epoch.toUpperCase() }] }, {});
    assert.equal(upper.records.length, 1);
  });
});

describe('Phase 5 resetLesson (server first, local only on success)', () => {
  it('refused without a request unless sync is on and the server offers it, for a lesson it stores', async () => {
    const offline = p5();
    offline.api.server.offline = true;
    offline.sync.signIn(U1);
    await offline.clock.advance(60_000);
    assert.deepEqual(await offline.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'not_ready' });

    const loading = p5();
    loading.api.hold('get');
    loading.sync.signIn(U1);
    assert.deepEqual(await loading.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'not_ready' });

    const old = setup({ storage: memoryStorage() });
    setAccount(old.storage, U1, null);
    old.sync.signIn(U1);
    await old.clock.advance(1_000);
    assert.deepEqual(await old.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'unsupported' });

    const t = p5();
    await on(t);
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'x1'), { ok: false, reason: 'not_published' });
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'L1'), { ok: false, reason: 'not_published' });

    const guest = setup({ phase5: true });
    assert.deepEqual(await guest.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'not_ready' });

    // The browser went offline while the sync stays 'on' (only uploads fail): nothing is sent,
    // so the learner is told it is not connected, never that the result is unknown.
    const net = p5();
    await on(net);
    net.sync.networkChanged(false);
    net.api.server.offline = true;
    assert.equal(net.sync.getState().status, 'on');
    assert.deepEqual(await net.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'not_ready' });
    for (const s of [offline, loading, old, t, guest, net]) assert.equal(s.api.resets().length, 0);
  });

  it('G14: a 404 without error_type is an older server: "unsupported" for this page load, nothing changed here', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    const before = t.storage.getItem(progressKey(COURSE, 'l1'));
    t.api.script('reset', fail(404));
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'unsupported' });
    assert.equal(t.sync.capabilities().lessonReset, false);
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'unsupported' });
    assert.equal(t.api.resets().length, 1, 'latched: no second request');
    assert.equal(t.storage.getItem(progressKey(COURSE, 'l1')), before);
  });

  it('refusals: network drop "unconfirmed", 429 "rate_limited", unknown_lesson "not_published", 500 "failed"; nothing changed', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    const before = t.storage.getItem(progressKey(COURSE, 'l1'));
    for (const [step, reason] of [
      [fail(0, 'network'), 'unconfirmed'],
      [fail(0, 'no_session'), 'failed'],
      [fail(429, 'rate_limited'), 'rate_limited'],
      [fail(400, 'unknown_lesson'), 'not_published'],
      [fail(500, 'lesson_progress_failed'), 'failed'],
      [fail(401, 'invalid_token'), 'failed'],
      [fail(503, 'lesson_progress_unavailable'), 'failed'],
    ]) {
      t.api.script('reset', step);
      assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: false, reason });
      assert.equal(t.storage.getItem(progressKey(COURSE, 'l1')), before, reason);
    }
    assert.equal(t.sync.getState().status, 'on');
  });

  it('a 2xx answer the client cannot read (bad_response): "unconfirmed", not "failed" (the server did start it over); the next load drops the old record', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    const before = t.storage.getItem(progressKey(COURSE, 'l1'));
    t.api.script('reset', { respond: (body) => {
      t.api.resetOnServer(body.courseSlug, body.lessonId);
      throw Object.assign(new Error('Unexpected response'), { status: 200, errorType: 'bad_response' });
    } });
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'unconfirmed' });
    assert.equal(t.storage.getItem(progressKey(COURSE, 'l1')), before, 'nothing changed here yet');
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    t.sync.refresh();
    await t.clock.advance(1_000);
    const gen = t.api.server.resets.get(`${COURSE}:l1`);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, []);
    assert.equal(genOf(t.storage, 'l1').epoch, gen.epoch);
  });

  it('409 progress_reset: the progress was deleted elsewhere: "reloaded", local data reset and loaded again', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    t.api.server.rows.clear();
    t.api.server.epoch = E1;
    const gets = t.api.gets().length;
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: false, reason: 'reloaded' });
    assert.equal(getLocal(t.storage, 'l1'), null);
    await t.clock.advance(1_000);
    assert.equal(t.api.gets().length, gets + 1);
    assert.equal(account(t.storage).epoch, E1);
  });

  it('success: the emptied record stamped with the new generation, marker and "continue" gone, other lessons untouched, the mark moved', async () => {
    const t = p5({ rows: [
      serverRow('l1', record({ seen: ['a'], answers: { 'q/q1': answer(1, true, ['x']) }, updatedAt: iso(-5) })),
      serverRow('l2', record({ seen: ['c'], updatedAt: iso(-5) })),
    ] });
    await on(t);
    t.api.script('put', fail(500));
    write(t, 'l1', stamped(record({ seen: ['a', 'b'], answers: { 'q/q1': answer(1, true, ['x']) }, updatedAt: iso(1) }), { epoch: null, resetAt: null }));
    t.storage.setItem(LAST_LESSON_KEY, JSON.stringify({ courseSlug: COURSE, lessonId: 'l1', title: 'L1', pct: 40, at: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.ok(marker(t.storage, 'l1'));
    const l2 = t.storage.getItem(progressKey(COURSE, 'l2'));
    t.events.progress.length = 0;
    const raw = t.storage.getItem(SYNC_ACCOUNT_KEY);

    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: true });
    const gen = t.api.server.resets.get(`${COURSE}:l1`);
    assert.deepEqual(t.api.resets()[0].body, { epoch: null, courseSlug: COURSE, lessonId: 'l1' });
    assert.deepEqual(getLocal(t.storage, 'l1'), { v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: new Date(0).toISOString(), summary: { pct: 0, state: 'not_started' }, lessonGen: { epoch: gen.epoch, resetAt: gen.at } });
    assert.equal(marker(t.storage, 'l1'), null);
    assert.equal(t.storage.getItem(LAST_LESSON_KEY), null);
    assert.equal(t.storage.getItem(progressKey(COURSE, 'l2')), l2);
    assert.notEqual(t.storage.getItem(SYNC_ACCOUNT_KEY), raw);
    assert.ok(account(t.storage).lessonMark);
    assert.equal(account(t.storage).epoch, null, 'the account epoch is never moved');
    assert.deepEqual(t.events.progress, [{ courseSlug: COURSE, lessonId: 'l1', source: 'server', reset: true }]);
    assert.equal(t.sync.getView().failures, 0);
    await t.clock.advance(120_000);
    assert.ok(t.api.puts().every((call) => call.at < START + 10_000 || !call.body.records.some((r) => r.lessonId === 'l1' && r.progress.seen.length)), 'the old content is never sent again');
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, []);
  });

  it('"continue" naming another lesson stays; the reset of a lesson never opened works the same', async () => {
    const t = p5();
    await on(t);
    t.storage.setItem(LAST_LESSON_KEY, JSON.stringify({ courseSlug: COURSE, lessonId: 'l2', title: 'L2', pct: 10, at: iso(1) }));
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: true });
    assert.equal(JSON.parse(t.storage.getItem(LAST_LESSON_KEY)).lessonId, 'l2');
    assert.equal(genOf(t.storage, 'l1').kind, 'known');
  });

  it('G15: a PUT answer of this tab arriving after the reset is dropped (nothing written, nothing reloaded)', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    let release;
    t.api.script('put', {
      hold: new Promise((resolve) => { release = resolve; }),
      respond: (body) => ({ epoch: null, rejected: [], records: body.records.map((r) => ({ ...serverRow(r.lessonId, r.progress), lessonEpoch: null, lessonResetAt: null })) }),
    });
    write(t, 'l1', stamped(record({ seen: ['a', 'b'], updatedAt: iso(1) }), { epoch: null, resetAt: null }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: true });
    const tombstone = t.storage.getItem(progressKey(COURSE, 'l1'));
    const gets = t.api.gets().length;
    release();
    await t.clock.advance(1_000);
    assert.equal(t.storage.getItem(progressKey(COURSE, 'l1')), tombstone);
    assert.equal(t.api.gets().length, gets, 'dropped, not processed');
  });

  it('a flush asked for while a dropped PUT was still on its way goes once that PUT ends', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    let release;
    t.api.script('put', {
      hold: new Promise((resolve) => { release = resolve; }),
      respond: (body) => ({ epoch: null, rejected: [], records: body.records.map((r) => ({ ...serverRow(r.lessonId, r.progress), lessonEpoch: null, lessonResetAt: null })) }),
    });
    write(t, 'l2', stamped(record({ seen: ['c'], updatedAt: iso(1) }), { epoch: null, resetAt: null }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: true });
    // The flush scheduled after the reset (l2 is still pending) finds the old PUT still running.
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    assert.equal(t.api.puts().length, 1);
    release();
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    assert.equal(t.api.puts().length, 2, 'l2 went without another write');
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l2`).progress.seen, ['c']);
    assert.equal(marker(t.storage, 'l2'), null);
  });

  it('during a background refresh: its answer is dropped and the refresh runs again', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    const old = { epoch: null, capabilities: CAPS, records: [{ ...serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) })), lessonEpoch: null, lessonResetAt: null }] };
    let release;
    t.api.script('get', { hold: new Promise((resolve) => { release = resolve; }), respond: () => JSON.parse(JSON.stringify(old)) });
    t.sync.refresh();
    assert.equal(t.sync.getState().status, 'hydrating');
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: true });
    release();
    await t.clock.advance(1_000);
    assert.equal(t.sync.getState().status, 'on');
    assert.deepEqual(getLocal(t.storage, 'l1').seen, []);
    assert.equal(t.sync.getView().state, 'saved');
  });

  it('during a background refresh whose restarted GET fails: sync stays on with its epoch, and later writes upload', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    let release;
    t.api.script('get', { hold: new Promise((resolve) => { release = resolve; }) });
    t.api.script('get', fail(0, 'network'));
    t.sync.refresh();
    assert.equal(t.sync.getState().status, 'hydrating');
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l1'), { ok: true });
    release();
    await t.clock.advance(1_000);
    assert.equal(t.api.gets().length, 3, 'the page load, the interrupted refresh and its restart');
    assert.equal(t.sync.getState().status, 'on');
    assert.equal(await t.sync.whenKnown(), 'known');
    write(t, 'l2', record({ seen: ['n1'], updatedAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l2`).progress.seen, ['n1']);
    assert.equal(t.sync.getView().state, 'saved');
    assert.deepEqual(await t.sync.resetLesson(COURSE, 'l2'), { ok: true });
  });

  it('the learner changed during the request: local data is left alone', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    const before = t.storage.getItem(progressKey(COURSE, 'l1'));
    let release;
    t.api.script('reset', { hold: new Promise((resolve) => { release = resolve; }) });
    const pending = t.sync.resetLesson(COURSE, 'l1');
    t.sync.stop();
    release();
    assert.deepEqual(await pending, { ok: true });
    assert.equal(t.storage.getItem(progressKey(COURSE, 'l1')), before);
    assert.equal(account(t.storage)?.lessonMark, undefined);
  });

  it('capabilities(): null before the first GET, from each GET, cleared when the learner leaves', async () => {
    const t = p5();
    assert.equal(t.sync.capabilities(), null);
    await on(t);
    assert.deepEqual(t.sync.capabilities(), CAPS);
    await t.sync.signOut();
    assert.equal(t.sync.capabilities(), null);
  });
});

describe('Phase 6: the server\'s answer to this tab\'s own save is announced as an echo (in-app check 1)', () => {
  it('the first save of a lesson here (born → known(null)): one server event with echo, then saved; the review count reads nothing for it', async () => {
    const t = p5();
    await on(t);
    t.events.progress.length = 0;
    write(t, 'l1', stamped(record({ seen: ['a'], updatedAt: iso(1) }), { bornAt: iso(1) }));
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs + SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: null, resetAt: null }, 'the stamp moved, so the record was written');
    assert.deepEqual(t.events.progress, [{ courseSlug: COURSE, lessonId: 'l1', source: 'server', echo: true }]);
    assert.equal(t.events.saved, 1);
  });

  it('a PUT answer that names a generation this tab did not know (started over elsewhere) is not an echo', async () => {
    const t = p5();
    await on(t);
    t.events.progress.length = 0;
    write(t, 'l1', stamped(record({ seen: ['a'], updatedAt: iso(1) }), { bornAt: iso(1) }));
    t.api.script('put', { respond: (body) => {
      const sent = body.records[0];
      return { epoch: null, rejected: [], records: [{ courseSlug: COURSE, lessonId: 'l1', progress: sent.progress, pct: 10, state: 'in_progress', updatedAt: sent.progress.updatedAt, lessonEpoch: X1, lessonResetAt: iso(-30) }] };
    } });
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs + SYNC_TIMING.flushDelayMs);
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: X1, resetAt: iso(-30) });
    assert.deepEqual(t.events.progress, [{ courseSlug: COURSE, lessonId: 'l1', source: 'server' }]);
  });

  it('a lesson_reset refusal (another device started the lesson over) is not an echo; the save of the stamped record afterwards is', async () => {
    const t = p5();
    await on(t);
    t.events.progress.length = 0;
    write(t, 'l1', stamped(record({ seen: ['new'], updatedAt: iso(2) }), { bornAt: iso(2) }));
    const { gen } = t.api.resetOnServer(COURSE, 'l1', START + 60_000);
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    assert.deepEqual(genOf(t.storage, 'l1'), { kind: 'known', epoch: gen.epoch, resetAt: gen.at });
    assert.deepEqual(t.events.progress, [{ courseSlug: COURSE, lessonId: 'l1', source: 'server' }], 'the refusal: the review count reads');
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs);
    assert.equal(t.api.puts().length, 2);
    assert.deepEqual(t.events.progress.slice(1), [{ courseSlug: COURSE, lessonId: 'l1', source: 'server', echo: true }], 'the stamped record saved: an echo');
  });

  it('the hydrate GET\'s records are never echoes', async () => {
    const t = p5({ rows: [serverRow('l1', record({ seen: ['a'], updatedAt: iso(-5) }))] });
    await on(t);
    assert.ok(t.events.progress.some((d) => d.lessonId === 'l1'));
    assert.ok(t.events.progress.every((d) => d.echo === undefined));
  });
});
