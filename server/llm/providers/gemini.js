// @ts-check
/**
 * Gemini provider (@google/genai). Fixes the call-site bugs found in the audit:
 * - `systemInstruction` goes inside `config` (top-level is silently dropped by the SDK)
 * - JSON is pinned with `responseMimeType` + `responseJsonSchema`
 * - cancellation via `config.abortSignal`, timeout via `config.httpOptions.timeout`
 * - constructed as `new GoogleGenAI({ apiKey })`
 */
import { LlmError } from '../errors.js';
import { toLlmJsonSchema } from '../structured.js';

/** @typedef {import('../index.js').LlmRequest} LlmRequest */
/** @typedef {import('../models.config.js').TaskRoute} TaskRoute */

const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT',
]);

let sdkPromise = null;
const loadSdk = () => {
  sdkPromise ??= import('@google/genai');
  return sdkPromise;
};

/**
 * @param {any} sdk
 * @param {unknown} error
 * @param {TaskRoute} route
 */
export function mapGeminiError(sdk, error, route) {
  if (error instanceof LlmError) return error;
  const meta = { provider: 'gemini', model: route.model, cause: error };
  const name = /** @type {any} */ (error)?.name;
  if (name === 'AbortError') return new LlmError('aborted', 'Request aborted', meta);
  if (sdk?.ApiError && error instanceof sdk.ApiError) {
    const status = /** @type {any} */ (error).status;
    if (status === 401 || status === 403) return new LlmError('auth', 'Gemini rejected the API key', meta);
    if (status === 429) return new LlmError('rate_limited', 'Gemini rate limit', meta);
    if (status === 404) return new LlmError('provider_error', `Gemini model not found: ${route.model}`, meta);
    if (status === 408 || status === 504) return new LlmError('timeout', 'Gemini request timed out', meta);
    if (status >= 500) return new LlmError('provider_unavailable', 'Gemini server error', meta);
    if (status >= 400) return new LlmError('bad_request', 'Gemini rejected the request', meta);
  }
  if (name === 'TimeoutError') return new LlmError('timeout', 'Gemini request timed out', meta);
  // fetch() could not reach Gemini: no model ran.
  if (error instanceof TypeError && /fetch failed|network/i.test(String(/** @type {any} */ (error).message))) {
    return new LlmError('provider_unavailable', 'Gemini connection failed', meta);
  }
  // Anything else may have failed after the model ran (and was billed).
  return new LlmError('provider_unavailable', 'Gemini call failed', { ...meta, modelRan: true });
}

/**
 * Gemini has no system role in `contents`; consecutive turns of one role are merged.
 * @param {LlmRequest['messages']} messages
 */
function toContents(messages) {
  /** @type {Array<{ role: 'user'|'model', parts: Array<{ text: string }> }>} */
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push({ text });
    else contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

/** @param {LlmRequest['system']} system */
const toSystemText = (system) => (typeof system === 'string' ? system : (system || []).map((p) => p.text).filter(Boolean).join('\n\n'));

/** @param {TaskRoute['effort']} effort */
const thinkingLevel = (effort) => (effort === 'low' ? 'LOW' : effort === 'medium' ? undefined : 'HIGH');

/** @param {any} meta */
const normalizeUsage = (meta) => ({
  inputTokens: meta?.promptTokenCount ?? 0,
  outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
  cacheReadTokens: meta?.cachedContentTokenCount ?? 0,
  cacheWriteTokens: 0,
});

/**
 * @param {any} response
 * @param {TaskRoute} route
 */
function assertUsable(response, route) {
  const meta = { provider: 'gemini', model: route.model, retryable: false };
  if (response?.promptFeedback?.blockReason) {
    throw new LlmError('refusal', 'Gemini blocked the prompt', { ...meta, details: response.promptFeedback.blockReason });
  }
  const reason = response?.candidates?.[0]?.finishReason;
  if (reason && BLOCKED_FINISH_REASONS.has(reason)) throw new LlmError('refusal', 'Gemini blocked the reply', { ...meta, details: reason });
  if (reason === 'MAX_TOKENS') throw new LlmError('max_tokens', 'Gemini reply hit the output limit', meta);
}

/**
 * @param {{ apiKey: string, timeoutMs?: number }} options
 */
export function createGeminiProvider(options) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  let clientPromise = null;
  const getClient = () => {
    clientPromise ??= loadSdk().then((sdk) => new sdk.GoogleGenAI({ apiKey: options.apiKey }));
    return clientPromise;
  };

  /**
   * @param {LlmRequest} req
   * @param {TaskRoute} route
   */
  function buildConfig(req, route) {
    const level = thinkingLevel(route.effort);
    return {
      systemInstruction: toSystemText(req.system) || undefined,
      maxOutputTokens: route.maxTokens,
      abortSignal: req.signal,
      httpOptions: { timeout: timeoutMs },
      ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
      ...(req.schema ? { responseMimeType: 'application/json', responseJsonSchema: toLlmJsonSchema(req.schema) } : {}),
    };
  }

  return {
    id: /** @type {const} */ ('gemini'),

    /**
     * @param {LlmRequest} req
     * @param {TaskRoute} route
     */
    async generate(req, route) {
      const sdk = await loadSdk();
      try {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model: route.model,
          contents: toContents(req.messages),
          config: /** @type {any} */ (buildConfig(req, route)),
        });
        assertUsable(response, route);
        return {
          provider: 'gemini',
          model: response.modelVersion || route.model,
          text: response.text ?? '',
          stopReason: 'end',
          usage: normalizeUsage(response.usageMetadata),
        };
      } catch (error) {
        throw mapGeminiError(sdk, error, route);
      }
    },

    /**
     * Text streaming: `text.delta` events, then `done`. A reply cut off by the token limit after
     * visible text ends with `done` (`stopReason: 'max_tokens'`, `truncated: true`, real usage);
     * cut off before any text, it throws `max_tokens`. Blocked replies throw `refusal`.
     * @param {LlmRequest} req
     * @param {TaskRoute} route
     */
    async *stream(req, route) {
      const sdk = await loadSdk();
      try {
        const ai = await getClient();
        const stream = await ai.models.generateContentStream({
          model: route.model,
          contents: toContents(req.messages),
          config: /** @type {any} */ (buildConfig(req, route)),
        });
        let text = '';
        let last = null;
        let truncated = false;
        for await (const chunk of stream) {
          last = chunk;
          // A blocked chunk is never shown; a chunk cut off by the token limit still carries
          // the end of the visible answer, so its text goes out first.
          const hitLimit = chunk?.candidates?.[0]?.finishReason === 'MAX_TOKENS';
          if (!hitLimit) assertUsable(chunk, route);
          const delta = chunk.text;
          if (delta) {
            text += delta;
            yield { type: 'text.delta', text: delta };
          }
          if (hitLimit) truncated = true;
        }
        // Cut off before any visible text (thinking used the budget): nothing to keep.
        if (truncated && !text.trim()) assertUsable(last, route);
        yield {
          type: 'done',
          result: {
            provider: 'gemini',
            model: last?.modelVersion || route.model,
            text,
            stopReason: truncated ? 'max_tokens' : 'end',
            ...(truncated ? { truncated: true } : {}),
            usage: normalizeUsage(last?.usageMetadata),
          },
        };
      } catch (error) {
        throw mapGeminiError(sdk, error, route);
      }
    },
  };
}
