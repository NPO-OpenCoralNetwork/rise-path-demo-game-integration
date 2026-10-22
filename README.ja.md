<div align="center">
<img width="1200" height="400" alt="Rise Path Banner" src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=1200" style="border-radius: 20px;" />

# Rise Path ラーニングプラットフォーム
### 次世代の没入型学習エクスペリエンス

[English](README.md) | **日本語**
</div>

<br/>

**Rise Path（ライズパス）** は、エンジニアリング、クリエイティビティ、そして言語の学習方法に革命を起こすために設計された、モダンで実験的な学習プラットフォームです。従来のLMS（学習管理システム）とは異なり、Rise Pathは「Vibe（雰囲気）」— すなわち、没入感、フロー、そしてストーリー主導の教育に焦点を当てています。

---

## 🌟 主な機能

### 1. **AIを活用したパーソナライズカリキュラム** ✨
あなたのためだけにパーソナライズされた学習を体験できます。
- **Big5パーソナリティ統合**: AIがユーザーの性格特性（Big5）に基づいて、カリキュラムのトーンや学習スタイルを動的に調整します。
- **リッチなコンテンツ生成**: 単なる要約を超え、「なぜ重要なのか」「主要コンセプト」「アクションステップ」「たとえ話」を豊富に提供します。
- **AIモデル**: サーバー側の LLM ゲートウェイ（`server/llm/`）経由で Claude を使います。AI先生、作文フィードバック、コース生成は、既定で安価な Claude モデル（Claude Haiku）で動きます。Gemini は `GEMINI_ALLOWED=true` のときだけ使います（下記参照）。
- **RAG (検索拡張生成)**: Blenderドキュメントなどの特定のナレッジソースと連携し、AIの回答の正確性を高めます。

### 2. **没入型のオーディオ体験（開発中）** 🎧
- **Kokoro TTS**: ONNXを用いたローカル音声合成（[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)）を搭載（従来のgTTSやGemini Native TTSから移行）。
- **キャラクターボイス**: AIチューターのペルソナ（Rise Path / Lumina）に応じた日本語・英語のボイス（`jf_alpha`, `af_bella`など）を選択可能。

### 3. **P-School: ブロックプログラミングバトル** ⚔️
- **ゲーム化されたコーディング**: Scratchスタイルのビジュアルブロックを使用し、モンスターと戦いながらプログラミングのロジックを学びます。
- **Phaser 3 エンジン**: Reactアプリケーションに直接統合された、リアルタイム2D RPGバトル。
- **段階的な難易度**: ループ、変数、関数、条件分岐などを学ぶ20以上のステージを用意。

### 4. **多様な学習パス（Path）** 🗺️
- **Vibe Coding Path**: SFの世界観を舞台に、プロンプトエンジニアリングやGitなどの実践的なスキルをストーリー主導で学びます。
- **Dev Campus**: Webの基本（React / TypeScript）から生成AIアプリケーション開発まで。
- **3D Creative Lab**: Blender 3Dモデリングとスカルプト。
- **Art Atelier**: 美術史とデザイン哲学。
- **Global Communication**: グローバルエンジニアのための英語。

### 5. **MCP（Model Context Protocol）サーバー連携** 🔌
Claude Code や Cursor など、自分のパソコンで動く AI から、Rise Path のツールを使えます。
- **9つのMCPツール**: 学習進捗の取得、ジャーナル記録、カリキュラム生成、RAG検索など。
- **トランスポート**: stdio（ローカル）。SSE は開発のときと、VM の中（Hermes や、Tailscale 経由の運用者）だけで使います。インターネットには公開しません。
- **リモートの AI（ChatGPT、Claude.ai など）**: 学習者ごとの OAuth ができてから（Phase 1）つなげます。ブリッジトークン（`RISE_PATH_BRIDGE_TOKEN`）を外部のサービスに渡さないでください。

> 📘 **[詳細な使い方ガイド](doc/guides/usage_guide.md)** — Webアプリ、MCP、カリキュラム作成の完全なガイドブック（日本語/英語）

---

## 📖 教材：リーダー・形式・制作

### レッスンリーダー
- すべてのレッスンは 1 つのリーダー **`/learn/:course/:lesson`**（例: `/learn/vibe-coding/vibe-ch1`）で開きます。左に目次、余白に AI先生と用語集、読みながら答える確認問題、最後に復習カードとふりかえりがあります。進み具合はレッスンごとに保存され、ダッシュボードの「続きから」で再開できます。
- スマートフォンでは、目次・AI先生・練習が画面下のバーに移ります。**Aa** メニューで文字サイズ、行間、テーマ、UD 書体、集中モードを切り替えられます。
- 開発ビルドでは **`/preview/:course/:lesson`**（下書きを優先し、検証結果を表示）と **`/dev/blocks?dev=1`**（全ブロックの見本）も使えます。

### 教材の形式（`risepath.lesson/v1`）
- レッスンは JSON ファイルです: `content/courses/<slug>/course.json` と `lessons/<id>.lesson.json`。下書きは `drafts/` に置き、プレビューにだけ表示されます。
- 定義は `shared/lesson/schema.js`（zod）の 1 か所だけで、リーダー・サーバー・MCP ツール・CLI が共通で使います。JSON Schema は `content/schema/` に書き出します。
- 1 つのレッスンは、Bloom のレベル付きの目標 2〜4 個と、役割（導入 → 説明 → 例題 → 演習 → 確認 → まとめ）を持つセクションでできています。ブロックは 15 種類（本文、コールアウト、表、コード、プロンプト、Mermaid の図、確認問題、復習カード、手順 など）です。

```bash
npm run lessons:catalog                       # コースとレッスンの一覧と状態
npm run lessons:validate                      # 形式と意味のチェック（エラーは JSON パス付き）
npm run lessons:lint -- <file> --strict       # 教え方と読みやすさのチェック
npm run lessons:preview -- vibe-coding vibe-ch1   # スクリーンショットと metrics.json（開発サーバー起動中）
```

### Claude Code やほかの AI で教材をつくる
- **Claude Code**: `/author-lesson <course> <lesson-id> "<依頼>"` で、brief → アウトライン → 下書き → 検証・lint → 独立レビュー（`pedagogy-reviewer`、`ja-editor`）→ スクリーンショットと `visual-qa` → レポート、までを進めます。書くのは下書きだけで、公開はオーナーが決めます。`/review-lesson <file>` で、どのレッスンも `content/schema/rubric.v1.json` に沿って採点できます。
- **MCP**: `.mcp.json` に MCP サーバー `rise-path-learning`（`curriculum-builder` プロファイル）を登録しています（`lesson-schema-get`、`lesson-validate`、`lesson-get`、`lesson-upsert-draft`、`lesson-preview-url`）。Codex、Cursor、Gemini CLI、Claude Desktop、ChatGPT からも同じツールを使えます。共通のルールは `AGENTS.md` にあります。
- 手順書: **[doc/guides/authoring-with-claude-code.ja.md](doc/guides/authoring-with-claude-code.ja.md)**

---

## 🛠 技術スタック

- **フロントエンド**: [React](https://react.dev/) (v19) + [Vite](https://vitejs.dev/)
- **言語**: [TypeScript](https://www.typescriptlang.org/)
- **AI/LLM**: サーバーのゲートウェイから [Claude API](https://platform.claude.com/)（`@anthropic-ai/sdk`）。Gemini（`@google/genai`）は `GEMINI_ALLOWED=true` の環境だけ
- **ゲームエンジン**: [Phaser 3](https://phaser.io/) (v3.80)
- **ビジュアルコーディング**: [Blockly](https://developers.google.com/blockly) / Scratch Blocks
- **バックエンド/サーバー**: 音声合成やAPIプロキシ用の Node.js (Express)
- **スタイリング**: [Tailwind CSS](https://tailwindcss.com/)

---

## 🚀 開発者のためのクイックスタート

### 簡易起動（フロントエンドUIのみ）
バックエンドサーバーを起動せず、フロントエンドのUIのみを試す場合は以下を実行してください。

```bash
npm install
npm run dev
# フロントエンドURL: http://localhost:3007
```

ほとんどの画面はキーなしで見られます。レッスン内のAI先生、作文フィードバック、コース生成は、サーバーの LLM ゲートウェイを通して Claude で動きます（`ANTHROPIC_API_KEY`。開発中にキーがなければモックが答えます）。ブラウザから直接モデルの API を呼ぶことはありません。共有の Hermes とのチャット（画面に浮かぶ AI コーチと `/life-journal/chat`）は学習者には提供しません。自分で運用するときや開発のときだけ、`VITE_FEATURE_AGENT_CHAT=true` にして Hermes を起動すると出ます。

### 🏁 起動モードの選択

開発者の目的に応じて、2つの起動方法が用意されています。

```mermaid
flowchart TD
    Start["🚀 開発開始"] --> Choice{"どの機能を確認しますか？"}
    Choice -->|UIデザインやゲーム画面のみ| Quick["① 簡易起動 (UIのみ)<br>キー不要で即時チェック可能"]
    Choice -->|AI先生やフル機能| Full["② フル機能起動<br>ANTHROPIC_API_KEY（または開発用モック）"]
    
    Quick --> ExecQuick["1. npm install<br>2. npm run dev"]
    Full --> ExecFull["1. .env.local を作成<br>2. ANTHROPIC_API_KEY を設定<br>3. npm run dev"]

    style Quick fill:#3B82F6,color:#fff
    style Full fill:#10B981,color:#fff
```

---

### 📋 前提条件

| 必須環境 | 推奨バージョン | 備考 |
|---|---|---|
| **Node.js** | `v20.0.0` 以上 | 開発・ビルドに必須 |
| **npm** | `v10.0.0` 以上 | パッケージ管理に使用 |
| **ローカルLLM (Hermes)** | 任意 | 共有の Hermes チャットを試すときだけ（自分で運用・開発。`VITE_FEATURE_AGENT_CHAT=true` と一緒に） |

---

### ⚙️ 環境変数の設定 (`.env.local`)

プロジェクトのルートに [**`.env.local`**](.env.local) ファイルを作成し、必要な設定を記述します。

| 環境変数名 | デフォルト設定値 | 役割・説明 | 必須度 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | (未設定でOK) | LLM ゲートウェイ用のサーバー側キー（AI先生、作文フィードバック、コース生成）。未設定なら開発中はモックが答えます | **推奨** (アプリ内の AI) |
| `VITE_FEATURE_AGENT_CHAT` | (未設定 = オフ) | ちょうど `true` のときだけ、共有の Hermes チャット（AI コーチ、`/life-journal/chat`）を出し、API も `/api/v2/agent/chat` に答えます。学習者には提供しません | 任意（自分で運用・開発） |
| `HERMES_API_URL` | `http://127.0.0.1:8642` | ローカルLLMプロキシ（Hermes）の接続先URL | 任意（`VITE_FEATURE_AGENT_CHAT=true` のとき） |
| `HERMES_API_KEY` | `change-me-local-dev` | HermesのBearerトークン認証キー | 任意（`VITE_FEATURE_AGENT_CHAT=true` のとき） |
| `GEMINI_ALLOWED` | (未設定 = オフ) | `true` のときだけ Gemini を使います。18歳未満の人が使えない環境専用です（下記参照） | 任意 |
| `GEMINI_API_KEY` | (未設定でOK) | サーバー側の Gemini キー（ゲートウェイ、RAG の埋め込み、画像生成）。`GEMINI_ALLOWED=true` のときだけ使います | 任意 |

```env
# LLM ゲートウェイのキー（サーバー専用）
# ANTHROPIC_API_KEY=
# GEMINI_ALLOWED と GEMINI_API_KEY は、18歳未満の人が使えない環境でだけ設定します
# GEMINI_API_KEY=

# 任意（自分で運用・開発のときだけ）: 共有の Hermes チャット
# VITE_FEATURE_AGENT_CHAT=true
# HERMES_API_URL=http://127.0.0.1:8642
# HERMES_API_KEY=change-me-local-dev
```

> [!WARNING]
> **セキュリティの注意点**:
> `.env.local` には本物のAPIキーが含まれる場合があるため、絶対にGitにコミットしないでください（すでに `.gitignore` で除外されています）。

### 🤖 LLM ゲートウェイ（`/api/v2/llm`）

モデルの呼び出しはすべて `server/llm/` のゲートウェイを通り、ブラウザはモデルのキーを持ちません。**キーを `VITE_*` 変数に入れないでください**（`VITE_*` の値はすべてブラウザに配信されます）。モデル ID は `server/llm/models.config.js` にだけ書きます。キーが 1 つもない場合、本番以外では内蔵のモックが応答します（本番では `LLM_PROVIDER=mock` でない限り 503 を返します）。

| 環境変数 | 役割 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic を有効にします（すべてのタスクの既定） |
| `GEMINI_ALLOWED` | ちょうど `true` のときだけ Gemini（チャット、RAG の埋め込み、画像生成）を使います。未設定やそれ以外の値ではオフです。Gemini のキーがあってもオフのままで、サーバーが警告を出します。18歳未満の人が使えない環境専用です |
| `GEMINI_API_KEY`（または `GOOGLE_API_KEY`） | `GEMINI_ALLOWED=true` のとき、Gemini、RAG の埋め込み、画像生成を有効にします |
| `LLM_PROVIDER` | すべてのタスクを 1 つのプロバイダーに固定します: `anthropic`、`gemini`、`mock` |
| `LLM_TASK_<TASK>` | タスクごとの振り分け `provider[:model]`。例: `LLM_TASK_TUTOR_CHAT=anthropic:claude-sonnet-5-5` |
| `LLM_MOCK_FALLBACK` | `false` で、キーがないときのモックへの切り替えを止める |
| `LLM_TIMEOUT_MS` | リクエストのタイムアウト（既定 120000） |
| `LLM_MAX_RETRIES` | プロバイダー呼び出しの再試行回数 |
| `LLM_ANTHROPIC_SERVER_FALLBACKS` | `false` で Anthropic のサーバー側モデルフォールバックを止める |
| `ANTHROPIC_BASE_URL` | Anthropic の別エンドポイント（プロキシなど） |

`GET /api/v2/llm/status` で、有効なプロバイダーとタスクの振り分けを（秘密情報なしで）確認できます。

**既定のモデル。** AI先生（`tutor.chat`）、作文フィードバック（`writing.feedback`）、コース生成（`course.generate`、`/api/v2/ai/generate`）は、既定で安価な Claude モデル（Claude Haiku）で動きます。1 日の上限（`server/middleware/dailyCaps.js`）もそのまま効きます。大きいモデルに戻したいタスクは、たとえば `LLM_TASK_TUTOR_CHAT=anthropic:claude-sonnet-5-5` のように設定します（`LLM_TASK_WRITING_FEEDBACK`、`LLM_TASK_COURSE_GENERATE` も同じ書き方です）。

**Gemini が既定でオフの理由。** [Gemini API 追加利用規約](https://ai.google.dev/gemini-api/terms)は、「18歳未満の人に向けた、または18歳未満の人が使う可能性が高い」サービスで API を使うことを禁じています。Rise Path は未成年も使うため、Gemini は `GEMINI_ALLOWED=true` のときだけ使います。オフのあいだ、アップロードした資料はベクトルなしで保存され、キーワード検索で見つかります（Gemini を許可したあとで `node scripts/rag/reembed.mjs` を実行すると埋め込みを作れます）。`/api/v2/image` は 503（`error_type: image_generation_unavailable`）を返します。

---

### 🚀 セットアップ手順

#### 1. リポジトリのクローン
```bash
git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git
cd rise-path-demo-game-integration
```

#### 2. パッケージのインストール
```bash
npm install
```

#### 3. 開発サーバーの起動
```bash
npm run dev
```
起動完了後、ブラウザで [**`http://localhost:3007`**](http://localhost:3007) にアクセスすると、ゲームのプレイおよび学習UIの確認が可能です。

#### 4. プルリクエスト前のチェック（CI）
GitHub Actions（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）が、すべてのプルリクエストと `main` への push で次のコマンドを実行します。
```bash
npm run typecheck
npm test
npm run lessons:validate
npm run lessons:lint -- --strict
npm run lessons:schema -- --check
node .claude/skills/author-lesson/scripts/build-references.mjs --check
```
さらに、モデルやサービスのキーにダミー値を入れて本番ビルド（`npm run build:prod`）を実行し、その値がビルド結果に含まれていれば失敗します。


---

## ⚖️ ライセンス (License)

本プロジェクトは **Apache License, Version 2.0** に基づいてライセンスされています。商用利用、改変、再配布が許諾されていますが、著作権表示および免責事項の保持が必要です。

詳細については [LICENSE](LICENSE) ファイルを参照してください。

Copyright 2026 Naoya Kusunoki / Coral Network
