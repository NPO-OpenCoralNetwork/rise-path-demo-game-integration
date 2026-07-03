# Phase 13-C: AI カリキュラム生成 復活 仕様書

> 前提: `phase13_ui_integration_spec.md`, `system_spec_v4.md`
> ステータス: LangGraph 撤去済み → エンドポイント 410 Gone → 復活が必要

---

## 1. 現状分析

### フロントエンド (CourseGeneratorView.tsx, 675行)
- 完成度の高いチャット UI（承認フロー、ロードマップ表示、ReactMarkdown）
- **デモモード** (`VITE_DEMO_MODE !== 'false'`) でローカルデータを使い動作する
- 本番モード時は `sendAiChat()` → `POST /api/v2/ai/chat` → **410 Gone**

### バックエンド (server/routes/ai.js, 34行)
- LangGraph 撤去後、全エンドポイントが 410 を返すスタブ
- `POST /ai/chat` と `POST /ai/curricula/:id/decision` が死んでいる

### MCP (既存・動作中)
- `get-generation-kit` — Kit 取得 (プロファイル + 適応注入済み)
- `validate-intake` — 学習要件のバリデーション
- `save-curriculum-draft` — カリキュラム JSON の保存

### API サービス (services/curriculumApi.ts, 2890行)
- `sendAiChat()` — デモモードのフォールバック実装あり (L2724-2767)
- `sendAiDecision()` — 3段階承認フロー (requirements → roadmap → curriculum)
- `fetchGeneratedCourseById()` — 保存済みカリキュラム取得

---

## 2. 設計方針

### 選択肢と判断

| 方式 | 利点 | 欠点 | 判定 |
|------|------|------|:---:|
| A: フロントから直接 Gemini | シンプル、サーバー不要 | API キー露出、認証不可 | ❌ |
| B: バックエンド新 API | 認証・監査可能、Kit 活用 | 実装工数やや大 | ✅ |
| C: MCP 経由のみ | 既存ツール再利用 | フロントから MCP 直接呼び出し困難 | ❌ |

**方式 B を採用**: `POST /api/v2/ai/generate` 新設。
バックエンドで Kit → Gemini prompt → 構造化出力 → curricula 保存。

---

## 3. API 仕様

### POST /api/v2/ai/generate

3段階の会話型フローを1つのエンドポイントで処理。

```
Request:
  POST /api/v2/ai/generate
  Authorization: Bearer <JWT> (or dev-fallback)
  Content-Type: application/json

  # Phase 1: 初回メッセージ
  {
    "message": "Blender入門を学びたい",
    "session_id": null,
    "stage": "requirements"
  }

  # Phase 2: 承認 or 修正
  {
    "message": null,
    "session_id": "uuid",
    "curriculum_id": "uuid",
    "stage": "requirements",
    "decision": "approved"  // or "revise" with message
  }

  # Phase 3: カリキュラム確定
  {
    "session_id": "uuid",
    "curriculum_id": "uuid",
    "stage": "curriculum",
    "decision": "approved"
  }
```

```
Response (共通構造):
  200 OK
  {
    "session_id": "uuid",
    "curriculum_id": "uuid",
    "message": "Markdown 形式のメッセージ",
    "pending_approval": "requirements" | "roadmap" | "curriculum" | "none",
    "status": "pending" | "approved",
    "agent_logs": [
      { "agent": "kit", "message": "プロファイル注入完了", "status": "success" },
      { "agent": "gemini", "message": "カリキュラム生成中...", "status": "running" }
    ]
  }
```

---

## 4. バックエンド実装

### 4.1 ファイル構成

```
server/routes/ai.js          — ルーティング (復活)
server/services/aiGenerator.js — [NEW] Gemini 呼び出し + プロンプト構築
```

### 4.2 aiGenerator.js 設計

```javascript
// server/services/aiGenerator.js

import { GoogleGenAI } from '@google/genai';
import { retrieveContext } from '../ragService.js';

const MODEL = process.env.AI_GENERATE_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 45000;

async function callGemini(systemPrompt, userMessage) {
  const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
  const result = await genAI.models.generateContent({
    model: MODEL,
    systemInstruction: systemPrompt,
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    },
  });
  const text = result.text;
  let structuredData = null;
  try { structuredData = JSON.parse(text); } catch { /* keep as text */ }
  return { text, structuredData };
}

export async function generateRequirements(message, userId, kit) {
  const systemPrompt = await buildSystemPrompt(kit, 'requirements', message, userId);
  const result = await callGemini(systemPrompt, message);
  return { message: result.text, intake: result.structuredData };
}

export async function generateRoadmap(intake, userId, kit) {
  const systemPrompt = await buildSystemPrompt(kit, 'roadmap', null, userId);
  const result = await callGemini(systemPrompt, JSON.stringify(intake));
  return { message: result.text, modules: result.structuredData };
}

export async function generateCurriculum(intake, modules, userId, kit) {
  const systemPrompt = await buildSystemPrompt(kit, 'curriculum', null, userId);
  const result = await callGemini(systemPrompt, JSON.stringify({ intake, modules }));
  return { curriculum: result.structuredData };
}
```

### 4.3 プロンプト設計

```
[System]
あなたは Rise Path の AI カリキュラムデザイナーです。

## 学習者プロファイル
{kit.personalization.derived_learning_profile}

## 適応シグナル
{kit.personalization.adaptation.signals}

## 生成ルール
- explanation_style: {rules.explanation_style}
- assessment_style: {rules.assessment_style}
- curriculum_voice: {rules.curriculum_voice}
- weekly_load: {rules.weekly_load_policy}

## 出力形式
{kit.schema}  // Curriculum JSON Schema

## タスク
[requirements] → 学習要件を構造化して提案
[roadmap] → モジュール・レッスン構成を設計
[curriculum] → 完全なカリキュラム JSON を生成
```

### 4.4 中間状態の永続化

> ⚠️ フロント state のみでの管理はリロードで全消失するため、DB に保存する。

**方式**: `curricula` テーブルの `status` カラムで draft 段階を管理。

```sql
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
-- 遷移: draft_requirements → draft_roadmap → draft_curriculum → published
```

| 段階 | status | 保存内容 |
|------|--------|----------|
| requirements 承認後 | `draft_requirements` | intake JSON |
| roadmap 承認後 | `draft_roadmap` | intake + modules JSON |
| curriculum 確定 | `published` | 完全なカリキュラム JSON |

リロード時、フロントは `GET /api/v2/curricula?status=draft_%` で未完了セッションを復帰。

### 4.5 Kit キャッシュ

> 3段階で3回 `getKit()` は非効率。セッション内でキャッシュする。

```javascript
const kitCache = new Map(); // key: userId, value: { kit, expiresAt }
const KIT_TTL_MS = 5 * 60 * 1000; // 5分

async function getCachedKit(userId) {
  const cached = kitCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.kit;
  const kit = await getKit({ userId });
  kitCache.set(userId, { kit, expiresAt: Date.now() + KIT_TTL_MS });
  return kit;
}
```

### 4.6 RAG コンテキスト注入

```javascript
import { retrieveContext } from '../ragService.js';

async function buildSystemPrompt(kit, stage, userMessage, userId) {
  let ragContext = '';
  if (stage === 'requirements' && userMessage) {
    const chunks = await retrieveContext(userMessage, 3, userId);
    if (chunks.length > 0) {
      ragContext = `\n## 参考資料 (RAG)\n${chunks.join('\n---\n')}`;
    }
  }
  return `${basePrompt(kit, stage)}${ragContext}`;
}
```

### 4.7 ストリーミング対応

| Phase | ストリーミング | 理由 |
|-------|:---:|------|
| 1 (requirements) | ❌ | レスポンスが短い (~200文字)。遅延を agent_logs で演出 |
| 2 (roadmap) | ❌ | 同上 |
| 3 (curriculum) | ✅ (将来) | JSON 生成は長い。Phase 1 では非ストリーミングで MVP |

**MVP はノンストリーミング**。フロントの既存 agent_logs アニメーションでUXをカバー。

### 4.8 タイムアウト対策

| 層 | 閾値 | 対処 |
|---|:---:|------|
| Gemini API | 45s | `requestOptions.timeout = 45000` |
| Express | 60s | ルートに `req.setTimeout(60000)` |
| フロント fetch | 60s | `AbortController` + `setTimeout` |
| UX | 10s | 10秒経過で「まだ生成中です…」追加メッセージ |

---

## 5. フロントエンド修正

### 5.1 curriculumApi.ts

`sendAiChat` の本番パスを新エンドポイントに変更:

```typescript
// L2757 を変更
const response = await fetch(`${API_BASE}/ai/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, session_id: sessionId, stage: 'requirements', attachments }),
});
```

`sendAiDecision` も同様:

```typescript
const response = await fetch(`${API_BASE}/ai/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: sessionId,
    curriculum_id: curriculumId,
    stage,
    decision,
    message: feedbackText,
  }),
});
```

### 5.2 エラー表示

```typescript
// Gemini 障害時
if (res.status === 503) {
  setError(language === 'jp' 
    ? 'AI が一時的に利用できません。しばらくしてから再試行してください。'
    : 'AI is temporarily unavailable. Please try again later.');
  return;
}
```

---

## 6. コスト管理

### 6.1 トークン推定

| 段階 | Input | Output | コスト (Flash) |
|------|:---:|:---:|:---:|
| requirements | ~2K | ~500 | ~$0.001 |
| roadmap | ~3K | ~2K | ~$0.003 |
| curriculum | ~5K | ~10K | ~$0.01 |
| **1回の完全生成** | **~10K** | **~12K** | **~$0.014** |

### 6.2 制限ルール

| 制限 | 値 | 実装 |
|------|:---:|------|
| ユーザー日次生成回数 | 5回 | DB: `daily_generation_count` チェック |
| 失敗リクエスト | カウントしない | HTTP 5xx 時はカウント除外 |
| モデル選択 | Flash (デフォルト) | Pro は将来の有料プランで開放 |

```javascript
// ai.js ルート内
const dailyCount = await pool.query(
  `SELECT COUNT(*) FROM curricula WHERE user_id = $1
   AND created_at > NOW() - INTERVAL '1 day' AND status != 'error'`, [userId]
);
if (dailyCount.rows[0].count >= 5) {
  return res.status(429).json({ error: '日次生成上限（5回）に達しました' });
}
```

---

## 7. 実装計画

| # | タスク | ファイル | 工数 |
|---|-------|---------|:---:|
| C-0 | `curricula` テーブルに `status` カラム追加 | DB migration | 極小 |
| C-1 | `aiGenerator.js` 新規作成 (Kit→RAG→Gemini→構造化出力) | server/services/aiGenerator.js | 中 |
| C-2 | `ai.js` ルート復活 + コスト制限 + タイムアウト | server/routes/ai.js | 小 |
| C-3 | プロンプトテンプレート (3段階 + RAG注入) | server/services/aiPrompts.js | 中 |
| C-4 | `curriculumApi.ts` 接続先変更 + AbortController | services/curriculumApi.ts | 小 |
| C-5 | エラー + タイムアウト + 長時間待機 UI | CourseGeneratorView.tsx | 小 |
| C-6 | E2E テスト (3段階 + リロード復帰) | ブラウザ | 中 |

### 実行順序

```
Day 1: C-0 → C-1 → C-2 → C-3  (バックエンド完成)
Day 2: C-4 → C-5               (フロント接続)
Day 3: C-6                     (E2E テスト)
```

---

## 8. エラーケース

| エラー | HTTP | フロント表示 |
|--------|:---:|------------|
| Gemini API 障害 | 503 | 「AI 一時停止中」バナー |
| Kit 取得失敗 (DB 障害) | 503 | 「サーバーエラー」+ リトライボタン |
| 構造化出力パース失敗 | 422 | 「生成に失敗しました。再試行してください」 |
| レート制限超過 | 429 | 「リクエスト上限に達しました」+ 残り時間表示 |
| 認証エラー | 401 | ログイン画面へリダイレクト |
| タイムアウト | 504 | 「生成がタイムアウトしました。再試行してください」 |

---

## 9. テスト計画

```bash
# 1. requirements 生成テスト
curl -s -X POST http://localhost:3006/api/v2/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"message":"「Blender入門を学びたい","stage":"requirements"}' \
  | jq '.session_id, .pending_approval'

# 2. roadmap 生成テスト (session_id を使用)
curl -s -X POST http://localhost:3006/api/v2/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"<from step 1>","stage":"requirements","decision":"approved"}' \
  | jq '.pending_approval'

# 3. Kit にプロファイルが注入されているか確認
curl -s http://localhost:3006/api/v2/generation-kit?include_personalization=true \
  | jq '.personalization | keys'

# 4. コスト制限テスト (日次5回以降は 429)
for i in $(seq 1 6); do
  echo "Attempt $i:"
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3006/api/v2/ai/generate \
    -H 'Content-Type: application/json' \
    -d '{"message":"test","stage":"requirements"}'
  echo
done

# 5. draft 復帰テスト
curl -s http://localhost:3006/api/v2/curricula?status=draft_% | jq '.[0].status'
```

### 完了条件

1. `VITE_DEMO_MODE=false` でブラウザ起動
2. 「Blender入門」入力 → requirements 提案表示
3. 「承認」→ ロードマップ表示
4. 「承認」→ カリキュラム生成 → `curricula` テーブルに保存
5. 「My Content」に新コースが表示される
6. ⦿ **roadmap 段階でリロード** → draft から復帰して続行できる
7. ⦿ 6回目の生成リクエストが **429** を返す
