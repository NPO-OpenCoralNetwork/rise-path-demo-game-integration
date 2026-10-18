import React from 'react';
import {
  CircleCheck,
  Info,
  Lightbulb,
  NotebookPen,
  OctagonAlert,
  Tag,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { BlockProps } from './registry';
import { AskAnchor } from '../AskAnchor';
import { Markdown, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { plainText } from '../model';
import { useLanguage } from '../../../context/LanguageContext';

type Variant = BlockProps<'callout'>['block']['variant'];

const VARIANTS: Record<Variant, { icon: LucideIcon; tone: string }> = {
  tip: { icon: Lightbulb, tone: 'rp-callout-primary' },
  success: { icon: CircleCheck, tone: 'rp-callout-success' },
  info: { icon: Info, tone: 'rp-callout-info' },
  note: { icon: NotebookPen, tone: 'rp-callout-info' },
  warning: { icon: TriangleAlert, tone: 'rp-callout-danger' },
  pitfall: { icon: OctagonAlert, tone: 'rp-callout-danger' },
  analogy: { icon: Tag, tone: 'rp-callout-world' },
};

const copy = {
  en: { tip: 'Tip', success: 'Well done', info: 'Good to know', note: 'Note', warning: 'Watch out', pitfall: 'Common pitfall', analogy: 'Think of it like this' },
  jp: { tip: 'ヒント', success: 'できたこと', info: '補足', note: 'メモ', warning: '注意', pitfall: 'よくあるつまずき', analogy: 'たとえるなら' },
} as const;

/** Icon column + sentence-case title + body at body size (never smaller than the prose). */
export default function CalloutBlock({ block, section }: BlockProps<'callout'>) {
  const { language } = useLanguage();
  const { tx } = useReader();
  const variant = VARIANTS[block.variant] ?? VARIANTS.note;
  const Icon = variant.icon;
  const titleId = `${block.id}-title`;
  const body = tx(block.md);
  return (
    <AskAnchor block={block} section={section} excerpt={plainText(body.value)}>
      <aside role="note" aria-labelledby={titleId} className={`rp-callout ${variant.tone}`}>
        <Icon size={20} aria-hidden="true" className="rp-callout-icon" />
        <div className="min-w-0">
          <p id={titleId} className="rp-callout-title">
            {block.title ? <Txt value={block.title} /> : copy[language][block.variant] ?? copy[language].note}
          </p>
          <div className="rp-callout-body" lang={body.lang}>
            <Markdown source={body.value} />
          </div>
        </div>
      </aside>
    </AskAnchor>
  );
}
