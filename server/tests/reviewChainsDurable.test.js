/**
 * The review records of published lessons can be checked in any clone. A verification round names
 * the round it verifies; for a lesson under content/courses/<course>/lessons/ that must be the
 * committed reports file, <commit id>:content/courses/<course>/reports/<lesson>.<reviewer>.review.json,
 * and verifies.reviewedRevision must be a commit id. A snapshot copy under .artifacts/review/
 * (git-ignored) or a sha256: revision exists only in the checkout that made it, so check-review.mjs
 * fails everywhere else. With git history (CI checks out in full), every earlier verification on
 * the chain is checked the same way, and each reviewedRevision must name a commit of this repository
 * (an amended or rebased local commit is in no other clone). Drafts may still verify against snapshots.
 * Rules: .claude/skills/review-lesson/SKILL.md.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CHAIN } from '../../.claude/skills/review-lesson/scripts/check-review.mjs';
import { COMMIT_ID, git, resolveCommitId } from '../../.claude/skills/review-lesson/scripts/review-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSES = path.join(ROOT, 'content', 'courses');
/** A clone with all of its history: a commit a round names that is missing is a broken chain. */
const FULL_HISTORY = git(['rev-parse', '--is-shallow-repository'], ROOT).stdout.trim() === 'false';

const FIX = 'Snapshot copies (.artifacts/review/…) and sha256: revisions exist only in the checkout that made them. '
  + 'Redo this round as a full review (no "verifies"), or verify against a committed previous round: '
  + 'previousReview <commit id>:<reports file> and reviewedRevision <commit id> (review-scope.mjs <lesson> --since <commit id> --json).';

/**
 * Why a verification's `verifies` cannot be checked in another clone, or null.
 *
 * @param {any} verifies
 * @param {string} reports the committed reports file it must name, repo-relative
 */
function durableProblem(verifies, reports) {
  const prev = verifies?.previousReview;
  const colon = typeof prev === 'string' ? prev.indexOf(':') : -1;
  if (colon < 0 || !COMMIT_ID.test(prev.slice(0, colon)) || prev.slice(colon + 1) !== reports) {
    return `verifies.previousReview ${JSON.stringify(prev)} is not <commit id>:${reports}`;
  }
  if (typeof verifies.reviewedRevision !== 'string' || !COMMIT_ID.test(verifies.reviewedRevision)) {
    return `verifies.reviewedRevision ${JSON.stringify(verifies.reviewedRevision)} is not a commit id`;
  }
  return null;
}

/** Verification reviews of published lessons: { reports, review }. */
function publishedVerifications() {
  const found = [];
  for (const course of fs.readdirSync(COURSES).sort()) {
    const lessons = path.join(COURSES, course, 'lessons');
    if (!fs.existsSync(lessons)) continue;
    const reportsDir = path.join(COURSES, course, 'reports');
    const reportNames = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).sort() : [];
    for (const name of fs.readdirSync(lessons).sort()) {
      if (!name.endsWith('.lesson.json')) continue;
      const id = name.slice(0, -'.lesson.json'.length);
      const draft = `content/courses/${course}/drafts/${id}.lesson.json`;
      for (const report of reportNames) {
        const reviewer = report.startsWith(`${id}.`) && report.endsWith('.review.json') ? report.slice(id.length + 1, -'.review.json'.length) : '';
        if (!reviewer || reviewer.includes('.')) continue;
        const reports = `content/courses/${course}/reports/${report}`;
        const review = JSON.parse(fs.readFileSync(path.join(ROOT, reports), 'utf8'));
        if (review.mode !== 'verify') continue;
        // A rework of a published lesson is a draft again until it is published.
        if (review.file === draft && fs.existsSync(path.join(ROOT, draft))) continue;
        found.push({ reports, review });
      }
    }
  }
  return found;
}

/**
 * Every problem on the chain of rounds from `review` back to its full review. Earlier rounds are
 * read with git; in a shallow clone (or no git checkout) the chain stops at a missing commit.
 */
function chainProblems({ reports, review }) {
  const problems = [];
  let round = review;
  let at = reports;
  for (let depth = 0; round?.mode === 'verify'; depth++) {
    const problem = durableProblem(round.verifies, reports);
    if (problem) {
      problems.push(`${at}: ${problem}`);
      break;
    }
    const revision = round.verifies.reviewedRevision;
    if (FULL_HISTORY && !resolveCommitId(revision, ROOT)) {
      problems.push(`${at}: verifies.reviewedRevision ${revision} names no commit of this repository (or a branch or tag has that name)`);
    }
    if (depth >= MAX_CHAIN) {
      problems.push(`${at}: the chain goes back more than ${MAX_CHAIN} rounds; do a full review`);
      break;
    }
    const spec = round.verifies.previousReview;
    const sha = resolveCommitId(spec.slice(0, spec.indexOf(':')), ROOT);
    if (!sha) {
      if (FULL_HISTORY) problems.push(`${at}: ${spec} names no commit of this repository (or a branch or tag has that name)`);
      break;
    }
    const show = git(['show', `${sha}:${reports}`], ROOT);
    if (!show.ok) {
      problems.push(`${at}: ${spec} is not a file, and git cannot show it`);
      break;
    }
    at = spec;
    try {
      round = JSON.parse(show.stdout);
    } catch {
      problems.push(`${at}: cannot read it as JSON`);
      break;
    }
  }
  return problems;
}

describe('a verification round must name a committed previous round', () => {
  const reports = 'content/courses/demo/reports/demo.ja-editor.review.json';

  it('accepts <commit id>:<reports file> with a commit id as reviewedRevision', () => {
    assert.equal(durableProblem({ previousReview: `a0c0ded:${reports}`, reviewedRevision: 'a0c0ded' }, reports), null);
  });

  it('refuses snapshot copies, refs, another reports file and sha256: revisions', () => {
    for (const previousReview of [
      '.artifacts/review/demo/demo/a0ee84f2b69dd0e5/round-1/ja-editor.review.json',
      `HEAD:${reports}`,
      `a0c0ded:${reports.replace('ja-editor', 'pedagogy-reviewer')}`,
      reports,
    ]) {
      assert.ok(durableProblem({ previousReview, reviewedRevision: 'a0c0ded' }, reports), previousReview);
    }
    assert.ok(durableProblem({ previousReview: `a0c0ded:${reports}`, reviewedRevision: 'sha256:a0ee84f2b69dd0e5' }, reports));
  });
});

describe('verification rounds of published lessons can be checked in a fresh clone', () => {
  const verifications = publishedVerifications();
  if (!verifications.length) it('no published lesson has a verification round', () => {});
  else {
    it('refuses a reviewedRevision that names no commit of this repository', { skip: !FULL_HISTORY && 'needs full git history' }, () => {
      const [{ reports, review }] = verifications;
      const missing = '0000000000000000000000000000000000000000';
      const problems = chainProblems({ reports, review: { ...review, verifies: { ...review.verifies, reviewedRevision: missing } } });
      assert.ok(problems.some((p) => p.startsWith(`${reports}: verifies.reviewedRevision ${missing} names no commit`)), problems.join('\n'));
    });
  }
  for (const verification of verifications) {
    it(verification.reports, () => {
      const problems = chainProblems(verification);
      assert.deepEqual(problems, [], `${problems.join('\n')}\n${FIX}`);
    });
  }
});
