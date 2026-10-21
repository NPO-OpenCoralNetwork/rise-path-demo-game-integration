# Brief: vibe-coding/cc-06-claude-md

Course: Claude Code 実践（cc-*）, module 3 「プロジェクトに合わせて育てる」, lesson 6 of 11.
Title: 「第6回｜CLAUDE.mdで前提を伝える」. Draft lives in `vibe-coding/drafts/` for preview only
(`courseId: "vibe-coding"`, no `next`); where it is published is the owner's decision.

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を数週間使い始めた開発者・学習者。毎回同じ説明をしている、または長い CLAUDE.md を書いたのに守られないと感じている人。
- すでに知っていること（前提） / prior knowledge: 第1回〜第5回（セッション、権限モードと権限ルール、探索→計画→実装→コミット、検証、コンテキストと `/clear`・`/compact`・`/context`）。ターミナルで `cd`・`ls` が使える。Git の commit の意味がわかる。
- 前のレッスン / previous lesson: 第5回「コンテキストを管理する」（セッションは毎回まっさら、会話だけの指示は圧縮で消えうる）。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: apply): 指示の置き場所（CLAUDE.md・.claude/rules/・CLAUDE.local.md・権限ルール）を、内容に合わせて選べる
- o2 (bloom: evaluate): 長すぎる CLAUDE.md を、短く具体的で確かめられる指示に改善できる
- o3 (bloom: understand): CLAUDE.md に書いても強制にはならない理由を説明できる

## 範囲 / Scope
- 扱う / in:
  - CLAUDE.md の役割（毎回のセッションの始めに読まれるプロジェクトの指示）と `/init` での下書き。
  - 4 つの置き場所（管理ポリシー・ユーザー `~/.claude/CLAUDE.md`・プロジェクト `./CLAUDE.md`・ローカル `./CLAUDE.local.md`）。上書きではなく、つながって読まれる。矛盾は Claude がどちらかを選ぶ。
  - 公式の書き方：1 ファイル 200 行未満、具体的で確かめられる指示、同じ間違いが 2 回で 1 行足す、消しても間違いが増えない行は削る、書かないもの。
  - 途中の編集は `/clear`・`/compact`・再起動のあとに反映。
  - `@path` インポート（4 段まで、起動時に読まれるのでコンテキストは減らない）、`.claude/rules/` と `paths:`、AGENTS.md（v2.1.277 以降の既定では、作業フォルダーとその上に CLAUDE.md も CLAUDE.local.md もないとき。`~/.claude/CLAUDE.md` や組織の CLAUDE.md は数えない。`@AGENTS.md` で共有）。
  - 自動メモリ（Claude が書くメモ、`MEMORY.md` の最初の 200 行か 25KB）。
  - CLAUDE.md は助言でありコンテキスト。強制は権限ルール（第2回）とフック（第8回）。公式ブログ（steering post）の 5 つのつまずきと移す先。
- 扱わない（別レッスン） / out: スキルの書き方（第7回）、フックの書き方（第8回）、権限ルールの細かい書式と評価順（第2回）、`/doctor prompt-audit` や `CLAUDE_CODE_NEW_INIT`、モノレポの `claudeMdExcludes`。
- 学習者がよく持つ誤解 / likely misconceptions（report §6 と facts から）:
  - CLAUDE.md に「〜するな」と書けば守られる（→ 助言。強制は拒否ルールとフック）。
  - CLAUDE.md は詳しいほどよい（→ 長いと守られにくい。200 行未満で具体的に）。
  - 前回の会話を覚えている（→ 毎回まっさら。CLAUDE.md・自動メモリが引き継ぐ）。
  - プロジェクトの CLAUDE.md がユーザーのものを上書きする（→ つながって読まれる）。
  - `@` で分ければコンテキストが減る（→ 起動時に読まれる。減らすのは `paths:` 付きのルール）。
  - IMPORTANT を付ければ確実（→ 強調は 1 行ずつ。強制にはならない）。

## 形式 / Format
- 所要時間 / minutes: 19（コース共通の measure.mjs：`cc-06-claude-md.lesson.json: prose 2400 (budget 1,200–2,400) · read 3690 · practice reading 1285 · questions 9 · practice sections 1 · est 19.1 min (must be ≤ 20; estMinutes 19)`。(3,690 + 1,285) ÷ 450 ≈ 11.06分 + 問題9問 × 40秒 = 6.0分 + 演習1セクション × 2分 = 2分、計 19.1分 → 19）。
- 難易度 / level: intermediate
- ロケール / locales: jp のみ（英語版は公開先が決まってから）。
- 演習の題材 / practice task idea: 練習用フォルダー `cc-practice-06` に、膨らんだ見本の CLAUDE.md（19 行、ヒアドキュメントで作成。どの行も 44 桁以内）を置く。自分で行き先を決めてから Claude Code に書き直しを頼み、差分を説明させ、再起動後に `/context` と `/permissions` で確かめる。具体的な行は残し、手順は `docs/add-screen.md`（第7回のスキル候補）、`src/api/` の決まりは `paths:` 付きルール、「絶対に〜しない」は拒否ルール、好みは CLAUDE.local.md へ。チェックリスト、3 段のヒント、模範解答つき。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20 時点）。AGENTS.md の読み込みは v2.1.277 以降。
- OS / environment: macOS / Linux / WSL のターミナル。管理ポリシーのパスは Linux の例だけ示す。
- 使ってはいけないもの / avoid: 大事なリポジトリでの作業、破壊的なコマンド、秘密情報。値段は書かない。プレビュー機能を必須手順にしない。
- 表記: CLAUDE.md の中身は `code` の `lang: markdown` だと lint の `code-should-be-prompt` に当たるため、学習者が作るファイルは bash のヒアドキュメント（`cat > CLAUDE.md <<'EOF'`）で示す。ルールの先頭（frontmatter）だけは YAML として `lang: yaml` で示す。

## 資料 / Sources
- cc-memory — How Claude remembers your project — https://code.claude.com/docs/en/memory（日本語: https://code.claude.com/docs/ja/memory）
- cc-best-practices — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices
- cc-features-overview — Extend Claude Code — https://code.claude.com/docs/en/features-overview
- cc-permissions — Configure permissions — https://code.claude.com/docs/en/permissions
- cc-permission-modes — Permission modes — https://code.claude.com/docs/en/permission-modes
- cc-skills — Extend Claude with skills — https://code.claude.com/docs/en/skills
- cc-prompt-caching — How Claude Code uses prompt caching — https://code.claude.com/docs/en/prompt-caching
- cc-changelog — Claude Code CHANGELOG — https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- steering-post — Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents（2026-06-18）— https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more

## Assumptions
- 前提の第1回〜第5回は、コース共通の正式タイトル（「第2回｜任せる範囲を決める：権限モードと巻き戻し」など）で書いた。
- 権限ルールの書式（`Read(./.env)`、`Bash(git push *)`）と `/permissions` が規則と出どころのファイルを表示する点は、第2回用の検証済み facts（docs-15, safety-9）から使った。
- 「auto モードの分類器も見逃しがゼロではない」は第2回用 facts（permission-modes: "does not guarantee safety"）による。
- estMinutes: コース共通の measure.mjs で 19.1 分 → 19（Format の行）。問題は 9 問（予想 1・確認 4・テスト 4）。初版（13 問、23 分）から、ほかで評価している q1・q7・e4・e5 を削った。
- 本文の長さ（vibe-ch2 のレポートと同じ数え方：prose のうちプロンプトの expect と手順の hint/troubleshoot を除く）は初版で 2,355 字、prose 全体で 2,470 字。レビュー後の修正（拒否ルールの限界の2文、ヒントの9行目、略語の正式名など）で約 200 字増えた。
- 演習の見本と模範解答はスクラッチで実際に実行し、19 行の CLAUDE.md、`sed -n '/^## 画面/,$p'`（行番号ではなく見出しの中身で指定）での 7 行の手順の切り出し、`.gitignore` への追記、settings.json の JSON として正しいことを確かめた（コマンドを1行に1つにした後も再実行して確認）。
- スマートフォン幅（390 px）に合わせた変更：表はすべて2列にした（s1-table は届く範囲を置き場所のセルへ「ユーザー：自分（すべてのプロジェクト）」の形で移し、管理ポリシーは「Linuxでは `/etc/claude-code/` のCLAUDE.mdなど」と短いコードにした。s4-table は詳しい回・節を移す先のセルへ「フック（第8回）」の形で移した）。見出しは短くし、表の内容と問題が頼る行は変えていない。s3-diagram は横に並ぶノードを2つまでにした（第3ラウンドで下の行のとおり描き直した）。演習の見本と模範解答のコマンドは `&&` でつながず1行に1つにした。
- 第2ラウンドの ja-editor の指摘で、s3-defs のインポートと AGENTS.md を3文以内にし、用語集の AGENTS.md に「作業フォルダーとその上に」の条件を入れた（1文が60字を超えるため、`.claude/CLAUDE.md` は別の文にした）。q0 の解説でコンテキストに英語（context）を添えた。
- 第3ラウンド（visual-qa・pedagogy-reviewer・ja-editor の指摘）：
  - s3-diagram：前回の形（CLAUDE.md・インポート先 → paths: なしのルール → コンテキスト）は、インポートがルールを通って読まれるように見えた。起動時に読まれるもの（CLAUDE.mdとインポート先、paths: なしのルール）を1つのノードにまとめ、コンテキストへ直接つないだ。右の列は「一致するファイルを扱うとき → paths: 付きのルール → コンテキスト」。ラベルは3行以内、横2つまで、幅 361 px（上限 362）。alt から自動メモリを外し、図と同じ内容にした。ja-editor の案（3つのノードを横に並べる）は幅の決まりを超えるため、pedagogy-reviewer の案を3行に収めて使った。
  - 表の1列目は5字以内にした（390 px で単語の途中で折れないように）。s1-table は1列目を届く範囲（組織の全員・自分・チーム・自分）、2列目を「ユーザー（すべてのプロジェクト）：`~/.claude/CLAUDE.md`」の形にした。s2-table は「整形する・テストする・整理する」、s4-table は「禁止・毎回必ず・長い手順・API専用・自分の好み」。表の中身と、問題が頼る行（ユーザー／プロジェクトのCLAUDE.md、毎回必ず → フック）は変えていない。
  - 演習の見本：CLAUDE.md の行を 44 桁以内に縮め、長いテストの行は「テストは npm run test:unit で実行。」「npm test はE2Eまで走って遅い。」の2行に分けた（19 行）。コードの行番号はターミナルのコマンドも数えるため、本文では行番号を使わず、行の中身で示すようにした（pr-decide、依頼文の変数のヒント、答えに近いヒント）。模範解答の CLAUDE.md も短い行にし、HTML コメントは「整形は後でフックにする」（11 字）にした。強調行は 6〜11 行目。
- まとめの次回の案内は正式タイトル（「第7回｜手順はスキルに、調べものはサブエージェントに」）で書き、本文の予算に収めるため s3-lead の2文目（図のキャプションと同じ内容）を削った。チェックリストの項目はです・ます形にした。

## Outline

| section id | role | title | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| hook | hook | はじめに：毎回の説明と、守られない決まり | 同じ説明のくり返しと「守られるのか」の不安を、置き場所と書き方で解く | markdown, quiz(predict) | q0（predict, o3） |
| s1 | concept | 6-1. CLAUDE.mdは毎回最初に読まれる | CLAUDE.md は毎回の始めに読まれる指示。4 つの置き場所はつながって読まれる。自動メモリは Claude が書く | markdown, definitions(CLAUDE.md, CLAUDE.local.md, 自動メモリ), markdown(/init), table(2 列: 届く範囲（5 字以内） / 置き場所：ファイル), markdown, quiz(inline) | q2 → o2（evaluate: 矛盾する2行を直す） |
| s2 | concept | 6-2. 短く、具体的に、確かめられるように | 200 行未満、確かめられる形、2 回間違えたら足し、消しても困らない行は削る | markdown, table(あいまい→具体、1 列目は 5 字以内), markdown, markdown, list(書かないもの), callout(pitfall: 途中の編集), quiz(inline) | q3 → o2（evaluate） |
| s3 | concept | 6-3. 分けて育てる：インポートとルール | `@` は整理だけで毎回読まれる。減らせるのは `paths:` 付きのルール。AGENTS.md の扱い | markdown, definitions(インポート, ルール, AGENTS.md), markdown, code(yaml frontmatter), diagram(起動時に読むもの1つ vs 必要なときの paths: 付きルール、どちらもコンテキストへ。横 2 つまで), markdown, callout(info: 版と公式ドキュメント), quiz(inline) | q4 → o1（apply） |
| s4 | concept | 6-4. 書いても強制にはならない | CLAUDE.md はコンテキストで頼みごと。確実さは権限ルールとフック、手順はスキル | markdown, markdown, definitions(権限ルール, フック, スキル), table(2 列: 書きがちなこと（5 字以内） / 移す先と詳しい回・節), markdown, quiz(inline) | q5 → o3（understand） |
| s5 | example | 6-5. 例題：気になる6行を仕分ける | 6 行を 6 つの手順で仕分ける（理由つき） | markdown, list(6 行), steps(6, expect つき) | — |
| practice | practice | 演習：膨らんだCLAUDE.mdを書き直す | 自分で行き先を決めてから頼み、差分を説明させ、読み込みを確かめる | markdown, code(bash 見本、1 行に 1 コマンド、44 桁以内), steps(6, hint/troubleshoot), prompt(claude-code), checklist(7), callout(tip: 答えに近いヒント), markdown, code(bash 模範解答), code(json settings), markdown | — |
| check | check | 理解度チェック | 全目標を新しい場面で | quiz(exam) | e1 → o1（analyze, 転移: AGENTS.md と CLAUDE.local.md）、e2 → o1（apply, 転移: 毎回の整形）、e3 → o2（evaluate: 240 行）、e6 → o3（apply, 転移: 同僚への説明） |
| summary | summary | まとめ | 4 点 + 次の一歩とふりかえり + 7 枚のカード + AI先生 | summary, markdown, flashcards, askTutor | — |
