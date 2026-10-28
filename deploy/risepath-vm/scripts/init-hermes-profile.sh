#!/usr/bin/env bash
# Prepare Hermes default profile for Rise Path (SSE MCP on Compose network).
# Run from deploy/risepath-vm after stack.env exists. Needs sudo (see the owner below).
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

# The hermes image chowns /opt/data to HERMES_UID on every start (docker-compose.yml, default
# 1000). The SSH user (an OS Login UID, never 1000) could not overwrite these files after that,
# so write them as root and give them to that UID.
H_UID="${HERMES_UID:-1000}"
H_GID="${HERMES_GID:-1000}"

sudo install -d -o "${H_UID}" -g "${H_GID}" \
  "${DATA_DIR}" "${DATA_DIR}/profiles" "${DATA_DIR}/profiles/default" "${DATA_DIR}/logs"

sudo install -m 644 -o "${H_UID}" -g "${H_GID}" \
  "${STACK_DIR}/hermes/config.yaml" "${DATA_DIR}/profiles/default/config.yaml"

# API_SERVER_KEY in .env wins over the container env at runtime, so it must be the key the api
# sends: HERMES_API_KEY.
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
cat > "${tmp}" <<EOF
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=${API_SERVER_PORT:-8642}
API_SERVER_KEY=${HERMES_API_KEY:-}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
DATABASE_URL_PHASE1=${DATABASE_URL_PHASE1}
RISE_PATH_BRIDGE_TOKEN=${RISE_PATH_BRIDGE_TOKEN:-}
EOF

# Profile .env, and the container-wide one (Hermes docker image reads /opt/data/.env)
sudo install -m 600 -o "${H_UID}" -g "${H_GID}" "${tmp}" "${DATA_DIR}/profiles/default/.env"
sudo install -m 600 -o "${H_UID}" -g "${H_GID}" "${tmp}" "${DATA_DIR}/.env"
rm -f "${tmp}"

echo "Hermes profile initialized at ${DATA_DIR} (owner ${H_UID}:${H_GID})"
echo "  config: profiles/default/config.yaml"
echo "  skills mount: /opt/risepath/skills (via compose volume)"
