#!/usr/bin/env bash
# Redeploy Rise Path stack on risepath-vm (pull, build, migrate, up, smoke)
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
  HEAD_BEFORE="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  git -C "${REPO_ROOT}" pull --ff-only
  # The pull may replace this file, but bash keeps reading the copy it opened. Re-run once so
  # the steps below always come from the pulled version.
  if [[ "$(git -C "${REPO_ROOT}" rev-parse HEAD)" != "${HEAD_BEFORE}" && -z "${RISEPATH_DEPLOY_REEXEC:-}" ]]; then
    echo "==> HEAD moved — re-running the pulled deploy-stack.sh"
    RISEPATH_DEPLOY_REEXEC=1 exec "${BASH}" "${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")" "$@"
  fi
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

# Profile tunnel publishes the api as https://api.<domain> (Cloudflare Tunnel). Refuse it until the
# origin gate and the tunnel token are in place. Prints variable names only, never their values.
if [[ ",${COMPOSE_PROFILES// /}," == *",tunnel,"* ]]; then
  TUNNEL_MISSING=()
  if [[ ! -f tunnel.env ]] || ! grep -Eq '^TUNNEL_TOKEN=.+' tunnel.env; then
    TUNNEL_MISSING+=("TUNNEL_TOKEN (tunnel.env, from tunnel.env.example)")
  fi
  ORIGIN_SECRET_VALUE="${ORIGIN_SECRET:-}"
  if [[ ${#ORIGIN_SECRET_VALUE} -lt 32 || "${ORIGIN_SECRET_VALUE}" == '$'* || "${ORIGIN_SECRET_VALUE,,}" == *change-me* ]]; then
    TUNNEL_MISSING+=("ORIGIN_SECRET (stack.env: openssl rand -hex 32, same value as in Vercel)")
  fi
  unset ORIGIN_SECRET_VALUE
  if [[ -z "${LLM_ALLOWED_ORIGINS:-}" ]]; then
    TUNNEL_MISSING+=("LLM_ALLOWED_ORIGINS (stack.env: https://app.<domain>)")
  fi
  if [[ -n "${RISE_PATH_PUBLIC_URL:-}" ]]; then
    TUNNEL_MISSING+=("RISE_PATH_PUBLIC_URL (stack.env: must be unset)")
  fi
  if [[ ${#TUNNEL_MISSING[@]} -gt 0 ]]; then
    echo "❌ COMPOSE_PROFILES includes tunnel, but these are missing or invalid:"
    printf '   %s\n' "${TUNNEL_MISSING[@]}"
    echo "   Fix them (see stack.env.example), or remove tunnel from COMPOSE_PROFILES."
    exit 1
  fi
  if [[ "${TRUST_PROXY:-}" != "1" ]]; then
    echo "⚠️  TRUST_PROXY is not 1 — with the tunnel, cloudflared is one proxy hop (stack.env)"
  fi
  echo "==> Public edge: tunnel profile enabled (origin gate on)"
fi

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

echo "==> docker compose build (profiles=${COMPOSE_PROFILES:-default})"
compose build

# Migrate before `up` starts the new api image: /api/v2/health answers 503 while a migration is
# pending, and mcp (then hermes) waits for the api healthcheck. The running api keeps its old
# image until `up`, and every migration that image knows is already applied.
echo "==> db up (wait until healthy)"
compose up -d --wait db

echo "==> db:migrate (new api image, one-off container)"
compose run --rm --no-deps -T api npm run db:migrate

# An api left unhealthy by an earlier failed run keeps that status when `up` finds nothing to
# change, and `up` then stops on mcp's depends_on at once. Recreate it and wait for healthy.
echo "==> api up (recreate, wait until healthy)"
compose up -d --no-deps --force-recreate --wait api

echo "==> docker compose up (profiles=${COMPOSE_PROFILES:-default})"
compose up -d

if [[ "${MEMANTO_STACK}" -eq 1 ]]; then
  echo "==> Memanto Ollama models (idempotent)"
  "${SCRIPT_DIR}/init-memanto-ollama.sh" || echo "⚠️  Ollama pull failed — retry: deploy/risepath-vm/scripts/init-memanto-ollama.sh"
fi

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

# Always from inside the api container: there 127.0.0.1 is loopback, which the origin gate exempts.
# From the host, the published port does not arrive as loopback (403 once ORIGIN_SECRET is set).
compose exec -T api env \
  PORT="${PORT:-3006}" \
  MCP_SSE_PORT="${MCP_SSE_PORT:-3100}" \
  API_SERVER_PORT="${API_SERVER_PORT:-8642}" \
  MEMANTO_API_PORT="${MEMANTO_API_PORT:-8100}" \
  node scripts/smoke-vm-stack.mjs --target container "${SMOKE_FLAGS[@]}"

echo "==> Done"
compose ps