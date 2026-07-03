# Phase 13: UI ↔ DB 統合仕様書

> 対象: プロファイル DB 保存 + RAG データ パイプライン
> 前提: `doc/system_spec_v4.md`, `doc/phase12_adaptive_feedback_spec.md`

---

## 問題 1: プロファイル → DB 保存が未接続

### 現状

```
[PersonalAssessmentView] → Big5 質問回答
    ↓
[PersonalityAssessment.tsx] → スコア算出 (openness, etc.)
    ↓
[ComprehensiveResults.tsx] → 結果表示 (582行の美麗 UI)
    ↓
localStorage のみ保存 ❌ → DB (learner_profiles) に届かない
```

### あるべき姿

```
[ComprehensiveResults] 表示完了
    ↓ POST /api/v2/learner-profiles/assessments
    │  body: {
    │    raw_profile: {
    │      big_five: { openness, conscientiousness, extraversion, agreeableness, neuroticism },
    │      learning_style: { ... },
    │      motivation: { ... },
    │      lifestyle: { ... }
    │    }
    │  }
    ↓
[chatgptCurriculum.js L529] requireBridgeOrAuth → deriveLearningProfile()
    ↓
learner_profiles テーブルに INSERT (version管理)
    ↓
次回の get-generation-kit で自動注入 ← Phase 12.5 で実装済み
```

### API 仕様 (既存)

`POST /api/v2/learner-profiles/assessments` は **既に実装済み** (chatgptCurriculum.js L529-593)

```
Request:
  POST /api/v2/learner-profiles/assessments
  Authorization: Bearer <JWT> or X-Bridge-Token
  Content-Type: application/json
  {
    "assessment_type": "big_five_v1",
    "raw_profile": {
      "big_five": {
        "openness": 75,
        "conscientiousness": 60,
        "extraversion": 30,
        "agreeableness": 65,
        "neuroticism": 70
      },
      "learning_style": {
        "preferred_format": "hands_on",
        "session_length": "short"
      },
      "motivation": {
        "primary_driver": "curiosity",
        "goal_orientation": "mastery"
      },
      "lifestyle": {
        "schedule_type": "irregular",
        "weekly_available_hours": 5
      }
    }
  }

Response:
  200 OK
  {
    "ok": true,
    "learner_profile_id": "uuid",
    "profile_version": 1,
    "derived_learning_profile": {
      "feedback_style": "coach_gentle",
      "reassurance_need": "high",
      ...
    }
  }
```

### 設計判断: 自動保存

> **手動保存ではなく自動保存を採用する。** 理由: ユーザーが「保存」を忘れると、以降のパーソナライゼーションが機能しない。

- 結果表示時（`ComprehensiveResults` マウント時）に自動 POST
- UI に「保存済み ✓」バッジを表示
- 保存失敗時のみエラー通知（best-effort）
- **重複防止**: `useRef` で送信済みフラグを管理。同一セッションで2回送信しない

### 修正箇所

| ファイル | 変更内容 | 行数目安 |
|---------|---------|:---:|
| `ComprehensiveResults.tsx` | `useEffect` で自動 POST + 保存済みバッジ | +35行 |
| `PersonalAssessmentView.tsx` | profile → raw_profile マッピングヘルパー | +15行 |

### 変更詳細: ComprehensiveResults.tsx

```typescript
const [savedVersion, setSavedVersion] = useState<number | null>(null);
const saveAttempted = useRef(false);

useEffect(() => {
    if (saveAttempted.current) return; // 重複防止
    saveAttempted.current = true;

    const saveProfile = async () => {
        try {
            const rawProfile = {
                big_five: profile.scores,
                learning_style: profile.learningStyle || {},
                motivation: profile.motivation || {},
                lifestyle: profile.lifestyle || {},
            };
            const res = await fetch('/api/v2/learner-profiles/assessments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assessment_type: 'big_five_v1',
                    raw_profile: rawProfile,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setSavedVersion(data.profile_version);
            }
        } catch {
            // Best-effort — don't block UI
        }
    };
    saveProfile();
}, [profile]);

// UI: 保存済みバッジ
{savedVersion && (
    <span className="text-emerald-500 text-xs font-bold">
        ✓ Profile v{savedVersion} saved
    </span>
)}
```

### 認証の考慮

`requireBridgeOrAuth` は以下の順で認証を試行:
1. Bridge Token → 2. Supabase JWT → 3. dev-fallback (PHASE1_USER_ID)

**開発環境では認証なしでも動作する。** 本番では Supabase JWT が必要。

---

## 問題 2: RAG データが 0件

### 現状

```
materials: 0件
material_chunks: 0件
jobs テーブル: 存在しない ← JobWorker が毎2秒エラー
pgvector: 未設定
```

### あるべき姿

```
[Upload UI] or [CLI] → PDF/テキスト アップロード
    ↓ POST /api/v2/upload
    ↓
materials テーブルに記録 + ファイル保存
    ↓ POST /api/v2/rag/index (非同期 enqueue)
    ↓
jobs テーブルに status='queued' で INSERT
    ↓
[JobWorker] 2秒ポーリング → job 取得 → ingestMaterial()
    ↓
[ragService.js] テキスト抽出 → チャンク分割 → 埋込み → material_chunks に INSERT
    ↓
[rag-search MCP] or [GET /api/v2/rag/search] で検索可能
    ↓
get-generation-kit の context に RAG 結果を注入
```

### DB マイグレーション

#### `jobs` テーブル作成 (必須)

```sql
CREATE TABLE IF NOT EXISTS jobs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL,
    type       VARCHAR(50) NOT NULL DEFAULT 'ingest',
    payload    JSONB NOT NULL DEFAULT '{}',
    status     VARCHAR(20) NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'done', 'error')),
    progress   INTEGER DEFAULT 0,
    error      TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_at);
```

#### pgvector 拡張 (推奨)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE material_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(768);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON material_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### RAG Ingest フロー

```
ragService.js ingestMaterial(materialId, filePath, mimeType, userId)
    ↓
    ├── PDF → pdf-parse → テキスト抽出
    ├── テキスト → 1000文字チャンクに分割 (200文字オーバーラップ)
    ├── Gemini embedding-001 → 768次元ベクトル生成
    └── material_chunks に bulk INSERT (content + embedding)
```

### テスト用 RAG データ投入

```bash
# Blender 公式チュートリアルテキストを投入
curl -X POST http://localhost:3006/api/v2/upload \
  -H "Content-Type: multipart/form-data" \
  -F "file=@doc/chapter_01_unity_basics.md" \
  -F "title=Unity Basics" \
  -F "domain=unity"
```

または CLI で直接投入:

```javascript
// scripts/seed_rag.js
import { ingestMaterial } from '../server/ragService.js';
// doc/ 配下の .md ファイルを一括 ingest
```

### 修正箇所

| ファイル | 変更内容 | 行数目安 |
|---------|---------|:---:|
| DB migration SQL | `jobs` テーブル作成 | +15行 |
| `server/jobWorker.js` L65 | jobs テーブル不在時の graceful skip | +5行 |
| `scripts/seed_rag.js` | [NEW] 全7ドメインの RAG データ投入 | +60行 |
| `server/ragService.js` | pgvector 有無の自動検出（既存） | 確認のみ |

### シードデータ対象

| ドメイン | ソース | ファイル数 |
|---------|-------|:---:|
| Unity | doc/chapter_01〜12.md | 12 |
| Blender | data/curricula/blender/ | 既存 |
| Art | data/curricula/art/ | 既存 |
| Vibe Coding | data/curricula/vibe_coding/ | 既存 |

---

## 実装計画表

### Phase 13-A: プロファイル DB 保存（優先度: 🔴 最高）

| # | タスク | 対象ファイル | 工数 | 依存 |
|---|-------|------------|:---:|:---:|
| A-1 | `ComprehensiveResults.tsx` に自動 POST + 重複防止 | ComprehensiveResults.tsx | 小 | — |
| A-2 | `AssessmentProfile` 型と API スキーマの整合確認 | types.ts | 極小 | — |
| A-3 | dev mode での E2E テスト (自動テストスクリプト) | scripts/test_profile_save.sh | 小 | A-1 |
| A-4 | 保存済みバッジ UI | ComprehensiveResults.tsx | 極小 | A-1 |

**完了条件**: 診断完了 → 自動保存 → `learner_profiles` に新行 → 次回 Kit に自動注入

### Phase 13-A テスト計画

```bash
# 自動テスト: プロファイル保存 → 取得 → Kit 注入
curl -s -X POST http://localhost:3006/api/v2/learner-profiles/assessments \
  -H 'Content-Type: application/json' \
  -d '{"raw_profile":{"big_five":{"openness":75,"conscientiousness":60,"extraversion":30,"agreeableness":65,"neuroticism":70}}}' \
  | jq '.ok, .profile_version'

# Kit にプロファイルが注入されたか確認
curl -s http://localhost:3006/api/v2/generation-kit?include_personalization=true \
  | jq '.personalization.derived_learning_profile'
```

---

### Phase 13-B: RAG パイプライン修復（優先度: 🟡 中）

| # | タスク | 対象ファイル | 工数 | 依存 |
|---|-------|------------|:---:|:---:|
| B-1 | `jobs` テーブル作成 SQL 実行 | server/migrations/ | 極小 | — |
| B-2 | JobWorker graceful skip | server/jobWorker.js | 極小 | — |
| B-3 | pgvector 拡張 SQL (Supabase 対応確認) | server/migrations/ | 小 | — |
| B-4 | 全ドメイン RAG seed スクリプト | scripts/seed_rag.js | 小 | B-1 |
| B-5 | seed 実行 + MCP 検索確認 | MCP ツール | 小 | B-4 |

**完了条件**: `rag-search "Unity basics"` → チャンク結果が返る

---

### Phase 13-C: AI Chat 復活 → **独立仕様書で設計**

> ⚠️ 工数が大きいため、`phase13c_ai_chat_spec.md` として独立仕様書を作成する。

**設計すべき項目:**
- プロンプトテンプレート設計 (Kit → system prompt 変換)
- 会話履歴管理 (セッション vs 永続)
- ストリーミング対応 (SSE / streaming response)
- エラーケース (Gemini 障害時の UI 表示)
- CourseGeneratorView の接続先変更

---

### 実行順序

```
Week 1: A-1 → A-2 → A-3 → A-4 → B-1 → B-2  (Quick Wins)
Week 2: B-3 → B-4 → B-5                       (RAG 稼働)
Week 3: Phase 13-C 仕様書作成 → レビュー → 実装 (AI Chat 復活)
```

### 完了時の全体フロー

```
ユーザー
  ↓ /assessment
Big5 診断 → 結果表示 → 「保存」
  ↓ POST /learner-profiles/assessments
learner_profiles DB に保存
  ↓
ユーザー → /generator
「Blender入門」入力
  ↓ POST /ai/generate
Kit 取得 (profile + adaptation 自動注入)
  ↓ Gemini 構造化出力
カリキュラム生成 → 表示
  ↓
レッスン受講 → 振り返りモーダル
  ↓ POST /curricula/:id/journal
learning_journal に記録
  ↓
次回 Kit 取得時に adaptation シグナル発火
  ↓
パーソナライズ済みカリキュラムが進化
```
