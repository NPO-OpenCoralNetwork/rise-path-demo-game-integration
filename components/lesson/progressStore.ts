/**
 * Lesson progress in localStorage (PLAN §9.1 contract). Guests and signed-in learners both use
 * it until `/api/v2/user/progress` exists (Phase 2). Every storage access is wrapped in
 * try/catch: private mode, quota errors and corrupt JSON all degrade to "no progress".
 *
 * Keys:
 * - `rp:progress:<courseSlug>:<lessonId>` → LessonProgress
 *     { v:1, seen, answers, checks, lastBlockId, updatedAt } plus the optional `ratings`
 *     (self-rating per objective) and `summary` ({pct, state} at the last write, so course maps
 *     and the dashboard can show a status without loading the lesson). `answers` is keyed by
 *     `<blockId>/<questionId>` because one quiz block can hold several questions (see answerKey).
 * - `rp:lastLesson` → LastLesson { courseSlug, lessonId, title, pct, at }
 *
 * The pure `with*` helpers return a new object (or the same one when nothing changed), so React
 * state updates stay cheap. No React or DOM imports: server/tests imports this file directly.
 */

export const PROGRESS_VERSION = 1;
export const LAST_LESSON_KEY = 'rp:lastLesson';
/** Fired on window after a progress write: detail = { courseSlug, lessonId }. */
export const PROGRESS_EVENT = 'rp:progress-change';

export type AnswerRecord = {
  /** Submissions so far. */
  attempts: number;
  /** Whether the latest submission was correct. */
  correct: boolean;
  /** Option ids of the latest submission. */
  chosen: string[];
  /** Correct on the first submission (PLAN §5.6 correctFirstTry). */
  firstTry: boolean;
  /** The answer was shown (second miss or "show answer"). */
  revealed?: boolean;
};

/** Self-assessment per objective: 1 まだ不安 / 2 だいたいOK / 3 説明できる. */
export type SelfRating = 1 | 2 | 3;

/** Lesson states (PLAN §5.6), in order. */
export const LESSON_STATES = ['not_started', 'in_progress', 'read', 'checked', 'mastered'] as const;
export type LessonStateName = (typeof LESSON_STATES)[number];

/** Snapshot written with the progress, for pages that do not load the lesson itself. */
export type ProgressSummary = { pct: number; state: LessonStateName };

export type LessonProgress = {
  v: 1;
  /** Block ids seen (≥60% visible for ≥1.5 s). */
  seen: string[];
  answers: Record<string, AnswerRecord>;
  /** Ticked checklist items, completed steps, flashcards marked as known, … */
  checks: Record<string, boolean>;
  /** Block to resume at; null means the top of the lesson. */
  lastBlockId: string | null;
  updatedAt: string;
  ratings?: Record<string, SelfRating>;
  summary?: ProgressSummary;
};

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

export function answerKey(blockId: string, questionId: string): string {
  return `${blockId}/${questionId}`;
}

export function emptyProgress(): LessonProgress {
  return { v: PROGRESS_VERSION, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: new Date(0).toISOString() };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function parseAnswer(value: unknown): AnswerRecord | null {
  if (!isRecord(value)) return null;
  const attempts = Number(value.attempts);
  if (!Number.isFinite(attempts) || attempts < 0) return null;
  // Older shapes stored `chosen` as one id.
  const chosen = typeof value.chosen === 'string' ? [value.chosen] : stringArray(value.chosen);
  return {
    attempts: Math.floor(attempts),
    correct: value.correct === true,
    chosen,
    firstTry: value.firstTry === true,
    ...(value.revealed === true ? { revealed: true } : {}),
  };
}

/** Parses stored JSON; anything unreadable becomes empty progress. */
export function parseProgress(raw: string | null | undefined): LessonProgress {
  if (!raw) return emptyProgress();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyProgress();
  }
  if (!isRecord(data) || data.v !== PROGRESS_VERSION) return emptyProgress();

  const answers: Record<string, AnswerRecord> = {};
  if (isRecord(data.answers)) {
    for (const [key, value] of Object.entries(data.answers)) {
      const answer = parseAnswer(value);
      if (answer) answers[key] = answer;
    }
  }
  const checks: Record<string, boolean> = {};
  if (isRecord(data.checks)) {
    for (const [key, value] of Object.entries(data.checks)) {
      if (typeof value === 'boolean') checks[key] = value;
    }
  }
  const ratings: Record<string, SelfRating> = {};
  if (isRecord(data.ratings)) {
    for (const [key, value] of Object.entries(data.ratings)) {
      if (value === 1 || value === 2 || value === 3) ratings[key] = value;
    }
  }
  const summary = parseSummary(data.summary);
  return {
    v: PROGRESS_VERSION,
    seen: [...new Set(stringArray(data.seen))],
    answers,
    checks,
    lastBlockId: typeof data.lastBlockId === 'string' && data.lastBlockId ? data.lastBlockId : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date(0).toISOString(),
    ...(Object.keys(ratings).length ? { ratings } : {}),
    ...(summary ? { summary } : {}),
  };
}

function parseSummary(value: unknown): ProgressSummary | null {
  if (!isRecord(value)) return null;
  const pct = Number(value.pct);
  const state = (LESSON_STATES as readonly unknown[]).includes(value.state) ? (value.state as LessonStateName) : null;
  if (!Number.isFinite(pct) || !state) return null;
  return { pct: Math.max(0, Math.min(100, Math.round(pct))), state };
}

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

export function withSeen(p: LessonProgress, blockIds: readonly string[]): LessonProgress {
  const fresh = blockIds.filter((id) => !p.seen.includes(id));
  if (!fresh.length) return p;
  return touch(p, { seen: [...p.seen, ...new Set(fresh)] });
}

/**
 * Records one submission. `correct` grades it; `revealed` marks that the answer is now shown.
 * Predictions (ungraded) pass `correct: true` so they count as answered.
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
  return touch(p, { checks: { ...p.checks, [id]: value } });
}

export function withRating(p: LessonProgress, objectiveId: string, rating: SelfRating): LessonProgress {
  if (p.ratings?.[objectiveId] === rating) return p;
  return touch(p, { ratings: { ...(p.ratings ?? {}), [objectiveId]: rating } });
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

export function writeProgress(
  courseSlug: string,
  lessonId: string,
  progress: LessonProgress,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(progressKey(courseSlug, lessonId), JSON.stringify(progress));
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
