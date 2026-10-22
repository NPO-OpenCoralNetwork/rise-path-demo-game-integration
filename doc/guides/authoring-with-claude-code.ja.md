# Claude Code で教材をつくる（オーナー向けガイド）

Rise Path の教材（レッスン）を、Claude Code などの AI エージェントに書かせ、検証・レビュー・
画面確認まで通すための手順です。英語の短い版は
[authoring-with-claude-code.md](authoring-with-claude-code.md) にあります。

- 対象: リポジトリのオーナーと、教材を追加・改善する開発者
- 前提: Node.js 22 以上、`npm install` 済み、Claude Code（`claude` コマンド）が使えること
- 関連: 計画 `doc/brushup-2026/PLAN.ja.md` §7、教材の形式 `shared/lesson/schema.js`

---

## 1. 全体の流れ

```
依頼 ─► brief（目的・対象・前提） ─► アウトライン（確認 1 回）
     ─► 下書き JSON（content/courses/<course>/drafts/）
     ─► 自動検証（hook）＋ lessons:validate ＋ lessons:lint --strict
     ─► 独立レビュー（pedagogy-reviewer ＋ ja-editor） ─► 修正（最大 2 往復）
     ─► lessons:preview（スクリーンショット 3 種＋metrics.json） ─► visual-qa ─► 修正
     ─► 翻訳（en） ─► レポート ─►（オーナーが確認して）公開
```

ポイントは 3 つです。

1. **書いた本人は採点しない。** 採点は別コンテキストのサブエージェントが、
   `content/schema/rubric.v1.json`（13 観点・0〜4 点）で行います。合格は「全観点 3 以上、
   平均 3.3 以上、必須修正なし」です。合否はスクリプト（`check-review.mjs`）が計算します。
2. **機械で確かめられることは機械で。** 形式は `lessons:validate`、分量や確認問題の密度は
   `lessons:lint`、はみ出しやコンソールエラーは `lessons:preview` が調べます。
3. **公開は人が決める。** エージェントが書くのは `drafts/` だけです。`lessons/` への移動と
   `course.json` への追加は、オーナーが頼んだときだけ行います。

---

## 2. 準備

```bash
npm install
npm run dev          # API（:3006）と Vite（:3007）。プレビューに必要です
claude               # リポジトリのルートで Claude Code を起動
```

初回起動時に、Claude Code はプロジェクトの MCP サーバー `rise-path-learning`（`.mcp.json`）を
使ってよいか確認します。許可すると、教材用の MCP ツールも使えます。あとから選択をやり直すには
`claude mcp reset-project-choices` を実行します。

読み込まれる設定ファイルは次のとおりです。

| ファイル | 役割 |
|---|---|
| `AGENTS.md` | どのエージェントでも共通の規約（コマンド、置き場所、教材ルール、禁止事項） |
| `CLAUDE.md` | `@AGENTS.md` を読み込み、Claude Code 固有の注意を足す |
| `.claude/rules/content.md` | `content/` 配下を触るときだけ読み込まれる教材ルール |
| `.claude/skills/author-lesson/` | `/author-lesson`：教材づくりの手順と参考資料 |
| `.claude/skills/review-lesson/` | `/review-lesson`：独立レビュー（`pedagogy-reviewer` で実行） |
| `.claude/agents/` | `pedagogy-reviewer`、`ja-editor`、`visual-qa` の 3 つのレビュアー |
| `.claude/hooks/validate-lesson.mjs` | レッスンを書くたびに検証する hook |
| `.claude/settings.example.json` | hook と権限を常時有効にする設定の見本（§7） |
| `.mcp.json` | MCP サーバー `rise-path-learning`（stdio、`curriculum-builder` プロファイル） |
| `content/schema/rubric.v1.json`、`review.v1.json` | 採点基準と、レビュー結果の JSON 形式 |

---

## 3. 教材をつくる：`/author-lesson`

```text
/author-lesson vibe-coding vibe-ch1-practice "第1章の演習。フロント・バック・DBの役割を、実際のアプリの画面から見分ける練習。15分。"
```

引数は「コースの slug」「レッスン ID（小文字・数字・ハイフン）」「依頼内容」の順です。依頼内容の
代わりに brief ファイルのパスを渡すこともできます。

Claude Code は次の順に進めます（詳細は `.claude/skills/author-lesson/SKILL.md`）。

1. **brief**: `content/courses/<course>/briefs/<lesson>.md` を作ります。学習者・到達目標・時間・
   ロケール・制約が足りなければ、**まとめて 1 回だけ**質問します。
2. **調査**: 必要なら公式ドキュメントやリポジトリ内の資料で事実を確かめ、出典を記録します。
   確かめられないことは書きません。
3. **アウトライン**: セクション・役割・各問題が測る目標を表にして、「この構成で進めますか？」と
   1 回だけ聞きます。**ここがオーナーの最初の確認ポイントです。**
4. **下書き**: `content/courses/<course>/drafts/<lesson>.lesson.json` に書きます。書くたびに hook が
   検証し、エラーがあれば Claude がすぐ直します。
5. **検証**: `npm run lessons:validate -- <file>` と `npm run lessons:lint -- <file> --strict`。
   下書きは警告 0 件にします。残す警告には、レポートに理由を書きます（移行したままの章は後述）。
6. **独立レビュー**: `/review-lesson` が `pedagogy-reviewer` で採点し、並行して `ja-editor` が日本語を
   見ます。結果は `reports/<lesson>.<reviewer>.review.json` に保存し、`check-review.mjs` で合否を
   出します。必須修正を直して再レビュー（最大 2 往復）。それでも通らなければ止めて報告します。
   2 回目は、構成が変わっていなければ修正確認レビューです（4 章の「修正確認レビュー」）。
7. **画面確認**: `npm run lessons:preview -- <course> <lesson>` のあと、`visual-qa` が PNG を見ます。
8. **翻訳**: brief に `en` があれば英語を足し、もう一度検証とプレビューをします。
9. **レポート**: `reports/<lesson>.md` に、採点結果、直したこと、残った警告とその理由、前提、
   出典、スクリーンショットの場所、オーナーへの質問をまとめます。

**オーナーが見るもの**: アウトライン（手順 3）、レポート、`.artifacts/preview/…` の PNG、
`/preview/<course>/<lesson>` の実際の画面。

### 確認なしで進められる範囲と、ヘッドレス実行

スキルが確認なしで実行できる操作（`content/courses/` 配下の編集、`lessons:*` スクリプト、
`check-review.mjs`）は、**`/author-lesson` を呼び出したターンの間だけ**有効です。アウトラインの
確認で一度止まったあとは、編集のたびに許可を求められます。

`claude -p` で最後まで自動で回す（ヘッドレス実行）ときは許可を求める相手がいないため、許可の
ない操作はすべて拒否されます。プロジェクトの権限ルールを読み込んで起動してください。

```bash
claude -p '/author-lesson vibe-coding vibe-ch1-practice "第1章の演習。15分。"' \
  --settings .claude/settings.example.json
```

`--settings` で読み込むのはこの実行のときだけで、`.claude/settings.json` は作られません。
開発サーバー（`npm run dev`）は先に起動しておきます。

### 教材のルール（要約）

- 目標は 2〜4 個。「〜を説明できる」「〜を書き分けられる」のように観察できる形で、Bloom の
  レベルを付けます。すべての目標を、`objectiveId` 付きの問題で確かめます。
- 構成: 導入（課題と、採点しない予想問題）→ 3〜5 のセグメント（説明 → 例題 → 確認問題）→ 演習 →
  理解度チェック（全目標）→ まとめと復習カード（4〜8 枚）。
- 確認問題は 2 セクションに 1 回以上。誤答の選択肢には、実際によくある誤解と、2 文以内の解説を
  付けます。
- 分量: 1 文 60 字、1 段落 160 字、本文 1,200〜2,400 字、1 セグメントの新しい用語は 3 つまで。
- 文体: です・ます調。「簡単です」「誰でも」は使いません。カタカナ語は初出で英語を併記します。
- 事実・URL・画像・コマンドを作りません。自明でない主張には出典（`sources` と `cite`）を付けます。

詳しくは `.claude/skills/author-lesson/references/` の 4 つの資料を見てください。

| 資料 | 内容 |
|---|---|
| `lesson-contract.md` | 教材の契約（構成、分量、問題、出典）。MCP の `lesson-schema-get` も返します |
| `block-cookbook.md` | どの場面でどのブロックを使うか。良い例（ブロック見本帳から自動生成）と悪い例 |
| `style-guide.ja.md` | 日本語の文体と表記 |
| `rubric.md` | 採点基準（`rubric.v1.json` から自動生成） |

`block-cookbook.md` と `rubric.md` は生成ファイルです。ブロック見本帳
（`content/examples/blocks-gallery.lesson.json`）、lint ルール、採点基準を変えたら、
`node .claude/skills/author-lesson/scripts/build-references.mjs` で作り直してください
（`npm test` が古いままだと失敗します）。

### 移行したままの章と `lessons:lint --strict`

`data/curricula/**` から機械的に移行し、まだ作り直していない章は、いまの教材ルールを満たして
いません（2026-10-19 時点では、Vibe Coding の第 1 章以外の 11 章）。オーナーの判断
（2026-10-19）により、これは既知の状態として扱い、完了の条件には含めません。

- **判定**: `provenance.migratedFrom` があり、`provenance.author` が `migration` か
  `migration+…`（`migration+claude-code` など、部分的な手直しだけ）で、`reviewedBy` がない
  レッスンです。
- **`--strict` の動き**: これらの警告は「advisory（参考）」と表示し、件数も出します。
  警告だけなら終了コードは 0 です。検証エラーは常に失敗になります。
- **厳格なまま**: `drafts/` の下書きと、それ以外のレッスンは、警告が 1 件でもあれば失敗します。
- **作り直すと厳格になる**: `/author-lesson` で章を作り直すと、`provenance.author` が新しい作者
  （`claude-code` など）に変わります。`migratedFrom` は残します。その章は以後、公開後も含めて
  厳格に判定されます。
- **全部を厳格に**: `npm run lessons:lint -- --strict --include-migrated` は移行したままの章も
  失敗扱いにします。作り直しが残っている章を確かめるときに使います。

---

## 4. レビューだけ頼む：`/review-lesson`

```text
/review-lesson content/courses/vibe-coding/lessons/vibe-ch3.lesson.json
```

`pedagogy-reviewer`（読み取り専用）が、別コンテキストで採点し、`review.v1.json` 形式の JSON を
返します。複数のレビュー結果をまとめて合否を出すには次を使います。

```bash
node .claude/skills/review-lesson/scripts/check-review.mjs content/courses/vibe-coding/reports/vibe-ch3.*.review.json
```

終了コードは 0 = 合格、1 = 未合格（要修正・やり直し・未採点の観点あり）、2 = 形式エラーまたは
古いレビューです。同じ観点を複数のレビュアーが採点した場合は、低いほうの点を使います。

どのレビューも、読んだ版を `lessonHash` に記録します（`review-scope.mjs <file> --hash` の出力）。
教材を直すとハッシュが変わり、それより前のレビューは「古い」ものとして受け付けられません。
`lessonHash` のないレビューも受け付けられません。通すためのオプションはありません。

| レビュアー | 見るもの | 採点する観点 |
|---|---|---|
| `pedagogy-reviewer` | 教え方全体 | 13 観点すべて |
| `ja-editor` | 日本語（と英語）の文章 | `voice`、`load`、`prior`、`a11y_l10n` |
| `visual-qa` | スクリーンショットと `metrics.json` | `visual`、`load`、`a11y_l10n` |

### 修正確認レビュー（2 回目以降）

1 回目は必ず全体レビューです。2 回目以降、前回の必須修正を直しただけなら、修正確認レビュー
（`"mode": "verify"`）にします。レビュアーには、前回のレビューと、前回が読んだ版を渡します。

- 前回の必須修正を一つずつ、「解決」か「未解決」かで判定します（`resolved`）。
- 変わったブロックは、全体レビューと同じ基準ですべて見ます。書き直した問題は新しい問題として見ます。
- 新しい必須修正は、変わったブロックの誤りと、変更が原因の不具合だけです。
- 変わっていない部分への新しい気づきは `niceToHave` に入れます。
- 変更が関わる観点だけを採点し直します。ほかの観点は前回の点を引き継ぎます（`carriedOver`）。

次のどれかに当たるときは、もう一度全体レビューです。`review-scope.mjs` が判定し、終了コード 1 を返します。

- セクションの追加・削除・並べ替え、または役割の変更
- 学習目標の変更（id、文、Bloom レベル、順番）
- 教材の部分の 30% を超える変更。部分とは、ブロック、セクションごとの項目（見出しなど）、
  レッスン全体の項目（タイトルなど）、用語集と出典の各 1 件です。
- ブロックの 30% を超える変更（書き換え・追加・削除・移動）

```bash
node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --since <コミット | sha256:…> --expect-hash <前回の lessonHash>
node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --snapshot   # コミット前の下書きの版を記録（回ごとに別フォルダ）
```

合格の基準は変わりません。`check-review.mjs` は「未解決」を、残っている必須修正として数えます。
「解決」と判定しても、そのブロックが変わっていなければ必須修正は残ります。修正が別のブロックに
あるときは、そのブロックの id を `fixedIn` に書きます。判定のない項目も残り、次の回へ持ち越されます。
ある回で「未解決」になった項目や判定のなかった項目は、その回より後の変更でしか解決しません。

教材全体にかかる必須修正（`blockId` が `"lesson"`）は、レッスン全体の項目が変わったときに
解決します。レッスン全体の項目とは、タイトル、用語集、出典など、セクションの外の項目です。
修正がブロックにあるときは、そのブロックをすべて `fixedIn` に書きます。書いたブロックが
どれも変わっている必要があります。`fixedIn` に書かないブロックの変更だけでは解決しません。

前回のレビューは、記録された回で指定します。`<コミット ID>:content/courses/<course>/reports/<lesson>.<reviewer>.review.json`
か、スナップショットの写し（`.artifacts/review/…/<round>/<reviewer>.review.json`）です。作業ツリーの
`reports/` にある同じレビュアーのファイルは、今回の結果で上書きされるので使えません。手で作った
写しも使えません。

コミットは ID（`git rev-parse --short <コミット>` が出す 7〜40 桁の小文字の 16 進数）で書きます。
`HEAD`、ブランチ名、タグ、`HEAD~1` は、指すコミットが後で変わるので受け付けられません。
`reviewedRevision` には、`review-scope.mjs` が出力した値（コミット ID か `sha256:…`）をそのまま書きます。

`check-review.mjs` は前回のレビューを読み込み、変更の範囲を自分で計算し直します。前回も修正確認
レビューなら、全体レビューまでさかのぼって各回を同じ基準で確かめます。次のときは終了コード 2 で
受け付けません。

- 前回のレビューが読めないとき、または前回の回そのものが無効なとき
- 前回のレビューに `lessonHash` がないとき
- コミットを ID ではなく `HEAD` やブランチ名で書いたとき
- 全体レビューが必要なとき、変更の一覧に漏れがあるとき
- 前回採点した観点が抜けているとき
- 前回の回にいたレビュアーが、今回の実行に入っていないとき
- 同じレビュアーのレビューが 2 つあるとき

前回の回とは、前回のレビューと同じ場所に記録されたレビューのうち、同じ版を読んだものです。
同じ場所とは、そのコミットの `reports/` か、スナップショットの回のフォルダです。同じ版とは、
`lessonHash` が同じということです。別の版を読んだレビューは、その回に含みません。

---

## 5. 画面で確かめる：`npm run lessons:preview`

```bash
npm run lessons:preview -- vibe-coding vibe-ch1
```

開発サーバー（`npm run dev`）が動いている必要があります。ゲストとしてログインした状態で
`/preview/<course>/<lesson>` を開き（`drafts/` に同じ ID があれば下書きを優先）、
`.artifacts/preview/<course>/<lesson>/` に次を書き出します。`.artifacts/` は git の対象外です。

| ファイル | 内容 |
|---|---|
| `desktop-jp.png`、`mobile-jp.png`、`desktop-en.png` | ページ全体（1440px／390px） |
| `pages/<種類>-NN.png` | 1 画面ずつ、学習者がスクロールしたときの見え方 |
| `metrics.json` | 下表の計測値、検証と lint の結果 |

| 指標 | 意味 | 目安 |
|---|---|---|
| `overflowX` | ページが横にはみ出してスクロールするか | `false` |
| `consoleErrors` | コンソールエラーと例外の数 | 0 |
| `mermaidErrors` | 描けなかった図の数 | 0 |
| `charsPerLine` | 本文 1 行の文字数（中央値など） | デスクトップの日本語 30〜40、英語 60〜75 |
| `textOnlyScreens` | 見出し・図・表・コード・問題のない画面の番号 | なし |

データベースのない環境で `/api/…` が 503 を返すのは環境の問題なので、`consoleErrors` には数えず
`ignoredNetworkErrors` に記録します。終了コードは 0 = 問題なし、1 = 撮影はできたが問題あり、
2 = 撮影できなかった（サーバー未起動、レッスンがない など）です。

主なオプション: `--shots desktop-jp,mobile-en`（撮る種類）、`--no-pages`、`--base <URL>`、
`--out <フォルダー>`。Chromium は環境変数 `PLAYWRIGHT_CHROMIUM_PATH`、なければ
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`、それもなければ Playwright の既定
（`npx playwright install chromium`）を使います。

---

## 6. 公開する

エージェントは頼まれない限り公開しません。公開するときは、Claude Code に「vibe-ch1-practice を
公開して」と頼むか、手で次を行います。

1. `drafts/<lesson>.lesson.json` を `lessons/` に移す
2. `course.json` のモジュールに追加し、前後のレッスンの `next` をつなぐ
3. `npm run lessons:validate` と `npm run lessons:catalog` で確認する
4. 修正確認レビューが、前回の回をコミット済みの `<コミット ID>:…/reports/…` で指しているか
   確かめる（`reviewedRevision` もコミット ID）。さかのぼった各回も同じです。スナップショットの
   写しは、作ったチェックアウトにしかないため、ほかのクローンではゲートが通りません。そうでない
   レビュアーには、全体レビューをやり直してもらいます。公開済みのレッスンは
   `server/tests/reviewChainsDurable.test.js` が確かめます。
5. `provenance.reviewedBy` に、確認した人の名前を書く
6. PR にして、レポートとスクリーンショットを添える
7. マージのあと、フロントエンドを再ビルドして再デプロイする。レッスンはビルド時にバンドルへ
   入るため、マージしただけでは学習者に届きません（VM は
   [risepath_vm_deployment.md](risepath_vm_deployment.md) の §4.2、Vercel は
   [deploy/vercel/README.md](../../deploy/vercel/README.md)）。新しいコースは、Learning Hub の
   カードを出す seed の migration（例: `server/migrations/011_seed_claude_code_portal.sql`）も
   要ります。

---

## 7. hook を常に有効にする（オーナーの判断）

検証 hook は、`/author-lesson` を実行している間だけ自動で有効になります（スキルの frontmatter に
登録しています）。手で `content/` を編集するときにも常に検証したい場合は、オーナーが次のどちらかを
選んでください。

- **チーム全員に有効にする**: `.claude/settings.example.json` を `.claude/settings.json` に
  コピーしてコミットします。このリポジトリを開くすべてのセッションで、`content/` 配下のレッスンを
  書くたびに hook が動き、`lessons:*` コマンドと `content/courses/` の編集が確認なしで許可され、
  `.env` 系ファイルの読み取りが禁止されます。影響が全員に及ぶので、PR で合意してから入れてください。
- **自分だけ有効にする**: 同じ内容を `.claude/settings.local.json` に書きます（コミットしません）。

設定後、Claude Code で `/hooks` を開くと登録を確認できます。hook は次のように動きます。

| 書いたファイル | hook の結果 |
|---|---|
| `content/**/*.lesson.json`、`content/courses/*/course.json` 以外 | 何もしない（終了コード 0） |
| 形式エラーあり | エラーを JSON パス付きで Claude に返す（終了コード 2）。Claude が直す |
| 形式は正しい | 終了コード 0。lint の警告があれば、参考情報として Claude に渡す |

---

## 8. ほかの AI から使う（MCP）

Claude Code 以外のエージェントも、MCP サーバー `rise-path-learning` を通して同じ手順で教材を
作れます。ファイルや npm スクリプトの代わりに、次のツールを使います。

| ツール | 内容 |
|---|---|
| `lesson-schema-get` | LLM 用 JSON Schema、教材の契約（`lesson-contract.md`）、お手本の抜粋 |
| `lesson-validate` | 保存せずに検証と lint。エラーは JSON パス付き |
| `lesson-get` | レッスンや下書きを読む（楽観ロック用の hash 付き） |
| `lesson-upsert-draft` | `drafts/` に下書きを保存（DB モードでは DB に保存）。古い hash は conflict |
| `lesson-preview-url` | `/preview/<course>/<lesson>` の URL |

リソース `rp://schema/lesson/v1` と、プロンプト `author-lesson`（`SKILL.md` の本文に MCP 用の
説明を足したもの）も公開しています。教材用のツールは `curriculum-builder`（と `admin`）
プロファイルでだけ見えます。動作確認は次のコマンドでできます（DB は不要です）。

```bash
npm run lessons:mcp-smoke
```

以下の `/path/to/rise-path` は、このリポジトリの絶対パスに置き換えてください。

### Claude Desktop

`mcp-server/claude_desktop_config.example.json` を見本に、Claude Desktop の
`claude_desktop_config.json` に追加します。見本の `/path/to/rise-path` は、必ず実際のパスに書き換えます。

```json
{
  "mcpServers": {
    "rise-path-learning": {
      "command": "node",
      "args": ["/path/to/rise-path/mcp-server/index.js", "--profile", "curriculum-builder"]
    }
  }
}
```

データベースの接続先は、サーバーがリポジトリの `.env.local` から読みます。設定ファイルに
パスワードを書く必要はありません。

### Codex（OpenAI Codex CLI）

Codex は `AGENTS.md` を自動で読みます。MCP は `~/.codex/config.toml` に追加します。

```toml
[mcp_servers.rise-path-learning]
command = "node"
args = ["/path/to/rise-path/mcp-server/index.js", "--profile", "curriculum-builder"]
```

### Cursor

Cursor も `AGENTS.md` をルールとして読みます。MCP は `.cursor/mcp.json`（このリポジトリ用）か
`~/.cursor/mcp.json` に追加します。

```json
{
  "mcpServers": {
    "rise-path-learning": {
      "command": "node",
      "args": ["/path/to/rise-path/mcp-server/index.js", "--profile", "curriculum-builder"]
    }
  }
}
```

### Gemini CLI

設定済みです。`.gemini/settings.json` が `AGENTS.md` をコンテキストとして読み込み、
`rise-path-learning` を `curriculum-builder` プロファイルで起動します。リポジトリのルートで
`gemini` を起動し、`/mcp` でツールが見えることを確かめてください。

### ChatGPT・Claude.ai などのリモート接続

ChatGPT や Claude.ai など、インターネット越しにつなぐ使い方は、学習者ごとのログイン（OAuth）を用意してから提供します（Streamable HTTP（`/mcp`）と OAuth 2.1 への移行は P2 の予定です。計画 §7.4）。それまでは次を守ってください。

- `RISE_PATH_BRIDGE_TOKEN`（ブリッジトークン）を、ChatGPT などの外部サービスに入れません。Hermes と MCP サーバーのあいだだけで使う共有の合言葉なので、持っている人は誰でも同じ権限で動けてしまいます。
- MCP サーバーのポート（SSE の 3100）を、ngrok などのトンネルやファイアウォールの開放でインターネットに公開しません。
- 上の Claude Code・Claude Desktop・Codex・Cursor のように、自分のパソコンから stdio でつなぐ使い方は、これまでどおり使えます。

### ほかのモデルに頼むときの注意

- 出力形式が保証されないローカルモデルは、教材の執筆には使わず、チューターや翻訳にとどめます。
- どのモデルが書いた教材も、`lesson-validate`（または `lessons:validate`）と `/review-lesson` を
  通してから公開します。

---

## 9. 困ったとき

| 症状 | 対処 |
|---|---|
| `lessons:preview` が「dev server is not reachable」で止まる | `npm run dev` を起動する。別のポートなら `--base http://localhost:<port>` |
| Chromium が見つからない | `PLAYWRIGHT_CHROMIUM_PATH` を設定するか、`npx playwright install chromium` |
| プレビューに下書きが出ない | ファイル名と `id` が一致しているか、`course.json` に同じ slug のコースがあるかを確認 |
| hook が動いていない | `/author-lesson` の外では、§7 の設定が必要。`/hooks` で登録を確認 |
| `claude -p` で書き込みやコマンドが拒否される | `--settings .claude/settings.example.json` を付けて起動する（§3「ヘッドレス実行」） |
| MCP のツールが見えない | `claude mcp list` で状態を確認。保留なら許可する。プロファイルが `curriculum-builder` か確認 |
| `npm test` が参考資料の古さで失敗する | `node .claude/skills/author-lesson/scripts/build-references.mjs` を実行してコミット |
| 教材の一覧を見たい | `npm run lessons:catalog`（`--short`、`--json` も可） |

---

## 10. コマンド早見表

| コマンド | 内容 |
|---|---|
| `npm run lessons:catalog` | コース・レッスン・下書きの一覧と、検証・lint の状態（常に終了コード 0） |
| `npm run lessons:validate -- <file>` | 形式と意味のチェック（`--drafts` で下書きも含める） |
| `npm run lessons:lint -- <file> --strict` | 教え方と読みやすさのチェック |
| `npm run lessons:lint -- --strict --include-migrated` | 移行したままの章も含めて厳格にチェック（§3） |
| `npm run lessons:preview -- <course> <lesson>` | スクリーンショットと `metrics.json` |
| `npm run lessons:schema` | `content/schema/` の JSON Schema を作り直す |
| `npm run lessons:mcp-smoke` | MCP の教材ツールの動作確認 |
| `node .claude/skills/review-lesson/scripts/check-review.mjs <files>` | レビュー結果の合否 |
| `node .claude/skills/author-lesson/scripts/build-references.mjs` | 参考資料（cookbook、rubric）の再生成 |
