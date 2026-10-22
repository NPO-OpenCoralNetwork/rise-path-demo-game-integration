/**
 * LLM routes — /api/v2/llm/* (PLAN §6, WP-08)
 *
 * GET  /llm/status              provider/task configuration, no secrets
 * POST /llm/writing-feedback    { text, rubric, lessonTitle?, goal?, locale } → WritingFeedback
 * POST /llm/personality-insight { scores, locale } → PersonalityInsight
 * POST /llm/tutor               AskTutorDetail (PLAN §9.1) → SSE: meta, text.delta…, done | error
 *
 * Mounted in server.js before the blanket /api/v2 auth middlewares, with optionalAuth, so
 * guests can use it in strict mode; the AI rate limiter, the guest daily budget
 * (server/llm/guestAccess.js) and the signed-in daily cap (server/middleware/dailyCaps.js, kind
 * 'llm') apply to the POST routes only. Each POST runs: AI limiter → body validation (and the
 * guest lesson check) → guest budget → user daily cap → handler, so rejected requests never use
 * a daily quota; a call that fails before any model ran is refunded. Anonymous tutor calls must
 * come from a lesson (lesson + anchor) and get a shorter history and answer.
 */
import express from 'express';
import { getGateway } from '../llm/index.js';
import { toClientError } from '../llm/errors.js';
import {
  PersonalityInsight,
  PersonalityInsightRequest,
  TutorRequest,
  WritingFeedback,
  WritingFeedbackRequest,
  formatIssues,
  resolveTutorMode,
} from '../llm/schemas.js';
import { buildWritingFeedbackPrompt } from '../llm/prompts/writingFeedback.js';
import { buildPersonalityInsightPrompt } from '../llm/prompts/personalityInsight.js';
import { buildTutorPrompt } from '../llm/prompts/tutor.js';
import { GUEST_TUTOR_LIMITS, refundGuestBudget } from '../llm/guestAccess.js';
import { refundDailyCap } from '../middleware/dailyCaps.js';

const HEARTBEAT_MS = 15000;

/** Validate req.body; on failure answer 400 with field-level issues and return null. */
function parseBody(schema, req, res) {
  const parsed = schema.safeParse(req.body ?? {});
  if (parsed.success) return parsed.data;
  res.status(400).json({ error: 'Invalid request body', error_type: 'invalid_body', issues: formatIssues(parsed.error) });
  return null;
}

/** Middleware: validate req.body into res.locals.body (400 with issues on failure). */
const validateBody = (schema) => (req, res, next) => {
  const body = parseBody(schema, req, res);
  if (!body) return;
  res.locals.body = body;
  next();
};

/** Middleware: anonymous tutor calls must come from a lesson (lesson + anchor). */
function requireLessonForGuests(req, res, next) {
  const body = res.locals.body;
  if (!req.userId && (!body.lesson || !body.anchor)) {
    res.status(400).json({
      error: 'Guests can ask the tutor from inside a lesson only (lesson and anchor are required).',
      error_type: 'lesson_required',
    });
    return;
  }
  next();
}

/** Abort the upstream model call when the client goes away before we finish. */
function abortOnDisconnect(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller;
}

function sendError(res, error) {
  const { status, body } = toClientError(error);
  if (status >= 500 || status === 422) console.warn(`[LLM Route] ${body.error_type}:`, error?.message);
  res.status(status).json(body);
}

const writeSse = (res, type, data) => {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
};

/**
 * @param {{
 *   limiter?: import('express').RequestHandler,
 *   guestBudget?: import('express').RequestHandler,
 *   userCap?: import('express').RequestHandler,
 * }} [options]  userCap: the signed-in daily cap (dailyCap('llm')); guests pass it uncounted
 */
export function createLlmRouter(options = {}) {
  const router = express.Router();
  /** The AI limiter counts every POST; the guest budget and user cap only those that passed `checks`. */
  const guarded = (...checks) => [options.limiter, ...checks, options.guestBudget, options.userCap].filter(Boolean);

  router.get('/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getGateway().status());
  });

  router.post('/writing-feedback', ...guarded(validateBody(WritingFeedbackRequest)), async (req, res) => {
    const body = res.locals.body;
    const controller = abortOnDisconnect(res);
    try {
      const result = await getGateway().generate({
        task: 'writing.feedback',
        userId: req.userId ?? null,
        schema: WritingFeedback,
        locale: body.locale,
        signal: controller.signal,
        ...buildWritingFeedbackPrompt(body),
      });
      res.json({ ok: true, data: result.data, meta: { provider: result.provider, model: result.model } });
    } catch (error) {
      refundGuestBudget(res, error);
      refundDailyCap(res, error);
      if (!res.headersSent) sendError(res, error);
    }
  });

  router.post('/personality-insight', ...guarded(validateBody(PersonalityInsightRequest)), async (req, res) => {
    const body = res.locals.body;
    const controller = abortOnDisconnect(res);
    try {
      const result = await getGateway().generate({
        task: 'assessment.insight',
        userId: req.userId ?? null,
        schema: PersonalityInsight,
        locale: body.locale,
        signal: controller.signal,
        ...buildPersonalityInsightPrompt(body),
      });
      res.json({ ok: true, data: result.data, meta: { provider: result.provider, model: result.model } });
    } catch (error) {
      refundGuestBudget(res, error);
      refundDailyCap(res, error);
      if (!res.headersSent) sendError(res, error);
    }
  });

  router.post('/tutor', ...guarded(validateBody(TutorRequest), requireLessonForGuests), async (req, res) => {
    const body = res.locals.body;
    const guest = !req.userId;
    if (guest && body.history) {
      body.history = body.history
        .slice(-GUEST_TUTOR_LIMITS.historyTurns)
        .map((turn) => ({ ...turn, content: turn.content.slice(0, GUEST_TUTOR_LIMITS.historyChars) }));
    }
    const mode = resolveTutorMode(body);
    const locale = body.locale ?? 'ja';
    const controller = abortOnDisconnect(res);

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    const grounding = body.anchor ? { sectionId: body.anchor.sectionId, blockId: body.anchor.blockId } : null;
    writeSse(res, 'meta', { mode, locale, grounding });

    let sentText = false;
    try {
      const prompt = buildTutorPrompt(body, { mode, locale });
      const events = getGateway().stream({
        task: 'tutor.chat',
        userId: req.userId ?? null,
        locale,
        signal: controller.signal,
        ...prompt,
        // Guests: the answer is kept short by an extra system line and low effort; maxTokens
        // only caps the call and leaves room for thinking (it counts against the cap).
        ...(guest
          ? {
            override: { maxTokens: GUEST_TUTOR_LIMITS.maxTokens, effort: GUEST_TUTOR_LIMITS.effort },
            system: [...prompt.system, { text: GUEST_TUTOR_LIMITS.answerRule }],
          }
          : {}),
      });
      for await (const event of events) {
        if (controller.signal.aborted) break;
        if (event.type === 'text.delta') {
          sentText = true;
          writeSse(res, 'text.delta', { text: event.text });
        } else if (event.type === 'done') {
          // truncated: the reply hit the output limit after the text the learner already has.
          const { provider, model, text, usage, truncated } = event.result;
          writeSse(res, 'done', { mode, grounding, provider, model, text, usage, ...(truncated ? { truncated: true } : {}) });
        } else if (event.type === 'error') {
          if (!sentText) {
            refundGuestBudget(res, event.error);
            refundDailyCap(res, event.error);
          }
          const { body: errorBody } = toClientError(event.error);
          if (event.error?.code !== 'aborted') console.warn('[LLM Route] tutor stream error:', event.error?.code, event.error?.message);
          writeSse(res, 'error', errorBody);
        }
      }
    } catch (error) {
      if (!sentText) {
        refundGuestBudget(res, error);
        refundDailyCap(res, error);
      }
      writeSse(res, 'error', toClientError(error).body);
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  return router;
}

export default createLlmRouter();
