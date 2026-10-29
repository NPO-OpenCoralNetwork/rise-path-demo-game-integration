// @ts-check
/**
 * The learner's view of a lesson, for AI apps (the MCP course tools): plain JSON in one locale,
 * with the answers taken out. Quiz options are relabelled "1".."n" by position, because option
 * ids are biased (the answer is often `a`) and per-option feedback exists only on wrong options;
 * answer, explanation, hint, feedback and option ids never leave this module. Grading uses the
 * full lesson on the server (grading.js), mapping labels back with optionIdForLabel.
 *
 * Not secrecy: the web reader bundles the full lessons. This keeps an agent from seeing the
 * answer while it tutors.
 *
 * Pure and browser-safe; imports only constants.js and text.js (see progress.js for the rule).
 *
 * @typedef {import('./schema.js').Lesson} Lesson
 * @typedef {import('./schema.js').Block} Block
 * @typedef {import('./schema.js').QuizBlock} QuizBlock
 * @typedef {import('./schema.js').QuizQuestion} QuizQuestion
 * @typedef {import('./schema.js').LText} LText
 * @typedef {import('./text.js').Locale} Locale
 */
import { LOCALES } from './constants.js';
import { fromBcp47, resolveText } from './text.js';

/**
 * How an AI app should tutor with the course tools. Returned with every lesson read (and by the
 * socratic-tutor prompt), so it reaches agents that never open a prompt.
 */
export const TUTOR_PROTOCOL = [
  'You are tutoring a learner through a Rise Path lesson.',
  '1. Let the learner answer every question. Never answer for them.',
  "2. Send only the learner's own choice to course-quiz-check. Never pick, guess or probe options: each call is recorded as the learner's attempt.",
  "3. Give no hints on exam questions before the learner's first answer.",
  '4. Ask a section\'s predict question before you teach that section.',
  '5. Use reveal only when the learner asks for the answer after a miss.',
  '6. Prompt blocks (for: "learner") are text for the learner to type into their own AI. Do not run them yourself.',
  '7. Mark sections read (course-progress-update) only when the learner worked through them.',
  "8. Reply in the learner's language.",
].join('\n');

/** Block fields that are not for the learner's AI app (speech text, Slides switches). */
const DROPPED_BLOCK_FIELDS = new Set(['narration', 'slide']);

const LOCALE_SET = new Set(/** @type {readonly string[]} */ (LOCALES));

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A localized text object ({jp?, en?, fr?} with string values only).
 * @param {unknown} value
 * @returns {value is Record<string, string>}
 */
const isLTextObject = (value) => isPlainObject(value)
  && Object.keys(value).length > 0
  && Object.entries(value).every(([key, text]) => LOCALE_SET.has(key) && typeof text === 'string');

/**
 * Locales the lesson can be read in: `lesson.locales` (complete translations) plus the source locale.
 * @param {Lesson} lesson
 * @returns {Locale[]}
 */
export function availableLocales(lesson) {
  /** @type {Locale[]} */
  const list = Array.isArray(lesson.locales) ? [...new Set(lesson.locales)] : [];
  if (!list.includes(lesson.locale)) list.unshift(lesson.locale);
  return list;
}

/**
 * The locale a learner view uses: the requested one when the lesson has it (`ja`/`en-US` style
 * tags are accepted), otherwise the lesson's source locale.
 * @param {Lesson} lesson
 * @param {unknown} [requested]
 * @returns {Locale}
 */
export function learnerLocale(lesson, requested) {
  const wanted = typeof requested === 'string' ? fromBcp47(requested) : null;
  return wanted && availableLocales(lesson).includes(wanted) ? wanted : lesson.locale;
}

/**
 * Resolves every localized text in a value (deeply) to one locale.
 * @param {unknown} value
 * @param {Locale} locale
 * @param {Locale} fallback
 * @returns {unknown}
 */
function resolveDeep(value, locale, fallback) {
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, locale, fallback));
  if (isLTextObject(value)) return resolveText(value, locale, fallback).value;
  if (isPlainObject(value)) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = resolveDeep(item, locale, fallback);
    }
    return out;
  }
  return value;
}

/**
 * Positional label ("1".."n") of an option id, or null when the question has no such option.
 * @param {Pick<QuizQuestion, 'options'>} question
 * @param {string} optionId
 * @returns {string | null}
 */
export function labelForOptionId(question, optionId) {
  const index = question.options.findIndex((o) => o.id === optionId);
  return index < 0 ? null : String(index + 1);
}

/**
 * Option id for a positional label ("2" or 2), or null when the label is not one of the options.
 * @param {Pick<QuizQuestion, 'options'>} question
 * @param {unknown} label
 * @returns {string | null}
 */
export function optionIdForLabel(question, label) {
  let n = Number.NaN;
  if (typeof label === 'number' && Number.isInteger(label)) n = label;
  else if (typeof label === 'string' && /^\s*[1-9]\d{0,2}\s*$/.test(label)) n = Number(label.trim());
  if (!(n >= 1 && n <= question.options.length)) return null;
  return question.options[n - 1].id;
}

/**
 * @param {QuizBlock} block
 * @param {Locale} locale
 * @param {Locale} fallback
 */
function learnerQuiz(block, locale, fallback) {
  /** @param {LText | undefined} text */
  const text = (text) => resolveText(text, locale, fallback).value;
  return {
    id: block.id,
    type: /** @type {const} */ ('quiz'),
    mode: block.mode,
    ...(block.title !== undefined ? { title: text(block.title) } : {}),
    ...(block.cite ? { cite: [...block.cite] } : {}),
    questions: block.questions.map((q) => {
      const kind = q.kind ?? 'single';
      return {
        id: q.id,
        kind,
        multiple: kind === 'multi',
        prompt: text(q.prompt),
        ...(q.objectiveId ? { objectiveId: q.objectiveId } : {}),
        options: q.options.map((option, index) => ({ label: String(index + 1), md: text(option.md) })),
      };
    }),
  };
}

/**
 * One block for the learner view. Quiz blocks are rebuilt from an allowlist; other blocks keep
 * their fields (one locale) minus narration and slide. Prompt blocks get `for: 'learner'`: their
 * text is for the learner to type into their own AI, not for the agent to run.
 * @param {Block} block
 * @param {Locale} locale
 * @param {Locale} fallback
 * @returns {Record<string, unknown>}
 */
function learnerBlock(block, locale, fallback) {
  if (block.type === 'quiz') return learnerQuiz(block, locale, fallback);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(block)) {
    if (DROPPED_BLOCK_FIELDS.has(key) || value === undefined) continue;
    out[key] = resolveDeep(value, locale, fallback);
  }
  if (block.type === 'prompt') out.for = 'learner';
  return out;
}

/**
 * The lesson for a learner's AI app: one locale (fallback to the source locale per text), no
 * answers, no provenance, narration, slide switches or tags.
 *
 * @param {Lesson} lesson a valid published lesson
 * @param {{ locale?: unknown, sectionIds?: readonly string[] | 'all' }} [options]
 *   sectionIds limits `sections` to those ids (in lesson order); omitted or 'all' keeps every section.
 */
export function toLearnerLesson(lesson, { locale, sectionIds } = {}) {
  const used = learnerLocale(lesson, locale);
  const fallback = lesson.locale;
  /** @param {LText | undefined} text */
  const text = (text) => resolveText(text, used, fallback).value;
  const wanted = sectionIds === undefined || sectionIds === 'all' ? null : new Set(sectionIds);
  return {
    id: lesson.id,
    title: text(lesson.title),
    ...(lesson.subtitle !== undefined ? { subtitle: text(lesson.subtitle) } : {}),
    estMinutes: lesson.estMinutes,
    ...(lesson.level ? { level: lesson.level } : {}),
    ...(lesson.prerequisites ? { prerequisites: lesson.prerequisites.map(text) } : {}),
    objectives: (lesson.objectives ?? []).map((o) => ({ id: o.id, text: text(o.text), bloom: o.bloom })),
    sections: lesson.sections
      .filter((section) => !wanted || wanted.has(section.id))
      .map((section) => ({
        id: section.id,
        title: text(section.title),
        ...(section.role ? { role: section.role } : {}),
        blocks: section.blocks.map((block) => learnerBlock(block, used, fallback)),
      })),
    ...(lesson.glossary ? { glossary: lesson.glossary.map((g) => ({ term: text(g.term), md: text(g.md) })) } : {}),
    ...(lesson.sources ? {
      sources: lesson.sources.map((s) => ({
        id: s.id,
        title: s.title,
        ...(s.url ? { url: s.url } : {}),
        ...(s.publisher ? { publisher: s.publisher } : {}),
      })),
    } : {}),
    locale: used,
    available_locales: availableLocales(lesson),
  };
}

/**
 * A short map of the lesson (for the first read): objectives, sections with the question ids
 * they hold, and the glossary terms. One locale, no answers.
 *
 * @param {Lesson} lesson
 * @param {{ locale?: unknown }} [options]
 */
export function lessonOutline(lesson, { locale } = {}) {
  const used = learnerLocale(lesson, locale);
  /** @param {LText | undefined} text */
  const text = (text) => resolveText(text, used, lesson.locale).value;
  return {
    id: lesson.id,
    title: text(lesson.title),
    objectives: (lesson.objectives ?? []).map((o) => ({ id: o.id, text: text(o.text), bloom: o.bloom })),
    sections: lesson.sections.map((section) => ({
      id: section.id,
      title: text(section.title),
      ...(section.role ? { role: section.role } : {}),
      question_ids: section.blocks.flatMap((block) => (block.type === 'quiz' ? block.questions.map((q) => q.id) : [])),
    })),
    glossary_terms: (lesson.glossary ?? []).map((g) => text(g.term)),
    locale: used,
    available_locales: availableLocales(lesson),
  };
}
