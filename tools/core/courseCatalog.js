// @ts-check
/**
 * Shared Business Logic — the published course catalog (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6).
 *
 * The lessons a learner can have progress in, as the server sees them: for each
 * content/courses/<slug>/course.json, the lessons its modules list, read from
 * lessons/<id>.lesson.json only (never drafts/, briefs/, reports/ or content/examples/: the
 * images copy the whole working tree, drafts included). Used by the progress API
 * (server/routes/lessonProgress.js) and the MCP course-* tools, through tools/core/lessonProgress.js.
 *
 * One id rule everywhere (the lesson_progress CHECK, the client's syncable test, the MCP
 * arguments): course slugs and lesson ids match SAFE_SLUG and are at most 80 characters. A course
 * folder must equal its course.id; a course or lesson that breaks the rule, fails
 * shared/lesson/validate.js, or is missing is left out and logged once (the catalog is built once
 * per content directory per process), so a stored record can never fail the table's CHECK.
 *
 * RP_CONTENT_DIR overrides the content root (tests, smoke), the same as tools/core/lessons.js.
 * Each lesson carries its progress index (shared/lesson/progressMerge.js lessonIndex) and its hash
 * (shared/lesson/hash.js lessonHash, the review hash: provenance-only edits keep it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveContentDir, SAFE_SLUG, MAX_SLUG_LENGTH } from './lessons.js';
import { validateCourse, validateLesson } from '../../shared/lesson/validate.js';
import { lessonHash } from '../../shared/lesson/hash.js';
import { lessonIndex } from '../../shared/lesson/progressMerge.js';
import { learnerLocale, availableLocales } from '../../shared/lesson/learnerView.js';
import { resolveText } from '../../shared/lesson/text.js';

/**
 * @typedef {import('../../shared/lesson/schema.js').Course} Course
 * @typedef {import('../../shared/lesson/schema.js').Lesson} Lesson
 * @typedef {import('../../shared/lesson/schema.js').LessonRef} LessonRef
 * @typedef {import('../../shared/lesson/schema.js').Module} Module
 * @typedef {import('../../shared/lesson/progressMerge.js').LessonIndex} LessonIndex
 * @typedef {import('../../shared/lesson/text.js').Locale} Locale
 *
 * @typedef {object} PublishedLesson
 * @property {string} courseSlug
 * @property {Course} course
 * @property {Module} module the module that lists the lesson
 * @property {LessonRef} ref its entry in course.json
 * @property {Lesson} lesson the full lesson (with answers: server side only)
 * @property {LessonIndex} index
 * @property {string} hash
 *
 * @typedef {object} PublishedCourse
 * @property {string} slug
 * @property {Course} course
 * @property {Map<string, PublishedLesson>} lessons lesson id → lesson, in module order
 */

/**
 * A course slug or lesson id the server stores progress for: SAFE_SLUG, at most 80 characters.
 * @param {unknown} value
 * @returns {value is string}
 */
export const isSafeSlug = (value) => typeof value === 'string' && value.length <= MAX_SLUG_LENGTH && SAFE_SLUG.test(value);

/** @type {Map<string, Map<string, PublishedCourse>>} content dir → courses (folder order) */
const cache = new Map();

/** @param {string} message */
const skip = (message) => console.warn(`[courseCatalog] left out: ${message}`);

/**
 * @param {string} file
 * @returns {unknown} the parsed JSON, or undefined when it cannot be read or parsed
 */
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}

/**
 * Reads one course folder; null when the course is left out.
 * @param {string} coursesDir
 * @param {string} slug
 * @returns {PublishedCourse | null}
 */
function loadCourse(coursesDir, slug) {
    const where = `courses/${slug}`;
    if (!isSafeSlug(slug)) {
        skip(`${where} (the folder name must be lowercase letters, digits and "-", at most ${MAX_SLUG_LENGTH} characters)`);
        return null;
    }
    const json = readJson(path.join(coursesDir, slug, 'course.json'));
    if (json === undefined) {
        skip(`${where}/course.json (missing or not JSON)`);
        return null;
    }
    const checked = validateCourse(json, { folder: slug });
    if (!checked.ok || !checked.course) {
        skip(`${where}/course.json (${checked.errors.length} validation error(s), first: ${checked.errors[0]?.path ?? ''} ${checked.errors[0]?.message ?? ''})`);
        return null;
    }
    // The raw JSON (the schema is strict, so it has no other fields): the same object the web
    // reader bundles, so grading and pct/state match it exactly.
    const course = /** @type {Course} */ (json);

    /** @type {Map<string, PublishedLesson>} */
    const lessons = new Map();
    for (const module of course.modules) {
        for (const ref of module.lessons) {
            const at = `${where}/lessons/${ref.id}.lesson.json`;
            if (lessons.has(ref.id)) continue;
            if (!isSafeSlug(ref.id)) {
                skip(`${at} (the lesson id must be lowercase letters, digits and "-", at most ${MAX_SLUG_LENGTH} characters)`);
                continue;
            }
            const lessonJson = readJson(path.join(coursesDir, slug, 'lessons', `${ref.id}.lesson.json`));
            if (lessonJson === undefined) {
                skip(`${at} (missing or not JSON)`);
                continue;
            }
            const result = validateLesson(lessonJson, { course: checked.course });
            if (!result.ok || !result.lesson || result.lesson.id !== ref.id) {
                const first = result.errors[0];
                skip(`${at} (${first ? `${first.path} ${first.message}` : 'the lesson id must equal the file name'})`);
                continue;
            }
            const lesson = /** @type {Lesson} */ (lessonJson);
            lessons.set(ref.id, { courseSlug: slug, course, module, ref, lesson, index: lessonIndex(lesson), hash: lessonHash(lesson) });
        }
    }
    return { slug, course, lessons };
}

/**
 * The catalog of the current content directory (RP_CONTENT_DIR or <repo>/content), built once.
 * @returns {Map<string, PublishedCourse>}
 */
function catalog() {
    const contentDir = resolveContentDir();
    const cached = cache.get(contentDir);
    if (cached) return cached;
    /** @type {Map<string, PublishedCourse>} */
    const courses = new Map();
    const coursesDir = path.join(contentDir, 'courses');
    let folders = /** @type {string[]} */ ([]);
    try {
        folders = fs.readdirSync(coursesDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        console.warn('[courseCatalog] no content/courses directory: no published courses');
    }
    for (const slug of folders) {
        const course = loadCourse(coursesDir, slug);
        if (course) courses.set(slug, course);
    }
    cache.set(contentDir, courses);
    return courses;
}

/** Forgets every built catalog (tests switch RP_CONTENT_DIR or edit files). */
export function clearCatalogCacheForTests() {
    cache.clear();
}

/**
 * One published lesson, or null when the course or lesson is not published (or breaks the id rule).
 * @param {unknown} courseSlug
 * @param {unknown} lessonId
 * @returns {PublishedLesson | null}
 */
export function getPublishedLesson(courseSlug, lessonId) {
    if (!isSafeSlug(courseSlug) || !isSafeSlug(lessonId)) return null;
    return catalog().get(courseSlug)?.lessons.get(lessonId) ?? null;
}

/**
 * @param {unknown} courseSlug
 * @param {unknown} lessonId
 * @returns {boolean}
 */
export function isPublishedLesson(courseSlug, lessonId) {
    return getPublishedLesson(courseSlug, lessonId) !== null;
}

/**
 * Every published lesson in catalog order (courses by folder name, lessons in module order),
 * optionally of one course.
 * @param {{ courseSlug?: string }} [options]
 * @returns {PublishedLesson[]}
 */
export function listPublishedLessons({ courseSlug } = {}) {
    const courses = [...catalog().values()].filter((c) => courseSlug === undefined || c.slug === courseSlug);
    return courses.flatMap((c) => [...c.lessons.values()]);
}

/**
 * The published courses for a learner's AI app, in one locale (the requested one when the course
 * has it, otherwise its source locale): modules and lessons with their size. No answers.
 *
 * @param {{ locale?: unknown }} [options]
 */
export function listPublishedCourses({ locale } = {}) {
    return [...catalog().values()]
        .filter((entry) => entry.lessons.size > 0)
        .map(({ slug, course, lessons }) => {
            // A course has the same locale fields as a lesson.
            const used = learnerLocale(/** @type {Lesson} */ (/** @type {unknown} */ (course)), locale);
            /** @param {import('../../shared/lesson/text.js').LText | undefined} text */
            const text = (text) => resolveText(text, used, course.locale).value;
            return {
                course_slug: slug,
                title: text(course.title),
                ...(course.subtitle !== undefined ? { subtitle: text(course.subtitle) } : {}),
                ...(course.description !== undefined ? { description: text(course.description) } : {}),
                ...(course.level ? { level: course.level } : {}),
                locale: used,
                available_locales: availableLocales(/** @type {Lesson} */ (/** @type {unknown} */ (course))),
                modules: course.modules
                    .map((module) => ({
                        id: module.id,
                        title: text(module.title),
                        lessons: module.lessons
                            .filter((ref) => lessons.get(ref.id)?.module === module)
                            .map((ref) => {
                                const entry = /** @type {PublishedLesson} */ (lessons.get(ref.id));
                                const questions = [...entry.index.questions.values()];
                                return {
                                    id: ref.id,
                                    title: text(ref.title),
                                    estMinutes: ref.estMinutes ?? entry.lesson.estMinutes,
                                    questions: questions.length,
                                    hasExam: questions.some((q) => q.mode === 'exam'),
                                };
                            }),
                    }))
                    .filter((module) => module.lessons.length > 0),
            };
        });
}
