#!/usr/bin/env bash
# Prepare Hermes default profile for Rise Path (SSE MCP on Compose network).
# Run from deploy/risepath-vm after stack.env exists.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${HERMES_DATA_DIR:-${STACK_DIR}/hermes-data}"

if [[ ! -f "${STACK_DIR}/stack.env" ]]; then
  echo "Missing ${STACK_DIR}/stack.env"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "${STACK_DIR}/stack.env"
set +a

mkdir -p "${DATA_DIR}/profiles/default" "${DATA_DIR}/logs"

cp "${STACK_DIR}/hermes/config.yaml" "${DATA_DIR}/profiles/default/config.yaml"

cat > "${DATA_DIR}/profiles/default/.env" <<EOF
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=${API_SERVER_PORT:-8642}
API_SERVER_KEY=${API_SERVER_KEY:-${HERMES_API_KEY:-}}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
DATABASE_URL_PHASE1=${DATABASE_URL_PHASE1}
RISE_PATH_BRIDGE_TOKEN=${RISE_PATH_BRIDGE_TOKEN:-}
EOF

# Container-wide secrets (Hermes docker image reads /opt/data/.env)
cp "${DATA_DIR}/profiles/default/.env" "${DATA_DIR}/.env"
chmod 600 "${DATA_DIR}/.env" "${DATA_DIR}/profiles/default/.env"

echo "Hermes profile initialized at ${DATA_DIR}"
echo "  config: profiles/default/config.yaml"
echo "  skills mount: /opt/risepath/skills (via compose volume)"