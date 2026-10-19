// @ts-check
/**
 * Traversal helpers shared by the validator, the linter and the migration tests.
 * Knows which fields of each block are learner-facing text, so checks can treat prose,
 * labels and verbatim content (prompts, mermaid source) differently. No zod import.
 *
 * @typedef {import('./schema.js').Lesson} Lesson
 * @typedef {import('./schema.js').Course} Course
 * @typedef {import('./schema.js').Section} Section
 * @typedef {import('./schema.js').Block} Block
 * @typedef {import('./schema.js').LText} LText
 * @typedef {(string | number)[]} Path
 *
 * Text kinds:
 * - prose: paragraphs (paragraph and sentence length apply)
 * - label: titles, captions, alt text, column headers
 * - item: list items, definitions, summary points, cards, objectives
 * - question / option / feedback: quiz text
 * - verbatim: text that is copied or rendered as-is (prompt text, mermaid source)
 * @typedef {'prose' | 'label' | 'item' | 'question' | 'option' | 'feedback' | 'verbatim'} TextKind
 *
 * @typedef {{ text: LText, path: Path, kind: TextKind, section?: Section, block?: Block }} TextVisit
 */

/**
 * `['sections', 2, 'blocks', 0, 'answer', 0]` → `sections[2].blocks[0].answer[0]`.
 *
 * @param {readonly PropertyKey[]} path
 * @returns {string}
 */
export function formatPath(path) {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || '(root)';
}

/**
 * Calls `fn` for every block with its section and path.
 *
 * @param {Lesson} lesson
 * @param {(block: Block, path: Path, section: Section, sectionIndex: number, blockIndex: number) => void} fn
 */
export function forEachBlock(lesson, fn) {
  (lesson.sections || []).forEach((section, si) => {
    (section.blocks || []).forEach((block, bi) => {
      fn(block, ['sections', si, 'blocks', bi], section, si, bi);
    });
  });
}

/**
 * Lists the localized-text fields of one block.
 *
 * @param {Block} block
 * @param {Path} base
 * @returns {{ text: LText, path: Path, kind: TextKind }[]}
 */
export function blockTexts(block, base) {
  /** @type {{ text: LText, path: Path, kind: TextKind }[]} */
  const out = [];
  /**
   * @param {LText | undefined} text
   * @param {Path} rel
   * @param {TextKind} kind
   */
  const add = (text, rel, kind) => {
    if (text !== undefined && text !== null) out.push({ text, path: [...base, ...rel], kind });
  };
  add(block.narration, ['narration'], 'prose');
  switch (block.type) {
    case 'markdown':
      add(block.md, ['md'], 'prose');
      break;
    case 'callout':
      add(block.title, ['title'], 'label');
      add(block.md, ['md'], 'prose');
      break;
    case 'list':
      block.items.forEach((item, i) => add(item, ['items', i], 'item'));
      break;
    case 'definitions':
      block.items.forEach((item, i) => {
        add(item.term, ['items', i, 'term'], 'label');
        add(item.md, ['items', i, 'md'], 'item');
      });
      break;
    case 'table':
      add(block.caption, ['caption'], 'label');
      block.columns.forEach((col, i) => add(col, ['columns', i], 'label'));
      block.rows.forEach((row, r) => row.forEach((cell, c) => add(cell, ['rows', r, c], 'item')));
      break;
    case 'prompt':
      add(block.title, ['title'], 'label');
      add(block.prompt, ['prompt'], 'verbatim');
      (block.vars || []).forEach((v, i) => add(v.hint, ['vars', i, 'hint'], 'label'));
      add(block.expect, ['expect'], 'prose');
      add(block.note, ['note'], 'prose');
      break;
    case 'diagram':
      add(block.code, ['code'], 'verbatim');
      add(block.caption, ['caption'], 'label');
      add(block.alt, ['alt'], 'label');
      add(block.description, ['description'], 'prose');
      break;
    case 'image':
      add(block.alt, ['alt'], 'label');
      add(block.caption, ['caption'], 'label');
      break;
    case 'quiz':
      add(block.title, ['title'], 'label');
      block.questions.forEach((q, qi) => {
        add(q.prompt, ['questions', qi, 'prompt'], 'question');
        q.options.forEach((o, oi) => {
          add(o.md, ['questions', qi, 'options', oi, 'md'], 'option');
          add(o.feedback, ['questions', qi, 'options', oi, 'feedback'], 'feedback');
        });
        add(q.explanation, ['questions', qi, 'explanation'], 'feedback');
        add(q.hint, ['questions', qi, 'hint'], 'feedback');
      });
      break;
    case 'flashcards':
      block.cards.forEach((card, i) => {
        add(card.front, ['cards', i, 'front'], 'item');
        add(card.back, ['cards', i, 'back'], 'item');
      });
      break;
    case 'steps':
      block.items.forEach((step, i) => {
        add(step.title, ['items', i, 'title'], 'label');
        add(step.md, ['items', i, 'md'], 'prose');
        add(step.expect, ['items', i, 'expect'], 'prose');
        add(step.hint, ['items', i, 'hint'], 'prose');
        add(step.troubleshoot, ['items', i, 'troubleshoot'], 'prose');
      });
      break;
    case 'checklist':
      add(block.title, ['title'], 'label');
      block.items.forEach((item, i) => {
        add(item.label, ['items', i, 'label'], 'label');
        add(item.md, ['items', i, 'md'], 'prose');
      });
      break;
    case 'summary':
      add(block.title, ['title'], 'label');
      block.points.forEach((p, i) => add(p, ['points', i], 'item'));
      break;
    case 'askTutor':
      block.suggestions.forEach((s, i) => add(s, ['suggestions', i], 'label'));
      break;
    default:
      break;
  }
  return out;
}

/**
 * Calls `fn` for every localized text in a lesson (metadata, sections, blocks).
 *
 * @param {Lesson} lesson
 * @param {(visit: TextVisit) => void} fn
 */
export function forEachLessonText(lesson, fn) {
  fn({ text: lesson.title, path: ['title'], kind: 'label' });
  if (lesson.subtitle !== undefined) fn({ text: lesson.subtitle, path: ['subtitle'], kind: 'label' });
  (lesson.prerequisites || []).forEach((p, i) => fn({ text: p, path: ['prerequisites', i], kind: 'label' }));
  (lesson.objectives || []).forEach((o, i) => fn({ text: o.text, path: ['objectives', i, 'text'], kind: 'item' }));
  (lesson.glossary || []).forEach((g, i) => {
    fn({ text: g.term, path: ['glossary', i, 'term'], kind: 'label' });
    fn({ text: g.md, path: ['glossary', i, 'md'], kind: 'item' });
  });
  (lesson.sections || []).forEach((section, si) => {
    fn({ text: section.title, path: ['sections', si, 'title'], kind: 'label', section });
  });
  forEachBlock(lesson, (block, path, section) => {
    for (const visit of blockTexts(block, path)) fn({ ...visit, section, block });
  });
}

/**
 * Calls `fn` for every localized text in a course.
 *
 * @param {Course} course
 * @param {(visit: TextVisit) => void} fn
 */
export function forEachCourseText(course, fn) {
  fn({ text: course.title, path: ['title'], kind: 'label' });
  if (course.subtitle !== undefined) fn({ text: course.subtitle, path: ['subtitle'], kind: 'label' });
  if (course.description !== undefined) fn({ text: course.description, path: ['description'], kind: 'prose' });
  (course.glossary || []).forEach((g, i) => {
    fn({ text: g.term, path: ['glossary', i, 'term'], kind: 'label' });
    fn({ text: g.md, path: ['glossary', i, 'md'], kind: 'item' });
  });
  (course.modules || []).forEach((m, mi) => {
    fn({ text: m.title, path: ['modules', mi, 'title'], kind: 'label' });
    if (m.summary !== undefined) fn({ text: m.summary, path: ['modules', mi, 'summary'], kind: 'prose' });
    m.lessons.forEach((l, li) => fn({ text: l.title, path: ['modules', mi, 'lessons', li, 'title'], kind: 'label' }));
  });
}

/**
 * Counts used to compare a lesson with its legacy source and to report coverage:
 * one key per block type, plus table rows, quiz questions and flashcard cards.
 *
 * @param {Lesson} lesson
 * @returns {{ sections: number, blocks: number, tableRows: number, quizQuestions: number, cards: number } & Record<string, number>}
 */
export function lessonStats(lesson) {
  /** @type {{ sections: number, blocks: number, tableRows: number, quizQuestions: number, cards: number } & Record<string, number>} */
  const stats = { sections: (lesson.sections || []).length, blocks: 0, tableRows: 0, quizQuestions: 0, cards: 0 };
  forEachBlock(lesson, (block) => {
    stats.blocks += 1;
    stats[block.type] = (stats[block.type] || 0) + 1;
    if (block.type === 'table') stats.tableRows += block.rows.length;
    if (block.type === 'quiz') stats.quizQuestions += block.questions.length;
    if (block.type === 'flashcards') stats.cards += block.cards.length;
  });
  return stats;
}

/**
 * Lesson ids of a course in module order, used for next-link and file checks.
 *
 * @param {Course} course
 * @returns {string[]}
 */
export function courseLessonIds(course) {
  return (course.modules || []).flatMap((m) => m.lessons.map((l) => l.id));
}
