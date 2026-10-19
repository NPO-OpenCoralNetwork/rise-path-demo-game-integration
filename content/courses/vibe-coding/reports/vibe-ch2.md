# Report: vibe-coding/vibe-ch2 (draft)

**Status: DRAFT, not published. Final gate (2026-10-19): REVISE, `check-review.mjs` exits 1.** The draft is
`content/courses/vibe-coding/drafts/vibe-ch2.lesson.json`. `lessons/`, `course.json` and `provenance.reviewedBy` are
untouched. Publishing (author-lesson step 10) is the owner's call.

The saved review JSONs are the round-6 reviews, and they describe the draft *before* the round-6 fixes. The rubric
numbers pass: every criterion is ≥ 3 and the mean is 3.38. The gate fails only on 4 ja-editor must-fix items. The final
gate confirmed that all 4 are in the current draft (see "Final gate"). Only a fresh independent review can clear
them from the JSON, so by the contract the lesson is not "done" until that review makes `check-review.mjs` exit 0.

- Lesson: 第2章｜AIと企画する力を身につける / Chapter 2 | Planning with AI. Rework of the migrated chapter
  `data/curricula/vibe_coding/chapter2.ts` (`VIBE_CHAPTER_2_DATA`). `provenance.migratedFrom` is kept and the author
  is `claude-code`, so the lesson is linted strict.
- Locales: jp, en. Level: beginner. Prerequisites: ch0 and ch1.
- estMinutes: **18** in the draft. `course.json` still lists 30; changing it is the owner's call.
- In round 4 the hands-on practice moved to its own draft, `drafts/vibe-ch2-practice.lesson.json`. Its report is
  `reports/vibe-ch2-practice.md`.
- Brief, outline and the per-round notes: `content/courses/vibe-coding/briefs/vibe-ch2.md`.

## Objectives (current draft)

| id | bloom | jp | assessed by |
|---|---|---|---|
| o1 | apply | ぼんやりしたアイデアを、AIに質問してもらう依頼文に書き換え、壁打ちに使える | q1 (inline), q5 (exam, transfer) |
| o2 | analyze | アイデアの中から「目的」と「機能」を見分け、機能の奥にある目的を聞き出せる | q0 (predict, ungraded), q2 (inline), q6 (exam) |
| o3 | evaluate | 機能の候補をMoSCoWで分け、最初の版（MVP）に入れる範囲を判断できる | q3 (inline), q7 (exam, transfer) |
| o4 | evaluate | 目的から「やらないこと」までの1枚企画書を読み返し、直すところと直し方を判断できる | q4 (inline), q8, q10, q9 (exam) |

- o1 was reworded in round 3 (ja-editor must-fix). The EN text is now "Rewrite a vague idea as a request for the AI to
  interview you, and use it to talk the idea through".
- o4 moved from create to evaluate in round 4, because "build your own plan" now lives in `vibe-ch2-practice`
  (its o4, create).

## Final gate (2026-10-19)

Where this section disagrees with older sections of this report, this section wins.

### Merged review table and verdict

`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2.pedagogy-reviewer.review.json content/courses/vibe-coding/reports/vibe-ch2.ja-editor.review.json content/courses/vibe-coding/reports/vibe-ch2.visual-qa.review.json`
gives **REVISE, exit 1**. The table shows the lowest score per criterion from the saved round-6 reviews.

| criterion | score | scored by |
|---|---|---|
| align | 3 | pedagogy-reviewer |
| hook | 4 | pedagogy-reviewer |
| prior | 4 | pedagogy-reviewer, ja-editor |
| load | 3 | pedagogy-reviewer, ja-editor, visual-qa |
| worked | 3 | pedagogy-reviewer |
| active | 4 | pedagogy-reviewer |
| miscon | 3 | pedagogy-reviewer |
| visual | 4 | pedagogy-reviewer, visual-qa |
| practice | 3 | pedagogy-reviewer |
| meta | 4 | pedagogy-reviewer |
| accuracy | 3 | pedagogy-reviewer |
| voice | 3 | pedagogy-reviewer, ja-editor |
| a11y_l10n | 3 | pedagogy-reviewer, ja-editor, visual-qa |
| **mean** | **3.38** (needs ≥ 3.3; every criterion ≥ 3) | blocker: 4 open must-fix items in the saved JSON |

### Must-fix items checked against the current draft

The gate checked each item by string search in the draft JSON: the suggested new text is present, and the old text
(where the reviewer quoted one) is gone. All 4 items pass.

| # | reviewer · criterion · block | found in the draft |
|---|---|---|
| 1 | ja-editor · a11y_l10n · `s1-b1` | 「ビジョン（vision）を示すこと」 |
| 2 | ja-editor · voice · `s5-b3` (EN) | "Only the features the goal can't do without become Musts." The old "make only the things it couldn't be met without into Musts" is gone. |
| 3 | ja-editor · voice · q1 a feedback (EN) | "Asking about features gets you a list of features before the goal is set." The old wording is gone. |
| 4 | ja-editor · voice · q5 c feedback (EN) | "Starting with which features are needed skips past the goal." The old wording is gone. |

### Verdict history

| round | reviewers | merged mean | lowest criterion | open must-fix | gate (before fixes) |
|---|---|---|---|---|---|
| 1 | pedagogy-reviewer, ja-editor | 3.15 | 3 (several) | 15 (12 ja-editor, 3 pedagogy) | REVISE, exit 1 (mean < 3.3, must-fix open) |
| 2 | pedagogy-reviewer, ja-editor | 3.46 | 3 | 10 (8 ja-editor, 2 pedagogy) | REVISE, exit 1 (must-fix open only) |
| 3 | pedagogy-reviewer (pass, 3.46), ja-editor (revise, 3.25), visual-qa (revise) | 3.38 | 3 | 9 (7 ja-editor, 2 visual-qa) | REVISE, exit 1 (must-fix open only) |
| 4 | no new review | — | — | — | Fix-only round: the practice was split out, and length, Budget Must, ja-editor and niceToHave items were applied |
| 5 (workflow round 1) | pedagogy-reviewer, ja-editor, visual-qa | 3.23 | 3 | 9 (5 ja-editor, 3 pedagogy, 1 visual-qa) | REVISE, exit 1 (mean < 3.3, must-fix open) |
| 6 (workflow round 2) | pedagogy-reviewer (pass, 3.46), ja-editor (revise), visual-qa (pass, 4) | 3.38 | 3 | 4 (ja-editor) | REVISE, exit 1 (must-fix open only) |
| final gate | saved round-6 JSON | 3.38 | 3 | 4, all found applied in the draft | **REVISE, exit 1**: a fresh review is needed to clear the JSON |

### Length and time

| measure (JP characters, whitespace not counted) | before the split (round 3) | now |
|---|---|---|
| Body: prose, without quizzes or copyable prompt text | 3,623 | **2,390** (budget 2,400) |
| Body plus prompt model answers and hints | 4,587 | 2,742 |
| All non-quiz text | 5,807 | 3,679 |
| estMinutes | 30 | **18** (contract estimate 15.5) |

The lesson has 11 questions: q0 is an ungraded predict, q1–q4 are inline, and q5–q10 make up the 6-question exam.
The summary has 4 points and there are 6 flashcards.

### CI steps and checks (run at the final gate)

| command | result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` | 654 tests, 654 pass, 0 fail |
| `npm run lessons:validate` | 13 lesson files, 1 course file: no errors |
| `npm run lessons:validate -- --drafts` | 15 lesson files, 1 course file: no errors |
| `npm run lessons:lint -- --strict` | exit 0, 0 errors. 81 advisory warnings, all in 11 migrated-unreviewed published lessons, none of which this branch touches. |
| `lessons:validate` / `lessons:lint --strict` on this draft | 0 errors · 0 errors, 0 warnings |
| `npm run lessons:schema -- --check` | generated schemas up to date |
| `node .claude/skills/author-lesson/scripts/build-references.mjs --check` | references up to date |
| `npx vite build` | not needed: no code changed |

### Preview metrics

The preview `metrics.json` has `generatedAt` 2026-10-19T09:43:22Z, after the last draft edit at 09:39Z.

- Status: OK, `overflowX: false`, `consoleErrors: 0`, `mermaidErrors: 0`, `unknownBlocks: 0`, `brokenImages: 0`.
- No text-only screens.
- 21 failed `/api/v2/user/*` requests (503, no database) are environment noise and are not counted.

| shot | viewport | page height | screens | chars/line median (min–max) |
|---|---|---|---|---|
| desktop-jp | 1440×900 | 13,324 px | 16 | 37 (35–42), target 30–40 |
| mobile-jp | 390×844 | 17,559 px | 25 | 19 (16–22) |
| desktop-en | 1440×900 | 13,985 px | 17 | 73 (66–78), target 60–75 |

The screenshots are in `.artifacts/preview/vibe-coding/vibe-ch2/`, which is gitignored and local only. The gate
checked two pages by eye:
- `pages/mobile-jp-09.png`: the two-column MoSCoW table. Each 分類 label fits on one line, and each 意味 cell starts
  with 必須 / 重要 / あるとよい / 今回やらない.
- `pages/desktop-jp-13.png`: the q8 options, the q10 stem and the next-lesson card.

### Open questions for the owner

1. **Fresh review round.** Should a review round (pedagogy-reviewer, ja-editor, visual-qa) run on the current draft?
   The gate can only pass once the saved JSONs describe this draft and `check-review.mjs` exits 0.
2. **List `vibe-ch2-practice` in `course.json`?** It would go in module m2 after `vibe-ch2`, with estMinutes 20 and
   the `next` links updated. vibe-ch2's estMinutes there would change from 30 to 18. If you reject the split, the
   practice section goes back into vibe-ch2 and a length waiver is recorded in the brief.
3. **Publish both?** Once they pass, should both drafts move to `lessons/`, followed by `course.json` and
   `lessons:catalog`? `lessons/vibe-ch2.lesson.json` is still the machine-migrated chapter (author `migration`).
4. **VS Code or VSCode?** `course.json` and the published ch3, ch4, ch6 and ch11 write 「VSCode」. The ch2 drafts
   write 「VS Code」, Microsoft's own short name. As a result, ch2's next-lesson card (from `course.json`) and its body
   spell it differently. Which spelling should the course use?
5. **Reader-level items** (outside the lesson files):
   - On touch screens the flashcard hint should read 「タップでめくる」.
   - Prompt blocks with `target: "any"` show a 「Claude Codeで使う」 button before ch3.
   - The end card of an unlisted draft preview says the course is finished.

## History: round 3 and earlier

The sections from here to "Round 5" describe the draft as it was after round 3, before the split. Where they
disagree with "Final gate" (for example estMinutes 30, o4 create, the practice section, the old table layout), the
final gate is current.

### Merged review table (saved round-3 reviews, lowest score per criterion)

`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2.*.review.json`

| criterion | score | scored by |
|---|---|---|
| align | 4 | pedagogy-reviewer |
| hook | 4 | pedagogy-reviewer |
| prior | 3 | ja-editor (4), pedagogy-reviewer (3) |
| load | 3 | ja-editor, pedagogy-reviewer, visual-qa |
| worked | 3 | pedagogy-reviewer |
| active | 3 | pedagogy-reviewer |
| miscon | 4 | pedagogy-reviewer |
| visual | 3 | pedagogy-reviewer (4), visual-qa (3) |
| practice | 3 | pedagogy-reviewer |
| meta | 4 | pedagogy-reviewer |
| accuracy | 4 | pedagogy-reviewer |
| voice | 3 | ja-editor, pedagogy-reviewer |
| a11y_l10n | 3 | ja-editor, pedagogy-reviewer, visual-qa |
| **mean** | **3.38** (needs ≥ 3.3; every criterion ≥ 3) | verdict **REVISE**: 9 must-fix items are still listed in the saved JSON |

Review files:
- `content/courses/vibe-coding/reports/vibe-ch2.pedagogy-reviewer.review.json`
- `content/courses/vibe-coding/reports/vibe-ch2.ja-editor.review.json`
- `content/courses/vibe-coding/reports/vibe-ch2.visual-qa.review.json`

## Round 3 must-fix items and how they were resolved

| # | reviewer · criterion · block | issue | resolution in the draft |
|---|---|---|---|
| 1 | ja-editor · voice · `o1` | 「依頼文（壁打ち）」 equated the request with the activity | 「ぼんやりしたアイデアを、AIに質問してもらう依頼文に書き換え、壁打ちに使える」, as the reviewer wrote it. EN reworded to match. Also shows in the objectives box and the reflection. |
| 2 | ja-editor · voice · `s2-why` | 「[[機能]]を言われたら」 was unnatural | 「ほしい[[機能]]が出てきたら、「なぜそれがほしいの？」と1回聞き返します。」 |
| 3 | ja-editor · voice · `practice-prompt` | The expect text ran several noun endings together | 「自分の分け方：…締め切り前日の通知です。Couldはひとことコメント欄、Won'tは参加費の集金です。」 and 「理由の例：通知は「返事を忘れる人がいるから」、集金は「お金を扱うので、今回は作らない」です。」, as written. |
| 4 | ja-editor · load · `q4` | The explanation had 4 sentences, and 「こと」 appeared twice | Now 3 sentences, ending 「Claude Codeの公式ガイドも、よい仕様書（企画書のような文書）の条件として、範囲外を書くことを挙げています。」 EN: "The official Claude Code guide also lists stating what is out of scope as a mark of a good spec (a document like this plan)." The source was re-checked on 2026-10-19 (quote under Sources). |
| 5 | ja-editor · prior · glossary 目的 | The glossary used plain form and different wording from `s2-defs` | 「…「誰が・どんな場面で・どうなれる」の形で1文に書きます。」 EN aligned with `s2-defs`. |
| 6 | ja-editor · a11y_l10n · `s2-b4` | The alt said 「残り画面」, but the diagram label is 「今月の残り画面」 | alt.jp now ends 「…保存すると今月の残り画面に戻る図」. |
| 7 | ja-editor · a11y_l10n · `q1` | The EN explanation was hard to parse | "Questions about the goal rather than the features help you put into words whose problem you want to solve and what it is." |
| 8 | visual-qa · visual · `s2-table` | At 390 px the goal column was cut off. The long header has `white-space: nowrap` in the reader CSS. | Headers are now 「浮かんだ機能」 / 「聞き出した目的」 (EN "Feature idea" / "Goal behind it"). Feature cells are nouns (「グラフの表示」「毎晩の通知」「レシートの読み取り」). Goal cells use the 「どうなれる」 form of the goal definition: 「月の途中で食費の使いすぎに気づける」, 「入力忘れによる記録の抜けを防げる」, 「入力の手間が減り、記録を続けられる」. Mobile check: both columns are fully visible, with no lone-character line ends (`pages/mobile-jp-07.png`). |
| 9 | visual-qa · visual · `s5-b2` | Three cramped columns on mobile; 「Won't（今回はやらない）」 took 4 lines | The first column has the English label only (Must / Should / Could / Won't). The Japanese gloss now opens the meaning cell, shortened to 「必須：ないと目的を果たせない」「重要：なくても最初の版は成り立つ」「あるとよい：優先度は低い」「今回はやらない：この版では作らない」. The header 「家計簿アプリの例」 became 「家計簿の例」. The meanings still follow the Agile Business Consortium definitions (`abc-moscow`, re-checked). Mobile check: labels fit on one line and rows are at most 3 lines. The table now takes about half a screen (`pages/mobile-jp-09.png`, `-10.png`). On desktop every row is one line (`pages/desktop-jp-06.png`). |

### niceToHave items applied in round 3

- visual-qa: the circled digits ①–⑥ are removed from all 12 step titles (`s3-steps`, `practice-steps`, both
  locales), so each step is numbered once by the reader (`pages/desktop-jp-09.png`, `pages/mobile-jp-18.png`). No
  body text referred to steps by these digits.
- ja-editor:
  - The `s5-defs` EN MVP sentence has a comma before "with the least effort".
  - q4 option d is no longer the only hedged option: 「頼んでいない機能まで、AIが作り足してしまう」 / "The AI adds
    features you never asked for".
  - 分かる → わかる in 7 places, following ch1 (`vibe-ch1` uses わかる) and the style guide example.
  - The summary-next claim about ch3/ch4 was checked against `course.json` and the ch3/ch4 lessons: ch3 sets up
    VS Code, and ch4 generates the frontend with AI.
- pedagogy-reviewer (prior / q1): `s1-b5` gains one sentence, 「機能より先に、誰の何のためのアプリかを聞いてもらいます。」
  (EN to match). q1's answer then depends on something taught before it, not only in 2-2. The paragraph stays at 3
  sentences and under 160 characters.

### niceToHave items not applied (reasons)

- Reader/platform, outside the lesson file:
  - On touch screens the flashcard hint should read 「タップでめくる」.
  - The score badge showed 3 / 「3% 完了」 after the round-3 screenshot run. This did not happen in this round's
    runs: all three shots show 0 and 0%.
  - The next-lesson card says 「VSCode」. That spelling comes from `course.json` and ch3, which only the owner may
    edit. See the open questions.
- pedagogy-reviewer:
  - Compact copies of the 2-1 and 2-4 prompts next to the practice steps were not added; they would add more body
    text. The steps name the prompt block they reuse instead.
  - A faded worked example was not added, for the same length reason (worked stays at 3).
- ja-editor: section ids `2-5` / `2-3` still carry the titles 2-3 / 2-4. Ids stay stable by rule.

### Earlier rounds (summary; details in the brief)

- **Round 1** (15 items):
  - Answer keys rebalanced and correct options shortened.
  - q9 retagged as evaluate, and new exam item q10 added (o4).
  - o3 reworded to 「判断できる」.
  - `p-revise` got a hint and a troubleshoot.
  - JP/Latin spacing removed lesson-wide.
  - ja-editor wording and EN fixes applied.
  - Strawman distractors replaced.
- **Round 2** (10 items):
  - New practice step `p-ideas`.
  - `p-moscow` and `practice-prompt` rewritten: the learner sorts with reasons and the AI only critiques.
  - `s1-b5`, `s3-b1`, `s5-defs`, q5 and the q4 explanation reworded.
  - 「やらないこと」 quoted consistently.
  - `ex-review` expect fixed.
  - Several niceToHave items on answer cues applied.

## Validate and lint

```
npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2.lesson.json
✓ content/courses/vibe-coding/drafts/vibe-ch2.lesson.json
1 lesson file, 0 course files: no errors.

npm run -s lessons:lint -- content/courses/vibe-coding/drafts/vibe-ch2.lesson.json --strict
✓ content/courses/vibe-coding/drafts/vibe-ch2.lesson.json
1 lesson file: 0 errors, 0 warnings.
```

Remaining lint warnings: **none**.

## Preview and visual QA

`npm run lessons:preview -- vibe-coding vibe-ch2` (re-run after the layout fixes, `generatedAt` 2026-10-19T08:26:36Z)
reports: OK, `overflowX: false`, `consoleErrors: 0`, `mermaidErrors: 0`, `unknownBlocks: 0`, `brokenImages: 0`, and no
text-only screens. There were 21 failed `/api/v2/user/*` requests (503, no database). These are environment noise
and are not counted.

| shot | viewport | page height (before → after) | screens | chars/line median (min–max) |
|---|---|---|---|---|
| desktop-jp | 1440×900 | 16271 → 16147 px | 20 | 37 (35–44), target 30–40 |
| mobile-jp | 390×844 | 21413 → 21397 px | 30 | 20 (18–25) |
| desktop-en | 1440×900 | 17255 → 17207 px | 21 | 70 (62–79), target 60–75 |

Screenshots are in `.artifacts/preview/vibe-coding/vibe-ch2/`, which is **gitignored, so local only**. That folder
holds `desktop-jp.png`, `mobile-jp.png` and `desktop-en.png` (full length, cut at 16000 px), 71 per-screen PNGs in
`pages/`, and `metrics.json`. Screens opened and checked this round:
- mobile-jp-07, 09, 10, 18, 20
- desktop-jp-05, 06, 07, 09, 20
- desktop-en-05, 06, 07

They cover both tables in both layouts, the singly numbered steps, the diagram, the practice prompt and the
reflection with the new o1 wording.

## Assumptions

- Headless run. In round 3, estMinutes stayed 30 to match `course.json` (it is 18 since the round-4 split). About half of that time is the hands-on practice with a
  chat AI.
- The prompts are tool-agnostic (`target: "any"`). The budget app and the club attendance app are invented teaching
  scenarios, not real products.
- MoSCoW is taught with all four buckets, as the Agile Business Consortium defines them.
- 「VS Code」 (the official short name) is kept in `summary-next`, although the course's published chapters write
  「VSCode」.
- In q4, Claude Code is now named without the 「Anthropic社のAIツール」 gloss, as the round-3 ja-editor fix asked. The
  reader's prompt blocks already show a 「Claude Codeで使う」 button.

## Sources

- `cc-best-practices` — "Best practices for Claude Code", Anthropic. https://code.claude.com/docs/en/best-practices.
  Re-fetched 2026-10-19. Quotes that back the lesson:
  - "Claude can infer intent, but it can't read your mind."
  - "Letting Claude jump straight to coding can produce code that solves the wrong problem."
  - "have Claude interview you and write a spec"
  - "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of
    scope, …"
- `abc-moscow` — "What is MoSCoW Prioritization?", Agile Business Consortium.
  https://www.agilebusiness.org/resource/what-is-moscow-prioritization/. Re-fetched 2026-10-19. Quotes:
  - Must: "Minimum Usable SubseT … the project guarantees to deliver"
  - Should: "may be painful to leave out, but the solution is still viable"
  - Could: "wanted or desirable but less important"
  - Won't Have this time: "agreed will not be delivered (as part of this timeframe)"
- `ries-mvp` — "Minimum Viable Product: a guide" (2009-08-03), Eric Ries, Startup Lessons Learned.
  https://www.startuplessonslearned.com/2009/08/minimum-viable-product-guide.html. Checked 2026-10-19 in round 1, and
  re-checked by the pedagogy reviewer. Quote: MVP = "that version of a new product which allows a team to collect the
  maximum amount of validated learning about customers with the least effort."
- Repository material:
  - `data/curricula/vibe_coding/chapter2.ts` (the original chapter)
  - `content/courses/vibe-coding/lessons/vibe-ch0`, `vibe-ch1`, `vibe-ch3` and `vibe-ch4`
  - `content/courses/vibe-coding/course.json`

## Open questions for the owner (round 3; superseded by the final gate)

1. **Length.**
   - estMinutes is 30, against the contract's 8–20.
   - Body text is about 3,500 JP characters by this round's count, against a 2,400 budget. The count covers all
     prose in non-quiz blocks, step hints and troubleshoots included, and leaves out prompt templates, labels and
     prompt `expect`, which adds 668 more. Earlier rounds counted more narrowly (~2,500) or estimated ~2,900–3,050.
   - Splitting the practice section into its own lesson would bring both within the contract, but it changes
     `course.json`. Should it be split?
2. **Spelling: VSCode or VS Code.** `course.json` and the published ch3, ch4, ch6 and ch11 write 「VSCode」. This
   lesson writes 「VS Code」, which is Microsoft's own short name, so the next-lesson card and the summary differ.
   Which spelling should the course use?
3. **The MoSCoW table on mobile.** It now fits, but rows still wrap to 3 lines at 390 px, because the reader gives row
   headers `min-width: 6em` and header cells `nowrap`. A stacked table layout on narrow screens would be a
   reader-level change (`components/lesson/reader.css`). The alternative in the lesson is a two-column table (label +
   example) that drops the cited meaning column, which I did not want to lose.
4. **Faded worked example.** Should the lesson have one between `s3-steps` and the practice (worked = 3 now)? It would
   add body text.
5. **o3 wording.** o3 now says 「判断できる」. Do you prefer to bring back 「選んで理由を言える」 with a graded item
   on the reasons?
6. **Reader issues from visual QA:**
   - On touch screens the flashcard hint should say 「タップでめくる」.
   - Score and progress state possibly leaks between preview runs. It did not happen in this round.
   - Prompt blocks with `target: "any"` show 「Claude Codeで使う」 before ch3.

## Next steps to pass the gate (round 3; superseded by the final gate)

1. Re-run `ja-editor` and `visual-qa` on the draft. Also re-run `pedagogy-reviewer`, because `s1-b5` and q4 d
   changed. Each reviewer gets only the file and brief paths, and each result is saved over its review JSON.
2. Run `node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2.*.review.json`.
   The lesson is done when it exits 0. It still stays in `drafts/` until the owner publishes it.

## Round 5 (workflow review round 1) — gate, fixes, state

This section supersedes the length and table items above: the practice section now lives in
`drafts/vibe-ch2-practice.lesson.json` (round 4), and `s5-b2` is a two-column table (round 5).

Gate on the saved round-5 reviews, before fixes (`check-review.mjs`, exit **1**):

```
Review of vibe-ch2 by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.23 (needs ≥ 3.3) · every criterion ≥ 3
  align 3 · hook 4 · prior 4 · load 3 · worked 3 · active 3 · miscon 3 · visual 3 · practice 3 · meta 3 ·
  accuracy 3 · voice 3 · a11y_l10n 4
  9 must-fix: pedagogy ×3 (active s1-check, active check-quiz, accuracy s5-b3), ja-editor ×5 (hook-b1,
  s3-steps ×2, s3-b1, s2-check), visual-qa ×1 (s5-b2)
```

All 9 must-fix items were applied; the brief's "Review round 5" table lists each change and the niceToHave items
applied or left out, with reasons. Two deviations from the suggested text: the `s5-b3` callout leaves out
「（重要）」「（あるとよい）」 (the table right above shows them; body budget), and the `s5-b2` meaning sits in the
second column (「必須：…」), because putting it in the first cell broke 「Could（あると/よい）」 at 390 px.

State after fixes:

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body 2,389 JP characters (budget 2,400); estMinutes 18.
- `npm run lessons:preview -- vibe-coding vibe-ch2` → OK: overflowX no, console errors 0, diagram errors 0, no
  text-only screens; desktop-jp median 37 chars/line, desktop-en 71. Checked by eye: `pages/mobile-jp-09.png` (the
  MoSCoW table: no mid-word breaks in the first column).

Next: a fresh review round (pedagogy-reviewer, ja-editor, visual-qa) on the fixed draft, then `check-review.mjs`
again. Owner decisions still open: list `vibe-ch2-practice` in `course.json` (m2, after vibe-ch2, estMinutes 20) and
change vibe-ch2's estMinutes there from 30 to 18; VSCode vs VS Code; the reader-level flashcard hint on touch.

## Round 6 (workflow review round 2) — gate, fixes, state

This section supersedes the status lines at the top of this report (estMinutes is 18; o4 is evaluate).

Reviewers: `pedagogy-reviewer` (mean 3.46, pass, 0 must-fix), `ja-editor` (revise, 4 must-fix), `visual-qa` (mean 4,
pass, 0 must-fix). Saved over `reports/vibe-ch2.<reviewer>.review.json`. Gate before fixes (`check-review.mjs`, exit **1**):

```
Review of vibe-ch2 by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.38 (needs ≥ 3.3) · every criterion ≥ 3
  align 3 · hook 4 · prior 4 · load 3 · worked 3 · active 4 · miscon 3 · visual 4 · practice 3 · meta 4 ·
  accuracy 3 · voice 3 · a11y_l10n 3
  4 must-fix (ja-editor): s1-b1, s5-b3, q1, q5
```

The only blocker was the 4 open must-fix items; no criterion was below 3.

| # | Source / criterion / block | Change |
|---|---|---|
| M1 | ja-editor / a11y_l10n / `s1-b1` | 「ビジョン（vision）を示すこと」. |
| M2 | ja-editor / voice / `s5-b3` (EN) | "Ask, "Could the goal still be met without this?" Only the features the goal can't do without become Musts." |
| M3 | ja-editor / voice / q1 a feedback (EN) | "Asking about features gets you a list of features before the goal is set." |
| M4 | ja-editor / voice / q5 c feedback (EN) | "Starting with which features are needed skips past the goal." |
| N1 | pedagogy / accuracy, voice / `s5-b3` | The first-version rule is now this lesson's choice, because the ABC MoSCoW timebox can also deliver Shoulds and Coulds, and the subject is explicit: 「「これがなくても、目的は果たせる？」と聞きます。答えが「果たせない」になる機能だけをMustにします。このレッスンでは、最初の版をMustだけで作ります。…」 (EN in sync). |
| N2 | pedagogy / accuracy / q9 b | 「先に企画書のMustと画面の中身を直し、次の版を頼む」 / "Update the plan's Musts and what the screen shows first…" (the scenario changes what a screen shows, not the screen order). |
| N3 | pedagogy / miscon / q6 b | Strawman replaced by a leading question that assumes the goal: 「カレンダーがあれば、予定を忘れなくなるよね？」. Feedback: a leading question only checks your own guess; ask an open question. |
| N4 | pedagogy / align, active / q8 | q8 now gives a plan to review (a pet vet-visit log with the screen flow and data handled left empty). Key d is 「画面の流れと扱うデータを、自分で決めて書き足す」, so it no longer repeats o4's wording. Option b 「空いた欄はAIが補ってくれるので、そのまま渡す」 replaces the old "Must to be safe" distractor (that belief is still covered by q10 c). c feedback and the explanation are adjusted. Ids unchanged. |
| N5 | pedagogy / practice / `s1-b5` | Invitation before the prompt: 「下の依頼文を自分のアイデアで試し、「期待される結果」と比べましょう。」 (EN uses the reader's label "What a good answer looks like"). |
| N6 | pedagogy / worked / `ex-review` | Reason added: 「推測が混ざることがあるので、意図と違うところを直します。」 |
| N7 | accuracy / `summary-next` | Dropped 「第4章では、その企画書を渡して画面を作ってもらいます。」: the current vibe-ch4 builds a page from an attached image and does not use a plan (the practice reviewer found the same claim there). The reflection question now has a full-width space after ？ (ja-editor nice). |
| N8 | ja-editor nice / glossary MVP | Same wording as `s5-defs` (「Minimum Viable Product（実用最小限の製品）の略。…」 / "Short for Minimum Viable Product: …"). |
| N9 | ja-editor nice / q2 a feedback, q3 explanation (EN) | As suggested. |
| N10 | visual-qa nice / q10 stem (question 5 of the exam) | 「直し方として、最も適切なのはどれでしょう？」 → 「最も適切な直し方はどれでしょう？」 removes the orphaned 「う？」 on desktop JP (checked in `pages/desktop-jp-13.png`). |

Body budget: M1, N1, N5 and N6 added text. N7 and three cuts pay for it: `s2-why` 「下の表は、家計簿アプリでの例です。」 (the
table caption says it), a shorter first sentence in `s3-b1` (「目的と機能の優先順位に、画面の流れと扱うデータを足して、1枚にまとめます。」)
and the opening 「最後に振り返ってみましょう。」 of `summary-next`.

Not applied, with reasons: 「SNS（…）」 on first use in q7 (a long gloss inside one option would be a length cue, and
SNS is the everyday Japanese word); trimming `s2-b3.expect` (it is the model answer in a closed disclosure, not body text);
the EN line-length polish in `s5-b1` / `hook-b1` (median 73, inside the target); reader-level items (flashcard
「タップでめくる」, the 「Claude Codeで使う」 button on phones) and `course.json` (owner only).

State after fixes:

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body 2,390 JP characters (budget 2,400; same method as rounds 4–5); estMinutes 18.
- `npm run lessons:preview -- vibe-coding vibe-ch2` → OK: overflowX no, console errors 0, diagram errors 0, no text-only
  screens; desktop-jp median 37 chars/line, desktop-en 73. Checked by eye: `pages/desktop-jp-13.png` (q8 options, q10 stem).

Next: a fresh review round on the fixed draft (the saved JSON describes the pre-fix draft), then `check-review.mjs`.
Owner decisions still open: list `vibe-ch2-practice` in `course.json` (m2, after vibe-ch2) and set vibe-ch2's
estMinutes there to 18; VSCode vs VS Code; reader-level touch hints.

## Confirmation review (round 7)

This section supersedes the "Final gate" status lines and the Round 6 "Next" line above.

Fresh, independent reviews of the round-6 draft: `pedagogy-reviewer` (own average 3.54, revise, 1 must-fix),
`ja-editor` (revise, 4 must-fix), `visual-qa` (pass, 0 must-fix). Saved over
`reports/vibe-ch2.<reviewer>.review.json`. The workflow's preview of the round-6 draft, run before the reviews, was OK
on all three viewports: desktop-jp 13,324 px with a median of 37 chars/line, mobile-jp 17,559 px, desktop-en 13,985 px
with a median of 73. It had no overflow, 0 console errors and 0 diagram errors.

Official confirmation verdict:
`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2.*.review.json`
exited **1**.

```
Review of vibe-ch2 by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.46 (needs ≥ 3.3) · every criterion ≥ 3
  align 4 · hook 4 · prior 4 · load 3 · worked 3 · active 3 · miscon 4 · visual 4 · practice 3 · meta 4 ·
  accuracy 3 · voice 3 · a11y_l10n 3
  5 must-fix: ja-editor ×4 (s5-b3, s2-goal, q4, q10), pedagogy-reviewer ×1 (s5-b3)
```

| criterion | merged (lowest) | pedagogy-reviewer | ja-editor | visual-qa |
|---|---|---|---|---|
| align | 4 | 4 | — | — |
| hook | 4 | 4 | — | — |
| prior | 4 | 4 | 4 | — |
| load | **3** | 3 | 3 | 4 |
| worked | **3** | 3 | — | — |
| active | **3** | 3 | — | — |
| miscon | 4 | 4 | — | — |
| visual | 4 | 4 | — | 4 |
| practice | **3** | 3 | — | — |
| meta | 4 | 4 | — | — |
| accuracy | **3** | 3 | — | — |
| voice | **3** | 3 | 4 | — |
| a11y_l10n | **3** | 4 | 3 | 4 |
| **mean** | **3.46** | | | |

The verdict is REVISE only because 5 must-fix items were open. No criterion is below 3, and the mean passes.

### Must-fix items, applied after the confirmation round

All 5 items are small wording or translation fixes, so they were applied after this round. The recorded verdict
above (REVISE, exit 1) describes the draft **before** these fixes. JP and EN were kept in sync.

| # | Source / criterion / block | Change applied |
|---|---|---|
| C1 | pedagogy-reviewer / load / `s5-b3` and ja-editor / load / `s5-b3` | The two fixes overlap, so one change covers both. It uses the pedagogy 3-sentence rewrite and adds the ja-editor paragraph break after 「…機能だけをMustにします。」. It keeps the round-6 hedge 「このレッスンでは、」 (round-6 N1: the ABC MoSCoW timebox can also deliver Shoulds and Coulds, so "the first version has only Musts" is this lesson's choice). JP: 「「これがなくても、目的は果たせる？」と聞き、「果たせない」機能だけをMustにします。⏎⏎このレッスンでは、最初の版をMustだけで作り、ShouldとCouldはそのあとに足します。Won'tは今回作らず、次の版の候補に残します。」 EN: "Ask, "Could the goal still be met without this?" and make only the features it can't do without Musts. ⏎⏎ In this lesson, we build the first version from the Musts alone and add Shoulds and Coulds after that. A Won't is not built this time and stays on as a candidate for the next version." The EN keeps the lesson's double quotes. The callout now has 3 sentences instead of 5, and the body is 14 characters shorter. |
| C2 | ja-editor / a11y_l10n / `s2-goal` | As given: 「「月の途中で食費の使いすぎに気づける」が目的なら、…」 (57 characters). EN: "If the goal is to notice mid-month that you're overspending on food, …". |
| C3 | ja-editor / a11y_l10n / q4 explanation (EN) | As given: "A guide from an AI tool maker likewise says a useful spec (a document like this plan) states what is out of scope." |
| C4 | ja-editor / load / q10 stem | As given: 「英単語の復習アプリの目的は「通勤中の自分が、英単語を5分で復習できる」です。…」, without the opening 「…1枚企画書です。」. EN begins "An English vocabulary app's plan has the goal "I can review English words for five minutes on my commute."" |

C1 is the only change that departs from a reviewer's text. It combines two must-fix suggestions and keeps the
round-6 hedge, for the reasons given in the table.

### niceToHave items left open

This round applied must-fix items only. These suggestions remain open:

- pedagogy-reviewer: the q2 hint (point to the s2-why probe); sharper distractors for q7 a and q3 d; the Bloom tag
  of q4 (analyze → understand, or a reframed item); the q8 b feedback wording (「依頼文で頼まない限り…」);
  `s3-b1` 「目的と、機能の優先順位に」; listing `vibe-ch2-practice` in `course.json` (owner).
- ja-editor: `s2-why` 「自分に1回聞き返します」; the `s5-b2` header 「意味：家計簿アプリの例」; the `ex-goal` sample
  question wording; Japanese glosses for all four MoSCoW groups in the glossary; the q5 option-length cue; a fact check
  of the cc-best-practices out-of-scope claim behind q4 (author or owner).
- visual-qa: the one-character widow in the `s2-defs` 機能 definition. Reader-level items: 「タップでめくる」 on touch
  devices, and the duplicated 理解度チェック label.

### State after fixes

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body about 2,383 JP characters (2,390 − 14 + 7, same method as rounds 4–6; q4 and q10 are quiz text). estMinutes 18.
- `npm run lessons:preview -- vibe-coding vibe-ch2`, re-run after the fixes → OK. desktop-jp is 13,373 px with a
  median of 37 chars/line, mobile-jp 17,575 px, and desktop-en 14,001 px with a median of 73. There is no overflow, no
  console or diagram error and no text-only screen. Checked by eye: `pages/mobile-jp-09.png` and `pages/mobile-jp-10.png`
  (the `s5-b3` callout shows as two paragraphs).
- Whole repository checks:
  - `npm run lessons:validate -- --drafts`: 15 lesson files and 1 course file, 0 errors.
  - `npm run lessons:lint -- --strict`: 0 errors. 81 advisory warnings, all in 11 migrated-unreviewed lessons; the
    drafts have none.
  - `npm test`: 654 pass, 0 fail.

Next: the recorded confirmation verdict is REVISE (exit 1) and describes the draft before the fixes. A gate result of
exit 0 needs a fresh review of the fixed draft; the owner decides whether to run one. Owner decisions still open:
- list `vibe-ch2-practice` in `course.json` and set vibe-ch2's estMinutes to 18;
- VS Code vs VSCode;
- the reader-level touch hints;
- the cc-best-practices fact check.
