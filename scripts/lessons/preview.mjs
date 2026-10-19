#!/usr/bin/env node
/**
 * Screenshots a lesson the way learners see it, plus layout metrics, for visual QA.
 *
 * Opens /preview/<course>/<lesson> on the running Vite dev server (the dev-only route that
 * prefers drafts/<id>.lesson.json) as a seeded guest, and writes to
 * .artifacts/preview/<course>/<lesson>/:
 *   desktop-jp.png, mobile-jp.png, desktop-en.png   full-length page (capped at --max-height)
 *   pages/<shot>-NN.png                              one PNG per screen, scrolled like a learner
 *   metrics.json                                     lessonHash, overflowX, consoleErrors,
 *                                                    mermaidErrors, charsPerLine, text-only screens, …
 *
 * lessonHash is the hash of the lesson file the screenshots show (the same value as
 * `review-scope.mjs <file> --hash`); visual-qa copies it into its review, so check-review can tell
 * whether the screenshots still match the lesson.
 *
 * Usage:
 *   npm run lessons:preview -- <course> <lesson> [options]
 *   npm run lessons:preview -- vibe-coding vibe-ch1
 *   npm run lessons:preview -- vibe-coding vibe-ch1 --shots desktop-jp,mobile-en --no-pages
 *
 * Options:
 *   --base <url>        dev server (default $RISE_PATH_PREVIEW_BASE_URL or http://localhost:3007)
 *   --out <dir>         output folder (default .artifacts/preview/<course>/<lesson>)
 *   --shots <list>      comma-separated <desktop|mobile>-<jp|en|fr> (default desktop-jp,mobile-jp,desktop-en)
 *   --no-pages          skip the per-screen PNGs
 *   --max-height <px>   cap of the full-length PNGs (default 16000)
 *   --json              print metrics.json to stdout instead of the summary
 *
 * Chromium: $PLAYWRIGHT_CHROMIUM_PATH, else /opt/pw-browsers/chromium-1194/chrome-linux/chrome
 * when it exists, else Playwright's own download (`npx playwright install chromium`).
 *
 * Exit codes: 0 clean · 1 screenshots taken but a hard problem was found (horizontal overflow,
 * console errors, failed diagrams, unknown blocks, broken images) · 2 nothing was captured
 * (bad arguments, missing lesson, dev server down, page did not render).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lessonHash } from '../../shared/lesson/hash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FALLBACK_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const DEFAULT_SHOTS = ['desktop-jp', 'mobile-jp', 'desktop-en'];
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
/** Comfortable line lengths on desktop (doc/brushup-2026/research/ui-lessons.md §2). */
export const CHARS_PER_LINE_TARGET = { jp: [30, 40], en: [60, 75], fr: [60, 75] };
const BROWSER_LOCALE = { jp: 'ja-JP', en: 'en-US', fr: 'fr-FR' };

/**
 * @typedef {{ course: string, lesson: string, base: string, out: string, shots: string[],
 *   pages: boolean, maxHeight: number, json: boolean }} PreviewArgs
 */

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {PreviewArgs}
 */
export function parseArgs(argv, env = process.env) {
  const positional = [];
  const out = {
    base: env.RISE_PATH_PREVIEW_BASE_URL || 'http://localhost:3007',
    out: '',
    shots: DEFAULT_SHOTS,
    pages: true,
    maxHeight: 16000,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--base') out.base = value();
    else if (arg === '--out') out.out = value();
    else if (arg === '--shots') out.shots = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--no-pages') out.pages = false;
    else if (arg === '--max-height') out.maxHeight = Number(value());
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  const [course, lesson] = positional;
  if (!course || !lesson || positional.length > 2) {
    throw new Error('Usage: npm run lessons:preview -- <course> <lesson> [--base url] [--out dir] [--shots desktop-jp,mobile-jp,desktop-en] [--no-pages]');
  }
  if (!SAFE_SLUG.test(course)) throw new Error(`Invalid course slug "${course}" (lowercase letters, digits and "-").`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(lesson)) throw new Error(`Invalid lesson id "${lesson}".`);
  for (const shot of out.shots) {
    if (!/^(desktop|mobile)-(jp|en|fr)$/.test(shot)) throw new Error(`Unknown shot "${shot}" (use <desktop|mobile>-<jp|en|fr>).`);
  }
  if (!Number.isFinite(out.maxHeight) || out.maxHeight < 900) throw new Error('--max-height must be a number ≥ 900.');
  out.base = out.base.replace(/\/+$/, '');
  out.out = path.resolve(ROOT, out.out || path.join('.artifacts', 'preview', course, lesson));
  return { course, lesson, ...out };
}

/**
 * Chromium executable: $PLAYWRIGHT_CHROMIUM_PATH → the container's preinstalled build → Playwright default.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(p: string) => boolean} [exists]
 * @returns {string | undefined}
 */
export function resolveChromium(env = process.env, exists = fs.existsSync) {
  if (env.PLAYWRIGHT_CHROMIUM_PATH) return env.PLAYWRIGHT_CHROMIUM_PATH;
  if (exists(FALLBACK_CHROMIUM)) return FALLBACK_CHROMIUM;
  return undefined;
}

/**
 * Finds the lesson file the preview route will show (a draft wins over the published file).
 *
 * @param {string} course
 * @param {string} lesson
 * @param {string} [root]
 * @returns {{ file: string, source: 'draft' | 'published' } | null}
 */
export function findLessonFile(course, lesson, root = ROOT) {
  const draft = path.join(root, 'content', 'courses', course, 'drafts', `${lesson}.lesson.json`);
  const published = path.join(root, 'content', 'courses', course, 'lessons', `${lesson}.lesson.json`);
  if (fs.existsSync(draft)) return { file: draft, source: 'draft' };
  if (fs.existsSync(published)) return { file: published, source: 'published' };
  return null;
}

/**
 * The lesson hash of a lesson file, or null when it is not readable JSON.
 *
 * @param {string} file
 * @returns {string | null}
 */
export function lessonHashOfFile(file) {
  try {
    return lessonHash(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Locales a lesson file provides (`locales`, else `locale`, else jp). Unreadable files give [].
 *
 * @param {string} file
 * @returns {string[]}
 */
export function lessonLocales(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(json.locales) && json.locales.length) return json.locales.map(String);
    return [typeof json.locale === 'string' ? json.locale : 'jp'];
  } catch {
    return [];
  }
}

/**
 * The language the learner actually reads in a shot: the UI locale when the lesson has it,
 * otherwise the lesson's first locale (the reader falls back to it).
 *
 * @param {string} uiLocale
 * @param {string[]} locales
 */
export function contentLocaleFor(uiLocale, locales) {
  return locales.length === 0 || locales.includes(uiLocale) ? uiLocale : locales[0];
}

/**
 * Network failures of the app's own API (/api/…) are environment noise (for example no database
 * in a dev container), not lesson problems: they are reported separately and not counted.
 *
 * @param {string} url
 * @param {string} base
 */
export function isApiUrl(url, base) {
  try {
    const u = new URL(url);
    const b = new URL(base);
    return u.origin === b.origin && u.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Top-level verdict from per-shot metrics.
 *
 * @param {Array<{ overflowX: boolean, consoleErrors: unknown[], mermaidErrors: unknown[], unknownBlocks: number, brokenImages: unknown[] }>} shots
 */
export function summarize(shots) {
  const overflowX = shots.some((s) => s.overflowX);
  const consoleErrors = shots.reduce((n, s) => n + s.consoleErrors.length, 0);
  // Every shot renders the same diagrams; count failures once per diagram, not per shot.
  const mermaidErrors = Math.max(0, ...shots.map((s) => s.mermaidErrors.length));
  const unknownBlocks = Math.max(0, ...shots.map((s) => s.unknownBlocks));
  const brokenImages = Math.max(0, ...shots.map((s) => s.brokenImages.length));
  const ok = !overflowX && consoleErrors === 0 && mermaidErrors === 0 && unknownBlocks === 0 && brokenImages === 0;
  return { ok, overflowX, consoleErrors, mermaidErrors, unknownBlocks, brokenImages };
}

/**
 * Runs inside the page (serialized by Playwright): everything must be self-contained.
 *
 * @param {{ locale: string, bandHeight: number }} options
 */
function collectPageMetrics({ locale, bandHeight }) {
  const vw = document.documentElement.clientWidth;
  const main = document.getElementById('main-content');
  const scroller = main && /(auto|scroll|overlay)/.test(getComputedStyle(main).overflowY) ? main : document.scrollingElement || document.documentElement;
  const prose = document.querySelector('.rp-prose');

  // --- Horizontal overflow: does the page itself scroll sideways? ---
  const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  const mainOverflow = main ? main.scrollWidth > main.clientWidth + 1 : false;
  const overflowX = docOverflow || mainOverflow;
  /** Elements sticking out of the viewport that no ancestor clips or scrolls. */
  const offenders = [];
  if (overflowX && main) {
    const clips = (el) => {
      for (let a = el.parentElement; a && a !== main; a = a.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true;
      }
      return false;
    };
    for (const el of main.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      if (getComputedStyle(el).position === 'fixed' || clips(el)) continue;
      const block = el.closest('[data-rp-block]');
      offenders.push({
        tag: el.tagName.toLowerCase(),
        className: String(el.getAttribute('class') || '').slice(0, 80),
        blockId: block ? block.getAttribute('data-rp-block') : null,
        right: Math.round(r.right),
      });
      if (offenders.length >= 8) break;
    }
  }

  // --- Blocks ---
  const blocks = document.querySelectorAll('.rp-prose [data-rp-block]').length;
  const unknownBlocks = document.querySelectorAll('[data-unknown-block]').length;
  const mermaidErrors = [...document.querySelectorAll('[data-block-type="diagram"]')]
    .filter((el) => !el.querySelector('.rp-diagram-host svg') || /Syntax error/i.test(el.querySelector('svg')?.textContent || ''))
    .map((el) => el.getAttribute('data-rp-block'));
  const brokenImages = [...document.querySelectorAll('.rp-prose img')]
    .filter((img) => img.complete && img.naturalWidth === 0)
    .map((img) => img.getAttribute('src'));

  // --- Characters per line in body paragraphs (full lines only; the last line is partial) ---
  const fullLines = [];
  let measurePx = 0;
  let fontPx = 0;
  const paragraphs = [...document.querySelectorAll('.rp-prose [data-block-type="markdown"] p')].slice(0, 40);
  const range = document.createRange();
  for (const p of paragraphs) {
    const style = getComputedStyle(p);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.8;
    const lines = [];
    let mid = null;
    let count = 0;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = /** @type {Text} */ (walker.currentNode);
      const chars = [...node.data];
      let offset = 0;
      for (const ch of chars) {
        range.setStart(node, offset);
        range.setEnd(node, offset + ch.length);
        offset += ch.length;
        const rect = range.getClientRects()[0];
        if (!rect || rect.width === 0) continue;
        const m = (rect.top + rect.bottom) / 2;
        if (mid === null || Math.abs(m - mid) > lineHeight / 2) {
          if (mid !== null) lines.push(count);
          count = 0;
          mid = m;
        }
        count += 1;
      }
    }
    if (count) lines.push(count);
    if (lines.length >= 2) {
      fullLines.push(...lines.slice(0, -1));
      if (!measurePx) {
        measurePx = Math.round(p.getBoundingClientRect().width);
        fontPx = parseFloat(style.fontSize);
      }
    }
    if (fullLines.length >= 80) break;
  }
  const sorted = [...fullLines].sort((a, b) => a - b);
  const charsPerLine = sorted.length
    ? {
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      lines: sorted.length,
      measurePx,
      fontPx,
    }
    : { median: null, min: null, max: null, lines: 0, measurePx: 0, fontPx: 0 };

  // --- Screens: bands of one viewport (minus sticky bars) over the article ---
  const bar = document.querySelector('.rp-bar');
  const bottom = document.querySelector('.rp-bottombar');
  const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const topBar = visible(bar) ? Math.round(bar.getBoundingClientRect().height) : 0;
  const bottomBar = visible(bottom) && getComputedStyle(bottom).position === 'fixed' ? Math.round(bottom.getBoundingClientRect().height) : 0;
  const scrollerTop = scroller === document.documentElement || scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  const toY = (rect) => rect.top - scrollerTop + scroller.scrollTop;
  const step = Math.max(200, bandHeight - topBar - bottomBar - 16);
  const anchors = [...document.querySelectorAll([
    '.rp-prose h2', '.rp-prose h3', '.rp-prose figure', '.rp-prose img', '.rp-prose table', '.rp-prose pre',
    '[data-block-type="quiz"]', '[data-block-type="prompt"]', '[data-block-type="steps"]', '[data-block-type="checklist"]',
    '[data-block-type="flashcards"]', '[data-block-type="summary"]', '[data-block-type="callout"]', '.rp-end',
  ].join(','))].map((el) => {
    const r = el.getBoundingClientRect();
    return [toY(r), toY(r) + r.height];
  });
  // Scroll positions of the per-screen PNGs; the last one is clamped to the end of the scroller.
  const screenTops = [];
  const textOnlyScreens = [];
  if (prose) {
    const pr = prose.getBoundingClientRect();
    const start = toY(pr);
    const end = start + pr.height;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    for (let y = Math.max(0, start - topBar); screenTops.length < 60; y += step) {
      const top = Math.min(y, maxScroll);
      screenTops.push(Math.round(top));
      const lo = top + topBar;
      const hi = Math.min(top + bandHeight - bottomBar, end);
      const hasAnchor = anchors.some(([a, b]) => b > lo && a < hi);
      if (!hasAnchor && hi - lo > 200) textOnlyScreens.push(screenTops.length);
      if (top >= maxScroll || top + bandHeight >= end) break;
    }
  }

  return {
    lang: document.querySelector('.rp-reader')?.getAttribute('lang') || document.documentElement.lang || locale,
    title: document.querySelector('.rp-title')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || '',
    pageHeight: Math.round(scroller.scrollHeight),
    overflowX,
    overflowDetail: { document: docOverflow, main: mainOverflow, offenders },
    blocks,
    unknownBlocks,
    mermaidErrors,
    brokenImages,
    charsPerLine,
    screens: screenTops.length,
    screenTops,
    textOnlyScreens,
    topBar,
    bottomBar,
  };
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

/** Validation + lint summary of the lesson file, included in metrics.json. */
async function checkLesson(file) {
  try {
    const [{ validateFile }, { lintLesson }] = await Promise.all([import('./validate.mjs'), import('../../shared/lesson/lint.js')]);
    const result = await validateFile(file);
    const warnings = result.ok && result.lesson ? lintLesson(result.lesson).warnings : [];
    /** @type {Record<string, number>} */
    const rules = {};
    for (const w of warnings) rules[w.rule] = (rules[w.rule] || 0) + 1;
    return { ok: result.ok, errors: result.errors.length, warnings: warnings.length, rules, firstErrors: result.errors.slice(0, 5) };
  } catch (error) {
    return { ok: false, errors: 1, warnings: 0, rules: {}, firstErrors: [{ path: '(file)', message: String(error) }] };
  }
}

/**
 * @param {import('playwright').Browser} browser
 * @param {PreviewArgs} args
 * @param {string} name
 * @param {string} url
 * @param {string[]} locales locales the lesson provides
 */
async function shoot(browser, args, name, url, locales) {
  const [device, locale] = /** @type {['desktop' | 'mobile', 'jp' | 'en' | 'fr']} */ (name.split('-'));
  const contentLocale = /** @type {'jp' | 'en' | 'fr'} */ (contentLocaleFor(locale, locales));
  const viewport = VIEWPORTS[device];
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: device === 'mobile',
    hasTouch: device === 'mobile',
    locale: BROWSER_LOCALE[locale],
    reducedMotion: 'reduce',
  });
  await context.addInitScript((lang) => {
    // A logged-out visitor gets the landing page on every route, so sign in as the guest.
    localStorage.setItem('rp_auth_user', JSON.stringify({ id: 'guest', email: 'guest@risepath.system', name: 'Guest Explorer', isGuest: true }));
    localStorage.setItem('risepath:language', lang);
  }, locale);
  const page = await context.newPage();
  /** @type {{ type: string, text: string, url?: string }[]} */
  const consoleErrors = [];
  /** @type {{ status: number, url: string }[]} */
  const ignored = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url || '';
    if (/^Failed to load resource/.test(msg.text()) && isApiUrl(where, args.base)) return;
    consoleErrors.push({ type: 'console', text: msg.text().slice(0, 300), url: where });
  });
  page.on('pageerror', (error) => consoleErrors.push({ type: 'pageerror', text: String(error).slice(0, 300) }));
  page.on('response', (res) => {
    if (res.status() >= 400 && isApiUrl(res.url(), args.base)) ignored.push({ status: res.status(), url: new URL(res.url()).pathname });
  });

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    const rendered = await page.waitForSelector('.rp-prose', { timeout: 30000 }).then(() => true, () => false);
    if (!rendered) {
      const heading = await page.locator('h1').first().textContent().catch(() => '');
      throw new Error(`The reader did not render at ${url}${heading ? ` (page shows "${heading.trim()}")` : ''}. Is this the Vite dev server? /preview exists only in dev builds.`);
    }
    await settle(page);

    const metrics = await page.evaluate(collectPageMetrics, { locale, bandHeight: viewport.height });

    /** @type {string[]} */
    const pages = [];
    if (args.pages) {
      await fsp.mkdir(path.join(args.out, 'pages'), { recursive: true });
      for (const [i, top] of metrics.screenTops.entries()) {
        await page.evaluate((y) => {
          const main = document.getElementById('main-content');
          const scroller = main && /(auto|scroll|overlay)/.test(getComputedStyle(main).overflowY) ? main : (document.scrollingElement || document.documentElement);
          scroller.scrollTo({ top: y, behavior: 'instant' });
        }, top);
        await page.waitForTimeout(150);
        const file = path.join('pages', `${name}-${String(i + 1).padStart(2, '0')}.png`);
        await page.screenshot({ path: path.join(args.out, file) });
        pages.push(file);
      }
    }

    // Full-length PNG: grow the viewport to the page height so the inner scroller shows everything.
    const fullHeight = Math.min(metrics.pageHeight, args.maxHeight);
    await page.evaluate(() => {
      const main = document.getElementById('main-content');
      (main || document.scrollingElement || document.documentElement).scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, fullHeight) });
    await settle(page, 600);
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(args.out, file) });

    return {
      name,
      device,
      locale,
      contentLocale,
      localeFallback: contentLocale !== locale,
      viewport,
      url,
      file,
      pages,
      truncated: metrics.pageHeight > args.maxHeight,
      ...metrics,
      charsPerLine: {
        ...metrics.charsPerLine,
        target: device === 'desktop' ? CHARS_PER_LINE_TARGET[contentLocale] ?? null : null,
      },
      consoleErrors,
      ignoredNetworkErrors: ignored,
    };
  } finally {
    await context.close();
  }
}

/**
 * Waits for lazy content: diagrams (rendered or failed), web fonts, then a quiet moment.
 *
 * @param {import('playwright').Page} page
 * @param {number} [extra]
 */
async function settle(page, extra = 400) {
  await page.waitForFunction(() => [...document.querySelectorAll('.rp-diagram-card')]
    .every((card) => card.querySelector('svg') || !card.querySelector('[aria-busy="true"]')), null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

/** @param {any} shot */
function shotLine(shot) {
  const cpl = shot.charsPerLine;
  const target = cpl.target ? ` (target ${cpl.target[0]}–${cpl.target[1]})` : '';
  const screens = (shot.pageHeight / shot.viewport.height).toFixed(1);
  const bad = shot.overflowX || shot.consoleErrors.length || shot.mermaidErrors.length || shot.unknownBlocks || shot.brokenImages.length;
  return [
    `  ${bad ? '✗' : '✓'} ${shot.name.padEnd(10)} ${shot.viewport.width}×${shot.viewport.height}`,
    `page ${shot.pageHeight}px (${screens} screens)`,
    `overflowX ${shot.overflowX ? 'YES' : 'no'}`,
    `console errors ${shot.consoleErrors.length}`,
    `diagram errors ${shot.mermaidErrors.length}`,
    `chars/line median ${cpl.median ?? '–'}${target}${shot.localeFallback ? ` (content ${shot.contentLocale}: the lesson has no ${shot.locale})` : ''}`,
    `text-only screens ${shot.textOnlyScreens.length ? shot.textOnlyScreens.join(',') : 'none'}`,
  ].join(' · ');
}

async function main() {
  /** @type {PreviewArgs} */
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
  // Hashed before the page loads, so the hash names the lesson text the screenshots render.
  const shownHash = lessonHashOfFile(found.file);
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
  const url = `${args.base}/preview/${args.course}/${args.lesson}`;
  await fsp.mkdir(args.out, { recursive: true });
  // Old per-screen PNGs would mix with new ones.
  await fsp.rm(path.join(args.out, 'pages'), { recursive: true, force: true });

  const validation = await checkLesson(found.file);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const shots = [];
  try {
    const locales = lessonLocales(found.file);
    for (const name of args.shots) shots.push(await shoot(browser, args, name, url, locales));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await browser.close();
    return 2;
  }
  await browser.close();

  // A lesson edited while the shots ran: the screenshots match neither version, so record no hash.
  const lessonHashAfter = lessonHashOfFile(found.file);
  if (lessonHashAfter !== shownHash) console.error(`The lesson changed while it was captured (${shownHash} → ${lessonHashAfter}); metrics.json records no lessonHash. Run the preview again.`);
  const verdict = summarize(shots);
  /** @type {Record<string, unknown>} */
  const charsPerLine = {};
  for (const s of shots) charsPerLine[s.name] = s.charsPerLine;
  const ignoredNetworkErrors = shots.flatMap((s) => s.ignoredNetworkErrors);
  const metrics = {
    course: args.course,
    lesson: args.lesson,
    source: found.source,
    file: path.relative(ROOT, found.file),
    lessonHash: lessonHashAfter === shownHash ? shownHash : null,
    url,
    generatedAt: new Date().toISOString(),
    ok: verdict.ok,
    overflowX: verdict.overflowX,
    consoleErrors: verdict.consoleErrors,
    mermaidErrors: verdict.mermaidErrors,
    unknownBlocks: verdict.unknownBlocks,
    brokenImages: verdict.brokenImages,
    charsPerLine,
    textOnlyScreens: Object.fromEntries(shots.map((s) => [s.name, s.textOnlyScreens])),
    validation,
    ignoredNetworkErrors: {
      count: ignoredNetworkErrors.length,
      note: 'Failed /api/ requests (for example 503 without a database) are environment noise and are not counted as console errors.',
      urls: [...new Set(ignoredNetworkErrors.map((e) => `${e.status} ${e.url}`))],
    },
    shots: shots.map(({ ignoredNetworkErrors: _ignored, ...rest }) => rest),
  };
  await fsp.writeFile(path.join(args.out, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);

  if (args.json) {
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    const relative = path.relative(ROOT, args.out);
    const rel = !relative || relative.startsWith('..') || path.isAbsolute(relative) ? args.out : relative;
    console.log(`lessons:preview ${args.course}/${args.lesson} (${found.source}: ${metrics.file}, ${shownHash ?? 'lessonHash unavailable'})`);
    console.log(`  validate: ${validation.ok ? 'ok' : `${validation.errors} error(s)`} · lint: ${validation.warnings} warning(s)`);
    for (const s of shots) console.log(shotLine(s));
    for (const s of shots) {
      for (const e of s.consoleErrors.slice(0, 3)) console.log(`    ${s.name} ${e.type}: ${e.text}`);
      for (const o of s.overflowDetail.offenders.slice(0, 3)) console.log(`    ${s.name} overflow: <${o.tag} class="${o.className}"> block ${o.blockId ?? '-'} right=${o.right}px`);
      if (s.mermaidErrors.length) console.log(`    ${s.name} diagrams that failed: ${s.mermaidErrors.join(', ')}`);
      if (s.truncated) console.log(`    ${s.name}: page is ${s.pageHeight}px; the full-length PNG stops at ${args.maxHeight}px (see pages/).`);
    }
    if (metrics.ignoredNetworkErrors.count) console.log(`  ignored: ${metrics.ignoredNetworkErrors.count} failed /api/ request(s) (${metrics.ignoredNetworkErrors.urls.slice(0, 3).join(', ')}${metrics.ignoredNetworkErrors.urls.length > 3 ? ', …' : ''})`);
    const pageCount = shots.reduce((n, s) => n + s.pages.length, 0);
    const names = shots.length === 1 ? `${shots[0].name}.png` : `{${shots.map((s) => s.name).join(',')}}.png`;
    console.log(`Wrote ${rel}/${names}${pageCount ? `, ${pageCount} screen PNGs in pages/` : ''} and metrics.json`);
    console.log(verdict.ok ? 'OK: no overflow, console errors, diagram errors, unknown blocks or broken images.' : 'PROBLEMS FOUND: see the ✗ rows above and metrics.json.');
  }
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 2;
  });
}
