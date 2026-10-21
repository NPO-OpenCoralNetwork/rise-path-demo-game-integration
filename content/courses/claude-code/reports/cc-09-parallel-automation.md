# Report: claude-code/cc-09-parallel-automation (published)

**Status: PUBLISHED in course `claude-code` (lessons/ and course.json, on the owner's instruction, 2026-10-21). Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:5b14d7bb36e8d118.**

- Title: 第9回｜並列で進める・自動で回す
- Lesson: `content/courses/claude-code/lessons/cc-09-parallel-automation.lesson.json` · brief: `content/courses/claude-code/briefs/cc-09-parallel-automation.md`
- Level: intermediate · estMinutes 20 · locale jp (Japanese only) · courseId `claude-code`
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. Reviews: see the gate below.

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | evaluate | ワークツリー・サブエージェント・バックグラウンド実行から、状況に合う並列化の方法を選べる | q0 (predict), q1, q2, e1, e2 |
| o2 | apply | CI（継続的インテグレーション）などで使う安全な claude -p コマンドを書ける | q3, e3, e4 |
| o3 | create | 無人で動かす作業の依頼文を、成功条件・権限・費用の上限・失敗の報告つきで設計できる | q4, e5, e6 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：機能の途中で、急ぎのバグ修正が来た |
| parallel | concept | 1. 並列の3つの方法を選び分ける |
| worktree-example | example | 2. 例題：ワークツリーで2つの作業を並べる |
| headless | concept | 3. 非対話的実行を安全に書く |
| unattended-where | concept | 4. 無人実行を動かす場所 |
| unattended | concept | 5. 依頼文を4点で点検する |
| practice-command | practice | 演習1：夜間チェックのコマンドを書く |
| practice-audit | practice | 演習2：無人実行の依頼文を点検する |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 2262 (budget 1,200–2,400) · read 2650 · practice reading 1246 · questions 11 · practice sections 2 · est 20.0 min (must be ≤ 20; estMinutes 20)`

## Gate (current draft)

```
Review of cc-09-parallel-automation by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/claude-code/lessons/cc-09-parallel-automation.lesson.json (sha256:5b14d7bb36e8d118)
  ja-editor: full review
  pedagogy-reviewer: verification of sha256:262fc82916e86736 (previous review cross-checked; scope recomputed from .artifacts/review/claude-code/cc-09-parallel-automation/262fc82916e86736/lesson.json) · 0 resolved, 0 unresolved · 7 changed · carried over: align, hook, visual, practice, meta, a11y_l10n · previous .artifacts/review/claude-code/cc-09-parallel-automation/262fc82916e86736/round-1/pedagogy-reviewer.review.json and 1 earlier round checked
  visual-qa: full review
  mean 3.31 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      3  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      3  (ja-editor, pedagogy-reviewer)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     4  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     3  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   3  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  3  (ja-editor, pedagogy-reviewer carried, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/claude-code/cc-09-parallel-automation/`)

1. `f87cd45c170202f4`: ja-editor full revise (mean 3.00, must-fix 9); pedagogy-reviewer full revise (mean 2.92, must-fix 7)
2. `24be3d570c30f448`: ja-editor full revise (mean 3.25, must-fix 2); pedagogy-reviewer full revise (mean 3.23, must-fix 2)
3. `e66b60d1da0710f0`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)
4. `174374fa262b8b76`: ja-editor verify revise (mean 3.50, must-fix 1); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
5. `2bf364c299299ca6`: ja-editor full revise (mean 3.50, must-fix 1); pedagogy-reviewer full pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.00, must-fix 4)
6. `6da74e7b888a7ddb`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
7. `d960aa01a4d029e9`: ja-editor full revise (mean 3.50, must-fix 1); pedagogy-reviewer full pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.00, must-fix 5)
8. `c5dc598ce3ba8cf6`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
9. `262fc82916e86736`: ja-editor full revise (mean 3.50, must-fix 3); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.33, must-fix 0)
10. `5b14d7bb36e8d118`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 70 claims (pages: 20); a second checker tried to refute each finding. Confirmed and fixed: 3. Refuted (text kept): 2.

- [wrong] `s1-lead` (md): 第7回の[[サブエージェント]]のほかに、作業を並べる方法が2つあります。 — https://code.claude.com/docs/en/agents
- [overclaim] `s3-table` (rows[2][1] (--permission-mode dontAsk の「役割」。同じ言い方が check-quiz e3 explanation「dontAsk でほかを拒否します」、p1-checklist pc-mode、p2-prompt expect にもあります)): 許可していない操作を、確認せずに拒否する — https://code.claude.com/docs/en/permission-modes
- [overclaim] `summary-points` (points[2]): `claude -p` はv2.1.302からManualモードで始まります。 — https://code.claude.com/docs/en/permission-modes

## Screenshots

`npm run lessons:preview -- claude-code cc-09-parallel-automation --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/claude-code/cc-09-parallel-automation/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- Last small fixes made by the orchestrator from the reviewers' exact fix texts (cc-02 e6 d, cc-03 step titles, cc-05 pr-code, cc-08 q9 and practice-b-task, cc-09 e3 d, cc-11 dr-table), then re-reviewed by visual-qa, pedagogy-reviewer and ja-editor.
- Cross-lesson consistency round (2026-10-21): the changed lessons cc-01-first-session, cc-02-permissions, cc-04-verify, cc-06-claude-md, cc-08-hooks-mcp, cc-09-parallel-automation, cc-10-safety-cost and cc-11-capstone were re-reviewed (visual QA full on a fresh preview; pedagogy-reviewer and ja-editor verification). For cc-02-permissions, cc-06-claude-md, cc-10-safety-cost and cc-11-capstone the gate refused the set because one reviewer's chain started at its earlier full review while the other's went further back ("no reviewer skips a round"); that reviewer then reviewed the final version in full.
- Publication (2026-10-21): the 11 lessons moved to content/courses/claude-code/lessons/ with courseId claude-code. Visual QA (full, fresh preview in the new course) and pedagogy-reviewer/ja-editor re-ran. The gate accepts only review chains recorded under the lesson's current course, so pedagogy-reviewer and ja-editor reviewed every lesson in full under claude-code. Those full reviews raised new must-fix items in cc-03-plan-first (load), cc-07-skills-subagents (q6 recognition) and cc-09-parallel-automation (e3/e5 convergence; 『』 in s4-check); the orchestrator applied the reviewers' fix texts and the three lessons were re-reviewed. cc-03-plan-first's first pedagogy output was invalid JSON and cc-09-parallel-automation's ja-editor output used verdict "fail"; neither was edited, both were re-run.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
