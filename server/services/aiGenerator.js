/**
 * AI Generator Service — Phase 13-C
 *
 * Kit → RAG → LLM gateway (task 'course.generate') → one JSON object per stage
 * Handles 3-stage curriculum generation:
 *   requirements → roadmap → curriculum
 *
 * Grounding (「出典と検索」 step 7): every stage reads passages of the learner's own ready
 * materials (server/ragService.js retrieveContext: the materials attached to the conversation
 * first, then the learner's others; at most MATERIAL_CHUNKS chunks), each with its place
 * (tools/core/ragSearch.js chunkPassages: the material's name and PDF page). The passages go into
 * the user turn as data, and the prompts ask the model to write from them and cite their places
 * (aiPrompts.js). Without a database, or when reading fails, a stage runs without materials.
 *
 * Every stage is one gateway call (server/llm/index.js). The task runs on the cheap Claude tier
 * by default (server/llm/models.config.js); an owner can move it with
 * LLM_TASK_COURSE_GENERATE=anthropic:<model id>. Claude has no JSON mode for free-form replies
 * and no prefill, so the prompts (aiPrompts.js) ask for exactly one JSON object and
 * parseJsonReply reads it from plain JSON, a fenced block or the first balanced {...}.
 * Gateway failures are thrown as LlmError (server/llm/errors.js); the route maps them.
 *
 * Minors (Phase 0.5): with `{ audience: 'minor' }` each stage screens its learner text first (the
 * topic message and revision feedback as the model gets them, and the material passages;
 * server/safety/moderation.js) and its result before returning it, so nothing unscreened reaches
 * the database (the route saves only what a stage returns). A block or failed check is thrown as
 * SafetyError; its `direction` ('input' before the model ran, 'output' after) tells the route
 * whether to give the unit back. A minor's passages carry no file name (あなたの教材・3 ページ目):
 * a name is text the learner chose, and the pre-filter that keeps phone numbers and addresses away
 * from the model reads only what the learner wrote in the message.
 * The gateway call carries the audience, which adds the child-safety system part.
 */
import { retrieveContext } from '../ragService.js';
import { chunkPassages } from '../../tools/core/ragSearch.js';
import {
  buildRequirementsPrompt,
  buildRoadmapPrompt,
  buildCurriculumPrompt,
  courseText,
  curriculumMessage,
  materialBlocks,
  requirementsMessage,
  roadmapMessage,
} from './aiPrompts.js';
import { getGateway } from '../llm/index.js';
import { outputParts, screenForMinor } from '../safety/moderation.js';

/**
 * @typedef {{ signal?: AbortSignal, audience?: 'adult'|'minor', ip?: string | null }} StageOptions
 */

const SURFACE = 'course_generation';

/**
 * Text the learner wrote, as the model gets it (aiPrompts.js courseText: no tag left in it), so the
 * pre-filter sees what the model will see.
 * @param {string} label @param {unknown} text
 */
const textPart = (label, text) => (typeof text === 'string' && text.trim() ? [{ label, text: courseText(text) }] : []);
/**
 * Text the learner did not write (the material blocks, as the model gets them): the classifier
 * screens it, the local pre-filter does not.
 * @param {string} label @param {unknown} text
 */
const materialPart = (label, text) => (typeof text === 'string' && text.trim() ? [{ label, text, prefilter: false }] : []);

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

/**
 * Most chunks of the learner's materials each stage reads (a chunk is at most 1,000 characters):
 * the curriculum stage writes every lesson in one call, so it reads the most.
 */
export const MATERIAL_CHUNKS = Object.freeze({ requirements: 3, roadmap: 4, curriculum: 8 });

/** @param {unknown} value */
const textOf = (value) => (typeof value === 'string' ? value : '');
/** A roadmap title ({ jp, en } with `ja` as an alias of `jp`, or a string) as text. @param {any} title */
const titleText = (title) => (typeof title === 'string' ? title : textOf(title?.jp) || textOf(title?.ja) || textOf(title?.en));

/**
 * What the roadmap stage searches the learner's materials for: the learner's revision feedback
 * first, then the goal and the constraints (the keyword search keeps the first 8 words:
 * tools/core/ragSearch.js keywordPlan).
 * @param {any} intake
 */
export function roadmapQuery(intake) {
  return [intake?.revision_feedback, intake?.goal, intake?.constraints].map(textOf).filter(Boolean).join('\n');
}

/**
 * What the curriculum stage searches the learner's materials for: every module's title, then the
 * lessons' titles one module at a time (each module's first lesson, then each one's second, …), then
 * the goal, so the first 8 words the keyword search keeps cover the whole course, not the goal alone.
 * @param {any} intake
 * @param {any} modules
 */
export function curriculumQuery(intake, modules) {
  const list = Array.isArray(modules) ? modules : [];
  const lessons = list.map((module) => (Array.isArray(module?.lessons) ? module.lessons : []).map((lesson) => titleText(lesson?.title)));
  const rounds = Math.max(0, ...lessons.map((titles) => titles.length));
  const lessonTitles = Array.from({ length: rounds }, (_, i) => lessons.map((titles) => titles[i] ?? '')).flat();
  return [...list.map((module) => titleText(module?.title)), ...lessonTitles, textOf(intake?.goal)].filter(Boolean).join('\n');
}

/**
 * The passages of the learner's own materials a stage grounds in, the files attached to the
 * conversation first (those sent with this message before the kept ones), each with the place to
 * cite it; a minor's passages carry no file name. [] without a database or a learner, or when
 * reading fails (logged).
 * @param {string} query @param {number} limit @param {string | undefined} userId
 * @param {{ materialIds?: unknown, newMaterialIds?: unknown, audience?: 'adult'|'minor' }} options
 * @returns {Promise<Array<{ text: string, page: number | null, location: string }>>}
 */
async function readMaterials(query, limit, userId, { materialIds, newMaterialIds, audience }) {
  try {
    const chunks = await retrieveContext(query, limit, /** @type {string} */ (userId), {
      materialIds: Array.isArray(materialIds) ? materialIds : [],
      newMaterialIds: Array.isArray(newMaterialIds) ? newMaterialIds : [],
    });
    return chunks.flatMap((chunk) => chunkPassages(audience === 'minor' ? { ...chunk, title: null } : chunk));
  } catch (e) {
    console.warn('[AI Generator] Reading the learner\'s materials failed, continuing without:', e instanceof Error ? e.message : e);
    return [];
  }
}

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

/**
 * @typedef {{ materialIds?: string[], newMaterialIds?: string[] }} MaterialOptions materialIds: the
 *   files attached to the conversation, the newest first, read before the learner's other
 *   materials; newMaterialIds: those of them sent with this message, read before the rest
 */

/**
 * @param {string} message @param {string} userId @param {any} kit
 * @param {StageOptions & MaterialOptions} [options]
 */
export async function generateRequirements(message, userId, kit, options = {}) {
  const { signal, audience = 'adult', materialIds = [], newMaterialIds = [] } = options;
  // RAG: the learner's own uploaded materials, the attached ones first
  const passages = await readMaterials(message, MATERIAL_CHUNKS.requirements, userId, { materialIds, newMaterialIds, audience });

  await screenStage('input', [...textPart('learner topic', message), ...materialPart('uploaded material excerpts', materialBlocks(passages))], userId, options);

  const system = buildRequirementsPrompt(kit);
  const userMessage = requirementsMessage(message, passages);
  const result = await callCourseModel({ stage: 'requirements', system, userMessage, userId, input: { message }, signal, audience });

  const reply = result.structuredData
    ? { message: result.structuredData.message || result.text, intake: result.structuredData.intake }
    : { message: result.text, intake: null };
  await screenStage('output', outputParts(reply), userId, options);
  return reply;
}

/**
 * The intake is an earlier, already screened stage result; a revision adds the learner's
 * feedback as intake.revision_feedback, which a minor's call screens as input with the passages.
 * @param {any} intake @param {string} userId @param {any} kit
 * @param {StageOptions & MaterialOptions} [options]
 */
export async function generateRoadmap(intake, userId, kit, options = {}) {
  const { signal, audience = 'adult', materialIds = [], newMaterialIds = [] } = options;
  const passages = await readMaterials(roadmapQuery(intake), MATERIAL_CHUNKS.roadmap, userId, { materialIds, newMaterialIds, audience });
  await screenStage('input', [...textPart('revision feedback', intake?.revision_feedback), ...materialPart('uploaded material excerpts', materialBlocks(passages))], userId, options);
  const system = buildRoadmapPrompt(kit);
  const userMessage = roadmapMessage(intake, passages);
  const result = await callCourseModel({ stage: 'roadmap', system, userMessage, userId, input: { intake }, signal, audience });

  const reply = result.structuredData
    ? { message: result.structuredData.message || result.text, modules: result.structuredData.modules }
    : { message: result.text, modules: null };
  await screenStage('output', outputParts(reply), userId, options);
  return reply;
}

/**
 * A minor's call screens the material passages as input (the intake and roadmap are earlier,
 * already screened stage results).
 * @param {any} intake @param {any} modules @param {string} userId @param {any} kit
 * @param {StageOptions & MaterialOptions} [options]
 */
export async function generateCurriculum(intake, modules, userId, kit, options = {}) {
  const { signal, audience = 'adult', materialIds = [], newMaterialIds = [] } = options;
  const passages = await readMaterials(curriculumQuery(intake, modules), MATERIAL_CHUNKS.curriculum, userId, { materialIds, newMaterialIds, audience });
  await screenStage('input', materialPart('uploaded material excerpts', materialBlocks(passages)), userId, options);
  const system = buildCurriculumPrompt(kit);
  const userMessage = curriculumMessage(intake, modules, passages);
  const result = await callCourseModel({ stage: 'curriculum', system, userMessage, userId, input: { intake, modules }, signal, audience });

  if (!result.structuredData) {
    // Nothing is saved or shown from a reply without a curriculum (the route answers 422).
    return { curriculum: null, rawText: result.text };
  }

  const reply = { curriculum: result.structuredData.curriculum };
  await screenStage('output', outputParts(reply), userId, options);
  return reply;
}
