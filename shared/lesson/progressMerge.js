// @ts-check
/**
 * Lesson progress across devices: the lesson index, the structural sanitiser for records that
 * arrive from a client, and the merge the server (and the client, when it takes in server data)
 * uses. The merge only adds information: seen is a union, answers keep the most attempts and a
 * final correct answer, and checks/ratings/resume position are last-writer-wins with their own
 * clocks (`editedAt` for checks and ratings, `updatedAt` for the resume block).
 *
 * Keys the current lesson does not have are kept when they are well-formed, because the web
 * bundle and the server catalog deploy separately (version skew): progress.js lessonPct and
 * lessonState ignore them.
 *
 * Pure and browser-safe; imports only constants.js and progress.js (see progress.js).
 *
 * @typedef {import('./schema.js').Lesson} Lesson
 * @typedef {import('./schema.js').QuizQuestion} QuizQuestion
 * @typedef {import('./progress.js').LessonProgress} LessonProgress
 * @typedef {import('./progress.js').AnswerRecord} AnswerRecord
 * @typedef {import('./progress.js').SelfRating} SelfRating
 * @typedef {import('./grading.js').QuizMode} QuizMode
 */
import { ID_PATTERN } from './constants.js';
import { PROGRESS_VERSION, answerKey, parseProgress } from './progress.js';

/** Size caps for a stored record (each comfortably above the largest lesson: 58 blocks, 13 questions). */
export const PROGRESS_LIMITS = Object.freeze({
  /** Longest id in a key (SAFE_SLUG length; corpus max is 25). */
  idLength: 80,
  seen: 600,
  answers: 300,
  checks: 600,
  ratings: 60,
  chosen: 12,
  attempts: 99,
});

/** A client clock may run this far ahead of the server's before its timestamps are clamped. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * @typedef {object} QuestionEntry
 * @property {string} blockId
 * @property {string} sectionId
 * @property {QuizQuestion} question the full question (with the answer: server side only)
 * @property {QuizMode} mode
 */

/**
 * @typedef {object} SectionEntry
 * @property {string[]} blockIds every block, in order
 * @property {string[]} readingBlockIds non-quiz blocks, in order
 * @property {string[]} nonExamQuizKeys answer keys of the inline and predict questions, in order
 */

/**
 * @typedef {object} LessonIndex
 * @property {Set<string>} blockIds
 * @property {Set<string>} readingBlockIds non-quiz blocks (the ones `seen` counts)
 * @property {Map<string, QuestionEntry>} questions answerKey(block, question) → entry, in lesson order
 * @property {Set<string>} checkKeys `checklist:<block>/<item>`, `step:<block>/<item>`, `card:<block>/<card>`
 * @property {Set<string>} ratingKeys objective ids plus 'lesson'
 * @property {Map<string, SectionEntry>} sections section id → entry, in lesson order
 */

/**
 * Every progress key a lesson can have.
 * @param {Lesson} lesson
 * @returns {LessonIndex}
 */
export function lessonIndex(lesson) {
  /** @type {LessonIndex} */
  const index = {
    blockIds: new Set(),
    readingBlockIds: new Set(),
    questions: new Map(),
    checkKeys: new Set(),
    ratingKeys: new Set([...(lesson.objectives ?? []).map((o) => o.id), 'lesson']),
    sections: new Map(),
  };
  for (const section of lesson.sections) {
    /** @type {SectionEntry} */
    const entry = { blockIds: [], readingBlockIds: [], nonExamQuizKeys: [] };
    for (const block of section.blocks) {
      index.blockIds.add(block.id);
      entry.blockIds.push(block.id);
      if (block.type === 'quiz') {
        for (const question of block.questions) {
          const key = answerKey(block.id, question.id);
          index.questions.set(key, { blockId: block.id, sectionId: section.id, question, mode: block.mode });
          if (block.mode !== 'exam') entry.nonExamQuizKeys.push(key);
        }
        continue;
      }
      index.readingBlockIds.add(block.id);
      entry.readingBlockIds.push(block.id);
      if (block.type === 'checklist') for (const item of block.items) index.checkKeys.add(`checklist:${block.id}/${item.id}`);
      if (block.type === 'steps') for (const item of block.items) index.checkKeys.add(`step:${block.id}/${item.id}`);
      if (block.type === 'flashcards') for (const card of block.cards) index.checkKeys.add(`card:${block.id}/${card.id}`);
    }
    index.sections.set(section.id, entry);
  }
  return index;
}

// --- Sanitising -------------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isId = (value) => typeof value === 'string' && value.length <= PROGRESS_LIMITS.idLength && ID_PATTERN.test(value);

/** `<blockId>/<questionId>` (ids cannot contain "/"). */
const isAnswerKey = (/** @type {string} */ key) => {
  const parts = key.split('/');
  return parts.length === 2 && parts.every(isId);
};

const CHECK_KIND = /^[a-z][a-z0-9]{0,23}$/;

/** `<kind>:<blockId>/<itemId>`, e.g. `checklist:c1/i2`. */
const isCheckKey = (/** @type {string} */ key) => {
  const colon = key.indexOf(':');
  return colon > 0 && CHECK_KIND.test(key.slice(0, colon)) && isAnswerKey(key.slice(colon + 1));
};

/**
 * Re-serialised ISO time: invalid → epoch 0, then clamped to [epoch, now + MAX_CLOCK_SKEW_MS].
 * @param {unknown} value
 * @param {number} nowMs
 * @returns {string}
 */
function cleanTime(value, nowMs) {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  const valid = Number.isFinite(ms) ? ms : 0;
  return new Date(Math.min(Math.max(valid, 0), nowMs + MAX_CLOCK_SKEW_MS)).toISOString();
}

/** @param {unknown} now */
const nowMsOf = (now) => {
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Number.NaN;
  return Number.isFinite(ms) ? ms : Date.now();
};

/**
 * A record from a client, made safe to store: structural rules only, no lesson needed (so a
 * client on another version of the lesson loses nothing). Parses the v1 shape, keeps
 * well-formed keys (ids match ID_PATTERN, ≤ 80 chars), caps every collection, drops answer
 * records that say "not answered" (attempts 0 and not revealed), keeps firstTry and correct
 * only with an attempt, re-serialises the timestamps (invalid → epoch 0, at most 5 minutes
 * ahead of `now`) and drops the derived summary.
 *
 * @param {unknown} raw JSON text or a parsed value
 * @param {{ now?: number | Date }} [options]
 * @returns {LessonProgress}
 */
export function sanitizeProgress(raw, { now } = {}) {
  const nowMs = nowMsOf(now);
  const parsed = parseProgress(raw);

  /** @type {Record<string, AnswerRecord>} */
  const answers = {};
  let answerCount = 0;
  for (const [key, record] of Object.entries(parsed.answers)) {
    if (answerCount >= PROGRESS_LIMITS.answers) break;
    if (!isAnswerKey(key)) continue;
    const attempts = Math.min(record.attempts, PROGRESS_LIMITS.attempts);
    const revealed = record.revealed === true;
    if (attempts === 0 && !revealed) continue;
    answers[key] = {
      attempts,
      correct: attempts > 0 && record.correct,
      chosen: [...new Set(record.chosen.filter(isId))].slice(0, PROGRESS_LIMITS.chosen),
      firstTry: attempts > 0 && record.firstTry,
      ...(revealed ? { revealed: true } : {}),
    };
    answerCount += 1;
  }

  /** @type {Record<string, boolean>} */
  const checks = {};
  for (const [key, value] of Object.entries(parsed.checks).filter(([k]) => isCheckKey(k)).slice(0, PROGRESS_LIMITS.checks)) {
    checks[key] = value;
  }

  /** @type {Record<string, SelfRating>} */
  const ratings = {};
  for (const [key, value] of Object.entries(parsed.ratings ?? {}).filter(([k]) => isId(k)).slice(0, PROGRESS_LIMITS.ratings)) {
    ratings[key] = value;
  }

  return {
    v: PROGRESS_VERSION,
    seen: parsed.seen.filter(isId).slice(0, PROGRESS_LIMITS.seen),
    answers,
    checks,
    lastBlockId: isId(parsed.lastBlockId) ? parsed.lastBlockId : null,
    updatedAt: cleanTime(parsed.updatedAt, nowMs),
    ...(parsed.editedAt !== undefined ? { editedAt: cleanTime(parsed.editedAt, nowMs) } : {}),
    ...(Object.keys(ratings).length ? { ratings } : {}),
  };
}

// --- Merging ----------------------------------------------------------------------------------

/**
 * Own key check without Object.hasOwn (the client sync runs this in browsers down to Safari 14).
 * @param {object} object
 * @param {string} key
 */
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** @param {string | undefined} iso */
const timeOf = (iso) => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * @param {string | undefined} a
 * @param {string | undefined} b
 * @returns {string | undefined} the later of two ISO times (a on a tie)
 */
const laterTime = (a, b) => {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return timeOf(b) > timeOf(a) ? b : a;
};

/** @param {AnswerRecord} record @returns {AnswerRecord} */
const copyAnswer = (record) => ({
  attempts: record.attempts,
  correct: record.correct,
  chosen: [...record.chosen],
  firstTry: record.firstTry,
  ...(record.revealed ? { revealed: true } : {}),
});

/**
 * One question's record when both sides have it.
 * @param {AnswerRecord} server
 * @param {AnswerRecord} client
 * @returns {AnswerRecord}
 */
function mergeAnswer(server, client) {
  const revealed = server.revealed === true || client.revealed === true;
  // A correct answer on the server is final: keep it whole, OR in only the reveal.
  if (server.correct && server.attempts > 0) return { ...copyAnswer(server), ...(revealed ? { revealed: true } : {}) };
  // The latest submission is the one with more attempts; a tie keeps the server's, the same
  // side firstTry comes from, so the record stays coherent.
  const latest = client.attempts > server.attempts ? client : server;
  return {
    attempts: Math.max(server.attempts, client.attempts),
    correct: latest.correct,
    chosen: [...latest.chosen],
    firstTry: server.attempts > 0 ? server.firstTry : client.firstTry,
    ...(revealed ? { revealed: true } : {}),
  };
}

/**
 * Per-key last-writer-wins on a record-level clock; keys only on one side are kept.
 * @template T
 * @param {Record<string, T>} server
 * @param {Record<string, T>} client
 * @param {boolean} clientNewer
 * @returns {Record<string, T>}
 */
function mergeKeyed(server, client, clientNewer) {
  /** @type {Record<string, T>} */
  const out = {};
  for (const [key, value] of Object.entries(server)) out[key] = value;
  for (const [key, value] of Object.entries(client)) {
    if (clientNewer || !hasOwn(server, key)) out[key] = value;
  }
  return out;
}

/**
 * Merges a client record into the server's (or into nothing). Never loses an answer, a seen
 * block or a key only one side has. The result has no summary (it is derived: recompute it).
 *
 * - seen: union, server order first.
 * - answers: one side only → it. Both: a server record with correct && attempts > 0 is final
 *   (revealed is OR-ed in). Otherwise attempts = max; chosen/correct from the side with more
 *   attempts (tie → server); firstTry from the server when it has an attempt, else the client;
 *   revealed = OR.
 * - checks, ratings: per key, the side with the newer editedAt (fallback updatedAt) wins; a tie
 *   keeps the server's.
 * - lastBlockId: from the side with the newer updatedAt (tie → server).
 * - updatedAt and editedAt: the later of the two.
 *
 * @param {LessonProgress | null | undefined} server
 * @param {LessonProgress} client
 * @returns {LessonProgress}
 */
export function mergeProgress(server, client) {
  if (!server) {
    /** @type {Record<string, AnswerRecord>} */
    const answers = {};
    for (const [key, record] of Object.entries(client.answers)) answers[key] = copyAnswer(record);
    return {
      v: PROGRESS_VERSION,
      seen: [...client.seen],
      answers,
      checks: { ...client.checks },
      lastBlockId: client.lastBlockId ?? null,
      updatedAt: client.updatedAt,
      ...(client.editedAt !== undefined ? { editedAt: client.editedAt } : {}),
      ...(client.ratings && Object.keys(client.ratings).length ? { ratings: { ...client.ratings } } : {}),
    };
  }

  const serverSeen = new Set(server.seen);
  const seen = [...server.seen, ...client.seen.filter((id) => !serverSeen.has(id))];

  /** @type {Record<string, AnswerRecord>} */
  const answers = {};
  for (const [key, record] of Object.entries(server.answers)) {
    answers[key] = hasOwn(client.answers, key) ? mergeAnswer(record, client.answers[key]) : copyAnswer(record);
  }
  for (const [key, record] of Object.entries(client.answers)) {
    if (!hasOwn(server.answers, key)) answers[key] = copyAnswer(record);
  }

  const clientEditedNewer = timeOf(client.editedAt ?? client.updatedAt) > timeOf(server.editedAt ?? server.updatedAt);
  const checks = mergeKeyed(server.checks, client.checks, clientEditedNewer);
  const ratings = mergeKeyed(server.ratings ?? {}, client.ratings ?? {}, clientEditedNewer);
  const clientUpdatedNewer = timeOf(client.updatedAt) > timeOf(server.updatedAt);
  const editedAt = laterTime(server.editedAt, client.editedAt);

  return {
    v: PROGRESS_VERSION,
    seen,
    answers,
    checks,
    lastBlockId: (clientUpdatedNewer ? client.lastBlockId : server.lastBlockId) ?? null,
    updatedAt: /** @type {string} */ (laterTime(server.updatedAt, client.updatedAt)),
    ...(editedAt !== undefined ? { editedAt } : {}),
    ...(Object.keys(ratings).length ? { ratings } : {}),
  };
}

// --- Comparing --------------------------------------------------------------------------------

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 */
const sameSet = (a, b) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

/**
 * @template T
 * @param {Record<string, T>} a
 * @param {Record<string, T>} b
 * @param {(x: T, y: T) => boolean} same
 */
const sameEntries = (a, b, same) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => hasOwn(b, key) && same(a[key], b[key]));
};

/** @param {AnswerRecord} a @param {AnswerRecord} b */
const sameAnswer = (a, b) => a.attempts === b.attempts
  && a.correct === b.correct
  && a.firstTry === b.firstTry
  && Boolean(a.revealed) === Boolean(b.revealed)
  && sameSet(a.chosen, b.chosen);

/**
 * True when two records hold the same learning state: seen (as a set), answers, checks,
 * ratings and the resume block. Timestamps and the summary are ignored. Answers "does this
 * record need uploading" (compare merge(server, local) with server).
 *
 * @param {LessonProgress} a
 * @param {LessonProgress} b
 * @returns {boolean}
 */
export function progressContentEqual(a, b) {
  return sameSet(a.seen, b.seen)
    && (a.lastBlockId ?? null) === (b.lastBlockId ?? null)
    && sameEntries(a.answers, b.answers, sameAnswer)
    && sameEntries(a.checks, b.checks, (x, y) => x === y)
    && sameEntries(a.ratings ?? {}, b.ratings ?? {}, (x, y) => x === y);
}
