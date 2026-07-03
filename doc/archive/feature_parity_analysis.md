# Rise Path 機能パリティ分析: MCP vs WebUI vs REST API

> 調査日: 2026-05-01
> 調査対象: MCP Server (index.js), WebUI (ai.js + content.js + user.js), ChatGPT REST (chatgptCurriculum.js)

---

## 1. 全エンドポイント一覧

### 1.1 MCP ツール (10ツール)

| ツール | カテゴリ | 対応 WebUI | 対応 REST |
|--------|---------|:---:|:---:|
| `learner-state-get` | 進捗読取 | `GET /user/progress` | ❌ |
| `learner-state-update` | 進捗書込 | `PUT /user/progress/:id` | ❌ |
| `journal-log` | ジャーナル書込 | ❌ | `POST /curricula/:id/journal` |
| `journal-summary` | ジャーナル集計 | ❌ | `GET /curricula/:id/journal` |
| `journal-recent` | ジャーナル最新 | ❌ | `GET /journal/recent` |
| `rag-search` | 教材検索 | ❌ | ❌ |
| `get-generation-kit` | Kit取得 | 内部使用 | `POST /ai/generation-kit` |
| `validate-intake` | 要件検証 | 内部使用 | `POST /ai/validate-intake` |
| `save-curriculum-draft` | カリキュラム保存 | 内部使用 | `POST /ai/curriculum-drafts` |
| `learner-adaptation-signals` | 適応シグナル | ❌ | `GET /adaptation` |

### 1.2 WebUI エンドポイント (ai.js + content.js + user.js)

| エンドポイント | カテゴリ | 対応 MCP | 対応 REST |
|--------------|---------|:---:|:---:|
| `POST /ai/generate` | AI生成 (3段階) | `save-curriculum-draft` ※ロジック異なる | ❌ |
| `GET /ai/drafts` | ドラフト取得 | ❌ | ❌ |
| `GET /curricula` | カリキュラム一覧 | ❌ | ❌ |
| `GET /curricula/:id` | カリキュラム詳細 | ❌ | ❌ |
| `POST /upload` | 教材アップロード | ❌ | ❌ |
| `POST /image` | 画像生成 | ❌ | ❌ |
| `POST /rag/index` | RAGインデックス | ❌ | ❌ |
| `GET /jobs/:id` | ジョブ状態 | ❌ | ❌ |
| `GET /user/profile` | プロフィール取得 | ❌ | `GET /learner-profiles/latest` |
| `PUT /user/profile` | プロフィール更新 | ❌ | ❌ |
| `GET /user/progress` | 進捗取得 | `learner-state-get` | ❌ |
| `PUT /user/progress/:id` | 進捗更新 | `learner-state-update` | ❌ |
| `GET /user/events` | 学習イベント取得 | ❌ | ❌ |
| `POST /user/events` | 学習イベント記録 | ❌ | ❌ |
| `GET /user/notifications` | 通知取得 | ❌ | ❌ |
| `POST /user/notifications` | 通知作成 | ❌ | ❌ |
| `PUT /user/notifications/:id/read` | 既読化 | ❌ | ❌ |
| `GET /learning-portals` | ポータル一覧 | resource: `content://domains` ※異なるデータ | ❌ |

### 1.3 ChatGPT REST API (chatgptCurriculum.js) — MCP/WebUI にない機能

| エンドポイント | 機能 | 対応 MCP | 対応 WebUI |
|--------------|------|:---:|:---:|
| `POST /ai/personalization/derive` | パーソナライズ派生 | Kit内部で自動 | ❌ |
| `POST /learner-profiles/assessments` | アセスメント保存 | ❌ | アセスメントUIあり |
| `GET /learner-profiles/latest` | プロフィール取得 | resource: `learner://profile` | `GET /user/profile` ※スキーマ異なる |
| `GET /curricula/:id/resume` | 再開カード生成 | ❌ | ❌ |
| `POST /curricula/:id/weekly-load` | 週間負荷調整 | ❌ | ❌ |
| `GET /curricula/:id/summary-cards` | サマリーカード | ❌ | ❌ |
| `GET /curricula/:id/weekly-digest` | 週次ダイジェスト | ❌ | ❌ |
| `GET /curricula/:id/encyclopedia` | ミニ百科事典 | ❌ | ❌ |
| `POST /curricula/:id/publish` | カリキュラム公開 | ❌ | `POST /ai/generate` (stage=roadmap approved) |

---

## 2. ギャップ分析

### 🔴 MCP のみで可能 / WebUI では不可 (5件)

| # | 機能 | MCP ツール | WebUI に必要な変更 |
|---|------|-----------|-----------------|
| G1 | **ジャーナル記録・閲覧** | `journal-log`, `journal-summary`, `journal-recent` | WebUI にジャーナル入力フォーム + 閲覧画面が必要 |
| G2 | **RAG 教材検索** | `rag-search` | WebUI に検索UIが必要 (現在は内部自動のみ) |
| G3 | **適応シグナル取得** | `learner-adaptation-signals` | WebUI ダッシュボードに「学習適応」ウィジェットが必要 |
| G4 | **Kit / Intake の直接操作** | `get-generation-kit`, `validate-intake` | WebUI は内部でのみ使用 (ユーザー操作不可) |
| G5 | **対話的ヒアリング** | LLM が Kit の required_slots に基づき質問 | WebUI は1行入力のみ (ヒアリングなし) |

### 🟡 WebUI / REST のみで可能 / MCP では不可 (4件)

| # | 機能 | WebUI/REST エンドポイント | MCP に必要な変更 |
|---|------|------------------------|----------------|
| G6 | **教材アップロード + RAGインデックス** | `POST /upload`, `POST /rag/index` | MCP にファイルアップロードツールが必要 |
| G7 | **画像生成** | `POST /image` | MCP に画像生成ツール追加 (or LLM 側の機能を使用) |
| G8 | **通知機能** | `GET/POST /user/notifications` | MCP に通知ツール追加 |
| G9 | **カリキュラム一覧・詳細取得** | `GET /curricula`, `GET /curricula/:id` | MCP に `list-curricula`, `get-curriculum` ツール追加 |

### 🟠 両方存在するがロジック・スキーマが異なる (3件)

| # | 機能 | MCP | WebUI/REST | 差異 |
|---|------|-----|-----------|------|
| **D1** | **カリキュラム生成** | Kit取得 → ヒアリング → validate → save (LLM主導) | `POST /ai/generate` 3段階 (requirements → roadmap → curriculum) | **フロー全体が異なる**。MCP は LLM がフロー制御。WebUI はコードが3段階を強制 |
| **D2** | **進捗データ構造** | `learner-state-get`: domain ベース (lesson_id, mastery_level) | `GET /user/progress`: course_id ベース (completed_stages, completed_steps) | **スキーマが完全に異なる**。同じ「進捗」だが別テーブル・別構造 |
| **D3** | **プロフィール取得** | resource `learner://profile`: learner_profiles テーブル (raw_profile, derived_learning_profile) | `GET /user/profile`: user_profiles テーブル (display_name, avatar_url, role) | **別テーブル・別目的**。MCP は学習プロフィール、WebUI はユーザー基本情報 |

---

## 3. 詳細分析

### D1: カリキュラム生成フローの乖離 🔴

**最も深刻な差異**。同じ「カリキュラム生成」が2つの完全に異なるパスで実装されている。

```
MCP 経由:
  get-generation-kit → LLM がヒアリング → validate-intake → save-curriculum-draft
  特徴: LLM 主導, パーソナライズ注入, 品質バリデーション

WebUI 経由 (POST /ai/generate):
  stage=requirements → stage=roadmap → stage=curriculum
  特徴: コード主導, Gemini API 直接呼出, 3段階固定フロー
```

| 観点 | MCP | WebUI |
|------|-----|-------|
| ヒアリング | ✅ LLM が質問 | ❌ 1行入力のみ |
| パーソナライズ | ✅ Kit にプロフィール注入 | 🟡 Kit 経由で間接的に注入 |
| RAG | ✅ 明示的に rag-search | 🟡 ragService で自動実行 |
| 品質チェック | ✅ validateQualityRubric | ❌ なし |
| 修正ループ | ✅ revise → 再生成 | ✅ decision=revise で再生成 |
| Gemini API 呼出 | ❌ LLM 側が担当 | ✅ サーバー側で直接呼出 |

### D2: 進捗データの二重管理 🟡

| | MCP (learner_state) | WebUI (user_progress) |
|---|---|---|
| テーブル | `learner_state` | `user_progress` |
| キー | `domain` + `lesson_id` | `course_id` |
| データ | `mastery_level`, `score` | `completed_stages[]`, `completed_steps{}` |
| 用途 | AI カリキュラム用 | ゲーム/コース進捗用 |

→ 2つのテーブルがそれぞれ独立に進捗を管理。統合されていない。

### D3: プロフィールの二重管理 🟡

| | MCP (learner_profiles) | WebUI (user_profiles) |
|---|---|---|
| テーブル | `learner_profiles` | `user_profiles` |
| データ | `raw_profile`, `derived_learning_profile`, 9軸パーソナリティ | `display_name`, `avatar_url`, `role` |
| 用途 | AI パーソナライズ | UI 表示用 |

→ 別目的だが、ユーザーからは「プロフィール」として一つに見えるべき。

---

## 4. ChatGPT REST API 固有の機能 (MCP/WebUI にない)

chatgptCurriculum.js には、MCP にも WebUI にも存在しない高度な機能がある:

| 機能 | エンドポイント | 概要 |
|------|-------------|------|
| **再開カード** | `GET /curricula/:id/resume` | 学習者の現在位置から再開するためのコンテキスト生成 |
| **週間負荷調整** | `POST /curricula/:id/weekly-load` | 学習ペースの動的調整 |
| **サマリーカード** | `GET /curricula/:id/summary-cards` | モジュール別の要約カード生成 |
| **週次ダイジェスト** | `GET /curricula/:id/weekly-digest` | 今週の学習まとめ |
| **ミニ百科事典** | `GET /curricula/:id/encyclopedia` | カリキュラム内の用語辞典 |
| **アセスメント保存** | `POST /learner-profiles/assessments` | パーソナリティ診断結果の保存 |
| **カリキュラム公開** | `POST /curricula/:id/publish` | status を published に変更 |

→ これらは **ChatGPT Actions 向けに設計された REST API** であり、MCP ツールとしても WebUI としても未実装。

---

## 5. 推奨アクション

### 優先度: 高

| # | アクション | 理由 |
|---|-----------|------|
| **A1** | WebUI のカリキュラム生成にヒアリングステップを追加 | D1: 最大の UX 差異。WebUI ユーザーは品質の低いカリキュラムを受け取る |
| **A2** | MCP に `list-curricula` / `get-curriculum` ツール追加 | G9: MCP 経由で作成したカリキュラムを確認する手段がない |
| **A3** | 進捗データ統合の方針決定 | D2: 2テーブルの並行管理は長期的に破綻する |

### 優先度: 中

| # | アクション | 理由 |
|---|-----------|------|
| **A4** | WebUI にジャーナル入力 UI 追加 | G1: ジャーナルは MCP のみで記録可能。UI からの振り返りが不可 |
| **A5** | ChatGPT REST の固有機能を MCP ツールに移行 | 再開カード、週次ダイジェスト等は MCP 経由でも有用 |
| **A6** | プロフィール統合 | D3: user_profiles と learner_profiles を統合ビューで返す |

### 優先度: 低

| # | アクション | 理由 |
|---|-----------|------|
| **A7** | MCP に画像生成ツール追加 | G7: LLM 側の画像生成を使えば代替可能 |
| **A8** | MCP に通知ツール追加 | G8: 現状では LLM が通知を送る必要性は低い |

---

## 6. まとめ

```
           WebUI のみ    共有    MCP のみ    REST のみ
           ──────────  ──────  ──────────  ──────────
機能数        10         4        5           7
```

**最大の問題**: カリキュラム生成 (D1) の **フロー全体が異なる**。
- MCP: LLM 主導 + ヒアリング + 品質チェック
- WebUI: コード主導 + 1行入力 + 品質チェックなし

**2番目の問題**: 進捗 (D2) とプロフィール (D3) の **データが二重管理** されている。
