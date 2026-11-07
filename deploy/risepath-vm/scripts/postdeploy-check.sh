#!/usr/bin/env bash
# 事後の確かめ (Phase 9; doc/guides/first-launch.ja.md 13 章, codes P0-P16). Checks what a deploy left
# running, at the strength of the CI stack (scripts/ci/stack.sh mcp-db and health), and prints codes, field
# names, counts and Japanese fixes only: never a response body, a log line or a setting's value.
#   ./scripts/postdeploy-check.sh    the owner, any time after a deploy, without sudo (changes nothing)
#   with --from-deploy and the caller's values: deploy-stack.sh, after the stack smoke. Only then, in
#   production mode and with no error, it writes the deploy record .deploy/last-green.json (P13) that the
#   事前チェック reads (A13, F5): a standalone run never records a stack.env that was not deployed. The record
#   holds stack.env's SHA-256 only while it still equals --stack-sha, the hash deploy-stack.sh took before its
#   事前チェック read the file; an edit during the deploy is never recorded as checked (P16).
# The checks that need the stack's network run in the api container (scripts/deploy/postdeploy-probe.mjs,
# loopback there passes the origin gate); this script only collects the host facts the container cannot
# see. Flags, each at most once: --from-deploy --caller-skip-pull <v> --caller-project <v> --stack-sha <v>
# --profiles <v>.
# Exit: 0 no error (warnings allowed), 1 errors, 2 could not check (P0).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${STACK_DIR}/../.." && pwd)"
RECORD_DIR="${STACK_DIR}/.deploy"

say_code() { # <mark> <code> <title> <fix>: the three lines postdeploy-probe.mjs prints for a code
  echo "$1 [$2] $3"
  echo "   直し方: $4"
  echo "   くわしく: 手順書 13 章の「$2」"
}
cannot_check() {
  say_code '❌' P0 '事後の確かめを実行できません（sudo で実行したか、指定が読めないか、api のコンテナに入れません）。' '`sudo` も何も付けずに `./scripts/postdeploy-check.sh` を実行します。また出るときは、`docker compose --env-file stack.env ps` で出た行をエージェントに見せます。'
  exit 2
}

# Root would leave a root-owned deploy record that the deploy user's 事前チェック cannot read (A15).
if [[ "$(id -u)" -eq 0 ]]; then cannot_check; fi

FROM_DEPLOY=0
CALLER_SKIP_PULL=''
CALLER_PROJECT=''
GIVEN_STACK_SHA=''
PROFILES_GIVEN=0
PROFILES=''
SEEN=' '
while [[ $# -gt 0 ]]; do
  flag="$1"
  case "${flag}" in
    --from-deploy | --caller-skip-pull | --caller-project | --stack-sha | --profiles) ;;
    *) cannot_check ;;
  esac
  if [[ "${SEEN}" == *" ${flag} "* ]]; then cannot_check; fi
  SEEN+="${flag} "
  if [[ "${flag}" == --from-deploy ]]; then
    FROM_DEPLOY=1
    shift
    continue
  fi
  if [[ $# -lt 2 ]]; then cannot_check; fi
  case "${flag}" in
    --caller-skip-pull) CALLER_SKIP_PULL="$2" ;;
    --caller-project) CALLER_PROJECT="$2" ;;
    --stack-sha) GIVEN_STACK_SHA="$2" ;;
    --profiles) PROFILES="$2"; PROFILES_GIVEN=1 ;;
  esac
  shift 2
done

cd "${STACK_DIR}"
[[ -f stack.env ]] || cannot_check

# shellcheck source=check-mode.sh
source "${SCRIPT_DIR}/check-mode.sh"
MODE="$(risepath_check_mode "${FROM_DEPLOY}" "${CALLER_SKIP_PULL}" "${CALLER_PROJECT}" "${STACK_DIR}")"

compose() {
  docker compose --env-file stack.env -f docker-compose.yml "$@"
}

# The active profiles: the deploy passes the list it gave Compose. Alone, the way the deploy reads them:
# stack.env's last COMPOSE_PROFILES line when it has one (even empty), else this shell's. Only the profile
# names travel (no other stack.env line is read, and stack.env is never sourced here). The line is read as
# bash reads it (export, one pair of quotes, then white space and a # comment); a line or a value this
# cannot read is sent as `unreadable`, which the probe reports (P15) instead of skipping P4 and P5.
if [[ "${PROFILES_GIVEN}" -eq 0 ]]; then
  PROFILES_LINE='^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES='
  if grep -Eq "${PROFILES_LINE}" stack.env; then
    PROFILES="$(grep -E "${PROFILES_LINE}" stack.env | tail -n 1 \
      | sed -nE "s/${PROFILES_LINE}(\"([a-z0-9_, .-]*)\"|'([a-z0-9_, .-]*)'|([a-z0-9_,.-]*))([[:space:]]+#.*)?[[:space:]]*$/=\\3\\4\\5/p")"
    if [[ "${PROFILES}" == =* ]]; then PROFILES="${PROFILES#=}"; else PROFILES=unreadable; fi
  else
    PROFILES="${COMPOSE_PROFILES:-}"
  fi
fi
PROFILES="${PROFILES// /}"
if [[ ! "${PROFILES}" =~ ^[a-z0-9_,.-]{0,256}$ ]]; then PROFILES=unreadable; fi

digits() { # a whole number, or 0
  if [[ "$1" =~ ^[0-9]{1,15}$ ]]; then printf '%s' "$1"; else printf '0'; fi
}
word() { # <pattern> <text>: the text when it matches, else nothing
  if [[ "$2" =~ $1 ]]; then printf '%s' "$2"; fi
}

# --- Host facts (no value from an env file, no log line: a health word, a unit state, a count) ----------
CLOUDFLARED=''
if [[ "${MODE}" == prod && ",${PROFILES}," == *",tunnel,"* ]]; then
  CLOUDFLARED="$(word '^[a-z]{0,16}$' "$(compose ps --format '{{.Health}}' cloudflared 2> /dev/null | head -n 1 || true)")"
fi
UNIT_STACK="$(word '^[a-z-]{1,32}$' "$(systemctl is-enabled risepath-stack.service 2> /dev/null | head -n 1 || true)")"
RETENTION_LINES="$(digits "$(compose logs --no-log-prefix api 2> /dev/null | grep -cF '[Retention] on, hourly' || true)")"
FACTS="$(printf '{"profiles":"%s","cloudflared":"%s","unitStack":"%s","retentionLines":%s}' \
  "${PROFILES}" "${CLOUDFLARED}" "${UNIT_STACK:-not-found}" "${RETENTION_LINES}")"

# --- The checks, inside the api container (exit 0 ok, 10 errors, 11 could not check) ------------------
status=0
printf '%s' "${FACTS}" | compose exec -T api node scripts/deploy/postdeploy-probe.mjs --mode "${MODE}" || status=$?
case "${status}" in
  0) ;;
  10) exit 1 ;;
  11) exit 2 ;;
  *) cannot_check ;;
esac

# --- P13: the deploy record, after a production deploy with no error (written as the deploy user) ------
if [[ "${MODE}" == prod && "${FROM_DEPLOY}" == 1 ]]; then
  COMMIT="$(word '^[0-9a-f]{40}$' "$(git -C "${REPO_ROOT}" rev-parse HEAD 2> /dev/null || true)")"
  if command -v sha256sum > /dev/null 2>&1; then
    STACK_SHA="$(sha256sum stack.env | awk '{print $1}')"
  else
    STACK_SHA="$(shasum -a 256 stack.env | awk '{print $1}')"
  fi
  STACK_SHA="$(word '^[0-9a-f]{64}$' "${STACK_SHA}")"
  # P16: only the stack.env the 事前チェック read (deploy-stack.sh hashed it just before): an edit made during
  # the deploy (another SSH session) would otherwise be recorded as checked, and F5 would stay quiet.
  if [[ -z "${STACK_SHA}" || "${STACK_SHA}" != "${GIVEN_STACK_SHA}" ]]; then
    say_code '❌' P16 'デプロイの途中で stack.env が変わったので、通ったデプロイを記録しませんでした。' '`./scripts/deploy-stack.sh` をもう一度実行します（終わるまで、stack.env は変えません）。'
    exit 1
  fi
  mkdir -p "${RECORD_DIR}"
  chmod 755 "${RECORD_DIR}"
  printf '{"at":"%s","commit":"%s","stackEnvSha256":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${COMMIT}" "${STACK_SHA}" \
    > "${RECORD_DIR}/last-green.json.tmp"
  chmod 644 "${RECORD_DIR}/last-green.json.tmp"
  mv -f "${RECORD_DIR}/last-green.json.tmp" "${RECORD_DIR}/last-green.json"
  say_code 'ℹ️' P13 '通ったデプロイを記録しました（.deploy/last-green.json）。' '何もしません（次の事前チェックが、この記録を読みます）。'
fi
exit 0
