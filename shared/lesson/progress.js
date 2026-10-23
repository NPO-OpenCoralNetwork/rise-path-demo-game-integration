// @ts-check
/**
 * Lesson progress (PLAN §9.1 contract): the record shape, its parser, and the pct/state rules
 * (PLAN §5.6). One copy for the reader (components/lesson/progressStore.ts and model.ts re-export
 * these), the server progress API and the MCP course tools.
 *
 * Pure and browser-safe. This file, grading.js, learnerView.js and progressMerge.js import only
 * constants.js, text.js, walk.js, canonical.js and each other: never schema.js (zod would land in
 * the reader bundle), validate.js, lint.js, hash.js, jsonSchema.js or node:*. JSDoc type imports
 * of schema.js are fine (they are erased). server/tests/lessonProgressMerge.test.js checks this.
 *
 * Record `rp:progress:<courseSlug>:<lessonId>` → LessonProgress
 *   { v:1, seen, answers, checks, lastBlockId, updatedAt } plus the optional `editedAt` (last
 *   check or rating edit), `editedKeys` (the last edit of each check and rating: the merge clock
 *   for those, editedAt the fallback), `ratings` (self-rating per objective) and `summary`
 *   ({pct, state} at the last write, so course maps can show a status without loading the
 *   lesson). `answers` is keyed by `<blockId>/<questionId>` (see answerKey).
 *
 * @typedef {import('./schema.js').Lesson} Lesson
 * @typedef {import('./schema.js').Block} Block
 * @typedef {import('./schema.js').QuizBlock} QuizBlock
 */

export const PROGRESS_VERSION = 1;

/**
 * @typedef {object} AnswerRecord
 * @property {number} attempts Submissions so far.
 * @property {boolean} correct Whether the latest submission was correct.
 * @property {string[]} chosen Option ids of the latest submission.
 * @property {boolean} firstTry Correct on the first submission (PLAN §5.6 correctFirstTry).
 * @property {boolean} [revealed] The answer was shown (second miss or "show answer").
 */

/**
 * Self-assessment per objective: 1 まだ不安 / 2 だいたいOK / 3 説明できる.
 * @typedef {1 | 2 | 3} SelfRating
 */

/** Lesson states (PLAN §5.6), in order. */
export const LESSON_STATES = /** @type {const} */ (['not_started', 'in_progress', 'read', 'checked', 'mastered']);

/** @typedef {typeof LESSON_STATES[number]} LessonStateName */

/**
 * Snapshot written with the progress, for pages that do not load the lesson itself.
 * @typedef {{ pct: number, state: LessonStateName }} ProgressSummary
 */

/**
 * @typedef {object} LessonProgress
 * @property {1} v
 * @property {string[]} seen Block ids seen (≥60% visible for ≥1.5 s).
 * @property {Record<string, AnswerRecord>} answers Keyed by answerKey(blockId, questionId).
 * @property {Record<string, boolean>} checks Ticked checklist items, completed steps, flashcards marked as known, …
 * @property {string | null} lastBlockId Block to resume at; null means the top of the lesson.
 * @property {string} updatedAt ISO time of the last change of any kind.
 * @property {string} [editedAt] ISO time of the last check or rating edit (the fallback clock
 *   for a check or rating without its own time in editedKeys).
 * @property {Record<string, string>} [editedKeys] ISO time of the last edit per check key and per
 *   ratingClockKey(objectiveId): the merge clock of each check and rating.
 * @property {Record<string, SelfRating>} [ratings]
 * @property {ProgressSummary} [summary]
 */

/**
 * @param {string} blockId
 * @param {string} questionId
 * @returns {string}
 */
export function answerKey(blockId, questionId) {
  return `${blockId}/${questionId}`;
}

/**
 * The editedKeys key of a self-rating. A check key always holds a "/" and an objective id never
 * does, so the two cannot collide.
 * @param {string} objectiveId
 * @returns {string}
 */
export function ratingClockKey(objectiveId) {
  return `rating:${objectiveId}`;
}

/** @returns {LessonProgress} */
export function emptyProgress() {
  return { v: PROGRESS_VERSION, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: new Date(0).toISOString() };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const stringArray = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

/** Own entries without `__proto__` (JSON.parse makes it an own key; assigning it would swap a prototype). */
const entriesOf = (/** @type {Record<string, unknown>} */ value) => Object.entries(value).filter(([key]) => key !== '__proto__');

/**
 * @param {unknown} value
 * @returns {AnswerRecord | null}
 */
function parseAnswer(value) {
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

/**
 * @param {unknown} value
 * @returns {ProgressSummary | null}
 */
function parseSummary(value) {
  if (!isRecord(value)) return null;
  const pct = Number(value.pct);
  const state = /** @type {readonly unknown[]} */ (LESSON_STATES).includes(value.state)
    ? /** @type {LessonStateName} */ (value.state)
    : null;
  if (!Number.isFinite(pct) || !state) return null;
  return { pct: Math.max(0, Math.min(100, Math.round(pct))), state };
}

/**
 * Parses a stored record (JSON text, or a value already parsed from JSON); anything unreadable
 * becomes empty progress. Unknown fields are dropped. Keys are kept whatever lesson they belong
 * to: progressMerge.sanitizeProgress applies the server's structural rules on top.
 *
 * @param {unknown} raw
 * @returns {LessonProgress}
 */
export function parseProgress(raw) {
  if (!raw) return emptyProgress();
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return emptyProgress();
    }
  }
  if (!isRecord(data) || data.v !== PROGRESS_VERSION) return emptyProgress();

  /** @type {Record<string, AnswerRecord>} */
  const answers = {};
  if (isRecord(data.answers)) {
    for (const [key, value] of entriesOf(data.answers)) {
      const answer = parseAnswer(value);
      if (answer) answers[key] = answer;
    }
  }
  /** @type {Record<string, boolean>} */
  const checks = {};
  if (isRecord(data.checks)) {
    for (const [key, value] of entriesOf(data.checks)) {
      if (typeof value === 'boolean') checks[key] = value;
    }
  }
  /** @type {Record<string, SelfRating>} */
  const ratings = {};
  if (isRecord(data.ratings)) {
    for (const [key, value] of entriesOf(data.ratings)) {
      if (value === 1 || value === 2 || value === 3) ratings[key] = value;
    }
  }
  /** @type {Record<string, string>} */
  const editedKeys = {};
  if (isRecord(data.editedKeys)) {
    for (const [key, value] of entriesOf(data.editedKeys)) {
      if (typeof value === 'string' && value) editedKeys[key] = value;
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
    ...(typeof data.editedAt === 'string' && data.editedAt ? { editedAt: data.editedAt } : {}),
    ...(Object.keys(editedKeys).length ? { editedKeys } : {}),
    ...(Object.keys(ratings).length ? { ratings } : {}),
    ...(summary ? { summary } : {}),
  };
}

// --- pct and state ----------------------------------------------------------------------------

/**
 * @param {Block} block
 * @returns {block is QuizBlock}
 */
const isQuizBlock = (block) => block.type === 'quiz';

/**
 * The stored record for one question, or undefined (own keys only). hasOwnProperty.call, not
 * Object.hasOwn: this runs in the reader bundle, whose build target includes Safari 14.
 * @param {LessonProgress} progress
 * @param {string} key
 * @returns {AnswerRecord | undefined}
 */
const answerOf = (progress, key) => (Object.prototype.hasOwnProperty.call(progress.answers, key) ? progress.answers[key] : undefined);

/**
 * A question counts as answered once it was submitted or its answer was revealed.
 * @param {LessonProgress} progress
 * @param {string} blockId
 * @param {string} questionId
 * @returns {boolean}
 */
export function isAnswered(progress, blockId, questionId) {
  const record = answerOf(progress, answerKey(blockId, questionId));
  return Boolean(record && (record.attempts > 0 || record.revealed));
}

/**
 * @param {QuizBlock} block
 * @param {LessonProgress} progress
 * @returns {boolean}
 */
export function quizAnswered(block, progress) {
  return block.questions.every((q) => isAnswered(progress, block.id, q.id));
}

/**
 * A block is done when seen; a quiz when every question is answered.
 * @param {Block} block
 * @param {LessonProgress} progress
 * @param {ReadonlySet<string>} seen
 * @returns {boolean}
 */
export function blockDone(block, progress, seen) {
  if (isQuizBlock(block)) return quizAnswered(block, progress);
  return seen.has(block.id);
}

/**
 * @param {Lesson} lesson
 * @returns {Block[]}
 */
export function allBlocks(lesson) {
  return lesson.sections.flatMap((section) => section.blocks);
}

/**
 * Share of blocks done, 0–100. Keys the lesson does not have (another version of it) are ignored.
 * @param {Lesson} lesson
 * @param {LessonProgress} progress
 * @returns {number}
 */
export function lessonPct(lesson, progress) {
  const blocks = allBlocks(lesson);
  if (!blocks.length) return 0;
  const seen = new Set(progress.seen);
  const done = blocks.filter((block) => blockDone(block, progress, seen)).length;
  return Math.round((done / blocks.length) * 100);
}

/**
 * PLAN §5.6: not_started → in_progress → read (≥90% of non-quiz blocks seen) →
 * checked (also every inline/predict question answered) → mastered (exam ≥80% right first try).
 * Only this lesson's blocks and questions count, so a record from another version of the
 * lesson (unknown ids) never moves the state.
 *
 * @param {Lesson} lesson
 * @param {LessonProgress} progress
 * @returns {LessonStateName}
 */
export function lessonState(lesson, progress) {
  const blocks = allBlocks(lesson);
  const seen = new Set(progress.seen);
  const quizzes = blocks.filter(isQuizBlock);
  const anyActivity = blocks.some((b) => seen.has(b.id))
    || quizzes.some((b) => b.questions.some((q) => answerOf(progress, answerKey(b.id, q.id)) !== undefined));
  if (!anyActivity) return 'not_started';

  const reading = blocks.filter((b) => !isQuizBlock(b));
  const seenCount = reading.filter((b) => seen.has(b.id)).length;
  const read = reading.length === 0 || seenCount / reading.length >= 0.9;
  if (!read) return 'in_progress';

  const checks = quizzes.filter((b) => b.mode !== 'exam');
  if (!checks.every((b) => quizAnswered(b, progress))) return 'read';

  const exams = quizzes.filter((b) => b.mode === 'exam');
  if (!exams.length) return 'checked';
  const questions = exams.flatMap((b) => b.questions.map((q) => answerOf(progress, answerKey(b.id, q.id))));
  const firstTry = questions.filter((a) => a?.firstTry && a.attempts > 0).length;
  return questions.length && firstTry / questions.length >= 0.8 ? 'mastered' : 'checked';
}

/**
 * States that count as a finished lesson (course maps and learning events).
 * @type {ReadonlySet<LessonStateName>}
 */
export const LESSON_DONE_STATES = new Set(/** @type {LessonStateName[]} */ (['read', 'checked', 'mastered']));
