/**
 * The learner's lesson progress on the server (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6):
 * GET / PUT / DELETE /api/v2/user/lesson-progress (server/routes/lessonProgress.js), through
 * apiFetch (the primary Supabase session's Bearer token). Only components/lesson/progressSyncClient.ts
 * calls these; the sync rules live in components/lesson/progressSync.ts.
 *
 * Failures throw LessonProgressApiError { status, errorType, epoch? }: status 0 for a network
 * error, epoch on 409 progress_reset (the server's current reset epoch).
 */
import { apiFetch } from './apiClient';

export type LessonProgressRecordOut = {
  courseSlug: string;
  lessonId: string;
  progress: unknown;
  pct?: number;
  state?: string;
  updatedAt?: string;
};

export type LessonProgressRejection = { courseSlug: string | null; lessonId: string | null; error_type: string };

export type LessonProgressPutBody = {
  epoch: string | null;
  records: { courseSlug: string; lessonId: string; progress: unknown }[];
};

export class LessonProgressApiError extends Error {
  status: number;
  errorType?: string;
  epoch?: string | null;

  constructor(message: string, status: number, errorType?: string, epoch?: string | null) {
    super(message);
    this.name = 'LessonProgressApiError';
    this.status = status;
    this.errorType = errorType;
    if (epoch !== undefined) this.epoch = epoch;
  }
}

const PATH = '/user/lesson-progress';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const epochOf = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function recordsOf(value: unknown): LessonProgressRecordOut[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LessonProgressRecordOut =>
    isRecord(item) && typeof item.courseSlug === 'string' && typeof item.lessonId === 'string');
}

async function send(init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await apiFetch(PATH, init);
  } catch {
    throw new LessonProgressApiError('Network error', 0, 'network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (a proxy error page, or the request was cut off).
  }
  if (!res.ok) {
    const data = isRecord(body) ? body : {};
    throw new LessonProgressApiError(
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      res.status,
      typeof data.error_type === 'string' ? data.error_type : undefined,
      'epoch' in data ? epochOf(data.epoch) : undefined,
    );
  }
  if (!isRecord(body)) throw new LessonProgressApiError('Unexpected response', res.status, 'bad_response');
  return body;
}

/** Every stored lesson record of the learner, and the learner's reset epoch (null: never reset). */
export async function getLessonProgressRecords(): Promise<{ epoch: string | null; records: LessonProgressRecordOut[] }> {
  const body = await send({ method: 'GET' });
  return { epoch: epochOf(body.epoch), records: recordsOf(body.records) };
}

/**
 * Merges up to 25 records into the stored ones (the server merges; it never stores a record as
 * sent). `keepalive` lets the request finish after the page is hidden (body ≤ 64 KiB). `token`:
 * this access token instead of the session's; apiFetch then calls fetch before its first await
 * (the page-hide upload must start inside the event handler).
 */
export async function putLessonProgressRecords(
  payload: LessonProgressPutBody,
  { keepalive = false, token }: { keepalive?: boolean; token?: string } = {},
): Promise<{ epoch: string | null; records: LessonProgressRecordOut[]; rejected: LessonProgressRejection[] }> {
  const body = await send({
    method: 'PUT',
    body: JSON.stringify(payload),
    ...(keepalive ? { keepalive: true } : {}),
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  const rejected = Array.isArray(body.rejected)
    ? body.rejected.filter((item): item is LessonProgressRejection => isRecord(item) && typeof item.error_type === 'string')
    : [];
  return { epoch: epochOf(body.epoch), records: recordsOf(body.records), rejected };
}

/** Deletes every lesson record of the learner (all courses, every device) and starts a new epoch. */
export async function deleteLessonProgressRecords(): Promise<{ deleted: number; epoch: string }> {
  const body = await send({ method: 'DELETE' });
  const epoch = epochOf(body.epoch);
  if (!epoch) throw new LessonProgressApiError('Unexpected response', 200, 'bad_response');
  return { deleted: Number(body.deleted) || 0, epoch };
}
