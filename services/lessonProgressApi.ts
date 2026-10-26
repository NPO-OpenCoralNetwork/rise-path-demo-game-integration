/**
 * The learner's lesson progress on the server (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6):
 * GET / PUT / DELETE /api/v2/user/lesson-progress and (Phase 5) POST …/lesson-reset
 * (server/routes/lessonProgress.js), through apiFetch (the primary Supabase session's Bearer
 * token). Only components/lesson/progressSyncClient.ts calls these; the sync rules live in
 * components/lesson/progressSync.ts. Records and rejections keep the fields the server adds
 * (Phase 5: lessonEpoch, lessonResetAt, a rejection's record): the core reads them per answer.
 *
 * Failures throw LessonProgressApiError { status, errorType, epoch? }: status 0 for a network
 * error, epoch on 409 progress_reset (the server's current reset epoch). A 404 without errorType
 * means this server has no such route (an older one).
 */
import { apiFetch } from './apiClient';

export type LessonProgressRecordOut = {
  courseSlug: string;
  lessonId: string;
  progress: unknown;
  pct?: number;
  state?: string;
  updatedAt?: string;
  /** Phase 5: the lesson's generation (null, null: never started over); an older server sends neither. */
  lessonEpoch?: string | null;
  lessonResetAt?: string | null;
};

/** lesson_reset (Phase 5) adds lessonEpoch, lessonResetAt and the stored record (when there is one). */
export type LessonProgressRejection = {
  courseSlug: string | null;
  lessonId: string | null;
  error_type: string;
  lessonEpoch?: string | null;
  lessonResetAt?: string | null;
  record?: LessonProgressRecordOut;
};

export type LessonProgressPutBody = {
  epoch: string | null;
  /** lessonEpoch (Phase 5): the generation the record's content builds on; an older server ignores it. */
  records: { courseSlug: string; lessonId: string; progress: unknown; lessonEpoch?: string | null }[];
};

/** What the server offers (GET capabilities, Phase 5; review: Phase 6); undefined from an older server. */
export type LessonProgressCapabilities = { lessonReset: boolean; achievements: boolean; review: boolean };

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecordOut = (item: unknown): item is LessonProgressRecordOut =>
  isRecord(item) && typeof item.courseSlug === 'string' && typeof item.lessonId === 'string';

function recordsOf(value: unknown): LessonProgressRecordOut[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecordOut);
}

function capabilitiesOf(value: unknown): LessonProgressCapabilities | undefined {
  if (!isRecord(value)) return undefined;
  return { lessonReset: value.lessonReset === true, achievements: value.achievements === true, review: value.review === true };
}

async function send(init: RequestInit, subPath = ''): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await apiFetch(PATH + subPath, init);
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

/**
 * Every stored lesson record of the learner, and the learner's reset epoch (null: never reset).
 * restarted: the account was deleted and opened again since (Phase 4; the server sends it only then).
 * capabilities (Phase 5): what the server offers; undefined from an older one.
 */
export async function getLessonProgressRecords(): Promise<{
  epoch: string | null;
  records: LessonProgressRecordOut[];
  restarted: boolean;
  capabilities?: LessonProgressCapabilities;
}> {
  const body = await send({ method: 'GET' });
  const capabilities = capabilitiesOf(body.capabilities);
  return {
    epoch: epochOf(body.epoch),
    records: recordsOf(body.records),
    restarted: body.restarted === true,
    ...(capabilities ? { capabilities } : {}),
  };
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
    ? body.rejected
      .filter((item): item is LessonProgressRejection => isRecord(item) && typeof item.error_type === 'string')
      .map((item) => {
        // A rejection's record (lesson_reset) is kept only in the shape of a record.
        const { record, ...rest } = item;
        return isRecordOut(record) ? { ...rest, record } : rest;
      })
    : [];
  return { epoch: epochOf(body.epoch), records: recordsOf(body.records), rejected };
}

/**
 * Starts one published lesson over (Phase 5, the reader's 「このレッスンを最初からやり直す」): its
 * record is emptied on the server and the lesson gets a new generation (lessonEpoch). The account
 * epoch is checked like PUT's (409 progress_reset). A POST to its own path, never DELETE: an
 * older server's DELETE ignores a query and deletes every course; this path is 404 there.
 */
export async function resetLessonProgressRecord(payload: { epoch: string | null; courseSlug: string; lessonId: string }): Promise<{
  epoch: string | null;
  lessonEpoch: string;
  lessonResetAt: string | null;
  record: LessonProgressRecordOut | null;
}> {
  const body = await send({ method: 'POST', body: JSON.stringify(payload) }, '/lesson-reset');
  const lessonEpoch = typeof body.lessonEpoch === 'string' && UUID.test(body.lessonEpoch) ? body.lessonEpoch : null;
  if (!lessonEpoch) throw new LessonProgressApiError('Unexpected response', 200, 'bad_response');
  const lessonResetAt = typeof body.lessonResetAt === 'string' && Number.isFinite(Date.parse(body.lessonResetAt)) ? body.lessonResetAt : null;
  return { epoch: epochOf(body.epoch), lessonEpoch, lessonResetAt, record: isRecordOut(body.record) ? body.record : null };
}

/** Deletes every lesson record of the learner (all courses, every device) and starts a new epoch. */
export async function deleteLessonProgressRecords(): Promise<{ deleted: number; epoch: string }> {
  const body = await send({ method: 'DELETE' });
  const epoch = epochOf(body.epoch);
  if (!epoch) throw new LessonProgressApiError('Unexpected response', 200, 'bad_response');
  return { deleted: Number(body.deleted) || 0, epoch };
}
