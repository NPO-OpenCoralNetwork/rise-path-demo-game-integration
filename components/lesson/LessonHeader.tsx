import React from 'react';
import { Clock, Gauge, Target } from 'lucide-react';
import type { Lesson } from '../../shared/lesson/schema.js';
import { useLanguage } from '../../context/LanguageContext';
import { useReader } from './ReaderContext';
import { MdText, Txt } from './Md';
import { splitLessonTitle } from './model';
import type { LessonEntry } from '../../content';

/**
 * Lesson title block in the reading flow (left-aligned, never centred): eyebrow with the
 * chapter and module, title, subtitle, meta row and the objectives card.
 */

const copy = {
  en: {
    position: (module: number, lesson: number) => `Module ${module} · Lesson ${lesson}`,
    minutes: (min: number) => `${min} min`,
    time: 'Estimated time',
    level: 'Level',
    levels: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
    before: 'Before this: ',
    objectives: 'By the end of this lesson you can',
  },
  jp: {
    position: (module: number, lesson: number) => `モジュール${module} · レッスン${lesson}`,
    minutes: (min: number) => `${min}分`,
    time: '目安の時間',
    level: 'レベル',
    levels: { beginner: '初級', intermediate: '中級', advanced: '上級' },
    before: '前提：',
    objectives: 'このレッスンでできるようになること',
  },
} as const;

type LessonHeaderProps = {
  lesson: Lesson;
  entry?: LessonEntry;
};

export function LessonHeader({ lesson, entry }: LessonHeaderProps) {
  const { language } = useLanguage();
  const { tx, t } = useReader();
  const text = copy[language];
  const title = tx(lesson.title);
  const { kicker, title: mainTitle } = splitLessonTitle(title.value);
  const moduleTitle = entry ? t(entry.module.title) : '';
  const position = entry ? text.position(entry.moduleIndex + 1, entry.indexInModule + 1) : null;
  const eyebrow = [kicker ?? position, moduleTitle].filter(Boolean).join(' · ');
  const objectivesId = `${lesson.id}-objectives`;
  const prerequisites = (lesson.prerequisites ?? []).map((p) => t(p)).filter(Boolean);

  return (
    <header className="rp-header">
      {eyebrow && <p className="rp-eyebrow" lang={title.lang}>{eyebrow}</p>}
      <h1 className="rp-title" lang={title.lang}>{mainTitle}</h1>
      {lesson.subtitle && <Txt value={lesson.subtitle} as="p" className="rp-subtitle" />}
      <ul className="rp-meta">
        <li>
          <Clock size={14} aria-hidden="true" />
          <span className="sr-only">{text.time}: </span>
          <span className="tabular">{text.minutes(lesson.estMinutes)}</span>
        </li>
        {lesson.level && (
          <li>
            <Gauge size={14} aria-hidden="true" />
            <span className="sr-only">{text.level}: </span>
            {text.levels[lesson.level]}
          </li>
        )}
        {prerequisites.length > 0 && (
          <li className="rp-meta-pre">
            {text.before}
            {prerequisites.join(language === 'jp' ? '、' : ', ')}
          </li>
        )}
      </ul>
      {lesson.objectives.length > 0 && (
        <section className="rp-objectives" aria-labelledby={objectivesId}>
          <h2 id={objectivesId} className="rp-objectives-title">
            <Target size={16} aria-hidden="true" />
            {text.objectives}
          </h2>
          <ul>
            {lesson.objectives.map((objective) => (
              <li key={objective.id}><MdText value={objective.text} inline /></li>
            ))}
          </ul>
        </section>
      )}
    </header>
  );
}
