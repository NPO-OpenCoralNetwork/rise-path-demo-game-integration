/**
 * Shared Business Logic — Learner State
 *
 * Used by both Express routes and MCP Server.
 * Pure data access functions, no HTTP/MCP concerns.
 */
import { getPool, PHASE1_USER_ID } from '../../server/db.js';
import { calculateMastery } from './domains.js';
import { classifyDbError } from './dbErrors.js';

/**
 * @param {Object} params
 * @param {string} [params.userId] - User ID (defaults to PHASE1_USER_ID in dev)
 * @param {string} [params.domain] - Learning domain. If omitted, returns all domains.
 * @returns Progress data or { error, error_type } on failure
 */
export async function getProgress({ userId, domain }) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;

    try {
        const result = await pool.query(
            `SELECT course_id, completed_stages, completed_steps
             FROM user_progress WHERE user_id = $1 ${domain ? 'AND course_id = $2' : ''}`,
            domain ? [effectiveUserId, domain] : [effectiveUserId]
        );

        if (domain) {
            const row = result.rows[0];
            if (!row) return { stage: 0, mastery: 0, streak: 0, last_lesson: null, domain };
            const stages = row.completed_stages || [];
            return {
                domain,
                stage: stages.length,
                mastery: calculateMastery(stages.length, domain),
                streak: 0, // TODO: calculate from learning_events
                last_lesson: null,
                completed_stages: stages,
                completed_steps: row.completed_steps || {},
            };
        }

        // All domains
        const progress = {};
        for (const row of result.rows) {
            const stages = row.completed_stages || [];
            progress[row.course_id] = {
                stage: stages.length,
                mastery: calculateMastery(stages.length, row.course_id),
                completed_stages: stages,
                completed_steps: row.completed_steps || {},
            };
        }
        return progress;
    } catch (err) {
        return classifyDbError(err, 'getProgress');
    }
}

/**
 * @param {Object} params
 * @param {string} [params.userId]
 * @param {string} params.domain - Learning domain
 * @param {string} params.lessonId - Completed lesson ID
 * @param {number} [params.score] - Score (0-1)
 * @returns { updated, new_mastery } or { error, error_type }
 */
export async function updateProgress({ userId, domain, lessonId, score }) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;

    try {
        // Get current progress
        const current = await pool.query(
            'SELECT completed_stages, completed_steps FROM user_progress WHERE user_id = $1 AND course_id = $2',
            [effectiveUserId, domain]
        );

        let completedStages = [];
        let completedSteps = {};

        if (current.rowCount) {
            completedStages = current.rows[0].completed_stages || [];
            completedSteps = current.rows[0].completed_steps || {};
        }

        // Add lesson to completed steps
        if (!completedSteps[domain]) completedSteps[domain] = [];
        if (!completedSteps[domain].includes(lessonId)) {
            completedSteps[domain].push(lessonId);
        }

        await pool.query(
            `INSERT INTO user_progress (user_id, course_id, completed_stages, completed_steps)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, course_id) DO UPDATE SET
               completed_stages = $3, completed_steps = $4`,
            [effectiveUserId, domain, completedStages, JSON.stringify(completedSteps)]
        );

        return {
            updated: true,
            new_mastery: calculateMastery(completedStages.length, domain),
        };
    } catch (err) {
        return classifyDbError(err, 'updateProgress');
    }
}
