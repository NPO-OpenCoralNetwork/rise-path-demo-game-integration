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

> 💬 「バイブコーディングの第1章を一緒に進めたい」
> → AI が `course-lesson-get` でレッスンを読み（答えはふくまない）、あなたが選んだ答えを `course-quiz-check` で確かめる

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
| **Claude Code・Codex・Claude.ai・Cursor・VS Code・Hermes・ChatGPT（リモート接続、18 歳以上）** | Streamable HTTP + OAuth | `https://mcp.<domain>/mcp` を追加してサインイン（下の「自分の AI をつなぐ（リモート MCP）」） |

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

### 自分の AI をつなぐ（リモート MCP、18 歳以上）

運営者が公開しているとき（`deploy/risepath-vm` のプロファイル `byoa`）は、自分の AI アプリを、インターネット越しに Rise Path につなげます。URL は `https://mcp.<domain>/mcp` です（`<domain>` は運営者のドメイン）。

- **18 歳以上の方だけ**が使えます。先に Rise Path で生まれた年と月を登録してください（設定 → AI の利用設定）。18 歳未満の方は、アプリの中の AI チューターを使ってください。
- つなぐと、AI アプリがブラウザで Rise Path の「接続の許可」の画面（`/oauth/consent`）を開きます。Rise Path にサインインし、アプリ名と、アプリが読めるもの・書けるものを確かめてから「許可する」を押します。
- AI アプリが読めるもの: Rise Path のコースのレッスン（クイズの答え・解説・ヒントは除く）、レッスンごとの進み具合（読んだセクション、問題ごとに答えたか・正しかったか、続きの位置）、科目ごとの進み具合、最近の学習ジャーナル、ジャーナルから求めた学習のシグナル、自分でアップロードした教材の検索、科目の一覧、問いかけで導くチューター用のプロンプト、今日の復習カードの問いと、カードが次に出る日（答えは、アプリが求めると渡ります。あなたが答えたあとに見せるよう、アプリに伝えています）。書けるもの: クイズの答え合わせ（確かめるたびに、あなた自身の解答として記録され、取り消せません）、読み終えたセクションと続きの位置、復習カードの結果（「もう一度」か「覚えた」。記録するたびに、あなた自身の結果として残り、取り消せません）、学習ジャーナルへの記録、終えたレッスンの記録。ライフジャーナル、AI メモリ、性格のプロフィール、教材づくりのツールは使えません。
- AI と学んだ記録は、Web のレッスン画面の記録と同じものです。AI アプリで答えた問題は、Web のページを開いたときと、ほかのウィンドウやタブから Rise Path のタブに戻ったときに、答えた状態で出ます。タブに戻ったときに読み直すのは、1 分に 1 回までです。アプリの中でレッスンを移るだけでは、読み直しません。すぐに出ないときは、ページを読み込み直してください。
- AI アプリが Rise Path から読んだ内容は、**そのアプリの AI の会社**（Anthropic や OpenAI など）に送られ、あなたとその会社との契約と規約に従って扱われます。
- 1 日に使える回数に上限があります（呼び出し 300 回、書き込み 50 回。日本時間の 0 時にリセット）。クイズの答え合わせ（`course-quiz-check`）は、呼び出しの 300 回にだけ数えます。復習のカード 1 枚の答えを見る呼び出しと、結果を記録する呼び出し（`course-review-grade`）は、どちらも書き込みの 50 回にも数えます（10 枚なら 20 回）。
- 接続は、設定 → **つないでいる AI アプリ**（`/settings/connected-apps`）でいつでも解除できます。解除すると、そのアプリは数秒以内に使えなくなります。
- 許可したアプリは、Rise Path のアカウントで、あなた自身と同じ操作（パスワードの設定など）ができる場合があります。信頼できるアプリだけを許可してください。
- 決まったトークン（API キーや `Authorization` ヘッダーを手で書く設定）ではつなげません。トークンは 1 時間で切れ、AI アプリが自動で更新するためです。下のどのアプリも、サインイン（OAuth）でつなぎます。

| アプリ | つなぎ方 |
|---|---|
| **Claude Code** | `claude mcp add --transport http rise-path https://mcp.<domain>/mcp` を実行し、Claude Code の中で `/mcp` を開いて rise-path を選び、ブラウザでサインインします（`claude mcp login rise-path` でも可）。出典: <https://code.claude.com/docs/en/mcp> |
| **Claude.ai・Claude Desktop** | Customize → Connectors → **+ Add** → **Add custom connector** で、名前と `https://mcp.<domain>/mcp` を入れて追加し、「Connect」でサインインします。Free プランはカスタムコネクタが 1 つまでです。Team・Enterprise では、組織のオーナーが Organization settings → Connectors で追加し、各自が Connect します。出典: <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp> |
| **Codex** | `~/.codex/config.toml` に次を足し、`codex mcp login rise-path` を実行します（`codex mcp add rise-path --url https://mcp.<domain>/mcp` でも追加できます）。出典: <https://developers.openai.com/codex/mcp> |
| **Cursor** | `~/.cursor/mcp.json`（または `.cursor/mcp.json`）の `mcpServers` に `"rise-path": { "url": "https://mcp.<domain>/mcp" }` を足し、表示に従ってサインインします。出典: <https://cursor.com/docs/context/mcp> |
| **VS Code（Copilot）** | `.vscode/mcp.json`（またはユーザー設定）の `servers` に `"rise-path": { "type": "http", "url": "https://mcp.<domain>/mcp" }` を足します。最初につなぐときにブラウザが開きます。会社の Copilot Business・Enterprise では、管理者が MCP を許可している必要があります。出典: <https://code.visualstudio.com/docs/agents/reference/mcp-configuration> |
| **自分の Hermes** | `~/.hermes/config.yaml` の `mcp_servers` に下の設定を足し、`hermes mcp login rise-path` を実行します。Rise Path は CIMD に対応していないので `cimd: false`（DCR を使う）にします。Rise Path のログインはデバイスフロー（`--flow device`）に対応していないので、ブラウザでサインインできるパソコンで動かします。出典: <https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference> |
| **ChatGPT** | 使えるプランとワークスペースの設定（開発者モード）がある場合だけ、chatgpt.com/plugins でカスタムの MCP サーバーを追加し、URL に `https://mcp.<domain>/mcp` を入れます。使えるプランは変わることがあるので、OpenAI の案内を確かめてください。出典: <https://developers.openai.com/apps-sdk/deploy/connect-chatgpt> |

Codex（`~/.codex/config.toml`）:

```toml
[mcp_servers.rise-path]
url = "https://mcp.<domain>/mcp"
```

Hermes（`~/.hermes/config.yaml`）:

```yaml
mcp_servers:
  rise-path:
    url: "https://mcp.<domain>/mcp"
    auth: oauth
    oauth:
      cimd: false
```

つながらないとき:

- `adults_only` や `age_required` のエラー: Rise Path の設定 → AI の利用設定で、生まれた年と月を登録してください。18 歳未満の方は使えません。
- `daily_limit_reached`: 今日の上限です。`scope` が `user`（あなたの上限）か `global`（Rise Path 全体の上限）なら、日本時間の 0 時にリセットされます。`off` のときは、運営者が接続した AI エージェントの利用を止めています。時間がたってもリセットされません。
- 許可の画面に「このリクエストは期限が切れました」と出る: 接続のリクエストは 10 分間有効です。AI アプリに戻って、接続をやり直してください。
- サインインの画面が出ずに 401 が続く: AI アプリの MCP の設定から、手で書いた `Authorization` ヘッダーを消してください。

運営者向け: 公開の手順は [`byoa-setup.ja.md`](./byoa-setup.ja.md) にあります。次のことは、これまでどおり守ってください。

- `RISE_PATH_BRIDGE_TOKEN`（ブリッジトークン）を、ChatGPT などの外部サービスに入れないでください。このトークンは Hermes と管理者用の MCP サーバーのあいだだけで使う共有の合言葉で、持っている人は誰でも同じ権限で動けてしまいます。
- 管理者用の MCP サーバーのポート（SSE モードの 3100 など）を、ngrok などのトンネルやファイアウォールの開放でインターネットに公開しないでください。インターネットに出すのは、学習者ごとのサインインがある `mcp-public` だけです。
- 自分のパソコンの Claude Desktop・Cursor・Claude Code などから、上の設定例のように stdio でつなぐ使い方は、これまでどおり使えます。

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

### コースのレッスンを学ぶ（course-*）

公開しているコース（今は vibe-coding と claude-code）のレッスンを、AI と一緒に学ぶためのツールです。記録は Web のレッスン画面と同じで、どちらで進めても同じ進み具合になります。使えるのはプロファイル `learner` と `learner-remote`（リモート MCP、18 歳以上）、`admin` です。`coach` は読む 3 つ（`course-list`、`course-lesson-get`、`course-progress-get`）だけです。

| ツール | 説明 | 主な用途 |
|--------|------|---------|
| `course-list` | 公開コースと、モジュール・レッスンの一覧（問題の数、確認テストがあるか） | 「どんなコースがある？」 |
| `course-lesson-get` | レッスンを読む。クイズの答え・解説・ヒントはふくまない。選択肢は "1"〜"n" の番号。`section_id` なしなら目次と、まだ終えていない最初のセクション | 「第1章を始めたい」 |
| `course-quiz-check` | 学習者が選んだ答えをサーバーで確かめ、学習者の解答として記録する（取り消せない）。最初のまちがいでは、ひとこととヒントだけ。正解したとき、2 回まちがえたとき、答えを見る（`reveal`）とき、正解と解説を返す | 「2 番だと思う」 |
| `course-progress-get` | レッスンの進み具合（% と状態、セクションごとの進み、問題ごとの状況、続きの位置。答えはふくまない） | 「どこまで進んだ？」 |
| `course-progress-update` | 取り組んだセクションを読んだと記録し、続きの位置を決める。確認問題が残っているセクションは記録しない（`skipped`） | 「このセクションは終わった」 |

AI アプリへのお願い（ツールの説明にも書いてあります）: 学習者に答えさせ、学習者が選んだ答えだけを送ります。AI が選択肢を選んだり、試しに送ったりしません。呼ぶたびに、学習者の解答として記録されるためです。

#### 使用例

```
入力: course-quiz-check(
  course_slug: "vibe-coding",
  lesson_id: "vibe-ch1",
  question_id: "q1",
  choices: ["1"],
  content_hash: "sha256:…"      ← course-lesson-get が返した値
)

出力（1 回目のまちがい。正解はまだ返さない）:
{
  "outcome": "incorrect",
  "attempts": 1,
  "attempts_left": 1,
  "feedback": [{ "label": "1", "md": "客席はお客さんが直接触れる場所なので、フロントエンドにあたります。…" }],
  "hint": "「注文を受けて、加工する」のはどこでしょう？",
  "pct": 4,
  "state": "in_progress",
  …
}
```

### 復習（course-review-*、リモート MCP だけ）

レッスンの復習カードが、忘れかけたころにもう一度出ます（Phase 6）。Web の「復習」のページと同じ予定と記録で、1 日に 10 枚までです（日本時間の 0 時に変わります）。使えるのはプロファイル `learner-remote`（リモート MCP、18 歳以上）だけです。

| ツール | 説明 | 主な用途 |
|--------|------|---------|
| `course-review-due` | 今日の復習カードを、忘れかけている順に最大 10 枚返す。問いだけで、答えはふくまない。AI アプリへの進め方（`review_protocol`）もつける | 「今日の復習をしたい」 |
| `course-review-grade` | 今日のカード 1 枚について、学習者が答えたあとに答えを見せる（`reveal: true`。何も記録しない）か、学習者が選んだ「もう一度」（`again`）か「覚えた」（`good`）を記録する（取り消せない）。記録すると、答えと次に出る日を返す。期日の来ていないカードと、今日すでに記録したカードは `not_due`、今日の 10 枚を終えたら `review_limit` | 「思い出せた」 |

AI アプリへのお願い（ツールの説明と `review_protocol` にも書いてあります）: 問いを 1 枚ずつ見せ、学習者が自分で答えるのを待ってから答えを見せ、どちらのボタンかを学習者に選んでもらいます。AI が選んだり、学習者が答える前に答えを見せたりしません。復習で XP は増えません。AI アプリでの復習は、学んだ日（連続日数）にも数えません。

### 学習進捗（旧形式の科目）

vibe-coding と claude-code のレッスンには、上の course-* のツールを使います。下の 2 つの記録は、Web のレッスン画面には出ません。

| ツール | 説明 | 主な用途 |
|--------|------|---------|
| `learner-state-get` | 科目ごとの旧形式の進捗・マスタリーレベルを取得 | 「Blender はどこまで進んだ？」 |
| `learner-state-update` | 旧形式の科目に、終えたレッスンを記録 | 「このレッスン終わった」 |

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

> **Note**: 既定ではキーワード検索で動きます。Gemini の埋め込みを使う意味検索（pgvector）は、
> `GEMINI_ALLOWED=true` と `GEMINI_API_KEY` の両方を設定したときだけ有効です。`GEMINI_ALLOWED` は、
> 18 歳未満の人が使えない環境でだけ設定します（Gemini API の利用規約のため）。

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
| `content://domains` | 利用可能な学習ドメイン一覧（コースのあるドメインには `course_slug` が付き、course-* のツールで学ぶ） |
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

# MCP サーバー（SSE — 開発用。自分のマシンの中だけで使い、インターネットに公開しない）
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

**A**: はい。`npm run dev` で Web アプリが起動し、ほとんどの画面は API キーなしで閲覧できます。AI チューターやコース生成などの AI 機能を使う場合だけ、サーバー側に `ANTHROPIC_API_KEY`（Claude の API キー）が必要です。

### Q: MCP って何ですか？

**A**: [Model Context Protocol](https://modelcontextprotocol.io/) — AI アシスタントが外部ツールやデータにアクセスするための標準プロトコルです。Rise Path は MCP サーバーを提供しており、ChatGPT・Claude・Cursor から直接学習データを操作できます。

### Q: どの AI クライアントが一番おすすめですか？

**A**: 教材づくりなど開発の作業には、自分のパソコンから stdio でつなぐ **Claude Desktop**・**Claude Code**・**Cursor** がおすすめです。学習者として自分の記録を使うだけなら、運営者が公開しているリモート MCP（`https://mcp.<domain>/mcp`、18 歳以上）に、Claude Code・Claude.ai・Codex などからサインインしてつなげます（上の「自分の AI をつなぐ（リモート MCP）」）。

### Q: カリキュラムのカスタマイズはどこまでできますか？

**A**: 以下を自由に指定できます：
- 学習目標 / 対象者 / 現在のレベル
- 期間（週数）/ 1日の学習時間制約
- 学習スタイル（hands-on / lecture / project）
- 学習モード（credential / practice / gentle）

### Q: データはどこに保存されますか？

**A**: VM の PostgreSQL（`risepath`）に保存されます（`server/migrations/README.md`）。Supabase は、ログイン（AI アプリの接続の許可もふくむ）と、P-School のプロフィール名とバトル記録に使います（`doc/legal/ai-data-inventory.ja.md`）。主なテーブル：

| テーブル | 内容 |
|---------|------|
| `lesson_progress` | レッスンの進み具合（ログインした人だけ。読んだところ、確認問題の答え、続きの位置）。設定 → プライバシーの「学習の進み具合を消す」で、すべて消せます |
| `user_progress` | 旧形式の学習進捗（完了ステージ / ステップ） |
| `learning_journal` | 振り返りジャーナル |
| `curricula` | 生成されたカリキュラム |
| `material_chunks` | RAG 用の教材チャンク（pgvector） |
| `learner_profiles` | Big5 診断結果 |
| `billing_customers`・`billing_subscriptions`・`billing_events` | 有料のサポータープランのお支払いの記録（Stripe の顧客と契約の ID、契約の状態、Stripe からの知らせの ID）。カードの情報、名前、メールアドレスは持ちません。プランは今は止めています |

### Q: 有料のプランはありますか？

**A**: 「サポータープラン」を作りましたが、今は止めています。運営者が法律と税の確認を終えて始めるまでは、申し込めません（`doc/brushup-2026/ai-access-plan.ja.md` の 7 章）。始めたときの中身は次のとおりです。

- 月額 500 円（税込）です。1 か月ごとに自動で更新します。申し込みのときに初回を払い、そのあとは毎月同じ日（その日がない月は月末）に請求されます。
- 支払いは、Stripe（決済サービス）の画面で行います。カードの番号は、Rise Path には届きません。
- AI の機能を 1 日に使える回数が増えます（次の Q）。
- 18 歳以上で、生まれた年と月を登録した方だけが申し込めます（設定 → AI の利用設定）。
- 申し込み方: 設定 → プラン → 「申し込み内容の確認へ」で、内容をすべて確かめてから「申し込む」を押します。そのあと Stripe の画面で支払うと、申し込みが終わります。
- 売る側の情報と取引の条件は、「特定商取引法に基づく表記」（`/legal/commerce`）にあります。

### Q: AI 機能の 1 日の上限はいくつですか？

**A**: 既定の値は次のとおりです（`server/middleware/dailyCaps.js`、`server/services/billingPlan.js`）。日本時間の 0 時に戻ります。運営者が設定で変えられます。サポータープランを始めたあとは、設定 → プランの「今日の利用」で、今の上限と使った回数を確かめられます。

| 枠 | 無料 | サポータープラン |
|---|---|---|
| AI チューター・作文フィードバック・診断の解説（合わせて） | 1 日 50 回 | 1 日 100 回 |
| コース作成の AI 処理（1 コースでふつう 3 回、修正 1 回ごとに 1 回） | 1 日 20 回 | 1 日 30 回 |

- ほかの機能（自分の AI をつなぐリモート MCP など）の上限は、プランで変わりません。
- 利用が集中したときや障害のときは、上限の前に使えなくなることがあります。Rise Path 全体の 1 日の上限があるためです。

### Q: サポータープランをやめる（解約する）には？

**A**: 設定 → プランの「お支払いと解約」を押すと、Stripe の画面が開きます。そこで解約します。

- 次の更新日より前に解約すると、次回から請求されません。
- 支払いずみの期間の終わりまで、サポータープランの上限を使えます。終わる日は、プランの画面に「終了日」として出ます。
- 日割りの返金はありません。
- カードの変更と、請求の履歴の確認も、同じ画面でできます。
- 支払いを確認できないときは、Stripe が再請求したあと、契約が終わります。そのあいだ、プランの画面に「お支払いを確認できませんでした」と出ます。「お支払いと解約」からカードを更新してください。
- 年齢が 18 歳未満に直されたときも、「お支払いと解約」から解約できます。返金は、運営者にご相談ください。

---

<div align="center">
  <sub>Built with ❤️ by the Rise Path Team</sub>
</div>
