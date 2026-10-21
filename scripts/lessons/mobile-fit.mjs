#!/usr/bin/env node
/**
 * Checks that a lesson's code and tables fit the screen, the way learners see them.
 *
 * Opens /preview/<course>/<lesson> on the running Vite dev server (the dev-only route that
 * prefers drafts/<id>.lesson.json) as a seeded guest, at the mobile (390 px) and desktop (1440 px)
 * widths of lessons:preview. Folded text is opened first (<details>: step hints and fixes,
 * expected results, diagram descriptions; folded code blocks), so it is measured too. Reports:
 *   split chip     an inline code chip (code outside pre) broken across lines, which splits a
 *                  command or flag ('--' / 'bare'). Problem.
 *   long chip      a chip longer than a whole line, so it wraps inside itself; a code block reads
 *                  better. Advisory.
 *   cut-off line   a code-block line wider than its box: the reader shows no scroll cue, so the
 *                  end is hidden. Problem.
 *   wrapped line   a code-block line the reader soft-wraps: readable, but a shorter line reads
 *                  better. Advisory.
 *   wide table     a table wider than its box at 390 px, so the learner scrolls sideways. Problem.
 * Quiz hints and feedback appear only after an answer and are not checked.
 *
 * Usage:
 *   node scripts/lessons/mobile-fit.mjs <course> <lesson> [--base url]
 *   node scripts/lessons/mobile-fit.mjs claude-code cc-01-first-session
 *
 * Options:
 *   --base <url>   dev server (default $RISE_PATH_PREVIEW_BASE_URL or http://localhost:3007)
 *
 * The UI language is the lesson's: jp when the lesson has it, else its first locale.
 * Chromium: the same as lessons:preview (resolveChromium in preview.mjs).
 *
 * Exit codes: 0 clean (advisories may be listed) · 1 problems found · 2 could not run (bad
 * arguments, missing lesson, dev server down, page did not render).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentLocaleFor, findLessonFile, lessonLocales, resolveChromium } from './preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** The mobile and desktop viewports of lessons:preview. Tables are checked at mobile width only. */
export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};
const BROWSER_LOCALE = { jp: 'ja-JP', en: 'en-US', fr: 'fr-FR' };

/**
 * @typedef {{ course: string, lesson: string, base: string }} FitArgs
 * @typedef {{ block: string, code: string, context: string, long: boolean }} Chip
 * @typedef {{ block: string, line: number, text: string, over: number }} CutLine
 * @typedef {{ block: string, line: number }} WrappedLine
 * @typedef {{ block: string, width: number, box: number, over: boolean }} Table
 * @typedef {{ name: string, chips: Chip[], cut: CutLine[], wrapped: WrappedLine[], tables: Table[] }} ViewResult
 */

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {FitArgs}
 */
export function parseArgs(argv, env = process.env) {
  const positional = [];
  let base = env.RISE_PATH_PREVIEW_BASE_URL || 'http://localhost:3007';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--base needs a value');
      base = next;
      i += 1;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  const [course, lesson] = positional;
  if (!course || !lesson || positional.length > 2) {
    throw new Error('Usage: node scripts/lessons/mobile-fit.mjs <course> <lesson> [--base url]');
  }
  if (!SAFE_SLUG.test(course)) throw new Error(`Invalid course slug "${course}" (lowercase letters, digits and "-").`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(lesson)) throw new Error(`Invalid lesson id "${lesson}".`);
  return { course, lesson, base: base.replace(/\/+$/, '') };
}

/**
 * Problems in one viewport: split chips, cut-off code lines, wide tables (advisories do not count).
 *
 * @param {ViewResult} view
 */
export function countProblems(view) {
  return view.chips.filter((c) => !c.long).length + view.cut.length + view.tables.filter((t) => t.over).length;
}

/**
 * Report lines for one viewport, problems and advisories.
 *
 * @param {ViewResult} view
 * @returns {string[]}
 */
export function reportLines(view) {
  const lines = [];
  for (const c of view.chips) {
    lines.push(c.long
      ? `${view.name}: advisory, ${c.block}: \`${c.code}\` is longer than a line and wraps inside its chip (a code block reads better)`
      : `${view.name}: ${c.block}: \`${c.code}\` is split across lines — in 「${c.context}」`);
  }
  for (const c of view.cut) lines.push(`${view.name}: ${c.block}: code line ${c.line} is cut off (${c.over}px too wide): ${c.text}`);
  if (view.wrapped.length) lines.push(`${view.name}: advisory, code lines soft-wrapped: ${view.wrapped.map((w) => `${w.block} line ${w.line}`).join(', ')}`);
  for (const t of view.tables.filter((x) => x.over)) lines.push(`${view.name}: ${t.block}: table ${t.width}px in a ${t.box}px box (scrolls sideways)`);
  return lines;
}

/**
 * Runs inside the page (serialized by Playwright): everything must be self-contained.
 *
 * @param {{ tables: boolean }} options
 */
function collectFit({ tables }) {
  const blockOf = (el) => el.closest('[data-rp-block]')?.getAttribute('data-rp-block') || '-';
  const rectsOf = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter((r) => r.width > 0);
  };

  // Inline code chips; the line fragments of a Range also see lines wrapped inside an inline-block chip.
  const chips = [...document.querySelectorAll('code')].filter((c) => !c.closest('pre')).map((c) => {
    const tops = new Set(rectsOf(c).map((r) => Math.round(r.top)));
    if (tops.size < 2) return null;
    // The reader keeps a chip whole (inline-block); one that still wraps is longer than the whole line.
    let box = c.parentElement;
    while (box && getComputedStyle(box).display.startsWith('inline')) box = box.parentElement;
    const style = box ? getComputedStyle(box) : null;
    const lineWidth = box && style ? box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) : 0;
    return {
      block: blockOf(c),
      code: c.textContent || '',
      context: (c.parentElement?.textContent || '').trim().slice(0, 70),
      long: c.getBoundingClientRect().width >= lineWidth - 2,
    };
  }).filter(Boolean);

  // Code-block lines: cut off at the box's right edge, or soft-wrapped onto a second line.
  const cut = [];
  const wrapped = [];
  for (const pre of document.querySelectorAll('.rp-code-pre')) {
    const box = pre.getBoundingClientRect();
    [...pre.querySelectorAll('.rp-code-line')].forEach((line, i) => {
      // The code itself: skip the line number and the trailing newline text node.
      const parts = [...line.childNodes].filter((n) => !(n.nodeType === 1 && /** @type {Element} */ (n).classList.contains('rp-code-ln'))
        && !(n.nodeType === 3 && /^\s*$/.test(n.textContent || '')));
      const rects = parts.flatMap(rectsOf);
      if (!rects.length) return;
      const right = Math.max(...rects.map((r) => r.right));
      if (right > box.right - 4) {
        cut.push({ block: blockOf(pre), line: i + 1, text: parts.map((n) => n.textContent).join('').trimEnd(), over: Math.round(right - box.right + 4) });
      }
      if (new Set(rects.map((r) => Math.round(r.top))).size > 1) wrapped.push({ block: blockOf(pre), line: i + 1 });
    });
  }

  const wide = tables ? [...document.querySelectorAll('table')].map((t) => {
    const box = t.parentElement || t;
    return { block: blockOf(t), width: Math.round(t.scrollWidth), box: Math.round(box.clientWidth), over: t.scrollWidth > box.clientWidth + 1 };
  }) : [];

  return { chips, cut, wrapped, tables: wide };
}

/**
 * @param {string} base
 * @param {number} [timeoutMs]
 */
async function serverUp(base, timeoutMs = 4000) {
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} name
 * @param {{ width: number, height: number }} viewport
 * @param {string} locale UI language
 * @param {string} url
 * @returns {Promise<ViewResult>}
 */
async function checkView(browser, name, viewport, locale, url) {
  const mobile = name === 'mobile';
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: BROWSER_LOCALE[locale] ?? BROWSER_LOCALE.jp,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((lang) => {
    // A logged-out visitor gets the landing page on every route, so sign in as the guest.
    localStorage.setItem('rp_auth_user', JSON.stringify({ id: 'guest', email: 'guest@risepath.system', name: 'Guest Explorer', isGuest: true }));
    localStorage.setItem('risepath:language', lang);
  }, locale);
  try {
    const page = await context.newPage();
    // A cold dev server compiles the reader on the first request, so the first load can be slow.
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    const rendered = await page.waitForSelector('.rp-prose', { timeout: 60000 }).then(() => true, () => false);
    if (!rendered) throw new Error(`The reader did not render at ${url}. Is this the Vite dev server? /preview exists only in dev builds.`);
    await page.evaluate(() => {
      for (const details of document.querySelectorAll('details')) details.open = true;
      for (const button of document.querySelectorAll('.rp-code-fold-btn[aria-expanded="false"]')) /** @type {HTMLElement} */ (button).click();
    });
    await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    return { name, ...(await page.evaluate(collectFit, { tables: mobile })) };
  } finally {
    await context.close();
  }
}

async function main() {
  /** @type {FitArgs} */
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const found = findLessonFile(args.course, args.lesson);
  if (!found) {
    console.error(`No lesson file: content/courses/${args.course}/{drafts,lessons}/${args.lesson}.lesson.json`);
    return 2;
  }
  if (!fs.existsSync(path.join(ROOT, 'content', 'courses', args.course, 'course.json'))) {
    console.error(`No course.json in content/courses/${args.course}/ — the reader needs the course.`);
    return 2;
  }
  if (!(await serverUp(args.base))) {
    console.error(`The dev server is not reachable at ${args.base}. Start it with \`npm run dev\` (Vite :3007 + API :3006), or pass --base.`);
    return 2;
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Playwright is not installed. Run `npm install` (playwright is a devDependency).');
    return 2;
  }
  const executablePath = resolveChromium();
  const locale = contentLocaleFor('jp', lessonLocales(found.file));
  const url = `${args.base}/preview/${args.course}/${args.lesson}`;

  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  /** @type {ViewResult[]} */
  const views = [];
  try {
    for (const [name, viewport] of Object.entries(VIEWPORTS)) views.push(await checkView(browser, name, viewport, locale, url));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  } finally {
    await browser.close();
  }

  console.log(`mobile-fit ${args.course}/${args.lesson} (${found.source}: ${path.relative(ROOT, found.file)}, UI ${locale})`);
  for (const view of views) for (const line of reportLines(view)) console.log(`  ${line}`);
  const tables = views.reduce((n, v) => n + v.tables.length, 0);
  const problems = views.reduce((n, v) => n + countProblems(v), 0);
  console.log(problems
    ? `PROBLEMS FOUND: ${problems} split inline code chip(s), cut-off code line(s) or wide table(s).`
    : `OK: no split inline code chip, cut-off code line or wide table (${tables} table(s) checked at 390 px; advisories above, if any).`);
  return problems ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 2;
  });
}
