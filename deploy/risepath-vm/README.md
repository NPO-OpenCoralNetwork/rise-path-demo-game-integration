# Rise Path VM deploy (`risepath-vm`)

正本: [`doc/guides/risepath_vm_deployment.md`](../../doc/guides/risepath_vm_deployment.md) / フロント（Vercel）と切り替え手順: [`deploy/vercel/README.md`](../vercel/README.md)

2026-10-21 に、オーナーが GCP の `risepath-vm` を削除しました。新しい VM は下のクイックスタートで作り、DB は空から始まります。全体の順番（Cloudflare のゾーン追加を最初に始める、など）と Cloudflare・Vercel・Supabase の作業は、[`deploy/vercel/README.md`](../vercel/README.md) の「[新しい VM の順番](../vercel/README.md#新しい-vm-の順番)」に沿って進めます。

## 運用方針

| 項目 | 内容 |
|------|------|
| VM | 専用 GCP `risepath-vm`。既定は `e2-medium`（2 vCPU / 4 GB）+ 50GB `pd-balanced`。Memanto を使うなら `e2-standard-2`（2 vCPU / 8 GB）。下の「[マシンタイプ](#マシンタイプ)」 |
| 稼働 | **24 時間**。公開 API が VM に載るため、夜間停止はやめました。`provision-gce.sh` を `NIGHT_STOP=1` で実行すると 09:00–23:00 JST のスケジュールに戻せます |
| 月額目安 | **推定**（未確認）。24 時間稼働の `asia-northeast1` で、`e2-medium` は約 $31/月、`e2-standard-2` は約 $63/月。50GB ディスクは別です。どれも第三者のサイト（[gcloud-compute.com](https://gcloud-compute.com/e2-medium.html)）の値で、Google の料金ページでは確かめていません。予算アラートを決める前に、[GCP の料金計算ツール](https://cloud.google.com/products/calculator)で確かめます |
| DB | `pgvector/pgvector:0.8.7-pg16`（Postgres 16 + pgvector。タグと digest を固定）。新しい空のボリュームでは RAG のベクトル検索が有効です |
| 公開 | API は Cloudflare Tunnel の `https://api.<domain>` だけ。フロントは Vercel の `https://app.<domain>`。GCP ファイアウォールにアプリ用の受信ルールは作りません |
| Mac | `npm run dev` + Tailscale で VM の db/mcp/kokoro（Hermes を有効にしたときは hermes も）に接続。`ORIGIN_SECRET` を設定したあとは、api（:3006）だけ `x-origin-secret` ヘッダーが要ります |
| AI | チューター・文章フィードバック・コース生成は Claude（`ANTHROPIC_API_KEY`。既定は安いモデル）。Gemini は使いません（`GEMINI_ALLOWED` を設定しない。下の表） |
| Hermes | **学習者には提供しません。** 既定は `COMPOSE_PROFILES=tts`（`hermes` コンテナを起動しません）で、Vercel の `VITE_FEATURE_AGENT_CHAT` も設定しません。API も同じ `VITE_FEATURE_AGENT_CHAT` を読み、ちょうど `true` でないと `/api/v2/agent/chat` は 404 を返します（Hermes が動いていても使えません）。前の `stack.env` で `COMPOSE_PROFILES=full` のままなら、`tts`（トンネルを使うなら `tts,tunnel`）に変えて Hermes を止めます。自分で運用するときや開発のときだけ、Compose の **`--profile full`**（`nousresearch/hermes-agent`）で起動できます。Mac 単体開発は `hermes -p rise-path gateway` も可 |

### マシンタイプ

- **基本のスタック（Memanto なし）: `e2-medium`（4 GB）。** `api` イメージはフロントをビルドしません（フロントは Vercel がビルドして配信します）。`bootstrap-vm.sh` が 4 GB の swap ファイルを作るので、`npm ci` や TTS の一時的な増加はそこで受けます。
- **Memanto を使う: `e2-standard-2`（8 GB）。** Memanto overlay は Ollama（`nomic-embed-text` と `qwen2.5:0.5b`）・moorcheh・memanto を足します。4 GB では余裕がありません。
- メモリの見込み（基本のスタックで 2.3–3.2 GB ほど、Ollama で 0.9–1.4 GB ほど増える）は推定で、VM の実測ではありません。
- マシンタイプは VM を作るときに `MACHINE_TYPE` で選びます（下の手順 1）。

## ファイル

| ファイル | 内容 |
|----------|------|
| `docker-compose.yml` | `db` + `api` + `mcp` + `kokoro-tts`（profile `tts`）+ `hermes`（profile `full`。既定では起動しない）+ `cloudflared`（profile `tunnel`） |
| `docker-compose.memanto.yml` | Memanto overlay（`ollama` + `moorcheh` + `memanto`、profile `memory`） |
| `Dockerfile` | `api` / `mcp` マルチターゲット（`api` にフロントの `dist/` は入りません） |
| `stack.env.example` | 秘密なしテンプレ → `stack.env` |
| `tunnel.env.example` | Cloudflare Tunnel のトークン用テンプレ → `tunnel.env`（`cloudflared` だけが読む） |
| `scripts/provision-gce.sh` | GCP VM 作成（夜間停止は `NIGHT_STOP=1` のときだけ） |
| `scripts/bootstrap-vm.sh` | VM 初回セットアップ（Docker、4 GB の swap、`stack.env`、初回デプロイ、デプロイが通ったあとに systemd） |
| `scripts/deploy-stack.sh` | 再デプロイ（pull → `stack.env` と tunnel のガード → build → migrate → up → healthy を待つ → `api` コンテナ内で smoke） |
| `hermes/config.yaml` | Hermes を有効にしたときのプロファイル（SSE MCP） |
| `systemd/risepath-stack.service` | VM 起動時に compose up |

## クイックスタート

新しい VM を作る手順です。始める前に、[`deploy/vercel/README.md`](../vercel/README.md) の「[新しい VM の順番](../vercel/README.md#新しい-vm-の順番)」にある次の 3 つを始めておきます（ゾーンが Active になるのを待つ必要はありません）。

- Cloudflare にドメインを追加し、ネームサーバーを切り替える（Active まで最大 48 時間かかるので最初に始める）
- GCP の予算アラートを作り、残っていれば `risepath-dev-schedule` を消す
- Tailscale の管理画面（Machines）で旧 `risepath-vm` を Remove し、Mac で `ssh-keygen -R risepath-vm` を実行する

### 1. GCP で VM 作成（Mac から）

Mac のリポジトリ直下で、`main` を pull してから実行します（`gcloud auth login` 済みであること）。

```bash
export GCP_PROJECT=your-project-id
cd deploy/risepath-vm/scripts
./provision-gce.sh                                   # 既定: e2-medium（4 GB）+ 50GB
# Memanto を使うとき: MACHINE_TYPE=e2-standard-2 ./provision-gce.sh   # 8 GB
```

`provision-gce.sh` は受信ルールを作りません。ただし GCP のファイアウォールルールはタグ `risepath-vm` に付くので、前の VM のルールが残っていれば新しい VM にも効きます。[`deploy/vercel/README.md`](../vercel/README.md) の手順 3 で確かめます。

### 2. VM に SSH して初回 bootstrap

`bootstrap-vm.sh` は 2 回実行します。1 回目は Docker と swap を入れ、`stack.env` を作って止まります。スクリプトは sudo を使うので、SSH のユーザーに sudo の権限が要ります（OS Login では `roles/compute.osAdminLogin`）。

```bash
gcloud compute ssh risepath-vm --zone=asia-northeast1-b

# Tailscale（先に管理画面の Machines で旧 risepath-vm を Remove しておく）
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=risepath-vm   # 表示された URL をブラウザで開いて認証する
tailscale status                           # この VM が risepath-vm と表示されること

# リポジトリ（/opt は root 所有なので、先に自分のディレクトリとして作る）
sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/risepath
git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git /opt/risepath
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# 1 回目: Docker と 4 GB の swap を入れ、stack.env を作って止まる
exit
```

旧 `risepath-vm` が Tailscale の管理画面に残っていると、新しい VM は `risepath-vm-1` になります。旧 `risepath-vm` をあとで消しても、名前は戻りません。すでに `-1` になったら、旧 `risepath-vm` を Remove してから、新しいマシンの名前を管理画面で `risepath-vm` に変えます。Tailscale ACL に旧 VM の 100.x アドレスを書いていたら、新しいアドレスに直します。

1 回目のあとは、いったん `exit` して SSH し直します。`docker` グループへの追加は、新しいログインから効くためです。同じセッションのまま 2 回目を実行すると、`bootstrap-vm.sh` は `docker group not active yet` と表示して止まります。

#### `stack.env` に入れる値

`stack.env` は `stack.env.example` から作られ、`chmod 600` です。値は VM 上で作り、チャット・issue・git に貼りません。`openssl rand -hex …` の値は英数字だけなので、URL に入れてもエスケープは要りません。

| 変数 | 入れる値 |
|------|----------|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` の値。**DB の最初の起動で固定されます。** あとで `stack.env` を変えても DB 側のパスワードは変わらず、`api` と migrate が認証エラーになります。`bootstrap-vm.sh` の 2 回目より前に決めます |
| `DATABASE_URL_PHASE1` | `postgresql://risepath_app:<POSTGRES_PASSWORD と同じ値>@db:5432/risepath` |
| `SUPABASE_URL` | Supabase プロジェクトの URL（`https://<ref>.supabase.co`） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の service role key（サーバー側だけ。Vercel やブラウザには入れない） |
| `ANTHROPIC_API_KEY` | Anthropic の API キー。AI チューター・文章フィードバック・コース生成が使います（既定は安いモデルの Claude Haiku）。空だと、チューターは 503 を返します |
| `GEMINI_API_KEY`・`GEMINI_ALLOWED` | **空のまま**にします。Gemini の API 規約は、18 歳未満の人が使う（または使うと見込まれる）サービスでの利用を禁じていて、Rise Path は子どもも使うためです。Gemini を使うのは `GEMINI_ALLOWED=true` のときだけで、それは 18 歳未満の人が届かない環境に限ります。Gemini が無いあいだ、教材の検索はキーワード検索で動き、AI の画像生成は止まります（コース生成とチューターは Claude で動きます） |
| `HERMES_API_KEY` | Hermes を有効にするとき（`COMPOSE_PROFILES` に `full`）だけ。`openssl rand -hex 32` の値（16 文字以上）。`init-hermes-profile.sh` と Compose が Hermes の `API_SERVER_KEY` に写します。ほかに Hermes のキーは要りません |
| `OPENROUTER_API_KEY` | Hermes を有効にするときだけ。OpenRouter の API キー（Hermes のモデル）。`COMPOSE_PROFILES` に `full` があると必須で、`change-me` のままだと `deploy-stack.sh` が止まります。既定の `tts` では読みません |
| `RISE_PATH_BRIDGE_TOKEN` | `openssl rand -hex 32` の値（Hermes → MCP の認証）。ChatGPT などの外部サービスに入れず、MCP のポート（3100）もインターネットに公開しません |
| `MEMANTO_SECRET_KEY` | Memanto を使うときだけ。`openssl rand -hex 32` の値 |
| `MEMANTO_ENABLED` | Memanto を使うときだけ `true`。起動時の systemd ユニットがこの値を読みます。秘密を入れて `false` のままだと、`deploy-stack.sh` が止まります |
| `COMPOSE_PROFILES` | `tts` のまま（Memanto を使うなら `tts,memory`）。`full` は Hermes を有効にするときだけ（`full,memory`）。`tunnel` はトンネルを作ってから（下の「Cloudflare Tunnel」） |
| `ORIGIN_SECRET`・`TRUST_PROXY`・`LLM_ALLOWED_ORIGINS` | まだ入れません。トンネルを作るときに入れます |

`deploy-stack.sh` は、`POSTGRES_PASSWORD`・`DATABASE_URL_PHASE1`・`SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・`RISE_PATH_BRIDGE_TOKEN` が空かテンプレの値のままだと、変数名だけを表示して build の前に止まります。`COMPOSE_PROFILES` に `full` があるとき（Hermes を有効にしたときだけ）は、`OPENROUTER_API_KEY` と `HERMES_API_KEY`（16 文字以上）も確かめます。`ANTHROPIC_API_KEY` は確かめないので、入れたかを自分で見ます。`GEMINI_API_KEY` と `GEMINI_ALLOWED` が空かも見ます。

#### 2 回目の実行

```bash
gcloud compute ssh risepath-vm --zone=asia-northeast1-b
nano /opt/risepath/deploy/risepath-vm/stack.env   # 上の表のとおりに埋める
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# 2 回目: build → db 起動 → migration 000–013 → api → up → healthy を待つ → smoke → systemd 登録
```

最後に `api` コンテナ内の smoke が通れば、スタックは動いています。VM 起動時にスタックを上げる systemd ユニットは、このデプロイが通ってから登録されます。`deploy-stack.sh` が途中で止まったら、表示された原因（テンプレの値なら変数名）を直し、`./bootstrap-vm.sh` をもう一度実行します（systemd ユニットは bootstrap だけが登録します）。

新しい VM の DB は空から始まります。この初回デプロイで、migration 000–013 がすべて適用されます。db イメージは pgvector 入りなので、000 が `vector` 拡張を作り、`material_chunks.embedding` は `vector(768)`（HNSW インデックス付き）になります。RAG のベクトル検索が使えます（ただし埋め込みには Gemini が要るので、`GEMINI_ALLOWED` を設定しない既定では、教材はキーワード検索で探します）。これは新しい空の `pgdata` ボリュームのときだけです。pgvector の無いイメージで作ったボリュームは、イメージを替えても `FLOAT8[]` のままで、RAG はキーワード検索で動きます（[`server/migrations/README.md`](../../server/migrations/README.md)）。

### 3. Mac `.env.local`

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:<stack.env の POSTGRES_PASSWORD>@risepath-vm:5432/risepath?sslmode=disable
# Hermes を有効にしたときだけ
# HERMES_API_URL=http://risepath-vm:8642
# HERMES_API_KEY=<stack.env の HERMES_API_KEY>
```

VM を作り直したので、パスワード（と、Hermes を有効にしたなら `HERMES_API_KEY`）は新しい `stack.env` の値に替えます。旧 VM の値のままだと、DB への接続が認証エラーになります。Hermes を有効にしたとき、Mac から Hermes を呼ぶ名前は `risepath-vm:8642` です。

Mac の `~/.ssh/known_hosts` に旧 VM の鍵が残っていると、`scripts/setup-vm-ssh.sh` と `scripts/deploy-from-mac.sh` の ssh が止まります。先に消します。

```bash
ssh-keygen -R risepath-vm   # 旧 VM に 100.x アドレスで接続していたなら、そのアドレスも消す
tailscale ping risepath-vm
```

`stack.env` に `ORIGIN_SECRET` を入れる前に、Mac から Tailscale 経由の smoke を流しておきます（下の「[手動でスタック操作](#4-手動でスタック操作vm-上)」の `npm run smoke:vm -- --base …`。引数なしだと Mac の 127.0.0.1 を見ます）。

API を VM 経由にする場合は Vite プロキシまたは `VITE_API_BASE_URL` を調整します。ただし `stack.env` に `ORIGIN_SECRET` があると、VM の :3006 は `x-origin-secret` の無いリクエストに 403 を返します。そのときは Mac のローカル API（`npm run dev`）を使います。

### 4. 手動でスタック操作（VM 上）

```bash
cd /opt/risepath/deploy/risepath-vm/scripts
./deploy-stack.sh
```

`deploy-stack.sh` は毎回 `git pull --ff-only` し、HEAD が進むと、pull したあとの自分自身を 1 回だけ実行し直します。そのあと `stack.env` のテンプレ値の検査 → build → db 起動 → `db:migrate` → `api` の作り直し（healthy まで待つ）→ `up -d` → smoke が使うサービスの healthy を待つ → smoke の順に進みます。

`deploy-stack.sh` の smoke は、いつも `api` コンテナ内で流れます。コンテナ内の 127.0.0.1 は loopback なので、origin gate を通ります。手動で流すとき:

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env exec -T api node scripts/smoke-vm-stack.mjs --target container
```

Mac から Tailscale 経由で検証できるのは、`stack.env` に `ORIGIN_SECRET` が無いあいだだけです。

```bash
npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100 \
  --kokoro http://risepath-vm:8880
# Hermes を有効にしたときだけ、最後に --hermes http://risepath-vm:8642 を足す
```

Mac のリポジトリ直下で流します。引数なしだと Mac の 127.0.0.1 を見るので、VM は確かめられません。

`npm run smoke:prod:e2e`（`E2E_API_URL=http://risepath-vm:3006`）と `npm run smoke:hermes:e2e:vm`（Hermes を有効にしたときだけ）も、Tailscale 経由で使えるのは `ORIGIN_SECRET` を設定する前だけです。設定したあとは 403 で失敗します（`scripts/setup-vm-ssh.sh` はこの E2E を飛ばします）。learner-memory の smoke は `api` コンテナ内で流せます（Bridge Token は `stack.env` から入ります）。

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env exec -T api node scripts/smoke-learner-memory-e2e.mjs
```

`ORIGIN_SECRET` を設定したあとは、Mac のリポジトリ直下で公開経路を確かめます（`scripts/deploy-from-mac.sh` も Tailscale 経由の smoke を飛ばし、このコマンドを表示します）。

```bash
PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge
```

コース追加などのコンテンツデプロイ後は、smoke の `claude-code` ポータルの行（migration 011 で追加、012 で説明文を更新）と `/api/v2/llm/status` の行を確認します。`/claude-code` のページは Vercel の `https://app.<domain>/claude-code` で開きます。

### 5. 管理者にする（初回サインインのあと）

空の DB には管理者がいません。プロフィールは役割 `learner` で作られます。`https://app.<domain>` で一度サインインし、設定画面（`/settings`）を開きます。ここでプロフィールの行が作られます。そのあと、VM で自分の役割を `admin` にします。

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env exec db psql -U risepath_app -d risepath \
  -c "UPDATE user_profiles SET role='admin' WHERE user_id='<Supabase の user id>'"
```

user id は、Supabase ダッシュボードの Authentication → Users に出る UID です。`UPDATE 1` と出れば成功です。ページを再読み込みすると、設定画面に管理者の項目が出ます。`UPDATE 0` なら、設定画面をまだ開いていないか、id が違います。

## Cloudflare Tunnel（公開エッジ）

`https://api.<domain>` → Cloudflare → トンネル → `cloudflared` → `http://api:3006`。`cloudflared` は VM から外向き（TCP/UDP 7844）に接続するので、受信ポートは要りません。`cloudflared` 自身はポートを公開せず、`edge` ネットワークで `api` に名前で届きます。ただし、スタックはポートをホストの全インターフェースに公開しているので、トンネルのルートがホストやゲートウェイの IP を指すと、5432・3006・3100・8642・8880 にも届きます。トンネルの Published application は `http://api:3006` の 1 つだけにします。

1. Cloudflare Zero Trust で remotely-managed のトンネルを作ります。Published application は `api.<domain>` → Service URL `http://api:3006`。HTTP Host Header は空のままにします。
2. トークンを `tunnel.env` にだけ入れます。Git 管理外で、`cloudflared` サービスだけが読みます（`stack.env` は読みません）。

   ```bash
   cd /opt/risepath/deploy/risepath-vm
   cp tunnel.env.example tunnel.env && chmod 600 tunnel.env
   nano tunnel.env   # TUNNEL_TOKEN= の後ろに、eyJ で始まるトークンだけを貼る（cloudflared service install は実行しない）
   ```

3. `stack.env` の Public edge ブロックを埋めます（`stack.env.example` 参照）。

   ```env
   ORIGIN_SECRET=<openssl rand -hex 32 の値。Vercel Production と同じ>
   TRUST_PROXY=1
   LLM_ALLOWED_ORIGINS=https://app.<domain>
   COMPOSE_PROFILES=tts,tunnel
   # Memanto を使うなら COMPOSE_PROFILES=tts,memory,tunnel
   # Hermes を有効にするときだけ full,tunnel（Memanto も使うなら full,memory,tunnel）
   # RISE_PATH_PUBLIC_URL は設定しない
   ```

4. `./scripts/deploy-stack.sh` を実行します。`COMPOSE_PROFILES` に `tunnel` があるのに `TUNNEL_TOKEN`・`ORIGIN_SECRET`（32 文字以上）・`LLM_ALLOWED_ORIGINS` が無い、または `RISE_PATH_PUBLIC_URL` があると、足りない変数名だけを表示して止まります。`TRUST_PROXY` が 1 でなければ警告します。
5. `docker compose --env-file stack.env ps` で `cloudflared` が healthy か、`curl -s -o /dev/null -w '%{http_code}\n' https://api.<domain>/api/v2/health` が `403` かを確かめます。

公開エッジを止める（ロールバックする）ときは、最初に `cloudflared` を消します。`COMPOSE_PROFILES` から `tunnel` を外しても、`up -d` は作成済みの `cloudflared` を残し、`restart: unless-stopped` で VM の再起動後も動き続けるためです。

1. `cloudflared` を止めて消します。

   ```bash
   cd /opt/risepath/deploy/risepath-vm
   docker compose --env-file stack.env --profile tunnel rm -sf cloudflared
   ```

2. `stack.env` の `ORIGIN_SECRET` を空にし、`COMPOSE_PROFILES` から `tunnel` だけを外します（例: `tts,tunnel` → `tts`、`full,tunnel` → `full`）。
3. `./scripts/deploy-stack.sh` を実行します。

`ORIGIN_SECRET` が空のあいだも、Cloudflare を通ってきたリクエスト（`cf-ray`・`cf-connecting-ip` ヘッダー、`cloudflare` を含む `cdn-loop` ヘッダー）には API が 403 を返します。`COMPOSE_PROFILES` に `tunnel` があるのに `ORIGIN_SECRET` が空なら、`api` は起動しません。それ以外のリクエストには、スタックは今までどおりに動きます。

ポートの公開は変えていません。db（5432）・mcp（3100）・kokoro（8880）と、Hermes を有効にしたときの hermes（8642）には、Tailscale から今までどおり届きます。api（3006）だけは、`ORIGIN_SECRET` を設定すると `x-origin-secret` が要ります。ヘッダーを付けた呼び出しは edge 扱いなので、Bridge Token は使えず、edge のパス（`/api/*` など）にしか届きません。VM の api はフロントを配信しません（`api` イメージに `dist/` はありません）。フロントは `app.<domain>` を使います。

`cloudflared` のイメージは `docker-compose.yml` でタグと digest を固定しています。更新は両方を一緒に上げ、利用の少ない時間に行います。再起動で流れているストリームが切れます。

`ORIGIN_SECRET` のローテーションは [`deploy/vercel/README.md`](../vercel/README.md) の 3 段階（`ORIGIN_SECRET_PREVIOUS` を使う）で行います。

## セキュリティ

- GCP VPC ファイアウォールで **5432/3006/3100/8642/8880 を 0.0.0.0/0 に開放しない**。アプリ用の受信ルールは要りません（公開は Cloudflare Tunnel の外向き接続）
- `ORIGIN_SECRET` を設定すると、API は `api` コンテナ内の loopback 以外から来て `x-origin-secret` が無いリクエストに 403 を返します。Tailscale から :3006 を呼ぶ場合も同じです
- 正しいヘッダーを持つリクエストは edge 扱いです。Bridge Token は使えず、Supabase JWT が要ります。届くのは `/api/*`・`/audio/cache/`・`/generated/img_*` だけで、`/uploads` はインターネットから読めません
- Tailscale ACL で `risepath-vm` へのアクセスを限定
- `stack.env` と `tunnel.env` は `chmod 600`、Git に含めない（`.dockerignore` でビルドにも入れない）
- `stack.env` にテンプレの値（`change-me` など）を残さない。DB・Bridge Token・Hermes の値は上の表のとおりに作る
- `RISE_PATH_BRIDGE_TOKEN` を ChatGPT などの外部サービスに入れない。MCP（3100）を ngrok などのトンネルやファイアウォールの開放でインターネットに出さない。ChatGPT・Claude.ai などのリモート接続は、学習者ごとのログイン（OAuth）を用意してから提供します
- 学習者向けのスタックでは `GEMINI_ALLOWED` を設定しない（Gemini の API 規約の 18 歳未満の条項）
