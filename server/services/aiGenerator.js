/**
 * AI Generator Service — Phase 13-C
 *
 * Kit → RAG → LLM gateway (task 'course.generate') → one JSON object per stage
 * Handles 3-stage curriculum generation:
 *   requirements → roadmap → curriculum
 *
 * Every stage is one gateway call (server/llm/index.js). The task runs on the cheap Claude tier
 * by default (server/llm/models.config.js); an owner can move it with
 * LLM_TASK_COURSE_GENERATE=anthropic:<model id>. Claude has no JSON mode for free-form replies
 * and no prefill, so the prompts (aiPrompts.js) ask for exactly one JSON object and
 * parseJsonReply reads it from plain JSON, a fenced block or the first balanced {...}.
 * Gateway failures are thrown as LlmError (server/llm/errors.js); the route maps them.
 *
 * Minors (Phase 0.5): with `{ audience: 'minor' }` each stage screens its learner text first (the
 * topic message, revision feedback and the retrieved upload excerpts; server/safety/moderation.js)
 * and its result before returning it, so nothing unscreened reaches the database (the route saves
 * only what a stage returns). A block or failed check is thrown as SafetyError; its `direction`
 * ('input' before the model ran, 'output' after) tells the route whether to give the unit back.
 * The gateway call carries the audience, which adds the child-safety system part.
 */
import { retrieveContext } from '../ragService.js';
import {
  buildRequirementsPrompt,
  buildRoadmapPrompt,
  buildCurriculumPrompt,
} from './aiPrompts.js';
import { getGateway } from '../llm/index.js';
import { outputParts, screenForMinor } from '../safety/moderation.js';

/**
 * @typedef {{ signal?: AbortSignal, audience?: 'adult'|'minor', ip?: string | null }} StageOptions
 */

const SURFACE = 'course_generation';

/** @param {string} label @param {unknown} text */
const textPart = (label, text) => (typeof text === 'string' && text.trim() ? [{ label, text }] : []);
/** Text the learner did not write (uploaded material): the classifier screens it, the local pre-filter does not. @param {string} label @param {unknown} text */
const materialPart = (label, text) => textPart(label, text).map((p) => ({ ...p, prefilter: false }));

/**
 * Screen a minor's stage input or output (no-op for adults). Throws SafetyError.
 * @param {'input'|'output'} direction @param {import('../safety/moderation.js').ScreenPart[]} parts
 * @param {string | undefined} userId @param {StageOptions} options
 */
async function screenStage(direction, parts, userId, { audience, ip, signal } = {}) {
  if (audience !== 'minor') return;
  await screenForMinor({ direction, surface: SURFACE, parts, userId: userId ?? null, ip: ip ?? null, signal });
}

/** Gateway task for every stage (server/llm/models.config.js TASKS). */
export const COURSE_GENERATE_TASK = 'course.generate';

// --- Kit Cache (5 min TTL, LRU max 100) ---
const kitCache = new Map();
const KIT_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

export async function getCachedKit(userId, getKitFn) {
  const cached = kitCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.kit;

  // Evict oldest entry if cache is full
  if (kitCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = kitCache.keys().next().value;
    kitCache.delete(oldestKey);
  }

  const kit = await getKitFn({ userId });
  kitCache.set(userId, { kit, expiresAt: Date.now() + KIT_TTL_MS });
  return kit;
}

/**
 * True when the gateway can run a stage: a provider for 'course.generate' is configured, or the
 * mock provider stands in (outside production). The route answers 503 ai_unavailable otherwise.
 */
export function isCourseGenerationAvailable() {
  const gateway = getGateway();
  if (typeof gateway.canServe === 'function') return gateway.canServe(COURSE_GENERATE_TASK);
  // A gateway without canServe (a test double): ask its status snapshot.
  const task = gateway.status?.()?.tasks?.[COURSE_GENERATE_TASK];
  return task ? Boolean(task.provider) : true;
}

// --- JSON replies ---

/** Most `{` positions parseJsonReply tries before giving up. */
const MAX_OBJECT_STARTS = 50;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const tryParseObject = (text) => {
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * The first balanced `{...}` in `text`, skipping braces inside JSON strings; null when none
 * closes.
 * @param {string} text
 * @param {number} from
 */
function balancedObjectAt(text, from) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

/**
 * The JSON object in a model reply: the whole reply, a ```json (or bare ```) fenced block, or
 * a balanced {...}, in that order: the first candidate that parses and that `accept` takes.
 * `accept` lets a stage skip an earlier object of another shape (an echoed input, an example),
 * so the stage's own object later in the reply is still found. Returns null when there is none
 * (arrays and scalars are not stage replies).
 * @param {unknown} text
 * @param {(value: Record<string, any>) => boolean} [accept]
 * @returns {Record<string, any> | null}
 */
export function parseJsonReply(text, accept = () => true) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/^﻿/, '');
  if (!trimmed) return null;

  const take = (candidate) => {
    const parsed = candidate ? tryParseObject(candidate) : null;
    return parsed && accept(parsed) ? parsed : null;
  };

  const whole = take(trimmed);
  if (whole) return whole;

  for (const match of trimmed.matchAll(/```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g)) {
    const fenced = take(match[1].trim());
    if (fenced) return fenced;
  }

  // Bounded: each attempt scans to the end of a long reply at worst. An object that parses but
  // is not taken is skipped whole, so the braces nested in an echoed input do not use up attempts.
  let attempts = 0;
  let start = trimmed.indexOf('{');
  while (start !== -1 && attempts < MAX_OBJECT_STARTS) {
    attempts += 1;
    const candidate = balancedObjectAt(trimmed, start);
    const parsed = candidate ? tryParseObject(candidate) : null;
    if (parsed && accept(parsed)) return parsed;
    const next = parsed ? start + candidate.length : start + 1;
    start = trimmed.indexOf('{', next);
  }
  return null;
}

/**
 * One gateway call for a stage. Throws LlmError on failure (no provider, rate limit, timeout…).
 * @param {{ stage: 'requirements'|'roadmap'|'curriculum', system: string, userMessage: string,
 *   userId?: string, input?: Record<string, unknown>, signal?: AbortSignal, audience?: 'adult'|'minor' }} params
 */
async function callCourseModel({ stage, system, userMessage, userId, input = {}, signal, audience = 'adult' }) {
  const result = await getGateway().generate({
    task: COURSE_GENERATE_TASK,
    userId: userId ?? null,
    audience,
    system: [{ text: system, cache: true }],
    messages: [{ role: 'user', content: userMessage }],
    locale: 'ja',
    input: { stage, ...input },
    signal,
  });
  const text = typeof result?.text === 'string' ? result.text : '';
  // A stage only takes an object of its own shape: an echoed input, an example or a nested piece
  // of a broken reply (say a {en, jp} title) is skipped, and none at all counts as no JSON.
  return { text, structuredData: parseJsonReply(text, (value) => isStageReply(stage, value)) };
}

/**
 * Whether a parsed object has the shape a stage asks for (aiPrompts.js output formats):
 * requirements an `intake` object, roadmap a `modules` array, curriculum a `curriculum` object
 * with a non-empty `modules` array.
 * @param {'requirements'|'roadmap'|'curriculum'} stage
 * @param {Record<string, any>} value
 */
export function isStageReply(stage, value) {
  if (!isPlainObject(value)) return false;
  if (stage === 'requirements') return isPlainObject(value.intake);
  if (stage === 'roadmap') return Array.isArray(value.modules);
  if (stage === 'curriculum') {
    return isPlainObject(value.curriculum) && Array.isArray(value.curriculum.modules) && value.curriculum.modules.length > 0;
  }
  return false;
}

// --- Stage Handlers ---

/** @param {string} message @param {string} userId @param {any} kit @param {StageOptions} [options] */
export async function generateRequirements(message, userId, kit, options = {}) {
  const { signal, audience = 'adult' } = options;
  // RAG: search for relevant educational content
  let ragContext = '';
  try {
    const chunks = await retrieveContext(message, 3, userId);
    if (chunks.length > 0) {
      ragContext = chunks.join('\n---\n');
    }
  } catch (e) {
    console.warn('[AI Generator] RAG retrieval failed, continuing without:', e.message);
  }

  await screenStage('input', [...textPart('learner topic', message), ...materialPart('uploaded material excerpts', ragContext)], userId, options);

  const system = buildRequirementsPrompt(kit, ragContext);
  const result = await callCourseModel({ stage: 'requirements', system, userMessage: message, userId, input: { message }, signal, audience });

  const reply = result.structuredData
    ? { message: result.structuredData.message || result.text, intake: result.structuredData.intake }
    : { message: result.text, intake: null };
  await screenStage('output', outputParts(reply), userId, options);
  return reply;
}

/**
 * The intake is an earlier, already screened stage result; a revision adds the learner's
 * feedback as intake.revision_feedback, which a minor's call screens as input.
 * @param {any} intake @param {string} userId @param {any} kit @param {StageOptions} [options]
 */
export async function generateRoadmap(intake, userId, kit, options = {}) {
  const { signal, audience = 'adult' } = options;
  await screenStage('input', textPart('revision feedback', intake?.revision_feedback), userId, options);
  const system = buildRoadmapPrompt(kit);
  const userMessage = `以下の学習要件に基づきロードマップを作成してください:\n\n${JSON.stringify(intake, null, 2)}`;
  const result = await callCourseModel({ stage: 'roadmap', system, userMessage, userId, input: { intake }, signal, audience });

  const reply = result.structuredData
    ? { message: result.structuredData.message || result.text, modules: result.structuredData.modules }
    : { message: result.text, modules: null };
  await screenStage('output', outputParts(reply), userId, options);
  return reply;
}

/** @param {any} intake @param {any} modules @param {string} userId @param {any} kit @param {StageOptions} [options] */
export async function generateCurriculum(intake, modules, userId, kit, options = {}) {
  const { signal, audience = 'adult' } = options;
  const system = buildCurriculumPrompt(kit);
  const userMessage = `以下の要件とロードマップに基づき、完全なカリキュラムを生成してください:\n\n## 要件\n${JSON.stringify(intake, null, 2)}\n\n## モジュール構成\n${JSON.stringify(modules, null, 2)}`;
  const result = await callCourseModel({ stage: 'curriculum', system, userMessage, userId, input: { intake, modules }, signal, audience });

  if (!result.structuredData) {
    // Nothing is saved or shown from a reply without a curriculum (the route answers 422).
    return { curriculum: null, rawText: result.text };
  }

  const reply = { curriculum: result.structuredData.curriculum };
  await screenStage('output', outputParts(reply), userId, options);
  return reply;
}
