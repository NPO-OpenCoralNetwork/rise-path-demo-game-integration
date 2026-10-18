// @ts-check
/**
 * Pedagogy and readability lint for risepath.lesson/v1 (PLAN §5.4 / §7.2 lesson contract).
 * Run it on a lesson that already passed validateLesson. Results are warnings; the CLI's
 * `--strict` turns them into a failing exit code.
 *
 * @typedef {import('./schema.js').Lesson} Lesson
 * @typedef {import('./schema.js').Section} Section
 * @typedef {import('./schema.js').Locale} Locale
 * @typedef {import('./schema.js').LText} LText
 * @typedef {{ rule: string, path: string, message: string }} LintWarning
 */
import { forEachBlock, forEachLessonText, formatPath } from './walk.js';
import { LOCALE_KEYS } from './text.js';

/** Rule id → what it enforces. */
export const LINT_RULES = /** @type {const} */ ({
  'objectives-count': 'A lesson has 2–4 objectives.',
  'objective-unassessed': 'Every objective is assessed by at least one quiz question.',
  'hook-missing': 'The first section is a hook (role "hook").',
  'inline-quiz-density': 'At least one inline quiz per 2 content sections, and never 3 content sections in a row without one.',
  'quiz-feedback': 'Every wrong option has feedback that corrects the misconception.',
  'feedback-length': 'Option feedback is at most 2 sentences.',
  'summary-missing': 'The last section contains a summary block.',
  'summary-points': 'A summary has 3–5 points.',
  'flashcards-count': 'A lesson has 4–8 flashcards.',
  'paragraph-length': 'A paragraph is at most 160 JP characters or 80 EN/FR words.',
  'sentence-length': 'A JP sentence is at most 60 characters.',
  'callout-count': 'At most 2 callouts per section.',
  'list-length': 'A list has at most 7 items.',
  'list-definitions': '"**Label**: description" lists are definitions blocks.',
  'table-columns': 'A table has at most 6 columns.',
  'code-filename': 'Code blocks have a filename.',
  'code-length': 'Inline code is at most 25 lines.',
  'code-should-be-prompt': 'Instructions to an AI (lang markdown/text, or a "prompt" filename) use a prompt block.',
  'diagram-caption': 'Diagrams have a caption.',
  'image-decorative': 'No decorative or stock-photo images inside a lesson.',
  'steps-length': 'A steps block has at most 8 steps.',
  'steps-expect': 'Every step states its expected result.',
  'banned-phrase': 'No pressuring phrases (「簡単です」「誰でも」, "simply", "obviously").',
  'locale-plain-string': 'In a multi-locale lesson, learner-facing text is an object with every locale, not a plain string.',
});

/** Sections that are not "content" for the check-density rule. */
const NON_CONTENT_ROLES = new Set(['hook', 'check', 'summary', 'reflection']);

const BANNED = {
  jp: ['簡単です', '簡単でしょう', '簡単にできます', '誰でも'],
  en: ['simply', 'obviously', "it's easy", 'it is easy', 'anyone can'],
  fr: ['simplement', 'évidemment', "c'est facile", "n'importe qui"],
};

const STOCK_IMAGE_HOST = /(^|\/\/|\.)(unsplash\.com|pexels\.com|pixabay\.com|shutterstock\.com|istockphoto\.com)/i;
const LABEL_ITEM = /^\s*\*\*[^*]+\*\*\s*[:：]\s*\S/;

/**
 * Plain text of an inline-markdown string, for length counts.
 *
 * @param {string} md
 * @returns {string}
 */
export function stripInlineMarkdown(md) {
  return md
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .trim();
}

/**
 * @param {LText} text
 * @param {Locale} sourceLocale
 * @returns {[Locale, string][]}
 */
function entries(text, sourceLocale) {
  if (typeof text === 'string') return [[sourceLocale, text]];
  return LOCALE_KEYS.flatMap((key) => (typeof text[key] === 'string' ? [[key, /** @type {string} */ (text[key])]] : []));
}

/**
 * @param {string} value
 * @returns {number}
 */
const charCount = (value) => [...value.replace(/\s+/g, '')].length;
/**
 * @param {string} value
 * @returns {number}
 */
const wordCount = (value) => value.split(/\s+/).filter(Boolean).length;

/**
 * @param {string} value
 * @param {Locale} locale
 * @returns {string[]}
 */
function sentences(value, locale) {
  const parts = locale === 'jp' ? value.split(/(?<=[。！？!?])|\n/) : value.split(/(?<=[.!?])\s+|\n/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Lints a validated lesson.
 *
 * @param {Lesson} lesson
 * @returns {{ warnings: LintWarning[] }}
 */
export function lintLesson(lesson) {
  /** @type {LintWarning[]} */
  const warnings = [];
  /**
   * @param {keyof typeof LINT_RULES} rule
   * @param {(string | number)[] | string} path
   * @param {string} message
   */
  const warn = (rule, path, message) => warnings.push({ rule, path: typeof path === 'string' ? path : formatPath(path), message });
  const source = lesson.locale;
  const multiLocale = (lesson.locales || [lesson.locale]).length > 1;

  // --- Objectives and alignment ---
  const objectiveCount = lesson.objectives.length;
  if (objectiveCount < 2 || objectiveCount > 4) warn('objectives-count', 'objectives', `${objectiveCount} objectives; write 2–4 observable ones.`);

  /** @type {Set<string>} */
  const assessed = new Set();
  let flashcards = 0;
  forEachBlock(lesson, (block) => {
    if (block.type === 'quiz' && block.mode !== 'predict') {
      block.questions.forEach((q) => { if (q.objectiveId) assessed.add(q.objectiveId); });
    }
    if (block.type === 'flashcards') flashcards += block.cards.length;
  });
  lesson.objectives.forEach((o, i) => {
    if (!assessed.has(o.id)) warn('objective-unassessed', ['objectives', i], `Objective "${o.id}" is not assessed by any quiz question.`);
  });

  // --- Lesson shape ---
  const sections = lesson.sections;
  if (sections[0] && sections[0].role !== 'hook') warn('hook-missing', ['sections', 0, 'role'], 'Start with a hook section (a problem and an ungraded prediction question).');

  /** @param {Section} section */
  const hasInlineQuiz = (section) => section.blocks.some((b) => b.type === 'quiz' && b.mode === 'inline');
  const content = sections.map((s, i) => ({ s, i })).filter(({ s }) => !NON_CONTENT_ROLES.has(s.role || 'concept'));
  const inlineCount = content.filter(({ s }) => hasInlineQuiz(s)).length;
  const needed = Math.ceil(content.length / 2);
  if (content.length > 0 && inlineCount < needed) {
    warn('inline-quiz-density', 'sections', `${inlineCount} of ${content.length} content sections have an inline quiz; at least ${needed} should.`);
  }
  let run = 0;
  for (const { s, i } of content) {
    run = hasInlineQuiz(s) ? 0 : run + 1;
    if (run === 3) warn('inline-quiz-density', ['sections', i], 'Three content sections in a row without an inline quiz.');
  }

  const last = sections[sections.length - 1];
  if (!last || !last.blocks.some((b) => b.type === 'summary')) {
    warn('summary-missing', ['sections', sections.length - 1], 'The last section needs a summary block (3–5 key points).');
  }
  if (flashcards < 4 || flashcards > 8) warn('flashcards-count', 'sections', `${flashcards} flashcards; a lesson has 4–8.`);

  // --- Blocks ---
  sections.forEach((section, si) => {
    const callouts = section.blocks.filter((b) => b.type === 'callout').length;
    if (callouts > 2) warn('callout-count', ['sections', si], `${callouts} callouts in one section; keep at most 2.`);
  });

  forEachBlock(lesson, (block, path) => {
    switch (block.type) {
      case 'list': {
        if (block.items.length > 7) warn('list-length', [...path, 'items'], `${block.items.length} items; split lists longer than 7.`);
        const labelled = block.items.every((item) => entries(item, source).every(([, value]) => LABEL_ITEM.test(value)));
        if (labelled && block.style !== 'number') warn('list-definitions', path, 'Every item is "**Label**: description"; use a definitions block.');
        break;
      }
      case 'table':
        if (block.columns.length > 6) warn('table-columns', [...path, 'columns'], `${block.columns.length} columns; keep at most 6.`);
        break;
      case 'code': {
        if (!block.filename) warn('code-filename', path, 'Add a filename to the code block.');
        const lines = block.code.split('\n').length;
        if (lines > 25) warn('code-length', [...path, 'code'], `${lines} lines; keep inline code within 25 lines.`);
        if (/^(markdown|md|text|txt|plaintext|prompt)$/i.test(block.lang) || /prompt|プロンプト/i.test(block.filename || '')) {
          warn('code-should-be-prompt', path, 'This looks like an instruction to an AI; use a prompt block.');
        }
        break;
      }
      case 'diagram':
        if (block.caption === undefined) warn('diagram-caption', path, 'Add a caption ("図n" is added by the reader).');
        break;
      case 'image':
        if (block.decorative || STOCK_IMAGE_HOST.test(block.src)) {
          warn('image-decorative', path, 'Lessons use teaching images only (screenshots, diagrams); decorative images belong on the course cover.');
        }
        break;
      case 'quiz':
        block.questions.forEach((q, qi) => {
          if (block.mode === 'predict') return;
          q.options.forEach((o, oi) => {
            if (q.answer.includes(o.id)) return;
            if (o.feedback === undefined) {
              warn('quiz-feedback', [...path, 'questions', qi, 'options', oi], `Wrong option "${o.id}" has no feedback.`);
              return;
            }
            for (const [locale, value] of entries(o.feedback, source)) {
              const count = sentences(stripInlineMarkdown(value), locale).length;
              if (count > 2) warn('feedback-length', [...path, 'questions', qi, 'options', oi, 'feedback', locale], `${count} sentences; correct the misconception in at most 2.`);
            }
          });
        });
        break;
      case 'summary':
        if (block.points.length < 3 || block.points.length > 5) warn('summary-points', [...path, 'points'], `${block.points.length} points; a summary has 3–5.`);
        break;
      case 'steps':
        if (block.items.length > 8) warn('steps-length', [...path, 'items'], `${block.items.length} steps; keep at most 8 per block.`);
        block.items.forEach((step, i) => {
          if (step.expect === undefined) warn('steps-expect', [...path, 'items', i], 'Say what the learner should see after this step (expect).');
        });
        break;
      default:
        break;
    }
  });

  // --- Text ---
  forEachLessonText(lesson, ({ text, path, kind }) => {
    if (kind === 'verbatim') return;
    if (multiLocale && typeof text === 'string') {
      warn('locale-plain-string', path, `Plain string in a ${(lesson.locales || []).join('/')} lesson; give every locale.`);
    }
    for (const [locale, value] of entries(text, source)) {
      const lower = value.toLowerCase();
      for (const phrase of BANNED[locale]) {
        const hit = locale === 'jp' ? value.includes(phrase) : new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower);
        if (hit) warn('banned-phrase', [...path, locale], `Avoid "${phrase}".`);
      }
      if (kind !== 'prose') continue;
      for (const paragraph of value.split(/\n\s*\n/)) {
        const plain = stripInlineMarkdown(paragraph);
        if (locale === 'jp') {
          const chars = charCount(plain);
          if (chars > 160) warn('paragraph-length', [...path, locale], `Paragraph is ${chars} characters; keep it within 160.`);
          for (const sentence of sentences(plain, locale)) {
            const n = charCount(sentence);
            if (n > 60) warn('sentence-length', [...path, locale], `Sentence is ${n} characters (max 60): 「${[...sentence].slice(0, 20).join('')}…」`);
          }
        } else {
          const words = wordCount(plain);
          if (words > 80) warn('paragraph-length', [...path, locale], `Paragraph is ${words} words; keep it within 80.`);
        }
      }
    }
  });

  return { warnings };
}
