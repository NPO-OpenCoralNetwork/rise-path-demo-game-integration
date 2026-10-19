import React from 'react';
import { Check } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText } from '../Md';

/** Real <ol>/<ul> with native markers (never display:flex on li). `check` lists get a tick icon. */
export default function ListBlock({ block }: BlockProps<'list'>) {
  if (block.style === 'number') {
    return (
      <ol className="rp-list rp-list-number">
        {block.items.map((item, i) => (
          <li key={i}><MdText value={item} inline /></li>
        ))}
      </ol>
    );
  }
  if (block.style === 'check') {
    return (
      <ul className="rp-list rp-list-check">
        {block.items.map((item, i) => (
          <li key={i}>
            <Check size={16} aria-hidden="true" className="rp-list-check-icon" />
            <span><MdText value={item} inline /></span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="rp-list rp-list-bullet">
      {block.items.map((item, i) => (
        <li key={i}><MdText value={item} inline /></li>
      ))}
    </ul>
  );
}
