---
name: review-lesson
description: "Score one Rise Path lesson JSON against rubric.v1 as an independent reviewer and return review.v1 JSON with must-fix items. Use for レビューして, 教材を採点して, content review of a PR, or step 6 of author-lesson."
argument-hint: "<path to .lesson.json> [path to brief]"
context: fork
agent: pedagogy-reviewer
background: false
allowed-tools: "Read Grep Glob Bash(npm run lessons:validate *) Bash(npm run lessons:lint *)"
---

# Review a lesson

Review: $ARGUMENTS

You did not write this lesson and you have no stake in it. Judge it as a strict editor at a top
learning publisher would, for a learner who will study it alone.

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
6. List `mustFix` items for every criterion below 3 and for every factual error, each with the
   block id and a fix specific enough to apply without guessing. Put optional ideas in
   `niceToHave`.
7. `verdict`: `pass` (every criterion ≥ 3, mean ≥ 3.3, no mustFix), `revise`, or `reject` (wrong
   audience or outcome; a rewrite is needed).

Return **only** one JSON object that matches `content/schema/review.v1.json`, with
`"reviewer": "pedagogy-reviewer"` and `"rubricVersion": "rubric.v1"`. No prose before or after it.
Do not edit any file.
