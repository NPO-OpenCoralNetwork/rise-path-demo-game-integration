#!/usr/bin/env bash
# Redeploy Rise Path stack on risepath-vm (pull, check stack.env, build, migrate, up, wait, smoke)
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

if [[ -n "${OPENROUTER_API_KEY:-}" && "${OPENROUTER_API_KEY,,}" != *change-me* ]]; then
  HERMES_KEYED=1
else
  HERMES_KEYED=0
fi
# Hermes (profile full) starts only when COMPOSE_PROFILES lists it: the shared agent is not offered
# to learners, so an OpenRouter key alone no longer turns it on (stack.env.example: tts).
COMPOSE_PROFILES="${COMPOSE_PROFILES:-}"

COMPOSE_FILES=(-f docker-compose.yml)
MEMANTO_STACK=0
if [[ -n "${MEMANTO_SECRET_KEY:-}" && "${MEMANTO_SECRET_KEY}" != "change-me-memanto-secret" ]]; then
  # The boot unit (systemd/risepath-stack.service) reads stack.env only: with false there, a reboot
  # recreates api and mcp with learner memory off.
  if [[ "${MEMANTO_ENABLED:-}" != "true" ]]; then
    echo "❌ MEMANTO_SECRET_KEY is set: set MEMANTO_ENABLED=true in stack.env (the boot unit reads it)"
    exit 1
  fi
  COMPOSE_FILES+=(-f docker-compose.memanto.yml)
  MEMANTO_STACK=1
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

# Template values deploy green and then break sign-in (Supabase), keep a known DB password and
# bridge token, or give Hermes a key it refuses (under 16 characters). Refuse them before anything
# is built. Prints variable names only, never their values.
PLACEHOLDERS=()
for name in POSTGRES_PASSWORD DATABASE_URL_PHASE1 SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RISE_PATH_BRIDGE_TOKEN; do
  value="${!name:-}"
  if [[ -z "${value}" || "${value,,}" == *change-me* || "${value,,}" == *your-project* ]]; then
    PLACEHOLDERS+=("${name}")
  fi
done
# Profile full starts hermes (published on API_SERVER_PORT) even without an OpenRouter key, so it
# needs that key and its own API key. Profile tts alone runs kokoro-tts without Hermes.
HERMES_PROFILE=0
if [[ ",${COMPOSE_PROFILES// /}," == *",full,"* ]]; then
  HERMES_PROFILE=1
fi
if [[ "${HERMES_PROFILE}" -eq 1 && "${HERMES_KEYED}" -eq 0 ]]; then
  PLACEHOLDERS+=("OPENROUTER_API_KEY (COMPOSE_PROFILES lists full, which starts Hermes: set the key, or use COMPOSE_PROFILES=tts for TTS without Hermes)")
fi
if [[ "${HERMES_PROFILE}" -eq 1 ]]; then
  value="${HERMES_API_KEY:-}"
  if [[ ${#value} -lt 16 || "${value,,}" == *change-me* ]]; then
    PLACEHOLDERS+=("HERMES_API_KEY (at least 16 characters: openssl rand -hex 32)")
  fi
fi
unset value
if [[ ${#PLACEHOLDERS[@]} -gt 0 ]]; then
  echo "❌ stack.env still has empty or template values:"
  printf '   %s\n' "${PLACEHOLDERS[@]}"
  echo "   Fill them (see stack.env.example). POSTGRES_PASSWORD is fixed at the db volume's first"
  echo "   start: set it now (openssl rand -hex 24) and use the same value in DATABASE_URL_PHASE1."
  exit 1
fi

# The guard above makes full imply a real OpenRouter key; without full, Hermes does not start.
if [[ "${HERMES_PROFILE}" -eq 1 ]]; then
  echo "==> init Hermes profile (full stack)"
  "${SCRIPT_DIR}/init-hermes-profile.sh"
else
  echo "==> COMPOSE_PROFILES has no full: Hermes is not started (no init, no smoke)"
fi

compose() {
  docker compose --env-file stack.env "${COMPOSE_FILES[@]}" "$@"
}

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

# `up` leaves containers of services whose profile is not active alone, so a stack that ran Hermes
# before (with the full profile) would keep it running after the switch to tts. Remove it.
if [[ "${HERMES_PROFILE}" -eq 0 && -n "$(compose --profile full ps -aq hermes 2>/dev/null)" ]]; then
  echo "==> COMPOSE_PROFILES has no full: removing the Hermes container left from an earlier deploy"
  compose --profile full rm -sf hermes
fi

echo "==> docker compose up (profiles=${COMPOSE_PROFILES:-default})"
compose up -d

if [[ "${MEMANTO_STACK}" -eq 1 ]]; then
  echo "==> Memanto Ollama models (idempotent)"
  "${SCRIPT_DIR}/init-memanto-ollama.sh" || echo "⚠️  Ollama pull failed — retry: deploy/risepath-vm/scripts/init-memanto-ollama.sh"
fi

# `up -d` returns once the containers start, and the smoke checks each service once (hermes has a
# 90 s start_period). Wait for exactly the services the smoke requires, under the same conditions:
# naming a service on `up` starts it even when no active profile runs it.
SMOKE_FLAGS=(--require-mcp)
WAIT=(mcp)
if [[ "${MEMANTO_STACK}" -eq 1 ]]; then
  SMOKE_FLAGS+=(--require-memanto)
  WAIT+=(memanto)
fi
if [[ "${COMPOSE_PROFILES:-}" == *tts* || "${COMPOSE_PROFILES:-}" == *full* ]]; then
  SMOKE_FLAGS+=(--require-kokoro)
  WAIT+=(kokoro-tts)
fi
if [[ "${HERMES_KEYED}" -eq 1 && ",${COMPOSE_PROFILES// /}," == *",full,"* ]]; then
  SMOKE_FLAGS+=(--require-hermes)
  WAIT+=(hermes)
fi
echo "==> wait until healthy: ${WAIT[*]}"
compose up -d --wait "${WAIT[@]}"

echo "==> stack smoke"
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