// @ts-check
/**
 * The lesson hash: sha256 of the canonical JSON of a lesson without its non-content fields, as
 * `sha256:<16 hex>`. Every review records it as `lessonHash` and `lessons:preview` writes it to
 * metrics.json, so a review and the screenshots it judged are both tied to one exact lesson text.
 * Node only (node:crypto, node:fs); browser code uses ./canonical.js directly.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from './canonical.js';

/** Lesson fields that are not learner-facing content: editing them does not change the hash. */
export const HASH_IGNORED_FIELDS = new Set(['provenance']);

/**
 * @param {unknown} lesson
 * @returns {string}
 */
export function lessonHash(lesson) {
  const content = lesson && typeof lesson === 'object' && !Array.isArray(lesson)
    ? Object.fromEntries(Object.entries(lesson).filter(([key]) => !HASH_IGNORED_FIELDS.has(key)))
    : lesson;
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(content) ?? 'null').digest('hex').slice(0, 16)}`;
}

/**
 * The lesson hash of a lesson's JSON text, or null when the text is not JSON.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function lessonHashOfText(text) {
  try {
    return lessonHash(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * The lesson hash of a lesson file, or null when it cannot be read or is not JSON.
 *
 * @param {string} file
 * @returns {string | null}
 */
export function lessonHashOfFile(file) {
  try {
    return lessonHashOfText(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
