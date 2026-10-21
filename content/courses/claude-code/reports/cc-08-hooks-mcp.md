# Report: claude-code/cc-08-hooks-mcp (published)

**Status: PUBLISHED in course `claude-code` (lessons/ and course.json, on the owner's instruction, 2026-10-21). Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:02bb8902d1916464.**

- Title: 第8回｜フックで守らせ、MCPでつなぐ
- Lesson: `content/courses/claude-code/lessons/cc-08-hooks-mcp.lesson.json` · brief: `content/courses/claude-code/briefs/cc-08-hooks-mcp.md`
- Level: intermediate · estMinutes 18 · locale jp (Japanese only) · courseId `claude-code`
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. Reviews: see the gate below.

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | apply | PreToolUseフックで特定の操作を止める設定を書ける | q0 (predict), q1, q2, q5 |
| o2 | understand | フックの終了コードによってClaude Codeの動きがどう変わるかを説明できる | q3, q6, q7 |
| o3 | evaluate | MCPサーバーやプラグインを入れる前に、出どころ・実行されるもの・権限を確かめ、入れてよいかを判断できる | q4, q9, q8 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：「.envは編集しないで」が守られない |
| s1 | concept | 8-1. フック：お願いではなく、必ず動く仕組み |
| s2 | example | 8-2. 例題：rmで始まるコマンドを止める |
| s3 | concept | 8-3. 終了コードで、Claude Codeの動きが変わる |
| s4 | concept | 8-4. MCPで外のツールにつなぐ |
| s5 | concept | 8-5. プラグインは、入れる前に確かめる |
| practice | practice | 演習：.envを守るフックを作り、つなぐ候補を見極める |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 1897 (budget 1,200–2,400) · read 2883 · practice reading 1249 · questions 10 · practice sections 1 · est 17.8 min (must be ≤ 20; estMinutes 18)`

## Gate (current draft)

```
Review of cc-08-hooks-mcp by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/claude-code/lessons/cc-08-hooks-mcp.lesson.json (sha256:02bb8902d1916464)
  ja-editor: full review
  pedagogy-reviewer: full review
  visual-qa: full review
  mean 3.85 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer)
  ✓ prior      4  (ja-editor, pedagogy-reviewer)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     4  (pedagogy-reviewer)
  ✓ active     4  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     4  (pedagogy-reviewer, visual-qa)
  ✓ practice   4  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer)
  ✓ accuracy   4  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor, pedagogy-reviewer, visual-qa)
```

## Review rounds (local snapshots in `.artifacts/review/claude-code/cc-08-hooks-mcp/`, one line per lesson version and round; the reviews the gate counts are the committed ones in this folder)

1. `aa4125dd945c908e/round-1`: ja-editor full revise (mean 3.50, must-fix 8); pedagogy-reviewer full revise (mean 3.08, must-fix 5)
2. `876f9427367ec7c6/round-1`: ja-editor full revise (mean 3.75, must-fix 4); pedagogy-reviewer full revise (mean 3.15, must-fix 2)
3. `01fa366fee4752fb/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.77, must-fix 0); visual-qa full revise (mean 3.33, must-fix 1)
4. `112a650daf9ca3d0/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.85, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
5. `542dc5e44070249d/round-1`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full revise (mean 3.62, must-fix 1); visual-qa full revise (mean 3.00, must-fix 2)
6. `dc1fce75fb87584d/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.85, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
7. `4e07cfeed4cb390f/round-1`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full revise (mean 3.54, must-fix 1); visual-qa full revise (mean 3.00, must-fix 3)
8. `02bb8902d1916464/round-1`: ja-editor verify pass (mean 4.00, must-fix 0); pedagogy-reviewer verify pass (mean 3.85, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
9. `02bb8902d1916464/round-2`: ja-editor full pass (mean 4.00, must-fix 0); pedagogy-reviewer full pass (mean 3.92, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 55 claims (pages: 21); a second checker tried to refute each finding. Confirmed and fixed: 5. Refuted (text kept): 1.

- [overclaim] `s3-pitfall` (md (the same unconditional claim also appears in s3-table row 3, q3 answer b, q5 option b feedback, card-exit1 back and summary-points[1])): Unixの習慣で `exit 1` を返しても、フックでは止まりません。止めるときは `exit 2` です。 — https://code.claude.com/docs/en/hooks
- [overclaim] `check-quiz` (q6 option d feedback): フックの `exit 2` で、セッションが止まることはありません。Claudeは届いた指摘を読んで、作業を続けます。 — https://code.claude.com/docs/en/hooks
- [overclaim] `check-quiz` (q6 prompt (it makes answer a and the explanation depend on stderr, which the prompt never mentions)): 編集のたびにリンター（linter）を走らせる `PostToolUse` フックが、問題を見つけると `exit 2` で終わります。 (answer a: 編集は済み、リンターの指摘がClaudeに届く) — https://code.claude.com/docs/en/hooks
- [wrong] `s1-config` (md; the same claim is in summary-cards card-three-levels back): フックは設定ファイルに、イベント → マッチャー → コマンドの3段で書きます。 / イベント → マッチャー → 実行するコマンド。 — https://code.claude.com/docs/en/hooks
- [unsupported] `practice-steps` (p-script expect; also practice-checklist pc-hooks label): `/hooks` に、マッチャー `Edit|Write` のフックが出ます。 / /hooks の PreToolUse に、マッチャー Edit|Write のフックが表示されました — https://code.claude.com/docs/en/hooks

Records: `content/courses/claude-code/reports/facts/cc-08-hooks-mcp.audit.json` and `cc-08-hooks-mcp.facts.md`.

## Screenshots

`npm run lessons:preview -- claude-code cc-08-hooks-mcp --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/claude-code/cc-08-hooks-mcp/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- Last small fixes made by the orchestrator from the reviewers' exact fix texts (cc-02 e6 d, cc-03 step titles, cc-05 pr-code, cc-08 q9 and practice-b-task, cc-09 e3 d, cc-11 dr-table), then re-reviewed by visual-qa, pedagogy-reviewer and ja-editor.
- cc-08-hooks-mcp ja-editor verification of 01fa366fee4752fb returned invalid JSON (a trailing comma). It was not saved or repaired; the same verification was re-run.
- Cross-lesson consistency round (2026-10-21): the changed lessons cc-01-first-session, cc-02-permissions, cc-04-verify, cc-06-claude-md, cc-08-hooks-mcp, cc-09-parallel-automation, cc-10-safety-cost and cc-11-capstone were re-reviewed (visual QA full on a fresh preview; pedagogy-reviewer and ja-editor verification). For cc-02-permissions, cc-06-claude-md, cc-10-safety-cost and cc-11-capstone the gate refused the set because one reviewer's chain started at its earlier full review while the other's went further back ("no reviewer skips a round"); that reviewer then reviewed the final version in full.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
