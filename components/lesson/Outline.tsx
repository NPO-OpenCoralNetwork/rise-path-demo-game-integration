import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import type { Lesson } from '../../shared/lesson/schema.js';
import { useLanguage } from '../../context/LanguageContext';
import { useReader } from './ReaderContext';
import { minutesLeft, splitSectionTitle, type SectionStatus } from './model';

/**
 * Lesson outline: one row per section with its state (○ not read, ● reading, ✓ done,
 * ! a check left unanswered), the time left and the next-lesson card. Rendered as the sticky
 * left column at ≥1280px and inside a drawer / bottom sheet below that.
 */

const copy = {
  en: {
    label: 'Lesson contents',
    heading: (min: number) => `This lesson · ${min} min`,
    left: (min: number) => `About ${min} min left`,
    finished: 'All sections read',
    status: {
      todo: 'Not read yet',
      current: 'Reading now',
      done: 'Done',
      attention: 'Check not answered',
    } satisfies Record<SectionStatus, string>,
    unanswered: 'Unanswered',
    wrap: (label: string) => ` (${label})`,
    next: 'Next lesson',
    minutes: (min: number) => `${min} min`,
  },
  jp: {
    label: 'レッスンの目次',
    heading: (min: number) => `このレッスン · ${min}分`,
    left: (min: number) => `残り約 ${min}分`,
    finished: 'すべてのセクションを読みました',
    status: {
      todo: '未読',
      current: '読んでいるところ',
      done: '完了',
      attention: '確認問題が未回答',
    } satisfies Record<SectionStatus, string>,
    unanswered: '未回答',
    wrap: (label: string) => `（${label}）`,
    next: '次のレッスン',
    minutes: (min: number) => `${min}分`,
  },
} as const;

export type OutlineNext = { title: string; href: string; minutes?: number; lang?: string };

type OutlineProps = {
  lesson: Lesson;
  statuses: Record<string, SectionStatus>;
  activeSectionId: string | null;
  pct: number;
  next: OutlineNext | null;
  onSelect: (sectionId: string) => void;
  /** Prefix for element ids, so the aside and the drawer copy do not clash. */
  idPrefix: string;
  /** Hide the heading when the surrounding dialog already titles the list. */
  showHeading?: boolean;
};

function StatusIcon({ status }: { status: SectionStatus }) {
  return (
    <span className="rp-outline-st" data-status={status} aria-hidden="true">
      {status === 'done' && <Check size={12} strokeWidth={3} />}
      {status === 'attention' && '!'}
    </span>
  );
}

export function Outline({ lesson, statuses, activeSectionId, pct, next, onSelect, idPrefix, showHeading = true }: OutlineProps) {
  const { language } = useLanguage();
  const { tx } = useReader();
  const text = copy[language];
  const headingId = `${idPrefix}-heading`;
  const left = minutesLeft(lesson.estMinutes, pct);

  return (
    <nav className="rp-outline" aria-labelledby={headingId}>
      <h2 id={headingId} className={showHeading ? 'rp-outline-heading' : 'sr-only'}>
        {showHeading ? text.heading(lesson.estMinutes) : text.label}
      </h2>
      <ol className="rp-outline-list">
        {lesson.sections.map((section) => {
          const status = statuses[section.id] ?? 'todo';
          const current = section.id === activeSectionId;
          const title = tx(section.title);
          const { num, title: label } = splitSectionTitle(title.value);
          return (
            <li key={section.id} data-status={status} data-current={current || undefined}>
              <a
                href={`#s-${section.id}`}
                aria-current={current ? 'location' : undefined}
                data-autofocus={current || undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(section.id);
                }}
              >
                <StatusIcon status={current && status !== 'done' ? 'current' : status} />
                <span className="rp-outline-text" lang={title.lang}>
                  {num && <span className="rp-outline-num">{num}</span>}
                  {label}
                  {/* Under the title, not a third column: the rail is about 200px wide. */}
                  {status === 'attention' && <span className="rp-outline-tag" aria-hidden="true">{text.unanswered}</span>}
                </span>
                <span className="sr-only">{text.wrap(text.status[current && status !== 'done' ? 'current' : status])}</span>
              </a>
            </li>
          );
        })}
      </ol>
      <p className="rp-outline-left tabular">{left > 0 ? text.left(left) : text.finished}</p>
      {next && (
        <Link to={next.href} className="rp-outline-next">
          <span className="rp-outline-next-label">
            {text.next}
            {next.minutes ? <span className="tabular"> · {text.minutes(next.minutes)}</span> : null}
          </span>
          <span className="rp-outline-next-title" lang={next.lang}>{next.title}</span>
          <ArrowRight size={16} aria-hidden="true" className="rp-outline-next-arrow" />
        </Link>
      )}
    </nav>
  );
}
