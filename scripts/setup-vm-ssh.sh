#!/usr/bin/env bash
# Register Mac SSH key on risepath-vm (GCP OS Login) and verify Tailscale SSH.
#
# Prerequisites:
#   gcloud auth login   # refresh expired tokens
#   tailscale ping risepath-vm
#
# Usage:
#   ./scripts/setup-vm-ssh.sh
#   GCP_ZONE=asia-northeast1-b ./scripts/setup-vm-ssh.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_NAME="${RISEPATH_VM_NAME:-risepath-vm}"
GCP_ZONE="${GCP_ZONE:-asia-northeast1-b}"
KEY_FILE="${RISEPATH_SSH_KEY:-${HOME}/.ssh/id_ed25519}"
PUB_FILE="${KEY_FILE}.pub"
SSH_CONFIG="${HOME}/.ssh/config"
HOST_ALIAS="${RISEPATH_VM_HOST:-risepath-vm}"

if [[ ! -f "${PUB_FILE}" ]]; then
  echo "Missing ${PUB_FILE} — generate: ssh-keygen -t ed25519 -C \"\$(whoami)@risepath\""
  exit 1
fi

echo "==> Checking gcloud auth"
if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "❌ gcloud token expired. Run in your terminal:"
  echo "   gcloud auth login"
  echo "   gcloud auth application-default login"
  exit 1
fi

PROJECT="$(gcloud config get-value project 2>/dev/null)"
echo "   project=${PROJECT} vm=${VM_NAME} zone=${GCP_ZONE}"

echo "==> Register SSH public key (OS Login)"
gcloud compute os-login ssh-keys add \
  --key-file="${PUB_FILE}" \
  --ttl=365d

echo "==> Resolve OS Login username"
LOGIN_USER="$(gcloud compute os-login describe-profile --format='value(posixAccounts[0].username)' 2>/dev/null || true)"
if [[ -z "${LOGIN_USER}" ]]; then
  LOGIN_USER="${RISEPATH_VM_USER:-}"
fi

if [[ -z "${LOGIN_USER}" ]]; then
  echo "❌ Could not resolve OS Login username."
  echo "   Run: gcloud compute os-login describe-profile"
  echo "   Then: export RISEPATH_VM_USER=<username> && re-run this script"
  exit 1
fi

echo "   OS Login user: ${LOGIN_USER}"
export RISEPATH_VM_USER="${LOGIN_USER}"

echo "==> Write SSH config block for ${HOST_ALIAS}"
mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"
MARK_BEGIN="# BEGIN rise-path ${HOST_ALIAS}"
MARK_END="# END rise-path ${HOST_ALIAS}"
TMP="$(mktemp)"
if [[ -f "${SSH_CONFIG}" ]]; then
  awk -v b="${MARK_BEGIN}" -v e="${MARK_END}" '
    $0 == b { skip=1; next }
    $0 == e { skip=0; next }
    !skip { print }
  ' "${SSH_CONFIG}" > "${TMP}" || cp "${SSH_CONFIG}" "${TMP}"
else
  : > "${TMP}"
fi

{
  cat "${TMP}"
  echo "${MARK_BEGIN}"
  echo "Host ${HOST_ALIAS}"
  echo "  HostName ${HOST_ALIAS}"
  echo "  User ${LOGIN_USER}"
  echo "  IdentityFile ${KEY_FILE}"
  echo "  IdentitiesOnly yes"
  echo "  StrictHostKeyChecking accept-new"
  echo "${MARK_END}"
} > "${SSH_CONFIG}.new"
mv "${SSH_CONFIG}.new" "${SSH_CONFIG}"
chmod 600 "${SSH_CONFIG}"

echo "==> Test SSH"
SSH_TARGET="${LOGIN_USER:+${LOGIN_USER}@}${HOST_ALIAS}"
if ssh -o BatchMode=yes -o ConnectTimeout=15 "${SSH_TARGET}" 'hostname && whoami'; then
  echo "✅ SSH OK (${SSH_TARGET})"
else
  echo "❌ SSH failed for ${SSH_TARGET}"
  echo "   Try: gcloud compute ssh ${VM_NAME} --zone=${GCP_ZONE} --tunnel-through-iap"
  exit 1
fi

echo "==> Deploy stack"
export RISEPATH_VM_HOST="${HOST_ALIAS}"
export RISEPATH_VM_USER="${LOGIN_USER}"
bash "${REPO_ROOT}/scripts/deploy-from-mac.sh"

# The same remote check as deploy-from-mac.sh: a marker line when stack.env sets ORIGIN_SECRET
# (never the value).
REMOTE_DIR="${RISEPATH_REMOTE_DIR:-/opt/risepath}"
ORIGIN_GATE="$(ssh -o ConnectTimeout=15 "${SSH_TARGET}" "REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE'
set -euo pipefail
STACK_ENV="${REMOTE_DIR}/deploy/risepath-vm/stack.env"
if [[ -f "${STACK_ENV}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${STACK_ENV}"
  set +a
fi
if [[ -n "${ORIGIN_SECRET:-}" ]]; then
  echo "origin-gate:on"
fi
REMOTE
)"

if [[ "${ORIGIN_GATE}" == "origin-gate:on" ]]; then
  # With the origin gate on, :3006 over Tailscale answers 403 without the edge's x-origin-secret.
  echo "==> stack.env sets ORIGIN_SECRET: skipping the Remote E2E via Tailscale"
  echo "    Check the public path: PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge"
  echo "    or, on the VM in deploy/risepath-vm, the container smoke:"
  echo "    docker compose --env-file stack.env exec -T api node scripts/smoke-vm-stack.mjs --target container"
else
  echo "==> Remote E2E"
  E2E_API_URL="http://${HOST_ALIAS}:3006" npm run smoke:prod:e2e --prefix "${REPO_ROOT}"
fi

echo "✅ VM SSH + deploy complete"