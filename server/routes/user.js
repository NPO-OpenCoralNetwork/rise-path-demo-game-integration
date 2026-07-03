import express from 'express';
import { getPool } from '../db.js';
import {
    deepMergePreferences,
    isSpeakerVoicesUpdateForbidden,
    normalizeProfileRow,
    validateTtsPreferencesPatch,
    validatePrivacyPreferencesPatch,
} from '../services/userPreferences.js';

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

// PUT /api/v2/user/progress/:courseId
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
    } catch (e) {
        console.error('[User API] Progress PUT error:', e.message);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// ==================== LEARNING EVENTS ====================

// GET /api/v2/user/events
router.get('/events', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    try {
        const result = await pool.query(
            `SELECT id, type, title, description, created_at as timestamp
             FROM learning_events WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 50`,
            [req.userId]
        );
        res.json({ ok: true, events: result.rows });
    } catch (e) {
        console.error('[User API] Events GET error:', e.message);
        res.status(500).json({ error: 'Failed to load events' });
    }
});

// POST /api/v2/user/events
router.post('/events', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    const { type, title, description } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    try {
        const result = await pool.query(
            `INSERT INTO learning_events (user_id, type, title, description)
             VALUES ($1, $2, $3, $4) RETURNING id, created_at as timestamp`,
            [req.userId, type, JSON.stringify(title || {}), JSON.stringify(description || {})]
        );
        res.json({ ok: true, event: result.rows[0] });
    } catch (e) {
        console.error('[User API] Events POST error:', e.message);
        res.status(500).json({ error: 'Failed to add event' });
    }
});

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

// PUT /api/v2/user/notifications/:id/read
router.put('/notifications/:id/read', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    try {
        await pool.query(
            'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2',
            [req.params.id, req.userId]
        );
        res.json({ ok: true });
    } catch (e) {
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
