// @ts-check
/**
 * The learner's lesson progress (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6): the
 * risepath.lesson/v1 reader's records, synced across the learner's signed-in devices. Mounted by
 * server.js at /api/v2/user/lesson-progress behind requireAuth (so an agent's own OAuth token gets
 * 401 oauth_client_token; agents use the MCP course-* tools), with its own 256 kb JSON body limit
 * and a per-user limit on writes. Not gated by AI access: progress is not an AI feature, so
 * minors keep it.
 *
 * GET    /  → { ok, epoch, capabilities: { lessonReset: true, achievements: true, review: true },
 *               records: [{ courseSlug, lessonId, progress, pct, state, updatedAt, lessonEpoch, lessonResetAt }] }
 *             epoch: the learner's reset epoch (null until the first DELETE). pct and state are
 *             the server's, against the published lesson. restarted: true (only then present, before
 *             capabilities) when the epoch was written by re-opening a deleted account (Phase 4): a
 *             device that knew another epoch clears its learning events too. capabilities (Phase 5):
 *             what this server offers (an older one sends none): the one-lesson reset below,
 *             GET /api/v2/user/achievements (server/routes/achievements.js) and (Phase 6) the review
 *             queue, /api/v2/user/review (server/routes/review.js). lessonEpoch /
 *             lessonResetAt: the lesson's generation and when it was last started over (null, null: never).
 * PUT    /  body { epoch: string | null, records: [{ courseSlug, lessonId, progress, lessonEpoch? }] } (1–25)
 *          → { ok, epoch, records, rejected: [{ courseSlug, lessonId, error_type, lessonEpoch?, lessonResetAt?, record? }] }
 *             Each record is sanitized and merged into the stored one (never stored as sent); the
 *             merged records come back, with their lesson's generation. A lesson that is not
 *             published (or an id that breaks the one id rule) is rejected 'unknown_lesson' for that
 *             record only; a record whose merge would pass 64 KiB 'too_large'; a record whose
 *             lessonEpoch (absent counts as null) is not the lesson's current generation
 *             'lesson_reset', with lessonEpoch, lessonResetAt and the stored record (when there is
 *             one): the lesson was started over since the device's copy was made.
 *             409 { error_type: 'progress_reset', epoch } when `epoch` is not the current one: the
 *             learner deleted their progress since this device loaded it. Nothing is saved.
 *             After the answer, when a saved record's content changed and it is not not_started
 *             (the learner learned something), the afterSave hook runs: by default
 *             tools/core/achievements.js noteLearning (XP and today as a learning day, Phase 5). It
 *             never changes the answer, and its failure is only logged.
 *             400 { error_type: 'validation' } for a malformed body (a lessonEpoch that is present
 *             must be null or a uuid).
 * POST   /lesson-reset  body { epoch: string | null, courseSlug, lessonId } (Phase 5)
 *          → { ok, epoch, courseSlug, lessonId, lessonEpoch, lessonResetAt, record }
 *             Starts one published lesson over: its record becomes empty on the server and on every
 *             device at their next load or save, and the lesson gets a new generation. The account
 *             epoch is checked like PUT's (409 progress_reset with epoch) and never moved. XP already
 *             earned, learning days and learning events stay. Phase 6 (R4): the lesson's review cards
 *             and their reviews are deleted too; finishing the lesson again enters its cards fresh.
 *             400 unknown_lesson for a lesson that is not published. A new path, not
 *             DELETE /?course=: an older server's DELETE / ignores the query and deletes every
 *             course; this path answers 404 there.
 * DELETE /  → { ok, deleted, epoch }: every lesson record of the learner (all courses, quiz answers
 *             included), every review card and review (Phase 6, R4), and a new epoch. The streak and
 *             learning events (/user/events), XP already earned, the lessons' generations and the
 *             legacy user_progress rows stay.
 *
 * Every refusal from this router is { ok: false, error, error_type } (409 progress_reset adds epoch).
 * 503 { error_type: 'lesson_progress_unavailable' } without a database (or when it is down);
 * other database failures 500 { error_type: 'lesson_progress_failed' }. Never the driver's text.
 * 401 (requireAuth) and 429 (the write limiter) come from server.js, in their own shape.
 * Logic and SQL: tools/core/lessonProgress.js. Tables: server/migrations/016_lesson_progress.sql,
 * 019_phase5_learning.sql.
 */
import express from 'express';
import { getPool } from '../db.js';
import { isUuid } from '../utils/ids.js';
import {
  SAVE_BATCH_MAX,
  deleteAllLessonProgress,
  getLessonProgress,
  resetLessonProgress,
  saveLessonProgress,
} from '../../tools/core/lessonProgress.js';
import { noteLearning } from '../../tools/core/achievements.js';

/** Largest PUT body (25 records; the client keeps its batches well under this). */
export const LESSON_PROGRESS_BODY_LIMIT = '256kb';

/** Writes (PUT, DELETE and POST /lesson-reset) per learner per minute. The client saves at most once per 20 s per tab. */
export const LESSON_PROGRESS_WRITES_PER_MINUTE = 30;

/** Core error types that mean "the database cannot serve this now" (503, try again later). */
const UNAVAILABLE = new Set(['db_connection', 'table_not_found', 'permission_denied']);

/** @param {import('express').Request} req */
const userIdOf = (req) => /** @type {string} */ (/** @type {any} */ (req).userId);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {import('express').Response} res */
const unavailable = (res) => res.status(503).json({
  ok: false,
  error: 'Lesson progress is unavailable right now. Please try again later.',
  error_type: 'lesson_progress_unavailable',
});

/** @param {import('express').Response} res @param {string} message */
const badRequest = (res, message) => res.status(400).json({ ok: false, error: message, error_type: 'validation' });

/**
 * Answers a core error ({ error, error_type }) without its text when it came from the database.
 * @param {import('express').Response} res
 * @param {{ error_type: string }} result
 */
function failed(res, result) {
  if (UNAVAILABLE.has(result.error_type)) return unavailable(res);
  return res.status(500).json({ ok: false, error: 'Lesson progress could not be saved or read.', error_type: 'lesson_progress_failed' });
}

/**
 * Error handler for this mount's JSON body parser (server.js registers it right after the
 * parser): a body that is not JSON answers 400 validation, one over the limit 413.
 * @param {unknown} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function lessonProgressBodyErrors(err, req, res, next) {
  const status = /** @type {any} */ (err)?.status ?? /** @type {any} */ (err)?.statusCode;
  if (status === 413) {
    return res.status(413).json({ ok: false, error: `The request body is larger than ${LESSON_PROGRESS_BODY_LIMIT}. Send fewer records at once.`, error_type: 'body_too_large' });
  }
  if (status === 400) return badRequest(res, 'The request body is not valid JSON.');
  return next(err);
}

/** What this server offers the reader (GET capabilities; an older server sends none). */
export const LESSON_PROGRESS_CAPABILITIES = Object.freeze({ lessonReset: true, achievements: true, review: true });

/** @param {unknown} value */
const isUuidOrNull = (value) => value === null || isUuid(value);

/**
 * @typedef {(params: { userId: string }) => unknown} AfterSave
 */

/**
 * Runs the after-save hook without waiting for it: a throw or a rejection is logged, never
 * answered (the save was already answered).
 * @param {AfterSave} afterSave
 * @param {string} userId
 */
function runAfterSave(afterSave, userId) {
  /** @param {unknown} error */
  const log = (error) => console.warn('[lessonProgress] after-save hook failed:', /** @type {any} */ (error)?.code ?? 'error');
  try {
    Promise.resolve(afterSave({ userId })).catch(log);
  } catch (error) {
    log(error);
  }
}

/**
 * @param {{ writeLimiter?: import('express').RequestHandler, afterSave?: AfterSave }} [options]
 *   writeLimiter: runs before PUT, DELETE and POST /lesson-reset (server.js passes a per-user rate limiter)
 *   afterSave: called after a PUT that taught something was answered (default noteLearning; route
 *   tests pass a no-op or a recorder: server.js createApp({ lessonProgress: { afterSave } }))
 */
export function createLessonProgressRouter({ writeLimiter, afterSave = noteLearning } = {}) {
  const router = express.Router();
  /** @type {import('express').RequestHandler} */
  const limitWrites = writeLimiter ?? ((req, res, next) => next());

  router.get('/', async (req, res) => {
    if (!getPool()) return unavailable(res);
    const result = await getLessonProgress({ userId: userIdOf(req), withEpoch: true });
    if ('error_type' in result) return failed(res, result);
    res.json({
      ok: true,
      epoch: result.epoch ?? null,
      ...(result.restarted === true ? { restarted: true } : {}),
      capabilities: { ...LESSON_PROGRESS_CAPABILITIES },
      records: result.records,
    });
  });

  router.put('/', limitWrites, async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body)) return badRequest(res, 'Send a JSON object { epoch, records }.');
    if (!(body.epoch === null || isUuid(body.epoch))) return badRequest(res, 'epoch must be null or the epoch the last GET returned.');
    const { records } = body;
    if (!Array.isArray(records) || records.length < 1 || records.length > SAVE_BATCH_MAX) {
      return badRequest(res, `records must be a list of 1 to ${SAVE_BATCH_MAX} records.`);
    }
    if (!records.every(isPlainObject)) return badRequest(res, 'Every record must be an object { courseSlug, lessonId, progress }.');
    if (!records.every((record) => !Object.prototype.hasOwnProperty.call(record, 'lessonEpoch') || isUuidOrNull(record.lessonEpoch))) {
      return badRequest(res, 'A record\'s lessonEpoch must be null or the lessonEpoch the server last sent for that lesson.');
    }
    if (!getPool()) return unavailable(res);

    const result = await saveLessonProgress({
      userId: userIdOf(req),
      epoch: body.epoch === null ? null : String(body.epoch).toLowerCase(),
      records: /** @type {Record<string, unknown>[]} */ (records),
    });
    if ('error_type' in result) {
      if (result.error_type === 'progress_reset') {
        return res.status(409).json({ ok: false, error: result.error, error_type: 'progress_reset', epoch: /** @type {any} */ (result).epoch ?? null });
      }
      return failed(res, result);
    }
    res.json({ ok: true, epoch: result.epoch, records: result.records, rejected: result.rejected });
    if (result.learned) runAfterSave(afterSave, userIdOf(req));
  });

  router.post('/lesson-reset', limitWrites, async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body)) return badRequest(res, 'Send a JSON object { epoch, courseSlug, lessonId }.');
    if (!isUuidOrNull(body.epoch)) return badRequest(res, 'epoch must be null or the epoch the last GET returned.');
    if (typeof body.courseSlug !== 'string' || typeof body.lessonId !== 'string') {
      return badRequest(res, 'courseSlug and lessonId must be the published lesson\'s ids.');
    }
    if (!getPool()) return unavailable(res);

    const result = await resetLessonProgress({
      userId: userIdOf(req),
      epoch: body.epoch === null ? null : String(body.epoch).toLowerCase(),
      courseSlug: body.courseSlug,
      lessonId: body.lessonId,
    });
    if ('error_type' in result) {
      if (result.error_type === 'progress_reset') {
        return res.status(409).json({ ok: false, error: result.error, error_type: 'progress_reset', epoch: /** @type {any} */ (result).epoch ?? null });
      }
      if (result.error_type === 'unknown_lesson') {
        return res.status(400).json({ ok: false, error: 'Only a published lesson can be started over.', error_type: 'unknown_lesson' });
      }
      return failed(res, result);
    }
    res.json({
      ok: true,
      epoch: result.epoch,
      courseSlug: result.courseSlug,
      lessonId: result.lessonId,
      lessonEpoch: result.lessonEpoch,
      lessonResetAt: result.lessonResetAt,
      record: result.record,
    });
  });

  router.delete('/', limitWrites, async (req, res) => {
    if (!getPool()) return unavailable(res);
    const result = await deleteAllLessonProgress({ userId: userIdOf(req) });
    if ('error_type' in result) return failed(res, result);
    res.json({ ok: true, deleted: result.deleted, epoch: result.epoch });
  });

  return router;
}
