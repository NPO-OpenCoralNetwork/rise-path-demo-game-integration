// @ts-check
/**
 * Admin safety routes (Phase 0.5) — mounted by server.js at /api/v2/admin behind requireAuth and
 * requireAdmin (server/middleware/requireAdmin.js reads user_profiles.role on the server).
 *
 * GET  /safety/summary?days=30            event counts (kind, category, surface, audience; per
 *                                          Japan-time day) and the open report count; no learner text
 * GET  /safety/reports?status=open&limit=50&before=<ISO time>
 *                                          reports, newest first (status open | reviewed | all);
 *                                          text older than 90 days has been cleared (detail null)
 * POST /safety/reports/:id/review          mark a report reviewed (reviewed_by = this admin)
 * GET  /users/:userId/ai-access            a learner's AI access state, policy version and the
 *                                          last 30 days' safety event counts
 * PUT  /users/:userId/age                  { birthYm: 'YYYY-MM', declaredBy: 'guardian'|'staff' }
 * POST /users/:userId/guardian-consent     { relationship: 'parent'|'guardian'|'other' }: a paper
 *                                          form, recorded as method staff_paper_form, recorded_by = admin
 * POST /users/:userId/guardian-consent/revoke
 *
 * Every write is logged with the admin's and the learner's id prefixes only. Reading report text
 * is limited to admins; the list returns it, the summary never does.
 */
import express from 'express';
import { getPool } from '../db.js';
import { isUuid } from '../utils/ids.js';
import {
  AiAccessUnavailableError,
  CONSENT_POLICY_VERSION,
  CONSENT_RELATIONSHIPS,
  invalidateAiAccess,
  recordGuardianConsent,
  resolveAiAccess,
  revokeGuardianConsent,
  setBirthYm,
} from '../safety/access.js';
import { pruneSafetyEvents } from '../safety/events.js';

const router = express.Router();

const MAX_DAYS = 365;
const MAX_LIMIT = 200;

/** @param {unknown} value @param {number} fallback @param {number} max */
const intParam = (value, fallback, max) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
};

const short = (/** @type {unknown} */ id) => String(id ?? '').slice(0, 8);

/** @param {import('express').Response} res */
const noDatabase = (res) => res.status(503).json({ error: 'Database not configured', error_type: 'database_unavailable' });

/** @param {import('express').Response} res @param {unknown} error @param {string} what */
function serverError(res, error, what) {
  if (error instanceof AiAccessUnavailableError) {
    return res.status(503).json({ error: 'AI access cannot be read right now.', error_type: 'ai_access_unavailable' });
  }
  console.error(`[Admin safety] ${what} failed:`, error instanceof Error ? error.message : error);
  return res.status(500).json({ error: 'Internal server error' });
}

/** @param {unknown} value */
const iso = (value) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value));

/** Validates :userId (a UUID); answers 404 otherwise. */
router.param('userId', (req, res, next, value) => {
  if (!isUuid(value)) return res.status(404).json({ error: 'User not found', error_type: 'user_not_found' });
  return next();
});

// --- reports and counts ------------------------------------------------------------------------

router.get('/safety/summary', async (req, res) => {
  const pool = getPool();
  if (!pool) return noDatabase(res);
  const days = intParam(req.query.days, 30, MAX_DAYS);
  try {
    void pruneSafetyEvents(pool);
    const since = [days];
    const [groups, byDay, open] = await Promise.all([
      pool.query(
        `SELECT kind, category, surface, audience, count(*)::int AS n FROM ai_safety_events
         WHERE created_at >= now() - make_interval(days => $1::int)
         GROUP BY kind, category, surface, audience ORDER BY n DESC LIMIT 500`,
        since,
      ),
      pool.query(
        `SELECT to_char(created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS day, kind, count(*)::int AS n
         FROM ai_safety_events WHERE created_at >= now() - make_interval(days => $1::int)
         GROUP BY 1, 2 ORDER BY 1, 2`,
        since,
      ),
      pool.query("SELECT count(*)::int AS n FROM ai_safety_events WHERE kind = 'user_report' AND status = 'open'"),
    ]);
    /** @type {Record<string, number>} */
    const totals = {};
    for (const row of groups.rows ?? []) totals[row.kind] = (totals[row.kind] ?? 0) + Number(row.n ?? 0);
    return res.json({
      days,
      totals,
      groups: (groups.rows ?? []).map((row) => ({
        kind: row.kind, category: row.category ?? null, surface: row.surface, audience: row.audience ?? null, count: Number(row.n ?? 0),
      })),
      byDay: (byDay.rows ?? []).map((row) => ({ day: row.day, kind: row.kind, count: Number(row.n ?? 0) })),
      openReports: Number(open.rows?.[0]?.n ?? 0),
    });
  } catch (error) {
    return serverError(res, error, 'summary');
  }
});

router.get('/safety/reports', async (req, res) => {
  const pool = getPool();
  if (!pool) return noDatabase(res);
  const status = typeof req.query.status === 'string' ? req.query.status : 'open';
  if (!['open', 'reviewed', 'all'].includes(status)) {
    return res.status(400).json({ error: 'status must be open, reviewed or all', error_type: 'invalid_query' });
  }
  const limit = intParam(req.query.limit, 50, MAX_LIMIT);
  const before = typeof req.query.before === 'string' && req.query.before ? new Date(req.query.before) : null;
  if (before && Number.isNaN(before.getTime())) {
    return res.status(400).json({ error: 'before must be an ISO time', error_type: 'invalid_query' });
  }
  /** @type {unknown[]} */
  const params = [limit];
  const where = ["kind = 'user_report'"];
  if (status !== 'all') {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (before) {
    params.push(before.toISOString());
    where.push(`created_at < $${params.length}`);
  }
  try {
    void pruneSafetyEvents(pool);
    const result = await pool.query(
      `SELECT id, created_at, user_id, audience, surface, category, detail, status, reviewed_by, reviewed_at
       FROM ai_safety_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $1`,
      params,
    );
    const reports = (result.rows ?? []).map((row) => {
      const detail = row.detail && typeof row.detail === 'object' ? row.detail : null;
      return {
        id: row.id,
        createdAt: iso(row.created_at),
        userId: row.user_id ?? null,
        audience: row.audience ?? null,
        surface: row.surface,
        reason: row.category ?? detail?.reason ?? null,
        answer: detail?.answer ?? null,
        question: detail?.question ?? null,
        note: detail?.note ?? null,
        context: detail?.context ?? null,
        textCleared: !detail,
        status: row.status,
        reviewedBy: row.reviewed_by ?? null,
        reviewedAt: iso(row.reviewed_at),
      };
    });
    return res.json({ reports });
  } catch (error) {
    return serverError(res, error, 'listing reports');
  }
});

router.post('/safety/reports/:id/review', async (req, res) => {
  const pool = getPool();
  if (!pool) return noDatabase(res);
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ error: 'Report not found', error_type: 'report_not_found' });
  try {
    const result = await pool.query(
      `UPDATE ai_safety_events SET status = 'reviewed', reviewed_by = $2, reviewed_at = now()
       WHERE id = $1 AND kind = 'user_report' RETURNING id, reviewed_at`,
      [id, /** @type {any} */ (req).userId],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Report not found', error_type: 'report_not_found' });
    console.info(`[Admin safety] admin ${short(/** @type {any} */ (req).userId)} reviewed report ${short(id)}`);
    return res.json({ ok: true, id, reviewedAt: iso(result.rows?.[0]?.reviewed_at) });
  } catch (error) {
    return serverError(res, error, 'reviewing a report');
  }
});

// --- a learner's age and consent ---------------------------------------------------------------

/** The learner's fresh access state plus the policy version. @param {string} userId */
async function accessState(userId) {
  invalidateAiAccess(userId);
  const access = await resolveAiAccess(userId);
  return { ...access, policyVersion: CONSENT_POLICY_VERSION };
}

router.get('/users/:userId/ai-access', async (req, res) => {
  const pool = getPool();
  if (!pool) return noDatabase(res);
  const { userId } = req.params;
  try {
    const access = await accessState(userId);
    const events = await pool.query(
      `SELECT kind, count(*)::int AS n FROM ai_safety_events
       WHERE user_id = $1 AND created_at >= now() - interval '30 days' GROUP BY kind`,
      [userId],
    );
    /** @type {Record<string, number>} */
    const recentEvents = {};
    for (const row of events.rows ?? []) recentEvents[row.kind] = Number(row.n ?? 0);
    return res.json({ userId, ...access, recentEvents });
  } catch (error) {
    return serverError(res, error, 'reading AI access');
  }
});

/** Postgres foreign key violation: the user does not exist in auth.users. @param {unknown} error */
const isMissingUser = (error) => /** @type {any} */ (error)?.code === '23503';

router.put('/users/:userId/age', async (req, res) => {
  if (!getPool()) return noDatabase(res);
  const { userId } = req.params;
  const { birthYm, declaredBy } = req.body ?? {};
  if (declaredBy !== 'guardian' && declaredBy !== 'staff') {
    return res.status(400).json({ error: "declaredBy must be 'guardian' or 'staff'", error_type: 'invalid_declared_by' });
  }
  try {
    const result = await setBirthYm({ userId, birthYm, declaredBy });
    if (!result.ok) {
      return res.status(400).json({ error: 'birthYm must be a past year and month as YYYY-MM, from 1900', error_type: result.error_type });
    }
    console.info(`[Admin safety] admin ${short(/** @type {any} */ (req).userId)} recorded the birth month of user ${short(userId)} (declared by ${declaredBy})`);
    return res.json({ ok: true, userId, ...(await accessState(userId)) });
  } catch (error) {
    if (isMissingUser(error)) return res.status(404).json({ error: 'User not found', error_type: 'user_not_found' });
    return serverError(res, error, 'recording a birth month');
  }
});

router.post('/users/:userId/guardian-consent', async (req, res) => {
  if (!getPool()) return noDatabase(res);
  const { userId } = req.params;
  const relationship = req.body?.relationship;
  if (!CONSENT_RELATIONSHIPS.includes(relationship)) {
    return res.status(400).json({ error: "relationship must be 'parent', 'guardian' or 'other'", error_type: 'invalid_relationship' });
  }
  try {
    const before = await accessState(userId);
    if (before.status === 'needs_age') {
      return res.status(400).json({ error: 'Record the learner\'s birth year and month first.', error_type: 'age_required' });
    }
    if (before.audience !== 'minor') {
      return res.status(400).json({ error: 'Guardian consent is only recorded for learners under 18.', error_type: 'not_a_minor' });
    }
    const result = await recordGuardianConsent({ userId, method: 'staff_paper_form', relationship, recordedBy: /** @type {any} */ (req).userId });
    if (!result.ok) return res.status(400).json({ error: 'The consent could not be recorded.', error_type: result.error_type });
    console.info(`[Admin safety] admin ${short(/** @type {any} */ (req).userId)} recorded a paper guardian consent for user ${short(userId)}`);
    return res.status(201).json({ ok: true, userId, ...(await accessState(userId)) });
  } catch (error) {
    if (isMissingUser(error)) return res.status(404).json({ error: 'User not found', error_type: 'user_not_found' });
    return serverError(res, error, 'recording a guardian consent');
  }
});

router.post('/users/:userId/guardian-consent/revoke', async (req, res) => {
  if (!getPool()) return noDatabase(res);
  const { userId } = req.params;
  try {
    const result = await revokeGuardianConsent({ userId });
    console.info(`[Admin safety] admin ${short(/** @type {any} */ (req).userId)} revoked the guardian consent of user ${short(userId)} (${result.revoked} rows)`);
    return res.json({ ok: true, userId, revoked: result.revoked, ...(await accessState(userId)) });
  } catch (error) {
    return serverError(res, error, 'revoking a guardian consent');
  }
});

export default router;
