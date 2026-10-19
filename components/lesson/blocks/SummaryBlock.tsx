import React from 'react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useLanguage } from '../../../context/LanguageContext';

const copy = {
  en: { title: 'Key points' },
  jp: { title: 'まとめ' },
} as const;

/** Key takeaways. Inside a section titled "まとめ" the card drops its own heading. */
export default function SummaryBlock({ block, section }: BlockProps<'summary'>) {
  const { language } = useLanguage();
  const headingId = `${block.id}-title`;
  const showTitle = Boolean(block.title) || section.role !== 'summary';
  return (
    <div role="group" className="rp-summary" aria-labelledby={showTitle ? headingId : undefined}>
      {showTitle && (
        <h3 id={headingId} className="rp-card-title">
          {block.title ? <Txt value={block.title} /> : copy[language].title}
        </h3>
      )}
      <ol className="rp-summary-list">
        {block.points.map((point, i) => (
          <li key={i}><MdText value={point} inline /></li>
        ))}
      </ol>
    </div>
  );
}
