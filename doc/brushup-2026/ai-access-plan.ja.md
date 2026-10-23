# 学習者が AI を使う方法の方針（決定記録）

- 日付: 2026-10-22
- 決めた人: オーナー（Phase 0 を承認）
- 状態: Phase 0 は実施済み。Phase 0.5（未成年のための安全対策）は実施中（オーナーが「おすすめの既定で進める」と承認）。Phase 1（大人が自分の AI をつなぐ）はコードと手順書を作りました（2026-10-23。公開はオーナーの設定と確認のあと）。Phase 2（レッスンの進み具合をサーバーに保存し、AI と学ぶツールを足す）もコードを作りました（2026-10-23。使い始めるのは、オーナーが VM を更新して確かめたあと。6 章）。Phase 3 は条件つきの計画です。
- 関連: [../legal/README.md](../legal/README.md)（プライバシーポリシーと利用規約の下書き）、[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)（データの送り先の一覧）、[../guides/safety-operations.ja.md](../guides/safety-operations.ja.md)（安全の運用ガイド）

この文書の工数（何日かかるか）は、どれも**見積もり**です。作って測ったものではありません。費用は**試算**で、前提を変えると変わります。

## 1. 決めたこと

1. **アプリの中の AI は残します。** 安いモデル（Claude Haiku 5.5）で動かし、今ある 1 日の上限（`server/middleware/dailyCaps.js`）をそのまま使います。
2. **大人の学習者は、自分の AI をつなげるようにします**（Phase 1）。Claude Code、Codex、Claude.ai、自分で動かす Hermes などを、MCP（AI アプリが外部のツールにつながるための共通の決まりごと）でつなぎます。作ったものは 5 章です。
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

- 画面のスイッチ `VITE_FEATURE_AGENT_CHAT` がちょうど `"true"` のときだけ、共有 Hermes のチャット（右下の AI コーチと `/life-journal/chat`）を出します。既定は off です（`config/features.ts:50`、`App.tsx:329-334`、`App.tsx:437-439`）。
- サーバーも同じスイッチを読みます。ちょうど `"true"` でないと、`/api/v2/agent/chat` は 404 を返し、1 日の回数も数えません。前の設定のまま Hermes が動いている VM でも、学習者は共有 Hermes を使えません（`server/routes/agent.js`）。
- 用語の説明の「AI 先生に聞く」ボタン、ライフジャーナルとプロフィール画面のチャットへのボタンも、off のときは出しません（`components/common/GlossaryText.tsx`、`components/features/life-journal/`、`components/features/dashboard/profile/ProfileDiagnosisView.tsx`）。
- AI コーチのエラー表示から、設定名（`HERMES_API_KEY` など）を出さないようにしました（`services/agentApi.ts`）。
- VM の既定の構成を `COMPOSE_PROFILES=tts` にし、Hermes のコンテナを起動しないようにしました（`deploy/risepath-vm/stack.env.example:162`、`deploy/risepath-vm/scripts/deploy-stack.sh`）。

**危ない手順書の書き換え**

- ChatGPT に共有のブリッジトークンを入れ、ngrok で MCP サーバーを公開する手順を消しました。代わりに、トークンを外部に入れないこと、ポートを公開しないことを書きました（`doc/guides/usage_guide.md:182-183`）。

**設定例と文書**

- `.env.example`、`deploy/risepath-vm/stack.env.example`、`deploy/vercel/env.production.example`、README、デプロイの手引きを、上の内容に合わせました。

**テスト**

- 新規: `server/tests/llmGeminiGate.test.js`、`server/tests/courseGenerate.test.js`、`server/tests/agentChatFeatureFlag.test.js`。
- 更新: `server/tests/llmGateway.test.js`、`server/tests/dailyCapsRoutes.test.js`、`server/tests/ragEmbeddings.test.js` など。

**法務の下書き**

- `doc/legal/` の 4 つの文書と、この決定記録を追加しました。

### 3.2 変えていないこと

- 性格インサイト（`assessment.insight`）は中くらいのモデル（Sonnet 5.5）のままです（`server/llm/models.config.js:95`）。
- サーバーの `/api/v2/agent/chat` は残っています。`VITE_FEATURE_AGENT_CHAT=true` にして Hermes を動かさない限り使えません（`server.js:188-190`、`server/routes/agent.js`）。
- 本番の MCP コンテナは管理者用の設定のままで、インターネットには出していません（`deploy/risepath-vm/docker-compose.yml:132`）。
- Memanto（AI メモリ）は既定で止まったままです（`deploy/risepath-vm/stack.env.example:191`）。
- 1 日の上限の値は変えていません（`server/middleware/dailyCaps.js:82-90`）。

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
- 入口の関門（ゲート）: AI を呼ぶすべての POST で、1 日の上限より**前**に判定します。断った呼び出しは回数に数えません（`server/middleware/aiAccessGate.js:68-100`、`server/routes/llm.js:176`、`server.js:161`、`:168`、`:174`、`:189`）。`GET /api/v2/llm/status` は今までどおり誰でも見られます。
- 画像生成（`/api/v2/image`）と AI コーチ（共有 Hermes、`/api/v2/agent/chat`）は、18 歳未満向けの確認と子ども向けの指示がないので、18 歳以上だけにしました。18 歳未満は保護者の同意があっても 403 `adults_only` です（`server.js:172-174`、`:189`）。
- 学習者の画面とAPI: `/settings/ai-access`（年月の登録、保護者の同意、同意のやめ方、スタッフに見せる番号）と `/api/v2/user/ai-access`（`server/routes/aiAccess.js`、`components/safety/AiAccessSetupView.tsx`）。同意文の版は `guardian-ai-2026-10` です（`server/safety/access.js:30`）。
- 外部の AI（ChatGPT のアクション、MCP、Nexloom）が作ったコースの下書きの保存と公開は、学習者のログインで呼ぶ場合は 18 歳以上だけにしました。MCP では、学習者が自分のログイン（JWT）で開いた接続から `save-curriculum-draft` と、データベースに保存する `lesson-upsert-draft` を呼ぶと、書き込む前に同じ判定をします（年月が未登録なら `age_required`、18 歳未満なら `adults_only`）。ブリッジトークンは運営用の経路として扱い、手元の stdio の接続も確かめません（`server/routes/chatgptCurriculum.js:68`、`:218`、`:887`、`tools/core/mcpAiAccess.js:124`、`mcp-server/createMcpServer.js:506`、`:613`）。

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
- 共有の端末: ログアウトのときに、AI の答えをふくむブラウザの保存を消します（`services/sharedDeviceData.ts`、`context/AuthContext.tsx:285`）。Phase 2 で、レッスンの進み具合と学習の履歴も消すようにしました（6.1）。
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

BYOA は「Bring Your Own Agent（自分の AI を持ち込む）」の略です。学習者が自分の契約の AI で Rise Path を使うので、AI の費用は学習者の契約で払われます。2026-10-23 の作業ツリーで作りました。公開の手順は [../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md)、学習者向けのつなぎ方は [../guides/usage_guide.md](../guides/usage_guide.md) の「自分の AI をつなぐ（リモート MCP）」です。

### 5.1 作ったもの

**入口（MCP サーバー）**

- `node mcp-server/index.js --http` で、インターネット向けの入口が動きます（`mcp-server/remote.js`）。MCP の通信方式「Streamable HTTP」の `POST /mcp` だけを受け、セッションを持ちません（リクエストごとに新しい MCP サーバーを作り、答えは JSON）。`GET` と `DELETE /mcp` は 405 です。`GET /health` は `{"status":"ok"}` だけを返します。
- 本番（`NODE_ENV=production`）でしか起動しません。テスト用の `MCP_REMOTE_TEST=1` は 127.0.0.1 だけで待ち受けます。ブリッジトークン、`RISE_PATH_ACTIVE_SESSION_KEY`、`AI_ACCESS_DEV_AUDIENCE` などの開発用の設定は、起動のときに消して使いません。
- 「保護されたリソースのメタデータ」（RFC 9728）を `/.well-known/oauth-protected-resource/mcp`（とルートの `/.well-known/oauth-protected-resource`）で出します。中身は `resource`（`MCP_PUBLIC_RESOURCE_URL`）、`authorization_servers`（Supabase の issuer `<SUPABASE_URL>/auth/v1`）、`bearer_methods_supported`、`resource_name` だけで、独自のスコープは出しません（Supabase は独自のスコープに対応していないため）。トークンがないか正しくないときは、401 と `WWW-Authenticate: Bearer … resource_metadata="…"` を返します（MCP の SDK の `requireBearerAuth`）。
- Host は `MCP_PUBLIC_RESOURCE_URL` のホスト名だけを受け付けます。ブラウザの Origin は `MCP_ALLOWED_ORIGINS` にあるものだけで、ほかは 403 です。

**トークンの検証**（`mcp-server/oauthVerifier.js`）

- Supabase に問い合わせる前に、署名の方式（ES256 か RS256）と鍵の ID が、こちらで取ってきた公開鍵（10 分キャッシュ、知らない鍵の ID での取り直しは 1 分に 1 回まで）にあるかを見ます。でたらめなトークンでは Supabase を呼びません。
- 署名と有効期限は `supabase.auth.getClaims` で確かめます。期限切れや不正は 401（AI アプリがトークンを更新します）、Supabase が答えないときは 503（ログインのやり直しを繰り返させないため）です。
- そのうえで、issuer が一致すること、`aud` が `MCP_PUBLIC_RESOURCE_URL` であること、`client_id` と `sub` が UUID であること、`role` が `authenticated` であること、匿名のユーザーでないことを確かめます。学習者が接続を解除する前に発行されたトークンかどうかも、`mcp_oauth_grants.revoked_at` で確かめます。答えは利用者・アプリ・発行の時刻（`iat`）ごとに覚えます。「解除されていない」は 5 秒（`NOT_REVOKED_CACHE_MS`）、「解除ずみ」は 30 秒（`REVOCATION_CACHE_MS`）です。そのため、解除は数秒以内に効きます。
- トークンはログに出さず、ツールにも渡しません。

**Supabase 側**

- Custom Access Token Hook（`deploy/supabase/custom_access_token_hook.sql`）: `client_id` があるトークン（AI アプリに渡すもの）だけ、`aud` を MCP の URL にします。学習者自身のログインは変えません。

**大人だけ**

- `tools/call`、`resources/read`、`prompts/get` のたびに、トークンの利用者の AI の利用設定を確かめます（`server/safety/access.js` の `resolveAiAccess`）。`ready` で 18 歳以上のときだけ通し、ほかは英語と日本語の説明つきのエラー（`age_required`、`adults_only`、`ai_paused_safety`、`ai_access_unavailable`）を返します。`APP_PUBLIC_URL` があれば `/settings/ai-access` を案内します。確認できないときは断ります。`initialize` とツールの一覧は通します。
- Supabase は、一度許可したアプリには許可の画面を出さずに通します。そのため、許可の画面だけでなく、MCP サーバーで毎回確かめます。

**学習者の範囲だけのツール**（プロファイル `learner-remote`、`mcp-server/tool-registry.json`）

- ツール: `learner-state-get`、`journal-recent`、`learner-adaptation-signals`、`rag-search`（結果は 5 件まで）、`journal-log`、`learner-state-update`（科目の ID を確かめる）。リソース `content://domains`、プロンプト `socratic-tutor`。
- Phase 2 で、公開レッスンを AI と学ぶツールを 5 つ足しました（`course-list`、`course-lesson-get`、`course-quiz-check`、`course-progress-get`、`course-progress-update`。6.1）。今のツールは全部で 11 です。
- 出さないもの: 生活記録（`daily-life-*`）、AI メモリ（`learner-memory-*`、`learner-personal-context`）、性格のプロフィール（`learner://profile/me`）、読み上げ（`request-tts`）、`journal-summary`、カリキュラムとレッスンづくりのツール、`author-lesson` のプロンプト。
- 学習者は、いつも検証したトークンの利用者です（`tools/core/mcpUserScope.js` の最初の手順）。`PHASE1_USER_ID` や開発用の利用者には落ちません。ツールに `user_id` や `rp_turn` の引数はありません。

**上限**

- 1 分あたり: 利用者とアプリの組ごとに 60 回、トークンのないリクエストは接続元（`cf-connecting-ip`）ごとに 30 回（`express-rate-limit`）。1 回のリクエストに入れられるメッセージは 10 件まで。
- 1 日あたり（日本時間）: 新しい種類 `mcp`（すべての `tools/call`。1 人 300 回、全体 20,000 回）と `mcp_write`（`journal-log`、`learner-state-update`、Phase 2 で足した `course-progress-update`。1 人 50 回、全体 5,000 回）（`server/middleware/dailyCaps.js`、`mcp-server/remotePolicy.js` の `REMOTE_WRITE_TOOLS`）。Phase 2 の `course-quiz-check` は `mcp` だけに数えます（6.1）。Claude.ai や ChatGPT は事業者の同じアドレスから来るので、この 2 つには接続元ごとの上限を付けません。超えたら `daily_limit_reached` のエラーです。`dailyCaps` の判定は Express の外からも呼べるようにしました（今までの動きは変えていません）。

**アプリの API の守り**

- `server/middleware/auth.js`（`requireAuth`、`optionalAuth`）、`server/middleware/bridgeAuth.js`、管理者用の MCP の SSE の入口は、`client_id` があるトークンと、`aud` が `authenticated` でないトークンを断ります（`tools/core/oauthToken.js` の `isOAuthClientToken`）。`requireAuth` は 401 `oauth_client_token`、`optionalAuth` はログインしていない人として扱います。Supabase の `getUser` はこうしたトークンも受け付けるため、こちらで区別します。

**接続したアプリの記録と解除**

- 新しい表 `mcp_oauth_grants`（`server/migrations/015_mcp_oauth_grants.sql`）。MCP サーバーが、利用者とアプリの組ごとに最初と最後に使った日時を書きます（最後に使った日時は 1 分に 1 回まで）。`revoked_at` とアプリの名前（`client_name`）を書くのはアプリの API だけです。MCP サーバーの DB ロールは、`user_id`、`client_id` の追加と、`first_seen_at`、`last_used_at` の更新しかできません。一度も呼ばなかったアプリを解除すると、使った日時は空（NULL）のまま行ができ、画面は「まだ使われていません」と出します。
- `GET /api/v2/user/connected-apps` と `POST /api/v2/user/connected-apps/:clientId/revoke`（`server/routes/connectedApps.js`）。解除は 3 つの手順です（`services/oauthConsentRules.ts` の `revokeConnectedAppWith`）。(1) `revoked_at` を書きます。それより前に発行されたトークンは、数秒以内に 401 になります。(2) 画面が Supabase の `revokeGrant` を呼び、リフレッシュトークンを消します。(3) `revokeGrant` が通ったら、もう一度 `revoked_at` を書きます。(1) と (2) のあいだに AI アプリがトークンを更新しても、そのトークンは (3) で断られます。(3) が 2 回とも失敗したら、画面が「もう一度試す」を出します。解除のときは、Supabase の一覧に出ていたアプリの名前（前後の空白を除き、100 字まで）も保存します。Supabase が許可を消したあとも、解除ずみの欄でアプリを見分けられます。

**画面**

- 許可の画面 `/oauth/consent`（`components/features/oauth/OAuthConsentView.tsx`）: ログインしていなくても開け、サインインやアカウントづくりのあいだも、リクエストを 10 分まで覚えます。アプリの名前（アプリが自分で付けたものと表示）、サイト、戻る先のホスト名（`localhost` などには注意）、読めるもの・書けるもの・見られないもの、データが学習者の AI の会社に送られること、サインイン中のアカウントを出します。「許可する」のすぐ上に、許可したアプリはアカウントのサービス（Supabase Auth）であなた自身と同じ力を持つので、信頼できるアプリだけを許可するよう出します（5.3）。18 歳以上で利用設定が `ready` のときだけ「許可する」を出し、年月が未登録ならその場で登録できます。
- 「つないでいる AI アプリ」`/settings/connected-apps`（`components/features/settings/ConnectedAppsView.tsx`）: Rise Path の記録と Supabase の `listGrants` をあわせて表示し、解除できます。

**デプロイ**

- Compose のサービス `mcp-public`（プロファイル `byoa`）: `mcp` と同じイメージを `--http` で動かし、ホストにポートを出さず、`edge` ネットワークでトンネルから届きます。読むのは `mcp-public.env` だけで、ブリッジトークン、service_role key、モデルや Memanto のキーを持ちません。`node` ユーザー、読み取り専用、ケイパビリティなしで動きます。
- 最小権限の DB ロール `risepath_mcp_remote`（`deploy/risepath-vm/sql/mcp_remote_role.sql`）。権限は、リモートのツール・年齢の確認・上限・接続の記録に要る表と列だけです。`ai_safety_events` は判定に使う 4 つの列だけで、報告の文章（`detail`）は読めません。`materials` は `id`、`user_id`、`status` だけで、`material_chunks` は検索に使う列だけです。`user_age` と `account_consents` も判定に使う列だけです。`mcp_oauth_grants` は `client_name` を読めず、`revoked_at` を書けません。`ai_daily_usage` は RLS を on にし、このロールには種類 `mcp` と `mcp_write` の行だけを読み書きするポリシーを作りました。表の持ち主の `risepath_app`（スーパーユーザー）は RLS を通らないので、API は変わりません。手元の Postgres 16 で、全 migration のあとにこのロールで本物の入口を動かし、6 つのツール（Phase 1 のとき）とリソースとプロンプトが動くことを確かめました。Phase 2 で `lesson_progress` の権限を足しました（6.1）。ほかの表（生活記録、AI メモリなど）と、上の外した列が読めないこと、ほかの種類の上限の行が見えず書けないことも確かめました。
- Cloudflare Tunnel の 2 つ目のルート `mcp.<domain>` → `http://mcp-public:3200`。前に Cloudflare Access やボットのチャレンジを置きません。
- `deploy-stack.sh` は、`byoa` のとき、`tunnel` がない、`mcp-public.env` がないか見本の値のまま、`stack.env` の秘密や `risepath_app` が入っている、のどれかなら止まります（変数の名前だけを表示）。`export ` 付きの行、`=` の前後の空白、引用符でかこんだ値も、Docker Compose と同じように読みます。

**テスト**: `server/tests/` の `mcpRemote`、`mcpRemoteEntry`、`mcpRemoteScope`、`mcpRemoteVerifier`、`oauthClientTokenGuard`、`connectedAppsRoutes`、`oauthConsentFront`、`dailyCaps`、`mcpAiAccess`、`apiMounts`、`vmStackConfig`。本物の Supabase の代わりに、127.0.0.1 で ES256 の公開鍵を出す偽の Supabase（`server/tests/helpers/fakeSupabase.js`）を使います。

### 5.2 オーナーの作業

[../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md) の順に行います。ステージングの Supabase プロジェクト → JWT の署名鍵を ES256 に（古い秘密鍵は残す）→ Site URL の確認 → OAuth サーバーを有効にし Authorization Path を `/oauth/consent`、DCR を on（OAuth Apps を毎週見る）→ フック → DB ロールと `mcp-public.env` → Cloudflare の `mcp.<domain>` → `COMPOSE_PROFILES` に `byoa` → MCP Inspector、Claude Code、Codex、Claude.ai のコネクタで確認。戻し方も同じ文書にあります。

### 5.3 受け入れているリスク（Supabase の OAuth 2.1 サーバーはベータ版）

- **宛先（aud）の結びつけは、自分たちのフックに頼っています。** Supabase は RFC 8707 の `resource` を確かめるだけで、`aud` には入れません（2026-10-21 時点の supabase/auth のソースコードと文書で確認。本番の Supabase の版とちがう可能性があります）。フックがないか止まっていると、AI アプリのトークンの `aud` は学習者のログインと同じ `authenticated` になります。そのとき MCP サーバーはすべて 401 にし（安全な側）、アプリの API は `client_id` で断ります。
- **AI アプリのトークンは、Supabase Auth では学習者本人のログインと同じ力を持ちます。** supabase/auth のソースコード（`internal/api/user.go`、2026-10-21 時点）を読んだかぎりでは、Supabase Auth の `/user` や許可の API は、AI アプリのトークンも受け付けます【本番の Supabase では未検証】。Supabase の設定で、トークンの届く範囲は狭められません。
  - **パスワードを設定・置き換えて、アプリの API に入れます。** AI アプリは `/user` でアカウントのパスワードを設定するか置き換え、そのパスワードでふつうにログインできます。そのログインは学習者自身のものと同じ形（`client_id` なし、`aud` は `authenticated`）なので、アプリの API の守り（`isOAuthClientToken`）を通り、アプリの API と VM のデータをすべて使えます。メールアドレスの変更も同じ経路です。
  - **対策（オーナーの設定）**: Authentication → Sign In / Providers → Email で、「Require current password when changing password」（今のパスワードを確かめる）、「Require reauthentication when changing password」（ダッシュボードでは「Secure password change」。ログインから 24 時間をこえたら、メールで届くコードを求める）、「Secure email change」（前と後の両方のアドレスで確かめる）を on にします（<https://supabase.com/docs/guides/auth/password-security>、<https://supabase.com/docs/guides/self-hosting/auth/config>。手順は [../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md) の 6）。
  - **それでも残るもの**: 今のパスワードの確認は、パスワードのないアカウントでは働きません。AI アプリのセッションは許可した時刻に作られるので、許可から 24 時間はコードも求められません。つまり、パスワードのないアカウントでは、許可から 24 時間のあいだ、AI アプリがパスワードを設定できます。Rise Path の登録画面はパスワードを作りますが、同じ Supabase プロジェクトのほかの入口で作ったアカウントにはないことがあります。
  - **減らし方**: 許可の画面は「許可する」の上に、アプリが自分と同じ力を持つので信頼できるアプリだけを許可するよう出します。DCR を on にして毎週 OAuth Apps を見るか、DCR を off にして知っているクライアントだけを登録します（下の「DCR の乱用」）。どちらにするかと、このリスクを受け入れるかは、オーナーが決めます（5.4）。
  - P-School が使う Supabase の表は、RLS に `(auth.jwt() ->> 'client_id') is null` を足すまで、AI アプリのトークンでも読み書きできる可能性があります（`deploy/supabase/README.md`）。Rise Path のアプリの API と VM のデータは、AI アプリのトークンそのものなら上の守りで断ります。
- **PKCE の `plain` を Supabase が受け付けます**（止められません）。MCP の決まりごとは、クライアントに `S256` を使うよう求めています。Claude と ChatGPT は `S256` を使うと案内しています。危険は小さいと判断しました。
- **DCR の乱用**: 誰でも AI アプリを登録できます。上のとおり許可したアプリは学習者と同じ力を持つので、許可をだまし取るための登録もできます。Claude は新しく接続するたびに登録します。毎週 OAuth Apps を見て、見覚えのないものや使われていないものを消します。DCR を off にすると、Authentication → OAuth Apps で登録しておいたクライアントだけがつなげます（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。ただし、クライアント ID を手で入れられない AI アプリはつなげなくなります【要確認: どのアプリが対応しているか】。登録の制限は接続元の IP アドレスごとなので、Claude.ai や ChatGPT の利用者が増えると、事業者のアドレスで制限にかかるおそれがあります【要確認】。
- **MCP の SDK 1.29 は、ハンドシェイク（`initialize`）のある古い版（2025-11-25 まで）だけを話します。** 今の最新の版は 2026-07-28 です。新旧の両方に対応したクライアントは古い版に切り替えてつながりますが、新しい版だけのクライアントはつながりません。新しい版の SDK（`@modelcontextprotocol/server` 2.x）は zod 4 が要り、新しい依存関係になるので、オーナーが別に決めます。
- **CIMD と RFC 9207（認可の応答の `iss`）がありません。** AI アプリは DCR で登録します。ChatGPT は、固定でない戻り先を使います。
- **解除の効き方**: Rise Path の MCP サーバーでは、解除は数秒以内に効きます。「解除されていない」という答えを 5 秒まで覚えるためです（解除を書くのは API のコンテナで、`mcp-public` の覚えた答えを消せません）。Supabase 側では、`revokeGrant` でリフレッシュトークンが消えますが、発行済みのアクセストークン自体は期限（最大 1 時間）まで有効です。そのため、`revokeGrant` が通ったあとに `revoked_at` をもう一度書き、そのあいだに発行されたトークンも断ります。この 2 回目の書き込みが失敗すると、直前の数秒に発行されたトークンが最大 1 時間通ることがあり、画面は「もう一度試す」を出します。`revokeGrant` だけが失敗すると、AI アプリはリフレッシュで新しいトークンを得られ、そのトークンは `revoked_at` より後に発行されたので通ります（新しい許可と見分けられないため）。画面はこの状態を「解除が終わっていません」と出し、もう一度押すと `revokeGrant` をやり直します。MCP サーバーは `revoked_at` を消さないので、この表示は残ります。
- **使えない使い方**: 決まったトークン（`Authorization` ヘッダーを手で書く設定）、デバイスフロー（ブラウザのないサーバーの上の Hermes など）。
- **データの行き先**: AI アプリが読んだ学習の記録は、学習者が選んだ AI の会社に送られ、学習者とその会社との規約で扱われます（[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)）。

出典: Supabase の OAuth 2.1 サーバー <https://supabase.com/docs/guides/auth/oauth-server/getting-started>、MCP 認証 <https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication>、トークンと RLS <https://supabase.com/docs/guides/auth/oauth-server/token-security>、MCP の認可 <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>、Claude のコネクタの認証 <https://claude.com/docs/connectors/building/authentication>。

### 5.4 残っていること

- オーナーの設定と、実際のクライアント（MCP Inspector、Claude Code、Codex、Claude.ai、ChatGPT）での確認。クライアントごとに、プロトコルの版と登録の方式を記録します。
- Supabase の DCR の制限値（本番）と、引き上げられるか。
- P-School の表の RLS（`client_id` の条件）を足すか。
- パスワードの変更の設定（5.3）を on にしたかと、パスワードのないアカウントで許可から 24 時間に残るリスクを受け入れるか。DCR を on にして毎週見るか、off にして知っているクライアントだけを登録するか。決めたことをここに書きます。
- 工数（見積もり・未検証）: 開発は当初の 6〜8 日の上のほうでした。オーナーと運用の作業（Supabase、Cloudflare、実際のクライアントでの確認）は 2〜3 日の見込みです。

## 6. Phase 2: 進み具合をサーバーに保存し、学習のツールを足す

前は、レッスンの進み具合（どこまで読んだか、確認問題の答えなど）が、その端末のブラウザの中だけにありました。Phase 2 で、ログインした学習者の進み具合をサーバーにも保存するようにしました。別の端末でも、続きから学べます。また、自分の AI をつないだ大人の学習者（5 章）が、AI と一緒に公開レッスンを学べるツールを足しました。

2026-10-23 の作業ツリーで作りました。最終的な差分はプルリクエストを見てください。この章では、次の言葉を使います。

- **同期**（どうき）: 端末とサーバーの記録を、同じ内容にそろえることです。
- **まとめる**（マージ）: 2 つの記録を 1 つにすることです。Phase 2 では、読んだところと解答は足し合わせるだけで、減らしません（下の「決めたこと」）。
- **公開レッスン**: `content/courses/<コース>/course.json` に載っていて、`lessons/` にあるレッスンです。今は vibe-coding（13）と claude-code（11）の 2 つのコースです。下書き（`drafts/`）は入りません。

### 6.1 作ったもの

**決めたこと**（作るときに決めました。オーナーの確認はまだです【要確認】）

- サーバーが、記録をまとめる役をします。届いた記録をそのまま保存せず、保存ずみの記録とまとめます。読んだブロックと解答は足し合わせます。一度正解した問題と、答えを見た問題は、そのまま確定します。チェックリストと自己評価は、新しく変えたほうを残します（`shared/lesson/progressMerge.js`）。
- 18 歳未満もふくめ、ログインした人はみな同期します。進み具合は AI の機能ではないためです。インターネット向けの MCP のツールは、5 章と同じく 18 歳以上だけです。
- 共有の端末では、別の学習者の記録を先に消してから、次の学習者を画面に出します。だれのものでもない記録は、学習者に聞いてからアカウントに入れます。
- 「学習の進み具合を消す」は、すべての端末で消えたままにします。
- Web のレッスン画面の答えは、自己申告として受け取ります（6.3）。サーバーで採点するのは MCP の `course-quiz-check` だけです。
- ツールの名前は `course-*` にしました。教材づくりのツール（`lesson-*`）と分けるためです。

**共通の部品（ブラウザとサーバーで同じ計算）**

- `shared/lesson/progress.js`: 進み具合の記録の形と、% と状態の計算です。状態は `not_started`（まだ）、`in_progress`（途中）、`read`（読んだ）、`checked`（確認問題に答えた）、`mastered`（確認テストの 8 割以上に初回で正解）の 5 つです。前は `components/lesson/progressStore.ts` と `components/lesson/model.ts` にあったものを移しました（どちらも今までどおり使えます）。記録にあって今のレッスンにない ID は、計算で数えません（レッスンの版がずれても困らないようにするため）。
- `shared/lesson/grading.js`: 選択肢の確かめ方と、Web のレッスン画面と同じ解答のルールです。正解したら確定、2 回まちがえたら答えを見せて確定、予想の問題は 1 回だけです。答えのあとに見せてよいものも決めています。最初のまちがいでは、選んだ選択肢へのひとこととヒントだけで、正解と解説は出しません。
- `shared/lesson/learnerView.js`: レッスンから、答え・解説・ヒント・選択肢ごとのひとこと・選択肢の ID を外します。選択肢は、順番の番号（"1"〜"n"）で呼びます。AI 向けの短い教え方の約束（`TUTOR_PROTOCOL`）もここにあります。学習者に答えさせること、学習者の選んだ答えだけを送ること、などです。
- `shared/lesson/progressMerge.js`: 2 つの記録のまとめ方です。ブラウザから届いた記録は、形を整えて（ID の形、件数の上限、日時）からまとめます。
- この 4 つのファイルは zod などを読み込みません。Web の画面のプログラムが大きくならないようにするためで、テストで確かめています（`server/tests/lessonProgressMerge.test.js`）。

**サーバー**

- 新しい表を 2 つ作りました（`server/migrations/016_lesson_progress.sql`）。
  - `lesson_progress`: 学習者と公開レッスンの組ごとに 1 行です。読んだブロック、解答（選んだ選択肢、正しかったか、回数、初回で正解したか、答えを見たか）、チェックリストなどの印、目標ごとの自己評価、続きの位置、そこから計算した % と状態、レッスンの版（ハッシュ）を持ちます。1 行 64 KiB までです。
  - `lesson_progress_resets`: 「学習の進み具合を消す」を使った学習者ごとに 1 行です。消すたびに新しい番号（エポック）になります。消す前の番号のまま保存しようとした端末は、409 `progress_reset` で断ります。そのため、ほかの端末に残っていた古い記録が、サーバーに戻ってきません。
- 公開レッスンの一覧（`tools/core/courseCatalog.js`）: 公開レッスンだけを読み、検証に通らないレッスンは外します。
- 保存の処理（`tools/core/lessonProgress.js`）: % と状態は、サーバーのレッスンでいつも計算し直します。同じ学習者の保存と削除は、データベースのロックで 1 つずつ順に行います。
- API `/api/v2/user/lesson-progress`（`server/routes/lessonProgress.js`、`server.js:113`、`:204`）: GET（読む）、PUT（1 回 25 件、256 KB まで）、DELETE（すべて消す）です。ログインが必要です。AI の利用設定（年齢）は確かめません。書き込み（PUT と DELETE）は 1 人 1 分 30 回までです。AI アプリのトークンは、今までどおり 401 `oauth_client_token` で断ります。
- エラーに、データベースの文章を出しません。リモート MCP の DB ロールに権限がないとき（コード 42501）は、`permission_denied`（`server setup incomplete`）を返し、サーバーのログに「ロールの SQL を流し直す」と出します（`tools/core/dbErrors.js`）。

**Web のレッスン画面（ブラウザ）**

- 同期の中心は `components/lesson/progressSync.ts` です（ブラウザに頼らない部分で、テストで動かせます）。ブラウザとのつなぎは `components/lesson/progressSyncClient.ts`、API の呼び出しは `services/lessonProgressApi.ts` です。
- 同期するのは、Rise Path のメインのログイン（Supabase）でログインしている人だけです。ゲスト、開発用の仮のユーザー、Nexloom だけのログインは、今までどおりその端末のブラウザの中だけです。
- どの学習者の記録かを、ブラウザの `rp:progressSync:account` に覚えます。ログインのとき（`context/AuthContext.tsx`）、学習者を画面に出す前に、次のことをします。
  - 前に別の学習者の記録があれば、先にブラウザから消します（レッスンの記録、続きの位置、学習の履歴）。
  - だれのものでもない記録（この機能より前に保存したもの、ゲストで学んだもの）があれば、「この端末に保存されている学習の記録を、あなたのアカウントに追加しますか？」と聞きます（`components/lesson/ProgressAdoptDialog.tsx`、`App.tsx`）。最初に選ばれているのは「追加しない」で、Esc キーでも「追加しない」になります。追加しないと、その記録は端末から消えます。ほかのタブで答えたときは、その答えに従います。
- 読み込み: ページを開いてから学習者ごとに 1 回、サーバーの記録を読んで、ブラウザの記録とまとめます。サーバーにない記録はアップロードします。開いているレッスンの画面も、サーバーの記録を取り込みます。このとき「始めた」「終えた」の学習の履歴は増やしません。新しい端末では、ダッシュボードの「続きから」が、最後に学んだレッスンを指します。
- 保存: 変えてから 5 秒後（変え続けていても 60 秒以内）に送ります。1 つのタブから送るのは 20 秒に 1 回までです（拠点では、同じ接続元の上限を何人もで分け合うため）。失敗したら、最大 5 分まで間をあけてやり直します。画面を閉じるときにも送ります。送れていない記録には印（`rp:progressSync:pending:<コース>:<レッスン>`）を付け、サーバーがその中身を受け取ったと確かめてから印を外します。
- ログアウト: 送れていない記録を 3 秒まで待って送ります。そのあと、送れた記録、続きの位置、学習の履歴（`rp_learning_events`）をブラウザから消します。送れなかった記録だけは残し、同じ学習者が次にログインしたときに送ります。
- ほかのタブで別の学習者がログインしたときや、記録が消されたときは、開いているレッスンの画面は書き込まずに、記録を読み直します。
- 「学習の進み具合を消す」（設定 → プライバシー `/settings/privacy`、`components/features/settings/LessonProgressDeleteSection.tsx`）: 確認のダイアログのあと、先にサーバーで消し、うまくいったときだけ、この端末からも消します。失敗したら何も変えずに、エラーを出します。ほかの端末は、次に読み込んだときに番号のちがいで気づき、自分の記録を消します。消えるのは、すべてのコースの、読んだところ、確認問題の答え、チェックリスト、自己評価、続きの位置です。連続記録と学習の履歴、AI アプリが `learner-state-*` で保存した記録は消えません（画面にもそう書いています）。ゲストの場合は、この端末の記録だけが消えます。
- ダッシュボードとコースのページは、記録が変わると表示を新しくします（`components/lesson/useProgressVersion.ts`）。

**MCP のツール（自分の AI と学ぶ）**（`mcp-server/createMcpServer.js`、`mcp-server/tool-registry.json`、`tools/core/courseLessons.js`）

| ツール | すること | 書き込み |
|---|---|---|
| `course-list` | 公開コースと、そのモジュールとレッスン（問題の数、確認テストがあるか）の一覧 | なし |
| `course-lesson-get` | レッスンを読む。答え・解説・ヒントは入れない。選択肢は "1"〜"n"。`section_id` がなければ、目次と、学習者がまだ終えていない最初のセクション。いつもレッスンの版（`content_hash`）と教え方の約束を返す | なし |
| `course-quiz-check` | 学習者が選んだ答えをサーバーで採点し、学習者の解答として記録する。最初のまちがいでは、ひとこととヒントだけ。正解、2 回目のまちがい、答えを見る（`reveal`）のあとで、正解と解説。レッスンの版が変わっていたら採点しない（`lesson_changed`） | あり（取り消せない） |
| `course-progress-get` | 進み具合。レッスンごとの % と状態か、1 つのレッスンのセクションごとの進み、問題ごとの状況（答えは入れない）、続きの位置、確認テストの初回正答 | なし |
| `course-progress-update` | 学習者が取り組んだセクションを「読んだ」と記録し、続きの位置を決める。確認問題が残っているセクションは記録せず、`skipped` で返す | あり |

- 使えるプロファイル: インターネット向けの `learner-remote`（18 歳以上だけ。5 章）と、手元の `learner` と `admin` は 5 つ全部です。`coach` は読む 3 つ（`course-list`、`course-lesson-get`、`course-progress-get`）です。教材づくりの `curriculum-builder` にはありません。
- 学習者は、いつもトークンの学習者です（手元の stdio では `rp_turn`）。ツールに `user_id` の引数はありません。
- 1 日の上限: 5 つとも `mcp`（1 人 300 回）に数えます。`course-progress-update` は `mcp_write`（1 人 50 回）にも数えます。`course-quiz-check` は書き込みですが、1 問につき採点は 2 回まで（正解か 2 回のまちがいで確定）なので、`mcp` だけにしました。学習者が問題に答えているうちに、書き込みの上限に届かないようにするためです（`mcp-server/remotePolicy.js`、`server/middleware/dailyCaps.js`）。
- `course-quiz-check` と `course-progress-update` は、監査の記録を残します。サーバーのログに、ツールの名前、アカウント ID の先頭 8 文字、アプリの ID、渡された項目の名前、成功したかを書きます。中身は書きません（`mcp-server/policy.js` の `auditLog`）。
- 古い `learner-state-get`・`learner-state-update` の題名と説明を書き換えました。vibe-coding と claude-code のレッスンには course-* のツールを使うよう、AI に案内します（古いツールの記録は、Web のレッスン画面に出ないため）。`content://domains` は、コースのある科目に `course_slug` を付けます。プロンプト `socratic-tutor` は、`course_slug` と `lesson_id` を受け取ると、そのレッスンと教え方の約束を入れます（`tools/core/domains.js`）。
- 許可の画面とつないでいるアプリの画面に、次の説明を足しました（英語と日本語。`components/features/oauth/OAuthConsentView.tsx`、`components/features/settings/ConnectedAppsView.tsx`）。「Rise Path のコースのレッスン（クイズの答えは除く）」「レッスンごとの進み具合」を読める。「クイズの答えを確かめる（確かめるたびに、あなた自身の解答として記録されます）」「取り組んだレッスンのセクションを、読み終えたと記録する」ができる。
- DB ロール: `deploy/risepath-vm/sql/mcp_remote_role.sql` に、`lesson_progress` の SELECT・INSERT・UPDATE を足しました。DELETE と `lesson_progress_resets` は渡しません。記録を消せるのは、学習者がアプリの画面で行う操作だけです。

**テスト**

- 新しいテスト: `server/tests/` の `lessonGrading`、`lessonLearnerView`、`lessonProgressMerge`、`courseCatalog`、`lessonProgressCore`、`lessonProgressRoutes`、`mcpCourseTools`、`lessonProgressSync`。直したテスト: `apiMounts`、`vmStackConfig`、`mcpRemote`、`mcpLessonTools`、`mcpLearnerIsolation`、`oauthConsentFront`、`domains`。
- すべての公開レッスンとすべての問題で、AI に渡す形に答えが残らないこと、採点のあとに見せるものがルールどおりであることを確かめます。
- データベースは、テスト用のメモリの上の表（`server/tests/helpers/lessonProgressPool.js`）を使います。ほかに、手元の Postgres 16 で 1 回、次のことを確かめました（テストには入っていません）。保存・削除・答え合わせを同時に何度も動かしても記録がこわれないこと。`risepath_mcp_remote` のロールで、答え合わせ、セクションの記録、進み具合の読み出しができること。このロールでは、行を消せず、`lesson_progress_resets` も読めないこと。
- ブラウザ: 偽の API を使い、追加のダイアログ、プライバシーの画面で消す操作、新しい端末での「続きから」を動かし、画面の写真を見て確かめました。
- `npm test` は 1,816 件すべて通りました（2026-10-23）。

### 6.2 オーナーの作業

1. **プルリクエストを `main` にマージしたら、すぐに VM を更新します。** Vercel は `main` へのマージで、新しい画面を自動で出します（Production Branch が `main` のため。`deploy/vercel/README.md`）。VM は、`./scripts/deploy-stack.sh` を実行するまで古いままです。このスクリプトが migration 016 を当てます（`server/migrations/README.md`）。VM が古いあいだは、ログインした学習者の進み具合をサーバーに保存できません。記録は「送れていない記録」としてその端末に残ります（6.3 の共有の端末の場合を除く）。【要確認: VM を先に更新するため、マージのあいだだけ Vercel の自動デプロイを止めるか】
2. **自分の AI をつなぐ機能（5 章、プロファイル `byoa`）をもう動かしているなら、更新のあとに DB ロールの SQL を流し直します。** 手順は [../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md) の 7 です。今のパスワード（`mcp-public.env` の値）をそのまま渡します。流し直すまで、リモートの AI アプリでは `course-quiz-check`、`course-progress-get`、`course-progress-update` が `permission_denied`（`server setup incomplete`）になります。`course-list` と `course-lesson-get` は動きます。
3. **確かめます。**
   - 同じ学習者で 2 つの端末（または 2 つのブラウザ）にログインします。片方で読んだレッスンが、もう片方の「続きから」に出ること。
   - 共有の端末で、学習者 A でログインしてレッスンを少し読み、ログアウトします。学習者 B でログインしたとき、A の記録が出ないこと。
   - 前から記録がある端末でログインすると、追加するかのダイアログが出ること。
   - 設定 → プライバシーで「学習の進み具合を消す」を使うと、もう 1 つの端末でも、次に開いたときに消えていること。
   - （`byoa` を動かしているとき）MCP Inspector でツールが 11 あること。`course-lesson-get` の結果に、正解（`correct`）、解説（`explanation`）、ヒント（`hint`）がないこと。`course-quiz-check` でまちがえると、ひとこととヒントだけが返ること。その答えが、Web のレッスン画面にも出ること。
4. **拠点のスタッフに伝えます。** 共有の端末では、ログアウトの前にインターネットにつながっているかを確かめます（6.3）。確認テストの結果や「マスター」は、資格や成績の証明ではありません（6.3）。【要確認: 拠点での伝え方】
5. **プライバシーポリシーの下書きを確かめます。** レッスンの進み具合の項目を足しました（[../legal/privacy-policy.draft.ja.md](../legal/privacy-policy.draft.ja.md) の 2、3、4.4、8、9、10）。18 歳未満の進み具合をサーバーに保存することに、保護者の同意が要るかは【要確認】です（[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md) の「気をつける点」）。

### 6.3 受け入れているリスク

- **Web のレッスン画面の答えは、自己申告です。** Web の画面は、ブラウザの中で採点します。そのため、正解は画面のプログラムに入っています（`content/index.ts` がレッスンの JSON を読み込みます）。学習者は、ブラウザの開発ツールで正解を見たり、API に「正解した」という記録を直接送ったりできます。サーバーは、届いた解答の形だけを確かめて保存し、正しいかどうかは採点し直しません。サーバーで採点するのは、MCP の `course-quiz-check` だけです。
- **正解は、Web の画面の配信物に入っています。** `course-lesson-get` は AI アプリに答えを渡しませんが、正解は秘密ではありません。AI アプリに答えを渡さないのは、学習者が自分で考えるのを助けるためで、不正を防ぐためではありません。
- **「マスター」は、資格の証明ではありません。** 状態 `mastered` は、確認テストの問題の 8 割以上に初回で正解した、という意味だけです（`shared/lesson/progress.js` の `lessonState`）。上のとおり自己申告で、本人であることも確かめていません。修了証や成績として、外に出しません。もし修了証を出すなら、サーバーで採点し、本人を確かめる別の仕組みが要ります。
- **共有の端末で、送れていない記録が消えることがあります。** ログアウトのときにインターネットにつながっていないと、送れなかった記録はその端末に残ります。同じ学習者が次にログインすれば送られます。でも、その前に別の学習者がログインすると消えます（ほかの子の記録を自分のアカウントに入れないためです）。学習者には知らせません（6.4）。ログアウトせずにログインが切れて、別の学習者がログインした場合も同じです。
- **Vercel と VM の版がずれることがあります。** 画面（Vercel）は、レッスンを画面のプログラムに入れて配ります。サーバー（VM）は、自分のコンテナの中の `content/` を読みます（`deploy/risepath-vm/Dockerfile:17`、`:39`）。この 2 つは、別々に更新されます。
  - 新しいレッスンが画面にだけあると、サーバーはその記録を `unknown_lesson` で断ります。記録は端末に残りますが、送れていない印が外れるので、ログアウトで消えます。
  - サーバーにだけあるレッスンの記録は、画面が読み込みのときに飛ばします（サーバーには残ります）。
  - レッスンの中身が変わったときは、画面とサーバーがそれぞれ自分の版で % と状態を計算します。サーバーは、保存した版（ハッシュ）とちがえば計算し直します。知らない ID の記録も、形が正しければ消さずに残します。
  - 減らし方: レッスンを足したり変えたりしたら、すぐに VM を更新します（6.2 の 1）。
- **消したあとに戻ってくる記録が、少しだけあります。** 「学習の進み具合を消す」のあと、ほかの端末は番号のちがいで気づいて、自分の記録を消します。ただし、その学習者がログインしてから一度もサーバーとつながっていない端末（ずっとオフラインだった端末）は、比べる番号をまだ持っていません。その端末で付けた記録は、つながったときにアップロードされます（`components/lesson/progressSync.ts` の hydrate）。
- **ゲストの記録を「追加する」と、ほかの子の記録も入ることがあります。** だれのものでもない記録を追加するかは、ログインした学習者が決めます。共有の端末で前にゲストで学んだ子がいると、その記録も入ります。ダイアログは「ほかの人がこの端末で学習していた場合は『追加しない』を選んでください」と書き、最初から「追加しない」を選んでいます。
- **AI アプリは、学習者の代わりに答えを送れてしまいます。** ツールの説明で「学習者の選んだ答えだけを送る」「選択肢を試さない」と求めていますが、守るかは AI アプリしだいです。送った答えは学習者の解答として残り、取り消せません。
- **AI アプリが読んだ進み具合は、学習者が選んだ AI の会社に送られます**（5.3 と同じ）。「学習の進み具合を消す」を使っても、AI の会社に送られたものは消せません。

### 6.4 残っていること

- オーナーの更新と確認（6.2）。実際の AI アプリ（Claude Code、Claude.ai など）で course-* のツールを試すこと。AI が教え方の約束（`TUTOR_PROTOCOL`）をどれくらい守るかも、まだ見ていません。
- **ログアウトのときの表示**: 「保存しています」の表示も、送れていない記録があるときの確認（「まだ保存できていない学習があります」など）もありません。サーバーに届かず同期が止まっていることも、画面には出ません。
- 追加のダイアログに答えるまで、後ろのダッシュボードには、だれのものでもない記録が出たままです。
- Nexloom だけでログインした人は、同期しません。メインのログインの学習者がオフラインでログアウトしたあとに、Nexloom だけの人がその端末でログインすると、残った記録が見えます（その人のアカウントには入りません）。
- 1 つのレッスンだけを最初からやり直す機能はありません（消すときは、すべてのコースが対象です）。
- 古い進み具合（表 `user_progress`、`/api/v2/user/progress`、`learner-state-*` のツール）は、そのまま残しています。vibe-coding と claude-code 以外の科目は、まだ古い形です。
- XP やバッジをサーバーに保存すること、先生が学習者の進み具合を見る画面は、Phase 2 には入れていません。
- 保存期間: 学習者が消すか、アカウントを消すまで残ります。アカウントを消す機能はまだありません（4.4）。
- 工数（見積もり・未検証）: 当初の見積もりは開発 6〜8 日でした。実際にかかった日数は測っていません【要確認】。オーナーの更新と確認は、半日ほどの見込みです。

## 7. Phase 3（条件つき）: 有料プラン

寄付・助成・無料の枠で費用がまかなえなくなったときだけ検討します。

- 決済は Stripe を使います。プランごとの 1 日の上限を作ります（今の上限はプランの区別がありません: `server/middleware/dailyCaps.js:82-90`）。
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
- Supabase の OAuth で、外部の AI に渡すトークンだけ宛先（aud）を変えること。フック（`deploy/supabase/custom_access_token_hook.sql`）は作り、手元の Postgres で動きを確かめました。Supabase の実際の環境での確認はまだです（<https://supabase.com/docs/guides/auth/oauth-server/token-security>）。
- 工数と費用の数字（どれも見積もりと試算です）。
- 法律の確認（[../legal/README.md](../legal/README.md) の【要確認】）。
