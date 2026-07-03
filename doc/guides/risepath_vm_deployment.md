# Rise Path 専用 VM デプロイ（`risepath-vm`）

> 更新日: 2026-06-24  
> ステータス: **GCP `risepath-vm` 稼働中**（db/api/mcp + Memanto overlay、50GB ディスク）/ Hermes・kokoro は `--profile full` で起動  
> 目的: **ai-note-meet / nexloom-gce の既存スタックを変更せず**、Rise Path を DB〜Hermes まで一式で再現・運用する。

---

## 1. 背景と方針

### 1.1 なぜ専用 VM か

| 懸念 | `nexloom-gce` 同居 | `risepath-vm` 専用 |
|------|-------------------|-------------------|
| ai-note-meet / auto-grants / coral-shop への影響 | 設定・プロセスが混在しうる | **触らない** |
| 既存 `gemini5` Hermes gateway | 別プロジェクト MCP が多数 | Rise Path 専用 Hermes のみ |
| DB | `risepath` DB は論理分離済みだが同一ホスト | **Postgres も専用** |
| 障害切り分け | 他サービスと巻き添え | VM 単位で独立 |
| 再現性 | 手動 bootstrap 依存 | **`docker compose up` で一式** |

**結論:** 本番・ステージングの正本は **`risepath-vm` 上の Docker スタック**。  
`nexloom-gce` 上の `risepath` DB は **移行期間の暫定**（既にデータがある場合は `pg_dump` → 新 VM へ）。

### 1.2 学習者（エンドユーザー）との関係

- **VM / Hermes インスタンス** = Rise Path **プロダクト 1 つ分**（マルチテナント）
- **学習者ごとに VM や Hermes は作らない**
- ユーザー枠は Supabase JWT → `rp:user:{uuid}` → MCP / DB の `user_id` スコープで分離

### 1.3 VM 外に置くもの

| コンポーネント | 配置 | 理由 |
|----------------|------|------|
| **Supabase Auth** | SaaS | 認証のみ。データ DB は VM |
| **フロント（Vite ビルド）** | Vercel 等（推奨） | 静的配信。API は VM 向け |
| **GCS** | GCP | 大きいファイル（計画） |

---

## 2. 目標アーキテクチャ

```text
[Browser]
   │ Supabase Auth (JWT)
   ▼
[Vercel 等]  静的フロント ──HTTPS──► [risepath-vm / Tailscale]
                                         │
                    ┌────────────────────┴────────────────────┐
                    │  docker compose (Rise Path stack)         │
                    │  ┌─────────┐  ┌─────┐  ┌─────┐  ┌──────┐ │
                    │  │   db    │  │ api │  │ mcp │  │hermes│ │
                    │  │Postgres │  │:3006│  │:3100│  │:8642 │ │
                    │  │risepath │  └──┬──┘  └──┬──┘  └──┬───┘ │
                    │  └────▲────┘     │        │        │    │
                    │       └──────────┴────────┴────────┘    │
                    └───────────────────────────────────────────┘

[nexloom-gce]  … 変更しない（ai-note-meet, auto-grants, gemini5 Hermes 等）
```

### 2.1 Compose サービス（目標）

| サービス | イメージ / ビルド | ポート | 責務 |
|----------|-------------------|--------|------|
| `db` | `postgres:16-alpine` | 5432（内部） | `risepath` データ、DB ロール **`risepath_app`** |
| `api` | リポジトリ `Dockerfile` | 3006 | Express `server.js` |
| `mcp` | 同上 | 3100 | MCP SSE（本番は stdio 非推奨） |
| `hermes` | Hermes 公式 or カスタム | 8642 | `rise-path` プロファイル、API Server |
| `proxy` | caddy / traefik（任意） | 443 | TLS 終端 |

Postgres ロールは **`risepath_app`** に統一（`deploy/risepath-vm/stack.env.example` の `POSTGRES_USER`、Mac `.env.local`、レガシー bootstrap SQL と一致）。

起動後ワンショット:

```bash
docker compose exec api npm run db:migrate
```

### 2.2 リポジトリ内の予定ファイル

| パス | 内容 |
|------|------|
| `deploy/risepath-vm/docker-compose.yml` | VM スタック（**db + api + mcp**） |
| `deploy/risepath-vm/scripts/provision-gce.sh` | GCP VM + 09:00–23:00 JST スケジュール |
| `deploy/risepath-vm/stack.env.example` | 変数名テンプレ（秘密なし） |
| `deploy/risepath-vm/hermes/config.yaml` | 本番 Hermes プロファイル（SSE MCP + allowlist） |
| `deploy/risepath-vm/scripts/deploy-stack.sh` | 再デプロイ + migrate + `smoke:vm` |
| `docker-compose.yml`（ルート） | **ローカル開発用**（`db` + **`app`** のみ。本番 Compose はサービス名 `api`） |
| `hermes/config.example.yaml` | Hermes `rise-path` プロファイルテンプレ |

---

## 3. Hermes の分離

### 3.1 使わないもの

- `nexloom-gce` 上の `gemini5` Hermes（coral-shop, auto-grants, prospect 等の MCP）
- 開発者個人の `~/.hermes/profiles/default`（Rise Path 本番・ステージングでは使用しない）

### 3.2 Rise Path 専用 Hermes

- プロファイル名: **`rise-path`**
- 設定正本: リポジトリ `hermes/config.example.yaml` → VM では `deploy/risepath-vm/hermes/config.yaml`
- MCP: **`rise_path` のみ**（`tools.include` allowlist）
- Skills: リポジトリ `skills/` のみ
- API Server: `:8642`（Compose 内では `http://hermes:8642`）

Express（`api` サービス）の環境変数:

```env
HERMES_API_URL=http://hermes:8642
HERMES_API_KEY=<API_SERVER_KEY と同値>
```

### 3.3 本番 MCP トランスポート

| 環境 | MCP | Hermes 接続 |
|------|-----|-------------|
| Mac ローカル開発 | stdio（Hermes が子プロセス起動） | `hermes -p rise-path gateway` |
| `risepath-vm` 本番 | **SSE**（`mcp` サービス） | `url: http://mcp:3100/sse` + Bearer |

**Hermes → MCP（Compose 内）:** Hermes の `config.yaml` で SSE URL を使い、`Authorization: Bearer ${RISE_PATH_BRIDGE_TOKEN}` を付与（`stack.env` の `RISE_PATH_BRIDGE_TOKEN` と同値）。MCP は Bridge Token を検証し、Express 経由のユーザーチャットでは Express が先に `registerAgentSession(rp:user:{uuid})` する。エンドユーザー JWT を MCP に直接渡す経路は外部クライアント（ChatGPT 等）向け。

stdio は本番では **非推奨**（[`architecture_v3_hermes_agent.md`](./architecture_v3_hermes_agent.md) §3.2）。

---

## 4. セットアップ手順（目標）

### 4.1 VM プロビジョニング（開発期: 夜間停止）

**推奨スペック:** `e2-medium`（2 vCPU / 4 GB）+ 30 GB `pd-balanced` + Ubuntu 24.04 + `asia-northeast1`

**開発期スケジュール:** 毎日 **09:00 起動 / 23:00 停止**（Asia/Tokyo）→ 月額 **約 ¥3,000–3,500**

```bash
export GCP_PROJECT=your-project-id
cd deploy/risepath-vm/scripts
./provision-gce.sh
```

手動の場合:

1. GCP で VM 作成（`risepath-vm`）
2. インスタンススケジュールをアタッチ（上記スクリプト参照）
3. Tailscale に参加（`--hostname=risepath-vm`）
4. `scripts/bootstrap-vm.sh` で Docker + compose + systemd
5. ファイアウォール: **5432/3006/3100 を 0.0.0.0/0 に開放しない**（Tailscale 経由のみ）

#### Mac から接続

`deploy/risepath-vm/docker-compose.yml` は `5432` / `3006` / `3100` を VM 内で公開。Tailscale の `100.x` 経由で `risepath-vm:5432` 等に接続する。**GCP VPC ファイアウォールでインターネット向けに開けないこと。**

**Hermes（開発期）:** VM には載せず **Mac ローカル**で `hermes -p rise-path gateway`。DB/MCP は VM 向け。

### 4.2 初回デプロイ

```bash
git clone <rise-path-repo> /opt/risepath
cd /opt/risepath/deploy/risepath-vm
cp stack.env.example stack.env   # 実値を入れる。git に含めない
chmod 600 stack.env
docker compose --env-file stack.env up -d
docker compose exec api npm run db:migrate
docker compose exec api npm run env:check -- --db
```

### 4.3 Mac 開発者の `.env.local`（リモート VM 向け）

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:***@risepath-vm:5432/risepath?sslmode=disable
HERMES_API_URL=http://risepath-vm:8642
HERMES_API_KEY=***
```

フロントは引き続き `npm run dev`（:3007）で、API は Tailscale 経由で VM またはローカル proxy。

### 4.4 ローカル Docker のみ（VM なしで試す場合）

```bash
cd rise-path-demo-game-integration
cp deploy/risepath-vm/stack.env.example .env.stack  # 将来
docker compose -f deploy/risepath-vm/docker-compose.yml --env-file .env.stack up -d
```

ルートの `docker-compose.yml` は簡易版（`db` + **`app`**）。migration は `docker compose exec app npm run db:migrate`。フルスタックは `deploy/risepath-vm/`（サービス名 `api`）が正本。

---

## 5. `nexloom-gce` からの移行

既に `nexloom-gce` / `risepath` にデータがある場合:

```bash
# 旧（暫定）
pg_dump -h nexloom-gce -U risepath_app -d risepath -Fc -f risepath.dump

# 新 VM（Compose 起動後）
pg_restore -h risepath-vm -U risepath_app -d risepath --no-owner risepath.dump
```

切替手順:

1. 新 VM でスモーク（`npm run env:check -- --api`、ゲストログイン、Life Journal）
2. `.env.local` / 本番 env の `DATABASE_URL_PHASE1` を `risepath-vm` に変更
3. 旧 DB は読み取り専用にし、問題なければ退役

**nexloom-gce 上の Postgres プロセスや ai-note-meet には手を入れない。**

---

## 6. セキュリティチェックリスト

- [ ] `stack.env` / `.env.local` が Git に無い
- [ ] Hermes `tools.include` が Rise Path allowlist のみ
- [ ] `daily-life-range` / `daily-life-log` を Hermes 本番 allowlist に含めない
- [ ] `HERMES_API_KEY` は Express のみ（ブラウザに露出しない）
- [ ] MCP SSE は本番で Bridge Token または Supabase JWT 必須（`NODE_ENV=production` で匿名不可）
- [ ] `RISE_PATH_BRIDGE_TOKEN` を `mcp` と Hermes `config.yaml` で同値に揃える
- [ ] Tailscale ACL で `risepath-vm` へのアクセスを限定

---

## 7. Phase 19: 学習者 Memanto overlay（risepath-vm 専用）

開発者個人用 Memanto（nexloom-gce / `2005nk-work`）とは **別 volume・別 secret**。仕様: [`phase19_learner_semantic_memory_spec.md`](./phase19_learner_semantic_memory_spec.md)

### 7.1 有効化

`stack.env` に実 secret を設定:

```env
MEMANTO_SECRET_KEY=<openssl rand -hex 32>
MEMANTO_ENABLED=true
COMPOSE_PROFILES=full,memory
```

### 7.2 起動

```bash
cd /opt/risepath/deploy/risepath-vm
./scripts/deploy-stack.sh
# または手動:
docker compose -f docker-compose.yml -f docker-compose.memanto.yml \
  --env-file stack.env --profile full --profile memory up -d --build
./scripts/init-memanto-ollama.sh   # nomic-embed-text を pull
```

| サービス | 内部 URL | ホスト（VM ローカル） |
|----------|----------|----------------------|
| `ollama` | `http://ollama:11434` | — |
| `moorcheh` | `http://moorcheh:8080` | — |
| `memanto` | `http://memanto:8000` | `127.0.0.1:8100` |

`api` / `mcp` は `MEMANTO_API_URL=http://memanto:8000` で bridge（Phase 19-1 以降）に接続する。

### 7.3 スモーク

```bash
# VM host (loopback + published ports)
node scripts/smoke-vm-stack.mjs --target host --require-mcp --require-memanto

# From api container (Compose service DNS — deploy-stack.sh uses this when host has no node)
docker compose exec api node scripts/smoke-vm-stack.mjs --target container --require-mcp --require-memanto
```

---

## 8. 実装ステータス

| 項目 | 状態 |
|------|------|
| アーキテクチャ方針（本ドキュメント） | ✅ 確定 |
| migration 000–008 + `db:migrate` | ✅ 完了 |
| Express agent proxy + Life Journal API | ✅ 完了 |
| `deploy/risepath-vm/docker-compose.yml` | ✅ db + api + mcp + kokoro-tts（healthcheck 付き） |
| Phase 19 Memanto overlay | ✅ compose + deploy-stack + smoke（bridge は 19-1） |
| GCP スケジュール + provision スクリプト | ✅ `scripts/provision-gce.sh` |
| `deploy-stack.sh` + `npm run smoke:vm` | ✅ 再デプロイ・検証導線 |
| Hermes 本番 `config.yaml`（SSE） | ✅ `deploy/risepath-vm/hermes/config.yaml` |
| Hermes コンテナイメージ | ⬜ 未作成（開発期は Mac ローカル gateway） |
| `risepath-vm` GCP 実機プロビジョニング | 🔄 DB 接続済み（Tailscale）。フル stack は `deploy-stack.sh` で更新 |

---

## 8. 関連ドキュメント

| ファイル | 内容 |
|----------|------|
| [`database_topology.md`](./database_topology.md) | Auth / DB / GCS の全体像 |
| [`architecture_v3_hermes_agent.md`](./architecture_v3_hermes_agent.md) | Hermes + MCP + Skills |
| [`hermes/README.md`](../hermes/README.md) | Hermes プロファイル手順 |
| [`env_local_setup_issue15.md`](./env_local_setup_issue15.md) | ローカル env |
| [`prod_readiness_plan.md`](./prod_readiness_plan.md) | Phase 15 全体 |
| [`portable_deployment.md`](./portable_deployment.md) | GCS / 引っ越し（Nexloom 側は別） |