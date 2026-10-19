import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, CircleHelp, Lightbulb, Sparkles, Target, X } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { plainText } from '../model';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * Retrieval practice inside the reading flow.
 * - inline (確認しよう): answer → if wrong, feedback for the picked option + hint + retry; the
 *   second miss (or "show answer") reveals the answer with a neutral explanation.
 * - predict (予想してみよう): ungraded; the pick is recorded and the explanation shown.
 * - exam (理解度チェック): every question in one card, with a first-try score.
 * Native radios/checkboxes (arrow keys), 1–9 select options and Enter submits while focus is
 * inside the question (never globally, so screen-reader keys are untouched), feedback is
 * announced via aria-live and focus moves to it (the options lock after a submit), retry puts
 * focus back on the first option. Answers are saved with the lesson progress; "Ask why" opens
 * the tutor in Socratic mode with the attempt count and the picked option.
 */

type QuizBlock = BlockProps<'quiz'>['block'];
type Question = QuizBlock['questions'][number];

const copy = {
  en: {
    inline: 'Check your understanding',
    predict: 'Make a prediction',
    exam: 'Knowledge check',
    predictHint: 'No score: just commit to a guess before you read on.',
    question: (n: number, m: number) => `Question ${n} of ${m}`,
    submit: 'Check answer',
    submitPredict: 'Lock in my guess',
    selectFirst: 'Pick an answer first.',
    correct: 'Correct!',
    almost: 'Not quite.',
    answerIs: 'Answer: ',
    explanation: 'Why',
    predicted: 'Guess saved. Here is what actually happens:',
    yourPick: 'Your answer',
    yourGuess: 'Your guess',
    correctTag: 'Correct answer',
    hint: 'Show a hint',
    retry: 'Try again',
    reveal: 'Show the answer',
    askWhy: 'Ask the AI tutor why',
    askWhyMessage: 'I picked a wrong answer on this check. Help me see why, without giving the answer away.',
    score: (n: number, m: number) => `Right on the first try: ${n} of ${m}`,
    keys: (n: number) => `Tip: press 1–${n} to pick, Enter to check.`,
  },
  jp: {
    inline: '確認しよう',
    predict: '予想してみよう',
    exam: '理解度チェック',
    predictHint: '採点はありません。読み進める前に、自分の予想を決めてみましょう。',
    question: (n: number, m: number) => `${m}問中 ${n}問目`,
    submit: '答える',
    submitPredict: 'この予想で決定',
    selectFirst: '先に選択肢を選んでください。',
    correct: '正解です！',
    almost: 'おしい！',
    answerIs: '答え：',
    explanation: '解説',
    predicted: '予想を記録しました。実際はこうなります：',
    yourPick: 'あなたの答え',
    yourGuess: 'あなたの予想',
    correctTag: '正解',
    hint: 'ヒントを見る',
    retry: 'もう一度答える',
    reveal: '答えを見る',
    askWhy: 'なぜ？をAI先生に聞く',
    askWhyMessage: 'この確認問題で間違えました。答えは言わずに、考え方のヒントをください。',
    score: (n: number, m: number) => `1回目で正解：${m}問中 ${n}問`,
    keys: (n: number) => `1〜${n}キーで選択、Enterで回答できます。`,
  },
} as const;

type Phase = 'answering' | 'wrong' | 'correct' | 'revealed' | 'predicted';

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

function QuestionView({
  block,
  question,
  index,
  count,
  sectionId,
}: {
  block: QuizBlock;
  question: Question;
  index: number;
  count: number;
  sectionId: string;
}) {
  const { language } = useLanguage();
  const reader = useReader();
  const { progress, askTutor, t } = reader;
  const text = copy[language];
  const record = progress.getAnswer(block.id, question.id);
  const kind = question.kind ?? 'single';
  const multi = kind === 'multi';
  const predict = block.mode === 'predict';
  const [selected, setSelected] = useState<string[]>(() => record?.chosen ?? []);
  const [retrying, setRetrying] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const uid = useId();
  const promptId = `${uid}-prompt`;
  const formRef = useRef<HTMLFormElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  // Where focus goes after the next render: the feedback panel (options just locked) or the
  // first option (retry).
  const [focusTo, setFocusTo] = useState<'feedback' | 'options' | null>(null);

  let phase: Phase = 'answering';
  if (record && (record.attempts > 0 || record.revealed)) {
    if (predict) phase = 'predicted';
    else if (record.correct) phase = 'correct';
    else if (record.revealed || record.attempts >= 2) phase = 'revealed';
    else phase = retrying ? 'answering' : 'wrong';
  }
  const locked = phase !== 'answering';
  const chosen = phase === 'answering' ? selected : record?.chosen ?? [];
  const showAnswer = phase === 'correct' || phase === 'revealed' || phase === 'predicted';

  const toggle = (optionId: string) => {
    if (locked) return;
    setNudge(false);
    setSelected((prev) => {
      if (!multi) return [optionId];
      return prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId];
    });
  };

  const submit = () => {
    if (locked) return;
    if (!selected.length) {
      setNudge(true);
      return;
    }
    const correct = sameSet(selected, question.answer);
    const attempts = (record?.attempts ?? 0) + 1;
    progress.recordAnswer(block.id, question.id, {
      chosen: selected,
      correct,
      revealed: !predict && !correct && attempts >= 2,
    });
    setRetrying(false);
    setHintOpen(false);
    setFocusTo('feedback');
  };

  useEffect(() => {
    if (!focusTo) return;
    if (focusTo === 'feedback') {
      feedbackRef.current?.querySelector<HTMLElement>('.rp-feedback')?.focus({ preventScroll: false });
    } else {
      formRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    }
    setFocusTo(null);
  }, [focusTo]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text')) return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= question.options.length && !locked) {
      event.preventDefault();
      const option = question.options[n - 1];
      toggle(option.id);
      const input = event.currentTarget.querySelector<HTMLInputElement>(`input[value="${option.id}"]`);
      input?.focus();
    } else if (event.key === 'Enter' && target.tagName === 'INPUT' && !locked) {
      event.preventDefault();
      submit();
    }
  };

  const optionState = (optionId: string): 'correct' | 'wrong' | 'answer' | 'guess' | null => {
    const isAnswer = question.answer.includes(optionId);
    const picked = chosen.includes(optionId);
    if (phase === 'predicted') return picked ? 'guess' : isAnswer ? 'answer' : null;
    if (phase === 'wrong') return picked ? 'wrong' : null;
    if (phase === 'correct') return picked ? 'correct' : null;
    if (phase === 'revealed') return isAnswer ? 'answer' : picked ? 'wrong' : null;
    return null;
  };

  const pickedFeedback = question.options
    .filter((o) => chosen.includes(o.id) && o.feedback && (phase !== 'correct' || multi))
    .filter((o) => phase !== 'wrong' || !question.answer.includes(o.id));
  const answerOptions = question.options.filter((o) => question.answer.includes(o.id));

  return (
    <form
      ref={formRef}
      className="rp-question"
      data-kind={kind}
      // Unnamed on purpose: a named form is a landmark, and the fieldset legend names the group.
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={onKeyDown}
    >
      {count > 1 && <p className="rp-question-count">{text.question(index + 1, count)}</p>}
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend id={promptId} className="rp-question-prompt">
          <MdText value={question.prompt} inline />
        </legend>
        <div className="rp-options" role={multi ? 'group' : 'radiogroup'} aria-labelledby={promptId}>
          {question.options.map((option, oi) => {
            const state = optionState(option.id);
            const inputId = `${uid}-${option.id}`;
            const isPicked = chosen.includes(option.id);
            return (
              <label
                key={option.id}
                htmlFor={inputId}
                className="rp-option"
                data-picked={isPicked || undefined}
                data-state={state ?? undefined}
                data-locked={locked || undefined}
              >
                <input
                  id={inputId}
                  type={multi ? 'checkbox' : 'radio'}
                  name={`${uid}-q`}
                  value={option.id}
                  checked={isPicked}
                  disabled={locked}
                  onChange={() => toggle(option.id)}
                  className="sr-only"
                />
                <span className="rp-option-key" aria-hidden="true">{oi + 1}</span>
                <span className="min-w-0 flex-1"><MdText value={option.md} inline /></span>
                {state === 'correct' && <span className="rp-option-tag rp-tag-success"><Check size={14} aria-hidden="true" />{text.correctTag}</span>}
                {state === 'answer' && <span className="rp-option-tag rp-tag-neutral"><Check size={14} aria-hidden="true" />{text.correctTag}</span>}
                {state === 'wrong' && <span className="rp-option-tag rp-tag-danger"><X size={14} aria-hidden="true" />{text.yourPick}</span>}
                {state === 'guess' && <span className="rp-option-tag rp-tag-neutral"><Target size={14} aria-hidden="true" />{text.yourGuess}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      {phase === 'answering' && (
        <div className="rp-question-actions">
          <button type="submit" className="rp-btn rp-btn-primary">
            {predict ? text.submitPredict : text.submit}
          </button>
          {nudge ? <span className="text-small text-danger">{text.selectFirst}</span> : (
            <span className="rp-key-tip text-small text-fg-3">{text.keys(Math.min(9, question.options.length))}</span>
          )}
        </div>
      )}

      <div ref={feedbackRef} role="status" aria-live="polite" className="rp-feedback-live">
        {phase === 'wrong' && (
          <div className="rp-feedback rp-feedback-wrong" tabIndex={-1}>
            <p className="rp-feedback-title"><X size={16} aria-hidden="true" />{text.almost}</p>
            {pickedFeedback.map((o) => <MdText key={o.id} value={o.feedback} className="rp-feedback-body" />)}
            {hintOpen && question.hint && (
              <div className="rp-feedback-hint">
                <Lightbulb size={16} aria-hidden="true" className="shrink-0" />
                <MdText value={question.hint} />
              </div>
            )}
            <div className="rp-feedback-actions">
              {question.hint && !hintOpen && (
                <button type="button" className="rp-btn" onClick={() => setHintOpen(true)}>
                  <Lightbulb size={14} aria-hidden="true" />{text.hint}
                </button>
              )}
              <button
                type="button"
                className="rp-btn"
                onClick={() => askTutor({
                  message: text.askWhyMessage,
                  block,
                  section: reader.lesson.sections.find((s) => s.id === sectionId),
                  // "(1) [a] …": the number on screen plus the option id, so the tutor can match
                  // learner.chosenOptionId. ("1. " would be stripped as a list marker.)
                  excerpt: plainText(`${t(question.prompt)} ${question.options.map((o, i) => `(${i + 1}) [${o.id}] ${t(o.md)}`).join(' ')}`),
                  mode: 'socratic',
                  learner: { attemptsOnBlock: record?.attempts ?? 1, chosenOptionId: record?.chosen[0] },
                })}
              >
                <Sparkles size={14} aria-hidden="true" />{text.askWhy}
              </button>
              <button
                type="button"
                className="rp-btn"
                onClick={() => {
                  progress.revealAnswer(block.id, question.id);
                  setFocusTo('feedback');
                }}
              >
                {text.reveal}
              </button>
              <button
                type="button"
                className="rp-btn rp-btn-primary"
                onClick={() => {
                  setSelected([]);
                  setRetrying(true);
                  setHintOpen(false);
                  setFocusTo('options');
                }}
              >
                {text.retry}
              </button>
            </div>
          </div>
        )}

        {showAnswer && (
          <div className={`rp-feedback ${phase === 'correct' ? 'rp-feedback-correct' : 'rp-feedback-neutral'}`} tabIndex={-1}>
            <p className="rp-feedback-title">
              {phase === 'correct' && <><Check size={16} aria-hidden="true" />{text.correct}</>}
              {phase === 'revealed' && <><CircleHelp size={16} aria-hidden="true" />{text.answerIs}{answerOptions.map((o, i) => (
                <React.Fragment key={o.id}>{i > 0 && ' / '}<MdText value={o.md} inline /></React.Fragment>
              ))}</>}
              {phase === 'predicted' && <><Target size={16} aria-hidden="true" />{text.predicted}</>}
            </p>
            {phase === 'predicted' && pickedFeedback.map((o) => <MdText key={o.id} value={o.feedback} className="rp-feedback-body" />)}
            <MdText value={question.explanation} className="rp-feedback-body" />
          </div>
        )}
      </div>
    </form>
  );
}

export default function QuizCheckBlock({ block, section }: BlockProps<'quiz'>) {
  const { language } = useLanguage();
  const { checks, progress } = useReader();
  const text = copy[language];
  const labelId = `${block.id}-label`;
  const number = checks.numbers.get(block.id);
  const label = block.mode === 'predict' ? text.predict : block.mode === 'exam' ? text.exam : text.inline;
  const firstTry = block.questions.filter((q) => progress.getAnswer(block.id, q.id)?.firstTry).length;
  const answered = block.questions.filter((q) => (progress.getAnswer(block.id, q.id)?.attempts ?? 0) > 0).length;

  return (
    <div role="group" className={`rp-quiz rp-quiz-${block.mode}`} aria-labelledby={labelId}>
      <p id={labelId} className="rp-quiz-label">
        {block.mode === 'predict' ? <Target size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}
        <span>{block.title ? <Txt value={block.title} /> : label}</span>
        {number && checks.total > 1 && <span className="tabular text-fg-3">· {number}/{checks.total}</span>}
      </p>
      {block.mode === 'predict' && <p className="rp-quiz-note">{text.predictHint}</p>}
      {block.questions.map((question, i) => (
        <QuestionView
          key={question.id}
          block={block}
          question={question}
          index={i}
          count={block.questions.length}
          sectionId={section.id}
        />
      ))}
      {block.mode === 'exam' && answered === block.questions.length && (
        <p className="rp-quiz-score" role="status">{text.score(firstTry, block.questions.length)}</p>
      )}
    </div>
  );
}
