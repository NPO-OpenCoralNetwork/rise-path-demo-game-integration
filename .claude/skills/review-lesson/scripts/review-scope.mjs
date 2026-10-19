#!/usr/bin/env node
/**
 * Fix-verification scope: compares a lesson with the revision a previous review read, lists what
 * changed, and decides whether the next review round may be a verification round or must be a
 * full review (.claude/skills/review-lesson/SKILL.md, "Verification round").
 *
 * A full review is required when, since the reviewed revision,
 *   - a section was added, removed or reordered, or a section's role changed;
 *   - the objectives changed (ids, text, Bloom level or order); or
 *   - more than 30% of the blocks were changed, added, removed or moved.
 * Otherwise a verification round is allowed. Key order and `provenance` never count as changes.
 *
 * Usage:
 *   node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --since <git-rev | sha256:<hash>> [--diff] [--json]
 *   node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --before <old lesson.json> [--diff] [--json]
 *   node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --snapshot
 *
 * --snapshot is for drafts that are not committed. Run it right after the reviews of a round are
 * saved: it copies the lesson and its saved reviews (reports/<lesson>.<reviewer>.review.json) to
 * .artifacts/review/<course>/<lesson>/<hash>/ and prints the revision `sha256:<hash>` that --since
 * takes later. --diff prints every changed block before and after. --json prints the result,
 * including the `verifies` object that a verification review copies.
 *
 * Exit codes: 0 verification allowed (or snapshot saved) · 1 full review required · 2 invalid input.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Above this share of changed blocks a re-review must be a full review. */
export const FULL_REVIEW_SHARE = 0.3;

/** Lesson fields that are not learner-facing content. */
const IGNORED_FIELDS = new Set(['provenance']);

const USAGE = [
  'Usage:',
  '  node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --since <git-rev | sha256:<hash>> [--diff] [--json]',
  '  node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --before <old lesson.json> [--diff] [--json]',
  '  node .claude/skills/review-lesson/scripts/review-scope.mjs <lesson.json> --snapshot',
].join('\n');

/**
 * JSON with sorted keys, so that key order never counts as a change.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => canonical(a) === canonical(b);

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
 * Every block of a lesson in reading order, with its section id.
 *
 * @param {any} lesson
 * @returns {{ id: string, section: string, block: any }[]}
 */
export function blockList(lesson) {
  const sections = Array.isArray(lesson?.sections) ? lesson.sections : [];
  return sections.flatMap((/** @type {any} */ s) => (Array.isArray(s?.blocks) ? s.blocks : []).map((/** @type {any} */ b) => ({ id: String(b?.id), section: String(s.id), block: b })));
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
  };
}

/** @param {string} value */
const safeSegment = (value) => /^[a-z0-9][a-z0-9_-]*$/i.test(value);

/**
 * Where snapshots of one lesson live: .artifacts/review/<course>/<lesson>/.
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

/** @param {string} text */
export const revisionHash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);

/**
 * Saves the lesson as it is now and the reviews saved next to it
 * (content/courses/<course>/reports/<lesson>.<reviewer>.review.json).
 *
 * @param {string} file
 * @param {{ root?: string }} [options]
 * @returns {{ revision: string, dir: string, lesson: string, reviews: string[] }}
 */
export function saveSnapshot(file, { root = ROOT } = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const lesson = JSON.parse(text);
  const hash = revisionHash(text);
  const dir = path.join(snapshotDir(file, lesson, root), hash);
  fs.mkdirSync(dir, { recursive: true });
  const lessonCopy = path.join(dir, 'lesson.json');
  fs.writeFileSync(lessonCopy, text);
  const id = typeof lesson.id === 'string' ? lesson.id : path.basename(file).replace(/\.lesson\.json$/, '');
  const reports = path.join(path.dirname(path.dirname(path.resolve(file))), 'reports');
  /** @type {string[]} */
  const reviews = [];
  for (const name of fs.existsSync(reports) ? fs.readdirSync(reports).sort() : []) {
    const reviewer = name.startsWith(`${id}.`) && name.endsWith('.review.json') ? name.slice(id.length + 1, -'.review.json'.length) : '';
    if (!reviewer || reviewer.includes('.')) continue;
    const copy = path.join(dir, `${reviewer}.review.json`);
    fs.copyFileSync(path.join(reports, name), copy);
    reviews.push(copy);
  }
  return { revision: `sha256:${hash}`, dir, lesson: lessonCopy, reviews };
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
function git(args, cwd = ROOT) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: res.status === 0, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * The text of the lesson the previous review read.
 *
 * @param {{ since?: string | null, before?: string | null }} args
 * @param {string} file current lesson file
 * @param {any} lesson current lesson, parsed
 * @param {{ root?: string }} [options]
 * @returns {{ text: string, revision: string, source: string }}
 */
export function readBefore(args, file, lesson, { root = ROOT } = {}) {
  const shown = (/** @type {string} */ p) => path.relative(root, p).split(path.sep).join('/');
  if (args.before) {
    const p = path.resolve(args.before);
    if (!fs.existsSync(p)) throw new Error(`No such file: ${args.before}`);
    const text = fs.readFileSync(p, 'utf8');
    return { text, revision: `sha256:${revisionHash(text)}`, source: shown(p) };
  }
  const since = String(args.since ?? '');
  const snapshot = /^sha256:([0-9a-f]{6,64})$/.exec(since);
  if (snapshot) {
    const p = path.join(snapshotDir(file, lesson, root), snapshot[1], 'lesson.json');
    if (!fs.existsSync(p)) {
      throw new Error(`No snapshot ${since} for this lesson (looked for ${shown(p)}). Snapshots live in .artifacts/, which is not committed; compare with a git revision instead.`);
    }
    return { text: fs.readFileSync(p, 'utf8'), revision: since, source: shown(p) };
  }
  const rev = git(['rev-parse', '--verify', '--quiet', '--short', `${since}^{commit}`], root);
  if (!since || !rev.ok) throw new Error(`Not a git revision or sha256:<hash> snapshot: ${since || '(empty)'}`);
  const short = rev.stdout.trim();
  const rel = path.relative(root, path.resolve(file)).split(path.sep).join('/');
  // A lesson reviewed as a draft and published since (or the reverse) is found at its other path.
  const candidates = [...new Set([rel, rel.replace('/drafts/', '/lessons/'), rel.replace('/lessons/', '/drafts/')])];
  for (const candidate of candidates) {
    const show = git(['show', `${short}:${candidate}`], root);
    if (show.ok) return { text: show.stdout, revision: short, source: `${short}:${candidate}` };
  }
  throw new Error(`${rel} does not exist at ${short}${candidates.length > 1 ? ` (also tried ${candidates.slice(1).join(', ')})` : ''}`);
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const out = { file: /** @type {string | null} */ (null), since: /** @type {string | null} */ (null), before: /** @type {string | null} */ (null), snapshot: false, diff: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--since' || arg === '--before') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value\n${USAGE}`);
      out[arg === '--since' ? 'since' : 'before'] = value;
      i += 1;
    } else if (arg === '--snapshot') out.snapshot = true;
    else if (arg === '--diff') out.diff = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}\n${USAGE}`);
    else if (!out.file) out.file = arg;
    else throw new Error(`Unexpected argument ${arg}\n${USAGE}`);
  }
  if (!out.file) throw new Error(USAGE);
  if ([out.snapshot, Boolean(out.since), Boolean(out.before)].filter(Boolean).length !== 1) {
    throw new Error(`Pass exactly one of --since, --before or --snapshot.\n${USAGE}`);
  }
  return out;
}

/**
 * @param {ReturnType<typeof compareLessons>} scope
 * @param {{ file: string, revision: string, source: string, diff?: boolean, before?: any, after?: any }} info
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
  const shownFile = path.relative(ROOT, file).split(path.sep).join('/');
  try {
    if (args.snapshot) {
      const saved = saveSnapshot(file);
      const rel = (/** @type {string} */ p) => path.relative(ROOT, p).split(path.sep).join('/');
      console.log(`Saved the reviewed revision ${saved.revision} of ${shownFile}`);
      console.log(`  lesson   ${rel(saved.lesson)}`);
      console.log(`  reviews  ${saved.reviews.length ? saved.reviews.map(rel).join(', ') : '(none saved yet)'}`);
      console.log(`Next round: node .claude/skills/review-lesson/scripts/review-scope.mjs ${shownFile} --since ${saved.revision}`);
      return 0;
    }
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    const prior = readBefore(args, file, after);
    const before = JSON.parse(prior.text);
    const scope = compareLessons(before, after);
    if (args.json) {
      console.log(JSON.stringify({
        lessonId: after.id ?? null,
        file: shownFile,
        reviewedRevision: prior.revision,
        before: prior.source,
        mode: scope.fullReviewRequired ? 'full' : 'verify',
        ...scope,
        verifies: { reviewedRevision: prior.revision, changed: scope.changed, changedShare: scope.changedShare, fullReviewRequired: scope.fullReviewRequired },
      }, null, 2));
    } else {
      console.log(formatScope(scope, { file: shownFile, revision: prior.revision, source: prior.source, diff: args.diff, before, after }));
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
