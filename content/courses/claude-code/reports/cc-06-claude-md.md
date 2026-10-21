# Report: claude-code/cc-06-claude-md (published)

**Status: PUBLISHED in course `claude-code` (lessons/ and course.json, on the owner's instruction, 2026-10-21). Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:e4875adb69003830.**

- Title: 第6回｜CLAUDE.mdで前提を伝える
- Lesson: `content/courses/claude-code/lessons/cc-06-claude-md.lesson.json` · brief: `content/courses/claude-code/briefs/cc-06-claude-md.md`
- Level: intermediate · estMinutes 19 · locale jp (Japanese only) · courseId `claude-code`
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. Reviews: see the gate below.

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | apply | 指示の置き場所（CLAUDE.md・.claude/rules/・CLAUDE.local.md・権限ルール）を、内容に合わせて選べる | q4, e1, e2 |
| o2 | evaluate | 長すぎるCLAUDE.mdを、短く具体的で確かめられる指示に改善できる | q2, q3, e3 |
| o3 | understand | CLAUDE.mdに書いても強制にはならない理由を説明できる | q0 (predict), q5, e6 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：毎回の説明と、守られない決まり |
| s1 | concept | 6-1. CLAUDE.mdは毎回最初に読まれる |
| s2 | concept | 6-2. 短く、具体的に、確かめられるように |
| s3 | concept | 6-3. 分けて育てる：インポートとルール |
| s4 | concept | 6-4. 書いても強制にはならない |
| s5 | example | 6-5. 例題：気になる6行を仕分ける |
| practice | practice | 演習：膨らんだCLAUDE.mdを書き直す |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 2399 (budget 1,200–2,400) · read 3714 · practice reading 1363 · questions 9 · practice sections 1 · est 19.3 min (must be ≤ 20; estMinutes 19)`

## Gate (current draft)

```
Review of cc-06-claude-md by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/claude-code/lessons/cc-06-claude-md.lesson.json (sha256:e4875adb69003830)
  ja-editor: full review
  pedagogy-reviewer: full review
  visual-qa: full review
  mean 3.38 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      3  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer)
  ✓ prior      3  (ja-editor, pedagogy-reviewer)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     3  (pedagogy-reviewer)
  ✓ miscon     3  (pedagogy-reviewer)
  ✓ visual     3  (pedagogy-reviewer, visual-qa)
  ✓ practice   4  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer)
  ✓ accuracy   4  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor, pedagogy-reviewer, visual-qa)
```

## Review rounds (local snapshots in `.artifacts/review/claude-code/cc-06-claude-md/`, one line per lesson version and round; the reviews the gate counts are the committed ones in this folder)

1. `77b9fd93b84c6577/round-1`: ja-editor full revise (mean 3.50, must-fix 16); pedagogy-reviewer full revise (mean 3.08, must-fix 9)
2. `5e95f5eafa612ea0/round-1`: ja-editor full revise (mean 3.25, must-fix 4); pedagogy-reviewer full pass (mean 3.31, must-fix 0)
3. `0913750984346c84/round-1`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer full pass (mean 3.46, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
4. `2b49a5e74f15af83/round-1`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
5. `2b49a5e74f15af83/round-2`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer full pass (mean 3.46, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
6. `a2581804ebc9fe6d/round-1`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer verify pass (mean 3.38, must-fix 0); visual-qa full revise (mean 3.00, must-fix 2)
7. `6b93b57324d9ed64/round-1`: ja-editor verify revise (mean 3.25, must-fix 1); pedagogy-reviewer verify revise (mean 3.23, must-fix 1); visual-qa full revise (mean 2.67, must-fix 4)
8. `e4875adb69003830/round-1`: ja-editor verify pass (mean 3.50, must-fix 0); pedagogy-reviewer full pass (mean 3.46, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
9. `e4875adb69003830/round-2`: ja-editor full pass (mean 3.50, must-fix 0); pedagogy-reviewer full pass (mean 3.46, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 60 claims (pages: 14); a second checker tried to refute each finding. Confirmed and fixed: 5. Refuted (text kept): 1.

- [overclaim] `s3-defs` (items[2] (AGENTS.md).md): ほかのAIコーディングツールと共有する指示のファイル。v2.1.277以降、CLAUDE.mdもCLAUDE.local.mdもないときに、代わりに読まれます。 — https://code.claude.com/docs/en/memory
- [overclaim] `summary-cards` (cards[card-agents].back): CLAUDE.mdもCLAUDE.local.mdもないときです（v2.1.277以降）。共有するなら、CLAUDE.mdに `@AGENTS.md` と書きます。 — https://code.claude.com/docs/en/memory
- [overclaim] `glossary` (glossary[AGENTS.md].md): ほかのAIコーディングツールと共有する指示のファイル。CLAUDE.md・`.claude/CLAUDE.md`・CLAUDE.local.mdのどれもないときに、代わりに読まれます（v2.1.277以降）。 — https://code.claude.com/docs/en/memory
- [overclaim] `s3-check` (questions[q4].explanation (2nd sentence)): `cat` などのコマンドで中身を見たときも同じです。 — https://code.claude.com/docs/en/tools-reference
- [overclaim] `summary-cards` (cards[card-paths].back): Claudeが一致するファイルに `Read`・`Write`・`Edit` ツールを使うときです。`cat` などで中身を見たときも読まれます。 — https://code.claude.com/docs/en/memory

Records: `content/courses/claude-code/reports/facts/cc-06-claude-md.audit.json` and `cc-06-claude-md.facts.md`.

## Screenshots

`npm run lessons:preview -- claude-code cc-06-claude-md --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/claude-code/cc-06-claude-md/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- cc-06-claude-md: the gate mean was 3.15 with carried pedagogy scores. After the fixes aimed at those criteria, a FULL pedagogy review re-scored every criterion (mean 3.38 at the gate).
- Cross-lesson consistency round (2026-10-21): the changed lessons cc-01-first-session, cc-02-permissions, cc-04-verify, cc-06-claude-md, cc-08-hooks-mcp, cc-09-parallel-automation, cc-10-safety-cost and cc-11-capstone were re-reviewed (visual QA full on a fresh preview; pedagogy-reviewer and ja-editor verification). For cc-02-permissions, cc-06-claude-md, cc-10-safety-cost and cc-11-capstone the gate refused the set because one reviewer's chain started at its earlier full review while the other's went further back ("no reviewer skips a round"); that reviewer then reviewed the final version in full.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
