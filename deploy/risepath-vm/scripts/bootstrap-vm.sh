#!/usr/bin/env bash
# First-time setup ON risepath-vm (after SSH + Tailscale)
# Usage: ./bootstrap-vm.sh [repo-url]
set -euo pipefail

REPO_URL="${1:-https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git}"
INSTALL_DIR="${RISEPATH_INSTALL_DIR:-/opt/risepath}"
STACK_DIR="${INSTALL_DIR}/deploy/risepath-vm"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing Docker (if needed)"
bash "${SCRIPT_DIR}/install-docker.sh"

# 4 GiB swap on the boot disk, made once: headroom for npm ci and TTS spikes on e2-medium (4 GB).
# A VM that already runs /swapfile skips it; other swap areas stay as they are.
echo "==> Swap file /swapfile (4 GiB, once)"
if swapon --show=NAME --noheadings | grep -x /swapfile >/dev/null; then
  echo "    /swapfile is already on"
else
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
fi
if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "==> Install Tailscale, then re-run:"
  echo "    curl -fsSL https://tailscale.com/install.sh | sh"
  echo "    sudo tailscale up --hostname=risepath-vm"
  exit 1
fi

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  echo "==> Cloning repo to ${INSTALL_DIR}"
  sudo mkdir -p "${INSTALL_DIR}"
  sudo chown "$(id -un):$(id -gn)" "${INSTALL_DIR}"
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${STACK_DIR}"

if [[ ! -f stack.env ]]; then
  echo "==> Creating stack.env from template — EDIT SECRETS before continuing"
  cp stack.env.example stack.env
  chmod 600 stack.env
  echo "    nano ${STACK_DIR}/stack.env"
  exit 1
fi

# install-docker.sh adds this user to the docker group, which takes effect only in a new login.
if ! docker info >/dev/null 2>&1; then
  echo "==> docker group not active yet: exit, SSH in again, re-run ./bootstrap-vm.sh"
  exit 1
fi

echo "==> Deploy and smoke (stops on template values in stack.env)"
bash "${STACK_DIR}/scripts/deploy-stack.sh"

# Only after a green deploy: the boot unit runs `compose up -d` with stack.env as it is. Enabled
# earlier, a reboot with a template stack.env would start db with POSTGRES_PASSWORD=change-me,
# which the db volume then keeps.
echo "==> Installing systemd unit (start stack on VM boot)"
sudo cp "${STACK_DIR}/systemd/risepath-stack.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable risepath-stack.service

echo "==> Done. Re-run the stack smoke on this VM (inside the api container, past the origin gate):"
echo "    cd ${STACK_DIR} && docker compose --env-file stack.env exec -T api node scripts/smoke-vm-stack.mjs --target container"
echo "Public path (Vercel app.<domain> → Cloudflare Tunnel api.<domain>), from the Mac:"
echo "    PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge"
echo "From the Mac over Tailscale (while stack.env has no ORIGIN_SECRET; then :3006 needs the x-origin-secret header):"
echo "    npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100"
echo "Mac の .env.local は、開発用の DB を使います（doc/guides/first-launch.ja.md 18 章。本番の DB には VM の中からだけ触ります）"