/**
 * Review gate hardening (PR #20 review findings F1–F6, F8–F10): check-review.mjs and
 * review-scope.mjs must not let a verification round pass without the checks it relies on.
 * Each describe block reproduces one finding; the scripts are imported as namespaces so that a
 * missing export fails only the tests that need it.
 * Rules: .claude/skills/review-lesson/SKILL.md.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checkReview from '../../.claude/skills/review-lesson/scripts/check-review.mjs';
import * as reviewScope from '../../.claude/skills/review-lesson/scripts/review-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, '.claude', 'skills', 'review-lesson', 'scripts');
const schemas = checkReview.loadSchemas(ROOT);
const ids = schemas.rubric.criteria.map((c) => c.id);

const DRAFT = 'content/courses/demo-course/drafts/demo.lesson.json';
const PUBLISHED = 'content/courses/demo-course/lessons/demo.lesson.json';
const REPORT = 'content/courses/demo-course/reports/demo.pedagogy-reviewer.review.json';

/** Lesson "demo": ten blocks in two sections. `fixed` rewrites b2 (the round-1 must-fix). */
const demoLesson = ({ fixed = false, reordered = false, b5 } = {}) => {
  const block = (id, md) => ({ id, type: 'markdown', md: md ?? `Text of ${id}.` });
  const sections = [
    { id: 's1', role: 'concept', title: 'One', blocks: [block('b1'), block('b2', fixed ? '…です。' : '…だ。'), block('b3'), block('b4'), block('b5', b5)] },
    { id: 's2', role: 'check', title: 'Two', blocks: [block('b6'), block('b7'), block('b8'), block('b9'), block('b10')] },
  ];
  return {
    schema: 'risepath.lesson/v1',
    id: 'demo',
    courseId: 'demo-course',
    title: 'Demo',
    objectives: [{ id: 'o1', text: 'Explain X', bloom: 'understand' }],
    sections: reordered ? sections.reverse() : sections,
    provenance: { author: 'claude-code', generatedAt: '2026-10-19' },
  };
};

/** A review.v1 document of "demo"; `scoreOf` returns undefined for criteria outside the reviewer's scope. */
const review = (reviewer, scoreOf, extra = {}) => ({
  lessonId: 'demo',
  file: DRAFT,
  reviewer,
  rubricVersion: 'rubric.v1',
  scores: ids.filter((id) => scoreOf(id) !== undefined).map((id) => ({ id, score: scoreOf(id), evidence: `Block b1 shows ${id}.` })),
  mustFix: [],
  niceToHave: [],
  verdict: 'pass',
  summary: 'Clear and aligned.',
  ...extra,
});

/** Round 1: a full review; voice is 2 because of b2. */
const round1 = (extra = {}) => review('pedagogy-reviewer', (id) => (id === 'voice' ? 2 : 4), {
  verdict: 'revise',
  mustFix: [{ criterion: 'voice', blockId: 'b2', issue: 'Plain form 「…だ。」.', fix: '「…だ。」→「…です。」' }],
  ...extra,
});

/** Round 2: a verification of round 1 (b2 fixed, voice re-scored, the rest carried over). */
const round2 = (extra = {}) => ({
  ...review('pedagogy-reviewer', () => 4),
  scores: ids.map((id) => ({ id, score: 4, evidence: `Block b1 shows ${id}.`, ...(id === 'voice' ? {} : { carriedOver: true }) })),
  mode: 'verify',
  verifies: { reviewedRevision: 'abc1234', previousReview: `abc1234:${REPORT}`, changed: ['b2'], changedShare: 0.1, fullReviewRequired: false },
  resolved: [{ blockId: 'b2', criterion: 'voice', status: 'resolved', evidence: 'b2 now reads 「…です。」.' }],
  ...extra,
});

/** Without lessonHash: also a valid review for the gate before lessonHash existed. */
const LEGACY = { lesson: { id: 'demo', hash: 'sha256:0123456789abcdef' }, allowLegacy: true };
const scopeOf = (before, after) => ({ 'pedagogy-reviewer': reviewScope.compareLessons(before, after) });

/** A scratch repository root; removed afterwards. */
const withRoot = async (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-gate-'));
  const write = (rel, value) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    return file;
  };
  try {
    return await fn(root, write);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/** check-review.mjs in-process against a scratch root. */
const gateIn = (root, args, stdin) => {
  const out = [];
  const err = [];
  const status = checkReview.runCli(args, { root, cwd: root, readStdin: () => stdin, log: (l) => out.push(l), error: (l) => err.push(l) });
  return { status, stdout: out.join('\n'), stderr: err.join('\n') };
};

/** check-review.mjs as a process. */
const gateCli = (args, { cwd = ROOT, input } = {}) => spawnSync(process.execPath, [path.join(SCRIPTS, 'check-review.mjs'), ...args], { cwd, input, encoding: 'utf8' });

/**
 * Round 1 reviewed the unfixed draft, was saved to reports/ and snapshotted; the fixes are applied.
 * Returns the snapshot revision, the current hash and the snapshot copy of round 1 (the previous
 * review, repo-relative).
 */
const snapshotRound1 = (root, write, { after = demoLesson({ fixed: true }) } = {}) => {
  const lessonFile = write(DRAFT, demoLesson());
  write(REPORT, round1({ lessonHash: reviewScope.lessonHash(demoLesson()) }));
  const saved = reviewScope.saveSnapshot(lessonFile, { root });
  write(DRAFT, after);
  const prevFile = path.relative(root, saved.reviews[0]).split(path.sep).join('/');
  return { revision: saved.revision, now: reviewScope.lessonHash(after), prevFile };
};

describe('F1: a verification whose previous review cannot be loaded fails the gate', () => {
  it('library: no previous review is an error, not a warning', () => {
    const result = checkReview.evaluateReviews([round2()], schemas, { ...LEGACY, scopes: scopeOf(demoLesson(), demoLesson({ fixed: true })) });
    assert.equal(result.valid, false, 'the old gate passed it with a note');
    assert.ok(result.errors.some((e) => /previous review was not loaded/.test(e)), result.errors.join('\n'));
  });

  it('CLI: a missing previousReview path, or the file being checked, exits 2', () => withRoot((root, write) => {
    const lesson = write(DRAFT, demoLesson({ fixed: true }));
    const missing = write('missing-prev.json', round2({ verifies: { ...round2().verifies, previousReview: path.join(root, 'nowhere.json') } }));
    const run = gateCli([missing, '--lesson', lesson]);
    assert.equal(run.status, 2, `${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /previous review was not loaded \(.*nowhere\.json is not a file, and git cannot show it\)/);

    const selfFile = path.join(root, 'self.json');
    fs.writeFileSync(selfFile, JSON.stringify(round2({ verifies: { ...round2().verifies, previousReview: selfFile } })));
    const self = gateCli([selfFile, '--lesson', lesson]);
    assert.equal(self.status, 2, `${self.stdout}${self.stderr}`);
    assert.match(self.stderr, /previous review was not loaded \(.*self\.json is the file being checked/);
  }));

  it('CLI: with everything else in order, the missing previous review alone exits 2', () => withRoot((root, write) => {
    const { revision, now } = snapshotRound1(root, write);
    const r = round2({ lessonHash: now, verifies: { ...round2().verifies, reviewedRevision: revision, previousReview: 'prev/nowhere.json' } });
    const run = gateIn(root, [write('r2.json', r)]);
    assert.equal(run.status, 2, run.stdout);
    assert.match(run.stderr, /previous review was not loaded \(prev\/nowhere\.json is not a file/);
  }));
});

describe('F2: a verification must list every criterion its previous review scored', () => {
  const withoutVoice = () => {
    const r = round2();
    r.scores = r.scores.filter((s) => s.id !== 'voice');
    return r;
  };

  it('a low score left out of the verification cannot be replaced by another reviewer\'s higher score', () => {
    const ja = review('ja-editor', (id) => (id === 'voice' || id === 'load' ? 4 : undefined));
    const result = checkReview.evaluateReviews([withoutVoice(), ja], schemas, { ...LEGACY, previous: [round1()], scopes: scopeOf(demoLesson(), demoLesson({ fixed: true })) });
    assert.equal(result.valid, false, `the old gate merged voice = ${result.scores?.find((s) => s.id === 'voice')?.score} and said ${result.verdict}`);
    assert.ok(result.errors.some((e) => /previous review scored voice, which this verification leaves out/.test(e)), result.errors.join('\n'));
  });

  it('re-scored and carried-over criteria both count as listed', () => {
    const result = checkReview.evaluateReviews([round2()], schemas, { ...LEGACY, previous: [round1()], scopes: scopeOf(demoLesson(), demoLesson({ fixed: true })) });
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.equal(result.verdict, 'pass');
  });
});

describe('F3: --since compares a reworked published lesson with its draft', () => {
  it('prefers drafts/<id> at the revision, then lessons/<id>; --expect-hash picks the version the previous review read', () => withRoot((root, write) => {
    const git = (...args) => {
      const res = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
      return res.stdout.trim();
    };
    git('init', '-q');
    // Round 1 reviewed the rework draft while the old version was still published.
    const oldPublished = { ...demoLesson({ reordered: true }), title: 'Old published' };
    write(DRAFT, demoLesson());
    write(PUBLISHED, oldPublished);
    git('add', '-A');
    git('commit', '-q', '-m', 'round 1');
    const rev = git('rev-parse', '--short', 'HEAD');
    // Fixes applied and published: the draft moved to lessons/.
    fs.rmSync(path.join(root, DRAFT));
    const current = demoLesson({ fixed: true });
    const file = write(PUBLISHED, current);
    git('add', '-A');
    git('commit', '-q', '-m', 'publish');

    const prior = reviewScope.readBefore({ since: rev }, file, current, { root });
    assert.equal(prior.source, `${rev}:${DRAFT}`, 'the old script compared with the old published version');
    const scope = reviewScope.compareLessons(JSON.parse(prior.text), current);
    assert.equal(scope.fullReviewRequired, false);
    assert.deepEqual(scope.changed, ['b2']);

    // A previous review of the published version names its hash; that version is taken.
    const published = reviewScope.readBefore({ since: rev }, file, current, { root, expectHash: reviewScope.lessonHash(oldPublished) });
    assert.equal(published.source, `${rev}:${PUBLISHED}`);
    assert.throws(() => reviewScope.readBefore({ since: rev }, file, current, { root, expectHash: 'sha256:ffffffffffffffff' }), /No version of the lesson at [0-9a-f]+ is sha256:ffffffffffffffff/);
  }));

  it('check-review verifies a lesson that moved from drafts/ to lessons/ between rounds', () => withRoot((root, write) => {
    const git = (...args) => {
      const res = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
      return res.stdout.trim();
    };
    git('init', '-q');
    write(DRAFT, demoLesson());
    write(PUBLISHED, { ...demoLesson({ reordered: true }), title: 'Old published' });
    write(REPORT, round1({ lessonHash: reviewScope.lessonHash(demoLesson()) }));
    git('add', '-A');
    git('commit', '-q', '-m', 'round 1');
    const rev = git('rev-parse', '--short', 'HEAD');
    fs.rmSync(path.join(root, DRAFT));
    write(PUBLISHED, demoLesson({ fixed: true }));
    const r = round2({
      file: PUBLISHED,
      lessonHash: reviewScope.lessonHash(demoLesson({ fixed: true })),
      verifies: { reviewedRevision: rev, previousReview: `${rev}:${REPORT}`, changed: ['b2'], changedShare: 0.1, fullReviewRequired: false },
    });
    const run = gateIn(root, [write(REPORT, r)]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, new RegExp(`scope recomputed from ${rev}:content/courses/demo-course/drafts/demo\\.lesson\\.json`));
  }));
});

describe('F4: every review records lessonHash; stale reviews fail the gate', () => {
  it('review-scope.mjs --hash prints the canonical content hash', () => withRoot((root, write) => {
    const file = write('demo.lesson.json', demoLesson());
    const run = spawnSync(process.execPath, [path.join(SCRIPTS, 'review-scope.mjs'), file, '--hash'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout.trim(), /^sha256:[0-9a-f]{16}$/);
    assert.equal(run.stdout.trim(), reviewScope.lessonHash(demoLesson()));
    // Key order, formatting and provenance do not change it; content does.
    const reordered = Object.fromEntries(Object.entries(demoLesson()).reverse());
    assert.equal(reviewScope.lessonHash({ ...reordered, provenance: { author: 'someone-else' } }), reviewScope.lessonHash(demoLesson()));
    assert.notEqual(reviewScope.lessonHash(demoLesson({ fixed: true })), reviewScope.lessonHash(demoLesson()));
  }));

  it('lessonHash is part of review.v1 and has a fixed form', () => {
    assert.equal(schemas.review.properties.lessonHash.pattern, '^sha256:[0-9a-f]{16}$');
    assert.deepEqual(checkReview.checkSchema(review('ja-editor', () => 4, { lessonHash: reviewScope.lessonHash(demoLesson()) }), schemas.review), []);
    assert.ok(checkReview.checkSchema(review('ja-editor', () => 4, { lessonHash: 'abc' }), schemas.review).some((e) => /lessonHash: "abc" does not match/.test(e)));
  });

  it('a review of another version is stale; one without lessonHash is stale unless --allow-legacy', () => {
    const hash = reviewScope.lessonHash(demoLesson({ fixed: true }));
    const lesson = { id: 'demo', hash };
    const fresh = review('ja-editor', (id) => (id === 'voice' ? 4 : undefined), { lessonHash: hash });
    const old = review('pedagogy-reviewer', () => 4, { lessonHash: reviewScope.lessonHash(demoLesson()) });
    const staleRun = checkReview.evaluateReviews([fresh, old], schemas, { lesson });
    assert.equal(staleRun.valid, false);
    assert.ok(staleRun.errors.some((e) => /^stale: review 2 \(pedagogy-reviewer\) read sha256:[0-9a-f]{16}, but the lesson is now sha256:/.test(e)), staleRun.errors.join('\n'));
    assert.deepEqual(staleRun.stale, ['pedagogy-reviewer']);

    const legacy = review('pedagogy-reviewer', () => 4);
    const refused = checkReview.evaluateReviews([legacy], schemas, { lesson });
    assert.equal(refused.valid, false);
    assert.ok(refused.errors.some((e) => /^stale: .* has no "lessonHash"/.test(e)), refused.errors.join('\n'));
    const accepted = checkReview.evaluateReviews([legacy], schemas, { lesson, allowLegacy: true });
    assert.equal(accepted.valid, true);
    assert.ok(accepted.warnings.some((w) => /^LEGACY REVIEW: .*--allow-legacy/.test(w)));
    assert.equal(checkReview.evaluateReviews([fresh], schemas, {}).valid, false, 'no current lesson, no verdict');
  });

  it('CLI: the lesson the reviews name is hashed; a stale review exits 2, --allow-legacy only for reviews without lessonHash', () => withRoot((root, write) => {
    write(PUBLISHED, demoLesson({ fixed: true }));
    const hash = reviewScope.lessonHash(demoLesson({ fixed: true }));
    // The reviews name the draft; it was published since and is found under lessons/.
    const fresh = write('fresh.json', review('pedagogy-reviewer', () => 4, { lessonHash: hash }));
    const ok = gateIn(root, [fresh]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, new RegExp(`lesson ${PUBLISHED} \\(${hash}\\)`));

    const stale = write('stale.json', review('pedagogy-reviewer', () => 4, { lessonHash: reviewScope.lessonHash(demoLesson()) }));
    const staleRun = gateIn(root, [stale]);
    assert.equal(staleRun.status, 2);
    assert.match(staleRun.stderr, /stale: review 1 \(pedagogy-reviewer\) read sha256:/);
    assert.equal(gateIn(root, [stale, '--allow-legacy']).status, 2, '--allow-legacy does not excuse a hash mismatch');

    const legacy = write('legacy.json', review('pedagogy-reviewer', () => 4));
    assert.equal(gateIn(root, [legacy]).status, 2);
    const legacyRun = gateIn(root, [legacy, '--allow-legacy']);
    assert.equal(legacyRun.status, 0, legacyRun.stderr);
    assert.match(legacyRun.stderr, /LEGACY REVIEW/);

    const elsewhere = write('other/demo.lesson.json', demoLesson());
    assert.equal(gateIn(root, [fresh, '--lesson', elsewhere]).status, 2, '--lesson names the lesson to hash');
  }));
});

describe('F5: check-review recomputes the scope of a verification', () => {
  it('library: refuses a verification the recomputed scope does not allow, whatever the review records', () => {
    const claimed = round2(); // records fullReviewRequired: false, changedShare 0.1
    const result = checkReview.evaluateReviews([claimed], schemas, { ...LEGACY, previous: [round1()], scopes: scopeOf(demoLesson(), demoLesson({ fixed: true, reordered: true })) });
    assert.equal(result.valid, false, 'the old gate trusted the recorded scope');
    assert.ok(result.errors.some((e) => /recomputed scope since abc1234 requires a full review, not a verification \(sections reordered/.test(e)), result.errors.join('\n'));
  });

  it('library: refuses a verification whose "changed" leaves out a change', () => {
    const result = checkReview.evaluateReviews([round2()], schemas, { ...LEGACY, previous: [round1()], scopes: scopeOf(demoLesson(), demoLesson({ fixed: true, b5: 'Also rewritten.' })) });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /verifies\.changed leaves out b5/.test(e)), result.errors.join('\n'));
  });

  it('CLI: recomputes the scope from verifies.reviewedRevision (a snapshot) and exits 2 when a full review is due', () => withRoot((root, write) => {
    const { revision, now, prevFile } = snapshotRound1(root, write, { after: demoLesson({ fixed: true, reordered: true }) });
    const r = round2({ lessonHash: now, verifies: { ...round2().verifies, reviewedRevision: revision, previousReview: prevFile } });
    const run = gateIn(root, [write('r2.json', r)]);
    assert.equal(run.status, 2, run.stdout);
    assert.match(run.stderr, /recomputed scope since sha256:[0-9a-f]{16} requires a full review/);
    // An unknown revision cannot be recomputed: refused too.
    const unknown = round2({ lessonHash: now, verifies: { ...round2().verifies, reviewedRevision: 'sha256:ffffff', previousReview: prevFile } });
    const unknownRun = gateIn(root, [write('r2-unknown.json', unknown)]);
    assert.equal(unknownRun.status, 2);
    assert.match(unknownRun.stderr, /cannot recompute the scope since sha256:ffffff: No snapshot/);
  }));
});

describe('F6: previousReview never names the review being checked', () => {
  it('CLI with stdin: the working-tree reports file of the same lesson and reviewer is refused', () => withRoot((root, write) => {
    const lesson = write(DRAFT, demoLesson({ fixed: true }));
    // This round was saved to reports/ and piped in; previousReview names that same file.
    const r = round2({ verifies: { ...round2().verifies, previousReview: REPORT } });
    write(REPORT, r);
    const run = gateCli(['-', '--lesson', lesson], { cwd: root, input: JSON.stringify(r) });
    assert.equal(run.status, 2, `the old gate loaded the review as its own previous round: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /is the working-tree reports file of demo by pedagogy-reviewer, which each round overwrites/);
  }));

  it('previousSpecProblem: refuses a file being checked and the own reports file, allows <commit>:<path> and snapshot copies', () => withRoot((root, write) => {
    const context = { lessonId: 'demo', reviewer: 'pedagogy-reviewer', cwd: root, root };
    assert.match(checkReview.previousSpecProblem(REPORT, context), /working-tree reports file of demo by pedagogy-reviewer/);
    assert.match(checkReview.previousSpecProblem(`./${REPORT}`, context), /working-tree reports file/);
    assert.equal(checkReview.previousSpecProblem(`abc1234:${REPORT}`, context), null);
    assert.equal(checkReview.previousSpecProblem('.artifacts/review/demo-course/demo/0123456789abcdef/round-1/pedagogy-reviewer.review.json', context), null);
    assert.equal(checkReview.previousSpecProblem('content/courses/demo-course/reports/demo.ja-editor.review.json', context), null);
    const checked = write('r2.json', '{}');
    assert.match(checkReview.previousSpecProblem('r2.json', { ...context, inputFiles: new Set([fs.realpathSync(checked)]) }), /is the file being checked/);
  }));
});

describe('F8: --since sha256:<hex> finds a snapshot by unique prefix or full hash', () => {
  it('accepts a 6+ digit prefix and the full 64-digit hash, and refuses an ambiguous prefix', () => withRoot(async (root, write) => {
    const file = write(DRAFT, demoLesson());
    const saved = reviewScope.saveSnapshot(file, { root });
    const current = demoLesson({ fixed: true });
    write(DRAFT, current);
    const short = `sha256:${saved.revision.slice(7, 15)}`;
    const byPrefix = reviewScope.readBefore({ since: short }, file, current, { root });
    assert.equal(byPrefix.revision, saved.revision, 'the prefix resolves to the snapshot revision');
    const { canonicalJson } = await import('../../shared/lesson/canonical.js');
    const { provenance: _p, ...content } = demoLesson();
    const full = `sha256:${crypto.createHash('sha256').update(canonicalJson(content)).digest('hex')}`;
    assert.equal(reviewScope.readBefore({ since: full }, file, current, { root }).revision, saved.revision);
    // A second snapshot folder sharing the first 6 digits makes that prefix ambiguous.
    fs.mkdirSync(path.join(path.dirname(saved.dir), `${saved.revision.slice(7, 13)}ffffffffff`));
    assert.throws(() => reviewScope.readBefore({ since: saved.revision.slice(0, 13) }, file, current, { root }), /is ambiguous/);
    assert.throws(() => reviewScope.readBefore({ since: 'sha256:abcde' }, file, current, { root }), /Not a git revision|6–64 hex/);
  }));
});

describe('F9: snapshots never overwrite a round, and keep only reviews of that revision', () => {
  it('a second round on unchanged text keeps the first round', () => withRoot((root, write) => {
    const file = write(DRAFT, demoLesson());
    // (Without lessonHash, as before the field existed, the reviews were copied unfiltered.)
    const hash = reviewScope.lessonHash ? reviewScope.lessonHash(demoLesson()) : undefined;
    write(REPORT, round1({ lessonHash: hash, summary: 'Round 1.' }));
    const first = reviewScope.saveSnapshot(file, { root });
    write(REPORT, round1({ lessonHash: hash, summary: 'Round 2, same text.' }));
    const second = reviewScope.saveSnapshot(file, { root });
    assert.equal(second.revision, first.revision);
    assert.notEqual(second.reviews[0], first.reviews[0], 'the old script wrote both rounds to one file');
    assert.equal(JSON.parse(fs.readFileSync(first.reviews[0], 'utf8')).summary, 'Round 1.');
    assert.equal(JSON.parse(fs.readFileSync(second.reviews[0], 'utf8')).summary, 'Round 2, same text.');
    assert.deepEqual([first.round, second.round], ['round-1', 'round-2']);
    // A named round is used once; naming it again is refused.
    assert.equal(reviewScope.saveSnapshot(file, { root, round: 'final' }).round, 'final');
    assert.throws(() => reviewScope.saveSnapshot(file, { root, round: 'final' }), /already saved/);
  }));

  it('copies only reviews whose lessonHash is the snapshot revision', () => withRoot((root, write) => {
    const file = write(DRAFT, demoLesson({ fixed: true }));
    write(REPORT, round1({ lessonHash: reviewScope.lessonHash(demoLesson()) }));
    write('content/courses/demo-course/reports/demo.ja-editor.review.json', review('ja-editor', () => 4));
    write('content/courses/demo-course/reports/demo.visual-qa.review.json', review('visual-qa', () => 4, { lessonHash: reviewScope.lessonHash(demoLesson({ fixed: true })) }));
    const saved = reviewScope.saveSnapshot(file, { root });
    assert.deepEqual(saved.reviews.map((f) => path.basename(f)), ['visual-qa.review.json']);
    assert.deepEqual(saved.skipped.map((s) => [path.basename(s.file), s.reason.replace(/sha256:[0-9a-f]+/g, 'H')]), [
      ['demo.ja-editor.review.json', 'it has no lessonHash'],
      ['demo.pedagogy-reviewer.review.json', 'it read H, not H'],
    ]);
  }));

  it('CLI: --snapshot takes --round <label>', () => {
    assert.equal(reviewScope.parseArgs(['demo.lesson.json', '--snapshot', '--round', 'r1']).round, 'r1');
    assert.throws(() => reviewScope.parseArgs(['demo.lesson.json', '--since', 'HEAD', '--round', 'r1']), /--round goes with --snapshot/);
    assert.throws(() => reviewScope.saveSnapshot('demo.lesson.json', { round: '../x' }), /Invalid round label/);
  });
});

describe('F10: shared helpers are reused, not copied', () => {
  const source = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('canonical JSON lives in shared/lesson/canonical.js; hashLesson and the review scripts use it', async () => {
    const { canonicalJson } = await import('../../shared/lesson/canonical.js');
    assert.equal(canonicalJson({ b: [1, { d: 1, c: undefined }], a: 'x' }), '{"a":"x","b":[1,{"d":1}]}');
    assert.equal(reviewScope.canonical, undefined, 'review-scope.mjs no longer has its own canonical()');
    assert.doesNotMatch(source('tools/core/lessons.js'), /function canonicalJson\(/);
    assert.match(source('tools/core/lessons.js'), /import \{ canonicalJson \} from '\.\.\/\.\.\/shared\/lesson\/canonical\.js'/);
    assert.match(source('.claude/skills/review-lesson/scripts/review-scope.mjs'), /import \{ canonicalJson \} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/lesson\/canonical\.js'/);
    const { hashLesson } = await import('../../tools/core/lessons.js');
    const lesson = demoLesson();
    assert.equal(hashLesson(lesson), crypto.createHash('sha256').update(canonicalJson(lesson)).digest('hex').slice(0, 16), 'hashLesson is unchanged');
  });

  it('blockList walks the lesson with forEachBlock', async () => {
    const { forEachBlock } = await import('../../shared/lesson/walk.js');
    const lesson = demoLesson();
    const walked = [];
    forEachBlock(lesson, (block, _p, section) => walked.push({ id: block.id, section: section.id, block }));
    assert.deepEqual(reviewScope.blockList(lesson), walked);
    assert.match(source('.claude/skills/review-lesson/scripts/review-scope.mjs'), /import \{ forEachBlock \} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/lesson\/walk\.js'/);
  });

  it('check-review.mjs runs git through review-scope.mjs', () => {
    const text = source('.claude/skills/review-lesson/scripts/check-review.mjs');
    assert.doesNotMatch(text, /spawnSync/);
    assert.match(text, /import \{[^}]*\bgit\b[^}]*\} from '\.\/review-scope\.mjs'/);
    assert.equal(typeof reviewScope.git, 'function');
  });
});
