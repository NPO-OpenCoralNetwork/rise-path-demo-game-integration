#!/usr/bin/env bash
# 事前チェック (Phase 9, owner decision D2; doc/guides/first-launch.ja.md 13 章). Reads the env files in this
# folder and a few host facts, and prints names and Japanese fixes only, never a value. The rules
# (scripts/deploy/preflight-rules.mjs) run in the api's base image (node:22-slim, deploy/risepath-vm/Dockerfile)
# with no network, a read-only file system, every capability dropped and the caller's uid: the VM host
# has no node. It changes nothing.
#   ./scripts/preflight.sh    the owner, any time, without sudo (production rules, the recorded stage)
#   with --from-deploy and the caller's values: deploy-stack.sh, before it sources stack.env and before
#   the pull (a moved HEAD re-runs the pulled deploy-stack.sh, which runs the pulled check first)
# Flags, each at most once: --from-deploy --caller-skip-pull <v> --caller-project <v> --caller-profiles <v>
#   --caller-exports <names separated by spaces>
# Exit: 0 no error (warnings allowed), 1 errors, 2 could not check (X1-X5, or docker run failed), 3 an
# internal error (X0).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${STACK_DIR}/../.." && pwd)"
# What the backup scripts leave (owner decision D4): only whether files exist, and fixed patterns.
BACKUP_ETC=/etc/risepath-backup
BACKUP_STATUS=/var/lib/risepath-backup/status.json

say_code() { # <code> <title> <fix>: the three lines preflight-vm.mjs prints for a code
  echo "❌ [$1] $2"
  echo "   直し方: $3"
  echo "   くわしく: 手順書 13 章の「$1」"
}

# Root with every capability dropped cannot open the 0600 env files the deploy user owns, and a root
# deploy would leave root-owned files in the checkout. Refused before any docker call.
if [[ "$(id -u)" -eq 0 ]]; then
  say_code X5 '事前チェックは sudo なしで実行します（root では設定のファイルを読めず、リポジトリのファイルの持ち主も変わります）' '`sudo` を付けずに、もう一度実行します。'
  exit 2
fi

bad_args() {
  say_code X4 '事前チェックへの指定が読めません（引数か、VM の情報）' '`./scripts/preflight.sh` を、何も付けずに実行します。直らないときは、エージェントに相談します。'
  exit 2
}

FROM_DEPLOY=0
CALLER_SKIP_PULL=''
CALLER_PROJECT=''
CALLER_PROFILES="${COMPOSE_PROFILES:-}"
CALLER_EXPORTS="$(compgen -e | tr '\n' ' ')"
SEEN=' '
while [[ $# -gt 0 ]]; do
  flag="$1"
  case "${flag}" in
    --from-deploy | --caller-skip-pull | --caller-project | --caller-profiles | --caller-exports) ;;
    *) bad_args ;;
  esac
  if [[ "${SEEN}" == *" ${flag} "* ]]; then bad_args; fi
  SEEN+="${flag} "
  if [[ "${flag}" == --from-deploy ]]; then
    FROM_DEPLOY=1
    shift
    continue
  fi
  if [[ $# -lt 2 ]]; then bad_args; fi
  case "${flag}" in
    --caller-skip-pull) CALLER_SKIP_PULL="$2" ;;
    --caller-project) CALLER_PROJECT="$2" ;;
    --caller-profiles) CALLER_PROFILES="$2" ;;
    --caller-exports) CALLER_EXPORTS="$2" ;;
  esac
  shift 2
done

# shellcheck source=check-mode.sh
source "${SCRIPT_DIR}/check-mode.sh"
MODE="$(risepath_check_mode "${FROM_DEPLOY}" "${CALLER_SKIP_PULL}" "${CALLER_PROJECT}" "${STACK_DIR}")"
PROJECT=risepath
if [[ "${MODE}" == ci ]]; then PROJECT=risepath-ci; fi
# In production the host facts below describe project risepath, and Compose would use the caller's project:
# a caller project counts as an exported COMPOSE_PROJECT_NAME (F12), also when only --caller-project names it.
if [[ "${MODE}" == prod && -n "${CALLER_PROJECT}" && " ${CALLER_EXPORTS} " != *" COMPOSE_PROJECT_NAME "* ]]; then
  CALLER_EXPORTS+=" COMPOSE_PROJECT_NAME"
fi

# The api's base image, from the one line that names it (as scripts/ci/stack.sh auth does). A missing or
# unreadable Dockerfile is X1 too: the line cannot fail under set -e before the X1 branch.
IMAGE="$(sed -nE 's/^FROM ([^ ]+) AS api$/\1/p' "${STACK_DIR}/Dockerfile" 2> /dev/null | head -n 1 || true)"
if [[ -z "${IMAGE}" ]]; then
  say_code X1 '事前チェックを実行できません（Dockerfile に api の行がありません）' '`git -C /opt/risepath status` を見て、エージェントに相談します。'
  exit 2
fi
no_image() {
  say_code X2 '事前チェックを実行できません（Docker で node のイメージを動かせません）' 'VM に入り直して（SSH し直して）から、もう一度実行します。直らないときは、`docker info` で出た行をエージェントに見せます。'
  exit 2
}
docker image inspect "${IMAGE}" > /dev/null 2>&1 || docker pull -q "${IMAGE}" > /dev/null 2>&1 || no_image

# --- Host facts (the container cannot see the host). No env file value travels in them. ---------------
SAFE_RE='^[A-Za-z0-9._:+/ ,_-]*$'
# The caller's COMPOSE_PROFILES when it matches SAFE_RE (no quote, no backslash). Any other value is sent
# as `unreadable`, a name no profile has: the engine then answers F1 (an error) whenever the deploy would
# pass the caller's list to Compose, instead of seeing no profile and skipping S2, B5 and the rest.
caller_profiles_fact() {
  if [[ "${CALLER_PROFILES}" =~ ${SAFE_RE} ]]; then printf '%s' "${CALLER_PROFILES}"; else printf 'unreadable'; fi
}
json_list() { # <pattern> <word>...: a JSON array of the words that match the pattern
  local re="$1" out='' word
  shift
  for word in "$@"; do
    if [[ "${word}" =~ ${re} ]]; then out+="${out:+,}\"${word}\""; fi
  done
  printf '[%s]' "${out}"
}
digits() { # a whole number, or 0
  if [[ "$1" =~ ^[0-9]{1,15}$ ]]; then printf '%s' "$1"; else printf '0'; fi
}
unit_state() { # systemctl is-enabled's word, or not-found
  local state
  state="$(systemctl is-enabled "$1" 2> /dev/null | head -n 1 || true)"
  if [[ "${state}" =~ ^[a-z-]{1,32}$ ]]; then printf '%s' "${state}"; else printf 'not-found'; fi
}
status_field() { # <key> <value pattern>: a quoted field of the backup status file, or empty
  if [[ -r "${BACKUP_STATUS}" ]]; then
    sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"($2)\".*/\\1/p" "${BACKUP_STATUS}" | head -n 1
  fi
}
yes_no() { if "$@"; then printf 'true'; else printf 'false'; fi; }

collect_facts() {
  local root disk services=() service exports=() iso alert
  root="$(docker info --format '{{.DockerRootDir}}' 2> /dev/null || true)"
  disk="$({ df -Pk "${root:-/}" 2> /dev/null || df -Pk / 2> /dev/null; } | awk 'NR==2 {print $4}' || true)"
  while IFS= read -r service; do
    services+=("${service}")
  done < <(docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Label "com.docker.compose.service"}}' 2> /dev/null || true)
  iso='[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z'
  alert=''
  if [[ -r "${BACKUP_STATUS}" ]]; then
    alert="$(sed -nE 's/.*"alert"[[:space:]]*:[[:space:]]*(true|false).*/\1/p' "${BACKUP_STATUS}" | head -n 1)"
  fi
  read -r -a exports <<< "${CALLER_EXPORTS}"   # names separated by spaces; no glob expansion
  printf '{"uid":%s,"gid":%s,"diskFreeKb":%s,"unitStack":"%s","unitBackupTimer":"%s","pgdataVolume":%s,"runningServices":%s,"callerProfiles":"%s","callerExports":%s,"backupKey":%s,"backupEnv":%s,"backupLastOk":"%s","backupLastFail":"%s","drillLastOk":"%s","backupKeyId":"%s","backupAlert":"%s","from":"%s"}' \
    "$(digits "$(id -u)")" "$(digits "$(id -g)")" "$(digits "${disk}")" \
    "$(unit_state risepath-stack.service)" "$(unit_state risepath-backup.timer)" \
    "$(yes_no test -n "$(docker volume ls -q --filter "label=com.docker.compose.project=${PROJECT}" --filter label=com.docker.compose.volume=pgdata 2> /dev/null || true)")" \
    "$(json_list '^[a-z0-9][a-z0-9_.-]{0,63}$' ${services[@]+"${services[@]}"})" \
    "$(caller_profiles_fact)" \
    "$(json_list '^[A-Za-z_][A-Za-z0-9_]{0,127}$' ${exports[@]+"${exports[@]}"})" \
    "$(yes_no test -f "${BACKUP_ETC}/backup.key")" "$(yes_no test -f "${BACKUP_ETC}/backup.env")" \
    "$(status_field lastOk "${iso}")" "$(status_field lastFail "${iso}")" "$(status_field lastDrillOk "${iso}")" \
    "$(status_field keyId '[0-9a-f]{16}')" "${alert}" \
    "$(if [[ "${FROM_DEPLOY}" == 1 ]]; then printf deploy; else printf standalone; fi)"
}
FACTS="$(collect_facts)"

# --- The check: offline, read-only, the caller's uid; only this folder and scripts/deploy mounted. -------
# --mount (not -v): a missing source is an error, never an empty folder created on the host.
status=0
printf '%s' "${FACTS}" | docker run --rm -i --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 256m --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=${STACK_DIR},dst=/stack,readonly" \
  --mount "type=bind,src=${REPO_ROOT}/scripts/deploy,dst=/preflight,readonly" \
  "${IMAGE}" node /preflight/preflight-vm.mjs --stack /stack --mode "${MODE}" || status=$?
case "${status}" in
  0 | 1 | 2 | 3) exit "${status}" ;;
  *) no_image ;;
esac
