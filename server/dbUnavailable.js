import { isDbUnavailable } from '../tools/core/dbErrors.js';

/** What a route answers when Postgres cannot be reached (same error_type as the MCP tools). */
export const DB_UNAVAILABLE_BODY = Object.freeze({
    error: 'The database is not reachable right now. Try again in a moment.',
    error_type: 'db_connection',
});

/**
 * Call first in a route's catch. When the error means the database could not be reached, answers
 * 503 with Retry-After and returns true, so the route stops there; otherwise returns false and the
 * route answers as before. Keeps an outage apart from a bug, and keeps driver text out of the body.
 * @param {import('express').Response} res
 * @param {unknown} err
 * @returns {boolean}
 */
export function respondIfDbUnavailable(res, err) {
    if (!isDbUnavailable(err)) return false;
    console.warn('[DB] Not reachable:', err?.message ?? err);
    if (!res.headersSent) res.set('Retry-After', '10').status(503).json(DB_UNAVAILABLE_BODY);
    return true;
}

/**
 * Express error handler, mounted last: an outage that escaped a route (an await before its try, or
 * a route without one) still gets the 503 JSON above. Anything else goes on to Express's handler.
 * @type {import('express').ErrorRequestHandler}
 */
export function dbUnavailableErrorHandler(err, req, res, next) {
    if (!res.headersSent && respondIfDbUnavailable(res, err)) return;
    next(err);
}
