# Rise Path DB migrations

> 本番の適用先: **専用 VM `risepath-vm`** の PostgreSQL **`risepath`**（Docker Compose。`deploy/risepath-vm/scripts/deploy-stack.sh` が当てます）\
> 開発の適用先: Mac の中だけの開発用の DB（[`doc/guides/first-launch.ja.md`](../../doc/guides/first-launch.ja.md) の 18 章）\
> 移行期間の暫定: `nexloom-gce` / `risepath`（新規環境では使わない）  
> 認証: **Supabase Auth**（JWT）。`auth.users` は VM 側の ID スタブ（`000_extensions_and_auth.sql`）。  
> デプロイ正本: [`doc/guides/risepath_vm_deployment.md`](../../doc/guides/risepath_vm_deployment.md)

## 認証と FK（`auth.users` スタブ）

Supabase Auth は外部、データは `risepath-vm`（または移行期間の `nexloom-gce`）上の `risepath`。`auth.users` は UUID のみのスタブテーブル。  
同期は `server/db.js` の `syncAuthUserStub` が担い、Express / MCP SSE / MCP stdio（`resolveMcpUserId`）の各入口で呼ばれる。

## 実行

`npm run db:migrate` は、`.env.local` の `DATABASE_URL_PHASE1` に当たります。開発に使う Mac では、これは開発用の DB（`127.0.0.1:5433`。[手順書の 18 章](../../doc/guides/first-launch.ja.md)）です。Mac から本番には流しません（D8）。

本番（`risepath-vm`）は、下の段落のとおり `deploy-stack.sh` が当てます。

```bash
# .env.local の DATABASE_URL_PHASE1 が開発用の DB であることを確かめてから
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
| `014_minor_safeguards.sql` | 未成年の保護（Phase 0.5）: `user_age`（生年月のみ。日は常に 1）、`account_consents`（保護者の AI 利用同意。追記のみ、取り消しは `revoked_at`）、`ai_safety_events`（ブロック・報告・相談先の表示。報告の本文は 90 日、イベントは 365 日で整理） |
| `015_mcp_oauth_grants.sql` | 接続したアプリ（Phase 1）: `mcp_oauth_grants`（学習者と OAuth クライアントの組ごとに 1 行。最初と最後に使った日時はリモート MCP サーバーが書く。取り消すと `revoked_at` を入れ（Supabase の `revokeGrant` の前と後の 2 回）、それより前に発行されたトークンは数秒以内に使えなくなる。アプリの名前 `client_name` も取り消しのときに入れる。一度も使わずに取り消したアプリは、使った日時が NULL） |
| `016_lesson_progress.sql` | レッスンの進み具合（Phase 2）: `lesson_progress`（学習者と公開レッスンの組ごとに 1 行。読んだブロック・解答・チェック・自己評価の記録と、そこから計算した `pct`・`state`。ブラウザから届いた記録はそのまま保存せず、サーバーで整えてから保存済みの記録とまとめる。1 行 64 KiB まで）、`lesson_progress_resets`（「レッスンの進み具合を消す」を使った学習者ごとに 1 行。消すたびに `epoch` が変わり、消す前の記録を持つ端末からの保存は 409 で断る）。リモート MCP のロールには `lesson_progress` の SELECT・INSERT・UPDATE だけを渡す（適用後に `deploy/risepath-vm/sql/mcp_remote_role.sql` を流し直す） |
| `017_billing.sql` | 有料のサポータープラン（Phase 3）: `billing_customers`（学習者とモード（テスト・本番）ごとに Stripe の顧客 1 件。顧客はサーバーが作り、送るのは `metadata[user_id]` だけ。名前やメールは送らない）、`billing_subscriptions`（Stripe から読み直した契約の最新の状態。`synced_at` は読み始めた時刻で、それより新しい行は上書きしない）、`billing_events`（Webhook のイベント ID ごとに 1 行。再送と重複を 1 回だけ処理する）。課金を使わないあいだも適用が要る（未適用だと `/api/v2/health` が 503）。リモート MCP のロールには何も渡さない。アカウントを消しても記録は残し、学習者とのつながり（`user_id`）だけを NULL にする |
| `018_account_deletion_and_legal.sql` | アカウントの削除と同意の記録（Phase 4）: ブロックしていた 4 つの外部キーを SET NULL・CASCADE に、`account_deletions`（削除の記録。外部キーなし。5 年）、`auth.users` のトリガー（削除したアカウントの行を作り直さない。削除中は待つ）、`legal_document_versions`（同意した版とハッシュ。追記のみ）、`legal_acceptances`（規約の同意。アカウントを消しても ID・版・日時だけ 5 年）、`account_consent_proofs`（保護者の同意。削除したアカウントの分を 5 年）、`ai_app_provision_records`（使っていた AI アプリ。削除したアカウントの分を 3 年）、`jobs` の保存期間の索引。ログインした呼び出しのたびに `account_deletions` を読むので、このリリースの api・mcp・mcp-public を起動する前に適用が要る（ローカルの開発用データベースでも `npm run db:migrate`）。未適用のままだと、ログインした呼び出しはアプリで 503（ログインが任意の呼び出しはゲストとして扱う）、SSE の MCP で 401、リモート MCP で 503 になる。適用後に `deploy/risepath-vm/sql/mcp_remote_role.sql` を流し直す。確かめ方: `scripts/db/verify-account-deletion.mjs` |
| `019_phase5_learning.sql` | 1 つのレッスンのやり直し、XP、学んだ日（Phase 5）。`lesson_progress_lesson_resets`（学習者とレッスンの組ごとに 1 行。やり直すたびに `lesson_epoch` と `reset_at` が変わり、前の記録を持つ端末からの保存はそのレッスンだけ断る。進み具合をすべて消しても残り、アカウントの削除で消える）、`xp_awards`（XP をもらった記録。1 つのレッスン・ステージ・段階につき 1 回だけ。サーバーの記録から数え、学習の履歴からは数えない）、`learning_days`（学んだ日。日本時間の日付だけ）。既にある記録から XP と学んだ日を数え直す。リモート MCP のロールには何も渡さない（`mcp_remote_role.sql` の流し直しは不要）。api・mcp・mcp-public を起動する前に適用。適用中にアカウントの削除が重なると、どちらかがデッドロック（40P01）で取り消されることがある（どちらも全部が取り消され、データは変わらない）。019 が失敗したら `npm run db:migrate`（VM では `deploy-stack.sh`）をもう一度流し、削除が失敗したら削除をやり直す。デプロイ中はスタッフの削除をしない。確かめ方: `scripts/db/verify-phase5.mjs` |
| `020_review_queue.sql` | 復習（Phase 6）: レッスンのカードが、忘れかけたころにもう一度出る。`review_cards`（学習者とカードの組ごとに 1 行。コース・レッスン・カードの ID、レッスンで学んだ日時、覚えている度合いの目安、次に出す日、復習の回数と最後の結果、あとから足したカードを見分けるための、レッスンの記録を最後に確かめた日時）、`review_log`（復習 1 回ごとに 1 行。追記のみ。1 枚のカードは 1 日 1 回まで。外部キーは `review_cards` だけ）、`lesson_progress.progress_changed_at`（記録の中身が変わった日時。トリガーが入れ、読み込みの書き戻しや中身の変わらない保存では動かさない。送られた値は使わない）。カードが加わるのは、サーバーのレッスンの記録が「終えた」（read・checked・mastered）か、そのカードに印（「覚えた」「もう一度」）があるときだけで、次に復習を読んだときに加わる（最初の復習の前に印を付け直すと、最初の目安を決め直す）。既にある記録からは何も作らない（カードの ID はレッスンのファイルにあるため。リリース前に終えたレッスンのカードは、最初に復習を読んだときに加わる）。レッスンのやり直しでそのレッスンの分を、「学習の進み具合を消す」ですべてを消し、アカウントの削除で消える。api・mcp・mcp-public を起動する前に適用。適用後、BYOA を使っているときは `deploy/risepath-vm/sql/mcp_remote_role.sql` を流し直す（流すまで、AI アプリの復習のツールは使えない）。適用中にアカウントの削除が重なっても、デッドロック（40P01）にはならない（2 つの表を先に作り、`lesson_progress` をあとで変える順番のため）。ただし削除は 020 が終わるまで待ち、10 秒を超えると `account_busy` で終わる（削除をやり直す）。020 は終わるまで `auth.users` をロックするので、ログインした呼び出しも 020 が終わるまで待つ（`lesson_progress` を使う開いたままのトランザクションがあると、020 はそれも待つ）。人の少ない時間に適用する。確かめ方: `scripts/db/verify-phase6.mjs` |
| `021_training_cohorts.sql` | 職業訓練の期と割り当て（`doc/brushup-2026/training-plan.ja.md` の 4.3）: `training_cohorts`（期ごとに 1 行。アカウントの ID は持たない）、`training_memberships`（期と学習者の組ごとに 1 行。役割は受講者・講師・確認用・職員）。`training_memberships` は `auth.users` に外部キーを張らず、アカウントの削除では消さずに、削除の記録と同じ日時の印（`account_deleted_at`）を付けて残す。保存期間が決まるまで、自動では消さない。1 つの期に生きている行は 1 人 1 行（印のない行だけに一意の制約）。`TRAINING_ENABLED` のないデプロイでは空のまま。リモート MCP のロールには何も渡さない（`mcp_remote_role.sql` の流し直しは不要）。api・mcp・mcp-public を起動する前に適用（未適用のままだと、アカウントの削除が 42P01 で取り消されて `deletion_unavailable` になる）。新しい表を作るだけなので、適用中のアカウントの削除と重なってもデッドロックにはならない。確かめ方: `scripts/db/verify-account-deletion.mjs` |

CI の `Database checks`（`.github/workflows/e2e.yml`、`scripts/ci/db-checks.sh`）が、VM と同じ pgvector のイメージで、確かめ方の 3 つのスクリプトと migration の 2 回の適用を、プルリクエストのたびに動かします。

### pgvector（RAG のベクトル検索）

`material_chunks.embedding` の型は、001 を最初に流したときに決まります。VM の db イメージは pgvector 入りなので、新しい空の DB では 000 が `vector` 拡張を作り、001 が `vector(768)` の列と HNSW インデックスを作ります。RAG はベクトル検索で動きます（埋め込みには `GEMINI_API_KEY` と `GEMINI_ALLOWED=true` が要ります。`GEMINI_ALLOWED` は 18 歳未満の人が使えない環境でだけ設定します。設定しないあいだは、ベクトル列があってもキーワード検索で動きます）。

pgvector の無い Postgres（たとえば `postgres:16-alpine`）では、000 は `vector` を飛ばし、列は `FLOAT8[]` になります。このとき RAG はキーワード検索で動きます。001 は 2 回目以降は流れないので、あとから pgvector 入りのイメージに替えても列は変わりません。ベクトル検索になるのは、新しい空のボリュームから始めたときだけです。

## 参考資料（適用しない）

- `doc/ai-curriculum-spec/local_postgres_phase1.sql` — 001 の元ネタ（アーカイブ）
- `doc/local_postgres.sql` — 旧スキーマ + seed 元（アーカイブ）
- `scripts/migrate_curricula.js` — 廃止（列は 001 に統合済み）

関連: [`doc/system_design/database_topology.md`](../../doc/system_design/database_topology.md), [`doc/guides/env_local_setup_issue15.md`](../../doc/guides/env_local_setup_issue15.md)