import React from 'react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';

const copy = {
  en: { table: 'Table' },
  jp: { table: '表' },
} as const;

/**
 * 1px rules, caption, header row, first column as row headers. Scrolls horizontally inside its
 * own region on narrow screens (first column stays put).
 */
export default function TableBlock({ block }: BlockProps<'table'>) {
  const { language } = useLanguage();
  const { t } = useReader();
  const captionId = `${block.id}-caption`;
  const caption = t(block.caption);
  return (
    <figure className="rp-figure">
      <div
        className="rp-table-scroll"
        role="region"
        aria-labelledby={caption ? captionId : undefined}
        aria-label={caption ? undefined : copy[language].table}
        tabIndex={0}
      >
        <table className="rp-table">
          {caption && (
            <caption id={captionId} className="sr-only"><Txt value={block.caption} /></caption>
          )}
          <thead>
            <tr>
              {block.columns.map((col, i) => (
                <th key={i} scope="col"><Txt value={col} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (c === 0
                  ? <th key={c} scope="row"><MdText value={cell} inline /></th>
                  : <td key={c}><MdText value={cell} inline /></td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && (
        <figcaption aria-hidden="true" className="rp-figcaption"><Txt value={block.caption} /></figcaption>
      )}
    </figure>
  );
}
