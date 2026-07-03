# Phase 14: MCP ハーネス設計 v2 — LLM 主導カリキュラム生成

> リサーチ分析 ([phase14_harness_research.md](file:///Volumes/space/dev/test-rise-path/rise-path-demo-game-Integration-/doc/phase14_harness_research.md)) の4つの Gap を反映した改訂版。

## 設計哲学

```
ハーネス = 安全網 + フィードバック装置
レール   = 固定経路

Phase 14 はハーネスを作る。
コードは「何ができるか」と「品質基準」を宣言するだけ。
「どの順序で使うか」は LLM が決める。
```

**業界根拠**: Anthropic MCP 設計原則 "Outcomes Over Operations"、IMPROVE 論文 (2025) のコンポーネント単位最適化、ToolACE-R の自律停止判断。

---

## ツール一覧 (新規3 + 改修2)

| ツール | 種別 | 目的 |
|--------|:---:|------|
| `save-module-draft` | 🆕 | モジュール単位の保存 + 品質スコア |
| `research-topic` | 🆕 | RAG 検索 + Web 検索ヒント |
| `finalize-curriculum` | 🆕 | 全モジュール結合 + 最終品質チェック + 公開 |
| `save-curriculum-draft` | 📝 | `header_only` オプション追加 |
| `get-generation-kit` | 📝 | `compact_mode` + `generation_hints` 追加 |

---

## 新規ツール詳細

### 1. `save-module-draft`

モジュール単位で保存。品質スコアを定量的に算出して返却。

**入力**:
```json
{
  "curriculum_id": "uuid",
  "module_index": 0,
  "module": {
    "title": "Blenderをはじめよう",
    "goal": "インストールからビューポート操作まで",
    "lessons": [
      {
        "title": "...",
        "objective": "...",
        "explanation": "220文字以上の説明...",
        "key_points": ["...", "...", "..."],
        "examples": ["..."],
        "practice": ["...", "..."],
        "cautions": ["..."],
        "takeaway": "..."
      }
    ]
  }
}
```

**レスポンス** (Gap 1 + Gap 2 反映):
```json
{
  "saved": true,
  "module_index": 0,
  "lesson_count": 2,

  "quality_score": 0.85,
  "quality_breakdown": {
    "explanation_depth": 0.78,
    "practice_coverage": 1.0,
    "caution_presence": 1.0,
    "key_points_depth": 0.8,
    "example_richness": 0.6
  },
  "pass_threshold": 0.75,
  "quality_passed": true,

  "revision_count": 1,
  "max_revisions": 5,
  "recommendation": "accept",

  "quality_warnings": [
    "lessons[0].explanation is 198 chars (min 220)"
  ],
  "hint": "explanationをあと22文字追加すると品質スコアが0.90を超えます"
}
```

**品質スコア算出ロジック** (Gap 1):

```javascript
function calculateQualityScore(lesson, minimums) {
  const scores = {
    explanation_depth: Math.min(1.0,
      (lesson.explanation?.length || 0) / minimums.explanation_min_chars),
    practice_coverage: Math.min(1.0,
      (lesson.practice?.length || 0) / minimums.practice_min_items),
    caution_presence: lesson.cautions?.length > 0 ? 1.0 : 0.0,
    key_points_depth: Math.min(1.0,
      (lesson.key_points?.length || 0) / minimums.key_points_min_items),
    example_richness: Math.min(1.0,
      (lesson.examples?.length || 0) / 2),  // 目標2件
  };

  // 加重平均 (explanation と practice を重視)
  const weights = {
    explanation_depth: 0.30,
    practice_coverage: 0.25,
    caution_presence: 0.15,
    key_points_depth: 0.20,
    example_richness: 0.10,
  };

  const total = Object.entries(scores).reduce(
    (sum, [key, val]) => sum + val * weights[key], 0
  );

  return { score: Math.round(total * 100) / 100, breakdown: scores };
}
```

**修正ループ発散防止** (Gap 2):

```javascript
function determineRecommendation(qualityScore, revisionCount, maxRevisions) {
  if (qualityScore >= 0.75) return 'accept';         // 基準クリア
  if (revisionCount >= maxRevisions) return 'escalate'; // 上限到達 → ユーザーに相談
  if (qualityScore >= 0.5) return 'revise';           // 修正可能
  return 'restructure';                                // 根本的な再設計が必要
}
```

| recommendation | LLM の行動 |
|---------------|-----------|
| `accept` | 次のモジュールに進む |
| `revise` | `quality_warnings` を参考に修正して再保存 |
| `restructure` | レッスン構成を根本的に変更して再保存 |
| `escalate` | ユーザーに「このモジュールの品質向上が難しい」と報告 |

---

### 2. `research-topic`

RAG 検索 + Web 検索ヒントを統合して返却。

> [!IMPORTANT]
> **Gap 4 反映**: MCP サーバーは Web 検索を **直接実行しない**。「Web 検索が有益そう」というヒントを返し、実際の検索は LLM クライアント側のツール (web_search 等) に委譲する。

**入力**:
```json
{
  "query": "Blender 3D modeling beginner 2026",
  "sources": ["rag"],
  "max_results": 5
}
```

**レスポンス**:
```json
{
  "rag_results": [
    {
      "title": "Blender入門ガイド",
      "content": "3Dビューポートの操作...",
      "relevance_score": 0.82,
      "source_id": "e71eae54..."
    }
  ],
  "rag_count": 3,

  "web_search_hint": {
    "suggested": true,
    "reason": "RAG に2026年の最新トレンド情報がありません",
    "suggested_queries": [
      "Blender 4.x new features 2026",
      "3D modeling learning path beginner 2026"
    ]
  },

  "context_summary": "RAG: 3件の教材を発見（インストール、ビューポート、基本操作）。最新バージョン情報は不足しています。"
}
```

**設計意図**:
- `web_search_hint.suggested: true` → LLM は自分の `search_web` ツールを呼ぶかどうかを判断
- `web_search_hint.suggested: false` → RAG で十分な情報が得られた
- LLM は `suggested_queries` を参考にするが、自分でクエリを考えても良い

---

### 3. `finalize-curriculum`

全モジュールを結合し、最終品質チェックを実行して公開。

**入力**:
```json
{
  "curriculum_id": "uuid"
}
```

**処理**:
1. DB から `curriculum_id` の全モジュールを取得
2. モジュール間の整合性チェック:
   - タイトル重複なし
   - 難易度が段階的に上昇
   - 前提知識の依存関係が正しい
3. 全体品質スコアの算出（各モジュールスコアの加重平均）
4. `status: 'draft' → 'published'` に更新

**レスポンス**:
```json
{
  "finalized": true,
  "curriculum_id": "uuid",
  "title": "Blender 3Dモデリング入門",
  "status": "published",
  "total_modules": 3,
  "total_lessons": 8,
  "overall_quality_score": 0.88,
  "estimated_hours": 12,
  "roadmap": [
    { "index": 1, "title": "Blenderをはじめよう", "lessons": 2, "quality": 0.90 },
    { "index": 2, "title": "基本モデリング操作", "lessons": 3, "quality": 0.85 },
    { "index": 3, "title": "キャラクター制作", "lessons": 3, "quality": 0.89 }
  ],
  "warnings": []
}
```

**失敗時** (品質不足):
```json
{
  "finalized": false,
  "reason": "overall_quality_score (0.62) is below threshold (0.70)",
  "weak_modules": [
    { "index": 1, "title": "基本モデリング操作", "quality": 0.55, "issues": ["..."] }
  ],
  "recommendation": "Module 2 の explanation を充実させてから再度 finalize してください"
}
```

---

## 既存ツール改修

### `save-curriculum-draft` — `header_only` 追加

```json
// 新オプション
{
  "curriculum": {
    "title": "Blender 3D入門",
    "summary": "4週間で学ぶ...",
    "modules": []
  },
  "intake": {...},
  "header_only": true
}
```

- `header_only: true` の場合、`modules: []` でもバリデーションエラーにしない
- `curriculum_id` を返却 → LLM はこれを使って `save-module-draft` を呼ぶ

### `get-generation-kit` — `compact_mode` + `generation_hints`

**Gap 3 反映**: デフォルトを compact に変更。フル版は明示的に要求。

```json
// compact_mode (デフォルト) — 約2KB
{
  "portal_id": "general",
  "learning_mode": "gentle",
  "quality_minimums": {
    "explanation_min_chars": 220,
    "practice_min_items": 2,
    "cautions_min_items": 1,
    "key_points_min_items": 3,
    "lesson_min_sections": 6
  },
  "required_slots": ["target_audience", "goal", "current_level", "duration_weeks"],
  "optional_slots": ["constraints", "tone", "delivery_style"],
  "lesson_fields": [
    "title", "objective", "summary", "explanation", "why_it_matters",
    "key_points", "examples", "practice", "checklist",
    "cautions", "reflection", "takeaway"
  ],
  "writing_rules": [
    "具体例から始めて抽象定義へ",
    "各レッスンは1つの主要アイデアに集中",
    "「今日はここまでで十分です」で締める",
    "練習は1-2件の軽いアクションに限定",
    "注意事項には必ず安心感を添える"
  ],
  "generation_hints": {
    "recommended_flow": [
      "1. research-topic で関連資料を調査",
      "2. validate-intake で要件を検証",
      "3. save-curriculum-draft(header_only) でヘッダー作成",
      "4. save-module-draft × N で各モジュールを順次生成・保存",
      "5. finalize-curriculum で全体を確定・公開"
    ],
    "token_strategy": "モジュール単位で生成するとトークン上限を回避できます",
    "quality_strategy": "quality_score が 0.75 を下回った場合は hint を参考に修正してください",
    "note": "上記は推奨フローです。状況に応じて順序を変更しても構いません。"
  },
  "personalization": {
    "derived_learning_profile": { "..." : "..." },
    "generation_rules": { "..." : "..." },
    "suggested_learning_mode": "gentle"
  },
  "full_kit_available": true,
  "full_kit_hint": "詳細なスキーマやテンプレートが必要な場合は get-generation-kit(compact: false) を呼んでください"
}
```

---

## LLM フローパターン

LLM が自由に選べる4パターン:

````carousel
**パターン A: フルリサーチ型** (推奨)
```
1. get-generation-kit(compact)    → 品質基準 + ヒント
2. research-topic(rag)            → 既存教材を検索
3. [web_search_hint=true なら]     → LLM が自身の web_search を使用
4. validate-intake                → 要件確定
5. save-curriculum-draft(header)  → ヘッダー作成
6. save-module-draft × N          → モジュール順次保存
   ↳ quality_score < 0.75 → revise → 再保存
7. finalize-curriculum            → 公開
```
<!-- slide -->
**パターン B: RAG のみ高速型**
```
1. get-generation-kit(compact)
2. research-topic(rag)
3. validate-intake
4. save-curriculum-draft(header)
5. save-module-draft × N
6. finalize-curriculum
```
Web 検索をスキップ。RAG で十分な情報がある場合。
<!-- slide -->
**パターン C: 一括保存型** (小規模)
```
1. get-generation-kit(compact)
2. validate-intake
3. save-curriculum-draft (全モジュール一括)
```
3モジュール以下で品質基準を満たせる場合。
既存の save-curriculum-draft をそのまま使用。
<!-- slide -->
**パターン D: 品質修正ループ型**
```
1. save-module-draft(module 0) → score: 0.62, recommendation: "revise"
2. LLM: explanation を充実、examples を追加
3. save-module-draft(module 0) → score: 0.88, recommendation: "accept"
4. save-module-draft(module 1) → score: 0.91, recommendation: "accept"
5. finalize-curriculum
```
品質スコアのフィードバックで反復改善。
````

---

## tool-registry.json 追記

```json
{
  "tool_id": "save-module-draft",
  "category": "curriculum_write",
  "risk": "write",
  "data_class": "curriculum",
  "requires_approval": false,
  "audit": true,
  "max_calls_per_session": 30,
  "exposure_profiles": ["curriculum-builder", "admin"],
  "annotations": {
    "title": "モジュール単位でカリキュラムを保存",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
},
{
  "tool_id": "research-topic",
  "category": "content_read",
  "risk": "read",
  "data_class": "educational",
  "requires_approval": false,
  "audit": false,
  "max_calls_per_session": 10,
  "exposure_profiles": ["curriculum-builder", "admin"],
  "annotations": {
    "title": "トピックを調査（RAG + Web ヒント）",
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": true
  }
},
{
  "tool_id": "finalize-curriculum",
  "category": "curriculum_write",
  "risk": "write",
  "data_class": "curriculum",
  "requires_approval": false,
  "audit": true,
  "max_calls_per_session": 5,
  "exposure_profiles": ["curriculum-builder", "admin"],
  "annotations": {
    "title": "カリキュラムを確定・公開",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

---

## 実装ファイルマップ

### 新規ファイル

#### [NEW] `tools/core/curriculumModule.js`
- `saveModuleDraft({ curriculum_id, module_index, module })` — モジュール保存 + 品質スコア
- `finalizeCurriculum({ curriculum_id })` — 結合 + 最終チェック + 公開
- `calculateQualityScore(lesson, minimums)` — 品質スコア算出
- `determineRecommendation(score, revisionCount, maxRevisions)` — 修正推奨判定

#### [NEW] `tools/core/researchTopic.js`
- `researchTopic({ query, sources, max_results })` — RAG 検索 + Web ヒント生成
- 内部で既存 `searchContent()` を再利用

---

### 変更ファイル

#### [MODIFY] `tools/core/curriculum.js`
- `saveDraft()`: `header_only` オプション追加。`modules: []` でもバリデーションパス
- `getKit()`: `compact` パラメータ追加。compact 時は quality_minimums + hints のみ返却

#### [MODIFY] `server/services/curriculumGenerationKit.js`
- `validateQualityRubric()`: モジュール単位モード追加
- `getCompactKit()`: Kit の軽量版を生成する関数

#### [MODIFY] `mcp-server/index.js`
- 新規3ツール (save-module-draft, research-topic, finalize-curriculum) のハンドラー登録

#### [MODIFY] `mcp-server/tool-registry.json`
- 上記3ツールの定義追加

---

## DB スキーマ

DDL 変更なし。既存カラムを再利用:

| カラム | 用途 |
|--------|------|
| `modules_json` | `save-module-draft` がモジュール単位で更新。`finalize-curriculum` が結合時に参照 |
| `curriculum_data` | `finalize-curriculum` が最終結合データを保存 |
| `status` | `draft` → `published` (finalize 時) |
| `intake_json` | `save-curriculum-draft(header_only)` で保存 |

---

## Verification Plan

### 自動テスト (node -e)

```bash
# T1: モジュール品質スコア算出
# 最低文字数以下 → score < 0.75, recommendation: "revise"

# T2: 修正ループ上限
# 同じモジュールを6回保存 → recommendation: "escalate"

# T3: finalize 品質ゲート
# 全モジュール score >= 0.75 → finalized: true
# 1モジュール score < 0.70 → finalized: false, weak_modules 返却

# T4: compact Kit サイズ確認
# compact: 2KB 以下 / full: 14KB
```

### MCP 経由 E2E テスト

```
1. get-generation-kit(compact)
   → generation_hints が含まれること
   → full_kit_hint が含まれること

2. research-topic("Blender 入門")
   → rag_results が返ること
   → web_search_hint.suggested が boolean であること

3. validate-intake(blender intake)
   → valid: true

4. save-curriculum-draft(header_only)
   → curriculum_id が返ること

5. save-module-draft × 3
   → quality_score + recommendation が返ること
   → revision_count がインクリメントされること

6. finalize-curriculum
   → status: "published"
   → overall_quality_score が返ること
```
