// Daily caps on paid AI features (server/middleware/dailyCaps.js). When a cap is reached the
// API answers 429 { error_type: 'daily_limit_reached', kind, scope, reset_at }. Callers copy
// those fields onto the thrown Error as `errorType`, `kind`, `scope` and `resetAt`
// (dailyLimitFields); the helpers below read them.
// scope: 'user' (this learner), 'ip' (this network), 'global' (all learners), 'guest' (the guest
// budget: signing in lifts it), 'off' (the feature is turned off: no reset time is promised).
// No imports, so node:test can load this file with --experimental-strip-types.

export const DAILY_LIMIT_ERROR_TYPE = 'daily_limit_reached';

export type AiCapKind = 'llm' | 'course_generation' | 'image' | 'agent_chat' | 'embeddings';
export type AiCapScope = 'user' | 'ip' | 'global' | 'guest' | 'off';

const CAP_KINDS: readonly AiCapKind[] = ['llm', 'course_generation', 'image', 'agent_chat', 'embeddings'];
const CAP_SCOPES: readonly AiCapScope[] = ['user', 'ip', 'global', 'guest', 'off'];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** True when `err` is an error (or object) whose `errorType` is 'daily_limit_reached'. */
export function isDailyLimitError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  return (err as { errorType?: unknown }).errorType === DAILY_LIMIT_ERROR_TYPE;
}

/** The capped feature named by a daily-limit error, or null for any other error or an unknown kind. */
export function dailyLimitKind(err: unknown): AiCapKind | null {
  if (!isDailyLimitError(err)) return null;
  const kind = (err as { kind?: unknown }).kind;
  return typeof kind === 'string' && (CAP_KINDS as readonly string[]).includes(kind) ? (kind as AiCapKind) : null;
}

/**
 * Whose limit a daily-limit error is about, or null for any other error. A daily-limit error
 * without a known scope counts as 'user' (an older server).
 */
export function dailyLimitScope(err: unknown): AiCapScope | null {
  if (!isDailyLimitError(err)) return null;
  const scope = (err as { scope?: unknown }).scope;
  return typeof scope === 'string' && (CAP_SCOPES as readonly string[]).includes(scope) ? (scope as AiCapScope) : 'user';
}

/** The next 00:00 in Japan (UTC+9 all year, no daylight saving time) after `nowMs`. */
export function nextJstMidnight(nowMs: number): number {
  const day = new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
  return Date.parse(`${day}T00:00:00.000Z`) - JST_OFFSET_MS + DAY_MS;
}

/**
 * When the limit lifts, in ms: the server's reset_at when it is a time after `nowMs` and within a
 * day, else the next 00:00 JST. null for a feature that is turned off (scope 'off') and for any
 * error that is not a daily limit.
 */
export function dailyLimitResetAt(err: unknown, nowMs: number = Date.now()): number | null {
  const scope = dailyLimitScope(err);
  if (!scope || scope === 'off') return null;
  const raw = (err as { resetAt?: unknown }).resetAt;
  const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > nowMs && parsed - nowMs <= DAY_MS ? parsed : nextJstMidnight(nowMs);
}

/** The daily-limit fields of an API error body, named as the thrown errors carry them. */
export function dailyLimitFields(body: unknown): { errorType?: string; kind?: string; scope?: string; resetAt?: string } {
  if (body === null || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    errorType: text(record.error_type),
    kind: text(record.kind),
    scope: text(record.scope),
    resetAt: text(record.reset_at),
  };
}
