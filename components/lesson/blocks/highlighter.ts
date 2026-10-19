/**
 * Lazy Shiki highlighting for CodeBlock.
 *
 * Nothing here is imported eagerly: `shiki/core`, the JavaScript regex engine (no .wasm), the
 * two themes and each grammar are dynamic imports, so they become separate chunks that load
 * only when a lesson shows code. Grammars load one by one as languages appear.
 *
 * Tokens carry both theme colors as CSS variables (`--shiki-light`, `--shiki-dark`); the code
 * block shows the dark palette on screen and the light one in print (see blocks.css).
 */
import type { HighlighterCore, ThemedToken } from 'shiki/core';
import { normalizeCodeLang, type CodeLang } from './blockText';

export type CodeToken = { content: string; style?: Record<string, string> };
export type CodeTokenLines = CodeToken[][];

const LIGHT = 'github-light';
const DARK = 'github-dark-dimmed';

/**
 * Theme colors below 4.5:1 on the code background are swapped for darker / lighter ones.
 * github-dark-dimmed passes on the reader's dark surface as is; github-light's orange does not.
 */
const COLOR_REPLACEMENTS: Record<string, Record<string, string>> = {
  [LIGHT]: { '#e36209': '#b35000' },
};

const GRAMMARS: Record<CodeLang, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
};

/** Shiki's grammar names for our canonical ids (bash is registered as "shellscript"). */
const SHIKI_LANG: Record<CodeLang, string> = {
  typescript: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  json: 'json',
  bash: 'shellscript',
  python: 'python',
  html: 'html',
  css: 'css',
  sql: 'sql',
  yaml: 'yaml',
  markdown: 'markdown',
  csharp: 'csharp',
};

let core: Promise<HighlighterCore> | null = null;
const grammarLoads = new Map<CodeLang, Promise<void>>();
const cache = new Map<string, CodeTokenLines>();
const CACHE_MAX = 200;

function loadCore(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark-dimmed.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  // A failed load (offline, chunk error) may be retried on the next block.
  core.catch(() => {
    core = null;
  });
  return core;
}

function loadGrammar(highlighter: HighlighterCore, lang: CodeLang): Promise<void> {
  let pending = grammarLoads.get(lang);
  if (!pending) {
    pending = GRAMMARS[lang]()
      .then((mod) => highlighter.loadLanguage((mod as { default: Parameters<HighlighterCore['loadLanguage']>[0] }).default))
      .catch((error: unknown) => {
        grammarLoads.delete(lang);
        throw error;
      });
    grammarLoads.set(lang, pending);
  }
  return pending;
}

const toToken = (token: ThemedToken): CodeToken => (token.htmlStyle
  ? { content: token.content, style: token.htmlStyle }
  : { content: token.content });

/** Tokens already computed for this code, if any (lets a re-mount render highlighted at once). */
export function cachedTokens(code: string, lang: string | null | undefined): CodeTokenLines | null {
  const canonical = normalizeCodeLang(lang);
  return canonical ? cache.get(`${canonical}\u0000${code}`) ?? null : null;
}

/**
 * Highlights `code`. Resolves to null for languages outside CODE_LANGS (shown as plain text);
 * rejects when Shiki or the grammar cannot load (the block then stays plain).
 */
export async function highlightCode(code: string, lang: string | null | undefined): Promise<CodeTokenLines | null> {
  const canonical = normalizeCodeLang(lang);
  if (!canonical) return null;
  const key = `${canonical}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const highlighter = await loadCore();
  await loadGrammar(highlighter, canonical);
  const { tokens } = highlighter.codeToTokens(code, {
    lang: SHIKI_LANG[canonical],
    themes: { light: LIGHT, dark: DARK },
    defaultColor: false,
    colorReplacements: COLOR_REPLACEMENTS,
    tokenizeMaxLineLength: 2000,
  });
  const lines = tokens.map((line) => line.map(toToken));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, lines);
  return lines;
}
