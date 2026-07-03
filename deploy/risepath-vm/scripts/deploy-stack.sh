#!/usr/bin/env bash
# Redeploy Rise Path stack on risepath-vm (pull, build, migrate, smoke)
# Usage (on VM): ./deploy-stack.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${STACK_DIR}/../.." && pwd)"

cd "${STACK_DIR}"

if [[ ! -f stack.env ]]; then
  echo "Missing stack.env — copy stack.env.example and fill secrets"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source stack.env
set +a

if [[ -d "${REPO_ROOT}/.git" ]]; then
  echo "==> git pull"
  git -C "${REPO_ROOT}" pull --ff-only
fi

if [[ -n "${OPENROUTER_API_KEY:-}" && "${OPENROUTER_API_KEY}" != "change-me" ]]; then
  echo "==> init Hermes profile (full stack)"
  "${SCRIPT_DIR}/init-hermes-profile.sh"
fi

if [[ -n "${OPENROUTER_API_KEY:-}" && "${OPENROUTER_API_KEY}" != "change-me" ]]; then
  COMPOSE_PROFILES="${COMPOSE_PROFILES:-full}"
else
  echo "⚠️  OPENROUTER_API_KEY unset — skipping hermes profile (set in stack.env to enable)"
  COMPOSE_PROFILES="${COMPOSE_PROFILES:-}"
fi

COMPOSE_FILES=(-f docker-compose.yml)
MEMANTO_STACK=0
if [[ -n "${MEMANTO_SECRET_KEY:-}" && "${MEMANTO_SECRET_KEY}" != "change-me-memanto-secret" ]]; then
  COMPOSE_FILES+=(-f docker-compose.memanto.yml)
  MEMANTO_STACK=1
  export MEMANTO_ENABLED=true
  if [[ ",${COMPOSE_PROFILES}," != *",memory,"* ]]; then
    COMPOSE_PROFILES="${COMPOSE_PROFILES:+${COMPOSE_PROFILES},}memory"
  fi
  echo "==> Memanto overlay enabled (profile memory)"
else
  export MEMANTO_ENABLED="${MEMANTO_ENABLED:-false}"
  echo "⚠️  MEMANTO_SECRET_KEY unset — skipping Memanto overlay"
fi
export COMPOSE_PROFILES

compose() {
  docker compose --env-file stack.env "${COMPOSE_FILES[@]}" "$@"
}

if [[ "${MEMANTO_STACK}" -eq 1 ]]; then
  echo "==> Memanto data volume permissions (uid 1001)"
  MEMANTO_VOL="$(compose volume ls -q 2>/dev/null | grep risepath_memanto_data | head -1 || true)"
  if [[ -n "${MEMANTO_VOL}" ]]; then
    MEMANTO_MP="$(docker volume inspect "${MEMANTO_VOL}" --format '{{.Mountpoint}}' 2>/dev/null || true)"
    if [[ -n "${MEMANTO_MP}" && -d "${MEMANTO_MP}" ]]; then
      sudo chown -R 1001:1001 "${MEMANTO_MP}" 2>/dev/null || true
    fi
  fi
fi

echo "==> docker compose up --build (profiles=${COMPOSE_PROFILES:-default})"
compose up -d --build

if [[ "${MEMANTO_STACK}" -eq 1 ]]; then
  echo "==> Memanto Ollama models (idempotent)"
  "${SCRIPT_DIR}/init-memanto-ollama.sh" || echo "⚠️  Ollama pull failed — retry: deploy/risepath-vm/scripts/init-memanto-ollama.sh"
fi

echo "==> db:migrate"
compose exec -T api npm run db:migrate

echo "==> stack smoke"
SMOKE_FLAGS=(--require-mcp)
if [[ "${MEMANTO_STACK}" -eq 1 ]]; then
  SMOKE_FLAGS+=(--require-memanto)
fi
if [[ "${COMPOSE_PROFILES:-}" == *tts* || "${COMPOSE_PROFILES:-}" == *full* ]]; then
  SMOKE_FLAGS+=(--require-kokoro)
fi
if [[ -n "${OPENROUTER_API_KEY:-}" && "${OPENROUTER_API_KEY}" != "change-me" ]]; then
  SMOKE_FLAGS+=(--require-hermes)
fi

if command -v node >/dev/null 2>&1; then
  node "${REPO_ROOT}/scripts/smoke-vm-stack.mjs" --target host "${SMOKE_FLAGS[@]}"
else
  compose exec -T api env \
    PORT="${PORT:-3006}" \
    MCP_SSE_PORT="${MCP_SSE_PORT:-3100}" \
    API_SERVER_PORT="${API_SERVER_PORT:-8642}" \
    MEMANTO_API_PORT="${MEMANTO_API_PORT:-8100}" \
    node scripts/smoke-vm-stack.mjs --target container "${SMOKE_FLAGS[@]}"
fi

echo "==> Done"
compose ps