# Report: claude-code/cc-07-skills-subagents (published)

**Status: PUBLISHED in course `claude-code` (lessons/ and course.json, on the owner's instruction, 2026-10-21). Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:735836d64d5beaab.**

- Title: 第7回｜手順はスキルに、調べものはサブエージェントに
- Lesson: `content/courses/claude-code/lessons/cc-07-skills-subagents.lesson.json` · brief: `content/courses/claude-code/briefs/cc-07-skills-subagents.md`
- Level: intermediate · estMinutes 18 · locale jp (Japanese only) · courseId `claude-code`
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. Reviews: see the gate below.

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | create | 繰り返す手順をSKILL.mdにまとめられる | q2, q3, e1, e2 |
| o2 | evaluate | スキル・サブエージェント・CLAUDE.mdの使い分けを判断できる | hook-q (predict), q1, q5, q6, e3 |
| o3 | understand | サブエージェントを使うとコンテキストが節約できる理由を説明できる | q4, e5, e6 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：毎回貼っている手順書 |
| skill-basics | concept | 7-1. スキル：手順は使うときだけ読み込む |
| skill-example | example | 7-2. 例題：コミットメッセージの手順をスキルにする |
| subagents | concept | 7-3. サブエージェント：調べものを別のコンテキストで |
| choose | concept | 7-4. どこに置く？ 足すのは「きっかけ」が来てから |
| practice | practice | 演習：自分の手順をスキルにし、調べものを任せる |
| check | check | 確認テスト |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 2183 (budget 1,200–2,400) · read 2610 · practice reading 931 · questions 12 · practice sections 1 · est 17.9 min (must be ≤ 20; estMinutes 18)`

## Gate (current draft)

```
Review of cc-07-skills-subagents by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/claude-code/lessons/cc-07-skills-subagents.lesson.json (sha256:735836d64d5beaab)
  ja-editor: verification of a0c0ded (previous review cross-checked; scope recomputed from a0c0ded:content/courses/claude-code/lessons/cc-07-skills-subagents.lesson.json) · 0 resolved, 0 unresolved · 1 changed · carried over: prior, a11y_l10n · previous a0c0ded:content/courses/claude-code/reports/cc-07-skills-subagents.ja-editor.review.json and 1 earlier round checked
  pedagogy-reviewer: verification of a0c0ded (previous review cross-checked; scope recomputed from a0c0ded:content/courses/claude-code/lessons/cc-07-skills-subagents.lesson.json) · 0 resolved, 0 unresolved · 1 changed · carried over: hook, prior, load, worked, active, visual, practice, meta, voice · previous a0c0ded:content/courses/claude-code/reports/cc-07-skills-subagents.pedagogy-reviewer.review.json and 1 earlier round checked
  visual-qa: full review
  mean 3.46 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       3  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor carried, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor, pedagogy-reviewer carried, visual-qa)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     4  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     3  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   3  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer carried)
  ✓ a11y_l10n  4  (ja-editor carried, pedagogy-reviewer, visual-qa)
```

## Review rounds (local snapshots in `.artifacts/review/claude-code/cc-07-skills-subagents/`, one line per lesson version and round; the reviews the gate counts are the committed ones in this folder)

1. `ac1d14f8dc7c957a/round-1`: ja-editor full revise (mean 3.50, must-fix 7); pedagogy-reviewer full revise (mean 3.15, must-fix 5)
2. `49fdb7d006e71baa/round-1`: ja-editor full revise (mean 4.00, must-fix 1); pedagogy-reviewer full revise (mean 3.38, must-fix 2)
3. `41f1a70fd4ffba29/round-1`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full pass (mean 3.54, must-fix 0)
4. `e03f31fdd3519c9b/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 2.67, must-fix 3)
5. `97075ebd0299de71/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.67, must-fix 1)
6. `d414e3e1a2e0ec5b/round-2`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)
7. `d414e3e1a2e0ec5b/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)
8. `f8e6497346002dd9/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)
9. `f8e6497346002dd9/round-2`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full revise (mean 3.38, must-fix 1); visual-qa full pass (mean 4.00, must-fix 0)
10. `0ffacf7c3db87313/round-1`: ja-editor verify fail (mean 4.00, must-fix 1); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)
11. `2679f127d93ca803/round-1`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)
12. `2679f127d93ca803/round-2`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full revise (mean 3.46, must-fix 1); visual-qa full pass (mean 4.00, must-fix 0)
13. `a3c0929a6fa09460/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full revise (mean 3.67, must-fix 1)
14. `735836d64d5beaab/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 62 claims (pages: 19); a second checker tried to refute each finding. Confirmed and fixed: 4. Refuted (text kept): 0.

- [wrong] `s3-check` (q5 option d feedback): スキルは繰り返す手順の置き場所で、今回の設計の話は入っていません。今の会話を引き継ぐのはフォークです。 — https://code.claude.com/docs/en/features-overview
- [overclaim] `s2-check` (q2 option d feedback): 誰が呼べるかを決めるのは、フロントマターの設定です。 — https://code.claude.com/docs/en/skills
- [overclaim] `check-quiz` (e6 option c feedback): バックグラウンドかどうかは、待つあいだに会話を続けられるかの違いです。メインに戻る中身の量は変わりません。 — https://code.claude.com/docs/en/sub-agents
- [unsupported] `s4-table` (caption): きっかけが来たら足す（公式の「少しずつ育てる」表から一部を抜粋） — https://code.claude.com/docs/en/features-overview

Records: `content/courses/claude-code/reports/facts/cc-07-skills-subagents.audit.json` and `cc-07-skills-subagents.facts.md`.

## Screenshots

`npm run lessons:preview -- claude-code cc-07-skills-subagents --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/claude-code/cc-07-skills-subagents/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- 2026-10-21 reader update (components/lesson/reader.css): inline code chips kept whole, code-block lines soft-wrap with a hanging indent. Visual QA was re-run in full on fresh previews of every lesson, including cc-01-first-session, cc-04-verify, cc-05-context, cc-07-skills-subagents, cc-10-safety-cost and cc-11-capstone, which had passed before the change.
- Publication (2026-10-21): the 11 lessons moved to content/courses/claude-code/lessons/ with courseId claude-code. Visual QA (full, fresh preview in the new course) and pedagogy-reviewer/ja-editor re-ran. The gate accepts only review chains recorded under the lesson's current course, so pedagogy-reviewer and ja-editor reviewed every lesson in full under claude-code. Those full reviews raised new must-fix items in cc-03-plan-first (load), cc-07-skills-subagents (q6 recognition) and cc-09-parallel-automation (e3/e5 convergence; 『』 in s4-check); the orchestrator applied the reviewers' fix texts and the three lessons were re-reviewed. cc-03-plan-first's first pedagogy output was invalid JSON and cc-09-parallel-automation's ja-editor output used verdict "fail"; neither was edited, both were re-run.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
