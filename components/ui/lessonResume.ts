/**
 * Pure helpers behind the dashboard's "続きから" card and track cards. No React or DOM
 * imports, so server/tests can import this file directly.
 *
 * Inputs are the reader's own records (components/lesson/progressStore.ts) and the content
 * catalog (content/index.ts); nothing here invents numbers.
 */
import type { Course, Lesson } from '../../shared/lesson/schema.js';
import type { LastLesson, LessonProgress, ProgressSummary } from '../lesson/progressStore.ts';
import {
  allBlocks,
  isQuiz,
  resolveLText,
  sectionByBlock,
  sectionStatuses,
  splitSectionTitle,
  type ContentLocale,
  type SectionStatus,
} from '../lesson/model.ts';

/** Where "続きから" points when the learner has not opened a lesson yet. */
export const DEFAULT_START = { courseSlug: 'vibe-coding', lessonId: 'vibe-ch1' } as const;

export type ResumeTarget = {
  courseSlug: string;
  lessonId: string;
  /** True when this comes from rp:lastLesson; false for the first-chapter fallback. */
  fromLast: boolean;
  /** Last saved share read (0 for the fallback). */
  pct: number;
};

/**
 * The last lesson opened in the reader when it still exists in the catalog, else the default
 * first chapter. `exists` is usually `(slug, id) => Boolean(getCourse(slug) && getLessonEntry(...))`.
 */
export function pickResumeTarget(
  last: LastLesson | null,
  exists: (courseSlug: string, lessonId: string) => boolean,
  fallback: { courseSlug: string; lessonId: string } = DEFAULT_START,
): ResumeTarget {
  if (last && exists(last.courseSlug, last.lessonId)) {
    return { courseSlug: last.courseSlug, lessonId: last.lessonId, fromLast: true, pct: last.pct };
  }
  return { courseSlug: fallback.courseSlug, lessonId: fallback.lessonId, fromLast: false, pct: 0 };
}

export type OutlineItem = { id: string; num: string | null; title: string; lang?: string; status: SectionStatus };

export type LessonFacts = {
  sections: number;
  /** Graded and ungraded questions across all quiz blocks. */
  questions: number;
  /** Section that holds the saved resume block, if any. `label` is its number ("1-2"), when it has one. */
  resumeSection: { id: string; label: string | null } | null;
  outline: OutlineItem[];
};

/** Counts and outline state for the card, from the lesson JSON and its saved progress. */
export function lessonFacts(lesson: Lesson, progress: LessonProgress, locale: ContentLocale): LessonFacts {
  const fallback = (lesson.locale as ContentLocale | undefined) ?? 'jp';
  const owner = progress.lastBlockId ? sectionByBlock(lesson).get(progress.lastBlockId) : undefined;
  const statuses = sectionStatuses(lesson, progress, owner?.id ?? null);
  const outline = lesson.sections.map((section): OutlineItem => {
    const resolved = resolveLText(section.title, locale, fallback);
    const split = splitSectionTitle(resolved.value);
    return {
      id: section.id,
      num: split.num,
      title: split.title,
      ...(resolved.lang ? { lang: resolved.lang } : {}),
      status: statuses[section.id] ?? 'todo',
    };
  });
  const questions = allBlocks(lesson)
    .filter(isQuiz)
    .reduce((sum, block) => sum + block.questions.length, 0);
  const resumeItem = owner ? outline.find((item) => item.id === owner.id) : undefined;
  return {
    sections: lesson.sections.length,
    questions,
    resumeSection: resumeItem ? { id: resumeItem.id, label: resumeItem.num } : null,
    outline,
  };
}

export type CourseTotals = {
  lessons: number;
  /** Sum of the outline's estMinutes (0 when none are set). */
  minutes: number;
  /** Lessons with any saved progress. */
  started: number;
  /** Mean saved pct over all lessons, 0–100. */
  pct: number;
};

/**
 * Totals for a track card. `summary` is usually progressStore.readLessonSummary, which reads
 * what the reader saved under the course's folder name (its courseSlug, the key getCourse()
 * takes). Pass that slug; it defaults to course.id, which lessons:validate keeps equal to it.
 */
export function courseTotals(
  course: Course,
  summary: (courseSlug: string, lessonId: string) => ProgressSummary | null,
  courseSlug: string = course.id,
): CourseTotals {
  const refs = course.modules.flatMap((module) => module.lessons);
  let minutes = 0;
  let started = 0;
  let pctSum = 0;
  for (const ref of refs) {
    minutes += typeof ref.estMinutes === 'number' && ref.estMinutes > 0 ? ref.estMinutes : 0;
    const saved = summary(courseSlug, ref.id);
    if (saved) {
      started += 1;
      pctSum += saved.pct;
    }
  }
  return { lessons: refs.length, minutes, started, pct: refs.length ? Math.round(pctSum / refs.length) : 0 };
}

/** "12レッスン · 約4.5時間" / "12 lessons · about 4.5 h". Minutes are left out when unknown. */
export function formatCourseMeta(totals: Pick<CourseTotals, 'lessons' | 'minutes'>, lang: 'en' | 'jp'): string {
  const parts: string[] = [lang === 'jp' ? `${totals.lessons}レッスン` : `${totals.lessons} ${totals.lessons === 1 ? 'lesson' : 'lessons'}`];
  if (totals.minutes > 0) {
    if (totals.minutes < 90) {
      parts.push(lang === 'jp' ? `約${totals.minutes}分` : `about ${totals.minutes} min`);
    } else {
      const hours = Math.round(totals.minutes / 30) / 2;
      parts.push(lang === 'jp' ? `約${hours}時間` : `about ${hours} h`);
    }
  }
  return parts.join(' · ');
}
