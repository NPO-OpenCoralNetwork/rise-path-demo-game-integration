import React from 'react';
import type { BlockProps } from './registry';
import { AskAnchor } from '../AskAnchor';
import { Markdown } from '../Md';
import { useReader } from '../ReaderContext';
import { plainText } from '../model';

/** Prose. `lead` is the larger intro paragraph, `quote` a blockquote. Every paragraph block gets ✦. */
export default function MarkdownBlock({ block, section }: BlockProps<'markdown'>) {
  const { tx } = useReader();
  const { value, lang } = tx(block.md);
  if (!value) return null;
  const body = <Markdown source={value} />;
  const content = block.style === 'quote'
    ? <blockquote className="rp-quote" lang={lang}>{body}</blockquote>
    : <div className={block.style === 'lead' ? 'rp-lead' : undefined} lang={lang}>{body}</div>;
  return (
    <AskAnchor block={block} section={section} excerpt={plainText(value)}>
      {content}
    </AskAnchor>
  );
}
