# Report: vibe-coding/cc-03-plan-first (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:8ad1a10792b712d4.**

- Title: 第3回｜探索→計画→実装→コミット
- Draft: `content/courses/vibe-coding/drafts/cc-03-plan-first.lesson.json` · brief: `content/courses/vibe-coding/briefs/cc-03-plan-first.md`
- Level: beginner · estMinutes 19 · locale jp (Japanese only) · courseId `vibe-coding` (preview course; publishing is the owner's call)
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. No `reviewedBy` (set when the owner publishes).

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
- course length measure: `prose 2393 (budget 1,200–2,400) · read 3059 · practice reading 1442 · questions 8 · practice sections 2 · est 19.3 min (must be ≤ 20; estMinutes 19)`

## Gate (current draft)

```
Review of cc-03-plan-first by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-03-plan-first.lesson.json (sha256:8ad1a10792b712d4)
  ja-editor: verification of sha256:a69e9dc117810e75 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-03-plan-first/a69e9dc117810e75/lesson.json) · 0 resolved, 0 unresolved · 3 changed · carried over: prior, a11y_l10n · previous .artifacts/review/vibe-coding/cc-03-plan-first/a69e9dc117810e75/round-1/ja-editor.review.json and 2 earlier rounds checked
  pedagogy-reviewer: verification of sha256:a69e9dc117810e75 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-03-plan-first/a69e9dc117810e75/lesson.json) · 0 resolved, 0 unresolved · 3 changed · carried over: align, hook, prior, active, miscon, meta, accuracy, voice, a11y_l10n · previous .artifacts/review/vibe-coding/cc-03-plan-first/a69e9dc117810e75/round-1/pedagogy-reviewer.review.json and 2 earlier rounds checked
  visual-qa: full review
  mean 3.54 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor carried, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     3  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer carried)
  ✓ visual     4  (pedagogy-reviewer, visual-qa)
  ✓ practice   3  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   4  (pedagogy-reviewer carried)
  ✓ voice      3  (ja-editor, pedagogy-reviewer carried)
  ✓ a11y_l10n  3  (ja-editor carried, pedagogy-reviewer carried, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-03-plan-first/`)

1. `fa057faba24bd625`: ja-editor full revise (mean 3.50, must-fix 12); pedagogy-reviewer full revise (mean 3.23, must-fix 6)
2. `32e6d290cf411742`: ja-editor full revise (mean 3.50, must-fix 4); pedagogy-reviewer full revise (mean 3.46, must-fix 1)
3. `c61b1076cf96439d`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.33, must-fix 2)
4. `2a26cb723101d339`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.33, must-fix 1)
5. `a69e9dc117810e75`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.33, must-fix 3)
6. `8ad1a10792b712d4`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 50 claims (pages: 19); a second checker tried to refute each finding. Confirmed and fixed: 3. Refuted (text kept): 1.

- [overclaim] `s2-version` (md, first sentence): v2.1.283以降、対話セッション（session）はautoモードで始まります。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `s2-enter-lead` (md): [[プランモード]]への入り方は3つです（2026年10月、v2.1.304時点）。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `summary-cards` (cards[card-enter].front): プランモードに入る3つの方法は？ — https://code.claude.com/docs/en/permission-modes

## Screenshots

`npm run lessons:preview -- vibe-coding cc-03-plan-first --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-03-plan-first/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- Last small fixes made by the orchestrator from the reviewers' exact fix texts (cc-02 e6 d, cc-03 step titles, cc-05 pr-code, cc-08 q9 and practice-b-task, cc-09 e3 d, cc-11 dr-table), then re-reviewed by visual-qa, pedagogy-reviewer and ja-editor.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
