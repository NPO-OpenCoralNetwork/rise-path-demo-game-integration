# Claude Code 活用カリキュラムのための調査レポート（2026年10月）

キー: `claude-code-curriculum`。Rise Path で「Claude Code の使い方」を最新の実践まで教えるコースを作るための調査です。
調査日は 2026-10-20、対象バージョンは Claude Code v2.1.304（2026-10-19 公開）です。

このレポートは次の 3 つを扱います。

1. Claude Code の現在地。何ができ、最近なにが変わったか。
2. 実践のトレンドと、学習者がつまずく点。
3. それをもとにしたコース設計。モジュール、レッスン、到達目標、演習。

レッスンの下書きは `content/courses/vibe-coding/drafts/cc-*.lesson.json`、ブリーフは同じコースの `briefs/` にあります（§9）。

---

## 0. 要旨

1. **Claude Code は「チャットで聞く道具」ではなく「仕事を任せるエージェント」です。**
   公式ドキュメントは、文脈を集める → 行動する → 結果を確かめる、のループで説明します。
   教えるべき中心は、コマンドの暗記ではなく「任せ方」と「確かめ方」です。
2. **2026年に既定値がいくつも変わりました。2025年の解説記事は古くなっています。**
   - 権限モード：ターミナルと VS Code の対話セッションは、起動オプションや設定で指定がなければ auto（分類器が確認する方式）で始まります（v2.1.283 以降）。デスクトップアプリとクラウドセッションは別の扱いです。
   - 名前の変更：毎回確認する従来の `default` は、表示名が「Manual」になりました。
   - サブエージェント：既定でバックグラウンド実行されるようになりました。
   - AGENTS.md：CLAUDE.md がない場合に読み込まれるようになりました（v2.1.277 以降）。
   - 機能名の変更：「routines」は「scheduled tasks」に、「Claude Code on the web」は「cloud sessions」に、「headless mode」は「non-interactive mode」になりました。

   教材では、変わりやすい画面の細部ではなく概念を教えます。版と出典を明記し、毎月見直します（§8）。
3. **公式のベストプラクティスの核は 2 つです。** 1 つは「コンテキストウィンドウは有限で、埋まるほど性能が落ちる」こと、もう 1 つは「Claude が自分で実行できる検証手段（テスト・ビルド・スクリーンショット）を渡す」ことです。
   推奨の流れは、探索 → 計画（plan mode）→ 実装 → コミットです。さらに、別のコンテキストでのレビューを加えます。
4. **拡張機能は「困ったときに足す」順番で教えます。** 公式は、最初は CLAUDE.md だけで始め、きっかけが来たら skills・MCP・subagents・hooks・plugins を足す、と勧めています。
   CLAUDE.md は「助言」です。強制したいことは permissions と hooks に書く、という区別が重要です。
5. **安全とコストは独立した 1 レッスンにします。** 扱うのは、プロンプトインジェクション、サンドボックス（既定はオフ）、チェックポイントが git の代わりにならないこと、`ANTHROPIC_API_KEY` が設定されていると API 課金になる落とし穴、使用量の確認（`/usage`）です。
6. **学習科学の注意点**：Anthropic の RCT（2026-01-29）では、AI に任せて学んだ群は後の理解度テストの点が低くなりました。ただし、説明を求めた学習者は点が高いままでした。
   そこで、各レッスンに「差分を説明させる」「結果を予測する」確認を入れます。Learning・Explanatory 出力スタイルも紹介します。
7. **既存講座との差別化**：Anthropic の Claude Code 101（入門・英語）と Claude Code in Action（上級）が公式の骨格です。日本語の書籍は 2025-12 以降に 4 冊出ています。
   Rise Path の強みは 3 つです。日本語のネイティブな文章、1 レッスン 15〜20 分の小さな単位、「予測 → 確認 → 演習」で必ず手を動かす構成です。
8. **提案するコース**：「Claude Code 実践：AIエージェントと開発する」。4 モジュール 11 レッスン、合計 約3時間40分です（§7）。
   今回、11 レッスンすべての下書きを作成しました。各レッスンは、契約チェック（validate / lint）と独立レビュー（pedagogy-reviewer・ja-editor）にかけています（§9）。

---

## 1. 調査の方法

- **5 つの観点**で並行して調べました。
  - ① 公式ドキュメントの機能マップ
  - ② 2025〜2026 年の変更履歴
  - ③ 実践のトレンドとベストプラクティス（日本語コミュニティを含む）
  - ④ 既存講座・書籍と学習者のつまずき
  - ⑤ 安全・ガバナンス・コスト
- 観点ごとに**別のエージェントが事実確認**しました。各項目について公式ページを開いて照合し、「確認済み」「訂正」「未確認」に分けました。
  - 結果は 191 項目で、確認済み 161、訂正 30、未確認 0 です。
  - 訂正は数字・版・言い回しの細部が中心です。たとえば「Bedrock 等は CLI と IDE だけ」は誤りで、Enterprise の Desktop も対応しています。
  - さらに、取りこぼし 76 項目を追加しました。
- 情報源の優先順位は 3 段階です。
  1. 公式ドキュメント（code.claude.com/docs）、CHANGELOG、Anthropic / claude.com の公式記事
  2. よく知られた実践者の記事
  3. 第三者のまとめサイト（手がかりとしてだけ使用）

  日付は、CHANGELOG の見出しに日付がないため、npm の公開日と公式の週次ダイジェストで照合しました。
- 公式ドキュメントは日本語版が `code.claude.com/docs/ja/` にあり、英語版と同時に更新されています。教材のリンク先には日本語版も使えます。

---

## 2. Claude Code の現在地（2026年10月）

### 2.1 どこで動くか：1 つのエンジン、いくつもの窓

| 入口 | 特徴 | 教材での扱い |
|---|---|---|
| ターミナル CLI | 基本の入口。ネイティブインストーラー（`curl -fsSL https://claude.ai/install.sh \| bash`、Windows は `irm https://claude.ai/install.ps1 \| iex`）が推奨で、自動更新される | 第1回で導入 |
| VS Code / Cursor 拡張 | VS Code 1.94.0 以上。CLI を同梱。差分を IDE で確認できる | 選択肢として紹介 |
| JetBrains プラグイン | CLI は別途インストールが必要 | 選択肢として紹介 |
| Desktop アプリ（Code タブ） | ターミナルなしで始められる。並列セッション、差分レビュー | ターミナルが苦手な人の入口 |
| cloud sessions（claude.ai/code） | GitHub リポジトリをクラウドで扱う。旧称「Claude Code on the web」 | 自動化の回で紹介 |
| モバイル（Claude アプリの Code タブ） | cloud sessions と Remote Control を操作する | 紹介のみ |

どの入口でも CLAUDE.md・設定・MCP は共通です。「入口が違っても中身は同じ」と最初に示すと、混乱が減ります。

- 必要なもの：
  - OS：macOS 13 以上、Windows 10 1809 以上、Ubuntu 20.04 以上など
  - RAM：4GB 以上
  - インターネット接続
  - 有料プラン（Pro・Max・Team・Enterprise）または Console アカウント。無料プランでは使えません。
- Node.js は npm でインストールするときだけ必要です（22 以上）。推奨のネイティブインストールでは不要です。
  「Node.js が前提」という古い記事の誤解は、解いておく価値があります。

### 2.2 エージェントループとセッション

- Claude Code は「文脈を集める → 行動する → 結果を確かめる」を繰り返します。ファイル操作・検索・実行・Web などのツールを使います。
  エディタの補完のように「今のファイルだけを見る」道具とは違います。
- セッションは毎回まっさらなコンテキストで始まります。前回の会話は覚えていません。
  前回のことが引き継がれるのは、次の 3 つの経路だけです。
  - CLAUDE.md（人が書く）
  - 自動メモリ（Claude が書くメモ。`MEMORY.md` の先頭 200 行か 25KB まで）
  - `claude --continue` / `--resume` で前回のセッションを開き直すこと
- 会話の記録は `~/.claude/projects/` に平文で 30 日間保存されます。

### 2.3 権限モード（2026年に最も変わった部分）

| モード | 何が確認なしで動くか | 使いどころ |
|---|---|---|
| `default`（表示名 Manual） | 読み取りだけ | 慎重に進めたいとき。モードを指定しない `claude -p` と Agent SDK の既定（v2.1.302 以降） |
| `acceptEdits` | ファイル編集と一般的なファイル操作 | 自分で差分を見る前提で速く進めたいとき |
| `plan` | 何も変更しない（調査と計画だけ） | 大きめの変更の前 |
| `auto` | 分類器が裏で確認し、危険な操作は止める | ターミナルと VS Code の対話セッションの既定（v2.1.283 以降、指定がないとき） |
| `dontAsk` | 作業フォルダ内の読み取りと事前に許可したもの。確認が要る操作は拒否 | 無人の自動実行 |
| `bypassPermissions` | ほぼすべて | 隔離された環境（コンテナ・VM）だけ |

- モードは Shift+Tab で切り替えます。
- auto モードの分類器はツールの出力を見ない設計です。これがプロンプトインジェクション対策の中心です。
- auto モードは次のような操作を既定で止めます。
  - `curl | bash`
  - 本番へのデプロイ
  - force push
  - `git reset --hard`
- Anthropic の engineering 記事（2026年3月）の評価では、実際の行き過ぎた操作 52 件のうち 17% を分類器が見逃しました（当時の構成での測定、「正直な数字」と表現）。いまの分類器の性能としてではなく、その記事の数字として扱います。本番に関わる変更は人が確認するよう求めています。
- ルールは deny → ask → allow の順に評価され、最初に一致したものが使われます。
  ルールを守らせるのはモデルではなく Claude Code です。CLAUDE.md に「〜するな」と書いても強制にはなりません。
- Bash のルールは書かれたコマンド文字列で照合されます。公式は「セキュリティ境界ではない」と明記しています。強制したいときは、サンドボックスか PreToolUse フックを使います。
- チェックポイント（Esc を 2 回、または `/rewind`）は、Claude のファイル編集だけを巻き戻します。
  Bash で変えたファイル、外部への操作（DB・API・デプロイ）は戻りません。公式も「バージョン管理の代わりではない」としています。

### 2.4 コンテキストとメモリ

- `/context` で使用量を見ます。`/clear` で空に戻し、`/compact [焦点]` で要約します。上限に近づくと自動でも要約されます。
- 要約（compaction）の後に残るものと失われるものは、次のとおりです。
  - 残る：ルートの CLAUDE.md、パス指定のないルール、自動メモリ、plan mode の計画。いずれもディスクから読み直されます。
  - 失われうる：会話の中でだけ伝えた指示。要約される過程で消えることがあります。
- CLAUDE.md の書き方：
  - 置き場所は 4 つです。管理ポリシー、ユーザー（`~/.claude/CLAUDE.md`）、プロジェクト（`./CLAUDE.md`）、ローカル（`./CLAUDE.local.md`）。上書きではなく連結されます。
  - `/init` で下書きを作れます。
  - 公式の目安は 200 行以内です。具体的で確かめられる指示を書き、2 回同じ間違いをしたら 1 行足します。
  - 途中で編集しても、`/clear`・`/compact`・再起動までは反映されません。
- 関連する仕組み：
  - `.claude/rules/*.md` に `paths:` を書くと、該当ファイルを扱うときだけ読み込まれます。
  - `@path` で他のファイルを取り込めます。入れ子は 4 段までです。
  - AGENTS.md は、CLAUDE.md がないときだけ読み込まれます（v2.1.277 以降）。

### 2.5 拡張機能（選び分けが学習の山場）

| 機能 | 何のためか | 「足すきっかけ」（公式の考え方） |
|---|---|---|
| CLAUDE.md | 毎回守ってほしい前提 | 同じ間違いが 2 回起きた |
| skills（`.claude/skills/<名前>/SKILL.md`） | 繰り返す手順や参考資料をまとめる。説明文だけ常に読み込まれ、本文は使うときに読まれる | 同じ手順を何度も説明している |
| subagents（`.claude/agents/`） | 別のコンテキストで調べものやレビューをし、要約だけ返す | 調査で会話が長くなる、独立した目でレビューしたい |
| hooks | 決まったタイミングで必ず実行するスクリプト。PreToolUse で終了コード 2 を返すと操作を止め、stderr が理由として Claude に伝わる | 「必ず」守らせたい、または自動で整形したい |
| MCP | 外部のツールやデータにつなぐ（`claude mcp add --transport http <名前> <URL>`）。スコープは local・user・project（`.mcp.json`） | 外のシステムの情報が要る |
| plugins | 上の機能をまとめて配布する単位。マーケットプレイスで共有する | チームで同じ環境を配りたい |

- 補足：
  - 2025年の「カスタムスラッシュコマンド」は skills に統合されました。`.claude/commands/` も引き続き使えます。
  - 公式ブログ「Steering Claude Code」（2026-06-18）は、CLAUDE.md の悪い使い方を 5 つ挙げています。
    1. 「毎回 X なら Y」を CLAUDE.md に書く（→ hooks へ）
    2. 「絶対に〜しない」を CLAUDE.md に書く（→ permissions へ）
    3. 30 行の手順を CLAUDE.md に書く（→ skills へ）
    4. 特定の API 向けのルールをパス指定なしで書く（→ rules へ）
    5. 個人の好みをプロジェクトの CLAUDE.md に書く（→ CLAUDE.local.md へ）

    この 5 つは、選び分けの演習にそのまま使えます。
  - プラグインは、あなたの権限で任意のコードを実行できます。Anthropic は MCP サーバーを監査していません。「入れる前に確かめる」を必ず教えます。

### 2.6 並列化と自動化

- **並列化**は次の段階で整理できます。
  1. サブエージェント
  2. git worktree（`claude --worktree <名前>`）
  3. バックグラウンド実行（Ctrl+B、`/tasks`、`claude --bg`）
  4. agent view（`claude agents`、リサーチプレビュー）
  5. agent teams（実験的）
  6. dynamic workflows（`ultracode` キーワード、`/deep-research`）
  7. Projects（クラウド、ベータ）

  プレビュー段階のものは、名前と状態だけを紹介します。
- **自動化**の手段は次のとおりです。
  - `claude -p "<指示>"`：`--output-format json`、`--json-schema`、`--allowedTools`、`--permission-mode dontAsk`、`--bare`（スクリプトでの推奨）
  - GitHub Actions：`anthropics/claude-code-action@v1`。`/install-github-app` で設定します。
  - 定期実行：scheduled tasks（`/schedule`、旧 routines）、Desktop の定期タスク、`/loop`
- `/goal <条件>` は、条件が満たされるまで、別の小さなモデルが毎ターン判定しながら作業を続けさせます。
- 無人で動かすときの公式の注意は 4 つです。
  - 成功の条件を明示する。
  - 読むだけの作業には読み取り権限だけを渡す。
  - 1 回あたりの費用に上限を設ける（`--max-budget-usd`）。
  - 読み込みの失敗を「何もなかった」と扱わない。

### 2.7 モデル・effort・コスト

- `default` は Pro・Max・Team・Enterprise・Anthropic API のいずれでも Opus 5.5 に解決されます。
  `opus`・`sonnet`・`haiku` の別名は 5.5 系を指します（Anthropic API の場合）。
- `/model` でモデルを、`/effort`（low〜max）で考える量を変えます。5.5 系の既定は medium です。
- コストの目安（公式）：企業での平均は、開発者 1 人・稼働 1 日あたり 約13ドル、月 150〜250 ドルです。90% の利用者は 1 日 30 ドル未満です。
- 費用を抑える公式のコツは次のとおりです。
  - 関係のない作業の間は `/clear` する。
  - 普段の作業は Sonnet、難しい推論は Opus を使う。
  - 単純な作業は effort を下げる。
  - CLAUDE.md を短く保つ。
  - 長い調べものはサブエージェントに任せる。
- 使用量は `/usage` で確認します（`/cost`・`/stats` は別名）。表示される金額は定価での見積もりです。サブスクリプションの請求額ではありません。
- 落とし穴：環境変数 `ANTHROPIC_API_KEY` が設定されていて、使うことを承認すると、サブスクリプションではなく API として課金されます。`/status` で確認します。
- Pro と Max の利用上限は、5 時間ごとの上限と週の上限の 2 つです。Claude のチャットと共有です。料金は 2026-10-20 時点で Pro が月 20 ドル（米国表示）です。教材には金額を書かず、公式の料金ページへリンクします。

### 2.8 安全とデータ

- プロンプトインジェクションへの公式の対策は 5 つです。
  1. 提案されたコマンドを承認前に見る。
  2. 信頼できない内容をそのまま渡さない。
  3. 重要ファイルへの変更を確認する。
  4. スクリプトの実行は VM で行う。
  5. 不審な挙動は `/feedback` で報告する。

  信頼できないリポジトリには、VM か cloud session を勧めています。
- サンドボックスの要点：
  - 既定はオフです。`/sandbox` でオンにします。
  - 対応 OS は macOS（Seatbelt）と Linux・WSL2（bubblewrap）で、ネイティブの Windows は対象外です。
  - 対象はシェルコマンドだけです。ファイル編集ツール・MCP・フックはサンドボックスの外で動きます。
- データの扱い：
  - 個人向けプラン（Free・Pro・Max）は、学習への利用を本人が選びます。
  - 法人向け（Team・Enterprise・API）は、既定で学習に使われません。
  - 保持期間は通常 30 日です。個人向けで学習を許可した場合は 5 年です。
- 日本は公式の提供地域に入っています。`language` 設定で応答言語を日本語にできます。

---

## 3. 古い教材とのズレ（名前と既定値の変更）

学習者が古い記事や動画を見たときに迷わないよう、レッスン内で「旧名」を一度だけ示します。

| 古い呼び方・挙動 | 現在（2026-10） | 根拠 |
|---|---|---|
| 権限モード「default」が開始時の既定 | ターミナルと VS Code の対話セッションの既定は auto（v2.1.283 以降、指定がないとき）。default は表示名「Manual」 | permission-modes、CHANGELOG |
| カスタムスラッシュコマンド | skills に統合（`.claude/commands/` も動く） | skills、glossary |
| Claude Code on the web | cloud sessions | glossary、claude.com blog |
| headless mode | non-interactive mode（同じ `-p`） | glossary |
| routines | scheduled tasks（`/schedule`、別名 `/routines`） | routines |
| Claude Code SDK | Claude Agent SDK | agent-sdk overview |
| `/agents` ウィザード | 削除（v2.1.198）。サブエージェントは既定でバックグラウンド実行 | whats-new 2026-w27 |
| `/ultraplan` | 削除（v2.1.222）。plan mode を使う | commands |
| `#` で CLAUDE.md に追記 | 削除。`/memory` や直接の編集を使う | CHANGELOG |
| AGENTS.md は読まれない | CLAUDE.md がないときは読まれる（v2.1.277 以降） | memory |
| Node.js が必須 | ネイティブインストーラーが推奨。Node.js は npm 経由のときだけ | setup |

---

## 4. 実践のトレンド（2025〜2026）

公式のガイダンスと、コミュニティで広がっている方法を分けて示します。

| 実践 | 内容 | 出典の種類 |
|---|---|---|
| 検証を最初に用意する | テスト・ビルド・lint・スクリーンショットなど、Claude が自分で実行できる確認を渡す。「できました」ではなく証拠を求める | 公式 |
| 探索 → 計画 → 実装 → コミット | plan mode で調査と計画を分ける。小さな変更では計画を省いてよい | 公式 |
| 仕様を先に作る | AskUserQuestion で Claude にインタビューさせ、`SPEC.md` に書かせてから、新しいセッションで実装する | 公式 |
| 作る人と判定する人を分ける | 自分の成果物の採点は甘くなる。別コンテキストのサブエージェントや `/code-review` でレビューする。ただし「すべての指摘を直す」と過剰設計になる | 公式（engineering） |
| コンテキストを汚さない | 無関係な作業の間は `/clear`。2 回直してだめなら最初からやり直す。調べものはサブエージェントへ | 公式 |
| CLAUDE.md は短く、強制は hooks と permissions で | 200 行以内。手順は skills、パス別のルールは `.claude/rules/` | 公式 |
| worktree で並列 | 1 チケット 1 worktree。依存関係は worktree ごとにインストールする | 公式＋コミュニティ |
| チームの知識を skills と plugins で配る | 社内マーケットプレイスや `/team-onboarding` を使う | 公式 |
| 日本のチームの例 | plan mode を既定にし、Stop フックで「計画と実装の一致」を確かめてからドラフト PR を出す | コミュニティ（Zenn） |
| 仕様駆動のツールキット | cc-sdd（Kiro 風、`npx cc-sdd@latest --lang ja`）、GitHub Spec Kit | コミュニティ |
| 生産性の測り方に慎重になる | METR の 2025 年の研究（熟練者が 19% 遅くなった）と、2026-02 の更新（今はおそらく速くなっているが証拠は弱い） | 研究 |

公式が挙げる失敗パターンは次の 5 つで、レッスンの誤答選択肢の素材になります。

- 何でも詰め込んだセッション（kitchen sink）
- 何度も直させ続ける
- 書きすぎた CLAUDE.md
- 信じてから確かめるまでの隙間（trust-then-verify gap）
- 終わらない探索

---

## 5. 既存の講座・書籍と、Rise Path の位置づけ

| 講座・書籍 | 対象と構成 | Rise Path との違い |
|---|---|---|
| Claude Code 101（Anthropic Academy、英語、1.5時間・12レッスン） | 入門。何か → 最初のプロンプト → 日々の流れ → カスタマイズ | 骨格は同じ順序にそろえる。日本語、確認問題、演習で差をつける |
| Claude Code in Action（同、改訂版の上級講座） | 長時間・無人・チームでの運用。操縦 → 設定 → 自動化 → 検証と共有 | モジュール 4 の参考にする |
| Introduction to agent skills / subagents（同） | 機能別の短い講座 | レッスン 7 の発展学習として紹介する |
| DeepLearning.AI「Claude Code: A Highly Agentic Coding Assistant」（中級・約2時間） | Python と Git が前提。プロジェクト型 | 最終演習の題材選びの参考にする |
| 『実践Claude Code入門』（技術評論社、2025-12） | 仕様駆動開発が軸 | レッスン 3 の参考文献 |
| 『1週間でClaude Codeの基礎が学べる本』（インプレス、2026-09） | 7 日で学ぶ入門 | 入門層の想定読者が近い |
| 『Claude Code 実用入門』（マイナビ出版、2026-05）、『Claude Code入門』（秀和システム新社、2026-06） | 入門書 | 書籍は版が固定される。Rise Path は毎月更新できる |

日本語の動画講座（Udemy）は、調査時点では見つかりませんでした。日本語で、短く、更新され続ける対話型の講座には、まだ空きがあります。

---

## 6. 学習者のつまずきと誤解（レッスンの誤答選択肢の素材）

| 誤解 | 正しい理解 | 扱うレッスン |
|---|---|---|
| チャットや補完と同じ。聞いたら答えが返るだけ | ツールを使って調べ、変更し、確かめるループで動く | 1 |
| 前回の会話を覚えている | 毎回まっさら。引き継ぐのは CLAUDE.md・自動メモリ・セッションの再開だけ | 1、5、6 |
| 「完了しました」と言えば完了 | 実行できる検証で証拠を見る。自己採点は甘くなる | 4 |
| auto モードなら何をさせても安全 | 2026年3月の公式評価で分類器の見逃しは 17%。本番に関わる変更は人が見る | 2、10 |
| `/rewind` があるから git は要らない | Bash での変更や外部への操作は戻らない。git が必要 | 2 |
| CLAUDE.md に「〜するな」と書けば守られる | CLAUDE.md は助言。強制は permissions と hooks | 6、8 |
| CLAUDE.md は詳しいほどよい | 長いと守られにくい。200 行以内で具体的に | 6 |
| 長い会話を続けるほど文脈が増えて賢くなる | 埋まるほど性能が落ちる。`/clear` と要約を使い分ける | 5 |
| 拡張機能は最初に全部入れる | 困ったきっかけが来たら足す | 7 |
| サブスクリプションなら課金の心配はない | `ANTHROPIC_API_KEY` があると API 課金になる。上限はチャットと共有 | 10 |
| Node.js がないと使えない | 推奨のネイティブインストーラーには不要 | 1 |
| MCP サーバーやプラグインは公式が安全を確認している | Anthropic は監査していない。入れる前に確かめる | 8、10 |

**学習科学からの設計方針。** Anthropic の RCT（52 人、2026-01-29）では、AI に任せて新しいライブラリを学んだ群は、後の理解度テストの点が低くなりました（50% 対 67%）。差が最も大きかったのはデバッグの問題です。
ただし、AI に「説明を求めた」学習者は高い点を保ちました。そこで、このコースでは各演習の後に次の 2 つを入れます。

- 差分を説明させる。
- 結果を予測してから確かめる。

あわせて Explanatory・Learning の出力スタイルを紹介します。Learning は、学習者が書く部分を `TODO(human)` として残します。

---

## 7. コース設計案：「Claude Code 実践：AIエージェントと開発する」

- **対象**：
  - バイブコーディングコースの第3章（VS Code）・第5章（GitHub）程度の基礎がある人
  - 他の AI コーディングツールを使ったことがある開発者
- **前提**：ターミナルで `cd`・`ls` ができる。Git の commit と push の意味がわかる。有料プランか Console アカウントがある。
- **レベル**：初級〜中級。**全 11 レッスン・合計 約3時間40分**（1 レッスン 15〜25 分）。
- **共通の型**（Rise Path のレッスン契約）：問題提起と予測 → 3〜5 の概念と例 → 確認問題 → 演習（成功条件・ヒント・模範解答）→ 総まとめテスト → 要点とフラッシュカード。
- **版の書き方**：レッスンの冒頭に「2026年10月時点（Claude Code v2.1.304）」と書きます。既定値が変わった機能には最低バージョンを添えます。

### モジュール 1：はじめる

| ID | タイトル | 到達目標（Bloom） | 演習 |
|---|---|---|---|
| `cc-01-first-session` | 最初のタスクを任せる | o1 チャットとエージェントループの違いを説明できる（understand）／o2 状況に合う入口（CLI・IDE・Desktop・cloud）を選べる（apply）／o3 質問 → 小さな変更 → 差分確認 → コミットの流れを実行できる（apply） | 練習用フォルダで「このプロジェクトは何をするもの？」から 1 コミットまで |
| `cc-02-permissions` | 任せる範囲を決める：権限モードと巻き戻し | o1 場面に合う権限モードを選べる（apply）／o2 `/rewind` で戻るもの・戻らないものを見分けられる（analyze）／o3 `git push` に確認を挟む ask ルールを書ける（apply） | settings.json に deny / ask ルールを書き、動きを確かめる |

### モジュール 2：頼み方と進め方

| ID | タイトル | 到達目標（Bloom） | 演習 |
|---|---|---|---|
| `cc-03-plan-first` | 探索 → 計画 → 実装 → コミット | o1 あいまいな依頼を 4 つの観点で具体的に書き直せる（apply）／o2 plan mode を使うべき場面を判断できる（evaluate）／o3 仕様インタビューの依頼文を作れる（create） | 小さな機能追加を plan mode で計画させ、計画を直してから実装させる |
| `cc-04-verify` | 検証を任せる：テスト・レビュー・説明 | o1 タスクに合う「実行できる確認」を設計できる（create）／o2 証拠のない完了報告を見抜ける（analyze）／o3 別コンテキストのレビューを依頼し、指摘を取捨できる（evaluate） | テストを先に書かせて実装させ、`/code-review` の指摘を仕分ける |
| `cc-05-context` | コンテキストを管理する | o1 失敗パターンを見分け、`/clear`・`/compact`・サブエージェントから対処を選べる（analyze）／o2 要約で残るものと消えるものを予測できる（understand）／o3 `/context` で使用量を確かめられる（apply） | 長くなったセッションを診断し、立て直す |

### モジュール 3：プロジェクトに合わせて育てる

| ID | タイトル | 到達目標（Bloom） | 演習 |
|---|---|---|---|
| `cc-06-claude-md` | CLAUDE.md で前提を伝える | o1 指示の置き場所（CLAUDE.md・rules・CLAUDE.local.md・settings）を選べる（apply）／o2 長すぎる CLAUDE.md を改善できる（evaluate）／o3 CLAUDE.md が強制にならない理由を説明できる（understand） | `/init` の下書きを 200 行以内の具体的な指示に直す |
| `cc-07-skills-subagents` | 手順はスキルに、調べものはサブエージェントに | o1 繰り返す手順を SKILL.md にまとめられる（create）／o2 スキル・サブエージェント・CLAUDE.md の使い分けを判断できる（evaluate）／o3 サブエージェントでコンテキストが節約できる理由を説明できる（understand） | 自分のよくある作業を 1 つスキルにする |
| `cc-08-hooks-mcp` | フックで守らせ、MCP でつなぐ | o1 PreToolUse フックで危険な操作を止める設定を書ける（apply）／o2 終了コードによる違いを予測できる（understand）／o3 MCP サーバーやプラグインを入れる前に確かめる点を挙げられる（evaluate） | `.env` への書き込みを止めるフックと、整形を自動で走らせるフックを作る |

### モジュール 4：チームと自動化

| ID | タイトル | 到達目標（Bloom） | 演習 |
|---|---|---|---|
| `cc-09-parallel-automation` | 並列で進める・自動で回す | o1 worktree・サブエージェント・バックグラウンドから並列の方法を選べる（evaluate）／o2 CI 向けの安全な `claude -p` を書ける（apply）／o3 無人実行の依頼文を成功条件と制限つきで設計できる（create） | 定期レポートの依頼文を書き、チェックリストで点検する |
| `cc-10-safety-cost` | 安全とコストを管理する | o1 危ない場面と対策を結びつけられる（analyze）／o2 秘密情報を読ませない deny ルールを書ける（apply）／o3 想定外の請求の原因を特定できる（analyze） | 自分の設定を「安全・コスト」チェックリストで点検する |
| `cc-11-capstone` | 総合演習：自分のリポジトリに Claude Code 環境をつくる | o1 CLAUDE.md・スキル・フック・権限ルールを組み合わせて設計できる（create）／o2 チェックリストで自分の設定を評価できる（evaluate） | 実在の自分のリポジトリで環境を作り、1 つの機能を計画 → 実装 → 検証 → コミットする |

### 公開時の形（オーナーの判断事項）

- **案A（推奨）：新しいコース `claude-code` として公開する。**
  - `content/courses/claude-code/course.json` を作り、上の 4 モジュールを並べます。
  - レッスンファイルは `lessons/` へ移し、`courseId` を `claude-code` に直します。`next` は公開時に付けます。
  - world は `vibe` を使い回すか、新しく作るかを決める必要があります。
- **案B：バイブコーディングコースの第5モジュール「Claude Code で開発する」として追加する。**
  - 第6章（Gemini CLI）と並ぶ位置になります。
  - コースの学習時間が長くなり、Claude Code 未経験の人には第12章以降が重く感じられる可能性があります。

今回の下書きは、プレビューに `course.json` が必要なため、`content/courses/vibe-coding/drafts/` に置いています。
`courseId: "vibe-coding"`、`next` なし、日本語のみです。英語版は、公開するコースが決まってから翻訳します。

---

## 8. 教材の保守方針

Claude Code は 2026-05 以降、ほぼ毎日（約150回）リリースされています。教材は次の方針で保守します。

1. **概念を教え、画面の細部を固定しない。** キー操作やコマンドは、公式ドキュメントで確かめたものだけを書きます。出典（`sources` と `cite`）を付けます。
2. **版を書く。** 既定値が変わった機能（auto モード、AGENTS.md、`-p` の既定モード）には「v2.1.283 以降」のように書きます。
3. **プレビュー段階の機能は「紹介」にとどめる。** agent view、agent teams、Projects、ultrareview、fast mode などです。演習の必須手順にはしません。
4. **月 1 回の見直し**：公式の「What's new」と CHANGELOG を確認し、§3 の表と各レッスンの `checkedAt` を更新します。大きなモデルの公開後も見直します。
5. 学習者にも「最新情報の確かめ方」を教えます。Claude Code 自身に聞くと、現在のドキュメントを調べて答えてくれます。`/powerup` と公式ドキュメントの日本語版も紹介します。

---

## 9. 今回作成した教材

| 種類 | 場所 |
|---|---|
| このレポート | `doc/brushup-2026/research/claude-code-curriculum.ja.md` |
| レッスンごとのブリーフ | `content/courses/vibe-coding/briefs/cc-*.md` |
| レッスンの下書き（11本） | `content/courses/vibe-coding/drafts/cc-*.lesson.json` |
| レビュー結果とレポート | `content/courses/vibe-coding/reports/cc-*` |

各レッスンの validate・lint・レビューの結果は、レッスンごとのレポート（`reports/cc-*.md`）に記録します。

### 9.1 品質の確かめ方

各レッスンは次の順で確かめました。結果はレッスンごとのレポート（`reports/cc-*.md`）にあります。

1. **独立レビュー**：pedagogy-reviewer（rubric.v1 の 13 観点）と ja-editor（日本語）が全文を読み、判定スクリプト（`check-review.mjs`）で合否を決めます。合格は「全観点 3 以上、平均 3.3 以上、必須修正なし」です。修正後は、変更の範囲に応じて確認ラウンドか全文の再レビューをします。
2. **事実の照合**：Web を見られる監査役が、コマンド・設定・既定値・数字・出力例などの主張を 1 レッスンあたり 50〜85 件、公式ドキュメント（2026-10-20 時点）と照らしました。指摘ごとに別の検証役が「レッスンが正しい」側から反証を試み、残ったものだけを直しています。
3. **画面の確認**：プレビュー（PC とスマートフォン幅）を撮り、visual-qa が全画面を見ます。

照合で見つかった主な誤りは、レビュー役（Web を見られない）も見落としていたものです。例：auto モードが既定になるのはターミナルと VS Code の対話セッションだけ、確認ルール（ask）は権限モードによって確認なしで拒否されることがある、`Read` の拒否ルールは `cat` などには効くがスクリプトが自分で開くファイルには効かない、など。

### 9.2 このコースで決めた書き方（オーナー確認用）

レビューのたびに判断が揺れた点は、コース共通の決まりにしました。レッスン契約（lesson-contract）に取り込むかはオーナーの判断です。

| 項目 | 決めたこと | 理由 |
|---|---|---|
| 本文の分量 | 段落・手順・要約などの「本文」で 1,200〜2,400 字。表・用語・依頼文の例は読む時間（estMinutes）に入れる | 数え方が人によって違い、指摘が往復したため。公開済みの vibe-ch2 も同じ数え方で範囲内 |
| 表 | 2 列まで | スマートフォン幅（390px）で 3 列目が見えなくなり、横スクロールの手がかりもないため |
| 図（Mermaid） | 横に並べるのは 2 つまで、ラベルは 1 行 12 字まで | 同じ理由 |
| 文字だけの欄 | 見出し・図の説明・チェック項目・用語名・前提・AI先生への質問例には、`コード` や太字の記法を書かない | リーダーがこれらを記法として描かず、記号がそのまま出るため |
| 選択肢の順番 | 正解の位置を 1〜4 番目に散らす | リーダーが選択肢を並べ替えないため |

---

## 10. オーナーへの確認事項

1. 公開の形：案A（新コース `claude-code`）と案B（バイブコーディングに追加）のどちらにするか。
2. 英語版をいつ作るか。公開するコースが決まってから翻訳する想定です。
3. 演習用リポジトリの題材：Rise Path で共通の練習用リポジトリ（小さな Web アプリ）を用意するか、学習者の手元のプロジェクトを使うか。今回の下書きは「新しい練習用フォルダを作る」形にしています。
4. 有料プランが前提になる点：無料プランでは Claude Code が使えません。コース紹介文にどう書くかを決めます。
5. §9.2 の書き方の決まりを、レッスン契約（`lesson-contract.md`）とリンターに取り込むか。
6. リーダーの改善を検討するか（今回は教材側で回避し、コードは変えていません）：見出しやチェック項目で `コード` 記法を描く、幅の広い表や図に横スクロールの手がかりを出す、選択肢を並べ替える、下書きのプレビューで「コースの最後のレッスン」と表示される。

---

## 11. 出典（2026-10-20 確認）

公式ドキュメント（日本語版は `https://code.claude.com/docs/ja/<ページ>`）：

| id | タイトル | URL |
|---|---|---|
| cc-overview | Claude Code overview | https://code.claude.com/docs/en/overview |
| cc-setup | Advanced setup | https://code.claude.com/docs/en/setup |
| cc-quickstart | Quickstart | https://code.claude.com/docs/en/quickstart |
| cc-how-it-works | How Claude Code works | https://code.claude.com/docs/en/how-claude-code-works |
| cc-best-practices | Best practices for Claude Code | https://code.claude.com/docs/en/best-practices |
| cc-common-workflows | Common workflows | https://code.claude.com/docs/en/common-workflows |
| cc-permission-modes | Permission modes | https://code.claude.com/docs/en/permission-modes |
| cc-permissions | Configure permissions | https://code.claude.com/docs/en/permissions |
| cc-checkpointing | Checkpointing | https://code.claude.com/docs/en/checkpointing |
| cc-memory | Manage Claude's memory | https://code.claude.com/docs/en/memory |
| cc-context-window | Context window | https://code.claude.com/docs/en/context-window |
| cc-features-overview | Extend Claude Code | https://code.claude.com/docs/en/features-overview |
| cc-skills | Agent Skills | https://code.claude.com/docs/en/skills |
| cc-sub-agents | Subagents | https://code.claude.com/docs/en/sub-agents |
| cc-hooks | Hooks reference | https://code.claude.com/docs/en/hooks |
| cc-hooks-guide | Get started with hooks | https://code.claude.com/docs/en/hooks-guide |
| cc-mcp | Connect Claude Code to tools via MCP | https://code.claude.com/docs/en/mcp |
| cc-plugins | Plugins | https://code.claude.com/docs/en/plugins/overview |
| cc-worktrees | Worktrees | https://code.claude.com/docs/en/worktrees |
| cc-agents | Run agents in parallel | https://code.claude.com/docs/en/agents |
| cc-headless | Run Claude Code programmatically | https://code.claude.com/docs/en/headless |
| cc-github-actions | Claude Code GitHub Actions | https://code.claude.com/docs/en/github-actions |
| cc-scheduled-tasks | Scheduled tasks | https://code.claude.com/docs/en/scheduled-tasks |
| cc-goal | /goal | https://code.claude.com/docs/en/goal |
| cc-security | Security | https://code.claude.com/docs/en/security |
| cc-sandboxing | Sandboxing | https://code.claude.com/docs/en/sandboxing |
| cc-data-usage | Data usage | https://code.claude.com/docs/en/data-usage |
| cc-costs | Manage costs effectively | https://code.claude.com/docs/en/costs |
| cc-authentication | Authentication | https://code.claude.com/docs/en/authentication |
| cc-model-config | Model configuration | https://code.claude.com/docs/en/model-config |
| cc-output-styles | Output styles | https://code.claude.com/docs/en/output-styles |
| cc-commands | Commands | https://code.claude.com/docs/en/commands |
| cc-glossary | Glossary | https://code.claude.com/docs/en/glossary |
| cc-changelog | Claude Code CHANGELOG | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |

Anthropic・claude.com の記事、研究：

| id | タイトル | URL |
|---|---|---|
| steering-post | Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents（2026-06-18） | https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more |
| harness-design | Harness design for long-running apps（2026-03-24） | https://www.anthropic.com/engineering/harness-design-long-running-apps |
| auto-mode-eng | Claude Code auto mode（engineering） | https://www.anthropic.com/engineering/claude-code-auto-mode |
| large-codebases | How Claude Code works in large codebases（2026-05-14） | https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start |
| ai-skills-rct | How AI assistance impacts the formation of coding skills（2026-01-29） | https://www.anthropic.com/research/AI-assistance-coding-skills |
| academy-101 | Claude Code 101（Anthropic Academy） | https://academy.claude.com/courses/claude-code-101 |
| academy-in-action | Claude Code in Action | https://anthropic.skilljar.com/claude-code-in-action |
| dlai-course | Claude Code: A Highly Agentic Coding Assistant（DeepLearning.AI） | https://www.deeplearning.ai/courses/claude-code-a-highly-agentic-coding-assistant |
| pricing | Claude pricing | https://claude.com/pricing |
| supported-countries | Supported countries | https://www.anthropic.com/supported-countries |

実践者・コミュニティ・研究（意見として扱う）：

| id | タイトル | URL |
|---|---|---|
| willison-vibe-eng | Vibe engineering（Simon Willison、2025-10-07） | https://simonwillison.net/2025/Oct/7/vibe-engineering/ |
| boris-tane | How I use Claude Code（2026-02） | https://boristane.com/blog/how-i-use-claude-code/ |
| cc-sdd | cc-sdd（仕様駆動開発のスキル集） | https://github.com/gotalab/cc-sdd |
| arm-techblog | ARM techblog（Zenn、2026-06-16） | https://zenn.dev/arm_techblog/articles/7712cde19988c8 |
| metr-2025 | METR: early-2025 AI and experienced OS developers | https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ |
| metr-2026 | METR: uplift update（2026-02-24） | https://metr.org/blog/2026-02-24-uplift-update/ |
| gihyo-book | 実践Claude Code入門（技術評論社） | https://gihyo.jp/book/2026/978-4-297-15354-0 |

調査の生データ（191 項目と、検証者の判定・訂正）は作業環境の一時ファイルにあり、リポジトリには含めていません。必要であれば `doc/brushup-2026/research/` に追加します。
