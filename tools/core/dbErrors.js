/**
 * Shared DB Error Classifier
 *
 * Converts PostgreSQL error codes to structured { error, error_type } responses
 * that LLM clients can understand and act on.
 *
 * Used by all tools/core/ modules.
 */

/**
 * @param {Error} err - Database error
 * @param {string} operation - Name of the operation (e.g., 'getProgress', 'logEntry')
 * @returns {{ error: string, error_type: string }}
 */
export function classifyDbError(err, operation) {
    if (err.code === 'ECONNREFUSED' || err.code === '57P01') {
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
