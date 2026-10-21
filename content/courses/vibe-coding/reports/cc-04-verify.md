# Report: vibe-coding/cc-04-verify (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:17c13d4e45026e5d.**

- Title: 第4回｜検証を任せる：テスト・レビュー・説明
- Draft: `content/courses/vibe-coding/drafts/cc-04-verify.lesson.json` · brief: `content/courses/vibe-coding/briefs/cc-04-verify.md`
- Level: intermediate · estMinutes 19 · locale jp (Japanese only) · courseId `vibe-coding` (preview course; publishing is the owner's call)
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. No `reviewedBy` (set when the owner publishes).

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | create | タスクに合う「Claudeが自分で実行できる確認」（テスト・ビルド・リンター・スクリーンショット）を設計できる | q0 (predict), q1, e1, e2 |
| o2 | analyze | 証拠のない「完了しました」報告を見抜ける | q2, q3, e3, e4 |
| o3 | evaluate | 別のコンテキストでのレビューを依頼し、指摘を必須と任意に仕分けられる | q4, q5, e5, e6 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：「完了しました」のあとで |
| 4-1 | concept | 4-1. 確かめる手段を渡す |
| 4-2 | concept | 4-2. 「完了しました」より証拠を |
| 4-3 | example | 4-3. テストを先に書かせる |
| 4-4 | concept | 4-4. 別のコンテキストでレビューする |
| 4-5 | concept | 4-5. 説明させて、理解を残す |
| practice | practice | 演習：テストから作り、別の目で確かめる |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 2242 (budget 1,200–2,400) · read 3218 · practice reading 1046 · questions 12 · practice sections 1 · est 19.5 min (must be ≤ 20; estMinutes 19)`

## Gate (current draft)

```
Review of cc-04-verify by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-04-verify.lesson.json (sha256:17c13d4e45026e5d)
  ja-editor: verification of sha256:7aa12666041c7288 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-04-verify/7aa12666041c7288/lesson.json) · 0 resolved, 0 unresolved · 2 changed · carried over: prior, a11y_l10n · previous .artifacts/review/vibe-coding/cc-04-verify/7aa12666041c7288/round-1/ja-editor.review.json and 2 earlier rounds checked
  pedagogy-reviewer: verification of sha256:7aa12666041c7288 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-04-verify/7aa12666041c7288/lesson.json) · 0 resolved, 0 unresolved · 2 changed · carried over: align, hook, prior, worked, visual, practice, meta, a11y_l10n · previous .artifacts/review/vibe-coding/cc-04-verify/7aa12666041c7288/round-1/pedagogy-reviewer.review.json and 2 earlier rounds checked
  visual-qa: full review
  mean 3.46 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      3  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      3  (ja-editor carried, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     4  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     4  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   3  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   4  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  3  (ja-editor carried, pedagogy-reviewer carried, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-04-verify/`)

1. `2416078b9953be33`: ja-editor full revise (mean 2.75, must-fix 6); pedagogy-reviewer full revise (mean 3.00, must-fix 7)
2. `d622512671de3ba6`: ja-editor full revise (mean 3.00, must-fix 3); pedagogy-reviewer full pass (mean 3.46, must-fix 0)
3. `f72c755010e86821`: ja-editor verify revise (mean 3.25, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.33, must-fix 2)
4. `7aa12666041c7288`: ja-editor verify revise (mean 3.25, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
5. `17c13d4e45026e5d`: ja-editor verify revise (mean 3.25, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 54 claims (pages: 17); a second checker tried to refute each finding. Confirmed and fixed: 4. Refuted (text kept): 1.

- [overclaim] `s1-why` (md, third sentence): 公式ガイドが最初に挙げる方法で、第1回のエージェントループ（agentic loop）の「結果を確かめる」を確実にします。 — https://code.claude.com/docs/en/best-practices
- [overclaim] `s2-goal` (md, first paragraph, third sentence): ターンごとに別の小さなモデルが判定し、満たすまでClaudeは続けます。 — https://code.claude.com/docs/en/goal
- [overclaim] `s2-goal-prompt` (expect, first sentence): Claudeがテストを実行しては直し、出力に「fail 0」が出るまで続けます。 — https://code.claude.com/docs/en/goal
- [overclaim] `s4-trap` (md, first sentence): 穴を探すよう頼まれたレビュー役は、健全な作業にも指摘を返します。 — https://code.claude.com/docs/en/best-practices

## Screenshots

`npm run lessons:preview -- vibe-coding cc-04-verify --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-04-verify/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- 2026-10-21 reader update (components/lesson/reader.css): inline code chips kept whole, code-block lines soft-wrap with a hanging indent. Visual QA was re-run in full on fresh previews of every lesson, including cc-01-first-session, cc-04-verify, cc-05-context, cc-07-skills-subagents, cc-10-safety-cost and cc-11-capstone, which had passed before the change.
- Cross-lesson consistency round (2026-10-21): the changed lessons cc-01-first-session, cc-02-permissions, cc-04-verify, cc-06-claude-md, cc-08-hooks-mcp, cc-09-parallel-automation, cc-10-safety-cost and cc-11-capstone were re-reviewed (visual QA full on a fresh preview; pedagogy-reviewer and ja-editor verification). For cc-02-permissions, cc-06-claude-md, cc-10-safety-cost and cc-11-capstone the gate refused the set because one reviewer's chain started at its earlier full review while the other's went further back ("no reviewer skips a round"); that reviewer then reviewed the final version in full.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
