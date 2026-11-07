# Issue #15: `.env.local` セットアップ手順

> 目的: ローカルで **Supabase Auth + PostgreSQL + `VITE_DEMO_MODE=false`** により実データモードに近い状態で動かす。

## 0. 前提

- リポジトリ: リポジトリを clone したフォルダ（以下、そのフォルダで実行します）
- API: `http://localhost:3006`（`server.js`）
- フロント: `http://localhost:3007`（Vite、`/api` は 3006 にプロキシ）
- `.env.local` は **git に含めない**（`.gitignore` 済み）

## 1. テンプレートをコピー

```bash
cd <リポジトリのフォルダ>
cp .env.example .env.local
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

**推奨トポロジ:** [`doc/system_design/database_topology.md`](../system_design/database_topology.md) / デプロイ正本 [`doc/guides/risepath_vm_deployment.md`](./risepath_vm_deployment.md) / 公開の手順書 [`doc/guides/first-launch.ja.md`](./first-launch.ja.md)

- **開発のデータ（推奨）** → Mac の中だけで動く開発用の Postgres（Docker、`127.0.0.1:5433`）、DB 名 **`risepath`**。作り方は [手順書の 18 章](./first-launch.ja.md)。
- **本番のデータ** → 専用 VM **`risepath-vm`** の中の Docker Postgres（`db:5432`。VM の中からだけ使います）。試験運用から先は、開発の `.env.local` では使いません（D8）。本番の DB の調べものとスタッフによる削除は、VM の中（SSH）でだけします。
- **古いデータ** → `nexloom-gce` 上の `risepath`（新規環境では使いません。移すときは [`risepath_vm_deployment.md`](./risepath_vm_deployment.md) の 5 章）。
- **認証** → Supabase Auth のみ（Supabase の Postgres URI は **使わない**）
- **禁止** → `autogrants` など他プロダクト DB（`npm run env:check` が `autogrants` を検出すると失敗）

### A. 開発用の DB（Mac の中だけ）

```bash
docker run -d --name risepath-dev-db -p 127.0.0.1:5433:5432 \
  -e POSTGRES_USER=risepath_app -e POSTGRES_PASSWORD=<開発用のパスワード> -e POSTGRES_DB=risepath \
  -v risepath-dev-pgdata:/var/lib/postgresql/data \
  pgvector/pgvector:0.8.7-pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a
```

Mac の `.env.local`:

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:<開発用のパスワード>@127.0.0.1:5433/risepath?sslmode=disable
```

そのあと `npm run db:migrate` を実行します（開発用の DB に当たります）。

### B. 本番の VM（`risepath-vm`）

VM 上で Docker スタックを起動します（新しい VM は [手順書](./first-launch.ja.md) の 4〜6 章、詳細は [`risepath_vm_deployment.md`](./risepath_vm_deployment.md)）。本番の `DATABASE_URL_PHASE1` は VM の `stack.env` だけにあり（`db:5432`）、Mac には写しません。

注意:

- `npm run env:check` は、`.env.local` のホストが `risepath-vm` か `nexloom-gce`（`risepath-vm.<tailnet>.ts.net` のような長い名前もふくむ）だと、本番の DB だという注意（英語で `this is the production database`）を出します。Tailscale のアドレス（`100.64.0.0/10`）にも注意（`a Tailscale address`）を出します（どちらも開発では使いません）。
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

**LLM:** アプリの中の AI（チューター・文章フィードバック・コース生成 `/ai/generate`）は `ANTHROPIC_API_KEY`（Claude）で動きます。共有の Hermes とのチャット（`LifeJournalChatView`・`FloatingChatbot`）は学習者には提供せず、`VITE_FEATURE_AGENT_CHAT=true` のときだけ出ます（開発で試すときは `HERMES_API_URL` / `HERMES_API_KEY` も設定）。Gemini は `GEMINI_ALLOWED=true` のときだけ使い、それは 18 歳未満の人が使えない環境に限ります。

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
| ドキュメント同期 | 本ファイル（`doc/guides/prod_readiness_plan.md` は古い計画です） |

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

   開発はステージングのプロジェクトだけで設定を変えます。共有のプロジェクト（本番。Nexloom・P-School と共有）の設定は変えません（手順書 18 章）。ステージングのプロジェクトがないときは、共有のプロジェクトを今の設定のまま使い、手元でもアプリの登録は閉じたままです（`VITE_FEATURE_LEGAL_PAGES` が `true` になるまで）。

   | 項目 | ステージング（開発） | 共有のプロジェクト（本番） |
   |------|----------|------|
   | Site URL | `http://localhost:3007` | 変えません（担当と決めたときだけ。手順書 11.5） |
   | Redirect URLs | `http://localhost:3007/auth/callback` | `https://app.<domain>/auth/callback` を足すだけ（手順書 11.5） |
   | Email プロバイダ | ON | ON |
   | Confirm email | OFF でもよい（即ログイン） | 一般の登録を開く前に ON（手順書 11.4） |

   仕様: [`phase18_user_registration_spec.md`](../phases/phase18_user_registration_spec.md)

## 10. migration 適用（Issue #16）

```bash
npm run db:migrate:status   # 未適用一覧
npm run db:migrate          # .env.local の開発用の DB に適用（本番には VM の deploy-stack.sh が当てます）
npm run env:check -- --db
```

詳細: [`server/migrations/README.md`](../../server/migrations/README.md)

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