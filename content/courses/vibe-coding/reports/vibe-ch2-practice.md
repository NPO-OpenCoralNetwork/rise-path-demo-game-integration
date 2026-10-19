# Report: vibe-coding/vibe-ch2-practice (draft)

**Status: DRAFT, not published, not listed in `course.json`. Final gate (2026-10-19): REVISE, `check-review.mjs`
exits 1.**

- Title: 第2章 演習｜自分のアイデアで1枚企画書をつくる / Chapter 2 practice: your own one-page plan.
- Draft: `content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json`.
- Brief: `content/courses/vibe-coding/briefs/vibe-ch2-practice.md` (outline, assumptions, round notes).
- Split off from `vibe-ch2` in round 4. Listing and publishing it is the owner's call.
- Provenance: author `claude-code`, skill `author-lesson`, skillVersion `1`, generatedAt 2026-10-19. There is no
  `migratedFrom` and no `reviewedBy`.

The saved review JSONs are the round-6 reviews, and they describe the draft *before* the round-6 fixes. The rubric
numbers pass: every criterion is ≥ 3 and the mean is 3.38. The gate fails only on 8 must-fix items. The final gate
confirmed that all 8 are in the current draft (see "Final gate"). Only a fresh independent review can clear them
from the JSON.

## Objectives (current draft)

| id | bloom | text (jp) | assessed by |
|---|---|---|---|
| o3 | evaluate | 自分のアイデアから出した機能の候補を、Must以外も含めてMoSCoWで分け、最初の版に入れる範囲を判断できる | pq0 (predict, ungraded), pq1 (inline, 演習2), pq2 (exam) |
| o4 | create | 自分のアイデアで、目的から「やらないこと」までの1枚企画書をAIと作り、チェックリストで直せる | pq5 (inline, 演習3), pq3, pq4 (exam), the 演習1–3 steps and the checklist `practice-checklist` |

The objective ids o3 and o4 match the objectives they extend in `vibe-ch2`.

## Final gate (2026-10-19)

Where this section disagrees with the round sections below, this section wins.

### Merged review table and verdict

`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json content/courses/vibe-coding/reports/vibe-ch2-practice.visual-qa.review.json`
gives **REVISE, exit 1**. The table shows the lowest score per criterion from the saved round-6 reviews.

| criterion | score | scored by |
|---|---|---|
| align | 4 | pedagogy-reviewer |
| hook | 3 | pedagogy-reviewer |
| prior | 3 | pedagogy-reviewer, ja-editor |
| load | 3 | pedagogy-reviewer, ja-editor, visual-qa |
| worked | 3 | pedagogy-reviewer |
| active | 3 | pedagogy-reviewer |
| miscon | 4 | pedagogy-reviewer |
| visual | 3 | pedagogy-reviewer, visual-qa |
| practice | 4 | pedagogy-reviewer |
| meta | 4 | pedagogy-reviewer |
| accuracy | 3 | pedagogy-reviewer |
| voice | 3 | pedagogy-reviewer, ja-editor |
| a11y_l10n | 4 | pedagogy-reviewer, ja-editor, visual-qa |
| **mean** | **3.38** (needs ≥ 3.3; every criterion ≥ 3) | blocker: 8 open must-fix items in the saved JSON |

### Must-fix items checked against the current draft

The gate checked each item by string search in the draft JSON: the suggested new text is present, and the old text
(where the reviewer quoted one) is gone. All 8 items pass.

| # | reviewer · criterion · block | found in the draft |
|---|---|---|
| 1 | ja-editor · voice · `p-moscow` expect | 「4つのグループへの分け方と、その理由が書けています。」. The old 「4つの分け方と理由が書けています。」 is gone. |
| 2 | ja-editor · voice · pq1 explanation | 「…」と自分で確かめます。果たせるならMustから外し、重要ならShouldにします。」 (two sentences) |
| 3 | ja-editor · voice · `summary-next` | JP 「AIの指摘のうち、受け入れなかったものがあれば、その理由を1行で書いておきましょう。」. EN "If you turned down any of the AI's points, write down why in one line." |
| 4 | ja-editor · prior · `p-interview` | The definition comes first in both locales: 「[[壁打ち]]は、質問してもらいながら考えを言葉にすることです。下の「壁打ちを始める依頼文」をAIに送り…」 and "[[Talking it through]] means … Send …". |
| 5 | ja-editor · a11y_l10n · pq3 d feedback (EN) | "What's missing is a Must for saving recipes." The old "adding recipes" is gone. |
| 6 | ja-editor · a11y_l10n · `practice-task` (EN) | "…make the decisions yourself; the AI only reviews them." |
| 7 | ja-editor · a11y_l10n · `practice-prompt` expect (EN) | "…the Musts are creating an event, …". The old "Your sorting: Must:" is gone. |
| 8 | visual-qa · visual · `practice-flow` | Roles in parentheses: `イベントの作成<br>（幹事）` … and `Create event<br>(organizer)` …, flowchart TD. The gate saw them rendered on separate lines in `pages/desktop-en-08.png`. |

### Verdict history

| round | reviewers | merged mean | lowest criterion | open must-fix | gate (before fixes) |
|---|---|---|---|---|---|
| 4 | none | — | — | — | Split off from `vibe-ch2` (fix-only round) |
| 5 (workflow round 1) | pedagogy-reviewer, ja-editor, visual-qa (pass) | 3.08 | **hook 2** | 9 (6 ja-editor, 3 pedagogy) | REVISE, exit 1 (hook < 3, mean < 3.3, must-fix open) |
| 6 (workflow round 2) | pedagogy-reviewer (pass, 3.46), ja-editor (revise, 3.5), visual-qa (revise) | 3.38 | 3 | 8 (7 ja-editor, 1 visual-qa) | REVISE, exit 1 (must-fix open only) |
| final gate | saved round-6 JSON | 3.38 | 3 | 8, all found applied in the draft | **REVISE, exit 1**: a fresh review is needed to clear the JSON |

### Length and time

| measure (JP characters, whitespace not counted) | at the split (round 4) | now |
|---|---|---|
| Body: prose, without quizzes or copyable prompt text | 1,766 | **2,104** (budget 2,400) |
| Body plus prompt model answers and hints | 2,732 | 3,071 |
| All non-quiz text | 3,666 | 4,121 |
| estMinutes | 20 | **20** (contract estimate 19.2) |

The lesson has 6 questions: pq0 is an ungraded predict, pq1 and pq5 are inline, and pq2–pq4 make up the exam. It
has 3 practice sections (演習1–3), a 4-point summary and 4 flashcards.

### CI steps and checks (run at the final gate)

The repo-wide runs are the same as in `reports/vibe-ch2.md`:
- `npm run typecheck`: 0 errors.
- `npm test`: 654 pass, 0 fail.
- `npm run lessons:validate`: no errors. With `-- --drafts`: 15 lesson files, no errors.
- `npm run lessons:lint -- --strict`: exit 0. The only warnings are advisory ones in migrated-unreviewed lessons.
- `npm run lessons:schema -- --check` and `build-references.mjs --check`: both up to date.

For this draft:
- `lessons:validate`: 0 errors.
- `lessons:lint --strict`: 0 errors, 0 warnings.

No code changed, so no vite build was needed.

### Preview metrics

The preview `metrics.json` has `generatedAt` 2026-10-19T09:43:46Z, after the last draft edit at 09:42Z.

- Status: OK, `overflowX: false`, `consoleErrors: 0`, `mermaidErrors: 0`, `unknownBlocks: 0`, `brokenImages: 0`.
- No text-only screens.
- 20 failed `/api/v2/user/*` requests (503, no database) are environment noise and are not counted.

| shot | viewport | page height | screens | chars/line median (min–max) |
|---|---|---|---|---|
| desktop-jp | 1440×900 | 10,566 px | 13 | 36 (35–44), target 30–40 |
| mobile-jp | 390×844 | 13,573 px | 19 | 19 (18–25) |
| desktop-en | 1440×900 | 11,242 px | 14 | 70 (62–80), target 60–75 |

The screenshots are in `.artifacts/preview/vibe-coding/vibe-ch2-practice/`, which is gitignored and local only. The
preview works although the lesson is not in `course.json`, because in dev `content/index.ts` loads every draft file.
For the same reason, there are two preview-only side effects:
- The end card says 「このコースの最後のレッスンまで読み終えました。」.
- ch2's next-lesson card still points to ch3.

### Open questions for the owner

1. **Fresh review round.** Should a review round (pedagogy-reviewer, ja-editor, visual-qa) run on the current draft?
   The gate can only pass once the saved JSONs describe this draft and `check-review.mjs` exits 0.
2. **List `vibe-ch2-practice` in `course.json`?** It would go in module m2, after `vibe-ch2`, with estMinutes 20 and
   a `next` link from `vibe-ch2`. vibe-ch2's estMinutes there would change from 30 to 18. Until it is listed,
   learners never see this lesson. If you reject the split, the practice goes back into vibe-ch2 and a length waiver is
   recorded in vibe-ch2's brief.
3. **Publish both?** Once they pass, should both drafts move to `lessons/`, followed by `course.json` and
   `lessons:catalog`?
4. **VS Code or VSCode?** The course's published chapters and `course.json` write 「VSCode」, and the ch2 drafts
   write 「VS Code」. Which spelling should the course use?
5. **Reader-level items** (outside the lesson files):
   - On touch screens the flashcard hint should read 「タップでめくる」.
   - The 未回答 / "Unanswered" sidebar marker appears as soon as the learner scrolls past an inline check.
   - The end card of an unlisted draft preview says the course is finished.

## Review round 5 (workflow review round 1; first review of this lesson)

Gate on the saved reviews, before fixes (`check-review.mjs`, exit **1**):

```
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.08 (needs ≥ 3.3)
  align 3 · hook 2 ✗ · prior 3 · load 3 · worked 3 · active 3 · miscon 4 · visual 3 · practice 3 · meta 4 ·
  accuracy 3 · voice 3 · a11y_l10n 3
  9 must-fix: pedagogy ×3 (hook hook-b1, practice practice-checklist, voice summary-points),
  ja-editor ×6 (summary-points, practice-recap, practice-check ×2, p-revise, p-ideas); visual-qa none
```

| Must-fix | Resolution |
|---|---|
| hook (pedagogy): sentence 3 and the subtitle gave away pq0's answer | Sentence moved to `practice-task`; new subtitle; `hook-b1` is now a concrete 3-sentence scenario (a club organizer makes all six features Musts) and pq0 asks about that organizer. |
| practice (pedagogy): pq3 grades a missing-Must check the practice never asks for | Checklist item `pc-flow`; a "is anything missing?" line in `practice-prompt`; summary point 4; diagram `practice-flow`. |
| voice (pedagogy + ja-editor): summary point 2 inverts Should | ja-editor's wording, all four points in です・ます. |
| voice (ja-editor): `practice-recap` 「重要でも、なくても」 | 「重要だけれど、なくても…」 |
| voice (ja-editor): pq1 d feedback, pq1 hint | As given. |
| a11y_l10n (ja-editor): `p-revise` 「埋まる」, `p-ideas` EN hint | As given (`p-revise` in です・ます like the other step expects). |

niceToHave items applied and left out are listed, with reasons, in the brief's "Review round 5" section.

## State after fixes

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body 2,038 JP characters (budget 1,200–2,400; checklist labels included); estMinutes 20.
- `npm run lessons:preview -- vibe-coding vibe-ch2-practice` → OK: overflowX no, console errors 0, diagram errors 0,
  no text-only screens; desktop-jp median 37 chars/line, desktop-en 68. Screens in
  `.artifacts/preview/vibe-coding/vibe-ch2-practice/` (checked by eye: `pages/mobile-jp-01.png` hook,
  `pages/mobile-jp-03.png` task + recap, `pages/mobile-jp-10.png`–`11.png` diagram and checklist,
  `pages/desktop-en-09.png` EN exam and glossary).

## Sources

- `abc-moscow` — What is MoSCoW Prioritization? — Agile Business Consortium — checked 2026-10-19.
- `cc-best-practices` — Best practices for Claude Code — Anthropic — checked 2026-10-19 (interview prompt).

## Open questions for the owner

1. List `vibe-ch2-practice` in `course.json` (module m2, after `vibe-ch2`, estMinutes 20, `next` link from
   `vibe-ch2`), and change `vibe-ch2`'s estMinutes there from 30 to 18. Until then the preview end card says this is
   the last lesson of the course.
2. Reader-level items from visual QA: 「タップでめくる」 on touch screens; the 未回答 / "Unanswered" sidebar marker
   that appears as soon as the learner scrolls past an inline check.
3. `summary-next` says ch4 can take this plan as input; please confirm when ch4 is reworked.

## Next steps to pass the gate

Run a fresh review round (pedagogy-reviewer, ja-editor, visual-qa) on the fixed draft, save each JSON over
`reports/vibe-ch2-practice.<reviewer>.review.json`, and run
`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json`.

## Round 6 (workflow review round 2) — gate, fixes, state

This section supersedes "State after fixes", open question 3 and "Next steps" above.

Reviewers: `pedagogy-reviewer` (mean 3.46, pass, 0 must-fix), `ja-editor` (mean 3.5, revise, 7 must-fix), `visual-qa`
(revise, 1 must-fix). Saved over `reports/vibe-ch2-practice.<reviewer>.review.json`. Gate before fixes
(`check-review.mjs`, exit **1**):

```
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.38 (needs ≥ 3.3) · every criterion ≥ 3
  align 4 · hook 3 · prior 3 · load 3 · worked 3 · active 3 · miscon 4 · visual 3 · practice 4 · meta 4 ·
  accuracy 3 · voice 3 · a11y_l10n 4
  8 must-fix: ja-editor ×7 (p-moscow, pq1, summary-next, p-interview, pq3, practice-task, practice-prompt),
  visual-qa ×1 (practice-flow)
```

The only blocker was the 8 open must-fix items; no criterion was below 3.

| # | Source / criterion / block | Change |
|---|---|---|
| M1 | ja-editor / voice / `p-moscow` expect | 「4つのグループへの分け方と、その理由が書けています。」 (EN "Your sorting into the four groups, with a reason for each, …"); the step text also says 「4つのグループに分け」. |
| M2 | ja-editor / voice / pq1 explanation | Split as given (JP), EN split the same way. |
| M3 | ja-editor / voice / `summary-next` | One conditional sentence, as given (JP and EN). |
| M4 | ja-editor / prior / `p-interview` | The 壁打ち definition comes first, as given (JP and EN). |
| M5 | ja-editor / a11y_l10n / pq3 d feedback (EN) | "…a Must for saving recipes." |
| M6 | ja-editor / a11y_l10n / `practice-task` (EN) | As given ("…make the decisions yourself; the AI only reviews them."). |
| M7 | ja-editor / a11y_l10n / `practice-prompt` expect (EN) | The "Your sorting" line as given. |
| M8 | visual-qa / visual / `practice-flow` | Roles in parentheses in both locales (`A["イベントの作成<br>（幹事）"]`, `A["Create event<br>(organizer)"]`, …), flowchart TD kept. Labels are quoted so the ASCII parentheses parse; preview reports 0 diagram errors (checked in `pages/desktop-en-08.png`, `pages/mobile-jp-11.png`). |
| N1 | pedagogy + visual-qa + ja-editor / load (3 from all three) | The practice is now three sections: `practice` 「演習1：目的を1文にする」 (task, steps `p-idea`/`p-interview`, the interview prompt), `practice-sort` 「演習2：機能を分けて、最初の版を決める」 (recap, `practice-check`, steps `p-ideas`/`p-moscow`, the MoSCoW review prompt) and `practice-plan` 「演習3：1枚企画書にまとめて直す」 (steps `p-plan`/`p-revise`, the plan prompt, tip, diagram, checklist, new inline check). Each prompt now follows the step that uses it, with a section heading and TOC anchor between the parts. Step ids are unchanged; the steps sit in `practice-steps`, `practice-steps-sort` and `practice-steps-plan`. `practice-task` names the three parts. `practice-tip` now says 「演習2と演習3の依頼文の下」. |
| N2 | pedagogy / active, align / o4 | New inline check `practice-plan-check` (pq5 → o4, evaluate) at the end of 演習3. A ゴミ出し app plan whose goal 「ゴミ出しを管理できる」 fails the first checklist item; distractors are deleting the Won't, adding a convenience Must, and letting the AI write the goal. Lint needs 2 inline checks for 3 practice sections; there are 2 (pq1, pq5). |
| N3 | pedagogy / hook / pq0 | d is now a near-miss tied to the hook's six-Must problem (「自分で分けたあと、AIには足りない機能だけを挙げてもらう」, feedback: the too-many-Musts problem stays). The a feedback no longer contradicts pq1 (「AIの分け方は材料になりますが、何を最初の版に入れるかを決めるのは自分です。」). The explanation names 演習2. |
| N4 | pedagogy / prior; ja-editor nice | `hook-b1` links [[MoSCoW]] on first use and names the features as later blocks do (締め切り前日の通知, ひとことコメント欄). |
| N5 | pedagogy / accuracy / `summary-next` | 「第4章で…」 → 「この先、AIに画面を作ってもらうときは…」 (the current vibe-ch4 builds from an attached image). |
| N6 | ja-editor nice / pq1 d feedback | Concrete reason: 「店ごとに並ぶと買い忘れに気づきやすいので、Won'tよりShouldが合います。」 |
| N7 | ja-editor nice / o3 | 「自分のアイデアから出した機能の候補を、…」 (EN in sync). |

Not applied, with reasons: a Could option in pq2 (whether a reminder is Should or Could is arguable, so the key would
be disputable; card-should-wont and practice-recap cover the difference); pq2 c parallel form (the reviewer called it
acceptable); VS Code vs VSCode (owner question); reader-level items (end banner on draft previews, the 未回答 marker,
touch hints).

State after fixes:

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body 2,104 JP characters (same method as round 5); estMinutes 20 (one more inline question, about 40 s).
- `npm run lessons:preview -- vibe-coding vibe-ch2-practice` → OK: overflowX no, console errors 0, diagram errors 0,
  no text-only screens; desktop-jp median 36 chars/line, desktop-en 70. Checked by eye: `pages/desktop-jp-03.png`
  (interview prompt right under step 2, then the 演習2 heading), `pages/desktop-en-08.png` and `pages/mobile-jp-11.png`
  (diagram roles), `pages/desktop-jp-09.png` (pq5), `pages/mobile-jp-12.png` (checklist).
- Objectives: o4 is now also assessed inline by pq5.

Next: a fresh review round on the fixed draft (the saved JSON describes the pre-fix draft), then `check-review.mjs`.
The owner still needs to list `vibe-ch2-practice` in `course.json`.

## Confirmation review (round 7)

This section supersedes the "Final gate" status lines and the Round 6 "Next" line above.

Fresh, independent reviews of the round-6 draft: `pedagogy-reviewer` (own average 3.62, pass, 0 must-fix),
`ja-editor` (revise, 6 must-fix), `visual-qa` (pass, 0 must-fix). Saved over
`reports/vibe-ch2-practice.<reviewer>.review.json`. The workflow's preview of the round-6 draft, run before the
reviews, was OK on all three viewports: desktop-jp 10,566 px with a median of 36 chars/line, mobile-jp 13,573 px,
desktop-en 11,242 px with a median of 70. It had no overflow, 0 console errors and 0 diagram errors.

Official confirmation verdict:
`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json`
exited **1**.

```
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.54 (needs ≥ 3.3) · every criterion ≥ 3
  align 4 · hook 4 · prior 4 · load 3 · worked 3 · active 3 · miscon 4 · visual 3 · practice 4 · meta 4 ·
  accuracy 3 · voice 3 · a11y_l10n 4
  6 must-fix (ja-editor): practice-recap, summary-points, card-must-test, card-ai-review, card-revise, practice-check
```

| criterion | merged (lowest) | pedagogy-reviewer | ja-editor | visual-qa |
|---|---|---|---|---|
| align | 4 | 4 | — | — |
| hook | 4 | 4 | — | — |
| prior | 4 | 4 | 4 | — |
| load | **3** | 3 | 3 | 3 |
| worked | **3** | 3 | — | — |
| active | **3** | 3 | — | — |
| miscon | 4 | 4 | — | — |
| visual | **3** | 3 | — | 4 |
| practice | 4 | 4 | — | — |
| meta | 4 | 4 | — | — |
| accuracy | **3** | 3 | — | — |
| voice | **3** | 4 | 3 | — |
| a11y_l10n | 4 | 4 | 4 | 4 |
| **mean** | **3.54** | | | |

The verdict is REVISE only because 6 must-fix items were open. No criterion is below 3, and the mean passes.

### Must-fix items, applied after the confirmation round

All 6 items are small wording fixes, so they were applied after this round. The recorded verdict above (REVISE,
exit 1) describes the draft **before** these fixes. Each fix used the reviewer's text exactly, with JP and EN in sync.

| # | Source / criterion / block | Change applied |
|---|---|---|
| C1 | ja-editor / load / `practice-recap` | As given: 「Mustは、ないと目的を果たせないものです。Shouldは、重要だけれど、なくても最初の版が成り立つものです。⏎⏎Couldは、あるとよいものです。Won'tは、この版では作らないと決めて、企画書に書いておくものです。」 The EN is split the same way: "… A Should is important, but the first version still works without it. ⏎⏎ A Could is nice to have. A Won't …". The semicolon became a full stop. |
| C2 | ja-editor / voice / `summary-points[2]` | As given: 「自分が決めていないことをAIが埋めたら、…」. The EN ("If the AI fills in something you never decided…") already meant this. |
| C3 | ja-editor / voice / `card-must-test` | As given: 「…果たせるなら、Mustではありません。」. The EN needed no change. |
| C4 | ja-editor / voice / `card-ai-review` | As given: 「…AIには指摘だけを頼みます。直すかどうかは自分で決めます。」. The EN needed no change. |
| C5 | ja-editor / voice / `card-revise` | As given: 「どこを・なぜ・どう直すか。1文で伝えます。」. The EN needed no change. |
| C6 | ja-editor / voice / `practice-check` pq1 d feedback | As given: 「お店ごとに並ぶと…」, which matches the stem's 「お店ごとの並べ替え」. |

The pedagogy-reviewer called plain-form flashcard backs acceptable, but C3–C5 follow the ja-editor must-fix. The
lessons stay consistent: the ch2 flashcard backs end in nouns (体言止め), not plain-form verbs.

### niceToHave items left open

This round applied must-fix items only. These suggestions remain open:

- pedagogy-reviewer: a case where the learner rightly rejects an AI remark, for example reworking pq1 or adding an
  item. That is a content change, so it was not attempted here; the author decides. Also open: the `practice-flow`
  caption versus list screens (イベント一覧 against pq3's レシピの一覧); the pq5 hint, which gives the answer away;
  where `practice-tip` sits; and estMinutes 20 against a contract estimate of about 23.
- ja-editor: the `practice-prompt` Won't reason (「最初の版には重いから」); "agree" → "decide" in the EN of
  `practice-recap` and `card-should-wont`; 「勝手に」 → 「推測で」 in the p-plan hint; the EN of `summary-points[1]`.
- visual-qa: all four items are reader-level:
  - the touch hint on flashcards;
  - the end-of-course banner on draft previews;
  - phrase-aware Japanese line breaking;
  - empty width beside the TD diagram on desktop.

### State after fixes

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body grows by at most 15 JP characters: `practice-recap` +5, summary +3, flashcard backs +7. It stays near 2,110–2,120,
  under the 2,400 budget. estMinutes 20.
- `npm run lessons:preview -- vibe-coding vibe-ch2-practice`, re-run after the fixes → OK. desktop-jp is 10,613 px with
  a median of 36 chars/line, mobile-jp 13,589 px, and desktop-en 11,259 px with a median of 70. There is no overflow, no
  console or diagram error and no text-only screen. Checked by eye: `pages/desktop-jp-04.png` (`practice-recap` shows
  as two paragraphs, and the pq1 stem is visible).
- Whole repository checks:
  - `npm run lessons:validate -- --drafts`: 15 lesson files and 1 course file, 0 errors.
  - `npm run lessons:lint -- --strict`: 0 errors. 81 advisory warnings, all in 11 migrated-unreviewed lessons; the
    drafts have none.
  - `npm test`: 654 pass, 0 fail.

Next: the recorded confirmation verdict is REVISE (exit 1) and describes the draft before the fixes. A gate result of
exit 0 needs a fresh review of the fixed draft; the owner decides whether to run one. The owner still needs to list
`vibe-ch2-practice` in `course.json`.
