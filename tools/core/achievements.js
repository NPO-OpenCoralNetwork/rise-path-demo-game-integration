// @ts-check
/**
 * Shared Business Logic — XP on the server (Phase 5, doc/brushup-2026/ai-access-plan.ja.md §9).
 * Tables xp_awards and learning_days (server/migrations/019_phase5_learning.sql).
 *
 * XP is a ledger, reconciled from the server's own records, never from a client's claim or from
 * learning events (POST /api/v2/user/events is history only):
 * - a lesson in lesson_progress whose state is not not_started earns 'start' 10 once; read, checked
 *   or mastered earns 'done' 40 once (owner decision O1);
 * - a Blender stage '1'..'4' in user_progress.completed_stages (course 'blender') earns 'done' 80
 *   once.
 * A row is inserted at most once (primary key + ON CONFLICT DO NOTHING) and only goes with the
 * account (O2: starting a lesson over or deleting the progress keeps what was earned). The amounts
 * are fixed by the table's CHECK.
 *
 * Reconciliation runs inside the learner's single-lesson reset transaction
 * (tools/core/lessonProgress.js), before the record it reads is emptied (the reset holds that row's
 * lock). Delete-all awards from the rows it deletes, in the same statement
 * (deleteLessonsKeepingXp), so a row an AI app changes while the delete runs (the MCP writers lock
 * only their row, never the learner) is deleted together with what it earned, never without it.
 * Neither runs inside a lesson-progress save transaction or in the MCP writers, so an XP failure
 * can never fail a save. The migration's backfill uses LESSON_XP_SELECT and BLENDER_XP_SELECT
 * verbatim (server/tests/migration019.test.js pins that).
 *
 * Locking: XP_LOCK_SQL is a per-learner transaction lock, and every insert is ORDER BY the key, so
 * two reconciles of one learner never deadlock on the primary key. The reconcilers read
 * lesson_progress and user_progress without row locks.
 */

/**
 * @typedef {import('./dbTransaction.js').Queryable} Queryable
 */

/** Per-learner lock for every XP reconcile (re-entrant within one transaction). */
export const XP_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('xp:' || $1))";

/**
 * The lesson awards that rows of `relation` (lesson_progress, or the rows a DELETE returns) earn:
 * one rule for the reconcile, the delete and the backfill.
 * @param {string} relation
 */
const lessonAwardsFrom = (relation) => `SELECT p.user_id, 'lesson', p.course_slug || '/' || p.lesson_id, m.milestone, m.xp
  FROM ${relation} p
  JOIN (VALUES ('start', 10), ('done', 40)) AS m (milestone, xp)
    ON m.milestone = 'start' OR p.state IN ('read', 'checked', 'mastered')
 WHERE p.state <> 'not_started'`;

/** The lesson awards the server's lesson_progress rows earn (shared with migration 019's backfill). */
export const LESSON_XP_SELECT = lessonAwardsFrom('lesson_progress');

/** One learner's lesson awards, inserted once each. */
export const LESSON_XP_SQL = `INSERT INTO xp_awards (user_id, source, item_key, milestone, xp)
${LESSON_XP_SELECT} AND p.user_id = $1
 ORDER BY 3, 4
ON CONFLICT (user_id, source, item_key, milestone) DO NOTHING`;

/**
 * Delete-all: deletes every lesson_progress row of the learner and awards what exactly the deleted
 * rows earned, in one statement (after XP_LOCK_SQL). A row that another transaction changes while
 * the DELETE waits for it is deleted as that transaction left it, and RETURNING hands that version
 * to the awards; a row added after the DELETE's snapshot stays. deleted: the number of rows deleted.
 */
export const DELETE_LESSONS_KEEPING_XP_SQL = `WITH gone AS (
  DELETE FROM lesson_progress WHERE user_id = $1
  RETURNING user_id, course_slug, lesson_id, state
), awarded AS (
  INSERT INTO xp_awards (user_id, source, item_key, milestone, xp)
  ${lessonAwardsFrom('gone')}
   ORDER BY 3, 4
  ON CONFLICT (user_id, source, item_key, milestone) DO NOTHING
)
SELECT count(*)::int AS deleted FROM gone`;

/** The Blender stage awards the legacy user_progress rows earn (shared with migration 019's backfill). */
export const BLENDER_XP_SELECT = `SELECT DISTINCT u.user_id, 'blender_stage', 'blender/' || s.stage, 'done', 80
  FROM user_progress u
 CROSS JOIN LATERAL unnest(u.completed_stages) AS s (stage)
 WHERE u.course_id = 'blender' AND s.stage IN ('1', '2', '3', '4')`;

/** One learner's Blender stage awards, inserted once each; returns the newly awarded stages. */
export const BLENDER_XP_SQL = `INSERT INTO xp_awards (user_id, source, item_key, milestone, xp)
${BLENDER_XP_SELECT} AND u.user_id = $1
 ORDER BY 3
ON CONFLICT (user_id, source, item_key, milestone) DO NOTHING
RETURNING item_key`;

/** Today (Japan time, server clock) as a day the learner learned. */
export const LEARNING_DAY_SQL = `INSERT INTO learning_days (user_id, day) VALUES ($1, (now() AT TIME ZONE 'Asia/Tokyo')::date)
ON CONFLICT (user_id, day) DO NOTHING`;

/**
 * Awards what the learner's lesson_progress rows earn and the ledger lacks, inside the caller's
 * transaction. Throws on a database error (the caller's transaction then rolls back).
 * @param {Queryable} db
 * @param {string} userId
 */
export async function reconcileLessonXp(db, userId) {
    await db.query(XP_LOCK_SQL, [userId]);
    await db.query(LESSON_XP_SQL, [userId]);
}

/**
 * Deletes every lesson_progress row of the learner and awards what those rows earned, inside the
 * caller's transaction (delete-all, owner decision O2: earned XP stays). Throws on a database error.
 * @param {Queryable} db
 * @param {string} userId
 * @returns {Promise<number>} the number of rows deleted
 */
export async function deleteLessonsKeepingXp(db, userId) {
    await db.query(XP_LOCK_SQL, [userId]);
    const { rows } = await db.query(DELETE_LESSONS_KEEPING_XP_SQL, [userId]);
    return Number(rows[0]?.deleted ?? 0);
}

/**
 * Awards the Blender stages the learner's user_progress row lists and the ledger lacks, inside the
 * caller's transaction; a stage newly awarded also makes today a learning day (whichever
 * reconcile inserts the award adds the day, so two of them never race on it).
 * @param {Queryable} db
 * @param {string} userId
 * @returns {Promise<string[]>} the item keys newly awarded ('blender/<stage>')
 */
export async function reconcileBlenderXp(db, userId) {
    await db.query(XP_LOCK_SQL, [userId]);
    const { rows } = await db.query(BLENDER_XP_SQL, [userId]);
    const awarded = rows.map((row) => String(row.item_key));
    if (awarded.length) await db.query(LEARNING_DAY_SQL, [userId]);
    return awarded;
}
