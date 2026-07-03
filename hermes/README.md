# Rise Path × Hermes Agent

Rise Path の LLM 推論ランタイムとして [Hermes Agent](https://hermes-agent.nousresearch.com/) を使うための設定と手順。

設計の詳細: [`doc/architecture_v3_hermes_agent.md`](../doc/architecture_v3_hermes_agent.md)

## 前提

- Node.js 20+（Rise Path MCP Server）
- Python 3.11+ + [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) インストール済み
- Rise Path の DB 接続（`DATABASE_URL_PHASE1`、本番は **`risepath-vm`** / `risepath`）
- Supabase Auth（Web UI からの JWT；MCP の user scope に使用）

### MCP 認証（stdio）

Hermes は Rise Path MCP を **stdio 子プロセス**で起動する。ユーザー分離の流れ:

1. ブラウザ → `POST /api/v2/agent/chat`（Express が Supabase JWT を検証）
2. Express → `syncAuthUserStub` + `registerAgentSession(rp:user:{uuid})`
3. Hermes → stdio MCP ツール実行 → `resolveMcpUserId` が同 UUID を解決し、必要なら再度スタブ同期

詳細: [`doc/architecture_v3_hermes_agent.md`](../doc/architecture_v3_hermes_agent.md) §3.2、[`doc/database_topology.md`](../doc/database_topology.md)

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
| マルチユーザー | `X-Hermes-Session-Key: rp:user:{userId}` + `agent_session_binding`（migration 007） |
| stdio 本番 | **非推奨** — SSE MCP + JWT を使用（`resources: true` 時は `learner://profile/me` のみ） |
| 日記 LLM 送信 | Express が同意を DB/メモリに記録、MCP がサーバー側で強制（デフォルト OFF） |
| 生データ露出 | `daily-life-range` / `daily-life-log` は Hermes allowlist に **含めない** |

## 本番（`risepath-vm`）

**正本:** [`doc/risepath_vm_deployment.md`](../doc/risepath_vm_deployment.md)

- 専用 VM 上で Docker Compose: `db` + `api` + `mcp` + `hermes`
- **`nexloom-gce` の gemini5 Hermes は使わない**（ai-note-meet / coral-shop 等と分離）
- Hermes 設定は VM 内 `deploy/risepath-vm/hermes/config.yaml`（リポジトリ `hermes/config.example.yaml` 由来）
- 学習者ごとに Hermes を増やさない — `rp:user:{uuid}` でスコープ

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

`RISE_PATH_BRIDGE_TOKEN` は `deploy/risepath-vm/stack.env` の `mcp` / `hermes` と同値。MCP は Bridge Token または Supabase JWT を検証（本番 `NODE_ENV=production` では匿名不可）。ユーザースコープ付きチャットは Express が `registerAgentSession` してから Hermes を呼ぶ。

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