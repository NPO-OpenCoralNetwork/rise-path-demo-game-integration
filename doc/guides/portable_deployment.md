# ポータブルデプロイ（Docker + GCS + env 引っ越し）

> 更新日: 2026-06-23  
> ステータス: Active（設計・運用手順）  
> **Nexloom ストレージ・GCS・VM 移行の運用正本**は ai-note-meet リポジトリ:  
> `docs/ops/runbooks/STORAGE_GCS_SUPABASE_GCP_MIGRATION.md` と `deploy/nexloom-gce/`  
> **Rise Path 実行環境（DB〜Hermes）の正本**は [`risepath_vm_deployment.md`](./risepath_vm_deployment.md)（専用 VM `risepath-vm`）。  
> 本ファイルは GCS・引っ越し・Nexloom 共有インフラのメモです。

## 目的 / 結論 / 次アクション

- **目的**: Supabase 無料枠（DB 500MB / File 1GB）と VM ベタ置き依存を減らし、引っ越しコストを下げる。
- **結論**:
  - **Nexloom**: ページ・メタは Supabase Postgres、**大きいファイルは GCS**（`ASSET_STORAGE_PROVIDER=aws_s3` + GCS S3 互換 HMAC）。
  - **Rise Path**: 構造化データは **専用 VM `risepath-vm` の `risepath` Postgres（Docker）**、**ファイルは GCS**（実装は順次）。
  - **一発起動** = `deploy/risepath-vm/docker-compose.yml` + `stack.env` + `db:migrate`（Compose 実装は未着手）。
  - **nexloom-gce への risepath 追加は行わない** — ai-note-meet を壊さないため。
- **次アクション**: `risepath-vm` プロビジョニング → Compose 実装 → GCS バケット → `nexloom-gce` からの pg_dump 移行（データがある場合）。

---

## 1. ストレージの落とし所（Nexloom + 教室）

| データ | 保存先 | 備考 |
|--------|--------|------|
| ページ・チャット・タスク | Supabase Postgres | DB 500MB に注意。全文を blocks に詰めない |
| 添付・PDF・録音・Asset | **GCS** | Nexloom は S3 プロバイダ + GCS エンドポイント |
| `docs/public` Markdown | VM ディスク + Git | Supabase 枠外 |
| Auth | Supabase Auth | 引っ越し時も SaaS のまま（URL/キーは維持 or ローテ） |

参考（Nexloom リポジトリ側）:

- `docs/architecture/S3_UNIFIED_ATTACHMENT_ARCHITECTURE.md`
- `docs/architecture/ASSET_STORAGE_AND_EXTRACTION_ARCHITECTURE.md`

---

## 2. Rise Path + GCS

| データ | 保存先 |
|--------|--------|
| 診断・ジャーナル・Phase 16 日次レコード | Postgres `risepath` |
| プロフィール画像・教材 PDF・ゲームアセット・エクスポート | **GCS** `risepath-assets-{env}` |
| DB 行 | `object_key` または signed URL メタのみ（バイナリは GCS） |

環境変数（将来のサーバー実装用・テンプレ）: `secrets.inventory.template` / `env.local.template` の GCS 節を参照。

詳細トポロジ: [`database_topology.md`](./database_topology.md)

---

## 3. Docker スタック（現状と目標）

### 既存

`~/Works/_ops/nexloom-gce/docker/docker-compose.yml`:

- `postgres`（autogrants）
- `ollama`
- `auto-grants` (:8002)
- `ai-note-meet` MCP (:8000)

本番 VM では **systemd の `backend/.env`** がフル API の正本である場合がある。Compose の `ai-note-meet` は **MCP_ONLY** 用だが、`stack.env` の **`ASSET_*` はコンテナに渡す**（GCS 試験は Compose で可能）。

### Rise Path 専用 stack（正本 — nexloom-gce とは別 VM）

**採用方針（2026-06-23）:** `nexloom-gce` の Compose 拡張は **しない**。  
Rise Path は **`risepath-vm`** 上で単独スタックを動かす。

```text
# deploy/risepath-vm/docker-compose.yml（目標・未作成）
services:
  db        # Postgres risepath
  api       # Express server.js :3006
  mcp       # MCP SSE :3100
  hermes    # rise-path profile :8642
  proxy     # 任意: caddy / traefik
```

詳細: [`risepath_vm_deployment.md`](./risepath_vm_deployment.md)

`nexloom-gce` 既存 stack（変更しない）:

```text
postgres-autogrants, ollama, auto-grants, ai-note-meet MCP, gemini5 Hermes
```

---

## 4. env の安全な引っ越し

**秘密をコピーするのではなく、新環境で再配置し、旧露出面を閉じる。**

手順の正本: [`env_migration_safety.md`](./env_migration_safety.md)

要約:

1. **棚卸し** — `secrets.inventory.template`（変数名のみ）
2. **新環境で作り直し** — DB パスワード・GCS HMAC・（推奨）Supabase service key ローテ
3. **データ** — `pg_dump` / `pg_restore`、GCS バケットは同一プロジェクトなら VM だけ差し替え
4. **切替** — スモーク後 DNS/Tailscale、旧 VM 停止・秘密削除
5. **検証** — `npm run env:check`（Rise Path）、`npm run env:inventory`（デフォルト `--scope rise-path`、値は表示しない）

暗号化持ち運び（やむを得ない場合）:

```bash
gpg -c -o secrets.prod.env.gpg secrets.prod.env
# 新ホストで復号 → chmod 600 → gpg ファイル削除
```

---

## 5. GCS 接続（Nexloom バックエンド）

Nexloom `ALLOWED_PROVIDERS`: `aws_s3`, `supabase_storage`（GCS 専用名は無い）。

| 変数 | 例 |
|------|-----|
| `ASSET_STORAGE_PROVIDER` | `aws_s3` |
| `ASSET_S3_BUCKET` | `nexloom-assets-prod` |
| `ASSET_S3_ENDPOINT` | `https://storage.googleapis.com` |
| `ASSET_S3_ACCESS_KEY` / `SECRET` | GCS **HMAC キー** |
| `ASSET_UPLOAD_STRICT` | `true`（本番推奨） |

ステージングで 1 ファイルアップロード → `assets` テーブルの `provider` とオブジェクト実体を確認してから本番反映。

---

## 6. 引っ越しチェックリスト

- [ ] `stack.env` / `.env.local` が Git に無い
- [ ] 新ホストで `env:check` / DB ping 成功
- [ ] GCS / DB パスワードを少なくとも 1 つローテ（理想は全部）
- [ ] 旧 VM の 5432/8000 を閉じた or 廃止
- [ ] Nexloom 教室向けナレッジに秘密を書いていない

---

## 7. 関連ドキュメント

| ファイル | 内容 |
|----------|------|
| [`env_migration_safety.md`](./env_migration_safety.md) | env 引っ越し詳細 |
| [`database_topology.md`](./database_topology.md) | Auth / risepath / GCS |
| [`prod_readiness_plan.md`](./prod_readiness_plan.md) | Issue #15〜 |
| `secrets.inventory.template` | 変数名一覧 |
| `~/Works/_ops/nexloom-gce/docker/README.md` | Compose 運用 |