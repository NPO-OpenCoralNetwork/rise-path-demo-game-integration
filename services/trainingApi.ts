/**
 * The job-training section's API (doc/brushup-2026/training-plan.ja.md §4.2): GET /api/v2/training/me
 * (server/routes/training.js) through apiFetch (the primary Supabase session's Bearer token; a 401
 * account_deleted is reported by apiClient). Only components/features/training/ imports this file,
 * so it ships in the training chunk only (components/routes/lazyRoutes.tsx).
 *
 * Failures throw TrainingApiError { status, errorType }: status 0 for a network error; 404
 * training_off where the server's TRAINING_ENABLED is not "true" (an older server answers 404
 * too). A 200 whose body is not the documented shape throws 'bad_response'.
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

export class TrainingApiError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = 'TrainingApiError';
    this.status = status;
    this.errorType = errorType;
  }
}

const PATH = '/training/me';
const ROLES: readonly string[] = ['learner', 'instructor', 'examiner', 'staff'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

export async function getTrainingMe(signal?: AbortSignal): Promise<TrainingMe> {
  let res: Response;
  try {
    res = await apiFetch(PATH, { method: 'GET', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
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
    );
  }
  const parsed = parseTrainingMe(body);
  if (!parsed) throw new TrainingApiError('Unexpected response', res.status, 'bad_response');
  return parsed;
}
