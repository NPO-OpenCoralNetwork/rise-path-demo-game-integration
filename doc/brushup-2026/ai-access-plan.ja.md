# 学習者が AI を使う方法の方針（決定記録）

- 日付: 2026-10-22
- 決めた人: オーナー（Phase 0 を承認）
- 状態: Phase 0 は実施済み。Phase 0.5（未成年のための安全対策）は実施中（この変更。オーナーが「おすすめの既定で進める」と承認）。Phase 1 から先は計画です。
- 関連: [../legal/README.md](../legal/README.md)（プライバシーポリシーと利用規約の下書き）、[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)（データの送り先の一覧）、[../guides/safety-operations.ja.md](../guides/safety-operations.ja.md)（安全の運用ガイド）

この文書の工数（何日かかるか）は、どれも**見積もり**です。作って測ったものではありません。費用は**試算**で、前提を変えると変わります。

## 1. 決めたこと

1. **アプリの中の AI は残します。** 安いモデル（Claude Haiku 5.5）で動かし、今ある 1 日の上限（`server/middleware/dailyCaps.js`）をそのまま使います。
2. **大人の学習者は、あとで自分の AI をつなげるようにします**（Phase 1）。Claude Code、Codex、Claude.ai、自分で動かす Hermes などを、MCP（AI アプリが外部のツールにつながるための共通の決まりごと）でつなぎます。この変更には入っていません。
3. **共有のサーバー側 Hermes エージェントは、学習者に出しません。**
4. **Gemini（Google の AI）は使いません。** 未成年が Rise Path を使うためです（下の 2.2）。
5. **有料プランはまだ作りません。** 寄付と助成で運営します。

## 2. 理由

### 2.1 費用（試算）

モデルの料金（100 万トークンあたり。トークンは、AI が文章を数えるときの単位です）:

| モデル | 入力 | 出力 | 出典 |
|---|---|---|---|
| Claude Haiku 5.5（プロンプトが 10 万トークンまで） | $0.10 | $0.50 | <https://platform.claude.com/docs/en/about-claude/pricing> |
| Claude Haiku 5.5（プロンプトが 10 万トークンをこえる場合） | $0.50 | $2.50 | 同上 |
| Claude Sonnet 5.5 | $2 | $10 | 同上 |

学習者 1 人・1 か月の AI の費用（試算）:

| 使い方 | Haiku 5.5 | Sonnet 5.5（参考: チューターと作文フィードバックの変更前の既定。コース生成は変更前は Gemini でした） |
|---|---|---|
| ふつう: チューター 200 回、作文フィードバック 8 回、コース生成 1 回 | 約 23 円 | 約 455 円 |
| 1 日の上限いっぱいを 30 日（チューターなど 50 回/日、コース生成 20 回/日） | 約 580 円 | 約 11,600 円 |

前提（どれも仮定です）:

- チューター 1 回: 入力 4,000・出力 500 トークン。作文フィードバック 1 回: 入力 3,000・出力 1,200。コース 1 つ（3 段階）: 入力 20,000・出力 25,000。
- プロンプトのキャッシュ（同じ指示文を安く再利用する仕組み）は使わない計算です。使えばもっと安くなります。
- 1 ドル = 150 円。
- 計算: ふつうの使い方は入力 84.4 万・出力 13.46 万トークンです。Haiku では 0.844 × 0.10 + 0.1346 × 0.50 ≒ 0.152 ドル ≒ 23 円。Sonnet では 0.844 × 2 + 0.1346 × 10 ≒ 3.03 ドル ≒ 455 円。

全体の上限から見た 1 日の最大額（試算、同じ前提）:

- チューターなど「llm」枠の全体上限 1,500 回/日を Haiku で使い切ると、約 1 ドル/日です。
- コース生成の全体上限 300 回/日（1 回は 1 段階）を Haiku で使い切ると、約 1.5 ドル/日です。
- ゲストのチューター（全体 2,000 回/日、`server/llm/guestAccess.js:22-23`）を使い切ると、約 1.3 ドル/日です。
- ただし、性格インサイトは中くらいのモデル（Sonnet 5.5）のままで、同じ「llm」枠を使います（`server/llm/models.config.js:95`）。枠がすべて性格インサイトに使われると、1 日の額はこれより大きくなります。【要確認: 性格インサイトも安いモデルにするか】

まとめ: Sonnet から Haiku に替えると、ふつうの使い方で費用はおよそ 20 分の 1 になります。答えの質は下がる可能性があるので、いくつかのレッスンで試して確かめます。質が足りないタスクは、コードを変えずに `LLM_TASK_<タスク名>=anthropic:<モデル ID>` で戻せます（例: `LLM_TASK_TUTOR_CHAT=anthropic:claude-sonnet-5-5`。`server/llm/models.config.js:109` と `:165-170`）。

### 2.2 規約

- **Gemini は未成年が使うサービスに使えません。** Gemini API の追加規約（2026-04-28 更新）は、利用者が 18 歳以上であることを求め、「18 歳未満の人に向けた、または 18 歳未満の人が使う可能性が高い」サービスでの利用を禁じています（<https://ai.google.dev/gemini-api/terms>）。Rise Path は子ども食堂の拠点で使われ（`doc/guides/investor_brief.md:56`）、P-School は子ども向けのゲームです。
- **Anthropic の API は、自分のサービスの利用者のために使えます。** 商用規約 A.1 は、自分の顧客や利用者に提供するサービスを動かすために使うことを認めています。B は、送った内容を Anthropic が学習に使わないと定めています。D.3 は、出力の事実を確かめずに頼らないよう利用者に伝えることを求めています。D.4 は、Anthropic の承認なくサービスを転売することを禁じています（<https://www.anthropic.com/legal/commercial-terms>）。
- **未成年が使う製品には追加の安全対策が要ります。** Anthropic の利用ポリシーは 18 歳未満を未成年とし、サポート記事の指針に従うよう求めています（<https://www.anthropic.com/legal/aup>、ページの表示は「Effective Nov 12, 2026」）。指針の中身は 4 章を見てください。
- **学習者のログイン情報を預かってはいけません。** Anthropic は、第三者の開発者が Claude.ai のログインを自分のアプリで提供すること、Free・Pro・Max プランの資格情報を使って利用者の代わりにリクエストを送ること、Claude.ai のログイン情報やセッションを集めたり預かったりすることを認めていません。一方で、利用者が自分のサブスクリプションで、改変していない Claude Code にログインすることは妨げないとしています（<https://code.claude.com/docs/en/legal-and-compliance>）。だから「学習者が自分の AI を Rise Path につなぐ」形（Phase 1）はできますが、「Rise Path が学習者のサブスクで AI を動かす」形はできません。
- **Claude の個人向けプランは 18 歳以上です**（<https://www.anthropic.com/legal/consumer-terms>）。Phase 1 は大人向けになります。未成年には、アプリの中の安全な AI を残します。

### 2.3 共有 Hermes をやめる理由

- 共有 Hermes は、習慣の分析のスキル（`life-habit-analyst`）では、答える前に学習者の生活記録を読むツールを呼ぶよう指示されています（`server/services/hermesAgentService.js:18-22`）。モデルは OpenRouter や Nous Portal などの外部の会社です（`hermes/config.example.yaml:8`、`:13-16`）。設定ファイルの例には、コメントの形で、OpenRouter 経由の Gemini のモデルが書かれています（`hermes/config.example.yaml:14-16`）。
- 未成年への安全対策や、データの送り先の説明を、もう 1 つの経路で用意し続けるのは、小さな NPO には重い負担です。
- 自分の Hermes を使いたい人は、Phase 1 で自分の Hermes を MCP でつなげます。

## 3. Phase 0（実施済み）

2026-10-22 時点の作業ツリーで確かめた内容です。最終的な差分はプルリクエストを見てください。

### 3.1 変えたこと

**Gemini を止めるスイッチ**

- `GEMINI_ALLOWED` がちょうど `"true"` のときだけ Gemini を使います。未設定やほかの値なら、`GEMINI_API_KEY` があっても使いません（`server/llm/models.config.js:25`）。
- キーだけ設定されている場合は、AI の機能が最初に呼ばれたとき（AI の窓口を作るとき）に、ログに警告を出します（`server/llm/index.js`）。
- 教材の埋め込み（意味検索）、画像生成も同じスイッチに従います（`tools/core/ragSearch.js:56`、`server/geminiBackendService.js:25`）。
- off の間、アップロードした教材は文章だけ保存し、キーワード検索で探します（`server/ragService.js:121-129`、`:183-189`）。
- off の間、画像生成の API は 503 `image_generation_unavailable` を返します（`server/routes/content.js:239`）。画面では、画像の代わりに絵の説明文を出します（`components/features/ai/GeneratedDocView.tsx`、`services/curriculumApi.ts`）。

**安いモデルへの切り替え**

- `tutor.chat`（AI チューター）と `writing.feedback`（作文フィードバック）を `cheap`（Claude Haiku 5.5）にしました（`server/llm/models.config.js:93-94`）。
- 新しいタスク `course.generate`（`cheap`、`anthropic`、effort `low`、最大 32,000 トークン、ストリーム）を作り、コース生成の Gemini 直接呼び出しを置き換えました（`server/llm/models.config.js:102`、`server/services/aiGenerator.js:53`、`:179-194`）。プロンプトは JSON を 1 つだけ返すよう直しました（`server/services/aiPrompts.js`）。
- コース生成の失敗の扱いを、AI の窓口（ゲートウェイ）のエラーの種類で決めるようにしました。モデルが動く前の失敗なら、1 日の回数を返します（`server/routes/ai.js`）。

**共有 Hermes を出さない**

- 画面のスイッチ `VITE_FEATURE_AGENT_CHAT` がちょうど `"true"` のときだけ、共有 Hermes のチャット（右下の AI コーチと `/life-journal/chat`）を出します。既定は off です（`config/features.ts:50`、`App.tsx:286-291`、`App.tsx:392-394`）。
- サーバーも同じスイッチを読みます。ちょうど `"true"` でないと、`/api/v2/agent/chat` は 404 を返し、1 日の回数も数えません。前の設定のまま Hermes が動いている VM でも、学習者は共有 Hermes を使えません（`server/routes/agent.js`）。
- 用語の説明の「AI 先生に聞く」ボタン、ライフジャーナルとプロフィール画面のチャットへのボタンも、off のときは出しません（`components/common/GlossaryText.tsx`、`components/features/life-journal/`、`components/features/dashboard/profile/ProfileDiagnosisView.tsx`）。
- AI コーチのエラー表示から、設定名（`HERMES_API_KEY` など）を出さないようにしました（`services/agentApi.ts`）。
- VM の既定の構成を `COMPOSE_PROFILES=tts` にし、Hermes のコンテナを起動しないようにしました（`deploy/risepath-vm/stack.env.example:161`、`deploy/risepath-vm/scripts/deploy-stack.sh`）。

**危ない手順書の書き換え**

- ChatGPT に共有のブリッジトークンを入れ、ngrok で MCP サーバーを公開する手順を消しました。代わりに、トークンを外部に入れないこと、ポートを公開しないことを書きました（`doc/guides/usage_guide.md:132-138`）。

**設定例と文書**

- `.env.example`、`deploy/risepath-vm/stack.env.example`、`deploy/vercel/env.production.example`、README、デプロイの手引きを、上の内容に合わせました。

**テスト**

- 新規: `server/tests/llmGeminiGate.test.js`、`server/tests/courseGenerate.test.js`、`server/tests/agentChatFeatureFlag.test.js`。
- 更新: `server/tests/llmGateway.test.js`、`server/tests/dailyCapsRoutes.test.js`、`server/tests/ragEmbeddings.test.js` など。

**法務の下書き**

- `doc/legal/` の 4 つの文書と、この決定記録を追加しました。

### 3.2 変えていないこと

- 性格インサイト（`assessment.insight`）は中くらいのモデル（Sonnet 5.5）のままです（`server/llm/models.config.js:95`）。
- サーバーの `/api/v2/agent/chat` は残っています。`VITE_FEATURE_AGENT_CHAT=true` にして Hermes を動かさない限り使えません（`server.js:183-185`、`server/routes/agent.js`）。
- 本番の MCP コンテナは管理者用の設定のままで、インターネットには出していません（`deploy/risepath-vm/docker-compose.yml:131`）。
- Memanto（AI メモリ）は既定で止まったままです（`deploy/risepath-vm/stack.env.example:189`）。
- 1 日の上限の値は変えていません（`server/middleware/dailyCaps.js:71-77`）。

### 3.3 オーナーの作業

- 本番の環境変数から `GEMINI_API_KEY` を消すか、`GEMINI_ALLOWED` を設定しないままにします。
- Vercel に `VITE_FEATURE_AGENT_CHAT` を設定しないままにします。
- いくつかのレッスンで、Haiku のチューターと作文フィードバックの質を確かめます。
- [../legal/README.md](../legal/README.md) の【要記入】を埋め、専門家に確認を頼みます。

## 4. Phase 0.5: 未成年のための安全対策

一般公開の前に行います。Anthropic のサポート記事「Responsible Use of Anthropic's Models: Guidelines for Organizations Serving Minors」（<https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors>）に沿います。

### 4.1 記事の項目と対応

| やること | 中身（Phase 0.5 で作ったもの） | 記事の項目 |
|---|---|---|
| 年齢の確認 | AI を使う前に、生まれた年と月を登録します（申告）。18 歳未満は保護者の同意を必須にしました（これは記事の要件ではなく、オーナーの方針と下の個人情報保護委員会の考え方によるものです。記事は保護者の同意や年齢の線にふれていません） | 年齢の確認 |
| 保護者の同意 | 18 歳未満は全員、AI 機能についての保護者の同意を記録するまで AI を使えません。個人情報保護委員会は、一般に 12〜15 歳以下の子どもは法定代理人などの同意が要るとしています（Q&A 1-62 <https://www.ppc.go.jp/all_faq_index/faq1-q1-62/>）。決めた年齢以下（例: 15 歳以下）は保護者がアカウントを登録する、という案はまだです（4.4） | 法令の順守 |
| 内容のフィルター | 18 歳未満の入力と AI の答えを確かめ、不適切な内容を止めます。子ども向けの指示文（システムプロンプト）を足します | 内容のモデレーション |
| 見守りと報告 | 止めた件数を記録し（文章なし）、管理者が見られるページを作りました。利用者が「この答えはおかしい」と報告できるボタンを付けました。運営への通知もあります | 見守りと報告 |
| AI であることの表示 | AI の答えの近くに「AI が作った答えです」と表示します | AI であることの開示（必須） |
| 使い方の案内 | 子どもと保護者向けの公開ページ `/ai-safety`（相談窓口つき） | 教育的な資料 |
| 公表 | `/ai-safety` の「法令と指針について」。プライバシーポリシーと利用規約は、まだ公開ページがありません | 法令の順守の公表 |

### 4.2 作ったもの（2026-10-22 時点の作業ツリー）

**年齢と同意（サーバー）**

- 新しい表 3 つ: `user_age`（生まれた年と月だけ）、`account_consents`（同意の記録。保護者の名前は持たない）、`ai_safety_events`（止めた記録と報告）（`server/migrations/014_minor_safeguards.sql`）。年齢や同意を、学習者が書き換えられる場所（`user_profiles.preferences`、Supabase の `user_metadata`）には置いていません。
- 年齢の計算: 日本時間で、誕生日は生まれた月の最後の日とみなします（`server/safety/age.js:65-83`）。
- AI を使えるかの判定: `ready`（使える）、`needs_age`（年月が未登録）、`needs_guardian_consent`（同意待ち）、`paused`（その日のお休み）。結果は 60 秒だけ覚え、書き込みのたびに消します（`server/safety/access.js:234-263`）。
- 入口の関門（ゲート）: AI を呼ぶすべての POST で、1 日の上限より**前**に判定します。断った呼び出しは回数に数えません（`server/middleware/aiAccessGate.js:68-100`、`server/routes/llm.js:176`、`server.js:159`、`:166`、`:172`、`:184`）。`GET /api/v2/llm/status` は今までどおり誰でも見られます。
- 画像生成（`/api/v2/image`）と AI コーチ（共有 Hermes、`/api/v2/agent/chat`）は、18 歳未満向けの確認と子ども向けの指示がないので、18 歳以上だけにしました。18 歳未満は保護者の同意があっても 403 `adults_only` です（`server.js:170-172`、`:184`）。
- 学習者の画面とAPI: `/settings/ai-access`（年月の登録、保護者の同意、同意のやめ方、スタッフに見せる番号）と `/api/v2/user/ai-access`（`server/routes/aiAccess.js`、`components/safety/AiAccessSetupView.tsx`）。同意文の版は `guardian-ai-2026-10` です（`server/safety/access.js:30`）。
- 外部の AI（ChatGPT のアクション、MCP、Nexloom）が作ったコースの下書きの保存と公開は、学習者のログインで呼ぶ場合は 18 歳以上だけにしました。MCP では、学習者が自分のログイン（JWT）で開いた接続から `save-curriculum-draft` と、データベースに保存する `lesson-upsert-draft` を呼ぶと、書き込む前に同じ判定をします（年月が未登録なら `age_required`、18 歳未満なら `adults_only`）。ブリッジトークンは運営用の経路として扱い、手元の stdio の接続も確かめません（`server/routes/chatgptCurriculum.js:68`、`:218`、`:887`、`tools/core/mcpAiAccess.js:34-51`、`mcp-server/index.js:462`、`:569`）。

**確認（モデレーション）**

- 18 歳未満の呼び出しには、子どもの安全の指示（`MINOR_SAFETY`）を最後に足します。キャッシュ（同じ指示文を安く再利用する仕組み）の対象にはしません（`server/llm/prompts/shared.js:55`、`server/llm/index.js:110-117`）。
- 入力の確認: まずサーバーの中で、つらい気持ちの言葉と、携帯電話の番号・メールアドレス・住所を探します（`server/safety/prefilter.js`）。つらい気持ちの言葉は、本人のことと読める書き方（「死にたい」「虐待されていると思う」「I want to die」など）だけを探します。ほかの人のことや授業の話題として書いた文（「虐待されている子どもを助ける仕組み」「自殺を考える若者が増えている理由」など）や、ふだんのけが（「I cut myself while cooking」など）はここでは止めず、Claude の確認に任せます。住所は、丁目・番地・番か「1-2-3」の形、または「1-2」のあとに建物や部屋の言葉（「のマンション」「号室」など）や「に住んでいます」が続くときだけ止めます。「気温は20-25℃」「2-1で勝った」「第1-2問」のような範囲や点数は Claude に任せます。次に Claude の新しいタスク `safety.screen`（安いモデル、effort `low`、最大 2,048 トークン）で確かめます（`server/llm/models.config.js:99`、`server/safety/moderation.js:270-294`、`:314-384`）。チューターは、会話の履歴（12 件まで全部）やレッスンの本文もふくめ、送られてくる文章を全部まとめて、1 回の確認で確かめます（`server/safety/moderation.js:164-184`）。1 回の確認で読める長さ（8 万字）は、受け付けるいちばん長いリクエスト（チューターで約 6 万字）より長くしてあり、入力を分けて確かめることはしません。それより長い入力は、確認できないときと同じく止めます（`server/safety/moderation.js:46-53`、`:359-364`）。前に確認を通ったのとまったく同じリクエストだけは、もう一度は確かめません。一部でもちがえば、全部をまとめて確かめ直します（`server/safety/moderation.js:349-353`）。
- 答えの確認: チューターの答えは、18 歳未満には確認が終わってからまとめて届けます。作文フィードバック、性格インサイト、コース生成は、返す前・保存する前に確かめます（`server/routes/llm.js:107-159`、`:267-283`、`server/services/aiGenerator.js:47-50`）。
- 確認できないとき（エラー、確認の AI が断った、本番で模擬の AI に回った、1 回の確認に入らないほど長い入力）は、18 歳未満の AI を止めます（`server/safety/moderation.js:270-294`、`:355-373`）。
- 止めたとき: 422 `content_blocked`（`category`、`support`）。つらい気持ちのときは `support: true` で、画面が相談窓口を出します（`components/safety/SupportLines.tsx`）。
- その日のお休み: 入力を止められた回数が 1 日に `SAFETY_BLOCKS_BEFORE_PAUSE`（既定 10）に達すると、日本時間の 0 時まで AI を止めます。相談窓口を出した回と、個人情報（分類 `personal_info`。電話番号やメールアドレスを書いた、など）で止めた回は数えません。個人情報の分類は、サーバーの中のチェックで止めた回にも、Claude の確認で止めた回にも当てはまります（`server/safety/access.js:184-199`、`:217-223`、`server/safety/events.js:191-204`）。
- Anthropic への呼び出しに、利用者ごとの元に戻せない記号（`metadata.user_id`）を付けます（`server/llm/providers/anthropic.js:34-37`、`:161`）。

**表示、報告、運用**

- AI の答えの近くの表示と「報告する」ボタン（`components/ui/AiNotice.tsx`）。チューター、作文フィードバック、診断の解説、コースづくり、生成コース・生成レッスンの画面に付けました。
- 報告: `POST /api/v2/safety/reports`。1 人 1 日 20 件まで（`server/routes/safety.js`）。
- 管理者のページ `/settings/admin/safety`: 集計、報告の確認、年齢の登録と直し、紙の同意書の記録、同意の取り消し（`components/features/admin/AdminSafetyView.tsx`、`server/routes/adminSafety.js`）。管理者かどうかはサーバーで毎回確かめます（`server/middleware/requireAdmin.js:15-41`）。
- 通知: `SAFETY_ALERT_WEBHOOK_URL`（未設定なら `AI_CAP_ALERT_WEBHOOK_URL`）。学習者の文章は送りません（`server/safety/events.js:88-122`、`:181-189`）。
- 保存期間: 報告の文章は 90 日、記録は 365 日。消す処理は 1 つのサーバーで 1 時間に 1 回まで、記録が増えたときや管理者がページを開いたときに動きます（`server/safety/events.js:39-40`、`:124-142`）。
- 共有の端末: ログアウトのときに、AI の答えをふくむブラウザの保存を消します（`services/sharedDeviceData.ts`、`context/AuthContext.tsx:274`）。
- 公開ページ `/ai-safety`（ログインしていなくても開けます。`components/features/safety/AiSafetyGuideView.tsx`）。
- 運用ガイド: [../guides/safety-operations.ja.md](../guides/safety-operations.ja.md)。

**テスト**: `server/tests/` の `aiAccessAge`、`aiAccessGate`、`aiAccessRoutes`、`aiAccessFront`、`safetyPrefilter`、`safetyModeration`、`safetyRoutes`、`adminSafety`、`tutorSafetyErrors`、`vmStackConfig` など。

### 4.3 決めたこと（オーナーが変えられる既定）

オーナーは「おすすめの既定で進める」と承認しました。どれも、あとから変えられます。

| 決めたこと | 既定 | 変え方 |
|---|---|---|
| 年齢の聞き方 | 生まれた年と月を 1 回登録（本人・保護者・スタッフ）。日本時間で計算し、誕生日は生まれた月の最後の日（若い側に丸める）。18 歳未満が未成年 | コード（`server/safety/age.js`） |
| 保護者の同意 | 18 歳未満は全員必要。方法は学習者の端末か紙の同意書。続柄だけを記録し、名前は記録しない。いつでも取り消せる | コード。同意文を変えたら版（`CONSENT_POLICY_VERSION`）を上げる。上げると 18 歳未満の全員が同意し直すまで AI を使えない |
| 年齢が未登録の人 | AI を使えない。AI を使わない学習は使える | コード |
| ゲスト | AI を使えない | `LLM_GUEST_AI=true` で使える（大人として扱う。18 歳未満が使えない環境だけ） |
| 18 歳未満への対策 | 子ども向けの指示、入力の確認（サーバーのチェック + Claude）、答えの確認。18 歳以上は確認しない | コード |
| 確認できないとき | 18 歳未満は止める | コード |
| その日のお休み | 1 日 10 回入力を止められたら、日本時間 0 時まで（相談窓口を出した回と、個人情報で止めた回は数えない） | `SAFETY_BLOCKS_BEFORE_PAUSE`（0 = お休みにしない） |
| 報告 | ログインした人なら誰でも。1 日 20 件まで。文章は 90 日、記録は 365 日 | コード（`server/routes/safety.js`、`server/safety/events.js`） |
| 通知 | 学習者の文章なし | `SAFETY_ALERT_WEBHOOK_URL`（https だけ） |
| 外部の AI のコース下書き | 学習者のログインでは 18 歳以上だけ（ChatGPT のアクションと MCP）。ブリッジトークンは運営用 | コード |
| 画像生成と AI コーチ（Hermes） | 18 歳以上だけ（18 歳未満向けの確認がないため） | コード（`server.js` の `aiAccessGate({ adultsOnly: true })`） |
| 開発用の設定 | `AI_ACCESS_DEV_AUDIENCE`（`adult`・`minor`）は本番以外だけ。本番では無視して警告。本番以外でデータベースがないときは大人として扱う。本番でデータベースがないときは 503 | — |

### 4.4 残っていること

- **保護者がアカウントを登録する年齢の線**（例: 15 歳以下）と、その仕組み。今は、その年齢の子どもも本人がアカウントを作れます。
- **年齢の確かめ方**: 今は申告だけです。強めるかどうか（拠点のスタッフが確かめる運用など）を決めます。
- **紙の同意書の様式と保管**、拠点ごとの緊急時の連絡先（運用ガイドの【要記入】）。
- **`/privacy` と `/terms` の公開ページ**と、登録時の同意のチェック（[../legal/README.md](../legal/README.md)）。
- **確認の精度を測ること**: 学習の質問を止めすぎていないか、すり抜けがないか。試験用の文章で、止めた割合と見逃した割合を測ります。Anthropic が提供すると書いている子ども向けのシステムプロンプトは、まだ手に入れていません（`MINOR_SAFETY` は自分たちで書いたものです）。
- **AI コーチ（共有 Hermes）と画像生成**: どちらも既定で止まっていて、18 歳以上だけにしてあります（18 歳未満向けの確認と子ども向けの指示がないため。Hermes は AI の窓口を通らず、設定例は OpenRouter 経由の Gemini です。`hermes/config.example.yaml:8`、`:13-16`）。18 歳未満にも使えるようにするなら、先に確認と子ども向けの指示を足します。ブリッジ（Nexloom）からの Hermes の呼び出しも同じ関門を通るので、本番で使うなら `PHASE1_USER_ID` の利用者に 18 歳以上の年月を登録します。
- **Phase 0.5 より前に保存したもの**: すでに保存されている生成コース（`curricula`）や、ブラウザに残っている AI の答えは、確認していません。
- **ほかのデータの保存期間**: アップロードした教材、生成コース、AI の利用回数の記録（IP アドレスをふくむ）、読み上げ音声のキャッシュには、消す仕組みがありません。アカウントをまとめて消す機能もありません。
- **P-School と Nexloom のアカウント**: P-School は同じ Supabase に別の登録画面を持ち、Nexloom のアカウントは Rise Path の登録画面を通りません。どちらも AI を使うときに年齢の登録を求められるので AI は守られますが、AI 以外の利用には年齢の確認がありません。
- **Claude Code のコース**: 有料の Claude のプランか Console のアカウントが要ると教えています。Claude の個人向けプランは 18 歳以上です。未成年への案内（保護者のアカウントを使う、など）は未定です。
- **読み上げ（TTS）**: ログインなしでも使え、1 日の上限がありません（外部には送りません。`server.js` の `/api/v2/tts`）。
- **複数のサーバーで動かす場合**: 判定の結果は各サーバーが 60 秒覚えるので、同意の取り消しやお休みが、ほかのサーバーに届くまで最大 60 秒かかります。今の VM は API のコンテナが 1 つです。
- 工数: 見積もりはまだです【要確認】。

## 5. Phase 1: 自分の AI をつなぐ（BYOA、大人向け）

BYOA は「Bring Your Own Agent（自分の AI を持ち込む）」の略です。学習者が自分の契約の AI で Rise Path を使うので、AI の費用は学習者の契約で払われます。

- **つなぎ方**: MCP の新しい標準の通信方式「Streamable HTTP」の入口（`POST /mcp`）を作ります。今の MCP サーバーは古い方式（SSE）だけです（`mcp-server/index.js:1045`、`:1166`、`:1192`）。
- **ログイン（OAuth）**: 学習者が自分のアカウントで「この AI に Rise Path の利用を許可する」操作をします。Supabase の OAuth 2.1 サーバー機能を使います。この機能は**ベータ版**で、全プランで使えます。別料金はありませんが、OAuth でログインした利用者も月間アクティブユーザー（MAU）に数えます。許可の画面は自分たちで作ります（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。
- **MCP の決まりごとへの対応**: MCP サーバーは「保護されたリソースのメタデータ」（RFC 9728）を出し、401 のときに `WWW-Authenticate` ヘッダーでその場所を知らせます。トークンが自分あてに発行されたものかを確かめ、ほかのトークンは受け付けません（<https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>）。今の 401 は JSON だけで、このヘッダーがありません（`mcp-server/index.js:1173`）。
- **アプリの API の守り**: 今の API は、Supabase が認めたトークンなら何でも受け付けます（`server/middleware/auth.js:131-141`）。外部の AI に渡したトークンで、アプリのすべての API（有料の AI 機能をふくむ）が使えないよう、区別して断ります。
- **学習者の範囲だけのツール**: 学習者用の新しい設定（`learner-remote`）を作り、本人のデータだけを扱うツールにします。生活記録や AI メモリなど、特に私的なデータは既定で出しません。
- **別の公開ホスト名**: 学習者用の MCP は、別のコンテナと別のホスト名（例: `mcp.<domain>`）で公開します。管理者用の MCP（`deploy/risepath-vm/docker-compose.yml:131`）は公開しません。
- **大人だけ**: Claude の個人向けプランは 18 歳以上です。未成年はアプリの中の AI を使います。
- **利用者ごとの上限**: 1 日の上限に、MCP 用の種類を足します（`server/middleware/dailyCaps.js:63`）。
- 工数（見積もり・未検証）: 開発 6〜8 日、オーナーと運用の作業（Supabase、Cloudflare、実際のクライアントでの確認）2〜3 日。

## 6. Phase 2: 進み具合をサーバーに保存し、学習のツールを足す

- レッスンの進み具合は、今はブラウザの中だけにあります（`components/lesson/progressStore.ts:1-3`）。サーバーに保存する API（`/api/v2/user/progress`）を作ります。
- MCP のツールを足します: コースの一覧、公開済みレッスンの読み出し、クイズの答え合わせ、進み具合の読み書き。
- レッスンのデータにはクイズの正解が入っています（`shared/lesson/schema.js:174`）。読み出しのツールでは正解を外し、答え合わせは別のツールで行います。
- 工数（見積もり・未検証）: 開発 6〜8 日（Phase 1 と合わせて 12〜16 日）。

## 7. Phase 3（条件つき）: 有料プラン

寄付・助成・無料の枠で費用がまかなえなくなったときだけ検討します。

- 決済は Stripe を使います。プランごとの 1 日の上限を作ります（今の上限はプランの区別がありません: `server/middleware/dailyCaps.js:71-77`）。
- 特定商取引法の表記が要ります。広告には価格、支払いの時期と方法、提供の時期、申し込みの期間、解約の条件などを表示します（第 11 条）。申し込みの最終確認の画面にも、分量や価格などを表示します（第 12 条の 6）（<https://laws.e-gov.go.jp/law/351AC0000000057>）。
- 価格は税込で表示します（<https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6902.htm>）。
- NPO の「収益事業」にあたるかどうかを、税理士に確かめます。
- 売るのは「AI チューター」「フィードバック」などの機能です。AI のモデルそのものを使い放題で売ることはしません（Anthropic 商用規約 D.4）。
- 今のプラン画面は見本で、価格が書き込まれているだけです（`components/features/dashboard/SubscriptionView.tsx`）。
- 工数（見積もり・未検証）: 開発 5〜8 日と、法律と税の相談。

## 8. やらないこと

- 学習者の Claude や ChatGPT のログイン情報（パスワード、セッション、API キー）を集めたり預かったりすること。
- AI のモデルそのものを、そのまま売ること（転売）。
- 未成年が使える機能に Gemini を使うこと。
- 管理者用の MCP（`RISE_PATH_MCP_PROFILE=admin`）をインターネットに公開すること。
- 共有のブリッジトークン（`RISE_PATH_BRIDGE_TOKEN`）を外部のサービスに渡すこと。

## 9. まだ分からないこと

- Haiku のチューターと作文フィードバックの質が十分か（試して確かめます）。
- Anthropic の利用ポリシーのページの「Effective Nov 12, 2026」が、これから有効になる版かどうか。2026-10-22 の調べでは、ページは 2026-11-12 から有効の版を最新として出し、2025-09-15 の版は「新しい版に置き換えられた」として保管されています（<https://www.anthropic.com/legal/aup>、<https://www.anthropic.com/legal/archive/22742366-2ef0-4c7a-a833-6523f10d3944>）。前もって公開された版で、2026-11-12 までは 2025-09-15 の版が効いている、と読めますが、推測です【要確認】。
- 未成年の安全対策の既定（4.3）を、運用してみて変えるかどうか。
- Supabase の OAuth で、外部の AI に渡すトークンだけ宛先（aud）を変えること。ドキュメントでは、Custom Access Token Hook で `client_id` ごとに aud を変えられるとされています。実際の環境での確認はまだです（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。
- 工数と費用の数字（どれも見積もりと試算です）。
- 法律の確認（[../legal/README.md](../legal/README.md) の【要確認】）。
