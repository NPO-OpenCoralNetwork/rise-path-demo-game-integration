/**
 * The job-training section's API (doc/brushup-2026/training-plan.ja.md §4.2, §4.9) through apiFetch
 * (the primary Supabase session's Bearer token, or the one a caller passes; a 401 account_deleted is
 * reported by apiClient). Only components/features/training/ imports this file, so it ships in the
 * training chunk only (components/routes/lazyRoutes.tsx).
 * - GET /api/v2/training/me (server/routes/training.js): the learner's cohorts and roles.
 * - GET /api/v2/training/cohorts/:cohortId/time and POST …/time/signals (server/routes/trainingTime.js):
 *   the learner's study time, and the study page's signals.
 *
 * Failures throw TrainingApiError { status, errorType, retryAfterMs }: status 0 for a network error;
 * 404 training_off where the server's TRAINING_ENABLED is not "true" (an older server answers 404
 * too); retryAfterMs from a 429's or 503's Retry-After (seconds). A 200 whose body is not the
 * documented shape throws 'bad_response'.
 */
import { apiFetch } from './apiClient';

/** The roles of a membership (tools/core/training.js TRAINING_ROLES, migration 021's CHECK). */
export type TrainingRole = 'learner' | 'instructor' | 'examiner' | 'staff';
/** role null: a role this page does not know yet (a newer server); the cohort is still listed. */
export type TrainingCohort = { cohortId: string; name: string; role: TrainingRole | null };
export type TrainingMe = {
  /** The learner the server answered for (lower case). */
  learnerId: string;
  cohorts: TrainingCohort[];
};

/** Why a page's time is not counting (shared/training/studyTime.js studyReason); 'unknown': a reason this page does not know yet. */
export type StudyReason = 'not_in_session' | 'cap_reached' | 'starting' | 'gap' | 'focus' | 'idle' | 'other_tab' | 'unknown';
export type StudyUnitTime = { unitKey: string; title: { jp: string; en: string }; setMs: number; countedMs: number; capReached: boolean };
export type StudyDay = { day: string; countedMs: number; final: boolean };
/** GET …/time: the learner's study time in a cohort, as of the server's one clock reading (asOf). */
export type StudyTime = {
  learnerId: string;
  cohortId: string;
  /** Today in Japan time (YYYY-MM-DD). */
  today: string;
  status: 'ready' | 'not_configured' | 'not_in_session';
  /** The signals' interval while the cohort is in session (ready), else null. */
  beatMs: number | null;
  units: StudyUnitTime[];
  /** The newest days first (at most 14); final: closed. */
  days: StudyDay[];
  totalMs: number;
  asOf: string;
};
/** The study page's signal: exactly these six keys (the server refuses any other, and any time). */
export type StudySignalBody = { unitKey: string; chainId: string; seq: number; stop: boolean; focus: boolean; input: boolean };
export type StudySignalState = {
  counting: boolean;
  reason: StudyReason | null;
  todayMs: number;
  unit: { unitKey: string; countedMs: number; setMs: number; capReached: boolean };
};
/**
 * A signal's 200: stored (accepted, with the state as of its clock; null for a stop, or when it
 * could not be computed), or not stored with the reason (duplicate, chain_ended, not_open, restart,
 * too_soon, other_place, or one this page does not know). nextInMs: the next signal of the chain
 * after this many ms, or null: the page sends no more signals of that chain, not even a stop.
 */
export type StudySignalAnswer =
  | { accepted: true; nextInMs: number | null; state: StudySignalState | null }
  | { accepted: false; reason: string; nextInMs: number | null };

export class TrainingApiError extends Error {
  status: number;
  errorType?: string;
  /** From a 429's or a 503's Retry-After header (whole seconds), when it had one. */
  retryAfterMs?: number;

  constructor(message: string, status: number, errorType?: string, retryAfterMs?: number) {
    super(message);
    this.name = 'TrainingApiError';
    this.status = status;
    this.errorType = errorType;
    this.retryAfterMs = retryAfterMs;
  }
}

const PATH = '/training/me';
/** The study time paths' prefix: CI greps a flag-off build for it (.github/workflows/ci.yml). */
const COHORTS_PATH = '/training/cohorts/';
const ROLES: readonly string[] = ['learner', 'instructor', 'examiner', 'staff'];
const REASONS: readonly string[] = ['not_in_session', 'cap_reached', 'starting', 'gap', 'focus', 'idle', 'other_tab'];
const STATUSES: readonly string[] = ['ready', 'not_configured', 'not_in_session'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** A whole number of ms, 0 or more. */
const isMs = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** nextInMs and beatMs: a positive whole number of ms. */
const isInterval = (value: unknown): value is number => isMs(value) && value > 0;
const studyReason = (value: unknown): StudyReason | null =>
  value === null ? null : (REASONS.includes(String(value)) ? (value as StudyReason) : 'unknown');

/** The documented 200 body, or null. A cohort with a role this page does not know keeps role null. */
export function parseTrainingMe(body: unknown): TrainingMe | null {
  if (!isRecord(body) || typeof body.learnerId !== 'string' || !body.learnerId || !Array.isArray(body.cohorts)) return null;
  const cohorts: TrainingCohort[] = [];
  for (const item of body.cohorts) {
    if (!isRecord(item) || typeof item.cohortId !== 'string' || !item.cohortId || typeof item.name !== 'string' || typeof item.role !== 'string') return null;
    cohorts.push({ cohortId: item.cohortId, name: item.name, role: ROLES.includes(item.role) ? (item.role as TrainingRole) : null });
  }
  return { learnerId: body.learnerId.toLowerCase(), cohorts };
}

/** GET …/time's documented 200 body, or null. */
export function parseStudyTime(body: unknown): StudyTime | null {
  if (!isRecord(body) || typeof body.learnerId !== 'string' || !body.learnerId || typeof body.cohortId !== 'string' || !body.cohortId) return null;
  if (typeof body.today !== 'string' || !DAY_RE.test(body.today) || !STATUSES.includes(String(body.status))) return null;
  const status = body.status as StudyTime['status'];
  if (status === 'ready' ? !isInterval(body.beatMs) : body.beatMs !== undefined) return null;
  if (!Array.isArray(body.units) || !Array.isArray(body.days) || !isMs(body.totalMs) || typeof body.asOf !== 'string') return null;
  const units: StudyUnitTime[] = [];
  for (const u of body.units) {
    if (!isRecord(u) || typeof u.unitKey !== 'string' || !u.unitKey || !isRecord(u.title) || typeof u.title.jp !== 'string' || typeof u.title.en !== 'string') return null;
    if (!isMs(u.setMs) || !isMs(u.countedMs) || typeof u.capReached !== 'boolean') return null;
    units.push({ unitKey: u.unitKey, title: { jp: u.title.jp, en: u.title.en }, setMs: u.setMs, countedMs: u.countedMs, capReached: u.capReached });
  }
  const days: StudyDay[] = [];
  for (const d of body.days) {
    if (!isRecord(d) || typeof d.day !== 'string' || !DAY_RE.test(d.day) || !isMs(d.countedMs) || typeof d.final !== 'boolean') return null;
    days.push({ day: d.day, countedMs: d.countedMs, final: d.final });
  }
  return {
    learnerId: body.learnerId.toLowerCase(),
    cohortId: body.cohortId.toLowerCase(),
    today: body.today,
    status,
    beatMs: status === 'ready' ? (body.beatMs as number) : null,
    units,
    days,
    totalMs: body.totalMs,
    asOf: body.asOf,
  };
}

/** A signal's documented 200 body, or null. */
export function parseSignalAnswer(body: unknown): StudySignalAnswer | null {
  if (!isRecord(body)) return null;
  const nextInMs = body.nextInMs === null ? null : (isInterval(body.nextInMs) ? body.nextInMs : undefined);
  if (nextInMs === undefined) return null;
  if (body.accepted === false) {
    return typeof body.reason === 'string' && body.reason ? { accepted: false, reason: body.reason, nextInMs } : null;
  }
  if (body.accepted !== true) return null;
  if (body.state === null) return { accepted: true, nextInMs, state: null };
  const s = body.state;
  if (!isRecord(s) || typeof s.counting !== 'boolean' || !isMs(s.todayMs) || !isRecord(s.unit)) return null;
  if (s.reason !== null && typeof s.reason !== 'string') return null;
  const u = s.unit;
  if (typeof u.unitKey !== 'string' || !u.unitKey || !isMs(u.countedMs) || !isMs(u.setMs) || typeof u.capReached !== 'boolean') return null;
  return {
    accepted: true,
    nextInMs,
    state: { counting: s.counting, reason: studyReason(s.reason), todayMs: s.todayMs, unit: { unitKey: u.unitKey, countedMs: u.countedMs, setMs: u.setMs, capReached: u.capReached } },
  };
}

/** Retry-After in whole seconds as ms, or undefined (absent, a date, or not a number). */
function retryAfterOf(res: Response): number | undefined {
  const value = res.headers.get('Retry-After');
  return value !== null && /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) * 1000 : undefined;
}

/** One request: the parsed 200 body, or a TrainingApiError (an abort rethrows as it is). */
async function request<T>(path: string, init: RequestInit, parse: (body: unknown) => T | null): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new TrainingApiError('Network error', 0, 'network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: an older server's HTML 404, or a proxy page.
  }
  if (!res.ok) {
    const data = isRecord(body) ? body : {};
    throw new TrainingApiError(
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      res.status,
      typeof data.error_type === 'string' ? data.error_type : undefined,
      res.status === 429 || res.status === 503 ? retryAfterOf(res) : undefined,
    );
  }
  const parsed = parse(body);
  if (parsed === null) throw new TrainingApiError('Unexpected response', res.status, 'bad_response');
  return parsed;
}

export async function getTrainingMe(signal?: AbortSignal): Promise<TrainingMe> {
  return request(PATH, { method: 'GET', signal }, parseTrainingMe);
}

/** GET /api/v2/training/cohorts/:cohortId/time. */
export async function getStudyTime(cohortId: string, signal?: AbortSignal): Promise<StudyTime> {
  return request(`${COHORTS_PATH}${encodeURIComponent(cohortId)}/time`, { method: 'GET', signal }, parseStudyTime);
}

/**
 * POST /api/v2/training/cohorts/:cohortId/time/signals. keepalive with `token` (the learner's own
 * last session token): the page-hide stop, whose fetch must start before any await (apiFetch skips
 * its getSession when the caller sets Authorization).
 */
export async function postStudySignal(
  cohortId: string,
  body: StudySignalBody,
  options: { keepalive?: boolean; token?: string | null; signal?: AbortSignal } = {},
): Promise<StudySignalAnswer> {
  const signal: StudySignalBody = { unitKey: body.unitKey, chainId: body.chainId, seq: body.seq, stop: body.stop, focus: body.focus, input: body.input };
  return request(`${COHORTS_PATH}${encodeURIComponent(cohortId)}/time/signals`, {
    method: 'POST',
    body: JSON.stringify(signal),
    keepalive: options.keepalive === true,
    signal: options.signal,
    ...(options.token ? { headers: { Authorization: `Bearer ${options.token}` } } : {}),
  }, parseSignalAnswer);
}
