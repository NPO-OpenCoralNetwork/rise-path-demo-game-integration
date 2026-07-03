# ChatGPT MCP連携仕様

- 更新日: 2026-03-09
- 担当: Codex
- ステータス: Draft
- 文書種別: internal

## 目的 / 結論 / 次アクション

- 目的: `ChatGPT` から `Rise Path MCP` を通してカリキュラムを生成し、`Rise Path` を正本として保存・公開できる構成を定義する。
- 結論: 会話と本文生成は `ChatGPT`、ルール/テンプレート/検証/保存は `Rise Path backend`、接続と認証は `Rise Path MCP facade` が担当する。
- 次アクション:
1. `generation kit` API を追加する。
2. `validate / save draft / publish` API を追加する。
3. 既存の `Gemini` フローと `GPT-native` フローを並行運用できるようにする。

## 関連仕様

- 個人化された `generation_kit` と診断ベースの学習 profile は `11_personalized_generation_architecture.md` を参照
- web search と `source_bundle` 保存は `12_source_aware_generation.md` を参照

## 1. 背景

### 1.1 Confirmed Facts

- 現在の `Rise Path` カリキュラム生成は `POST /api/v2/ai/chat` を起点とした `Gemini` 中心の multi-step フローで動いている。
- 承認は `POST /api/v2/ai/curricula/:id/decision` で進み、最終 curriculum は `GET /api/v2/curricula/:id` で取得する。
- `ChatGPT` から使う場合でも、生成モデルと保存先システムは分離できる。
- `Nexloom` 側には `Rise Path` 専用 MCP endpoint を分離して公開する前提がある。

### 1.2 Assumptions

- `Rise Path` は curriculum template と persistence の正本である。
- `ChatGPT` は対話品質と草案生成を担うクライアントである。
- `Gemini` フローは既存 UI 向けに残し、`ChatGPT` 向けには別の保存フローを増やす。

## 2. 決定事項

### 2.1 採用する責務分離

- `ChatGPT`: ヒアリング、要件整理、本文生成
- `Rise Path MCP facade`: tool schema、auth、audit、transport
- `Rise Path backend`: generation kit、validation、draft save、publish
- `Nexloom`: remote MCP の公開基盤と OAuth 基盤

### 2.2 なぜ `Rise Path` がルールを持つのか

- カリキュラム仕様の変更点を `Rise Path` だけで更新できる
- `ChatGPT` 以外の UI や他クライアントでも同じルールを使える
- 将来 `GPT` 以外のモデルに変えても保存 schema を維持できる
- 長い prompt を毎回配るより、テンプレートと validation を API 化した方が安定する

### 2.3 並行運用方針

初期は 2 系統を併存させる。

- 既存系:
  - `Gemini` が生成
  - `POST /api/v2/ai/chat`
  - `POST /api/v2/ai/curricula/:id/decision`
- 新規系:
  - `ChatGPT` が生成
  - `generation kit -> validate -> save draft -> publish`

## 3. GPT-native Runtime Flow

```text
ChatGPT
  -> rise_path.get_generation_kit
  -> ユーザーへヒアリング
  -> rise_path.validate_intake
  -> ChatGPT が curriculum draft を生成
  -> rise_path.save_curriculum_draft
  -> 必要なら rise_path.publish_curriculum
```

ポイント:

- `ChatGPT` は本文生成まで担当する
- 保存前に必ず `Rise Path` 側 validation を通す
- `publish` は `draft save` と分ける

## 4. API Contract

### 4.1 `POST /api/v2/ai/generation-kit`

目的:

- `ChatGPT` がヒアリング前に必要な slots、質問順、制約、出力 schema を取得する

request:

```json
{
  "portal_id": "village_welcome",
  "locale": "ja-JP",
  "template_id": "default"
}
```

response:

```json
{
  "portal_id": "village_welcome",
  "template_id": "default",
  "schema_version": "2026-03-09",
  "policy_version": "2026-03-09.a",
  "required_slots": ["target_audience", "goal", "duration_weeks"],
  "optional_slots": ["constraints", "tone", "delivery_style"],
  "question_order": ["target_audience", "goal", "current_level", "duration_weeks"],
  "constraints": {
    "max_modules": 12,
    "max_lessons_per_module": 10
  },
  "output_schema": {},
  "save_defaults": {
    "status": "draft",
    "is_public": true
  }
}
```

### 4.2 `POST /api/v2/ai/validate-intake`

目的:

- ヒアリング済み intake を `Rise Path` 正本ルールで検証する

request:

```json
{
  "template_id": "default",
  "policy_version": "2026-03-09.a",
  "intake": {
    "target_audience": "日本移住予定者",
    "goal": "地域生活の立ち上がりを2週間で理解する",
    "duration_weeks": 2
  }
}
```

response:

```json
{
  "valid": true,
  "missing_fields": [],
  "conflicts": [],
  "recommended_followups": [],
  "normalized_intake": {
    "target_audience": "日本移住予定者",
    "goal": "地域生活の立ち上がりを2週間で理解する",
    "duration_weeks": 2
  }
}
```

### 4.3 `POST /api/v2/ai/curriculum-drafts`

目的:

- `ChatGPT` が生成した curriculum draft を `Rise Path` に保存する

request:

```json
{
  "portal_id": "village_welcome",
  "template_id": "default",
  "policy_version": "2026-03-09.a",
  "intake": {},
  "curriculum": {},
  "generation_meta": {
    "provider": "openai",
    "model": "gpt-5",
    "source_connector": "chatgpt_mcp",
    "session_id": "sess_xxx"
  }
}
```

response:

```json
{
  "curriculum_id": "curr_xxx",
  "curriculum_version_id": "ver_xxx",
  "status": "draft",
  "saved_at": "2026-03-09T10:00:00Z"
}
```

### 4.4 `POST /api/v2/curricula/:id/publish`

目的:

- review 済みの draft を公開状態へ遷移させる

request:

```json
{
  "curriculum_version_id": "ver_xxx"
}
```

response:

```json
{
  "ok": true,
  "status": "published",
  "published_at": "2026-03-09T10:10:00Z"
}
```

## 5. MCP Tool Contract

`Rise Path MCP` では次を公開対象とする。

1. `rise_path.get_generation_kit`
2. `rise_path.validate_intake`
3. `rise_path.save_curriculum_draft`
4. `rise_path.publish_curriculum`
5. 既存互換として `rise_path.generate_curriculum`

補足:

- `rise_path.generate_curriculum` は既存 `Gemini` フローの proxy として残してよい
- 新規の `ChatGPT` 運用では `get_generation_kit` 系を優先する

## 6. 保存データ方針

最低限、保存時に以下を保持する。

- `template_id`
- `policy_version`
- `intake_json`
- `curriculum_json`
- `generation_meta.provider`
- `generation_meta.model`
- `generation_meta.source_connector`
- `generation_meta.session_id`

これにより、後から次を判別できるようにする。

- `Gemini` 生成物か `GPT` 生成物か
- どの template/policy で作られたか
- どの connector/session から保存されたか

## 7. 認証 / 監査

- `ChatGPT` の bearer token は `Rise Path` にそのまま委譲しない
- `Rise Path MCP facade -> Rise Path backend` は bridge token で認証する
- `X-Nexloom-User-Id` と `X-Nexloom-Organization-Id` は監査用途で受けてよい
- `save draft` と `publish` は audit log 対象にする

## 8. 既存 Gemini フローとの関係

この仕様は既存フローを即時廃止するものではない。

- `Rise Path` UI 内の対話生成は当面 `Gemini` のままでよい
- `ChatGPT` 経由の連携だけ `GPT-native` フローを採用してよい
- 将来、`Rise Path` 内部 UI でも同じ `generation kit` を使うなら、最終的に統合しやすい

## 9. ToDo

1. `generation kit` API 実装
2. `validate-intake` API 実装
3. `curriculum-drafts` 保存 API 実装
4. `publish` API の draft/version 対応確認
5. `generation_meta` を保存できる DB schema 拡張
6. bridge token middleware と audit log の追加

## 10. リスク / ブロッカー

- `ChatGPT` 生成結果を server-side validation なしで保存すると template 制約を外れやすい
- 現在の `PHASE1_USER_ID` 前提は multi-tenant 運用に向かない
- 既存 curriculum schema が `Gemini` 出力に寄っている場合、`GPT` 保存 payload との正規化が必要
- `draft` と `publish` を分けないと誤公開しやすい
