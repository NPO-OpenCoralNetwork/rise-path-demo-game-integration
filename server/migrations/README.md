# Rise Path DB migrations

> 適用先: **専用 VM `risepath-vm`** の PostgreSQL **`risepath`**（Docker Compose）  
> 移行期間の暫定: `nexloom-gce` / `risepath`（新規環境では使わない）  
> 認証: **Supabase Auth**（JWT）。`auth.users` は VM 側の ID スタブ（`000_extensions_and_auth.sql`）。  
> デプロイ正本: [`doc/guides/risepath_vm_deployment.md`](../../doc/guides/risepath_vm_deployment.md)

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

VM では、新しい `api` イメージを起動する前に適用します。未適用があると `/api/v2/health` が 503 になり、`api` の healthcheck が通りません。`deploy/risepath-vm/scripts/deploy-stack.sh` はこの順で流します。

## チェーン（Issue #16）

| ファイル | 内容 |
|----------|------|
| `000_extensions_and_auth.sql` | pgcrypto, vector（Postgres に pgvector があるときだけ。VM の db イメージ `pgvector/pgvector:0.8.7-pg16` にはある）, `auth.users` スタブ, triggers |
| `001_core_curriculum.sql` | curricula, versions, materials, jobs, portals, AI sessions, `material_chunks`（vector があれば `embedding vector(768)` + HNSW インデックス、無ければ `FLOAT8[]`） |
| `002_user_app_tables.sql` | user_profiles, progress, events, notifications |
| `003_learner_profiles.sql` | 診断プロファイル |
| `004_learning_journal.sql` | レッスン単位ジャーナル |
| `005_mcp_sessions.sql` | MCP 監査ログ |
| `006_life_journal.sql` | 日次ダイアリー・生活習慣 |
| `007_agent_tables.sql` | Hermes プロキシ consent / session binding |
| `008_seed_learning_portals.sql` | Learning Hub カード seed |
| `009_learner_memory_meta.sql` | 学習者メモリの同期メタデータ |
| `010_material_chunks_embedding_model_idx.sql` | RAG の埋め込みモデル判定用インデックス（`CONCURRENTLY` なし。作成中は `material_chunks` への書き込みが待たされる） |
| `011_seed_claude_code_portal.sql` | Learning Hub に Claude Code コースのカードを追加 |
| `012_update_claude_code_portal_copy.sql` | Claude Code カードの説明文を更新（011 の文面のままの行だけ。管理者が編集した説明は残す） |
| `013_ai_daily_usage.sql` | 有料AI機能の日次利用カウンタ（ユーザー別・接続元アドレス別・全体の合計。日本時間の日付で区切る） |

### pgvector（RAG のベクトル検索）

`material_chunks.embedding` の型は、001 を最初に流したときに決まります。VM の db イメージは pgvector 入りなので、新しい空の DB では 000 が `vector` 拡張を作り、001 が `vector(768)` の列と HNSW インデックスを作ります。RAG はベクトル検索で動きます（埋め込みには `GEMINI_API_KEY` と `GEMINI_ALLOWED=true` が要ります。`GEMINI_ALLOWED` は 18 歳未満の人が使えない環境でだけ設定します。設定しないあいだは、ベクトル列があってもキーワード検索で動きます）。

pgvector の無い Postgres（たとえば `postgres:16-alpine`）では、000 は `vector` を飛ばし、列は `FLOAT8[]` になります。このとき RAG はキーワード検索で動きます。001 は 2 回目以降は流れないので、あとから pgvector 入りのイメージに替えても列は変わりません。ベクトル検索になるのは、新しい空のボリュームから始めたときだけです。

## 参考資料（適用しない）

- `doc/ai-curriculum-spec/local_postgres_phase1.sql` — 001 の元ネタ（アーカイブ）
- `doc/local_postgres.sql` — 旧スキーマ + seed 元（アーカイブ）
- `scripts/migrate_curricula.js` — 廃止（列は 001 に統合済み）

関連: [`doc/system_design/database_topology.md`](../../doc/system_design/database_topology.md), [`doc/guides/env_local_setup_issue15.md`](../../doc/guides/env_local_setup_issue15.md)