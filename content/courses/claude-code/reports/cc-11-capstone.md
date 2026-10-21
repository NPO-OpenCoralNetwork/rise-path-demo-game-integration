# Report: vibe-coding/cc-11-capstone (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:c9d22545bc0d23db.**

- Title: 第11回 総合演習｜自分のリポジトリにClaude Code環境をつくる
- Draft: `content/courses/vibe-coding/drafts/cc-11-capstone.lesson.json` · brief: `content/courses/vibe-coding/briefs/cc-11-capstone.md`
- Level: intermediate · estMinutes 19 · locale jp (Japanese only) · courseId `vibe-coding` (preview course; publishing is the owner's call)
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. No `reviewedBy` (set when the owner publishes).

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | create | CLAUDE.md・スキル・フック・権限ルールを組み合わせて、自分のリポジトリ用のClaude Code環境を設計できる | pq0 (predict), q1, q2, e1, e2 |
| o2 | evaluate | チェックリストを使って、自分の環境と作業の進め方を評価し、次に足すものを判断できる | q3, q4, e3 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：学んだ部品を、どこから組み合わせる？ |
| design-rule | concept | 設計のルール：CLAUDE.mdから始め、きっかけが来たら足す |
| example | example | 例題：小さなToDoアプリの環境 |
| practice-setup | practice | 演習1：自分のリポジトリに環境をつくる |
| practice-cycle | practice | 演習2：1つの変更を計画からコミットまで進める |
| self-check | practice | 演習3：点検して、次に足すものを決める |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 1344 (budget 1,200–2,400) · read 1894 · practice reading 1672 · questions 8 · practice sections 3 · est 19.3 min (must be ≤ 20; estMinutes 19)`

## Gate (current draft)

```
Review of cc-11-capstone by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-11-capstone.lesson.json (sha256:c9d22545bc0d23db)
  ja-editor: full review
  pedagogy-reviewer: verification of sha256:423d9258076f1516 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-11-capstone/423d9258076f1516/lesson.json) · 0 resolved, 0 unresolved · 5 changed · carried over: hook, prior, visual, a11y_l10n · previous .artifacts/review/vibe-coding/cc-11-capstone/423d9258076f1516/round-1/pedagogy-reviewer.review.json and 4 earlier rounds checked
  visual-qa: full review
  mean 3.77 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     4  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     4  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   3  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer)
  ✓ accuracy   4  (pedagogy-reviewer)
  ✓ voice      4  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor, pedagogy-reviewer carried, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-11-capstone/`)

1. `a0a5e3162b6d70c5`: ja-editor full revise (mean 3.50, must-fix 12); pedagogy-reviewer full revise (mean 3.08, must-fix 7)
2. `ae84a43eacd96ce5`: ja-editor full pass (mean 3.75, must-fix 0); pedagogy-reviewer full revise (mean 3.77, must-fix 1)
3. `054759c1db95b6c4`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify pass (mean 3.77, must-fix 0)
4. `984f34269dfb6574`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.85, must-fix 0)
5. `3122649e3d005674`: ja-editor verify fail (mean 3.75, must-fix 1); pedagogy-reviewer verify revise (mean 3.77, must-fix 1); visual-qa full pass (mean 3.67, must-fix 0)
6. `423d9258076f1516`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.85, must-fix 0); visual-qa full pass (mean 3.33, must-fix 0)
7. `c9d22545bc0d23db`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.85, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 60 claims (pages: 22); a second checker tried to refute each finding. Confirmed and fixed: 3. Refuted (text kept): 2.

- [overclaim] `ex-prompt-skill` (expect (and the same claim in ex-steps item ex-skill.expect)): `/explain-diff` と打つと、今の差分にもとづく説明が返ります。 — https://code.claude.com/docs/en/skills
- [overclaim] `setup-prompt-model` (expect): 個人のデータは、CLAUDE.mdで伝えるだけでなく、下の設定で読み取りを拒否しています。 — https://code.claude.com/docs/en/permissions
- [overclaim] `summary-cards` (card-ask (front and back)): `git push` の前に必ず人が見るための設定は？ / `permissions.ask` に `Bash(git push *)` の確認ルールを書きます。 — https://code.claude.com/docs/en/permissions

## Screenshots

`npm run lessons:preview -- vibe-coding cc-11-capstone --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-11-capstone/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- 2026-10-21 reader update (components/lesson/reader.css): inline code chips kept whole, code-block lines soft-wrap with a hanging indent. Visual QA was re-run in full on fresh previews of every lesson, including cc-01-first-session, cc-04-verify, cc-05-context, cc-07-skills-subagents, cc-10-safety-cost and cc-11-capstone, which had passed before the change.
- Last small fixes made by the orchestrator from the reviewers' exact fix texts (cc-02 e6 d, cc-03 step titles, cc-05 pr-code, cc-08 q9 and practice-b-task, cc-09 e3 d, cc-11 dr-table), then re-reviewed by visual-qa, pedagogy-reviewer and ja-editor.
- cc-11-capstone: the orchestrator's dr-table fix had dropped 「subagent、」, the first body gloss of サブエージェント; pedagogy-reviewer and ja-editor both flagged it and it was restored (the table still fits 356 px). The ja-editor review of that round returned verdict "fail" (not a schema value), so a FULL ja-editor review of the final version was run.
- Cross-lesson consistency round (2026-10-21): the changed lessons cc-01-first-session, cc-02-permissions, cc-04-verify, cc-06-claude-md, cc-08-hooks-mcp, cc-09-parallel-automation, cc-10-safety-cost and cc-11-capstone were re-reviewed (visual QA full on a fresh preview; pedagogy-reviewer and ja-editor verification). For cc-02-permissions, cc-06-claude-md, cc-10-safety-cost and cc-11-capstone the gate refused the set because one reviewer's chain started at its earlier full review while the other's went further back ("no reviewer skips a round"); that reviewer then reviewed the final version in full.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
