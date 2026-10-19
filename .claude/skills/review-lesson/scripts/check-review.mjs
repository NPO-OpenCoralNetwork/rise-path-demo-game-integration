#!/usr/bin/env node
/**
 * Checks reviewer output against content/schema/review.v1.json and applies the rubric.v1 pass
 * rule deterministically, so nobody has to trust a model's arithmetic.
 *
 * Several reviews of the same lesson (pedagogy-reviewer, ja-editor, visual-qa) are merged, one
 * review per reviewer: for each criterion the lowest score counts, and all must-fix items are kept.
 *
 * The lesson: `--lesson <file>`, or else the lesson the reviews name. Every review's `file` is
 * content/courses/<course>/drafts/<lessonId>.lesson.json or lessons/<lessonId>.lesson.json, and the
 * gate hashes whichever of the two exists (a draft published since is found under lessons/). When
 * both exist and differ, --lesson must say which one the reviews are for.
 *
 * Fresh reviews only: every review records `lessonHash`, the hash of the lesson it read
 * (`review-scope.mjs <lesson> --hash`), and it must be the hash of the lesson as it is now. A review
 * with another hash is stale. A review without one is stale too, unless `--allow-legacy` accepts
 * reviews written before the field existed (with a warning).
 *
 * Review modes (.claude/skills/review-lesson/SKILL.md):
 * - full (default, also when `mode` is absent).
 * - verify (fix-verification round): needs `verifies` and `resolved`, and the gate checks it
 *   against the round it verifies, refusing the review (exit 2) when any check cannot be made:
 *   - the previous review is a recorded round: `verifies.previousReview` is
 *     <commit>:content/courses/<course>/reports/<lesson>.<reviewer>.review.json or the snapshot copy
 *     .artifacts/review/<course>/<lesson>/<hash>/<round>/<reviewer>.review.json. Any other file, the
 *     file being checked and the working-tree reports file are refused. `--previous` stands in only
 *     for a review written before lessonHash existed that names its own reports file.
 *   - the previous review must be valid itself: a previous verification is followed back to its
 *     full review, and every round on the way is checked as this one is. A round the gate refuses
 *     cannot be verified. Its open items (unresolved, never verified, or "resolved" without a
 *     change) stay open in the next round.
 *   - a previous review without lessonHash needs --allow-legacy, and `verifies.reviewedRevision`
 *     must then be the commit that holds it or an earlier one.
 *   - the scope since `verifies.reviewedRevision` is recomputed with review-scope.mjs (the version
 *     with the previous review's lessonHash). A verification is refused when the recomputed scope
 *     requires a full review, or when `verifies.changed` leaves out a change.
 *   - every criterion the previous review scored is listed: re-scored, or carried over with the
 *     previous score.
 *   - every previous open must-fix needs a `resolved` entry. An `unresolved` entry, a missing one,
 *     and a `resolved` one whose block (or a block in its `fixedIn`) did not change since the review
 *     that raised the item, count as open must-fix items.
 *   - every reviewer of a verified round (the reviews recorded next to the previous review) is in
 *     this set: with that same review, with a verification that goes back to it, or with a full
 *     review.
 *
 * Usage:
 *   node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>… [--lesson <lesson.json>]
 *     [--previous <commit:path | snapshot copy>]… [--allow-legacy] [--json]
 *   cat review.json | node .claude/skills/review-lesson/scripts/check-review.mjs - [--lesson <lesson.json>]
 *
 * Exit codes: 0 pass · 1 not passing yet (revise, reject, or criteria nobody scored) ·
 * 2 invalid input (not JSON, not review.v1, two reviews by one reviewer, reviews of different
 * lessons, a stale review, a verification whose previous round or scope cannot be checked, that its
 * scope does not allow, that contradicts its previous review, or that leaves out a reviewer of the
 * round it verifies).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from '../../../../shared/lesson/canonical.js';
import { ID_PATTERN } from '../../../../shared/lesson/constants.js';
import {
  FULL_REVIEW_SHARE,
  GIT_REVISION,
  compareLessons,
  git,
  isAncestor,
  lessonHash,
  readBefore,
  resolveCommit,
  snapshotDir,
} from './review-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const USAGE = 'Usage: node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>… [--lesson <lesson.json>] [--previous <commit:path | snapshot copy>]… [--allow-legacy] [--json]  (use - for stdin)';

/** How many recorded rounds a chain of verifications may go back before a full review is due. */
export const MAX_CHAIN = 25;

/** A course folder under content/courses/. */
const COURSE = /^[a-z0-9][a-z0-9_-]*$/i;

/** A reviewer name: no ".", "/" or "\" (it is part of the reports and snapshot file names). */
const REVIEWER = /^(?![\s])[^./\\\u0000-\u001f]+$/;

/** A snapshot folder (the 16 hex digits of a lessonHash) and a round label in it. */
const SNAPSHOT_FOLDER = /^[0-9a-f]{16}$/;
const ROUND_LABEL = /^[a-z0-9][a-z0-9_-]*$/i;

/** @param {string} root */
export function loadSchemas(root = ROOT) {
  const read = (/** @type {string} */ name) => JSON.parse(fs.readFileSync(path.join(root, 'content', 'schema', name), 'utf8'));
  return { review: read('review.v1.json'), rubric: read('rubric.v1.json') };
}

/**
 * Minimal JSON Schema check for the keywords review.v1 uses: type, enum, pattern, required,
 * properties, additionalProperties: false, items. Keys are looked up as own properties only, so
 * "constructor", "toString" or "__proto__" are unknown fields like any other.
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
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  if (type === 'object' && value && typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value);
    const properties = schema.properties ?? {};
    for (const key of schema.required || []) if (!Object.hasOwn(obj, key)) errors.push(`${at}.${key}: required`);
    for (const [key, child] of Object.entries(obj)) {
      if (Object.hasOwn(properties, key)) errors.push(...checkSchema(child, properties[key], `${at}.${key}`));
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

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** @param {{ criterion: string, blockId: string }} item */
const itemKey = (item) => `${item.criterion}\u0000${item.blockId}`;

/** @param {string} text */
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A repo-relative path as reviews write it: "/" separators, no leading "./". @param {unknown} file */
const normalizeFile = (file) => (typeof file === 'string' ? file.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '') : file);

/**
 * The course and folder of a review's `file` when it is the lesson's file:
 * content/courses/<course>/drafts/<lessonId>.lesson.json or lessons/<lessonId>.lesson.json.
 *
 * @param {unknown} file
 * @param {unknown} lessonId
 * @returns {{ course: string, folder: string } | null}
 */
export function lessonFileOf(file, lessonId) {
  const rel = normalizeFile(file);
  if (typeof rel !== 'string' || typeof lessonId !== 'string' || !ID_PATTERN.test(lessonId)) return null;
  const match = new RegExp(`^content/courses/([^/]+)/(drafts|lessons)/${escapeRe(lessonId)}\\.lesson\\.json$`).exec(rel);
  return match && COURSE.test(match[1]) ? { course: match[1], folder: match[2] } : null;
}

/**
 * Rules of the review modes that JSON Schema alone does not express. The scope a verification
 * records is only a first check here; the recomputed scope is checked by checkVerification.
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
 * Everything that makes one review document invalid on its own: review.v1, a criterion scored
 * twice, a lessonId or reviewer that cannot be one, a `file` that is not the lesson's file, and the
 * mode rules. Applied to the reviews being checked and to every previous review of a chain.
 *
 * @param {any} r
 * @param {{ review: any }} schemas
 * @returns {string[]}
 */
export function reviewErrors(r, schemas) {
  const errors = checkSchema(r, schemas.review);
  if (!isObject(r)) return errors;
  const seen = new Set();
  for (const s of Array.isArray(r.scores) ? r.scores : []) {
    if (!isObject(s)) continue;
    if (seen.has(s.id)) errors.push(`criterion "${s.id}" is scored twice`);
    seen.add(s.id);
  }
  if (typeof r.lessonId === 'string' && !ID_PATTERN.test(r.lessonId)) {
    errors.push(`lessonId ${JSON.stringify(r.lessonId)} is not a lesson id`);
  } else if (typeof r.lessonId === 'string' && typeof r.file === 'string' && !lessonFileOf(r.file, r.lessonId)) {
    errors.push(`file ${JSON.stringify(r.file)} is not the lesson's file: content/courses/<course>/drafts/${r.lessonId}.lesson.json or lessons/${r.lessonId}.lesson.json (repo-relative)`);
  }
  if (typeof r.reviewer === 'string' && !REVIEWER.test(r.reviewer)) errors.push(`reviewer ${JSON.stringify(r.reviewer)} is not a reviewer name (no ".", "/" or "\\")`);
  errors.push(...modeErrors(r));
  return errors;
}

/**
 * Open must-fix items of a review on its own: its mustFix, plus the earlier items it found
 * unresolved. (The CLI also carries the items an earlier round left unverified; see followChain.)
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
 * @typedef {ReturnType<typeof compareLessons> & { revision?: string, source?: string }} Scope
 * @typedef {{ criterion: string, blockId: string, issue: string, fix: string, origIssue?: string,
 *   since?: any, touched?: Set<string>, status?: string, note?: string }} OpenItem
 *   since: the lesson version the review that raised the item read; touched: the ids changed
 *   since then, up to the version the verifying review read (both set by the CLI)
 * @typedef {{ kind: 'git', rev: string, sha?: string, short?: string, path: string, dir: string, reviewer: string }
 *   | { kind: 'snapshot', file: string, dir: string, hex: string, round: string, reviewer: string }} Location
 * @typedef {{ key: string, label: string, reviews: Map<string, any>, problems: string[] }} Round
 * @typedef {{ review: any, open: OpenItem[], spec: string, loc?: Location, read?: any, chain: any[],
 *   rounds: Round[], warnings: string[], legacy?: boolean }} Baseline
 * @typedef {Baseline | { error: string, plain?: boolean } | { invalid: string[], spec: string }} BaselineResult
 */

/**
 * The ids a scope touches (review-scope.mjs `touched`; derived from `changed` for older scopes).
 *
 * @param {any} scope
 * @returns {Set<string>}
 */
function touchedOf(scope) {
  if (Array.isArray(scope?.touched)) return new Set(scope.touched);
  /** @type {Set<string>} */
  const out = new Set();
  for (const c of Array.isArray(scope?.changed) ? scope.changed : []) {
    if (c.startsWith('section.')) out.add(c.slice('section.'.length));
    else if (!c.startsWith('lesson.')) out.add(c);
  }
  if (Array.isArray(scope?.changed) && scope.changed.length) out.add('lesson');
  return out;
}

/**
 * Checks one verification against the round it verifies, and returns the must-fix items still open
 * after it. The CLI calls it for each review being checked and for every earlier round of a chain.
 *
 * @param {any} r the verification (a valid review.v1 document)
 * @param {{ review: any, open: OpenItem[] }} base the previous review and the items open after it
 * @param {Scope | { error: string } | undefined} scope since verifies.reviewedRevision, recomputed
 * @param {{ name?: string, since?: any }} [options] name: how messages name r; since: the lesson r read
 * @returns {{ errors: string[], warnings: string[], open: OpenItem[], carried: OpenItem[], accepted: any[], unchanged: number }}
 */
export function checkVerification(r, base, scope, { name = r?.reviewer ?? 'review', since } = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const prev = base.review;
  const v = r.verifies;
  const rev = v.reviewedRevision;
  const none = { open: [], carried: [], accepted: [], unchanged: 0 };
  if (canonicalJson(prev) === canonicalJson(r)) {
    return { errors: [`${name}: verifies.previousReview is this review itself, not the round before it`], warnings, ...none };
  }

  if (!scope) {
    errors.push(`${name}: the scope since ${rev} was not recomputed, so nothing checked that a verification is allowed`);
  } else if ('error' in scope) {
    errors.push(`${name}: cannot recompute the scope since ${rev}: ${scope.error}`);
  } else if (scope.fullReviewRequired) {
    errors.push(`${name}: the recomputed scope since ${rev} requires a full review, not a verification (${scope.reasons.join('; ')})`);
  } else {
    const listed = new Set(Array.isArray(v.changed) ? v.changed : []);
    const unlisted = scope.changed.filter((c) => !listed.has(c));
    if (unlisted.length) {
      errors.push(`${name}: verifies.changed leaves out ${unlisted.join(', ')}, which changed since ${rev} (recomputed); a verification reviews every change, so copy the verifies line review-scope.mjs prints and review those too`);
    }
    const extra = [...listed].filter((c) => !scope.changed.includes(c));
    if (extra.length) warnings.push(`${name}: verifies.changed lists ${extra.join(', ')}, which did not change since ${rev} (recomputed)`);
    if (typeof v.changedShare === 'number' && v.changedShare !== scope.changedShare) {
      warnings.push(`${name}: verifies.changedShare is ${v.changedShare}, the recomputed share is ${scope.changedShare}`);
    }
  }

  // Every criterion the previous review scored is listed; carried-over scores are the previous scores.
  const before = new Map(prev.scores.map((/** @type {any} */ s) => [s.id, s.score]));
  const listedIds = new Set(r.scores.map((/** @type {any} */ s) => s.id));
  const omitted = [...before.keys()].filter((id) => !listedIds.has(id));
  if (omitted.length) {
    errors.push(`${name}: the previous review scored ${omitted.join(', ')}, which this verification leaves out; list every criterion it scored (re-scored, or copied with "carriedOver": true)`);
  }
  for (const s of r.scores.filter((/** @type {any} */ x) => x.carriedOver === true)) {
    if (!before.has(s.id)) errors.push(`${name}: "${s.id}" is carried over, but the previous review did not score it`);
    else if (before.get(s.id) !== s.score) errors.push(`${name}: "${s.id}" is carried over as ${s.score}, but the previous review gave ${before.get(s.id)}`);
  }
  if (errors.length || !scope || 'error' in scope) return { errors, warnings, ...none };

  // Every open item of the previous round needs an entry; "resolved" counts only after a change.
  const touchedNow = touchedOf(scope);
  const restated = (/** @type {any} */ item) => r.mustFix.some((/** @type {any} */ m) => itemKey(m) === itemKey(item));
  /** @type {Map<string, any[]>} */
  const entries = new Map();
  for (const e of r.resolved) entries.set(itemKey(e), [...(entries.get(itemKey(e)) ?? []), e]);
  /** @type {OpenItem[]} */
  const carried = [];
  /** @type {any[]} */
  const accepted = [];
  let unchanged = 0;
  const carry = (/** @type {OpenItem} */ item, /** @type {string} */ status, /** @type {string} */ note) => carried.push({
    criterion: item.criterion,
    blockId: item.blockId,
    issue: item.issue,
    fix: item.fix,
    origIssue: item.origIssue ?? item.issue,
    since: item.since,
    status,
    note,
  });
  for (const item of base.open) {
    const entry = entries.get(itemKey(item))?.shift();
    const original = item.origIssue ?? item.issue;
    if (!entry) {
      if (!restated(item)) carry(item, 'unverified', `Not verified: the previous must-fix "${original}" has no entry in "resolved".`);
      continue;
    }
    if (entry.status === 'unresolved') {
      if (!restated(item)) carry(item, 'unresolved', `Unresolved from the previous review: ${entry.evidence}`);
      continue;
    }
    const touched = item.touched ?? touchedNow;
    const fixedIn = Array.isArray(entry.fixedIn) ? entry.fixedIn : [];
    if (touched.has(item.blockId) || fixedIn.some((/** @type {string} */ id) => touched.has(id))) {
      accepted.push(entry);
      const idle = fixedIn.filter((/** @type {string} */ id) => !touched.has(id));
      if (idle.length) warnings.push(`${name}: "resolved" [${entry.criterion}] ${entry.blockId} names fixedIn ${idle.join(', ')}, which did not change`);
      continue;
    }
    unchanged += 1;
    if (!restated(item)) {
      carry(item, 'unchanged', `Marked resolved, but ${[item.blockId, ...fixedIn].join(', ')} did not change since the review that raised it, so nothing resolved it (a must-fix is resolved only by a change; name the changed block in "fixedIn" when the fix is elsewhere). The must-fix: "${original}"`);
    }
  }
  for (const left of entries.values()) {
    for (const e of left) {
      warnings.push(`${name}: "resolved" lists [${e.criterion}] ${e.blockId}, which was not an open must-fix of the previous review`);
      // An item found unresolved stays open even when it matches nothing.
      if (e.status === 'unresolved' && !restated(e)) {
        carry({ criterion: e.criterion, blockId: e.blockId, issue: e.evidence, fix: `Apply the previous must-fix item (${v.previousReview}).` }, 'unresolved', `Unresolved from the previous review: ${e.evidence}`);
      }
    }
  }
  for (const m of r.mustFix) {
    if (m.blockId === 'lesson' || touchedNow.has(m.blockId) || base.open.some((p) => itemKey(p) === itemKey(m))) continue;
    warnings.push(`${name}: new must-fix on ${m.blockId}, which did not change since ${rev}; in a verification round that is only for a regression the changes caused (the issue should name the change)`);
  }
  /** @type {OpenItem[]} */
  const own = r.mustFix.map((/** @type {any} */ m) => ({ ...m, origIssue: m.issue, since }));
  return { errors, warnings, open: [...own, ...carried], carried, accepted, unchanged };
}

/**
 * Validates and merges reviews of one lesson.
 *
 * @param {any[]} reviews
 * @param {{ review: any, rubric: any }} schemas
 * @param {{
 *   lesson?: { hash: string, id?: string | null, file?: string } | null,
 *   baselines?: Record<string, BaselineResult>,
 *   previous?: any[],
 *   scopes?: Record<string, Scope | { error: string }>,
 *   allowLegacy?: boolean,
 * }} [options]
 *   lesson: the lesson as it is now (its lessonHash); every review must have read it.
 *   baselines: by reviewer, the round each verification verifies, as the CLI loaded and checked it
 *     (followChain): the previous review, the items open after it, its chain and recorded rounds.
 *   previous: library use without the CLI: previous reviews as documents (matched by reviewer); a
 *     previous verification's own chain is then not followed.
 *   scopes: by reviewer, the scope since each verification's reviewedRevision, recomputed with
 *     review-scope.mjs (compareLessons); every verification needs its own.
 *   allowLegacy: accept reviews and previous reviews without lessonHash (with a warning).
 */
export function evaluateReviews(reviews, schemas, options = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const stale = [];
  const label = (/** @type {any} */ r, /** @type {number} */ i) => `review ${i + 1}${r?.reviewer ? ` (${r.reviewer})` : ''}`;
  reviews.forEach((r, i) => {
    for (const e of reviewErrors(r, schemas)) errors.push(`${label(r, i)}: ${e}`);
  });
  /** @type {Map<string, number>} */
  const firstBy = new Map();
  reviews.forEach((r, i) => {
    if (!isObject(r) || typeof r.reviewer !== 'string') return;
    const first = firstBy.get(r.reviewer);
    if (first === undefined) firstBy.set(r.reviewer, i);
    else errors.push(`${label(r, i)}: review ${first + 1} is by ${r.reviewer} too; check one review per reviewer (its latest round), not old copies or a second verification`);
  });
  const ids = [...new Set(reviews.map((r) => r?.lessonId))];
  if (ids.length > 1) errors.push(`reviews are for different lessons: ${ids.map(String).join(', ')}`);
  if (errors.length) return { valid: false, errors, warnings, stale };

  // Freshness: every review read the lesson as it is now.
  const lesson = options.lesson;
  if (!lesson || typeof lesson.hash !== 'string') {
    errors.push('no current lesson: check-review needs the lesson (its lessonHash) to tell fresh reviews from stale ones');
  } else {
    const where = lesson.file ?? 'the lesson';
    if (lesson.id !== undefined && ids.length === 1 && ids[0] !== lesson.id) errors.push(`the reviews are for ${ids[0]}, but ${where} is ${lesson.id}`);
    reviews.forEach((r, i) => {
      if (!r || typeof r !== 'object') return;
      if (typeof r.lessonHash !== 'string') {
        if (options.allowLegacy) {
          warnings.push(`LEGACY REVIEW: ${label(r, i)} has no "lessonHash", so nothing shows it read ${where} as it is now (${lesson.hash}); accepted only because of --allow-legacy`);
        } else {
          stale.push(r.reviewer);
          errors.push(`stale: ${label(r, i)} has no "lessonHash", so nothing shows which version of the lesson it read; review ${where} again (or pass --allow-legacy for a review written before lessonHash existed)`);
        }
      } else if (r.lessonHash !== lesson.hash) {
        stale.push(r.reviewer);
        errors.push(`stale: ${label(r, i)} read ${r.lessonHash}, but ${where} is now ${lesson.hash}; it reviews another version`);
      }
    });
  }
  const lessonId = typeof lesson?.id === 'string' ? lesson.id : ids[0];

  // The round each verification verifies: loaded and checked by the CLI, or given as documents.
  /** @type {Map<string, BaselineResult>} */
  const baselines = new Map(Object.entries(options.baselines ?? {}));
  for (const p of options.previous ?? []) {
    const name = `previous review${p?.reviewer ? ` (${p.reviewer})` : ''}`;
    const problems = reviewErrors(p, schemas);
    if (problems.length) {
      errors.push(...problems.map((e) => `${name}: ${e}`));
      continue;
    }
    if (p.lessonId !== lessonId) {
      errors.push(`${name}: is for ${p.lessonId}, not ${lessonId}`);
      continue;
    }
    if (baselines.has(p.reviewer)) {
      errors.push(`${name}: a second previous review by ${p.reviewer}; give one previous review per reviewer`);
      continue;
    }
    /** @type {string[]} */
    const notes = [];
    if (typeof p.lessonHash !== 'string') {
      if (!options.allowLegacy) {
        errors.push(`${name}: has no "lessonHash", so nothing binds verifies.reviewedRevision to the version it read; verify a review that records lessonHash, or pass --allow-legacy`);
        continue;
      }
      notes.push(`LEGACY PREVIOUS REVIEW: ${p.reviewer}: the previous review has no "lessonHash"; accepted only because of --allow-legacy`);
    }
    if (isVerify(p)) notes.push(`${p.reviewer}: the previous review is a verification too; only the CLI follows its chain back to a full review`);
    baselines.set(p.reviewer, { review: p, open: openItems(p).map((m) => ({ ...m, origIssue: m.issue })), spec: '', chain: [p], rounds: [], warnings: notes });
  }

  // Each verification is checked against the round it verifies and its recomputed scope.
  const scopes = options.scopes ?? {};
  /** @type {Map<string, ReturnType<typeof checkVerification>>} */
  const checked = new Map();
  reviews.forEach((r, i) => {
    if (!isVerify(r)) return;
    const base = baselines.get(r.reviewer);
    if (!base || 'error' in base) {
      if (base && 'plain' in base && base.plain) errors.push(`${label(r, i)}: ${base.error}`);
      else {
        errors.push(`${label(r, i)}: its previous review was not loaded (${base?.error ?? `${r.verifies.previousReview} was not given`}). A verification counts only when it is checked against the review it verifies: set verifies.previousReview to <commit>:<path> or the snapshot copy`);
      }
      return;
    }
    if ('invalid' in base) {
      errors.push(`${label(r, i)}: its previous review ${base.spec} is not a valid round, or goes back to one that is not, so it cannot be verified: ${base.invalid.join('; ')}. Verify the last round the gate accepts, or do a full review`);
      return;
    }
    warnings.push(...base.warnings);
    const scope = Object.hasOwn(scopes, r.reviewer) ? scopes[r.reviewer] : undefined;
    const result = checkVerification(r, base, scope, { name: label(r, i) });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    checked.set(r.reviewer, result);
  });

  // Every reviewer of a verified round is in this set, and goes back to the same round.
  /** @type {Map<string, any>} */
  const current = new Map(reviews.map((r) => [r.reviewer, r]));
  /** @type {Map<string, Set<string>>} */
  const chainKeys = new Map();
  for (const r of reviews) {
    const keys = new Set([canonicalJson(r)]);
    const base = baselines.get(r.reviewer);
    if (isVerify(r) && base && 'chain' in base) for (const x of base.chain) keys.add(canonicalJson(x));
    chainKeys.set(r.reviewer, keys);
  }
  const seenRounds = new Set();
  for (const r of reviews.filter(isVerify)) {
    const base = baselines.get(r.reviewer);
    if (!base || !('review' in base)) continue;
    for (const round of base.rounds) {
      if (seenRounds.has(round.key)) continue;
      seenRounds.add(round.key);
      for (const problem of round.problems) errors.push(`round ${round.label}: ${problem}`);
      for (const [other, recorded] of round.reviews) {
        const now = current.get(other);
        if (!now) {
          errors.push(`the round ${round.label} that ${r.reviewer}'s verification goes back to also has a review by ${other}, which this set leaves out; gate every reviewer of that round together (${other} verifies its review of that round, or reviews in full)`);
        } else if (isVerify(now) && !chainKeys.get(other)?.has(canonicalJson(recorded))) {
          errors.push(`${other}: its verification does not go back to its review in the round ${round.label} that ${r.reviewer}'s verification goes back to; verify that review (or review in full), so no reviewer skips a round`);
        } else if (!isVerify(now)) {
          // A full review starts afresh, but within the reviewer's scope: it cannot drop a criterion.
          const scored = new Set(now.scores.map((/** @type {any} */ s) => s.id));
          const dropped = (Array.isArray(recorded.scores) ? recorded.scores : []).map((/** @type {any} */ s) => s?.id).filter((id) => !scored.has(id));
          if (dropped.length) {
            errors.push(`${other}: its full review leaves out ${[...new Set(dropped)].join(', ')}, which its review in the round ${round.label} scored; a full review scores every criterion in the reviewer's scope`);
          }
        }
      }
    }
  }
  if (errors.length) return { valid: false, errors, warnings, stale };

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
  // Still-open items of verification rounds: unresolved, never verified, or resolved without a change.
  const reopened = reviews.filter(isVerify).flatMap((r) => (checked.get(r.reviewer)?.carried ?? []).map((item) => ({
    reviewer: r.reviewer,
    criterion: item.criterion,
    blockId: item.blockId,
    issue: item.note ?? item.issue,
    fix: item.fix,
    status: item.status,
  })));
  const mustFix = [...reviews.flatMap((r) => r.mustFix.map((/** @type {any} */ m) => ({ reviewer: r.reviewer, ...m }))), ...reopened];
  const rejected = reviews.some((r) => r.verdict === 'reject');

  /** @type {'pass' | 'revise' | 'reject' | 'incomplete'} */
  let verdict;
  if (rejected) verdict = 'reject';
  else if (below.length || mean < pass.minMean || (pass.noMustFix && mustFix.length)) verdict = 'revise';
  else if (missing.length) verdict = 'incomplete';
  else verdict = 'pass';

  const rounds = reviews.map((r) => {
    if (!isVerify(r)) return { reviewer: r.reviewer, mode: 'full', lessonHash: r.lessonHash ?? null };
    const base = /** @type {Baseline} */ (baselines.get(r.reviewer));
    const scope = /** @type {Scope} */ (scopes[r.reviewer]);
    const result = /** @type {ReturnType<typeof checkVerification>} */ (checked.get(r.reviewer));
    return {
      reviewer: r.reviewer,
      mode: 'verify',
      lessonHash: r.lessonHash ?? null,
      reviewedRevision: r.verifies.reviewedRevision,
      previousReview: base.spec || r.verifies.previousReview,
      previousChecked: true,
      earlierRounds: Math.max(0, base.chain.length - 1),
      scopeFrom: scope.source ?? null,
      changed: scope.changed.length,
      changedShare: scope.changedShare,
      resolved: result.accepted.length,
      unresolved: r.resolved.filter((/** @type {any} */ v) => v.status === 'unresolved').length,
      resolvedWithoutChange: result.unchanged,
      carriedOver: r.scores.filter((/** @type {any} */ s) => s.carriedOver === true).map((/** @type {any} */ s) => s.id),
    };
  });

  return {
    valid: true,
    errors,
    warnings,
    stale,
    lessonId: ids[0] ?? null,
    lesson: lesson ?? null,
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
    resolved: reviews.flatMap((r) => (isVerify(r)
      ? r.resolved.map((/** @type {any} */ v) => ({ reviewer: r.reviewer, ...v, ...(v.status === 'resolved' ? { accepted: Boolean(checked.get(r.reviewer)?.accepted.includes(v)) } : {}) }))
      : [])),
    niceToHave: reviews.flatMap((r) => r.niceToHave),
  };
}

/** @param {string} text */
function parseReviews(text) {
  const json = JSON.parse(text);
  return Array.isArray(json) ? json : [json];
}

/** @param {string} file */
const isFile = (file) => fs.existsSync(file) && fs.statSync(file).isFile();

/** @param {string} file */
const realPath = (file) => (fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file));

/**
 * Why a previous-review reference cannot be the previous round, or null. A working-tree path is
 * refused when it is a file being checked, or the reports file of the same lesson and reviewer
 * (each round overwrites it); <commit>:<path> names a committed version and is allowed.
 * (recordedRound then checks that it is a recorded round at all.)
 *
 * @param {string} spec
 * @param {{ lessonId?: unknown, reviewer?: unknown, inputFiles?: Set<string>, cwd?: string, root?: string }} context
 * @returns {string | null}
 */
export function previousSpecProblem(spec, { lessonId, reviewer, inputFiles = new Set(), cwd = process.cwd(), root = ROOT }) {
  if (typeof spec !== 'string' || !spec) return 'verifies.previousReview is empty';
  const files = [...new Set([cwd, root].map((base) => path.resolve(base, spec)))];
  const existing = files.filter(isFile);
  if (!existing.length && /^[^:\s]+:[^:\s]+$/.test(spec)) return null;
  for (const file of existing) {
    if (inputFiles.has(realPath(file))) return `${spec} is the file being checked, so it holds this round, not the previous one`;
  }
  const own = `${lessonId}.${reviewer}.review.json`;
  for (const file of files) {
    if (path.basename(file) === own && path.basename(path.dirname(file)) === 'reports') {
      return `${spec} is the working-tree reports file of ${lessonId} by ${reviewer}, which each round overwrites, so it is not the previous round`;
    }
  }
  return null;
}

/**
 * Parses a previous-review reference as a recorded round, before any file or git is read:
 * <rev>:<reportsDir>/<lessonId>.<reviewer>.review.json, or a file that is the snapshot copy
 * <snapshotBase>/<16 hex>/<round>/<reviewer>.review.json (by its real path). Anything else, and
 * anything git could read as an option, is refused.
 *
 * @param {string} spec
 * @param {{ reviewer?: string | null, lessonId: string, reportsDir: string, snapshotBase: string | null, cwd?: string, root?: string }} context
 *   reviewer: the reviewer it must belong to (null: any reviewer, named by the path)
 * @returns {{ loc: Location } | { error: string }}
 */
export function recordedRound(spec, { reviewer = null, lessonId, reportsDir, snapshotBase, cwd = process.cwd(), root = ROOT }) {
  const who = reviewer ?? '<reviewer>';
  const snapshotShown = snapshotBase ? path.relative(root, snapshotBase).split(path.sep).join('/') : '.artifacts/review/<course>/<lesson>';
  const notRecorded = `${spec} is not a recorded round: a previous review is <commit>:${reportsDir}/${lessonId}.${who}.review.json or the snapshot copy ${snapshotShown}/<hash>/<round>/${who}.review.json`;
  if (typeof spec !== 'string' || !spec) return { error: 'verifies.previousReview is empty' };
  if (spec.startsWith('-') || /[\s\u0000-\u001f]/.test(spec)) return { error: notRecorded };
  const colon = spec.indexOf(':');
  if (colon > 0 && !path.isAbsolute(spec)) {
    const rev = spec.slice(0, colon);
    const rel = String(normalizeFile(spec.slice(colon + 1)));
    const match = new RegExp(`^${escapeRe(reportsDir)}/${escapeRe(lessonId)}\\.([^/]+)\\.review\\.json$`).exec(rel);
    if (!GIT_REVISION.test(rev) || !match || !REVIEWER.test(match[1]) || (reviewer && match[1] !== reviewer)) return { error: notRecorded };
    return { loc: { kind: 'git', rev, path: rel, dir: reportsDir, reviewer: match[1] } };
  }
  const file = [...new Set([cwd, root].map((base) => path.resolve(base, spec)))].find(isFile);
  if (!file) return { error: `${spec} is not a file, and git cannot show it` };
  if (!snapshotBase) return { error: notRecorded };
  const real = realPath(file);
  const parts = path.relative(realPath(snapshotBase), real).split(path.sep);
  const name = parts.length === 3 && parts[2].endsWith('.review.json') ? parts[2].slice(0, -'.review.json'.length) : '';
  if (!SNAPSHOT_FOLDER.test(parts[0]) || !ROUND_LABEL.test(parts[1] ?? '') || !REVIEWER.test(name) || (reviewer && name !== reviewer)) return { error: notRecorded };
  return { loc: { kind: 'snapshot', file: real, dir: path.dirname(real), hex: parts[0], round: parts[1], reviewer: name } };
}

/**
 * @typedef {{
 *   root: string, cwd: string, schemas: { review: any, rubric: any }, lesson: any, lessonFile: string,
 *   lessonId: string, reportsDir: string, snapshotBase: string | null, allowLegacy: boolean,
 *   inputFiles: Set<string>, cliPrevious: Map<string, { spec: string, loc: Location, review: any }>,
 *   usedPrevious: Set<string>, rounds: Map<string, Round>, touched: WeakMap<object, WeakMap<object, Set<string>>>,
 * }} ChainContext
 */

/**
 * Reads the review a recorded round reference names. It must hold one review object.
 *
 * @param {string} spec
 * @param {Location} loc
 * @param {ChainContext} ctx
 * @returns {{ review: any, loc: Location } | { error: string }}
 */
function loadRecorded(spec, loc, ctx) {
  let text;
  if (loc.kind === 'git') {
    const sha = resolveCommit(loc.rev, ctx.root);
    const show = sha ? git(['show', `${sha}:${loc.path}`], ctx.root) : null;
    if (!sha || !show?.ok) return { error: `${spec} is not a file, and git cannot show it` };
    text = show.stdout;
    const short = git(['rev-parse', '--short', sha], ctx.root);
    loc = { ...loc, sha, short: short.ok ? short.stdout.trim() : sha.slice(0, 7) };
  } else {
    text = fs.readFileSync(loc.file, 'utf8');
  }
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { error: `cannot read ${spec}: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isObject(doc)) return { error: `${spec} holds ${Array.isArray(doc) ? `${doc.length} reviews` : 'no review'}; a recorded round holds one review per file` };
  return { review: doc, loc };
}

/**
 * The reviews recorded next to a previous review: the lesson's review files in the reports folder
 * at that commit, or in that snapshot round folder.
 *
 * @param {Location} loc
 * @param {ChainContext} ctx
 * @returns {Round}
 */
function roundAt(loc, ctx) {
  const key = loc.kind === 'git' ? `git:${loc.sha}:${loc.dir}` : `snapshot:${loc.dir}`;
  const cached = ctx.rounds.get(key);
  if (cached) return cached;
  /** @type {Map<string, any>} */
  const reviews = new Map();
  /** @type {string[]} */
  const problems = [];
  const prefix = `${ctx.lessonId}.`;
  const add = (/** @type {string} */ name, /** @type {() => string | null} */ read, /** @type {string} */ where) => {
    if (!name.startsWith(prefix) && loc.kind === 'git') return;
    if (!name.endsWith('.review.json')) return;
    const who = loc.kind === 'git' ? name.slice(prefix.length, -'.review.json'.length) : name.slice(0, -'.review.json'.length);
    if (!who || who.includes('.')) return;
    /** @type {unknown} */
    let doc;
    try {
      doc = JSON.parse(read() ?? '');
    } catch {
      problems.push(`cannot read ${where}`);
      return;
    }
    if (!isObject(doc) || doc.lessonId !== ctx.lessonId) return;
    if (reviews.has(doc.reviewer)) problems.push(`two reviews by ${doc.reviewer} (${where})`);
    reviews.set(doc.reviewer, doc);
  };
  let label;
  if (loc.kind === 'git') {
    label = `${loc.short}:${loc.dir}/`;
    const ls = git(['ls-tree', '--name-only', /** @type {string} */ (loc.sha), '--', `${loc.dir}/`], ctx.root);
    for (const full of ls.ok ? ls.stdout.split('\n').filter(Boolean) : []) {
      add(path.posix.basename(full), () => {
        const show = git(['show', `${loc.sha}:${full}`], ctx.root);
        return show.ok ? show.stdout : null;
      }, `${loc.short}:${full}`);
    }
  } else {
    label = `${path.relative(ctx.root, loc.dir).split(path.sep).join('/')}/`;
    for (const name of fs.readdirSync(loc.dir).sort()) add(name, () => fs.readFileSync(path.join(loc.dir, name), 'utf8'), `${label}${name}`);
  }
  const round = { key, label, reviews, problems };
  ctx.rounds.set(key, round);
  return round;
}

/**
 * The ids changed between the version an item was raised on and a later version (cached).
 *
 * @param {any} since
 * @param {any} read
 * @param {ChainContext} ctx
 * @returns {Set<string> | undefined}
 */
function touchedBetween(since, read, ctx) {
  if (!isObject(since) || !isObject(read)) return undefined;
  let byRead = ctx.touched.get(since);
  if (!byRead) {
    byRead = new WeakMap();
    ctx.touched.set(since, byRead);
  }
  let set = byRead.get(read);
  if (!set) {
    set = new Set(compareLessons(since, read).touched);
    byRead.set(read, set);
  }
  return set;
}

/**
 * The previous review of a review written before lessonHash existed that names its own reports
 * file: the version of that file before this round overwrote it, in the history of the commit the
 * review was read from.
 *
 * @param {any} r
 * @param {Location & { kind: 'git' }} where
 * @param {ChainContext} ctx
 * @returns {{ spec: string, loc: Location, review: any } | { invalid: string[], spec: string }}
 */
function legacyPreviousInGit(r, where, ctx) {
  const file = where.path;
  const log = git(['log', '--format=%H', /** @type {string} */ (where.sha), '--', file], ctx.root);
  const mine = canonicalJson(r);
  for (const sha of log.ok ? log.stdout.split('\n').filter(Boolean) : []) {
    const show = git(['show', `${sha}:${file}`], ctx.root);
    if (!show.ok) continue;
    /** @type {unknown} */
    let doc;
    try {
      doc = JSON.parse(show.stdout);
    } catch {
      continue;
    }
    if (canonicalJson(doc) === mine) continue;
    const short = git(['rev-parse', '--short', sha], ctx.root);
    const shortSha = short.ok ? short.stdout.trim() : sha.slice(0, 7);
    const spec = `${shortSha}:${file}`;
    if (!isObject(doc)) return { invalid: [`${spec}, the version of its reports file before it, holds no single review`], spec };
    return { spec, loc: { kind: 'git', rev: sha, sha, short: shortSha, path: file, dir: where.dir, reviewer: where.reviewer }, review: doc };
  }
  return { invalid: [`it names its own reports file as previousReview, and git has no earlier version of ${file} before ${where.short}`], spec: r.verifies.previousReview };
}

/**
 * Where the previous review of `r` is: --previous or verifies.previousReview for a review being
 * checked; verifies.previousReview, read from the repository, for an earlier round of a chain.
 *
 * @param {any} r
 * @param {Location | null} where where r was loaded from (null: a review being checked)
 * @param {string | null} self the reference r was loaded by (null: a review being checked)
 * @param {ChainContext} ctx
 * @returns {{ spec: string, loc: Location, review?: any, legacyResolved?: boolean } | { error: string, plain?: boolean } | { invalid: string[], spec: string }}
 */
function previousTarget(r, where, self, ctx) {
  const reviewer = r.reviewer;
  const own = r.verifies.previousReview;
  const context = { reviewer, lessonId: ctx.lessonId, reportsDir: ctx.reportsDir, snapshotBase: ctx.snapshotBase, root: ctx.root };
  if (!where || !self) {
    const problem = previousSpecProblem(own, { lessonId: r.lessonId, reviewer, inputFiles: ctx.inputFiles, cwd: ctx.cwd, root: ctx.root });
    const cli = ctx.cliPrevious.get(reviewer);
    if (cli) {
      ctx.usedPrevious.add(reviewer);
      if (!problem) {
        return { error: `--previous ${cli.spec}: its review names its previous round already (${own}); --previous stands in only for a review written before lessonHash existed that names the file being checked or its own reports file`, plain: true };
      }
      if (typeof r.lessonHash === 'string') {
        return { error: `--previous ${cli.spec}: --previous is only for reviews written before lessonHash existed, and this review names ${own} (${problem}); re-run the reviewer with previousReview set to <commit>:<path> or the snapshot copy`, plain: true };
      }
      return { spec: cli.spec, loc: cli.loc, review: cli.review };
    }
    if (problem) return { error: problem };
    const parsed = recordedRound(own, { ...context, cwd: ctx.cwd });
    return 'error' in parsed ? parsed : { spec: own, loc: parsed.loc };
  }
  // An earlier round: its reference is resolved in the repository.
  const ownReports = path.join(ctx.root, ctx.reportsDir, `${ctx.lessonId}.${reviewer}.review.json`);
  if (typeof own === 'string' && !/^[^:\s]+:/.test(own) && path.resolve(ctx.root, own) === ownReports) {
    if (typeof r.lessonHash !== 'string' && where.kind === 'git') {
      const found = legacyPreviousInGit(r, where, ctx);
      return 'invalid' in found ? { invalid: found.invalid.map((e) => `${self}: ${e}`), spec: found.spec } : { ...found, legacyResolved: true };
    }
    return { invalid: [`${self}: it names its own reports file (${own}) as previousReview, so the round it verified is unknown`], spec: own };
  }
  const parsed = recordedRound(own, { ...context, cwd: ctx.root });
  return 'error' in parsed ? { invalid: [`${self}: its previous review: ${parsed.error}`], spec: own } : { spec: own, loc: parsed.loc };
}

/**
 * Loads the round a verification verifies and checks that round itself, back to a full review.
 * Returns the baseline the verification is checked against: the previous review, the must-fix
 * items open after it (with the ids changed since each was raised, up to `read`), the chain of
 * earlier reviews, and the rounds recorded next to each of them.
 *
 * Messages name the review they are about: `self` for r (none for a review being checked, which
 * evaluateReviews labels), `spec` for its previous review.
 *
 * @param {any} r a verification that is a valid review.v1 document
 * @param {any} read the lesson version r read
 * @param {Location | null} where where r was loaded from (null: a review being checked)
 * @param {string | null} self the reference r was loaded by (null: a review being checked)
 * @param {ChainContext} ctx
 * @param {number} depth
 * @param {Set<string>} seen canonical JSON of the reviews on this chain
 * @returns {{ base: BaselineResult, scope?: Scope | { error: string } }}
 */
function followChain(r, read, where, self, ctx, depth, seen) {
  const rev = r.verifies.reviewedRevision;
  const target = previousTarget(r, where, self, ctx);
  if ('error' in target || 'invalid' in target) return { base: target };
  const { spec } = target;
  // A problem of r (its reference, its revision): the verification is refused at the top, and an
  // earlier round with it is not a valid round.
  const refuse = (/** @type {string} */ message, plain = false) => ({ base: self ? { invalid: [`${self}: ${message}`], spec } : { error: message, plain } });
  const loaded = target.review ? { review: target.review, loc: target.loc } : loadRecorded(spec, target.loc, ctx);
  if ('error' in loaded) return refuse(loaded.error);
  const p = loaded.review;
  const loc = loaded.loc;
  if (p.reviewer !== r.reviewer) return refuse(`${spec} holds a review by ${p.reviewer}, not ${r.reviewer}`);
  if (p.lessonId !== ctx.lessonId) return refuse(`${spec} is a review of ${p.lessonId}, not ${ctx.lessonId}`);
  const problems = reviewErrors(p, ctx.schemas);
  if (problems.length) return { base: { invalid: problems.map((e) => `${spec}: ${e}`), spec } };
  const key = canonicalJson(p);
  if (key === canonicalJson(r)) return refuse('verifies.previousReview is this review itself, not the round before it', true);
  if (seen.has(key)) return { base: { invalid: [`${spec} appears twice in the chain of rounds`], spec } };
  if (depth >= MAX_CHAIN) return { base: { invalid: [`the chain of verification rounds goes back more than ${MAX_CHAIN} rounds; do a full review`], spec } };

  /** @type {string[]} */
  const warnings = [];
  const legacy = typeof p.lessonHash !== 'string';
  if (loc.kind === 'snapshot' && p.lessonHash !== `sha256:${loc.hex}`) {
    return { base: { invalid: [`${spec} is in the snapshot of sha256:${loc.hex}, but it read ${legacy ? 'no recorded version (it has no lessonHash)' : p.lessonHash}`], spec } };
  }
  if (target.legacyResolved) {
    warnings.push(`LEGACY PREVIOUS REVIEW: ${self}: its previousReview names its own reports file; the round before it is ${spec}, the version of that file before it`);
  }
  if (legacy) {
    if (!ctx.allowLegacy) {
      return refuse(`its previous review ${spec} has no "lessonHash", so nothing binds verifies.reviewedRevision (${rev}) to the version it read; verify a review that records lessonHash or do a full review (--allow-legacy accepts reviews written before lessonHash existed)`, true);
    }
    const revSha = resolveCommit(rev, ctx.root);
    if (!revSha) return refuse(`verifies.reviewedRevision ${rev} is not a commit, and its previous review ${spec} has no "lessonHash" to find the version it read`, true);
    if (loc.kind !== 'git' || !isAncestor(revSha, /** @type {string} */ (loc.sha), ctx.root)) {
      return refuse(`verifies.reviewedRevision ${rev} is neither ${loc.kind === 'git' ? loc.short : spec} nor an earlier commit, so it cannot be the version its previous review ${spec} read (a review without "lessonHash" is bound only to the commit that holds it)`, true);
    }
    warnings.push(`LEGACY PREVIOUS REVIEW: ${self ?? r.reviewer}: ${spec} has no "lessonHash"; the scope since ${rev} is bound only to ${loc.short} or an earlier commit, not to the version it read; accepted only because of --allow-legacy`);
  }

  // The version p read.
  /** @type {{ lesson: any, revision: string, source: string }} */
  let before;
  try {
    const prior = readBefore({ since: rev }, ctx.lessonFile, ctx.lesson, { root: ctx.root, expectHash: legacy ? null : p.lessonHash });
    before = { lesson: JSON.parse(prior.text), revision: prior.revision, source: prior.source };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (self) return { base: { invalid: [`${self}: cannot recompute the scope since ${rev}: ${message}`], spec } };
    return { base: { review: p, open: openItems(p), spec, loc, chain: [p], rounds: [], warnings, legacy }, scope: { error: message } };
  }

  // p itself: a full review, or a verification checked against its own round.
  /** @type {OpenItem[]} */
  let open;
  const chain = [p];
  const rounds = [roundAt(loc, ctx)];
  if (isVerify(p)) {
    const inner = followChain(p, before.lesson, loc, spec, ctx, depth + 1, new Set([...seen, key]));
    if (!('review' in inner.base)) return { base: { invalid: 'invalid' in inner.base ? inner.base.invalid : [`${spec}: ${inner.base.error}`], spec } };
    const link = checkVerification(p, inner.base, inner.scope, { name: spec, since: before.lesson });
    if (link.errors.length) return { base: { invalid: link.errors, spec } };
    open = link.open;
    chain.push(...inner.base.chain);
    rounds.push(...inner.base.rounds);
    warnings.push(...inner.base.warnings.filter((w) => w.startsWith('LEGACY')));
  } else {
    open = p.mustFix.map((/** @type {any} */ m) => ({ ...m, origIssue: m.issue, since: before.lesson }));
  }
  for (const item of open) item.touched = touchedBetween(item.since, read, ctx);
  const scope = { ...compareLessons(before.lesson, read), revision: before.revision, source: before.source };
  return { base: { review: p, open, spec, loc, read: before.lesson, chain, rounds, warnings, legacy }, scope };
}

/**
 * The lesson the reviews name: one valid lessonId and one course (from `file`).
 *
 * @param {any[]} reviews
 * @returns {{ lessonId?: string, course?: string, why?: string }}
 */
function lessonTarget(reviews) {
  const ids = [...new Set(reviews.map((r) => r?.lessonId))];
  if (ids.length !== 1) return { why: `the reviews are for different lessons (${ids.map(String).join(', ')})` };
  const lessonId = ids[0];
  if (typeof lessonId !== 'string' || !ID_PATTERN.test(lessonId)) return { why: `lessonId ${JSON.stringify(lessonId)} is not a lesson id` };
  const courses = [...new Set(reviews.map((r) => lessonFileOf(r?.file, lessonId)?.course ?? null))];
  if (courses.includes(null)) {
    const bad = [...new Set(reviews.filter((r) => !lessonFileOf(r?.file, lessonId)).map((r) => JSON.stringify(r?.file ?? null)))];
    return { lessonId, why: `"file" ${bad.join(', ')} is not content/courses/<course>/drafts/${lessonId}.lesson.json or lessons/${lessonId}.lesson.json` };
  }
  if (courses.length > 1) return { lessonId, why: `the reviews name different courses (${courses.join(', ')})` };
  return { lessonId, course: /** @type {string} */ (courses[0]) };
}

/**
 * Parses the arguments of the CLI.
 *
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const out = {
    sources: /** @type {string[]} */ ([]),
    previous: /** @type {string[]} */ ([]),
    lesson: /** @type {string | null} */ (null),
    allowLegacy: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--allow-legacy') out.allowLegacy = true;
    else if (arg === '--previous' || arg === '--lesson') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value\n${USAGE}`);
      if (arg === '--previous') out.previous.push(value);
      else out.lesson = value;
      i += 1;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}\n${USAGE}`);
    else out.sources.push(arg);
  }
  if (out.sources.length === 0) throw new Error(USAGE);
  return out;
}

/**
 * The CLI. Returns the exit code.
 *
 * @param {string[]} argv
 * @param {{ cwd?: string, root?: string, readStdin?: () => string, log?: (line: string) => void, error?: (line: string) => void }} [io]
 *   root: the repository whose lesson files, snapshots and git history are read
 */
export function runCli(argv, io = {}) {
  const {
    cwd = process.cwd(),
    root = ROOT,
    readStdin = () => fs.readFileSync(0, 'utf8'),
    log = (line) => console.log(line),
    error = (line) => console.error(line),
  } = io;
  const shown = (/** @type {string} */ p) => path.relative(root, p).split(path.sep).join('/');
  /** @type {ReturnType<typeof parseArgs>} */
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const fail = (/** @type {string} */ message) => {
    error(message);
    return 2;
  };

  /** @type {any[]} */
  let reviews;
  try {
    reviews = args.sources.flatMap((s) => parseReviews(s === '-' ? readStdin() : fs.readFileSync(path.resolve(cwd, s), 'utf8')));
  } catch (e) {
    return fail(`Cannot read the review: ${e instanceof Error ? e.message : String(e)}`);
  }
  const inputFiles = new Set(args.sources.filter((s) => s !== '-').map((s) => realPath(path.resolve(cwd, s))));
  const schemas = loadSchemas();
  /** @type {string[]} */
  const notes = [];

  // The lesson as it is now: --lesson, or the lesson's drafts/ or lessons/ file.
  const target = lessonTarget(reviews);
  const canonical = target.lessonId && target.course
    ? ['drafts', 'lessons'].map((folder) => path.join(root, 'content', 'courses', /** @type {string} */ (target.course), folder, `${target.lessonId}.lesson.json`))
    : [];
  /** @type {string} */
  let lessonFile;
  if (args.lesson) {
    const found = [cwd, root].map((base) => path.resolve(base, /** @type {string} */ (args.lesson))).find(isFile);
    if (!found) return fail(`--lesson ${args.lesson}: no such file`);
    lessonFile = found;
    if (canonical.length && !canonical.some((c) => isFile(c) && realPath(c) === realPath(found))) {
      notes.push(`--lesson ${shown(found)} is not ${canonical.map(shown).join(' or ')}; this verdict is for that file`);
    }
  } else {
    if (!target.course) return fail(`Cannot find the reviewed lesson: ${target.why}; pass --lesson <file>`);
    const existing = canonical.filter(isFile);
    if (!existing.length) return fail(`Cannot find the reviewed lesson ${target.lessonId}: neither ${canonical.map(shown).join(' nor ')} exists; pass --lesson <file>`);
    if (existing.length > 1) {
      const hashes = existing.map((f) => {
        try {
          return lessonHash(JSON.parse(fs.readFileSync(f, 'utf8')));
        } catch {
          return '(not JSON)';
        }
      });
      if (hashes[0] !== hashes[1]) {
        return fail(`Both ${existing.map(shown).join(' and ')} exist and differ (${hashes.join(' and ')}); pass --lesson <file> to say which one the reviews are for`);
      }
    }
    const named = new Set(reviews.map((r) => path.join(root, String(normalizeFile(r?.file)))));
    lessonFile = existing.find((f) => named.has(f)) ?? existing[0];
  }
  /** @type {any} */
  let lesson;
  try {
    lesson = JSON.parse(fs.readFileSync(lessonFile, 'utf8'));
  } catch (e) {
    return fail(`Cannot read the lesson ${shown(lessonFile)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const current = { id: typeof lesson?.id === 'string' ? lesson.id : null, hash: lessonHash(lesson), file: shown(lessonFile) };
  const lessonId = current.id ?? target.lessonId ?? '';
  const course = target.course ?? (typeof lesson?.courseId === 'string' ? lesson.courseId : path.basename(path.dirname(path.dirname(lessonFile))));
  /** @type {string | null} */
  let snapshotBase = null;
  try {
    snapshotBase = snapshotDir(lessonFile, lesson, root);
  } catch {
    snapshotBase = null;
  }
  /** @type {ChainContext} */
  const ctx = {
    root,
    cwd,
    schemas,
    lesson,
    lessonFile,
    lessonId,
    reportsDir: `content/courses/${course}/reports`,
    snapshotBase,
    allowLegacy: args.allowLegacy,
    inputFiles,
    cliPrevious: new Map(),
    usedPrevious: new Set(),
    rounds: new Map(),
    touched: new WeakMap(),
  };

  // --previous: a recorded round holding one review; at most one per reviewer.
  for (const spec of args.previous) {
    const parsed = recordedRound(spec, { lessonId, reportsDir: ctx.reportsDir, snapshotBase, cwd, root });
    if ('error' in parsed) return fail(`--previous ${parsed.error}`);
    const loaded = loadRecorded(spec, parsed.loc, ctx);
    if ('error' in loaded) return fail(`--previous ${loaded.error}`);
    const reviewer = loaded.review.reviewer;
    if (reviewer !== parsed.loc.reviewer) return fail(`--previous ${spec} holds a review by ${reviewer}, not ${parsed.loc.reviewer}`);
    const earlier = ctx.cliPrevious.get(reviewer);
    if (earlier) return fail(`--previous: ${earlier.spec} and ${spec} are both previous reviews by ${reviewer}; give at most one per reviewer`);
    ctx.cliPrevious.set(reviewer, { spec, loc: loaded.loc, review: loaded.review });
  }

  // Each verification: the round it verifies, followed back to a full review, and its scope.
  /** @type {Record<string, BaselineResult>} */
  const baselines = {};
  /** @type {Record<string, Scope | { error: string }>} */
  const scopes = {};
  const counts = new Map();
  for (const r of reviews) counts.set(r?.reviewer, (counts.get(r?.reviewer) ?? 0) + 1);
  for (const r of reviews) {
    if (!isVerify(r) || counts.get(r.reviewer) !== 1 || reviewErrors(r, schemas).length) continue;
    const { base, scope } = followChain(r, lesson, null, null, ctx, 0, new Set([canonicalJson(r)]));
    baselines[r.reviewer] = base;
    if (scope) scopes[r.reviewer] = scope;
  }
  for (const [reviewer, { spec }] of ctx.cliPrevious) {
    if (!ctx.usedPrevious.has(reviewer)) notes.push(`--previous ${spec}: no verification by ${reviewer} in this set uses it`);
  }

  const result = evaluateReviews(reviews, schemas, { lesson: current, baselines, scopes, allowLegacy: args.allowLegacy });
  result.warnings.push(...notes);
  if (args.json) {
    log(JSON.stringify(result, null, 2));
  } else if (!result.valid) {
    error(`Not a valid set of reviews of ${current.file} (${current.hash}):`);
    for (const e of result.errors) error(`  - ${e}`);
  } else {
    log(`Review of ${result.lessonId} by ${result.reviewers?.join(', ')}: ${String(result.verdict).toUpperCase()}`);
    log(`  lesson ${current.file} (${current.hash})`);
    for (const round of result.rounds ?? []) {
      if (round.mode === 'full') log(`  ${round.reviewer}: full review`);
      else {
        log(`  ${round.reviewer}: verification of ${round.reviewedRevision} (previous review cross-checked; scope recomputed from ${round.scopeFrom}) · ${round.resolved} resolved, ${round.unresolved} unresolved · ${round.changed} changed`
          + ` · carried over: ${round.carriedOver?.length ? round.carriedOver.join(', ') : 'none'}`
          + ` · previous ${round.previousReview}${round.earlierRounds ? ` and ${round.earlierRounds} earlier round${round.earlierRounds > 1 ? 's' : ''} checked` : ''}`);
      }
    }
    log(`  mean ${result.mean} (needs ≥ ${result.minMean}) · every criterion ≥ ${result.minEach}`);
    for (const s of result.scores ?? []) {
      const who = s.reviewers.map((name) => (s.carriedBy.includes(name) ? `${name} carried` : name)).join(', ');
      log(`  ${s.score < (result.minEach ?? 3) ? '✗' : '✓'} ${s.id.padEnd(10)} ${s.score}  (${who})`);
    }
    if (result.missing?.length) log(`  not scored yet: ${result.missing.join(', ')}`);
    for (const v of result.resolved ?? []) if (v.status === 'resolved' && v.accepted) log(`  resolved [${v.criterion}] ${v.blockId} (${v.reviewer})`);
    for (const m of result.mustFix ?? []) log(`  must fix${m.status ? ` (${m.status})` : ''} [${m.criterion}] ${m.blockId}: ${m.issue} → ${m.fix}`);
  }
  for (const w of result.warnings ?? []) error(`  note: ${w}`);
  if (!result.valid) return 2;
  return result.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
