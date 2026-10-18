// @ts-check
/**
 * Typed errors for the LLM gateway.
 *
 * Every provider failure is normalized to an LlmError with a stable `code`, so routes can map
 * it to an HTTP status and a client-safe message without string-matching provider errors.
 * Raw provider messages stay in server logs (`cause`) and never reach the browser.
 */

/**
 * @typedef {'no_provider'|'provider_unavailable'|'auth'|'rate_limited'|'timeout'|'aborted'
 *   |'bad_request'|'refusal'|'max_tokens'|'invalid_output'|'provider_error'} LlmErrorCode
 */

/** HTTP status returned to the client for each code. */
export const LLM_ERROR_STATUS = /** @type {const} */ ({
  no_provider: 503,
  provider_unavailable: 503,
  auth: 503, // our key is wrong or missing: a server configuration problem, not the caller's
  rate_limited: 429,
  timeout: 504,
  aborted: 499,
  bad_request: 400,
  refusal: 422,
  max_tokens: 502,
  invalid_output: 502,
  provider_error: 502,
});

/** Client-safe messages (the UI localizes by `error_type`; these are fallbacks). */
const CLIENT_MESSAGES = /** @type {const} */ ({
  no_provider: 'AI service is not configured',
  provider_unavailable: 'AI service is temporarily unavailable',
  auth: 'AI service is temporarily unavailable',
  rate_limited: 'AI rate limit exceeded. Please try again shortly.',
  timeout: 'The AI request timed out. Please try again.',
  aborted: 'The AI request was cancelled',
  bad_request: 'The AI request was rejected',
  refusal: 'The AI declined to answer this request',
  max_tokens: 'The AI response was cut off. Please try again.',
  invalid_output: 'The AI returned an unexpected response. Please try again.',
  provider_error: 'The AI service returned an error',
});

/** Codes where trying the next provider in the chain makes sense. */
const RETRYABLE_CODES = new Set(['provider_unavailable', 'auth', 'rate_limited', 'timeout', 'provider_error']);

export class LlmError extends Error {
  /**
   * @param {LlmErrorCode} code
   * @param {string} message
   * @param {{ provider?: string, model?: string, retryable?: boolean, cause?: unknown, details?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'LlmError';
    /** @type {LlmErrorCode} */
    this.code = code;
    this.status = LLM_ERROR_STATUS[code] ?? 502;
    this.provider = options.provider;
    this.model = options.model;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** @param {unknown} error @returns {error is LlmError} */
export const isLlmError = (error) => error instanceof LlmError;

/**
 * Map any error to `{ status, body }` for a JSON response. Never echoes provider messages.
 * @param {unknown} error
 */
export function toClientError(error) {
  const code = isLlmError(error) ? error.code : 'provider_error';
  return {
    status: LLM_ERROR_STATUS[code] ?? 500,
    body: { error: CLIENT_MESSAGES[code] ?? CLIENT_MESSAGES.provider_error, error_type: code },
  };
}
