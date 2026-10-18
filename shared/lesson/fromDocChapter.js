// @ts-check
/**
 * Converts the legacy `DocChapter` + `QuizData` shapes (types.ts) into risepath.lesson/v1.
 * Mechanical: content is kept as written; only the structure changes.
 *
 * - text → markdown (lead/quote kept)
 * - list style "key", or a bullet list whose items are all "**Label**: …" → definitions
 * - mermaid → diagram (alt falls back to the caption)
 * - mindmap → diagram in mermaid "mindmap" syntax, one source per locale; node details
 *   become the diagram description
 * - code with lang markdown/text or a "Prompt" filename → prompt
 * - quiz → a final role:"check" section with an exam quiz
 * - block ids are s{n}-b{m}; provenance.migratedFrom records the source and its counts
 *
 * @typedef {import('./schema.js').Lesson} Lesson
 * @typedef {import('./schema.js').Section} Section
 * @typedef {import('./schema.js').Block} Block
 * @typedef {import('./schema.js').LText} LText
 * @typedef {import('./schema.js').Locale} Locale
 *
 * Legacy shapes (types.ts, kept loose on purpose):
 * @typedef {string | { en?: string, jp?: string, fr?: string }} LegacyText
 * @typedef {{ type: string, [key: string]: any }} LegacyBlock
 * @typedef {{ id: string, title: LegacyText, content: LegacyBlock[] }} LegacySection
 * @typedef {{ id: string, title: LegacyText, subtitle?: LegacyText, readingTime?: LegacyText, sections: LegacySection[] }} DocChapter
 * @typedef {{ id: string, text: LegacyText, options: { id: string, text: LegacyText }[], correctAnswer: string, explanation: LegacyText }} LegacyQuestion
 * @typedef {{ id: string, title: LegacyText, questions: LegacyQuestion[] }} QuizData
 */
import { ID_PATTERN, LESSON_SCHEMA_ID } from './constants.js';
import { LOCALE_KEYS } from './text.js';

const LABEL_ITEM = /^\s*\*\*(.+?)\*\*\s*[:：]\s*([\s\S]+)$/;
const PROMPT_LANGS = /^(markdown|md|text|txt|plaintext|prompt)$/i;

/**
 * Normalizes a legacy text: keeps strings, orders object keys jp/en/fr and drops empty ones.
 *
 * @param {LegacyText | undefined | null} text
 * @returns {LText | undefined}
 */
export function normText(text) {
  if (text === undefined || text === null) return undefined;
  if (typeof text === 'string') return text;
  /** @type {{ jp?: string, en?: string, fr?: string }} */
  const out = {};
  for (const key of LOCALE_KEYS) {
    const value = text[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

/**
 * @param {LegacyText | undefined} text
 * @returns {Locale[]}
 */
function localesOf(text) {
  if (!text || typeof text === 'string') return [];
  return LOCALE_KEYS.filter((key) => typeof text[key] === 'string' && text[key] !== '');
}

/**
 * @param {LegacyText} text
 * @param {(value: string, locale: Locale | null) => string} fn
 * @returns {LText}
 */
function mapText(text, fn) {
  if (typeof text === 'string') return fn(text, null);
  /** @type {{ jp?: string, en?: string, fr?: string }} */
  const out = {};
  for (const key of LOCALE_KEYS) {
    const value = text[key];
    if (typeof value === 'string' && value !== '') out[key] = fn(value, key);
  }
  return out;
}

/**
 * Splits "**Label**: description" in every locale, or returns null when any locale doesn't match.
 *
 * @param {LegacyText} item
 * @returns {{ term: LText, md: LText } | null}
 */
function splitLabelItem(item) {
  const values = typeof item === 'string' ? [item] : LOCALE_KEYS.map((k) => item[k]).filter((v) => typeof v === 'string' && v !== '');
  if (values.length === 0 || !values.every((v) => LABEL_ITEM.test(/** @type {string} */ (v)))) return null;
  return {
    term: mapText(item, (v) => /** @type {RegExpMatchArray} */ (v.match(LABEL_ITEM))[1].trim()),
    md: mapText(item, (v) => /** @type {RegExpMatchArray} */ (v.match(LABEL_ITEM))[2].trim()),
  };
}

/**
 * Mermaid mindmap label: quoted so parentheses and brackets are not read as node shapes.
 *
 * @param {string} label
 */
const mindmapLabel = (label) => `"${label.replace(/"/g, "'").replace(/\s+/g, ' ').trim()}"`;

/**
 * @param {any} root legacy mindmap root
 * @param {Locale | null} locale
 * @returns {string}
 */
function mindmapSource(root, locale) {
  /** @param {LegacyText} t */
  const pick = (t) => (typeof t === 'string' ? t : (locale && t[locale]) || t.jp || t.en || '');
  const lines = ['mindmap', `  root((${mindmapLabel(pick(root.text))}))`];
  let n = 0;
  /**
   * @param {any[]} children
   * @param {number} depth
   */
  const walk = (children, depth) => {
    for (const child of children || []) {
      n += 1;
      lines.push(`${'  '.repeat(depth)}n${n}[${mindmapLabel(pick(child.text))}]`);
      walk(child.children, depth + 1);
    }
  };
  walk(root.children, 2);
  return lines.join('\n');
}

/**
 * @param {any} root legacy mindmap root
 * @param {Locale | null} locale
 * @returns {string}
 */
function mindmapDescription(root, locale) {
  /** @param {LegacyText} t */
  const pick = (t) => (typeof t === 'string' ? t : (locale && t[locale]) || t.jp || t.en || '');
  const lines = /** @type {string[]} */ ([]);
  /**
   * @param {any[]} children
   * @param {number} depth
   */
  const walk = (children, depth) => {
    for (const child of children || []) {
      const details = child.details ? `${locale === 'jp' ? '：' : ': '}${pick(child.details)}` : '';
      lines.push(`${'  '.repeat(depth)}- **${pick(child.text)}**${details}`);
      walk(child.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return lines.join('\n');
}

/**
 * @param {any} root legacy mindmap root
 * @returns {{ code: LText, caption: LText, alt: LText, description: LText }}
 */
function convertMindmap(root) {
  const locales = localesOf(root.text);
  /** @param {(locale: Locale | null) => string} fn */
  const perLocale = (fn) => {
    if (locales.length === 0) return fn(null);
    /** @type {{ jp?: string, en?: string, fr?: string }} */
    const out = {};
    for (const locale of locales) out[locale] = fn(locale);
    return out;
  };
  /**
   * @param {LegacyText} t
   * @param {Locale | null} locale
   */
  const pick = (t, locale) => (typeof t === 'string' ? t : (locale && t[locale]) || t.jp || t.en || '');
  const childNames = (/** @type {Locale | null} */ locale) => (root.children || []).map((/** @type {any} */ c) => pick(c.text, locale));
  return {
    code: perLocale((locale) => mindmapSource(root, locale)),
    caption: perLocale((locale) => (locale === 'jp' ? `${pick(root.text, locale)}の全体像` : `${pick(root.text, locale)}: overview`)),
    alt: perLocale((locale) => (locale === 'jp'
      ? `マインドマップ。中心は「${pick(root.text, locale)}」。枝は${childNames(locale).map((/** @type {string} */ c) => `「${c}」`).join('、')}。`
      : `Mind map centered on "${pick(root.text, locale)}" with branches: ${childNames(locale).join(', ')}.`)),
    description: perLocale((locale) => mindmapDescription(root, locale)),
  };
}

/**
 * @param {LegacyBlock} block
 * @param {string} id
 * @param {LegacySection} section
 * @returns {Block}
 */
function convertBlock(block, id, section) {
  switch (block.type) {
    case 'text':
      return {
        id,
        type: 'markdown',
        md: /** @type {LText} */ (normText(block.text)),
        ...(block.style === 'lead' || block.style === 'quote' ? { style: block.style } : {}),
      };
    case 'image': {
      const caption = normText(block.caption);
      return {
        id,
        type: 'image',
        src: block.src || block.fallbackSrc || '',
        alt: /** @type {LText} */ (normText(block.alt)),
        ...(caption !== undefined ? { caption } : {}),
        ...(block.layout === 'full' ? { layout: 'wide' } : {}),
      };
    }
    case 'code': {
      const filename = typeof block.filename === 'string' ? block.filename : undefined;
      if (PROMPT_LANGS.test(block.language || '') || /prompt/i.test(filename || '')) {
        return { id, type: 'prompt', ...(filename ? { title: filename } : {}), prompt: block.code };
      }
      return {
        id,
        type: 'code',
        lang: block.language || 'text',
        ...(filename ? { filename } : {}),
        code: block.code,
        ...(Array.isArray(block.highlightLines) && block.highlightLines.length > 0 ? { highlight: block.highlightLines } : {}),
      };
    }
    case 'list': {
      const items = /** @type {LegacyText[]} */ (block.items || []);
      if (block.style === 'key' || block.style === undefined || block.style === 'bullet') {
        const split = items.map(splitLabelItem);
        if (split.length > 0 && split.every(Boolean)) {
          return { id, type: 'definitions', items: /** @type {{ term: LText, md: LText }[]} */ (split) };
        }
      }
      return {
        id,
        type: 'list',
        ...(block.style === 'number' || block.style === 'check' ? { style: block.style } : {}),
        items: items.map((item) => /** @type {LText} */ (normText(item))),
      };
    }
    case 'callout': {
      const title = normText(block.title);
      return {
        id,
        type: 'callout',
        variant: block.variant || 'info',
        ...(title !== undefined ? { title } : {}),
        md: /** @type {LText} */ (normText(block.text)),
      };
    }
    case 'mermaid': {
      const caption = normText(block.caption);
      return {
        id,
        type: 'diagram',
        engine: 'mermaid',
        code: String(block.chart || '').replace(/[ \t]+$/gm, '').trim(),
        ...(caption !== undefined ? { caption } : {}),
        alt: /** @type {LText} */ (caption ?? normText(section.title)),
      };
    }
    case 'mindmap':
      return { id, type: 'diagram', engine: 'mermaid', ...convertMindmap(block.root) };
    case 'table':
      return {
        id,
        type: 'table',
        columns: (block.headers || []).map((/** @type {LegacyText} */ h) => /** @type {LText} */ (normText(h))),
        rows: (block.rows || []).map((/** @type {LegacyText[]} */ row) => row.map((cell) => /** @type {LText} */ (normText(cell)))),
      };
    default:
      throw new Error(`fromDocChapter: unsupported legacy block type "${block.type}" in section ${section.id}`);
  }
}

/**
 * Counts of a legacy chapter (and its quiz), stored in provenance.migratedFrom.counts.
 *
 * @param {DocChapter} chapter
 * @param {QuizData | null} [quiz]
 * @returns {Record<string, number>}
 */
export function docChapterStats(chapter, quiz = null) {
  /** @type {Record<string, number>} */
  const stats = { sections: chapter.sections.length, blocks: 0, tableRows: 0, quizQuestions: quiz ? quiz.questions.length : 0 };
  for (const section of chapter.sections) {
    for (const block of section.content) {
      stats.blocks += 1;
      stats[block.type] = (stats[block.type] || 0) + 1;
      if (block.type === 'table') stats.tableRows += (block.rows || []).length;
    }
  }
  return stats;
}

/**
 * @param {LegacyText | undefined} readingTime e.g. {en: '15 min read', jp: '15分で読める'}
 * @returns {number}
 */
function parseMinutes(readingTime) {
  const values = typeof readingTime === 'string' ? [readingTime] : Object.values(readingTime || {});
  for (const value of values) {
    const match = String(value).match(/(\d+)/);
    if (match) return Math.max(1, Math.min(600, Number(match[1])));
  }
  return 10;
}

/**
 * @param {DocChapter} chapter
 * @param {{
 *   quiz?: QuizData | null,
 *   courseId?: string,
 *   locale?: Locale,
 *   locales?: Locale[],
 *   source?: string,
 *   exportName?: string,
 *   quizSource?: string,
 *   quizExport?: string,
 *   author?: string,
 * }} [options]
 * @returns {Lesson}
 */
export function fromDocChapter(chapter, options = {}) {
  const { quiz = null, courseId, locale = 'jp', locales, source, exportName, quizSource, quizExport, author = 'migration' } = options;
  const declared = locales || /** @type {Locale[]} */ ([...new Set([locale, ...localesOf(chapter.title)])]);

  /** @type {Section[]} */
  const sections = chapter.sections.map((section, si) => ({
    id: ID_PATTERN.test(section.id) ? section.id : `s${si + 1}`,
    title: /** @type {LText} */ (normText(section.title)),
    role: 'concept',
    blocks: section.content.map((block, bi) => convertBlock(block, `s${si + 1}-b${bi + 1}`, section)),
  }));

  if (quiz && quiz.questions.length > 0) {
    const n = sections.length + 1;
    sections.push({
      id: 'check',
      title: /** @type {LText} */ (normText(quiz.title)),
      role: 'check',
      blocks: [{
        id: `s${n}-b1`,
        type: 'quiz',
        mode: 'exam',
        questions: quiz.questions.map((q) => ({
          id: q.id,
          kind: 'single',
          prompt: /** @type {LText} */ (normText(q.text)),
          options: q.options.map((o) => ({ id: o.id, md: /** @type {LText} */ (normText(o.text)) })),
          answer: [q.correctAnswer],
          explanation: /** @type {LText} */ (normText(q.explanation)),
        })),
      }],
    });
  }

  /** @type {Lesson} */
  const lesson = {
    schema: LESSON_SCHEMA_ID,
    id: chapter.id,
    ...(courseId ? { courseId } : {}),
    title: /** @type {LText} */ (normText(chapter.title)),
    ...(chapter.subtitle !== undefined ? { subtitle: normText(chapter.subtitle) } : {}),
    locale,
    locales: declared,
    estMinutes: parseMinutes(chapter.readingTime),
    objectives: [],
    sections,
    provenance: {
      author,
      ...(source ? {
        migratedFrom: {
          source,
          ...(exportName ? { export: exportName } : {}),
          ...(quiz && quizSource ? { quizSource } : {}),
          ...(quiz && quizExport ? { quizExport } : {}),
          counts: docChapterStats(chapter, quiz),
        },
      } : {}),
    },
  };
  return lesson;
}
