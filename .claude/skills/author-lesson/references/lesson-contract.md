# risepath.lesson/v1 lesson contract

The teaching rules every Rise Path lesson follows, whoever writes it (Claude Code, another agent
through MCP, or a person). Structure is enforced by `npm run lessons:validate`; the measurable rules
below are checked by `npm run lessons:lint`; the rest is judged with `content/schema/rubric.v1.json`.
Quality means what the learner can **do** after the lesson, not how many blocks it has.

## 1. One lesson, one big idea

- 8–20 minutes (`estMinutes`). Estimate with 450 JP characters (180 EN words) per minute of study
  reading, plus 40 seconds per question and 2 minutes per practice task.
- `level`, `prerequisites` (earlier lesson titles or skills) and `locale` (`jp` first) are set.
- `objectives`: 2–4 can-do statements, each `{id: "o1", text, bloom}`. Use an observable verb that
  matches the Bloom level; never 「理解する」/ "understand" on its own.

| bloom | JP verbs (〜できる) | EN verbs |
|---|---|---|
| remember | 挙げる、言える | list, name |
| understand | 説明する、例を挙げる、言い換える | explain, give an example, summarize |
| apply | 使う、書き分ける、実行する | use, write, run, choose |
| analyze | 見分ける、原因を特定する、比べる | tell apart, find the cause, compare |
| evaluate | 判断する、選んで理由を言う | judge, justify a choice |
| create | 作る、設計する | build, design |

## 2. Shape (section `role`s, in order)

1. **hook** — a concrete problem the learner will be able to solve by the end, in at most 3
   sentences, plus one ungraded prediction question (quiz `mode: "predict"`). No trivia, statistics
   or "did you know" openers.
2. **3–5 segments** (`concept` / `example`), one idea each:
   - explanation of at most 300 JP characters (150 EN words), new terms defined before use
     (`definitions` + `glossary`), at most 3 new terms per segment;
   - an analogy (callout `analogy`) only before the formal definition, and never quizzed;
   - a diagram only when it shows structure, process, state change or comparison;
   - a worked example of 3–6 steps with subgoal labels and the why of each step (`steps` or `code`);
   - 1–2 inline check questions (quiz `mode: "inline"`) — **at least one inline quiz every 2 content
     sections**, never 3 content sections in a row without one;
   - at most one common pitfall (callout `pitfall`), only when it is a real, frequent mistake.
3. **practice** — an authentic task close to real use: what to do, success criteria (`checklist`),
   hints from gentle to explicit (`hint`, then `troubleshoot` on `steps`, or quiz `hint`), and a
   model answer (`prompt.expect`, or a code/steps block after the hints).
4. **check** — quiz `mode: "exam"` that covers every objective; at least one question asks the
   learner to apply the idea in a new situation (transfer).
5. **summary** — the last section: a `summary` block with 3–5 takeaways (after the recap, not
   before), and 4–8 `flashcards` for spaced review.
6. **reflection** (optional section) — one question to think about, plus `askTutor` suggestions.
   The reader adds a confidence check per objective at the end of every lesson.

## 3. Length budgets (lint-enforced where marked)

| Item | Limit |
|---|---|
| Sentence (JP) | ≤ 60 characters (lint `sentence-length`) |
| Paragraph | ≤ 160 JP characters / 80 EN words (lint `paragraph-length`) |
| Body text of the lesson | 1,200–2,400 JP characters (600–1,200 EN words), code excluded |
| New terms per segment | ≤ 3 |
| Callouts per section | ≤ 2, each ≤ 3 sentences (lint `callout-count`) |
| List items | ≤ 7 (lint `list-length`) |
| Table columns | ≤ 6 (lint `table-columns`) |
| Code block | ≤ 25 lines, with `lang` and `filename` (lint `code-length`, `code-filename`) |
| Steps per block | ≤ 8, each with `expect` (lint `steps-length`, `steps-expect`) |
| Diagram | ≤ 12 nodes, with `caption` and `alt` (lint `diagram-caption`) |
| Summary points | 3–5 (lint `summary-points`) |
| Flashcards per lesson | 4–8 (lint `flashcards-count`) |
| Decorative or stock images | 0 (lint `image-decorative`) |

## 4. Questions

- Every question has `objectiveId`; every objective is assessed at least once (lint
  `objective-unassessed`), ideally twice (one inline, one in the exam).
- 3–4 options, parallel in length and grammar. No "all of the above".
- Every wrong option encodes a real misconception and has `feedback` of at most 2 sentences that
  names and corrects it (lint `quiz-feedback`, `feedback-length`). `explanation` says why the answer
  is right.
- Ask for application in a new context, not recognition of the sentence just read. Never quiz the
  analogy, the hook's anecdote or trivia.

## 5. Accuracy and sources — never fabricate

- Every non-obvious claim (numbers, dates, behaviour of a tool, prices, limits) is backed by a
  source: add it to `sources[]` (`id`, `title`, `url`, `publisher`, `checkedAt`) and reference it
  with `cite: ["source-id"]` on the block. Prefer official documentation and material already in
  this repository.
- Pin tool versions where behaviour differs between versions ("Unity 6", "Node.js 22").
- Never invent URLs, image paths, APIs, commands, keyboard shortcuts, quotes or statistics. If a
  fact cannot be verified, leave it out or ask; do not guess.
- Code runs as written. Commands are safe to copy (no destructive defaults, no secrets).

## 6. Language and style

- Write natively in the lesson locale (Japanese first), then translate in a separate pass.
- Japanese: です・ます調, warm and non-pressuring; no 「簡単です」「誰でも」 (EN: "simply",
  "obviously", "anyone can") — lint `banned-phrase`. Katakana terms carry the English on first use:
  参照（reference）. No italics in Japanese; use 「」 for emphasis. Full guide:
  `.claude/skills/author-lesson/references/style-guide.ja.md`.
- Locale keys are `jp | en | fr` (not `ja`). A plain string is in `lesson.locale`; in a lesson whose
  `locales` lists several languages, every learner-facing text is an object with every locale
  (lint `locale-plain-string`), diagram labels included.
- Instructions to an AI go in `prompt` blocks with `{{variables}}` and `expect`, never in `code`.

## 7. Ids, files and provenance

- Ids are lowercase kebab-case and stable: sections, blocks, questions, options, steps, cards.
  Never renumber existing ids (progress, reviews and citations point at them).
- New and reworked lessons are drafts: `content/courses/<course>/drafts/<lesson>.lesson.json`.
  Moving a lesson to `lessons/` and listing it in `course.json` is publishing, and only happens
  when the owner asks.
- `provenance`: `{author, model?, skill?, skillVersion?, generatedAt, reviewedBy?}`. Do not invent
  a reviewer; `reviewedBy` is set by the human who reviewed it.
