/**
 * AI Routes — Phase 13-C
 *
 * POST /ai/generate — 3-stage curriculum generation
 *   Stage flow: requirements → roadmap → curriculum
 *
 * Replaces the deprecated LangGraph endpoints.
 */
import express from 'express';
import { getPool } from '../db.js';
import { getKit } from '../../tools/core/curriculum.js';
import {
  getCachedKit,
  generateRequirements,
  generateRoadmap,
  generateCurriculum,
} from '../services/aiGenerator.js';

const router = express.Router();

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

  // Resolve user (dev-fallback)
  const userId = req.user?.id || process.env.PHASE1_USER_ID || '00000000-0000-0000-0000-000000000001';

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

      // Save final curriculum
      await pool.query(
        `UPDATE curricula SET 
           status = 'published', 
           curriculum_data = $1, 
           title = COALESCE($2, title),
           description = $3,
           updated_at = NOW() 
         WHERE id = $4 AND user_id = CAST($5 AS uuid)`,
        [
          JSON.stringify(result.curriculum),
          result.curriculum.title?.jp || result.curriculum.title?.en,
          result.curriculum.description?.jp || result.curriculum.description?.en || '',
          curriculum_id,
          userId,
        ]
      );

      return res.json({
        session_id,
        curriculum_id,
        message: `カリキュラムが完成しました！🎉\n\n**${result.curriculum.title?.jp || result.curriculum.title?.en || '新しいコース'}** がライブラリに追加されました。`,
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

    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// --- GET /ai/drafts — Retrieve in-progress drafts ---
router.get('/drafts', async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error: 'Database not configured' });

  const userId = req.user?.id || process.env.PHASE1_USER_ID || '00000000-0000-0000-0000-000000000001';

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
    return res.status(500).json({ error: err.message });
  }
});

export default router;