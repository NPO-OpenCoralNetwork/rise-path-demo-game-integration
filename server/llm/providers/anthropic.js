// @ts-check
/**
 * Anthropic provider (@anthropic-ai/sdk 0.135, beta Messages API).
 *
 * - Beta namespace throughout: `fallbacks: "default"` (server-side refusal fallback,
 *   beta `server-side-fallback-2026-07-01`) only exists on `client.beta.messages`.
 * - JSON: `client.beta.messages.parse` + `betaZodOutputFormat`. If the helper is missing from
 *   the installed SDK, the zod schema is converted with structured.js (unsupported keywords
 *   stripped) and passed as a raw `output_config.format`; zod still validates the reply.
 * - Long outputs (task `stream` or maxTokens > 16k): `messages.stream(...).finalMessage()`.
 * - Thinking stays adaptive (it cannot be disabled on the current models); depth is set with
 *   `output_config.effort` per task. No sampling parameters (rejected by the current models).
 * - The stable system prefix carries `cache_control` so repeated calls read it from cache.
 */
import { LlmError } from '../errors.js';
import { ANTHROPIC_SERVER_FALLBACK_MODELS } from '../models.config.js';
import { toLlmJsonSchema, validateStructured } from '../structured.js';

/** @typedef {import('../index.js').LlmRequest} LlmRequest */
/** @typedef {import('../models.config.js').TaskRoute} TaskRoute */

const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const NON_STREAMING_MAX_TOKENS = 16000;

/** Lazy SDK load keeps server start fast and lets tests run without the network. */
let sdkPromise = null;
const loadSdk = () => {
  sdkPromise ??= Promise.all([
    import('@anthropic-ai/sdk'),
    import('@anthropic-ai/sdk/helpers/beta/zod').catch(() => null),
  ]).then(([sdk, zodHelpers]) => ({
    sdk,
    betaZodOutputFormat: typeof zodHelpers?.betaZodOutputFormat === 'function' ? zodHelpers.betaZodOutputFormat : null,
  }));
  return sdkPromise;
};

/**
 * Map SDK errors to LlmError, most specific class first.
 * @param {any} sdk
 * @param {unknown} error
 * @param {TaskRoute} route
 */
export function mapAnthropicError(sdk, error, route) {
  if (error instanceof LlmError) return error;
  const meta = { provider: 'anthropic', model: route.model, cause: error };
  if (error instanceof sdk.APIUserAbortError) return new LlmError('aborted', 'Request aborted', meta);
  if (error instanceof sdk.APIConnectionTimeoutError) return new LlmError('timeout', 'Anthropic request timed out', meta);
  if (error instanceof sdk.APIConnectionError) return new LlmError('provider_unavailable', 'Anthropic connection failed', meta);
  if (error instanceof sdk.AuthenticationError || error instanceof sdk.PermissionDeniedError) {
    return new LlmError('auth', 'Anthropic rejected the API key', meta);
  }
  if (error instanceof sdk.RateLimitError) return new LlmError('rate_limited', 'Anthropic rate limit', meta);
  if (error instanceof sdk.NotFoundError) return new LlmError('provider_error', `Anthropic model not found: ${route.model}`, meta);
  if (error instanceof sdk.BadRequestError || error instanceof sdk.UnprocessableEntityError) {
    return new LlmError('bad_request', 'Anthropic rejected the request', meta);
  }
  if (error instanceof sdk.InternalServerError) return new LlmError('provider_unavailable', 'Anthropic server error', meta);
  if (error instanceof sdk.APIError) return new LlmError('provider_error', 'Anthropic API error', meta);
  if (error instanceof sdk.AnthropicError) return new LlmError('invalid_output', 'Anthropic response could not be parsed', { ...meta, retryable: false });
  return new LlmError('provider_error', 'Anthropic call failed', meta);
}

/**
 * @param {LlmRequest['system']} system
 */
function toSystemBlocks(system) {
  if (!system) return undefined;
  const parts = typeof system === 'string' ? [{ text: system, cache: true }] : system;
  return parts
    .filter((part) => part.text && part.text.trim())
    .map((part) => ({
      type: /** @type {const} */ ('text'),
      text: part.text,
      ...(part.cache ? { cache_control: { type: /** @type {const} */ ('ephemeral') } } : {}),
    }));
}

/**
 * @param {any} usage
 */
const normalizeUsage = (usage) => ({
  inputTokens: usage?.input_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
});

/** @param {any} message */
const collectText = (message) => (message?.content || [])
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('');

/**
 * Raise typed errors for stop reasons that make the reply unusable.
 * @param {any} message
 * @param {TaskRoute} route
 */
function assertUsable(message, route) {
  const meta = { provider: 'anthropic', model: message?.model || route.model, retryable: false };
  if (message?.stop_reason === 'refusal') {
    throw new LlmError('refusal', 'Claude declined the request', { ...meta, details: message.stop_details?.category ?? null });
  }
  if (message?.stop_reason === 'max_tokens' || message?.stop_reason === 'model_context_window_exceeded') {
    throw new LlmError('max_tokens', 'Claude reply hit the output limit', meta);
  }
}

/**
 * @param {{ apiKey: string, baseURL?: string, timeoutMs?: number, maxRetries?: number, serverFallbacks?: boolean }} options
 */
export function createAnthropicProvider(options) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const serverFallbacks = options.serverFallbacks !== false;
  let clientPromise = null;

  const getClient = () => {
    clientPromise ??= loadSdk().then(({ sdk }) => new sdk.default({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      maxRetries: options.maxRetries ?? 2,
      timeout: timeoutMs,
    }));
    return clientPromise;
  };

  /**
   * @param {LlmRequest} req
   * @param {TaskRoute} route
   * @param {any} outputFormat
   */
  function buildParams(req, route, outputFormat) {
    const useFallbacks = serverFallbacks && ANTHROPIC_SERVER_FALLBACK_MODELS.has(route.model);
    return {
      model: route.model,
      max_tokens: route.maxTokens,
      system: toSystemBlocks(req.system),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: /** @type {const} */ ('adaptive') },
      output_config: { effort: route.effort, ...(outputFormat ? { format: outputFormat } : {}) },
      ...(useFallbacks ? { betas: [SERVER_FALLBACK_BETA], fallbacks: /** @type {const} */ ('default') } : {}),
    };
  }

  /**
   * Output format for a zod schema. The SDK helper validates inside `parse`; it is wrapped so a
   * validation failure comes back as data (for the repair turn) instead of a thrown error.
   * @param {any} betaZodOutputFormat
   * @param {LlmRequest} req
   */
  function outputFormatFor(betaZodOutputFormat, req) {
    if (!req.schema) return null;
    if (betaZodOutputFormat) {
      const base = betaZodOutputFormat(req.schema);
      return { type: base.type, schema: base.schema, parse: (content) => validateStructured(content, req.schema) };
    }
    return { type: 'json_schema', schema: toLlmJsonSchema(req.schema) };
  }

  return {
    id: /** @type {const} */ ('anthropic'),

    /**
     * @param {LlmRequest} req
     * @param {TaskRoute} route
     */
    async generate(req, route) {
      const { sdk, betaZodOutputFormat } = await loadSdk();
      const client = await getClient();
      const format = outputFormatFor(betaZodOutputFormat, req);
      const params = buildParams(req, route, format);
      const requestOptions = { signal: req.signal };
      try {
        const longOutput = route.stream || route.maxTokens > NON_STREAMING_MAX_TOKENS;
        let message;
        if (longOutput) {
          message = await client.beta.messages.stream(params, requestOptions).finalMessage();
        } else if (format && 'parse' in format && typeof client.beta.messages.parse === 'function') {
          message = await client.beta.messages.parse(params, requestOptions);
        } else {
          message = await client.beta.messages.create(params, requestOptions);
        }
        assertUsable(message, route);
        const text = collectText(message);
        const structured = message.parsed_output && typeof message.parsed_output === 'object' && 'ok' in message.parsed_output
          ? message.parsed_output
          : undefined;
        return {
          provider: 'anthropic',
          model: message.model || route.model,
          text,
          structured,
          stopReason: 'end',
          usage: normalizeUsage(message.usage),
        };
      } catch (error) {
        throw mapAnthropicError(sdk, error, route);
      }
    },

    /**
     * Text streaming: yields `text.delta` events, then `done`. A refusal or truncation after
     * partial text throws a typed LlmError (the gateway turns it into an `error` event).
     * @param {LlmRequest} req
     * @param {TaskRoute} route
     */
    async *stream(req, route) {
      const { sdk } = await loadSdk();
      const client = await getClient();
      const params = buildParams(req, route, null);
      let stream;
      try {
        stream = client.beta.messages.stream(params, { signal: req.signal });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
            yield { type: 'text.delta', text: event.delta.text };
          }
        }
        const message = await stream.finalMessage();
        assertUsable(message, route);
        yield {
          type: 'done',
          result: {
            provider: 'anthropic',
            model: message.model || route.model,
            text: collectText(message),
            stopReason: 'end',
            usage: normalizeUsage(message.usage),
          },
        };
      } catch (error) {
        throw mapAnthropicError(sdk, error, route);
      } finally {
        if (req.signal?.aborted) stream?.abort();
      }
    },
  };
}
