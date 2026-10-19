// Inline AI tutor: learner state and mode per turn (components/lesson/useTutorStream.ts).
// - State comes from the reader's answers in memory at each turn, never from an earlier request.
// - A multi-question check (the final exam) stays socratic until every question's answer is shown;
//   one answered question does not unlock the others.
// - A reveal is sent as answerShown with the real attempt count.
// - A reply cut at the length limit is a normal (partial) answer.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    blockLearnerState,
    buildTutorRequest,
    finishedTurn,
    lessonLearnerState,
    refreshThread,
    resolveClientMode,
    threadForAsk,
    threadHistory,
} from '../../components/lesson/useTutorStream.ts';
import { normalizeTutorDetail } from '../../services/tutorBridge.ts';
import { answerKey, emptyProgress, withAnswer, withRevealed } from '../../components/lesson/progressStore.ts';
import { TutorRequest, resolveTutorMode } from '../llm/schemas.js';
import { buildTutorPrompt, tutorModeLine } from '../llm/prompts/tutor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vibeCh1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/courses/vibe-coding/lessons/vibe-ch1.lesson.json'), 'utf8'));

const lessonRef = { courseId: 'vibe-coding', lessonId: 'vibe-ch1', title: 'ch1', objectives: [] };
/** A small lesson: a one-question check, a three-question exam and a prose block. */
const lesson = {
    sections: [
        { id: 's1', blocks: [{ id: 's1-b1', type: 'markdown' }, { id: 's1-check', type: 'quiz', questions: [{ id: 'q1' }] }] },
        { id: 'check', blocks: [{ id: 'exam', type: 'quiz', questions: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] }] },
    ],
};
const quiz = { sectionId: 's1', blockId: 's1-check', blockType: 'quiz', excerpt: 'Q (1) [a] … (2) [b] …' };
const exam = { sectionId: 'check', blockId: 'exam', blockType: 'quiz', excerpt: 'E1 … E2 … E3 …' };
const prose = { sectionId: 's1', blockId: 's1-b1', blockType: 'markdown', excerpt: 'Webアプリは3つの要素で動きます。' };

const miss = (p, blockId, questionId, chosen = 'b') => withAnswer(p, answerKey(blockId, questionId), { chosen: [chosen], correct: false, revealed: false });
const right = (p, blockId, questionId, chosen = 'a') => withAnswer(p, answerKey(blockId, questionId), { chosen: [chosen], correct: true });
const reveal = (p, blockId, questionId) => withRevealed(p, answerKey(blockId, questionId));

/** What LessonReader passes to the hook, over a progress value that can change between turns. */
const liveFrom = (holder) => (anchor, questionId) => lessonLearnerState(lesson, holder.progress.answers, anchor, questionId);

/** The request body the thread sends next, as the gateway parses it. */
const parsed = (thread, message = 'なぜ？') => TutorRequest.parse(buildTutorRequest(thread, message, 'ja'));
const serverMode = (thread) => resolveTutorMode(parsed(thread));

/** The quiz's "why?" button after one miss on q1. */
const whyRequest = (anchor = quiz, questionId = 'q1') => ({
    message: 'なぜ違うの？',
    tutor: { mode: 'socratic', lesson: lessonRef, anchor, learner: { attemptsOnBlock: 1, chosenOptionId: 'b', questionId } },
});
/** A question typed in the panel about the current block (TutorPanel sends no learner state). */
const panelRequest = (anchor) => ({ message: '答えを教えて', tutor: { mode: 'explain', lesson: lessonRef, anchor } });

describe('tutor learner state from the reader\'s answers', () => {
    it('describes one question with its real attempts and whether its answer is shown', () => {
        let p = emptyProgress();
        assert.deepEqual(blockLearnerState(p.answers, 's1-check', ['q1'], 'q1'), { attemptsOnBlock: 0, questionId: 'q1' });
        p = miss(p, 's1-check', 'q1');
        assert.deepEqual(blockLearnerState(p.answers, 's1-check', ['q1'], 'q1'), { attemptsOnBlock: 1, chosenOptionId: 'b', questionId: 'q1' });
        // "Show answer" after one miss: shown, and still one real attempt.
        assert.deepEqual(blockLearnerState(reveal(p, 's1-check', 'q1').answers, 's1-check', ['q1'], 'q1'),
            { attemptsOnBlock: 1, chosenOptionId: 'b', questionId: 'q1', answerShown: true });
        assert.equal(blockLearnerState(right(emptyProgress(), 's1-check', 'q1').answers, 's1-check', ['q1'], 'q1').answerShown, true, 'a correct pick shows the answer');
        assert.equal(blockLearnerState(miss(p, 's1-check', 'q1').answers, 's1-check', ['q1'], 'q1').answerShown, true, 'second miss');
        assert.equal(blockLearnerState(p.answers, 's1-check', ['q1'], 'nope'), undefined);
    });

    it('a multi-question block counts as shown only when every question is, with the fewest attempts', () => {
        const ids = ['e1', 'e2', 'e3'];
        let p = right(emptyProgress(), 'exam', 'e1');
        assert.deepEqual(blockLearnerState(p.answers, 'exam', ids), { attemptsOnBlock: 0 }, 'e2 and e3 are untouched');
        p = reveal(miss(p, 'exam', 'e2'), 'exam', 'e2');
        assert.deepEqual(blockLearnerState(p.answers, 'exam', ids), { attemptsOnBlock: 0 });
        p = right(p, 'exam', 'e3');
        assert.deepEqual(blockLearnerState(p.answers, 'exam', ids), { attemptsOnBlock: 1, answerShown: true });
    });

    it('lessonLearnerState finds quiz blocks only', () => {
        const p = miss(emptyProgress(), 's1-check', 'q1');
        assert.deepEqual(lessonLearnerState(lesson, p.answers, quiz), { attemptsOnBlock: 1, chosenOptionId: 'b', questionId: 'q1' });
        assert.equal(lessonLearnerState(lesson, p.answers, prose), undefined);
        assert.equal(lessonLearnerState(lesson, p.answers, { blockId: 'missing' }), undefined);
        assert.equal(lessonLearnerState(lesson, p.answers, undefined), undefined);
    });

    it('answerShown means explain on both sides; the prompt states the real attempts', () => {
        const learner = { attemptsOnBlock: 1, chosenOptionId: 'b', questionId: 'q1', answerShown: true };
        assert.equal(resolveClientMode({ anchor: quiz, learner }), 'explain');
        const body = TutorRequest.parse({ message: 'なぜ？', anchor: quiz, learner });
        assert.equal(resolveTutorMode(body), 'explain');
        const prompt = buildTutorPrompt(body, { mode: 'explain', locale: 'ja' });
        const text = JSON.stringify(prompt);
        assert.match(text, /question: q1\\nattempts on this question: 1\\nlast chosen option: b\\nthe correct answer is already shown to the learner/);
        // The bridge keeps both fields.
        const normalized = normalizeTutorDetail({ message: 'x', learner });
        assert.deepEqual(normalized.tutor.learner, learner);
    });
});

describe('tutor threads: ask() and follow-ups', () => {
    it('starts the "why?" thread socratic, as the gateway does', () => {
        const holder = { progress: miss(emptyProgress(), 's1-check', 'q1') };
        const thread = threadForAsk(undefined, whyRequest(), liveFrom(holder));
        assert.equal(thread.mode, 'socratic');
        assert.equal(serverMode(thread), 'socratic');
        assert.equal(thread.learner.questionId, 'q1');
    });

    it('a follow-up after "show answer" explains, with the real attempt count', () => {
        const holder = { progress: miss(emptyProgress(), 's1-check', 'q1') };
        const live = liveFrom(holder);
        const thread = threadForAsk(undefined, whyRequest(), live);
        assert.equal(refreshThread(thread, live), thread, 'nothing changed: same thread');
        holder.progress = reveal(holder.progress, 's1-check', 'q1');
        const after = refreshThread(thread, live);
        assert.equal(after.mode, 'explain');
        assert.deepEqual(after.learner, { attemptsOnBlock: 1, chosenOptionId: 'b', questionId: 'q1', answerShown: true });
        assert.equal(serverMode(after), 'explain');
    });

    it('a panel question about the same check uses the reader\'s answers now, not the earlier request', () => {
        const holder = { progress: miss(emptyProgress(), 's1-check', 'q1') };
        const live = liveFrom(holder);
        const existing = { ...threadForAsk(undefined, whyRequest(), live), turns: [{ id: 'u', role: 'user', text: 'なぜ違うの？', status: 'done' }] };
        holder.progress = reveal(holder.progress, 's1-check', 'q1');
        const next = threadForAsk(existing, panelRequest(quiz), live);
        assert.equal(next.key, existing.key);
        assert.equal(next.turns, existing.turns);
        assert.equal(next.learner.answerShown, true);
        assert.equal(serverMode(next), 'explain');
    });

    it('final exam: one correct answer does not unlock the unanswered questions (vibe-ch1 check-quiz)', () => {
        const block = vibeCh1.sections.flatMap((s) => s.blocks).find((b) => b.id === 'check-quiz');
        assert.equal(block.questions.length, 3);
        const [first] = block.questions;
        const anchor = { sectionId: 'check', blockId: block.id, blockType: 'quiz', excerpt: 'every question and option' };
        const holder = { progress: right(emptyProgress(), block.id, first.id, first.answer[0]) };
        const live = (a, q) => lessonLearnerState(vibeCh1, holder.progress.answers, a, q);

        // A question typed in the panel about the exam block.
        const typed = threadForAsk(undefined, panelRequest(anchor), live);
        assert.equal(typed.mode, 'socratic');
        assert.equal(serverMode(typed), 'socratic');
        assert.match(tutorModeLine(parsed(typed), { mode: 'socratic', locale: 'ja' }), /do not reveal its answer/);

        // "why?" on the first question after a miss, then a correct pick: that question opens,
        // and the thread (whose excerpt is that question only) explains it.
        holder.progress = miss(emptyProgress(), block.id, first.id, 'x');
        const why = threadForAsk(undefined, whyRequest(anchor, first.id), live);
        assert.equal(why.mode, 'socratic');
        holder.progress = right(holder.progress, block.id, first.id, first.answer[0]);
        const followUp = refreshThread(why, live);
        assert.equal(followUp.learner.questionId, first.id);
        assert.equal(serverMode(followUp), 'explain');

        // Back to the whole block in the panel: still socratic while the others are open.
        const backToBlock = threadForAsk(followUp, panelRequest(anchor), live);
        assert.deepEqual(backToBlock.learner, { attemptsOnBlock: 0 });
        assert.equal(serverMode(backToBlock), 'socratic');

        // Every answer shown: explain.
        for (const q of block.questions.slice(1)) holder.progress = right(holder.progress, block.id, q.id, q.answer[0]);
        assert.equal(serverMode(refreshThread(backToBlock, live)), 'explain');
    });

    it('follows the request on prose: the reader has no quiz state there', () => {
        const holder = { progress: emptyProgress() };
        const next = threadForAsk(undefined, { message: 'q', tutor: { mode: 'explain', lesson: lessonRef, anchor: prose } }, liveFrom(holder));
        assert.equal(next.learner, undefined);
        assert.equal(next.mode, 'explain');
    });

    it('without a reader (no live state) the request\'s state stands and a check without one is socratic', () => {
        const why = threadForAsk(undefined, whyRequest());
        assert.equal(why.learner.attemptsOnBlock, 1);
        const next = threadForAsk(why, panelRequest(quiz));
        assert.equal(next.learner, undefined, 'the earlier request\'s state is never reused');
        assert.equal(next.mode, 'socratic');
        assert.equal('learner' in buildTutorRequest(next, 'q', 'ja'), false);
    });
});

describe('tutor answers cut at the length limit', () => {
    const streaming = { id: 'a1', role: 'assistant', text: '前半の説明', status: 'streaming', mode: 'explain' };
    const done = { mode: 'explain', locale: 'ja', grounding: { sectionId: 's1', blockId: 's1-b1' }, provider: 'anthropic', model: 'm', text: '前半の説明' };

    it('keeps the partial text as a normal answer with a truncated flag', () => {
        const turn = finishedTurn(streaming, { ...done, truncated: true });
        assert.equal(turn.status, 'done');
        assert.equal(turn.error, undefined);
        assert.equal(turn.text, '前半の説明');
        assert.equal(turn.truncated, true);
        assert.deepEqual(turn.grounding, done.grounding);
        // It is history like any finished answer.
        assert.equal(threadHistory([{ id: 'u', role: 'user', text: 'q', status: 'done' }, turn]).length, 2);
    });

    it('sets no flag on a complete answer', () => {
        const turn = finishedTurn(streaming, done);
        assert.equal(turn.status, 'done');
        assert.equal('truncated' in turn, false);
        assert.equal(turn.demo, false);
    });
});
