# Brief: vibe-coding/cc-07-skills-subagents

<!-- Claude Code course (cc-*), lesson 7 of 11. Drafted in vibe-coding/drafts for preview; the owner decides where it is published. -->

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を数週間使い、CLAUDE.md を書いたことがある開発者・学習者（コース「Claude Code 実践」モジュール3「プロジェクトに合わせて育てる」）。
- すでに知っていること（前提） / prior knowledge: 第5回（コンテキストウィンドウ、`/context`、`/clear`、埋まるほど性能が落ちること）、第6回（CLAUDE.md は毎回全文が読み込まれる「プロジェクトの指示」、200行以内）。ターミナルで `cd`・`ls`、Git の commit の意味、エディターでファイルを作って保存できる。
- 前のレッスン / previous lesson: 第6回｜CLAUDE.mdで前提を伝える（次は 第8回｜フックで守らせ、MCPでつなぐ）。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: create): 繰り返す手順をSKILL.mdにまとめられる
- o2 (bloom: evaluate): スキル・サブエージェント・CLAUDE.mdの使い分けを判断できる
- o3 (bloom: understand): サブエージェントを使うとコンテキストが節約できる理由を説明できる

## 範囲 / Scope
- 扱う / in:
  - スキル：`.claude/skills/<名前>/SKILL.md`（YAML フロントマター＋本文）、`description` が要、`name` を省くとフォルダ名。
  - 段階的な読み込み（progressive disclosure）：名前と説明文だけが毎回、本文は使うとき。だから手順は CLAUDE.md ではなくスキルへ。
  - 呼び出し方：`/名前` か、依頼が description に合うと Claude が使う。`disable-model-invocation: true` で自分だけが呼ぶスキル（説明文もコンテキストに入らない）。
  - 古い記事向け：カスタムコマンドはスキルに統合、`.claude/commands/` も動く。
  - サブエージェント：`.claude/agents/` の Markdown（`name`・`description` 必須、`tools` でしぼる）、自分のコンテキストウィンドウ・指示・ツール・権限、要約だけを返す。v2.1.198 から既定でバックグラウンド（`/tasks` は演習のヒントだけ）。
  - フォーク：`/subtask <task>` で会話をまるごと引き継ぐ。ふつうのサブエージェントはまっさらから始まる。
  - 公式の「少しずつ育てる」：きっかけ（trigger）が来たら1つずつ足す。メインの会話のほうが向く場面。
- 扱わない（別レッスン） / out: フック・MCP・プラグインの中身（第8回へ1行の予告だけ）、`context: fork`・`allowed-tools`・動的コンテキスト注入・`$ARGUMENTS`（中級の先）、動的ワークフロー・並列（第9回）、コスト（第10回）。
- 学習者がよく持つ誤解 / likely misconceptions:
  1. 拡張機能は最初に全部入れる（report §6：レッスン7）→ きっかけが来たら足す。
  2. スキルも CLAUDE.md のように毎回全文が読み込まれる → 名前と説明文だけ。
  3. 長い手順でも CLAUDE.md に書けばよい → 毎回コンテキストを使い続ける。
  4. サブエージェントの作業はすべてメインの会話に戻る／何も戻らない → 依頼文と要約だけが入る。
  5. サブエージェントは会話を覚えている → ふつうはまっさらから。会話を引き継ぐのはフォーク（`/subtask`）。
  6. 説明文に「勝手に使わないで」と書けば止まる → `disable-model-invocation: true`。
  7. 使われないスキルは本文を詳しくすれば使われる → 判断に使われるのは description。

## 形式 / Format
- 所要時間 / minutes: 18（コース共通の measure.mjs：`prose 1975 (budget 1,200–2,400) · read 2613 · practice reading 931 · questions 12 · practice sections 1 · est 17.9 min (must be ≤ 20; estMinutes 18)`。(2,613 + 931) ÷ 450 ＝ 7.9分、問題12問（予想1問を含む）× 40秒 ＝ 8.0分、演習1セクション × 2分 ＝ 2分、計 17.9分 → 18）
- 難易度 / level: intermediate
- ロケール / locales: jp のみ（英語は公開先が決まってから）
- 演習の題材 / practice task idea: 自分が繰り返している手順（なければ「README の更新手順」）を `.claude/skills/<名前>/SKILL.md` にし、自然な依頼と `/名前` の2通りで試す（使われるかを先に予想）。続けて、サブエージェントに調べものを任せ、`/context` の前後でメインのコンテキストの増え方を比べ、理由を自分の言葉で説明する。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20 時点）。バックグラウンド既定は v2.1.198 から。
- OS / environment: macOS / Linux / WSL のターミナル。練習用フォルダ（例：`cc-practice`、`git init` 済み）で作業する。
- 使ってはいけないもの / avoid: 大事なリポジトリでの演習、破壊的なコマンド、秘密情報。価格の記載。プレビュー機能を必須手順にしない。
- SKILL.md とサブエージェントのファイルは、公式ドキュメント（skills ページ）と同じく `code` ブロック `lang: "yaml"` で示す。filename はスマートフォンで切れない30桁以内にし、SKILL.md はパスの末尾（`commit-message/SKILL.md`・`update-readme/SKILL.md`）、フルパス `.claude/skills/<名前>/SKILL.md` は定義・ターミナルのコマンド・手順の本文で示す（ファイルとして保存するもので、AI に貼る依頼文ではないため。`lang: markdown` は lint `code-should-be-prompt` に当たる）。AI への依頼文は `prompt` ブロック。

## 資料 / Sources
- cc-skills — Extend Claude with skills — https://code.claude.com/docs/en/skills（日本語版 https://code.claude.com/docs/ja/skills）
- cc-sub-agents — Create custom subagents — https://code.claude.com/docs/en/sub-agents
- cc-features-overview — Extend Claude Code（Build your setup over time、Context cost by feature） — https://code.claude.com/docs/en/features-overview
- cc-commands — Commands（`/context`、`/subtask`、`/tasks`、`/reload-skills`、`/agents`） — https://code.claude.com/docs/en/commands
- cc-best-practices — Best practices for Claude Code（Use subagents for investigation） — https://code.claude.com/docs/en/best-practices
- cc-whats-new-w27 — Week 27 · June 29 – July 3, 2026 — https://code.claude.com/docs/en/whats-new/2026-w27
- cc-changelog — Claude Code CHANGELOG（2.1.198） — https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- agent-skills-post — Equipping agents for the real world with Agent Skills — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

## Assumptions
- 練習用フォルダは第1回から使っている `cc-practice`（コミットが1つ以上ある）。ない場合は `mkdir cc-practice`、`cd cc-practice`、`git init` を1つずつ実行して作り、ファイルを1つ作って最初のコミットをしてからスキルのフォルダを作る、と①（ex-folder）の troubleshoot に書く（コミットがないと `git diff HEAD` が失敗するため）。
- スキルのフォルダは Claude Code を起動する前に作る（起動後に新しく作った `.claude/skills/` は `/reload-skills` するまで読み込まれないため。①に理由も書く）。`/名前` で呼べないときの対処として `/reload-skills` を示す。`/subtask`・`/tasks`・`/reload-skills` は公式の Commands ページに載っていることを確認済み（2026-10-20）。
- `disable-model-invocation: true` を付ける基準は公式どおり「取り消しにくい（副作用のある）手順か、動かす時期を自分で決めたい手順」。7-2・演習③・模範解答で同じ基準を使う。
- `/context` の表示（色分けされたグリッド）の細部は版で変わるので、数字や項目名は固定しない。
- 例の SKILL.md は公式の summarize-changes の例を日本語の手順にしたもの（`!` による動的コンテキスト注入は扱わず、本文で `git diff HEAD` を確かめる手順にした）。
- スマートフォン（390px、本文の幅358px）で横にはみ出さないよう、表は2列で1列目を短く、図は `flowchart TD` で横並び2つまで・ラベルは1行12字以内で語の切れ目で改行（自然な幅362px以内）、コードの行は44桁以内（全角22字）・filename は30桁以内にする。7-4の表は1列目を「足すもの」、2列目を「きっかけ（読み込まれ方）」にした。図1は「いいえ」の分岐を図の説明（alt）に移して横幅を2列に収め、ラベルの動詞を「読む」にそろえた。SKILL.md と researcher.md の `description` は YAML の `>-`（折りたたみ）で短い行に分け、番号つきの手順は字下げした続きの行に分ける。`>-` の書き方は②（ex-description）で1文説明する。

## Outline

| section id | role | title | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| hook | hook | はじめに：毎回貼っている手順書 | 手順を毎回貼る／CLAUDE.md に足す／調べもので会話があふれる、という問題 | markdown (lead), quiz predict | hook-q (predict, ungraded) → o2 |
| skill-basics | concept | 7-1. スキル：手順は使うときだけ読み込む | スキルは名前と説明文だけが毎回、本文は使うとき（段階的な読み込み）。だから手順はスキルへ | markdown, definitions（スキル・フロントマター・段階的な読み込み）, diagram, markdown, quiz inline | q1 → o2 (understand) |
| skill-example | example | 7-2. 例題：コミットメッセージの手順をスキルにする | 置き場所 → description → 本文 → 2通りで試す（worked example）。取り消しにくい手順・動かす時期を決めたい手順には `disable-model-invocation`。旧カスタムコマンド | markdown, code bash, code yaml (SKILL.md), steps ×5, markdown, callout info, quiz inline | q2 → o1 (apply), q3 → o1 (apply) |
| subagents | concept | 7-3. サブエージェント：調べものを別のコンテキストで | 自分のコンテキストで読み、要約だけを返す。フォークは会話を引き継ぐ。バックグラウンド既定、`.claude/agents/` | markdown, definitions（サブエージェント・フォーク）, diagram, markdown ×3, code yaml (agent), quiz inline | q4 → o3 (understand), q5 → o2 (apply) |
| choose | concept | 7-4. どこに置く？ 足すのは「きっかけ」が来てから | 公式の「少しずつ育てる」：きっかけ → 足すもの。メインの会話のほうが向く場面 | markdown, table（2列：足すもの／きっかけ（読み込まれ方））, markdown, callout pitfall, quiz inline | q6 → o2 (evaluate) |
| practice | practice | 演習：自分の手順をスキルにし、調べものを任せる | 自分の手順をスキルにして2通りで試し、サブエージェントの前後で `/context` を比べる | markdown, code bash, steps ×7 (hint/troubleshoot), prompt (claude-code), checklist, markdown, code yaml (模範解答) | — |
| check | check | 確認テスト | 全目標の総まとめ（転移2問） | quiz exam ×5 | e1 → o1 (apply, transfer: チーム共有), e2 → o1 (analyze), e3 → o2 (evaluate, transfer: ライブラリ入れ替え前の洗い出し), e5 → o3 (understand), e6 → o3 (analyze) |
| summary | summary | まとめ | 要点4つ、振り返りと次回（第8回）、復習カード6枚、AI先生 | summary, markdown, flashcards, askTutor | — |

### After publishing (2026-10-21)
- After publishing, a full pedagogy review found q6 answerable by matching words: its four options now describe situations without the s4 list wording (answer, ids and feedback unchanged).
- q6 option endings unified to 「〜ている」 (ja-editor).
