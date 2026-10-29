// @ts-check
/**
 * Reports on AI answers (Phase 0.5) — mounted by server.js at /api/v2/safety behind requireAuth.
 *
 * POST /reports  { surface, reason, answer, question?, note?, context? } → 201 { ok: true }
 *   surface  'tutor'|'writing_feedback'|'assessment_insight'|'course_generation'|'generated_lesson'|'other'
 *   reason   'harmful'|'wrong'|'inappropriate_for_age'|'other'
 *   answer   the AI text being reported (≤ 4000; answers have no server id, so the client sends it)
 *   question ≤ 2000, note ≤ 500, context { courseId, lessonId, blockId } (each ≤ 200)
 *
 * Any signed-in user can report (adults and minors alike). At most REPORTS_PER_DAY (20) per user
 * per Japan-time day: 429 error_type 'report_limit'. The report is an ai_safety_events row of kind
 * 'user_report' (server/safety/events.js): its text is kept 90 days, then cleared; the operators
 * get an alert without the text. 400 invalid_body for a bad body; 503 reports_unavailable when the
 * report cannot be stored in production.
 */
import express from 'express';
import * as z from 'zod/v4';
import { getPool } from '../db.js';
import { formatIssues } from '../llm/schemas.js';
import { resolveAiAccess } from '../safety/access.js';
import { countSafetyEventsToday, recordSafetyEvent } from '../safety/events.js';

export const REPORT_SURFACES = /** @type {const} */ (['tutor', 'writing_feedback', 'assessment_insight', 'course_generation', 'generated_lesson', 'other']);
export const REPORT_REASONS = /** @type {const} */ (['harmful', 'wrong', 'inappropriate_for_age', 'other']);
export const REPORTS_PER_DAY = 20;

const ContextId = z.string().trim().max(200).optional();

export const ReportRequest = z.object({
  surface: z.enum(REPORT_SURFACES),
  reason: z.enum(REPORT_REASONS),
  answer: z.string().trim().min(1).max(4000),
  question: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(500).optional(),
  context: z.object({ courseId: ContextId, lessonId: ContextId, blockId: ContextId }).optional(),
});

/** Reports counted per user in this process when there is no database (development only). */
const memoryCounts = new Map();
let memoryDay = '';

/** @param {string} userId @param {number} nowMs */
function countInMemory(userId, nowMs) {
  const day = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (day !== memoryDay) {
    memoryCounts.clear();
    memoryDay = day;
  }
  return memoryCounts.get(userId) ?? 0;
}

export function resetSafetyRoutesForTests() {
  memoryCounts.clear();
  memoryDay = '';
}

/** The reporter's audience, for triage (minors' reports first); null when unknown. @param {string} userId */
async function audienceOf(userId) {
  try {
    const access = await resolveAiAccess(userId);
    return access.audience ?? null;
  } catch {
    return null;
  }
}

const router = express.Router();

router.post('/reports', async (req, res) => {
  const userId = /** @type {any} */ (req).userId;
  if (!userId) return res.status(401).json({ error: 'Authentication required', error_type: 'sign_in_required' });

  const parsed = ReportRequest.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', error_type: 'invalid_body', issues: formatIssues(parsed.error) });
  }
  const { surface, reason, answer, question, note, context } = parsed.data;
  const pool = getPool();
  const production = process.env.NODE_ENV === 'production';
  if (!pool && production) {
    return res.status(503).json({ error: 'Reports cannot be saved right now. Please try again later.', error_type: 'reports_unavailable' });
  }

  let used;
  try {
    used = pool ? await countSafetyEventsToday(String(userId), 'user_report', pool) : countInMemory(String(userId), Date.now());
  } catch (error) {
    console.warn('[AI safety] counting reports failed:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Reports cannot be saved right now. Please try again later.', error_type: 'reports_unavailable' });
  }
  if (used >= REPORTS_PER_DAY) {
    return res.status(429).json({ error: 'You have sent many reports today. Thank you. You can send more after 00:00 Japan time (JST).', error_type: 'report_limit' });
  }

  const detail = {
    reason,
    answer,
    ...(question ? { question } : {}),
    ...(note ? { note } : {}),
    ...(context ? { context } : {}),
  };
  const written = await recordSafetyEvent({
    kind: 'user_report',
    surface,
    category: reason,
    userId: String(userId),
    ip: req.ip ?? null,
    audience: await audienceOf(String(userId)),
    detail,
  });
  if (pool && !written) {
    return res.status(503).json({ error: 'Reports cannot be saved right now. Please try again later.', error_type: 'reports_unavailable' });
  }
  if (!pool) memoryCounts.set(String(userId), used + 1);
  return res.status(201).json({ ok: true });
});

export default router;
