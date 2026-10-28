import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPool } from '../db.js';
import {
    deepMergePreferences,
    isSpeakerVoicesUpdateForbidden,
    normalizeProfileRow,
    validateTtsPreferencesPatch,
    validatePrivacyPreferencesPatch,
} from '../services/userPreferences.js';
import { isUuid } from '../utils/ids.js';
import { canonicalUserId } from '../../tools/core/accountDeletions.js';
import { classifyDbError } from '../../tools/core/dbErrors.js';
import { noteBlenderProgress } from '../../tools/core/achievements.js';
import { parseLearningEventInput } from '../../tools/core/learningEvents.js';

/**
 * Largest POST /events body (Phase 5): a type and two short texts. server.js registers this
 * mount's own parser before the 50 MB one (server/middleware/smallBody.js: 413 body_too_large).
 * The parser counts the bytes before the texts are cut, so the limit covers every body whose texts
 * fit what is kept: 4 texts × LEARNING_EVENT_TEXT_MAX (300) code points × at most 6 bytes each in
 * JSON.stringify's output (a \u escape; an emoji is 4) plus the keys ≈ 7.3 KB.
 */
export const LEARNING_EVENTS_BODY_LIMIT = '8kb';
/** History events a learner may add per minute (POST /events). */
export const LEARNING_EVENTS_PER_MINUTE = 30;

/** Core error types that mean "the database cannot serve this now" (503, try again later). */
const DB_UNAVAILABLE = new Set(['db_connection', 'table_not_found', 'permission_denied']);

/**
 * Learning history errors (Phase 5): { error, error_type }, never the database's text.
 * @param {import('express').Response} res
 * @param {unknown} error a driver error, or null without a database
 * @param {string} operation
 * @param {string} failedText the fixed 500 text
 */
function eventsFailed(res, error, operation, failedText) {
    const type = error ? classifyDbError(/** @type {any} */ (error), operation).error_type : 'db_connection';
    if (DB_UNAVAILABLE.has(type)) {
        return res.status(503).json({ error: 'The learning history is unavailable right now. Please try again later.', error_type: 'learning_events_unavailable' });
    }
    return res.status(500).json({ error: failedText, error_type: 'learning_events_failed' });
}

/**
 * Runs after a legacy Blender progress PUT was answered (Phase 5): the stage XP and the learning
 * day (tools/core/achievements.js noteBlenderProgress). Tests replace it.
 * @type {(params: { userId: string }) => unknown}
 */
let afterBlenderProgress = noteBlenderProgress;

/**
 * Tests: the hook the Blender progress PUT calls after its answer (null: the default).
 * @param {((params: { userId: string }) => unknown) | null} hook
 */
export function setBlenderProgressHookForTests(hook) {
    afterBlenderProgress = hook ?? noteBlenderProgress;
}

const router = express.Router();

// req.userId is set by server/middleware/auth.js (Phase 7)
// Previously used x-user-id header — now uses Supabase JWT via requireAuth middleware

// ==================== PROFILE ====================

// GET /api/v2/user/profile
router.get('/profile', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    try {
        const result = await pool.query(
            'SELECT display_name, avatar_url, role, created_at, preferences FROM user_profiles WHERE user_id = $1',
            [req.userId]
        );
        if (result.rowCount === 0) {
            // Auto-create profile on first access
            const insert = await pool.query(
                `INSERT INTO user_profiles (user_id, display_name, preferences)
                 VALUES ($1, 'Learner', '{}'::jsonb)
                 ON CONFLICT (user_id) DO NOTHING
                 RETURNING display_name, avatar_url, role, created_at, preferences`,
                [req.userId]
            );
            const profile = normalizeProfileRow(
                insert.rows[0] || { display_name: 'Learner', avatar_url: '', role: 'learner', preferences: {} },
            );
            return res.json({ ok: true, profile });
        }
        res.json({ ok: true, profile: normalizeProfileRow(result.rows[0]) });
    } catch (e) {
        console.error('[User API] Profile GET error:', e.message);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

// PUT /api/v2/user/profile
router.put('/profile', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const body = req.body ?? {};
    const { display_name, avatar_url, preferences: preferencesPatch } = body;

    if (preferencesPatch !== undefined
        && (preferencesPatch === null || typeof preferencesPatch !== 'object' || Array.isArray(preferencesPatch))) {
        return res.status(400).json({ error: 'preferences must be an object' });
    }

    if (preferencesPatch?.tts !== undefined) {
        const ttsError = validateTtsPreferencesPatch(preferencesPatch.tts);
        if (ttsError) {
            return res.status(400).json({ error: ttsError.error, fields: ttsError.fields });
        }
    }

    if (preferencesPatch?.privacy !== undefined) {
        const privacyError = validatePrivacyPreferencesPatch(preferencesPatch.privacy);
        if (privacyError) {
            return res.status(400).json({ error: privacyError.error, fields: privacyError.fields });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query(
            `SELECT display_name, avatar_url, role, created_at, preferences
             FROM user_profiles WHERE user_id = $1 FOR UPDATE`,
            [req.userId],
        );

        const row = current.rows[0];
        const userRole = row?.role ?? 'learner';
        const existingPreferences = row?.preferences && typeof row.preferences === 'object'
            ? row.preferences
            : {};

        if (isSpeakerVoicesUpdateForbidden(userRole, existingPreferences, preferencesPatch)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Only admins can update dialogue speaker mapping' });
        }

        const nextDisplayName = display_name !== undefined
            ? (String(display_name).trim() || 'Learner')
            : (row?.display_name ?? 'Learner');
        const nextAvatar = avatar_url !== undefined
            ? (avatar_url ?? '')
            : (row?.avatar_url ?? '');
        const nextPreferences = preferencesPatch !== undefined
            ? deepMergePreferences(existingPreferences, preferencesPatch)
            : existingPreferences;

        const saved = await client.query(
            `INSERT INTO user_profiles (user_id, display_name, avatar_url, preferences)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (user_id) DO UPDATE SET
               display_name = EXCLUDED.display_name,
               avatar_url = EXCLUDED.avatar_url,
               preferences = EXCLUDED.preferences
             RETURNING display_name, avatar_url, role, created_at, preferences`,
            [req.userId, nextDisplayName, nextAvatar, JSON.stringify(nextPreferences)],
        );

        await client.query('COMMIT');
        res.json({
            ok: true,
            profile: normalizeProfileRow(saved.rows[0]),
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[User API] Profile PUT error:', e.message);
        res.status(500).json({ error: 'Failed to update profile' });
    } finally {
        client.release();
    }
});

// ==================== PROGRESS ====================

// GET /api/v2/user/progress
router.get('/progress', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    try {
        const result = await pool.query(
            'SELECT course_id, completed_stages, completed_steps FROM user_progress WHERE user_id = $1',
            [req.userId]
        );
        const progress = {};
        for (const row of result.rows) {
            progress[row.course_id] = {
                completedStages: row.completed_stages || [],
                completedSteps: row.completed_steps || {},
            };
        }
        res.json({ ok: true, progress });
    } catch (e) {
        console.error('[User API] Progress GET error:', e.message);
        res.status(500).json({ error: 'Failed to load progress' });
    }
});

// PUT /api/v2/user/progress/:courseId — the legacy Blender course's progress (the SQL is pinned by
// server/tests/lessonProgressRoutes.test.js). For course 'blender', after the answer, the stage XP
// and the learning day (Phase 5; only stages 1-4 earn, tools/core/achievements.js).
router.put('/progress/:courseId', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    const { courseId } = req.params;
    const { completedStages, completedSteps } = req.body;
    try {
        await pool.query(
            `INSERT INTO user_progress (user_id, course_id, completed_stages, completed_steps)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, course_id) DO UPDATE SET
               completed_stages = $3,
               completed_steps = $4`,
            [req.userId, courseId, completedStages || [], JSON.stringify(completedSteps || {})]
        );
        res.json({ ok: true });
        if (courseId === 'blender') {
            try {
                Promise.resolve(afterBlenderProgress({ userId: req.userId })).catch(() => {});
            } catch {
                // The hook logs its own failures; the PUT is already answered.
            }
        }
    } catch (e) {
        console.error('[User API] Progress PUT error:', e.message);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// ==================== LEARNING EVENTS ====================
// GET and POST /api/v2/user/events: the learning history (ProfileHistoryView), served by
// createLearningEventsRouter below, which server.js mounts at /api/v2/user/events (behind
// requireAuth, with its 8 kb parser) above this router: one router and one limiter per app.

// ==================== NOTIFICATIONS ====================

// GET /api/v2/user/notifications
router.get('/notifications', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    try {
        const result = await pool.query(
            `SELECT id, type, title, body, read, created_at
             FROM notifications WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 30`,
            [req.userId]
        );
        res.json({ ok: true, notifications: result.rows });
    } catch (e) {
        console.error('[User API] Notifications GET error:', e.message);
        res.status(500).json({ error: 'Failed to load notifications' });
    }
});

// POST /api/v2/user/notifications
router.post('/notifications', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    const { type, title, body } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    try {
        const result = await pool.query(
            `INSERT INTO notifications (user_id, type, title, body)
             VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
            [req.userId, type, JSON.stringify(title || {}), JSON.stringify(body || {})]
        );
        res.json({ ok: true, notification: result.rows[0] });
    } catch (e) {
        console.error('[User API] Notifications POST error:', e.message);
        res.status(500).json({ error: 'Failed to add notification' });
    }
});

// PUT /api/v2/user/notifications/:id/read — notifications.id is a uuid: any other id (the app's
// local `n_…` notifications, services/notificationService.ts) names no row and gets 404 unsent.
router.put('/notifications/:id/read', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Notification not found' });
    try {
        await pool.query(
            'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2',
            [req.params.id, req.userId]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error('[User API] Notification mark read error:', e.message);
        res.status(500).json({ error: 'Failed to mark read' });
    }
});

// PUT /api/v2/user/notifications/read-all
router.put('/notifications/read-all', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    try {
        await pool.query(
            'UPDATE notifications SET read = TRUE WHERE user_id = $1',
            [req.userId]
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to mark all read' });
    }
});

export default router;

/**
 * The learning history: GET and POST /api/v2/user/events (mounted by server.js behind requireAuth,
 * after this mount's 8 kb JSON parser, above the /api/v2/user router). Phase 5: history only — it
 * earns no XP and adds no learning day (tools/core/learningEvents.js). POST takes { type, title,
 * description } (type: one of the six of the table, else 400 validation; title and description:
 * only their string en/jp, cut to 300 characters), at most LEARNING_EVENTS_PER_MINUTE per learner
 * (429 rate_limited). Answers are unchanged ({ ok, event: { id, timestamp } } and { ok, events }, the
 * newest 50); errors carry error_type: 503 learning_events_unavailable, 500 learning_events_failed,
 * never the database's text (413 body_too_large and 400 invalid_body come from the parser).
 * One limiter per call (per app), like the account and legal routers.
 */
export function createLearningEventsRouter() {
    const events = express.Router();
    const limitLearningEvents = rateLimit({
        windowMs: 60 * 1000,
        limit: LEARNING_EVENTS_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `learning-events:${canonicalUserId(req.userId) ?? req.userId}`,
        message: { error: 'Too many history events. Please try again in a minute.', error_type: 'rate_limited' },
        validate: { keyGeneratorIpFallback: false },
    });

    // GET /api/v2/user/events
    events.get('/', async (req, res) => {
        const pool = getPool();
        if (!pool) return eventsFailed(res, null, 'getLearningEvents', 'Failed to load events');
        try {
            const result = await pool.query(
                `SELECT id, type, title, description, created_at as timestamp
                 FROM learning_events WHERE user_id = $1
                 ORDER BY created_at DESC LIMIT 50`,
                [req.userId]
            );
            res.json({ ok: true, events: result.rows });
        } catch (e) {
            return eventsFailed(res, e, 'getLearningEvents', 'Failed to load events');
        }
    });

    // POST /api/v2/user/events
    events.post('/', limitLearningEvents, async (req, res) => {
        const parsed = parseLearningEventInput(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error, error_type: 'validation' });
        const pool = getPool();
        if (!pool) return eventsFailed(res, null, 'addLearningEvent', 'Failed to add event');
        const { type, title, description } = parsed.event;
        try {
            const result = await pool.query(
                `INSERT INTO learning_events (user_id, type, title, description)
                 VALUES ($1, $2, $3, $4) RETURNING id, created_at as timestamp`,
                [req.userId, type, JSON.stringify(title), JSON.stringify(description)]
            );
            res.json({ ok: true, event: result.rows[0] });
        } catch (e) {
            return eventsFailed(res, e, 'addLearningEvent', 'Failed to add event');
        }
    });

    return events;
}
