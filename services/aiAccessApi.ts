/**
 * The learner's AI access (Phase 0.5 minor safeguards, doc/brushup-2026/ai-access-plan.ja.md §4).
 *
 * The server decides who may use AI (server/safety/access.js); this module only reads and writes
 * through its routes:
 *   - /api/v2/user/ai-access   the signed-in learner (server/routes/aiAccess.js)
 *   - /api/v2/admin/…          admins only (server/routes/adminSafety.js)
 *
 * aiAccessErrorKind() turns a refused AI call (401/403 from server/middleware/aiAccessGate.js)
 * into the kind the UI shows with components/safety/AiAccessRequired.
 */
import { apiFetch } from './apiClient';
import { typeOf, type AiAccessErrorKind, type AiAccessStatus, type GuardianRelationship, CONSENT_POLICY_VERSION, AI_ACCESS_CHANGE_EVENT } from './aiAccessRules';

export * from './aiAccessRules';

/** An HTTP error from these routes, with the server's error_type. */
export class AiAccessApiError extends Error {
  status: number;
  errorType?: string;
  body?: unknown;

  constructor(message: string, status: number, errorType?: string, body?: unknown) {
    super(message);
    this.name = 'AiAccessApiError';
    this.status = status;
    this.errorType = errorType;
    this.body = body;
  }
}

const readJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await readJson(res);
  if (!res.ok) {
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const message = typeof record.error === 'string' ? record.error : `Request failed (${res.status})`;
    throw new AiAccessApiError(message, res.status, typeOf(record), body);
  }
  return body as T;
}

const send = <T>(path: string, method: 'POST' | 'PUT', payload?: unknown) =>
  request<T>(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });

const announce = (status: AiAccessStatus) => {
  try {
    window.dispatchEvent(new CustomEvent(AI_ACCESS_CHANGE_EVENT, { detail: status }));
  } catch {
    // No window (tests) or CustomEvent blocked: nothing listens then.
  }
  return status;
};

// --- the learner -------------------------------------------------------------------------------

export function getAiAccess(signal?: AbortSignal): Promise<AiAccessStatus> {
  return request<AiAccessStatus>('/user/ai-access', { signal });
}

/** Records the birth year and month ('YYYY-MM') once. 409 age_already_set afterwards. */
export async function setBirthYm(ym: string): Promise<AiAccessStatus> {
  return announce(await send<AiAccessStatus>('/user/ai-access/age', 'PUT', { birthYm: ym }));
}

/** A guardian agrees on this device (method guardian_on_device). */
export async function giveGuardianConsent({ relationship }: { relationship: GuardianRelationship }): Promise<AiAccessStatus> {
  return announce(
    await send<AiAccessStatus>('/user/ai-access/guardian-consent', 'POST', {
      relationship,
      agree: true,
      policyVersion: CONSENT_POLICY_VERSION,
    }),
  );
}

export async function revokeGuardianConsent(): Promise<AiAccessStatus> {
  return announce(await send<AiAccessStatus>('/user/ai-access/guardian-consent/revoke', 'POST'));
}

// --- admin -------------------------------------------------------------------------------------

export type SafetyEventKind = 'input_blocked' | 'output_blocked' | 'user_report' | 'support_shown' | 'check_failed';

export interface SafetySummary {
  days: number;
  totals: Partial<Record<SafetyEventKind, number>> & Record<string, number>;
  groups: Array<{ kind: string; category: string | null; surface: string; audience: string | null; count: number }>;
  byDay: Array<{ day: string; kind: string; count: number }>;
  openReports: number;
}

export interface SafetyReport {
  id: string;
  createdAt: string | null;
  userId: string | null;
  audience: string | null;
  surface: string;
  reason: string | null;
  answer: string | null;
  question: string | null;
  note: string | null;
  context: { courseId?: string; lessonId?: string; blockId?: string } | null;
  /** Text older than 90 days has been cleared. */
  textCleared: boolean;
  status: 'open' | 'reviewed';
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export type ReportStatusFilter = 'open' | 'reviewed' | 'all';

export interface AdminUserAiAccess extends AiAccessStatus {
  userId: string;
  recentEvents?: Partial<Record<SafetyEventKind, number>>;
}

const enc = encodeURIComponent;

export function getSafetySummary(days = 30, signal?: AbortSignal): Promise<SafetySummary> {
  return request<SafetySummary>(`/admin/safety/summary?days=${enc(String(days))}`, { signal });
}

export async function listSafetyReports(status: ReportStatusFilter = 'open', signal?: AbortSignal): Promise<SafetyReport[]> {
  const data = await request<{ reports: SafetyReport[] }>(`/admin/safety/reports?status=${enc(status)}`, { signal });
  return Array.isArray(data?.reports) ? data.reports : [];
}

export function markReportReviewed(id: string): Promise<{ ok: true; id: string; reviewedAt: string | null }> {
  return send(`/admin/safety/reports/${enc(id)}/review`, 'POST');
}

export function adminGetUserAiAccess(userId: string, signal?: AbortSignal): Promise<AdminUserAiAccess> {
  return request<AdminUserAiAccess>(`/admin/users/${enc(userId)}/ai-access`, { signal });
}

export function adminSetBirthYm(userId: string, birthYm: string, declaredBy: 'guardian' | 'staff'): Promise<AdminUserAiAccess> {
  return send<AdminUserAiAccess>(`/admin/users/${enc(userId)}/age`, 'PUT', { birthYm, declaredBy });
}

/** Records a guardian's paper consent form (method staff_paper_form, recorded_by = this admin). */
export function adminRecordPaperConsent(userId: string, relationship: GuardianRelationship): Promise<AdminUserAiAccess> {
  return send<AdminUserAiAccess>(`/admin/users/${enc(userId)}/guardian-consent`, 'POST', { relationship });
}

export function adminRevokeConsent(userId: string): Promise<AdminUserAiAccess> {
  return send<AdminUserAiAccess>(`/admin/users/${enc(userId)}/guardian-consent/revoke`, 'POST');
}
