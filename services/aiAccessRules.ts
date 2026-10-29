/**
 * Pure rules for the AI access UI (no network, no React), shared by services/aiAccessApi.ts and
 * its tests (server/tests/aiAccessFront.test.js). Phase 0.5 minor safeguards.
 */

/** Version of the guardian consent text. Must equal CONSENT_POLICY_VERSION in server/safety/access.js. */
export const CONSENT_POLICY_VERSION = 'guardian-ai-2026-10';

/** In-app page where a learner records their birth month and a guardian gives consent. */
export const AI_ACCESS_SETUP_PATH = '/settings/ai-access';
/** Public guide for children and guardians (open when signed out too). */
export const AI_SAFETY_PATH = '/ai-safety';
/** Admin page: safety counts, reports, paper consents. */
export const ADMIN_SAFETY_PATH = '/settings/admin/safety';

/** Window event fired after this browser changed the learner's access (age, consent). */
export const AI_ACCESS_CHANGE_EVENT = 'rp:ai-access-change';

export type AiAccessState = 'ready' | 'needs_age' | 'needs_guardian_consent' | 'paused';
export type AiAudience = 'adult' | 'minor';
export type GuardianRelationship = 'parent' | 'guardian' | 'other';
export type ConsentMethod = 'guardian_on_device' | 'staff_paper_form';

export interface AiAccessConsent {
  givenAt: string;
  method: ConsentMethod | string;
  relationship: GuardianRelationship | null;
}

export interface AiAccessStatus {
  status: AiAccessState;
  audience: AiAudience | null;
  /** 'YYYY-MM', or null when none is recorded. */
  birthYm: string | null;
  consent: AiAccessConsent | null;
  /** true until a birth month is recorded; after that only staff can correct it. */
  ageEditable: boolean;
  /** ISO time when a safety pause ends (next 00:00 Japan time). */
  pausedUntil?: string;
  policyVersion?: string;
}

/** Why the server refused an AI call, as the UI explains it. */
export type AiAccessErrorKind =
  | 'sign_in_required'
  | 'age_required'
  | 'guardian_consent_required'
  | 'ai_paused_safety'
  | 'adults_only';

const ACCESS_KINDS: ReadonlySet<string> = new Set<AiAccessErrorKind>([
  'sign_in_required',
  'age_required',
  'guardian_consent_required',
  'ai_paused_safety',
  'adults_only',
]);

export const typeOf = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const found = record.errorType ?? record.error_type;
  return typeof found === 'string' ? found : undefined;
};

/**
 * The access kind behind a refused AI call, or null when the error is something else. Reads
 * `errorType` or `error_type` on the error itself or on its `body` (LlmApiError, AiAccessApiError,
 * a parsed JSON body, …).
 */
export function aiAccessErrorKind(err: unknown): AiAccessErrorKind | null {
  const direct = typeOf(err);
  const fromBody = err && typeof err === 'object' ? typeOf((err as { body?: unknown }).body) : undefined;
  for (const candidate of [direct, fromBody]) {
    if (candidate && ACCESS_KINDS.has(candidate)) return candidate as AiAccessErrorKind;
  }
  return null;
}

// --- birth month helpers -----------------------------------------------------------------------

/** Current year and month in Japan time. */
export function tokyoYearMonth(now: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/** 'YYYY-MM' from a year and month (1–12). */
export const toBirthYm = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** 'YYYY-MM' → { year, month }, or null. */
export function splitBirthYm(ym: string | null | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(ym ?? '');
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** A valid birth month: 1900-01 up to the current month in Japan time. */
export function isValidBirthYm(ym: string, now: Date = new Date()): boolean {
  const parsed = splitBirthYm(ym);
  if (!parsed || parsed.month < 1 || parsed.month > 12 || parsed.year < 1900) return false;
  const current = tokyoYearMonth(now);
  return parsed.year < current.year || (parsed.year === current.year && parsed.month <= current.month);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUserId = (value: string) => UUID_PATTERN.test(value.trim());
