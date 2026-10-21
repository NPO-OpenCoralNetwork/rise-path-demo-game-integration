# Brief: claude-code/cc-04-verify

第4回｜検証を任せる：テスト・レビュー・説明 — module 2「頼み方と進め方」, lesson 4 of 11 of the Claude Code course
(plan: `doc/brushup-2026/research/claude-code-curriculum.ja.md` §7). Published 2026-10-21 by the owner's
decision in the course `claude-code`: `content/courses/claude-code/lessons/cc-04-verify.lesson.json`, `next` =
`cc-05-context`. It was drafted in `vibe-coding` for preview until then.

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を使い始めた人。バイブコーディングコースの基礎（VS Code・GitHub）があるか、他の AI コーディングツールを使ったことがある開発者。
- すでに知っていること（前提） / prior knowledge: 第1回〜第3回（エージェントループ「情報を集める → 行動する → 結果を確かめる」、権限モードとチェックポイント、探索 → 計画 → 実装 → コミット）。ターミナルで `cd`・`ls` が使える。Git の commit の意味がわかる。演習では Node.js を使う（なければ手元の言語のテストの仕組みで代用できる）。
- 前のレッスン / previous lesson: 第3回「探索→計画→実装→コミット」。次は第5回「コンテキストを管理する」（この回で軽く触れるコンテキストを詳しく扱う）。サブエージェントは第7回で詳しく扱う。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: create): タスクに合う「Claude が自分で実行できる確認」（テスト・ビルド・リンター・スクリーンショット）を設計できる / Design checks Claude can run itself (tests, build, linter, screenshot) that fit the task.
  (The spec said 「lint」; the lesson writes 「リンター」 throughout, so the objective uses the same word.)
- o2 (bloom: analyze): 証拠のない「完了しました」報告を見抜ける / Spot a "done" report that has no evidence.
- o3 (bloom: evaluate): 別のコンテキストでのレビューを依頼し、指摘を必須と任意に仕分けられる / Ask for a review in a fresh context and sort the findings into must-fix and optional.

## 範囲 / Scope
- 扱う / in: 公式ベストプラクティスの最初の項目「Claude に自分の作業を検証する方法を与える」（テスト・ビルド・リンター・スクリーンショット比較）、主張ではなく証拠を求めること、`/goal` の条件（短く紹介）、テストファースト（テストを先に書き、失敗を確かめ、テストを変えずに通るまで実装する）、自己採点が甘くなること、新しいコンテキストでのレビュー（サブエージェントで計画と照らす依頼文、`/code-review`）、過剰設計の罠と「正しさと要件だけを必須にする」仕分け、説明させること（Anthropic の RCT）、出力スタイル Explanatory・Learning。
- 扱わない（別レッスン） / out: Stop フックの書き方（第8回）、コンテキストの管理（第5回）、サブエージェントの作り方（第7回）、`/goal` を使った無人実行と `claude -p`（第9回）、ultrareview・マネージドの Code Review・`/security-review`（名前も出さない）、`/verify`（アプリを動かして確かめる。このレッスンの演習は関数だけなので省く）。
- 学習者がよく持つ誤解 / likely misconceptions (report §6 and facts):
  1. 「完了しました」と言えば完了 — 報告は主張。実行したコマンドと出力などの証拠を見る（best practices）。
  2. 同じ会話で「本当に大丈夫？」と聞き直せば確かめたことになる — 自己採点は甘くなる（harness design: agents "reliably skew positive when grading their own work"）。別のコンテキストに頼む。
  3. テストが通れば正しい — テストを消す・期待値を書き換える・エラーを無視する設定にすれば、間違った実装でも通る（long-running harness: removing or editing tests is "unacceptable"; best practices: "address the root cause, don't suppress the error"）。
  4. レビューの指摘はすべて直すべき — 穴を探すよう頼まれたレビュー役は健全な作業にもたいてい指摘を返す（"usually"）。すべて直すと過剰設計になる（best practices callout）。
  5. どんな確認でもよい — リンターで合計の正しさはわからない、ビルドで見た目はわからない。タスクの「完成」を直接測る確認を選ぶ。
  6. テストが通れば中身を理解しなくてよい — 説明できなければ次に壊れたときに直せない（RCT: AI-assisted learners scored lower unless they asked for explanations or concepts）。
  7. `/goal` の判定役がテストを実行してくれる — 判定役はコマンドを実行せず、会話に出た結果だけを読む（goal docs）。

## 形式 / Format
- 所要時間 / minutes: 19 — `scripts/lessons/measure.mjs`: `cc-04-verify.lesson.json: prose 2242 (budget 1,200–2,400) · read 3218 · practice reading 1046 · questions 12 · practice sections 1 · est 19.5 min (must be ≤ 20; estMinutes 19)` → estMinutes 19.
- 難易度 / level: intermediate
- ロケール / locales: jp only（英訳をいつするかはオーナーが決める。レポート §10）
- 演習の題材 / practice task idea: 新しい練習用フォルダ（`cc-practice-verify`、`git init`）で、うるう年を判定する関数 `isLeapYear` をテストから作らせる。テストをコミット → テストを変えずに実装 → 自分でテストを実行 → 別のコンテキストでレビュー → 指摘を必須と任意に仕分け → 差分を説明させて予想を確かめる。チェックリスト・段階的なヒント・模範解答（テストのコードと仕分けの例）つき。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026年10月時点）。`/review` は v2.1.223 から `/code-review` の別名。Node.js 22（v22.22.0）で例のコード（`postal.test.mjs`、`leap.test.mjs`。どちらも `node:assert/strict` の `equal` を使う）を `node --test` で実行して確認済み（2026-10-20、書き換え後に2026-10-21に再確認）：実装のファイルがない（または export がない）と読み込みで止まり「tests 1 / fail 1」、空の関数（`export function isPostalCode() {}`）なら「fail 4」、実装後は「pass 4 / fail 0」。テストと空の関数をコミットしたあとなら、実装後の `git diff --stat` に出るのは実装のファイルだけ（テストだけをコミットすると、新しい実装のファイルは追跡外で `git diff --stat` に出ない）。
- OS / environment: macOS・Linux・WSL のターミナル。Node.js（`node:test` は組み込みで、追加のインストールは不要）。
- 使ってはいけないもの / avoid: 料金、確かめていない数字や機能、大事なリポジトリでの演習、破壊的なコマンド、秘密情報。プレビュー段階の機能（ultrareview など）は扱わない。

## 資料 / Sources
- `cc-best-practices` — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices — Anthropic — checked 2026-10-20 (WebFetch). Used for: "Give Claude a way to verify its work" (Claude stops when the work looks done; a check that returns pass/fail; tests, build exit code, linter, screenshot compared against a design; before/after prompts incl. validateEmail and "address the root cause, don't suppress the error"); "Have Claude show evidence rather than asserting success"; gating the stop in one prompt / `/goal` / Stop hook / second opinion; "Add an adversarial review step" (fresh subagent sees only the diff and criteria; `/code-review` for correctness; the review prompt against PLAN.md; the over-engineering callout); "have one Claude write tests, then another write code to pass them".
- `cc-chrome` — Use Claude Code with Chrome — https://code.claude.com/docs/en/chrome — Anthropic — checked 2026-10-20 (WebFetch). Used for: the best-practices page links its "browser screenshot" to this page; Claude Code connects to Chrome (Chrome integration, the Claude in Chrome extension) to drive the browser and take screenshots. Cited by the 4-1 note that a screenshot check needs browser access.
- `cc-goal` — Keep Claude working toward a goal — https://code.claude.com/docs/en/goal — Anthropic — checked 2026-10-20 (WebFetch). Used for: the evaluator checks after each turn; it doesn't run commands or read files; a good condition has one measurable end state, a stated check and constraints; `or stop after 20 turns`; `/goal` shows status, `/goal clear` removes it.
- `cc-code-review-local` — Review locally with /code-review — https://code.claude.com/docs/en/code-review-local — Anthropic — checked 2026-10-20 (WebFetch). Used for: `/code-review` reviews branch and uncommitted changes for correctness bugs in a subagent with its own context; `/review` is an alias since v2.1.223 (before, a separate PR review command).
- `cc-output-styles` — Output styles — https://code.claude.com/docs/en/output-styles — Anthropic — checked 2026-10-20 (WebFetch). Used for: an output style sets role, tone and format for the whole session; Explanatory adds `★ Insight` blocks; Learning also leaves `TODO(human)` for the learner and waits; `/output-style <style>` and `/config` → Output style.
- `cc-prompt-library` — Prompt library — https://code.claude.com/docs/en/prompt-library — Anthropic — checked 2026-10-20 (facts file). Used for: "write tests for {feature} first, then implement it until they pass".
- `harness-design` — Harness design for long-running application development (2026-03-24) — https://www.anthropic.com/engineering/harness-design-long-running-apps — Anthropic — checked 2026-10-20 (facts file). Used for: agents "reliably skew positive when grading their own work".
- `long-running-harness` — Effective harnesses for long-running agents (2025-11-26) — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents — Anthropic — checked 2026-10-20 (facts file). Used for: "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality."
- `ai-skills-rct` — How AI assistance impacts the formation of coding skills (2026-01-29) — https://www.anthropic.com/research/AI-assistance-coding-skills — Anthropic — checked 2026-10-20 (facts file). Used for: 52 learners of the Trio library; AI group 50% vs 67% on the follow-up quiz; generation-then-comprehension, hybrid code-explanation and conceptual inquiry kept high scores.
- `opus-55-playbook` — Getting the most out of Opus 5.5 in Claude and Claude Code — https://claude.dev/blog/getting-the-most-out-of-opus-5-5/ — Anthropic — checked 2026-10-20 (facts file). Used for: "Mark anything you couldn't confirm, and say where you looked."; "List only problems you'd block the merge for. For each one, give the file and line, why it's wrong, and how to show it fails."
- `willison-red-green` — Red/green TDD (Agentic Engineering Patterns) — https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/ — Simon Willison — checked 2026-10-20 (facts file; community). Used for: watching the tests fail first shows that they exercise the new code.
- Japanese mirror for learners: https://code.claude.com/docs/ja/best-practices (heading 「Claude に自分の作業を検証する方法を与える」, checked 2026-10-20).
- Repository: `doc/brushup-2026/research/claude-code-curriculum.ja.md` §4, §6, §7, §11; exemplars `vibe-ch1`, `vibe-ch2`, `vibe-ch2-practice`.

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：「完了しました」のあとで | 「正しく動作します」の報告を信じたら翌日エラー。何があれば防げた？ | markdown lead (`hook-lead`, problem in 2 sentences + 1 question), quiz predict | `q0` → o1 (ungraded; which check to give) |
| `4-1` | concept | 4-1. 確かめる手段を渡す | Claude が自分で実行でき、合否がわかる確認を渡すと、通るまで繰り返す（検証） | markdown lead (cite), markdown (`s1-why`: mechanism, recall of the 第1回 agentic loop, "first item of the official guide"), definitions (検証・自動テスト・リンター), markdown (`s1-pick`: choose the check that measures the task's completion directly) + list (`s1-table`, 4 sentences 「〜なら、**確認**が合います。「…」と足します。」; ビルド（build）・スクリーンショット（screenshot） glossed, cite), markdown (`s1-screenshot-note`: a screenshot check needs Claude to drive a browser; link to Chrome integration, cite best practices + chrome), prompt (validateEmail-style request with test cases, cite) | `q1` → o1 (apply: ヘッダーをデザイン画像どおりに → スクリーンショット比較) |
| `4-2` | concept | 4-2. 「完了しました」より証拠を | 報告は主張。コマンドと出力などの証拠を見せてもらう。長い作業は `/goal` の条件にする | markdown lead (cite), definitions (証拠), markdown + prompt (依頼文の最後に足す一言, cite best practices + Opus 5.5 playbook), markdown (`/goal`: defines ターン（turn）= Claude finishing one response; evaluator reads only the transcript; end state, check, constraints; cite), prompt (`/goal` の条件の例) | `q2` → o2 (analyze: どの報告に証拠があるか) |
| `4-3` | example | 4-3. テストを先に書かせる | テストを書く → 失敗を確かめる → テストをコミット → テストを変えずに実装 → 証拠を自分で確かめる | markdown lead (cite), definitions (テストファースト), steps worked example (5 subgoals, each with its why and `expect`; ① writes the tests plus an empty exported function so ② shows 「fail 4」, ③ commits both, ⑤ `git diff --stat` then lists only `postal.mjs`; cite Willison), prompt ①, code `postal.test.mjs` (run with Node.js 22), prompt ④, callout pitfall (テストを書き換えて通す, cite) | `q3` → o2 (analyze: 期待値が書き換わった「全部通りました」) |
| `4-4` | concept | 4-4. 別のコンテキストでレビューする | 自己採点は甘い。新しいコンテキストのレビュー役に、正しさと要件の問題だけを報告させ、指摘を必須と任意に分ける | markdown lead (cite harness design), definitions (コンテキスト・サブエージェント・/code-review), markdown (fresh context sees only diff + criteria), markdown (`/code-review` vs 自作の依頼文), prompt (review against the plan, cite), callout warning (過剰設計 and the fix, cite), markdown + diagram (仕分けの2つの問い; `flowchart TD`, labels ≤ 7 JP chars per line, natural width 327 px), callout info (`/review` は v2.1.223 から別名; docs change often → Japanese official docs link) | `q4` → o3 (evaluate: 送料無料の境目の指摘だけが必須) |
| `4-5` | concept | 4-5. 説明させて、理解を残す | 説明できなければ次に直せない。差分を説明させて予想で確かめる。出力スタイル Explanatory・Learning | markdown lead, markdown (RCT, cite), prompt (差分の説明 + エッジケースの予想), definitions (出力スタイル), markdown (Explanatory・Learning, cite) | `q5` → o3 (evaluate: 意味のわからない指摘 → 説明させて意味をつかみ、要件と照らして仕分ける) |
| `practice` | practice | 演習：テストから作り、別の目で確かめる | 練習用フォルダで isLeapYear をテストファースト → 自分で確かめる → レビュー → 仕分け → 説明と予想 | markdown lead (task + spec + safety), code bash (`terminal`: new folder + `git init` + `claude`), steps (8 subgoals; tests + empty `isLeapYear` committed first; hints and troubleshoots, incl. the Learning style), prompts 1–3 (`expect` = model answers), checklist (7 success criteria), model answer: markdown + code (`leap.test.mjs`, run) + list (`p-model-sort`, 仕分けの例 in 4 sentences) | — |
| `check` | check | 理解度チェック | 全目標、転移問題つき | quiz exam (6) | `e1` → o1 (transfer: CSV の集計ミス), `e2` → o1 (transfer: `/goal` の条件), `e3` → o2 (報告のどこに証拠がないか), `e4` → o2 (transfer: エラーを無視する設定でビルドが通った), `e5` → o3 (レビューの頼み方), `e6` → o3 (transfer, multi: クーポンの指摘から必須を選ぶ) |
| `summary` | summary | まとめ | 持ち帰る5点、振り返りと次の回、復習カード | summary (5), markdown (reflection question + next: 第5回), flashcards (7), askTutor (3) | — |

Contract check: hook = problem + predict; 5 segments (4 concept + 1 example), each with an inline quiz (density 5/6
content sections; practice has none); new terms per segment: 4-1 検証・自動テスト・リンター / 4-2 証拠・/goal・ターン /
4-3 テストファースト / 4-4 コンテキスト・サブエージェント・/code-review / 4-5 出力スタイル (Explanatory and
Learning are the two style names, in the glossary); worked example (4-3 steps + prompts + code) before the practice,
which repeats the same subgoals on a new function with fewer step explanations; every objective has an inline and
two exam questions; exam has transfer items (e1, e2, e4, e6); summary 5 points; 7 flashcards; one process diagram
(sorting findings); no images; ≤ 2 callouts per section; ≤ 3 sentences per paragraph (`scripts/lessons/para-sentences.mjs`: 0 hits); body = `scripts/lessons/measure.mjs` prose 2242 (see minutes); no tables, diagram ≤ 362 px wide and code lines ≤ 44 columns for 390 px screens. Correct options are spread over positions 1–4 (the reader
numbers options by position, so explanations name the content, not the option letter).

## Assumptions
- Headless run: nobody answered the outline check-in, so the outline above was used as is.
- Prerequisite titles of 第1回〜第3回 are taken from the course order in the spec (「最初のタスクを任せる」「探索→計画→実装→コミット」) and from the 第2回 draft already in `drafts/` (「任せる範囲を決める：権限モードと巻き戻し」); they match the published titles in `course.json`.
- The lesson assumes 第1回 introduced the agentic loop. コンテキスト and サブエージェント are defined here briefly and pointed to 第5回 and 第7回.
- The worked example (`isPostalCode`) and the practice (`isLeapYear`) use Node.js's built-in test runner so nothing has to be installed; the practice allows any language's test tool.
- Stop hooks are left to 第8回 and not named here, to keep the new-term budget. `/simplify`, ultrareview and `/verify` are not named either (body budget; `/verify` needs a running app).
- The version note (2026年10月時点・Claude Code v2.1.304) lives in the subtitle; the "Claude Code changes often" note with the Japanese docs link is in the 4-4 info callout, next to the renamed `/review`.
- 「ターン（turn）」 is defined in 4-2 (s2-goal) and in the glossary, because cc-01 to cc-03 do not define it (round-1 review).
- 「エッジケース（edge case）」 was glossed in 第3回; here it has a glossary entry only (no new body text, to stay near the body budget).
- 「過剰設計」 appears once as a label in parentheses inside the 4-4 warning callout, which describes it in the same sentence; it is not counted as a defined term, but it has a glossary entry because several feedback texts use it.
- Spacing follows style guide §3: no space between Japanese and plain alphanumerics (「Claudeが」「AIを」), half-width spaces only around inline code, used the same way throughout. Identifiers in prompts are in backticks for that reason.
- Mobile fit (390 px, course-wide): the two comparisons (`s1-table`, `p-model-sort`) are lists of full sentences, not tables, because table cells split words at 390 px (visual QA); 4-1 states their rule in the lead `s1-pick` (the old table caption). The 4-4 diagram breaks its labels at word boundaries (≤ 7 JP chars per line, 3 lines) and is 327 px wide (`scripts/lessons/diagram-width.mjs`, limit 362). Code lines are ≤ 44 columns (code-width.mjs, a session script; `scripts/lessons/mobile-fit.mjs` now checks code lines in the browser): the tests import `equal` from `node:assert/strict`, and the practice files are `leap.mjs` / `leap.test.mjs`. `p-setup` has one command per line.
- Checklist items are written in です・ます (「…コミットしました」), as in 第1回〜第3回, and the next lesson is named by its exact title 「第5回｜コンテキストを管理する」.
- 依頼文1 asks for the empty `isLeapYear` to be exported, since a missing export stops the tests at load (see Constraints).

### Cross-lesson consistency (2026-10-21)
- s4-fresh and e5: the reviewing subagent does not see the history but reads code itself (cc-07); 「だけ」 removed.
