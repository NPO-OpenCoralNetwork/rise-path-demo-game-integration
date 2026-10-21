# Report: vibe-coding/cc-02-permissions (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:fc6282d1f851b02f.**

- Title: 第2回｜任せる範囲を決める：権限モードと巻き戻し
- Draft: `content/courses/vibe-coding/drafts/cc-02-permissions.lesson.json` · brief: `content/courses/vibe-coding/briefs/cc-02-permissions.md`
- Level: beginner · estMinutes 20 · locale jp (Japanese only) · courseId `vibe-coding` (preview course; publishing is the owner's call)
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. No `reviewedBy` (set when the owner publishes).

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | apply | 場面に合う権限モードを選べる | q1, q2, ps1, ps2, e1 |
| o2 | analyze | /rewind で戻せるものと戻せないものを見分けられる | q5, e3, e4 |
| o3 | apply | git push の前に確認を挟む確認ルール（ask）を書ける | q0 (predict), q3, q4, e5, e6 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：確認は減らしたい、でもpushは止めたい |
| modes | concept | 2-1. 権限モードで、確認なしに進める範囲を選ぶ |
| auto-mode | concept | 2-2. autoモードに任せてよいこと、よくないこと |
| rules | concept | 2-3. 権限ルールで「この操作だけは」を決める |
| rules-example | example | 2-4. 例題：pushの前に確認を挟む設定を書く |
| rewind | concept | 2-5. チェックポイントと /rewind：戻せるもの、戻せないもの |
| practice-sort | practice | 演習1：場面ごとに権限モードを選ぶ |
| practice-rules | practice | 演習2：ルールを試し、巻き戻しも確かめる |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 2222 (budget 1,200–2,400) · read 2466 · practice reading 801 · questions 13 · practice sections 2 · est 19.9 min (must be ≤ 20; estMinutes 20)`

## Gate (current draft)

```
Review of cc-02-permissions by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-02-permissions.lesson.json (sha256:fc6282d1f851b02f)
  ja-editor: full review
  pedagogy-reviewer: verification of sha256:53b74995ba36c9df (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-02-permissions/53b74995ba36c9df/lesson.json) · 0 resolved, 0 unresolved · 1 changed · carried over: hook, prior, load, worked, active, visual, practice, meta, accuracy, a11y_l10n · previous .artifacts/review/vibe-coding/cc-02-permissions/53b74995ba36c9df/round-1/pedagogy-reviewer.review.json and 1 earlier round checked
  visual-qa: full review
  mean 3.38 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      3  (ja-editor, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor, pedagogy-reviewer carried, visual-qa)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     3  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     4  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   3  (pedagogy-reviewer carried)
  ✓ meta       3  (pedagogy-reviewer carried)
  ✓ accuracy   4  (pedagogy-reviewer carried)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  3  (ja-editor, pedagogy-reviewer carried, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-02-permissions/`)

1. `44ecfdc66d172d2b`: ja-editor full revise (mean 2.75, must-fix 10); pedagogy-reviewer full revise (mean 2.92, must-fix 4)
2. `e9a914f94df54f03`: ja-editor full revise (mean 3.50, must-fix 1); pedagogy-reviewer full pass (mean 3.31, must-fix 0)
3. `6d79b8134ac7e198`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.31, must-fix 0); visual-qa full revise (mean 2.67, must-fix 3)
4. `95d0a505f30641a5`: ja-editor full pass (mean 3.50, must-fix 0); pedagogy-reviewer full pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.00, must-fix 4)
5. `53b74995ba36c9df`: ja-editor verify fail (mean 3.50, must-fix 1); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
6. `fc6282d1f851b02f`: ja-editor full pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 74 claims (pages: 14); a second checker tried to refute each finding. Confirmed and fixed: 12. Refuted (text kept): 0.

- [wrong] `check-quiz` (e5.prompt (answer c)): `.claude/settings.json` の `ask` に `Bash(git push *)` だけを書きました。Claude が次のコマンドを実行しようとしたとき、確認の画面が出ないのはどれでしょう？ — https://code.claude.com/docs/en/permissions
- [overclaim] `example-pitfall` (md, first sentence): `git -C . push` は `git push` で始まらないので、確認が出ません。 — https://code.claude.com/docs/en/permissions
- [overclaim] `rules-defs` (items[確認ルール].md): 一致した操作の前に、必ず確認を求めます。auto モードでも同じです。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `glossary` (glossary[確認ルール].md): 一致した操作の前に、必ず確認を求める権限ルール（ask）。auto モードでも確認が出る。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `rewind-check` (q5.options[c].feedback): push の前に確認ルールで止めるのが確実です。 — https://code.claude.com/docs/en/auto-mode-config
- [overclaim] `hook-predict` (q0.explanation, last sentence): push の前に必ず止める書き方は、2-4 で学びます。 — https://code.claude.com/docs/en/auto-mode-config
- [overclaim] `summary-cards` (card-ask.front): push の前に必ず確認を挟むルールは？ — https://code.claude.com/docs/en/auto-mode-config
- [overclaim] `example-check` (q4.options[d].feedback, second sentence): `git push origin main` には一致せず、確認が出ません。 — https://code.claude.com/docs/en/permissions
- [overclaim] `check-quiz` (e6.options[c].feedback, second sentence): `gh pr create --title …` のように続きがあると、確認が出ません。 — https://code.claude.com/docs/en/auto-mode-config
- [overclaim] `check-quiz` (e2.options[a].feedback, second sentence): コマンドのたびに確認も出ます。 — https://code.claude.com/docs/en/permission-modes
- [overclaim] `sort-quiz` (ps2.explanation, second sentence): それ以外のコマンドでは確認が出ます。 — https://code.claude.com/docs/en/permissions
- [overclaim] `sort-quiz` (ps1.explanation, first sentence): `dontAsk` モードは、事前に許可したツールだけを動かし、ほかはすべて拒否します。 — https://code.claude.com/docs/en/permission-modes

## Screenshots

`npm run lessons:preview -- vibe-coding cc-02-permissions --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-02-permissions/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- cc-02 ja-editor round-2 full review: verdict "fail" is not a schema value; set to "revise" (the review has 1 must-fix). No other field changed.
- cc-02 snapshot e9a914f94df54f03/round-1/ja-editor.review.json: same verdict fail->revise fix applied to the snapshot copy.
  criterion fill, cc-10 and cc-02 verdict fail->revise, plus their snapshot copies) are superseded by fresh FULL
- cc-02-permissions ja-editor verification of 53b74995ba36c9df returned verdict "fail" (not a schema value). It was not edited; after the fix a fresh FULL ja-editor review of the final version was run instead.
- Last small fixes made by the orchestrator from the reviewers' exact fix texts (cc-02 e6 d, cc-03 step titles, cc-05 pr-code, cc-08 q9 and practice-b-task, cc-09 e3 d, cc-11 dr-table), then re-reviewed by visual-qa, pedagogy-reviewer and ja-editor.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
