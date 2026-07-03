# Phase 7: 認証・認可仕様書

> 作成日: 2026-04-30
> ステータス: Approved (Rev.2 — P0/P1修正済)
> 関連: [`architecture_v2_mcp_skills.md`](./architecture_v2_mcp_skills.md), Issue #8

---

## 1. 概要

Phase 6 で構築した MCP Server + Express API に、統一的な認証・認可レイヤーを追加する。
Supabase Auth が発行する **JWT (JSON Web Token)** を唯一の認証トークンとし、
全バックエンドエンドポイントで一貫した認証体験を提供する。

### 1.1 現状の課題

| レイヤー | 現状 | リスク |
|:---|:---|:---|
| Frontend | Supabase Auth (email/password) ✅ | — |
| Express `/api/v2/user` | `x-user-id` ヘッダーで信頼 | ❌ ヘッダー偽装が可能 |
| Express `/api/v2/*` (その他) | `PHASE1_USER_ID` ハードコード | ❌ 全員が同一ユーザー |
| MCP Server (stdio) | `user_id` パラメータ任意 | 🟡 ローカル前提 |
| MCP Server (SSE) | 認証なし | ❌ リモートアクセスに危険 |

### 1.2 ゴール

- Express API: Supabase JWT の検証に一本化
- MCP SSE: Bearer token による認証を追加
- MCP stdio: 認証不要 (ローカル接続前提)
- 開発モード: `PHASE1_USER_ID` への自動フォールバック維持
- `tools/core/*` は認証ロジック非依存を維持

---

## 2. 認証アーキテクチャ

### 2.1 信頼モデル

```
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Auth (IdP)                       │
│                 JWT 発行・検証・セッション管理                  │
└─────────────┬───────────────────────────────┬───────────────┘
              │ JWT                           │ JWT
              ▼                               ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│   Express API Server    │   │   MCP Server (SSE)          │
│   middleware/auth.js    │   │   resolveUserId()           │
│   req → JWT検証 →       │   │   req → JWT検証 →           │
│   req.userId セット     │   │   session.userId セット     │
└─────────────────────────┘   └─────────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│              tools/core/* (共有ビジネスロジック)               │
│              userId を引数として受け取るのみ                   │
│              認証ロジックには一切依存しない                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 認証フローの詳細

#### Express API

```
Client → Authorization: Bearer <supabase-jwt>
         ↓
  middleware/auth.js
    1. extractBearerToken(req) → token
    2. supabase.auth.getUser(token) → { user.id }
    3. req.userId = user.id
    4. next()
         ↓
  Route Handler → req.userId で DB クエリ
```

#### MCP Server (SSE)

```
Client → GET /sse  Authorization: Bearer <supabase-jwt>
         ↓
  resolveUserId(req)
    1. extractBearerToken(req) → token
    2. supabase.auth.getUser(token) → { user.id }
    3. sessions.set(sessionId, { transport, userId })
         ↓
  Tool Call → sessions.get(sessionId).userId → toolFunction({ userId })
```

#### MCP Server (stdio)

```
Client → tool_call { user_id: "..." }
         ↓
  tools/core/* → userId = user_id || PHASE1_USER_ID
  (認証なし。ローカルプロセスのみ到達可能のため安全)
```

---

## 3. 環境モード

### 3.1 開発モード (`NODE_ENV !== 'production'`)

| 接続元 | token なし | token あり |
|:---|:---|:---|
| Express API | → `PHASE1_USER_ID` | → JWT 検証 → `user.id` |
| MCP SSE | → `PHASE1_USER_ID` | → JWT 検証 → `user.id` |
| MCP stdio | → `user_id` パラメータ or `PHASE1_USER_ID` | — |

### 3.2 本番モード (`NODE_ENV === 'production'`)

| 接続元 | token なし | token あり |
|:---|:---|:---|
| Express API | → **401 Unauthorized** | → JWT 検証 → `user.id` |
| MCP SSE | → **401 Unauthorized** | → JWT 検証 → `user.id` |
| MCP stdio | → `user_id` パラメータ必須 | — |

---

## 4. 実装仕様

### 4.1 `server/middleware/auth.js` (新規)

```javascript
/**
 * Supabase JWT 検証ミドルウェア
 *
 * 本番: token 必須。なければ 401。
 * 開発: token なしなら PHASE1_USER_ID にフォールバック。
 */

import { createClient } from '@supabase/supabase-js';
import { PHASE1_USER_ID } from '../db.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

let _supabase = null;
const getSupabase = () => {
    if (_supabase) return _supabase;
    const key = supabaseServiceKey || supabaseAnonKey;
    if (!supabaseUrl || !key) return null;
    _supabase = createClient(supabaseUrl, key);
    return _supabase;
};

const extractBearerToken = (req) => {
    const auth = req.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    return null;
};

export const requireAuth = async (req, res, next) => {
    const token = extractBearerToken(req);

    if (!token) {
        if (process.env.NODE_ENV !== 'production') {
            req.userId = PHASE1_USER_ID;
            req.authMethod = 'dev-fallback';
            return next();
        }
        return res.status(401).json({
            error: 'Authentication required',
            hint: 'Include Authorization: Bearer <supabase-jwt> header',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        // Supabase not configured — dev mode fallback
        req.userId = PHASE1_USER_ID;
        req.authMethod = 'no-supabase-fallback';
        return next();
    }

    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) {
            return res.status(401).json({
                error: 'Invalid or expired token',
                detail: error?.message,
            });
        }
        req.userId = data.user.id;
        req.authMethod = 'supabase-jwt';
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Authentication service error' });
    }
};

/**
 * Optional auth: userId を設定するが、なくても通す。
 * 公開リソースで「ログイン済みなら個人化」のパターン用。
 */
export const optionalAuth = async (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
        req.userId = null;
        return next();
    }
    // token があるなら検証する
    return requireAuth(req, res, next);
};
```

### 4.2 `server.js` 変更

```diff
+ import { requireAuth } from './server/middleware/auth.js';

  // --- Mount V2 Routes ---
  app.use('/api/v2/ai', aiRoutes);           // deprecated (410 Gone) — auth不要
- app.use('/api/v2/user', userRoutes);
+ app.use('/api/v2/user', requireAuth, userRoutes);
  app.use('/api/v2', chatgptCurriculumRoutes); // 独自の Bridge/JWT 複合認証を内包 (§4.6)
- app.use('/api/v2', contentRoutes);
+ app.use('/api/v2', requireAuth, contentRoutes);
```

> **注意**: `chatgptCurriculumRoutes` には `requireAuth` を適用しない。
> Bridge Token と JWT の衝突を防ぐため、独自の複合認証 `requireBridgeOrAuth` を使用する (§4.6)。

### 4.3 `server/routes/user.js` 変更

```diff
  // 既存の requireUser ミドルウェアを削除 (auth.js に移行)
- const requireUser = (req, res, next) => {
-     const userId = req.headers['x-user-id'];
-     if (!userId) return res.status(401).json({ error: 'Authentication required' });
-     req.userId = userId;
-     next();
- };
- router.use(requireUser);
+ // req.userId is set by server/middleware/auth.js
```

### 4.4 `mcp-server/index.js` 変更 (SSE auth)

`auth.js` の `getSupabase()` を再利用し、Supabase クライアントのインスタンスをキャッシュする。

```diff
+ import { getSupabase } from '../server/middleware/auth.js';

+ async function resolveUserId(req) {
+     const auth = req.headers.authorization;
+     if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
+         return process.env.NODE_ENV !== 'production' ? PHASE1_USER_ID : null;
+     }
+     const token = auth.slice(7).trim();
+     const supabase = getSupabase();
+     if (!supabase) {
+         return process.env.NODE_ENV !== 'production' ? PHASE1_USER_ID : null;
+     }
+     const { data, error } = await supabase.auth.getUser(token);
+     if (error || !data?.user) return null;
+     return data.user.id;
+ }

  app.get('/sse', async (req, res) => {
+     const userId = await resolveUserId(req);
+     if (!userId) {
+         return res.status(401).json({ error: 'Authentication required' });
+     }
      const sessionId = randomUUID();
      const transport = new SSEServerTransport(`/messages/${sessionId}`, res);
-     sessions.set(sessionId, transport);
+     sessions.set(sessionId, { transport, userId });
      // ...
  });
```

### 4.5 `services/apiClient.ts` 変更 (フロントエンド JWT 送信)

現在の `x-user-id` ヘッダー送信を `Authorization: Bearer <jwt>` に移行する。

```diff
- import { setAuthProvider } from '../services/apiClient';

+ import { getSupabaseClient } from './supabaseClient';

  export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
-     const userId = _getUserId();
      const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string> || {}),
      };
-     if (userId) {
-         headers['x-user-id'] = userId;
-     }
+     // Supabase session から JWT を取得して Bearer token として送信
+     const supabase = getSupabaseClient();
+     if (supabase) {
+         const { data: { session } } = await supabase.auth.getSession();
+         if (session?.access_token) {
+             headers['Authorization'] = `Bearer ${session.access_token}`;
+         }
+     }
      return fetch(`${API_BASE}${path}`, { ...options, headers });
  };
```

> **注意**: `setAuthProvider()` / `_getUserId()` は不要になるが、
> Guest ユーザー (Supabase 未使用) の互換性のため、JWT が取得できない場合は
> フォールバックとして維持する。

### 4.6 `chatgptCurriculum.js` の Bridge/JWT 複合認証

Bridge Token と Supabase JWT が同じ `Authorization: Bearer` ヘッダーを使用するため、
専用の複合認証ミドルウェアを使用する。

```javascript
/**
 * Bridge Token → Supabase JWT の優先順位で認証を試行。
 * Bridge Token が設定されている場合は x-nexloom-bridge-token ヘッダーを優先。
 * Bearer ヘッダーは Supabase JWT として検証する。
 */
const requireBridgeOrAuth = async (req, res, next) => {
    // 1. x-nexloom-bridge-token ヘッダーでの Bridge 認証
    const bridgeToken = cleanString(process.env.RISE_PATH_BRIDGE_TOKEN);
    if (bridgeToken) {
        const provided = cleanString(req.headers['x-nexloom-bridge-token']);
        if (provided && provided === bridgeToken) {
            req.bridgeAuthenticated = true;
            req.userId = PHASE1_USER_ID; // Bridge 経由は共有ユーザー
            return next();
        }
    }

    // 2. Authorization: Bearer → Supabase JWT として検証
    const auth = cleanString(req.headers.authorization);
    if (auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        // Bridge Token との一致チェック (旧互換)
        if (bridgeToken && token === bridgeToken) {
            req.bridgeAuthenticated = true;
            req.userId = PHASE1_USER_ID;
            return next();
        }
        // Supabase JWT として検証
        // ... requireAuth のロジックを流用
    }

    // 3. dev mode fallback
    if (process.env.NODE_ENV !== 'production') {
        req.userId = PHASE1_USER_ID;
        req.authMethod = 'dev-fallback';
        return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
};
```

### 4.7 `ensurePhase1User()` の廃止

JWT 認証後、`req.userId` は Supabase 管理の `auth.users` テーブルに既存のユーザー。
`ensurePhase1User()` による `INSERT INTO auth.users` は不要かつ危険。

```diff
  // content.js — ensurePhase1User() 呼び出しを削除
- await ensurePhase1User(pool);
  const result = await pool.query(
      `select id, title, ...
-      where user_id = CAST($1 AS uuid)`, [PHASE1_USER_ID, ...]
+      where user_id = CAST($1 AS uuid)`, [req.userId, ...]
  );
```

### 4.8 `content.js` IDOR 修正

`GET /curricula/:id` にユーザースコープを追加し、他ユーザーのデータへのアクセスを防止。

```diff
  const detailRes = await pool.query(`
      SELECT c.*, v.content_json, v.status
      FROM curricula c
      LEFT JOIN curriculum_versions v ON c.current_version_id = v.id
-     WHERE c.id = CAST($1 AS uuid)
+     WHERE c.id = CAST($1 AS uuid) AND c.user_id = CAST($2 AS uuid)
- `, [req.params.id]);
+ `, [req.params.id, req.userId]);
```
```

### 4.9 `tools/core/*` への影響

**変更なし。** 全モジュールは `userId` を引数として受け取るのみで、認証ロジックには依存しない。

```
tools/core/learnerState.js   → getProgress({ userId })     // 変更不要
tools/core/journal.js        → logEntry({ userId })        // 変更不要
tools/core/curriculum.js     → saveDraft({ userId })       // 変更不要
tools/core/ragSearch.js      → searchContent({ userId })   // 変更不要
tools/core/learnerProfile.js → getLatestProfile({ userId })// 変更不要
```

---

## 5. 環境変数

### 5.1 `.env.example` に追加

```bash
# Supabase Backend (JWT 検証用)
# Service Role Key を推奨。Anon Key でも動作するが、admin 操作不可。
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# 開発モード用 (本番では無視される)
PHASE1_USER_ID=00000000-0000-0000-0000-000000000001
```

### 5.2 キー選択の指針

| キー | 用途 | セキュリティ |
|:---|:---|:---|
| `SUPABASE_ANON_KEY` | JWT 検証のみ | ✅ 公開可 (Row Level Security で保護) |
| `SUPABASE_SERVICE_ROLE_KEY` | JWT 検証 + 管理操作 | ❌ サーバーサイド専用 |

**推奨**: バックエンドでは `SUPABASE_SERVICE_ROLE_KEY` を使用。
これにより `supabase.auth.getUser(token)` が RLS を迂回して確実にユーザー情報を取得できる。

---

## 6. セキュリティ考慮事項

### 6.1 CORS

```javascript
// 本番: 許可オリジンを限定
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
}));
```

### 6.2 Rate Limiting (Phase 8 候補)

現時点では未実装。本番デプロイ時に `express-rate-limit` を追加予定:
- `/api/v2/*`: 100 req/min per IP
- `/sse`: 5 connections per IP

### 6.3 MCP stdio の安全性

stdio は OS レベルのプロセス間通信。ネットワーク経由のアクセスは不可能なため、
認証を省略しても安全。ただし `user_id` パラメータは信頼できないため、
本番では `user_id` を必須にし、監査ログで追跡する。

### 6.4 Bridge Token との共存

`chatgptCurriculumRoutes` は独自の `RISE_PATH_BRIDGE_TOKEN` 認証を持つ。
Phase 7 の `requireAuth` は Bridge Token のフォールバックとして追加し、
既存の Bridge Token 認証は**残す** (Nexloom 連携で使用中のため)。

```javascript
// 認証の優先順位:
// 1. Bearer <supabase-jwt> → Supabase JWT 検証
// 2. x-nexloom-bridge-token / Bearer <bridge-token> → Bridge Token 検証
// 3. (dev only) → PHASE1_USER_ID フォールバック
```

---

## 7. 実装タスク

| # | タスク | 優先度 | 推定工数 | 対象ファイル |
|:---|:---|:---|:---|:---|
| 7-1 | `server/middleware/auth.js` 作成 | P0 | 30分 | 新規 |
| 7-2 | `server.js` にミドルウェア適用 | P0 | 15分 | `server.js` |
| 7-3 | `user.js` の `requireUser` 削除 | P1 | 10分 | `server/routes/user.js` |
| 7-4 | MCP SSE に `resolveUserId` 追加 | P1 | 30分 | `mcp-server/index.js` |
| 7-5 | `.env.example` 更新 | P2 | 5分 | `.env.example` |
| 7-6 | `content.js` PHASE1_USER_ID → req.userId | P1 | 15分 | `server/routes/content.js` |
| 7-7 | E2E テスト (手動) | P1 | 30分 | — |
| 7-8 | `apiClient.ts` を Bearer JWT 送信に移行 | P0 | 30分 | `services/apiClient.ts` |
| 7-9 | `chatgptCurriculum.js` PHASE1_USER_ID → req.userId | P1 | 45分 | `server/routes/chatgptCurriculum.js` |
| 7-10 | Bridge/JWT 複合認証 `requireBridgeOrAuth` | P0 | 20分 | `server/routes/chatgptCurriculum.js` |
| 7-11 | `ensurePhase1User()` 呼び出し削除 | P1 | 10分 | `server/routes/content.js`, `db.js` |
| 7-12 | `content.js` IDOR 修正 (user_id スコープ) | P1 | 10分 | `server/routes/content.js` |

**合計: 12タスク、約 4時間**

### 実装順序

```
7-1 → 7-10 → 7-5 → 7-8 → 7-2 → 7-3 → 7-11 → 7-6 → 7-12 → 7-9 → 7-4 → 7-7
auth  bridge  env   fe     mount  user  ensure  cont  idor   cgpt   mcp   test
```

> **クリティカルパス**: 7-1 (auth.js) → 7-8 (apiClient.ts) → 7-2 (server.js mount)
> これら3つが揃わないとフロントエンド認証が機能しない。

---

## 8. テスト計画

### 8.1 開発モード (NODE_ENV=development)

```bash
# 1. token なしでアクセス → PHASE1_USER_ID でフォールバック
curl http://localhost:3006/api/v2/user/profile
# → 200 OK (PHASE1_USER_ID のプロフィール)

# 2. 有効な token → JWT 検証成功
curl -H "Authorization: Bearer <valid-jwt>" http://localhost:3006/api/v2/user/profile
# → 200 OK (JWT ユーザーのプロフィール)

# 3. 無効な token → 401
curl -H "Authorization: Bearer invalid-token" http://localhost:3006/api/v2/user/profile
# → 401 { error: "Invalid or expired token" }
```

### 8.2 MCP stdio (変更なし確認)

```bash
echo '...' | node mcp-server/index.js
# → 既存の動作が維持されること
```

### 8.3 MCP SSE

```bash
# token なし (dev) → フォールバック
curl http://localhost:3100/sse
# → SSE stream 開始

# token あり → JWT 検証
curl -H "Authorization: Bearer <valid-jwt>" http://localhost:3100/sse
# → SSE stream 開始 (userId = JWT user)
```
