# 最初の公開の手順書（Rise Path）

- 作成日: 2026-10-30（Phase 9）。手順の中身を書いた日: 2026-10-31
- 対象: Rise Path のオーナー（NPO の担当の方）と、手伝うエージェント
- 関連: 決定の記録 [../brushup-2026/ai-access-plan.ja.md](../brushup-2026/ai-access-plan.ja.md) の 13 章、VM の README [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md)、Vercel の手順 [../../deploy/vercel/README.md](../../deploy/vercel/README.md)

## はじめに

この手順書は、新しい VM を作ってから、一般の登録を開くまでを、1 つずつの手順にまとめたものです。手順の番号は「章.番号」（例: 5.3）で、ほかの場所からは「手順書 5.3」と呼びます。上から順に進めます。ほかの文書にあるコマンドは、ここに写さず、「くわしく」の行でその場所を示します。

**だれがするか**

- オーナー: 手順の多くをします。管理画面の操作、VM でのコマンド、記録を書くことです。
- エージェント（Claude Code など）: 「エージェントと一緒に」とある手順を手伝います。止まったときに出た行を見て、直し方を考えます。秘密の値は見せません。
- 弁護士: 11.1 の確認と、[../legal/README.md](../legal/README.md) の「弁護士に確かめること（Phase 9）」に答えます。

**手順の読み方**

- どの手順にも、同じ行があります。「済んだ日」（済んだら日付を書きます）、「だれが・どこで」、「先に済ませること」、「やること」、「うまくいったとき」、「うまくいかないとき」、「くわしく」です。
- 済んだ日と、1 章の答え（P9-Q）や 1 章の表の下に書くことは、この手順書の写し（オーナー用）に書きます。写しは、印刷した紙か、事務所の共有ドライブか、パスワード管理（2 人が開けるもの）に置きます。VM の中と、Mac・VM のリポジトリのフォルダの `doc/guides/first-launch.ja.md` には書きません（VM をなくすと消え、`git pull` とデプロイが止まります）。launch-record.env をなくしたときは、この写しから日付を写します。
- チェックの横の日付と同じ日付を、VM の launch-record.env（14 章）にも書く手順があります。その手順には「（launch-record.env: 名前）」と書いてあります。launch-record.env を作るのは 5.2 です。それより前の手順の日付は、5.2 でまとめて写します。
- 公開の段階（`LAUNCH_STAGE`）は、setup → pilot → minors → public の順に進みます。minors は、18 歳未満が使うと決めたときだけ書きます（ふつうは pilot の次が public です）。pilot の次が public でも、public の前に、18 歳未満が使うときの決まりを決めます（14 章の `MINORS_POLICY_DECIDED`）。いまの段階は、VM の `deploy/risepath-vm/launch-record.env` に書きます（14 章）。
- launch-record.env は、オーナーの記録です。証明ではありません。確かめをした日を書きます。
- 秘密の値（パスワード、鍵、URL のトークン、Slack の受け口の URL）は、チャット、issue、git に貼りません。パスワード管理（2 人が開けるもの）にだけしまいます。
- 事前チェック（`preflight.sh`）は、設定のまちがいを、値を出さずに名前とコードで知らせます。コードの意味と直し方は 13 章にあります。
- コマンドの中の `<…>`（例: `<プロジェクトの ID>`、`<開発用のパスワード>`）は、自分の値に置きかえます。`<` と `>` も消します（残すと、ターミナルが別の意味に読み、「No such file or directory」などで止まります）。
- VM のコマンドは、どれも `cd /opt/risepath/deploy/risepath-vm` のあとで実行します（ことわりのないときは、sudo を付けません）。SSH でふつうにログインしたターミナルで実行します。CI の手順にある `COMPOSE_PROJECT_NAME=risepath-ci` などの `export` は、VM ではしません（事前チェックの F12 が止めます）。

**2 つの確かめ（デプロイのたびに。「はじめにの 2 つの確かめ」と呼びます）**

1. **デプロイの前に**: GitHub の main で、いちばん上のコミットに緑の ✓ があることを見て、その 7 文字（例: `a1b2c3d`）を書き留めます。デプロイの途中に出る「==> デプロイするコミット: …」が同じ 7 文字であることを見ます。✓ がないときや、文字がちがうときは、そこで止めてエージェントに聞きます。
2. **事前チェックの注意**: 事前チェックを動かす手順には、そのときに出てよい注意のコード（「出てよい注意」）を書いてあります。そこに書いたコードは、いまは直しません。ほかの注意やエラーが出たときは、13 章で直し方を見ます。

## 1. 決めたこと（2026-10-30）

2026-10-30 に、オーナーが決めたことです。くわしい理由は、[計画の 13.1](../brushup-2026/ai-access-plan.ja.md) にあります。

| 番号 | 決めた日・だれが | 決めたこと | くわしく |
|---|---|---|---|
| D1 | 2026-10-30 オーナー | 最初の公開は、スタッフと大人のテスターだけの試験運用です（18 歳未満はまだ使いません）。アプリの登録は、法務の文が確定して `VITE_FEATURE_LEGAL_PAGES=true` にするまで、コードで閉じます。テスト用のアカウントはオーナーが作ります。Supabase は Nexloom・P-School と共有なので、試験運用の名簿（`PILOT_ACCOUNT_IDS`）で、名簿にない人を断ります（D1 と D5 から決まります） | 手順書 8.1・10 章 |
| D2 | 2026-10-30 オーナー | デプロイのたびに事前チェックをします。エラーはデプロイを止め、日本語で直し方を出します。注意は出すだけです。値は出しません。確かめた日の記録（launch-record.env）を VM に置き、順番の決まりを確かめます | 手順書 5.3・13 章・14 章 |
| D3 | 2026-10-30 オーナー | 最初の公開で動かすのは、読み上げ（kokoro-tts）だけです。AI アプリの接続（BYOA）、学習の記憶（Memanto）、Hermes、有料プランは止め、事前チェックが確かめます。読み上げの文は 1 回 1,000 文字までで、読み上げの音声は 30 日で消します | 手順書 5.1・12.3 |
| D4 | 2026-10-30 オーナー | DB とアップロードの控え（バックアップ）を、毎日自動で暗号化して、VM の外の Google Cloud に置きます。残す日数を決め、毎月、戻す練習をします | 手順書 3.8・6.4・6.5・16 章 |
| D5 | 2026-10-30 オーナー | Vercel の保護（Deployment Protection）を、本番にもかけたままにします。外すのは、名簿を確かめたあとです | 手順書 2.6・10.3 |
| D6 | 2026-10-30 オーナー | 部品の弱点（既知の脆弱性）は、Phase 9 とは別のプルリクエスト（#77）で直します | 手順書 2.2 |
| D7 | 2026-10-30 オーナー | 安全の知らせは、Slack の受け口（Incoming Webhook）に送ります。見る人と頻度は、オーナーが決めます | 手順書 3.6・9.4・10.5 |
| D8 | 2026-10-30 オーナー | 公開のあと、開発は本番とは別の DB を使います。本番の DB には、決まった作業のときだけ、VM の中から触ります | 手順書 9.5・18 章 |
| 既定 1 | 2026-10-30 オーナー | 公開の手順は、この手順書 1 つにまとめます | この文書 |
| 既定 2 | 2026-10-30 オーナー | ドメインは、決まるまで `<domain>` と書きます | 手順書 3.1 |
| 既定 3 | 2026-10-30 オーナー | 古い VM（nexloom-gce）に Rise Path のデータが残っているかを先に見て、なければ空の DB で始めます | 手順書 2.7 |

ドメイン: 未定

（3.1 でドメインを決めたら、手順書の写し（はじめに）の「未定」をそのドメインに書きかえます。リポジトリのこの手順書は、エージェントが、プルリクエストで「未定」と `<domain>` をすべて、そのドメインに置きかえます。）

**まだ答えていない質問**（答えたら、答えと日付を書きます）

| 番号 | 質問 | おすすめ | 答え |
|---|---|---|---|
| P9-Q1 | 試験運用のあいだ、Nexloom や P-School のアカウントでもログインできてしまいます。名簿で断りますか | 名簿を使います | 名簿を使います（D1 と D5 から決まりました。2026-10-30） |
| P9-Q2 | 控えを何日残しますか | 30 日（削除のあとに Google が残す期間を入れて、最大 37 日）。弁護士に確かめます | 未回答（弁護士の答えまで 30 日で進めます。`backup.env` の `BACKUP_RETENTION_DAYS`） |
| P9-Q3 | 安全の知らせを、だれが、どのくらいの頻度で見ますか | 試験運用のあいだは平日に毎日。18 歳未満が使うときは、使っているあいだずっと | 未回答（手順書 3.6 で決め、ここと launch-record.env に書きます） |
| P9-Q4 | 古い道具 `scripts/sync-db-url-from-vm.py`（本番の DB の URL を Mac に書く）を消してよいですか | 消します | 消します（D8 から決まりました。Phase 9 のプルリクエストで消しています） |
| P9-Q5 | 共有の Supabase で、匿名のログイン（Anonymous sign-ins）を止められますか（Nexloom・P-School の担当に聞きます） | 止めます。止められないときは、試験運用のあいだは名簿が断ります。一般公開の前には、Rise Path のサーバーが匿名のセッションを断るコードを足します（名簿を外すと、断るものがなくなるためです。[計画の 13.5](../brushup-2026/ai-access-plan.ja.md)。手順書 11.8） | 未回答（手順書 3.7） |
| P9-Q6 | ステージング用の Supabase のプロジェクトを作りますか | 作らなくても進められます（11.2 の確かめは、8.1 のダミーのアカウントで行います） | 未回答（手順書 3.7） |

## 2. 始める前に

### 2.1 決めたことを読む

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー
- 先に済ませること: ありません
- やること:
  1. 1 章の表を、上から読みます。
  2. わからないところに印を付けます。
- うまくいったとき: 1 章の決めたことが、自分の決めたことと同じだと確かめられました。
- うまくいかないとき: 印を付けたところを、エージェントに聞きます。決めたことを変えたいときは、ここで止めて、エージェントと計画を直します。
- くわしく: [計画の 13 章](../brushup-2026/ai-access-plan.ja.md)

### 2.2 部品の弱点を直すプルリクエスト（D6）が main に入っていることを見る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GitHub
- 先に済ませること: 2.1
- やること:
  1. GitHub のリポジトリで Pull requests を開き、#77（Upgrade packages with known advisories before launch）を開きます。
- うまくいったとき: 紫の「Merged」が出ています。
- うまくいかないとき: 「Open」のままなら、ここで止めて、エージェントに状況を聞きます（マージされるまで、先に進みません）。
- くわしく: 1 章の D6

### 2.3 （済み）Supabase が答えないときの 503

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: ありません（済んでいます）
- 先に済ませること: ありません
- やること:
  1. 何もしません。#73（Supabase が答えないとき、ログインを 401 ではなく 503 `auth_unavailable` で断る直し）は、マージ済みです。
- うまくいったとき: 読んだ日を書きました。
- うまくいかないとき: 公開のあとに `503 auth_unavailable` が出たときは、17 章を見ます。
- くわしく: 17 章

### 2.4 main のルールセットを作る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GitHub の Settings → Rules
- 先に済ませること: 2.2
- やること:
  1. [計画の 11.2](../brushup-2026/ai-access-plan.ja.md) の 1 の手順のとおりに、main のルールセットを作ります（3 つのチェックを必須にします）。
- うまくいったとき: Rulesets の一覧に `main: required checks` が出て、Active です。
- うまくいかないとき: 画面の名前がちがうときや、チェックが候補に出ないときは、エージェントに聞きます。
- くわしく: [計画の 11.2](../brushup-2026/ai-access-plan.ja.md)

### 2.5 GitHub のセキュリティの設定を入れる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GitHub の Settings → Code security（Advanced Security）
- 先に済ませること: 2.4
- やること:
  1. 「Private vulnerability reporting」（脆弱性の非公開の報告）を Enable にします。
  2. 「Secret scanning」と「Push protection」を Enable にします。
  3. 「Dependabot security updates」を Enable にします。
- うまくいったとき: 4 つが Enabled と出ています。
- うまくいかないとき: 画面の名前がちがうときは、エージェントに聞きます。プランのために選べないものがあれば、選べないことを書き留めて、先に進みます。
- くわしく: [../../SECURITY.md](../../SECURITY.md)

### 2.6 Vercel を確かめ、本番にも保護をかける（D5）

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: VERCEL_PROTECTION_ON）
- だれが・どこで: オーナー、Vercel の画面とブラウザ
- 先に済ませること: 2.2
- やること:
  1. Vercel のプロジェクト `rise-path` を開きます。Settings → Git で、Production Branch が `main` であることを見ます。
  2. Settings → Environment Variables で、Preview に何も入っていないこと、`VITE_API_BASE_URL` がないことを見ます。
  3. Settings → Deployment Protection で、Vercel Authentication を入れ、範囲を **「All Deployments」** にして保存します（「Standard Protection」は、本番のドメインを守りません）。
  4. Vercel にログインしていないブラウザ（プライベートウィンドウ）で、本番の URL（`…vercel.app` と、もしあれば本番のドメイン）を開きます。
  5. プランの名前と、プロジェクトの持ち主を書き留めます。
- うまくいったとき: 4 で、Rise Path ではなく、Vercel のログインの画面が出ます。
- うまくいかないとき: 4 で Rise Path が出たら、3 の範囲が「All Deployments」かを見直します。画面がちがうときは、エージェントに相談します。保護をかけられるまで、7 章（公開の入り口）には進みません。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 13

### 2.7 古い VM（nexloom-gce）に Rise Path の DB が残っているかを見る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナーとエージェント、Mac のターミナル（gcloud を入れ、`gcloud auth login` 済み。読むだけです）
- 先に済ませること: ありません
- やること:
  1. Mac のターミナルで `gcloud compute instances list --project=<nexloom-gce があるプロジェクトの ID> --filter=name=nexloom-gce` を実行し、古い VM があるかを見ます。nexloom-gce はほかのサービス（ai-note-meet など）も動かしているので、ふつうは 1 行出ます。
  2. あれば、エージェントと一緒に、その VM の Postgres に `risepath` という DB と、学習者の行があるかを読むだけで見ます（何も変えません。DB の URL を Mac の `.env.local` に書くことはしません）。
- うまくいったとき: 「ありません」（VM がないか、`risepath` の DB がないか、行が 0 件）なら、空の DB で始めます。1 章の既定 3 のとおりです。
- うまくいかないとき: gcloud がエラー（ログインしていない、プロジェクトがない）を出したときは、`gcloud auth login` をして、出た行をエージェントに見せます（「空で始める」とは書きません）。「Listed 0 items」と出たときは、プロジェクトの ID をエージェントと見直します。学習者の行が残っていたら、5.4 で、エージェントと一緒に移します。古い VM に入れないときは、「空で始める」と、手順書の写し（はじめに）の 1 章のこの行のそばに書いて、先に進みます。
- くわしく: [risepath_vm_deployment.md の 5 章](./risepath_vm_deployment.md)

### 2.8 main のチェックが緑かを見る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GitHub の Actions
- 先に済ませること: 2.2、2.4
- やること:
  1. Actions の画面で、main の `CI` と、`End-to-end checks` の 3 つのチェック `Database checks`・`Server stack deploy`・`Learner end-to-end` を見ます。
  2. 毎晩の実行も見ます。毎晩の実行を待たないときは、Actions の画面の左で `End-to-end checks` を選び、**Run workflow** を開いて、ブランチを `main` のまま **Run workflow** を押します。
- うまくいったとき: どれも緑の ✓ です。
- うまくいかないとき: 赤があれば、ここで止めて、エージェントに直してもらいます（VM はまだ作りません）。
- くわしく: [計画の 11.2](../brushup-2026/ai-access-plan.ja.md) の 3

## 3. アカウントと管理画面

時間がかかるもの（ドメインの切り替え）から始めます。

### 3.1 ドメインを決める

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー
- 先に済ませること: 2.1
- やること:
  1. Rise Path に使うドメインを決めます（新しいドメインがおすすめです）。アプリは `app.<domain>`、API は `api.<domain>` になります。
  2. 手順書の写し（はじめに）の 1 章の「ドメイン: 未定」を、決めたドメインに書きかえます。リポジトリのこの手順書は、エージェントがプルリクエストで書きかえます（1 章の表の下のとおりです）。
- うまくいったとき: 写しの 1 章にドメインを書きました。
- うまくいかないとき: 法人のドメインを使うときは、メールの設定（MX など）も Cloudflare に移ることを、先にエージェントと確かめます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 4

### 3.2 Cloudflare にドメインを入れる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Cloudflare と、ドメインの登録業者の画面
- 先に済ませること: 3.1
- やること:
  1. [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 4 のとおりに、ドメインを Cloudflare（Free プラン）に入れ、登録業者でネームサーバーを切り替えます。
- うまくいったとき: Cloudflare のゾーンが Active になります（最大 48 時間かかります。待つあいだに 3.3 から先へ進めます）。
- うまくいかないとき: 28 日のうちに Active にならないと、ゾーンは消えます。登録業者の画面を、エージェントと一緒に見ます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 4

### 3.3 GCP の予算アラートを入れる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GCP のコンソール
- 先に済ませること: 2.1
- やること:
  1. Billing → Budgets & alerts で、月の予算としきい値を作ります。
  2. 残っていれば、夜間停止のスケジュール `risepath-dev-schedule` を消します。
- うまくいったとき: 予算が一覧に出ます。
- うまくいかないとき: `risepath-dev-schedule` が消せないときは、出た行をエージェントに見せます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 1

### 3.4 Tailscale の古い機械を消し、ACL を決める

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Tailscale の管理画面
- 先に済ませること: 2.1
- やること:
  1. Machines で、古い `risepath-vm` を Remove します。
  2. ACL を、エージェントに作ってもらい、貼ります。5432（DB）は、だれにも開けません（DB は VM の中だけが使います）。
  3. 3006（API）と 3100（管理用の MCP）は、名前を決めた管理者だけにします。3100 は、学習者のログインも受け付け、試験運用の名簿（`PILOT_ACCOUNT_IDS`）を確かめないので、ほかの人には開けません。
  4. 8642（Hermes）と 8880（読み上げ）は開けません。
- うまくいったとき: Machines に古いものがなく、ACL に `risepath-vm` の行があります。
- うまくいかないとき: ACL の書き方がわからないときや、保存でエラーが出たときは、出た行をエージェントに見せます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「セキュリティ」

### 3.5 Anthropic の鍵を作り、使う上限を決める

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Anthropic のコンソール
- 先に済ませること: 2.1
- やること:
  1. この VM 用の API キーを作り、パスワード管理に「Rise Path Anthropic キー」としてしまいます（5.1 で使います）。
  2. 使う上限か、アラートを設定します。
- うまくいったとき: 上限が設定されています。
- うまくいかないとき: 画面の名前がちがうときは、エージェントに聞きます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「G. 運用」

### 3.6 Slack に安全の知らせの受け口を作る

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: ALERT_WATCHER、ALERT_CHECK）
- だれが・どこで: オーナー、Slack
- 先に済ませること: 2.1
- やること:
  1. 知らせ用の非公開のチャンネル（例: `#risepath-alerts`）を作ります。
  2. そのチャンネルに Incoming Webhook を作り、URL をパスワード管理に「Rise Path 知らせの受け口」としてしまいます（5.1 で stack.env の `AI_CAP_ALERT_WEBHOOK_URL` に書きます。これ 1 つで、安全の知らせ、AI の上限、控えの失敗が届きます）。
  3. 知らせを見る人と、見る頻度を決めます（例: 試験運用のあいだは平日に毎日）。決めたことを、手順書の写し（はじめに）の 1 章の P9-Q3 の「答え」に書きます（launch-record.env をなくしたときは、ここから写します）。5.2 で launch-record.env の `ALERT_WATCHER` と `ALERT_CHECK` に書きます。
- うまくいったとき: URL をパスワード管理にしまいました（チャットには貼りません）。見る人と頻度を決め、P9-Q3 に書きました。
- うまくいかないとき: Slack の画面の名前がちがうときは、エージェントに聞きます（URL は見せません）。
- くわしく: [./safety-operations.ja.md](./safety-operations.ja.md)

### 3.7 Supabase の今の設定を書き写す

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Supabase のダッシュボード（Nexloom・P-School と共有のプロジェクト）
- 先に済ませること: 2.1
- やること:
  1. Authentication の設定（Site URL、Redirect URLs、Confirm email、Allow new users to sign up、Anonymous sign-ins、パスワードの設定）を書き写します（変えません）。
  2. 11 章で変える予定のもの（Confirm email、Redirect URLs に足す 1 行、「現在のパスワード」を求める設定）を、Nexloom と P-School の担当に伝え、了解をもらいます。
  3. 匿名のログイン（Anonymous sign-ins）を止めてよいかを聞きます。答えを 1 章の P9-Q5 に書きます。
  4. ステージング用のプロジェクトを作るかを決め、1 章の P9-Q6 に書きます。作らないときは、11.2 の確かめを、8.1 のダミーのアカウントで本番のプロジェクトで行うことも書きます。
- うまくいったとき: 書き写しました。担当の了解をもらいました。
- うまくいかないとき: 匿名のログインを使うアプリがあれば、止めずに P9-Q5 にそう書きます（試験運用のあいだは、名簿が匿名のログインも断ります）。担当と連絡がつかないときは、11 章の設定を変える前に、もう一度聞きます。
- くわしく: [./byoa-setup.ja.md](./byoa-setup.ja.md)、[./account-deletion-operations.ja.md](./account-deletion-operations.ja.md)

### 3.8 控え用のバケットとサービスアカウントを作る

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: BACKUP_LIFECYCLE）
- だれが・どこで: オーナー、GCP のコンソール（エージェントと一緒に画面を見ます）
- 先に済ませること: 3.3
- やること:
  1. IAM → Service Accounts で、サービスアカウント `risepath-backup` を作ります（プロジェクトの役割は付けません）。アドレス（`risepath-backup@<プロジェクト>.iam.gserviceaccount.com`）を書き留めます（4.1 で使います）。
  2. Cloud Storage で、バケット `<プロジェクト>-risepath-backup` を作ります（場所 `asia-northeast1`、Standard、uniform bucket-level access、公開アクセスの防止を強制、バージョニングなし）。
  3. そのバケットだけに、1 のサービスアカウントの役割を 2 つ付けます: `Storage Object Creator` と `Storage Object Viewer`（消すことと上書きは、できないようにします）。
  4. バケットのライフサイクルに「30 日より古いオブジェクトを削除する」を足します（弁護士の答えが出るまで 30 日。`backup.env` の `BACKUP_RETENTION_DAYS` と同じ日数にします）。
- うまくいったとき: バケットがあり、サービスアカウントに 2 つの役割があり、ライフサイクルが 30 日です。
- うまくいかないとき: 画面の名前がちがうときは、エージェントと、[VM の README の「控え（バックアップ、Phase 9）」](../../deploy/risepath-vm/README.md)の「バケットとサービスアカウント」の行と `deploy/risepath-vm/backup.env.example` を見ます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「控え（バックアップ）」

## 4. VM を作る

### 4.1 VM を作る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Mac のターミナル（`gcloud auth login` 済み）
- 先に済ませること: 2.8、3.3、3.8
- やること:
  1. Mac のリポジトリのいちばん上のフォルダで `git pull` をしてから、`cd deploy/risepath-vm/scripts` に移ります。
  2. `export GCP_PROJECT=<プロジェクトの ID>` を実行します。
  3. `BACKUP_SA_EMAIL=<3.8 のアドレス> ./provision-gce.sh` を実行します。
  4. すでに VM があって、控えのアカウントで動いていないとき（`deploy/risepath-vm/scripts/provision-gce.sh` が「次の 3 つを順に実行します」と出したとき）は、出た 3 つのコマンド（`gcloud compute instances stop …`、`gcloud compute instances set-service-account … --scopes=cloud-platform`、`gcloud compute instances start …`）を、その順に実行します。VM が止まるあいだ、Rise Path も止まります。
- うまくいったとき: 「VM provisioned. Next steps:」が出ます（4 をしたときは、3 つのコマンドがエラーなしで終わります）。
- うまくいかないとき: 「BACKUP_SA_EMAIL が、サービスアカウントの形…ではありません」なら、3.8 で書き留めたアドレスを見直します。gcloud のエラーが出たら、その行をエージェントに見せます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) のクイックスタートの 1

### 4.2 削除の保護を入れる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GCP のコンソール（Compute Engine）
- 先に済ませること: 4.1
- やること:
  1. VM `risepath-vm` の編集で、Deletion protection（削除の保護）を入れます。
  2. VM のディスクに、スナップショットのスケジュールが付いていないことを見ます（控えは 6.4 の暗号化したものだけにします。スナップショットは、暗号化していない DB と秘密の値を、約束の期間の外に残すためです）。
- うまくいったとき: Deletion protection が On で、ディスクのスナップショットのスケジュールが空です。
- うまくいかないとき: スケジュールが付いていたら外します。外し方がわからないときは、エージェントと画面を見ます。
- くわしく: [VM の README の「控え（バックアップ、Phase 9）」](../../deploy/risepath-vm/README.md)の「ディスクのスナップショット」の行

### 4.3 ファイアウォールを確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Mac のターミナル（gcloud）
- 先に済ませること: 4.1
- やること:
  1. [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 3 のコマンドで、ファイアウォールのルールの一覧を出します。
  2. 3006・5432・3100・8642・8880 を `0.0.0.0/0` に開く受信のルールがないことを見ます。3100（管理用の MCP）は、学習者のログインも受け付け、試験運用の名簿を確かめないので、インターネットには決して開けません。
- うまくいったとき: そのような受信のルールがありません。
- うまくいかないとき: 古い `risepath-vm` のタグに付いたルールが残っていたら、エージェントと一緒に消します。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 3

### 4.4 OS Login の sudo を確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GCP の IAM
- 先に済ませること: 4.1
- やること:
  1. 自分のアカウントに `roles/compute.osAdminLogin` があることを見ます（なければ付けます）。
- うまくいったとき: 4.5 で VM に入ったあと、`sudo true` が何も言わずに終わります。
- うまくいかないとき: `sudo` でパスワードを聞かれたり、断られたりしたら、役割を見直し、SSH し直します。直らないときは、エージェントに聞きます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) のクイックスタートの 2

### 4.5 VM に入り、リポジトリを置き、1 回目の準備をする

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 3.4、4.4
- やること:
  1. [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) のクイックスタートの 2 のとおりに、SSH → Tailscale → `/opt/risepath` → clone → `bootstrap-vm.sh` の 1 回目と進めます。
  2. `exit` で抜けて、SSH し直します（docker のグループが、新しいログインから効くためです）。
- うまくいったとき: 1 回目は「==> Creating stack.env from template」と出て止まります（正しい動きです）。
- うまくいかないとき: 「Install Tailscale」で止まったら、Tailscale を入れてからもう一度実行します。ほかの行で止まったら、その行を 17 章で探し、なければエージェントに見せます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) のクイックスタートの 2

## 5. 設定のファイルと事前チェック

### 5.1 stack.env を書く

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 3.5、3.6、3.7、4.5
- やること:
  1. 先に 2 つの値を作ります（nano を開く前にします）。VM で `openssl rand -hex 24` を実行し、出た値を、パスワード管理（2 人が開けるもの）に「Rise Path POSTGRES_PASSWORD」としてしまいます。続けて `openssl rand -hex 32` を実行し、出た値を「Rise Path RISE_PATH_BRIDGE_TOKEN」としてしまいます（`POSTGRES_PASSWORD` は DB の最初の起動で固定されるので、いま決めます）。
  2. `cd /opt/risepath/deploy/risepath-vm && nano stack.env` を実行します。
  3. [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「`stack.env` に入れる値」の表のとおりに書きます。`POSTGRES_PASSWORD=` のうしろと、`DATABASE_URL_PHASE1` の中のパスワードの場所（`risepath_app:` と `@db` のあいだ）には、1 の「Rise Path POSTGRES_PASSWORD」を、`RISE_PATH_BRIDGE_TOKEN=` のうしろには「Rise Path RISE_PATH_BRIDGE_TOKEN」を、パスワード管理から貼ります。
  4. `COMPOSE_PROFILES=tts` にします。`AI_CAP_ALERT_WEBHOOK_URL` に、3.6 でしまった URL を書きます。`ANTHROPIC_API_KEY` に、3.5 の鍵を書きます。
  5. `GEMINI_API_KEY` と `GEMINI_ALLOWED` は空のままにします。`HERMES_API_KEY` と `OPENROUTER_API_KEY` も空にします（Hermes は使いません。`change-me` のままだと、事前チェックの C13 が出ます）。
  6. 公開の入り口の値（`ORIGIN_SECRET`、`TRUST_PROXY`、`LLM_ALLOWED_ORIGINS`）は、まだ書きません（7.4 で書きます）。
  7. 値は 1 行に `名前=値` の形で書きます。値に空白、引用符（`'` や `"`）、`$`、`#` は入れません（入っていると、5.3 で A5 か A14 が出ます）。URL や鍵は、そのまま貼ります（`:`、`/`、`-`、`_` は、そのままでかまいません）。保存は Ctrl+O と Enter、終わるのは Ctrl+X です。
  8. `clear` を実行します（1 で画面に出た値を消します）。
- うまくいったとき: 書けました。5.3 の事前チェックで、値のエラーが出ません。
- うまくいかないとき: 5.3 で B1・B2・C や D のコードが出たら、13 章の直し方のとおりに、ここに戻って直します。値を画面やチャットに出さないようにします。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「`stack.env` に入れる値」、`deploy/risepath-vm/stack.env.example`

### 5.2 公開の記録（launch-record.env）を作る

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: LAUNCH_STAGE）
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 5.1
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && cp launch-record.env.example launch-record.env && nano launch-record.env` を実行します。
  2. `LAUNCH_STAGE=setup` のままにします。
  3. ここまでのチェックの横の日付を写します: `VERCEL_PROTECTION_ON`（2.6）、`BACKUP_LIFECYCLE`（3.8）。`ALERT_WATCHER` と `ALERT_CHECK` には、3.6 で決めた見る人と頻度を、80 文字までの短い文で書きます。
- うまくいったとき: ファイルができ、日付を書きました。5.3 の事前チェックで A10・A11・A12 が出ません。
- うまくいかないとき: 書き方は 14 章の「書き方」を見ます。A10・A11・A12 が出たら、13 章の直し方のとおりに直します。
- くわしく: 14 章

### 5.3 事前チェックをする

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 5.1、5.2
- やること:
  1. VM で `docker version --format '{{.Server.Version}}'` と `docker compose version --short` を実行し、出た 2 つの最初の数字（いまは 29 と 5）を、GitHub の Actions で main のいちばん新しい `Server stack deploy` を開いて、「Preflight」の行の Docker と Compose の最初の数字とくらべます（CI が確かめた版と同じかを見ます。値ではないので、エージェントに見せてかまいません）。
  2. sudo を付けずに `cd /opt/risepath/deploy/risepath-vm && ./scripts/preflight.sh` を実行します（何も変えません）。
- うまくいったとき: 1 で、Docker と Compose の最初の数字が、CI と同じです。2 で、最後に「エラー 0 件」が出ます。出てよい注意: R1・M1・F9。R1 は控えがまだのため（6.4 で入れます）、M1 は Mac がまだのため（9.5 でします）、F9 は新しい DB のお知らせです。いまは直しません。
- うまくいかないとき: 1 で数字がちがうときは、デプロイせずにエージェントに相談します（[計画の 11.3](../brushup-2026/ai-access-plan.ja.md) の 2）。2 でエラーが出たら、出たコードを 13 章で見て、5.1 か 5.2 に戻って直し、もう一度 2 をします。わからないときは、出た行をそのままエージェントに見せます（値は出ません）。
- くわしく: 13 章

### 5.4 （2.7 で残っていたときだけ）古いデータを戻す

- [ ] 済んだ日: ＿＿＿＿（2.7 で「ありません」だったときは、「しない」と書きます）
- だれが・どこで: オーナーとエージェント、VM（SSH）と Mac
- 先に済ませること: 2.7、5.3
- やること:
  1. エージェントと一緒に、[risepath_vm_deployment.md の 5 章](./risepath_vm_deployment.md)のとおりに、古い DB の控えを作り、VM に移し、6.1 の前に、VM の中で戻します。
  2. 行の数が同じことを確かめたら、控えを作った Mac のフォルダで `rm risepath.dump` を実行して、Mac の控えを消します（VM の写しは、1 の手順の中で消します）。学習者のデータなので、ほかの場所には写しません。
- うまくいったとき: 戻した DB の行の数が、古い DB と同じです（エージェントが数えます）。Mac にも VM にも `risepath.dump` が残っていません。
- うまくいかないとき: 戻せないときは、空の DB で始めるかを、エージェントと決めます。決めたことを 1 章の既定 3 のそばに書きます。空の DB で始めるときも、Mac と VM の `risepath.dump` を消します。
- くわしく: [risepath_vm_deployment.md の 5 章](./risepath_vm_deployment.md)

## 6. 最初のデプロイ（Tailscale だけ）と控え

### 6.1 最初のデプロイをする

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 5.3（2.7 で残っていたときは 5.4 も）
- やること:
  1. はじめにの 2 つの確かめの 1（緑の ✓ と 7 文字）をします。
  2. `cd /opt/risepath/deploy/risepath-vm/scripts && ./bootstrap-vm.sh` を実行します（2 回目）。事前チェック → デプロイするコミット → build → DB → migration 000–021 → api → smoke → 事後の確かめ → 起動のユニット、の順に進みます（10 分ほど）。
  3. 途中の「==> デプロイするコミット: …」が、1 で書き留めた 7 文字と同じことを見ます。
- うまくいったとき: 「==> Done」と、事後の確かめの「エラー 0 件」が出ます。出てよい注意: R1・M1・F9・P6。R1・M1・F9 は 5.3 と同じ、P6 は起動のユニットのお知らせです（`bootstrap-vm.sh` がこのあと登録します）。いまは直しません。
- うまくいかないとき: 止まった行のコードを 13 章で見て直し、もう一度 2 をします。7 文字がちがうときは、そこで止めてエージェントに聞きます。コードのない行で止まったときは、17 章の「デプロイが途中で止まった」を見ます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) のクイックスタートの「2 回目の実行」

### 6.2 事後の確かめをもう一度する

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 6.1
- やること:
  1. sudo を付けずに `cd /opt/risepath/deploy/risepath-vm && ./scripts/postdeploy-check.sh` を実行します（何も変えません）。
- うまくいったとき: 「エラー 0 件」が出ます（6.1 の P6 は消えています）。
- うまくいかないとき: 出たコードを 13 章で見ます。P6 がまだ出るときは、`sudo systemctl enable risepath-stack.service` を実行してから、もう一度 1 をします。
- くわしく: 13 章

### 6.3 Mac から Tailscale で確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Mac のターミナル（Tailscale につないだもの）
- 先に済ませること: 6.1
- やること:
  1. Mac のリポジトリのいちばん上のフォルダで、`npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100` を実行します（Mac の `.env.local` は使いません）。
- うまくいったとき: 最後に「✅ VM stack smoke passed」が出ます。Kokoro・Hermes・Memanto の ⚠️ の行と、Front end の ℹ️ の行は、出てよい行です（Mac からは確かめない部品です。読み上げ（Kokoro）は、6.1 のデプロイの中で、VM が確かめています）。
- うまくいかないとき: 最後が「❌ VM stack smoke failed」のときは、❌ の行をエージェントに見せます（17 章も見ます）。つながらないときは、3.4 の ACL で、自分に 3006 と 3100 が開いているかを見ます。最後が ✅ でも、ほかの ⚠️ の行（`strict_auth_mode` や `claude-code` の行など）が出たときは、その行をエージェントに見せます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「手動でスタック操作」

### 6.4 毎日の控え（バックアップ）を動かす

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: BACKUP_KEY_COPY、BACKUP_KEY_ID）
- だれが・どこで: オーナー、VM（SSH）とパスワード管理
- 先に済ませること: 3.8、6.1
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && sudo ./scripts/install-backup.sh --new-key` を実行します。はじめてなので、設定のファイルを作って止まります（「[IB2]」。正しい動きです）。
  2. `sudo nano /etc/risepath-backup/backup.env` を実行し、`BACKUP_BUCKET=` のうしろに、3.8 のバケットの名前を書いて保存します。
  3. もう一度 `sudo ./scripts/install-backup.sh --new-key` を実行します（数分かかります）。
  4. 鍵を VM の外にしまいます: `sudo cat /etc/risepath-backup/backup.key` で出た 64 文字を、パスワード管理（2 人が開けるもの）の「Rise Path 控えの鍵」に貼り、すぐに `clear` を実行して、ターミナルを閉じます（秘密の値を画面に出すのは、この 1 回だけです）。
  5. SSH し直し、`cd /opt/risepath/deploy/risepath-vm && sudo ./scripts/install-backup.sh check-copy` を実行して、パスワード管理の鍵を貼ります（画面には出ません）。
  6. `sudo ./scripts/install-backup.sh key-id` で出た 16 文字を、launch-record.env の `BACKUP_KEY_ID` に、今日の日付を `BACKUP_KEY_COPY` に書きます（`nano launch-record.env`）。
- うまくいったとき: 3 で「✅ 最初の控えができました（…）。key id: …」、5 で「✅ 控えの鍵は合っています（key id …）。」が出ます。
- うまくいかないとき: 「[IB4]」なら、3.8 のサービスアカウントの役割を見直します。VM がそのアカウントで動いていないときは、4.1 の 4 の 3 つのコマンドをします。「[IB3]」なら、5.1 の `AI_CAP_ALERT_WEBHOOK_URL` を見ます。ほかのコードは 13 章で見ます。**この VM が 2 台目で、前の控えがバケットにあるときは、`--new-key` ではなく 16.3 をします。** 控えは毎日 3 時 23 分ごろ（日本時間）に動くので、デプロイは 3 時から 4 時を避けます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「控え（バックアップ）」、13 章の IB

### 6.5 最初の戻す練習をする

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 6.4
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && sudo ./scripts/restore-drill.sh` を実行します（バケットのいちばん新しい控えを、使い捨ての DB に戻してくらべます。本番の DB は変えません）。
- うまくいったとき: 「✅ 戻す練習は成功しました（…）」が出ます（VM が記録します）。
- うまくいかないとき: 出たコード（DR0〜DR7）を 13 章で見て直し、もう一度 1 をします。
- くわしく: 16.1

## 7. 公開の入り口（Cloudflare トンネル）

### 7.1 トンネルを作る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Cloudflare Zero Trust
- 先に済ませること: 3.2（ゾーンが Active）
- やること:
  1. [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 5 のとおりに、トンネルを作り、`api.<domain>` → `http://api:3006` だけを向けます。
  2. 画面に出たコマンドの中の、`eyJ` で始まる文字列（トークン）を、パスワード管理に「Rise Path トンネルのトークン」としてしまいます。
- うまくいったとき: トンネルの経路（Published application）が 1 つだけです。
- うまくいかないとき: ゾーンがまだ Active でないときは、3.2 を待ちます。画面がちがうときは、エージェントに聞きます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 5

### 7.2 api の入り口の設定を変える

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Cloudflare
- 先に済ませること: 7.1
- やること:
  1. `api.<domain>` に、IP の数で止めるルール（rate limit）を付けません。
  2. Bot Fight Mode を off のままにします。
- うまくいったとき: そのようなルールがなく、Bot Fight Mode が off です。
- うまくいかないとき: すでにルールがあるときは、エージェントと一緒に外します。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 6

### 7.3 tunnel.env を書く

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 7.1
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && cp tunnel.env.example tunnel.env && chmod 600 tunnel.env && nano tunnel.env` を実行します。
  2. `TUNNEL_TOKEN=` のうしろに、7.1 のトークンを貼って保存します。
- うまくいったとき: ファイルができました（7.5 の事前チェックで A のコードが出ません）。
- うまくいかないとき: 7.5 で A3・A7・A9 が出たら、13 章の直し方のとおりに直します。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 8

### 7.4 公開の入り口の値を stack.env に書く

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 6.3、7.3
- やること:
  1. VM で `openssl rand -hex 32` を実行し、出た値をパスワード管理に「Rise Path ORIGIN_SECRET」としてしまいます（8.3 で Vercel にも入れます）。
  2. `cd /opt/risepath/deploy/risepath-vm && nano stack.env` を実行し、`ORIGIN_SECRET=`（1 の値）、`TRUST_PROXY=1`、`LLM_ALLOWED_ORIGINS=https://app.<domain>`、`COMPOSE_PROFILES=tts,tunnel` を書いて保存します。
  3. `clear` を実行します。
- うまくいったとき: 書けました。
- うまくいかないとき: 7.5 で C や D のコードが出たら、13 章の直し方のとおりに、ここに戻って直します。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 9〜10

### 7.5 トンネルを入れてデプロイする

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 2.6、7.4
- やること:
  1. はじめにの 2 つの確かめの 1 をします。
  2. `cd /opt/risepath/deploy/risepath-vm && ./scripts/deploy-stack.sh` を実行し、「==> デプロイするコミット: …」の 7 文字を見ます。
- うまくいったとき: 「==> Done」と、事後の確かめの「エラー 0 件」が出ます（P5 の cloudflared も通ります）。出てよい注意: M1。いまは直しません（9.5 でします）。
- うまくいかないとき: 「[V1]」が出たら、2.6 の保護と、launch-record.env の `VERCEL_PROTECTION_ON` を見ます。「[A13]」が出たら、launch-record.env があるかを見ます（5.2）。ほかのコードは 13 章で見ます。cloudflared が healthy にならないときは、17 章を見ます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 11

### 7.6 外から直接 api に入れないことを確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Mac のターミナル
- 先に済ませること: 7.5
- やること:
  1. `curl -s -o /dev/null -w '%{http_code}\n' https://api.<domain>/api/v2/health` を実行します。
- うまくいったとき: `403` が出ます。
- うまくいかないとき: `200` が出たら、7.4 の `ORIGIN_SECRET` が入っているかを見て、7.5 をやり直します。`000` や `5xx` が出たら、17 章の「cloudflared が unhealthy」を見ます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 12

## 8. テスト用のアカウント、Vercel、最初のサインイン

### 8.1 テスト用のアカウントを作る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Supabase のダッシュボード
- 先に済ませること: 3.7
- やること:
  1. Authentication → Users の「Add user → Create new user」で、次の 4 つを作ります。「Auto Confirm User」に印を付けます。パスワードは、パスワード管理の生成で作り、そこにしまいます。
  2. 自分のアカウント（Nexloom・P-School のアカウントがないときだけ）。
  3. 大人のテスト用のアカウント。
  4. 18 歳未満のテスト用のアカウント（名前などは作りものにします。本物の子どもの情報は使いません）。
  5. ダミーのアカウント（試験運用の名簿には入れません。10.2 と 11.2 で使います）。
- うまくいったとき: 4 つが Users の一覧に出ます。
- うまくいかないとき: 画面の名前がちがうときは、エージェントに聞きます。
- くわしく: 作ったアカウントを使う手順は 9.2・10.1・10.2・11.2 です。18 歳以上と 18 歳未満のテスト用のアカウントで確かめることは、[../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「確認チェックリスト」にあります

### 8.2 （8.4 にまとめました）

この手順は 8.4 にまとめました。ここでは何もしません。

### 8.3 Vercel の本番の環境変数を書く

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Vercel の画面
- 先に済ませること: 7.6
- やること:
  1. Settings → Environment Variables の Production に、`API_ORIGIN`（`https://api.<domain>`）、`ORIGIN_SECRET`（7.4 の値）、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_DEMO_MODE=false`、`VITE_API_ENABLED=true` を入れます。
  2. `VITE_API_BASE_URL` があれば消します。Preview には何も入れません。
  3. 法務（`VITE_FEATURE_LEGAL_PAGES`）、有料プラン、職業訓練、エージェントのチャットのフラグは入れません。
- うまくいったとき: 6 つが Production だけに入っています。
- うまくいかないとき: 8.4 のビルドが止まったら、Vercel のビルドのログの `[vercel-env-guard]` の行のコード（VB で始まります）を 13 章で見ます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 13、13 章の VB

### 8.4 Redeploy して、app のアドレスの保護を確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Vercel と Cloudflare の画面、ブラウザ
- 先に済ませること: 8.3
- やること:
  1. Deployments で、いちばん新しい Production のデプロイを、ビルドキャッシュを使わずに Redeploy します。
  2. プロジェクトに `app.<domain>` を足し、Cloudflare の DNS に、Vercel が出すレコードを **DNS only（灰色の雲）** で作ります。
  3. Vercel にログインしていないブラウザ（プライベートウィンドウ）で `https://app.<domain>` を開きます。
- うまくいったとき: 1 のビルドが Ready になります。3 で、Vercel のログインの画面が出ます（Rise Path は出ません）。
- うまくいかないとき: 3 で Rise Path が出たら、すぐに 2.6 の範囲（All Deployments）を見直します。ビルドが止まったら、13 章の VB を見ます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 14〜15

### 8.5 最初のサインインと、管理者にする

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Vercel にログインしている自分のブラウザと VM（SSH）
- 先に済ませること: 8.1、8.4
- やること:
  1. 自分のブラウザで `https://app.<domain>` を開き、自分のアカウントでログインし、設定（`/settings`）を一度開きます。
  2. Supabase の Authentication → Users で、自分の User UID を写し、書き留めます（10.1 の名簿に入れます）。
  3. [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「管理者にする」の `UPDATE` を、VM で実行します。
- うまくいったとき: 3 で `UPDATE 1` が出ます。ページを読み込み直すと、設定に管理の項目が出ます。ログインの画面に「新規登録」はありません。
- うまくいかないとき: `UPDATE 0` なら、1 の設定をまだ開いていないか、User UID がちがいます。ログインできないときは、17 章を見ます。
- くわしく: [../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「管理者にする」

## 9. ほかの人が入る前の確かめ

### 9.1 （10.3 の最後に移しました）

外からの確かめ（`npm run smoke:edge`）は、Vercel の保護を外したあと（10.3 の最後）にします。ここでは何もしません。

### 9.2 ブラウザで確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Vercel にログインしている自分のブラウザ
- 先に済ませること: 8.5
- やること:
  1. [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「確認チェックリスト」の、`npm run smoke:edge` の行と「クエリ文字列が API に届く」の行（どちらも smoke の結果を使うので、10.3 でします）のほかを、上から順にします。チューターの答えが少しずつ届くこと、4.5 MB をこえるファイルのアップロード、読み上げ、`/ai-safety`、P-School の画像、18 歳以上と 18 歳未満のテスト用のアカウントでの確かめです。
  2. ログインの画面に「新規登録」がないことも見ます。
- うまくいったとき: チェックリストの全部に印が付きました。
- うまくいかないとき: 印の付かない項目があれば、ここで止めて、その項目と出た画面をエージェントに見せます（17 章も見ます）。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「確認チェックリスト」

### 9.3 AI の質を確かめる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、自分のブラウザ
- 先に済ませること: 9.2
- やること:
  1. 大人のテスト用のアカウントで、いくつかのレッスンの AI チューターと、作文のフィードバックを試します。
- うまくいったとき: 学習者に出してよい、と判断しました。
- うまくいかないとき: 質が足りないと思ったら、ここで止めて、エージェントと相談します（モデルを変えるときは、エージェントが変えます）。
- くわしく: [計画の 15 章](../brushup-2026/ai-access-plan.ja.md)

### 9.4 試しの知らせを送る

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: ALERT_TEST）
- だれが・どこで: オーナー、VM（SSH）と Slack
- 先に済ませること: 3.6、6.1
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env exec -T api node scripts/send-test-alert.mjs` を実行します。
  2. Slack のチャンネルに「【Rise Path】安全の知らせのテストです。…」が届いたら、`nano launch-record.env` で `ALERT_TEST` に今日の日付を書きます。
- うまくいったとき: 1 で「送りました（…の受け口へ）。」が出て、Slack に届きます。
- うまくいかないとき: 「受け口が設定されていません」なら、stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書き（5.1）、`./scripts/deploy-stack.sh` を実行してから（はじめにの 2 つの確かめをします）、もう一度 1 をします。「送れませんでした」なら、Slack の受け口の URL を見直します（3.6）。
- くわしく: [./safety-operations.ja.md](./safety-operations.ja.md)

### 9.5 Mac の .env.local を開発用の DB にする

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: MAC_DEV_DB_SEPARATE）
- だれが・どこで: オーナー（とエージェント）、開発に使う Mac と、VM（SSH。4 だけ）
- 先に済ませること: 6.1
- やること:
  1. 18 章の「Mac の開発用の DB」のとおりに、Mac に開発用の DB を作り、`.env.local` の `DATABASE_URL_PHASE1` をそれにします。
  2. 開発に使うどの Mac でも、`.env.local` には `risepath-vm` も `nexloom-gce` も、Tailscale のアドレス（`100.` で始まるもの）も使いません。Mac のリポジトリのいちばん上のフォルダ（`.env.local` があるフォルダ）で、`grep -n -E 'risepath-vm|nexloom-gce|@100\.' .env.local | grep -o -E '^[0-9]+:[A-Z0-9_]*'` が何も出さないことを見ます（出るのは、行の番号と名前だけです。値は出ません）。
  3. 同じフォルダで `npm run env:check` を実行し、「## Database target (no secrets)」の下の `host:` が `127.0.0.1` であることを見ます（値は出ません）。
  4. VM で `cd /opt/risepath/deploy/risepath-vm && nano launch-record.env` を実行し、`MAC_DEV_DB_SEPARATE` に今日の日付を書きます。
- うまくいったとき: 2 で何も出ません。3 で `host: 127.0.0.1` が出て、「this is the production database」と「Tailscale address」の行が出ません。
- うまくいかないとき: 2 で `12:DATABASE_URL_PHASE1` のような行が出たときは、`.env.local` のその名前の行（名前が出ないときは、その番号の行）を直してから、もう一度 2 からします。`DATABASE_URL_PHASE1` の行は、開発用の DB（18 章）に直します。ほかの名前の行（`HERMES_API_URL`、`MEMANTO_URL`、`KOKORO_TTS_URL` など、前の手順で書いた VM の部品のアドレス）は、その行を消すか、エージェントと一緒に `127.0.0.1` の値にします。名前の出ない行は、その番号の行を開いて見ます（コメントの行なら消します。ほかは、上と同じように直します）。3 で `host:` が `127.0.0.1` でないときは、`DATABASE_URL_PHASE1` の行を開発用の DB に直します。`.env.local` の行の中身は、チャットに貼りません（本番のパスワードが入っていることがあります）。わからないときは、2 と 3 で出た行だけをエージェントに見せて、18 章を見ます。
- くわしく: 18 章

### 9.6 公開の段階を pilot にする

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: LAUNCH_STAGE）
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 9.2、9.3、9.4、9.5
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && nano launch-record.env` を実行し、`LAUNCH_STAGE=pilot` に書きかえて保存します。
  2. sudo を付けずに `./scripts/preflight.sh` を実行します。
- うまくいったとき: 「エラー 0 件」が出ます。出てよい注意はありません。
- うまくいかないとき: エラーか、R3 の注意が出たら、`LAUNCH_STAGE=setup` に書き戻してから直します。R3 なら 16.1 の戻す練習をします。launch-record.env の名前が出たら、14 章で済ませます。ほかのコードは 13 章で見ます。直したら、もう一度 1 からします。
- くわしく: 14 章、16.1

## 10. 試験運用（スタッフと大人のテスターだけ）

試験運用のあいだ、Rise Path を使えるのは、スタッフと大人のテスターだけです（1 章の D1）。アプリの新規登録は、コードで閉じています（ログインの画面に「新規登録」はありません）。それでも、Supabase は Nexloom・P-School と共有なので、そのアカウント（子どものものも）ではログインできてしまいます。そこで、サーバーに試験運用の名簿（`PILOT_ACCOUNT_IDS`）を入れ、名簿にない人には「このアカウントは、いまの試験運用の対象ではありません」のページを出します。名簿を入れて確かめてから（10.1・10.2）、Vercel の保護を外します（10.3）。試験運用を始めたら、12.4 のふだんの作業（毎週のログ、4 週間ごとの戻す練習など）も始めます。テスターの学習の記録があるためです。

### 10.1 試験運用の名簿を入れる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Supabase の画面と VM（SSH）
- 先に済ませること: 9.6
- やること:
  1. Supabase の Authentication → Users を開き、名簿に入れる人の User UID（`8-4-4-4-12` の形の ID）を写します。入れる人: 自分（8.5 で書き留めたもの）、安全の知らせを見る人と管理者（管理のページも名簿で守られます）、スタッフ、8.1 の大人のテスト用のアカウントです。8.1 のダミーと、18 歳未満のテスト用のアカウントは入れません。
  2. VM で `cd /opt/risepath/deploy/risepath-vm && nano stack.env` を実行し、いちばん下に `PILOT_ACCOUNT_IDS=` の 1 行を足して、= のうしろに User UID をカンマで区切って続けます（空白は入れません。例: `PILOT_ACCOUNT_IDS=<1 人目の User UID>,<2 人目の User UID>`）。保存は Ctrl+O と Enter、終わるのは Ctrl+X です。同じ 1 行を、パスワード管理にも「Rise Path 試験運用の名簿」としてしまいます（VM をなくしたとき、16.3 で戻します）。
  3. GitHub の main のいちばん上のコミットに緑の ✓ があることを見て、その 7 文字（例: `a1b2c3d`）を書き留めます。
  4. sudo を付けずに `./scripts/deploy-stack.sh` を実行します。途中に出る「==> デプロイするコミット: …」の 7 文字が、3 で書き留めた 7 文字と同じことを見ます。
  5. `docker compose --env-file stack.env logs api | grep '\[Pilot\]'` を実行します。
- うまくいったとき: 4 で「==> Done」と、事後の確かめの「エラー 0 件」が出ます。出てよい注意はありません。5 で「[Pilot] on: N accounts」が出ます。N は名簿にある User UID の数です（同じ User UID を 2 回書いたときは、1 と数えます）。名簿が効いていることは、次の 10.2 で確かめます。
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
  4. Mac のターミナルで、Rise Path のリポジトリのフォルダ（`package.json` があるいちばん上のフォルダ）に `cd` で移り、`PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge` を実行します（`<domain>` は 3.1 で決めたドメインに置きかえます）。終わりに出る `docker compose --env-file stack.env logs api | grep smoke=…` の行を、VM で `cd /opt/risepath/deploy/risepath-vm` のあとに実行し、1 行出たら、[確認チェックリスト](../../deploy/vercel/README.md)の「クエリ文字列が API に届く」と `npm run smoke:edge` の 2 つの項目に印を付けます（9.2 で残した 2 つです）。
- うまくいったとき: 2 で Rise Path のはじめのページ（右上に「ログイン」のボタンがあるページ）が出ます。Vercel のログインの画面ではありません。「ログイン」を押しても、「新規登録」はありません。3 で「エラー 0 件」が出ます。出てよい注意はありません。4 で「0 failed」が出て、4 の grep で 1 行出ます。
- うまくいかないとき: 2 で Vercel のログインの画面が出たら、1 の範囲をもう一度見ます。3 で「[V1]」が出たら、名簿が読めていません。Vercel の保護を 2.6 のとおりにかけ直し、`VERCEL_PROTECTION_OFF` を空に戻してから、10.1 を見直します。4 で「Missing script」や「package.json」の行が出たら、フォルダがちがいます。4 のフォルダに移って、もう一度します。4 で ❌ が出たら、番号を 17 章の表で見て、わからないときは番号と出た行をエージェントに見せます。4 の grep で何も出ないときは、17 章の表の 8 番を見ます。テスターは、ここまで済むまで足しません。
- くわしく: 13 章の V1・V3、`deploy/vercel/README.md`

### 10.4 テスターを足す

- [ ] 済んだ日: ＿＿＿＿（テスターを足した日を、そのたびに書きます）
- だれが・どこで: オーナー、Supabase の画面と VM（SSH）
- 先に済ませること: 10.3
- やること:
  1. 8.1 と同じ方法で、テスターのアカウントを作ります（Authentication → Users の「Add user → Create new user」、「Auto Confirm User」に印。パスワードはパスワード管理の生成で作ります）。パスワードは、会って、または電話で伝えます（メールアドレスと同じメッセージでは送りません）。Nexloom や P-School のアカウントをすでに持っているスタッフは、作らずにその User UID を使います。
  2. VM で `cd /opt/risepath/deploy/risepath-vm && grep '^PILOT_ACCOUNT_IDS=' stack.env | cut -d= -f2- | tr ',' '\n' | tr 'A-F' 'a-f' | sort -u | grep -c .` を実行し、出た数を N（いま名簿にある人数）として書き留めます（出るのは数だけで、User UID は出ません。api と同じように、大文字と小文字は同じ人、同じ User UID は 1 人と数えます）。
  3. `nano stack.env` を実行し、`PILOT_ACCOUNT_IDS` の行のいちばん最後に、カンマに続けてその人の User UID を足します（空白は入れません）。パスワード管理の「Rise Path 試験運用の名簿」も、同じ 1 行に直します。
  4. 10.1 の 3 と 4 と同じように、✓ と 7 文字を見てから `./scripts/deploy-stack.sh` を実行します。**デプロイは、そのときの main の新しいコミットも入れ、アプリが 1 分ほど止まります。授業や学習の時間を避けます。**
  5. デプロイが済んだら、`docker compose --env-file stack.env logs api | grep '\[Pilot\]'` を実行し、最後の「[Pilot] on: N accounts」の N を見ます（4 のデプロイで api が新しくなったので、この行が出ます）。
  6. テスターが抜けるとき: 名簿から消す前に、その人に、Rise Path の学習の記録を消すかどうかを聞きます。次に、2 のとおりに N を書き留め、3 のとおりに stack.env を開いて、その User UID と、そのとなりのカンマを 1 つ消し（パスワード管理の名簿も同じに直します）、4 のとおりにデプロイします（そのあとは、その人がログインしても使えず、何も記録されません）。5 のとおりに、N が 1 つ減ったことを見ます。減っていないときは、ここで止めて、記録は消さずに、エージェントに聞きます。記録を消すと決めたときは、N が減ったのを見てから、エージェントと一緒に VM で `scripts/delete-account-data.mjs` を使います（手順書 18 章）。
- うまくいったとき: 4 で「==> Done」と、事後の確かめの「エラー 0 件」が出ます。出てよい注意はありません。足したときは、5 の N が、2 で書き留めた N より 1 つ多くなっています。テスターがログインすると、ふだんのホームが出ます。抜けたときは、6 で N が 1 つ減ります（その人がログインしても、「このアカウントは、いまの試験運用の対象ではありません」のページが出ます）。
- うまくいかないとき: テスターに「このアカウントは、いまの試験運用の対象ではありません」が出たら、3 で名簿の User UID を見直して、4 をもう一度します。5 で N が増えないときは、4 で「==> Done」が出たかを見ます。出ていたら、その User UID が、もう名簿に入っていないかを見ます（同じ User UID は 1 と数えます）。6 で N が減らないときは、記録を消さずに、エージェントに聞きます。事前チェックのコードは 13 章で見ます。
- くわしく: 8.1、13 章の V2

### 10.5 安全の知らせを見始める

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: 3.6 で決めた、知らせを見る人（Slack と、自分のブラウザ）
- 先に済ませること: 9.4、10.1
- やること:
  1. 3.6 で決めた頻度で、Slack のチャンネルを見ます。届くのは、安全の知らせ（学習者の文は入りません）、AI の上限の 80% と 100%、控えの失敗と遅れです。
  2. 管理者のアカウントで `https://app.<domain>/settings/admin/safety` を一度開きます。
- うまくいったとき: 決めた頻度で見ています。2 で、安全のページが開きます。
- うまくいかないとき: 2 で「このアカウントは、いまの試験運用の対象ではありません」が出たら、その人の User UID を 10.4 のとおりに名簿に足します。知らせが来たときの動き方は、[./safety-operations.ja.md](./safety-operations.ja.md) を見ます。
- くわしく: [./safety-operations.ja.md](./safety-operations.ja.md)

### 10.6 外からの死活監視を始める

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、外形監視のサービス（UptimeRobot など）
- 先に済ませること: 10.3（保護を外したあとで始めます。保護があるあいだは、監視がいつも失敗するためです）
- やること:
  1. `https://app.<domain>/api/v2/health` を、5 分ごとに見る監視を作り、止まったときの知らせ先をオーナーのメールにします。
- うまくいったとき: 監視の画面で「Up」になっています。
- うまくいかないとき: 「Down」のままなら、プライベートウィンドウで同じ URL を開き、`{"ok":true,…}` が出るかを見ます。出ないときは、17 章の「cloudflared が unhealthy」を見ます。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「G. 運用」

### 10.7 拠点のスタッフに説明する

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、拠点
- 先に済ませること: 10.4
- やること:
  1. 共有の端末では、使い終わったらログアウトすることを伝えます。
  2. 復習の「覚えた」や XP は、学んだことの証明書ではないことを伝えます。
  3. 安全の知らせや、学習者の困りごとを、だれに伝えるかを伝えます（3.6 の見る人）。
- うまくいったとき: 説明しました。
- うまくいかないとき: 質問に答えられないときは、エージェントと答えを用意し、もう一度説明します。
- くわしく: [./safety-operations.ja.md](./safety-operations.ja.md)

### 10.8 戻ってくる学習者に知らせる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー
- 先に済ませること: 10.4
- やること:
  1. 前の VM で Rise Path を使っていた方に、「前の学習の記録は、新しい Rise Path にはありません」と伝えます（2.7 で古いデータを移したときは、伝えません）。
- うまくいったとき: 伝えました。
- うまくいかないとき: 記録について聞かれたら、2.7 の結果をエージェントと見直します。
- くわしく: 2.7

## 11. 一般の登録を開く前に

### 11.1 弁護士の確認と、法務の文の準備

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: MINORS_POLICY_DECIDED）
- だれが・どこで: 弁護士、オーナー、エージェント（Mac のリポジトリと、プルリクエスト）
- 先に済ませること: 6.4
- やること:
  1. 弁護士に、利用規約とプライバシーポリシーの下書きと、[../legal/README.md](../legal/README.md) の「弁護士に確かめること（Phase 4）」と「弁護士に確かめること（Phase 9）」を見てもらいます。
  2. 【要記入】（連絡先、控えを残す日数など）を書き入れ、【要確認】を解決します。
  3. エージェントと一緒に、[../legal/README.md](../legal/README.md) の「ページを公開する手順」の 2〜5（`shared/legal/versions.js`、公開の文を作る、版の控え）をします。
  4. 18 歳未満が使うときの決まり（年齢の線、保護者の同意など）を、弁護士と決めます。決めた日を、1 章の表の下と、launch-record.env の `MINORS_POLICY_DECIDED` に書きます（18 歳未満がまだ使わなくても、public の前に要ります）。
- うまくいったとき: `node scripts/legal/check-legal-release.mjs` が何も出しません。`MINORS_POLICY_DECIDED` に日付があります。
- うまくいかないとき: 何か出たら、出た行のとおりに文を直し、もう一度 3 をします。弁護士の答えを待つあいだは、試験運用を続けます（12.1〜12.3 へは進みません。12.4 のふだんの作業は続けます）。
- くわしく: [../legal/README.md](../legal/README.md) の「ページを公開する手順」

### 11.2 ご本人の削除を有効にする（エージェントと一緒に）

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: SUPABASE_CURRENT_PASSWORD_ON、PASSWORD_CHANGE_CHECK、PROD_AMR_CHECK）
- だれが・どこで: オーナーとエージェント、Supabase のダッシュボード、Mac のターミナル（エージェントが出すコマンド）と VM（SSH）
- 先に済ませること: 3.7、8.5
- やること:
  1. Supabase で「Require current password when updating」（画面の表示名は【要確認】。パスワードを変えるときに、今のパスワードを求める設定）を入れ、`SUPABASE_CURRENT_PASSWORD_ON` に今日の日付を書きます。
  2. エージェントと一緒に、[計画の 8.2](../brushup-2026/ai-access-plan.ja.md) の 2 と 3 の確かめをします。ステージングのプロジェクトがなければ、2 つとも、本番のプロジェクトで 8.1 のダミーのアカウントを使います（あるときは、8.2 の 2 はステージングで、3 は本番でします）。
     - エージェントは、Mac のターミナルに貼るコマンドを出します。コマンドは、ダミーのパスワードを画面に出さずにたずね（`read -rs`）、ダミーでサインインして、結果の 2 行だけを出します。
     - トークンとパスワードは、画面にも出ず、チャットにも貼りません。オーナーは、出た 2 行だけをエージェントに見せます。
     - amr は、ログインのトークンに入っている「ログインのしかたの記録」です。パスワードでログインしたときは、`password` と書かれます。
     - 通ったときの 2 行は、amr に `password` があることと、パスワードの変更が `400 current_password_required` で断られたことです。通った日を `PASSWORD_CHANGE_CHECK` と `PROD_AMR_CHECK` に書きます。
  3. `cd /opt/risepath/deploy/risepath-vm && nano stack.env` で、`ACCOUNT_DELETION_ENABLED=true` を書きます。
  4. はじめにの 2 つの確かめの 1 をしてから、`./scripts/deploy-stack.sh` を実行します。
- うまくいったとき: 「==> Done」と、事後の確かめの「エラー 0 件」が出ます。出てよい注意はありません。設定の「アカウントを削除する」を開くと、「いまはこの画面から削除できません」が出ません。
- うまくいかないとき: 事前チェックで「[G1]」が出たら、出た名前の日付を 14 章のとおりに書きます（1 の日付が、2 の日付より前か同じ日です）。2 の確かめが通らないときは、`ACCOUNT_DELETION_ENABLED` を書かずに、エージェントと 1 の設定を見直します（パスワードの変更が断られなかったときは、ダミーのパスワードが変わっているので、8.1 のとおりに作り直します）。
- くわしく: [./account-deletion-operations.ja.md](./account-deletion-operations.ja.md) の 7 章、[計画の 8.2](../brushup-2026/ai-access-plan.ja.md)

### 11.3 法務の版を、すぐに VM にデプロイする

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、GitHub と VM（SSH）
- 先に済ませること: 11.1
- やること: 法務の版を変えるプルリクエストをマージしたら、すぐに VM で `deploy-stack.sh` を実行します。Vercel はマージで先に新しい画面を出すので、VM が追いつくまで、新しい版には同意できません（409）。
  1. 法務の版を変えるプルリクエストを、マージします。
  2. はじめにの 2 つの確かめの 1 をしてから、すぐに `cd /opt/risepath/deploy/risepath-vm && ./scripts/deploy-stack.sh` を実行します。
- うまくいったとき: 「==> Done」と、事後の確かめの「エラー 0 件」が出ます。出てよい注意はありません。同意のページが 409 になりません。
- うまくいかないとき: 同意のページで 409 が出るときは、17 章の「409 legal_not_published / legal_version_mismatch」を見ます。
- くわしく: [../legal/README.md](../legal/README.md) の「ページを公開する手順」の 6〜7

### 11.4 確認のメールを入れる

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Supabase のダッシュボード（Nexloom・P-School の担当の了解のあと）
- 先に済ませること: 3.7
- やること:
  1. Authentication の Email で、「Confirm email」（メールアドレスの確認）を入れます。
  2. 送る人（SMTP）を設定し、確認のメールの文（Email Templates の「Confirm signup」。画面の表示名は【要確認】）を日本語にして、保存します。
- うまくいったとき: Authentication の Email で「Confirm email」が入り、SMTP の設定が保存されています。確認のメールの文が日本語です。メールが本当に届くかは、登録を開いたあと（12.2 の 4）に確かめます（いまはアプリの登録が閉じていて、8.1 のアカウントは確認済みなので、確認のメールは送られません）。
- うまくいかないとき: 設定が保存できないときは、出た画面をエージェントに見せます。ほかのアプリの担当が困るときは、入れる日を一緒に決め直します。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「G. 運用」

### 11.5 Supabase の Redirect URL を足す

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Supabase のダッシュボード
- 先に済ませること: 3.7、8.4
- やること:
  1. Authentication → URL Configuration の Redirect URLs に、`https://app.<domain>/auth/callback` を**足します**（ほかのアプリの URL は消しません）。
  2. Site URL は、Nexloom・P-School の担当が了解したときだけ変えます。
- うまくいったとき: 一覧に `https://app.<domain>/auth/callback` が足されています。
- うまくいかないとき: 担当が了解しないときは、Site URL は変えずに進めます（Rise Path の確認のメールは、Redirect URL を使います）。
- くわしく: [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の手順 16

### 11.6 問い合わせ先を決める

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Vercel の画面
- 先に済ませること: 3.1
- やること:
  1. 学習者の問い合わせ先（フォームの `https://` の URL か、`mailto:` のアドレス 1 つ）と、読む人と頻度を決めます。規約の【要記入: 連絡先】と同じ窓口にします。
  2. Vercel の Production に `VITE_SUPPORT_CONTACT` を入れ、ビルドキャッシュを使わずに Redeploy します。
- うまくいったとき: 設定の「このサービスについて」に、その問い合わせ先が出ます。
- うまくいかないとき: ビルドのログに VB のコードが出たら、13 章を見ます。
- くわしく: [./account-deletion-operations.ja.md](./account-deletion-operations.ja.md)

### 11.7 消えたログインの一覧を 1 回見る

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 6.1
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --orphans --limit 20` を実行します（`--yes` は付けません。何も消しません）。
- うまくいったとき: 一覧が出ます（0 件でもかまいません）。
- うまくいかないとき: エラーの行が出たら、エージェントに見せます。消すかどうかは、エージェントとガイドの 4 章を読んでから決めます。
- くわしく: [./account-deletion-operations.ja.md](./account-deletion-operations.ja.md) の 4 章

### 11.8 一般公開の前の事前チェック

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: LAUNCH_STAGE）
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 11.1〜11.7（11.8 と 12.1 は、同じ日に続けてします。あいだで VM を再起動すると、名簿のないまま api が動き出すためです）。1 章の P9-Q5 で、匿名のログインを止められなかったときは、計画の 13.5 の「匿名のセッションを断るコード」が main に入っていること（エージェントに聞きます。入っていなければ、ここで止まり、試験運用を続けます）
- やること:
  1. `cd /opt/risepath/deploy/risepath-vm && nano launch-record.env` で `LAUNCH_STAGE=public` に書きかえます。
  2. `nano stack.env` で、`PILOT_ACCOUNT_IDS` の行を消します（名簿は、パスワード管理の「Rise Path 試験運用の名簿」に残しておきます）。
  3. sudo を付けずに `./scripts/preflight.sh` を実行します。
- うまくいったとき: 「エラー 0 件」が出ます。出てよい注意: F5（2 で stack.env を変えたため。12.1 のデプロイで消えます）。いまは直しません。続けて 12.1 をします。
- うまくいかないとき: エラーが出たら、`LAUNCH_STAGE=pilot` と `PILOT_ACCOUNT_IDS` の行を元に戻してから直します。R3 なら 16.1 の戻す練習をします（public では、前の練習から 35 日をこえるとエラーです）。launch-record.env の名前が出たら、14 章で済ませます。ほかのコードは 13 章で見ます。直したら、もう一度 1 からします。
- くわしく: 14 章、16.1

## 12. 公開の日と、そのあと

### 12.1 公開する

- [ ] 済んだ日: ＿＿＿＿（launch-record.env: VERCEL_LEGAL_PAGES_ON）
- だれが・どこで: オーナー、Vercel の画面と VM（SSH）
- 先に済ませること: 11.8（今日、エラー 0 件）
- やること:
  1. はじめにの 2 つの確かめの 1 をします。
  2. Vercel の Production に `VITE_FEATURE_LEGAL_PAGES=true` を入れ、ビルドキャッシュを使わずに Redeploy します。
  3. `cd /opt/risepath/deploy/risepath-vm && nano launch-record.env` で、`VERCEL_LEGAL_PAGES_ON` に今日の日付を書きます。
  4. **すぐに** `./scripts/deploy-stack.sh` を実行します。
- うまくいったとき: 2 のビルドが Ready になります。4 で「==> Done」と、事後の確かめの「エラー 0 件」が出ます。出てよい注意はありません。`docker compose --env-file stack.env logs api | grep '\[Pilot\]'` の最後の行が「[Pilot] off」です。プライベートウィンドウのログインの画面に、「新規登録」と同意のチェックが出ます。
- うまくいかないとき: 2 のビルドが止まったら、ログの `legal-release-guard` か `[vercel-env-guard]` の行を見ます（VB は 13 章）。2 のビルドを今日のうちに直せないときは、11.8 の「うまくいかないとき」のとおりに、`LAUNCH_STAGE=pilot` と `PILOT_ACCOUNT_IDS` の行を元に戻します（3 と 4 はまだしていないので、それだけで元どおりです。Vercel の `VITE_FEATURE_LEGAL_PAGES` は消して、登録を閉じたままにします）。4 が事前チェックで止まったら: Vercel の `VITE_FEATURE_LEGAL_PAGES` を消して Redeploy し（登録をまた閉じます）、launch-record.env の `VERCEL_LEGAL_PAGES_ON` を空に、`LAUNCH_STAGE=pilot` に戻し、stack.env に `PILOT_ACCOUNT_IDS` の行（パスワード管理の「Rise Path 試験運用の名簿」）を戻して `./scripts/deploy-stack.sh` を実行し、出た行をエージェントに見せます。
- くわしく: [../legal/README.md](../legal/README.md) の「ページを公開する手順」の 9

### 12.2 公開のあとの確かめ

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナー、Mac のターミナルと VM（SSH）、自分のブラウザ（プライベートウィンドウ）とメール、Supabase のダッシュボード
- 先に済ませること: 12.1
- やること:
  1. Mac のリポジトリのいちばん上のフォルダで、`PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge` を実行します。
  2. VM で `cd /opt/risepath/deploy/risepath-vm && ./scripts/postdeploy-check.sh` を実行します。
  3. 安全の知らせのチャンネル、10.6 の監視、Anthropic の使った額を見ます。
  4. プライベートウィンドウで `https://app.<domain>` を開き、「ログイン」を押して「新規登録」から、使い捨ての（本当に届く、ほかのアプリで使っていない）メールアドレスで 1 回登録します。届いた確認のメールのリンクを押します。確かめたら、そのアカウントで、設定の「アカウントを削除する」から Rise Path の記録を消し、Supabase の Authentication → Users で、そのアカウントも消します。
- うまくいったとき: 1 で「0 failed」、2 で「エラー 0 件」が出ます。3 で、知らせと監視がふだんどおりです。4 で日本語の確認のメールが届き、リンクで `https://app.<domain>` に戻ってログインできます。
- うまくいかないとき: 1 の ❌ の番号は 17 章の表で見ます。2 のコードは 13 章で見ます。4 でメールが届かないときは 11.4 の SMTP と文を、リンクでエラーになるときは 11.5 の Redirect URL を、エージェントと見直します。
- くわしく: 17 章

### 12.3 あとで決めること

- [ ] 済んだ日: ＿＿＿＿（決めたときだけ。launch-record.env: DECIDED_BYOA、DECIDED_MEMORY、DECIDED_BILLING）
- だれが・どこで: オーナー（弁護士とエージェントと一緒に）
- 先に済ませること: 12.1
- やること:
  1. API とリモートの MCP でも同意を確かめるか（`LEGAL_TERMS_REQUIRED`。[../legal/README.md](../legal/README.md) の「ページを公開する手順」の 11）を決めます。
  2. AI アプリの接続（BYOA）、学習の記憶（Memanto）、有料プランを使うかを決めます。使うと決めたら、その日を `DECIDED_BYOA`・`DECIDED_MEMORY`・`DECIDED_BILLING` に書き、エージェントと、それぞれの手順書で入れます。
- うまくいったとき: 決めたことと日付を、1 章の表の下に書きました。
- うまくいかないとき: 決められないあいだは、何も入れません（事前チェックの S2〜S4 が、入れたものを止めます）。
- くわしく: `deploy/risepath-vm/stack.env.example`、[./byoa-setup.ja.md](./byoa-setup.ja.md)

### 12.4 ふだんの作業

- [ ] 済んだ日: ＿＿＿＿（毎月の 1 回目に、その月の日付を書きます）
- だれが・どこで: オーナー
- 先に済ませること: 6.5（12.1 を待たずに、試験運用のあいだもします）
- やること:
  1. 毎週: VM で `cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env logs --since 168h api | grep -c -E 'ERROR|Error'` で、エラーの行の数を見ます。
  2. 4 週間ごと（前の練習と同じ曜日）: 16.1 の戻す練習をします。前の練習から 35 日をこえると、事前チェックが R3 を出し、public ではデプロイが止まります。
  3. 毎月: 11.7 の一覧を見ます。
  4. 1 年に 1 回か、漏れたかもしれないとき: 15 章の表のとおりに、秘密の値を取り替えます。
  5. GitHub から毎晩の実行が赤だと知らせが来たら、エージェントに直してもらいます。
  6. デプロイは、控えの動く 3 時から 4 時（日本時間）を避けます。
- うまくいったとき: 毎月の日付が書いてあります。
- うまくいかないとき: 1 でエラーが多いときや、2 が失敗したときは、出た行をエージェントに見せます（17 章も見ます）。
- くわしく: 15 章、16.1、17 章

## 13. 事前チェックと確かめのコード

事前チェック（`deploy/risepath-vm/scripts/preflight.sh`）が出すコードです。「表示」は画面に出る文のとおりです（{names} には設定の名前、{file} にはファイルの名前、{line} には行の番号、{gb} には GB の数、{n} には何個目かの番号が入ります。値は出ません）。種類が「エラー」のものがあると、デプロイは止まります。「注意」と「お知らせ」では止まりません。

- 事前チェックは、sudo を付けずに `cd /opt/risepath/deploy/risepath-vm && ./scripts/preflight.sh` で実行します。何も変えません。
- 段階（setup・pilot・minors・public）は、launch-record.env の `LAUNCH_STAGE` です（14 章）。
- わからないときは、出た行をそのままエージェントに見せます（値は出ません）。
- この章の表の D1〜D9 は事前チェックのコードです。1 章の決めたこと（D1〜D8）とは別の番号です。決めたことを指すときは「1 章の D3」のように書きます。
- DB0・DB1 と P で始まるコードは、デプロイ（`deploy-stack.sh`）の中と、そのあとの確かめ（事後の確かめ、`deploy/risepath-vm/scripts/postdeploy-check.sh`）が出します。事後の確かめは、デプロイの最後に自動で動きます。あとからもう一度見るときは、sudo を付けずに `cd /opt/risepath/deploy/risepath-vm && ./scripts/postdeploy-check.sh` で実行します（何も変えません）。P のエラーは、デプロイが Rise Path を新しい版に入れ替えたあとに見つかったものです（Rise Path は動いたままです。P5 は、部品が動き出すのを待つところで出ることもあります）。
- VB で始まるコードは、VM ではなく、Vercel のビルドが出します（Phase 9 の Vercel の確かめ。Vercel の画面の、そのデプロイのビルドのログに、`vercel-env-guard` の名前とコードが付いた英語の行で出ます。値は出ません）。見るのは Vercel の Environment Variables の名前です。エラーがあると、そのビルドは止まり、いま公開している版がそのまま動きます。直したら、Vercel の画面で Redeploy します。注意では止まりません。Redeploy のビルドが最後まで進み（Vercel の画面で Ready になります）、ログにその VB の行が出なければ、直っています。また出るときは、出た行をそのままエージェントに見せます（値は出ません）。VB の確かめは、一般向けのアプリの Vercel のプロジェクトのためのものです。
- BK・JO・IB・DR・RS で始まるコードは、控え（バックアップ）の道具が出します（1 章の D4）。BK と JO は、VM が毎日と 1 時間ごとに自動で動かす控え（`backup.sh`）のもので、`sudo journalctl -u risepath-backup -n 50`（JO は `-u risepath-backup-journal`）で見られます。失敗すると、その手順のコード（例: BK7）を付けて、Slack に 1 行の知らせが届きます。IB は控えの設定（`sudo ./scripts/install-backup.sh`、手順書 6.4）、DR は戻す練習（`sudo ./scripts/restore-drill.sh`、手順書 16.1）、RS は本番の DB を戻すとき（`restore-db.sh`、エージェントと。手順書 16.2）に、画面に出ます。IB・DR・RS のコマンドと、直し方の `./scripts/…` や `docker compose …` は、`cd /opt/risepath/deploy/risepath-vm` のあとで実行します。時刻と、`--date`・`--from` の日付は日本時間です。コードの下の「わけ」の行は、そのとき足りなかったものを、値を出さずに書いています。IB・DR・RS は、直したら、同じコマンドをもう一度実行し、✅ の行が出れば直っています。BK は、直したら `sudo systemctl start risepath-backup.service` を実行します（数分かかり、そのあいだ何も出ません）。何も出さずに終われば直っています（`sudo journalctl -u risepath-backup -n 5` に「✅ 毎日の控えができました」の行が出ます。英語の「Job for … failed」が出たときは、直っていません）。JO は、次の 1 時間のあとに `sudo journalctl -u risepath-backup-journal -n 5` に「✅ 削除の記録を控えました」の行が出れば直っています。また出るときは、出た行をそのままエージェントに見せます（値は出ません）。

| コード | 種類 | 表示 | 説明 | 直し方 |
|---|---|---|---|---|
| A1 | エラー | stack.env がありません。 | デプロイと事前チェックは、この VM の設定を stack.env から読みます。 | `cp stack.env.example stack.env && chmod 600 stack.env` を実行し、手順書 5.1 のとおりに書きます。 |
| A2 | エラー | CI 用のファイル（ダミーの値）が、VM の設定に入っています（{file}） | CI のダミーの値のままでは、ログインも AI も動きません。 | `deploy/risepath-vm/ci/` のファイルは VM では使いません。`stack.env.example` から作り直します。 |
| A3 | エラー | {file} の改行が Windows の形（CRLF）です。 | Windows のメモ帳などで保存すると、行の終わりに見えない文字が付き、シェルがそれを命令として読みます。 | VM で `sed -i 's/\r$//' {file}` を実行します。 |
| A4 | 注意（launch-record.env で、14 章の名前が 2 回あるときはエラー） | {file} に同じ名前が 2 回あります（{names}） | 同じ名前が 2 つあると、どちらの値が使われるかが、読む道具によってちがいます。launch-record.env では下の行が使われるので、14 章の名前が 2 回あるとエラーです（日付を書いた行の下にテンプレの空の行が残っていると、その確かめは「まだ」と読まれます）。日付は、その名前の行の = のうしろに書きます。 | 1 つだけ残します（launch-record.env では、いまの状態に合う行を残し、テンプレの空の行や古い行を消します）。 |
| A5 | エラー | {file} の {names} の値に、記号（$、空白、引用符など）があります（シェルが値を書きかえるか、命令として実行します） | stack.env は、デプロイのときにシェルが読みます。記号があると、値が変わったり、値が画面に出たりします。ほかのファイル（tunnel.env など）も、Compose が $ などを書きかえます。日本語入力の全角の空白も同じです（Compose は値の最後の全角の空白を消し、シェルは消さないので、値が変わります）。空の値のうしろや、タブのうしろに # を書いたときも、シェルと Compose で値がちがうので、エラーです。' ' で囲んだ値の最後が `\` のときは、Compose が値の終わりを見つけられず、デプロイが止まって値が画面に出るので、エラーです。 | `openssl rand -hex 32` のような英数字だけの値にします。どうしても記号が要るときは、値を ' ' で囲みます（囲んだ値の最後の文字を `\` にはしません）。stack.env の `PILOT_ACCOUNT_IDS` のときは、空白を消し、User UID をカンマだけで区切ります（手順書 10.1）。 |
| A6 | 注意 | 知らない名前があります（打ちまちがいかもしれません）: {names}（{file}） | 名前を打ちまちがえると、その設定は使われません。 | `{file}.example` とくらべて直すか、要らない行なら消します。 |
| A7 | 注意（読めないときはエラー） | {file} の権限が 600 でないか、持ち主がちがいます。 | 秘密の値のファイルは、デプロイする人だけが読めるようにします。デプロイする人が読めないとき（sudo で作ったときなど）は、確かめもデプロイもできないので、エラーです。 | `chmod 600 {file}` を実行します。`Operation not permitted` と出たとき（sudo で作ったファイル）は、エージェントに相談します。 |
| A8 | エラー | {names} が、ちがうファイルに入っています（{file}） | ちがうファイルに書くと、その値がほかのコンテナにも渡ります。billing.env の名前は api にも渡り、stack.env の同じ名前より強くなります。 | `TUNNEL_TOKEN` は tunnel.env だけ、`STRIPE_`・`BILLING_` は billing.env だけに書きます。billing.env には、ほかに `AI_CAP_SUPPORTER_GLOBAL_` の名前だけを書けます。 |
| A9 | エラー | {file} の {line} 行目が読めません（「名前=値」の形ではありません） | 値だけを貼った行や「名前: 値」の行は、シェルが命令として実行し、その行を画面に出します。nano では、保存は Ctrl+O と Enter、終わるのは Ctrl+X です。 | `nano +{line} {file}` で開き、その行を直すか消します（値だけを貼った行かもしれません）。 |
| A10 | 注意（14 章の名前と 1〜2 文字だけちがうときはエラー） | launch-record.env に知らない名前があります（{names}） | 名前を打ちまちがえると、その記録は読まれません。14 章の名前と 1〜2 文字だけちがう名前（大文字と小文字のちがいも）は、打ちまちがいとみてエラーにします（たとえば保護を外した日が読まれないと、V1 の確かめが働きません）。 | 手順書 14 章の表とくらべて直します。 |
| A11 | エラー | launch-record.env の {names} が読めません（日付は 2026-11-02 の形、段階は setup・pilot・minors・public） | 日付と段階は、決まった書き方でないと読めません。数字と - と = は半角で書きます（全角の数字は読めません）。段階は名前だけを書き、前やうしろに空白（日本語入力の全角の空白も）や、ほかの言葉（`setup → pilot` など）を入れません（うしろの「 # メモ」は書けます）。key id は 0〜9 と a〜f の 16 文字（手順書 6.4 の `sudo ./scripts/install-backup.sh key-id` で出たまま）、見る人と頻度は 80 文字までの 1 行です。 | 手順書 14 章の書き方に直します。 |
| A12 | エラー | launch-record.env の {names} の日付が、今日より先です。 | まだしていない確かめの日付は書きません。 | 確かめをした日を書きます。 |
| A13 | 最初のデプロイの前で tunnel がないときは注意、ほかはエラー | launch-record.env がありません。 | 公開の記録がないと、どの段階の決まりで確かめるかがわかりません。 | `cp launch-record.env.example launch-record.env` を実行し、手順書の写し（はじめに）のチェックの横に書いた日付を写します（手順書 14 章）。 |
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
| S2 | エラー | AI アプリの接続（byoa）は、最初の公開では使いません。 | 最初の公開では、AI アプリの接続を使わないと決めました（1 章の D3）。 | byoa を外します。使うと決めたら、`DECIDED_BYOA` に決めた日を書きます（手順書 12.3）。 |
| S3 | エラー | 学習の記憶（Memanto）は、最初の公開では使いません。 | 最初の公開では、学習の記憶を使わないと決めました（1 章の D3）。`MEMANTO_ENABLED` は、`false` か空でないと入ったままです。 | `COMPOSE_PROFILES` から memory を外し、stack.env の `MEMANTO_*` の行は `stack.env.example` のとおりにします（`MEMANTO_ENABLED=false`）。使うと決めたら、`DECIDED_MEMORY` に決めた日を書きます（手順書 12.3）。 |
| S4 | エラー | 有料プランは、最初の公開では止めておきます。 | 最初の公開では、有料プランを止めておくと決めました（1 章の D3）。 | billing.env の `BILLING_ENABLED` を空にし、本番の鍵（`_live_`）は入れません。使うと決めたら、`DECIDED_BILLING` に決めた日を書きます（手順書 12.3）。 |
| S5 | 注意 | 読み上げ（tts）が `COMPOSE_PROFILES` にありません。 | 最初の公開では、読み上げを使うと決めました（1 章の D3）。 | tts を足します（最初の公開で使うと決めました）。 |
| S6 | pilot から注意 | tunnel がないので、外から使えません。 | pilot からは、トンネルで外から使えるようにします。 | 手順書 7.4 のとおり `tts,tunnel` にします。 |
| G1 | エラー | アカウントの削除を有効にする前の確かめが、記録にないか、順番がちがいます（{names}） | 削除を有効にする前に、パスワードの確かめが正しく動くことを確かめます。 | Supabase の設定 → パスワードの変更の確かめ → 本番の amr の確かめ、の順に済ませて日付を書きます（手順書 11.2）。 |
| G2 | エラー | 同意の確かめ（`LEGAL_TERMS_REQUIRED`）を入れる前の記録がありません（{names}） | 同意のページが出る前に同意を求めると、学習者が何もできなくなります。 | 先に Vercel のフラグを入れて同意のページを確かめ、日付を書きます（手順書 12.3）。 |
| G3 | public か、`VERCEL_LEGAL_PAGES_ON` があるときエラー | 規約を公開するのに、ご本人の削除が止まっています。 | 規約で約束しているので、ご本人が自分で削除できるようにします。 | 手順書 11.2 を済ませ、`ACCOUNT_DELETION_ENABLED=true` にします。VM を作り直しているとき（手順書 16.3）は、11.2 はしなおしません。16.3 の 7 より前なら、launch-record.env の `VERCEL_LEGAL_PAGES_ON` を 7 まで空にします。7 のあとなら、16.3 の 6 のとおりに、stack.env に `ACCOUNT_DELETION_ENABLED=true` を書きます。 |
| G5 | minors と public でエラー | この段階に入る前の確かめが、記録にありません（{names}） | 18 歳未満も使える段階（minors と public）に入る前に、18 歳未満が使うときの決まりを決めます（pilot の次が public でも要ります）。 | 手順書 14 章の表でその確かめをして、日付を書きます。 |
| K1 | pilot は注意、minors からエラー | 安全の知らせの受け口がありません。 | 安全の知らせが届かないと、だれも気づけません。 | Slack の受け口の URL を stack.env の `AI_CAP_ALERT_WEBHOOK_URL` に書きます（手順書 3.6）。 |
| K3 | 注意 | 知らせの受け口が Slack ではありません（{names}） | Slack 以外の受け口は、この手順書では確かめていません。 | Slack のチャンネルの Incoming Webhook にします。 |
| K4 | pilot は注意、minors からエラー | 知らせを見る人と頻度が、記録にありません（{names}） | 知らせを見る人と頻度を決めておかないと、届いても見逃します。 | launch-record.env に書きます（手順書 3.6）。 |
| K5 | pilot は注意、minors からエラー | 試しの知らせが届いたことが、記録にありません。 | 受け口の URL がまちがっていても、試すまでわかりません。 | 手順書 9.4 のとおり試しの知らせを送り、届いたら launch-record.env の `ALERT_TEST` に日付を書きます。 |
| M1 | setup は注意、pilot からエラー | 開発用の Mac が本番の DB を使っていないことが、記録にありません。 | 開発の Mac が本番の DB を使うと、学習者のデータを書きかえるおそれがあります（1 章の D8）。 | Mac の `.env.local` を開発用の DB にして、launch-record.env の `MAC_DEV_DB_SEPARATE` に日付を書きます（手順書 9.5）。 |
| R1 | setup は注意、pilot からエラー | 毎日の控え（バックアップ）が動いていません。 | 控えのタイマー、鍵、設定のファイルのどれかがありません。 | 最初のデプロイのあとで、手順書 6.4 のとおりに入れます（最初のデプロイの前は、これで正しい状態です）。 |
| R2 | pilot から注意 | 最後の控えが 36 時間より前か、失敗しています。 | 控えが止まると、VM をなくしたときに戻せません。この記録は VM が自動で残します（launch-record.env には書きません）。 | `sudo journalctl -u risepath-backup` を見て、エージェントに相談します（手順書 17 章）。 |
| R3 | pilot・minors は、記録がないとエラー、35 日より前は注意。public はどちらもエラー。本番の DB を戻すときの最初の確かめ（RS0）では、どちらも注意 | 控えから戻す練習の記録がないか、35 日より前です。 | 控えから本当に戻せるかは、戻してみるまでわかりません。この記録は VM が自動で残します（launch-record.env には書きません）。 | `sudo ./scripts/restore-drill.sh` を実行します（手順書 16.1）。 |
| R4 | pilot からエラー | 控えの鍵を VM の外にしまったことが、記録にないか、いまの鍵とちがいます（鍵がないと戻せません） | 鍵がないと、控えは読めません。 | 手順書 6.4 の鍵の手順をして、launch-record.env の `BACKUP_KEY_COPY` に日付を、`BACKUP_KEY_ID` に key id を書きます。VM を作り直したとき（手順書 16.3）は、`--new-key` はしません。16.3 の 2 のとおりに、`sudo ./scripts/install-backup.sh key-id` で出た 16 文字を `BACKUP_KEY_ID` に書きます（`BACKUP_KEY_COPY` は 6.4 の日付のままです）。 |
| R5 | pilot からエラー | 控えを消す日数（バケットのライフサイクル）が、記録にありません。 | 控えを残す日数は、プライバシーポリシーと合わせます。 | 手順書 3.8 のとおりに設定し、launch-record.env の `BACKUP_LIFECYCLE` に日付を書きます。 |
| R6 | pilot からエラー | 控えが失敗したときの知らせの受け口がありません。 | 控えが失敗しても、知らせが届きません。 | stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書いてから、`sudo ./scripts/install-backup.sh` をもう一度実行します（手順書 6.4）。 |
| R8 | 注意 | 控えのタイマーが止まっています（入れてありますが、いまは動いていません）。 | 控えのタイマーは入れてあるのに、止まっています。本番の DB を戻すコマンドが DB を変えたあとで止まると、こうなります（そのあいだは、R9 も出ます）。このままでは、毎日の控えも、1 時間ごとの削除の記録も作られず、知らせも届きません。 | 戻し（restore-db.sh）の途中でなければ、`sudo systemctl start risepath-backup.timer risepath-backup-journal.timer` で動かします。戻しの途中なら、エージェントと続きをします（手順書 16.2）。 |
| R9 | デプロイのときはエラー、事前チェックだけを実行したときは注意 | 本番の DB を戻している途中です（restore-db.sh が途中で止まっています）。 | 本番の DB を戻すコマンド（restore-db.sh）が、DB を戻しかけたところで止まっています（/var/lib/risepath-backup/restore-in-progress があります）。削除の記録をまだ当て直していない DB を学習者に見せないように、デプロイを止めます。そのあいだは、毎日の控えも作りません。同じ戻しのコマンドの最初の確かめでは、注意として出ます（止まりません）。 | デプロイはしません。エージェントと、同じ restore-db.sh のコマンドで続きをします（手順書 16.2）。 |
| V1 | setup は注意（tunnel があるとエラー）、pilot・minors はエラー | 外から入れるのに、試験運用の参加者だけに絞れていません。 | 試験運用のあいだは、スタッフと大人のテスターだけが使えるようにします（1 章の D1）。Supabase は Nexloom・P-School と共有なので、そのアカウントでもログインできます。外から入れるようにする前に、Vercel の保護か、試験運用の名簿（`PILOT_ACCOUNT_IDS`）のどちらかで守ります。名簿は、すべての項目が ID の形のときだけ数えます。 | Vercel の保護（All Deployments）をかけたままにする（launch-record.env の `VERCEL_PROTECTION_ON` に日付、`VERCEL_PROTECTION_OFF` は空。手順書 2.6）か、stack.env に試験運用の名簿 `PILOT_ACCOUNT_IDS` を入れます（手順書 10.1）。保護は、名簿を確かめてから外します（手順書 10.3）。保護を外したあと（`VERCEL_PROTECTION_OFF` に日付があるとき）は、名簿を戻します（VM を作り直したときは手順書 16.3）。日付を消すのは、Vercel で保護を本当にかけ直したときだけです。 |
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
| VB11 | 注意（Vercel のビルド） | ORIGIN_SECRET is shorter than 32 characters. | `ORIGIN_SECRET` は、VM の stack.env と同じ合言葉です（`openssl rand -hex 32` で作ると 64 文字です）。VM では、32 文字より短い値は事前チェック（コード D3）が止め、api も動き出しません。ですから、Vercel の値が短いときは、VM の値と同じではありません（貼り付けるときに切れた、など）。このままだと、Vercel を通る /api の呼び出しは、すべて断られます（403）。ビルドは止まりません。 | エージェントと一緒に、VM の stack.env の `ORIGIN_SECRET` と同じ値を、Vercel の Production の `ORIGIN_SECRET` に入れ直し、Redeploy します（手順書 15 章）。値はチャットに貼りません。値が漏れたかもしれないときだけ、VM と Vercel の両方を新しい値に取り替えます（手順書 15 章）。 |
| BK1 | エラー（毎日の控え） | 控えを始める前の確かめで止まりました（設定、鍵、DB、ディスクの空きのどれかです）。 | 毎日の控えは、root で、backup.env のバケット、VM の鍵、healthy な DB のコンテナ、前の控え（DB とアップロードされたファイル）の 2 倍と 1 GB の空きがそろってから始めます。どれが足りないかは「わけ」の行に出ます。 | 「わけ」の行のとおりに直します。わからないときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| BK2 | エラー（毎日の控え） | 控えの前に、DB の行の数を数えられませんでした（まだ何も作っていません）。 | 控えの前に、9 つの表の行の数を数えます（あとで戻す練習が、この数とくらべます）。 | DB が動いているかを `cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env ps` で見ます（db の行の STATUS に healthy とあれば動いています）。動いているのに出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| BK3 | エラー（毎日の控え） | DB の控え（pg_dump）か、その暗号化が失敗しました（外には何も送っていません）。 | DB を pg_dump で書き出し、そのまま暗号化します。デプロイで DB のコンテナが作り直されると、その夜の控えは失敗します（デプロイは 3 時〜4 時をさけます）。 | デプロイと重なったときは、`sudo systemctl start risepath-backup.service` で作り直します。また出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| BK4 | エラー（毎日の控え） | 控えのあとに、DB の行の数を数えられませんでした（外には何も送っていません）。 | 控えのあとに、もう一度行の数を数えます。 | デプロイと重なったときは、`sudo systemctl start risepath-backup.service` で作り直します。また出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| BK5 | エラー（毎日の控え） | アップロードされたファイル（uploads）の控えか、その暗号化が失敗しました（外には何も送っていません）。 | アップロードされたファイル（uploads のボリューム）を tar にまとめ、暗号化します。最初のデプロイの前は、ボリュームがまだありません。控えの最中にファイルが変わったとき（アップロードか削除）は、⚠️ の行を出して続けます（そのファイルは、変わる前か後のどちらかで控えます）。 | `sudo systemctl start risepath-backup.service` で作り直します。また出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| BK6 | エラー（毎日の控え） | 控えの目録（manifest.json）を作れませんでした（外には何も送っていません）。 | 控えの目録（時刻、コミット、migration、行の数、大きさ、SHA-256、key id）を作ります。個人のデータは入りません。 | `sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| BK7 | エラー（毎日の控え） | 控えを Google Cloud のバケットに送れないか、送ったあとの大きさが合いません。 | 2 つのファイルと、鍵で暗号化した目録の写しを送って大きさを確かめ、最後に目録を送ります。目録がない組は、そろっていない控えとして使いません。VM のサービスアカウントか、バケットの 2 つの役割がちがうと出ます。 | サービスアカウントの 2 つの役割と、backup.env のバケットの名前を見直します（手順書 3.8）。VM を BACKUP_SA_EMAIL なしで作ったときは、手順書 4.1 の 3 つのコマンドで控えのサービスアカウントを付けます。直らないときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| BK8 | エラー（毎日の控え） | VM の中の古い控えを消せませんでした（外への控えはできています）。 | 外への控えはできています。VM の中の、古い控え（3 日より前）と、戻す練習や戻しの古い作業のフォルダ、戻す前に書き出した古い削除の記録（backup.env の BACKUP_RETENTION_DAYS の日数より前）を消すところで止まりました。 | `sudo ls -l /var/backups/risepath` で出た行と、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| JO1 | エラー（1 時間ごとの削除の記録） | 削除の記録（1 時間ごと）を控えられませんでした。 | 1 時間ごとに、アカウントの削除、学習の記録の消去、1 つのレッスンのやり直し、保護者の同意の取り消し、AI アプリの切断の記録（id、時刻、だれの頼みか、レッスンの名前だけ。名前やメールは入りません）を、暗号化してバケットに送ります。DB を戻したあと、この記録で、控えのあとの削除をもう一度当てます。 | 次の 1 時間で直ることがあります。2 回続けて知らせが来たときは、`sudo journalctl -u risepath-backup-journal -n 50` で出た行をエージェントに見せます（手順書 17 章）。 |
| JO2 | 注意（Slack に知らせます） | 毎日の控え（バックアップ）が 36 時間できていません。 | 最後の毎日の控えが 36 時間より前です。バケットの控えは、ライフサイクルの日数（backup.env の BACKUP_RETENTION_DAYS と同じ日数。「わけ」の行に出ます）で消えるので、止まったままだと、VM の外の控えがなくなります。12 時間ごとに知らせます。 | その日のうちに `sudo journalctl -u risepath-backup -n 50` を見て、エージェントに相談します。止まったまま、バケットのライフサイクルの日数（backup.env の BACKUP_RETENTION_DAYS の日数。「わけ」の行に出ます）を過ぎると、VM の外の控えがなくなります（手順書 17 章）。 |
| IB0 | エラー（控えの設定） | 控えの設定を続けられません（指定のまちがいか、Docker か systemd が答えません）。 | 付けた指定（`--new-key` など）がちがうか、鍵を作る Docker、タイマーを入れる systemd が答えないと止まります。どれかは「わけ」の行に出ます。 | 「わけ」の行のとおりに直して、もう一度実行します。Docker か systemd のときは、`sudo docker ps` と `systemctl status risepath-backup.timer` で出た行をエージェントに見せます（手順書 6.4）。 |
| IB1 | エラー（控えの設定） | 控えの設定は、sudo を付けて実行します。 | 控えの設定は、/etc と systemd を変えるので、sudo が要ります。 | `sudo ./scripts/install-backup.sh` のように、前に sudo を付けて、もう一度実行します（手順書 6.4）。 |
| IB2 | エラー（控えの設定） | 控えの設定のファイル（/etc/risepath-backup/backup.env）に、バケットの名前がないか、形がちがいます。 | はじめての実行では、設定のファイルを作って止まります（正しい動きです）。バケットの名前を書いてから、もう一度実行します。 | `sudo nano /etc/risepath-backup/backup.env` でバケットの名前を書いてから、もう一度実行します（手順書 6.4）。 |
| IB3 | エラー（控えの設定） | 失敗の知らせの受け口がありません（https の URL が見つかりません）。 | 控えが失敗したときの知らせは、安全の知らせと同じ Slack に送ります。https の受け口がないと、控えを入れません。 | stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書いてから、もう一度実行します（手順書 3.6）。 |
| IB4 | エラー（控えの設定） | バケットに試しのファイルを送れません（VM のサービスアカウントか、バケットの設定です）。 | VM からバケットに、1 行の試しのファイルを送り、大きさを読み返します。 | VM のサービスアカウントと、バケットの 2 つの役割を見直します（手順書 3.8）。VM を BACKUP_SA_EMAIL なしで作ったときは、手順書 4.1 の 3 つのコマンドで控えのサービスアカウントを付けます。直らないときは、出た行をエージェントに見せます（手順書 17 章）。 |
| IB5 | エラー（控えの設定） | 鍵の確かめで止めました（鍵がないか、鍵どうしが合いません。鍵は変えていません）。 | 鍵がないと、控えは読めません。今までの控えを読めなくする操作（鍵の上書き、別の鍵での始め直し）は、止めます。どれに当たったかは「わけ」の行に出ます。 | 「わけ」の行のとおりにします。新しい VM で、前の控えがあるときは、`--new-key` ではなく `--import-key` で、しまっておいた鍵を戻します（手順書 16.3）。 |
| DR0 | エラー（戻す練習） | 戻す練習を始められません（sudo、設定、鍵、Docker、ディスクの空きのどれかです）。 | 戻す練習は、root で、鍵と Docker がそろい、読み出す控えと練習用の DB（DB の控えの 10 倍と 2 GB）のディスクの空きがあるのを、控えを読み出す前に確かめてから始めます。 | 「わけ」の行のとおりに直してから、`sudo ./scripts/restore-drill.sh` をもう一度実行します（手順書 16.1）。 |
| DR1 | エラー（戻す練習） | バケットから、使える控えを読み出せません（ないか、36 時間より前か、読めません）。 | バケットから、いちばん新しい、そろった控え（目録と 3 つのファイル）を選び、目録の形を確かめます。何も付けないときは、36 時間より前の控えでは成功にしません（毎日の控えが動いていることも確かめるためです）。`--date` の日付は日本時間の日です。 | 「わけ」が 36 時間より前のときは、毎日の控えが止まっています。`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。「わけ」がトークンかサービスアカウントの役割のときは、サービスアカウントの 2 つの役割を見直します（手順書 3.8）。控えがまだないときは、手順書 6.4 の最初の控えを先にします。 |
| DR2 | エラー（戻す練習） | 読み出した控えが、目録（manifest.json）と合いません（ファイルが壊れているか、書きかえられています）。 | 読み出したファイルの SHA-256 と大きさを目録とくらべ、目録を、鍵で暗号化した目録の写しとくらべます（鍵を持たない人が書いた目録は使いません）。 | もう一度実行します。また出るときは、その控えは使えません。出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。 |
| DR3 | エラー（戻す練習） | 練習用の DB を動かせません（Docker）。 | 練習用の DB は、ネットワークのない、使い捨てのコンテナです。本番の DB には触りません。 | `sudo docker ps -a` を実行し、出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。 |
| DR4 | エラー（戻す練習） | 控えを練習用の DB に戻せませんでした（鍵がちがうか、控えが壊れています）。 | 控えを復号して、練習用の DB に pg_restore で戻します。控えの目録の key id が、この VM の鍵の key id とちがうときは、控えを読み出す前に、ここで止まります（「わけ」の行に 2 つの key id が出ます）。控えが壊れているときは、復号か pg_restore で止まります。 | `sudo ./scripts/install-backup.sh key-id` の key id が、launch-record.env の `BACKUP_KEY_ID` と同じかを見て、エージェントに相談します（手順書 16.1）。 |
| DR5 | エラー（戻す練習） | 戻した DB の中身が、目録と合いません（文字コード、migration、行の数のどれかです）。 | 戻した DB の文字コード（UTF8）、すべての migration、9 つの表の行の数（目録の数の前後 5 行か 1 %）を確かめます。 | 出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。 |
| DR6 | エラー（戻す練習） | アップロードされたファイルの控えを読めないか、ファイルの数が目録と合いません。 | アップロードされたファイルの控えを復号し、ファイルの数を目録とくらべます。 | 出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。 |
| DR7 | 注意（戻す練習の片付け） | 練習用の DB か、読み出した控えを片付けられませんでした。 | 練習が終わると、練習用の DB と読み出した控えを必ず片付けます。片付けられなかったときだけ出ます（練習の結果は上の行のとおりです）。 | `sudo docker rm -f -v risepath-drill-db` を実行します。また出るときは、出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。 |
| RS0 | エラー（本番の DB を戻すとき。エージェントと） | 戻す前の確かめで止めました（まだ何も変えていません）。 | 戻す前に、事前チェックと、指定（--from、--yes-replace-production-database）と、鍵とバケットを確かめます。まだ何も変えていません。この事前チェックは戻しのためのもので、戻す練習の記録（R3）は注意だけです（控えが止まっていると、練習もできないためです）。 | 「わけ」の行のとおりに直します。事前チェックのエラーのときは、先にそれを直します（エージェントと。手順書 16.2）。 |
| RS1 | エラー（本番の DB を戻すとき。エージェントと） | 戻しの途中の印を書くか、控えのタイマーを止めるか、動いている控えが終わるのを待つところで止まりました（DB はまだ変えていません）。 | 戻すあいだに控えが動かないように、戻しの途中の印（/var/lib/risepath-backup/restore-in-progress）を書き、2 つのタイマーを止め、動いている控えが終わるのを 15 分まで待ちます。印があるあいだは、VM を再起動しても控えを作らず、デプロイは R9 で止まります。DB を戻す直前（RS5 の前）にも印を書きかえます。そこで書けないときも RS1 で、DB はまだ変えていません。 | 「わけ」の行と、`systemctl status risepath-backup.service` で出た行をエージェントに見せます（手順書 16.2）。 |
| RS2 | エラー（本番の DB を戻すとき。エージェントと） | Rise Path の部品（api、mcp など）を止められませんでした（DB はまだ変えていません）。 | 戻すあいだは、VM の再起動のときの起動（risepath-stack.service）を切り、api、mcp、mcp-public、cloudflared を止めます（再起動しても、学習者には見えません）。アプリは「つながりません」の画面になります。 | `cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env ps` で出た行をエージェントに見せます（手順書 16.2）。 |
| RS3 | エラー（本番の DB を戻すとき。エージェントと） | 戻す前の、削除の記録の書き出しができませんでした（DB はまだ変えていません）。 | 戻す前に、いまの DB から削除の記録を書き出し、書き出したファイルが VM にあるのを確かめます。DB のコンテナが止まっているとき（戻しの途中で VM を再起動したあと）は、DB のコンテナだけを動かしてから書き出します（ほかの部品は止めたままです）。DB が答えるのに書き出せないときは、削除を失わないように止めます。 | DB が答えるのに書き出せないときは、戻しを続けません。出た行をエージェントに見せます（手順書 16.2）。 |
| RS4 | エラー（本番の DB を戻すとき。エージェントと） | 戻す控えを選べないか、読み出した控えか削除の記録が、読めないか目録か鍵と合いません（DB はまだ変えていません）。 | 控えを選んで、目録の形と鍵の key id を確かめ、ファイルを目録と、目録を暗号化した写しとくらべ、最後まで復号します。次に、控えのあとの削除の記録（戻す前の書き出し、バケットの記録、バケットに送れずに VM に残った 1 時間ごとの記録）を集めて復号します（RS8 で当て直すものです。読めないときは、DB を変える前にここで止まります）。それから、時刻（日本時間）と数と読んだ記録の数を見せて、yes を待ちます。`--from` の日付は日本時間の日です。 | 「わけ」の行をエージェントに見せ、`--from` で使う控えを決め直します。バケットの削除の記録が読めないとき（一覧かトークン）は、VM のサービスアカウントとバケットの権限をエージェントと直してから、同じコマンドでもう一度します（手順書 16.2）。 |
| RS5 | エラー（本番の DB を戻すとき。エージェントと） | DB を控えから戻せませんでした（DB は空か、途中です）。 | DB を作り直して、控えを pg_restore で戻します。ここからは、DB は控えの中身になっています。ここから先で止まると、戻しの途中の印、タイマー、再起動のときの起動は、そのままにします（DB を変える前に止まったときは、元に戻します）。 | ここから先はエージェントと進めます。DB は空か途中なので、同じコマンドに `--current-db-lost` を付けて、もう一度はじめから戻します（最初に書き出した削除の記録も使います。手順書 16.2）。 |
| RS6 | エラー（本番の DB を戻すとき。エージェントと） | アップロードされたファイルを控えから戻せませんでした。 | --with-uploads のときだけ、アップロードされたファイルを戻します。 | 出た行をエージェントに見せます。同じコマンドで、もう一度はじめから戻せます（手順書 16.2）。 |
| RS7 | エラー（本番の DB を戻すとき。エージェントと） | 戻した DB の migration が失敗しました。 | 控えのあとに増えた migration を当てます（部品はまだ動かしません）。 | 出た行をエージェントに見せます。同じコマンドで、もう一度はじめから戻せます（手順書 16.2）。 |
| RS8 | エラー（本番の DB を戻すとき。エージェントと） | 削除の記録をもう一度当てるところで止まりました（Rise Path は止めたままです）。 | 控えのあとの削除（アカウント、学習の記録の消去、1 つのレッスンのやり直し）を、時刻の順にもう一度当てます（記録は RS4 で集めてあります）。保護者の同意の取り消しか AI アプリの切断の記録があると、この版では何も変えずに止まります（エージェントと手で戻します）。控えのあとの記録が 1 つもないとき（控えのすぐあとに DB がなくなったときなど）は、0 行として確かめ、⚠️ の行を出します。もとの時刻は日本時間で出ます。 | 出た数と行をエージェントに見せます。DB が答えなかったとき（終わりの番号が 3）は、少し待って、同じコマンドで、もう一度はじめから戻します。削除の記録の行が読めなかったとき（終わりの番号が 1。何行目かが出ます）は、その行をエージェントと調べてから、同じコマンドで、もう一度はじめから戻します（手順書 16.2）。 |
| RS10 | エラー（本番の DB を戻すとき。エージェントと） | 控えのタイマーと、再起動のときの起動を元に戻すか、戻したあとの控えを作るところで失敗しました（戻しは済んでいます）。 | 戻しの途中の印を消し、再起動のときの起動とタイマーを元に戻し、戻した DB の控えを 1 つ作ります。失敗しても、学習者が使えるように、先にデプロイ（RS11）をします。 | `sudo systemctl enable risepath-stack.service` と `sudo systemctl start risepath-backup.timer risepath-backup-journal.timer` を実行し、出た行をエージェントに見せます（手順書 16.2）。 |
| RS11 | エラー（本番の DB を戻すとき。エージェントと） | 戻したあとのデプロイ（deploy-stack.sh）が失敗しました（戻しと、削除の記録の当て直しは済んでいます）。 | 戻した DB で、ふつうのデプロイをします。ここで止まっても、戻しと削除の当て直しは済んでいます。 | 上に出たデプロイのコードを手順書 13 章で見て、エージェントとデプロイを直します。public で「[R3]」で止まったときは、`sudo ./scripts/restore-drill.sh` を実行し（RS10 で作った新しい控えで練習します）、それから `./scripts/deploy-stack.sh` を実行します（手順書 16.2）。 |

## 14. 確かめの記録（launch-record.env）

VM の `deploy/risepath-vm/launch-record.env` は、オーナーが確かめをした日の記録です。git には入れません。秘密の値は書きません。事前チェックだけが読みます。

- 作り方: VM で `cd /opt/risepath/deploy/risepath-vm && cp launch-record.env.example launch-record.env` を実行します（手順書 5.2）。
- 書き方: 確かめをした日を `名前=YYYY-MM-DD`（例: `ALERT_TEST=2026-11-02`）で書きます。数字と - と = は半角で書きます（日本語入力を切ってから打ちます）。日付は、その名前の行の = のうしろに書きます（同じ名前の行を新しく足すと、エラー（A4）になります）。まだのものは空のままにします。`LAUNCH_STAGE` は段階の名前だけ（前やうしろに空白や → を入れません）、`BACKUP_KEY_ID` は 0〜9 と a〜f の 16 文字の key id、`ALERT_WATCHER` と `ALERT_CHECK` は 80 文字までの短い文です。
- 同じ日付を、手順書の写し（はじめに）のチェックの横にも書きます。ファイルをなくしたとき（VM を作り直したときなど）は、もう一度 `cp` をして、写しのチェックの横の日付を写します。日付でない 4 つは、チェックの横にはないので、次のところから書きます: `LAUNCH_STAGE` はいまの段階（VM を作り直したときは手順書 16.3 の 1 と 7 のとおり）、`ALERT_WATCHER` と `ALERT_CHECK` は手順書 3.6 で決めたこと（1 章の P9-Q3 の答え）、`BACKUP_KEY_ID` は `sudo ./scripts/install-backup.sh key-id` で出る 16 文字（VM を作り直したときは、鍵を戻した手順書 16.3 の 2 のあと）です。

| 名前 | 日本語の名前 | 書く手順 | いつから必要か | 書く例 |
|---|---|---|---|---|
| `LAUNCH_STAGE` | 公開の段階 | 手順書 5.2・9.6・11.8 | いつも（読めないとエラー） | `LAUNCH_STAGE=setup` |
| `VERCEL_PROTECTION_ON` | Vercel の保護をかけた日 | 手順書 2.6 | setup から（stack.env に試験運用の名簿 `PILOT_ACCOUNT_IDS` を入れるまでは、ないと V1） | `VERCEL_PROTECTION_ON=2026-11-02` |
| `VERCEL_PROTECTION_OFF` | Vercel の保護を外した日 | 手順書 10.3 | 手順書 10.3 で保護を外した日に書きます（それまでは空。名簿がないのに書くと V1）。public では必要です（V3） | `VERCEL_PROTECTION_OFF=2026-11-20` |
| `ALERT_WATCHER` | 安全の知らせを見る人 | 手順書 3.6 | pilot は注意、minors からエラー（K4） | `ALERT_WATCHER=事務局の当番（2 人）` |
| `ALERT_CHECK` | 安全の知らせを見る頻度 | 手順書 3.6 | pilot は注意、minors からエラー（K4） | `ALERT_CHECK=平日の 10 時と 16 時` |
| `BACKUP_LIFECYCLE` | 控えのバケットのライフサイクルを入れた日 | 手順書 3.8 | pilot から（R5） | `BACKUP_LIFECYCLE=2026-11-03` |
| `BACKUP_KEY_COPY` | 控えの鍵を VM の外にしまった日 | 手順書 6.4 | pilot から（R4） | `BACKUP_KEY_COPY=2026-11-05` |
| `BACKUP_KEY_ID` | 控えの鍵の key id（`sudo ./scripts/install-backup.sh key-id` で出る、0〜9 と a〜f の 16 文字） | 手順書 6.4 | pilot から（R4。いまの鍵と同じこと） | `BACKUP_KEY_ID=0123456789abcdef` |
| `ALERT_TEST` | 試しの知らせが届いた日 | 手順書 9.4 | pilot は注意、minors からエラー（K5） | `ALERT_TEST=2026-11-10` |
| `MAC_DEV_DB_SEPARATE` | Mac が開発用の DB になった日 | 手順書 9.5 | setup は注意、pilot からエラー（M1） | `MAC_DEV_DB_SEPARATE=2026-11-10` |
| `SUPABASE_CURRENT_PASSWORD_ON` | 「Require current password when updating」を入れた日 | 手順書 11.2 | `ACCOUNT_DELETION_ENABLED` を入れる前（G1） | `SUPABASE_CURRENT_PASSWORD_ON=2026-12-01` |
| `PASSWORD_CHANGE_CHECK` | パスワードの変更の確かめが通った日 | 手順書 11.2 | `ACCOUNT_DELETION_ENABLED` を入れる前（G1。`SUPABASE_CURRENT_PASSWORD_ON` と同じ日か、そのあとの日） | `PASSWORD_CHANGE_CHECK=2026-12-01` |
| `PROD_AMR_CHECK` | 本番の amr の確かめが通った日 | 手順書 11.2 | `ACCOUNT_DELETION_ENABLED` を入れる前（G1。`SUPABASE_CURRENT_PASSWORD_ON` と同じ日か、そのあとの日） | `PROD_AMR_CHECK=2026-12-01` |
| `VERCEL_LEGAL_PAGES_ON` | 法務のページを出した日 | 手順書 12.1 | `LEGAL_TERMS_REQUIRED` を入れる前（G2）。書くと、ご本人の削除も必要です（G3） | `VERCEL_LEGAL_PAGES_ON=2027-01-10` |
| `DECIDED_BYOA` | AI アプリの接続を使うと決めた日 | 手順書 12.3 | byoa を入れる前（S2）。試験運用の名簿があるあいだは書きません（V4） | `DECIDED_BYOA=` |
| `DECIDED_MEMORY` | 学習の記憶を使うと決めた日 | 手順書 12.3 | memory を入れる前（S3） | `DECIDED_MEMORY=` |
| `DECIDED_BILLING` | 有料プランを使うと決めた日 | 手順書 12.3 | `BILLING_ENABLED=true` の前（S4） | `DECIDED_BILLING=` |
| `MINORS_POLICY_DECIDED` | 18 歳未満が使うときの決まりを決めた日 | オーナーと弁護士（1 章の表の下にも書きます）。手順書 11.1 | minors と public で必要（G5。pilot の次が public でも要ります） | `MINORS_POLICY_DECIDED=` |

## 15. 秘密の値と、取り替え方

秘密の値は、表の「しまう場所」とパスワード管理だけに置きます。チャット、issue、git、スクリーンショットには出しません。取り替えたら、パスワード管理の値も新しくします。

| 秘密の値 | しまう場所 | 作り方 | 見られる人 | 取り替えるとき | 取り替え方 |
|---|---|---|---|---|---|
| `POSTGRES_PASSWORD`（`DATABASE_URL_PHASE1` の中にも同じ値） | VM の stack.env | `openssl rand -hex 24` | VM の管理者 | 漏れたかもしれないとき | エージェントと一緒に。先に DB の中で `ALTER ROLE` をしてから、stack.env の 2 か所を変え、デプロイします（DB のボリュームは古い値を覚えているため） |
| `SUPABASE_SERVICE_ROLE_KEY` | VM の stack.env | Supabase | VM の管理者 | 漏れたかもしれないとき | Supabase は Nexloom・P-School と共有なので、鍵を変えるとほかのアプリにも効きます。先に担当と決めます（手順書 3.7） |
| `RISE_PATH_BRIDGE_TOKEN` | VM の stack.env | `openssl rand -hex 32` | VM の管理者 | 漏れたかもしれないとき、1 年に 1 回 | 新しい値を書き、デプロイします |
| `ANTHROPIC_API_KEY` | VM の stack.env | Anthropic のコンソール | VM の管理者 | 漏れたかもしれないとき、鍵を知る人が抜けたとき | 新しい鍵を作って書き、デプロイしてから、古い鍵をコンソールで消します |
| `ORIGIN_SECRET`（と `ORIGIN_SECRET_PREVIOUS`） | VM の stack.env と、Vercel の Production | `openssl rand -hex 32` | VM の管理者、Vercel の持ち主 | 漏れたかもしれないとき、1 年に 1 回 | [../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「`ORIGIN_SECRET` のローテーション（3 段階）」 |
| `TUNNEL_TOKEN` | VM の tunnel.env | Cloudflare | VM の管理者 | 漏れたかもしれないとき | Cloudflare でトークンを作り直し、tunnel.env に書き、デプロイします |
| 知らせの受け口の URL（`AI_CAP_ALERT_WEBHOOK_URL`。使うときだけ `SAFETY_ALERT_WEBHOOK_URL`、`BACKUP_ALERT_WEBHOOK_URL`） | VM の stack.env（`BACKUP_ALERT_WEBHOOK_URL` は backup.env） | Slack | VM の管理者 | 漏れたかもしれないとき（知っている人はだれでも送れます） | Slack で作り直し、書いて、デプロイし、試しの知らせ（手順書 9.4）を送り、`ALERT_TEST` を新しい日付にします |
| 控えの鍵 | VM の `/etc/risepath-backup/backup.key` と、パスワード管理の「Rise Path 控えの鍵」 | `install-backup.sh --new-key`（戻すのは `--import-key`） | root、名前を決めた 2 人 | ほとんど取り替えません（古い控えは古い鍵でしか戻せません） | エージェントと一緒に。古い鍵は、その鍵の最後の控えがバケットから消えるまで（ライフサイクルの日数）残します |
| `VITE_SUPABASE_ANON_KEY` | Vercel | Supabase | だれでも（公開してよい値です） | — | — |
| アカウント（GCP、Vercel、Cloudflare、Supabase、GitHub、Tailscale、Anthropic、Slack）と、手順書 8.1 のテスト用のアカウント | パスワード管理 | — | 名前を決めた人（2 段階の認証を入れます） | 人が抜けたとき | その人を外し、その人が作ったトークンを見直します。公開のあと、要らないダミーとテスト用のアカウントは消します |

最初の公開では使わないもの（使うときは、それぞれの手順書で取り替え方を見ます）: `HERMES_API_KEY`、`OPENROUTER_API_KEY`、`MEMANTO_SECRET_KEY`、Stripe の鍵、`mcp-public.env` のロールのパスワード。`SMOKE_BEARER`（`npm run smoke:edge` の任意のトークン）は、今までどおり使わなくてもかまいません。使うときも、シェルにだけ置き、ファイルに残しません。

## 16. 控えから戻すとき

控え（バックアップ）は、毎日 3 時 23 分ごろ（日本時間）に DB とアップロードを暗号化して、Google Cloud のバケットに置きます。削除の記録（アカウントの削除、学習の記録の消去、1 つのレッスンのやり直しなど）は、1 時間ごとに控えます。日付の指定（`--date`、`--from`）は日本時間の日で、画面に出る時刻も日本時間です。

### 16.1 戻す練習（4 週間ごと）

- [ ] 済んだ日: ＿＿＿＿（そのたびに、日付を書きます）
- だれが・どこで: オーナー、VM（SSH）
- 先に済ませること: 6.5
- やること:
  1. 4 週間ごとに（前の練習と同じ曜日に）、`cd /opt/risepath/deploy/risepath-vm && sudo ./scripts/restore-drill.sh` を実行します（本番の DB は変えません）。前の練習から 35 日をこえると、事前チェックが R3 を出し、public ではデプロイが止まります。デプロイの日が練習の日と重なったときは、先に練習をします。
- うまくいったとき: 「✅ 戻す練習は成功しました（…）」が出ます。
- うまくいかないとき: 出たコードを 13 章で見ます。DR1 で、いちばん新しい控えが古すぎると出たときは、毎日の控えが止まっています。17 章の「控えが 36 時間できていません」を、その日のうちにします。
- くわしく: 13 章の DR

### 16.2 本当に戻すとき（エージェントと一緒に）

- [ ] 済んだ日: ＿＿＿＿（戻した日と、事故の記録の場所を書きます）
- だれが・どこで: オーナーとエージェント、VM（SSH。tmux の中）
- 先に済ませること: エージェントと、戻すと決めたこと（DB がこわれた、まちがって消した、など）
- やること:
  1. 戻すあいだは、Rise Path が止まります。学習者とスタッフに先に知らせます。
  2. VM で `tmux new -s restore` を実行し、その中で作業します（SSH が切れたら、もう一度入って `tmux attach -t restore` で戻ります。tmux がないときは、先に `sudo apt-get install -y tmux` を実行します）。
  3. エージェントと一緒に、`cd /opt/risepath/deploy/risepath-vm && sudo ./scripts/restore-db.sh --from newest --yes-replace-production-database` を実行します（アップロードのボリュームもなくなったときだけ `--with-uploads` を足します。DB がもう答えないときは `--current-db-lost` を足します。`--from` に日付を書くと、その日の控えを使います）。
  4. コマンドは、次の順に進みます（かっこの中は、そこで止まったときに出るコードです）: 事前チェック（RS0）→ 戻しの途中の印を書き、控えのタイマーを止める（RS1）→ 再起動のときの起動と、api などの部品を止める（RS2）→ いまの DB から削除の記録を書き出す（RS3）→ 控えを選び、読み出して確かめ、控えのあとの削除の記録を集める（RS4）→ DB を作り直して控えを戻す（RS5）→ アップロードを戻す（RS6。`--with-uploads` のときだけ）→ migration（RS7）→ 控えのあとの削除を当て直す（RS8）→ 印を消し、起動とタイマーを戻し、控えを 1 つ作る（RS10）→ デプロイ（RS11）。途中で 2 回、yes を聞かれます。1 回目（RS4 の終わり。大きい DB では、それまでに数分かかります）は、控えの時刻と数と、読んだ削除の記録の数を見て答えます。2 回目（RS8）は、もう一度当てる削除の数を見て答えます。
  5. 終わったら、学習者に、戻した時刻を知らせます。その時刻よりあとにした、教材の削除、ジャーナルや AI の記憶の削除は、記録がないので、もう一度してもらうようお願いします（文は弁護士に確かめたものを使います）。
  6. 事故の記録を書きます。出た数と、削除の記録の時刻（日本時間と、かっこの中の UTC の両方）を写します。`--current-db-lost` で「控えのあとの削除の記録が、VM にもバケットにもありません」と出たときは、控えから DB がなくなるまでの削除は当て直せていないかもしれない、と書きます。
- うまくいったとき: 「✅」の行と、最後のデプロイの「==> Done」が出ます。Rise Path が使えます。
- うまくいかないとき: 止まったら、出たコード（RS0〜RS11）を 13 章で見ます。RS5 より前で止まったときは、DB はまだ変わっていません。直してから同じコマンドで続けるか、やめるときは `./scripts/deploy-stack.sh` で元に戻します。RS5 から先で止まったときは、戻しの途中の印が残り、控えは作られず、再起動しても Rise Path は動き出さず、デプロイは R9 で止まります。続きは、エージェントと同じコマンドでだけします（RS5 で止まったときは `--current-db-lost` を付けます）。途中で VM を再起動したときも、同じコマンドで続けます（`systemctl start risepath-stack.service` や `docker compose up -d` を手でしません。削除を当て直す前の DB で、学習者に出てしまうためです）。保護者の同意の取り消しか AI アプリの切断の記録で止まったとき（RS8。「この版では自動で戻せません」と出ます）は、エージェントが、[VM の README の「戻しが RS8 で止まったとき」](../../deploy/risepath-vm/README.md)のとおりに手で当て直します（オーナーは、そこに出る数を一緒に見ます）。印は、その手順のとき以外、手で消しません。public で、最後のデプロイ（RS11）が「[R3]」で止まったときは、`sudo ./scripts/restore-drill.sh` を実行し（RS10 で作った新しい控えで練習します）、それから `./scripts/deploy-stack.sh` を実行します。
- くわしく: 13 章の RS、[../../deploy/risepath-vm/README.md](../../deploy/risepath-vm/README.md) の「控え（バックアップ、Phase 9）」、[./account-deletion-operations.ja.md](./account-deletion-operations.ja.md)

### 16.3 VM をなくしたとき

- [ ] 済んだ日: ＿＿＿＿
- だれが・どこで: オーナーとエージェント、GCP・Tailscale の管理画面・新しい VM（SSH）・パスワード管理、Mac のターミナル
- 先に済ませること: パスワード管理の「Rise Path 控えの鍵」があること
- やること:
  1. 3.4 の 1 のとおりに、Tailscale の Machines で、なくした `risepath-vm` を Remove します（残っていると、新しい VM が別の名前になり、6.3 が届きません）。次に、4 章から 6.3 までで、新しい VM と空の DB を作ります。6.4 の `--new-key` と 6.5 はしません。launch-record.env は 14 章のとおりに、手順書の写し（はじめに）から写し直しますが、戻し終わるまで `LAUNCH_STAGE=setup` にします。12.1 の `VERCEL_LEGAL_PAGES_ON` の日付は、7 まで空のままにします（日付があると、ご本人の削除を 6 で書き直すまで、事前チェックが G3 で止めます）。`ALERT_WATCHER` と `ALERT_CHECK` には、3.6 で決めたこと（1 章の P9-Q3 の答え）を書きます。`BACKUP_KEY_ID` は 2 で書きます。10.3 で Vercel の保護を外していたときも、`VERCEL_PROTECTION_OFF` の日付はそのまま写し、保護はかけ直しません（公開の入り口は 6 まで戻さないので、そのあいだ、外からは入れません）。このときは、5.3 と 6.1 で、そこに書いた注意のほかに V1 も出ます。9.5 の日付を写したときは、M1 は出ません。どれも、いまは直しません。
  2. `cd /opt/risepath/deploy/risepath-vm && sudo ./scripts/install-backup.sh --import-key` を実行します。はじめてなので、設定のファイルを作って止まります（「[IB2]」。正しい動きです）。6.4 の 2 のとおりに、`BACKUP_BUCKET=` のうしろに 3.8 のバケットの名前を書いて保存し、もう一度 `sudo ./scripts/install-backup.sh --import-key` を実行して、パスワード管理の鍵を貼ります（画面には出ません）。鍵が戻ったら、`sudo ./scripts/install-backup.sh key-id` を実行し、出た 16 文字を、`nano launch-record.env` で `BACKUP_KEY_ID` に書きます（同じ鍵なので、なくす前と同じ key id です。`BACKUP_KEY_COPY` は 6.4 の日付のままにします）。
  3. エージェントと一緒に、16.2 の 2〜6 を、`sudo ./scripts/restore-db.sh --from newest --yes-replace-production-database --with-uploads` でします（途中の事前チェックとデプロイで出る R1・V1・M1 は、いまは直しません）。
  4. `sudo ./scripts/install-backup.sh` を何も付けずに実行します（タイマーを動かし、戻した DB の控えを 1 つ作ります）。最後に出る「次にすること」の 1〜5 は、ここではしません（1〜3: 鍵は、パスワード管理から戻したものです。鍵を画面に出さず、`BACKUP_KEY_COPY` は 6.4 の日付のままにします。4: バケットのライフサイクルは、3.8 のままです。5: 戻す練習は、この手順の 5 でします）。
  5. `sudo ./scripts/restore-drill.sh` を実行します。
  6. 控えには、設定のファイル（stack.env、tunnel.env）は入っていません。なくした VM で済んでいた手順の値を、パスワード管理から書き直します。
     - 7.4 まで済んでいたとき: 7.3 の 1〜2 のとおりに tunnel.env を作り、「Rise Path トンネルのトークン」を貼ります。次に `nano stack.env` で、`ORIGIN_SECRET=`（新しく作らずに、「Rise Path ORIGIN_SECRET」の値を貼ります。Vercel にあるものと同じ値です）、`TRUST_PROXY=1`、`LLM_ALLOWED_ORIGINS=https://app.<domain>`、`COMPOSE_PROFILES=tts,tunnel` を書きます。
     - 10.1 まで済んでいて、11.8 より前だったとき: stack.env のいちばん下に、パスワード管理の「Rise Path 試験運用の名簿」の `PILOT_ACCOUNT_IDS=` の 1 行を貼ります。
     - 11.2 まで済んでいたとき: stack.env に `ACCOUNT_DELETION_ENABLED=true` を書きます。
     - 12.3 で入れたものがあるときは、エージェントと、その手順書のとおりに入れ直します。
     - 保存したら、`clear` を実行します。
  7. `nano launch-record.env` で、`LAUNCH_STAGE` を、なくす前の段階に書き戻します（setup のままだったときは、そのままにします）。12.1 まで済んでいたときは、`VERCEL_LEGAL_PAGES_ON` にも、手順書の写し（はじめに）の 12.1 のチェックの横の日付を書き戻します。
  8. はじめにの 2 つの確かめの 1 をしてから、sudo を付けずに `./scripts/deploy-stack.sh` を実行し、「==> デプロイするコミット: …」の 7 文字を見ます。
  9. 7.4 まで済んでいたときは、7.6 をします。10.3 まで済んでいたとき（Vercel の保護を外したあと）は、Mac で 10.3 の 4（`npm run smoke:edge`）もします（保護をかけたままのときは流しません。保護があるあいだは通らないためです）。段階が pilot のときは、10.2 の 1〜4 もします。7.4 より前になくしたときは、7 章の続きから進めます。
- うまくいったとき: 2 で「✅ 鍵を戻しました（key id …）。」が出ます（バケットの控えと合わないときは、何も変えずに止まります）。3 の途中で「この VM には、控えのタイマーがまだありません（手順書 16.3 では正しい状態です）」と出ます。5 で「✅ 戻す練習は成功しました」、8 で「==> Done」と、事後の確かめの「エラー 0 件」が出ます。出てよい注意はありません。9 で、7.6 は `403`、`npm run smoke:edge`（10.3 まで済んでいたときだけ）は「0 failed」、10.2 は 10.2 の「うまくいったとき」のとおりです。
- うまくいかないとき: 2 で鍵が合わないと出たら、パスワード管理の別の鍵（前の鍵）がないかを見ます。8 の事前チェックで「[V1]」が出たら、6 の名簿の行を見ます（Vercel の保護は、かけ直しません）。「[S6]」が出たら 6 の `COMPOSE_PROFILES` を、「[G3]」が出たら 6 の `ACCOUNT_DELETION_ENABLED=true` を見ます。「[R4]」が出たら 2 の `BACKUP_KEY_ID`（`sudo ./scripts/install-backup.sh key-id` の 16 文字と同じか）を、「[K4]」が出たら 1 の `ALERT_WATCHER` と `ALERT_CHECK` を見ます。直したら、もう一度 8 をします。7.6 で `200` が出たら、6 の `ORIGIN_SECRET` を見ます。10.2 でダミーのアカウントでも使えてしまったら、ここで止めて、エージェントに見せます。ほかのコードは 13 章で見ます。
- くわしく: 16.2、7.3・7.4・10.1・11.2、13 章の IB・RS、14 章（日付でない値）

## 17. 困ったとき

見つけた症状の行を探し、わけとすることを見ます。どれにも当たらないときは、出た行をそのままエージェントに見せます（値は出ません）。

- **事前チェックでエラーが出た**: 設定がまちがっているか、確かめの記録が足りません。出たコードを 13 章で見て直し、もう一度実行します。
- **直したはずなのに、事前チェックが止める**: 直しが、新しいコミットに入っているときです（デプロイの最初の事前チェックは、VM にある今のコミットの決まりで確かめます）。エージェントに、直しが main にあることを確かめてもらってから、`git -C /opt/risepath pull --ff-only` を実行し、もう一度デプロイします。
- **デプロイが途中で止まった（コードの付かない行で）**: 出た最後の 20 行をエージェントに見せます。直してから、もう一度 `./scripts/deploy-stack.sh` を実行します。api を入れ替える前に止まったときは、前の版が動いたままです。
- **「503 auth_unavailable」が出る**: Supabase が答えていません（#73 の直しで、401 ではなく 503 になります）。Supabase の Status のページを見て、しばらく待ちます。続くときは、エージェントに見せます。
- **同意のページで「409 legal_not_published」か「legal_version_mismatch」が出る**: VM の API が、Vercel の画面より古い版です。11.3 のとおりに、すぐに VM でデプロイします。
- **「403 pilot_only」か「このアカウントは、いまの試験運用の対象ではありません」が出る**: そのアカウントが試験運用の名簿にありません。入れてよい人なら、10.4 のとおりに足します。
- **テスターに Vercel のログインの画面が出る**: Vercel の保護が、まだ外れていません。10.3 の 1 を見ます。
- **Slack に控えの失敗の知らせが来た**: 知らせの行のコード（BK か JO で始まります）を 13 章で見ます。くわしい行は `sudo journalctl -u risepath-backup -n 50`（JO は `-u risepath-backup-journal`）で見られます。
- **「控えが 36 時間できていません」の知らせが来た**: 毎日の控えが止まっています。その日のうちに直します（ライフサイクルの日数を過ぎると、VM の外の控えがなくなります）。`sudo journalctl -u risepath-backup -n 50` の行を見て、13 章の BK のコードで直します。
- **事前チェックで「控えのタイマーが止まっています」（R8）が出た**: 戻し（16.2）の途中でなければ、`sudo systemctl start risepath-backup.timer risepath-backup-journal.timer` を実行します。戻しの途中なら、エージェントと続きをします。
- **戻す練習が失敗した**: 出たコード（DR0〜DR7）を 13 章で見ます。直したら、もう一度 16.1 をします。
- **VM を再起動したら、Rise Path が動かない**: 戻し（16.2）の途中なら、正しい動きです（R9）。デプロイはせず、エージェントと、同じ restore-db.sh のコマンドで続きをします。戻しの途中でないときは、6.2 の事後の確かめを実行し、出たコードを 13 章で見ます。
- **cloudflared が unhealthy**: デプロイの途中なら、Compose の英語の行（`container … cloudflared … is unhealthy`）のあとに「❌ 待っていた部品が healthy になりませんでした（Rise Path は、もう新しい版に入れ替わっています）。」と「[P5]」が出ます。事後の確かめでは「[P5]」だけが出ます。どちらも、tunnel.env の `TUNNEL_TOKEN`（7.3）と、Cloudflare Zero Trust のトンネルの状態（Healthy か）を見ます。`docker compose --env-file stack.env logs --tail 50 cloudflared` の行をエージェントに見せます（トークンは出ません）。直したら、もう一度 `./scripts/deploy-stack.sh` を実行します。
- **ディスクの空きが少ない（F6）**: `docker system df` で大きいものを見て、エージェントに相談します。自分で `docker system prune` はしません。
- **使っていない部品が動いている（F3）**: 13 章の F3 の直し方のとおりに止めます。
- **公開の段階を下げたい**: launch-record.env の `LAUNCH_STAGE` を前の段階に書き戻し、`./scripts/preflight.sh` を実行します。名簿を消していたときは、パスワード管理の「Rise Path 試験運用の名簿」から stack.env に戻してデプロイします。下げたわけを、1 章の表の下に書きます。
- **launch-record.env をなくした**: 14 章の「書き方」のとおりに、`cp` をして、手順書の写し（はじめに）のチェックの横の日付を写します。日付でない 4 つは、14 章のとおりに書きます: `LAUNCH_STAGE` はいまの段階、`ALERT_WATCHER` と `ALERT_CHECK` は 3.6 で決めたこと（1 章の P9-Q3 の答え）、`BACKUP_KEY_ID` は `sudo ./scripts/install-backup.sh key-id` で出る 16 文字です。VM ごとなくしたときは、16.3 のとおりにします。
- **`npm run smoke:edge` で ❌ が出た**: 下の表で、その番号を探します。

| 番号 | わけ | すること |
|---|---|---|
| 0 | `PUBLIC_APP_URL` か `PUBLIC_API_URL` が `https://` で始まっていません（何も送っていません） | `https://app.<domain>` と `https://api.<domain>` を書き直して、もう一度実行します |
| 1 | アプリの `/api/v2/health` が、Vercel を通って api に届いていません | 7.5 のデプロイと 8.3 の `API_ORIGIN`・`ORIGIN_SECRET` を見ます。「status=degraded」なら、VM で 6.2 をします |
| 2a | `api.<domain>` に直接入れてしまいます | 7.4 の `ORIGIN_SECRET` が入っているかを見て、7.5 をやり直します |
| 2b | まちがった合言葉で `api.<domain>` に入れてしまいます | 2a と同じです。直らないときは、エージェントに見せます |
| 3a | API の答えが、Vercel のキャッシュから返っています | `vercel.json` を変えていないかを、エージェントと見ます |
| 3b | 2 回目の API の答えが、キャッシュから返っています | 3a と同じです |
| 5 | 古い読み上げの入り口が残っています | エージェントに見せます（コードの問題です） |
| 6 | `/uploads` が、アプリの画面ではなく、ファイルとして返っています | エージェントに見せます（アップロードが外から読めるおそれがあります） |
| 7 | ないファイルに、404 ではない答えが返っています | エージェントに見せます |
| 8 | `?` のあとの部分が、API に届いていません | エージェントに見せます |
| 9 | ログインのトークンが API に届いていません（`SMOKE_BEARER` を付けたときだけ） | 「pilot_only」と出たら、名簿にある大人のテスト用のアカウントのトークンを使います（10.1）。ほかは、エージェントに見せます |
| 10 | AI の設定が本番の形ではありません | 5.1 の `ANTHROPIC_API_KEY` と、Gemini が空かを見て、デプロイします |
| 11a | ほかのサイトから API を使えてしまいます | stack.env の `LLM_ALLOWED_ORIGINS` が `https://app.<domain>` だけかを見て、デプロイします |
| 11b | アプリのアドレスが、API に許されていません | 11a と同じです |
| 12 | ログインしていない人の AI の質問が、断られていません | stack.env に `LLM_GUEST_AI` がないことを見て、デプロイします |
| 13a | アプリのページの守りのヘッダーがありません | エージェントに見せます（`vercel.json`） |
| 13b | API の答えに `X-Powered-By` が付いています | エージェントに見せます |
| 14 | `mcp.<domain>` が答えています（AI アプリの接続は、最初の公開では使いません） | Cloudflare のトンネルの経路を 7.1 のとおり 1 つにし、stack.env の `COMPOSE_PROFILES` に byoa がないことを見ます |

## 18. 本番の DB に触るとき（D8）

**決まり**: 試験運用から先は、開発に使う Mac の `.env.local` を、本番の DB に向けません。開発で、共有の Supabase のプロジェクトの設定を変えません。本番の DB には、決まった作業のときだけ、VM の中（SSH）から触ります。Mac から本番の DB にはつなぎません（Tailscale の ACL でも、5432 はだれにも開けません。手順書 3.4）。

**わけ**: Mac で動かすもの（MCP、開発の api、`npm run db:migrate`）は、`.env.local` の DB を、強い権限で使います。本番に向いていると、開発の途中のコードやまだマージしていない migration が、学習者のデータを書きかえます。

**Mac の開発用の DB**（手順書 9.5）:

1. Mac の Docker で、VM と同じイメージの DB を、Mac の中だけで動かします（パスワードは開発用の別の値にします）:

   ```bash
   docker run -d --name risepath-dev-db -p 127.0.0.1:5433:5432 \
     -e POSTGRES_USER=risepath_app -e POSTGRES_PASSWORD=<開発用のパスワード> -e POSTGRES_DB=risepath \
     -v risepath-dev-pgdata:/var/lib/postgresql/data \
     pgvector/pgvector:0.8.7-pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a
   ```

2. `.env.local` の `DATABASE_URL_PHASE1` を `postgresql://risepath_app:<開発用のパスワード>@127.0.0.1:5433/risepath?sslmode=disable` にします。
3. リポジトリのいちばん上のフォルダで `npm run db:migrate` を実行します（この開発用の DB に当たります）。
4. Supabase は、ステージングのプロジェクトがあれば、それを使います（1 章の P9-Q6）。ないときは、共有のプロジェクトを、今の設定のまま使います（設定は変えません。アプリの登録は、手元でも閉じたままです）。

**本番で決まった作業をするとき**（どれも VM で、`cd /opt/risepath/deploy/risepath-vm` のあとで）:

- 読むだけの調べもの: `docker compose --env-file stack.env exec -e PGOPTIONS='-c default_transaction_read_only=on' db psql -U risepath_app -d risepath` で入ります（`risepath=#` が出ます。`-T` は付けません）。`PGOPTIONS` の設定で、この psql の中では、書きかえる文はエラー（`cannot execute … in a read-only transaction`）になり、まちがえて打ったり貼ったりしても、学習者のデータは変わりません。終わったら `\q` です。1 つのコマンドだけを流すときは、`docker compose --env-file stack.env exec -T -e PGOPTIONS='-c default_transaction_read_only=on' db psql -U risepath_app -d risepath -c "…"` の形にします（`…` に、調べる文を入れます）。どちらも、`PGOPTIONS` の部分を省きません（`risepath_app` は、なんでも書きかえられる権限を持っているためです）。
- スタッフによるデータの削除: `docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs …`（[./account-deletion-operations.ja.md](./account-deletion-operations.ja.md)）。
- 控えから戻す: 16 章（エージェントと一緒に）。

**しないこと**（悪い例）: Mac の `.env.local` に本番の DB の URL（`@risepath-vm:5432` など）を書くこと。Mac から本番に `npm run db:migrate` をすること。Tailscale の ACL で 5432 を開けること。

## 付録 古い文書

次の文書とファイルは、前の計画のもので、今の公開の手順ではありません。先頭に「古い」と書いてあります。公開の手順は、この手順書です。

- `doc/guides/prod_readiness_plan.md`（2026-06 の計画）
- `doc/guides/portable_deployment.md`
- リポジトリのいちばん上の `Dockerfile`、`Procfile`、`docker-compose.yml`（簡易版。本番は `deploy/risepath-vm/`）
- `scripts/vm/postgres_risepath_bootstrap.sql`（nexloom-gce の古い手順）
- `secrets.inventory.template`（秘密の名前の古い一覧。今の一覧は 15 章と、事前チェックの `scripts/deploy/preflight-rules.mjs` の `KNOWN_KEYS`）
