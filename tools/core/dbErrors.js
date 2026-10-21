/**
 * Shared DB Error Classifier
 *
 * Converts PostgreSQL error codes to structured { error, error_type } responses
 * that LLM clients can understand and act on.
 *
 * Used by all tools/core/ modules.
 */

// Node network errors, and Postgres states that mean the server is going away or not accepting
// connections (57P01-57P03, 53300 too_many_connections, class 08 connection exceptions).
const UNAVAILABLE_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    '57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006',
]);

// pg and pg-pool report a lost or timed-out connection with plain Errors and no code. The last two
// come from a client that already lost its connection (server/db.js closes it after a timeout).
const UNAVAILABLE_MESSAGES = [
    /^timeout exceeded when trying to connect/i,
    /^Connection terminated/i,
    /^Query read timeout/i,
    /^Client has encountered a connection error and is not queryable/i,
    /^Client was closed and is not queryable/i,
];

/**
 * True when the database could not be reached or dropped the connection (as opposed to a bad query
 * or a constraint): callers answer "try again later" instead of reporting a bug.
 *
 * Only the error itself is checked, not its cause. pg raises socket errors as they are, while fetch
 * (Gemini, Supabase, TTS) wraps them in TypeError('fetch failed') with the socket error as the
 * cause, and those are not database outages. Nothing else in server/ or tools/ opens sockets.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isDbUnavailable(err) {
    if (!err || typeof err !== 'object') return false;
    if (UNAVAILABLE_CODES.has(err.code)) return true;
    if (UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(String(err.message ?? '')))) return true;
    // A host name with several addresses (localhost: ::1 and 127.0.0.1) fails with an AggregateError.
    return err instanceof AggregateError && err.errors.some((inner) => UNAVAILABLE_CODES.has(inner?.code));
}

/**
 * @param {Error} err - Database error
 * @param {string} operation - Name of the operation (e.g., 'getProgress', 'logEntry')
 * @returns {{ error: string, error_type: string }}
 */
export function classifyDbError(err, operation) {
    if (isDbUnavailable(err)) {
        return { error: `Database connection failed during ${operation}`, error_type: 'db_connection' };
    }
    if (err.code === '42P01') {
        return { error: `Table not found during ${operation}. Run db:migrate.`, error_type: 'table_not_found' };
    }
    if (err.code === '23505') {
        return { error: `Duplicate entry during ${operation}`, error_type: 'conflict' };
    }
    if (err.code === '22P02') {
        return { error: `Invalid UUID format during ${operation}`, error_type: 'validation' };
    }
    return { error: `${operation} failed: ${err.message}`, error_type: 'unknown' };
}
