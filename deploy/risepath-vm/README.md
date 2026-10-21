# Rise Path VM deploy (`risepath-vm`)

正本: [`doc/guides/risepath_vm_deployment.md`](../../doc/guides/risepath_vm_deployment.md) / フロント（Vercel）と切り替え手順: [`deploy/vercel/README.md`](../vercel/README.md)

2026-10-21 時点で、オーナーの報告では VM は使っていません。再開と公開エッジへの切り替えは [`deploy/vercel/README.md`](../vercel/README.md) の「オーナー作業」に沿って進めます。

## 運用方針

| 項目 | 内容 |
|------|------|
| VM | 専用 GCP `risepath-vm`（`e2-medium` 推奨） |
| 稼働 | **24 時間**。公開 API が VM に載るため、夜間停止はやめました。`provision-gce.sh` を `NIGHT_STOP=1` で実行すると 09:00–23:00 JST のスケジュールに戻せます |
| 月額目安 | 要再見積もり。旧目安の約 ¥3,000–3,800 は 14h/日 + 50GB ディスクでの値で、24 時間稼働では増えます |
| 公開 | API は Cloudflare Tunnel の `https://api.<domain>` だけ。フロントは Vercel の `https://app.<domain>`。GCP ファイアウォールにアプリ用の受信ルールは作りません |
| Mac | `npm run dev` + Tailscale で VM の db/mcp/hermes/kokoro に接続（今までどおり）。`ORIGIN_SECRET` を設定したあとは、api（:3006）だけ `x-origin-secret` ヘッダーが要ります |
| Hermes | Compose **`--profile full`**（`nousresearch/hermes-agent`）。Mac 単体開発は `hermes -p rise-path gateway` も可 |

## ファイル

| ファイル | 内容 |
|----------|------|
| `docker-compose.yml` | `db` + `api` + `mcp` + `kokoro-tts` + `hermes`（profile `full`）+ `cloudflared`（profile `tunnel`） |
| `Dockerfile` | `api` / `mcp` マルチターゲット |
| `stack.env.example` | 秘密なしテンプレ → `stack.env` |
| `tunnel.env.example` | Cloudflare Tunnel のトークン用テンプレ → `tunnel.env`（`cloudflared` だけが読む） |
| `scripts/provision-gce.sh` | GCP VM 作成（夜間停止は `NIGHT_STOP=1` のときだけ） |
| `scripts/bootstrap-vm.sh` | VM 初回セットアップ |
| `scripts/deploy-stack.sh` | 再デプロイ（pull → tunnel のガード → build → migrate → up → `api` コンテナ内で smoke） |
| `hermes/config.yaml` | 本番 Hermes プロファイル（SSE MCP） |
| `systemd/risepath-stack.service` | VM 起動時に compose up |

## クイックスタート

### 1. GCP で VM 作成（Mac から）

```bash
export GCP_PROJECT=your-project-id
cd deploy/risepath-vm/scripts
./provision-gce.sh
```

### 2. VM に SSH して初回 bootstrap

```bash
gcloud compute ssh risepath-vm --zone=asia-northeast1-b

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=risepath-vm

# リポジトリ bootstrap
git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git /opt/risepath
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# → stack.env を編集して再実行
```

#### 既存の `/opt/risepath` がある場合

`deploy-stack.sh` も `scripts/deploy-from-mac.sh` も、clone 元に `git pull --ff-only` するだけです。先に取得元を確認します。

```bash
git -C /opt/risepath remote -v
git -C /opt/risepath log -1 --oneline
```

`origin` が上の URL でなければ、clone し直します。以前のリポジトリとは履歴がつながっていないので、remote を変えても pull できません。

1. スタックを止める: `docker ps -q --filter label=com.docker.compose.project=risepath | xargs -r docker stop`
2. `deploy/risepath-vm/stack.env` と `deploy/risepath-vm/hermes-data/` を VM 内の別の場所にコピーする（どちらも Git 管理外）
3. `/opt/risepath` を別名に移し、上の `git clone` をやり直す
4. 2 つを元の場所に戻して `./deploy-stack.sh`

DB などの Docker ボリュームは、Compose のプロジェクト名が `risepath` で固定なので残ります。

### 3. Mac `.env.local`

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:***@risepath-vm:5432/risepath?sslmode=disable
HERMES_API_URL=http://hermes:8642
```

API を VM 経由にする場合は Vite プロキシまたは `VITE_API_BASE_URL` を調整。ただし `stack.env` に `ORIGIN_SECRET` があると、VM の :3006 は `x-origin-secret` の無いリクエストに 403 を返します。そのときは Mac のローカル API（`npm run dev`）を使います。

### 4. 手動でスタック操作（VM 上）

```bash
cd /opt/risepath/deploy/risepath-vm/scripts
./deploy-stack.sh
```

`deploy-stack.sh` は pull で HEAD が進むと、pull したあとの自分自身を 1 回だけ実行し直します。そのあと build → db 起動 → `db:migrate` → `api` の作り直し（healthy まで待つ）→ `up -d` → smoke の順に進みます。

**この版のスクリプトが VM に入る最初のデプロイだけ**は、先に `git pull` してからスクリプトを実行します。VM の `deploy-stack.sh` に `RISEPATH_DEPLOY_REEXEC` の行が無ければ古い版です。

```bash
git -C /opt/risepath pull --ff-only
cd /opt/risepath/deploy/risepath-vm/scripts
./deploy-stack.sh
```

pull するのは実行中の古いスクリプトで、bash は読み込んだ古い本体を最後まで続けます。古い本体は `up -d --build` で新しい `api` を先に起動し、migrate はそのあとです。新しい `api` は未適用の migration があると unhealthy になるので、`up` がそこで止まり、migrate は流れません。

古い順序で走って失敗したときは、pull 済みの新しい `./deploy-stack.sh` をもう一度実行します。migrate を流してから `api` を作り直すので、前回の unhealthy な `api` が残っていても止まりません。`scripts/deploy-from-mac.sh` は先に ssh で pull するので、この手順は要りません。

`deploy-stack.sh` の smoke は、いつも `api` コンテナ内で流れます。コンテナ内の 127.0.0.1 は loopback なので、origin gate を通ります。手動で流すとき:

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env exec -T api node scripts/smoke-vm-stack.mjs --target container
```

Mac から Tailscale 経由で検証できるのは、`stack.env` に `ORIGIN_SECRET` が無いあいだだけです。

```bash
npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100
```

`ORIGIN_SECRET` を設定したあとは、Mac のリポジトリ直下で公開経路を確かめます（`scripts/deploy-from-mac.sh` も Tailscale 経由の smoke を飛ばし、このコマンドを表示します）。

```bash
PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge
```

コース追加などのコンテンツデプロイ後は、`claude-code` ポータル（migration 011 で追加、012 で説明文を更新）、`/claude-code`、`/api/v2/llm/status` の行も確認します。

## Cloudflare Tunnel（公開エッジ）

`https://api.<domain>` → Cloudflare → トンネル → `cloudflared` → `http://api:3006`。`cloudflared` は VM から外向き（TCP/UDP 7844）に接続するので、受信ポートは要りません。`edge` ネットワークで `api` とだけつながり、ポートを公開しません。

1. Cloudflare Zero Trust で remotely-managed のトンネルを作ります。Published application は `api.<domain>` → Service URL `http://api:3006`。HTTP Host Header は空のままにします。
2. トークンを `tunnel.env` にだけ入れます。Git 管理外で、`cloudflared` サービスだけが読みます（`stack.env` は読みません）。

   ```bash
   cd /opt/risepath/deploy/risepath-vm
   cp tunnel.env.example tunnel.env && chmod 600 tunnel.env
   nano tunnel.env   # TUNNEL_TOKEN= の後ろに貼る
   ```

3. `stack.env` の Public edge ブロックを埋めます（`stack.env.example` 参照）。

   ```env
   ORIGIN_SECRET=<openssl rand -hex 32 の値。Vercel Production と同じ>
   TRUST_PROXY=1
   LLM_ALLOWED_ORIGINS=https://app.<domain>
   COMPOSE_PROFILES=full,tunnel
   # RISE_PATH_PUBLIC_URL は設定しない
   ```

4. `./scripts/deploy-stack.sh` を実行します。`COMPOSE_PROFILES` に `tunnel` があるのに `TUNNEL_TOKEN`・`ORIGIN_SECRET`（32 文字以上）・`LLM_ALLOWED_ORIGINS` が無い、または `RISE_PATH_PUBLIC_URL` があると、足りない変数名だけを表示して止まります。`TRUST_PROXY` が 1 でなければ警告します。
5. `docker compose --env-file stack.env ps` で `cloudflared` が healthy か、`curl -s -o /dev/null -w '%{http_code}\n' https://api.<domain>/api/v2/health` が `403` かを確かめます。

`ORIGIN_SECRET` が空で `COMPOSE_PROFILES=full` のままなら、origin gate は動かず、スタックは今までどおりに動きます。

ポートの公開は変えていません。db（5432）・mcp（3100）・hermes（8642）・kokoro（8880）には、Tailscale から今までどおり届きます。api（3006）だけは、`ORIGIN_SECRET` を設定すると `x-origin-secret` が要ります。ヘッダーを付けた呼び出しは edge 扱いなので、Bridge Token は使えず、edge のパス（`/api/*` など）にしか届きません。VM の :3006 が配信するフロントも Tailscale からは開けなくなるので、フロントは `app.<domain>` を使います。

`cloudflared` のイメージは `docker-compose.yml` でタグと digest を固定しています。更新は両方を一緒に上げ、利用の少ない時間に行います。再起動で流れているストリームが切れます。

`ORIGIN_SECRET` のローテーションは [`deploy/vercel/README.md`](../vercel/README.md) の 3 段階（`ORIGIN_SECRET_PREVIOUS` を使う）で行います。

## セキュリティ

- GCP VPC ファイアウォールで **5432/3006/3100/8642/8880 を 0.0.0.0/0 に開放しない**。アプリ用の受信ルールは要りません（公開は Cloudflare Tunnel の外向き接続）
- `ORIGIN_SECRET` を設定すると、API は `api` コンテナ内の loopback 以外から来て `x-origin-secret` が無いリクエストに 403 を返します。Tailscale から :3006 を呼ぶ場合も同じです
- 正しいヘッダーを持つリクエストは edge 扱いです。Bridge Token は使えず、Supabase JWT が要ります。届くのは `/api/*`・`/audio/cache/`・`/generated/img_*` だけで、`/uploads` はインターネットから読めません
- Tailscale ACL で `risepath-vm` へのアクセスを限定
- `stack.env` と `tunnel.env` は `chmod 600`、Git に含めない（`.dockerignore` でビルドにも入れない）