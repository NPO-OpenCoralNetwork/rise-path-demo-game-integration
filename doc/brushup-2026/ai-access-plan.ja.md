# 学習者が AI を使う方法の方針（決定記録）

- 日付: 2026-10-22
- 決めた人: オーナー（Phase 0 を承認）
- 状態: Phase 0 は実施中（この変更）。Phase 0.5 から先は計画です。
- 関連: [../legal/README.md](../legal/README.md)（プライバシーポリシーと利用規約の下書き）、[../legal/ai-data-inventory.ja.md](../legal/ai-data-inventory.ja.md)（データの送り先の一覧）

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

まとめ: Sonnet から Haiku に替えると、ふつうの使い方で費用はおよそ 20 分の 1 になります。答えの質は下がる可能性があるので、いくつかのレッスンで試して確かめます。質が足りないタスクは、コードを変えずに `LLM_TASK_<タスク名>=anthropic:<モデル ID>` で戻せます（例: `LLM_TASK_TUTOR_CHAT=anthropic:claude-sonnet-5-5`。`server/llm/models.config.js:106` と `:162-167`）。

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

## 3. Phase 0（この変更）

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
- 新しいタスク `course.generate`（`cheap`、`anthropic`、effort `low`、最大 32,000 トークン、ストリーム）を作り、コース生成の Gemini 直接呼び出しを置き換えました（`server/llm/models.config.js:99`、`server/services/aiGenerator.js:24`、`:150-164`）。プロンプトは JSON を 1 つだけ返すよう直しました（`server/services/aiPrompts.js`）。
- コース生成の失敗の扱いを、AI の窓口（ゲートウェイ）のエラーの種類で決めるようにしました。モデルが動く前の失敗なら、1 日の回数を返します（`server/routes/ai.js`）。

**共有 Hermes を出さない**

- 画面のスイッチ `VITE_FEATURE_AGENT_CHAT` がちょうど `"true"` のときだけ、共有 Hermes のチャット（右下の AI コーチと `/life-journal/chat`）を出します。既定は off です（`config/features.ts:50`、`App.tsx:273-278`、`App.tsx:375-377`）。
- サーバーも同じスイッチを読みます。ちょうど `"true"` でないと、`/api/v2/agent/chat` は 404 を返し、1 日の回数も数えません。前の設定のまま Hermes が動いている VM でも、学習者は共有 Hermes を使えません（`server/routes/agent.js`）。
- 用語の説明の「AI 先生に聞く」ボタン、ライフジャーナルとプロフィール画面のチャットへのボタンも、off のときは出しません（`components/common/GlossaryText.tsx`、`components/features/life-journal/`、`components/features/dashboard/profile/ProfileDiagnosisView.tsx`）。
- AI コーチのエラー表示から、設定名（`HERMES_API_KEY` など）を出さないようにしました（`services/agentApi.ts`）。
- VM の既定の構成を `COMPOSE_PROFILES=tts` にし、Hermes のコンテナを起動しないようにしました（`deploy/risepath-vm/stack.env.example:144`、`deploy/risepath-vm/scripts/deploy-stack.sh`）。

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
- サーバーの `/api/v2/agent/chat` は残っています。`VITE_FEATURE_AGENT_CHAT=true` にして Hermes を動かさない限り使えません（`server.js:157-158`、`server/routes/agent.js`）。
- 本番の MCP コンテナは管理者用の設定のままで、インターネットには出していません（`deploy/risepath-vm/docker-compose.yml:124`）。
- Memanto（AI メモリ）は既定で止まったままです（`deploy/risepath-vm/stack.env.example:172`）。
- 1 日の上限の値は変えていません（`server/middleware/dailyCaps.js:71-77`）。

### 3.3 オーナーの作業

- 本番の環境変数から `GEMINI_API_KEY` を消すか、`GEMINI_ALLOWED` を設定しないままにします。
- Vercel に `VITE_FEATURE_AGENT_CHAT` を設定しないままにします。
- いくつかのレッスンで、Haiku のチューターと作文フィードバックの質を確かめます。
- [../legal/README.md](../legal/README.md) の【要記入】を埋め、専門家に確認を頼みます。

## 4. Phase 0.5: 未成年のための安全対策

一般公開の前に行います。Anthropic のサポート記事「Responsible Use of Anthropic's Models: Guidelines for Organizations Serving Minors」（<https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors>）に沿います。

| やること | 中身 | 記事の項目 |
|---|---|---|
| 年齢の確認 | 登録時に生年月日か年齢区分を聞きます。18 歳未満は保護者の同意を必須にします | 年齢の確認 |
| 保護者の同意 | 決めた年齢以下（例: 15 歳以下）は保護者が登録し、同意します。個人情報保護委員会は、一般に 12〜15 歳以下の子どもは法定代理人などの同意が要るとしています（Q&A 1-62 <https://www.ppc.go.jp/all_faq_index/faq1-q1-62/>） | 法令の順守 |
| 内容のフィルター | AI への入力と AI の答えを確かめ、不適切な内容を止めます。子ども向けの指示文（システムプロンプト）を足します | 内容のモデレーション |
| 見守りと報告 | 止めた件数や報告を記録し、運用者が見られるようにします。利用者が「この答えはおかしい」と報告できるボタンを付けます | 見守りと報告 |
| AI であることの表示 | AI の答えの近くに「AI が作った答えです」と表示します | AI であることの開示（必須） |
| 使い方の案内 | 子どもと保護者向けに、AI の安全な使い方を短く説明します | 教育的な資料 |
| 公表 | 子どもの安全と個人情報の法律を守っていることを、サイトに書きます | 法令の順守の公表 |

工数: 見積もりはまだです【要確認】。年齢と同意の画面、フィルター、報告の記録が中心です。

## 5. Phase 1: 自分の AI をつなぐ（BYOA、大人向け）

BYOA は「Bring Your Own Agent（自分の AI を持ち込む）」の略です。学習者が自分の契約の AI で Rise Path を使うので、AI の費用は学習者の契約で払われます。

- **つなぎ方**: MCP の新しい標準の通信方式「Streamable HTTP」の入口（`POST /mcp`）を作ります。今の MCP サーバーは古い方式（SSE）だけです（`mcp-server/index.js:1038`、`:1159`、`:1185`）。
- **ログイン（OAuth）**: 学習者が自分のアカウントで「この AI に Rise Path の利用を許可する」操作をします。Supabase の OAuth 2.1 サーバー機能を使います。この機能は**ベータ版**で、全プランで使えます。別料金はありませんが、OAuth でログインした利用者も月間アクティブユーザー（MAU）に数えます。許可の画面は自分たちで作ります（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。
- **MCP の決まりごとへの対応**: MCP サーバーは「保護されたリソースのメタデータ」（RFC 9728）を出し、401 のときに `WWW-Authenticate` ヘッダーでその場所を知らせます。トークンが自分あてに発行されたものかを確かめ、ほかのトークンは受け付けません（<https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>）。今の 401 は JSON だけで、このヘッダーがありません（`mcp-server/index.js:1166`）。
- **アプリの API の守り**: 今の API は、Supabase が認めたトークンなら何でも受け付けます（`server/middleware/auth.js:131-141`）。外部の AI に渡したトークンで、アプリのすべての API（有料の AI 機能をふくむ）が使えないよう、区別して断ります。
- **学習者の範囲だけのツール**: 学習者用の新しい設定（`learner-remote`）を作り、本人のデータだけを扱うツールにします。生活記録や AI メモリなど、特に私的なデータは既定で出しません。
- **別の公開ホスト名**: 学習者用の MCP は、別のコンテナと別のホスト名（例: `mcp.<domain>`）で公開します。管理者用の MCP（`deploy/risepath-vm/docker-compose.yml:124`）は公開しません。
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
- Anthropic の利用ポリシーのページの「Effective Nov 12, 2026」が、これから有効になる版かどうか。
- Supabase の OAuth で、外部の AI に渡すトークンだけ宛先（aud）を変えること。ドキュメントでは、Custom Access Token Hook で `client_id` ごとに aud を変えられるとされています。実際の環境での確認はまだです（<https://supabase.com/docs/guides/auth/oauth-server/getting-started>）。
- 工数と費用の数字（どれも見積もりと試算です）。
- 法律の確認（[../legal/README.md](../legal/README.md) の【要確認】）。
