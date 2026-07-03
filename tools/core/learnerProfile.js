/**
 * Shared Business Logic — Learner Profile
 *
 * Provides latest learner profile data for MCP Resources and Express routes.
 */
import { getPool, PHASE1_USER_ID } from '../../server/db.js';
import { classifyDbError } from './dbErrors.js';

/**
 * Get the latest learner profile for a user.
 *
 * @param {Object} params
 * @param {string} [params.userId] - User ID (defaults to PHASE1_USER_ID)
 * @returns Profile data or { error, error_type }
 */
export async function getLatestProfile({ userId } = {}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;

    try {
        const result = await pool.query(
            `SELECT id, version, assessment_type, raw_profile, derived_learning_profile,
                    applied_rules, created_at
             FROM learner_profiles
             WHERE user_id = CAST($1 AS uuid)
             ORDER BY version DESC LIMIT 1`,
            [effectiveUserId]
        );

        if (!result.rowCount) {
            return {
                found: false,
                user_id: effectiveUserId,
                message: 'No learner profile found. Run an assessment first.',
            };
        }

        const row = result.rows[0];
        return {
            found: true,
            learner_profile_id: row.id,
            profile_version: row.version,
            assessment_type: row.assessment_type,
            raw_profile: row.raw_profile,
            derived_learning_profile: row.derived_learning_profile,
            applied_rules: row.applied_rules,
            created_at: row.created_at,
        };
    } catch (err) {
        return classifyDbError(err, 'getLatestProfile');
    }
}
