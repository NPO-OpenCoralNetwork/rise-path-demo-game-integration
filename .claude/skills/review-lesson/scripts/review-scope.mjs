#!/usr/bin/env node
/**
 * Fix-verification scope: compares a lesson with the revision a previous review read, lists what
 * changed, and decides whether the next review round may be a verification round or must be a
 * full review (.claude/skills/review-lesson/SKILL.md, "Verification round"). Also prints the
 * lesson hash every review records, and snapshots uncommitted reviewed revisions.
 *
 * A full review is required when, since the reviewed revision,
 *   - a section was added, removed or reordered, or a section's role changed;
 *   - the objectives changed (ids, text, Bloom level or order); or
 *   - more than 30% of the blocks were changed, added, removed or moved.
 * Otherwise a verification round is allowed. Key order and `provenance` never count as changes.
 *
 * Usage:
 *   node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --hash
 *   node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --since <git-rev | sha256:<hash>> [--expect-hash <sha256:…>] [--diff] [--json]
 *   node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --before <old lesson.json> [--expect-hash <sha256:…>] [--diff] [--json]
 *   node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --snapshot [--round <label>]
 *
 * --hash prints the lesson hash `sha256:<16 hex>`: sha256 of the canonical JSON of the lesson
 * without `provenance`, so key order, whitespace, provenance and the file's place (drafts/ or
 * lessons/) do not change it. Every review records it as `lessonHash`; check-review.mjs refuses a
 * review whose lessonHash is not the hash of the lesson as it is now.
 *
 * --since <git-rev> reads the lesson at that commit. A lesson under drafts/ or lessons/ is looked up
 * at drafts/<id> first, then lessons/<id> (a reworked published lesson is reviewed as its draft).
 * --expect-hash <lessonHash of the previous review> instead takes the version with that hash and
 * fails when there is none. --since sha256:<hex> reads a snapshot: the full hash or any unique
 * prefix of at least 6 hex digits.
 *
 * --snapshot is for drafts that are not committed. Run it right after the reviews of a round are
 * saved: it keeps the lesson in .artifacts/review/<course>/<lesson>/<hash>/lesson.json and copies
 * the saved reviews (reports/<lesson>.<reviewer>.review.json) whose lessonHash is this hash to
 * <hash>/<round>/<reviewer>.review.json. A round is never overwritten: --round <label> names a new
 * one, by default round-<n> after the last. It prints the revision `sha256:<hash>` for --since.
 *
 * --diff prints every changed block before and after. --json prints the result, including the
 * `verifies` object that a verification review copies and `touched`, the ids a must-fix item may
 * name that the changes touch (check-review.mjs accepts a "resolved" entry only for those).
 *
 * Exit codes: 0 verification allowed (or hash printed, snapshot saved) · 1 full review required ·
 * 2 invalid input.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from '../../../../shared/lesson/canonical.js';
import { forEachBlock } from '../../../../shared/lesson/walk.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Above this share of changed blocks a re-review must be a full review. */
export const FULL_REVIEW_SHARE = 0.3;

/** Lesson fields that are not learner-facing content. */
const IGNORED_FIELDS = new Set(['provenance']);

/** The form of a lesson hash (`lessonHash` of a review, the revision of a snapshot). */
export const LESSON_HASH = /^sha256:[0-9a-f]{16}$/;

/** A snapshot revision: sha256: and 6–64 hex digits (a unique prefix, or the full hash). */
const SNAPSHOT_REVISION = /^sha256:([0-9a-f]{6,64})$/i;

/**
 * A git revision taken from a review or the command line: a commit, branch or tag name, optionally
 * with ~ or ^. It never starts with "-" and has no ":" or whitespace, so git cannot read it as an
 * option or a path.
 */
export const GIT_REVISION = /^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/;

const USAGE = [
  'Usage:',
  '  node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --hash',
  '  node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --since <git-rev | sha256:<hash>> [--expect-hash <sha256:…>] [--diff] [--json]',
  '  node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --before <old lesson.json> [--expect-hash <sha256:…>] [--diff] [--json]',
  '  node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --snapshot [--round <label>]',
].join('\n');

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/**
 * The lesson hash a review records as `lessonHash`: sha256 of the canonical JSON of the lesson
 * without `provenance`, as `sha256:<16 hex>`.
 *
 * @param {unknown} lesson
 * @returns {string}
 */
export function lessonHash(lesson) {
  const content = lesson && typeof lesson === 'object' && !Array.isArray(lesson)
    ? Object.fromEntries(Object.entries(lesson).filter(([key]) => !IGNORED_FIELDS.has(key)))
    : lesson;
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(content) ?? 'null').digest('hex').slice(0, 16)}`;
}

/**
 * Runs git in the repository.
 *
 * @param {string[]} args
 * @param {string} [cwd]
 */
export function git(args, cwd = ROOT) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: res.status === 0, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * The full commit id of a revision, or null when it is not a commit (or not a safe revision name).
 *
 * @param {string} rev
 * @param {string} [root]
 * @returns {string | null}
 */
export function resolveCommit(rev, root = ROOT) {
  if (typeof rev !== 'string' || !GIT_REVISION.test(rev)) return null;
  const res = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], root);
  return res.ok ? res.stdout.trim() : null;
}

/**
 * Whether commit `ancestor` is `descendant` or one of its ancestors (both full commit ids).
 *
 * @param {string} ancestor
 * @param {string} descendant
 * @param {string} [root]
 */
export function isAncestor(ancestor, descendant, root = ROOT) {
  return git(['merge-base', '--is-ancestor', ancestor, descendant], root).ok;
}

/**
 * Ids of an array whose items are all objects with a string `id`, or null.
 *
 * @param {unknown} list
 * @returns {string[] | null}
 */
function itemIds(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (!list.every((x) => x && typeof x === 'object' && typeof x.id === 'string')) return null;
  return list.map((x) => x.id);
}

/**
 * What differs between two versions of one object: field names, and `field.itemId` for arrays of
 * objects with ids (quiz questions, steps, cards, sources…), so a reviewer sees which question of
 * a quiz was rewritten.
 *
 * @param {any} before
 * @param {any} after
 * @returns {string[]}
 */
export function changedParts(before, after) {
  /** @type {string[]} */
  const parts = [];
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  for (const key of keys) {
    const b = before?.[key];
    const a = after?.[key];
    if (same(b, a)) continue;
    const bIds = itemIds(b);
    const aIds = itemIds(a);
    if (!bIds || !aIds) {
      parts.push(key);
      continue;
    }
    const bMap = new Map(b.map((/** @type {any} */ x) => [x.id, x]));
    const aMap = new Map(a.map((/** @type {any} */ x) => [x.id, x]));
    /** @type {string[]} */
    const items = [];
    for (const id of aIds) {
      if (!bMap.has(id)) items.push(`${key}.${id} (new)`);
      else if (!same(bMap.get(id), aMap.get(id))) items.push(`${key}.${id}`);
    }
    for (const id of bIds) if (!aMap.has(id)) items.push(`${key}.${id} (removed)`);
    const order = (/** @type {string[]} */ ids, /** @type {Map<string, any>} */ other) => ids.filter((id) => other.has(id)).join('\n');
    if (order(bIds, aMap) !== order(aIds, bMap)) items.push(`${key} (order)`);
    parts.push(...(items.length ? items : [key]));
  }
  return parts;
}

/**
 * The elements of one longest common subsequence of two id lists. Blocks outside it moved.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Set<string>}
 */
function commonSubsequence(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keep = new Set();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keep.add(a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return keep;
}

/**
 * Ids of the items directly inside a block (questions, cards, steps…).
 *
 * @param {any} block
 * @returns {string[]}
 */
function childIds(block) {
  if (!block || typeof block !== 'object') return [];
  return Object.values(block).flatMap((value) => itemIds(value) ?? []);
}

/**
 * The objective ids a block assesses (`objectiveId` anywhere inside it).
 *
 * @param {unknown} value
 * @param {Set<string>} [out]
 * @returns {Set<string>}
 */
function objectiveIds(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) objectiveIds(v, out);
  else if (value && typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value);
    if (typeof obj.objectiveId === 'string') out.add(obj.objectiveId);
    for (const v of Object.values(obj)) objectiveIds(v, out);
  }
  return out;
}

/**
 * Every block of a lesson in reading order, with its section id.
 *
 * @param {any} lesson
 * @returns {{ id: string, section: string, block: any }[]}
 */
export function blockList(lesson) {
  /** @type {{ id: string, section: string, block: any }[]} */
  const out = [];
  if (!Array.isArray(lesson?.sections)) return out;
  forEachBlock(lesson, (block, _path, section) => out.push({ id: String(block?.id), section: String(section?.id), block }));
  return out;
}

/**
 * Compares two revisions of one lesson and decides whether a verification round is allowed.
 *
 * @param {any} before the lesson the previous review read
 * @param {any} after the lesson now
 */
export function compareLessons(before, after) {
  /** @type {string[]} */
  const structural = [];
  const sectionsOf = (/** @type {any} */ lesson) => (Array.isArray(lesson?.sections) ? lesson.sections : []);
  const bSections = sectionsOf(before);
  const aSections = sectionsOf(after);
  const bIds = bSections.map((/** @type {any} */ s) => String(s.id));
  const aIds = aSections.map((/** @type {any} */ s) => String(s.id));
  const added = aIds.filter((id) => !bIds.includes(id));
  const removed = bIds.filter((id) => !aIds.includes(id));
  if (added.length) structural.push(`sections added: ${added.join(', ')}`);
  if (removed.length) structural.push(`sections removed: ${removed.join(', ')}`);
  const bOrder = bIds.filter((id) => aIds.includes(id));
  const aOrder = aIds.filter((id) => bIds.includes(id));
  if (bOrder.join('\n') !== aOrder.join('\n')) structural.push(`sections reordered: ${bOrder.join(' → ')} became ${aOrder.join(' → ')}`);

  const bSectionMap = new Map(bSections.map((/** @type {any} */ s) => [String(s.id), s]));
  /** @type {{ id: string, parts: string[] }[]} */
  const sections = [];
  for (const s of aSections) {
    const old = bSectionMap.get(String(s.id));
    if (!old) continue;
    if (old.role !== s.role) structural.push(`section ${s.id} changed role: ${old.role} → ${s.role}`);
    const { blocks: _oldBlocks, role: _oldRole, ...oldRest } = old;
    const { blocks: _newBlocks, role: _newRole, ...newRest } = s;
    const parts = changedParts(oldRest, newRest);
    if (parts.length) sections.push({ id: String(s.id), parts });
  }

  if (!same(before?.objectives, after?.objectives)) {
    structural.push(`objectives changed: ${changedParts({ objectives: before?.objectives }, { objectives: after?.objectives }).join(', ')}`);
  }

  const bBlocks = blockList(before);
  const aBlocks = blockList(after);
  const bMap = new Map(bBlocks.map((x) => [x.id, x]));
  const aMap = new Map(aBlocks.map((x) => [x.id, x]));
  const inOrder = commonSubsequence(
    bBlocks.filter((x) => aMap.has(x.id)).map((x) => x.id),
    aBlocks.filter((x) => bMap.has(x.id)).map((x) => x.id),
  );
  /** @type {{ id: string, section: string, change: 'modified' | 'moved' | 'added' | 'removed', parts?: string[] }[]} */
  const changes = [];
  for (const x of aBlocks) {
    const old = bMap.get(x.id);
    if (!old) {
      changes.push({ id: x.id, section: x.section, change: 'added' });
      continue;
    }
    const parts = changedParts(old.block, x.block);
    const moved = old.section !== x.section ? `moved from section ${old.section}` : inOrder.has(x.id) ? null : 'moved';
    if (parts.length) changes.push({ id: x.id, section: x.section, change: 'modified', parts: moved ? [...parts, moved] : parts });
    else if (moved) changes.push({ id: x.id, section: x.section, change: 'moved', parts: [moved] });
  }
  for (const x of bBlocks) if (!aMap.has(x.id)) changes.push({ id: x.id, section: x.section, change: 'removed' });

  const total = new Set([...bMap.keys(), ...aMap.keys()]).size;
  const share = total ? changes.length / total : 0;
  // Rounded up, so a recorded share above the limit always means "above the limit".
  const changedShare = Math.max(0, Math.ceil(share * 100 - 1e-9)) / 100;

  const strip = (/** @type {any} */ lesson) => Object.fromEntries(Object.entries(lesson ?? {}).filter(([k]) => !IGNORED_FIELDS.has(k) && k !== 'sections' && k !== 'objectives'));
  const fields = changedParts(strip(before), strip(after));

  const reasons = [...structural];
  if (share > FULL_REVIEW_SHARE) {
    reasons.push(`${changes.length} of ${total} blocks changed (${Math.round(share * 100)}%, more than ${Math.round(FULL_REVIEW_SHARE * 100)}%)`);
  }
  const changed = [
    ...changes.map((c) => c.id),
    ...sections.map((s) => `section.${s.id}`),
    ...fields.map((f) => `lesson.${f.replace(/ \((?:new|removed|order)\)$/, '')}`),
  ];

  // Every id a must-fix item may name that these changes touch: the changed blocks, the questions,
  // cards or steps whose content changed (or that came or went with their block), the sections of
  // the changed blocks and the sections whose fields changed, the objectives the changed blocks
  // assess, and "lesson" when anything changed. check-review.mjs accepts a "resolved" entry only
  // for an item whose id (or a `fixedIn` id) is touched.
  /** @type {Set<string>} */
  const touched = new Set();
  for (const c of changes) {
    const old = bMap.get(c.id);
    const now = aMap.get(c.id);
    touched.add(c.id);
    touched.add(c.section);
    if (old) touched.add(old.section);
    if (c.change !== 'modified') {
      for (const id of [...childIds(old?.block), ...childIds(now?.block)]) touched.add(id);
      for (const id of objectiveIds([old?.block, now?.block])) touched.add(id);
      continue;
    }
    for (const part of c.parts ?? []) {
      // "questions.q2", "cards.card-goal (new)", "md", "questions (order)", "moved from section s1"
      const m = /^([^.\s]+)(?:\.(.+?))?(?: \((?:new|removed|order)\))?$/.exec(part);
      if (m?.[2]) touched.add(m[2]);
      /** @param {any} block */
      const named = (block) => {
        if (!m || !block) return block;
        const value = block[m[1]];
        return m[2] && Array.isArray(value) ? value.filter((x) => x?.id === m[2]) : value;
      };
      for (const id of objectiveIds([named(old?.block), named(now?.block)])) touched.add(id);
    }
  }
  for (const s of sections) touched.add(s.id);
  if (changes.length || sections.length || fields.length) touched.add('lesson');

  return {
    fullReviewRequired: reasons.length > 0,
    reasons,
    structural,
    blocks: { total, changed: changes.length },
    changedShare,
    changes,
    sections,
    fields,
    changed: [...new Set(changed)],
    touched: [...touched].sort(),
  };
}

/** @param {string} value */
const safeSegment = (value) => /^[a-z0-9][a-z0-9_-]*$/i.test(value);

/**
 * Where snapshots of one lesson live: .artifacts/review/<course>/<lesson>/ (by course and lesson
 * id, so a draft published since finds its snapshots too).
 *
 * @param {string} file lesson file path
 * @param {any} lesson parsed lesson
 * @param {string} [root]
 */
export function snapshotDir(file, lesson, root = ROOT) {
  const course = typeof lesson?.courseId === 'string' ? lesson.courseId : path.basename(path.dirname(path.dirname(path.resolve(file))));
  const id = typeof lesson?.id === 'string' ? lesson.id : path.basename(file).replace(/\.lesson\.json$/, '');
  if (!safeSegment(course) || !safeSegment(id)) throw new Error(`Cannot name a snapshot folder for course "${course}", lesson "${id}"`);
  return path.join(root, '.artifacts', 'review', course, id);
}

/**
 * The snapshot folder of a revision `sha256:<hex>`: the folder whose name is the hex, starts with
 * it (a prefix of at least 6 digits) or begins it (a longer hash). Must be unique.
 *
 * @param {string} file
 * @param {any} lesson
 * @param {string} revision
 * @param {string} [root]
 * @returns {{ revision: string, dir: string }}
 */
export function findSnapshot(file, lesson, revision, root = ROOT) {
  const match = SNAPSHOT_REVISION.exec(revision);
  if (!match) throw new Error(`Not a snapshot revision: ${revision} (sha256: and 6–64 hex digits)`);
  const want = match[1].toLowerCase();
  const base = snapshotDir(file, lesson, root);
  const names = fs.existsSync(base)
    ? fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[0-9a-f]{6,64}$/.test(d.name)).map((d) => d.name)
    : [];
  const hits = names.filter((name) => name.startsWith(want) || want.startsWith(name)).sort();
  if (hits.length > 1) {
    throw new Error(`${revision} is ambiguous: it matches the snapshots ${hits.map((h) => `sha256:${h}`).join(', ')}. Give more digits.`);
  }
  if (!hits.length) {
    const shown = path.relative(root, base).split(path.sep).join('/');
    throw new Error(`No snapshot ${revision} for this lesson (looked in ${shown}/). Snapshots live in .artifacts/, which is not committed; compare with a git revision instead.`);
  }
  return { revision: `sha256:${hits[0]}`, dir: path.join(base, hits[0]) };
}

/**
 * The next free round label in a snapshot folder: round-<n> after the highest one.
 *
 * @param {string} dir
 */
function nextRound(dir) {
  const used = fs.readdirSync(dir).map((name) => /^round-(\d+)$/.exec(name)).filter(Boolean).map((m) => Number(/** @type {RegExpExecArray} */ (m)[1]));
  return `round-${used.length ? Math.max(...used) + 1 : 1}`;
}

/**
 * Saves the lesson as it is now and the reviews of this revision saved next to it
 * (content/courses/<course>/reports/<lesson>.<reviewer>.review.json whose lessonHash is the
 * lesson's hash). Never overwrites: the lesson copy of a hash is written once, and each call
 * that copies reviews makes a new round folder.
 *
 * @param {string} file
 * @param {{ root?: string, round?: string | null }} [options] round: label of the new round (default round-<n>)
 * @returns {{ revision: string, dir: string, lesson: string, round: string | null, reviews: string[], skipped: { file: string, reason: string }[] }}
 */
export function saveSnapshot(file, { root = ROOT, round = null } = {}) {
  if (round !== null && !safeSegment(round)) throw new Error(`Invalid round label "${round}": use letters, digits, "-" and "_"`);
  const text = fs.readFileSync(file, 'utf8');
  const lesson = JSON.parse(text);
  const revision = lessonHash(lesson);
  const dir = path.join(snapshotDir(file, lesson, root), revision.slice('sha256:'.length));
  fs.mkdirSync(dir, { recursive: true });
  const lessonCopy = path.join(dir, 'lesson.json');
  // One hash, one content: the first copy stays.
  if (!fs.existsSync(lessonCopy)) fs.writeFileSync(lessonCopy, text);

  const id = typeof lesson.id === 'string' ? lesson.id : path.basename(file).replace(/\.lesson\.json$/, '');
  const reports = path.join(path.dirname(path.dirname(path.resolve(file))), 'reports');
  /** @type {{ reviewer: string, from: string }[]} */
  const matching = [];
  /** @type {{ file: string, reason: string }[]} */
  const skipped = [];
  for (const name of fs.existsSync(reports) ? fs.readdirSync(reports).sort() : []) {
    const reviewer = name.startsWith(`${id}.`) && name.endsWith('.review.json') ? name.slice(id.length + 1, -'.review.json'.length) : '';
    if (!reviewer || reviewer.includes('.')) continue;
    const from = path.join(reports, name);
    /** @type {any} */
    let review;
    try {
      review = JSON.parse(fs.readFileSync(from, 'utf8'));
    } catch {
      skipped.push({ file: from, reason: 'not JSON' });
      continue;
    }
    if (review?.lessonHash === revision) matching.push({ reviewer, from });
    else skipped.push({ file: from, reason: typeof review?.lessonHash === 'string' ? `it read ${review.lessonHash}, not ${revision}` : 'it has no lessonHash' });
  }
  /** @type {string[]} */
  const reviews = [];
  let label = null;
  if (matching.length) {
    label = round ?? nextRound(dir);
    const roundDir = path.join(dir, label);
    if (fs.existsSync(roundDir)) {
      throw new Error(`Round ${label} of ${revision} is already saved (${path.relative(root, roundDir).split(path.sep).join('/')}); a snapshot never overwrites a round. Pass a new --round.`);
    }
    fs.mkdirSync(roundDir);
    for (const { reviewer, from } of matching) {
      const copy = path.join(roundDir, `${reviewer}.review.json`);
      fs.copyFileSync(from, copy, fs.constants.COPYFILE_EXCL);
      reviews.push(copy);
    }
  }
  return { revision, dir, lesson: lessonCopy, round: label, reviews, skipped };
}

/**
 * Paths a lesson file may have had: drafts/<id> first, then lessons/<id>, for a lesson under one
 * of them; the path itself otherwise.
 *
 * @param {string} rel repo-relative path with "/" separators
 * @returns {string[]}
 */
export function lessonPathCandidates(rel) {
  const match = /^(.*\/)?(?:drafts|lessons)(\/[^/]+\.lesson\.json)$/.exec(rel);
  return match ? [`${match[1] ?? ''}drafts${match[2]}`, `${match[1] ?? ''}lessons${match[2]}`] : [rel];
}

/** @param {string} text */
function hashOfText(text) {
  try {
    return lessonHash(JSON.parse(text));
  } catch {
    return '(not JSON)';
  }
}

/**
 * The text of the lesson the previous review read.
 *
 * @param {{ since?: string | null, before?: string | null }} args
 * @param {string} file current lesson file
 * @param {any} lesson current lesson, parsed
 * @param {{ root?: string, expectHash?: string | null }} [options] expectHash: the previous review's
 *   lessonHash; the version read must have it
 * @returns {{ text: string, revision: string, source: string }}
 */
export function readBefore(args, file, lesson, { root = ROOT, expectHash = null } = {}) {
  const shown = (/** @type {string} */ p) => path.relative(root, p).split(path.sep).join('/');
  const expect = (/** @type {string} */ text, /** @type {string} */ where) => {
    const hash = hashOfText(text);
    if (expectHash && hash !== expectHash) throw new Error(`${where} is ${hash}, not ${expectHash}, the lesson the previous review read`);
    return hash;
  };
  if (args.before) {
    const p = path.resolve(args.before);
    if (!fs.existsSync(p)) throw new Error(`No such file: ${args.before}`);
    const text = fs.readFileSync(p, 'utf8');
    return { text, revision: expect(text, shown(p)), source: shown(p) };
  }
  const since = String(args.since ?? '');
  if (/^sha256:/i.test(since)) {
    const snapshot = findSnapshot(file, lesson, since, root);
    const p = path.join(snapshot.dir, 'lesson.json');
    if (!fs.existsSync(p)) throw new Error(`The snapshot ${snapshot.revision} has no lesson.json (${shown(p)})`);
    const text = fs.readFileSync(p, 'utf8');
    expect(text, `The snapshot ${snapshot.revision}`);
    return { text, revision: snapshot.revision, source: shown(p) };
  }
  // The revision comes from a review: refuse anything git could read as an option before running it.
  const rev = GIT_REVISION.test(since) ? git(['rev-parse', '--verify', '--quiet', '--short', '--end-of-options', `${since}^{commit}`], root) : null;
  if (!rev?.ok) throw new Error(`Not a git revision or sha256:<hash> snapshot: ${since || '(empty)'}`);
  const short = rev.stdout.trim();
  const rel = path.relative(root, path.resolve(file)).split(path.sep).join('/');
  if (rel.startsWith('../') || path.isAbsolute(rel)) throw new Error(`${file} is outside the repository, so git has no earlier revision of it; use --before or a sha256: snapshot`);
  // A reworked published lesson is reviewed as its draft: at that revision drafts/<id> comes
  // first, then lessons/<id>, whichever path the file has now.
  const candidates = lessonPathCandidates(rel);
  /** @type {string[]} */
  const others = [];
  for (const candidate of candidates) {
    const show = git(['show', `${short}:${candidate}`], root);
    if (!show.ok) continue;
    const hash = hashOfText(show.stdout);
    if (!expectHash || hash === expectHash) return { text: show.stdout, revision: short, source: `${short}:${candidate}` };
    others.push(`${candidate} is ${hash}`);
  }
  if (others.length) throw new Error(`No version of the lesson at ${short} is ${expectHash}, the lesson the previous review read (${others.join('; ')})`);
  throw new Error(`${rel} does not exist at ${short}${candidates.length > 1 ? ` (tried ${candidates.join(', ')})` : ''}`);
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const out = {
    file: /** @type {string | null} */ (null),
    since: /** @type {string | null} */ (null),
    before: /** @type {string | null} */ (null),
    expectHash: /** @type {string | null} */ (null),
    round: /** @type {string | null} */ (null),
    snapshot: false,
    hash: false,
    diff: false,
    json: false,
  };
  /** @type {Record<string, 'since' | 'before' | 'expectHash' | 'round'>} */
  const valued = { '--since': 'since', '--before': 'before', '--expect-hash': 'expectHash', '--round': 'round' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg in valued) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value\n${USAGE}`);
      out[valued[arg]] = value;
      i += 1;
    } else if (arg === '--snapshot') out.snapshot = true;
    else if (arg === '--hash') out.hash = true;
    else if (arg === '--diff') out.diff = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}\n${USAGE}`);
    else if (!out.file) out.file = arg;
    else throw new Error(`Unexpected argument ${arg}\n${USAGE}`);
  }
  if (!out.file) throw new Error(USAGE);
  if ([out.snapshot, out.hash, Boolean(out.since), Boolean(out.before)].filter(Boolean).length !== 1) {
    throw new Error(`Pass exactly one of --since, --before, --hash or --snapshot.\n${USAGE}`);
  }
  if (out.round && !out.snapshot) throw new Error(`--round goes with --snapshot.\n${USAGE}`);
  if (out.expectHash && !out.since && !out.before) throw new Error(`--expect-hash goes with --since or --before.\n${USAGE}`);
  if (out.expectHash && !LESSON_HASH.test(out.expectHash)) throw new Error(`--expect-hash takes a lessonHash (sha256: and 16 hex digits), not ${out.expectHash}`);
  return out;
}

/**
 * @param {ReturnType<typeof compareLessons>} scope
 * @param {{ file: string, revision: string, source: string, lessonHash?: string, diff?: boolean, before?: any, after?: any }} info
 */
export function formatScope(scope, info) {
  const pct = Math.round(scope.changedShare * 100);
  const lines = [
    `Changes in ${info.file} since ${info.revision}${info.source.startsWith(info.revision) ? '' : ` (${info.source})`}`,
    `  ${scope.blocks.changed} of ${scope.blocks.total} blocks changed (${pct}%; above ${Math.round(FULL_REVIEW_SHARE * 100)}% a full review is required) · ${scope.structural.length ? 'structure changed' : 'sections and objectives unchanged'}`,
    scope.fullReviewRequired
      ? `  → FULL REVIEW required: ${scope.reasons.join('; ')}`
      : `  → VERIFY: a fix-verification round is allowed. Every change below is reviewed in full.`,
  ];
  const width = Math.max(8, ...scope.changes.map((c) => `${c.section} / ${c.id}`.length));
  for (const c of scope.changes) lines.push(`  ${c.change.padEnd(9)} ${`${c.section} / ${c.id}`.padEnd(width)}  ${(c.parts ?? []).join(', ')}`.trimEnd());
  for (const s of scope.sections) lines.push(`  ${'section'.padEnd(9)} ${s.id.padEnd(width)}  ${s.parts.join(', ')}`);
  if (scope.fields.length) lines.push(`  ${'lesson'.padEnd(9)} ${scope.fields.join(', ')}`);
  if (!scope.changes.length && !scope.sections.length && !scope.fields.length) lines.push('  no content changes');
  if (info.lessonHash) lines.push('', `lessonHash (copy into every review of this round): ${info.lessonHash}`);
  if (!scope.fullReviewRequired) {
    lines.push('', 'verifies (copy into each verification review and add "previousReview"):');
    lines.push(`  ${JSON.stringify({ reviewedRevision: info.revision, changed: scope.changed, changedShare: scope.changedShare, fullReviewRequired: false })}`);
  }
  if (info.diff && info.before && info.after) {
    const bMap = new Map(blockList(info.before).map((x) => [x.id, x.block]));
    const aMap = new Map(blockList(info.after).map((x) => [x.id, x.block]));
    for (const c of scope.changes) {
      if (c.change === 'moved') continue;
      lines.push('', `=== ${c.id} (${c.change}, section ${c.section})`);
      if (bMap.has(c.id)) lines.push('--- before', JSON.stringify(bMap.get(c.id), null, 2));
      if (aMap.has(c.id)) lines.push('+++ after', JSON.stringify(aMap.get(c.id), null, 2));
    }
  }
  return lines.join('\n');
}

function main() {
  /** @type {ReturnType<typeof parseArgs>} */
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const file = path.resolve(process.cwd(), /** @type {string} */ (args.file));
  const rel = (/** @type {string} */ p) => path.relative(ROOT, p).split(path.sep).join('/');
  const shownFile = rel(file);
  try {
    if (args.hash) {
      console.log(lessonHash(JSON.parse(fs.readFileSync(file, 'utf8'))));
      return 0;
    }
    if (args.snapshot) {
      const saved = saveSnapshot(file, { round: args.round });
      console.log(`Saved the reviewed revision ${saved.revision} of ${shownFile}`);
      console.log(`  lesson   ${rel(saved.lesson)}`);
      console.log(`  reviews  ${saved.reviews.length ? `${saved.round}: ${saved.reviews.map(rel).join(', ')}` : '(none of this revision saved yet; each review needs "lessonHash": "' + saved.revision + '")'}`);
      for (const s of saved.skipped) console.log(`  skipped  ${rel(s.file)}: ${s.reason}`);
      console.log(`Next round: node .claude/skills/review-lesson/scripts/review-scope.mjs ${shownFile} --since ${saved.revision}`);
      if (saved.reviews.length) console.log(`  previousReview of the next round: ${rel(path.dirname(saved.reviews[0]))}/<reviewer>.review.json`);
      return 0;
    }
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    const prior = readBefore(args, file, after, { expectHash: args.expectHash });
    const before = JSON.parse(prior.text);
    const scope = compareLessons(before, after);
    const hash = lessonHash(after);
    if (args.json) {
      console.log(JSON.stringify({
        lessonId: after.id ?? null,
        file: shownFile,
        lessonHash: hash,
        reviewedRevision: prior.revision,
        before: prior.source,
        mode: scope.fullReviewRequired ? 'full' : 'verify',
        ...scope,
        verifies: { reviewedRevision: prior.revision, changed: scope.changed, changedShare: scope.changedShare, fullReviewRequired: scope.fullReviewRequired },
      }, null, 2));
    } else {
      console.log(formatScope(scope, { file: shownFile, revision: prior.revision, source: prior.source, lessonHash: hash, diff: args.diff, before, after }));
    }
    return scope.fullReviewRequired ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
