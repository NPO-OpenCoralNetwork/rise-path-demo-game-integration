// Client for the server-side LLM gateway (/api/v2/llm). The browser never holds a model key
// or a model SDK; every AI call goes through these helpers.
import { apiFetch } from './apiClient';
import type { AIAdvice, AnalysisResult, Big5Profile, LessonRubric } from '../types';

export type LlmLocale = 'ja' | 'en' | 'fr';

/** App language codes ('jp') → gateway locales ('ja'). */
export const toLlmLocale = (language: string | undefined): LlmLocale => {
  if (language === 'jp' || language === 'ja') return 'ja';
  if (language === 'fr') return 'fr';
  return 'en';
};

export class LlmApiError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = 'LlmApiError';
    this.status = status;
    this.errorType = errorType;
  }
}

const readError = async (res: Response): Promise<LlmApiError> => {
  try {
    const data = await res.json();
    return new LlmApiError(data?.error || `LLM request failed (${res.status})`, res.status, data?.error_type);
  } catch {
    return new LlmApiError(`LLM request failed (${res.status})`, res.status);
  }
};

const postJson = async <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> => {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body), signal });
  if (!res.ok) throw await readError(res);
  const payload = await res.json();
  return payload.data as T;
};

// --- Status ---------------------------------------------------------------------

export interface LlmTaskStatus {
  provider: 'anthropic' | 'gemini' | 'mock' | null;
  model: string | null;
  effort: string;
  fallback: string[];
}

export interface LlmStatus {
  ok: boolean;
  /** true when AI answers come from the built-in demo provider (no server key configured). */
  mock: boolean;
  forced_provider: string | null;
  providers: {
    anthropic: { configured: boolean };
    gemini: { configured: boolean };
    mock: { available: boolean; forced: boolean };
  };
  tasks: Record<string, LlmTaskStatus>;
}

export const getLlmStatus = async (signal?: AbortSignal): Promise<LlmStatus> => {
  const res = await apiFetch('/llm/status', { signal });
  if (!res.ok) throw await readError(res);
  return res.json();
};

// --- Writing feedback (LessonView) ------------------------------------------------

export const analyzeWriting = (
  text: string,
  rubric: LessonRubric,
  options: { locale?: LlmLocale; lessonTitle?: string; goal?: string; signal?: AbortSignal } = {},
): Promise<AnalysisResult> => postJson<AnalysisResult>('/llm/writing-feedback', {
  text,
  rubric,
  lessonTitle: options.lessonTitle,
  goal: options.goal,
  locale: options.locale ?? 'en',
}, options.signal);

// --- Assessment insight (PersonalAssessmentView) -----------------------------------

export type PersonalityInsight = AIAdvice & { personalityType: string };

export const analyzePersonality = (
  scores: Big5Profile,
  options: { locale?: LlmLocale; signal?: AbortSignal } = {},
): Promise<PersonalityInsight> => postJson<PersonalityInsight>('/llm/personality-insight', {
  scores,
  locale: options.locale ?? 'ja',
}, options.signal);

// --- AI tutor (SSE) -----------------------------------------------------------------

export const TUTOR_EXCERPT_MAX = 1500;

export type TutorMode = 'explain' | 'socratic';

/** Same shape as AskTutorDetail (PLAN §9.1), plus optional history and locale. */
export interface TutorRequest {
  message: string;
  mode?: TutorMode;
  lesson?: { courseId: string; lessonId: string; title: string; objectives: string[]; level?: string };
  anchor?: { sectionId: string; blockId: string; blockType: string; excerpt: string; codeLang?: string; highlightedLines?: number[] };
  learner?: { attemptsOnBlock?: number; chosenOptionId?: string };
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Legacy free-text context ({ message, context } from glossary popovers). */
  context?: string;
  locale?: LlmLocale;
}

export interface TutorGrounding {
  sectionId: string;
  blockId: string;
}

export interface TutorMeta {
  mode: TutorMode;
  locale: LlmLocale;
  grounding: TutorGrounding | null;
}

export interface TutorDone extends TutorMeta {
  provider: string;
  model: string;
  text: string;
  /** The reply hit the output limit after `text`: a partial answer, not an error. */
  truncated?: boolean;
}

const clip = (value: string | undefined, max: number) => (value && value.length > max ? value.slice(0, max) : value);

/**
 * Stream an AI tutor answer. Resolves with the final answer; `onDelta` receives text as it
 * arrives. Rejects with LlmApiError on HTTP errors or an `error` event.
 */
export async function streamTutor(
  request: TutorRequest,
  handlers: { onDelta?: (text: string) => void; onMeta?: (meta: TutorMeta) => void; signal?: AbortSignal } = {},
): Promise<TutorDone> {
  const body: TutorRequest = {
    ...request,
    context: clip(request.context, TUTOR_EXCERPT_MAX),
    anchor: request.anchor ? { ...request.anchor, excerpt: clip(request.anchor.excerpt, TUTOR_EXCERPT_MAX) || '' } : undefined,
  };
  const res = await apiFetch('/llm/tutor', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Accept: 'text/event-stream' },
    signal: handlers.signal,
  });
  if (!res.ok) throw await readError(res);
  if (!res.body) throw new LlmApiError('Empty tutor stream', 502, 'empty_stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: TutorDone | null = null;

  /** Handles one SSE event; returns the final payload for `done`. */
  const handleEvent = (raw: string): TutorDone | null => {
    const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) return null;
    const payload = JSON.parse(dataLine.slice(5).trim());
    if (payload.type === 'text.delta' && typeof payload.text === 'string') handlers.onDelta?.(payload.text);
    else if (payload.type === 'meta') handlers.onMeta?.(payload as TutorMeta);
    else if (payload.type === 'error') throw new LlmApiError(payload.error || 'Tutor error', 502, payload.error_type);
    return payload.type === 'done' ? (payload as TutorDone) : null;
  };

  while (true) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (chunk.trim() && !chunk.startsWith(':')) done = handleEvent(chunk) ?? done;
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim() && !buffer.startsWith(':')) done = handleEvent(buffer) ?? done;
  if (!done) throw new LlmApiError('Tutor stream ended early', 502, 'incomplete_stream');
  return done;
}

// --- Status summary for settings screens ------------------------------------------------

export type LlmAvailability = 'checking' | 'live' | 'demo' | 'off' | 'unreachable';

/** One word for the UI: live (real provider), demo (mock answers), off (not configured). */
export const summarizeLlmStatus = (status: LlmStatus | null, failed = false): LlmAvailability => {
  if (failed) return 'unreachable';
  if (!status) return 'checking';
  if (status.mock) return 'demo';
  return status.ok ? 'live' : 'off';
};

const PROVIDER_LABELS: Record<string, string> = { anthropic: 'Claude', gemini: 'Gemini' };

/** Display name of the provider answering general requests, e.g. "Claude". */
export const primaryProviderLabel = (status: LlmStatus | null): string | null => {
  const provider = status?.tasks['tutor.chat']?.provider;
  return provider ? PROVIDER_LABELS[provider] ?? null : null;
};

/** Remove the Gemini key older builds stored in this browser (keys now live on the server only). */
export const clearLegacyBrowserKey = () => {
  try {
    window.localStorage.removeItem('rise-path.gemini_api_key');
  } catch {
    // storage unavailable: nothing to clear
  }
};
