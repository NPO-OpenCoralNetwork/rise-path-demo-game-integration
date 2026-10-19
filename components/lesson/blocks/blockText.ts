/**
 * Pure helpers for the rich lesson blocks (WP-05): code languages and folding, prompt
 * variables and the Claude Code command, mermaid directive stripping, keyboard combos.
 * No React, DOM or Vite imports, so server/tests can import this file directly.
 */
import type { Lesson } from '../../../shared/lesson/schema.js';
import type { LessonProgress } from '../progressStore.ts';
import { isAnswered, isQuiz, splitPromptVars } from '../model.ts';

// --- Code --------------------------------------------------------------------------------

/** Languages the code block highlights (PLAN §9 WP-05). Each loads as its own lazy chunk. */
export const CODE_LANGS = [
  'typescript', 'tsx', 'javascript', 'json', 'bash', 'python', 'html', 'css', 'sql', 'yaml',
  'markdown', 'csharp',
] as const;

export type CodeLang = (typeof CODE_LANGS)[number];

const LANG_ALIASES: Record<string, CodeLang> = {
  ts: 'typescript',
  typescript: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  jsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  console: 'bash',
  terminal: 'bash',
  python: 'python',
  py: 'python',
  html: 'html',
  htm: 'html',
  css: 'css',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  markdown: 'markdown',
  md: 'markdown',
  csharp: 'csharp',
  cs: 'csharp',
  'c#': 'csharp',
};

/** Block `lang` → a highlighter language, or null for plain text (text, txt, unknown ids). */
export function normalizeCodeLang(lang: string | null | undefined): CodeLang | null {
  if (!lang) return null;
  return LANG_ALIASES[lang.trim().toLowerCase()] ?? null;
}

/** Line numbers appear when a block has more lines than this. */
export const LINE_NUMBERS_AFTER = 5;
/** Blocks longer than this start folded. */
export const FOLD_AFTER = 25;
/** Lines shown while a long block is folded. */
export const FOLD_VISIBLE = 12;

/** Splits code into lines, ignoring one trailing newline. */
export function codeLines(code: string): string[] {
  return code.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
}

/** [2, 3, 4, 7] → [[2, 4], [7, 7]] (sorted, de-duplicated, positive integers only). */
export function lineRanges(lines: readonly number[] | null | undefined): [number, number][] {
  const sorted = [...new Set((lines ?? []).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/** [2, 3, 4, 7] → "2–4, 7". */
export function formatLineRanges(lines: readonly number[] | null | undefined, sep = ', '): string {
  return lineRanges(lines).map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(sep);
}

// --- Prompts -----------------------------------------------------------------------------

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Variable names in order of first appearance. */
export function promptVarNames(prompt: string): string[] {
  return [...new Set(splitPromptVars(prompt).flatMap((p) => (p.kind === 'var' ? [p.name] : [])))];
}

/**
 * Replaces `{{name}}` with the learner's value. Blank values keep the `{{name}}` placeholder,
 * so a half-filled prompt still shows what is missing.
 */
export function fillPrompt(prompt: string, values: Readonly<Record<string, string>>): string {
  return prompt.replace(VAR_RE, (whole, name: string) => {
    const value = values[name.trim()];
    return value && value.trim() ? value : whole;
  });
}

/**
 * POSIX shell single-quoting: wraps in '…' and writes each ' as '\'' (close, escaped quote,
 * reopen). Nothing inside single quotes is expanded, so $VAR, `cmd`, !, \ and newlines are
 * passed literally in sh, bash and zsh.
 */
export function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The terminal command that starts Claude Code with this prompt. */
export function claudeCommand(prompt: string): string {
  return `claude ${posixSingleQuote(prompt.replace(/\r\n?/g, '\n').trim())}`;
}

// --- Mermaid -----------------------------------------------------------------------------

/**
 * Removes `%%{init: …}%%` / `%%{initialize: …}%%` directives and a leading `config:` front
 * matter, so lesson content cannot switch off the reader's theme, font-size floor or
 * security settings. Other comments and the diagram itself are kept.
 */
export function stripMermaidDirectives(code: string): string {
  let out = code.replace(/%%\{[\s\S]*?\}%%/g, '');
  // Front matter: keep a title, drop config.
  out = out.replace(/^\s*---\n([\s\S]*?)\n---\s*\n/, (_whole, body: string) => {
    const title = /^title:\s*(.+)$/m.exec(body);
    return title ? `---\ntitle: ${title[1].trim()}\n---\n` : '';
  });
  return out.trim();
}

// --- Keys --------------------------------------------------------------------------------

/**
 * "Ctrl+Shift+P" → ["Ctrl", "Shift", "P"]; "Ctrl++" → ["Ctrl", "+"]; "+" → ["+"].
 * Spaces around "+" are allowed. A string without "+" is one key.
 */
export function splitKeyCombo(combo: string): string[] {
  const value = combo.trim();
  if (!value || value === '+') return value ? ['+'] : [];
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '+' && current.trim()) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// --- Practice counter ----------------------------------------------------------------------

/**
 * "練習 x/y" in the LessonBar: y = questions in inline checks and exams (predictions are
 * ungraded and not practice), x = those answered (submitted or revealed).
 */
export function practiceProgress(lesson: Lesson, progress: LessonProgress): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const section of lesson.sections) {
    for (const block of section.blocks) {
      if (!isQuiz(block) || block.mode === 'predict') continue;
      for (const question of block.questions) {
        total += 1;
        if (isAnswered(progress, block.id, question.id)) answered += 1;
      }
    }
  }
  return { answered, total };
}
