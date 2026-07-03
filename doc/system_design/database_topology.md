# Rise Path データベーストポロジー

> 更新日: 2026-06-23  
> 方針: **Supabase = 認証のみ** / **アプリデータ = 専用 VM `risepath-vm` 上の PostgreSQL `risepath`（Docker）** / **バイナリ = GCS（計画）**  
> デプロイ正本: [`risepath_vm_deployment.md`](./risepath_vm_deployment.md)

## なぜ分けるか

| 懸念 | 対策 |
|------|------|
| ai-note-meet / auto-grants 等との混在 | **専用 VM `risepath-vm`**。`nexloom-gce` は変更しない |
| auto-grants など別 DB への誤接続 | DB 名 `risepath` + ロール `risepath_app` のみ |
| LLM / MCP が別プロダクトを触る | Rise Path 専用 Hermes + MCP allowlist（[`hermes/README.md`](../hermes/README.md)） |
| Supabase Postgres と混在 | データ用 URI に **Supabase pooler を使わない** |

## 目標構成図（本番）

```text
[Browser]
   │ Supabase Auth (JWT: user id)
   ▼
[Vercel 等] フロント ──► [risepath-vm / Tailscale]
                              │
                    docker compose
                    ├── db (Postgres risepath)
                    ├── api (Express :3006)
                    ├── mcp (SSE :3100)
                    └── hermes (API :8642, rise-path profile)
```

Mac 開発時は Vite :3007 が API にプロキシ。DB / Hermes は Tailscale 経由で `risepath-vm`、またはローカル Docker / 暫定ホストを向ける。

## ホスト名

| ホスト | 用途 | 備考 |
|--------|------|------|
| **`risepath-vm`** | **本番・ステージングの正本** | 新規 GCP VM + Tailscale |
| `nexloom-gce` | **暫定 / レガシー** | 移行期間のみ。ai-note-meet 同居 VM — **拡張しない** |
| `localhost` | ローカル Docker Compose | 開発用 |

```bash
tailscale status | grep risepath
tailscale ping risepath-vm
```

接続文字列例:

```text
postgresql://risepath_app:PASSWORD@risepath-vm:5432/risepath?sslmode=disable
```

Tailscale 内前提なら `sslmode=disable` が多い。インターネット公開時は TLS + `pg_hba` 必須。

## VM 上での初回セットアップ（推奨: Docker）

**正本手順:** [`risepath_vm_deployment.md`](./risepath_vm_deployment.md) §4

```bash
cd deploy/risepath-vm
cp stack.env.example stack.env
docker compose --env-file stack.env up -d
docker compose exec api npm run db:migrate
```

### レガシー: nexloom-gce 上の bare Postgres bootstrap

移行完了前のみ。新規環境では **使わない**。

```bash
scp scripts/vm/postgres_risepath_bootstrap.sql nexloom-gce:/tmp/
ssh nexloom-gce
sudo -u postgres psql -f /tmp/postgres_risepath_bootstrap.sql
```

## `.env.local` のルール

| 変数 | 入れてよいもの |
|------|----------------|
| `VITE_SUPABASE_*`, `SUPABASE_*` | Supabase **Auth** 用のみ |
| `DATABASE_URL_PHASE1` | **`risepath-vm`（推奨）** または移行期間の `nexloom-gce` / ローカル Docker |
| `HERMES_API_URL` | 同 VM 内 `http://hermes:8642`（Compose）または `http://risepath-vm:8642`（Mac から） |
| 入れてはいけない | `autogrants` URL、Supabase Postgres pooler（データ用）、他プロダクトの DB URL |

検証:

```bash
npm run env:check
npm run env:check -- --db
```

## migration（Issue #16 — 完了）

- 適用先: **`risepath` データベースのみ**（ホストは `risepath-vm` が正本）
- 正本: `server/migrations/000`〜`008` + `npm run db:migrate`
- Supabase user UUID → VM 側 `auth.users` **スタブ**（`syncAuthUserStub`）
- RLS は VM Postgres では未使用。ユーザー分離は Express JWT + `user_id` カラム

## Hermes / MCP の分離

| 対象 | 分離方法 |
|------|----------|
| ai-note-meet（`nexloom-gce`） | **別 VM・別 Hermes** — Rise Path から参照しない |
| 開発者個人 Hermes（`default` プロファイル） | Rise Path 本番では使わない |
| Rise Path | 専用 `rise-path` プロファイル + MCP `rise_path` allowlist |
| 学習者（エンドユーザー） | 1 台の Hermes が `rp:user:{uuid}` でデータスコープ（VM 増設不要） |

## オブジェクトストレージ（GCS）

構造化データは **`risepath` Postgres**。ファイルは GCS `risepath-assets-{env}`（実装は順次）。

| 種類 | 保存先 |
|------|--------|
| ジャーナル・診断・進捗 | Postgres `risepath` |
| プロフィール画像・教材 PDF 等 | GCS |

Nexloom 教室向け添付は別バケット（[`portable_deployment.md`](./portable_deployment.md)）。

## 関連

- [`risepath_vm_deployment.md`](./risepath_vm_deployment.md) — **専用 VM + Docker 正本**
- [`architecture_v3_hermes_agent.md`](./architecture_v3_hermes_agent.md)
- [`env_local_setup_issue15.md`](./env_local_setup_issue15.md)
- [`portable_deployment.md`](./portable_deployment.md)
- `deploy/risepath-vm/stack.env.example`
- `scripts/vm/postgres_risepath_bootstrap.sql`（レガシー）