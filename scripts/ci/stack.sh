#!/usr/bin/env bash
# The VM stack in CI (Phase 7; .github/workflows/e2e.yml jobs "Server stack deploy" and "Learner
# end-to-end"; doc/brushup-2026/ai-access-plan.ja.md). Always the compose project risepath-ci, never the
# VM's or a developer's risepath. Installs the dummy env file deploy/risepath-vm/ci/stack.ci.env for one
# run and removes only files it installed (first line: the marker). Prints names, never values.
# Each workflow step runs one subcommand, in the order of `rehearsal` (Server stack deploy) and `e2e`
# (Learner end-to-end); server/tests/e2eWorkflow.test.js keeps the orders equal.
# Run it only on a trusted network: while it runs, the stack publishes 5432 (the database superuser,
# with the template's known password), 3006 and 3100 on all interfaces (on Linux, past ufw).
#   preflight [e2e]   refuse foreign env files next to the compose file, busy ports (with e2e also the
#                     preview's 4173 and the stand-in's), < 5 GB free disk, no `timeout` (coreutils);
#                     print the Docker, Compose and storage-driver versions (compare them with the VM's)
#   install-env       ci/stack.ci.env -> stack.env
#   pull              the base images (Dockerfile FROM, the db image), 3 attempts each, 420 s in all
#   deploy <n>        only with the installed template and no foreign env file: the real deploy-stack.sh
#                     with RISEPATH_DEPLOY_SKIP_PULL=1; log deploy-<n>.log
#   mcp-db            the admin MCP's /health says its database is connected
#   health            /api/v2/health from the host: production-ready, no pending migration
#   auth              the auth stand-in (e2e/support/auth-stand-in.mjs) in a container on the stack's
#                     network, under the host name and port of the template's SUPABASE_URL; published on
#                     127.0.0.1 only; checks that the api container reaches it
#   build-front       the production build (build:prod) for the stand-in into .artifacts/e2e/dist: no key,
#                     VITE_FEATURE_LEGAL_PAGES unset, VITE_* keys of local .env files blanked
#   browser           Chromium for Playwright (on CI only: the headless shell and its system packages)
#   test              the learner flows (npx playwright test, playwright.config.ts)
#   logs <dir>        compose, deploy and stand-in logs, redacted with the template and every env file present
#   down              the stand-in, the risepath-ci project and its volume, the installed env file, the
#                     front build (.artifacts/e2e/dist); the logs and test results stay, and so do the
#                     images risepath-ci-api and -mcp and the build cache (about 4 GB: a faster next run)
#   rehearsal | e2e   a whole job locally (npm run ci:stack | npm run e2e:local): logs on failure, always down
set -euo pipefail

CALLER_PWD="${PWD}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK="${ROOT}/deploy/risepath-vm"
PROJECT=risepath-ci
MARKER='# risepath-ci-env:'
TEMPLATE="${STACK}/ci/stack.ci.env"
AUTH_NAME="${PROJECT}-auth"
LOG_DIR="${RISEPATH_CI_LOG_DIR:-${ROOT}/.artifacts/ci/stack/raw}"
# Each pull may take PULL_EACH_S, and all of them with the pauses PULL_BUDGET_S (an uncached pull takes
# seconds), so a hanging registry ends with this script's message, inside the step's 10 minutes.
PULL_EACH_S=90
PULL_BUDGET_S=420

if [[ -n "${COMPOSE_PROJECT_NAME:-}" && "${COMPOSE_PROJECT_NAME}" != "${PROJECT}" ]]; then
  echo "❌ COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}: this script drives the ${PROJECT} project only"
  exit 2
fi
export COMPOSE_PROJECT_NAME="${PROJECT}"

fail() {
  echo "❌ $*"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::error title=Stack::$*"; fi
  exit 1
}
ours() { [[ -f "$1" ]] && head -n 1 "$1" | grep -q "^${MARKER}"; }
value_of() { sed -n "s/^$1=//p" "$2" | tail -n 1; }   # <name> <env file>
envfile() { if ours "${STACK}/stack.env"; then echo "${STACK}/stack.env"; else echo "${TEMPLATE}"; fi; }
compose() { docker compose -p "${PROJECT}" --env-file "$(envfile)" -f "${STACK}/docker-compose.yml" "$@"; }
# The files docker-compose.yml loads (env_file) or deploy-stack.sh sources when they exist.
ENV_FILES=(stack.env mcp-public.env billing.env tunnel.env)
refuse_foreign_env() {
  local f
  for f in "${ENV_FILES[@]}"; do
    if [[ -e "${STACK}/${f}" ]] && ! ours "${STACK}/${f}"; then
      fail "deploy/risepath-vm/${f} exists: the CI stack would load it (env_file). Move it away, or use another checkout"
    fi
  done
}
need_timeout() { # cmd_pull and cmd_browser bound every download with it; stock macOS has none
  command -v timeout > /dev/null || fail 'timeout is not on PATH (coreutils; on a Mac: brew install coreutils, then put its gnubin folder on PATH)'
}

install_file() { # <template> <target>: never replaces a file this script did not write
  if [[ -e "$2" ]] && ! ours "$2"; then
    fail "${2#"${ROOT}"/} exists and was not written by scripts/ci/stack.sh: move it away (it is never overwritten)"
  fi
  cp "$1" "$2"
  chmod 600 "$2"
}

cmd_preflight() { # [e2e]
  local port free_gb ports=(5432 3006 3100)
  if [[ -n "${1:-}" && "$1" != e2e ]]; then fail "preflight takes nothing or e2e, not '$1'"; fi
  refuse_foreign_env
  need_timeout
  # The VM installs the current docker-ce and compose plugin (scripts/install-docker.sh): compare.
  docker version --format 'Docker {{.Server.Version}}'
  docker compose version
  docker info --format 'Storage driver: {{.Driver}}'
  if [[ "${1:-}" == e2e ]]; then   # vite preview (playwright.config.ts) and the stand-in (stack.sh auth)
    auth_target
    ports+=(4173 "${AUTH_PORT}")
  fi
  for port in "${ports[@]}"; do
    if (exec 3<> "/dev/tcp/127.0.0.1/${port}") 2> /dev/null; then fail "port ${port} is in use (the CI stack needs it)"; fi
  done
  free_gb="$(df -Pk "${ROOT}" | awk 'NR==2 {print int($4/1048576)}')"
  echo "Free disk: ${free_gb} GB"
  if [[ "${free_gb}" -lt 5 ]]; then
    # A previous local run keeps its images and build cache (about 4 GB) for a faster rebuild; down
    # removes the project only. CI runners start empty, so only a local refusal names them.
    if [[ -z "${CI:-}" ]] && docker image inspect "${PROJECT}-api" > /dev/null 2>&1; then
      fail "only ${free_gb} GB free; the CI stack needs 5 GB (images, build cache, database); a previous local run kept its images and build cache: docker image rm ${PROJECT}-api ${PROJECT}-mcp, then docker builder prune (it also clears other builds' cache)"
    fi
    fail "only ${free_gb} GB free; the CI stack needs 5 GB (images, build cache, database)"
  fi
}

cmd_install_env() { install_file "${TEMPLATE}" "${STACK}/stack.env"; echo "deploy/risepath-vm/stack.env <- ci/stack.ci.env"; }

mirror_of() { # a Docker Hub reference on mirror.gcr.io (Google's pull-through copy of Docker Hub; no login)
  local repo="${1%%[:@]*}"
  [[ "${repo}" == */* ]] || repo="library/${repo}"
  if [[ "$1" == *@* ]]; then echo "mirror.gcr.io/${repo}@${1##*@}"; else echo "mirror.gcr.io/${repo}:${1##*:}"; fi
}

cmd_pull() { # idempotent downloads, retried with a warning; never a check
  local image attempt mirror pause pull_end=$((SECONDS + PULL_BUDGET_S))
  need_timeout
  pull() { # <image>: what is left of the budget, PULL_EACH_S at most
    local left=$((pull_end - SECONDS))
    if [[ "${left}" -le 0 ]]; then return 1; fi
    timeout "$((left < PULL_EACH_S ? left : PULL_EACH_S))" docker pull -q "$1" > /dev/null
  }
  for image in $(sed -nE 's/^FROM ([^ ]+).*/\1/p' "${STACK}/Dockerfile" | sort -u) \
               "$(sed -nE 's#^ *image: (pgvector/pgvector:[^ ]+)$#\1#p' "${STACK}/docker-compose.yml")"; do
    mirror="$(mirror_of "${image}")"
    for attempt in 1 2 3; do
      if pull "${image}"; then break; fi
      # Docker Hub refuses anonymous pulls past its limit (429) on a shared runner IP. Fall back to the
      # same reference on mirror.gcr.io: Docker verifies a pinned digest, so pgvector is the same image;
      # a tag (node:22-slim) may lag Docker Hub by hours. The re-tag must satisfy the reference that
      # compose and the Dockerfile use; on the classic image store a digest reference cannot be re-tagged,
      # so the inspect fails there and the attempt counts as failed.
      if pull "${mirror}" && docker tag "${mirror}" "${image%%@*}" \
          && docker image inspect "${image}" > /dev/null 2>&1; then
        echo "::warning ::docker pull ${image%%@*}: Docker Hub failed; using ${mirror%%@*} (a pinned digest is the same image)"
        break
      fi
      pause=$((attempt * 10))
      if [[ "${attempt}" -eq 3 || $((pull_end - SECONDS)) -le "${pause}" ]]; then
        fail "docker pull ${image%%@*} failed on Docker Hub and mirror.gcr.io (attempt ${attempt} of 3, ${PULL_BUDGET_S} s at most for all pulls); re-run the job later"
      fi
      echo "::warning ::docker pull ${image%%@*} failed (attempt ${attempt}); trying again in ${pause} s"
      sleep "${pause}"
    done
  done
}

cmd_deploy() { # <n>: the real script; the opt-out skips only its git pull (owner decision P3)
  # deploy-stack.sh sources whatever stack.env is there: never a developer's or the VM's real values.
  ours "${STACK}/stack.env" || fail 'deploy/risepath-vm/stack.env is not the CI template: run install-env first'
  refuse_foreign_env
  mkdir -p "${LOG_DIR}"
  local status=0
  RISEPATH_DEPLOY_SKIP_PULL=1 bash "${STACK}/scripts/deploy-stack.sh" 2>&1 | tee "${LOG_DIR}/deploy-$1.log" || status=$?
  # deploy-stack.sh prints its own ❌ or Compose's error, but no annotation: name the failure for the check.
  if [[ "${status}" -ne 0 ]]; then fail "deploy-stack.sh exited ${status}: its last lines above say why (deploy-$1.log)"; fi
}

cmd_mcp_db() { # mcp's /health answers 200 either way; its body says whether the database answered
  compose exec -T mcp node -e "fetch('http://127.0.0.1:3100/health', { signal: AbortSignal.timeout(20000) }).then((r) => r.json()).then((b) => process.exit(b.db === 'connected' ? 0 : 1)).catch(() => process.exit(1))" \
    || fail 'mcp /health: the database is not connected (mcp-server/index.js, GET /health)'
}

cmd_health() { # from the host, through the published port (no origin gate in CI); a 503 body is printed too
  curl -sS --max-time 20 http://127.0.0.1:3006/api/v2/health | node -e "
    let s = ''; process.stdin.on('data', (c) => { s += c; }).on('end', () => {
      let h;
      try { h = JSON.parse(s); } catch { console.error('health: not JSON:', JSON.stringify(s.slice(0, 200))); process.exit(1); }
      const ok = h.ok === true && h.node_env === 'production' && h.checks?.strict_auth_mode === true
        && h.checks?.production_data_mode === true && h.database?.migrations?.pending === 0;
      if (!ok) { console.error('health:', JSON.stringify({ ok: h.ok, node_env: h.node_env, checks: h.checks, migrations: h.database?.migrations })); process.exit(1); }
    });" || fail '/api/v2/health from the host is not production-ready'
}

# The stand-in's host name on the stack's network and its port: the template's SUPABASE_URL (one source).
auth_target() {
  local url
  url="$(value_of SUPABASE_URL "${TEMPLATE}")"
  [[ "${url}" =~ ^http://([a-z][a-z0-9-]*):([0-9]+)$ ]] || fail 'SUPABASE_URL of deploy/risepath-vm/ci/stack.ci.env is not http://<name>:<port>'
  AUTH_ALIAS="${BASH_REMATCH[1]}"
  AUTH_PORT="${BASH_REMATCH[2]}"
}

cmd_auth() { # the api reaches it as the template's SUPABASE_URL; the browser as http://127.0.0.1:<port>
  local _ image file="${ROOT}/e2e/support/auth-stand-in.mjs"
  auth_target
  local alias="${AUTH_ALIAS}" port="${AUTH_PORT}"
  [[ -f "${file}" ]] || fail 'e2e/support/auth-stand-in.mjs is missing'
  # The api's own base image (pull fetched it, with the mirror fallback): no other download.
  image="$(sed -nE 's/^FROM ([^ ]+) AS api$/\1/p' "${STACK}/Dockerfile")"
  [[ -n "${image}" ]] || fail 'deploy/risepath-vm/Dockerfile has no "FROM <image> AS api" line'
  docker rm -f "${AUTH_NAME}" > /dev/null 2>&1 || true
  # --mount (not -v): a missing source is an error, never an empty folder created on the host.
  docker run -d --name "${AUTH_NAME}" --network "${PROJECT}_default" --network-alias "${alias}" \
    -p "127.0.0.1:${port}:${port}" --read-only --cap-drop ALL --security-opt no-new-privileges --user node \
    -e RISEPATH_E2E_AUTH_STANDIN=1 -e E2E_AUTH_HOST=0.0.0.0 -e E2E_AUTH_PORT="${port}" \
    -e E2E_AUTH_PUBLIC_URL="http://127.0.0.1:${port}" \
    --mount "type=bind,src=${file},dst=/stand-in/auth-stand-in.mjs,readonly" \
    "${image}" node /stand-in/auth-stand-in.mjs > /dev/null
  for _ in $(seq 1 30); do   # a readiness poll, not a test wait
    if curl -fsS --max-time 5 "http://127.0.0.1:${port}/auth/v1/health" > /dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! curl -fsS --max-time 5 "http://127.0.0.1:${port}/auth/v1/health" > /dev/null; then
    docker logs "${AUTH_NAME}" 2>&1 | tail -n 20 || true
    fail "the auth stand-in does not answer on http://127.0.0.1:${port}"
  fi
  compose exec -T api node -e "fetch('http://${alias}:${port}/auth/v1/health', { signal: AbortSignal.timeout(20000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
    || fail "the api container cannot reach http://${alias}:${port} (network ${PROJECT}_default)"
  echo "==> auth stand-in: http://127.0.0.1:${port} (browser), http://${alias}:${port} (api)"
}

cmd_build_front() { # the deployed build mode for the stand-in; no key, VITE_FEATURE_LEGAL_PAGES never set
  auth_target
  (
    cd "${ROOT}"
    local key blank=()
    # A developer's .env files must not reach this bundle: Vite lets the process env win over them, so
    # their VITE_* keys are set empty here; the caller's VITE_FEATURE_LEGAL_PAGES is removed (ci.yml's rule).
    # The keys are read in every line form Vite's dotenv reads (vite.config.ts loadEnv): indented,
    # `export NAME=…`, `NAME: value` and lower-case letters, as deploy-stack.sh's ENV_KEY does for Compose.
    while read -r key; do
      if [[ -n "${key}" && "${key}" != VITE_SUPABASE_URL && "${key}" != VITE_SUPABASE_ANON_KEY ]]; then blank+=("${key}="); fi
    done < <(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?(VITE_[A-Za-z0-9_.-]*)([[:space:]]*=|:[[:space:]]).*/\2/p' \
      .env .env.local .env.production .env.production.local 2> /dev/null | sort -u)
    if [[ ${#blank[@]} -gt 0 ]]; then echo "blanking ${#blank[@]} VITE_* keys found in local .env files"; fi
    env -u VITE_FEATURE_LEGAL_PAGES ${blank[@]+"${blank[@]}"} NODE_OPTIONS=--max-old-space-size=4096 \
      VITE_SUPABASE_URL="http://127.0.0.1:${AUTH_PORT}" VITE_SUPABASE_ANON_KEY=ci-dummy-anon-key \
      npm run build:prod -- --outDir .artifacts/e2e/dist --emptyOutDir
    grep -rqF "127.0.0.1:${AUTH_PORT}" .artifacts/e2e/dist/assets || fail "the build does not point at the auth stand-in (127.0.0.1:${AUTH_PORT})"
  )
}

# Each playwright install may take BROWSER_EACH_S; three of them with the pauses (15 s, 30 s) stay inside
# the workflow step's 10 minutes, so a hanging mirror ends with this script's message.
BROWSER_EACH_S=180

cmd_browser() { # an idempotent download, retried with a warning; never a test
  local attempt
  if [[ -z "${CI:-}" ]]; then
    echo 'Local run: Playwright uses PLAYWRIGHT_CHROMIUM_PATH, the preinstalled build, or its own browsers (npx playwright install chromium)'
    return 0
  fi
  need_timeout
  for attempt in 1 2 3; do
    if (cd "${ROOT}" && timeout "${BROWSER_EACH_S}" npx playwright install --with-deps --only-shell chromium); then return 0; fi
    if [[ "${attempt}" -eq 3 ]]; then break; fi
    echo "::warning ::playwright install failed (attempt ${attempt}); trying again in $((attempt * 15)) s"
    sleep $((attempt * 15))
  done
  fail 'playwright install failed 3 times; re-run the job later'
}

cmd_test() { (cd "${ROOT}" && npx playwright test); }

cmd_logs() { # <dir>
  local dir="${1:?logs <dir>}" f
  local envs=(--env "${TEMPLATE}")
  for f in "${ENV_FILES[@]}"; do if [[ -f "${STACK}/${f}" ]]; then envs+=(--env "${STACK}/${f}"); fi; done
  [[ "${dir}" == /* ]] || dir="${CALLER_PWD}/${dir}"
  mkdir -p "${dir}"
  compose ps -a > "${dir}/compose-ps.txt" 2>&1 || true
  compose logs --no-color --timestamps 2>&1 | node "${ROOT}/scripts/ci/redact-log.mjs" "${envs[@]}" > "${dir}/compose.log" || true
  if docker container inspect "${AUTH_NAME}" > /dev/null 2>&1; then   # only where auth started it
    docker logs --timestamps "${AUTH_NAME}" 2>&1 | node "${ROOT}/scripts/ci/redact-log.mjs" "${envs[@]}" > "${dir}/auth-stand-in.log" || true
  fi
  for f in "${LOG_DIR}"/deploy-*.log; do
    if [[ -f "${f}" ]]; then node "${ROOT}/scripts/ci/redact-log.mjs" "${envs[@]}" < "${f}" > "${dir}/$(basename "${f}")"; fi
  done
  tail -n 120 "${dir}/compose.log" || true
}

cmd_down() {
  docker rm -f "${AUTH_NAME}" > /dev/null 2>&1 || true   # first: it is attached to the project's network
  compose down -v --remove-orphans --timeout 10 || true
  if ours "${STACK}/stack.env"; then rm -f "${STACK}/stack.env"; fi
  # build-front's 0.4 GB: the compose build context is the repo root and .dockerignore does not exclude
  # .artifacts, so a later local deploy would send it to Docker again (no image copies it: explicit COPY lists).
  rm -rf "${ROOT}/.artifacts/e2e/dist"
}

# One subcommand per line, in the workflow's step order (server/tests/e2eWorkflow.test.js compares them).
cmd_rehearsal() {
  rm -f "${LOG_DIR}"/deploy-*.log "${ROOT}"/.artifacts/ci/stack/logs/*   # a re-run keeps only its own logs
  # set +e: a failing command while the logs are collected must not skip down or change the exit code.
  trap 'code=$?; set +e; if [[ ${code} -ne 0 ]]; then cmd_logs "${ROOT}/.artifacts/ci/stack/logs"; fi; cmd_down; exit ${code}' EXIT
  cmd_preflight
  cmd_install_env
  cmd_pull
  cmd_deploy 1
  cmd_mcp_db
  cmd_health
  echo '# Server stack deploy: all passed'
}

cmd_e2e() {
  rm -f "${LOG_DIR}"/deploy-*.log "${ROOT}"/.artifacts/e2e/logs/*   # a re-run keeps only its own logs
  trap 'code=$?; set +e; if [[ ${code} -ne 0 ]]; then cmd_logs "${ROOT}/.artifacts/e2e/logs"; fi; cmd_down; exit ${code}' EXIT
  cmd_preflight e2e
  cmd_install_env
  cmd_pull
  cmd_deploy 1
  cmd_auth
  cmd_build_front
  cmd_browser
  cmd_test
  echo '# Learner end-to-end: all passed'
}

case "${1:-}" in
  preflight) cmd_preflight "${2:-}" ;;
  install-env) cmd_install_env ;;
  pull) cmd_pull ;;
  deploy) cmd_deploy "${2:?deploy <n>}" ;;
  mcp-db) cmd_mcp_db ;;
  health) cmd_health ;;
  auth) cmd_auth ;;
  build-front) cmd_build_front ;;
  browser) cmd_browser ;;
  test) cmd_test ;;
  logs) cmd_logs "${2:-}" ;;
  down) cmd_down ;;
  rehearsal) cmd_rehearsal ;;
  e2e) cmd_e2e ;;
  *) echo "Usage: bash scripts/ci/stack.sh preflight [e2e]|install-env|pull|deploy <n>|mcp-db|health|auth|build-front|browser|test|logs <dir>|down|rehearsal|e2e"; exit 2 ;;
esac
