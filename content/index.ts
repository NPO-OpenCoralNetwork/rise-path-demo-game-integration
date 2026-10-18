/**
 * Content catalog for risepath.lesson/v1 (PLAN §9.1 contract).
 *
 * - Course files (`courses/<slug>/course.json`) are small and bundled eagerly.
 * - Lesson files (`courses/<slug>/lessons/<id>.lesson.json`) are lazy chunks, one per lesson.
 * - Drafts (`courses/<slug>/drafts/<id>.lesson.json`) exist only in dev builds. The
 *   `import.meta.env.DEV` guard is a build-time constant, so production bundles neither the
 *   draft files nor the code that loads them.
 * - The zod validator (~75 kB) is loaded only in dev, through `validateLessonDev`.
 *
 * Exports used by the reader and by other WPs: listCourses, getCourse, loadLesson,
 * lessonEntries, getLessonEntry, firstLessonId.
 */
import type { Course, Lesson, LessonRef, Module } from '../shared/lesson/schema.js';

type LessonLoader = () => Promise<unknown>;

const courseFiles = import.meta.glob('./courses/*/course.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const lessonFiles = import.meta.glob('./courses/*/lessons/*.lesson.json', { import: 'default' }) as Record<string, LessonLoader>;
const draftFiles: Record<string, LessonLoader> = import.meta.env.DEV
  ? (import.meta.glob('./courses/*/drafts/*.lesson.json', { import: 'default' }) as Record<string, LessonLoader>)
  : {};

const COURSE_PATH = /^\.\/courses\/([^/]+)\/course\.json$/;
const LESSON_PATH = /^\.\/courses\/([^/]+)\/(lessons|drafts)\/([^/]+)\.lesson\.json$/;

const courses = new Map<string, Course>();
for (const [path, json] of Object.entries(courseFiles)) {
  const match = COURSE_PATH.exec(path);
  if (!match || !json || typeof json !== 'object') continue;
  const course = json as Course;
  courses.set(match[1], course);
}

function indexLoaders(files: Record<string, LessonLoader>): Map<string, LessonLoader> {
  const out = new Map<string, LessonLoader>();
  for (const [path, loader] of Object.entries(files)) {
    const match = LESSON_PATH.exec(path);
    if (match) out.set(`${match[1]}/${match[3]}`, loader);
  }
  return out;
}

const publishedLoaders = indexLoaders(lessonFiles);
const draftLoaders = indexLoaders(draftFiles);

/** All courses with a course.json, in folder order. */
export function listCourses(): Course[] {
  return [...courses.values()];
}

export function getCourse(slug: string | undefined): Course | undefined {
  return slug ? courses.get(slug) : undefined;
}

/** One lesson of a course outline, with its position. */
export type LessonEntry = {
  ref: LessonRef;
  module: Module;
  /** 0-based module index. */
  moduleIndex: number;
  /** 0-based index within the module. */
  indexInModule: number;
  /** 0-based index across the whole course. */
  index: number;
};

/** The course outline flattened in reading order. */
export function lessonEntries(course: Course): LessonEntry[] {
  const out: LessonEntry[] = [];
  course.modules.forEach((module, moduleIndex) => {
    module.lessons.forEach((ref, indexInModule) => {
      out.push({ ref, module, moduleIndex, indexInModule, index: out.length });
    });
  });
  return out;
}

export function getLessonEntry(course: Course, lessonId: string): LessonEntry | undefined {
  return lessonEntries(course).find((entry) => entry.ref.id === lessonId);
}

export function firstLessonId(course: Course): string | undefined {
  return course.modules[0]?.lessons[0]?.id;
}

/** The lesson that follows `lessonId`: its `next` link, else the next one in the outline. */
export function nextLessonEntry(course: Course, lessonId: string): LessonEntry | undefined {
  const entries = lessonEntries(course);
  const current = entries.find((entry) => entry.ref.id === lessonId);
  if (!current) return undefined;
  const linked = current.ref.next;
  if (linked && (!linked.courseId || linked.courseId === course.id)) {
    return entries.find((entry) => entry.ref.id === linked.lessonId);
  }
  return entries[current.index + 1];
}

export function prevLessonEntry(course: Course, lessonId: string): LessonEntry | undefined {
  const entries = lessonEntries(course);
  const current = entries.find((entry) => entry.ref.id === lessonId);
  return current && current.index > 0 ? entries[current.index - 1] : undefined;
}

export type LessonSource = 'published' | 'draft';

export type LoadedLesson = {
  lesson: Lesson;
  source: LessonSource;
  /** Repo-relative file, for the preview report. */
  file: string;
};

export function hasLesson(courseSlug: string, lessonId: string): boolean {
  const key = `${courseSlug}/${lessonId}`;
  return publishedLoaders.has(key) || draftLoaders.has(key);
}

/**
 * Loads one lesson. `preferDraft` (dev preview) picks `drafts/<id>.lesson.json` when it exists.
 * Resolves to null when there is no such lesson. The JSON is not validated here: the reader
 * renders whatever it gets, and dev builds report problems via validateLessonDev.
 */
export async function loadLesson(
  courseSlug: string,
  lessonId: string,
  options: { preferDraft?: boolean } = {},
): Promise<LoadedLesson | null> {
  const key = `${courseSlug}/${lessonId}`;
  const draft = options.preferDraft ? draftLoaders.get(key) : undefined;
  const loader = draft ?? publishedLoaders.get(key) ?? draftLoaders.get(key);
  if (!loader) return null;
  const source: LessonSource = loader === publishedLoaders.get(key) ? 'published' : 'draft';
  const json = await loader();
  if (!json || typeof json !== 'object') return null;
  return {
    lesson: json as Lesson,
    source,
    file: `content/courses/${courseSlug}/${source === 'draft' ? 'drafts' : 'lessons'}/${lessonId}.lesson.json`,
  };
}

export type DevLessonReport = {
  ok: boolean;
  errors: { path: string; message: string }[];
  warnings: { rule: string; path: string; message: string }[];
};

/**
 * Dev builds only: schema + semantic validation and lint warnings for a loaded lesson.
 * Production builds resolve to null without loading zod.
 */
export async function validateLessonDev(json: unknown, course?: Course): Promise<DevLessonReport | null> {
  if (!import.meta.env.DEV) return null;
  const [{ validateLesson }, { lintLesson }] = await Promise.all([
    import('../shared/lesson/validate.js'),
    import('../shared/lesson/lint.js'),
  ]);
  const result = validateLesson(json, { course: course ?? null });
  const warnings = result.lesson ? lintLesson(result.lesson).warnings : [];
  return { ok: result.ok, errors: result.errors, warnings };
}
