// Phase 6 stage 1 (design §1.6, §7.1 "checkKey = reader key"): shared/review/cards.js
// lessonReviewCards lists a lesson's review cards in lesson order with the in-lesson mark key the
// reader writes (components/lesson/blocks/FlashcardsBlock.tsx) and the progress index lists
// (shared/lesson/progressMerge.js lessonIndex). The queue enters a card on a mark by that key, so a
// different key would miss every marked card.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lessonReviewCards } from '../../shared/review/cards.js';
import { lessonIndex } from '../../shared/lesson/progressMerge.js';
import { ROOT, publishedLessons } from './helpers/publishedLessons.js';

const LESSONS = publishedLessons();
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/tests/fixtures/published-card-ids.json'), 'utf8'));

describe('lessonReviewCards', () => {
  it('a synthetic lesson: cards of every flashcards block in lesson order, other blocks ignored', () => {
    const lesson = /** @type {any} */ ({
      sections: [
        { id: 's1', blocks: [
          { id: 'intro', type: 'markdown', body: 'x' },
          { id: 'deck-a', type: 'flashcards', cards: [{ id: 'one', front: 'F1', back: 'B1' }, { id: 'two', front: { jp: 'F2', en: 'F2e' }, back: 'B2' }] },
        ] },
        { id: 's2', blocks: [{ id: 'q', type: 'quiz', questions: [] }] },
        { id: 's3', blocks: [{ id: 'deck-b', type: 'flashcards', cards: [{ id: 'three.v2', front: 'F3', back: 'B3' }] }] },
      ],
    });
    assert.deepEqual(lessonReviewCards(lesson), [
      { blockId: 'deck-a', cardId: 'one', checkKey: 'card:deck-a/one', front: 'F1', back: 'B1', order: 0 },
      { blockId: 'deck-a', cardId: 'two', checkKey: 'card:deck-a/two', front: { jp: 'F2', en: 'F2e' }, back: 'B2', order: 1 },
      { blockId: 'deck-b', cardId: 'three.v2', checkKey: 'card:deck-b/three.v2', front: 'F3', back: 'B3', order: 2 },
    ]);
    assert.deepEqual(lessonReviewCards(/** @type {any} */ ({ sections: [{ id: 's', blocks: [] }] })), []);
  });

  it('the reader writes the mark of a card as card:<block id>/<card id>', () => {
    const reader = fs.readFileSync(path.join(ROOT, 'components/lesson/blocks/FlashcardsBlock.tsx'), 'utf8');
    assert.match(reader, /const key = \(cardId: string\) => `card:\$\{block\.id\}\/\$\{cardId\}`;/);
  });

  it('every published lesson: the checkKeys equal the card: keys of lessonIndex, in the same order', () => {
    let total = 0;
    for (const { course, lesson } of LESSONS) {
      const cards = lessonReviewCards(lesson);
      const indexKeys = [...lessonIndex(lesson).checkKeys].filter((key) => key.startsWith('card:'));
      assert.deepEqual(cards.map((card) => card.checkKey), indexKeys, `${course}/${lesson.id}`);
      assert.deepEqual(cards.map((card) => card.order), cards.map((_, k) => k), `${course}/${lesson.id} order`);
      assert.equal(new Set(cards.map((card) => card.cardId)).size, cards.length, `${course}/${lesson.id}: card ids are unique in the lesson`);
      for (const card of cards) {
        const block = lesson.sections.flatMap((s) => s.blocks).find((b) => b.id === card.blockId);
        const source = block.cards.find((c) => c.id === card.cardId);
        assert.equal(card.front, source.front);
        assert.equal(card.back, source.back);
      }
      total += cards.length;
    }
    // 92 cards at Phase 6 (design §7.1). The count lives only in the card-id fixture: a new card
    // goes into its published list (reviewCardIds.test.js says so when one is missing).
    assert.equal(total, fixture.published.length, `the published lessons have ${total} cards; fixture published has ${fixture.published.length}: update fixtures/published-card-ids.json`);
  });
});
