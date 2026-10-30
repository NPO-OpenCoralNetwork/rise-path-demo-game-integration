---
paths:
  - "content/**"
---

# Lesson content rules (content/**)

- Format: `risepath.lesson/v1` lessons in `content/courses/<slug>/lessons/<id>.lesson.json`, courses in
  `content/courses/<slug>/course.json` (`risepath.course/v1`). The zod source is
  `shared/lesson/schema.js`. `content/schema/lesson*.schema.json` and `course.schema.json` are
  generated (`npm run lessons:schema`) — never edit them by hand. `rubric.v1.json` and
  `review.v1.json` are hand-written.
- Drafts live in `content/courses/<slug>/drafts/` and appear only at `/preview/<slug>/<id>` in dev.
  Briefs go in `briefs/`, review JSON and reports in `reports/`. Moving a draft to `lessons/` (and
  listing it in `course.json`) is publishing: only when the owner asks.
- After every change: `npm run lessons:validate -- <file>` (0 errors) and
  `npm run lessons:lint -- <file> --strict`. Errors carry JSON paths such as
  `sections[2].blocks[0].questions[0].answer[0]`.
- Migrated-unreviewed lessons (`provenance.migratedFrom` set, `author` `migration` or `migration+…`,
  no `reviewedBy`) are machine-migrated chapters not yet reworked: `--strict` prints their warnings
  as advisory and exits 0. Drafts are always strict. A rework (`/author-lesson`) writes a new
  `provenance.author` and keeps `migratedFrom`, so the lesson becomes strict.
  `--include-migrated` makes every lesson strict.
- Ids: lowercase kebab-case, unique in the lesson, stable. Never renumber existing ids — progress,
  reviews and citations point at them. The lesson id equals the file name. Flashcard ids of a
  published lesson key learners' review memory (`server/tests/fixtures/published-card-ids.json`);
  keep them in a rework, and add a newly published lesson's cards to that file.
- Text: a plain string is in `lesson.locale`; `{jp, en, fr}` objects when the lesson declares several
  `locales` (keys are `jp`, not `ja`). Inline markdown only: **bold**, `code`, [link text](https://…),
  [[glossary term]]. No raw HTML, no headings inside `md`, no italics in Japanese.
- Budgets: sentence ≤ 60 JP chars, paragraph ≤ 160 JP chars / 80 EN words, ≤ 2 callouts per section,
  lists ≤ 7 items, tables ≤ 6 columns, code ≤ 25 lines with `lang` + `filename`, steps ≤ 8 each with
  `expect`, diagrams ≤ 12 nodes with `caption` + `alt`, summary 3–5 points, 4–8 flashcards.
- Questions: `objectiveId` on every question; feedback on every wrong option (≤ 2 sentences naming
  the misconception); an inline quiz at least every 2 content sections.
- Instructions to an AI are `prompt` blocks, not `code`. No decorative or stock images; never invent
  image paths or URLs.
- Write only what the cited sources support: `sources[]` on the lesson (this repository first, then
  official docs), `cite: ["source-id"]` on the block and on every `steps` block (lint `steps-cite`;
  steps that only ask the learner to write or decide keep the warning, with the reason in the
  report; `KNOWN_UNCITED_STEPS` in `shared/lesson/lint.js` lists the published exceptions). Name menus,
  buttons, screens and shortcuts only as the official docs of the pinned version show them
  (`checkedAt`); otherwise describe the goal.
- `level: "beginner"`: an everyday analogy before each new term's definition, in the text or a callout
  `analogy` (the reviewer checks it).
- Full contract: `.claude/skills/author-lesson/references/lesson-contract.md`; blocks:
  `references/block-cookbook.md`; Japanese style: `references/style-guide.ja.md`.
