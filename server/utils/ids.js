/**
 * Ids sent to Postgres as uuid. A value that is not a UUID names no row, so a route answers it like
 * an unknown id (its own 404) before any query; Postgres would otherwise fail the statement (22P02).
 * Only the hyphenated 8-4-4-4-12 form is accepted (Postgres also takes braces or no hyphens).
 * Routes, server/services and tools/core may import this (server/tests/architectureBoundaries.test.js).
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {unknown} value @returns {value is string} */
export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
