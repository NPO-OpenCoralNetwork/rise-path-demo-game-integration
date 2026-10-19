#!/usr/bin/env node
/**
 * Checks reviewer output against content/schema/review.v1.json and applies the rubric.v1 pass
 * rule deterministically, so nobody has to trust a model's arithmetic.
 *
 * Several reviews of the same lesson (pedagogy-reviewer, ja-editor, visual-qa) are merged:
 * for each criterion the lowest score counts, and all must-fix items are kept.
 *
 * Review modes (.claude/skills/review-lesson/SKILL.md):
 * - full (default, also when `mode` is absent): unchanged behaviour.
 * - verify (fix-verification round): needs `verifies` and `resolved`; every `resolved` entry with
 *   status "unresolved" counts as an open must-fix. A verify review that records
 *   `fullReviewRequired: true` or a changed share above 30% is invalid (a full review is due).
 *   When the previous review can be loaded (`--previous`, or `verifies.previousReview` as an
 *   existing file or <commit>:<path>), every previous open must-fix without a `resolved` entry
 *   counts as open too, and a carried-over score must equal the previous score.
 *
 * Usage:
 *   node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>… [--previous <review.json | commit:path>]… [--json]
 *   cat review.json | node .claude/skills/review-lesson/scripts/check-review.mjs -
 *
 * Exit codes: 0 pass · 1 not passing yet (revise, reject, or criteria nobody scored) ·
 * 2 invalid input (not JSON, does not match review.v1, reviews of different lessons, a verify
 * review that is not allowed or contradicts its previous review).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FULL_REVIEW_SHARE } from './review-scope.mjs';

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
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.map((/** @type {unknown} */ v) => JSON.stringify(v)).join(', ')}`);
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

/** @param {any} r */
const isVerify = (r) => r?.mode === 'verify';

/** @param {{ criterion: string, blockId: string }} item */
const itemKey = (item) => `${item.criterion}\u0000${item.blockId}`;

/**
 * Rules of the review modes that JSON Schema alone does not express.
 *
 * @param {any} r
 * @returns {string[]}
 */
export function modeErrors(r) {
  if (!r || typeof r !== 'object') return [];
  /** @type {string[]} */
  const errors = [];
  const carried = (Array.isArray(r.scores) ? r.scores : []).filter((/** @type {any} */ s) => s?.carriedOver === true).map((/** @type {any} */ s) => s.id);
  if (isVerify(r)) {
    if (!r.verifies) errors.push('mode "verify" needs "verifies" (reviewedRevision, previousReview, changed, fullReviewRequired from review-scope.mjs)');
    if (!Array.isArray(r.resolved)) errors.push('mode "verify" needs "resolved": one entry per open must-fix item of the previous review');
    const v = r.verifies;
    if (v?.fullReviewRequired === true) {
      errors.push(`the lesson changed structurally since ${v.reviewedRevision}: review-scope.mjs requires a full review, not a verification`);
    } else if (typeof v?.changedShare === 'number' && v.changedShare > FULL_REVIEW_SHARE) {
      errors.push(`${Math.round(v.changedShare * 100)}% of the blocks changed since ${v.reviewedRevision}: above ${Math.round(FULL_REVIEW_SHARE * 100)}% a full review is required, not a verification`);
    }
  } else {
    for (const key of ['verifies', 'resolved']) if (key in r) errors.push(`"${key}" belongs to mode "verify"`);
    if (carried.length) errors.push(`carriedOver scores (${carried.join(', ')}) belong to mode "verify"; a full review scores every criterion afresh`);
  }
  return errors;
}

/**
 * Open must-fix items of a review: its mustFix, plus the earlier items it found unresolved.
 *
 * @param {any} review
 * @returns {{ criterion: string, blockId: string, issue: string, fix: string }[]}
 */
export function openItems(review) {
  const own = Array.isArray(review?.mustFix) ? review.mustFix : [];
  const reopened = (Array.isArray(review?.resolved) ? review.resolved : [])
    .filter((/** @type {any} */ v) => v.status === 'unresolved' && !own.some((/** @type {any} */ m) => itemKey(m) === itemKey(v)))
    .map((/** @type {any} */ v) => ({ criterion: v.criterion, blockId: v.blockId, issue: v.evidence, fix: 'See the review before it.' }));
  return [...own, ...reopened];
}

/**
 * Validates and merges reviews of one lesson.
 *
 * @param {any[]} reviews
 * @param {{ review: any, rubric: any }} schemas
 * @param {{ previous?: any[] }} [options] previous reviews (matched by reviewer) of verify-mode reviews
 */
export function evaluateReviews(reviews, schemas, options = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const label = (/** @type {any} */ r, /** @type {number} */ i) => `review ${i + 1}${r?.reviewer ? ` (${r.reviewer})` : ''}`;
  reviews.forEach((r, i) => {
    for (const e of checkSchema(r, schemas.review)) errors.push(`${label(r, i)}: ${e}`);
    const seen = new Set();
    for (const s of Array.isArray(r?.scores) ? r.scores : []) {
      if (seen.has(s.id)) errors.push(`review ${i + 1}: criterion "${s.id}" is scored twice`);
      seen.add(s.id);
    }
    for (const e of modeErrors(r)) errors.push(`${label(r, i)}: ${e}`);
  });
  const ids = [...new Set(reviews.map((r) => r?.lessonId).filter(Boolean))];
  if (ids.length > 1) errors.push(`reviews are for different lessons: ${ids.join(', ')}`);

  /** @type {Map<string, any>} */
  const previousBy = new Map();
  for (const p of options.previous ?? []) {
    const name = `previous review${p?.reviewer ? ` (${p.reviewer})` : ''}`;
    const problems = checkSchema(p, schemas.review);
    if (problems.length) {
      errors.push(...problems.map((e) => `${name}: ${e}`));
      continue;
    }
    if (ids.length && p.lessonId !== ids[0]) errors.push(`${name}: is for ${p.lessonId}, not ${ids[0]}`);
    else previousBy.set(p.reviewer, p);
  }

  if (errors.length) return { valid: false, errors, warnings };

  // Carried-over scores must be the previous scores.
  for (const r of reviews.filter(isVerify)) {
    const prev = previousBy.get(r.reviewer);
    if (!prev || !Array.isArray(r.scores)) continue;
    const before = new Map(prev.scores.map((/** @type {any} */ s) => [s.id, s.score]));
    for (const s of r.scores.filter((/** @type {any} */ x) => x.carriedOver === true)) {
      if (!before.has(s.id)) errors.push(`${r.reviewer}: "${s.id}" is carried over, but the previous review did not score it`);
      else if (before.get(s.id) !== s.score) errors.push(`${r.reviewer}: "${s.id}" is carried over as ${s.score}, but the previous review gave ${before.get(s.id)}`);
    }
  }
  if (errors.length) return { valid: false, errors, warnings };

  /** @type {any[]} still-open items of verification rounds (unresolved, or never verified) */
  const reopened = [];
  for (const r of reviews.filter(isVerify)) {
    const prev = previousBy.get(r.reviewer);
    const previousOpen = prev ? openItems(prev) : [];
    const fixOf = (/** @type {any} */ item) => previousOpen.find((p) => itemKey(p) === itemKey(item))?.fix;
    for (const v of r.resolved) {
      if (v.status !== 'unresolved' || r.mustFix.some((/** @type {any} */ m) => itemKey(m) === itemKey(v))) continue;
      reopened.push({
        reviewer: r.reviewer,
        criterion: v.criterion,
        blockId: v.blockId,
        issue: `Unresolved from the previous review: ${v.evidence}`,
        fix: fixOf(v) ?? `Apply the previous must-fix item (${r.verifies.previousReview}).`,
        status: 'unresolved',
      });
    }
    if (prev) {
      /** @type {Map<string, number>} */
      const listed = new Map();
      for (const v of r.resolved) listed.set(itemKey(v), (listed.get(itemKey(v)) ?? 0) + 1);
      for (const item of previousOpen) {
        const left = listed.get(itemKey(item)) ?? 0;
        if (left > 0) {
          listed.set(itemKey(item), left - 1);
          continue;
        }
        if (r.mustFix.some((/** @type {any} */ m) => itemKey(m) === itemKey(item))) continue;
        reopened.push({
          reviewer: r.reviewer,
          criterion: item.criterion,
          blockId: item.blockId,
          issue: `Not verified: the previous must-fix "${item.issue}" has no entry in "resolved".`,
          fix: item.fix,
          status: 'unverified',
        });
      }
      for (const [key, left] of listed) {
        const [criterion, blockId] = key.split('\u0000');
        if (left > 0) warnings.push(`${r.reviewer}: "resolved" lists [${criterion}] ${blockId}, which was not an open must-fix of the previous review`);
      }
    } else {
      warnings.push(`${r.reviewer}: the previous review (${r.verifies.previousReview}) was not loaded, so nothing checked that "resolved" covers every previous must-fix; pass --previous <file or commit:path>`);
    }
    const changed = new Set(r.verifies.changed);
    for (const m of r.mustFix) {
      if (m.blockId === 'lesson' || changed.has(m.blockId) || changed.has(`section.${m.blockId}`)) continue;
      if (r.resolved.some((/** @type {any} */ v) => v.status === 'unresolved' && itemKey(v) === itemKey(m))) continue;
      warnings.push(`${r.reviewer}: new must-fix on ${m.blockId}, which did not change since ${r.verifies.reviewedRevision}; in a verification round that is only for a regression the changes caused (the issue should name the change)`);
    }
  }

  const pass = schemas.rubric.pass;
  const criteria = schemas.rubric.criteria.map((/** @type {any} */ c) => c.id);
  /** @type {Map<string, { score: number, reviewers: string[], carriedBy: string[], evidence: string[] }>} */
  const merged = new Map();
  for (const r of reviews) {
    for (const s of r.scores) {
      const cur = merged.get(s.id);
      const carriedBy = s.carriedOver === true ? [r.reviewer] : [];
      if (!cur) merged.set(s.id, { score: s.score, reviewers: [r.reviewer], carriedBy, evidence: [`${r.reviewer}: ${s.evidence}`] });
      else {
        cur.score = Math.min(cur.score, s.score);
        cur.reviewers.push(r.reviewer);
        cur.carriedBy.push(...carriedBy);
        cur.evidence.push(`${r.reviewer}: ${s.evidence}`);
      }
    }
  }
  const missing = criteria.filter((/** @type {string} */ id) => !merged.has(id));
  const scored = criteria.filter((/** @type {string} */ id) => merged.has(id)).map((/** @type {string} */ id) => ({ id, ...merged.get(id) }));
  const mean = scored.length ? Math.round((scored.reduce((n, s) => n + s.score, 0) / scored.length) * 100) / 100 : 0;
  const below = scored.filter((s) => s.score < pass.minEach).map((s) => s.id);
  const mustFix = [...reviews.flatMap((r) => r.mustFix.map((/** @type {any} */ m) => ({ reviewer: r.reviewer, ...m }))), ...reopened];
  const rejected = reviews.some((r) => r.verdict === 'reject');

  /** @type {'pass' | 'revise' | 'reject' | 'incomplete'} */
  let verdict;
  if (rejected) verdict = 'reject';
  else if (below.length || mean < pass.minMean || (pass.noMustFix && mustFix.length)) verdict = 'revise';
  else if (missing.length) verdict = 'incomplete';
  else verdict = 'pass';

  const rounds = reviews.map((r) => (isVerify(r)
    ? {
      reviewer: r.reviewer,
      mode: 'verify',
      reviewedRevision: r.verifies.reviewedRevision,
      previousReview: r.verifies.previousReview,
      previousChecked: previousBy.has(r.reviewer),
      changed: r.verifies.changed.length,
      resolved: r.resolved.filter((/** @type {any} */ v) => v.status === 'resolved').length,
      unresolved: r.resolved.filter((/** @type {any} */ v) => v.status === 'unresolved').length,
      carriedOver: r.scores.filter((/** @type {any} */ s) => s.carriedOver === true).map((/** @type {any} */ s) => s.id),
    }
    : { reviewer: r.reviewer, mode: 'full' }));

  return {
    valid: true,
    errors,
    warnings,
    lessonId: ids[0] ?? null,
    reviewers: reviews.map((r) => r.reviewer),
    rounds,
    verdict,
    mean,
    minEach: pass.minEach,
    minMean: pass.minMean,
    below,
    missing,
    scores: scored,
    mustFix,
    resolved: reviews.flatMap((r) => (isVerify(r) ? r.resolved.map((/** @type {any} */ v) => ({ reviewer: r.reviewer, ...v })) : [])),
    niceToHave: reviews.flatMap((r) => r.niceToHave),
  };
}

/** @param {string} text */
function parseReviews(text) {
  const json = JSON.parse(text);
  return Array.isArray(json) ? json : [json];
}

/** @param {string} source */
function readInput(source) {
  const text = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(process.cwd(), source), 'utf8');
  return parseReviews(text);
}

/**
 * Reads a previous review from a file (relative to the working directory or the repository root)
 * or from git (<commit>:<path>). Null when neither works.
 *
 * @param {string} spec
 * @returns {{ file: string | null, reviews: any[] } | null}
 */
export function readPrevious(spec) {
  for (const base of [process.cwd(), ROOT]) {
    const file = path.resolve(base, spec);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return { file, reviews: parseReviews(fs.readFileSync(file, 'utf8')) };
  }
  if (/^[^:\s]+:[^:\s]+$/.test(spec)) {
    const res = spawnSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.status === 0) return { file: null, reviews: parseReviews(res.stdout) };
  }
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  /** @type {string[]} */
  const sources = [];
  /** @type {string[]} */
  const previousSpecs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') continue;
    if (argv[i] === '--previous') {
      const spec = argv[i + 1];
      if (!spec) {
        console.error('--previous needs a review file or <commit>:<path>');
        return 2;
      }
      previousSpecs.push(spec);
      i += 1;
    } else sources.push(argv[i]);
  }
  if (sources.length === 0) {
    console.error('Usage: node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>… [--previous <review.json | commit:path>]… [--json]  (use - for stdin)');
    return 2;
  }
  /** @type {any[]} */
  let reviews;
  /** @type {any[]} */
  const previous = [];
  try {
    reviews = sources.flatMap(readInput);
    for (const spec of previousSpecs) {
      const found = readPrevious(spec);
      if (!found) throw new Error(`--previous ${spec}: not a file, and git cannot show it`);
      previous.push(...found.reviews);
    }
  } catch (error) {
    console.error(`Cannot read the review: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  // A verification review names its previous review; load it when --previous did not give one.
  const inputFiles = new Set(sources.filter((s) => s !== '-').map((s) => path.resolve(process.cwd(), s)));
  /** @type {string[]} */
  const notes = [];
  for (const r of reviews) {
    const spec = r?.mode === 'verify' && typeof r.verifies?.previousReview === 'string' ? r.verifies.previousReview : null;
    if (!spec || previous.some((p) => p?.reviewer === r.reviewer)) continue;
    let found = null;
    try {
      found = readPrevious(spec);
    } catch (error) {
      notes.push(`${r.reviewer}: cannot read ${spec}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!found) continue;
    if (found.file && inputFiles.has(found.file)) {
      notes.push(`${r.reviewer}: verifies.previousReview is the file being checked (overwritten by this round); pass --previous <commit>:<path> or the snapshot copy`);
      continue;
    }
    const match = found.reviews.find((p) => p?.reviewer === r.reviewer);
    if (match) previous.push(match);
    else notes.push(`${r.reviewer}: ${spec} holds no review by ${r.reviewer}`);
  }

  const result = evaluateReviews(reviews, loadSchemas(), { previous });
  result.warnings = [...notes, ...(result.warnings ?? [])];
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.valid) {
    console.error('Not a valid review.v1 document:');
    for (const e of result.errors) console.error(`  - ${e}`);
  } else {
    console.log(`Review of ${result.lessonId} by ${result.reviewers?.join(', ')}: ${String(result.verdict).toUpperCase()}`);
    for (const round of result.rounds ?? []) {
      if (round.mode === 'full') console.log(`  ${round.reviewer}: full review`);
      else {
        console.log(`  ${round.reviewer}: verification of ${round.reviewedRevision} (previous review ${round.previousChecked ? 'cross-checked' : 'not loaded'}) · ${round.resolved} resolved, ${round.unresolved} unresolved · ${round.changed} changed`
          + ` · carried over: ${round.carriedOver?.length ? round.carriedOver.join(', ') : 'none'}`);
      }
    }
    console.log(`  mean ${result.mean} (needs ≥ ${result.minMean}) · every criterion ≥ ${result.minEach}`);
    for (const s of result.scores ?? []) {
      const who = s.reviewers.map((name) => (s.carriedBy.includes(name) ? `${name} carried` : name)).join(', ');
      console.log(`  ${s.score < (result.minEach ?? 3) ? '✗' : '✓'} ${s.id.padEnd(10)} ${s.score}  (${who})`);
    }
    if (result.missing?.length) console.log(`  not scored yet: ${result.missing.join(', ')}`);
    for (const v of result.resolved ?? []) if (v.status === 'resolved') console.log(`  resolved [${v.criterion}] ${v.blockId} (${v.reviewer})`);
    for (const m of result.mustFix ?? []) console.log(`  must fix${m.status ? ` (${m.status})` : ''} [${m.criterion}] ${m.blockId}: ${m.issue} → ${m.fix}`);
  }
  for (const w of result.warnings ?? []) console.error(`  note: ${w}`);
  if (!result.valid) return 2;
  return result.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
