# Brief: vibe-coding/cc-04-verify

第4回｜検証を任せる：テスト・レビュー・説明 — module 2「頼み方と進め方」, lesson 4 of 11 of the Claude Code course
(plan: `doc/brushup-2026/research/claude-code-curriculum.ja.md` §7). Drafted in `vibe-coding` for preview; the owner
decides where it is published.

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
  4. レビューの指摘はすべて直すべき — 穴を探すよう頼まれたレビュー役は健全な作業にも指摘を返す。すべて直すと過剰設計になる（best practices callout）。
  5. どんな確認でもよい — リンターで合計の正しさはわからない、ビルドで見た目はわからない。タスクの「完成」を直接測る確認を選ぶ。
  6. テストが通れば中身を理解しなくてよい — 説明できなければ次に壊れたときに直せない（RCT: AI-assisted learners scored lower unless they asked for explanations or concepts）。
  7. `/goal` の判定役がテストを実行してくれる — 判定役はコマンドを実行せず、会話に出た結果だけを読む（goal docs）。

## 形式 / Format
- 所要時間 / minutes: 19 — body 2,390字 ÷ 450 ≈ 5.3分 + 問題12問 × 40秒 = 8分 + 演習3課題（テストから作る・レビューを仕分ける・説明させて予想する）× 2分 = 6分。
  Body is counted as in the vibe-ch2 report: markdown, callouts, definitions, step text and expected results, table cells and summary points; prompt text, prompt `expect` (collapsed model answers, 679字), step hints and troubleshoots (collapsed, 375字), quizzes and code are left out.
- 難易度 / level: intermediate
- ロケール / locales: jp only（コースの公開先が決まってから英訳する）
- 演習の題材 / practice task idea: 新しい練習用フォルダ（`cc-practice-verify`、`git init`）で、うるう年を判定する関数 `isLeapYear` をテストから作らせる。テストをコミット → テストを変えずに実装 → 自分でテストを実行 → 別のコンテキストでレビュー → 指摘を必須と任意に仕分け → 差分を説明させて予想を確かめる。チェックリスト・段階的なヒント・模範解答（テストのコードと仕分けの表）つき。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026年10月時点）。`/review` は v2.1.223 から `/code-review` の別名。Node.js 22 で例のコード（`postal.test.mjs`、`leap-year.test.mjs`）を `node --test` で実行して確認済み（実装前は fail 4、実装後は pass 4）。
- OS / environment: macOS・Linux・WSL のターミナル。Node.js（`node:test` は組み込みで、追加のインストールは不要）。
- 使ってはいけないもの / avoid: 料金、確かめていない数字や機能、大事なリポジトリでの演習、破壊的なコマンド、秘密情報。プレビュー段階の機能（ultrareview など）は扱わない。

## 資料 / Sources
- `cc-best-practices` — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices — Anthropic — checked 2026-10-20 (WebFetch). Used for: "Give Claude a way to verify its work" (Claude stops when the work looks done; a check that returns pass/fail; tests, build exit code, linter, screenshot compared against a design; before/after prompts incl. validateEmail and "address the root cause, don't suppress the error"); "Have Claude show evidence rather than asserting success"; gating the stop in one prompt / `/goal` / Stop hook / second opinion; "Add an adversarial review step" (fresh subagent sees only the diff and criteria; `/code-review` for correctness; the review prompt against PLAN.md; the over-engineering callout); "have one Claude write tests, then another write code to pass them".
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
| `hook` | hook | はじめに：「完了しました」のあとで | 「正しく動作します」の報告を信じたら翌日エラー。何があれば防げた？ | markdown lead (`hook-lead`, problem in 2 sentences + 1 question), quiz predict | `q0` → o2 (ungraded) |
| `4-1` | concept | 4-1. 確かめる手段を渡す | Claude が自分で実行でき、合否がわかる確認を渡すと、通るまで繰り返す（検証） | markdown lead (cite), markdown (`s1-why`: mechanism, recall of the 第1回 agentic loop, "first item of the official guide"), definitions (検証・自動テスト・リンター), table (確認 × 合うタスク × 依頼文に足す一言, cite), prompt (validateEmail-style request with test cases, cite) | `q1` → o1 (apply: ヘッダーをデザイン画像どおりに → スクリーンショット比較) |
| `4-2` | concept | 4-2. 「完了しました」より証拠を | 報告は主張。コマンドと出力などの証拠を見せてもらう。長い作業は `/goal` の条件にする | markdown lead (cite), definitions (証拠), markdown + prompt (依頼文の最後に足す一言, cite best practices + Opus 5.5 playbook), markdown (`/goal`: evaluator reads only the transcript; end state, check, constraints; cite), prompt (`/goal` の条件の例) | `q2` → o2 (analyze: どの報告に証拠があるか) |
| `4-3` | example | 4-3. テストを先に書かせる | テストを書く → 失敗を確かめる → テストをコミット → テストを変えずに実装 → 証拠を自分で確かめる | markdown lead (cite), definitions (テストファースト), steps worked example (5 subgoals, each with its why and `expect`, cite Willison), prompt ①, code `postal.test.mjs` (run with Node.js 22), prompt ④, callout pitfall (テストを書き換えて通す, cite) | `q3` → o2 (analyze: 期待値が書き換わった「全部通りました」) |
| `4-4` | concept | 4-4. 別のコンテキストでレビューする | 自己採点は甘い。新しいコンテキストのレビュー役に、正しさと要件の問題だけを報告させ、指摘を必須と任意に分ける | markdown lead (cite harness design), definitions (コンテキスト・サブエージェント・/code-review), markdown (fresh context sees only diff + criteria), markdown (`/code-review` vs 自作の依頼文), prompt (review against the plan, cite), callout warning (過剰設計 and the fix, cite), markdown + diagram (仕分けの2つの問い), callout info (`/review` は v2.1.223 から別名; docs change often → Japanese official docs link) | `q4` → o3 (evaluate: 送料無料の境目の指摘だけが必須) |
| `4-5` | concept | 4-5. 説明させて、理解を残す | 説明できなければ次に直せない。差分を説明させて予想で確かめる。出力スタイル Explanatory・Learning | markdown lead, markdown (RCT, cite), prompt (差分の説明 + エッジケースの予想), markdown (Explanatory・Learning, cite), definitions (出力スタイル) | `q5` → o3 (evaluate: 判断できない指摘 → 説明させて要件と照らす) |
| `practice` | practice | 演習：テストから作り、別の目で確かめる | 練習用フォルダで isLeapYear をテストファースト → 自分で確かめる → レビュー → 仕分け → 説明と予想 | markdown lead (task + spec + safety), code bash (`terminal`: new folder + `git init` + `claude`), steps (8 subgoals; hints and troubleshoots, incl. the Learning style), prompts 1–3 (`expect` = model answers), checklist (7 success criteria), model answer: markdown + code (`leap-year.test.mjs`, run) + table (仕分けの例) | — |
| `check` | check | 理解度チェック | 全目標、転移問題つき | quiz exam (6) | `e1` → o1 (transfer: CSV の集計ミス), `e2` → o1 (transfer: `/goal` の条件), `e3` → o2 (報告のどこに証拠がないか), `e4` → o2 (transfer: エラーを無視する設定でビルドが通った), `e5` → o3 (レビューの頼み方), `e6` → o3 (transfer, multi: クーポンの指摘から必須を選ぶ) |
| `summary` | summary | まとめ | 持ち帰る5点、振り返りと次の回、復習カード | summary (5), markdown (reflection question + next: 第5回), flashcards (7), askTutor (3) | — |

Contract check: hook = problem + predict; 5 segments (4 concept + 1 example), each with an inline quiz (density 5/6
content sections; practice has none); new terms per segment: 4-1 検証・自動テスト・リンター / 4-2 証拠・/goal /
4-3 テストファースト / 4-4 コンテキスト・サブエージェント・/code-review / 4-5 出力スタイル (Explanatory and
Learning are the two style names, in the glossary); worked example (4-3 steps + prompts + code) before the practice,
which repeats the same subgoals on a new function with fewer step explanations; every objective has an inline and
two exam questions; exam has transfer items (e1, e2, e4, e6); summary 5 points; 7 flashcards; one process diagram
(sorting findings); no images; ≤ 2 callouts per section; ≤ 3 sentences per paragraph; body 2,390字.

## Assumptions
- Headless run: nobody answered the outline check-in, so the outline above was used as is.
- Prerequisite titles of 第1回〜第3回 are taken from the course order in the spec (「最初のタスクを任せる」「探索→計画→実装→コミット」) and from the 第2回 draft already in `drafts/` (「任せる範囲を決める：権限モードと巻き戻し」); they may need a touch-up if the other drafts end with different titles.
- The lesson assumes 第1回 introduced the agentic loop and the word ターン. コンテキスト and サブエージェント are defined here briefly and pointed to 第5回 and 第7回.
- The worked example (`isPostalCode`) and the practice (`isLeapYear`) use Node.js's built-in test runner so nothing has to be installed; the practice allows any language's test tool.
- Stop hooks are left to 第8回 and not named here, to keep the new-term budget. `/simplify`, ultrareview and `/verify` are not named either (body budget; `/verify` needs a running app).
- The version note (2026年10月時点・Claude Code v2.1.304) lives in the subtitle; the "Claude Code changes often" note with the Japanese docs link is in the 4-4 info callout, next to the renamed `/review`.
- 「ターン」 is used in 4-2 without a definition, on the assumption that 第1回 introduced it with the agentic loop.
- 「過剰設計」 appears once as a label in parentheses inside the 4-4 warning callout, which describes it in the same sentence; it is not counted as a defined term.
- Spacing follows style guide §3: no space between Japanese and plain alphanumerics (「Claudeが」「AIを」), half-width spaces only around inline code, used the same way throughout. Identifiers in prompts are in backticks for that reason.
