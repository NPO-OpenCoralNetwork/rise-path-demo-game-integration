# Phase 8: MCP userId 伝播 & API 保護

> Created: 2026-04-30
> Status: 仕様策定中
> Depends on: Phase 7 (完了)

---

## 1. 目標

Phase 7 で認証ミドルウェアを導入したが、2つの残課題がある:

| # | 課題 | 影響 |
|:--|:--|:--|
| P2-2 | MCP SSE で `session.userId` を取得するが、**ツール実行時に渡していない** | SSE 経由の MCP ツールが `user_id` パラメータに依存し続ける |
| New | Express API にレート制限がない | DDoS・トークン乱用に脆弱 |

---

## 2. タスク一覧

### 2.1 MCP userId 伝播 (8-1 〜 8-4)

#### 問題の構造

```
現在の流れ:
  Client → GET /sse (Bearer token) → resolveUserId → session.userId ✅
  Client → POST /messages → tool call → tool handler({ user_id: ??? })
                                                       ↑
                                              LLM がパラメータとして渡す
                                              → 信頼できない (クライアント任意)
```

SSE 接続時に認証した `session.userId` がツール実行時に注入されず、
`user_id` はクライアント (LLM) が送る任意パラメータになっている。

#### 解決策: Server Context Injection

MCP SDK の `server.tool()` コールバックは第2引数に `extra` オブジェクトを受け取る。
SSE transport では `extra.transport` を通じてセッションを逆引きできる。

```javascript
// Phase 8 設計: ツールコールバック内で認証済み userId を解決
server.tool('learner-state-get', '...', schema, async (args, extra) => {
    const userId = resolveToolUserId(args.user_id, extra);
    // ...
});
```

| # | タスク | ファイル | 工数 |
|:--|:--|:--|:--|
| 8-1 | `resolveToolUserId()` ヘルパー作成 | `mcp-server/index.js` | 15分 |
| 8-2 | 全8ツールに `extra` 引数追加 & userId 差し替え | `mcp-server/index.js` | 30分 |
| 8-3 | `user_id` パラメータ仕様変更 (optional → ignored in SSE) | `mcp-server/index.js` | 10分 |
| 8-4 | stdio モードでの後方互換テスト | — | 15分 |

#### 8-1: `resolveToolUserId()` 仕様

```javascript
/**
 * Resolve effective userId for tool execution.
 *
 * Priority:
 *   1. SSE session userId (authenticated via JWT) — trusted
 *   2. args.user_id (from LLM/client) — only in stdio mode
 *   3. PHASE1_USER_ID fallback — dev mode only
 *
 * @param {string|undefined} argsUserId - user_id from tool arguments
 * @param {object} extra - MCP SDK extra context (contains transport)
 * @returns {string} effective userId
 */
function resolveToolUserId(argsUserId, extra) {
    // SSE mode: use authenticated session userId
    if (extra?.transport) {
        for (const [, session] of sessions) {
            if (session.transport === extra.transport) {
                return session.userId;  // Trusted, JWT-verified
            }
        }
    }

    // stdio mode: use args or fallback
    return argsUserId || PHASE1_USER_ID;
}
```

### 2.2 Rate Limiting (8-5 〜 8-8)

#### 設計

| レイヤー | ルート | 制限 | 理由 |
|:--|:--|:--|:--|
| Global | 全API | 200 req/min/IP | DDoS基本防御 |
| Auth | `/api/v2/user/`, `/api/v2/curricula` | 60 req/min/userId | 認証済みユーザーの乱用防止 |
| AI Heavy | `/api/v2/ai/`, `/api/v2/image` | 10 req/min/userId | Gemini API コスト保護 |
| MCP SSE | `/sse`, `/messages` | 30 req/min/sessionId | MCP ツール乱用防止 |

#### 技術選定: `express-rate-limit`
- 軽量 (依存ゼロ)
- メモリストア (単一サーバー向け)
- `keyGenerator` でユーザーID/セッションIDベースの制限が可能

| # | タスク | ファイル | 工数 |
|:--|:--|:--|:--|
| 8-5 | `express-rate-limit` 導入 | `package.json` | 5分 |
| 8-6 | Global + Auth レート制限 | `server.js` | 20分 |
| 8-7 | AI Heavy レート制限 | `server.js` | 10分 |
| 8-8 | MCP SSE レート制限 | `mcp-server/index.js` | 15分 |

### 2.3 認証ログ強化 (8-9)

| # | タスク | ファイル | 工数 |
|:--|:--|:--|:--|
| 8-9 | ログミドルウェアに `req.authMethod` 出力追加 | `server.js` | 10分 |

---

## 3. 実装順序 (クリティカルパス)

```
8-5 (npm install) → 8-6/8-7/8-8 (rate limit 並行)
8-1 (resolveToolUserId) → 8-2/8-3 (tool改修) → 8-4 (テスト)
8-9 (ログ) は独立
```

合計工数: **~2.5 時間**

---

## 4. テスト戦略

| テスト | 期待結果 |
|:--|:--|
| SSE接続 + ツール実行 | `session.userId` がツールに渡る |
| stdio + `user_id` パラメータ | 従来通り動作 |
| stdio + `user_id` 省略 | `PHASE1_USER_ID` フォールバック |
| 200+ req/min (curl) | 429 Too Many Requests |
| `/api/v2/image` 11 req/min | 429 (AI Heavy制限) |

---

## 5. 注意事項

- `express-rate-limit` はメモリストア = **サーバー再起動でリセット**。スケールアウト時は Redis ストアに要移行。
- Rate limit ヘッダー (`X-RateLimit-*`) を返すのが REST のベストプラクティス。
- Production では `NODE_ENV=production` が設定されている前提で、dev mode ではレート制限を緩和する。
