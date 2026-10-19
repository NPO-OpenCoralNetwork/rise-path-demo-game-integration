import React, { useMemo } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import type { BlockProps } from './registry';
import { useReader } from '../ReaderContext';
import { blockPlainText } from '../model';
import { TUTOR_EXCERPT_MAX } from '../../../services/tutorBridge';
import { useLanguage } from '../../../context/LanguageContext';

const copy = {
  en: {
    title: 'Ask the AI tutor',
    hint: 'Questions learners often have here. Pick one and the tutor answers with this section in mind.',
    ask: (q: string) => `Ask the AI tutor: ${q}`,
  },
  jp: {
    title: 'AI先生に聞いてみよう',
    hint: 'ここでよく出る質問です。選ぶと、このセクションの内容をふまえてAI先生が答えます。',
    ask: (q: string) => `AI先生に質問する：${q}`,
  },
} as const;

/** Suggested questions that open the AI tutor with this section as context. */
export default function AskTutorBlock({ block, section }: BlockProps<'askTutor'>) {
  const { language } = useLanguage();
  const { tx, t, askTutor } = useReader();
  const text = copy[language];
  // The section around the chips is what the questions are about.
  const excerpt = useMemo(
    () => section.blocks
      .filter((b) => b.id !== block.id)
      .map((b) => blockPlainText(b, t, 600))
      .filter(Boolean)
      .join('\n')
      .slice(0, TUTOR_EXCERPT_MAX),
    [section, block.id, t],
  );
  const titleId = `${block.id}-title`;
  return (
    <div role="group" className="rp-asktutor" aria-labelledby={titleId}>
      <div className="flex items-center gap-2">
        <span className="rp-asktutor-icon" aria-hidden="true">
          <Sparkles size={15} />
        </span>
        <h3 id={titleId} className="rp-card-title m-0">{text.title}</h3>
      </div>
      <p className="rp-asktutor-hint">{text.hint}</p>
      <ul className="rp-asktutor-list">
        {block.suggestions.map((suggestion, i) => {
          const { value, lang } = tx(suggestion);
          if (!value) return null;
          return (
            <li key={i}>
              <button
                type="button"
                lang={lang}
                className="rp-suggestion rp-asktutor-q"
                aria-label={text.ask(value)}
                onClick={() => askTutor({ message: value, block, section, excerpt: excerpt || undefined, mode: 'explain' })}
              >
                <span className="min-w-0">{value}</span>
                <ArrowUpRight size={15} aria-hidden="true" className="rp-asktutor-arrow" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
