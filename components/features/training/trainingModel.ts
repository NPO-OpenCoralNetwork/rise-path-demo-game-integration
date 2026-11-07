import { TrainingApiError, type StudyTime, type TrainingMe } from '../../../services/trainingApi';
import type { StudyNumbers } from './studyTimeCore';

/** What /training shows (components/features/training/TrainingView.tsx). */
export type TrainingPageState =
  | { kind: 'loading' }
  | { kind: 'ready'; me: TrainingMe }
  /** No Rise Path account here (a demo guest, or the server's 401 sign_in_required). */
  | { kind: 'account' }
  /** The session was refused (expired or invalid): sign in again. */
  | { kind: 'signin' }
  /** 401 account_deleted: apiClient already ends this session (AuthContext), so no sign-in button. */
  | { kind: 'deleted' }
  /** This server does not offer training (404 training_off, or an older server). */
  | { kind: 'off' }
  | { kind: 'error' };

/**
 * The page's state for a 200. An answer for another learner (another tab switched the browser's
 * session while this one still shows the old account) is never shown; the account change reloads.
 */
export function stateForAnswer(me: TrainingMe, learnerId: string): TrainingPageState {
  return me.learnerId === learnerId.toLowerCase() ? { kind: 'ready', me } : { kind: 'error' };
}

/** The page's state for a failed GET /api/v2/training/me. */
export function stateForFailure(error: unknown): TrainingPageState {
  if (error instanceof TrainingApiError) {
    if (error.status === 401) {
      if (error.errorType === 'sign_in_required') return { kind: 'account' };
      return error.errorType === 'account_deleted' ? { kind: 'deleted' } : { kind: 'signin' };
    }
    if (error.status === 404) return { kind: 'off' };
  }
  return { kind: 'error' };
}

/** What a study time page shows (CohortTimeView, UnitTimeView: GET /api/v2/training/cohorts/:cohortId/time). */
export type StudyTimePageState =
  | { kind: 'loading' }
  | { kind: 'ready'; time: StudyTime }
  | { kind: 'account' }
  | { kind: 'signin' }
  | { kind: 'deleted' }
  | { kind: 'off' }
  /** 404 cohort_not_found: no such class, or the learner is not in it (not told apart). */
  | { kind: 'not_found' }
  /** 403 not_a_learner: another role in the class. */
  | { kind: 'not_learner' }
  | { kind: 'error' };

/** A 200 for this learner and this class only (another tab may have switched the account). */
export function studyTimeForAnswer(time: StudyTime, learnerId: string, cohortId: string): StudyTimePageState {
  return time.learnerId === learnerId.toLowerCase() && time.cohortId === cohortId.toLowerCase() ? { kind: 'ready', time } : { kind: 'error' };
}

/** The page's state for a failed GET …/time. Any other 404 (an older server without the route) is "not offered". */
export function studyTimeForFailure(error: unknown): StudyTimePageState {
  if (error instanceof TrainingApiError) {
    if (error.status === 401) {
      if (error.errorType === 'sign_in_required') return { kind: 'account' };
      return error.errorType === 'account_deleted' ? { kind: 'deleted' } : { kind: 'signin' };
    }
    // Another 403 (terms_required: the terms check, server/middleware/termsGate.js) is a failure to read again.
    if (error.status === 403 && error.errorType === 'not_a_learner') return { kind: 'not_learner' };
    if (error.status === 404) return error.errorType === 'cohort_not_found' ? { kind: 'not_found' } : { kind: 'off' };
  }
  return { kind: 'error' };
}

/** The unit page's numbers before its first signal: today's time and the unit's (null: the unit is not listed today). */
export function initialNumbers(time: StudyTime, unitKey: string): StudyNumbers | null {
  const unit = time.units.find((u) => u.unitKey === unitKey);
  if (!unit) return null;
  const todayMs = time.days.find((d) => d.day === time.today)?.countedMs ?? 0;
  return { todayMs, unit: { unitKey, countedMs: unit.countedMs, setMs: unit.setMs, capReached: unit.capReached } };
}
