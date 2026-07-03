/**
 * Shared Business Logic — Journal
 *
 * Re-exports existing journalService functions for MCP/Express dual use.
 */
import { getPool, PHASE1_USER_ID } from '../../server/db.js';
import { validateJournalEntry, buildJournalSummary, analyzeJournalPatterns } from '../../server/services/journalService.js';
import { deriveAdaptationSignals } from '../../server/services/personalizationDeriver.js';
import { classifyDbError } from './dbErrors.js';

export { validateJournalEntry, buildJournalSummary, analyzeJournalPatterns };

export async function logEntry({ userId, curriculumId, moduleId, lessonId, learned, difficulty, mood, confidence, timeSpentMin }) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;

    const entry = { curriculum_id: curriculumId, module_id: moduleId, lesson_id: lessonId, learned, difficulty, mood, confidence, time_spent_min: timeSpentMin };
    const validation = validateJournalEntry(entry);
    if (!validation.valid) {
        return { error: 'Invalid journal entry', error_type: 'validation', details: validation.errors };
    }

    try {
        const result = await pool.query(
            `INSERT INTO learning_journal
                (user_id, curriculum_id, module_id, lesson_id, learned, difficulty, mood, confidence, time_spent_min)
             VALUES (CAST($1 AS uuid), CAST($2 AS uuid), $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, created_at`,
            [effectiveUserId, curriculumId, moduleId, lessonId, learned || null, difficulty || null, mood, confidence, timeSpentMin]
        );
        return { entry_id: result.rows[0].id, status: 'saved', created_at: result.rows[0].created_at };
    } catch (err) {
        return classifyDbError(err, 'logEntry');
    }
}

export async function getSummary({ userId, curriculumId }) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;

    try {
        const result = await pool.query(
            `SELECT module_id, lesson_id, learned, difficulty, mood, confidence, time_spent_min, created_at
             FROM learning_journal
             WHERE ${curriculumId ? 'curriculum_id = CAST($2 AS uuid) AND' : ''} user_id = CAST($1 AS uuid)
             ORDER BY created_at DESC`,
            curriculumId ? [effectiveUserId, curriculumId] : [effectiveUserId]
        );
        return buildJournalSummary({ entries: result.rows });
    } catch (err) {
        return classifyDbError(err, 'getSummary');
    }
}

export async function getRecent({ userId, limit = 10 }) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;
    const safeLimit = Math.min(Number(limit) || 10, 50);

    try {
        const result = await pool.query(
            `SELECT j.curriculum_id, j.module_id, j.lesson_id, j.learned, j.difficulty,
                    j.mood, j.confidence, j.time_spent_min, j.created_at,
                    c.title as curriculum_title
             FROM learning_journal j
             LEFT JOIN curricula c ON c.id = j.curriculum_id
             WHERE j.user_id = CAST($1 AS uuid)
             ORDER BY j.created_at DESC LIMIT $2`,
            [effectiveUserId, safeLimit]
        );
        return { entries: result.rows };
    } catch (err) {
        return classifyDbError(err, 'getRecent');
    }
}

/**
 * Phase 12: Get adaptation signals for a learner.
 * Fetches journal entries, analyzes patterns, derives signals.
 */
export async function getAdaptationSignals({ userId, curriculumId, moduleId }) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;

    try {
        const result = await pool.query(
            `SELECT module_id, lesson_id, learned, difficulty, mood, confidence, time_spent_min, created_at
             FROM learning_journal
             WHERE user_id = CAST($1 AS uuid)
             ${curriculumId ? 'AND curriculum_id = CAST($2 AS uuid)' : ''}
             ORDER BY created_at DESC LIMIT 20`,
            curriculumId ? [effectiveUserId, curriculumId] : [effectiveUserId]
        );

        const patterns = analyzeJournalPatterns(result.rows, { module_id: moduleId });
        const signals = deriveAdaptationSignals(patterns);

        return signals;
    } catch (err) {
        return classifyDbError(err, 'getAdaptationSignals');
    }
}
