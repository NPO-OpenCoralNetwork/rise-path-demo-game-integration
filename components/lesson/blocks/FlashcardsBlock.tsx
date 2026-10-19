import React, { useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, RotateCcw, ThumbsUp } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText } from '../Md';
import { useReader } from '../ReaderContext';
import { plainText } from '../model';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * Review cards: a card that flips (button with aria-pressed; Space / Enter / click), ← → move
 * between cards while focus is in the block, and "again" / "got it" are saved with the lesson
 * progress (checks `card:<block>/<card>`, true = known). A dot per card shows its state and
 * jumps to it. After the last card a summary offers to review only the "again" cards.
 */

const copy = {
  en: {
    title: 'Review cards',
    count: (n: number, m: number) => `Card ${n} of ${m}`,
    known: (n: number, m: number) => `${n}/${m} known`,
    front: 'Question',
    back: 'Answer',
    flip: 'Click or press Space to flip',
    flipBack: 'Click or press Space to flip back',
    backLive: (text: string) => `Answer: ${text}`,
    prev: 'Previous card',
    next: 'Next card',
    again: 'Again',
    gotIt: 'Got it',
    dots: 'Cards',
    dot: (n: number, state: string) => `Card ${n}${state ? `, ${state}` : ''}`,
    stateKnown: 'known',
    stateAgain: 'review again',
    knownBadge: 'Known',
    doneTitle: 'Deck finished',
    doneBody: (known: number, total: number) => `You marked ${known} of ${total} cards as known.`,
    doneAll: 'Every card is marked as known. Nice work!',
    reviewAgain: (n: number) => `Review the ${n} “again” card${n === 1 ? '' : 's'}`,
    restart: 'Start over',
    keys: '← → move · Space flips',
  },
  jp: {
    title: '復習カード',
    count: (n: number, m: number) => `${m}枚中 ${n}枚目`,
    known: (n: number, m: number) => `覚えた ${n}/${m}`,
    front: 'おもて',
    back: 'うら',
    flip: 'クリックまたはスペースキーでめくる',
    flipBack: 'クリックまたはスペースキーでおもてに戻す',
    backLive: (text: string) => `うら：${text}`,
    prev: '前のカード',
    next: '次のカード',
    again: 'もう一度',
    gotIt: '覚えた',
    dots: 'カード一覧',
    dot: (n: number, state: string) => `${n}枚目${state ? `（${state}）` : ''}`,
    stateKnown: '覚えた',
    stateAgain: 'もう一度',
    knownBadge: '覚えた',
    doneTitle: 'ひと通り終わりました',
    doneBody: (known: number, total: number) => `${total}枚中 ${known}枚を「覚えた」にしました。`,
    doneAll: 'すべてのカードを覚えました。おつかれさまでした！',
    reviewAgain: (n: number) => `「もう一度」の ${n}枚だけ復習する`,
    restart: '最初から',
    keys: '← → で移動 · スペースでめくる',
  },
} as const;

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

export default function FlashcardsBlock({ block }: BlockProps<'flashcards'>) {
  const { language } = useLanguage();
  const { progress, t } = useReader();
  const text = copy[language];
  const cards = block.cards;
  const allIndexes = useMemo(() => cards.map((_, i) => i), [cards]);
  const [order, setOrder] = useState<number[]>(allIndexes);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);
  const [live, setLive] = useState('');
  const faceRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const titleId = `${block.id}-title`;

  const key = (cardId: string) => `card:${block.id}/${cardId}`;
  const statusOf = (cardId: string) => progress.getCheck(key(cardId));
  const knownCount = cards.filter((c) => statusOf(c.id) === true).length;
  const againIndexes = allIndexes.filter((i) => statusOf(cards[i].id) === false);

  const safeOrder = order.length ? order : allIndexes;
  const cardIndex = safeOrder[Math.min(pos, safeOrder.length - 1)] ?? 0;
  const card = cards[cardIndex];
  if (!card) return null;
  const status = statusOf(card.id);

  const show = (nextPos: number, nextOrder = safeOrder) => {
    setFlipped(false);
    setFinished(false);
    setLive('');
    setPos((nextPos + nextOrder.length) % nextOrder.length);
  };
  const flip = () => {
    const next = !flipped;
    setFlipped(next);
    setLive(next ? text.backLive(plainText(t(card.back))) : '');
  };
  const mark = (known: boolean) => {
    progress.setCheck(key(card.id), known);
    if (pos < safeOrder.length - 1) show(pos + 1);
    else {
      setFlipped(false);
      setFinished(true);
      // The marking button unmounts with the card: move focus to the summary, not <body>.
      window.requestAnimationFrame(() => doneRef.current?.focus());
    }
  };
  const restart = (indexes: number[]) => {
    setOrder(indexes);
    show(0, indexes);
    window.requestAnimationFrame(() => faceRef.current?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      show(pos + (event.key === 'ArrowRight' ? 1 : -1));
    }
  };

  const stateLabel = (s: boolean | undefined) => (s === true ? text.stateKnown : s === false ? text.stateAgain : '');

  return (
    <div role="group" className="rp-cards" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="rp-cards-head">
        <h3 id={titleId} className="rp-card-title m-0">{text.title}</h3>
        <span className="text-small text-fg-3 tabular">{text.count(pos + 1, safeOrder.length)}</span>
        <span className="rp-cards-known tabular" aria-live="polite">
          <Check size={14} aria-hidden="true" />
          {text.known(knownCount, cards.length)}
        </span>
      </div>

      <ol className="rp-card-dots" aria-label={text.dots}>
        {cards.map((c, i) => {
          const s = statusOf(c.id);
          const current = i === cardIndex && !finished;
          return (
            <li key={c.id}>
              <button
                type="button"
                className="rp-card-dot"
                data-state={s === true ? 'known' : s === false ? 'again' : undefined}
                aria-current={current ? 'true' : undefined}
                aria-label={text.dot(i + 1, stateLabel(s))}
                onClick={() => {
                  setOrder(allIndexes);
                  show(i, allIndexes);
                }}
              />
            </li>
          );
        })}
      </ol>

      {finished ? (
        <div className="rp-cards-done" role="status">
          <p ref={doneRef} tabIndex={-1} className="rp-cards-done-title">
            <Check size={18} aria-hidden="true" />{text.doneTitle}
          </p>
          <p className="rp-cards-done-body">
            {againIndexes.length ? text.doneBody(knownCount, cards.length) : text.doneAll}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {againIndexes.length > 0 && (
              <button type="button" className="rp-btn rp-btn-primary" onClick={() => restart(againIndexes)}>
                <RotateCcw size={14} aria-hidden="true" />{text.reviewAgain(againIndexes.length)}
              </button>
            )}
            <button type="button" className="rp-btn" onClick={() => restart(allIndexes)}>{text.restart}</button>
          </div>
        </div>
      ) : (
        <>
          <button
            ref={faceRef}
            type="button"
            className="rp-card-face"
            aria-pressed={flipped}
            data-flipped={flipped || undefined}
            data-known={status === true || undefined}
            onClick={flip}
          >
            <span className="rp-card-inner">
              <span className="rp-card-side rp-card-front" aria-hidden={flipped || undefined}>
                <span className="eyebrow text-fg-3">{text.front}</span>
                <span className="rp-card-text"><MdText value={card.front} inline /></span>
                <span className="rp-card-hint">{text.flip}</span>
              </span>
              <span className="rp-card-side rp-card-back" aria-hidden={!flipped || undefined}>
                <span className="eyebrow text-primary-text">{text.back}</span>
                <span className="rp-card-text"><MdText value={card.back} inline /></span>
                <span className="rp-card-hint">{text.flipBack}</span>
              </span>
            </span>
            {status === true && (
              <span className="rp-card-badge"><Check size={12} aria-hidden="true" />{text.knownBadge}</span>
            )}
          </button>
          <span className="sr-only" aria-live="polite">{live}</span>
          <div className="rp-cards-controls">
            <button type="button" className="rp-btn rp-btn-icon" aria-label={text.prev} title={text.prev} onClick={() => show(pos - 1)}>
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
            <button type="button" className="rp-btn rp-btn-icon" aria-label={text.next} title={text.next} onClick={() => show(pos + 1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="rp-cards-keys" aria-hidden="true">{text.keys}</p>
        </>
      )}
    </div>
  );
}
