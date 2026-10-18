import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Flag, Layers, ListChecks, PartyPopper } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useReader } from './ReaderContext';
import { MdText } from './Md';
import { allBlocks, isAnswered, isQuiz } from './model';
import type { SelfRating } from './progressStore';
import type { LText } from '../../shared/lesson/schema.js';

/**
 * End of every lesson, rendered by the reader (not authored): self-assessment against each
 * objective, what was practised, and the next lesson. The authored summary block stays in its
 * own section above.
 */

const copy = {
  en: {
    title: 'Wrap-up',
    ask: 'How confident are you with each goal?',
    askLesson: 'How well could you explain this lesson to someone?',
    lessonGoal: 'This lesson',
    ratings: { 1: 'Not sure yet', 2: 'Mostly OK', 3: 'I can explain it' } as Record<SelfRating, string>,
    saved: 'Saved. Come back to the parts marked "not sure yet" later.',
    progress: (pct: number) => `${pct}% done`,
    checks: (n: number, m: number) => `Checks answered: ${n}/${m}`,
    cards: (n: number, m: number) => `Review cards known: ${n}/${m}`,
    goToCards: 'Go to the review cards',
    next: 'Next lesson',
    minutes: (min: number) => `${min} min`,
    continue: 'Continue',
    prev: 'Previous lesson: ',
    doneTitle: 'You finished the last lesson of this course.',
    backToCourse: 'Back to the course',
  },
  jp: {
    title: 'ふりかえり',
    ask: 'それぞれの目標、どのくらい自信がありますか？',
    askLesson: 'このレッスンの内容を、人に説明できそうですか？',
    lessonGoal: 'このレッスン',
    ratings: { 1: 'まだ不安', 2: 'だいたいOK', 3: '説明できる' } as Record<SelfRating, string>,
    saved: '記録しました。「まだ不安」の目標は、あとで読み返しましょう。',
    progress: (pct: number) => `${pct}% 完了`,
    checks: (n: number, m: number) => `確認問題 ${n}/${m} 回答`,
    cards: (n: number, m: number) => `復習カード 覚えた ${n}/${m}`,
    goToCards: '復習カードへ移動',
    next: '次のレッスン',
    minutes: (min: number) => `${min}分`,
    continue: '続ける',
    prev: '前のレッスン：',
    doneTitle: 'このコースの最後のレッスンまで読み終えました。',
    backToCourse: 'コースに戻る',
  },
} as const;

export type LessonLinkInfo = { title: string; href: string; minutes?: number; lang?: string };

type LessonEndProps = {
  next: LessonLinkInfo | null;
  prev: LessonLinkInfo | null;
  backTo: string;
};

function RatingRow({ id, label, value, onChange }: {
  id: string;
  label: LText | string;
  value: SelfRating | undefined;
  onChange: (rating: SelfRating) => void;
}) {
  const { language } = useLanguage();
  const text = copy[language];
  const uid = useId();
  const labelId = `${uid}-label`;
  return (
    <li className="rp-rate-row">
      <div id={labelId} className="rp-rate-goal">
        {typeof label === 'string' ? label : <MdText value={label} inline />}
      </div>
      <div className="rp-rate-options" role="radiogroup" aria-labelledby={labelId}>
        {([1, 2, 3] as SelfRating[]).map((rating) => {
          const inputId = `${uid}-${rating}`;
          return (
            <label key={rating} htmlFor={inputId} className="rp-rate" data-checked={value === rating || undefined} data-rating={rating}>
              <input
                id={inputId}
                type="radio"
                name={`${uid}-${id}`}
                className="sr-only"
                checked={value === rating}
                onChange={() => onChange(rating)}
              />
              {text.ratings[rating]}
            </label>
          );
        })}
      </div>
    </li>
  );
}

export function LessonEnd({ next, prev, backTo }: LessonEndProps) {
  const { language } = useLanguage();
  const { lesson, progress, scrollToBlock } = useReader();
  const text = copy[language];
  const titleId = `${lesson.id}-end-title`;
  const ratings = progress.progress.ratings ?? {};
  const rated = Object.keys(ratings).length > 0;

  const blocks = allBlocks(lesson);
  const questions = blocks.filter(isQuiz).filter((b) => b.mode !== 'predict')
    .flatMap((b) => b.questions.map((q) => ({ block: b, question: q })));
  const answered = questions.filter(({ block, question }) => isAnswered(progress.progress, block.id, question.id)).length;
  const cardBlocks = blocks.filter((b): b is Extract<typeof b, { type: 'flashcards' }> => b.type === 'flashcards');
  const cards = cardBlocks.flatMap((b) => b.cards.map((c) => `card:${b.id}/${c.id}`));
  const known = cards.filter((key) => progress.getCheck(key) === true).length;

  return (
    <footer className="rp-end">
      <section className="rp-end-card" aria-labelledby={titleId}>
        <h2 id={titleId} className="rp-end-title">
          <Flag size={18} aria-hidden="true" />
          {text.title}
        </h2>
        <p className="rp-end-ask">{lesson.objectives.length ? text.ask : text.askLesson}</p>
        <ul className="rp-rate-list">
          {lesson.objectives.length > 0
            ? lesson.objectives.map((objective) => (
              <RatingRow
                key={objective.id}
                id={objective.id}
                label={objective.text}
                value={ratings[objective.id]}
                onChange={(rating) => progress.setRating(objective.id, rating)}
              />
            ))
            : (
              <RatingRow
                id="lesson"
                label={text.lessonGoal}
                value={ratings.lesson}
                onChange={(rating) => progress.setRating('lesson', rating)}
              />
            )}
        </ul>
        <p role="status" aria-live="polite" className="rp-end-saved">{rated ? text.saved : ''}</p>
        <ul className="rp-end-stats">
          <li className="tabular">{text.progress(progress.pct)}</li>
          {questions.length > 0 && (
            <li className="tabular"><ListChecks size={14} aria-hidden="true" />{text.checks(answered, questions.length)}</li>
          )}
          {cards.length > 0 && (
            <li>
              <button type="button" className="rp-link-btn tabular" onClick={() => scrollToBlock(cardBlocks[0].id)}>
                <Layers size={14} aria-hidden="true" />{text.cards(known, cards.length)}
                <span className="sr-only"> · {text.goToCards}</span>
              </button>
            </li>
          )}
        </ul>
      </section>

      {next ? (
        <Link to={next.href} className="rp-next-card">
          <span className="min-w-0 flex-1">
            <span className="rp-next-label">
              {text.next}
              {next.minutes ? <span className="tabular"> · {text.minutes(next.minutes)}</span> : null}
            </span>
            <span className="rp-next-title" lang={next.lang}>{next.title}</span>
          </span>
          <span className="rp-next-go" aria-hidden="true">
            {text.continue}
            <ArrowRight size={16} />
          </span>
        </Link>
      ) : (
        <Link to={backTo} className="rp-next-card">
          <PartyPopper size={22} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="rp-next-title">{text.doneTitle}</span>
          </span>
          <span className="rp-next-go" aria-hidden="true">
            {text.backToCourse}
            <ArrowRight size={16} />
          </span>
        </Link>
      )}

      {prev && (
        <Link to={prev.href} className="rp-prev-link">
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="shrink-0">{text.prev}</span>
          <span lang={prev.lang} className="min-w-0 truncate">{prev.title}</span>
        </Link>
      )}
    </footer>
  );
}
