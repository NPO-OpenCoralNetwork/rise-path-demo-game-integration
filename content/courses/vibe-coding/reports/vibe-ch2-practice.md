# Report: vibe-coding/vibe-ch2-practice (draft)

**Status: DRAFT, not published, not listed in `course.json`. Verification round (2026-10-19): PASS,
`check-review.mjs` exits 0. Waiting for vibe-ch2, because both are published together. See "Verification round
(2026-10-19)" at the end of this report; it supersedes the final-gate status below.**

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

## Review round 1 (publish gate)

This section supersedes the status and "Next" lines of "Confirmation review (round 7)" above.

Owner decisions for this round:
1. Tune the ja-editor must-fix rules. This round's ja-editor review follows the tuned rules, so a must-fix must name an
   error class (a)–(e).
2. Write the product name as 「VS Code」. `summary-next` already does, so no draft change was needed.
3. Publish vibe-ch2 and vibe-ch2-practice once both pass the review gate.

Fresh, independent reviews of the round-7 draft (as committed in b53cdf1):

| reviewer | own average | verdict | must-fix |
|---|---|---|---|
| `pedagogy-reviewer` | 3.54 | pass | 0 |
| `ja-editor` | 3.5 | revise | 1 |
| `visual-qa` | — | pass | 0 |

They are saved over `reports/vibe-ch2-practice.<reviewer>.review.json`.

Preview: the workflow tried to preview this round, but it failed. `npm run -s lessons:preview -- vibe-coding
vibe-ch2-practice` exited 2 with "The dev server is not reachable at http://localhost:3007", because nothing was
listening on :3007 or :3006. No new PNGs or `metrics.json` were written. The evidence in visual-qa's review cites the
captures already in `.artifacts/preview/vibe-coding/vibe-ch2-practice/`. They were written at 10:02 UTC on 2026-10-19
from the round-7 post-fix draft, which is the draft this round reviewed.

Official verdict:
`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json`
exited **1**.

```
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.38 (needs ≥ 3.3) · every criterion ≥ 3
  align 4 · hook 4 · prior 3 · load 3 · worked 3 · active 3 · miscon 4 · visual 3 · practice 4 · meta 4 ·
  accuracy 3 · voice 3 · a11y_l10n 3
  1 must-fix: ja-editor ×1 (summary-cards / card-should-wont, voice)
```

| criterion | merged (lowest) | pedagogy-reviewer | ja-editor | visual-qa |
|---|---|---|---|---|
| align | 4 | 4 | — | — |
| hook | 4 | 4 | — | — |
| prior | **3** | 3 | 4 | — |
| load | **3** | 3 | 4 | 4 |
| worked | **3** | 3 | — | — |
| active | **3** | 3 | — | — |
| miscon | 4 | 4 | — | — |
| visual | **3** | 3 | — | 4 |
| practice | 4 | 4 | — | — |
| meta | 4 | 4 | — | — |
| accuracy | **3** | 3 | — | — |
| voice | **3** | 4 | 3 | — |
| a11y_l10n | **3** | 4 | 3 | 4 |
| **mean** | **3.38** | | | |

The verdict is REVISE only because 1 must-fix item was open. No criterion is below 3, and the mean passes.

The merged mean fell from 3.54 in round 7 to 3.38, for two reasons:
- pedagogy-reviewer now scores `prior` 3, because 1枚企画書 is not linked and its headings appear late.
- ja-editor now scores `a11y_l10n` 3, because of the awkward EN in `summary-points[1]` and `card-should-wont`.

The fixes below address both.

### Must-fix item, applied after this round

The recorded verdict above (REVISE, exit 1) describes the draft **before** this fix.

**R1. ja-editor / voice / `summary-cards` (`card-should-wont` back)**

Applied as given: 「Shouldは、重要だけれど、なくても最初の版が成り立つものです。Won'tは、この版では作らないと決めて、
企画書に書いておくものです。」 The card now words Should the same way as `practice-recap`, and the two noun-ending
sentences are gone. The EN applies the ja-editor's niceToHave: "A Won't is something you decide not to build in this
version and write down in the plan." It uses "decide" for 決めて, as round 7's ja-editor note suggested.

### niceToHave items applied

**Teaching items** (from the pedagogy-reviewer unless noted):
- **pq1 stem** (`active`; the reviewer's most useful fix): the AI's remark is now only 「Shouldでもよいかもしれません」.
  The EN is "the AI suggests it might fit under Should". The stem no longer restates answer a, so the learner has to
  apply the test themselves. The explanation now gives the reason: 「並べ替えがなくても、メモを見れば買い忘れは防げる
  ので、Mustから外してShouldにします。」
- **`practice-task`** (`practice` and `prior`):
  - The text now links [[1枚企画書]] / [[one-page plan]]. The glossary pop-up lists the plan's six items.
  - A third paragraph was added: 「演習1〜3の依頼文は、同じチャットで続けて送ります。最後に、チェックリストで
    仕上がりを確かめます。」 This makes 「ここまでの相談をもとに」 in `practice-prompt-plan` work. The checklist
    sentence moved there from paragraph 2, so each paragraph has 3 sentences or fewer.
- **`practice-flow` caption** (`visual`; flagged by both the pedagogy-reviewer and the ja-editor): it now reads
  「出欠確認アプリの例：Mustと画面の流れだけで、作成から人数の確認まで通る」 and "the Musts and the screen flow alone
  …". This is the ja-editor's wording, which mirrors `pc-flow`, so the caption no longer says that イベント一覧 is a Must
  screen.
- **pq2 explanation** (`accuracy`): it now ties the reminder to the goal: 「通知はなくても目的は果たせます。ただ、
  つけ忘れると次に見る前回の記録が残らないので、重要なShouldです。…」
- **`pc-must`** (`accuracy`): 「Mustが3つ以内（第2章の目安）で、…」 / "(the rule of thumb from Chapter 2)". The cap is
  now marked as the course's rule of thumb, which vibe-ch2 `ex-moscow` introduces, and not as part of MoSCoW.

**Wording items** (ja-editor unless noted):
- **`summary-points[1]` EN**: "A Must is only something the goal can't be met without."
- **`practice-recap` EN**: "agree" → "decide", to match the card.
- **pq3 stem**: 「レシピ一覧」 → 「レシピの一覧」, so it matches the Must's name.
- **`hook-b1`**: 「集金」 → 「参加費の集金」 and "fee collection" → "collecting fees", matching the model answer.
- **pq0 b**: 「…AIには問題を指摘してもらう」, so all four options end in もらう.
- **`card-must-test` front** (visual-qa, passed on to ja-editor): 「Mustにするか迷ったときの質問は？」

**Consistency with vibe-ch2**:
- The `practice-prompt` var hints reuse ch2's budget-app sort, so they follow ch2's must-fix R1:
  「Must＝食費の入力（…）、今月の食費の予算の設定と残り金額の表示（…）」, with the EN matching.
- The glossary entry for MoSCoW has the same four-group glosses as ch2.

### niceToHave items left open (reasons)

- **`hook-predict` title 「予想してみよう」**: it is a heading, which the reviewer accepts, and vibe-ch2's predict quiz
  uses the same title.
- **`practice-task` title 「つくる」**: the brief keeps this title on purpose, and the reviewer said no change is
  required.
- **Naming the plan's six headings in `practice-task`**: the [[1枚企画書]] link now shows them in the glossary pop-up.
  Listing them again would add body text.
- **visual-qa items**:
  - the end-of-course banner on draft previews (reader code; it goes away once the lesson is listed in `course.json`);
  - the desktop margins beside the TD diagram;
  - desktop JP lines of up to 44 characters (the median is 36).

### State after fixes

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body is about 2,150 JP characters, up from about 2,112, and under the 2,400 budget. The count covers prose, checklist
  labels, steps md and expect, and step hints and troubleshoot.
- estMinutes is unchanged at 20.
- Whole repository:
  - `npm run lessons:validate -- --drafts`: 15 lesson files and 1 course file, 0 errors.
  - `npm run lessons:lint -- --strict`: 0 errors. 81 advisory warnings, all in 11 migrated-unreviewed lessons.
- Preview: **not re-run**, because the dev server is down. The `practice-flow` caption and the `practice-task` text
  changed, so the fixed draft needs a new capture.

Next: the recorded gate verdict is REVISE (exit 1), and it describes the draft before these fixes. Owner-approved
publishing waits on a passing gate. The steps are:
1. Start the dev server (`npm run dev`).
2. Re-run `npm run lessons:preview -- vibe-coding vibe-ch2-practice` and check the PNGs.
3. Run a fresh independent review of the fixed draft (pedagogy-reviewer, ja-editor, visual-qa).
4. Publish only once `check-review.mjs` exits 0. Publishing also lists the lesson in `course.json` after vibe-ch2.

## Review round 2 (publish gate)

This section supersedes the status and "Next" lines of "Review round 1 (publish gate)" above.

The owner decisions are the same as in round 1:
1. The ja-editor must-fix rules are tuned, so every ja-editor must-fix names an error class (a)–(e).
2. The product name is written 「VS Code」. `summary-next` already does.
3. vibe-ch2 and vibe-ch2-practice are published once both pass the review gate.

Fresh, independent reviews of the round-1 post-fix draft (the working tree after "Review round 1"; not yet committed):

| reviewer | own average | verdict | must-fix |
|---|---|---|---|
| `pedagogy-reviewer` | 3.69 | pass | 0 |
| `ja-editor` | 4.0 | pass | 0 |
| `visual-qa` | 3.67 | pass | 0 |

They are saved over `reports/vibe-ch2-practice.<reviewer>.review.json`.

Preview: not re-run. `npm run -s lessons:preview -- vibe-coding vibe-ch2-practice` exited 2 with "The dev server is not
reachable at http://localhost:3007". Nothing was listening on :3006 or :3007, and `RISE_PATH_PREVIEW_BASE_URL` was not
set. No new PNGs or `metrics.json` were written. The newest captures in `.artifacts/preview/vibe-coding/vibe-ch2-practice/`
are from 10:02 UTC on 2026-10-19, which is the round-7 draft. They predate round 1's changes to the `practice-flow`
caption and the `practice-task` text.

Official verdict:
`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json`
exited **0**.

```
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: PASS
  mean 3.62 (needs ≥ 3.3) · every criterion ≥ 3
  align 4 · hook 4 · prior 4 · load 3 · worked 3 · active 4 · miscon 4 · visual 3 · practice 4 · meta 4 ·
  accuracy 3 · voice 3 · a11y_l10n 4
```

| criterion | merged (lowest) | pedagogy-reviewer | ja-editor | visual-qa |
|---|---|---|---|---|
| align | 4 | 4 | — | — |
| hook | 4 | 4 | — | — |
| prior | 4 | 4 | 4 | — |
| load | **3** | 3 | 4 | 4 |
| worked | **3** | 3 | — | — |
| active | 4 | 4 | — | — |
| miscon | 4 | 4 | — | — |
| visual | **3** | 4 | — | 3 |
| practice | 4 | 4 | — | — |
| meta | 4 | 4 | — | — |
| accuracy | **3** | 3 | — | — |
| voice | **3** | 3 | 4 | — |
| a11y_l10n | 4 | 4 | 4 | 4 |
| **mean** | **3.62** | | | |

**PASS**: every criterion is at least 3, the mean passes, and no must-fix is open. The merged mean rose from 3.38 in
round 1 to 3.62:
- `prior` rose to 4, now that 1枚企画書 is linked.
- `a11y_l10n` rose to 4 after the `summary-points` / `card-should-wont` EN fixes.
- `active` rose to 4.
- `visual` stays 3. pedagogy-reviewer now gives 4, but visual-qa gives 3 because the diagram has no lead-in sentence.

### Must-fix items

None. The draft was **not changed** in this round. This step changes only lessons that failed the gate, so the passing
draft stays exactly as reviewed.

### niceToHave items left open (candidates for a later round)

- **A lead-in sentence for `practice-flow`** (pedagogy-reviewer and visual-qa): two reviewers raised it, so it is the
  top candidate. Pedagogy also suggests placing `practice-flow` and `practice-checklist` directly after
  `practice-prompt-plan`, with `practice-tip` after them. This would lift visual-qa's `visual` score.
- Pedagogy:
  - a worked before/after revision for `p-revise`;
  - one phrase for the AI's role (「指摘だけを頼む」);
  - basing the pq2 d feedback on the scope edge;
  - hedging `practice-prompt-interview.expect`;
  - 「目安は15〜20分」.
- ja-editor:
  - matching glossary sentence endings (です);
  - giving pq5 c's feedback a next step;
  - the `summary-ask` EN wording;
  - making pq2's four options the same form.
- visual-qa reader items: a tap hint on mobile flashcards, and an end-of-course banner on draft previews (it goes away
  once the lesson is listed in `course.json`). The step header gap is also reader code. Keep the `practice-flow` chart
  TD.

### State

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body, estMinutes (20) and locales are unchanged since round 1.

Next: this lesson passes the gate (`check-review.mjs` exit 0), and its saved reviews describe the current draft.
vibe-ch2 is still REVISE (exit 1) until its one ja-editor must-fix is re-reviewed; the fix is already applied in that
draft. Decision 3 publishes once both pass. Both lessons' pedagogy reviews also recommend publishing them together,
because vibe-ch2's `summary-next` points here. Publishing moves the draft to `lessons/` and lists it in `course.json`
after vibe-ch2. That is the owner-approved publish step, not this authoring step. When the dev server is up, re-run
`npm run lessons:preview -- vibe-coding vibe-ch2-practice` so the round-1 changes get a capture.

## Final gate (2026-10-19)

Fresh independent reviews of the current draft (pedagogy-reviewer, ja-editor, visual-qa), run after the 11:07 UTC
preview. They are saved over the old JSON in `reports/vibe-ch2-practice.<reviewer>.review.json`. The preview of the
same draft was clean in all three views: no overflow, 0 console errors, 0 diagram errors, no text-only screens, JP
median 36 chars per line (target 30–40) and EN median 69 (target 60–75).

`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json`
→ **exit 1 (REVISE)**:

```text
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: REVISE
  mean 3.46 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer)
  ✓ prior      4  (ja-editor, pedagogy-reviewer)
  ✓ load       3  (ja-editor, pedagogy-reviewer, visual-qa)
  ✓ worked     3  (pedagogy-reviewer)
  ✓ active     3  (pedagogy-reviewer)
  ✓ miscon     3  (pedagogy-reviewer)
  ✓ visual     3  (pedagogy-reviewer, visual-qa)
  ✓ practice   4  (pedagogy-reviewer)
  ✓ meta       4  (pedagogy-reviewer)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor, pedagogy-reviewer, visual-qa)
  must fix [voice] check-quiz: (d) §5 options must have the same form and ending: in pq2, options a and b are noun lists (「Should：つけ忘れた日の通知／Won't：友だちとのランキング」), while c and d are verb phrases ending in 「作る」 and 「おく」. → pq2 a: 「Should：つけ忘れた日の通知／Won't：友だちとのランキング」→「つけ忘れた日の通知をShould、友だちとのランキングをWon'tにする」 (en: 'Make the forgot-to-log reminder a Should and the friends leaderboard a Won't'). pq2 b: 「Should：友だちとのランキング／Won't：つけ忘れた日の通知」→「友だちとのランキングをShould、つけ忘れた日の通知をWon'tにする」 (en: 'Make the friends leaderboard a Should and the forgot-to-log reminder a Won't'). pq2 c: 「2つともMustに入れて、最初の版で作る」→「2つともMustにして、最初の版で作る」. d stays as it is.
  must fix [miscon] practice-check: pq1 is the only item where the learner judges an AI remark, and it gives the answer away. Option a carries the recap's criterion as its reason (「なくても目的は果たせるので」), so the learner can match words instead of evaluating. The AI's remark is also correct, so the core misconception 1 (「分けるのはAIに任せればよい」) is never tested. A learner who simply follows the AI still gets the right answer here, in pq0's explanation and in the model answer, so o3's 「判断できる」 is not really assessed. → In pq1, give the AI two remarks, one right and one wrong. Put no reason in the correct option. Keep id, objectiveId o3, bloom evaluate and the hint. prompt.jp: 「買い物メモアプリの目的は「家族が、買い物中に買い忘れをしない」です。Mustは「品物の追加」と「お店ごとの並べ替え」です。AIは2つとも「Shouldでもよいかもしれません」と指摘しました。最も適切な判断はどれでしょう？」 / en: "A shopping-list app has the goal \"family members don't forget anything while shopping\". Its Musts are \"add items\" and \"sort items by shop\". The AI suggests both might fit under Should. Which decision is best?". Options (answer a): a 「並べ替えだけShouldに移し、品物の追加はMustに残す」 / "Move only the sorting to Should; keep adding items as a Must". b 「AIの指摘どおり、2つともShouldに移す」 / "Follow the AI and move both to Should", feedback 「品物を追加できないと、メモが作れず目的を果たせません。指摘は1つずつ、目的に照らして確かめます。」 / "Without adding items there is no list, so the goal can't be met. Check each point against the goal, one at a time.". c 「2つとも便利なので、Mustに残す」 / "Keep both as Musts, since both are handy", feedback 「便利さは、Mustかどうかの物差しではありません。並べ替えがなくても、メモを見れば買い忘れは防げます。」 / "Being handy isn't what makes a Must. Even without sorting, the list itself keeps you from forgetting things.". d 「並べ替えはWon'tにして、企画書から消す」 / "Make the sorting a Won't and delete it from the plan", keeping the current d feedback. explanation 「AIの指摘は、判断の材料です。品物の追加がないとメモが作れないので、Mustに残します。並べ替えはなくても買い忘れは防げるので、Shouldに移します。」 / "The AI's points are input for your decision. Without adding items there is no list, so it stays a Must. The goal can be met without sorting, so that moves to Should."
```

| Reviewer | Average | Verdict | Must-fix |
|---|---|---|---|
| pedagogy-reviewer | 3.46 | revise | 1 (`miscon`, practice-check pq1) |
| ja-editor | 3.75 | revise | 1 (`voice`, check-quiz pq2) |
| visual-qa | 4 | pass | 0 |
| **Merged** (lowest per criterion) | **3.46** | **REVISE** | **2** |

Every criterion is at least 3 and the mean clears 3.3, so the only blockers are the two must-fix items. This lesson
passed the round-2 gate, but the fresh reviews found two new blockers. **Not published**: the owner's decision
publishes vibe-ch2 and vibe-ch2-practice together only when both exit 0, and both exited 1.

### Must-fix items, applied after the gate

These were applied to the draft after the gate ran, so the saved reviews describe the draft before them.

- **pq2 options** (ja-editor, (d) options with the same form and ending, §5): the reviewer's exact text. a and b were
  noun lists, while c and d were verb phrases.
  - a 「Should：つけ忘れた日の通知／Won't：友だちとのランキング」 → 「つけ忘れた日の通知をShould、友だちとのランキングを
    Won'tにする」 / "Make the forgot-to-log reminder a Should and the friends leaderboard a Won't"
  - b 「Should：友だちとのランキング／Won't：つけ忘れた日の通知」 → 「友だちとのランキングをShould、つけ忘れた日の通知を
    Won'tにする」 / "Make the friends leaderboard a Should and the forgot-to-log reminder a Won't"
  - c 「2つともMustに入れて、最初の版で作る」 → 「2つともMustにして、最初の版で作る」. Its EN ("Make both Musts and build
    them in the first version") already matches. d, the key, the feedback and the explanation are unchanged.
- **pq1** (pedagogy-reviewer, `miscon`): a clear assessment error, because the key was the only option that carried
  the recap's rule as its reason, and the AI's remark was always right, so the item did not test whether the learner
  judges the AI (o3). Rewritten with the reviewer's exact JP and EN: the app now has two Musts (品物の追加, お店ごとの
  並べ替え), and the AI suggests both might be Should; only the sorting should move. Id, objectiveId o3, bloom evaluate,
  the hint, key a and d's feedback stay.
  - a (key) 「並べ替えだけShouldに移し、品物の追加はMustに残す」 / "Move only the sorting to Should; keep adding items as
    a Must"
  - b 「AIの指摘どおり、2つともShouldに移す」 / "Follow the AI and move both to Should", with new feedback on following
    the AI without checking each point against the goal.
  - c 「2つとも便利なので、Mustに残す」 / "Keep both as Musts, since both are handy", with new feedback that handiness
    is not the yardstick.
  - d 「並べ替えはWon'tにして、企画書から消す」 / "Make the sorting a Won't and delete it from the plan"
  - explanation 「AIの指摘は、判断の材料です。品物の追加がないとメモが作れないので、Mustに残します。並べ替えはなくても
    買い忘れは防げるので、Shouldに移します。」 and the matching EN.

No niceToHave items were applied in this step. These remain open: a rejected AI remark in the club model answer, who
writes the goal sentence in p-interview, a lead-in for practice-flow, a worked revise example, hedging
practice-prompt-interview.expect, the time estimate in practice-task (pedagogy); 「知れる」, 「勝手に」, glossary
endings, the pq3 EN label, the summary-ask EN, the two 「〜ましょう」 in summary-next and the pq2 explanation (ja-editor);
the desktop height of practice-flow and the reader items (visual-qa).

### State after fixes

- `npm run -s lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json …` → 0 errors.
- `npm run -s lessons:lint -- … --strict` → 0 errors, 0 warnings.
- Body text, estMinutes (20) and the diagram are unchanged. The edits touch only quiz text (pq1 and pq2). The 11:07 UTC
  preview still describes every other block.

Next: re-review the current draft (at least pedagogy-reviewer for pq1 and ja-editor for pq1 and pq2), save the JSON
over the old files, and re-run `check-review.mjs`. Publish together with vibe-ch2 only when both exit 0.

## Verification round (2026-10-19)

The first round under the owner's fix-verification mode (decision of 2026-10-19). Round 1 of the publish gate was a
full review; this round only checks the previous must-fix items and looks for errors the fixes introduced. The bar is
the same: `check-review.mjs` must exit 0, with every criterion ≥ 3 and a mean ≥ 3.3.

### Scope

`node .claude/skills/review-lesson/scripts/review-scope.mjs content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json --since 784d2d9`
→ exit 0, so a verification round is allowed. The draft at `784d2d9` is identical to `5d2a414`, which the saved
final-gate reviews read. The draft the reviewers read is the one committed in `dcb3095`, and it is unchanged since.

```text
Changes in content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json since 784d2d9
  2 of 20 blocks changed (10%; above 30% a full review is required) · sections and objectives unchanged
  → VERIFY: a fix-verification round is allowed. Every change below is reviewed in full.
  modified  practice-sort / practice-check  questions.pq1
  modified  check / check-quiz              questions.pq2

verifies (copy into each verification review and add "previousReview"):
  {"reviewedRevision":"784d2d9","changed":["practice-check","check-quiz"],"changedShare":0.1,"fullReviewRequired":false}
```

The reviewers got only these facts (lesson, previous review, revision, `verifies` line), not a view of what was fixed.
visual-qa has no shell. It took the changed blocks from the lesson file and this report, and its list matches
`review-scope.mjs`.

### Gate

The three verification reviews are saved over the old JSON in `reports/vibe-ch2-practice.<reviewer>.review.json`.
The previous reviews stay in git at `dcb3095`.

`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json`
→ **exit 0 (PASS)**. Each review's `verifies.previousReview` names the file it overwrote, so this run could not
cross-check the previous round:

```text
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: PASS
  ja-editor: verification of 784d2d9 (previous review not loaded) · 1 resolved, 0 unresolved · 2 changed · carried over: load, prior
  pedagogy-reviewer: verification of 784d2d9 (previous review not loaded) · 1 resolved, 0 unresolved · 2 changed · carried over: hook, prior, load, worked, visual, practice, meta
  visual-qa: verification of 784d2d9 (previous review not loaded) · 0 resolved, 0 unresolved · 2 changed · carried over: visual, load
  mean 3.62 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor carried, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor carried, pedagogy-reviewer carried, visual-qa carried)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     4  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     3  (pedagogy-reviewer carried, visual-qa carried)
  ✓ practice   4  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor, pedagogy-reviewer, visual-qa)
  resolved [voice] check-quiz (ja-editor)
  resolved [miscon] practice-check (pedagogy-reviewer)
  note: ja-editor: verifies.previousReview is the file being checked (overwritten by this round); pass --previous <commit>:<path> or the snapshot copy
  note: pedagogy-reviewer: verifies.previousReview is the file being checked (overwritten by this round); pass --previous <commit>:<path> or the snapshot copy
  note: visual-qa: verifies.previousReview is the file being checked (overwritten by this round); pass --previous <commit>:<path> or the snapshot copy
  note: ja-editor: the previous review (content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json) was not loaded, so nothing checked that "resolved" covers every previous must-fix; pass --previous <file or commit:path>
  note: pedagogy-reviewer: the previous review (content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json) was not loaded, so nothing checked that "resolved" covers every previous must-fix; pass --previous <file or commit:path>
  note: visual-qa: the previous review (content/courses/vibe-coding/reports/vibe-ch2-practice.visual-qa.review.json) was not loaded, so nothing checked that "resolved" covers every previous must-fix; pass --previous <file or commit:path>
```

With the previous reviews from git, as the notes ask:
`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json --previous dcb3095:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json --previous dcb3095:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json --previous dcb3095:content/courses/vibe-coding/reports/vibe-ch2-practice.visual-qa.review.json`
→ **exit 0 (PASS)**. Every previous must-fix has a `resolved` entry, and every carried-over score equals the
previous score:

```text
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: PASS
  ja-editor: verification of 784d2d9 (previous review cross-checked) · 1 resolved, 0 unresolved · 2 changed · carried over: load, prior
  pedagogy-reviewer: verification of 784d2d9 (previous review cross-checked) · 1 resolved, 0 unresolved · 2 changed · carried over: hook, prior, load, worked, visual, practice, meta
  visual-qa: verification of 784d2d9 (previous review cross-checked) · 0 resolved, 0 unresolved · 2 changed · carried over: visual, load
  mean 3.62 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor carried, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor carried, pedagogy-reviewer carried, visual-qa carried)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     4  (pedagogy-reviewer)
  ✓ miscon     4  (pedagogy-reviewer)
  ✓ visual     3  (pedagogy-reviewer carried, visual-qa carried)
  ✓ practice   4  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   3  (pedagogy-reviewer)
  ✓ voice      3  (ja-editor, pedagogy-reviewer)
  ✓ a11y_l10n  4  (ja-editor, pedagogy-reviewer, visual-qa)
  resolved [voice] check-quiz (ja-editor)
  resolved [miscon] practice-check (pedagogy-reviewer)
```

| Reviewer | Mode | Resolved | Unresolved | Carried over | Average | Verdict | New must-fix |
|---|---|---|---|---|---|---|---|
| pedagogy-reviewer | verify | 1 (`miscon`, practice-check pq1) | 0 | hook, prior, load, worked, visual, practice, meta | 3.62 | pass | 0 |
| ja-editor | verify | 1 (`voice`, check-quiz pq2) | 0 | load, prior | 3.75 | pass | 0 |
| visual-qa | verify | 0 (none were open) | 0 | visual, load | 4 | pass | 0 |
| **Merged** (lowest per criterion) | | **2** | **0** | | **3.62** | **PASS** | **0** |

Both must-fix items from the final gate are resolved, no reviewer found a regression, every criterion is ≥ 3 and the
mean is 3.62. This lesson passes the gate.

**Not published.** The owner's decision publishes vibe-ch2 and vibe-ch2-practice together only when both pass, and
vibe-ch2 exited 1 (one new must-fix in q8, applied after its gate; see `reports/vibe-ch2.md`). `lessons/`,
`course.json` and `provenance.reviewedBy` are untouched. This draft was not edited in this round.

No niceToHave items were applied. These remain open:
- pedagogy-reviewer: make pq1 d split the two features too; quote "add items" in the pq1 a EN; the carried-over items
  (a rejected AI remark in the club model answer, the goal sentence in p-interview, a lead-in for practice-flow, a
  worked revise example, hedging practice-prompt-interview.expect, a time estimate in practice-task).
- ja-editor: the pq1 a and explanation EN, 「知れる」, 「勝手に」, glossary endings, the pq3 EN label, the summary-ask EN,
  and the pq2 explanation.
- visual-qa: an answered-state capture for the pq1 and pq2 feedback, the desktop height of practice-flow, and reader
  items.

### CI steps and checks

The same run as in `reports/vibe-ch2.md` ("Verification round", after the vibe-ch2 q8 fix):
- `npm run lessons:validate` and `-- --drafts`: no errors.
- `npm run lessons:lint -- --strict`: exit 0, with advisory warnings only in migrated-unreviewed lessons. Both
  chapter 2 drafts have 0 warnings.
- `lessons:schema --check` and `build-references.mjs --check`: up to date.
- `npm run typecheck`: 0 errors.
- `npm test`: 677 of 677 pass.
- `build:prod`: built.
- `lessons:catalog --short`: this draft is "draft, 20min, obj 2, valid, lint 0 — not in course.json".

Next: wait for vibe-ch2's verification round on its q8 fix. If that exits 0, publish both together. This lesson needs
no new review unless its draft changes.

## Published (2026-10-19)

- Gate: `check-review.mjs` exit 0 (PASS) with previous reviews cross-checked via `--previous`.
  vibe-ch2: mean 3.46, every criterion ≥ 3, no open must-fix (final fix-verification round on q8).
  vibe-ch2-practice: mean 3.62, every criterion ≥ 3, no open must-fix.
- Published on the owner's approval: moved from `drafts/` to `lessons/`; `course.json` lists
  vibe-ch2 (18 min) → vibe-ch2-practice (20 min) → vibe-ch3. `provenance.reviewedBy` is left to the owner.
- Checks after publishing: lessons:validate 0 errors, lint --strict 0 warnings for both lessons,
  typecheck 0 errors, npm test 677/677, build:prod OK, real-route screenshots without page errors.

## Gate re-verification under the fixed check-review (2026-10-19)

The review gate was rewritten after publishing (PR #20 review findings F1–F10 and the bypasses an adversarial test
found). Every review now records `lessonHash`, the hash of the lesson it read, and the gate refuses a review whose hash
is not the lesson's hash now. A verification is checked against a recorded previous round (`<commit>:<reports file>`
or a snapshot copy), and that round is followed back to its full review. A previous round without `lessonHash` is
accepted only with `--allow-legacy`. The PASS under "Published" above came from the old gate, and the reviews
committed with it have no `lessonHash`.

### Round

All three reviewers re-checked the published file `content/courses/vibe-coding/lessons/vibe-ch2-practice.lesson.json`.

- Scope: `node .claude/skills/review-lesson/scripts/review-scope.mjs content/courses/vibe-coding/lessons/vibe-ch2-practice.lesson.json --since dcb3095`
  → exit 0: 0 of 20 blocks changed, sections and objectives unchanged. `dcb3095` holds the draft that the previous
  reviews (recorded in `bb56d49`, unchanged in `c961471`) read. The published file is byte-identical to it.
- `lessonHash` (`review-scope.mjs … --hash`): `sha256:7dfd5355b05405d5`.
- Preview of the published lesson (`npm run lessons:preview -- vibe-coding vibe-ch2-practice`): desktop-jp, mobile-jp
  and desktop-en with no overflow, console, diagram, unknown-block or image errors.
- The reviews are saved over `reports/vibe-ch2-practice.<reviewer>.review.json`. The previous ones stay in git at
  `c961471`.

| Reviewer | Mode | lessonHash | Previous review | Carried over | Average | Verdict | Must-fix |
|---|---|---|---|---|---|---|---|
| pedagogy-reviewer | verify (since `dcb3095`) | `sha256:7dfd5355b05405d5` | `c961471:…/vibe-ch2-practice.pedagogy-reviewer.review.json` | all 13 criteria | 3.62 | pass | 0 |
| ja-editor | verify (since `dcb3095`) | `sha256:7dfd5355b05405d5` | `c961471:…/vibe-ch2-practice.ja-editor.review.json` | voice, load, prior, a11y_l10n | 3.75 | pass | 0 |
| visual-qa | full | none | — | — | 4 | pass | 0 |

visual-qa has no shell and was not given the lessonHash or the `verifies` line. It left the hash out rather than invent
it, and did a full check of the new screenshots instead of a verification.

### Gate

`node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch2-practice.*.review.json`
→ **exit 2 (not a valid set of reviews)**:

```text
Not a valid set of reviews of content/courses/vibe-coding/lessons/vibe-ch2-practice.lesson.json (sha256:7dfd5355b05405d5):
  - stale: review 3 (visual-qa) has no "lessonHash", so nothing shows which version of the lesson it read; review content/courses/vibe-coding/lessons/vibe-ch2-practice.lesson.json again (or pass --allow-legacy for a review written before lessonHash existed)
  - review 1 (ja-editor): its previous review c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json has no "lessonHash", so nothing binds verifies.reviewedRevision (dcb3095) to the version it read; verify a review that records lessonHash or do a full review (--allow-legacy accepts reviews written before lessonHash existed)
  - review 2 (pedagogy-reviewer): its previous review c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json has no "lessonHash", so nothing binds verifies.reviewedRevision (dcb3095) to the version it read; verify a review that records lessonHash or do a full review (--allow-legacy accepts reviews written before lessonHash existed)
```

Why it does not pass:

1. **visual-qa is stale.** Its review has no `lessonHash`. It was written after the field existed, so `--allow-legacy`
   is not the way to accept it. visual-qa needs to run again with the lessonHash `sha256:7dfd5355b05405d5` from the
   author.
2. **pedagogy-reviewer and ja-editor verify a round without `lessonHash`.** Their previous reviews in `c961471` (the
   `bb56d49` round), and the round before them at `dcb3095`, predate the field. The fixed gate checks such a chain only
   with `--allow-legacy`.

For diagnosis only, not the gate result: the same command with `--allow-legacy` exits 0 (PASS). Both
verifications are cross-checked against `c961471` and 1 earlier round (`dcb3095`), and the scope is recomputed from
`dcb3095:content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json` (0 changed). Every criterion is ≥ 3, the
mean is 3.62 and no must-fix is open. The notes name each legacy review the flag accepted:

```text
Review of vibe-ch2-practice by ja-editor, pedagogy-reviewer, visual-qa: PASS
  lesson content/courses/vibe-coding/lessons/vibe-ch2-practice.lesson.json (sha256:7dfd5355b05405d5)
  ja-editor: verification of dcb3095 (previous review cross-checked; scope recomputed from dcb3095:content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json) · 0 resolved, 0 unresolved · 0 changed · carried over: voice, load, prior, a11y_l10n · previous c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json and 1 earlier round checked
  pedagogy-reviewer: verification of dcb3095 (previous review cross-checked; scope recomputed from dcb3095:content/courses/vibe-coding/drafts/vibe-ch2-practice.lesson.json) · 0 resolved, 0 unresolved · 0 changed · carried over: align, hook, prior, load, worked, active, miscon, visual, practice, meta, accuracy, voice, a11y_l10n · previous c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json and 1 earlier round checked
  visual-qa: full review
  mean 3.62 (needs ≥ 3.3) · every criterion ≥ 3
  ✓ align      4  (pedagogy-reviewer carried)
  ✓ hook       4  (pedagogy-reviewer carried)
  ✓ prior      4  (ja-editor carried, pedagogy-reviewer carried)
  ✓ load       3  (ja-editor carried, pedagogy-reviewer carried, visual-qa)
  ✓ worked     3  (pedagogy-reviewer carried)
  ✓ active     4  (pedagogy-reviewer carried)
  ✓ miscon     4  (pedagogy-reviewer carried)
  ✓ visual     3  (pedagogy-reviewer carried, visual-qa)
  ✓ practice   4  (pedagogy-reviewer carried)
  ✓ meta       4  (pedagogy-reviewer carried)
  ✓ accuracy   3  (pedagogy-reviewer carried)
  ✓ voice      3  (ja-editor carried, pedagogy-reviewer carried)
  ✓ a11y_l10n  4  (ja-editor carried, pedagogy-reviewer carried, visual-qa)
  note: LEGACY REVIEW: review 3 (visual-qa) has no "lessonHash", so nothing shows it read content/courses/vibe-coding/lessons/vibe-ch2-practice.lesson.json as it is now (sha256:7dfd5355b05405d5); accepted only because of --allow-legacy
  note: LEGACY PREVIOUS REVIEW: ja-editor: c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json has no "lessonHash"; the scope since dcb3095 is bound only to c961471 or an earlier commit, not to the version it read; accepted only because of --allow-legacy
  note: LEGACY PREVIOUS REVIEW: c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json: its previousReview names its own reports file; the round before it is dcb3095:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json, the version of that file before it
  note: LEGACY PREVIOUS REVIEW: c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json: dcb3095:content/courses/vibe-coding/reports/vibe-ch2-practice.ja-editor.review.json has no "lessonHash"; the scope since 784d2d9 is bound only to dcb3095 or an earlier commit, not to the version it read; accepted only because of --allow-legacy
  note: LEGACY PREVIOUS REVIEW: pedagogy-reviewer: c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json has no "lessonHash"; the scope since dcb3095 is bound only to c961471 or an earlier commit, not to the version it read; accepted only because of --allow-legacy
  note: LEGACY PREVIOUS REVIEW: c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json: its previousReview names its own reports file; the round before it is dcb3095:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json, the version of that file before it
  note: LEGACY PREVIOUS REVIEW: c961471:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json: dcb3095:content/courses/vibe-coding/reports/vibe-ch2-practice.pedagogy-reviewer.review.json has no "lessonHash"; the scope since 784d2d9 is bound only to dcb3095 or an earlier commit, not to the version it read; accepted only because of --allow-legacy
```

### Must-fix items

None. No review has a must-fix item and no block changed since `dcb3095`, so nothing was applied. The lesson file is
unchanged.

### State

- **Does not pass the fixed gate (exit 2).** The lesson stays published: `lessons/vibe-ch2-practice.lesson.json`
  and `course.json` are unchanged.
- A further round is needed. visual-qa must run again with the lessonHash. To pass without `--allow-legacy`,
  pedagogy-reviewer and ja-editor also need a full review that records `lessonHash`, because any verification of the
  PR #20 rounds rests on reviews without it. Whether the legacy chain may pass with `--allow-legacy` instead is the
  owner's decision.
- Checks with these reviews saved:

| command | result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` | 728 tests, 728 pass, 0 fail |
| `npm run lessons:validate` | 14 lesson files, 1 course file: no errors |
| `npm run lessons:lint -- --strict` | exit 0, 0 errors. 71 advisory warnings, all in 10 migrated-unreviewed lessons; both chapter 2 lessons clean |
| `npm run lessons:schema -- --check` | generated schemas up to date |
| `node .claude/skills/author-lesson/scripts/build-references.mjs --check` | references up to date |
| `npm run build:prod -- --outDir <tmp dir> --emptyOutDir` with the CI sentinel keys | built; no sentinel key in the 3246 built files |
