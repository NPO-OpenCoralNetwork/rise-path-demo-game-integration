// Quiz grading shared by the web reader and the server (shared/lesson/grading.js): choice
// checks, the reader's attempt rules (lock, reveal, predict), and the feedback a learner may see
// after each outcome, checked over every published question.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_GRADED_ATTEMPTS,
  applyReveal,
  applySubmission,
  isCorrectChoice,
  normalizeChoice,
  quizFeedback,
} from '../../shared/lesson/grading.js';
import { availableLocales } from '../../shared/lesson/learnerView.js';
import { resolveText } from '../../shared/lesson/text.js';
import { answerKey, emptyProgress, withAnswer } from '../../components/lesson/progressStore.ts';
import { ROOT, publishedQuestions } from './helpers/publishedLessons.js';

const single = {
  id: 'q1',
  kind: 'single',
  prompt: 'Which?',
  options: [
    { id: 'a', md: 'A', feedback: 'Not A.' },
    { id: 'b', md: 'B' },
    { id: 'c', md: 'C', feedback: 'Not C.' },
  ],
  answer: ['b'],
  explanation: 'B because.',
  hint: 'Think of B.',
};
const multi = {
  id: 'q2',
  kind: 'multi',
  prompt: 'Which ones?',
  options: [{ id: 'a', md: 'A' }, { id: 'b', md: 'B', feedback: 'Not B.' }, { id: 'c', md: 'C' }],
  answer: ['a', 'c'],
  explanation: 'A and C.',
};

const QUESTIONS = publishedQuestions();

describe('normalizeChoice', () => {
  it('dedupes and accepts exactly one option for single and truefalse questions', () => {
    assert.deepEqual(normalizeChoice(single, ['b']), { ok: true, ids: ['b'] });
    assert.deepEqual(normalizeChoice(single, ['b', 'b']), { ok: true, ids: ['b'] });
    assert.deepEqual(normalizeChoice({ ...single, kind: 'truefalse' }, ['a']), { ok: true, ids: ['a'] });
    assert.deepEqual(normalizeChoice({ ...single, kind: undefined }, ['c']), { ok: true, ids: ['c'] });
    for (const bad of [[], ['a', 'b'], ['zz'], [1], 'b', null, undefined, [['b']]]) {
      assert.deepEqual(normalizeChoice(single, bad), { ok: false, reason: 'invalid_choice' }, JSON.stringify(bad));
    }
  });

  it('accepts one or more options for multi questions, and only option ids', () => {
    assert.deepEqual(normalizeChoice(multi, ['c', 'a', 'c']), { ok: true, ids: ['c', 'a'] });
    assert.deepEqual(normalizeChoice(multi, ['b']), { ok: true, ids: ['b'] });
    assert.equal(normalizeChoice(multi, []).ok, false);
    assert.equal(normalizeChoice(multi, ['a', 'x']).ok, false);
  });
});

describe('isCorrectChoice', () => {
  it('compares sets: order and duplicates do not matter', () => {
    assert.equal(isCorrectChoice(multi, ['c', 'a']), true);
    assert.equal(isCorrectChoice(multi, ['a', 'c', 'a']), true);
    assert.equal(isCorrectChoice(multi, ['a']), false);
    assert.equal(isCorrectChoice(multi, ['a', 'b', 'c']), false);
    assert.equal(isCorrectChoice(single, ['b']), true);
    assert.equal(isCorrectChoice(single, []), false);
  });

  it('does not take a duplicated pick for a different answer (the old sameSet bug)', () => {
    assert.equal(isCorrectChoice(multi, ['a', 'a']), false);
  });

  it('is what the reader grades with', () => {
    const source = fs.readFileSync(path.join(ROOT, 'components/lesson/blocks/QuizCheckBlock.tsx'), 'utf8');
    assert.match(source, /import \{ isCorrectChoice \} from '\.\.\/\.\.\/\.\.\/shared\/lesson\/grading\.js';/);
    assert.match(source, /const correct = isCorrectChoice\(question, selected\);/);
    assert.doesNotMatch(source, /sameSet/);
  });
});

describe('applySubmission (the reader attempt rules)', () => {
  const submit = (record, correct, chosen, mode = 'inline') => applySubmission(record, { correct, chosen, mode });

  it('records a first-try correct answer and then locks the question', () => {
    const first = submit(undefined, true, ['b']);
    assert.equal(first.outcome, 'correct');
    assert.deepEqual(first.record, { attempts: 1, correct: true, chosen: ['b'], firstTry: true });
    const again = submit(first.record, false, ['a']);
    assert.equal(again.outcome, 'locked');
    assert.equal(again.record, first.record, 'a locked question keeps its record');
  });

  it('allows a retry after a miss; firstTry stays false', () => {
    const miss = submit(undefined, false, ['a'], 'exam');
    assert.equal(miss.outcome, 'incorrect');
    assert.deepEqual(miss.record, { attempts: 1, correct: false, chosen: ['a'], firstTry: false });
    const fixed = submit(miss.record, true, ['b'], 'exam');
    assert.equal(fixed.outcome, 'correct');
    assert.deepEqual(fixed.record, { attempts: 2, correct: true, chosen: ['b'], firstTry: false });
  });

  it('reveals the answer on the second miss and locks it', () => {
    const miss = submit(undefined, false, ['a']);
    const second = submit(miss.record, false, ['c']);
    assert.equal(MAX_GRADED_ATTEMPTS, 2);
    assert.equal(second.outcome, 'revealed');
    assert.deepEqual(second.record, { attempts: 2, correct: false, chosen: ['c'], firstTry: false, revealed: true });
    assert.equal(submit(second.record, true, ['b']).outcome, 'locked');
  });

  it('takes one ungraded prediction, keeps its real correctness, then locks', () => {
    const guess = submit(undefined, false, ['a'], 'predict');
    assert.equal(guess.outcome, 'predicted');
    assert.deepEqual(guess.record, { attempts: 1, correct: false, chosen: ['a'], firstTry: false });
    assert.equal(submit(guess.record, true, ['b'], 'predict').outcome, 'locked');
  });

  it('treats an attempts-0 record without a reveal as no record', () => {
    const stale = { attempts: 0, correct: false, chosen: [], firstTry: false };
    assert.deepEqual(submit(stale, true, ['b']).record, { attempts: 1, correct: true, chosen: ['b'], firstTry: true });
  });

  it('locks a graded question revealed before any attempt (web "show answer" record)', () => {
    const shown = { attempts: 0, correct: false, chosen: [], firstTry: false, revealed: true };
    assert.equal(submit(shown, true, ['b']).outcome, 'locked');
  });

  it('locks exactly what the reader locks, for any stored record (synced or old shapes too)', () => {
    // QuizCheckBlock's phase, with "retry" pressed: anything but 'answering' is locked, and the
    // reader shows the answer in every locked phase.
    const readerLocked = (record, predict) => {
      if (!record || !(record.attempts > 0 || record.revealed)) return false;
      return predict || record.correct || Boolean(record.revealed) || record.attempts >= 2;
    };
    let checked = 0;
    for (const mode of ['inline', 'exam', 'predict']) {
      for (const attempts of [0, 1, 2, 3]) {
        for (const correct of [false, true]) {
          for (const revealed of [false, true]) {
            const stored = { attempts, correct, chosen: attempts ? ['a'] : [], firstTry: false, ...(revealed ? { revealed: true } : {}) };
            const locked = readerLocked(stored, mode === 'predict');
            const result = applySubmission(stored, { correct: true, chosen: ['b'], mode });
            assert.equal(result.outcome === 'locked', locked, `${mode} ${JSON.stringify(stored)}`);
            if (locked) {
              assert.equal(result.record, stored);
              const fb = quizFeedback(single, stored, 'locked', { mode, locale: 'jp', chosen: ['b'] });
              assert.equal(fb.explanation, 'B because.');
              if (mode !== 'predict') assert.equal(fb.attempts_left, 0, `${mode} ${JSON.stringify(stored)}`);
            }
            checked += 1;
          }
        }
      }
    }
    assert.equal(checked, 48);
  });

  it('matches the web reader for every published question (withAnswer + QuizCheckBlock rules)', () => {
    // The reader: a question is open while it has no record, or it is graded, wrong and not
    // revealed with fewer than 2 attempts; a submission sets revealed on the second graded miss.
    const readerOpen = (record, predict) => !record || (record.attempts === 0 && !record.revealed)
      || (!predict && !record.correct && !record.revealed && record.attempts < 2);
    let compared = 0;
    for (const { block, question } of QUESTIONS) {
      const predict = block.mode === 'predict';
      const wrong = question.options.filter((o) => !question.answer.includes(o.id)).map((o) => [o.id]);
      const right = [...question.answer];
      for (const sequence of [[wrong[0], wrong[1] ?? wrong[0], right], [wrong[0], right, wrong[0]], [right, wrong[0]]]) {
        const key = answerKey(block.id, question.id);
        let reader = emptyProgress();
        let shared;
        for (const chosen of sequence) {
          const correct = isCorrectChoice(question, chosen);
          const prev = reader.answers[key];
          if (readerOpen(prev, predict)) {
            const attempts = (prev?.attempts ?? 0) + 1;
            reader = withAnswer(reader, key, { chosen, correct, revealed: !predict && !correct && attempts >= 2 });
          }
          shared = applySubmission(shared?.record, { correct, chosen, mode: block.mode });
          assert.equal(shared.outcome === 'locked', !readerOpen(prev, predict), `${question.id}: lock`);
          assert.deepEqual(shared.record, reader.answers[key], `${block.id}/${question.id} after ${JSON.stringify(chosen)}`);
          compared += 1;
        }
      }
    }
    assert.ok(compared > 300);
  });
});

describe('applyReveal ("show the answer")', () => {
  const miss = applySubmission(undefined, { correct: false, chosen: ['a'], mode: 'inline' }).record;

  it('reveals after one miss without adding an attempt', () => {
    const shown = applyReveal(miss, { mode: 'inline' });
    assert.equal(shown.outcome, 'revealed');
    assert.deepEqual(shown.record, { attempts: 1, correct: false, chosen: ['a'], firstTry: false, revealed: true });
    assert.notEqual(shown.record, miss);
    assert.equal(applySubmission(shown.record, { correct: true, chosen: ['b'], mode: 'inline' }).outcome, 'locked');
  });

  it('is refused before an attempt, after a correct answer, twice, and for predictions', () => {
    const correct = applySubmission(undefined, { correct: true, chosen: ['b'], mode: 'exam' }).record;
    const shown = applyReveal(miss, { mode: 'exam' }).record;
    const guess = applySubmission(undefined, { correct: false, chosen: ['a'], mode: 'predict' }).record;
    for (const [record, mode] of [[undefined, 'inline'], [{ attempts: 0, correct: false, chosen: [], firstTry: false }, 'exam'], [correct, 'exam'], [shown, 'exam'], [guess, 'predict']]) {
      const result = applyReveal(record, { mode });
      assert.equal(result.outcome, 'not_allowed');
      assert.equal(result.record, record);
    }
  });
});

describe('quizFeedback', () => {
  it('shows the picked wrong options\' feedback and the hint after a miss, not the answer', () => {
    const { record, outcome } = applySubmission(undefined, { correct: false, chosen: ['c'], mode: 'inline' });
    assert.deepEqual(quizFeedback(single, record, outcome, { mode: 'inline', locale: 'jp' }), {
      outcome: 'incorrect',
      mode: 'inline',
      attempts: 1,
      attempts_left: 1,
      feedback: [{ label: '3', md: 'Not C.' }],
      hint: 'Think of B.',
    });
  });

  it('shows the explanation and the correct labels once the answer is shown', () => {
    const right = applySubmission(undefined, { correct: true, chosen: ['b'], mode: 'exam' });
    assert.deepEqual(quizFeedback(single, right.record, right.outcome, { mode: 'exam', locale: 'jp' }), {
      outcome: 'correct', mode: 'exam', attempts: 1, attempts_left: 0, explanation: 'B because.', correct_labels: ['2'],
    });
    const locked = applySubmission(right.record, { correct: false, chosen: ['a'], mode: 'exam' });
    const feedback = quizFeedback(single, locked.record, locked.outcome, { mode: 'exam', locale: 'jp', chosen: ['a'] });
    assert.equal(feedback.outcome, 'locked');
    assert.equal(feedback.this_choice_correct, false);
    assert.deepEqual(feedback.correct_labels, ['2']);
    assert.equal(quizFeedback(single, locked.record, 'locked', { mode: 'exam', locale: 'jp', chosen: ['b'] }).this_choice_correct, true);
  });

  it('returns the picked option\'s feedback with a prediction, and no attempts_left', () => {
    const guess = applySubmission(undefined, { correct: false, chosen: ['a'], mode: 'predict' });
    assert.deepEqual(quizFeedback(single, guess.record, guess.outcome, { mode: 'predict', locale: 'jp' }), {
      outcome: 'predicted', mode: 'predict', attempts: 1, feedback: [{ label: '1', md: 'Not A.' }], explanation: 'B because.', correct_labels: ['2'],
    });
  });

  it('gives nothing away for a refused reveal', () => {
    assert.deepEqual(quizFeedback(single, undefined, 'not_allowed', { mode: 'inline', locale: 'jp' }), {
      outcome: 'not_allowed', mode: 'inline', attempts: 0, attempts_left: 2,
    });
  });

  it('holds for every published question in every locale: no answer before the reader shows it', () => {
    assert.ok(QUESTIONS.length >= 100, `found ${QUESTIONS.length} published questions`);
    const ANSWER_FIELDS = ['explanation', 'correct_labels', 'this_choice_correct'];
    for (const { lesson, block, question } of QUESTIONS) {
      const where = `${lesson.id} ${block.id}/${question.id}`;
      const mode = block.mode;
      const labelOf = (id) => String(question.options.findIndex((o) => o.id === id) + 1);
      const answerLabels = question.options.filter((o) => question.answer.includes(o.id)).map((o) => labelOf(o.id));
      const wrong = question.options.filter((o) => !question.answer.includes(o.id));
      assert.ok(wrong.length >= 1, `${where} has a wrong option`);
      for (const locale of availableLocales(lesson)) {
        const text = (value) => resolveText(value, locale, lesson.locale).value;
        const opts = { mode, locale, fallback: lesson.locale };
        const strings = (value) => JSON.stringify(value);

        if (mode === 'predict') {
          const guess = applySubmission(undefined, { correct: false, chosen: [wrong[0].id], mode });
          const fb = quizFeedback(question, guess.record, guess.outcome, opts);
          assert.equal(fb.outcome, 'predicted', where);
          assert.equal(fb.attempts_left, undefined, where);
          assert.equal(fb.explanation, text(question.explanation), where);
          assert.deepEqual(fb.correct_labels, answerLabels, where);
          assert.deepEqual(fb.feedback ?? [], wrong[0].feedback ? [{ label: labelOf(wrong[0].id), md: text(wrong[0].feedback) }] : [], where);
          continue;
        }

        // First miss: the picked wrong option's feedback and the hint, nothing that marks the answer.
        const miss = applySubmission(undefined, { correct: false, chosen: [wrong[0].id], mode });
        const missed = quizFeedback(question, miss.record, miss.outcome, opts);
        assert.equal(missed.outcome, 'incorrect', where);
        for (const field of ANSWER_FIELDS) assert.equal(missed[field], undefined, `${where}: ${field} after a miss`);
        assert.equal(missed.attempts_left, 1, where);
        assert.deepEqual(missed.feedback ?? [], wrong[0].feedback ? [{ label: labelOf(wrong[0].id), md: text(wrong[0].feedback) }] : [], where);
        assert.equal(missed.hint, question.hint === undefined ? undefined : text(question.hint), where);
        assert.ok(!strings(missed).includes(text(question.explanation)), `${where}: explanation text after a miss`);
        for (const option of question.options.filter((o) => question.answer.includes(o.id))) {
          assert.ok(!(missed.feedback ?? []).some((f) => f.label === labelOf(option.id)), `${where}: a correct option is named`);
        }

        // Second miss: revealed, with the answer.
        const second = applySubmission(miss.record, { correct: false, chosen: [(wrong[1] ?? wrong[0]).id], mode });
        const revealed = quizFeedback(question, second.record, second.outcome, opts);
        assert.equal(revealed.outcome, 'revealed', where);
        assert.equal(revealed.attempts_left, 0, where);
        assert.equal(revealed.explanation, text(question.explanation), where);
        assert.deepEqual(revealed.correct_labels, answerLabels, where);

        // Reveal after the first miss (no attempt added).
        const shown = applyReveal(miss.record, { mode });
        const shownFb = quizFeedback(question, shown.record, shown.outcome, opts);
        assert.equal(shownFb.attempts, 1, where);
        assert.deepEqual(shownFb.correct_labels, answerLabels, where);

        // A first-try correct answer, then a locked re-ask.
        const right = applySubmission(undefined, { correct: true, chosen: [...question.answer], mode });
        const rightFb = quizFeedback(question, right.record, right.outcome, opts);
        assert.equal(rightFb.outcome, 'correct', where);
        assert.deepEqual(rightFb.correct_labels, answerLabels, where);
        const again = applySubmission(right.record, { correct: false, chosen: [wrong[0].id], mode });
        const lockedFb = quizFeedback(question, again.record, again.outcome, { ...opts, chosen: [wrong[0].id] });
        assert.equal(lockedFb.outcome, 'locked', where);
        assert.equal(lockedFb.this_choice_correct, false, where);
        assert.equal(lockedFb.attempts, 1, where);

        // A refused reveal (no attempt yet) shows nothing either.
        const refused = applyReveal(undefined, { mode });
        const refusedFb = quizFeedback(question, refused.record, refused.outcome, opts);
        for (const field of [...ANSWER_FIELDS, 'feedback', 'hint']) assert.equal(refusedFb[field], undefined, `${where}: ${field} on a refused reveal`);
      }
    }
  });
});
