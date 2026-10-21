# Brief: vibe-coding/cc-03-plan-first

「第3回｜探索→計画→実装→コミット」。Claude Code コース（cc-*）モジュール 2「頼み方と進め方」の 1 本目、全 11 回中の第 3 回。
下書きはプレビューのため `vibe-coding` コースに置く（公開先はオーナーが決める。`next` なし）。

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を使い始めた人。バイブコーディングコース第3章（VS Code）・第5章（GitHub）程度の基礎がある人、または他の AI コーディングツールの経験者。
- すでに知っていること（前提） / prior knowledge: 第1回で質問 → 小さな変更 → 差分確認 → コミットを 1 回通した。第2回で権限モード（Manual・`acceptEdits`・プランモード・auto）と `/rewind` を学び、プランモードが「調べて計画するだけのモード」だと知っている。ターミナルで `cd`・`ls` が使え、Git の commit の意味がわかる。
- 前のレッスン / previous lesson: 第2回｜任せる範囲を決める：権限モードと巻き戻し。次は第4回｜検証を任せる：テスト・レビュー・説明。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: apply): あいまいな依頼を、範囲・参照先・既存のパターン・症状の4つの観点で具体的に書き直せる
- o2 (bloom: evaluate): プランモードを使うべき場面と省いてよい場面を判断し、承認する前に計画を直せる
- o3 (bloom: create): 大きめの機能のために、仕様をインタビューしてもらう依頼文を作れる

## 範囲 / Scope
- 扱う / in:
  - 公式の 4 つのフェーズ（探索 → 計画 → 実装 → コミット）。探索と計画はプランモードで、承認してから実装する。
  - プランモードに入る主な 3 つの方法（Shift+Tab で `⏸ plan mode on` まで、`/plan`、`claude --permission-mode plan`）、承認の選択肢、計画の直し方（「No, keep planning」、Ctrl+G）。
  - 依頼を具体的にする 4 つの観点（範囲・参照先・既存のパターン・症状）と、材料の渡し方（`@` 参照、画像の貼り付け、URL）。探索中はあいまいな質問も役に立つこと。
  - 計画を省いてよい場面（差分を 1 文で言える変更）と、計画が最も役立つ場面（進め方が不確か・複数ファイル・不慣れなコード）。
  - 大きめの機能：AskUserQuestion でインタビュー → `SPEC.md` → 新しいセッションで実装。役に立つ仕様の 3 条件。
  - コミュニティの仕様駆動ツール（cc-sdd）は 1 回だけ名前を出す（必須にしない）。
  - 実装のあとに差分を説明させ、予想してから確かめる習慣（学習科学、report §6）。
- 扱わない（別レッスン） / out: テストや `/code-review` による検証の設計（第4回）、`/clear`・`/compact` とコンテキスト圧縮（第5回）、CLAUDE.md（第6回）、サブエージェント（第7回）、`defaultMode` 設定やフック（第8回）、PR 作成（練習用フォルダーにリモートがないため扱わない）。
- 学習者がよく持つ誤解 / likely misconceptions:
  - 形容詞を強めれば（「すごくおしゃれに」）伝わる。→ 範囲・症状などの情報が要る。
  - Manual モードで編集を 1 つずつ承認すれば計画はいらない。→ 方向の違いに気づくのが書き換えの後になる。
  - `/rewind` で戻せるから計画はいらない。→ Bash や外部への変更は戻らない。同じ依頼からやり直すだけ（report §6、第2回）。
  - auto モードの分類器が意図と違う変更も止める。→ 止めるのは危険に見える操作だけ（report §6）。
  - Claude が立てた計画・仕様はそのまま承認してよい。→ 推測が混ざる。承認前に読んで直す（trust-then-verify gap）。
  - 小さな変更も念のため毎回計画する。→ 計画には手間がかかる。差分を 1 文で言えるなら省く。
  - プランモードの段階でファイルがもう変わっている。→ 承認までソースは編集されない。
  - 仕様のインタビューをした同じ会話で実装すればよい／前回の会話を Claude が覚えている。→ 新しいセッションで `SPEC.md` を読ませる。

## 形式 / Format
- 所要時間 / minutes: 19（コース共通の measure.mjs：`cc-03-plan-first.lesson.json: prose 2295 (budget 1,200–2,400) · read 2961 · practice reading 1442 · questions 8 · practice sections 2 · est 19.1 min (must be ≤ 20; estMinutes 19)`。(3,065 + 1,452) ÷ 450 ≒ 10.04 分 + 問題 8 問（predict 1、inline 4、exam 3）× 40 秒 ≒ 5.33 分 + 演習 2 セクション × 2 分 = 4 分 → 19.37 分）。
- 難易度 / level: beginner
- ロケール / locales: jp のみ（英語版は公開先が決まってから）
- 演習の題材 / practice task idea: 新しい練習用フォルダーに 25 行の `todo.html` を作る（空の入力で空の行が増える）。「TODO アプリをいい感じにして」を 4 つの観点で書き直し、プランモードで探索 → 計画 → 1 か所直す → 承認 → 実装 → 差分の説明 → コミット。演習2で「期限とリマインダー」のインタビュー依頼文を書く。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20 時点）。v2.1.283 以降、ターミナルと VS Code の対話セッションは、起動時の指定（`--permission-mode`）や設定（`permissions.defaultMode`）がなければ auto モードで始まり、auto モードが使えない環境では Manual で始まる。auto モードから Shift+Tab で Manual → acceptEdits → プランモードの順に変わる。
- OS / environment: macOS・Linux・Windows（WSL 含む）。画像の貼り付けは Ctrl+V（Windows と WSL は Alt+V）。ブラウザでローカルの HTML を開ける。
- 使ってはいけないもの / avoid: 大事なリポジトリでの演習、破壊的なコマンド、秘密情報、料金の記載、プレビュー機能を必須の手順にすること。

## 資料 / Sources
- cc-best-practices — Best practices for Claude Code（Explore first, then plan, then code / Provide specific context / Provide rich content / Let Claude interview you）https://code.claude.com/docs/en/best-practices
- cc-permission-modes — Permission modes（plan mode、承認の選択肢、Ctrl+G、Shift+Tab のモードの順）https://code.claude.com/docs/en/permission-modes
- cc-commands — Commands（`/plan [description]`）https://code.claude.com/docs/en/commands
- cc-common-workflows — Common workflows（画像の貼り付け、`@` 参照）https://code.claude.com/docs/en/common-workflows
- cc-tools-reference — Tools reference（AskUserQuestion は選択肢つきの質問をするツール）https://code.claude.com/docs/en/tools-reference
- cc-changelog — Claude Code CHANGELOG（v2.1.304 時点）https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- ai-skills-rct — How AI assistance impacts the formation of coding skills（2026-01-29）https://www.anthropic.com/research/AI-assistance-coding-skills
- cc-sdd — gotalab/cc-sdd（コミュニティ）https://github.com/gotalab/cc-sdd
- 事実ファイル（検証済み 2026-10-20）：practice-4, practice-5, practice-7, practice-8, learning-23, learning-24, docs-13, learning-33。Best practices・Permission modes・Commands・Common workflows・Tools reference は 2026-10-20 に WebFetch で本文を確認。

## Assumptions
- 第1回・第2回・第4回のタイトルは、コース共通の正式タイトル「第1回｜最初のタスクを任せる」「第2回｜任せる範囲を決める：権限モードと巻き戻し」「第4回｜検証を任せる：テスト・レビュー・説明」を使う。
- 例題（3-3）のログイン画面のプロジェクト（`src/pages/Login.tsx`・`src/pages/Signup.tsx`）は架空で、読むだけの例。手を動かすのは演習の `todo.html`。
- 演習の `todo.html` は Chromium（headless）で動作を確認した（空の入力で空の `li` が増える）。
- 新しいセッションの始め方は「`/clear` で会話を空にするか、`claude` を起動し直す」とした（公式は "start a fresh session"）。
- 承認の選択肢の英語表記（「Yes, manually approve edits」「No, keep planning」）は 2026-10-20 の公式ページ（v2.1.304）のまま。レッスンでは s2-enter-lead で版（v2.1.304 時点）を示し、表示が変わりうる旨の注記は所要時間の上限のため入れていない。
- 所要時間はコース共通の measure.mjs で数える（演習は 1 セクション 2 分）。20 分以内にするため、exam の e3（o2）と e6（o3）を削除した。o2 は q2・q3・e4、o3 は q4・e5 で評価する（どの目標も inline と exam に 1 問以上）。
- 390px の画面に収めるため、表は使わない。s1-table と s4-table は、1 列目が 5 字を超えて語の途中で折り返す（visual QA：s4-table の「よく知らないコー／ド」「新しいセッショ／ン」）ので、どちらも全文の箇条書き（list、id はそのまま）にした。s1-table は「**観点**には、〜を書きます。」の 4 項目で、公式ガイドの書き直し例（foo.py・ExecutionFactory・ウィジェット・src/auth/）は本文の予算（prose ≤ 2,400）のため外した。書き直しの例は s1-example が担う。s4-table は「差分を1文で説明できる→直接頼む／迷う・複数のファイル・よく知らないコード→計画／大きめの機能→インタビューと仕様」の 3 項目。q1・e1・e4 が頼る内容（症状＝起きていること・場所の見当・直った状態、既存のパターン＝まねしてほしい既存のコード、計画が役立つ場面）は残した。図は `flowchart TD`（自然幅 199px）。コードは 1 行 44 桁以内・1 行 1 コマンド。
- list にした分の本文を払うため、s1-lead の 2 文目、s4-lead の「仕様を書いてから実装する」（s4-flow と重複）を削り、s2-enter の 3 つ目を「`claude --permission-mode plan` で起動する」、まとめの 3 点目と 5 点目を短くした。
- 演習の `todo.html` は、390px で折り返さないよう、`getElementById` の 3 か所を 2 行に分け、`addButton` を `addBtn` にした。visual QA（390px で 5・15・21 行目が切れる）を受けて、さらに空行を削り、`createElement` を 2 行に分け、クリックの処理を `addBtn.onclick = () => {…};` にし、入力欄を `<input id="item">`（placeholder なし。`new-item` だと 10 行目が 390px で折り返すため）にした。全行 36 桁以内、25 行、addItem は 13–18 行目（highlight も 13–18）。ブラウザチェック（code-wrap）で折り返しなしを確認し、動作は Chromium（headless）で再確認した（空の入力で空の `li` が増える）。演習の bash ブロックの長いコメントは「# ここでtodo.htmlを保存」に縮め、手順の説明（最初の 3 行 → 保存 → 最後の 2 行）は pr-setup に移した。
- autoモードで始まる条件は、コース共通の事実（cross-lesson facts 1）に合わせて「ターミナルとVS Codeで対話するとき」と書いた（対話セッションのみ）。
- 例題の手順は契約の 3–6 手順に合わせて 6 手順にした（ex-enter を ex-explore に統合。ex-enter の id はなくなった）。各手順に理由を添えた（ex-plan・ex-commit に追加）。
- プロンプト中の `@ファイル名` の後ろには半角スペースを置く（Claude Code がパスの終わりをスペースで判断するため）。それ以外は日本語と英数字のあいだにスペースを入れない。

## Outline

| section id | role | title | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| hook | hook | はじめに：「いい感じにして」の行き先 | あいまいな依頼だと、Claude が推測で範囲を決めて書き換えが広がる | markdown, quiz(predict) | q0 → o2（採点なし） |
| s1 | concept | 3-1. 依頼を4つの観点で具体的にする | 範囲・参照先・既存のパターン・症状で書き直し、材料は @参照・画像・URL で渡す | markdown, definitions, list(4、観点ごとに書くこと), markdown, prompt（書き直しの例）, quiz(inline) | q1 → o1 |
| s2 | concept | 3-2. 探索→計画→実装→コミット | 調べて計画する段階（プランモード）と実装を分ける。差分を1文で言えるなら計画は省く | markdown, definitions, diagram, markdown, list, callout(info), markdown, quiz(inline) | q2 → o2 |
| s3 | example | 3-3. 例題：ログイン画面を4つのフェーズで直す | 計画を読んで範囲外の変更を直してから承認し、差分を説明させてコミットする（計画の例を示す） | markdown, steps(6), prompt（計画を直す依頼）, callout(tip), quiz(inline) | q3 → o2（承認の前に計画を直す） |
| s4 | concept | 3-4. 大きめの機能は仕様から始める | インタビュー → SPEC.md → 新しいセッション。準備の度合いを変更の大きさで選ぶ | markdown, definitions, markdown, prompt（インタビュー）, markdown, list(3、変更の大きさと進め方), callout(note), quiz(inline) | q4 → o3 |
| practice | practice | 演習1：TODO画面を4つのフェーズで直す | 自分で書き直し → プランモード → 計画を1か所直す → 実装 → 説明 → コミット | markdown, code(bash), code(html), steps(7, hint/troubleshoot), checklist, prompt（模範解答、書いてから見比べる） | — |
| practice-spec | practice | 演習2：仕様インタビューの依頼文を作る | 期限とリマインダーのためのインタビュー依頼文を書く | markdown, steps(3, hint/troubleshoot), checklist, prompt（模範解答、書いてから見比べる） | — |
| check | check | 理解度チェック | 全目標の確認（転移を含む） | quiz(exam) | e1 → o1（転移）, e4 → o2（転移）, e5 → o3（e2・e3・e6 は削除） |
| summary | summary | まとめ | 要点・振り返り・次の一歩・復習 | summary(5), markdown, flashcards(7), askTutor | — |

### Last fix round (2026-10-21)
- Step titles in s3-steps, practice-steps and practice-spec-steps no longer start with ①–⑦: the reader numbers steps itself (visual QA).

### After publishing (2026-10-21)
- After publishing, a full pedagogy review asked for less load: s2-version is now a short recall of 第2回 (「第2回のおさらい」), s4-community no longer introduces スキル, and s4-good-spec and card-good-spec say 「つなぎ目（関数名など）」 instead of introducing インターフェース.
