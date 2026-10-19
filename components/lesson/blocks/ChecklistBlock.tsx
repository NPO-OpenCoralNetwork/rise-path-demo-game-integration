import React from 'react';
import { CircleCheckBig, ListChecks, RotateCcw } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';

const copy = {
  en: {
    title: 'Checklist',
    done: (n: number, m: number) => `${n} of ${m} done`,
    complete: 'All done!',
    reset: 'Clear',
    resetLabel: 'Untick every item',
  },
  jp: {
    title: 'チェックリスト',
    done: (n: number, m: number) => `${m}項目中 ${n} 完了`,
    complete: 'すべて完了！',
    reset: 'クリア',
    resetLabel: 'すべてのチェックを外す',
  },
} as const;

/** Items the learner ticks off: n/m counter and meter, state saved with the lesson progress. */
export default function ChecklistBlock({ block }: BlockProps<'checklist'>) {
  const { language } = useLanguage();
  const { progress } = useReader();
  const text = copy[language];
  const key = (itemId: string) => `checklist:${block.id}/${itemId}`;
  const doneCount = block.items.filter((item) => progress.getCheck(key(item.id))).length;
  const total = block.items.length;
  const complete = doneCount === total;
  const titleId = `${block.id}-title`;

  return (
    <section className="rp-checklist" aria-labelledby={titleId} data-complete={complete || undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ListChecks size={17} aria-hidden="true" className="shrink-0 text-primary-text" />
        <h3 id={titleId} className="rp-card-title m-0">
          {block.title ? <Txt value={block.title} /> : text.title}
        </h3>
        <span className="rp-checklist-count tabular" aria-live="polite">
          {complete ? <><CircleCheckBig size={14} aria-hidden="true" />{text.complete}</> : text.done(doneCount, total)}
        </span>
      </div>
      <div
        className="rp-meter mt-3"
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={doneCount}
        aria-valuetext={text.done(doneCount, total)}
      >
        <span style={{ width: `${(doneCount / Math.max(1, total)) * 100}%` }} />
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {block.items.map((item) => {
          const checked = Boolean(progress.getCheck(key(item.id)));
          const inputId = `${block.id}-${item.id}`;
          return (
            <li key={item.id}>
              <label htmlFor={inputId} className="rp-check-row" data-checked={checked || undefined}>
                <input
                  id={inputId}
                  type="checkbox"
                  className="rp-checkbox"
                  checked={checked}
                  onChange={(event) => progress.setCheck(key(item.id), event.target.checked)}
                />
                <span className="min-w-0">
                  <Txt value={item.label} className="rp-check-label" />
                  {item.md && <MdText value={item.md} className="rp-check-detail" />}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {doneCount > 0 && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="rp-link-btn"
            aria-label={text.resetLabel}
            onClick={() => block.items.forEach((item) => progress.setCheck(key(item.id), false))}
          >
            <RotateCcw size={13} aria-hidden="true" />{text.reset}
          </button>
        </div>
      )}
    </section>
  );
}
