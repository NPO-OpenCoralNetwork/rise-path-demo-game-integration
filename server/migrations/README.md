# Rise Path DB migrations

> 適用先: **専用 VM `risepath-vm`** の PostgreSQL **`risepath`**（Docker Compose）  
> 移行期間の暫定: `nexloom-gce` / `risepath`（新規環境では使わない）  
> 認証: **Supabase Auth**（JWT）。`auth.users` は VM 側の ID スタブ（`000_extensions_and_auth.sql`）。  
> デプロイ正本: [`doc/risepath_vm_deployment.md`](../../doc/risepath_vm_deployment.md)

## 認証と FK（`auth.users` スタブ）

Supabase Auth は外部、データは `risepath-vm`（または移行期間の `nexloom-gce`）上の `risepath`。`auth.users` は UUID のみのスタブテーブル。  
同期は `server/db.js` の `syncAuthUserStub` が担い、Express / MCP SSE / MCP stdio（`resolveMcpUserId`）の各入口で呼ばれる。

## 実行

```bash
# .env.local に DATABASE_URL_PHASE1 が必要
npm run db:migrate
npm run db:migrate:status
```

`scripts/db-migrate.mjs` が `schema_migrations` テーブルで適用済みを追跡します。  
再実行しても未適用分だけ流します。

## チェーン（Issue #16）

| ファイル | 内容 |
|----------|------|
| `000_extensions_and_auth.sql` | pgcrypto, vector, `auth.users` スタブ, triggers |
| `001_core_curriculum.sql` | curricula, versions, materials, jobs, portals, AI sessions |
| `002_user_app_tables.sql` | user_profiles, progress, events, notifications |
| `003_learner_profiles.sql` | 診断プロファイル |
| `004_learning_journal.sql` | レッスン単位ジャーナル |
| `005_mcp_sessions.sql` | MCP 監査ログ |
| `006_life_journal.sql` | 日次ダイアリー・生活習慣 |
| `007_agent_tables.sql` | Hermes プロキシ consent / session binding |
| `008_seed_learning_portals.sql` | Learning Hub カード seed |

## 参考資料（適用しない）

- `doc/ai-curriculum-spec/local_postgres_phase1.sql` — 001 の元ネタ（アーカイブ）
- `doc/local_postgres.sql` — 旧スキーマ + seed 元（アーカイブ）
- `scripts/migrate_curricula.js` — 廃止（列は 001 に統合済み）

関連: [`doc/database_topology.md`](../../doc/database_topology.md), [`doc/env_local_setup_issue15.md`](../../doc/env_local_setup_issue15.md)