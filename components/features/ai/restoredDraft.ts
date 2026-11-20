/**
 * What a restored course draft is waiting for, made readable without calling the model.
 *
 * The course generator (CourseGeneratorView.tsx) restores the latest unfinished draft on the way in
 * (GET /api/v2/ai/drafts, server/routes/ai.js). A draft keeps each stage's structured result, not
 * the AI's message: `intake_json` (the requirements, aiPrompts.js buildRequirementsPrompt) for
 * `draft_requirements`, `modules_json` (the roadmap, buildRoadmapPrompt) for `draft_roadmap`. These
 * helpers turn the pending one into rows and lists the screen shows (RestoredDraftPanel.tsx), so the
 * learner sees what they are asked to approve.
 *
 * Both are model output saved as JSON: any field can be missing, empty, a number, a `{ jp, en }`
 * object or something else. Nothing here throws, and every value handed to the screen is a string
 * (an object would take React down). No React or DOM imports, so server/tests can import this file.
 */

export type DraftLocale = 'en' | 'jp';
export type RestoredStage = 'requirements' | 'roadmap';

/** The restored draft: its pending stage and the two saved results, as the drafts route returns them. */
export type RestoredDraftSource = {
  stage: RestoredStage;
  intake_json?: unknown;
  modules_json?: unknown;
};

/** The intake fields the requirements prompt asks for, in its order (aiPrompts.js). */
export const INTAKE_FIELDS = ['goal', 'target_audience', 'current_level', 'duration_weeks', 'delivery_style', 'constraints'] as const;
export type IntakeField = typeof INTAKE_FIELDS[number];

/**
 * An amount the model wrote: a number, or digits as text ("4", "2.5"), or a range of them as text
 * ("4-6", "4〜6", spaces removed).
 */
export type Amount = number | string;

/** The screen's words (its `copy`), so the rows and the notice text read in its language. */
export type RestoredDraftLabels = {
  locale: DraftLocale;
  fields: Record<IntakeField, string>;
  /** delivery_style 'doc_chapter': the reader template generated courses use (server/routes/ai.js GENERATED_TEMPLATE_ID). */
  docChapter: string;
  weeks: (n: Amount) => string;
  module: (n: number) => string;
  hours: (n: Amount) => string;
  minutes: (n: Amount) => string;
};

/**
 * `lang: 'en'` on a field the model added under an English key: the label is that key as words
 * ("learning objectives"), so a screen reader reads it in English.
 */
export type RequirementRow = { key: string; label: string; value: string; lang?: 'en' };
export type RoadmapLesson = { title: string; subtitle: string; minutes: string };
/** `title` is '' when the model wrote none: the screen shows `label` ("Module 2") instead. */
export type RoadmapModule = { label: string; title: string; objective: string; hours: string; lessons: RoadmapLesson[] };

export type RestoredDraftContent =
  | { stage: 'requirements'; rows: RequirementRow[] }
  | { stage: 'roadmap'; modules: RoadmapModule[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Locale keys the model writes localized text with; `ja` is accepted for `jp`, as in server/routes/ai.js. */
const LOCALE_KEYS: Record<DraftLocale, readonly string[]> = { jp: ['jp', 'ja', 'en'], en: ['en', 'jp', 'ja'] };

/**
 * `{ jp, en }` as the model writes localized text (server/routes/ai.js isLocalizedText): a flat
 * object of strings with a non-empty `jp`, `ja` or `en`. The screen's language first, then the other.
 */
const localizedText = (value: unknown, locale: DraftLocale): string => {
  if (!isRecord(value)) return '';
  const values = Object.values(value);
  if (values.length === 0 || !values.every((item) => item == null || typeof item === 'string')) return '';
  return LOCALE_KEYS[locale].map((key) => trimmed(value[key])).find(Boolean) ?? '';
};

/** Words: a string or `{ jp, en }`; '' for anything else (a number is not a title). */
const wordsOf = (value: unknown, locale: DraftLocale): string => trimmed(value) || localizedText(value, locale);

/** Plain text from a string, a finite number or `{ jp, en }`; '' for anything else. */
const textOf = (value: unknown, locale: DraftLocale): string => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return wordsOf(value, locale);
};

const NUMBER = /^\d+(?:\.\d+)?$/;
const RANGE = /^\d+(?:\.\d+)?\s*[-~〜～–]\s*\d+(?:\.\d+)?$/;

/** An amount with its unit ("4 weeks", "約2〜3時間"); other text as written; '' when there is none. */
const amountOf = (value: unknown, unit: (n: Amount) => string, locale: DraftLocale): string => {
  if (typeof value === 'number') return Number.isFinite(value) ? unit(value) : '';
  const text = trimmed(value);
  if (NUMBER.test(text)) return unit(Number(text));
  if (RANGE.test(text)) return unit(text.replace(/\s+/g, ''));
  return textOf(value, locale);
};

/** A list of texts on one line; items that are not text are left out. */
const listOf = (value: unknown[], locale: DraftLocale): string =>
  value.map((item) => textOf(item, locale)).filter(Boolean).join(locale === 'jp' ? '、' : ', ');

/** A key the prompt does not ask for, as words ("learning_objectives" → "learning objectives"). */
const keyLabel = (key: string): string => key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const isIntakeField = (key: string): key is IntakeField => (INTAKE_FIELDS as readonly string[]).includes(key);

/**
 * Ids are not requirements the learner approves, and mean nothing on screen: the server may keep
 * some in intake_json for itself, such as the ids of the files attached to the conversation
 * (`attached_material_ids`, kept there once course generation reads the learner's materials).
 */
const isIdField = (key: string): boolean => /(?:^|_)ids?$/i.test(key);

const requirementValue = (key: string, value: unknown, labels: RestoredDraftLabels): string => {
  const { locale } = labels;
  if (key === 'duration_weeks') return amountOf(value, labels.weeks, locale);
  if (key === 'delivery_style' && trimmed(value) === 'doc_chapter') return labels.docChapter;
  if (Array.isArray(value)) return listOf(value, locale);
  return textOf(value, locale);
};

/**
 * The requirements as rows: the prompt's fields in its order, then any other field the model added
 * (they go to the roadmap stage too). A field with no text (missing, empty, true/false, a nested
 * object) and an id field are left out.
 */
const requirementRows = (intake: unknown, labels: RestoredDraftLabels): RequirementRow[] => {
  if (!isRecord(intake)) return [];
  const own = Object.keys(intake).filter((key) => !isIdField(key));
  const keys = [...INTAKE_FIELDS.filter((key) => own.includes(key)), ...own.filter((key) => !isIntakeField(key))];
  return keys.flatMap((key): RequirementRow[] => {
    const value = requirementValue(key, intake[key], labels);
    if (isIntakeField(key)) return value ? [{ key, label: labels.fields[key], value }] : [];
    const label = keyLabel(key);
    if (!value || !label) return [];
    return [/^[\x20-\x7e]+$/.test(label) ? { key, label, value, lang: 'en' } : { key, label, value }];
  });
};

const roadmapLessons = (lessons: unknown, labels: RestoredDraftLabels): RoadmapLesson[] => {
  if (!Array.isArray(lessons)) return [];
  const { locale } = labels;
  return lessons.flatMap((lesson) => {
    // A lesson written as words alone ("変数", `{ jp, en }`) is its title.
    const words = wordsOf(lesson, locale);
    if (words) return [{ title: words, subtitle: '', minutes: '' }];
    if (!isRecord(lesson)) return [];
    const title = textOf(lesson.title, locale);
    const subtitle = textOf(lesson.subtitle, locale);
    if (!title && !subtitle) return [];
    return [{
      title: title || subtitle,
      subtitle: title && subtitle !== title ? subtitle : '',
      minutes: amountOf(lesson.estimated_min, labels.minutes, locale),
    }];
  });
};

/**
 * The roadmap's modules in order, numbered from 1. A module written as words alone is its title;
 * one with nothing to read (no title, objective or lesson) is left out, so the screen never asks
 * the learner to approve an empty card.
 */
const roadmapModules = (modules: unknown, labels: RestoredDraftLabels): RoadmapModule[] => {
  if (!Array.isArray(modules)) return [];
  const { locale } = labels;
  const readable = modules.flatMap((module) => {
    const words = wordsOf(module, locale);
    if (words) return [{ title: words, objective: '', hours: '', lessons: [] }];
    if (!isRecord(module)) return [];
    const entry = {
      title: textOf(module.title, locale),
      objective: textOf(module.objective, locale),
      hours: amountOf(module.estimated_hours, labels.hours, locale),
      lessons: roadmapLessons(module.lessons, labels),
    };
    return entry.title || entry.objective || entry.lessons.length > 0 ? [entry] : [];
  });
  return readable.map((entry, index) => ({ label: labels.module(index + 1), ...entry }));
};

/**
 * The pending stage's content, or null when the saved result has nothing to show (the stage's
 * reply could not be read, and the server saved null).
 */
export const restoredDraftContent = (source: RestoredDraftSource, labels: RestoredDraftLabels): RestoredDraftContent | null => {
  if (source.stage === 'roadmap') {
    const modules = roadmapModules(source.modules_json, labels);
    return modules.length > 0 ? { stage: 'roadmap', modules } : null;
  }
  const rows = requirementRows(source.intake_json, labels);
  return rows.length > 0 ? { stage: 'requirements', rows } : null;
};

/** The content as plain text: what a report of it sends (AiNotice `answer`). */
export const restoredDraftText = (content: RestoredDraftContent): string => {
  if (content.stage === 'requirements') return content.rows.map((row) => `${row.label}: ${row.value}`).join('\n');
  return content.modules.map((module) => [
    [module.label, module.title].filter(Boolean).join(': ') + (module.hours ? ` (${module.hours})` : ''),
    module.objective,
    ...module.lessons.map((lesson) => `- ${[lesson.title, lesson.subtitle].filter(Boolean).join(': ')}${lesson.minutes ? ` (${lesson.minutes})` : ''}`),
  ].filter(Boolean).join('\n')).join('\n\n');
};
