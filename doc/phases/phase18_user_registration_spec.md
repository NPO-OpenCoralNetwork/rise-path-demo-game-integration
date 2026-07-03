# Phase 18: ユーザー登録 UI 仕様書

> 作成日: 2026-06-24
> ステータス: Implemented (v1)
> 関連: [`phase7_auth_spec.md`](./phase7_auth_spec.md), [`env_local_setup_issue15.md`](./env_local_setup_issue15.md), [`phase13_ui_integration_spec.md`](./phase13_ui_integration_spec.md), [`usage_guide.md`](./usage_guide.md)

---

## 1. 概要

### 1.1 背景

Rise Path は Supabase Auth によるログインと JWT ベースの API 認証（Phase 7）が実装済みだが、**メイン WebUI にユーザー登録画面がない**。

| 実装済み | 未実装 |
|:---|:---|
| `ExperienceLoginView`（ログイン） | 登録 UI |
| `AuthContext.signUp()`（未使用） | 登録後オンボーディング |
| `GET/PUT /api/v2/user/profile`（初回自動作成） | パスワードリセット UI |
| `syncAuthUserStub`（JWT 初回 API で DB 連携） | ランディングからの新規登録導線 |
| レッスン後 `LessonReflectionModal` → `learning_journal` | ジャーナル閲覧 UI |

`VITE_DEMO_MODE=false`（Issue #15 本番相当モード）ではゲストログインが無効のため、**登録なしでは新規ユーザーがアプリに入れない**。

### 1.2 目的

1. WebUI からメール＋パスワードでアカウントを作成できる
2. 登録後すぐ基本学習フロー（ダッシュボード → レッスン → 振り返り）に入れる
3. 既存の Supabase Auth / `user_profiles` / JWT 連携を変更せず再利用する
4. Nexloom ID との「同一認証」説明と矛盾しない UX を提供する

### 1.3 非目的（本 Phase の範囲外）

- Google / GitHub OAuth（Phase 18 v2）
- Nexloom 専用 OAuth ブリッジ
- 組織招待・管理者によるユーザー一括作成
- メール確認なし本番運用の推奨（開発のみ許容）

---

## 2. 設計方針

### 2.1 認証の正本

```
Supabase Auth     = 認証の正本（ID 発行・JWT・セッション）
risepath Postgres = アプリデータの正本（auth.users stub, user_profiles, learning_journal, …）
```

**v1 では新規バックエンド API は追加しない。** フロントの Supabase Client + 既存 REST で完結する。

### 2.2 Nexloom ID との関係

`ExperienceLoginView` の「Nexloom ID」は **同一 Supabase プロジェクトの既存アカウントでログイン** する意味に統一する。

| ユーザーの状態 | 画面 | 動作 |
|:---|:---|:---|
| Nexloom / Supabase に既存アカウントあり | ログインタブ | `signInWithPassword` |
| Rise Path を初めて使う | 登録タブ | `signUp` |

コピー例（JP）:

- ログイン: 「Nexloom と同じメール・パスワードで入れます」
- 登録: 「初めての方はこちらからアカウントを作成」

### 2.3 Phase 7 との関係

| 項目 | Phase 7（既存） | Phase 18（本仕様） |
|:---|:---|:---|
| JWT 検証 | Express / MCP SSE | 変更なし |
| `req.userId` | Supabase `user.id` | 登録後も同じ |
| 開発フォールバック | `PHASE1_USER_ID` | 登録 UI とは独立 |
| stdio MCP | セッション未紐づけ時フォールバック | Web 登録後の Hermes チャットで `registerAgentSession` |

---

## 3. スコープ

### 3.1 v1（MVP）— 実装対象

- [ ] 認証画面に **ログイン / 新規登録** タブを追加
- [ ] 登録フォーム: メール、パスワード、パスワード確認、表示名（任意）
- [ ] `AuthContext.signUp` の修正（セッション確立・hydrate）
- [ ] `/auth/callback` ルート（メール確認リンク用）
- [ ] メール確認必須時の **確認待ち画面**
- [ ] `LandingView` から登録タブを開く導線
- [ ] 偽登録 UI（`LoginModal`）の整理

### 3.2 v1.5（次フェーズ）

- [ ] パスワードリセット（`resetPasswordForEmail`）
- [ ] 利用規約・プライバシーポリシー同意チェック
- [ ] 登録直後の軽量ウェルカム画面（表示名確認・任意で `/assessment` へ）
- [ ] 確認メール再送

### 3.3 v2（将来）

- [ ] Google / GitHub OAuth（Supabase Provider）
- [ ] Nexloom 共通 OAuth
- [ ] 招待コード・組織アカウント

---

## 4. ユーザーフロー

### 4.1 基本フロー（メール確認 OFF — 開発推奨）

```
ランディング
  ↓ 「旅を始める」
認証画面（登録タブ）
  ↓ フォーム送信
Supabase auth.signUp
  ↓ data.session あり
onAuthStateChange → AuthUser セット
  ↓
hydrateFromApi() + hydrateNotifications()
  ↓
ダッシュボード (/)
  ↓
レッスン受講 → LessonReflectionModal
  ↓ POST /api/v2/curricula/:id/journal
learning_journal に user_id で保存
```

### 4.2 メール確認 ON（本番推奨）

```
signUp 成功 → data.session なし
  ↓
/auth/confirm-pending?email=...
  「確認メールを送りました」
  ↓ ユーザーがメール内リンクをクリック
/auth/callback（Supabase がセッション確立）
  ↓
ダッシュボード (/)
```

### 4.3 登録後のサーバー側データ作成（自動）

| タイミング | 処理 | 実装箇所 |
|:---|:---|:---|
| 初回認証済み API 呼び出し | `auth.users` stub INSERT | `server/db.js` → `syncAuthUserStub` |
| 初回 `GET /user/profile` | `user_profiles` 自動作成 | `server/routes/user.js` L27-39 |
| レッスン振り返り送信 | `learning_journal` INSERT | `server/routes/chatgptCurriculum.js` |

**新規マイグレーションは不要。**

### 4.4 MCP / Hermes との接続

WebUI で Supabase ログイン後、Express 経由の AI チャット利用時:

```
Express JWT 検証 → registerAgentSession(rp:user:{uuid})
  → MCP / Hermes が当該 user_id で journal / learner-state を参照
```

Cursor stdio MCP 単体ではセッション未紐づけのため開発フォールバック（`PHASE1_USER_ID`）が残る。登録 UI 完成後も **MCP 直接利用者は Web で一度ログイン＋チャット** するか `RISE_PATH_ACTIVE_SESSION_KEY` を設定する（[`architecture_v3_hermes_agent.md`](./architecture_v3_hermes_agent.md) 参照）。

---

## 5. UI 仕様

### 5.1 画面一覧

| 画面 | パス / 状態 | 新規 |
|:---|:---|:---:|
| ランディング | 未ログイン・`/` | — |
| 認証（ログイン） | 未ログイン・タブ=login | 拡張 |
| 認証（登録） | 未ログイン・タブ=signup | ✅ |
| 確認待ち | `/auth/confirm-pending` | ✅ |
| コールバック | `/auth/callback` | ✅ |
| ダッシュボード | ログイン後・`/` | — |

### 5.2 認証画面レイアウト

対象コンポーネント: `components/common/ExperienceLoginView.tsx`（リネームして `AuthView.tsx` でも可）

```
┌──────────────────────────────────────┐
│         システム認証 / System Auth      │
├──────────────────────────────────────┤
│   [ ログイン ]    [ 新規登録 ]          │  ← タブ
├──────────────────────────────────────┤
│  （ログインタブのみ）                   │
│  [ Nexloom ID でログイン ] ボタン       │
│  ─────────── OR ───────────            │
│  メールアドレス                         │
│  パスワード                             │
│  （登録タブのみ）パスワード（確認）       │
│  （登録タブのみ）表示名（任意）           │
│  [ 送信ボタン ]                         │
│  （ログイン）パスワードを忘れた → v1.5   │
│  （登録）すでにアカウントがある → ログイン │
│  （ログイン・ゲスト有効時のみ）ゲスト     │
└──────────────────────────────────────┘
```

ビジュアルは現行 `ExperienceLoginView`（ダーク・モノスペース）を維持。`LanguageContext` の `en` / `jp` 両対応。

### 5.3 ランディング導線

| CTA | 現状 | 変更後 |
|:---|:---|:---|
| ヘッダー「サインイン」 | ログイン画面 | ログインタブ |
| 「旅を始める」 / `Start Your Journey` | ログイン画面 | **登録タブを開いた状態** |
| フッター（任意） | なし | 「アカウントをお持ちの方はサインイン」 |

`LandingView` の props:

```typescript
onAuthClick: (mode: 'login' | 'signup') => void;
```

`App.tsx` は `isLoginPageVisible` に加え `authMode: 'login' | 'signup'` を保持。

### 5.4 フォームフィールド

| フィールド | login | signup | バリデーション（クライアント） |
|:---|:---:|:---:|---|
| `email` | ✅ | ✅ | 必須、trim、小文字化、簡易 RFC |
| `password` | ✅ | ✅ | 必須、最小 8 文字（Supabase 設定に合わせ調整可） |
| `password_confirm` | — | ✅ | `password` と一致 |
| `display_name` | — | ⭕ | 任意、1–40 文字；空なら `email` の `@` 前 |

### 5.5 文言（コピー表）

#### 日本語

| key | 文言 |
|:---|:---|
| `tab.login` | ログイン |
| `tab.signup` | 新規登録 |
| `signup.title` | アカウント作成 |
| `signup.subtitle` | 学習の進捗と振り返りを保存します |
| `signup.submit` | アカウントを作成 |
| `signup.hasAccount` | すでにアカウントをお持ちですか？ |
| `signup.success` | アカウントを作成しました |
| `signup.confirmPending` | 確認メールを送信しました。{email} をご確認ください。 |
| `error.alreadyRegistered` | このメールアドレスは既に登録されています。ログインしてください。 |

#### English

| key | 文言 |
|:---|:---|
| `tab.login` | Sign In |
| `tab.signup` | Create Account |
| `signup.title` | Create your account |
| `signup.subtitle` | Save progress and reflections across sessions |
| `signup.submit` | Create Account |
| `signup.hasAccount` | Already have an account? |
| `signup.success` | Account created successfully |
| `signup.confirmPending` | We sent a confirmation email to {email}. |
| `error.alreadyRegistered` | This email is already registered. Please sign in. |

### 5.6 削除・整理対象

| コンポーネント | 対応 |
|:---|:---|
| `LoginModal.tsx` の偽「アカウント作成」 | 未ログイン導線から除外；モック OAuth ボタンは v2 まで非表示 |
| `LoginView.tsx`（旧 Adachi 版） | 参照なしなら削除 |
| `LoginView.tsx` の飾り「アカウント作成」リンク | 本仕様で置換 |

---

## 6. フロントエンド実装仕様

### 6.1 `AuthContext` 変更

#### `signUp` シグネチャ

```typescript
signUp(
  email: string,
  password: string,
  options?: { displayName?: string }
): Promise<SignUpResult>;

type SignUpResult =
  | { status: 'session_ready' }
  | { status: 'email_confirmation_required'; email: string };
```

#### 実装要件

```typescript
const { data, error } = await supabase.auth.signUp({
  email: email.trim().toLowerCase(),
  password,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/callback`,
    data: {
      name: displayName ?? email.split('@')[0],
      full_name: displayName ?? email.split('@')[0],
    },
  },
});
```

| 結果 | 処理 |
|:---|:---|
| `error` | 例外を throw（UI がメッセージ表示） |
| `data.session` あり | `onAuthStateChange` を待つか即 `hydrateUserData()` → `{ status: 'session_ready' }` |
| `data.session` なし | `{ status: 'email_confirmation_required', email }` |

#### 表示名の永続化

セッション確立後:

```typescript
await apiPut('/user/profile', {
  display_name: displayName ?? derivedName,
});
clearUserProfileCache();
```

`AuthUser.name` は `user_metadata.name` または profile の `display_name` と同期。

### 6.2 新規ルート（`App.tsx`）

| パス | コンポーネント | 備考 |
|:---|:---|:---|
| `/auth/callback` | `AuthCallbackView` | `supabase.auth.getSession()` でセッション回復 → `/` へ replace |
| `/auth/confirm-pending` | `AuthConfirmPendingView` | クエリ `email` を表示 |

未ログイン時でも `/auth/*` は認証フローとして表示（ランディングに戻さない）。

### 6.3 `authPolicy` との整合

| 条件 | 登録 |
|:---|:---|
| `isSupabaseConfigured()` + `isStrictAuthMode()` | ✅ 有効 |
| Supabase 未設定 + `allowMockLogin()` | モック登録（`login` と同様） |
| Supabase 未設定 + strict | ❌ エラー表示 |

ゲストボタンは `allowGuestLogin()` が true のときのみ（現行どおり）。

### 6.4 `LessonReflectionModal` 認証ヘッダ（既知ギャップ）

現行は `fetch` 直叩きで JWT 未付与の可能性あり。Phase 18 では **必須修正** とする:

```typescript
// services/apiClient.ts の apiFetch を使用
await apiFetch(`/curricula/${courseId}/journal`, { method: 'POST', body: ... });
```

登録 → 振り返り保存の E2E を通すための依存タスク。

---

## 7. バックエンド・インフラ

### 7.1 変更なし（既存を利用）

- `server/middleware/auth.js`
- `server/routes/user.js`
- `server/db.js` → `syncAuthUserStub`
- DB スキーマ（`002_user_app_tables.sql` 等）

### 7.2 Supabase ダッシュボード設定

[`env_local_setup_issue15.md`](./env_local_setup_issue15.md) に以下を追記する。

| 設定項目 | 開発（ローカル） | 本番 |
|:---|:---|:---|
| Email プロバイダ | ON | ON |
| Confirm email | **OFF 推奨**（即ログイン検証用） | **ON 推奨** |
| Site URL | `http://localhost:3007` | Vercel 本番 URL |
| Redirect URLs | `http://localhost:3007/auth/callback` | 本番 `/auth/callback` |

### 7.3 環境変数（既存）

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # サーバーのみ
VITE_DEMO_MODE=false            # ゲスト無効・登録必須
```

---

## 8. エラーハンドリング

| 条件 | Supabase / 挙動 | UI |
|:---|:---|:---|
| 既存メール | `User already registered` | エラー + ログインタブへリンク |
| 弱いパスワード | `Password should be at least …` | パスワード欄下 |
| 不正メール | `Unable to validate email address` | メール欄下 |
| 未確認メールでログイン | `Email not confirmed` | 確認待ち画面へ誘導（v1.5 で再送） |
| ネットワーク障害 | fetch 失敗 | リトライ可能な汎用エラー |
| Supabase 未設定 | `AuthContext` throw | 設定不足メッセージ |

エラーメッセージは v1 では Supabase 英語メッセージをそのまま表示してよい。v1.5 で JP マッピング。

---

## 9. セキュリティ

- パスワードはクライアントでハッシュしない（Supabase 任せ）
- 自前の `/register` API は作らない
- `SUPABASE_SERVICE_ROLE_KEY` をフロントに載せない
- 登録成功時にゲスト用 `localStorage`（`rp_auth_user` の guest）をクリア
- レート制限は Supabase Auth に委譲
- E2E テストユーザー（`E2E Learner *`）は本番データと分離して運用

---

## 10. テスト

### 10.1 ユニット

| 対象 | ケース |
|:---|:---|
| `AuthContext.signUp` | session あり → hydrate 呼び出し |
| `AuthContext.signUp` | session なし → `email_confirmation_required` |
| フォームバリデーション | パスワード不一致、空メール |

### 10.2 E2E（`scripts/smoke-prod-e2e.mjs` パターンに追加）

```
1. ランディング → 登録タブ
2. 一意メールで signUp
3. ダッシュボード表示
4. GET /api/v2/user/profile → display_name 確認
5. （任意）レッスン振り返り → learning_journal 1 件
6. ログアウト → 再ログイン
```

### 10.3 手動確認

```bash
npm run dev
# http://localhost:3007
# 新規メールで登録 → Network タブで Authorization: Bearer 付き API を確認
```

---

## 11. 受け入れ基準（Acceptance Criteria）

### AC-1 登録

- [ ] 未ログイン状態で登録タブから新規メールでアカウント作成できる
- [ ] 登録後 `user_profiles` に当該 `user_id` の行ができる
- [ ] 登録後ダッシュボードに遷移し、API に JWT が付与される

### AC-2 ログイン連携

- [ ] 既存メールで登録しようとするとエラーとログイン誘導が出る
- [ ] 登録済みアカウントでログインタブから入れる

### AC-3 学習フロー

- [ ] 登録 → レッスン完了 → 振り返り保存 → `learning_journal` にその `user_id` で 1 件

### AC-4 厳格モード

- [ ] `VITE_DEMO_MODE=false` でゲストボタンが表示されない
- [ ] Supabase 未設定時、登録・ログインとも明確なエラーになる

### AC-5 回帰

- [ ] 既存 Supabase ログインユーザーのセッション復元が壊れない
- [ ] Phase 7 JWT ミドルウェアの挙動に変更なし

---

## 12. 実装計画（PR 分割）

| PR | 内容 | 規模 | 依存 |
|:---|:---|:---|:---|
| **PR-1** | `AuthContext.signUp` 修正、`/auth/callback`、`AuthConfirmPendingView` | S | — |
| **PR-2** | `ExperienceLoginView` 登録タブ + バリデーション | M | PR-1 |
| **PR-3** | `LandingView` 導線、`authMode` state | S | PR-2 |
| **PR-4** | `LessonReflectionModal` → `apiFetch`、`LoginModal` 整理 | S | PR-1 |
| **PR-5** | テスト + `env_local_setup_issue15.md` 追記 | S | PR-1–4 |
| **PR-6**（v1.5） | パスワードリセット、利用規約チェック | M | PR-5 |

---

## 13. 将来拡張

| 項目 | 概要 |
|:---|:---|
| OAuth | `LoginModal` の Google/GitHub を Supabase Provider で実装 |
| ウェルカムオンボーディング | 登録後 1 画面 → `/assessment` 任意誘導 |
| ジャーナル閲覧 UI | `journal-recent` の WebUI パリティ（[`feature_parity_analysis.md`](./feature_parity_analysis.md) G1） |
| ChatGPT MCP | OAuth 2.1 連携（[`architecture_v2_mcp_skills.md`](./architecture_v2_mcp_skills.md)） |

---

## 14. 参照コード（現状）

| ファイル | 役割 |
|:---|:---|
| `context/AuthContext.tsx` | `login` / `signUp`（要修正） |
| `components/common/ExperienceLoginView.tsx` | ログイン UI（拡張対象） |
| `components/common/LandingView.tsx` | 導線（拡張対象） |
| `server/routes/user.js` | プロフィール自動作成 |
| `components/features/ai/LessonReflectionModal.tsx` | 振り返り POST（認証ヘッダ要修正） |
| `services/authPolicy.ts` | strict / guest 判定 |
| `components/features/PSchool/supabase/profileFunctions.js` | `signUpWithProfile` 参考実装 |

---

## 15. 変更履歴

| 日付 | 版 | 内容 |
|:---|:---|:---|
| 2026-06-24 | 0.1 Draft | 初版作成 |