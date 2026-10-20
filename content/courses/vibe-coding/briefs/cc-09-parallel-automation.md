# Brief: vibe-coding/cc-09-parallel-automation

第9回｜並列で進める・自動で回す — module 4 「チームと自動化」, lesson 9 of 11 of the Claude Code course
(plan: `doc/brushup-2026/research/claude-code-curriculum.ja.md` §7). Drafted in `vibe-coding/drafts/` for preview;
the course it is published in is the owner's decision.

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を日常の開発に使い始めた人（中級）。1つのセッションで頼む・確かめる・コミットする流れはできる。
- すでに知っていること（前提） / prior knowledge: 第2回（権限モード：Manual・auto・`dontAsk` など、許可ルール）、
  第4回（検証：実行できる確認、差分の説明）、第7回（サブエージェント：別のコンテキストで調べ、要点を返す）。
  ターミナルで `cd`・`ls` が使え、Git の commit・branch・merge の意味がわかる。
- 前のレッスン / previous lesson: 第8回「フックとMCP」。次は第10回（安全とコスト）。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: evaluate): ワークツリー・サブエージェント・バックグラウンド実行から、状況に合う並列化の方法を選べる
- o2 (bloom: apply): CI などで使う安全な `claude -p` コマンドを書ける
- o3 (bloom: create): 無人で動かす作業の依頼文を、成功条件・権限・費用の上限・失敗の報告つきで設計できる

## 範囲 / Scope
- 扱う / in:
  - 並列：サブエージェント（第7回の想起）、ワークツリー（`claude --worktree <名前>`、`.claude/worktrees/<名前>/`、
    ブランチ `worktree-<名前>`、各ワークツリーで依存パッケージを入れる、コミットが1つ以上必要、取り込むまで残す）、
    バックグラウンド実行（Ctrl + B、`/tasks`、`claude --bg`）。トークンの使用量は並べた数だけ増える。
  - 地図としてだけ：エージェントビュー（`claude agents`、リサーチプレビュー）、エージェントチーム（実験的）、
    動的ワークフロー（`ultracode`）。必須の手順にはしない。
  - 非対話的実行：`claude -p`、終了コード、`--bare`（推奨、API キーが必要、プロジェクトのフックと `.mcp.json` を読まない）、
    `--allowedTools`（`Bash(npm test *)` のように絞る）、`--permission-mode dontAsk`、`--output-format json`、
    `--max-budget-usd`。v2.1.302 からモード指定なしの `-p` は Manual で始まり、承認が必要な呼び出しは拒否される。
  - 無人実行の置き場所：GitHub Actions（`anthropics/claude-code-action@v1`、`/install-github-app`）、
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
- 所要時間 / minutes: 17（本文 約2,420字 ≈ 5.4分 + 問題11問 ≈ 7.3分 + 演習2つ × 2分 = 16.7 → 17）。
  本文の数え方：markdown・callout・definitions（用語名を含む）・表のセル・steps（md/expect/hint/troubleshoot）・summary の
  文字数（空白なし）。インラインコードは除く（契約の「code excluded」）。インラインコードも数えると約2,850字。
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
- `cc-workflows` Orchestrate subagents at scale with dynamic workflows — https://code.claude.com/docs/en/workflows
- `cc-headless` Run Claude Code programmatically — https://code.claude.com/docs/en/headless
- `cc-permission-modes` Permission modes — https://code.claude.com/docs/en/permission-modes
- `cc-permissions` Configure permissions — https://code.claude.com/docs/en/permissions
- `cc-cli-reference` CLI reference — https://code.claude.com/docs/en/cli-reference
- `cc-github-actions` Claude Code GitHub Actions — https://code.claude.com/docs/en/github-actions
- `cc-routines` Automate work with scheduled tasks — https://code.claude.com/docs/en/routines
- `cc-scheduled-tasks` Run prompts on a schedule — https://code.claude.com/docs/en/scheduled-tasks
- `agent-automations` Building effective agent automations (2026-10-08) — https://claude.dev/blog/building-effective-agent-automations/

## Outline

| section id | role | title | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：機能の途中で、急ぎのバグ修正が来た | 同じフォルダーの2つのセッションは変更がぶつかる。夜間の報告も頼まれている | markdown (3 sentences), quiz predict | `q0` → o1 (ungraded) |
| `parallel` | concept | 1. 並列の3つの方法を選び分ける | 誰がまとめるか・何を分けるかで、サブエージェント／ワークツリー／バックグラウンドを選ぶ | markdown lead (recall 第7回), definitions (ワークツリー, バックグラウンド実行), table (3 methods × who coordinates / fits / caution), markdown (sessions and subagents multiply tokens), quiz inline | `q1` → o1 (evaluate: feature A + bugfix B) |
| `worktree-example` | example | 2. 例題：ワークツリーで2つの作業を並べる | 準備（コミットと信頼）→ 2つのセッション → 環境 → 差分の説明 → 取り込み | markdown lead, code (terminal), steps (5, subgoal + why + expect), callout info (map: agent view = research preview, agent teams = experimental, dynamic workflows = `ultracode`), quiz inline | `q2` → o1 (analyze: missing deps in a worktree) |
| `headless` | concept | 3. 非対話的実行を安全に書く | `-p` は v2.1.302 から Manual で始まる。5つのフラグで、許すもの・読むもの・費用を決める | markdown lead (defines 非対話的実行 at first use; glossary entry), markdown (v2.1.302 + recall 第2回 + docs link), code (lint example), table (5 flags × role / without it), callout pitfall (`"Bash"` too broad), quiz inline | `q3` → o2 (apply: bare `-p` in CI) |
| `unattended` | concept | 4. 無人で回す：置き場所と依頼文の4点 | 置き場所を選び、依頼文は成功条件と失敗の報告、権限と費用は設定で | markdown lead, definitions (無人実行, 定期タスク), table (4 places), markdown + list (the 4 points), markdown (enforcement, recall CLAUDE.md), prompt (weekly TODO example), quiz inline | `q4` → o3 (analyze: failed read reported as quiet day) |
| `practice-command` | practice | 演習1：夜間チェックのコマンドを書く | 失敗したテストを JSON にまとめる `claude -p` を書き、予想してから実行 | markdown task, steps (p-project), prompt (setup), steps (p-command, p-run; hint → troubleshoot), checklist (6), code model answer (labelled by a comment) | — |
| `practice-audit` | practice | 演習2：無人実行の依頼文を点検する | 弱い依頼文を4点で点検して直し、Claude に見落としを聞く | markdown task, markdown quote (weak prompt), steps (p-audit with hint → troubleshoot, p-rewrite), prompt (audit; model answer in expect), checklist (4) | — |
| `check` | check | 理解度チェック | 3つの目標を新しい場面で | quiz exam (6) | `e1` → o1 (research → subagent, transfer), `e2` → o1 (dev server → Ctrl + B), `e3` → o2 (safest CI command), `e4` → o2 (unknown repo → `--bare`, transfer), `e5` → o3 (best weekly prompt), `e6` → o3 (multi: what flags enforce, transfer) |
| `summary` | summary | まとめ | 持ち帰る4点、振り返り、次の一歩 | summary (4), markdown (reflection + next), flashcards (7), askTutor (3) | — |

Contract check: hook ≤ 3 sentences + predict; 4 segments + 2 practice sections, inline quizzes in all 4 segments
(content sections 6, inline 4 ≥ 3, never 3 in a row without); new terms per segment ≤ 3 (parallel 2, example 0 + a
names-only map of 3 preview/experimental features, headless 1, unattended 2); worked example (steps with subgoals and why) before practice; practice with
checklists, hint → troubleshoot ladder and model answers; exam covers o1–o3 with transfer items (e1, e4, e6); summary
4 points + 7 flashcards; comprehension habits: explain the diff (ex-explain), explain the failing test (p-project hint),
predict before running (p-run).

## Assumptions
- Headless run: nobody answered the outline check-in, so the outline above was used as is.
- Prerequisite titles follow the course plan (§7) with the 「第N回｜」 prefix used for this lesson's title:
  第2回｜任せる範囲を決める：権限モードと巻き戻し, 第4回｜検証を任せる：テスト・レビュー・説明,
  第7回｜手順はスキルに、調べものはサブエージェントに. Adjust if the sibling lessons use other titles.
- The practice folder is `cc-practice-09` (new, so it does not clash with folders from earlier lessons).
- `--max-budget-usd 1` in the examples is an example value, not a recommendation; the lesson says to start at 3–5 times
  a normal run (automations post) and does not state prices.
- The 「普段の3〜5倍」 advice comes from the Claude blog post (Managed Agents context); it is presented as Anthropic's advice
  for unattended runs in general, as the facts file does.
