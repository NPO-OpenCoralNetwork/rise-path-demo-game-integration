#!/usr/bin/env bash
# First-time setup ON risepath-vm (after SSH + Tailscale)
# Usage: ./bootstrap-vm.sh [repo-url]
set -euo pipefail

REPO_URL="${1:-https://github.com/t012093/rise-path-demo-game-Integration-.git}"
INSTALL_DIR="${RISEPATH_INSTALL_DIR:-/opt/risepath}"
STACK_DIR="${INSTALL_DIR}/deploy/risepath-vm"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing Docker (if needed)"
bash "${SCRIPT_DIR}/install-docker.sh"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "==> Install Tailscale, then re-run:"
  echo "    curl -fsSL https://tailscale.com/install.sh | sh"
  echo "    sudo tailscale up --hostname=risepath-vm"
  exit 1
fi

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  echo "==> Cloning repo to ${INSTALL_DIR}"
  sudo mkdir -p "${INSTALL_DIR}"
  sudo chown "${USER}:${USER}" "${INSTALL_DIR}"
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

echo "==> Installing systemd unit (start stack on VM boot)"
sudo cp "${STACK_DIR}/systemd/risepath-stack.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable risepath-stack.service

echo "==> Stack smoke"
bash "${SCRIPT_DIR}/deploy-stack.sh"

echo "==> Done. Verify from Mac:"
echo "    npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100"
echo "Mac .env.local → DATABASE_URL_PHASE1=postgresql://risepath_app:***@risepath-vm:5432/risepath?sslmode=disable"