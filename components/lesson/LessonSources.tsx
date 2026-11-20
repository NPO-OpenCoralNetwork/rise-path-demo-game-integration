import React, { useId } from 'react';
import { CornerUpLeft, ExternalLink } from 'lucide-react';
import type { Block } from '../../shared/lesson/schema.js';
import { useLanguage } from '../../context/LanguageContext';
import { useOptionalReader } from './ReaderContext';
import {
  citedSources,
  isoDateParts,
  sourceAnchorId,
  sourceHost,
  sourceHref,
  type LessonSourceList,
} from './model';

/**
 * A lesson's sources in the reader (「出典と検索」 step 5).
 *
 * - CiteMarks: under every block that cites sources (the block frame in blocks/registry.tsx
 *   renders it, so all 15 block types get it), the numbers of those sources. Each number is an
 *   in-page link; a plain click (or Enter) asks the reader to open the list and move to that
 *   source (ReaderContext.showSource), a modified click keeps the browser's default.
 * - LessonSources: the folded list after the last section, before the wrap-up: number, title (a
 *   link in a new tab when the URL is http(s)), publisher, host and the day it was checked. The
 *   source the learner came to is marked and offers the way back to where they were reading.
 *
 * Sources are numbered in the order the lesson first cites them (lessonSources in model.ts). The
 * AI tutor plays no part here, so a screen that reuses the blocks without it (training plan §4.6)
 * keeps the sources.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const copy = {
  en: {
    cite: (count: number) => (count === 1 ? 'Source' : 'Sources'),
    citeName: (n: number, title: string) => `Source ${n}: ${title}`,
    title: 'Sources',
    count: (n: number) => ` (${n})`,
    lead: 'What this lesson’s explanations are based on. The numbers match the ones under the lesson’s parts.',
    checked: (year: number, month: number, day: number) => `Checked ${day} ${MONTHS[month - 1]} ${year}`,
    checkedRaw: (raw: string) => `Checked: ${raw}`,
    newTab: '(opens in a new tab)',
    back: 'Back to where you were reading',
  },
  jp: {
    cite: (_count: number) => '出典',
    citeName: (n: number, title: string) => `出典 ${n}：${title}`,
    title: '出典',
    count: (n: number) => `（${n}件）`,
    lead: 'このレッスンの説明のもとにした資料です。番号は、本文のブロックの下にある番号と同じです。',
    checked: (year: number, month: number, day: number) => `${year}年${month}月${day}日に確認`,
    checkedRaw: (raw: string) => `確認：${raw}`,
    newTab: '（新しいタブで開きます）',
    back: '読んでいた場所に戻る',
  },
} as const;

/** The numbers of the sources a block cites. Nothing when it cites none (or outside a reader). */
export function CiteMarks({ block }: { block: Block }) {
  const reader = useOptionalReader();
  const { language } = useLanguage();
  const cited = reader ? citedSources(block, reader.sources) : [];
  if (!reader || cited.length === 0) return null;
  const text = copy[language];
  return (
    <div className="rp-cite">
      {/* Each number's own name says 出典 n, so the label is not read again. */}
      <span className="rp-cite-label" aria-hidden="true">{text.cite(cited.length)}</span>
      {cited.map((source) => (
        <a
          key={source.id}
          href={`#${sourceAnchorId(source.id)}`}
          className="rp-cite-num tabular"
          data-cite={source.id}
          aria-label={text.citeName(source.n, source.title)}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            reader.showSource(source.id, block.id, event.currentTarget);
          }}
        >
          {source.n}
        </a>
      ))}
    </div>
  );
}

/** The source the learner jumped to, and the block they came from. */
export type SourceTarget = { sourceId: string; blockId: string };

type LessonSourcesProps = {
  sources: LessonSourceList;
  /** The list is unfolded (the learner opened it, or jumped to a source). */
  open: boolean;
  onToggle: (open: boolean) => void;
  target: SourceTarget | null;
  /** Back to where the learner was reading when they jumped to `target`. */
  onBack: (target: SourceTarget) => void;
};

/** The lesson's sources, folded, after the last section. Nothing for a lesson without sources. */
export function LessonSources({ sources, open, onToggle, target, onBack }: LessonSourcesProps) {
  const { language } = useLanguage();
  const summaryId = useId();
  if (sources.items.length === 0) return null;
  const text = copy[language];
  return (
    <section className="rp-sources" aria-labelledby={summaryId}>
      <details className="rp-details" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary id={summaryId}>
          {text.title}
          <span className="rp-sources-count tabular">{text.count(sources.items.length)}</span>
        </summary>
        <p className="rp-sources-lead">{text.lead}</p>
        {/* role="list": Safari drops the list role of a list without markers. */}
        <ol className="rp-sources-list" role="list">
          {sources.items.map((source) => {
            const href = sourceHref(source.url);
            const host = sourceHost(href ?? undefined);
            const date = isoDateParts(source.checkedAt);
            const checked = date
              ? text.checked(date.year, date.month, date.day)
              : source.checkedAt ? text.checkedRaw(source.checkedAt) : null;
            const meta = [source.publisher, host, checked].filter((part): part is string => Boolean(part));
            const targeted = target !== null && target.sourceId === source.id;
            return (
              <li
                key={source.id}
                id={sourceAnchorId(source.id)}
                tabIndex={-1}
                className="rp-sources-item"
                data-target={targeted || undefined}
              >
                <span className="rp-sources-n tabular">{source.n}</span>
                <span className="rp-sources-body">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="rp-sources-link">
                      {source.title}
                      <ExternalLink size={13} aria-hidden="true" />
                      <span className="sr-only">{text.newTab}</span>
                    </a>
                  ) : (
                    <span className="rp-sources-title">{source.title}</span>
                  )}
                  {meta.length > 0 ? (
                    <span className="rp-sources-meta">
                      {/* Each part wraps as a whole (a phone broke 「2026年10月20日｜に確認」), and the
                          dot stays at the end of the line before. */}
                      {meta.map((part, index) => (
                        <React.Fragment key={index}>
                          {index > 0 ? ' ' : null}
                          <span className="rp-sources-meta-part">{index < meta.length - 1 ? `${part} ·` : part}</span>
                        </React.Fragment>
                      ))}
                    </span>
                  ) : null}
                  {targeted ? (
                    <button type="button" className="rp-link-btn rp-sources-back" onClick={() => onBack(target)}>
                      <CornerUpLeft size={14} aria-hidden="true" />
                      {text.back}
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
