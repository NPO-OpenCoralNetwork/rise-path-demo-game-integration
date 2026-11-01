# Rise Path VM deploy (`risepath-vm`)

新しい VM から公開までの手順: [`doc/guides/first-launch.ja.md`](../../doc/guides/first-launch.ja.md)（手順書）/ 正本: [`doc/guides/risepath_vm_deployment.md`](../../doc/guides/risepath_vm_deployment.md) / フロント（Vercel）と切り替え手順: [`deploy/vercel/README.md`](../vercel/README.md)

2026-10-21 に、オーナーが GCP の `risepath-vm` を削除しました。新しい VM は下のクイックスタートで作り、DB は空から始まります。全体の順番（Cloudflare のゾーン追加を最初に始める、など）と Cloudflare・Vercel・Supabase の作業は、[手順書](../../doc/guides/first-launch.ja.md)の 2 章から順に進めます。

## 運用方針

| 項目 | 内容 |
|------|------|
| VM | 専用 GCP `risepath-vm`。既定は `e2-medium`（2 vCPU / 4 GB）+ 50GB `pd-balanced`。Memanto を使うなら `e2-standard-2`（2 vCPU / 8 GB）。下の「[マシンタイプ](#マシンタイプ)」 |
| 稼働 | **24 時間**。公開 API が VM に載るため、夜間停止はやめました。`provision-gce.sh` を `NIGHT_STOP=1` で実行すると 09:00–23:00 JST のスケジュールに戻せます |
| 月額目安 | **推定**（未確認）。24 時間稼働の `asia-northeast1` で、`e2-medium` は約 $31/月、`e2-standard-2` は約 $63/月。50GB ディスクは別です。どれも第三者のサイト（[gcloud-compute.com](https://gcloud-compute.com/e2-medium.html)）の値で、Google の料金ページでは確かめていません。予算アラートを決める前に、[GCP の料金計算ツール](https://cloud.google.com/products/calculator)で確かめます |
| DB | `pgvector/pgvector:0.8.7-pg16`（Postgres 16 + pgvector。タグと digest を固定）。新しい空のボリュームでは RAG のベクトル検索が有効です |
| 公開 | API は Cloudflare Tunnel の `https://api.<domain>`。大人が自分の AI をつなぐリモート MCP（Compose のプロファイル `byoa`、`mcp-public`）を有効にしたときだけ、同じトンネルの `https://mcp.<domain>` も公開します。フロントは Vercel の `https://app.<domain>`。GCP ファイアウォールにアプリ用の受信ルールは作りません |
| Mac | `npm run dev` と、Mac の中だけで動く開発用の DB（下の「3. Mac の `.env.local`（開発用の DB）」）。本番の DB には Mac からつなぎません（D8、手順書 18 章）。Tailscale で VM に届くのは、名前を決めた管理者の `npm run smoke:vm`（3006、3100）だけです。`ORIGIN_SECRET` を設定したあとは、api（:3006）に `x-origin-secret` ヘッダーが要ります |
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
| `scripts/preflight.sh`・`scripts/check-mode.sh` | 事前チェック（Phase 9）。下の「[事前チェックと事後の確かめ](#事前チェックと事後の確かめphase-9)」 |
| `scripts/postdeploy-check.sh` | 事後の確かめ（Phase 9。デプロイの最後に動く） |
| `launch-record.env.example` | 公開の記録のテンプレ → `launch-record.env`（git に入れません。手順書 14 章） |
| `scripts/backup.sh`・`scripts/install-backup.sh`・`scripts/restore-drill.sh`・`scripts/restore-db.sh`・`scripts/backup-common.sh` | 控え（Phase 9）。下の「[控え（バックアップ）](#控えバックアップphase-9)」 |
| `backup.env.example`・`systemd/risepath-backup*` | 控えの設定のテンプレ（VM では `/etc/risepath-backup/backup.env`）と、毎日・1 時間ごとのタイマー |

## クイックスタート

新しい VM を作る手順です（コマンドはここにあります。順番と、うまくいったときの見え方は[手順書](../../doc/guides/first-launch.ja.md)の 4〜6 章です）。始める前に、手順書の 2 章と 3 章にある次の 3 つを始めておきます（ゾーンが Active になるのを待つ必要はありません）。

- Cloudflare にドメインを追加し、ネームサーバーを切り替える（Active まで最大 48 時間かかるので最初に始める）
- GCP の予算アラートを作り、残っていれば `risepath-dev-schedule` を消す
- Tailscale の管理画面（Machines）で旧 `risepath-vm` を Remove し、Mac で `ssh-keygen -R risepath-vm` を実行する

### 1. GCP で VM 作成（Mac から）

Mac のリポジトリ直下で、`main` を pull してから実行します（`gcloud auth login` 済みであること）。

```bash
export GCP_PROJECT=your-project-id
cd deploy/risepath-vm/scripts
BACKUP_SA_EMAIL=<手順書 3.8 のアドレス> ./provision-gce.sh   # 既定: e2-medium（4 GB）+ 50GB
# Memanto を使うとき: MACHINE_TYPE=e2-standard-2 BACKUP_SA_EMAIL=<手順書 3.8 のアドレス> ./provision-gce.sh   # 8 GB
```

`BACKUP_SA_EMAIL` は、控え（バックアップ）用のサービスアカウントのアドレスです（手順書 3.8 で作ります）。付けないと、VM は GCE のふつうのサービスアカウントで動き、控えを送れません（手順書 6.4 の `install-backup.sh` が IB4 で止まります）。そのときは、スクリプトが出す 3 つのコマンドで、あとからアカウントを付けます（手順書 4.1 の 4）。

`provision-gce.sh` は受信ルールを作りません。ただし GCP のファイアウォールルールはタグ `risepath-vm` に付くので、前の VM のルールが残っていれば新しい VM にも効きます。[`deploy/vercel/README.md`](../vercel/README.md) の手順 3 で確かめます。

### 2. VM に SSH して初回 bootstrap

`bootstrap-vm.sh` は 2 回実行します。1 回目は Docker と swap を入れ、`stack.env` を作って止まります。スクリプトは sudo を使うので、SSH のユーザーに sudo の権限が要ります（OS Login では `roles/compute.osAdminLogin`）。

```bash
gcloud compute ssh risepath-vm --zone=asia-northeast1-b

# Tailscale（先に管理画面の Machines で旧 risepath-vm を Remove しておく）
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=risepath-vm --advertise-tags=tag:risepath   # 表示された URL をブラウザで開いて認証する（タグは手順書 3.4 の ACL のもの）
tailscale status                           # この VM が risepath-vm と表示されること

# リポジトリ（/opt は root 所有なので、先に自分のディレクトリとして作る）
sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/risepath
git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git /opt/risepath
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# 1 回目: Docker と 4 GB の swap を入れ、stack.env を作って止まる
exit
```

旧 `risepath-vm` が Tailscale の管理画面に残っていると、新しい VM は `risepath-vm-1` になります。旧 `risepath-vm` をあとで消しても、名前は戻りません。すでに `-1` になったら、旧 `risepath-vm` を Remove してから、新しいマシンの名前を管理画面で `risepath-vm` に変えます。ACL はタグ `tag:risepath` で書くので（手順書 3.4。下の「セキュリティ」）、VM のアドレスが変わっても直す必要はありません。旧 VM の 100.x アドレスを書いた古い ACL が残っていたら、タグの形に書きかえます。

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

`deploy-stack.sh` は、`POSTGRES_PASSWORD`・`DATABASE_URL_PHASE1`・`SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・`RISE_PATH_BRIDGE_TOKEN` が空かテンプレの値のままだと、変数名だけを表示して build の前に止まります。`COMPOSE_PROFILES` に `full` があるとき（Hermes を有効にしたときだけ）は、`OPENROUTER_API_KEY` と `HERMES_API_KEY`（16 文字以上）も確かめます。`ANTHROPIC_API_KEY` が空でないこと、`GEMINI_API_KEY` と `GEMINI_ALLOWED` が空であることは、事前チェック（`preflight.sh`）が確かめます（手順書 5.3）。

#### 2 回目の実行

```bash
gcloud compute ssh risepath-vm --zone=asia-northeast1-b
nano /opt/risepath/deploy/risepath-vm/stack.env   # 上の表のとおりに埋める
# 作り直した VM の最初のデプロイなら、ここで 2 つ見ます（計画の 11.2 の 3）: docker version と docker compose version を
# CI の Server stack deploy の「Preflight」の行とくらべ、stack.env の SUPABASE_URL が https://<project>.supabase.co であることを見ます。
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# 2 回目: build → db 起動 → migration 000–022 → api → up → healthy を待つ → smoke → systemd 登録
```

最後に `api` コンテナ内の smoke が通れば、スタックは動いています。VM 起動時にスタックを上げる systemd ユニットは、このデプロイが通ってから登録されます。`deploy-stack.sh` が途中で止まったら、表示された原因（テンプレの値なら変数名）を直し、`./bootstrap-vm.sh` をもう一度実行します（systemd ユニットは bootstrap だけが登録します）。

新しい VM の DB は空から始まります。この初回デプロイで、migration 000–022 がすべて適用されます。db イメージは pgvector 入りなので、000 が `vector` 拡張を作り、`material_chunks.embedding` は `vector(768)`（HNSW インデックス付き）になります。RAG のベクトル検索が使えます（ただし埋め込みには Gemini が要るので、`GEMINI_ALLOWED` を設定しない既定では、教材はキーワード検索で探します）。これは新しい空の `pgdata` ボリュームのときだけです。pgvector の無いイメージで作ったボリュームは、イメージを替えても `FLOAT8[]` のままで、RAG はキーワード検索で動きます（[`server/migrations/README.md`](../../server/migrations/README.md)）。

学習者がアップロードした教材のファイルは、`uploads` ボリューム（API のコンテナの `/app/uploads`）に置かれ、再デプロイしても残ります。以前の版は、コンテナの中の `public/uploads` に置いていたので、デプロイのたびに消えていました。アカウントの削除と保存期間の処理が、このボリュームのファイルも消します。

### 3. Mac の `.env.local`（開発用の DB）

試験運用から先は、Mac の `.env.local` を本番の DB に向けません（D8）。Mac の中だけで動く開発用の DB を使います。作り方（`docker run … -p 127.0.0.1:5433:5432 …`、`DATABASE_URL_PHASE1=…@127.0.0.1:5433/risepath…`、`npm run db:migrate`）は[手順書の 18 章](../../doc/guides/first-launch.ja.md)にあります。本番の DB の調べものとスタッフによる削除は、VM の中（SSH）でだけします。

Mac の `~/.ssh/known_hosts` に旧 VM の鍵が残っていると、`scripts/setup-vm-ssh.sh` と `scripts/deploy-from-mac.sh` の ssh が止まります。先に消します。

```bash
ssh-keygen -R risepath-vm   # 旧 VM に 100.x アドレスで接続していたなら、そのアドレスも消す
tailscale ping risepath-vm
```

`stack.env` に `ORIGIN_SECRET` を入れる前に、Mac から Tailscale 経由の smoke を流しておきます（下の「[手動でスタック操作](#4-手動でスタック操作vm-上)」の `npm run smoke:vm -- --base …`。`.env.local` は読みません。引数なしだと Mac の 127.0.0.1 を見ます）。ふだんの開発は、Mac のローカル API（`npm run dev`）と開発用の DB でします。

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
npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100
```

Mac のリポジトリ直下で流します（手順書 6.3）。引数なしだと Mac の 127.0.0.1 を見るので、VM は確かめられません。Tailscale の ACL（手順書 3.4）は 8880（読み上げ）と 8642（Hermes）をだれにも開けないので、Kokoro・Hermes・Memanto は Mac からは確かめません。その 3 つの ⚠️ の行と、Front end の ℹ️ の行は出てよい行で、最後に「✅ VM stack smoke passed」が出れば通っています（読み上げは、`deploy-stack.sh` の smoke が `api` コンテナの中から `--require-kokoro` で確かめます）。Hermes を有効にし、ACL で 8642 を名前を決めた管理者に開けたときだけ、最後に `--hermes http://risepath-vm:8642` を足します。

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

ポートの公開は変えていません。db（5432）・mcp（3100）・kokoro（8880）と、Hermes を有効にしたときの hermes（8642）のポートは VM で公開したままですが、Tailscale の ACL（手順書 3.4）で開けるのは、名前を決めた管理者への 3006 と 3100 だけです。5432（db）は、だれにも開けません（D8。本番の DB には VM の中からだけ触ります。手順書 18 章）。api（3006）だけは、`ORIGIN_SECRET` を設定すると `x-origin-secret` が要ります。ヘッダーを付けた呼び出しは edge 扱いなので、Bridge Token は使えず、edge のパス（`/api/*` など）にしか届きません。VM の api はフロントを配信しません（`api` イメージに `dist/` はありません）。フロントは `app.<domain>` を使います。

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
| `PILOT_ACCOUNT_IDS` | 未設定（名簿なし。ログインできる人はだれでも使える） | 試験運用の名簿です（Phase 9、D1）。Supabase の User UID をカンマで区切って書くと、名簿にないアカウント（匿名のログインも）の API の呼び出しを `403 pilot_only` で断り、画面は「このアカウントは、いまの試験運用の対象ではありません」になります。断る呼び出しには例外がなく、断ったアカウントについて DB に何も書きません（`server/middleware/pilotGate.js`）。ID の形でない項目は使わず、ひとつも ID がないと全員を断ります（事前チェックの V2 がデプロイを止めます）。起動時のログに `[Pilot] on: N accounts` と出ます（ID は出しません）。AI アプリの接続（`mcp-public`）は名簿を読まないので、名簿があるあいだは `byoa` を使いません（V4）。Tailscale の中の MCP（`mcp`、3100）も、学習者のログインを名簿で確かめません。3100 は、Tailscale の ACL で名前を決めた管理者だけに開け、GCP のファイアウォールでは開けません（手順書 3.4・4.3）。入れる・足す・外す手順は手順書 10.1〜10.4（[`doc/guides/first-launch.ja.md`](../../doc/guides/first-launch.ja.md)）。一般の登録を開くときに、この行を消します（手順書 11.8） |

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

## 職業訓練（骨組み）

職業訓練の期と割り当て、受講時間の設定と記録、`/api/v2/training` の入口です。学校のデプロイだけで使い、公開版の Rise Path では使いません。決定と理由は [`doc/brushup-2026/training-plan.ja.md`](../../doc/brushup-2026/training-plan.ja.md) です。

**この版の最初のデプロイ**

- migration 021 を当てる前に、この版の `api`・`mcp`・`mcp-public` を起動しません。021 がないまま `api` を起動すると、アカウントの削除がすべて `deletion_unavailable` で止まります（削除の処理が 021 の表に印を付けるため）。`deploy-stack.sh` は migrate のあとに作り直すので、そのまま使えます。
- 021 は新しい表を 2 つ作るだけです。`auth.users` はロックせず、ログインした呼び出しもアカウントの削除も待ちません。`sql/mcp_remote_role.sql` は流し直さなくてかまいません（どちらの表も、リモート MCP のロールに渡しません）。
- migration 022（受講時間）も同じです。022 がないまま `api` を起動すると、アカウントの削除がすべて `deletion_unavailable` で止まります（削除の処理が受講時間の記録にも印を付けるため）。022 も新しい表（7 つ）を作るだけで、`auth.users` はロックせず、`sql/mcp_remote_role.sql` も流し直さなくてかまいません。
- 公開版では `TRAINING_ENABLED` を設定しません。表は空のままで、`/api/v2/training` は 404 を返し、職員のスクリプトも動きません。

**設定（`stack.env`。秘密の値ではありません。`api` だけが読みます）**

| 変数 | 既定 | 中身 |
|---|---|---|
| `TRAINING_ENABLED` | 未設定（止まっている） | ちょうど `true` のときだけ、`/api/v2/training` が答え、職員のスクリプトが動きます。ほかの値（`TRUE`・`1`・`yes` など）では止まったままです。値は `api` のコンテナを作るときに入るので、変えたら `./scripts/deploy-stack.sh` を実行し直します（`exec` で動かす職員のスクリプトも、そのコンテナの値を見ます）。学校のデプロイだけで設定します |

**職員のスクリプト**（`api` コンテナの中で。`TRAINING_ENABLED=true` のときだけ動きます）

```bash
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env exec -T api node scripts/training-admin.mjs --create-cohort 2026-11-web --name "2026年11月 Web" --starts-on 2026-11-01 --ends-on 2027-01-31
docker compose --env-file stack.env exec -T api node scripts/training-admin.mjs --add <account uuid> --cohort 2026-11-web --role learner
docker compose --env-file stack.env exec -T api node scripts/training-admin.mjs --list 2026-11-web
```

割り当てる人には、先にこのデプロイの画面に一度ログインしてもらいます（アカウントの行ができるまで、割り当ては断られます）。役割は `learner`（受講者）・`instructor`（講師）・`examiner`（確認用）・`staff`（職員）です。終了コード: 0 = できた（または、もうそうなっている）、1 = 使い方のまちがい、2 = 断った（`TRAINING_ENABLED` が `true` でない、期がない、ほかの役割で割り当てずみ、期間の重なるほかの期の受講者、削除したアカウント、まだログインしていない）、3 = いまは使えない（DB。アカウントの削除の途中なら、10 秒待って止まります。あとでもう一度実行します）。

**受講時間の職員のスクリプト**（`api` コンテナの中で。`TRAINING_ENABLED=true` のときだけ動きます）

単元表（単元と、それぞれの設定時間）と数え方の規則は、リポジトリに入れない非公開のファイルです。VM では checkout（`/opt/risepath`）の外の、root だけが読めるフォルダ（下の例では `/opt/risepath-private`。`sudo install -d -m 700 /opt/risepath-private` で作ります）に置き、`sudo cat` で読んで stdin に流します（`exec -T` が要ります。`<` で渡すと、root でないシェルが開くので読めません）。規則の値は画面に出ません。読み込んだ版は sha256 で示されるので、学校の記録に残します。

```bash
cd /opt/risepath/deploy/risepath-vm
sudo cat /opt/risepath-private/course.json | docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --load-catalog --by <who> --note <text>
sudo cat /opt/risepath-private/time-rules.json | docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --load-rules --by <who> --note <text>
docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --set 2026-11-web --catalog <sha256> --rules <sha256> --from 2026-11-01 --by <who> --reason <text>
docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --show 2026-11-web
docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --close 2026-11-web
docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --stats 2026-11-web
```

- `--load-catalog`・`--load-rules`: 変えない版として読み込みます。同じ内容をもう一度読み込んでも、前の版のままです。形がちがうときは、どの項目かだけを出して断ります。
- `--set`: 期が、どの単元表と規則を何日から使うかを足します（足すだけで、変えたり消したりはしません）。今日より前の日と、期の最後の日より後は断ります。今日すでに設定が効いている期では、新しい設定は明日からです。受講時間の記録が始まった期では、今日効いている設定と同じコースの単元表だけを使えます（規則や単元表の新しい版、記録の前に予定したコースの切り替えの取り消しはできます）。始まりと終わりの日付がない期では、受講時間を数えないので断ります。
- `--show`: 期の設定（版は sha256 で）。`--learner <account uuid>` を付けると、その人の確定した日と、単元ごとの時間です。
- `--close`: 期の受講者ごとに、確定できる日（その日の終わりから、規則の途切れの長さが過ぎた日）を閉じます。0 分の日も行を作り、閉じた日は変えません。`--learner <account uuid>` で 1 人だけにもできます。合図を受け取る API は次の版で入るので、それまでは 0 分の日だけです。
- `--stats`: 行の数（削除したアカウントの分も）と、最後に閉じた日です。
- 設定のない日は、受講時間を数えません。デプロイ、期と割り当ての操作は、設定がなくても動きます。

終了コード: 0 = できた（または、もうそうなっている）、1 = 使い方のまちがい（ファイルを流していないときも。5 秒待っても何も届かなければ止まります）、2 = 断った（`TRAINING_ENABLED` が `true` でない、ファイルの形がちがう、期や版がない、日付が範囲の外、今日すでに設定が効いている、今日効いている設定とちがうコースの単元表、保存した版をこのコードで読めない）、3 = いまは使えない（DB。ロックが 10 秒空かないときも。あとでもう一度実行します）。

- **DB の確かめ（使い捨ての DB だけ）**: `scripts/db/verify-account-deletion.mjs` の R6 と R12 が、021 と、割り当て・削除の印・削除との重なりを、`scripts/db/verify-training.mjs` が 022 と、設定の決まり・日を閉じる処理・削除との重なりを、本物の PostgreSQL 16 で確かめます（[`server/migrations/README.md`](../../server/migrations/README.md) の 021 と 022 の行）。VM の DB には決して向けないでください。

## 事前チェックと事後の確かめ（Phase 9）

- **事前チェック（`preflight.sh`）**: `deploy-stack.sh` は、`stack.env` を読む前に、まずこれを動かします。`stack.env`・`tunnel.env`・`mcp-public.env`・`billing.env`・`launch-record.env` と VM のいくつかの事実を確かめ、名前とコードと日本語の直し方だけを出します（値は出しません）。エラーがあると、何も変えずにデプロイを止めます。ルールは `scripts/deploy/preflight-rules.mjs`（node の組み込みだけ）で、`node:22-slim` のコンテナの中で、ネットワークなし、読み取りだけで動きます。
- 単独でも動かせます: `cd /opt/risepath/deploy/risepath-vm && ./scripts/preflight.sh`（何も変えません）。**sudo は付けません**（root では X5 で止まります）。
- **事後の確かめ（`postdeploy-check.sh`）**: デプロイの最後に動き、api・MCP・AI の設定・読み上げ・cloudflared・起動のユニットを確かめます。単独でも `./scripts/postdeploy-check.sh` で動かせます（sudo なし）。
- コードの意味と直し方は[手順書の 13 章](../../doc/guides/first-launch.ja.md)、公開の記録（`launch-record.env`。オーナーが確かめた日を書きます。git に入れません）は 14 章です。
- デプロイは、SSH でふつうにログインしたシェルから実行します。CI の手順にある `COMPOSE_PROJECT_NAME=risepath-ci` などを VM で `export` しません（事前チェックの F12 が止めます）。

## 控え（バックアップ、Phase 9）

- `scripts/backup.sh` が、毎日 3 時 23 分ごろ（日本時間。`systemd/risepath-backup.timer`）に DB とアップロードを控え、VM の鍵で暗号化して（`scripts/deploy/backup-crypt.mjs`）、Google Cloud のバケットに置きます。削除の記録は 1 時間ごとに控えます（`risepath-backup-journal.timer`）。失敗すると、`stack.env` の `AI_CAP_ALERT_WEBHOOK_URL` の Slack に知らせます。
- 入れ方: `sudo ./scripts/install-backup.sh --new-key`（設定は `/etc/risepath-backup/backup.env`、鍵は `/etc/risepath-backup/backup.key`）。鍵の写しを VM の外にしまうことまで、[手順書の 6.4](../../doc/guides/first-launch.ja.md) にあります。バケットとサービスアカウントは 3.8、VM に付けるのは 4.1 です。
- バケットとサービスアカウント（手順書 3.8）: サービスアカウント `risepath-backup` にプロジェクトの役割は付けません。バケット `<プロジェクト>-risepath-backup` は `asia-northeast1`、Standard、uniform bucket-level access、公開アクセスの防止を強制、バージョニングなしです。役割は、そのバケットにだけ 2 つ付けます: Storage Object Creator（`roles/storage.objectCreator`）と Storage Object Viewer（`roles/storage.objectViewer`）。消すことと上書きはできません（`backup.sh` は、同じ名前のオブジェクトを 2 度作りません）。ライフサイクルは「30 日より古いオブジェクトを削除する」で、`backup.env` の `BACKUP_RETENTION_DAYS` と同じ日数にします。
- ディスクのスナップショット（手順書 4.2）: VM のディスクには、スナップショットのスケジュールを付けません。控えは、この暗号化したものだけです（スナップショットは、暗号化していない DB と秘密の値を、ライフサイクルの日数の外に残します）。
- 戻す練習（4 週間ごと。前の練習から 35 日をこえると R3）: `sudo ./scripts/restore-drill.sh`（本番の DB は変えません。手順書 16.1）。
- 本当に戻すとき: `sudo ./scripts/restore-db.sh`（エージェントと一緒に。控えのあとの削除を、学習者に出す前に当て直します。`scripts/replay-deletions.mjs`）。手順書 16.2・16.3。
- デプロイは、控えの動く 3 時から 4 時（日本時間）を避けます。

### 戻しが RS8 で止まったとき（保護者の同意の取り消しか、AI アプリの切断の記録）

`scripts/replay-deletions.mjs` は、控えのあとに保護者の同意の取り消し（`consent`）か AI アプリの切断（`grant`）の記録があると、何も変えずに、終わりの番号 2 で止まります（「この版では自動で戻せません」。自動にするのは計画の 13.5 です）。DB は控えの中身に戻っていますが、削除はまだ当て直していません。戻しの途中の印は残り、学習者に向く部品は止まったまま、デプロイは R9 で止まります（手順書 16.2）。エージェントが、オーナーと一緒に、VM の tmux の中で、次の順に手で進めます。先に、止まったときの出力（「控えの始まり 日本時間 …（UTC: …）」の行と、`consent`・`grant` の行）を、事故の記録に写します。

1. **記録を集め直す**（`sudo -i` の root のシェルで）: `cd /opt/risepath/deploy/risepath-vm` のあと、`SCRIPT_DIR=$PWD/scripts STACK_DIR=$PWD REPO_ROOT=/opt/risepath`、`source scripts/backup-common.sh`、`bk_tmp`、`OWNER="$(stat -c %U /opt/risepath)"`、`SINCE=<「控えの始まり」の UTC の時刻>`、`BUCKET="$(bk_bucket)"`、`WORK="${BK_TMP}"` を実行します。次に、`scripts/restore-db.sh` の、控えのあとの削除の記録を集める行（RS4 のおわりにあります。`FROM_STAMP=` の行から、`読んだ記録:` を出す `echo` の行まで）を、そのまま実行します。記録は `"${BK_TMP}/journal.csv"` にできます（`/run` の中の 0700 のフォルダです。ディスクには書きません）。途中で ❌ の行が出ると、root のシェルが閉じます。そのときは、出た行を直してから、`bk_tmp` が作ったフォルダ（`rm -rf /run/risepath-backup.??????`。ロックのファイルは消しません）を消し、1 からやり直します。
2. **取り消しを手で当てる**: `grep -E '^(consent|grant),' "${BK_TMP}/journal.csv" | sort -u` から、止まったときに出た行（もとの時刻が同じもの）を探します。列は `kind,user_id,time,requested_by,reopened_at,course_slug,lesson_id,ref_id` です。その行ごとに、`runuser -u "${OWNER}" -- docker compose --env-file stack.env exec -T db psql -U risepath_app -d risepath -c "…"` で、次の文を実行します（`…` に、その種類の文をそのまま入れます。`grant` は 2 つの文を 1 つの `-c` に入れます）。
   - `consent`（`ref_id` は同意の id）: `UPDATE account_consents SET revoked_at = now() WHERE id = '<ref_id>' AND user_id = '<user_id>' AND revoked_at IS NULL;`（`revoked_at IS NULL` の条件があるので、もう取り消してある同意には何もしません）
   - `grant`（`ref_id` は AI アプリの client id。`server/routes/connectedApps.js` の取り消しと同じ形）: `INSERT INTO auth.users (id) VALUES ('<user_id>') ON CONFLICT (id) DO NOTHING; INSERT INTO mcp_oauth_grants (user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at) VALUES ('<user_id>', '<ref_id>', NULL, NULL, NULL, now()) ON CONFLICT (user_id, client_id) DO UPDATE SET revoked_at = now();`（1 つ目の文は、学習者の ID の行（`auth.users`）を、ないときだけ作ります。`server/db.js` の `ensureAuthUser` と、`tools/core/accountDeletions.js` と同じ文です。控えのあとに、はじめてログインした学習者は、戻した DB にこの行がなく、2 つ目の文だけでは外部キーのエラー（`mcp_oauth_grants_user_id_fkey`）で止まって、取り消しが記録されません。2 つ目の文は、取り消しの時刻を、いつも今にします。`mcp-server/oauthVerifier.js` は、取り消しの時刻より前に出たトークンを断ります。戻した行に、控えより前の古い取り消しの時刻が残っているとき、その時刻のままにすると、古い時刻のあとに出たトークンが通ってしまうためです。取り消しのあとに AI アプリをつなぎ直していた学習者は、もう一度つなぎます）

   `consent` では `UPDATE 1`（もう取り消してあったときや、控えのあとに作った同意のときは `UPDATE 0`）が出ます。`grant` では 2 行出ます。1 行目（ID の行）は `INSERT 0 1` か `INSERT 0 0`（もうあったとき）で、2 行目が `INSERT 0 1` なら、取り消しが記録されています。`ERROR` の行が出たら、何も変わっていません。その行を事故の記録に写して止めます（3 には進みません）。出た `UPDATE` と `INSERT` の数を、事故の記録に書きます（当て直した記録の時刻は、いまの時刻です。もとの時刻は、写した行にあります）。
3. **ほかの削除を当て直す**: `grep -v -E '^(consent|grant),' "${BK_TMP}/journal.csv" > "${BK_TMP}/rest.csv"` のあと、`runuser -u "${OWNER}" -- docker compose --env-file stack.env run --rm --no-deps -T api node scripts/replay-deletions.mjs --since "${SINCE}" < "${BK_TMP}/rest.csv"` で数を見ます（何も変えません）。オーナーと数を見て、合っていれば、`--since "${SINCE}"` のうしろに `--yes` を足して、もう一度実行します。
4. **RS10 を手でする**（`restore-db.sh` の RS10 と同じことを、この順に）: `if [[ "$(bk_restore_field stack)" == enabled ]]; then systemctl enable risepath-stack.service; fi`、`rm "${BK_RESTORE_MARK}"`（戻しの途中の印 `/var/lib/risepath-backup/restore-in-progress` を消します）、`for t in risepath-backup.timer risepath-backup-journal.timer; do if [[ "$(systemctl is-enabled "$t" 2> /dev/null)" == enabled ]]; then systemctl start "$t"; fi; done`（有効になっているタイマーだけを動かします。作り直した VM（手順書 16.3）には、まだタイマーがないので、何もしません。タイマーは 16.3 の 4 で入れます）、`./scripts/backup.sh daily`（戻した DB の控えを 1 つ作ります。タイマーがなくても動きます）。
5. **RS11**: `bk_cleanup_tmp` で 1 のフォルダを消し、`exit` で root のシェルを抜けて、sudo を付けずに `./scripts/deploy-stack.sh` を実行します。「==> Done」と、事後の確かめの「エラー 0 件」が出れば、学習者が戻れます。

## CI での予行（Phase 7）

GitHub Actions の `End-to-end checks`（`.github/workflows/e2e.yml`）は、プルリクエストのたびに、このディレクトリの `deploy-stack.sh` をダミーの値で動かします（チェック `Server stack deploy` と `Learner end-to-end`）。決定と理由は [`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 11 章です。

- `ci/stack.ci.env` は、CI だけのダミーの値です。VM では使いません。`scripts/ci/stack.sh` が 1 回の実行のあいだだけ `stack.env` にコピーし、終わると消します。1 行目に `# risepath-ci-env:` の印があり、印のない `stack.env`（自分で作ったもの）があると、書き換えずに止まります。`billing.env`・`tunnel.env`・`mcp-public.env` があるときも止まります。
- Compose のプロジェクト名は `risepath-ci` なので、`risepath` のスタックには触れません。
- `deploy-stack.sh` は、環境変数 `RISEPATH_DEPLOY_SKIP_PULL=1` のときだけ git pull を飛ばします。**VM では設定しません。** `stack.env` に書いても効きません。
- CI が確かめること: 空の DB への migration 000–022、`deploy-stack.sh` の順番・ヘルスチェック・スモーク、`sql/mcp_remote_role.sql`（2 回。`Database checks`）、ブラウザでの学習の流れ。確かめないこと（`mcp-public`、2 回目のデプロイ、起動のユニット、origin gate、git pull と、HEAD が動いたときのやり直しも）は、計画の 11.3 の 1 です。
- 作り直した VM の最初のデプロイの前に、main の 3 つのチェック（`Database checks`・`Server stack deploy`・`Learner end-to-end`）が緑であることを確かめます。
- 手元で同じことを流すときは `npm run ci:stack`（`Server stack deploy`）と `npm run e2e:local`（`Learner end-to-end`）です（Docker が要ります。計画の 11.1 の「手元で流す」）。docker のグループに入ったふつうのユーザーで流します（root で流すと、デプロイの中の事前チェックが X5 で止まります）。動いているあいだは 5432・3006・3100 を、すべてのネットワークに開くので、信頼できるネットワークでだけ流します。

## セキュリティ

- GCP VPC ファイアウォールで **5432/3006/3100/8642/8880 を 0.0.0.0/0 に開放しない**。アプリ用の受信ルールは要りません（公開は Cloudflare Tunnel の外向き接続）
- `ORIGIN_SECRET` を設定すると、API は `api` コンテナ内の loopback 以外から来て `x-origin-secret` が無いリクエストに 403 を返します。Tailscale から :3006 を呼ぶ場合も同じです
- 正しいヘッダーを持つリクエストは edge 扱いです。Bridge Token は使えず、Supabase JWT が要ります。届くのは `/api/*`・`/audio/cache/`・`/generated/img_*` だけで、`/uploads` はインターネットから読めません
- Tailscale ACL で `risepath-vm` へのアクセスを限定する（手順書 3.4）。VM には `tailscale up` の `--advertise-tags=tag:risepath` でタグを付け、決まりはタグで書く（VM は ACL を書くときにはまだ tailnet にいないため）。3006 と 3100 は、名前を決めた管理者だけに開け、5432・8642・8880 はだれにも開けない。新しい tailnet にはじめからある `"src": ["*"], "dst": ["*:*"]` の行は、`tag:risepath` に届かない形に書きかえる。例（`<管理者のメールアドレス>` は置きかえる）:

  ```json
  {
    "tagOwners": { "tag:risepath": ["autogroup:admin"] },
    "acls": [
      { "action": "accept", "src": ["<管理者のメールアドレス>"], "dst": ["tag:risepath:3006,3100"] }
    ]
  }
  ```

  確かめ方: Mac で `nc -z -w 3 risepath-vm 5432 && echo OPEN || echo closed` が `closed` を出す（8880 も同じ。手順書 6.3）
- `stack.env`・`tunnel.env`・`mcp-public.env`・`billing.env` は `chmod 600`、Git に含めない（`.dockerignore` でビルドにも入れない）
- Stripe の鍵（`sk_`・`rk_`・`whsec_`）は `billing.env` だけに入れる。`stack.env`・`mcp-public.env`・Vercel・`VITE_*` には入れない（ブラウザは Stripe の値を何も使わない）
- `stack.env` にテンプレの値（`change-me` など）を残さない。DB・Bridge Token・Hermes の値は上の表のとおりに作る
- `RISE_PATH_BRIDGE_TOKEN` を ChatGPT などの外部サービスに入れない。管理者用の MCP（3100）を ngrok などのトンネルやファイアウォールの開放でインターネットに出さない。ChatGPT・Claude.ai などのリモート接続は、学習者ごとのログイン（OAuth）を持つ `mcp-public`（profile `byoa`、`https://mcp.<domain>`）だけで提供します
- `mcp-public.env` に `stack.env` の秘密（ブリッジトークン、service_role key、モデルや Memanto のキー、`risepath_app` のパスワード）を入れない
- 学習者向けのスタックでは `GEMINI_ALLOWED` を設定しない（Gemini の API 規約の 18 歳未満の条項）
