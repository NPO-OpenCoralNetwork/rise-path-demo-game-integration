# 学習者データの送り先一覧（AI・外部サービス）

> 作成日: 2026-10-22 ／ 対象: Phase 0 と Phase 0.5（未成年のための安全対策）を入れたあとの状態
> 目的: プライバシーポリシーと利用規約の下書き（同じフォルダ）の土台にする一覧です。
> 法律の確認はまだです。公開前に専門家（弁護士など）に見てもらってください。

## この一覧の前提（Phase 0 と Phase 0.5 のあとの状態）

この一覧は、Phase 0 と Phase 0.5 の変更を入れたあとの状態を書いています。変更前とのちがいは次のとおりです。

- **Gemini（Google の AI）は使いません。** 環境変数 `GEMINI_ALLOWED` がちょうど `"true"` のときだけ使います。未設定やほかの値なら、`GEMINI_API_KEY` があっても使いません（`server/llm/models.config.js:25`）。Gemini API の追加規約が、18 歳未満が使う、または使う可能性が高いサービスでの利用を禁じているためです（<https://ai.google.dev/gemini-api/terms>、2026-04-28 更新）。
- **AI チューター・作文フィードバック・コース生成は、安いモデル（Claude Haiku 5.5）で動きます**（`server/llm/models.config.js:93-94`、`:102`）。
- **共有 Hermes エージェント（AI コーチのチャット）は学習者に出しません**（`config/features.ts:50`、`App.tsx:289`、`App.tsx:394`）。
- **Memanto（AI メモリ）は既定で止まっています**（`deploy/risepath-vm/stack.env.example`）。
- **AI を使えるのは、ログインして生まれた年と月を登録した人だけです。18 歳未満は、保護者の同意の記録も要ります**（Phase 0.5。`server/middleware/aiAccessGate.js:68-100`、`server/safety/access.js`）。ログインしていない人（ゲスト）は、環境変数 `LLM_GUEST_AI` をちょうど `"true"` にしたときだけ AI を使えます。既定では使えません（`server/middleware/aiAccessGate.js:44-45`）。
- **18 歳未満の AI の入力と答えは、見せる前に Claude で確かめます**（下の「安全の確認」の行）。そのため、18 歳未満の文章は Anthropic に 2 回送られます。
- **ログインした人の AI の呼び出しには、元に戻せない記号（仮の ID）を付けて送ります**（下の「Anthropic に送る利用者の記号」の行）。名前・メールアドレス・アカウント ID そのものは送りません。

行番号は 2026-10-22 時点の作業ツリーのものです。コードが変わると行がずれることがあります。

## 用語

- **API**: プログラム同士がデータをやり取りする窓口です。ここでは、Rise Path のサーバーが AI の会社にデータを送る経路を指します。
- **プロンプト**: AI に渡す文章（指示と材料）です。
- **埋め込み（embedding）**: 文章を数字の列に変えて、意味の近さで検索できるようにする処理です。
- **MCP**: AI アプリが外部のツールやデータにつながるための共通の決まりごとです。

## 一覧

「1日の上限」は、サーバーの既定値です。運用者が環境変数で変えられます（`server/middleware/dailyCaps.js:12-15`、`:71-77`）。「全体」は全ユーザーの合計、「ネットワーク」は同じ接続元（IP アドレス）の合計で、既定では 1 人分の 3 倍です（`server/middleware/dailyCaps.js:78`）。日付は日本時間の 0 時で切り替わります。

| 機能 | 送るデータ | 送り先（事業者・国） | 学習への利用・保存期間（出典） | 1日の上限 | コード（file:line） |
|---|---|---|---|---|---|
| レッスン内の AI チューター | レッスン名・目標・レベル、質問した箇所の本文（1,500 字まで）、ブロックの ID、回答の試行回数と選んだ選択肢、学習者の質問（2,000 字まで）、それまでの会話（12 件＝約 6 往復まで、1 件 4,000 字まで。ゲストは 6 件・1 件 2,000 字まで）。**アカウント ID・メールアドレス・名前は送りません。** 代わりに、アカウント ID から作った元に戻せない記号を送ります（下の行）。ID はサーバーのログにだけ 8 文字残します。18 歳未満には、子どもの安全のための指示を足します（`server/llm/prompts/shared.js:55`、`server/llm/index.js:110`） | Anthropic PBC（米国）。モデルは Claude Haiku 5.5 | 学習に使わない: 商用規約 B「Anthropic may not train models on Customer Content from Services」（<https://www.anthropic.com/legal/commercial-terms>）。保存: 既定では受け取りから 30 日以内に削除。安全上の問題で検知された場合は最大 2 年（<https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>） | ログイン済み: 1 人 50 回・ネットワーク 150 回・全体 1,500 回（作文フィードバック・性格インサイトと共通の「llm」枠）。ゲスト（`LLM_GUEST_AI=true` のときだけ）: 1 接続元 100 回・全体 2,000 回 | `server/routes/llm.js:236-334`、`server/llm/prompts/tutor.js:86-122`、`server/llm/schemas.js:101-135`、`server/llm/providers/anthropic.js:151-163`、`server/llm/index.js:223`、`server/llm/models.config.js:93`、`server/llm/guestAccess.js:22-23`、`:158-160` |
| 作文フィードバック | 学習者が書いた文章（20〜6,000 字）、評価の観点、レッスン名、学習のねらい | Anthropic PBC（米国）。Claude Haiku 5.5 | 上と同じ | 上と同じ「llm」枠 | `server/routes/llm.js:183-207`、`server/llm/prompts/writingFeedback.js:27-48`、`server/llm/schemas.js:26-36`、`server/llm/models.config.js:94` |
| 性格インサイト（ビッグファイブ） | 5 つの性格特性のスコア（0〜100）と表示言語だけ。回答そのものは送りません | Anthropic PBC（米国）。このタスクは Phase 0 で変えておらず、中くらいのモデル（Claude Sonnet 5.5）のままです | 上と同じ。スコアは Rise Path の DB にも保存します（`server/migrations/002_user_app_tables.sql:8`、`server/migrations/003_learner_profiles.sql:3-13`） | 上と同じ「llm」枠 | `server/routes/llm.js:211-234`、`server/llm/prompts/personalityInsight.js:29-47`、`server/llm/models.config.js:95` |
| コース生成 | 学習者が書いた目標の文章、プロフィールのビッグファイブのスコア・学習スタイル・やる気の情報、**学習者が自分でアップロードした教材から検索した抜粋（最大 3 つ）**、途中でできた要件とロードマップ | Anthropic PBC（米国）。Claude Haiku 5.5。Phase 0 で Gemini の直接呼び出しをやめました | 上と同じ | 1 人 20 回・ネットワーク 60 回・全体 300 回。1 コースは 3 回以上使います | `server/services/aiGenerator.js:179-194`、`server/services/aiPrompts.js:20-38`、`server/routes/ai.js:329`、`server/llm/models.config.js:102` |
| 安全の確認（18 歳未満だけ。Phase 0.5） | 18 歳未満の人が AI 機能に送る文章の全部（チューターなら質問、それまでの会話、レッスン名と目標、質問した箇所の本文。作文フィードバックなら文章、ねらい、レッスン名、評価の観点。コース生成なら目標の文章、直してほしい点、アップロードした教材の抜粋）と、AI の答えの全部。**18 歳以上の人の文章は送りません。** サーバーの中の簡単なチェック（本人のことと読めるつらい気持ちの言葉、携帯電話の番号、メールアドレス、住所）に当たった入力は、ここにもメインの AI にも送りません | Anthropic PBC（米国）。安いモデル（タスク `safety.screen`、Claude Haiku 5.5） | 上と同じ（学習に使わない。原則 30 日以内に削除。安全上の問題として検知された内容は最大 2 年）。Rise Path 側は、確認を通ったリクエスト（全部の文章を順に並べたもの）の**ハッシュ値だけ**を 1 時間、サーバーのメモリに置きます（まったく同じリクエストを二度確かめないため。文章そのものは置きません）。一部でもちがうリクエストは、それまでの会話もふくめて全部をもう一度送ります | 1 日の上限の回数には数えません（メインの AI の呼び出し 1 回ごとに、入力と答えの確認が付きます） | `server/safety/moderation.js:154-190`、`:260-284`、`:304-366`、`server/safety/prefilter.js`、`server/llm/models.config.js:99`、`server/routes/llm.js:107-159`、`server/services/aiGenerator.js:47-50` |
| Anthropic に送る利用者の記号（Phase 0.5） | ログインした人の AI の呼び出し（安全の確認をふくむ）ごとに、`metadata.user_id` として「`risepath:` とアカウント ID をつなげた文字列の SHA-256 ハッシュの先頭 32 文字」を送ります。ゲストには付けません。Anthropic が、同じ学習者からの呼び出しをまとめて不正利用を見つけられるようにするためです | Anthropic PBC（米国） | 上と同じ。記号から名前やメールアドレスはわかりません。ただし、アカウント ID を知っている人（Rise Path の運営）は同じ記号を計算できます。【要確認: 個人情報保護法での扱い（個人関連情報か、個人データの一部か）】 | — | `server/llm/providers/anthropic.js:34-37`、`:161` |
| 年齢と保護者の同意の記録（Phase 0.5） | 生まれた年と月（日は聞きません）、だれが登録したか（本人・保護者・スタッフ）、登録日時。保護者の同意の版・方法（学習者の端末で同意／紙の同意書をスタッフが記録）・続柄（親・親以外の保護者・その他）・記録した管理者・同意日時・取り消した日時。**保護者の名前や連絡先は記録しません** | **外部には送りません。** Rise Path の Postgres（VM 上）の `user_age`・`account_consents` | アカウントがあるあいだ残ります。同意を取り消しても行は消さず、取り消した日時を残します。アカウントを消すと一緒に消えます（外部キーの `ON DELETE CASCADE`）。アカウント削除の機能はまだありません | — | `server/migrations/014_minor_safeguards.sql:9-42`、`server/safety/access.js`、`server/routes/aiAccess.js`、`server/routes/adminSafety.js:195-273` |
| 安全の記録と報告（Phase 0.5） | 止めた入力・止めた答え・相談先の表示・確認の失敗: 日時、アカウント ID（ゲストはアカウント ID の代わりに IP アドレスか、その上位の部分）、18 歳以上か未満か、機能、分類。**文章は残しません。** 学習者からの報告: 理由、AI の答え（4,000 字まで）、質問（2,000 字まで）、ひとこと（500 字まで）、レッスンの場所、確認した管理者と日時 | **外部には送りません。** Rise Path の Postgres（VM 上）の `ai_safety_events`。管理者だけが見られます。通知（任意）は、運用者が設定したチャットサービス（Slack・Discord など）の Webhook に送ります。通知には学習者の文章は入らず、種類・機能・分類・対象と、アカウント ID の先頭 8 文字だけが入ります | 報告の文章は 90 日で消します（報告があった記録は残ります）。記録は 365 日で消します。消す処理は、記録が増えたときや管理者が安全のページを開いたときに、1 つのサーバーで 1 時間に 1 回まで動きます。アカウントを消すと、記録のアカウント ID は空になります。アカウント ID の写しはほかの欄に持たないので、消したあとに ID は残りません | 報告は 1 人 1 日 20 件まで | `server/migrations/014_minor_safeguards.sql:44-73`、`server/safety/events.js:38-40`、`:58-65`、`:124-142`、`:155-206`、`server/routes/safety.js`、`server/routes/adminSafety.js` |
| 教材のアップロードと検索 | ファイル本体と、それを分けた文章のかたまり | **外部には送りません。** ファイルは VM のディスク（`public/uploads`）、文章は Rise Path の Postgres（VM 上）に入ります。`GEMINI_ALLOWED` が off の間は意味検索をせず、キーワード検索だけです | 保存期間: 学習者や運用者が消すまで残ります。自動で消す仕組みはありません。【要確認: 保存期間の方針を決める】。アップロードしたファイルは公開の入口（Vercel → Cloudflare）からは開けません（`server/middleware/originGate.js:33`） | 1 人 10 ファイル・ネットワーク 30・全体 100（「embeddings」枠） | `server/routes/content.js:35`、`:161-193`、`server/ragService.js:121-129`、`:183-189`、`tools/core/ragSearch.js:56` |
| （参考）同上で `GEMINI_ALLOWED=true` にした場合 | 教材の文章のかたまりと、検索の質問文 | Google（Gemini API の埋め込み）。**18 歳未満が使えない環境でだけ設定します** | 有料枠: Google はプロンプトと応答を製品改善に使わず、不正利用の検知などのために「限られた期間」記録します。無料枠: 製品改善に使い、人が読むことがあります（<https://ai.google.dev/gemini-api/terms>）。必ず有料枠にします | 同じ「embeddings」枠 | `tools/core/ragSearch.js:56` |
| 読み上げ（TTS） | 読み上げる文章、声と速さの設定 | **外部には送りません。** 自前の音声合成 Kokoro（kokoro-82m-onnx）を同じ VM のコンテナで動かします | 作った音声は VM の `public/audio/cache/` に、文章から作った長いハッシュ名で残ります。この名前を知っていれば公開の入口から取得できます（`server/middleware/originGate.js:33`）。保存期間の方針は【要確認】 | 日ごとの上限はありません。AI 用の短時間の上限（1 分 10 回）だけです | `server/routes/tts.js:22-47`、`tools/core/kokoroTts.js:15`、`:20-24`、`deploy/risepath-vm/docker-compose.yml:98`、`server.js:131-139`、`:188` |
| 画像生成 | （止まっています）有効にすると、画像の説明文 | 既定では送りません。`GEMINI_ALLOWED=true` のときだけ Google（Gemini の画像モデル） | 有効にした場合は上の Gemini と同じ | 1 人 30 枚・全体 300 枚（作り置きの画像は数えません） | `server/routes/content.js:239`、`server/geminiBackendService.js:25` |
| 共有 Hermes エージェント（AI コーチ・習慣チャット） | （止まっています）有効にすると、チャットの文章、レッスンの文脈、本人が許可した場合の日記の抜粋、MCP 経由の生活記録など | 既定では送りません。有効にすると VM 上の Hermes から、設定したモデル事業者（OpenRouter や Nous Portal など）へ送ります（`hermes/config.example.yaml:8`、`:13-15`） | 有効にする場合は、その事業者の規約を確認する必要があります【要確認】 | 1 人 40 回・全体 800 回（「agent_chat」枠） | `config/features.ts:50`、`App.tsx:286-291`、`App.tsx:392-394`、`server/services/hermesAgentService.js:20`、`:38-43`、`deploy/risepath-vm/stack.env.example:161` |
| Memanto（AI メモリ） | （止まっています）有効にすると、学習者についての短い記憶メモ | 既定では送りません。有効にすると同じ VM の Memanto・Moorcheh・Ollama のコンテナに入ります。外部に送らない構成に見えますが【要確認】 | 学習者が消せます（`server/services/learnerMemoryBridge.js:562`、`server/routes/learnerMemory.js:105`） | — | `deploy/risepath-vm/stack.env.example:183-192`、`deploy/risepath-vm/docker-compose.memanto.yml` |
| MCP（自分の AI をつなぐ） | 学習者が自分の AI（Claude Code、Claude.ai、Codex、自分の Hermes など）から呼んだツールの結果（レッスン、本人の記録など） | **学習者が選んだ AI の事業者**（例: Anthropic・米国）。その学習者自身の契約と規約のもとで扱われます | 事業者ごとに違います。例: Claude の個人向けプランでは、リモート・ローカルの MCP サーバーから来た生の内容は学習に使わない（会話に貼り付けた場合を除く）とされています（<https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training>、2026-03-16 更新） | Phase 1 で利用者ごとの上限を作ります | **まだ提供していません（Phase 1）。** 本番の MCP コンテナは管理者用の設定で、インターネットには出していません（`deploy/risepath-vm/docker-compose.yml:131`）。リモート接続は使えないと案内しています（`doc/guides/usage_guide.md:132-138`） |
| ログイン（Supabase Auth） | メールアドレス、パスワード（Supabase 側で保管）、ログインの記録。P-School（子ども向けゲーム）のプロフィール名とバトル記録も Supabase の DB に入ります | Supabase。Rise Path の学習者のデータについては、Supabase は Rise Path から預かって処理する立場（処理者）で、データ処理の契約（DPA）に従います（<https://supabase.com/privacy> の「Customer Data」）。契約の相手方（Supabase Inc. か Supabase Pte. Ltd. か）と保存地域（リージョン）は【要確認: Supabase のダッシュボードと DPA で確かめる】 | 保存期間は【要確認】。同じ Supabase プロジェクトを Nexloom と共有しています（`doc/phases/phase18_user_registration_spec.md:54`）。共有の扱い（共同利用など）は【要確認】 | — | `components/features/PSchool/supabase/profileFunctions.js:33-38`、`components/features/PSchool/supabase/experienceSystem.js:148-156` |
| 画面の配信と API の中継（Vercel） | 画面の読み込み。`/api/*` へのすべての通信（学習者の入力を含む）を VM へ中継します | Vercel Inc.（米国）（<https://vercel.com/legal/privacy-policy>）。処理する地域は【要確認】（`vercel.json` に地域の指定はありません） | アクセスログの保存期間は【要確認】 | — | `vercel.json` |
| VM への通り道（Cloudflare Tunnel） | `api.<domain>` を通るすべての通信 | Cloudflare, Inc.（米国）（<https://www.cloudflare.com/privacypolicy/>） | ログの保存期間は【要確認】 | — | `deploy/risepath-vm/docker-compose.yml:204` |
| サーバーと DB（Google Cloud の VM） | Rise Path のアプリデータすべて（プロフィール、ビッグファイブ、学習記録、日記、生活記録、教材、AI 利用回数など） | Google（Google Cloud）。VM の場所は既定で `asia-northeast1-b`（東京）（`deploy/risepath-vm/scripts/provision-gce.sh:15-16`）。実際の VM の場所は【要確認】 | 学習者や運用者が消すまで残ります。生活記録は学習者が消せます（`server/routes/lifeJournal.js:228`）。アカウントごと消す機能はまだありません。【要確認: 保存期間の方針】 | — | `deploy/risepath-vm/docker-compose.yml:14-18`（Postgres）、`server/migrations/006_life_journal.sql:4-41` |
| 文字のフォント（Google Fonts） | 画面を開くと、ブラウザがフォントを取りに行きます。そのとき IP アドレスなどが Google に届きます | Google | Google の規約によります【要確認】 | — | `index.html:8-14` |
| 画面の写真（Unsplash） | 多くの画面が写真を `images.unsplash.com` から直接読み込みます。そのとき IP アドレスと、どのページから来たか（Referer）などが Unsplash に届きます | Unsplash（米国） | Unsplash の規約によります【要確認】。自前で配信に切り替える案もあります | — | `components/features/art/ArtMuseumView.tsx:138`、`components/features/ai/GeneratedCourseView.tsx:98` など（`grep -rn images.unsplash.com components services context`） |
| ブラウザ内の保存（ローカルストレージ） | レッスンの進み具合、下書き、表示の設定、性格診断の結果、ログイン状態など | 進み具合・下書き・表示の設定は**外部に送りません**（その端末のブラウザの中だけ）。ログインの情報（アクセストークン）は、本人を確かめるためにログイン中の API の通信ごとに Rise Path のサーバーへ送ります（`services/apiClient.ts:29-32`）。性格診断の結果は、上の行のとおりサーバーの DB にも保存します | 学習者がブラウザのデータを消すまで。ただし、AI の答えをふくむもの（保存したチューターの答えのカード、性格診断の AI の解説、最後に開いた生成コース、作文フィードバックに送った下書き）は、ログアウトのときに消します。拠点で端末を共有するためです（Phase 0.5） | — | `services/sharedDeviceData.ts:16`、`:33-54`、`context/AuthContext.tsx:274`、`components/lesson/progressStore.ts:1-3`、`components/features/dashboard/assessment/PersonalAssessmentView.tsx`、`services/lifeJournalApi.ts` |

## 気をつける点

1. **生活記録には健康に近い情報があります。** 睡眠、運動、飲酒、体調メモなどです（`server/migrations/006_life_journal.sql:23-41`）。体調メモに病気のことが書かれると、個人情報保護法の「要配慮個人情報」（病歴など）にあたる場合があります。取得には原則として本人の同意が要ります（個人情報保護法 第 20 条第 2 項、<https://laws.e-gov.go.jp/law/415AC0000000057>）。扱い方は【要確認】です。
2. **Anthropic へは米国の会社への送信です。** 個人情報保護法 第 28 条（外国にある第三者への提供）の手続きが要ります。詳しくはプライバシーポリシーの下書きの「外国への移転」を見てください。
3. **Vercel・Cloudflare・Google Cloud は「預けるだけ」かもしれません。** 事業者が個人データを取り扱わない契約になっていれば、第三者提供にも委託にもあたらないとされています（個人情報保護委員会 Q&A 7-53、<https://www.ppc.go.jp/all_faq_index/faq1-q7-53/>）。各社の契約がそうなっているかは【要確認】です。
4. **AI の会社には、名前やメールアドレスを送らない作りです。** ただし、学習者が質問や作文に自分で個人情報を書けば、それは送られます（18 歳以上の場合）。18 歳未満の入力は、携帯電話の番号・メールアドレス・住所をサーバーで見つけたら、AI に送らずに止めます（`server/safety/prefilter.js`）。見つけられない書き方もあるので、画面で「個人情報を書かないでください」と案内します。
5. **18 歳未満の文章は、安全の確認のためにもう一度 Anthropic に送ります。** 保護者の同意の画面で、このことを説明しています（`components/safety/AiAccessSetupView.tsx` の「送られるデータ」）。
6. **年齢は本人や保護者の申告です。** 身分証などで確かめてはいません。
