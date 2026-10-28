# Security policy

[日本語](#セキュリティポリシー日本語)

## Reporting a vulnerability

Please do not report a security problem in a public issue, discussion or pull request.

Report it privately on GitHub: open the **Security and quality** tab of this repository, go to
**Advisories** and choose **Report a vulnerability**
([direct link](https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration/security/advisories/new)).
Only the maintainers can see the report.

Please include:

- what is affected (a file, an API route or a page) and how to reproduce it
- the impact you expect

Do not include real personal data, and test only with your own account and data.

## Supported versions

Only the latest `main` is maintained. There are no release branches.

## Scope

- In scope: the code in this repository: the web app, the API (`server.js`, `server/`), the MCP
  server (`mcp-server/`) and the deploy scripts (`deploy/`).
- Out of scope: problems in third-party services (Supabase, Vercel, Cloudflare, Stripe, model
  providers). Report those to the service.

## Keys and personal data

- This repository holds no real keys. Server keys live only in server environment files that are
  never committed (`.env.local`, `deploy/risepath-vm/*.env`). Every `VITE_*` value is public.
- CI checks every change for keys and absolute personal paths (`scripts/ci/scan-secrets.mjs`) and
  fails when a server key reaches the browser bundle (`.github/workflows/ci.yml`).
- Learner data (exports, database dumps) is never committed.
- If you find a key in this repository or in its history, report it as above. The maintainers
  revoke the key first; the steps are in
  [`doc/guides/security_guidelines.md`](doc/guides/security_guidelines.md).

---

## セキュリティポリシー（日本語）

### 脆弱性の報告

セキュリティの問題は、公開の Issue・Discussion・プルリクエストに書かないでください。

GitHub で、非公開で報告してください。このリポジトリの **Security and quality** タブの
**Advisories** で、**Report a vulnerability** を選びます
（[直接のリンク](https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration/security/advisories/new)）。
報告は、メンテナーだけが見られます。

次のことを書いてください。

- 影響があるもの（ファイル、API、画面）と、再現の手順
- 考えられる影響

本物の個人情報は書かないでください。試すときは、自分のアカウントとデータだけを使ってください。

### 対象の版

メンテナンスしているのは、最新の `main` だけです。リリースのブランチはありません。

### 対象の範囲

- 対象: このリポジトリのコード（Web アプリ、API の `server.js` と `server/`、MCP サーバーの
  `mcp-server/`、デプロイのスクリプトの `deploy/`）
- 対象外: 外部のサービス（Supabase、Vercel、Cloudflare、Stripe、AI のモデルの提供元）の問題。
  それぞれのサービスに報告してください。

### 鍵と個人情報

- このリポジトリに、本物の鍵はありません。サーバーの鍵は、コミットしないサーバーの環境のファイル
  （`.env.local`、`deploy/risepath-vm/*.env`）だけに置きます。`VITE_*` の値は、すべて公開されます。
- CI は、すべての変更で鍵と個人の絶対パスを確かめ（`scripts/ci/scan-secrets.mjs`）、サーバーの鍵が
  ブラウザのビルドに入ったときは失敗します（`.github/workflows/ci.yml`）。
- 学習者のデータ（書き出し、データベースのダンプ）は、コミットしません。
- このリポジトリやその履歴に鍵を見つけたときは、上の方法で報告してください。メンテナーが、まず鍵を
  無効にします。手順は [`doc/guides/security_guidelines.md`](doc/guides/security_guidelines.md) に
  あります。
