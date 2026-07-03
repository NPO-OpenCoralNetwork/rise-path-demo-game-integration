# Rise Path — システム仕様書 v4

> 最終更新: 2026-06-22  
> 前提文書: `architecture_v2_mcp_skills.md`, `architecture_v3_hermes_agent.md`, `phase7-16 specs`

## 1. プロダクト概要

Rise Path は **学習者の性格・行動に適応する AI 学習プラットフォーム**。

### コアバリュー

1. **パーソナライゼーション** — Big5 人格特性から学習軸を導出し、一人一人に最適化
2. **適応フィードバック** — ジャーナルデータを分析し、自動的にペース・トーンを調整
3. **マルチフォーマット** — スライド・対話・ワークショップ・クイズの組み合わせ
4. **デュアル配信** — 静的カリキュラム (Gold Standard) + AI 生成 (Pro)

### ターゲット

- **B2C**: 個人学習者（趣味〜キャリア）
- **B2B2C**: コミュニティ拠点（子ども食堂・サードプレイス）

---

## 2. システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│                        クライアント層                                │
│                                                                     │
│  React 19 + Vite + TypeScript + TailwindCSS                        │
│  ├─ LearningHub (ポータル選択)                                      │
│  ├─ PersonalAssessmentView (Big5 診断)                              │
│  ├─ CourseGeneratorView (AI カリキュラム生成)                         │
│  ├─ GeneratedDocView + LessonReflectionModal (学習 + 振り返り)       │
│  ├─ LearningMirrorView (プロファイル可視化)                          │
│  └─ MissionControlDashboard (進捗ダッシュボード)                     │
│                                                                     │
│  http://localhost:3007 (Vite dev) / dist/ (production)              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ fetch('/api/v2/...')
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Web API 層 (Express)                         │
│                        http://localhost:3006                         │
│                                                                     │
│  認証: Supabase JWT + Bridge Token (§4.6)                           │
│  レート制限: Global 200/min, AI 10/min, MCP 30/min                  │
│                                                                     │
│  /api/v2/                                                           │
│  ├─ curricula/          GET (一覧) / GET :id / POST (保存)          │
│  ├─ curricula/:id/journal  POST (振り返り記録) / GET (一覧)          │
│  ├─ learner-profiles/   POST assessments / GET latest               │
│  ├─ adaptation          GET (適応シグナル)                           │
│  ├─ generation-kit      GET (Kit 取得)                              │
│  ├─ upload              POST (RAG 資料アップロード)                   │
│  ├─ rag/index           POST (非同期 ingest)                         │
│  ├─ user/               GET/PUT profile / progress / notifications  │
│  ├─ life-journal/       PUT/GET daily, range, analysis, advice      │
│  ├─ ai/                 POST generate (カリキュラム AI 生成)           │
│  └─ agent/              POST chat → Hermes API Server (Phase 16-6d)   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌─────────────────────────────┐   ┌─────────────────────────────────┐
│  Hermes Agent 層 (:8642)    │   │  MCP Server 層                  │
│  Gateway + API Server       │   │  stdio / SSE dual transport      │
│  Provider Router + Skills   │   │  10+ tools (daily-life-* 追加予定)│
│  MCP Client → rise_path     │──▶│  profile + policy + audit        │
└─────────────────────────────┘   └─────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MCP ツール一覧（10 + daily-life-* 5 追加予定）                      │
│  ├─ learner-state-get / learner-state-update                        │
│  ├─ journal-log / journal-summary / journal-recent                  │
│  ├─ rag-search / get-generation-kit / validate-intake / save-draft  │
│  ├─ learner-adaptation-signals                                      │
│  └─ daily-life-log / range / analysis / advice / chat-context     │
│  クライアント: Hermes Agent, ChatGPT Apps, Claude Desktop, Cursor   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        共有ビジネスロジック層                         │
│                        tools/core/ + server/services/               │
│                                                                     │
│  curriculum.js          getKit (Kit生成 + 注入), validateIntake,     │
│                         saveDraft, suggestLearningMode               │
│  journal.js             getAdaptationSignals (パターン分析→シグナル)  │
│  learnerState.js        進捗 get/update                             │
│  ragSearch.js           ベクトル検索 + keyword fallback              │
│                                                                     │
│  personalizationDeriver.js  Big5→9軸→generation_rules (641行)       │
│  journalService.js          analyzeJournalPatterns (confidence,      │
│                              staleness, trends)                     │
│  curriculumGenerationKit.js テンプレート + スキーマ + ルール          │
│  adaptation_config.json     6適応ルール定義                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        データ層 (PostgreSQL + Supabase)              │
│                                                                     │
│  curricula              カリキュラム本体 (JSON)                      │
│  learner_profiles       Big5→9軸プロファイル (version管理)           │
│  learning_journal       振り返りログ (mood/confidence/learned)       │
│  user_progress          学習進捗 (mastery/completed_steps)           │
│  user_profiles          ユーザー基本情報                             │
│  learning_events        学習イベントログ                             │
│  materials              RAG ソース資料                               │
│  material_chunks        RAG チャンク (pgvector 埋込み)               │
│  mcp_sessions           MCP セッション監査ログ                       │
│  mcp_tool_calls         MCP ツール呼び出しログ                       │
│  notifications          通知                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. パーソナライゼーション パイプライン

学習者の個性をカリキュラム生成に反映する中核システム。

### 3.1 データフロー

```
[診断 UI] → Big5 スコア + 学習スタイル + モチベーション + ライフスタイル
    │
    ▼ POST /api/v2/learner-profiles/assessments
    │
[personalizationDeriver.js] → deriveLearningProfile()
    │
    ├─ 9軸プロファイル (derived_learning_profile)
    │   ├─ credential_orientation    (high/medium/low)
    │   ├─ problem_solving_orientation
    │   ├─ example_first_preference
    │   ├─ structure_need
    │   ├─ reassurance_need
    │   ├─ practice_intensity        (light/moderate/heavy)
    │   ├─ pace_preference           (steady_small_steps/moderate/intensive)
    │   ├─ social_learning_preference
    │   └─ feedback_style            (coach_gentle/coach/strict)
    │
    ├─ generation_rules
    │   ├─ explanation_style         (example_then_principle/mixed/principle_then_example)
    │   ├─ assessment_style          (quiz_and_case/quiz_and_light_practice/light_practice_only)
    │   ├─ curriculum_voice          (gentle_and_reassuring/encouraging/direct_and_precise)
    │   └─ weekly_load_policy        (target_minutes, max_actions)
    │
    └─ suggested_learning_mode       (gentle/credential/problem_solving/practice/default)
```

### 3.2 導出優先順位

```
declared_preferences > lifestyle > motivation > big_five > default
```

### 3.3 Kit 注入（get-generation-kit）

```
get-generation-kit(user_id)
    │
    ├── ① テンプレート + スキーマ (static)
    │
    ├── ② Promise.all([
    │       loadLearnerProfile(userId),      ← DB: learner_profiles
    │       getAdaptationSignals(userId),     ← DB: learning_journal → 分析
    │   ])
    │
    └── ③ マージ: adaptation > profile > defaults
            │
            └── kit.personalization = {
                  derived_learning_profile,
                  generation_rules (マージ済),
                  suggested_learning_mode,
                  adaptation: { signals, overrides, analysis }
                }
```

---

## 4. 適応フィードバック システム

### 4.1 5段階ループ

```
Observe   → learning_journal に記録
Analyze   → analyzeJournalPatterns() で統計・傾向抽出
Recommend → deriveAdaptationSignals() で6ルール評価
Apply     → Kit の generation_rules を override
Verify    → 次回ジャーナルで効果を確認
```

### 4.2 適応ルール (adaptation_config.json)

| ルール | 条件 | アクション |
|-------|------|----------|
| pace_down | struggled_streak ≥ 2 | pace → steady_small_steps |
| encourage | avg_confidence < 2.5 | reassurance → high |
| simplify | time_trend == increasing | セッションを短く分割 |
| level_up | mood_great_good_pct > 0.8 && avg_confidence > 4 | ペースアップ提案 |
| engagement_drop | lessons_without_learned ≥ 3 | 教材アプローチ変更 |
| confidence_decline | confidence_trend == declining | 具体例を増やす |

### 4.3 信頼度

| エントリ数 | confidence_score | 根拠 |
|-----------|:---:|------|
| 3-5 | 0.4 | 最低限の傾向のみ |
| 6-9 | 0.7 | 傾向比較可能 |
| 10+ | 1.0 | 完全な統計 |

---

## 5. セキュリティ アーキテクチャ

### 5.1 認証 (4層)

| 層 | 方式 | 対象 |
|---|------|------|
| 1 | Bridge Token | ChatGPT Apps, 外部連携 |
| 2 | Supabase JWT | フロントエンド SPA |
| 3 | MCP Bearer Token | SSE セッション所有者照合 |
| 4 | dev-fallback | 開発環境 (PHASE1_USER_ID) |

### 5.2 MCP プロファイル制限

| プロファイル | ツール数 | 除外 |
|------------|:---:|------|
| learner | 6 | save-curriculum-draft, learner-state-update, rag-search, learner-adaptation-signals |
| coach | 8 | rag-search, learner-adaptation-signals |
| admin | 10 | なし |

### 5.3 レート制限

| 対象 | 制限 (prod) | 制限 (dev) |
|------|:---:|:---:|
| Global API | 200/min/IP | 1000 |
| AI Heavy | 10/min/userId | 100 |
| MCP SSE | 30/min/session | 300 |

---

## 6. コンテンツ モデル

### 6.1 カリキュラム構造

```
Curriculum
  ├─ metadata (title, description, domain, duration_weeks)
  ├─ personalization_meta (profile snapshot + rules)
  ├─ modules[]
  │   ├─ module_id
  │   ├─ title
  │   └─ lessons[]
  │       ├─ lesson_id
  │       ├─ title
  │       ├─ objectives[]
  │       ├─ blocks[] (concept/dialogue/workshop/reflection/checklist)
  │       └─ slides[] (optional, for presentation mode)
  └─ roadmap_summary
```

### 6.2 学習ポータル (7ドメイン)

| ID | 名前 | レッスン数 |
|---|------|:---:|
| vibe-coding | Vibe Coding | 12 |
| blender-3d | Blender 3D | 5 |
| art-atelier | Art Atelier | 15 |
| programming-web | Web Dev | 8 |
| programming-ai | AI & Python | 10 |
| sonic-lab | Sonic Lab | 6 |
| p-school | P-School | 8 |

### 6.3 学習モード (4種)

| モード | 特徴 | 推奨条件 |
|-------|------|---------|
| gentle | 安心感重視、小さなステップ | reassurance_need == high |
| credential | 資格・認定志向 | credential_orientation == high |
| problem_solving | 問題解決型 | problem_solving_orientation == high |
| practice | 実践重視 | practice_intensity == heavy |

---

## 7. UI ↔ API 接続仕様

### 7.1 接続済み

| UI コンポーネント | API | 推奨ルート | データフロー |
|-----------------|-----|:---:|------------|
| LessonReflectionModal | POST /curricula/:id/journal | Web UI | mood + confidence + learned → learning_journal |
| GeneratedDocView | POST /curricula/:id/journal | Web UI | レッスン完了 → 振り返りモーダル表示 |
| LearningMirrorView | GET /learner-profiles/latest | Web UI | learner_profiles → 9軸表示 |
| CourseList / MyContent | GET /curricula | Web UI | curricula → カード一覧 |
| AI コーチ (ChatGPT等) | get-generation-kit / save-curriculum-draft | MCP | Kit + 生成 + 保存 |

> **原則**: Web UI → Web API (`/api/v2/`)、AI コーチ → MCP ツール。LLM 推論は Hermes Agent（v3）。同じロジック層 (`tools/core/`) を共有。

### 7.2 Hermes 経由チャット（Phase 16-6 — 実装予定）

| UI コンポーネント | API | Skill | データフロー |
|-----------------|-----|-------|------------|
| LifeJournalChatView | POST /agent/chat | `life-habit-analyst` | Express → Hermes → MCP `daily-life-chat-context` |
| FloatingChatbot | POST /agent/chat | `learning-coach` | 同上（Gemini SDK から移行） |

設計: [`architecture_v3_hermes_agent.md`](./architecture_v3_hermes_agent.md)

### 7.3 未接続（要修正）→ Phase 13 で対応

| UI コンポーネント | 問題 | 修正内容 | 仕様書 |
|-----------------|------|---------|:---:|
| PersonalAssessmentView | DB に保存しない | 結果表示時に自動 POST | phase13 A-1 |
| CourseGeneratorView | 410 Gone | 独立仕様書で設計 | phase13-C (別 spec) |
| LearningInsightsWidget | 適応シグナル非表示 | GET /adaptation を呼んで表示 | phase13 A-3 |

---

## 8. テスト体制

> 最終検証: 2026-05-01 `node --test` 全通過

| カテゴリ | テスト数 | ファイル |
|---------|:---:|------|
| パーソナライゼーション (Big5→9軸→rules) | 50 | server/tests/personalization.test.js |
| 適応フィードバック (パターン分析, 6ルール) | 28 | server/tests/adaptation.test.js |
| suggestLearningMode (モード推奨) | 8 | server/tests/adaptation.test.js |
| MCP Server HTTP (health/CORS/404) | 7 | mcp-server/tests/health.test.js |
| **ユニットテスト 合計** | **86** | server/tests/ |
| **統合テスト 合計** | **7** | mcp-server/tests/ |
| **総合計** | **93** | |

---

## 9. 環境変数

| 変数 | 用途 | 必須 |
|------|------|:---:|
| DATABASE_URL_PHASE1 | PostgreSQL 接続文字列 | ✅ |
| PHASE1_USER_ID | デフォルトユーザー UUID | ✅ |
| GEMINI_API_KEY | Gemini AI (バックエンド) | ✅ |
| VITE_GEMINI_API_KEY | Gemini AI (フロントエンド) | ✅ |
| SUPABASE_URL | Supabase プロジェクト URL | ✅ |
| SUPABASE_SERVICE_ROLE_KEY | Supabase サービスキー | ✅ |
| RISE_PATH_BRIDGE_TOKEN | 外部連携用固定トークン | ✅ |
| VITE_SUPABASE_URL | フロント用 Supabase URL | 任意 |
| VITE_SUPABASE_ANON_KEY | フロント用 Supabase 匿名キー | 任意 |
| MCP_CORS_ORIGINS | 本番 CORS 許可オリジン (カンマ区切り) | 任意 |
| HERMES_API_URL | Hermes API Server URL（Express プロキシ先） | Phase 16-6 |
| HERMES_API_KEY | Hermes API Server Bearer token | Phase 16-6 |

---

## 10. ファイルマップ

### エントリポイント

| ファイル | 役割 |
|---------|------|
| `index.tsx` → `App.tsx` | フロントエンド SPA |
| `server.js` | Express API サーバー |
| `mcp-server/index.js` | MCP Server (stdio/SSE) |
| `hermes/config.example.yaml` | Hermes rise-path プロファイル設定 |
| `skills/life-habit-analyst/SKILL.md` | 生活習慣分析チャット Skill |

### 共有ロジック (tools/core/)

| ファイル | 役割 |
|---------|------|
| `curriculum.js` | Kit 生成 + プロファイル注入 + 適応注入 |
| `journal.js` | ジャーナル CRUD + 適応シグナル取得 |
| `learnerState.js` | 進捗 get/update |
| `ragSearch.js` | ベクトル + keyword 検索 |
| `domains.js` | 7ドメイン定義 |

### サービス (server/services/)

| ファイル | 役割 |
|---------|------|
| `personalizationDeriver.js` | Big5 → 9軸 → rules (641行) |
| `journalService.js` | パターン分析 + 信頼度 + 鮮度 |
| `curriculumGenerationKit.js` | テンプレート + バリデーション |
| `adaptation_config.json` | 6適応ルール定義 |
| `schemaValidator.js` | カリキュラム JSON スキーマ検証 |

### MCP セキュリティ (mcp-server/)

| ファイル | 役割 |
|---------|------|
| `tool-registry.json` | 10ツール定義 (リスク・カテゴリ・annotations) |
| `profileFilter.js` | プロファイル別フィルタ (learner/coach/admin) |
| `policy.js` | レート制限 + audit ラッパー |

---

## 11. エラーハンドリング方針

### 11.1 障害時の Graceful Degradation

| 障害 | 影響範囲 | フォールバック |
|------|---------|-------------|
| **DB 接続断** | 全機能 | `/health` が `degraded` を返す。MCP ツールは `db_unavailable` エラー。フロント静的カリキュラムは動作継続 |
| **Gemini API 障害** | AI 生成のみ | Kit 取得は成功（DB のみ）。生成リクエストに 503 返却。フロントに「AI 一時停止中」バナー |
| **Supabase Auth 障害** | 認証 | dev-fallback で継続（開発環境のみ）。本番では 503 |
| **learner_profiles なし** | パーソナライゼーション | Kit はデフォルト rules で生成。`suggested_learning_mode = null` |
| **learning_journal なし** | 適応フィードバック | adaptation シグナル空配列。Kit はプロファイルルールのみで生成 |
| **pgvector 未設定** | RAG 検索 | keyword fallback（ragSearch.js 既存実装） |

### 11.2 リトライ方針

| 対象 | リトライ | タイムアウト |
|------|:---:|:---:|
| DB クエリ | なし（即失敗） | 5s |
| Gemini API | 1回（exponential backoff） | 30s |
| RAG ingest job | 失敗時 `error` 状態に遷移、手動再実行 | 120s |
| MCP ツール呼び出し | なし（クライアント側で判断） | 10s |

---

## 12. デプロイ構成

### 12.1 現在の環境

| 環境 | フロントエンド | バックエンド | DB | 状態 |
|------|-------------|-----------|----|----- |
| ローカル開発 | Vite :3007 | Express :3006 | Supabase (リモート) | ✅ 稼働中 |
| MCP Server | — | stdio / SSE :3100 | 同上 | ✅ 稼働中 |
| 本番 | 未構成 | 未構成 | Supabase | ⬜ 未着手 |

### 12.2 本番構成（計画）

```
Cloudflare Tunnel / ngrok
    ↓ HTTPS
VPS or Cloud Run
    ├─ Express API (:3006)
    ├─ MCP SSE Server (:3100)
    └─ Vite build → static serve

Supabase (マネージド)
    ├─ PostgreSQL + pgvector
    └─ Auth (JWT)
```

### 12.3 デプロイ前チェックリスト

- [ ] `NODE_ENV=production` で全テスト通過
- [ ] `npm run build` でフロントビルド成功
- [ ] CORS origins を本番ドメインに設定
- [ ] Bridge Token をランダム値に変更
- [ ] rate limit を本番値に確認
- [ ] `jobs` テーブル作成済み
