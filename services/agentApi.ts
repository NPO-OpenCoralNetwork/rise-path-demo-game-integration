import { apiFetch, isApiAvailable } from './apiClient';
import { dailyLimitFields } from './aiDailyLimit';
import type { TutorChatContext } from './tutorBridge';

export type AgentUiLanguage = 'en' | 'jp';

/**
 * Chat `context`. Journal views send the date range; the tutor (openTutor → FloatingChatbot) adds
 * mode, lesson, anchor and learner, which buildLessonContextLines() in
 * server/services/hermesAgentService.js turns into the lesson context for the agent.
 */
export interface AgentChatContext extends TutorChatContext {
  from?: string;
  to?: string;
  timezone?: string;
  ui_language?: AgentUiLanguage;
}

export interface AgentChatErrorCopy {
  genericError: string;
  hermesUnavailable: string;
  rateLimited: string;
  loginRequired: string;
  demoUnavailable?: string;
  diaryExcerptsNotAllowed?: string;
  /** 429 daily_limit_reached: today's agent_chat cap (server/middleware/dailyCaps.js), reset at 00:00 JST. */
  dailyLimit?: string;
  /** 429 daily_limit_reached with scope 'off': the feature is turned off (no reset time). */
  featurePaused?: string;
}

export function mapAgentChatError(err: unknown, copy: AgentChatErrorCopy): string {
  if (err instanceof AgentApiError) {
    if (err.errorType === 'hermes_not_configured' || err.errorType === 'hermes_unreachable') {
      return copy.hermesUnavailable;
    }
    // The connection to Hermes broke after the request was sent: a plain "try again".
    if (err.errorType === 'hermes_interrupted') return copy.genericError;
    if (err.errorType === 'api_disabled' && copy.demoUnavailable) {
      return copy.demoUnavailable;
    }
    if (err.status === 401) return copy.loginRequired;
    if (err.status === 403 && err.errorType === 'diary_excerpts_not_allowed' && copy.diaryExcerptsNotAllowed) {
      return copy.diaryExcerptsNotAllowed;
    }
    if (err.errorType === 'daily_limit_reached') {
      if (err.scope === 'off' && copy.featurePaused) return copy.featurePaused;
      if (copy.dailyLimit) return copy.dailyLimit;
    }
    if (err.status === 429) return copy.rateLimited;
    if (err.detail) return `${err.message}: ${err.detail}`;
    if (err.message) return err.message;
  }
  return copy.genericError;
}

export interface AgentChatRequest {
  skill: string;
  message: string;
  context?: AgentChatContext;
  include_diary_excerpts?: boolean;
  stream?: boolean;
}

export interface AgentChatResponse {
  ok: boolean;
  answer?: string;
  skill?: string;
  conversation?: string;
  evidence?: string[];
  caveats?: string[];
  privacy?: { diary_included: boolean };
  error?: string;
  error_type?: string;
  detail?: string;
}

export class AgentApiError extends Error {
  status: number;
  errorType?: string;
  detail?: string;
  /** Daily caps (services/aiDailyLimit.ts): the capped feature, whose limit, and when it lifts. */
  kind?: string;
  scope?: string;
  resetAt?: string;

  constructor(
    message: string,
    status: number,
    errorType?: string,
    detail?: string,
    limit: { kind?: string; scope?: string; resetAt?: string } = {},
  ) {
    super(message);
    this.name = 'AgentApiError';
    this.status = status;
    this.errorType = errorType;
    this.detail = detail;
    this.kind = limit.kind;
    this.scope = limit.scope;
    this.resetAt = limit.resetAt;
  }
}

/** Retry on network errors and 5xx except 503; do not retry 4xx (including 403 diary gate). */
export function shouldRetryAgentChatWithoutStream(err: unknown): boolean {
  if (!(err instanceof AgentApiError)) return true;
  if (err.status >= 400 && err.status < 500) return false;
  if (err.status === 503) return false;
  return true;
}

const parseAgentError = async (res: Response): Promise<AgentApiError> => {
  try {
    const data = await res.json();
    return new AgentApiError(
      data?.error || `Agent request failed (${res.status})`,
      res.status,
      data?.error_type,
      data?.detail,
      dailyLimitFields(data),
    );
  } catch {
    return new AgentApiError(`Agent request failed (${res.status})`, res.status);
  }
};

export const getClientTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

function extractStreamText(payload: Record<string, unknown>): string {
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.text === 'string') return payload.text;

  const choices = payload.choices as Array<{ delta?: { content?: string } }> | undefined;
  const choiceDelta = choices?.[0]?.delta?.content;
  if (typeof choiceDelta === 'string') return choiceDelta;

  const output = payload.output as Array<{ content?: Array<{ text?: string; type?: string }> }> | undefined;
  if (Array.isArray(output)) {
    for (const item of output) {
      for (const part of item.content || []) {
        if (typeof part.text === 'string') return part.text;
      }
    }
  }

  if (typeof payload.output_text === 'string') return payload.output_text;
  return '';
}

export async function postAgentChat(body: AgentChatRequest): Promise<AgentChatResponse> {
  if (!isApiAvailable()) {
    throw new AgentApiError('API is disabled in demo mode', 503, 'api_disabled');
  }

  const res = await apiFetch('/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ ...body, stream: false }),
  });

  if (!res.ok) throw await parseAgentError(res);
  return res.json();
}

export async function streamAgentChat(
  body: AgentChatRequest,
  onChunk: (text: string) => void,
): Promise<void> {
  if (!isApiAvailable()) {
    throw new AgentApiError('API is disabled in demo mode', 503, 'api_disabled');
  }

  const res = await apiFetch('/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!res.ok) throw await parseAgentError(res);
  if (!res.body) throw new AgentApiError('Empty stream response', 502, 'empty_stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;

      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const payload = JSON.parse(data) as Record<string, unknown>;
        const chunk = extractStreamText(payload);
        if (chunk) onChunk(chunk);
      } catch {
        if (data && data !== '[DONE]') onChunk(data);
      }
    }
  }
}

export async function getAgentHealth(): Promise<{ ok: boolean; hermes_configured: boolean }> {
  if (!isApiAvailable()) {
    return { ok: false, hermes_configured: false };
  }
  const res = await apiFetch('/agent/health');
  if (!res.ok) return { ok: false, hermes_configured: false };
  return res.json();
}