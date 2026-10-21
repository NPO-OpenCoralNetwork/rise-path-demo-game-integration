# Rise Path VM deploy (`risepath-vm`)

正本: [`doc/guides/risepath_vm_deployment.md`](../../doc/guides/risepath_vm_deployment.md)

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
| `scripts/deploy-stack.sh` | 再デプロイ（pull → build → migrate → up → smoke） |
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
git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git /opt/risepath
cd /opt/risepath/deploy/risepath-vm/scripts
./bootstrap-vm.sh
# → stack.env を編集して再実行
```

#### 既存の `/opt/risepath` がある場合

`deploy-stack.sh` も `scripts/deploy-from-mac.sh` も、clone 元に `git pull --ff-only` するだけです。先に取得元を確認します。

```bash
git -C /opt/risepath remote -v
git -C /opt/risepath log -1 --oneline
```

`origin` が上の URL でなければ、clone し直します。以前のリポジトリとは履歴がつながっていないので、remote を変えても pull できません。

1. スタックを止める: `docker ps -q --filter label=com.docker.compose.project=risepath | xargs -r docker stop`
2. `deploy/risepath-vm/stack.env` と `deploy/risepath-vm/hermes-data/` を VM 内の別の場所にコピーする（どちらも Git 管理外）
3. `/opt/risepath` を別名に移し、上の `git clone` をやり直す
4. 2 つを元の場所に戻して `./deploy-stack.sh`

DB などの Docker ボリュームは、Compose のプロジェクト名が `risepath` で固定なので残ります。

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

`deploy-stack.sh` は pull で HEAD が進むと、pull したあとの自分自身を 1 回だけ実行し直します。そのあと build → db 起動 → `db:migrate` → `api` の作り直し（healthy まで待つ）→ `up -d` → smoke の順に進みます。

**この版のスクリプトが VM に入る最初のデプロイだけ**は、先に `git pull` してからスクリプトを実行します。VM の `deploy-stack.sh` に `RISEPATH_DEPLOY_REEXEC` の行が無ければ古い版です。

```bash
git -C /opt/risepath pull --ff-only
cd /opt/risepath/deploy/risepath-vm/scripts
./deploy-stack.sh
```

pull するのは実行中の古いスクリプトで、bash は読み込んだ古い本体を最後まで続けます。古い本体は `up -d --build` で新しい `api` を先に起動し、migrate はそのあとです。新しい `api` は未適用の migration があると unhealthy になるので、`up` がそこで止まり、migrate は流れません。

古い順序で走って失敗したときは、pull 済みの新しい `./deploy-stack.sh` をもう一度実行します。migrate を流してから `api` を作り直すので、前回の unhealthy な `api` が残っていても止まりません。`scripts/deploy-from-mac.sh` は先に ssh で pull するので、この手順は要りません。

Mac から検証:

```bash
npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100
```

コース追加などのコンテンツデプロイ後は、`claude-code` ポータル（migration 011 で追加、012 で説明文を更新）、`/claude-code`、`/api/v2/llm/status` の行も確認します。

## セキュリティ

- GCP VPC ファイアウォールで **5432/3006/3100 を 0.0.0.0/0 に開放しない**
- Tailscale ACL で `risepath-vm` へのアクセスを限定
- `stack.env` は `chmod 600`、Git に含めない