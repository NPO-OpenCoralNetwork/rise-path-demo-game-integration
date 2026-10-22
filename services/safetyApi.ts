/**
 * Reports on AI answers and the safety refusals the UI explains (Phase 0.5 minor safeguards,
 * doc/brushup-2026/ai-access-plan.ja.md §4).
 *
 * - reportAiAnswer(): POST /api/v2/safety/reports (server/routes/safety.js). Answers have no
 *   server id, so the report carries the text itself, clipped to the server's limits.
 * - aiRefusalOf(): why an AI call was refused, from the error the API helpers throw
 *   (LlmApiError, the curriculum generate error, …): the access gate (age, guardian consent, a
 *   safety pause, adults only, sign-in), the content screen (422 content_blocked with category and
 *   support) or a safety check that could not run (503 safety_check_unavailable).
 *   components/ui/AiNotice.tsx (AiRefusalNotice) renders it.
 */
import { apiFetch } from './apiClient';
import { aiAccessErrorKind, type AiAccessErrorKind } from './aiAccessApi';

export const REPORT_SURFACES = ['tutor', 'writing_feedback', 'assessment_insight', 'course_generation', 'generated_lesson', 'other'] as const;
export const REPORT_REASONS = ['harmful', 'wrong', 'inappropriate_for_age', 'other'] as const;

export type ReportSurface = (typeof REPORT_SURFACES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Where the answer was shown (each id ≤ 200 characters). */
export interface ReportContext {
  courseId?: string;
  lessonId?: string;
  blockId?: string;
}

export interface AiReportPayload {
  surface: ReportSurface;
  reason: ReportReason;
  /** The AI text being reported. */
  answer: string;
  /** What the learner asked, when there was a question. */
  question?: string;
  /** The learner's own words about the problem. */
  note?: string;
  context?: ReportContext;
}

/** The server's limits (server/routes/safety.js ReportRequest). */
export const REPORT_LIMITS = { answer: 4000, question: 2000, note: 500, contextId: 200 } as const;

/** An HTTP error from POST /safety/reports: 400 invalid_body, 401, 429 report_limit, 503 reports_unavailable. */
export class SafetyApiError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = 'SafetyApiError';
    this.status = status;
    this.errorType = errorType;
  }
}

const clip = (value: string | undefined, max: number): string | undefined => {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
};

const clipContext = (context: ReportContext | undefined): ReportContext | undefined => {
  if (!context) return undefined;
  const out: ReportContext = {};
  for (const key of ['courseId', 'lessonId', 'blockId'] as const) {
    const value = clip(context[key], REPORT_LIMITS.contextId);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
};

/** Sends a report on an AI answer. Resolves on 201; rejects with SafetyApiError. */
export async function reportAiAnswer(payload: AiReportPayload): Promise<{ ok: true }> {
  const answer = clip(payload.answer, REPORT_LIMITS.answer);
  if (!answer) throw new SafetyApiError('Nothing to report', 400, 'invalid_body');
  const body = {
    surface: payload.surface,
    reason: payload.reason,
    answer,
    question: clip(payload.question, REPORT_LIMITS.question),
    note: clip(payload.note, REPORT_LIMITS.note),
    context: clipContext(payload.context),
  };
  const res = await apiFetch('/safety/reports', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) ?? {};
    } catch {
      // not JSON: keep the status only
    }
    throw new SafetyApiError(
      typeof data.error === 'string' ? data.error : `Report failed (${res.status})`,
      res.status,
      typeof data.error_type === 'string' ? data.error_type : undefined,
    );
  }
  return { ok: true };
}

// --- refusals --------------------------------------------------------------------------------

export type AiRefusal =
  | { type: 'access'; kind: AiAccessErrorKind }
  | { type: 'blocked'; category: string | null; support: boolean }
  | { type: 'check_unavailable' };

export const CONTENT_BLOCKED = 'content_blocked';
export const SAFETY_CHECK_UNAVAILABLE = 'safety_check_unavailable';

const field = (value: unknown, ...names: string[]): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const name of names) if (record[name] !== undefined) return record[name];
  return undefined;
};

/** A field on the error itself, else on its parsed `body`. */
const read = (err: unknown, ...names: string[]): unknown => field(err, ...names) ?? field(field(err, 'body'), ...names);

/**
 * Why an AI call was refused for safety or access, or null for any other error (a daily cap, an
 * outage, a network failure…). Reads errorType/error_type, category and support on the error or
 * on its `body`.
 */
export function aiRefusalOf(err: unknown): AiRefusal | null {
  const kind = aiAccessErrorKind(err);
  if (kind) return { type: 'access', kind };
  const type = read(err, 'errorType', 'error_type');
  if (type === CONTENT_BLOCKED) {
    const category = read(err, 'category');
    const support = read(err, 'support');
    return { type: 'blocked', category: typeof category === 'string' ? category : null, support: support === true || support === 'yes' };
  }
  if (type === SAFETY_CHECK_UNAVAILABLE) return { type: 'check_unavailable' };
  return null;
}
