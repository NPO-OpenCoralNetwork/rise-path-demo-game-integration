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
