import React from 'react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';

const copy = {
  en: { title: 'Checklist', done: (n: number, m: number) => `${n} of ${m} done` },
  jp: { title: 'チェックリスト', done: (n: number, m: number) => `${m}項目中 ${n} 完了` },
} as const;

/** Items the learner ticks off; state is saved with the lesson progress. */
export default function ChecklistBlock({ block }: BlockProps<'checklist'>) {
  const { language } = useLanguage();
  const { progress } = useReader();
  const text = copy[language];
  const key = (itemId: string) => `checklist:${block.id}/${itemId}`;
  const doneCount = block.items.filter((item) => progress.getCheck(key(item.id))).length;
  const titleId = `${block.id}-title`;

  return (
    <section className="rp-checklist" aria-labelledby={titleId}>
      <div className="flex items-baseline gap-3">
        <h3 id={titleId} className="rp-card-title m-0">
          {block.title ? <Txt value={block.title} /> : text.title}
        </h3>
        <span className="ml-auto text-small text-fg-3 tabular" aria-live="polite">
          {text.done(doneCount, block.items.length)}
        </span>
      </div>
      <div
        className="rp-meter mt-2"
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={block.items.length}
        aria-valuenow={doneCount}
      >
        <span style={{ width: `${(doneCount / Math.max(1, block.items.length)) * 100}%` }} />
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
    </section>
  );
}
