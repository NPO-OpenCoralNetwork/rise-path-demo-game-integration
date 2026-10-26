// Phase 6 stage 1 (design §3.8, §7.1 "Published card ids stable"): a learner's review memory is
// keyed by (course, lesson, card id). Card text may change under a kept id (the memory stays), but
// a removed or renamed card id, or an unpublished lesson, hides that memory. This test pins the
// card ids of the published lessons (the server catalog, tools/core/courseCatalog.js, the same
// list the review queue uses) to fixtures/published-card-ids.json, so such a change cannot pass CI
// silently: the owner restores the id, or moves the key to "retired" on purpose.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clearCatalogCacheForTests, listPublishedLessons } from '../../tools/core/courseCatalog.js';
import { lessonReviewCards } from '../../shared/review/cards.js';
import { CARD_ID } from '../../tools/core/reviewQueue.js';
import { ROOT } from './helpers/publishedLessons.js';

const FIXTURE = 'server/tests/fixtures/published-card-ids.json';
/**
 * <course slug>/<lesson id>/<card id>: the course slug and lesson id as the lesson_progress CHECKs
 * (migration 016, SAFE_SLUG), then a card id as CARD_ID (tools/core/reviewQueue.js: the lesson
 * schema's ID_PATTERN, at most 80 characters), which server/tests/migration020.test.js pins to
 * migration 020's card_id CHECK. The review catalog leaves out (and logs) a card id outside it, so a
 * published card that fails here never reaches a learner's queue.
 */
const SLUG_PART = '[a-z0-9][a-z0-9-]{0,79}';
const CARD_KEY = new RegExp(`^${SLUG_PART}/${SLUG_PART}/${CARD_ID.source.replace(/^\^|\$$/g, '')}$`);

/**
 * What changed between the current card keys and the fixture, as failure messages.
 * @param {Iterable<string>} current
 * @param {{ published: string[], retired: string[] }} fixture
 * @returns {string[]}
 */
function cardIdChanges(current, { published, retired }) {
  const now = new Set(current);
  const pinned = new Set(published);
  const gone = new Set(retired);
  const messages = [];
  for (const key of published) {
    if (!now.has(key)) {
      messages.push(`${key}: card removed or renamed: learners' review memory for it is hidden; restore the id, or move it to retired on purpose`);
    }
  }
  for (const key of now) {
    if (pinned.has(key)) continue;
    messages.push(gone.has(key)
      ? `${key}: a retired card id is back (learners' old review memory for it returns): move it from retired to published`
      : `${key}: new card: add the new card id to published in ${FIXTURE}`);
  }
  return messages;
}

/** Current card keys of the server catalog, in catalog order. */
const currentKeys = () => listPublishedLessons()
  .flatMap((entry) => lessonReviewCards(entry.lesson).map((card) => `${entry.courseSlug}/${entry.lesson.id}/${card.cardId}`));

describe('cardIdChanges (the guard itself)', () => {
  const fixture = { published: ['c/l/a', 'c/l/b'], retired: ['c/l/old'] };

  it('accepts the same keys in any order', () => {
    assert.deepEqual(cardIdChanges(['c/l/b', 'c/l/a'], fixture), []);
  });

  it('flags a removed or renamed card, a new card and a retired card that is back', () => {
    const messages = cardIdChanges(['c/l/a', 'c/l/b2', 'c/l/old'], fixture);
    assert.equal(messages.length, 3);
    assert.match(messages[0], /^c\/l\/b: card removed or renamed: learners' review memory for it is hidden; restore the id, or move it to retired on purpose$/);
    assert.match(messages[1], /^c\/l\/b2: new card: add the new card id to published/);
    assert.match(messages[2], /^c\/l\/old: a retired card id is back/);
  });

  it('a card of an unpublished lesson reads as removed', () => {
    assert.deepEqual(cardIdChanges(['c/l/a'], fixture).length, 1);
  });
});

describe('the key pattern', () => {
  it('is built from CARD_ID: course/lesson/card, each part at most 80 characters', () => {
    assert.equal(CARD_KEY.source, String.raw`^[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9][a-z0-9._-]{0,79}$`);
    assert.match(`c/l/${'a'.repeat(80)}`, CARD_KEY);
    assert.doesNotMatch(`c/l/${'a'.repeat(81)}`, CARD_KEY);
    assert.doesNotMatch('c/l/Card', CARD_KEY);
  });
});

describe('published card ids are stable', () => {
  // The repository's content, never a test directory a caller may have set.
  delete process.env.RP_CONTENT_DIR;
  clearCatalogCacheForTests();
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8'));

  it('the fixture is { $comment, published, retired }: sorted, unique, disjoint, well-formed keys', () => {
    assert.deepEqual(Object.keys(fixture).sort(), ['$comment', 'published', 'retired']);
    for (const list of ['published', 'retired']) {
      const keys = fixture[list];
      assert.ok(Array.isArray(keys), list);
      for (const key of keys) {
        assert.match(key, CARD_KEY, `${list}: ${key}: course and lesson as SAFE_SLUG, card id as ID_PATTERN, each at most 80 characters (the database refuses others)`);
      }
      assert.deepEqual(keys, [...new Set(keys)].sort(), `${list} is sorted and has no duplicates`);
    }
    const retired = new Set(fixture.retired);
    assert.deepEqual(fixture.published.filter((key) => retired.has(key)), [], 'a key is either published or retired');
  });

  it('every card of the published lessons is in published, and every published key is still a card', () => {
    const current = currentKeys();
    assert.ok(current.length > 0, 'the catalog has review cards');
    assert.equal(new Set(current).size, current.length, 'card keys are unique');
    assert.deepEqual(cardIdChanges(current, fixture), []);
  });
});
