#!/usr/bin/env node
/**
 * Checks reviewer output against content/schema/review.v1.json and applies the rubric.v1 pass
 * rule deterministically, so nobody has to trust a model's arithmetic.
 *
 * Several reviews of the same lesson (pedagogy-reviewer, ja-editor, visual-qa) are merged:
 * for each criterion the lowest score counts, and all must-fix items are kept.
 *
 * Usage:
 *   node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>… [--json]
 *   cat review.json | node .claude/skills/review-lesson/scripts/check-review.mjs -
 *
 * Exit codes: 0 pass · 1 not passing yet (revise, reject, or criteria nobody scored) ·
 * 2 invalid input (not JSON, does not match review.v1, reviews of different lessons).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** @param {string} [root] */
export function loadSchemas(root = ROOT) {
  const read = (/** @type {string} */ name) => JSON.parse(fs.readFileSync(path.join(root, 'content', 'schema', name), 'utf8'));
  return { review: read('review.v1.json'), rubric: read('rubric.v1.json') };
}

/**
 * Minimal JSON Schema check for the keywords review.v1 uses: type, enum, required,
 * properties, additionalProperties: false, items.
 *
 * @param {unknown} value
 * @param {any} schema
 * @param {string} [at]
 * @returns {string[]} errors as "path: message"
 */
export function checkSchema(value, schema, at = '$') {
  /** @type {string[]} */
  const errors = [];
  const type = schema.type;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (type === 'integer') {
    if (!Number.isInteger(value)) return [`${at}: expected an integer`];
  } else if (type && actual !== type) {
    return [`${at}: expected ${type}, got ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  if (type === 'object' && value && typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value);
    for (const key of schema.required || []) if (!(key in obj)) errors.push(`${at}.${key}: required`);
    for (const [key, child] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...checkSchema(child, sub, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${key}: unknown field`);
    }
  }
  if (type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...checkSchema(item, schema.items, `${at}[${i}]`)));
  }
  return errors;
}

/**
 * Validates and merges reviews of one lesson.
 *
 * @param {any[]} reviews
 * @param {{ review: any, rubric: any }} schemas
 */
export function evaluateReviews(reviews, schemas) {
  /** @type {string[]} */
  const errors = [];
  reviews.forEach((r, i) => {
    for (const e of checkSchema(r, schemas.review)) errors.push(`review ${i + 1}${r?.reviewer ? ` (${r.reviewer})` : ''}: ${e}`);
    const seen = new Set();
    for (const s of Array.isArray(r?.scores) ? r.scores : []) {
      if (seen.has(s.id)) errors.push(`review ${i + 1}: criterion "${s.id}" is scored twice`);
      seen.add(s.id);
    }
  });
  const ids = [...new Set(reviews.map((r) => r?.lessonId).filter(Boolean))];
  if (ids.length > 1) errors.push(`reviews are for different lessons: ${ids.join(', ')}`);
  if (errors.length) return { valid: false, errors };

  const pass = schemas.rubric.pass;
  const criteria = schemas.rubric.criteria.map((/** @type {any} */ c) => c.id);
  /** @type {Map<string, { score: number, reviewers: string[], evidence: string[] }>} */
  const merged = new Map();
  for (const r of reviews) {
    for (const s of r.scores) {
      const cur = merged.get(s.id);
      if (!cur) merged.set(s.id, { score: s.score, reviewers: [r.reviewer], evidence: [`${r.reviewer}: ${s.evidence}`] });
      else {
        cur.score = Math.min(cur.score, s.score);
        cur.reviewers.push(r.reviewer);
        cur.evidence.push(`${r.reviewer}: ${s.evidence}`);
      }
    }
  }
  const missing = criteria.filter((/** @type {string} */ id) => !merged.has(id));
  const scored = criteria.filter((/** @type {string} */ id) => merged.has(id)).map((/** @type {string} */ id) => ({ id, ...merged.get(id) }));
  const mean = scored.length ? Math.round((scored.reduce((n, s) => n + s.score, 0) / scored.length) * 100) / 100 : 0;
  const below = scored.filter((s) => s.score < pass.minEach).map((s) => s.id);
  const mustFix = reviews.flatMap((r) => r.mustFix.map((/** @type {any} */ m) => ({ reviewer: r.reviewer, ...m })));
  const rejected = reviews.some((r) => r.verdict === 'reject');

  /** @type {'pass' | 'revise' | 'reject' | 'incomplete'} */
  let verdict;
  if (rejected) verdict = 'reject';
  else if (below.length || mean < pass.minMean || (pass.noMustFix && mustFix.length)) verdict = 'revise';
  else if (missing.length) verdict = 'incomplete';
  else verdict = 'pass';

  return {
    valid: true,
    errors,
    lessonId: ids[0] ?? null,
    reviewers: reviews.map((r) => r.reviewer),
    verdict,
    mean,
    minEach: pass.minEach,
    minMean: pass.minMean,
    below,
    missing,
    scores: scored,
    mustFix,
    niceToHave: reviews.flatMap((r) => r.niceToHave),
  };
}

/** @param {string} source */
function readInput(source) {
  const text = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(process.cwd(), source), 'utf8');
  const json = JSON.parse(text);
  return Array.isArray(json) ? json : [json];
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const sources = argv.filter((a) => a !== '--json');
  if (sources.length === 0) {
    console.error('Usage: node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>… [--json]  (use - for stdin)');
    return 2;
  }
  /** @type {any[]} */
  let reviews;
  try {
    reviews = sources.flatMap(readInput);
  } catch (error) {
    console.error(`Cannot read the review: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const result = evaluateReviews(reviews, loadSchemas());
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.valid) {
    console.error('Not a valid review.v1 document:');
    for (const e of result.errors) console.error(`  - ${e}`);
  } else {
    console.log(`Review of ${result.lessonId} by ${result.reviewers?.join(', ')}: ${String(result.verdict).toUpperCase()}`);
    console.log(`  mean ${result.mean} (needs ≥ ${result.minMean}) · every criterion ≥ ${result.minEach}`);
    for (const s of result.scores ?? []) console.log(`  ${s.score < (result.minEach ?? 3) ? '✗' : '✓'} ${s.id.padEnd(10)} ${s.score}  (${s.reviewers.join(', ')})`);
    if (result.missing?.length) console.log(`  not scored yet: ${result.missing.join(', ')}`);
    for (const m of result.mustFix ?? []) console.log(`  must fix [${m.criterion}] ${m.blockId}: ${m.issue} → ${m.fix}`);
  }
  if (!result.valid) return 2;
  return result.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
