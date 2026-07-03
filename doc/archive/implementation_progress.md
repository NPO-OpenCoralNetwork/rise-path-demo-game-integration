# 実装進捗トラッカー

> 最終更新: 2026-06-24（Phase 19 完了・VM Memanto smoke・50GB ディスク）

## Phase 1: 基盤

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 1-1 | Supabase Auth 接続 | ✅ 完了 | `services/supabaseClient.ts`(新規), `context/AuthContext.tsx`(新規), `ExperienceLoginView.tsx`, `App.tsx` | Supabase Auth + モックフォールバック。VITE_SUPABASE_URL/KEY設定で有効化 |
| 1-2 | 学習進捗の永続化 | ✅ 完了 | `services/progressService.ts`(新規), `BlenderLessonView`, `BlenderCurriculum`, `PersonalAssessmentView`, `CourseGeneratorView`, `ProfileHistoryView` | localStorage永続化。ステップ完了・イベント履歴・進捗%すべて保存 |
| 1-3 | Sign Out 実装 | ✅ 完了 | `components/features/dashboard/ProfilePassport.tsx` | AuthContext.logout()に接続、ユーザーデータも動的表示 |

## Phase 2: コア体験の補完

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 2-1 | Blender Stage 3〜5 アンロック | ✅ 完了 | `components/features/blender/BlenderPathView.tsx` | Stage1=completed, Stage2=current, Stage3-4=available |
| 2-2 | Art 標準レッスンビュー | ✅ 完了 | `components/features/art/ArtCurriculumView.tsx` | 全アンロック済チャプター → ART_PERIOD_DETAIL にナビゲート |
| 2-3 | LessonView 動的化 | ✅ 完了 | `components/common/LessonView.tsx`, `services/curriculumData.ts` | courseId対応。6コース分のレッスンデータ追加 |

## Phase 3: 見栄え・信頼感

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 3-1 | プロフィール履歴 DB連動 | ✅ 完了 | `components/features/dashboard/profile/ProfileHistoryView.tsx` | ハードコード → progressService のイベントログから動的表示 |
| 3-2 | MyContent モックデータ除去 | ✅ 完了 | `components/features/dashboard/MyContent.tsx` | MOCK_CONTENT → 空配列。生成コースのみ表示 |
| 3-3 | Sonic Lab モジュール導線 | ✅ 完了 | `components/features/sonic/SonicLabView.tsx`, `App.tsx` | 全モジュールカード → SonicSynth にナビゲート |

## Phase 4: ビジネス機能

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 4-1 | 課金/サブスクリプション | ✅ 完了 | `components/features/dashboard/SubscriptionView.tsx`(新規) | プラン比較UI（Free/Pro/Premium）。Stripe連携は未実装（Coming Soon表示） |
| 4-2 | 通知システム | ✅ 完了 | `services/notificationService.ts`(新規), `components/features/dashboard/NotificationsView.tsx`(新規) | localStorage永続化。デモ通知自動生成。既読管理 |
| 4-3 | Edit Profile 画面 | ✅ 完了 | `components/features/dashboard/profile/ProfileEditView.tsx`(新規), `context/AuthContext.tsx` | 名前・アバター変更。AuthContext.updateProfile追加 |
| 4-4 | バッジ実績連動 | ✅ 完了 | `components/features/dashboard/profile/ProfileBadgesView.tsx` | progressServiceの実績データに基づき動的に表示 |

---

## 変更ログ

| 日付 | 内容 |
|------|------|
| 2026-03-09 | 初版作成。全項目を洗い出し |
| 2026-03-09 | Phase 1-1, 1-3 完了。AuthContext, supabaseClient作成。Login/Logout接続 |
| 2026-03-09 | Phase 2-1, 2-2, 3-2, 3-3 完了。Blenderアンロック、Artナビ、MyContentモック除去、Sonicモジュール導線 |
| 2026-03-09 | Phase 1-2, 3-1 完了。progressService作成。Blenderレッスン/カリキュラム・診断・コース生成の進捗永続化。履歴ビュー動的化 |
| 2026-03-09 | Phase 2-3, 4-4 完了。LessonView動的化（6コース分レッスンデータ）、バッジ実績連動 |
| 2026-03-09 | Phase 4-1, 4-2, 4-3 完了。サブスクUI・通知システム・プロフィール編集。全13項目完了 |

## Phase 5: 本番化

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 5-1 | DB スキーマ | ✅ 完了 | `server/migrations/001_production_tables.sql` | user_profiles, user_progress, learning_events, notifications テーブル |
| 5-2 | ユーザーデータAPI | ✅ 完了 | `server/routes/user.js`, `server.js` | プロフィール・進捗・イベント・通知のCRUD API |
| 5-3 | APIクライアント | ✅ 完了 | `services/apiClient.ts` | 認証ヘッダー自動付与、一元管理 |
| 5-4 | progressService API対応 | ✅ 完了 | `services/progressService.ts` | localStorage + API sync（fire-and-forget）。起動時hydrate |
| 5-5 | notificationService API対応 | ✅ 完了 | `services/notificationService.ts` | 同上 |
| 5-6 | AuthContext 本番化 | ✅ 完了 | `context/AuthContext.tsx` | ログイン時にDB hydration。API auth provider注入 |
| 5-7 | デモモード環境変数化 | ✅ 完了 | `services/curriculumApi.ts`, `.env.example` | VITE_DEMO_MODE=false で本番DB読み出し |
| 5-8 | Gemini APIバックエンド統一 | 🔄 方針変更 | `mcp-server/` | **Phase 6 に統合**: MCP Server 経由でツール公開に方針変更 |
| 5-9 | デプロイ設定 | 🟡 進行中 | `vercel.json`, `deploy/vercel/`, `scripts/deploy-from-mac.sh` | VM API + Vercel フロント雛形。本番 URL は Tailscale API 向け |

---

| 日付 | 内容 |
|------|------|
| 2026-03-09 | Phase 5 開始。DBスキーマ・API・フロントエンドサービス層を本番対応に移行 |

## Phase 6: MCP + Skills アーキテクチャ移行

> 仕様書: [`doc/architecture_v2_mcp_skills.md`](./architecture_v2_mcp_skills.md)
> 設計思想: LangGraph マルチエージェントを廃止し、MCP Server + SKILL.md + YAML 宣言型エージェントに移行

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 6-1 | MCP Server スキャフォールド | ✅ 完了 | `mcp-server/index.js` | `@modelcontextprotocol/sdk` + stdio/SSE dual transport |
| 6-2 | learner-state Tool | ✅ 完了 | `tools/core/learnerState.js` | get/update 2アクション |
| 6-3 | rag-search Tool | ✅ 完了 | `tools/core/ragSearch.js` | pgvector + graceful fallback |
| 6-4 | journal Tool | ✅ 完了 | `tools/core/journal.js` | log/summary/recent 3アクション |
| 6-5 | curriculum-generator Tool | ✅ 完了 | `tools/core/curriculum.js` | get-generation-kit, validate-intake, save-curriculum-draft 3ツール |
| 6-6 | MCP Resources 定義 | ✅ 完了 | `mcp-server/index.js` | content://domains + learner://profile/{user_id} 2リソース |
| 6-7 | SKILL.md 作成 (4スキル) | ✅ 完了 | `skills/` | curriculum-generator, learning-coach, progress-tracker, content-search + references |
| 6-8 | YAML エージェント定義 | ✅ 完了 | `agents/rise-path-tutor.yaml` | ペルソナ「ルミナ」定義 |
| 6-9 | ChatGPT MCP 連携テスト | ✅ ngrok検証済 | `mcp-server/index.js` | SSEマルチクライアント対応。ngrok経由でSSEストリーミング確認済 |
| 6-10 | Claude Desktop 連携テスト | 🟡 設定+stdio検証済 | `claude_desktop_config.json` | 設定配置+stdio initレスポンス確認済 |
| 6-11 | LangGraph 依存撤去 | ✅ 完了 | `package.json`, `server/routes/ai.js` | 5パッケージ削除, -873行, graph/削除, ai.js→410 stub |
| 6-12 | FloatingChatbot 簡素化 | ✅ 完了 | `FloatingChatbot.tsx` | 元々Gemini SDK直接利用。未使用import削除 |
| 6-13 | MCP セッションログ | ✅ 完了 | `004_mcp_sessions.sql`, `mcp-server/index.js` | 監査テーブル + 全9ツールにロギング統合 |

---

| 日付 | 内容 |
|------|------|
| 2026-04-30 | Phase 6 計画策定。MCP + Skills + YAML アーキテクチャ仕様書作成 |
| 2026-04-30 | Phase 6-1〜6-4 完了。MCP Server scaffold + tools/core/ 共有ロジック層 |
| 2026-04-30 | P0/P1修正3回: ragSearch→material_chunks, SSEセッション管理, mastery動的化, エラー分類, domains.js統合 |
| 2026-04-30 | MCP Resource API修正 (SDK署名変更対応)。Claude Desktop config配置完了 |
| 2026-04-30 | Phase 6-5 curriculum 3ツール, 6-6 learner-profileリソース, 6-11 LangGraph撤去(-873行) |
| 2026-04-30 | Phase 6-13 セッションログ + P3修正(journal/ragSearch/curriculum) |
| 2026-04-30 | classifyDbError共通化 (tools/core/dbErrors.js) |
| 2026-05-01 | P0修正: createMcpServer()ファクトリ化 (SSEマルチクライアント対応) |
| 2026-05-01 | 6-9 SSEローカルテスト完了 (2クライアント同時接続確認)。6-10 stdioテスト完了 |

## Phase 7: 認証・認可 (Supabase JWT)

> 仕様書: [`doc/phase7_auth_spec.md`](./phase7_auth_spec.md)
> 設計思想: Supabase JWT を唯一の信頼源とし、Express + MCP SSE の両方で検証

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 7-1 | JWT 検証ミドルウェア | ✅ 完了 | `server/middleware/auth.js` | requireAuth + optionalAuth + getSupabase() |
| 7-2 | Express ルートにミドルウェア適用 | ✅ 完了 | `server.js` | user/content ルートに適用。chatgptは除外 |
| 7-3 | user.js の requireUser 削除 | ✅ 完了 | `server/routes/user.js` | x-user-id → req.userId (auth.js 経由) |
| 7-4 | MCP SSE に resolveUserId 追加 | ✅ 完了 | `mcp-server/index.js` | auth.js再利用、session={transport,userId} |
| 7-5 | .env.example 更新 | ✅ 完了 | `.env.example` | SUPABASE_SERVICE_ROLE_KEY + PHASE1_USER_ID 追加 |
| 7-6 | content.js の PHASE1_USER_ID 置換 | ✅ 完了 | `server/routes/content.js` | 5箇所→req.userId |
| 7-7 | E2E テスト | ✅ 完了 | — | dev mode全ルート通過確認済 |
| 7-8 | apiClient.ts を Bearer JWT 送信に移行 | ✅ 完了 | `services/apiClient.ts` | Supabase JWT + x-user-id fallback |
| 7-9 | chatgptCurriculum.js PHASE1_USER_ID → req.userId | ✅ 完了 | `server/routes/chatgptCurriculum.js` | 14箇所の置換 |
| 7-10 | Bridge/JWT 複合認証 | ✅ 完了 | `server/routes/chatgptCurriculum.js` | requireBridgeOrAuth (4段階優先順位) |
| 7-11 | ensurePhase1User() 削除 | ✅ 完了 | content.js (3), chatgptCurriculum.js (4) | 全7箇所削除 |
| 7-12 | content.js IDOR 修正 | ✅ 完了 | `server/routes/content.js` | GET /curricula/:id に user_id スコープ追加 |

## Phase 8: MCP userId 伝播 & API 保護

> 仕様書: [`doc/phase8_spec.md`](./phase8_spec.md)

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 8-1 | resolveToolUserId() ヘルパー | ✅ 完了 | `mcp-server/index.js` | extra.sessionId で認証済み userId を解決 |
| 8-2 | 全7ツールに extra 引数追加 | ✅ 完了 | `mcp-server/index.js` | SSE → JWT userId / stdio → args fallback |
| 8-3 | user_id パラメータ説明更新 | ✅ 完了 | `mcp-server/index.js` | 'SSEモードでは無視されます' |
| 8-5 | express-rate-limit 導入 | ✅ 完了 | `package.json` | 依存追加 |
| 8-6 | Global API rate limit | ✅ 完了 | `server.js` | 200/min/IP (dev: 1000) |
| 8-7 | AI Heavy rate limit | ✅ 完了 | `server.js` | 10/min/userId (dev: 100) |
| 8-8 | MCP SSE rate limit | ✅ 完了 | `mcp-server/index.js` | 30/min/sessionId (dev: 300) |
| 8-9 | 認証ログ強化 | ✅ 完了 | `server.js` | authMethod + 応答時間 + ステータスコード |

## Phase 9: MCP Server 外部公開

> 仕様書: [`doc/phase9_deployment_spec.md`](./phase9_deployment_spec.md)
> 設計思想: SSE Server をインターネットに公開し、ChatGPT Apps & Connectors から接続可能にする

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 9-1 | cloudflared インストール | ✅ 完了 | — | v2026.3.0 (brew) |
| 9-2 | SSE anti-buffering 実装 | ✅ 完了 | `mcp-server/index.js` | setNoDelay + write-flush パッチ |
| 9-3 | ngrok SSE 外部テスト | ✅ 完了 | — | `event: endpoint` 即時ストリーミング確認 |
| 9-4 | ChatGPT Apps & Connectors 登録 | ⬜ 未着手 | — | ngrok URL + Bridge Token で登録 |
| 9-5 | ChatGPT ツール実行テスト | ⬜ 未着手 | — | 全9ツール動作確認 |
| 9-6 | Named Tunnel 設定 (本番) | ⬜ 未着手 | `~/.cloudflared/config.yml` | ドメイン取得後に実施 |
| 9-7 | pm2 永続化 | ⬜ 未着手 | — | MCP Server デーモン化 |

---

| 日付 | 内容 |
|------|------|
| 2026-05-01 | Phase 9 開始。cloudflared確認、SSE anti-buffering実装 |
| 2026-05-01 | Quick Tunnelテスト（SSEバッファリング問題発見）→ ngrokに切替 |
| 2026-05-01 | ngrok経由SSEストリーミング確認。ブランチ整理完了（main統合）|

## Phase 10: MCP Server 運用強化

> 仕様書: [`doc/phase10_operations_spec.md`](./phase10_operations_spec.md)
> 設計思想: 本番稼働に耐える可用性・信頼性・セキュリティの確保

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 10-1 | `GET /health` エンドポイント | ✅ 完了 | `mcp-server/index.js` | status/uptime/sessions/db 返却 |
| 10-2 | Graceful shutdown (SIGTERM/SIGINT) | ✅ 完了 | `mcp-server/index.js` | セッション→HTTP→DB 順序閉じ、10s タイムアウト |
| 10-3 | `/sse` シャットダウン拒否 (503) | ✅ 完了 | `mcp-server/index.js` | `isShuttingDown` フラグ |
| 10-4 | POST `/messages` Bearer Token 照合 | ✅ 完了 | `mcp-server/index.js` | セッション所有者照合（userId mismatch → 403） |
| 10-5 | health.test.js | ✅ 完了 | `mcp-server/tests/health.test.js` | 7テスト（health/CORS/404） |
| 10-6 | protocol.test.js (E2E) | ⬜ 未着手 | `mcp-server/tests/` | P2 |
| 10-7 | モジュール分割 | ⬜ 未着手 | `mcp-server/` | P2 |
| 10-8 | CORS 設定 | ✅ 完了 | `mcp-server/index.js` | MCP_CORS_ORIGINS env, dev=permissive |

---

| 日付 | 内容 |
|------|------|
| 2026-05-01 | Phase 10 仕様策定。P0: ヘルスチェック + graceful shutdown 実装・テスト完了 |

## Phase 11: MCP Security 堅牢化

> 仕様書: [`doc/architecture_v3.md`](./architecture_v3.md)
> 設計思想: 最小権限原則。profile-based tool filtering + policy enforcement

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 11-1 | tool-registry.json | ✅ 完了 | `mcp-server/tool-registry.json` | 全10ツールの risk/category/exposure 管理 |
| 11-2 | profileFilter.js | ✅ 完了 | `mcp-server/profileFilter.js` | `--profile` 引数 + `isToolAllowed()` |
| 11-3 | policy.js | ✅ 完了 | `mcp-server/policy.js` | レート制限 + audit log + policyTool ラッパー |
| 11-4 | index.js policyTool 切替 | ✅ 完了 | `mcp-server/index.js` | 全ツールを policyTool 経由に |
| 11-5 | annotations 付与 | ✅ 完了 | `mcp-server/tool-registry.json` | readOnlyHint/destructiveHint 全ツール |

---

| 日付 | 内容 |
|------|------|
| 2026-05-01 | Phase 11 全項目完了。learner=6ツール, admin=10ツール |

## Phase 12: 学習フィードバック動的適応

> 仕様書: [`doc/phase12_adaptive_feedback_spec.md`](./phase12_adaptive_feedback_spec.md)
> 設計思想: config-driven ルールエンジン + 信頼度/鮮度スコア

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 12-1 | adaptation_config.json | ✅ 完了 | `server/services/adaptation_config.json` | 6ルール定義 (field/op/value) |
| 12-2 | analyzeJournalPatterns() | ✅ 完了 | `server/services/journalService.js` | streak/trend/confidence_score/staleness |
| 12-3 | deriveAdaptationSignals() | ✅ 完了 | `server/services/personalizationDeriver.js` | config-driven + stale 抑制 + 競合解決 |
| 12-4 | getAdaptationSignals() | ✅ 完了 | `tools/core/journal.js` | DB → 分析 → シグナル パイプライン |
| 12-5 | MCP learner-adaptation-signals | ✅ 完了 | `mcp-server/index.js` | learner/coach/admin に公開 |
| 12-6 | GET /api/v2/adaptation | ✅ 完了 | `server/routes/chatgptCurriculum.js` | Web API |
| 12-7 | get-generation-kit 自動注入 | ✅ 完了 | `tools/core/curriculum.js` | userId → adaptation を Kit に付加 |
| 12-8 | ユニットテスト 28件 | ✅ 完了 | `server/tests/adaptation.test.js` | 全通過 |
| 12-9 | adaptation_signals テーブル | ⏸️ N≥10 後 | — | Stage 2 |
| 12-10 | AdaptationNotice UI | ⏸️ レッスン稼働後 | — | Stage 3 |
| 12.5-1 | プロファイル → Kit 自動注入 | ✅ 完了 | `tools/core/curriculum.js` | loadLearnerProfile + Promise.all 並列取得 |
| 12.5-2 | suggestLearningMode | ✅ 完了 | `tools/core/curriculum.js` | gentle > credential > problem_solving > practice |
| 12.5-3 | マージ優先順位 | ✅ 完了 | `tools/core/curriculum.js` | adaptation > profile > defaults |

---

| 日付 | 内容 |
|------|------|
| 2026-05-01 | Phase 12 Stage 1 完了。8コミット。78テスト全通過 |
| 2026-05-01 | Phase 12.5 完了。プロファイル自動注入 + 推奨モード。93テスト |

## Phase 15: 実プロダクト移行 / Production Readiness

> 仕様書: [`doc/prod_readiness_plan.md`](./prod_readiness_plan.md)  
> 目的: デモモードから実DB・実認証・本番デプロイ前提の運用可能なプロダクトへ移行する。

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 15-1 | Production env / Supabase / DB 接続 | ✅ 完了 | `.env.local`, `scripts/verify-env.mjs`, `scripts/smoke-prod.mjs`, `server/routes/health.js`, `server/services/runtimeHealth.js` | `env:check --db --auth` + `GET /api/v2/health` + migration 9/9。`npm run smoke:prod` |
| 15-2 | DB migration 一本化 | ✅ 完了 | `server/migrations/000`〜`008`, `scripts/db-migrate.mjs` | curricula 統合、`auth.users` スタブ、MCP FK 修正、`npm run db:migrate` |
| 15-3 | TypeScript full check 修正 | ✅ 完了 | `types.ts`, `tsconfig.json`, 各コンポーネント | `npx tsc --noEmit` パス（311→0 件） |
| 15-4 | Auth fallback / Guest mode 整理 | ✅ 完了 | `authPolicy.js/ts`, `auth.js`, `bridgeAuth.js`, `AuthContext.tsx`, `ExperienceLoginView.tsx`, `apiClient.ts`, MCP | `VITE_DEMO_MODE=false` で strict auth。guest/mock/dev-fallback 無効化 |
| 15-5 | Dependency security 対応 | ✅ 完了 | `package.json`, `package-lock.json` | `npm audit fix` + overrides（uuid, request→@cypress/request）。`npm run audit:prod` → 0 |
| 15-6 | Production deploy / ops | ✅ 完了 | `deploy/risepath-vm/`, `scripts/smoke-vm-stack.mjs`, `deploy-stack.sh` | healthcheck、本番 Hermes config、`smoke:vm`、`deploy-from-mac.sh`。VM: db/api/mcp/memanto 稼働済み |
| 15-7 | Tailwind / bundle optimization | ✅ 完了 | `index.html`, `index.css`, `vite.config.ts`, `components/routes/lazyRoutes.tsx`, `services/geminiApiKey.ts` | Tailwind v4 ビルド。lazy routes。初回 preload から mermaid/phaser/scratch-blocks/genai を除外（recharts+core のみ） |

---

| 日付 | 内容 |
|------|------|
| 2026-06-22 | Phase 15 開始。実プロダクト移行計画を `doc/prod_readiness_plan.md` に整理 |
| 2026-06-23 | Phase 15-2 完了。migration 000〜008 一本化、`db-migrate.mjs`、`ensureAuthUser`、ドキュメント同期 |
| 2026-06-23 | auth.users スタブ同期を bridgeAuth / MCP SSE / stdio（resolveMcpUserId）に統一。architecture_v3 §3.2 図追記 |
| 2026-06-23 | `risepath-vm` 専用 Docker スタック方針を `doc/risepath_vm_deployment.md` に確定。nexloom-gce 拡張は見送り |
| 2026-06-24 | Phase 15-3 完了。`LocalizedText` union、import パス修正、Nexloom 型拡張、`tsc --noEmit` ゼロエラー |
| 2026-06-24 | Phase 15-1 完了。`GET /api/v2/health`、起動診断、`smoke:prod`、`env:check --health`。Supabase+risepath-vm DB 接続確認済み |
| 2026-06-24 | Phase 15-4 完了。`authPolicy` 共有モジュール、strict auth（`VITE_DEMO_MODE=false`）、ゲスト UI 非表示、MCP fallback 同期 |
| 2026-06-24 | Phase 15-6 完了。Compose healthcheck、`deploy-stack.sh`、`smoke:vm`、本番 Hermes SSE config |
| 2026-06-24 | Phase 15-5 完了。`npm audit fix`（high 12→0）、overrides 更新、`npm run audit:prod` 追加 |
| 2026-06-24 | Phase 15-7 完了。Tailwind v4 ビルド、lazy routes。レビュー追従: manualChunks 見直し、geminiApiKey 分離、初回 preload 約 8MB→約 1.4MB |

## Phase 16: 診断 × ダイアリー × 生活習慣分析

> 仕様書: [`doc/phase16_life_journal_analytics_spec.md`](./phase16_life_journal_analytics_spec.md)  
> 目的: AI学習診断・日次ダイアリー・睡眠/食事/運動などの生活習慣ログを統合し、月間グラフ・相関分析・LLMチャットで学習習慣の改善提案を行う。

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 16-1 | [日次ダイアリー/生活習慣 DB + API](https://github.com/t012093/rise-path-demo-game-Integration-/issues/23) | ✅ 完了 | `server/migrations/006_life_journal.sql`, `server/routes/lifeJournal.js`, `server/services/lifeJournalService.js`, `services/lifeJournalApi.ts` | PATCH upsert、TZ学習集計、366日range、デモfallback。RLSはVMでは未使用（Express JWT） |
| 16-2 | [Life Journal 入力UI](https://github.com/t012093/rise-path-demo-game-Integration-/issues/24) | ✅ 完了 | `components/features/life-journal/LifeJournalView.tsx` | 3項目オンボーディング + 7回保存で詳細解放、昨日コピー、en/jp |
| 16-3 | [月間グラフダッシュボード](https://github.com/t012093/rise-path-demo-game-Integration-/issues/25) | ✅ 完了 | `LifeJournalMonthlyView.tsx`, `lifeJournalMetrics.ts` | Line/Area/Bar/Scatter、90日streak、stress追加 |
| 16-4 | [決定論的な相関/パターン分析](https://github.com/t012093/rise-path-demo-game-Integration-/issues/26) | ✅ 完了 | `tools/core/lifeJournalAnalysis.js`, `LifeJournalInsightsView.tsx`, `adaptation_config.json` | Pearson相関・パターン検出・life_habit_rules・GET /analysis |
| 16-5 | ルールベース週次サマリ | ✅ 完了 | `lifeJournalWeekly.js`, `LifeJournalWeeklyWidget.tsx`, `POST /advice` | 記録率・睡眠・top advice、MissionControl ウィジェット、インサイト週次切替 |
| 16-6a | MCP `daily-life-*` ツール登録 | ✅ 完了 | `mcp-server/index.js`, `tools/core/lifeJournal.js`, `tool-registry.json` | 5ツール + `getChatContext`（146 tests pass） |
| 16-6b | `life-habit-analyst` Skill | ✅ 仕様済 | `skills/life-habit-analyst/SKILL.md` | 振る舞い・安全ガード定義 |
| 16-6c | Hermes 設定テンプレート | ✅ 仕様済 | `hermes/config.example.yaml`, `hermes/README.md` | rise-path プロファイル |
| 16-6d | [Agent プロキシ](https://github.com/t012093/rise-path-demo-game-Integration-/issues/27) | ✅ 完了 | `server/routes/agent.js`, `hermesAgentService.js` | `POST /api/v2/agent/chat` + `GET /agent/health`、SSE stream 対応 |
| 16-6e | Life Journal チャット UI | ✅ 完了 | `LifeJournalChatView.tsx`, `FloatingChatbot.tsx` | `/life-journal/chat` + `life-habit-analyst`；FloatingChatbot → `learning-coach`（Hermes プロキシ） |
| 16-6e-R | 16-6e レビュー修正 | ✅ 完了 | `FloatingChatbot.tsx`, `LifeJournalChatView.tsx`, `agentApi.ts`, `hermesAgentService.js` | §8.8: ストリーム UI・二重送信・`ui_language`・`mapAgentChatError` |
| 16-6f | chat-context 診断注入 | ✅ 完了 | `tools/core/lifeJournal.js` | `getChatContext` が `learner_profiles` を `assessment_profile` に注入 |
| 16-6g | [診断結果との統合](https://github.com/t012093/rise-path-demo-game-Integration-/issues/28) | ✅ 完了 | `personalizationDeriver.js`, `curriculum.js` | `habit_signals` → `getKit` / generation-kit |
| 16-6h | ProfileDiagnosisView → `learner_profiles` | ✅ 完了 | `learnerProfileService.ts`, `ProfileDiagnosisView.tsx` | API 優先 + localStorage フォールバック + データソース表示 |
| 16-7 | [Privacy / export / delete](https://github.com/t012093/rise-path-demo-game-Integration-/issues/29) | ✅ 完了 | `lifeJournalPrivacyService.js`, `SettingsPrivacyView.tsx`, `lifeJournal.js`, `agent.js` | §12.2: opt-in・export・delete・403 強制 |

---

| 日付 | 内容 |
|------|------|
| 2026-06-22 | Phase 16 仕様案を `doc/phase16_life_journal_analytics_spec.md` に整理 |
| 2026-06-22 | Phase 16-1〜16-3 実装完了。仕様書を実装に同期（7回保存、サービス層TZ集計、Done定義更新） |
| 2026-06-22 | Phase 16-4 完了。決定論的分析 API + インサイト UI + life_habit_rules（136 tests pass） |
| 2026-06-22 | Phase 16-5 完了。POST /advice + MissionControl 週次ウィジェット + インサイト週次切替 |
| 2026-06-22 | LLM ハーネス v3 策定。Hermes Agent + MCP + Skills。`doc/architecture_v3_hermes_agent.md`、Phase 16-6 仕様更新 |
| 2026-06-22 | Phase 16-6a 完了。MCP daily-life-* 5ツール + chat-context（16-6f 診断注入含む）。146 tests pass |
| 2026-06-22 | Phase 16-6d 完了。Express → Hermes プロキシ（157 tests pass） |
| 2026-06-24 | Phase 16-6e 完了。LifeJournalChatView + FloatingChatbot を `POST /api/v2/agent/chat` に接続 |
| 2026-06-24 | Phase 16-6e-R 修正仕様を `phase16` §8.8 に追記（レビュー 8 件のフォローアップ） |
| 2026-06-24 | Phase 16-6e-R 実装完了（§8.8: R1–R7 + 仕様追記） |
| 2026-06-24 | Phase 16-6g 完了。`habit_signals` を generation-kit に注入（§9.3） |
| 2026-06-24 | Phase 16-7 完了。Privacy 設定 UI + export/delete API + agent diary 403（§12.2） |
| 2026-06-24 | Phase 16-6h 完了。`ProfileDiagnosisView` を `learner_profiles` API 優先に接続（Issue #28） |
| 2026-06-24 | TTS 仕様 v0.2: Gemini Native TTS → Kokoro-82M ONNX。`09_content_types_tts.md` / `tts_bundle.schema.json` / Issue #3–#4 更新 |
| 2026-06-24 | TTS 仕様レビュー修正: `dialogue_audio` スキーマ接続、`jp` 削除、`output_format` 統一、`lang_code` 必須化 |
| 2026-06-24 | Issue #3 実装: Kokoro サイドカー、`tools/core/kokoroTts.js`、`POST /api/v2/tts/synthesize`、MCP `request-tts`、Compose 統合 |

## Phase 17: 音声設定 UI（Issue #4）

> 仕様書: [`doc/phase17_voice_settings_ui_spec.md`](./phase17_voice_settings_ui_spec.md)  
> 目的: 設定画面から Kokoro ナレーション声を選択・試聴・永続化する。

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 17-0 | `preferences` JSONB API（GET/PUT deep-merge） | ✅ 完了 | `server/routes/user.js`, `server/services/userPreferences.js` | GET/PUT + `normalizeProfileRow` |
| 17-0 | TTS 生成が `preferences.tts.voice_id` を参照 | ✅ 完了 | `tools/core/kokoroTts.js`, `server/routes/tts.js`, MCP `request-tts` | `userId` / session scope |
| 17-A | 設定ハブ `SettingsView` | ✅ 完了 | `components/features/settings/`, `App.tsx` | `/settings`、一部行はプレースホルダー |
| 17-A | 音声設定 `SettingsVoiceView` | ✅ 完了 | 同上 | `/settings/voice`、リスト+試聴+即保存 |
| 17-A | `voiceCatalog` + `ttsPreferencesService` | ✅ 完了 | `data/tts/`, `services/ttsPreferencesService.ts` | `apiPut` + `rp_tts_preferences` ミラー |
| 17-A | プロフィール・レッスンからの導線 | ✅ 完了 | `ProfilePassport.tsx`, `GeneratedDocView.tsx` | スライド欄ボイスバッジ |
| 17-B | 診断バナー・詳細設定・英語声 | ✅ 完了 | `VoiceRecommendBanner`, `VoiceAdvancedPanel`, `voiceRecommendations.ts` | P1 |
| 17-B | サイドバー設定入口 | ✅ 完了 | `Layout.tsx` | P1 |
| 17-B | 設定ハブ「表示言語」行 | ✅ 完了 | `SettingsView.tsx` | LanguageContext 連動 |
| 17-C | レッスン内クイック切替シート | ✅ 完了 | `VoiceQuickSwitchSheet.tsx`, `GeneratedDocView.tsx` | スライド再生中のボトムシート |
| 17-C | 対話ブロック話者マッピング | ✅ 完了 | `SettingsDialogueVoiceView.tsx`, `dialogueSpeakers.ts`, `DialoguePage.tsx` | `preferences.tts.speaker_voices` |
| 17-C | APIキー設定の Settings 移管 | ✅ 完了 | `SettingsApiKeyView.tsx`, `GeminiApiKeyForm.tsx`, `ProfilePassport.tsx` | `/settings/api-key` |
| 17-C | 対話マッピング admin 制限 + エイリアス修正 | ✅ 完了 | `useUserRole.ts`, `SettingsDialogueVoiceView.tsx`, `user.js` | `speaker_voices` は admin のみ編集可 |

---

| 日付 | 内容 |
|------|------|
| 2026-06-24 | Phase 17 仕様策定。設定ハブ + 音声サブページ（リスト型ラジオ + 試聴） |
| 2026-06-24 | 仕様レビュー反映: 17-0 API 前提、GeneratedDocView、PUT/deep-merge、17-A/B Done 分割 |
| 2026-06-24 | Phase 17-0 実装: preferences API、`applyTtsRequestOptions`、MCP/Express TTS userId 配線 |
| 2026-06-24 | Phase 17-0 レビュー修正: TTS 検証/aiLimiter、MCP fail-closed、optionalAuth、トランザクション PUT |
| 2026-06-24 | Phase 17-A 実装: SettingsView/VoiceView、voiceCatalog、ttsPreferencesService、ProfilePassport/GeneratedDocView 導線 |
| 2026-06-24 | Phase 17-B 実装: VoiceRecommendBanner、VoiceAdvancedPanel、英語声カタログ、Layout 設定入口、表示言語行 |
| 2026-06-24 | Phase 17-C 実装: VoiceQuickSwitchSheet、Dialogue speaker mapping、Settings API key 移管 |

## Phase 18: ユーザー登録 UI

> 仕様書: [`doc/phase18_user_registration_spec.md`](./phase18_user_registration_spec.md)  
> 目的: `VITE_DEMO_MODE=false` で新規ユーザーが WebUI から登録・ログインできる。

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 18-1 | 登録タブ + `signUp` | ✅ 完了 | `ExperienceLoginView.tsx`, `AuthContext.tsx` | メール/パスワード、既存登録エラー表示 |
| 18-2 | Nexloom 同一認証コピー | ✅ 完了 | `ExperienceLoginView.tsx` | ログイン/登録タブ、JP/EN |
| 18-3 | 登録後ダッシュボード導線 | ✅ 完了 | `App.tsx` | JWT → `user_profiles` 自動作成（既存 API） |

---

| 日付 | 内容 |
|------|------|
| 2026-06-24 | Phase 18 v1 実装。仕様書ステータス Implemented |

## Phase 19: 学習者セマンティックメモリ（Memanto）

> 仕様書: [`doc/phase19_learner_semantic_memory_spec.md`](./phase19_learner_semantic_memory_spec.md)  
> 目的: 学習者ごとの汎用セマンティック記憶（opt-in、MCP + REST + UI）。

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 19-0 | Memanto overlay（VM） | ✅ 完了 | `docker-compose.memanto.yml`, `Dockerfile.memanto`, `deploy-stack.sh` | ollama/moorcheh/memanto、volume chown、`moorcheh-client` |
| 19-1 | Bridge + migration 009 | ✅ 完了 | `learnerMemoryBridge.js`, `009_learner_memory_meta.sql` | 診断 seed（opt-in 時） |
| 19-2 | MCP 統合コンテキスト | ✅ 完了 | `learnerMemory.js`, Skills, Hermes allowlist | `learner-personal-context`、degraded フォールバック |
| 19-3 | プライバシー UI + REST | ✅ 完了 | `learnerMemory.js`, `SettingsPrivacyView`, `/settings/ai-memory` | export/delete 連携 |
| 19-4 | 会話キャプチャ + 習慣同期 | ✅ 完了 | `personal-memory-curator` Skill, `syncHabitInsightMemories` | 週次 lazy sync |
| 19-5 | VM smoke + E2E | ✅ 完了 | `smoke-learner-memory-e2e.mjs`, `smoke-vm-stack.mjs` | `risepath-vm` bridge auth、remember + list |

---

| 日付 | 内容 |
|------|------|
| 2026-06-24 | Phase 19-0〜19-4 実装 + レビュー修正 2 回 |
| 2026-06-24 | VM デプロイ: api/mcp 再ビルド、migrate 009、Memanto `/ready`、E2E pass |
| 2026-06-24 | VM ブートディスク 50GB 拡張、`provision-gce.sh` デフォルト更新 |

## Life Journal 拡張（水分・飲み物）

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| LJ-drink | 日次ログ UI + 保存 | ✅ 完了 | `LifeJournalView.tsx`, `lifeJournalMetrics.ts` | water/coffee/tea/other、杯数、15時以降カフェイン |
| LJ-drink | API バリデーション | ✅ 完了 | `lifeJournalService.js` | `custom_metrics.drink_type` |
| LJ-drink | ユニットテスト | ✅ 完了 | `server/tests/lifeJournalDrinks.test.js` | serialize / deserialize |

## 将来のバックログ / オープン課題

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| ISS-oauth | Nexloom 共通 OAuth / SSO 連携 | 🔄 検討中 | [`doc/issue_nexloom_oauth_sso.md`](./issue_nexloom_oauth_sso.md) | Nexloom側のOAuth認可サーバー稼働後に同意リダイレクト形式へ移行 |
| ISS-byoa  | BYO-A カリキュラム生成・インポート | ⬜ 未着手 | [`doc/issue_byoa_curriculum_sync.md`](./issue_byoa_curriculum_sync.md) | ユーザーローカルのAIエージェントによるカリキュラム生成・同期 |

## Phase 20: BYO-A (Bring Your Own Agent) 連携

> 仕様書: [`doc/byoa_curriculum_generation_spec.md`](./byoa_curriculum_generation_spec.md)
> 目的: ユーザーローカルのエージェントが Big5 プロファイルに基づいてカリキュラムを生成・検証・同期する

| # | 項目 | 状態 | 対象ファイル | 備考 |
|---|------|------|-------------|------|
| 20-1 | JWT セッションのエクスポート | ⬜ 未着手 | `SettingsView.tsx` 等 | `credentials.json` への書き出し |
| 20-2 | インポート API のUUID自動採番改修 | ⬜ 未着手 | `server/routes/chatgptCurriculum.js` | ID衝突およびIDOR対策 |
| 20-3 | 同期用 CLI ツールの作成 | ⬜ 未着手 | `scripts/byoa-sync-curriculum.js` | 認証情報の自動ロードと API 同期 |
| 20-4 | コード検証ハーネスの作成 | ⬜ 未着手 | `scripts/harness-code-validator.js` | 隔離環境と5秒タイムアウトでのコード検証 |
| 20-5 | MCP へのツール登録 | ⬜ 未着手 | `mcp-server/index.js` | `generate_rich_curriculum` 登録 |

