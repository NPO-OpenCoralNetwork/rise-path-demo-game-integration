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

## Which version you review: `lessonHash`

Every review, full or verify, records the version of the lesson it read. Before you read the
lesson, run `node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --hash` and put the
printed `sha256:<16 hex>` in `"lessonHash"`. The hash ignores key order, whitespace, `provenance`
and whether the file is under `drafts/` or `lessons/`; any content change changes it.
`check-review.mjs` refuses a review whose `lessonHash` is not the lesson's current hash (stale),
and one without it.

## Full review (round 1, and any round a verification is not allowed for)

1. Run `review-scope.mjs <file> --hash` (above). Read the lesson file. If a brief path is given, or
   `content/courses/<course>/briefs/<lesson>.md` exists, read it: the brief defines the audience
   and the outcomes.
2. Read `content/schema/rubric.v1.json` (criteria, anchors, pass rule) and
   `.claude/skills/author-lesson/references/lesson-contract.md`.
3. Run the deterministic checks and use their findings as evidence:
   `npm run lessons:validate -- <file>` and `npm run lessons:lint -- <file> --strict`.
4. Read the whole lesson as a learner would, in order, answering each question before you read
   its answer. Note where you got lost, bored or misled.
5. Score all 13 criteria from 0 to 4 using the anchors. Evidence is one or two sentences that
   quote the lesson or name block ids. A 4 is rare. Validation errors cap `accuracy` or
   `a11y_l10n` at 2; an unassessed objective caps `align` at 2.
6. List `mustFix` items for every criterion below 3, every factual error, every uncited
   non-obvious claim or unverified UI step, every new term without an everyday analogy before its
   definition in a `level: "beginner"` lesson (`.claude/agents/pedagogy-reviewer.md` step 5),
   and every break of the lesson contract, each with the block id and a fix specific enough to
   apply without guessing.
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
`node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --since <revision> --expect-hash <previous lessonHash>`
(`<previous lessonHash>` is the `lessonHash` of the previous review; a previous review without one
cannot be verified: do a full review). It exits 1, and a full review is required, when since the
reviewed revision a section was added, removed or reordered or changed its role; the objectives
changed (ids, text, Bloom level or order); more than 30% of the lesson's parts changed (each block,
each section's own fields such as its title, each lesson field such as the title or estMinutes, and
each glossary and source entry); or more than 30% of the blocks were changed, added, removed or
moved. Then do the full review above, set `"mode": "full"` and say in `summary` why. It exits 0
when a verification is allowed, and 2 when `<revision>` holds no version with that hash (then the
revision or the previous review is wrong: say so and stop).

`<revision>` is a commit id, or `sha256:<hash>` for an uncommitted draft that the author saved
with `--snapshot` (the hash is the previous review's `lessonHash`; a unique prefix of 6 or more
digits also works). A commit id is 7–40 lowercase hex digits (`git rev-parse --short <commit>`;
the `reviewedRevision` that `review-scope.mjs` prints is one), never `HEAD`, a branch, a tag or
`HEAD~n`, which name another commit when refs move. At a commit, the lesson is looked up at
`drafts/<id>` first, then `lessons/<id>`, so a lesson published between rounds is compared with
the draft that was reviewed.

1. Run `review-scope.mjs <file> --hash` for `lessonHash`. Read the previous review
   (`git show <commit>:<path>` when it is given that way), the lesson, the rubric and the contract,
   and run validate and lint as in a full review.
2. See what changed: `review-scope.mjs <file> --since <revision> --expect-hash <previous lessonHash> --diff`
   (each changed block before and after) or `git diff <revision> -- <file>`. Read the blocks
   around each change too.
3. **(a) Verify every previous must-fix item**: each `mustFix` of the previous review, plus each
   item still open from the rounds before it (its `resolved` entries marked `unresolved`, and any
   item it left without an entry). Add one `resolved` entry per item:
   `{"blockId", "criterion", "status": "resolved" | "unresolved", "evidence"}`. Evidence quotes the
   current text. `resolved` only when a change removes the problem completely; not applied,
   applied in part, or the problem moved elsewhere is `unresolved`. A must-fix is resolved only by
   a change: when the fix is in another block than `blockId` (a term now defined in the block
   before it), add `"fixedIn": ["<changed block id>"]`. The gate keeps an item open when neither
   `blockId` nor a `fixedIn` block changed since the round that last had it open: the review that
   raised it, or a later round that found it `unresolved` or gave it no entry (then only a change
   after that round counts). A **lesson-wide** item (`blockId` `"lesson"`) is resolved by a change
   to a lesson-level field (title, subtitle, glossary, sources, prerequisites, estMinutes, level,
   locales: anything outside the sections and `provenance`); when its fix is in blocks instead,
   list in `fixedIn` every block that holds the fix. Each of them must have changed: an edit to a
   block or section that `fixedIn` does not name never resolves a lesson-wide item.
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
   `"carriedOver": true`. List every criterion the previous review scored: one left out makes the
   review invalid. When in doubt, re-score.
7. `verdict`: `pass` only when every criterion ≥ 3, mean ≥ 3.3, no `mustFix` and no `unresolved`
   entry.

A verification review adds `"mode": "verify"`, `"resolved": […]` and
`"verifies": {"reviewedRevision", "previousReview", "changed", "changedShare", "fullReviewRequired"}`:
copy the `verifies` line that `review-scope.mjs` prints and add `previousReview`, the review you
verified as given to you, which is a recorded round:
`<commit id>:content/courses/<course>/reports/<lesson>.<reviewer>.review.json` or the snapshot copy
`.artifacts/review/<course>/<lesson>/<hash>/<round>/<reviewer>.review.json`. Nothing else: never
the working-tree `reports/` file of the same lesson and reviewer (this round overwrites it), never
a pasted or hand-made copy, and never a commit named by a ref (`HEAD:…`, `main:…`, `HEAD~1:…`).
`reviewedRevision` is the commit id or snapshot revision `review-scope.mjs` printed. `file` is the
lesson's own path, `content/courses/<course>/drafts/<lesson>.lesson.json` or
`…/lessons/<lesson>.lesson.json`.

A snapshot copy (and its `sha256:` revision) exists only in the checkout that made it, so it is for
draft rounds. Before a lesson is published (moved to `lessons/`, or opened as a PR to publish),
every verification on its chain names a committed previous round (`<commit id>:…`, with a commit id
as `reviewedRevision`), or the reviewer reviews in full; `server/tests/reviewChainsDurable.test.js`
enforces this for published lessons.

`check-review.mjs` (exit 2 = the review does not count) refuses a verification when it cannot load
`previousReview` as a recorded round, when that is the review being checked or the working-tree
reports file of the same lesson and reviewer, when `previousReview` or `reviewedRevision` names a
commit by anything but a commit id of this repository, when the previous review has no
`lessonHash`, when the scope it recomputes from `reviewedRevision` (the version with the previous
review's `lessonHash`) requires a full review, when `verifies.changed` leaves out a change, when a
criterion the previous review scored is missing or a carried-over score differs, and when
`lessonHash` is not the lesson's current hash (a review without `lessonHash` is always stale). It
checks the previous review the same way: a previous verification is followed back to its full
review, and a round the gate would refuse cannot be verified (verify the last valid round, or
review in full). Every reviewer of the verified round must be in the same gate run, verifying that
round or with a full review that scores at least the criteria its review in that round scored, and
each reviewer appears once. The round is the reviews recorded next to the previous review (at that
commit, or in that snapshot round folder) that read the same version, its `lessonHash`; a review of
another version recorded there is not part of it. It counts as an open must-fix every `unresolved`
entry, every open item without a `resolved` entry, and every `resolved` entry without a change (step
3); open items carry over to the next round.

Return **only** one JSON object that matches `content/schema/review.v1.json`, with
`"reviewer": "pedagogy-reviewer"`, `"rubricVersion": "rubric.v1"` and `"lessonHash"`. No prose
before or after it. Do not edit any file, and never run `review-scope.mjs --snapshot` (the author
does).
