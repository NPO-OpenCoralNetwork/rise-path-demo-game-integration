/**
 * Shared identifier checks.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether `value` is a UUID string. Check ids from requests with this before a `CAST(... AS uuid)`,
 * so a malformed id is "not found" instead of a database error.
 * @param {unknown} value
 * @returns {value is string}
 */
export const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);
