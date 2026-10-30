# Report: vibe-coding/vibe-ch1 (draft rework)

**Status: DRAFT in `content/courses/vibe-coding/drafts/vibe-ch1.lesson.json`. Not published: moving it to
`lessons/` is the owner's call (see "Publishing: what changes" at the end).**

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

Unchanged from the published lesson (ids, text, Bloom), so `lessonSchema.test.js` keeps its 3 objectives.

| id | bloom | jp | assessed by |
|---|---|---|---|
| o1 | understand | フロントエンド・バックエンド・データベースの役割の違いを説明できる | q0 (predict, ungraded), q1 (inline), q6 (exam, transfer: booking app) |
| o2 | apply | 変えたいものが UI か API かを見分けて、AIへの依頼を書き分けられる | q2 (inline), q9 (inline, faded step of the worked example), q5 (exam, transfer: budget app) |
| o3 | understand | デプロイと Git のコミットが何をしているかを説明できる | q7 (inline), q8 (inline), q4 (exam), q3 (exam, transfer: a friend's claim) |

## What changed against the published lesson

- Kept: every id of the published lesson (7 sections, all blocks, `q0`–`q5` with their option ids, the 5 card ids).
- Added: sections `1-5` (worked example, 6 cited steps) and `practice`; blocks `s2-analogy`, `s3-analogy`, `s3-defs`,
  `s3-flow`, `s3-check`, `s4-analogy`, `s4-tools`, `s4-check`, `ex-lead`, `ex-steps`, `ex-check`, `practice-*`,
  `summary-next`, `summary-ask`; questions `q6`–`q9`; cards `card-database`, `card-ui-api`; `glossary` (10 terms) and
  `sources` (20, all read on 2026-10-30).
- Rewritten: `q1` (asked which part of the restaurant is the backend: it quizzed the analogy) and `q3` (asked why Git is
  called a time machine: same). `q4` and `q5` became application items. `q2` moved to the task app.
- Removed claims no source supports: "knowing frontend vs backend raises the accuracy of generated code a lot", "one
  command takes you back for sure", "revert returns you to an earlier save point" (`git revert` adds a new commit), and
  example tool names (React, Vue.js, Node.js, Python, PostgreSQL, MySQL, Vercel, Render). The definitions of push and
  revert were dropped (push is taught in ch5). See facts §5.
- Analogies (beginner rule): 1-1 restaurant (客席とウェイター＝フロントエンド, シェフ＝バックエンド, 食材庫＝データベース);
  1-2 the same restaurant (メニュー＝UI, 決まった頼み方＝API, 注文票の書き方＝JSON); 1-3 cooking for a restaurant
  (下ごしらえ＝ビルド, 運ぶ＝転送, 開店＝起動, 全体＝デプロイ); 1-4 saving a game (セーブを残す仕組み＝Git,
  1回のセーブ＝コミット). Each comes before its segment's definitions block; no question asks about an analogy.
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

## Preview and visual QA: not run

`npm run lessons:preview -- vibe-coding vibe-ch1` (2026-10-30) reached a server on port 3007, but it was another app
(the page showed "Nexloom"), not Rise Path's Vite dev server, so nothing was captured (exit 2). Without screenshots and
`metrics.json` there was nothing for visual-qa to review, so the gate below has two reviewers. To finish this step, run
`npm run dev` in a checkout of this branch (the `/preview` route reads `drafts/` from the checkout that serves it), then
the preview and a visual-qa review. On this machine Playwright's own headless shell (build 1228) is not installed;
pointing `PLAYWRIGHT_CHROMIUM_PATH` at the headless shell build 1243 already in Playwright's cache folder launched it
without a download.

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
copied to `lessons/` (2026-10-30, `npm test`): 26 failures. Adding the 2 new card ids to
`server/tests/fixtures/published-card-ids.json` fixes 2 of them (`reviewCardIds`, `reviewCards`); the other 23 are
pinned counts, ids or positions. Publishing (step 10 of `author-lesson`) therefore updates, in the same PR:

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

Also: `course.json` `estMinutes` 20 → 17 (the draft's estimate is 16.8 minutes by `scripts/lessons/measure.mjs`), and
`server/tests/fixtures/published-card-ids.json` gains `vibe-coding/vibe-ch1/card-database` and
`vibe-coding/vibe-ch1/card-ui-api` (kept sorted; the 5 existing card ids are unchanged). Learners who already finished
vibe-ch1 then get the 2 new cards in their review queue (a card added after their last change enters with no memory).
Options for the owner: update the pinned values, or point the tests that only need "some published lesson" at a frozen
copy of today's vibe-ch1 so that later reworks of the exemplar do not touch them. Dropping the 2 new cards would avoid
most of the review-queue changes, at the cost of no card for データベース and for the UI/API split.
- MCP `lesson-schema-get` then returns the new exemplar. Its excerpt (`hook`, `1-1`, `1-5`, `practice`, `check`,
  `summary`) validates with no errors, and `validateLessonDraft` gives no errors or warnings for the whole draft
  (checked with the functions `mcpLessonTools.test.js` uses).
- `KNOWN_UNCITED_STEPS` needs no change: the draft's only steps block (`ex-steps`) cites its sources.
- Review chains: `server/tests/reviewChainsDurable.test.js` requires every verification of a published lesson to name a
  committed round; the rounds below name commit ids.
