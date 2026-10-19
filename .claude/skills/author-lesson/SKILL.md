---
name: author-lesson
description: "Write or rework one Rise Path lesson (教材・レッスン・チャプター) as risepath.lesson/v1 JSON in content/courses/<course>/drafts/ — brief, outline, draft, validate and lint, independent pedagogy review, screenshot QA, report. Use when asked to create, convert, redesign or improve learning material."
when_to_use: "Requests such as 教材を作って, レッスンを書いて, この資料をレッスンにして, 第N章を作り直して, 演習を追加して, or turning notes, docs or an issue into a lesson."
argument-hint: "<course-slug> <lesson-id> [brief text or path to a brief]"
allowed-tools: "Read Grep Glob Edit(content/courses/**) Bash(npm run lessons:validate *) Bash(npm run -s lessons:validate *) Bash(npm run lessons:lint *) Bash(npm run -s lessons:lint *) Bash(npm run lessons:preview *) Bash(npm run lessons:catalog *) Bash(npm run -s lessons:catalog *) Bash(node .claude/skills/review-lesson/scripts/check-review.mjs *) Bash(node .claude/skills/review-lesson/scripts/review-scope.mjs *) Skill(review-lesson *)"
effort: high
hooks:
  PostToolUse:
    - matcher: "Write|Edit|MultiEdit"
      hooks:
        - type: command
          command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/validate-lesson.mjs"'
          timeout: 30
---

# Author a Rise Path lesson

Request: $ARGUMENTS

The first word is the course slug (`<course>` below), the second the lesson id (`<lesson>`,
lowercase kebab-case), the rest is the brief or a path to one. If the course or lesson id is
missing, pick a sensible id from the catalog and say which one you chose.

Current catalog (courses, lessons, status):
!`npm run -s lessons:catalog -- --short`

You save **drafts only**. A human reviews and publishes. Never write to `lessons/`, `course.json`
or a database unless the owner explicitly asks (step 10).

Apart from the one outline check-in of an interactive session (step 3), work through all steps in
**one turn**. The tools this skill pre-approves (edits under `content/courses/`, the `lessons:*`
scripts, `check-review.mjs`, `/review-lesson`) apply only to the turn that invoked it. After a
turn ends, writes need approval: a person is asked, and a headless run is denied. If a write is
denied, stop and report which permission is missing (`.claude/settings.example.json` has the
project rules).

## Read first

- [references/lesson-contract.md](references/lesson-contract.md) — the teaching contract (shape, budgets, questions, sources).
- [references/block-cookbook.md](references/block-cookbook.md) — which block for which job, good and bad JSON.
- [references/style-guide.ja.md](references/style-guide.ja.md) — Japanese voice and notation.
- [references/rubric.md](references/rubric.md) — how the reviewers will score the lesson.
- The exemplar: `content/courses/vibe-coding/lessons/vibe-ch1.lesson.json`; every block type in
  use: `content/examples/blocks-gallery.lesson.json`. Schema: `content/schema/lesson.schema.json`.

## The contract at a glance

- **Shape**: hook (problem + ungraded `predict` quiz) → 3–5 segments of concept → worked example →
  inline check → practice (try it: task, hints, model answer) → check (`exam` quiz over every
  objective, ≥ 1 transfer question) → summary (3–5 points) + 4–8 flashcards → optional reflection.
- **Objectives**: 2–4 can-do statements with a Bloom level; every objective is assessed by a
  question with its `objectiveId`.
- **Checks**: an inline quiz at least every 2 content sections; every wrong option has feedback
  (≤ 2 sentences) that names the misconception; never quiz the analogy or trivia.
- **Chunks**: sentence ≤ 60 JP chars, paragraph ≤ 160, segment explanation ≤ 300, lesson body
  1,200–2,400; ≤ 3 new terms per segment; no decorative images.
- **Voice**: です・ます, warm, no 「簡単です」「誰でも」; katakana terms with English on first use.
- **Truth**: no fabricated facts, URLs, images, commands or numbers. Cite non-obvious claims
  (`sources[]` + `cite`), pin tool versions, run code before you show it when you can.

## 0. Orient

- If `<lesson>` already exists (catalog above), this is a rework: read it, copy it to
  `content/courses/<course>/drafts/<lesson>.lesson.json` and keep every existing id stable.
  Keep `provenance.migratedFrom` and set a new `author` (step 4): a migrated chapter whose author
  is `migration…` gets advisory lint, a reworked one is strict (lesson-contract §8).
- Read the neighbouring lessons of the course so terms, tone and difficulty connect.
- Inspect files with Read, Grep and Glob; `npm run -s lessons:catalog -- --json` gives the course
  structure. One-off `node -e` or `python3` scripts are not pre-approved and stall headless runs.

## 1. Brief

- Write `content/courses/<course>/briefs/<lesson>.md` from [templates/brief.md](templates/brief.md).
- Required: learner and prior knowledge, 2–4 outcomes, minutes, locales, constraints (tool
  versions, OS), sources.
- If something required is missing, ask **one** consolidated question. When nobody can answer
  (headless run), choose sensible defaults and list them under "Assumptions".

## 2. Research (when the topic needs facts you have not verified)

- Use repository material first (existing lessons, `data/curricula/**`, `doc/`), then official
  documentation (WebFetch). Delegate long research to a subagent so the main thread stays clean.
- Record each source you rely on (id, title, url, publisher, checkedAt) and the 2–4 misconceptions
  learners most likely hold. If you cannot verify a claim, drop it.

## 3. Outline (checkpoint)

- Add an "## Outline" table to the brief: section id, role, title, the one idea, blocks, which
  objective each question checks. Check it against the contract before drafting.
- Interactive session: show the table and ask once 「この構成で進めますか？」. Headless: continue.

## 4. Draft

- Write `content/courses/<course>/drafts/<lesson>.lesson.json`, then fill it section by section.
  The PostToolUse hook validates every write; when it reports errors, fix them first.
- Use the cookbook's blocks; write Japanese natively (`locale: "jp"`, plain strings) — translation
  is step 8. Define terms in `definitions` + `glossary` before use; mark later uses `[[term]]`.
- `provenance`: `{"author": "claude-code", "skill": "author-lesson", "skillVersion": "1",
  "generatedAt": "<today ISO>"}`. Leave `reviewedBy` to the human.

## 5. Validate and lint

```bash
npm run lessons:validate -- content/courses/<course>/drafts/<lesson>.lesson.json
npm run lessons:lint -- content/courses/<course>/drafts/<lesson>.lesson.json --strict
```

Reach 0 errors and 0 warnings. A warning may stay only with a written reason in the report
(for example a deliberately long code sample).

## 6. Independent review (at most 2 rounds)

- You never score your own draft. **Round 1 is a full review**: run
  `/review-lesson content/courses/<course>/drafts/<lesson>.lesson.json` (it forks into the
  `pedagogy-reviewer` subagent) and, in the same message, ask the `ja-editor` subagent to review
  the same file. Give them the file and brief paths only — not your opinion of the draft. Do not
  edit the lesson while a reviewer reads it.
- Every review records the version it read as `"lessonHash"`, the output of
  `node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --hash` (the reviewers with a
  shell run it themselves). The gate refuses a review whose `lessonHash` is not the lesson's
  current hash, so after any edit the earlier reviews no longer count.
- Run reviewers in the **foreground** (Agent tool with `run_in_background: false`; `/review-lesson`
  already waits) and wait for their JSON. Never end your turn while a reviewer is running.
- Save each JSON answer with Write as `content/courses/<course>/reports/<lesson>.<reviewer>.review.json`
  (a later round overwrites the earlier one; keep the history in the report, and do not rename
  files with `mv`), then merge and gate them:
  `node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/<course>/reports/<lesson>.*.review.json`
  (exit 0 pass, 1 not yet, 2 invalid or stale). It hashes the lesson the reviews name (a draft
  published since is found under `lessons/`); when `drafts/` and `lessons/` both hold the lesson
  and differ (a rework of a published lesson), pass `--lesson <file>` to name the one reviewed.
  One review per reviewer: keep no old copies under `reports/`.
  `--allow-legacy` is only for re-checking reviews written before `lessonHash` existed.
- Right after saving a round's reviews, record what they read:
  `node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --snapshot`. It keeps the
  lesson in `.artifacts/review/<course>/<lesson>/<hash>/` and copies the saved reviews whose
  `lessonHash` is that hash to a new round folder `<hash>/round-<n>/` (never overwritten;
  `--round <label>` names it). It prints the revision `sha256:<hash>` (the reviews' `lessonHash`)
  and the folder. When the reviewed draft is committed, the commit is the revision instead and the
  previous review is `<commit>:content/courses/<course>/reports/<lesson>.<reviewer>.review.json`.
- Apply every `mustFix` and raise every criterion below 3. Re-validate.
- **Round 2 is a verification round** (fix-verification mode, rules in
  `.claude/skills/review-lesson/SKILL.md`) when
  `node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --since <revision> --expect-hash <round-1 lessonHash>`
  exits 0. It exits 1 — a full review again — when a section was added, removed, reordered or
  changed its role, the objectives changed, or more than 30% of the blocks changed. For a
  verification, run `/review-lesson <file> --verify <previous review> --since <revision>` and tell
  the `ja-editor`: "Verification round: lesson `<file>`, previous review `<previous review>`,
  revision `<revision>`, verifies `<the line review-scope.mjs printed>`." The previous review is
  the snapshot copy `.artifacts/review/<course>/<lesson>/<hash>/round-<n>/<reviewer>.review.json`
  or `<commit>:<path>` — never the working-tree `reports/` file, which this round overwrites.
  Do not argue with round 1 or say what you think is fixed; the reviewer checks.
- Save and gate as in round 1, with every reviewer of the previous round: each one verifies its
  review of that round (or reviews in full). For each verification `check-review.mjs` loads
  `verifies.previousReview` (a recorded round; `--previous <commit:path>` stands in only for a
  review written before `lessonHash` existed that names its own reports file), follows a previous
  verification back to its full review, recomputes the scope from `verifies.reviewedRevision`, and
  exits 2 when it cannot load the previous review or that round is itself invalid, the scope
  requires a full review, `verifies.changed` leaves out a change, a criterion the previous review
  scored is missing, a reviewer of the previous round is left out, or a review is stale. A
  must-fix marked resolved on a block that did not change stays open. Commit a refused round if
  you keep it as a record, but verify the last valid round next time. Fix the cause and re-run the
  reviewer; never edit a review's JSON yourself.
- A lesson published (moved from `drafts/` to `lessons/`) between rounds keeps its hash and its
  snapshots; `--since <commit>` reads `drafts/<id>` at that commit. Pass the current path to the
  reviewers; their `file` names it.
- Still failing after 2 rounds: stop and report what blocks a pass. Do not lower the bar: a
  verification judges every changed block by the round-1 standard, and an `unresolved` item is an
  open must-fix.

## 7. Preview and visual QA

- Run `npm run lessons:preview -- <course> <lesson>`. It needs the Vite dev server on port 3007; do
  not probe or start it yourself. If it exits 2 because the server is down, skip to step 9 and ask
  the owner to run `npm run dev`.
  It writes `.artifacts/preview/<course>/<lesson>/` — `desktop-jp.png`, `mobile-jp.png`,
  `desktop-en.png` (full length), `pages/*.png` (one per screen) and `metrics.json`.
- Ask the `visual-qa` subagent (foreground) to inspect that folder, and give it the `lessonHash` of
  the lesson the preview shows (`review-scope.mjs <file> --hash`, run right after the preview; it
  has no shell). Open a few PNGs yourself too. Save its review next to the others and fix
  what it finds: horizontal overflow, console or diagram errors, text-only screens, unreadable
  tables or diagrams on mobile. Re-run the preview after layout-relevant fixes.
- A `visual-qa` re-check after fixes follows the round rule of step 6: when `review-scope.mjs`
  exits 0, tell it "Verification round: preview folder `<folder>`, lessonHash `<hash>`, previous
  review `<previous review>`, revision `<revision>`, verifies `<the printed line>`". It has no
  shell: give it a readable path such as the snapshot copy, or paste the previous review JSON, and
  keep `previousReview` the snapshot copy or `<commit>:<path>`.

## 8. Translate (when the brief lists more locales)

- Turn every learner-facing text into `{"jp": …, "en": …}`, set `"locales": ["jp", "en"]`, and
  localize diagram labels. Write natural English (style guide §6), not a literal translation.
- Re-run step 5 (the validator reports any missing locale) and the preview for `desktop-en`.

## 9. Report

Write `content/courses/<course>/reports/<lesson>.md`: objectives, the merged review table and
verdict, must-fix items and how they were resolved, remaining lint warnings with reasons,
assumptions, sources, preview metrics and screenshot paths, open questions for the owner.
Reply with a short summary and the report path. Do not commit or open a PR unless asked.

## 10. Publish — only when the owner asks

Move the file from `drafts/` to `lessons/`, add it to a module in `course.json` (id, title,
estMinutes, `next` links of the neighbours), then `npm run lessons:validate` (whole content) and
`npm run lessons:catalog`. Never set `provenance.reviewedBy` yourself.

## Done means

- `lessons:validate` 0 errors and `lessons:lint --strict` 0 warnings (or each one justified).
- `check-review.mjs` exits 0 on the current reviews (every `lessonHash` is the lesson's hash):
  every criterion ≥ 3, mean ≥ 3.3, no open must-fix.
- `metrics.json`: `overflowX: false`, `consoleErrors: 0`, `mermaidErrors: 0`; the screenshots were
  looked at by `visual-qa` and by you.
- Brief and report written; the lesson is still in `drafts/` unless the owner asked to publish.
