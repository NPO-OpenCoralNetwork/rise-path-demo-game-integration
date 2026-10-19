# Report: vibe-coding/vibe-ch2 (draft)

**Status: DRAFT, not published.** The file is `content/courses/vibe-coding/drafts/vibe-ch2.lesson.json`.
`lessons/`, `course.json` and `provenance.reviewedBy` are untouched. Publishing (author-lesson step 10) is the owner's
call. **The review gate has not passed yet.** After round 3, all 9 open must-fix items are applied to the draft. The
saved review JSONs still list them, though, because only an independent reviewer can clear them. `check-review.mjs`
will keep exiting 1 until `ja-editor` and `visual-qa` re-score the revised draft. A fresh `pedagogy-reviewer` pass is
also advisable because a few body sentences changed.

- Lesson: 第2章｜AIと企画する力を身につける / Chapter 2 | Planning with AI. Rework of the migrated chapter
  `data/curricula/vibe_coding/chapter2.ts` (`VIBE_CHAPTER_2_DATA`). `provenance.migratedFrom` is kept and the author
  is `claude-code`, so the lesson is linted strict.
- Locales: jp, en. Level: beginner. estMinutes: 30. Prerequisites: ch0 and ch1.
- Brief, outline and the per-round notes: `content/courses/vibe-coding/briefs/vibe-ch2.md`.

## Objectives

| id | bloom | jp | assessed by |
|---|---|---|---|
| o1 | apply | ぼんやりしたアイデアを、AIに質問してもらう依頼文に書き換え、壁打ちに使える | q1 (inline), q5 (exam, transfer) |
| o2 | analyze | アイデアの中から「目的」と「機能」を見分け、機能の奥にある目的を聞き出せる | q0 (predict, ungraded), q2 (inline), q6 (exam) |
| o3 | evaluate | 機能の候補をMoSCoWで分け、最初の版（MVP）に入れる範囲を判断できる | q3 (inline), q7 (exam, transfer) |
| o4 | create | 目的から「やらないこと」までをまとめた1枚企画書を、AIと作って直せる | q4 (inline), q8, q10, q9 (exam), practice |

o1 was reworded in round 3 (ja-editor must-fix). The EN text is now "Rewrite a vague idea as a request for the AI to
interview you, and use it to talk the idea through".

## Review history and verdicts

| round | reviewers | merged mean | lowest criterion | open must-fix | gate (before fixes) |
|---|---|---|---|---|---|
| 1 | pedagogy-reviewer, ja-editor | 3.15 | 3 (several) | 15 (12 ja-editor, 3 pedagogy) | REVISE, exit 1 (mean < 3.3, must-fix open) |
| 2 | pedagogy-reviewer, ja-editor | 3.46 | 3 | 10 (8 ja-editor, 2 pedagogy) | REVISE, exit 1 (must-fix open only) |
| 3 | pedagogy-reviewer (pass, 3.46), ja-editor (revise, 3.25), visual-qa (revise) | 3.38 | 3 | 9 (7 ja-editor, 2 visual-qa) | REVISE, exit 1 (must-fix open only) |

All must-fix items from every round were applied before the next round. Round 3's 9 items are applied in this step
(see below), but they have not been re-reviewed yet.

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

- Headless run. estMinutes stays 30 to match `course.json`. About half of that time is the hands-on practice with a
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

## Open questions for the owner

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

## Next steps to pass the gate

1. Re-run `ja-editor` and `visual-qa` on the draft. Also re-run `pedagogy-reviewer`, because `s1-b5` and q4 d
   changed. Each reviewer gets only the file and brief paths, and each result is saved over its review JSON.
2. Run `node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2.*.review.json`.
   The lesson is done when it exits 0. It still stays in `drafts/` until the owner publishes it.
