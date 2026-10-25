// @ts-check
/**
 * The learner's lesson progress (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6): the
 * risepath.lesson/v1 reader's records, synced across the learner's signed-in devices. Mounted by
 * server.js at /api/v2/user/lesson-progress behind requireAuth (so an agent's own OAuth token gets
 * 401 oauth_client_token; agents use the MCP course-* tools), with its own 256 kb JSON body limit
 * and a per-user limit on writes. Not gated by AI access: progress is not an AI feature, so
 * minors keep it.
 *
 * GET    /  → { ok, epoch, records: [{ courseSlug, lessonId, progress, pct, state, updatedAt }] }
 *             epoch: the learner's reset epoch (null until the first DELETE). pct and state are
 *             the server's, against the published lesson. restarted: true (only then present)
 *             when the epoch was written by re-opening a deleted account (Phase 4): a device that
 *             knew another epoch clears its learning events too.
 * PUT    /  body { epoch: string | null, records: [{ courseSlug, lessonId, progress }] } (1–25)
 *          → { ok, epoch, records, rejected: [{ courseSlug, lessonId, error_type }] }
 *             Each record is sanitized and merged into the stored one (never stored as sent); the
 *             merged records come back. A lesson that is not published (or an id that breaks the
 *             one id rule) is rejected 'unknown_lesson' for that record only; a record whose merge
 *             would pass 64 KiB 'too_large'.
 *             409 { error_type: 'progress_reset', epoch } when `epoch` is not the current one: the
 *             learner deleted their progress since this device loaded it. Nothing is saved.
 *             400 { error_type: 'validation' } for a malformed body.
 * DELETE /  → { ok, deleted, epoch }: every lesson record of the learner (all courses, quiz answers
 *             included) and a new epoch. The streak and learning events (/user/events) and the
 *             legacy user_progress rows stay.
 *
 * 503 { error_type: 'lesson_progress_unavailable' } without a database (or when it is down);
 * other database failures 500 { error_type: 'lesson_progress_failed' }. Never the driver's text.
 * Logic and SQL: tools/core/lessonProgress.js. Table: server/migrations/016_lesson_progress.sql.
 */
import express from 'express';
import { getPool } from '../db.js';
import { isUuid } from '../utils/ids.js';
import {
  SAVE_BATCH_MAX,
  deleteAllLessonProgress,
  getLessonProgress,
  saveLessonProgress,
} from '../../tools/core/lessonProgress.js';

/** Largest PUT body (25 records; the client keeps its batches well under this). */
export const LESSON_PROGRESS_BODY_LIMIT = '256kb';

/** Writes (PUT and DELETE) per learner per minute. The client saves at most once per 20 s per tab. */
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
  error: 'Lesson progress is unavailable right now. Please try again later.',
  error_type: 'lesson_progress_unavailable',
});

/** @param {import('express').Response} res @param {string} message */
const badRequest = (res, message) => res.status(400).json({ error: message, error_type: 'validation' });

/**
 * Answers a core error ({ error, error_type }) without its text when it came from the database.
 * @param {import('express').Response} res
 * @param {{ error_type: string }} result
 */
function failed(res, result) {
  if (UNAVAILABLE.has(result.error_type)) return unavailable(res);
  return res.status(500).json({ error: 'Lesson progress could not be saved or read.', error_type: 'lesson_progress_failed' });
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
    return res.status(413).json({ error: `The request body is larger than ${LESSON_PROGRESS_BODY_LIMIT}. Send fewer records at once.`, error_type: 'body_too_large' });
  }
  if (status === 400) return badRequest(res, 'The request body is not valid JSON.');
  return next(err);
}

/**
 * @param {{ writeLimiter?: import('express').RequestHandler }} [options]
 *   writeLimiter: runs before PUT and DELETE (server.js passes a per-user rate limiter)
 */
export function createLessonProgressRouter({ writeLimiter } = {}) {
  const router = express.Router();
  /** @type {import('express').RequestHandler} */
  const limitWrites = writeLimiter ?? ((req, res, next) => next());

  router.get('/', async (req, res) => {
    if (!getPool()) return unavailable(res);
    const result = await getLessonProgress({ userId: userIdOf(req), withEpoch: true });
    if ('error_type' in result) return failed(res, result);
    res.json({ ok: true, epoch: result.epoch ?? null, ...(result.restarted === true ? { restarted: true } : {}), records: result.records });
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
  });

  router.delete('/', limitWrites, async (req, res) => {
    if (!getPool()) return unavailable(res);
    const result = await deleteAllLessonProgress({ userId: userIdOf(req) });
    if ('error_type' in result) return failed(res, result);
    res.json({ ok: true, deleted: result.deleted, epoch: result.epoch });
  });

  return router;
}
