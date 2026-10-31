# 最初の公開の手順書（Rise Path）

> この手順書は作成中です（Phase 9）。いまは章と手順の見出し、10.1〜10.4（試験運用の名簿）、13 章（事前チェックと確かめのコード）と 14 章（公開の記録）だけがあります。手順の中身は、Phase 9 の作業が進むにつれて書き足します。まだ書いていない手順は、エージェントと一緒に進めます。

- 作成日: 2026-10-30（Phase 9）
- 対象: Rise Path のオーナー（NPO の担当の方）と、手伝うエージェント
- 関連: 決定の記録 [../brushup-2026/ai-access-plan.ja.md](../brushup-2026/ai-access-plan.ja.md)、VM の README [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md)、Vercel の手順 [../../deploy/vercel/README.md](../../deploy/vercel/README.md)

## はじめに

この手順書は、新しい VM を作ってから、一般の登録を開くまでを、1 つずつの手順にまとめたものです。手順の番号は「章.番号」（例: 5.3）で、ほかの場所からは「手順書 5.3」と呼びます。

- 公開の段階（`LAUNCH_STAGE`）は、setup → pilot → minors → public の順に進みます。minors は、18 歳未満が使うと決めたときだけ書きます（ふつうは pilot の次が public です）。pilot の次が public でも、public の前に、18 歳未満が使うときの決まりを決めます（14 章の `MINORS_POLICY_DECIDED`）。いまの段階は、VM の `deploy/risepath-vm/launch-record.env` に書きます（14 章）。
- launch-record.env は、オーナーの記録です。証明ではありません。確かめをした日を書きます。
- 秘密の値（パスワード、鍵、URL のトークン）は、チャット、issue、git に貼りません。
- 事前チェック（`preflight.sh`）は、設定のまちがいを、値を出さずに名前とコードで知らせます。コードの意味と直し方は 13 章にあります。

## 1. 決めたこと（2026-10-30）

## 2. 始める前に

### 2.1 決めたことを読む

### 2.2 部品の弱点を直すプルリクエスト（D6）が main に入っていることを見る

### 2.3 （済み）Supabase が答えないときの 503

### 2.4 main のルールセットを作る

### 2.5 GitHub のセキュリティの設定を入れる

### 2.6 Vercel を確かめ、本番にも保護をかける（D5）

### 2.7 古い VM（nexloom-gce）に Rise Path の DB が残っているかを見る

### 2.8 main のチェックが緑かを見る

## 3. アカウントと管理画面

### 3.1 ドメインを決める

### 3.2 Cloudflare にドメインを入れる

### 3.3 GCP の予算アラートを入れる

### 3.4 Tailscale の古い機械を消し、ACL を決める

### 3.5 Anthropic の鍵を作り、使う上限を決める

### 3.6 Slack に安全の知らせの受け口を作る

### 3.7 Supabase の今の設定を書き写す

### 3.8 控え用のバケットとサービスアカウントを作る

## 4. VM を作る

### 4.1 VM を作る

### 4.2 削除の保護を入れる

### 4.3 ファイアウォールを確かめる

### 4.4 OS Login の sudo を確かめる

### 4.5 VM に入り、リポジトリを置き、1 回目の準備をする

## 5. 設定のファイルと事前チェック

### 5.1 stack.env を書く

### 5.2 公開の記録（launch-record.env）を作る

### 5.3 事前チェックをする

### 5.4 （2.7 で残っていたときだけ）古いデータを戻す

## 6. 最初のデプロイ（Tailscale だけ）と控え

### 6.1 最初のデプロイをする

### 6.2 事後の確かめをもう一度する

### 6.3 Mac から Tailscale で確かめる

### 6.4 毎日の控え（バックアップ）を動かす

### 6.5 最初の戻す練習をする

## 7. 公開の入り口（Cloudflare トンネル）

### 7.1 トンネルを作る

### 7.2 api の入り口の設定を変える

### 7.3 tunnel.env を書く

### 7.4 公開の入り口の値を stack.env に書く

### 7.5 トンネルを入れてデプロイする

### 7.6 外から直接 api に入れないことを確かめる

## 8. テスト用のアカウント、Vercel、最初のサインイン

### 8.1 テスト用のアカウントを作る

### 8.2 （8.4 にまとめました）

この手順は 8.4 にまとめました。ここでは何もしません。

### 8.3 Vercel の本番の環境変数を書く

### 8.4 Redeploy して、app のアドレスの保護を確かめる

### 8.5 最初のサインインと、管理者にする

## 9. ほかの人が入る前の確かめ

### 9.1 （10.3 の最後に移しました）

外からの確かめ（`npm run smoke:edge`）は、Vercel の保護を外したあと（10.3 の最後）にします。ここでは何もしません。

### 9.2 ブラウザで確かめる

### 9.3 AI の質を確かめる

### 9.4 試しの知らせを送る

### 9.5 Mac の .env.local を開発用の DB にする

### 9.6 公開の段階を pilot にする

## 10. 試験運用（スタッフと大人のテスターだけ）

試験運用のあいだ、Rise Path を使えるのは、スタッフと大人のテスターだけです（1 章の D1）。アプリの新規登録は、コードで閉じています（ログインの画面に「新規登録」はありません）。それでも、Supabase は Nexloom・P-School と共有なので、そのアカウント（子どものものも）ではログインできてしまいます。そこで、サーバーに試験運用の名簿（`PILOT_ACCOUNT_IDS`）を入れ、名簿にない人には「このアカウントは、いまの試験運用の対象ではありません」のページを出します。名簿を入れて確かめてから（10.1・10.2）、Vercel の保護を外します（10.3）。

### 10.1 試験運用の名簿を入れる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Supabase の画面と VM（SSH）
- 先に済ませること: 9.6
- やること:
  1. Supabase の Authentication → Users を開き、名簿に入れる人の User UID（`8-4-4-4-12` の形の ID）を写します。入れる人: 自分（8.5 で書き留めたもの）、安全の知らせを見る人と管理者（管理のページも名簿で守られます）、スタッフ、8.1 の大人のテスト用のアカウントです。8.1 のダミーと、18 歳未満のテスト用のアカウントは入れません。
  2. VM で `cd /opt/risepath/deploy/risepath-vm && nano stack.env` を実行し、いちばん下に `PILOT_ACCOUNT_IDS=` の 1 行を足して、= のうしろに User UID をカンマで区切って続けます（空白は入れません。例: `PILOT_ACCOUNT_IDS=<1 人目の User UID>,<2 人目の User UID>`）。保存は Ctrl+O と Enter、終わるのは Ctrl+X です。
  3. GitHub の main のいちばん上のコミットに緑の ✓ があることを見て、その 7 文字（例: `a1b2c3d`）を書き留めます。
  4. sudo を付けずに `./scripts/deploy-stack.sh` を実行します。途中に出る「==> デプロイするコミット: …」の 7 文字が、3 で書き留めた 7 文字と同じことを見ます。
  5. `docker compose --env-file stack.env logs api | grep '\[Pilot\]'` を実行します。
- うまくいったとき: 4 で「==> Done」と、事後の確かめの「エラー 0 件」が出ます。5 で「[Pilot] on: N accounts」が出ます。N は名簿にある User UID の数です（同じ User UID を 2 回書いたときは、1 と数えます）。名簿が効いていることは、次の 10.2 で確かめます。
- うまくいかないとき: 事前チェックで「[V2]」が出たら、その番号の項目が ID の形ではありません。Supabase から User UID を写し直します。「[A5]」が出たら、名簿に空白か記号が入っています。3 で ✓ がないときや、4 で 7 文字がちがうときは、そこで止めてエージェントに聞きます。5 で「[Pilot] off」と出たら、`PILOT_ACCOUNT_IDS` の名前のつづりを見直して、もう一度 4 をします。5 で N が、入れたい人の数より少ないときは、同じ User UID を 2 回書いていないか、書きもらした人がいないかを見ます。ほかのコードは 13 章で見ます。わからないときは、出た行をそのままエージェントに見せます（値は出ません）。
- くわしく: 13 章の V1・V2、`deploy/risepath-vm/stack.env.example` の「Pilot list」

### 10.2 名簿を確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、自分のブラウザ（Vercel にログインしているもの。Vercel の保護はまだかけたままです）
- 先に済ませること: 10.1
- やること:
  1. `https://app.<domain>` を開きます（`<domain>` は 3.1 で決めたドメインです）。自分のアカウントでログインしたままのときは、左のメニューのいちばん下の「ログアウト」を押して、先にログアウトします。
  2. はじめのページの右上の「ログイン」を押し、8.1 のダミーのアカウントでログインします。
  3. 出たページの「ログアウト」を押します。
  4. もう一度「ログイン」を押し、8.1 の大人のテスト用のアカウントでログインします。
- うまくいったとき: 2 で「このアカウントは、いまの試験運用の対象ではありません」のページが出ます。4 では、ふだんのホームが出て、レッスンを開けます。
- うまくいかないとき: 2 でダミーのアカウントでも使えてしまったら、ここで止めて、エージェントに見せます（Vercel の保護は外しません）。4 で大人のテスト用でも「対象ではありません」が出たら、10.1 の 2 で User UID を直し、10.1 の 3 からもう一度します。1 で、自分のアカウントに「対象ではありません」が出たときも同じです（自分の User UID は 8.5 で書き留めたものです。そのページの「ログアウト」を押すと、2 に進めます）。
- くわしく: 13 章の V1

### 10.3 Vercel の保護を外し、外から確かめる

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: VERCEL_PROTECTION_OFF）
- だれが・どこで: オーナー、Vercel の画面、VM（SSH）、Mac のターミナル
- 先に済ませること: 10.2
- やること:
  1. Vercel の `rise-path` の Settings → Deployment Protection で、範囲を「Standard Protection」に戻します（プレビューは守られたまま、本番のドメインが開きます）。
  2. Vercel にログインしていないブラウザ（プライベートウィンドウ）で `https://app.<domain>` を開きます。
  3. VM で `cd /opt/risepath/deploy/risepath-vm && nano launch-record.env` を実行し、`VERCEL_PROTECTION_OFF=` の = のうしろに今日の日付を書きます（例: `VERCEL_PROTECTION_OFF=2026-11-20`）。保存して、sudo を付けずに `./scripts/preflight.sh` を実行します。
  4. Mac のターミナルで、Rise Path のリポジトリのフォルダ（`package.json` があるいちばん上のフォルダ）に `cd` で移り、`PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge` を実行します（`<domain>` は 3.1 で決めたドメインに置きかえます）。
- うまくいったとき: 2 で Rise Path のはじめのページ（右上に「ログイン」のボタンがあるページ）が出ます。Vercel のログインの画面ではありません。「ログイン」を押しても、「新規登録」はありません。3 で「エラー 0 件」が出ます。4 で「0 failed」が出ます。
- うまくいかないとき: 2 で Vercel のログインの画面が出たら、1 の範囲をもう一度見ます。3 で「[V1]」が出たら、名簿が読めていません。Vercel の保護を 2.6 のとおりにかけ直し、`VERCEL_PROTECTION_OFF` を空に戻してから、10.1 を見直します。4 で「Missing script」や「package.json」の行が出たら、フォルダがちがいます。4 のフォルダに移って、もう一度します。4 で ❌ が出たら、番号と出た行をエージェントに見せます。テスターは、ここまで済むまで足しません。
- くわしく: 13 章の V1・V3、`deploy/vercel/README.md`

### 10.4 テスターを足す

- [ ] 済んだ日: ＿＿＿＿（テスターを足した日を、そのたびに書きます）
- だれが・どこで: オーナー、Supabase の画面と VM（SSH）
- 先に済ませること: 10.3
- やること:
  1. 8.1 と同じ方法で、テスターのアカウントを作ります（Authentication → Users の「Add user → Create new user」、「Auto Confirm User」に印。パスワードはパスワード管理の生成で作ります）。パスワードは、会って、または電話で伝えます（メールアドレスと同じメッセージでは送りません）。Nexloom や P-School のアカウントをすでに持っているスタッフは、作らずにその User UID を使います。
  2. VM で `cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env logs api | grep '\[Pilot\]'` を実行し、「[Pilot] on: N accounts」の N（いま名簿にある人数）を書き留めます。
  3. `nano stack.env` を実行し、`PILOT_ACCOUNT_IDS` の行のいちばん最後に、カンマに続けてその人の User UID を足します（空白は入れません）。
  4. 10.1 の 3 と 4 と同じように、✓ と 7 文字を見てから `./scripts/deploy-stack.sh` を実行します。**デプロイは、そのときの main の新しいコミットも入れ、アプリが 1 分ほど止まります。授業や学習の時間を避けます。**
  5. デプロイが済んだら、2 のコマンドをもう一度実行し、N を見ます。
  6. テスターが抜けるとき: 名簿から消す前に、その人に、Rise Path の学習の記録を消すかどうかを聞きます。次に、2 のとおりに N を書き留め、3 のとおりに stack.env を開いて、その User UID と、そのとなりのカンマを 1 つ消し、4 のとおりにデプロイします（そのあとは、その人がログインしても使えず、何も記録されません）。5 のとおりに、N が 1 つ減ったことを見ます。減っていないときは、ここで止めて、記録は消さずに、エージェントに聞きます。記録を消すと決めたときは、N が減ったのを見てから、エージェントと一緒に VM で `scripts/delete-account-data.mjs` を使います（手順書 18 章）。
- うまくいったとき: 足したときは、5 の N が、2 で書き留めた N より 1 つ多くなっています。テスターがログインすると、ふだんのホームが出ます。抜けたときは、6 で N が 1 つ減ります（その人がログインしても、「このアカウントは、いまの試験運用の対象ではありません」のページが出ます）。
- うまくいかないとき: テスターに「このアカウントは、いまの試験運用の対象ではありません」が出たら、3 で名簿の User UID を見直して、4 をもう一度します。5 で N が増えないときは、4 で「==> Done」が出たかを見ます。出ていたら、その User UID が、もう名簿に入っていないかを見ます（同じ User UID は 1 と数えます）。6 で N が減らないときは、記録を消さずに、エージェントに聞きます。事前チェックのコードは 13 章で見ます。
- くわしく: 8.1、13 章の V2

### 10.5 安全の知らせを見始める

### 10.6 外からの死活監視を始める

### 10.7 拠点のスタッフに説明する

### 10.8 戻ってくる学習者に知らせる

## 11. 一般の登録を開く前に

### 11.1 弁護士の確認と、法務の文の準備

### 11.2 ご本人の削除を有効にする（エージェントと一緒に）

### 11.3 法務の版を、すぐに VM にデプロイする

### 11.4 確認のメールを入れる

### 11.5 Supabase の Redirect URL を足す

### 11.6 問い合わせ先を決める

### 11.7 消えたログインの一覧を 1 回見る

### 11.8 一般公開の前の事前チェック

## 12. 公開の日と、そのあと

### 12.1 公開する

### 12.2 公開のあとの確かめ

### 12.3 あとで決めること

### 12.4 ふだんの作業

## 13. 事前チェックと確かめのコード

事前チェック（`deploy/risepath-vm/scripts/preflight.sh`）が出すコードです。「表示」は画面に出る文のとおりです（{names} には設定の名前、{file} にはファイルの名前、{line} には行の番号、{gb} には GB の数、{n} には何個目かの番号が入ります。値は出ません）。種類が「エラー」のものがあると、デプロイは止まります。「注意」と「お知らせ」では止まりません。

- 事前チェックは、sudo を付けずに `cd /opt/risepath/deploy/risepath-vm && ./scripts/preflight.sh` で実行します。何も変えません。
- 段階（setup・pilot・minors・public）は、launch-record.env の `LAUNCH_STAGE` です（14 章）。
- わからないときは、出た行をそのままエージェントに見せます（値は出ません）。
- DB0・DB1 と P で始まるコードは、デプロイ（`deploy-stack.sh`）の中と、そのあとの確かめ（事後の確かめ、`deploy/risepath-vm/scripts/postdeploy-check.sh`）が出します。事後の確かめは、デプロイの最後に自動で動きます。あとからもう一度見るときは、sudo を付けずに `cd /opt/risepath/deploy/risepath-vm && ./scripts/postdeploy-check.sh` で実行します（何も変えません）。P のエラーは、デプロイが Rise Path を新しい版に入れ替えたあとに見つかったものです（Rise Path は動いたままです。P5 は、部品が動き出すのを待つところで出ることもあります）。
- VB で始まるコードは、VM ではなく、Vercel のビルドが出します（Phase 9 の Vercel の確かめ。Vercel の画面の、そのデプロイのビルドのログに、`vercel-env-guard` の名前とコードが付いた英語の行で出ます。値は出ません）。見るのは Vercel の Environment Variables の名前です。エラーがあると、そのビルドは止まり、いま公開している版がそのまま動きます。直したら、Vercel の画面で Redeploy します。注意では止まりません。Redeploy のビルドが最後まで進み（Vercel の画面で Ready になります）、ログにその VB の行が出なければ、直っています。また出るときは、出た行をそのままエージェントに見せます（値は出ません）。VB の確かめは、一般向けのアプリの Vercel のプロジェクトのためのものです。

| コード | 種類 | 表示 | 説明 | 直し方 |
|---|---|---|---|---|
| A1 | エラー | stack.env がありません。 | デプロイと事前チェックは、この VM の設定を stack.env から読みます。 | `cp stack.env.example stack.env && chmod 600 stack.env` を実行し、手順書 5.1 のとおりに書きます。 |
| A2 | エラー | CI 用のファイル（ダミーの値）が、VM の設定に入っています（{file}） | CI のダミーの値のままでは、ログインも AI も動きません。 | `deploy/risepath-vm/ci/` のファイルは VM では使いません。`stack.env.example` から作り直します。 |
| A3 | エラー | {file} の改行が Windows の形（CRLF）です。 | Windows のメモ帳などで保存すると、行の終わりに見えない文字が付き、シェルがそれを命令として読みます。 | VM で `sed -i 's/\r$//' {file}` を実行します。 |
| A4 | 注意（launch-record.env で、14 章の名前が 2 回あるときはエラー） | {file} に同じ名前が 2 回あります（{names}） | 同じ名前が 2 つあると、どちらの値が使われるかが、読む道具によってちがいます。launch-record.env では下の行が使われるので、14 章の名前が 2 回あるとエラーです（日付を書いた行の下にテンプレの空の行が残っていると、その確かめは「まだ」と読まれます）。日付は、その名前の行の = のうしろに書きます。 | 1 つだけ残します（launch-record.env では、いまの状態に合う行を残し、テンプレの空の行や古い行を消します）。 |
| A5 | エラー | {file} の {names} の値に、記号（$、空白、引用符など）があります（シェルが値を書きかえるか、命令として実行します） | stack.env は、デプロイのときにシェルが読みます。記号があると、値が変わったり、値が画面に出たりします。ほかのファイル（tunnel.env など）も、Compose が $ などを書きかえます。日本語入力の全角の空白も同じです（Compose は値の最後の全角の空白を消し、シェルは消さないので、値が変わります）。空の値のうしろや、タブのうしろに # を書いたときも、シェルと Compose で値がちがうので、エラーです。 | `openssl rand -hex 32` のような英数字だけの値にします。どうしても記号が要るときは、値を ' ' で囲みます。stack.env の `PILOT_ACCOUNT_IDS` のときは、空白を消し、User UID をカンマだけで区切ります（手順書 10.1）。 |
| A6 | 注意 | 知らない名前があります（打ちまちがいかもしれません）: {names}（{file}） | 名前を打ちまちがえると、その設定は使われません。 | `{file}.example` とくらべて直すか、要らない行なら消します。 |
| A7 | 注意（読めないときはエラー） | {file} の権限が 600 でないか、持ち主がちがいます。 | 秘密の値のファイルは、デプロイする人だけが読めるようにします。デプロイする人が読めないとき（sudo で作ったときなど）は、確かめもデプロイもできないので、エラーです。 | `chmod 600 {file}` を実行します。`Operation not permitted` と出たとき（sudo で作ったファイル）は、エージェントに相談します。 |
| A8 | エラー | {names} が、ちがうファイルに入っています（{file}） | ちがうファイルに書くと、その値がほかのコンテナにも渡ります。billing.env の名前は api にも渡り、stack.env の同じ名前より強くなります。 | `TUNNEL_TOKEN` は tunnel.env だけ、`STRIPE_`・`BILLING_` は billing.env だけに書きます。billing.env には、ほかに `AI_CAP_SUPPORTER_GLOBAL_` の名前だけを書けます。 |
| A9 | エラー | {file} の {line} 行目が読めません（「名前=値」の形ではありません） | 値だけを貼った行や「名前: 値」の行は、シェルが命令として実行し、その行を画面に出します。nano では、保存は Ctrl+O と Enter、終わるのは Ctrl+X です。 | `nano +{line} {file}` で開き、その行を直すか消します（値だけを貼った行かもしれません）。 |
| A10 | 注意（14 章の名前と 1〜2 文字だけちがうときはエラー） | launch-record.env に知らない名前があります（{names}） | 名前を打ちまちがえると、その記録は読まれません。14 章の名前と 1〜2 文字だけちがう名前（大文字と小文字のちがいも）は、打ちまちがいとみてエラーにします（たとえば保護を外した日が読まれないと、V1 の確かめが働きません）。 | 手順書 14 章の表とくらべて直します。 |
| A11 | エラー | launch-record.env の {names} が読めません（日付は 2026-11-02 の形、段階は setup・pilot・minors・public） | 日付と段階は、決まった書き方でないと読めません。数字と - と = は半角で書きます（全角の数字は読めません）。段階は名前だけを書き、前やうしろに空白（日本語入力の全角の空白も）や、ほかの言葉（`setup → pilot` など）を入れません（うしろの「 # メモ」は書けます）。key id は 0〜9 と a〜f の 16 文字（手順書 6.4 で出たまま）、見る人と頻度は 80 文字までの 1 行です。 | 手順書 14 章の書き方に直します。 |
| A12 | エラー | launch-record.env の {names} の日付が、今日より先です。 | まだしていない確かめの日付は書きません。 | 確かめをした日を書きます。 |
| A13 | 最初のデプロイの前で tunnel がないときは注意、ほかはエラー | launch-record.env がありません。 | 公開の記録がないと、どの段階の決まりで確かめるかがわかりません。 | `cp launch-record.env.example launch-record.env` を実行し、手順書のチェックの横に書いた日付を写します（手順書 14 章）。 |
| A14 | 注意 | {file} の {names} の値に # があります（前に空白があると、そこから先が消えます） | 値に # があると、どこまでが値か、読みまちがえやすくなります。値のうしろに空白と # を書くと、そこから先はメモとして消えます（シェルも Compose も同じです）。空の値のうしろや、タブのうしろの # は、シェルと Compose で読み方がちがうので、A5 のエラーです。 | 英数字だけの値にします。 |
| A15 | エラー | 最後に通ったデプロイの記録（.deploy/last-green.json）が読めません。 | デプロイが通るたびに、VM がこの記録を残します。読めないと、stack.env が変わったか（F5）や、最初のデプロイの前か（A13）がわからないので、エラーです。自分で sudo を使って直さず、エージェントと一緒に直します。 | `ls -ld .deploy .deploy/last-green.json` を実行し、出た行をエージェントに見せます（sudo でデプロイしたあとなどに起こります）。 |
| B1 | エラー | まだテンプレの値か、空です（{names}） | テンプレの値のままでは、ログインや DB が正しく動きません。 | `stack.env.example` のコメントと手順書 5.1 のとおりに作ります。`POSTGRES_PASSWORD` は最初の起動で固定されるので、いま決めます（`openssl rand -hex 24`）。 |
| B2 | エラー | `ANTHROPIC_API_KEY` が空です（AI の機能が動きません） | 鍵がないと、AI のチューターや作文のフィードバックが動きません。 | Anthropic のコンソールで、この VM 用の鍵を作って書きます（手順書 3.5）。 |
| B3 | エラー | 本番の値ではありません（{names}） | 本番の VM は、本番の決まり（ログインが要る、デモのデータを使わない）で動かします。 | stack.env で `NODE_ENV=production`、`VITE_DEMO_MODE=false` にするか、その行を消します。 |
| B4 | エラー | tunnel を使うのに、足りない値があります（{names}） | トンネルで外に出すには、入り口の秘密と、使ってよいアドレスが要ります。 | 手順書 7.3〜7.4 のとおりに書くか、`COMPOSE_PROFILES` から tunnel を外します。 |
| B5 | エラー | byoa に足りない値か、入れてはいけない値があります（{names}） | AI アプリの接続は、専用のファイルと、権限をしぼった DB のユーザーで動かします。 | `doc/guides/byoa-setup.ja.md` のとおりに直すか、byoa を外します。 |
| B6 | エラー | ポートの番号を変えています（{names}） | ポートの番号は、ほかの部品と合わせて決めてあります。 | stack.env のこの行を消します。 |
| B7 | 注意 | `COMPOSE_PROFILES` が stack.env にありません（再起動のとき、読み上げやトンネルが動かないことがあります） | VM を再起動したときは、stack.env の `COMPOSE_PROFILES` だけが読まれます。 | `COMPOSE_PROFILES=tts`（手順書 7.4 のあとは `tts,tunnel`）を書きます。 |
| C1 | エラー | `GEMINI_ALLOWED=true` になっています（18 歳未満が使うサービスでは Gemini を使いません） | Gemini の規約は、18 歳未満が使うサービスでの利用を認めていません。 | stack.env のこの行を消します。 |
| C2 | 注意 | Gemini の鍵が入っています: {names}（使われませんが、空にする決まりです） | Gemini は使わない決まりなので、鍵を置いておく理由がありません。 | stack.env の、その値を空にします。 |
| C3 | エラー | `LLM_GUEST_AI=true` になっています（ログインしない人が、年齢の確かめなしで AI を使えます） | ログインしない人の AI は、年齢と同意の確かめを通りません。 | stack.env のこの行を消します。 |
| C4 | エラー | AI の行き先を、本番で使わない設定にしています（{names}） | 本番の AI は Anthropic（Claude）だけを使います。 | stack.env のこの行を消します。 |
| C5 | 注意 | `ANTHROPIC_BASE_URL` が入っています（AI に送る文が、すべてそのアドレスに行きます） | このアドレスを変えると、学習者の文がほかの場所に送られます。 | 決めた理由がなければ、stack.env のこの行を消します。 |
| C6 | エラー | 学習者向けの VM で使わない設定があります（{names}） | 開発や、ほかのデプロイ（職業訓練、エージェント）のための設定です。 | stack.env のこの行を消します。 |
| C7 | エラー | 運用者用のセッションの値が入っています（{names}） | 運用者のセッションの値が漏れると、ほかの人として道具が動きます。 | stack.env のこの行を消します。 |
| C8 | エラー | デプロイの道具（Compose、Docker、git、シェル）の動きを変える名前があります: {names}（空の DB で動き出すか、ちがうプログラムが動くおそれがあります） | stack.env の名前は、デプロイのあいだ git や Docker にも渡ります。プロジェクトの名前が変わると空の DB で動き出し、ほかの名前では、ちがう Docker やプログラムが使われます。 | stack.env のこの行を消します。 |
| C9 | エラー | デプロイやテストの道具だけが使う名前があります（{names}） | これらの名前は、デプロイやテストの道具が中で使います。stack.env にあると、動きが変わります。 | stack.env のこの行を消します（`RISEPATH_STRICT_AUTH` は `true` のときだけ書けます）。 |
| C10 | エラー | 保存期間の設定が正しくありません: {names}（その削除が止まり、プライバシーポリシーの約束を守れません） | 決めた期間がすぎた記録を消す仕組みが、止まってしまいます。 | stack.env のその行を消すか、`stack.env.example` の範囲の整数にします。 |
| C11 | `true` はエラー、tunnel を使うのに `1` でないときは注意 | `TRUST_PROXY` の値が正しくありません。 | `true` にすると、だれでも送り元のアドレスを偽れます。 | `true` は使いません。トンネルを使うときは `TRUST_PROXY=1` に、使わないときは stack.env のこの行を消します。 |
| C12 | 注意 | `ORIGIN_SECRET_PREVIOUS` が残っています（取り替えが終わっていません） | 古い秘密の値が残っていると、その値でも入れてしまいます。 | Vercel の値が新しくなったのを確かめてから、stack.env のこの行を消します（手順書 15 章）。 |
| C13 | 注意 | 使わない Hermes の値が、テンプレのまま入っています（{names}） | Hermes は学習者には出さないので、テンプレの値は空にします。 | stack.env の、その値を空にします。 |
| C14 | 注意 | 「ちょうど true」でないと動かない切り替えに、ちがう書き方があります: {names}（止まったままです） | これらの切り替えは、小文字の `true` だけで入ります。ほかの書き方では止まったままです（`MEMANTO_ENABLED` は逆で、`false` 以外は入ります。S3 が見ます）。 | 使わないなら、その行（stack.env か billing.env）を消します。 |
| C15 | エラー | 切り替えの値が読めません（{names}） | 読めない値のときは、止まったままになります（API はログに注意を出します）。 | `true` か `false` にします。 |
| C17 | 注意 | `RP_LESSON_FS_WRITE` が入っています。 | 本番では、教材の下書きをファイルに書きません。 | stack.env のこの行を消します。 |
| D1 | エラー（ほかの https のアドレスは注意） | `SUPABASE_URL` が `https://<ref>.supabase.co` の形ではありません（{file}） | ちがう形のアドレスだと、ログインの確かめができません。 | Supabase の Project Settings → API の Project URL をそのまま書きます。 |
| D2 | エラー | `DATABASE_URL_PHASE1` が `POSTGRES_*` と合っていません（{names}） | DB のユーザー、パスワード、DB の名前は、2 つの場所で同じにします。 | `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>` の形にします。 |
| D3 | エラー | 短すぎる値があります（{names}） | 短い秘密の値は、当てられやすくなります。 | `openssl rand -hex 32` で作り直します（`POSTGRES_PASSWORD` は `-hex 24`。ただし最初の起動のあとの `POSTGRES_PASSWORD` は変えずに、エージェントに相談します）。 |
| D4 | エラー | ちがう名前に、同じ値が入っています（{names}） | 1 つの値が漏れたときに、ほかの場所まで開かないようにします。 | それぞれ別に作ります。`POSTGRES_PASSWORD` は変えずに、ほかの名前の値を作り直します（最初の起動のあと DB のパスワードを変えるときは、エージェントに相談します）。 |
| D6 | エラー | `LLM_ALLOWED_ORIGINS` の書き方が正しくありません。 | ここに書いたアドレスのブラウザだけが、API を呼べます。 | `https://app.<ドメイン>` の形にします。 |
| D9 | エラー | 知らせの受け口が https ではありません: {names}（知らせが届きません） | https でない受け口には、API は知らせを送りません。 | Slack の Incoming Webhook の URL（`https://hooks.slack.com/…`）を書きます。 |
| E5 | エラー | `MEMANTO_SECRET_KEY` があるのに `MEMANTO_ENABLED=true` がありません。 | Memanto を使わないのに、その鍵だけが残っています。 | stack.env の `MEMANTO_SECRET_KEY` を空にします。 |
| F1 | エラー | `COMPOSE_PROFILES` に知らない名前があります。 | 知らない名前は Compose に無視され、思った部品が動きません。 | 使えるのは tts・tunnel・byoa・memory です（最初の公開は tts と tunnel だけ）。 |
| F3 | 注意 | 使っていない機能のコンテナが動いたままです（{names}） | 止めたつもりの部品が、動いたままです。 | 手順書 17 章の止め方で止めます。 |
| F5 | 注意（事前チェックだけを実行したとき） | stack.env が、最後に通ったデプロイのあとで変わっています（再起動すると、確かめないまま使われます） | 確かめていない設定のまま、再起動のときに動き出します。 | `./scripts/deploy-stack.sh` を実行します。 |
| F6 | 5 GB 未満はエラー、10 GB 未満は注意 | ディスクの空きが少なくなっています（あと {gb} GB） | 空きがなくなると、DB や控えが止まります。 | `docker system df` で大きいものを見て、エージェントに相談します。 |
| F9 | お知らせ | 新しい DB です。`POSTGRES_PASSWORD` は、この最初の起動で固定されます。 | 最初の起動で DB を作ります。そのときのパスワードが、そのまま DB に残ります。 | あとで `POSTGRES_PASSWORD` を変えないでください（変えるときは、エージェントに相談します）。 |
| F11 | エラー | このシェルの値が、デプロイに入ってしまいます（{names}） | シェルで export した値は、stack.env より強く、デプロイに入ります。 | 表示された名前を `unset` で消してから（例: `unset LLM_GUEST_AI`）、もう一度デプロイします（使う値なら stack.env に書きます）。 |
| F12 | エラー | このシェルに、デプロイの道具（Compose、Docker）の動きを変える値があります（{names}。空の DB で動き出すか、ちがう Docker に入るおそれがあります） | `COMPOSE_` で始まる名前（`COMPOSE_PROFILES` のほか）や `DOCKER_` で始まる名前をシェルで export していると、デプロイがちがう名前のプロジェクト（空の DB）や、ちがう Docker で動きます。前の作業の `export` が残っていることがあります。 | 表示された名前を `unset` で消してから（例: `unset COMPOSE_PROJECT_NAME`）、もう一度デプロイします（stack.env にも書きません）。 |
| S1 | エラー | `COMPOSE_PROFILES` に full（Hermes）があります（学習者には出さない決まりです） | Hermes は、学習者には出さないと決めました。 | full を外します。 |
| S2 | エラー | AI アプリの接続（byoa）は、最初の公開では使いません。 | 最初の公開では、AI アプリの接続を使わないと決めました（D3）。 | byoa を外します。使うと決めたら、`DECIDED_BYOA` に決めた日を書きます（手順書 12.3）。 |
| S3 | エラー | 学習の記憶（Memanto）は、最初の公開では使いません。 | 最初の公開では、学習の記憶を使わないと決めました（D3）。`MEMANTO_ENABLED` は、`false` か空でないと入ったままです。 | `COMPOSE_PROFILES` から memory を外し、stack.env の `MEMANTO_*` の行は `stack.env.example` のとおりにします（`MEMANTO_ENABLED=false`）。使うと決めたら、`DECIDED_MEMORY` に決めた日を書きます（手順書 12.3）。 |
| S4 | エラー | 有料プランは、最初の公開では止めておきます。 | 最初の公開では、有料プランを止めておくと決めました（D3）。 | billing.env の `BILLING_ENABLED` を空にし、本番の鍵（`_live_`）は入れません。使うと決めたら、`DECIDED_BILLING` に決めた日を書きます（手順書 12.3）。 |
| S5 | 注意 | 読み上げ（tts）が `COMPOSE_PROFILES` にありません。 | 最初の公開では、読み上げを使うと決めました（D3）。 | tts を足します（最初の公開で使うと決めました）。 |
| S6 | pilot から注意 | tunnel がないので、外から使えません。 | pilot からは、トンネルで外から使えるようにします。 | 手順書 7.4 のとおり `tts,tunnel` にします。 |
| G1 | エラー | アカウントの削除を有効にする前の確かめが、記録にないか、順番がちがいます（{names}） | 削除を有効にする前に、パスワードの確かめが正しく動くことを確かめます。 | Supabase の設定 → パスワードの変更の確かめ → 本番の amr の確かめ、の順に済ませて日付を書きます（手順書 11.2）。 |
| G2 | エラー | 同意の確かめ（`LEGAL_TERMS_REQUIRED`）を入れる前の記録がありません（{names}） | 同意のページが出る前に同意を求めると、学習者が何もできなくなります。 | 先に Vercel のフラグを入れて同意のページを確かめ、日付を書きます（手順書 12.3）。 |
| G3 | public か、`VERCEL_LEGAL_PAGES_ON` があるときエラー | 規約を公開するのに、ご本人の削除が止まっています。 | 規約で約束しているので、ご本人が自分で削除できるようにします。 | 手順書 11.2 を済ませ、`ACCOUNT_DELETION_ENABLED=true` にします。 |
| G5 | minors と public でエラー | この段階に入る前の確かめが、記録にありません（{names}） | 18 歳未満も使える段階（minors と public）に入る前に、18 歳未満が使うときの決まりを決めます（pilot の次が public でも要ります）。 | 手順書 14 章の表でその確かめをして、日付を書きます。 |
| K1 | pilot は注意、minors からエラー | 安全の知らせの受け口がありません。 | 安全の知らせが届かないと、だれも気づけません。 | Slack の受け口の URL を stack.env の `AI_CAP_ALERT_WEBHOOK_URL` に書きます（手順書 3.6）。 |
| K3 | 注意 | 知らせの受け口が Slack ではありません（{names}） | Slack 以外の受け口は、この手順書では確かめていません。 | Slack のチャンネルの Incoming Webhook にします。 |
| K4 | pilot は注意、minors からエラー | 知らせを見る人と頻度が、記録にありません（{names}） | 知らせを見る人と頻度を決めておかないと、届いても見逃します。 | launch-record.env に書きます（手順書 3.6）。 |
| K5 | pilot は注意、minors からエラー | 試しの知らせが届いたことが、記録にありません。 | 受け口の URL がまちがっていても、試すまでわかりません。 | 手順書 9.4 のとおり試しの知らせを送り、届いたら launch-record.env の `ALERT_TEST` に日付を書きます。 |
| M1 | setup は注意、pilot からエラー | 開発用の Mac が本番の DB を使っていないことが、記録にありません。 | 開発の Mac が本番の DB を使うと、学習者のデータを書きかえるおそれがあります（D8）。 | Mac の `.env.local` を開発用の DB にして、launch-record.env の `MAC_DEV_DB_SEPARATE` に日付を書きます（手順書 9.5）。 |
| R1 | setup は注意、pilot からエラー | 毎日の控え（バックアップ）が動いていません。 | 控えのタイマー、鍵、設定のファイルのどれかがありません。 | 最初のデプロイのあとで、手順書 6.4 のとおりに入れます（最初のデプロイの前は、これで正しい状態です）。 |
| R2 | pilot から注意 | 最後の控えが 36 時間より前か、失敗しています。 | 控えが止まると、VM をなくしたときに戻せません。この記録は VM が自動で残します（launch-record.env には書きません）。 | `sudo journalctl -u risepath-backup` を見て、エージェントに相談します（手順書 17 章）。 |
| R3 | pilot・minors は、記録がないとエラー、35 日より前は注意。public はどちらもエラー | 控えから戻す練習の記録がないか、35 日より前です。 | 控えから本当に戻せるかは、戻してみるまでわかりません。この記録は VM が自動で残します（launch-record.env には書きません）。 | 控えから戻す練習をします（手順書 16.1）。 |
| R4 | pilot からエラー | 控えの鍵を VM の外にしまったことが、記録にないか、いまの鍵とちがいます（鍵がないと戻せません） | 鍵がないと、控えは読めません。 | 手順書 6.4 の鍵の手順をして、launch-record.env の `BACKUP_KEY_COPY` に日付を、`BACKUP_KEY_ID` に key id を書きます。 |
| R5 | pilot からエラー | 控えを消す日数（バケットのライフサイクル）が、記録にありません。 | 控えを残す日数は、プライバシーポリシーと合わせます。 | 手順書 3.8 のとおりに設定し、launch-record.env の `BACKUP_LIFECYCLE` に日付を書きます。 |
| R6 | pilot からエラー | 控えが失敗したときの知らせの受け口がありません。 | 控えが失敗しても、知らせが届きません。 | stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書いてから、控えの設定をもう一度入れます（手順書 6.4）。 |
| V1 | setup は注意（tunnel があるとエラー）、pilot・minors はエラー | 外から入れるのに、試験運用の参加者だけに絞れていません。 | 試験運用のあいだは、スタッフと大人のテスターだけが使えるようにします（D1）。Supabase は Nexloom・P-School と共有なので、そのアカウントでもログインできます。外から入れるようにする前に、Vercel の保護か、試験運用の名簿（`PILOT_ACCOUNT_IDS`）のどちらかで守ります。名簿は、すべての項目が ID の形のときだけ数えます。 | Vercel の保護（All Deployments）をかけたままにする（launch-record.env の `VERCEL_PROTECTION_ON` に日付、`VERCEL_PROTECTION_OFF` は空。手順書 2.6）か、stack.env に試験運用の名簿 `PILOT_ACCOUNT_IDS` を入れます（手順書 10.1）。保護は、名簿を確かめてから外します（手順書 10.3）。 |
| V2 | エラー | 試験運用の名簿 `PILOT_ACCOUNT_IDS` に、ID の形でないものがあります（{n} 個目）。 | 名簿の項目は、Supabase の User UID です。ID の形でない項目は、サーバーが使いません（ID がひとつもないと、だれもログインして使えません）。何個目かだけを出し、値は出しません。 | Supabase の Authentication → Users の User UID（8-4-4-4-12 の形）だけを、空白を入れずにカンマで区切って書きます（手順書 10.1）。 |
| V3 | public でエラー | 一般公開なのに、試験運用の名簿が残っているか、Vercel の保護を外した記録がないか、日付の順番がちがいます（{names}） | 一般公開では、だれでも開けるようにします。名簿が残っていると、名簿にない人が使えません。 | `PILOT_ACCOUNT_IDS` が出たときは、stack.env のその行を消します（手順書 11.8）。`VERCEL_PROTECTION_OFF` には、手順書 10.3 で保護を外した日を書きます（保護をかけた日と同じ日か、そのあとの日です）。 |
| V4 | エラー | AI アプリの接続（byoa）は、試験運用の名簿を確かめません（{names}） | AI アプリの接続（リモートの MCP）は、試験運用の名簿を読みません。名簿を使っているあいだに入れると、名簿にない人がそこから使えてしまいます。 | 名簿を使っているあいだは byoa を使いません。stack.env の `COMPOSE_PROFILES` から byoa を外し、launch-record.env の `DECIDED_BYOA` を空にします（手順書 12.3）。 |
| X0 | 実行できません（デプロイは止まります） | 事前チェックの中でエラーが起きました（何も変えていません）。 | 事前チェックの中で、思いがけないことが起きました。値は出しません。 | 出た行をそのままエージェントに見せます。 |
| X1 | 実行できません（デプロイは止まります） | 事前チェックを実行できません（Dockerfile に api の行がありません） | 事前チェックは、api と同じ node のイメージで動きます。 | `git -C /opt/risepath status` を見て、エージェントに相談します。 |
| X2 | 実行できません（デプロイは止まります） | 事前チェックを実行できません（Docker で node のイメージを動かせません） | 事前チェックのイメージを取得できないか、Docker が動いていません。docker のグループに入ったすぐあとは、VM に入り直すまで Docker を使えません。 | VM に入り直して（SSH し直して）から、もう一度実行します。直らないときは、`docker info` で出た行をエージェントに見せます。 |
| X3 | 実行できません（デプロイは止まります） | CI モードは、CI の型のファイルでしか使えません。 | CI の決まりは、CI のダミーのファイルでしか使えません。 | エージェントに相談します（VM では、いつも本番の決まりで確かめます）。 |
| X4 | 実行できません（デプロイは止まります） | 事前チェックへの指定が読めません（引数か、VM の情報） | 事前チェックへの引数か、VM から集めた情報が読めません。 | `./scripts/preflight.sh` を、何も付けずに実行します。直らないときは、エージェントに相談します。 |
| X5 | 実行できません（デプロイは止まります） | 事前チェックは sudo なしで実行します（root では設定のファイルを読めず、リポジトリのファイルの持ち主も変わります） | root で動かすと、設定のファイルが読めず、ファイルの持ち主も変わってしまいます。 | `sudo` を付けずに、もう一度実行します。 |
| DB0 | エラー（デプロイの中。DB を変える前に止まります） | DB に文字コードをたずねましたが、答えがありませんでした（DB はまだ変わっていません）。 | デプロイは、DB の文字コード（DB1）をたずねてから db:migrate をします。答えがないのは、DB の起動が遅いときや、`POSTGRES_DB` などの名前が DB を作ったときとちがうときで、DB の中身が悪いわけではありません。db:migrate の前に止まるので、DB はまだ変わっていません。 | 数分待ってから、`./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、`docker compose --env-file stack.env ps` で出た行をエージェントに見せます（DB は作り直しません）。 |
| DB1 | エラー（デプロイの中。DB を変える前に止まります） | DB の文字コードが UTF8 ではありません（日本語の検索が動きません）。 | 日本語で教材を探す機能には、UTF8 の DB が要ります。DB の文字コードは作ったときに決まり、あとからは変えられません。db:migrate の前に止まるので、DB はまだ変わっていません。DB が UTF8 以外の文字コードを答えたときだけ出ます（答えがないときは DB0 です）。 | エージェントに相談します（作り直す前に、もう一度文字コードを確かめ、データの控えを取ります。手順書 16 章）。 |
| P0 | 実行できません（事後の確かめ） | 事後の確かめを実行できません（sudo で実行したか、指定が読めないか、api のコンテナに入れません）。 | 事後の確かめは、sudo を付けず、何も付けずに実行します。api のコンテナが動いていないときも、確かめられません。 | `sudo` も何も付けずに `./scripts/postdeploy-check.sh` を実行します。また出るときは、`docker compose --env-file stack.env ps` で出た行をエージェントに見せます。 |
| P1 | エラー（デプロイのあと） | api が本番の形で動いていません（{names}）。 | api の `/api/v2/health` が、本番の形（本番の認証、本番のデータ、まだの migration が 0 件）で答えるかを見ます。{names} には、ちがっていた項目の名前が入ります（no-answer は、答えがなかったときです）。 | 数分待ってから `./scripts/postdeploy-check.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。 |
| P2 | エラー（デプロイのあと） | MCP が DB につながっていません（{names}）。 | MCP の `/health` が、DB につながっていると答えるかを見ます。 | 数分待ってから `./scripts/postdeploy-check.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。 |
| P3 | エラー（デプロイのあと） | AI の設定が本番の形ではありません（{names}）。 | AI の設定（`/api/v2/llm/status`）が、本番の形（Anthropic の鍵がある、Gemini を使わない、試しの答え（mock）を使わない）かを見ます。CI では Anthropic の鍵を見ません。 | `./scripts/preflight.sh` で直し方を見ます。`providers.anthropic.configured` と出たときは、stack.env の `ANTHROPIC_API_KEY` を確かめます（手順書 3.5）。直したら `./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。 |
| P4 | エラー（tts があるとき。デプロイのあと） | 読み上げ（kokoro-tts）が答えません。 | 読み上げのコンテナに、api のコンテナの中から直接たずねます（`COMPOSE_PROFILES` に tts か full があるときだけ）。 | 数分待ってから `./scripts/postdeploy-check.sh` をもう一度実行します。また出るときは、エージェントに相談します。 |
| P5 | エラー（tunnel があるとき。デプロイの中か、デプロイのあと） | 公開の入り口（cloudflared）が healthy ではありません。 | トンネルのコンテナが、Cloudflare につながっているかを見ます（`COMPOSE_PROFILES` に tunnel があるとき。本番だけ）。デプロイの中では、部品が healthy になるのを待つところで止まり、英語の行（Compose の行）のあとに、この行が出ます（Rise Path は、もう新しい版に入れ替わっています）。 | tunnel.env の `TUNNEL_TOKEN` と、Cloudflare の画面のトンネルの状態を確かめます（手順書 7.3）。直したら `./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。 |
| P6 | 注意 | VM の起動のユニット（risepath-stack.service）が登録されていません。 | VM を再起動したときに、Rise Path を自動で動かすユニットです（本番だけ）。最初のデプロイのあとで、bootstrap-vm.sh が登録します。 | 最初のデプロイ（bootstrap-vm.sh の中）なら、このあと bootstrap-vm.sh が登録するので、このままで正しい状態です。それ以外なら、`./scripts/bootstrap-vm.sh` をもう一度、最後まで実行します（手順書 6.1）。 |
| P8 | 注意 | api の記録に、保存期間の処理（Retention）が動き出した行がありません。 | api が動き出したときに、古い記録を消す処理（Retention）が on になったことを、api の記録の行の数で見ます（行の中身は出しません）。 | `./scripts/preflight.sh` で `RETENTION_` の名前を確かめます。デプロイのすぐあとでないときは、古い行が消えていることがあります（そのときは次のデプロイのあとに見ます）。 |
| P13 | お知らせ | 通ったデプロイを記録しました（.deploy/last-green.json）。 | デプロイ（`deploy-stack.sh`）が本番でエラーなしに終わったときだけ書きます（事後の確かめを一人で実行したときは書きません）。次の事前チェックは、この記録で、そのあと stack.env が変わったか（F5）を見ます。 | 何もしません（次の事前チェックが、この記録を読みます）。 |
| P15 | エラー（デプロイのあと） | どの機能を動かすか（`COMPOSE_PROFILES`）が読めないので、読み上げと公開の入り口を確かめられません。 | 事後の確かめは、stack.env の `COMPOSE_PROFILES` の行（ないときはシェルの値）で、読み上げ（P4）と公開の入り口（P5）を見るかを決めます。その行が読めない形（大文字、`;`、閉じていない引用符など）か、知らない名前があると、見ないまま通さずに、このエラーにします。 | `./scripts/preflight.sh` で直し方を見て、stack.env の `COMPOSE_PROFILES` の行を `COMPOSE_PROFILES=tts,tunnel` の形にします（手順書 7.4 の前は `COMPOSE_PROFILES=tts`）。直したら `./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。 |
| P16 | エラー（デプロイのあと） | デプロイの途中で stack.env が変わったので、通ったデプロイを記録しませんでした。 | デプロイは、事前チェックで確かめた stack.env で動きます。終わったときに stack.env がそのときとちがうと（デプロイの途中で、別の画面から書きかえたときなど）、確かめていない中身を「通った」と記録しないよう、P13 の記録を書きません。 | `./scripts/deploy-stack.sh` をもう一度実行します（終わるまで、stack.env は変えません）。 |
| VB1 | エラー（Vercel のビルドが止まります） | VITE_API_BASE_URL is set. Delete it: unset, the app calls /api/v2 on its own address and vercel.json forwards that to the API. | `VITE_API_BASE_URL` があると、アプリは Vercel を通らずに、その住所の API を直接呼びます（昔の Tailscale の住所が残っていることがあります）。消すと、アプリは自分の住所の /api/v2 を呼び、Vercel がそれを API に転送します。 | Vercel の Environment Variables から `VITE_API_BASE_URL` を消し、Redeploy します（手順書 8.3）。 |
| VB2 | エラー（Vercel のビルドが止まります） | Set to "true": {names}. Delete these: the job-training section and the shared AI chat are not offered in the public app. | `VITE_FEATURE_TRAINING`（職業訓練の画面）と `VITE_FEATURE_AGENT_CHAT`（共有の AI チャット）は、一般向けのアプリでは使いません。"true" にすると、その画面がアプリに入ります。この決まりは、一般向けのアプリの Vercel のプロジェクトのためのものです。職業訓練の学校の版（別の Vercel のプロジェクト）は、このコードが `release` ブランチに入る前に、学校の版でだけ通す切り替えが要ります（[training-plan.ja.md](../brushup-2026/training-plan.ja.md) 4.7）。 | Vercel の Environment Variables から、出た名前を消し、Redeploy します（手順書 8.3）。 |
| VB3 | エラー（Vercel のビルドが止まります） | VITE_SUPABASE_URL is not an https:// address. | Supabase の住所は https:// で始まります。ほかの形だと、ログインの通信が守られないか、ログインできません。 | Supabase の画面に出ている Project URL（https:// で始まるもの）を、そのまま `VITE_SUPABASE_URL` に書き、Redeploy します（手順書 8.3）。 |
| VB4 | エラー（Vercel のビルドが止まります） | VITE_SUPABASE_ANON_KEY holds a secret key (service_role or sb_secret_). Put the anon key there, and replace the secret key in Supabase: it may have been exposed. | `VITE_` で始まる値はアプリの中に入り、だれでも読めます。秘密の鍵（service_role の鍵か、sb_secret_ で始まる鍵）があると、だれでも DB を読み書きできます。ビルドは止まりますが、ほかのデプロイ（Preview など）のアプリには、もう入ったかもしれません。 | すぐにエージェントに相談します。`VITE_SUPABASE_ANON_KEY` には anon の鍵を書き、Supabase の画面で、その秘密の鍵を使えないようにする作業をエージェントと一緒に進めます（手順書 15 章）。 |
| VB5 | エラー（Vercel のビルドが止まります） | VITE_FEATURE_LEGAL_PAGES is "true" but VITE_SUPPORT_CONTACT is not an https:// address or a mailto: address. | 法務のページを公開すると、学習者は問い合わせ先を見ます。`VITE_SUPPORT_CONTACT` が、https:// の住所（問い合わせのフォーム）か、mailto: とメールアドレス 1 つでないと、問い合わせ先が出ません。 | `VITE_SUPPORT_CONTACT` に、問い合わせのフォームの https:// の住所か、`mailto:` とメールアドレス 1 つを書き、Redeploy します（手順書 11.6）。 |
| VB6 | エラー（Vercel のビルドが止まります） | VITE_APP_BASE_PATH is set to something other than "/". Delete it: the app is served at the root of its address. | Rise Path は、アドレスのいちばん上（/）で動きます。`VITE_APP_BASE_PATH` にほかの値があると、ページが開けません。 | Vercel の Environment Variables から `VITE_APP_BASE_PATH` を消し、Redeploy します（手順書 8.3）。 |
| VB7 | 注意（Vercel のビルド） | VITE_FEATURE_BILLING is "true": the paid plan stays off at the first launch. | 有料のプラン（`VITE_FEATURE_BILLING`）は、最初の公開では使いません。"true" にすると、プランの画面への入り口が出ることがあります。ビルドは止まりません。 | Vercel の Environment Variables から `VITE_FEATURE_BILLING` を消し、Redeploy します（手順書 8.3）。 |
| VB8 | 注意（Vercel のビルド） | Set: {names}. A session from the Nexloom project reaches neither account deletion nor consent on the server. | `VITE_NEXLOOM_SUPABASE_` で始まる設定があると、Nexloom のプロジェクトのログインが使われることがあります。Nexloom だけのログインでは、アカウントの削除も同意も、サーバーに届きません。ビルドは止まりません。 | 最初の公開では、Nexloom のログインを使いません。出た名前を Vercel の Environment Variables から消し、Redeploy します（手順書 8.3）。使いたいときは、先にエージェントに相談します。 |
| VB9 | 注意（Vercel のビルド） | A Preview build has {names}: previews would use the production sign-in, database or LLM budget. | Preview（試しのデプロイ）に Supabase の設定や `API_ORIGIN`・`ORIGIN_SECRET` があると、試しのアプリが、本番のログイン、DB、AI の予算を使います。これらは Production だけに入れます。ビルドは止まりません。 | Vercel の Environment Variables で、出た名前を Preview に入れないようにします（Production だけにします。手順書 8.3）。 |
| VB10 | 注意（Vercel のビルド） | API_ORIGIN is not https:// with a host only (no path, no trailing slash). | `API_ORIGIN` は、Vercel が /api を転送する先です。https:// とホストの名前だけ（`https://api.<domain>`）で、うしろに / やパスを付けません。ちがう形だと、/api が動かないか、暗号化されない通信になります。ビルドは止まりません。 | `API_ORIGIN` を `https://api.<domain>` の形に直し、Redeploy します（手順書 8.3）。 |
| VB11 | 注意（Vercel のビルド） | ORIGIN_SECRET is shorter than 32 characters. | `ORIGIN_SECRET` は、VM の stack.env と同じ合言葉です（`openssl rand -hex 32` で作ると 64 文字です）。VM では、32 文字より短い値は事前チェック（D3）が止め、api も動き出しません。ですから、Vercel の値が短いときは、VM の値と同じではありません（貼り付けるときに切れた、など）。このままだと、Vercel を通る /api の呼び出しは、すべて断られます（403）。ビルドは止まりません。 | エージェントと一緒に、VM の stack.env の `ORIGIN_SECRET` と同じ値を、Vercel の Production の `ORIGIN_SECRET` に入れ直し、Redeploy します（手順書 15 章）。値はチャットに貼りません。値が漏れたかもしれないときだけ、VM と Vercel の両方を新しい値に取り替えます（手順書 15 章）。 |

## 14. 確かめの記録（launch-record.env）

VM の `deploy/risepath-vm/launch-record.env` は、オーナーが確かめをした日の記録です。git には入れません。秘密の値は書きません。事前チェックだけが読みます。

- 作り方: VM で `cd /opt/risepath/deploy/risepath-vm && cp launch-record.env.example launch-record.env` を実行します（手順書 5.2）。
- 書き方: 確かめをした日を `名前=YYYY-MM-DD`（例: `ALERT_TEST=2026-11-02`）で書きます。数字と - と = は半角で書きます（日本語入力を切ってから打ちます）。日付は、その名前の行の = のうしろに書きます（同じ名前の行を新しく足すと、エラー（A4）になります）。まだのものは空のままにします。`LAUNCH_STAGE` は段階の名前だけ（前やうしろに空白や → を入れません）、`BACKUP_KEY_ID` は 0〜9 と a〜f の 16 文字の key id、`ALERT_WATCHER` と `ALERT_CHECK` は 80 文字までの短い文です。
- 同じ日付を、この手順書のチェックの横にも書きます。ファイルをなくしたとき（VM を作り直したときなど）は、もう一度 `cp` をして、チェックの横の日付を写します。

| 名前 | 日本語の名前 | 書く手順 | いつから必要か | 書く例 |
|---|---|---|---|---|
| `LAUNCH_STAGE` | 公開の段階 | 手順書 5.2・9.6・11.8 | いつも（読めないとエラー） | `LAUNCH_STAGE=setup` |
| `VERCEL_PROTECTION_ON` | Vercel の保護をかけた日 | 手順書 2.6 | setup から（stack.env に試験運用の名簿 `PILOT_ACCOUNT_IDS` を入れるまでは、ないと V1） | `VERCEL_PROTECTION_ON=2026-11-02` |
| `VERCEL_PROTECTION_OFF` | Vercel の保護を外した日 | 手順書 10.3 | 手順書 10.3 で保護を外した日に書きます（それまでは空。名簿がないのに書くと V1）。public では必要です（V3） | `VERCEL_PROTECTION_OFF=2026-11-20` |
| `ALERT_WATCHER` | 安全の知らせを見る人 | 手順書 3.6 | pilot は注意、minors からエラー（K4） | `ALERT_WATCHER=事務局の当番（2 人）` |
| `ALERT_CHECK` | 安全の知らせを見る頻度 | 手順書 3.6 | pilot は注意、minors からエラー（K4） | `ALERT_CHECK=平日の 10 時と 16 時` |
| `BACKUP_LIFECYCLE` | 控えのバケットのライフサイクルを入れた日 | 手順書 3.8 | pilot から（R5） | `BACKUP_LIFECYCLE=2026-11-03` |
| `BACKUP_KEY_COPY` | 控えの鍵を VM の外にしまった日 | 手順書 6.4 | pilot から（R4） | `BACKUP_KEY_COPY=2026-11-05` |
| `BACKUP_KEY_ID` | 控えの鍵の key id（0〜9 と a〜f の 16 文字） | 手順書 6.4 | pilot から（R4。いまの鍵と同じこと） | `BACKUP_KEY_ID=0123456789abcdef` |
| `ALERT_TEST` | 試しの知らせが届いた日 | 手順書 9.4 | pilot は注意、minors からエラー（K5） | `ALERT_TEST=2026-11-10` |
| `MAC_DEV_DB_SEPARATE` | Mac が開発用の DB になった日 | 手順書 9.5 | setup は注意、pilot からエラー（M1） | `MAC_DEV_DB_SEPARATE=2026-11-10` |
| `SUPABASE_CURRENT_PASSWORD_ON` | 「Require current password when updating」を入れた日 | 手順書 11.2 | `ACCOUNT_DELETION_ENABLED` を入れる前（G1） | `SUPABASE_CURRENT_PASSWORD_ON=2026-12-01` |
| `PASSWORD_CHANGE_CHECK` | パスワードの変更の確かめが通った日 | 手順書 11.2 | `ACCOUNT_DELETION_ENABLED` を入れる前（G1。`SUPABASE_CURRENT_PASSWORD_ON` と同じ日か、そのあとの日） | `PASSWORD_CHANGE_CHECK=2026-12-01` |
| `PROD_AMR_CHECK` | 本番の amr の確かめが通った日 | 手順書 11.2 | `ACCOUNT_DELETION_ENABLED` を入れる前（G1。`SUPABASE_CURRENT_PASSWORD_ON` と同じ日か、そのあとの日） | `PROD_AMR_CHECK=2026-12-01` |
| `VERCEL_LEGAL_PAGES_ON` | 法務のページを出した日 | 手順書 12.1 | `LEGAL_TERMS_REQUIRED` を入れる前（G2）。書くと、ご本人の削除も必要です（G3） | `VERCEL_LEGAL_PAGES_ON=2027-01-10` |
| `DECIDED_BYOA` | AI アプリの接続を使うと決めた日 | 手順書 12.3 | byoa を入れる前（S2）。試験運用の名簿があるあいだは書きません（V4） | `DECIDED_BYOA=` |
| `DECIDED_MEMORY` | 学習の記憶を使うと決めた日 | 手順書 12.3 | memory を入れる前（S3） | `DECIDED_MEMORY=` |
| `DECIDED_BILLING` | 有料プランを使うと決めた日 | 手順書 12.3 | `BILLING_ENABLED=true` の前（S4） | `DECIDED_BILLING=` |
| `MINORS_POLICY_DECIDED` | 18 歳未満が使うときの決まりを決めた日 | オーナーと弁護士（手順書 1 章に書きます） | minors と public で必要（G5。pilot の次が public でも要ります） | `MINORS_POLICY_DECIDED=` |

## 15. 秘密の値と、取り替え方

## 16. 控えから戻すとき

### 16.1 戻す練習（毎月）

### 16.2 本当に戻すとき（エージェントと一緒に）

### 16.3 VM をなくしたとき

## 17. 困ったとき

## 18. 本番の DB に触るとき（D8）

## 付録 古い文書
