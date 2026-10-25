// Lesson generation stamps (Phase 5, design p5 §2.3, §2.5): the pure helpers of
// components/lesson/progressStore.ts (lessonGenOf, keepsLocal, bornSurvives, stampedRecord,
// writeProgress with a stamp) and components/lesson/progressSync.ts (serverGenOf, readerStartGen,
// readerGenChange, leftRecordCount: also after a session that ended without a logout, only what was
// unsent then), plus two scenarios that run the core and the reader's
// decisions over one memory storage: G22 (an old bundle took the stamp off: the reader writes its
// record again, stamped, and it saves), the same for a lesson never started over (the old bundle's
// answers are merged in, not reverted; a reset meanwhile still drops them) and G31 (a reset always
// restarts an open reader, whatever the device clock says).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_ACCOUNT_KEY,
  SYNC_TIMING,
  leftRecordCount,
  parseSyncAccount,
  pendingKey,
  readerGenChange,
  readerStartGen,
  serverGenOf,
} from '../../components/lesson/progressSync.ts';
import {
  bornSurvives,
  keepsLocal,
  lessonGenOf,
  progressKey,
  readLessonGen,
  sameLessonGen,
  stampedRecord,
  writeProgress,
} from '../../components/lesson/progressStore.ts';
import { parseProgress } from '../../shared/lesson/progress.js';
import { mergeProgress } from '../../shared/lesson/progressMerge.js';
import { COURSE, iso, isSyncable, memoryStorage, setAccount, setup, twoTabs } from './helpers/progressSyncFakes.js';

const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const X1 = '33333333-3333-4333-8333-333333333333';
const X2 = '44444444-4444-4444-8444-444444444444';
const record = (patch = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: iso(-60), ...patch });
const raw = (progress, lessonGen) => JSON.stringify(lessonGen === undefined ? progress : { ...progress, lessonGen });
const known = (epoch, resetAt = null) => ({ kind: 'known', epoch, resetAt });
const born = (bornAt) => ({ kind: 'born', bornAt });
const UNKNOWN = { kind: 'unknown' };

describe('lessonGenOf: the stamp of a stored record', () => {
  it('reads known and born stamps (epochs in lower case)', () => {
    assert.deepEqual(lessonGenOf(raw(record(), { epoch: X1.toUpperCase(), resetAt: iso(0) })), known(X1, iso(0)));
    assert.deepEqual(lessonGenOf(raw(record(), { epoch: null, resetAt: null })), known(null, null));
    assert.deepEqual(lessonGenOf(raw(record(), { epoch: null })), known(null, null));
    assert.deepEqual(lessonGenOf(raw(record(), { bornAt: iso(3) })), born(iso(3)));
  });

  it('anything else is unknown: no stamp, null, bad JSON, a bad epoch or time, both kinds at once', () => {
    for (const value of [
      null,
      undefined,
      '',
      '{',
      '[]',
      raw(record()),
      raw(record(), null),
      raw(record(), 'x'),
      raw(record(), {}),
      raw(record(), { epoch: 'not-a-uuid' }),
      raw(record(), { epoch: 5 }),
      raw(record(), { epoch: X1, resetAt: 'yesterday' }),
      raw(record(), { bornAt: 'soon' }),
      raw(record(), { bornAt: null }),
      raw(record(), { epoch: X1, bornAt: iso(1) }),
    ]) {
      assert.deepEqual(lessonGenOf(value), UNKNOWN, String(value));
    }
  });

  it('readLessonGen reads storage; sameLessonGen compares kind and fields', () => {
    const storage = memoryStorage();
    storage.setItem(progressKey(COURSE, 'l1'), raw(record(), { epoch: X1, resetAt: iso(0) }));
    assert.deepEqual(readLessonGen(COURSE, 'l1', storage), known(X1, iso(0)));
    assert.deepEqual(readLessonGen(COURSE, 'l2', storage), UNKNOWN);
    assert.deepEqual(readLessonGen(COURSE, 'l1', null), UNKNOWN);
    assert.equal(sameLessonGen(known(X1, iso(0)), known(X1, iso(0))), true);
    assert.equal(sameLessonGen(known(X1, iso(0)), known(X1, iso(1))), false);
    assert.equal(sameLessonGen(known(null), known(X1)), false);
    assert.equal(sameLessonGen(born(iso(1)), born(iso(1))), true);
    assert.equal(sameLessonGen(born(iso(1)), born(iso(2))), false);
    assert.equal(sameLessonGen(UNKNOWN, UNKNOWN), true);
    assert.equal(sameLessonGen(UNKNOWN, known(null)), false);
  });

  it('stampedRecord / writeProgress: known and born go into lessonGen; no stamp stores the record plain; parseProgress drops it', () => {
    const storage = memoryStorage();
    const progress = record({ seen: ['b1'] });
    assert.equal(writeProgress(COURSE, 'l1', progress, storage, known(X1, iso(0))), true);
    assert.deepEqual(JSON.parse(storage.getItem(progressKey(COURSE, 'l1'))).lessonGen, { epoch: X1, resetAt: iso(0) });
    writeProgress(COURSE, 'l1', progress, storage, born(iso(2)));
    assert.deepEqual(JSON.parse(storage.getItem(progressKey(COURSE, 'l1'))).lessonGen, { bornAt: iso(2) });
    writeProgress(COURSE, 'l1', { ...progress, lessonGen: { epoch: X1 } }, storage);
    assert.equal('lessonGen' in JSON.parse(storage.getItem(progressKey(COURSE, 'l1'))), false, 'an unknown stamp is never carried along');
    writeProgress(COURSE, 'l1', progress, storage, UNKNOWN);
    assert.equal(storage.getItem(progressKey(COURSE, 'l1')), JSON.stringify(progress));
    assert.deepEqual(parseProgress(raw(progress, { epoch: X1 })), parseProgress(JSON.stringify(progress)));
    assert.deepEqual(stampedRecord(progress, known(null)), { ...progress, lessonGen: { epoch: null, resetAt: null } });
  });
});

describe('keepsLocal and bornSurvives: what the sync core keeps', () => {
  const server = (epoch, resetAt = null) => ({ epoch, resetAt });
  const cases = [
    ['known, same generation', known(X1), server(X1, iso(0)), true],
    ['known, another generation', known(X1), server(X2, iso(0)), false],
    ['known never-reset, the lesson was reset', known(null), server(X1, iso(0)), false],
    ['known never-reset, still never reset', known(null), server(null), true],
    ['born, never reset', born(iso(-100)), server(null), true],
    ['born after the reset', born(iso(1)), server(X1, iso(0)), true],
    ['born at the very time of the reset', born(iso(0)), server(X1, iso(0)), false],
    ['born before the reset', born(iso(-1)), server(X1, iso(0)), false],
    ['born, the reset time unknown', born(iso(1)), server(X1, null), false],
    ['born at an unparsable time', born('later'), server(X1, iso(0)), false],
    ['unknown (legacy), never reset', UNKNOWN, server(null), true],
    ['unknown (legacy), reset', UNKNOWN, server(X1, iso(0)), false],
  ];
  for (const [name, local, srv, keep] of cases) {
    it(name, () => {
      assert.equal(keepsLocal(local, srv), keep);
      if (local.kind === 'born') assert.equal(bornSurvives(local.bornAt, srv), keep);
    });
  }
});

describe('serverGenOf: a generation only when the answer names one', () => {
  it('its own lessonEpoch, null or a uuid; resetAt when it is a date', () => {
    assert.deepEqual(serverGenOf({ lessonEpoch: X1.toUpperCase(), lessonResetAt: iso(0) }), { epoch: X1, resetAt: iso(0) });
    assert.deepEqual(serverGenOf({ lessonEpoch: null, lessonResetAt: null }), { epoch: null, resetAt: null });
    assert.deepEqual(serverGenOf({ lessonEpoch: X1, lessonResetAt: 'soon' }), { epoch: X1, resetAt: null });
    for (const value of [null, undefined, 'x', [], {}, { lessonResetAt: iso(0) }, { lessonEpoch: 'abc' }, { lessonEpoch: 7 }, Object.create({ lessonEpoch: null })]) {
      assert.equal(serverGenOf(value), null, JSON.stringify(value));
    }
  });
});

describe('the open reader: readerStartGen and readerGenChange', () => {
  it('readerStartGen: absent or activity-free unknown → born (time pending); legacy content → unknown; stamped → its stamp', () => {
    assert.deepEqual(readerStartGen(null), { kind: 'born', bornAt: null });
    assert.deepEqual(readerStartGen(raw(record())), { kind: 'born', bornAt: null });
    assert.deepEqual(readerStartGen(raw(record({ seen: ['b1'] }))), UNKNOWN);
    assert.deepEqual(readerStartGen(raw(record({ seen: ['b1'] }), { epoch: X1, resetAt: iso(0) })), known(X1, iso(0)));
    assert.deepEqual(readerStartGen(raw(record(), { bornAt: iso(2) })), born(iso(2)));
  });

  const persisted = record({ seen: ['mine'] });
  const kept = raw(record({ seen: ['mine', 'server'] }), { epoch: X1, resetAt: iso(0) });
  const tombstone = raw(record({ updatedAt: new Date(0).toISOString() }), { epoch: X2, resetAt: iso(5) });
  const cases = [
    ['known, same stamp stored', known(X1), kept, 'none'],
    ['known, another generation stored', known(X1), tombstone, 'restart'],
    ['known never-reset, a reset stored', known(null), raw(record(), { epoch: X1, resetAt: iso(0) }), 'restart'],
    ['born and nothing written yet: take the stamp', { kind: 'born', bornAt: null }, tombstone, 'adopt'],
    ['born: the sync kept and stamped it (covers what was written)', born(iso(1)), kept, 'adopt'],
    ['born: the sync dropped it for the reset', born(iso(1)), tombstone, 'restart'],
    ['legacy: kept and stamped', UNKNOWN, kept, 'adopt'],
    ['legacy: dropped', UNKNOWN, tombstone, 'restart'],
    ['known, the stamp was taken off (an old bundle)', known(X1), raw(record({ seen: ['mine'] })), 'foreign'],
    ['known never started over, the stamp was taken off (an old bundle): merged in', known(null), raw(record({ seen: ['x'] })), 'merge'],
    ['known never started over, a born write of another tab: merged in', known(null), raw(record({ seen: ['x'] }), { bornAt: iso(1) }), 'merge'],
    ['known, the record is gone', known(X1), null, 'none'],
    ['born, an unstamped write (last writer wins)', born(iso(1)), raw(record({ seen: ['x'] })), 'none'],
    ['unknown, an unstamped write', UNKNOWN, raw(record({ seen: ['x'] })), 'none'],
  ];
  for (const [name, loaded, stored, change] of cases) {
    it(`readerGenChange: ${name} → ${change}`, () => {
      assert.equal(readerGenChange(loaded, stored, persisted), change);
    });
  }

  it('G31: a born reader on a device whose clock runs ahead still restarts on the reset', () => {
    // bornAt is "after" the reset by this device's clock, but the stored record is the emptied one
    // of the new generation: it does not hold what the reader wrote, so the reader restarts.
    const ahead = born('2099-01-01T00:00:00.000Z');
    assert.equal(readerGenChange(ahead, tombstone, persisted), 'restart');
    assert.equal(readerGenChange({ kind: 'born', bornAt: '2099-01-01T00:00:00.000Z' }, kept, persisted), 'adopt');
  });

  it('a born or legacy reader with self-ratings adopts only a record that holds them: ratings from before a reset never come back', () => {
    const rated = record({ seen: ['mine'], ratings: { o1: 2 } });
    // Started over and redone on another device without rating o1: the new generation's record
    // holds every seen block, answer and check of the reader, not its rating.
    const redone = raw(record({ seen: ['mine', 'other'] }), { epoch: X2, resetAt: iso(5) });
    assert.equal(readerGenChange(born(iso(1)), redone, rated), 'restart');
    assert.equal(readerGenChange(UNKNOWN, redone, rated), 'restart');
    // A record the core kept merges the reader's ratings in.
    const keptRated = raw(record({ seen: ['mine', 'server'], ratings: { o1: 2 } }), { epoch: X1, resetAt: iso(0) });
    assert.equal(readerGenChange(born(iso(1)), keptRated, rated), 'adopt');
    assert.equal(readerGenChange(UNKNOWN, keptRated, rated), 'adopt');
  });
});

describe('leftRecordCount: what a learner who left still has here', () => {
  it('counts markers whose record still names the marker, only while the account is loggedOut', () => {
    const storage = memoryStorage();
    const put = (lessonId, progress) => storage.setItem(progressKey(COURSE, lessonId), JSON.stringify(progress));
    put('l1', record({ seen: ['a'], updatedAt: iso(1) }));
    storage.setItem(pendingKey(COURSE, 'l1'), iso(1));
    put('l2', record({ seen: ['b'], updatedAt: iso(2) }));
    storage.setItem(pendingKey(COURSE, 'l2'), iso(1)); // changed since they left
    storage.setItem(pendingKey(COURSE, 'l3'), iso(1)); // no record
    put('l4', record({ seen: ['d'], updatedAt: iso(4) })); // no marker
    assert.equal(leftRecordCount(storage), 0, 'nobody left');
    storage.setItem(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: U1, epoch: null }));
    assert.equal(leftRecordCount(storage), 0, 'still signed in');
    storage.setItem(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: U1, epoch: null, loggedOut: true }));
    assert.equal(leftRecordCount(storage), 1);
    assert.equal(leftRecordCount(null), 0);
    const broken = { getItem() { throw new Error('blocked'); }, key: () => null, length: 0 };
    assert.equal(leftRecordCount(broken), 0);
  });

  it('lessons the server does not store are not counted (they never save)', () => {
    const storage = memoryStorage();
    for (const lessonId of ['l1', 'gone']) {
      storage.setItem(progressKey(COURSE, lessonId), JSON.stringify(record({ seen: ['a'], updatedAt: iso(1) })));
      storage.setItem(pendingKey(COURSE, lessonId), iso(1));
    }
    storage.setItem(SYNC_ACCOUNT_KEY, JSON.stringify({ userId: U1, epoch: null, loggedOut: true }));
    assert.equal(leftRecordCount(storage), 2, 'no catalog given: every marker');
    assert.equal(leftRecordCount(storage, isSyncable), 1);
    assert.equal(leftRecordCount(storage, () => { throw new Error('catalog'); }), 0, 'never throws');
  });

  it('a session that ended without a logout (expiry, logout elsewhere) counts only what was unsent then, not what the server has', async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, null);
    const t = setup({ storage, rows: [{ courseSlug: COURSE, lessonId: 'l1', progress: record({ seen: ['a'], updatedAt: iso(-30) }), pct: 10, state: 'in_progress', updatedAt: iso(-30) }] });
    t.sync.signIn(U1);
    await t.sync.settled();
    assert.equal(storage.getItem(pendingKey(COURSE, 'l1')), null, 'l1 is on the server');
    storage.setItem(progressKey(COURSE, 'l2'), JSON.stringify(record({ seen: ['b'], updatedAt: iso(1) })));
    t.sync.noteLocalWrite(COURSE, 'l2');
    // The session ends before the upload (the auth listener's stop()).
    t.sync.stop();
    // Both records wait for U1 as theirs (the next sign-in asks nothing)…
    assert.equal(storage.getItem(pendingKey(COURSE, 'l1')), iso(-30));
    assert.equal(storage.getItem(pendingKey(COURSE, 'l2')), iso(1));
    // …but only l2 is unsaved.
    assert.equal(leftRecordCount(storage, isSyncable), 1);
    // Another tab's later stop() changes nothing; U1's sign-in takes the account back.
    t.sync.stop();
    assert.equal(leftRecordCount(storage, isSyncable), 1);
    t.sync.signIn(U1);
    assert.equal(t.sync.getState().status, 'hydrating');
    assert.equal(leftRecordCount(storage, isSyncable), 0);
    assert.deepEqual(JSON.parse(storage.getItem(SYNC_ACCOUNT_KEY)), { userId: U1, epoch: null });
  });

  it('a tab that has not heard of the session end yet: what it writes meanwhile is counted too', async () => {
    const t = twoTabs();
    setAccount(t.storage, U1, null);
    t.a.signIn(U1);
    t.b.signIn(U1);
    await t.a.settled();
    await t.b.settled();
    t.storage.setItem(progressKey(COURSE, 'l2'), JSON.stringify(record({ seen: ['a'], updatedAt: iso(1) })));
    t.a.noteLocalWrite(COURSE, 'l2');
    // Tab A hears of the session end first (l2 not uploaded yet).
    t.a.stop();
    assert.equal(leftRecordCount(t.storage, isSyncable), 1);
    // Tab B, still signed in for a moment, writes l1.
    t.storage.setItem(progressKey(COURSE, 'l1'), JSON.stringify(record({ seen: ['b'], updatedAt: iso(2) })));
    t.b.noteLocalWrite(COURSE, 'l1');
    t.b.noteLocalWrite(COURSE, 'l1');
    assert.deepEqual(JSON.parse(t.storage.getItem(SYNC_ACCOUNT_KEY)).unsent, [`${COURSE}:l2`, `${COURSE}:l1`], 'added once');
    assert.equal(leftRecordCount(t.storage, isSyncable), 2);
    t.b.stop();
    assert.equal(leftRecordCount(t.storage, isSyncable), 2);
  });

  it('SyncAccount.unsent is read only with loggedOut, as a bounded list of strings', () => {
    const left = (unsent) => JSON.stringify({ userId: U1, epoch: null, loggedOut: true, unsent });
    assert.deepEqual(parseSyncAccount(left([`${COURSE}:l1`])).unsent, [`${COURSE}:l1`]);
    assert.deepEqual(parseSyncAccount(left([])).unsent, []);
    for (const bad of ['x', null, [1], ['a'.repeat(200)], Array.from({ length: 2_001 }, () => 'c:l')]) {
      assert.equal(parseSyncAccount(left(bad)).unsent, undefined, JSON.stringify(bad).slice(0, 40));
    }
    assert.equal(parseSyncAccount(JSON.stringify({ userId: U1, epoch: null, unsent: ['c:l'] })).unsent, undefined, 'signed in: no list');
  });
});

describe('the core and the reader over one storage', () => {
  it('G22: an unstamped old-bundle write does not stop the new tab\'s later work from saving', async () => {
    const storage = memoryStorage();
    setAccount(storage, U1, null);
    const t = setup({ storage, phase5: true, rows: [{ courseSlug: COURSE, lessonId: 'l1', progress: record({ seen: ['a'], updatedAt: iso(-5) }), pct: 10, state: 'in_progress', updatedAt: iso(-5) }] });
    // The lesson was started over on another device; this page loads it.
    const { gen } = t.api.resetOnServer(COURSE, 'l1', Date.parse(iso(-2)));
    t.sync.signIn(U1);
    await t.clock.advance(1_000);
    const key = progressKey(COURSE, 'l1');
    // The new tab's reader opens it: known(X).
    let loaded = readerStartGen(storage.getItem(key));
    assert.deepEqual(loaded, known(gen.epoch, gen.at));
    let mine = record({ seen: ['n1'], updatedAt: iso(1) });
    writeProgress(COURSE, 'l1', mine, storage, loaded);
    let persisted = mine;
    // An old bundle in another tab writes over it without the stamp.
    storage.setItem(key, JSON.stringify(record({ seen: ['old'], updatedAt: iso(2) })));
    // The new tab's reader hears the storage event: foreign → it writes its own record again, stamped.
    const change = readerGenChange(loaded, storage.getItem(key), persisted);
    assert.equal(change, 'foreign');
    mine = record({ seen: ['n1', 'n2'], updatedAt: iso(3) });
    writeProgress(COURSE, 'l1', mine, storage, loaded);
    persisted = mine;
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(SYNC_TIMING.flushDelayMs);
    const put = t.api.puts().at(-1);
    assert.equal(put.body.records[0].lessonEpoch, gen.epoch, 'the PUT carries the reader\'s generation');
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`).progress.seen, ['n1', 'n2']);
    assert.deepEqual(lessonGenOf(storage.getItem(key)), known(gen.epoch, gen.at));
    loaded = readerStartGen(storage.getItem(key));
    assert.equal(readerGenChange(loaded, storage.getItem(key), persisted), 'none');
  });

  /** A lesson never started over, open in a new tab (known(null)), and an old bundle's write of it. */
  async function oldBundleWrite({ resetMeanwhile }) {
    const storage = memoryStorage();
    setAccount(storage, U1, null);
    const t = setup({ storage, phase5: true, rows: [{ courseSlug: COURSE, lessonId: 'l1', progress: record({ seen: ['a'], updatedAt: iso(-5) }), pct: 10, state: 'in_progress', updatedAt: iso(-5) }] });
    t.sync.signIn(U1);
    await t.clock.advance(1_000);
    const key = progressKey(COURSE, 'l1');
    const loaded = readerStartGen(storage.getItem(key));
    assert.deepEqual(loaded, known(null));
    const mine = record({ seen: ['a', 'n1'], updatedAt: iso(1) });
    writeProgress(COURSE, 'l1', mine, storage, loaded);
    // The old bundle's tab answers in the same lesson and writes its record without a stamp.
    storage.setItem(key, JSON.stringify(record({ seen: ['a', 'old-tab'], answers: { 'b1/q1': { attempts: 1, correct: true, chosen: ['b'], firstTry: true } }, updatedAt: iso(2) })));
    const reset = resetMeanwhile ? t.api.resetOnServer(COURSE, 'l1', Date.parse(iso(0))).gen : null;
    // The reader hears it: merged in (not reverted), written back with its stamp.
    assert.equal(readerGenChange(loaded, storage.getItem(key), mine), 'merge');
    const merged = mergeProgress(parseProgress(storage.getItem(key)), mine);
    writeProgress(COURSE, 'l1', merged, storage, loaded);
    t.sync.noteLocalWrite(COURSE, 'l1');
    await t.clock.advance(SYNC_TIMING.minPutIntervalMs + SYNC_TIMING.flushDelayMs);
    return { t, storage, key, loaded, merged, reset };
  }

  it('a lesson never started over: an old bundle\'s answers in the same lesson are merged in and saved, not reverted', async () => {
    const { t, storage, key } = await oldBundleWrite({ resetMeanwhile: false });
    const row = t.api.server.rows.get(`${COURSE}:l1`);
    assert.deepEqual([...row.progress.seen].sort(), ['a', 'n1', 'old-tab']);
    assert.deepEqual(row.progress.answers['b1/q1'].chosen, ['b']);
    assert.deepEqual(lessonGenOf(storage.getItem(key)), known(null));
  });

  it('… and when it was started over elsewhere meanwhile, the merged record is refused and the reader restarts', async () => {
    const { t, storage, key, loaded, merged, reset } = await oldBundleWrite({ resetMeanwhile: true });
    assert.equal(t.api.puts().at(-1).body.records[0].lessonEpoch, null);
    assert.deepEqual(t.api.server.rows.get(`${COURSE}:l1`)?.progress.seen ?? [], [], 'never stored');
    assert.deepEqual(lessonGenOf(storage.getItem(key)), known(reset.epoch, reset.at));
    assert.equal(readerGenChange(loaded, storage.getItem(key), merged), 'restart');
  });
});
