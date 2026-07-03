import express from 'express';
import { getPool } from '../db.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import {
    getAiMemoryPrivacySettings,
    updateAiMemoryPrivacySettings,
    listLearnerMemoriesForApi,
    rememberLearnerMemoryForApi,
    deleteLearnerMemoryForApi,
    purgeAllLearnerMemoriesForApi,
    validatePurgeLearnerMemoryBody,
    mapBridgeResultToHttpStatus,
} from '../services/learnerMemoryApiService.js';

const router = express.Router();

const respondServerError = (res, label, error) => {
    console.error(`[Learner Memory API] ${label}:`, error);
    res.status(500).json({ error: label, detail: error?.message });
};

const sendBridgeResult = (res, result) => {
    if (result?.error_type) {
        const status = mapBridgeResultToHttpStatus(result);
        return res.status(status).json({
            error: result.error,
            error_type: result.error_type,
            details: result.details,
        });
    }
    return res.json(result);
};

router.use(requireBridgeOrAuth);

// GET /api/v2/learner-memory/privacy
router.get('/learner-memory/privacy', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    try {
        const result = await getAiMemoryPrivacySettings(pool, req.userId);
        res.json(result);
    } catch (error) {
        respondServerError(res, 'Failed to load AI memory privacy settings', error);
    }
});

// PUT /api/v2/learner-memory/privacy
router.put('/learner-memory/privacy', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    try {
        const result = await updateAiMemoryPrivacySettings(pool, req.userId, req.body ?? {});
        if (result.error_type) {
            return sendBridgeResult(res, result);
        }
        res.json(result);
    } catch (error) {
        respondServerError(res, 'Failed to update AI memory privacy settings', error);
    }
});

// GET /api/v2/learner-memory
router.get('/learner-memory', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    try {
        const result = await listLearnerMemoriesForApi({
            pool,
            userId: req.userId,
            limit: req.query?.limit,
        });
        if (result.error_type) {
            return sendBridgeResult(res, result);
        }
        res.json(result);
    } catch (error) {
        respondServerError(res, 'Failed to list learner memories', error);
    }
});

// POST /api/v2/learner-memory
router.post('/learner-memory', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    try {
        const result = await rememberLearnerMemoryForApi({
            pool,
            userId: req.userId,
            body: req.body ?? {},
        });
        return sendBridgeResult(res, result);
    } catch (error) {
        respondServerError(res, 'Failed to save learner memory', error);
    }
});

// DELETE /api/v2/learner-memory (purge all)
router.delete('/learner-memory', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const validation = validatePurgeLearnerMemoryBody(req.body);
    if (!validation.valid) {
        return res.status(422).json({ error: 'Invalid purge request', details: validation.errors });
    }

    try {
        const result = await purgeAllLearnerMemoriesForApi({ pool, userId: req.userId });
        return sendBridgeResult(res, result);
    } catch (error) {
        respondServerError(res, 'Failed to purge learner memories', error);
    }
});

// DELETE /api/v2/learner-memory/:memoryId
router.delete('/learner-memory/:memoryId', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const memoryId = String(req.params.memoryId || '').trim();
    if (!memoryId) {
        return res.status(422).json({ error: 'memoryId is required' });
    }

    try {
        const result = await deleteLearnerMemoryForApi({
            pool,
            userId: req.userId,
            memoryId,
        });
        return sendBridgeResult(res, result);
    } catch (error) {
        respondServerError(res, 'Failed to delete learner memory', error);
    }
});

export default router;