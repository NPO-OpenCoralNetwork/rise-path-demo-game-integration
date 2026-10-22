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
 *
 * Model: each stage is one LLM gateway call, task 'course.generate' (server/services/aiGenerator.js;
 * the cheap Claude tier by default, server/llm/models.config.js).
 *
 * Cost: every /ai/generate call that can run a model stage takes one 'course_generation' unit of
 * the daily caps (server/middleware/dailyCaps.js; one course is at least 3 calls). Approving the
 * final 'curriculum' stage runs no model and is free. Before the unit is taken, the body is
 * checked (message a string of at most MESSAGE_MAX_CHARS, curriculum_id a UUID: 400 invalid_body)
 * and a gateway that cannot serve the task (no provider, and no mock fallback in production)
 * answers 503 ai_unavailable, so neither is charged. After it, the 400 and 404 answers that every
 * stage sends before calling the model give it back. A gateway failure (LlmError,
 * server/llm/errors.js) gives it back when no model ran (modelMayHaveRun: no provider, provider
 * unreachable or overloaded, our key rejected, rate limited) and keeps it when a model may have
 * produced output (timeouts, refusals, cut-off or invalid replies, a cancelled request). Any other
 * error (the database, say) keeps it too. A refund never depends on the wording of an error message.
 */
import express from 'express';
import { getPool } from '../db.js';
import { getKit, writeCurriculumVersion } from '../../tools/core/curriculum.js';
import {
  adaptCurriculumDraftForSave,
  resolveCurriculumUiTemplate,
} from '../services/chatgptCurriculumAdapter.js';
import {
  getCachedKit,
  generateRequirements,
  generateRoadmap,
  generateCurriculum,
  isCourseGenerationAvailable,
} from '../services/aiGenerator.js';
import { reserveDailyCap } from '../middleware/dailyCaps.js';
import { isLlmError, modelMayHaveRun, toClientError } from '../llm/errors.js';
import { isUuid } from '../utils/ids.js';

const router = express.Router();

/** The reader template the generation prompt (aiPrompts.js buildCurriculumPrompt) targets. */
const GENERATED_TEMPLATE_ID = 'doc_chapter';

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asArray = (value) => (Array.isArray(value) ? value : []);

const countLessons = (curriculum) =>
  asArray(curriculum?.modules).reduce((sum, m) => sum + asArray(m?.lessons).length, 0);

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/** Locale keys the model uses for localized text; `ja` is accepted as an alias of `jp`. */
const JP_KEYS = ['jp', 'ja'];

/**
 * `{ jp, en }` as the model writes localized text: a flat object of strings with a non-empty
 * `jp`, `ja` or `en`. Extra locale keys (`ko`, …) are allowed; objects holding non-string
 * values (sections, blocks) are not text.
 */
const isLocalizedText = (value) => {
  const record = asObject(value);
  const values = Object.values(record);
  return values.length > 0
    && values.every((item) => item == null || typeof item === 'string')
    && Boolean([...JP_KEYS, 'en'].some((key) => trimmed(record[key])));
};

const jpOf = (value) => JP_KEYS.map((key) => trimmed(value[key])).find(Boolean) || '';

/** Plain text from a string or `{ jp, en }`, Japanese first; '' when there is none. */
const pickText = (value) => {
  if (typeof value === 'string') return value.trim();
  return isLocalizedText(value) ? jpOf(value) || trimmed(value.en) : '';
};

const toLocalized = (value) => ({
  jp: jpOf(value) || trimmed(value.en),
  en: trimmed(value.en) || jpOf(value),
});

/** Replace every `{ jp, en }` with its plain text, for the adapter, which reads strings only. */
const flattenLocalized = (value) => {
  if (Array.isArray(value)) return value.map(flattenLocalized);
  if (!value || typeof value !== 'object') return value;
  if (isLocalizedText(value)) return pickText(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flattenLocalized(item)]));
};

/**
 * The first source field (in the adapter's own order) that has text, as `{ jp, en }` when the
 * model wrote it localized; undefined when that field is plain text or none has text, so the
 * adapter's value stands.
 */
const localizedFrom = (source, keys) => {
  const key = keys.find((k) => pickText(source[k]));
  return key && isLocalizedText(source[key]) ? toLocalized(source[key]) : undefined;
};

/** Fields the reader (services/curriculumAdapter.ts) reads that the adapter does not rebuild. */
const PASSTHROUGH_KEYS = ['quiz', 'nexloom', 'worlds', 'integration', 'metadata'];
const passthrough = (source) => Object.fromEntries(
  PASSTHROUGH_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])
);

/** The model's own sections, each with an id unique within the lesson. */
const withUniqueSectionIds = (sections) => {
  const seen = new Set();
  return sections.map((section, index) => {
    const base = trimmed(section.id) || `section-${index + 1}`;
    let id = base;
    for (let n = 2; seen.has(id); n += 1) id = `${base}-${n}`;
    seen.add(id);
    return { ...section, id };
  });
};

const defined = (entries) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

/**
 * Turn generateCurriculum output into the reader's doc_chapter content_json, through the same
 * adapter as the ChatGPT and MCP draft saves (adaptCurriculumDraftForSave): module_id,
 * lesson_id, sections built from the lesson fields, curriculum_id and ui_template_id.
 * The model writes `{ jp, en }` text and often whole `sections`; the adapter reads plain strings
 * and rebuilds sections, so it gets a flattened copy, and the bilingual text, the model's own
 * sections and the fields the reader reads as-is (quiz, nexloom, worlds, integration,
 * metadata) are put back over its output.
 */
export function adaptGeneratedCurriculum({ curriculum, curriculumId, title, description, learningMode = null }) {
  const source = asObject(curriculum);
  const adapted = adaptCurriculumDraftForSave({
    curriculum: flattenLocalized(source),
    curriculumId,
    templateId: GENERATED_TEMPLATE_ID,
    title,
    description,
    learningMode,
    explanationStyle: null,
  });
  const sourceModules = asArray(source.modules);

  return {
    ...passthrough(source),
    ...adapted,
    ...defined({
      title: localizedFrom(source, ['title']),
      description: localizedFrom(source, ['summary', 'description']),
    }),
    modules: adapted.modules.map((module, mi) => {
      const sourceModule = asObject(sourceModules[mi]);
      const sourceLessons = asArray(sourceModule.lessons);
      return {
        ...module,
        ...defined({
          title: localizedFrom(sourceModule, ['title']),
          objective: localizedFrom(sourceModule, ['goal', 'objective']),
        }),
        lessons: module.lessons.map((lesson, li) => {
          const sourceLesson = asObject(sourceLessons[li]);
          const sections = asArray(sourceLesson.sections).filter((s) => s && typeof s === 'object');
          return {
            ...passthrough(sourceLesson),
            ...lesson,
            ...defined({
              title: localizedFrom(sourceLesson, ['title']),
              // The adapter derives subtitle from summary → objective → description.
              subtitle: localizedFrom(sourceLesson, pickText(sourceLesson.subtitle)
                ? ['subtitle']
                : ['summary', 'objective', 'description']),
            }),
            ...(sections.length > 0 && { sections: withUniqueSectionIds(sections) }),
          };
        }),
      };
    }),
  };
}

/**
 * Store a generated curriculum as the next draft version and point the curriculum at it.
 * Uses the shared writer (tools/core/curriculum.js writeCurriculumVersion), so content lands in
 * curriculum_versions.content_json, which the reader loads via current_version_id.
 * `curricula.curriculum_data` does not exist.
 * Status 'draft' (not 'draft_<stage>') keeps it out of the in-progress list below.
 *
 * @param {import('pg').Pool} pool
 * @param {{ curriculumId: string, userId: string, curriculum: any, intake?: any, modules?: any, learningMode?: string }} params
 * @returns {Promise<string>} the new curriculum_versions.id
 */
export async function saveDraftVersion(pool, { curriculumId, userId, curriculum, intake, modules, learningMode }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query(
      'SELECT id, title, description FROM curricula WHERE id = CAST($1 AS uuid) AND user_id = CAST($2 AS uuid) FOR UPDATE',
      [curriculumId, userId]
    );
    if (!owned.rowCount) throw new Error('Draft not found');
    const existing = owned.rows[0] || {};

    // The model writes description as a string or { jp, en }; keep the stored one when it has none.
    const title = pickText(curriculum?.title) || existing.title || null;
    const description = pickText(curriculum?.description) || pickText(curriculum?.summary) || existing.description || null;
    const content = {
      ...adaptGeneratedCurriculum({ curriculum, curriculumId, title, description, learningMode }),
      _meta: {
        source: 'ai_generate',
        template_id: GENERATED_TEMPLATE_ID,
        learning_mode: learningMode || null,
        saved_at: new Date().toISOString(),
        source_curriculum: curriculum,
      },
    };

    const saved = await writeCurriculumVersion(client, {
      curriculumId,
      userId,
      title,
      description,
      uiTemplateId: resolveCurriculumUiTemplate(GENERATED_TEMPLATE_ID),
      content,
      requirements: intake ?? null,
      roadmap: modules ?? null,
      totalLessons: countLessons(content),
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

// --- POST /ai/generate ---

/** Longest topic or revision feedback a learner can send (the composer limits it too). */
export const MESSAGE_MAX_CHARS = 4000;

/**
 * Checks that need no database or model, run before the daily cap is charged. Returns the error
 * text for a 400 invalid_body, or null.
 * @param {Record<string, unknown>} body
 */
export function invalidGenerateBody(body) {
  const { message, curriculum_id: curriculumId } = body;
  if (message != null && typeof message !== 'string') return 'message must be a string';
  if (typeof message === 'string' && message.length > MESSAGE_MAX_CHARS) {
    return `message must be at most ${MESSAGE_MAX_CHARS} characters`;
  }
  if (curriculumId != null && curriculumId !== '' && !isUuid(curriculumId)) {
    return 'curriculum_id must be a UUID';
  }
  return null;
}

/**
 * Whether the daily cap unit goes back for an error thrown while a stage ran: only for a gateway
 * error raised before any model ran. Errors that are not LlmError (database, adapter) keep it.
 * @param {unknown} error
 */
export const refundsCourseGeneration = (error) => isLlmError(error) && !modelMayHaveRun(error);

/**
 * The response for an error thrown while a stage ran: gateway errors by code
 * (errors.js toClientError; 'no_provider' answers 503 ai_unavailable like the check before the
 * cap), anything else 500. Never echoes a provider or database message.
 * @param {unknown} error
 * @returns {{ status: number, body: { error: string, error_type?: string } }}
 */
export function courseGenerationError(error) {
  if (!isLlmError(error)) return { status: 500, body: { error: 'Internal server error' } };
  if (error.code === 'no_provider') {
    return { status: 503, body: { error: 'AI service is temporarily unavailable', error_type: 'ai_unavailable' } };
  }
  return toClientError(error);
}

router.post('/generate', async (req, res) => {
  // Set request timeout
  req.setTimeout(60000);
  // The model call is not cancelled when the client goes away (the composer gives up after 60 s):
  // the stage finishes and saves the draft, so a charged unit is not thrown away.

  const pool = getPool();
  if (!pool) return res.status(503).json({ error: 'Database not configured' });

  const body = asObject(req.body);
  const { message, session_id, curriculum_id, stage, decision, attachments } = body;

  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const invalid = invalidGenerateBody(body);
  if (invalid) return res.status(400).json({ error: invalid, error_type: 'invalid_body' });

  // Approving the saved curriculum runs no model: it needs no key and is never charged.
  const runsModel = !(decision === 'approved' && stage === 'curriculum');
  if (runsModel && !isCourseGenerationAvailable()) {
    return res.status(503).json({ error: 'AI service is temporarily unavailable', error_type: 'ai_unavailable' });
  }

  /** @type {{ refund: () => Promise<void> } | null} */
  let cap = null;
  try {
    // --- Daily cap (429 daily_limit_reached when used up). Every 400 and 404 below is sent
    // before the model runs, so those give the unit back, as does a gateway error raised before
    // any model ran (below).
    if (runsModel) {
      cap = await reserveDailyCap(req, res, 'course_generation', { refundOnStatus: [400, 404] });
      if (!cap) return;
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
        learningMode: kit?.learning_mode,
      });

      return res.json({
        session_id,
        curriculum_id,
        message: `カリキュラムが完成しました！🎉\n\n**${pickText(result.curriculum.title) || '新しいコース'}** を下書きとしてライブラリに保存しました。`,
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
    // The gateway logs provider details; the client gets a fixed answer by code.
    console.error('[AI Generate] Error:', isLlmError(err) ? `${err.code} (${err.provider ?? 'no provider'})` : err);

    // Each request runs one stage, and each stage makes one gateway call. A gateway error raised
    // before any model ran (no provider, provider unreachable or overloaded, our key rejected,
    // rate limited) means nothing was generated, so the unit goes back. Decided by code.
    if (refundsCourseGeneration(err)) void cap?.refund();

    const { status, body: errorBody } = courseGenerationError(err);
    if (res.headersSent) return;
    return res.status(status).json(errorBody);
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