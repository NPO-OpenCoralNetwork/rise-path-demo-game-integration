# 環境変数（secrets）の安全な引っ越し

> 更新日: 2026-06-22  
> 対象: Rise Path（`.env.local`）、Nexloom VM（`backend/.env` / `stack.env`）、Docker Compose

## 原則

| # | 原則 |
|---|------|
| 1 | **Git に実値を載せない** — `*.template` / `secrets.inventory.template` のみコミット |
| 2 | **平文で送らない** — Slack、issue、Nexloom ページ、メールに秘密を書かない |
| 3 | **1 環境 = 1 セット** — 本番と staging でキー・DB パスワードを分離 |
| 4 | **引っ越し後ローテ** — DB パスワード、GCS HMAC、Supabase `service_role` を優先 |
| 5 | **最小権限** — `risepath_app` は `risepath` のみ、GCS はバケット単位 HMAC |

---

## 置き場所の推奨

| 用途 | 置き場所 |
|------|----------|
| 開発 Mac | `.env.local`（`chmod 600`）、テンプレは `env.local.template` |
| Rise Path 本番 VM / Compose | `/opt/risepath/deploy/risepath-vm/stack.env`（`chmod 600`）— 正本: [`risepath_vm_deployment.md`](./risepath_vm_deployment.md) §4.2 |
| Nexloom レガシー VM / Compose | `/home/nexloom/stack/stack.env`（`chmod 600`、所有者 `nexloom`） |
| 長期保管 | パスワードマネージャ + 任意で **GCP Secret Manager** |
| 持ち運び | **GPG 暗号化** `secrets.prod.env.gpg`（リポジトリ外） |

Docker:

```bash
docker compose --env-file /path/to/stack.env up -d
```

compose ファイル内に秘密を直書きしない。

---

## 引っ越しフロー

### Phase A — 棚卸し（値は書かない）

`secrets.inventory.template` を開き、各変数を **SET / MISSING / PLACEHOLDER**（`npm run env:inventory`）または手動で **ROTATE 予定** をマークする。

```bash
cd rise-path-demo-game-integration
npm run env:inventory                      # default --scope rise-path → .env.local
npm run env:inventory -- --scope nexloom --path /path/to/backend/.env
npm run env:inventory -- --scope stack --path /path/to/stack.env
npm run env:inventory -- --scope all       # 全キー（通常は不要）
```

### プロダクト別の Supabase キー名

| プロダクト | 変数名 |
|------------|--------|
| Rise Path（`server.js` / `.env.local`） | `SUPABASE_SERVICE_ROLE_KEY` |
| Nexloom / `stack.env` | `SUPABASE_SERVICE_KEY` |

同じダッシュボードの **service_role** キーだが、**変数名はコードに合わせて両方セット**（Rise Path ファイルに `SUPABASE_SERVICE_KEY` だけ書いても Rise Path は読まない）。

### Phase B — 新環境で再作成

1. 新 VM で Postgres bootstrap（`risepath` / `autogrants`）
2. 新 **GCS HMAC** キー（バケット: `nexloom-assets-*`, `risepath-assets-*`）
3. Supabase Dashboard で service key **再生成**（移行完了後に旧キー無効化）
4. `stack.env` を **新規作成**（旧 `.env` を scp 丸ごとコピーしない運用を推奨）
5. Mac: `DATABASE_URL_PHASE1` は `scripts/sync-db-url-from-vm.py` または手入力（チャットに貼らない）

### Phase C — データと切替

```bash
# 例: risepath（ホスト・ユーザーは環境に合わせる）
pg_dump -Fc -d risepath -h OLD_HOST -U risepath_app -f risepath.dump
pg_restore -d risepath -h NEW_HOST -U risepath_app --no-owner risepath.dump
```

GCS バケットを **同じ GCP プロジェクト**で使い続ける場合、env のバケット名はそのまま、**VM だけ**差し替え。

切替順:

1. 新環境でスモーク（API、1 回アップロード、1 ページ読み取り）
2. Tailscale 名 / DNS を切る（短いメンテ窓）
3. 旧 VM: サービス停止 → パスワード変更 → `.env` 削除

### Phase D — 検証

```bash
npm run env:check
npm run env:check -- --db
```

Nexloom VM では必須キーの存在のみ確認するスクリプトを運用（値は出さない）。

---

## 変数ごとの扱い

| 変数群 | 引っ越し | ローテ |
|--------|----------|--------|
| `VITE_SUPABASE_*` | 通常そのまま | anon は低リスク、漏洩時は再発行 |
| `SUPABASE_SERVICE_ROLE_KEY` | 再設定 | **強く推奨** |
| `DATABASE_URL` / `DATABASE_URL_PHASE1` | **ホスト名・パスワード変更** | **推奨** |
| `ASSET_S3_*`（GCS HMAC） | 新キー | **推奨** |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | 再設定 | 漏洩疑い時 |

### Rise Path 注意

- `VITE_*` は **ビルド時に埋まる**。本番ビルドパイプラインの secret と `.env.local` を一致させる。
- `DATABASE_URL_PHASE1` は **サーバー専用**。フロントバンドルに含めない。

---

## やってはいけないこと

- 旧 `.env` を Git にコミット（誤コミット時は **即ローテ** + `git filter-repo` 検討）
- Nexloom 共有ページに接続文字列・キーを書く
- `export $(cat .env | xargs)` でログに漏らしやすい起動
- 引っ越し後も旧 VM で同じ DB パスワードを有効にしたまま放置

---

## GPG 持ち運び（最小手順）

```bash
# 旧ホスト（一度だけ）
gpg -c -o secrets.prod.env.gpg secrets.prod.env
shred -u secrets.prod.env 2>/dev/null || rm -f secrets.prod.env

# 新ホスト
gpg -d secrets.prod.env.gpg > stack.env
chmod 600 stack.env
rm -f secrets.prod.env.gpg
```

---

## 関連

- [`portable_deployment.md`](./portable_deployment.md)
- [`database_topology.md`](./database_topology.md)
- `secrets.inventory.template`
- `scripts/verify-env-inventory.mjs`