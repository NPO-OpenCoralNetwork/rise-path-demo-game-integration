// @ts-check
/**
 * Canonical JSON: object keys sorted, `undefined` members left out, no whitespace. Two values that
 * differ only in key order or formatting give the same string, so it is the basis of content
 * hashes (`hashLesson` in tools/core/lessons.js, the review `lessonHash` in
 * .claude/skills/review-lesson/scripts/review-scope.mjs) and of change detection between lesson
 * revisions. No dependencies.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
