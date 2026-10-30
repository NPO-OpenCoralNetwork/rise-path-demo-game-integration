# 学習者が AI を使う方法の方針（決定記録）

- 日付: 2026-10-22
- 決めた人: オーナー（Phase 0 を承認。Phase 3 は 2026-10-23 に「作るが止めておく。テストモードだけ」と決定。Phase 4 の D1〜D5 は 8 章。Phase 5 の O1〜O4 は 9 章。Phase 6 の R1〜R4 は 10 章。Phase 7 の P1〜P5 は 11 章。Phase 8 の範囲（公開前の小さな残り）は 12 章）
- 状態: Phase 0 は実施済み。Phase 0.5（未成年のための安全対策）は実施中（オーナーが「おすすめの既定で進める」と承認）。Phase 1（大人が自分の AI をつなぐ）はコードと手順書を作りました（2026-10-23。公開はオーナーの設定と確認のあと）。Phase 2（レッスンの進み具合をサーバーに保存し、AI と学ぶツールを足す）もコードを作りました（2026-10-23。使い始めるのは、オーナーが VM を更新して確かめたあと。6 章）。Phase 3（有料のサポータープラン）もコードを作りました（2026-10-23）。止めたままで、使えるのは Stripe のテストモードで、オーナーが決めたテストの方だけです。本物の請求は、法律と税の確認とオーナーの OK のあとです（7 章）。Phase 4（規約のページ、登録の同意、アカウントの削除、保存期間）もコードを作りました（2026-10-24）。規約のページと同意は `VITE_FEATURE_LEGAL_PAGES` で止めていて、一般の登録は、弁護士の確認のあとにそれを on にするまで受け付けません（8 章）。Phase 5（保存の様子の表示、1 つのレッスンのやり直し、XP とバッジをサーバーに）もコードを作りました（2026-10-25。使い始めるのは、オーナーが migration 019 を当てて VM を更新したあと。9 章）。Phase 6（レッスンの復習カードが、忘れかけたころにもう一度出る）もコードを作りました（2026-10-26。使い始めるのは、オーナーが migration 020 を当てて VM を更新したあと。10 章）。Phase 7（公開の前の、CI の 3 つのチェック）もコードを作りました（2026-10-28。必須にするのは、このプルリクエストをマージしたあとに、オーナーがブランチのルールを設定してから。11 章）。Phase 8（公開の前の小さな残り）もコードを作りました（2026-10-29。migration はありません。API とリモートの MCP で同意を確かめる切り替えは、はじめは止めています。12 章）。
- 関連: [../legal/README.md](../legal/README.md)（プライバシーポリシーと利用規約の下書き）、[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)（データの送り先の一覧）、[../guides/safety-operations.ja.md](../guides/safety-operations.ja.md)（安全の運用ガイド）、[training-plan.ja.md](training-plan.ja.md)（職業訓練の LMS の計画。案）

この文書の工数（何日かかるか）は、どれも**見積もり**です。作って測ったものではありません。費用は**試算**で、前提を変えると変わります。

## 1. 決めたこと

1. **アプリの中の AI は残します。** 安いモデル（Claude Haiku 5.5）で動かし、今ある 1 日の上限（`server/middleware/dailyCaps.js`）をそのまま使います。
2. **大人の学習者は、自分の AI をつなげるようにします**（Phase 1）。Claude Code、Codex、Claude.ai、自分で動かす Hermes などを、MCP（AI アプリが外部のツールにつながるための共通の決まりごと）でつなぎます。作ったものは 5 章です。
3. **共有のサーバー側 Hermes エージェントは、学習者に出しません。**
4. **Gemini（Google の AI）は使いません。** 未成年が Rise Path を使うためです（下の 2.2）。
5. **有料プランは 1 つだけ作り、止めたままにします。** 「サポータープラン」（月額 500 円（税込）、自動更新、AI の 1 日の上限のいくつかが上がる、18 歳以上だけ）です。法律と税の確認とオーナーの OK までは、Stripe（支払いを受け付ける会社）のテストモードだけで動かし、使えるのはオーナーが決めたテストの方だけです。お金は動きません。運営はこれまでどおり寄付と助成で行い、無料の上限は変えません（2026-10-23 のオーナーの決定。作ったものは 7 章）。

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
- 共有の端末: ログアウトのときに、AI の答えをふくむブラウザの保存を消します（`services/sharedDeviceData.ts`、`context/AuthContext.tsx:287`）。Phase 2 で、レッスンの進み具合、学習の履歴、古い形の Blender の進み具合も消すようにしました（6.1）。
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
- **`/privacy` と `/terms` の公開ページ**と、登録時の同意のチェック: Phase 4 で作り、`VITE_FEATURE_LEGAL_PAGES` で止めています（8 章、[../legal/README.md](../legal/README.md)）。
- **確認の精度を測ること**: 学習の質問を止めすぎていないか、すり抜けがないか。試験用の文章で、止めた割合と見逃した割合を測ります。Anthropic が提供すると書いている子ども向けのシステムプロンプトは、まだ手に入れていません（`MINOR_SAFETY` は自分たちで書いたものです）。
- **AI コーチ（共有 Hermes）と画像生成**: どちらも既定で止まっていて、18 歳以上だけにしてあります（18 歳未満向けの確認と子ども向けの指示がないため。Hermes は AI の窓口を通らず、設定例は OpenRouter 経由の Gemini です。`hermes/config.example.yaml:8`、`:13-16`）。18 歳未満にも使えるようにするなら、先に確認と子ども向けの指示を足します。ブリッジ（Nexloom）からの Hermes の呼び出しも同じ関門を通るので、本番で使うなら `PHASE1_USER_ID` の利用者に 18 歳以上の年月を登録します。
- **Phase 0.5 より前に保存したもの**: すでに保存されている生成コース（`curricula`）や、ブラウザに残っている AI の答えは、確認していません。
- **ほかのデータの保存期間**: AI の利用回数の記録（IP アドレスをふくむ）は 30 日で消し、アカウントの削除もできるようになりました（Phase 4、8 章）。アップロードした教材と生成コースは、ご本人が消すかアカウントを削除するまで残ります。読み上げ音声のキャッシュと生成した画像には、消す仕組みがありません。
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
- Phase 2 で、公開レッスンを AI と学ぶツールを 5 つ足しました（`course-list`、`course-lesson-get`、`course-quiz-check`、`course-progress-get`、`course-progress-update`。6.1）。Phase 2 のあとのツールは全部で 11 です（Phase 6 で 13。10.1）。
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
  - **アカウントの削除にも届きます（Phase 4）**: パスワードを設定してログインした AI アプリは、設定の「アカウントを削除する」のパスワードの確認も通るので、その方の Rise Path のデータを削除できます。なので、削除ははじめ止まっています。上の 3 つの設定を入れて確かめるまで、`ACCOUNT_DELETION_ENABLED=true` にしません（8.2 の 2）。設定のあとも、パスワードのないアカウントの 24 時間は残ります（8.3）。
  - **減らし方**: 許可の画面は「許可する」の上に、アプリが自分と同じ力を持つので信頼できるアプリだけを許可するよう出します。DCR を on にして毎週 OAuth Apps を見るか、DCR を off にして知っているクライアントだけを登録します（下の「DCR の乱用」）。どちらにするかと、このリスクを受け入れるかは、オーナーが決めます（5.4）。
  - P-School が使う Supabase の表は、RLS に `(auth.jwt() ->> 'client_id') is null` を足すまで、AI アプリのトークンでも読み書きできる可能性があります（`deploy/supabase/README.md`）。Rise Path のアプリの API と VM のデータは、AI アプリのトークンそのものなら上の守りで断ります。
- **PKCE の `plain` を Supabase が受け付けます**（止められません）。MCP の決まりごとは、クライアントに `S256` を使うよう求めています。Claude と ChatGPT は `S256` を使うと案内しています。危険は小さいと判断しました。
- **DCR の乱用**: 誰でも AI アプリを登録できます。上のとおり許可したアプリは学習者と同じ力を持つので、許可をだまし取るための登録もできます。Claude は新しく接続するたびに登録します。毎週 OAuth Apps を見て、見覚えのないものや使われていないものを消します。DCR を off にすると、Authentication → OAuth Apps で登録しておいたクライアントだけがつなげます（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。ただし、クライアント ID を手で入れられない AI アプリはつなげなくなります【要確認: どのアプリが対応しているか】。登録の制限は接続元の IP アドレスごとなので、Claude.ai や ChatGPT の利用者が増えると、事業者のアドレスで制限にかかるおそれがあります【要確認】。
- **MCP の SDK 1.32 は、ハンドシェイク（`initialize`）のある古い版（2025-11-25 まで）だけを話します。** 今の最新の版は 2026-07-28 です。新旧の両方に対応したクライアントは古い版に切り替えてつながりますが、新しい版だけのクライアントはつながりません。新しい版の SDK（`@modelcontextprotocol/server` 2.x）は新しい依存関係になるので、オーナーが別に決めます（それが要る zod 4 には上げてあります）。
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

- サーバーが、記録をまとめる役をします。届いた記録をそのまま保存せず、保存ずみの記録とまとめます。読んだブロックと解答は足し合わせます。一度正解した問題と、答えを見た問題は、そのまま確定します。正解は、サーバーとブラウザのどちらにあっても残します（届いた順番で変わりません）。チェックリスト・手順・暗記カードの印と自己評価は、項目ごとに、あとで変えたほうを残します。そのため、記録は項目ごとに変えた日時（`editedKeys`）を持ちます（`shared/lesson/progressMerge.js`）。
- 18 歳未満もふくめ、ログインした人はみな同期します。進み具合は AI の機能ではないためです。インターネット向けの MCP のツールは、5 章と同じく 18 歳以上だけです。
- 共有の端末では、別の学習者の記録を先に消してから、次の学習者を画面に出します。だれのものでもない記録は、学習者に聞いてからアカウントに入れます。学習者がログアウトしたあとに、その端末で書かれた記録も、だれのものでもない記録として扱います。
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
  - 前に別の学習者の記録があれば、先にブラウザから消します（レッスンの記録、続きの位置、学習の履歴、古い形の Blender の進み具合 `rp_learning_progress`）。Blender の進み具合を残すと、ログインのときの読み込み（`services/progressService.ts` の `hydrateFromApi`）が、次の学習者のアカウントに送ってしまうためです。
  - だれのものでもない記録（この機能より前に保存したもの、ゲストで学んだもの、学習者がログアウトしたあとに書かれたもの）があれば、「この端末に保存されている学習の記録を、あなたのアカウントに追加しますか？」と聞きます（`components/lesson/ProgressAdoptDialog.tsx`、`App.tsx`）。最初に選ばれているのは「追加しない」で、Esc キーでも「追加しない」になります。追加しないと、その記録と、学習の履歴、古い形の Blender の進み具合が端末から消えます。本人の学習の履歴は、そのあとサーバーから読み直します。ほかのタブで答えたときは、その答えに従います。
  - ログアウトのときに送れなかった記録がある学習者が、またログインしたとき: そのあとで書かれたり変えられたりした記録がなければ、そのまま読み込んで送ります。あれば、上と同じダイアログで聞きます。本人がログアウトのときに残した記録は、どちらを選んでも残して送ります。
- 読み込み: ページを開いたときに、サーバーの記録を読んで、ブラウザの記録とまとめます。サーバーにない記録はアップロードします。開いているレッスンの画面も、サーバーの記録を取り込みます。このとき「始めた」「終えた」の学習の履歴は増やしません。新しい端末では、ダッシュボードの「続きから」が、最後に学んだレッスンを指します。
- 読み直し: ほかのウィンドウやタブから戻ったとき（タブがまた見えるようになったときと、ウィンドウに戻ったとき）にも、サーバーの記録を読みます。前に読んでから 1 分たっていて、送る途中の記録がないときだけです。AI アプリで答えた問題は、これで Web の画面にも出ます。読み直しに失敗しても、同期は止めません。アプリの中でレッスンを移るだけでは、読み直しません（6.4）。
- やり直し: 読み込みに失敗したとき（何回かためしても失敗したとき）や、サーバーが 401・503 を返して送るのを止めたときは、ログインの知らせが次に届いたときに、読み込みからやり直します。この知らせは、トークンの更新のときや、タブに戻ったときに届きます（`context/AuthContext.tsx` が `signInProgressSync` を呼びます）。知らせ 1 回につき、読むのは 1 回だけです（拠点で、同じ接続元の上限を使い切らないため）。ログアウトのときにも、もう一度ためします。
- 保存: 変えてから 5 秒後（変え続けていても 60 秒以内）に送ります。1 つのタブから送るのは 20 秒に 1 回までです（拠点では、同じ接続元の上限を何人もで分け合うため）。失敗したら、最大 5 分まで間をあけてやり直します。画面を閉じるときにも送ります。このときは、最後に届いたログインの知らせのトークンを使い、待たずにすぐ送ります（ログインの情報を読むのを待つと、送る前にページが閉じてしまうため）。送れていない記録には印（`rp:progressSync:pending:<コース>:<レッスン>`）を付け、サーバーがその中身を受け取ったと確かめてから印を外します。
- ログアウト: 送れていない記録を 3 秒まで待って送ります。同期が止まっていたときは、読み込みからやり直して送ります（これも 3 秒まで）。そのあと、送れた記録、続きの位置、学習の履歴（`rp_learning_events`）、古い形の Blender の進み具合（`rp_learning_progress`）をブラウザから消します。Blender の進み具合は、送れていなくても消します。送れなかったレッスンの記録だけは残し、同じ学習者が次にログインしたときに送ります。このとき、残した記録の印に、その記録の日時を書きます。アカウントにも「ログアウトした」と書きます。そのあとで書かれたり変えられたりした記録は、その学習者のものとはしません（上のログインのとき）。ログアウトせずにログインが切れたときも、同じようにして記録を残します。ブラウザを閉じているあいだに切れたときは、次にページを開いてログインがないとわかったときに、そうします。ほかのタブがすでに「ログアウトした」と書いていたら、印は書き直しません（あとで書かれた記録を、その学習者のものにしないため）。ほかのタブのログアウトのあとに届いたアップロードの返事も使いません。
- ほかのタブで別の学習者がログインしたとき、ログアウトしたとき、記録が消されたときは、開いているレッスンの画面は書き込まずに、記録を読み直します。
- 「学習の進み具合を消す」（設定 → プライバシー `/settings/privacy`、`components/features/settings/LessonProgressDeleteSection.tsx`）: 確認のダイアログのあと、先にサーバーで消し、うまくいったときだけ、この端末からも消します。失敗したら何も変えずに、エラーを出します。消しているあいだは、「やめる」ボタンでダイアログを閉じられません（消す操作は途中で止められないため）。ほかの端末は、次に読み込んだとき（ページを開いたときか、タブに戻ったとき）に番号のちがいで気づき、自分の記録を消します。消えるのは、すべてのコースの、読んだところ、確認問題の答え、チェックリスト、自己評価、続きの位置です。学習の履歴（始めた・終えた記録）と、AI アプリが `learner-state-*` で保存した記録は消えません。連続記録は、短くなることがあります。連続記録は、学習の履歴とレッスンの記録の日時から数えるので（`components/ui/ProgressCluster.tsx`）、レッスンを読んだだけの日が数えられなくなるためです。画面にもそう書いています。（Phase 5 から、連続記録はサーバーの学んだ日から数えるので、消しても短くなりません。XP とバッジも消えません。画面の文も変えました。9 章）ゲストの場合は、この端末の記録だけが消えます。
- ダッシュボードとコースのページは、記録が変わると表示を新しくします（`components/lesson/useProgressVersion.ts`）。

**MCP のツール（自分の AI と学ぶ）**（`mcp-server/createMcpServer.js`、`mcp-server/tool-registry.json`、`tools/core/courseLessons.js`）

| ツール | すること | 書き込み |
|---|---|---|
| `course-list` | 公開コースと、そのモジュールとレッスン（問題の数、確認テストがあるか）の一覧 | なし |
| `course-lesson-get` | レッスンを読む。答え・解説・ヒントは入れない。選択肢は "1"〜"n"。`section_id` がなければ、目次と、学習者がまだ終えていない最初のセクション。いつもレッスンの版（`content_hash`）と教え方の約束を返す | なし |
| `course-quiz-check` | 学習者が選んだ答えをサーバーで採点し、学習者の解答として記録する。最初のまちがいでは、ひとこととヒントだけ。正解、2 回目のまちがい、答えを見る（`reveal`）のあとで、正解と解説。`content_hash` を渡したときは、レッスンの版が変わっていたら採点しない（`lesson_changed`。渡さないと今の版で採点する。6.3） | あり（取り消せない） |
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

- 新しいテスト: `server/tests/` の `lessonGrading`、`lessonLearnerView`、`lessonProgressMerge`、`courseCatalog`、`lessonProgressCore`、`lessonProgressRoutes`、`mcpCourseTools`、`lessonProgressSync`、`lessonProgressSyncClient`、`confirmDialogBusy`。直したテスト: `apiMounts`、`vmStackConfig`、`mcpRemote`、`mcpLessonTools`、`mcpLearnerIsolation`、`oauthConsentFront`、`domains`。
- すべての公開レッスンとすべての問題で、AI に渡す形に答えが残らないこと、採点のあとに見せるものがルールどおりであることを確かめます。
- データベースは、テスト用のメモリの上の表（`server/tests/helpers/lessonProgressPool.js`）を使います。ほかに、手元の Postgres 16 で 1 回、次のことを確かめました（テストには入っていません）。保存・削除・答え合わせを同時に何度も動かしても記録がこわれないこと。`risepath_mcp_remote` のロールで、答え合わせ、セクションの記録、進み具合の読み出しができること。このロールでは、行を消せず、`lesson_progress_resets` も読めないこと。
- ブラウザ: 偽の API を使い、追加のダイアログ、プライバシーの画面で消す操作、新しい端末での「続きから」を動かし、画面の写真を見て確かめました。
- `npm test` は 1,849 件すべて通りました（2026-10-23）。

### 6.2 オーナーの作業

1. **プルリクエストを `main` にマージしたら、すぐに VM を更新します。** Vercel は `main` へのマージで、新しい画面を自動で出します（Production Branch が `main` のため。`deploy/vercel/README.md`）。VM は、`./scripts/deploy-stack.sh` を実行するまで古いままです。このスクリプトが migration 016 を当てます（`server/migrations/README.md`）。VM が古いあいだは、ログインした学習者の進み具合をサーバーに保存できません。記録は「送れていない記録」としてその端末に残ります（6.3 の共有の端末の場合を除く）。VM を更新したあとは、タブに戻ったときやログアウトのときに読み込みからやり直し、残っていた記録を送ります。【要確認: VM を先に更新するため、マージのあいだだけ Vercel の自動デプロイを止めるか】
2. **自分の AI をつなぐ機能（5 章、プロファイル `byoa`）をもう動かしているなら、更新のあとに DB ロールの SQL を流し直します。** 手順は [../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md) の 7 です。今のパスワード（`mcp-public.env` の値）をそのまま渡します。流し直すまで、リモートの AI アプリでは `course-quiz-check`、`course-progress-get`、`course-progress-update` が `permission_denied`（`server setup incomplete`）になります。`course-list` と `course-lesson-get` は動きます。
3. **確かめます。**
   - 同じ学習者で 2 つの端末（または 2 つのブラウザ）にログインします。片方で読んだレッスンが、もう片方の「続きから」に出ること。
   - 共有の端末で、学習者 A でログインしてレッスンを少し読み、ログアウトします。学習者 B でログインしたとき、A の記録が出ないこと。
   - 前から記録がある端末でログインすると、追加するかのダイアログが出ること。
   - 設定 → プライバシーで「学習の進み具合を消す」を使うと、もう 1 つの端末でも、次に開いたときに消えていること。
   - （`byoa` を動かしているとき）MCP Inspector でツールが 11（Phase 6 の版では 13）あること。`course-lesson-get`（`course_slug` に `vibe-coding`、`lesson_id` に `vibe-ch1`）の結果で、クイズの問題（`questions`）に、正解（`answer`）、解説（`explanation`）、ヒント（`hint`）、選択肢へのひとこと（`feedback`）がないこと（手順やプロンプトの `hint` は出てかまいません）。`course-quiz-check` でまちがえると、ひとこととヒントだけが返ること。その答えが、Web のレッスン画面にも出ること（新しいタブで開いたとき。前から開いていたタブでは、そのタブが前に読んでから 1 分たってからブラウザに戻ったとき）。
4. **拠点のスタッフに伝えます。** 共有の端末では、ログアウトの前にインターネットにつながっているかを確かめます（6.3）。ログアウトのときに「まだ保存できていない学習」の確認が出たら、端末を離れる前に答えます（答えるまでは、まだログアウトしていません。Phase 5。9.3）。確認テストの結果や「マスター」は、資格や成績の証明ではありません（6.3）。【要確認: 拠点での伝え方】
5. **プライバシーポリシーの下書きを確かめます。** レッスンの進み具合の項目を足しました（[../legal/privacy-policy.draft.ja.md](../legal/privacy-policy.draft.ja.md) の 2、3、4.4、8、9、10）。18 歳未満の進み具合をサーバーに保存することに、保護者の同意が要るかは【要確認】です（[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md) の「気をつける点」）。

### 6.3 受け入れているリスク

- **Web のレッスン画面の答えは、自己申告です。** Web の画面は、ブラウザの中で採点します。そのため、正解は画面のプログラムに入っています（`content/index.ts` がレッスンの JSON を読み込みます）。学習者は、ブラウザの開発ツールで正解を見たり、API に「正解した」という記録を直接送ったりできます。サーバーは、届いた解答の形だけを確かめて保存し、正しいかどうかは採点し直しません。サーバーで採点するのは、MCP の `course-quiz-check` だけです。
- **正解は、Web の画面の配信物に入っています。** `course-lesson-get` は AI アプリに答えを渡しませんが、正解は秘密ではありません。AI アプリに答えを渡さないのは、学習者が自分で考えるのを助けるためで、不正を防ぐためではありません。
- **「マスター」は、資格の証明ではありません。** 状態 `mastered` は、確認テストの問題の 8 割以上に初回で正解した、という意味だけです（`shared/lesson/progress.js` の `lessonState`）。上のとおり自己申告で、本人であることも確かめていません。修了証や成績として、外に出しません。もし修了証を出すなら、サーバーで採点し、本人を確かめる別の仕組みが要ります。
- **共有の端末で、送れていない記録が消えることがあります。** ログアウトのときにサーバーに届かないと（インターネットにつながっていない、サーバーが止まっている、3 秒で終わらない、読み込みの途中だった）、送れなかった記録はその端末に残ります。同じ学習者が次にログインすれば送られます。でも、その前に別の学習者がログインすると消えます（ほかの子の記録を自分のアカウントに入れないためです）。学習者には知らせません（6.4）。ログアウトせずにログインが切れて、別の学習者がログインした場合も同じです。Phase 5 からは、学習者が自分でログアウトするときは、その前に画面で知らせ、ログアウトするかを聞きます（「ログインし直す」のボタンと、ログインが切れたときは聞きません。9 章の R11）。古い形の Blender の進み具合は、送れていなくてもログアウトで消えます（送るのは、記録したときだけです）。Blender の進み具合は、記録した学習者のアカウントにだけ送ります（Phase 5）。
- **Vercel と VM の版がずれることがあります。** 画面（Vercel）は、レッスンを画面のプログラムに入れて配ります。サーバー（VM）は、自分のコンテナの中の `content/` を読みます（`deploy/risepath-vm/Dockerfile:17`、`:39`）。この 2 つは、別々に更新されます。
  - 新しいレッスンが画面にだけあると、サーバーはその記録を `unknown_lesson` で断ります。記録は端末に残りますが、送れていない印が外れるので、ログアウトで消えます。
  - サーバーにだけあるレッスンの記録は、画面が読み込みのときに飛ばします（サーバーには残ります）。
  - レッスンの中身が変わったときは、画面とサーバーがそれぞれ自分の版で % と状態を計算します。サーバーは、保存した版（ハッシュ）とちがえば計算し直します。知らない ID の記録も、形が正しければ消さずに残します。
  - 減らし方: レッスンを足したり変えたりしたら、すぐに VM を更新します（6.2 の 1）。
- **消したあとに戻ってくる記録が、少しだけあります。** 「学習の進み具合を消す」のあと、ほかの端末は番号のちがいで気づいて、自分の記録を消します。ただし、その学習者がログインしてから一度もサーバーとつながっていない端末（ずっとオフラインだった端末）は、比べる番号をまだ持っていません。その端末で付けた記録は、つながったときにアップロードされます（`components/lesson/progressSync.ts` の hydrate）。
- **だれのものでもない記録を「追加する」と、ほかの子の記録も入ることがあります。** 追加するかは、ログインした学習者が決めます。共有の端末で前にゲストで学んだ子がいたり、学習者がログアウトしたあとに Nexloom だけでログインした人が学んだりすると、その記録も入ります。ダイアログは「ほかの人がこの端末で学習していた場合は『追加しない』を選んでください」と書き、最初から「追加しない」を選んでいます。「追加しない」を選ぶと、本人がログアウトのときに残した記録でも、そのあとでほかの人が変えたものは消えます。
- **古い形の Blender の進み具合は、「追加する」を選ぶとアカウントに送られます。** ログインのときの読み込み（`services/progressService.ts` の `hydrateFromApi`）は、端末にある Blender の進み具合を、サーバーより進んでいればアカウントに送ります（Phase 2 より前からの動き）。追加のダイアログが出ているあいだは、この読み込みを待たせ、答えたあとに動かします（`context/AuthContext.tsx` の `hydrateUserData`、`components/lesson/progressSyncClient.ts` の `chooseProgressAdoption`）。「追加しない」では、先に端末から消すので送りません。別の学習者の記録があったときも、先に消すので送りません。
- **AI アプリは、学習者の代わりに答えを送れてしまいます。** ツールの説明で「学習者の選んだ答えだけを送る」「選択肢を試さない」と求めていますが、守るかは AI アプリしだいです。送った答えは学習者の解答として残り、取り消せません。
- **レッスンの版の確かめも、AI アプリしだいです。** `course-quiz-check` は、AI アプリが `content_hash` を渡したときだけ、レッスンの版が変わっていないかを確かめます。渡さないと、今の版の選択肢で採点します。AI アプリがレッスンを読んだあとで選択肢の順番が変わっていると、学習者が選んだのとちがう選択肢で記録されることがあります。ツールの説明では、`content_hash` を渡すよう求めています（`tools/core/courseLessons.js`）。
- **AI アプリが読んだ進み具合は、学習者が選んだ AI の会社に送られます**（5.3 と同じ）。「学習の進み具合を消す」を使っても、AI の会社に送られたものは消せません。

### 6.4 残っていること

- オーナーの更新と確認（6.2）。実際の AI アプリ（Claude Code、Claude.ai など）で course-* のツールを試すこと。AI が教え方の約束（`TUTOR_PROTOCOL`）をどれくらい守るかも、まだ見ていません。
- **ログアウトのときの表示**: 「保存しています」の表示も、送れていない記録があるときの確認（「まだ保存できていない学習があります」など）もありません。サーバーに届かず同期が止まっていることも、画面には出ません。（Phase 5 で対応。9 章）
- 追加のダイアログに答えるまで、後ろのダッシュボードには、だれのものでもない記録が出たままです。
- Nexloom だけでログインした人は、同期しません。メインのログインの学習者がオフラインでログアウトしたあとに、Nexloom だけの人がその端末でログインすると、残った記録が見えます（その人のアカウントには入りません）。その人が書いた記録は、元の学習者が次にログインしたときに、追加するかを聞きます。
- Web の画面がサーバーの記録を読むのは、ページを開いたときと、ほかのウィンドウやタブから戻ったとき（1 分に 1 回まで）だけです。アプリの中でレッスンを開いたときには読みません。そのため、AI アプリで答えてすぐに Web の画面に戻ると、まだ出ないことがあります。そのときは、ページを読み込み直します。
- 1 つのレッスンだけを最初からやり直す機能はありません（消すときは、すべてのコースが対象です）。（Phase 5 で対応。9 章）
- 古い進み具合（表 `user_progress`、`/api/v2/user/progress`、`learner-state-*` のツール）は、そのまま残しています。vibe-coding と claude-code 以外の科目は、まだ古い形です。
- XP やバッジをサーバーに保存すること、先生が学習者の進み具合を見る画面は、Phase 2 には入れていません。（XP とバッジは Phase 5 で対応。9 章。先生の画面はまだです）
- 保存期間: 学習者が消すか、アカウントを削除するまで残ります（アカウントの削除は Phase 4。8 章）。削除のあとにまたログインすると、新しい空のアカウントになり、ほかの端末の古い進み具合は、前のアカウントのものと分かる端末では消えます。
- 工数（見積もり・未検証）: 当初の見積もりは開発 6〜8 日でした。実際にかかった日数は測っていません【要確認】。オーナーの更新と確認は、半日ほどの見込みです。

## 7. Phase 3: 有料のサポータープラン（作ったが止めている。テストモードだけ）

前は「寄付・助成・無料の枠で費用がまかなえなくなったときだけ検討する」計画でした。2026-10-23 に、オーナーが次のように決めました。そのとおりに、同じ日の作業ツリーでコードを作りました。最終的な差分はプルリクエストを見てください。

- 作りますが、止めたままにします。
- 法律と税の確認と、オーナーの OK までは、Stripe の**テストモード**だけで動かします。お金は動きません。
- プランは 1 つです。月額で、税込で、自動で更新します。AI の機能の 1 日の上限のいくつかを上げます。無料の上限は変えません。金額と上限は、設定で変えられます。
- 18 歳以上の方だけが申し込めます。
- 新しい npm のパッケージ（依存関係）は足しません。Stripe とは、Node.js の `fetch` で直接やりとりします。
- 売るのは、AI の機能を 1 日に使える回数です。AI のモデルそのものを使い放題で売ることはしません（Anthropic 商用規約 D.4。8 章）。

この章では、次の言葉を使います。

- **Stripe**（ストライプ）: カードなどの支払いを受け付ける会社のサービスです。カードの番号は Stripe の画面で入力するので、Rise Path には届きません。
- **Checkout**（チェックアウト）: Stripe が用意する、支払いの画面です。Rise Path の「申し込む」ボタンから移ります。
- **カスタマーポータル**: Stripe が用意する、契約を管理する画面です。カードの変更、請求の履歴、解約ができます。Rise Path の「お支払いと解約」ボタンから開きます。
- **Webhook**（ウェブフック）: 支払いや解約が起きたときに、Stripe が Rise Path のサーバーに送ってくる知らせです。
- **テストモードと本番モード**: Stripe には、練習用のテストモードと、本物のお金が動く本番モードがあります。テストモードでは、テスト用のカード番号を使います。鍵（キー）もモードごとに別です。テストの鍵は `sk_test_` か `rk_test_`、本番の鍵は `sk_live_` か `rk_live_` で始まります。
- **プライス**（Price）: Stripe に登録する価格の設定です。金額、通貨、税込かどうか、何か月ごとか、を持ちます。
- **制限付きキー**（restricted key、`rk_` で始まる）: できる操作を選んで絞った、Stripe の鍵です。

法律の決まり: 特定商取引法は、広告に価格、支払いの時期と方法、提供の時期、申し込みの期間、解約の条件などを示すこと（第 11 条）と、申し込みの最終確認の画面に分量や価格などを示すこと（第 12 条の 6）を求めています（<https://laws.e-gov.go.jp/law/351AC0000000057>）。最終確認の画面の書き方は、消費者庁のガイドライン（<https://www.no-trouble.caa.go.jp/pdf/20241119la02_09.pdf>、2024-11-19 の版）に沿いました。価格は税込で示します（<https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6902.htm>）。

### 7.1 作ったもの

**決めたこと**（価格、上限、18 歳以上は、オーナーの決定です。ほかは作るときに決めたもので、オーナーの確認はまだです【要確認】）

| 決めたこと | 中身 | 変え方 |
|---|---|---|
| プラン | 「サポータープラン（月額・自動更新）」。月額 500 円（税込）。1 か月ごとに自動で更新し、期間の定めはありません | `server/services/billingPlan.js` の `SUPPORTER_PLAN` と、Stripe のプライス。2 つを同じにします（7.5） |
| 上がる上限（1 人 1 日。日本時間 0 時に戻る） | AI チューター・作文フィードバック・診断の解説（「llm」の枠）が、合わせて 100 回（無料は 50 回）。コース作成の AI 処理（「course_generation」の枠）が 30 回（無料は 20 回）。ほかの枠（画像、AI コーチ、教材の取り込み、MCP）は無料と同じです | `SUPPORTER_PLAN.caps`。運用者が無料の上限を `AI_CAP_USER_<枠>` で上げたときは、大きいほうになります（払っている人が、無料の人より少なくならないため） |
| サポーター全体の上限（1 日） | llm 1,000 回、course_generation 200 回。無料の人の全体の上限（`'*'`）とは別に数えます（`'*supporter'`）。無料の人がたくさん使っても、サポーターの枠は減りません | `billing.env` の `AI_CAP_SUPPORTER_GLOBAL_LLM` と `AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION`。0 にすると、サポーターはその枠を使えません |
| 同じ接続元（IP アドレス）の上限 | サポーターには数えません。家族や教室で、同じアドレスを使うためです | コード（`server/middleware/dailyCaps.js`） |
| 申し込める人 | 18 歳以上で、生まれた年と月を登録した方だけです。本番と同じ決まりで確かめます（開発用の `AI_ACCESS_DEV_AUDIENCE` は見ません）。ゲスト、開発用の仮のユーザー、ブリッジの利用者（`PHASE1_USER_ID`）、匿名の Supabase ユーザー、Nexloom だけのログインは申し込めません | コード（`server/services/billingEntitlement.js`、`server/routes/billing.js`） |
| 支払いが遅れたとき（`past_due`） | 更新の支払いに失敗してから 2 日だけ、サポーターの上限を使えます。そのあとは無料の上限です | `BILLING_GRACE_MS`（`server/services/billingPlan.js`） |
| 解約 | 次の更新日より前に「お支払いと解約」から手続きすると、次回から請求されません。支払いずみの期間の終わりまで使えます | Stripe のカスタマーポータルの設定（7.2 の 1） |
| 返金 | 日割りの返金はしません【要確認: 弁護士】 | `server/services/billingDisclosure.js` の `TERMS` |
| 支払いを確認できないとき | 再請求のあと、契約を終了します | Stripe の設定（7.2 の 1）と `TERMS` |
| MCP（自分の AI をつなぐ機能） | サポーターでも上限は変えません。学習者の AI の契約で動くので、Rise Path の費用がかからないためです | コード |

**設定は、サーバーの 1 か所だけ**

- 価格、上限、上限の説明、「特定商取引法に基づく表記」の行は、`server/services/billingPlan.js` と `server/services/billingDisclosure.js` にだけあります。
- 画面（プランの画面、最終確認の画面、表記のページ）は、動いているサーバーの `GET /api/v2/billing/plan` から、数字と文をもらって出します。画面のプログラムには、価格も上限も入っていません。サーバーが守る上限と、画面に出す上限を、いつも同じにするためです。ちがうと「不実の表示」になるおそれがあります。
- 表記のうち、販売事業者の名前、代表者、所在地、電話番号、メールアドレスは、まだ【要記入】です（`OWNER_FACTS`）。【要記入】が残っているあいだは、本番モードでは売れません。

**2 つの状態**（`server/services/billingConfig.js`）

| 状態 | なるとき | 動くもの |
|---|---|---|
| 使える（serviceable） | 正しい形の Stripe の鍵、Webhook の署名の鍵（`whsec_`）、`STRIPE_PRICE_ID`、戻り先の `BILLING_RETURN_ORIGIN`（https）がそろっているとき。本番の鍵なら、`BILLING_LIVE=true` も要ります。`BILLING_ENABLED` とは関係ありません | Webhook、プランの画面の情報（`GET /me`）、「お支払いと解約」（`POST /portal`）、Stripe からの読み直し（`POST /sync`）、サポーターの上限 |
| 売れる（salesOpen） | 「使える」で、`BILLING_ENABLED` がちょうど `true` で、売るための問題がないとき。問題とは、テストモードでテストの方の一覧がない（または ID の形でないものがある）、本番モードで表記に【要記入】がある、本番モードで `BILLING_TOS_URL` がない、`BILLING_TOS_URL` が https の URL でない、サポーターの上限が無料より大きくないか、その枠が止まっている（上限が 0）、のどれかです | 申し込み（`POST /checkout`）と「申し込む」ボタンだけ |

- 2 つに分けたのは、売るのをやめても、すでに払っている方を困らせないためです。`BILLING_ENABLED` を `true` 以外にしても、契約中の方の上限、「お支払いと解約」、Webhook はそのまま動きます。
- 起動のとき、ログに 1 行だけ出します。例: `[Billing] billing: off`、`[Billing] billing: test (serviceable, sales open, 2 test users)`。問題があれば、設定の名前だけを出します。値は出しません。
- 「使える」でないのに、終わっていない契約がデータベースにあるときは、起動のときにオーナーに知らせます（`billing_unserviceable`）。

**テストモードは、テストの方だけ**

- テストモードは、本番の API で動きます。Webhook が本番の経路を通るためです。そのため、テストモードのあいだは、申し込み、「お支払いと解約」、読み直し、サポーターの上限を、`BILLING_TEST_USER_IDS` に書いたアカウントだけに限ります。ほかの方は、テスト用のカードでは申し込めず、サポーターの上限ももらえません。
- だれでも見られる `GET /api/v2/billing/plan` は、本番モードでないかぎり「売っていない」（`salesOpen: false`）と答えます。表記のページは「現在、有料のサービスは提供していません」と出し、【要記入】の値は出しません。

**サーバー**

- 新しい表を 3 つ作りました（`server/migrations/017_billing.sql`）。課金を使わないあいだも、適用が要ります（適用していないと `/api/v2/health` が 503 です）。
  - `billing_customers`: 学習者とモード（テスト・本番）ごとに、Stripe の顧客（Customer）1 件です。顧客は Rise Path のサーバーが作ります。送るのはアカウント ID（`metadata[user_id]`）だけで、名前やメールアドレスは送りません。
  - `billing_subscriptions`: 契約の最新の状態です。Stripe から読み直した値だけを書きます。Webhook の知らせの中身は、そのまま使いません。`synced_at` は読み始めた時刻で、それより新しい記録は上書きしません。知らせの届く順番が前後しても、最後に読み始めたものが残ります。
  - `billing_events`: Webhook の知らせの ID ごとに 1 行です。同じ知らせが何度届いても、1 回だけ処理します。知らせの中身は保存しません。
  - アカウントを消しても、記録は残します（税や会計のため）。学習者とのつながり（`user_id`）だけが空になります（`ON DELETE SET NULL`）。リモート MCP の DB ロールには、この 3 つの表の権限を渡していません。
- Stripe とのやりとり（`server/services/stripeClient.js`）: SDK（Stripe が配っているプログラムの部品）を使わず、`fetch` で呼びます。API の版は `2026-09-30.endive` に固定しています（`STRIPE_API_VERSION`。環境変数では変えられません）。8 秒で打ち切ります。Stripe のエラーの文は、サーバーのログにだけ出します。
- API `/api/v2/billing`（`server/routes/billing.js`。`server.js` で、全体の回数の上限のあと、ログインの関門の前に置きました）:
  - `GET /plan`: だれでも見られます。プラン、価格、上限、表記の行、解約・返金・支払いの失敗の条件を返します。
  - `GET /me`: プラン（`supporter` か `free`）、申し込めるか（`ok`、`age_required`、`adults_only`、`guardian_consent`、`paused`、`unavailable`）、契約の状態と日付、今日の利用の回数を返します。
  - `POST /checkout`: Stripe の支払いの画面の URL を作ります。その前に、プライスが画面の説明と同じか（500 円、円だけ、1 か月ごと、税込）を確かめます。ちがえば 503 で断ります。すでに契約があれば、409 `already_subscribed` で断ります。同じ人の申し込みは 1 つずつ順に処理し、同じ 1 分の中の二度押しには、同じ支払いの画面を返します（言語を切り替えて押し直しても同じ画面です）。前の分に作った支払いの画面は、新しい画面を作る前に閉じるので、払える画面はいつも 1 つです。Stripe の画面にも、分量、価格と更新、支払いの時期、提供の時期、解約、返金、18 歳以上だけ、表記のページへのリンクを書き添えます（1,200 字まで）。外国の通貨で価格を出す Stripe の機能（Adaptive Pricing）は、申し込みごとに止めます。
  - `POST /portal`: 「お支払いと解約」の画面の URL を作ります。年齢は確かめません。年齢を未成年に直された方や、その日の AI のお休みの方も、いつでも解約できるようにするためです。
  - `POST /sync`: その方の契約を、Stripe から読み直します（支払いの画面から戻ったときなど）。
  - `/me`・`/checkout`・`/portal`・`/sync` は、Rise Path のアカウントでログインした方だけが使えます。1 人 1 分 10 回までです（`/me` は 20 回）。請求の処理が断るときは、決まった種類（`error_type`）を返します。ログインの確認（401）、全体の回数制限（429）、送られた内容が読めないとき（400）は、決まった文だけを返します。どの場合も、Stripe やデータベースの文は返しません。支払いの画面の URL は、ログに出しません。
- Webhook `POST /api/v2/billing/webhook`（`server/services/billingWebhook.js`）: 署名（`Stripe-Signature`）を確かめます。時刻のずれは 5 分まで、鍵を替えるあいだは 2 つの鍵のどちらでも通します。届いたバイトをそのまま確かめるため、このパスだけは JSON に直さずに受け取ります（512 KB まで）。ログと全体の回数の上限は、ほかの API と同じようにかかります。「使える」でないときは 503 を返し、Stripe にあとで送り直してもらいます。
- 契約の読み直し（`server/services/billingSync.js`）: Webhook、`/sync`、`/checkout` が同じ処理を使います。データベースの接続を持ったまま Stripe を待つことはしません。だれの契約かは、`billing_customers` だけで決めます。
- サポーターかどうか（`server/services/billingEntitlement.js`）: 次のすべてにあてはまる方です。モードが今の設定と同じ。受け付けるプライス（`STRIPE_PRICE_ID` と `STRIPE_PRICE_IDS_ACCEPTED`）の契約。`active`（利用中）か `trialing` なら期間の終わりの 2 日後まで、`past_due` なら期間の始まりの 2 日後まで。18 歳以上と記録されている。結果は 60 秒覚え、契約が変わるとすぐに忘れます。データベースが答えないときは無料の扱いにし、その結果は覚えません。
- 1 日の上限（`server/middleware/dailyCaps.js`）: `server.js` が、サポーターの判定を 1 回だけ渡します。リモート MCP（`mcp-public`）は渡さないので、課金のコードを読み込みません。上限をこえたときの 429 に、`plan`（`free` か `supporter`）が付きます。
- オーナーへの知らせ（`server/services/billingAlerts.js`）: ログにエラーとして書き、`AI_CAP_ALERT_WEBHOOK_URL` があれば、そこにも送ります。同じ種類と同じ相手については、1 日 1 回までです。中身は Stripe の ID と、アカウント ID の先頭 8 文字だけです。名前、メール、カードの情報、URL は入れません。種類ごとにすることは、7.5 にあります。

**画面**

- 画面のスイッチ `VITE_FEATURE_BILLING` がちょうど `"true"` のときだけ、プランの画面を出します（`config/features.ts`）。既定は off です。
- 入口は、設定 → アカウントの「プラン」（説明は「お支払いと解約」）と、プロフィールの「プラン」です。スイッチが on で、`GET /me` が「申し込める」か「契約がある」と答えた方にだけ出します（`hooks/usePlanEntry.ts`）。
- `/settings/plan`（`components/features/settings/PlanView.tsx`）は、次の順に見て、最初にあてはまるものを出します。
  1. 読み込めなかった（もう一度試すボタンと、連絡先）。
  2. 終わっていない契約がある: 契約の状態、次の更新日か終了日、「お支払いと解約」。年齢などの知らせは、その下に出します。
  3. サインインが要る。
  4. 売っていない、または準備中。
  5. 申し込めない理由（年月の登録、18 歳以上だけ、その日のお休み）。
  6. 無料プランの説明、今日の利用、「申し込み内容の確認へ」。
- 支払いの画面から戻ったときは、「手続きを確認しています…」と出し、Stripe から読み直します。30 秒まで確かめ、確かめられなければ「もう一度確かめる」と連絡先を出します。
- `/settings/plan/confirm`（`components/features/settings/PlanConfirmView.tsx`）は、申し込みの最終確認の画面（第 12 条の 6）です。題は「お申し込み内容の最終確認」です。
  - 出すもの: プラン、分量（1 日に使える回数、無料との比べ、上限の前に止まることがあること）、契約期間、価格（1 年続けた場合の目安も）、支払いの時期と方法、提供の時期、申込期間、解約、支払いを確認できないとき、申し込みの条件（18 歳以上）、Stripe の画面に移ること、くわしい内容（表記のページ）。
  - これらを、すべて「申し込む（有料・月額 500 円）」ボタンより上に出します。ボタンを画面に固定したり、項目をたたんだりはしません。
  - ボタンは、申し込めて、売っているときだけ出します。テストモードでは「テストモード: 実際の請求はありません」と出します。
- `/legal/commerce`（`components/features/legal/CommerceDisclosureView.tsx`）は、「特定商取引法に基づく表記」の公開ページです。ログインしていなくても開けます。表を出すのは、本番モードで、【要記入】がないときだけです。
- 見本だった `/subscription` の画面（価格が書き込まれていて、ない機能も書いていた）を消しました。`/subscription` は、スイッチが on なら `/settings/plan` へ、off なら `/settings` へ移ります。

**デプロイと CI**

- Stripe の鍵と課金の設定は、`deploy/risepath-vm/billing.env`（見本は `billing.env.example`）にだけ書きます。読むのは `api` のコンテナだけで、`mcp` と `mcp-public` は読みません。Git の管理の外です（`deploy/risepath-vm/.gitignore`）。
- `deploy-stack.sh` は、次のときに止まります。`stack.env` か `mcp-public.env` に `STRIPE_` か `BILLING_` で始まる名前がある。本番の鍵（`sk_live_`・`rk_live_`）があるのに `BILLING_LIVE=true` がない。`BILLING_ENABLED=true` なのに要る値がない。表示するのは名前だけで、値は出しません。
- `scripts/ci/scan-secrets.mjs` は、Stripe の鍵（`sk_test_`、`sk_live_`、`rk_test_`、`rk_live_`）と Webhook の鍵（`whsec_`）を見つけます。CI は、Stripe の鍵がブラウザのプログラムに入らないことを確かめます。`VITE_STRIPE_*` は、ビルドのときに空にします（`vite.config.ts`）。ブラウザは、Stripe の値を何も持ちません。

**テスト**

- 新しいテスト: `server/tests/` の `billingPlan`、`stripeClient`、`billingConfig`、`billingEntitlement`、`billingSync`、`billingWebhook`、`billingRoutes`、`billingLeakGuards`、`billingFront`。直したテスト: `dailyCaps`、`scanSecrets`、`vmStackConfig`、`aiAccessFront`。本物の Stripe の代わりに、偽の Stripe（`server/tests/helpers/fakeStripe.js`）と、メモリの上の表（`server/tests/helpers/billingPool.js`）を使います。
- ほかに、手元の Postgres 16 で 1 回、次のことを確かめました（テストには入っていません）。migration 000〜017 が当たること。同じ人の申し込みが同時に 2 つ来ても、顧客が 1 つになること。テストモードの顧客が、本番モードの顧客のじゃまをしないこと。古い読み直しが、新しい記録を上書きしないこと。
- ブラウザ: 偽の API を使い、プランの画面のそれぞれの状態、最終確認の画面、表記のページを、日本語と英語、幅 1366 と 390 で写真にとって確かめました。最終確認の画面では、ボタンがすべての項目より下にあることを測りました（スクリプトはリポジトリに入れていません）。
- `npm test` は 2,017 件すべて通りました（2026-10-23）。

### 7.2 オーナーの作業

上から順に行います。本番モード（5）は、法律と税の確認と、オーナーの OK のあとです。

1. **Stripe のテストモードを設定します。** Stripe のダッシュボードを、テストモード（サンドボックス）に切り替えてから行います。設定はモードごとに別なので、本番モードでも、あとで同じことをします。画面の項目の名前は、2026-10-23 の Stripe の文書によるもので、変わることがあります【要確認】。
   - **商品とプライス**: 商品の名前は「サポータープラン（月額・自動更新）」。価格は 500、通貨は JPY、継続（1 か月ごと）、税の扱いは「税込」（inclusive）にします。税の扱いはあとから変えられないので、まちがえたら新しいプライスを作ります。ほかの通貨の価格は足しません（足すと、10 分以内に申し込みを断ります）。プライスの ID（`price_…`）を、あとで `STRIPE_PRICE_ID` に入れます。
   - **カスタマーポータル**（Settings → Billing → Customer portal）: 解約を on にし、「期間の終わりに解約」だけにします。プランの変更と数量の変更は off にします。カードの変更と請求の履歴は on にします。ビジネスの名前と見出しを入れます（必須）。解約の理由を聞く手順を、とばせるかを確かめます【要確認】。画面の言語は、アプリが日本語か英語を渡します。
   - **1 人 1 つの契約に限る**（Limit customers to one subscription）: on にします。すでに契約がある方の戻り先は「your website」にして、`https://app.<domain>/settings/plan` を入れます。
   - **支払いに失敗したとき**（再請求の設定）: 再請求のあと、最後は「サブスクリプションをキャンセルする」にします。「past_due のまま」にはしません（ずっと払わずに使えてしまうため）。
   - **お客様へのメール**: 支払いの失敗のメールと、支払いの領収書のメールを on にします。
   - **Adaptive Pricing**（外国の通貨で価格を出す機能。dashboard.stripe.com/settings/adaptive-pricing）: off にします。アプリも申し込みごとに止めていますが、念のためです。
   - **特定商取引法に基づく表記のリンク**（Settings → Business → Business details → Commerce disclosures）: `https://app.<domain>/legal/commerce` を入れます。
   - **利用規約の URL**（Settings → Public details）: `/terms` のページができたら入れます。`BILLING_TOS_URL` と同じ URL にします。テストモードでは、どちらも空でかまいません。空のあいだ、Stripe の画面は規約への同意を求めません。
   - **制限付きキー**（Developers → API keys → Create restricted key）: Customers は Write、Prices は Read、Checkout Sessions は Write、Customer portal は Write、Subscriptions は Read にします。ほかは None です（`server/services/stripeClient.js` の最初の説明と同じ）【要確認: ダッシュボードの項目の名前。足りない権限があると、Stripe が名前を答えるので、その権限だけを足します】。`rk_test_…` を、あとで `STRIPE_SECRET_KEY` に入れます。
   - **Webhook のエンドポイント**は、3 で作ります。先に作ると、2 で試した知らせが本番にも届いてしまうためです。
2. **手元のパソコンで、先に試します**（`stripe listen`）。
   - 手元の `.env.local` に、テストモードの値を入れます。`BILLING_ENABLED=true`、`BILLING_TEST_USER_IDS=<自分のアカウント ID>`、`STRIPE_SECRET_KEY=<rk_test_…>`、`STRIPE_PRICE_ID=<price_…>`、`BILLING_RETURN_ORIGIN=http://localhost:3007`、`VITE_FEATURE_BILLING=true` です。アカウント ID は、Supabase のダッシュボードの Authentication → Users の UID です。つなぐデータベース（`DATABASE_URL_PHASE1`）には、migration 017 まで当てておきます。
   - Stripe CLI（Stripe のコマンド。<https://docs.stripe.com/events/set-up-events>）で `stripe login` のあと、`stripe listen --forward-to localhost:3006/api/v2/billing/webhook` を実行します。手元の API（3006）は、自分のパソコンからの知らせをそのまま受け付けます。表示された `whsec_…` を `.env.local` の `STRIPE_WEBHOOK_SECRET` に入れて、`npm run dev` を起動し直します。この鍵は、ダッシュボードのエンドポイントの鍵とはちがいます。
   - 自分のアカウントでサインインし、設定 → AI の利用設定で、18 歳以上の生まれた年と月を登録します。設定 → プラン → 「申し込み内容の確認へ」→「申し込む」と進みます。Stripe の画面で、テスト用のカード `4242 4242 4242 4242` で払います。有効期限は未来の日付、セキュリティコードは何でもかまいません（<https://docs.stripe.com/testing>）。
   - 確かめること:
     - プランの画面に戻って、「お申し込みを確認しました」と出る。
     - 「ご契約中のプラン」が「利用中」で、次の更新日が出る。今日の利用の上限が 100 回と 30 回になっている。
     - `stripe listen` の画面で、どの知らせも `200` になっている。
     - 「お支払いと解約」から解約すると、プランの画面に終了日が出る。
   - 終わったら、ダッシュボードで、その契約をすぐにキャンセルしておきます。
3. **本番の経路で、テストの知らせを 1 回だけ確かめます**（テストの方だけ）。
   - VM で `billing.env` を作ります。手順は [`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「有料プラン（Phase 3、`billing.env`）」にあります。テストモードの値を入れます。`BILLING_ENABLED=true`、`BILLING_TEST_USER_IDS`（オーナーとテストの方のアカウント ID。カンマで区切る）、`STRIPE_SECRET_KEY`（`rk_test_…`）、`STRIPE_PRICE_ID`、`BILLING_RETURN_ORIGIN=https://app.<domain>` です。`BILLING_LIVE` は空のままです。
   - Stripe のテストモードで、Webhook のエンドポイント（Developers → Webhooks）を作ります。
     - URL は `https://app.<domain>/api/v2/billing/webhook` です。`api.<domain>` ではありません（そちらは Vercel の合言葉が付かないので、403 になります）。
     - API の版は `2026-09-30.endive` を選びます（`server/services/stripeClient.js` の `STRIPE_API_VERSION` と同じ）。
     - 送る知らせ: `checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`customer.subscription.paused`、`customer.subscription.resumed`、`invoice.paid`、`invoice.payment_failed`、`charge.refunded`、`charge.dispute.created`。
     - 署名の鍵（`whsec_…`）を、`billing.env` の `STRIPE_WEBHOOK_SECRET` に入れます。
   - `./scripts/deploy-stack.sh` を実行します。`==> Billing sales: test` と出ること、`api` のログに `[Billing] billing: test (serviceable, sales open, … test users)` と出ることを確かめます。
   - Vercel の Production に `VITE_FEATURE_BILLING=true` を入れて、デプロイし直します（`VITE_` の値は、ビルドのときに入るため）。入口は、テストの方にだけ出ます。ほかの方が `/settings/plan` を開いても、「準備中」と出ます。
   - テストの方が 1 回、テスト用のカードで申し込みます。次のことを確かめます。
     - Stripe のダッシュボードの Webhook の画面で、届いた知らせがすべて `200` になっている。
     - VM の `api` のログに `POST /api/v2/billing/webhook 200` があり、`webhook signature refused` がない。
     - テストの方のプランの画面に、「ご契約中のプラン」が出る。
   - **署名が通らない（Stripe の画面で `400`、ログに `webhook signature refused (mismatch)`）ときは、そこで止めます。** 鍵が正しいのに通らないなら、Vercel か Cloudflare の途中で、中身が変わっています。Webhook のエンドポイントを止め、`billing.env` の `BILLING_ENABLED` を空にして、`deploy-stack.sh` を実行し直します。代わりの方法（このパスだけ、合言葉の関門 origin gate を通さない）は作っていません。作るかどうかを、別に決めます。
   - 終わったら、テストの契約をダッシュボードでキャンセルします。`VITE_FEATURE_BILLING` は外してもかまいません（外すと、テストの方も画面を開けません）。
4. **法律と税の確認を頼みます。** [../legal/README.md](../legal/README.md) の「有料プランを始める前に」のチェックリストを使います。
5. **本番モードで売り始めます**（売り始める前のチェックリスト）。1 つでも終わっていなければ、`BILLING_ENABLED` を `true` にしません。
   - [ ] 弁護士に確かめた: NPO が特定商取引法の「役務提供事業者」にあたるか（たぶんあたります。NPO だけを外す決まりはありません）。最終確認の画面（`/settings/plan/confirm`）と Stripe の画面で足りるか。返金の方針（日割りなし）。年齢を申告で確かめること（未成年の契約の取り消し。民法 第 5 条・第 21 条）。利用規約の有料プランの条。プランの名前（「サポーター」は、寄付や、性格診断のタイプの名前とまぎらわしいかもしれません）。
   - [ ] 税理士に確かめた: 有料プランが法人税の「収益事業」にあたるか。消費税の課税事業者か（税込の表示と、インボイスに関わります）。お支払いの記録を何年残すか。
   - [ ] 表記の事実を埋めた: `server/services/billingDisclosure.js` の `OWNER_FACTS`（登記上の名称、代表者または通信販売の責任者、所在地、つながる電話番号と受付時間、メールアドレス）。コードの変更なので、プルリクエストで直します。表は本番モードでだけ出るので、確かめるのは下の `billing.env` の項目のあとです。
   - [ ] 利用規約の有料プランの条（[../legal/terms-of-use.draft.ja.md](../legal/terms-of-use.draft.ja.md) の第 9 条の下書き）を確定し、`/terms` のページに載せた。その URL を、`BILLING_TOS_URL` と、Stripe の Public details に入れた。
   - [ ] プライバシーポリシーの Stripe の部分（[../legal/privacy-policy.draft.ja.md](../legal/privacy-policy.draft.ja.md)）を確定し、`/privacy` のページに載せた。
   - [ ] Stripe の本番モードで、1 と 3 の Stripe の設定をした（本番のアカウントの審査が要ります【要確認】）。
   - [ ] `billing.env` を本番の値にした: `STRIPE_SECRET_KEY`（`rk_live_…`）、`STRIPE_WEBHOOK_SECRET`（本番のエンドポイントの鍵）、`STRIPE_PRICE_ID`（本番のプライス）、`BILLING_TOS_URL`、`BILLING_LIVE=true`。準備ができるまで `BILLING_ENABLED` は空にしておき、最後に `true` にします。本番モードでは `BILLING_TEST_USER_IDS` を見ません。`BILLING_ENABLED` を空のまま `deploy-stack.sh` を実行したあと、`/legal/commerce` に表と「現在、新しいお申し込みは受け付けていません」が出ることを確かめる。最後に `BILLING_ENABLED=true` にして `deploy-stack.sh` を実行したあと、ログが `[Billing] billing: live (serviceable, sales open)` になっている。
   - [ ] Vercel の Production に `VITE_FEATURE_BILLING=true` がある。Production に Deployment Protection やボットのチャレンジをかけていない（かけると Webhook が届きません）。
   - [ ] オーナーが本番で 1 回申し込み、Webhook が届くこと、「お支払いと解約」で解約できることを確かめた。そのあと、7.5 の「返金したい」の手順で、キャンセルと返金をした。

### 7.3 受け入れているリスク

- **性格インサイトも、同じ「llm」の枠です。** 性格インサイト（診断の解説）は中くらいのモデル（Sonnet 5.5）のままで、AI チューター（Haiku 5.5）より 1 回の費用が大きくなります。1 回の費用は、AI チューターがふつう約 0.1 円、性格インサイトは多いときで約 15 円です（どちらも見積もり。性格インサイトの数字は、答えが上限の長さいっぱいで、形を直す 2 回目の呼び出しも起きた場合）。サポーターの 100 回がすべて性格インサイトだと、1 人 1 日の費用は大きくなります。ふたをするのは、サポーター全体の上限（1 日 1,000 回）です。そのときは、1 日 約 15,000 円になりえます（見積もり）。【要確認: 2.1 のとおり、性格インサイトも安いモデルにするか、別の枠にするか】
- **上限の前に、使えなくなることがあります。** サポーター全体の上限（llm 1,000 回、course_generation 200 回）に届くと、サポーターは日本時間 0 時まで使えません（429 の `scope` が `global`）。データベースが答えないあいだは、全体の上限の 1 割までしか使えません（今までと同じ仕組み）。最終確認の画面と表記のページに、「利用が集中したときや障害のときは、上限の前に使えなくなることがあります」と書いています。80% と 100% で、オーナーに知らせが届きます。
- **Webhook の中身が、Vercel と Cloudflare をそのまま通るかは、まだ確かめていません。** 経路は、Stripe → `app.<domain>`（Vercel。合言葉を足す）→ `api.<domain>`（Cloudflare Tunnel）→ API です。途中で中身が 1 バイトでも変わると、署名が通らず、知らせは記録されません。7.2 の 3 で確かめるまで、このリスクが残ります。
  - 知らせが届かないあいだも、申し込んだ方がプランの画面を開けば、Stripe から読み直すので、申し込みは反映されます。
  - ただし、毎月の更新と、ポータルでの解約は、次に知らせが届くまで反映されません。更新が届かないと、期間の終わりの 2 日後に、無料の上限に戻ります。
  - Vercel の Production に Deployment Protection やボットのチャレンジをかけると、Webhook は届きません。
- **API のコンテナが 1 つであることを前提にしています。** 同じ人の申し込みを 1 つずつ順に処理する仕組みは、1 つのコンテナの中だけで働きます。プランの判定を覚える 60 秒も、コンテナごとです。今の VM は、API のコンテナが 1 つです。増やしたときに二重の申し込みが起きたら、Stripe の「1 人 1 つの契約に限る」と、オーナーへの知らせ（`duplicate_subscription`）で止めたり見つけたりします。
- **費用の計算は、見積もりです。** 2.1 の前提（1 回の大きさ、1 ドル = 150 円）で計算しています。
  - 上がる分（AI チューターなど 50 回と、コース作成 10 回）を毎日使い切ると、1 人 1 か月の増える費用は約 366 円です（50 × 約 0.10 円 + 10 × 約 0.72 円 = 1 日 約 12.2 円。それを 30 日）。
  - 500 円から Stripe の手数料（カード 3.6% と Billing 0.7% で、約 21.5 円。<https://stripe.com/jp/pricing>、2026-10-23 の調べ）を引きます。課税事業者なら、消費税（約 45 円）も引いて約 433 円が残ります。免税事業者なら約 478 円です。
  - つまり、ふつうの大きさなら、上がる分の費用はプランの料金でまかなえます。無料の分（上限いっぱいで約 580 円。2.1）は、これまでどおり寄付と助成でまかないます。
  - 1 回の大きさが前提より大きいとき（長い会話、性格インサイトなど）は、まかなえないことがあります。トークンの数は利用者ごとに記録していない（ログに出すだけ）ので、1 人ずつの実際の費用は確かめられません。
  - サポーター全体の上限を使い切った日の費用は、ふつうの大きさで 1 日 約 244 円です（1,000 × 約 0.10 円 + 200 × 約 0.72 円。見積もり）。
- **年齢は申告です。** 18 歳以上かどうかは、登録された生まれた年と月で決めます。身分証では確かめていません。18 歳未満の方が年齢を偽って申し込んだとき、契約を取り消せるか（民法 第 21 条の「詐術」）は、場合によります【要確認: 弁護士】。年齢を未成年に直したときは、すぐにサポーターの上限が止まり、オーナーに知らせが届きます（7.5）。
- **Stripe の画面にも「申し込む」ボタンがあります。** 法律の「最終確認の画面」が、Rise Path の確認の画面か、Stripe の画面かは、はっきりしません。そのため、両方に必要な項目を出しています（Stripe の画面には、1,200 字までの説明）【要確認: 弁護士】。
- **18 歳になる月は、その月の末日まで申し込めません。** 誕生日を、生まれた月の最後の日とみなすためです（4.3）。画面にも、そう書いています。
- **テストモードの記録は、本番のデータベースに残ります。** テストの方の顧客と契約の記録（`livemode = false`）です。本番モードでは使わず、本番の申し込みのじゃまもしません。
- **その日の回数は、プランが変わっても数え直しません。** 解約して無料に戻った日に、すでに 50 回をこえて使っていれば、その日はもう使えません。

### 7.4 残っていること

- オーナーの Stripe の設定と確認（7.2 の 1〜3）。法律と税の確認と、本番の準備（7.2 の 4 と 5）。
- `/terms` と `/privacy` に確定した文を載せること（ページと登録の同意は Phase 4 で作り、止めています。8 章）。表記の事実（`OWNER_FACTS`）。
- 性格インサイトの費用（7.3）。
- AI チューターなどの「今日の上限に達しました」の文は、まだプランを見ていません。429 に `plan` は付きましたが、画面の文は前のままです。無料の方に、サポータープランの案内は出しません。
- 返金や二重の申し込みへの対応は、ダッシュボードで、手で行います（7.5）。管理者の画面に、契約の一覧はありません。
- アカウントの削除（Phase 4、8 章）は、続いているプランがあると止まり、先に解約をお願いします。Stripe の記録にはアカウント ID が残ります。
- 7.2 の 3 で署名が通らなかったときの代わりの方法（Webhook のパスだけ合言葉の関門を通さない）は、作っていません。
- API のコンテナを増やすときの、申し込みの順番待ちと、プランの判定の共有（7.3）。
- カスタマーポータルの「ログインのリンク」（メールで届くリンクから、アプリにサインインしなくても解約できる）は、オーナーが Stripe で on にできます。アプリからは、リンクしていません。
- コンビニ払いと PayPay は使えません。Stripe の Checkout の継続の支払いでは、対応していないためです（<https://docs.stripe.com/payments/payment-methods/payment-method-support>）。
- ブラウザの確認のスクリプトは、リポジトリに入れていません。
- 工数（見積もり・未検証）: 当初の見積もりは、開発 5〜8 日でした。実際にかかった日数は測っていません【要確認】。オーナーの Stripe の設定と確認（7.2 の 1〜3）は、1 日ほどの見込みです。法律と税の相談にかかる期間は、分かりません。

### 7.5 困ったときの手順（ランブック）

オーナーへの知らせ（7.1）の種類は、表の左の `（ ）` の中です。Stripe での操作は、どれもダッシュボードで行います。

| こんなとき | すること |
|---|---|
| 新しい申し込みを止めたい | `billing.env` の `BILLING_ENABLED` を空にして、`./scripts/deploy-stack.sh` を実行します。契約中の方の上限、「お支払いと解約」、Webhook は、そのまま動きます。Stripe は、契約中の方にこれまでどおり毎月請求します |
| 有料プランを終わりにしたい | **先に**、Stripe ですべての契約をキャンセルします（期間の終わりにか、すぐにキャンセルして返金するか。前もってのお知らせのしかたも、弁護士と決めます）。Webhook で記録が `canceled` になったのを確かめてから、`billing.env` の鍵を消します。鍵を先に消すと、契約中の方は無料の上限になり、「お支払いと解約」も開けないのに、Stripe は請求を続けます（起動のときに `billing_unserviceable` の知らせが出ます） |
| 返金したい | 先に、その契約を「すぐにキャンセル」し、そのあとで支払いを返金します。返金だけでは契約は続き、次の月も請求されます（返金すると、`charge_refunded` の知らせが出ます） |
| 支払いへの異議の申し立て（チャージバック）があった（`charge_dispute`） | その契約をすぐにキャンセルします（次の請求で、また申し立てにならないため）。そのあと、Stripe で申し立てに答えます。Stripe の手数料がかかります（日本の料金のページでは 1 件 1,500 円。2026-10-23 の調べ） |
| 年齢が 18 歳未満に直された（`minor_with_subscription`） | サポーターの上限は、自動で止まります。その契約をすぐにキャンセルし、返金します（未成年の契約は、取り消せる場合があるため。民法 第 5 条）。本人と保護者の方に連絡します |
| 二重に申し込まれた（`duplicate_subscription`） | 新しいほうの契約をすぐにキャンセルし、返金します |
| 削除したアカウントの契約が続いている（`deleted_account_renewing`。Phase 4） | Stripe でその契約を解約します。アカウントの削除は元に戻しません（[../guides/account-deletion-operations.ja.md](../guides/account-deletion-operations.ja.md) の 5 章） |
| 知らない顧客の契約（`unknown_customer`） | Rise Path が作っていない顧客の契約です（同じ Stripe のアカウントの寄付など）。Rise Path は記録しません。Stripe で中身を確かめます |
| 契約の中のアカウント ID と、顧客のアカウントがちがう（`user_mismatch`） | 顧客の対応（`billing_customers`）のほうを使っています。Stripe で確かめ、まちがいなら、キャンセルと返金をします |
| 知らないプライスの契約（`unknown_price`） | 記録しますが、サポーターの上限は出しません。前に売っていたプライスなら、`STRIPE_PRICE_IDS_ACCEPTED` に足して、`deploy-stack.sh` を実行します |
| 起動のときに `billing_unserviceable` | `billing.env` を直します。ログの `[Billing] billing: off, not serviceable (…)` に、足りない設定の名前が出ます |
| サポーター全体の上限に届いた（ログの `[AI caps] supporter global daily cap reached`） | 日本時間 0 時に戻ります。毎日続くなら、費用を見てから `AI_CAP_SUPPORTER_GLOBAL_*` を上げます |
| アカウントを消したい | 続いているプランがあると、削除は止まります（ご本人の画面も、スタッフのスクリプトも）。**先に**、その方に解約してもらうか、Stripe で契約をキャンセルします。そのあとの手順は 8.5 です。Supabase でユーザーを消しても、Rise Path の DB と Stripe は変わりません。Rise Path の DB のお支払いの記録は、アカウントとのつながりが空になっても残します |
| Webhook の鍵を替えたい | Stripe で鍵を替えたら、新しい鍵と古い鍵をカンマでつないで `STRIPE_WEBHOOK_SECRET` に入れ（どちらでも通ります）、`deploy-stack.sh` を実行します。古い鍵の期限（最大 24 時間）がすぎたら、古いほうを消します |
| Stripe の鍵を替えたい | 新しい制限付きキーを作り、`STRIPE_SECRET_KEY` を替えて `deploy-stack.sh` を実行します。動くのを確かめてから、古い鍵を消します |
| 価格を変えたい、上限を下げたい | 今の契約者には、前もってお知らせし、次の更新から変えます（民法 第 548 条の 4。定型約款の変更）。または、あらためて同意をもらいます【要確認: 弁護士】。価格を変えるときは、Stripe で新しいプライスを作ります（金額と税の扱いは変えられないため）。`STRIPE_PRICE_ID` を新しいほうにし、古いほうを `STRIPE_PRICE_IDS_ACCEPTED` に入れ、`server/services/billingPlan.js` の `priceJpy` を同じ金額にします（プルリクエスト。ちがうと、申し込みを断ります）。今の契約者を新しいプライスに移すのは、Stripe で行います。上限を上げるのは、すぐに変えてかまいません |

## 8. Phase 4: 公開の前に要るもの（規約のページ、同意、アカウントの削除、保存期間）

一般に公開する前に要るものを作りました（2026-10-24 の作業ツリー）。オーナーの決定は次の 5 つです。

- **D1**: 利用規約とプライバシーポリシーのページ、登録のときの同意、ご本人が自分で消せるアカウントの削除、保存期間。
- **D2**: 消すのは Rise Path のデータだけ。Nexloom と P-School と共通の Supabase のログインは残し、ログインも消したい方はスタッフが消す。
- **D3**: パスワードを入れ直したら、すぐに削除する（待つ期間なし）。
- **D4**: 保存期間は短く。AI の利用回数 30 日、処理の記録と AI アプリからの呼び出しの記録 1 年、サーバーのログは大きさで区切る。使っていないアカウントは消さない。
- **D5**: 同意の証拠は、アカウントを削除したあと 5 年（アカウント ID・版・日時）。版ごとの文は、ハッシュをつけて控えを残す。

### 8.1 作ったもの

- **DB**（migration 018）: 削除の記録 `account_deletions`（5 年）、利用規約への同意の記録 `legal_acceptances` と版ごとのハッシュ `legal_document_versions`、削除したアカウントの保護者の同意の証拠 `account_consent_proofs`（5 年）と AI アプリの記録 `ai_app_provision_records`（3 年）。`auth.users` の行がなくなっても、これらは残ります。削除したアカウントのログインで、データがまた作られないようにする仕組み（`auth.users` のトリガーと、アカウントごとのロック）。
- **ログインの確かめ**: 削除より前にログインしたセッション（JWT の `amr` の時刻で判断）は、アプリの API が 401 `account_deleted`、リモート MCP と SSE の MCP も断ります。削除のあとに改めてログインすると、新しい空のアカウントになります（`tools/core/accountDeletions.js`）。
- **ご本人の削除**: 設定の「アカウントを削除する」（`/settings/delete-account`）。消えるもの・消えないものを出し、パスワードを入れ直して、確認のダイアログのあとに消します。ほかの端末は、次に開いたときにログアウトして記録を消します。削除のあとのページ `/account/deleted`。続いている有料プランがあると止まります（`server/services/accountDeletion.js`、`server/routes/account.js`）。**はじめは止まっています**（`ACCOUNT_DELETION_ENABLED` が未設定のとき。画面には「いまはこの画面から削除できません」と出ます）。8.2 の 2 と 3 が済んでから、オーナーが `ACCOUNT_DELETION_ENABLED=true` にすると使えます。スタッフの削除は、この設定にかかわらず使えます。
- **スタッフの削除**: `scripts/delete-account-data.mjs`（メールアドレスで探す、件数を見る、消す、ほかのサービスで消されたログインを探す `--orphans`）。運用は [../guides/account-deletion-operations.ja.md](../guides/account-deletion-operations.ja.md)。
- **保存期間**: `server/services/retention.js`（API の起動時と 1 時間ごと）。サーバーのログは、すべてのサービスで 10 MB × 5 ファイルまで、DB のエラーには値を出さない（`log_error_verbosity=terse`）、API のログは URL のクエリを残さずアカウント ID を 8 文字にする（`server/utils/redactUrl.js`）。
- **規約のページ**: `/terms` と `/privacy`。下書き（`doc/legal/*.draft.ja.md`）から、作成メモと根拠を外した公開の文（`content/legal/*.ja.md`）を作り、版とハッシュを `shared/legal/versions.js` で決めます。開発のサーバーでは下書きを帯つきで出し、本番では `VITE_FEATURE_LEGAL_PAGES=true` にするまで「準備中」を出します。下書きのまま `true` にすると、本番のビルドが止まります。CI は、止めているビルドに規約の文が入っていないことを確かめます。
- **同意**（`VITE_FEATURE_LEGAL_PAGES=true` のときだけ）: 登録画面の利用目的のお知らせ（`/privacy#section-3`）と、外れた状態のチェック。同意の記録は最初のログインのときにサーバーに残します（アカウント ID・版・日時だけ）。前からあるアカウントや、P-School・管理者が作ったアカウントには、アプリを開いたときに同意のページを出します。保護者の AI の同意の取り消し、記録の削除、AI アプリの解除、プランの解約、アカウントの削除は、同意しなくてもできます。あらためて同意をお願いしない変更は、画面の上のお知らせです（`server/routes/legal.js`、`components/legal/`）。
- **お問い合わせ**: `VITE_SUPPORT_CONTACT`（フォームの `https://` か `mailto:`）を、削除のページ、同意のページ、設定の「このサービスについて」に出します。設定していないと「ご利用の拠点のスタッフにお伝えください」と出ます。
- **文書**: プライバシーポリシーと利用規約の下書き（保存期間、削除のあとも残すもの、ログ）、[../legal/README.md](../legal/README.md)（公開の手順、改定のしかた）、[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)。

### 8.2 オーナーの作業

1. **公開の関門**: 一般の登録は、`VITE_FEATURE_LEGAL_PAGES=true` にするまで受け付けません（拠点とテスターだけ）。`true` にするのは、弁護士の確認のあとです。止めているあいだは、登録画面に利用目的のお知らせも同意もありません（個人情報保護法 第 21 条第 2 項、利用規約 第 1 条）。自動の確かめはありません。手順は [../legal/README.md](../legal/README.md) の「ページを公開する手順」です。
2. **パスワードの設定と削除（どの環境でも）**: ご本人の削除は、はじめ止まっています（`ACCOUNT_DELETION_ENABLED` が未設定）。Supabase の「Require current password when updating」を入れ、ステージングで確かめます。確かめ方: ふつうの学習者のセッションのトークンで、`current_password` を付けずに `PUT /auth/v1/user {"password":"…"}` を送り、400 `current_password_required` が返ること。設定がないと、ログインしたままの端末を持っている人が、新しいパスワードを設定してログインし直し、パスワードの確認を通って、アカウントを削除できます（「Secure password change」だけでは、ログインから 24 時間以内のセッションを防げません）。`byoa`（`mcp-public`）を動かす、または動かす予定のあいだは、さらに [../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md) の手順 6 の 3 つの設定をすべて入れ、手順 10 のパスワードの確かめが通るまで止めたままにします。設定がないと、つないだ AI アプリもパスワードを設定してログインし、アカウントを削除できます。確かめが通り、3 も済んだら、VM の `stack.env` に `ACCOUNT_DELETION_ENABLED=true` を書いて、`deploy-stack.sh` を実行し直します。
3. **本番の `amr` の確かめ**: 本番で新しくログインしたアクセストークンを読み、`amr: [{"method":"password","timestamp":…}]` があることを確かめます。ないと、削除は `reauth_required` になり、削除したアカウントのログインは、ずっと断られます（安全な側）。削除を使い始める前の関門です。2 とこれが済んだら、`ACCOUNT_DELETION_ENABLED=true` にします（2 の終わりの手順）。
4. **デプロイの順番**: マージすると、Vercel がすぐに画面を作り直します。API は `deploy-stack.sh` を実行するまで古いままです。**同じ日に** `deploy-stack.sh` を実行します（migration 018 を当てます）。そのあと `sql/mcp_remote_role.sql` を流し直します。ログの設定が変わるので、最初のデプロイでは、動いているコンテナがすべて一度作り直されます（`db` は「db up」のときに数秒止まり、古い API が 503 を返します。そのあと API、最後に「docker compose up」で cloudflared、読み上げ、mcp、mcp-public、hermes と memanto。トンネルが少し止まり、読み上げのモデルを読み直します）。018 を当てる前に、この版の API、mcp、mcp-public を動かさないでください（手元の開発の DB も `npm run db:migrate`）。
5. **お問い合わせ**: `VITE_SUPPORT_CONTACT`（Vercel）を設定し、下書きの【要記入: 連絡先】に同じ窓口を書きます。だれが読むかを [../guides/account-deletion-operations.ja.md](../guides/account-deletion-operations.ja.md) に書きます。
6. **Supabase のダッシュボードで確かめること**: JWT の有効期間、メールの確認（Confirm email）が on か off か、本番で `VITE_NEXLOOM_SUPABASE_*` を設定しているか（Nexloom だけのセッションは、削除も同意もサーバーに届きません）、セッションの期限の設定があるか（5 年より古いセッションは、また入れてしまいます）。
7. **ログインを手で消す前に**: P-School の外部キーの確かめ（運用ガイドの 3 章）。Nexloom と P-School の担当に、共有のログインを消したら知らせてもらうよう書面で頼み、`--orphans` を月に 1 回実行します。公開の前に 1 回、一覧だけ（`--orphans --limit 20`）をステージングか本番で実行します。
8. **Memanto**: 既定で止まっています。一度でも動かしたなら、止めたままにする前に、そのボリュームを消します。止めているあいだは、アカウントの削除で Memanto の記憶を消せず、同じ ID でまた使い始めたアカウントに、Memanto をまた動かしたときに見えてしまいます。
9. **Hermes**: AI チャットや `full` のプロフィールを学習者に出す前に、削除したアカウントの会話（`./hermes-data`）を消すか、残すことを受け入れます（世代の印で、また使い始めたアカウントには見えません）。
10. **手でとった DB の控え**（`pg_dump`）は、消すまで削除の前のデータを持ちます。何日残すかを決めます（プライバシーポリシー 8 の【要記入】）。

### 8.3 受け入れているリスク

- 認証のたびに DB の主キーの検索が 1 回増えます。DB のエラーのときは断ります（503）。
- `mcp-public` は、削除したアカウントの AI アプリを最大 5 秒通すことがあります（書き込みは外部キーで失敗し、読んでも空です）。
- 時計のずれの余裕: 削除から 30 秒以内のログインは、削除の前のものとみなします（画面は「1 分ほどたってから」と書いています）。
- Memanto の記憶を消したあと、トランザクションの終わりまでに AI アプリが書いた記憶は、あとの消し直しも失敗すると残ります（ログに出ます。Memanto は既定で止まっています）。
- **パスワードのないアカウントと AI アプリ**: 8.2 の 2 の設定を入れても、パスワードのないアカウントは、AI アプリを許可してから 24 時間、アプリがパスワードを設定してログインし、Rise Path のデータを削除できます（5.3 と同じリスクが、削除にも届きます）。Rise Path の登録は必ずパスワードを決めますが、共有のプロジェクトのほかの入口で作ったアカウントにはないことがあります。
- 効力が生じる日より前の、新しい規約のお知らせ（民法 第 548 条の 4、利用規約 第 12 条 2）はまだありません。あらためて同意をお願いする版にするか、新しい文を手でお知らせします。
- 同意は画面で求めます。API とリモートの MCP でも確かめる切り替え（`LEGAL_TERMS_REQUIRED`）は Phase 8 で作りましたが、はじめは止めています（12 章。入れるかどうかは、弁護士に確かめてから決めます）。止めているあいだは、同意していない方がつないだ AI アプリも、そのまま動きます（同意のページは、その方が次に Rise Path を開いたときに出ます）。
- パスワードを忘れた方は、画面から削除できません（再設定の画面がないため）。スタッフの削除で対応します。
- 同意のページの「ログアウト」は、Nexloom をふくむ共有のログインのすべてのセッションを終えます（今のログアウトと同じ）。この端末だけにするかは、Phase 4 の外のオーナーの判断です。
- Hermes（止めています）は、削除したアカウントの会話を残します。5 年たって削除の記録が消えたあとは、世代の印もなくなります。
- Vercel と Cloudflare のログ（パスとクエリをふくむ）は、VM のログの区切りの外です。ほかのモジュールの警告やエラーの行に、ID やエラーの中身が出ることがあり、5xx の行の文に、送られた値が入ることがあります（プライバシーポリシーにそう書いています）。`server/routes/content.js:184,190` と `server.js` の Legacy Portal のエラーの行を `describeError()` に通すのは、あとの Phase です。
- スタッフが自分のアカウントを削除しても、ほかの学習者の記録にあるそのスタッフの ID（`account_consents.recorded_by`、`ai_safety_events.reviewed_by`）は残ります（だれが記録したかの説明のため）。
- 生成した画像と読み上げのキャッシュには、保存期間がありません。`public/uploads` は、名前が分かれば開けます（別に見直します）。→ 2026-10-29 に見直しました。新しいアップロードは `uploads/`（VM ではボリューム）に置いて配信せず、`public/uploads` に残る以前のファイルも、URL では開けません（`server/uploads.js`）。
- 進み具合を持たない古い端末（`'?'`）は、また使い始めたアカウントに、古い進み具合や学習の履歴を送ることがあります（消すのは、前のアカウントと分かる端末だけにしています）。Phase 5 からは、そうして届いた進み具合の分の XP も、また使い始めたアカウントに入ります（9.3）。
- スタッフの削除のあと、その方の AI アプリの許可は Supabase に残ります（管理者の API がないため）。削除の前のセッションは断られますが、またログインすると、アプリが画面なしでつなぎ直せます。
- ほかのサービスで消されたログインの Rise Path のデータは、次の `--orphans` まで残ります。
- Stripe には、アカウント ID が残ります（顧客、支払いの画面、契約の情報）。画面にもそう書いています。
- 決済が動かせない状態（今）では、続いているプランの確かめは、DB の写しだけで行います（テストモードの行です）。
- 削除の直前に始まった申し込みが、削除のあとに支払いの画面を開くことがあります（最大 32 分）。そのあいだに支払いが終わると、削除したアカウントに続く契約が残ることがあり、オーナーへの知らせ `deleted_account_renewing`（ログの `[Billing] deleted_account_renewing: …` と、`AI_CAP_ALERT_WEBHOOK_URL`）が出ます。スタッフが Stripe で解約します。
- Stripe に顧客がいない（`resource_missing`）ときは「Stripe には何もない」とみなします。Stripe のアカウントを替えるときは、先に古いアカウントの契約を解約します。Memanto への呼び出しには時間の上限がありません（Memanto は既定で止まっています）。

### 8.4 残っていること

- オーナーの作業（8.2）と、弁護士・税理士の確認（[../legal/README.md](../legal/README.md) の「弁護士に確かめること（Phase 4）」）。【要記入】【要確認】をすべて埋めるまで、規約のページは公開できません（ビルドが止まります）。
- 効力が生じる日より前に、新しい規約を見せるページ。
- 外国への提供の手続きを登録のときの同意で行う場合の、施行規則 第 17 条の項目とその版（作っていません）。
- 保護者がアカウントを登録する年齢の線と、保護者の同意の記録。
- マイグレーションを本物の PostgreSQL で確かめる CI の仕事は、Phase 7 で入れました（11 章の `Database checks`）。
- Memanto への呼び出しの時間の上限、削除したアカウントの続いている契約の知らせの種類（今はログの警告だけ）。

### 8.5 困ったときの手順（ランブック）

| こんなとき | すること |
|---|---|
| アカウントを消したいと言われた | 画面の削除を使えるようにしてあれば（`ACCOUNT_DELETION_ENABLED=true`）、ご本人に、設定の「アカウントを削除する」を案内します。止めているとき、パスワードを忘れた、画面から消せないときは、スタッフが消します（[../guides/account-deletion-operations.ja.md](../guides/account-deletion-operations.ja.md) の 2 章）。続いているプランがあると止まるので、先に解約してもらいます |
| ログインも消したいと言われた | 同じガイドの 3 章。先に Rise Path のデータを消し、Nexloom と P-School も使えなくなることを書面で伝え、P-School の外部キーを確かめてから、ダッシュボードで消します |
| ほかのサービスでログインが消された | 同じガイドの 4 章（`--orphans`）。月に 1 回も実行します |
| 規約を改定する | [../legal/README.md](../legal/README.md) の「改定するとき」。下書きを直し、`node scripts/legal/build-legal-text.mjs` で文と版を作り、マージした日に `deploy-stack.sh` を実行します。あらためて同意をお願いするのは、重要な変更のときだけ（`requiresAcceptance`） |
| Memanto を止める前に | 一度でも動かしたなら、ボリュームを消します（8.2 の 8） |
| Hermes や AI チャットを学習者に出す前に | 削除したアカウントの会話をどうするかを決めます（8.2 の 9） |
| 削除が「いまは使えません」になる | 削除は、はじめ止まっています。API の `ACCOUNT_DELETION_ENABLED` を確かめます（`true` のときだけ使えます。`1`、`on`、`yes` も同じです。未設定、`false`、知らない値では止まります）。8.2 の 2 と 3 が済むまでは、止めたままにします。そのあいだは、スタッフが消します（[../guides/account-deletion-operations.ja.md](../guides/account-deletion-operations.ja.md) の 2 章） |
| 全員が 503 `auth_unavailable` になる | migration 018 が当たっているか（`account_deletions` の表があるか）、DB が動いているかを確かめます。API から Supabase Auth に届くか（`SUPABASE_URL`、Supabase の障害情報）も確かめます。届かないあいだは 401 にしないので、学習者には「ログインし直す」ではなく、しばらくしてから開き直す案内が出ます |
| VM を Phase 5 より前の版に戻した | 戻しているあいだは、やり直したレッスンの前の記録を持つ端末が、それを送れます（9.3 の R14）。送られた記録は、Phase 5 の版に戻したあとも、そのレッスンの今の記録として残ります（学習者は、もう一度やり直せます）。戻しているあいだは学んだ日を記録しないので、その日に学んだ学習者の連続日数が切れることがあります（必要なら学習者に知らせます）。前の版の「学習の進み具合を消す」は、まだ数えていない XP（戻しているあいだに学んだ分）を残しません。なるべく早く Phase 5 の版に戻します。019 の表は残したままでかまいません（前の版は使いません）。戻したあとは、前の記録を、また断ります |

## 9. Phase 5: 学びやすさの仕上げ（保存の様子、1 つのレッスンのやり直し、XP とバッジ）

Phase 2 で、レッスンの進み具合をサーバーに保存するようにしました。Phase 5 では、保存できているかを画面に出し、1 つのレッスンだけを最初からやり直せるようにし、XP とバッジをサーバーの記録から数えるようにしました（2026-10-25 の作業ツリー）。オーナーの決定は次の 4 つです。

- **O1**: XP は、学んだものごとに 1 回だけもらえます。レッスンを始めたら 10、終えたら 40、Blender のステージを終えたら 80 です。診断とコース生成では、もらえません。レベルの計算は変えません（100 XP ごとに 1 つ上がります）。
- **O2**: レッスンをやり直しても、「学習の進み具合を消す」を使っても、もらった XP は残ります。同じものでは、もう一度もらえません。
- **O3**: 今ある XP は、サーバーの記録（`lesson_progress` と `user_progress.completed_stages`）から数え直します。端末の中だけにあった XP は引き継ぎません。
- **O4**: まだ保存できていない学習があるときは、ログアウトの前に聞きます。「ログアウトしない」（最初に選ばれています）と「このままログアウト」です。保存できていない記録は、同じ学習者が次にログインするまで、その端末に残します。

この章では、次の言葉を使います。

- **世代**: レッスンをやり直すたびに、サーバーがそのレッスンに付ける新しい番号と日時です。前の世代の記録は、もう保存しません。
- **学んだ日**: 学びがサーバーに届いた日（日本時間の日付）です。連続日数は、この日から数えます。

### 9.1 作ったもの

- **保存の様子**: レッスンのバーに、保存の様子を出します（保存済み、保存しています、この端末に保存中、保存が止まっています、読み込み中、この端末だけ。`components/lesson/SaveChip.tsx`）。止まったときやつながらないときは、バーの下に折り返す 1 行で知らせます（`ReaderStatus.tsx`）。保存が止まり、送れていない記録があるときだけ、画面の上にお知らせを出し、「もう一度保存する」（ログインが切れたときは「ログインし直す」）のボタンを付けます（`SaveStoppedNotice.tsx`）。新しいサーバーの 503 は、3 回続けて失敗するまで、間をあけて送り直します。インターネットに戻ったときは、1〜5 秒あとに 1 回だけ試します。アカウントに送らない記録のときは、レッスンの終わりに「この端末に記録しました。」と出します。
- **ログアウトの確認**（O4）: `context/AuthContext.tsx` の `logout()` は、AI の答えを端末から消す前に、`components/lesson/logoutGuard.ts` を通ります。まず送れていない記録を送り（3 秒まで。読み込みの途中でも待ちます）、それでも残ったときだけ聞きます（`UnsavedLogoutDialog.tsx`。本文は「まだログアウトしていません。」で始まります）。0.4 秒より長くかかるときは、「学習の記録を保存しています…」の 1 行を出します。「ログインし直す」のボタン（7 か所と、上のお知らせ）からのログアウトは聞きません。ログインの画面には、端末に残した記録の数を出します（`LeftRecordsNotice.tsx`）。
- **1 つのレッスンのやり直し**: レッスンの終わりの「このレッスンを最初からやり直す」です（`components/lesson/LessonEnd.tsx`）。`POST /api/v2/user/lesson-progress/lesson-reset`（`tools/core/lessonProgress.js` の `resetLessonProgress`）が、サーバーの記録を先に消し、うまくいったときだけ端末の記録を消します。そのレッスンの世代（`lesson_progress_lesson_resets`）を新しくし、前の世代の記録は、どの端末から届いても保存しません（その記録だけを `lesson_reset` で断ります）。端末の記録は、自分がどの世代のものか（`lessonGen`）を持ちます。やり直したあとに、ほかの端末で新しく始めた記録は保存します。押せるのは、サーバーとつながっているときだけです。ゲスト、下書きやプレビュー、古いサーバーでは出しません。「学習の進み具合を消す」の番号（`lesson_progress_resets`）は動かしません。AI アプリ（MCP）からは、やり直したレッスンは、まだ始めていないレッスンと同じに見えます。
- **XP とバッジ**: migration 019 の `xp_awards`（XP の台帳）と `learning_days`（学んだ日）です。XP は、サーバーの記録からだけ数えます（`tools/core/achievements.js`）。数えるのは、`GET /api/v2/user/achievements` を読むとき、Web の保存の答えを返したあと（保存とは別のトランザクション）、Blender のステージを保存したあと、やり直しと「学習の進み具合を消す」の中（記録を消す前）です。学んだ日は、Web の保存で記録の中身が変わったときと、Blender のステージを新しく終えたときに書きます。`POST /api/v2/user/events`（学習の履歴）は、XP も学んだ日も作りません。種類を確かめ、1 回 8 KB、1 人 1 分 30 回までにしました（`server/routes/user.js` の `createLearningEventsRouter`。上限の数え方がテストのサーバーどうしで混ざらないよう、アプリごとに作ります）。レベル、7 つのバッジ、連続日数は、読むたびに計算し、保存しません。バッジの進み具合は、目標の数で止めて出します（もらったかどうかは、目標に届いたかで決めます）。画面は、ダッシュボードの XP と連続日数、プロフィール、バッジのページです（もらっていないバッジに「獲得済み」などを出しません。次のバッジを出します）。ブラウザの中の計算（`services/gamificationService.ts`、`components/ui/activity.ts`）は消しました。
- **Blender の進み具合の持ち主**: 古い形の Blender の進み具合（`rp_learning_progress`）に、記録した学習者の印（`ownerId`）を付けました。その学習者のアカウントにだけ、その人のログインで送ります（`services/apiClient.ts` の `apiFetchAs`）。ステージの XP がほかの人に入らないようにするためです。
- **数え直し**（O3）: 019 が一度だけ、`lesson_progress` と `user_progress` から XP を作り、前の学習の履歴（レッスンとステージを始めた・終えた記録）と、レッスンの記録を最後に変えた日から、学んだ日を作ります。
- **削除と保存期間**: 3 つの表は、アカウントの削除で一緒に消えます（`ON DELETE CASCADE`）。リモートの MCP のロールには渡していません。保存期間の自動の削除には入れていません（アカウントがあるあいだは残します）。スタッフの削除の件数の表示（`scripts/delete-account-data.mjs`）と、削除の画面の「消えるもの」に足しました。「学習の進み具合を消す」の説明は、XP、バッジ、学んだ日、やり直したレッスンが残ることを書きます。
- **確かめ**: `scripts/db/verify-phase5.mjs`（使い捨ての PostgreSQL 16 で P1〜P10。ロックの順番、同時の数え直し、019 の数え直し、アカウントの削除との重なり）と、`npm test` のテストです。
- **文書**: プライバシーポリシーの下書き（2 の 3、8、9 の 4、10 の 1。版 `privacy-draft-2026-10-22.5`）、[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)、`server/migrations/README.md` の 019 の行。

### 9.2 オーナーの作業

1. **デプロイの順番**: migration 019 は、この版の API、mcp、mcp-public を動かす前に当てます（`deploy-stack.sh` が当てます。手元の開発の DB は `npm run db:migrate`）。おすすめは、マージで Vercel が新しい画面を出したあと、すぐに VM で `deploy-stack.sh` → `/api/v2/health` が 200、の順です【要確認】（新しい画面は、古いサーバーではやり直しと XP を出しません）。Vercel の自動デプロイを止めて VM を先にしても壊れませんが、そのあいだに開いた画面はすべて古い画面になり、9.3 の R12 が広がります。どちらの順でも、2 つの更新のあいだは数分にしてください。
2. **DB ロールの SQL は、流し直さなくてかまいません。** 3 つの表は、どれも MCP のロールに渡しません。
3. **019 を当てるあいだは、アカウントの削除をしないでください。** スタッフの削除（`--yes`）は待ちます。画面からの削除を使えるようにしているとき（`ACCOUNT_DELETION_ENABLED=true`）は、人の少ない時間にデプロイします。重なると、Postgres がデッドロック（40P01）でどちらかを止めます。止まったほうは何も変えずに戻るので、もう一度実行します（019 が止まったら `deploy-stack.sh` をもう一度。`server/migrations/README.md`、[`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「保存の様子・レッスンのやり直し・XP」）。
4. **お知らせ**（O3）: リリースのお知らせで、レベルと連続日数が変わることがあると伝えます。XP は、サーバーに保存した進み具合から数え直すため、診断、コース生成、端末の中だけの記録で増えていた分は数えません。連続日数も、サーバーに届いた日から数えます。
5. **拠点のスタッフに伝えます。** ログアウトの確認が出たら、端末を離れる前に答えます（6.2 の 4）。答えるまでは、まだログアウトしていません。
6. **確かめます。** 2 つの端末で同じレッスンをやり直し、もう 1 つの端末でも消えていること。レッスンを終えると XP が 50 増え、バッジのページに「はじめてのレッスン完了」が出ること。インターネットを切ると「この端末に保存中」が出て、つなぐと「保存済み」に戻ること。送れていない記録があるときに、ログアウトの確認が出ること。
7. **弁護士に確かめます。** XP・バッジ・学んだ日を数えて保存することと、前の学習の履歴から学んだ日を作ることが、プライバシーポリシーの 3 の 1「記録の表示」の範囲か。範囲の外なら、目的の変更として、お知らせや同意の形を変えます（`shared/legal/versions.js` の `requiresAcceptance`）。

### 9.3 受け入れているリスク

- **R1**: Web のレッスン画面の答えは自己申告なので（6.3）、公開レッスンとステージごとに 1 回ずつ、XP をもらえてしまいます（今は合わせて 1,520 XP まで）。XP は資格や成績ではありません。
- **R2**: XP は、あとから数えます。学習者が次に保存・読み込み・やり直し・削除をする前に、レッスンの中身が変わって保存ずみの状態が下がると、まだ数えていなかった XP がもらえないことがあります（保存のあとに数えることで、狭めています）。
- **R3**: 連続日数は、学びがサーバーに届いた日で数えます。何日もオフラインで学んだ教室では、その日は数えません（日付をさかのぼって付けられないようにするため）。保存のあとの書き込みが失敗すると、その保存の日は数えません。
- **R4**: 進み具合を持たない古い端末（`'?'`）が、また使い始めたアカウントに前の進み具合を送ると、その分の XP も入ります（8.3 と同じ種類のリスク）。やり直したレッスンは守られます。
- **R5**: やり直したあと、ほかの端末にあるそのレッスンの記録は、やり直しより前の中身を持っていれば捨てます。その端末の時計が遅れていると、やり直しの直後に始めた記録を捨てることがあり、進んでいると、直前の記録を残すことがあります。確認のダイアログは「すべての端末から消え」ると書いています。
- **R6**: レッスンが新しく公開されると、コースを終えたバッジが「まだ」に戻ることがあります（バッジの説明に「いま公開されている」と書いています）。
- **R7**: 学習の履歴（診断、コース生成、前のレッスンの画面）や、端末の中だけの記録で XP をためていた学習者は、レベルが下がります。サーバーに届かなかった、持ち主のない古い Blender の進み具合も引き継ぎません（O3。9.2 の 4 のお知らせ）。
- **R8**: AI アプリ（MCP）だけで学んだ分は、次に読むときに XP になりますが、学んだ日にはなりません。
- **R9**: Nexloom だけでログインした人には、ログアウトの確認が出ません。その人の記録は、持ち主のないまま端末に残り、その人のために送ることもありません（今と同じ。6.4）。
- **R10**: 古い画面のタブは、やり直したレッスンの前の状態を出したまま、読み込み直すまで送り続けます。サーバーは保存せず、続けざまに送ることもありません。
- **R11**: 確認を出せるのは、そのタブでのログアウトだけです。ログインが切れたときなど、ほかの終わり方は、ログインの画面のお知らせで伝えます。
- **R12**: 別のタブで学習者が替わる瞬間に重なった通信は、前の学習者のものとして届くことがあります。また、VM を更新したあとも開いたままの古い画面のタブは、持ち主のない古い Blender の進み具合（ほかの人のものかもしれません）を送り、そのステージの XP（最大 320）と学んだ日が、そのタブでログインしている学習者に入ります。そのタブを読み込み直すまでです（Vercel を先に出せば、そのタブは Vercel の更新より前に開いたものだけになります。VM を先にすると、VM の更新から Vercel の更新までに開いた画面も、すべて古い画面です。9.2 の 1）。
- **R13**: 確認に答えないまま端末を離れると、ログインしたまま（AI の答えも端末に残ったまま）になります。次の人が Esc を押すと、そのまま使えます。本文は「まだログアウトしていません」と書き、スタッフの案内に入れました（9.2 の 5）。最初に選ばれているのは、決定 O4 のとおり「ログアウトしない」です。
- **R14**: VM を Phase 5 より前の版に戻しているあいだは、やり直したレッスンの前の記録を持つ端末が、それを送れます。送られた中身は、新しい版に戻したあとも残ります（新しい版は、それより後に届く前の記録を、また断ります）。戻しているあいだは学んだ日を記録しないので、連続日数が切れることがあります。また、前の版の「学習の進み具合を消す」は、戻しているあいだに学んだ分の XP を残しません（8.5）。
- **R15**: いくつかのレッスンをまとめて保存するときに、同じ学習者のアカウントの削除と重なると、Postgres がデッドロック（40P01）でどちらかを止めることがあります（Phase 4 からあったことです）。保存は 500 になり、画面があとで送り直します。削除が止まったときは、もう一度実行します。データは壊れません。保存にもアカウントの行のロック（`ACCOUNT_STUB_SHARE_SQL`）を足せば防げますが、すべての保存が少し重くなるので、オーナーが決めます。
- **R16**: 学習の履歴は、1 回 8 KB までです。それより大きいもの（とても長い目標を持つ生成コースの完了など）は、サーバーに残りません（端末の履歴には残ります。XP には関係ありません）。

### 9.4 残っていること

- オーナーの作業（9.2）と、弁護士の確認（9.2 の 7）。
- 前のアカウントの記録を、また使い始めたアカウントで断る仕組み（`predates_restart`）。R4 を閉じます。Phase 4 で受け入れたリスクを狭めるので、オーナーが決めます。
- 古い `PUT /api/v2/user/progress/:courseId` の形の確かめ（ID の形、ステージの数、手順の大きさ）。XP は、ステージ 1〜4 だけを数え、持ち主の決まりもあるので、今も上限があります。
- マイグレーションを本物の PostgreSQL で確かめる CI の仕事は、Phase 7 で入れました（11 章の `Database checks`）。
- Nexloom だけでログインした人のための、端末だけのやり直し（今はボタンを出しません）。
- 端末の時計のずれを、サーバーの時刻（応答の `Date`）から直すこと（R5 を狭めます）。
- 先生が学習者の進み具合を見る画面（6.4）。
- 前からあること（Phase 5 では変えていません）: Blender のレッスン画面（`BlenderLessonView`）は、開いたときに一度だけ手順を読み、手順の印を付けるとそのステージの手順を置き換えます。開いたあとに、ほかの端末から新しい手順が届くと、それを上書きすることがあります。
- 工数（見積もり・未検証）: 実際にかかった日数は測っていません【要確認】。オーナーの更新と確認は、半日ほどの見込みです。

## 10. Phase 6: 復習（忘れかけたころに、カードがもう一度出る）

Phase 6 では、レッスンの暗記カード（復習カード）が、忘れかけたころにもう一度出るようにしました（2026-10-26 の作業ツリー）。いつ出すかは、公開されている計算の決まり FSRS-6（Free Spaced Repetition Scheduler。間隔をあけて復習する方法）で決めます。画面には、この名前を出しません。記録はサーバーに保存し、自分の AI アプリ（MCP）からも使えます。オーナーの決定は次の 4 つです。

- **R1**: レッスンを終えると、そのレッスンのカードが復習に入ります。レッスンの中で「覚えた」か「もう一度」を押したカードは、終える前でも、そのときに入ります。
- **R2**: 復習は 1 日 10 枚まで（約 3 分）です。それより多いときは、いちばん忘れかけているカード（思い出せる見込みがいちばん低いカード）から出し、残りは次の日からに回します。
- **R3**: ボタンは「もう一度」（FSRS の Again）と「覚えた」（FSRS の Good）の 2 つです。レッスンの中と同じです。
- **R4**: 1 つのレッスンをやり直すと（Phase 5）、そのレッスンのカードは、復習の予定と記録ごと外れます。もう一度終えると、はじめから入ります。「学習の進み具合を消す」は、復習の予定と記録をすべて消します。XP は前と同じく残ります（Phase 5 の O2）。

ほかは、決定の前に示された既定のとおりです。既定を少し違って読んだところは、10.2 の 8 でオーナーが確かめます。

この章では、次の言葉を使います。

- **復習**: 今日のカードの問いを見て、自分で思い出してから答えを見て、「もう一度」か「覚えた」を選ぶことです。
- **カードを学んだ日時**: そのカードの最初の評価を決めたときに、そのレッスンの記録が変わった日時です（`lesson_progress.progress_changed_at`。サーバーの時計）。読み込みや、中身の変わらない保存では動きません。Phase 5 の「学んだ日」（`learning_days`）とは別のものです。
- **覚えている度合いの目安**: FSRS-6 の安定度（思い出せる見込みが 90% まで下がる日数）と難しさ（1〜10）です。
- **今日の分**: 今日出すカードです。10 枚から、今日すでに記録した数を引いた数までです。

### 10.1 作ったもの

- **計算の決まり**: `shared/review/fsrs.js`。依存は足さず、リポジトリの中に書きました（ts-fsrs などは使いません）。FSRS-6 の公開された 21 個の既定の値、目標の思い出せる見込み 0.9、日単位（分単位の学び直しの段階はありません）、日の区切りは日本時間の 0 時（Phase 5 の学んだ日と同じ）、同じカードの同じ状態ならいつも同じになる「ゆらぎ」（fuzz）です。間隔の上限は 365 日にしました（既定は 36500 日）。カードの文は ID を変えずに直すことがあり、直した文も 1 年のうちに一度は出したいためです。すべて「覚えた」のときの間隔は 2、11、46、163、365 日で、既定と違うのは 5 回目からです。上げるときは、定数と CHECK を変える小さな migration で済みます。式の出典はファイルの先頭に書き、公開されている実装（py-fsrs など）の値でテストしています（`server/tests/reviewFsrs.test.js`）。
- **並べ方と 1 日の上限（R2）**: `shared/review/queue.js`。今日出せるカードを、思い出せる見込み（FSRS の R）の低い順に並べ、10 枚までにします。同じなら、出す日の早い順、レッスンの中の順です。カードの一覧は、公開しているレッスンから作ります（`shared/review/cards.js`。今は 92 枚）。
- **カードが入る決まり（R1）**: サーバーにあるそのレッスンの記録（`lesson_progress`）が「終えた」（XP の「終えた」と同じ `read`・`checked`・`mastered`）か、そのカードに印があるときだけ入れます。端末や AI アプリの申告からは入れません。入れるのは、次に復習を読むとき（Web の `GET /api/v2/user/review` と MCP の `course-review-due`）で、学習者のロックの中の 1 つの SQL で行います（何度読んでも同じです）。
- **レッスンを最初の評価として数える**: 入ったカードは、レッスンを FSRS の最初の評価として始めます。最後の印が「もう一度」なら Again、ほかは Good です。日付はカードを学んだ日時（日本時間の日）で、最初の復習はその 2 日あと（Again は 1 日あと）です。学んだ日には出ません。最初の復習の前にレッスンで印を付け直すと（入ったあとでも）、その印で最初の評価を決め直し、日付もそのときにします。レッスンの印は、復習の回数や記録にはしません（記録の表に行を作りません）。学習者がそのレッスンを学んだあとで作者が足したカードは、学習者がレッスンでそのカードに印を付けるまで、覚えている度合いの目安なしで入り、入った次の日に、ほかのカードのあとに出ます。あとから足したカードかどうかは、カードを入れる処理が最後に確かめたそのレッスンの記録の日時（`review_cards.checked_at`）と、印なしで入ったカード（レッスンを終えたときに入ったもの）があるかどうかで見分けます（見分けられない場合は 10.3 の 1）。
- **リリースの前に終えたレッスン**: DB は何も書き換えません（カードの ID はレッスンのファイルにあり、DB にはないため）。リリースのあと最初に復習を読むときに、終えたレッスンのカードと印のあるカードが入ります。カードのあるレッスンをすべて終えた学習者は 92 枚になり、リリースのあと最初に開いた日を 1 日目として、1 日 10 枚で、10 日目までに一度ずつ出ます（`server/tests/reviewQueue.test.js` の B1）。
- **表**: migration 020 の `review_cards`（学習者とカードごとに 1 行。予定と目安と、あとから足したカードを見分けるための、記録を最後に確かめた日時）、`review_log`（復習 1 回ごとに 1 行。足すだけ。1 枚のカードは 1 日 1 回まで）、`lesson_progress.progress_changed_at`（トリガーが入れます）。CHECK で、答えは 2 つだけ、次に出す日は 1〜365 日あと、と決めています。`review_log` の外部キーは `review_cards` だけです（`auth.users` にもあると、アカウントの削除とデッドロックになるため）。020 は 2 つの表を先に作り、`lesson_progress` をあとで変えるので、当てているあいだに削除が重なっても、どちらかが待つだけです。
- **API**: `server/routes/review.js` の `GET /api/v2/user/review` と `POST /api/v2/user/review/grade`。ログインした学習者だけ（`requireSignedIn`）、本文は 2 KB まで、読み込みと記録を合わせて 1 人 1 分 60 回までです。日付はすべて PostgreSQL の時計で決め、ブラウザの時刻は使いません。期日の来ていないカードと、今日すでに記録したカードは `not_due`、10 枚を記録したあとは `review_limit` で断ります。応答には `learnerId` を付け、画面はほかの学習者あての応答を捨てます。進み具合の `GET` の `capabilities` に `review: true` を足しました。古いサーバーでは、画面に復習を出しません。
- **学んだ日と XP**: Web の復習は、応答を返したあとで、その復習の日（日本時間）を学んだ日として書きます（`noteReviewDay`。失敗してもログに残すだけです）。AI アプリからの復習は書きません（9.3 の R8 と同じ）。XP とバッジは付きません。
- **やり直しと削除（R4）**: やり直しは、そのレッスンのカードを、やり直しと同じトランザクションで消します。「学習の進み具合を消す」は、すべてのカードを消します。復習の記録はカードと一緒に消え、アカウントの削除でも消えます（`ON DELETE CASCADE`）。XP、学んだ日、レッスンの世代は変えません。画面は、やり直しと消すのが終わったら、復習の数を読み直します。
- **隠すカード**: レッスンから外したカードと、公開をやめたレッスンのカードは、消さずに隠します（記録しようとすると `not_found`）。戻すと、覚えている度合いも戻ります。文を直しても、覚えている度合いは残ります。公開しているカードの ID は `server/tests/fixtures/published-card-ids.json` に書き、変わると CI が止まります（`server/tests/reviewCardIds.test.js`。わざと外すときは `retired` に移します）。
- **画面**: 復習のページ `/review`（`components/review/ReviewView.tsx`）。カードを押すと裏返り（動きを減らす設定では動きません）、「もう一度」か「覚えた」を選びます。「今日の 4 / 10 枚目」のように数を出します。記録できるのは、インターネットにつながり、保存がつながっているときだけで、そうでないときはボタンを止めて理由を出します。日本語だけのカードは、英語の画面でも `lang="ja"` を付けます。サイドバーに「復習」と今日の枚数を、ダッシュボードに「今日の復習 N 枚（約 3 分）」を出します（前の仮の文は、確認問題でまちがえたところと AI チューターのカードを約束していたので直しました）。今日の一覧を終えると、サイドバーとダッシュボードの枚数をすぐに読み直します（記録したあとに開いた画面も、すぐに読み直します）。ゲストには「復習は、ログインすると使えます」を出します。ほかのアカウントでログインしたときは、その復習をそこで止めて 1 行で知らせます。ログインが切れたときは、ページごとログインの前の画面に戻り、何も記録しません（Nexloom のログインが残っているときは、その復習をそこで止めて 1 行で知らせます）。サーバーが `review` を出さなくなったら、一覧と枚数を消します。Web で記録すると、XP と連続日数の表示も、次に開いたときに読み直します。やり直しの確認、「学習の進み具合を消す」、アカウントの削除の画面の文にも、復習の予定と記録のことを足しました。復習のデータはブラウザに保存しません（`components/review/reviewClient.ts`、`reviewModel.ts`）。
- **AI アプリ（MCP。18 歳以上だけ）**: リモートの `learner-remote` に 2 つのツールを足しました（リモートのサーバーにだけ登録します。ツールは 11 から 13 になりました）。`course-review-due` は今日のカードの問いだけを返し、進め方（`review_protocol`）を添えます。`course-review-grade` は、`reveal: true` で答えを見せ（何も記録しません）、`rating` で学習者が選んだ結果を記録して、答えと次に出る日を返します。ツールの説明で、問いを見せ、学習者が答えるのを待ち、答えを見せてから、どちらのボタンかを学習者に聞くよう AI に伝えます。期日の来ていないカードと、今日すでに記録したカードは `not_due` で断り、次に出る日だけを返します。`course-review-grade` は、答えを見るだけの呼び出しも、書き込みの上限（`mcp_write`、1 日 50 回）に数えます。DB のロールには、要る列だけを渡しました（`review_log` は読めず、行も消せません。`deploy/risepath-vm/sql/mcp_remote_role.sql`）。許可の画面と「つないでいる AI アプリ」の文も直しました。
- **確かめ**: `scripts/db/verify-phase6.mjs`（使い捨ての PostgreSQL 16 で P1〜P12。トリガー、CHECK、カードが入る決まり、リモートのロールの権限、同時の記録、やり直しとの重なり、アカウントの削除との重なり、前の版に戻したあとの確認と削除）と、`npm test` のテストと、アプリの画面での確かめ（390 px と 1280 px）です。
- **文書**: プライバシーポリシーの下書き（2 の 3、3 の作成メモ、4.4 の 2、8、9 の 4。版 `privacy-draft-2026-10-22.7`）、[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md) の「復習（Phase 6）」の行、`server/migrations/README.md` の 020 の行、[`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「復習（Phase 6）」、[../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md) の手順 7。

### 10.2 オーナーの作業

1. **デプロイの順番**: migration 020 を、この版の `api`・`mcp`・`mcp-public` を起動する前に当てます（`deploy-stack.sh` が当てます。手元の開発の DB は `npm run db:migrate`）。020 は終わるまで `auth.users` をロックするので、人の少ない時間にします。アカウントの削除が重なってもデッドロックにはなりませんが、削除は 020 を待ち、10 秒を超えると `account_busy` で終わります（あとでもう一度実行します）。画面（Vercel）と VM は、どちらを先にしても壊れません（新しい画面は、古い API では復習を出しません。10.3 の 6）。2 つの更新のあいだは、Phase 5 と同じく数分にしてください。
2. **`byoa` を動かしているときは、020 のあとに DB ロールの SQL を流し直します**（[../guides/byoa-setup.ja.md](../guides/byoa-setup.ja.md) の手順 7。パスワードは今の値）。流すまで、AI アプリの復習の 2 つのツールは `review_unavailable` を返します。ほかのツールは動きます。
3. **AI アプリの許可の数を確かめます**: `SELECT count(*) FROM mcp_oauth_grants WHERE revoked_at IS NULL`。今の許可は、あらためて同意をもらわずに 2 つのツールを使えます（Phase 2 と同じ扱い。10.3 の 7）。
4. **前の版に戻したあと、この版に戻すとき**は、この版のサービスを起動する前に、[`deploy/risepath-vm/README.md`](../../deploy/risepath-vm/README.md) の「復習（Phase 6）」の確認と削除を流します。前の版のやり直しと「学習の進み具合を消す」は、復習のカードを消さないためです。
5. **お知らせ**: リリースのお知らせで、「終えたレッスンのカードが、1 日 10 枚ずつ復習に出てきます」と伝えます。
6. **確かめます**: 前からレッスンを終えていた学習者で、復習のページに 10 枚まで出ること。「覚えた」を押すと次のカードに進み、そのカードが今日の数から減ること。そのレッスンをやり直すと、そのカードが復習から消えること。ゲストでは「復習は、ログインすると使えます」が出ること。
7. **弁護士に確かめます**（[../legal/README.md](../legal/README.md) の Phase 6）。レッスンでの印と復習の結果から、覚えている度合いの目安を計算して保存し、出すカードと日を選ぶことが、プライバシーポリシーの 3 の 1 か 3 の 2 の範囲か（範囲の外なら、目的の変更として `requiresAcceptance` とお知らせの形を変えます）。18 歳未満の学習者の分を保護者の同意なしに保存すること。AI アプリが問い、答え、次に出る日を受け取り、結果を記録することが、4.4 の整理で足りるか。
8. **決めること**（このまま進める案です）:
   1. `course-review-grade` の `reveal: true`（何も記録せず、期日が来ていて今日まだ記録していないカードだけ。今日 10 枚を記録するまで使えます。見せた枚数は数えませんが、呼び出しは書き込みの上限（1 日 50 回）に数えます）。「問いを見せ、答えるのを待ち、答えを見せてから聞く」進め方に、記録の前の答えが要るためです。
   2. 間隔の上限 365 日（10.1）。上げるときは、定数と小さな migration です。
   3. カードを学んだ日時を、レッスンの記録が最後に変わった日時にすること。読み込みでは動かないので、リリースの日に何度読んでも出る日は変わりません。リリースの前に終えたレッスンのカードは、リリースのあと最初に開いた日から出ます。ほかの案は、保存と AI アプリの書き込みの中でカードを入れることです（保存の道のコードが増え、リリース前の分には読むときの処理もやはり要ります）。
   4. レッスンを最初の評価（Good、最後の印が「もう一度」なら Again）として数えること。印を復習の記録にはしませんが、最初の目安を選ぶのに使います（最初の復習の前なら、付け直した印で決め直します）。ほかの案は、すべて Good にする（印を使わない）か、目安なしで始める（最初の復習を新しいカードとして数えます。リリース前の 92 枚が片付くのに約 18 日、はじめの 60 日で 276 回）です。
   5. 「約 N 分」を 1 枚 18 秒で数えること（10 枚で約 3 分）。
   6. `course-review-due` を読み取りのツール（`readOnlyHint: true`）として出すこと。カードを入れる書き込みはしますが、学習者の記録から決まるものだけです（`course-progress-get` と同じ扱い）。

### 10.3 受け入れているリスク

1. カードが入るのは、保存のときではなく、次に復習を読むときです。出る日は、カードを学んだ日時（記録が変わったときだけ動くサーバーの時計）から決めるので、いつ読んでも変わりません。ただし、作者があとで足したカードは、入った次の日に出ます。終えたレッスンを、カードが入る前に読み直して記録が変わると（続きの位置など）、その日がカードを学んだ日になります（入ったあとの読み直しでは変わりません。最初の復習の前に印を付け直したカードだけ、その日になります）。作者があとで足したカードを、学習者が学んだカードと取りちがえるのは、次の 2 つのときだけです。学習者がレッスンを終えたあと、最初に復習を読む前に、作者がカードを足したとき。学習者がそのレッスンのカードすべてに印を付けていて、記録を変えたあと、次に復習を読む前に、作者がカードを足したとき（どちらも、そのカードは、その記録が変わった日時を学んだ日時として入ります）。AI アプリだけで終えたレッスンは、次に `course-review-due` を読むか、Web で開いたときに入ります。
2. 日の区切りは日本時間の 0 時です（学んだ日と同じ）。23:50 にレッスンで「もう一度」の印を付けたカードは、0:10 にはもう 1 日たったと数え、次の日の復習に出ます（そのとき「覚えた」なら、安定度は、同じ日と数えたときの約 0.25 日ではなく、約 1.9 日です。`server/tests/reviewFsrs.test.js` の L2）。FSRS の既定の値は、この日単位で作られています。海外の学習者も日本時間の日付です（連続日数と同じ）。
3. ボタンは 2 つで、取り消しはありません。よく覚えたカードで「もう一度」をまちがえて押すと、難しさが約 2.1 から 7.4 に上がり、ゆっくりしか戻りません。画面では、ボタンの近くのほかの文に「もう一度」を使いません。
4. 結果は自己申告です（Web も AI アプリも）。思い出せなくても「覚えた」を押せますが、変わるのは本人の予定だけです。AI アプリは、学習者に聞かずに記録したり、答えを早く見せたりできます（どちらも期日の来たカードだけです。記録は 1 日 10 枚まで。答えを見るだけの呼び出しは、今日 10 枚を記録するまで枚数を数えません。どちらも書き込み 50 回まで、呼び出しの記録あり。許可の画面は「アプリに伝えています」と書き、守らせるとは書きません）。出す順（R2）は今日の一覧の決まりで、AI アプリは、一覧にない期日の来たカード（次の日からに回したカード）も記録できます。どの結果を AI アプリで記録したかを見る画面はありません（記録の表には残ります）。
5. リリースの直後は、カードのあるレッスンをすべて 1〜8 日前に終えていた学習者に 92 枚あります。リリースのあと最初に開いた日を 1 日目として、1 日 10 枚で 10 日目までに一度ずつ出て、はじめの 60 日の復習は 184 回です（すべて「覚えた」のとき）。5 枚に 1 枚をレッスンで「もう一度」にしていたときは 12 日目まで、208 回です（そのときは、28〜34 日目にも、次の日に回すカードが出ます）。claude-code の 77 枚だけなら 8 日目までです。
6. VM を Phase 5 の版に戻しているあいだは、前の版のやり直しと「学習の進み具合を消す」が、復習のカードを残します（画面には出ません。レッスンの記録が戻ってきても残ります）。この版に戻すときは、10.2 の 4 の確認と削除を、サービスを起動する前に流します。古い画面のタブは、読み込み直すまで、やり直しの確認に前の文を出します（サーバーは復習も消します）。新しい画面が Phase 5 の API につながると、ページを開くたびに 1 回だけ、進み具合の応答が届く前に `GET /api/v2/user/review` を送り、404 を受けて、そのページでは「使えない」とします（記録は送りません）。開いたままのページは、進み具合の次の応答が `review` を出さなくなったときに、一覧と枚数を消します。そのあいだに送った記録が 404 になると、その復習は終わります。
7. 今の AI アプリの許可は、あらためて同意をもらわずに 2 つのツールを使えます（Phase 2 と同じ）。BYOA は、まだ動かしていない見込みです（10.2 の 3）。
8. 公開しているカードの ID を変えたり外したりすると、そのカードの覚えている度合いが隠れます（CI のテストが知らせ、オーナーが決めます）。
9. 学習者のロックは、アカウント ID の文字をそのまま使います（`tools/core/lessonProgress.js`）。今の呼び出しはすべて同じ書き方にそろえてからロックし、Supabase の ID は小文字です。別の書き方の ID を使う新しいログインの道を作ると、ロックが分かれ、やり直しと復習が重なったときにカードが戻ることがあります。
10. やり直しをすると、そのレッスンの分だけ、今日の枠が空きます（今日の数は、今あるカードの行から数えるため）。学びすぎを防ぐための上限で、安全のための上限ではありません。
11. Web の復習の学んだ日は、応答のあとに書きます（失敗すると、その日は数えません。9.3 の R3 と同じ）。日付は復習そのものの日なので、0 時の直前の復習は、書き込みが 0 時を過ぎても、その日に数えます。レッスンの保存の学んだ日（Phase 5 の `noteLearning`）は、書き込むときの今日を使うので、0 時の直前の保存が次の日になることがあります（Phase 5 のままです）。
12. ロールの SQL を流し直すまで、AI アプリの復習の 2 つのツールは `review_unavailable` を返します。答えを見ながら 10 枚を AI アプリで復習すると、書き込みの 50 回のうち 20 回を使います。クイズの記録と合わせると、上限に届くことがあります。
13. 間隔の上限 365 日は、公開の既定（36500 日）と違います（10.2 の 8 の 2）。
14. 18 歳未満の学習者の復習の予定と記録も、レッスンの進み具合と同じように保存します（保護者の同意は確かめません。データの一覧の注 8 の【要確認】）。AI アプリは、これまでどおり 18 歳以上だけです。
15. 記録には、インターネットと保存のつながりが要ります。オフラインの教室では、思い出す練習はできますが、記録はできません。英語の画面の学習者にも、日本語だけの claude-code のカードが出ます（`lang="ja"` を付けています）。
16. 0 時をまたいで開いたままのタブは、前の日の数を出し続けます。復習を使う画面を開き直す（読んでから 30 秒より古いとき、またはそのあとにレッスンを保存したか、復習を記録したとき）か、次の記録の応答で日付が変わると直ります。レッスンを保存しても、その場では復習を読み直しません（サイドバーの枚数は、ダッシュボードか復習のページを開いたときに直ります。保存で今日の分が増えることはなく、読み直すと、教室で同じ IP の 1 分 200 回の上限を、学習者 1 人あたり約 2 倍使うためです）。0 時のタイマーと、タブに戻ったときの読み直しはありません。日付と上限はサーバーが決めるので、まちがった記録にはなりません。
17. 390 px の画面では、最初に見える範囲に、今日の復習があることが出ませんでした（ダッシュボードのカードは下のほうで、サイドバーの枚数は閉じたメニューの中です）。メニューのボタンの枚数は、すべての画面の上の部分が変わるので Phase 6 では見送り、Phase 8 で出すようにしました（12 章）。広い画面では、サイドバーに枚数が見えます。
18. レッスンを最初の評価として数えるので、終えたレッスンで一度も裏返さなかったカードも、覚えたものとして始まります（2 日あとに出ます）。そこで「もう一度」なら忘れたものとして数え（安定度 約 0.6 日、1 日あと）、そこから FSRS が合わせます。
19. `progress_changed_at` は、リモートの MCP のロールが表ごと読める `lesson_progress` の新しい列です。ロールはこれを読めますが（`updated_at` と同じ）、書いてもトリガーが無視します。020 より前の行は `updated_at` を使います。その値が、リリースの前の読み込みで数日動いていることがあります（そのカードは、どのみちリリースのときに出ます）。

### 10.4 残っていること

- オーナーの作業（10.2）と、弁護士の確認（10.2 の 7）。
- 最後の記録の取り消し（記録の表に、前の状態が残っています）。
- どの結果を AI アプリで記録したかを見る画面。
- 7 日あとにどれだけ思い出せたかの集計（記録の表から作れます。プライバシーポリシーの目的 5 として、弁護士の確認が要ります）。
- レッスンの始めの短い復習（ウォームアップ）、まちがえた確認問題と AI チューターのカードを復習に入れること、コースごとの目標の見込み、学習者に合わせた値の調整（復習が 512 回をこえてから）、FSRS-7（`learned_at`・`prior_rating` と `review_log` から作り直せます）。
- アプリの外の知らせ（メールやプッシュ）、5 つの項目のナビゲーション、`learner-state-get` の復習の欄、claude-code のカードの英訳。
- 範囲を絞るときに見送ったもの: レッスンの終わりの復習の 1 行とリンク、終わりの画面の「覚えた」と「もう一度」の数、日本時間の 0 時の読み直し、AI チューターのプロンプトで復習のツールを名指しすること、AI チューターのカードの「この端末だけ」の 1 行、英語の画面の「このカードは日本語です」。
- マイグレーションを本物の PostgreSQL で確かめる CI の仕事は、Phase 7 で入れました（11 章の `Database checks`）。
- 工数（見積もり・未検証）: 実際にかかった日数は測っていません【要確認】。オーナーの更新と確認は、半日ほどの見込みです。

## 11. Phase 7: 公開の前に、通しで確かめる（CI の 3 つのチェック）

Phase 1〜6 のコードは、まだ本番で動いたことがありません（2026-10-21 に VM を削除したためです）。作り直した VM では、最初の `deploy-stack.sh` が、空の DB に migration 000–020 をまとめて流します。Phase 7 では、それと同じことを GitHub Actions で、プルリクエストのたびに確かめるようにしました（2026-10-28 の作業ツリー）。オーナーの決定は次の 5 つです。

- **P1**: 新しい確かめを 3 つ足します。(A) VM と同じ pgvector の PostgreSQL 16（`docker-compose.yml` と同じダイジェスト）に migration を 2 回流し、確かめのスクリプト 3 つと DB ロールの SQL を動かします。(B) 本物の `deploy-stack.sh` で、秘密を含まないダミーの値のスタックを Docker で作り、ヘルスチェックとスモークを通します。(C) ブラウザで、ログイン → レッスン → 復習の流れを、そのスタックに対して最後まで動かします。
- **P2**: (B) と (C) は、すべてのプルリクエスト、main への push、毎晩、手動で動かします。(A) も、すべてのプルリクエストと push で動かします。
- **P3**: `deploy-stack.sh` に、CI の変数があるときだけ「最新のコードを取る」手順（git pull）を飛ばす、小さな切り替えを足します。VM では変数を設定しないので、何も変わりません。テストで固定します。
- **P4**: 失敗したときのスクリーンショットとログを残すために、GitHub の `actions/upload-artifact` を使います。ほかの Action は足しません。
- **P5**: この 3 つは、マージの前に必ず通るもの（必須のチェック）にします。ブランチのルールは、オーナーが GitHub で設定します（11.2 の 1）。

この章では、次の言葉を使います。

- **チェック**: プルリクエストの画面に出る、CI の 1 つの仕事の結果です（緑か赤）。
- **必須のチェック**: 緑にならないとマージできないチェックです。ブランチのルールで決めます。
- **ログインの代わり**: Supabase のログインと同じ形の答えを返す、テスト専用の小さなプログラムです（`e2e/support/auth-stand-in.mjs`）。本物の Supabase には、つなぎません。
- **ダミーの値**: 形だけの値です（`ci-dummy-…`）。秘密ではなく、本番では使いません。

### 11.1 作ったもの

- **CI の仕事** `.github/workflows/e2e.yml`（名前は `End-to-end checks`）。どれも秘密を使わないので、フォークからのプルリクエストでも動きます（初めての人のものは、承認のあとです。11.5）。

  | チェックの名前 | 確かめること | 手元で | 時間（2026-10-28、GitHub での最初の実行で測った値） |
  |---|---|---|---|
  | `Database checks` | VM と同じ DB のイメージを、本番と同じ `log_error_verbosity=terse` で起動します。確かめのスクリプト 3 つ（`verify-account-deletion.mjs`・`verify-phase5.mjs`・`verify-phase6.mjs`）を、それぞれ空の DB で、飛ばしを許さずに動かします。別の DB に `scripts/db-migrate.mjs` で migration を 2 回流し（2 回目は何も流しません）、`vector(768)` の列と、DB ロールの SQL（パスワードがないときと短いときは断ること、2 回流せること、ロールで読めない表）を確かめます | `npm run ci:db` | 約 2 分（1 分 42 秒） |
  | `Server stack deploy` | 本物の `deploy-stack.sh` で、ダミーの値のスタック（db・api・mcp）を Docker で作ります（ビルド → db → migration → api → ヘルスチェック → スモーク）。そのあと、実行環境（手元ではこのマシン）から `/api/v2/health` を読み、本番の設定で動いていて、まだ流していない migration がないことと、`mcp` が DB につながっていることを確かめます。最後にディスクの使い方を出します（「Disk use」） | `npm run ci:stack` | 約 2 分（2 分 2 秒） |
  | `Learner end-to-end` | 同じ手順でスタックを作り、本番と同じビルドの画面（`build:prod` を `vite preview` で出します）とログインの代わりをつなぎ、ブラウザ（Playwright）で下の 5 つの流れを動かします。最後にディスクの使い方を出します（「Disk use」） | `npm run e2e:local` | 約 4 分（4 分 14 秒。ブラウザの 5 つの流れは 1.1 分） |

  `Database checks` は ubuntu-24.04（psql 16 があるため）で、ほかの 2 つは ubuntu-26.04（VM と同じ Docker 29 と Compose 5 のため）で動きます。どの手順にも時間の上限があり、止まったまま動かない手順は、そこで失敗になります。仕事ごとの上限（42 分・61 分・105 分）は、手順の上限の合計より長くしてあるので、そのときもログは残ります。

- **ブラウザで動かす 5 つの流れ**（`e2e/learner.spec.ts`。毎回、新しい学習者です）
  1. ログイン → レッスン（`vibe-coding/vibe-ch1`）の暗記カードで「覚えた」→ 保存の表示が「保存済み」→ 復習のページは「今日の復習はありません。」→ DB でカードを 2 日前に学んだことにして、期日を今日にする → 「覚えた」→ 今日の残りが 1 枚から 0 枚になり、サーバーに復習の記録が残ります。DB を変えるのは、この 1 か所だけです（`e2e/support/sql.ts`）。その前に、学んだ日を変えずに期日だけを今日にすると DB が断ること（23514）も確かめます。
  2. レッスン（`vibe-coding/vibe-ch0`）を最後まで読む → サーバーに XP 50 と「はじめてのレッスン完了」のバッジが付きます。
  3. レッスンを少し読み、カードに印を付けて復習に入れる → 「このレッスンを最初からやり直す」→ そのレッスンのカードが外れ、XP（10）は残ります。
  4. インターネットにつながらない状態でカードに印を付ける → ログアウトを押すと「まだ保存できていない学習があります」→「ログアウトしない」→ つながると保存され、そのあとはそのままログアウトできます。
  5. アカウントの削除（`ACCOUNT_DELETION_ENABLED=true` は CI のスタックだけです）。パスワードを入れ直して削除すると、その場でパスワードを確かめた新しいトークン（`amr`）で削除が通ります。削除の前にほかの端末でログインしたままのセッションは、断られます（`account_deleted`）。このブラウザのセッションは、削除のあとでログアウトするので、ログインの代わりが断ります（本物の Supabase と同じです）。

  5 つの流れは、1 つずつ順に動かします（同時には動かしません）。決まった時間だけ待つことはせず、サーバーと DB の記録が変わるまで待ちます。API の上限（1 つの接続元から 1 分に 200 回）に当たったとき（429）、学習者の API が 5xx を返したとき、ログインの代わりが知らない呼び出し（404）を受けたときは、失敗にします。日本時間の 0 時の 8 分前からは、0 時を過ぎるまで待ってから始めます（`Database checks` は 3 分前から）。日付は、すべてサーバーと DB から読みます。どの流れも AI を呼ばないので、AI を使う前の年齢の記録は要りません（年齢の確かめが止めるのは、AI の呼び出しだけです）。

- **ログインの代わり**（`e2e/support/auth-stand-in.mjs`）。`e2e-…@example.org` のメールと、決まったダミーのパスワードでログインできます。ログインのたびに、パスワードを確かめた時刻（`amr`）を入れたトークンを出します。ログアウトしたセッションのトークンは、本物の Supabase と同じように断ります（`session_not_found`）。署名の鍵は起動のたびに作り、どこにも保存しません。`RISEPATH_E2E_AUTH_STANDIN=1` がないと起動せず、`NODE_ENV=production` のときと Vercel の上でも起動しません。本番で動くイメージ（VM の `api` と `mcp`）には入りません（Dockerfile は決まったフォルダーだけをコピーします）。本番のコードからは読み込めません（`npm run lint:arch` で固定しています）。CI では、スタックと同じ Docker のネットワークに、コンテナとして置きます。ブラウザからは、このマシンの中（127.0.0.1）からだけ届きます。
- **CI の値**: `deploy/risepath-vm/ci/stack.ci.env` のダミーの値です。AI はオフ（鍵なし）、有料プランはオフ、規約のページの切り替えもオフ、origin gate（Vercel から来たリクエストだけに答えるしくみ）もオフです。Compose のプロジェクト名は `risepath-ci` です。
- **`deploy-stack.sh` の切り替え**: 環境変数 `RISEPATH_DEPLOY_SKIP_PULL=1` があるときだけ「git pull」を飛ばし、取り出してあるコミットをデプロイします（P3）。`stack.env` に書いても効きません。VM では設定しないので、何も変わりません。pull でスクリプトが新しくなったときにやり直す動きも、テストで固定しています。
- **直したもの**: `verify-account-deletion.mjs` の R11 は、本番と同じ `log_error_verbosity=terse` の DB では失敗していました（49 件のうち 1 件）。`SET log_error_verbosity = default` の `default` が、値ではなく「サーバーの設定に戻す」という意味になっていたためです。値を引用符で囲み、ログを決まった時間だけ待つのをやめて、2 つの記録がそろうまで読み直すようにしました。テストで固定しています。
- **手元で流す**

  ```bash
  npm run ci:db        # Database checks
  npm run ci:stack     # Server stack deploy（最後に片付けます）
  npm run e2e:local    # Learner end-to-end（最後に片付けます）
  ```

  - 要るもの: Docker（Compose v2.24 以上）、`npm ci` を済ませた Node 22、psql 16 以上（`ci:db`）、空きディスク 5 GB 以上（`ci:stack` と `e2e:local`。足りないと止まります）。Mac では、Homebrew の bash 4 以上（`deploy-stack.sh` が使うため）と、`timeout` のコマンド（Homebrew の coreutils。その gnubin のフォルダーを PATH に足します）も要ります。bash 3.2 では、`npm test` の `deploy-stack.sh` のテストは、理由を出して飛ばします。
  - ポートの 5432・3006・3100 を使います（`e2e:local` は 4173 と 54390 も、`ci:db` は 55432 だけ）。動いているあいだは、5432（DB の管理者。パスワードは、このリポジトリに書いてあるダミーです）、3006、3100 を、すべてのネットワークに開きます。信頼できるネットワークでだけ流します。
  - `deploy/risepath-vm/` に自分の `stack.env`・`billing.env`・`tunnel.env`・`mcp-public.env` があると、止まります（上書きしません）。そのときは、別の作業ツリー（`git worktree add`）で流します。`risepath` のスタックには触れません。
  - ブラウザは、一度だけ `npx playwright install chromium` で入れます。
  - 終わると、スタック、DB のボリューム、CI の `stack.env`、画面のビルド（`.artifacts/e2e/dist`）を消します。失敗したときのログと、スクリーンショットとトレースは、`.artifacts/ci/stack/logs` と `.artifacts/e2e/` に残ります。
  - 作ったイメージ（`risepath-ci-api`・`risepath-ci-mcp`）とビルドのキャッシュは、次の実行を速くするために残ります（約 4 GB）。空きが 5 GB を切って止まったときは、`docker image rm risepath-ci-api risepath-ci-mcp` のあと `docker builder prune` で空けます（`docker builder prune` は、ほかのビルドのキャッシュも消します）。
  - Docker が動かないマシンでは、`ci:stack` と `e2e:local` は流せません。プルリクエストの実行で確かめます。`ci:db` は、このマシンの使い捨ての PostgreSQL 16（pgvector 入り）に向けて流せます（`bash scripts/ci/db-checks.sh --existing-url postgresql://postgres@127.0.0.1:<ポート>`。URL にはユーザー名が要ります。空で、`-c log_error_verbosity=terse -c logging_collector=on` で起動したクラスタだけです）。
  - **ブラウザの流れだけを何度も直すとき**は、スタックを 1 回作ってから、`npm run e2e` を何度でも流します。終わったら `down` で片付けます。`down` は、スタック、DB のボリューム、CI の `stack.env`、ログインの代わり、画面のビルドを消します。また始めるときは、下の手順を `bash scripts/ci/stack.sh preflight e2e` から全部流し直します。

    ```bash
    bash scripts/ci/stack.sh preflight e2e
    bash scripts/ci/stack.sh install-env
    bash scripts/ci/stack.sh pull
    bash scripts/ci/stack.sh deploy 1
    bash scripts/ci/stack.sh auth
    bash scripts/ci/stack.sh build-front
    npm run e2e                       # 何度でも
    bash scripts/ci/stack.sh down     # 最後に
    ```

  - **イメージを作らずに流すとき**（Docker のないマシンでも流せます）: PostgreSQL 16 と pgvector を 127.0.0.1:5432 で、`stack.ci.env` のユーザー・パスワード・DB で動かします（そのユーザーが `vector` の拡張を作れること。Docker があれば、`db-checks.sh` と同じ pgvector のイメージを `-p 127.0.0.1:5432:5432` で起動するのが早いです）。そのあと、3 つのターミナル（のウィンドウ）で次を流します。ログインの代わりは、本番の設定（`NODE_ENV=production`）を読み込んだターミナルでは起動しないので、ターミナルを分けます。api（`node server.js`）は、`stack.ci.env` にない値を、この作業ツリーの `.env.local` から読み込みます。自分の `.env.local`（有料プラン、Stripe のテスト、Hermes、OpenRouter などの値）があると、CI とちがう設定で動きます。`.env.local` のない作業ツリー（`git worktree add`）で流すか、流すあいだだけ `.env.local` をよそに移します。この流れは、ブラウザの流れを確かめるだけです。Docker の組み立ては、プルリクエストの実行で確かめます。

    ```bash
    # ターミナル 1: ログインの代わり（127.0.0.1:54390）
    RISEPATH_E2E_AUTH_STANDIN=1 node e2e/support/auth-stand-in.mjs
    # ターミナル 2: CI の値で api を動かします（DB とログインの代わりは、このマシンのもの）
    set -a; source <(grep -E '^[A-Z][A-Z0-9_]*=' deploy/risepath-vm/ci/stack.ci.env | grep -v '^COMPOSE_'); set +a
    export DATABASE_URL_PHASE1="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
    export SUPABASE_URL=http://127.0.0.1:54390 PORT=3006
    npm run db:migrate && node server.js
    # ターミナル 3: 画面のビルドとブラウザの流れ
    bash scripts/ci/stack.sh build-front && npm run e2e
    ```

- **失敗したとき**: Actions の画面で赤いチェックを開き、最初の ❌ の行を見ます。Artifacts（7 日残ります）に、スクリーンショット、トレース（`npx playwright show-trace <trace.zip>` で開きます）、値を伏せたログがあります。よくある原因と、することは 11.5 です。

### 11.2 オーナーの作業

1. **3 つを必須のチェックにします**（P5）。**このプルリクエストを main にマージしたあとに**設定します。マージの前に設定すると、main に向けたほかのプルリクエストが止まります（main に `e2e.yml` がないので、3 つのチェックが来ないためです）。マージのあとは、main への push で 3 つが一度動くので、候補に出ます。
   1. GitHub のリポジトリで **Settings → Rules → Rulesets → New ruleset → New branch ruleset** を開きます。
   2. **Ruleset name** に `main: required checks` と入れ、**Enforcement status** を `Active` にします。
   3. **Target branches → Add target → Include default branch** を選びます（`main`）。
   4. **Require status checks to pass** に印を付けます。**Add checks** で、次の 3 つを名前のとおりに足します。提供元は、どれも **GitHub Actions** を選びます。
      - `Database checks`
      - `Server stack deploy`
      - `Learner end-to-end`

      今ある CI の 2 つ（`Typecheck, tests and lessons` と `Build and key-leak scan`）も、一緒に足すことをおすすめします。
   5. **Require branches to be up to date before merging** には、今は印を付けません。付けると、main が進むたびに、開いているプルリクエストを main に合わせて動かし直すことになります（1 回 10 分ほど）。main への push と毎晩の実行で、マージのあとの状態も確かめます。
   6. **Create** で保存します。このルールは、main への直接の push にも効きます（チェックが通っていないコミットは push できなくなります）。急ぎで直接 push する必要があるときのために、**Bypass list** に自分（Repository admin）を入れるかどうかを決めます。
   7. **ほかの開いているプルリクエスト**（2026-10-28 には 10 件）。main に向けた 5 件（#39〜#41、#45、#50）は、main を取り込むか push し直すまで、3 つのチェックが出ず、マージできません（「Expected — Waiting for status to be reported」）。プルリクエストの画面の **Update branch** を押すと、main を取り込んで、3 つが動きます。main と競合しているプルリクエストでは、競合を解くまで、チェックは動きません。ほかのブランチに重ねた 5 件（#43、#44、#48、#49、#51）は、このルールの外です。もとのプルリクエストがマージされ、そのブランチが消えると、GitHub が向け先を main に変えます（消さないときは、プルリクエストの画面の **Edit** で向け先を `main` にします）。そのあとで **Update branch** を押します。
   8. 試しのプルリクエストで、3 つが「Required」と出ることを確かめます。
   9. チェックの名前は、`e2e.yml` の `name:` と同じでなければなりません（ルールに足した `ci.yml` の 2 つは、`ci.yml` の `name:` と同じ）。名前を変えると、ルールが待つチェックが来なくなり、どのプルリクエストもマージできなくなります（「Expected — Waiting for status to be reported」）。名前は `server/tests/e2eWorkflow.test.js` で固定しています。変えるときは、ルールも同じ日に直します。
2. **最初の数回の結果を見ます**。各チェックの時間と、`Server stack deploy` と `Learner end-to-end` の「Disk use」のディスクの空き（少ないのは `Learner end-to-end` です）を見て、11.1 の見込みの時間を、測った値に直します（エージェントに頼めます）。
3. **作り直した VM の最初のデプロイの前に**（[`doc/guides/risepath_vm_deployment.md`](../guides/risepath_vm_deployment.md) §4.5 と [`deploy/vercel/README.md`](../../deploy/vercel/README.md) の手順 0）、デプロイする main のコミットで 3 つのチェックが緑であること、毎晩の実行も緑であることを確かめます。毎晩の実行を待たないときは、Actions の画面の左で `End-to-end checks` を選び、**Run workflow** を開いて、ブランチを `main` のまま **Run workflow** を押します（毎晩の実行と同じ 3 つが動きます）。CI が確かめないもの（11.3 の 1）は、VM で確かめます。VM で、`bootstrap-vm.sh` の 1 回目のあと（Docker が入り、`stack.env` を埋めたあと）、2 回目の前に、次のことも見ます。
   - `stack.env` の `SUPABASE_URL` が `https://<project>.supabase.co` であること（CI だけの `http://auth-stand-in:…` でないこと）。
   - VM の `docker version` と `docker compose version` を、`Server stack deploy` の「Preflight」の行（Docker・Compose・Storage driver）とくらべます。メジャー（29 と 5）がちがうときは、デプロイの前にエージェントと相談します（11.3 の 2）。
4. **VM では `RISEPATH_DEPLOY_SKIP_PULL` を設定しません。** `deploy/risepath-vm/ci/` のファイルも、VM の設定には使いません。
5. **毎晩の実行が赤のとき**: GitHub は、`e2e.yml` の `schedule` を最後に変えた人に、メールで知らせます。赤のままにせず、原因を直します（エージェントに調べてもらえます。11.5）。公開のリポジトリに 60 日動きがないと、GitHub は毎晩の実行を止めます（Actions の画面から再開できます）。

### 11.3 受け入れているリスク

1. **CI が確かめないもの**: 本物の Supabase（ログインの設定、「Require current password when updating」、メールの確認、OAuth、Site URL）、Cloudflare Tunnel（cloudflared とトンネルのトークン）、kokoro-tts、Hermes、Memanto、本物の AI の答え（CI では AI はオフです）、VM の作成（`provision-gce.sh`、`bootstrap-vm.sh`、Tailscale、swap）、`POSTGRES_PASSWORD` が DB の最初の起動で決まること、アップロードの保存、`deploy-stack.sh` の git pull と、HEAD が動いたときのやり直し（CI は飛ばします。テストで固定しています）。これらは、作り直した VM で確かめます（[`doc/guides/risepath_vm_deployment.md`](../guides/risepath_vm_deployment.md) §4.5 と、[`deploy/vercel/README.md`](../../deploy/vercel/README.md) の確認のチェックリスト）。origin gate（`ORIGIN_SECRET` と `TRUST_PROXY=1`）、`mcp-public`、2 回目のデプロイ、VM の起動のユニットも、CI では確かめません（11.4）。
2. **Docker の版**: VM は `install-docker.sh` で、そのときの最新の docker-ce と Compose を入れます（2026-10-27 には 29.9.2 と 5.6.1）。CI の ubuntu-26.04 は 29.4.2 と 5.1.3 です。メジャーは同じですが、細かい版はちがいます。11.2 の 3 でくらべます。VM の版を固定するかは、オーナーが決めます（11.4）。
3. **ログインの代わりは、Supabase そのものではありません。** supabase-js が新しい呼び出しを使い始めると、`Learner end-to-end` が赤になります（知らない呼び出しは 404 になり、テストが止まります）。そのときは、ログインの代わりに足します。トークンの更新（refresh）は、ブラウザのテストでは起きません（トークンは 1 時間有効で、1 つの流れは 3 分以内です）。更新のときに `amr` が残ることは、node のテストだけで確かめています。
4. **本番の値がまちがっていても、デプロイは緑になります**（形の正しい Supabase の URL、AI の鍵がないなど）。CI はダミーの値なので、これは見つけられません。
5. **固定していない部品**: api と mcp のイメージのもと（`node:22-slim`）、GitHub の Ubuntu のイメージ、Playwright が入れる Chromium、npm の中身は、日によって変わります。毎晩の実行で気づけるようにしました。VM も同じ `node:22-slim` を使います。
6. **たまに失敗するテスト**: 失敗しても、自動ではやり直しません（ダウンロードだけは 3 回まで試します）。スクリーンショット、トレース、ログを見て、原因を直します。テストを止めるときは、オーナーに確かめます。待ち時間を当てにする確かめはせず、サーバーと DB の状態が変わるまで待ちます。
7. **DB の確かめの待ち時間**: いくつかの確かめは、2 秒のロックの待ちを数えます。とても遅い CI では、まれに失敗するおそれがあります。それぞれの行に、待った時間（`waited … ms`）を出します。毎晩の実行で見て、くり返すときは、待つ時間の定数をレビューして広げます（11.5）。
8. **API の上限までの余り**: 5 つの流れで、1 分あまりのあいだに `/api` を 160 回ほど呼びます。上限は 1 分に 200 回です。手元の実行では、残りがいちばん少ないときで 29 回でした。流れを足すと、上限に当たるおそれがあります。そのときは、流れを分けるか、ページを読み込む回数を減らします（429 になると、テストがそう伝えます）。
9. **リポジトリを非公開にしたとき**: 今は公開リポジトリなので、標準の Ubuntu の実行環境は無料です。非公開にすると、1 回の push で約 11 分（2026-10-28 に測った値。3 つのチェックと、今ある CI の 2 つの合計）使い、無料の枠（月 2,000〜3,000 分）をすぐに使い切ります。実行環境も 2 vCPU・8 GB に小さくなります。そのときは、重い 2 つを main と毎晩だけにするかを決めます。
10. **Docker Hub のダウンロードの上限**: ログインせずにダウンロードすると、Docker Hub は、同じ IP からの回数が多いときに断ります（429）。そのときは、同じイメージを Google の写し（`mirror.gcr.io`）から取り、警告を出して続けます。pgvector はダイジェストで固定しているので、中身は同じです。`node:22-slim` は、数時間古いことがあります。それでも取れないときは、チェックが赤になります（「re-run the job later」と出ます）。少し待ってから、Actions の画面の **Re-run failed jobs** で動かし直します。

### 11.4 残っていること

- 時間とディスクは、2026-10-28 の最初の GitHub での実行で測りました（11.1 の表）。`Learner end-to-end` の「Disk use」は、空きが 80 GB でした（5 GB の下限より十分に多い）。実行環境が変わったときは、また見ます。
- `deploy-stack.sh` で、本番の `SUPABASE_URL` が `https://` でないときに止めること（P3 の外なので、オーナーが決めます）。
- VM の `install-docker.sh` で、docker-ce と Compose の版を固定するか（VM が変わるので、オーナーが決めます）。
- メールの確認がある新規登録、AI を使う前の年齢の記録、AI アプリ（リモート MCP）の復習のツールを、ブラウザや CI で確かめること。
- kokoro-tts のイメージのビルドを、週に 1 回の CI で確かめること。
- `deploy/supabase/custom_access_token_hook.sql` を CI の DB で流すこと。
- Docker のビルドのキャッシュ（新しい Action が要るため、今は入れていません）と、`node:22-slim` のダイジェストの固定（Dockerfile の変更で、VM も変わります）。
- `actions/checkout` などを次のメジャー版に上げること（`ci.yml` と一緒に）。
- `Server stack deploy` に足せる確かめ（今回は入れていません）: 公開のときの設定（`ORIGIN_SECRET` と `TRUST_PROXY=1`）での 3 回目のデプロイと、外からの 403、`mcp-public`（`byoa`）の起動とその DB の権限、2 回目のデプロイ、VM の起動のユニットと同じ止め方と起こし方。
- `.dockerignore` に `e2e` と `.artifacts` を足すこと（今もイメージには入りません。念のための変更です）と、使っていない `scripts/e2e-smoke.mjs` を消すこと。
- ブラウザの流れを作るときに見つけた、アプリの動き（もう 1 つの、オフラインのときの読み直しは、Phase 8 で直しました。12 章）: レッスンを開いてすぐは、進み具合の読み込み、図やコードの部品、文字の形が届くたびに、画面が少し動きます。押してから離すまでのあいだに動くと、ボタンが押されないことがまれにあります（テストは、画面が落ち着いてから押します）。

### 11.5 困ったときの手順（ランブック）

| こんなとき | すること |
|---|---|
| チェックが赤 | Actions の画面で、その仕事の最初の ❌ の手順を開きます。その手順が流した `scripts/ci/stack.sh` の段（`deploy 1`、`auth` など）が分かります。Artifacts のログ（値は伏せてあります）と、ブラウザの失敗はスクリーンショットとトレースを見ます。手元で同じ段を流せます（11.1 の「手元で流す」） |
| `Database checks` で、ロックの待ちの確かめが 1 つだけ赤（`waited … ms` が 1000 より小さい） | 遅い CI のゆらぎのことがあります。一度だけ **Re-run failed jobs** で動かし直します。また赤なら、3 つの確かめのスクリプトの待つ時間（`HOLD_MS` など）を広げる変更をレビューし、`npm run ci:db` で確かめます。動かし直しで緑になっても、毎晩の実行で続けて見ます |
| checkout、setup-node、`npm ci`、イメージやブラウザのダウンロードで赤 | GitHub やダウンロード先の一時的な問題のことがあります。少し待ってから、一度だけ動かし直します。くり返すときは、エージェントに調べてもらいます |
| `Learner end-to-end` が 429（rate limited）で赤 | 流れが API の上限に近づいています（11.3 の 8）。流れを分けるか、ページを読み込む回数を減らします。上限を上げたり、テストを止めたりはしません |
| `Learner end-to-end` が、ログインの代わりの 404 で赤 | supabase-js が新しい呼び出しを使い始めました（11.3 の 3）。ログインの代わり（`e2e/support/auth-stand-in.mjs`）にその呼び出しを足し、`server/tests/e2eAuthStandIn.test.js` にもテストを足します |
| 画面の言葉を変えたら `Learner end-to-end` が赤 | テストが探す言葉は `e2e/support/ui.mjs` と `components/review/reviewCopy.ts` にあります。同じコミットで直します |
| チェックの名前を変えたい | 11.2 の 1 の 9。`e2e.yml`、ルール、この章と手順書（`doc/guides/risepath_vm_deployment.md` §4.5、`deploy/risepath-vm/README.md`、`deploy/vercel/README.md` の手順 0）、`AGENTS.md` を同じ日に直します。`server/tests/e2eWorkflow.test.js` が、名前のずれを知らせます |
| 開いているプルリクエストが「Expected — Waiting for status to be reported」のまま | main に向けたプルリクエストなら、11.2 の 1 の 7 のとおり **Update branch** で main を取り込みます。ほかのブランチに向けたプルリクエストは、向け先が main になってから同じようにします。競合があれば、先に解きます。初めての人のフォークからのプルリクエストは、GitHub の標準の設定で、メンテナーが承認するまで動きません。変更（とくに `.github/` と `scripts/`）を見てから、プルリクエストの画面の **Approve workflows to run** を押すと、3 つが動きます |
| 「Preflight」で赤（`only … GB free`、ポートが使われている） | GitHub の実行環境が変わったことがあります。その行と、同じ仕事の「Disk use」の行を見て、エージェントに調べてもらいます。5 GB の下限は下げません。手元で止まったときは、前の実行のイメージとキャッシュが残っていることがあります（11.1 の「手元で流す」） |
| 日本時間の 0 時の近くで、チェックが数分待った（`00:00 JST` の知らせ） | 正しい動きです。途中で日付が変わると、日付の確かめがずれるので、0 時を過ぎてから始めます |

## 12. Phase 8: 公開の前の小さな残り（オフラインの読み直し、レッスンの XP、復習の枚数、暗い表示、同意の確かめ）

Phase 7 までに見つけて残していた、公開の前に直したい小さなことを直しました（2026-10-29 の作業ツリー）。オーナーが選んだ範囲は「公開前の小さな残り」の 7 つ（S1〜S7）で、ほかは変えていません。migration はありません。

この章では、次の言葉を使います。

- **部品**: ページを開いたあとに、要るときになってから読み込む、プログラムの一部です（図、コードの色分け、ページそのものなど）。

### 12.1 作ったもの

- **S1 オフラインのときの読み直し**: レッスンを開いてすぐにインターネットが切れ、部品を読めなかったとき、ページを読み直さなくなりました（前は読み直して、Rise Path の外の、ブラウザ自身のエラーの画面になっていました。11.4）。図やコードなど、ページの一部だけを読めなかったときは、レッスンの上のバーに「インターネットにつながっていないため、ページの一部を読み込めませんでした。…学習の記録は、この端末に残っています。」と出します（そのレッスンで読めなかったときだけです。全部読めたレッスンに移ると、出ません）。つながって、Rise Path のページのサーバーが答えたことを確かめると、「読み込み直す」のボタンを出します。自動では読み直しません（AI チューターとの会話や、入力の途中の文が消えないようにするためです）。お知らせは「閉じる」で消せます。お知らせが「インターネットにつながっていないため、…」のあいだは（閉じたあとも）、記録をこの端末に残すときのカード（「いまはサーバーにつながらないため、この端末に記録しています。…」）を出しません。同じことを言うカードが重なり、レッスンの題を隠していたためです（上のバーの保存のアイコンは、そのまま出ます）。お知らせの分だけバーが高くなるので、横の目次の位置、見出しに移ったときの位置、読んだブロックの数え方、続きから開く位置も、それに合わせます（高くなったバーの下に隠れたブロックは、読んだことにしません）。「読み込み直す」にフォーカスがあるときにまた切れて、ボタンがなくなったときは、フォーカスをページの本文に移します（ページやレッスンを読めなかったときの画面の「再読み込み」も同じで、そのときは見出しに移します）。ページそのものやレッスンを読めなかったとき（使えるものが画面にないとき）は、Rise Path の中で「インターネットにつながっていません」の画面（「Rise Path につながると、自動で読み込み直します。」と書いてあります）を出し、サーバーが答えたら自動で 1 回だけ読み直します。インターネットにはつながったのにサーバーが答えないときは、「Rise Path につながりません」と出し、5 秒ごとに確かめます（その画面には「再読み込み」のボタンがあります）。ホストやプロキシのエラーの画面（500 番台）が返ったときも、答えたことにはしません（読み直すと、そのエラーの画面になるためです）。つながっているときに部品を読めなかったとき（新しい版を出したあと）は、前と同じく、1 つの版につき 1 回だけ読み直します。オフラインの失敗と、つながるのを待っているあいだの失敗は、その 1 回を使いません（`components/common/chunkReload.ts`、`OfflineReloadNotice.tsx`、`ErrorBoundary.tsx`、`components/routes/LearnRoute.tsx`、`index.tsx`）。
- **S2 レッスンの終わりの XP**: レッスンを終えると、ふりかえりの「100% 完了」の次に「このレッスンを終えて +40 XP」が出ます。数は、サーバーの XP の台帳から読みます（`GET /api/v2/user/achievements` の新しい欄 `lessonXp`。レッスンを終えたときの 40 で、始めたときの 10 は入りません）。ブラウザでは数えません。記録がサーバーに届いて数えるまでは出ません。前に終えたレッスンを開き直したときや、やり直したときは、XP をもう一度はもらえないので（9 章の O2）、「このレッスンを終えたときにもらった XP：40」と出ます。この欄のない古い API では、何も出ません。XP を読みに行くのは、ログインして記録をアカウントに送っている学習者が終えたレッスンを開いたとき（終わりまで読まなくても）と、そのあと XP が届くまで、記録をサーバーに送るたび（2 秒あと、15 秒に 1 回まで）だけです。XP が届いたら、そのページではもう読みません（レッスンを終えるときは 2 回、開き直したときは 1 回です。10.3 の 16 の、教室の 1 分 200 回のためです。`components/lesson/LessonEnd.tsx`、`tools/core/achievements.js`）。
- **S3 メニューのボタンの枚数**: スマートフォンの画面の上のメニューのボタンに、今日の復習の枚数を小さく出します。読み上げは「メニューを開く（今日の復習 3 枚）」です。メニューを開いているあいだは出しません（開いたメニューの「復習」に枚数があります）。今日の分がないときと、復習が使えないときは、前と同じです（Phase 6 で見送ったものです。10.3 の 17、`components/common/Layout.tsx`）。
- **S4 暗い表示**: レッスンの上のバーを、暗い表示では透けないようにしました（明るい表示とセピアは、今までどおり少し透けます）。設定の「プライバシー」（`SettingsPrivacyView.tsx`）の色を、すべてデザイントークンにしました。文字の大きさ、角の丸み、並びは変えていません。明るい表示でも色が少し変わり、黄色の注意書きは、アイコンの付いた落ち着いた色の箱になりました。結果の 1 行にも、アイコンを付けました。「DELETE」と入れる 2 つの欄には、読み上げ用の名前と、「DELETE と入力してください」の説明を付けました。利用規約とプライバシーポリシーのページは、もとからトークンだけで、暗い表示でも問題がないことを確かめ、テストで固定しました。
- **S5 API とリモート MCP での同意の確かめ**: サーバーの切り替え `LEGAL_TERMS_REQUIRED` を足しました。**はじめは止まっています。** `true` にすると、今の利用規約に同意していない学習者は、API では 403 `terms_required`、リモートの MCP ではツール・リソース・プロンプトのエラー `terms_required`（「Rise Path を開いて、今の利用規約に同意してください」）になります。同意しなくても、利用規約を読むことと同意すること、保護者の AI の同意の取り消し、自分のレッスンの記録を送る・読む・消すこと（ログアウトの前の保存も）、設定のプライバシーの書き出しと削除、AI アプリの解除、プランの解約、アカウントの削除、AI の答えの報告はできます（`server/middleware/termsGate.js` の `TERMS_EXEMPT`。画面の `LEGAL_GATE_EXEMPT` と同じ考えです。ログインを確かめる道のうち、一覧にないものは、あとから足した道も断ります）。同意したあとは、すぐに使えます。サーバーの覚えを消し、断られていた XP と復習の枚数、ログインのときに読む前の形式のコースの進み・学習の記録・お知らせを、画面が 1 回だけ読み直します（切り替えを止めているときは、何も読み直しません）。本番で文が下書きのあいだは、`true` にしても効きません（同意を記録できないためです。起動のときに警告を出します）。リモートの MCP のロールは、同意を確かめるために、同意の記録のアカウント ID・版・日時を読みます（`sql/mcp_remote_role.sql`。Phase 8 で足した、ただ 1 つの権限です。AI アプリには渡しません）。
- **S6 レッスンの暗記カード**: 裏返したカードから次のカードに進むとき、次のカードの答えが一瞬（手元で測ると、画面の 3〜7 コマ）見えていました（Phase 6 では「前のカードの答え」と書いていましたが、裏返ったまま中身が次のカードに替わるので、見えていたのは次のカードの答えです）。復習のページと同じく、カードごとに裏返る部分を作り直すようにしました（`components/lesson/blocks/FlashcardsBlock.tsx`）。
- **S7 MCP の `learner-state-get`**: いつも 0 だった `streak` の欄をなくしました。学んだ日（`learning_days`）は、MCP のロールには読ませていないためです（権限は足していません）。ツールの説明にも、そう書きました。連続日数は、アプリの画面で見られます。

### 12.2 オーナーの作業

1. **デプロイ**: migration はありません。新しい画面は、古い API では XP の 1 行を出しません。`byoa` を使っているときも、切り替えを入れるまでは、DB ロールの SQL を流し直さなくてかまいません。
2. **同意の確かめを使い始めるとき**（弁護士の確認のあと。[../legal/README.md](../legal/README.md) の「ページを公開する手順」の 11）: (1) 規約を公開の版にし、Vercel で `VITE_FEATURE_LEGAL_PAGES=true` にして、同意のページが出ることを確かめます。(2) `byoa` を動かしているときは、`sql/mcp_remote_role.sql` を流し直します。(3) VM の `stack.env` と `mcp-public.env` に `LEGAL_TERMS_REQUIRED=true` を書き、`deploy-stack.sh` を実行し直します。(4) 同意していないテストのアカウントで、ダッシュボードに同意のページが出ることと、設定のプライバシー・アカウントの削除・AI アプリの解除・ログアウトが使えることを確かめます。止めるときは、サーバー → 画面の順です。画面だけ止めると、同意のページがないまま、学習者が断られます。切り替えを入れたまま、あらためて同意をお願いする版を出すときは、先に切り替えを止めます（[../legal/README.md](../legal/README.md) の「改定するとき」）。
3. **確かめます**: スマートフォンで、図とコードのあるレッスン（たとえば Claude Code の「第1回｜最初のタスクを任せる」）を開いてすぐに機内モードにし、Rise Path の外の、ブラウザ自身のエラーの画面にならないこと。図やコードを読めなかったときだけ、上のバーにお知らせが出て、つなぐと「読み込み直す」が出ること（読み終わっていたときは、何も出ません。それも正しい動きです）。レッスンを終えると「このレッスンを終えて +40 XP」が出ること。今日の復習があるとき、メニューのボタンに枚数が出ること。

### 12.3 受け入れているリスク

1. ブラウザが「つながっている」と言うのに、実際にはつながっていないとき（つながったように見える Wi-Fi など）に、はじめて部品を読めなかったときは、前と同じく、1 回読み直して、ブラウザ自身のエラーの画面になることがあります（待っているあいだの失敗では読み直しません）。
2. ページが表示できているときは、自動では読み直しません。「読み込み直す」を押すと、AI チューターとの会話と、まだ確定していない入力（チューターへの文、クイズの選択、プロンプトの欄）は消えます。学習の記録は端末に残り、続きの位置から開きます。自動で読み直すのは、エラーの画面とレッスンを読み込めなかった画面だけで、そこには消えるものがありません。
3. XP の 1 行は、記録がサーバーに届いたあと（手元では、終えてから 7 秒ほど）に出ます。オフラインのあいだは出ません。終えたレッスンを開くと、終わりまで読まなくても、XP を 1 回読みます（教室の 1 分 200 回の分を使います）。開いたときにもう XP があったとき（開き直し、別の端末で終えたとき、やり直し）は、「+」のない書き方になります。
4. メニューのボタンの枚数は、サイドバーと同じ数で、直るときも同じです（10.3 の 16）。すべての画面の上の部分が、枚数の分だけ変わります（10.3 の 17）。
5. 切り替えを入れたとき: ログインしていない方の AI（`LLM_GUEST_AI=true` のとき）と読み上げは止めません。AI の利用設定のページでは、同意するまで、年月の登録と保護者の同意の記録ができません（今は「今は登録できませんでした。少し待ってから、もう一度お試しください。」とだけ出ます。取り消しはできます）。同意の記録を読めないとき（DB のエラー）は、断る側にします（API は 503 `legal_unavailable`）。mcp-public は「同意していない」を 5 秒まで覚えます。学習者の JWT でつなぐ SSE の MCP は、確かめません。新しい版の画面が古いタブに残っているあいだ（版がずれているとき）は、同意のページが出ないまま断られることがあります（読み直すと出ます）。API を複数のプロセスで動かすと、同意したあとの数秒、別のプロセスが断ることがあります（今の VM は 1 つです）。ログインしたときは、同意のページが出るまでと出ているあいだに、画面が読みに行くもののうち 7 つほどが断られます。同意のページが出ているあいだは、そのあとも、タブに戻るたびと、ログインの自動の更新のたびに、前の形式のコースの進み・学習の記録・お知らせの 3 つがまた断られます。どれも教室の 1 分 200 回の分を使います。
6. CI のブラウザの確かめ（`Learner end-to-end`）には、Phase 8 の動きを足していません（5 つの流れは変えていません）。S1、S2、S5 は、node のテストと、手元のブラウザ（本番と同じビルド）で確かめました。

### 12.4 残っていること

- 弁護士の確認（API とリモートの MCP で止めること。断らない操作の一覧。[../legal/README.md](../legal/README.md) の「弁護士に確かめること（Phase 4）」）と、切り替えを入れるかどうか（オーナー）。
- 学習者の JWT でつなぐ SSE の MCP での同意の確かめ。断られたときに、同意のページへ案内すること（AI の利用設定のページを含め、今はその機能が使えないとだけ出ます）。
- ほかの設定のページ（設定のトップ、AI の記憶、声）の色のトークン化と暗い表示。設定の「プライバシー」の文字の大きさ・角の丸み・余白をデザインの決まりにそろえることと、結果のお知らせを押したボタンの近くに出して読み上げること。レッスンのスマートフォンの下のバー（暗い表示で少し透けます）。アプリ全体の暗い表示の設定（今はありません）。
- `learner-state-get` の `last_lesson`（いつも null）。
- 工数（見積もり・未検証）: 実際にかかった日数は測っていません【要確認】。

## 13. やらないこと

- 学習者の Claude や ChatGPT のログイン情報（パスワード、セッション、API キー）を集めたり預かったりすること。
- AI のモデルそのものを、そのまま売ること（転売）。
- 未成年が使える機能に Gemini を使うこと。
- 管理者用の MCP（`RISE_PATH_MCP_PROFILE=admin`）をインターネットに公開すること。
- 共有のブリッジトークン（`RISE_PATH_BRIDGE_TOKEN`）を外部のサービスに渡すこと。
- 18 歳未満の方に、有料プランを売ること。保護者が代わりに払う形も、作っていません（7 章）。

## 14. まだ分からないこと

- Haiku のチューターと作文フィードバックの質が十分か（試して確かめます）。
- Anthropic の利用ポリシーのページの「Effective Nov 12, 2026」が、これから有効になる版かどうか。2026-10-22 の調べでは、ページは 2026-11-12 から有効の版を最新として出し、2025-09-15 の版は「新しい版に置き換えられた」として保管されています（<https://www.anthropic.com/legal/aup>、<https://www.anthropic.com/legal/archive/22742366-2ef0-4c7a-a833-6523f10d3944>）。前もって公開された版で、2026-11-12 までは 2025-09-15 の版が効いている、と読めますが、推測です【要確認】。
- 未成年の安全対策の既定（4.3）を、運用してみて変えるかどうか。
- Supabase の OAuth で、外部の AI に渡すトークンだけ宛先（aud）を変えること。フック（`deploy/supabase/custom_access_token_hook.sql`）は作り、手元の Postgres で動きを確かめました。Supabase の実際の環境での確認はまだです（<https://supabase.com/docs/guides/auth/oauth-server/token-security>）。
- 工数と費用の数字（どれも見積もりと試算です）。
- 法律の確認（[../legal/README.md](../legal/README.md) の【要確認】）。
- 有料プランの法律と税の扱い（NPO が特定商取引法の事業者にあたるか、最終確認の画面、収益事業と消費税。7.2 の 5）。
