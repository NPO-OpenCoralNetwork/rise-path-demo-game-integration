# API設計（v0.1）

## 認証
- フロントは Supabase Auth でJWT取得
- Cloud Run API は `Authorization: Bearer <jwt>` を受け取り検証

## 関連仕様

- `ChatGPT / MCP` 連携と `GPT-native` 保存フローは `10_chatgpt_mcp_integration.md` を参照
- 個人化された `generation_kit` と診断ベースの profile API は `11_personalized_generation_architecture.md` を参照
- web search を伴う `source-aware generation` は `12_source_aware_generation.md` を参照
- `Vercel frontend + 常駐 backend` の配信分離計画は `13_delivery_separation_plan.md` を参照

## Cloud Run API

### POST /api/ai/chat
**目的**: 会話入力を受けて状態を更新し、次の質問/提案/承認UIを返す

**補足**
- `session_id` は省略可。未指定時は新規セッション作成し、レスポンスで返す
- 状態は `ai_sessions.state_json` に保存し、毎リクエストで更新する
- `requirements_draft` 生成時に `curriculum_versions` を作成し、`curriculum_version_id` を state に保持する
- 承認/修正は `/api/curricula/:id/decision` に統一する

**Request**
```json
{
  "session_id": "uuid",
  "message": "...",
  "attachments": [{ "material_id": "uuid" }]
}
```

**Response**
```json
{
  "session_id": "uuid",
  "curriculum_version_id": "uuid",
  "message": "...",
  "pending_approval": "requirements",
  "ui": {
    "type": "approval",
    "options": ["approved", "revise"]
  },
  "state_summary": {
    "requirements": { "draft": { } }
  }
}
```

### POST /api/materials
**目的**: Storageにアップロード後、materialsメタを登録

**Request**
```json
{
  "type": "pdf",
  "title": "...",
  "source_url": null,
  "storage_path": "materials/xxx.pdf"
}
```

**Response**
```json
{ "material_id": "uuid", "status": "uploaded" }
```

### POST /api/rag/index
**目的**: 素材解析/embeddingのジョブを作成

**Request**
```json
{ "material_id": "uuid" }
```

**Response**
```json
{ "job_id": "uuid", "status": "queued" }
```

### GET /api/jobs/:id
**目的**: 非同期ジョブの進捗

**Response**
```json
{ "status": "running", "progress": 60 }
```

### POST /api/curricula/:id/decision
**目的**: 承認/修正指示のエンドポイントを一本化し、承認ログと状態遷移を記録

**補足**
- `curriculum_version_id` はセッション状態から取得する（`requirements_draft` 生成時に作成済み）
- `stage=requirements/roadmap` は同一 version を更新し、`stage=curriculum` の approved で status を更新する

**Request**
```json
{
  "stage": "requirements",
  "decision": "approved",
  "feedback_text": null,
  "session_id": "uuid"
}
```

**Response**
```json
{
  "ok": true,
  "curriculum_version_id": "uuid",
  "status": "draft",
  "pending_approval": "roadmap"
}
```

**status 遷移（curriculum_versions.status）**
- `draft` → `approved`: `stage=curriculum` の approved 時
- `approved` → `published`: 公開操作時（任意、別操作）
- `revise` は status を戻さず、再生成時に新しい `draft` を作成する

### POST /api/curricula/:id/pdf
**目的**: オンデマンドPDF生成

**Response**
```json
{ "job_id": "uuid", "status": "queued" }
```

### POST /api/generate-audio
**目的**: 音声生成（lesson単位でStorage保存）
**補足**: `jobs.type=audio` を作成し、Worker が処理する

---

## Admin API（service role）
**補足**
- 認証はJWT、運用者判定は `learning_portal_admins` を参照
- 更新は service role で実行（RLSをバイパス）

### POST /api/admin/learning-portals/reorder
**目的**: learning_portals の並び替え

**Request**
```json
{
  "order": [
    { "id": "vibe", "sort_order": 10 },
    { "id": "unity", "sort_order": 20 }
  ]
}
```

**Response**
```json
{ "ok": true }
```

### PATCH /api/admin/learning-portals/:id
**目的**: learning_portals の有効/無効、並び順を更新

**Request**
```json
{ "is_active": true, "sort_order": 15 }
```

**Response**
```json
{ "ok": true, "portal": { "id": "vibe", "is_active": true, "sort_order": 15 } }
```

### POST /api/admin/learning-portals/admins
**目的**: learning_portal_admins の追加/削除

**Request**
```json
{ "action": "add", "user_id": "uuid" }
```

**Response**
```json
{ "ok": true }
```

**認可フロー（擬似コード）**
```ts
async function requirePortalAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const claims = verifyJwt(token);
  const userId = claims?.sub;
  if (!userId) throw new HttpError(401, 'unauthorized');

  const { data } = await serviceRole
    .from('learning_portal_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) throw new HttpError(403, 'forbidden');
  return userId;
}
```

## Supabase直接アクセス（フロント）
- `curricula` / `curriculum_versions` / `curriculum_progress`
- `materials` / `material_chunks`
- `learning_portals`（カード一覧）

## 運用ルール
- AI関連は Cloud Run 経由（コスト/監査/レート制御）
- DB読み書きはRLSで保護（ユーザー単位）
