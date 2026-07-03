# Issue: Nexloom 共通 OAuth / SSO 認証連携の統合

- **状態**: Open (バックログ)
- **対象フェーズ**: 将来 (v2以降の検討課題)
- **関連ドキュメント**:
  - [phase18_user_registration_spec.md](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/phase18_user_registration_spec.md)
  - [implementation_progress.md](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/implementation_progress.md)

---

## 1. 背景と課題

現在、Rise Path のログイン画面にある「**Nexloom IDでログイン**」ボタンは、同一の Supabase 認証プロジェクト（`givhsuvsdukuyloydzsc`）に対してメールアドレスとパスワードをフロントエンドから直接送信する「マルチ認証」方式で実装されています。

この方式は、ユーザーが毎回メール・パスワードを手入力する必要があり、かつパスワード情報を Rise Path 側のフォームが直接扱うため、真のシングルサインオン（SSO）としては改善の余地があります。

### 目標とするUX (To-Be)
1. ユーザーが「Nexloom IDでログイン」をクリックする。
2. ブラウザが自動的に Nexloom の公式ログイン・認可画面（例: `https://worlds.nexloom.co/oauth/authorize`）へ遷移する。
3. ユーザーが Nexloom 側でログインしており、かつ「Rise Path へのアクセス許可（同意）」をクリックする。
4. 認可が完了すると、Nexloom から Rise Path（`http://localhost:3007/auth/callback` など）へ安全にリダイレクトし、セッションが自動確立してログインが完了する。

---

## 2. 必要となる開発要件

この SSO 連携を実現するためには、接続先である **Nexloom 側（認証プロバイダ）** と **Rise Path 側（クライアント）** の両方で以下の実装が必要です。

### A. Nexloom 側（IdP / 認可サーバー）の要件
1. **OAuth 2.0 / OIDC サーバーの実装**:
   - 認可エンドポイント（`/oauth/authorize`）とトークンエンドポイント（`/oauth/token`）の構築。
2. **クライアント登録管理**:
   - Rise Path クライアントID (`rise-path`)、シークレット、および許可リダイレクトURI（`http://localhost:3007/auth/callback`）の登録。
3. **認可同意UI (Consent Screen)**:
   - 「Rise Path があなたのアカウント情報（メールアドレス・プロフィール）へのアクセスを求めています。同意しますか？」という画面の提供。

### B. Rise Path 側（クライアント）の要件
1. **認証リダイレクト処理の追加**:
   - `ExperienceLoginView.tsx` の Nexloom ID ボタン押下時に、Nexloom 側の認可エンドポイントへのリダイレクトを実行。
     （または、Nexloom 側の Supabase Auth にカスタム OAuth プロバイダーが登録されている場合は、`supabase.auth.signInWithOAuth({ provider: 'nexloom' })` を呼び出す。）
2. **コールバックハンドリングの拡張**:
   - `AuthCallbackView.tsx` もしくは `/auth/callback` ルートにおいて、URL パラメータに付与された認可コード（`code`）を受け取り、それをアクセストークン（JWT）と交換して `AuthContext` にセッションとして適用する処理の追加。

---

## 3. 現状の暫定設計（マルチ認証による代替）

Nexloom 側の OAuth / SSO 基盤が未稼働の間は、以下の暫定的な「マルチSupabase認証」を利用します。
*   通常ログイン ➔ Rise Path 側の Supabase (`VITE_SUPABASE_URL`) に接続
*   Nexloom IDログイン ➔ Nexloom 側の Supabase (`VITE_NEXLOOM_SUPABASE_URL`) に接続してパスワード認証
*   学習データやカリキュラムデータは、共通のローカル/VMデータベース（`DATABASE_URL_PHASE1`）で共通管理するため、切り替えによる影響は生じません。
