# Supabase 側の設定（オーナーが適用）

Rise Path のデータは VM の Postgres にありますが、ログイン（Supabase Auth）は Supabase のプロジェクトにあります。このフォルダには、Supabase のプロジェクトで実行する SQL を置きます。`npm run db:migrate` では流れません（VM の DB の migration は `server/migrations/`）。

手順の全体と順番は [`doc/guides/byoa-setup.ja.md`](../../doc/guides/byoa-setup.ja.md) にあります。ここでは SQL のことだけを書きます。

## `custom_access_token_hook.sql`

Phase 1（大人が自分の AI をリモート MCP につなぐ）のための Custom Access Token Hook（アクセストークンを発行する前に呼ばれる Postgres の関数）です。

**なぜ要るか**: Supabase の OAuth 2.1 サーバー（ベータ）は、AI アプリ（OAuth クライアント）に発行するトークンにも、学習者自身のログインと同じ `aud`（宛先）`authenticated` を入れます。`resource`（RFC 8707）を指定しても、`aud` は変わりません。このままでは、AI アプリに渡したトークンが「どのサーバーあてか」を区別できません。この関数は、トークンに `client_id` があるとき（AI アプリに発行するときだけ）、`aud` を MCP の正規の URL（`MCP_PUBLIC_RESOURCE_URL`）に置き換えます。

- リモート MCP（`mcp-server/oauthVerifier.js`）は、`aud` がその URL のトークンだけを受け付けます。
- アプリの API（`server/middleware/auth.js`、`bridgeAuth.js`）は、`client_id` があるトークンと、`aud` が `authenticated` でないトークンを断ります（`tools/core/oauthToken.js`）。
- 学習者自身のログイン（`client_id` なし）は何も変えません。

`client_id` は `event.claims` の中にあります（トップレベルではありません）。コードの交換のときも、リフレッシュ（`authentication_method` が `token_refresh`）のときも入っているので、`client_id` だけを見ます。Supabase の文書の Deno の例はトップレベルの `client_id` を読んでいますが、このフックではその形にしていません（<https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook> の入力の例では `claims` の中です）。

### 適用のしかた

1. **ステージングのプロジェクトで先に行います。** このフックは、アプリと P-School のログインをふくむ、すべてのトークンの発行で動きます。エラーを出したり、Supabase が受け付けないクレームを返したりすると、**誰もログインできなくなります。**
2. ファイルの `https://mcp.example.org/mcp` を、`deploy/risepath-vm/mcp-public.env` の `MCP_PUBLIC_RESOURCE_URL` と 1 文字もちがわない値に置き換えます（https、パス `/mcp`、最後に `/` を付けない）。
3. Supabase ダッシュボードの SQL Editor で、ファイルの中身を実行します。
4. ファイルの最後にある 2 つの `select`（コメントになっています）を実行して確かめます。1 つ目は MCP の URL、2 つ目は `authenticated` が返れば正しいです。
5. Authentication → Hooks（Auth Hooks）で Custom Access Token を有効にし、Postgres の関数 `public.risepath_mcp_access_token_hook` を選びます。
6. アプリにログインし直して、ふつうに使えることを確かめます。

1 つのプロジェクトに Custom Access Token Hook は 1 つだけです。すでに別のフックを使っているなら、置き換えずに、この処理をそのフックに足します。

関数は表を読まないので、`security definer` を付けていません（Supabase も付けないことをすすめています。<https://supabase.com/docs/guides/auth/auth-hooks>）。実行の権限は `supabase_auth_admin` だけに与え、`authenticated`・`anon`・`public` からは外しています。

### 戻し方

Authentication → Hooks で Custom Access Token を無効にします。アプリのログインはそのまま使えます。AI アプリは、新しいトークンの `aud` が `authenticated` に戻るので、リモート MCP から 401 を受けます（安全な側に倒れます）。関数を消すときは、先にフックを無効にしてから `drop function public.risepath_mcp_access_token_hook(jsonb);` を実行します。

## 要確認: P-School の表と AI アプリのトークン

AI アプリに発行したトークンも `role` は `authenticated` です。P-School は同じ Supabase のプロジェクトの表（`profiles`、`battle_records`）を、ブラウザから Supabase の Data API で読み書きしています。Data API が `aud` を確かめるかどうかは確かめていません。AI アプリのトークンでこれらの表を変えられないようにするには、RLS（行ごとのアクセス制御）の各ポリシーに次の条件を足す方法があります（<https://supabase.com/docs/guides/auth/oauth-server/token-security>）。

```sql
-- 例: 既存のポリシーの using / with check に足す条件
(auth.jwt() ->> 'client_id') is null
```

今の RLS の設定はリポジトリにありません。オーナーがダッシュボードで今のポリシーを確かめてから、ステージングで試します。P-School のコードは変えません。

## 要確認: AI アプリのトークンでのパスワードとメールアドレスの変更

AI アプリのトークンでも、Supabase Auth の `/user` でパスワードの設定やメールアドレスの変更を呼べます（ソースコードを読んだかぎり。本番では未検証）。この SQL やフックでは防げません。Authentication → Sign In / Providers → Email の設定で防ぎます。設定の名前と、それでも残るリスク（パスワードのないアカウントで、許可から 24 時間）は、[`doc/guides/byoa-setup.ja.md`](../../doc/guides/byoa-setup.ja.md) の手順 6 にあります。

**アカウントの削除（Phase 4）も同じ前提です。** AI アプリがパスワードを設定してログインすると、設定の「アカウントを削除する」でその方の Rise Path のデータを消せます。なので、`byoa`（`mcp-public`）を動かす、または動かす予定のあいだは、この 3 つの設定を入れてステージングで確かめる（byoa-setup.ja.md の手順 10）まで、API の `ACCOUNT_DELETION_ENABLED=false` のままにします。
