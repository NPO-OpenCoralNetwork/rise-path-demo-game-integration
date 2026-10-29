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
| 公開 | API は Cloudflare Tunnel の `https://api.<domain>`。大人が自分の AI をつなぐリモート MCP（Compose のプロファイル `byoa`、`mcp-public`）を有効にしたときだけ、同じトンネルの `https://mcp.<domain>` も公開します。フロントは Vercel の `https://app.<domain>`。GCP ファイアウォールにアプリ用の受信ルールは作りません |
| Mac | `npm run dev` + Tailscale で VM の db/mcp/kokoro（Hermes を有効にしたときは hermes も）に接続。`ORIGIN_SECRET` を設定したあとは、api（:3006）だけ `x-origin-secret` ヘッダーが要ります |
| AI | チューター・文章フィードバック・コース生成は Claude（`ANTHROPIC_API_KEY`。既定は安いモデル）。Gemini は使いません（`GEMINI_ALLOWED` を設定しない。下の表） |
| Hermes | **学習者には提供しません。** 既定は `COMPOSE_PROFILES=tts`（`hermes` コンテナを起動しません）で、Vercel の `VITE_FEATURE_AGENT_CHAT` も設定しません。API も同じ `VITE_FEATURE_AGENT_CHAT` を読み、ちょうど `true` でないと `/api/v2/agent/chat` は 404 を返します（Hermes が動いていても使えません）。前の `stack.env` で `COMPOSE_PROFILES=full` のままなら、`tts`（トンネルを使うなら `tts,tunnel`）に変えて `deploy-stack.sh` を実行し直します。前のデプロイで残った `hermes` コンテナは、そのときに削除されます。自分で運用するときや開発のときだけ、Compose の **`--profile full`**（`nousresearch/hermes-agent`）で起動できます。Mac 単体開発は `hermes -p rise-path gateway` も可 |

### マシンタイプ

- **基本のスタック（Memanto なし）: `e2-medium`（4 GB）。** `api` イメージはフロントをビルドしません（フロントは Vercel がビルドして配信します）。`bootstrap-vm.sh` が 4 GB の swap ファイルを作るので、`npm ci` や TTS の一時的な増加はそこで受けます。
- **Memanto を使う: `e2-standard-2`（8 GB）。** Memanto overlay は Ollama（`nomic-embed-text` と `qwen2.5:0.5b`）・moorcheh・memanto を足します。4 GB では余裕がありません。
- メモリの見込み（基本のスタックで 2.3–3.2 GB ほど、Ollama で 0.9–1.4 GB ほど増える）は推定で、VM の実測ではありません。
- マシンタイプは VM を作るときに `MACHINE_TYPE` で選びます（下の手順 1）。

## ファイル

| ファイル | 内容 |
|----------|------|
| `docker-compose.yml` | `db` + `api` + `mcp` + `kokoro-tts`（profile `tts`）+ `hermes`（profile `full`。既定では起動しない）+ `cloudflared`（profile `tunnel`）+ `mcp-public`（profile `byoa`。既定では起動しない） |
| `docker-compose.memanto.yml` | Memanto overlay（`ollama` + `moorcheh` + `memanto`、profile `memory`） |
| `Dockerfile` | `api` / `mcp` マルチターゲット（`api` にフロントの `dist/` は入りません） |
| `stack.env.example` | 秘密なしテンプレ → `stack.env` |
| `tunnel.env.example` | Cloudflare Tunnel のトークン用テンプレ → `tunnel.env`（`cloudflared` だけが読む） |
| `mcp-public.env.example` | リモート MCP（`mcp-public`）用のテンプレ → `mcp-public.env`（`mcp-public` だけが読む。`stack.env` は読まない） |
| `billing.env.example` | 有料プラン（Phase 3）用のテンプレ → `billing.env`（`api` だけが読む。Stripe の鍵と課金の設定は、ここだけに書く）。下の「[有料プラン](#有料プランphase-3billingenv)」 |
| `sql/mcp_remote_role.sql` | `mcp-public` 用の最小権限の DB ロール `risepath_mcp_remote` を作る SQL |
| `scripts/provision-gce.sh` | GCP VM 作成（夜間停止は `NIGHT_STOP=1` のときだけ） |
| `scripts/bootstrap-vm.sh` | VM 初回セットアップ（Docker、4 GB の swap、`stack.env`、初回デプロイ、デプロイが通ったあとに systemd） |
| `scripts/deploy-stack.sh` | 再デプロイ（pull → `stack.env`・tunnel・byoa・billing のガード → build → migrate → up → healthy を待つ → `api` コンテナ内で smoke） |
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
# 作り直した VM の最初のデプロイなら、ここで 2 つ見ます（計画の 11.2 の 3）: docker version と docker compose version を
# CI の Server stack deploy の「Preflight」の行とくらべ、stack.env の SUPABASE_URL が https://<project>.supabase.co であることを見ます。
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# 2 回目: build → db 起動 → migration 000–020 → api → up → healthy を待つ → smoke → systemd 登録
```

最後に `api` コンテナ内の smoke が通れば、スタックは動いています。VM 起動時にスタックを上げる systemd ユニットは、このデプロイが通ってから登録されます。`deploy-stack.sh` が途中で止まったら、表示された原因（テンプレの値なら変数名）を直し、`./bootstrap-vm.sh` をもう一度実行します（systemd ユニットは bootstrap だけが登録します）。

新しい VM の DB は空から始まります。この初回デプロイで、migration 000–020 がすべて適用されます。db イメージは pgvector 入りなので、000 が `vector` 拡張を作り、`material_chunks.embedding` は `vector(768)`（HNSW インデックス付き）になります。RAG のベクトル検索が使えます（ただし埋め込みには Gemini が要るので、`GEMINI_ALLOWED` を設定しない既定では、教材はキーワード検索で探します）。これは新しい空の `pgdata` ボリュームのときだけです。pgvector の無いイメージで作ったボリュームは、イメージを替えても `FLOAT8[]` のままで、RAG はキーワード検索で動きます（[`server/migrations/README.md`](../../server/migrations/README.md)）。

### 3. Mac `.env.local`

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:<stack.env の POSTGRES_PASSWORD>@risepath-vm:5432/risepath?sslmode=disable
# 手元の API が VM の DB を、手元の設定で消さないように（stack.env の保存期間の設定は手元には届きません）
RETENTION_ENABLED=false
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

`https://api.<domain>` → Cloudflare → トンネル → `cloudflared` → `http://api:3006`。`cloudflared` は VM から外向き（TCP/UDP 7844）に接続するので、受信ポートは要りません。`cloudflared` 自身はポートを公開せず、`edge` ネットワークで `api` に名前で届きます。ただし、スタックはポートをホストの全インターフェースに公開しているので、トンネルのルートがホストやゲートウェイの IP を指すと、5432・3006・3100・8642・8880 にも届きます。トンネルの Published application は `http://api:3006` だけにします。リモート MCP（下の「[自分の AI をつなぐ（リモート MCP）](#自分の-ai-をつなぐリモート-mcpprofile-byoa)」）を有効にしたときだけ、2 つ目の `mcp.<domain>` → `http://mcp-public:3200` を足します。

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

## 自分の AI をつなぐ（リモート MCP、profile `byoa`）

18 歳以上の学習者が、自分の AI（Claude Code、Codex、Claude.ai など）を `https://mcp.<domain>/mcp` につなぐための入口です（Phase 1）。Supabase の OAuth 2.1 サーバー（ベータ）でログインし、学習者ごとのトークンで動きます。オーナーの作業の順番（ステージングの Supabase、署名鍵、OAuth サーバー、フック、DB ロール、Cloudflare、確認、戻し方）は [`doc/guides/byoa-setup.ja.md`](../../doc/guides/byoa-setup.ja.md) にあります。

- コンテナ `mcp-public` は、`mcp` と同じイメージを `node mcp-server/index.js --http` で動かします。待ち受けは 3200 で、ホストにポートを公開しません。`edge` ネットワークで `cloudflared` から名前で届きます。
- 読むのは `mcp-public.env` だけです（`stack.env` は読みません）。DB は最小権限のロール `risepath_mcp_remote`（`sql/mcp_remote_role.sql`）でつなぎ、ブリッジトークン、service_role key、モデルや Memanto のキーは持ちません。`NODE_ENV=production` とプロファイル `learner-remote` は `docker-compose.yml` で固定しています。
- コンテナは `node` ユーザーで、ファイルシステムは読み取り専用、Linux のケイパビリティはすべて外しています。
- トンネルのルート: `mcp.<domain>` → Service URL `http://mcp-public:3200`。HTTP Host Header は空のまま。**Cloudflare Access やボット対策のチャレンジを前に置きません**（AI アプリは通れません。このホストの関門は OAuth です）。
- 有効にする: `mcp-public.env` を作り、`COMPOSE_PROFILES` に `byoa` を足して（例: `tts,tunnel,byoa`）、`./scripts/deploy-stack.sh` を実行します。
- 確かめる: `docker compose --env-file stack.env ps mcp-public` が healthy、`curl -s https://mcp.<domain>/.well-known/oauth-protected-resource/mcp` の `resource` が `MCP_PUBLIC_RESOURCE_URL` と同じ、`curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.<domain>/mcp` が `401`。
- 止める: トンネルのルート `mcp.<domain>` を消し、`docker compose --env-file stack.env --profile byoa rm -sf mcp-public` のあと、`COMPOSE_PROFILES` から `byoa` を外して `./scripts/deploy-stack.sh` を実行します（外すだけでは、作成済みのコンテナが残ります）。

## 有料プラン（Phase 3、`billing.env`）

有料のサポータープランの設定です。今は止めていて、Stripe（決済サービス）のテストモードで、オーナーが決めたテストの方だけが使います。オーナーの作業の順番（Stripe の設定、手元での確認、本番の経路での 1 回の確認、売り始める前のチェックリスト）と、困ったときの手順は、[`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 7.2 と 7.5 にあります。

- Stripe の鍵と課金の設定は、`billing.env` にだけ書きます。読むのは `api` のコンテナだけです（`docker-compose.yml` の `env_file`。ファイルがなければ読みません）。`mcp` と `mcp-public` は読みません。
- `billing.env` は Git の管理外です（`.gitignore`）。値は VM の上で入れ、チャット・issue・git に貼りません。
- ファイルがないか、`BILLING_ENABLED` が空なら、申し込みは止まっています。`deploy-stack.sh` は `==> Billing sales: off` と表示します。
- migration 017 は、課金を使わないあいだも要ります（`deploy-stack.sh` が当てます）。

作る:

```bash
cd /opt/risepath/deploy/risepath-vm
cp billing.env.example billing.env && chmod 600 billing.env
nano billing.env   # 下の表のとおりに入れる
cd scripts && ./deploy-stack.sh
```

| 変数 | テストモード（今） | 本番モード（法律と税の確認と、オーナーの OK のあと） |
|------|------|------|
| `BILLING_ENABLED` | `true` で申し込みを開く。空なら、申し込みだけが止まる | 同じ。準備ができるまで空にしておく |
| `BILLING_LIVE` | 空 | `true`（本番の鍵には必須） |
| `BILLING_TEST_USER_IDS` | テストの方のアカウント ID（Supabase の Authentication → Users の UID）。カンマで区切る。必須 | 見ない |
| `STRIPE_SECRET_KEY` | テストモードの制限付きキー `rk_test_…` | 本番モードの制限付きキー `rk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | テストモードのエンドポイントの `whsec_…`（`stripe listen` が表示する鍵ではない）。鍵を替えるあいだは、新旧をカンマでつなぐ | 本番モードのエンドポイントの `whsec_…` |
| `STRIPE_PRICE_ID` | テストモードのプライス `price_…`（500 円、JPY、1 か月ごと、税込） | 本番モードのプライス |
| `STRIPE_PRICE_IDS_ACCEPTED` | 空 | 前に売っていたプライスがあれば、カンマで区切る（その契約者もサポーターのまま） |
| `BILLING_RETURN_ORIGIN` | `https://app.<domain>`（パスは付けない） | 同じ |
| `BILLING_TOS_URL` | 空でよい | `/terms` のページの URL（必須。Stripe の Public details と同じ）。`https://app.<domain>/terms` を入れるのは、有料プランの条を載せた版（`shared/legal/versions.js` の `include.billing: true`）を公開してから（[`doc/legal/README.md`](../../doc/legal/README.md) の「ページを公開する手順」） |
| `AI_CAP_SUPPORTER_GLOBAL_LLM`・`AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION` | 空（既定は 1,000 と 200） | 同じ。上げるときは、費用を見てから |

`deploy-stack.sh` は、次のときに、設定の名前だけを表示して、build の前に止まります（値は出しません）。`COMPOSE_PROFILES` に関係なく確かめます。

- `stack.env` か `mcp-public.env` に、`STRIPE_` か `BILLING_` で始まる名前がある（`stack.env` だと `mcp` にも届くため）。
- `billing.env` に本番の鍵（`sk_live_`・`rk_live_`・`pk_live_`）があるのに、`BILLING_LIVE=true` がない。
- `BILLING_ENABLED=true` なのに、`STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET`・`STRIPE_PRICE_ID`・`BILLING_RETURN_ORIGIN` のどれかがない。テストモードなら `BILLING_TEST_USER_IDS`、本番モードなら `BILLING_TOS_URL` も要る。
- `BILLING_ENABLED=true` なのに、`STRIPE_SECRET_KEY` が `sk_` か `rk_` で始まらない、または `STRIPE_WEBHOOK_SECRET` が `whsec_` で始まらない。

確かめる:

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env logs api | grep '\[Billing\]'
# 例: [Billing] billing: test (serviceable, sales open, 2 test users)
```

- `billing: off` は、設定がない状態です。`billing: off, not serviceable (…)` なら、かっこの中の設定が足りないか、形がちがいます。
- `sales closed: …` なら、契約中の方へのサービスは動いていて、申し込みだけが止まっています。かっこの中の名前の意味は次のとおりです。
  - `sales_closed`: `BILLING_ENABLED` がちょうど `true` でない。
  - `test_user_ids`: テストモードで、`BILLING_TEST_USER_IDS` がないか、ID の形でないものがある。
  - `tos_url`: 本番モードで `BILLING_TOS_URL` がない、または https の URL でない。
  - `disclosure_placeholders`: 本番モードで、「特定商取引法に基づく表記」に【要記入】が残っている（`server/services/billingDisclosure.js`）。
  - `supporter_caps_off:<枠>`、`supporter_caps_not_above_free:<枠>`: その枠の上限が 0 で止まっている、またはサポーターの上限が無料の上限より大きくない。
- Webhook の URL は `https://app.<domain>/api/v2/billing/webhook` です。Vercel を通るので、合言葉の `x-origin-secret` が付きます。`https://api.<domain>/…` に直接送ると、origin gate が 403 を返します。
- Webhook が届いたかは、`docker compose --env-file stack.env logs api | grep 'billing/webhook'` で見ます。`POST /api/v2/billing/webhook 200` なら届いています。`[Billing] webhook signature refused` があれば、署名が通っていません（ai-access-plan.ja.md の 7.2 の 3）。

止める:

- 新しい申し込みだけを止める: `billing.env` の `BILLING_ENABLED` を空にして、`./scripts/deploy-stack.sh` を実行します。契約中の方の上限、「お支払いと解約」、Webhook は、そのまま動きます。
- 鍵を消すのは、Stripe ですべての契約をキャンセルしたあとです。先に消すと、契約中の方が解約の画面を開けないまま、Stripe の請求が続きます（ai-access-plan.ja.md の 7.5）。

## アカウントの削除・保存期間・ログ（Phase 4）

学習者が自分の Rise Path のデータを消す機能、期限が来た記録を消す処理、ログの上限です。決定と理由は [`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 8 章、スタッフの作業は [`doc/guides/account-deletion-operations.ja.md`](../../doc/guides/account-deletion-operations.ja.md) です。

**この版の最初のデプロイ**

- migration 018 を当てる前に、この版の `api`・`mcp`・`mcp-public` を起動しません（ログインした呼び出しのたびに `account_deletions` を読むため）。`deploy-stack.sh` は migrate のあとに作り直すので、そのまま使えます。
- `byoa` を使っているなら、そのあとに `sql/mcp_remote_role.sql` を流し直します（[`doc/guides/byoa-setup.ja.md`](../../doc/guides/byoa-setup.ja.md) の手順 7。パスワードは今の値）。
- すべてのサービスにログの上限（`x-logging`）が付くので、動いているコンテナがすべて一度作り直されます。`db` は「db up」のときに数秒止まり、そのあいだ古い `api` は 503 を返します。そのあと `api` が作り直され、最後の `docker compose up -d` で cloudflared（トンネルが少し止まります）、kokoro-tts（モデルを読み直します）、`mcp`、`mcp-public`、`hermes` と Memanto（有効なら）が作り直されます。人の少ない時間に実行します。
- 画面（Vercel）はマージですぐに新しくなります。`deploy-stack.sh` は**同じ日に**実行します。

**ログ**

- すべてのサービスが json-file で、1 ファイル 10 MB、5 ファイルまで（約 50 MB をこえると古いものから消えます）。見るときは `docker compose --env-file stack.env logs --since 1h api` のようにします。
- `db` は `log_error_verbosity=terse` で動きます。外部キーのエラーなどの `DETAIL` の行（アカウント ID の全体などの値が入る）を出しません。
- API の通信の行は、クエリを残さず、アカウント ID を先頭 8 文字にし、日付・メールアドレス・ファイル名・トークンを伏せます（`server/utils/redactUrl.js`）。5xx の行は、エラーの名前・コード・文だけです。

**設定（`stack.env`。どれも秘密の値ではありません。`api` だけが読みます）**

| 変数 | 既定 | 中身 |
|---|---|---|
| `ACCOUNT_DELETION_ENABLED` | 未設定（画面からの削除は止まっている） | `true` で、設定の「アカウントを削除する」が使えるようになります。未設定と `false` では止まったままです（ほかの値も止める側になり、警告を出します）。`byoa` を使うかどうかにかかわらず、Supabase の「Require current password when updating」の確かめと、本番の `amr` の確かめが済むまでは `true` にしません（[`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 8.2 の 2 と 3、[`doc/guides/account-deletion-operations.ja.md`](../../doc/guides/account-deletion-operations.ja.md) の 7 章）。`byoa` を動かすあいだは、さらにパスワードの 3 つの設定が要ります（[`doc/guides/byoa-setup.ja.md`](../../doc/guides/byoa-setup.ja.md) の手順 6） |
| `RETENTION_ENABLED` | 未設定（`NODE_ENV=production` の `api` では動く。ほかでは `true` のときだけ動く） | `false` で、保存期間の処理をすべて止めます。止めるのは、この VM の `api` だけです。手元の API を VM の DB につなぐときは、手元の `.env.local` にも `RETENTION_ENABLED=false` を書きます（3 章） |
| `RETENTION_AI_USAGE_DAYS` | 30 | AI の利用回数を残す日数（2〜400） |
| `RETENTION_PROCESSING_DAYS` | 365 | 処理の記録と AI アプリからの呼び出しの記録を残す日数（30〜3650） |
| `RETENTION_DELETION_PROOF_YEARS` | 5 | 削除したアカウントの同意の記録・保護者の同意の証拠・削除の記録を残す年数（1〜10） |
| `RETENTION_AI_APP_RECORD_YEARS` | 3 | 削除したアカウントの、使っていた AI アプリの記録を残す年数（1〜10） |
| `LEGAL_TERMS_REQUIRED` | 未設定（同意は画面だけで求める） | `true` で、今の利用規約に同意していない学習者の API の呼び出しを `403 terms_required` で断ります（Phase 8。断らない操作は `server/middleware/termsGate.js` の `TERMS_EXEMPT`）。文面が案のあいだは `true` でも効かず、起動時のログに出します。`mcp-public` は同じ名前を `mcp-public.env` から読みます（AI アプリからの呼び出しも断ります）。入れる順番：文面の公開 → Vercel の `VITE_FEATURE_LEGAL_PAGES=true` と同意の画面の確かめ → `byoa` なら `sql/mcp_remote_role.sql` を流し直す → `stack.env` と `mcp-public.env` に `true` → `deploy-stack.sh`。止めるときは逆の順番です（この切り替えから）。画面のフラグが止まったまま `true` にすると、同意する画面がないまま断られます。同意をお願いする新しい版を出すときは、先に両方で止め、同意の画面が出てから入れ直します（[`doc/legal/README.md`](../../doc/legal/README.md) の「改定するとき」） |

保存期間の処理は、`api` の起動時と 1 時間ごとに動きます（2 つの `api` が同時に動いても、1 つだけが消します）。値がまちがっていると、その規則だけを止め、起動時のログに出します（`[Retention] …`）。

**スタッフの削除**（`api` コンテナの中で。手順と終了コードは運用ガイド）

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --find-email someone@example.com
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --user <uuid> --dry-run
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --user <uuid> --yes
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --orphans        # 月に 1 回。一覧を見てから --yes
```

**DB の確かめ（使い捨ての DB だけ）**: `scripts/db/verify-account-deletion.mjs --url <使い捨ての PostgreSQL 16>` は、migration 018 と削除・同意・保存期間の動きを本物の PostgreSQL で確かめます。`public` か `auth` に表がある DB、`risepath_mcp_remote` のロールがあるクラスタ、スーパーユーザーでない接続では動きません（VM の DB には決して向けないでください）。R11 はサーバーのログを読むので、ログを標準出力に出すクラスタでは `--log-file <ログのパス>` を付けます。確かめられなかった項目があると終了コード 3 になります（`--allow-skip` を付けたときだけ 0）。

## 保存の様子・レッスンのやり直し・XP（Phase 5）

学習の記録を保存できているかの表示、1 つのレッスンのやり直し、サーバーの記録から数える XP・バッジ・学んだ日です。決定と理由は [`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 9 章です。

**この版の最初のデプロイ**

- migration 019 を当てる前に、この版の `api`・`mcp`・`mcp-public` を起動しません。`deploy-stack.sh` は migrate のあとに作り直すので、そのまま使えます。
- `sql/mcp_remote_role.sql` は流し直さなくてかまいません（019 の表は、どれもリモート MCP のロールに渡しません）。
- 019 を当てるあいだは、アカウントの削除をしません。スタッフの削除（`--yes`）は待ちます。画面からの削除を使えるようにしているとき（`ACCOUNT_DELETION_ENABLED=true`）は、人の少ない時間にデプロイします。重なると、Postgres がデッドロック（40P01）でどちらかを止めます。止まったほうは何も変えずに戻ります（019 は 1 つのトランザクションです）。migrate が 40P01 で止まったら `./scripts/deploy-stack.sh` をもう一度実行し、削除が終了コード 3 で止まったら、デプロイのあとにもう一度実行します。
- 画面（Vercel）と VM の順番は、計画の 9.2 の 1 です。
- **DB の確かめ（使い捨ての DB だけ）**: `scripts/db/verify-phase5.mjs` は、019 と、やり直し・XP の数え直し・削除との重なりを本物の PostgreSQL 16 で確かめます（[`server/migrations/README.md`](../../server/migrations/README.md) の 019 の行）。VM の DB には決して向けないでください。

## 復習（Phase 6）

レッスンの復習カードが、忘れかけたころにもう一度出る仕組みです（1 日 10 枚まで）。決定と理由は [`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 10 章です。

**この版の最初のデプロイ**

- migration 020 を当てる前に、この版の `api`・`mcp`・`mcp-public` を起動しません。`deploy-stack.sh` は migrate のあとに作り直すので、そのまま使えます。
- `byoa` を使っているときは、020 を当てたあとに `sql/mcp_remote_role.sql` を流し直します（[`doc/guides/byoa-setup.ja.md`](../../doc/guides/byoa-setup.ja.md) の手順 7。パスワードは今の値）。流すまで、AI アプリの復習の 2 つのツール（`course-review-due`、`course-review-grade`）は使えません（`review_unavailable`）。ほかのツールは動きます。
- 020 は終わるまで `auth.users` をロックするので、ログインした呼び出しは 020 が終わるまで待ちます。人の少ない時間に当てます。アカウントの削除が重なってもデッドロック（40P01）にはなりません。削除は 020 を待ち、10 秒を超えると `account_busy` で終わるので、あとでもう一度実行します。
- 画面（Vercel）と VM は、どちらを先にしても壊れません（新しい画面は、古い API では復習を出しません。計画の 10.2 の 1）。

**前の版に戻したあと、この版に戻すとき**

前の版（Phase 5）のイメージで動いているあいだは、レッスンのやり直しと「学習の進み具合を消す」が、復習のカードを消しません。この版に戻すときは、この版の `api`・`mcp`・`mcp-public` を起動する前に、次の 2 つの確認と 2 つの削除を流します。先に起動すると、学習者が残ったカードを復習でき、あとの削除がその記録も消してしまいます。前の版のサービスを止めてから流し、そのあとで `./scripts/deploy-stack.sh` を実行します。

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env stop api mcp mcp-public   # byoa を使っていないときは mcp-public を外す
docker compose --env-file stack.env exec db psql -U risepath_app -d risepath
```

psql で、まず 2 つの確認を流します。どちらも 0 行なら、削除は要りません。

```sql
-- 1. 「学習の進み具合を消す」（またはアカウントの使い直し）より前に加わったカード
SELECT c.user_id, count(*) AS cards FROM review_cards c
  JOIN lesson_progress_resets r USING (user_id)
 WHERE c.entered_at < r.reset_at GROUP BY 1;
-- 2. そのレッスンのやり直しより前に加わったカード
SELECT c.user_id, c.course_slug, c.lesson_id, count(*) AS cards FROM review_cards c
  JOIN lesson_progress_lesson_resets r USING (user_id, course_slug, lesson_id)
 WHERE c.entered_at < r.reset_at GROUP BY 1, 2, 3;
```

行があれば、次の 2 つの削除を流します。復習の記録（`review_log`）は、カードと一緒に消えます。この版のやり直しと「学習の進み具合を消す」が消したあとに加わったカードは、どちらにも当てはまりません。

```sql
DELETE FROM review_cards c USING lesson_progress_resets r
 WHERE r.user_id = c.user_id AND c.entered_at < r.reset_at;
DELETE FROM review_cards c USING lesson_progress_lesson_resets r
 WHERE r.user_id = c.user_id AND r.course_slug = c.course_slug AND r.lesson_id = c.lesson_id AND c.entered_at < r.reset_at;
```

- **DB の確かめ（使い捨ての DB だけ）**: `scripts/db/verify-phase6.mjs` は、020 と、カードが加わる決まり・復習の記録・やり直しと削除・リモート MCP のロールの列ごとの権限・上の確認と削除（P10）を、本物の PostgreSQL 16 で確かめます（[`server/migrations/README.md`](../../server/migrations/README.md) の 020 の行）。VM の DB には決して向けないでください。

## CI での予行（Phase 7）

GitHub Actions の `End-to-end checks`（`.github/workflows/e2e.yml`）は、プルリクエストのたびに、このディレクトリの `deploy-stack.sh` をダミーの値で動かします（チェック `Server stack deploy` と `Learner end-to-end`）。決定と理由は [`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 11 章です。

- `ci/stack.ci.env` は、CI だけのダミーの値です。VM では使いません。`scripts/ci/stack.sh` が 1 回の実行のあいだだけ `stack.env` にコピーし、終わると消します。1 行目に `# risepath-ci-env:` の印があり、印のない `stack.env`（自分で作ったもの）があると、書き換えずに止まります。`billing.env`・`tunnel.env`・`mcp-public.env` があるときも止まります。
- Compose のプロジェクト名は `risepath-ci` なので、`risepath` のスタックには触れません。
- `deploy-stack.sh` は、環境変数 `RISEPATH_DEPLOY_SKIP_PULL=1` のときだけ git pull を飛ばします。**VM では設定しません。** `stack.env` に書いても効きません。
- CI が確かめること: 空の DB への migration 000–020、`deploy-stack.sh` の順番・ヘルスチェック・スモーク、`sql/mcp_remote_role.sql`（2 回。`Database checks`）、ブラウザでの学習の流れ。確かめないこと（`mcp-public`、2 回目のデプロイ、起動のユニット、origin gate、git pull と、HEAD が動いたときのやり直しも）は、計画の 11.3 の 1 です。
- 作り直した VM の最初のデプロイの前に、main の 3 つのチェック（`Database checks`・`Server stack deploy`・`Learner end-to-end`）が緑であることを確かめます。
- 手元で同じことを流すときは `npm run ci:stack`（`Server stack deploy`）と `npm run e2e:local`（`Learner end-to-end`）です（Docker が要ります。計画の 11.1 の「手元で流す」）。動いているあいだは 5432・3006・3100 を、すべてのネットワークに開くので、信頼できるネットワークでだけ流します。

## セキュリティ

- GCP VPC ファイアウォールで **5432/3006/3100/8642/8880 を 0.0.0.0/0 に開放しない**。アプリ用の受信ルールは要りません（公開は Cloudflare Tunnel の外向き接続）
- `ORIGIN_SECRET` を設定すると、API は `api` コンテナ内の loopback 以外から来て `x-origin-secret` が無いリクエストに 403 を返します。Tailscale から :3006 を呼ぶ場合も同じです
- 正しいヘッダーを持つリクエストは edge 扱いです。Bridge Token は使えず、Supabase JWT が要ります。届くのは `/api/*`・`/audio/cache/`・`/generated/img_*` だけで、`/uploads` はインターネットから読めません
- Tailscale ACL で `risepath-vm` へのアクセスを限定
- `stack.env`・`tunnel.env`・`mcp-public.env`・`billing.env` は `chmod 600`、Git に含めない（`.dockerignore` でビルドにも入れない）
- Stripe の鍵（`sk_`・`rk_`・`whsec_`）は `billing.env` だけに入れる。`stack.env`・`mcp-public.env`・Vercel・`VITE_*` には入れない（ブラウザは Stripe の値を何も使わない）
- `stack.env` にテンプレの値（`change-me` など）を残さない。DB・Bridge Token・Hermes の値は上の表のとおりに作る
- `RISE_PATH_BRIDGE_TOKEN` を ChatGPT などの外部サービスに入れない。管理者用の MCP（3100）を ngrok などのトンネルやファイアウォールの開放でインターネットに出さない。ChatGPT・Claude.ai などのリモート接続は、学習者ごとのログイン（OAuth）を持つ `mcp-public`（profile `byoa`、`https://mcp.<domain>`）だけで提供します
- `mcp-public.env` に `stack.env` の秘密（ブリッジトークン、service_role key、モデルや Memanto のキー、`risepath_app` のパスワード）を入れない
- 学習者向けのスタックでは `GEMINI_ALLOWED` を設定しない（Gemini の API 規約の 18 歳未満の条項）
