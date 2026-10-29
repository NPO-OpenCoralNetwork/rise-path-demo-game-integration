import { TrainingApiError, type TrainingMe } from '../../../services/trainingApi';

/** What /training shows (components/features/training/TrainingView.tsx). */
export type TrainingPageState =
  | { kind: 'loading' }
  | { kind: 'ready'; me: TrainingMe }
  /** No Rise Path account here (a demo guest, or the server's 401 sign_in_required). */
  | { kind: 'account' }
  /** The session was refused (expired, or the account was deleted): sign in again. */
  | { kind: 'signin' }
  /** This server does not offer training (404 training_off, or an older server). */
  | { kind: 'off' }
  | { kind: 'error' };

/** The page's state for a failed GET /api/v2/training/me. */
export function stateForFailure(error: unknown): TrainingPageState {
  if (error instanceof TrainingApiError) {
    if (error.status === 401) return error.errorType === 'sign_in_required' ? { kind: 'account' } : { kind: 'signin' };
    if (error.status === 404) return { kind: 'off' };
  }
  return { kind: 'error' };
}
