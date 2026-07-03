# Vercel フロントデプロイ

静的フロント（`npm run build:prod`）を Vercel に載せ、API は `risepath-vm`（Tailscale）向け。

## 前提

- VM API: `http://risepath-vm:3006`（Tailscale 内のみ。GCP ファイアウォールで 3006 は公開しない）
- ブラウザから API に届けるには、利用者が **Tailscale 同一ネットワーク** にいるか、将来パブリック API ゲートウェイを用意する

## Vercel 環境変数（Production）

`deploy/vercel/env.production.example` を参照。

| 変数 | 例 |
|------|-----|
| `VITE_DEMO_MODE` | `false` |
| `VITE_API_ENABLED` | `true` |
| `VITE_API_BASE_URL` | `http://risepath-vm:3006/api/v2` |
| `VITE_SUPABASE_URL` | Supabase プロジェクト URL |
| `VITE_SUPABASE_ANON_KEY` | anon key |

`VITE_API_BASE_URL` を `/api/v2` のままにする場合は、Vercel から到達可能な API オリジンへのリバースプロキシが別途必要（本リポジトリの `vercel.json` は SPA フォールバックのみ）。

## デプロイ

```bash
# 初回: プロジェクト紐付け + 環境変数（Vercel Dashboard または vercel env add）
npm run vercel:link

# 本番デプロイ（--archive=tgz で巨大リポジトリの CLI OOM / ファイル数上限を回避）
npm run vercel:deploy
```

`.vercelignore` で `node_modules`・Blender マニュアル HTML（~1.2GB）などを除外する。

GitHub 連携でも `main` push 時に自動ビルド可能（環境変数は Dashboard で設定）。

## スモーク

Tailscale 経由で API に届くマシンから:

```bash
E2E_API_URL=http://risepath-vm:3006 npm run smoke:prod:e2e
```