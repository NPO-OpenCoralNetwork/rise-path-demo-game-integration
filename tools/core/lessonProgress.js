// @ts-check
/**
 * Shared Business Logic — risepath.lesson/v1 reader progress on the server (Phase 2,
 * doc/brushup-2026/ai-access-plan.ja.md §6). Table lesson_progress (one row per learner and
 * lesson, server/migrations/016_lesson_progress.sql), used by the progress API
 * (server/routes/lessonProgress.js) and the MCP course-* tools.
 *
 * - getLessonProgress: stored records with pct/state, recomputed for rows written against
 *   another version of the lesson (content_hash differs from the catalog's).
 * - saveLessonProgress (REST): merges the client's records into the stored ones. The server is
 *   the merge authority and never takes a client record as is: sanitizeProgress, then
 *   mergeProgress into the row locked at write time (shared/lesson/progressMerge.js).
 * - deleteAllLessonProgress (REST): the learner's "delete my lesson progress"; it also moves the
 *   reset epoch, so a device that still holds old records gets 409 progress_reset on its next save
 *   instead of uploading them again.
 * - resetLessonProgress (REST, Phase 5): starts ONE lesson over. It empties that lesson's row (a
 *   tombstone, written even for a lesson never opened) and moves the lesson's own generation
 *   (lesson_progress_lesson_resets.lesson_epoch); the account epoch above is never touched, so other
 *   lessons and devices are unaffected. A saved record must name the lesson's current generation
 *   (lessonEpoch; none or null for a lesson never started over), else that record is refused
 *   'lesson_reset', so a device holding the old record cannot merge it back.
 * - applyQuizCheck (MCP course-quiz-check): grades on the server with the reader's attempt rules
 *   (shared/lesson/grading.js). A wrong answer is a normal result, never an error_type.
 * - markLessonProgress (MCP course-progress-update): marks sections read, only once their check
 *   questions are answered.
 *
 * Web-reader answers arrive self-reported (the web bundle ships the answers); only applyQuizCheck
 * grades. pct and state are always recomputed here against the catalog lesson (shared/lesson/progress.js).
 *
 * Locking: single-lesson writes insert a placeholder row (INSERT … ON CONFLICT DO NOTHING) and
 * then lock it (SELECT … FOR UPDATE), so two writers of one lesson merge one after the other.
 * REST saves and the delete also take a per-user advisory lock, which orders them against each
 * other (no deadlock between a multi-row save and the delete) and makes the epoch check exact.
 * The MCP functions need neither: they touch one row and never read lesson_progress_resets or
 * lesson_progress_lesson_resets, so the remote role (deploy/risepath-vm/sql/mcp_remote_role.sql) has
 * no grant on them. The reset and the delete take the account stub's KEY SHARE lock right after the
 * advisory lock, before any row lock, as account deletion takes the stub before the rows it cascades
 * to (server/services/accountDeletion.js): a reset can never hold a row lock while it waits for the
 * stub. Owner decision O2 (earned XP stays, tools/core/achievements.js): the reset reconciles XP
 * after it locked the row and before it empties it; the delete awards from exactly the rows it
 * deletes, in the DELETE statement itself, because the MCP writers lock only their row (a row an
 * AI app changes while the delete runs is deleted together with what it earned; one it adds after
 * the DELETE started stays). A save never writes XP. A REST save takes no stub lock: a save of
 * several records can still deadlock with an account deletion (it holds a row, then a new row's
 * foreign key check waits for the stub the deletion holds); Postgres ends one of the two (40P01:
 * the save answers 500 and the client retries, or the deletion fails and is run again).
 *
 * Failures return { error, error_type } (tools/core/dbErrors.js), never the driver's text.
 */
import { getPool } from '../../server/db.js';
import { isUuid } from '../../server/utils/ids.js';
import { classifyDbError } from './dbErrors.js';
import { inTransaction, noDatabase } from './dbTransaction.js';
import { deleteLessonsKeepingXp, reconcileLessonXp } from './achievements.js';
import { getPublishedLesson, isSafeSlug } from './courseCatalog.js';
import { answerKey, emptyProgress, isAnswered, lessonPct, lessonState, parseProgress } from '../../shared/lesson/progress.js';
import { mergeProgress, progressContentEqual, sanitizeProgress } from '../../shared/lesson/progressMerge.js';
import { applyReveal, applySubmission, isCorrectChoice, normalizeChoice, quizFeedback } from '../../shared/lesson/grading.js';
import { learnerLocale, optionIdForLabel } from '../../shared/lesson/learnerView.js';

/**
 * @typedef {import('../../shared/lesson/progress.js').LessonProgress} LessonProgress
 * @typedef {import('../../shared/lesson/progress.js').AnswerRecord} AnswerRecord
 * @typedef {import('../../shared/lesson/progress.js').LessonStateName} LessonStateName
 * @typedef {import('../../shared/lesson/progressMerge.js').QuestionEntry} QuestionEntry
 * @typedef {import('./courseCatalog.js').PublishedLesson} PublishedLesson
 * @typedef {import('./dbTransaction.js').CoreError} CoreError
 * @typedef {import('./dbTransaction.js').Queryable} Queryable
 *
 * @typedef {object} StoredRecord
 * @property {string} courseSlug
 * @property {string} lessonId
 * @property {LessonProgress} progress
 * @property {number} pct
 * @property {LessonStateName} state
 * @property {string} updatedAt
 * @property {string | null} [lessonEpoch] the lesson's generation (REST only; null: never started over)
 * @property {string | null} [lessonResetAt] when it was last started over (server clock), or null
 *
 * @typedef {{ courseSlug: string | null, lessonId: string | null, error_type: string,
 *   lessonEpoch?: string | null, lessonResetAt?: string | null, record?: StoredRecord }} RejectedRecord
 *   lessonEpoch, lessonResetAt and (when the row exists) record come only with 'lesson_reset'
 */

/** Largest stored record, in bytes of its jsonb text (the lesson_progress CHECK). */
export const PROGRESS_MAX_BYTES = 65536;

/** Most records one save takes (the REST PUT's limit). */
export const SAVE_BATCH_MAX = 25;

/**
 * Whether the learner's current epoch was written by re-opening a deleted account (Phase 4,
 * tools/core/accountDeletions.js reopenAccount writes reopened_at and reset_at with the same
 * now()). The GET answers restarted: true so a device that knew the old epoch also clears the
 * learning events of the deleted account. A later normal reset moves reset_at and ends it.
 */
export const RESTARTED_SQL = `SELECT EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id = $1::uuid
   AND d.reopened_at = (SELECT r.reset_at FROM lesson_progress_resets r WHERE r.user_id = d.user_id)) AS restarted`;

/** Orders a learner's REST saves, resets and delete against each other (transaction advisory lock). */
export const LEARNER_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('lesson_progress:' || $1))";

/**
 * The account stub, KEY SHARE: taken by the reset and the delete right after LEARNER_LOCK_SQL and
 * before any row lock. Account deletion takes the stub FOR UPDATE before it deletes it (and with it,
 * by cascade, the progress rows), so whichever of the two takes the stub first goes first.
 */
export const ACCOUNT_STUB_SHARE_SQL = 'SELECT 1 FROM auth.users WHERE id = $1 FOR KEY SHARE';

/** The learner's lesson generations (REST saves, under LEARNER_LOCK_SQL). */
export const LESSON_EPOCHS_SQL = 'SELECT course_slug, lesson_id, lesson_epoch, reset_at FROM lesson_progress_lesson_resets WHERE user_id = $1';

/** A new generation for one lesson (its first reset inserts the row). */
export const RESET_LESSON_EPOCH_SQL = `INSERT INTO lesson_progress_lesson_resets (user_id, course_slug, lesson_id) VALUES ($1, $2, $3)
  ON CONFLICT (user_id, course_slug, lesson_id) DO UPDATE SET lesson_epoch = gen_random_uuid(), reset_at = now()
  RETURNING lesson_epoch, reset_at`;

/**
 * The stored record of one lesson, returned with a 'lesson_reset' rejection (under LEARNER_LOCK_SQL).
 * pct and state are recomputed against the published lesson (storedRecordOf), as GET does.
 */
export const STORED_RECORD_SQL = `SELECT progress, progress_updated_at FROM lesson_progress
  WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3`;

/** REST GET only: rows and lesson generations in one statement (one snapshot), after the account epoch. */
export const ROWS_WITH_LESSON_EPOCHS_SQL = `SELECT p.course_slug, p.lesson_id, p.progress, p.pct, p.state, p.content_hash,
       p.progress_updated_at, r.lesson_epoch, r.reset_at
  FROM lesson_progress p
  LEFT JOIN lesson_progress_lesson_resets r
    ON r.user_id = p.user_id AND r.course_slug = p.course_slug AND r.lesson_id = p.lesson_id
 WHERE p.user_id = $1
 ORDER BY p.course_slug, p.lesson_id`;

/** Stored in a placeholder row until the same transaction writes the real record. */
const PLACEHOLDER = JSON.stringify(emptyProgress());

/**
 * Size of a value's jsonb text (octet_length(progress::text), what the CHECK measures). jsonb
 * prints a space after every ":" and "," that JSON.stringify leaves out; the strings in a
 * sanitized record are ids and ISO times, which both print the same way.
 * @param {unknown} value
 * @returns {number}
 */
export function progressTextBytes(value) {
    /** @param {unknown} v @returns {number} */
    const spaces = (v) => {
        if (Array.isArray(v)) return Math.max(0, v.length - 1) + v.reduce((n, item) => n + spaces(item), 0);
        if (v && typeof v === 'object') {
            const items = Object.values(v).filter((item) => item !== undefined);
            return items.length + Math.max(0, items.length - 1) + items.reduce((n, item) => n + spaces(item), 0);
        }
        return 0;
    };
    return Buffer.byteLength(JSON.stringify(value), 'utf8') + spaces(value);
}

/** @param {string} message @returns {CoreError} */
const invalid = (message) => ({ error: message, error_type: 'validation' });

/** An argument echoed in an error message, short and quoted. @param {unknown} value */
const quote = (value) => JSON.stringify(String(value).slice(0, 80));

/** @param {object} object @param {string} key */
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** @param {unknown} value @returns {string | null} */
const isoOf = (value) => {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(/** @type {any} */ (value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** @param {Date | number | undefined} now */
const nowIsoOf = (now) => isoOf(now ?? new Date()) ?? new Date().toISOString();

/**
 * The later of two ISO times (a record's clock never moves back, even when a client clock that
 * ran ahead set it).
 * @param {string} a
 * @param {string} b
 */
const laterIso = (a, b) => ((Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a);

/**
 * pct and state of a record against the published lesson (keys the lesson lacks are ignored).
 * @param {PublishedLesson} entry
 * @param {LessonProgress} progress
 */
const summaryOf = (entry, progress) => ({ pct: lessonPct(entry.lesson, progress), state: lessonState(entry.lesson, progress) });

/**
 * Locks the learner's row for a lesson, creating a placeholder when there is none.
 * @param {Queryable} db
 * @param {string} userId
 * @param {string} courseSlug
 * @param {string} lessonId
 * @returns {Promise<{ created: boolean, stored: LessonProgress | null }>} stored is null for a new row
 */
async function lockRow(db, userId, courseSlug, lessonId) {
    // Twice at most: a row deleted between the two statements (the learner's delete commits
    // in between) is inserted again on the second pass.
    for (let pass = 0; pass < 2; pass += 1) {
        const inserted = await db.query(
            `INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, progress_updated_at)
             VALUES ($1, $2, $3, $4::jsonb, to_timestamp(0))
             ON CONFLICT (user_id, course_slug, lesson_id) DO NOTHING
             RETURNING true AS created`,
            [userId, courseSlug, lessonId, PLACEHOLDER],
        );
        const { rows } = await db.query(
            `SELECT progress FROM lesson_progress
              WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3
              FOR UPDATE`,
            [userId, courseSlug, lessonId],
        );
        if (!rows.length) continue;
        const created = inserted.rowCount === 1;
        return { created, stored: created ? null : parseProgress(rows[0].progress) };
    }
    throw Object.assign(new Error('lesson_progress row vanished while locking it'), { code: 'LOCK_LOST' });
}

/**
 * Writes a record with its pct, state and the catalog hash it was computed against.
 * @param {Queryable} db
 * @param {string} userId
 * @param {PublishedLesson} entry
 * @param {LessonProgress} progress
 */
async function writeRow(db, userId, entry, progress) {
    const { pct, state } = summaryOf(entry, progress);
    await db.query(
        `UPDATE lesson_progress
            SET progress = $4::jsonb, pct = $5, state = $6, content_hash = $7, progress_updated_at = $8
          WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3`,
        [userId, entry.courseSlug, entry.lesson.id, JSON.stringify(progress), pct, state, entry.hash, isoOf(progress.updatedAt) ?? new Date(0).toISOString()],
    );
    return { pct, state };
}

/** @param {Queryable} db @param {string} userId */
const lockUser = (db, userId) => db.query(LEARNER_LOCK_SQL, [userId]);

/**
 * A lesson's generation as the API states it: the epoch (null: never started over) and when.
 * @typedef {{ epoch: string | null, at: string | null }} LessonGeneration
 */

/** @type {LessonGeneration} */
const NEVER_RESET = Object.freeze({ epoch: null, at: null });

/**
 * The record a 'lesson_reset' rejection carries: the stored one, with the lesson's generation. pct
 * and state are computed against the published lesson, so they match what the next GET answers
 * even when the lesson changed since the row was written.
 * @param {PublishedLesson} entry
 * @param {{ progress: unknown, progress_updated_at: unknown }} row
 * @param {LessonGeneration} gen
 * @returns {StoredRecord}
 */
function storedRecordOf(entry, row, gen) {
    const progress = parseProgress(row.progress);
    return {
        courseSlug: entry.courseSlug,
        lessonId: entry.lesson.id,
        progress,
        ...summaryOf(entry, progress),
        updatedAt: isoOf(row.progress_updated_at) ?? progress.updatedAt,
        lessonEpoch: gen.epoch,
        lessonResetAt: gen.at,
    };
}

// ─── Read ──────────────────────────────────────────────────────

/**
 * The learner's stored lesson records (all, one course, or one lesson), by course slug and lesson id.
 * Rows stored against another version of a lesson get pct/state recomputed against the current
 * one and written back (best effort: a failed write-back is logged, the answer stays right).
 *
 * @param {{ userId: string, courseSlug?: string, lessonId?: string, withEpoch?: boolean }} params
 *   withEpoch: also read the reset epoch (the REST API; the MCP role cannot read it) and, when
 *   there is one, whether it is the epoch of a re-opened deleted account (RESTARTED_SQL); every
 *   record then also carries its lesson's generation (lessonEpoch, lessonResetAt; null for a lesson
 *   never started over), read with the rows in one statement (ROWS_WITH_LESSON_EPOCHS_SQL). It reads
 *   every course: it cannot be combined with courseSlug. Without it (every MCP caller) the SQL never
 *   names lesson_progress_resets or lesson_progress_lesson_resets.
 * @returns {Promise<{ epoch?: string | null, restarted?: boolean, records: StoredRecord[] } | CoreError>}
 */
export async function getLessonProgress({ userId, courseSlug, lessonId, withEpoch = false }) {
    if (!isUuid(userId)) return invalid('A signed-in learner is required.');
    if (withEpoch && (courseSlug !== undefined || lessonId !== undefined)) return invalid('withEpoch reads every course: pass no course_slug or lesson_id.');
    if (courseSlug !== undefined && !isSafeSlug(courseSlug)) return invalid(`Invalid course_slug ${quote(courseSlug)}.`);
    if (lessonId !== undefined && (courseSlug === undefined || !isSafeSlug(lessonId))) {
        return invalid(courseSlug === undefined ? 'lesson_id needs course_slug.' : `Invalid lesson_id ${quote(lessonId)}.`);
    }
    const pool = getPool();
    if (!pool) return noDatabase();
    try {
        // The epoch first, then the rows: a delete that commits in between is then seen as an
        // old epoch with fewer rows (a later save answers 409), never as old rows under a new epoch.
        /** @type {string | null} */
        let epoch = null;
        let restarted = false;
        if (withEpoch) {
            const reset = await pool.query('SELECT epoch FROM lesson_progress_resets WHERE user_id = $1', [userId]);
            epoch = reset.rows[0]?.epoch ? String(reset.rows[0].epoch) : null;
            if (epoch) restarted = (await pool.query(RESTARTED_SQL, [userId]))?.rows?.[0]?.restarted === true;
        }
        const params = [userId, ...(courseSlug !== undefined ? [courseSlug] : []), ...(lessonId !== undefined ? [lessonId] : [])];
        const { rows } = withEpoch
            ? await pool.query(ROWS_WITH_LESSON_EPOCHS_SQL, [userId])
            : await pool.query(
                `SELECT course_slug, lesson_id, progress, pct, state, content_hash, progress_updated_at
                   FROM lesson_progress
                  WHERE user_id = $1${courseSlug !== undefined ? ' AND course_slug = $2' : ''}${lessonId !== undefined ? ' AND lesson_id = $3' : ''}
                  ORDER BY course_slug, lesson_id`,
                params,
            );
        /** @type {StoredRecord[]} */
        const records = [];
        /** @type {[string, string, number, string, string][]} */
        const stale = [];
        for (const row of rows) {
            const progress = parseProgress(row.progress);
            let pct = Number(row.pct) || 0;
            /** @type {LessonStateName} */
            let state = row.state;
            const entry = getPublishedLesson(row.course_slug, row.lesson_id);
            if (entry && row.content_hash !== entry.hash) {
                ({ pct, state } = summaryOf(entry, progress));
                stale.push([row.course_slug, row.lesson_id, pct, state, entry.hash]);
            }
            records.push({
                courseSlug: row.course_slug,
                lessonId: row.lesson_id,
                progress,
                pct,
                state,
                updatedAt: isoOf(row.progress_updated_at) ?? progress.updatedAt,
                ...(withEpoch ? { lessonEpoch: row.lesson_epoch ? String(row.lesson_epoch) : null, lessonResetAt: isoOf(row.reset_at) } : {}),
            });
        }
        for (const [slug, id, pct, state, hash] of stale) {
            try {
                // Only rows still on the old hash: a save that committed since wrote the new one.
                await pool.query(
                    `UPDATE lesson_progress SET pct = $4, state = $5, content_hash = $6
                      WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3 AND content_hash IS DISTINCT FROM $6`,
                    [userId, slug, id, pct, state, hash],
                );
            } catch (err) {
                console.warn('[lessonProgress] pct/state write-back failed:', /** @type {any} */ (err)?.code || '', /** @type {any} */ (err)?.message || err);
            }
        }
        return withEpoch ? { epoch, restarted, records } : { records };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'getLessonProgress');
    }
}

// ─── REST writes ───────────────────────────────────────────────

/** @param {unknown} value @returns {string | null} */
const echoId = (value) => (typeof value === 'string' ? value.slice(0, 120) : null);

/**
 * Merges a batch of client records into the stored ones, in one transaction. The batch is
 * refused as a whole (409 progress_reset) when `epoch` is not the learner's current reset
 * epoch (null until the first delete): the device's records predate a delete.
 * A record for a lesson that is not published (or breaks the id rule) is rejected
 * 'unknown_lesson'; one whose merged record would exceed PROGRESS_MAX_BYTES 'too_large'; one
 * whose lessonEpoch is not the lesson's current generation 'lesson_reset' (absent or not a uuid
 * counts as null, the generation of a lesson never started over), with the generation and the
 * stored record, so the device can drop its old copy. The other records are saved, each with its
 * lesson's generation.
 * learned (never sent to the client): a saved record's content changed and it is not
 * not_started, i.e. the learner learned something (the post-save XP hook, Phase 5 stage 2).
 *
 * @param {{ userId: string, epoch: string | null, records: { courseSlug?: unknown, lessonId?: unknown, progress?: unknown, lessonEpoch?: unknown }[], now?: Date | number }} params
 * @returns {Promise<{ epoch: string | null, records: StoredRecord[], rejected: RejectedRecord[], learned: boolean } | (CoreError & { epoch?: string | null })>}
 */
export async function saveLessonProgress({ userId, epoch, records, now }) {
    if (!isUuid(userId)) return invalid('A signed-in learner is required.');
    if (epoch !== null && typeof epoch !== 'string') return invalid('epoch must be a string or null.');
    if (!Array.isArray(records) || records.length < 1 || records.length > SAVE_BATCH_MAX) {
        return invalid(`records must hold 1 to ${SAVE_BATCH_MAX} records.`);
    }
    /** @type {RejectedRecord[]} */
    const rejected = [];
    /** @type {{ entry: PublishedLesson, client: LessonProgress, lessonEpoch: string | null }[]} */
    const prepared = [];
    for (const record of records) {
        const courseSlug = record?.courseSlug;
        const lessonId = record?.lessonId;
        const entry = getPublishedLesson(courseSlug, lessonId);
        if (!entry) {
            rejected.push({ courseSlug: echoId(courseSlug), lessonId: echoId(lessonId), error_type: 'unknown_lesson' });
            continue;
        }
        const client = sanitizeProgress(record.progress, { now });
        // A merge keeps every key of the client record, so one that is too large alone is
        // rejected before any SQL (and no placeholder row is ever left behind).
        if (progressTextBytes(client) > PROGRESS_MAX_BYTES) {
            rejected.push({ courseSlug: entry.courseSlug, lessonId: entry.lesson.id, error_type: 'too_large' });
            continue;
        }
        const sent = record?.lessonEpoch;
        const lessonEpoch = typeof sent === 'string' && isUuid(sent) ? sent.toLowerCase() : null;
        prepared.push({ entry, client, lessonEpoch });
    }
    // One lock order for every writer of several rows.
    const keyOf = (/** @type {{ entry: PublishedLesson }} */ p) => `${p.entry.courseSlug}/${p.entry.lesson.id}`;
    prepared.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));

    return inTransaction('saveLessonProgress', async (db) => {
        await lockUser(db, userId);
        const reset = await db.query('SELECT epoch FROM lesson_progress_resets WHERE user_id = $1', [userId]);
        const current = reset.rows[0]?.epoch ? String(reset.rows[0].epoch) : null;
        if (current !== (epoch === null ? null : epoch.toLowerCase())) {
            return {
                commit: false,
                value: {
                    error: 'This lesson progress was deleted. Load it again before saving.',
                    error_type: 'progress_reset',
                    epoch: current,
                },
            };
        }
        // The lessons' generations, once, under the learner's lock: no reset can commit in between.
        /** @type {Map<string, LessonGeneration>} */
        const generations = new Map((await db.query(LESSON_EPOCHS_SQL, [userId])).rows
            .map((row) => [`${row.course_slug}/${row.lesson_id}`, { epoch: String(row.lesson_epoch), at: isoOf(row.reset_at) }]));
        /** @type {Map<string, StoredRecord>} */
        const saved = new Map();
        let learned = false;
        for (const item of prepared) {
            const { entry, client } = item;
            const gen = generations.get(keyOf(item)) ?? NEVER_RESET;
            if (item.lessonEpoch !== gen.epoch) {
                // The record builds on another generation of this lesson (or does not say, as an old
                // bundle): merging it would bring back what the learner started over from.
                const { rows } = await db.query(STORED_RECORD_SQL, [userId, entry.courseSlug, entry.lesson.id]);
                rejected.push({
                    courseSlug: entry.courseSlug,
                    lessonId: entry.lesson.id,
                    error_type: 'lesson_reset',
                    lessonEpoch: gen.epoch,
                    lessonResetAt: gen.at,
                    ...(rows[0] ? { record: storedRecordOf(entry, rows[0], gen) } : {}),
                });
                continue;
            }
            const { created, stored } = await lockRow(db, userId, entry.courseSlug, entry.lesson.id);
            const merged = mergeProgress(stored, client);
            if (progressTextBytes(merged) > PROGRESS_MAX_BYTES) {
                if (created) {
                    await db.query('DELETE FROM lesson_progress WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3', [userId, entry.courseSlug, entry.lesson.id]);
                }
                rejected.push({ courseSlug: entry.courseSlug, lessonId: entry.lesson.id, error_type: 'too_large' });
                continue;
            }
            const { pct, state } = await writeRow(db, userId, entry, merged);
            if (state !== 'not_started' && !progressContentEqual(stored ?? emptyProgress(), merged)) learned = true;
            saved.set(keyOf(item), {
                courseSlug: entry.courseSlug,
                lessonId: entry.lesson.id,
                progress: merged,
                pct,
                state,
                updatedAt: merged.updatedAt,
                lessonEpoch: gen.epoch,
                lessonResetAt: gen.at,
            });
        }
        return { commit: true, value: { epoch: current, records: [...saved.values()], rejected, learned } };
    });
}

/**
 * Starts ONE published lesson over for the learner: empties its record (a tombstone row: empty
 * progress, pct 0, not_started, clock 1970; written even for a lesson never opened, so another
 * device's unsent copy has nothing to merge into) and gives the lesson a new generation, in one
 * transaction under the learner's lock. What the record earned so far is reconciled into the XP
 * ledger first (O2). The account epoch is checked like a save's (409 progress_reset when the
 * learner deleted everything elsewhere) and never moved: other lessons and devices are untouched,
 * and the Phase 4 restarted signal stays.
 *
 * Lock order: LEARNER_LOCK_SQL, ACCOUNT_STUB_SHARE_SQL, the lesson's row, then the XP lock.
 *
 * @param {{ userId: string, epoch: string | null, courseSlug: unknown, lessonId: unknown }} params
 * @returns {Promise<{ epoch: string | null, courseSlug: string, lessonId: string, lessonEpoch: string, lessonResetAt: string | null, record: StoredRecord } | (CoreError & { epoch?: string | null })>}
 */
export async function resetLessonProgress({ userId, epoch, courseSlug, lessonId }) {
    if (!isUuid(userId)) return invalid('A signed-in learner is required.');
    if (epoch !== null && !isUuid(epoch)) return invalid('epoch must be null or the epoch the last GET returned.');
    const entry = getPublishedLesson(courseSlug, lessonId);
    if (!entry) return { error: 'Only a published lesson can be started over.', error_type: 'unknown_lesson' };
    return inTransaction('resetLessonProgress', async (db) => {
        await lockUser(db, userId);
        await db.query(ACCOUNT_STUB_SHARE_SQL, [userId]);
        const reset = await db.query('SELECT epoch FROM lesson_progress_resets WHERE user_id = $1', [userId]);
        const current = reset.rows[0]?.epoch ? String(reset.rows[0].epoch) : null;
        if (current !== (epoch === null ? null : epoch.toLowerCase())) {
            return {
                commit: false,
                value: { error: 'This lesson progress was deleted. Load it again before starting over.', error_type: 'progress_reset', epoch: current },
            };
        }
        await lockRow(db, userId, entry.courseSlug, entry.lesson.id);
        await reconcileLessonXp(db, userId);
        const empty = emptyProgress();
        const { pct, state } = await writeRow(db, userId, entry, empty);
        const { rows } = await db.query(RESET_LESSON_EPOCH_SQL, [userId, entry.courseSlug, entry.lesson.id]);
        const lessonEpoch = String(rows[0].lesson_epoch);
        const lessonResetAt = isoOf(rows[0].reset_at);
        /** @type {StoredRecord} */
        const record = { courseSlug: entry.courseSlug, lessonId: entry.lesson.id, progress: empty, pct, state, updatedAt: empty.updatedAt, lessonEpoch, lessonResetAt };
        return { commit: true, value: { epoch: current, courseSlug: entry.courseSlug, lessonId: entry.lesson.id, lessonEpoch, lessonResetAt, record } };
    });
}

/**
 * Deletes every lesson record of the learner (every course) and starts a new reset epoch, in one
 * transaction under the learner's advisory lock (so no save of the old epoch commits after it).
 * The XP the deleted records earned is awarded by the DELETE statement itself and stays (O2), also
 * for a row an AI app changes while the delete waits for it; the lessons' generations
 * (lesson_progress_lesson_resets), the XP ledger and the learning days are kept.
 *
 * Lock order: LEARNER_LOCK_SQL, ACCOUNT_STUB_SHARE_SQL, the XP lock, then the rows (the DELETE).
 * The reset takes its row before the XP lock, but both hold the learner lock first, so they never
 * run at the same time; the reconciles take the XP lock and lock no lesson_progress row, and the
 * MCP writers lock one row and never take the XP lock: no cycle.
 *
 * @param {{ userId: string }} params
 * @returns {Promise<{ deleted: number, epoch: string } | CoreError>}
 */
export async function deleteAllLessonProgress({ userId }) {
    if (!isUuid(userId)) return invalid('A signed-in learner is required.');
    return inTransaction('deleteAllLessonProgress', async (db) => {
        await lockUser(db, userId);
        await db.query(ACCOUNT_STUB_SHARE_SQL, [userId]);
        const deleted = await deleteLessonsKeepingXp(db, userId);
        const { rows } = await db.query(
            `INSERT INTO lesson_progress_resets (user_id) VALUES ($1)
             ON CONFLICT (user_id) DO UPDATE SET epoch = gen_random_uuid(), reset_at = now()
             RETURNING epoch`,
            [userId],
        );
        return { commit: true, value: { deleted, epoch: String(rows[0].epoch) } };
    });
}

// ─── MCP writes ────────────────────────────────────────────────

/**
 * @param {unknown} courseSlug
 * @param {unknown} lessonId
 * @returns {CoreError}
 */
const notPublished = (courseSlug, lessonId) => ({
    error: `${quote(courseSlug)} / ${quote(lessonId)} is not a published lesson. course-list lists the published lessons.`,
    error_type: 'not_found',
});

/**
 * The question with this id (ids are unique in a lesson), in the given block when one is named.
 * @param {PublishedLesson} entry
 * @param {unknown} questionId
 * @param {unknown} blockId
 * @returns {QuestionEntry | null}
 */
function findQuestion(entry, questionId, blockId) {
    for (const item of entry.index.questions.values()) {
        if (item.question.id === questionId && (blockId === undefined || blockId === null || item.blockId === blockId)) return item;
    }
    return null;
}

/**
 * Records the learner's answer to one question (or "show me the answer" after a miss) and
 * returns what the learner may now see. Grading uses the full lesson; choices are the positional
 * labels of course-lesson-get ("1".."n" or 1..n), mapped back to option ids here.
 *
 * Refusals (error_type, nothing recorded): not_found (lesson or question), lesson_changed
 * (content_hash given and not the current one: labels may point at other options now),
 * invalid_choice, validation. A locked question (already correct, revealed, out of attempts, or a
 * prediction already made) records nothing and still answers, with the explanation and
 * this_choice_correct; a reveal that is not allowed answers outcome 'not_allowed'.
 *
 * @param {{ userId: string, courseSlug: string, lessonId: string, questionId: string, blockId?: string,
 *   choices?: unknown, reveal?: boolean, contentHash?: string, locale?: string, now?: Date | number }} params
 */
export async function applyQuizCheck({ userId, courseSlug, lessonId, questionId, blockId, choices, reveal = false, contentHash, locale, now }) {
    if (!isUuid(userId)) return invalid('A signed-in learner is required.');
    const entry = getPublishedLesson(courseSlug, lessonId);
    if (!entry) return notPublished(courseSlug, lessonId);
    if (contentHash !== undefined && contentHash !== null && contentHash !== entry.hash) {
        return {
            error: 'This lesson changed since it was read: option labels may point at other options now. Read it again with course-lesson-get, then ask the learner again.',
            error_type: 'lesson_changed',
            content_hash: entry.hash,
        };
    }
    const found = findQuestion(entry, questionId, blockId);
    if (!found) {
        return { error: `No question ${quote(questionId)}${blockId ? ` in block ${quote(blockId)}` : ''} in this lesson.`, error_type: 'not_found' };
    }
    const { question, mode } = found;

    /** @type {string[]} */
    let ids = [];
    if (reveal === true) {
        if (choices !== undefined && choices !== null && !(Array.isArray(choices) && choices.length === 0)) {
            return invalid('Send either choices (the learner\'s answer) or reveal: true, not both.');
        }
    } else {
        if (choices === undefined || choices === null) return invalid('choices is required: the option labels the learner chose (or reveal: true after a miss).');
        const labels = Array.isArray(choices) ? choices : [choices];
        const mapped = labels.map((label) => optionIdForLabel(question, label));
        const checked = mapped.every((id) => id !== null) ? normalizeChoice(question, mapped) : { ok: false };
        if (!checked.ok || !('ids' in checked)) {
            const count = question.options.length;
            const one = (question.kind ?? 'single') !== 'multi';
            return {
                error: `Invalid choice: send ${one ? 'exactly one label' : 'one or more labels'} from "1" to "${count}".`,
                error_type: 'invalid_choice',
            };
        }
        ids = checked.ids;
    }
    const used = learnerLocale(entry.lesson, locale);
    const nowIso = nowIsoOf(now);
    const base = {
        course_slug: entry.courseSlug,
        lesson_id: entry.lesson.id,
        block_id: found.blockId,
        question_id: question.id,
    };

    return inTransaction('applyQuizCheck', async (db) => {
        const { stored } = await lockRow(db, userId, entry.courseSlug, entry.lesson.id);
        const current = stored ?? emptyProgress();
        const key = answerKey(found.blockId, question.id);
        const record = hasOwn(current.answers, key) ? current.answers[key] : undefined;
        const result = reveal === true
            ? applyReveal(record, { mode })
            : applySubmission(record, { correct: isCorrectChoice(question, ids), chosen: ids, mode });
        const feedback = quizFeedback(question, result.record, result.outcome, { mode, locale: used, fallback: entry.lesson.locale, chosen: ids });

        if (result.outcome === 'locked' || result.outcome === 'not_allowed' || !result.record) {
            return {
                commit: false,
                value: {
                    ...base,
                    ...feedback,
                    ...(result.outcome === 'not_allowed'
                        ? { note: 'Nothing recorded: the answer can be shown only after a wrong answer to a graded question that is not answered correctly or shown yet.' }
                        : {}),
                    ...(result.outcome === 'locked' ? { note: 'Nothing recorded: this question is already finished.' } : {}),
                    ...summaryOf(entry, current),
                    content_hash: entry.hash,
                    locale: used,
                },
            };
        }
        /** @type {LessonProgress} */
        const next = {
            ...current,
            answers: { ...current.answers, [key]: result.record },
            updatedAt: laterIso(current.updatedAt, nowIso),
        };
        if (progressTextBytes(next) > PROGRESS_MAX_BYTES) {
            return { commit: false, value: { error: 'This lesson\'s saved progress is too large to add to.', error_type: 'too_large' } };
        }
        const summary = await writeRow(db, userId, entry, next);
        return { commit: true, value: { ...base, ...feedback, ...summary, content_hash: entry.hash, locale: used } };
    });
}

/**
 * Marks sections of a lesson read and/or sets the resume block. A section's reading blocks are
 * marked seen only when every check question in it (inline and predict; exam questions do not
 * count) is answered; otherwise the section is skipped with the open question ids, so an agent
 * cannot finish a lesson without the learner answering. Ids are checked against the lesson.
 *
 * @param {{ userId: string, courseSlug: string, lessonId: string, readSectionIds?: unknown, lastBlockId?: unknown, now?: Date | number }} params
 */
export async function markLessonProgress({ userId, courseSlug, lessonId, readSectionIds, lastBlockId, now }) {
    if (!isUuid(userId)) return invalid('A signed-in learner is required.');
    const entry = getPublishedLesson(courseSlug, lessonId);
    if (!entry) return notPublished(courseSlug, lessonId);

    const sectionIds = readSectionIds === undefined || readSectionIds === null ? [] : readSectionIds;
    if (!Array.isArray(sectionIds) || sectionIds.some((id) => typeof id !== 'string')) return invalid('read_section_ids must be a list of section ids.');
    const unknown = sectionIds.filter((id) => !entry.index.sections.has(id));
    if (unknown.length) {
        return invalid(`Unknown section id(s) ${unknown.slice(0, 5).map(quote).join(', ')}. course-lesson-get lists the sections.`);
    }
    if (lastBlockId !== undefined && lastBlockId !== null && (typeof lastBlockId !== 'string' || !entry.index.blockIds.has(lastBlockId))) {
        return invalid(`Unknown block id ${quote(lastBlockId)}.`);
    }
    const wanted = [...new Set(/** @type {string[]} */ (sectionIds))];
    const resume = typeof lastBlockId === 'string' ? lastBlockId : undefined;
    if (!wanted.length && resume === undefined) return invalid('Pass read_section_ids or last_block_id.');
    const nowIso = nowIsoOf(now);
    const base = { course_slug: entry.courseSlug, lesson_id: entry.lesson.id };

    return inTransaction('markLessonProgress', async (db) => {
        const { stored } = await lockRow(db, userId, entry.courseSlug, entry.lesson.id);
        const current = stored ?? emptyProgress();
        const seen = new Set(current.seen);
        /** @type {string[]} */
        const added = [];
        /** @type {string[]} */
        const marked = [];
        /** @type {{ section_id: string, reason: 'answer_check_first', question_ids: string[] }[]} */
        const skipped = [];
        for (const sectionId of wanted) {
            const section = /** @type {import('../../shared/lesson/progressMerge.js').SectionEntry} */ (entry.index.sections.get(sectionId));
            const open = section.nonExamQuizKeys
                .map((key) => /** @type {QuestionEntry} */ (entry.index.questions.get(key)))
                .filter((q) => !isAnswered(current, q.blockId, q.question.id));
            if (open.length) {
                skipped.push({ section_id: sectionId, reason: 'answer_check_first', question_ids: open.map((q) => q.question.id) });
                continue;
            }
            for (const blockId of section.readingBlockIds) {
                if (!seen.has(blockId)) {
                    seen.add(blockId);
                    added.push(blockId);
                }
            }
            marked.push(sectionId);
        }
        const nextResume = resume === undefined ? current.lastBlockId : resume;
        const result = { ...base, marked_section_ids: marked, skipped };
        if (!added.length && nextResume === current.lastBlockId) {
            return { commit: false, value: { ...result, last_block_id: current.lastBlockId, ...summaryOf(entry, current) } };
        }
        /** @type {LessonProgress} */
        const next = {
            ...current,
            seen: [...current.seen, ...added],
            lastBlockId: nextResume,
            updatedAt: laterIso(current.updatedAt, nowIso),
        };
        if (progressTextBytes(next) > PROGRESS_MAX_BYTES) {
            return { commit: false, value: { error: 'This lesson\'s saved progress is too large to add to.', error_type: 'too_large' } };
        }
        const summary = await writeRow(db, userId, entry, next);
        return { commit: true, value: { ...result, last_block_id: next.lastBlockId, ...summary } };
    });
}
