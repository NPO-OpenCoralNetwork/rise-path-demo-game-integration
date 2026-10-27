// @ts-check
/**
 * FSRS-6 (Free Spaced Repetition Scheduler, version 6) for the Phase 6 review queue
 * (doc/brushup-2026/ai-access-plan.ja.md §10). Written in this repository from the published
 * formulas, no code copied: "The Algorithm", awesome-fsrs wiki, commit 7bcf7dc,
 * https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm. Checked against the
 * reference implementations and their test vectors: py-fsrs 6.3.2 (fsrs/scheduler.py @ 9446cb0, MIT),
 * ts-fsrs 5.4.2 (packages/fsrs/src, MIT), fsrs-rs 6.6.2 (src/inference.rs, BSD-3-Clause).
 * The 21 default parameters are FSRS-6's published defaults (open-spaced-repetition, MIT/BSD-3-Clause).
 * Rise Path choices: desired retention 0.9; whole days only (no minute learning or relearning
 * steps; the caller passes whole Japan-time days computed in SQL, as fsrs-rs takes integer
 * days_elapsed); maximum interval 365 days; stability clamped to [0.001, 36500] (py STABILITY_MIN,
 * ts S_MAX); Math.round (half up, as ts-fsrs; py-fsrs rounds half to even); deterministic fuzz
 * (FNV-1a 32 + murmur3 fmix32 of "<course>/<lesson>/<card>#<reps after>"). Two buttons: 1 Again
 * (「もう一度」), 3 Good (「覚えた」); grades 2 and 4 exist only so the published vectors run.
 * Pure: no imports, no Date, no Math.random.
 *
 * Symbols: R retrievability, S stability in days (the t at which R = 0.9), D difficulty in [1, 10],
 * G grade, t whole days since the last rating.
 *   R(t, S)        = (1 + FACTOR·t/S)^DECAY, DECAY = −w20, FACTOR = 0.9^(1/DECAY) − 1   (wiki :44-48)
 *   S0(G)          = w[G−1]                                                            (wiki :140-144)
 *   D0(G)          = w4 − e^(w5·(G−1)) + 1, clamped to [1, 10]                          (wiki :70-74)
 *   D'(D, G)       = w7·D0(4) + (1 − w7)·(D − w6·(G−3)·(10 − D)/9), D0(4) not clamped   (wiki :78-88)
 *   recall (G ≥ 2) = S·(1 + e^w8·(11 − D)·S^(−w9)·(e^(w10·(1−R)) − 1)·(w15 if G=2)·(w16 if G=4))
 *                                                                                       (wiki :178-191)
 *   lapse (G = 1)  = min(w11·D^(−w12)·((S+1)^w13 − 1)·e^(w14·(1−R)), S / e^(w17·w18))  (wiki :210-219;
 *                    the cap is py scheduler.py:766-783, ts algorithm.ts:393-400)
 *   same day (t=0) = S·e^(w17·(G−3+w18))·S^(−w19), at least S when G ≥ 2               (wiki :34-40)
 *   interval       = round((S/FACTOR)·(r^(1/DECAY) − 1)), in [1, maxInterval]; S at r = 0.9 (wiki :114-118)
 * The new S uses the old D; D is updated after (py scheduler.py:336-357).
 * Fuzz ranges: py FUZZ_RANGES (scheduler.py:109-125) = ts help.ts:177-213; the pick is ts apply_fuzz.
 */

export const FSRS_VERSION = 'FSRS-6';

/** w0…w20 (wiki :24-26; py scheduler.py:31-54; ts src/constant.ts:22-46; rs src/inference.rs:21-49). */
export const DEFAULT_PARAMETERS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);
export const DESIRED_RETENTION = 0.9;
/** Rise Path's cap on one interval (FSRS's default is 36500): card text is edited under kept ids. Also migration 020's CHECKs. */
export const MAX_INTERVAL_DAYS = 365;
export const S_MIN = 0.001;
export const S_MAX = 36500;
export const D_MIN = 1;
export const D_MAX = 10;
export const AGAIN = 1;
export const GOOD = 3;
/** The API's two ratings (R3): 「もう一度」 and 「覚えた」. */
export const GRADE_OF = Object.freeze({ again: AGAIN, good: GOOD });

/** [start, end, factor] of each fuzz band (py FUZZ_RANGES, ts help.ts). */
const FUZZ_RANGES = Object.freeze([
  Object.freeze([2.5, 7, 0.15]),
  Object.freeze([7, 20, 0.1]),
  Object.freeze([20, Infinity, 0.05]),
]);

/** @typedef {{ stability: number, difficulty: number }} Memory */
/** @typedef {{ stability: number, difficulty: number, intervalDays: number }} ReviewResult */
/** @typedef {1 | 2 | 3 | 4} Grade */

/**
 * @typedef {object} Scheduler
 * @property {readonly number[]} parameters the 21 weights in use
 * @property {number} retention desired retention r
 * @property {number} maxInterval longest interval in days
 * @property {number} FACTOR 0.9^(1/DECAY) − 1, so that R(S, S) = 0.9
 * @property {number} DECAY −w20
 * @property {(t: number, s: number, w20?: number) => number} retrievability R after t days at stability s
 * @property {(g: Grade) => number} initialStability S0(g), clamped
 * @property {(g: Grade) => number} initialDifficulty D0(g), clamped to [1, 10]
 * @property {(d: number, g: Grade) => number} nextDifficulty D after grade g, clamped to [1, 10]
 * @property {(s: number) => number} nextInterval whole days in [1, maxInterval]
 * @property {(interval: number, elapsedDays: number) => [number, number]} fuzzRange [lo, hi] a fuzzed interval stays in
 * @property {(memory: Memory | null, grade: Grade, elapsedDays: number, options?: { fuzzUnit?: number | null }) => ReviewResult} review
 */

/** @param {number} value @param {number} lo @param {number} hi */
const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
const clampS = (/** @type {number} */ s) => clamp(s, S_MIN, S_MAX);
const clampD = (/** @type {number} */ d) => clamp(d, D_MIN, D_MAX);

/** @param {unknown} g @returns {g is Grade} */
const isGrade = (g) => g === 1 || g === 2 || g === 3 || g === 4;

/**
 * An FSRS-6 scheduler with fixed parameters. Every function is pure.
 * @param {{ w?: readonly number[], retention?: number, maxInterval?: number }} [options]
 * @returns {Readonly<Scheduler>}
 * @throws {RangeError} w not 21 finite numbers; retention not in (0, 1); maxInterval not a positive integer
 */
export function createScheduler({ w = DEFAULT_PARAMETERS, retention = DESIRED_RETENTION, maxInterval = MAX_INTERVAL_DAYS } = {}) {
  if (!Array.isArray(w) || w.length !== 21 || !w.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new RangeError('FSRS-6 needs 21 finite parameters');
  }
  if (typeof retention !== 'number' || !(retention > 0 && retention < 1)) {
    throw new RangeError('desired retention must be in (0, 1)');
  }
  if (!Number.isInteger(maxInterval) || maxInterval < 1) {
    throw new RangeError('the maximum interval must be a positive whole number of days');
  }
  const p = Object.freeze([...w]);
  const DECAY = -p[20];
  const FACTOR = 0.9 ** (1 / DECAY) - 1;
  /**
   * (r^(1/DECAY) − 1) / FACTOR: the days until R falls to r, per day of stability. Computed once, so
   * at r = 0.9 it is exactly 1 and I = round(S) (S/FACTOR·FACTOR can land a hair under a .5 tie).
   */
  const intervalPerStability = (retention ** (1 / DECAY) - 1) / FACTOR;
  /** D0(4) before clamping, the target of the mean reversion (wiki :78-88). */
  const easyDifficultyRaw = p[4] - Math.exp(p[5] * 3) + 1;

  /** @param {number} t @param {number} s @param {number} [w20] */
  const retrievability = (t, s, w20 = p[20]) => {
    const decay = -w20;
    const factor = 0.9 ** (1 / decay) - 1;
    return (1 + (factor * t) / s) ** decay;
  };
  /** @param {Grade} g */
  const initialStability = (g) => clampS(p[g - 1]);
  /** @param {Grade} g */
  const initialDifficulty = (g) => clampD(p[4] - Math.exp(p[5] * (g - 1)) + 1);
  /** @param {number} d @param {Grade} g */
  const nextDifficulty = (d, g) => {
    const delta = -p[6] * (g - 3);
    const damped = d + (delta * (10 - d)) / 9;
    return clampD(p[7] * easyDifficultyRaw + (1 - p[7]) * damped);
  };
  /** @param {number} d @param {number} s @param {number} r @param {Grade} g */
  const recallStability = (d, s, r, g) => s * (1
    + Math.exp(p[8]) * (11 - d) * s ** -p[9] * (Math.exp(p[10] * (1 - r)) - 1)
    * (g === 2 ? p[15] : 1) * (g === 4 ? p[16] : 1));
  /** @param {number} d @param {number} s @param {number} r */
  const lapseStability = (d, s, r) => Math.min(
    p[11] * d ** -p[12] * ((s + 1) ** p[13] - 1) * Math.exp(p[14] * (1 - r)),
    s / Math.exp(p[17] * p[18]),
  );
  /** Same-day review; never lowers S for G ≥ 2 (wiki :34-40, ts and fsrs-rs; py applies the floor to 3 and 4). */
  const shortTermStability = (/** @type {number} */ s, /** @type {Grade} */ g) => {
    const increase = Math.exp(p[17] * (g - 3 + p[18])) * s ** -p[19];
    return s * (g >= 2 ? Math.max(increase, 1) : increase);
  };
  /** @param {number} s */
  const nextInterval = (s) => clamp(Math.round(s * intervalPerStability), 1, maxInterval);
  /**
   * The days a fuzzed interval may take. Intervals under 2.5 days are not fuzzed ([I, I]).
   * @param {number} interval
   * @param {number} elapsedDays
   * @returns {[number, number]}
   */
  const fuzzRange = (interval, elapsedDays) => {
    if (interval < 2.5) return [interval, interval];
    let delta = 1;
    for (const [start, end, factor] of FUZZ_RANGES) delta += factor * Math.max(Math.min(interval, end) - start, 0);
    const ivl = Math.min(interval, maxInterval);
    let lo = Math.max(2, Math.round(ivl - delta));
    const hi = Math.min(Math.round(ivl + delta), maxInterval);
    if (ivl > elapsedDays) lo = Math.max(lo, elapsedDays + 1);
    lo = Math.min(lo, hi);
    return [lo, hi];
  };

  /**
   * One rating. memory null = the card's first rating (elapsedDays is then ignored).
   * @param {Memory | null} memory
   * @param {Grade} grade
   * @param {number} elapsedDays whole days since the last rating (0 = the same day)
   * @param {{ fuzzUnit?: number | null }} [options] fuzzUnit in [0, 1) picks the fuzzed day; null: no fuzz
   * @returns {ReviewResult}
   * @throws {RangeError} grade not 1..4; elapsedDays not a non-negative integer; a memory field
   *   not finite or out of range; fuzzUnit not null and not in [0, 1)
   */
  const review = (memory, grade, elapsedDays, { fuzzUnit = null } = {}) => {
    if (!isGrade(grade)) throw new RangeError('grade must be 1, 2, 3 or 4');
    if (!Number.isInteger(elapsedDays) || elapsedDays < 0) throw new RangeError('elapsedDays must be a non-negative integer');
    if (fuzzUnit !== null && !(typeof fuzzUnit === 'number' && fuzzUnit >= 0 && fuzzUnit < 1)) {
      throw new RangeError('fuzzUnit must be null or in [0, 1)');
    }
    let stability;
    let difficulty;
    if (memory === null) {
      stability = initialStability(grade);
      difficulty = initialDifficulty(grade);
    } else {
      if (typeof memory !== 'object'
        || !(typeof memory.stability === 'number' && memory.stability >= S_MIN && memory.stability <= S_MAX)
        || !(typeof memory.difficulty === 'number' && memory.difficulty >= D_MIN && memory.difficulty <= D_MAX)) {
        throw new RangeError(`memory needs stability in [${S_MIN}, ${S_MAX}] and difficulty in [${D_MIN}, ${D_MAX}]`);
      }
      const { stability: s, difficulty: d } = memory;
      if (elapsedDays === 0) {
        stability = shortTermStability(s, grade);
      } else {
        const r = retrievability(elapsedDays, s);
        stability = grade === AGAIN ? lapseStability(d, s, r) : recallStability(d, s, r, grade);
      }
      difficulty = nextDifficulty(d, grade);
    }
    stability = clampS(stability);
    difficulty = clampD(difficulty);
    let intervalDays = nextInterval(stability);
    if (fuzzUnit !== null && intervalDays >= 3) {
      const [lo, hi] = fuzzRange(intervalDays, memory === null ? 0 : elapsedDays);
      intervalDays = Math.floor(fuzzUnit * (hi - lo + 1) + lo);
    }
    return { stability, difficulty, intervalDays };
  };

  return Object.freeze({
    parameters: p,
    retention,
    maxInterval,
    FACTOR,
    DECAY,
    retrievability,
    initialStability,
    initialDifficulty,
    nextDifficulty,
    nextInterval,
    fuzzRange,
    review,
  });
}

const textEncoder = new TextEncoder();

/**
 * FNV-1a, 32 bits, over the UTF-8 bytes of text (offset basis 0x811c9dc5, prime 0x01000193).
 * @param {string} text
 * @returns {number} unsigned 32-bit
 */
export function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (const byte of textEncoder.encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * murmur3's 32-bit finalizer: spreads every input bit over the output, so seeds that differ in
 * one character (the review count) give unrelated fuzz.
 * @param {number} h
 * @returns {number} unsigned 32-bit
 */
export function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A number in [0, 1) fixed by seed: fmix32(fnv1a32(seed)) / 2^32.
 * @param {string} seed
 */
export function seededUnit(seed) {
  return fmix32(fnv1a32(seed)) / 2 ** 32;
}

/** The scheduler with Rise Path's settings (default parameters, r = 0.9, at most 365 days). */
export const scheduler = createScheduler();
