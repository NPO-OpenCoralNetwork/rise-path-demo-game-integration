import express from 'express';
import { getPool } from '../db.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import {
    validateDailyPayload,
    validateEntryDate,
    validateWritableEntryDate,
    validateDateRange,
    validateTimezone,
    upsertDailyEntry,
    getDailyEntry,
    getRangeEntries,
} from '../services/lifeJournalService.js';
import { analyzeLifeJournal } from '../services/lifeJournalAnalysisService.js';
import { deriveLifeHabitSignals } from '../services/personalizationDeriver.js';
import { buildWeeklyAdviceFromDays } from '../../tools/core/lifeJournalWeekly.js';
import {
    defaultExportDateRange,
    exportLifeJournalData,
    deleteLifeJournalData,
    validateDeleteLifeJournalBody,
    loadLifeJournalPrivacyPreferences,
} from '../services/lifeJournalPrivacyService.js';

const VALID_GRANULARITIES = ['weekly', 'monthly', 'custom'];

const validateGranularity = (granularity) => {
    const g = typeof granularity === 'string' ? granularity.trim().toLowerCase() : 'custom';
    if (!VALID_GRANULARITIES.includes(g)) {
        return { valid: false, errors: [`granularity must be one of: ${VALID_GRANULARITIES.join(', ')}`] };
    }
    return { valid: true, normalized: g };
};

const router = express.Router();

const respondServerError = (res, label, error) => {
    console.error(`[Life Journal API] ${label}:`, error);
    const body = { error: label };
    if (process.env.NODE_ENV !== 'production') {
        body.detail = error.message;
    }
    res.status(500).json(body);
};

// PUT /api/v2/life-journal/daily/:date
router.put('/life-journal/daily/:date', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const tzCheck = validateTimezone(req.query?.timezone);
    if (!tzCheck.valid) {
        return res.status(422).json({ error: 'Invalid timezone', details: tzCheck.errors });
    }

    const dateCheck = validateWritableEntryDate(req.params.date, tzCheck.normalized);
    if (!dateCheck.valid) {
        return res.status(422).json({ error: 'Invalid date', details: dateCheck.errors });
    }

    const payloadCheck = validateDailyPayload({
        reflection: req.body?.reflection,
        lifestyle: req.body?.lifestyle,
    });
    if (!payloadCheck.valid) {
        return res.status(422).json({ error: 'Invalid life journal entry', details: payloadCheck.errors });
    }

    try {
        const saved = await upsertDailyEntry({
            pool,
            userId: req.userId,
            entryDate: dateCheck.normalized,
            reflection: req.body?.reflection,
            lifestyle: req.body?.lifestyle,
            timezone: tzCheck.normalized,
        });
        res.json({ ok: true, date: dateCheck.normalized, entry: saved });
    } catch (error) {
        respondServerError(res, 'Failed to save life journal entry', error);
    }
});

// GET /api/v2/life-journal/daily/:date
router.get('/life-journal/daily/:date', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const dateCheck = validateEntryDate(req.params.date);
    if (!dateCheck.valid) {
        return res.status(422).json({ error: 'Invalid date', details: dateCheck.errors });
    }

    const tzCheck = validateTimezone(req.query?.timezone);
    if (!tzCheck.valid) {
        return res.status(422).json({ error: 'Invalid timezone', details: tzCheck.errors });
    }

    try {
        const entry = await getDailyEntry({
            pool,
            userId: req.userId,
            entryDate: dateCheck.normalized,
            timezone: tzCheck.normalized,
        });
        res.json({ ok: true, ...entry });
    } catch (error) {
        respondServerError(res, 'Failed to fetch life journal entry', error);
    }
});

// GET /api/v2/life-journal/range?from=&to=&timezone=
router.get('/life-journal/range', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const rangeCheck = validateDateRange(req.query?.from, req.query?.to);
    if (!rangeCheck.valid) {
        return res.status(422).json({ error: 'Invalid date range', details: rangeCheck.errors });
    }

    const tzCheck = validateTimezone(req.query?.timezone);
    if (!tzCheck.valid) {
        return res.status(422).json({ error: 'Invalid timezone', details: tzCheck.errors });
    }

    try {
        const range = await getRangeEntries({
            pool,
            userId: req.userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        res.json({ ok: true, ...range });
    } catch (error) {
        respondServerError(res, 'Failed to fetch life journal range', error);
    }
});

// GET /api/v2/life-journal/analysis?from=&to=&timezone=&granularity=
router.get('/life-journal/analysis', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const rangeCheck = validateDateRange(req.query?.from, req.query?.to);
    if (!rangeCheck.valid) {
        return res.status(422).json({ error: 'Invalid date range', details: rangeCheck.errors });
    }

    const tzCheck = validateTimezone(req.query?.timezone);
    if (!tzCheck.valid) {
        return res.status(422).json({ error: 'Invalid timezone', details: tzCheck.errors });
    }

    const granCheck = validateGranularity(req.query?.granularity);
    if (!granCheck.valid) {
        return res.status(422).json({ error: 'Invalid granularity', details: granCheck.errors });
    }

    try {
        const range = await getRangeEntries({
            pool,
            userId: req.userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        const analysis = analyzeLifeJournal(range.days, {
            from: rangeCheck.from,
            to: rangeCheck.to,
            granularity: granCheck.normalized,
        });
        const habitSignals = deriveLifeHabitSignals(analysis.metrics);
        res.json({
            ...analysis,
            advice: habitSignals.advice,
            life_signals: habitSignals.signals,
        });
    } catch (error) {
        respondServerError(res, 'Failed to analyze life journal', error);
    }
});

// GET /api/v2/life-journal/privacy
router.get('/life-journal/privacy', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    try {
        const privacy = await loadLifeJournalPrivacyPreferences(pool, req.userId);
        res.json({ ok: true, privacy });
    } catch (error) {
        respondServerError(res, 'Failed to load life journal privacy settings', error);
    }
});

// GET /api/v2/life-journal/export?from=&to=&timezone=
router.get('/life-journal/export', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const tzCheck = validateTimezone(req.query?.timezone);
    if (!tzCheck.valid) {
        return res.status(422).json({ error: 'Invalid timezone', details: tzCheck.errors });
    }

    const defaults = defaultExportDateRange(tzCheck.normalized);
    const from = req.query?.from || defaults.from;
    const to = req.query?.to || defaults.to;
    const rangeCheck = validateDateRange(from, to);
    if (!rangeCheck.valid) {
        return res.status(422).json({ error: 'Invalid date range', details: rangeCheck.errors });
    }

    try {
        const payload = await exportLifeJournalData({
            pool,
            userId: req.userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        res.json(payload);
    } catch (error) {
        respondServerError(res, 'Failed to export life journal data', error);
    }
});

// DELETE /api/v2/life-journal/data
router.delete('/life-journal/data', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const validation = validateDeleteLifeJournalBody(req.body);
    if (!validation.valid) {
        return res.status(422).json({ error: 'Invalid delete request', details: validation.errors });
    }

    const { scope, from, to } = validation.parsed;

    try {
        const result = await deleteLifeJournalData({
            pool,
            userId: req.userId,
            scope,
            from,
            to,
        });
        res.json(result);
    } catch (error) {
        respondServerError(res, 'Failed to delete life journal data', error);
    }
});

// POST /api/v2/life-journal/advice?timezone=
router.post('/life-journal/advice', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const rangeCheck = validateDateRange(req.body?.from, req.body?.to);
    if (!rangeCheck.valid) {
        return res.status(422).json({ error: 'Invalid date range', details: rangeCheck.errors });
    }

    const tzCheck = validateTimezone(req.query?.timezone);
    if (!tzCheck.valid) {
        return res.status(422).json({ error: 'Invalid timezone', details: tzCheck.errors });
    }

    try {
        const range = await getRangeEntries({
            pool,
            userId: req.userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        const weekly = buildWeeklyAdviceFromDays(range.days, {
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        res.json(weekly);
    } catch (error) {
        respondServerError(res, 'Failed to fetch life journal advice', error);
    }
});

export default router;