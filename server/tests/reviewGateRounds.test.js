/**
 * Review gate, second hardening pass: the bypasses an adversarial test of the fixed gate found
 * (PR #20). Each describe block reproduces one finding by its id and checks that check-review.mjs
 * now refuses it, next to the legitimate case it must keep passing. Every scenario runs the CLI
 * in-process against a scratch git repository. Rules: .claude/skills/review-lesson/SKILL.md.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checkReview from '../../.claude/skills/review-lesson/scripts/check-review.mjs';
import * as reviewScope from '../../.claude/skills/review-lesson/scripts/review-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemas = checkReview.loadSchemas(ROOT);
const CRITERIA = schemas.rubric.criteria.map((c) => c.id);

const COURSE = 'demo-course';
const ID = 'demo';
const DRAFT = `content/courses/${COURSE}/drafts/${ID}.lesson.json`;
const PUBLISHED = `content/courses/${COURSE}/lessons/${ID}.lesson.json`;
const REPORTS = `content/courses/${COURSE}/reports`;
const rep = (reviewer) => `${REPORTS}/${ID}.${reviewer}.review.json`;
const PED = 'pedagogy-reviewer';
const JA_EDITOR = 'ja-editor';
const VISUAL = 'visual-qa';
const ALL4 = Object.fromEntries(CRITERIA.map((c) => [c, 4]));
const JA = { voice: 4, load: 4, a11y_l10n: 4 };
const VQA = { visual: 4, a11y_l10n: 4, load: 4 };

/** Lesson "demo": 3 sections, 12 blocks, 2 objectives; b2 has a voice problem, b3 a practice problem. */
const lesson = ({ fixB2 = false, fixB3 = false, reorder = false, edit = {} } = {}) => {
  const md = (id, text) => ({ id, type: 'markdown', md: edit[id] ?? text ?? `Text of ${id}です。` });
  const quiz = (id, objectiveId) => ({
    id,
    type: 'quiz',
    questions: [{
      id: `${id}-q1`,
      objectiveId,
      prompt: `Question for ${id}?`,
      options: [{ id: 'a', md: 'Right', feedback: 'Yes.' }, { id: 'b', md: 'Wrong', feedback: 'No, because X.' }],
      answer: ['a'],
    }],
  });
  const sections = [
    { id: 's1', title: 'Hook', role: 'hook', blocks: [md('h1'), quiz('h-predict', 'o1')] },
    {
      id: 's2',
      title: 'Concept',
      role: 'concept',
      blocks: [
        md('b1'),
        md('b2', fixB2 ? 'これは例です。' : 'これは例だ。'),
        md('b3', fixB3 ? 'Practice with an expected result.' : 'Practice without expected result.'),
        md('b4'),
        md('b5'),
        quiz('b6', 'o1'),
      ],
    },
    { id: 's3', title: 'Check', role: 'check', blocks: [md('c1'), quiz('c2', 'o1'), quiz('c3', 'o2'), { id: 'c4', type: 'summary', points: ['P1', 'P2', 'P3'] }] },
  ];
  return {
    schema: 'risepath.lesson/v1',
    id: ID,
    courseId: COURSE,
    title: 'Demo',
    locale: 'jp',
    estMinutes: 10,
    objectives: [{ id: 'o1', text: 'Xを説明できる', bloom: 'understand' }, { id: 'o2', text: 'Yを使える', bloom: 'apply' }],
    sections: reorder ? [sections[0], sections[2], sections[1]] : sections,
    provenance: { author: 'claude-code', generatedAt: '2026-10-19' },
  };
};

/** A full review.v1 of "demo"; `scores` maps criterion → score. */
const review = (reviewer, scores, extra = {}) => ({
  lessonId: ID,
  file: DRAFT,
  reviewer,
  rubricVersion: 'rubric.v1',
  scores: Object.entries(scores).map(([id, score]) => ({ id, score, evidence: `Evidence for ${id}.` })),
  mustFix: [],
  niceToHave: [],
  verdict: 'pass',
  summary: 'Summary.',
  ...extra,
});

/** A verification of `prev`: every criterion carried over except `rescored`; `omit` leaves criteria out. */
const verifyReview = (prev, { lessonHash, verifies, resolved = [], rescored = {}, omit = [], mustFix = [], extra = {} }) => ({
  lessonId: prev.lessonId,
  file: prev.file,
  lessonHash,
  reviewer: prev.reviewer,
  rubricVersion: 'rubric.v1',
  mode: 'verify',
  verifies,
  resolved,
  scores: prev.scores
    .filter((s) => !omit.includes(s.id))
    .map((s) => (s.id in rescored ? { id: s.id, score: rescored[s.id], evidence: `Re-scored ${s.id}.` } : { ...s, carriedOver: true })),
  mustFix,
  niceToHave: [],
  verdict: 'pass',
  summary: 'Verification.',
  ...extra,
});

const voiceB2 = { criterion: 'voice', blockId: 'b2', issue: 'Plain form 「だ。」', fix: '「だ。」→「です。」' };
const resolvedB2 = (extra = {}) => [{ blockId: 'b2', criterion: 'voice', status: 'resolved', evidence: 'b2 reads 「これは例です。」', ...extra }];
/** Round 1 of a reviewer: voice 2 and a must-fix on b2. */
const round1Of = (reviewer, scores, hash) => review(reviewer, { ...scores, voice: 2 }, { ...(hash ? { lessonHash: hash } : {}), verdict: 'revise', mustFix: [voiceB2] });

/** A scratch git repository with the lesson and review helpers; removed afterwards. */
const withRepo = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-rounds-'));
  const git = (...args) => {
    const res = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim();
  };
  const write = (rel, value) => {
    const file = path.isAbsolute(rel) ? rel : path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', '--short', 'HEAD');
  };
  /** check-review.mjs, in-process, against this repository. */
  const gate = (args, stdin) => {
    const out = [];
    const err = [];
    const status = checkReview.runCli(args, { root, cwd: root, readStdin: () => stdin, log: (l) => out.push(l), error: (l) => err.push(l) });
    return { status, stdout: out.join('\n'), stderr: err.join('\n'), all: [...out, ...err].join('\n') };
  };
  /** The verifies line review-scope.mjs prints for the lesson at `rel`, plus previousReview. */
  const verifiesSince = (since, expectHash, previousReview, rel = DRAFT) => {
    const file = path.join(root, rel);
    const now = JSON.parse(fs.readFileSync(file, 'utf8'));
    const prior = reviewScope.readBefore({ since }, file, now, { root, expectHash });
    const scope = reviewScope.compareLessons(JSON.parse(prior.text), now);
    return { reviewedRevision: prior.revision, previousReview, changed: scope.changed, changedShare: scope.changedShare, fullReviewRequired: scope.fullReviewRequired };
  };
  /** Round 1 on the unfixed draft (or `v1`), saved to reports/ and committed. */
  const round1Committed = ({ reviewers = { [PED]: ALL4 }, legacy = false, v1 = lesson(), make } = {}) => {
    write(DRAFT, v1);
    const h1 = reviewScope.lessonHash(v1);
    const r1 = {};
    for (const [name, scores] of Object.entries(reviewers)) {
      r1[name] = make?.(name, legacy ? null : h1) ?? round1Of(name, scores, legacy ? null : h1);
      write(rep(name), r1[name]);
    }
    return { c1: commit('round 1'), h1, r1 };
  };
  git('init', '-q');
  try {
    return fn({ root, git, write, commit, gate, verifiesSince, round1Committed });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

describe('CHAIN-1: a refused round cannot be verified one round later (F2 undone)', () => {
  it('round 3 that verifies a committed round 2 which left voice out is refused', () => withRepo(({ write, commit, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed({ reviewers: { [PED]: ALL4, [JA_EDITOR]: JA } });
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    const h2 = reviewScope.lessonHash(v2);
    const r2ped = verifyReview(r1[PED], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`), omit: ['voice'], resolved: resolvedB2() });
    const r2ja = verifyReview(r1[JA_EDITOR], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(JA_EDITOR)}`), rescored: { voice: 4 }, resolved: resolvedB2() });
    write(rep(PED), r2ped);
    write(rep(JA_EDITOR), r2ja);
    assert.equal(gate([rep(PED), rep(JA_EDITOR)]).status, 2, 'round 2 itself is refused (F2)');
    const c2 = commit('record round 2 anyway');
    write(rep(PED), verifyReview(r2ped, { lessonHash: h2, verifies: verifiesSince(c2, h2, `${c2}:${rep(PED)}`) }));
    const run = gate([rep(PED), rep(JA_EDITOR)]);
    assert.equal(run.status, 2, `the old gate passed with voice = 4 from ja-editor only:\n${run.all}`);
    assert.match(run.stderr, /its previous review [0-9a-f]+:\S+pedagogy-reviewer\.review\.json is not a valid round.*the previous review scored voice, which this verification leaves out/);
  }));

  it('a valid chain passes, and its earlier rounds are checked', () => withRepo(({ write, commit, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed();
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    const h2 = reviewScope.lessonHash(v2);
    const r2 = verifyReview(r1[PED], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`), rescored: { voice: 3 }, resolved: resolvedB2() });
    write(rep(PED), r2);
    assert.equal(gate([rep(PED)]).status, 0);
    const c2 = commit('round 2');
    const v3 = lesson({ fixB2: true, edit: { b5: 'b5 を言い換えました。' } });
    write(DRAFT, v3);
    write(rep(PED), verifyReview(r2, { lessonHash: reviewScope.lessonHash(v3), verifies: verifiesSince(c2, h2, `${c2}:${rep(PED)}`) }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 0, run.all);
    assert.match(run.stdout, /previous [0-9a-f]+:\S+ and 1 earlier round checked/);
  }));
});

describe('CHAIN-2: a must-fix left unverified stays open in the next round', () => {
  it('round 3 after a round 2 that never verified b3 still has b3 open (exit 1)', () => withRepo(({ write, commit, gate, verifiesSince, round1Committed }) => {
    const make = (name, hash) => review(name, { ...ALL4, voice: 2, practice: 3 }, {
      lessonHash: hash,
      verdict: 'revise',
      mustFix: [voiceB2, { criterion: 'practice', blockId: 'b3', issue: 'Practice has no expected result', fix: 'Add the expected output' }],
    });
    const { c1, h1, r1 } = round1Committed({ make });
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    const h2 = reviewScope.lessonHash(v2);
    const r2 = verifyReview(r1[PED], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`), rescored: { voice: 4 }, resolved: resolvedB2() });
    write(rep(PED), r2);
    const round2 = gate([rep(PED)]);
    assert.equal(round2.status, 1);
    assert.match(round2.stdout, /must fix \(unverified\) \[practice\] b3/);
    const c2 = commit('record round 2');
    write(rep(PED), verifyReview(r2, { lessonHash: h2, verifies: verifiesSince(c2, h2, `${c2}:${rep(PED)}`) }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 1, `the old gate passed: the unverified item vanished\n${run.all}`);
    assert.match(run.stdout, /must fix \(unverified\) \[practice\] b3: Not verified: the previous must-fix "Practice has no expected result"/);
  }));
});

describe('CHAIN-3: a forged carried-over score is not laundered by the next round', () => {
  it('round 3 that verifies a round 2 carrying voice over as 4 (round 1: 2) is refused', () => withRepo(({ write, commit, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed();
    const r2 = verifyReview(r1[PED], { lessonHash: h1, verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`), resolved: resolvedB2() });
    r2.scores = r2.scores.map((s) => (s.id === 'voice' ? { ...s, score: 4 } : s));
    write(rep(PED), r2);
    assert.equal(gate([rep(PED)]).status, 2);
    const c2 = commit('record round 2');
    write(rep(PED), verifyReview(r2, { lessonHash: h1, verifies: verifiesSince(c2, h1, `${c2}:${rep(PED)}`) }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 2, run.all);
    assert.match(run.stderr, /is not a valid round.*"voice" is carried over as 4, but the previous review gave 2/);
  }));
});

describe('LEG-1: a previous review without lessonHash binds reviewedRevision to its commit', () => {
  const setup = ({ write, commit, round1Committed }) => {
    const { c1, r1 } = round1Committed({ legacy: true });
    const v2 = lesson({ fixB2: true, reorder: true });
    write(DRAFT, v2);
    const c2 = commit('fix b2 and reorder the sections');
    write(rep(PED), verifyReview(r1[PED], {
      lessonHash: reviewScope.lessonHash(v2),
      verifies: { reviewedRevision: c2, previousReview: `${c1}:${rep(PED)}`, changed: [], changedShare: 0, fullReviewRequired: false },
      rescored: { voice: 4 },
      resolved: resolvedB2(),
    }));
    return { c1, c2 };
  };

  it('needs --allow-legacy, and even then refuses a reviewedRevision after the commit that holds it', () => withRepo((repo) => {
    const { c1, c2 } = setup(repo);
    const run = repo.gate([rep(PED)]);
    assert.equal(run.status, 2, `the old gate passed with "0 changed":\n${run.all}`);
    assert.match(run.stderr, new RegExp(`its previous review ${c1}:\\S+ has no "lessonHash", so nothing binds verifies\\.reviewedRevision \\(${c2}\\)`));
    const legacy = repo.gate([rep(PED), '--allow-legacy']);
    assert.equal(legacy.status, 2, legacy.all);
    assert.match(legacy.stderr, new RegExp(`verifies\\.reviewedRevision ${c2} is neither ${c1} nor an earlier commit`));
  }));

  it('with --allow-legacy, a verification of the commit that holds the legacy review passes, with a loud note', () => withRepo(({ write, gate, verifiesSince, round1Committed }) => {
    const { c1, r1 } = round1Committed({ legacy: true });
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    write(rep(PED), verifyReview(r1[PED], { lessonHash: reviewScope.lessonHash(v2), verifies: verifiesSince(c1, null, `${c1}:${rep(PED)}`), rescored: { voice: 4 }, resolved: resolvedB2() }));
    assert.equal(gate([rep(PED)]).status, 2);
    const run = gate([rep(PED), '--allow-legacy']);
    assert.equal(run.status, 0, run.all);
    assert.match(run.stderr, /LEGACY PREVIOUS REVIEW: .*has no "lessonHash"; the scope since [0-9a-f]+ is bound only to [0-9a-f]+ or an earlier commit/);
  }));
});

describe('NOCHANGE-1/2: a must-fix is resolved only by a change', () => {
  it('"resolved" with nothing changed keeps the must-fix open (exit 1)', () => withRepo(({ write, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed();
    const verifies = verifiesSince(c1, h1, `${c1}:${rep(PED)}`);
    assert.deepEqual(verifies.changed, []);
    write(rep(PED), verifyReview(r1[PED], { lessonHash: h1, verifies, rescored: { voice: 4 }, resolved: resolvedB2() }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 1, `the old gate passed with zero edits:\n${run.all}`);
    assert.match(run.stdout, /must fix \(unchanged\) \[voice\] b2: Marked resolved, but b2 did not change since the review that raised it/);
    assert.doesNotMatch(run.stdout, /^ {2}resolved \[voice\] b2/m);
  }));

  it('"resolved" on b2 when only b5 changed keeps it open; fixedIn names a changed block that holds the fix', () => withRepo(({ write, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed();
    const v2 = lesson({ edit: { b5: 'b5 を言い換えました。' } });
    write(DRAFT, v2);
    const verifies = verifiesSince(c1, h1, `${c1}:${rep(PED)}`);
    const h2 = reviewScope.lessonHash(v2);
    write(rep(PED), verifyReview(r1[PED], { lessonHash: h2, verifies, rescored: { voice: 4 }, resolved: resolvedB2() }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 1, run.all);
    assert.match(run.stdout, /must fix \(unchanged\) \[voice\] b2/);
    // The reviewer says where the fix is: accepted when that block changed, not otherwise.
    write(rep(PED), verifyReview(r1[PED], { lessonHash: h2, verifies, rescored: { voice: 4 }, resolved: resolvedB2({ fixedIn: ['b5'] }) }));
    assert.equal(gate([rep(PED)]).status, 0);
    write(rep(PED), verifyReview(r1[PED], { lessonHash: h2, verifies, rescored: { voice: 4 }, resolved: resolvedB2({ fixedIn: ['b4'] }) }));
    const elsewhere = gate([rep(PED)]);
    assert.equal(elsewhere.status, 1);
    assert.match(elsewhere.stdout, /must fix \(unchanged\) \[voice\] b2: Marked resolved, but b2, b4 did not change/);
  }));

  it('a must-fix on a question or card is resolved when that item changed (review-scope touched ids)', () => {
    const before = lesson();
    const after = lesson({ edit: {} });
    after.sections[2].blocks[1].questions[0].prompt = 'Rewritten?';
    const scope = reviewScope.compareLessons(before, after);
    assert.deepEqual(scope.changed, ['c2']);
    for (const id of ['c2', 'c2-q1', 's3', 'o1', 'lesson']) assert.ok(scope.touched.includes(id), id);
    for (const id of ['c3', 'c3-q1', 'o2', 'b2']) assert.ok(!scope.touched.includes(id), id);
  });
});

describe('DROP-1: every reviewer of the verified round is gated together', () => {
  const ja2 = (name, hash) => (name === JA_EDITOR ? round1Of(name, JA, hash) : review(name, name === PED ? ALL4 : VQA, { lessonHash: hash }));

  it('leaving out ja-editor (open must-fix in round 1) is refused', () => withRepo(({ root, write, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed({ reviewers: { [PED]: ALL4, [JA_EDITOR]: JA, [VISUAL]: VQA }, make: ja2 });
    const v2 = lesson({ edit: { b5: 'b5 を言い換えました。' } });
    write(DRAFT, v2);
    const h2 = reviewScope.lessonHash(v2);
    for (const name of [PED, VISUAL]) write(rep(name), verifyReview(r1[name], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(name)}`) }));
    fs.rmSync(path.join(root, rep(JA_EDITOR)));
    const run = gate([rep(PED), rep(VISUAL)]);
    assert.equal(run.status, 2, `the old gate passed with voice 4:\n${run.all}`);
    assert.match(run.stderr, new RegExp(`the round ${c1}:${REPORTS}/ that pedagogy-reviewer's verification goes back to also has a review by ja-editor, which this set leaves out`));
  }));

  it('a round committed without ja-editor does not drop it from the round before', () => withRepo(({ root, write, commit, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed({ reviewers: { [PED]: ALL4, [JA_EDITOR]: JA }, make: ja2 });
    const v2 = lesson({ edit: { b5: 'b5 を言い換えました。' } });
    write(DRAFT, v2);
    const h2 = reviewScope.lessonHash(v2);
    const r2 = verifyReview(r1[PED], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`) });
    write(rep(PED), r2);
    fs.rmSync(path.join(root, rep(JA_EDITOR)));
    const c2 = commit('round 2 without ja-editor');
    write(rep(PED), verifyReview(r2, { lessonHash: h2, verifies: verifiesSince(c2, h2, `${c2}:${rep(PED)}`) }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 2, run.all);
    assert.match(run.stderr, new RegExp(`the round ${c1}:${REPORTS}/ .* also has a review by ja-editor`));
  }));

  it('a reviewer that verifies an older round than the others is refused; a full review is allowed', () => withRepo(({ write, commit, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed({ reviewers: { [PED]: ALL4, [JA_EDITOR]: JA }, make: ja2 });
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    const h2 = reviewScope.lessonHash(v2);
    const r2ped = verifyReview(r1[PED], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`) });
    const r2ja = verifyReview(r1[JA_EDITOR], { lessonHash: h2, verifies: verifiesSince(c1, h1, `${c1}:${rep(JA_EDITOR)}`), rescored: { voice: 2 }, resolved: [{ ...resolvedB2()[0], status: 'unresolved', evidence: 'Still plain.' }] });
    write(rep(PED), r2ped);
    write(rep(JA_EDITOR), r2ja);
    assert.equal(gate([rep(PED), rep(JA_EDITOR)]).status, 1);
    const c2 = commit('round 2');
    const v3 = lesson({ fixB2: true, edit: { b5: 'b5 を言い換えました。' } });
    write(DRAFT, v3);
    const h3 = reviewScope.lessonHash(v3);
    write(rep(PED), verifyReview(r2ped, { lessonHash: h3, verifies: verifiesSince(c2, h2, `${c2}:${rep(PED)}`) }));
    // ja-editor skips its round 2 (an unresolved item) and verifies round 1 again.
    write(rep(JA_EDITOR), verifyReview(r1[JA_EDITOR], { lessonHash: h3, verifies: verifiesSince(c1, h1, `${c1}:${rep(JA_EDITOR)}`), rescored: { voice: 4 }, resolved: resolvedB2() }));
    const skipped = gate([rep(PED), rep(JA_EDITOR)]);
    assert.equal(skipped.status, 2, skipped.all);
    assert.match(skipped.stderr, new RegExp(`ja-editor: its verification does not go back to its review in the round ${c2}:${REPORTS}/`));
    write(rep(JA_EDITOR), review(JA_EDITOR, JA, { lessonHash: h3 }));
    assert.equal(gate([rep(PED), rep(JA_EDITOR)]).status, 0, 'a full review by ja-editor starts its own record afresh');
    // ...but within its scope: a "full" review that drops voice (2 in its rounds) is refused.
    write(rep(JA_EDITOR), review(JA_EDITOR, { load: 4, a11y_l10n: 4 }, { lessonHash: h3 }));
    const dropped = gate([rep(PED), rep(JA_EDITOR)]);
    assert.equal(dropped.status, 2, dropped.all);
    assert.match(dropped.stderr, /ja-editor: its full review leaves out voice, which its review in the round [0-9a-f]+:\S+ scored/);
  }));
});

describe('ARB-1: the previous review is a recorded round, nothing else', () => {
  it('a hand-made file outside reports/ is refused; the snapshot copy is accepted', () => withRepo(({ root, write, gate, verifiesSince }) => {
    const v1 = lesson();
    write(DRAFT, v1);
    const h1 = reviewScope.lessonHash(v1);
    const r1 = round1Of(PED, ALL4, h1);
    write(rep(PED), r1);
    const saved = reviewScope.saveSnapshot(path.join(root, DRAFT), { root });
    const copy = path.relative(root, saved.reviews[0]).split(path.sep).join('/');
    const fake = { ...r1, scores: r1.scores.map((s) => (s.id === 'voice' ? { ...s, score: 4 } : s)), mustFix: [], verdict: 'pass' };
    write('notes/pedagogy-previous.json', fake);
    const v2 = lesson({ edit: { b5: 'b5 を言い換えました。' } });
    write(DRAFT, v2);
    const h2 = reviewScope.lessonHash(v2);
    write(rep(PED), verifyReview(fake, { lessonHash: h2, verifies: verifiesSince(saved.revision, h1, 'notes/pedagogy-previous.json') }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 2, `the old gate passed against the hand-made copy:\n${run.all}`);
    assert.match(run.stderr, /notes\/pedagogy-previous\.json is not a recorded round: a previous review is <commit>:content\/courses\/demo-course\/reports\/demo\.pedagogy-reviewer\.review\.json or the snapshot copy \.artifacts\/review\/demo-course\/demo\/<hash>\/<round>\/pedagogy-reviewer\.review\.json/);
    // Against the real snapshot copy, the open must-fix on b2 shows.
    assert.match(copy, /^\.artifacts\/review\/demo-course\/demo\/[0-9a-f]{16}\/round-1\/pedagogy-reviewer\.review\.json$/);
    write(rep(PED), verifyReview(r1, { lessonHash: h2, verifies: verifiesSince(saved.revision, h1, copy) }));
    const honest = gate([rep(PED)]);
    assert.equal(honest.status, 1, honest.all);
    assert.match(honest.stdout, /must fix \(unverified\) \[voice\] b2/);
  }));

  it('recordedRound accepts only <rev>:<reports file of this reviewer> and the snapshot copy', () => {
    const context = { reviewer: PED, lessonId: ID, reportsDir: REPORTS, snapshotBase: null, cwd: ROOT, root: ROOT };
    assert.ok('loc' in checkReview.recordedRound(`abc1234:${rep(PED)}`, context));
    assert.ok('loc' in checkReview.recordedRound(`HEAD~1:./${rep(PED)}`, context));
    for (const bad of [`abc1234:${rep(JA_EDITOR)}`, 'abc1234:content/courses/demo-course/notes/demo.pedagogy-reviewer.review.json', `-x:${rep(PED)}`, `--output=/tmp/x:${rep(PED)}`, 'a b:c']) {
      assert.match(checkReview.recordedRound(bad, context).error ?? '', /is not a recorded round/, bad);
    }
  });
});

describe('FILE-1/2: the gate hashes the lesson file, not whatever path the reviews name', () => {
  it('reviews whose "file" is a snapshot copy or a path outside the repository are refused', () => withRepo(({ write, gate }) => {
    const v1 = lesson();
    write(DRAFT, v1);
    const h1 = reviewScope.lessonHash(v1);
    const copy = `.artifacts/review/demo-course/demo/${h1.slice(7)}/lesson.json`;
    write(copy, v1);
    write(rep(PED), review(PED, ALL4, { lessonHash: h1, file: copy }));
    write(DRAFT, lesson({ reorder: true, edit: { b1: 'x', b4: 'y', b5: 'z' } }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 2, `the old gate hashed the copy and passed:\n${run.all}`);
    assert.match(run.stderr, /"file" "\.artifacts\/review\/demo-course\/demo\/[0-9a-f]{16}\/lesson\.json" is not content\/courses\/<course>\/drafts\/demo\.lesson\.json or lessons\/demo\.lesson\.json/);
    const outside = path.join(os.tmpdir(), 'demo.lesson.json');
    write(rep(PED), review(PED, ALL4, { lessonHash: h1, file: outside }));
    assert.equal(gate([rep(PED)]).status, 2);
    // Also refused when --lesson names the file: "file" is part of the review record.
    assert.ok(checkReview.reviewErrors(review(PED, ALL4, { file: copy }), schemas).some((e) => /is not the lesson's file/.test(e)));
  }));
});

describe('MOVE-1: drafts/ and lessons/ both exist and differ', () => {
  it('the gate asks for --lesson instead of taking the path the reviews name', () => withRepo(({ write, gate }) => {
    const v1 = lesson({ fixB2: true });
    write(DRAFT, v1);
    write(rep(PED), review(PED, ALL4, { lessonHash: reviewScope.lessonHash(v1) }));
    write(PUBLISHED, lesson({ fixB2: true, reorder: true }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 2, run.all);
    assert.match(run.stderr, /Both content\/courses\/demo-course\/drafts\/demo\.lesson\.json and content\/courses\/demo-course\/lessons\/demo\.lesson\.json exist and differ .*pass --lesson <file>/);
    assert.equal(gate([rep(PED), '--lesson', DRAFT]).status, 0, 'the reviews are for the draft');
    assert.equal(gate([rep(PED), '--lesson', PUBLISHED]).status, 2, 'they are stale for the published version');
    write(PUBLISHED, v1);
    assert.equal(gate([rep(PED)]).status, 0, 'identical copies are not ambiguous');
  }));
});

describe('K2-1/2: at most one previous review per reviewer, and --previous only stands in for legacy reviews', () => {
  it('two --previous for one reviewer, a history file, or --previous next to a recorded previousReview are refused', () => withRepo(({ write, commit, gate, round1Committed }) => {
    const { c1, r1 } = round1Committed();
    const v2 = lesson({ fixB2: true, reorder: true });
    write(DRAFT, v2);
    const c2 = commit('fix b2 and reorder the sections');
    const r2 = verifyReview(r1[PED], {
      lessonHash: reviewScope.lessonHash(v2),
      verifies: { reviewedRevision: c2, previousReview: `${c1}:${rep(PED)}`, changed: [], changedShare: 0, fullReviewRequired: false },
      rescored: { voice: 4 },
      resolved: resolvedB2(),
    });
    write(rep(PED), r2);
    write('prev/copy.json', r2);
    write('prev/history.json', [r2, r1[PED]]);
    assert.equal(gate([rep(PED)]).status, 2, 'alone: the recomputed scope since round 1 requires a full review');
    const copy = gate([rep(PED), '--previous', 'prev/copy.json', '--previous', `${c1}:${rep(PED)}`]);
    assert.equal(copy.status, 2, `the old gate took the scope from the first and the checks from the last:\n${copy.all}`);
    assert.match(copy.stderr, /--previous prev\/copy\.json is not a recorded round/);
    assert.equal(gate([rep(PED), '--previous', 'prev/history.json']).status, 2);
    const twice = gate([rep(PED), '--previous', `${c1}:${rep(PED)}`, '--previous', `${c2}:${rep(PED)}`]);
    assert.equal(twice.status, 2);
    assert.match(twice.stderr, /are both previous reviews by pedagogy-reviewer/);
    const named = gate([rep(PED), '--previous', `${c1}:${rep(PED)}`]);
    assert.equal(named.status, 2);
    assert.match(named.stderr, /its review names its previous round already/);
  }));
});

describe('DUP-1: one review per reviewer', () => {
  it('a second verification by the same reviewer, or a kept old copy, is refused', () => withRepo(({ write, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed();
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    const good = verifyReview(r1[PED], { lessonHash: reviewScope.lessonHash(v2), verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`), rescored: { voice: 4 }, resolved: resolvedB2() });
    write(rep(PED), good);
    write('round2/bad.json', { ...good, verifies: { ...good.verifies, reviewedRevision: 'no-such-revision', previousReview: 'prev/nowhere.json' }, summary: 'second copy' });
    assert.equal(gate([rep(PED)]).status, 0);
    const run = gate(['round2/bad.json', rep(PED)]);
    assert.equal(run.status, 2, `the old gate checked only the last one:\n${run.all}`);
    assert.match(run.stderr, /review 2 \(pedagogy-reviewer\): review 1 is by pedagogy-reviewer too; check one review per reviewer/);
    write(`${REPORTS}/demo.pedagogy-reviewer.old.review.json`, r1[PED]);
    assert.equal(gate([`${REPORTS}/demo.pedagogy-reviewer.old.review.json`, rep(PED)]).status, 2);
  }));
});

describe('INJ-1: references from a review never reach git as options', () => {
  it('previousReview "--output=<path>:x" is refused before git runs; no file is written', () => withRepo(({ root, write, gate, verifiesSince, round1Committed }) => {
    const { c1, h1, r1 } = round1Committed();
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    const target = path.join(root, 'WRITTEN-BY-GIT');
    const verifies = verifiesSince(c1, h1, `--output=${target}:x`);
    write(rep(PED), verifyReview(r1[PED], { lessonHash: reviewScope.lessonHash(v2), verifies, rescored: { voice: 4 }, resolved: resolvedB2() }));
    const run = gate([rep(PED)]);
    assert.equal(run.status, 2, run.all);
    assert.equal(fs.existsSync(`${target}:x`), false, 'git show wrote the file');
    assert.match(run.stderr, /--output=\S+ is not a recorded round/);
    // reviewedRevision is checked the same way before review-scope.mjs runs git.
    const now = JSON.parse(fs.readFileSync(path.join(root, DRAFT), 'utf8'));
    assert.throws(() => reviewScope.readBefore({ since: `--output=${target}` }, path.join(root, DRAFT), now, { root }), /Not a git revision/);
    assert.equal(fs.existsSync(target), false);
    assert.equal(reviewScope.resolveCommit('--all'), null);
  }));
});

describe('EMPTYID-1: lessonId must be the lesson id', () => {
  it('lessonId "" is refused, and so is a previous review of another lesson', () => withRepo(({ write, commit, gate, round1Committed }) => {
    const { c1 } = round1Committed({ legacy: true });
    const otherFile = `${REPORTS}/some-other-lesson.pedagogy-reviewer.review.json`;
    const other = review(PED, ALL4, { lessonId: 'some-other-lesson', file: 'content/courses/demo-course/drafts/some-other-lesson.lesson.json' });
    write(otherFile, other);
    const c2 = commit('other lesson review');
    const v2 = lesson({ fixB2: true });
    write(DRAFT, v2);
    const r = verifyReview(other, {
      lessonHash: reviewScope.lessonHash(v2),
      verifies: { reviewedRevision: c1, previousReview: `${c2}:${otherFile}`, changed: ['b2'], changedShare: 0.09, fullReviewRequired: false },
      extra: { lessonId: '', file: DRAFT },
    });
    write(rep(PED), r);
    const run = gate([rep(PED), '--allow-legacy']);
    assert.equal(run.status, 2, `the old gate said "Review of null: PASS":\n${run.all}`);
    assert.match(run.stderr, /lessonId "" is not a lesson id/);
    assert.ok(checkReview.reviewErrors({ ...r, lessonId: '' }, schemas).some((e) => /lessonId "" is not a lesson id/.test(e)));
    // With the right lessonId, the reference names another lesson's file: not this reviewer's round.
    write(rep(PED), { ...r, lessonId: ID });
    const named = gate([rep(PED), '--allow-legacy']);
    assert.equal(named.status, 2, named.all);
    assert.match(named.stderr, /is not a recorded round/);
  }));
});

describe('DUPCRIT-1: a previous review is validated like the reviews being checked', () => {
  it('a previous review that scores voice twice (2, then 4) cannot be verified', () => withRepo(({ write, gate, verifiesSince, round1Committed }) => {
    const make = (name, hash) => {
      const prev = review(name, { ...ALL4, voice: 2 }, { lessonHash: hash, verdict: 'revise' });
      prev.scores.push({ id: 'voice', score: 4, evidence: 'Second entry.' });
      return prev;
    };
    const { c1, h1, r1 } = round1Committed({ make });
    const v2 = lesson({ edit: { b5: 'b5 を言い換えました。' } });
    write(DRAFT, v2);
    const r2 = verifyReview(r1[PED], { lessonHash: reviewScope.lessonHash(v2), verifies: verifiesSince(c1, h1, `${c1}:${rep(PED)}`) });
    r2.scores = r2.scores.filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i).map((s) => (s.id === 'voice' ? { ...s, score: 4 } : s));
    write(rep(PED), r2);
    const run = gate([rep(PED)]);
    assert.equal(run.status, 2, `the old gate kept the last duplicate (4):\n${run.all}`);
    assert.match(run.stderr, /its previous review [0-9a-f]+:\S+ is not a valid round.*criterion "voice" is scored twice/);
  }));
});

describe('SCHEMA-1: unknown fields named like Object.prototype members', () => {
  it('"constructor", "toString", "hasOwnProperty" and "__proto__" are unknown fields', () => {
    const r = review(PED, ALL4, { lessonHash: 'sha256:0123456789abcdef' });
    const doc = JSON.parse(JSON.stringify({ ...r, constructor: 'x', toString: 'y' }).replace('"lessonId"', '"__proto__":{"a":1},"lessonId"'));
    doc.scores[0].hasOwnProperty = 'z';
    const errors = checkReview.checkSchema(doc, schemas.review);
    for (const at of ['$.constructor', '$.toString', '$.__proto__', '$.scores[0].hasOwnProperty']) {
      assert.ok(errors.includes(`${at}: unknown field`), `${at}: ${errors.join('; ')}`);
    }
    const { lessonId: _id, ...noId } = r;
    assert.ok(checkReview.checkSchema(noId, schemas.review).includes('$.lessonId: required'));
    assert.ok(checkReview.checkSchema(Object.create({ lessonId: 'inherited' }), { type: 'object', required: ['lessonId'] }).includes('$.lessonId: required'), 'inherited keys do not count');
  });
});

describe('the PR #20 reviews (legacy, before lessonHash) still pass with the documented flags', () => {
  const P = 'content/courses/vibe-coding/reports';
  // The reviews as committed in c961471. Later rounds overwrite the working-tree reports files, so
  // the reviews are read from git into a scratch folder.
  const AT = 'c961471';
  const hasHistory = ['dcb3095', 'bb56d49', AT].every((rev) => reviewScope.resolveCommit(rev, ROOT) !== null);
  const run = (...args) => {
    const out = [];
    const err = [];
    const status = checkReview.runCli(args, { root: ROOT, cwd: ROOT, log: (l) => out.push(l), error: (l) => err.push(l) });
    return { status, all: [...out, ...err].join('\n') };
  };
  /** @param {string[]} names @param {(files: string[]) => void} fn */
  const withRecorded = (names, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr20-reviews-'));
    try {
      fn(names.map((name) => {
        const show = reviewScope.git(['show', `${AT}:${P}/${name}`], ROOT);
        assert.ok(show.ok, show.stderr);
        const file = path.join(dir, name);
        fs.writeFileSync(file, show.stdout);
        return file;
      }));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('vibe-ch2: its chain (bb56d49 → dcb3095) is followed and checked', { skip: !hasHistory && 'needs the PR #20 history (shallow clone)' }, () => {
    withRecorded(['ja-editor', 'pedagogy-reviewer', 'visual-qa'].map((r) => `vibe-ch2.${r}.review.json`), (reports) => {
      assert.equal(run(...reports).status, 2, 'without --allow-legacy');
      const ok = run(...reports, '--allow-legacy', '--previous', `dcb3095:${P}/vibe-ch2.visual-qa.review.json`);
      assert.equal(ok.status, 0, ok.all);
      assert.match(ok.all, /pedagogy-reviewer: verification of dcb3095 .* and 1 earlier round checked/);
    });
  });

  it('vibe-ch2-practice', { skip: !hasHistory && 'needs the PR #20 history (shallow clone)' }, () => {
    const names = ['pedagogy-reviewer', 'ja-editor', 'visual-qa'];
    withRecorded(names.map((r) => `vibe-ch2-practice.${r}.review.json`), (reports) => {
      const ok = run(...reports, '--allow-legacy', ...names.flatMap((r) => ['--previous', `dcb3095:${P}/vibe-ch2-practice.${r}.review.json`]));
      assert.equal(ok.status, 0, ok.all);
    });
  });
});
