#!/usr/bin/env node
/**
 * Prints the natural width of every mermaid diagram in a lesson against the phone limit (362 px).
 *
 * Renders each diagram block in headless Chromium the way the reader does: init directives
 * stripped (stripMermaidDirectives), then mermaid with the reader's settings (renderMermaid in
 * components/lesson/blocks/mermaidRenderer.ts: theme base, 15px labels, the reader's font stack,
 * flowchart and mindmap padding), and reads the SVG's viewBox width. Colors do not change the
 * width and are left at the theme defaults. Localized diagram code is measured once per locale.
 * No dev server is needed.
 *
 * The reader shrinks a diagram to at most 0.87x (MIN_SCALE in DiagramBlock.tsx, so labels stay
 * ≥ 13px); at 390 px the box is ~316 px, so the natural width must be ≤ 362 or the diagram
 * scrolls sideways on a phone.
 *
 * Usage:
 *   node scripts/lessons/diagram-width.mjs <lesson.json> [--png dir]
 *   node scripts/lessons/diagram-width.mjs content/courses/claude-code/lessons/cc-11-capstone.lesson.json
 *
 * Options:
 *   --png <dir>   also save each render as <dir>/<block id>[-<locale>].png
 *
 * Labels are measured in the reader's web fonts (the Google Fonts stylesheet of index.html: Inter,
 * Noto Sans JP). Without network the system fonts are used, the output says so, and a width can
 * then differ from the reader's by a few px.
 * Chromium: the same as lessons:preview (resolveChromium in preview.mjs).
 *
 * Exit codes: 0 every diagram fits · 1 a diagram is too wide or does not render · 2 could not run
 * (bad arguments, unreadable lesson, Playwright or mermaid missing).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripMermaidDirectives } from '../../components/lesson/blocks/blockText.ts';
import { resolveChromium } from './preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Widest natural diagram that still fits a 390 px phone (see the header). */
export const MAX_NATURAL_WIDTH = 362;
/** Label size and font stack of the reader (DIAGRAM_FONT_PX and FONT_FAMILY in mermaidRenderer.ts). */
export const FONT_PX = 15;
export const FONT_FAMILY = '"Inter", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif';
const WEB_FONTS = ['Inter', 'Noto Sans JP'];

/**
 * The Google Fonts stylesheet the app loads (the first css2 link of index.html), or null.
 *
 * @param {string} html
 */
export function webFontsHref(html) {
  const href = /href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/.exec(html)?.[1];
  return href ? href.replace(/&amp;/g, '&') : null;
}

/**
 * @param {string[]} argv
 * @returns {{ file: string, png: string | null }}
 */
export function parseArgs(argv) {
  const positional = [];
  let png = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--png') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--png needs a value');
      png = path.resolve(next);
      i += 1;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error('Usage: node scripts/lessons/diagram-width.mjs <lesson.json> [--png dir]');
  return { file: path.resolve(positional[0]), png };
}

/**
 * The mermaid sources of a lesson, one per diagram block and locale, directives stripped.
 *
 * @param {any} lesson lesson JSON
 * @returns {Array<{ id: string, locale: string | null, code: string }>}
 */
export function diagramSources(lesson) {
  const out = [];
  for (const section of lesson?.sections || []) {
    for (const block of section.blocks || []) {
      if (block.type !== 'diagram') continue;
      if (typeof block.code === 'string') out.push({ id: block.id, locale: null, code: stripMermaidDirectives(block.code) });
      else {
        for (const [locale, code] of Object.entries(block.code || {})) {
          if (typeof code === 'string' && code.trim()) out.push({ id: block.id, locale, code: stripMermaidDirectives(code) });
        }
      }
    }
  }
  return out;
}

/**
 * Runs inside the page (serialized by Playwright): renders one diagram into #d and returns its
 * natural width, or the mermaid error.
 *
 * @param {{ code: string, id: string, fontPx: number, fontFamily: string, webFonts: string[] }} options
 */
async function renderWidth({ code, id, fontPx, fontFamily, webFonts }) {
  const host = /** @type {HTMLElement} */ (document.getElementById('d'));
  const mermaid = /** @type {any} */ (window).mermaid;
  // Web fonts load per unicode range on first use; load the glyphs of this diagram before mermaid measures.
  await Promise.all(webFonts.map((family) => document.fonts.load(`${fontPx}px "${family}"`, code).catch(() => [])));
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: { fontFamily, fontSize: `${fontPx}px` },
      fontFamily,
      flowchart: { htmlLabels: true, useMaxWidth: true, padding: 12 },
      mindmap: { useMaxWidth: true, padding: 12 },
    });
    await mermaid.parse(code);
    const { svg } = await mermaid.render(id, code);
    host.innerHTML = svg;
    const el = host.querySelector('svg');
    const box = el?.viewBox?.baseVal;
    return { width: Math.round(box && box.width > 0 ? box.width : el?.getBoundingClientRect().width ?? 0) };
  } catch (error) {
    // mermaid leaves its scratch container behind when rendering fails.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    host.innerHTML = '';
    // A parse error spans lines (message, source excerpt, caret, expected tokens); keep it on one line.
    const lines = String(error instanceof Error ? error.message : error).split('\n').map((l) => l.trim());
    return { error: lines.filter((l) => l && !/^-*\^$/.test(l)).join(' ').slice(0, 240) };
  }
}

async function main() {
  /** @type {{ file: string, png: string | null }} */
  let args;
  /** @type {any} */
  let lesson;
  try {
    args = parseArgs(process.argv.slice(2));
    lesson = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  let mermaidFile;
  try {
    mermaidFile = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
  } catch {
    console.error('mermaid is not installed. Run `npm install` (mermaid is a dependency).');
    return 2;
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Playwright is not installed. Run `npm install` (playwright is a devDependency).');
    return 2;
  }

  const sources = diagramSources(lesson);
  const relative = path.relative(process.cwd(), args.file);
  const shown = !relative || relative.startsWith('..') || path.isAbsolute(relative) ? args.file : relative;
  console.log(`diagram-width ${shown}: ${sources.length} diagram(s), max natural width ${MAX_NATURAL_WIDTH}px`);
  if (!sources.length) return 0;
  if (args.png) fs.mkdirSync(args.png, { recursive: true });

  const executablePath = resolveChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  let problems = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.setContent('<!doctype html><html><body><div id="d"></div></body></html>');
    await page.addScriptTag({ path: mermaidFile });
    const href = webFontsHref(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let fontTimeout;
    // The timeout is cleared once the race settles, so a quick font load does not keep the process alive for 10 s.
    const webFonts = href
      ? await Promise.race([
        page.addStyleTag({ url: href }).then(() => true, () => false),
        new Promise((resolve) => { fontTimeout = setTimeout(() => resolve(false), 10000); }),
      ]).finally(() => clearTimeout(fontTimeout))
      : false;
    console.log(webFonts ? `fonts: ${WEB_FONTS.join(', ')} from Google Fonts, as the reader` : 'fonts: system only (Google Fonts did not load); widths can differ from the reader by a few px');
    for (const [i, source] of sources.entries()) {
      const label = source.locale ? `${source.id} (${source.locale})` : source.id;
      const id = `m${i}-${source.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      const result = await page.evaluate(renderWidth, { code: source.code, id, fontPx: FONT_PX, fontFamily: FONT_FAMILY, webFonts: webFonts ? WEB_FONTS : [] });
      if ('error' in result) {
        problems += 1;
        console.log(`${label}: does not render: ${result.error}`);
        continue;
      }
      if (args.png) {
        const name = `${source.id}${source.locale ? `-${source.locale}` : ''}`.replace(/[^a-zA-Z0-9._-]/g, '-');
        await page.locator('#d svg').screenshot({ path: path.join(args.png, `${name}.png`) });
      }
      const fits = result.width <= MAX_NATURAL_WIDTH;
      if (!fits) problems += 1;
      console.log(`${label}: natural width ${result.width}px ${fits ? 'OK' : `TOO WIDE (max ${MAX_NATURAL_WIDTH})`}`);
    }
  } finally {
    await browser.close();
  }
  console.log(problems ? `PROBLEMS FOUND: ${problems} diagram(s) too wide or not rendering.` : 'OK: every diagram fits a 390 px phone.');
  return problems ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 2;
  });
}
