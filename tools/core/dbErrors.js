/**
 * Shared DB Error Classifier
 *
 * Converts PostgreSQL error codes to structured { error, error_type } responses
 * that LLM clients can understand and act on.
 *
 * Used by all tools/core/ modules.
 */

// Node network errors, and Postgres states meaning the server is going away or not accepting
// connections: 57P01-57P03 (admin_shutdown, crash_shutdown, cannot_connect_now) and 53300
// too_many_connections. Class 08 (connection exceptions) is matched by CONNECTION_EXCEPTION.
const UNAVAILABLE_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    '57P01', '57P02', '57P03', '53300',
]);
const CONNECTION_EXCEPTION = /^08[0-9A-Z]{3}$/;

// pg and pg-pool report a lost or timed-out connection with plain Errors and no code: a connect
// that timed out (also a checkout queued behind a full pool), a dropped connection, a query on a
// client that lost its connection, and a pool configured with query_timeout. "Client was closed"
// is left out: it follows client.end() or pool.end(), a bug rather than an outage.
const UNAVAILABLE_MESSAGES = [
    /^timeout exceeded when trying to connect/i,
    /^Connection terminated/i,
    /^Query read timeout/i,
    /^Client has encountered a connection error and is not queryable/i,
];

const isUnavailableCode = (code) => UNAVAILABLE_CODES.has(code) || (typeof code === 'string' && CONNECTION_EXCEPTION.test(code));

/**
 * True when the database could not be reached or dropped the connection, as opposed to a bad query
 * or a constraint: callers answer "try again later" (503) instead of reporting a bug.
 *
 * Only the error itself is checked, not its cause: pg raises socket errors as they are, while fetch
 * (providers, Supabase, the TTS sidecar) wraps them in TypeError('fetch failed') with the socket
 * error as the cause, and those are not database outages.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isDbUnavailable(err) {
    if (!err || typeof err !== 'object') return false;
    const e = /** @type {any} */ (err);
    if (isUnavailableCode(e.code)) return true;
    if (UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(String(e.message ?? '')))) return true;
    // A host name with several addresses (localhost: ::1 and 127.0.0.1) fails with an AggregateError.
    return err instanceof AggregateError && err.errors.some((inner) => isUnavailableCode(inner?.code));
}

/**
 * @param {Error} err - Database error
 * @param {string} operation - Name of the operation (e.g., 'getProgress', 'logEntry')
 * @returns {{ error: string, error_type: string }}
 */
export function classifyDbError(err, operation) {
    // Not logged here (callers decide): an outage fails every call, and the job worker, which polls
    // in the api process, logs it once (server/jobWorker.js), as server/db.js logs dropped connections.
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
    // insufficient_privilege: the role has no grant on a table, typically mcp-public's
    // risepath_mcp_remote after a migration added the table and before the owner re-ran
    // deploy/risepath-vm/sql/mcp_remote_role.sql. The log says so; the caller gets no table name.
    if (err.code === '42501') {
        console.error(`[db] ${operation}: permission denied (re-run the role SQL after the migration):`, err?.message || err);
        return { error: 'server setup incomplete', error_type: 'permission_denied' };
    }
    // The driver's own text (column names, SQL fragments, values) stays in the server log: these
    // results reach the LLM and can be quoted to a learner.
    console.error(`[db] ${operation} failed:`, err?.code || '', err?.message || err);
    return { error: `${operation} failed`, error_type: 'unknown' };
}
