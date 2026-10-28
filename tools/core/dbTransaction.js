// @ts-check
/**
 * One transaction on its own connection, for the tools/core modules that write several statements
 * at once (lessonProgress.js, achievements.js). Moved out of lessonProgress.js (Phase 5) so both
 * can use it without importing each other.
 *
 * Failures resolve to { error, error_type } (tools/core/dbErrors.js), never the driver's text.
 */
import { getPool } from '../../server/db.js';
import { classifyDbError } from './dbErrors.js';

/**
 * @typedef {{ error: string, error_type: string }} CoreError
 * @typedef {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number | null }> }} Queryable
 */

/** The answer when no database is configured. @returns {CoreError} */
export const noDatabase = () => ({ error: 'DB not configured', error_type: 'db_connection' });

/**
 * Runs `work` in one transaction on its own connection. `work` decides whether to commit (a
 * read-only outcome rolls back, which also drops a placeholder row it inserted). Resolves to the
 * value `work` returned, or a CoreError when a statement failed.
 * @param {string} operation
 * @param {(db: Queryable) => Promise<{ commit: boolean, value: any }>} work
 * @returns {Promise<any>}
 */
export async function inTransaction(operation, work) {
    const pool = getPool();
    if (!pool) return noDatabase();
    /** @type {any} */
    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), operation);
    }
    let broken = false;
    try {
        await client.query('BEGIN');
        const { commit, value } = await work(client);
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        return value;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            broken = true;
        }
        return classifyDbError(/** @type {any} */ (err), operation);
    } finally {
        client.release(broken);
    }
}
