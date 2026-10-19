#!/usr/bin/env node
/**
 * Catalog of Rise Path learning content: every course under content/courses/, its lessons in
 * outline order (published file, draft or missing), validation status and lint warning count.
 * Lesson files that are not in course.json, and examples under content/examples/, are listed too.
 *
 * Usage:
 *   npm run lessons:catalog                 # table
 *   npm run lessons:catalog -- --short      # compact (injected into the author-lesson skill)
 *   npm run lessons:catalog -- --json       # machine-readable
 *   npm run lessons:catalog -- --no-check   # skip validation and lint (faster)
 *
 * Always exits 0, even on broken content: the author-lesson skill injects the output with
 * !`…`, and a failing command would abort the skill. Problems are printed as rows instead.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSES_DIR = path.join(ROOT, 'content', 'courses');
const EXAMPLES_DIR = path.join(ROOT, 'content', 'examples');

/**
 * @typedef {{ id: string, title: string, status: 'published' | 'draft' | 'published+draft' | 'missing',
 *   module?: string, estMinutes?: number, objectives?: number, sections?: number,
 *   errors?: number, warnings?: number, file?: string, inOutline: boolean, note?: string }} LessonRow
 * @typedef {{ id: string, title: string, world?: string, locales: string[], file: string,
 *   modules: { id: string, title: string }[], lessons: LessonRow[], error?: string }} CourseRow
 */

/**
 * @param {string[]} argv
 * @returns {{ format: 'table' | 'short' | 'json', check: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ format: 'table' | 'short' | 'json', check: boolean }} */
  const out = { format: 'table', check: true };
  for (const arg of argv) {
    if (arg === '--short') out.format = 'short';
    else if (arg === '--json') out.format = 'json';
    else if (arg === '--no-check') out.check = false;
    // Unknown flags are ignored on purpose: this command must never fail.
  }
  return out;
}

/**
 * Text of an LText in Japanese first, then English, then anything.
 *
 * @param {unknown} value
 * @returns {string}
 */
function label(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = /** @type {Record<string, unknown>} */ (value);
    for (const key of ['jp', 'en', 'fr']) if (typeof v[key] === 'string' && v[key]) return /** @type {string} */ (v[key]);
  }
  return '';
}

/** @param {string} file */
async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** @param {string} dir */
async function lessonFilesIn(dir) {
  const names = await fs.readdir(dir).catch(() => /** @type {string[]} */ ([]));
  return new Map(names
    .filter((n) => n.endsWith('.lesson.json'))
    .map((n) => [n.replace(/\.lesson\.json$/, ''), path.join(dir, n)]));
}

/** Lazily loaded validator and linter (zod is only needed when checking). */
let checker = /** @type {null | Promise<{ validateFile: (f: string) => Promise<any>, lintLesson: (l: any) => { warnings: any[] } }>} */ (null);
function loadChecker() {
  if (!checker) {
    checker = Promise.all([import('./validate.mjs'), import('../../shared/lesson/lint.js')])
      .then(([v, l]) => ({ validateFile: v.validateFile, lintLesson: l.lintLesson }));
  }
  return checker;
}

/**
 * Reads, validates and lints one lesson file.
 *
 * @param {string} file
 * @param {boolean} check
 */
async function inspectLesson(file, check) {
  /** @type {{ title?: string, estMinutes?: number, objectives?: number, sections?: number, errors?: number, warnings?: number, note?: string }} */
  const info = {};
  try {
    const json = await readJson(file);
    info.title = label(json.title);
    if (typeof json.estMinutes === 'number') info.estMinutes = json.estMinutes;
    if (Array.isArray(json.objectives)) info.objectives = json.objectives.length;
    if (Array.isArray(json.sections)) info.sections = json.sections.length;
  } catch (error) {
    info.note = `cannot read: ${/** @type {Error} */ (error).message}`;
    info.errors = 1;
    return info;
  }
  if (!check) return info;
  try {
    const { validateFile, lintLesson } = await loadChecker();
    const result = await validateFile(file);
    info.errors = result.errors.length;
    info.warnings = result.ok && result.lesson ? lintLesson(result.lesson).warnings.length : undefined;
  } catch (error) {
    info.note = `check failed: ${/** @type {Error} */ (error).message}`;
  }
  return info;
}

/**
 * Builds the catalog.
 *
 * @param {{ check?: boolean, coursesDir?: string, examplesDir?: string }} [options]
 * @returns {Promise<{ courses: CourseRow[], examples: LessonRow[] }>}
 */
export async function buildCatalog({ check = true, coursesDir = COURSES_DIR, examplesDir = EXAMPLES_DIR } = {}) {
  /** @type {CourseRow[]} */
  const courses = [];
  const entries = await fs.readdir(coursesDir, { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const slug of slugs) {
    const dir = path.join(coursesDir, slug);
    const published = await lessonFilesIn(path.join(dir, 'lessons'));
    const drafts = await lessonFilesIn(path.join(dir, 'drafts'));
    /** @type {CourseRow} */
    const row = { id: slug, title: '', locales: [], file: path.relative(ROOT, path.join(dir, 'course.json')), modules: [], lessons: [] };
    /** @type {{ id: string, module: string, title: string, estMinutes?: number }[]} */
    let outline = [];
    try {
      const course = await readJson(path.join(dir, 'course.json'));
      row.title = [label(course.title?.jp ?? course.title), course.title?.en].filter((v, i, a) => v && a.indexOf(v) === i).join(' / ');
      row.world = course.world;
      row.locales = Array.isArray(course.locales) ? course.locales : [course.locale].filter(Boolean);
      for (const module of course.modules || []) {
        row.modules.push({ id: module.id, title: label(module.title) });
        for (const ref of module.lessons || []) {
          outline.push({ id: ref.id, module: module.id, title: label(ref.title), ...(ref.estMinutes ? { estMinutes: ref.estMinutes } : {}) });
        }
      }
    } catch (error) {
      row.error = `course.json: ${/** @type {Error} */ (error).message}`;
      outline = [];
    }

    const listed = new Set();
    for (const ref of outline) {
      listed.add(ref.id);
      const pub = published.get(ref.id);
      const draft = drafts.get(ref.id);
      /** @type {LessonRow['status']} */
      const status = pub && draft ? 'published+draft' : pub ? 'published' : draft ? 'draft' : 'missing';
      const file = draft || pub;
      const info = file ? await inspectLesson(file, check) : {};
      row.lessons.push({
        id: ref.id,
        module: ref.module,
        status,
        inOutline: true,
        ...(file ? { file: path.relative(ROOT, file) } : {}),
        ...info,
        title: info.title || ref.title,
        ...(info.estMinutes ?? ref.estMinutes ? { estMinutes: info.estMinutes ?? ref.estMinutes } : {}),
      });
    }
    // Files that exist but are not in course.json yet (new drafts, renamed lessons).
    const extra = [...new Set([...published.keys(), ...drafts.keys()])].filter((id) => !listed.has(id))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const id of extra) {
      const pub = published.get(id);
      const draft = drafts.get(id);
      const file = /** @type {string} */ (draft || pub);
      const info = await inspectLesson(file, check);
      row.lessons.push({
        id,
        status: pub && draft ? 'published+draft' : pub ? 'published' : 'draft',
        inOutline: false,
        file: path.relative(ROOT, file),
        ...info,
        title: info.title || '',
        note: info.note || 'not in course.json',
      });
    }
    courses.push(row);
  }

  /** @type {LessonRow[]} */
  const examples = [];
  for (const [id, file] of await lessonFilesIn(examplesDir)) {
    // Examples are not under a course folder, so only their shape is summarized.
    const info = await inspectLesson(file, false);
    examples.push({ id, status: 'published', inOutline: false, file: path.relative(ROOT, file), ...info, title: info.title || '' });
  }
  return { courses, examples };
}

/** @param {LessonRow} l */
function checkLabel(l) {
  if (l.status === 'missing') return 'no file';
  if (l.errors === undefined) return '';
  if (l.errors > 0) return `${l.errors} error${l.errors === 1 ? '' : 's'}`;
  return l.warnings === undefined ? 'valid' : `valid, lint ${l.warnings}`;
}

/**
 * @param {{ courses: CourseRow[], examples: LessonRow[] }} catalog
 * @param {'table' | 'short'} format
 * @returns {string}
 */
export function formatCatalog(catalog, format) {
  const lines = [];
  if (catalog.courses.length === 0) lines.push('No courses under content/courses/.');
  for (const course of catalog.courses) {
    const count = course.lessons.filter((l) => l.inOutline).length;
    lines.push(`${course.id} — ${course.title || '(no title)'}  [world ${course.world ?? '?'} · locales ${course.locales.join(',') || '?'} · ${count} lesson${count === 1 ? '' : 's'}]`);
    if (course.error) lines.push(`  ! ${course.error}`);
    if (format === 'short') {
      for (const l of course.lessons) {
        const bits = [l.status, l.estMinutes ? `${l.estMinutes}min` : '', l.objectives !== undefined ? `obj ${l.objectives}` : '', checkLabel(l)].filter(Boolean);
        lines.push(`  ${l.id}: ${l.title || '(untitled)'} (${bits.join(', ')})${l.inOutline ? '' : ` — ${l.note}`}`);
      }
      continue;
    }
    let module = '';
    for (const l of course.lessons) {
      if (l.inOutline && l.module !== module) {
        module = l.module || '';
        const title = course.modules.find((m) => m.id === module)?.title ?? '';
        lines.push(`  ${module}  ${title}`);
      } else if (!l.inOutline && module !== '(not in course.json)') {
        module = '(not in course.json)';
        lines.push(`  ${module}`);
      }
      const cols = [
        `    ${l.id.padEnd(14)}`,
        l.status.padEnd(16),
        (l.estMinutes ? `${l.estMinutes} min` : '').padEnd(7),
        (l.objectives !== undefined ? `obj ${l.objectives}` : '').padEnd(6),
        checkLabel(l).padEnd(16),
        l.title || '(untitled)',
      ];
      lines.push(cols.join(' ').trimEnd());
      if (l.note && l.inOutline) lines.push(`      ! ${l.note}`);
    }
  }
  if (catalog.examples.length > 0) {
    lines.push('', 'Examples (content/examples/, not shown to learners):');
    for (const e of catalog.examples) {
      lines.push(`  ${e.id}: ${e.title}${e.sections ? ` (${e.sections} sections)` : ''} — ${e.file}`);
    }
  }
  if (format === 'table') {
    lines.push('', 'Status: published = lessons/<id>.lesson.json · draft = drafts/<id>.lesson.json (preview only) · lint = pedagogy warnings (npm run lessons:lint).');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const catalog = await buildCatalog({ check: args.check });
    if (args.format === 'json') console.log(JSON.stringify(catalog, null, 2));
    else console.log(formatCatalog(catalog, args.format));
  } catch (error) {
    console.log(`lessons:catalog could not read content/: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
