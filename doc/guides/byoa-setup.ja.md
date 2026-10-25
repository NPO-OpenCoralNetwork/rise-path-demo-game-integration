# 自分の AI をつなぐ（BYOA）: オーナーの設定手順

- 対象: Phase 1（[`../brushup-2026/ai-access-plan.ja.md`](../brushup-2026/ai-access-plan.ja.md) の 5 章）。18 歳以上の学習者が、自分の AI（Claude Code、Codex、Claude.ai、Cursor、VS Code、自分の Hermes、ChatGPT）を、インターネット上の Rise Path の MCP サーバーにつなぎます。Phase 2（同じ文書の 6 章）で、公開レッスンを AI と学ぶツールを 5 つ足しました。すでに `byoa` を動かしているときは、手順 7 の「Phase 2 の更新」を行います。
- 書いた日: 2026-10-23。Supabase の OAuth 2.1 サーバーは**ベータ版**です。画面の名前や動きは変わることがあります。各手順の出典のページを開いて、今の表示と合っているか確かめてから進めてください。
- 学習者向けのつなぎ方: [`usage_guide.md`](./usage_guide.md) の「自分の AI をつなぐ（リモート MCP）」。

## 全体の形

```
学習者の AI アプリ ──(1) POST https://mcp.<domain>/mcp（トークンなし）
        │           ←─ 401 + WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"
        │──(2) メタデータを読む → authorization_servers: [https://<ref>.supabase.co/auth/v1]
        │──(3) Supabase で登録（DCR）→ ブラウザで https://app.<domain>/oauth/consent（Rise Path の許可の画面）
        │──(4) Supabase がトークンを発行（Custom Access Token Hook が aud を MCP の URL にする）
        └──(5) POST /mcp（Bearer トークン）→ Cloudflare Tunnel → mcp-public:3200 → VM の Postgres（最小権限のロール）
```

- MCP サーバーは `mcp-public` コンテナです（`deploy/risepath-vm/docker-compose.yml`、Compose のプロファイル `byoa`）。管理者用の `mcp` コンテナとは別で、`mcp` はこれまでどおり公開しません。
- 毎回のリクエストで、トークンの検証（`mcp-server/oauthVerifier.js`）、18 歳以上かどうかの確認、1 日の上限を確かめます（`mcp-server/remotePolicy.js`）。
- 学習者が「つないでいる AI アプリ」（`/settings/connected-apps`）で接続を解除すると、それより前に発行されたトークンは数秒以内に使えなくなります。MCP サーバーは「解除されていない」という答えを 5 秒まで覚えるためです。画面は解除の日時を、Supabase の `revokeGrant` の前と後の 2 回書きます。あいだに AI アプリが受け取ったトークンも、2 回目の日時より前に発行されたものとして断ります。

## 手順（この順に進めます）

### 1. ステージングの Supabase プロジェクトを作る

本番のプロジェクトを触る前に、手順 2〜6 を**ステージング用の別プロジェクト**でひととおり試します。Site URL や許可の画面の場所はプロジェクトごとの設定なので、本番のプロジェクトでは、ローカルや Vercel のプレビューで許可の画面を試せません。また、手順 5 のフックをまちがえると、そのプロジェクトでは誰もログインできなくなります。

1. Supabase で新しいプロジェクトを作ります（例: `risepath-staging`）。
2. 手元で `npm run dev` を動かし、`.env.local` の Supabase の値（`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` など）をステージングのものにします。
3. ステージングの Site URL は、手元のフロント（`http://localhost:3007`）にします（手順 3）。
4. 手元で MCP サーバーを動かすときは、`MCP_REMOTE_TEST=1` を付けます。127.0.0.1 だけで待ち受け、`http://localhost` の URL を受け付けます（本番では使いません）。

   ```bash
   MCP_REMOTE_TEST=1 MCP_PUBLIC_RESOURCE_URL=http://localhost:3200/mcp \
   SUPABASE_URL=https://<staging-ref>.supabase.co SUPABASE_ANON_KEY=<staging の anon key> \
   DATABASE_URL_PHASE1=postgresql://... APP_PUBLIC_URL=http://localhost:3007 \
   node mcp-server/index.js --http
   ```

   ステージングのフック（手順 5）には、このときの URL（`http://localhost:3200/mcp`）を入れます。Claude.ai や ChatGPT は Anthropic や OpenAI のクラウドからつなぐので、手元のサーバーには届きません。この 2 つは、本番と同じ形の公開のホスト名で試します（手順 10）。

### 2. JWT の署名鍵を ES256 にする

Supabase → **Settings → JWT signing keys**（<https://supabase.com/docs/guides/auth/signing-keys>）。

1. **Migrate JWT secret** を押します。今の秘密鍵（HS256）が新しい仕組みに取り込まれ、非対称鍵（ES256 をえらびます）が「standby key」として作られます。
2. **Rotate keys** を押して、新しいトークンの署名を ES256 に切り替えます。
3. **古い秘密鍵（legacy secret）は取り消しません。** Rise Path は今も古い形の anon key と service_role key（`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`）を使っていて、これらは古い秘密鍵で署名されています。取り消すと、API と P-School が動かなくなります。

リモート MCP は、ES256 か RS256 で署名され、公開鍵（`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`）にある鍵の ID（kid）を持つトークンだけを受け付けます。HS256 のトークンは、Supabase に問い合わせずに 401 にします。公開鍵は Supabase 側で 10 分キャッシュされるので、切り替えのあと 20 分ほどは古い鍵のまま見えることがあります。

### 3. Site URL を確かめる

Supabase → **Authentication → URL Configuration**。

- 本番の Site URL が、フロントのオリジン（`https://app.<domain>`）になっているかを、**変える前に**確かめます。許可の画面は「Site URL + Authorization Path」に開きます。確認メールなどのテンプレートも Site URL を使うので、ちがう値なら、影響を確かめてから直します。
- ステージングでは `http://localhost:3007` にします。

### 4. OAuth サーバーを有効にし、DCR（動的クライアント登録）を on にする

Supabase → **Authentication → OAuth Server**（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。

1. OAuth 2.1 サーバーを有効にします。ベータ版で、追加の料金はありません。ただし、この方法でログインした人も月間アクティブユーザー（MAU）に数えます。
2. **Authorization Path** を `/oauth/consent` にします。
3. **Dynamic client registration（DCR）** を on にします。Supabase は CIMD（URL で AI アプリを名乗る方式）に対応していないので、Claude.ai、ChatGPT、Codex、Claude Code などは DCR で登録します。DCR を off にすると、ほとんどの AI アプリがつなげません。

DCR では、誰でも AI アプリを登録できます。Supabase も「どの MCP クライアントでもプロジェクトに登録できる」と注意しています（<https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication>）。Claude は、新しく接続するたびに新しいクライアントを登録します（<https://claude.com/docs/connectors/building/authentication>）。次のように運用します。

- **毎週 1 回、Authentication → OAuth Apps を見ます。** 見覚えのない名前、Rise Path や有名なサービスを名乗るもの、急に増えたものを確かめ、使われていないものは消します。どの学習者がどのアプリを使ったかは、Rise Path 側の `mcp_oauth_grants`（最後に使った日時）で分かります。
- 許可の画面は、アプリの名前を「アプリが自分で付けた名前」と表示し、ロゴの画像は読み込みません。戻る先のアドレスのホスト名を表示し、`localhost` には注意を出します。
- Supabase は DCR の登録を接続元の IP アドレスごとに制限しています（ソースコードの既定は 5 分に 10 回）。Claude.ai や ChatGPT の利用者は、同じ事業者のアドレスから登録するので、利用者が増えると登録が断られることがあります【要確認: 本番の制限値と、引き上げられるか】。
- **DCR を on にする前に、手順 6 の「パスワードとメールアドレスの変更」の設定を済ませます。** 学習者が許可した AI アプリは、Supabase Auth では学習者と同じ力を持ちます。DCR では誰でもアプリを登録できるので、許可をだまし取るためのアプリも登録できます。次のどちらかを選び、[`../brushup-2026/ai-access-plan.ja.md`](../brushup-2026/ai-access-plan.ja.md) の 5.4 に記録します。
  - DCR を on にし、上のとおり毎週 OAuth Apps を見る（ほとんどの AI アプリがつなげます）。
  - DCR を off にし、知っているクライアントだけを **Authentication → OAuth Apps → Add a new client** で登録しておく（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。クライアント ID を手で入れられる AI アプリだけがつなげます【要確認: どのアプリが対応しているか】。

### 5. Custom Access Token Hook を入れる

[`deploy/supabase/README.md`](../../deploy/supabase/README.md) の手順で、`deploy/supabase/custom_access_token_hook.sql` を実行し、Authentication → Hooks で有効にします。

- これがないと、AI アプリに渡すトークンの宛先（`aud`）が、学習者自身のログインと同じ `authenticated` のままです。リモート MCP は、そのトークンを 401 で断ります（安全な側に倒れます）。
- フックはすべてのログインで動きます。**ステージングで試してから**本番に入れます。

### 6. （要確認）Supabase 側のほかの設定

- **P-School の表**: AI アプリのトークンも `role` は `authenticated` です。P-School がブラウザから使う表（`profiles`、`battle_records`）の RLS に `(auth.jwt() ->> 'client_id') is null` を足すかを決めます（[`deploy/supabase/README.md`](../../deploy/supabase/README.md)）。P-School のコードは変えません。
- **パスワードとメールアドレスの変更（Supabase Auth の `/user`）**: supabase/auth のソースコード（`internal/api/user.go`、2026-10-21 時点）を読んだかぎりでは、AI アプリのトークンでも `/user` を呼べます【本番の Supabase では未検証】。何もしないと、AI アプリはアカウントのパスワードを設定するか置き換え、そのパスワードでふつうにログインできます。そのログインは学習者自身のログインと同じ形（`client_id` なし）なので、アプリの API の守り（`oauth_client_token`）では止められず、アプリの API もすべて使えます。次の 3 つを on にします。場所は Authentication → Sign In / Providers → Email です（Supabase の文書のリンク先は `https://supabase.com/dashboard/project/_/auth/providers?provider=Email`）。
  - **Require current password when changing password**: パスワードを変えるとき、今のパスワードを確かめます。ダッシュボードでは「Require current password when updating」と出ることがあります【要確認: 今の表示名】。
  - **Require reauthentication when changing password**: ログインから 24 時間をこえたセッションでは、メールで届く確認のコード（nonce）がないとパスワードを変えられません。ダッシュボードでは「Secure password change」と出ることがあります【要確認: 今の表示名】。
  - **Secure email change**: メールアドレスの変更を、前と後の両方のアドレスで確かめます【要確認: 今の表示名】。

  出典: パスワードの 2 つは <https://supabase.com/docs/guides/auth/password-security>（「Require reauthentication when changing password」「Require current password when changing password」）、メールアドレスは <https://supabase.com/docs/guides/self-hosting/auth/config>（`GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED`）。

  **残るリスク**: 今のパスワードの確認は、パスワードのないアカウントでは働きません（ソースコードでは、初めてパスワードを設定するときは確かめません）。Rise Path の登録画面はパスワードを作りますが、同じ Supabase プロジェクトのほかの入口で作ったアカウントには、パスワードがないことがあります。また、AI アプリのセッションは許可した時刻に作られるので、許可から 24 時間は確認のコードも求められません。つまり、**パスワードのないアカウントでは、許可から 24 時間のあいだ、AI アプリがパスワードを設定できます**。許可の画面は「許可する」の上に、このアプリがアカウントのサービスであなた自身と同じ力を持つこと、信頼できるアプリだけを許可することを出します。DCR をどうするか（手順 4）とあわせて、オーナーがこのリスクを受け入れるかを決めます（[`../brushup-2026/ai-access-plan.ja.md`](../brushup-2026/ai-access-plan.ja.md) の 5.3）。
- **アカウントの削除（Phase 4）**: この 3 つが on になり、手順 10 のパスワードの確かめ（`current_password_required`）が通るまで、`stack.env` の `ACCOUNT_DELETION_ENABLED=false` のままにします。AI アプリがパスワードを設定してログインすると、設定の「アカウントを削除する」で、その方の Rise Path のデータを消せてしまうためです（パスワードを入れ直す確認も、そのパスワードで通ってしまいます）。「Require current password when changing password」は、`byoa` を使わないときも、削除を on にする前に必ず on にします。ログインしたままの端末を持っている人も、同じ方法でパスワードを設定できるためです（[account-deletion-operations.ja.md](./account-deletion-operations.ja.md) の 7 章）。3 つを on にしても、上の「残るリスク」（パスワードのないアカウント、許可から 24 時間）は削除にも同じです（[account-deletion-operations.ja.md](./account-deletion-operations.ja.md) の 7 章）。
- **セッション**: Authentication → Sessions のアクセストークンの有効期間は 1 時間（既定）のままにし、リフレッシュトークンのローテーションと再利用の検出も既定のままにします。

### 7. VM: migration と最小権限の DB ロール

1. `main` の新しいコードで `./scripts/deploy-stack.sh` を一度実行し、migration 015（`mcp_oauth_grants`）と 016（`lesson_progress`、Phase 2）を当てます（まだ `byoa` は足しません）。
2. VM でリモート MCP 用のロールを作ります。`risepath_app` はスーパーユーザーなので、インターネットに出す `mcp-public` には渡しません。

   ```bash
   cd /opt/risepath/deploy/risepath-vm
   MCP_DB_PASSWORD="$(openssl rand -hex 24)"
   docker compose --env-file stack.env exec -T db \
     psql -U risepath_app -d risepath -v ON_ERROR_STOP=1 -v mcp_password="$MCP_DB_PASSWORD" \
     < sql/mcp_remote_role.sql
   ```

   このロールに渡すのは、リモートのツール、年齢の確認、1 日の上限、接続したアプリの記録に要る表と列だけです（一覧と理由は `sql/mcp_remote_role.sql` の先頭）。
   - いくつかの表は、要る列だけを渡します。安全の記録（`ai_safety_events`）は報告の文章（`detail`）を読めません。教材（`materials`）は題名や保存場所を読めず、`id`、`user_id`、`status` だけです。年齢と同意の表は、判定に使う列だけです。`mcp_oauth_grants` は `revoked_at` を書けず、`client_name` を読めません。書けるのは行の追加（`user_id`、`client_id`）と、`first_seen_at`、`last_used_at` の更新だけです。
   - 1 日の上限の表（`ai_daily_usage`）は、行ごとの守り（RLS）を on にします。このロールが読み書きできるのは、種類が `mcp` と `mcp_write` の行だけです。表の持ち主の `risepath_app`（VM ではスーパーユーザー）は RLS を通らないので、API はこれまでどおり動きます。持ち主でもスーパーユーザーでもないロールを別に足すと、そのロールのポリシーを作るまで、この表の行が見えません。
   - レッスンの進み具合（`lesson_progress`、Phase 2）は、読む・行を足す・書き換えるだけです。行を消せません。「学習の進み具合を消す」の記録（`lesson_progress_resets`）は読み書きできません。記録を消せるのは、学習者がアプリの画面で行う操作だけです。
   - ライフジャーナル、AI メモリ、性格のプロフィールなどの表は読めません。
   - あとの migration でリモートのツールに表や列が増えたら、SQL に足して実行し直します。実行し直すと、SQL にない権限は外れます。

   **Phase 4 の更新**: migration 018（`account_deletions` など）を当てたあとも、上と同じコマンドでロールの SQL を流し直します（パスワードは今の値）。018 は、ロールがあればその場で `account_deletions` を読む権限を渡しますが、流し直すと、これからもその権限が SQL のとおりに保たれます。`mcp-public` は、この表を読めないと AI アプリの呼び出しをすべて 503 で断ります（安全な側）。削除したアカウントの AI アプリは、削除の前のトークンでは断られるので、その方がまたログインしたあとに、つなぎ直す必要があります。

   **Phase 2 の更新（すでに `byoa` を動かしているとき）**: Phase 2 のコードで `./scripts/deploy-stack.sh` を実行すると、migration 016 が当たり、`mcp-public` も新しいツールで動き始めます。そのすぐあとに、上と同じコマンドでロールの SQL を流し直します。
   - SQL はパスワードも設定し直します。`MCP_DB_PASSWORD` には、新しい値ではなく、今の値を入れます。今の値は、`mcp-public.env` の `DATABASE_URL_PHASE1` の、`risepath_mcp_remote:` と `@` のあいだの文字です。新しい値を入れると、`mcp-public` がデータベースにつながらなくなります。
   - 流し直すまで、`course-quiz-check`、`course-progress-get`、`course-progress-update` は `permission_denied`（`server setup incomplete`）を返します。`course-list` と `course-lesson-get` は動きます。`docker compose --env-file stack.env logs mcp-public` に「re-run the role SQL after the migration」と出ていたら、この状態です。
   - 流し直したら、手順 10 の 1（MCP Inspector）でツールが 11 あることと、`course-progress-get` がエラーにならないことを確かめます。

3. `mcp-public.env` を作ります。

   ```bash
   cp mcp-public.env.example mcp-public.env && chmod 600 mcp-public.env
   nano mcp-public.env
   ```

   | 変数 | 入れる値 |
   |---|---|
   | `DATABASE_URL_PHASE1` | `postgresql://risepath_mcp_remote:<MCP_DB_PASSWORD>@db:5432/risepath` |
   | `SUPABASE_URL` | `stack.env` と同じ（`https://<ref>.supabase.co`） |
   | `SUPABASE_ANON_KEY` | Supabase の anon key（公開してよい鍵）。service_role key は入れません |
   | `MCP_PUBLIC_RESOURCE_URL` | `https://mcp.<domain>/mcp`。フックに入れた値と 1 文字もちがわないこと |
   | `MCP_ALLOWED_ORIGINS` | 空のまま（AI アプリはブラウザの Origin を付けずにつなぎます） |
   | `APP_PUBLIC_URL` | `https://app.<domain>`（断るときに、年齢の登録のページを案内します）。空のままでも動きます（案内のリンクが付きません） |

   ブリッジトークン、service_role key、Anthropic・Gemini・OpenRouter・Hermes・Memanto のキーは、このファイルに入れません。`mcp-public` は `stack.env` を読みません。

### 8. Cloudflare: `mcp.<domain>` を公開する

Cloudflare Zero Trust → **Networking → Tunnels** → 今のトンネル → **Routes** → **Add route** → **Published application**（<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/>）。

- サブドメイン `mcp`、ドメイン `<domain>`、Service URL `http://mcp-public:3200`。HTTP Host Header は空のまま（`mcp.<domain>` がそのまま届くようにします。`mcp-public` は、この名前以外の Host を 403 にします。手順 9 の確認で `/.well-known/...` が 403 になったら、ここに `mcp.<domain>` を入れます）。
- **Cloudflare Access（ログインの関門）を前に置きません。** AI アプリは Cloudflare のログイン画面を通れません。このホストの関門は OAuth です。
- **ボット対策のチャレンジを出さないようにします。** AI アプリはブラウザではないので、チャレンジに答えられません。
  - Bot Fight Mode（無料プラン）は off のままにします（[`deploy/vercel/README.md`](../../deploy/vercel/README.md) の手順 6 と同じ）。Bot Fight Mode は、ホスト名やパスごとに外せず、WAF のスキップのルールも効きません（<https://developers.cloudflare.com/bots/get-started/bot-fight-mode/>）。on にすると `mcp.<domain>` にも効きます。
  - Super Bot Fight Mode（有料プラン）とマネージドルールは、WAF のカスタムルールの「Skip」で、ホスト名 `mcp.<domain>` だけを外せます（<https://developers.cloudflare.com/waf/custom-rules/skip/>）。
  - Browser Integrity Check とセキュリティレベルのチャレンジも、このホストでは出さないようにします【要確認: 今の設定と外し方】。
- 1 回のツールの呼び出しは数秒で終わる作りです。Cloudflare の待ち時間の上限（約 100 秒と言われています【未検証】）には近づきません。

既存のルート `api.<domain>` → `http://api:3006` はそのままです。ルートが VM のホストやゲートウェイの IP を指さないようにします（ほかのポートにも届いてしまうため）。

### 9. デプロイ（プロファイル `byoa`）

1. `stack.env` の `COMPOSE_PROFILES` に `byoa` を足します（例: `tts,tunnel` → `tts,tunnel,byoa`）。`byoa` は `tunnel` と一緒に使います。
2. `./scripts/deploy-stack.sh` を実行します。`tunnel` がないとき、`mcp-public.env` がないか見本の値のままのとき、`mcp-public.env` に `stack.env` の秘密（ブリッジのトークン、service role キー、モデルや Memanto のキーなど）や `risepath_app` があるとき、`APP_PUBLIC_URL` が見本の値のときは、変数の名前だけを表示して止まります。`export ` を付けた行、`=` の前後に空白がある行、値を引用符でかこんだ行も、Docker Compose と同じように読んで確かめます。そのあと `mcp-public` が healthy になるまで待ちます。設定の誤り（末尾の `/`、`http://` など）で起動できないときは、デプロイが失敗します（`docker compose --env-file stack.env logs mcp-public` で理由を見ます）。
3. 確かめます。

   ```bash
   docker compose --env-file stack.env ps mcp-public          # healthy
   curl -s https://mcp.<domain>/.well-known/oauth-protected-resource/mcp
   # → {"resource":"https://mcp.<domain>/mcp","authorization_servers":["https://<ref>.supabase.co/auth/v1"],...}
   curl -s -o /dev/null -D - -X POST https://mcp.<domain>/mcp | grep -i '^www-authenticate'
   # → WWW-Authenticate: Bearer error="invalid_token", ..., resource_metadata="https://mcp.<domain>/.well-known/oauth-protected-resource/mcp"
   ```

   `resource` が `MCP_PUBLIC_RESOURCE_URL` と同じで、`authorization_servers` が Supabase の issuer（`<SUPABASE_URL>/auth/v1`）であることを見ます。Supabase のカスタムドメインを使っていても、issuer は `<ref>.supabase.co` のままです。

### 10. 実際の AI アプリで確かめる（スモークテスト）

ステージングで一度、本番の公開のあとにもう一度行います。テスト用に、18 歳以上のアカウントと、18 歳未満のアカウント（年月を登録したもの）、年月が未登録のアカウントを用意します。

1. **MCP Inspector**（<https://modelcontextprotocol.io/docs/tools/inspector>。`npx` で動かし、依存関係には足しません）

   ```bash
   npx @modelcontextprotocol/inspector --server-url https://mcp.<domain>/mcp --transport http
   ```

   ログインして許可したあと、ツールの一覧が 11（Phase 1 の `learner-state-get`、`learner-state-update`、`journal-log`、`journal-recent`、`rag-search`、`learner-adaptation-signals` と、Phase 2 の `course-list`、`course-lesson-get`、`course-quiz-check`、`course-progress-get`、`course-progress-update`）、リソースが `content://domains`、プロンプトが `socratic-tutor` だけであることを見ます。ブラウザから直接つなぐ設定で 403（Origin）が出たら、ステージングだけ `MCP_ALLOWED_ORIGINS` に Inspector の表示しているオリジンを足します。
2. **Claude Code**: `claude mcp add --transport http rise-path https://mcp.<domain>/mcp` → セッションの中で `/mcp` → ブラウザで許可（<https://code.claude.com/docs/en/mcp>）。
3. **Codex**: `~/.codex/config.toml` に `[mcp_servers.rise-path]` と `url` → `codex mcp login rise-path`（<https://developers.openai.com/codex/mcp>）。
4. **Claude.ai のカスタムコネクタ**: Customize → Connectors → Add custom connector に `https://mcp.<domain>/mcp`（<https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>）。
5. （使える環境なら）**ChatGPT**: chatgpt.com/plugins でカスタムの MCP サーバーを追加（<https://developers.openai.com/apps-sdk/deploy/connect-chatgpt>）。

それぞれで次を確かめ、結果（アプリ名、版、登録の方式、つながったか、プロトコルの版）を記録します。

- 許可の画面に、アプリ名・戻る先のホスト名・読めるもの・書けるもの・「サインイン中のアカウント」が出る。
- 18 歳以上: ツールが動く。`journal-recent` などで自分のデータだけが返る。
- 18 歳以上: `course-lesson-get`（例: `course_slug` に `vibe-coding`、`lesson_id` に `vibe-ch1`）の結果で、クイズの問題（`questions`）に、正解（`answer`）、解説（`explanation`）、ヒント（`hint`）、選択肢へのひとこと（`feedback`）が入っていない（手順やプロンプトの `hint` は出てかまいません）。`course-quiz-check` でまちがえると、選んだ選択肢へのひとこと（`feedback`）とヒントだけが返り、正解（`correct_labels`）は返らない。同じアカウントで、新しいタブで Web のそのレッスンを開くと、その答えが出ている。前から開いていたタブでも、ほかのウィンドウからブラウザに戻ると出る（そのタブが前にサーバーの記録を読んでから 1 分たたないと読み直さないので、1 分ほど待ってから戻る）。
- 18 歳未満: 許可の画面で「拒否」しか押せない。年月が未登録: 許可の画面に年月を登録する欄が出て、18 歳以上と登録するまで「許可」は出ない。
- すでに許可したアプリでも、呼び出しのときに 18 歳以上でなければ `adults_only` や `age_required` のエラーになる（Supabase は、一度許可したアプリには許可の画面を出さずに通すため、毎回 MCP サーバーで確かめています）。
- 「つないでいる AI アプリ」で解除して **10 秒ほど待ってから**呼ぶと、401 になり、AI アプリがログインをやり直す。MCP サーバーは「解除されていない」という答えを 5 秒まで覚えるので、解除の直後の呼び出しはまだ通ることがあります。
- 解除したアプリが「解除ずみ」の欄に、許可のときの名前で出る。一度も呼ばなかったアプリは、使った日が出ない。
- （ステージングで）AI アプリのアクセストークンで、パスワードのあるアカウントのパスワードを変えようとすると断られる（`current_password_required`）。トークンは、たとえば MCP Inspector が受け取ったものを使います【要確認: トークンの見方】。

  ```bash
  curl -s -X PUT "https://<staging-ref>.supabase.co/auth/v1/user" \
    -H "apikey: <staging の anon key>" -H "Authorization: Bearer <AI アプリのアクセストークン>" \
    -H "Content-Type: application/json" -d '{"password":"<テスト用の新しいパスワード>"}'
  ```
- 1 時間たってトークンが切れても、AI アプリが自動で更新して使い続けられる。
- アプリの API（`https://app.<domain>/api/...`）に AI アプリのトークンを送ると、401 `oauth_client_token` になる。

MCP サーバーは MCP の SDK 1.29（プロトコル 2025-11-25 まで）で動いています。2026-07-28 の新しい版だけを話すクライアントはつながりません。どのクライアントが古い版にも対応しているかは、このテストで確かめます。

### 11. 戻し方（ロールバック）

上から順に行います。最初に公開の入口を閉じます。

1. Cloudflare のトンネルの Routes から `mcp.<domain>` を消します。
2. VM で `mcp-public` を止めて消し、`stack.env` の `COMPOSE_PROFILES` から `byoa` を外します。

   ```bash
   cd /opt/risepath/deploy/risepath-vm
   docker compose --env-file stack.env --profile byoa rm -sf mcp-public
   ./scripts/deploy-stack.sh
   ```

   `COMPOSE_PROFILES` から外すだけでは、作成済みのコンテナが `restart: unless-stopped` で残ります。
3. 新しい登録を止めるときは、Supabase の OAuth Server で DCR を off にするか、OAuth サーバーそのものを無効にします。許可の画面は「まだ使えません」と表示します。
4. フックを止めるときは、Authentication → Hooks で Custom Access Token を無効にします。アプリのログインには影響しません。
5. DB のロールを止めるときは `ALTER ROLE risepath_mcp_remote NOLOGIN;` を実行します。`mcp_oauth_grants` の表と、学習者がつないだ記録は残ります。

JWT の署名鍵は ES256 のままにします（戻す必要はありません。古い秘密鍵は取り消していないので、今のキーもそのまま使えます）。

## 受け入れているリスク（ベータ版）

[`../brushup-2026/ai-access-plan.ja.md`](../brushup-2026/ai-access-plan.ja.md) の 5.3 にまとめています。
