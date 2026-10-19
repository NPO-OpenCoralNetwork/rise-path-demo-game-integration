#!/usr/bin/env node
/**
 * Migrates the legacy Vibe Coding chapters (data/curricula/vibe_coding/chapterN.ts, DocChapter)
 * to risepath.lesson/v1 files in content/courses/vibe-coding/lessons/.
 *
 * The legacy files are TypeScript that imports `../../../types` (extensionless, with enums),
 * which `node --experimental-strip-types` cannot load, so they are bundled in memory with
 * esbuild (a Vite dependency) and imported from a data: URL. `loadLegacyChapter()` is exported
 * for tests.
 *
 * Usage:
 *   npm run lessons:migrate                     # write lesson files that don't exist yet
 *   npm run lessons:migrate -- --force          # also overwrite files still authored by "migration"
 *   npm run lessons:migrate -- --dry-run        # print what would be written
 *   npm run lessons:migrate -- --only vibe-ch3  # one lesson
 *
 * Hand-edited lessons (provenance.author other than "migration", e.g. the polished vibe-ch1)
 * are never overwritten.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { fromDocChapter, docChapterStats } from '../../shared/lesson/fromDocChapter.js';
import { validateLesson } from '../../shared/lesson/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
const COURSE_ID = 'vibe-coding';
const OUT_DIR = path.join(ROOT, 'content/courses', COURSE_ID, 'lessons');

/** Legacy sources, in course order. */
export const VIBE_LEGACY = Array.from({ length: 12 }, (_, n) => ({
  lessonId: `vibe-ch${n}`,
  source: `data/curricula/vibe_coding/chapter${n}.ts`,
  ...(n === 1 ? { quizSource: 'data/curricula/vibe_coding/chapter1_quiz.ts' } : {}),
}));

/** @type {Map<string, Promise<Record<string, unknown>>>} */
const moduleCache = new Map();

/**
 * Bundles a TS module (and its imports) in memory and imports it.
 *
 * @param {string} file repo-relative or absolute path
 * @returns {Promise<Record<string, unknown>>}
 */
export function loadLegacyModule(file) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!moduleCache.has(abs)) {
    moduleCache.set(abs, (async () => {
      const result = await build({
        entryPoints: [abs],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        target: 'es2022',
        logLevel: 'silent',
      });
      const code = result.outputFiles[0].text;
      return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    })());
  }
  return /** @type {Promise<Record<string, unknown>>} */ (moduleCache.get(abs));
}

/**
 * @param {Record<string, unknown>} mod
 * @param {(value: any) => boolean} test
 * @param {string} file
 * @param {string} what
 */
function pickExport(mod, test, file, what) {
  const found = Object.entries(mod).filter(([, value]) => value && typeof value === 'object' && test(value));
  if (found.length !== 1) throw new Error(`${file}: expected exactly one ${what} export, found ${found.length}`);
  return { exportName: found[0][0], value: /** @type {any} */ (found[0][1]) };
}

/**
 * Loads a legacy DocChapter from a .ts file.
 *
 * @param {string} file repo-relative or absolute path
 * @returns {Promise<{ chapter: any, exportName: string }>}
 */
export async function loadLegacyChapter(file) {
  const mod = await loadLegacyModule(file);
  const { exportName, value } = pickExport(mod, (v) => Array.isArray(v.sections), file, 'DocChapter');
  return { chapter: value, exportName };
}

/**
 * Loads a legacy QuizData from a .ts file.
 *
 * @param {string} file
 * @returns {Promise<{ quiz: any, exportName: string }>}
 */
export async function loadLegacyQuiz(file) {
  const mod = await loadLegacyModule(file);
  const { exportName, value } = pickExport(mod, (v) => Array.isArray(v.questions), file, 'QuizData');
  return { quiz: value, exportName };
}

/**
 * Converts one legacy entry of VIBE_LEGACY.
 *
 * @param {{ lessonId: string, source: string, quizSource?: string }} entry
 */
export async function migrateEntry(entry) {
  const { chapter, exportName } = await loadLegacyChapter(entry.source);
  const quiz = entry.quizSource ? await loadLegacyQuiz(entry.quizSource) : null;
  const lesson = fromDocChapter(chapter, {
    quiz: quiz ? quiz.quiz : null,
    courseId: COURSE_ID,
    locale: 'jp',
    locales: ['jp', 'en'],
    source: entry.source,
    exportName,
    quizSource: entry.quizSource,
    quizExport: quiz ? quiz.exportName : undefined,
  });
  return { lesson, stats: docChapterStats(chapter, quiz ? quiz.quiz : null) };
}

/** @param {string} file */
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

  await fs.mkdir(OUT_DIR, { recursive: true });
  let failed = false;
  for (const entry of VIBE_LEGACY) {
    if (only && entry.lessonId !== only) continue;
    const { lesson, stats } = await migrateEntry(entry);
    const result = validateLesson(lesson);
    if (!result.ok) {
      failed = true;
      console.error(`✗ ${entry.lessonId}: migrated lesson is invalid`);
      for (const e of result.errors) console.error(`    ${e.path}: ${e.message}`);
      continue;
    }
    const target = path.join(OUT_DIR, `${entry.lessonId}.lesson.json`);
    const rel = path.relative(ROOT, target);
    const existing = await readJson(target);
    const summary = `${stats.sections} sections, ${stats.blocks} blocks, ${stats.table || 0} tables`;
    if (existing && existing.provenance && existing.provenance.author !== 'migration') {
      console.log(`- ${rel}: kept (hand-edited, author "${existing.provenance.author}")`);
      continue;
    }
    const content = `${JSON.stringify(lesson, null, 2)}\n`;
    if (existing && JSON.stringify(existing, null, 2) === content.trimEnd()) {
      console.log(`= ${rel}: unchanged`);
      continue;
    }
    if (existing && !force) {
      console.log(`- ${rel}: exists (use --force to overwrite)`);
      continue;
    }
    if (dryRun) {
      console.log(`· ${rel}: would write (${summary})`);
      continue;
    }
    await fs.writeFile(target, content);
    console.log(`✓ ${rel} (${summary})`);
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
