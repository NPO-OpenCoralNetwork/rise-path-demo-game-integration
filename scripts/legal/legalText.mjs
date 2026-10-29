// @ts-check
/**
 * The public text of a legal draft (Phase 4, design §2.2). Pure: no imports, no file access, so
 * the generator (scripts/legal/build-legal-text.mjs), the release guard
 * (scripts/legal/check-legal-release.mjs), the tests and the dev banner of the legal pages
 * (components/features/legal/LegalDocument.tsx) all use the same rules.
 *
 * doc/legal/terms-of-use.draft.ja.md and doc/legal/privacy-policy.draft.ja.md stay the files the
 * owner and the lawyer edit, notes included. publicLegalText() turns one of them into the text the
 * page shows:
 *   1. strip a BOM, CRLF → LF;
 *   2. drop the banner (every line before the single `# ` title) and the title line itself
 *      (the page draws its own title);
 *   3. resolve the fences, whole lines of their own:
 *        <!-- legal:if billing -->   shown only in versions whose `include.billing` is true
 *        <!-- legal:else -->         optional: shown only when it is false
 *        <!-- legal:end -->
 *      Conditions: LEGAL_CONDITIONS. No nesting. An unknown condition, an else or end without an
 *      if, a second else, an unclosed fence or a malformed `<!-- legal:` line is a LegalTextError
 *      with file:line. Fence lines may sit between list items or table rows (they are removed
 *      before the markdown is parsed, so the list or table stays one);
 *   4. drop every paragraph (up to the next blank line) that starts with （根拠: or （作成メモ:
 *      (half- or full-width colon). Notes inside a 【要確認 …】 stay and the release guard reports
 *      them. A line inside such a note that starts a new Markdown block (a heading, a list item, a
 *      quote, a table row) is a LegalTextError with file:line: Markdown shows it as its own block
 *      to the person editing the draft, and dropping it with the note would lose it silently;
 *   5. rewrite the links between the two drafts to /terms and /privacy; any other relative link is
 *      left and reported by legalTextProblems();
 *   6. collapse 3+ newlines to 2, put the sentinel line first, end with one newline.
 *
 * Whether a fenced part shows is a property of the version (shared/legal/versions.js `include`),
 * never of runtime state.
 */

/** The conditions a fence may name (shared/legal/versions.js `include` keys). */
export const LEGAL_CONDITIONS = Object.freeze(['billing', 'byoa']);

/** First words of the sentinel line of every generated text (the CI bundle grep looks for it). */
export const LEGAL_TEXT_SENTINEL = 'risepath-legal-text';

/** Paragraphs that start with one of these are notes for the owner and the lawyer. */
const NOTE_PREFIXES = Object.freeze(['（根拠:', '（根拠：', '（作成メモ:', '（作成メモ：']);

/** A line that starts a new Markdown block even right after a paragraph line. */
const BLOCK_START = /^(?:#{1,6}(?:\s|$)|[-*+]\s|\d{1,9}[.)]\s|>|\|)/;

const FENCE = /^<!-- legal:(?:if ([a-z]+)|(else)|(end)) -->$/;

const LINK_REWRITES = Object.freeze([
  ['](./privacy-policy.draft.ja.md)', '](/privacy)'],
  ['](./terms-of-use.draft.ja.md)', '](/terms)'],
]);

export class LegalTextError extends Error {
  /**
   * @param {string} message
   * @param {{ source?: string, line?: number }} [where]
   */
  constructor(message, where = {}) {
    const at = where.line ? `${where.source || 'draft'}:${where.line}: ` : where.source ? `${where.source}: ` : '';
    super(`${at}${message}`);
    this.name = 'LegalTextError';
    /** @type {number | undefined} */
    this.line = where.line;
  }
}

/** @typedef {{ billing: boolean, byoa: boolean }} LegalInclude */
/** @typedef {{ text: string, line: number }} SourceLine */

/**
 * The sentinel line at the top of a generated text.
 * @param {string} document 'terms' | 'privacy'
 * @param {string} source repo-relative path of the draft
 */
export function legalTextSentinel(document, source) {
  return `<!-- ${LEGAL_TEXT_SENTINEL}:${document} generated from ${source} by scripts/legal/build-legal-text.mjs; do not edit -->`;
}

/**
 * The public text of a draft.
 * @param {string} raw the draft's text
 * @param {LegalInclude} include which conditional parts this version shows
 * @param {{ document: string, source?: string }} options
 * @returns {string}
 */
export function publicLegalText(raw, include, { document, source = `doc/legal/${document}.draft.ja.md` }) {
  if (typeof raw !== 'string') throw new LegalTextError('the draft text must be a string', { source });
  for (const condition of LEGAL_CONDITIONS) {
    if (typeof include?.[/** @type {keyof LegalInclude} */ (condition)] !== 'boolean') {
      throw new LegalTextError(`include.${condition} must be true or false`, { source });
    }
  }

  // 1. BOM and line ends.
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  /** @type {SourceLine[]} */
  const lines = text.split('\n').map((value, i) => ({ text: value, line: i + 1 }));

  // 2. Banner and title.
  const titles = lines.filter((l) => l.text.startsWith('# '));
  if (titles.length !== 1) {
    throw new LegalTextError(`expected exactly one "# " title line, found ${titles.length}`, { source, line: titles[1]?.line });
  }
  const body = lines.slice(lines.indexOf(titles[0]) + 1);

  // 3. Fences.
  /** @type {SourceLine[]} */
  const shown = [];
  /** @type {{ condition: string, branch: 'if' | 'else', line: number } | null} */
  let open = null;
  for (const entry of body) {
    const trimmed = entry.text.trim();
    if (trimmed.startsWith('<!-- legal:') || trimmed.startsWith('<!--legal:')) {
      const match = FENCE.exec(trimmed);
      if (!match) throw new LegalTextError(`malformed fence line "${trimmed}"`, { source, line: entry.line });
      const [, condition, isElse, isEnd] = match;
      if (condition) {
        if (open) throw new LegalTextError(`fences cannot be nested (an if is open since line ${open.line})`, { source, line: entry.line });
        if (!LEGAL_CONDITIONS.includes(condition)) {
          throw new LegalTextError(`unknown fence condition "${condition}" (known: ${LEGAL_CONDITIONS.join(', ')})`, { source, line: entry.line });
        }
        open = { condition, branch: 'if', line: entry.line };
      } else if (isElse) {
        if (!open) throw new LegalTextError('legal:else without legal:if', { source, line: entry.line });
        if (open.branch === 'else') throw new LegalTextError(`a second legal:else for the if at line ${open.line}`, { source, line: entry.line });
        open.branch = 'else';
      } else if (isEnd) {
        if (!open) throw new LegalTextError('legal:end without legal:if', { source, line: entry.line });
        open = null;
      }
      continue;
    }
    if (open) {
      const on = include[/** @type {keyof LegalInclude} */ (open.condition)];
      if ((open.branch === 'if') !== on) continue;
    }
    shown.push(entry);
  }
  if (open) throw new LegalTextError(`legal:if ${open.condition} is never closed with legal:end`, { source, line: open.line });

  // 4. Note paragraphs.
  /** @type {string[]} */
  const kept = [];
  let dropping = false;
  let atParagraphStart = true;
  for (const { text: value, line } of shown) {
    const trimmed = value.trim();
    if (trimmed === '') {
      dropping = false;
      atParagraphStart = true;
      kept.push('');
      continue;
    }
    if (dropping && !atParagraphStart && BLOCK_START.test(trimmed)) {
      throw new LegalTextError('a （根拠 or （作成メモ paragraph must end with a blank line before this line', { source, line });
    }
    if (atParagraphStart) dropping = NOTE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
    atParagraphStart = false;
    if (!dropping) kept.push(value);
  }

  // 5. Links between the drafts.
  let out = kept.join('\n');
  for (const [from, to] of LINK_REWRITES) out = out.split(from).join(to);

  // 6. Blank lines, sentinel, final newline.
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
  return `${legalTextSentinel(document, source)}\n\n${out}\n`;
}

/** What may not be left in a published text, and the strings that find it (in the generated text). */
export const LEGAL_PROBLEM_MARKERS = Object.freeze({
  to_fill: Object.freeze(['【要記入']),
  to_check: Object.freeze(['【要確認']),
  note: Object.freeze(['作成メモ']),
  basis: Object.freeze(['（根拠']),
  draft_banner: Object.freeze(['公開前に専門家']),
  fence: Object.freeze(['legal:if', 'legal:else', 'legal:end']),
  relative_link: Object.freeze(['](./', '](../']),
});

/** @typedef {keyof typeof LEGAL_PROBLEM_MARKERS} LegalProblemKind */

/**
 * Markers left in a generated text, in a fixed order, only kinds that occur. 「下書き」 alone is an
 * ordinary word of the body and is not one.
 * @param {string} text
 * @returns {{ kind: LegalProblemKind, count: number }[]}
 */
export function legalTextProblems(text) {
  /** @type {{ kind: LegalProblemKind, count: number }[]} */
  const problems = [];
  for (const kind of /** @type {LegalProblemKind[]} */ (Object.keys(LEGAL_PROBLEM_MARKERS))) {
    let count = 0;
    for (const marker of LEGAL_PROBLEM_MARKERS[kind]) count += String(text).split(marker).length - 1;
    if (count > 0) problems.push({ kind, count });
  }
  return problems;
}

/**
 * The count of one kind in a legalTextProblems() result (0 when absent).
 * @param {{ kind: string, count: number }[]} problems
 * @param {LegalProblemKind} kind
 */
export const problemCount = (problems, kind) => problems.find((p) => p.kind === kind)?.count ?? 0;
