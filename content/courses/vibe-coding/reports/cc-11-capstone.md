# Report: vibe-coding/cc-11-capstone (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:984f34269dfb6574.**

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
- course length measure: `prose 1329 (budget 1,200–2,400) · read 1833 · practice reading 1657 · questions 8 · practice sections 3 · est 19.1 min (must be ≤ 20; estMinutes 19)`

## Gate (current draft)

```
Review of cc-11-capstone by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-11-capstone.lesson.json (sha256:984f34269dfb6574)
  ja-editor: verification of sha256:054759c1db95b6c4 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-11-capstone/054759c1db95b6c4/lesson.json) · 0 resolved, 0 unresolved · 6 changed · carried over: none · previous .artifacts/review/vibe-coding/cc-11-capstone/054759c1db95b6c4/round-1/ja-editor.review.json and 1 earlier round checked
  pedagogy-reviewer: verification of sha256:054759c1db95b6c4 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-11-capstone/054759c1db95b6c4/lesson.json) · 0 resolved, 0 unresolved · 6 changed · carried over: align, hook, active, miscon · previous .artifacts/review/vibe-coding/cc-11-capstone/054759c1db95b6c4/round-1/pedagogy-reviewer.review.json and 1 earlier round checked
  visual-qa: full review
  mean 3.77 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor, pedagogy-reviewer)
  ✓ load       4  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     4  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer carried)
  ✓ visual     3  (pedagogy-reviewer, visual-qa)
  ✓ practice   3  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer)
  ✓ accuracy   4  (pedagogy-reviewer)
  ✓ voice      4  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor, pedagogy-reviewer, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-11-capstone/`)

1. `a0a5e3162b6d70c5`: ja-editor full revise (mean 3.50, must-fix 12); pedagogy-reviewer full revise (mean 3.08, must-fix 7)
2. `ae84a43eacd96ce5`: ja-editor full pass (mean 3.75, must-fix 0); pedagogy-reviewer full revise (mean 3.77, must-fix 1)
3. `054759c1db95b6c4`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify pass (mean 3.77, must-fix 0)
4. `984f34269dfb6574`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.85, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 60 claims (pages: 22); a second checker tried to refute each finding. Confirmed and fixed: 3. Refuted (text kept): 2.

- [overclaim] `ex-prompt-skill` (expect (and the same claim in ex-steps item ex-skill.expect)): `/explain-diff` と打つと、今の差分にもとづく説明が返ります。 — https://code.claude.com/docs/en/skills
- [overclaim] `setup-prompt-model` (expect): 個人のデータは、CLAUDE.mdで伝えるだけでなく、下の設定で読み取りを拒否しています。 — https://code.claude.com/docs/en/permissions
- [overclaim] `summary-cards` (card-ask (front and back)): `git push` の前に必ず人が見るための設定は？ / `permissions.ask` に `Bash(git push *)` の確認ルールを書きます。 — https://code.claude.com/docs/en/permissions

## Screenshots

`npm run lessons:preview -- vibe-coding cc-11-capstone --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-11-capstone/` (gitignored). The visual-qa review above was made from these screenshots.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
