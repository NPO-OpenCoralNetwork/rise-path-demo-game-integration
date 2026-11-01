# Rise Path 専用 VM デプロイ（`risepath-vm`）

> 更新日: 2026-10-22  
> ステータス: 2026-10-21 に、オーナーが GCP の **`risepath-vm` を削除した**。作り直す手順は §4.5（全体の順番と公開エッジは [`deploy/vercel/README.md`](../../deploy/vercel/README.md)）。新しい VM の DB は空から始まる。構成は db（pgvector 入り）/api/mcp（Memanto overlay は任意。`e2-standard-2` が要る）、50GB ディスク / kokoro は `COMPOSE_PROFILES=tts`（既定）で起動  
> AI の方針（2026-10-22、Phase 0。[`doc/brushup-2026/ai-access-plan.ja.md`](../brushup-2026/ai-access-plan.ja.md)）: アプリの中の AI（チューター・文章フィードバック・コース生成）は Claude の安いモデルで動かす。**共有の Hermes エージェントは学習者に提供しない**（`COMPOSE_PROFILES` に `full` を入れず、Vercel の `VITE_FEATURE_AGENT_CHAT` も設定しない。Hermes は自分で運用するときや開発のときだけ）。**Gemini は使わない**（`GEMINI_ALLOWED` を設定しない。Gemini の API 規約は 18 歳未満の人が使うサービスでの利用を禁じている）  
> 目的: **ai-note-meet / nexloom-gce の既存スタックを変更せず**、Rise Path を DB〜Hermes まで一式で再現・運用する。

---

## 1. 背景と方針

### 1.1 なぜ専用 VM か

| 懸念 | `nexloom-gce` 同居 | `risepath-vm` 専用 |
|------|-------------------|-------------------|
| ai-note-meet / auto-grants / coral-shop への影響 | 設定・プロセスが混在しうる | **触らない** |
| 既存 `gemini5` Hermes gateway | 別プロジェクト MCP が多数 | Rise Path 専用 Hermes のみ |
| DB | `risepath` DB は論理分離済みだが同一ホスト | **Postgres も専用** |
| 障害切り分け | 他サービスと巻き添え | VM 単位で独立 |
| 再現性 | 手動 bootstrap 依存 | **`docker compose up` で一式** |

**結論:** 本番・ステージングの正本は **`risepath-vm` 上の Docker スタック**。  
`nexloom-gce` 上の `risepath` DB は **移行期間の暫定**（既にデータがある場合は `pg_dump` → 新 VM へ）。

### 1.2 学習者（エンドユーザー）との関係

- **VM / Hermes インスタンス** = Rise Path **プロダクト 1 つ分**（マルチテナント）
- **学習者ごとに VM や Hermes は作らない**
- ユーザー枠は Supabase JWT → Express がチャット 1 ターンごとに発行する `rp_turn`（`agent_session_binding` の `rp:turn:<token>`）→ MCP / DB の `user_id` スコープで分離（[`hermes/README.md`](../../hermes/README.md)「MCP の学習者スコープ」）

### 1.3 VM 外に置くもの

| コンポーネント | 配置 | 理由 |
|----------------|------|------|
| **Supabase Auth** | SaaS | 認証のみ。データ DB は VM |
| **フロント（Vite ビルド）** | Vercel（`https://app.<domain>`） | 静的配信。`/api/*` などは `vercel.json` の routes が VM へ転送する |
| **公開エッジ** | Cloudflare（DNS + Tunnel） | API は Cloudflare Tunnel 経由の `https://api.<domain>` だけで公開する。インターネット向けの受信ポートは開けない |
| **GCS** | GCP | 大きいファイル（計画） |

---

## 2. 目標アーキテクチャ

```text
[Browser]
   │ Supabase Auth (JWT)。API は同一オリジンの /api/v2 だけを呼ぶ
   ▼
[Vercel app.<domain>]  静的フロント + vercel.json routes
   │ /api/*・/audio/cache/*・/generated/img_* を転送し、x-origin-secret を付ける
   ▼
[Cloudflare api.<domain>]
   │ Cloudflare Tunnel（VM から外向きに張る接続。インターネット向けの受信ポートは要らない）
   ▼
[risepath-vm]  cloudflared（profile tunnel、edge ネットワーク）──► api:3006
                                         │
                    ┌────────────────────┴────────────────────┐
                    │  docker compose (Rise Path stack)         │
                    │  ┌─────────┐  ┌─────┐  ┌─────┐  ┌──────┐ │
                    │  │   db    │  │ api │  │ mcp │  │hermes│ │
                    │  │Postgres │  │:3006│  │:3100│  │:8642 │ │
                    │  │risepath │  └──┬──┘  └──┬──┘  └──┬───┘ │
                    │  └────▲────┘     │        │        │    │
                    │       └──────────┴────────┴────────┘    │
                    └───────────────────────────────────────────┘

[Mac / Tailscale]  ACL（手順書 3.4）で開けるのは、名前を決めた管理者への 3006（api）と 3100（mcp）だけ。
                   5432（db）・8642（hermes）・8880（kokoro）はだれにも開けない（D8）。
                   3006（api）は ORIGIN_SECRET の設定後、x-origin-secret が要る

[nexloom-gce]  … 変更しない（ai-note-meet, auto-grants, gemini5 Hermes 等）
```

`api` の最初のミドルウェアは origin gate（`server/middleware/originGate.js`）。`stack.env` に `ORIGIN_SECRET` があると、`api` コンテナ内の loopback 以外から来て正しい `x-origin-secret` を持たないリクエストに 403 を返す。通ったリクエストは edge 扱いで、Bridge Token は使えず、edge のパスにしか届かない。`ORIGIN_SECRET` が空なら gate は動かない。

### 2.1 Compose サービス（目標）

| サービス | イメージ / ビルド | ポート | 責務 |
|----------|-------------------|--------|------|
| `db` | `pgvector/pgvector:0.8.7-pg16`（Postgres 16 + pgvector。タグ + digest 固定） | 5432（内部） | `risepath` データ、DB ロール **`risepath_app`** |
| `api` | リポジトリ `Dockerfile` | 3006 | Express `server.js`（フロントは含まない。Vercel が配信する） |
| `mcp` | 同上 | 3100 | MCP SSE（本番は stdio 非推奨） |
| `hermes` | Hermes 公式 or カスタム（profile `full`。既定では起動しない） | 8642 | `rise-path` プロファイル、API Server。学習者には提供しない（自分で運用するときや開発のときだけ） |
| `cloudflared` | `cloudflare/cloudflared`（タグ + digest 固定、profile `tunnel`） | なし | `api.<domain>` → `http://api:3006`。TLS は Cloudflare で終端。`tunnel.env` だけを読む |

Postgres ロールは **`risepath_app`** に統一（`deploy/risepath-vm/stack.env.example` の `POSTGRES_USER`、Mac `.env.local`、レガシー bootstrap SQL と一致）。

`db` は pgvector 入りのイメージ。新しい空の `pgdata` ボリュームでは migration 000 が `vector` 拡張を作り、`material_chunks.embedding` は `vector(768)`（HNSW インデックス付き）になる。RAG のベクトル検索が使える（ただし埋め込みには Gemini が要る。`GEMINI_ALLOWED` を設定しない既定では、教材はキーワード検索で探す）。これは空のボリュームから始めたときだけで、pgvector の無いイメージで作ったボリュームはイメージを替えても `FLOAT8[]` のまま（RAG はキーワード検索。[`server/migrations/README.md`](../../server/migrations/README.md)）。

migration は **新しい `api` イメージを起動する前に** 流す（`deploy-stack.sh` はこの順。§4.2。Memanto overlay を使うときは §7.2 の `-f` も付ける）:

```bash
docker compose --env-file stack.env build
docker compose --env-file stack.env up -d --wait db
docker compose --env-file stack.env run --rm --no-deps api npm run db:migrate
docker compose --env-file stack.env up -d
```

migration（018 をふくむ）は、`api` と `mcp` を起動する前に流す（上の順のとおり）。

`/api/v2/health` は未適用の migration が 1 つでもあると 503 を返し、`api` の healthcheck はこれを見る。`mcp` は `api` の healthy を、`hermes`（有効にしたときだけ）は `mcp` を待つ。新しい migration を含むイメージを先に起動すると、`up` が unhealthy で止まり、`mcp` と `hermes` が更新されない。

前の失敗で unhealthy な `api` が残っていると、設定もイメージも同じなので `up -d` はそれを作り直さず、`mcp` の依存待ちですぐ止まる。そのときは migrate のあと `docker compose --env-file stack.env up -d --no-deps --force-recreate --wait api` を挟んでから `up -d` する（`deploy-stack.sh` は毎回挟む）。

### 2.2 リポジトリ内の予定ファイル

| パス | 内容 |
|------|------|
| `deploy/risepath-vm/docker-compose.yml` | VM スタック（**db + api + mcp** + `kokoro-tts`（profile `tts`）・`hermes`（profile `full`。既定では起動しない）。`cloudflared` は profile `tunnel`） |
| `deploy/risepath-vm/scripts/provision-gce.sh` | GCP VM（24 時間稼働。`NIGHT_STOP=1` のときだけ 09:00–23:00 JST スケジュール） |
| `deploy/risepath-vm/stack.env.example` | 変数名テンプレ（秘密なし） |
| `deploy/risepath-vm/tunnel.env.example` | Cloudflare Tunnel の `TUNNEL_TOKEN` テンプレ（`tunnel.env` は Git 管理外） |
| `deploy/risepath-vm/hermes/config.yaml` | Hermes を有効にしたときのプロファイル（SSE MCP + allowlist） |
| `deploy/risepath-vm/scripts/deploy-stack.sh` | 再デプロイ（pull → `stack.env` と tunnel のガード → build → migrate → up → healthy を待つ → `api` コンテナ内で smoke） |
| `docker-compose.yml`（ルート） | **ローカル開発用**（`db` + **`app`** のみ。本番 Compose はサービス名 `api`） |
| `hermes/config.example.yaml` | Hermes `rise-path` プロファイルテンプレ |

---

## 3. Hermes の分離

**この節は、Hermes を有効にしたとき（`COMPOSE_PROFILES` に `full`）だけの話。** 共有の Hermes は学習者に提供しない（既定は `tts`、Vercel の `VITE_FEATURE_AGENT_CHAT` は未設定）。Hermes を使う学習者は、Phase 1 ができてから、自分の Hermes を MCP でつなぐ（[`hermes/README.md`](../../hermes/README.md)）。

### 3.1 使わないもの

- `nexloom-gce` 上の `gemini5` Hermes（coral-shop, auto-grants, prospect 等の MCP）
- 開発者個人の `~/.hermes/profiles/default`（Rise Path 本番・ステージングでは使用しない）

### 3.2 Rise Path 専用 Hermes

- プロファイル名: **`rise-path`**
- 設定正本: リポジトリ `hermes/config.example.yaml` → VM では `deploy/risepath-vm/hermes/config.yaml`
- MCP: **`rise_path` のみ**（`tools.include` allowlist）
- Skills: リポジトリ `skills/` のみ
- API Server: `:8642`（Compose 内では `http://hermes:8642`）

Express（`api` サービス）の環境変数:

```env
HERMES_API_URL=http://hermes:8642
HERMES_API_KEY=<openssl rand -hex 32。16 文字以上>
```

Hermes 側の `API_SERVER_KEY` は、Compose と `init-hermes-profile.sh` が `HERMES_API_KEY` から写す。`stack.env` に別の値を置かない。

### 3.3 本番 MCP トランスポート

| 環境 | MCP | Hermes 接続 |
|------|-----|-------------|
| Mac ローカル開発 | stdio（Hermes が子プロセス起動） | `hermes -p rise-path gateway` |
| `risepath-vm` 本番 | **SSE**（`mcp` サービス） | `url: http://mcp:3100/sse` + Bearer |

**Hermes → MCP（Compose 内）:** Hermes の `config.yaml` で SSE URL を使い、`Authorization: Bearer ${RISE_PATH_BRIDGE_TOKEN}` を付与（`stack.env` の `RISE_PATH_BRIDGE_TOKEN` と同値）。MCP は Bridge Token を検証する。Express 経由のユーザーチャットでは、Express がターンごとに `registerAgentTurn(userId)` でランダムなトークンを発行して `agent_session_binding` に書き込み（失敗したら Hermes を呼ばずに 503）、Hermes には `instructions` で渡す（ヘッダー `X-Hermes-Session-Key` は学習者ごとに固定の `rp:user:{uuid}` で、Hermes 自身の状態の単位。MCP はこれを無視する）。Hermes は各ツール呼び出しの引数 `rp_turn` にそれを付け、MCP はその学習者として実行する。クライアントが送る `X-Hermes-Session-Key: rp:user:{uuid}` は無視される。`rp_turn` のない Bridge Token の呼び出しは strict auth（本番、`RISEPATH_STRICT_AUTH=true`、`VITE_DEMO_MODE=false`）では `session_binding_required`（直近 15 分にチャット中の学習者が 1 人だけならその学習者、という暫定フォールバックは strict auth でない開発環境だけ）。エンドユーザー JWT を MCP に直接渡す経路は外部クライアント（ChatGPT 等）向けで、その JWT の学習者として動く。

stdio は本番では **非推奨**（[`architecture_v3_hermes_agent.md`](../archive/architecture_v3_hermes_agent.md) §3.2）。

---

## 4. セットアップ手順（目標）

### 4.1 VM プロビジョニング（24 時間稼働）

**推奨スペック:** `e2-medium`（2 vCPU / 4 GB）+ 50 GB `pd-balanced` + Ubuntu 24.04 + `asia-northeast1`（`provision-gce.sh` の既定）

**マシンタイプ:**

- 基本のスタック（Memanto なし）は `e2-medium` でよい。`api` イメージはもうフロントをビルドしない（Vercel がビルドする）。`bootstrap-vm.sh` が 4 GB の swap ファイルを作る。
- Memanto を使うなら `e2-standard-2`（2 vCPU / 8 GB）。Ollama・moorcheh・memanto が増え、4 GB では余裕がない。
- メモリの見込み（基本のスタックで 2.3–3.2 GB ほど、Ollama で 0.9–1.4 GB ほど増える）は推定で、VM での実測ではない。

**稼働:** 公開 API が VM に載るので、既定は 24 時間稼働。開発期の夜間停止（09:00 起動 / 23:00 停止、Asia/Tokyo）は既定ではなくなった。戻すときだけ `NIGHT_STOP=1 ./provision-gce.sh`。

**月額（推定。未確認）:** 24 時間稼働の `asia-northeast1` で、`e2-medium` は約 $0.043/時（約 $31/月）、`e2-standard-2` は約 $0.086/時（約 $63/月）。50 GB のディスクは別。どれも第三者のサイト（[gcloud-compute.com](https://gcloud-compute.com/e2-medium.html)）の値で、Google の料金ページでは確かめていない。予算アラートを決める前に、[GCP の料金計算ツール](https://cloud.google.com/products/calculator)で確かめる。

```bash
export GCP_PROJECT=your-project-id
cd deploy/risepath-vm/scripts
./provision-gce.sh                                   # 既定: e2-medium
# Memanto を使うとき: MACHINE_TYPE=e2-standard-2 ./provision-gce.sh
```

手動の場合:

1. GCP で VM 作成（`risepath-vm`）
2. インスタンススケジュールは付けない（夜間停止が要るときだけ `NIGHT_STOP=1` でスクリプトを使う）
3. Tailscale に参加（`--hostname=risepath-vm --advertise-tags=tag:risepath`。タグは手順書 3.4 の ACL のもの。旧 `risepath-vm` が管理画面に残っていれば先に Remove する。残っていると新しい VM は `risepath-vm-1` になる）
4. `scripts/bootstrap-vm.sh` で Docker + compose + 4 GB の swap + 初回デプロイ + systemd（起動ユニットは初回デプロイが通ってから登録する）
5. ファイアウォール: アプリ用の受信ルールは作らない。**5432/3006/3100/8642/8880 を 0.0.0.0/0 に開放しない**。Cloudflare Tunnel 用に外向きの TCP/UDP 7844 を許可したままにする

#### Mac から接続

`deploy/risepath-vm/docker-compose.yml` は `5432` / `3006` / `3100` / `8642` / `8880` を VM 内で公開する（ポートの公開は変えていない）。Tailscale の `100.x` 経由で使うのは、名前を決めた管理者が流す `npm run smoke:vm`（3006、3100）だけにする。5432（DB）は、Tailscale の ACL でもだれにも開けない（D8。本番の DB には VM の中からだけ触る。手順書 3.4・18 章）。**GCP VPC ファイアウォールでインターネット向けに開けないこと。**

`stack.env` に `ORIGIN_SECRET` を設定したあとは、api（3006）だけ `x-origin-secret` ヘッダーが要る。付けた呼び出しは edge 扱いなので、Bridge Token は使えず、edge のパス（`/api/*` など）にしか届かない。mcp は今までどおり。

MCP（3100）は Tailscale の中だけで使う。ngrok などのトンネルやファイアウォールの開放でインターネットに出さず、`RISE_PATH_BRIDGE_TOKEN` を ChatGPT などの外部サービスに入れない。ChatGPT・Claude.ai などのリモート接続は、学習者ごとのログイン（OAuth）を用意してから提供する。

**Hermes（有効にしたときだけ）:** VM の `hermes` サービス（profile `full`）を使う。最初の公開では使わない（D3）ので、Mac から VM の Hermes（8642）にはつながない。VM なしで試すときだけ、Mac で `hermes -p rise-path gateway` を動かす。既定の `tts` では `hermes` は起動しない。

### 4.2 初回デプロイ・再デプロイ

新しい VM の初回は [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) のクイックスタートで行う（`bootstrap-vm.sh` を 2 回。1 回目のあとに SSH し直す。`stack.env` に入れる値の表もそこにある）。手作業でやるときの要点:

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/risepath   # /opt は root 所有
git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git /opt/risepath
cd /opt/risepath/deploy/risepath-vm
cp stack.env.example stack.env   # 実値を入れる。deploy/risepath-vm/.gitignore で除外済み
chmod 600 stack.env
./scripts/deploy-stack.sh        # pull → stack.env の検査 → build → db 起動 → db:migrate → api 作り直し → up -d → healthy を待つ → smoke
docker compose --env-file stack.env run --rm --no-deps api npm run db:migrate:status   # 未適用が 0 件なら正しい
```

- `POSTGRES_PASSWORD` は DB の最初の起動で固定される。あとで `stack.env` を変えても DB 側は変わらないので、最初の `deploy-stack.sh` の前に決める（`openssl rand -hex 24`。`DATABASE_URL_PHASE1` にも同じ値）。
- `deploy-stack.sh` は、DB・Supabase・Bridge Token の値が空かテンプレの値のままだと、変数名だけを表示して build の前に止まる。既定の `COMPOSE_PROFILES=tts` は `hermes` を起動せず、kokoro は動く。`full` を入れたとき（Hermes を有効にしたときだけ）は、`OPENROUTER_API_KEY` と 16 文字以上の `HERMES_API_KEY` も確かめる。`OPENROUTER_API_KEY` を入れただけでは Hermes は起動しない。
- `ANTHROPIC_API_KEY` を入れる（チューター・文章フィードバック・コース生成）。`GEMINI_API_KEY` と `GEMINI_ALLOWED` は空のまま。Gemini が無いあいだ、教材の検索はキーワード検索で動き、AI の画像生成は止まる。
- `bootstrap-vm.sh` は、VM 起動時の systemd ユニットを、初回デプロイが通ってから登録する。テンプレの値のまま再起動しても、db は起動しない。
- 再デプロイは `./scripts/deploy-stack.sh` だけ。毎回 pull し、HEAD が進めば pull したあとの自分自身を 1 回だけ実行し直す。CI は同じ `deploy-stack.sh` を `RISEPATH_DEPLOY_SKIP_PULL=1` で流す（取り出したコミットのまま。VM では使わない）。

**main へのマージで、フロントとレッスンは Vercel の Production デプロイ（Git 連携）で届く**（[`deploy/vercel/README.md`](../../deploy/vercel/README.md)）。VM は `deploy-stack.sh` を流すまで変わらない。`deploy-stack.sh` が作り直すのは `api` と `mcp` のイメージで、MCP の `lesson-get` が読む `content/` は `mcp` イメージに焼き込まれる。新しい migration（例: Learning Hub のカードの seed）も `deploy-stack.sh` で入る。

#### migration の確認（適用前）

- `deploy-stack.sh` の前に `db:migrate:status`（適用はしない）で未適用を確認する。確認は VM でだけする（Mac の `.env.local` は本番の DB を使わない。手順書 18 章）。VM では `git pull --ff-only` と `docker compose --env-file stack.env build api` のあと `docker compose --env-file stack.env run --rm --no-deps api npm run db:migrate:status`。
- `db:migrate` は未適用をまとめて順に流す。新しい VM（空の DB）では、初回の `deploy-stack.sh` が `server/migrations/` のすべて（2026-10-30 時点で 000–022）を一度に流す。そのあとの `db:migrate:status` は、すべて適用済み（未適用 0 件）になる。
- **018（Phase 4、アカウントの削除）**: ログインした呼び出しのたびに `account_deletions` を読むので、この版の `api`・`mcp`・`mcp-public` を起動する前に適用が要る。`deploy-stack.sh` は migrate のあとに作り直すので、この順になる。手で動かすとき（§4.4）や手元の開発の DB（`npm run db:migrate`）でも、先に流す。未適用のままだと、ログインした呼び出しはアプリと SSE の MCP で 503 `auth_unavailable`、リモート MCP で 503 になる（安全な側）。`byoa` を使っているなら、適用のあとに `sql/mcp_remote_role.sql` を流し直す（[`doc/guides/byoa-setup.ja.md`](./byoa-setup.ja.md) の手順 7）。
- **019（Phase 5、レッスンのやり直しと XP）**: この版の `api`・`mcp`・`mcp-public` を起動する前に適用が要る（`deploy-stack.sh` は migrate のあとに作り直すので、この順になる）。`sql/mcp_remote_role.sql` は流し直さなくてよい。019 を当てるあいだは、アカウントの削除をしない（スタッフの `--yes`。画面からの削除を使えるようにしているなら、人の少ない時間に）。重なると、デッドロック（40P01）でどちらかが何も変えずに戻るので、もう一度実行する。くわしくは [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「保存の様子・レッスンのやり直し・XP」。
- **020（Phase 6、復習）**: この版の `api`・`mcp`・`mcp-public` を起動する前に適用が要る（`deploy-stack.sh` は migrate のあとに作り直すので、この順になる）。019 と違い、`byoa` を使っているなら、適用のあとに `sql/mcp_remote_role.sql` を流し直す（流すまで、AI アプリの復習のツールは使えない。[`doc/guides/byoa-setup.ja.md`](./byoa-setup.ja.md) の手順 7）。020 は終わるまで `auth.users` をロックするので、ログインした呼び出しは 020 が終わるまで待つ（`lesson_progress` を使う開いたままのトランザクションがあると、020 はそれも待つ）。人の少ない時間に当てる。アカウントの削除が重なってもデッドロックにはならないが、削除は 020 を待ち、10 秒を超えると `account_busy` で終わるので、削除をやり直す。**前の版のイメージに戻したあと、この版に戻すとき**は、この版の `api`・`mcp`・`mcp-public` を起動する前に、データベースの所有者で確認と削除の SQL（[`scripts/db/verify-phase6.mjs`](../../scripts/db/verify-phase6.mjs) の `ROLL_FORWARD`）を流す（前の版のサービスを止めてから）。前の版のレッスンのやり直しと「学習の進み具合を消す」は、復習のカードを消さないため。くわしくは [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「復習（Phase 6）」。
- **021（職業訓練の期と割り当て）**: この版の `api`・`mcp`・`mcp-public` を起動する前に適用が要る（未適用のままだと、アカウントの削除が 42P01 で取り消され、`deletion_unavailable` になる）。新しい表を 2 つ作るだけなので `auth.users` はロックせず、ログインした呼び出しもアカウントの削除も待たない。`sql/mcp_remote_role.sql` は流し直さなくてよい（AI アプリのロールは新しい表を読めない）。訓練の API は `TRAINING_ENABLED=true` のデプロイ（学校）だけで答え、公開版では表は空のままになる（[`doc/brushup-2026/training-plan.ja.md`](../brushup-2026/training-plan.ja.md)、職員のスクリプトは [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「職業訓練（骨組み）」）。
- **022（職業訓練の受講時間）**: この版の `api`・`mcp`・`mcp-public` を起動する前に適用が要る（未適用のままだと、アカウントの削除が 42P01 で取り消され、`deletion_unavailable` になる）。新しい表を 7 つ作るだけなので `auth.users` はロックせず、ログインした呼び出しもアカウントの削除も待たない。`sql/mcp_remote_role.sql` は流し直さなくてよい（AI アプリのロールは新しい表を読めない）。規則の値と単元表はリポジトリになく、学校の職員が `scripts/training-time.mjs` で読み込むまで、受講時間は数えない（公開版では表は空のままになる。手順は [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「職業訓練（骨組み）」）。
- **Phase 4 の最初のデプロイ**では、すべてのサービスにログの上限（`x-logging`）が付くので、動いているコンテナがすべて一度作り直される。`db` は「db up」のときに数秒止まり（そのあいだ古い `api` は 503）、そのあと `api`、最後の `up -d` で cloudflared（トンネルが少し止まる）、kokoro（モデルを読み直す）、`mcp`、`mcp-public`、`hermes` と Memanto（有効なら）。くわしくは [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「アカウントの削除・保存期間・ログ」。
- 010 は `material_chunks` に `CONCURRENTLY` なしでインデックスを作る。作成中はこのテーブルへの書き込みが待たされる（新しい DB では空なので、すぐ終わる）。

### 4.3 Mac 開発者の `.env.local`（開発用の DB）

試験運用から先は、Mac の `.env.local` は本番の DB（VM の `db`）を使わない（D8）。開発は、Mac の中だけで動く開発用の DB を使う。作り方は [手順書の 18 章](./first-launch.ja.md)（`docker run … -p 127.0.0.1:5433:5432 …` と `DATABASE_URL_PHASE1=postgresql://risepath_app:<開発用>@127.0.0.1:5433/risepath?sslmode=disable`）。本番の DB の調べものとスタッフによる削除は、VM の中（SSH）でだけする。Tailscale の ACL でも、5432 はだれにも開けない（手順書 3.4）。

Mac の `~/.ssh/known_hosts` に残った旧 VM の鍵は `ssh-keygen -R risepath-vm` で消す（残っていると `scripts/setup-vm-ssh.sh`・`scripts/deploy-from-mac.sh` の ssh が止まる）。

フロントは引き続き `npm run dev`（:3007）で、API はローカル（:3006）。VM の API を Tailscale 経由で確かめられるのは、`stack.env` に `ORIGIN_SECRET` が無いあいだだけ（§4.1「Mac から接続」。`npm run smoke:vm` は `.env.local` を読まない）。

### 4.4 ローカル Docker のみ（VM なしで試す場合）

```bash
cd rise-path-demo-game-integration/deploy/risepath-vm
cp stack.env.example stack.env   # Git 管理外。リポジトリ直下の .env.stack などには置かない
chmod 600 stack.env
docker compose --env-file stack.env build
docker compose --env-file stack.env up -d --wait db
docker compose --env-file stack.env run --rm --no-deps api npm run db:migrate
docker compose --env-file stack.env up -d
```

ルートの `docker-compose.yml` は簡易版（`db` + **`app`**）。migration は `docker compose exec app npm run db:migrate`。フルスタックは `deploy/risepath-vm/`（サービス名 `api`）が正本。

### 4.5 VM を作り直す（2026-10-21 に削除済み）

新しい VM から公開までの順番は [手順書](./first-launch.ja.md) の 4〜6 章（VM、設定のファイルと事前チェック、最初のデプロイと控え）にある。この節は、その要点だけを書く。2026-10-21 に、オーナーが GCP の `risepath-vm` を削除した。新しい VM を作り、DB は空から始まる（Supabase のアカウントは残る。進捗・ジャーナルなど旧 VM の DB にあったデータは無い）。VM 側の要点:

**最初のデプロイの前に**: デプロイする main のコミットで、GitHub Actions の「End-to-end checks」の 3 つのチェック（`Database checks`・`Server stack deploy`・`Learner end-to-end`）と毎晩の実行が緑であることを確かめる（[ai-access-plan.ja.md](../brushup-2026/ai-access-plan.ja.md) の 11 章）。毎晩の実行を待たないときは、Actions の画面の「End-to-end checks」で **Run workflow**（`main`）を押して動かせる（計画の 11.2 の 3）。緑なら、空の DB への 000–022、`deploy-stack.sh` の流れ（検査・build・migration・api の作り直し・スモーク）、DB ロールの SQL、ブラウザでの学習の流れは、ダミーの値で確かめてある。確かめていないもの: 本物の Supabase（ログインと Site URL）、公開のときの設定（`ORIGIN_SECRET` と `TRUST_PROXY=1` での origin gate）、`mcp-public`、2 回目のデプロイと起動のユニット、`ANTHROPIC_API_KEY`、`POSTGRES_PASSWORD` を最初に決めること、Tailscale、Cloudflare Tunnel（cloudflared とトークン）、kokoro-tts・Hermes・Memanto、アップロードの保存、`deploy-stack.sh` の git pull と、HEAD が動いたときのやり直し（CI は飛ばす）。VM の Docker の版と `stack.env` は、下の 3 で、`bootstrap-vm.sh` の 2 回目の前に見る。`RISEPATH_DEPLOY_SKIP_PULL` は VM では使わない。

1. 前の VM の残りを片付ける。夜間停止のスケジュールが残っていれば消す（どの VM にも付いていなければ消せる）。Tailscale の管理画面（Machines）で旧 `risepath-vm` を Remove する。Mac では `ssh-keygen -R risepath-vm`。

   ```bash
   export GCP_PROJECT=your-project-id
   gcloud compute resource-policies describe risepath-dev-schedule --project="$GCP_PROJECT" --region=asia-northeast1   # 無ければ not found
   gcloud compute resource-policies delete risepath-dev-schedule --project="$GCP_PROJECT" --region=asia-northeast1
   ```

2. `provision-gce.sh` で作る（§4.1。Memanto を使うなら `MACHINE_TYPE=e2-standard-2`）。
3. [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) のクイックスタートで、Tailscale → `/opt/risepath` の作成 → clone → `bootstrap-vm.sh`（1 回目）→ SSH し直す → `stack.env` を埋める → **2 回目の前に**、VM の `docker version` と `docker compose version` を `Server stack deploy` の「Preflight」の行とくらべ（メジャーがちがえば、デプロイの前にエージェントと相談する。計画の 11.3 の 2）、`stack.env` の `SUPABASE_URL` が `https://<project>.supabase.co` であることを見る（事前チェックも確かめる。手順書 5.3）→ `bootstrap-vm.sh`（2 回目）。`SUPABASE_URL` は CI だけの `http://auth-stand-in:…` にしない。`stack.env` は `COMPOSE_PROFILES=tts`（Memanto を使うなら `tts,memory`）のまま、`GEMINI_API_KEY` と `GEMINI_ALLOWED` は空のまま、公開エッジの値はトンネルを作ってから入れる。2 回目の `deploy-stack.sh` が、事前チェックのあと migration をすべて（000–022）まとめて流す。
4. Mac の `.env.local` は本番の DB を使わない（§4.3、手順書 18 章）。`ORIGIN_SECRET` を入れる前に、Mac から Tailscale 経由で `npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100` を流す（引数なしだと Mac の 127.0.0.1 を見る。手順書 6.3）。
5. 初回サインインのあと、自分の `user_profiles.role` を `admin` にする（[`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「[管理者にする](../../deploy/risepath-vm/README.md#5-管理者にする初回サインインのあと)」）。

新しく clone した VM の `deploy-stack.sh` は最新版なので、pull を先にする必要はない。

公開エッジを有効にするときは、その前に `tunnel.env`（`TUNNEL_TOKEN`）と `stack.env` の `ORIGIN_SECRET`・`TRUST_PROXY=1`・`LLM_ALLOWED_ORIGINS=https://app.<domain>`・`COMPOSE_PROFILES=tts,tunnel`（Hermes を有効にするときだけ `full,tunnel`）を入れる（[`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「Cloudflare Tunnel」）。`tunnel` プロファイルで値が足りないと、`deploy-stack.sh` は足りない変数名だけを表示して止まる。

---

## 5. `nexloom-gce` からの移行

既に `nexloom-gce` / `risepath` にデータがある場合だけ。**空の DB で始めるなら、この節は要らない。**

復元は、新しい VM の初回の `db:migrate` より前に、空の DB へ流す。`deploy-stack.sh`（`bootstrap-vm.sh` の 2 回目）は migrate でテーブルと seed の行を作るので、そのあとに復元すると、既存のテーブルや行とぶつかる。

```bash
# 旧（暫定）
pg_dump -h nexloom-gce -U risepath_app -d risepath -Fc -f risepath.dump

# 新 VM: SSH し直して stack.env を埋めたあと、bootstrap-vm.sh の 2 回目より前に、db だけ起動する（VM 上。POSTGRES_PASSWORD はここで固定される）
cd /opt/risepath/deploy/risepath-vm
docker compose --env-file stack.env up -d --wait db

# ダンプを VM のホームに移し（Mac で gcloud compute scp risepath.dump risepath-vm:risepath.dump --zone=asia-northeast1-b）、
# VM の中で戻す（Mac から本番の DB にはつながない）。終わったら bootstrap-vm.sh の 2 回目で、残りの migration が流れる
docker compose --env-file stack.env exec -T db pg_restore -U risepath_app -d risepath --no-owner < ~/risepath.dump
rm ~/risepath.dump

# Mac: 戻した DB の行の数が旧 DB と同じことを確かめたら（手順書 5.4）、Mac の写しも消す。
# 学習者のデータなので、Mac にも、ほかの場所にも残さない（写さない）
rm risepath.dump
```

旧 DB に pgvector が無ければ、復元した `material_chunks.embedding` は `FLOAT8[]` のままで、RAG はキーワード検索で動く。

切替手順:

1. 新 VM を確かめる: VM で `./scripts/postdeploy-check.sh`、Mac から Tailscale 経由で `npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100`（手順書 6.2・6.3）。ブラウザでの確かめは手順書 9.2（`npm run env:check -- --api` は Mac の localhost:3006 を見るので、VM の確かめにはならない）
2. 本番の `DATABASE_URL_PHASE1` は VM の `stack.env` だけにある（`db:5432`）。開発の `.env.local` は、本番に向けない（手順書 18 章）
3. 旧 DB は読み取り専用にし、問題なければ退役

**nexloom-gce 上の Postgres プロセスや ai-note-meet には手を入れない。**

---

## 6. セキュリティチェックリスト

- [ ] `stack.env` / `.env.local` が Git に無い
- [ ] `stack.env` にテンプレの値（`change-me` など）が残っていない。`POSTGRES_PASSWORD`・`HERMES_API_KEY`・`RISE_PATH_BRIDGE_TOKEN` は `openssl rand -hex …` で作った値
- [ ] `COMPOSE_PROFILES` に `full` が無い（共有の Hermes は学習者に提供しない）。Vercel に `VITE_FEATURE_AGENT_CHAT` が無い
- [ ] `GEMINI_ALLOWED` を設定していない（Gemini の API 規約の 18 歳未満の条項）
- [ ] MCP（3100）をインターネットに公開していない（ngrok なども使わない）。`RISE_PATH_BRIDGE_TOKEN` を外部サービスに入れていない
- [ ] Hermes を有効にしたときだけ: `tools.include` が Rise Path allowlist のみ
- [ ] Hermes を有効にしたときだけ: `daily-life-range` / `daily-life-log` を Hermes 本番 allowlist に含めない
- [ ] Hermes を有効にしたときだけ: `HERMES_API_KEY` は Express のみ（ブラウザに露出しない）
- [ ] MCP SSE は本番で Bridge Token または Supabase JWT 必須（`NODE_ENV=production` で匿名不可）
- [ ] Hermes を有効にしたときだけ: `RISE_PATH_BRIDGE_TOKEN` を `mcp` と Hermes `config.yaml` で同値に揃える
- [ ] Tailscale ACL で `risepath-vm` へのアクセスを限定
- [ ] `ORIGIN_SECRET` は `stack.env` と Vercel Production env の 2 か所だけ（`VITE_` 変数にしない）
- [ ] `tunnel.env` は `chmod 600` で Git に無い。`TUNNEL_TOKEN` を読むのは `cloudflared` だけ
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' https://api.<domain>/api/v2/health` が `403`
- [ ] GCP ファイアウォールにアプリ用の受信ルールが無い（公開は Cloudflare Tunnel の外向き接続だけ）

---

## 7. Phase 19: 学習者 Memanto overlay（risepath-vm 専用）

開発者個人用 Memanto（nexloom-gce / `2005nk-work`）とは **別 volume・別 secret**。仕様: [`phase19_learner_semantic_memory_spec.md`](../phases/phase19_learner_semantic_memory_spec.md)

### 7.1 有効化

マシンタイプは `e2-standard-2`（8 GB）以上にする（§4.1）。作成済みの VM は止めてから変える: `gcloud compute instances stop risepath-vm --zone=asia-northeast1-b`、`gcloud compute instances set-machine-type risepath-vm --zone=asia-northeast1-b --machine-type=e2-standard-2`、`gcloud compute instances start risepath-vm --zone=asia-northeast1-b`（`provision-gce.sh` は既存の VM を変えない）。`stack.env` に実 secret を設定:

```env
MEMANTO_SECRET_KEY=<openssl rand -hex 32>
MEMANTO_ENABLED=true
COMPOSE_PROFILES=tts,memory
# Hermes を有効にするときだけ full,memory
```

`MEMANTO_ENABLED=true` は `stack.env` に必ず書く。VM 起動時の systemd ユニットはこの値を読む。秘密を入れて `false` のままだと、`deploy-stack.sh` が止まる。

### 7.2 起動

```bash
cd /opt/risepath/deploy/risepath-vm
./scripts/deploy-stack.sh
# または手動（§2.1 と同じ順。migrate は新しい api の起動前。Hermes を有効にしたときは --profile tts を --profile full に）:
docker compose -f docker-compose.yml -f docker-compose.memanto.yml \
  --env-file stack.env --profile tts --profile memory build
docker compose -f docker-compose.yml -f docker-compose.memanto.yml \
  --env-file stack.env --profile tts --profile memory up -d --wait db
docker compose -f docker-compose.yml -f docker-compose.memanto.yml \
  --env-file stack.env --profile tts --profile memory run --rm --no-deps api npm run db:migrate
docker compose -f docker-compose.yml -f docker-compose.memanto.yml \
  --env-file stack.env --profile tts --profile memory up -d
./scripts/init-memanto-ollama.sh   # nomic-embed-text を pull
```

| サービス | 内部 URL | ホスト（VM ローカル） |
|----------|----------|----------------------|
| `ollama` | `http://ollama:11434` | — |
| `moorcheh` | `http://moorcheh:8080` | — |
| `memanto` | `http://memanto:8000` | `127.0.0.1:8100` |

`api` / `mcp` は `MEMANTO_API_URL=http://memanto:8000` で bridge（Phase 19-1 以降）に接続する。

### 7.3 スモーク

```bash
cd /opt/risepath/deploy/risepath-vm
# api コンテナ内から（loopback なので origin gate を通る。deploy-stack.sh も同じ）
docker compose --env-file stack.env -f docker-compose.yml -f docker-compose.memanto.yml \
  exec -T api node scripts/smoke-vm-stack.mjs --target container --require-mcp --require-memanto
```

VM のホストには Node が無いので、`--target host` は使わない。Mac からは §4.5 の `npm run smoke:vm -- --base …`（`ORIGIN_SECRET` を入れる前だけ）。

---

## 8. 実装ステータス

| 項目 | 状態 |
|------|------|
| アーキテクチャ方針（本ドキュメント） | ✅ 確定 |
| migration 000–022 + `db:migrate` | ✅ リポジトリは 022 まで（2026-10-30）。新しい VM（空の DB）では、初回の `deploy-stack.sh` が 000–022 を流す（§4.2） |
| Express agent proxy + Life Journal API | ✅ 完了 |
| `deploy/risepath-vm/docker-compose.yml` | ✅ db（pgvector）+ api + mcp + kokoro-tts + hermes（healthcheck 付き。hermes は profile `full` で、既定では起動しない） |
| Phase 19 Memanto overlay | ✅ compose + deploy-stack + smoke（bridge は 19-1） |
| provision スクリプト | ✅ `scripts/provision-gce.sh`（24 時間稼働が既定。夜間停止は `NIGHT_STOP=1`） |
| 公開エッジ（Vercel routes + Cloudflare Tunnel + origin gate） | 🔄 リポジトリ側は実装済み。SSE のバッファ、Authorization の転送、ボディ上限は初回デプロイで確認（[`deploy/vercel/README.md`](../../deploy/vercel/README.md) の確認チェックリスト） |
| `deploy-stack.sh` + `npm run smoke:vm` | ✅ 再デプロイ・検証導線（migrate は新しい api の起動前） |
| CI での予行（`.github/workflows/e2e.yml`、Phase 7） | 🔄 GitHub での実行は動いている。必須のチェックにするルールセットだけが残っている（[ai-access-plan.ja.md](../brushup-2026/ai-access-plan.ja.md) の 11.2、手順書 2.4）。プルリクエストのたびに、ダミーの値で `deploy-stack.sh` とブラウザの学習の流れ（`Server stack deploy`・`Learner end-to-end`）、VM と同じ DB のイメージで migration と DB ロールの SQL（`Database checks`）。最初のデプロイの前に緑を確かめる（§4.5） |
| Hermes 本番 `config.yaml`（SSE） | ✅ `deploy/risepath-vm/hermes/config.yaml` |
| Hermes コンテナイメージ | ✅ `nousresearch/hermes-agent:latest`（profile `full`）。Mac ローカル gateway も可。2026-10-22 から学習者には提供しない（既定 `tts`） |
| `risepath-vm` GCP 実機プロビジョニング | ⏸ 2026-10-21 に削除（オーナー）。作り直しは §4.5 と手順書（`provision-gce.sh` → `bootstrap-vm.sh`）。DB は空から始まる。DB は VM の中だけで使い、フル stack は `deploy-stack.sh` で更新 |

---

## 9. 関連ドキュメント

| ファイル | 内容 |
|----------|------|
| [`database_topology.md`](../system_design/database_topology.md) | Auth / DB / GCS の全体像 |
| [`architecture_v3_hermes_agent.md`](../archive/architecture_v3_hermes_agent.md) | Hermes + MCP + Skills |
| [`hermes/README.md`](../../hermes/README.md) | Hermes プロファイル手順 |
| [`env_local_setup_issue15.md`](./env_local_setup_issue15.md) | ローカル env |
| [`first-launch.ja.md`](./first-launch.ja.md) | 最初の公開の手順書（Phase 9。新しい VM から公開まで） |
| [`prod_readiness_plan.md`](./prod_readiness_plan.md) | 古い計画（2026-06。公開の手順ではない） |
| [`portable_deployment.md`](./portable_deployment.md) | 古い文書（GCS / 引っ越し。公開の手順ではない） |