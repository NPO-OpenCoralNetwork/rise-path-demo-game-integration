// @ts-check
/**
 * The private rules file of study time (doc/brushup-2026/training-plan.ja.md §4.9, D9): the values
 * of the signals' collection and of the counting (shared/training/studyTime.js). The file lives
 * outside this repository; staff load it into the school's database. Nothing here has a default:
 * a missing or invalid field refuses the whole file, and an error names fields, never values.
 * The ranges below only keep the counting sane; they are not the school's values.
 */
import { STUDY_TIME_ALGORITHM } from './studyTime.js';

const MIN_MS = 1000;
const MAX_MS = 6 * 60 * 60 * 1000;
const OVERLAP = Object.freeze(['prefer_focus_latest', 'drop_conflicts']);
const SHAPE = Object.freeze({
  collection: ['beatMs', 'minSpacingMs', 'maxPlaces'],
  counting: ['gapMs', 'creditCapMs', 'idleMs', 'requireFocus', 'overlap'],
});

/** @param {unknown} v */
const isMs = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= MIN_MS && /** @type {number} */ (v) <= MAX_MS;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * @param {unknown} input the parsed rules file
 * @param {{ requestsPerMinute?: number }} [limits] the per-learner request limit of the training
 *   API (server/routes/training.js): when given, the signals of maxPlaces pages at beatMs must use
 *   at most half of it, so the page's other calls still fit
 * @returns {{ ok: true, rules: import('./studyTime.js').TimeRules } | { ok: false, errors: string[] }}
 */
export function parseTimeRules(input, limits = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(input)) return { ok: false, errors: ['not an object'] };
  for (const key of Object.keys(input)) if (!['algorithm', ...Object.keys(SHAPE)].includes(key)) errors.push(`unknown ${key}`);
  if (input.algorithm !== STUDY_TIME_ALGORITHM) errors.push('algorithm');
  const c = isRecord(input.collection) ? input.collection : {};
  const k = isRecord(input.counting) ? input.counting : {};
  for (const [group, block] of /** @type {const} */ ([['collection', c], ['counting', k]])) {
    for (const key of Object.keys(block)) if (!SHAPE[group].includes(key)) errors.push(`unknown ${group}.${key}`);
  }
  for (const [name, v] of /** @type {const} */ ([['collection.beatMs', c.beatMs], ['collection.minSpacingMs', c.minSpacingMs], ['counting.gapMs', k.gapMs], ['counting.creditCapMs', k.creditCapMs], ['counting.idleMs', k.idleMs]])) {
    if (!isMs(v)) errors.push(name);
  }
  if (!(Number.isInteger(c.maxPlaces) && /** @type {number} */ (c.maxPlaces) >= 1 && /** @type {number} */ (c.maxPlaces) <= 10)) errors.push('collection.maxPlaces');
  if (typeof k.requireFocus !== 'boolean') errors.push('counting.requireFocus');
  if (!OVERLAP.includes(/** @type {string} */ (k.overlap))) errors.push('counting.overlap');
  if (errors.length) return { ok: false, errors };
  const collection = { beatMs: /** @type {number} */ (c.beatMs), minSpacingMs: /** @type {number} */ (c.minSpacingMs), maxPlaces: /** @type {number} */ (c.maxPlaces) };
  const counting = {
    gapMs: /** @type {number} */ (k.gapMs),
    creditCapMs: /** @type {number} */ (k.creditCapMs),
    idleMs: /** @type {number} */ (k.idleMs),
    requireFocus: /** @type {boolean} */ (k.requireFocus),
    overlap: /** @type {'prefer_focus_latest' | 'drop_conflicts'} */ (k.overlap),
  };
  if (collection.minSpacingMs > collection.beatMs) errors.push('collection.minSpacingMs > collection.beatMs');
  if (counting.gapMs <= collection.beatMs) errors.push('counting.gapMs <= collection.beatMs');
  if (counting.creditCapMs > counting.gapMs) errors.push('counting.creditCapMs > counting.gapMs');
  if (counting.idleMs < collection.beatMs) errors.push('counting.idleMs < collection.beatMs');
  if (limits.requestsPerMinute !== undefined && collection.maxPlaces * 60_000 / collection.beatMs > limits.requestsPerMinute / 2) {
    errors.push('collection.maxPlaces and collection.beatMs use more than half of the per-learner request limit');
  }
  return errors.length ? { ok: false, errors } : { ok: true, rules: { algorithm: STUDY_TIME_ALGORITHM, collection, counting } };
}
