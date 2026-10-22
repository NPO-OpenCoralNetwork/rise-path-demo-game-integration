// @ts-check
/**
 * The only place model IDs live (PLAN §6.2). Everything else asks this module.
 *
 * Routing per task:
 *   default table below (learner-facing tasks run on the cheap tier: Claude Haiku)
 *   ← LLM_TASK_<TASK>=provider[:model]   e.g. LLM_TASK_TUTOR_CHAT=anthropic:claude-sonnet-5-5
 *   ← LLM_PROVIDER=anthropic|gemini|mock (forces every task onto one provider)
 *   ← request override (server code only; never taken from a request body)
 *
 * When the routed provider has no key, the gateway walks PROVIDER_FALLBACK_ORDER, then
 * falls back to `mock` outside production (LLM_MOCK_FALLBACK=false disables that).
 *
 * Gemini (chat, embeddings, image generation) is used only when GEMINI_ALLOWED is exactly
 * "true" (isGeminiAllowed). The Gemini API Additional Terms forbid services directed towards or
 * likely to be accessed by people under 18, and minors use Rise Path, so it is off by default
 * even when GEMINI_API_KEY is set. Turn it on only for deployments people under 18 cannot reach.
 */

/**
 * Whether this deployment may call Gemini at all: only when GEMINI_ALLOWED is exactly "true".
 * Unset, "1", "TRUE" or anything else is off, whatever keys are set.
 * @param {Record<string, string | undefined>} [env]
 */
export const isGeminiAllowed = (env = process.env) => env?.GEMINI_ALLOWED === 'true';

/** @typedef {'anthropic'|'gemini'|'mock'} ProviderId */
/** @typedef {'authoring'|'general'|'cheap'} ModelTier */
/** @typedef {'low'|'medium'|'high'|'xhigh'|'max'} Effort */

export const PROVIDER_IDS = /** @type {const} */ (['anthropic', 'gemini', 'mock']);

export const MODEL_IDS = Object.freeze({
  anthropic: Object.freeze({
    opus: 'claude-opus-5-5',
    sonnet: 'claude-sonnet-5-5',
    haiku: 'claude-haiku-5-5',
  }),
  gemini: Object.freeze({
    flash: 'gemini-3.8-flash',
    flashLite: 'gemini-3.5-flash-lite',
    embedding: 'gemini-embedding-2', // 768 dims via outputDimensionality (pgvector column)
    image: 'gemini-3-pro-image',
  }),
  mock: Object.freeze({
    default: 'mock-deterministic-1',
  }),
});

/**
 * Image models on OpenRouter's Images API (POST /api/v1/images), by the aliases that
 * scripts/assets/try-image-models.mjs and its plans use. Parameters and prices per model:
 * GET https://openrouter.ai/api/v1/images/models/<id>/endpoints.
 */
export const OPENROUTER_IMAGE_MODEL_IDS = Object.freeze({
  gptImageSunburst: 'openai/gpt-image-2.5-sunburst', // precision tier; transparent backgrounds
  gptImageFlare: 'openai/gpt-image-2.5-flare', // speed tier; transparent backgrounds
  seedreamPro: 'bytedance-seed/seedream-5-0-pro',
  seedreamLite: 'bytedance-seed/seedream-5-0-lite',
});

/** Which concrete model each provider uses for a tier, so LLM_PROVIDER=gemini stays sensible. */
const TIER_MODELS = Object.freeze({
  anthropic: { authoring: MODEL_IDS.anthropic.opus, general: MODEL_IDS.anthropic.sonnet, cheap: MODEL_IDS.anthropic.haiku },
  gemini: { authoring: MODEL_IDS.gemini.flash, general: MODEL_IDS.gemini.flash, cheap: MODEL_IDS.gemini.flashLite },
  mock: { authoring: MODEL_IDS.mock.default, general: MODEL_IDS.mock.default, cheap: MODEL_IDS.mock.default },
});

/**
 * Anthropic models that accept server-side `fallbacks: "default"` (beta). Claude Haiku 5.5 has
 * no server-side fallback, so the field is left off there.
 */
/** @type {ReadonlySet<string>} */
export const ANTHROPIC_SERVER_FALLBACK_MODELS = new Set([MODEL_IDS.anthropic.opus, MODEL_IDS.anthropic.sonnet]);

/**
 * @typedef {Object} TaskConfig
 * @property {ModelTier} tier
 * @property {ProviderId} provider  default provider
 * @property {Effort} effort        Anthropic output_config.effort (Gemini maps it to thinkingLevel)
 * @property {number} maxTokens     hard output ceiling; Anthropic thinking tokens count against it
 * @property {boolean} [stream]     long outputs: stream + finalMessage() even for non-streaming callers
 */

/** @type {Readonly<Record<string, TaskConfig>>} */
export const TASKS = Object.freeze({
  'course.outline': { tier: 'authoring', provider: 'anthropic', effort: 'high', maxTokens: 16000 },
  'lesson.author': { tier: 'authoring', provider: 'anthropic', effort: 'medium', maxTokens: 64000, stream: true },
  'lesson.judge': { tier: 'authoring', provider: 'anthropic', effort: 'medium', maxTokens: 8000 },
  'lesson.translate': { tier: 'general', provider: 'anthropic', effort: 'low', maxTokens: 32000, stream: true },
  // Learner-facing, high volume: the cheap tier (Claude Haiku). Owners can move one back with
  // LLM_TASK_<TASK>=anthropic:<model id>.
  'tutor.chat': { tier: 'cheap', provider: 'anthropic', effort: 'low', maxTokens: 8192 },
  'writing.feedback': { tier: 'cheap', provider: 'anthropic', effort: 'low', maxTokens: 4096 },
  'assessment.insight': { tier: 'general', provider: 'anthropic', effort: 'low', maxTokens: 4096 },
  'text.classify': { tier: 'cheap', provider: 'anthropic', effort: 'low', maxTokens: 1024 },
  // /api/v2/ai/generate (server/services/aiGenerator.js): requirements, roadmap and whole
  // curriculum replies as one JSON object. Long outputs, so streamed.
  'course.generate': { tier: 'cheap', provider: 'anthropic', effort: 'low', maxTokens: 32000, stream: true },
});

/** Provider order tried when the routed provider is unconfigured or fails with a retryable error. */
export const PROVIDER_FALLBACK_ORDER = /** @type {const} */ (['anthropic', 'gemini']);

/** @param {string} task */
export const taskEnvKey = (task) => `LLM_TASK_${task.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

/** @param {unknown} value @returns {value is ProviderId} */
export const isProviderId = (value) => typeof value === 'string' && /** @type {readonly string[]} */ (PROVIDER_IDS).includes(value);

/**
 * Model ID for a provider and tier.
 * @param {ProviderId} provider
 * @param {ModelTier} tier
 */
export const modelForTier = (provider, tier) => TIER_MODELS[provider][tier];

/**
 * Parse "provider" or "provider:model".
 * @param {string | undefined} raw
 * @returns {{ provider: ProviderId, model?: string } | null}
 */
export function parseProviderSpec(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const [providerPart, ...modelParts] = raw.trim().split(':');
  const provider = providerPart.trim().toLowerCase();
  if (!isProviderId(provider)) return null;
  const model = modelParts.join(':').trim();
  return model ? { provider, model } : { provider };
}

/**
 * @typedef {Object} TaskRoute
 * @property {string} task
 * @property {ProviderId} provider
 * @property {string} model
 * @property {Effort} effort
 * @property {number} maxTokens
 * @property {boolean} stream
 * @property {ModelTier} tier
 * @property {'default'|'env'|'forced'|'override'} source
 */

/**
 * Resolve the primary route for a task. Does not check keys; the gateway does that.
 * @param {string} task
 * @param {Record<string, string | undefined>} env
 * @param {{ provider?: ProviderId, model?: string, effort?: Effort, maxTokens?: number }} [override]
 * @returns {TaskRoute}
 */
export function resolveTaskRoute(task, env, override = {}) {
  const config = TASKS[task];
  if (!config) throw new Error(`Unknown LLM task: ${task}`);

  /** @type {TaskRoute['source']} */
  let source = 'default';
  /** @type {ProviderId} */
  let provider = config.provider;
  /** @type {string | undefined} */
  let model;

  const taskSpec = parseProviderSpec(env[taskEnvKey(task)]);
  if (taskSpec) {
    provider = taskSpec.provider;
    model = taskSpec.model;
    source = 'env';
  }

  const forced = parseProviderSpec(env.LLM_PROVIDER);
  if (forced) {
    if (forced.provider !== provider) model = undefined;
    provider = forced.provider;
    model = forced.model || model;
    source = 'forced';
  }

  if (override.provider && isProviderId(override.provider)) {
    if (override.provider !== provider) model = undefined;
    provider = override.provider;
    source = 'override';
  }
  if (override.model) {
    model = override.model;
    source = 'override';
  }

  return {
    task,
    provider,
    model: model || modelForTier(provider, config.tier),
    effort: override.effort || config.effort,
    maxTokens: override.maxTokens || config.maxTokens,
    stream: Boolean(config.stream),
    tier: config.tier,
    source,
  };
}
