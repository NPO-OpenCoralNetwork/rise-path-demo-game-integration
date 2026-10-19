import React, { useId } from 'react';
import { BookOpen, CornerDownRight, Sparkles } from 'lucide-react';
import type { Block, Section } from '../../shared/lesson/schema.js';
import { useLanguage } from '../../context/LanguageContext';
import { useReader } from './ReaderContext';
import { MdText, Txt } from './Md';
import type { GlossaryItem } from './model';

/**
 * Glossary card of the reader: the lesson's terms (the section being read first) and the
 * selected term's meaning, with "show in the text" and "ask the tutor". The AI tutor itself is
 * TutorPanel (WP-11). Shown in the sticky margin column at ≥1280px and in a side sheet below.
 */

const copy = {
  en: {
    glossary: 'Terms · this lesson',
    pickTerm: 'Pick a term to see its meaning.',
    showInText: 'Show in the text',
    askTerm: 'Ask the tutor',
    askTermMessage: (term: string) => `What does "${term}" mean here? Please explain with an everyday example.`,
    terms: 'Terms',
  },
  jp: {
    glossary: '用語 · このレッスン',
    pickTerm: '用語を選ぶと、意味が表示されます。',
    showInText: '本文で見る',
    askTerm: 'AI先生に聞く',
    askTermMessage: (term: string) => `「${term}」とはどういう意味ですか？身近な例で説明してください。`,
    terms: '用語',
  },
} as const;

export type MarginAnchor = { block: Block; section: Section; excerpt: string } | null;

type MarginPanelProps = {
  /** The paragraph last sent to the tutor, if any (context for "ask the tutor"). */
  asked: MarginAnchor;
  /** Where the learner is reading now (fallback context, and which terms come first). */
  current: { block?: Block; section?: Section };
  glossary: GlossaryItem[];
  selectedTerm: GlossaryItem | null;
  onSelectTerm: (item: GlossaryItem) => void;
  /** Called after an action that should close a surrounding sheet. */
  onDone?: () => void;
};

export function MarginPanel({ asked, current, glossary, selectedTerm, onSelectTerm, onDone }: MarginPanelProps) {
  const { language } = useLanguage();
  const { askTutor, tx, t, scrollToBlock } = useReader();
  const text = copy[language];
  const uid = useId();
  const glossaryTitleId = `${uid}-glossary`;

  const section = asked?.section ?? current.section;
  const block = asked?.block ?? current.block;

  // Terms of the section being read come first; the rest follow.
  const sectionId = current.section?.id;
  const ordered = sectionId
    ? [...glossary.filter((g) => g.sectionId === sectionId), ...glossary.filter((g) => g.sectionId !== sectionId)]
    : glossary;
  const chips = ordered.slice(0, 10);

  if (glossary.length === 0) return null;

  return (
    <div role="group" className="rp-margin-card rp-glossary-card" aria-labelledby={glossaryTitleId}>
      <div className="rp-tutor-head">
        <BookOpen size={15} aria-hidden="true" className="text-fg-3" />
        <h2 id={glossaryTitleId} className="rp-margin-title">{text.glossary}</h2>
      </div>
      {selectedTerm ? (
        <div className="rp-glossary-entry" aria-live="polite">
          <Txt value={selectedTerm.term} as="p" className="rp-glossary-term" />
          <MdText value={selectedTerm.md} className="rp-glossary-def" />
          <div className="rp-glossary-actions">
            {selectedTerm.blockId && (
              <button
                type="button"
                className="rp-link-btn"
                onClick={() => {
                  scrollToBlock(selectedTerm.blockId!);
                  onDone?.();
                }}
              >
                <CornerDownRight size={14} aria-hidden="true" />{text.showInText}
              </button>
            )}
            <button
              type="button"
              className="rp-link-btn"
              onClick={() => {
                const term = t(selectedTerm.term);
                askTutor({ message: text.askTermMessage(term), excerpt: `${term}: ${t(selectedTerm.md)}`, mode: 'explain', block, section });
                onDone?.();
              }}
            >
              <Sparkles size={14} aria-hidden="true" />{text.askTerm}
            </button>
          </div>
        </div>
      ) : (
        <p className="rp-tutor-intro">{text.pickTerm}</p>
      )}
      <ul className="rp-glossary-chips" aria-label={text.terms}>
        {chips.map((item) => {
          const label = tx(item.term);
          return (
            <li key={item.key}>
              <button
                type="button"
                className="rp-term-chip"
                aria-pressed={selectedTerm?.key === item.key}
                lang={label.lang}
                onClick={() => onSelectTerm(item)}
              >
                {label.value}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
