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
 * It also runs (each in its own transaction):
 * - getAchievements (GET /api/v2/user/achievements, server/routes/achievements.js): both
 *   reconcilers, then the ledger, the days and today are read in the same transaction;
 *   summarizeAchievements derives XP, the level, the streak and the badges from them;
 * - noteLearning: after a REST lesson-progress save that taught something (server/routes/
 *   lessonProgress.js, after the answer was sent): the lesson awards and today as a learning day;
 * - noteBlenderProgress: after the legacy PUT /api/v2/user/progress/blender (server/routes/user.js,
 *   after the answer): the stage awards, and today when a stage was newly awarded;
 * - noteReviewDay (Phase 6): after a review graded on the web page (POST /api/v2/user/review/grade,
 *   after the answer): the review's own Japan-time day (the day its transaction recorded) as a
 *   learning day, never XP. A review recorded by an AI app (MCP) writes no learning day (the remote
 *   role has no grant on learning_days).
 * The hooks never throw and only log a failure: the save or review they follow is already answered.
 * Learning days come only from these server records (Japan time, server clock), never from events.
 *
 * Locking: XP_LOCK_SQL is a per-learner transaction lock (keyed by the canonical uuid text, so the
 * id's case never splits it), and every insert is ORDER BY the key, so two reconciles of one learner
 * never deadlock on the primary key. The reconcilers read lesson_progress and user_progress without
 * row locks.
 */
import { canonicalUserId } from './accountDeletions.js';
import { inTransaction } from './dbTransaction.js';
import { listPublishedLessons } from './courseCatalog.js';

/**
 * @typedef {import('./dbTransaction.js').Queryable} Queryable
 * @typedef {import('./dbTransaction.js').CoreError} CoreError
 *
 * @typedef {{ source: string, item_key: string, milestone: string, xp: number | string }} AwardRow
 *   a row of XP_AWARDS_SQL
 * @typedef {{ slug: string, source: 'lesson' | 'blender_stage', items: string[] }} BadgeCourse
 *   a course and the item keys whose 'done' awards complete it (its currently published lessons,
 *   or Blender's four stages)
 * @typedef {{ total: number, level: number, intoLevel: number, levelSize: number, toNextLevel: number }} XpLevel
 * @typedef {{ current: number, best: number, activeToday: boolean }} StreakRun
 * @typedef {{ id: string, earned: boolean, current: number, goal: number, course?: string }} Badge
 *
 * @typedef {object} Achievements
 * @property {string} learnerId the learner the numbers belong to (lower-case uuid)
 * @property {XpLevel} xp
 * @property {{ lessonsStarted: number, lessonsDone: number, stagesDone: number }} counts
 * @property {StreakRun & { today: string, timeZone: string }} streak
 * @property {Badge[]} badges
 */

/** XP per level (owner decision O1: the level formula is unchanged). The browser computes no XP. */
export const XP_PER_LEVEL = 100;

/** The day boundary of the streak and of learning_days (LEARNING_DAY_SQL, TODAY_SQL). */
export const STREAK_TIME_ZONE = 'Asia/Tokyo';

/** The Blender stages that earn XP: BLENDER_XP_SELECT's list (data/curricula/blender/courseData.ts ids). */
export const BLENDER_STAGES = Object.freeze(['1', '2', '3', '4']);

/**
 * The badges in display order (design §3.5). done: lesson 'done' awards + Blender stage awards;
 * course: the best course's done / total; courses: complete courses; streak: days in a row.
 * @type {ReadonlyArray<{ id: string, kind: 'done' | 'course' | 'courses' | 'streak', goal: number }>}
 */
export const BADGES = Object.freeze([
    { id: 'first_lesson', kind: 'done', goal: 1 },
    { id: 'five_lessons', kind: 'done', goal: 5 },
    { id: 'fifteen_lessons', kind: 'done', goal: 15 },
    { id: 'first_course', kind: 'course', goal: 1 },
    { id: 'three_courses', kind: 'courses', goal: 3 },
    { id: 'streak_3', kind: 'streak', goal: 3 },
    { id: 'streak_7', kind: 'streak', goal: 7 },
]);

/**
 * Per-learner lock for every XP reconcile (re-entrant within one transaction). The key is the
 * canonical uuid text ($1::uuid::text, like accountLockKey in accountDeletions.js), so every caller
 * (read, hooks, reset, delete-all) takes the same lock whatever case the id arrived in.
 */
export const XP_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('xp:' || $1::uuid::text))";

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
 * A web review's day as a day the learner learned (Phase 6, noteReviewDay). $2 is the Japan-time day
 * the review's own transaction recorded (review_log.review_day, the grade's summary.today), never a
 * client's value: this runs after the answer, in its own transaction, so its now() can already be
 * the next day for a review that committed just before 00:00 JST.
 */
export const REVIEW_LEARNING_DAY_SQL = `INSERT INTO learning_days (user_id, day) VALUES ($1, $2::date)
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

// ─── Read path (GET /api/v2/user/achievements) ─────────────────

/** The learner's ledger, in key order. */
export const XP_AWARDS_SQL = 'SELECT source, item_key, milestone, xp FROM xp_awards WHERE user_id = $1 ORDER BY source, item_key, milestone';

/** The learner's learning days as YYYY-MM-DD, oldest first. */
export const DAYS_SQL = "SELECT to_char(day, 'YYYY-MM-DD') AS day FROM learning_days WHERE user_id = $1 ORDER BY day";

/** Today in Japan by the server clock: the same clock and zone as LEARNING_DAY_SQL. */
export const TODAY_SQL = "SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS today";

/**
 * The level of a total (owner decision O1): level = floor(total / 100) + 1.
 * @param {number} total
 * @returns {XpLevel}
 */
export function levelOf(total) {
    const xp = Math.max(0, Math.floor(Number(total) || 0));
    const intoLevel = xp % XP_PER_LEVEL;
    return { total: xp, level: Math.floor(xp / XP_PER_LEVEL) + 1, intoLevel, levelSize: XP_PER_LEVEL, toNextLevel: XP_PER_LEVEL - intoLevel };
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days since 1970-01-01 of a calendar date written YYYY-MM-DD, or null when it is not one.
 * @param {unknown} day
 * @returns {number | null}
 */
function dayNumber(day) {
    const m = typeof day === 'string' ? DAY_RE.exec(day) : null;
    if (!m) return null;
    const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const at = new Date(Date.UTC(year, month - 1, date));
    if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== date) return null;
    return Math.round(at.getTime() / DAY_MS);
}

/**
 * The streak over a learner's learning days (pure; dates as YYYY-MM-DD in Japan time).
 * current: the days in a row ending today when today is a learning day, else ending yesterday
 * when that is one (the streak survives until the end of today), else 0. best: the longest run
 * ever. activeToday: today is a learning day.
 * @param {readonly string[]} days
 * @param {string} today
 * @returns {StreakRun}
 */
export function streakOf(days, today) {
    /** @type {Set<number>} */
    const set = new Set();
    for (const day of days) {
        const n = dayNumber(day);
        if (n !== null) set.add(n);
    }
    let best = 0;
    let run = 0;
    /** @type {number | null} */
    let previous = null;
    for (const n of [...set].sort((a, b) => a - b)) {
        run = previous !== null && n === previous + 1 ? run + 1 : 1;
        best = Math.max(best, run);
        previous = n;
    }
    const t = dayNumber(today);
    let current = 0;
    if (t !== null) {
        let at = set.has(t) ? t : t - 1;
        while (set.has(at)) {
            current += 1;
            at -= 1;
        }
    }
    return { current, best, activeToday: t !== null && set.has(t) };
}

/**
 * Totals, level, streak and badges from the ledger, the days and the catalog (pure).
 * Count and course badges: earned exactly when current >= goal (current never passes the goal).
 * first_course: the course with the highest done / total (ties to the larger total), and its slug.
 * Streak badges: earned once the best run reached the goal (they stay earned); otherwise current
 * is the run that goes on today, min(streak.current, goal), never the best run.
 * @param {{ userId: string, awards: readonly AwardRow[], days: readonly string[], today: string, courses: readonly BadgeCourse[] }} params
 * @returns {Achievements}
 */
export function summarizeAchievements({ userId, awards, days, today, courses }) {
    /** @type {Set<string>} */
    const done = new Set();
    let total = 0;
    let lessonsStarted = 0;
    let lessonsDone = 0;
    let stagesDone = 0;
    for (const award of awards) {
        total += Number(award.xp) || 0;
        if (award.source === 'lesson' && award.milestone === 'start') lessonsStarted += 1;
        if (award.milestone !== 'done') continue;
        done.add(`${award.source} ${award.item_key}`);
        if (award.source === 'lesson') lessonsDone += 1;
        else if (award.source === 'blender_stage') stagesDone += 1;
    }
    const doneCount = lessonsDone + stagesDone;
    const progress = courses
        .filter((course) => course.items.length > 0)
        .map((course) => ({
            slug: course.slug,
            total: course.items.length,
            done: course.items.filter((item) => done.has(`${course.source} ${item}`)).length,
        }));
    const complete = progress.filter((course) => course.done >= course.total).length;
    /** @type {{ slug: string, total: number, done: number } | null} */
    let nearest = null;
    for (const course of progress) {
        if (!nearest) {
            nearest = course;
            continue;
        }
        // done / total compared without division; ties go to the larger course.
        const ahead = course.done * nearest.total - nearest.done * course.total;
        if (ahead > 0 || (ahead === 0 && course.total > nearest.total)) nearest = course;
    }
    const streak = streakOf(days, today);
    /** @param {number} current @param {number} goal */
    const counted = (current, goal) => ({ earned: current >= goal, current: Math.min(current, goal), goal });
    /** @type {Badge[]} */
    const badges = BADGES.map(({ id, kind, goal }) => {
        if (kind === 'done') return { id, ...counted(doneCount, goal) };
        if (kind === 'courses') return { id, ...counted(complete, goal) };
        if (kind === 'course') {
            return nearest
                ? { id, ...counted(nearest.done, nearest.total), course: nearest.slug }
                : { id, earned: false, current: 0, goal };
        }
        const earned = streak.best >= goal;
        return { id, earned, current: earned ? goal : Math.min(streak.current, goal), goal };
    });
    return {
        learnerId: canonicalUserId(userId) ?? userId.toLowerCase(),
        xp: levelOf(total),
        counts: { lessonsStarted, lessonsDone, stagesDone },
        streak: { ...streak, today, timeZone: STREAK_TIME_ZONE },
        badges,
    };
}

/**
 * The courses the course badges count: every course with published lessons (each lesson's
 * 'course/lesson' key) and the Blender course's four stages.
 * @returns {BadgeCourse[]}
 */
export function badgeCourses() {
    /** @type {Map<string, string[]>} */
    const lessons = new Map();
    for (const entry of listPublishedLessons()) {
        const items = lessons.get(entry.courseSlug) ?? [];
        items.push(`${entry.courseSlug}/${entry.lesson.id}`);
        lessons.set(entry.courseSlug, items);
    }
    return [
        ...[...lessons].map(([slug, items]) => /** @type {BadgeCourse} */ ({ slug, source: 'lesson', items })),
        { slug: 'blender', source: 'blender_stage', items: BLENDER_STAGES.map((stage) => `blender/${stage}`) },
    ];
}

/**
 * The learner's XP, level, streak and badges. One transaction: both reconcilers (so what the
 * server's records earned is in the ledger, also after an AI app's writes), then the ledger, the
 * days and today. A database failure resolves to a CoreError (the route answers 503 or 500).
 * @param {{ userId: string }} params
 * @returns {Promise<Achievements | CoreError>}
 */
export async function getAchievements({ userId: rawUserId }) {
    // One spelling per learner: a lower-case learnerId (XP_LOCK_SQL canonicalizes its key itself).
    const userId = canonicalUserId(rawUserId);
    if (!userId) return { error: 'A signed-in learner is required.', error_type: 'validation' };
    /** @type {{ awards: AwardRow[], days: string[], today: string } | CoreError} */
    const read = await inTransaction('getAchievements', async (db) => {
        await reconcileLessonXp(db, userId);
        await reconcileBlenderXp(db, userId);
        const awards = (await db.query(XP_AWARDS_SQL, [userId])).rows;
        const days = (await db.query(DAYS_SQL, [userId])).rows.map((row) => String(row.day));
        const today = String((await db.query(TODAY_SQL)).rows[0]?.today ?? '');
        return { commit: true, value: { awards, days, today } };
    });
    if ('error_type' in read) return read;
    return summarizeAchievements({ userId, ...read, courses: badgeCourses() });
}

// ─── Hooks after a save (best effort, never throw) ─────────────

/**
 * @param {string} hook
 * @param {(db: Queryable) => Promise<void>} work
 * @returns {Promise<boolean>} whether it committed
 */
async function noteAfterSave(hook, work) {
    try {
        const result = await inTransaction(hook, async (db) => {
            await work(db);
            return { commit: true, value: true };
        });
        if (result === true) return true;
        console.warn(`[achievements] ${hook} failed:`, result?.error_type ?? 'unknown');
    } catch (error) {
        console.warn(`[achievements] ${hook} failed:`, /** @type {any} */ (error)?.code ?? 'unknown');
    }
    return false;
}

/**
 * After a REST lesson-progress save that taught something (content changed, not not_started):
 * the lesson awards the learner's records now earn, and today (Japan time, server clock) as a
 * learning day. Runs after the save was answered, outside its transaction; never throws. After an
 * account deletion it fails its foreign key (23503) and only logs.
 * @param {{ userId: string }} params
 * @returns {Promise<boolean>}
 */
export async function noteLearning({ userId: rawUserId }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return false;
    return noteAfterSave('note after save', async (db) => {
        await reconcileLessonXp(db, userId);
        await db.query(LEARNING_DAY_SQL, [userId]);
    });
}

/**
 * After the legacy PUT /api/v2/user/progress/blender: the stage awards the learner's
 * user_progress row now earns; a stage newly awarded also makes today a learning day
 * (reconcileBlenderXp). Runs after the PUT was answered; never throws.
 * @param {{ userId: string }} params
 * @returns {Promise<boolean>}
 */
export async function noteBlenderProgress({ userId: rawUserId }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return false;
    return noteAfterSave('note after Blender progress', async (db) => {
        await reconcileBlenderXp(db, userId);
    });
}

/**
 * After a REST review (Phase 6): the review's day as a learning day (REVIEW_LEARNING_DAY_SQL). Runs
 * after the review was answered, in its own transaction; never throws; never XP. `day` is the
 * Japan-time day the review's transaction recorded (the grade's summary.today), not this
 * transaction's today: a review that commits at 23:59:59 JST counts on its own day even when this
 * runs after midnight. Not a learner or not a YYYY-MM-DD day: false, no statement. MCP reviews do
 * not call it (the remote role has no grant on learning_days, Phase 5 R8). After an account
 * deletion it fails its foreign key (23503) and only logs.
 * @param {{ userId: string, day: string }} params
 * @returns {Promise<boolean>}
 */
export async function noteReviewDay({ userId: rawUserId, day }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId || dayNumber(day) === null) return false;
    return noteAfterSave('note after review', async (db) => {
        await db.query(REVIEW_LEARNING_DAY_SQL, [userId, day]);
    });
}
