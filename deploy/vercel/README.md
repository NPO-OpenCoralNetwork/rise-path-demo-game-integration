# Vercel フロントデプロイ（`app.<domain>`）

フロント（`npm run build:prod` の静的ビルド）を Vercel の `https://app.<domain>` に載せる。API は GCP の `risepath-vm` の Docker スタックに置き、Cloudflare Tunnel 経由の `https://api.<domain>` だけで公開する。ブラウザが呼ぶのは自分のオリジンの相対パス `/api/v2` だけなので、API 呼び出しに CORS は関わらない。

VM 側: [`deploy/risepath-vm/README.md`](../risepath-vm/README.md) / 正本: [`doc/guides/risepath_vm_deployment.md`](../../doc/guides/risepath_vm_deployment.md)

## リクエストの経路

```text
ブラウザ
  │ https://app.<domain>/api/v2/...（相対パス）
  ▼
Vercel（app.<domain>）   vercel.json の routes が転送し、x-origin-secret ヘッダーを付ける
  │ ${API_ORIGIN}/api/v2/...  = https://api.<domain>/api/v2/...
  ▼
Cloudflare（api.<domain>）
  │ Cloudflare Tunnel（VM から外向きに張る接続。インターネット向けの受信ポートは要らない）
  ▼
risepath-vm: cloudflared ──► api:3006（Express。最初に origin gate が動く）
```

- routes が転送するのは `/api/*`、`/audio/cache/<64 桁 hex>.mp3|.wav`（TTS キャッシュ）、`/generated/img_<64 桁 hex>.png|.jpg|.webp`（生成画像）だけ。メディアは、ビルドに同じ名前のファイルが無いときだけ転送する（コミット済みの `public/generated` の画像は Vercel がそのまま配信する）。`/uploads` と `.meta.json` は転送しない。
- それ以外のパスは SPA の `index.html` を返す。`/assets/` の古いチャンクは 404 になり、`components/common/chunkReload.ts` が再読み込みする。
- API の origin gate（`server/middleware/originGate.js`）は、VM の `stack.env` に `ORIGIN_SECRET` があるとき、`api` コンテナ内の loopback 以外から来て正しい `x-origin-secret` を持たないリクエストに 403 を返す。`https://api.<domain>` を直接開いても 403 になる。loopback でも、Cloudflare のヘッダー（`cf-ray`・`cf-connecting-ip`・`cdn-loop`）が付いたリクエストには合言葉が要る。
- `ORIGIN_SECRET` が空のときも、Cloudflare を通ってきたリクエストには 403 を返す。`COMPOSE_PROFILES` に `tunnel` があって `ORIGIN_SECRET` が空なら、API は起動しない（戻し方は VM README の「[Cloudflare Tunnel（公開エッジ）](../risepath-vm/README.md#cloudflare-tunnel公開エッジ)」にある、公開エッジを止める手順）。
- 正しい `x-origin-secret` を持って通ったリクエストは edge 扱い。Bridge Token は使えず、Supabase JWT が要る。
- Vercel 側に `ORIGIN_SECRET` が無いと、文字列 `$ORIGIN_SECRET` がそのまま送られ、API は 403 を返す（安全側に倒れる）。
- Tailscale から VM の `:3006` を呼ぶ場合も、`ORIGIN_SECRET` を設定したあとは `x-origin-secret` が要り、edge 扱いになる。db・mcp・kokoro（Hermes を有効にしたときは hermes も）への Tailscale 接続は今までどおり（[`deploy/risepath-vm/README.md`](../risepath-vm/README.md)）。

## Vercel 環境変数（Production のみ）

テンプレート: [`env.production.example`](./env.production.example)（値はダミー）

| 変数 | 値 | 備考 |
|------|-----|------|
| `API_ORIGIN` | `https://api.<domain>` | routes の転送先。サーバー側だけで使う。スキームとホストだけ（末尾の `/` やパスを付けない） |
| `ORIGIN_SECRET` | VM の `stack.env` と同じ値 | VM で `openssl rand -hex 32`。Sensitive を選べるなら選ぶ（選択肢があるかは未確認） |
| `VITE_SUPABASE_URL` | Supabase プロジェクト URL | 公開してよい値 |
| `VITE_SUPABASE_ANON_KEY` | anon key | service role key は入れない |
| `VITE_DEMO_MODE` | `false` | `build:prod` も demo を切る |
| `VITE_API_ENABLED` | `true` | |

- `VITE_API_BASE_URL` は**設定しない**。未設定ならクライアントは同一オリジンの `/api/v2` を使う（`services/apiClient.ts`）。旧手順の Tailscale 値（`http://risepath-vm:3006/api/v2`）が残っていたら削除する。
- `VITE_FEATURE_AGENT_CHAT` は**設定しない**。共有の Hermes エージェントとのチャット（画面に浮かぶ AI コーチと `/life-journal/chat`）は、この値がちょうど `true` のときだけ出る。共有の Hermes は学習者に提供しないので、既定のままにする（レッスンの中の AI チューターには関係しない）。
- `VITE_FEATURE_BILLING`（有料のサポータープランの画面。Phase 3）は、オーナーがテストの方と本番の経路を確かめるとき（[`doc/brushup-2026/ai-access-plan.ja.md`](../../doc/brushup-2026/ai-access-plan.ja.md) の 7.2 の 3）まで**設定しない**。ちょうど `true` のときだけ `/settings/plan` と申し込みの最終確認の画面を出し、入口は API が認めた学習者にだけ出る。変えたらデプロイし直す（ビルドのときに入るため）。Stripe の鍵は Vercel にも `VITE_` にも入れない（鍵は VM の `billing.env` だけ。ブラウザは使わない）。Stripe の Webhook は `https://app.<domain>/api/v2/billing/webhook` を通るので、Production に Deployment Protection やボットのチャレンジをかけない。
- `VITE_FEATURE_LEGAL_PAGES`（利用規約・プライバシーポリシーのページと登録の同意。Phase 4）は、公開のときまで**設定しない**。設定しないあいだ、`/terms` と `/privacy` は「準備中」を出し、登録画面に同意はない。**そのあいだは一般の登録を受け付けない**（拠点とテスターだけ）。公開するときは、弁護士の確認のあと、[`doc/legal/README.md`](../../doc/legal/README.md) の「ページを公開する手順」のとおりに `true` にして Redeploy する。文が下書きのままだと、ビルドが止まり、足りないものの一覧が出る。
- `VITE_SUPPORT_CONTACT`（Phase 4）: 学習者の問い合わせ先。フォームの `https://` の URL か、アドレス 1 つの `mailto:`。アカウントの削除のページ、削除のあとのページ、同意のページ、設定の「このサービスについて」に出る。設定しないと「ご利用の拠点のスタッフにお伝えください」と出る。公開の前に設定し、規約の【要記入: 連絡先】と同じ窓口にする。秘密の値ではない。
- **マージすると、すぐに画面（フロント）がデプロイされる**（Git 連携、Production Branch は `main`）。API は VM で `deploy-stack.sh` を実行するまで古いまま。新しい画面は古い API でも止まらないように作っているが、**同じ日に `deploy-stack.sh` を実行する**（[`deploy/risepath-vm/README.md`](../risepath-vm/README.md)）。
- `VITE_` で始まる値はバンドルに入り、誰でも読める。`API_ORIGIN` と `ORIGIN_SECRET` に `VITE_` を付けない。

### Preview

- Preview には `API_ORIGIN` と `ORIGIN_SECRET` を入れない（既定）。そのため Preview では `/api/*` が動かない。入れると、プレビューが本番の DB と LLM 予算を使う。
- 検証でどうしても要るときは、1 つのブランチだけにスコープし、Deployment Protection を有効にして、終わったら消す。

## `ORIGIN_SECRET` のローテーション（3 段階）

1. VM の `stack.env`: `ORIGIN_SECRET_PREVIOUS` に旧値、`ORIGIN_SECRET` に新値を入れ、`./scripts/deploy-stack.sh`。この間は両方の値が通る。
2. Vercel の Production env の `ORIGIN_SECRET` を新値にして、再デプロイする。
3. VM の `stack.env` から `ORIGIN_SECRET_PREVIOUS` を消し、もう一度 `./scripts/deploy-stack.sh`。

## オーナー作業（初回の切り替え）

秘密の値（トンネルトークン、`ORIGIN_SECRET`）はチャット・issue・git に貼らない。`<domain>` は自分のドメインに読み替える。

0. この変更の PR を `main` にマージしてから VM を作る。クイックスタートの clone も、手順 13 の Vercel の Production Branch も `main` を使う。マージ前の `main` を clone すると、swap、`stack.env` の検査、Hermes のファイルの持ち主の修正が入らない。マージした `main` のコミットで、GitHub Actions の `Database checks`・`Server stack deploy`・`Learner end-to-end` と毎晩の実行が緑であることを確かめてから、VM を作る（[ai-access-plan.ja.md](../../doc/brushup-2026/ai-access-plan.ja.md) の 11 章）。毎晩の実行を待たないときは、Actions の画面の `End-to-end checks` で **Run workflow**（`main`）を押して動かせる（計画の 11.2 の 3）。

### 新しい VM の順番

下の手順は A〜G の順に番号が付いている。新しい VM から始めるときは、次の順に進める。いちばん時間がかかるのは Cloudflare のゾーンが Active になるまで（最大 48 時間）なので、最初に始めて、待つあいだに VM を作る。

- **最初に**: 手順 4（Cloudflare にドメインを追加し、ネームサーバーを切り替える）。Free プランのゾーンは、28 日以内に Active にならないと消える。
- **ゾーンを待つあいだに**:
  - 手順 1: GCP の予算アラートを作り、残っていれば `risepath-dev-schedule` を消す。Tailscale の管理画面で旧 `risepath-vm` を Remove し、Mac で `ssh-keygen -R risepath-vm` を実行する。
  - 手順 2〜3: マシンタイプを決めて VM を作り、ファイアウォールを確かめる。VM README のクイックスタートで、スタックを `COMPOSE_PROFILES=tts` で動かす（Hermes は起動しない。`bootstrap-vm.sh` の 1 回目 → SSH し直す → `stack.env` を埋める → 2 回目）。Mac の `.env.local` を新しい値に替え、Tailscale 経由で `npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100` を流す（引数なしだと Mac の 127.0.0.1 を見る）。流せるのは `ORIGIN_SECRET` を入れる前だけ。
  - 手順 13 の import だけ: Vercel で GitHub リポジトリを import する。env はまだ入れない。
- **ゾーンが Active になったら**: 手順 5〜6（トンネル）→ 手順 7〜12（`tunnel.env`、`ORIGIN_SECRET` などの値、`tts,tunnel`、`deploy-stack.sh`、`403` の確認）→ 手順 13〜15（Vercel Production の env、Redeploy、`app.<domain>` の追加）→ 手順 16（Supabase。`app.<domain>` が開けるようになってから。そのあと初回サインインをして、自分を管理者にする）→ 手順 17（確認チェックリストと `npm run smoke:edge`）。

### A. 新しい VM を用意する

2026-10-21 に、オーナーが GCP の `risepath-vm` を削除した。VM は新しく作り、DB は空から始まる（Supabase のアカウントは残るが、進捗やジャーナルなど旧 VM の DB にあったデータは無い）。

1. 予算アラートを作り、前の VM の残りを片付ける。
   - GCP コンソールの Billing → Budgets & alerts で、このプロジェクトに月額の予算としきい値を作る。アラートは通知だけで、課金は止まらない。金額は、手順 2 の推定を GCP の料金計算ツールで確かめてから決める。
   - 夜間停止のスケジュールが残っていれば消す。どの VM にも付いていなければ消せる。

     ```bash
     export GCP_PROJECT=your-project-id
     gcloud compute resource-policies describe risepath-dev-schedule --project="$GCP_PROJECT" --region=asia-northeast1   # 無ければ not found。そのまま次へ
     gcloud compute resource-policies delete risepath-dev-schedule --project="$GCP_PROJECT" --region=asia-northeast1
     ```

   - Tailscale の管理画面（Machines）で、旧 `risepath-vm` を Remove する。残っていると、新しい VM が `risepath-vm-1` になる。
   - Mac で `ssh-keygen -R risepath-vm` を実行し、旧 VM のホスト鍵を消す。

2. マシンタイプを決めて VM を作る。VM README の[クイックスタート](../risepath-vm/README.md#クイックスタート)に沿って進める（`provision-gce.sh` → Tailscale → `/opt/risepath` の作成 → clone → `bootstrap-vm.sh` の 1 回目 → SSH し直す → `stack.env` を埋める → 2 回目）。
   - Memanto なしは `e2-medium`（4 GB。既定）。Memanto を使うなら `MACHINE_TYPE=e2-standard-2`（8 GB）。理由は VM README の「[マシンタイプ](../risepath-vm/README.md#マシンタイプ)」。
   - 月額は**推定**（未確認）: 24 時間稼働の `asia-northeast1` で `e2-medium` 約 $31、`e2-standard-2` 約 $63。ディスクは別。第三者のサイトの値なので、[GCP の料金計算ツール](https://cloud.google.com/products/calculator)で確かめる。
   - `stack.env` は VM README の表のとおりに埋める。`POSTGRES_PASSWORD` は DB の最初の起動で固定される。`COMPOSE_PROFILES` は表のとおり（`tts`。Memanto を使うなら `tts,memory`）にし、手順 9〜10 の公開エッジの値はまだ入れない。`GEMINI_API_KEY` と `GEMINI_ALLOWED` は空のまま（Gemini の API 規約は 18 歳未満の人が使うサービスでの利用を禁じている）。`OPENROUTER_API_KEY` と `HERMES_API_KEY` は、Hermes を有効にする（`full` を入れる）ときだけ要る。
   - 2 回目の最後に `api` コンテナ内の smoke が通れば、スタックは動いている。DB には migration 000–020 がすべて入る。
   - Mac の `.env.local` を新しいパスワード（Hermes を有効にしたなら `HERMES_API_KEY` も）に替える（VM README の「Mac `.env.local`」）。`ORIGIN_SECRET` を入れる前に、Mac のリポジトリ直下で `npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100` を流す（[VM README](../risepath-vm/README.md#4-手動でスタック操作vm-上)）。

3. GCP ファイアウォールを確認する。ルールはタグに付くので、前の VM のルールが残っていれば新しい VM にも効く。

   ```bash
   gcloud compute firewall-rules list --project="$GCP_PROJECT" \
     --format="table(name,direction,sourceRanges.list(),allowed[].map().firewall_rule().list(),denied[].map().firewall_rule().list(),targetTags.list())"
   ```

   - 3006・5432・3100・8642・8880 を `0.0.0.0/0` へ開く INGRESS ルールが無いこと。MCP（3100）は、ngrok などのトンネルでもインターネットに出さない。
   - 7844 を止める EGRESS の deny ルールが無いこと（無ければ、外向きは既定で許可されている。Cloudflare Tunnel は外向きの TCP と UDP の 7844 を使う）。

### B. Cloudflare

4. ドメインを Cloudflare（Free プラン）に full setup で追加する。Free では partial（CNAME）setup が使えないので、ネームサーバーの移管になる。
   - 先に今の DNS の TTL を下げる
   - 既存の DNS レコード（MX・TXT など）をすべて Cloudflare に作り直す
   - レジストラでネームサーバーを Cloudflare の指定に切り替える
   - ゾーンが Active になるまで待つ（24〜48 時間かかることがある）
5. Cloudflare Zero Trust で、ゾーンと同じアカウントに remotely-managed のトンネルを作る。
   - Published application: `api.<domain>` → Service URL `http://api:3006`
   - ルートはこの 1 つだけにする（例外: 大人が自分の AI をつなぐリモート MCP を有効にするときだけ、2 つ目の `mcp.<domain>` → `http://mcp-public:3200` を足す。手順は `doc/guides/byoa-setup.ja.md`）。Service URL に IP アドレス、`host.docker.internal`、`tcp://` のサービスを使わない。`cloudflared` からは、ホストに公開されたほかのポート（db・mcp・hermes・kokoro）や GCE のメタデータサーバーにも届くため
   - HTTP Host Header は空のまま
   - 画面のインストール用コマンドは実行しない（コンテナの `cloudflared` が接続する）。コマンドの中の `eyJ` で始まる文字列だけがトークン。手順 8 で VM の `tunnel.env` にだけ入れる
6. セキュリティ設定。正規の通信はすべて Vercel の IP から来るので、`api.<domain>` に IP ベースの rate limit ルールを付けない。Bot Fight Mode は off のまま。切り替え後、Security Events で Vercel からのリクエストに challenge が出ていないか見る。任意で、`x-origin-secret` ヘッダーの無い `api.<domain>` へのリクエストを止める WAF カスタムルールを足す。

### C. VM のスタック

7. この版の compose とスクリプトになったか確かめる（pgvector の db イメージと `stack.env` の検査は、この変更で入った）。新しい VM はクイックスタートで `main` を clone したばかりなので、取得元の確認や pull の先行は要らない（`deploy-stack.sh` が毎回 pull する）。`compose OK` が出なければ、ここで止めて手順 0 のマージを見直す。

   ```bash
   cd /opt/risepath/deploy/risepath-vm
   grep -q 'pgvector/pgvector:0.8.7-pg16' docker-compose.yml && grep -q PLACEHOLDERS scripts/deploy-stack.sh && echo 'compose OK'
   ```

8. `tunnel.env` を作り、手順 5 のトークンを `TUNNEL_TOKEN=` の後ろに貼る。Git 管理外で、`cloudflared` サービスだけが読む。

   ```bash
   cp tunnel.env.example tunnel.env && chmod 600 tunnel.env
   nano tunnel.env
   ```

9. VM 上で `openssl rand -hex 32` を実行してシークレットを作る。値は `stack.env` の `ORIGIN_SECRET` と、Vercel Production の `ORIGIN_SECRET` の 2 か所だけに貼る。
10. `stack.env` を編集する（テンプレートは [`stack.env.example`](../risepath-vm/stack.env.example) の Public edge ブロック）。

    ```env
    ORIGIN_SECRET=<手順 9 の値>
    TRUST_PROXY=1
    LLM_ALLOWED_ORIGINS=https://app.<domain>
    COMPOSE_PROFILES=tts,tunnel
    # Hermes を有効にするときだけ COMPOSE_PROFILES=full,tunnel
    # RISE_PATH_PUBLIC_URL は設定しない
    ```

    - `TRUST_PROXY=1`: `cloudflared` が 1 ホップ。`true` にしない
    - `LLM_ALLOWED_ORIGINS`: API に届く Host は `app.<domain>` にならない（`api.<domain>` の見込み）ので、アプリのオリジンを明示する
    - `RISE_PATH_PUBLIC_URL` があると、メディア URL が `https://api.<domain>` の絶対 URL になり 403 になる
    - Memanto を使う場合は `COMPOSE_PROFILES=tts,memory,tunnel` にする（書き忘れても `deploy-stack.sh` が `memory` を足す）。`MEMANTO_ENABLED=true` も `stack.env` に入れる（VM 起動時の systemd ユニットが読む。手順 2 で入れていればそのまま）
    - `ANTHROPIC_API_KEY` が入っているか確かめる。チューター、文章フィードバック、コース生成が使う
    - `GEMINI_API_KEY` と `GEMINI_ALLOWED` が空か確かめる。Gemini を使わないので、教材の検索はキーワード検索で動き、AI の画像生成は止まる（`/api/v2/image` は 503）
11. `./scripts/deploy-stack.sh` で公開エッジを有効にする。その前に、任意で migration の状態を確かめる（適用はしない。正本 §4.2 の「[migration の確認](../../doc/guides/risepath_vm_deployment.md#migration-の確認適用前)」）。新しい VM では手順 2 の初回デプロイで 000–020 が入ったので、すべて適用済み（未適用 0 件）と出れば正しい。

    ```bash
    docker compose --env-file stack.env build api
    docker compose --env-file stack.env up -d --wait db   # 止まっていれば起動する
    docker compose --env-file stack.env run --rm --no-deps api npm run db:migrate:status
    ```

    そのあと `./scripts/deploy-stack.sh` を実行する。`tunnel` プロファイルで値が足りないと、足りない変数名だけを表示して止まる。smoke は `api` コンテナ内で流れる。終わったら `docker compose --env-file stack.env ps` で `cloudflared` が healthy か見る。
12. 直接アクセスが閉じているか確認する。`403` が出れば正しい。

    ```bash
    curl -s -o /dev/null -w '%{http_code}\n' https://api.<domain>/api/v2/health
    ```

### D. Vercel

13. Vercel Pro で GitHub リポジトリを import する（Git 連携。Production Branch は `main`）。ゾーンを待つあいだに import 済みなら、そのプロジェクトを使う。Production env に上の表の 6 つを入れる。`VITE_API_BASE_URL` があれば消す。`VITE_FEATURE_AGENT_CHAT` は入れない（あれば消す）。`VITE_FEATURE_LEGAL_PAGES` は公開のときまで入れない。`VITE_SUPPORT_CONTACT` は、窓口が決まったら入れる。Preview には `API_ORIGIN` と `ORIGIN_SECRET` を入れず、プレビューの Deployment Protection を有効にする。
    - env を足したり消したりしたら（`VITE_API_BASE_URL` の削除も含む）、Deployments で最新の Production デプロイを Redeploy する。ビルドキャッシュは使わない。env の変更は次のデプロイから効き、`VITE_` の値はビルド時にバンドルへ入る。import 直後のデプロイは env なしでビルドされていることがある。
    - 手順 15 のビルド確認と、手順 17 の `npm run smoke:edge` は、この新しいデプロイに対して行う。
    - Settings → Environment Variables で、6 つが Production だけに付いていて、Preview のスコープに何も保存されていないことを確かめる（import 画面で入れた値も見る）。
14. プロジェクトに `app.<domain>` を追加する。Cloudflare DNS には、Vercel が表示するレコードを **DNS only（灰色の雲）** で作る。Vercel が配信するホストは Cloudflare のプロキシを通さない。
15. 手順 13 の再デプロイがビルドできるか見る。`vercel.json` は `routes` だけを使い、`handle: filesystem` を含む（コミット済みの `public/generated` を静的に配信するため）。ビルドが `routes` や `handle` を拒否したら、そこで止めて報告する。

### E. Supabase

16. Authentication → URL Configuration で、Site URL を `https://app.<domain>` にし、Redirect URLs に `https://app.<domain>/auth/callback` を足す（`context/AuthContext.tsx` の `emailRedirectTo`）。
    - 変えるのは、`app.<domain>` が開けるようになってから（手順 14〜15 のあと）。先に変えると、認証メールのリンクがまだ開けないホストを指す。
    - 初回サインインのあと、自分を管理者にする。空の DB には管理者がいない（プロフィールは役割 `learner` で作られる）。`https://app.<domain>` でサインインして設定画面を一度開いてから、VM README の「[管理者にする](../risepath-vm/README.md#5-管理者にする初回サインインのあと)」の `UPDATE` を流す。

### F. 公開前の確認

17. 下の「確認チェックリスト」をすべて通す。チューターの応答が一度にまとめて届く、または Authorization が API に届かないときは、公開せずに止めて報告する。

### G. 運用

- GCP の予算アラート（手順 1）: 24 時間稼働の最初の 1 日分の費用が Billing のレポートに出たら、しきい値を見直す。手順 2 の月額は推定なので、実際の額で決め直す。
- 稼働監視: `https://app.<domain>/api/v2/health` を外形監視する（edge には `{ ok, status }` だけを返す）。`ROUTER_EXTERNAL_TARGET_ERROR` や Cloudflare のエラーページは、`cloudflared` か VM が落ちている印。
- Anthropic のコンソールで、利用上限かアラートを設定する（Hermes を有効にしたなら OpenRouter も）。公開直後はサインイン済みの全ユーザー合計の日次上限（`AI_CAP_GLOBAL_*`。機能ごとの費用のブレーカー。日本時間 0 時にリセット。`deploy/risepath-vm/stack.env.example` を参照）を下げることも考える。全体の上限の 80% と 100% に達すると `[AI caps] global daily cap` のエラーログが出る。`AI_CAP_ALERT_WEBHOOK_URL` に Slack か Discord の Incoming Webhook を入れると、同じ内容が届く。
- 未成年の安全対策（Phase 0.5）: ゲスト（ログインしていない人）は AI を使えない（`LLM_GUEST_AI` を設定しない既定。ゲスト枠 `LLM_GUEST_DAILY_*` はそのときだけ使う）。報告や止めた件数の通知は `SAFETY_ALERT_WEBHOOK_URL`（未設定なら `AI_CAP_ALERT_WEBHOOK_URL`）に届く。報告の確かめ方、紙の同意書の記録、虐待や命の危険が疑われるときの動き方は [`doc/guides/safety-operations.ja.md`](../../doc/guides/safety-operations.ja.md) を見る。
- サインアップを公開するなら、Supabase の Email 認証の設定で「Confirm email」（メールアドレスの確認）が有効か確かめる。確認していないアカウントを量産して、有料の AI 機能の枠を増やせないようにするため（アプリには確認待ちの画面 `/auth/confirm-pending` がある）。
- サインアップの公開前に、Supabase の Attack Protection で CAPTCHA（hCaptcha か Cloudflare Turnstile）も有効にする。ただし、アプリのサインアップとログインのフォームはまだ `captchaToken` を送らない。先に有効にするとログインできなくなるので、フォーム側の対応が入ってから有効にする。それまでは、Supabase の「Allow new users to sign up」を切ってサインアップを止めておくか、全体の上限（`AI_CAP_GLOBAL_*`）を低めにしておく。
- `ORIGIN_SECRET` は定期的にローテーションする（上の 3 段階）。
- `cloudflared` は `docker-compose.yml` でタグと digest を固定している。更新は両方を一緒に上げ、利用の少ない時間に行う。再起動で流れているストリームが切れる。

## 確認チェックリスト

公開前に、実機ですべて通す。括弧内の点は Vercel と Cloudflare の公開ドキュメントで確かめられていない。**事実ではなく、確かめる項目**として扱う。

- [ ] `npm run smoke:edge` の必須チェックがすべて通る（Mac のリポジトリ直下で実行）

  ```bash
  # 任意: テストユーザーの Supabase アクセストークン。シェルにだけ置き、ファイルやログに残さない
  read -rs SMOKE_BEARER && export SMOKE_BEARER
  PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge
  ```

- [ ] Authorization ヘッダーが routes を通って API に届く（`SMOKE_BEARER` を付けた smoke、またはログイン後のプロフィール表示）
- [ ] 18 歳以上のテスト用アカウントで、チューターの応答が少しずつ表示される。DevTools の Network で `text/event-stream` になり、本文が分割して届く（Vercel の routes と Cloudflare Free が SSE をバッファしないか）
- [ ] 4.5 MB を超えるファイルのアップロードが成功する（外部転送のボディ上限）
- [ ] TTS の音声が再生できる（`/audio/cache/...` が routes を通る）
- [ ] AI の画像生成は止まっている（`GEMINI_ALLOWED` を設定しない既定。`/api/v2/image` は 503 `image_generation_unavailable` を返す）。`GEMINI_ALLOWED=true` にした環境でだけ、生成した画像が表示されるか（`/generated/img_...`）を見る
- [ ] 画面に浮かぶ AI コーチ（共有の Hermes）が出ない（`VITE_FEATURE_AGENT_CHAT` を設定しない既定）。レッスンの AI チューターは使える
- [ ] クエリ文字列が API に届く。smoke が表示した id を、VM の `deploy/risepath-vm` で `docker compose --env-file stack.env logs api | grep smoke=` で探す
- [ ] 未成年の安全対策（Phase 0.5。手順は [`doc/guides/safety-operations.ja.md`](../../doc/guides/safety-operations.ja.md)）。テスト用のアカウントを 2 つ（18 歳以上と 18 歳未満）使う。本物の子どもの情報は使わない:
  - [ ] VM で migration 014 が当たっている（`deploy-stack.sh` の `db:migrate`）。`docker compose --env-file stack.env exec db psql -U risepath_app -d risepath -c '\d user_age'` で表が出る
  - [ ] ログインしていない状態で AI を呼ぶと 401 `sign_in_required` になる（`LLM_GUEST_AI` を設定しない既定）。`/api/v2/llm/status` は 200 のまま
  - [ ] 生まれた年と月を登録していないアカウントで、チューターを使おうとすると「AI を使う前に、ひとつだけ設定してください」の案内が出て、「AI の利用設定へ」ボタンで `/settings/ai-access` に進める（API は 403 `age_required`）。AI を使わないレッスンは読める
  - [ ] 18 歳未満のアカウントで年月を登録すると、保護者の同意の画面になる。同意する前は AI を使えない（403 `guardian_consent_required`）
  - [ ] 保護者の同意のあと、18 歳未満のアカウントのチューターの答えは、確認が終わってから**まとめて**表示される（少しずつ流れてこない。これは正しい動き）
  - [ ] 18 歳未満のアカウントで、ふつうの学習の質問には答えが出る。架空の携帯番号（例: `090-0000-0000`）を書いて送ると、AI に答えさせずに「答えられません」という案内が出る（API は 422 `content_blocked`、`category: personal_info`）。この 1 件は管理者の安全のページの集計に「入力を止めた」として出る
  - [ ] AI の答えの近くに「AI が作った答えです」の表示と「報告する」ボタンがある。報告を 1 件送ると、管理者のアカウントの `/settings/admin/safety` の「報告」に出て、「確認済みにする」で消える。`SAFETY_ALERT_WEBHOOK_URL`（または `AI_CAP_ALERT_WEBHOOK_URL`）を入れているなら、学習者の文章をふくまない通知が届く
  - [ ] 18 歳未満のアカウントの「AI の利用設定」で保護者の同意をやめると、すぐに AI が使えなくなる
  - [ ] ログインしていない状態で `https://app.<domain>/ai-safety` が開け、相談窓口の電話番号が出る
- [ ] P-School の画像が出る（例: `https://app.<domain>/p_school/assets/armory.jpg`）
- [ ] Hermes を有効にしたときだけ: AI エージェントが自分の教材を検索できる。テスト用の学習者で小さな教材をアップロードし、取り込みが終わってから、エージェントにその内容を質問する。答えに教材の内容が出れば、Hermes がツール呼び出しに `rp_turn` を渡している。出ずに「使えない」と返るときは、`docker compose --env-file stack.env logs mcp | grep session_binding_required` で確かめ、公開せずに止めて報告する
- [ ] Hermes を有効にしたときだけ: 別の学習者でサインインし、同じ質問をしても、前の学習者の教材が出ない

## 既知の制限

- Vercel は転送先の最初の 1 バイトを 120 秒まで待つ。その後は 120 秒以内ごとにデータが届けば続く。Cloudflare の Proxy Read Timeout は 125 秒（524。トンネルの接続先にも効くかは未確認）。そのため、ストリーミングでない呼び出しが 120 秒ほど何も返さないと失敗する。最悪の場合、文章フィードバック、画像生成、大きなファイルの RAG 取り込みが当たる。ブラウザがエラーを出したあとも、VM 側は処理と課金を続けることがある。
- TTS の音声（`/audio/cache/...`）と、実行時に生成された画像（`/generated/img_...`）は API から届く。そのため Preview と、VM（`cloudflared`・`api`）が止まっているあいだは読み込めない。リポジトリに含まれる `public/generated` の画像は Vercel が静的に配信する。
- `.vercelignore` の `*.pdf` で、スライドの PDF は Vercel に載らない。
- Vite 単体では Skew Protection が効かない。デプロイ前に開いたタブが消えたチャンクを読むと 404 になり、`chunkReload.ts` が再読み込みする。

## デプロイ

- Git 連携: `main` への push で本番がビルドされる（CI にデプロイジョブはない）。レッスンはビルド時にバンドルされるので、学習者に届くのは再ビルドのあと。
- CLI: `npm run vercel:link`（初回のプロジェクト紐付け）、`npm run vercel:deploy`（本番。`--archive=tgz` で巨大リポジトリの CLI OOM とファイル数上限を避ける）。`vercel:deploy` はローカルの作業ツリーをそのままアップロードするので、`main` のクリーンなチェックアウトで実行する。
- `.vercelignore` は `node_modules`、Blender マニュアル HTML（約 1.2 GB）、`*.env`・`.env*`、`.artifacts/`・`.shots/`、`public/uploads`・`/uploads`（アップロードされた教材）、`/data/curricula/p_school` などを除外する。`public/p_school` は載る。
- データの書き出しと DB のダンプ（`exports/`・`backups/`・`*.dump`・`*.sql.*`・ルートの `*.sql`）と、ホストの間で持ち運ぶ暗号化した秘密（`*.env.gpg`）も、`.gitignore` と同じく除外する。`.gitignore` にあるファイルは `git status` に出ないので、「クリーン」に見えるチェックアウトにも残っていることがある。
- API（VM）はフロントと別にデプロイする。新しい API を前提にしたフロントは、先に VM で `deploy-stack.sh` を流してから出す。
