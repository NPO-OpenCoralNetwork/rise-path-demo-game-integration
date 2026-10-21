# Brief: claude-code/cc-11-capstone

第11回 総合演習｜自分のリポジトリにClaude Code環境をつくる — the capstone of the Claude Code course
(module 4 「チームと自動化」, lesson 11 of 11). A practice-centred lesson shaped like
`vibe-ch2-practice`: hook + predict, two short segments that recall and connect earlier lessons (the design
rule and a worked example), three practice sections (build the setup, run one full cycle, self-check),
an exam with transfer items, summary + flashcards. Japanese only. Published 2026-10-21 by the owner's decision in the
course `claude-code`: `content/courses/claude-code/lessons/cc-11-capstone.lesson.json`, the last lesson (no `next`).
Until then it was a draft (`courseId: "vibe-coding"`, no `next`).

## 学習者 / Learner (必須)
- 誰が読むか / who: 第1回〜第10回を終えた人。自分のリポジトリ（または練習用フォルダ）で、Claude Codeを日常の開発に使い始めたい開発者・学習者。
- すでに知っていること（前提） / prior knowledge: 権限モードと権限ルール（第2回）、探索→計画→実装→コミットとプランモード（第3回）、実行できる検証と別コンテキストのレビュー（第4回）、`/clear` と `/context`（第5回）、CLAUDE.md（第6回）、スキルとサブエージェント（第7回）、フックとMCP・プラグイン（第8回）、秘密情報とコスト（第10回）。ターミナルで `cd`・`ls` が使え、Gitのcommitの意味がわかる。
- 前のレッスン / previous lesson: 第10回 安全とコスト。これがコースの最後のレッスン。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: create): CLAUDE.md・スキル・フック・権限ルールを組み合わせて、自分のリポジトリ用のClaude Code環境を設計できる
- o2 (bloom: evaluate): チェックリストを使って、自分の環境と作業の進め方を評価し、次に足すものを判断できる

## 範囲 / Scope
- 扱う / in: 公式の「設定は少しずつ育てる」原則（CLAUDE.mdから始め、きっかけが来たら部品を足す）を設計のルールにする。お願い（CLAUDE.md・スキル）と強制（フック・権限ルール）の区別。例題：小さなToDoアプリ（短いCLAUDE.md、スキル1つ `/explain-diff`、PostToolUseの整形フック1つ、`git push` の確認ルール、`.env` の拒否ルール）。演習：自分のリポジトリで環境をつくり、1サイクル（探索→計画（プランモード）→実装と実行できる検証→別コンテキストのレビュー→差分の説明→コミット）を回す。秘密情報とpushの守りは例外として、きっかけを待たずに初日から権限ルールで置く。点検チェックリスト（安全・検証・コンテキスト・コスト）と、変化への追いつき方（まとめで、公式ドキュメント日本語版で確かめる）。
- 扱わない（別レッスン） / out: 各部品の詳しい書き方（第2回〜第10回で学習済み。思い出す程度にとどめる）、MCPサーバーやプラグインの導入手順、CI・並列（第9回）、料金（公式ページへ）。
- 学習者がよく持つ誤解 / likely misconceptions (report §6 and the facts file):
  1. 「拡張機能は最初に全部入れる」— 公式の勧めは逆。CLAUDE.mdから始め、繰り返す困りごと（きっかけ）が来たら足す（pq0、e1 d）。
  2. 「CLAUDE.mdに『必ず』『〜するな』と書けば守られる」— CLAUDE.mdとスキルはお願い。必ず守らせたいことはフックと権限ルール（q1、e1 b、e2 a）。
  3. 「強く止めるほど安全」— 2回のまちがいには、まずCLAUDE.mdに1行。拒否ルールやフックで止めると、必要な場面でも使えない（q2）。
  4. 「『完了しました』と言えば完了／同じ会話で聞き直せば確か」— 実行できる検証の結果で判断し、レビューは別のコンテキストで（e3）。
  5. 「レビューの指摘は全部直す／0になるまで回す」— 正しさと要件に関わるものだけ直す。追いかけすぎると過剰設計（q3）。
  6. 「長い会話を続けるほど賢くなる」— 関係のない作業の間は `/clear`（q4）。
  7. 「古い記事どおりにすればよい」— Claude Codeは頻繁に変わる。公式ドキュメントで今の書き方を確かめる（`summary-next`、`card-update`。試験では問わない）。

## 形式 / Format
- 所要時間 / minutes: estMinutes 19 (course-wide measure `scripts/lessons/measure.mjs`, after the mobile-fit and cross-lesson fixes: `cc-11-capstone.lesson.json: prose 1344 (budget 1,200–2,400) · read 1894 · practice reading 1672 · questions 8 · practice sections 3 · est 19.3 min (must be ≤ 20; estMinutes 19)`; 19.3 → 19). The measure times each practice section at 2 min, `self-check` included; `self-check` is also the success-criteria checklist of the other two tasks. Work in the learner's own repository takes longer than this reading estimate; the lesson does not state a number for it.
- 難易度 / level: intermediate
- ロケール / locales: jp only (course decision; when to add English is the owner's decision, report §10).
- 演習の題材 / practice task idea: the capstone task itself — on the learner's own repository (a working branch if it matters) or the earlier practice folder: build the setup (CLAUDE.md ≤ 25 lines, ask/deny rules, extensions only where a trigger already exists), then one full cycle on a small task they have been postponing. Success criteria: each step's `expect`, and `self-check-list` (6 items over safety, verification, context, cost; it doubles as the self-assessment). Hint ladder: step `hint` → `troubleshoot` → model answers. Model answers: CLAUDE.md for a Python kakeibo CLI (19 lines, in `setup-prompt-model`), an ask/deny settings snippet (`setup-settings-model`), and a plan prompt with an expected plan (`cycle-prompt-plan`).

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304 (2026-10-20). Version pin where a default changed: auto mode is the starting mode of interactive terminal and VS Code sessions from v2.1.283 (`ex-steps` ②, worded as in 第1回, 第2回 and 第10回). The worked-example hook uses `jq` and Prettier; step ③ gives the full command and says that `jq` picks out the edited file name.
- OS / environment: terminal (macOS / Linux / WSL). Keys from the docs only: Shift+Tab (plan mode), Ctrl+G (edit the plan).
- 使ってはいけないもの / avoid: prices (no prices in the lesson), preview features as required steps, destructive commands, secrets, asking Claude to search for secret files. CLAUDE.md and SKILL.md contents are shown inside `prompt` blocks (instructions to Claude Code that write the file), because `code` blocks with `lang: "markdown"` trip lint `code-should-be-prompt`.

## 資料 / Sources
All checked 2026-10-20 (facts file `content/courses/claude-code/reports/facts/cc-11-capstone.facts.md`, other cc facts files for recall, plus WebFetch of the official pages marked *).
- `cc-features-overview` — Extend Claude Code (Build your setup over time; trigger table; "a request, not a guarantee") — https://code.claude.com/docs/en/features-overview
- `cc-memory` — How Claude remembers your project (when to add to CLAUDE.md, `/context` Memory files, loading at launch) — https://code.claude.com/docs/en/memory
- `cc-best-practices` — Best practices for Claude Code (concise CLAUDE.md, verification, adversarial review in a fresh context, over-engineering warning, `/clear` between tasks, skip the plan for one-sentence diffs) — https://code.claude.com/docs/en/best-practices
- `cc-permissions`* — Configure permissions (`Bash(git push *)` also matches the bare command; `Read(./.env)`; deny → ask → allow; `/permissions` shows each rule's source; Read deny rules do not cover a script that opens files itself; `git -C . push` is not matched by `Bash(git push *)`, a rule "isn't a security boundary") — https://code.claude.com/docs/en/permissions
- `cc-settings`* — Settings files and precedence (`Read(./.env)`, `Read(./.env.*)` example; strict JSON, trailing comma is an error; `/status`; `.claude/settings.local.json` is personal) — https://code.claude.com/docs/en/settings
- `cc-permission-modes` — Choose a permission mode (auto mode is the starting mode from v2.1.283; plan mode, Ctrl+G) — https://code.claude.com/docs/en/permission-modes
- `cc-hooks-guide` — Automate actions with hooks (PostToolUse `Edit|Write` + Prettier recipe; `/hooks`) — https://code.claude.com/docs/en/hooks-guide
- `cc-skills`* — Extend Claude with skills (project skill path, `` !`git diff HEAD` `` injection, `allowed-tools`, a failed command aborts the skill, `disable-model-invocation`; a skills directory created after the session started needs `/reload-skills`) — https://code.claude.com/docs/en/skills
- `cc-sub-agents` — Create custom subagents (own context window, returns a summary) — https://code.claude.com/docs/en/sub-agents
- `cc-prompt-caching` — How Claude Code uses prompt caching (root CLAUDE.md edits load on the next `/clear`, `/compact` or restart) — https://code.claude.com/docs/en/prompt-caching
- `cc-champion-kit` — Champion kit ("a real but contained task … tedious rather than difficult"; "Claude Code is updated frequently") — https://code.claude.com/docs/en/champion-kit
- `cc-costs` — Manage costs effectively (`/usage`) — https://code.claude.com/docs/en/costs
- `cc-authentication` — Authentication (`ANTHROPIC_API_KEY` overrides the subscription once approved; `/status`) — https://code.claude.com/docs/en/authentication
- `steering-post` — Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents (2026-06-18; 30-line procedure → skill; "A real guardrail needs to be deterministic") — https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
- `harness-design` — Harness design for long-running apps (2026-03-24; agents skew positive when grading their own work) — https://www.anthropic.com/engineering/harness-design-long-running-apps
- Repository: `content/courses/vibe-coding/lessons/vibe-ch2-practice.lesson.json` (shape of a practice-centred lesson), report `doc/brushup-2026/research/claude-code-curriculum.ja.md` §6, §7, §11.

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：学んだ部品を、どこから組み合わせる？ | 佐藤さんが初日に拡張を全部入れようとして止まる。何から始める？ | markdown `hook-b1` (3-sentence scenario), quiz predict `hook-predict` | `pq0` → o1 (ungraded) |
| `design-rule` | concept | 設計のルール：CLAUDE.mdから始め、きっかけが来たら足す | 公式の「少しずつ育てる」原則と、きっかけ→部品の対応（第6〜8回の想起）。お願いと強制を分ける | markdown `dr-b1` (rule, defines きっかけ), table `dr-table` (2 columns: 5 triggers → part, with the lesson number in the part cell such as 「CLAUDE.mdに1行足す（第6回）」), markdown `dr-b2` (request vs guarantee; secrets and push are guarded with permission rules from day 1, without waiting for a trigger; a permission rule stops only matching operations, not a script that opens a file itself or a push written as `git -C . push`), quiz inline `dr-quiz` | `q1` → o1 (apply: ESLint forgotten despite CLAUDE.md → hook) |
| `example` | example | 例題：小さなToDoアプリの環境 | 5 steps, each with its trigger (why): CLAUDE.md → deny `.env` + ask `git push` (v2.1.283: terminal and VS Code sessions start in auto mode) → PostToolUse format hook → `/explain-diff` skill → commit and share | markdown `ex-b1` (timeline: ① and ② on day 1, ③ and ④ added in the week their trigger came), steps `ex-steps` (5, subgoal titles, expect; ① expect: CLAUDE.md shows in `/context` after a restart; ③ writes out the full hook command and what `jq` does; ④ has the troubleshoot 「呼べないときは `/reload-skills` を実行します。」), prompt `ex-prompt-claude-md`, code `ex-settings` (`.claude/settings.json`, 22 lines, one deny entry per line), prompt `ex-prompt-skill` (expect: run `/reload-skills` first when `.claude/skills/` was created after launch), quiz inline `ex-quiz` | `q2` → o1 (apply: `npm install` repeated twice → one CLAUDE.md line, not deny/hook) |
| `practice-setup` | practice | 演習1：自分のリポジトリに環境をつくる | Build the setup: CLAUDE.md, ask/deny, only extensions whose trigger exists, restart and check | markdown `setup-task`, steps `setup-steps` (4, hint and/or troubleshoot on each), prompt `setup-prompt-model` (model CLAUDE.md, 19 lines; expect: the deny rule covers Claude's file operations, not a Python script that opens files; `note` says it is a Python kakeibo example), code `setup-settings-model` (ask + 3 deny rules) | — |
| `practice-cycle` | practice | 演習2：1つの変更を計画からコミットまで進める | One full cycle on a postponed small task (recall 第3〜5回) with predict and explain habits | markdown `cycle-task`, diagram `cycle-flow` (flowchart TD, 5 nodes + review loop; the review node breaks as 「別のコンテキストで／レビューする／（サブエージェント）」), steps `cycle-steps` (5), prompt `cycle-prompt-plan` (model plan prompt + expected plan), prompt `cycle-prompt-review`, quiz inline `cycle-quiz` | `q3` → o2 (evaluate: triage 5 review findings) |
| `self-check` | practice | 演習3：点検して、次に足すものを決める | Self-check in 4 areas (also the success criteria of the capstone); an unmet item is the next trigger; recurring review comments go to CLAUDE.md | markdown `sc-b1`, checklist `self-check-list` (6; `sc-safety` checks that the deny and ask rules are written, not that every push is confirmed), markdown `sc-b2`, quiz inline `sc-quiz` | `q4` → o2 (evaluate: kitchen-sink session → `/clear`; the stem describes the symptom, not the checklist item) |
| `check` | check | 理解度チェック | Both objectives, all in new contexts | quiz exam `check-quiz` (3) | `e1` → o1 (Python web app: three symptoms → design), `e2` → o1 (30-line release procedure in CLAUDE.md → skill), `e3` → o2 (teammate's self-check: no verification → add a runnable check) |
| `summary` | summary | まとめ | 4 takeaways, reflection, next step, keep up with updates | summary `summary-points` (4; point 2 uses `dr-b2`'s 「Claudeの判断に任せたくないこと」 instead of 必ず), markdown `summary-next` (reflection, next step, check the Japanese official docs when something does not work), flashcards `summary-cards` (7; `card-ask` says `git -C . push` is not matched), askTutor `summary-ask` (3) | — |

Contract check: hook ≤ 3 sentences + predict; 5 content sections (2 segments + 3 practice), 4 with an inline quiz
(lint needs 3; never 3 in a row without one); new terms: only きっかけ (glossary); the other terms are recalled from
earlier lessons and linked to the glossary; worked example of 5 steps with subgoal titles, the trigger (why) and
`expect`, before practice; practice has task, success criteria (step `expect` + the 6-item self-check list), hint → troubleshoot → model answers;
exam covers both objectives with transfer contexts (Python web app, release procedure, a teammate's self-check); summary 4 points after the exam; 7 flashcards; reflection + askTutor. One diagram (the cycle with the
review loop); no images.

## Assumptions
- Headless run: the outline above was used as is.
- The scenario person 佐藤さん and the ToDo app (Node.js, `npm test`, `src/store.js`) and the model-answer project
  (Python kakeibo CLI) are fictional examples; their CLAUDE.md lines describe those fictional projects. Every Claude Code
  command, setting key, rule pattern and key binding is from the official docs.
- CLAUDE.md and SKILL.md contents are shown as `prompt` blocks that ask Claude Code to write the file (lint forbids
  `code` blocks with `lang: "markdown"`). The settings files are `code` blocks with `lang: "json"`.
- The skill `explain-diff` follows the docs' `summarize-changes` example, with `allowed-tools: Bash(git diff *)`
  because injected commands must pass permission rules outside auto mode; its `note` says that `git diff HEAD` fails
  (and aborts the skill) in a repository with no commits.
- The practice runs on the learner's own repository on a working branch, or on the earlier practice folder. The lesson
  never asks to push; the ask rule makes any push prompt first.
- 「関係のない作業の前に `/clear`」 is evaluated in the self-check rather than required inside the cycle, because the
  cycle starts in the fresh session opened by the restart in practice step `p-restart`.
- Prerequisites list the exact course titles of the lessons this one recalls (第2回–第8回, 第10回).
- Secrets and push are the one exception to 「きっかけが来たら足す」: their permission rules go in on day 1, because one
  leak or one unwanted push is already too many (`dr-b2`, `pq0` explanation, `ex-b1`).
- Correct options are spread over the four positions (2 each over the 8 questions).
- Fact audit (round 2): `/explain-diff` works right away only when `.claude/skills/` existed at launch, so `ex-prompt-skill` and
  `ex-skill` name `/reload-skills`; the limits of permission rules (scripts that open files, `git -C . push`) are stated in
  `dr-b2`, `setup-prompt-model` and `card-ask`, and `card-ask` no longer says 必ず.
- The abbreviations API and JSON no longer appear in learner text (`ex-rules` says 「秘密情報」, `p-rules` says
  「設定ファイル」, `e1` says 「Webアプリ」), to stay within the body budget; MCP is spelled out in `e3`.
- Mobile fit (390 px, from visual QA): the one table (`dr-table`) has 2 columns; `cycle-flow` is `flowchart TD` with
  node labels of at most 12 characters per line, broken at word boundaries; in `ex-settings` the deny entries are one
  per line. Its hook command line (a JSON string, as in the hooks guide) cannot be shortened, so step ③ writes the
  full command in prose. The other code block (`setup-settings-model`) already fits; no step asks for commands line by line.
- Cross-lesson facts: `ex-rules` limits the auto-mode start to terminal and VS Code sessions; `sc-safety` and
  `summary-points` no longer promise that every push is confirmed (a `Bash(git push *)` rule does not match
  `git -C . push`); `ex-claude-md`'s expect says the new CLAUDE.md shows in `/context` after a restart, as `p-restart` says.
- The capstone's success criteria and the self-assessment are one checklist (`self-check-list`) to stay within the
  body budget; a separate cycle checklist duplicated it.
- Not included, to stay within the body budget: the large-codebases advice to review the configuration every 3–6
  months and after major model releases (verified, could be added to `sc-b2`); the MCP row of the trigger table; the
  What's new digest and asking Claude Code about itself (round-1 review cut `sc-b3`, `sc-list` and exam item `e4`).

## Measured
Course-wide measure (`scripts/lessons/measure.mjs`) after the mobile-fit and cross-lesson fixes: prose **1,344** (budget 1,200–2,400),
read 1,894, practice reading 1,672, 8 questions (1 predict, 4 inline, 3 exam), 3 practice sections, est 19.3 min →
estMinutes 19 (2026-10-21).
`lessons:validate` 0 errors, `lessons:lint --strict` 0 warnings.

### Last fix round (2026-10-21)
- dr-table fits 356 px: headers 「繰り返す困りごと／足す部品」, the lesson numbers stay in the cells and the caption says so; the (subagent、…) gloss stays, as the first body use of the term (visual QA; pedagogy-reviewer and ja-editor).

### Cross-lesson consistency (2026-10-21)
- 200行未満 as in cc-06; the check areas are 「安全・検証・コンテキスト・コストの4分野」 (cc-03 uses 「4つの観点」 for something else); ex-prompt-skill explains `allowed-tools`.
