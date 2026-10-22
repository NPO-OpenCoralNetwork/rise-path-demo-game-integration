// @ts-check
/**
 * LLM gateway: the single server-side entry point for model calls (PLAN §6.1).
 *
 *   const gateway = getGateway();
 *   const result = await gateway.generate({ task: 'writing.feedback', schema, system, messages });
 *   for await (const event of gateway.stream({ task: 'tutor.chat', system, messages })) { ... }
 *
 * Routing comes from models.config.js. Providers without a key are skipped; a retryable
 * failure (5xx, timeout, rate limit, bad key) moves on to the next configured provider.
 * Without any key the gateway uses the mock provider outside production, and throws
 * `no_provider` (HTTP 503) in production.
 *
 * The Gemini key counts only when GEMINI_ALLOWED is exactly "true" (models.config.js
 * isGeminiAllowed: the Gemini API terms exclude services that people under 18 use). A key set
 * without it is ignored, reported as unconfigured, and logged once as a warning.
 */
import { LlmError, isLlmError, modelMayHaveRun } from './errors.js';
import {
  PROVIDER_FALLBACK_ORDER,
  TASKS,
  isGeminiAllowed,
  modelForTier,
  resolveTaskRoute,
} from './models.config.js';
import { generateStructured } from './structured.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createMockProvider } from './providers/mock.js';

/** @typedef {import('./models.config.js').ProviderId} ProviderId */
/** @typedef {import('./models.config.js').TaskRoute} TaskRoute */
/** @typedef {import('./models.config.js').Effort} Effort */
/** @typedef {import('./prompts/shared.js').SystemPart} SystemPart */

/**
 * @typedef {Object} LlmRequest
 * @property {string} task                         key of TASKS in models.config.js
 * @property {string | null} [userId]
 * @property {string | SystemPart[]} [system]      stable parts first (`cache: true`)
 * @property {Array<{ role: 'user'|'assistant', content: any }>} messages
 * @property {import('zod/v4').ZodType} [schema]   structured output, validated + one repair turn
 * @property {'ja'|'en'|'fr'} [locale]
 * @property {AbortSignal} [signal]
 * @property {{ provider?: ProviderId, model?: string, effort?: Effort, maxTokens?: number }} [override]
 * @property {unknown} [input]                     structured input the prompt was built from (mock + logs)
 */

/**
 * @typedef {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }} LlmUsage
 * @typedef {{ provider: string, model: string, text: string, data?: any, stopReason: string, usage: LlmUsage, repaired?: boolean, truncated?: boolean }} LlmResult
 * @typedef {{ type: 'text.delta', text: string } | { type: 'done', result: LlmResult } | { type: 'error', error: LlmError }} LlmEvent
 */

/**
 * @typedef {Object} LlmProvider
 * @property {string} id
 * @property {(req: LlmRequest, route: TaskRoute) => Promise<any>} generate
 * @property {(req: LlmRequest, route: TaskRoute) => AsyncIterable<any>} stream
 */

/**
 * @typedef {Object} GatewayOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {Partial<Record<ProviderId, (options: any) => LlmProvider>>} [providers]  factory overrides (tests)
 * @property {{ info: Function, warn: Function }} [logger]
 */

const cleanKey = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/** A Gemini key from the server environment (never a VITE_* variable), allowed or not. */
const rawGeminiKey = (env) => cleanKey(env.GEMINI_API_KEY) || cleanKey(env.GOOGLE_API_KEY);

/** The warning logged when a Gemini key is set but GEMINI_ALLOWED is not "true". */
export const GEMINI_KEY_IGNORED_WARNING = '[LLM] GEMINI_API_KEY (or GOOGLE_API_KEY) is set but GEMINI_ALLOWED is not "true", '
  + 'so Gemini is off: no Gemini chat, embeddings or image generation. The Gemini API terms do not allow services that '
  + 'people under 18 use. Set GEMINI_ALLOWED=true only on a deployment that people under 18 cannot reach; otherwise '
  + 'remove the key.';

/**
 * Whether a Gemini key is set that GEMINI_ALLOWED keeps off (for the startup warning).
 * @param {Record<string, string | undefined>} [env]
 */
export const geminiKeyIgnored = (env = process.env) => Boolean(rawGeminiKey(env)) && !isGeminiAllowed(env);

/**
 * Log GEMINI_KEY_IGNORED_WARNING when it applies. Returns whether it was logged.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ warn: Function }} [logger]
 */
export function warnIfGeminiKeyIgnored(env = process.env, logger = console) {
  if (!geminiKeyIgnored(env)) return false;
  logger.warn(GEMINI_KEY_IGNORED_WARNING);
  return true;
}

/** @type {LlmUsage} */
const NO_USAGE = Object.freeze({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/**
 * Whether mock may stand in when no provider key is configured.
 * @param {Record<string, string | undefined>} env
 */
export function allowMockFallback(env) {
  if (env.LLM_MOCK_FALLBACK === 'true') return true;
  if (env.LLM_MOCK_FALLBACK === 'false') return false;
  return env.NODE_ENV !== 'production';
}

/**
 * @param {GatewayOptions} [options]
 */
export function createGateway(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const keys = {
    anthropic: cleanKey(env.ANTHROPIC_API_KEY),
    gemini: isGeminiAllowed(env) ? rawGeminiKey(env) : '',
  };
  // The process-wide gateway is built once, so this is one warning per process.
  warnIfGeminiKeyIgnored(env, logger);
  const timeoutMs = Number.parseInt(env.LLM_TIMEOUT_MS || '', 10) || 120_000;
  const mockDelayMs = Number.parseInt(env.LLM_MOCK_DELAY_MS ?? '', 10);

  /** @type {Record<ProviderId, (options: any) => LlmProvider>} */
  const factories = {
    anthropic: createAnthropicProvider,
    gemini: createGeminiProvider,
    mock: createMockProvider,
    ...options.providers,
  };

  /** @param {ProviderId} id */
  const isConfigured = (id) => (id === 'mock' ? true : Boolean(keys[id]));

  /** @type {Map<ProviderId, LlmProvider>} */
  const instances = new Map();
  /** @param {ProviderId} id */
  const getProvider = (id) => {
    if (!instances.has(id)) {
      const factory = factories[id];
      instances.set(id, factory({
        apiKey: id === 'mock' ? '' : keys[id],
        baseURL: id === 'anthropic' ? cleanKey(env.ANTHROPIC_BASE_URL) || undefined : undefined,
        maxRetries: Number.parseInt(env.LLM_MAX_RETRIES || '', 10) >= 0 ? Number.parseInt(env.LLM_MAX_RETRIES || '', 10) : undefined,
        timeoutMs,
        delayMs: Number.isFinite(mockDelayMs) ? mockDelayMs : undefined,
        serverFallbacks: env.LLM_ANTHROPIC_SERVER_FALLBACKS !== 'false',
      }));
    }
    return /** @type {LlmProvider} */ (instances.get(id));
  };

  /**
   * Routes to try, in order.
   * @param {string} task
   * @param {LlmRequest['override']} [override]
   * @returns {TaskRoute[]}
   */
  function plan(task, override) {
    if (!TASKS[task]) throw new LlmError('bad_request', `Unknown LLM task: ${task}`, { retryable: false });
    const primary = resolveTaskRoute(task, env, override);
    const pinned = primary.source === 'forced' || primary.source === 'override';

    /** @type {TaskRoute[]} */
    const candidates = [primary];
    if (!pinned) {
      for (const provider of PROVIDER_FALLBACK_ORDER) {
        if (provider === primary.provider) continue;
        candidates.push({ ...primary, provider, model: modelForTier(provider, primary.tier), source: 'default' });
      }
    }
    const routes = candidates.filter((route) => isConfigured(route.provider));
    if (!routes.length && allowMockFallback(env)) {
      routes.push({ ...primary, provider: 'mock', model: modelForTier('mock', primary.tier), source: 'default' });
    }
    if (!routes.length) {
      throw new LlmError('no_provider', `No LLM provider configured for ${task}`, { retryable: false });
    }
    return routes;
  }

  /**
   * @param {TaskRoute} route
   * @param {LlmRequest} req
   * @param {LlmResult | undefined} result
   * @param {number} startedAt
   * @param {LlmError} [error]
   */
  function logCall(route, req, result, startedAt, error) {
    const usage = result?.usage;
    const parts = [
      `[LLM] task=${req.task}`,
      `provider=${route.provider}`,
      `model=${result?.model || route.model}`,
      `ms=${Date.now() - startedAt}`,
      usage ? `in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadTokens} cache_write=${usage.cacheWriteTokens}` : '',
      result?.repaired ? 'repaired=1' : '',
      result?.truncated ? 'truncated=1' : '',
      error ? `error=${error.code}` : '',
      req.userId ? `user=${String(req.userId).slice(0, 8)}` : '',
    ];
    (error ? logger.warn : logger.info).call(logger, parts.filter(Boolean).join(' '));
  }

  /**
   * @param {unknown} error
   * @param {TaskRoute} route
   */
  const asLlmError = (error, route) => (isLlmError(error)
    ? error
    : new LlmError('provider_error', 'LLM provider failed', { provider: route.provider, model: route.model, cause: error }));

  /** @param {LlmRequest} req */
  function assertRequest(req) {
    if (!req || typeof req.task !== 'string') throw new LlmError('bad_request', 'task is required', { retryable: false });
    if (!Array.isArray(req.messages) || !req.messages.length) {
      throw new LlmError('bad_request', 'messages are required', { retryable: false });
    }
  }

  return {
    /**
     * Non-streaming call. With `req.schema`, `result.data` is the zod-validated object.
     * @param {LlmRequest} req
     * @returns {Promise<LlmResult>}
     */
    async generate(req) {
      assertRequest(req);
      let lastError = null;
      // Whether any attempt (or a structured first turn) already ran a model: the final error
      // then carries modelRan, so a guest's quota is not given back for a billed call.
      let modelRan = false;
      for (const route of plan(req.task, req.override)) {
        const startedAt = Date.now();
        try {
          const provider = getProvider(route.provider);
          const call = async (r) => {
            const out = await provider.generate(r, route);
            modelRan = true;
            return out;
          };
          const result = req.schema
            ? await generateStructured({
              call,
              req,
              schema: req.schema,
              provider: route.provider,
              model: route.model,
            })
            : await call(req);
          logCall(route, req, result, startedAt);
          return { ...result, provider: route.provider };
        } catch (error) {
          const llmError = asLlmError(error, route);
          if (modelMayHaveRun(llmError)) modelRan = true;
          if (modelRan) llmError.modelRan = true;
          logCall(route, req, undefined, startedAt, llmError);
          if (!llmError.retryable || req.signal?.aborted) throw llmError;
          lastError = llmError;
        }
      }
      throw lastError ?? new LlmError('no_provider', 'No LLM provider available', { retryable: false });
    },

    /**
     * Streaming text call. Yields normalized events and never throws for provider failures:
     * they arrive as one final `error` event. Falls over to the next provider only before
     * any text has been sent. A reply cut off by the output limit after text was sent ends
     * with `done` (`truncated: true`) carrying that text, not with an error.
     * @param {LlmRequest} req
     * @returns {AsyncGenerator<LlmEvent>}
     */
    async *stream(req) {
      let routes;
      try {
        assertRequest(req);
        routes = plan(req.task, req.override);
      } catch (error) {
        yield { type: 'error', error: isLlmError(error) ? error : new LlmError('bad_request', 'Invalid LLM request', { cause: error }) };
        return;
      }

      let lastError = null;
      let modelRan = false; // as in generate(): any earlier attempt that may have been billed
      for (const route of routes) {
        const startedAt = Date.now();
        let sentText = false;
        let text = '';
        try {
          for await (const event of getProvider(route.provider).stream(req, route)) {
            if (event.type === 'text.delta') {
              sentText = true;
              text += event.text;
              yield event;
            } else if (event.type === 'done') {
              const result = { ...event.result, provider: route.provider };
              logCall(route, req, result, startedAt);
              yield { type: 'done', result };
              return;
            }
          }
          return;
        } catch (error) {
          const llmError = asLlmError(error, route);
          if (sentText || modelMayHaveRun(llmError)) modelRan = true;
          if (modelRan) llmError.modelRan = true;
          // Providers that report truncation as an error: keep the text the reader already has.
          // (The built-in providers end such replies with a truncated `done` and real usage;
          // this path has no usage to report.)
          if (llmError.code === 'max_tokens' && text.trim() && !req.signal?.aborted) {
            /** @type {LlmResult} */
            const result = {
              provider: route.provider,
              model: llmError.model || route.model,
              text,
              stopReason: 'max_tokens',
              truncated: true,
              usage: { ...NO_USAGE },
            };
            logCall(route, req, result, startedAt);
            yield { type: 'done', result };
            return;
          }
          logCall(route, req, undefined, startedAt, llmError);
          if (sentText || !llmError.retryable || req.signal?.aborted) {
            yield { type: 'error', error: llmError };
            return;
          }
          lastError = llmError;
        }
      }
      yield { type: 'error', error: lastError ?? new LlmError('no_provider', 'No LLM provider available', { retryable: false }) };
    },

    /**
     * Whether a call for `task` would reach a provider: a configured one, or the mock fallback
     * outside production. False when it would fail with `no_provider` (or the task is unknown).
     * @param {string} task
     */
    canServe(task) {
      try {
        return plan(task).length > 0;
      } catch {
        return false;
      }
    },

    /**
     * Configuration snapshot for /llm/status. Contains no secrets.
     */
    status() {
      const forced = typeof env.LLM_PROVIDER === 'string' && env.LLM_PROVIDER.trim() ? env.LLM_PROVIDER.trim().toLowerCase() : null;
      /** @type {Record<string, { provider: string | null, model: string | null, effort: string, fallback: string[] }>} */
      const tasks = {};
      let usesMock = false;
      for (const task of Object.keys(TASKS)) {
        try {
          const [first, ...rest] = plan(task);
          if (first.provider === 'mock') usesMock = true;
          tasks[task] = {
            provider: first.provider,
            model: first.model,
            effort: first.effort,
            fallback: rest.map((r) => `${r.provider}:${r.model}`),
          };
        } catch {
          tasks[task] = { provider: null, model: null, effort: TASKS[task].effort, fallback: [] };
        }
      }
      const anyConfigured = Boolean(keys.anthropic || keys.gemini);
      return {
        ok: anyConfigured || usesMock,
        mock: usesMock,
        forced_provider: forced,
        providers: {
          anthropic: { configured: Boolean(keys.anthropic) },
          gemini: { configured: Boolean(keys.gemini), allowed: isGeminiAllowed(env) },
          mock: { available: allowMockFallback(env) || forced === 'mock', forced: forced === 'mock' },
        },
        tasks,
      };
    },
  };
}

/** @typedef {ReturnType<typeof createGateway>} LlmGateway */

/** @type {LlmGateway | null} */
let gateway = null;

/**
 * Process-wide gateway, built from process.env on first use (after server.js has loaded
 * .env.local).
 */
export function getGateway() {
  gateway ??= createGateway();
  return gateway;
}

/** @param {LlmGateway | null} next */
export function setGatewayForTests(next) {
  gateway = next;
}

export function resetGatewayForTests() {
  gateway = null;
}
