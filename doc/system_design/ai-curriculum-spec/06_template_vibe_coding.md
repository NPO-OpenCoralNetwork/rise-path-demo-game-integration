# VibeCoding テンプレ（JSON雛形）

## 必須キー
- `ui_template_id`: "vibe_coding"
- `modules[]` / `lessons[]`
- `lesson.ui_hints`
- `lesson.unlock_rule`
- `lesson.retry_policy`
- `lesson.citations[]`（RAG利用時）
- JSON Schema: `schemas/vibe_coding.schema.json`

## JSON例
```json
{
  "curriculum_id": "uuid",
  "version": 1,
  "ui_template_id": "vibe_coding",
  "title": { "jp": "Vibe Coding 入門", "en": "Vibe Coding Basics" },
  "description": { "jp": "GitとOSSを軸に学ぶロードマップ", "en": "Learn Git & OSS through story-driven lessons" },

  "content_mix": { "doc": 0.4, "chat": 0.1, "exercise": 0.3, "quiz": 0.2, "project": 0.0 },
  "assessment_mix": { "quiz": 0.5, "project": 0.2, "reflection": 0.2, "oral": 0.1 },

  "modules": [
    {
      "module_id": "m1",
      "title": "Gitの第一歩",
      "objective": "commitと履歴の概念を理解する",
      "prereq_modules": [],
      "estimated_hours": 3,
      "deliverable": "最初のGit履歴を作成",
      "assessment": "quiz",
      "module_ui_hints": {
        "card_title": "Gitの第一歩",
        "card_text": "履歴の概念と基本操作",
        "tags": ["Git", "CLI"],
        "difficulty": "easy"
      },
      "lessons": [
        {
          "lesson_id": "m1-l1",
          "summary": "commitと履歴の概念",
          "estimated_min": 20,
          "unlock_rule": "doc_completed",
          "retry_policy": "review_then_retry",

          "doc_blocks": [
            { "type": "text", "content": "commitは履歴のスナップショットです。" },
            { "type": "bullets", "items": ["git init", "git add", "git commit"] },
            { "type": "code", "language": "bash", "content": "git init\n git add .\n git commit -m \"first\"" }
          ],

          "exercises": [
            { "prompt": "READMEを作成してcommitしてください。", "expected": "git commit が実行されていること" }
          ],

          "quiz": [
            { "q": "commitの役割は？", "choices": ["履歴の記録", "ファイル削除", "同期"], "answer": 0 }
          ],

          "rubric": {
            "criteria": [
              { "name": "基本コマンドの実行", "weight": 0.6 },
              { "name": "説明の理解", "weight": 0.4 }
            ]
          },

          "resources": [
            { "title": "Pro Git 1.1", "url": "https://git-scm.com/book/en/v2" }
          ],

          "citations": [
            { "material_id": "uuid", "ref": "page:12", "quote": "commit is a snapshot..." }
          ],

          "ui_hints": {
            "card_title": "最初のコミット",
            "card_text": "履歴の概念を理解しよう",
            "cta": "学習を開始",
            "difficulty": "easy",
            "time": "20m",
            "tags": ["Git", "Basics"]
          }
        }
      ]
    }
  ]
}
```

## ルール
- `lesson_id` はカリキュラム内で一意（`module_id`と組み合わせ推奨）
- `citations` はRAG参照時のみ必須
- `estimated_min` は `min_read_time_sec` と整合させる

## バリデーション方針
- 生成時/保存時にJSONスキーマ検証を行い、違反は `revise` 扱い
- `unlock_rule` は `doc_completed` / `manual` / `immediate` のいずれか（`doc_complete` は禁止）
- `content_mix` / `assessment_mix` は合計 1.0（±0.01 以内）
- `lesson_id` / `module_id` は同一カリキュラム内で一意
- `citations` は `material_id` / `ref` / `quote` を必須にする
