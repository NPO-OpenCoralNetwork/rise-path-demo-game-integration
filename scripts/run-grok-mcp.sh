#!/usr/bin/env bash
# Grok stdio MCP launcher — sources .env.local before mcp-server (loadEnv alone is not enough when Grok pre-sets empty env).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${ROOT}/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env.local"
  set +a
fi
exec node "${ROOT}/mcp-server/index.js"