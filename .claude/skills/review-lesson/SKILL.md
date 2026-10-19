---
name: review-lesson
description: "Score one Rise Path lesson JSON against rubric.v1 as an independent reviewer and return review.v1 JSON with must-fix items. Use for レビューして, 教材を採点して, content review of a PR, or step 6 of author-lesson."
argument-hint: "<path to .lesson.json> [path to brief] [--verify <previous review> --since <revision>]"
context: fork
agent: pedagogy-reviewer
background: false
allowed-tools: "Read Grep Glob Bash(npm run lessons:validate *) Bash(npm run lessons:lint *) Bash(node .claude/skills/review-lesson/scripts/review-scope.mjs *) Bash(git diff *) Bash(git show *)"
---

# Review a lesson

Review: $ARGUMENTS

You did not write this lesson and you have no stake in it. Judge it as a strict editor at a top
learning publisher would, for a learner who will study it alone.

Without `--verify` this is a **full review**. With `--verify <previous review> --since <revision>`
it is a **verification round** (below), unless the scope check says a full review is due.

## Full review (round 1, and any round a verification is not allowed for)

1. Read the lesson file. If a brief path is given, or `content/courses/<course>/briefs/<lesson>.md`
   exists, read it: the brief defines the audience and the outcomes.
2. Read `content/schema/rubric.v1.json` (criteria, anchors, pass rule) and
   `.claude/skills/author-lesson/references/lesson-contract.md`.
3. Run the deterministic checks and use their findings as evidence:
   `npm run lessons:validate -- <file>` and `npm run lessons:lint -- <file> --strict`.
4. Read the whole lesson as a learner would, in order, answering each question before you read
   its answer. Note where you got lost, bored or misled.
5. Score all 13 criteria from 0 to 4 using the anchors. Evidence is one or two sentences that
   quote the lesson or name block ids. A 4 is rare. Validation errors cap `accuracy` or
   `a11y_l10n` at 2; an unassessed objective caps `align` at 2.
6. List `mustFix` items for every criterion below 3, every factual error and every break of the
   lesson contract, each with the block id and a fix specific enough to apply without guessing.
   Put optional ideas and pure wording preferences (rhythm, smoother phrasing, word choice) in
   `niceToHave`; the `ja-editor` owns Japanese wording and blocks only on the error classes in
   `.claude/agents/ja-editor.md`.
7. `verdict`: `pass` (every criterion ≥ 3, mean ≥ 3.3, no mustFix), `revise`, or `reject` (wrong
   audience or outcome; a rewrite is needed).

A full review may set `"mode": "full"`; leaving `mode` out means the same.

## Verification round (fix-verification mode)

After a full review, a later round is a verification when the author applied the previous
must-fix items and the lesson did not change structurally. It checks the fixes and reviews what
changed; it does not re-review the unchanged lesson. The bar is not lowered: every changed block is
judged exactly as in a full review.

**When a full review is still required.** Run
`node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --since <revision>`. It exits 1,
and a full review is required, when since the reviewed revision a section was added, removed or
reordered or changed its role; the objectives changed (ids, text, Bloom level or order); or more
than 30% of the blocks were changed, added, removed or moved. Then do the full review above, set
`"mode": "full"` and say in `summary` why. It exits 0 when a verification is allowed.

1. Read the previous review (`git show <commit>:<path>` when it is given that way), the lesson,
   the rubric and the contract, and run validate and lint as in a full review.
2. See what changed: `review-scope.mjs <file> --since <revision> --diff` (each changed block before
   and after) or `git diff <revision> -- <file>`. Read the blocks around each change too.
3. **(a) Verify every previous must-fix item**: each `mustFix` of the previous review, plus each of
   its `resolved` entries marked `unresolved`. Add one `resolved` entry per item:
   `{"blockId", "criterion", "status": "resolved" | "unresolved", "evidence"}`. Evidence quotes the
   current text. `resolved` only when the change removes the problem completely; not applied,
   applied in part, or the problem moved elsewhere is `unresolved`.
4. **(b) Review every changed or new block in full**, as in a full review. A rewritten question is
   new content: check its options, feedback, answer, `objectiveId` and whether it gives the answer
   away.
5. **(c) New `mustFix` only for errors in changed or new blocks, or regressions the changes caused**
   elsewhere (a term, number, answer or reference that no longer matches; name the change in
   `issue`). Do not re-litigate unchanged content: new observations about it go to `niceToHave`.
6. **(d) Re-score only the criteria the changes affect**: a criterion with a previous must-fix item,
   or one whose evidence is or involves a changed block (questions: `align`, `active`, `miscon`;
   prose: `load`, `voice`, `accuracy`, …). Score it with the anchors over the whole lesson as it is
   now. Copy every other score and its evidence from the previous review and add
   `"carriedOver": true`. List every criterion the previous review scored. When in doubt, re-score.
7. `verdict`: `pass` only when every criterion ≥ 3, mean ≥ 3.3, no `mustFix` and no `unresolved`
   entry.

A verification review adds `"mode": "verify"`, `"resolved": […]` and
`"verifies": {"reviewedRevision", "previousReview", "changed", "changedShare", "fullReviewRequired"}`:
copy the `verifies` line that `review-scope.mjs` prints and add `previousReview`. `check-review.mjs`
counts every `unresolved` entry as an open must-fix, refuses a verification that the scope check
does not allow, and, when it can load the previous review, counts a previous must-fix without a
`resolved` entry as open and checks that carried-over scores match.

Return **only** one JSON object that matches `content/schema/review.v1.json`, with
`"reviewer": "pedagogy-reviewer"` and `"rubricVersion": "rubric.v1"`. No prose before or after it.
Do not edit any file, and never run `review-scope.mjs --snapshot` (the author does).
