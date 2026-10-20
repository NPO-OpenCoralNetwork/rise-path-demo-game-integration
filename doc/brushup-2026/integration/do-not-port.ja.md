# 個人リポジトリから移植しないもの（do-not-port）

作成日: 2026-10-20 ／ 対象: 非公開の個人リポジトリで 2026-07-03 以降に加えた変更
根拠: 個人リポジトリとこのリポジトリのコードと差分の比較（2026-10-20 時点）

---

## 1. 背景とルール

このリポジトリは、非公開の個人リポジトリのコミット `108bc33`（2026-07-03）から、公開できないファイルを除いて作りました。その後、両者は別々に開発が進んでいます。

- **個人リポジトリ：** 2026-07-07〜10-13 に 25 コミット（98 ファイル、+7,806 / −401 行）。カリキュラム生成の強化、Antigravity 業務講座、Mintlify 連携などです。
- **このリポジトリ：** 2026-10-18〜20 のブラッシュアップ（WP-00〜12）、CI、Vibe Coding 第 2 章の作り直しです。

個人側の機能をこのリポジトリに取り込むときは、次のルールに従います。

1. **個人リポジトリの refs を merge・cherry-pick しない。パッチも当てない。** 個人リポジトリの履歴には、公開できないファイルが含まれています。取り込む機能は、`main` の上で新しいコミットとして作り直します。
2. **2 章の一覧にあるものは持ち込まない。** コードの一部を貼り付けることも含みます。
3. **衝突しない差分に注意する。** `server/routes/content.js`、`server/services/curriculumGenerationKit.js`、`tools/core/journal.js` は、このリポジトリでは変更していません。そのため個人側の差分が衝突なしで当たり、気づかないうちに不具合が入ります。
4. **作り直す機能も、このリポジトリのルールに従う。** `AGENTS.md`、`risepath.lesson/v1`、LLM ゲートウェイ（`server/llm/`）、CI のチェックが対象です。

---

## 2. 持ち込まないもの

### 2.1 生成・保存・表示のコード

| 対象 | 個人側のファイル（コミット） | 持ち込まない理由 | 代わりにすること |
|---|---|---|---|
| 表示時のセクション並べ替え（`SECTION_ORDERS`）と疲労オーバーレイ | `server/routes/content.js`（c0761fe, f85dc2a, 1c7f5dc） | 生成時に決めた学習モード別の順序を表示時に並べ替え直し、打ち消してしまいます。セクションの役割をタイトルの部分一致で判定するため、誤判定もあります。学習モードが保存されないので、常に既定値で動きます。 | 順序は生成時に決め、セクションの役割の表を 1 か所にまとめます。 |
| 生活ログからの疲労判定 | `tools/core/journal.js`（f85dc2a） | 日付の制限がないため、古い記録で判定が固定されます。既存の返り値（`welcome_back`、`next_review_after`）が落ちます。睡眠やストレスの値を、同意なしで外部に送ります。 | 同意制（既定はオフ）の日次状態を新しく作ります。本文は変えず、バナーで伝えます。 |
| rich スキーマ用のルーブリックと導入セクションの検証 | `server/services/curriculumGenerationKit.js`（c0761fe, ca07948, 037a8dd） | 生成キットの指示（3〜5 セクション）とルーブリックの基準（6 セクション以上）が食い違い、手本にも警告が出ます。実行されないチェックや、null で例外になる箇所があり、テストもありません。 | `risepath.lesson/v1` の validate・lint と執筆ルールで置き換えます。 |
| 下書きのローカル保存、Markdown 書き出し、モジュール単位の upsert | `tools/core/curriculum.js`（fa2248e, 1c7f5dc） | 入力値を検証せずにファイルパスを組み立てています。DB のエラーなら種類を問わずファイルに退避し、あとで読み戻せません。更新時に版の参照を外すので、版の履歴が切れます。ID のないモジュール同士が重なって消えます。退避先は、公開しているドキュメントのディレクトリです。 | 保存は `writeCurriculumVersion` の 1 経路にまとめます。DB 停止時の退避はレッスンストアで行い、接続系のエラーのときだけに限ります。Markdown は `risepath.lesson/v1` から派生物として書き出します。 |
| `sanitizeMermaidChart` とそのテスト | `tools/core/curriculum.js`、`server/tests/curriculumLocalFallback.test.js`（fa2248e） | 入れ子の括弧を含むラベルを壊します。テストの条件が常に真なので、この不具合を検出できません。 | Mermaid は strict 設定と DOMPurify で扱います（実装済み）。 |
| RAG 検索の変更 | `tools/core/ragSearch.js`（7c0786e） | 埋め込みクライアントの初期化が誤っていて、常にキーワード検索に落ちます。そのキーワード検索は空白で区切るだけなので、日本語の質問に当たりません。 | このリポジトリの `ragSearch.js` を使います。検索結果に出典情報を付ける発想だけ取り込みます（3 章）。 |
| MCP の `get-curriculum-draft` と下書き保存の変更 | `mcp-server/index.js`、`mcp-server/tool-registry.json`（1c7f5dc, fa2248e） | 引数を検証せずにファイルを読み書きします。stdio では呼び出し回数の上限をプロセス全体で共有するため、5 回目の保存で止まります。 | 読み戻しのツールは、UUID だけを受け付けて所有者を確かめる形で作り直します（3 章）。 |
| 旧リーダーの改修 | `components/features/ai/GeneratedDocView.tsx`、`components/features/programming/VibeDocView.tsx`、`components/features/programming/CurriculumUiKit.tsx`、`types.ts`（d7a29b7, c0a9492, fa2248e, 7c0786e） | 旧リーダーの安全化（WP-10）と衝突します。Mermaid を loose 設定のまま、SVG をそのまま挿入しています。退役予定のリーダーに機能を足すことにもなります。 | 出典バッジは LessonReader 用に作り直します。Mermaid のガードだけ取り込みます（3 章）。`StepsBlock` はこのリポジトリにあります。`FileTreeBlock` は、当面 code ブロックで代用します。 |
| 依存とスクリプトの追加 | `package.json`（`dotenv`、`docs:*` スクリプト）、`package-lock.json` | 依存の追加にはオーナーの承認が要ります。`docs:*` はバージョンを固定しない `npx` を使い、2.3 節の Mintlify 一式のためだけにあります。 | 持ち込みません。 |

### 2.2 文書とエージェント用の設定

| 対象 | 個人側のファイル（コミット） | 持ち込まない理由 | 代わりにすること |
|---|---|---|---|
| エージェント用のルールとスキル | `.agents/AGENTS.md`、`.agents/skills/curriculum_builder/`、`.agents/skills/mintlify_curriculum/`、`skills/curriculum_builder/SKILL.md`、`learnings.md`、個人側の `AGENTS.md`（1c7f5dc, 7c0786e, ca07948, fa2248e, efa7875 ほか） | 存在しない仕様書（SPEC-004）を参照しています。人に確認しない運用や admin プロファイルでの実行など、このリポジトリのルールと食い違う指示を含みます。 | 有用なルールだけを `author-lesson` の参照文書に取り込みます（3 章）。 |
| 生成まわりの設計書 | `doc/system_design/curriculum_generation_harness_spec.md`、`doc/system_design/curriculum_generation_mcp_spec.md`、`doc/system_design/agentic_generation_architecture.md` の変更（fa2248e, 1c7f5dc） | 2.1 節で持ち込まないとした実装を前提にした設計です。MCP の仕様書には、手元の絶対パスが入っています。 | 必要な設計判断だけを `PLAN.ja.md` に書き足します。 |

### 2.3 Mintlify 連携

| 対象 | 個人側のファイル（コミット） | 持ち込まない理由 | 代わりにすること |
|---|---|---|---|
| Mintlify のサイト、MCP パッケージ、DB 同期 | `docs/`（サイト設定、MDX の講座、画像、動画、音声）、`packages/mintlify-curriculum-mcp/`、`scripts/sync-mintlify-to-db.mjs`、`specs/SPEC-005-mintlify-curriculum-integration.md`、`doc/system_design/mintlify_curriculum_integration_spec.md`（efa7875 と 2026-10-01 の関連コミット） | MDX を正本にすると、`risepath.lesson/v1` を唯一の教材形式にする方針と衝突します。同期スクリプトには次の問題があります。<br>・ID の先頭 6 バイトから UUID を作るので、別のコースを上書きすることがある<br>・下書きを経ずに `published` として DB に書き込む<br>・失敗しても終了コード 0 で終わる<br>MCP パッケージにも、入力の検証が足りない箇所があります。動画と音声（約 9.6MB）はどこからも参照されておらず、クレジット表記もありません。 | MCP 自律エージェント講座の中身は、`/author-lesson` で `risepath.lesson/v1` の下書きとして書き直します。 |

### 2.4 講座と素材

| 対象 | 個人側のファイル（コミット） | 持ち込まない理由 | 代わりにすること |
|---|---|---|---|
| Antigravity 業務講座の専用ビューとルート | `components/features/antigravity_biz/`、`data/curricula/antigravity_biz/`、`App.tsx`・`components/routes/lazyRoutes.tsx`・`components/features/dashboard/LearningHub.tsx` の関連変更（fa2248e, c0a9492） | LessonReader と `course.json` で置き換えられます。ルートの二重定義と、アクセシビリティの問題があります。 | 中身を `risepath.lesson/v1` の下書きとして作り直します。公開するかはオーナーが判断します。 |
| Antigravity のスクリーンショットと動画 | `public/materials/antigravity_*`（fa2248e） | アカウント、会話のタイトル、プロジェクト名、手元のパスなどの個人情報が写っています。個人リポジトリからも削除します。 | 持ち込みません。講座に画面が必要なら、検証用のアカウントで撮り直します。 |
| スターターパック | `public/downloads/antigravity-starter/`、`public/downloads/antigravity-starter-pack.zip`（fa2248e） | バージョンを固定しない個人スコープのパッケージを、`npx` で実行させます。テスト用のサーバーに、検索用のような名前が付いています。 | 講座を作り直すときに、必要なら設計し直します。 |

### 2.5 運用・検証用のスクリプト

| 対象 | 個人側のファイル（コミット） | 持ち込まない理由 | 代わりにすること |
|---|---|---|---|
| DB を書き換える検証・生成スクリプト | `scripts/verify_bugfixes.js`、`scripts/verify_fatigue_adaptation.js`、`scripts/verify_personalization_sort.js`、`scripts/verify_rag_citations.js`、`scripts/test_get_draft.js`、`scripts/assign_curriculum_to_user.js`、`scripts/generate_metahuman_curriculum.js`（1c7f5dc, 7c0786e, c0761fe, f85dc2a, ca07948） | 実在しうるユーザー ID を直接書いています。接続先の DB の行を書き換えたり削除したりします。結果にかかわらず終了コード 0 で終わり、実際のコードではなく複製したロジックを確かめています。 | 確かめたい振る舞いは、`server/tests/` の `node:test` として書きます。 |
| DB を読むだけの調査スクリプト | `scripts/check_all_curricula.js`、`scripts/check_saved_curriculum.js`、`scripts/find_recent_user.js`、`scripts/inspect_curricula_schema.js`（1c7f5dc） | その場の調査用です。このリポジトリにない `dotenv` に依存し、`.env.local` の DB を直接読みます。 | 必要になったら、`npm run db:migrate:status` などの既存のスクリプトに機能を足します。 |
| MCP スキーマの書き出し | `scripts/export_mcp_schemas.js`（fa2248e） | 手元の絶対パスが入っています。 | `npm run lessons:schema` など、既存の生成スクリプトに合わせて作り直します。 |

---

## 3. 作り直して取り込むもの（コードは持ち込まない）

| 発想 | 個人側の出どころ | このリポジトリでの作り方 |
|---|---|---|
| 出典を学習者に見せる | `CitationBadge`（7c0786e） | スキーマにある `sources` と `cite` を LessonReader に表示します。ブロックごとのチップと、レッスン末の出典一覧です。 |
| 検索結果に出典情報を付ける | `ragSearch.js` の `source_title`（7c0786e） | `rag-search` が、引用に使える形の結果を返すようにします。 |
| 下書きの読み戻し | `get-curriculum-draft`（1c7f5dc） | DB だけを読み、所有者を確かめるツールとして作ります。 |
| 生成カリキュラムの一覧・詳細の認証 | `services/curriculumApi.ts`（1c7f5dc） | `/curricula` の一覧と詳細も `apiFetch` で呼びます。一覧では `total_lessons` も返します。 |
| Mermaid のガード | `GeneratedDocView.tsx`（d7a29b7） | `chart` がないブロックでは `code` を使い、どちらもなければ描画しません。 |
| Markdown での書き出し（Dual Export） | `exportCurriculumToMarkdown`（fa2248e） | `risepath.lesson/v1` から Markdown を作る純関数と CLI にします。 |
| DB 停止中もオーサリングを続ける（Local-First） | `saveToLocal` / `tryLoadLocal`（fa2248e） | レッスンストアで、接続系のエラーのときだけファイルに退避します。SSE と本番では退避しません。 |
| 初心者向けの執筆ルール | `.agents/skills/`、`learnings.md` | 次のルールを `author-lesson` の参照文書に追記します。<br>・RAG を先に引く<br>・資料にないことは書かない<br>・UI の操作手順を捏造しない<br>・例えを先に出す |
| 1 章目は動機と全体像から | ca07948 | コースの最初のレッスンを確かめる lint ルール（advisory）にします。 |
| 体調への配慮 | f85dc2a | 同意制（既定はオフ）にします。今日と昨日の記録だけを見て、本文は変えずにバナーで伝えます。 |

## 4. そのまま取り込んでよいもの

| 対象 | 個人側のファイル（コミット） | メモ |
|---|---|---|
| サブアプリの環境変数の雛形 | `ai-personal-insights-pro/.env.example`（280e982） | キー名だけの雛形です。値は含みません。 |
