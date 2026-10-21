# Report: vibe-coding/cc-07-skills-subagents (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:d414e3e1a2e0ec5b.**

- Title: 第7回｜手順はスキルに、調べものはサブエージェントに
- Draft: `content/courses/vibe-coding/drafts/cc-07-skills-subagents.lesson.json` · brief: `content/courses/vibe-coding/briefs/cc-07-skills-subagents.md`
- Level: intermediate · estMinutes 18 · locale jp (Japanese only) · courseId `vibe-coding` (preview course; publishing is the owner's call)
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. No `reviewedBy` (set when the owner publishes).

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
- course length measure: `prose 2167 (budget 1,200–2,400) · read 2594 · practice reading 931 · questions 12 · practice sections 1 · est 17.8 min (must be ≤ 20; estMinutes 18)`

## Gate (current draft)

```
Review of cc-07-skills-subagents by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-07-skills-subagents.lesson.json (sha256:d414e3e1a2e0ec5b)
  ja-editor: verification of sha256:97075ebd0299de71 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-07-skills-subagents/97075ebd0299de71/lesson.json) · 0 resolved, 0 unresolved · 1 changed · carried over: a11y_l10n · previous .artifacts/review/vibe-coding/cc-07-skills-subagents/97075ebd0299de71/round-1/ja-editor.review.json and 2 earlier rounds checked
  pedagogy-reviewer: verification of sha256:97075ebd0299de71 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-07-skills-subagents/97075ebd0299de71/lesson.json) · 0 resolved, 0 unresolved · 1 changed · carried over: align, hook, prior, worked, miscon, practice, meta · previous .artifacts/review/vibe-coding/cc-07-skills-subagents/97075ebd0299de71/round-1/pedagogy-reviewer.review.json and 2 earlier rounds checked
  visual-qa: full review
  mean 3.54 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer carried)
  ✓ hook       3  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     3  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer carried)
  ✓ visual     4  (pedagogy-reviewer, visual-qa)
  ✓ practice   3  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   4  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor carried, pedagogy-reviewer, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-07-skills-subagents/`)

1. `ac1d14f8dc7c957a`: ja-editor full revise (mean 3.50, must-fix 7); pedagogy-reviewer full revise (mean 3.15, must-fix 5)
2. `49fdb7d006e71baa`: ja-editor full revise (mean 4.00, must-fix 1); pedagogy-reviewer full revise (mean 3.38, must-fix 2)
3. `41f1a70fd4ffba29`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full pass (mean 3.54, must-fix 0)
4. `e03f31fdd3519c9b`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 2.67, must-fix 3)
5. `97075ebd0299de71`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full revise (mean 3.67, must-fix 1)
6. `d414e3e1a2e0ec5b`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.54, must-fix 0); visual-qa full pass (mean 4.00, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 62 claims (pages: 19); a second checker tried to refute each finding. Confirmed and fixed: 4. Refuted (text kept): 0.

- [wrong] `s3-check` (q5 option d feedback): スキルは繰り返す手順の置き場所で、今回の設計の話は入っていません。今の会話を引き継ぐのはフォークです。 — https://code.claude.com/docs/en/features-overview
- [overclaim] `s2-check` (q2 option d feedback): 誰が呼べるかを決めるのは、フロントマターの設定です。 — https://code.claude.com/docs/en/skills
- [overclaim] `check-quiz` (e6 option c feedback): バックグラウンドかどうかは、待つあいだに会話を続けられるかの違いです。メインに戻る中身の量は変わりません。 — https://code.claude.com/docs/en/sub-agents
- [unsupported] `s4-table` (caption): きっかけが来たら足す（公式の「少しずつ育てる」表から一部を抜粋） — https://code.claude.com/docs/en/features-overview

## Screenshots

`npm run lessons:preview -- vibe-coding cc-07-skills-subagents --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-07-skills-subagents/` (gitignored). The visual-qa review above was made from these screenshots.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
