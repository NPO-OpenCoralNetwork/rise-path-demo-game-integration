// @ts-check
/**
 * Structural (zod) and semantic validation for risepath.lesson/v1 and risepath.course/v1.
 * Errors carry a JS-style path such as `sections[2].blocks[0].questions[0].answer[0]`.
 *
 * Semantic checks: ids unique across the lesson, quiz answers point at option ids,
 * objectiveId exists (and is set when the lesson has objectives), every declared locale is
 * present in localized texts, diagrams have code and alt text, table rows match the columns,
 * cite ids exist, next.lessonId exists in the course.
 *
 * @typedef {import('./schema.js').Lesson} Lesson
 * @typedef {import('./schema.js').Course} Course
 * @typedef {import('./schema.js').Locale} Locale
 * @typedef {import('./schema.js').LText} LText
 * @typedef {{ path: string, message: string }} ValidationError
 */
import { Lesson as LessonSchema, Course as CourseSchema, BLOCK_TYPES, ID_PATTERN, LOCALES } from './schema.js';
import { forEachBlock, forEachLessonText, forEachCourseText, formatPath, courseLessonIds } from './walk.js';

/**
 * @param {unknown} root
 * @param {readonly PropertyKey[]} path
 * @returns {unknown}
 */
function valueAt(root, path) {
  /** @type {any} */
  let cur = root;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[/** @type {any} */ (key)];
  }
  return cur;
}

/**
 * Turns one zod issue into readable errors. Union failures are unpacked to the most
 * specific branch so authors see "unknown field" instead of "Invalid input".
 *
 * @param {any} issue
 * @param {unknown} input
 * @param {readonly PropertyKey[]} [prefix]
 * @returns {ValidationError[]}
 */
function issueToErrors(issue, input, prefix = []) {
  const path = [...prefix, ...(issue.path || [])];
  const at = formatPath(path);
  switch (issue.code) {
    case 'invalid_union': {
      if (issue.note === 'No matching discriminator') {
        const value = valueAt(input, path);
        if (value === undefined) return [{ path: at, message: 'Missing block "type".' }];
        return [{ path: at, message: `Unknown block type ${JSON.stringify(value)}. Expected one of: ${BLOCK_TYPES.join(', ')}.` }];
      }
      // Pick the branch that got furthest (fewest top-level type mismatches).
      const branches = (issue.errors || []).filter((/** @type {any[]} */ b) => b.length > 0);
      const informative = branches.find((/** @type {any[]} */ b) => b.every((i) => !(i.code === 'invalid_type' && (i.path || []).length === 0)));
      if (informative) return informative.flatMap((/** @type {any} */ i) => issueToErrors(i, input, path));
      return [{ path: at, message: 'Expected text: a string or an object with "jp", "en" and/or "fr" strings.' }];
    }
    case 'unrecognized_keys':
      return [{ path: at, message: `Unknown field${issue.keys.length > 1 ? 's' : ''}: ${issue.keys.map((/** @type {string} */ k) => `"${k}"`).join(', ')}.` }];
    case 'invalid_format':
      if (issue.format === 'regex' && String(issue.pattern) === String(ID_PATTERN)) {
        return [{ path: at, message: `Invalid id ${JSON.stringify(valueAt(input, path))}: use lowercase letters, digits, ".", "_" or "-" (must start with a letter or digit).` }];
      }
      return [{ path: at, message: issue.message }];
    case 'invalid_type':
      if (valueAt(input, path) === undefined) return [{ path: at, message: `Required field is missing (expected ${issue.expected}).` }];
      return [{ path: at, message: issue.message }];
    default:
      return [{ path: at, message: issue.message }];
  }
}

/**
 * @param {readonly any[]} issues
 * @param {unknown} input
 * @returns {ValidationError[]}
 */
function zodErrors(issues, input) {
  /** @type {ValidationError[]} */
  const errors = [];
  const seen = new Set();
  for (const issue of issues) {
    for (const error of issueToErrors(issue, input)) {
      const key = `${error.path}\u0000${error.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(error);
      }
    }
  }
  return errors;
}

/**
 * Checks one localized text against the declared locales.
 *
 * @param {LText} text
 * @param {(string | number)[]} path
 * @param {string} kind
 * @param {Locale[]} locales
 * @param {ValidationError[]} errors
 */
function checkText(text, path, kind, locales, errors) {
  const at = formatPath(path);
  if (typeof text === 'string') {
    if (text.trim() === '') errors.push({ path: at, message: 'Text is empty.' });
    return;
  }
  const present = LOCALES.filter((key) => typeof text[key] === 'string' && /** @type {string} */ (text[key]).trim() !== '');
  if (present.length === 0) {
    errors.push({ path: at, message: 'Text is empty in every locale.' });
    return;
  }
  for (const locale of locales) {
    if (!present.includes(locale)) {
      errors.push({
        path: formatPath([...path, locale]),
        message: `Missing "${locale}" ${kind === 'verbatim' ? 'version' : 'text'} (declared locales: ${locales.join(', ')}).`,
      });
    }
  }
}

/**
 * @param {{ locale: Locale, locales?: Locale[] }} doc
 * @param {ValidationError[]} errors
 * @returns {Locale[]}
 */
function declaredLocales(doc, errors) {
  const locales = doc.locales && doc.locales.length > 0 ? [...new Set(doc.locales)] : [doc.locale];
  if (!locales.includes(doc.locale)) {
    errors.push({ path: 'locales', message: `locales must include the source locale "${doc.locale}".` });
  }
  return locales;
}

/**
 * @param {Lesson} lesson
 * @param {{ course?: Course | null }} options
 * @returns {ValidationError[]}
 */
function semanticLessonErrors(lesson, { course }) {
  /** @type {ValidationError[]} */
  const errors = [];

  // Ids: one namespace per lesson, because progress, anchors and review comments key on them.
  /** @type {Map<string, string>} */
  const ids = new Map();
  /**
   * @param {string} id
   * @param {(string | number)[]} path
   */
  const claim = (id, path) => {
    const at = formatPath(path);
    const first = ids.get(id);
    if (first) errors.push({ path: at, message: `Duplicate id "${id}" (first used at ${first}).` });
    else ids.set(id, at);
  };
  lesson.objectives.forEach((o, i) => claim(o.id, ['objectives', i, 'id']));
  lesson.sections.forEach((s, i) => claim(s.id, ['sections', i, 'id']));
  forEachBlock(lesson, (block, path) => {
    claim(block.id, [...path, 'id']);
    if (block.type === 'quiz') block.questions.forEach((q, qi) => claim(q.id, [...path, 'questions', qi, 'id']));
    if (block.type === 'flashcards') block.cards.forEach((c, ci) => claim(c.id, [...path, 'cards', ci, 'id']));
    if (block.type === 'steps' || block.type === 'checklist') block.items.forEach((it, ii) => claim(it.id, [...path, 'items', ii, 'id']));
  });

  const objectiveIds = new Set(lesson.objectives.map((o) => o.id));
  const sourceIds = new Set([...(lesson.sources || []), ...((course && course.sources) || [])].map((s) => s.id));

  forEachBlock(lesson, (block, path) => {
    (block.cite || []).forEach((id, i) => {
      if (!sourceIds.has(id)) errors.push({ path: formatPath([...path, 'cite', i]), message: `Unknown source "${id}" (add it to lesson.sources).` });
    });

    if (block.type === 'quiz') {
      block.questions.forEach((q, qi) => {
        const qPath = [...path, 'questions', qi];
        const optionIds = q.options.map((o) => o.id);
        const optionSet = new Set();
        q.options.forEach((o, oi) => {
          if (optionSet.has(o.id)) errors.push({ path: formatPath([...qPath, 'options', oi, 'id']), message: `Duplicate option id "${o.id}".` });
          optionSet.add(o.id);
        });
        q.answer.forEach((a, ai) => {
          if (!optionSet.has(a)) {
            errors.push({ path: formatPath([...qPath, 'answer', ai]), message: `Answer "${a}" is not an option id (options: ${optionIds.join(', ')}).` });
          }
        });
        if (new Set(q.answer).size !== q.answer.length) errors.push({ path: formatPath([...qPath, 'answer']), message: 'Answer lists the same option twice.' });
        const kind = q.kind || 'single';
        if (kind !== 'multi' && q.answer.length !== 1) {
          errors.push({ path: formatPath([...qPath, 'answer']), message: `A ${kind} question has exactly one answer (found ${q.answer.length}); use kind "multi" for several.` });
        }
        if (kind === 'multi' && q.answer.length === q.options.length) {
          errors.push({ path: formatPath([...qPath, 'answer']), message: 'Every option is correct; a multi question needs at least one wrong option.' });
        }
        if (kind === 'truefalse' && q.options.length !== 2) {
          errors.push({ path: formatPath([...qPath, 'options']), message: `A truefalse question has exactly 2 options (found ${q.options.length}).` });
        }
        if (q.objectiveId !== undefined && !objectiveIds.has(q.objectiveId)) {
          errors.push({ path: formatPath([...qPath, 'objectiveId']), message: `Unknown objective "${q.objectiveId}" (objectives: ${[...objectiveIds].join(', ') || 'none'}).` });
        }
        if (q.objectiveId === undefined && objectiveIds.size > 0) {
          errors.push({ path: formatPath([...qPath, 'objectiveId']), message: 'objectiveId is required when the lesson has objectives.' });
        }
      });
    }

    if (block.type === 'table') {
      block.rows.forEach((row, ri) => {
        if (row.length !== block.columns.length) {
          errors.push({ path: formatPath([...path, 'rows', ri]), message: `Row has ${row.length} cells but the table has ${block.columns.length} columns.` });
        }
      });
    }

    if (block.type === 'prompt') {
      const names = new Set();
      (block.vars || []).forEach((v, vi) => {
        if (names.has(v.name)) errors.push({ path: formatPath([...path, 'vars', vi, 'name']), message: `Duplicate variable "${v.name}".` });
        names.add(v.name);
      });
    }

    if (block.type === 'code' && block.highlight) {
      const lineCount = block.code.split('\n').length;
      block.highlight.forEach((line, li) => {
        if (line > lineCount) errors.push({ path: formatPath([...path, 'highlight', li]), message: `Line ${line} is past the end of the code (${lineCount} lines).` });
      });
    }
  });

  // Locales: every localized object must contain every declared locale.
  const locales = declaredLocales(lesson, errors);
  forEachLessonText(lesson, ({ text, path, kind }) => checkText(text, path, kind, locales, errors));

  if (lesson.next) {
    const sameCourse = !lesson.next.courseId || (course && lesson.next.courseId === course.id);
    if (course && sameCourse && !courseLessonIds(course).includes(lesson.next.lessonId)) {
      errors.push({ path: 'next.lessonId', message: `Lesson "${lesson.next.lessonId}" is not in course "${course.id}".` });
    }
    if (lesson.next.lessonId === lesson.id && sameCourse) {
      errors.push({ path: 'next.lessonId', message: 'A lesson cannot be its own next lesson.' });
    }
  }
  if (course && lesson.courseId && lesson.courseId !== course.id) {
    errors.push({ path: 'courseId', message: `courseId "${lesson.courseId}" does not match course "${course.id}".` });
  }

  return errors;
}

/**
 * Validates a lesson document. `lesson` is the parsed lesson when the structure is valid
 * (it may still have semantic errors), otherwise null.
 *
 * @param {unknown} json
 * @param {{ course?: Course | null }} [options] pass the course to check next.lessonId and course sources
 * @returns {{ ok: boolean, errors: ValidationError[], lesson: Lesson | null }}
 */
export function validateLesson(json, options = {}) {
  const parsed = LessonSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error.issues, json), lesson: null };
  const errors = semanticLessonErrors(parsed.data, { course: options.course || null });
  return { ok: errors.length === 0, errors, lesson: parsed.data };
}

/**
 * Validates a course document. Pass `lessonIds` (ids of the lesson files on disk) to check
 * that every listed lesson has a file and every file is listed.
 *
 * @param {unknown} json
 * @param {{ lessonIds?: string[] }} [options]
 * @returns {{ ok: boolean, errors: ValidationError[], course: Course | null }}
 */
export function validateCourse(json, options = {}) {
  const parsed = CourseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error.issues, json), course: null };
  const course = parsed.data;
  /** @type {ValidationError[]} */
  const errors = [];

  /** @type {Map<string, string>} */
  const moduleIds = new Map();
  /** @type {Map<string, string>} */
  const lessonIds = new Map();
  course.modules.forEach((m, mi) => {
    const at = formatPath(['modules', mi, 'id']);
    if (moduleIds.has(m.id)) errors.push({ path: at, message: `Duplicate module id "${m.id}" (first used at ${moduleIds.get(m.id)}).` });
    else moduleIds.set(m.id, at);
    m.lessons.forEach((l, li) => {
      const lat = formatPath(['modules', mi, 'lessons', li, 'id']);
      if (lessonIds.has(l.id)) errors.push({ path: lat, message: `Duplicate lesson id "${l.id}" (first used at ${lessonIds.get(l.id)}).` });
      else lessonIds.set(l.id, lat);
    });
  });
  course.modules.forEach((m, mi) => {
    m.lessons.forEach((l, li) => {
      if (l.next && (!l.next.courseId || l.next.courseId === course.id) && !lessonIds.has(l.next.lessonId)) {
        errors.push({ path: formatPath(['modules', mi, 'lessons', li, 'next', 'lessonId']), message: `Lesson "${l.next.lessonId}" is not in this course.` });
      }
    });
  });

  const locales = declaredLocales(course, errors);
  forEachCourseText(course, ({ text, path, kind }) => checkText(text, path, kind, locales, errors));

  if (options.lessonIds) {
    const files = new Set(options.lessonIds);
    for (const [id, at] of lessonIds) {
      if (!files.has(id)) errors.push({ path: at, message: `No lesson file lessons/${id}.lesson.json.` });
    }
    for (const id of files) {
      if (!lessonIds.has(id)) errors.push({ path: 'modules', message: `lessons/${id}.lesson.json is not listed in any module.` });
    }
  }

  return { ok: errors.length === 0, errors, course };
}
