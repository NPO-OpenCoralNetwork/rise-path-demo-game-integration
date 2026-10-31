# Report: vibe-coding/vibe-ch1 (draft rework)

**Status: DRAFT in `content/courses/vibe-coding/drafts/vibe-ch1.lesson.json`. Gate: PASS (`check-review.mjs` exit 0
over pedagogy-reviewer and ja-editor (round 3 verification) and visual-qa (full check), mean 3.77, every criterion ≥ 3,
no open must-fix) at lesson hash `sha256:1d967dfe70f0b1a4`. Preview: no overflow, console errors or diagram errors.
Not published: moving it to `lessons/` is the owner's call (see "Publishing: what changes" at the end).**

- Lesson: 第1章｜人間が理解すべき最低ライン / Chapter 1 | Minimum Viable Knowledge. Rework of the published
  `lessons/vibe-ch1.lesson.json` (author `human+claude-code`, 2026-10-18) under the grounded authoring rules of PR #74
  (plan 「出典と検索」). `provenance.migratedFrom` is kept; the author is now `claude-code` (skill `author-lesson` v1,
  2026-10-30), so the lesson is linted strict, also after publishing. `provenance.reviewedBy` is left to the owner.
- Why this lesson: it is the exemplar. `author-lesson` names it under "Read first", and MCP `lesson-schema-get`
  returns it (`tools/core/lessons.js` `EXEMPLAR`, first section of each role). The published version has no sources,
  an analogy before 1 of its 3 definitions blocks, no worked example, no practice and no exam question for o1, and
  two questions that quiz the analogy. The draft shows every role (hook, concept, example, practice, check, summary).
- Brief and outline: `content/courses/vibe-coding/briefs/vibe-ch1.md`. Fact record (what each source says, where):
  `content/courses/vibe-coding/reports/facts/vibe-ch1.facts.md`.
- Locales: jp, en. Level: beginner. Prerequisite: ch0.

## Objectives

The ids, wording and Bloom levels of the published lesson are kept, so `lessonSchema.test.js` keeps its 3 objectives.
Round 1 removed only the spaces around UI, API and Git in o2 and o3 (notation rule).

| id | bloom | jp | assessed by |
|---|---|---|---|
| o1 | understand | フロントエンド・バックエンド・データベースの役割の違いを説明できる | q0 (predict, ungraded), q1 (inline), q6 (exam, transfer: booking app) |
| o2 | apply | 変えたいものがUIかAPIかを見分けて、AIへの依頼を書き分けられる | q2 (inline, from the JSON shown), q9 (inline, faded step of the worked example), q5 (exam, transfer: budget app) |
| o3 | understand | デプロイとGitのコミットが何をしているかを説明できる | q7 (inline, the launch stage), q8 (inline), q4 (exam, the build stage), q3 (exam, transfer: a friend's claim) |

## What changed against the published lesson

- Kept: every id of the published lesson (7 sections, all blocks, `q0`–`q5` with their option ids, the 5 card ids).
- Added: sections `1-5` (worked example, 6 cited steps) and `practice` (3 cited steps with folded hints, a 6-item
  checklist, model answers for all 3 requests); blocks `s2-analogy`, `s3-analogy`, `s3-defs`, `s3-flow`, `s3-check`,
  `s4-analogy`, `s4-tools`, `s4-check`, `ex-lead`, `ex-steps`, `ex-check`, `practice-*`, `summary-next`,
  `summary-ask`; questions `q6`–`q9`; cards `card-database`, `card-ui-api`; `glossary` (10 terms) and `sources` (20, all
  read on 2026-10-30).
- Rewritten: `q1` (asked which part of the restaurant is the backend: it quizzed the analogy) and `q3` (asked why Git is
  called a time machine: same). `q2` now asks which change needs data the JSON above does not hold; `q4` and `q5`
  became application items. The options of every question keep their ids and answers, in an order that spreads the
  keys over ①–④; no key is longer than its longest distractor in either locale.
- Removed claims no source supports: "knowing frontend vs backend raises the accuracy of generated code a lot", "one
  command takes you back for sure", "revert returns you to an earlier save point" (`git revert` adds a new commit), and
  example tool names (React, Vue.js, Node.js, Python, PostgreSQL, MySQL, Vercel, Render). The definitions of push and
  revert were dropped (push is taught in ch5). See facts §5.
- Analogies (beginner rule): 1-1 restaurant (客席とウェイター＝フロントエンド, シェフ＝バックエンド, 食材庫＝データベース);
  1-2 the same restaurant (メニュー＝UI, ウェイターが厨房に注文を通す決まった頼み方＝API, 注文票の書き方＝JSON);
  1-3 homemade sweets sold at a stall (家＝自分のパソコン, 売り場＝サーバー, 袋に詰める＝ビルド, 運ぶ＝転送,
  売り場を開ける＝起動, 全体＝デプロイ); 1-4 saving a game (セーブを残す仕組み＝Git, 1回のセーブ＝コミット). Each comes
  before its segment's definitions block; no question asks about an analogy.
- UI steps: the lesson names no menu, button, screen or keyboard shortcut of a real tool. Reloading the page is
  described as the goal.

## Review round 1 (full, 2026-10-30)

Both reviewers read the draft at `sha256:0f75d3b51a941859` (commit 978c361). Reviews committed in d08408e; snapshot
`.artifacts/review/vibe-coding/vibe-ch1/0f75d3b51a941859/round-1/`. Gate: exit 1 (REVISE), mean 3.0.

| criterion | score (lowest) | by |
|---|---|---|
| align | 4 | pedagogy-reviewer |
| hook | 3 | pedagogy-reviewer |
| prior | 3 | ja-editor, pedagogy-reviewer |
| load | 3 | ja-editor 4, pedagogy-reviewer 3 |
| worked | 3 | pedagogy-reviewer |
| active | **2** | pedagogy-reviewer |
| miscon | 3 | pedagogy-reviewer |
| visual | 4 | pedagogy-reviewer |
| practice | 3 | pedagogy-reviewer |
| meta | 3 | pedagogy-reviewer |
| accuracy | **2** | pedagogy-reviewer |
| voice | 3 | ja-editor, pedagogy-reviewer |
| a11y_l10n | 3 | ja-editor 4, pedagogy-reviewer 3 |

Must-fix items and what changed (commits 2a3741a and 3b2795f):

| # | reviewer | criterion / block | issue | resolution |
|---|---|---|---|---|
| 1 | pedagogy | active / lesson | the key was the longest option in all 10 questions and option ② in 8 | options reordered (ids and answers kept): keys now at ③④③①④③④①②② (q0, q1, q2, q7, q8, q9, q6, q5, q4, q3); no key is longer than its longest distractor, in jp or en |
| 2 | pedagogy | active / ex-check | q9 asked for the 「最初に送る依頼」, against the commit-first step | the stem says the commit is done and asks for the next request |
| 3 | pedagogy | practice / practice-answer-ui | the model answers gave no way to enter the date | the screen-side model answer lets the learner enter it and save it through the API; checklist item `pc-input` |
| 4 | pedagogy | accuracy / check-quiz | q3 stated for every AI tool what the cited page says of Claude Code | q3 feedback and explanation say a rewind "does not necessarily" replace Git and name Claude Code's documentation; option d's feedback no longer claims AI behaviour |
| 5 | pedagogy | meta / summary-points | the o2 takeaway and `card-ui-api` said to ask the UI or the API | "ask the AI for a UI change or an API change" in the summary, the card, `s2-ask` and `summary-next` |
| 6 | ja-editor | prior / hook-predict | バックエンド and データベース used in the hook before 1-1, without English | the hook no longer uses them (q0 b 「データを保存する仕組みがないから」, explanation 「専用の保存場所」); options a and c got feedback |
| 7 | ja-editor | voice / s2-prompt-ui | the jp request did not parse with its own hint | hint 「例：薄い灰色の文字」 |
| 8 | ja-editor | voice / s4-prompt-commit | same | hint 「例：タスクに期限を付ける変更」 |
| 9 | ja-editor | voice / practice-hint | hint 2 pointed at the learner's own, possibly wrong, q9 choice | the hints moved into the cited `practice-steps` block (folded: hint, then troubleshoot); the troubleshoot names 「正解だった依頼」 |
| 10 | ja-editor | voice / lesson | spaces around UI, API and Git in o2 and o3 | removed (wording, ids and Bloom unchanged) |

niceToHave items applied: the s2 analogy keeps 1-1's mapping (ウェイター); one name for one thing (保存と取り出し in
the definitions, diagram, q1 and cards); サーバー（server：…）; a sweets-stall analogy for deployment, so the restaurant
stays on the browser and server sides it had in 1-1; q7 now tests the launch step and q4 says the build ran on your own
computer; a more tempting q6 distractor (hiding full slots on the screen only); reason for step ⑤; two causes in the
step ⑥ troubleshoot; model answers numbered as the 2nd and 3rd requests; EN fixes (s2-b5 singular guide, q2 prompt,
ex-lead, no "just"); 1-1 title with 「・」. Not applied: crowding of section 1-2 (10 blocks) was left as is, since every
block there serves o2 and `s2-ask` keeps a published id.

## Review round 2 (full, 2026-10-30)

A full review, because `review-scope.mjs` required one (the objectives' notation changed and 38 of 45 blocks changed
since round 1). Both reviewers read `sha256:424abcffc3b15ca6` (commit 3b2795f). Reviews committed in aae0299; snapshot
`.artifacts/review/vibe-coding/vibe-ch1/424abcffc3b15ca6/round-1/`. The first attempt stopped on the account's usage
limit; both reviewers resumed after it reset. Gate: exit 1 (REVISE): every criterion ≥ 3 and mean 3.31, but 6 must-fix
items open.

| criterion | pedagogy-reviewer | ja-editor | lowest |
|---|---|---|---|
| align | 4 | — | 4 |
| hook | 3 | — | 3 |
| prior | 3 | 4 | 3 |
| load | 3 | 3 | 3 |
| worked | 4 | — | 4 |
| active | 3 | — | 3 |
| miscon | 3 | — | 3 |
| visual | 4 | — | 4 |
| practice | 3 | — | 3 |
| meta | 4 | — | 4 |
| accuracy | 3 | — | 3 |
| voice | 3 | 3 | 3 |
| a11y_l10n | 4 | 3 | 3 |

Must-fix items and what changed (commit d798e86, 13 of 44 blocks, so the next round could be a verification):

| # | reviewer | criterion / block | issue | resolution |
|---|---|---|---|---|
| 1 | pedagogy | active / s2-check | q2 could be answered by matching the tip's words | q2 asks about the JSON shown above: only the assignee's name is missing from it; strike-through and shortening use data that is already there |
| 2 | pedagogy + ja-editor | prior, voice / ex-steps | step ② gave saving to the database, against s1-b5 and q1 | 「タスクをしまっておくのは[[データベース]]、保存と一覧の受け渡しは[[バックエンド]]の[[API]]…」 |
| 3 | ja-editor | a11y_l10n / ex-check | q9's en key had lost "yet", which its explanation quotes | "Don't change the screen yet." |
| 4 | ja-editor | voice / check-quiz | q3's key alone did not end in 「よ」 | 「頼む前に動く状態をコミットしておけば、戻れるよ」 |
| 5 | ja-editor | voice / practice-checklist | labels in plain form | です・ます |

niceToHave items applied in the same 13 blocks: q0 c is now a belief beginners hold (the AI keeps the tasks); deployment
"has three stages" instead of "three things happen in order" (s3-flow, q7, card-deploy; hosts may build on their side);
q7 says 段階, not 手順; the step ⑥ troubleshoot names both requests ④ and ⑤; the practice models the commit request and
gives it a troubleshoot (3 hint levels); the data-side model answer says the API saves the date; s2-prompt-api's expect
changes the database only if needed; no en "rebuild" next to the defined Build (q5, q8, q9); smaller wording fixes in
q3, q4 and q6. Not applied, to keep the change under 30% of the blocks and the prose under 2,400 characters: ex-lead
naming the backend and frontend, the UI definition naming the frontend, s1-b3's pantry sentence, q1 b without the
causative, and the wording suggestions for hook-b1, s2-analogy, s2-b5, s3-analogy (en), s4-tools and
practice-answer-ui (en).

## Review round 3 (verification)

The author-lesson skill allows at most 2 review rounds and says to stop and report when the lesson still fails. After
round 2 the user chose to run one verification round more (2026-10-31), because the 6 must-fix items were exact
replacements and `review-scope.mjs --since aae0299` allowed a verification (13 of 44 blocks changed, 14%).

Both reviewers verified `sha256:1d967dfe70f0b1a4` (commit d798e86) against their round-2 reviews, named as
`aae0299:content/courses/vibe-coding/reports/vibe-ch1.<reviewer>.review.json`, so the chain is durable for publishing.
Reviews committed in e3c8c97; snapshot `.artifacts/review/vibe-coding/vibe-ch1/1d967dfe70f0b1a4/round-1/`. Both
verdicts: pass. All 6 must-fix items resolved, 0 unresolved, no new must-fix.

## Final gate (2026-10-31)

`node .claude/skills/review-lesson/scripts/check-review.mjs --lesson content/courses/vibe-coding/drafts/vibe-ch1.lesson.json content/courses/vibe-coding/reports/vibe-ch1.*.review.json`
→ PASS, exit 0, mean 3.77. The visual-qa review (full check, after the preview below) changes no gate score.

| criterion | pedagogy-reviewer | ja-editor | visual-qa | gate (lowest) |
|---|---|---|---|---|
| align | 4 | — | — | 4 |
| hook | 4 | — | — | 4 |
| prior | 4 | 4 | — | 4 |
| load | 3 | 3 | 4 | 3 |
| worked | 4 | — | — | 4 |
| active | 4 | — | — | 4 |
| miscon | 4 | — | — | 4 |
| visual | 4 (carried over) | — | 4 | 4 |
| practice | 3 | — | — | 3 |
| meta | 4 | — | — | 4 |
| accuracy | 4 | — | — | 4 |
| voice | 3 | 3 | — | 3 |
| a11y_l10n | 4 | 4 | 4 | 4 |

What keeps three criteria at 3, for a later rework:
- load: section 1-2 holds UI, API and JSON, a tip, a JSON sample and two prompt examples; 1-5 adds データ側/画面側
  beside フロントエンド and UI.
- practice: two hint levels per step (hint, then troubleshoot) before the model answers; anchor 4 asks for three.
- voice: a few stiff spots the ja-editor lists as niceToHave.

niceToHave items left open (none blocks the gate; each would change a block and need another review): ex-split naming
the frontend for the display side; ex-lead tying データ側/画面側 to the backend and frontend; the UI definition naming
the frontend; q2 d 「省いて」→「省略して」; q9's explanation 「依頼として頼みます」; q3 c en as a statement; s4-tools
「公式ドキュメントには…と書かれています」 (as q3 a now says); s2-b5's long modifier; en "the app you built" in 1-3;
the ex-verify en troubleshoot; hook-b1 「これを直す依頼」; s2-analogy 「〜にあたります」; s1-b3's pantry sentence; q1 b
without the causative 「保存させる」; practice-answer-ui en word order.

## Validate, lint and length (final draft)

- `npm run lessons:validate -- content/courses/vibe-coding/drafts/vibe-ch1.lesson.json`: 0 errors.
- `npm run lessons:lint -- content/courses/vibe-coding/drafts/vibe-ch1.lesson.json --strict`: 0 errors, 0 warnings.
  Both steps blocks (`ex-steps`, `practice-steps`) cite their sources, so `steps-cite` is quiet.
- `node scripts/lessons/measure.mjs`: prose 2,388 (budget 1,200–2,400), read 3,158, practice reading 734, 10
  questions, 1 practice section, estimate 17.3 minutes; `estMinutes` is 17 (`course.json` lists 20).

## Preview and visual QA (2026-10-31)

`npm run lessons:preview -- vibe-coding vibe-ch1` ran against a dev server started from a checkout of this branch
(`npm run dev`: Vite on 3007, API on 3006, no database), exit 0. `metrics.json` records the draft's hash
`sha256:1d967dfe70f0b1a4`. (On 2026-10-30 port 3007 served another app, so nothing was captured then.)

| shot | page | overflowX | console errors | diagram errors | chars/line (median) | text-only screens |
|---|---|---|---|---|---|---|
| desktop-jp 1440×900 | 15,963 px, 20 screens | no | 0 | 0 | 40 (target 30–40) | none |
| mobile-jp 390×844 | 21,162 px, 30 screens | no | 0 | 0 | 21 | none |
| desktop-en 1440×900 | 16,529 px, 20 screens | no | 0 | 0 | 74 (target 60–75) | none |

Unknown blocks 0, broken images 0. The preview ignored 23 failed `/api/` requests (503 on notifications, progress and
events, because no database was configured). Screenshots: `.artifacts/preview/vibe-coding/vibe-ch1/`
(`desktop-jp.png`, `mobile-jp.png`, `desktop-en.png`; the last two stop at 16,000 px, so see the 70 screen PNGs in
`pages/`). They are not committed (`.artifacts/` is ignored) and show only the seeded guest, no personal data.
Playwright's own headless shell (build 1228) is not installed on this machine; `PLAYWRIGHT_CHROMIUM_PATH` pointed at
build 1243 from Playwright's cache folder.

visual-qa opened all 70 screens: pass, visual 4, load 4, a11y_l10n 4, no must-fix
(`reports/vibe-ch1.visual-qa.review.json`). Its niceToHave items are left open, because each would change a block and
need another review round:
- The step titles of `ex-steps` and `practice-steps` start with ①–⑥ (EN "1."–"6."), and the reader also numbers each
  step, so every number shows twice. 53 step titles in 6 published Claude Code lessons (cc-01, cc-04, cc-06, cc-07,
  cc-08, cc-11) do the same, so this is a choice for all courses. The practice hint 「1-5の手順⑤」 uses the numbers.
- Mobile JP line breaks that leave a fragment alone on a line: `q0` option a (「…していな／いから」), `q1` option c,
  `q2` option a, the first summary point (「フロントエン／ド」); on desktop JP, checklist item `pc-input` (「…ありま／す」).
- Reader, not lesson content: a comma can start a line after an inline term link (line-start rule); the eyebrow
  differs between locales (「第1章・はじめに：前提と最低ライン」 / "Chapter 1 · Foundations"); the flashcard flip hint
  has low contrast.

## Sources

Repository first: the original chapter (`data/curricula/vibe_coding/chapter1.ts`, `chapter1_quiz.ts`), the published
lesson, the neighbours (ch0, ch2, ch5, ch8), `briefs/vibe-ch2.md` and the Claude Code course's fact records
(`content/courses/claude-code/reports/facts/cc-01`, `cc-02`, `cc-03`). Then the official documentation, each page read on
2026-10-30: MDN (server side, client-side storage, network requests, JSON, glossary UI / API / JSON / Database / Server,
publishing, deployment, Express intro), Pro Git and the git-scm.com reference (Git 2.56.0, 2026-09-28), and the Claude
Code docs (Quickstart, Best practices, Champion kit, Checkpointing). The list with URLs is in the brief; what each page
says and which blocks use it is in the fact record.

## Publishing: what changes (for the owner)

The draft touches no test. Many tests use the published vibe-ch1 as their fixture and pin its shape (5 cards, inline
checks in 2 sections, 3 exam questions, 6 questions). I measured the effect in a throwaway worktree with the draft
copied to `lessons/` (`npm test`; first draft on 2026-10-30, final draft e3c8c97 on 2026-10-31, same result): 26
failures. Adding the 2 new card ids to `server/tests/fixtures/published-card-ids.json` fixes 3 of them (`reviewCardIds`,
`reviewCards`, the review catalog); the other 23 are pinned counts, ids or positions. Publishing (step 10 of
`author-lesson`) therefore updates, in the same PR:

| Test file | Failing tests (count) | What they pin |
|---|---|---|
| `lessonSchema.test.js` | 'vibe-ch1 meets the polish brief' (1) | inline sections `['1-1','1-2']` → now `['1-1','1-2','1-3','1-4','1-5']`; 5 cards → 7; author `human+claude-code` → `claude-code` |
| `courseCatalog.test.js` | the repository content (1) | `questions: 6` → 10 (`q0`–`q9`; `estMinutes` comes from `course.json`) |
| `lessonReader.test.js` | numbers figures and inline checks in reading order (1) | 2 inline checks → 5 |
| `lessonProgressCore.test.js` | skips a section whose check question is open (1) | section and check positions |
| `mcpCourseTools.test.js` | course-list, course-lesson-get, course-progress-update (3) | question counts, outline, sections with checks |
| `tutorLearnerState.test.js` | final exam: one correct answer does not unlock … (1) | 3 exam questions → 4 |
| `lessonResetCore.test.js` | finishing the lesson again adds its cards fresh (1) | card count (6 → 8 with the other lesson's card) |
| `mcpReviewTools.test.js` | course-review-due, refusals (2) | card counts and order |
| `reviewQueueCore.test.js` | 12 tests on entering cards, learning days and upper-case ids | card count 5 → 7 and the catalog order |

Also: `course.json` `estMinutes` 20 → 17 (the draft's estimate is 17.3 minutes by `scripts/lessons/measure.mjs`), and
`server/tests/fixtures/published-card-ids.json` gains `vibe-coding/vibe-ch1/card-database` and
`vibe-coding/vibe-ch1/card-ui-api` (kept sorted; the 5 existing card ids are unchanged). Learners who already finished
vibe-ch1 then get the 2 new cards in their review queue (a card added after their last change enters with no memory).
Options for the owner: update the pinned values, or point the tests that only need "some published lesson" at a frozen
copy of today's vibe-ch1 so that later reworks of the exemplar do not touch them. Dropping the 2 new cards would avoid
most of the review-queue changes, at the cost of no card for データベース and for the UI/API split.
- MCP `lesson-schema-get` then returns the new exemplar. Its excerpt (`hook`, `1-1`, `1-5`, `practice`, `check`,
  `summary`) validates with no errors, and `validateLessonDraft` gives no errors or warnings for the whole draft
  (checked with the functions `mcpLessonTools.test.js` uses).
- `KNOWN_UNCITED_STEPS` needs no change: both steps blocks of the draft (`ex-steps`, `practice-steps`) cite their
  sources.
- Review chains: `server/tests/reviewChainsDurable.test.js` requires every verification of a published lesson to name a
  committed round; the round-3 verifications name `aae0299:…`, and rounds 1 and 2 are full reviews.
- Visual QA: done at `sha256:1d967dfe70f0b1a4` (see "Preview and visual QA"). If the lesson changes before
  publishing, re-run the preview and visual-qa.

## Assumptions

The brief lists them ("Assumptions"). In short: the outline was not shown for a check-in, because this session was
started by another session with a fixed scope; the objectives keep the published wording; the running examples (task,
reading-log, booking and budget apps) are invented teaching scenarios; Claude Code's documentation backs the advice on
how to write a request, and the lesson names Claude Code only where a statement is about that tool.

## Open questions for the owner

1. Publishing: when and how. Update the 23 pinned tests and `course.json`, or first move the tests that only need "a
   published lesson" to a frozen copy of today's vibe-ch1 (see "Publishing: what changes")?
2. Keep the 2 new cards? They enter the review queue of learners who already finished vibe-ch1.
3. Step numbers: keep ①–⑥ in step titles, although the reader numbers steps too (6 Claude Code lessons do the same),
   or drop them in every course in a separate change?
4. Review rounds: this rework used 3 rounds (2 full, 1 verification), one more than the author-lesson skill allows; the
   user approved the third. Should the skill allow a verification round after a forced full round 2?
