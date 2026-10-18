import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, ThumbsUp } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * Review cards: flip (button with aria-pressed; Space/Enter), "again" / "got it" saved with the
 * progress (checks `card:<block>/<card>`). WP-05 connects them to the review queue.
 */

const copy = {
  en: {
    title: 'Review cards',
    count: (n: number, m: number) => `Card ${n} of ${m}`,
    known: (n: number, m: number) => `${n}/${m} known`,
    front: 'Question',
    back: 'Answer',
    flip: 'Click or press Space to flip',
    flipLabel: 'Flip the card',
    prev: 'Previous card',
    next: 'Next card',
    again: 'Again',
    gotIt: 'Got it',
  },
  jp: {
    title: '復習カード',
    count: (n: number, m: number) => `${m}枚中 ${n}枚目`,
    known: (n: number, m: number) => `覚えた ${n}/${m}`,
    front: 'おもて',
    back: 'うら',
    flip: 'クリックまたはスペースキーでめくる',
    flipLabel: 'カードをめくる',
    prev: '前のカード',
    next: '次のカード',
    again: 'もう一度',
    gotIt: '覚えた',
  },
} as const;

export default function FlashcardsBlock({ block }: BlockProps<'flashcards'>) {
  const { language } = useLanguage();
  const { progress } = useReader();
  const text = copy[language];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = block.cards;
  const card = cards[Math.min(index, cards.length - 1)];
  const key = (cardId: string) => `card:${block.id}/${cardId}`;
  const knownCount = cards.filter((c) => progress.getCheck(key(c.id)) === true).length;
  const titleId = `${block.id}-title`;
  if (!card) return null;
  const status = progress.getCheck(key(card.id));

  const go = (delta: number) => {
    setFlipped(false);
    setIndex((i) => (i + delta + cards.length) % cards.length);
  };
  const mark = (known: boolean) => {
    progress.setCheck(key(card.id), known);
    if (index < cards.length - 1) go(1);
    else setFlipped(false);
  };

  return (
    <section className="rp-cards" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={titleId} className="rp-card-title m-0">{text.title}</h3>
        <span className="text-small text-fg-3 tabular">{text.count(index + 1, cards.length)}</span>
        <span className="ml-auto text-small text-fg-3 tabular" aria-live="polite">{text.known(knownCount, cards.length)}</span>
      </div>
      <button
        type="button"
        className="rp-card-face"
        aria-pressed={flipped}
        aria-label={`${text.flipLabel}: ${flipped ? text.back : text.front}`}
        data-flipped={flipped || undefined}
        data-known={status === true || undefined}
        onClick={() => setFlipped((f) => !f)}
      >
        <span className="eyebrow text-fg-3">{flipped ? text.back : text.front}</span>
        <span className="rp-card-text" aria-live="polite">
          <MdText value={flipped ? card.back : card.front} inline />
        </span>
        <span className="text-caption text-fg-3">{text.flip}</span>
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="rp-btn rp-btn-icon" aria-label={text.prev} onClick={() => go(-1)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span className="flex-1" />
        <button type="button" className="rp-btn" aria-pressed={status === false} onClick={() => mark(false)}>
          <RotateCcw size={14} aria-hidden="true" />{text.again}
        </button>
        <button type="button" className="rp-btn rp-btn-primary" aria-pressed={status === true} onClick={() => mark(true)}>
          <ThumbsUp size={14} aria-hidden="true" />{text.gotIt}
        </button>
        <span className="flex-1" />
        <button type="button" className="rp-btn rp-btn-icon" aria-label={text.next} onClick={() => go(1)}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
