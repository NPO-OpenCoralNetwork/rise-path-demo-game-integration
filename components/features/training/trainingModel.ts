import { TrainingApiError, type TrainingMe } from '../../../services/trainingApi';

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
