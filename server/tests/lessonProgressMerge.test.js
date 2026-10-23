// Shared lesson progress (shared/lesson/progress.js, progressMerge.js): the import allowlist of
// the browser-safe shared modules, parity with the reader's progressStore/model, the lesson
// index, the structural sanitiser and the cross-device merge.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as shared from '../../shared/lesson/progress.js';
import {
  MAX_CLOCK_SKEW_MS,
  PROGRESS_LIMITS,
  lessonIndex,
  mergeProgress,
  progressContentEqual,
  sanitizeProgress,
} from '../../shared/lesson/progressMerge.js';
import * as store from '../../components/lesson/progressStore.ts';
import * as model from '../../components/lesson/model.ts';
import { ROOT, publishedLessons } from './helpers/publishedLessons.js';

const { answerKey, emptyProgress, lessonPct, lessonState, parseProgress } = shared;
const LESSONS = publishedLessons();
const ch1 = LESSONS.find((entry) => entry.lesson.id === 'vibe-ch1').lesson;
const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const at = (minutes) => new Date(NOW + minutes * 60_000).toISOString();

const record = (patch = {}) => ({ ...emptyProgress(), updatedAt: at(0), ...patch });
const answer = (attempts, correct, chosen, firstTry, revealed = false) => ({
  attempts, correct, chosen, firstTry, ...(revealed ? { revealed: true } : {}),
});

describe('shared lesson modules: import allowlist (K35)', () => {
  const GUARDED = ['progress.js', 'grading.js', 'learnerView.js', 'progressMerge.js'];
  const ALLOWED = new Set(['constants.js', 'text.js', 'walk.js', 'canonical.js', ...GUARDED]);
  const DIR = path.join(ROOT, 'shared/lesson');
  /** Runtime import specifiers (static, re-export, dynamic, require); comments and JSDoc types are ignored. */
  const importsOf = (text) => ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);

  it('detects runtime imports and ignores JSDoc type imports', () => {
    assert.deepEqual(importsOf("import { z } from './schema.js';\nconst a = await import('node:fs');"), ['./schema.js', 'node:fs']);
    assert.deepEqual(importsOf("/** @typedef {import('./schema.js').Lesson} Lesson */\nexport const x = 1;"), []);
  });

  it('progress, grading, learnerView and progressMerge import only the zod-free helpers, transitively', () => {
    const queue = [...GUARDED];
    const reached = new Set();
    while (queue.length) {
      const name = queue.shift();
      if (reached.has(name)) continue;
      reached.add(name);
      const text = fs.readFileSync(path.join(DIR, name), 'utf8');
      if (GUARDED.includes(name)) assert.match(text, /^\/\/ @ts-check\n/, `${name} starts with // @ts-check`);
      for (const specifier of importsOf(text)) {
        assert.match(specifier, /^\.\/[a-zA-Z]+\.js$/, `${name} imports "${specifier}" (only sibling shared/lesson files)`);
        const target = specifier.slice(2);
        assert.ok(ALLOWED.has(target), `${name} imports ${target}: allowed are ${[...ALLOWED].join(', ')}`);
        queue.push(target);
      }
    }
    assert.ok(!reached.has('schema.js'));
  });
});

describe('progress.js is the reader\'s progress code (parity)', () => {
  it('progressStore.ts and model.ts re-export the shared functions themselves', () => {
    for (const name of ['PROGRESS_VERSION', 'LESSON_STATES', 'answerKey', 'emptyProgress', 'parseProgress']) {
      assert.equal(store[name], shared[name], `progressStore.${name}`);
    }
    for (const name of ['isAnswered', 'quizAnswered', 'blockDone', 'allBlocks', 'lessonPct', 'lessonState', 'LESSON_DONE_STATES']) {
      assert.equal(model[name], shared[name], `model.${name}`);
    }
    assert.deepEqual([...shared.LESSON_DONE_STATES], ['read', 'checked', 'mastered']);
    assert.deepEqual(shared.LESSON_STATES, ['not_started', 'in_progress', 'read', 'checked', 'mastered']);
  });

  it('withCheck and withRating move editedAt with updatedAt; seen, resume and answers do not', () => {
    let p = store.withSeen(emptyProgress(), ['a']);
    p = store.withLastBlock(p, 'a');
    p = store.withAnswer(p, 'q/1', { chosen: ['x'], correct: true });
    p = store.withRevealed(p, 'q/2');
    assert.equal(p.editedAt, undefined);
    const checked = store.withCheck(p, 'checklist:c/1', true);
    assert.equal(checked.editedAt, checked.updatedAt);
    const rated = store.withRating(emptyProgress(), 'o1', 2);
    assert.equal(rated.editedAt, rated.updatedAt);
    assert.equal(store.withCheck(checked, 'checklist:c/1', true), checked, 'no change, same object');
  });

  it('parseProgress keeps editedAt and accepts an already-parsed value', () => {
    const value = { v: 1, seen: ['a'], answers: {}, checks: { x: true }, lastBlockId: null, updatedAt: at(0), editedAt: at(-1) };
    assert.equal(parseProgress(JSON.stringify(value)).editedAt, at(-1));
    assert.deepEqual(parseProgress(value), parseProgress(JSON.stringify(value)));
    assert.equal(parseProgress({ ...value, editedAt: 5 }).editedAt, undefined);
    assert.deepEqual(parseProgress(null), emptyProgress());
  });

  it('parseProgress never lets a "__proto__" key replace a prototype', () => {
    const parsed = parseProgress('{"v":1,"answers":{"__proto__":{"attempts":1}},"checks":{"__proto__":true},"ratings":{"__proto__":2}}');
    assert.equal(Object.getPrototypeOf(parsed.answers), Object.prototype);
    assert.equal(Object.getPrototypeOf(parsed.checks), Object.prototype);
    assert.deepEqual(Object.keys(parsed.answers), []);
  });

  it('lessonPct and lessonState ignore keys the lesson does not have (version skew)', () => {
    const foreign = record({
      seen: ['not-a-block', 'other'],
      answers: { 'gone/q9': answer(1, true, ['a'], true) },
    });
    assert.equal(lessonState(ch1, foreign), 'not_started');
    assert.equal(lessonPct(ch1, foreign), 0);
    const reading = shared.allBlocks(ch1).filter((b) => b.type !== 'quiz').map((b) => b.id);
    const withOne = { ...foreign, seen: [...foreign.seen, reading[0]] };
    assert.equal(lessonState(ch1, withOne), 'in_progress');
    assert.equal(lessonPct(ch1, withOne), lessonPct(ch1, record({ seen: [reading[0]] })));
  });
});

describe('lessonIndex', () => {
  for (const { file, lesson } of LESSONS) {
    it(`${file}: every block, question, check and rating key`, () => {
      const index = lessonIndex(lesson);
      const blocks = lesson.sections.flatMap((s) => s.blocks);
      assert.deepEqual([...index.blockIds], blocks.map((b) => b.id));
      assert.deepEqual([...index.readingBlockIds], blocks.filter((b) => b.type !== 'quiz').map((b) => b.id));
      const questions = blocks.filter((b) => b.type === 'quiz').flatMap((b) => b.questions.map((q) => ({ b, q })));
      assert.deepEqual([...index.questions.keys()], questions.map(({ b, q }) => answerKey(b.id, q.id)));
      for (const { b, q } of questions) {
        const entry = index.questions.get(answerKey(b.id, q.id));
        assert.equal(entry.blockId, b.id);
        assert.equal(entry.question, q);
        assert.equal(entry.mode, b.mode);
        assert.ok(lesson.sections.find((s) => s.id === entry.sectionId).blocks.includes(b));
      }
      const expectedChecks = blocks.flatMap((b) => {
        if (b.type === 'checklist') return b.items.map((i) => `checklist:${b.id}/${i.id}`);
        if (b.type === 'steps') return b.items.map((i) => `step:${b.id}/${i.id}`);
        if (b.type === 'flashcards') return b.cards.map((c) => `card:${b.id}/${c.id}`);
        return [];
      });
      assert.deepEqual([...index.checkKeys], expectedChecks);
      assert.deepEqual([...index.ratingKeys], [...(lesson.objectives ?? []).map((o) => o.id), 'lesson']);
      assert.deepEqual([...index.sections.keys()], lesson.sections.map((s) => s.id));
      for (const section of lesson.sections) {
        const entry = index.sections.get(section.id);
        assert.deepEqual(entry.blockIds, section.blocks.map((b) => b.id));
        assert.deepEqual(entry.readingBlockIds, section.blocks.filter((b) => b.type !== 'quiz').map((b) => b.id));
        assert.deepEqual(entry.nonExamQuizKeys, section.blocks
          .filter((b) => b.type === 'quiz' && b.mode !== 'exam')
          .flatMap((b) => b.questions.map((q) => answerKey(b.id, q.id))));
      }
      // Every key fits the sanitiser's structural rules, so nothing a lesson can produce is dropped.
      const full = record({
        seen: [...index.blockIds],
        answers: Object.fromEntries([...index.questions.keys()].map((key) => [key, answer(1, true, ['a'], true)])),
        checks: Object.fromEntries([...index.checkKeys].map((key) => [key, true])),
        ratings: Object.fromEntries([...index.ratingKeys].map((key) => [key, 3])),
        lastBlockId: [...index.blockIds].at(-1),
      });
      assert.ok(progressContentEqual(sanitizeProgress(full, { now: NOW }), full), file);
    });
  }
});

describe('sanitizeProgress (structural, no lesson)', () => {
  it('keeps well-formed keys the current lesson does not know (version skew)', () => {
    const raw = record({
      seen: ['s9-new-block'],
      answers: { 'exam/q7': answer(1, true, ['b'], true) },
      checks: { 'checklist:new/i1': true, 'futurekind:b1/x': false },
      ratings: { 'o9': 3 },
      lastBlockId: 's9-new-block',
    });
    const clean = sanitizeProgress(raw, { now: NOW });
    assert.ok(progressContentEqual(clean, raw));
  });

  it('drops malformed keys and values', () => {
    const long = `a${'b'.repeat(80)}`;
    const clean = sanitizeProgress({
      v: 1,
      seen: ['ok', 'Bad', '-x', long, 'a/b', 7],
      answers: {
        'b1/q1': answer(1, false, ['a', 'A!', long], false),
        'noslash': answer(1, true, ['a'], true),
        'a/b/c': answer(1, true, ['a'], true),
        'b1/Q': answer(1, true, ['a'], true),
      },
      checks: { 'checklist:c/i': true, 'checklist:c': true, ':c/i': true, 'Check:c/i': true, 'checklist:c/i/j': true },
      ratings: { o1: 2, 'O 2': 3, lesson: 1 },
      lastBlockId: 'Not An Id',
      updatedAt: at(0),
      summary: { pct: 100, state: 'mastered' },
    }, { now: NOW });
    assert.deepEqual(clean.seen, ['ok']);
    assert.deepEqual(Object.keys(clean.answers), ['b1/q1']);
    assert.deepEqual(clean.answers['b1/q1'].chosen, ['a']);
    assert.deepEqual(clean.checks, { 'checklist:c/i': true });
    assert.deepEqual(clean.ratings, { o1: 2, lesson: 1 });
    assert.equal(clean.lastBlockId, null);
    assert.equal(clean.summary, undefined, 'the summary is derived: dropped');
  });

  it('drops attempts-0 records that were not revealed, and keeps firstTry/correct only with an attempt', () => {
    const clean = sanitizeProgress(record({
      answers: {
        'b/q1': answer(0, true, ['a'], true),
        'b/q2': answer(0, true, [], true, true),
        'b/q3': answer(2, false, ['c'], true),
      },
    }), { now: NOW });
    assert.deepEqual(Object.keys(clean.answers), ['b/q2', 'b/q3']);
    assert.deepEqual(clean.answers['b/q2'], answer(0, false, [], false, true));
    assert.deepEqual(clean.answers['b/q3'], answer(2, false, ['c'], true));
  });

  it('caps every collection', () => {
    const ids = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const clean = sanitizeProgress(record({
      seen: ids(PROGRESS_LIMITS.seen + 5, 'b'),
      answers: Object.fromEntries(ids(PROGRESS_LIMITS.answers + 5, 'q').map((q) => [`blk/${q}`, answer(500, false, ids(20, 'o'), false)])),
      checks: Object.fromEntries(ids(PROGRESS_LIMITS.checks + 5, 'i').map((i) => [`checklist:c/${i}`, true])),
      ratings: Object.fromEntries(ids(PROGRESS_LIMITS.ratings + 5, 'o').map((o) => [o, 2])),
    }), { now: NOW });
    assert.equal(clean.seen.length, PROGRESS_LIMITS.seen);
    assert.equal(Object.keys(clean.answers).length, PROGRESS_LIMITS.answers);
    assert.equal(Object.keys(clean.checks).length, PROGRESS_LIMITS.checks);
    assert.equal(Object.keys(clean.ratings).length, PROGRESS_LIMITS.ratings);
    const first = clean.answers['blk/q0'];
    assert.equal(first.attempts, PROGRESS_LIMITS.attempts);
    assert.equal(first.chosen.length, PROGRESS_LIMITS.chosen);
  });

  it('re-serialises timestamps: invalid → epoch 0, clamped to now + 5 minutes', () => {
    const clean = (updatedAt, editedAt) => sanitizeProgress(record({ updatedAt, ...(editedAt === undefined ? {} : { editedAt }) }), { now: NOW });
    assert.equal(clean('2026-10-23T11:00:00+09:00').updatedAt, '2026-10-23T02:00:00.000Z');
    assert.equal(clean('not a date').updatedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(clean('').updatedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(clean('-001000-01-01T00:00:00Z').updatedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(clean(at(60)).updatedAt, new Date(NOW + MAX_CLOCK_SKEW_MS).toISOString());
    assert.equal(clean(at(0), 'garbage').editedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(clean(at(0), at(30)).editedAt, new Date(NOW + MAX_CLOCK_SKEW_MS).toISOString());
    assert.equal(clean(at(0)).editedAt, undefined);
    assert.equal(sanitizeProgress({ v: 1, updatedAt: 12 }, { now: NOW }).updatedAt, '1970-01-01T00:00:00.000Z');
  });

  it('turns anything that is not a v1 record into empty progress', () => {
    for (const raw of [null, '', '{bad', 42, [], { v: 2, seen: ['a'] }]) {
      assert.deepEqual(sanitizeProgress(raw, { now: NOW }), emptyProgress(), JSON.stringify(raw));
    }
  });
});

describe('mergeProgress', () => {
  it('unions seen (server order first) and keeps answers only one side has', () => {
    const server = record({ seen: ['a', 'b'], answers: { 'x/1': answer(1, true, ['a'], true) } });
    const client = record({ seen: ['c', 'b'], answers: { 'x/2': answer(1, false, ['b'], false) } });
    const merged = mergeProgress(server, client);
    assert.deepEqual(merged.seen, ['a', 'b', 'c']);
    assert.deepEqual(Object.keys(merged.answers).sort(), ['x/1', 'x/2']);
    assert.equal(merged.summary, undefined);
  });

  it('a correct server answer is final; only revealed is OR-ed in', () => {
    const server = record({ answers: { 'x/1': answer(1, true, ['b'], true) } });
    const client = record({ updatedAt: at(10), answers: { 'x/1': answer(2, false, ['c'], false, true) } });
    assert.deepEqual(mergeProgress(server, client).answers['x/1'], answer(1, true, ['b'], true, true));
  });

  it('otherwise takes the side with more attempts, a tie from the server, firstTry from the server (K12)', () => {
    const tie = mergeProgress(
      record({ answers: { 'x/1': answer(1, false, ['a'], false) } }),
      record({ updatedAt: at(10), answers: { 'x/1': answer(1, true, ['b'], true) } }),
    );
    assert.deepEqual(tie.answers['x/1'], answer(1, false, ['a'], false), 'tie → the server record, coherent');
    const more = mergeProgress(
      record({ answers: { 'x/1': answer(1, false, ['a'], false) } }),
      record({ answers: { 'x/1': answer(2, true, ['b'], true) } }),
    );
    assert.deepEqual(more.answers['x/1'], answer(2, true, ['b'], false), 'firstTry stays the server\'s first submission');
    const shownOnServer = mergeProgress(
      record({ answers: { 'x/1': answer(0, false, [], false, true) } }),
      record({ answers: { 'x/1': answer(1, true, ['b'], true) } }),
    );
    assert.deepEqual(shownOnServer.answers['x/1'], answer(1, true, ['b'], true, true), 'no server attempt: the client firstTry');
  });

  it('checks and ratings: the newer editedAt wins per key, keys from one side are kept (K15)', () => {
    const server = record({
      updatedAt: at(5),
      editedAt: at(1),
      checks: { 'checklist:c/1': true, 'checklist:c/2': true, 'card:f/1': true },
      ratings: { o1: 1 },
    });
    const client = record({
      updatedAt: at(2),
      editedAt: at(2),
      checks: { 'checklist:c/1': false, 'step:s/1': true },
      ratings: { o1: 3, lesson: 2 },
    });
    const merged = mergeProgress(server, client);
    assert.deepEqual(merged.checks, { 'checklist:c/1': false, 'checklist:c/2': true, 'card:f/1': true, 'step:s/1': true });
    assert.deepEqual(merged.ratings, { o1: 3, lesson: 2 });
    assert.equal(merged.updatedAt, at(5));
    assert.equal(merged.editedAt, at(2));
    // A passive write (seen/resume) moves only updatedAt and does not win over an edit.
    const passive = mergeProgress(client, { ...server, updatedAt: at(9) });
    assert.equal(passive.checks['checklist:c/1'], false, 'the older edit clock loses even with a newer updatedAt');
  });

  it('falls back to updatedAt as the edit clock, and keeps the server value on a tie', () => {
    const server = record({ updatedAt: at(3), checks: { k: true } });
    assert.equal(mergeProgress(server, record({ updatedAt: at(4), checks: { k: false } })).checks.k, false);
    assert.equal(mergeProgress(server, record({ updatedAt: at(3), checks: { k: false } })).checks.k, true);
  });

  it('lastBlockId comes from the side with the newer updatedAt', () => {
    const server = record({ updatedAt: at(1), lastBlockId: 's1' });
    assert.equal(mergeProgress(server, record({ updatedAt: at(2), lastBlockId: null })).lastBlockId, null);
    assert.equal(mergeProgress(server, record({ updatedAt: at(0), lastBlockId: 's9' })).lastBlockId, 's1');
    assert.equal(mergeProgress(server, record({ updatedAt: at(1), lastBlockId: 's9' })).lastBlockId, 's1', 'tie → server');
  });

  it('with no server record returns a copy of the client record without its summary', () => {
    const client = record({
      seen: ['a'],
      answers: { 'x/1': answer(1, true, ['a'], true) },
      checks: { k: true },
      ratings: { o1: 2 },
      editedAt: at(-1),
      summary: { pct: 10, state: 'in_progress' },
    });
    const merged = mergeProgress(null, client);
    const { summary, ...rest } = client;
    assert.deepEqual(merged, rest);
    assert.notEqual(merged.answers['x/1'], client.answers['x/1']);
    assert.ok(summary);
  });

  it('never loses information: the merge contains both sides (every published lesson shape)', () => {
    for (const { lesson } of LESSONS) {
      const index = lessonIndex(lesson);
      const keys = [...index.questions.keys()];
      const blocks = [...index.blockIds];
      const server = record({ seen: blocks.filter((_, i) => i % 2 === 0), answers: Object.fromEntries(keys.filter((_, i) => i % 2 === 0).map((k) => [k, answer(1, false, ['a'], false)])) });
      const client = record({ updatedAt: at(1), seen: blocks.filter((_, i) => i % 3 === 0), answers: Object.fromEntries(keys.filter((_, i) => i % 3 === 0).map((k) => [k, answer(1, true, ['b'], true)])) });
      const merged = mergeProgress(server, client);
      assert.deepEqual(new Set(merged.seen), new Set([...server.seen, ...client.seen]));
      assert.deepEqual(new Set(Object.keys(merged.answers)), new Set([...Object.keys(server.answers), ...Object.keys(client.answers)]));
      assert.ok(lessonPct(lesson, merged) >= Math.max(lessonPct(lesson, server), lessonPct(lesson, client)), lesson.id);
      // Merging again changes nothing (idempotent), so a re-sent record is not "new".
      assert.ok(progressContentEqual(mergeProgress(merged, client), merged), lesson.id);
    }
  });
});

describe('progressContentEqual', () => {
  const base = record({
    seen: ['a', 'b'],
    answers: { 'x/1': answer(1, false, ['a', 'c'], false) },
    checks: { k: true },
    ratings: { o1: 2 },
    lastBlockId: 'b',
  });

  it('ignores timestamps, the summary, seen order and chosen order', () => {
    assert.ok(progressContentEqual(base, { ...base, updatedAt: at(9), editedAt: at(9), summary: { pct: 50, state: 'read' } }));
    assert.ok(progressContentEqual(base, { ...base, seen: ['b', 'a'], answers: { 'x/1': answer(1, false, ['c', 'a'], false) } }));
    assert.ok(progressContentEqual({ ...base, ratings: undefined }, { ...base, ratings: {} }));
  });

  it('sees every content change', () => {
    const changes = [
      { seen: ['a'] },
      { lastBlockId: null },
      { answers: {} },
      { answers: { 'x/1': answer(2, false, ['a', 'c'], false) } },
      { answers: { 'x/1': answer(1, true, ['a', 'c'], false) } },
      { answers: { 'x/1': answer(1, false, ['a'], false) } },
      { answers: { 'x/1': answer(1, false, ['a', 'c'], false, true) } },
      { checks: { k: false } },
      { checks: { k: true, j: true } },
      { ratings: { o1: 3 } },
      { ratings: undefined },
    ];
    for (const change of changes) {
      assert.equal(progressContentEqual(base, { ...base, ...change }), false, JSON.stringify(change));
      assert.equal(progressContentEqual({ ...base, ...change }, base), false, JSON.stringify(change));
    }
  });
});
