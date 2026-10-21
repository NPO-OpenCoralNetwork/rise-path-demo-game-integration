import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Box, Braces, Check, Palette, RotateCw, Sparkles, Terminal } from 'lucide-react';
import { ViewState } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { getCourse, getLessonEntry, loadLesson } from '../../../content';
import { getLastLesson, readLessonSummary, readProgress } from '../../lesson/progressStore';
import { minutesLeft, resolveLText, type ContentLocale } from '../../lesson/model';
import type { Course, Lesson } from '../../../shared/lesson/schema.js';
import PageHeader from '../../ui/PageHeader';
import ProgressCluster from '../../ui/ProgressCluster';
import EmptyState from '../../ui/EmptyState';
import CourseCard, { WORLD_COVER_STYLE } from '../../ui/CourseCard';
import { ButtonLink } from '../../ui/Button';
import { authoringGuideUrl } from '../../ui/links';
import { trackCopy } from '../../ui/tracks';
import { courseTotals, formatCourseMeta, lessonFacts, pickResumeTarget, type LessonFacts } from '../../ui/lessonResume';

// Real data widgets below the fold: loaded on demand so they stay off the critical path.
// (The life-journal weekly widget lives on /life-journal; the dashboard mock has no such row.)
const LearningInsightsWidget = lazy(() => import('./LearningInsightsWidget'));

interface DashboardProps {
  onNavigate: (view: ViewState) => void;
}

/** Track page for a course slug (the reader's own outline lives there). */
const COURSE_HOME: Record<string, string> = { 'vibe-coding': '/vibe', 'claude-code': '/claude-code' };

const copy = {
  en: {
    greeting: (name: string) => `Welcome back, ${name}`,
    guestName: 'Guest',
    subtitle: 'Ten minutes is enough for today. The reader saves your place as you go.',
    continueKicker: 'Continue',
    startKicker: 'Start with Vibe Coding, Chapter 1',
    continueFrom: (label: string) => `Continue (from ${label})`,
    continuePlain: 'Continue reading',
    startCta: 'Read Chapter 1',
    readAgain: 'Read again',
    nextChapter: 'Next chapter',
    outline: 'Contents',
    minutes: (n: number) => `about ${n} min`,
    minutesLeft: (n: number) => `${n} min left`,
    sections: (n: number) => `${n} ${n === 1 ? 'section' : 'sections'}`,
    questions: (n: number) => `${n} ${n === 1 ? 'check question' : 'check questions'}`,
    levels: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' } as Record<string, string>,
    objectivesLabel: 'In this chapter you will',
    progressLabel: 'Read so far',
    loading: 'Loading the chapter outline…',
    outlineLabel: 'Chapter outline',
    sectionDone: 'done',
    sectionCurrent: 'you are here',
    reviewTitle: '0 reviews due today',
    reviewBody: 'Questions you missed and terms you turn into cards will show up here.',
    tutorTitle: 'Your AI tutor lives in the lesson',
    tutorBody: 'Ask about any paragraph with ✦. It starts with a hint and thinks it through with you instead of handing over the answer.',
    tracks: 'Tracks',
    seeAll: 'See all',
    create: 'Create',
    guide: 'Authoring guide',
    opensInNewTab: '(opens in a new tab)',
    createTitle: 'Create lessons with Claude Code',
    createBody:
      'Lessons written to the same schema go through validation, review and preview, then show up in this reader as they are. ChatGPT and Gemini can follow the same steps through MCP.',
    codeLabel: 'Example commands',
    codeComment1: '# in the repository',
    codeComment2: '# validate and preview',
    sampleLessonTitle: 'MCP basics',
    trackProgress: 'Track progress',
  },
  jp: {
    greeting: (name: string) => `おかえりなさい、${name} さん`,
    guestName: 'Guest',
    subtitle: '今日は 10分 だけ進めましょう。読んだところは自動で記録されます。',
    continueKicker: '続きから',
    startKicker: 'バイブコーディング 第1章からはじめる',
    continueFrom: (label: string) => `続きから読む（${label} から）`,
    continuePlain: '続きから読む',
    startCta: '第1章を読む',
    readAgain: 'もう一度読む',
    nextChapter: '次の章へ',
    outline: '目次',
    minutes: (n: number) => `約${n}分`,
    minutesLeft: (n: number) => `残り約${n}分`,
    sections: (n: number) => `${n}セクション`,
    questions: (n: number) => `確認問題 ${n}`,
    levels: { beginner: '初級', intermediate: '中級', advanced: '上級' } as Record<string, string>,
    objectivesLabel: 'この章でできるようになること',
    progressLabel: 'ここまで読んだ割合',
    loading: '章の内容を読み込んでいます…',
    outlineLabel: 'この章の構成',
    sectionDone: '読了',
    sectionCurrent: '前回ここまで',
    reviewTitle: '今日の復習 0枚',
    reviewBody: '確認問題で間違えた所と、カードにした用語がここに並びます。',
    tutorTitle: 'AI先生は教材の中に',
    tutorBody: '段落の ✦ から質問できます。すぐ答えは言わず、ヒントから一緒に考えます。',
    tracks: 'トラック',
    seeAll: 'すべて見る',
    create: 'つくる',
    guide: '作成ガイド',
    opensInNewTab: '（新しいタブで開きます）',
    createTitle: 'Claude Code で教材をつくる',
    createBody:
      '同じスキーマで書かれた教材は、検証・レビュー・プレビューを通ってから、このリーダーにそのまま表示されます。ChatGPT や Gemini からも MCP で同じ手順を使えます。',
    codeLabel: 'コマンドの例',
    codeComment1: '# リポジトリで',
    codeComment2: '# 検証とプレビュー',
    sampleLessonTitle: 'MCPの基本',
    trackProgress: 'トラックの進捗',
  },
} as const;

/** "10月18日（土）" / "Saturday, October 18". */
function formatToday(now: Date, lang: 'en' | 'jp'): string {
  if (lang === 'jp') {
    const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short' }).format(now);
    return `${now.getMonth() + 1}月${now.getDate()}日（${weekday}）`;
  }
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
}

function lessonExists(courseSlug: string, lessonId: string): boolean {
  const course = getCourse(courseSlug);
  return Boolean(course && getLessonEntry(course, lessonId));
}

const sectionHead = 'mb-3 mt-10 flex items-baseline justify-between gap-4';
const sectionLink =
  'inline-flex items-center gap-1 rounded-chip text-small font-semibold text-primary-text hover:underline underline-offset-4';

const MissionControlDashboard: React.FC<DashboardProps> = () => {
  const { setTheme } = useTheme();
  const { language } = useLanguage();
  const { user } = useAuth();
  const t = copy[language];

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  const today = useMemo(() => formatToday(new Date(), language), [language]);
  const name = !user || user.isGuest ? t.guestName : user.name || t.guestName;
  // Only a generated course (UUID) has insights; built-in course slugs would only 404.
  const curriculumId = useMemo(() => {
    try {
      const id = window.localStorage.getItem('active_curriculum_id');
      return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
    } catch {
      return undefined;
    }
  }, []);

  return (
    <div className="w-full px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-10">
      <div className="mx-auto max-w-page">
      <PageHeader eyebrow={today} title={t.greeting(name)} description={t.subtitle} actions={<ProgressCluster />} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ContinueCard />
        <div className="flex flex-col gap-5">
          <EmptyState tone="sun" icon={<RotateCw size={18} />} title={t.reviewTitle} description={t.reviewBody} headingLevel={2} />
          <EmptyState tone="primary" icon={<Sparkles size={18} />} title={t.tutorTitle} description={t.tutorBody} headingLevel={2} />
        </div>
      </div>

      <TrackSection />

      <section aria-labelledby="dash-create">
        <div className={sectionHead}>
          <h2 id="dash-create" className="text-h2 text-fg">
            {t.create}
          </h2>
          <a href={authoringGuideUrl(language)} target="_blank" rel="noopener noreferrer" className={sectionLink}>
            {t.guide}
            <ArrowRight size={16} aria-hidden="true" />
            <span className="sr-only">{t.opensInNewTab}</span>
          </a>
        </div>
        <div className="grid items-center gap-5 rounded-card border border-line bg-surface p-5 shadow-1 md:grid-cols-2 md:gap-6">
          <div className="min-w-0">
            <h3 className="text-h3 text-fg">{t.createTitle}</h3>
            <p className="mt-1 text-small text-fg-3">{t.createBody}</p>
          </div>
          <figure className="m-0 min-w-0">
            <pre
              tabIndex={0}
              aria-label={t.codeLabel}
              className="overflow-x-auto rounded-control border border-line bg-sunken px-3 py-2.5 font-mono text-small text-fg"
            >
              <code>
                <span className="text-fg-3">{t.codeComment1}</span>
                {`\n/author-lesson vibe-coding vibe-ch12 "${t.sampleLessonTitle}"\n`}
                <span className="text-fg-3">{t.codeComment2}</span>
                {'\nnpm run lessons:validate\nnpm run lessons:preview -- vibe-coding vibe-ch12'}
              </code>
            </pre>
          </figure>
        </div>
      </section>

      {curriculumId ? (
        <Suspense fallback={null}>
          <div className="mt-5">
            <LearningInsightsWidget curriculumId={curriculumId} />
          </div>
        </Suspense>
      ) : null}
      </div>
    </div>
  );
};

// --- Continue card -------------------------------------------------------------------------

type LoadedFacts = { lessonKey: string; lesson: Lesson; facts: LessonFacts } | { lessonKey: string; failed: true };

const ContinueCard: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language];
  const locale: ContentLocale = language;

  const target = useMemo(() => pickResumeTarget(getLastLesson(), lessonExists), []);
  const course = getCourse(target.courseSlug) as Course;
  const entry = getLessonEntry(course, target.lessonId);
  const lessonKey = `${target.courseSlug}/${target.lessonId}`;
  const href = `/learn/${target.courseSlug}/${target.lessonId}`;
  const summary = useMemo(() => readLessonSummary(target.courseSlug, target.lessonId), [target]);
  const pct = summary?.pct ?? target.pct;
  const finished = Boolean(summary && summary.state !== 'not_started' && summary.state !== 'in_progress');
  const fallbackLocale = (course.locale as ContentLocale | undefined) ?? 'jp';

  const [loaded, setLoaded] = useState<LoadedFacts | null>(null);
  useEffect(() => {
    let alive = true;
    loadLesson(target.courseSlug, target.lessonId)
      .then((result) => {
        if (!alive) return;
        if (!result) {
          setLoaded({ lessonKey, failed: true });
          return;
        }
        const progress = readProgress(target.courseSlug, target.lessonId);
        setLoaded({ lessonKey, lesson: result.lesson, facts: lessonFacts(result.lesson, progress, locale) });
      })
      .catch(() => {
        if (alive) setLoaded({ lessonKey, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [target, lessonKey, locale]);

  const ready = loaded && loaded.lessonKey === lessonKey && !('failed' in loaded) ? loaded : null;
  const lesson = ready?.lesson;
  const facts = ready?.facts;

  const title = resolveLText(lesson?.title ?? entry?.ref.title, locale, fallbackLocale);
  const estMinutes = lesson?.estMinutes ?? entry?.ref.estMinutes;
  const trackBadge = target.courseSlug === 'vibe-coding' ? trackCopy('vibe', language, course).title : resolveLText(course.title, locale, fallbackLocale).value;
  const world = course.world ?? 'vibe';

  const meta: string[] = [];
  if (estMinutes) meta.push(target.fromLast && pct > 0 && !finished ? t.minutesLeft(minutesLeft(estMinutes, pct)) : t.minutes(estMinutes));
  if (lesson?.level && t.levels[lesson.level]) meta.push(t.levels[lesson.level]);
  if (facts) meta.push(t.sections(facts.sections));
  if (facts && facts.questions > 0) meta.push(t.questions(facts.questions));

  const objectives = (lesson?.objectives ?? []).slice(0, 3).map((objective) => ({
    id: objective.id,
    ...resolveLText(objective.text, locale, (lesson?.locale as ContentLocale | undefined) ?? fallbackLocale),
  }));

  const subtitle = resolveLText(lesson?.subtitle, locale, (lesson?.locale as ContentLocale | undefined) ?? fallbackLocale);

  const next = finished && entry ? course.modules.flatMap((m) => m.lessons)[entry.index + 1] : undefined;
  let primary: { label: string; to: string };
  if (!target.fromLast) primary = { label: t.startCta, to: href };
  else if (finished && next) primary = { label: t.nextChapter, to: `/learn/${target.courseSlug}/${next.id}` };
  else if (finished) primary = { label: t.readAgain, to: href };
  else primary = { label: facts?.resumeSection?.label ? t.continueFrom(facts.resumeSection.label) : t.continuePlain, to: href };

  return (
    <article
      data-world={world}
      aria-labelledby="dash-continue-title"
      className="grid min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-1 md:grid-cols-[1.25fr_1fr]"
    >
      <div className="flex min-w-0 flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-world-soft px-2.5 py-0.5 text-caption font-semibold text-world">
            <span aria-hidden="true" className="size-2 rounded-full bg-world" />
            {target.fromLast ? trackBadge : t.startKicker}
          </span>
          {target.fromLast ? <span className="text-caption text-fg-3">{t.continueKicker}</span> : null}
        </div>

        <h2 id="dash-continue-title" lang={title.lang} className="mt-3 text-h2 text-fg">
          {title.value}
        </h2>
        {meta.length ? <p className="tabular mt-1 text-small text-fg-3">{meta.join(' · ')}</p> : null}

        {target.fromLast && pct > 0 ? (
          <div className="mt-3 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={t.progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-1.5 max-w-60 flex-1 overflow-hidden rounded-full bg-sunken"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular text-caption text-fg-3">{pct}%</span>
          </div>
        ) : null}

        <div className="mt-3 min-h-16">
          {objectives.length ? (
            <>
              <p className="sr-only">{t.objectivesLabel}</p>
              <ul className="list-disc space-y-1 pl-5 text-small text-fg-2 marker:text-fg-3">
                {objectives.map((objective) => (
                  <li key={objective.id} lang={objective.lang}>
                    {objective.value}
                  </li>
                ))}
              </ul>
            </>
          ) : subtitle.value ? (
            <p lang={subtitle.lang} className="text-small text-fg-2">
              {subtitle.value}
            </p>
          ) : !loaded ? (
            <div role="status" className="space-y-2" aria-label={t.loading}>
              <div className="h-3 w-4/5 rounded-full bg-sunken motion-safe:animate-pulse" />
              <div className="h-3 w-3/5 rounded-full bg-sunken motion-safe:animate-pulse" />
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink to={primary.to} variant="primary" size="md" trailingIcon={<ArrowRight size={16} aria-hidden="true" />}>
            {primary.label}
          </ButtonLink>
          {finished && next ? (
            <ButtonLink to={href} variant="secondary" size="md">
              {t.readAgain}
            </ButtonLink>
          ) : null}
          <ButtonLink to={COURSE_HOME[target.courseSlug] ?? '/learning-hub'} variant="secondary" size="md">
            {t.outline}
          </ButtonLink>
        </div>
      </div>

      <div className="relative order-first h-20 min-w-0 md:order-none md:h-auto md:min-h-64" style={COVER_STYLE}>
        {facts ? (
          <div className="absolute inset-x-5 bottom-5 hidden rounded-control border border-white/15 bg-black/55 p-3 text-white backdrop-blur-sm md:block">
            <p className="text-caption font-semibold text-white/90">{t.outlineLabel}</p>
            <ol className="mt-1.5 space-y-1">
              {facts.outline.slice(0, 5).map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-small" lang={item.lang}>
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${
                      item.status === 'done'
                        ? 'bg-white text-fg'
                        : item.status === 'current'
                          ? 'bg-sun'
                          : 'border border-white/50'
                    }`}
                  >
                    {item.status === 'done' ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  <span className={`min-w-0 truncate ${item.status === 'current' ? 'font-semibold text-white' : 'text-white'}`}>
                    {item.num ? <span className="tabular mr-1.5 text-white/90">{item.num}</span> : null}
                    {item.title}
                    {item.status === 'done' ? <span className="sr-only">（{t.sectionDone}）</span> : null}
                    {item.status === 'current' ? <span className="sr-only">（{t.sectionCurrent}）</span> : null}
                  </span>
                </li>
              ))}
              {facts.outline.length > 5 ? (
                <li className="pl-6 text-caption text-white/90">+{facts.outline.length - 5}</li>
              ) : null}
            </ol>
          </div>
        ) : null}
      </div>
    </article>
  );
};

/** World gradient plus the morning sun in the top-right corner. */
const COVER_STYLE: React.CSSProperties = {
  backgroundImage: [
    'radial-gradient(110% 85% at 88% 6%, color-mix(in oklab, var(--rp-sun) 45%, white) 0%, var(--rp-sun) 16%, transparent 40%)',
    WORLD_COVER_STYLE.backgroundImage as string,
  ].join(', '),
};

// --- Tracks --------------------------------------------------------------------------------

const VIBE_COURSE_SLUG = 'vibe-coding';

const TrackSection: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language];

  // Progress is saved under the course folder name (the slug getCourse takes), not course.id.
  const vibeCourse = useMemo(() => getCourse(VIBE_COURSE_SLUG) ?? null, []);
  const vibe = useMemo(() => (vibeCourse ? courseTotals(vibeCourse, readLessonSummary, VIBE_COURSE_SLUG) : null), [vibeCourse]);
  const tracks = {
    vibe: trackCopy('vibe', language, vibeCourse),
    unity: trackCopy('unity', language),
    blender: trackCopy('blender', language),
    art: trackCopy('art', language),
  };

  return (
    <section aria-labelledby="dash-tracks">
      <div className={sectionHead}>
        <h2 id="dash-tracks" className="text-h2 text-fg">
          {t.tracks}
        </h2>
        <ButtonLink to="/learning-hub" variant="ghost" size="sm" className="-mr-3" trailingIcon={<ArrowRight size={16} aria-hidden="true" />}>
          {t.seeAll}
        </ButtonLink>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <li className="flex">
          <CourseCard
            className="flex-1"
            world="vibe"
            badge={tracks.vibe.badge}
            title={tracks.vibe.title}
            meta={vibe ? formatCourseMeta(vibe, language) : undefined}
            progress={vibe && vibe.pct > 0 ? vibe.pct : undefined}
            progressLabel={t.trackProgress}
            glyph={<Terminal aria-hidden="true" />}
            to="/vibe"
          />
        </li>
        <li className="flex">
          <CourseCard
            className="flex-1"
            world="unity"
            badge={tracks.unity.badge}
            title={tracks.unity.title}
            description={tracks.unity.description}
            glyph={<Braces aria-hidden="true" />}
            to="/unity"
          />
        </li>
        <li className="flex">
          <CourseCard
            className="flex-1"
            world="blender"
            badge={tracks.blender.badge}
            title={tracks.blender.title}
            description={tracks.blender.description}
            glyph={<Box aria-hidden="true" />}
            to="/blender"
          />
        </li>
        <li className="flex">
          <CourseCard
            className="flex-1"
            world="art"
            badge={tracks.art.badge}
            title={tracks.art.title}
            description={tracks.art.description}
            glyph={<Palette aria-hidden="true" />}
            to="/art"
          />
        </li>
      </ul>
    </section>
  );
};

export default MissionControlDashboard;
