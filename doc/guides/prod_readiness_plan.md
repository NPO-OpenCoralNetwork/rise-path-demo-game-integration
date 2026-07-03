# Rise Path 実プロダクト移行計画

> 作成日: 2026-06-22  
> 更新日: 2026-06-23（`risepath-vm` 専用 Docker スタック方針）
> 対象リポジトリ: `t012093/rise-path-demo-game-Integration-`  
> 対象ローカル: `/Users/2005nk/Works/personal/rise-path-demo-game-integration`

## 1. 現状サマリー

Rise Path は、ローカルでの UI デモ・MVP としては十分に動作している。一方、実プロダクトとして公開・運用するには、DB/Supabase/本番認証/デプロイ/セキュリティ対応を完了する必要がある。

確認済みの状態:

| 項目 | 状態 | 根拠 |
|---|---|---|
| ローカルフロント表示 | ✅ OK | `http://localhost:3007/` 表示確認済み |
| ゲストログイン | ✅ OK | Dashboard 表示確認済み |
| テスト | ✅ OK | `npm test` → 175 tests pass |
| Vite build | ✅ OK | `npm run build` 成功 |
| DB API | ❌ NG | `/api/v2/curricula` → `503 {"error":"DB not configured"}` |
| Supabase Auth | ❌ 未接続 | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` が未設定 |
| TypeScript full check | ❌ NG | `npx tsc --noEmit` → `RisePathConciergeView.tsx(478,1): TS1128` |
| Production dependency security | ⚠️ 要対応 | `npm audit --omit=dev` → 30 vulnerabilities / 12 high |
| Production Tailwind | ✅ OK | Tailwind v4 + `@tailwindcss/vite` ビルド（CDN 削除済み） |

## 2. デモモードから実データモードへの切替

`services/curriculumApi.ts` で以下の判定をしている。

```ts
const USE_DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';
```

つまり、未設定時はデモモードが有効。本番データに切り替えるには `.env.local` で明示的に以下を設定する。

```env
VITE_DEMO_MODE=false
VITE_API_ENABLED=true
VITE_API_BASE_URL=/api/v2
```

ただし、これだけでは不十分。`VITE_DEMO_MODE=false` にすると API/DB を読みに行くため、DB と認証の設定が先に必要。

## 3. 必須環境変数

`.env.local` に最低限以下を設定する。

手順の詳細: [`doc/env_local_setup_issue15.md`](./env_local_setup_issue15.md)  
検証: `npm run env:check` / `npm run env:check -- --db` / `npm run env:check -- --api`

```env
# Frontend Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Backend Supabase JWT validation
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# PostgreSQL（risepath-vm 推奨 — Supabase Postgres は使わない）
DATABASE_URL_PHASE1=postgresql://risepath_app:password@risepath-vm:5432/risepath?sslmode=disable

# Hermes Agent (v3 LLM — optional until gateway runs)
HERMES_API_URL=http://risepath-vm:8642
HERMES_API_KEY=change-me-local-dev

# Legacy Gemini (FloatingChatbot, /ai/generate — optional)
# GEMINI_API_KEY=

# Production data mode
VITE_DEMO_MODE=false
VITE_API_ENABLED=true
VITE_API_BASE_URL=/api/v2

# Server
PORT=3006
NODE_ENV=production
```

## 4. DB / migration（Issue #16 — 完了）

schema は `server/migrations/` に一本化済み。`npm run db:migrate` が唯一の適用導線。

```text
server/migrations/000_extensions_and_auth.sql
server/migrations/001_core_curriculum.sql
server/migrations/002_user_app_tables.sql
server/migrations/003_learner_profiles.sql
server/migrations/004_learning_journal.sql
server/migrations/005_mcp_sessions.sql
server/migrations/006_life_journal.sql
server/migrations/007_agent_tables.sql
server/migrations/008_seed_learning_portals.sql
```

- **データ DB**: 専用 VM **`risepath-vm`** / Docker Postgres `risepath`（移行期間のみ `nexloom-gce`）
- **認証**: Supabase Auth（JWT）。VM 側 `auth.users` は ID スタブ
- **アーカイブ**: `doc/ai-curriculum-spec/local_postgres_phase1.sql`, `doc/local_postgres.sql`（適用しない）

詳細: [`server/migrations/README.md`](../server/migrations/README.md)

## 5. 本番化の優先 Issue

| 優先度 | Issue | 目的 |
|---|---|---|
| P0 | [#15 Production env / Supabase / DB 接続](https://github.com/t012093/rise-path-demo-game-Integration-/issues/15) | デモモードを外して実データで動かす |
| P0 | [#16 DB migration 一本化](https://github.com/t012093/rise-path-demo-game-Integration-/issues/16) | ✅ チェーン整備済み — `npm run db:migrate` で適用 |
| P0 | [#17 TypeScript full check 修正](https://github.com/t012093/rise-path-demo-game-Integration-/issues/17) | 本番品質ゲートを作る |
| P1 | [#18 Auth fallback / Guest mode 整理](https://github.com/t012093/rise-path-demo-game-Integration-/issues/18) | mock / guest / PHASE1 fallback の境界を明確化 |
| P1 | [#19 Dependency security 対応](https://github.com/t012093/rise-path-demo-game-Integration-/issues/19) | high vulnerabilities を潰す |
| P1 | [#20 Production deploy / ops](https://github.com/t012093/rise-path-demo-game-Integration-/issues/20) | Vercel/Cloud Run/monitoring/healthcheck を確立 |
| P2 | [#21 Tailwind / bundle optimization](https://github.com/t012093/rise-path-demo-game-Integration-/issues/21) | 本番警告と巨大chunkを解消 |

## 6. 実プロダクト移行の実行順

### Step 1: 品質ゲートを通す

```bash
npx tsc --noEmit
npm test
npm run build
npm audit --omit=dev
```

現時点では `npx tsc --noEmit` が失敗するため、まず修正する。

### Step 2: migration を一本化する

- `server/migrations/*.sql` だけで空DBを構築できる状態にする。
- `npm run db:migrate` を本番用の唯一の導線にする。
- `auth.users` / Supabase 前提を明示する。
- local-only scaffold は `doc/` に残す場合でも「参考資料」と明記する。

### Step 3: Supabase Auth + `risepath-vm` DB を接続する

- Supabase project 作成（**Auth のみ** — データ DB は VM）
- Auth provider 設定
- `risepath-vm` で Docker スタック起動（[`risepath_vm_deployment.md`](./risepath_vm_deployment.md)）
- `DATABASE_URL_PHASE1` を `risepath-vm` / `risepath` に設定
- `npm run db:migrate` 実行
- seed data 投入（`008_seed_learning_portals.sql` 等）

### Step 4: `VITE_DEMO_MODE=false` で確認する

確認対象:

1. メール登録
2. ログイン
3. プロフィール取得/更新
4. Learning Hub 表示
5. AI Course Generator
6. カリキュラム保存
7. 学習進捗保存
8. 通知既読
9. ログアウト/再ログイン後の復元

### Step 5: デプロイする

推奨構成（2026-06-23 方針）:

| コンポーネント | 推奨先 |
|---|---|
| Frontend | Vercel（静的） |
| **Rise Path 実行スタック** | **専用 GCP VM `risepath-vm` + Docker Compose**（db + api + mcp + hermes） |
| Auth | Supabase Auth のみ（データ DB は VM） |
| ファイル | GCS（計画） |

正本: [`doc/risepath_vm_deployment.md`](./risepath_vm_deployment.md)

**やらないこと:** `nexloom-gce` 上の ai-note-meet / gemini5 Hermes 設定を Rise Path 用に変更する。

## 7. Done 定義

実プロダクト移行完了の条件:

- [ ] `VITE_DEMO_MODE=false` で主要画面が実DBからデータ取得できる
- [ ] Supabase JWT で user scope が効いている
- [ ] ゲスト/モック/fallback が production で意図せず使われない
- [ ] 空DBから migration + seed で環境再現できる
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` が通る
- [ ] `npm audit --omit=dev` の high が 0 または許容理由が記録されている
- [ ] production URL でログイン→保存→再ログイン復元が確認済み
- [ ] rollback / env rotation / monitoring の運用手順がある
- [ ] GCS オブジェクトストレージ（Rise Path ファイル）— 実装は別途（`doc/portable_deployment.md` / `doc/database_topology.md`）

## 8. 関連ファイル

- [`doc/risepath_vm_deployment.md`](./risepath_vm_deployment.md) — **専用 VM + Docker 正本**
- [`doc/portable_deployment.md`](./portable_deployment.md) — GCS、引っ越し
- `deploy/risepath-vm/stack.env.example`
- [`doc/env_migration_safety.md`](./env_migration_safety.md) — secrets の安全な移行
- `secrets.inventory.template` — 変数名のみの棚卸し
- `env.local.template`
- `services/curriculumApi.ts`
- `services/apiClient.ts`
- `services/supabaseClient.ts`
- `context/AuthContext.tsx`
- `server.js`
- `server/db.js`
- `server/middleware/auth.js`
- `server/routes/content.js`
- `server/routes/user.js`
- `server/routes/chatgptCurriculum.js`
- `server/migrations/`
- `doc/implementation_progress.md`
