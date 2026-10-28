#!/usr/bin/env bash
# Job "Database checks" (.github/workflows/e2e.yml) and `npm run ci:db` (Phase 7,
# doc/brushup-2026/ai-access-plan.ja.md). A throwaway container of the VM's db image, started as
# the VM starts it (log_error_verbosity=terse, deploy/risepath-vm/docker-compose.yml) plus the logging
# collector that R11 of verify-account-deletion.mjs reads through pg_current_logfile():
#   1. verify-account-deletion.mjs, verify-phase5.mjs, verify-phase6.mjs (018, 019, 020: the order of
#      server/migrations/README.md), each on its own empty database, never with --allow-skip (a skipped
#      check is not a pass). They refuse while the role risepath_mcp_remote exists: before the role SQL;
#   2. scripts/db-migrate.mjs twice on a fourth database, its status, pgvector and vector(768);
#   3. deploy/risepath-vm/sql/mcp_remote_role.sql: refused without a password of 24 or more characters,
#      then twice with one, and what the role can log in to and read.
# Time limits: each verify script 180 s (they take about 20 s), the 00:00 JST guard 185 s, the pulls
# 240 s in all, the first boot 120 s. The workflow step allows 20 min: all of them together plus a minute
# for the rest (server/tests/ciScripts.test.js), so a hang ends with this script's message.
# Needs Docker, psql 16+, timeout (coreutils) and node_modules (npm ci). Dummy values only. Removes only
# the container it created (RISEPATH_CI_KEEP=1 keeps it). Outputs: $RISEPATH_CI_OUT (default .artifacts/ci/db).
# Without Docker: --existing-url postgresql://user[:password]@host:port (exactly these two arguments): the
# superuser of an empty cluster on this machine, no database name, the user named, started with
# -c log_error_verbosity=terse -c logging_collector=on; one loopback host, no ?params.
# The workflow never passes it. Pulls fall back to mirror.gcr.io (same digest) when Docker Hub refuses.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

# Every early stop: the message, and on GitHub Actions an annotation, so the check's summary on the pull
# request names the cause (not only "Process completed with exit code 1"). bad() below does the same.
die() { # <exit code> <message>
  echo "❌ $2"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::error title=Database checks::$2"; fi
  exit "$1"
}

# The VM's db image, tag and digest (deploy/risepath-vm/docker-compose.yml, service db).
# server/tests/ciScripts.test.js keeps the two equal: bump them together.
IMAGE=pgvector/pgvector:0.8.7-pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a
NAME="${RISEPATH_CI_DB_NAME:-risepath-ci-db}"
PORT="${RISEPATH_CI_DB_PORT:-55432}"
OUT="${RISEPATH_CI_OUT:-${ROOT}/.artifacts/ci/db}"
SU_PASSWORD=ci-dummy-postgres-password
ROLE_PASSWORD=ci-dummy-mcp-remote-password-0001   # 33 characters; the role SQL needs 24 or more
VERIFY_TIMEOUT_S=180
WANT_VECTOR="$(sed -E 's#^[^:]+:([0-9.]+)-pg[0-9]+@.*$#\1#' <<< "${IMAGE}")"
EXISTING=''
# Nothing or exactly `--existing-url <url>`: anything else (the `=` form too) is refused before any call,
# never read as "no option" (Docker mode).
USAGE='usage: db-checks.sh [--existing-url postgresql://user[:password]@host:port]'
case "$#:${1:-}" in
  0:) ;;
  2:--existing-url) if [[ -z "$2" ]]; then die 2 "${USAGE}"; fi; EXISTING="$2" ;;
  *) die 2 "${USAGE}" ;;
esac
# libpq connects to PGHOSTADDR, or a service file's hostaddr, instead of the URL's host: clear them (both modes).
unset PGHOSTADDR PGSERVICE PGSERVICEFILE
if [[ -n "${EXISTING}" ]]; then   # it creates and drops databases and roles: a throwaway local cluster only
  # The role checks connect as risepath_mcp_remote to the URL's host:port (after its '@').
  if [[ ! "${EXISTING}" =~ ^postgres(ql)?://[^@/]+@ ]]; then die 2 "--existing-url needs the user: postgresql://user[:password]@host:port"; fi
  host="$(sed -E 's#^postgres(ql)?://([^@/]*@)?(\[[^]/]*\]|[^:/?]*).*$#\3#' <<< "${EXISTING}")"
  # libpq tries each host of 'h1:p1,h2:p2' in turn, and ?host= names another one: refuse both.
  if [[ "${EXISTING}" == *[,?]* ]]; then die 2 "--existing-url takes no ?parameters or extra hosts (write a ',' or '?' in the password as %2C or %3F)"; fi
  case "${host}" in 127.0.0.1|localhost|'[::1]') ;; *) die 2 "--existing-url must point at 127.0.0.1, localhost or [::1], not '${host}'" ;; esac
fi
mkdir -p "${OUT}"

FAILED=0
STARTED=0
ok() { echo "ok   $*"; }
bad() {
  echo "FAIL $*"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::error title=Database checks::$*"; fi
  FAILED=1
}
expect_eq() { if [[ "$2" == "$3" ]]; then ok "$1: $2"; else bad "$1: got '$2', want '$3'"; fi; }
sql() { psql "${SU}/$1" -X -At -v ON_ERROR_STOP=1 -c "$2"; }

cleanup() {
  local status=$?
  if [[ "${STARTED}" -eq 1 ]]; then
    if [[ "${status}" -ne 0 || "${FAILED}" -ne 0 ]]; then
      docker exec "${NAME}" sh -c 'cat "$PGDATA"/log/*' > "${OUT}/postgres.log" 2>&1 || true
    fi
    if [[ "${RISEPATH_CI_KEEP:-}" != 1 ]]; then docker rm -f -v "${NAME}" > /dev/null 2>&1 || true; fi
  fi
}
trap cleanup EXIT

command -v psql > /dev/null || die 2 "psql is not on PATH (install the PostgreSQL 16 client)"
psql --version | grep -Eq '\(PostgreSQL\) (1[6-9]|[2-9][0-9])\.' || die 2 "psql 16 or newer expected: $(psql --version)"
# Every pull, the first boot and each verify script run under timeout; stock macOS has none.
command -v timeout > /dev/null || die 2 "timeout is not on PATH (coreutils; on a Mac: brew install coreutils, then put its gnubin folder on PATH)"

if [[ -n "${EXISTING}" ]]; then
  SU="${EXISTING%/}"
  echo "::warning ::--existing-url: not the VM's image; the pgvector version and the wrong-password check are not asserted"
else
  command -v docker > /dev/null || die 2 "docker is not on PATH (without Docker: --existing-url, see the header of this script)"
  if docker container inspect "${NAME}" > /dev/null 2>&1; then
    die 2 "A container named ${NAME} exists. Remove it, or set RISEPATH_CI_DB_NAME."
  fi
  # Docker Hub refuses anonymous pulls past its limit (429) on a shared runner IP. The same digest on
  # mirror.gcr.io (Google's copy of Docker Hub, no login, so fork PRs work) is the same image: Docker
  # verifies the digest. It is run by that name, which works with either image store.
  MIRROR="mirror.gcr.io/${IMAGE%%:*}@${IMAGE##*@}"
  RUN_IMAGE="${IMAGE}"
  # Each pull may take PULL_EACH_S, and all of them with the pauses PULL_BUDGET_S (an uncached pull
  # takes seconds), so a hanging registry ends here with the message below, inside the step's limit.
  PULL_EACH_S=90
  PULL_BUDGET_S=240
  pull_end=$((SECONDS + PULL_BUDGET_S))
  pull() { # <image>
    local left=$((pull_end - SECONDS))
    if [[ "${left}" -le 0 ]]; then return 1; fi
    timeout "$((left < PULL_EACH_S ? left : PULL_EACH_S))" docker pull -q "$1" > /dev/null
  }
  for attempt in 1 2 3; do   # an idempotent download, retried with a warning; never a check
    if pull "${IMAGE}"; then break; fi
    if pull "${MIRROR}"; then
      echo "::warning ::docker pull ${IMAGE%%@*}: Docker Hub failed; using ${MIRROR%%@*} with the same digest"
      RUN_IMAGE="${MIRROR}"
      break
    fi
    pause=$((attempt * 10))
    if [[ "${attempt}" -eq 3 || $((pull_end - SECONDS)) -le "${pause}" ]]; then
      die 1 "docker pull ${IMAGE%%@*} failed on Docker Hub and mirror.gcr.io (attempt ${attempt} of 3, ${PULL_BUDGET_S} s at most); re-run the job later"
    fi
    echo "::warning ::docker pull failed (attempt ${attempt}); trying again in ${pause} s"
    sleep "${pause}"
  done
  echo "==> PostgreSQL 16 from ${RUN_IMAGE%%@*} (log_error_verbosity=terse, logging collector on)"
  # docker run in two steps: once create has made the container, the trap removes it even when start
  # fails (a busy port); a create refused for a name taken since the check above removes nothing.
  docker create --name "${NAME}" -e POSTGRES_PASSWORD="${SU_PASSWORD}" -p "127.0.0.1:${PORT}:5432" \
    "${RUN_IMAGE}" -c log_error_verbosity=terse -c logging_collector=on > /dev/null
  STARTED=1
  docker start "${NAME}" > /dev/null || die 1 "docker start ${NAME} failed (is 127.0.0.1:${PORT} in use? set RISEPATH_CI_DB_PORT)"
  SU="postgresql://postgres:${SU_PASSWORD}@127.0.0.1:${PORT}"
  # First boot runs a socket-only init server, then the real one: wait for a query over TCP (≤ 120 s).
  if ! timeout 120 bash -c "until psql '${SU}/postgres' -X -q -At -c 'SELECT 1' > /dev/null 2>&1; do sleep 1; done"; then
    docker logs "${NAME}" 2>&1 | tail -n 50
    die 1 "PostgreSQL did not accept connections within 120 s"
  fi
fi
HOSTPORT="${SU##*@}"
REMOTE="postgresql://risepath_mcp_remote:${ROLE_PASSWORD}@${HOSTPORT}/risepath"

psql --version
expect_eq "server major" "$(sql postgres 'SHOW server_version_num' | cut -c1-2)" 16
expect_eq "log_error_verbosity (as docker-compose.yml db.command)" "$(sql postgres 'SHOW log_error_verbosity')" terse
expect_eq "logging_collector (R11 reads the server log)" "$(sql postgres 'SHOW logging_collector')" on

# The role SQL sets the role's password, connection limit and timeouts for the whole cluster: an
# existing role (--existing-url on a cluster in use) is refused before anything changes or waits.
if [[ "$(sql postgres "SELECT count(*) FROM pg_roles WHERE rolname = 'risepath_mcp_remote'")" != 0 ]]; then
  die 2 "the role risepath_mcp_remote exists: use an empty cluster (the role SQL would change its password)"
fi

# The verify scripts compare Japan-time days (verify-phase5.mjs P8's today, verify-phase6.mjs todayOf()).
node scripts/ci/jst-midnight-guard.mjs --url "${SU}/postgres" --budget 180

for db in verify_del verify_p5 verify_p6 risepath; do
  if [[ "$(sql postgres "SELECT count(*) FROM pg_database WHERE datname = '${db}'")" != 0 ]]; then
    die 2 "database ${db} exists: use an empty cluster"
  fi
  sql postgres "CREATE DATABASE ${db}" > /dev/null
done

echo "==> verify scripts (each on its own empty database; no --allow-skip)"
run_verify() { # <output name> <script> <database>
  local status=0
  if [[ "$(sql postgres "SELECT count(*) FROM pg_roles WHERE rolname = 'risepath_mcp_remote'")" != 0 ]]; then
    bad "$2: the role risepath_mcp_remote is left over (each script drops it in finally); it would refuse"
    return 0
  fi
  echo "::group::$2"
  timeout "${VERIFY_TIMEOUT_S}" node "$2" --url "${SU}/$3" > "${OUT}/$1.txt" 2>&1 || status=$?
  cat "${OUT}/$1.txt"
  echo '::endgroup::'
  grep -E '^(FAIL|skip|# )' "${OUT}/$1.txt" || true
  if [[ "${status}" -eq 0 ]]; then ok "$2: exit 0"; else bad "$2: exit ${status} (1 a check failed, 2 refused, 3 a check was skipped, 124 timeout after ${VERIFY_TIMEOUT_S} s; see $1.txt)"; fi
}
run_verify verify-account-deletion scripts/db/verify-account-deletion.mjs verify_del
run_verify verify-phase5 scripts/db/verify-phase5.mjs verify_p5
run_verify verify-phase6 scripts/db/verify-phase6.mjs verify_p6

echo "==> scripts/db-migrate.mjs, twice"
FILES="$(ls server/migrations | grep -Eci '^[0-9]+_.+\.sql$')"
export DATABASE_URL_PHASE1="${SU}/risepath"
status=0; node scripts/db-migrate.mjs > "${OUT}/migrate-1.txt" 2>&1 || status=$?
expect_eq "db-migrate run 1 exit" "${status}" 0
expect_eq "run 1 starts from an empty database" "$(head -1 "${OUT}/migrate-1.txt")" "# Rise Path migrations (${FILES} files, 0 applied, ${FILES} pending)"
expect_eq "run 1 applies every file" "$(grep -c '^  applied$' "${OUT}/migrate-1.txt")" "${FILES}"
status=0; node scripts/db-migrate.mjs > "${OUT}/migrate-2.txt" 2>&1 || status=$?
expect_eq "db-migrate run 2 exit" "${status}" 0
expect_eq "run 2 applies nothing" "$(tail -1 "${OUT}/migrate-2.txt")" "Nothing to apply."
expect_eq "status" "$(node scripts/db-migrate.mjs --status | head -1)" "# Rise Path migrations (${FILES} files, ${FILES} applied, 0 pending)"
unset DATABASE_URL_PHASE1
VECTOR="$(sql risepath "SELECT extversion FROM pg_extension WHERE extname = 'vector'")"
if [[ -z "${EXISTING}" ]]; then expect_eq "pgvector (the image's version)" "${VECTOR}" "${WANT_VECTOR}"; else echo "note pgvector ${VECTOR} here (CI asserts ${WANT_VECTOR})"; fi
expect_eq "material_chunks.embedding" "$(sql risepath "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'material_chunks'::regclass AND attname = 'embedding'")" "vector(768)"
expect_eq "HNSW index" "$(sql risepath "SELECT count(*) FROM pg_indexes WHERE indexname = 'material_chunks_embedding_hnsw'")" 1

echo "==> deploy/risepath-vm/sql/mcp_remote_role.sql"
role_sql() { psql "${SU}/risepath" -X -q -v ON_ERROR_STOP=1 "$@" -f deploy/risepath-vm/sql/mcp_remote_role.sql; }
status=0; role_sql > "${OUT}/role-nopw.txt" 2>&1 || status=$?
expect_eq "without a password: refused (psql exit)" "${status}" 3
status=0; role_sql -v mcp_password=short > "${OUT}/role-short.txt" 2>&1 || status=$?
expect_eq "with a short password: refused (psql exit)" "${status}" 3
expect_eq "nothing created" "$(sql postgres "SELECT count(*) FROM pg_roles WHERE rolname = 'risepath_mcp_remote'")" 0
for run in 1 2; do
  status=0; role_sql -v mcp_password="${ROLE_PASSWORD}" > "${OUT}/role-${run}.txt" 2>&1 || status=$?
  expect_eq "run ${run} with a password" "${status}" 0
done
expect_eq "the role logs in with its password" "$(psql "${REMOTE}" -X -At -c 'SELECT current_user')" risepath_mcp_remote
if [[ -z "${EXISTING}" ]]; then
  if psql "postgresql://risepath_mcp_remote:ci-dummy-wrong-password-000000@${HOSTPORT}/risepath" -X -At -c 'SELECT 1' > /dev/null 2>&1; then
    bad "a wrong password logged in"
  else
    ok "a wrong password is refused"
  fi
fi
expect_eq "limits" "$(sql postgres "SELECT rolconnlimit || ' ' || (SELECT string_agg(c, ',' ORDER BY c) FROM unnest(rolconfig) AS c) FROM pg_roles WHERE rolname = 'risepath_mcp_remote'")" \
  "20 idle_in_transaction_session_timeout=30s,statement_timeout=10s"
expect_eq "never granted" "$(psql "${REMOTE}" -X -At -c "SELECT string_agg(t || '=' || has_table_privilege(t, 'SELECT'), ' ' ORDER BY t) FROM unnest(ARRAY['learning_days', 'lesson_progress_lesson_resets', 'lesson_progress_resets', 'review_log', 'xp_awards']) AS t")" \
  "learning_days=false lesson_progress_lesson_resets=false lesson_progress_resets=false review_log=false xp_awards=false"
expect_eq "reads lesson_progress" "$(psql "${REMOTE}" -X -At -c 'SELECT count(*) FROM lesson_progress')" 0
if psql "${REMOTE}" -X -At -c 'SELECT count(*) FROM xp_awards' > /dev/null 2>&1; then bad "the role read xp_awards"; else ok "the role cannot read xp_awards"; fi

if [[ "${FAILED}" -ne 0 ]]; then
  echo "# Database checks: FAILED (outputs in ${OUT})"
  exit 1
fi
echo "# Database checks: all passed"
