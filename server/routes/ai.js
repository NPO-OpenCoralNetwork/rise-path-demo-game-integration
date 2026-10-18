/**
 * AI Routes — Phase 13-C
 *
 * POST /ai/generate — 3-stage curriculum generation
 *   Stage flow: requirements → roadmap → curriculum
 *
 * Replaces the deprecated LangGraph endpoints.
 *
 * Auth: server.js mounts requireAuth on /ai/generate and /ai/drafts, so req.userId is the
 * authenticated user (or the dev fallback user outside strict mode).
 * TODO(P1): move generation onto server/llm (gateway + per-lesson structured calls, PLAN §6.3).
 */
import express from 'express';
import { getPool } from '../db.js';
import { getKit, writeCurriculumVersion } from '../../tools/core/curriculum.js';
import {
  getCachedKit,
  generateRequirements,
  generateRoadmap,
  generateCurriculum,
} from '../services/aiGenerator.js';

const router = express.Router();

/** curricula.ui_template_id column default (server/migrations/001_core_curriculum.sql). */
const DEFAULT_UI_TEMPLATE_ID = 'vibe_coding';

const countLessons = (curriculum) =>
  (Array.isArray(curriculum?.modules) ? curriculum.modules : [])
    .reduce((sum, m) => sum + (Array.isArray(m?.lessons) ? m.lessons.length : 0), 0);

/**
 * Store a generated curriculum as the next draft version and point the curriculum at it.
 * Uses the shared writer (tools/core/curriculum.js writeCurriculumVersion), so content lands in
 * curriculum_versions.content_json, which the reader loads via current_version_id.
 * `curricula.curriculum_data` does not exist.
 * Status 'draft' (not 'draft_<stage>') keeps it out of the in-progress list below.
 *
 * @param {import('pg').Pool} pool
 * @param {{ curriculumId: string, userId: string, curriculum: any, intake?: any, modules?: any }} params
 * @returns {Promise<string>} the new curriculum_versions.id
 */
export async function saveDraftVersion(pool, { curriculumId, userId, curriculum, intake, modules }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query(
      'SELECT id, title, ui_template_id FROM curricula WHERE id = CAST($1 AS uuid) AND user_id = CAST($2 AS uuid) FOR UPDATE',
      [curriculumId, userId]
    );
    if (!owned.rowCount) throw new Error('Draft not found');
    const existing = owned.rows[0] || {};

    const saved = await writeCurriculumVersion(client, {
      curriculumId,
      userId,
      title: curriculum.title?.jp || curriculum.title?.en || existing.title || null,
      description: curriculum.description?.jp || curriculum.description?.en || '',
      uiTemplateId: existing.ui_template_id || DEFAULT_UI_TEMPLATE_ID,
      content: curriculum,
      requirements: intake ?? null,
      roadmap: modules ?? null,
      totalLessons: countLessons(curriculum),
    });
    await client.query(
      `UPDATE curricula SET status = 'draft', updated_at = NOW()
       WHERE id = CAST($1 AS uuid) AND user_id = CAST($2 AS uuid)`,
      [curriculumId, userId]
    );
    await client.query('COMMIT');
    return saved.curriculumVersionId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Daily generation limit ---
const DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '5', 10);

async function checkDailyLimit(pool, userId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM curricula 
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day' 
     AND status != 'error'`,
    [userId]
  );
  return result.rows[0].cnt;
}

// --- POST /ai/generate ---
router.post('/generate', async (req, res) => {
  // Set request timeout
  req.setTimeout(60000);

  const pool = getPool();
  if (!pool) return res.status(503).json({ error: 'Database not configured' });

  const { message, session_id, curriculum_id, stage, decision, attachments } = req.body;

  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    // --- Cost limit check ---
    const dailyCount = await checkDailyLimit(pool, userId);
    if (dailyCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `日次生成上限（${DAILY_LIMIT}回）に達しました`,
        daily_count: dailyCount,
        limit: DAILY_LIMIT,
      });
    }

    // --- Get Kit (cached) ---
    const kit = await getCachedKit(userId, getKit);

    // --- Stage Router ---

    // STAGE: requirements (initial message or revise)
    if (!decision && (!stage || stage === 'requirements')) {
      if (!message) return res.status(400).json({ error: 'message is required for requirements stage' });

      const result = await generateRequirements(message, userId, kit);
      const title = result.intake?.goal || message.slice(0, 100);

      let draftId = curriculum_id;

      if (curriculum_id) {
        // Update existing draft (avoid duplicate inserts)
        await pool.query(
          `UPDATE curricula SET title = $1, intake_json = $2, updated_at = NOW()
           WHERE id = $3 AND user_id = CAST($4 AS uuid)`,
          [title, JSON.stringify(result.intake), curriculum_id, userId]
        );
      } else {
        // Create new draft
        const draftRes = await pool.query(
          `INSERT INTO curricula (user_id, title, status, intake_json, created_at, updated_at)
           VALUES (CAST($1 AS uuid), $2, 'draft_requirements', $3, NOW(), NOW())
           RETURNING id`,
          [userId, title, JSON.stringify(result.intake)]
        );
        draftId = draftRes.rows[0].id;
      }

      return res.json({
        session_id: session_id || draftId,
        curriculum_id: draftId,
        message: result.message,
        pending_approval: 'requirements',
        status: 'pending',
        agent_logs: [
          { agent: 'kit', message: 'プロファイル注入完了', status: 'success' },
          { agent: 'analyzer', message: '入力内容の分析完了', status: 'success' },
          { agent: 'interviewer', message: '要件ドラフトを生成しました', status: 'success' },
        ],
      });
    }

    // STAGE: requirements → approved → generate roadmap
    if (decision === 'approved' && stage === 'requirements') {
      // Fetch intake from draft (with ownership check)
      const draft = await pool.query(
        'SELECT intake_json FROM curricula WHERE id = $1 AND user_id = CAST($2 AS uuid)',
        [curriculum_id, userId]
      );
      if (!draft.rows[0]) return res.status(404).json({ error: 'Draft not found' });

      const intake = draft.rows[0].intake_json;
      const result = await generateRoadmap(intake, userId, kit);

      // Update draft
      await pool.query(
        `UPDATE curricula SET status = 'draft_roadmap', modules_json = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = CAST($3 AS uuid)`,
        [JSON.stringify(result.modules), curriculum_id, userId]
      );

      return res.json({
        session_id,
        curriculum_id,
        message: result.message,
        pending_approval: 'roadmap',
        status: 'pending',
        agent_logs: [
          { agent: 'orchestrator', message: '要件が承認されました', status: 'success' },
          { agent: 'architect', message: 'ロードマップを設計しました', status: 'success' },
        ],
      });
    }

    // STAGE: roadmap → approved → generate full curriculum
    if (decision === 'approved' && stage === 'roadmap') {
      const draft = await pool.query(
        'SELECT intake_json, modules_json FROM curricula WHERE id = $1 AND user_id = CAST($2 AS uuid)',
        [curriculum_id, userId]
      );
      if (!draft.rows[0]) return res.status(404).json({ error: 'Draft not found' });

      const { intake_json: intake, modules_json: modules } = draft.rows[0];
      const result = await generateCurriculum(intake, modules, userId, kit);

      if (!result.curriculum) {
        return res.status(422).json({ error: '生成に失敗しました。再試行してください' });
      }

      // Save as a draft version (see saveDraftVersion). Generated content is never published
      // automatically; a person publishes it after review.
      await saveDraftVersion(pool, {
        curriculumId: curriculum_id,
        userId,
        curriculum: result.curriculum,
        intake,
        modules,
      });

      return res.json({
        session_id,
        curriculum_id,
        message: `カリキュラムが完成しました！🎉\n\n**${result.curriculum.title?.jp || result.curriculum.title?.en || '新しいコース'}** を下書きとしてライブラリに保存しました。`,
        pending_approval: 'none',
        status: 'approved',
        agent_logs: [
          { agent: 'orchestrator', message: 'ロードマップが承認されました', status: 'success' },
          { agent: 'writer', message: 'コンテンツを生成しています...', status: 'success' },
          { agent: 'quality', message: '品質チェック完了', status: 'success' },
          { agent: 'saver', message: 'カリキュラムを保存しました', status: 'success' },
        ],
      });
    }

    // STAGE: curriculum → approved (final, already saved above)
    if (decision === 'approved' && stage === 'curriculum') {
      return res.json({
        session_id,
        curriculum_id,
        message: 'カリキュラムは既に確定済みです。ライブラリからアクセスしてください。',
        pending_approval: 'none',
        status: 'approved',
      });
    }

    // DECISION: revise
    if (decision === 'revise') {
      if (!message) return res.status(400).json({ error: 'Revision feedback is required' });

      // Re-generate the current stage with the feedback
      if (stage === 'requirements') {
        const result = await generateRequirements(message, userId, kit);
        if (curriculum_id) {
          await pool.query(
            `UPDATE curricula SET intake_json = $1, updated_at = NOW()
             WHERE id = $2 AND user_id = CAST($3 AS uuid)`,
            [JSON.stringify(result.intake), curriculum_id, userId]
          );
        }
        return res.json({
          session_id, curriculum_id,
          message: result.message,
          pending_approval: 'requirements',
          status: 'revised',
          agent_logs: [
            { agent: 'orchestrator', message: `修正リクエスト受信: ${stage}`, status: 'success' },
            { agent: 'interviewer', message: 'フィードバックに基づき再構成中...', status: 'success' },
          ],
        });
      }

      if (stage === 'roadmap') {
        const draft = await pool.query(
          'SELECT intake_json FROM curricula WHERE id = $1 AND user_id = CAST($2 AS uuid)',
          [curriculum_id, userId]
        );
        if (!draft.rows[0]) return res.status(404).json({ error: 'Draft not found' });
        const intake = draft.rows[0].intake_json;
        // Append feedback to intake for re-generation
        const modifiedIntake = { ...intake, revision_feedback: message };
        const result = await generateRoadmap(modifiedIntake, userId, kit);
        if (curriculum_id) {
          await pool.query(
            `UPDATE curricula SET modules_json = $1, updated_at = NOW()
             WHERE id = $2 AND user_id = CAST($3 AS uuid)`,
            [JSON.stringify(result.modules), curriculum_id, userId]
          );
        }
        return res.json({
          session_id, curriculum_id,
          message: result.message,
          pending_approval: 'roadmap',
          status: 'revised',
          agent_logs: [
            { agent: 'orchestrator', message: `修正リクエスト受信: ${stage}`, status: 'success' },
            { agent: 'architect', message: 'ロードマップを再設計しました', status: 'success' },
          ],
        });
      }

      return res.status(400).json({ error: `Cannot revise stage: ${stage}` });
    }

    return res.status(400).json({ error: 'Invalid request parameters' });

  } catch (err) {
    console.error('[AI Generate] Error:', err);

    // Gemini-specific errors
    if (err.message?.includes('API key') || err.message?.includes('GEMINI')) {
      return res.status(503).json({ error: 'AI service is temporarily unavailable' });
    }
    if (err.message?.includes('timeout') || err.code === 'ECONNRESET') {
      return res.status(504).json({ error: '生成がタイムアウトしました。再試行してください' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- GET /ai/drafts — Retrieve in-progress drafts ---
router.get('/drafts', async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error: 'Database not configured' });

  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    const result = await pool.query(
      `SELECT id, title, status, intake_json, modules_json, updated_at
       FROM curricula 
       WHERE user_id = CAST($1 AS uuid) AND status LIKE 'draft_%'
       ORDER BY updated_at DESC
       LIMIT 5`,
      [userId]
    );
    return res.json({ drafts: result.rows });
  } catch (err) {
    console.error('[AI Drafts] Error:', err);
    return res.status(500).json({ error: 'Failed to load drafts' });
  }
});

export default router;