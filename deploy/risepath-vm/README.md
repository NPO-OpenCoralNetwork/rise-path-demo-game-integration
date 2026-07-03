# Rise Path VM deploy (`risepath-vm`)

正本: [`doc/risepath_vm_deployment.md`](../../doc/risepath_vm_deployment.md)

## 開発期の方針

| 項目 | 内容 |
|------|------|
| VM | 専用 GCP `risepath-vm`（`e2-medium` 推奨） |
| 稼働 | **09:00–23:00 JST**（GCP インスタンススケジュール） |
| 月額目安 | 約 **¥3,000–3,800**（14h/日 + 50GB ディスク） |
| Mac | `npm run dev` + Tailscale で VM の db/api/mcp に接続 |
| Hermes | Compose **`--profile full`**（`nousresearch/hermes-agent`）。Mac 単体開発は `hermes -p rise-path gateway` も可 |

## ファイル

| ファイル | 内容 |
|----------|------|
| `docker-compose.yml` | `db` + `api` + `mcp` + `kokoro-tts` + `hermes`（profile `full`） |
| `Dockerfile` | `api` / `mcp` マルチターゲット |
| `stack.env.example` | 秘密なしテンプレ → `stack.env` |
| `scripts/provision-gce.sh` | GCP VM + 夜間停止スケジュール作成 |
| `scripts/bootstrap-vm.sh` | VM 初回セットアップ |
| `scripts/deploy-stack.sh` | 再デプロイ（pull + build + migrate + smoke） |
| `hermes/config.yaml` | 本番 Hermes プロファイル（SSE MCP） |
| `systemd/risepath-stack.service` | VM 起動時に compose up |

## クイックスタート

### 1. GCP で VM 作成（Mac から）

```bash
export GCP_PROJECT=your-project-id
cd deploy/risepath-vm/scripts
./provision-gce.sh
```

### 2. VM に SSH して初回 bootstrap

```bash
gcloud compute ssh risepath-vm --zone=asia-northeast1-b

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=risepath-vm

# リポジトリ bootstrap
git clone https://github.com/t012093/rise-path-demo-game-Integration-.git /opt/risepath
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# → stack.env を編集して再実行
```

### 3. Mac `.env.local`

```env
DATABASE_URL_PHASE1=postgresql://risepath_app:***@risepath-vm:5432/risepath?sslmode=disable
HERMES_API_URL=http://hermes:8642
```

API を VM 経由にする場合は Vite プロキシまたは `VITE_API_BASE_URL` を調整。

### 4. 手動でスタック操作（VM 上）

```bash
cd /opt/risepath/deploy/risepath-vm/scripts
./deploy-stack.sh
```

Mac から検証:

```bash
npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100
```

## セキュリティ

- GCP VPC ファイアウォールで **5432/3006/3100 を 0.0.0.0/0 に開放しない**
- Tailscale ACL で `risepath-vm` へのアクセスを限定
- `stack.env` は `chmod 600`、Git に含めない