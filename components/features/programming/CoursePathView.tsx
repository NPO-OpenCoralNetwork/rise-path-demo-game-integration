import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Languages } from 'lucide-react';
import { ViewState } from '../../../types';
import { getCourse, lessonEntries } from '../../../content';
import { getLastLesson, readLessonSummary } from '../../lesson/progressStore';
import { useProgressVersion } from '../../lesson/useProgressVersion';
import { LESSON_DONE_STATES, resolveLText, splitLessonTitle, type ContentLocale } from '../../lesson/model';
import { courseTotals, formatCourseMeta } from '../../ui/lessonResume';
import { ButtonLink } from '../../ui/Button';
import { Markdown } from '../../lesson/Md';
import { courseOnlyLocales } from './courseLocales';

/**
 * Overview of a lesson-reader course (/vibe, /claude-code). Everything on the page comes from
 * content/courses/<slug>/course.json and the reader's saved progress: title, subtitle,
 * description, module and lesson titles, each lesson's estMinutes, the totals (same helper as
 * the dashboard track card) and which lessons are read. The accent is the course's world.
 * Lessons open in the lesson reader. When the UI language is not in course.locales, a note
 * says so and the course text keeps its own `lang`.
 */

export interface CoursePathViewProps {
  courseSlug: string;
  /** Small label above the title, per UI language (e.g. 'Web × AI'). */
  badge: { en: string; jp: string };
  onBack: () => void;
  onNavigate?: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage?: (lang: 'en' | 'jp') => void;
}

const LOCALE_NAMES: Record<'en' | 'jp', Record<ContentLocale, string>> = {
  en: { jp: 'Japanese', en: 'English', fr: 'French' },
  jp: { jp: '日本語', en: '英語', fr: 'フランス語' },
};

const copy = {
  en: {
    back: 'Back to Learning Content',
    progress: 'Course progress',
    progressValue: (pct: number) => `${pct}% read`,
    notStarted: 'Not started yet',
    start: 'Start with the first lesson',
    resume: 'Continue reading',
    contents: 'Contents',
    module: (n: number) => `Part ${n}`,
    minutes: (n: number) => `about ${n} min`,
    status: { done: 'Read', current: 'Last opened', started: (pct: number) => `${pct}% read`, todo: 'Not started' },
    missing: 'This course is not available right now.',
    onlyIn: (locales: ContentLocale[]) => `This course is in ${locales.map((l) => LOCALE_NAMES.en[l]).join(' and ')} only.`,
  },
  jp: {
    back: '学習コンテンツに戻る',
    progress: 'コースの進捗',
    progressValue: (pct: number) => `${pct}% 読了`,
    notStarted: 'まだ始めていません',
    start: '最初のレッスンから読む',
    resume: '続きから読む',
    contents: '目次',
    module: (n: number) => `パート${n}`,
    minutes: (n: number) => `約${n}分`,
    status: { done: '読了', current: '前回ここまで', started: (pct: number) => `${pct}% 読了`, todo: '未読' },
    missing: 'このコースは現在表示できません。',
    onlyIn: (locales: ContentLocale[]) => `このコースは${locales.map((l) => LOCALE_NAMES.jp[l]).join('・')}のみです。`,
  },
} as const;

type LessonRow = {
  id: string;
  href: string;
  kicker: string | null;
  title: string;
  lang?: string;
  minutes?: number;
  pct: number;
  state: 'done' | 'current' | 'started' | 'todo';
};

const CoursePathView: React.FC<CoursePathViewProps> = ({ courseSlug, badge, onBack, language }) => {
  const t = copy[language];
  const locale: ContentLocale = language;
  const course = getCourse(courseSlug);
  const fallback = (course?.locale as ContentLocale | undefined) ?? 'jp';

  // Re-read when progress changes (synced progress arriving after the page opened, another tab).
  const progressVersion = useProgressVersion();
  const data = useMemo(() => {
    if (!course) return null;
    const last = getLastLesson();
    const entries = lessonEntries(course);
    const lastId = last?.courseSlug === courseSlug && entries.some((e) => e.ref.id === last.lessonId) ? last.lessonId : null;
    const modules = course.modules.map((module) => {
      const title = resolveLText(module.title, locale, fallback);
      const lessons = module.lessons.map((ref): LessonRow => {
        const progress = readLessonSummary(courseSlug, ref.id);
        const resolved = resolveLText(ref.title, locale, fallback);
        const split = splitLessonTitle(resolved.value);
        const pct = progress?.pct ?? 0;
        const state: LessonRow['state'] = progress && LESSON_DONE_STATES.has(progress.state)
          ? 'done'
          : ref.id === lastId
            ? 'current'
            : progress && progress.state !== 'not_started'
              ? 'started'
              : 'todo';
        return {
          id: ref.id,
          href: `/learn/${courseSlug}/${ref.id}`,
          kicker: split.kicker,
          title: split.title,
          ...(resolved.lang ? { lang: resolved.lang } : {}),
          ...(ref.estMinutes ? { minutes: ref.estMinutes } : {}),
          pct,
          state,
        };
      });
      const summary = resolveLText(module.summary, locale, fallback);
      return { id: module.id, title: title.value, lang: title.lang, summary: summary.value || null, summaryLang: summary.lang, lessons };
    });
    const totals = courseTotals(course, readLessonSummary, courseSlug);
    const resumeHref = `/learn/${courseSlug}/${lastId ?? entries[0]?.ref.id ?? ''}`;
    return { modules, totals, resumeHref, resumed: Boolean(lastId) };
  }, [course, courseSlug, locale, fallback, progressVersion]);

  const title = resolveLText(course?.title, locale, fallback);
  const subtitle = resolveLText(course?.subtitle, locale, fallback);
  const description = resolveLText(course?.description, locale, fallback);
  const onlyIn = course ? courseOnlyLocales(course, locale) : null;
  const badgeChip = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-world-soft px-2.5 py-0.5 text-caption font-semibold text-world">
      <span aria-hidden="true" className="size-2 rounded-full bg-world" />
      {badge[language]}
    </span>
  );

  return (
    <div data-world={course?.world ?? 'default'} className="w-full px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-10">
      <div className="mx-auto max-w-page">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-control text-small font-semibold text-fg-2 hover:text-fg"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t.back}
        </button>

        {!course || !data ? (
          <p className="mt-6 rounded-card border border-line bg-surface p-5 text-body text-fg-2 shadow-1">{t.missing}</p>
        ) : (
          <>
            <header className="mt-4 overflow-hidden rounded-hero border border-line bg-surface shadow-1">
              <div aria-hidden="true" className="h-2 bg-world-accent" />
              <div className="flex flex-col gap-5 p-5 sm:p-8 md:flex-row md:items-end md:justify-between">
                <div className="min-w-0">
                  {onlyIn ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {badgeChip}
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-caption font-semibold text-fg-2">
                        <Languages size={14} aria-hidden="true" />
                        {t.onlyIn(onlyIn)}
                      </span>
                    </div>
                  ) : badgeChip}
                  <h1 lang={title.lang} className="mt-3 text-h1 text-fg">{title.value}</h1>
                  {subtitle.value ? <p lang={subtitle.lang} className="mt-2 max-w-2xl text-body-lg text-fg-2">{subtitle.value}</p> : null}
                  {description.value ? (
                    <div lang={description.lang} className="mt-2 max-w-2xl text-small text-fg-2">
                      <Markdown source={description.value} />
                    </div>
                  ) : null}
                  <p className="tabular mt-2 text-small text-fg-3">{formatCourseMeta(data.totals, language)}</p>
                </div>
                <div className="flex min-w-0 shrink-0 flex-col gap-3 md:w-64">
                  <div>
                    <div className="flex items-baseline justify-between gap-3 text-small">
                      <span className="font-semibold text-fg-2">{t.progress}</span>
                      <span className="tabular text-fg-3">{data.totals.pct > 0 ? t.progressValue(data.totals.pct) : t.notStarted}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={t.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={data.totals.pct}
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"
                    >
                      <div className="h-full rounded-full bg-world-accent" style={{ width: `${data.totals.pct}%` }} />
                    </div>
                  </div>
                  <ButtonLink to={data.resumeHref} variant="primary" size="md" trailingIcon={<ArrowRight size={16} aria-hidden="true" />}>
                    {data.resumed ? t.resume : t.start}
                  </ButtonLink>
                </div>
              </div>
            </header>

            <h2 className="mb-3 mt-10 text-h2 text-fg">{t.contents}</h2>
            <ol className="space-y-6">
              {data.modules.map((module, moduleIndex) => (
                <li key={module.id}>
                  <section aria-labelledby={`${courseSlug}-${module.id}`}>
                    <h3 id={`${courseSlug}-${module.id}`} className="mb-2 flex flex-wrap items-baseline gap-x-2 text-h3 text-fg">
                      <span className="eyebrow text-world">{t.module(moduleIndex + 1)}</span>
                      <span lang={module.lang}>{module.title}</span>
                    </h3>
                    {module.summary ? (
                      <div lang={module.summaryLang} className="mb-3 max-w-2xl text-small text-fg-2">
                        <Markdown source={module.summary} />
                      </div>
                    ) : null}
                    <ol className="overflow-hidden rounded-card border border-line bg-surface shadow-1">
                      {module.lessons.map((lesson) => (
                        <li key={lesson.id} className="border-b border-line last:border-b-0">
                          <Link
                            to={lesson.href}
                            className="flex min-w-0 items-center gap-3 px-4 py-3 text-fg no-underline hover:bg-sunken focus-visible:bg-sunken sm:gap-4 sm:px-5"
                          >
                            <StatusMark state={lesson.state} />
                            <span className="min-w-0 flex-1">
                              {lesson.kicker ? <span className="tabular block text-caption font-semibold text-fg-3" lang={lesson.lang}>{lesson.kicker}</span> : null}
                              <span className="block text-body font-semibold" lang={lesson.lang}>{lesson.title}</span>
                              <span className="tabular mt-0.5 block text-caption text-fg-3">
                                {[
                                  lesson.minutes ? t.minutes(lesson.minutes) : null,
                                  lesson.state === 'done'
                                    ? t.status.done
                                    : lesson.state === 'current'
                                      ? t.status.current
                                      : lesson.state === 'started'
                                        ? t.status.started(lesson.pct)
                                        : t.status.todo,
                                ].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-fg-3" />
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </section>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
};

function StatusMark({ state }: { state: LessonRow['state'] }) {
  if (state === 'done') {
    return (
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-world text-on-world">
        <Check size={15} strokeWidth={3} />
      </span>
    );
  }
  if (state === 'current' || state === 'started') {
    return (
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-world">
        <span className="size-2.5 rounded-full bg-world" />
      </span>
    );
  }
  return <span aria-hidden="true" className="size-7 shrink-0 rounded-full border-2 border-line" />;
}

export default CoursePathView;
