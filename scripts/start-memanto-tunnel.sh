#!/usr/bin/env bash
# Forward risepath-vm Memanto (127.0.0.1:8100) to local :8100 for Grok stdio MCP.
set -euo pipefail

HOST="${RISEPATH_VM_HOST:-risepath-vm}"
LOCAL_PORT="${MEMANTO_TUNNEL_PORT:-8100}"
REMOTE_PORT="${MEMANTO_VM_PORT:-8100}"

if pgrep -f "ssh.*${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}.*${HOST}" >/dev/null 2>&1; then
  echo "Memanto tunnel already running (localhost:${LOCAL_PORT} → ${HOST})"
else
  ssh -N -f -o ExitOnForwardFailure=yes -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" "${HOST}"
  echo "Started Memanto tunnel (localhost:${LOCAL_PORT} → ${HOST}:${REMOTE_PORT})"
fi

curl -sf "http://127.0.0.1:${LOCAL_PORT}/health" | head -c 200
echo