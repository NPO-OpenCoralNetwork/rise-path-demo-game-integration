// @ts-check
/**
 * The review cards of a lesson (Phase 6, doc/brushup-2026/ai-access-plan.ja.md §10): every card of
 * its flashcards blocks, in lesson order. A card's identity in the review queue is
 * (course, lesson, card id); the block id is not part of it (three block ids hold cards, and a
 * block rename keeps the memory). checkKey is the in-lesson mark's key, exactly what the reader's
 * FlashcardsBlock writes and shared/lesson/progressMerge.js lessonIndex lists:
 * `card:<blockId>/<cardId>`. Card text is returned as written (a string in lesson.locale or
 * { jp?, en? }); callers resolve it. No imports.
 */

/**
 * @typedef {import('../lesson/schema.js').Lesson} Lesson
 * @typedef {import('../lesson/schema.js').Md} Md
 *
 * @typedef {object} LessonReviewCard
 * @property {string} blockId the flashcards block
 * @property {string} cardId unique within the lesson
 * @property {string} checkKey `card:<blockId>/<cardId>`
 * @property {Md} front
 * @property {Md} back
 * @property {number} order position among the lesson's cards, from 0
 */

/**
 * Every review card of a lesson in lesson order (sections → blocks of type 'flashcards' → cards).
 * @param {Lesson} lesson
 * @returns {LessonReviewCard[]}
 */
export function lessonReviewCards(lesson) {
  /** @type {LessonReviewCard[]} */
  const out = [];
  for (const section of lesson.sections) {
    for (const block of section.blocks) {
      if (block.type !== 'flashcards') continue;
      for (const card of block.cards) {
        out.push({ blockId: block.id, cardId: card.id, checkKey: `card:${block.id}/${card.id}`, front: card.front, back: card.back, order: out.length });
      }
    }
  }
  return out;
}
