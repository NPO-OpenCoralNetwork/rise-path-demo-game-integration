# Report: vibe-coding/cc-05-context (draft)

**Status: DRAFT, not published, not listed in `course.json`. Gate: PASS (`check-review.mjs` over ja-editor, pedagogy-reviewer, visual-qa). Lesson hash sha256:7a183d3f582412d5.**

- Title: 第5回｜コンテキストを管理する
- Draft: `content/courses/vibe-coding/drafts/cc-05-context.lesson.json` · brief: `content/courses/vibe-coding/briefs/cc-05-context.md`
- Level: intermediate · estMinutes 20 · locale jp (Japanese only) · courseId `vibe-coding` (preview course; publishing is the owner's call)
- Provenance: author `claude-code`, skill `author-lesson`, generatedAt 2026-10-20. No `reviewedBy` (set when the owner publishes).

## Objectives

| id | bloom | text | assessed by |
|---|---|---|---|
| o1 | analyze | セッションの失敗パターンを見分け、/clear・/compact・サブエージェントから対処を選べる | q2, q4, p1, p2, p3, e1 |
| o2 | understand | コンテキスト圧縮のあとに残るものと失われるものを説明できる | q0 (predict), q3, e3, e4 |
| o3 | apply | /context でコンテキストの使用量を確かめられる | q1, e5 |

## Sections

| id | role | title |
|---|---|---|
| hook | hook | はじめに：午後になると、朝の指示が効かなくなる |
| 5-1 | concept | 5-1. コンテキストは埋まるほど効きが落ちる |
| 5-2 | concept | 5-2. 区切るか、要約するか |
| 5-3 | concept | 5-3. 圧縮のあとに残るもの、失われうるもの |
| 5-4 | concept | 5-4. コンテキストに関わる3つの失敗パターン |
| 5-5 | example | 5-5. 例題：言い直しの続く会話を立て直す |
| practice | practice | 演習：セッションを診断し、圧縮を試す |
| check | check | 理解度チェック |
| summary | summary | まとめ |

## Checks on the current draft

- validate: 1 lesson file, 0 course files: no errors.
- lint --strict: 1 lesson file: 0 errors, 0 warnings.
- course length measure: `prose 1945 (budget 1,200–2,400) · read 3289 · practice reading 1126 · questions 12 · practice sections 1 · est 19.8 min (must be ≤ 20; estMinutes 20)`

## Gate (current draft)

```
Review of cc-05-context by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/drafts/cc-05-context.lesson.json (sha256:7a183d3f582412d5)
  ja-editor: verification of sha256:e51506cc1e6117ed (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-05-context/e51506cc1e6117ed/lesson.json) · 0 resolved, 0 unresolved · 1 changed · carried over: load, prior, a11y_l10n · previous .artifacts/review/vibe-coding/cc-05-context/e51506cc1e6117ed/round-1/ja-editor.review.json and 5 earlier rounds checked
  pedagogy-reviewer: verification of sha256:e51506cc1e6117ed (previous review cross-checked; scope recomputed from .artifacts/review/vibe-coding/cc-05-context/e51506cc1e6117ed/lesson.json) · 0 resolved, 0 unresolved · 1 changed · carried over: align, hook, prior, worked, active, miscon, visual, meta, accuracy, voice, a11y_l10n · previous .artifacts/review/vibe-coding/cc-05-context/e51506cc1e6117ed/round-1/pedagogy-reviewer.review.json and 5 earlier rounds checked
  visual-qa: full review
  mean 3.46 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      3  (ja-editor carried, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor carried, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     4  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer carried)
  ✓ visual     4  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   3  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   3  (pedagogy-reviewer carried)
  ✓ voice      3  (ja-editor, pedagogy-reviewer carried)
  ✓ a11y_l10n  3  (ja-editor carried, pedagogy-reviewer carried, visual-qa)
```

## Review rounds (snapshots in `.artifacts/review/vibe-coding/cc-05-context/`)

1. `97684549e204b6ab`: ja-editor full revise (mean 3.50, must-fix 8); pedagogy-reviewer full revise (mean 3.15, must-fix 5)
2. `a5c974718e314f36`: ja-editor full revise (mean 3.75, must-fix 1); pedagogy-reviewer full revise (mean 3.38, must-fix 1)
3. `ad13e1245e9cc670`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0)
4. `319f5a2007903c95`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0)
5. `1a611951e0d6a3f3`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify revise (mean 3.46, must-fix 1); visual-qa full pass (mean 4.00, must-fix 0)
6. `2597b7828fdf4777`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)
7. `e51506cc1e6117ed`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full revise (mean 3.33, must-fix 1)
8. `7a183d3f582412d5`: ja-editor verify pass (mean 3.75, must-fix 0); pedagogy-reviewer verify pass (mean 3.46, must-fix 0); visual-qa full pass (mean 3.67, must-fix 0)

## Fact audit against the official docs (2026-10-20)

An auditor with web access checked 60 claims (pages: 18); a second checker tried to refute each finding. Confirmed and fixed: 5. Refuted (text kept): 1.

- [overclaim] `pr-diagnose` (p2.options.d.feedback): 自動の圧縮では、何を残すかを自分で選べません。区切りのよいところで焦点を付けて要約すると、大事なことを残せます。 — https://code.claude.com/docs/en/how-claude-code-works
- [overclaim] `check-quiz` (e4.options.b.feedback): 自動の圧縮はいつ起きるかを選べないので、言い直しは漏れやすくなります。 — https://code.claude.com/docs/en/commands
- [overclaim] `s3-lead` (md (last sentence)): ファイルに書いた指示は、ディスクから読み直されます。 — https://code.claude.com/docs/en/context-window
- [wrong] `pr-steps-start` (pr-start.expect): Claude Codeの入力欄が表示されます。 — https://code.claude.com/docs/en/security
- [overclaim] `s2-session` (md (last sentence)): 開き直すと、前のコンテキストもそのまま戻ります。 — https://code.claude.com/docs/en/sessions

## Screenshots

`npm run lessons:preview -- vibe-coding cc-05-context --shots desktop-jp,mobile-jp` on a fresh no-HMR dev server; PNGs and `metrics.json` in `.artifacts/preview/vibe-coding/cc-05-context/` (gitignored). The visual-qa review above was made from these screenshots.

## Orchestrator notes

- 2026-10-20T22:07:03Z cc-05 ja-editor verify review: resolved[0].criterion was missing; filled with "voice" from the round's only previous must-fix (voice/s5-check). No other field changed.
- cc-05 snapshot .artifacts/.../ad13e1245e9cc670/round-1/ja-editor.review.json was taken before the criterion fill; applied the same fill to the snapshot copy.
  ja-editor reviews of the final versions of cc-02, cc-05 and cc-10; the gate result reported is the one with those.

## Course-wide conventions used

See `doc/brushup-2026/research/claude-code-curriculum.ja.md` §9.2: body length by the course measure, 2-column tables, narrow diagrams, no markdown in plain-text fields, answer positions spread.
