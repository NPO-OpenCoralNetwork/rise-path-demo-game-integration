// @ts-check
/**
 * risepath.lesson/v1 and risepath.course/v1: the one definition of Rise Path learning content.
 *
 * Imported by the CLI (scripts/lessons/*), the server and MCP tools, and the Vite/TS frontend
 * (allowJs). Values are zod/v4 schemas; each schema has a same-named JSDoc type, so TS code can
 * write `import type { Lesson, Block } from '.../shared/lesson/schema.js'`.
 * zod adds about 75 kB to a browser bundle: reader code should import types only, plus the
 * zod-free modules (constants.js, text.js, walk.js, lint.js), and load schema.js/validate.js lazily.
 *
 * Text fields use `LText` = `string | {jp?, en?, fr?}`. A plain string is in `lesson.locale`.
 * The JSON Schema files in content/schema/ are generated from this file
 * (`npm run lessons:schema`); never edit them by hand.
 */
import * as z from 'zod/v4';

import {
  LESSON_SCHEMA_ID, COURSE_SCHEMA_ID, LOCALES, ID_PATTERN, BLOCK_TYPES, SECTION_ROLES,
  CALLOUT_VARIANTS, QUIZ_MODES, BLOOM_LEVELS, WORLDS,
} from './constants.js';

export {
  LESSON_SCHEMA_ID, COURSE_SCHEMA_ID, LOCALES, ID_PATTERN, BLOCK_TYPES, SECTION_ROLES,
  CALLOUT_VARIANTS, QUIZ_MODES, BLOOM_LEVELS, WORLDS,
};

/**
 * Named schemas go in this registry so the JSON Schema export can emit them as `$defs`.
 * A local registry (not z.globalRegistry) keeps Vite HMR re-evaluation from hitting duplicate ids.
 */
export const schemaRegistry = /** @type {z.core.$ZodRegistry<{ id?: string, description?: string }>} */ (z.registry());

/**
 * @template {z.ZodType} T
 * @param {T} schema
 * @param {string} id
 * @param {string} description
 * @returns {T}
 */
const named = (schema, id, description) => {
  schemaRegistry.add(/** @type {z.ZodType} */ (schema), { id, description });
  return schema;
};

/** @param {string} description */
const localized = (description) => z.union([
  z.string(),
  z.strictObject({
    jp: z.string().optional(),
    en: z.string().optional(),
    fr: z.string().optional(),
  }),
]).describe(description);

// --- Primitives -----------------------------------------------------------------------------

export const Locale = named(z.enum(LOCALES), 'Locale', 'Content locale key. "jp" is Japanese (BCP-47 "ja").');

export const LText = named(
  localized('Plain text. A string is in lesson.locale; an object holds one string per locale.'),
  'LText',
  'Localized plain text: a string (in lesson.locale) or {jp?, en?, fr?}.',
);

export const Md = named(
  localized('Inline markdown: **bold**, *italic*, `code`, [link](https://…), [[glossary term]], line breaks.'),
  'Md',
  'Localized inline markdown: a string (in lesson.locale) or {jp?, en?, fr?}.',
);

export const Id = z.string().regex(ID_PATTERN).describe('Stable id: lowercase letters, digits, ".", "_" or "-". Unique within the lesson.');

export const Bloom = named(z.enum(BLOOM_LEVELS), 'Bloom', 'Bloom taxonomy level of an objective or question.');

const blockBase = {
  id: Id,
  slide: z.boolean().optional().describe('false hides the block in Slides mode.'),
  narration: LText.optional().describe('Spoken text for Slides/listen mode (TTS).'),
  cite: z.array(Id).optional().describe('Ids of lesson.sources (or course.sources) that back this block.'),
};

// --- Blocks ---------------------------------------------------------------------------------

export const MarkdownBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('markdown'),
  md: Md,
  style: z.enum(['normal', 'lead', 'quote']).optional(),
}), 'MarkdownBlock', 'Prose paragraph(s). Keep each paragraph within 160 JP characters / 80 EN words.');

export const CalloutBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('callout'),
  variant: z.enum(CALLOUT_VARIANTS),
  title: LText.optional(),
  md: Md,
}), 'CalloutBlock', 'Highlighted note. At most 2 per section; an analogy goes before the formal definition.');

export const ListBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('list'),
  style: z.enum(['bullet', 'number', 'check']).optional(),
  items: z.array(Md).min(1),
}), 'ListBlock', 'Bulleted, numbered or check list (7 items max). Use definitions for "label: description" items.');

export const DefinitionsBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('definitions'),
  items: z.array(z.strictObject({ term: LText, md: Md })).min(1),
}), 'DefinitionsBlock', 'Term / description pairs, rendered as a definition list.');

export const TableBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('table'),
  caption: LText.optional(),
  columns: z.array(LText).min(1),
  rows: z.array(z.array(Md)).min(1),
}), 'TableBlock', 'Data table (6 columns max). Every row has one cell per column.');

export const CodeBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('code'),
  lang: z.string().min(1).describe('Language id for highlighting, e.g. ts, bash, json, python.'),
  code: z.string().min(1),
  filename: z.string().optional().describe('Shown in the code header. Recommended.'),
  highlight: z.array(z.number().int().min(1)).optional().describe('1-based line numbers to emphasize.'),
}), 'CodeBlock', 'Source code (25 lines max inline). Instructions to an AI go in a prompt block, not here.');

export const PromptBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('prompt'),
  title: LText.optional(),
  prompt: LText.describe('The instruction to give an AI. {{name}} marks an editable variable.'),
  target: z.enum(['any', 'claude', 'claude-code', 'chatgpt', 'gemini']).optional(),
  vars: z.array(z.strictObject({
    name: z.string().min(1).describe('Variable name as written inside {{ }} in the prompt.'),
    hint: LText.optional(),
  })).optional(),
  expect: Md.optional().describe('What a good AI answer looks like (shown collapsed).'),
  note: Md.optional(),
}), 'PromptBlock', 'A prompt the learner can copy into an AI tool. Every example instruction to an AI uses this block.');

export const DiagramBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('diagram'),
  engine: z.literal('mermaid'),
  code: LText.describe('Mermaid source (flowchart, sequence, er, mindmap, …). May be localized per locale.'),
  caption: LText.optional(),
  alt: LText.describe('Short text alternative for screen readers.'),
  description: Md.optional().describe('Longer prose explanation shown under the figure.'),
}), 'DiagramBlock', 'Mermaid diagram (12 nodes max) with caption and alt text. Mind maps use mermaid "mindmap" syntax.');

export const ImageBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('image'),
  src: z.string().min(1),
  alt: LText,
  caption: LText.optional(),
  layout: z.enum(['inline', 'wide']).optional(),
  decorative: z.boolean().optional().describe('Decorative images belong on the course cover only.'),
}), 'ImageBlock', 'A teaching image (screenshot, comparison). Alt text is required.');

export const QuizOption = named(z.strictObject({
  id: z.string().regex(ID_PATTERN),
  md: Md,
  feedback: Md.optional().describe('Shown when this option is picked. Required for wrong options: name and correct the misconception in 2 sentences.'),
}), 'QuizOption', 'One answer option.');

export const QuizQuestion = named(z.strictObject({
  id: Id,
  kind: z.enum(['single', 'multi', 'truefalse']).optional().describe('Defaults to single.'),
  prompt: Md,
  options: z.array(QuizOption).min(2),
  answer: z.array(z.string()).min(1).describe('Ids of the correct options.'),
  explanation: Md,
  hint: Md.optional(),
  objectiveId: Id.optional().describe('The lesson objective this question assesses. Required when the lesson has objectives.'),
  bloom: Bloom.optional(),
}), 'QuizQuestion', 'A question with options, the correct option ids and an explanation.');

export const QuizBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('quiz'),
  mode: z.enum(QUIZ_MODES).describe('inline = a check while reading (確認しよう); exam = end-of-lesson test; predict = an ungraded prediction in the hook (the pick is not scored; the explanation is revealed after answering).'),
  title: LText.optional(),
  questions: z.array(QuizQuestion).min(1),
}), 'QuizBlock', 'Retrieval practice. Place an inline quiz at least every 2 sections.');

export const FlashcardsBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('flashcards'),
  cards: z.array(z.strictObject({ id: Id, front: Md, back: Md })).min(1),
}), 'FlashcardsBlock', 'Review cards (4–8 per lesson) that feed the review queue.');

export const StepsBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('steps'),
  items: z.array(z.strictObject({
    id: Id,
    title: LText,
    md: Md.optional(),
    keys: z.array(z.string()).optional().describe('Keyboard keys shown as <kbd> chips.'),
    expect: Md.optional().describe('Expected result of the step.'),
    hint: Md.optional(),
    troubleshoot: Md.optional(),
  })).min(1),
}), 'StepsBlock', 'A procedure (8 steps max), each with an expected result.');

export const ChecklistBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('checklist'),
  title: LText.optional(),
  items: z.array(z.strictObject({ id: Id, label: LText, md: Md.optional() })).min(1),
}), 'ChecklistBlock', 'Items the learner ticks off; state is saved.');

export const SummaryBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('summary'),
  title: LText.optional(),
  points: z.array(Md).min(1),
}), 'SummaryBlock', 'Key takeaways (3–5 points). Required in the last section.');

export const AskTutorBlock = named(z.strictObject({
  ...blockBase,
  type: z.literal('askTutor'),
  suggestions: z.array(LText).min(1),
}), 'AskTutorBlock', 'Suggested questions that open the AI tutor.');

export const Block = named(z.discriminatedUnion('type', [
  MarkdownBlock, CalloutBlock, ListBlock, DefinitionsBlock, TableBlock, CodeBlock, PromptBlock,
  DiagramBlock, ImageBlock, QuizBlock, FlashcardsBlock, StepsBlock, ChecklistBlock, SummaryBlock,
  AskTutorBlock,
]), 'Block', 'A lesson block, discriminated by "type".');

// --- Lesson -----------------------------------------------------------------------------------

export const SectionRole = named(z.enum(SECTION_ROLES), 'SectionRole', 'Pedagogical role of a section.');

export const Section = named(z.strictObject({
  id: Id,
  title: LText,
  role: SectionRole.optional(),
  blocks: z.array(Block).min(1),
}), 'Section', 'A titled group of blocks.');

export const Objective = named(z.strictObject({
  id: Id,
  text: LText.describe('Observable outcome, e.g. "…を説明できる" / "Explain …".'),
  bloom: Bloom,
}), 'Objective', 'What the learner can do after the lesson.');

export const Source = named(z.strictObject({
  id: Id,
  title: z.string().min(1),
  url: z.string().optional(),
  publisher: z.string().optional(),
  checkedAt: z.string().optional().describe('ISO date the source was last checked.'),
}), 'Source', 'A reference that blocks can cite.');

export const GlossaryEntry = named(z.strictObject({
  term: LText,
  md: Md,
  aliases: z.array(z.string()).optional(),
}), 'GlossaryEntry', 'A course or lesson glossary term, referenced inline as [[term]].');

export const LessonLink = named(z.strictObject({
  lessonId: Id,
  courseId: Id.optional().describe('Defaults to the same course.'),
}), 'LessonLink', 'Reference to another lesson.');

export const Provenance = named(z.strictObject({
  author: z.string().min(1).describe('Who wrote it, e.g. human, claude-code, human+claude-code, migration.'),
  model: z.string().optional(),
  skill: z.string().optional(),
  skillVersion: z.string().optional(),
  generatedAt: z.string().optional().describe('ISO timestamp.'),
  reviewedBy: z.string().optional(),
  migratedFrom: z.strictObject({
    source: z.string().min(1).describe('Repo-relative path of the legacy file.'),
    export: z.string().optional(),
    quizSource: z.string().optional(),
    quizExport: z.string().optional(),
    counts: z.record(z.string(), z.number().int().min(0)).optional().describe('Block/table counts of the legacy source.'),
  }).optional(),
}), 'Provenance', 'Authorship record.');

export const Lesson = named(z.strictObject({
  schema: z.literal(LESSON_SCHEMA_ID),
  id: Id.describe('Lesson id; the file is named <id>.lesson.json.'),
  courseId: Id.optional().describe('Slug of the course this lesson belongs to.'),
  title: LText,
  subtitle: LText.optional(),
  locale: Locale.describe('Source locale; plain strings are in this locale.'),
  locales: z.array(Locale).optional().describe('Locales that must be complete in every localized text.'),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  estMinutes: z.number().int().min(1).max(600).describe('Estimated minutes to finish (1–600).'),
  prerequisites: z.array(LText).optional().describe('What the learner should know first, e.g. an earlier lesson title.'),
  objectives: z.array(Objective).describe('2–4 observable objectives.'),
  sections: z.array(Section).min(1),
  next: LessonLink.optional(),
  glossary: z.array(GlossaryEntry).optional(),
  sources: z.array(Source).optional(),
  tags: z.array(z.string()).optional(),
  provenance: Provenance,
}), 'Lesson', 'A Rise Path lesson (risepath.lesson/v1).');

// --- Course -----------------------------------------------------------------------------------

export const LessonRef = named(z.strictObject({
  id: Id,
  title: LText,
  estMinutes: z.number().int().min(1).max(600).optional(),
  next: LessonLink.optional(),
}), 'LessonRef', 'A lesson entry in a course module; the lesson file is lessons/<id>.lesson.json.');

export const Module = named(z.strictObject({
  id: Id,
  title: LText,
  summary: Md.optional(),
  lessons: z.array(LessonRef).min(1),
}), 'Module', 'An ordered group of lessons.');

export const Course = named(z.strictObject({
  schema: z.literal(COURSE_SCHEMA_ID),
  id: Id.describe('Course slug; also the folder name under content/courses/.'),
  world: z.enum(WORLDS).describe('Accent world of the reader (data-world).'),
  title: LText,
  subtitle: LText.optional(),
  description: Md.optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  locale: Locale,
  locales: z.array(Locale).optional(),
  modules: z.array(Module).min(1),
  glossary: z.array(GlossaryEntry).optional(),
  sources: z.array(Source).optional(),
  tags: z.array(z.string()).optional(),
  provenance: Provenance.optional(),
}), 'Course', 'A Rise Path course (risepath.course/v1).');

// --- Types ------------------------------------------------------------------------------------

/** @typedef {z.infer<typeof Locale>} Locale */
/** @typedef {z.infer<typeof LText>} LText */
/** @typedef {z.infer<typeof Md>} Md */
/** @typedef {z.infer<typeof Bloom>} Bloom */
/** @typedef {z.infer<typeof MarkdownBlock>} MarkdownBlock */
/** @typedef {z.infer<typeof CalloutBlock>} CalloutBlock */
/** @typedef {z.infer<typeof ListBlock>} ListBlock */
/** @typedef {z.infer<typeof DefinitionsBlock>} DefinitionsBlock */
/** @typedef {z.infer<typeof TableBlock>} TableBlock */
/** @typedef {z.infer<typeof CodeBlock>} CodeBlock */
/** @typedef {z.infer<typeof PromptBlock>} PromptBlock */
/** @typedef {z.infer<typeof DiagramBlock>} DiagramBlock */
/** @typedef {z.infer<typeof ImageBlock>} ImageBlock */
/** @typedef {z.infer<typeof QuizOption>} QuizOption */
/** @typedef {z.infer<typeof QuizQuestion>} QuizQuestion */
/** @typedef {z.infer<typeof QuizBlock>} QuizBlock */
/** @typedef {z.infer<typeof FlashcardsBlock>} FlashcardsBlock */
/** @typedef {z.infer<typeof StepsBlock>} StepsBlock */
/** @typedef {z.infer<typeof ChecklistBlock>} ChecklistBlock */
/** @typedef {z.infer<typeof SummaryBlock>} SummaryBlock */
/** @typedef {z.infer<typeof AskTutorBlock>} AskTutorBlock */
/** @typedef {z.infer<typeof Block>} Block */
/** @typedef {Block['type']} BlockType */
/** @typedef {z.infer<typeof SectionRole>} SectionRole */
/** @typedef {z.infer<typeof Section>} Section */
/** @typedef {z.infer<typeof Objective>} Objective */
/** @typedef {z.infer<typeof Source>} Source */
/** @typedef {z.infer<typeof GlossaryEntry>} GlossaryEntry */
/** @typedef {z.infer<typeof LessonLink>} LessonLink */
/** @typedef {z.infer<typeof Provenance>} Provenance */
/** @typedef {z.infer<typeof Lesson>} Lesson */
/** @typedef {z.infer<typeof LessonRef>} LessonRef */
/** @typedef {z.infer<typeof Module>} Module */
/** @typedef {z.infer<typeof Course>} Course */
