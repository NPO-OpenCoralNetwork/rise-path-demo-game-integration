/**
 * Review rounds: the fix-verification mode of review.v1 (check-review.mjs) and the scope check
 * that decides whether a re-review may be a verification or must be a full review
 * (review-scope.mjs). Rules: .claude/skills/review-lesson/SKILL.md.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReviews, loadSchemas, modeErrors, openItems } from '../../.claude/skills/review-lesson/scripts/check-review.mjs';
import {
  FULL_REVIEW_SHARE,
  canonical,
  changedParts,
  compareLessons,
  parseArgs as parseScopeArgs,
  readBefore,
  saveSnapshot,
} from '../../.claude/skills/review-lesson/scripts/review-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, '.claude', 'skills', 'review-lesson', 'scripts');
const schemas = loadSchemas(ROOT);
const ids = schemas.rubric.criteria.map((c) => c.id);

/** A review.v1 document; `scoreOf` returns undefined for criteria outside the reviewer's scope. */
const review = (reviewer, scoreOf, extra = {}) => ({
  lessonId: 'vibe-ch2',
  file: 'content/courses/vibe-coding/drafts/vibe-ch2.lesson.json',
  reviewer,
  rubricVersion: 'rubric.v1',
  scores: ids.filter((id) => scoreOf(id) !== undefined).map((id) => ({ id, score: scoreOf(id), evidence: `Block x shows ${id}.` })),
  mustFix: [],
  niceToHave: [],
  verdict: 'pass',
  summary: 'Clear and aligned.',
  ...extra,
});

/** Round 1: a full review with two must-fix items. */
const previous = () => review('pedagogy-reviewer', (id) => (id === 'active' ? 2 : 4), {
  verdict: 'revise',
  mustFix: [
    { criterion: 'active', blockId: 'check-quiz', issue: 'q8 gives its answer away.', fix: 'Make every option act on the empty fields.' },
    { criterion: 'voice', blockId: 'card-goal', issue: 'Two noun-ending sentences.', fix: '「旧」→「新」' },
  ],
});

const RESCORED = new Set(['active', 'voice']);

/** Round 2: a verification of round 1 where both items are resolved; `active` and `voice` re-scored. */
const verification = (extra = {}) => ({
  ...review('pedagogy-reviewer', () => 4),
  scores: ids.map((id) => ({
    id,
    score: id === 'active' ? 3 : 4,
    evidence: RESCORED.has(id) ? `Re-scored: ${id}.` : `Block x shows ${id}.`,
    ...(RESCORED.has(id) ? {} : { carriedOver: true }),
  })),
  mode: 'verify',
  verifies: {
    reviewedRevision: '5d2a414',
    previousReview: '5d2a414:content/courses/vibe-coding/reports/vibe-ch2.pedagogy-reviewer.review.json',
    changed: ['check-quiz', 'summary-cards'],
    changedShare: 0.07,
    fullReviewRequired: false,
  },
  resolved: [
    { blockId: 'check-quiz', criterion: 'active', status: 'resolved', evidence: 'q8 options now all act on the empty fields.' },
    { blockId: 'card-goal', criterion: 'voice', status: 'resolved', evidence: 'The back now reads 「…の形で書きます。」.' },
  ],
  ...extra,
});

describe('check-review.mjs: verification rounds (mode "verify")', () => {
  it('passes when every previous must-fix is resolved and the scores pass', () => {
    const result = evaluateReviews([verification()], schemas, { previous: [previous()] });
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.equal(result.verdict, 'pass');
    assert.deepEqual(result.mustFix, []);
    assert.deepEqual(result.warnings, []);
    const round = result.rounds[0];
    assert.equal(round.mode, 'verify');
    assert.equal(round.previousChecked, true);
    assert.equal(round.resolved, 2);
    assert.equal(round.unresolved, 0);
    assert.deepEqual(round.carriedOver, ids.filter((id) => !RESCORED.has(id)));
    assert.deepEqual(result.scores.find((s) => s.id === 'hook').carriedBy, ['pedagogy-reviewer']);
    assert.deepEqual(result.scores.find((s) => s.id === 'active').carriedBy, []);
    assert.equal(result.resolved.length, 2);
  });

  it('still passes without the previous review, but says nothing cross-checked it', () => {
    const result = evaluateReviews([verification()], schemas);
    assert.equal(result.verdict, 'pass');
    assert.equal(result.rounds[0].previousChecked, false);
    assert.ok(result.warnings.some((w) => /previous review .* was not loaded/.test(w)));
  });

  it('counts an unresolved item as an open must-fix (revise), with the previous fix text', () => {
    const r = verification();
    r.resolved[1] = { blockId: 'card-goal', criterion: 'voice', status: 'unresolved', evidence: 'The back still ends in 「手段。」.' };
    const result = evaluateReviews([r], schemas, { previous: [previous()] });
    assert.equal(result.verdict, 'revise');
    assert.equal(result.mustFix.length, 1);
    assert.equal(result.mustFix[0].status, 'unresolved');
    assert.equal(result.mustFix[0].blockId, 'card-goal');
    assert.equal(result.mustFix[0].fix, '「旧」→「新」');
    assert.match(result.mustFix[0].issue, /手段。/);
    // Without the previous review the item is still open.
    assert.equal(evaluateReviews([r], schemas).verdict, 'revise');
    // Restating it in mustFix with a new fix does not count it twice.
    const restated = { ...r, mustFix: [{ criterion: 'voice', blockId: 'card-goal', issue: 'Still noun-ending.', fix: '「旧」→「新2」' }] };
    assert.equal(evaluateReviews([restated], schemas).mustFix.length, 1);
  });

  it('fails on a new must-fix in a changed block, and flags one on an unchanged block', () => {
    const inChanged = verification({ mustFix: [{ criterion: 'miscon', blockId: 'check-quiz', issue: 'New option c is also correct.', fix: 'Reword c.' }] });
    const result = evaluateReviews([inChanged], schemas, { previous: [previous()] });
    assert.equal(result.verdict, 'revise');
    assert.equal(result.mustFix.length, 1);
    assert.deepEqual(result.warnings, []);
    const outside = verification({ mustFix: [{ criterion: 'load', blockId: 'hook-b1', issue: 'Long paragraph.', fix: 'Split it.' }] });
    const flagged = evaluateReviews([outside], schemas, { previous: [previous()] });
    assert.equal(flagged.verdict, 'revise');
    assert.ok(flagged.warnings.some((w) => /hook-b1, which did not change/.test(w)));
  });

  it('counts a previous must-fix that "resolved" leaves out as open (unverified)', () => {
    const r = verification();
    r.resolved = [r.resolved[0], { blockId: 'card-back', criterion: 'voice', status: 'resolved', evidence: 'Wrong block id.' }];
    const result = evaluateReviews([r], schemas, { previous: [previous()] });
    assert.equal(result.verdict, 'revise');
    assert.equal(result.mustFix.length, 1);
    assert.equal(result.mustFix[0].status, 'unverified');
    assert.equal(result.mustFix[0].blockId, 'card-goal');
    assert.ok(result.warnings.some((w) => w.includes('"resolved" lists [voice] card-back, which was not an open must-fix')));
  });

  it('verifies the open items of a previous verification round too', () => {
    const round2 = verification();
    round2.resolved[1] = { blockId: 'card-goal', criterion: 'voice', status: 'unresolved', evidence: 'Still noun-ending.' };
    assert.deepEqual(openItems(round2).map((m) => m.blockId), ['card-goal']);
    const round3 = verification({ resolved: [] });
    const result = evaluateReviews([round3], schemas, { previous: [{ ...round2, verdict: 'revise' }] });
    assert.equal(result.verdict, 'revise');
    assert.deepEqual(result.mustFix.map((m) => [m.blockId, m.status]), [['card-goal', 'unverified']]);
  });

  it('rejects a carried-over score that differs from the previous review', () => {
    const r = verification();
    r.scores.find((s) => s.id === 'active').carriedOver = true; // previous gave 2, this says 3
    const result = evaluateReviews([r], schemas, { previous: [previous()] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /"active" is carried over as 3, but the previous review gave 2/.test(e)));
  });

  it('rejects verification reviews that are incomplete or not allowed', () => {
    const invalid = (r) => evaluateReviews([r], schemas);
    const { verifies: _v, ...noVerifies } = verification();
    assert.ok(invalid(noVerifies).errors.some((e) => /needs "verifies"/.test(e)));
    const { resolved: _r, ...noResolved } = verification();
    assert.ok(invalid(noResolved).errors.some((e) => /needs "resolved"/.test(e)));
    const structural = verification();
    structural.verifies = { ...structural.verifies, fullReviewRequired: true };
    assert.ok(invalid(structural).errors.some((e) => /full review/.test(e)));
    const big = verification();
    big.verifies = { ...big.verifies, changedShare: 0.45 };
    assert.ok(invalid(big).errors.some((e) => /45% of the blocks changed/.test(e)));
    const badStatus = verification();
    badStatus.resolved[0] = { ...badStatus.resolved[0], status: 'partly' };
    assert.ok(invalid(badStatus).errors.some((e) => /resolved\[0\]\.status/.test(e)));
    const noRevision = verification();
    noRevision.verifies = { previousReview: 'x', changed: [], fullReviewRequired: false };
    assert.ok(invalid(noRevision).errors.some((e) => /verifies\.reviewedRevision: required/.test(e)));
    for (const r of [noVerifies, noResolved, structural, big, badStatus, noRevision]) assert.equal(invalid(r).valid, false);
  });

  it('keeps verification fields out of full reviews', () => {
    const carried = review('pedagogy-reviewer', () => 4);
    carried.scores[0].carriedOver = true;
    assert.match(modeErrors(carried).join('\n'), /carriedOver scores \(align\) belong to mode "verify"/);
    const withResolved = review('pedagogy-reviewer', () => 4, { resolved: [] });
    assert.match(modeErrors(withResolved).join('\n'), /"resolved" belongs to mode "verify"/);
    assert.equal(evaluateReviews([withResolved], schemas).valid, false);
  });

  it('merges a verification with full reviews of other reviewers (lowest score wins)', () => {
    const ja = review('ja-editor', (id) => (id === 'voice' ? 3 : id === 'load' ? 4 : undefined));
    const result = evaluateReviews([verification(), ja], schemas, { previous: [previous()] });
    assert.equal(result.verdict, 'pass');
    assert.deepEqual(result.rounds.map((r) => r.mode), ['verify', 'full']);
    assert.equal(result.scores.find((s) => s.id === 'voice').score, 3);
  });
});

describe('check-review.mjs: full reviews are unchanged', () => {
  it('reviews without "mode" and with "mode": "full" give the same verdicts as before', () => {
    const passing = review('pedagogy-reviewer', (id) => (['align', 'worked', 'active', 'miscon'].includes(id) ? 4 : 3));
    for (const r of [passing, { ...passing, mode: 'full' }]) {
      const result = evaluateReviews([r], schemas);
      assert.equal(result.valid, true);
      assert.equal(result.verdict, 'pass');
      assert.equal(result.mean, 3.31);
      assert.deepEqual(result.rounds, [{ reviewer: 'pedagogy-reviewer', mode: 'full' }]);
      assert.deepEqual(result.resolved, []);
    }
    const withMustFix = review('pedagogy-reviewer', () => 4, { mustFix: [{ criterion: 'voice', blockId: 'intro', issue: 'x', fix: 'y' }] });
    const result = evaluateReviews([withMustFix], schemas);
    assert.equal(result.verdict, 'revise');
    assert.equal(result.mustFix[0].status, undefined);
    assert.equal(evaluateReviews([review('pedagogy-reviewer', () => 3)], schemas).verdict, 'revise');
  });

  it('every committed review JSON is still a valid review.v1 document', () => {
    const courses = path.join(ROOT, 'content', 'courses');
    const files = fs.readdirSync(courses).flatMap((course) => {
      const dir = path.join(courses, course, 'reports');
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.review.json')).map((f) => path.join(dir, f)) : [];
    });
    for (const file of files) {
      const result = evaluateReviews([JSON.parse(fs.readFileSync(file, 'utf8'))], schemas);
      assert.equal(result.valid, true, `${path.relative(ROOT, file)}: ${result.errors.join('; ')}`);
    }
  });
});

describe('check-review.mjs CLI with verification rounds', () => {
  it('prints the mode, loads the previous review, and exits 0 / 1 / 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-verify-'));
    try {
      const write = (name, value) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, JSON.stringify(value));
        return file;
      };
      const prevFile = write('prev.json', previous());
      const ok = verification();
      ok.verifies = { ...ok.verifies, previousReview: prevFile };
      const okFile = write('ok.json', ok);
      const run = (...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'check-review.mjs'), ...args], { encoding: 'utf8' });

      const pass = run(okFile);
      assert.equal(pass.status, 0, pass.stdout + pass.stderr);
      assert.match(pass.stdout, /pedagogy-reviewer: verification of 5d2a414 \(previous review cross-checked\) · 2 resolved, 0 unresolved/);
      assert.match(pass.stdout, /hook\s+4\s+\(pedagogy-reviewer carried\)/);

      const unresolved = structuredClone(ok);
      unresolved.resolved[0].status = 'unresolved';
      const unresolvedRun = run(write('unresolved.json', unresolved));
      assert.equal(unresolvedRun.status, 1);
      assert.match(unresolvedRun.stdout, /must fix \(unresolved\) \[active\] check-quiz/);

      // previousReview pointing at the file being checked cannot be the previous round.
      const self = structuredClone(ok);
      const selfFile = path.join(dir, 'self.json');
      self.verifies.previousReview = selfFile;
      fs.writeFileSync(selfFile, JSON.stringify(self));
      const selfRun = run(selfFile);
      assert.equal(selfRun.status, 0);
      assert.match(selfRun.stderr, /is the file being checked/);
      // --previous supplies it explicitly; a missing item is then caught.
      const partial = structuredClone(self);
      partial.resolved = partial.resolved.slice(0, 1);
      fs.writeFileSync(selfFile, JSON.stringify(partial));
      const partialRun = run(selfFile, '--previous', prevFile);
      assert.equal(partialRun.status, 1);
      assert.match(partialRun.stdout, /must fix \(unverified\) \[voice\] card-goal/);

      const notAllowed = structuredClone(ok);
      notAllowed.verifies.fullReviewRequired = true;
      assert.equal(run(write('structural.json', notAllowed)).status, 2);
      assert.equal(run(okFile, '--previous', path.join(dir, 'missing.json')).status, 2);

      const asJson = JSON.parse(run(okFile, '--json').stdout);
      assert.equal(asJson.rounds[0].mode, 'verify');
      assert.equal(asJson.verdict, 'pass');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// review-scope.mjs
// ---------------------------------------------------------------------------

const md = (id, text = `Text of ${id}.`) => ({ id, type: 'markdown', md: text });
const lesson = () => ({
  schema: 'risepath.lesson/v1',
  id: 'demo',
  courseId: 'demo-course',
  title: 'Demo',
  objectives: [{ id: 'o1', text: 'Explain X', bloom: 'understand' }, { id: 'o2', text: 'Apply Y', bloom: 'apply' }],
  sections: [
    { id: 's1', role: 'concept', title: 'One', blocks: [md('b1'), md('b2'), md('b3'), md('b4'), md('b5')] },
    {
      id: 's2',
      role: 'check',
      title: 'Two',
      blocks: [
        md('b6'), md('b7'), md('b8'), md('b9'),
        { id: 'quiz', type: 'quiz', mode: 'exam', questions: [{ id: 'q1', prompt: 'A?', objectiveId: 'o1' }, { id: 'q2', prompt: 'B?', objectiveId: 'o2' }] },
      ],
    },
  ],
  glossary: [{ term: 'X', md: 'The x.' }],
  sources: [{ id: 'src1', title: 'Doc' }],
  provenance: { author: 'claude-code', generatedAt: '2026-10-01' },
});

describe('review-scope.mjs: verification or full review', () => {
  it('finds no change when only key order or provenance differ', () => {
    const before = lesson();
    const after = Object.fromEntries(Object.entries(structuredClone(before)).reverse());
    after.sections = before.sections.map((s) => ({ blocks: s.blocks.map((b) => Object.fromEntries(Object.entries(b).reverse())), title: s.title, role: s.role, id: s.id }));
    after.provenance = { author: 'someone-else', generatedAt: '2026-10-19' };
    assert.equal(canonical({ a: 1, b: [1, { c: 2, d: 3 }] }), canonical({ b: [1, { d: 3, c: 2 }], a: 1 }));
    const scope = compareLessons(before, after);
    assert.equal(scope.fullReviewRequired, false);
    assert.deepEqual(scope.changes, []);
    assert.deepEqual(scope.changed, []);
    assert.equal(scope.changedShare, 0);
  });

  it('allows a verification for a rewritten question and names it', () => {
    const before = lesson();
    const after = structuredClone(before);
    after.sections[1].blocks[4].questions[1].prompt = 'B, rewritten?';
    const scope = compareLessons(before, after);
    assert.equal(scope.fullReviewRequired, false);
    assert.deepEqual(scope.changes, [{ id: 'quiz', section: 's2', change: 'modified', parts: ['questions.q2'] }]);
    assert.deepEqual(scope.changed, ['quiz']);
    assert.equal(scope.changedShare, 0.1);
    assert.deepEqual(changedParts({ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'a' }, { id: 'c' }] }), ['items.c (new)', 'items (order)']);
  });

  it('lists added, removed and moved blocks, section fields and lesson fields', () => {
    const before = lesson();
    const after = structuredClone(before);
    const s1 = after.sections[0].blocks;
    [s1[1], s1[2]] = [s1[2], s1[1]]; // b2 and b3 swap: one of them moved
    after.sections[1].blocks.unshift(after.sections[0].blocks.pop()); // b5 moves to s2
    after.sections[1].blocks.push(md('b-new'));
    after.sections[1].blocks.splice(after.sections[1].blocks.findIndex((b) => b.id === 'b9'), 1);
    after.sections[0].title = 'One, renamed';
    after.glossary.push({ term: 'Y', md: 'The y.' });
    after.sources.push({ id: 'src2', title: 'Spec' });
    const scope = compareLessons(before, after);
    const byId = Object.fromEntries(scope.changes.map((c) => [c.id, c]));
    assert.equal(byId['b-new'].change, 'added');
    assert.equal(byId.b9.change, 'removed');
    assert.deepEqual(byId.b5, { id: 'b5', section: 's2', change: 'moved', parts: ['moved from section s1'] });
    assert.equal(['b2', 'b3'].filter((id) => byId[id]?.change === 'moved').length, 1);
    assert.deepEqual(scope.sections, [{ id: 's1', parts: ['title'] }]);
    assert.deepEqual(scope.fields, ['glossary', 'sources.src2 (new)']);
    assert.ok(scope.changed.includes('section.s1'));
    assert.ok(scope.changed.includes('lesson.glossary'));
    assert.ok(scope.changed.includes('lesson.sources.src2'));
    assert.equal(scope.blocks.changed, 4);
    assert.equal(scope.blocks.total, 11);
    assert.equal(scope.fullReviewRequired, true, 'more than 30% changed');
  });

  it('requires a full review when sections are added, removed, reordered or change role', () => {
    const reordered = lesson();
    reordered.sections.reverse();
    const added = lesson();
    added.sections.push({ id: 's3', role: 'summary', title: 'Three', blocks: [] });
    const removed = lesson();
    removed.sections[1].blocks = [];
    removed.sections.splice(0, 1, { ...removed.sections[0], id: 's1b' });
    const role = lesson();
    role.sections[0].role = 'example';
    const cases = [
      [reordered, /sections reordered: s1 → s2 became s2 → s1/],
      [added, /sections added: s3/],
      [removed, /sections removed: s1/],
      [role, /section s1 changed role: concept → example/],
    ];
    for (const [after, reason] of cases) {
      const scope = compareLessons(lesson(), after);
      assert.equal(scope.fullReviewRequired, true);
      assert.match(scope.reasons.join('\n'), reason);
    }
  });

  it('requires a full review when the objectives change', () => {
    for (const change of [
      (l) => { l.objectives[0].text = 'Explain X well'; },
      (l) => { l.objectives[1].bloom = 'analyze'; },
      (l) => { l.objectives.push({ id: 'o3', text: 'Z', bloom: 'apply' }); },
      (l) => { l.objectives.reverse(); },
    ]) {
      const after = lesson();
      change(after);
      const scope = compareLessons(lesson(), after);
      assert.equal(scope.fullReviewRequired, true);
      assert.match(scope.reasons[0], /^objectives changed: objectives/);
    }
  });

  it('allows up to 30% changed blocks and requires a full review above', () => {
    assert.equal(FULL_REVIEW_SHARE, 0.3);
    const three = lesson();
    for (const b of three.sections[0].blocks.slice(0, 3)) b.md = 'Changed.';
    const atLimit = compareLessons(lesson(), three);
    assert.equal(atLimit.changedShare, 0.3);
    assert.equal(atLimit.fullReviewRequired, false);
    const four = lesson();
    for (const b of four.sections[0].blocks.slice(0, 4)) b.md = 'Changed.';
    const over = compareLessons(lesson(), four);
    assert.equal(over.changedShare, 0.4);
    assert.equal(over.fullReviewRequired, true);
    assert.match(over.reasons.join('\n'), /4 of 10 blocks changed \(40%, more than 30%\)/);
  });

  it('snapshots the reviewed revision with its reviews and reads it back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-scope-'));
    try {
      const drafts = path.join(root, 'content', 'courses', 'demo-course', 'drafts');
      const reports = path.join(root, 'content', 'courses', 'demo-course', 'reports');
      fs.mkdirSync(drafts, { recursive: true });
      fs.mkdirSync(reports, { recursive: true });
      const file = path.join(drafts, 'demo.lesson.json');
      fs.writeFileSync(file, JSON.stringify(lesson()));
      fs.writeFileSync(path.join(reports, 'demo.pedagogy-reviewer.review.json'), '{}');
      fs.writeFileSync(path.join(reports, 'demo-practice.ja-editor.review.json'), '{}');
      fs.writeFileSync(path.join(reports, 'demo.md'), '# report');
      const saved = saveSnapshot(file, { root });
      assert.match(saved.revision, /^sha256:[0-9a-f]{12}$/);
      assert.equal(path.relative(root, saved.dir).split(path.sep).join('/'), `.artifacts/review/demo-course/demo/${saved.revision.slice(7)}`);
      assert.deepEqual(saved.reviews.map((f) => path.basename(f)), ['pedagogy-reviewer.review.json']);

      const changed = lesson();
      changed.sections[0].blocks[0].md = 'New text.';
      fs.writeFileSync(file, JSON.stringify(changed));
      const before = readBefore({ since: saved.revision }, file, changed, { root });
      assert.equal(before.revision, saved.revision);
      assert.deepEqual(compareLessons(JSON.parse(before.text), changed).changed, ['b1']);
      assert.throws(() => readBefore({ since: 'sha256:000000000000' }, file, changed, { root }), /No snapshot sha256:000000000000/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('CLI exits 0 for a verification, 1 for a full review, 2 for bad input', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-scope-cli-'));
    try {
      const write = (name, value) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, JSON.stringify(value));
        return file;
      };
      const run = (...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'review-scope.mjs'), ...args], { encoding: 'utf8', cwd: ROOT });
      const beforeFile = write('before.json', lesson());
      const small = lesson();
      small.sections[1].blocks[4].questions[0].prompt = 'A, rewritten?';
      const smallFile = write('small.json', small);
      const ok = run(smallFile, '--before', beforeFile, '--diff');
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /→ VERIFY/);
      assert.match(ok.stdout, /modified\s+s2 \/ quiz\s+questions\.q1/);
      assert.match(ok.stdout, /"fullReviewRequired":false/);
      assert.match(ok.stdout, /--- before[\s\S]*"A\?"[\s\S]*\+\+\+ after[\s\S]*"A, rewritten\?"/);
      const json = JSON.parse(run(smallFile, '--before', beforeFile, '--json').stdout);
      assert.equal(json.mode, 'verify');
      assert.deepEqual(json.verifies.changed, ['quiz']);
      assert.match(json.verifies.reviewedRevision, /^sha256:[0-9a-f]{12}$/);

      const moved = lesson();
      moved.sections.reverse();
      const full = run(write('moved.json', moved), '--before', beforeFile);
      assert.equal(full.status, 1);
      assert.match(full.stdout, /FULL REVIEW required: sections reordered/);

      assert.equal(run(smallFile).status, 2);
      assert.equal(run(smallFile, '--since', 'not-a-revision-xyz').status, 2);
      assert.throws(() => parseScopeArgs(['a.json', '--since']), /needs a value/);
      assert.throws(() => parseScopeArgs(['a.json', '--since', 'HEAD', '--snapshot']), /exactly one/);

      // A committed lesson compared with HEAD: the revision resolves to a commit.
      const head = run('content/courses/vibe-coding/lessons/vibe-ch1.lesson.json', '--since', 'HEAD', '--json');
      assert.notEqual(head.status, 2, head.stderr);
      assert.match(JSON.parse(head.stdout).reviewedRevision, /^[0-9a-f]{4,}$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
