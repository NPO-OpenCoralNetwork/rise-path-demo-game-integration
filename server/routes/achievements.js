// @ts-check
/**
 * The learner's XP, level, streak and badges (Phase 5, doc/brushup-2026/ai-access-plan.ja.md §9;
 * owner decisions O1-O3). Mounted by server.js at /api/v2/user/achievements behind requireAuth,
 * requireSignedIn (the dev fallback, the bridge user and an anonymous user get 401
 * sign_in_required: the ledger is a permanent account record, never shared by dev guests) and a
 * per-learner limit (ACHIEVEMENTS_READS_PER_MINUTE, 429 rate_limited). An agent's own OAuth token
 * gets 401 oauth_client_token from requireAuth: AI apps see no XP, days or badges.
 *
 * GET / → 200 { ok, learnerId,
 *               xp: { total, level, intoLevel, levelSize, toNextLevel },
 *               counts: { lessonsStarted, lessonsDone, stagesDone },
 *               streak: { current, best, activeToday, today, timeZone: 'Asia/Tokyo' },
 *               badges: [{ id, earned, current, goal, course? }] }
 *        XP is earned once per learned item from the server's own records (lesson start 10, lesson
 *        done 40, Blender stage done 80); diagnosis, course generation and learning events earn
 *        nothing. The read reconciles the ledger first, so it also counts what an AI app's writes
 *        earned. Logic and SQL: tools/core/achievements.js (getAchievements, summarizeAchievements).
 *        learnerId lets the browser drop an answer that arrived after another learner signed in.
 *
 * Refusals are { ok: false, error, error_type } with fixed English text, never the driver's:
 * 503 achievements_unavailable without a database, when it is down, or before migration 019;
 * 500 achievements_failed otherwise (also right after an account deletion: the next request is
 * 401 account_deleted). 401 and 429 come from server.js's middleware, in their own shape.
 * Tables: server/migrations/019_phase5_learning.sql.
 */
import express from 'express';
import { getAchievements } from '../../tools/core/achievements.js';

/** Reads per learner per minute (each reconciles the learner's ledger). */
export const ACHIEVEMENTS_READS_PER_MINUTE = 30;

/** Core error types that mean "the database cannot serve this now" (503, try again later). */
const UNAVAILABLE = new Set(['db_connection', 'table_not_found', 'permission_denied']);

/** @param {import('express').Request} req */
const userIdOf = (req) => /** @type {string} */ (/** @type {any} */ (req).userId);

export function createAchievementsRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const result = await getAchievements({ userId: userIdOf(req) });
        if ('error_type' in result) {
            if (UNAVAILABLE.has(result.error_type)) {
                return res.status(503).json({ ok: false, error: 'XP and badges are unavailable right now. Please try again later.', error_type: 'achievements_unavailable' });
            }
            return res.status(500).json({ ok: false, error: 'XP and badges could not be read.', error_type: 'achievements_failed' });
        }
        return res.json({ ok: true, ...result });
    });

    return router;
}
