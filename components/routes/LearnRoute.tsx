import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, CircleAlert, CircleCheck, FileWarning, TriangleAlert } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import {
  firstLessonId,
  getCourse,
  getLessonEntry,
  loadLesson,
  nextLessonEntry,
  prevLessonEntry,
  validateLessonDev,
  type DevLessonReport,
  type LessonEntry,
  type LoadedLesson,
} from '../../content';
import type { Course } from '../../shared/lesson/schema.js';
import LessonReader from '../lesson/LessonReader';
import type { LessonLinkInfo } from '../lesson/LessonEnd';
import { getLastLesson } from '../lesson/progressStore';
import { resolveLText, type ContentLocale } from '../lesson/model';

/**
 * /learn/:courseSlug/:lessonId — the lesson reader for risepath.lesson/v1 content.
 * /learn/:courseSlug           — resumes the course (last lesson read, else the first one).
 * /preview/:courseSlug/:lessonId (dev builds only) — the same reader, preferring
 *   drafts/<id>.lesson.json, with a validation report under the bar.
 */

/** Where "back" goes for each course; courses without a hub go to the learning hub. */
const COURSE_HOME: Record<string, string> = {
  'vibe-coding': '/vibe',
  'claude-code': '/claude-code',
};

const copy = {
  en: {
    loading: 'Loading the lesson…',
    notFoundTitle: 'This lesson could not be found',
    notFoundBody: 'The link may be out of date. Pick a lesson from the course instead.',
    loadFailed: 'The lesson could not be loaded. Check your connection and try again.',
    retry: 'Try again',
    back: 'Back to the course',
    hub: 'Go to the learning hub',
    pageTitle: (lesson: string, course: string) => `${lesson} · ${course} | Rise Path`,
    preview: 'Preview',
    draft: 'Draft',
    published: 'Published',
    valid: 'Schema valid',
    invalid: (n: number) => `${n} schema error${n === 1 ? '' : 's'}`,
    warnings: (n: number) => `${n} lint warning${n === 1 ? '' : 's'}`,
    checking: 'Validating…',
    details: 'Show the report',
  },
  jp: {
    loading: 'レッスンを読み込んでいます…',
    notFoundTitle: 'レッスンが見つかりませんでした',
    notFoundBody: 'リンクが古い可能性があります。コースの一覧からレッスンを選んでください。',
    loadFailed: 'レッスンを読み込めませんでした。接続を確認して、もう一度お試しください。',
    retry: 'もう一度読み込む',
    back: 'コースに戻る',
    hub: '学習ハブへ',
    pageTitle: (lesson: string, course: string) => `${lesson} · ${course} | Rise Path`,
    preview: 'プレビュー',
    draft: '下書き',
    published: '公開版',
    valid: 'スキーマ検証 OK',
    invalid: (n: number) => `スキーマエラー ${n}件`,
    warnings: (n: number) => `lint 警告 ${n}件`,
    checking: '検証しています…',
    details: 'レポートを表示',
  },
} as const;

type Mode = 'learn' | 'preview';

function courseHome(slug: string): string {
  return COURSE_HOME[slug] ?? '/learning-hub';
}

function linkInfo(entry: LessonEntry | undefined, slug: string, mode: Mode, locale: ContentLocale, fallback: ContentLocale): LessonLinkInfo | null {
  if (!entry) return null;
  const title = resolveLText(entry.ref.title, locale, fallback);
  return {
    title: title.value,
    lang: title.lang,
    href: `/${mode}/${slug}/${entry.ref.id}`,
    ...(entry.ref.estMinutes ? { minutes: entry.ref.estMinutes } : {}),
  };
}

function ReaderSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-dvh bg-canvas" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="h-14 border-b border-line bg-surface" aria-hidden="true" />
      <div className="mx-auto flex max-w-measure flex-col gap-4 px-4 py-10" aria-hidden="true">
        <div className="h-4 w-40 animate-pulse rounded-chip bg-sunken" />
        <div className="h-9 w-3/4 animate-pulse rounded-chip bg-sunken" />
        <div className="h-4 w-full animate-pulse rounded-chip bg-sunken" />
        <div className="h-4 w-5/6 animate-pulse rounded-chip bg-sunken" />
        <div className="mt-6 h-32 w-full animate-pulse rounded-card bg-sunken" />
      </div>
    </div>
  );
}

function Problem({ title, body, backTo, backLabel, onRetry, retryLabel }: {
  title: string;
  body: string;
  backTo: string;
  backLabel: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-form rounded-card border border-line bg-surface p-6 shadow-1">
        <FileWarning size={28} aria-hidden="true" className="text-fg-3" />
        <h1 className="mt-3 text-h2 text-fg">{title}</h1>
        <p className="mt-2 text-body text-fg-2">{body}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-10 items-center rounded-control bg-primary px-4 text-small font-semibold text-on-primary hover:bg-primary-hover"
            >
              {retryLabel}
            </button>
          )}
          <Link
            to={backTo}
            className="inline-flex h-10 items-center gap-2 rounded-control border border-line bg-surface px-4 text-small font-semibold text-fg hover:bg-sunken"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {backLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Dev preview: source file and validation result under the LessonBar. */
function PreviewReport({ loaded, report }: { loaded: LoadedLesson; report: DevLessonReport | null | undefined }) {
  const { language } = useLanguage();
  const text = copy[language];
  const errors = report?.errors ?? [];
  const warnings = report?.warnings ?? [];
  const ok = report ? report.ok : null;
  return (
    <section
      aria-label={text.preview}
      className="border-b border-line bg-surface px-4 py-3 text-small text-fg-2 sm:px-6"
    >
      <details open={errors.length > 0}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-caption font-semibold text-primary-text">
            {text.preview} · {loaded.source === 'draft' ? text.draft : text.published}
          </span>
          <code className="min-w-0 truncate font-mono text-caption text-fg-3">{loaded.file}</code>
          {ok === null && <span className="text-fg-3">{text.checking}</span>}
          {ok === true && (
            <span className="inline-flex items-center gap-1 font-semibold text-success">
              <CircleCheck size={14} aria-hidden="true" />{text.valid}
            </span>
          )}
          {ok === false && (
            <span className="inline-flex items-center gap-1 font-semibold text-danger">
              <CircleAlert size={14} aria-hidden="true" />{text.invalid(errors.length)}
            </span>
          )}
          {report && (
            <span className="inline-flex items-center gap-1 text-fg-2">
              <TriangleAlert size={14} aria-hidden="true" />{text.warnings(warnings.length)}
            </span>
          )}
          {(errors.length > 0 || warnings.length > 0) && (
            <span className="ml-auto font-semibold text-primary-text">{text.details}</span>
          )}
        </summary>
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto font-mono text-caption">
            {errors.map((e, i) => (
              <li key={`e${i}`} className="text-danger">
                ✕ <span className="text-fg-2">{e.path || '(root)'}</span> — {e.message}
              </li>
            ))}
            {warnings.map((w, i) => (
              <li key={`w${i}`} className="text-fg-2">
                ⚠ [{w.rule}] <span className="text-fg-3">{w.path}</span> — {w.message}
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; loaded: LoadedLesson };

function LessonPage({ course, courseSlug, lessonId, mode }: { course: Course; courseSlug: string; lessonId: string; mode: Mode }) {
  const { language } = useLanguage();
  const text = copy[language];
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [report, setReport] = useState<DevLessonReport | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const backTo = courseHome(courseSlug);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setReport(undefined);
    loadLesson(courseSlug, lessonId, { preferDraft: mode === 'preview' })
      .then((loaded) => {
        if (cancelled) return;
        setState(loaded ? { status: 'ready', loaded } : { status: 'missing' });
        if (loaded && mode === 'preview') {
          validateLessonDev(loaded.lesson, course)
            .then((result) => {
              if (!cancelled) setReport(result);
            })
            .catch(() => {
              if (!cancelled) setReport(null);
            });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [course, courseSlug, lessonId, mode, attempt]);

  const locale: ContentLocale = language;
  const lesson = state.status === 'ready' ? state.loaded.lesson : null;
  const fallback: ContentLocale = lesson?.locale ?? course.locale;
  const entry = useMemo(() => getLessonEntry(course, lessonId), [course, lessonId]);
  const next = useMemo(
    () => linkInfo(nextLessonEntry(course, lessonId), courseSlug, mode, locale, fallback),
    [course, courseSlug, lessonId, mode, locale, fallback],
  );
  const prev = useMemo(
    () => linkInfo(prevLessonEntry(course, lessonId), courseSlug, mode, locale, fallback),
    [course, courseSlug, lessonId, mode, locale, fallback],
  );

  // Tab title follows the lesson and the UI language.
  useEffect(() => {
    if (!lesson) return;
    const previous = document.title;
    const lessonTitle = resolveLText(lesson.title, locale, fallback).value;
    const courseTitle = resolveLText(course.title, locale, fallback).value;
    document.title = text.pageTitle(lessonTitle, courseTitle);
    return () => {
      document.title = previous;
    };
  }, [lesson, course, locale, fallback, text]);

  if (state.status === 'loading') return <ReaderSkeleton label={text.loading} />;
  if (state.status === 'missing') {
    return <Problem title={text.notFoundTitle} body={text.notFoundBody} backTo={backTo} backLabel={text.back} />;
  }
  if (state.status === 'error') {
    return (
      <Problem
        title={text.notFoundTitle}
        body={text.loadFailed}
        backTo={backTo}
        backLabel={text.back}
        onRetry={() => setAttempt((n) => n + 1)}
        retryLabel={text.retry}
      />
    );
  }

  const { loaded } = state;
  return (
    <LessonReader
      key={`${courseSlug}/${lessonId}/${loaded.source}`}
      course={course}
      courseSlug={courseSlug}
      lesson={loaded.lesson}
      backTo={backTo}
      entry={entry}
      next={next}
      prev={prev}
      banner={mode === 'preview' ? <PreviewReport loaded={loaded} report={report} /> : undefined}
      // Phase 5: only the published reader offers 「最初からやり直す」 (never the draft preview).
      allowReset={mode === 'learn'}
    />
  );
}

export default function LearnRoute({ mode = 'learn' }: { mode?: Mode }) {
  const { courseSlug = '', lessonId } = useParams<{ courseSlug: string; lessonId?: string }>();
  const { language } = useLanguage();
  const text = copy[language];
  const course = getCourse(courseSlug);

  if (!course) {
    return <Problem title={text.notFoundTitle} body={text.notFoundBody} backTo="/learning-hub" backLabel={text.hub} />;
  }

  if (!lessonId) {
    const last = getLastLesson();
    const resume = last?.courseSlug === courseSlug && getLessonEntry(course, last.lessonId) ? last.lessonId : firstLessonId(course);
    if (!resume) return <Navigate to={courseHome(courseSlug)} replace />;
    return <Navigate to={`/${mode}/${courseSlug}/${resume}`} replace />;
  }

  return <LessonPage course={course} courseSlug={courseSlug} lessonId={lessonId} mode={mode} />;
}
