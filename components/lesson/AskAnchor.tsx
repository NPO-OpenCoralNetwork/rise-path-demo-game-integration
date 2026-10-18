import React from 'react';
import { Sparkles } from 'lucide-react';
import type { Block, Section } from '../../shared/lesson/schema.js';
import { useLanguage } from '../../context/LanguageContext';
import { useReader } from './ReaderContext';

/**
 * ✦ "ask about this paragraph". Wraps a prose block:
 * - ≥1024px: a button in the right gutter, shown on hover, keyboard focus, or after a click.
 * - <1024px (touch): tap the paragraph to arm it; the button appears under the text.
 *   Keyboard users still reach the button: it stays focusable and shows itself on focus.
 * Pressing it calls openTutor({ lesson, anchor }) through the reader context.
 */

const copy = {
  en: {
    ask: 'Ask the AI tutor about this paragraph',
    label: 'Ask AI tutor',
    message: 'Can you explain this paragraph in simpler terms?',
  },
  jp: {
    ask: 'この段落についてAI先生に質問する',
    label: 'AI先生に聞く',
    message: 'この段落をもう少しかみくだいて説明してください。',
  },
} as const;

const INTERACTIVE = 'a, button, input, textarea, select, summary, [role="button"]';

type AskAnchorProps = {
  block: Block;
  section: Section;
  excerpt: string;
  children: React.ReactNode;
};

export function AskAnchor({ block, section, excerpt, children }: AskAnchorProps) {
  const { language } = useLanguage();
  const { askTutor, askedBlockId, armedBlockId, setArmedBlockId } = useReader();
  const text = copy[language];
  const asked = askedBlockId === block.id;
  const armed = armedBlockId === block.id;

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    setArmedBlockId(armed ? null : block.id);
  };

  return (
    <div
      className="rp-ask"
      data-armed={armed || undefined}
      data-asked={asked || undefined}
      onClick={onClick}
    >
      {children}
      <button
        type="button"
        className="rp-ask-btn"
        aria-label={text.ask}
        title={text.ask}
        onClick={(event) => {
          event.stopPropagation();
          setArmedBlockId(null);
          askTutor({ message: text.message, block, section, excerpt, mode: 'explain' });
        }}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span className="rp-ask-label" aria-hidden="true">{text.label}</span>
      </button>
    </div>
  );
}
