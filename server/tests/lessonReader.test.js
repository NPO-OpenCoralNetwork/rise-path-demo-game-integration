// Lesson reader logic (WP-04): progress storage contract, progress maths, outline state,
// resume target, glossary, tutor excerpts and the CJK bold fix. Pure modules only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LAST_LESSON_KEY,
  answerKey,
  emptyProgress,
  getLastLesson,
  parseProgress,
  progressKey,
  readLessonSummary,
  readProgress,
  setLastLesson,
  withAnswer,
  withCheck,
  withLastBlock,
  withRating,
  withRevealed,
  withSeen,
  withSummary,
  writeProgress,
} from '../../components/lesson/progressStore.ts';
import {
  allBlocks,
  blockPlainText,
  checkNumbers,
  figureNumbers,
  findGlossaryItem,
  glossaryItems,
  lessonPct,
  lessonState,
  lessonStateEvents,
  linkGlossaryTerms,
  minutesLeft,
  plainText,
  resolveLText,
  resumeTarget,
  safeDecode,
  sectionStatuses,
  splitLessonTitle,
  splitPromptVars,
  splitSectionTitle,
} from '../../components/lesson/model.ts';
import remarkCjkEmphasis, { splitCjkStrong } from '../../components/lesson/remarkCjkEmphasis.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSE_DIR = path.join(ROOT, 'content/courses/vibe-coding');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const course = readJson(path.join(COURSE_DIR, 'course.json'));
const ch1 = readJson(path.join(COURSE_DIR, 'lessons/vibe-ch1.lesson.json'));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
};

const t = (text) => resolveLText(text, 'jp', 'jp').value;

describe('progressStore (PLAN §9.1 contract)', () => {
  it('uses the agreed keys', () => {
    assert.equal(progressKey('vibe-coding', 'vibe-ch1'), 'rp:progress:vibe-coding:vibe-ch1');
    assert.equal(LAST_LESSON_KEY, 'rp:lastLesson');
  });

  it('round-trips progress through storage with the v1 shape', () => {
    const storage = memoryStorage();
    let p = emptyProgress();
    p = withSeen(p, ['a', 'b', 'a']);
    p = withAnswer(p, answerKey('q1', 'x'), { chosen: ['o2'], correct: false });
    p = withCheck(p, 'checklist:c/1', true);
    p = withLastBlock(p, 'b');
    assert.equal(writeProgress('vibe-coding', 'vibe-ch1', p, storage), true);
    const raw = JSON.parse(storage.dump()['rp:progress:vibe-coding:vibe-ch1']);
    assert.equal(raw.v, 1);
    assert.deepEqual(raw.seen, ['a', 'b']);
    assert.deepEqual(raw.answers['q1/x'], { attempts: 1, correct: false, chosen: ['o2'], firstTry: false });
    assert.equal(raw.checks['checklist:c/1'], true);
    assert.equal(raw.lastBlockId, 'b');
    assert.equal(typeof raw.updatedAt, 'string');
    assert.deepEqual(readProgress('vibe-coding', 'vibe-ch1', storage), p);
  });

  it('records first-try correctness and reveal', () => {
    let p = emptyProgress();
    p = withAnswer(p, 'q/1', { chosen: ['a'], correct: false });
    p = withAnswer(p, 'q/1', { chosen: ['b'], correct: true });
    assert.equal(p.answers['q/1'].attempts, 2);
    assert.equal(p.answers['q/1'].correct, true);
    assert.equal(p.answers['q/1'].firstTry, false);
    p = withRevealed(p, 'q/2');
    assert.deepEqual(p.answers['q/2'], { attempts: 0, correct: false, chosen: [], firstTry: false, revealed: true });
  });

  it('returns the same object when nothing changes', () => {
    const p = withSeen(emptyProgress(), ['a']);
    assert.equal(withSeen(p, ['a']), p);
    assert.equal(withLastBlock(p, null), p);
    const rated = withRating(p, 'o1', 3);
    assert.equal(withRating(rated, 'o1', 3), rated);
    const summarized = withSummary(p, { pct: 10, state: 'in_progress' });
    assert.equal(withSummary(summarized, { pct: 10, state: 'in_progress' }), summarized);
  });

  it('treats corrupt or foreign data as empty progress', () => {
    assert.deepEqual(parseProgress('{not json'), emptyProgress());
    assert.deepEqual(parseProgress(JSON.stringify({ v: 2, seen: ['x'] })), emptyProgress());
    const parsed = parseProgress(JSON.stringify({
      v: 1,
      seen: ['a', 3, 'a'],
      answers: { ok: { attempts: 1, correct: true, chosen: 'o1' }, bad: { attempts: -1 } },
      checks: { x: true, y: 'yes' },
      lastBlockId: '',
      ratings: { o1: 2, o2: 7 },
      summary: { pct: 140, state: 'read' },
    }));
    assert.deepEqual(parsed.seen, ['a']);
    assert.deepEqual(Object.keys(parsed.answers), ['ok']);
    assert.deepEqual(parsed.answers.ok.chosen, ['o1']);
    assert.deepEqual(parsed.checks, { x: true });
    assert.equal(parsed.lastBlockId, null);
    assert.deepEqual(parsed.ratings, { o1: 2 });
    assert.deepEqual(parsed.summary, { pct: 100, state: 'read' });
  });

  it('never throws when storage is blocked', () => {
    assert.deepEqual(readProgress('c', 'l', throwingStorage), emptyProgress());
    assert.equal(writeProgress('c', 'l', emptyProgress(), throwingStorage), false);
    assert.equal(getLastLesson(throwingStorage), null);
    assert.doesNotThrow(() => setLastLesson({ courseSlug: 'c', lessonId: 'l', title: 'x', pct: 5 }, throwingStorage));
    assert.equal(readLessonSummary('c', 'l', throwingStorage), null);
    assert.deepEqual(readProgress('c', 'l', null), emptyProgress());
  });

  it('stores and reads rp:lastLesson for the dashboard', () => {
    const storage = memoryStorage();
    setLastLesson({ courseSlug: 'vibe-coding', lessonId: 'vibe-ch2', title: '第2章', pct: 42.4 }, storage);
    const last = getLastLesson(storage);
    assert.equal(last.courseSlug, 'vibe-coding');
    assert.equal(last.lessonId, 'vibe-ch2');
    assert.equal(last.pct, 42);
    assert.ok(Date.parse(last.at));
    assert.equal(getLastLesson(memoryStorage({ 'rp:lastLesson': '{"lessonId":"x"}' })), null);
  });

  it('summarizes a lesson without loading it', () => {
    const storage = memoryStorage();
    assert.equal(readLessonSummary('vibe-coding', 'vibe-ch3', storage), null);
    writeProgress('vibe-coding', 'vibe-ch3', withSummary(withSeen(emptyProgress(), ['a']), { pct: 95, state: 'read' }), storage);
    assert.equal(readLessonSummary('vibe-coding', 'vibe-ch3', storage).state, 'read');
    // Older records without a snapshot still count as started.
    storage.setItem(progressKey('vibe-coding', 'vibe-ch4'), JSON.stringify({ v: 1, seen: ['x'], answers: {}, checks: {} }));
    assert.equal(readLessonSummary('vibe-coding', 'vibe-ch4', storage).state, 'in_progress');
  });
});

describe('reader model', () => {
  it('splits chapter and section titles', () => {
    assert.deepEqual(splitLessonTitle('第1章｜人間が理解すべき最低ライン'), { kicker: '第1章', title: '人間が理解すべき最低ライン' });
    assert.deepEqual(splitLessonTitle('Chapter 1 | Minimum Viable Knowledge'), { kicker: 'Chapter 1', title: 'Minimum Viable Knowledge' });
    assert.deepEqual(splitLessonTitle('まとめ'), { kicker: null, title: 'まとめ' });
    assert.deepEqual(splitSectionTitle('1-1. フロントエンド / バックエンド / DBの関係'), { num: '1-1', title: 'フロントエンド / バックエンド / DBの関係' });
    assert.deepEqual(splitSectionTitle('理解度チェック'), { num: null, title: '理解度チェック' });
  });

  it('resolves localized text and reports fallback lang', () => {
    assert.deepEqual(resolveLText({ jp: 'こんにちは', en: 'Hello' }, 'en', 'jp'), { value: 'Hello' });
    assert.deepEqual(resolveLText({ jp: 'こんにちは' }, 'en', 'jp'), { value: 'こんにちは', lang: 'ja' });
    assert.deepEqual(resolveLText('plain', 'en', 'jp'), { value: 'plain', lang: 'ja' });
    assert.deepEqual(resolveLText('plain', 'jp', 'jp'), { value: 'plain' });
  });

  it('computes pct and the lesson state machine', () => {
    let p = emptyProgress();
    assert.equal(lessonPct(ch1, p), 0);
    assert.equal(lessonState(ch1, p), 'not_started');
    const blocks = allBlocks(ch1);
    const reading = blocks.filter((b) => b.type !== 'quiz');
    p = withSeen(p, [reading[0].id]);
    assert.equal(lessonState(ch1, p), 'in_progress');
    p = withSeen(p, reading.map((b) => b.id));
    assert.equal(lessonState(ch1, p), 'read');
    for (const quiz of blocks.filter((b) => b.type === 'quiz' && b.mode !== 'exam')) {
      for (const q of quiz.questions) p = withAnswer(p, answerKey(quiz.id, q.id), { chosen: q.answer, correct: true });
    }
    assert.equal(lessonState(ch1, p), 'checked');
    for (const quiz of blocks.filter((b) => b.type === 'quiz' && b.mode === 'exam')) {
      for (const q of quiz.questions) p = withAnswer(p, answerKey(quiz.id, q.id), { chosen: q.answer, correct: true });
    }
    assert.equal(lessonState(ch1, p), 'mastered');
    assert.equal(lessonPct(ch1, p), 100);
  });

  it('marks outline sections: done, current, attention (inline checks only), todo', () => {
    const blocks = allBlocks(ch1);
    const s11 = ch1.sections.find((s) => s.id === '1-1');
    const hook = ch1.sections.find((s) => s.id === 'hook');
    // Read every non-quiz block of the hook and 1-1, answer nothing.
    let p = withSeen(emptyProgress(), [...hook.blocks, ...s11.blocks].filter((b) => b.type !== 'quiz').map((b) => b.id));
    let st = sectionStatuses(ch1, p, '1-2');
    assert.equal(st.hook, 'todo', 'an unanswered prediction is not flagged');
    assert.equal(st['1-1'], 'attention', 'an unanswered inline check is flagged');
    assert.equal(st['1-2'], 'current');
    assert.equal(st.summary, 'todo');
    // Reading into 1-1 while the hook is still active never flags 1-1 (its check lies ahead).
    const firstOf11 = withSeen(emptyProgress(), [s11.blocks[0].id]);
    assert.equal(sectionStatuses(ch1, firstOf11, 'hook')['1-1'], 'todo', 'a section ahead is not flagged');
    assert.equal(sectionStatuses(ch1, firstOf11, null)['1-1'], 'todo', 'reading in is not passing the check');
    const check = s11.blocks.find((b) => b.type === 'quiz');
    const sawCheck = withSeen(emptyProgress(), [s11.blocks[0].id, check.id]);
    assert.equal(sectionStatuses(ch1, sawCheck, null)['1-1'], 'attention', 'a seen, unanswered check is flagged');
    for (const q of check.questions) p = withAnswer(p, answerKey(check.id, q.id), { chosen: ['x'], correct: false });
    st = sectionStatuses(ch1, p, '1-2');
    assert.equal(st['1-1'], 'done');
    assert.ok(blocks.length > 0);
  });

  it('numbers figures and inline checks in reading order', () => {
    const figures = figureNumbers(ch1);
    assert.equal(figures.get('s1-b2'), 1);
    const { numbers, total } = checkNumbers(ch1);
    assert.equal(total, 2);
    assert.equal(numbers.get('s1-check'), 1);
    assert.equal(numbers.get('s2-check'), 2);
  });

  it('picks the resume target: hash first, then lastBlockId', () => {
    const p = withLastBlock(emptyProgress(), 's3-b2');
    assert.deepEqual(resumeTarget('#s-1-2', p, ch1), { kind: 'section', id: '1-2' });
    assert.deepEqual(resumeTarget('#b-s1-b4', p, ch1), { kind: 'block', id: 's1-b4' });
    assert.deepEqual(resumeTarget('', p, ch1), { kind: 'block', id: 's3-b2' });
    assert.deepEqual(resumeTarget('#s-nope', withLastBlock(emptyProgress(), 'gone'), ch1), null);
    // A malformed escape in a shared link must not throw (it used to crash the reader).
    assert.deepEqual(resumeTarget('#100%', p, ch1), { kind: 'block', id: 's3-b2' });
    assert.equal(safeDecode('%zz'), '%zz');
    assert.equal(safeDecode('%E3%81%82'), 'あ');
  });

  it('builds the glossary from definitions blocks and finds terms in any locale', () => {
    const items = glossaryItems(ch1, course);
    assert.ok(items.length >= 5);
    const api = findGlossaryItem(items, 'API（Application Programming Interface）') ?? items.find((i) => i.key.startsWith('API'));
    assert.ok(api?.blockId, 'glossary items point at their definitions block');
    const first = items[0];
    const enName = typeof first.term === 'object' ? first.term.en : null;
    if (enName) assert.equal(findGlossaryItem(items, enName.toUpperCase()), first);
    assert.equal(findGlossaryItem(items, 'does-not-exist'), undefined);
  });

  it('turns blocks into plain-text tutor excerpts (≤1,500 chars)', () => {
    for (const block of allBlocks(ch1)) {
      const text = blockPlainText(block, t);
      assert.ok(text.length > 0, `${block.type} ${block.id} has an excerpt`);
      assert.ok(text.length <= 1500);
      assert.ok(!/\*\*/.test(text) || block.type === 'code', `${block.id} excerpt has no markdown bold`);
    }
    assert.equal(plainText('**太字** と `code` と [リンク](https://x.example) と [[用語|ラベル]]'), '太字 と code と リンク と ラベル');
  });

  it('parses prompt variables and glossary links', () => {
    assert.deepEqual(splitPromptVars('A {{ 目的 }} B'), [
      { kind: 'text', value: 'A ' }, { kind: 'var', name: '目的' }, { kind: 'text', value: ' B' },
    ]);
    assert.equal(linkGlossaryTerms('[[API]] と [[UI|画面]]'), '[API](#rp-term:API) と [画面](#rp-term:UI)');
  });

  it('leaves [[ ]] inside inline code and code fences alone', () => {
    // cc-08's hint quotes the shell test `[[ "$COMMAND" == rm* ]]`; it must stay code, not become a link.
    assert.equal(
      linkGlossaryTerms('`[[ "$COMMAND" == rm* ]]` と [[API]]'),
      '`[[ "$COMMAND" == rm* ]]` と [API](#rp-term:API)',
    );
    assert.equal(linkGlossaryTerms('```sh\n[[ -f a ]]\n```\n[[UI|画面]]'), '```sh\n[[ -f a ]]\n```\n[画面](#rp-term:UI)');
    assert.equal(linkGlossaryTerms('``a ` [[b]]`` [[c]]'), '``a ` [[b]]`` [c](#rp-term:c)');
  });

  it('estimates minutes left', () => {
    assert.equal(minutesLeft(20, 0), 20);
    assert.equal(minutesLeft(20, 99), 1);
    assert.equal(minutesLeft(20, 100), 0);
  });

  it('turns learner-caused state changes into lesson_start / lesson_complete events', () => {
    assert.deepEqual(lessonStateEvents('not_started', 'in_progress'), ['lesson_start']);
    assert.deepEqual(lessonStateEvents('in_progress', 'in_progress'), []);
    assert.deepEqual(lessonStateEvents('in_progress', 'read'), ['lesson_complete']);
    assert.deepEqual(lessonStateEvents('not_started', 'read'), ['lesson_start', 'lesson_complete']);
    // Already done: answering the exam later (checked → mastered) is not a second completion.
    assert.deepEqual(lessonStateEvents('read', 'checked'), []);
    assert.deepEqual(lessonStateEvents('checked', 'mastered'), []);
  });
});

describe('remarkCjkEmphasis', () => {
  it('bolds **…** pairs that CommonMark left as text next to Japanese brackets', () => {
    assert.deepEqual(splitCjkStrong('相談できる**「設計図」**です'), [
      { type: 'text', value: '相談できる' },
      { type: 'strong', children: [{ type: 'text', value: '「設計図」' }] },
      { type: 'text', value: 'です' },
    ]);
    assert.equal(splitCjkStrong('no stars here'), null);
    assert.equal(splitCjkStrong('a ** b'), null);
  });

  it('rewrites text nodes in a tree and leaves code alone', () => {
    const tree = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'text', value: 'は**「名札」**です' },
          { type: 'inlineCode', value: '**not bold**' },
        ],
      }],
    };
    remarkCjkEmphasis()(tree);
    const para = tree.children[0];
    assert.deepEqual(para.children.map((n) => n.type), ['text', 'strong', 'text', 'inlineCode']);
    assert.equal(para.children[3].value, '**not bold**');
  });
});
