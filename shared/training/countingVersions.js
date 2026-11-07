// @ts-check
/**
 * The counting versions this code can count a day with (doc/brushup-2026/training-plan.ja.md §4.9,
 * D12). Every day row names the version it was counted with (training_time_days.algorithm, from its
 * rules); the check (tools/core/trainingTimeCheck.js) and a recount count each day with its own
 * version's functions, and refuse a version this code does not have rather than count it with
 * another one. A change that alters any result of a version (the golden in
 * server/tests/trainingStudyTime.test.js) needs a new version name: the old one stays here, with
 * its own functions, so the days counted with it can still be recounted and checked, and
 * timeRules.js then parses the rules of every version listed here.
 */
import { STUDY_TIME_ALGORITHM, countDay, evidenceWindow } from './studyTime.js';

/**
 * A version's functions: one Japan-time day with the unit time carried from the days before it,
 * and the evidence a span needs (its signals' times).
 * @typedef {{ countDay: typeof countDay, evidenceWindow: typeof evidenceWindow }} CountingVersion
 */

/** @type {Readonly<Record<string, CountingVersion>>} */
export const COUNTING_VERSIONS = Object.freeze({
  [STUDY_TIME_ALGORITHM]: Object.freeze({ countDay, evidenceWindow }),
});

/**
 * A version's functions, or null when this code does not have it.
 * @param {unknown} name
 * @returns {CountingVersion | null}
 */
export function countingVersion(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(COUNTING_VERSIONS, name) ? COUNTING_VERSIONS[name] : null;
}
