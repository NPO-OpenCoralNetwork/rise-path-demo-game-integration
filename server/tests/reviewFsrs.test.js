// Phase 6 stage 1 (design §1, §7.1): the FSRS-6 scheduler in shared/review/fsrs.js and the lesson
// priors in shared/review/queue.js, against the published vectors of the reference implementations
// (py-fsrs 6.3.2 tests/test_basic.py, ts-fsrs 5.4.2 __tests__/FSRS-6.test.ts, fsrs-rs 6.6.2
// src/inference.rs) and day-only traces computed twice independently from the formulas (design
// [judge] and [critic]). Also the deterministic fuzz, the input checks and the purity of
// shared/review/*.js (M1).
// Tolerances: S and D abs 1e-4 (py test_memo_state uses abs=1e-4; fsrs-rs computes in f32);
// R abs 1e-6; intervals exact unless stated.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  AGAIN,
  DEFAULT_PARAMETERS,
  DESIRED_RETENTION,
  D_MAX,
  D_MIN,
  FSRS_VERSION,
  GOOD,
  GRADE_OF,
  MAX_INTERVAL_DAYS,
  S_MAX,
  S_MIN,
  createScheduler,
  fmix32,
  fnv1a32,
  scheduler,
  seededUnit,
} from '../../shared/review/fsrs.js';
import { LESSON_PRIORS, riskOf } from '../../shared/review/queue.js';
import { ROOT } from './helpers/publishedLessons.js';

const S_D_TOL = 1e-4;
const R_TOL = 1e-6;

/** @param {number} actual @param {number} expected @param {number} tol @param {string} [what] */
const near = (actual, expected, tol, what = '') => {
  assert.ok(Number.isFinite(actual), `${what} is finite (${actual})`);
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} is within ${tol} of ${expected}`);
};

/**
 * Runs ratings [grade, t] in order from a new card, without fuzz.
 * @param {ReturnType<typeof createScheduler>} s
 * @param {[number, number][]} steps
 */
const replay = (s, steps) => {
  /** @type {{ stability: number, difficulty: number } | null} */
  let memory = null;
  return steps.map(([grade, t]) => {
    const next = s.review(memory, /** @type {1|2|3|4} */ (grade), t);
    memory = { stability: next.stability, difficulty: next.difficulty };
    return next;
  });
};

/** Each review on its due day (t = the previous interval), starting from a new card. */
const onSchedule = (s, grades) => {
  let memory = null;
  let t = 0;
  return grades.map((grade) => {
    const next = s.review(memory, grade, t);
    memory = { stability: next.stability, difficulty: next.difficulty };
    t = next.intervalDays;
    return next;
  });
};

/** @param {{ stability: number, difficulty: number, intervalDays: number }[]} got @param {[number, number, number][]} want */
const assertTrace = (got, want, label) => {
  assert.equal(got.length, want.length, `${label}: steps`);
  want.forEach(([s, d, i], k) => {
    near(got[k].stability, s, S_D_TOL, `${label} step ${k + 1} S`);
    near(got[k].difficulty, d, S_D_TOL, `${label} step ${k + 1} D`);
    assert.equal(got[k].intervalDays, i, `${label} step ${k + 1} interval`);
  });
};

const wide = createScheduler({ maxInterval: 36500 });

describe('FSRS-6 parameters (T1)', () => {
  it('has the 21 published default parameters, frozen', () => {
    assert.equal(FSRS_VERSION, 'FSRS-6');
    assert.deepEqual([...DEFAULT_PARAMETERS], [
      0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
      1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ]);
    assert.ok(Object.isFrozen(DEFAULT_PARAMETERS));
    assert.deepEqual([...scheduler.parameters], [...DEFAULT_PARAMETERS]);
    assert.ok(Object.isFrozen(scheduler));
  });

  it('uses r = 0.9, at most 365 days, the clamps, and the two buttons', () => {
    assert.equal(DESIRED_RETENTION, 0.9);
    assert.equal(scheduler.retention, 0.9);
    assert.equal(MAX_INTERVAL_DAYS, 365);
    assert.equal(scheduler.maxInterval, 365);
    assert.deepEqual([S_MIN, S_MAX, D_MIN, D_MAX], [0.001, 36500, 1, 10]);
    assert.deepEqual({ ...GRADE_OF }, { again: 1, good: 3 });
    assert.equal(AGAIN, 1);
    assert.equal(GOOD, 3);
    assert.ok(Object.isFrozen(GRADE_OF));
  });

  it('DECAY = −w20 and FACTOR = 0.9^(1/DECAY) − 1 = 0.9803464944134797', () => {
    assert.equal(scheduler.DECAY, -0.1542);
    near(scheduler.FACTOR, 0.9803464944134797, 1e-12, 'FACTOR');
  });
});

describe('FSRS-6 published vectors', () => {
  it('V2: memory state after 1,3,3,3,3,3 at t 0,0,1,3,8,21 (py, ts, rs): S 53.62691, D 6.3574867, with the day-only trace', () => {
    const trace = replay(wide, [[1, 0], [3, 0], [3, 1], [3, 3], [3, 8], [3, 21]]);
    near(trace[5].stability, 53.62691, S_D_TOL, 'final S');
    near(trace[5].difficulty, 6.3574867, S_D_TOL, 'final D');
    assertTrace(trace, [
      [0.212, 6.4133, 1],
      [0.246689, 6.402115, 1],
      [2.021477, 6.390941, 2],
      [7.863699, 6.379779, 8],
      [21.917713, 6.368627, 22],
      [53.626903, 6.357487, 54],
    ], 'V2');
    // The same trace under the 365-day cap: no interval reaches it.
    assert.deepEqual(replay(scheduler, [[1, 0], [3, 0], [3, 1], [3, 3], [3, 8], [3, 21]]).map((x) => x.intervalDays), [1, 1, 2, 8, 22, 54]);
  });

  it('V3: the first rating 1..4 (ts): S0 and D0, whole-day intervals 1, 1, 2, 8', () => {
    const want = [[0.212, 6.4133, 1], [1.2931, 5.11217071, 1], [2.3065, 2.11810397, 2], [8.2956, 1, 8]];
    for (const g of /** @type {const} */ ([1, 2, 3, 4])) {
      const [s, d, i] = want[g - 1];
      const first = scheduler.review(null, g, 0);
      near(first.stability, s, 1e-8, `S0(${g})`);
      near(first.difficulty, d, 1e-8, `D0(${g})`);
      assert.equal(first.intervalDays, i, `I(${g})`);
      near(scheduler.initialStability(g), s, 1e-12, `initialStability(${g})`);
      near(scheduler.initialDifficulty(g), d, 1e-8, `initialDifficulty(${g})`);
    }
  });

  it('V4: retrievability (ts, rs): R(8, 8.2956) = 0.9024733; decay 0.2 at S = 1, t 0..3', () => {
    near(scheduler.retrievability(8, 8.2956), 0.9024733, R_TOL, 'R(8, 8.2956)');
    const want = [1, 0.9, 0.84028935, 0.7985001];
    want.forEach((r, t) => near(scheduler.retrievability(t, 1, 0.2), r, R_TOL, `R(${t}, 1, w20 0.2)`));
  });

  it('V4b: R(S, S) = 0.9 for any S', () => {
    for (const s of [0.5, 2.3065, 100]) near(scheduler.retrievability(s, s), 0.9, 1e-12, `R(${s}, ${s})`);
  });

  it('V5: next interval at S = 1 for r = 0.2…0.9 (rs), r = 0.1 within relative 1e-5 (f32), r = 1 refused', () => {
    const want = { 0.2: 34793, 0.3: 2508, 0.4: 387, 0.5: 90, 0.6: 27, 0.7: 9, 0.8: 3, 0.9: 1 };
    for (const [r, i] of Object.entries(want)) {
      assert.equal(createScheduler({ retention: Number(r), maxInterval: 1e9 }).nextInterval(1), i, `r ${r}`);
    }
    const low = createScheduler({ retention: 0.1, maxInterval: 1e9 }).nextInterval(1);
    assert.ok(Math.abs(low - 3116766) / 3116766 <= 1e-5, `r 0.1: ${low}`);
    assert.throws(() => createScheduler({ retention: 1.0 }), RangeError);
  });
});

describe('FSRS-6 day-only traces (computed twice independently: design [judge] = [critic])', () => {
  it('V7: 3,3,3,1,3,3,3, each on its due day', () => {
    assertTrace(onSchedule(scheduler, [3, 3, 3, 1, 3, 3, 3]), [
      [2.3065, 2.118104, 2],
      [10.964332, 2.111214, 11],
      [46.280217, 2.104331, 46],
      [2.93258, 7.389976, 3],
      [7.778226, 7.377814, 8],
      [18.781634, 7.365665, 19],
      [41.529277, 7.353527, 42],
    ], 'V7');
  });

  it('V8: Again (new), then Good the same day', () => {
    const [, second] = replay(scheduler, [[1, 0], [3, 0]]);
    near(second.stability, 0.246689, S_D_TOL, 'S');
    near(second.difficulty, 6.402115, S_D_TOL, 'D');
    assert.equal(second.intervalDays, 1);
  });

  it('V9: Good (new), then Good the next calendar day (t = 1) vs the same day (t = 0)', () => {
    const next = replay(scheduler, [[3, 0], [3, 1]])[1];
    near(next.stability, 7.315301, S_D_TOL, 't 1 S');
    assert.equal(next.intervalDays, 7);
    const same = replay(scheduler, [[3, 0], [3, 0]])[1];
    near(same.stability, 2.3065, S_D_TOL, 't 0 S');
    assert.equal(same.intervalDays, 2);
  });

  it('V10: all Good on the due day: the 365-day cap from the 5th review', () => {
    assert.deepEqual(onSchedule(scheduler, [3, 3, 3, 3, 3, 3]).map((x) => x.intervalDays), [2, 11, 46, 163, 365, 365]);
    assert.deepEqual(onSchedule(wide, [3, 3, 3, 3, 3, 3]).map((x) => x.intervalDays), [2, 11, 46, 163, 497, 1346]);
  });

  it('V11: Again (new), Again t 1, Good t 1, Good t 1', () => {
    const trace = replay(scheduler, [[1, 0], [1, 1], [3, 1], [3, 1]]);
    [0.212, 0.100886, 0.683207, 1.805996].forEach((s, k) => near(trace[k].stability, s, S_D_TOL, `step ${k + 1} S`));
    assert.deepEqual(trace.map((x) => x.intervalDays), [1, 1, 1, 2]);
  });

  it('V12: from Good (new): Good t 12; Again t 12; Good t 12 then Again t 12', () => {
    const good = scheduler.review(null, GOOD, 0);
    const a = scheduler.review(good, GOOD, 12);
    near(a.stability, 27.078176, S_D_TOL, '(a) S');
    assert.equal(a.intervalDays, 27);
    const b = scheduler.review(good, AGAIN, 12);
    near(b.stability, 0.781651, S_D_TOL, '(b) S');
    near(b.difficulty, 7.394503, S_D_TOL, '(b) D');
    assert.equal(b.intervalDays, 1);
    const c = scheduler.review(a, AGAIN, 12);
    near(c.stability, 2.173674, S_D_TOL, '(c) S');
    near(c.difficulty, 7.392238, S_D_TOL, '(c) D');
    assert.equal(c.intervalDays, 2);
  });

  it('Hard and Easy recall factors (w15, w16): from the Good prior at t 2, Hard < Good < Easy', () => {
    // Production stores only 1 and 3; review() accepts 2 and 4 for the published vectors, so the
    // two factors are pinned here (V3 uses 2 and 4 only for a first rating, which skips them).
    // Values computed twice: this module and an independent re-derivation from py-fsrs scheduler.py.
    const hard = scheduler.review(LESSON_PRIORS.good, 2, 2);
    near(hard.stability, 7.51332, S_D_TOL, 'Hard S');
    near(hard.difficulty, 4.752858, S_D_TOL, 'Hard D');
    assert.equal(hard.intervalDays, 8);
    const easy = scheduler.review(LESSON_PRIORS.good, 4, 2);
    near(easy.stability, 18.521754, S_D_TOL, 'Easy S');
    assert.equal(easy.difficulty, D_MIN);
    assert.equal(easy.intervalDays, 19);
    const good = scheduler.review(LESSON_PRIORS.good, GOOD, 2);
    assert.ok(hard.stability < good.stability && good.stability < easy.stability);
  });
});

describe('the lesson as the first rating (L1–L4)', () => {
  it('L1: LESSON_PRIORS are the first-rating memories of Good and Again', () => {
    near(LESSON_PRIORS.good.stability, 2.3065, 1e-12, 'good S');
    near(LESSON_PRIORS.good.difficulty, 2.11810397, 1e-8, 'good D');
    assert.equal(LESSON_PRIORS.good.intervalDays, 2);
    near(LESSON_PRIORS.again.stability, 0.212, 1e-12, 'again S');
    near(LESSON_PRIORS.again.difficulty, 6.4133, 1e-8, 'again D');
    assert.equal(LESSON_PRIORS.again.intervalDays, 1);
    assert.deepEqual(LESSON_PRIORS.good, scheduler.review(null, GOOD, 0));
    assert.deepEqual(LESSON_PRIORS.again, scheduler.review(null, AGAIN, 0));
    assert.ok(Object.isFrozen(LESSON_PRIORS) && Object.isFrozen(LESSON_PRIORS.good) && Object.isFrozen(LESSON_PRIORS.again));
  });

  it('L2: Again prior, then Good the next day', () => {
    const next = scheduler.review(LESSON_PRIORS.again, GOOD, 1);
    near(next.stability, 1.886788, S_D_TOL, 'S');
    near(next.difficulty, 6.402115, S_D_TOL, 'D');
    assert.equal(next.intervalDays, 2);
    // A smaller S than grading the card as new with Good (2.3065).
    assert.ok(next.stability < scheduler.review(null, GOOD, 0).stability);
  });

  it('L3: Good prior learned 8 days ago, then Good; or Again instead', () => {
    const good = scheduler.review(LESSON_PRIORS.good, GOOD, 8);
    near(good.stability, 22.76818, S_D_TOL, 'Good S');
    assert.equal(good.intervalDays, 23);
    const again = scheduler.review(LESSON_PRIORS.good, AGAIN, 8);
    near(again.stability, 0.732872, S_D_TOL, 'Again S');
    near(again.difficulty, 7.394503, S_D_TOL, 'Again D');
    assert.equal(again.intervalDays, 1);
  });

  it('L4: riskOf is R(daysSince, S); no memory is Infinity', () => {
    near(riskOf({ stability: LESSON_PRIORS.good.stability, daysSince: 2 }), 0.909493, R_TOL, 'Good prior t 2');
    near(riskOf({ stability: LESSON_PRIORS.good.stability, daysSince: 8 }), 0.795747, R_TOL, 'Good prior t 8');
    near(riskOf({ stability: LESSON_PRIORS.again.stability, daysSince: 1 }), 0.766196, R_TOL, 'Again prior t 1');
    assert.equal(riskOf({ stability: null, daysSince: null }), Infinity);
  });

  it('a Good prior on schedule is V7\'s second step (S 10.964332, I 11)', () => {
    const next = scheduler.review(LESSON_PRIORS.good, GOOD, LESSON_PRIORS.good.intervalDays);
    near(next.stability, 10.964332, S_D_TOL, 'S');
    assert.equal(next.intervalDays, 11);
  });
});

describe('rounding, clamps and input checks (T9, T13)', () => {
  it('T9: intervals round half up (Math.round, as ts-fsrs): nextInterval(2.5) = 3 (py would give 2)', () => {
    assert.equal(scheduler.nextInterval(2.5), 3);
    assert.equal(scheduler.nextInterval(1.5), 2);
    assert.equal(scheduler.nextInterval(2.4999), 2);
    assert.equal(scheduler.nextInterval(0.001), 1);
  });

  it('T13: 50 Agains keep D ≤ 10 and S ≥ 0.001; S stops at 36500; nextInterval stops at 365', () => {
    for (const t of [0, 1]) {
      let memory = scheduler.review(null, AGAIN, 0);
      for (let k = 0; k < 50; k += 1) {
        memory = scheduler.review(memory, AGAIN, t);
        assert.ok(memory.difficulty <= 10 && memory.difficulty >= 1, `D ${memory.difficulty}`);
        assert.ok(memory.stability >= 0.001, `S ${memory.stability}`);
        assert.ok(memory.intervalDays >= 1);
      }
      // Mean reversion toward D0(4) holds D just under the clamp (fixed point ≈ 9.985).
      assert.ok(memory.difficulty > 9.9, `t ${t}: D ${memory.difficulty} near the top`);
    }
    const tiny = scheduler.review({ stability: S_MIN, difficulty: D_MAX }, AGAIN, 1);
    assert.equal(tiny.stability, S_MIN);
    const huge = wide.review({ stability: S_MAX, difficulty: D_MIN }, GOOD, 36500);
    assert.equal(huge.stability, S_MAX);
    assert.equal(huge.intervalDays, 36500);
    assert.equal(scheduler.nextInterval(1e9), 365);
    assert.equal(scheduler.review({ stability: S_MAX, difficulty: D_MIN }, GOOD, 400).intervalDays, 365);
    assert.equal(scheduler.nextDifficulty(1, 4), 1);
    near(scheduler.nextDifficulty(10, 1), 9.985228, S_D_TOL, 'D after Again at the top');
    assert.equal(scheduler.nextDifficulty(1, 3), 1);
  });

  it('T13: refuses bad grades, days, memories, fuzz units and settings with RangeError', () => {
    const good = scheduler.review(null, GOOD, 0);
    for (const grade of [0, 5, 2.5, '3', null, undefined]) {
      assert.throws(() => scheduler.review(good, /** @type {any} */ (grade), 1), RangeError, `grade ${grade}`);
    }
    for (const t of [-1, 1.5, NaN, Infinity, '1', null]) {
      assert.throws(() => scheduler.review(good, GOOD, /** @type {any} */ (t)), RangeError, `t ${t}`);
    }
    for (const memory of [
      { stability: 0, difficulty: 5 },
      { stability: NaN, difficulty: 5 },
      { stability: 36501, difficulty: 5 },
      { stability: 2, difficulty: 0.5 },
      { stability: 2, difficulty: 11 },
      { stability: 2, difficulty: Infinity },
      { stability: '2', difficulty: 5 },
      { stability: 2 },
      'memory',
    ]) {
      assert.throws(() => scheduler.review(/** @type {any} */ (memory), GOOD, 1), RangeError, `memory ${JSON.stringify(memory)}`);
    }
    for (const fuzzUnit of [1, -0.1, NaN, '0.5']) {
      assert.throws(() => scheduler.review(good, GOOD, 2, { fuzzUnit: /** @type {any} */ (fuzzUnit) }), RangeError, `fuzzUnit ${fuzzUnit}`);
    }
    assert.throws(() => createScheduler({ w: DEFAULT_PARAMETERS.slice(0, 20) }), RangeError);
    assert.throws(() => createScheduler({ w: [...DEFAULT_PARAMETERS.slice(0, 20), NaN] }), RangeError);
    for (const retention of [0, 1, -0.5, 1.5, NaN]) assert.throws(() => createScheduler({ retention }), RangeError, `retention ${retention}`);
    for (const maxInterval of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createScheduler({ maxInterval }), RangeError, `maxInterval ${maxInterval}`);
  });

  it('a lapse never leaves S above S / e^(w17·w18) (py scheduler.py:766-783, ts algorithm.ts:393-400)', () => {
    // Long overdue, low difficulty: the wiki formula alone gives 0.236749, more than before the lapse.
    const lapse = scheduler.review({ stability: 0.212, difficulty: 1 }, AGAIN, 365);
    near(lapse.stability, 0.212 / Math.exp(0.5425 * 0.0912), 1e-12, 'capped S');
    near(lapse.stability, 0.201766, S_D_TOL, 'S');
    assert.equal(lapse.intervalDays, 1);
  });

  it('a new card ignores elapsed days', () => {
    assert.deepEqual(scheduler.review(null, GOOD, 9), scheduler.review(null, GOOD, 0));
  });
});

describe('deterministic fuzz (F1–F5)', () => {
  it('F1: fuzzRange(I, elapsedDays)', () => {
    const cases = [
      [[1, 0], [1, 1]], [[3, 2], [3, 4]], [[5, 2], [4, 6]], [[7, 2], [5, 9]], [[11, 2], [9, 13]],
      [[20, 2], [17, 23]], [[46, 2], [42, 50]], [[100, 2], [93, 107]], [[163, 2], [153, 173]],
      [[365, 2], [345, 365]], [[10, 0], [8, 12]], [[3, 0], [2, 4]], [[30, 40], [27, 33]],
    ];
    for (const [[interval, elapsed], want] of cases) {
      assert.deepEqual(scheduler.fuzzRange(interval, elapsed), want, `fuzzRange(${interval}, ${elapsed})`);
    }
  });

  it('F2: FNV-1a 32 reference values', () => {
    assert.equal(fnv1a32(''), 0x811c9dc5);
    assert.equal(fnv1a32('a'), 0xe40c292c);
    assert.equal(fnv1a32('foobar'), 0xbf9cf968);
    // UTF-8 bytes, not UTF-16 code units: 「あ」 is e3 81 82.
    let h = 0x811c9dc5;
    for (const byte of [0xe3, 0x81, 0x82]) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
    assert.equal(fnv1a32('あ'), h);
  });

  it('F3: seededUnit values and two fuzzed second reviews', () => {
    assert.equal(seededUnit('a#0'), 0.528446231270209);
    assert.equal(seededUnit(''), 0.6689221884589642);
    assert.equal(fmix32(0), 0);
    const second = (seed) => scheduler.review(LESSON_PRIORS.good, GOOD, 2, { fuzzUnit: seededUnit(seed) });
    const plan = second('claude-code/cc-01-first-session/card-plan#2');
    near(plan.stability, 10.964332, S_D_TOL, 'S');
    assert.equal(plan.intervalDays, 9);
    assert.equal(second('vibe-coding/vibe-ch1/card-goal#2').intervalDays, 10);
  });

  it('F4: a fuzzed interval stays in fuzzRange, the same seed gives the same day, and I < 3 is never fuzzed', () => {
    // Memories whose unfuzzed interval is 3, 11, 46 and 365 (V7, V10 traces).
    const v7 = onSchedule(scheduler, [3, 3, 3]);
    const mem = (x) => ({ stability: x.stability, difficulty: x.difficulty });
    const v10 = onSchedule(scheduler, [3, 3, 3, 3]);
    const setups = [
      { memory: mem(v7[2]), grade: AGAIN, t: 46, interval: 3 },
      { memory: mem(v7[0]), grade: GOOD, t: 2, interval: 11 },
      { memory: mem(v7[1]), grade: GOOD, t: 11, interval: 46 },
      { memory: mem(v10[3]), grade: GOOD, t: 163, interval: 365 },
    ];
    for (const { memory, grade, t, interval } of setups) {
      assert.equal(scheduler.review(memory, grade, t).intervalDays, interval, `unfuzzed ${interval}`);
      const [lo, hi] = scheduler.fuzzRange(interval, t);
      const seen = new Set();
      for (let k = 0; k < 10_000; k += 1) {
        const seed = `course/lesson/card-${k}#${k % 7}`;
        const fuzzed = scheduler.review(memory, grade, t, { fuzzUnit: seededUnit(seed) }).intervalDays;
        assert.ok(Number.isInteger(fuzzed) && fuzzed >= lo && fuzzed <= hi, `I ${interval}: ${fuzzed} in [${lo}, ${hi}]`);
        if (k < 50) assert.equal(scheduler.review(memory, grade, t, { fuzzUnit: seededUnit(seed) }).intervalDays, fuzzed);
        seen.add(fuzzed);
      }
      assert.equal(seen.size, hi - lo + 1, `I ${interval}: every day of [${lo}, ${hi}] is reached`);
      assert.equal(scheduler.review(memory, grade, t, { fuzzUnit: 0 }).intervalDays, lo);
      assert.equal(scheduler.review(memory, grade, t, { fuzzUnit: 0.999999999 }).intervalDays, hi);
    }
    for (let k = 0; k < 1000; k += 1) {
      const fuzzUnit = seededUnit(`short#${k}`);
      assert.equal(scheduler.review(null, AGAIN, 0, { fuzzUnit }).intervalDays, 1);
      assert.equal(scheduler.review(null, GOOD, 0, { fuzzUnit }).intervalDays, 2);
      assert.equal(scheduler.review(LESSON_PRIORS.again, GOOD, 1, { fuzzUnit }).intervalDays, 2);
    }
  });

  it('F5: seededUnit spreads 100,000 seeds evenly over 10 bins (±5 %), and one card\'s reviews apart', () => {
    const bins = new Array(10).fill(0);
    for (let k = 0; k < 100_000; k += 1) {
      const u = seededUnit(`claude-code/cc-${k % 11}/card-${k % 97}#${k}`);
      assert.ok(u >= 0 && u < 1);
      bins[Math.floor(u * 10)] += 1;
    }
    for (const [bin, count] of bins.entries()) assert.ok(Math.abs(count - 10_000) <= 500, `bin ${bin}: ${count}`);
    // The finalizer matters: without fmix32, '#1'…'#9' of one card land within ~4 % of each other.
    const units = Array.from({ length: 9 }, (_, k) => seededUnit(`claude-code/cc-03-plan-first/card-good-spec#${k + 1}`));
    assert.ok(Math.max(...units) - Math.min(...units) > 0.5, `spread ${units.join(', ')}`);
  });
});

describe('shared/review purity (M1)', () => {
  const DIR = path.join(ROOT, 'shared/review');
  const files = fs.readdirSync(DIR).filter((name) => /\.[cm]?[jt]sx?$/.test(name)).sort();
  /** Runtime import specifiers (static, re-export, dynamic, require); comments and JSDoc types are ignored. */
  const importsOf = (text) => ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
  /** `Date` identifiers and `Math.random` accesses in code (not comments or strings). */
  const clockAndRandom = (name, text) => {
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const found = [];
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === 'Date') found.push('Date');
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'Math' && node.name.text === 'random') found.push('Math.random');
      if (ts.isElementAccessExpression(node) && node.expression.getText(source) === 'Math') found.push('Math[…]');
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };

  it('finds Date and Math.random in code and ignores comments and strings', () => {
    assert.deepEqual(clockAndRandom('x.js', '// Date, Math.random\nconst a = "Date";\n'), []);
    assert.deepEqual(clockAndRandom('x.js', 'const a = Date.now();\nconst b = Math.random();\n'), ['Date', 'Math.random']);
    assert.deepEqual(clockAndRandom('x.js', 'const d = new globalThis.Date();'), ['Date']);
  });

  it('holds exactly fsrs.js, queue.js and cards.js', () => {
    assert.deepEqual(files, ['cards.js', 'fsrs.js', 'queue.js']);
  });

  for (const name of files) {
    it(`${name}: // @ts-check, allowed imports only, no Date, no Math.random`, () => {
      const text = fs.readFileSync(path.join(DIR, name), 'utf8');
      assert.match(text, /^\/\/ @ts-check\n/, `${name} starts with // @ts-check`);
      assert.deepEqual(importsOf(text), name === 'queue.js' ? ['./fsrs.js'] : [], `${name} imports`);
      assert.deepEqual(clockAndRandom(name, text), [], `${name} reads no clock and no random source`);
    });
  }
});
