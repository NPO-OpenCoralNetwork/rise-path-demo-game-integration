# アカウントの削除の運用ガイド（オーナーとスタッフ向け）

- 作成日: 2026-10-24（Phase 4）
- 対象: Rise Path のオーナーと、削除の求めを受けるスタッフ
- 関連: 決定の記録 [../brushup-2026/ai-access-plan.ja.md](../brushup-2026/ai-access-plan.ja.md) の 8 章、データの一覧 [../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)、安全の運用 [safety-operations.ja.md](./safety-operations.ja.md)

Rise Path のアカウントの削除は、オーナーの決定 D1〜D5 に沿っています。

- **消すのは Rise Path のデータだけです**（D2）。ログイン（メールアドレス、パスワード、登録したときの名前）は、Nexloom と P-School と共通の Supabase のプロジェクトにあるので、残します。ログインも消したいと言われたときは、スタッフが手で消します（下の 3 章）。
- **ご本人は、設定の「アカウントを削除する」から、パスワードを入れて、すぐに削除できます**（D3）。待つ期間はありません。元に戻せません。
- **画面からの削除は、はじめ止まっています。** 7 章の 2 つの確かめが済んでから、オーナーが API の `ACCOUNT_DELETION_ENABLED=true` にすると使えます。止まっているあいだ、画面には「いまはこの画面から削除できません」と出るので、スタッフが消します（2 章）。
- **削除のあとも残すもの**: 利用規約に同意した記録・保護者の同意の記録・削除した記録（アカウント ID・版・日時だけ。5 年）、使ったことのある AI アプリの記録（3 年）、お支払いの記録（アカウントとのつながりを外して。Stripe にはアカウント ID が残ります）、今日の AI の利用回数（30 日まで）、安全のための記録（つながりを外して、最長 365 日）、サーバーのログ、運営者が手でとった DB の控え（D4、D5）。

コードの場所: サービス `server/services/accountDeletion.js`、画面 `components/features/settings/DeleteAccountView.tsx`、API `server/routes/account.js`、スタッフのスクリプト `scripts/delete-account-data.mjs`。

## 1. 求めがどこに届くか

- 届く場所: アプリの「お問い合わせ」（Vercel の `VITE_SUPPORT_CONTACT`。設定していないと「ご利用の拠点のスタッフにお伝えください」と出ます）と、拠点のスタッフです。
- 読む人と頻度: 【要記入: 問い合わせを読む人と、何日おきに見るか】
- ご本人の確認: 登録しているメールアドレスからの求めなら、そのアドレスに返信して確かめます（個人情報保護委員会のガイドライン 通則編 3-8-7 の事例 2）。保護者の方からの求めは、[安全の運用ガイド](./safety-operations.ja.md)の 6 章と同じように確かめます。手数料はいただきません（個人情報保護法 第 38 条）。

## 2. ご本人の代わりに Rise Path のデータを消す（スタッフ）

ご本人がパスワードを忘れた、画面から消せない（画面からの削除が、まだ止まっているときもふくみます）、などのときです。API が動いている VM で、API のコンテナの中で実行します（アップロードしたファイルはコンテナの中にあり、DB と Supabase と決済の設定もそこにあります）。

```sh
cd deploy/risepath-vm
# 1. メールアドレスからアカウント ID を探す（何も消しません）
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --find-email someone@example.com
# 2. 消えるものの件数と、続いているプランがないかを見る（何も消しません）
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --user <uuid> --dry-run
# 3. 消す
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --user <uuid> --yes
```

- `--find-email` と `--orphans` には `SUPABASE_SERVICE_ROLE_KEY` が要ります（anon のキーではユーザーを調べられません）。
- 続いている有料プランがあると止まります（終了コード 2）。先に Stripe のダッシュボードで解約してから、もう一度実行します。
- `ACCOUNT_DELETION_ENABLED` の値にかかわらず動きます（この設定が切りかえるのは、ご本人の画面からの削除だけです）。
- デプロイで migration を当てているあいだ（`deploy-stack.sh` の実行中）は、`--yes` を実行しません。重なると、どちらかがデッドロック（40P01）で何も変えずに止まります。デプロイ中に終了コード 3 で止まったときは、デプロイが終わってから、もう一度実行します。
- 終了コード: 0 = 消した（または、もう消えていた）、2 = 断った（続いている有料プランなど。理由が出ます）、3 = いまは使えない（DB、Supabase、Stripe、Memanto のどれか。Stripe や Memanto につながらないとき（`payment_provider_unavailable`、`memory_service_unavailable`）もここです。しばらくしてから、もう一度実行します）、1 = 使い方や設定のまちがい。
- 表示された JSON に `"memoryDeleted":true` があるとき（終了コード 2 か 3）は、AI の記憶だけが消えて、ほかのデータは残っています。同じ `--yes` をもう一度実行します（5 章の `partial` の行）。
- 削除の記録の `requested_by` は `staff` になります（ご本人の削除は `self`、定期の確認は `orphan`）。

### AI アプリについて（先にすること）

Supabase には、スタッフがご本人の AI アプリの許可を取り消す API がありません。なので、スクリプトでは取り消せません。

1. 消す**前に**、ご本人に、設定の「つないでいる AI アプリ」（`/settings/connected-apps`）で、すべてのアプリを解除してもらいます。ダッシュボードで取り消せるなら、そちらでも構いません【要確認: ダッシュボードの画面】。
2. どちらもできなかったときも、削除の前につないだ AI アプリは、Rise Path に断られます。ただし、ご本人がまたログインすると、許可が残っているアプリは、同意の画面なしでつなぎ直せます（Supabase は、許可ずみのアプリには画面を出しません）。そのあとは、新しい空のアカウントを読みます。このことをご本人に伝えてください。
3. ログインも消すと（3 章）、許可も一緒に消えます。

## 3. ログインも消したいと言われたとき（スタッフ）

ログインは Nexloom と P-School と共通です。**ログインを消すと、Nexloom のアカウントと、P-School のログインとゲームの記録も使えなくなります。** 先に、このことを書面（メールなど）でご本人に伝え、了解をもらってください。

1. 2 章の手順で、**先に Rise Path のデータを消します**（必ずこの順番です）。
2. P-School の確認（最初の 1 回は必ず）。Supabase の SQL Editor で:
   ```sql
   select conrelid::regclass, conname, confdeltype from pg_constraint where confrelid = 'auth.users'::regclass and contype = 'f';
   ```
   P-School の表に `a` か `r` があると、ダッシュボードの削除が失敗します。そのときは止めて、P-School の担当に相談します（Rise Path は P-School の表を直しません）。`c` なら、P-School の記録も一緒に消えます（ご本人にそう伝えます）。
3. ダッシュボード → Authentication → Users → その人 → **Delete user**。ソフトデリート（行を残す消し方）は使いません。Supabase は、メールアドレスをふくむ監査の記録を残します（プライバシーポリシー 9 に書いています）。
4. 運用の記録（Rise Path の DB の外）に、日付、届いた場所、アカウント ID の先頭 8 文字、作業した人、行った手順を書きます。Rise Path の削除の記録は 5 年残ります。

## 4. ほかのサービスでログインが消されたとき（定期の確認）

Nexloom や P-School の担当がログインを消しても、Rise Path は気づきません。Rise Path のデータが残ったままになるので、スクリプトで探して消します。

```sh
cd deploy/risepath-vm
# 一覧だけ（何も消しません）
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --orphans
# 件数を確かめてから消す
docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --orphans --yes
```

- **月に 1 回**と、Nexloom や P-School の担当がログインを消したあとに実行します。Nexloom と P-School の担当には、「共有のログインを消したら、Rise Path の担当に知らせる」ことを書面で頼んでおきます（オーナーの作業）。
- Supabase が「そのユーザーはいない」（404 / `user_not_found`）と答えたものだけを、消えたログインとみなします。ほかの答え（つながらない、5xx など）が 1 つでもあると、何も消さずに止まります（終了コード 3）。
- 調べたものが 1 つも Supabase にないときは、断ります（終了コード 2）。`SUPABASE_URL` がちがうプロジェクトを指しているかもしれないからです。`Refused: none of the N checked stubs is known to this Supabase project …` と出たら、`SUPABASE_URL` を確かめるか、`--limit` を上げます。
- 知らないものが 10 % をこえる（かつ 6 件以上）ときも、断ります（終了コード 2）。このときは、知らない ID の先頭 8 文字を一覧にして、`Refused: 40 of 300 checked stubs (more than 10 %) are unknown …` のように件数を出します。まず `SUPABASE_URL` を確かめてください。Nexloom や P-School の担当が、まとめてログインを消したとき（年度の終わりなど）は、次の順に進めます。
  1. 一覧だけを実行します（`--yes` なし）。件数と ID の先頭 8 文字が出ます。
  2. その件数と先頭 8 文字を、ほかのサービスの担当が消したログインの一覧と比べます。
  3. 合っていたら、その件数を付けて消します: `--orphans --expect-orphans 40 --yes`。件数がちがうと、何も消さずに断ります（終了コード 2）。`--expect-orphans` を付けても、1 つも Supabase にないときは断ります。
- 1 回に調べるのは ID の順に最大 `--limit`（既定 500）件です。`Stopped at --limit 500: more stubs were not checked. … --after 1a2b3c4d …` と出たら、続きは `--after <その 8 文字>` を付けて実行します。
- **公開の前に 1 回（オーナー）**: 一覧だけ（`--orphans --limit 20`、`--yes` なし）を、ステージングか本番のプロジェクトで実行し、知らない ID が 404 / `user_not_found`、知っている ID がユーザーを返すことを確かめます。開発の環境には本物のプロジェクトがないため、まだ確かめていません。

## 5. ログに出る行と、すること

API のログは消えやすいので、決まった時に読みます。

- `deploy-stack.sh` は、デプロイのたびに API のコンテナを作り直します。そのとき、`docker compose logs api` の古いログは消えます。ログは約 50 MB をこえても、古いものから消えます。
- なので、スタッフはデプロイの前と、週に 1 回、次の行がないか確かめます: `docker compose --env-file stack.env logs api | grep -E '\[Account\]|deleted Rise Path account|deleted_account_renewing'`
- 続いている契約の行（`deleted_account_renewing`）は、オーナーへの知らせ（`AI_CAP_ALERT_WEBHOOK_URL`）にも送ります。有料プランを始める前に、オーナーはこの Webhook を設定してください。

| ログの行（`docker compose logs api`） | すること |
|---|---|
| `[Account] Rise Path data deleted for 1a2b3c4d… (self; files 2/2; memory skipped) in 840ms` | 正常です。 |
| `[Billing] deleted_account_renewing: a renewing subscription exists after deleting 1a2b3c4d…: cancel it in the Stripe Dashboard` | 削除のあいだに支払いが終わった契約が残っています。`account_deletions` で、先頭 8 文字と `deleted_at` から ID を探し、Stripe のダッシュボードで解約します。削除は元に戻しません。 |
| `[Account] could not re-check subscriptions at Stripe after deleting …` / `could not expire checkout sessions after deleting …` | Stripe に届きませんでした。Stripe のダッシュボードで、その顧客に続いている契約や、開いている支払いの画面がないか確かめます。 |
| `[Account] a Stripe customer of … no longer exists at Stripe (nothing to check there)` | Stripe にその顧客がいません。Stripe のアカウントを変えたあとなら、古いアカウントの契約を先に解約してください。 |
| `[Account] re-checks after deleting … did not finish within 10000 ms` | 削除は終わっています。続く行（上の 2 つ）を見ます。 |
| `[Billing] deleted_account_renewing: subscription … belongs to a deleted Rise Path account … and still renews: cancel it in the Stripe Dashboard.` | 削除したアカウントの契約が続いています。Stripe のダッシュボードで解約します。 |
| `[Account] partial: AI memories deleted, other data kept for …` | AI の記憶だけが消えて、ほかは残りました。同じ削除をもう一度します（ご本人の画面か、2 章の `--yes`）。 |
| `[Account] … upload file(s) of … not removed (retention removes orphans)` | 消せなかったファイルは、保存期間の処理が 24 時間後に消します。 |
| `[Account] ACCOUNT_DELETION_ENABLED has an unrecognised value: account deletion is off` | `stack.env` の値を直します。使うときは `true`（7 章の確かめのあと）、止めるときは `false` にするか、行を消します（消しても止まります）。 |

## 6. よくある質問への答え方

| 言われたこと | 答え方 |
|---|---|
| 「ほかの端末で消したら、この端末で『削除されています』と出た」 | 正しい動きです。ほかの端末は、次に Rise Path を開いたときに、ログアウトして記録を消します。 |
| 「消したあとにログインしたら、空っぽだった」 | ログインは共通なので残り、同じメールアドレスでログインすると、新しい空のアカウントから始まります。消したデータは戻せません。削除の直後は、1 分ほどたってからログインしてください（それより前のログインは、削除の前のものとみなされます）。 |
| 「AI アプリが『アクセスが取り消された』と言う」 | 削除の前につないだ AI アプリは、Rise Path に断られます。使い続けるなら、ログインしてから、つなぎ直してください（2 章の「AI アプリについて」）。 |
| 「P-School に前の記録が残っている」 | P-School の記録（ユーザー名、ステージの記録）は、Rise Path の削除では消えません。消したいときは、3 章の手順（ログインの削除）になります。 |
| 「『AI の記憶は消えました。それ以外は消えていません』と出た」 | 途中で止まりました。もう一度「アカウントを削除する」をしてもらうか、2 章の `--yes` で消します。 |
| 「パスワードを忘れて、画面から消せない」 | 2 章の手順で、スタッフが消します（本人確認は 1 章）。 |
| 「有料プランがあると言われて消せない」 | 先に、プランのページから解約の手続きをしてもらいます（Stripe のお客さま用のページ）。解約が終わってから消せます。 |

## 7. 受け入れているリスク（オーナーの判断）

- **ログインしたままの端末とパスワード（どの環境でも）**: Supabase の「Require current password when updating」（いまのパスワードがないと、パスワードを変えられない設定）が切ってあると、ログインしたままの端末やトークンを持っている人が、新しいパスワードを設定し、ログインし直して、パスワードの確認を通り、アカウントを削除できてしまいます。拠点で共有するタブレットが、その例です。なので、ご本人の削除は、はじめ止まっています。`byoa` を使うかどうかにかかわらず、この設定を入れて、下の 2 つの確かめが通るまで、`ACCOUNT_DELETION_ENABLED=true` にしません。「Secure password change」（ログインから 24 時間をこえると、メールの確認がないとパスワードを変えられない設定）だけでは、ログインから 24 時間以内の端末を防げません。
  - 確かめ方（ステージング）: ふつうの学習者のセッションのトークンで、`current_password` を付けずに `PUT {SUPABASE_URL}/auth/v1/user` に `{"password":"…"}` を送ります。400 `current_password_required` が返れば合格です。
  - 本番の `amr` の確かめ: [ai-access-plan.ja.md](../brushup-2026/ai-access-plan.ja.md) の 8.2 の 3 です。
  - 2 つが通ったら、VM の `stack.env` に `ACCOUNT_DELETION_ENABLED=true` を書いて、`deploy-stack.sh` を実行し直します。設定の「アカウントを削除する」を開き、「いまはこの画面から削除できません」が出なくなったことを確かめます。
- **自分の AI をつなぐ機能（`byoa`）とパスワード**: Supabase の設定によっては、つないだ AI アプリも、その方のパスワードを設定し、ログインして、アカウントを削除できてしまいます。なので、`byoa` を動かす（または動かす予定の）あいだは、[byoa-setup.ja.md](./byoa-setup.ja.md) の手順 6 の 3 つの設定をすべて入れて、確かめが通るまで、`ACCOUNT_DELETION_ENABLED=true` にしません。3 つの設定を入れても、パスワードのないアカウントは、AI アプリを許可してから 24 時間は、同じことができます。Rise Path の登録は必ずパスワードを決めますが、共有のプロジェクトのほかの入口で作ったアカウントには、パスワードがないことがあります。
- パスワードを忘れた方は、画面から消せません（パスワードの再設定の画面がないため）。スタッフの削除（2 章）で対応します。
- スタッフが消したとき、AI アプリの許可は Supabase に残ります（2 章の「AI アプリについて」）。
- ほかのサービスで消されたログインの Rise Path のデータは、次の定期の確認（4 章）まで残ります。
- Stripe の記録には、アカウント ID が残ります（顧客、支払いの画面、契約の情報）。
- 運営者が手でとった DB の控えには、削除の前のデータが残ります。控えを残す期間は【要記入: 保存する期間】です。
