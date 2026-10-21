# Brief: vibe-coding/cc-09-parallel-automation

第9回｜並列で進める・自動で回す — module 4 「チームと自動化」, lesson 9 of 11 of the Claude Code course
(plan: `doc/brushup-2026/research/claude-code-curriculum.ja.md` §7). Drafted in `vibe-coding/drafts/` for preview;
the course it is published in is the owner's decision.

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を日常の開発に使い始めた人（中級）。1つのセッションで頼む・確かめる・コミットする流れはできる。
- すでに知っていること（前提） / prior knowledge: 第2回（権限モード：Manual・auto・`dontAsk` など、許可ルール）、
  第4回（検証：実行できる確認、差分の説明）、第6回（CLAUDE.md：書いても強制にはならない）、
  第7回（サブエージェント：別のコンテキストで調べ、要点を返す）、第8回（フック、MCP、`.mcp.json`）。
  ターミナルで `cd`・`ls` が使え、Git の commit・branch・merge の意味がわかる。
- 前のレッスン / previous lesson: 第8回｜フックで守らせ、MCPでつなぐ。次は第10回｜安全とコストを管理する。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: evaluate): ワークツリー・サブエージェント・バックグラウンド実行から、状況に合う並列化の方法を選べる
- o2 (bloom: apply): CI（継続的インテグレーション）などで使う安全な `claude -p` コマンドを書ける
- o3 (bloom: create): 無人で動かす作業の依頼文を、成功条件・権限・費用の上限・失敗の報告つきで設計できる

## 範囲 / Scope
- 扱う / in:
  - 並列：サブエージェント（第7回の想起）、ワークツリー（`claude --worktree <名前>`、`.claude/worktrees/<名前>/`、
    ブランチ `worktree-<名前>`、各ワークツリーで依存パッケージを入れる、コミットが1つ以上必要、取り込むまで残す）、
    バックグラウンド実行（Ctrl + B、`/tasks`、`claude --bg`）。トークンの使用量は並べた数だけ増える。
  - 地図としてだけ：エージェントビュー（agent view、試験公開中）、エージェントチーム（agent teams、実験的）。
    必須の手順にはしない。動的ワークフローは、本文の負荷を減らすため名前も出さない（round 1 のレビュー後）。
  - 非対話的実行：`claude -p`、終了コード、`--bare`（推奨、API キーが必要、プロジェクトのフックと `.mcp.json` を読まない）、
    `--allowedTools`（`Bash(npm test *)` のように絞る）、`--permission-mode dontAsk`、`--output-format json`、
    `--max-budget-usd`。v2.1.302 からモード指定なしの `-p` は Manual で始まり、承認が必要な呼び出しは拒否される。
  - 無人実行の置き場所：GitHub Actions、
    クラウドの定期タスク（`/schedule`、旧称 routines）、デスクトップの定期タスク、`/loop`。
  - 公式の4点：成功の条件、読むだけなら読み取りだけ、1回の費用の上限、読み込みの失敗を「何もない」にしない。
    権限と費用は依頼文ではなく設定で決める。
- 扱わない（別レッスン） / out: エージェントチーム・動的ワークフロー・Projects の使い方、`/goal`、Agent SDK、
  GitHub Actions のワークフローを一から書くこと、サンドボックスと秘密情報（第10回）、料金の数字。
- 学習者がよく持つ誤解 / likely misconceptions:
  1. 「同じフォルダーで2つ目のセッションを開けば並行して進む」— 同じファイルを書き換えて変更が混ざる。ワークツリーで分ける。
  2. 「ワークツリーは本体と同じ環境で動く」— 新しいチェックアウトなので依存パッケージを入れ直す。
  3. 「無人の `-p` はすべて自動で許可される／確認で止まる／auto で始まる」— v2.1.302 からは Manual で始まり、承認が必要な操作は拒否される。
  4. 「`--allowedTools "Bash"` で十分」— どのシェルコマンドも通る。必要なコマンドだけに絞る。
  5. 「`-p` は信頼の確認が出るので安全」— 確認は出ず、`--bare` なしではプロジェクトのフックと `.mcp.json` が動く。
  6. 「依頼文に『編集しないで』『安く』と書けば守られる」— 依頼文は強制ではない。権限と費用はフラグや設定で決める（第6回・第8回と同じ考え方）。
  7. 「何も報告がない日は、何もなかった日」— 読み込みの失敗が「何もない」に見える。読めなかったものを名指しで報告させる。

## 形式 / Format
- 所要時間 / minutes: 20（`measure.mjs`: `cc-09-parallel-automation.lesson.json: prose 2265 (budget 1,200–2,400) · read 2653 · practice reading 1246 · questions 11 · practice sections 2 · est 20.0 min (must be ≤ 20; estMinutes 20)`）。
  est = (2,653 + 1,246) / 450 + 11 × 40秒 + 2 × 2分 = 8.66 + 7.33 + 4 = 19.998 → 20。prose rose from 1,583 because the three
  tables became lists (measure.mjs counts lists as prose, tables only as reading).
- 難易度 / level: intermediate
- ロケール / locales: jp のみ（英語版は公開先のコースが決まってから）。
- 演習の題材 / practice task idea: 練習用リポジトリ `cc-practice-09` に、1件だけわざと失敗するテストのある小さなプロジェクトを作り、
  失敗したテストを JSON でまとめる夜間チェックの `claude -p` を書いて、予想してから実行する（演習1）。
  次に、同僚の「毎晩テストを流して、いい感じにまとめて、失敗していたら直しておいて」を4点で点検して直す（演習2）。
  模範解答は演習1がコマンド（`p1-model`）、演習2が点検依頼の `expect`。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20 時点）。`-p` の既定は v2.1.302 以降。
  演習のテストは Node.js の `node:test`（`npm test`）を例にし、ほかの道具でもよいことにする。
- OS / environment: macOS・Linux・WSL のターミナル。ワークツリーには Git リポジトリとコミットが1つ以上必要。
  `--bare` は `ANTHROPIC_API_KEY` が必要なので、サブスクリプションで試すときは練習用フォルダーで `--bare` を外す。
- 使ってはいけないもの / avoid: 料金の数字、モデル ID、確かめていないフラグ・キー操作、`bypassPermissions` を勧めること、
  大事なリポジトリでの演習、プレビュー機能を必須の手順にすること。

## 資料 / Sources
All checked 2026-10-20 (publisher Anthropic). Facts come from the verified facts file for this lesson; the headless,
permissions, worktrees, common-workflows, GitHub Actions and CLI reference pages and the automations post were re-read
on 2026-10-20 for the exact wording used below.
- `cc-worktrees` Run parallel sessions with worktrees — https://code.claude.com/docs/en/worktrees
- `cc-common-workflows` Common workflows — https://code.claude.com/docs/en/common-workflows
- `cc-agents` Run agents in parallel — https://code.claude.com/docs/en/agents
- `cc-sub-agents` Subagents — https://code.claude.com/docs/en/sub-agents
- `cc-interactive-mode` Interactive mode — https://code.claude.com/docs/en/interactive-mode
- `cc-agent-view` Manage multiple agents with agent view — https://code.claude.com/docs/en/agent-view
- `cc-headless` Run Claude Code programmatically — https://code.claude.com/docs/en/headless
- `cc-permission-modes` Choose a permission mode — https://code.claude.com/docs/en/permission-modes
- `cc-permissions` Configure permissions — https://code.claude.com/docs/en/permissions
- `cc-security` Security — https://code.claude.com/docs/en/security
- `cc-cli-reference` CLI reference — https://code.claude.com/docs/en/cli-reference
- `cc-github-actions` Claude Code GitHub Actions — https://code.claude.com/docs/en/github-actions
- `cc-routines` Automate work with scheduled tasks — https://code.claude.com/docs/en/routines
- `cc-scheduled-tasks` Run prompts on a schedule — https://code.claude.com/docs/en/scheduled-tasks
- `agent-automations` Building effective agent automations (2026-10-08) — https://claude.dev/blog/building-effective-agent-automations/

## Outline

| section id | role | title | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：機能の途中で、急ぎのバグ修正が来た | 同じフォルダーの2つのセッションは変更がぶつかる。夜間の報告も頼まれている | markdown (3 sentences), quiz predict | `q0` → o1 (ungraded) |
| `parallel` | concept | 1. 並列の3つの方法を選び分ける | 誰がまとめるか・何を分けるかで、サブエージェント／ワークツリー／バックグラウンドを選ぶ | markdown lead (recall 第7回), definitions (ワークツリー, バックグラウンド実行), list `s1-table` (3 methods as 「〜なら、…」 sentences: what each fits, who merges, the caution), markdown (sessions and subagents multiply tokens; トークン（token） glossed), quiz inline | `q1` → o1 (evaluate, new context: login text fix + payment config change, reviewed and merged separately) |
| `worktree-example` | example | 2. 例題：ワークツリーで2つの作業を並べる | 準備（コミットと信頼）→ 2つのセッション → 環境 → 差分の説明 → 取り込み | markdown lead (says to replace the two tasks with small file additions in the practice repo), code (terminal), steps (5, subgoal + why + expect; ex-setup expect conditional on a project with dependencies), callout info (map, names only: agent view = 試験公開中, agent teams = experimental), quiz inline | `q2` → o1 (analyze: missing deps in a worktree) |
| `headless` | concept | 3. 非対話的実行を安全に書く | `-p` は v2.1.302 から Manual で始まる。5つのフラグで、許すもの・読むもの・費用を決める | markdown lead (defines 非対話的実行 at first use; glossary entry; CI is spelled out in o2), markdown (v2.1.302 + recall 第2回 + docs link + 「下の例は、5つのフラグで…」), code (lint example), numbered list `s3-table` (5 flags: role + without it), callout pitfall (`"Bash"` too broad; シェル（shell） glossed), quiz inline | `q3` → o2 (apply: bare `-p` in CI) |
| `unattended-where` | concept | 4. 無人実行を動かす場所 | 動かす場所と場面で、GitHub Actions／クラウドの定期タスク／デスクトップの定期タスク／`/loop` を選ぶ | markdown lead, definitions (無人実行, 定期タスク), list `s4-table` (4 places as 「〜なら、…」 sentences) | — (no quiz; the neighbouring sections have one) |
| `unattended` | concept | 5. 依頼文を4点で点検する | 依頼文は成功の条件と失敗の報告、権限と費用の上限はフラグや設定で | markdown + list (the 4 points), markdown (enforcement, recall CLAUDE.md), prompt (weekly TODO example, expect maps it to the 4 points), quiz inline | `q4` → o3 (analyze: failed read reported as quiet day) |
| `practice-command` | practice | 演習1：夜間チェックのコマンドを書く | 失敗したテストを JSON にまとめる `claude -p` を書き、予想してから実行 | markdown task, steps (p-project), prompt (setup), steps (p-command, p-run; hint → troubleshoot; p-run says `--bare` needs an API (spelled out) key and to drop it without one), checklist (7, incl. `--bare`), code model answer (labelled by a comment) | — |
| `practice-audit` | practice | 演習2：無人実行の依頼文を点検する | 弱い依頼文を4点で点検して直し、Claude に見落としを聞く | markdown task, markdown quote (weak prompt), steps (p-audit with hint → troubleshoot, p-rewrite with hint), prompt (audit; model answer in expect), checklist (4) | — |
| `check` | check | 理解度チェック | 3つの目標を新しい場面で | quiz exam (6) | `e1` → o1 (research → subagent, transfer), `e2` → o1 (dev server → Ctrl + B), `e3` → o2 (safest CI command: the shared `claude -p` part in the stem, options are short flag sets), `e4` → o2 (unknown repo → `--bare`, transfer), `e5` → o3 (best weekly prompt), `e6` → o3 (multi: what flags enforce, transfer) |
| `summary` | summary | まとめ | 持ち帰る4点、振り返り、次の一歩 | summary (4), markdown (reflection + next), flashcards (7), askTutor (3) | — |

Contract check: hook ≤ 3 sentences + predict; 5 segments + 2 practice sections, inline quizzes in 4 of the 5 segments
(never 3 content sections in a row without one; lint clean); new terms per segment ≤ 3 (parallel 2, example 0 + a
names-only map of 2 preview/experimental features, headless 1, unattended-where 2, unattended 0); worked example (steps with subgoals and why) before practice; practice with
checklists, hint → troubleshoot ladder and model answers; exam covers o1–o3 with transfer items (e1, e4, e6); summary
4 points + 7 flashcards; comprehension habits: explain the diff (ex-explain), explain the failing test (p-project hint),
predict before running (p-run).

## Assumptions
- Headless run: nobody answered the outline check-in, so the outline above was used as is.
- Prerequisite titles are the course's fixed titles: 第2回｜任せる範囲を決める：権限モードと巻き戻し,
  第4回｜検証を任せる：テスト・レビュー・説明, 第6回｜CLAUDE.mdで前提を伝える,
  第7回｜手順はスキルに、調べものはサブエージェントに, 第8回｜フックで守らせ、MCPでつなぐ (第6回 and 第8回 added after
  round 1: the lesson relies on CLAUDE.md, hooks and `.mcp.json`).
- The practice folder is `cc-practice-09` (new, so it does not clash with folders from earlier lessons).
- `--max-budget-usd 1` in the examples is an example value, not a recommendation; the lesson says to start at 3–5 times
  a normal run (automations post) and does not state prices.
- The 「普段の1回分の3〜5倍」 advice comes from the Claude blog post (Managed Agents context); it is presented as Anthropic's
  advice for unattended runs in general, as the facts file does.
- Round 1 review: section 4 was split into `unattended-where` (places) and `unattended` (the 4 points), as the pedagogy
  reviewer asked; the orchestrator accepted a full re-review for it.
- `Failed to resolve base branch` (ex-feature troubleshoot) was checked on 2026-10-20 against Common workflows: "In a
  repository with no commits, the command fails with `Failed to resolve base branch "HEAD": git rev-parse failed`."
- The e4 sentence on VMs follows the Security page (checked 2026-10-20), best practices for untrusted content:
  "Use virtual machines (VMs) to run scripts and make tool calls". Source `cc-security` was added for it.
- Fact audit (2026-10-20, Run agents in parallel / Choose a permission mode): s1-lead now introduces worktrees and
  background execution as tools that help parallel work (the docs count five ways to run agents, not three).
  `dontAsk` is described as denying what would otherwise prompt; reads in the working folders still run (s3-table,
  e3, pc-mode, p2 expect). The summary point keeps the condition 「モードを指定しない」. `/install-github-app` was
  dropped from s4-table to stay within est ≤ 20.
- Mobile fit (390 px): s1-table, s3-table and s4-table have 2 columns (merged cells); long flags in s3-table are split
  into two code spans so the cell can wrap; `anthropics/claude-code-action@v1` was dropped from s4-table (table code
  does not wrap). s2-code runs one command per line (no `&&`), and long lines in s3-code and p1-model were shortened.
  Round 2: every table cell is ≤ 40 JP chars (s3-table `--bare` and `dontAsk` rows shortened; the `--bare` row no longer
  names CLAUDE.md, 「など」 covers it); s3-code and p1-model put the prompt on its own lines so every code line is ≤ 60
  columns; two s2-code comments were shortened. The lesson has no diagram.
  Round 3 (visual QA at 390 px): s1-table, s3-table and s4-table are now lists of full sentences with the same ids
  (their first columns were too long and the second columns broke words; s3-table is numbered so 「5つのフラグ」 stays
  visible, and s3-mode says it before the example). Code comments sit on their own lines and are ≤ 12 JP chars; every
  code line fits the 390 px code box (s3-code: shorter prompt, the `--allowedTools` value on its own line; p1-model:
  the error JSON on two lines; s2-code: `echo` without quotes). ex-feature and p-run start with their inline code, and
  the subtitle is shorter, so `claude -p` and `--bare` do not split at a line end. The `--bare` item says that without
  it both hooks and MCP servers run without a confirmation (cross-lesson fact 8).
- Round 3 ja-editor must-fix: o2 spells out CI（継続的インテグレーション） at first use (plain text); s3-lead now says
  only 「CI」. Also from its niceToHave list: s4-prompt says 「返してください」, and the s3 `dontAsk` item says
  「設定や既定で決まります」.
- Round 2 reviews (pedagogy, ja-editor): q1 moved to a new context (login text + payment config, reviewed separately);
  s2-lead and ex-setup make the worked example reachable in the empty practice repo; トークン（token） and シェル（shell）
  get English and a short gloss at first use (s1-cost, s3-pitfall). Small niceToHave items applied: q4 d is now a
  near-miss prompt instruction, section 4 and 5 titles, s3-table header, s4-table caption, 「設定しなければ」 in q1 a,
  `<依頼文>` in s3-lead and the glossary, the 無人実行 glossary entry matches s4-defs, p-run says why `--bare` needs a key,
  source title 「Choose a permission mode」. Course style: no space in 「Ctrl + Bで」, です・ます in checklist labels and
  card backs. To keep est ≤ 20, the s2-map callout, s4-prompt title, s4-enforce, s4-lead and practice titles were
  tightened and 「旧称routines」 left s4-table (the glossary keeps it).
- Round 4 (visual QA at 390 px, reader update of 2026-10-21; the reader now keeps inline code chips whole and soft-wraps
  long code lines): e3 states the shared part (`claude -p "…"`, `--max-budget-usd 1`) once in the stem and says which
  flag each value belongs to; the options are short sets such as `--bare` ＋ `Bash(npm test *)` ＋ `dontAsk` (ids,
  answer and feedback meaning unchanged). The s1-defs worktree entry keeps the definition and the command; the folder
  (`.claude/worktrees/`) and the branch names move to the ex-feature expect (the glossary keeps the full entry).
  p1-task names 「練習用フォルダー」 before `cc-practice-09`; summary point 3 is three short sentences. p1-model: the
  `--allowedTools` value sits on its own line and the error line is shorter, so no line wraps at 390 px; the highlight
  marks all five flag lines (2, 12–16). ja-editor must-fix: s1-table says 「取り込みは自分でします」.
- Checked 2026-10-20 on Configure permissions: 「`Bash(ls *)` matches `ls`」 (a trailing ` *` also matches the bare
  command), so `Bash(npm test *)` covers a bare `npm test`. On worktrees: "Removing deletes the worktree directory and
  its branch" (ex-merge).

### Last fix round (2026-10-21)
- check-quiz e3 option d: 「だけ」 removed so the four options share one form (ja-editor).

### Cross-lesson consistency (2026-10-21)
- glossary サブエージェント: 「メインの会話」; s3-table: `--bare` also skips CLAUDE.md and skills; e1: only the request and the summary enter the conversation (cc-07); p-run: `--bare` bills the API, not the plan (cc-10). Offsetting cuts in s2-lead and s3-table keep est at 19.998.
