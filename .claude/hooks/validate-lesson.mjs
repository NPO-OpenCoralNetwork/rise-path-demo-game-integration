#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: validates a lesson right after Claude writes or edits it.
 *
 * Input (stdin): the PostToolUse JSON, e.g.
 *   {"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/abs/content/courses/x/drafts/y.lesson.json",…},…}
 *
 * - Not a content/**\/*.lesson.json or content/courses/*\/course.json file → exit 0, silent.
 * - Invalid (risepath.lesson/v1 zod + semantic checks, scripts/lessons/validate.mjs) → the
 *   errors with their JSON paths on stderr, exit 2. Claude Code shows stderr to Claude, which
 *   fixes the file before moving on (the edit itself has already happened).
 * - Valid → exit 0. Lint warnings, if any, go back as additionalContext (not blocking).
 * - The hook itself failing (bad input, missing modules) → exit 1: a non-blocking notice.
 *
 * Wiring: the author-lesson skill registers it in its frontmatter while the skill runs;
 * .claude/settings.example.json shows the always-on project wiring (owner opt-in).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_ERRORS = 25;

/**
 * Whether the hook should check this file: lesson JSON anywhere under a content/ folder,
 * or a course.json under content/courses/<slug>/.
 *
 * @param {string} file
 */
export function isLessonPath(file) {
  const posix = file.split(path.sep).join('/');
  return /(^|\/)content\/(.+\/)?[^/]+\.lesson\.json$/.test(posix) || /(^|\/)content\/courses\/[^/]+\/course\.json$/.test(posix);
}

/**
 * @param {any} input PostToolUse hook input
 * @returns {string | null} absolute path of the written file
 */
export function targetFile(input) {
  const raw = input?.tool_input?.file_path ?? input?.tool_input?.path ?? input?.tool_response?.filePath;
  if (typeof raw !== 'string' || raw === '') return null;
  const base = typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.env.CLAUDE_PROJECT_DIR || ROOT;
  return path.resolve(base, raw);
}

/**
 * @param {string} file absolute path
 * @param {{ path: string, message: string }[]} errors
 */
export function formatErrors(file, errors) {
  const rel = path.relative(ROOT, file);
  const shown = rel.startsWith('..') ? file : rel;
  const lines = errors.slice(0, MAX_ERRORS).map((e) => `- ${e.path || '(root)'}: ${e.message}`);
  if (errors.length > MAX_ERRORS) lines.push(`- … and ${errors.length - MAX_ERRORS} more (npm run lessons:validate -- ${shown})`);
  return [
    `risepath.lesson/v1 validation failed for ${shown} (${errors.length} error${errors.length === 1 ? '' : 's'}):`,
    ...lines,
    'Fix every error above (paths are JSON paths inside the file), then continue.',
    'Rules: .claude/rules/content.md · schema: content/schema/lesson.schema.json',
  ].join('\n');
}

/**
 * Runs the hook. Returns the exit code and what to print, so tests can call it directly.
 *
 * @param {string} stdin
 * @returns {Promise<{ code: number, stdout?: string, stderr?: string }>}
 */
export async function runHook(stdin) {
  let input;
  try {
    input = JSON.parse(stdin || '{}');
  } catch {
    return { code: 1, stderr: 'validate-lesson hook: stdin is not JSON.' };
  }
  const file = targetFile(input);
  if (!file || !isLessonPath(file)) return { code: 0 };
  if (!fs.existsSync(file)) return { code: 0 };

  let validateFile;
  let lintLesson;
  try {
    ({ validateFile } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lessons', 'validate.mjs')).href));
    ({ lintLesson } = await import(pathToFileURL(path.join(ROOT, 'shared', 'lesson', 'lint.js')).href));
  } catch (error) {
    return { code: 1, stderr: `validate-lesson hook could not load the validator: ${error instanceof Error ? error.message : String(error)}` };
  }

  const result = await validateFile(file);
  if (!result.ok) return { code: 2, stderr: formatErrors(file, result.errors) };

  if (result.kind === 'lesson' && result.lesson) {
    const { warnings } = lintLesson(result.lesson);
    if (warnings.length > 0) {
      const rel = path.relative(ROOT, file);
      const top = warnings.slice(0, 8).map((/** @type {any} */ w) => `- [${w.rule}] ${w.path}: ${w.message}`);
      const more = warnings.length > 8 ? [`- … ${warnings.length - 8} more: npm run lessons:lint -- ${rel}`] : [];
      return {
        code: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: [`${rel} is valid. Lint: ${warnings.length} pedagogy warning(s) to resolve before review:`, ...top, ...more].join('\n'),
          },
        }),
      };
    }
  }
  return { code: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stdin = '';
  try {
    stdin = fs.readFileSync(0, 'utf8');
  } catch {
    stdin = '';
  }
  runHook(stdin).then(({ code, stdout, stderr }) => {
    if (stdout) process.stdout.write(`${stdout}\n`);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`validate-lesson hook failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
