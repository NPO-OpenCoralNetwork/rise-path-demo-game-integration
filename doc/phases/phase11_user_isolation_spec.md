# Phase 11: MCP User Isolation & Tool Exposure v3

> ステータス: 設計完了 / 実装待ち
> 優先度: P0（マルチユーザー対応の前提条件）
> 最終更新: 2026-05-01
> レビュー: 外部 LLM レビュー反映済み

---

## 背景

現在の MCP Server は全クライアントが同一ユーザー（`PHASE1_USER_ID = 000...001`）として動作する。
Phase 1 の開発便宜だが、以下のリスクがある：

1. **user_id 詐称**: MCP パラメータで任意の user_id を渡すと他人のデータにアクセスできる
2. **全員同一ユーザー**: user_id 未指定時に全クライアントが同じデータを共有
3. **Tool 全公開**: 全 client に全9ツールが見える（role 別制御なし）
4. **fail-open**: profile 未指定時に admin 相当のフルアクセスになる
5. **ListTools 非表示 ≠ アクセス制御**: 隠しても直接 `tools/call` で呼べる

---

## 設計原則

> **「_meta.agent_profile に依存しない」**
>
> ChatGPT / Claude Desktop / Antigravity / Codex CLI などの汎用 MCP client は
> `_meta.agent_profile` を送信しない。client 非対応の機能に依存した設計は不可。

> **「fail-closed」**
>
> profile 未指定時のデフォルトは `learner`（最小権限）。
> `admin` は明示的指定時のみ有効化。

> **「ListTools + CallTool 二重チェック」**
>
> ListTools で非表示にしても CallTool で直接呼べるため、
> 両方で profile enforcement する。

---

## 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `mcp-server/index.js` | profile filtering, CallTool enforcement |
| `mcp-server/auth.js` | **[NEW]** resolveUserId, assertToolAllowed |
| `mcp-server/policy.js` | **[NEW]** rate limit, audit |
| `mcp-server/tool-registry.json` | **[NEW]** 全ツールメタデータ |
| `tools/core/learnerState.js` | resolveUserId 使用 |
| `tools/core/journal.js` | resolveUserId 使用 |
| `tools/core/curriculum.js` | resolveUserId 使用、preview/commit 分離 |
| `tools/core/learnerProfile.js` | resolveUserId 使用 |

---

## 11-1. Tool Registry

### `mcp-server/tool-registry.json`

全ツールの risk / category / approval / exposure_profiles を一元管理。

```json
{
  "version": "2026-05-01",
  "server": "rise-path-learning",
  "default_profile": "learner",
  "tools": [
    {
      "tool_id": "learner-state-get",
      "category": "progress_read",
      "risk": "read",
      "data_class": "learner_data",
      "requires_approval": false,
      "audit": false,
      "exposure_profiles": ["learner", "coach", "admin"],
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      }
    },
    {
      "tool_id": "learner-state-update",
      "category": "progress_write",
      "risk": "write",
      "data_class": "learner_data",
      "requires_approval": false,
      "audit": true,
      "idempotency_key": "recommended",
      "undo_supported": true,
      "max_calls_per_session": 20,
      "exposure_profiles": ["learner", "admin"],
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      }
    },
    {
      "tool_id": "journal-log",
      "category": "journal_write",
      "risk": "write",
      "data_class": "learner_private",
      "requires_approval": false,
      "audit": true,
      "max_calls_per_session": 10,
      "retention_policy": "user_controlled",
      "exposure_profiles": ["learner", "admin"],
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      }
    },
    {
      "tool_id": "journal-recent",
      "category": "journal_read",
      "risk": "read",
      "data_class": "learner_private",
      "requires_approval": false,
      "audit": false,
      "exposure_profiles": ["learner", "coach", "admin"],
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "openWorldHint": false
      }
    },
    {
      "tool_id": "journal-summary",
      "category": "journal_read",
      "risk": "read",
      "data_class": "aggregated",
      "requires_approval": false,
      "audit": false,
      "exposure_profiles": ["coach", "admin"],
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "openWorldHint": false
      }
    },
    {
      "tool_id": "rag-search",
      "category": "content_read",
      "risk": "read",
      "data_class": "educational",
      "requires_approval": false,
      "audit": false,
      "exposure_profiles": ["learner", "curriculum-builder", "coach", "admin"],
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "openWorldHint": false
      },
      "note": "openWorldHint を false にしている前提: 教材は管理者がインジェスト済み。外部URL取得やユーザー生成教材を追加する場合は true に変更し、prompt injection 対策を追加する"
    },
    {
      "tool_id": "get-generation-kit",
      "category": "curriculum_meta",
      "risk": "read",
      "data_class": "system_config",
      "requires_approval": false,
      "audit": false,
      "exposure_profiles": ["curriculum-builder", "admin"],
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "openWorldHint": false
      }
    },
    {
      "tool_id": "validate-intake",
      "category": "curriculum_meta",
      "risk": "read",
      "data_class": "user_input",
      "requires_approval": false,
      "audit": false,
      "exposure_profiles": ["curriculum-builder", "admin"],
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "openWorldHint": false
      }
    },
    {
      "tool_id": "preview-curriculum-draft",
      "category": "curriculum_preview",
      "risk": "read",
      "data_class": "curriculum",
      "requires_approval": false,
      "audit": false,
      "exposure_profiles": ["curriculum-builder", "admin"],
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "openWorldHint": false
      },
      "note": "旧 save-curriculum-draft の dry-run 版。DB保存しない。warnings/diff/normalized curriculum を返す"
    },
    {
      "tool_id": "commit-curriculum-draft",
      "category": "curriculum_write",
      "risk": "write",
      "data_class": "curriculum",
      "requires_approval": true,
      "audit": true,
      "max_calls_per_session": 5,
      "exposure_profiles": ["curriculum-builder", "admin"],
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      },
      "note": "preview-curriculum-draft で返された confirmation_token が必須。token なしの呼び出しはエラー"
    }
  ]
}
```

### Profile → Tool マッピング（registry から自動導出）

| Profile | 見えるツール | 合計 |
|---------|-------------|:---:|
| `learner` | state-get, state-update, journal-log, journal-recent, rag-search | 5 |
| `curriculum-builder` | generation-kit, validate-intake, preview-draft, commit-draft, rag-search | 5 |
| `coach` | state-get, journal-recent, journal-summary, rag-search | 4 |
| `admin` | 全10ツール | 10 |

---

## 11-2. 起動時 Profile 分離

### CLI 引数

```bash
# デフォルト: learner（最小権限）
node mcp-server/index.js

# 明示的 profile 指定
node mcp-server/index.js --profile learner
node mcp-server/index.js --profile curriculum-builder
node mcp-server/index.js --profile coach
node mcp-server/index.js --profile admin

# 環境変数でも指定可能
RISE_PATH_MCP_PROFILE=admin node mcp-server/index.js
```

### MCP client 設定例

```json
{
  "mcpServers": {
    "rise-path-learner": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js", "--profile", "learner"]
    },
    "rise-path-curriculum": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js", "--profile", "curriculum-builder"]
    },
    "rise-path-admin": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js", "--profile", "admin"]
    }
  }
}
```

### 実装

```javascript
// mcp-server/profileFilter.js
import registry from './tool-registry.json' assert { type: 'json' };

const activeProfile = process.argv.includes('--profile')
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : process.env.RISE_PATH_MCP_PROFILE
  || registry.default_profile;  // "learner"

const VALID_PROFILES = ['learner', 'curriculum-builder', 'coach', 'admin'];

if (!VALID_PROFILES.includes(activeProfile)) {
  console.error(`Invalid profile: ${activeProfile}. Valid: ${VALID_PROFILES.join(', ')}`);
  process.exit(1);
}

// registry から allowlist を自動導出
const allowedTools = registry.tools
  .filter(t => t.exposure_profiles.includes(activeProfile))
  .map(t => t.tool_id);

export { activeProfile, allowedTools };
```

---

## 11-3. 二重チェック（ListTools + CallTool）

### ListTools: 非表示

```javascript
import { allowedTools } from './profileFilter.js';

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS.filter(t => allowedTools.includes(t.name))
  };
});
```

### CallTool: アクセス制御

```javascript
import { activeProfile, allowedTools } from './profileFilter.js';

// CallTool ハンドラの冒頭で必ずチェック
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  // Profile enforcement（ListTools で隠しても直接呼べるため）
  if (!allowedTools.includes(toolName)) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Tool '${toolName}' is not available for profile '${activeProfile}'`,
          error_type: 'access_denied',
          available_tools: allowedTools,
        })
      }],
      isError: true,
    };
  }

  // 以降、既存のツールハンドラ...
});
```

---

## 11-4. User Isolation（resolveUserId）

### 設計

```
SSE モード:  token decode → user_id 強制注入（params.user_id を無視）
stdio 開発:  params.user_id 許可、なければ PHASE1_USER_ID
stdio 本番:  PHASE1_USER_ID のみ
```

### 実装

```javascript
// mcp-server/auth.js
import { PHASE1_USER_ID } from '../server/db.js';

export function resolveUserId(sessionContext, params) {
  // SSE モード: token から取得（params.user_id は無視）
  if (sessionContext?.authenticatedUserId) {
    return sessionContext.authenticatedUserId;
  }

  // stdio モード（開発環境）: params を許可
  if (process.env.NODE_ENV !== 'production') {
    return params?.user_id || PHASE1_USER_ID;
  }

  // stdio モード（本番）: デフォルトのみ
  return PHASE1_USER_ID;
}
```

### SSE 接続時の token → user_id 抽出

```javascript
app.get('/sse', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  let authenticatedUserId = null;
  if (token && token !== process.env.RISE_PATH_BRIDGE_TOKEN) {
    // Supabase JWT を検証
    const decoded = await verifySupabaseToken(token);
    authenticatedUserId = decoded.sub; // auth.users の UUID
  }

  session.authenticatedUserId = authenticatedUserId;
});
```

### 全ツールハンドラの変更

```javascript
// 変更前
const effectiveUserId = userId || PHASE1_USER_ID;

// 変更後
const effectiveUserId = resolveUserId(sessionContext, args);
```

---

## 11-5. save-curriculum-draft → preview + commit 分離

### 問題

stdio モードでは approval ダイアログを出せない。
`save-curriculum-draft` が1ステップで保存するのは unsafe。

### 解決: 2段階に分離

#### preview-curriculum-draft（readOnly）

```javascript
// DB 保存しない。検証結果のみ返す。
{
  valid: true,
  title: "Vibe Coding マスター",
  lesson_count: 26,
  quality_warnings: ["Module 3: practice items < 2"],
  normalized_curriculum: { ... },
  confirmation_token: "ctk_abc123_expires_300s",
  expires_at: "2026-05-01T02:10:00Z"
}
```

#### commit-curriculum-draft（write、approval 必須）

```javascript
// confirmation_token が必須。なければエラー。
{
  // 入力
  confirmation_token: "ctk_abc123_expires_300s",  // 必須
  // preview で返された normalized_curriculum を使用

  // 出力
  curriculum_id: "uuid",
  action: "created",
  title: "Vibe Coding マスター"
}
```

#### confirmation_token の仕様

| 属性 | 値 |
|------|-----|
| 形式 | `ctk_` + ランダム文字列 |
| 有効期限 | 300秒（5分） |
| 使い捨て | はい（1回使用で無効化） |
| 保存先 | メモリ内 Map（セッションスコープ） |

---

## 11-6. Policy Engine

### `mcp-server/policy.js`

```javascript
import registry from './tool-registry.json' assert { type: 'json' };

const sessionCallCounts = new Map();

export function checkPolicy(toolName, sessionId) {
  const toolDef = registry.tools.find(t => t.tool_id === toolName);
  if (!toolDef) return { allowed: true };

  // Rate limiting
  const key = `${sessionId}:${toolName}`;
  const count = sessionCallCounts.get(key) || 0;
  if (toolDef.max_calls_per_session && count >= toolDef.max_calls_per_session) {
    return {
      allowed: false,
      reason: 'rate_limit_exceeded',
      message: `${toolName} は1セッションで最大${toolDef.max_calls_per_session}回です`,
    };
  }

  sessionCallCounts.set(key, count + 1);
  return { allowed: true, audit: toolDef.audit || false };
}

export function auditLog(toolName, userId, args, result) {
  // 将来: DB or structured log に保存
  console.log(JSON.stringify({
    type: 'mcp_audit',
    timestamp: new Date().toISOString(),
    tool: toolName,
    user_id: userId,
    args_keys: Object.keys(args || {}),
    success: !result?.error,
  }));
}
```

---

## 11-7. Tool Annotations

全ツール定義に MCP spec の annotations を追加。

```javascript
// index.js の ALL_TOOLS に追加
{
  name: 'commit-curriculum-draft',
  description: 'preview で検証済みのカリキュラムを DB に保存する（confirmation_token 必須）',
  inputSchema: { ... },
  annotations: {
    title: 'カリキュラム保存（確定）',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }
}
```

> ⚠️ annotations は自己申告（hint）。security enforcement ではない。
> 最終的な強制は profile filtering + CallTool enforcement + policy engine で行う。

---

## 11-8. Journal Privacy

journal-log は `learner_private` データクラスに分類。

| 方針 | 内容 |
|------|------|
| retention | ユーザーが削除可能（将来: journal-delete ツール） |
| export | ユーザーが全データをダウンロード可能（将来: journal-export） |
| data_class | `learner_private`（`learner_data` より一段上） |
| coach profile | journal-recent は読めるが journal-log（書き込み）はできない |
| audit | journal-log は全呼び出しを audit log に記録 |

---

## テスト計画

| # | テスト | 期待結果 |
|---|--------|---------|
| 1 | `--profile learner` で起動 | ListTools が5ツールのみ |
| 2 | `--profile learner` で `commit-curriculum-draft` を直接 CallTool | `access_denied` エラー |
| 3 | profile 未指定で起動 | `learner`（最小権限）として動作 |
| 4 | 不正な profile 名で起動 | プロセスが exit(1) |
| 5 | SSE モードで有効 token 付き | token.sub が user_id として使用 |
| 6 | SSE モードで params.user_id 詐称 | params は無視、token.sub が使用 |
| 7 | preview-curriculum-draft | DB 保存なし、confirmation_token 返却 |
| 8 | commit-curriculum-draft（token なし） | エラー |
| 9 | commit-curriculum-draft（期限切れ token） | エラー |
| 10 | commit-curriculum-draft（有効 token） | DB 保存成功 |
| 11 | learner-state-update を21回呼ぶ | 21回目で rate_limit_exceeded |
| 12 | journal-log の audit log 出力 | console に JSON structured log |

---

## 実装タスク

| # | タスク | 工数 | 優先度 |
|---|--------|------|:---:|
| 1 | `tool-registry.json` 作成 | 15min | P0 |
| 2 | `profileFilter.js` — 起動時 profile + allowlist 導出 | 20min | P0 |
| 3 | ListTools filtering | 10min | P0 |
| 4 | CallTool enforcement（二重チェック） | 15min | P0 |
| 5 | `resolveUserId()` 関数 | 15min | P0 |
| 6 | 全ツールハンドラで resolveUserId 使用 | 20min | P0 |
| 7 | save-curriculum-draft → preview + commit 分離 | 45min | P1 |
| 8 | confirmation_token 生成・検証 | 20min | P1 |
| 9 | Tool annotations 追加 | 15min | P1 |
| 10 | policy.js（rate limit + audit log） | 30min | P1 |
| 11 | SSE token → user_id 抽出 | 30min | P2 |
| 12 | テスト | 45min | P1 |

**合計: 約4.5時間**

---

## 実装トリガー

この仕様の実装は以下のタイミングで着手する：

| トリガー | 着手範囲 |
|---------|---------|
| 他のユーザーが使い始める | P0 全タスク（#1-#6） |
| ChatGPT に MCP 接続する | P0 + P1（#1-#10） |
| MCP を外部公開する | 全タスク（#1-#12） |
