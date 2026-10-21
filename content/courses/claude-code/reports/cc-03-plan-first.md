# Report: claude-code/cc-03-plan-first (published)

**Status: PUBLISHED in course `claude-code` (lessons/ and course.json, on the owner's instruction, 2026-10-21). Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:50da68311b84aa11.**

- Title: 第3回｜探索→計画→実装→コミット
- Lesson: `content/courses/claude-code/lessons/cc-03-plan-first.lesson.json` · brief: `content/courses/claude-code/briefs/cc-03-plan-first.md`
- Level: beginner · estMinutes 19 · locale jp (Japanese only) · courseId `claude-code`
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. Reviews: see the gate below.

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | apply | あいまいな依頼を、範囲・参照先・既存のパターン・症状の4つの観点で具体的に書き直せる | q1, e1 |
| o2 | evaluate | プランモードを使うべき場面と省いてよい場面を判断し、承認する前に計画を直せる | q0 (predict), q2, q3, e4 |
| o3 | create | 大きめの機能のために、仕様をインタビューしてもらう依頼文を作れる | q4, e5 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：「いい感じにして」の行き先 |
| s1 | concept | 3-1. 依頼を4つの観点で具体的にする |
| s2 | concept | 3-2. 探索→計画→実装→コミット |
| s3 | example | 3-3. 例題：ログイン画面を4つのフェーズで直す |
| s4 | concept | 3-4. 大きめの機能は仕様から始める |
| practice | practice | 演習1：TODO画面を4つのフェーズで直す |
| practice-spec | practice | 演習2：仕様インタビューの依頼文を作る |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 2295 (budget 1,200–2,400) · read 2961 · practice reading 1442 · questions 8 · practice sections 2 · est 19.1 min (must be ≤ 20; estMinutes 19)`

## Gate (current draft)

```
Review of cc-03-plan-first by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/claude-code/lessons/cc-03-plan-first.lesson.json (sha256:50da68311b84aa11)
  ja-editor: verification of sha256:a0ee84f2b69dd0e5 (previous review cross-checked; scope recomputed from .artifacts/review/claude-code/cc-03-plan-first/a0ee84f2b69dd0e5/lesson.json) · 0 resolved, 0 unresolved · 4 changed · carried over: none · previous .artifacts/review/claude-code/cc-03-plan-first/a0ee84f2b69dd0e5/round-1/ja-editor.review.json
  pedagogy-reviewer: verification of sha256:a0ee84f2b69dd0e5 (previous review cross-checked; scope recomputed from .artifacts/review/claude-code/cc-03-plan-first/a0ee84f2b69dd0e5/lesson.json) · 2 resolved, 0 unresolved · 4 changed · carried over: align, hook, prior, worked, active, miscon, visual, practice · previous .artifacts/review/claude-code/cc-03-plan-first/a0ee84f2b69dd0e5/round-1/pedagogy-reviewer.review.json
  visual-qa: full review
  mean 3.38 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      3  (ja-editor, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     3  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer carried)
  ✓ visual     4  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   3  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  3  (ja-editor, pedagogy-reviewer, visual-qa)
  resolved [load] s2-version (pedagogy-reviewer)
  resolved [load] s4-community (pedagogy-reviewer)
```

## Review rounds (snapshots in `.artifacts/review/claude-code/cc-03-plan-first/`)

1. `fa057faba24bd625`: ja-editor full revise (mean 3.50, must-fix 12); pedagogy-reviewer full revise (mean 3.23, must-fix 6)
2. `32e6d290cf411742`: ja-editor full revise (mean 3.50, must-fix 4); pedagogy-reviewer full revise (mean 3.46, must-fix 1)
3. `a69e9dc117810e75`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.33, must-fix 3)
4. `2a26cb723101d339`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.33, must-fix 1)
5. `8ad1a10792b712d4`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
6. `c61b1076cf96439d`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.33, must-fix 2)
7. `a0ee84f2b69dd0e5`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full revise (mean 3.31, must-fix 2); visual-qa full pass (mean 4.00, must-fix 0)
8. `50da68311b84aa11`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 50 claims (pages: 19); a second checker tried to refute each finding. Confirmed and fixed: 3. Refuted (text kept): 1.

- [overclaim] `s2-version` (md, first sentence): v2.1.283以降、対話セッション（session）はautoモードで始まります。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `s2-enter-lead` (md): [[プランモード]]への入り方は3つです（2026年10月、v2.1.304時点）。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `summary-cards` (cards[card-enter].front): プランモードに入る3つの方法は？ — https://code.claude.com/docs/en/permission-modes

## Screenshots

`npm run lessons:preview -- claude-code cc-03-plan-first --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/claude-code/cc-03-plan-first/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- Last small fixes made by the orchestrator from the reviewers' exact fix texts (cc-02 e6 d, cc-03 step titles, cc-05 pr-code, cc-08 q9 and practice-b-task, cc-09 e3 d, cc-11 dr-table), then re-reviewed by visual-qa, pedagogy-reviewer and ja-editor.
- Publication (2026-10-21): the 11 lessons moved to content/courses/claude-code/lessons/ with courseId claude-code. Visual QA (full, fresh preview in the new course) and pedagogy-reviewer/ja-editor re-ran. The gate accepts only review chains recorded under the lesson's current course, so pedagogy-reviewer and ja-editor reviewed every lesson in full under claude-code. Those full reviews raised new must-fix items in cc-03-plan-first (load), cc-07-skills-subagents (q6 recognition) and cc-09-parallel-automation (e3/e5 convergence; 『』 in s4-check); the orchestrator applied the reviewers' fix texts and the three lessons were re-reviewed. cc-03-plan-first's first pedagogy output was invalid JSON and cc-09-parallel-automation's ja-editor output used verdict "fail"; neither was edited, both were re-run.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
