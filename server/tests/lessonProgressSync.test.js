// Lesson progress sync, the client core (components/lesson/progressSync.ts, Phase 2 design §4):
// the sign-in owner rules (including the adoption choice), hydrate (epoch reset, merge into local,
// uploads of content differences only, chunks), pending markers and flush timing, the PUT response
// rules (merge, marker removal, rejections, 409, 401/503, backoff), restarts after a stall,
// refresh on a visible tab, logout clearing (and who owns what is left), keepalive size, delete,
// single-flight, plus static checks of the wiring (AuthContext order, imports). Phase 4: forget()
// after an account deletion, the `restarted` rule of a re-opened account, and whenKnown().
// Storage, API, timers and clock are fakes (helpers/progressSyncFakes.js, shared with the Phase 5
// tests in progressSyncPhase5.test.js); the fake server merges with the real shared modules.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  LEARNING_EVENTS_KEY,
  LEGACY_PROGRESS_KEY,
  MAX_SLUG_LENGTH,
  SAFE_SLUG,
  SYNC_ACCOUNT_KEY,
  SYNC_LIMITS,
  SYNC_TIMING,
  createProgressSync,
  isAccountSwitch,
  isSignedOutAccount,
  parseSyncAccount,
  pendingKey,
  readerMustDrop,
} from '../../components/lesson/progressSync.ts';
import { LAST_LESSON_KEY, progressKey } from '../../components/lesson/progressStore.ts';
import {
  COURSE,
  account,
  getLocal,
  iso,
  isSyncable,
  marker,
  memoryStorage,
  putLocal,
  setAccount,
  settle,
  setup,
  twoTabs,
} from './helpers/progressSyncFakes.js';
import { MAX_SLUG_LENGTH as SERVER_MAX_SLUG, SAFE_SLUG as SERVER_SAFE_SLUG } from '../../tools/core/lessons.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';

const record = (patch = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: iso(-60), ...patch });
const answer = (attempts, correct, chosen) => ({ attempts, correct, chosen, firstTry: correct && attempts === 1 });

/** A learner already synced on this browser (account with a known epoch). */
function syncedSetup(options = {}) {
  const storage = options.storage ?? memoryStorage();
  if (!storage.getItem(SYNC_ACCOUNT_KEY)) setAccount(storage, U1, options.epoch ?? null);
  return setup({ ...options, storage });
}

const row = (lessonId, progress, extra = {}) => ({ courseSlug: COURSE, lessonId, progress, pct: 40, state: 'in_progress', updatedAt: progress.updatedAt, ...extra });

describe('progress sync: sign-in owner rules (design §4.2)', () => {
  it('the same learner keeps local progress, and repeated session events hydrate once', async () => {
    const t = syncedSetup();
    putLocal(t.storage, 'l1', record({ seen: ['b1'] }));
    t.sync.signIn(U1);
    t.sync.signIn(U1);
    await t.sync.settled();
    t.sync.signIn(U1);
    await t.clock.advance(1000);
    assert.equal(t.api.gets().length, 1);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['b1']);
    assert.equal(t.sync.getState().status, 'on');
  });

  it("another learner's sign-in clears records, markers, rp:lastLesson, learning events and legacy progress synchronously, before any request", () => {
    const storage = memoryStorage({
      [progressKey(COURSE, 'l1')]: JSON.stringify(record({ seen: ['b1'] })),
      [progressKey('dev-blocks', 'gallery')]: JSON.stringify(record({ seen: ['x'] })),
      [pendingKey(COURSE, 'l1')]: iso(-60),
      [LAST_LESSON_KEY]: JSON.stringify({ courseSlug: COURSE, lessonId: 'l1', title: 'x', pct: 10, at: iso(-60) }),
      // The previous learner's streak and history (their session ended without a logout).
      [LEARNING_EVENTS_KEY]: JSON.stringify([{ id: 'e1', type: 'lesson_start', title: { en: 'A lesson', jp: 'A' } }]),
      // Their Blender progress, which hydrateFromApi would otherwise send to this learner's account.
      [LEGACY_PROGRESS_KEY]: JSON.stringify({ blender: { courseId: 'blender', completedStages: ['s1'], completedSteps: {} } }),
      'rp:reader-settings': '{}',
    });
    setAccount(storage, U1, E1);
    const t = setup({ storage });
    t.sync.signIn(U2);
    assert.deepEqual([...storage.map.keys()].sort(), [SYNC_ACCOUNT_KEY, 'rp:reader-settings']);
    assert.deepEqual(account(storage), { userId: U2, epoch: '?' });
    assert.equal(t.sync.getState().status, 'hydrating');
  });

  it('progress nobody owns waits for the choice: no request, no account, nothing written', async () => {
    const t = setup();
    putLocal(t.storage, 'l1', record({ answers: { 'q/q1': answer(1, true, ['a']) } }));
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.sync.getState().status, 'needs_choice');
    assert.equal(t.api.calls.length, 0);
    assert.equal(account(t.storage), null);
    t.sync.noteLocalWrite(COURSE, 'l1');
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('only unsyncable or empty records need no choice', async () => {
    const storage = memoryStorage({
      [progressKey('dev-blocks', 'gallery')]: JSON.stringify(record({ seen: ['x'] })),
      [progressKey(COURSE, 'l1')]: JSON.stringify(record({ lastBlockId: 'b3' })),
    });
    const t = setup({ storage });
    t.sync.signIn(U1);
    assert.deepEqual(account(storage), { userId: U1, epoch: '?' });
    await t.sync.settled();
    assert.equal(t.sync.getState().status, 'on');
    assert.equal(t.api.puts().length, 0);
  });

  it('"Add" makes the progress the learner\'s and uploads it; a later close of the dialog changes nothing', async () => {
    const t = setup();
    putLocal(t.storage, 'l1', record({ seen: ['b1', 'b2'] }));
    t.storage.setItem(LEARNING_EVENTS_KEY, '[{"id":"e1"}]');
    t.sync.signIn(U1);
    assert.equal(t.sync.choose(true), true);
    assert.equal(t.sync.choose(false), false);
    await t.sync.settled();
    // The learning events that go with the added progress stay too.
    assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), '[{"id":"e1"}]');
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null });
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(t.api.puts()[0].body.records.map((r) => r.lessonId), ['l1']);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['b1', 'b2']);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('"Don\'t add" clears the progress here with the learning events, then loads the learner\'s own', async () => {
    const t = setup({ rows: [row('l2', record({ seen: ['s1'], updatedAt: iso(-5) }))] });
    putLocal(t.storage, 'l1', record({ seen: ['b1'] }));
    t.storage.setItem(LAST_LESSON_KEY, JSON.stringify({ courseSlug: COURSE, lessonId: 'l1', title: 'x', pct: 10, at: iso(-60) }));
    // The other person's streak and history (lesson titles), and their Blender progress.
    t.storage.setItem(LEARNING_EVENTS_KEY, JSON.stringify([{ id: 'g1', type: 'lesson_complete', title: { en: 'Done: their lesson', jp: '完了: ほかの子のレッスン' } }]));
    t.storage.setItem(LEGACY_PROGRESS_KEY, '{"blender":{}}');
    t.sync.signIn(U1);
    assert.equal(t.sync.choose(false), true);
    assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), null);
    assert.equal(t.storage.getItem(LEGACY_PROGRESS_KEY), null);
    await t.sync.settled();
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.deepEqual(getLocal(t.storage, 'l2').seen, ['s1']);
    assert.equal(t.api.puts().length, 0);
    assert.equal(JSON.parse(t.storage.getItem(LAST_LESSON_KEY)).lessonId, 'l2');
  });
});

describe('progress sync: hydrate (design §4.3)', () => {
  it('merges each server record into the local one with the server clock and summary, announced as server data', async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['b1', 'b2'], updatedAt: iso(-10) }), { pct: 40, state: 'read' })] });
    putLocal(t.storage, 'l1', record({ seen: ['b3'], updatedAt: iso(-30) }));
    putLocal(t.storage, 'l2', record({ seen: ['c1'], updatedAt: iso(-20) }));
    t.sync.signIn(U1);
    await settle();
    const l1 = getLocal(t.storage, 'l1');
    assert.deepEqual(new Set(l1.seen), new Set(['b1', 'b2', 'b3']));
    assert.ok(t.events.progress.some((d) => d.lessonId === 'l1' && d.source === 'server'));
    await t.sync.settled();
    // l1 held b3 and l2 was local only: both uploaded in one PUT with the epoch.
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(t.api.puts()[0].body.records.map((r) => r.lessonId), ['l1', 'l2']);
    assert.equal(t.api.puts()[0].body.epoch, null);
    assert.equal(getLocal(t.storage, 'l1').updatedAt, iso(-10));
    assert.equal(marker(t.storage, 'l1'), null);
    assert.equal(marker(t.storage, 'l2'), null);
  });

  it('a record only on the server is written with its pct/state and updatedAt (streak days stay true)', async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['b1'], updatedAt: iso(-2000) }), { pct: 55, state: 'checked' })] });
    t.sync.signIn(U1);
    await t.sync.settled();
    const l1 = getLocal(t.storage, 'l1');
    assert.deepEqual(l1.summary, { pct: 55, state: 'checked' });
    assert.equal(l1.updatedAt, iso(-2000));
    assert.equal(t.api.puts().length, 0);
  });

  it('takes in per-key edit times when nothing else differs, so a later edit here does not undo a newer one elsewhere', async () => {
    // This browser's record predates per-key times; the server row holds the same check with its own time.
    const values = { checks: { 'card:f/c1': false }, updatedAt: iso(-30), editedAt: iso(-30) };
    const t = syncedSetup({ rows: [row('l1', record({ ...values, editedKeys: { 'card:f/c1': iso(-30) } }))] });
    putLocal(t.storage, 'l1', record({ ...values, summary: { pct: 40, state: 'in_progress' } }));
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.deepEqual(getLocal(t.storage, 'l1').editedKeys, { 'card:f/c1': iso(-30) });
    assert.equal(t.api.puts().length, 0);
    // Another device then marks c1 known; this tab, which has not seen that, marks c2 known.
    t.api.server.rows.get(`${COURSE}:l1`).progress = record({ checks: { 'card:f/c1': true }, updatedAt: iso(-10), editedAt: iso(-10), editedKeys: { 'card:f/c1': iso(-10) } });
    const local = getLocal(t.storage, 'l1');
    putLocal(t.storage, 'l1', { ...local, checks: { ...local.checks, 'card:f/c2': true }, updatedAt: iso(1), editedAt: iso(1), editedKeys: { ...local.editedKeys, 'card:f/c2': iso(1) } });
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(5_000);
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.checks, { 'card:f/c1': true, 'card:f/c2': true });
  });

  it('a new device points "continue" at the most recently updated server lesson, in the UI language', async () => {
    const t = syncedSetup({
      rows: [
        row('l1', record({ seen: ['b1'], updatedAt: iso(-100) }), { pct: 10 }),
        row('l2', record({ seen: ['b2'], updatedAt: iso(-5) }), { pct: 70 }),
      ],
    });
    t.sync.signIn(U1);
    await t.sync.settled();
    const last = JSON.parse(t.storage.getItem(LAST_LESSON_KEY));
    assert.deepEqual(last, { courseSlug: COURSE, lessonId: 'l2', title: 'Title of l2', pct: 70, at: iso(-5) });
  });

  it('keeps an existing rp:lastLesson', async () => {
    const t = syncedSetup({ rows: [row('l2', record({ seen: ['b2'], updatedAt: iso(-5) }))] });
    const mine = JSON.stringify({ courseSlug: COURSE, lessonId: 'l1', title: 'Mine', pct: 5, at: iso(-50) });
    t.storage.setItem(LAST_LESSON_KEY, mine);
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.equal(t.storage.getItem(LAST_LESSON_KEY), mine);
  });

  it('a different known epoch (deleted on another device) clears local data first and uploads nothing', async () => {
    const t = syncedSetup({ epoch: E1, rows: [row('l3', record({ seen: ['x'], updatedAt: iso(-1) }))] });
    t.api.server.epoch = E2;
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(-1) }));
    t.storage.setItem(pendingKey(COURSE, 'l1'), iso(-1));
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(marker(t.storage, 'l1'), null);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: E2 });
    assert.equal(t.api.puts().length, 0);
    assert.deepEqual(getLocal(t.storage, 'l3').seen, ['x']);
  });

  it("epoch '?' (not known yet) keeps local data and uploads it", async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, '?');
    const t = setup({ storage, epoch: E1 });
    putLocal(storage, 'l1', record({ seen: ['b1'] }));
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.deepEqual(account(storage), { userId: U1, epoch: E1 });
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.puts()[0].body.epoch, E1);
  });

  it('uploads only records whose merge adds content, and drops markers the server already covers', async () => {
    const same = record({ seen: ['b1'], checks: { 'checklist:c/i1': true }, updatedAt: iso(-10) });
    const t = syncedSetup({ rows: [row('l1', same)] });
    putLocal(t.storage, 'l1', { ...same, updatedAt: iso(-3) });
    t.storage.setItem(pendingKey(COURSE, 'l1'), iso(-3));
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.equal(t.api.puts().length, 0);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('sends more than 25 records in chunks of at most 25', async () => {
    const t = syncedSetup();
    for (let i = 0; i < 30; i += 1) putLocal(t.storage, `l${String(i).padStart(2, '0')}`, record({ seen: [`b${i}`] }));
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.deepEqual(t.api.puts().map((call) => call.body.records.length), [25, 5]);
    assert.equal(SYNC_LIMITS.batchRecords, 25);
    assert.equal([...t.storage.map.keys()].filter((key) => key.startsWith('rp:progressSync:pending:')).length, 0);
  });

  it('retries the GET on 429/5xx/network, then waits for the learner\'s next session event; local writes are still marked', async () => {
    const t = syncedSetup();
    for (let i = 0; i < 4; i += 1) t.api.script('get', { error: Object.assign(new Error('x'), { status: i % 2 ? 429 : 0 }) });
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.api.gets().length, 1 + SYNC_TIMING.getRetries);
    assert.equal(t.sync.getState().status, 'offline');
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    assert.equal(marker(t.storage, 'l1'), iso(1));
    await t.clock.advance(600_000);
    assert.equal(t.api.puts().length, 0);
    // TOKEN_REFRESHED or SIGNED_IN on refocus: one GET per event (the next event tries again)…
    t.api.script('get', { error: Object.assign(new Error('x'), { status: 503 }) });
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.api.gets().length, 5);
    assert.equal(t.sync.getState().status, 'offline');
    // …until the hydrate runs and uploads what is pending.
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.equal(t.api.gets().length, 6);
    assert.equal(t.sync.getState().status, 'on');
    assert.deepEqual(t.api.puts().map((call) => call.body.records.map((r) => r.lessonId)), [['l1']]);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('a 401 GET is not retried', async () => {
    const t = syncedSetup();
    t.api.script('get', { error: Object.assign(new Error('x'), { status: 401 }) });
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.api.gets().length, 1);
    assert.equal(t.sync.getState().status, 'offline');
  });

  it('without the API, local owner rules still apply and nothing is requested', async () => {
    const storage = memoryStorage({ [progressKey(COURSE, 'l1')]: JSON.stringify(record({ seen: ['b1'] })) });
    setAccount(storage, U2, E1);
    const t = setup({ storage, apiEnabled: () => false });
    t.sync.signIn(U1);
    await t.clock.advance(10_000);
    assert.equal(getLocal(storage, 'l1'), null);
    assert.equal(t.api.calls.length, 0);
    assert.equal(t.sync.getState().status, 'offline');
  });
});

describe('progress sync: writes and flushes (design §4.5)', () => {
  async function onlineSetup(options = {}) {
    const t = syncedSetup(options);
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.equal(t.sync.getState().status, 'on');
    return t;
  }
  const write = (t, lessonId, progress) => {
    putLocal(t.storage, lessonId, progress);
    t.sync.noteLocalWrite(COURSE, lessonId);
  };

  it('flushes 5 s after the last change and at most once per 20 s', async () => {
    const t = await onlineSetup();
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(4_000);
    write(t, 'l1', record({ seen: ['b1', 'b2'], updatedAt: iso(2) }));
    await t.clock.advance(4_900);
    assert.equal(t.api.puts().length, 0);
    await t.clock.advance(200);
    assert.equal(t.api.puts().length, 1);
    write(t, 'l2', record({ seen: ['c1'], updatedAt: iso(3) }));
    await t.clock.advance(19_000);
    assert.equal(t.api.puts().length, 1);
    await t.clock.advance(1_000);
    assert.equal(t.api.puts().length, 2);
    assert.deepEqual(t.api.puts()[1].body.records.map((r) => r.lessonId), ['l2']);
  });

  it('a learner who never pauses is still flushed within a minute', async () => {
    const t = await onlineSetup();
    for (let i = 0; i < 40; i += 1) {
      write(t, 'l1', record({ seen: Array.from({ length: i + 1 }, (_, j) => `b${j}`), updatedAt: iso(i) }));
      await t.clock.advance(1_500);
    }
    assert.ok(t.api.puts().length >= 1);
    assert.ok(t.api.puts().length <= 3);
  });

  it('ignores lessons that are not syncable (dev gallery, drafts not in the course)', async () => {
    const t = await onlineSetup();
    t.storage.setItem(progressKey('dev-blocks', 'gallery'), JSON.stringify(record({ seen: ['x'] })));
    t.sync.noteLocalWrite('dev-blocks', 'gallery');
    t.storage.setItem(progressKey(COURSE, 'Bad_Id'), JSON.stringify(record({ seen: ['x'] })));
    t.sync.noteLocalWrite(COURSE, 'Bad_Id');
    await t.clock.advance(60_000);
    assert.equal(t.api.puts().length, 0);
  });

  it('merges the response into the current local record: an answer given during the PUT stays, and stays pending', async () => {
    const t = await onlineSetup({ rows: [row('l1', record({ seen: ['s1'], updatedAt: iso(-100) }))] });
    write(t, 'l1', record({ seen: ['s1', 'b1'], updatedAt: iso(1) }));
    const release = t.api.hold('put');
    await t.clock.advance(5_000);
    assert.equal(t.api.puts().length, 1);
    const answered = { ...getLocal(t.storage, 'l1'), answers: { 'q/q1': answer(1, true, ['a']) }, updatedAt: iso(2) };
    write(t, 'l1', answered);
    release();
    await settle();
    const local = getLocal(t.storage, 'l1');
    assert.deepEqual(local.answers['q/q1'], answer(1, true, ['a']));
    assert.deepEqual(new Set(local.seen), new Set(['s1', 'b1']));
    assert.equal(marker(t.storage, 'l1'), iso(2));
    await t.clock.advance(20_000);
    assert.equal(t.api.puts().length, 2);
    assert.ok(t.api.puts()[1].body.records[0].progress.answers['q/q1']);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('keeps the marker when the returned record lacks something that was sent', async () => {
    const t = await onlineSetup();
    write(t, 'l1', record({ seen: ['b1'], checks: { 'checklist:c/i1': true }, updatedAt: iso(1) }));
    t.api.script('put', {
      respond: (body) => ({
        epoch: null,
        records: [{ courseSlug: COURSE, lessonId: 'l1', progress: { ...body.records[0].progress, checks: {} }, pct: 10, state: 'in_progress' }],
        rejected: [],
      }),
    });
    await t.clock.advance(5_000);
    assert.equal(marker(t.storage, 'l1'), iso(1));
    // The local check survives the merge of the shorter record.
    assert.equal(getLocal(t.storage, 'l1').checks['checklist:c/i1'], true);
  });

  it('a rejected unknown lesson keeps its local record and loses its marker', async () => {
    const t = await onlineSetup();
    const local = record({ seen: ['b1'], updatedAt: iso(1) });
    write(t, 'l-new', local);
    await t.clock.advance(5_000);
    assert.equal(t.api.puts().length, 1);
    assert.equal(marker(t.storage, 'l-new'), null);
    assert.deepEqual(getLocal(t.storage, 'l-new'), local);
  });

  it('409 progress_reset (deleted on another device) clears local data and hydrates again', async () => {
    const t = await onlineSetup({ epoch: E1 });
    t.api.server.epoch = E2;
    t.api.server.rows.clear();
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(5_000);
    await t.sync.settled();
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(marker(t.storage, 'l1'), null);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: E2 });
    assert.equal(t.api.gets().length, 2);
    assert.equal(t.sync.getState().status, 'on');
  });

  it('409 after another tab already reset to that epoch keeps what that tab wrote since', async () => {
    const t = await onlineSetup({ epoch: E1 });
    t.api.server.epoch = E2;
    t.api.server.rows.clear();
    // The other tab deleted (account E2) and the learner then read l2 there.
    setAccount(t.storage, U1, E2);
    write(t, 'l2', record({ seen: ['fresh'], updatedAt: iso(5) }));
    await t.clock.advance(5_000);
    await t.sync.settled();
    assert.deepEqual(getLocal(t.storage, 'l2').seen, ['fresh']);
    // Re-hydrated with E2 and uploaded.
    assert.equal(t.api.puts().at(-1).body.epoch, E2);
    assert.ok(t.api.server.rows.has(`${COURSE}:l2`));
  });

  it('401 and 503 stop uploads until the learner\'s next session event (markers stay)', async () => {
    for (const status of [401, 503]) {
      const t = await onlineSetup();
      t.api.script('put', { error: Object.assign(new Error('x'), { status }) });
      write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
      await t.clock.advance(5_000);
      assert.equal(t.sync.getState().status, 'stopped');
      write(t, 'l1', record({ seen: ['b1', 'b2'], updatedAt: iso(2) }));
      await t.clock.advance(600_000);
      assert.equal(t.api.puts().length, 1, `status ${status}`);
      assert.equal(marker(t.storage, 'l1'), iso(2));
      // The learner's next session event (a token refresh) starts sync again.
      t.sync.signIn(U1);
      await t.sync.settled();
      assert.equal(t.sync.getState().status, 'on', `status ${status}`);
      assert.equal(t.api.puts().length, 2, `status ${status}`);
      assert.equal(marker(t.storage, 'l1'), null);
      assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['b1', 'b2']);
    }
  });

  it('backs off after a failure (20 s, doubling, at most 5 min)', async () => {
    const t = await onlineSetup();
    for (let i = 0; i < 8; i += 1) t.api.script('put', { error: Object.assign(new Error('x'), { status: 500 }) });
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    await t.clock.advance(5_000);
    assert.equal(t.api.puts().length, 1);
    await t.clock.advance(14_000);
    assert.equal(t.api.puts().length, 1);
    await t.clock.advance(6_000);
    assert.equal(t.api.puts().length, 2);
    // 20 s, 40 s, 80 s, 160 s, then 5 min (× 0.75 jitter here): 8 failures and a success in an hour.
    await t.clock.advance(3_600_000);
    assert.equal(t.api.puts().length, 9);
    assert.equal(marker(t.storage, 'l1'), null);
    const gaps = t.api.puts().slice(1).map((call, i) => (call.at - t.api.puts()[i].at) / 1000);
    assert.deepEqual(gaps.slice(0, 4).map(Math.round), [20, 30, 60, 120]);
    assert.ok(gaps.slice(4).every((gap) => gap >= 225 && gap <= 300), gaps.join(','));
  });

  it('page hide sends one keepalive PUT when the body is at most 60 KB, a plain one otherwise', async () => {
    const t = await onlineSetup();
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.flushOnHide();
    await settle();
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.puts()[0].keepalive, true);

    await t.clock.advance(20_000);
    const big = record({ seen: Array.from({ length: 900 }, (_, i) => `block-${String(i).padStart(4, '0')}-${'x'.repeat(90)}`.slice(0, 80)), updatedAt: iso(2) });
    write(t, 'l2', big);
    t.sync.flushOnHide();
    await settle();
    const last = t.api.puts().at(-1);
    assert.ok(last.bytes > SYNC_LIMITS.keepaliveBytes, `body ${last.bytes}`);
    assert.equal(last.keepalive, false);
  });

  it('stops when another tab signed another learner in, and a session event of the old one does not start it again', async () => {
    const t = await onlineSetup();
    write(t, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    setAccount(t.storage, U2, '?');
    write(t, 'l2', record({ seen: ['c1'], updatedAt: iso(2) }));
    await t.clock.advance(60_000);
    assert.equal(t.api.puts().length, 0);
    assert.equal(marker(t.storage, 'l2'), null);
    assert.equal(t.sync.getState().status, 'stopped');
    // A late session event of the old learner neither starts it again nor clears the new one's data.
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.api.gets().length, 1);
    assert.deepEqual(account(t.storage), { userId: U2, epoch: '?' });
    assert.deepEqual(getLocal(t.storage, 'l2').seen, ['c1']);
  });
});

describe('progress sync: refresh when the tab is visible again', () => {
  it('loads what an AI app saved meanwhile, merged into local data, at most once a minute', async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['b1'], updatedAt: iso(-10) }))] });
    t.sync.signIn(U1);
    await t.sync.settled();
    // course-quiz-check records an answer on the server.
    t.api.server.rows.get(`${COURSE}:l1`).progress = record({ seen: ['b1'], answers: { 'q/q1': answer(1, true, ['b']) }, updatedAt: iso(0.5) });
    t.sync.refresh();
    await t.sync.settled();
    assert.equal(t.api.gets().length, 1);
    assert.deepEqual(getLocal(t.storage, 'l1').answers, {});
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    const before = t.events.progress.length;
    t.sync.refresh();
    t.sync.refresh();
    await t.sync.settled();
    assert.equal(t.api.gets().length, 2);
    assert.deepEqual(getLocal(t.storage, 'l1').answers['q/q1'], answer(1, true, ['b']));
    assert.ok(t.events.progress.slice(before).some((d) => d.lessonId === 'l1' && d.source === 'server'));
    assert.equal(t.sync.getState().status, 'on');
    assert.equal(t.api.puts().length, 0);
  });

  it('waits while an upload is due, and a failed refresh (one GET) leaves sync on', async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.sync.refresh();
    assert.equal(t.sync.getState().status, 'on');
    await t.clock.advance(5_000);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.gets().length, 1);
    t.api.script('get', { error: Object.assign(new Error('x'), { status: 0 }) });
    t.sync.refresh();
    await t.sync.settled();
    assert.equal(t.api.gets().length, 2);
    assert.equal(t.sync.getState().status, 'on');
    t.sync.refresh();
    assert.equal(t.api.gets().length, 2);
    // Later writes still upload.
    putLocal(t.storage, 'l1', record({ seen: ['b1', 'b2'], updatedAt: iso(2) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(20_000);
    assert.equal(t.api.puts().length, 2);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['b1', 'b2']);
  });

  it('does nothing unless sync is on', async () => {
    const t = setup();
    putLocal(t.storage, 'l1', record({ seen: ['x'] }));
    t.sync.refresh();
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'needs_choice');
    await t.clock.advance(SYNC_TIMING.refreshAfterMs);
    t.sync.refresh();
    await t.clock.advance(1_000);
    assert.equal(t.api.calls.length, 0);
  });
});

describe('progress sync: logout (design §4.7)', () => {
  it('flushes, then clears records, rp:lastLesson, learning events and legacy progress; the account goes when nothing is pending', async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.storage.setItem(progressKey('dev-blocks', 'gallery'), JSON.stringify(record({ seen: ['x'] })));
    t.storage.setItem(LAST_LESSON_KEY, '{}');
    t.storage.setItem(LEARNING_EVENTS_KEY, '[]');
    t.storage.setItem(LEGACY_PROGRESS_KEY, '{"blender":{"courseId":"blender","completedStages":["s1"]}}');
    t.storage.setItem('rp:reader-settings', '{}');
    await t.sync.signOut();
    assert.equal(t.api.puts().length, 1);
    assert.deepEqual([...t.storage.map.keys()], ['rp:reader-settings']);
    assert.deepEqual(t.sync.getState(), { status: 'off', userId: null });
  });

  it('keeps records that are still pending, and the account marked loggedOut, when the upload fails', async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    putLocal(t.storage, 'l2', record({ seen: ['old'], updatedAt: iso(-100) }));
    t.api.script('put', { error: Object.assign(new Error('offline'), { status: 0 }) });
    await t.sync.signOut();
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['b1']);
    assert.equal(marker(t.storage, 'l1'), iso(1));
    assert.equal(getLocal(t.storage, 'l2'), null);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null, loggedOut: true });

    // The same learner's next sign-in uploads them without asking (nothing changed since);
    // another learner's clears them.
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'hydrating');
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null });
    await t.sync.settled();
    assert.equal(t.api.puts().length, 2);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it("another learner's sign-in after a failed logout upload clears the pending records", async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.api.script('put', { error: Object.assign(new Error('offline'), { status: 0 }) });
    await t.sync.signOut();
    t.sync.signIn(U2);
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('waits at most 3 s for the upload', async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    const release = t.api.hold('put');
    let done = false;
    const out = t.sync.signOut().then(() => {
      done = true;
    });
    await t.clock.advance(2_900);
    assert.equal(done, false);
    await t.clock.advance(200);
    await out;
    assert.equal(done, true);
    assert.equal(marker(t.storage, 'l1'), iso(1));
    // The late response does not write anything back.
    release();
    await settle();
    assert.equal(getLocal(t.storage, 'l1').summary, undefined);
  });

  it('while the GET failed (sync off) logout loads and uploads once more before clearing', async () => {
    const t = syncedSetup();
    for (let i = 0; i < 4; i += 1) t.api.script('get', { error: Object.assign(new Error('x'), { status: 503 }) });
    putLocal(t.storage, 'l2', record({ seen: ['old'] }));
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.sync.getState().status, 'offline');
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    // The API is back: the logout hydrates (this learner's records the server lacks) and uploads.
    await t.sync.signOut();
    assert.equal(t.api.gets().length, 5);
    assert.deepEqual(t.api.puts().map((call) => call.body.records.map((r) => r.lessonId)), [['l1', 'l2']]);
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(getLocal(t.storage, 'l2'), null);
    assert.equal(account(t.storage), null);
  });

  it('when that last try fails too, logout keeps only what is pending, for at most 3 s', async () => {
    const t = syncedSetup();
    for (let i = 0; i < 8; i += 1) t.api.script('get', { error: Object.assign(new Error('x'), { status: 0 }) });
    putLocal(t.storage, 'l2', record({ seen: ['old'] }));
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    let done = false;
    const out = t.sync.signOut().then(() => {
      done = true;
    });
    await t.clock.advance(2_900);
    assert.equal(done, false);
    await t.clock.advance(200);
    await out;
    assert.equal(getLocal(t.storage, 'l2'), null);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['b1']);
    assert.equal(t.api.puts().length, 0);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null, loggedOut: true });
    // The GET that was still retrying ends with the logout.
    await t.clock.advance(60_000);
    assert.ok(t.api.gets().length <= 7, `gets ${t.api.gets().length}`);
  });

  it('after a 503 stopped uploads, logout uploads what is pending', async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    t.api.script('put', { error: Object.assign(new Error('x'), { status: 503 }) });
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(5_000);
    assert.equal(t.sync.getState().status, 'stopped');
    putLocal(t.storage, 'l1', record({ seen: ['b1', 'b2'], updatedAt: iso(30) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(3_600_000);
    await t.sync.signOut();
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['b1', 'b2']);
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(account(t.storage), null);
  });

  it('a new sign-in after logout hydrates again', async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['b1'] }))] });
    t.sync.signIn(U1);
    await t.sync.settled();
    await t.sync.signOut();
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.equal(t.api.gets().length, 2);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['b1']);
  });
});

describe('progress sync: delete (design §4.8)', () => {
  it('deletes on the server first, then here, and keeps the new epoch', async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['b1'] }))] });
    t.sync.signIn(U1);
    await t.sync.settled();
    t.storage.setItem(LAST_LESSON_KEY, '{}');
    const result = await t.sync.deleteAll();
    assert.deepEqual(result, { ok: true, scope: 'account' });
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(t.storage.getItem(LAST_LESSON_KEY), null);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: t.api.server.epoch });
    // Later work is saved under the new epoch.
    putLocal(t.storage, 'l2', record({ seen: ['c1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l2');
    await t.clock.advance(5_000);
    assert.equal(t.api.puts().at(-1).body.epoch, t.api.server.epoch);
    assert.ok(t.api.server.rows.has(`${COURSE}:l2`));
  });

  it('changes nothing when the server delete fails', async () => {
    const t = syncedSetup({ epoch: E1, rows: [row('l1', record({ seen: ['b1'] }))] });
    t.sync.signIn(U1);
    await t.sync.settled();
    t.api.script('del', { error: Object.assign(new Error('x'), { status: 503 }) });
    const result = await t.sync.deleteAll();
    assert.deepEqual(result, { ok: false });
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['b1']);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: E1 });
  });

  it('a PUT answered after the delete does not bring the records back', async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    const release = t.api.hold('put');
    await t.clock.advance(5_000);
    const deleting = t.sync.deleteAll();
    await settle();
    release();
    await deleting;
    await settle();
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(marker(t.storage, 'l1'), null);
  });

  it('without a primary session only this device is cleared', async () => {
    const t = setup();
    putLocal(t.storage, 'l1', record({ seen: ['b1'] }));
    t.storage.setItem(LAST_LESSON_KEY, '{}');
    const result = await t.sync.deleteAll();
    assert.deepEqual(result, { ok: true, scope: 'device' });
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(t.storage.getItem(LAST_LESSON_KEY), null);
    assert.equal(t.api.calls.length, 0);
  });
});

/** Two tabs of one browser: one localStorage, one server, one clock, a sync core each. */
describe('progress sync: shared tablets and other tabs (verification scenarios)', () => {
  it("child A's GET fails, A signs out, child B signs in: A's work reaches A's account, and B never sees or uploads it", async () => {
    const t = syncedSetup({ epoch: E1 });
    putLocal(t.storage, 'l2', record({ seen: ['a-old'] }));
    for (let i = 0; i < 4; i += 1) t.api.script('get', { error: Object.assign(new Error('x'), { status: 429 }) });
    t.sync.signIn(U1);
    await t.clock.advance(60_000);
    assert.equal(t.sync.getState().status, 'offline');
    // An hour of study with the API healthy again.
    putLocal(t.storage, 'l1', record({ seen: ['a-new'], updatedAt: iso(60) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(3_600_000);
    t.storage.setItem(LEARNING_EVENTS_KEY, '[{"id":"a"}]');
    await t.sync.signOut();
    // The logout uploaded A's records; nothing of A's is left here.
    assert.deepEqual(t.api.puts().map((call) => call.body.records.map((r) => r.lessonId)), [['l1', 'l2']]);
    const rowsA = t.api.server.rows;
    assert.deepEqual(rowsA.get(`${COURSE}:l1`).progress.seen, ['a-new']);
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(getLocal(t.storage, 'l2'), null);
    assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), null);
    assert.equal(account(t.storage), null);
    // B's account on the server.
    t.api.server.rows = new Map();
    t.sync.signIn(U2);
    await t.sync.settled();
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.server.rows.size, 0);
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.deepEqual(account(t.storage), { userId: U2, epoch: E1 });
  });

  it("A logs out offline and someone without a primary session studies here: A's next sign-in asks first, and \"Don't add\" keeps only A's own unsent work", async () => {
    const t = syncedSetup({ epoch: E1 });
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['a1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.api.script('put', { error: Object.assign(new Error('offline'), { status: 0 }) });
    await t.sync.signOut();
    assert.deepEqual(account(t.storage), { userId: U1, epoch: E1, loggedOut: true });
    // A Nexloom-only user (no primary session: sync is off) reads l3, with its streak and history.
    putLocal(t.storage, 'l3', record({ seen: ['n-only'], updatedAt: iso(20) }));
    t.sync.noteLocalWrite(COURSE, 'l3');
    t.storage.setItem(LEARNING_EVENTS_KEY, '[{"id":"n"}]');
    assert.equal(marker(t.storage, 'l3'), null);

    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'needs_choice');
    await t.clock.advance(60_000);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.gets().length, 1);
    assert.equal(t.api.server.rows.size, 0);

    assert.equal(t.sync.choose(false), true);
    await t.sync.settled();
    assert.equal(getLocal(t.storage, 'l3'), null);
    assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), null);
    assert.deepEqual(t.api.puts().slice(1).map((call) => call.body.records.map((r) => r.lessonId)), [['l1']]);
    assert.deepEqual(t.api.puts().at(-1).body.epoch, E1);
    assert.deepEqual([...t.api.server.rows.keys()], [`${COURSE}:l1`]);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: E1 });
  });

  it("a change to A's unsent record made after A left is asked about too; \"Add\" uploads it", async () => {
    const t = syncedSetup();
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['a1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.api.script('put', { error: Object.assign(new Error('offline'), { status: 0 }) });
    await t.sync.signOut();
    putLocal(t.storage, 'l1', record({ seen: ['a1', 'n1'], updatedAt: iso(20) }));
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'needs_choice');
    assert.equal(t.sync.choose(true), true);
    await t.sync.settled();
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['a1', 'n1']);
  });

  it('a delete made elsewhere while A was away still clears what A left, whatever A chooses', async () => {
    const t = syncedSetup({ epoch: E1 });
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['a1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.api.script('put', { error: Object.assign(new Error('offline'), { status: 0 }) });
    await t.sync.signOut();
    putLocal(t.storage, 'l3', record({ seen: ['n-only'], updatedAt: iso(20) }));
    // A deleted their progress on another device.
    t.api.server.epoch = E2;
    t.sync.signIn(U1);
    t.sync.choose(true);
    await t.sync.settled();
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(getLocal(t.storage, 'l3'), null);
    assert.equal(t.api.server.rows.size, 0);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: E2 });
  });

  it("A's session ends without a logout and someone else studies here: A's next sign-in asks first and uploads nothing before the answer", async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['a1'], updatedAt: iso(-30) }))] });
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l2', record({ seen: ['a2'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l2');
    // The session expires before the flush.
    t.sync.stop();
    assert.equal(t.sync.getState().status, 'off');
    // Both records are A's now; only l2 was unsent (Phase 5: the sign-in view counts that one).
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null, loggedOut: true, unsent: [`${COURSE}:l2`] });
    putLocal(t.storage, 'l3', record({ seen: ['n-only'], updatedAt: iso(20) }));
    await t.clock.advance(60_000);

    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'needs_choice');
    await t.clock.advance(60_000);
    assert.equal(t.api.puts().length, 0);
    assert.equal(t.api.gets().length, 1);
    t.sync.choose(false);
    await t.sync.settled();
    // A's synced l1 and unsent l2 stay; only l2 needed uploading.
    assert.equal(getLocal(t.storage, 'l3'), null);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['a1']);
    assert.deepEqual(t.api.puts().map((call) => call.body.records.map((r) => r.lessonId)), [['l2']]);
    assert.ok(!t.api.server.rows.has(`${COURSE}:l3`));
  });

  it('a logout in one tab: the other tab, until its session ends too, keeps marking but uploads nothing; A is not asked about it later', async () => {
    const t = twoTabs();
    setAccount(t.storage, U1, null);
    t.a.signIn(U1);
    t.b.signIn(U1);
    await t.a.settled();
    await t.b.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.b.noteLocalWrite(COURSE, 'l1');
    t.api.script('put', { error: Object.assign(new Error('offline'), { status: 0 }) });
    await t.b.signOut();
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null, loggedOut: true });
    // Tab A has not heard of the logout yet.
    putLocal(t.storage, 'l2', record({ seen: ['c1'], updatedAt: iso(2) }));
    t.a.noteLocalWrite(COURSE, 'l2');
    await t.clock.advance(60_000);
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.a.getState().status, 'stopped');
    // Its SIGNED_OUT arrives; then A signs in again: both records are A's.
    t.a.stop();
    t.a.signIn(U1);
    assert.equal(t.a.getState().status, 'hydrating');
    await t.a.settled();
    assert.deepEqual(t.api.puts().at(-1).body.records.map((r) => r.lessonId), ['l1', 'l2']);
  });

  it("A's session ends without a logout and nobody else studies here: A's next sign-in asks nothing", async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['a1'], updatedAt: iso(-30) }))] });
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l2', record({ seen: ['a2'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l2');
    t.sync.stop();
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'hydrating');
    await t.sync.settled();
    assert.equal(t.sync.getState().status, 'on');
    assert.deepEqual(t.api.puts().map((call) => call.body.records.map((r) => r.lessonId)), [['l2']]);
    assert.equal(marker(t.storage, 'l1'), null);
    assert.equal(marker(t.storage, 'l2'), null);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null });
  });

  it("A's session ends without a logout (expiry): B's sign-in still clears A's records and streak first", async () => {
    const t = syncedSetup({ rows: [row('l1', record({ seen: ['a1'] }))] });
    t.sync.signIn(U1);
    await t.sync.settled();
    t.storage.setItem(LEARNING_EVENTS_KEY, '[{"id":"a"}]');
    t.sync.stop();
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['a1']);
    t.sync.signIn(U2);
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), null);
    assert.equal(t.storage.getItem(LAST_LESSON_KEY), null);
  });

  it('guests, mock and Nexloom-only sessions (no primary sign-in) never request, upload or clear', async () => {
    const t = setup();
    putLocal(t.storage, 'l1', record({ seen: ['g1'] }));
    t.storage.setItem(LEARNING_EVENTS_KEY, '[]');
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.sync.flushOnHide();
    await t.sync.signOut();
    t.sync.stop();
    await t.clock.advance(60_000);
    assert.equal(t.api.calls.length, 0);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['g1']);
    assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), '[]');
    assert.equal(marker(t.storage, 'l1'), null);
    assert.equal(account(t.storage), null);
  });

  it('every session event of one page load makes one GET and one upload', async () => {
    const t = syncedSetup();
    putLocal(t.storage, 'l1', record({ seen: ['b1'] }));
    // getSession, INITIAL_SESSION, SIGNED_IN on refocus, TOKEN_REFRESHED.
    for (let i = 0; i < 4; i += 1) {
      t.sync.signIn(U1);
      await settle();
    }
    await t.sync.settled();
    await t.clock.advance(120_000);
    assert.equal(t.api.gets().length, 1);
    assert.equal(t.api.puts().length, 1);
  });

  it('a logout during the GET backoff makes no further GET', async () => {
    const t = syncedSetup();
    for (let i = 0; i < 4; i += 1) t.api.script('get', { error: Object.assign(new Error('x'), { status: 0 }) });
    t.sync.signIn(U1);
    await settle();
    // Phase 5 (G11): the logout waits (≤ 3 s) for the load that runs; its retries inside that
    // wait are part of it. With random() 0.5 they go at +1 s and +3 s: the first is inside the
    // wait, the second is due with the deadline, which was set first and ends the wait. After the
    // logout, nothing more.
    const out = t.sync.signOut();
    await t.clock.advance(3_000);
    await out;
    assert.equal(t.api.gets().length, 2, 'the first GET and one retry inside the logout wait');
    await t.clock.advance(60_000);
    assert.equal(t.api.gets().length, 2);
  });

  it('"Add" in one tab: the other tab stops asking, and its "Don\'t add" no longer clears', async () => {
    const t = twoTabs();
    putLocal(t.storage, 'l1', record({ seen: ['mine'] }));
    // Offline: only the markers keep the added records.
    for (let i = 0; i < 8; i += 1) t.api.script('get', { error: Object.assign(new Error('x'), { status: 0 }) });
    t.a.signIn(U1);
    t.b.signIn(U1);
    assert.equal(t.b.getState().status, 'needs_choice');
    t.a.choose(true);
    t.b.choose(false);
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['mine']);
    assert.ok(marker(t.storage, 'l1'));
    assert.deepEqual(account(t.storage), { userId: U1, epoch: '?' });
    assert.equal(t.b.getState().status, 'hydrating');
  });

  it('a storage event after the choice in another tab closes the question here', async () => {
    const t = twoTabs();
    putLocal(t.storage, 'l1', record({ seen: ['x'] }));
    t.a.signIn(U1);
    t.b.signIn(U1);
    t.a.choose(false);
    t.b.accountChanged();
    assert.notEqual(t.b.getState().status, 'needs_choice');
    await t.a.settled();
    await t.b.settled();
    assert.equal(getLocal(t.storage, 'l1'), null);
    // Another learner signed in there: this tab stops without clearing or asking.
    const u = twoTabs();
    putLocal(u.storage, 'l1', record({ seen: ['x'] }));
    u.a.signIn(U1);
    setAccount(u.storage, U2, '?');
    u.a.accountChanged();
    assert.deepEqual(u.a.getState(), { status: 'off', userId: null });
    assert.deepEqual(getLocal(u.storage, 'l1').seen, ['x']);
  });

  it('a GET answered before a delete in another tab does not bring the records or the old epoch back', async () => {
    const t = twoTabs({ epoch: E1, rows: [row('l1', record({ seen: ['old'] }))] });
    setAccount(t.storage, U1, E1);
    t.a.signIn(U1);
    await t.a.settled();
    const before = { epoch: E1, records: [...t.api.server.rows.values()].map((r) => JSON.parse(JSON.stringify(r))) };
    let release;
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    t.api.script('get', { hold, respond: () => before });
    t.b.signIn(U1);
    await settle();
    assert.deepEqual(await t.a.deleteAll(), { ok: true, scope: 'account' });
    release();
    await t.b.settled();
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(account(t.storage).epoch, t.api.server.epoch);
    assert.equal(t.api.gets().length, 3);
    assert.equal(t.api.server.rows.size, 0);
  });

  it('a PUT answered after a delete in another tab is dropped, and nothing deleted is uploaded later', async () => {
    const t = twoTabs({ epoch: E1 });
    setAccount(t.storage, U1, E1);
    t.a.signIn(U1);
    t.b.signIn(U1);
    await t.a.settled();
    await t.b.settled();
    putLocal(t.storage, 'l1', record({ seen: ['old'], updatedAt: iso(1) }));
    t.b.noteLocalWrite(COURSE, 'l1');
    let release;
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    // The PUT commits before the DELETE, but its answer arrives after it.
    t.api.script('put', {
      hold,
      respond: (body) => ({ epoch: E1, records: body.records.map((r) => ({ ...r, pct: 10, state: 'in_progress' })), rejected: [] }),
    });
    t.b.flushOnHide();
    await settle();
    await t.a.deleteAll();
    release();
    await settle();
    await t.b.settled();
    assert.equal(getLocal(t.storage, 'l1'), null);
    // Tab A's next page load (same epoch) has nothing to upload.
    const next = createProgressSync({ storage: t.storage, api: t.api, isSyncable, now: t.clock.now, timers: t.clock.timers });
    next.signIn(U1);
    await next.settled();
    await t.clock.advance(60_000);
    assert.equal(t.api.server.rows.size, 0);
  });

  it('a tab that hears of the logout late (frozen in the background) does not make records written since the learner\'s', async () => {
    const t = twoTabs();
    setAccount(t.storage, U1, null);
    t.a.signIn(U1);
    t.b.signIn(U1);
    await t.a.settled();
    await t.b.settled();
    putLocal(t.storage, 'l1', record({ seen: ['u1'], updatedAt: iso(1) }));
    t.b.noteLocalWrite(COURSE, 'l1');
    // A logs out in tab B while offline: l1 waits for A.
    t.api.script('put', { error: Object.assign(new Error('offline'), { status: 0 }) });
    await t.b.signOut();
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null, loggedOut: true });
    assert.equal(marker(t.storage, 'l1'), iso(1));
    // Someone without a primary session studies l3 and changes A's l1.
    putLocal(t.storage, 'l3', record({ seen: ['other'], updatedAt: iso(31) }));
    putLocal(t.storage, 'l1', record({ seen: ['u1', 'other'], updatedAt: iso(32) }));
    // Tab A gets its SIGNED_OUT only now, and a late logout there changes nothing either.
    t.a.stop();
    await t.a.signOut();
    assert.equal(marker(t.storage, 'l3'), null);
    assert.equal(marker(t.storage, 'l1'), iso(1));

    const next = createProgressSync({ storage: t.storage, api: t.api, isSyncable, now: t.clock.now, timers: t.clock.timers });
    next.signIn(U1);
    assert.equal(next.getState().status, 'needs_choice');
    await t.clock.advance(60_000);
    assert.ok(!t.api.server.rows.has(`${COURSE}:l3`));
    assert.ok(!t.api.server.rows.has(`${COURSE}:l1`));
  });

  it('a PUT answered after a logout in another tab does not write cleared records back', async () => {
    const t = twoTabs();
    setAccount(t.storage, U1, null);
    t.a.signIn(U1);
    t.b.signIn(U1);
    await t.a.settled();
    await t.b.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    putLocal(t.storage, 'l2', record({ seen: ['c1'], updatedAt: iso(1) }));
    t.a.noteLocalWrite(COURSE, 'l1');
    t.a.noteLocalWrite(COURSE, 'l2');
    // Tab A's page-hide upload is slow.
    const releaseA = t.api.hold('put');
    t.a.flushOnHide();
    await settle();
    // A logs out in tab B; B's upload goes through, but l2 changes while it runs, so l2 waits.
    const releaseB = t.api.hold('put');
    const out = t.b.signOut();
    await settle();
    putLocal(t.storage, 'l2', record({ seen: ['c1', 'c2'], updatedAt: iso(2) }));
    t.b.noteLocalWrite(COURSE, 'l2');
    releaseB();
    await out;
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: null, loggedOut: true });
    // Tab A's answer arrives after the logout: dropped.
    releaseA();
    await t.a.settled();
    await settle();
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(marker(t.storage, 'l2'), iso(2));
    assert.equal(t.a.getState().status, 'stopped');
  });

  it('a page that opens after the session ended marks the account left before anyone else writes', async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, null);
    // A closed the browser without a logout; A's record was never uploaded.
    putLocal(storage, 'l1', record({ seen: ['a1'], updatedAt: iso(1) }));
    const t = setup({ storage });
    // A's session ended while no tab was open: this page hears of no session at all.
    t.sync.stop();
    // No pending marker: nothing this browser knew to be unsent (the sign-in view counts none).
    assert.deepEqual(account(storage), { userId: U1, epoch: null, loggedOut: true, unsent: [] });
    assert.equal(marker(storage, 'l1'), iso(1));
    // A second page load changes nothing more.
    t.sync.stop();
    assert.equal(marker(storage, 'l1'), iso(1));
    // Someone without a primary session studies l2; then A signs in.
    putLocal(storage, 'l2', record({ seen: ['other'], updatedAt: iso(20) }));
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'needs_choice');
    await t.clock.advance(60_000);
    assert.equal(t.api.puts().length, 0);
    t.sync.choose(false);
    await t.sync.settled();
    assert.equal(getLocal(storage, 'l2'), null);
    assert.deepEqual(t.api.puts().map((call) => call.body.records.map((r) => r.lessonId)), [['l1']]);
  });

  it('a page that opens after the session ended, with nobody else studying: A is not asked', async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, null);
    putLocal(storage, 'l1', record({ seen: ['a1'], updatedAt: iso(1) }));
    const t = setup({ storage });
    t.sync.stop();
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'hydrating');
    await t.sync.settled();
    assert.deepEqual(t.api.puts().map((call) => call.body.records.map((r) => r.lessonId)), [['l1']]);
  });

  it('storage that refuses the account stops sync instead of loading again and again', async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, '?');
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === SYNC_ACCOUNT_KEY) throw new Error('QuotaExceededError');
      setItem(key, value);
    };
    const t = setup({ storage, epoch: E1 });
    putLocal(storage, 'l1', record({ seen: ['b1'] }));
    t.sync.signIn(U1);
    await t.sync.settled();
    await t.clock.advance(600_000);
    assert.equal(t.sync.getState().status, 'stopped');
    assert.equal(t.api.gets().length, 1);
    assert.equal(t.api.puts().length, 0);
  });

  it("an open reader drops its record when another tab deleted before this tab knew the epoch ('?')", () => {
    const acc = (userId, epoch) => JSON.stringify({ userId, epoch });
    const held = record({ seen: ['b1'], answers: { 'q/q1': answer(1, true, ['a']) } });
    const merged = record({ seen: ['b1', 's1'], answers: { 'q/q1': answer(1, true, ['a']) } });
    // The first hydrate only adds: keep.
    assert.equal(readerMustDrop(acc(U1, '?'), acc(U1, E1), merged, held), false);
    // The record was cleared (a delete in another tab): drop.
    assert.equal(readerMustDrop(acc(U1, '?'), acc(U1, E2), record(), held), true);
    // Known epochs and other learners follow isAccountSwitch.
    assert.equal(readerMustDrop(acc(U1, E1), acc(U1, E1), record(), held), false);
    assert.equal(readerMustDrop(acc(U1, E1), acc(U1, E2), merged, held), true);
    assert.equal(readerMustDrop(acc(U1, '?'), acc(U2, '?'), merged, held), true);
    assert.equal(readerMustDrop(acc(U1, E1), null, merged, held), true);
  });
});

describe('progress sync: account deletion (Phase 4 design §5.10–5.11)', () => {
  const EVENTS = JSON.stringify([{ id: 'e1', type: 'lesson_start', title: { en: 'Old', jp: '古い' } }]);
  const LEGACY = JSON.stringify({ blender: { courseId: 'blender', completedStages: ['s1'], completedSteps: {} } });

  it('forget() clears every lesson record, marker, the account, rp:lastLesson, learning events and legacy progress, and never uploads', async () => {
    const t = syncedSetup({ epoch: E1 });
    t.api.server.epoch = E1;
    t.storage.setItem(LEARNING_EVENTS_KEY, EVENTS);
    t.storage.setItem(LEGACY_PROGRESS_KEY, LEGACY);
    t.storage.setItem('rp:reader-settings', '{}');
    t.storage.setItem('playerData', '{"level":3}');
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    putLocal(t.storage, 'l2', record({ seen: ['c1'], updatedAt: iso(1) }));
    t.storage.setItem(LAST_LESSON_KEY, JSON.stringify({ courseSlug: COURSE, lessonId: 'l1', title: 'x', pct: 10, at: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    t.sync.noteLocalWrite(COURSE, 'l2');
    assert.equal(marker(t.storage, 'l1'), iso(1));
    const accountEvents = t.events.account;
    t.sync.forget();
    assert.deepEqual([...t.storage.map.keys()].sort(), ['playerData', 'rp:reader-settings']);
    assert.deepEqual(t.sync.getState(), { status: 'off', userId: null });
    assert.ok(t.events.account > accountEvents, 'readers hear the account change');
    // The scheduled flush, a page hide and a later refresh upload nothing.
    t.sync.flushOnHide();
    t.sync.refresh();
    await t.clock.advance(10 * 60_000);
    assert.equal(t.api.puts().length, 0);
  });

  it('forget() during an upload: the answer writes nothing back', async () => {
    const t = syncedSetup({ epoch: E1 });
    t.api.server.epoch = E1;
    t.sync.signIn(U1);
    await t.sync.settled();
    putLocal(t.storage, 'l1', record({ seen: ['b1'], updatedAt: iso(1) }));
    t.sync.noteLocalWrite(COURSE, 'l1');
    const release = t.api.hold('put');
    await t.clock.advance(6_000);
    assert.equal(t.api.puts().length, 1);
    t.sync.forget();
    release();
    await t.clock.advance(60_000);
    assert.equal(getLocal(t.storage, 'l1'), null);
    assert.equal(account(t.storage), null);
    assert.equal(t.api.puts().length, 1);
  });

  it('a changed known epoch on a re-opened account (restarted) also clears learning events and legacy progress; a plain reset keeps them', async () => {
    for (const restarted of [true, false]) {
      const t = syncedSetup({ epoch: E1 });
      t.api.server.epoch = E2;
      t.api.server.restarted = restarted;
      putLocal(t.storage, 'l1', record({ seen: ['b1'] }));
      t.storage.setItem(LEARNING_EVENTS_KEY, EVENTS);
      t.storage.setItem(LEGACY_PROGRESS_KEY, LEGACY);
      t.sync.signIn(U1);
      await t.sync.settled();
      assert.equal(getLocal(t.storage, 'l1'), null, `restarted ${restarted}: records cleared`);
      assert.deepEqual(account(t.storage), { userId: U1, epoch: E2 });
      assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), restarted ? null : EVENTS, `restarted ${restarted}: learning events`);
      assert.equal(t.storage.getItem(LEGACY_PROGRESS_KEY), restarted ? null : LEGACY, `restarted ${restarted}: legacy progress`);
      assert.equal(t.api.puts().length, 0);
    }
  });

  it("a '?' device after \"Add\" on a re-opened account keeps the adopted records and events, and uploads them", async () => {
    const t = setup({ epoch: E2 });
    t.api.server.restarted = true;
    putLocal(t.storage, 'l1', record({ seen: ['b1', 'b2'] }));
    t.storage.setItem(LEARNING_EVENTS_KEY, EVENTS);
    t.storage.setItem(LEGACY_PROGRESS_KEY, LEGACY);
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'needs_choice');
    assert.equal(t.sync.choose(true), true);
    await t.sync.settled();
    assert.deepEqual(getLocal(t.storage, 'l1').seen, ['b1', 'b2']);
    assert.equal(t.storage.getItem(LEARNING_EVENTS_KEY), EVENTS);
    assert.equal(t.storage.getItem(LEGACY_PROGRESS_KEY), LEGACY);
    assert.deepEqual(account(t.storage), { userId: U1, epoch: E2 });
    assert.equal(t.api.puts().length, 1);
    assert.equal(t.api.puts()[0].body.epoch, E2);
  });

  it("a '?' device with fresh pending records keeps them on a re-opened account", async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, '?');
    const t = setup({ storage, epoch: E2 });
    t.api.server.restarted = true;
    putLocal(storage, 'l1', record({ seen: ['b1'], updatedAt: iso(-1) }));
    storage.setItem(pendingKey(COURSE, 'l1'), iso(-1));
    storage.setItem(LEARNING_EVENTS_KEY, EVENTS);
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.deepEqual(getLocal(storage, 'l1').seen, ['b1']);
    assert.equal(storage.getItem(LEARNING_EVENTS_KEY), EVENTS);
    assert.equal(t.api.puts().length, 1);
    assert.equal(marker(storage, 'l1'), null);
  });

  it("whenKnown(): 'known' after a successful GET, 'unknown' after the last failed retry, with no timer of its own", async () => {
    const ok = syncedSetup();
    ok.sync.signIn(U1);
    const known = ok.sync.whenKnown();
    await ok.sync.settled();
    assert.equal(await known, 'known');
    assert.equal(await ok.sync.whenKnown(), 'known');

    const t = syncedSetup();
    for (let i = 0; i <= SYNC_TIMING.getRetries; i += 1) t.api.script('get', { error: Object.assign(new Error('x'), { status: 503 }) });
    let timersSet = 0;
    const setTimeoutOf = t.clock.timers.setTimeout;
    t.clock.timers.setTimeout = (fn, ms) => {
      timersSet += 1;
      return setTimeoutOf(fn, ms);
    };
    t.sync.signIn(U1);
    await settle();
    const before = timersSet;
    let answer = null;
    void t.sync.whenKnown().then((value) => {
      answer = value;
    });
    await settle();
    assert.equal(timersSet, before, 'whenKnown sets no timer');
    assert.equal(answer, null, 'still waiting while the GET retries');
    await t.clock.advance(60_000);
    assert.equal(t.api.gets().length, 1 + SYNC_TIMING.getRetries);
    assert.equal(t.sync.getState().status, 'offline');
    assert.equal(answer, 'unknown');
    assert.equal(await t.sync.whenKnown(), 'unknown');
  });

  it("whenKnown(): 'unknown' without sync (never signed in, waiting for the choice) and when forget() ends a waiting GET", async () => {
    const off = setup();
    assert.equal(await off.sync.whenKnown(), 'unknown');
    const choice = setup();
    putLocal(choice.storage, 'l1', record({ seen: ['b1'] }));
    choice.sync.signIn(U1);
    assert.equal(choice.sync.getState().status, 'needs_choice');
    assert.equal(await choice.sync.whenKnown(), 'unknown');

    const t = syncedSetup();
    const release = t.api.hold('get');
    t.sync.signIn(U1);
    const waiting = t.sync.whenKnown();
    t.sync.forget();
    assert.equal(await waiting, 'unknown');
    release();
    await t.clock.advance(1_000);
    assert.equal(account(t.storage), null, 'the late GET answer writes no account back');
  });
});

describe('progress sync: the reader guard and ids', () => {
  it('isAccountSwitch: another learner, a logout or a changed known epoch; not the first hydrate', () => {
    const acc = (userId, epoch) => JSON.stringify({ userId, epoch });
    assert.equal(isAccountSwitch(acc(U1, '?'), acc(U1, E1)), false);
    assert.equal(isAccountSwitch(acc(U1, E1), acc(U1, E1)), false);
    assert.equal(isAccountSwitch(null, null), false);
    assert.equal(isAccountSwitch(acc(U1, E1), acc(U1, E2)), true);
    assert.equal(isAccountSwitch(acc(U1, null), acc(U1, E1)), true);
    assert.equal(isAccountSwitch(acc(U1, E1), acc(U2, '?')), true);
    assert.equal(isAccountSwitch(acc(U1, E1), null), true);
    assert.equal(isAccountSwitch(null, acc(U1, '?')), true);
    assert.equal(parseSyncAccount('{"userId":""}'), null);
    assert.deepEqual(parseSyncAccount('{"userId":"u","epoch":5}'), { userId: 'u', epoch: '?' });
    // The learner left with records pending: nobody is signed in, so an open reader drops its record.
    const left = JSON.stringify({ userId: U1, epoch: E1, loggedOut: true });
    assert.deepEqual(parseSyncAccount(left), { userId: U1, epoch: E1, loggedOut: true });
    assert.deepEqual(parseSyncAccount('{"userId":"u","epoch":null,"loggedOut":"yes"}'), { userId: 'u', epoch: null });
    assert.equal(isAccountSwitch(acc(U1, E1), left), true);
    assert.equal(isAccountSwitch(left, acc(U1, E1)), true);
    assert.equal(isSignedOutAccount(left), true);
    assert.equal(isSignedOutAccount(null), true);
    assert.equal(isSignedOutAccount(acc(U1, E1)), false);
  });

  it('clears the keys services/progressService.ts keeps learning events and legacy course progress under', () => {
    const text = read('services/progressService.ts');
    assert.match(text, new RegExp(`const STORAGE_KEY = '${LEGACY_PROGRESS_KEY}';`));
    assert.match(text, new RegExp(`const EVENTS_KEY = '${LEARNING_EVENTS_KEY}';`));
  });

  it('uses the server id rule and keys outside the rp:progress: record scan', () => {
    assert.equal(SAFE_SLUG.source, SERVER_SAFE_SLUG.source);
    assert.equal(MAX_SLUG_LENGTH, SERVER_MAX_SLUG);
    assert.ok(!SYNC_ACCOUNT_KEY.startsWith('rp:progress:'));
    assert.ok(!pendingKey(COURSE, 'l1').startsWith('rp:progress:'));
  });
});

describe('progress sync: wiring (static)', () => {
  const importsOf = (text) => ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);

  it('the core imports only progressStore.ts and shared/lesson (explicit extensions), with no import.meta', () => {
    const text = read('components/lesson/progressSync.ts');
    for (const spec of importsOf(text)) {
      assert.match(spec, /^(\.\/progressStore\.ts|\.\.\/\.\.\/shared\/lesson\/[a-zA-Z]+\.js)$/, spec);
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /import\.meta/);
    assert.doesNotMatch(code, /\b(window|document)\./);
  });

  it('AuthContext holds the legacy progress hydrate while the adoption choice is open, and until this page load\'s GET settled', () => {
    const auth = read('context/AuthContext.tsx');
    const hydrate = auth.slice(auth.indexOf('const hydrateUserData'), auth.indexOf('export const AuthProvider'));
    // Phase 4 (design §5.10): local-only legacy progress is pushed only after a successful GET.
    // Phase 5: only the synced learner's own legacy entries are kept and pushed ("Add" adopts unowned ones).
    assert.match(hydrate, /progressChoicePending\(\) \? Promise\.resolve\(\) : whenAccountKnown\(\)\.then\(\(s\) => hydrateFromApi\(\{ pushLocal: s === 'known', learnerId: syncedLearnerId\(\) \}\)\)/);
    const client = read('components/lesson/progressSyncClient.ts');
    assert.match(client, /if \(applied\) void whenAccountKnown\(\)\.then\(\(s\) => hydrateFromApi\(\{ pushLocal: s === 'known', learnerId: syncedLearnerId\(\), adoptUnowned: add \}\)\)/);
  });

  it('AuthContext runs the owner rule for the primary session before setUser, and logout clears after the AI data line', () => {
    const text = read('context/AuthContext.tsx');
    const handle = text.slice(text.indexOf('const handleSession'), text.indexOf('// Get initial sessions'));
    assert.ok(handle.indexOf("client === 'primary' && session.access_token) signInProgressSync(session.user.id, session.access_token)") > 0);
    assert.ok(handle.indexOf('signInProgressSync(') < handle.indexOf('setUser(u)'));
    assert.match(text, /getSession\(\)\.then\(\(\{ data: \{ session \} \}\) => \{\s*if \(session\?\.user\) handleSession\(session, 'primary'\)/);
    assert.match(text, /handleSession\(session, 'nexloom'\)/);
    const logout = text.slice(text.indexOf('const logout'));
    const aiLine = logout.indexOf('clearSharedDeviceAiData({ keepDrafts: user?.isGuest === true })');
    const progressLine = logout.indexOf('await signOutProgressSync()');
    const remoteSignOut = logout.indexOf('auth.signOut()');
    assert.ok(aiLine >= 0 && aiLine < progressLine && progressLine < remoteSignOut);
    // Phase 5 (G12, owner O4): the unsaved-learning question comes first; "stay signed in" returns
    // before anything is cleared.
    const gate = logout.indexOf('if (!(await confirmUnsavedLearning(options))) return false;');
    assert.ok(gate >= 0 && gate < aiLine, 'the logout gate runs before the AI data is cleared');
  });

  it('the browser wiring sends requests only for the learner whose session it is, and hears choices made in other tabs', () => {
    const text = read('components/lesson/progressSyncClient.ts');
    assert.match(text, /get: \(\) => asSyncedLearner\(getLessonProgressRecords\)/);
    assert.match(text, /put: \(body, \{ keepalive \}\) => putProgress\(body, keepalive\)/);
    // Only the page-hide upload skips the session check, with the token of this learner's own session.
    assert.match(text, /if \(keepalive && auth && auth\.userId === instance\?\.getState\(\)\.userId\) \{\s*return putLessonProgressRecords\(body, \{ keepalive: true, token: auth\.token \}\);\s*\}\s*return asSyncedLearner\(\(\) => putLessonProgressRecords\(body, \{ keepalive \}\)\);/);
    assert.match(text, /del: \(\) => asSyncedLearner\(deleteLessonProgressRecords\)/);
    // Phase 5 (G3 in lessonProgressSyncClient.test.js): the reset goes through the same session check.
    assert.match(text, /resetLesson: \(body\) => asSyncedLearner\(\(\) => resetLessonProgressRecord\(body\)\)/);
    assert.match(text, /if \(!expected \|\| \(current !== null && current !== expected\)\)/);
    assert.match(text, /event\.key === SYNC_ACCOUNT_KEY \|\| event\.key === null\) sync\.accountChanged\(\)/);
  });

  it('the reader drops its record on an account switch and merges server data without lesson events', () => {
    const text = read('components/lesson/useLessonProgress.ts');
    // Phase 5: the reader writes with its generation stamp (writeGen).
    assert.match(text, /if \(dropIfAccountSwitched\(\)\) return;\s*const record = withSummary\(progress, \{ pct, state \}\);\s*if \(writeProgress\(courseSlug, lesson\.id, record, undefined, writeGen\(\)\)\) persisted\.current = record;/);
    assert.match(text, /readerMustDrop\(before, now, stored, persisted\.current\)/);
    assert.match(text, /detail\.source !== 'server'/);
    assert.match(text, /lastState\.current = lessonState\(lesson, merged\)/);
  });

  it('Phase 5: the reader follows the lesson\'s generation (reset events, other tabs\' writes of this lesson) and re-observes after a drop', () => {
    const text = read('components/lesson/useLessonProgress.ts');
    // A reset of this lesson restarts the reader (progressSync.ts takeIn sends reset: true).
    assert.match(text, /if \(dropIfAccountSwitched\(\{ reset: detail\.reset === true \}\)\) return;/);
    // Another tab wrote this lesson: a write that took the reader's stamp off is written over (G22).
    assert.match(text, /else if \(event\.key === key\) dropIfAccountSwitched\(\{ rewriteForeign: true \}\);/);
    assert.match(text, /const change = readerGenChange\(loadedGen\.current, raw, persisted\.current\);/);
    assert.match(text, /if \(change === 'foreign' && rewriteForeign\) \{\s*dirty\.current = true;/);
    // A lesson never started over (known(null)): another tab's unstamped write is merged in and
    // written back stamped, wherever the check runs (also right before the reader's own write).
    assert.match(text, /if \(change === 'merge' && raw !== mergedRaw\.current\) \{\s*(\/\/[^\n]*\s*)*mergedRaw\.current = raw;/);
    assert.match(text, /const merged = \{ \.\.\.mergeProgress\(stored, prev\) \};\s*lastState\.current = lessonState\(lesson, merged\);\s*dirty\.current = true;\s*return merged;/);
    assert.match(text, /setServerMerges\(\(n\) => n \+ 1\);\s*return true;\s*\}\s*if \(change === 'foreign' && rewriteForeign\)/);
    // A drop replaces the record: the seen observer reads the new one (G16 keys the sections with drops).
    assert.match(text, /\}, \[articleRef, container, lesson, update, drops\]\);/);
    assert.match(text, /setDrops\(\(n\) => n \+ 1\);/);
    assert.match(text, /loadedGen\.current = readerStartGen\(raw\);/);
  });
});
