#!/usr/bin/env node
/**
 * Validates risepath.lesson/v1 lessons and risepath.course/v1 courses (zod + semantic checks).
 *
 * Usage:
 *   npm run lessons:validate                                  # everything under content/ (drafts excluded)
 *   npm run lessons:validate -- content/courses/vibe-coding/lessons/vibe-ch1.lesson.json
 *   npm run lessons:validate -- --format json|github|text     # default text
 *   npm run lessons:validate -- --drafts                      # include drafts/ folders
 *
 * Lessons under content/courses/<slug>/ are checked against that course (next links, sources).
 * Exit code 1 when any file has errors.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateLesson, validateCourse } from '../../shared/lesson/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.join(ROOT, 'content');

/**
 * @typedef {{ path: string, message: string }} FileError
 * @typedef {{ file: string, kind: 'lesson' | 'course', ok: boolean, errors: FileError[], lesson?: any, course?: any }} FileResult
 */

/**
 * @param {string[]} argv
 * @returns {{ paths: string[], format: string, drafts: boolean, strict: boolean }}
 */
export function parseArgs(argv) {
  const out = { paths: /** @type {string[]} */ ([]), format: 'text', drafts: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--format') out.format = argv[++i] || 'text';
    else if (arg.startsWith('--format=')) out.format = arg.slice('--format='.length);
    else if (arg === '--drafts') out.drafts = true;
    else if (arg === '--strict') out.strict = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else out.paths.push(arg);
  }
  if (!['text', 'json', 'github'].includes(out.format)) throw new Error(`Unknown format "${out.format}" (text, json, github)`);
  return out;
}

/**
 * @param {string} dir
 * @param {boolean} drafts
 * @returns {Promise<string[]>}
 */
async function walk(dir, drafts) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      if (entry.name === 'drafts' && !drafts) continue;
      files.push(...await walk(full, drafts));
    } else if (entry.name.endsWith('.lesson.json') || entry.name === 'course.json') {
      files.push(full);
    }
  }
  return files;
}

/**
 * Expands CLI paths (files or directories) into lesson and course files.
 *
 * @param {string[]} paths
 * @param {{ drafts?: boolean }} [options]
 * @returns {Promise<string[]>} absolute paths
 */
export async function collectFiles(paths, { drafts = false } = {}) {
  const targets = paths.length > 0 ? paths.map((p) => path.resolve(process.cwd(), p)) : [CONTENT_DIR];
  const files = [];
  for (const target of targets) {
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`Not found: ${path.relative(ROOT, target) || target}`);
    if (stat.isDirectory()) files.push(...await walk(target, drafts));
    else files.push(target);
  }
  return [...new Set(files)];
}

/**
 * @param {string} file
 * @returns {Promise<{ json: unknown, error: FileError | null }>}
 */
async function readJson(file) {
  try {
    return { json: JSON.parse(await fs.readFile(file, 'utf8')), error: null };
  } catch (error) {
    return { json: null, error: { path: '(file)', message: `Cannot read JSON: ${/** @type {Error} */ (error).message}` } };
  }
}

/** @type {Map<string, Promise<any>>} */
const courseCache = new Map();

/**
 * The parsed course for a lesson under content/courses/<slug>/, or null.
 *
 * @param {string} lessonFile
 */
function courseFor(lessonFile) {
  const parts = path.relative(path.join(CONTENT_DIR, 'courses'), lessonFile).split(path.sep);
  if (parts.length < 3 || parts[0] === '..') return Promise.resolve(null);
  const courseFile = path.join(CONTENT_DIR, 'courses', parts[0], 'course.json');
  if (!courseCache.has(courseFile)) {
    courseCache.set(courseFile, readJson(courseFile).then(({ json }) => (json ? validateCourse(json).course : null)));
  }
  return /** @type {Promise<any>} */ (courseCache.get(courseFile));
}

/**
 * Validates one file (lesson or course).
 *
 * @param {string} file absolute path
 * @returns {Promise<FileResult>}
 */
export async function validateFile(file) {
  const relative = path.relative(ROOT, file);
  const rel = relative.startsWith('..') ? file : relative;
  const kind = path.basename(file) === 'course.json' ? 'course' : 'lesson';
  const { json, error } = await readJson(file);
  if (error) return { file: rel, kind, ok: false, errors: [error] };

  if (kind === 'course') {
    const lessonsDir = path.join(path.dirname(file), 'lessons');
    const names = await fs.readdir(lessonsDir).catch(() => /** @type {string[]} */ ([]));
    const lessonIds = names.filter((n) => n.endsWith('.lesson.json')).map((n) => n.replace(/\.lesson\.json$/, ''));
    const result = validateCourse(json, { lessonIds, folder: path.basename(path.dirname(file)) });
    return { file: rel, kind, ok: result.ok, errors: result.errors, course: result.course };
  }

  const course = await courseFor(file);
  const result = validateLesson(json, { course });
  const errors = [...result.errors];
  const expected = path.basename(file).replace(/\.lesson\.json$/, '');
  if (result.lesson && result.lesson.id !== expected) {
    errors.push({ path: 'id', message: `Lesson id "${result.lesson.id}" must match the file name "${expected}.lesson.json".` });
  }
  return { file: rel, kind, ok: errors.length === 0, errors, lesson: result.lesson };
}

/** @param {string} value */
const ghEscape = (value) => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * @param {FileResult[]} results
 * @param {string} format
 */
function report(results, format) {
  const lessons = results.filter((r) => r.kind === 'lesson').length;
  const courses = results.length - lessons;
  const errorCount = results.reduce((n, r) => n + r.errors.length, 0);
  if (format === 'json') {
    console.log(JSON.stringify({
      ok: errorCount === 0,
      files: results.map(({ file, kind, ok, errors }) => ({ file, kind, ok, errors })),
    }, null, 2));
    return;
  }
  if (format === 'github') {
    for (const r of results) {
      for (const e of r.errors) console.log(`::error file=${r.file},title=lessons:validate::${ghEscape(`${e.path}: ${e.message}`)}`);
    }
  } else {
    for (const r of results) {
      console.log(`${r.ok ? '✓' : '✗'} ${r.file}`);
      for (const e of r.errors) console.log(`    ${e.path}: ${e.message}`);
    }
  }
  console.log(`\n${lessons} lesson file${lessons === 1 ? '' : 's'}, ${courses} course file${courses === 1 ? '' : 's'}: ${errorCount === 0 ? 'no errors' : `${errorCount} error${errorCount === 1 ? '' : 's'}`}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = await collectFiles(args.paths, { drafts: args.drafts });
  if (files.length === 0) {
    console.error('No *.lesson.json or course.json files found.');
    process.exitCode = 1;
    return;
  }
  const results = [];
  for (const file of files) results.push(await validateFile(file));
  report(results, args.format);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
