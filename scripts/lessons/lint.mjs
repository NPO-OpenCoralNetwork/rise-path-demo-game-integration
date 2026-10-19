#!/usr/bin/env node
/**
 * Pedagogy lint for risepath.lesson/v1 lessons (rules in shared/lesson/lint.js, PLAN §5.4/§7.2).
 * Files are validated first; a file with validation errors fails regardless of --strict.
 *
 * Usage:
 *   npm run lessons:lint                                            # everything under content/
 *   npm run lessons:lint -- content/courses/vibe-coding/lessons/vibe-ch1.lesson.json --strict
 *   npm run lessons:lint -- --format json|github|text
 *   npm run lessons:lint -- --strict --include-migrated            # gate migrated chapters too
 *
 * Warnings exit 0, unless --strict (then any warning exits 1). Under --strict, warnings of
 * migrated-unreviewed lessons (machine-migrated, not reworked; see lintPolicy in
 * shared/lesson/lint.js) are printed as advisory and do not fail. Drafts are always strict;
 * --include-migrated makes every lesson strict.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintLesson, lintPolicy, LINT_RULES } from '../../shared/lesson/lint.js';
import { parseArgs, collectFiles, validateFile } from './validate.mjs';

/** @param {string} value */
const ghEscape = (value) => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * validate.mjs options plus `--include-migrated`.
 *
 * @param {string[]} argv
 */
export function parseLintArgs(argv) {
  const includeMigrated = argv.includes('--include-migrated');
  return { ...parseArgs(argv.filter((arg) => arg !== '--include-migrated')), includeMigrated };
}

/**
 * True for a lesson file that lives in a `drafts/` folder (`content/courses/<slug>/drafts/`).
 *
 * @param {string} file
 */
export const isDraftFile = (file) => path.basename(path.dirname(path.resolve(file))) === 'drafts';

/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function main() {
  const args = parseLintArgs(process.argv.slice(2));
  const files = (await collectFiles(args.paths, { drafts: args.drafts })).filter((f) => f.endsWith('.lesson.json'));
  if (files.length === 0) {
    console.error('No *.lesson.json files found.');
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const file of files) {
    const validation = await validateFile(file);
    const lesson = validation.ok ? validation.lesson : null;
    const warnings = lesson ? lintLesson(lesson).warnings : [];
    const policy = lesson ? lintPolicy(lesson, { draft: isDraftFile(file), includeMigrated: args.includeMigrated }) : 'strict';
    results.push({ file: validation.file, ok: validation.ok, policy, errors: validation.errors, warnings });
  }

  const errorCount = results.reduce((n, r) => n + r.errors.length, 0);
  const warningCount = results.reduce((n, r) => n + r.warnings.length, 0);
  const advisory = results.filter((r) => r.policy === 'advisory');
  const advisoryCount = advisory.reduce((n, r) => n + r.warnings.length, 0);
  const gatedCount = warningCount - advisoryCount;
  const ok = errorCount === 0 && (!args.strict || gatedCount === 0);

  if (args.format === 'json') {
    console.log(JSON.stringify({ ok, strict: args.strict, includeMigrated: args.includeMigrated, advisoryWarnings: advisoryCount, files: results }, null, 2));
  } else if (args.format === 'github') {
    for (const r of results) {
      const level = args.strict && r.policy === 'strict' ? 'error' : 'warning';
      const title = r.policy === 'advisory' ? 'lessons:lint (advisory, migrated-unreviewed)' : 'lessons:lint';
      for (const e of r.errors) console.log(`::error file=${r.file},title=lessons:validate::${ghEscape(`${e.path}: ${e.message}`)}`);
      for (const w of r.warnings) console.log(`::${level} file=${r.file},title=${title} ${w.rule}::${ghEscape(`${w.path}: ${w.message}`)}`);
    }
  } else {
    for (const r of results) {
      const mark = !r.ok ? '✗' : r.warnings.length > 0 ? '!' : '✓';
      const note = r.warnings.length === 0 ? '' : ` (${plural(r.warnings.length, 'warning')}${r.policy === 'advisory' ? ', advisory: migrated-unreviewed' : ''})`;
      console.log(`${mark} ${r.file}${note}`);
      for (const e of r.errors) console.log(`    error  ${e.path}: ${e.message}`);
      for (const w of r.warnings) console.log(`    ${w.rule.padEnd(22)} ${w.path}: ${w.message}`);
    }
    /** @type {Record<string, number>} */
    const byRule = {};
    for (const r of results) for (const w of r.warnings) byRule[w.rule] = (byRule[w.rule] || 0) + 1;
    const ruleSummary = Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([rule, n]) => `${rule} ×${n}`).join(', ');
    console.log(`\n${plural(results.length, 'lesson file')}: ${plural(errorCount, 'error')}, ${plural(warningCount, 'warning')}${ruleSummary ? ` (${ruleSummary})` : ''}.`);
    if (advisoryCount > 0) {
      console.log(`Advisory: ${plural(advisoryCount, 'warning')} in ${plural(advisory.length, 'migrated-unreviewed lesson')} (machine-migrated, not reworked); --strict does not fail on them, --strict --include-migrated does.`);
    }
    if (warningCount > 0 && !args.strict) console.log(`Rules: ${Object.keys(LINT_RULES).length} (see shared/lesson/lint.js). Use --strict to fail on warnings.`);
  }

  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
