import React, { useId } from 'react';
import { Button } from '../ui/Button';
import { Markdown } from '../lesson/Md';
import type { ReviewCard, ReviewRating } from '../../services/reviewApi';
import { reviewCopy } from './reviewCopy';
import { cardText, type CardText } from './reviewText';
import type { GradeBlock, SessionLine } from './reviewModel';

/**
 * One review card of the /review page (Phase 6), presentational (server/tests/phase6Front.test.js
 * renders it). The face is one button (aria-pressed; click, Enter or Space flips) with both sides
 * stacked in one grid cell, so the taller side sets the height; the hidden side is aria-hidden
 * and inert. The turn is a 3D rotation whose transition classes are all under motion-safe:, so
 * with reduced motion no transition applies and the sides swap at once. The two buttons appear
 * from the first flip on (the answer before the self-rating); while grading is blocked they are
 * aria-disabled (still focusable) and described by the reason. A Japanese-only card or lesson
 * title in the English UI keeps lang="ja", in the flip's announcement too.
 * The turning part is keyed by the card: the next card mounts unturned, so it never turns back
 * from the previous card's answer (which would show the next card's answer for a frame or two).
 * The face button, the counter and the live regions stay mounted, so focus moves and
 * announcements work as before.
 */

export type ReviewCardViewProps = {
  language: 'jp' | 'en';
  card: ReviewCard;
  counter: { k: number; total: number };
  flipped: boolean;
  /** The answer was seen (the buttons are shown). */
  revealed: boolean;
  /** The button whose grade is being sent. */
  busy: ReviewRating | null;
  /** Why grading is blocked now, or null. */
  block: GradeBlock;
  line: SessionLine;
  /** The answer announced after a flip (with its lang, as the back side), or null. */
  live: CardText | null;
  onFlip: () => void;
  onGrade: (rating: ReviewRating) => void;
  faceRef?: React.Ref<HTMLButtonElement>;
};

/** The words of a session line (null: nothing to say). */
export function lineText(line: SessionLine, language: 'jp' | 'en'): string {
  const t = reviewCopy[language];
  if (!line) return '';
  switch (line.kind) {
    case 'recorded':
      return t.recorded;
    case 'alreadyToday':
      return t.alreadyToday;
    case 'notYet':
      return t.notYet;
    case 'gone':
      return t.gone;
    case 'rateLimited':
      return t.rateLimited;
    case 'auth':
      return t.help.auth;
    case 'gradeFailed':
      return t.gradeFailed(line.button === 'again' ? t.again : t.good);
    default:
      return '';
  }
}

const TEXT = 'block wrap-anywhere text-body text-fg [&_code]:rounded-control [&_code]:bg-sunken [&_code]:px-1 [&_code]:font-mono [&_code]:text-small [&_code]:[overflow-wrap:anywhere]';
const SIDE = 'col-start-1 row-start-1 flex min-w-0 flex-col gap-2 rounded-card border border-line p-5 shadow-1 backface-hidden sm:p-6';

function Side({ label, text, back, hidden }: { label: string; text: CardText; back: boolean; hidden: boolean }) {
  return (
    <span
      className={`${SIDE} ${back ? 'rotate-y-180 bg-primary-soft' : 'bg-sunken'}`}
      aria-hidden={hidden ? 'true' : undefined}
      inert={hidden || undefined}
    >
      <span className={`text-small font-semibold ${back ? 'text-primary-text' : 'text-fg-3'}`}>{label}</span>
      <span lang={text.lang} className={TEXT}>
        <Markdown source={text.value} inline />
      </span>
    </span>
  );
}

export function ReviewCardView({
  language, card, counter, flipped, revealed, busy, block, line, live, onFlip, onGrade, faceRef,
}: ReviewCardViewProps) {
  const t = reviewCopy[language];
  const counterId = useId();
  const hintId = useId();
  const againHelpId = useId();
  const goodHelpId = useId();
  const blockId = useId();
  const title = cardText(card.lessonTitle, language, card.lessonLocale);
  const front = cardText(card.front, language, card.lessonLocale);
  const back = cardText(card.back, language, card.lessonLocale);
  const disabled = block !== null || busy !== null;
  const describedBy = (helpId: string) => [helpId, block ? blockId : null].filter(Boolean).join(' ');
  const press = (rating: ReviewRating) => {
    if (disabled) return;
    onGrade(rating);
  };
  const status = busy ? t.busy : lineText(line, language);

  return (
    <section aria-labelledby={counterId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p id={counterId} aria-live="polite" className="text-small font-semibold text-fg tabular-nums">
          {t.counter(counter.k, counter.total)}
        </p>
        <p className="text-small text-fg-2 wrap-anywhere">
          {t.from}
          <span lang={title.lang}>{title.value}</span>
        </p>
      </div>

      <button
        ref={faceRef}
        type="button"
        aria-pressed={flipped}
        aria-describedby={hintId}
        onClick={onFlip}
        className="block w-full rounded-card text-left perspective-distant"
      >
        <span
          key={`${card.courseSlug}/${card.lessonId}/${card.cardId}`}
          className={`grid transform-3d motion-safe:transition-transform motion-safe:duration-320 motion-safe:ease-rise ${flipped ? 'rotate-y-180' : ''}`}
          data-review-card-inner=""
        >
          <Side label={t.front} text={front} back={false} hidden={flipped} />
          <Side label={t.back} text={back} back hidden={!flipped} />
        </span>
      </button>
      <p id={hintId} className="text-small text-fg-3">{flipped ? t.flipBack : t.tryFirst}</p>
      <span className="sr-only" aria-live="polite">
        {live ? <>{t.answerLabel}<span lang={live.lang}>{live.value}</span></> : null}
      </span>

      {revealed ? (
        <div className="flex flex-col gap-2">
          <p className="text-body font-semibold text-fg">{t.ask}</p>
          <div className="flex flex-col gap-3 min-[360px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                className="min-h-11"
                aria-disabled={disabled || undefined}
                aria-describedby={describedBy(againHelpId)}
                onClick={() => press('again')}
              >
                {t.again}
              </Button>
              <p id={againHelpId} className="text-small text-fg-3">{t.againHelp}</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="min-h-11"
                aria-disabled={disabled || undefined}
                aria-describedby={describedBy(goodHelpId)}
                onClick={() => press('good')}
              >
                {t.good}
              </Button>
              <p id={goodHelpId} className="text-small text-fg-3">{t.goodHelp}</p>
            </div>
          </div>
          {block ? <p id={blockId} className="text-small text-fg-2">{t.help[block]}</p> : null}
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="min-h-6 text-small text-fg-2">{status}</p>
    </section>
  );
}

export default ReviewCardView;
