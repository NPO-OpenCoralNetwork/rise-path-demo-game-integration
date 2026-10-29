/**
 * Lesson progress in localStorage (PLAN §9.1 contract). Every learner's reader reads and writes
 * it here, synchronously; this file never talks to the network. For a learner signed in with the
 * primary Supabase client, progressSyncClient.ts (core: progressSync.ts) also keeps the published
 * lessons' records in step with /api/v2/user/lesson-progress (Phase 2): every writeProgress below
 * marks the lesson pending, and server data comes back merged into these same keys (never written
 * over them) as PROGRESS_EVENT { source: 'server' }. Guests, dev mock users and Nexloom-only
 * sessions keep their progress on this device only.
 * Every storage access is wrapped in try/catch: private mode, quota errors and corrupt JSON all
 * degrade to "no progress".
 *
 * Keys:
 * - `rp:progress:<courseSlug>:<lessonId>` → LessonProgress
 *     { v:1, seen, answers, checks, lastBlockId, updatedAt } plus the optional `editedAt` (last
 *     check or rating edit), `editedKeys` (last edit per check and per rating), `ratings`
 *     (self-rating per objective) and `summary` ({pct, state} at the last write, so course maps
 *     and the dashboard can show a status without loading the lesson). `answers` is keyed by
 *     `<blockId>/<questionId>` because one quiz block can hold several questions (see answerKey).
 *     Phase 5: the record may also hold `lessonGen` (LessonGen below), the lesson's generation the
 *     content builds on: { epoch, resetAt } when it builds on a generation the server named
 *     (epoch null: the lesson was never started over), { bornAt } when it started from nothing on
 *     this device before the generation was known. parseProgress drops it, so every reader of the
 *     record keeps working and it is never sent inside `progress`. Written by writeProgress (the
 *     reader passes its stamp) and by the sync core (progressSync.ts) when it stores server data.
 * - `rp:lastLesson` → LastLesson { courseSlug, lessonId, title, pct, at }
 * - `rp:progressSync:*` (not `rp:progress:`, so scans of the records skip them): whose progress
 *   this browser holds and the pending uploads (progressSync.ts).
 *
 * The pure `with*` helpers return a new object (or the same one when nothing changed), so React
 * state updates stay cheap. No React or DOM imports: server/tests imports this file directly.
 */

import { emptyProgress, parseProgress, ratingClockKey } from '../../shared/lesson/progress.js';
import type { AnswerRecord, LessonProgress, ProgressSummary, SelfRating } from '../../shared/lesson/progress.js';

// The record shape, its parser and the answer key live in shared/lesson/progress.js (the server
// progress API and the MCP course tools use the same code); re-exported here for the reader.
export { LESSON_STATES, PROGRESS_VERSION, answerKey, emptyProgress, parseProgress } from '../../shared/lesson/progress.js';
export type { AnswerRecord, LessonProgress, LessonStateName, ProgressSummary, SelfRating } from '../../shared/lesson/progress.js';

export const LAST_LESSON_KEY = 'rp:lastLesson';
/**
 * Fired on window after a progress write: detail = ProgressEventDetail. writeProgress (the
 * learner's own change) sends no source; the sync sends source 'server' after merging server data
 * into the stored record (open readers merge it in; course maps refresh).
 */
export const PROGRESS_EVENT = 'rp:progress-change';

/**
 * reset: the sync core stored this lesson's record after the learner started it over (Phase 5).
 * echo: the record is the server's answer to this tab's own save (a PUT it took, with no lesson
 * generation this tab did not know): no reset or delete-all came with it (those come back refused,
 * as a new epoch or as a new generation), so stores that only follow other tabs' and devices'
 * changes (the review count) skip it (Phase 6).
 */
export type ProgressEventDetail = { courseSlug: string; lessonId: string; source?: 'server'; reset?: true; echo?: true };

/**
 * A stored record's generation stamp (Phase 5, one-lesson reset). known: the content builds on
 * the generation the server named (epoch null: never started over; resetAt: when it last was,
 * server clock). born: the record started from nothing on this device before the generation was
 * known, and all its content was written here since bornAt (this device's clock). unknown: no
 * stamp (an older bundle, a test or the dev gallery wrote it).
 */
export type LessonGen =
  | { kind: 'known'; epoch: string | null; resetAt: string | null }
  | { kind: 'born'; bornAt: string }
  | { kind: 'unknown' };
/** A lesson's generation as the server reported it (GET, PUT, a lesson_reset rejection, the reset). */
export type ServerGen = { epoch: string | null; resetAt: string | null };

const UNKNOWN_GEN: LessonGen = Object.freeze({ kind: 'unknown' }) as LessonGen;
const GEN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDateText = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** The stamp of a stored record (raw JSON); unknown for null, a parse error or no valid lessonGen. */
export function lessonGenOf(raw: string | null | undefined): LessonGen {
  if (!raw) return UNKNOWN_GEN;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return UNKNOWN_GEN;
  }
  if (!isRecord(data) || !isRecord(data.lessonGen)) return UNKNOWN_GEN;
  const gen = data.lessonGen;
  const hasEpoch = Object.prototype.hasOwnProperty.call(gen, 'epoch');
  const hasBorn = Object.prototype.hasOwnProperty.call(gen, 'bornAt');
  if (hasEpoch && !hasBorn) {
    const { epoch, resetAt } = gen;
    if (!(epoch === null || (typeof epoch === 'string' && GEN_UUID.test(epoch)))) return UNKNOWN_GEN;
    if (resetAt !== undefined && resetAt !== null && !isDateText(resetAt)) return UNKNOWN_GEN;
    return { kind: 'known', epoch: typeof epoch === 'string' ? epoch.toLowerCase() : null, resetAt: isDateText(resetAt) ? resetAt : null };
  }
  if (hasBorn && !hasEpoch && isDateText(gen.bornAt)) return { kind: 'born', bornAt: gen.bornAt };
  return UNKNOWN_GEN;
}

export function readLessonGen(courseSlug: string, lessonId: string, storage: StorageLike | null = defaultStorage()): LessonGen {
  if (!storage) return UNKNOWN_GEN;
  try {
    return lessonGenOf(storage.getItem(progressKey(courseSlug, lessonId)));
  } catch {
    return UNKNOWN_GEN;
  }
}

export function sameLessonGen(a: LessonGen, b: LessonGen): boolean {
  if (a.kind === 'known' && b.kind === 'known') return a.epoch === b.epoch && a.resetAt === b.resetAt;
  if (a.kind === 'born' && b.kind === 'born') return a.bornAt === b.bornAt;
  return a.kind === 'unknown' && b.kind === 'unknown';
}

/**
 * A record born on this device after the lesson's last reset holds no older content: all of it
 * was written since bornAt. Unparsable times never survive a reset.
 */
export function bornSurvives(bornAt: string, server: ServerGen): boolean {
  if (server.epoch === null) return true; // never started over: nothing to protect
  const born = Date.parse(bornAt);
  const reset = Date.parse(server.resetAt ?? '');
  return Number.isFinite(born) && Number.isFinite(reset) && born > reset;
}

/** The sync core: keep the stored record (merge it into the server's) or drop it. */
export function keepsLocal(local: LessonGen, server: ServerGen): boolean {
  if (local.kind === 'known') return local.epoch === server.epoch;
  if (local.kind === 'born') return bornSurvives(local.bornAt, server);
  return server.epoch === null; // legacy content: only where no reset happened
}

/** The record as stored: known and born stamps go into `lessonGen`; unknown stores it plain. */
export function stampedRecord(progress: LessonProgress, gen?: LessonGen): LessonProgress & { lessonGen?: unknown } {
  const { lessonGen: _drop, ...plain } = progress as LessonProgress & { lessonGen?: unknown };
  if (gen?.kind === 'known') return { ...plain, lessonGen: { epoch: gen.epoch, resetAt: gen.resetAt } };
  if (gen?.kind === 'born') return { ...plain, lessonGen: { bornAt: gen.bornAt } };
  return plain;
}

export type LastLesson = {
  courseSlug: string;
  lessonId: string;
  title: string;
  /** 0–100. */
  pct: number;
  /** ISO timestamp. */
  at: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function progressKey(courseSlug: string, lessonId: string): string {
  return `rp:progress:${courseSlug}:${lessonId}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Stores the pct/state snapshot without touching updatedAt (it is derived data). */
export function withSummary(p: LessonProgress, summary: ProgressSummary): LessonProgress {
  if (p.summary?.pct === summary.pct && p.summary.state === summary.state) return p;
  return { ...p, summary: { pct: summary.pct, state: summary.state } };
}

const touch = (p: LessonProgress, patch: Partial<LessonProgress>): LessonProgress => ({
  ...p,
  ...patch,
  updatedAt: new Date().toISOString(),
});

/**
 * touch() for a learner's own edit of a check or a rating: also moves `editedAt` and the edited
 * key's own time in `editedKeys` (`clockKey`: the check key, or ratingClockKey(objectiveId)), the
 * clocks the cross-device merge uses for those keys. Passive seen/resume writes must not win over
 * them, and an edit of one key must not win for keys this device did not touch.
 */
const edit = (p: LessonProgress, patch: Partial<LessonProgress>, clockKey: string): LessonProgress => {
  const now = new Date().toISOString();
  return { ...p, ...patch, updatedAt: now, editedAt: now, editedKeys: { ...p.editedKeys, [clockKey]: now } };
};

export function withSeen(p: LessonProgress, blockIds: readonly string[]): LessonProgress {
  const fresh = blockIds.filter((id) => !p.seen.includes(id));
  if (!fresh.length) return p;
  return touch(p, { seen: [...p.seen, ...new Set(fresh)] });
}

/**
 * Records one submission. `correct` grades it; `revealed` marks that the answer is now shown.
 * Predictions (ungraded) keep their real correctness; any submission counts as answered.
 * shared/lesson/grading.js applySubmission applies the same rules on the server.
 */
export function withAnswer(
  p: LessonProgress,
  key: string,
  submission: { chosen: readonly string[]; correct: boolean; revealed?: boolean },
): LessonProgress {
  const prev = p.answers[key];
  const attempts = (prev?.attempts ?? 0) + 1;
  const record: AnswerRecord = {
    attempts,
    correct: submission.correct,
    chosen: [...submission.chosen],
    firstTry: prev ? prev.firstTry : submission.correct,
    ...((submission.revealed || prev?.revealed) ? { revealed: true } : {}),
  };
  return touch(p, { answers: { ...p.answers, [key]: record } });
}

/** Marks an answer as revealed without counting a submission ("show answer"). */
export function withRevealed(p: LessonProgress, key: string): LessonProgress {
  const prev = p.answers[key];
  if (prev?.revealed) return p;
  const record: AnswerRecord = prev
    ? { ...prev, revealed: true }
    : { attempts: 0, correct: false, chosen: [], firstTry: false, revealed: true };
  return touch(p, { answers: { ...p.answers, [key]: record } });
}

export function withCheck(p: LessonProgress, id: string, value: boolean): LessonProgress {
  if (p.checks[id] === value) return p;
  return edit(p, { checks: { ...p.checks, [id]: value } }, id);
}

export function withRating(p: LessonProgress, objectiveId: string, rating: SelfRating): LessonProgress {
  if (p.ratings?.[objectiveId] === rating) return p;
  return edit(p, { ratings: { ...(p.ratings ?? {}), [objectiveId]: rating } }, ratingClockKey(objectiveId));
}

export function withLastBlock(p: LessonProgress, blockId: string | null): LessonProgress {
  if (p.lastBlockId === blockId) return p;
  return touch(p, { lastBlockId: blockId });
}

// --- Storage --------------------------------------------------------------------------------

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readProgress(courseSlug: string, lessonId: string, storage: StorageLike | null = defaultStorage()): LessonProgress {
  if (!storage) return emptyProgress();
  try {
    return parseProgress(storage.getItem(progressKey(courseSlug, lessonId)));
  } catch {
    return emptyProgress();
  }
}

/**
 * The learner's own write. `gen`: the reader's stamp (known or born is stored in `lessonGen`);
 * without one the record is stored unstamped ("unknown"), the side that can never undo a reset.
 */
export function writeProgress(
  courseSlug: string,
  lessonId: string,
  progress: LessonProgress,
  storage: StorageLike | null = defaultStorage(),
  gen?: LessonGen,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(progressKey(courseSlug, lessonId), JSON.stringify(stampedRecord(progress, gen)));
  } catch {
    return false;
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail: { courseSlug, lessonId } }));
    } catch {
      // CustomEvent missing (very old runtimes): the write itself succeeded.
    }
  }
  return true;
}

/**
 * Status of a lesson without loading it: the snapshot from its last progress write, or null
 * when the learner never opened it. Course maps and the dashboard use this.
 */
export function readLessonSummary(
  courseSlug: string,
  lessonId: string,
  storage: StorageLike | null = defaultStorage(),
): (ProgressSummary & { updatedAt: string; lastBlockId: string | null }) | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(progressKey(courseSlug, lessonId));
  } catch {
    return null;
  }
  if (!raw) return null;
  const progress = parseProgress(raw);
  const touched = progress.seen.length > 0 || Object.keys(progress.answers).length > 0;
  const summary = progress.summary ?? (touched ? { pct: 0, state: 'in_progress' as const } : null);
  if (!summary) return null;
  return { ...summary, updatedAt: progress.updatedAt, lastBlockId: progress.lastBlockId };
}

export function clearProgress(courseSlug: string, lessonId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(progressKey(courseSlug, lessonId));
  } catch {
    // ignore
  }
}

export function parseLastLesson(raw: string | null | undefined): LastLesson | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return null;
    const { courseSlug, lessonId, title, pct, at } = data;
    if (typeof courseSlug !== 'string' || !courseSlug || typeof lessonId !== 'string' || !lessonId) return null;
    const percent = Number(pct);
    return {
      courseSlug,
      lessonId,
      title: typeof title === 'string' ? title : '',
      pct: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
      at: typeof at === 'string' ? at : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** The lesson the learner read most recently (for "続きから" on the dashboard), or null. */
export function getLastLesson(storage: StorageLike | null = defaultStorage()): LastLesson | null {
  if (!storage) return null;
  try {
    return parseLastLesson(storage.getItem(LAST_LESSON_KEY));
  } catch {
    return null;
  }
}

export function setLastLesson(record: Omit<LastLesson, 'at'> & { at?: string }, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const value: LastLesson = {
    courseSlug: record.courseSlug,
    lessonId: record.lessonId,
    title: record.title,
    pct: Math.max(0, Math.min(100, Math.round(record.pct))),
    at: record.at ?? new Date().toISOString(),
  };
  try {
    storage.setItem(LAST_LESSON_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}
