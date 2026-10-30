// @ts-check
/**
 * A training course's units and each unit's set time (doc/brushup-2026/training-plan.ja.md §4.4,
 * §4.9; D2): the manifest "risepath.training-course/v1" of the private catalog. The catalog lives
 * outside this repository; staff load the manifest into the school's database, where each loaded
 * version is kept unchanged and named by the sha256 of its canonical JSON. Study time is counted
 * per unit and capped at the unit's set time (shared/training/studyTime.js). No lesson text and no
 * answer here: the pull request on unit unlocking and tests adds the material.
 *
 *   { schema: 'risepath.training-course/v1', courseKey, title: { jp, en },
 *     units: [{ key, title: { jp, en }, setMinutes }] }
 */
import { canonicalJson } from '../lesson/canonical.js';

export const COURSE_MANIFEST_SCHEMA = 'risepath.training-course/v1';
/** A course or unit key: the same rule as a course slug and a cohort slug. */
export const TRAINING_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const MAX_UNITS = 500;
export const MAX_SET_MINUTES = 6000;
const TITLE_MAX = 200;

/**
 * @typedef {{ jp: string, en: string }} Title
 * @typedef {{ key: string, title: Title, setMinutes: number }} CourseUnit
 * @typedef {{ schema: string, courseKey: string, title: Title, units: CourseUnit[] }} CourseManifest
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} v @param {string} where @param {string[]} errors */
function title(v, where, errors) {
  if (!isRecord(v)) {
    errors.push(`${where} is not { jp, en }`);
    return;
  }
  for (const key of Object.keys(v)) if (key !== 'jp' && key !== 'en') errors.push(`unknown ${where}.${key}`);
  for (const lang of ['jp', 'en']) {
    const text = v[lang];
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > TITLE_MAX) errors.push(`${where}.${lang}`);
  }
}

/**
 * @param {unknown} input the parsed manifest
 * @returns {{ ok: true, manifest: CourseManifest } | { ok: false, errors: string[] }}
 */
export function parseCourseManifest(input) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(input)) return { ok: false, errors: ['not an object'] };
  for (const key of Object.keys(input)) if (!['schema', 'courseKey', 'title', 'units'].includes(key)) errors.push(`unknown ${key}`);
  if (input.schema !== COURSE_MANIFEST_SCHEMA) errors.push('schema');
  if (typeof input.courseKey !== 'string' || !TRAINING_KEY.test(input.courseKey)) errors.push('courseKey');
  title(input.title, 'title', errors);
  const units = Array.isArray(input.units) ? input.units : null;
  if (!units || units.length < 1 || units.length > MAX_UNITS) errors.push('units');
  const seen = new Set();
  for (const [i, unit] of (units ?? []).entries()) {
    const where = `units[${i}]`;
    if (!isRecord(unit)) {
      errors.push(where);
      continue;
    }
    for (const key of Object.keys(unit)) if (!['key', 'title', 'setMinutes'].includes(key)) errors.push(`unknown ${where}.${key}`);
    if (typeof unit.key !== 'string' || !TRAINING_KEY.test(unit.key)) errors.push(`${where}.key`);
    else if (seen.has(unit.key)) errors.push(`${where}.key repeats`);
    else seen.add(unit.key);
    title(unit.title, `${where}.title`, errors);
    if (!(Number.isInteger(unit.setMinutes) && /** @type {number} */ (unit.setMinutes) >= 1 && /** @type {number} */ (unit.setMinutes) <= MAX_SET_MINUTES)) errors.push(`${where}.setMinutes`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: /** @type {CourseManifest} */ (JSON.parse(JSON.stringify(input))) };
}

/** The text whose sha256 names a loaded version (key order and formatting do not matter). @param {CourseManifest} manifest */
export const manifestCanonical = (manifest) => canonicalJson(manifest);

/** Each unit's set time in milliseconds, as countSpan takes it. @param {CourseManifest} manifest @returns {Map<string, number>} */
export const setMsOf = (manifest) => new Map(manifest.units.map((u) => [u.key, u.setMinutes * 60_000]));
