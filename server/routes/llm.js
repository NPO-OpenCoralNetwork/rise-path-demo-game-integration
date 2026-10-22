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
 * guest lesson check) → daily cap (counts signed-in users; refuses everyone while the feature is
 * turned off) → guest budget → handler, so rejected requests never use a daily quota; a call that
 * fails before any model ran is refunded. Anonymous tutor calls must come from a lesson (lesson +
 * anchor) and get a shorter history and answer.
 *
 * Minor safeguards (Phase 0.5): the AI access gate (option `aiAccess`, server/middleware/
 * aiAccessGate.js) runs after the body checks and before the caps, so a refused call is never
 * charged; it sets res.locals.aiAudience. For a minor ('minor'):
 * - the gateway call carries audience 'minor' (the MINOR_SAFETY system part);
 * - every client-sent text is screened first (server/safety/moderation.js): a block answers 422
 *   content_blocked { category, support }, a failed check 503 safety_check_unavailable, and the
 *   daily unit (and guest budget) goes back, since no model answered;
 * - the answer is screened before the learner sees it. Writing feedback and the insight are
 *   checked before res.json; the tutor answer is buffered (meta and heartbeats still flow), then
 *   sent as one text.delta and done, or as the 'error' SSE event with the same body as the 422
 *   or 503. After the main model ran the unit stays charged.
 * Adults are not screened. GET /status stays public and ungated.
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
import {
  isSafetyError,
  outputParts,
  safetyErrorResponse,
  screenForMinor,
  tutorInputParts,
  writingInputParts,
} from '../safety/moderation.js';

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

/** The audience the access gate decided; 'adult' when no gate ran (tests, guests with LLM_GUEST_AI). */
const audienceOf = (res) => (res.locals?.aiAudience === 'minor' ? 'minor' : 'adult');

/** Give the daily unit and the guest budget back: nothing was answered. */
function refundUnanswered(res) {
  void res.locals?.refundDailyCap?.();
  res.locals?.refundGuestBudget?.();
}

/**
 * Screen a minor's request texts before the model runs. Returns false (after answering 422 or
 * 503 and refunding) when the request stops here.
 */
async function screenMinorInput(req, res, surface, parts, signal) {
  if (audienceOf(res) !== 'minor') return true;
  try {
    await screenForMinor({ direction: 'input', surface, parts, userId: req.userId ?? null, ip: req.ip, signal });
    return true;
  } catch (error) {
    // A classifier block keeps the unit: the classifier ran and cost money, and a refund would let
    // one account make classifier calls without limit (a pre-filter block or a failed check is free).
    if (!(isSafetyError(error) && error.classifierRan)) refundUnanswered(res);
    if (res.headersSent) return false;
    if (isSafetyError(error)) {
      const { status, body } = safetyErrorResponse(error);
      res.status(status).json(body);
    } else {
      sendError(res, error);
    }
    return false;
  }
}

/**
 * Screen a minor's answer before it is returned. Returns false (after answering 422 or 503) when
 * it is held back. The daily unit stays charged: the main model already ran.
 */
async function screenMinorOutput(req, res, surface, data, signal) {
  if (audienceOf(res) !== 'minor') return true;
  try {
    await screenForMinor({ direction: 'output', surface, parts: outputParts(data, 'answer'), userId: req.userId ?? null, ip: req.ip, signal });
    return true;
  } catch (error) {
    if (res.headersSent) return false;
    if (isSafetyError(error)) {
      const { status, body } = safetyErrorResponse(error);
      res.status(status).json(body);
    } else {
      sendError(res, error);
    }
    return false;
  }
}

/**
 * @param {{
 *   limiter?: import('express').RequestHandler,
 *   guestBudget?: import('express').RequestHandler,
 *   userCap?: import('express').RequestHandler,
 *   aiAccess?: import('express').RequestHandler,
 * }} [options]  userCap: the daily cap (dailyCap('llm')); guests pass it uncounted unless the
 *   feature is turned off. aiAccess: the AI access gate (aiAccessGate()), before the caps.
 */
export function createLlmRouter(options = {}) {
  const router = express.Router();
  /**
   * The AI limiter counts every POST; the user cap and guest budget only those that passed
   * `checks`. The cap runs first so a feature turned off (scope 'off') does not use guest budget.
   */
  const guarded = (...checks) => [options.limiter, ...checks, options.aiAccess, options.userCap, options.guestBudget].filter(Boolean);

  router.get('/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getGateway().status());
  });

  router.post('/writing-feedback', ...guarded(validateBody(WritingFeedbackRequest)), async (req, res) => {
    const body = res.locals.body;
    const audience = audienceOf(res);
    const controller = abortOnDisconnect(res);
    if (!(await screenMinorInput(req, res, 'writing_feedback', writingInputParts(body), controller.signal))) return;
    let result;
    try {
      result = await getGateway().generate({
        task: 'writing.feedback',
        userId: req.userId ?? null,
        audience,
        schema: WritingFeedback,
        locale: body.locale,
        signal: controller.signal,
        ...buildWritingFeedbackPrompt(body),
      });
    } catch (error) {
      refundGuestBudget(res, error);
      refundDailyCap(res, error);
      if (!res.headersSent) sendError(res, error);
      return;
    }
    if (!(await screenMinorOutput(req, res, 'writing_feedback', result.data, controller.signal))) return;
    res.json({ ok: true, data: result.data, meta: { provider: result.provider, model: result.model } });
  });

  // The request holds trait scores only (numbers), so there is no learner text to screen; a
  // minor's insight is still checked before it is returned (the client stores and re-shows it).
  router.post('/personality-insight', ...guarded(validateBody(PersonalityInsightRequest)), async (req, res) => {
    const body = res.locals.body;
    const audience = audienceOf(res);
    const controller = abortOnDisconnect(res);
    let result;
    try {
      result = await getGateway().generate({
        task: 'assessment.insight',
        userId: req.userId ?? null,
        audience,
        schema: PersonalityInsight,
        locale: body.locale,
        signal: controller.signal,
        ...buildPersonalityInsightPrompt(body),
      });
    } catch (error) {
      refundGuestBudget(res, error);
      refundDailyCap(res, error);
      if (!res.headersSent) sendError(res, error);
      return;
    }
    if (!(await screenMinorOutput(req, res, 'assessment_insight', result.data, controller.signal))) return;
    res.json({ ok: true, data: result.data, meta: { provider: result.provider, model: result.model } });
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
    const audience = audienceOf(res);
    const minor = audience === 'minor';
    const controller = abortOnDisconnect(res);
    // A blocked input is answered as plain JSON before the stream opens.
    if (!(await screenMinorInput(req, res, 'tutor', tutorInputParts(body), controller.signal))) return;

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

    // producedText: the model wrote text (shown to an adult at once, held back for a minor), so a
    // later error keeps the unit charged.
    let producedText = false;
    let held = '';
    /** A minor's answer: screened as a whole, then sent as one delta and done (or an error event). */
    const releaseHeld = async (result, doneData) => {
      const text = result.text || held;
      try {
        await screenForMinor({
          direction: 'output', surface: 'tutor', parts: [{ label: 'tutor answer', text }],
          userId: req.userId ?? null, ip: req.ip, signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        writeSse(res, 'error', isSafetyError(error) ? safetyErrorResponse(error).body : toClientError(error).body);
        return;
      }
      if (text) writeSse(res, 'text.delta', { text });
      writeSse(res, 'done', { ...doneData, text });
    };
    try {
      const prompt = buildTutorPrompt(body, { mode, locale });
      const events = getGateway().stream({
        task: 'tutor.chat',
        userId: req.userId ?? null,
        audience,
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
          producedText = true;
          if (minor) held += event.text;
          else writeSse(res, 'text.delta', { text: event.text });
        } else if (event.type === 'done') {
          // truncated: the reply hit the output limit after the text the learner already has.
          const { provider, model, text, usage, truncated } = event.result;
          const doneData = { mode, grounding, provider, model, text, usage, ...(truncated ? { truncated: true } : {}) };
          if (minor) await releaseHeld(event.result, doneData);
          else writeSse(res, 'done', doneData);
        } else if (event.type === 'error') {
          if (!producedText) {
            refundGuestBudget(res, event.error);
            refundDailyCap(res, event.error);
          }
          const { body: errorBody } = toClientError(event.error);
          if (event.error?.code !== 'aborted') console.warn('[LLM Route] tutor stream error:', event.error?.code, event.error?.message);
          writeSse(res, 'error', errorBody);
        }
      }
    } catch (error) {
      if (!producedText) {
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
