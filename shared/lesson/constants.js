// @ts-check
/**
 * Constants of risepath.lesson/v1 without the zod dependency, so the reader bundle can use them.
 * shared/lesson/schema.js re-exports everything here.
 */

export const LESSON_SCHEMA_ID = 'risepath.lesson/v1';
export const COURSE_SCHEMA_ID = 'risepath.course/v1';

/** Locale keys match the existing app data (`jp`, not BCP-47 `ja`). */
export const LOCALES = /** @type {const} */ (['jp', 'en', 'fr']);
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** The MVP block union. Mind maps are `diagram` blocks in mermaid "mindmap" syntax. */
export const BLOCK_TYPES = /** @type {const} */ ([
  'markdown', 'callout', 'list', 'definitions', 'table', 'code', 'prompt', 'diagram',
  'image', 'quiz', 'flashcards', 'steps', 'checklist', 'summary', 'askTutor',
]);
export const SECTION_ROLES = /** @type {const} */ ([
  'hook', 'concept', 'example', 'practice', 'check', 'pitfalls', 'summary', 'reflection',
]);
export const CALLOUT_VARIANTS = /** @type {const} */ ([
  'tip', 'warning', 'info', 'analogy', 'pitfall', 'note', 'success',
]);
export const QUIZ_MODES = /** @type {const} */ (['inline', 'exam', 'predict']);
export const BLOOM_LEVELS = /** @type {const} */ ([
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
]);
/** Reader accent worlds (`data-world`). */
export const WORLDS = /** @type {const} */ ([
  'vibe', 'art', 'unity', 'ai', 'sonic', 'pschool', 'blender', 'web',
]);
