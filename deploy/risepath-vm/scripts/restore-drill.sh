#!/usr/bin/env bash
# 控えから戻す練習（毎月） (Phase 9, owner decision D4; design §5.4, §5.7; doc/guides/first-launch.ja.md 6.5, 16.1,
# 13 章 DR0-DR7). The owner runs it on the VM with sudo, from /opt/risepath/deploy/risepath-vm:
#   sudo ./scripts/restore-drill.sh                     the newest complete set in the bucket (a manifest, and the two
#                                                       files with its sizes), which must be at most 36 hours old
#   sudo ./scripts/restore-drill.sh --date YYYY-MM-DD   the newest complete set of that Japan day (any age)
#   sudo ./scripts/restore-drill.sh --local <dir>       a set already on this machine (the CI-stack rehearsal)
# It checks the manifest first (its fixed forms, its key id, the disk), then downloads the set, checks it against the
# manifest and the manifest against its sealed copy (only the key makes that copy), restores it into a throwaway
# database (a container with no network, its own random password), checks the database against the manifest (UTF8,
# every migration, each table's row count, by name, within the before/after band ± max(5, 1 %), the uploads file count) and always
# removes the container (only ours: its label) and what it downloaded. It never touches the running stack. Only a
# default run whose arguments were read records the result in /var/lib/risepath-backup/status.json (lastDrillOk, read
# by the 事前チェック R3); --date and --local runs print it and record nothing. Times shown are Japan time.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${STACK_DIR}/../.." && pwd)"
# shellcheck source=backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

DRILL_DB=risepath-drill-db
OK=0
STEP=DR0
DAY=''
LOCAL_DIR=''
WORK=''
STARTED_DB=0
RECORD=0
exec 0< /dev/null

# drill_ours: a container named risepath-drill-db exists and carries the drill's label. Only such a container is
# ever removed: a `docker run` that failed because another container has the name leaves that one alone.
drill_ours() { [[ "$(docker inspect --format '{{index .Config.Labels "risepath.drill"}}' "${DRILL_DB}" 2> /dev/null || true)" == 1 ]]; }

on_exit() {
  local rc=$?
  set +e
  if [[ "${OK}" != 1 ]]; then
    if [[ "${BK_SAID}" != "${STEP}" ]]; then bk_say "${STEP}" '途中で止まりました（思いがけないエラーです）。'; fi
    if [[ "${RECORD}" == 1 ]]; then bk_status_set lastDrillFail "$(bk_now)" lastDrillStep "${STEP}"; fi
    if [[ "${rc}" == 0 ]]; then rc=1; fi
  fi
  # DR7, always: the throwaway database and what this run downloaded (never a --local folder).
  local cleaned=1
  if [[ "${STARTED_DB}" == 1 ]] && drill_ours && ! docker rm -f -v "${DRILL_DB}" > /dev/null 2>&1; then cleaned=0; fi
  if [[ -n "${WORK}" && -d "${WORK}" ]] && ! rm -rf "${WORK}"; then cleaned=0; fi
  if [[ "${cleaned}" == 0 ]]; then bk_say DR7; fi
  bk_cleanup_tmp
  return "${rc}"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date) [[ -z "${DAY}" && $# -ge 2 && "$2" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || bk_fail DR0 '--date のあとに日付（日本時間の日。2026-11-02 の形）を 1 つ書きます。'; DAY="$2"; shift 2 ;;
    --local) [[ -z "${LOCAL_DIR}" && $# -ge 2 && -d "$2" ]] || bk_fail DR0 '--local のあとに、控えのフォルダ（4 つのファイルがあるところ）を書きます。'; LOCAL_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    *) bk_fail DR0 '知らない指定です（--date か --local だけです）。' ;;
  esac
done
[[ -z "${DAY}" || -z "${LOCAL_DIR}" ]] || bk_fail DR0 '--date と --local は、どちらか 1 つだけです。'

[[ "$(id -u)" == 0 ]] || bk_fail DR0 'sudo を付けて実行します（鍵は root だけが読めます）。'
# From here a default run records its result (a run whose arguments could not be read records nothing).
if [[ -z "${DAY}" && -z "${LOCAL_DIR}" ]]; then RECORD=1; fi
[[ -f "${BK_KEY}" ]] || bk_fail DR0 'この VM に鍵（/etc/risepath-backup/backup.key）がありません（手順書 6.4、16.3）。'
IMAGE="$(bk_node_image)"
DB_IMAGE="$(bk_db_image)"
[[ -n "${IMAGE}" && -n "${DB_IMAGE}" ]] || bk_fail DR0 'Dockerfile か docker-compose.yml から、イメージの名前を読めません。'
docker info > /dev/null 2>&1 || bk_fail DR0 'Docker が答えません。'
KEY_ID="$(bk_key_id)"
[[ -n "${KEY_ID}" ]] || bk_fail DR0 '鍵を読めません（鍵の形がちがうか、Docker で node のイメージを動かせません）。'
bk_tmp
mkdir -p "${BK_LOCAL}"
chmod 700 "${BK_LOCAL}"

# DR1: the set's manifest only (the two large files come after the checks below).
STEP=DR1
if [[ -n "${LOCAL_DIR}" ]]; then
  SET_DIR="${LOCAL_DIR}"
  for f in manifest.json manifest.json.rpbk db.dump.rpbk uploads.tar.rpbk; do
    [[ -f "${SET_DIR}/${f}" ]] || bk_fail DR1 "${f} がフォルダにありません。"
  done
else
  BUCKET="$(bk_bucket)"
  [[ -n "${BUCKET}" ]] || bk_fail DR0 'backup.env にバケットの名前（BACKUP_BUCKET）がないか、形がちがいます（手順書 6.4）。'
  WORK="${BK_LOCAL}/drill-$(bk_stamp)"
  mkdir -m 700 "${WORK}"
  SET_DIR="${WORK}"
  bk_gcs_token || bk_fail DR1 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  rc=0
  STAMP="$(bk_pick_set "${BUCKET}" "${SET_DIR}" "${DAY}")" || rc=$?
  if [[ "${rc}" == 2 ]]; then bk_fail DR1 'バケットの一覧か、控えのファイルを読めません（サービスアカウントの役割）。'; fi
  if [[ "${rc}" != 0 ]]; then bk_fail DR1 "${DAY:+日本時間 ${DAY} の}そろった控え（manifest.json と 3 つのファイル）がバケットにありません。"; fi
fi
# Every field in its fixed form before any is used (a number in arithmetic, a time, a key id; review round 1).
bk_check_manifest "${SET_DIR}/manifest.json" && bk_check_counts "${SET_DIR}/manifest.json" \
  || bk_fail DR1 '目録（manifest.json）が読めないか、形がちがいます。'
CREATED="$(bk_manifest_field "${SET_DIR}/manifest.json" createdAt)"
if [[ -z "${DAY}" && -z "${LOCAL_DIR}" ]] && (($(bk_age_s "${CREATED}") > 36 * 3600)); then
  bk_fail DR1 "いちばん新しい控え（$(bk_jst "${CREATED}")）が 36 時間より前です。毎日の控えが止まっています。"
fi
SET_KEY="$(bk_manifest_field "${SET_DIR}/manifest.json" keyId)"
[[ "${SET_KEY}" == "${KEY_ID}" ]] || bk_fail DR4 "この控えは、ちがう鍵で作られています（控えの key id: ${SET_KEY}、この VM の鍵の key id: ${KEY_ID}）。"

# DR0: room for the download and for the throwaway database (up to ten times the compressed dump, and 2 GiB),
# before anything large is downloaded or restored.
STEP=DR0
dump_b="$(bk_manifest_field "${SET_DIR}/manifest.json" dbDumpBytes)"
up_b="$(bk_manifest_field "${SET_DIR}/manifest.json" uploadsBytes)"
down_kb=0
if [[ -z "${LOCAL_DIR}" ]]; then down_kb=$(((dump_b + up_b) / 1024 + 1)); fi
db_kb=$((10 * dump_b / 1024 + 2097152))
free_kb="$(df -Pk "${BK_LOCAL}" 2> /dev/null | awk 'NR==2 {print $4}')"
docker_root="$(docker info --format '{{.DockerRootDir}}' 2> /dev/null || true)"
[[ "${free_kb}" =~ ^[0-9]+$ ]] || bk_fail DR0 'ディスクの空きを読めません。'
if [[ -d "${docker_root}" && "$(stat -c %d "${docker_root}" 2> /dev/null)" != "$(stat -c %d "${BK_LOCAL}" 2> /dev/null)" ]]; then
  docker_kb="$(df -Pk "${docker_root}" 2> /dev/null | awk 'NR==2 {print $4}')"
  [[ "${docker_kb}" =~ ^[0-9]+$ ]] && ((free_kb >= down_kb && docker_kb >= db_kb)) \
    || bk_fail DR0 "ディスクの空きが足りません（読み出す控えに $((down_kb / 1048576 + 1)) GB ほど、練習用の DB に $((db_kb / 1048576 + 1)) GB ほど要ります）。"
else
  ((free_kb >= down_kb + db_kb)) \
    || bk_fail DR0 "ディスクの空きが足りません（読み出す控えと練習用の DB に、$(((down_kb + db_kb) / 1048576 + 1)) GB ほど要ります）。"
fi

if [[ -z "${LOCAL_DIR}" ]]; then
  STEP=DR1
  bk_gcs_token || bk_fail DR1 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  bk_fetch_set "${BUCKET}" "${STAMP}" "${SET_DIR}" || bk_fail DR1 'バケットの一覧か、控えのファイルを読めません（サービスアカウントの役割）。'
fi

STEP=DR2
bk_verify_set "${SET_DIR}" || bk_fail DR2 '控えのファイルが、目録の SHA-256 か大きさと合いません。'
bk_verify_seal "${SET_DIR}" || bk_fail DR2 '目録（manifest.json）が、鍵で暗号化した写し（manifest.json.rpbk）と合いません（書きかえられたか、壊れています）。'

STEP=DR3
# A container of that name from an earlier drill that could not clean up: only ours (the label) is removed.
if drill_ours; then
  docker rm -f -v "${DRILL_DB}" > /dev/null 2>&1 || true
fi
# The password: random, passed by name from this environment (never on the command line), never printed.
POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export POSTGRES_PASSWORD
STARTED_DB=1
docker run -d --name "${DRILL_DB}" --label risepath.drill=1 --network none \
  -e POSTGRES_USER=risepath_app -e POSTGRES_DB=risepath -e POSTGRES_PASSWORD "${DB_IMAGE}" > /dev/null \
  || bk_fail DR3 '練習用の DB のコンテナを作れません（同じ名前のコンテナがあるときは、`sudo docker ps -a` で見ます）。'
unset POSTGRES_PASSWORD
ready=0
for _ in $(seq 1 60); do
  if docker exec "${DRILL_DB}" pg_isready -h 127.0.0.1 -U risepath_app -d risepath > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "${ready}" == 1 ]] || bk_fail DR3 '練習用の DB が 60 秒たっても答えません。'

STEP=DR4
# --no-owner: the throwaway database has only its own user (the VM's POSTGRES_USER may have another name).
set +e
bk_crypt decrypt < "${SET_DIR}/db.dump.rpbk" \
  | docker exec -i "${DRILL_DB}" pg_restore -U risepath_app -d risepath --exit-on-error --single-transaction --no-privileges --no-owner
st=("${PIPESTATUS[@]}")
set -e
[[ "${st[0]}" == 0 ]] || bk_fail DR4 "控えを読めません（復号が ${st[0]} で終わりました: 鍵がちがうか、控えが壊れています）。"
[[ "${st[1]}" == 0 ]] || bk_fail DR4 "pg_restore が ${st[1]} で終わりました。"

STEP=DR5
drill_sql() { docker exec -i "${DRILL_DB}" psql -X -q -v ON_ERROR_STOP=1 -U risepath_app -d risepath -tA -F, 2> /dev/null; }
encoding="$(printf 'SHOW server_encoding;\n' | drill_sql)" || bk_fail DR5 '戻した DB に答えがありません。'
[[ "${encoding}" == UTF8 ]] || bk_fail DR5 "文字コードが UTF8 ではありません。"
applied="$(printf 'SELECT version FROM schema_migrations ORDER BY version;\n' | drill_sql)" || bk_fail DR5 'migration の一覧を読めません。'
while IFS= read -r migration; do
  [[ -n "${migration}" ]] || continue
  grep -qxF "${migration}" <<< "${applied}" || bk_fail DR5 "migration ${migration} がありません。"
done < <(bk_manifest_list "${SET_DIR}/manifest.json" migrations)
# The tables of this set (its manifest's own list) that are still in BK_TABLES, by name: a set made before a table
# was added to BK_TABLES has no count for it, and its dump has no such table (review round 3, finding 5). The names in
# the SQL come from BK_TABLES (this checkout), never from the manifest.
declare -A in_set=()
while IFS= read -r table; do in_set["${table}"]=1; done < <(bk_manifest_tables "${SET_DIR}/manifest.json" || true)
compare=()
for table in "${BK_TABLES[@]}"; do
  if [[ -n "${in_set["${table}"]:-}" ]]; then compare+=("${table}"); fi
done
[[ ${#compare[@]} -gt 0 ]] || bk_fail DR5 '目録の表の一覧に、くらべられる表がありません。'
sql='SELECT '
sep=''
for table in "${compare[@]}"; do
  sql+="${sep}(SELECT count(*) FROM ${table})"
  sep=', '
done
counts="$(printf '%s;\n' "${sql}" | drill_sql)" || bk_fail DR5 '行の数を数えられません。'
[[ "${counts}" =~ ^[0-9,]+$ ]] || bk_fail DR5 '行の数を数えられません。'
IFS=',' read -r -a now_counts <<< "${counts}"
[[ ${#now_counts[@]} == "${#compare[@]}" ]] || bk_fail DR5 '行の数を数えられません。'
for i in "${!compare[@]}"; do
  [[ "${now_counts[i]}" =~ ${BK_COUNT_RE} ]] || bk_fail DR5 '行の数を数えられません。'
  # Only checked whole numbers reach the arithmetic (bk_manifest_count; bk_check_counts checked both lists at DR1).
  b="$(bk_manifest_count "${SET_DIR}/manifest.json" countsBefore "${compare[i]}")"
  a="$(bk_manifest_count "${SET_DIR}/manifest.json" countsAfter "${compare[i]}")"
  [[ "${b}" =~ ${BK_COUNT_RE} && "${a}" =~ ${BK_COUNT_RE} ]] || bk_fail DR5 '目録の行の数が読めません。'
  lo=$((b < a ? b : a))
  hi=$((b > a ? b : a))
  tolerance=$(((hi + 99) / 100))
  if ((tolerance < 5)); then tolerance=5; fi
  if ((now_counts[i] < lo - tolerance || now_counts[i] > hi + tolerance)); then
    bk_fail DR5 "表 ${compare[i]} の行の数が、目録の数とちがいます。"
  fi
done

STEP=DR6
set +e
bk_crypt decrypt < "${SET_DIR}/uploads.tar.rpbk" \
  | docker run --rm -i --log-driver none --network none --read-only --cap-drop ALL --security-opt no-new-privileges "${IMAGE}" tar -tf - > "${BK_TMP}/uploads.list"
st=("${PIPESTATUS[@]}")
set -e
[[ "${st[0]}" == 0 && "${st[1]}" == 0 ]] || bk_fail DR6 "復号（${st[0]}）か tar（${st[1]}）が 0 で終わりませんでした。"
files="$(sed '/^$/d' "${BK_TMP}/uploads.list" | bk_tar_count)"
[[ "${files}" == "$(bk_manifest_field "${SET_DIR}/manifest.json" uploadsFileCount)" ]] || bk_fail DR6 "ファイルの数（${files}）が目録とちがいます。"

STEP=DR7
if [[ "${RECORD}" == 1 ]]; then
  bk_status_set lastDrillOk "$(bk_now)" lastDrillSetAt "${CREATED}"
  echo "✅ 戻す練習は成功しました（$(bk_jst "${CREATED}") の控え、表 ${#compare[@]} つ、ファイル ${files} 個）。"
else
  echo "✅ 戻す練習は成功しました（$(bk_jst "${CREATED}") の控え、表 ${#compare[@]} つ、ファイル ${files} 個）。--date や --local のときは記録しません。"
fi
OK=1
