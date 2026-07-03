# 段階移行プラン + vibe_codingマッピング案（v0.1）

このドキュメントは、既存UIを活かしつつ `vibe_coding` 仕様へ移行するための進め方と、
`vibe_coding` JSON を `GeneratedCourse` に変換するマッピング案をまとめたものです。

## 1. 目的
- `ui_template_id: "vibe_coding"` を共通テンプレとして生成・保存できる状態にする
- 既存UI（GeneratedCourse/GeneratedLesson）を崩さずに段階移行する
- 仕様（承認フロー、セッション復帰、RAG）に寄せる基盤を作る

## 2. 推奨進め方（段階移行 / Strangler）

### Phase 1: 基盤整備（DB/RLS/Storage）
- `03_database_rls.md` を適用し、`curricula` / `curriculum_versions` / `ai_sessions` / `approvals` を最小セットで導入
- Storage（raw/extracted/pdf）を準備、Auth/RLSが期待通り機能することを確認
- 出力: Supabase上で「保存・復元」できる状態

### Phase 2: オーケストレータAPI（状態管理と承認フロー）
- `/api/ai/chat` と `/api/curricula/:id/decision` を先に実装
- `ai_sessions.state_json` にセッション状態を保存（承認UIはボタンのみ）
- 出力: 3段階承認とセッション復帰が動く

### Phase 3: 既存UIに接続（変換アダプタ）
- `vibe_coding` → `GeneratedCourse` 変換アダプタを実装
- UIは変えず、バックエンドの生成物をそのまま表示できるようにする
- 出力: 既存UIが `vibe_coding` を表示可能

### Phase 4: Ingest/RAG/Jobs
- `materials` → `jobs(ingest/embed)` を実装し、`material_chunks` と `citations` を生成
- `/api/materials` / `/api/rag/index` / `/api/jobs/:id` を追加
- 出力: RAG参照 + citations まで到達

### Phase 5: PDF/音声
- `jobs` に `pdf` / `audio` を追加し、オンデマンド生成へ移行
- 出力: PDF/Audio生成がジョブで統一される

## 3. マッピング方針（vibe_coding → GeneratedCourse）

### 3.1 変換対象
- 入力: `vibe_coding` JSON（`modules[]` / `lessons[]` / `doc_blocks[]`）
- 出力: 既存の `GeneratedCourse` / `GeneratedChapter` / `slides[]`

### 3.2 全体マッピング
| Source (vibe_coding) | Target (GeneratedCourse) | メモ |
|---|---|---|
| `curriculum_id` | `course.id` | 無い場合はUUID採番 |
| `title` | `course.title` | `jp`/`en`をUI言語で解決 |
| `description` | `course.description` | 同上 |
| `ui_template_id` | `course.preferredTemplate` | `"vibe_coding"`を記録 |
| `version` | `course.createdAt` | `created_at`が無ければ現在時刻 |
| `content_mix` / `assessment_mix` | `course.personalizationReasoning` など | UI未使用だが保存 |

### 3.3 Module → Chapter
| Source (module) | Target (chapter) | メモ |
|---|---|---|
| `module_id` | `chapter.id` | そのまま |
| `title` | `chapter.title` | そのまま |
| `estimated_hours` | `chapter.duration` | `"{n}h"` へ整形 |
| `assessment` | `chapter.type` | quiz/project 等 |
| `objective` | `chapter.content` | 概要文 |
| `module_ui_hints.card_text` | `chapter.whyItMatters` | 無ければ `objective` |
| `module_ui_hints.tags` | `chapter.keyConcepts` | 無ければ空配列 |
| `deliverable` | `chapter.actionStep` | 無ければ空文字 |

### 3.4 Lesson → Slides（doc_blocks中心）
1 lesson = 1〜複数スライド。UIが `slides[]` を優先するため、まず `slides` を作る。

**優先順位**
1. `lesson.ui_hints.card_title` / `lesson.summary` をイントロスライドに使う  
2. `doc_blocks` を種類ごとにスライド化  
3. `exercises` / `quiz` / `resources` を末尾に追加

| Source (doc_blocks) | Target (slides) | 変換ルール |
|---|---|---|
| `type=text` | 1 slide | `bullets=[content]`, `speechScript=content` |
| `type=bullets` | 1 slide | `bullets=items` |
| `type=code` | 1 slide | `bullets=[code]` or `highlightBox=code` |
| `type=list` | 1 slide | `bullets=items`（将来拡張） |
| `type=callout` | 1 slide | `bullets=[text]` + `accentIcon` |
| `type=image` | 1 slide | `imagePrompt` へ反映（UIで使う場合） |

**追加スライド**
- `exercises[]` → "Workshop" slide（`prompt/expected` を bullets）
- `quiz[]` → "Quiz" slide（`q/choices` を bullets）
- `resources[]` → "Resources" slide（`title + url` を bullets）

### 3.5 Lesson → Chapterメタ
| Source (lesson) | Target (chapter) | メモ |
|---|---|---|
| `summary` | `chapter.whyItMatters` / `slides[].speechScript` | 章の動機付けに利用 |
| `ui_hints.difficulty` | `slides[].visualStyle` | テーマヒントに流用 |
| `ui_hints.time` | `slides[].highlightBox` | 目安時間として表示 |
| `ui_hints.tags` | `slides[].accentIcon` | 代表タグを1つ抽出 |
| `rubric` | (保存のみ) | 現UIは未使用 |
| `citations` | (保存のみ) | 将来の脚注UI向け |

### 3.6 フォールバック規則
- `slides` が空なら、`module.objective` から1枚スライドを生成
- `chapter.whyItMatters/analogy/keyConcepts/actionStep` が欠ける場合は
  `objective/summary/deliverable/tags` で補完
- ローカライズは `jp` → `en` → 文字列の順でフォールバック

## 4. アダプタ実装の形（例）
```
mapVibeCodingToGeneratedCourse(vibeJson, options) => {
  course: GeneratedCourse,
  meta: {
    raw: vibeJson,
    citationsByLesson: ...
  }
}
```
- 変換後も `raw` を保持しておき、将来 `vibe_coding` 専用UIに移行できるようにする
- `citations` は UI未対応のため `meta` へ保持（破棄しない）

## 5. 次のアクション（合意後）
1. アダプタの型定義と実装場所の決定（`services/` or `utils/`）
2. `GeneratedCourse` 表示に必要な最小フィールドの検証
3. `/api/ai/chat` のレスポンスで `vibe_coding` を返し、アダプタ経由で表示
