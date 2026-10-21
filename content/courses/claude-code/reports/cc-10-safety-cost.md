# Report: claude-code/cc-10-safety-cost (published)

**Status: PUBLISHED in course `claude-code` (lessons/ and course.json, on the owner's instruction, 2026-10-21). Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:8a9d7701d14a41d6.**

- Title: 第10回｜安全とコストを管理する
- Lesson: `content/courses/claude-code/lessons/cc-10-safety-cost.lesson.json` · brief: `content/courses/claude-code/briefs/cc-10-safety-cost.md`
- Level: intermediate · estMinutes 17 · locale jp (Japanese only) · courseId `claude-code`
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. Reviews: see the gate below.

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | analyze | 危ない場面（信頼できないリポジトリ、外部の文章、強い権限）と、それぞれに合う対策を結びつけられる | q0 (predict), q1, q2, e1, e2 |
| o2 | apply | 秘密情報のファイルを読ませない拒否ルール（deny）を書ける | q3, e3, e4 |
| o3 | analyze | 想定外の使用量や請求の原因を特定できる | q4, e5, e6 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：知らないリポジトリと、残ったAPIキー |
| s1 | concept | 10-1. 外の文章に紛れた指示 |
| s2 | concept | 10-2. 知らないリポジトリと強い権限は、隔離する |
| s3 | example | 10-3. 秘密情報を読ませない拒否ルールを書く |
| s4 | concept | 10-4. データの行き先を知る |
| s5 | concept | 10-5. 使用量と請求の原因を突き止める |
| practice | practice | 演習：田中さんの使い方を点検して直す |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 1887 (budget 1,200–2,400) · read 2459 · practice reading 1106 · questions 11 · practice sections 1 · est 17.3 min (must be ≤ 20; estMinutes 17)`

## Gate (current draft)

```
Review of cc-10-safety-cost by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/claude-code/lessons/cc-10-safety-cost.lesson.json (sha256:8a9d7701d14a41d6)
  ja-editor: full review
  pedagogy-reviewer: full review
  visual-qa: full review
  mean 3.31 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer)
  ✓ prior      3  (ja-editor, pedagogy-reviewer)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     3  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     3  (pedagogy-reviewer, visual-qa)
  ✓ practice   3  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  3  (ja-editor, pedagogy-reviewer, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/claude-code/cc-10-safety-cost/`)

1. `8c4567a466d38ec7`: ja-editor full revise (mean 3.00, must-fix 11); pedagogy-reviewer full revise (mean 3.00, must-fix 4)
2. `c7223f9f160f438c`: ja-editor full pass (mean 3.50, must-fix 0); pedagogy-reviewer full pass (mean 3.38, must-fix 0)
3. `48733d77bde8508c`: ja-editor verify revise (mean 3.25, must-fix 1); pedagogy-reviewer verify pass (mean 3.38, must-fix 0)
4. `18da014f91a89678`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
5. `4b13c12f53aeb2f8`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.33, must-fix 1)
6. `ba8eeb1a7115a66b`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.00, must-fix 1)
7. `31ca899dd855ae10`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify revise (mean 3.38, must-fix 1); visual-qa full revise (mean 3.00, must-fix 1)
8. `4f85040f9e462bb2`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
9. `8a9d7701d14a41d6`: ja-editor full pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 76 claims (pages: 22); a second checker tried to refute each finding. Confirmed and fixed: 7. Refuted (text kept): 1.

- [outdated] `s1-auto` (md (2nd sentence)): ただし、その分類器はAnthropicの検証で、行き過ぎた操作の17%を見逃しました。 — https://www.anthropic.com/engineering/claude-code-auto-mode
- [overclaim] `s1-auto` (md (1st sentence)): autoモードは、v2.1.283から対話セッションの既定です。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `s2-isolate` (md (2nd sentence)): `claude -p` では、確認なしでリポジトリのフックや設定が動きます。 — https://code.claude.com/docs/en/permissions
- [overclaim] `s2-check` (q2 option c feedback): `-p` では信頼の確認が出ないまま、リポジトリのフックや設定が使われます。 — https://code.claude.com/docs/en/permissions
- [overclaim] `s3-steps` (step ex-place md): プロジェクトの `.claude/settings.json` に書きます。gitで共有され、全員に効きます。 — https://code.claude.com/docs/en/settings
- [overclaim] `s3-steps` (step ex-verify expect): Claudeは中身を読めません。 — https://code.claude.com/docs/en/permissions
- [overclaim] `check-quiz` (e2 option d feedback): Claude Codeは、rootやsudoでの `bypassPermissions` を拒否します。 — https://code.claude.com/docs/en/permission-modes

## Screenshots

`npm run lessons:preview -- claude-code cc-10-safety-cost --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/claude-code/cc-10-safety-cost/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- cc-10 ja-editor final-round verify review: verdict "fail" set to "revise" (1 must-fix).
- cc-10 snapshot 48733d77bde8508c/round-1/ja-editor.review.json taken before the verdict fix; applied the same fix to the snapshot copy.
  criterion fill, cc-10 and cc-02 verdict fail->revise, plus their snapshot copies) are superseded by fresh FULL
- 2026-10-21 reader update (components/lesson/reader.css): inline code chips kept whole, code-block lines soft-wrap with a hanging indent. Visual QA was re-run in full on fresh previews of every lesson, including cc-01-first-session, cc-04-verify, cc-05-context, cc-07-skills-subagents, cc-10-safety-cost and cc-11-capstone, which had passed before the change.
- cc-10-safety-cost pedagogy-reviewer: the committed verification review had an absolute local path in its summary (server/tests/docPaths.test.js failed). The review was not edited; the same verification (of 31ca899dd855ae10) was re-run with an instruction to use repository-relative paths, and the new review replaced it.
- Cross-lesson consistency round (2026-10-21): the changed lessons cc-01-first-session, cc-02-permissions, cc-04-verify, cc-06-claude-md, cc-08-hooks-mcp, cc-09-parallel-automation, cc-10-safety-cost and cc-11-capstone were re-reviewed (visual QA full on a fresh preview; pedagogy-reviewer and ja-editor verification). For cc-02-permissions, cc-06-claude-md, cc-10-safety-cost and cc-11-capstone the gate refused the set because one reviewer's chain started at its earlier full review while the other's went further back ("no reviewer skips a round"); that reviewer then reviewed the final version in full.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
