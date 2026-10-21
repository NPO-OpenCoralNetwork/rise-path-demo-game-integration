# Vercel フロントデプロイ（`app.<domain>`）

フロント（`npm run build:prod` の静的ビルド）を Vercel の `https://app.<domain>` に載せる。API は GCP の `risepath-vm` の Docker スタックに残し、Cloudflare Tunnel 経由の `https://api.<domain>` だけで公開する。ブラウザが呼ぶのは自分のオリジンの相対パス `/api/v2` だけなので、API 呼び出しに CORS は関わらない。

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
- Tailscale から VM の `:3006` を呼ぶ場合も、`ORIGIN_SECRET` を設定したあとは `x-origin-secret` が要り、edge 扱いになる。db・mcp・hermes・kokoro への Tailscale 接続は今までどおり（[`deploy/risepath-vm/README.md`](../risepath-vm/README.md)）。

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

0. この変更の PR を `main` にマージする。手順 7 の VM の pull も、手順 13 の Vercel の Production Branch も `main` を使う。

### A. VM を再開する

2026-10-21 時点で、オーナーの報告では VM は使っていない。

1. 状態を確認して起動する。初回デプロイの前に、コンソールでブートディスクのスナップショットを取ってもよい。

   ```bash
   gcloud compute instances describe risepath-vm --zone=asia-northeast1-b --format='value(status,resourcePolicies)'
   gcloud compute instances start risepath-vm --zone=asia-northeast1-b
   ```

   `describe` が `was not found` を返したら、VM は削除されている。VM README の[クイックスタート](../risepath-vm/README.md#クイックスタート)（`provision-gce.sh` → Tailscale → `bootstrap-vm.sh`）で作り直す。DB は空から始まる。そのあと手順 3 から続ける。

2. 夜間停止を外す。公開 API は 24 時間動いている必要がある。コンピュート費用は 14 時間/日の頃より増える。`provision-gce.sh` は既定で夜間停止を付けない（`NIGHT_STOP=1` で付ける）。

   ```bash
   gcloud compute instances remove-resource-policies risepath-vm \
     --resource-policies=risepath-dev-schedule --zone=asia-northeast1-b
   # 任意: スケジュール自体も消す
   gcloud compute resource-policies delete risepath-dev-schedule --region=asia-northeast1
   ```

3. GCP ファイアウォールを確認する。タグ `risepath-vm` に、3006・5432・3100・8642・8880 を `0.0.0.0/0` へ開くルールが無いこと。外向きの TCP と UDP の 7844（Cloudflare Tunnel）が許可されていること。

### B. Cloudflare

4. ドメインを Cloudflare（Free プラン）に full setup で追加する。Free では partial（CNAME）setup が使えないので、ネームサーバーの移管になる。
   - 先に今の DNS の TTL を下げる
   - 既存の DNS レコード（MX・TXT など）をすべて Cloudflare に作り直す
   - レジストラでネームサーバーを Cloudflare の指定に切り替える
   - ゾーンが Active になるまで待つ（24〜48 時間かかることがある）
5. Cloudflare Zero Trust で、ゾーンと同じアカウントに remotely-managed のトンネルを作る。
   - Published application: `api.<domain>` → Service URL `http://api:3006`
   - ルートはこの 1 つだけにする。Service URL に IP アドレス、`host.docker.internal`、`tcp://` のサービスを使わない。`cloudflared` からは、ホストに公開されたほかのポート（db・mcp・hermes・kokoro）や GCE のメタデータサーバーにも届くため
   - HTTP Host Header は空のまま
   - 表示されたトークンは、手順 8 で VM の `tunnel.env` にだけ入れる
6. セキュリティ設定。正規の通信はすべて Vercel の IP から来るので、`api.<domain>` に IP ベースの rate limit ルールを付けない。Bot Fight Mode は off のまま。切り替え後、Security Events で Vercel からのリクエストに challenge が出ていないか見る。任意で、`x-origin-secret` ヘッダーの無い `api.<domain>` へのリクエストを止める WAF カスタムルールを足す。

### C. VM のスタック

7. **初回デプロイの注意: 先に pull してから `deploy-stack.sh` を実行する。** VM にある `deploy-stack.sh` は古い可能性がある。古い本体には tunnel のガードが無く、ホストに node があると smoke をホストから流す（ゲートが有効だと 403 で落ちる）。

   pull の前に取得元を確かめる。`origin` が `https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git` でなければ、pull しても新しいコードは入らない。VM README の「[既存の `/opt/risepath` がある場合](../risepath-vm/README.md#既存の-optrisepath-がある場合)」に沿って clone し直してから続ける。

   ```bash
   git -C /opt/risepath remote -v
   ```

   pull したら、この版の compose になったか確かめる。`compose OK` が出なければ、ここで止めて手順 0 のマージと取得元を見直す。

   ```bash
   git -C /opt/risepath pull --ff-only
   cd /opt/risepath/deploy/risepath-vm
   grep -q cloudflared docker-compose.yml && echo 'compose OK'
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
    COMPOSE_PROFILES=full,tunnel
    # RISE_PATH_PUBLIC_URL は設定しない
    ```

    - `TRUST_PROXY=1`: `cloudflared` が 1 ホップ。`true` にしない
    - `LLM_ALLOWED_ORIGINS`: API に届く Host は `app.<domain>` にならない（`api.<domain>` の見込み）ので、アプリのオリジンを明示する
    - `RISE_PATH_PUBLIC_URL` があると、メディア URL が `https://api.<domain>` の絶対 URL になり 403 になる
    - Memanto を使う場合、`memory` プロファイルは `deploy-stack.sh` が足す
11. `./scripts/deploy-stack.sh` を実行する。`tunnel` プロファイルで値が足りないと、足りない変数名だけを表示して止まる。smoke は `api` コンテナ内で流れる。終わったら `docker compose --env-file stack.env ps` で `cloudflared` が healthy か見る。
    - 実行の前に、未適用の migration を確かめてもよい（任意。適用はしない。正本 §4.2 の「[migration の確認](../../doc/guides/risepath_vm_deployment.md#migration-の確認適用前)」）。2026-06-24 の記録は 000–008 までなので、009〜012 が未適用と出る見込み。`deploy-stack.sh` がまとめて適用する。

      ```bash
      docker compose --env-file stack.env build api
      docker compose --env-file stack.env up -d --wait db   # 止まっていれば起動する
      docker compose --env-file stack.env run --rm --no-deps api npm run db:migrate:status
      ```
12. 直接アクセスが閉じているか確認する。`403` が出れば正しい。

    ```bash
    curl -s -o /dev/null -w '%{http_code}\n' https://api.<domain>/api/v2/health
    ```

### D. Vercel

13. Vercel Pro で GitHub リポジトリを import する（Git 連携。Production Branch は `main`）。Production env に上の表の 6 つを入れる。`VITE_API_BASE_URL` があれば消す。Preview には `API_ORIGIN` と `ORIGIN_SECRET` を入れず、プレビューの Deployment Protection を有効にする。
    - env を足したり消したりしたら（`VITE_API_BASE_URL` の削除も含む）、Deployments で最新の Production デプロイを Redeploy する。ビルドキャッシュは使わない。env の変更は次のデプロイから効き、`VITE_` の値はビルド時にバンドルへ入る。import 直後のデプロイは env なしでビルドされていることがある。
    - 手順 15 のビルド確認と、手順 17 の `npm run smoke:edge` は、この新しいデプロイに対して行う。
    - Settings → Environment Variables で、6 つが Production だけに付いていて、Preview のスコープに何も保存されていないことを確かめる（import 画面で入れた値も見る）。
14. プロジェクトに `app.<domain>` を追加する。Cloudflare DNS には、Vercel が表示するレコードを **DNS only（灰色の雲）** で作る。Vercel が配信するホストは Cloudflare のプロキシを通さない。
15. 手順 13 の再デプロイがビルドできるか見る。`vercel.json` は `routes` だけを使い、`handle: filesystem` を含む（コミット済みの `public/generated` を静的に配信するため）。ビルドが `routes` や `handle` を拒否したら、そこで止めて報告する。

### E. Supabase

16. Authentication → URL Configuration で、Site URL を `https://app.<domain>` にし、Redirect URLs に `https://app.<domain>/auth/callback` を足す（`context/AuthContext.tsx` の `emailRedirectTo`）。

### F. 公開前の確認

17. 下の「確認チェックリスト」をすべて通す。チューターの応答が一度にまとめて届く、または Authorization が API に届かないときは、公開せずに止めて報告する。

### G. 運用

- 稼働監視: `https://app.<domain>/api/v2/health` を外形監視する（edge には `{ ok, status }` だけを返す）。`ROUTER_EXTERNAL_TARGET_ERROR` や Cloudflare のエラーページは、`cloudflared` か VM が落ちている印。
- Anthropic・Gemini・OpenRouter の各コンソールで、利用上限かアラートを設定する。公開直後はゲスト枠（`LLM_GUEST_DAILY_PER_IP`・`LLM_GUEST_DAILY_TOTAL`）を下げることも考える。
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
- [ ] チューターの応答が少しずつ表示される。DevTools の Network で `text/event-stream` になり、本文が分割して届く（Vercel の routes と Cloudflare Free が SSE をバッファしないか）
- [ ] 4.5 MB を超えるファイルのアップロードが成功する（外部転送のボディ上限）
- [ ] TTS の音声が再生できる（`/audio/cache/...` が routes を通る）
- [ ] 画像生成の結果が表示される（`/generated/img_...`）
- [ ] クエリ文字列が API に届く。smoke が表示した id を、VM の `deploy/risepath-vm` で `docker compose --env-file stack.env logs api | grep smoke=` で探す
- [ ] P-School の画像が出る（例: `https://app.<domain>/p_school/assets/armory.jpg`）

## 既知の制限

- Vercel は転送先の最初の 1 バイトを 120 秒まで待つ。その後は 120 秒以内ごとにデータが届けば続く。Cloudflare の Proxy Read Timeout は 125 秒（524。トンネルの接続先にも効くかは未確認）。そのため、ストリーミングでない呼び出しが 120 秒ほど何も返さないと失敗する。最悪の場合、文章フィードバック、画像生成、大きなファイルの RAG 取り込みが当たる。ブラウザがエラーを出したあとも、VM 側は処理と課金を続けることがある。
- TTS の音声（`/audio/cache/...`）と、実行時に生成された画像（`/generated/img_...`）は API から届く。そのため Preview と、VM（`cloudflared`・`api`）が止まっているあいだは読み込めない。リポジトリに含まれる `public/generated` の画像は Vercel が静的に配信する。
- `.vercelignore` の `*.pdf` で、スライドの PDF は Vercel に載らない。
- Vite 単体では Skew Protection が効かない。デプロイ前に開いたタブが消えたチャンクを読むと 404 になり、`chunkReload.ts` が再読み込みする。

## デプロイ

- Git 連携: `main` への push で本番がビルドされる（CI にデプロイジョブはない）。レッスンはビルド時にバンドルされるので、学習者に届くのは再ビルドのあと。
- CLI: `npm run vercel:link`（初回のプロジェクト紐付け）、`npm run vercel:deploy`（本番。`--archive=tgz` で巨大リポジトリの CLI OOM とファイル数上限を避ける）。`vercel:deploy` はローカルの作業ツリーをそのままアップロードするので、`main` のクリーンなチェックアウトで実行する。
- `.vercelignore` は `node_modules`、Blender マニュアル HTML（約 1.2 GB）、`*.env`・`.env*`、`.artifacts/`・`.shots/`、`public/uploads`、`/data/curricula/p_school` などを除外する。`public/p_school` は載る。
- API（VM）はフロントと別にデプロイする。新しい API を前提にしたフロントは、先に VM で `deploy-stack.sh` を流してから出す。
