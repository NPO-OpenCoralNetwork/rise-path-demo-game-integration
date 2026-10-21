# Brief: vibe-coding/cc-08-hooks-mcp

第8回｜フックで守らせ、MCPでつなぐ — module 3「プロジェクトに合わせて育てる」, lesson 8 of 11 of the
Claude Code course (plan: `doc/brushup-2026/research/claude-code-curriculum.ja.md` §7). Draft only, previewed in
`vibe-coding` (`courseId: "vibe-coding"`, no `next`); the owner decides where the course is published.

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Codeを使い始めた開発者・学習者（バイブコーディングコース第3章・第5章程度の基礎、または他のAIコーディングツールの経験がある人）。
- すでに知っていること（前提） / prior knowledge: 第2回（権限モード、許可・確認・拒否ルールを `settings.json` に書く）、第6回（CLAUDE.mdは強制ではなく前提を伝えるもの、自動メモリ）、第7回（スキル、サブエージェント）。ターミナルで基本のコマンド（`cd`・`ls`）が使える。`jq`（JSONから値を取り出すコマンド）が入っている（例題の最初に `jq --version` で確かめる）。JSONのファイルを編集できる。
- 前のレッスン / previous lesson: `cc-07-skills-subagents`（手順はスキルに、調べものはサブエージェントに）。次は `cc-09-parallel-automation`（並列で進める・自動で回す）。

## 到達目標 / Outcome (必須)
- o1 (bloom: apply): PreToolUseフックで特定の操作を止める設定を書ける
- o2 (bloom: understand): フックの終了コードによってClaude Codeの動きがどう変わるかを説明できる
- o3 (bloom: evaluate): MCPサーバーやプラグインを入れる前に、出どころ・実行されるもの・権限を確かめ、入れてよいかを判断できる

## 範囲 / Scope
- 扱う / in: フック＝決まったタイミングで必ず動く処理（CLAUDE.mdの「お願い」との対比、第6回の想起）。イベント（`PreToolUse`・`PostToolUse`・`Stop`）→ マッチャー → 処理（ここではコマンド）の3段の設定。標準入力のJSON（`tool_input.command` / `tool_input.file_path`）、標準エラー出力、終了コード 0 / 2 / それ以外（1を含む。ふつうは止めないエラー）。`PostToolUse` の `exit 2` は取り消しではない。`chmod +x`、`/hooks`、手でJSONを渡して試す方法。MCP（`claude mcp add --transport http`、stdio の形、SSEは非推奨、スコープ local / project / user、`.mcp.json` の承認）。プラグインとマーケットプレイス、入れる前の確認（出どころ・作者（保守を含む）・実行内容・外部連携・権限・更新。表の見出しは390 pxで語が割れないよう4文字以内）、プロンプトインジェクション。
- 扱わない（別レッスン） / out: JSON出力による細かい制御（`permissionDecision` など）、`http`・`prompt`・`agent` 型のハンドラーの書き方、`onFailure` の書き方（8-3の注意で「失敗でも止まる例外」として名前だけ出す）、`if` フィルター、Stop フックの品質ゲート（第11回の題材）、モッド（mods）、MCPのOAuth、`managed-mcp.json` などの組織向け管理（第10回）、プラグインの作り方。
- 学習者がよく持つ誤解 / likely misconceptions (report §6 and facts):
  1. 「CLAUDE.mdに『〜するな』と書けば守られる」→ CLAUDE.mdはお願い。強制はフック（と権限ルール）。
  2. 「`exit 1` で止まる」（Unixの習慣）→ フックの `exit 1` はふつう止めないエラー（`onFailure` を `"block"` にしたフックなどは例外）。止めるのは `exit 2`。
  3. 「`exit 0` は許可」→ 反対しないだけで、ふだんの権限確認へ進む。
  4. 「`PostToolUse` の `exit 2` で操作が取り消される」→ 取り消せない。理由がClaudeに届くだけ。
  5. 「フックの条件に書けば何でも止まる」→ 書いた条件の外（`cd x && rm y`、Bashでの `.env` 書き込み）は止まらない。
  6. 「MCPサーバーやプラグインは公式が安全を確認している」→ AnthropicはMCPサーバーを監査していない。プラグインはあなたの権限で任意のコードを実行できる。マーケットプレイスの名前は出し手を示すだけ。

## 形式 / Format
- 所要時間 / minutes: 17（コース共通の measure.mjs：`cc-08-hooks-mcp.lesson.json: prose 1852 (budget 1,200–2,400) · read 2838 · practice reading 1092 · questions 10 · practice sections 1 · est 17.4 min (must be ≤ 20; estMinutes 17)`。(2,838 + 1,092) ÷ 450 ≈ 8.7分 + 問題10問 × 40秒 ≈ 6.7分 + 演習1セクション × 2分 = 2分、計 17.4分 → 17）。
- 難易度 / level: intermediate
- ロケール / locales: jp のみ（英語版は公開先が決まってから）。
- 演習の題材 / practice task idea: 例題と同じ練習用フォルダー（`cc-hooks-practice`）で、`.env` への書き込みを止める `PreToolUse` フック（`Edit|Write`、`tool_input.file_path`、`exit 2`）を作り、手で試す → Claudeに頼んで止まることを確かめ、理由を説明させる。後半は架空の2候補（社内の課題管理MCPサーバー／作者がわかりソースも公開された「全部入り」プラグイン。どちらにも強みと弱みが1つずつある）を8-5の表の項目ごとに書き出して見極め、書き出しの例（A は `practice-b-model`、B は `practice-b-model-b`）と比べる。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20時点）。`jq` が必要（公式ガイドの例と同じ）。
- OS / environment: macOS・Linux（WSLを含む）のbash。Windowsのネイティブ環境は扱わない（`chmod +x` は macOS・Linux 向けと明記）。
- 使ってはいけないもの / avoid: 本物の秘密情報（`.env` はダミー値のみ）、重要なリポジトリでの作業、削除などの破壊的コマンド（`rm notes.txt` はJSONの中の文字列としてだけ使う）、料金、確かめていないコマンドやキー操作。

## 資料 / Sources
All checked 2026-10-20 (facts file `facts-cc-08-hooks-mcp.md` plus the official pages re-read with WebFetch/curl).
- `cc-hooks-guide` — Automate actions with hooks — https://code.claude.com/docs/en/hooks-guide — Anthropic. Used for: event → matcher → handler JSON; the Prettier `PostToolUse` example; the protect-files.sh example (`.env`, `package-lock.json`, `.git/`, `exit 2`, `"$CLAUDE_PROJECT_DIR"`); `chmod +x`; `/hooks`; file watcher / restart; no trailing commas; testing by piping JSON and `echo $?`; stdin fields `tool_name`, `tool_input`; exit 0 is not an approval; a hook's deny holds in every permission mode (PreToolUse fires before permission-mode checks); `Edit|Write` does not see Bash writes; Ctrl+O transcript view.
- `cc-hooks` — Hooks reference — https://code.claude.com/docs/en/hooks. Used for: the `rm*` example (the lesson shortens its message to `Blocked: rm is not allowed` so the line fits 390 px); stderr reaches Claude as the tool's error; exit-code-2 behaviour per event (PostToolUse: "Shows stderr to Claude; the tool already ran"); exit 1 is non-blocking; a hook that cannot start is non-blocking; `${CLAUDE_PROJECT_DIR}` is the project root where the session started.
- `cc-features-overview` — Extend Claude Code — https://code.claude.com/docs/en/features-overview. "An instruction like 'never edit .env' in CLAUDE.md or a skill is a request, not a guarantee."
- `cc-memory` — How Claude remembers your project — https://code.claude.com/docs/en/memory. CLAUDE.md is context, not enforced configuration.
- `steering-post` — Steering Claude Code (2026-06-18) — https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more. "Every time X, do Y" belongs in hooks; "The model choosing to run a formatter is different from the formatter running automatically."
- `cc-mcp` — Connect Claude Code to tools via MCP — https://code.claude.com/docs/en/mcp. `claude mcp add --transport http notion https://mcp.notion.com/mcp`; stdio form with `--`; SSE deprecated; scopes and storage; project-scope approval in interactive sessions; `claude mcp list`, `/mcp`; prompt-injection warning.
- `cc-plugins` — Plugins — https://code.claude.com/docs/en/plugins/overview. Plugins bundle skills, agents, hooks, MCP servers.
- `cc-plugins-install` — Install and manage plugins — https://code.claude.com/docs/en/plugins/install. `/plugin`, `/plugin install <plugin>@<marketplace>`.
- `cc-plugin-security` — Plugin security and trust — https://code.claude.com/docs/en/plugins/security. "can execute arbitrary code on your machine with your user privileges"; the review steps (marketplace source, details pane, `hooks/hooks.json`, `.mcp.json`, `bin/`); hooks and MCP servers run outside the sandbox and permission rules; auto-update changes reviewed files; a marketplace name tells who publishes the catalog, not what a plugin does.
- `cc-security` — Security — https://code.claude.com/docs/en/security. Anthropic "does not security-audit or manage any MCP server"; trusted providers; permissions for MCP tools.
- `cc-changelog` — Claude Code CHANGELOG — https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md. Version line (v2.1.304).
- Japanese mirrors linked for learners: https://code.claude.com/docs/ja/hooks-guide (checked: 200).

Code checked by running it (bash 5, jq 1.x, Linux): `s2-setup`, `block-rm.sh` with `rm notes.txt` (prints the reason, exit 2) and `ls` (exit 0); `protect-files.sh` with `.env` (exit 2) and `README.md` (exit 0); all three JSON samples parse. Without `jq` on PATH, `protect-files.sh` prints `jq: command not found` and exits 0 (nothing is blocked), which is why the steps' troubleshoot says so.
Re-run after the round-1 fixes (bash 5, jq 1.7, Linux): the new `s2-setup` (`jq --version` first) and the new `s2-test`
(`chmod +x`, then the test: reason + `2`); without `chmod +x` the test prints `Permission denied` and `echo $?` gives 126;
q2 commands: `rm notes.txt && ls` → 2, `rm -r build` → 2, `cd docs && rm notes.txt` → 0, `rmdir old` → 2.
Re-run after the mobile-fit changes (bash 5, jq 1.7, Linux): `s2-setup` with one command per line, the `s2-test` command
over 3 lines (`rm notes.txt` → reason + `2`, `ls` → `0`), and the same 3-line form with `{"file_path":".env"}` →
`Blocked: .env matches protected pattern '.env'` + `2`, `README.md` → `0` (the p-predict hint).
Re-run after the round-3 mobile changes (bash 5, jq 1.7, Linux; every code block extracted from the lesson JSON):
`s2-setup` as written; `s2-test` as written (`chmod +x`, then the 3-line test with the JSON split after `"tool_input":`)
→ `Blocked: rm is not allowed` + `2`, with `ls` → `0`; q2 commands → 2 / 2 / 0 / 2 as before; the p-predict hint
(`{"file_path":".env"}` piped to `.claude/hooks/protect-files.sh`) → `Permission denied` + `126` before `chmod +x`, then
`Blocked: .env matches protected pattern '.env'` + `2`, `README.md` → `0`; `.git/config` and `package-lock.json` → `2`; the
old hint (piping to `block-rm.sh`) → `0`, which was the pedagogy must-fix; without `jq` → `jq: command not found` + `0`;
the three JSON blocks parse with `jq`.

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：「.envは編集しないで」が守られない | CLAUDE.mdの「〜しないで」は守られる保証がない | markdown (problem, 2 sentences + version line), quiz predict | `q0` → o1 (understand, ungraded) |
| `s1` | concept | 8-1. フック：お願いではなく、必ず動く仕組み | フックはClaudeの判断と関係なく決まったタイミングで必ず動く；設定は イベント → マッチャー → 処理（ここではコマンド） | markdown lead (第6回の想起; 毎回守らせることは第2回の権限ルールやフックに任せる), definitions (フック・イベント・マッチャー), diagram (lifecycle, 6 nodes, labels split at word boundaries for 390 px; edge 「通す（権限の確認へ）」; the edge into the PreToolUse diamond has no label, so 「止める」 is the only label between the two nodes — visual QA round 3), markdown (also states the hook command in text and that the hook gets JSON), code (Prettier `PostToolUse`), quiz inline | `q1` → o1 (apply: 編集のたびにテスト → `PostToolUse`) |
| `s2` | example | 8-2. 例題：rmで始まるコマンドを止める | `PreToolUse` フックの作り方：スクリプト → 許可と登録 → 予想してから手で試す | markdown lead, definitions (標準入力・標準エラー出力・終了コード), code (setup: `jq --version` で確かめてから作る、1行に1コマンド、comments ≤ 12 JP chars), code (`block-rm.sh`, the `jq` line split after the pipe), code (`settings.json`), steps (3, subgoal titles + why + expect + troubleshoot, `Permission denied` → `chmod +x`; ex-script names the save path, ex-register writes the full hook command, ex-test says the ③ lines are one command), code (② `chmod +x` + ③ test, the test command over 3 short lines), quiz inline | `q2` → o1 (analyze: 条件の外 `cd docs && rm` は止まらない。`rm notes.txt && ls` は止まる) |
| `s3` | concept | 8-3. 終了コードで、Claude Codeの動きが変わる | 0 は進む（許可ではない）、2 は止めて理由が届く、1 などは止めないエラー；`PostToolUse` の 2 は取り消しではない | markdown lead, table (3 rows, 2 columns: 終了コード／結果), markdown, callout pitfall (exit 1, 3 sentences), markdown, quiz inline | `q3` → o2 (understand: `onFailure` なしの `exit 1` の `.env` ガード) |
| `s4` | concept | 8-4. MCPで外のツールにつなぐ | MCPで外部ツールをつなぎ、スコープで使える範囲を決める | markdown lead (MCP の定義を含む), definitions (MCP サーバー・スコープ), code (`claude mcp add` / `list`, the notion line split with `\`, short comments), markdown (http 推奨・SSE 非推奨; the stdio form `--` moved here from a code comment), table (scopes, 2 columns: スコープ／使える範囲; the first column is the scope name only) | — (density: s3 and s5 have checks) |
| `s5` | concept | 8-5. プラグインは、入れる前に確かめる | プラグインもMCPサーバーもあなたの権限で動く；入れる前の6項目 | markdown lead (第7回の想起), definitions (プラグイン・マーケットプレイス・プロンプトインジェクション), markdown (risk), table (6 checks labelled 出どころ・作者・実行内容・外部連携・権限・更新; 権限の行に「フックは対象外」), callout pitfall (公式の場所＝安全ではない), quiz inline | `q4` → o3 (evaluate: 何が実行されるかを最優先) |
| `practice` | practice | 演習：.envを守るフックを作り、つなぐ候補を見極める | 例題を `.env` 用に作り変え（マッチャーと取り出す項目）、予想 → 手で試す → Claudeで確かめ説明させる；2候補を見極める | markdown (task), steps (3, hints + troubleshoot), prompt (claude-code, `{{追加する行}}`, expect, note), markdown (also writes the full protect-files command) + code ×2 (model answer: protect-files.sh wrapped to ≤ 44 columns, combined settings.json), markdown, quiz inline (2 candidates), table ×2 (`practice-b-model` for A, `practice-b-model-b` for B: model of the written-out table, 2 columns each), checklist (5) | `q9` → o3 (evaluate: 架空の2候補。どちらも出どころと作者はわかる。Aの弱み（社外の文章を読み、閉じるツールがある）は権限ルールで外せ、Bの弱み（フックが毎回外から取ってきたスクリプトを実行）は前もって確かめられず権限ルールでも絞れない → Aは読むツールだけ許して試し、Bは入れない。誤答は A を全部許す／A も入れない／B も入れる) |
| `check` | check | 理解度チェック | 全目標の確認、転移問題を含む | quiz exam (4) | `q5` → o1 (apply, transfer: `config/production.yml`), `q6` → o2 (transfer: lint の `PostToolUse` + `exit 2`), `q7` → o2 (CLAUDE.md とフック、autoモード), `q8` → o3 (evaluate, transfer: Webページ要約のMCPサーバー。誤答はどれも「一部だけ確かめる」) |
| `summary` | summary | まとめ | 持ち帰る4点、振り返りの問い、次の一歩 | summary (4), markdown (reflection + next + official docs link), flashcards (7), askTutor (3) | — |

Contract check: hook problem in 2 sentences + predict; 5 segments (s1–s5), inline checks in s1, s2, s3, s5 (never
3 content sections in a row without one); new terms per segment s1: フック・イベント・マッチャー / s2: 標準入力・
標準エラー出力・終了コード / s4: MCP（lead）・MCPサーバー・スコープ / s5: プラグイン・マーケットプレイス・プロンプト
インジェクション; worked example (s2, 3 steps with subgoals, why and expect) → faded practice (same structure,
different matcher and field, hint ladder: step hints → troubleshoot → model answer) → exam; every objective has
inline and exam questions (o1: q0, q1, q2, q5; o2: q3, q6, q7; o3: q4, q9, q8); summary 4 points; 7 flashcards;
one diagram (6 nodes), no images. Body: prose 1,705 by the course-wide measure.mjs (budget 1,200–2,400; see Format).
Mobile fit (390 px): every table has 2 columns (cells ≤ 40 JP chars) and a first column of ≤ 4 JP characters or one
short inline code; diagram-width.mjs measures the diagram at 344 px (limit 362); code-width.mjs leaves only the four JSON
`command` strings over 44 columns (see Assumptions); para-sentences.mjs reports only the q9 stem (advisory).
Correct answers sit at positions 1/2/3/4 = 2/3/3/2 across q0–q9.

## Assumptions
- Headless run: nobody answered the outline check-in, so the outline above was used as is.
- Prerequisite titles match the titles of the other cc-* drafts as written on 2026-10-20
  (`第2回｜任せる範囲を決める：権限モードと巻き戻し`, `第6回｜CLAUDE.mdで前提を伝える`,
  `第7回｜手順はスキルに、調べものはサブエージェントに`).
- The worked example creates its own folder `cc-hooks-practice` instead of reusing an earlier lesson's practice folder,
  so `mkdir` never fails on an existing folder and nothing touches a real repository.
- The practice prompt asks Claude not to try another route after the block, because an `Edit|Write` hook does not see
  writes made through Bash (stated in the prompt's note and in q2's explanation).
- Spacing (style guide §3, round-1 fix): no space between Japanese and alphanumerics (「MCPサーバー」「autoモード」
  「PreToolUseフック」), except around inline code. Plain-text fields (prerequisites, captions, checklist labels, askTutor)
  carry no code font, so command and file names there have no space either (「cat .envで」「/hooksのPreToolUseに」
  「--scopeで選ぶ」; ja-editor round 2).
- Length follows the course-wide measure.mjs (prose 1,705, est 16.9 → 17 minutes), which replaced the earlier
  per-lesson character count.
- Mobile fit (round 3): every code line is ≤ 44 columns except the four JSON `command` strings (s1-prettier line 9,
  s2-settings line 9, practice-model-settings lines 9 and 18). A JSON string cannot be wrapped, and the path string alone
  (`"\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-rm.sh"`, 51 columns) is wider than the code box, so the layout stays as in
  the hooks guide (cc-11 keeps its Prettier line the same way). The full commands are written in prose instead: the
  Prettier command in s1-config, the block-rm command in ex-register, the protect-files command in practice-model-intro.
  The scripts are wrapped: the `jq` lines break after the pipe, `PROTECTED_PATTERNS` is a multi-line array, the loop
  variable is `pat` (the guide's `pattern` made two lines 45 columns wide), the protect-files message is passed to `echo`
  as two arguments (same output as the guide), and block-rm.sh prints the shorter `Blocked: rm is not allowed`.
  Comments in code are ≤ 12 JP characters; what they used to say is in the step text (ex-test, s4-transport).
- Table labels (visual QA round 3): s5-checks, practice-b-model and practice-b-model-b use 出どころ・作者・実行内容・
  外部連携・権限・更新 (≤ 4 characters, so 390 px does not split 「実行されるもの」 or 「外とのやり取り」); card-before-install
  lists the same six words. The objective o3 keeps its wording (「実行されるもの」).
- q9 (pedagogy round 2): both candidates have one strength and one gap, so rejecting B alone no longer finds the
  answer. B's author and source are known; its gap (a hook that runs a script fetched from outside on every edit)
  rests on the plugin security page (plugin hooks run outside permission rules; review the files before installing);
  a script fetched at run time is not among the files that can be reviewed. The auto-update distractor was replaced by 「Bは作者とソースがわかるので入れる」.
- Round-3 nice-to-haves applied: q0's explanation and s1-lead name 第2回's permission (deny) rules as another mechanism that
  enforces a rule; s3-zero says `exit 0` is not an approval (misconception 3); s5-risk and q4's explanation say
  「あなたのPCのユーザー権限」 (plugin security page: "with your user privileges"); q8 d's feedback names the origin and the
  author; p-script has a troubleshoot; 「権限の確認」 is used everywhere (s3-table, q3 d).
- q8 option c does not say what the `project`-scope approval prompt shows: the MCP page (checked 2026-10-20) says only
  that Claude Code prompts for approval in interactive sessions.
- Fact audit (2026-10-20, second fix round): the hooks reference says `exit 1` is non-blocking "unless the hook is one
  whose failure blocks the action" (for example `"onFailure": "block"`). The lesson therefore says 「ふつう」 wherever it
  states that `exit 1` does not block (s3-table, s3-pitfall, q3 feedback/explanation, q5 feedback, card-exit1, summary),
  names `onFailure` once in s3-pitfall as the exception, and q3's prompt states that `onFailure` is not set.
- `/hooks` lists hooks grouped by event and shows the command when a hook is selected; no page says the list shows the
  matcher, so the practice expect and checklist only ask the learner to find the new hook under `PreToolUse`.
