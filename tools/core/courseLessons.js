// @ts-check
/**
 * Shared Business Logic — what the MCP course-* tools read (Phase 2,
 * doc/brushup-2026/ai-access-plan.ja.md §6): the published courses, a lesson as the learner's
 * AI app may see it (no answers: shared/lesson/learnerView.js) and the learner's progress per
 * lesson. The writes behind course-quiz-check and course-progress-update are
 * tools/core/lessonProgress.js applyQuizCheck and markLessonProgress.
 *
 * Content comes from the published catalog only (tools/core/courseCatalog.js), so reading a lesson
 * needs no database; the learner's stored progress only picks the section a first read starts at.
 * Progress views never carry option labels or answers: a question shows whether it was answered,
 * its latest correctness, attempts and whether the answer was shown.
 *
 * Failures return { error, error_type } (never the driver's text).
 */
import { getPublishedLesson, isSafeSlug, listPublishedCourses, listPublishedLessons } from './courseCatalog.js';
import { getLessonProgress } from './lessonProgress.js';
import { blockDone, emptyProgress, isAnswered } from '../../shared/lesson/progress.js';
import { TUTOR_PROTOCOL, availableLocales, learnerLocale, lessonOutline, toLearnerLesson } from '../../shared/lesson/learnerView.js';
import { resolveText } from '../../shared/lesson/text.js';

/**
 * @typedef {import('./courseCatalog.js').PublishedLesson} PublishedLesson
 * @typedef {import('../../shared/lesson/progress.js').LessonProgress} LessonProgress
 * @typedef {import('../../shared/lesson/progress.js').LessonStateName} LessonStateName
 * @typedef {import('../../shared/lesson/text.js').Locale} Locale
 * @typedef {{ error: string, error_type: string }} CoreError
 */

/** Share of exam questions right on the first try that makes a lesson "mastered" (progress.js lessonState). */
export const MASTERY_FIRST_TRY_SHARE = 0.8;

/** How an agent answers the questions of a lesson read with course-lesson-get. */
export const HOW_TO_ANSWER = [
    'Ask the learner each question and wait for their answer.',
    'Send the option labels they chose ("1".."n"; several only for multiple: true) to course-quiz-check',
    'with course_slug, lesson_id, question_id and this content_hash.',
    'Read the next section with section_id (from the outline). section_id "all" returns the whole lesson,',
    'which is large (up to about 40 KB): prefer one section at a time.',
].join(' ');

/** @param {unknown} value */
const quote = (value) => JSON.stringify(String(value).slice(0, 80));

/** @param {string} message @returns {CoreError} */
const invalid = (message) => ({ error: message, error_type: 'validation' });

/**
 * @param {unknown} courseSlug
 * @param {unknown} lessonId
 * @returns {CoreError}
 */
const notPublished = (courseSlug, lessonId) => ({
    error: `${quote(courseSlug)} / ${quote(lessonId)} is not a published lesson. course-list lists the published lessons.`,
    error_type: 'not_found',
});

/** @param {unknown} courseSlug @returns {CoreError} */
const unknownCourse = (courseSlug) => ({
    error: `${quote(courseSlug)} is not a published course. course-list lists the published courses.`,
    error_type: 'not_found',
});

/** @param {unknown} courseSlug */
const isPublishedCourse = (courseSlug) => isSafeSlug(courseSlug) && listPublishedLessons({ courseSlug }).length > 0;

/**
 * @param {PublishedLesson} entry
 * @param {Locale} locale
 */
const lessonTitle = (entry, locale) => resolveText(entry.lesson.title, locale, entry.lesson.locale).value;

/**
 * Blocks done per section (the reader's rule: a block once seen, a quiz once every question is
 * answered), in lesson order.
 * @param {PublishedLesson} entry
 * @param {LessonProgress} progress
 * @param {Locale} locale
 * @returns {{ id: string, title: string, done: number, total: number }[]}
 */
export function sectionStatuses(entry, progress, locale) {
    const seen = new Set(progress.seen);
    return entry.lesson.sections.map((section) => ({
        id: section.id,
        title: resolveText(section.title, locale, entry.lesson.locale).value,
        done: section.blocks.filter((block) => blockDone(block, progress, seen)).length,
        total: section.blocks.length,
    }));
}

/**
 * The first section the learner has not finished, or null when every section is finished.
 * @param {PublishedLesson} entry
 * @param {LessonProgress} progress
 */
function firstUnfinishedSection(entry, progress) {
    const status = sectionStatuses(entry, progress, entry.lesson.locale).find((s) => s.done < s.total);
    return status ? status.id : null;
}

/**
 * The learner's stored record of one lesson; null when none is stored, a CoreError when it
 * cannot be read.
 * @param {string} userId
 * @param {PublishedLesson} entry
 * @returns {Promise<{ progress: LessonProgress, pct: number, state: LessonStateName, updatedAt: string } | null | CoreError>}
 */
async function storedRecord(userId, entry) {
    const result = await getLessonProgress({ userId, courseSlug: entry.courseSlug, lessonId: entry.lesson.id });
    if ('error_type' in result) return /** @type {CoreError} */ (result);
    return result.records[0] ?? null;
}

// ─── course-list ───────────────────────────────────────────────

/**
 * The published courses with their modules and lessons, in one locale. No learner data.
 * @param {{ locale?: unknown }} [options]
 */
export function listCourses({ locale } = {}) {
    return {
        courses: listPublishedCourses({ locale }),
        next: 'Read a lesson with course-lesson-get (course_slug, lesson_id). course-progress-get shows the learner\'s progress.',
    };
}

// ─── course-lesson-get ─────────────────────────────────────────

/**
 * Lesson-level sources a section cites (block `cite` ids), in the lesson's order.
 * @param {ReturnType<typeof toLearnerLesson>} view
 * @param {{ blocks: Record<string, unknown>[] }} section
 */
function citedSources(view, section) {
    const cited = new Set(section.blocks.flatMap((block) => (Array.isArray(block.cite) ? block.cite : [])));
    return (view.sources ?? []).filter((source) => cited.has(source.id));
}

/**
 * One section of the learner view, with the sources it cites and the id of the next section.
 * @param {PublishedLesson} entry
 * @param {string} sectionId
 * @param {Locale} locale
 */
function sectionView(entry, sectionId, locale) {
    const view = toLearnerLesson(entry.lesson, { locale, sectionIds: [sectionId] });
    const section = view.sections[0];
    const index = entry.lesson.sections.findIndex((s) => s.id === sectionId);
    const sources = citedSources(view, section);
    return {
        section,
        ...(sources.length ? { sources } : {}),
        section_index: index,
        section_count: entry.lesson.sections.length,
        next_section_id: entry.lesson.sections[index + 1]?.id ?? null,
    };
}

/**
 * A published lesson for the learner's AI app, in one locale and without answers.
 * - sectionId 'all': the whole lesson.
 * - sectionId of a section: that section.
 * - no sectionId: the outline plus the first section the learner has not finished (by their
 *   stored progress when `userId` is given and the database answers, else the first section).
 * Every result carries content_hash (for course-quiz-check), locale, available_locales,
 * tutor_protocol and how_to_answer.
 *
 * @param {{ courseSlug: unknown, lessonId: unknown, sectionId?: string, locale?: unknown, userId?: string | null }} params
 */
export async function getCourseLesson({ courseSlug, lessonId, sectionId, locale, userId = null }) {
    const entry = getPublishedLesson(courseSlug, lessonId);
    if (!entry) return notPublished(courseSlug, lessonId);
    const used = learnerLocale(entry.lesson, locale);
    const base = {
        course_slug: entry.courseSlug,
        lesson_id: entry.lesson.id,
        title: lessonTitle(entry, used),
        content_hash: entry.hash,
        locale: used,
        available_locales: availableLocales(entry.lesson),
    };
    const guide = { tutor_protocol: TUTOR_PROTOCOL, how_to_answer: HOW_TO_ANSWER };

    if (sectionId === 'all') {
        const { locale: _locale, available_locales: _locales, ...lesson } = toLearnerLesson(entry.lesson, { locale: used });
        return { ...base, lesson, ...guide };
    }
    if (sectionId !== undefined) {
        if (!entry.index.sections.has(sectionId)) {
            return invalid(`Unknown section_id ${quote(sectionId)}. Read the lesson without section_id for its outline, or pass "all".`);
        }
        return { ...base, ...sectionView(entry, sectionId, used), ...guide };
    }

    /** @type {'first_unfinished' | 'not_started' | 'lesson_finished' | 'progress_unavailable'} */
    let reason = 'progress_unavailable';
    let pick = entry.lesson.sections[0].id;
    if (typeof userId === 'string') {
        const stored = await storedRecord(userId, entry);
        if (stored === null) {
            reason = 'not_started';
        } else if (!('error_type' in stored)) {
            const open = firstUnfinishedSection(entry, stored.progress);
            if (open === null) {
                reason = 'lesson_finished';
            } else {
                reason = open === pick && stored.state === 'not_started' ? 'not_started' : 'first_unfinished';
                pick = open;
            }
        }
    }
    const { id: _id, title: _title, locale: _locale, available_locales: _locales, ...outline } = lessonOutline(entry.lesson, { locale: used });
    return { ...base, outline, section_reason: reason, ...sectionView(entry, pick, used), ...guide };
}

// ─── course-progress-get ───────────────────────────────────────

/**
 * Per-question status of a lesson record: answered, latest correctness, attempts, shown. No
 * option labels and no answers.
 * @param {PublishedLesson} entry
 * @param {LessonProgress} progress
 */
function questionStatuses(entry, progress) {
    return [...entry.index.questions.entries()].map(([key, { blockId, question, mode }]) => {
        const record = Object.prototype.hasOwnProperty.call(progress.answers, key) ? progress.answers[key] : undefined;
        const answered = isAnswered(progress, blockId, question.id);
        return {
            question_id: question.id,
            block_id: blockId,
            mode,
            answered,
            correct: answered && record ? record.correct && record.attempts > 0 : null,
            attempts: record?.attempts ?? 0,
            revealed: record?.revealed === true,
        };
    });
}

/**
 * Exam questions right on the first try (what "mastered" needs), or null without an exam.
 * @param {PublishedLesson} entry
 * @param {LessonProgress} progress
 */
function examFirstTry(entry, progress) {
    const exam = [...entry.index.questions.entries()].filter(([, q]) => q.mode === 'exam');
    if (!exam.length) return null;
    const correct = exam.filter(([key]) => {
        const record = Object.prototype.hasOwnProperty.call(progress.answers, key) ? progress.answers[key] : undefined;
        return Boolean(record?.firstTry && record.attempts > 0);
    }).length;
    return { correct, total: exam.length, needed: MASTERY_FIRST_TRY_SHARE };
}

/**
 * Where the learner continues: their last block (as the web reader resumes), else the first block
 * not done in the first unfinished section; null once every section is finished.
 * @param {PublishedLesson} entry
 * @param {LessonProgress} progress
 */
function resumeOf(entry, progress) {
    const last = progress.lastBlockId;
    if (last && entry.index.blockIds.has(last)) {
        const section = entry.lesson.sections.find((s) => s.blocks.some((b) => b.id === last));
        if (section) return { section_id: section.id, block_id: last };
    }
    const seen = new Set(progress.seen);
    for (const section of entry.lesson.sections) {
        const block = section.blocks.find((b) => !blockDone(b, progress, seen));
        if (block) return { section_id: section.id, block_id: block.id };
    }
    return null;
}

/**
 * The learner's lesson progress.
 * - Without lessonId: every published lesson (of courseSlug, or of every course) with pct, state
 *   and updated_at (not_started and null when untouched).
 * - With courseSlug and lessonId: that lesson's sections (blocks done/total), questions (status
 *   only), resume position and exam first-try score.
 *
 * @param {{ userId: string, courseSlug?: unknown, lessonId?: unknown, locale?: unknown }} params
 */
export async function getCourseProgress({ userId, courseSlug, lessonId, locale }) {
    if (lessonId !== undefined && courseSlug === undefined) return invalid('lesson_id needs course_slug.');
    if (courseSlug !== undefined && !isPublishedCourse(courseSlug)) return unknownCourse(courseSlug);

    if (lessonId !== undefined) {
        const entry = getPublishedLesson(courseSlug, lessonId);
        if (!entry) return notPublished(courseSlug, lessonId);
        const found = await storedRecord(userId, entry);
        if (found !== null && 'error_type' in found) return found;
        const stored = /** @type {Exclude<typeof found, CoreError>} */ (found);
        const progress = stored?.progress ?? emptyProgress();
        const used = learnerLocale(entry.lesson, locale);
        return {
            course_slug: entry.courseSlug,
            lesson_id: entry.lesson.id,
            title: lessonTitle(entry, used),
            pct: stored?.pct ?? 0,
            state: stored?.state ?? 'not_started',
            updated_at: stored?.updatedAt ?? null,
            sections: sectionStatuses(entry, progress, used),
            questions: questionStatuses(entry, progress),
            resume: resumeOf(entry, progress),
            exam_first_try: examFirstTry(entry, progress),
            content_hash: entry.hash,
            locale: used,
        };
    }

    const slug = /** @type {string | undefined} */ (courseSlug);
    const result = await getLessonProgress({ userId, courseSlug: slug });
    if ('error_type' in result) return result;
    const byKey = new Map(result.records.map((r) => [`${r.courseSlug}/${r.lessonId}`, r]));
    const lessons = listPublishedLessons({ courseSlug: slug }).map((entry) => {
        const record = byKey.get(`${entry.courseSlug}/${entry.lesson.id}`);
        return {
            course_slug: entry.courseSlug,
            lesson_id: entry.lesson.id,
            title: lessonTitle(entry, learnerLocale(entry.lesson, locale)),
            pct: record?.pct ?? 0,
            state: record?.state ?? 'not_started',
            updated_at: record?.updatedAt ?? null,
        };
    });
    return { ...(slug !== undefined ? { course_slug: slug } : {}), lessons };
}

// ─── socratic-tutor prompt ─────────────────────────────────────

/**
 * The course part of the socratic-tutor prompt (Japanese, then the English tutoring protocol),
 * or a CoreError when the course or lesson is not published.
 * @param {{ courseSlug?: string, lessonId?: string }} params
 * @returns {{ text: string } | CoreError}
 */
export function tutorCourseNote({ courseSlug, lessonId }) {
    if (lessonId !== undefined && courseSlug === undefined) return invalid('lesson_id needs course_slug.');
    if (courseSlug === undefined) return { text: '' };
    if (!isPublishedCourse(courseSlug)) return unknownCourse(courseSlug);
    let target = `コース: ${courseSlug}（course-list でレッスンを選ぶ）`;
    if (lessonId !== undefined) {
        const entry = getPublishedLesson(courseSlug, lessonId);
        if (!entry) return notPublished(courseSlug, lessonId);
        target = `レッスン: ${lessonTitle(entry, 'jp')}（course_slug: ${entry.courseSlug}, lesson_id: ${entry.lesson.id}）`;
    }
    return {
        text: [
            target,
            '',
            'レッスンの進め方:',
            '- course-lesson-get でレッスンを読む（答えは含まれない）',
            '- 問題は学習者に答えてもらい、学習者が選んだ答えだけを course-quiz-check で確かめる',
            '- 進み具合は course-progress-get、学習者が取り組んだセクションは course-progress-update で記録する',
            '',
            'Course tools: course-lesson-get (read; no answers), course-quiz-check (only the learner\'s own answers),',
            'course-progress-get and course-progress-update (progress). Tutoring protocol:',
            TUTOR_PROTOCOL,
        ].join('\n'),
    };
}
