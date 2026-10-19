import React, { useEffect, useState } from 'react';
import { ArrowRight, FolderOpen, Sparkles } from 'lucide-react';
import { ViewState, GeneratedCourse } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import PageHeader from '../../ui/PageHeader';
import EmptyState from '../../ui/EmptyState';
import CourseCard from '../../ui/CourseCard';
import { Button, ButtonLink } from '../../ui/Button';
import { authoringGuideUrl } from '../../ui/links';

interface MyContentProps {
  onNavigate?: (view: ViewState) => void;
  onSelectCourse?: (course: GeneratedCourse) => void;
  /** A course generated in this session, shown at the top until the page reloads. */
  newCourseForLibrary?: GeneratedCourse | null;
}

const copy = {
  en: {
    title: 'My content',
    description: 'Courses you generate and lessons you write end up here.',
    generate: 'Generate a course with AI',
    recent: 'Created in this session',
    open: 'Open',
    emptyTitle: 'Nothing of your own yet',
    emptyBody:
      'Enter a topic and the course generator drafts a learning path. Generated courses are saved under Profile → Generated. To write lessons for this reader, use Claude Code and the authoring guide.',
    seeGenerated: 'See generated courses',
    guide: 'Authoring guide (Claude Code)',
    opensInNewTab: '(opens in a new tab)',
    generatedBadge: 'Generated',
  },
  jp: {
    title: 'マイコンテンツ',
    description: 'AIで生成したコースや、自分で書いた教材の入り口です。',
    generate: 'AIでコースを生成',
    recent: 'このセッションでつくったコース',
    open: '開く',
    emptyTitle: 'まだ自分の教材はありません',
    emptyBody:
      'テーマを入力すると、AIが学習パスの下書きをつくります。生成したコースはプロフィールの「生成物」に保存されます。このリーダー用の教材を書くときは、Claude Code と作成ガイドを使います。',
    seeGenerated: '生成したコースを見る',
    guide: '作成ガイド（Claude Code）',
    opensInNewTab: '（新しいタブで開きます）',
    generatedBadge: 'AI生成',
  },
} as const;

const resolveText = (value: unknown, language: 'en' | 'jp'): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const picked = record[language] ?? record.en ?? record.jp;
    return typeof picked === 'string' ? picked : '';
  }
  return '';
};

const MyContent: React.FC<MyContentProps> = ({ onNavigate, onSelectCourse, newCourseForLibrary }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const t = copy[language];
  const [recent, setRecent] = useState<GeneratedCourse[]>([]);

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  // Keep a course handed over by the generator, without duplicates.
  useEffect(() => {
    if (!newCourseForLibrary) return;
    setRecent((prev) => (prev.some((c) => c.id === newCourseForLibrary.id) ? prev : [newCourseForLibrary, ...prev]));
  }, [newCourseForLibrary]);

  const openCourse = (course: GeneratedCourse) => {
    if (onSelectCourse) onSelectCourse(course);
    else onNavigate?.(ViewState.GENERATED_COURSE_PATH);
  };

  return (
    <div className="mx-auto w-full max-w-page pb-16 pt-6 sm:pt-8">
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          onNavigate ? (
            <Button variant="primary" leadingIcon={<Sparkles size={16} aria-hidden="true" />} onClick={() => onNavigate(ViewState.COURSE_GENERATOR)}>
              {t.generate}
            </Button>
          ) : null
        }
      />

      {recent.length ? (
        <section aria-labelledby="my-content-recent" className="mt-8">
          <h2 id="my-content-recent" className="mb-3 text-h2 text-fg">
            {t.recent}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((course) => (
              <li key={course.id} className="flex">
                <CourseCard
                  className="flex-1"
                  world="ai"
                  badge={t.generatedBadge}
                  title={resolveText(course.title, language)}
                  description={resolveText(course.description, language)}
                  meta={course.duration || undefined}
                  glyph={<Sparkles aria-hidden="true" />}
                  onClick={() => openCourse(course)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <EmptyState
        className="mt-8"
        layout="centered"
        tone="primary"
        icon={<FolderOpen size={20} />}
        headingLevel={2}
        title={t.emptyTitle}
        description={t.emptyBody}
        action={
          <>
            {onNavigate ? (
              <Button variant="secondary" onClick={() => onNavigate(ViewState.PROFILE_GENERATED)}>
                {t.seeGenerated}
              </Button>
            ) : null}
            <ButtonLink href={authoringGuideUrl(language)} external variant="ghost" trailingIcon={<ArrowRight size={16} aria-hidden="true" />}>
              {t.guide}
              <span className="sr-only">{t.opensInNewTab}</span>
            </ButtonLink>
          </>
        }
      />
    </div>
  );
};

export default MyContent;
