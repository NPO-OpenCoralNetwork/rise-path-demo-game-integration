/**
 * Pure helpers for the lesson reader: text resolution, title parsing, progress maths and
 * outline state. No React or DOM imports, so server/tests can import this file directly.
 */
import type { Block, Course, LText, Lesson, Md, Section, Source } from '../../shared/lesson/schema.js';
import { resolveText, toBcp47 } from '../../shared/lesson/text.js';
import { LESSON_DONE_STATES, allBlocks, blockDone, quizAnswered } from '../../shared/lesson/progress.js';
import type { LessonProgress, LessonStateName } from './progressStore.ts';

// The progress maths (answered, pct, state) live in shared/lesson/progress.js so the server
// computes exactly what the reader shows; re-exported here for the reader.
export {
  LESSON_DONE_STATES, allBlocks, blockDone, isAnswered, lessonPct, lessonState, quizAnswered,
} from '../../shared/lesson/progress.js';

export type ContentLocale = 'jp' | 'en' | 'fr';

/** Resolved text plus the BCP-47 `lang` to set when it fell back to another locale. */
export type ResolvedText = { value: string; lang?: string };

export function resolveLText(text: LText | null | undefined, locale: ContentLocale, fallback: ContentLocale): ResolvedText {
  const resolved = resolveText(text, locale, fallback);
  if (!resolved.locale || resolved.locale === locale) return { value: resolved.value };
  return { value: resolved.value, lang: toBcp47(resolved.locale) };
}

// --- Titles ---------------------------------------------------------------------------------

/** "第1章｜人間が理解すべき最低ライン" → kicker "第1章", title "人間が理解すべき最低ライン". */
export function splitLessonTitle(title: string): { kicker: string | null; title: string } {
  const match = /^\s*([^｜|]{1,24}?)\s*[｜|]\s*(.+)$/.exec(title);
  if (!match) return { kicker: null, title: title.trim() };
  return { kicker: match[1].trim(), title: match[2].trim() };
}

/** "1-1. フロントエンド…" → number "1-1", title "フロントエンド…". */
export function splitSectionTitle(title: string): { num: string | null; title: string } {
  const match = /^\s*(\d{1,3}(?:[-.]\d{1,3})*)[.．、:：]?\s+(.+)$/.exec(title);
  if (!match) return { num: null, title: title.trim() };
  return { num: match[1], title: match[2].trim() };
}

// --- Blocks ---------------------------------------------------------------------------------

export type QuizBlockData = Extract<Block, { type: 'quiz' }>;

export function isQuiz(block: Block): block is QuizBlockData {
  return block.type === 'quiz';
}

export type LessonState = LessonStateName;

export type LessonEventType = 'lesson_start' | 'lesson_complete';

/**
 * Learning events (the profile's learning history; Phase 5: history only, XP and the streak come
 * from the server's records) for a state change the learner caused: the first activity starts the
 * lesson, and reaching a done state completes it.
 */
export function lessonStateEvents(before: LessonState, after: LessonState): LessonEventType[] {
  const events: LessonEventType[] = [];
  if (before === 'not_started' && after !== 'not_started') events.push('lesson_start');
  if (!LESSON_DONE_STATES.has(before) && LESSON_DONE_STATES.has(after)) events.push('lesson_complete');
  return events;
}

export type SectionStatus = 'todo' | 'current' | 'done' | 'attention';

/**
 * Outline state per section: ✓ done (every block done), ● current, ! an inline check was left
 * unanswered after the learner passed it (the section lies before the active one, or the check
 * itself was seen), ○ otherwise. A section after the active one is never flagged.
 */
export function sectionStatuses(
  lesson: Lesson,
  progress: LessonProgress,
  activeSectionId: string | null,
): Record<string, SectionStatus> {
  const seen = new Set(progress.seen);
  const activeIndex = activeSectionId ? lesson.sections.findIndex((s) => s.id === activeSectionId) : -1;
  const out: Record<string, SectionStatus> = {};
  lesson.sections.forEach((section, index) => {
    const done = section.blocks.every((b) => blockDone(b, progress, seen));
    const passed = activeIndex >= 0 && index < activeIndex;
    const ahead = activeIndex >= 0 && index > activeIndex;
    // Predictions are ungraded and exams are optional at this point: only inline checks nag.
    const skippedCheck = section.blocks.some(
      (b) => isQuiz(b) && b.mode === 'inline' && !quizAnswered(b, progress) && (passed || seen.has(b.id)),
    );
    if (done) out[section.id] = 'done';
    else if (section.id === activeSectionId) out[section.id] = 'current';
    else if (!ahead && skippedCheck) out[section.id] = 'attention';
    else out[section.id] = 'todo';
  });
  return out;
}

/** Block id → owning section. */
export function sectionByBlock(lesson: Lesson): Map<string, Section> {
  const map = new Map<string, Section>();
  for (const section of lesson.sections) {
    for (const block of section.blocks) map.set(block.id, section);
  }
  return map;
}

/** Figure numbers (図1, 図2, …) for diagrams and non-decorative images, in reading order. */
export function figureNumbers(lesson: Lesson): Map<string, number> {
  const map = new Map<string, number>();
  for (const block of allBlocks(lesson)) {
    if (block.type === 'diagram' || (block.type === 'image' && !block.decorative)) {
      map.set(block.id, map.size + 1);
    }
  }
  return map;
}

/** Inline-quiz numbering ("確認しよう 1/2"). Exams and predictions are not numbered. */
export function checkNumbers(lesson: Lesson): { numbers: Map<string, number>; total: number } {
  const numbers = new Map<string, number>();
  for (const block of allBlocks(lesson)) {
    if (isQuiz(block) && block.mode === 'inline') numbers.set(block.id, numbers.size + 1);
  }
  return { numbers, total: numbers.size };
}

// --- Glossary --------------------------------------------------------------------------------

export type GlossaryItem = {
  /** Stable key: the term in the lesson's source locale. */
  key: string;
  term: LText;
  md: Md;
  /** Every spelling that selects this entry (all locales + aliases), lower-cased. */
  names: string[];
  /** Where the term is defined in the lesson (definitions blocks only). */
  blockId?: string;
  sectionId?: string;
};

const spellings = (text: LText): string[] =>
  typeof text === 'string' ? [text] : Object.values(text).filter((v): v is string => typeof v === 'string');

/**
 * Terms for the glossary card: definitions blocks in reading order, then lesson.glossary, then
 * course.glossary. The first definition of a term wins.
 */
export function glossaryItems(lesson: Lesson, course?: Course | null): GlossaryItem[] {
  const items: GlossaryItem[] = [];
  const seen = new Set<string>();
  const add = (term: LText, md: Md, aliases: string[] = [], where?: { blockId: string; sectionId: string }) => {
    const names = [...spellings(term), ...aliases].map((n) => n.trim().toLowerCase()).filter(Boolean);
    if (!names.length || names.some((n) => seen.has(n))) return;
    names.forEach((n) => seen.add(n));
    const key = resolveText(term, lesson.locale, lesson.locale).value.trim();
    items.push({ key, term, md, names, ...(where ?? {}) });
  };
  for (const section of lesson.sections) {
    for (const block of section.blocks) {
      if (block.type !== 'definitions') continue;
      for (const item of block.items) add(item.term, item.md, [], { blockId: block.id, sectionId: section.id });
    }
  }
  for (const entry of lesson.glossary ?? []) add(entry.term, entry.md, entry.aliases);
  for (const entry of course?.glossary ?? []) add(entry.term, entry.md, entry.aliases);
  return items;
}

/** The glossary item a `[[term]]` link (any locale or alias, any case) refers to. */
export function findGlossaryItem(items: readonly GlossaryItem[], term: string): GlossaryItem | undefined {
  const needle = term.trim().toLowerCase();
  return items.find((item) => item.key.toLowerCase() === needle || item.names.includes(needle));
}

// --- Sources ---------------------------------------------------------------------------------

/** A source as the reader lists it (「出典と検索」 step 5). */
export type LessonSource = {
  /** Its number in the reader: 1, 2, … in the order the lesson first cites it. */
  n: number;
  id: string;
  title: string;
  url?: string;
  publisher?: string;
  checkedAt?: string;
};

export type LessonSourceList = {
  /** In number order (items[n - 1] has number n). */
  items: LessonSource[];
  /** Source id → number. */
  numbers: Map<string, number>;
};

/**
 * The lesson's sources, numbered for the reader: the sources its blocks cite, in the order the
 * lesson first cites them (reading order, like figure numbers), then its uncited sources. A block
 * may cite the lesson's or the course's sources (validate.js accepts both); a course source is
 * listed only when the lesson cites it, and the lesson's entry wins on a shared id, as does the
 * first of two entries with the same id. Ids that name no source are skipped.
 */
export function lessonSources(lesson: Lesson, course?: Course | null): LessonSourceList {
  const known = new Map<string, Source>();
  for (const source of [...(lesson.sources ?? []), ...(course?.sources ?? [])]) {
    if (!known.has(source.id)) known.set(source.id, source);
  }
  const items: LessonSource[] = [];
  const numbers = new Map<string, number>();
  const add = (id: string) => {
    const source = known.get(id);
    if (!source || numbers.has(id)) return;
    const n = items.length + 1;
    numbers.set(id, n);
    items.push({
      n,
      id,
      title: source.title,
      ...(source.url !== undefined ? { url: source.url } : {}),
      ...(source.publisher !== undefined ? { publisher: source.publisher } : {}),
      ...(source.checkedAt !== undefined ? { checkedAt: source.checkedAt } : {}),
    });
  };
  for (const block of allBlocks(lesson)) {
    for (const id of block.cite ?? []) add(id);
  }
  for (const source of lesson.sources ?? []) add(source.id);
  return { items, numbers };
}

/** The sources a block cites, once each and by number; ids the list does not know are left out. */
export function citedSources(block: Block, list: LessonSourceList): LessonSource[] {
  const numbers = new Set<number>();
  for (const id of block.cite ?? []) {
    const n = list.numbers.get(id);
    if (n !== undefined) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b).map((n) => list.items[n - 1]);
}

/** Element id of a source in the list (sections and blocks use #s- and #b-). */
export const sourceAnchorId = (id: string): string => `rp-src-${id}`;

/**
 * A source URL to link: http(s) only. Lessons are data that AI apps and other tools can write, so
 * javascript:, data:, relative and other URLs are shown without a link.
 */
export function sourceHref(url: string | undefined): string | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** The host of a linked source (shown next to its publisher), or null. */
export function sourceHost(url: string | undefined): string | null {
  const href = sourceHref(url);
  if (!href) return null;
  try {
    return new URL(href).hostname || null;
  } catch {
    return null;
  }
}

/** Year, month and day of an ISO date (2026-10-20, or the date of an ISO timestamp), else null. */
export function isoDateParts(value: string | undefined): { year: number; month: number; day: number } | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// --- Inline markdown helpers ------------------------------------------------------------------

export const TERM_HREF_PREFIX = '#rp-term:';

/** Code fences and inline code spans; their text is code (`[[ "$X" == y ]]` is shell), not markdown. */
const CODE_SEGMENT = /(```[\s\S]*?```|``[\s\S]*?``|`[^`]*`)/;

/** `[[term]]` / `[[term|label]]` → a markdown link the renderer turns into a glossary button. */
export function linkGlossaryTerms(md: string): string {
  // split() with a capture group alternates prose (even) and code (odd); only prose is linked.
  return md.split(CODE_SEGMENT).map((part, index) => (index % 2 === 1 ? part : part.replace(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
    (_m, term: string, label?: string) => {
      const text = (label ?? term).trim().replace(/([[\]])/g, '\\$1');
      return `[${text}](${TERM_HREF_PREFIX}${encodeURIComponent(term.trim())})`;
    },
  ))).join('');
}

/** Markdown → plain text for tutor excerpts and aria labels. */
export function plainText(md: string, max = 1500): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, term: string, label?: string) => label ?? term)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Plain-text excerpt of any block for the tutor (≤1,500 chars). `t` resolves localized text.
 */
export function blockPlainText(block: Block, t: (text: LText | null | undefined) => string, max = 1500): string {
  const join = (parts: (string | undefined)[]) => plainText(parts.filter(Boolean).join('\n'), max);
  switch (block.type) {
    case 'markdown':
      return join([t(block.md)]);
    case 'callout':
      return join([t(block.title), t(block.md)]);
    case 'list':
      return join(block.items.map((item) => `- ${t(item)}`));
    case 'definitions':
      return join(block.items.map((item) => `${t(item.term)}: ${t(item.md)}`));
    case 'table':
      return join([
        t(block.caption),
        block.columns.map((c) => t(c)).join(' | '),
        ...block.rows.map((row) => row.map((cell) => t(cell)).join(' | ')),
      ]);
    case 'code':
      return block.code.slice(0, max);
    case 'prompt':
      return join([t(block.title), t(block.prompt)]);
    case 'diagram':
      return join([t(block.caption), t(block.alt), t(block.description)]);
    case 'image':
      return join([t(block.caption), t(block.alt)]);
    case 'quiz':
      return join(block.questions.map((q) => `${t(q.prompt)} ${q.options.map((o, i) => `(${i + 1}) ${t(o.md)}`).join(' ')}`));
    case 'flashcards':
      return join(block.cards.map((c) => `${t(c.front)} — ${t(c.back)}`));
    case 'steps':
      return join(block.items.map((step, i) => `${i + 1}. ${t(step.title)} ${t(step.md)}`));
    case 'checklist':
      return join([t(block.title), ...block.items.map((item) => `- ${t(item.label)}`)]);
    case 'summary':
      return join(block.points.map((p) => `- ${t(p)}`));
    case 'askTutor':
      return join(block.suggestions.map((s) => t(s)));
    default:
      return '';
  }
}

export type PromptPart = { kind: 'text'; value: string } | { kind: 'var'; name: string };

/** Splits a prompt into text and `{{variable}}` parts. */
export function splitPromptVars(prompt: string): PromptPart[] {
  const parts: PromptPart[] = [];
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt))) {
    if (match.index > last) parts.push({ kind: 'text', value: prompt.slice(last, match.index) });
    parts.push({ kind: 'var', name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < prompt.length) parts.push({ kind: 'text', value: prompt.slice(last) });
  return parts;
}

// --- Navigation -----------------------------------------------------------------------------

export type ScrollTarget = { kind: 'section' | 'block'; id: string };

/** decodeURIComponent that returns the input instead of throwing on a malformed escape ("100%"). */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** URL hash (#s-<section> / #b-<block>) first, then the saved resume block. */
export function resumeTarget(hash: string, progress: LessonProgress, lesson: Lesson): ScrollTarget | null {
  const sectionIds = new Set(lesson.sections.map((s) => s.id));
  const blockIds = new Set(allBlocks(lesson).map((b) => b.id));
  const clean = safeDecode(hash.replace(/^#/, ''));
  if (clean.startsWith('s-') && sectionIds.has(clean.slice(2))) return { kind: 'section', id: clean.slice(2) };
  if (clean.startsWith('b-') && blockIds.has(clean.slice(2))) return { kind: 'block', id: clean.slice(2) };
  if (progress.lastBlockId && blockIds.has(progress.lastBlockId)) return { kind: 'block', id: progress.lastBlockId };
  return null;
}

/** Minutes left, from the lesson estimate and the share done (at least 1 while unfinished). */
export function minutesLeft(estMinutes: number, pct: number): number {
  if (pct >= 100) return 0;
  return Math.max(1, Math.round(estMinutes * (1 - pct / 100)));
}
