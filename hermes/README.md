# Rise Path × Hermes Agent

Rise Path の LLM 推論ランタイムとして [Hermes Agent](https://hermes-agent.nousresearch.com/) を使うための設定と手順。

設計の詳細: [`doc/architecture_v3_hermes_agent.md`](../doc/architecture_v3_hermes_agent.md)

## 前提

- Node.js 20+（Rise Path MCP Server）
- Python 3.11+ + [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) インストール済み
- Rise Path の DB 接続（`DATABASE_URL_PHASE1`、本番は **`risepath-vm`** / `risepath`）
- Supabase Auth（Web UI からの JWT；MCP の user scope に使用）

### MCP の学習者スコープ（ターントークン `rp_turn`）

1 台の Hermes が全学習者のチャットを扱うため、MCP のツール呼び出しがどの学習者のものかは**チャット 1 ターンごとのトークン**で決まる（stdio / SSE 共通）。

1. ブラウザ → `POST /api/v2/agent/chat`（Express が Supabase JWT を検証）
2. Express → `registerAgentTurn(userId)`（`server/services/hermesAgentService.js`）。ターンごとに推測できないランダムなトークンを作り、`agent_session_binding` に `rp:turn:<token>` → 学習者 UUID（有効期限 10 分、migration 007）として書き込む。書き込みに失敗したら Hermes を呼ばずに 503 `agent_session_unavailable` を返す（`agent_chat` の日次枠は返却）
3. Express → Hermes `/v1/responses`: トークンを system の `instructions`（`For every rise_path tool call in this turn, pass rp_turn="<token>".`）とヘッダー `X-Hermes-Session-Key: rp:turn:<token>` で渡す。学習者が書く `input` には入れない。会話の継続は `conversation: rp:user:{uuid}:{skill}`
4. Hermes → MCP: 各ツール呼び出しの引数 `rp_turn` にトークンを付ける。MCP の `resolveMcpUserId`（`tools/core/mcpUserScope.js`）が `agent_session_binding` から学習者を引き、その学習者として実行する（`rag-search` も同じ。本人がアップロードした教材だけを検索する）

- 未知・期限切れのトークンは `session_binding_required` で止まる（他の学習者にフォールバックしない）。トークンの形をしていない値（LLM が推測した `current` など）は「指定なし」と同じ扱い
- クライアントが送る `X-Hermes-Session-Key: rp:user:{uuid}` は**無視される**。UUID は秘密ではないので、Bridge Token を持つ誰もが任意の学習者を名乗れてしまうため。運用者が環境変数で設定する `RISE_PATH_ACTIVE_SESSION_KEY=rp:user:{uuid}`（stdio で学習者 1 人だけの構成）は引き続き使える
- `rp_turn` のないツール呼び出し: 本番（`NODE_ENV=production`）では `session_binding_required`。開発環境だけの暫定フォールバックとして、直近 15 分以内にチャットを始めた学習者が 1 人だけ（かつ有効な binding がある）ならその学習者、2 人以上なら `session_binding_required`、誰もいなければ `PHASE1_USER_ID` になる
- MCP は binding を DB から読む（Express とは別プロセス）。Express と MCP には同じ `DATABASE_URL_PHASE1` を設定する

詳細: [`tools/core/mcpUserScope.js`](../tools/core/mcpUserScope.js) 冒頭のコメント、[`doc/system_design/database_topology.md`](../doc/system_design/database_topology.md)

## ローカル Mac（MCP + Hermes）

```bash
# 1. 初回セットアップ（.env.local → Hermes プロファイル生成）
npm run setup:hermes-local          # SSE: MCP を別プロセスで起動
# npm run setup:hermes-local:stdio  # 代替: Hermes が MCP を子プロセス起動

# 2. 起動（SSE の場合は 2 ターミナル）
npm run mcp:local      # Terminal 1 — MCP SSE :3100
npm run hermes:local   # Terminal 2 — Hermes API :8642
npm run dev            # Terminal 3 — Express :3006 + Vite :3007

# 3. 検証
npm run smoke:hermes-local
```

`RISE_PATH_BRIDGE_TOKEN` は `setup:hermes-local` が `.env.local` に自動生成します（MCP SSE と Hermes で同値）。

## クイックスタート

### 1. Hermes プロファイル作成

```bash
hermes profile create rise-path
hermes model
# → OpenRouter または Nous Portal を選択
```

### 2. 設定をコピー

```bash
export RISE_PATH_ROOT="$(pwd)"
cp hermes/config.example.yaml ~/.hermes/profiles/rise-path/config.yaml
```

`config.yaml` 内の `${RISE_PATH_ROOT}` と環境変数を実際の値に置き換える。

### 3. API Server 有効化

`~/.hermes/profiles/rise-path/.env` に追加:

```bash
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
API_SERVER_KEY=change-me-local-dev
OPENROUTER_API_KEY=your-key
DATABASE_URL_PHASE1=postgresql://...
```

`API_SERVER_KEY` は Rise Path Express プロキシのみが保持する（ブラウザに露出しない）。

### 4. 起動

```bash
# Terminal 1: Rise Path
npm run dev

# Terminal 2: Hermes
hermes -p rise-path gateway
```

### 5. 動作確認

```bash
curl http://localhost:8642/v1/chat/completions \
  -H "Authorization: Bearer change-me-local-dev" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hermes-agent",
    "messages": [
      {"role": "user", "content": "/life-habit-analyst 今月の睡眠と集中の関係を教えて"}
    ]
  }'
```

MCP `daily-life-*` ツールは Phase 16-6a で実装済み。DB 未設定時は `db_connection` エラーが返る。

## Rise Path Express プロキシ（Phase 16-6d — 実装済み）

Web UI は Hermes に直接接続せず、`POST /api/v2/agent/chat` 経由で接続する。

```bash
curl -X POST http://localhost:3006/api/v2/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "skill": "life-habit-analyst",
    "message": "今月の睡眠と集中の関係は？",
    "context": { "from": "2026-06-01", "to": "2026-06-30", "timezone": "Asia/Tokyo" }
  }'
```

ストリーミング: リクエストに `"stream": true` を付与すると SSE で中継される。

環境変数（`.env`）:

```bash
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=change-me-local-dev
```

## セキュリティ

| 項目 | 設定 |
|------|------|
| MCP 露出 | `tools.include` allowlist のみ |
| Hermes terminal/browser | rise-path プロファイルで **無効化** |
| マルチユーザー | ターンごとの `rp_turn`（Express が発行、`agent_session_binding`・migration 007）。`rp:user:{uuid}` キーはクライアントから受け付けない |
| MCP レート制限 | 学習者の JWT セッションはセッション単位、Hermes の共有 Bridge セッションは `rp_turn` の学習者単位（`mcp-server/messageRateLimit.js`） |
| stdio 本番 | **非推奨** — SSE MCP + JWT を使用（`resources: true` 時は `learner://profile/me` のみ） |
| 日記 LLM 送信 | Express が同意を DB/メモリに記録、MCP がサーバー側で強制（デフォルト OFF） |
| 生データ露出 | `daily-life-range` / `daily-life-log` は Hermes allowlist に **含めない** |

## 本番（`risepath-vm`）

**正本:** [`doc/guides/risepath_vm_deployment.md`](../doc/guides/risepath_vm_deployment.md)

- 専用 VM 上で Docker Compose: `db` + `api` + `mcp` + `hermes`
- **`nexloom-gce` の gemini5 Hermes は使わない**（ai-note-meet / coral-shop 等と分離）
- Hermes 設定は VM 内 `deploy/risepath-vm/hermes/config.yaml`（リポジトリ `hermes/config.example.yaml` 由来）
- 学習者ごとに Hermes を増やさない — チャット 1 ターンごとの `rp_turn` でスコープ（上の「MCP の学習者スコープ」）

### 本番 MCP（SSE）

```yaml
mcp_servers:
  rise_path:
    url: "http://mcp:3100/sse"   # Compose 内。外向きは proxy 経由
    headers:
      Authorization: "Bearer ${RISE_PATH_BRIDGE_TOKEN}"
    tools:
      include: [daily-life-chat-context, ...]
```

`RISE_PATH_BRIDGE_TOKEN` は `deploy/risepath-vm/stack.env` の `mcp` / `hermes` と同値。MCP は Bridge Token または Supabase JWT を検証（本番 `NODE_ENV=production` では匿名不可）。Bridge Token のセッションが学習者として動けるのは、Express がそのターン用に発行した `rp_turn` を付けた呼び出しだけ（Express は `registerAgentTurn` してから Hermes を呼ぶ）。`rp_turn` のない呼び出しは本番では `session_binding_required` になる。

開発時のみ: `npm run mcp:sse`（ポート 3100）。

## 関連ファイル

| パス | 内容 |
|------|------|
| `hermes/config.example.yaml` | Hermes プロファイル設定テンプレート |
| `skills/life-habit-analyst/SKILL.md` | 生活習慣分析チャット用 Skill |
| `mcp-server/index.js` | MCP Server（stdio / SSE） |
| `doc/architecture_v3_hermes_agent.md` | v3 アーキテクチャ仕様 |
| `doc/risepath_vm_deployment.md` | 専用 VM + Docker デプロイ正本 |
| `deploy/risepath-vm/stack.env.example` | Compose 用 env テンプレ |