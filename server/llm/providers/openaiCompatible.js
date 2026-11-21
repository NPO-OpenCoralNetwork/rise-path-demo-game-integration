// @ts-check
/**
 * OpenAI-compatible provider: the Chat Completions API (POST <base URL>/chat/completions) that
 * OpenAI, OpenRouter and model servers people run themselves (Ollama, vLLM, ...) offer. It is for
 * self-hosting (doc/brushup-2026/ai-access-plan.ja.md 14 章 K3): the operator contracts with the
 * service and keeps its terms. The NPO's cloud version does not use it (preflight C4 refuses a route
 * to any provider but Anthropic), and the gateway sends nothing here unless a route names `openai`.
 *
 * - Plain fetch, no SDK. The operator names the server (OPENAI_BASE_URL), the key (OPENAI_API_KEY; a
 *   local server may need none) and the model (OPENAI_MODEL, or LLM_TASK_<TASK>=openai:<model>).
 * - Text only: RAG embeddings and image generation stay on Gemini.
 * - No effort and no sampling parameters: which ones a server takes differs by server and model.
 * - The output limit goes in `max_completion_tokens`, OpenAI's field (OpenAI's reasoning models refuse
 *   `max_tokens`). Servers that read only `max_tokens` (Ollama lists no `max_completion_tokens`) take
 *   OPENAI_MAX_TOKENS_FIELD=max_tokens.
 * - The tasks' limits are set for Claude (up to 64k tokens for lesson.author); a model with a smaller
 *   output limit may refuse them, so OPENAI_MAX_OUTPUT_TOKENS caps the limit sent.
 * - JSON: `response_format` json_schema, not strict (strict mode wants every property required), and
 *   the same schema in the system message for servers that ignore `response_format`. A server or model
 *   that refuses `response_format` takes OPENAI_RESPONSE_FORMAT=none. The gateway validates the reply
 *   with zod and asks once for a repair.
 * - Turns in a row from one role become one message, as for Gemini: some models' chat templates
 *   refuse a user turn after a user turn.
 * - Long outputs (task `stream`, or maxTokens > 16k) stream even for generate(), so no single HTTP
 *   response has to arrive within the timeout. The timeout (LLM_TIMEOUT_MS) bounds the wait for the
 *   response, then each wait between streamed chunks.
 * - A failed connection and the statuses 408, 409, 429 and 5xx are retried before any reply arrives
 *   (LLM_MAX_RETRIES, default 2); after that the gateway may move on to the next provider.
 * - No user id is sent: the server may belong to anyone.
 */
import { LlmError } from '../errors.js';
import { toLlmJsonSchema } from '../structured.js';

/** @typedef {import('../index.js').LlmRequest} LlmRequest */
/** @typedef {import('../models.config.js').TaskRoute} TaskRoute */

const PROVIDER = /** @type {const} */ ('openai');
const NON_STREAMING_MAX_TOKENS = 16000;
/** Statuses retried before any reply, besides 5xx (as OpenAI's SDK does). */
const RETRY_STATUSES = new Set([408, 409, 429]);

/** Fields a server may read the output limit from; the first is the default. */
export const MAX_TOKENS_FIELDS = /** @type {const} */ (['max_completion_tokens', 'max_tokens']);

/** How JSON is asked for (OPENAI_RESPONSE_FORMAT); the first is the default. */
export const RESPONSE_FORMATS = /** @type {const} */ (['json_schema', 'none']);

/**
 * `<base URL>/chat/completions`, with or without a slash at the end of the base URL.
 * @param {string} baseURL
 */
export const chatCompletionsUrl = (baseURL) => `${baseURL.replace(/\/+$/, '')}/chat/completions`;

/** @param {LlmRequest['system']} system */
const toSystemText = (system) => (typeof system === 'string' ? system : (system || []).map((p) => p.text).filter(Boolean).join('\n\n'));

/**
 * The schema as an instruction, for servers that ignore `response_format`.
 * @param {Record<string, any>} schema
 */
const jsonInstruction = (schema) => `Reply with one JSON object only, and nothing else. It must match this JSON Schema:\n${JSON.stringify(schema)}`;

/**
 * Chat messages: one system message (with the JSON instruction last), then the turns, with turns in
 * a row from one role joined into one message.
 * @param {LlmRequest} req
 * @param {Record<string, any> | null} schema
 */
function toMessages(req, schema) {
  const system = [toSystemText(req.system), schema ? jsonInstruction(schema) : ''].filter(Boolean).join('\n\n');
  /** @type {Array<{ role: 'user' | 'assistant', content: string }>} */
  const turns = [];
  for (const m of req.messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  return [...(system ? [{ role: 'system', content: system }] : []), ...turns];
}

/** A schema name OpenAI accepts (letters, digits, `_` and `-`, at most 64). @param {string} task */
const schemaName = (task) => String(task).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 64) || 'reply';

/**
 * Usage as Anthropic reports it: input without the cached part, which counts as cache reads.
 * @param {any} usage
 */
export const normalizeUsage = (usage) => {
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens) || 0;
  return {
    inputTokens: Math.max(0, (Number(usage?.prompt_tokens) || 0) - cached),
    outputTokens: Number(usage?.completion_tokens) || 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
};

/**
 * The typed error for an HTTP status, or for the HTTP-like `code` of an error object that a server
 * sends inside a reply (OpenRouter does). `cause` keeps the server's answer for the logs; it never
 * reaches the browser.
 * @param {number} status
 * @param {TaskRoute} route
 * @param {unknown} cause
 * @param {boolean} [modelRan]  the error came inside a reply, so a model may have run
 */
export function errorForStatus(status, route, cause, modelRan = false) {
  const meta = { provider: PROVIDER, model: route.model, cause, ...(modelRan ? { modelRan: true } : {}) };
  if (status === 401 || status === 403) return new LlmError('auth', 'OpenAI-compatible server rejected the API key', meta);
  // OpenRouter answers 402 when the account has no credits left: a server setting, like a bad key.
  if (status === 402) return new LlmError('auth', 'OpenAI-compatible server refused the account (payment required)', meta);
  if (status === 429) return new LlmError('rate_limited', 'OpenAI-compatible server rate limit', meta);
  if (status === 404) return new LlmError('provider_error', `OpenAI-compatible server: model or path not found: ${route.model}`, meta);
  if (status === 408 || status === 504) return new LlmError('timeout', 'OpenAI-compatible server timed out', meta);
  if (status >= 500) return new LlmError('provider_unavailable', 'OpenAI-compatible server error', meta);
  return new LlmError('bad_request', 'OpenAI-compatible server rejected the request', meta);
}

/**
 * An error object inside a reply or a streamed chunk.
 * @param {any} error
 * @param {TaskRoute} route
 */
const errorInReply = (error, route) => (typeof error?.code === 'number'
  ? errorForStatus(error.code, route, error, true)
  : new LlmError('provider_error', 'OpenAI-compatible server sent an error', { provider: PROVIDER, model: route.model, cause: error, modelRan: true }));

/**
 * A failed fetch or body read as a typed error.
 * @param {unknown} error
 * @param {TaskRoute} route
 * @param {{ aborted: boolean, timedOut: boolean, started: boolean }} at
 *   started: the server had begun to answer, so a model may have run
 */
function mapFailure(error, route, at) {
  if (error instanceof LlmError) return error;
  const meta = { provider: PROVIDER, model: route.model, cause: error, ...(at.started ? { modelRan: true } : {}) };
  if (at.aborted) return new LlmError('aborted', 'Request aborted', meta);
  if (at.timedOut) return new LlmError('timeout', 'OpenAI-compatible server timed out', meta);
  if (!at.started) return new LlmError('provider_unavailable', 'OpenAI-compatible server connection failed', meta);
  return new LlmError('provider_error', 'OpenAI-compatible call failed', meta);
}

/**
 * One call's abort signal: the caller's signal, plus a timer that ends a wait longer than
 * `timeoutMs` (armed again before each wait).
 * @param {AbortSignal | undefined} outer
 * @param {number} timeoutMs
 */
function callControl(outer, timeoutMs) {
  const controller = new AbortController();
  const state = { timedOut: false };
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const onAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    state,
    aborted: () => Boolean(outer?.aborted),
    arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.timedOut = true;
        controller.abort();
      }, timeoutMs);
    },
    disarm() {
      clearTimeout(timer);
    },
    release() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

/** @typedef {ReturnType<typeof callControl>} CallControl */

/**
 * Wait `ms`, or less when `signal` aborts.
 * @param {number} ms
 * @param {AbortSignal} signal
 */
const pause = (ms, signal) => new Promise((resolve) => {
  if (signal.aborted) {
    resolve(undefined);
    return;
  }
  const done = () => {
    clearTimeout(timer);
    signal.removeEventListener('abort', done);
    resolve(undefined);
  };
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', done, { once: true });
});

/** 0.5 s, 1 s, 2 s, ... up to 8 s. @param {number} attempt */
const backoffMs = (attempt) => Math.min(8000, 500 * 2 ** attempt);

/**
 * The server's error answer, for the logs.
 * @param {Response} res
 */
async function errorBody(res) {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

/**
 * The JSON of each `data:` line of a server-sent event stream, until `data: [DONE]` (which sets
 * `sse.done`). Comment lines (`: keep-alive`, which OpenRouter sends) and other fields are skipped.
 * The timer is armed before each read, so a stalled stream ends as a timeout.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {CallControl} control
 * @param {{ done: boolean }} sse
 */
async function* readEvents(reader, control, sse) {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    control.arm();
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        sse.done = true;
        return;
      }
      if (data) yield JSON.parse(data);
    }
    if (done) return;
  }
}

/**
 * The reply of a call that was not streamed, or a typed error when it cannot be used.
 * @param {any} json
 * @param {TaskRoute} route
 */
function readCompletion(json, route) {
  if (json?.error) throw errorInReply(json.error, route);
  const choice = json?.choices?.[0];
  if (!choice) {
    throw new LlmError('provider_error', 'OpenAI-compatible server sent no choices', { provider: PROVIDER, model: route.model, cause: json, modelRan: true });
  }
  const model = typeof json.model === 'string' && json.model ? json.model : route.model;
  const meta = { provider: PROVIDER, model, retryable: false };
  if (choice.message?.refusal || choice.finish_reason === 'content_filter') {
    throw new LlmError('refusal', 'The model declined the request', { ...meta, details: choice.finish_reason ?? null });
  }
  if (choice.finish_reason === 'length') throw new LlmError('max_tokens', 'The reply hit the output limit', meta);
  return {
    provider: PROVIDER,
    model,
    text: typeof choice.message?.content === 'string' ? choice.message.content : '',
    stopReason: 'end',
    usage: normalizeUsage(json.usage),
  };
}

/**
 * @param {{ apiKey?: string, baseURL?: string, timeoutMs?: number, maxRetries?: number, maxTokensField?: string, maxOutputTokens?: number | string, responseFormat?: string, fetch?: typeof fetch }} options
 */
export function createOpenAICompatibleProvider(options) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxRetries = options.maxRetries ?? 2;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const wanted = typeof options.maxTokensField === 'string' ? options.maxTokensField.trim() : '';
  const maxTokensField = MAX_TOKENS_FIELDS.find((field) => field === wanted) ?? MAX_TOKENS_FIELDS[0];
  // OPENAI_MAX_OUTPUT_TOKENS: a positive whole number caps the limit; anything else leaves the task's.
  const cap = Number.parseInt(String(options.maxOutputTokens ?? ''), 10);
  const maxOutputTokens = cap > 0 ? cap : Number.POSITIVE_INFINITY;
  const wantedFormat = typeof options.responseFormat === 'string' ? options.responseFormat.trim() : '';
  const responseFormat = RESPONSE_FORMATS.find((format) => format === wantedFormat) ?? RESPONSE_FORMATS[0];
  const url = options.baseURL ? chatCompletionsUrl(options.baseURL) : '';
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers.Authorization = 'Bearer ' + options.apiKey;

  /**
   * @param {LlmRequest} req
   * @param {TaskRoute} route
   * @param {boolean} stream
   */
  function buildBody(req, route, stream) {
    const schema = req.schema ? toLlmJsonSchema(req.schema) : null;
    return {
      model: route.model,
      messages: toMessages(req, schema),
      [maxTokensField]: Math.min(route.maxTokens, maxOutputTokens),
      ...(schema && responseFormat === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: schemaName(req.task), schema, strict: false } } } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  }

  /**
   * POST the body and return the response once it is ok. A failed connection and the retried
   * statuses are tried again (maxRetries times); anything else throws a typed error.
   * @param {Record<string, any>} body
   * @param {TaskRoute} route
   * @param {CallControl} control
   * @returns {Promise<Response>}
   */
  async function post(body, route, control) {
    if (!url) throw new LlmError('no_provider', 'OPENAI_BASE_URL is not set', { provider: PROVIDER, model: route.model, retryable: false });
    for (let attempt = 0; ; attempt += 1) {
      control.arm();
      /** @type {LlmError} */
      let failure;
      try {
        const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: control.signal });
        if (res.ok) return res;
        failure = errorForStatus(res.status, route, await errorBody(res));
        const retried = RETRY_STATUSES.has(res.status) || res.status >= 500;
        if (!retried || attempt >= maxRetries) throw failure;
      } catch (error) {
        failure = mapFailure(error, route, { aborted: control.aborted(), timedOut: control.state.timedOut, started: false });
        if (failure.code !== 'provider_unavailable' || error instanceof LlmError || attempt >= maxRetries) throw failure;
      }
      control.disarm();
      await pause(backoffMs(attempt), control.signal);
      if (control.aborted()) throw new LlmError('aborted', 'Request aborted', { provider: PROVIDER, model: route.model, cause: failure });
    }
  }

  /**
   * One call that is not streamed. The timer stays armed while the body is read.
   * @param {LlmRequest} req
   * @param {TaskRoute} route
   */
  async function generateOnce(req, route) {
    const control = callControl(req.signal, timeoutMs);
    try {
      const res = await post(buildBody(req, route, false), route, control);
      let json;
      try {
        json = await res.json();
      } catch (error) {
        throw mapFailure(error, route, { aborted: control.aborted(), timedOut: control.state.timedOut, started: true });
      }
      return readCompletion(json, route);
    } finally {
      control.release();
    }
  }

  /**
   * One streamed call: `text.delta` events, then `done`. A reply cut off by the output limit after
   * visible text ends with `done` (`stopReason: 'max_tokens'`, `truncated: true`); cut off before any
   * text, it throws `max_tokens`. A refusal or a content filter throws `refusal`.
   * @param {LlmRequest} req
   * @param {TaskRoute} route
   */
  async function* streamOnce(req, route) {
    const control = callControl(req.signal, timeoutMs);
    /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
    let reader = null;
    let started = false;
    try {
      const res = await post(buildBody(req, route, true), route, control);
      started = true;
      if (!res.body) throw new LlmError('provider_error', 'OpenAI-compatible server sent no stream', { provider: PROVIDER, model: route.model, modelRan: true });
      reader = res.body.getReader();
      const sse = { done: false };
      let text = '';
      let model = route.model;
      /** @type {string | null} */
      let finish = null;
      let refused = false;
      let usage = null;
      for await (const chunk of readEvents(reader, control, sse)) {
        if (chunk?.error) throw errorInReply(chunk.error, route);
        if (typeof chunk?.model === 'string' && chunk.model) model = chunk.model;
        if (chunk?.usage) usage = chunk.usage;
        const choice = chunk?.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.refusal) refused = true;
        const delta = choice.delta?.content;
        if (typeof delta === 'string' && delta) {
          text += delta;
          yield { type: 'text.delta', text: delta };
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      const meta = { provider: PROVIDER, model, retryable: false };
      if (refused || finish === 'content_filter') throw new LlmError('refusal', 'The model declined the request', { ...meta, details: finish });
      if (finish === 'error' || (!finish && !sse.done)) {
        throw new LlmError('provider_error', 'OpenAI-compatible stream ended without finishing', { provider: PROVIDER, model, modelRan: true });
      }
      const truncated = finish === 'length';
      if (truncated && !text.trim()) throw new LlmError('max_tokens', 'The reply hit the output limit', meta);
      yield {
        type: 'done',
        result: {
          provider: PROVIDER,
          model,
          text,
          stopReason: truncated ? 'max_tokens' : 'end',
          ...(truncated ? { truncated: true } : {}),
          usage: normalizeUsage(usage),
        },
      };
    } catch (error) {
      throw mapFailure(error, route, { aborted: control.aborted(), timedOut: control.state.timedOut, started });
    } finally {
      control.release();
      reader?.cancel().catch(() => {});
    }
  }

  return {
    id: PROVIDER,

    /**
     * @param {LlmRequest} req
     * @param {TaskRoute} route
     */
    async generate(req, route) {
      if (!route.stream && route.maxTokens <= NON_STREAMING_MAX_TOKENS) return generateOnce(req, route);
      /** @type {any} */
      let result = null;
      for await (const event of streamOnce(req, route)) {
        if (event.type === 'done') result = event.result;
      }
      if (result?.truncated) throw new LlmError('max_tokens', 'The reply hit the output limit', { provider: PROVIDER, model: result.model, retryable: false });
      return result;
    },

    /**
     * @param {LlmRequest} req
     * @param {TaskRoute} route
     */
    async *stream(req, route) {
      yield* streamOnce(req, route);
    },
  };
}
