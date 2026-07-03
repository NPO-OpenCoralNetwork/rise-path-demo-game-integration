# Issue #15: `.env.local` セットアップ手順

> 目的: ローカルで **Supabase Auth + PostgreSQL + `VITE_DEMO_MODE=false`** により実データモードに近い状態で動かす。

## 0. 前提

- リポジトリ: `~/Works/personal/rise-path-demo-game-integration`
- API: `http://localhost:3006`（`server.js`）
- フロント: `http://localhost:3007`（Vite、`/api` は 3006 にプロキシ）
- `.env.local` は **git に含めない**（`.gitignore` 済み）

## 1. テンプレートをコピー

```bash
cd ~/Works/personal/rise-path-demo-game-integration
cp env.local.template .env.local
```

## 2. Supabase の値を入れる

Supabase ダッシュボード → **Project Settings**:

| 変数 | 取得場所 |
|------|----------|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | API → Project URL（`https://xxxx.supabase.co`） |
| `VITE_SUPABASE_ANON_KEY` | API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | API → `service_role` key（**サーバー専用・漏洩禁止**） |

フロントは `VITE_*` のみビルド時に読み込みます。バックエンドは `server.js` が起動時に `.env.local` を読みます。

## 3. PostgreSQL（`risepath` 専用）

**推奨トポロジ:** [`doc/database_topology.md`](./database_topology.md) / デプロイ正本 [`doc/risepath_vm_deployment.md`](./risepath_vm_deployment.md)

- **データ（本番・推奨）** → 専用 VM **`risepath-vm`** 上の Docker Postgres、DB 名 **`risepath`**
- **データ（移行期間の暫定）** → `nexloom-gce` 上の `risepath`（新規環境では使わない）
- **認証** → Supabase Auth のみ（Supabase の Postgres URI は **使わない**）
- **禁止** → `autogrants` など他プロダクト DB（`npm run env:check` が `autogrants` を検出すると失敗）

### A. 本番向け: `risepath-vm`（推奨）

VM 上で Docker スタックを起動（詳細は [`risepath_vm_deployment.md`](./risepath_vm_deployment.md)）:

```bash
cd deploy/risepath-vm
cp stack.env.example stack.env
docker compose --env-file stack.env up -d
docker compose exec api npm run db:migrate
```

Mac の `.env.local`:

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:***@risepath-vm:5432/risepath?sslmode=disable
HERMES_API_URL=http://risepath-vm:8642
HERMES_API_KEY=***
```

### B. 暫定: `nexloom-gce`（レガシー・移行のみ）

```bash
scp scripts/vm/postgres_risepath_bootstrap.sql nexloom-gce:/tmp/
ssh nexloom-gce
sudo -u postgres psql -f /tmp/postgres_risepath_bootstrap.sql
```

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:***@nexloom-gce:5432/risepath?sslmode=disable
```

ホストは `tailscale status` の Tailscale 名または 100.x IP。

注意:

- VM 上の Postgres は Tailscale 内前提なら `sslmode=disable` が多い（公開する場合は TLS + `pg_hba` 必須）。
- `pg_hba.conf` で Tailscale サブネット（例: 100.64.0.0/10）からの接続を許可する。
- スキーマ未適用だと API が `relation "curricula" does not exist` で 500 → **Issue #16（migration）**。

## 4. 本番に近いフロント設定

`.env.local` で以下を確認:

```env
VITE_DEMO_MODE=false
VITE_API_ENABLED=true
VITE_API_BASE_URL=/api/v2
```

`NODE_ENV=production` はローカルでは **付けない**ことを推奨します。付けると JWT なしリクエストが 401 になり、ゲスト開発がしづらくなります。

## 5. 検証コマンド

```bash
# 変数の有無だけ（値は表示しない）
npm run env:check

# PostgreSQL 接続テスト
npm run env:check -- --db

# Supabase Auth API（service_role で到達確認）
npm run env:check -- --auth

# 起動中サーバーへ API スモーク（別ターミナルで npm run dev 後）
npm run env:check -- --api
```

**注意:** `.env.local` で同じキーを2回書くと **後の行が勝ちます**。テンプレの `YOUR_PROJECT_REF` 行が残っていると、正しい `SUPABASE_URL` が上書きされます。

**LLM（v3）:** 標準は **Hermes**（`HERMES_API_URL` / `HERMES_API_KEY`）。Web UI チャット（`LifeJournalChatView`・`FloatingChatbot`）は Hermes プロキシ経由。`GEMINI_API_KEY` はレガシー（`/ai/generate` 等）用で **必須ではない**。

期待する進捗:

| 段階 | `env:check` | `env:check --db` | `env:check --api` |
|------|-------------|------------------|-------------------|
| 未設定 | ❌ MISSING | skip | 503 DB not configured |
| DB URL のみ | ✅ required | ✅ connect | 200 or 500（schema 未適用） |
| migration 後 | ✅ | ✅ | ✅ 200 `{ ok: true, curricula: [...] }` |

## 6. アプリ起動

```bash
npm run dev
```

ブラウザ: `http://localhost:3007`

- Supabase 設定済み → メール/パスワードログイン（または既存 Nexloom と同一プロジェクトなら同じアカウント）
- Supabase 未設定 → ゲストログインのみ（`AuthContext` が local のゲストモード）

## 7. 手動 API 確認

```bash
# DB 未設定時
curl -s http://localhost:3006/api/v2/curricula
# {"error":"DB not configured"}

# DB 設定 + dev サーバー再起動後（JWT なし → PHASE1_USER_ID フォールバック）
curl -s http://localhost:3006/api/v2/curricula
# {"ok":true,"curricula":[...]}  ※ migration 済みの場合
```

## 8. Issue #15 の Acceptance Criteria 対応表

| Criteria | この手順での確認方法 |
|----------|---------------------|
| `VITE_DEMO_MODE=false` で curricula API | `env:check --api` + ブラウザでコース一覧が API 由来か Network タブで確認 |
| Supabase Bearer JWT | Supabase ログイン後、リクエストに `Authorization: Bearer ...`（`apiClient`） |
| `GET /api/v2/curricula` 200 | `curl` または `env:check --api` |
| 欠落 env の明示 | `npm run env:check` |
| ドキュメント同期 | 本ファイル + `doc/prod_readiness_plan.md` |

## 9. よくある詰まり

1. **`.env.local` を書いたのに 503**  
   → `server.js` は起動時のみ読み込み。**`npm run dev` を再起動**。

2. **フロントだけデモのまま**  
   → `VITE_DEMO_MODE=false` 変更後は **Vite も再起動**（`import.meta.env` はビルド/起動時固定）。

3. **DB connect OK だが curricula 500**  
   → migration 未適用（#16）。`npm run db:migrate`（`scripts/db-migrate.mjs`、適用済みは `schema_migrations` でスキップ）。

4. **Supabase ログインできない**  
   → `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` の typo、または Auth で Email プロバイダ無効。

5. **新規登録 / メール確認**（Phase 18）  
   Supabase ダッシュボード → **Authentication** → **URL Configuration**:

   | 項目 | ローカル | 本番 |
   |------|----------|------|
   | Site URL | `http://localhost:3007` | Vercel 本番 URL |
   | Redirect URLs | `http://localhost:3007/auth/callback` | `https://<prod>/auth/callback` |

   | 設定 | 開発 | 本番 |
   |------|------|------|
   | Email プロバイダ | ON | ON |
   | Confirm email | OFF 推奨（即ログイン） | ON 推奨 |

   仕様: [`phase18_user_registration_spec.md`](./phase18_user_registration_spec.md)

## 10. migration 適用（Issue #16）

```bash
npm run db:migrate:status   # 未適用一覧
npm run db:migrate          # risepath-vm（または暫定 nexloom-gce）/ risepath に適用
npm run env:check -- --db
```

詳細: [`server/migrations/README.md`](../server/migrations/README.md)

## 11. 次の Issue

- **#17** TypeScript
- 診断の本番保存は Phase 16 / 別 Issue

## 12. VM 引っ越し・GCS・secrets

本番 VM や Docker へ移すときは **`.env` をコピーせず**、新ホストで作り直し + ローテを推奨。

| ドキュメント | 内容 |
|--------------|------|
| [`portable_deployment.md`](./portable_deployment.md) | GCS、Compose、Nexloom との役割分担 |
| [`env_migration_safety.md`](./env_migration_safety.md) | 安全な secrets 引っ越し |
| `secrets.inventory.template` | 変数名の棚卸し |
| `npm run env:inventory` | SET/MISSING/PLACEHOLDER（**値は表示しない**、デフォルト `--scope rise-path`） |

関連: [GitHub Issue #15](https://github.com/t012093/rise-path-demo-game-Integration-/issues/15)