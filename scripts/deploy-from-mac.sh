#!/usr/bin/env bash
# Push latest code to risepath-vm and run deploy-stack.sh over Tailscale SSH.
#
# Prerequisites:
#   - Tailscale: risepath-vm reachable
#   - SSH key authorized on VM (user with docker access)
#   - stack.env configured on VM at /opt/risepath/deploy/risepath-vm/stack.env
#
# Usage:
#   ./scripts/deploy-from-mac.sh
#   RISEPATH_VM_HOST=100.104.133.6 ./scripts/deploy-from-mac.sh
#   RISEPATH_VM_USER=ubuntu ./scripts/deploy-from-mac.sh

set -euo pipefail

VM_HOST="${RISEPATH_VM_HOST:-risepath-vm}"
VM_USER="${RISEPATH_VM_USER:-}"
REMOTE_DIR="${RISEPATH_REMOTE_DIR:-/opt/risepath}"
SSH_TARGET="${VM_USER:+${VM_USER}@}${VM_HOST}"

DEPLOY_MODE="${RISEPATH_DEPLOY_MODE:-auto}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Deploy Rise Path stack to ${SSH_TARGET}:${REMOTE_DIR}"

HAS_GIT="$(ssh -o ConnectTimeout=15 "${SSH_TARGET}" "test -d '${REMOTE_DIR}/.git' && echo yes || echo no")"
if [[ "${DEPLOY_MODE}" == "rsync" || "${HAS_GIT}" != "yes" ]]; then
  echo "==> rsync local tree (preserving remote stack.env)"
  rsync -az --delete \
    --exclude node_modules \
    --exclude dist \
    --exclude .git \
    --exclude .env.local \
    --exclude 'data/curricula/blender/blender_manual_v500_en.html' \
    --exclude 'deploy/risepath-vm/stack.env' \
    --exclude 'deploy/risepath-vm/hermes-data' \
    "${REPO_ROOT}/" "${SSH_TARGET}:${REMOTE_DIR}/"
else
  echo "==> git pull on remote"
  ssh -o ConnectTimeout=15 "${SSH_TARGET}" "cd '${REMOTE_DIR}' && git pull --ff-only"
fi

ssh -o ConnectTimeout=15 "${SSH_TARGET}" bash -s <<EOF
set -euo pipefail
cd "${REMOTE_DIR}/deploy/risepath-vm/scripts"
chmod +x init-hermes-profile.sh deploy-stack.sh
./deploy-stack.sh
EOF

echo "==> Remote smoke via Tailscale"
SMOKE_FLAGS=()
while IFS= read -r flag; do
  [[ -n "${flag}" ]] && SMOKE_FLAGS+=("${flag}")
done < <(ssh -o ConnectTimeout=15 "${SSH_TARGET}" "REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE'
set -euo pipefail
STACK_ENV="${REMOTE_DIR}/deploy/risepath-vm/stack.env"
if [[ ! -f "${STACK_ENV}" ]]; then
  echo "--require-mcp"
  exit 0
fi
set -a
# shellcheck disable=SC1091
source "${STACK_ENV}"
set +a
flags=(--require-mcp)
if [[ -n "${MEMANTO_SECRET_KEY:-}" && "${MEMANTO_SECRET_KEY}" != "change-me-memanto-secret" ]]; then
  flags+=(--require-memanto)
fi
profiles="${COMPOSE_PROFILES:-full}"
if [[ "${profiles}" == *tts* || "${profiles}" == *full* ]]; then
  flags+=(--require-kokoro)
fi
if [[ -n "${OPENROUTER_API_KEY:-}" && "${OPENROUTER_API_KEY}" != "change-me" ]]; then
  flags+=(--require-hermes)
fi
printf '%s\n' "${flags[@]}"
REMOTE
)

node "${REPO_ROOT}/scripts/smoke-vm-stack.mjs" \
  --base "http://${VM_HOST}:3006" \
  --mcp "http://${VM_HOST}:3100" \
  --kokoro "http://${VM_HOST}:8880" \
  --hermes "http://${VM_HOST}:8642" \
  --memanto "http://${VM_HOST}:8100" \
  "${SMOKE_FLAGS[@]}"

echo "==> Done. Run production E2E against VM API:"
echo "    E2E_API_URL=http://${VM_HOST}:3006 npm run smoke:prod:e2e"