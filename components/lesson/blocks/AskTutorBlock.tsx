import React from 'react';
import { Sparkles } from 'lucide-react';
import type { BlockProps } from './registry';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';

const copy = {
  en: { title: 'Ask the AI tutor', hint: 'Pick a question to ask about this section.' },
  jp: { title: 'AI先生に聞いてみよう', hint: 'このセクションについて、気になる質問を選んでください。' },
} as const;

/** Suggested questions that open the AI tutor with this section as context. */
export default function AskTutorBlock({ block, section }: BlockProps<'askTutor'>) {
  const { language } = useLanguage();
  const { tx, askTutor } = useReader();
  const text = copy[language];
  const titleId = `${block.id}-title`;
  return (
    <section className="rp-asktutor" aria-labelledby={titleId}>
      <div className="flex items-center gap-2">
        <Sparkles size={16} aria-hidden="true" className="text-primary-text" />
        <h3 id={titleId} className="rp-card-title m-0">{text.title}</h3>
      </div>
      <p className="mt-1 mb-3 text-small text-fg-2">{text.hint}</p>
      <ul className="flex flex-wrap gap-2">
        {block.suggestions.map((suggestion, i) => {
          const { value, lang } = tx(suggestion);
          if (!value) return null;
          return (
            <li key={i}>
              <button
                type="button"
                lang={lang}
                className="rp-suggestion"
                onClick={() => askTutor({ message: value, block, section, mode: 'explain' })}
              >
                {value}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
