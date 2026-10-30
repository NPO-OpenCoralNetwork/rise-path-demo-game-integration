// The learner's generated courses in the library: the course list, the profile's generated page,
// the course and lesson pages, and the dashboard. No imports, so node:test can check it
// (server/tests/generatedCoursesLibrary.test.js).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESUME_CARD_TYPES = new Set(['fresh_start', 'continue', 'gentle_return', 'recovery']);

/** The HTTP status and the body's error_type of an error the API calls throw (aiHttpError). */
const failureOf = (error: unknown): { status?: unknown; errorType?: unknown } => {
  if (typeof error !== 'object' || error === null) return {};
  const { status, body } = error as { status?: unknown; body?: unknown };
  const errorType = typeof body === 'object' && body !== null ? (body as { error_type?: unknown }).error_type : undefined;
  return { status, errorType };
};

/**
 * True for the error fetchGeneratedCourses and fetchGeneratedCourseById throw on a 401 (the API
 * could not confirm the sign-in): the view asks to sign in again (GeneratedCoursesSignInNotice).
 * Not for a deleted account: apiClient has already started ending that session and leaving the app.
 */
export const isSignInRequired = (error: unknown): boolean => {
  const { status, errorType } = failureOf(error);
  return status === 401 && errorType !== 'account_deleted';
};

/**
 * True for the error they throw on a 503 auth_unavailable: the API could not check the sign-in right
 * now (the auth provider did not answer). The session may be fine, so the view asks to try again
 * later (GeneratedCoursesUnavailableNotice), not to sign in again.
 */
export const isSignInUnavailable = (error: unknown): boolean => {
  const { status, errorType } = failureOf(error);
  return status === 503 && errorType === 'auth_unavailable';
};

/**
 * The course the dashboard shows insights for: the id the course page stored, only when it names
 * a generated course (a UUID). A demo course's id would only get 404s.
 */
export const activeCurriculumId = (stored: string | null | undefined): string | undefined =>
  typeof stored === 'string' && UUID_RE.test(stored) ? stored : undefined;

/**
 * The resume card in an answer of GET /api/v2/curricula/:id/resume, which sends the card's fields
 * at the top level next to ok: true (server/routes/chatgptCurriculum.js). Null when it holds none.
 */
export const parseResumeCard = <T extends { type: string; message: string }>(payload: unknown): T | null => {
  if (typeof payload !== 'object' || payload === null) return null;
  const { ok, ...card } = payload as Record<string, unknown>;
  if (ok !== true || typeof card.type !== 'string' || !RESUME_CARD_TYPES.has(card.type) || typeof card.message !== 'string') return null;
  return card as unknown as T;
};
