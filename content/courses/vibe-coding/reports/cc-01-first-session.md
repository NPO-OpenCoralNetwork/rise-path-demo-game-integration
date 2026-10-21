# Report: vibe-coding/cc-01-first-session (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:9251fd0014082e5c.**

- Title: 第1回｜最初のタスクを任せる
- Draft: `content/courses/vibe-coding/drafts/cc-01-first-session.lesson.json` · brief: `content/courses/vibe-coding/briefs/cc-01-first-session.md`
- Level: beginner · estMinutes 16 · locale jp (Japanese only) · courseId `vibe-coding` (preview course; publishing is the owner's call)
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. No `reviewedBy` (set when the owner publishes).

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | understand | チャットや補完とエージェントループの違いを説明できる | q0 (predict), q1, q5 |
| o2 | apply | 状況に合うサーフェス（ターミナルCLI・IDE拡張・デスクトップアプリ・クラウドセッション）を選べる | q2, q6 |
| o3 | apply | Claude Codeを入れて起動し、質問 → 小さな変更 → 差分の確認 → コミットの流れで最初のセッションを実行できる | q3, q4, q7, q8, q9 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：貼り付けずに聞いてみる |
| loop | concept | 1-1. チャット・補完・エージェントループ |
| surfaces | concept | 1-2. どこで使うか：4つのサーフェス |
| install | concept | 1-3. インストールして、確かめる |
| session | concept | 1-4. 起動して、セッションを始める |
| first-session | example | 1-5. 例題：質問から1コミットまで |
| practice | practice | 演習：練習用フォルダで1コミットまで |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 1659 (budget 1,200–2,400) · read 2483 · practice reading 801 · questions 10 · practice sections 1 · est 16.0 min (must be ≤ 20; estMinutes 16)`

## Gate (current draft)

```
Review of cc-01-first-session by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-01-first-session.lesson.json (sha256:9251fd0014082e5c)
  ja-editor: verification of sha256:eb6d40faa5d6fe69 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-01-first-session/eb6d40faa5d6fe69/lesson.json) · 1 resolved, 0 unresolved · 4 changed · carried over: a11y_l10n · previous .artifacts/review/vibe-coding/cc-01-first-session/eb6d40faa5d6fe69/round-1/ja-editor.review.json and 2 earlier rounds checked
  pedagogy-reviewer: verification of sha256:eb6d40faa5d6fe69 (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-01-first-session/eb6d40faa5d6fe69/lesson.json) · 0 resolved, 0 unresolved · 4 changed · carried over: align, hook, active, miscon, meta · previous .artifacts/review/vibe-coding/cc-01-first-session/eb6d40faa5d6fe69/round-1/pedagogy-reviewer.review.json and 2 earlier rounds checked
  visual-qa: full review
  mean 3.38 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      3  (ja-editor, pedagogy-reviewer)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     3  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer carried)
  ✓ visual     4  (pedagogy-reviewer, visual-qa)
  ✓ practice   3  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  3  (ja-editor carried, pedagogy-reviewer, visual-qa)
  resolved [prior] install-how (ja-editor)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-01-first-session/`)

1. `a0e5c8baccf55921`: ja-editor full revise (mean 3.25, must-fix 11); pedagogy-reviewer full revise (mean 3.00, must-fix 4)
2. `d8b090b9a8da1f4f`: ja-editor full revise (mean 3.25, must-fix 2); pedagogy-reviewer full pass (mean 3.38, must-fix 0)
3. `3ebe60f3a0474749`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.33, must-fix 2)
4. `eb6d40faa5d6fe69`: ja-editor verify revise (mean 3.50, must-fix 1); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.00, must-fix 3)
5. `9251fd0014082e5c`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 85 claims (pages: 29); a second checker tried to refute each finding. Confirmed and fixed: 3. Refuted (text kept): 0.

- [wrong] `check-quiz` (q6 option b feedback): クラウドセッションはGitHubのリポジトリを複製して動くので、GitHubにないフォルダでは使えません。手元のフォルダなら、デスクトップアプリが近道です。 — https://code.claude.com/docs/en/claude-code-on-the-web
- [overclaim] `example-habit` (md): Anthropicの研究では、AIに説明を求めて学んだ人は、あとのテストでも高い点を保ちました。 — https://www.anthropic.com/research/AI-assistance-coding-skills
- [overclaim] `session-check` (q3 option c (the correct answer)): 昨日の会話は見えないので、伝え直すか開き直す必要がある — https://code.claude.com/docs/en/memory

## Screenshots

`npm run lessons:preview -- vibe-coding cc-01-first-session --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-01-first-session/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- 2026-10-21 reader update (components/lesson/reader.css): inline code chips kept whole, code-block lines soft-wrap with a hanging indent. Visual QA was re-run in full on fresh previews of every lesson, including cc-01-first-session, cc-04-verify, cc-05-context, cc-07-skills-subagents, cc-10-safety-cost and cc-11-capstone, which had passed before the change.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
