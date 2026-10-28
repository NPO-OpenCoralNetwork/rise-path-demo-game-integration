// @ts-check
/**
 * Quiz grading and attempt rules, shared by the web reader (QuizCheckBlock) and the server
 * (MCP course-quiz-check). The attempt rules are the reader's:
 * - graded questions (inline, exam): at most MAX_GRADED_ATTEMPTS submissions; the second miss
 *   reveals the answer; a correct or revealed question is locked; firstTry is fixed by the first
 *   submission (exam firstTry decides "mastered").
 * - predict questions: one ungraded submission, then locked.
 * - reveal ("show answer"): only after a miss, adds no attempt.
 *
 * quizFeedback builds what a learner may see after each outcome, so the rule "no correct label
 * or explanation before the reader would show it" lives in one pure, tested place.
 *
 * Pure and browser-safe; imports only constants.js, text.js and learnerView.js (see progress.js).
 *
 * @typedef {import('./schema.js').QuizQuestion} QuizQuestion
 * @typedef {import('./progress.js').AnswerRecord} AnswerRecord
 * @typedef {import('./text.js').Locale} Locale
 * @typedef {typeof QUIZ_MODES[number]} QuizMode
 * @typedef {'correct' | 'incorrect' | 'revealed' | 'predicted' | 'locked'} SubmissionOutcome
 * @typedef {'revealed' | 'not_allowed'} RevealOutcome
 */
import { QUIZ_MODES } from './constants.js';
import { resolveText } from './text.js';
import { labelForOptionId } from './learnerView.js';

/** Submissions a graded (inline/exam) question accepts; the last miss reveals the answer. */
export const MAX_GRADED_ATTEMPTS = 2;

/**
 * Checks a learner's choice against the question: every id must be an option id (duplicates
 * are dropped); single and truefalse questions take exactly one, multi at least one.
 *
 * @param {Pick<QuizQuestion, 'kind' | 'options'>} question
 * @param {unknown} ids option ids
 * @returns {{ ok: true, ids: string[] } | { ok: false, reason: 'invalid_choice' }}
 */
export function normalizeChoice(question, ids) {
  /** @type {{ ok: false, reason: 'invalid_choice' }} */
  const invalid = { ok: false, reason: 'invalid_choice' };
  if (!Array.isArray(ids)) return invalid;
  const optionIds = new Set(question.options.map((o) => o.id));
  /** @type {string[]} */
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !optionIds.has(id)) return invalid;
    if (!out.includes(id)) out.push(id);
  }
  const multi = (question.kind ?? 'single') === 'multi';
  if (multi ? out.length < 1 : out.length !== 1) return invalid;
  return { ok: true, ids: out };
}

/**
 * True when the chosen ids are exactly the answer (as sets; order and duplicates do not matter).
 *
 * @param {Pick<QuizQuestion, 'answer'>} question
 * @param {readonly string[]} ids
 * @returns {boolean}
 */
export function isCorrectChoice(question, ids) {
  const chosen = new Set(ids);
  const answer = new Set(question.answer);
  return chosen.size === answer.size && [...chosen].every((id) => answer.has(id));
}

/**
 * A record counts only once something happened (a submission or a reveal); an `attempts: 0`
 * record without a reveal means "not answered".
 * @param {AnswerRecord | undefined} record
 * @returns {AnswerRecord | undefined}
 */
const activeRecord = (record) => (record && (record.attempts > 0 || record.revealed) ? record : undefined);

/**
 * The reader's lock (QuizCheckBlock phases), for an active record: a prediction once made; a
 * graded question once it is correct, revealed or out of attempts. The reader shows the answer
 * in every one of these states.
 * @param {AnswerRecord} record an active record
 * @param {QuizMode} mode
 */
const isLocked = (record, mode) => mode === 'predict'
  || (record.correct && record.attempts > 0)
  || record.revealed === true
  || record.attempts >= MAX_GRADED_ATTEMPTS;

/**
 * Applies one submission with the reader's rules. A locked question keeps its record unchanged.
 *
 * @param {AnswerRecord | undefined} record the stored record, if any
 * @param {{ correct: boolean, chosen: readonly string[], mode: QuizMode }} submission
 * @returns {{ record: AnswerRecord | undefined, outcome: SubmissionOutcome }}
 */
export function applySubmission(record, { correct, chosen, mode }) {
  const prev = activeRecord(record);
  if (prev && isLocked(prev, mode)) return { record, outcome: 'locked' };
  const predict = mode === 'predict';
  const attempts = (prev?.attempts ?? 0) + 1;
  const revealed = prev?.revealed === true || (!predict && !correct && attempts >= MAX_GRADED_ATTEMPTS);
  /** @type {AnswerRecord} */
  const next = {
    attempts,
    correct,
    chosen: [...chosen],
    firstTry: prev ? prev.firstTry : correct,
    ...(revealed ? { revealed: true } : {}),
  };
  /** @type {SubmissionOutcome} */
  const outcome = predict ? 'predicted' : correct ? 'correct' : revealed ? 'revealed' : 'incorrect';
  return { record: next, outcome };
}

/**
 * "Show the answer" after a miss: allowed only for a graded question with at least one attempt
 * that is neither correct nor revealed yet. Adds no attempt.
 *
 * @param {AnswerRecord | undefined} record
 * @param {{ mode: QuizMode }} options
 * @returns {{ record: AnswerRecord | undefined, outcome: RevealOutcome }}
 */
export function applyReveal(record, { mode }) {
  const allowed = mode !== 'predict' && record !== undefined && record.attempts >= 1 && !record.correct && !record.revealed;
  if (!allowed) return { record, outcome: 'not_allowed' };
  return { record: { ...record, chosen: [...record.chosen], revealed: true }, outcome: 'revealed' };
}

/**
 * Submissions left on a graded question (0 once it is correct or revealed).
 * @param {AnswerRecord | undefined} record
 */
function attemptsLeft(record) {
  const prev = activeRecord(record);
  if (!prev) return MAX_GRADED_ATTEMPTS;
  if ((prev.correct && prev.attempts > 0) || prev.revealed) return 0;
  return Math.max(0, MAX_GRADED_ATTEMPTS - prev.attempts);
}

/**
 * @typedef {object} QuizFeedback
 * @property {SubmissionOutcome | RevealOutcome} outcome
 * @property {QuizMode} mode
 * @property {number} attempts submissions recorded so far
 * @property {number} [attempts_left] graded questions only
 * @property {{ label: string, md: string }[]} [feedback] incorrect: each chosen wrong option; predicted: each chosen option
 * @property {string} [hint] incorrect only, when the question has one
 * @property {string} [explanation] once the reader would show the answer
 * @property {string[]} [correct_labels] once the reader would show the answer
 * @property {boolean} [this_choice_correct] locked: whether the new (unrecorded) choice is right
 */

/**
 * What the learner may see after an outcome, in one locale. The correct labels and the
 * explanation appear only once the reader shows the answer too (correct, revealed, predicted,
 * locked); a miss gets the feedback of the wrong options picked and the hint.
 *
 * @param {QuizQuestion} question the full question (server side)
 * @param {AnswerRecord | undefined} record the record after the outcome
 * @param {SubmissionOutcome | RevealOutcome} outcome
 * @param {{ mode: QuizMode, locale: Locale, fallback?: Locale, chosen?: readonly string[] }} options
 *   chosen: the ids just submitted (used for `this_choice_correct` when the question is locked)
 * @returns {QuizFeedback}
 */
export function quizFeedback(question, record, outcome, { mode, locale, fallback = locale, chosen }) {
  /** @param {import('./text.js').LText | undefined} text */
  const text = (text) => resolveText(text, locale, fallback).value;
  /** @param {(option: QuizQuestion['options'][number]) => boolean} pick */
  const optionFeedback = (pick) => question.options
    .filter((option) => option.feedback !== undefined && pick(option))
    .map((option) => ({ label: /** @type {string} */ (labelForOptionId(question, option.id)), md: text(option.feedback) }));
  const picked = new Set(record?.chosen ?? []);

  /** @type {QuizFeedback} */
  const out = { outcome, mode, attempts: record?.attempts ?? 0 };
  if (mode !== 'predict') out.attempts_left = attemptsLeft(record);

  if (outcome === 'incorrect') {
    const feedback = optionFeedback((o) => picked.has(o.id) && !question.answer.includes(o.id));
    if (feedback.length) out.feedback = feedback;
    if (question.hint !== undefined) out.hint = text(question.hint);
    return out;
  }
  if (outcome === 'correct' || outcome === 'revealed' || outcome === 'predicted' || outcome === 'locked') {
    if (outcome === 'predicted') {
      const feedback = optionFeedback((o) => picked.has(o.id));
      if (feedback.length) out.feedback = feedback;
    }
    out.explanation = text(question.explanation);
    out.correct_labels = question.options
      .filter((option) => question.answer.includes(option.id))
      .map((option) => /** @type {string} */ (labelForOptionId(question, option.id)));
    if (outcome === 'locked' && chosen && chosen.length) out.this_choice_correct = isCorrectChoice(question, chosen);
  }
  return out;
}
