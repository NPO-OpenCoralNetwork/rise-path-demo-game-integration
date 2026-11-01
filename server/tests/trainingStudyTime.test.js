// Study time for job training, rule "study-time/v1" (shared/training/studyTime.js), the rules file
// (shared/training/timeRules.js) and the course manifest (shared/training/courseManifest.js);
// doc/brushup-2026/training-plan.ja.md §4.9. Every value here is artificial (primes: seconds and
// counts) and says nothing about the school's rules, which live outside this repository (D9).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  admitSignal, cohortRange, countDay, countDays, countSpan, countWhole, evidenceWindow, jstDayOf, jstDayRange, nextDay, STUDY_TIME_ALGORITHM, studyReason,
} from '../../shared/training/studyTime.js';
import { parseTimeRules } from '../../shared/training/timeRules.js';
import { COURSE_MANIFEST_SCHEMA, manifestCanonical, parseCourseManifest, setMsOf } from '../../shared/training/courseManifest.js';

const S = 1000;
const RULES_IN = {
  algorithm: STUDY_TIME_ALGORITHM,
  collection: { beatMs: 7 * S, minSpacingMs: 3 * S, maxPlaces: 7 },
  counting: { gapMs: 23 * S, creditCapMs: 13 * S, idleMs: 101 * S, requireFocus: false, overlap: 'prefer_focus_latest' },
};
const parsed = parseTimeRules(RULES_IN);
assert.ok(parsed.ok);
const RULES = parsed.rules;
const rulesWith = (patch) => ({ ...RULES, counting: { ...RULES.counting, ...patch } });
const DAY = '2026-11-05';
const T0 = jstDayRange(DAY).start + 10 * 3600 * S; // 10:00 Japan time
const BIG = new Map([['u1', 100 * 3600 * S], ['u2', 100 * 3600 * S]]);
const NONE = new Map();
const day = (signals, rules = RULES, setMs = BIG, carriedMs = NONE, d = DAY, cohort = undefined) => countDay({ day: d, signals, rules, setMs, carriedMs, cohort });

/** One chain: times in seconds from base; seq 0 is the chain's start. */
const chain = (id, unit, secs, { input = () => false, focus = true, stopAt = null, base = T0 } = {}) => {
  const born = base + secs[0] * S;
  const out = secs.map((t, i) => ({ chain: id, seq: i, unit, born, at: base + t * S, stop: false, focus, input: input(i) }));
  if (stopAt !== null) out.push({ chain: id, seq: secs.length, unit, born, at: base + stopAt * S, stop: true, focus, input: false });
  return out;
};
const every = (from, to, step) => {
  const out = [];
  for (let t = from; t <= to; t += step) out.push(t);
  return out;
};
const always = () => true;

describe('the rules file (shared/training/timeRules.js)', () => {
  it('no defaults: empty, partial or unknown keys refuse the whole file; errors name fields, never values', () => {
    assert.equal(parseTimeRules({}).ok, false);
    assert.deepEqual(parseTimeRules(null), { ok: false, errors: ['not an object'] });
    const partial = parseTimeRules({ ...RULES_IN, counting: { ...RULES_IN.counting, idleMs: undefined } });
    assert.deepEqual(partial, { ok: false, errors: ['counting.idleMs'] });
    const wrong = parseTimeRules({ ...RULES_IN, counting: { ...RULES_IN.counting, idleMs: 101_000.5, overlap: 'x' } });
    assert.deepEqual(wrong.errors, ['counting.idleMs', 'counting.overlap']);
    assert.ok(!JSON.stringify(wrong).includes('101000.5'), 'the value is never echoed');
    assert.deepEqual(parseTimeRules({ ...RULES_IN, extra: 1 }).errors, ['unknown extra']);
    assert.deepEqual(parseTimeRules({ ...RULES_IN, counting: { ...RULES_IN.counting, idleSeconds: 1 } }).errors, ['unknown counting.idleSeconds']);
    assert.deepEqual(parseTimeRules({ ...RULES_IN, algorithm: 'study-time/v2' }).errors, ['algorithm']);
    for (const [patch, error] of [
      [{ counting: { ...RULES_IN.counting, creditCapMs: 29 * S } }, 'counting.creditCapMs > counting.gapMs'],
      [{ counting: { ...RULES_IN.counting, gapMs: 7 * S, creditCapMs: 7 * S } }, 'counting.gapMs <= collection.beatMs'],
      [{ counting: { ...RULES_IN.counting, idleMs: 5 * S } }, 'counting.idleMs < collection.beatMs'],
      [{ collection: { ...RULES_IN.collection, minSpacingMs: 11 * S } }, 'collection.minSpacingMs > collection.beatMs'],
    ]) assert.deepEqual(parseTimeRules({ ...RULES_IN, ...patch }).errors, [error]);
    assert.deepEqual(parseTimeRules({ ...RULES_IN, collection: { ...RULES_IN.collection, maxPlaces: 11 } }).errors, ['collection.maxPlaces']);
    for (const [group, fields] of Object.entries({ collection: RULES_IN.collection, counting: RULES_IN.counting })) {
      for (const field of Object.keys(fields)) {
        const without = { ...RULES_IN, [group]: { ...RULES_IN[group], [field]: undefined } };
        assert.deepEqual(parseTimeRules(without).errors, [`${group}.${field}`], `${group}.${field} missing`);
      }
    }
    assert.deepEqual(parseTimeRules({ algorithm: STUDY_TIME_ALGORITHM, counting: RULES_IN.counting }).errors, ['collection.beatMs', 'collection.minSpacingMs', 'collection.maxPlaces']);
    assert.deepEqual(parseTimeRules({ ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 999 } }).errors, ['counting.gapMs'], 'at least a second');
  });

  it('the signals of maxPlaces pages use at most half of the per-learner request limit, when the limit is given', () => {
    assert.equal(parseTimeRules(RULES_IN, { requestsPerMinute: 120 }).ok, true, '7 pages × 60 / 7 s = 60 per minute ≤ 120 / 2');
    assert.deepEqual(parseTimeRules(RULES_IN, { requestsPerMinute: 119 }).errors, ['collection.maxPlaces and collection.beatMs use more than half of the per-learner request limit']);
    assert.equal(parseTimeRules(RULES_IN).ok, true, 'no limit given: not checked');
  });

  it('a valid file comes back as exactly the known fields', () => {
    assert.deepEqual(RULES, RULES_IN);
  });
});

describe('Japan-time days, the cohort range and the evidence window', () => {
  it('days start at 00:00 Japan time; the evidence of a span reaches max(idle, gap) back and gap ahead', () => {
    const { start, end } = jstDayRange(DAY);
    assert.equal(new Date(start).toISOString(), '2026-11-04T15:00:00.000Z');
    assert.equal(end - start, 86_400_000);
    assert.equal(jstDayOf(start - 1), '2026-11-04');
    assert.equal(jstDayOf(start), DAY);
    assert.equal(nextDay('2026-12-31'), '2027-01-01');
    assert.throws(() => jstDayRange('2026-11-5'), /not a YYYY-MM-DD day/);
    for (const missing of ['2026-02-29', '2026-11-31', '2026-13-01', '2026-00-10']) assert.throws(() => jstDayRange(missing), /not a YYYY-MM-DD day/, missing);
    assert.equal(jstDayRange('2028-02-29').end - jstDayRange('2028-02-29').start, 86_400_000, 'a leap day exists'); 
    assert.deepEqual(evidenceWindow(start, end, RULES.counting), { from: start - 101 * S, to: end + 23 * S });
  });

  it('a cohort counts from 00:00 of its first day to 00:00 after its last (one day too); a missing date counts nothing', () => {
    assert.deepEqual(cohortRange('2026-11-01', '2026-11-30'), { from: jstDayRange('2026-11-01').start, to: jstDayRange('2026-11-30').end });
    assert.deepEqual(cohortRange(DAY, DAY), { from: jstDayRange(DAY).start, to: jstDayRange(DAY).end });
    for (const [a, b] of [[null, '2026-11-30'], ['2026-11-01', null], [undefined, undefined], ['2026-11-30', '2026-11-01']]) assert.equal(cohortRange(a, b), null);
    assert.throws(() => cohortRange('2026-11-01', '2026-11-31'), /not a YYYY-MM-DD day/);
    const signals = chain('a', 'u1', every(0, 21, 7), { input: always });
    assert.equal(day(signals, RULES, BIG, NONE, DAY, cohortRange(null, '2026-11-30')).countedMs, 0, 'null: nothing counts');
    assert.equal(countDays({ fromDay: DAY, toDay: nextDay(DAY), signals, rulesOf: () => RULES, setMsOf: () => BIG, carriedMs: NONE, cohort: null }).carriedAfterMs.size, 0);
    assert.equal(countWhole({ signals, rules: RULES, setMs: BIG, cohort: null }).size, 0);
    assert.equal(day(signals, RULES, BIG, NONE, DAY, cohortRange(DAY, DAY)).countedMs, 21 * S);
  });
});

describe('one page', () => {
  it('steady signals with input: every pair counts', () => {
    assert.equal(day(chain('a', 'u1', every(0, 63, 7), { input: always })).countedMs, 63 * S);
  });
  it('a pair longer than the gap is a break: it counts nothing, and counting goes on with the next pair', () => {
    assert.equal(day(chain('a', 'u1', [0, 7, 14, 60, 67], { input: always })).countedMs, (14 + 7) * S);
  });
  it('a late pair inside the gap earns at most creditCapMs; a pair of exactly gapMs still counts, one millisecond more does not', () => {
    assert.equal(day(chain('a', 'u1', [0, 20], { input: always })).countedMs, 13 * S);
    assert.equal(day(chain('a', 'u1', [0, 23], { input: always })).countedMs, 13 * S);
    assert.equal(day(chain('a', 'u1', [0, 23.001], { input: always })).countedMs, 0);
  });
  it('hidden with the stop received: counts up to the stop; the next visible stretch is a new chain', () => {
    const r = day([...chain('a', 'u1', [0, 7], { input: always, stopAt: 10 }), ...chain('b', 'u1', [30, 37], { input: always })]);
    assert.equal(r.countedMs, (10 + 7) * S);
  });
  it('a stop that never arrives: the time while hidden is still not counted, since the visible page starts a new chain', () => {
    const r = day([...chain('a', 'u1', [0, 7], { input: always }), ...chain('b', 'u1', [20, 27], { input: always })]);
    assert.equal(r.countedMs, (7 + 7) * S, 'the first chain ends at its last signal; 7 s to 20 s is not counted');
  });
  it('no input for idleMs: counting stops idleMs after the last input and starts again from the next input', () => {
    // inputs at 0 s and at 210 s (signals every 7 s from 0 to 301): presence [0, 101] and [210, 311]
    const r = day(chain('a', 'u1', every(0, 301, 7), { input: (i) => i === 0 || i === 30 }));
    assert.equal(r.countedMs, (101 + (301 - 210)) * S);
  });
  it('presence comes only from signals that report an input (the page reports one when the learner opens or shows it)', () => {
    assert.equal(day(chain('a', 'u1', every(0, 301, 7), { input: (i) => i === 0 })).countedMs, 101 * S);
    assert.equal(day(chain('a', 'u1', every(0, 301, 7))).countedMs, 0, 'a chain without any input counts nothing');
  });
  it('requireFocus: a pair without focus does not count; without it, focus only decides between pages', () => {
    const signals = chain('a', 'u1', every(0, 63, 7), { input: always }).map((s, i) => ({ ...s, focus: i % 2 === 0 }));
    assert.equal(day(signals, rulesWith({ requireFocus: true })).countedMs, 4 * 7 * S);
    assert.equal(day(signals).countedMs, 63 * S);
  });
  it('a chain that only stops counts nothing; nothing after a stop counts', () => {
    assert.equal(day([{ chain: 'a', seq: 0, unit: 'u1', born: T0, at: T0, stop: true, focus: true, input: true }]).countedMs, 0);
    const after = (seq, t) => ({ chain: 'a', seq, unit: 'u1', born: T0, at: T0 + t * S, stop: false, focus: true, input: true });
    const r = day([...chain('a', 'u1', [0, 7], { input: always, stopAt: 9 }), after(3, 15), after(4, 22)]);
    assert.equal(r.countedMs, 9 * S, 'a chain ends at its first stop, whatever was stored after it');
  });
});

describe('several pages', () => {
  it('two pages on the same unit: each instant once, under either overlap rule', () => {
    const pages = [...chain('a', 'u1', every(0, 70, 7), { input: always }), ...chain('b', 'u1', every(3, 73, 7), { input: always })];
    assert.equal(day(pages).countedMs, 73 * S);
    assert.equal(day(pages, rulesWith({ overlap: 'drop_conflicts' })).countedMs, 73 * S);
  });
  it('two pages of different units that began at the same instant: the smaller chain id wins', () => {
    const r = day([...chain('k2', 'u2', every(0, 70, 7), { input: always }), ...chain('k1', 'u1', every(0, 70, 7), { input: always })]);
    assert.deepEqual(r.units.map((u) => [u.unit, u.countedMs / S]), [['u1', 70]]);
  });
  it('two pages on different units: the page that began last wins each shared instant (focus first)', () => {
    const r = day([...chain('a', 'u1', every(0, 70, 7), { input: always }), ...chain('b', 'u2', every(5, 75, 7), { input: always })]);
    assert.deepEqual(r.units.map((u) => [u.unit, u.countedMs / S]), [['u1', 5], ['u2', 70]]);
    assert.equal(r.countedMs, 75 * S);
    const focused = day([...chain('a', 'u1', every(0, 70, 7), { input: always }), ...chain('b', 'u2', every(5, 75, 7), { input: always, focus: false })]);
    assert.deepEqual(focused.units.map((u) => [u.unit, u.countedMs / S]), [['u1', 70], ['u2', 5]], 'the focused page wins over a newer page without focus');
  });
  it('a page without input never takes time from a page with input', () => {
    const r = day([...chain('a', 'u1', every(0, 301, 7), { input: always }), ...chain('b', 'u2', every(5, 306, 7), { input: (i) => i === 0 })]);
    // b (newer, opened by the learner, then no input) wins from its start until idle after it (5 s to 106 s), then a again
    assert.deepEqual(r.units.map((u) => [u.unit, u.countedMs / S]), [['u1', 301 - 101], ['u2', 101]]);
  });
  it('drop_conflicts: shared instants of different units count for neither', () => {
    const r = day([...chain('a', 'u1', every(0, 70, 7), { input: always }), ...chain('b', 'u2', every(5, 75, 7), { input: always })], rulesWith({ overlap: 'drop_conflicts' }));
    assert.equal(r.countedMs, (5 + 5) * S);
  });
});

describe('days, set times, cohort dates', () => {
  it('00:00 Japan time: a pair across midnight is cut, each side to its own day', () => {
    const base = jstDayRange(nextDay(DAY)).start;
    const signals = chain('a', 'u1', [-14, -7, 0, 7], { input: always, base });
    assert.equal(day(signals).countedMs, 14 * S);
    assert.equal(day(signals, RULES, BIG, NONE, nextDay(DAY)).countedMs, 7 * S);
  });
  it('the set time: the earliest time counts, the rest is over the cap; carried from earlier days', () => {
    const r = day(chain('a', 'u1', every(0, 70, 7), { input: always }), RULES, new Map([['u1', 60 * S]]), new Map([['u1', 30 * S]]));
    assert.deepEqual(r.units, [{ unit: 'u1', countedMs: 30 * S, overCapMs: 40 * S }]);
    assert.deepEqual(r.carriedAfterMs, new Map([['u1', 60 * S]]));
  });
  it('a unit without a set time counts nothing (all over the cap)', () => {
    assert.deepEqual(day(chain('a', 'u3', every(0, 14, 7), { input: always })).units, [{ unit: 'u3', countedMs: 0, overCapMs: 14 * S }]);
  });
  it('the cohort dates clip counting', () => {
    const cohort = { from: T0 + 20 * S, to: T0 + 50 * S };
    assert.equal(day(chain('a', 'u1', every(0, 70, 7), { input: always }), RULES, BIG, NONE, DAY, cohort).countedMs, 30 * S);
  });
  it('countDays carries the set time from day to day; rules and units may change by day', () => {
    const base = jstDayRange(nextDay(DAY)).start;
    const signals = [...chain('a', 'u1', every(-70, -7, 7), { input: always, base }), ...chain('b', 'u1', every(7, 70, 7), { input: always, base })];
    const r = countDays({ fromDay: DAY, toDay: nextDay(DAY), signals, rulesOf: () => RULES, setMsOf: () => new Map([['u1', 100 * S]]), carriedMs: NONE });
    assert.deepEqual(r.days.map((d) => d.countedMs / S), [63, 37]);
    assert.deepEqual(r.carriedAfterMs, new Map([['u1', 100 * S]]));
    const tighter = countDays({ fromDay: DAY, toDay: nextDay(DAY), signals, rulesOf: (d) => (d === DAY ? RULES : rulesWith({ creditCapMs: 5 * S })), setMsOf: () => BIG, carriedMs: NONE });
    assert.deepEqual(tighter.days.map((d) => d.countedMs / S), [63, 45], 'the second day counts each pair up to 5 s');
  });
});

describe('admitSignal: what the server stores, under the learner\'s lock and the database clock', () => {
  const NOW = T0 + 1000 * S;
  const session = cohortRange('2026-11-01', '2026-11-30');
  const base = { now: NOW, cohortId: 'c1', signal: { chainId: 'k1', seq: 0, unitKey: 'u1', stop: false }, configured: true, session, unitKnown: true, chain: null, places: [], rules: RULES };
  const known = { cohortId: 'c1', unitKey: 'u1', bornAt: NOW - 70 * S, lastSeq: 9, lastAt: NOW - 7 * S, lastStop: false };
  const seqIs = (seq, extra = {}) => ({ ...base.signal, seq, ...extra });
  const admit = (patch) => admitSignal({ ...base, ...patch });

  it('a new chain starts at seq 0 and is born now; the next signals carry its birth', () => {
    assert.deepEqual(admit({}), { verdict: 'accept', bornAt: NOW });
    assert.deepEqual(admit({ chain: known, signal: seqIs(10) }), { verdict: 'accept', bornAt: NOW - 70 * S });
  });

  it('refused, nothing stored (409): not configured, outside the dates (an open chain may finish within gapMs after the last day, a new one may not), unknown unit, a chain id reused elsewhere', () => {
    assert.deepEqual(admit({ configured: false }), { verdict: 'refuse', reason: 'time_not_configured' });
    assert.deepEqual(admit({ session: null }), { verdict: 'refuse', reason: 'not_in_session' });
    assert.deepEqual(admit({ now: session.from - 1 }), { verdict: 'refuse', reason: 'not_in_session' });
    assert.equal(admit({ now: session.to - 1 }).verdict, 'accept');
    assert.deepEqual(admit({ now: session.to }), { verdict: 'refuse', reason: 'not_in_session' }, 'no new chain after the last day');
    const open = { ...known, lastAt: session.to - 5 * S };
    assert.equal(admit({ now: session.to + 23 * S - 1, chain: open, signal: seqIs(10) }).verdict, 'accept', 'the open chain finishes its last pair');
    assert.deepEqual(admit({ now: session.to + 23 * S, chain: open, signal: seqIs(10) }), { verdict: 'refuse', reason: 'not_in_session' });
    assert.deepEqual(admit({ unitKnown: false }), { verdict: 'refuse', reason: 'unit_unknown' });
    assert.deepEqual(admit({ chain: { ...known, unitKey: 'u2' }, signal: seqIs(10) }), { verdict: 'refuse', reason: 'chain_mismatch' });
    assert.deepEqual(admit({ chain: { ...known, cohortId: 'c2' }, signal: seqIs(10) }), { verdict: 'refuse', reason: 'chain_mismatch' });
  });

  it('ignored (200, accepted false): duplicate, after a stop, an unknown chain not at its start, a clock not past the last signal, too soon', () => {
    assert.deepEqual(admit({ chain: known, signal: seqIs(9) }), { verdict: 'ignore', reason: 'duplicate' });
    assert.deepEqual(admit({ chain: known, signal: seqIs(4) }), { verdict: 'ignore', reason: 'duplicate' }, 'a late lower seq too');
    assert.deepEqual(admit({ chain: { ...known, lastStop: true }, signal: seqIs(10) }), { verdict: 'ignore', reason: 'chain_ended' });
    assert.deepEqual(admit({ signal: seqIs(3) }), { verdict: 'ignore', reason: 'not_open' });
    assert.deepEqual(admit({ signal: seqIs(0, { stop: true }) }), { verdict: 'ignore', reason: 'not_open' });
    assert.deepEqual(admit({ chain: { ...known, lastAt: NOW }, signal: seqIs(10) }), { verdict: 'ignore', reason: 'restart' });
    assert.deepEqual(admit({ chain: { ...known, lastAt: NOW + S }, signal: seqIs(10) }), { verdict: 'ignore', reason: 'restart' });
    assert.deepEqual(admit({ chain: { ...known, lastAt: NOW - 2 * S }, signal: seqIs(10) }), { verdict: 'ignore', reason: 'too_soon' });
    assert.equal(admit({ chain: { ...known, lastAt: NOW - 2 * S }, signal: seqIs(10, { stop: true }) }).verdict, 'accept', 'a stop is never too soon');
  });

  it('more open pages than maxPlaces: the newest win; a stop, a stopped page and a page silent for more than the gap free a place', () => {
    const other = (chainId, bornAt, extra = {}) => ({ chainId, bornAt, lastAt: NOW - 5 * S, lastStop: false, ...extra });
    /** n other open pages born at -60 s, -59 s, ... (all newer than the known chain, born at -70 s) */
    const newer = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => other(`p${i}`, NOW - (60 - i) * S, extra(i)));
    assert.equal(admit({ places: newer(9) }).verdict, 'accept', 'a new page is the newest');
    assert.equal(admit({ chain: known, signal: seqIs(10), places: newer(6) }).verdict, 'accept', '7th newest of 7');
    assert.deepEqual(admit({ chain: known, signal: seqIs(10), places: newer(7) }), { verdict: 'ignore', reason: 'other_place' }, '8th newest of 8');
    assert.equal(admit({ chain: known, signal: seqIs(10, { stop: true }), places: newer(7) }).verdict, 'accept', 'a stop passes');
    assert.equal(admit({ chain: known, signal: seqIs(10), places: newer(7, (i) => (i === 0 ? { lastStop: true } : {})) }).verdict, 'accept', 'a stopped page frees a place');
    assert.equal(admit({ chain: known, signal: seqIs(10), places: newer(7, (i) => (i === 0 ? { lastAt: NOW - 24 * S } : {})) }).verdict, 'accept', 'silent for more than the gap');
    assert.equal(admit({ chain: known, signal: seqIs(10), places: [other('k1', NOW), ...newer(6)] }).verdict, 'accept', 'its own row is not another place');
    const born = (ids) => ids.map((id) => other(id, NOW));
    assert.deepEqual(admit({ signal: { ...base.signal, chainId: 'k9' }, places: born(['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']) }), { verdict: 'ignore', reason: 'other_place' }, 'born at the same instant: the smaller chain ids win');
    assert.equal(admit({ signal: { ...base.signal, chainId: 'k0' }, places: born(['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']) }).verdict, 'accept', 'and the smaller id wins over larger ones');
  });
});

describe('the course manifest (shared/training/courseManifest.js)', () => {
  const MANIFEST = {
    schema: COURSE_MANIFEST_SCHEMA,
    courseKey: 'sample-course',
    title: { jp: '練習用の講座', en: 'Practice course' },
    units: [
      { key: 'unit-1', title: { jp: '単元 1', en: 'Unit 1' }, setMinutes: 37 },
      { key: 'unit-2', title: { jp: '単元 2', en: 'Unit 2' }, setMinutes: 41 },
    ],
  };

  it('a valid manifest: its set times in milliseconds; the canonical text (key order does not matter) names the version', () => {
    const r = parseCourseManifest(MANIFEST);
    assert.ok(r.ok);
    assert.deepEqual(setMsOf(r.manifest), new Map([['unit-1', 37 * 60 * S], ['unit-2', 41 * 60 * S]]));
    const shuffled = { units: MANIFEST.units.map((u) => ({ setMinutes: u.setMinutes, title: { en: u.title.en, jp: u.title.jp }, key: u.key })), title: MANIFEST.title, courseKey: MANIFEST.courseKey, schema: MANIFEST.schema };
    const sha = (m) => crypto.createHash('sha256').update(manifestCanonical(m)).digest('hex');
    assert.equal(sha(shuffled), sha(MANIFEST));
    assert.notEqual(sha({ ...MANIFEST, units: [MANIFEST.units[1], MANIFEST.units[0]] }), sha(MANIFEST), 'the unit order is part of the version');
  });

  it('refused with field names: schema, keys, repeated units, titles, set times, unknown fields, sizes', () => {
    const errors = (patch) => {
      const r = parseCourseManifest({ ...MANIFEST, ...patch });
      return r.ok ? [] : r.errors;
    };
    assert.deepEqual(errors({ schema: 'risepath.training-course/v2' }), ['schema']);
    assert.deepEqual(errors({ courseKey: 'Sample Course' }), ['courseKey']);
    assert.deepEqual(errors({ units: [MANIFEST.units[0], { ...MANIFEST.units[1], key: 'unit-1' }] }), ['units[1].key repeats']);
    assert.deepEqual(errors({ units: [{ ...MANIFEST.units[0], setMinutes: 0 }] }), ['units[0].setMinutes']);
    assert.deepEqual(errors({ units: [{ ...MANIFEST.units[0], setMinutes: 6001 }] }), ['units[0].setMinutes']);
    assert.deepEqual(errors({ units: [{ ...MANIFEST.units[0], title: { jp: '単元', en: ' ' } }] }), ['units[0].title.en']);
    assert.deepEqual(errors({ units: [{ ...MANIFEST.units[0], answer: 'x' }] }), ['unknown units[0].answer'], 'no lesson text or answers in this version');
    assert.deepEqual(errors({ units: [] }), ['units']);
    assert.deepEqual(errors({ notes: 'x' }), ['unknown notes']);
    assert.deepEqual(errors({ title: 'Practice' }), ['title is not { jp, en }']);
    assert.deepEqual(parseCourseManifest([]), { ok: false, errors: ['not an object'] });
    assert.deepEqual(errors({ title: { jp: 'あ'.repeat(201), en: 'x' } }), ['title.jp'], 'at most 200 characters');
    assert.deepEqual(errors({ title: { jp: '講座', en: 'Course', fr: 'Cours' } }), ['unknown title.fr']);
    assert.deepEqual(errors({ units: [{ ...MANIFEST.units[0], key: 'Unit_1' }] }), ['units[0].key']);
    assert.deepEqual(errors({ units: [{ ...MANIFEST.units[0], setMinutes: 37.5 }] }), ['units[0].setMinutes']);
    const many = Array.from({ length: 501 }, (_, i) => ({ ...MANIFEST.units[0], key: `unit-${i}` }));
    assert.deepEqual(errors({ units: many }), ['units']);
    assert.equal(parseCourseManifest({ ...MANIFEST, units: many.slice(0, 500) }).ok, true, '500 units are fine');
  });
});

describe('purity and the module boundaries', () => {
  it('studyTime.js imports nothing and reads no clock or randomness; the rules and the manifest import only shared code', () => {
    const read = (rel) => fs.readFileSync(new URL(`../../shared/training/${rel}`, import.meta.url), 'utf8');
    const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code('studyTime.js'), /\bimport\b|Date\.now|Math\.random|new Date\(\)|performance\./);
    assert.deepEqual([...code('timeRules.js').matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['./studyTime.js']);
    assert.deepEqual([...code('courseManifest.js').matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['../lesson/canonical.js']);
    assert.doesNotMatch(code('timeRules.js') + code('courseManifest.js'), /Date\.now|Math\.random|new Date\(\)/);
  });
});

// ---- the fixed result of study-time/v1 (a change to these numbers needs a new algorithm version) ----

describe('golden: study-time/v1 on fixed evidence', () => {
  const base = jstDayRange(nextDay(DAY)).start;
  // Around midnight (seconds from 00:00 of the second day): a (u1) from -600 s to 394 s with an input
  // every third signal; b (u2, newer) from -120 s, opened by the learner then no input, so present
  // until -19 s; d (u2, the
  // newest, another device) without focus from -30 s to 80 s; c (u1) at 500-556 s, a break, then
  // 600-663 s and a stop at 670 s. Set times: u1 780 s, u2 180 s.
  //   prefer_focus_latest, day 1: a alone 480 s; b over a 90 s + 11 s (d has no focus); a again 19 s
  //     -> u1 499 s, u2 101 s. Day 2: a 394 s (it has focus over d) + c 56 s + 70 s = 520 s of u1, of
  //     which 780 - 499 = 281 s count and 239 s are over the set time; d never wins.
  //   drop_conflicts with requireFocus: d drops out; a and b overlap for 101 s, which counts for
  //     neither -> day 1 u1 499 s only; day 2 as above.
  const evidence = [
    ...chain('a', 'u1', every(-600, 400, 7), { input: (i) => i % 3 === 0, base }),
    ...chain('b', 'u2', every(-120, 180, 7), { input: (i) => i === 0, base }),
    ...chain('c', 'u1', [...every(500, 556, 7), ...every(600, 663, 7)], { input: always, stopAt: 670, base }),
    ...chain('d', 'u2', every(-30, 90, 11), { input: always, focus: false, base }),
  ];
  const setMs = new Map([['u1', 13 * 60 * S], ['u2', 3 * 60 * S]]);
  const fold = (rules) => countDays({ fromDay: DAY, toDay: nextDay(DAY), signals: evidence, rulesOf: () => rules, setMsOf: () => setMs, carriedMs: NONE })
    .days.map((d) => [d.day, d.units.map((u) => [u.unit, u.countedMs, u.overCapMs])]);

  it('prefer_focus_latest', () => {
    assert.deepEqual(fold(RULES), [
      ['2026-11-05', [['u1', 499000, 0], ['u2', 101000, 0]]],
      ['2026-11-06', [['u1', 281000, 239000]]],
    ]);
  });

  it('drop_conflicts with requireFocus', () => {
    assert.deepEqual(fold(rulesWith({ overlap: 'drop_conflicts', requireFocus: true })), [
      ['2026-11-05', [['u1', 499000, 0]]],
      ['2026-11-06', [['u1', 281000, 239000]]],
    ]);
  });
});

// ---- properties on random evidence (seeded) ----

function rng(seed) {
  // the seed mixed first (murmur3's fmix32), so that neighbouring seeds start far apart
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** Random chains of one learner around midnight, keeping what the server guarantees (admitSignal). */
function randomEvidence(seed) {
  const r = rng(seed);
  const midnight = jstDayRange(nextDay(DAY)).start;
  const signals = [];
  const chains = 1 + Math.floor(r() * 5);
  for (let c = 0; c < chains; c += 1) {
    const unit = r() < 0.5 ? 'u1' : 'u2';
    let at = midnight + Math.floor((r() - 0.6) * 900) * S + Math.floor(r() * 1000);
    const born = at;
    const n = 1 + Math.floor(r() * 60);
    for (let seq = 0; seq < n; seq += 1) {
      const stop = seq === n - 1 && r() < 0.4;
      signals.push({ chain: `c${c}`, seq, unit, born, at, stop, focus: r() < 0.8, input: r() < 0.3 });
      at += 1 + Math.floor((r() < 0.1 ? 40 : 9) * S * r()); // strictly increasing, sometimes a long pause
    }
  }
  return signals;
}

/** The measure of the union of every pair's credited span: no rule may count more. */
function pairUnionMs(signals, counting) {
  const spans = [];
  const byChain = new Map();
  for (const s of signals) byChain.set(s.chain, [...(byChain.get(s.chain) ?? []), s]);
  for (const list of byChain.values()) {
    list.sort((x, y) => x.seq - y.seq);
    for (let i = 1; i < list.length; i += 1) {
      const delta = list[i].at - list[i - 1].at;
      if (!list[i - 1].stop && delta > 0 && delta <= counting.gapMs) spans.push([list[i - 1].at, list[i - 1].at + Math.min(delta, counting.creditCapMs)]);
    }
  }
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

const RANDOM_RULES = [RULES, rulesWith({ requireFocus: true }), rulesWith({ overlap: 'drop_conflicts', idleMs: 29 * S })];

describe('properties on random evidence', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const signals = randomEvidence(seed);
    const rules = RANDOM_RULES[seed % RANDOM_RULES.length];
    const setMs = new Map([['u1', (seed % 7) * 60 * S + 1], ['u2', 90 * 60 * S]]);
    const days = [DAY, nextDay(DAY)];
    it(`seed ${seed}: the day-by-day fold = everything at once; a day is final after its end + gap; any split; the bounds`, () => {
      const folded = countDays({ fromDay: days[0], toDay: days[1], signals, rulesOf: () => rules, setMsOf: () => setMs, carriedMs: new Map() });
      const whole = countWhole({ signals, rules, setMs });
      let total = 0;
      for (const d of folded.days) {
        for (const u of d.units) assert.equal(u.countedMs, whole.get(d.day)?.get(u.unit) ?? 0, `${d.day} ${u.unit}`);
        const wholeDay = [...(whole.get(d.day)?.values() ?? [])].reduce((n, v) => n + v, 0);
        assert.equal(d.countedMs, wholeDay, `${d.day} total`);
        assert.ok(d.countedMs <= 86_400_000);
        assert.equal(d.units.reduce((n, u) => n + u.countedMs, 0), d.countedMs);
        total += d.countedMs;
      }
      assert.ok(total <= pairUnionMs(signals, rules.counting), 'never more than the union of the pairs');
      for (const unit of ['u1', 'u2']) assert.ok((folded.carriedAfterMs.get(unit) ?? 0) <= setMs.get(unit), `set time ${unit}`);
      // final: the reference (which reads every signal it is given) gives the first day the same
      // numbers from the evidence up to that day's end + gap as from all of it
      const cutoff = jstDayRange(days[0]).end + rules.counting.gapMs;
      const upToCutoff = countWhole({ signals: signals.filter((s) => s.at <= cutoff), rules, setMs });
      assert.deepEqual(upToCutoff.get(days[0]) ?? new Map(), whole.get(days[0]) ?? new Map(), 'later evidence never changes a final day');
      const first = countDay({ day: days[0], signals, rules, setMs, carriedMs: new Map() });
      // a split anywhere in the second day, the set time carried: the two halves = the whole day
      const r = rng(seed * 31);
      const { start: s2, end: e2 } = jstDayRange(days[1]);
      const t = s2 + Math.floor(r() * 1800) * S;
      const left = countSpan({ a: s2, b: t, signals, rules, setMs, carriedMs: first.carriedAfterMs });
      const right = countSpan({ a: t, b: e2, signals, rules, setMs, carriedMs: left.carriedAfterMs });
      const full = countSpan({ a: s2, b: e2, signals, rules, setMs, carriedMs: first.carriedAfterMs });
      assert.equal(left.countedMs + right.countedMs, full.countedMs);
    });
  }

  it('without set times, fewer input and focus flags never raise the total, more never lower it (prefer_focus_latest)', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const signals = randomEvidence(seed);
      for (const rules of [RULES, rulesWith({ requireFocus: true })]) {
        const total = (list) => [DAY, nextDay(DAY)].reduce((n, d) => n + countDay({ day: d, signals: list, rules, setMs: BIG, carriedMs: NONE }).countedMs, 0);
        const base = total(signals);
        const r = rng(seed);
        assert.ok(total(signals.map((s) => ({ ...s, input: s.input && r() < 0.5, focus: s.focus && r() < 0.5 }))) <= base, `seed ${seed}`);
        assert.ok(total(signals.map((s) => ({ ...s, input: true, focus: true }))) >= base, `seed ${seed}`);
      }
    }
  });
});

// ---- studyReason: the answer to an accepted signal (scenes, then properties on random evidence) ----

describe('studyReason: why a page\'s time is not counting', () => {
  const COHORT = cohortRange('2026-11-01', '2026-11-30');
  const SET_MS = 100 * 3600 * S;
  const first = (i) => i === 0;
  /** The answer right after the last signal of chain `id` was stored, with the evidence up to it. */
  const reasonAfter = (signals, id, { counting = RULES.counting, setMs = SET_MS, unitMs = 0, cohort = COHORT } = {}) => {
    const own = signals.filter((s) => s.chain === id).sort((x, y) => x.seq - y.seq);
    const s = own[own.length - 1];
    const prev = own.length > 1 ? own[own.length - 2] : null;
    return studyReason({
      now: s.at, chain: { id, unit: s.unit, prevAt: prev ? prev.at : null }, signal: { focus: s.focus, input: s.input },
      signals: signals.filter((g) => g.at <= s.at), counting, setMs, unitMs, cohort,
    });
  };

  it('starting: the first signal of a chain (no pair yet); the next pair counts', () => {
    assert.equal(reasonAfter(chain('a', 'u1', [0], { input: always }), 'a'), 'starting');
    assert.equal(reasonAfter(chain('a', 'u1', [0, 7], { input: first }), 'a'), null);
  });

  it('idle: judged at the pair\'s last credited millisecond, idleMs after the last input; an input on this signal is starting, then counting', () => {
    const secs = every(0, 119, 7);
    const upTo = (t, inputs) => chain('a', 'u1', secs.filter((v) => v <= t), { input: (i) => inputs.includes(secs[i]) });
    assert.equal(reasonAfter(upTo(98, [0]), 'a'), null, 'x = 97.999 s, inside [0, 101 s)');
    assert.equal(reasonAfter(upTo(105, [0]), 'a'), 'idle', 'x = 104.999 s');
    assert.equal(reasonAfter(upTo(112, [0, 112]), 'a'), 'starting', 'x = 111.999 s; the input at 112 s counts from now');
    assert.equal(reasonAfter(upTo(119, [0, 112]), 'a'), null);
    const edge = (ms) => chain('a', 'u1', [...every(0, 98, 7), 101], { input: first }).map((s) => (s.seq === 15 ? { ...s, at: s.at + ms } : s));
    assert.equal(reasonAfter(edge(0), 'a'), null, 'x = 100.999 s, the last millisecond of [0, 101 s)');
    assert.equal(reasonAfter(edge(1), 'a'), 'idle', 'x = 101 s');
  });

  it('idle: a restart of the page\'s own (seq 0 without input) makes no presence', () => {
    assert.equal(reasonAfter(chain('a', 'u1', [0, 7, 14]), 'a'), 'idle');
  });

  it('gap: the last pair is longer than gapMs; a pair of exactly gapMs and a late pair are judged at their last credited millisecond', () => {
    assert.equal(reasonAfter(chain('a', 'u1', [0, 7, 31], { input: first }), 'a'), 'gap', '24 s > 23 s');
    assert.equal(reasonAfter(chain('a', 'u1', [0, 7, 30], { input: first }), 'a'), null, 'exactly gapMs');
    const late = chain('a', 'u1', [0, 7, 27], { input: first });
    assert.equal(reasonAfter(late, 'a'), null, 'x = 7 s + 13 s - 1 ms');
    assert.equal(reasonAfter([...late, ...chain('b', 'u2', [20, 24], { input: first })], 'a'), null, 'a newer page of another unit from 20 s on does not reach x');
  });

  it('focus: with requireFocus, a signal without focus (\'gap\' comes first); without requireFocus the pair counts', () => {
    const signals = chain('a', 'u1', [0, 7, 14], { input: first }).map((s) => (s.seq === 2 ? { ...s, focus: false } : s));
    const focusRequired = rulesWith({ requireFocus: true }).counting;
    assert.equal(reasonAfter(signals, 'a', { counting: focusRequired }), 'focus');
    assert.equal(reasonAfter(signals, 'a'), null);
    assert.equal(reasonAfter(chain('a', 'u1', [0, 7, 31], { input: first, focus: false }), 'a', { counting: focusRequired }), 'gap');
  });

  it('other_tab: a newer open page of another unit wins x with its pending pair, or both lose (drop_conflicts); not a page of the same unit, a stopped one or one without focus', () => {
    const pageA = chain('a', 'u1', [0, 7, 14, 21], { input: first });
    const pageB = (unit, extra = {}) => chain('b', unit, [3, 10, 17], { input: first, ...extra });
    assert.equal(reasonAfter([...pageA, ...pageB('u2')], 'a'), 'other_tab', 'b\'s pending pair 17 s to 21 s covers x = 20.999 s, and b began later');
    const x = T0 + 21 * S - 1;
    const stored = countSpan({ a: x, b: x + 1, signals: [...pageA, ...pageB('u2')], rules: RULES, setMs: BIG, carriedMs: NONE });
    assert.deepEqual(stored.units.map((u) => u.unit), ['u1'], 'the stored signals alone still give a the instant: the pending pair decides');
    assert.equal(reasonAfter([...pageA, ...pageB('u2')], 'a', { counting: rulesWith({ overlap: 'drop_conflicts' }).counting }), 'other_tab');
    assert.equal(reasonAfter([...pageA, ...pageB('u1')], 'a'), null, 'the same unit counts once');
    assert.equal(reasonAfter([...pageA, ...pageB('u2', { stopAt: 18 })], 'a'), null, 'b stopped at 18 s');
    assert.equal(reasonAfter([...pageA, ...pageB('u2', { focus: false })], 'a'), null, 'the focused page wins');
    const exact = chain('a', 'u1', [0, 7, 30], { input: first }); // a pair of exactly gapMs: x = 19.999 s
    const quiet = (base) => chain('b', 'u2', [3, 7], { input: first, base });
    assert.equal(reasonAfter([...exact, ...quiet(T0)], 'a'), 'other_tab', 'b\'s last signal exactly gapMs old: still open, its pending pair credits 7 s to 20 s');
    assert.equal(reasonAfter([...exact, ...quiet(T0 - 1)], 'a'), null, 'one millisecond older: b is not open');
  });

  it('another page of the same unit counts the instant: this idle page reads counting', () => {
    const pageA = chain('a', 'u1', every(0, 105, 7), { input: first });
    const pageB = chain('b', 'u1', [100, 104, 108], { input: first });
    assert.equal(reasonAfter([...pageA, ...pageB], 'a'), null, 'b\'s pending pair 104 s to 105 s covers x = 104.999 s');
    assert.equal(reasonAfter(pageA, 'a'), 'idle');
  });

  it('cap_reached: the unit\'s time reached its set time (before starting); below it, the other reasons', () => {
    const one = chain('a', 'u1', [0], { input: always });
    const pair = chain('a', 'u1', [0, 7], { input: always });
    assert.equal(reasonAfter(one, 'a', { setMs: 59 * S, unitMs: 59 * S }), 'cap_reached');
    assert.equal(reasonAfter(one, 'a', { setMs: 59 * S, unitMs: 61 * S }), 'cap_reached');
    assert.equal(reasonAfter(one, 'a', { setMs: 59 * S, unitMs: 59 * S - 1 }), 'starting');
    assert.equal(reasonAfter(pair, 'a', { setMs: 59 * S, unitMs: 59 * S }), 'cap_reached');
    assert.equal(reasonAfter(pair, 'a', { setMs: 59 * S, unitMs: 59 * S - 1 }), null);
  });

  it('not_in_session: now outside the cohort\'s dates, or a date missing; checked first', () => {
    const lastDay = cohortRange('2026-11-01', DAY);
    const end = lastDay.to;
    // a known chain after the last day: the answer is about now, though its pair's part before the end counts
    const known = chain('a', 'u1', [-19, 2], { input: first, base: end });
    assert.equal(reasonAfter(known, 'a', { cohort: lastDay }), 'not_in_session');
    assert.equal(day(known, RULES, BIG, NONE, DAY, lastDay).countedMs, 13 * S);
    assert.equal(reasonAfter(known, 'a', { cohort: lastDay, unitMs: SET_MS }), 'not_in_session', 'before cap_reached');
    assert.equal(reasonAfter(chain('a', 'u1', [-7, 0], { input: first, base: end }), 'a', { cohort: lastDay }), 'not_in_session', 'at the end');
    assert.equal(reasonAfter(chain('a', 'u1', [-7, 0], { input: first, base: end - 1 }), 'a', { cohort: lastDay }), null, '1 ms before the end');
    const later = cohortRange(nextDay(DAY), '2026-11-30');
    assert.equal(reasonAfter(chain('a', 'u1', [0], { input: always }), 'a', { cohort: later }), 'not_in_session', 'before the first day');
    assert.equal(reasonAfter(chain('a', 'u1', [0], { input: always, base: later.from }), 'a', { cohort: later }), 'starting', 'from 00:00 of the first day');
    assert.equal(reasonAfter(chain('a', 'u1', [0, 7], { input: always }), 'a', { cohort: null }), 'not_in_session', 'a date missing');
  });

  // Properties: every signal of random evidence that is not a stop, answered as the server answers it.
  const REASONS = [null, 'not_in_session', 'cap_reached', 'starting', 'gap', 'focus', 'idle', 'other_tab'];
  const REASON_RULES = [
    RULES,
    rulesWith({ requireFocus: true }),
    rulesWith({ overlap: 'drop_conflicts', idleMs: 29 * S }),
    rulesWith({ creditCapMs: 5 * S }), // shorter than beatMs (7 s): x often falls before now - 1 ms
    rulesWith({ overlap: 'drop_conflicts', requireFocus: true, creditCapMs: 5 * S }),
  ];
  /** Whether countSpan gives `unit` the millisecond [x, x + 1) of these signals (counted or over the cap). */
  const getsAt = (x, unit, signals, counting, cohort) => {
    const u = countSpan({ a: x, b: x + 1, signals, rules: { counting }, setMs: NONE, carriedMs: NONE, cohort }).units.find((v) => v.unit === unit);
    return u !== undefined && u.countedMs + u.overCapMs === 1;
  };
  /** The pending signal at now of each other open chain (last signal not a stop, before now, at most gapMs old): its last flags, no input, no stop. */
  const pendingAt = (signals, id, now, gapMs) => {
    const last = new Map();
    for (const g of signals) if (!last.has(g.chain) || g.seq > last.get(g.chain).seq) last.set(g.chain, g);
    return [...last.values()]
      .filter((l) => l.chain !== id && !l.stop && l.at < now && now - l.at <= gapMs)
      .map((l) => ({ ...l, seq: l.seq + 1, at: now, stop: false, input: false }));
  };
  /** A seed's answers: rules, cohort (every fourth seed's ends at the midnight inside its evidence) and set times by seed; the unit's time through now as the server reads it. */
  const answers = (seed) => {
    const signals = randomEvidence(seed);
    const { counting } = REASON_RULES[seed % REASON_RULES.length];
    const cohort = seed % 4 === 0 ? cohortRange(DAY, DAY) : cohortRange(DAY, nextDay(DAY));
    const setMs = new Map([['u1', (seed % 7) * 60 * S + 1], ['u2', 90 * 60 * S]]);
    return signals.filter((s) => !s.stop).map((s) => {
      const ev = signals.filter((g) => g.at <= s.at);
      const prev = ev.find((g) => g.chain === s.chain && g.seq === s.seq - 1) ?? null;
      const unitMs = countDays({ fromDay: DAY, toDay: jstDayOf(s.at), signals: ev, rulesOf: () => ({ counting }), setMsOf: () => setMs, carriedMs: NONE, cohort }).carriedAfterMs.get(s.unit) ?? 0;
      const reason = studyReason({
        now: s.at, chain: { id: s.chain, unit: s.unit, prevAt: prev ? prev.at : null }, signal: { focus: s.focus, input: s.input },
        signals: ev, counting, setMs: setMs.get(s.unit), unitMs, cohort,
      });
      return { s, ev, prev, unitMs, setMs: setMs.get(s.unit), reason, counting, cohort };
    });
  };
  /** seed → its reasons, for the coverage check */
  const reasonsOf = new Map();

  for (let seed = 1; seed <= 300; seed += 1) {
    it(`seed ${seed}: null exactly when countSpan gives the unit the pair's last credited millisecond (pending pairs included); otherwise the first match`, () => {
      const cases = answers(seed);
      reasonsOf.set(seed, cases.map((c) => c.reason));
      for (const { s, ev, prev, unitMs, setMs, reason, counting, cohort } of cases) {
        const where = `${s.chain}#${s.seq} → ${reason}`;
        assert.ok(REASONS.includes(reason), where);
        if (s.at < cohort.from || s.at >= cohort.to) { assert.equal(reason, 'not_in_session', where); continue; }
        if (unitMs >= setMs) { assert.equal(reason, 'cap_reached', where); continue; }
        if (!prev) { assert.equal(reason, 'starting', where); continue; }
        if (s.at - prev.at > counting.gapMs) { assert.equal(reason, 'gap', where); continue; }
        // from here the cap does not decide (unitMs < setMs)
        const x = prev.at + Math.min(s.at - prev.at, counting.creditCapMs) - 1;
        const evidence = [...ev, ...pendingAt(ev, s.chain, s.at, counting.gapMs)];
        assert.equal(reason === null, getsAt(x, s.unit, evidence, counting, cohort), `${where}: null exactly when the unit gets x`);
        const own = ev.filter((g) => g.chain === s.chain);
        const covered = own.some((g) => g.input && g.at <= x && x < g.at + counting.idleMs);
        assert.equal(covered, getsAt(x, s.unit, own, { ...counting, requireFocus: false }, cohort), `${where}: the page's presence as countSpan has it`);
        if (reason === 'focus') assert.ok(counting.requireFocus && !s.focus, where);
        if (reason === 'idle' || reason === 'starting') {
          assert.equal(covered, false, `${where}: no input of the page covers x`);
          assert.equal(reason === 'starting', s.input, `${where}: starting exactly when this signal brings an input`);
        }
        if (reason === 'other_tab') assert.equal(covered, true, `${where}: the page's presence covers x`);
        if (reason !== null) assert.equal(reason, counting.requireFocus && !s.focus ? 'focus' : covered ? 'other_tab' : s.input ? 'starting' : 'idle', `${where}: the first match`);
        // who has x: a page of the unit (null); a page of another unit that wins, or both lose (other_tab)
        const pages = [...new Set(ev.map((g) => g.chain))].map((id) => ({ id, unit: ev.find((g) => g.chain === id).unit }));
        const alone = (page) => getsAt(x, page.unit, evidence.filter((g) => g.chain === page.id), counting, cohort);
        if (reason === null) assert.ok(pages.some((p) => p.unit === s.unit && alone(p)), `${where}: from this page or another page of the unit`);
        if (reason === 'other_tab') {
          assert.ok(alone({ id: s.chain, unit: s.unit }), `${where}: alone, this page would count x`);
          assert.ok(pages.some((p) => p.unit !== s.unit && alone(p)), `${where}: a page of another unit has x`);
          const units = countSpan({ a: x, b: x + 1, signals: evidence, rules: { counting }, setMs: NONE, carriedMs: NONE, cohort }).units.map((u) => u.unit);
          if (counting.overlap === 'drop_conflicts') assert.deepEqual(units, [], `${where}: both lose`);
          else assert.ok(units.length === 1 && units[0] !== s.unit, `${where}: another unit wins`);
        }
      }
    });
  }

  it('every reason occurs across the seeds and rule variants (each a valid rules file)', () => {
    for (const rules of REASON_RULES) assert.ok(parseTimeRules(rules).ok, JSON.stringify(rules.counting));
    const tally = new Map(REASONS.map((r) => [r, 0]));
    for (let seed = 1; seed <= 300; seed += 1) {
      for (const r of reasonsOf.get(seed) ?? answers(seed).map((c) => c.reason)) tally.set(r, (tally.get(r) ?? 0) + 1);
    }
    const shown = JSON.stringify(Object.fromEntries([...tally].map(([r, n]) => [String(r), n])));
    for (const reason of REASONS) assert.ok(tally.get(reason) > 0, `${reason} never occurred: ${shown}`);
  });
});
