# 仕様概要（v0.1）

## 目的
- 対話 + 添付資料 + パーソナル診断に基づき、ユーザー専用の学習カリキュラムを設計する
- 生成物を UI テンプレに流し込める構造データとして保存・再編集・版管理する

## 範囲
- 入力: PDF / Audio / YouTube / TXT / DB
- 出力: ロードマップ + 各章教材 + テスト
- 保存: DBに構造化JSON、Storageに素材と生成物
- 運用: Cloud Run + Supabase

## 前提
- Big5 等のパーソナル診断は完了済み（`user_profile`として利用可能）
- PDF生成は必要時のみ
- メインモデルは Gemini 2.5 Pro（Claudeは将来差し替え）
- 既存の学習UIテンプレート（VibeCoding）を採用

## ユーザー体験（UX）
1. チャットで会話しながら要件をヒアリング
2. 必要に応じて素材を添付（PDF/Audio/YouTube/TXT/DB）
3. Requirements → Roadmap → Curriculum の順に承認
4. カード一覧 → ロードマップ → 章（ドキュメント）→ テスト

## 承認ポイント（固定3回）
- Requirements 承認
- Roadmap 承認
- Curriculum v1 承認（保存/公開）

## セッションの扱い（推奨）
- 生成中のみサーバ側に永続化し、ページ移動/再読込/別端末でも復帰できるようにする
- 保存対象は SessionState の要約（requirements/roadmap/curriculum draft・approved、pending_approval、mix系など）
- チャット全文や素材本文は Storage/イベントログへ分離し、state_json を小さく保つ
- Curriculum 承認後は `closed` にしてTTLで削除（例: 30〜90日）
- 生成完了後の正本は `curriculum_versions` を参照する

## 実装方針（追加）
1. 承認フローのエンドポイントを一本化し、status 遷移を明文化する
2. `doc_completed` に統一し、テンプレのバリデーション方針を定義する
3. ジョブclaim手順とベクトル索引（ivfflat/hnsw）を具体化する
4. `requirements_draft` 生成時に `curriculum_versions` を作成し、承認ログを同一 version へ集約する

## 学習フロー
- 章ページでドキュメント学習
- `doc_completed` → テスト開始
- 失敗時は復習ブロックへ

## パーソナル配分（重み設計）
### 指標
- `content_mix`: doc / chat / exercise / quiz / project
- `assessment_mix`: quiz / project / reflection / oral

### 適用順序
1. base 配分
2. Big5補正
3. 目的補正（試験/作品/面接など）
4. clamp（各要素 0.05〜0.60）
5. normalize（合計1.0）

### 補正式（例）
- Openness 高: project +0.10, doc +0.05
- Conscientiousness 高: quiz +0.10, doc +0.05
- Extraversion 高: chat +0.10
- Neuroticism 高: reflection +0.05, chat +0.05
- Agreeableness 高: reflection +0.05, exercise +0.05

## リスク回避
- 承認はUIボタンのみで判定（自然言語判定は禁止）
- テスト開始条件に `test_payload_ready` を含める
- ドキュメント完了は「スクロール + 滞在時間」または「完了ボタン」
