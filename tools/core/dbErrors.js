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
    return { error: `${operation} failed: ${err.message}`, error_type: 'unknown' };
}
