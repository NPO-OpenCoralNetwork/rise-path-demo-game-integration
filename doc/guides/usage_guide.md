<div align="center">

# 📘 Rise Path — 使い方ガイド

**AI パーソナライズ学習プラットフォーム**

</div>

---

## 目次

1. [Rise Path とは？](#rise-path-とは)
2. [3つの使い方](#3つの使い方)
3. [Web アプリで学ぶ](#-web-アプリで学ぶ)
4. [MCP で AI と学ぶ](#-mcp-で-ai-と学ぶ)
5. [カリキュラムを作る](#-カリキュラムを作る)
6. [MCP ツール一覧](#-mcp-ツール一覧)
7. [セットアップ](#-セットアップ)
8. [FAQ](#-faq)

---

## Rise Path とは？

Rise Path は **「自分だけの学習体験」** を AI が設計・伴走するプラットフォームです。

従来の LMS（学習管理システム）との違い：

| 従来の LMS | Rise Path |
|-----------|-----------|
| 全員同じカリキュラム | AI があなた専用のカリキュラムを生成 |
| テキストを読むだけ | ゲーム・音声・対話で没入体験 |
| 進捗は自己管理 | ジャーナルと AI コーチが伴走 |
| ブラウザだけ | ChatGPT / Claude / Cursor からも操作可能 |

---

## 3つの使い方

Rise Path は **3つのモード** で利用できます。目的に合わせて選んでください。

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  🌐 Web アプリ     → ブラウザで学習コンテンツを体験     │
│                                                          │
│  🤖 MCP + AI      → ChatGPT や Claude と対話しながら学ぶ │
│                                                          │
│  🔧 API / 開発    → 独自アプリから学習データを操作       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🌐 Web アプリで学ぶ

### 起動

```bash
npm install
npm run dev
# → http://localhost:3007
```

### 学習パス一覧

| パス名 | 内容 | ステージ数 |
|--------|------|-----------|
| 🎮 **P-School** | ブロックプログラミング×RPGバトル | 8 |
| 🚀 **Vibe Coding** | SF 世界観で学ぶプロンプトエンジニアリング | 12 |
| 🎨 **Art Atelier** | 美術史とデザイン哲学 | 15 |
| 🧊 **Blender 3D** | 3D モデリング入門 | 5 |
| 🌐 **Web Dev** | HTML / CSS / Web Inspector | 8 |
| 🐍 **AI & Python** | Python と生成 AI | 10 |
| 🔊 **Sonic Lab** | サウンドデザイン | 6 |

### 画面の流れ

```
ダッシュボード → 学習パス選択 → ステージ選択 → レッスン → 振り返り(ジャーナル)
```

---

## 🤖 MCP で AI と学ぶ

**MCP (Model Context Protocol)** を使うと、ChatGPT・Claude・Cursor などの AI アシスタントが Rise Path のデータに直接アクセスできます。

### 何ができるの？

AI に自然言語で話しかけるだけで：

> 💬 「Blender の学習進捗を教えて」
> → AI が `learner-state-get` を呼び出し、あなたの進捗を表示

> 💬 「今日の学習を振り返りたい」
> → AI が `journal-log` で振り返りを記録

> 💬 「React を3週間で学ぶカリキュラムを作って」
> → AI が `get-generation-kit` → `validate-intake` → `save-curriculum-draft` の3ステップで専用カリキュラムを生成・保存

### 対応クライアント

| クライアント | 接続方式 | 設定方法 |
|-------------|---------|---------|
| **Claude Desktop** | stdio | `claude_desktop_config.json` に追記 |
| **Cursor** | stdio | Settings → MCP Servers |
| **Antigravity** | stdio | `mcp_config.json` に追記 |
| **ChatGPT** | SSE (HTTP) | Settings → Apps & Connectors |

### 設定例（Claude Desktop / Cursor / Antigravity）

```json
{
  "mcpServers": {
    "rise-path-learning": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/path/to/rise-path-demo-game-Integration-/mcp-server/index.js"
      ],
      "env": {
        "DATABASE_URL_PHASE1": "postgresql://...",
        "NODE_ENV": "development"
      }
    }
  }
}
```

### 設定例（ChatGPT — SSE モード）

```bash
# MCP サーバーを SSE モードで起動
node mcp-server/index.js --sse 3100

# 外部公開（ngrok）
ngrok http 3100
```

ChatGPT の Settings → Apps & Connectors で：
- **URL**: `https://xxxx.ngrok.io/sse`
- **Auth**: Bearer Token（`.env` の `RISE_PATH_BRIDGE_TOKEN`）

---

## 🎓 カリキュラムを作る

AI にカリキュラムを作ってもらう3ステップ：

### Step 1: テンプレートを取得

```
💬 「カリキュラム生成に必要なルールを取得して」
```

AI が `get-generation-kit` を呼び、以下を取得します：
- 必須フィールド（`goal`, `target_audience`, `duration_weeks` 等）
- 出力スキーマ（モジュール / レッスンの構造）
- 品質ルール（最低セクション数、practice 必須 等）

### Step 2: 学習要件を伝える

```
💬 「3DCG初心者が4週間でBlenderの基礎を学ぶカリキュラムを作りたい。
     平日は1日30分まで。ハンズオン重視で」
```

AI が `validate-intake` で要件を検証し、不足があれば聞き返します。

### Step 3: カリキュラム生成 → 保存

```
💬 「このまま作成して」
```

AI がカリキュラム JSON を生成し、`save-curriculum-draft` で DB に保存。
品質チェック（`quality_warnings`）も自動実行されます。

```
✅ 作成完了！

タイトル: Blender 3D 入門 — 4週間で初めての3Dモデル
モジュール: 4
レッスン: 8
ステータス: draft
```

---

## 🔧 MCP ツール一覧

### 学習進捗

| ツール | 説明 | 主な用途 |
|--------|------|---------|
| `learner-state-get` | 進捗・マスタリーレベルを取得 | 「今どこまで進んだ？」 |
| `learner-state-update` | レッスン完了を記録 | 「このレッスン終わった」 |

#### 使用例

```
入力: learner-state-get(domain: "blender-3d")

出力:
{
  "domain": "blender-3d",
  "stage": 0,
  "mastery": 0,
  "completed_steps": {
    "blender-3d": ["intro-viewport"]
  }
}
```

---

### 学習ジャーナル

| ツール | 説明 | 主な用途 |
|--------|------|---------|
| `journal-log` | 振り返りを記録 | 「今日学んだことを記録して」 |
| `journal-recent` | 直近の記録を取得 | 「最近の振り返りを見せて」 |
| `journal-summary` | 集計データ | 「今月の学習統計は？」 |

#### 使用例

```
入力: journal-log(
  curriculum_id: "...",
  module_id: "m1",
  lesson_id: "m1-l1",
  learned: "ビューポートの操作方法を理解した",
  mood: "great",
  confidence: 4,
  time_spent_min: 30
)

出力: { "status": "saved", "entry_id": "..." }
```

---

### コンテンツ検索

| ツール | 説明 | 主な用途 |
|--------|------|---------|
| `rag-search` | 教材をベクトル/キーワード検索 | 「ループについて教えて」 |

> **Note**: pgvector + Gemini Embedding を使ったセマンティック検索が可能。
> Gemini API Key が未設定の場合はキーワード検索にフォールバックします。

---

### カリキュラム生成

| ツール | 説明 | 主な用途 |
|--------|------|---------|
| `get-generation-kit` | テンプレート・ルール取得 | 生成準備 |
| `validate-intake` | 学習要件のバリデーション | 要件チェック |
| `save-curriculum-draft` | カリキュラムの検証・保存 | DB 保存 |

#### 生成フロー図

```
get-generation-kit     validate-intake     save-curriculum-draft
      │                      │                      │
      ▼                      ▼                      ▼
  ┌─────────┐          ┌──────────┐          ┌──────────────┐
  │テンプレート│   →    │  要件検証  │   →    │ 構造検証+保存  │
  │ スキーマ  │         │ 正規化    │         │ 品質チェック  │
  │ ルール    │         │ 推奨事項  │         │ ロードマップ  │
  └─────────┘          └──────────┘          └──────────────┘
```

---

### リソース

| リソース URI | 説明 |
|-------------|------|
| `content://domains` | 利用可能な学習ドメイン一覧 |
| `learner://profile/{user_id}` | 学習者プロフィール（Big5 診断結果等） |

---

## 🛠 セットアップ

### 前提条件

- **Node.js** v20 以上
- **PostgreSQL** — データ DB は専用 VM **`risepath-vm`** / DB 名 `risepath`（**Supabase は Auth のみ**）

### 1. クローン & インストール

```bash
git clone https://github.com/t012093/rise-path-demo-game-Integration-.git
cd rise-path-demo-game-Integration-
npm install
```

### 2. 環境変数

`.env.local` を作成（テンプレ: `env.local.template`、手順: [`env_local_setup_issue15.md`](./env_local_setup_issue15.md)）：

```env
# --- Supabase Auth（必須 — データ DB には使わない）---
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# --- データ DB（risepath-vm 推奨）---
DATABASE_URL_PHASE1=postgresql://risepath_app:***@risepath-vm:5432/risepath?sslmode=disable

# --- Hermes Agent（オプション）---
HERMES_API_URL=http://risepath-vm:8642
HERMES_API_KEY=change-me-local-dev

# --- MCP 外部接続用（オプション）---
RISE_PATH_BRIDGE_TOKEN=your_random_64char_hex

VITE_DEMO_MODE=false
VITE_API_ENABLED=true
```

### 3. データベースマイグレーション

データ DB は **専用 VM `risepath-vm` の Postgres `risepath`**（Docker Compose。Supabase Auth は別）。詳細: [`risepath_vm_deployment.md`](./risepath_vm_deployment.md)

```bash
# .env.local に DATABASE_URL_PHASE1 を設定後
npm run db:migrate:status
npm run db:migrate
```

正本: `server/migrations/README.md`

### 4. 起動

```bash
# Web アプリ
npm run dev

# MCP サーバー（stdio — Claude Desktop / Cursor 用）
node mcp-server/index.js

# MCP サーバー（SSE — ChatGPT / Remote 用）
node mcp-server/index.js --sse 3100
```

### 5. ヘルスチェック（SSE モード時）

```bash
curl http://localhost:3100/health
# → {"status":"ok","version":"2.0.0","db":"connected",...}
```

---

## ❓ FAQ

### Q: AI 機能を使わずに触れますか？

**A**: はい。`npm run dev` で Web アプリが起動し、ほとんどの画面は API キーなしで閲覧できます。AI 生成機能を使う場合のみ Gemini API Key が必要です。

### Q: MCP って何ですか？

**A**: [Model Context Protocol](https://modelcontextprotocol.io/) — AI アシスタントが外部ツールやデータにアクセスするための標準プロトコルです。Rise Path は MCP サーバーを提供しており、ChatGPT・Claude・Cursor から直接学習データを操作できます。

### Q: どの AI クライアントが一番おすすめですか？

**A**: ローカル開発なら **Claude Desktop**（stdio で最も安定）、外部接続なら **ChatGPT**（SSE モード）がおすすめです。

### Q: カリキュラムのカスタマイズはどこまでできますか？

**A**: 以下を自由に指定できます：
- 学習目標 / 対象者 / 現在のレベル
- 期間（週数）/ 1日の学習時間制約
- 学習スタイル（hands-on / lecture / project）
- 学習モード（credential / practice / gentle）

### Q: データはどこに保存されますか？

**A**: PostgreSQL（Supabase）に保存されます。テーブル構成：

| テーブル | 内容 |
|---------|------|
| `user_progress` | 学習進捗（完了ステージ / ステップ） |
| `learning_journal` | 振り返りジャーナル |
| `curricula` | 生成されたカリキュラム |
| `material_chunks` | RAG 用の教材チャンク（pgvector） |
| `learner_profiles` | Big5 診断結果 |

---

<div align="center">
  <sub>Built with ❤️ by the Rise Path Team</sub>
</div>
