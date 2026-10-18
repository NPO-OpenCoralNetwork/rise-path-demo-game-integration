import React, { useId, useState } from 'react';
import { BookOpen, CornerDownRight, Send, Sparkles } from 'lucide-react';
import type { Block, Section } from '../../shared/lesson/schema.js';
import { useLanguage } from '../../context/LanguageContext';
import { useReader } from './ReaderContext';
import { MdText, Txt } from './Md';
import { splitSectionTitle, type GlossaryItem } from './model';

/**
 * Right margin of the reader: an "AI tutor" card tied to the paragraph the learner asked about
 * (or the section being read) and a glossary card. The tutor card hands questions to the chat
 * panel through openTutor(); WP-11 replaces it with the inline streaming panel.
 * Shown as a sticky column at ≥1280px and in a side sheet below that.
 */

const copy = {
  en: {
    tutor: 'AI tutor',
    aboutParagraph: 'About this paragraph',
    aboutSection: 'About this section',
    intro: 'Press ✦ next to a paragraph, or ask here. The tutor answers with this lesson as context.',
    suggestions: [
      { label: 'Explain it more simply', message: 'Can you explain this more simply?' },
      { label: 'Another example', message: 'Can you give me a different example?' },
      { label: 'Quiz me', message: 'Give me one short question to check that I understood this.' },
    ],
    placeholder: 'Ask about this part…',
    inputLabel: 'Your question for the AI tutor',
    send: 'Send',
    glossary: 'Terms · this lesson',
    pickTerm: 'Pick a term to see its meaning.',
    showInText: 'Show in the text',
    askTerm: 'Ask the tutor',
    askTermMessage: (term: string) => `What does "${term}" mean here? Please explain with an everyday example.`,
    terms: 'Terms',
  },
  jp: {
    tutor: 'AI先生',
    aboutParagraph: 'この段落について',
    aboutSection: 'このセクションについて',
    intro: '段落の横の ✦ を押すか、ここから質問できます。AI先生はこのレッスンの内容をふまえて答えます。',
    suggestions: [
      { label: 'もっと簡単に', message: 'もっと簡単な言葉で説明してください。' },
      { label: '別の例', message: '別の例で説明してください。' },
      { label: 'クイズを出して', message: '理解できたか確かめる短い問題を1問出してください。' },
    ],
    placeholder: 'この部分について質問…',
    inputLabel: 'AI先生への質問',
    send: '送信',
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
  /** The paragraph last sent to the tutor, if any. */
  asked: MarginAnchor;
  /** Where the learner is reading now (fallback context). */
  current: { block?: Block; section?: Section };
  glossary: GlossaryItem[];
  selectedTerm: GlossaryItem | null;
  onSelectTerm: (item: GlossaryItem) => void;
  /** Called after an action that should close a surrounding sheet. */
  onDone?: () => void;
  /** The question input, so the LessonBar's AI tutor button can focus it. */
  inputRef?: React.Ref<HTMLInputElement>;
};

export function MarginPanel({ asked, current, glossary, selectedTerm, onSelectTerm, onDone, inputRef }: MarginPanelProps) {
  const { language } = useLanguage();
  const { askTutor, tx, t, scrollToBlock } = useReader();
  const text = copy[language];
  const [draft, setDraft] = useState('');
  const uid = useId();
  const tutorTitleId = `${uid}-tutor`;
  const glossaryTitleId = `${uid}-glossary`;

  const section = asked?.section ?? current.section;
  const block = asked?.block ?? current.block;
  const sectionTitle = section ? tx(section.title) : null;
  const quote = asked?.excerpt
    ?? (sectionTitle ? splitSectionTitle(sectionTitle.value).title : '');

  const send = (message: string) => {
    if (!message.trim()) return;
    askTutor({
      message: message.trim(),
      block,
      section,
      excerpt: asked?.excerpt,
      mode: 'explain',
    });
    onDone?.();
  };

  // Terms of the section being read come first; the rest follow.
  const sectionId = current.section?.id;
  const ordered = sectionId
    ? [...glossary.filter((g) => g.sectionId === sectionId), ...glossary.filter((g) => g.sectionId !== sectionId)]
    : glossary;
  const chips = ordered.slice(0, 10);

  return (
    <div className="rp-margin-stack">
      <section className="rp-margin-card rp-tutor-card" aria-labelledby={tutorTitleId}>
        <div className="rp-tutor-head">
          <Sparkles size={15} aria-hidden="true" className="text-primary-text" />
          <h2 id={tutorTitleId} className="rp-margin-title">{text.tutor}</h2>
          <span className="rp-tutor-scope">{asked ? text.aboutParagraph : text.aboutSection}</span>
        </div>
        {quote && (
          <blockquote className="rp-tutor-quote" lang={asked ? undefined : sectionTitle?.lang}>
            {quote.length > 140 ? `${quote.slice(0, 139)}…` : quote}
          </blockquote>
        )}
        <p className="rp-tutor-intro">{text.intro}</p>
        <ul className="rp-tutor-chips">
          {text.suggestions.map((s) => (
            <li key={s.label}>
              <button type="button" className="rp-suggestion rp-suggestion-sm" onClick={() => send(s.message)}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="rp-tutor-form"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
            setDraft('');
          }}
        >
          <label htmlFor={`${uid}-input`} className="sr-only">{text.inputLabel}</label>
          <input
            ref={inputRef}
            id={`${uid}-input`}
            type="text"
            className="rp-input"
            placeholder={text.placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="rp-btn rp-btn-primary rp-btn-sm" disabled={!draft.trim()}>
            <Send size={14} aria-hidden="true" />
            {text.send}
          </button>
        </form>
      </section>

      {glossary.length > 0 && (
        <section className="rp-margin-card rp-glossary-card" aria-labelledby={glossaryTitleId}>
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
        </section>
      )}
    </div>
  );
}
