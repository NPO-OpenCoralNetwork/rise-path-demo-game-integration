#!/usr/bin/env bash
# 毎日の控え（バックアップ）と、1 時間ごとの削除の記録 (Phase 9, owner decision D4; design §5.1, §5.4;
# doc/guides/first-launch.ja.md 6.4, 13 章 BK/JO, 16 章, 17 章). Run by systemd as root (deploy/risepath-vm/systemd/):
#   backup.sh daily      risepath-backup.service, every day at 03:23 Asia/Tokyo: the database (pg_dump -Fc) and the
#                        uploads volume, each encrypted (scripts/deploy/backup-crypt.mjs, rpbk1) in node:22-slim with no
#                        network, a manifest and its copy sealed with the key, then uploaded to the bucket: the two
#                        files, the sealed copy, each size read back, and the manifest last (the set's commit marker).
#                        Local copies 3 days in /var/backups/risepath.
#   backup.sh journal    risepath-backup-journal.service, hourly: the deletion records (five kinds, the last
#                        BACKUP_RETENTION_DAYS + 10 days) as encrypted CSV, for the replay after a restore; then
#                        JO2: when the last daily backup is older than 36 hours, one fixed Slack line (every 12 hours).
#                        Objects: journal/<YYYY-MM-DD>/<stamp>-<6 hex>.csv.rpbk (never two with one name).
#   backup.sh journal --keep-local <name>   restore-db.sh only (RS3): also keeps the file in /var/backups/risepath/<name>/
#   backup.sh probe      a one-line object up and its size read back (install-backup.sh calls the same bk_probe).
#   backup.sh alert <unit>   risepath-backup-alert@.service (OnFailure= of both units): one fixed Slack line.
#   backup.sh daily|journal --local-only --out <dir>   the rehearsal on the CI stack only (stack.env byte for byte
#                        ci/stack.ci.env, project risepath-ci): nothing is uploaded and nothing is recorded.
# A failure prints a code (BK1-BK8, JO1) and exits non-zero; the EXIT trap records lastFail and the step in
# /var/lib/risepath-backup/status.json unless the script reached its last statement (OK=1), so a failure in a
# function, a SIGTERM from TimeoutStartSec and an exit anywhere are all recorded. The trap never posts: the alert
# comes from systemd's OnFailure=, which also covers timeouts and a unit that never started. Never set -x; no
# config file is sourced; no value (bucket, URL, token, key) is printed.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${STACK_DIR}/../.." && pwd)"
# shellcheck source=backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

MODE="${1:-}"
if [[ $# -gt 0 ]]; then shift; fi
OK=0
STEP=''
LOCAL_ONLY=0
OUT=''
KEEP_LOCAL=''
PARTS=()

on_exit() {
  local rc=$?
  set +e
  if [[ "${OK}" != 1 ]]; then
    if [[ -n "${STEP}" && "${BK_SAID}" != "${STEP}" ]]; then bk_say "${STEP}" '途中で止まりました（時間切れか、思いがけないエラーです）。'; fi
    if [[ "${LOCAL_ONLY}" == 0 ]]; then
      case "${MODE}" in
        daily) bk_status_set lastFail "$(bk_now)" lastFailStep "${STEP:-BK1}" ;;
        journal) bk_status_set journalLastFail "$(bk_now)" journalLastFailStep "${STEP:-JO1}" ;;
      esac
    fi
    if [[ ${#PARTS[@]} -gt 0 ]]; then rm -f "${PARTS[@]}"; fi
  fi
  bk_cleanup_tmp
  return "${rc}"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# One backup step at a time (daily, journal, restore-db.sh). restore-db.sh holds the lock and runs
# `journal --keep-local`: a child that inherited the holder's descriptor uses it instead of waiting for itself.
bk_lock() {
  if [[ "$(readlink "/proc/$$/fd/9" 2> /dev/null || true)" != "${BK_LOCK}" ]]; then
    mkdir -p "${BK_RUN}"
    exec 9> "${BK_LOCK}"
  fi
  flock -n 9
}

parse_local_flags() { # --local-only --out <dir> [--keep-local <name> for journal]
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --local-only) LOCAL_ONLY=1; shift ;;
      --out) [[ $# -ge 2 && -n "$2" ]] || bk_fail "${STEP}" '--out のあとにフォルダがありません。'; OUT="$2"; shift 2 ;;
      --keep-local)
        [[ "${MODE}" == journal && $# -ge 2 && "$2" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || bk_fail "${STEP}" '--keep-local は journal の名前（英小文字と数字と -）といっしょにだけ使えます。'
        KEEP_LOCAL="$2"; shift 2 ;;
      *) bk_fail "${STEP}" '知らない指定です（daily、journal、probe、alert のどれかと、決まった指定だけを使います）。' ;;
    esac
  done
  if [[ "${LOCAL_ONLY}" == 1 ]]; then
    [[ -n "${OUT}" ]] || bk_fail "${STEP}" '--local-only には --out <フォルダ> が要ります。'
    # The rehearsal only: never on a real stack.env (CI's dummy template, byte for byte; project risepath-ci).
    if [[ ! -f "${STACK_DIR}/stack.env" || ! -f "${STACK_DIR}/ci/stack.ci.env" ]] || ! cmp -s "${STACK_DIR}/stack.env" "${STACK_DIR}/ci/stack.ci.env"; then
      bk_fail "${STEP}" '--local-only は、stack.env が CI の型（ci/stack.ci.env）とまったく同じときだけ使えます。'
    fi
    BK_PROJECT=risepath-ci
  elif [[ -n "${OUT}" ]]; then
    bk_fail "${STEP}" '--out は --local-only といっしょにだけ使えます。'
  fi
}

# The common start of daily and journal: root, the bucket (unless local), the key, alert: true|false, the lock.
start_run() {
  [[ "$(id -u)" == 0 ]] || bk_fail "${STEP}" 'root で動かします（systemd のユニットか、sudo）。'
  # A restore in progress (restore-db.sh's marker, review round 2 finding 2): no backup of a half-restored database, even
  # when a reboot started the timers again. restore-db.sh's own export (RS3, --keep-local) still runs. Whenever the
  # journal timer runs (after a reboot, or a manual start), the journal still checks JO2, so a marker left behind is not
  # silent then. While restore-db.sh holds a stopped restore (RS5 on) both timers stay stopped on purpose (design §5.4;
  # runbook 13 章 R8: no backup and no Slack line meanwhile; preflight R8 and R9 show it).
  if [[ -e "${BK_RESTORE_MARK}" && -z "${KEEP_LOCAL}" && "${LOCAL_ONLY}" == 0 ]]; then
    echo 'ℹ️  本番の DB を戻している途中です（restore-db.sh。/var/lib/risepath-backup/restore-in-progress があります）。戻し終わるまで、控えは作りません（手順書 16.2）。'
    if [[ "${MODE}" == journal ]]; then stale_check; fi
    OK=1
    exit 0
  fi
  if [[ "${LOCAL_ONLY}" == 0 ]]; then
    BUCKET="$(bk_bucket)"
    [[ -n "${BUCKET}" ]] || bk_fail "${STEP}" 'backup.env にバケットの名前（BACKUP_BUCKET）がないか、形がちがいます（手順書 6.4）。'
    if [[ -n "$(bk_alert_url)" ]]; then bk_status_set alert true; else bk_status_set alert false; fi
  fi
  [[ -f "${BK_KEY}" ]] || bk_fail "${STEP}" 'この VM に鍵（/etc/risepath-backup/backup.key）がありません（手順書 6.4）。'
  if ! bk_lock; then
    # restore-db.sh's RS3 export (--keep-local) holds the lock through the descriptor it inherited: a busy lock there is
    # an error, never a skip that restore-db.sh would read as an export (review round 3, finding 3).
    if [[ -n "${KEEP_LOCAL}" ]]; then bk_fail JO1 '控えのロック（/run/risepath-backup.lock）を取れません。戻しの書き出しは、戻しが持つロックの中でだけ動きます。'; fi
    echo 'ℹ️  ほかの控えの処理が動いているので、今回はしません（次の時刻に動きます）。'
    OK=1
    exit 0
  fi
  [[ -n "$(bk_node_image)" ]] || bk_fail "${STEP}" 'Dockerfile に api の行がありません。'
  KEY_ID="$(bk_key_id)"
  [[ -n "${KEY_ID}" ]] || bk_fail "${STEP}" '鍵を読めません（鍵の形がちがうか、Docker で node のイメージを動かせません）。'
  bk_tmp
}

# Row counts of the tables in BK_TABLES, comma separated, in that order (BK2/BK4; the manifest lists the tables with
# them, and DR5 compares them by name).
counts() {
  local sql='SELECT ' table out sep='' items=() item
  for table in "${BK_TABLES[@]}"; do
    sql+="${sep}(SELECT count(*) FROM ${table})"
    sep=', '
  done
  out="$(printf '%s;\n' "${sql}" | bk_compose exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F,' 2> /dev/null)" || return 1
  [[ "${out}" =~ ^[0-9,]+$ ]] || return 1
  IFS=',' read -r -a items <<< "${out}"
  [[ ${#items[@]} == "${#BK_TABLES[@]}" ]] || return 1
  for item in "${items[@]}"; do
    [[ "${item}" =~ ^[0-9]+$ ]] || return 1
  done
  printf '%s' "${out}"
}

json_list() { # comma separated words → "a", "b"
  local out='' word
  local IFS=','
  for word in $1; do out+="${out:+, }\"${word}\""; done
  printf '%s' "${out}"
}

daily() {
  local stamp base dir started finished before after vol files commit migrations health free need last=0 last_up=0 keep st
  STEP=BK1
  parse_local_flags "$@"
  start_run
  health="$(bk_compose ps --format '{{.Health}}' db < /dev/null 2> /dev/null | head -n 1 || true)"
  [[ "${health}" == healthy ]] || bk_fail BK1 'DB のコンテナが動いていないか、healthy ではありません。'
  base="${OUT:-${BK_LOCAL}}"
  mkdir -p "${base}"
  chmod 700 "${base}"
  # BK1: room for twice the last set (its dump and its uploads archive: each local set holds both) and 1 GiB more.
  last="$(find "${base}" -mindepth 2 -maxdepth 2 -name db.dump.rpbk -printf '%T@ %s\n' 2> /dev/null | sort -n | tail -n 1 | awk '{print $2}')"
  last_up="$(find "${base}" -mindepth 2 -maxdepth 2 -name uploads.tar.rpbk -printf '%T@ %s\n' 2> /dev/null | sort -n | tail -n 1 | awk '{print $2}')"
  free="$(df -Pk "${base}" 2> /dev/null | awk 'NR==2 {print $4}')"
  need=$(((2 * (${last:-0} + ${last_up:-0})) / 1024 + 1048576))
  [[ "${free}" =~ ^[0-9]+$ ]] && ((free >= need)) || bk_fail BK1 "ディスクの空きが足りません（要るのは $((need / 1048576 + 1)) GB ほどです）。"
  stamp="$(bk_stamp)"
  dir="${base}/${stamp}"
  mkdir -m 700 "${dir}"

  STEP=BK2
  before="$(counts)" || bk_fail BK2 'DB に行の数をたずねても、答えがありません。'

  STEP=BK3
  started="$(bk_now)"
  PARTS+=("${dir}/db.dump.rpbk.part")
  set +e
  bk_compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' < /dev/null | bk_crypt encrypt > "${dir}/db.dump.rpbk.part"
  st=("${PIPESTATUS[@]}")
  set -e
  [[ "${st[0]}" == 0 && "${st[1]}" == 0 ]] || bk_fail BK3 "pg_dump（${st[0]}）か暗号化（${st[1]}）が 0 で終わりませんでした。"
  mv "${dir}/db.dump.rpbk.part" "${dir}/db.dump.rpbk"
  finished="$(bk_now)"

  STEP=BK4
  after="$(counts)" || bk_fail BK4 'DB に行の数をたずねても、答えがありません。'

  STEP=BK5
  vol="$(bk_uploads_volume)"
  [[ -n "${vol}" ]] || bk_fail BK5 'uploads のボリュームが見つかりません（最初のデプロイの前です）。'
  PARTS+=("${dir}/uploads.tar.rpbk.part")
  set +e
  # GNU tar writes its -v listing to stderr when the archive goes to stdout: the file count of this very archive.
  # --log-driver none: the json-file driver would copy the plaintext archive to the boot disk (bk_crypt's comment).
  # The volume is live (an upload, an account deletion or the retention sweep may change it meanwhile): the --warning
  # flags keep tar's "file changed / removed / shrank" lines out of the listing, so it holds archived entries only
  # (bk_tar_count and the drill's DR6 agree; final review, finding 8).
  docker run --rm --log-driver none --network none --read-only --security-opt no-new-privileges --pids-limit 64 \
    --mount "type=volume,src=${vol},dst=/data,readonly" "$(bk_node_image)" \
    tar --warning=no-file-changed --warning=no-file-removed --warning=no-file-shrank -C /data -cvf - . \
    2> "${BK_TMP}/uploads.list" < /dev/null | bk_crypt encrypt > "${dir}/uploads.tar.rpbk.part"
  st=("${PIPESTATUS[@]}")
  set -e
  # GNU tar --create: 1 = a file changed or disappeared while it was read (the archive is complete otherwise), 2 = fatal.
  # A file that changed is archived as it was read; one removed before tar read it is not in the archive.
  [[ ( "${st[0]}" == 0 || "${st[0]}" == 1 ) && "${st[1]}" == 0 ]] || bk_fail BK5 "tar（${st[0]}）か暗号化（${st[1]}）が 0 で終わりませんでした。"
  [[ "${st[0]}" == 0 ]] || echo '⚠️  控えの最中に変わったファイルがありました（アップロードか削除）。そのファイルは、変わる前か後のどちらかで控えています（BK5）。'
  mv "${dir}/uploads.tar.rpbk.part" "${dir}/uploads.tar.rpbk"
  files="$(bk_tar_count < "${BK_TMP}/uploads.list")"

  STEP=BK6
  migrations="$(printf 'SELECT version FROM schema_migrations ORDER BY version;\n' \
    | bk_compose exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' 2> /dev/null)" \
    || bk_fail BK6 'migration の一覧を読めません。'
  migrations="$(printf '%s\n' "${migrations}" | grep -E '^[0-9]+_[A-Za-z0-9_.-]+$' | paste -sd, - || true)"
  [[ -n "${migrations}" ]] || bk_fail BK6 'migration の一覧が空です。'
  commit="$(git -c "safe.directory=${REPO_ROOT}" -C "${REPO_ROOT}" rev-parse HEAD 2> /dev/null || true)"
  [[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || commit=''
  # rpbk-manifest/1: times, the commit, migrations, counts, sizes, SHA-256, the file count, the key id. No
  # personal data: it is uploaded as it is (restore-drill.sh and restore-db.sh read it with fixed patterns).
  {
    echo '{'
    echo '  "format": "rpbk-manifest/1",'
    echo "  \"createdAt\": \"$(bk_now)\","
    echo "  \"dumpStartedAt\": \"${started}\","
    echo "  \"dumpFinishedAt\": \"${finished}\","
    echo "  \"commit\": \"${commit}\","
    echo "  \"keyId\": \"${KEY_ID}\","
    echo "  \"migrations\": [$(json_list "${migrations}")],"
    echo "  \"tables\": [$(json_list "$(IFS=,; echo "${BK_TABLES[*]}")")],"
    echo "  \"countsBefore\": [${before//,/, }],"
    echo "  \"countsAfter\": [${after//,/, }],"
    echo "  \"dbDumpBytes\": $(stat -c %s "${dir}/db.dump.rpbk"),"
    echo "  \"dbDumpSha256\": \"$(sha256sum "${dir}/db.dump.rpbk" | awk '{print $1}')\","
    echo "  \"uploadsBytes\": $(stat -c %s "${dir}/uploads.tar.rpbk"),"
    echo "  \"uploadsSha256\": \"$(sha256sum "${dir}/uploads.tar.rpbk" | awk '{print $1}')\","
    echo "  \"uploadsFileCount\": ${files}"
    echo '}'
  } > "${dir}/manifest.json"
  chmod 600 "${dir}/manifest.json"
  # The sealed copy (rpbk1 with the VM key): a drill or a restore uses the manifest only when it equals this copy,
  # so a manifest written by someone who can add objects to the bucket but has no key is refused (review round 1).
  bk_crypt encrypt < "${dir}/manifest.json" > "${dir}/manifest.json.rpbk" || bk_fail BK6 '目録の暗号化した写し（manifest.json.rpbk）を作れません。'

  if [[ "${LOCAL_ONLY}" == 1 ]]; then
    echo "✅ 控えを作りました（送っていません: --local-only）。$(du -sh "${dir}" | awk '{print $1}')、ファイル ${files} 個、key id ${KEY_ID}"
    return 0
  fi

  STEP=BK7
  # A fresh token before each upload: one lasts about an hour, and one upload may take up to an hour.
  bk_gcs_token || bk_fail BK7 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  bk_gcs_put "${BUCKET}" "${dir}/db.dump.rpbk" "daily/${stamp}/db.dump.rpbk" || bk_fail BK7 'DB の控え（db.dump.rpbk）を送れないか、大きさが合いません。'
  bk_gcs_token || bk_fail BK7 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  bk_gcs_put "${BUCKET}" "${dir}/uploads.tar.rpbk" "daily/${stamp}/uploads.tar.rpbk" || bk_fail BK7 'uploads の控え（uploads.tar.rpbk）を送れないか、大きさが合いません。'
  bk_gcs_token || bk_fail BK7 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  bk_gcs_put "${BUCKET}" "${dir}/manifest.json.rpbk" "daily/${stamp}/manifest.json.rpbk" || bk_fail BK7 '目録の暗号化した写し（manifest.json.rpbk）を送れないか、大きさが合いません。'
  # The manifest last: a set without it is incomplete and is never picked by a drill or a restore.
  bk_gcs_token || bk_fail BK7 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  bk_gcs_put "${BUCKET}" "${dir}/manifest.json" "daily/${stamp}/manifest.json" || bk_fail BK7 '目録（manifest.json）を送れないか、大きさが合いません。'
  bk_status_set lastOk "$(bk_now)" keyId "${KEY_ID}"

  STEP=BK8
  # The local sets, and the work folders of a drill or a restore that could not clean up (power loss, SIGKILL):
  # after BACKUP_KEEP_LOCAL_DAYS. The deletion records exported before a restore (RS3, pre-restore-*): after
  # BACKUP_RETENTION_DAYS, like the bucket's journals (no set older than that can be restored any more).
  keep=$(($(bk_days BACKUP_KEEP_LOCAL_DAYS 3) * 1440))
  find "${BK_LOCAL}" -mindepth 1 -maxdepth 1 -type d \( -regex '.*/20[0-9T:-]+Z' -o -name 'drill-*' -o -name 'restore-*' \) \
    -mmin +"${keep}" -exec rm -rf {} + || bk_fail BK8 'find か rm が失敗しました。'
  find "${BK_LOCAL}" -mindepth 1 -maxdepth 1 -type d -name 'pre-restore-*' \
    -mmin +$(($(bk_days BACKUP_RETENTION_DAYS 30) * 1440)) -exec rm -rf {} + || bk_fail BK8 'find か rm が失敗しました。'
  # The time in Japan time, as 13 章 says (the object stamp is UTC: the 03:23 backup of 11-03 is named 11-02; finding 14).
  echo "✅ 毎日の控えができました（$(bk_jst "$(bk_stamp_iso "${stamp}")")、DB $(du -h "${dir}/db.dump.rpbk" | awk '{print $1}')、ファイル ${files} 個、key id ${KEY_ID}）。"
}

# The deletion records (design §5.4, §5.8): ids, times and lesson slugs only; no name, email or text.
JOURNAL_SQL_TEMPLATE="COPY (
  SELECT 'account' AS kind, user_id::text AS user_id, %TIME(deleted_at)% AS time, requested_by, %TIME(reopened_at)% AS reopened_at,
         NULL::text AS course_slug, NULL::text AS lesson_id, NULL::text AS ref_id
    FROM account_deletions WHERE deleted_at > now() - interval '%DAYS% days'
  UNION ALL
  SELECT 'progress', user_id::text, %TIME(reset_at)%, NULL, NULL, NULL, NULL, NULL
    FROM lesson_progress_resets WHERE reset_at > now() - interval '%DAYS% days'
  UNION ALL
  SELECT 'lesson', user_id::text, %TIME(reset_at)%, NULL, NULL, course_slug, lesson_id, NULL
    FROM lesson_progress_lesson_resets WHERE reset_at > now() - interval '%DAYS% days'
  UNION ALL
  SELECT 'consent', user_id::text, %TIME(revoked_at)%, NULL, NULL, NULL, NULL, id::text
    FROM account_consents WHERE revoked_at IS NOT NULL AND revoked_at > now() - interval '%DAYS% days'
  UNION ALL
  SELECT 'grant', user_id::text, %TIME(revoked_at)%, NULL, NULL, NULL, NULL, client_id::text
    FROM mcp_oauth_grants WHERE revoked_at IS NOT NULL AND revoked_at > now() - interval '%DAYS% days'
  ORDER BY 3
) TO STDOUT WITH (FORMAT csv, HEADER);"

journal_sql() {
  local sql="${JOURNAL_SQL_TEMPLATE}" days column iso
  # The window: retention + 10 days (30 days of lifecycle, about 7 of soft delete, and a margin; TR9e).
  days=$(($(bk_days BACKUP_RETENTION_DAYS 30) + 10))
  sql="${sql//%DAYS%/${days}}"
  for column in deleted_at reopened_at reset_at revoked_at; do
    # UTC ISO with microseconds. The replacement goes through a variable: quotes written inside ${x//p/r} are
    # removed by bash, and the SQL needs them.
    iso="to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(${column} AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || 'Z'"
    sql="${sql//"%TIME(${column})%"/${iso}}"
  done
  printf '%s\n' "${sql}"
}

journal() {
  local stamp day file keep_dir='' st
  STEP=JO1
  parse_local_flags "$@"
  start_run
  bk_compose exec -T db sh -c 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /dev/null > /dev/null 2>&1 \
    || bk_fail JO1 'DB が答えません。'
  stamp="$(bk_unique)"
  day="${stamp%%T*}"
  if [[ "${LOCAL_ONLY}" == 1 ]]; then
    keep_dir="${OUT}"
  elif [[ -n "${KEEP_LOCAL}" ]]; then
    keep_dir="${BK_LOCAL}/${KEEP_LOCAL}"
  else
    keep_dir="${BK_LOCAL}/journal"
  fi
  mkdir -p "${BK_LOCAL}" "${keep_dir}"
  chmod 700 "${BK_LOCAL}" "${keep_dir}"
  file="${keep_dir}/${stamp}.csv.rpbk"
  PARTS+=("${file}.part")
  set +e
  journal_sql | bk_compose exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2> /dev/null \
    | bk_crypt encrypt > "${file}.part"
  st=("${PIPESTATUS[@]}")
  set -e
  [[ "${st[0]}" == 0 && "${st[1]}" == 0 && "${st[2]}" == 0 ]] || bk_fail JO1 "書き出し（${st[1]}）か暗号化（${st[2]}）が 0 で終わりませんでした。"
  mv "${file}.part" "${file}"
  if [[ "${LOCAL_ONLY}" == 1 ]]; then
    echo "✅ 削除の記録を控えました（送っていません: --local-only）。"
    return 0
  fi
  if bk_gcs_token && bk_gcs_put "${BUCKET}" "${file}" "journal/${day}/${stamp}.csv.rpbk"; then
    echo "✅ 削除の記録を控えました（$(bk_jst "$(bk_stamp_iso "${stamp%-*}")")）。"
  elif [[ -n "${KEEP_LOCAL}" ]]; then
    # restore-db.sh: the local copy is what the replay needs; the bucket may be what is broken.
    echo "⚠️  削除の記録はこの VM に控えました。バケットには送れませんでした。"
  else
    bk_fail JO1 'バケットに送れないか、大きさが合いません。'
  fi
  bk_status_set journalLastOk "$(bk_now)"
  if [[ -z "${KEEP_LOCAL}" ]]; then
    # Local journal copies: 48 hours.
    find "${BK_LOCAL}/journal" -mindepth 1 -maxdepth 1 -type f -name '*.csv.rpbk' -mmin +2880 -delete || true
    stale_check
  fi
}

# JO2: the last daily backup is older than 36 hours (or there is none while its timer is on): one fixed line,
# at most every 12 hours. A post that fails is printed and tried again next hour (staleAlertAt stays).
stale_check() {
  local last
  last="$(bk_status_get lastOk)"
  if [[ -z "${last}" && "$(systemctl is-enabled risepath-backup.timer 2> /dev/null || true)" != enabled ]]; then return 0; fi
  (($(bk_age_s "${last}") > 36 * 3600)) || return 0
  (($(bk_age_s "$(bk_status_get staleAlertAt)") > 12 * 3600)) || return 0
  # The days come from backup.env, not from the catalog's text: the owner may set another number (review round 3,
  # finding 8).
  bk_say JO2 "バケットのライフサイクルは $(bk_days BACKUP_RETENTION_DAYS 30) 日です（backup.env の BACKUP_RETENTION_DAYS）。"
  # The design's fixed line, with -n 50: without it journalctl opens a pager at the oldest entry (review round 3, finding 13).
  if bk_post '【Rise Path】毎日の控え（バックアップ）が 36 時間できていません。VM で `sudo journalctl -u risepath-backup -n 50` を見てください（手順書 17 章）。'; then
    bk_status_set staleAlertAt "$(bk_now)"
  else
    echo '⚠️  JO2 の知らせを送れませんでした（受け口がないか、Slack が答えません）。次の 1 時間で、もう一度送ります。'
  fi
}

probe() {
  STEP=BK7
  [[ $# -eq 0 ]] || bk_fail BK7 'probe には何も付けません。'
  [[ "$(id -u)" == 0 ]] || bk_fail BK7 'root で動かします（sudo）。'
  BUCKET="$(bk_bucket)"
  [[ -n "${BUCKET}" ]] || bk_fail BK7 'backup.env にバケットの名前（BACKUP_BUCKET）がないか、形がちがいます（手順書 6.4）。'
  bk_probe "${BUCKET}" || bk_fail BK7 "${BK_WHY}"
  echo '✅ バケットに試しのファイルを送り、大きさを確かめました。'
}

alert() {
  local unit="${1:-}" step='' failed=''
  [[ $# -eq 1 && "${unit}" =~ ^risepath-backup(-journal)?\.service$ ]] || { echo '❌ alert には risepath-backup.service か risepath-backup-journal.service を付けます。'; exit 2; }
  if [[ "${unit}" == risepath-backup.service ]]; then
    failed="$(bk_status_get lastFail)"
    step="$(bk_status_get lastFailStep)"
  else
    failed="$(bk_status_get journalLastFail)"
    step="$(bk_status_get journalLastFailStep)"
  fi
  # A step recorded long ago is not this failure's (a unit that never started records nothing).
  if [[ -z "${step}" ]] || (($(bk_age_s "${failed}") > 7200)); then step='不明'; fi
  if ! bk_post "【Rise Path】控えの処理（${unit}）が失敗しました（手順 ${step}）。VM で \`sudo journalctl -u ${unit} -n 50\` を見てください（手順書 17 章）。"; then
    echo '❌ 失敗の知らせを送れませんでした（受け口がないか、Slack が答えません）。'
    exit 1
  fi
  echo '✅ 失敗の知らせを送りました。'
}

case "${MODE}" in
  daily) daily "$@" ;;
  journal) journal "$@" ;;
  probe) probe "$@" ;;
  alert) alert "$@" ;;
  *)
    echo 'Usage: backup.sh daily | journal [--keep-local <name>] | probe | alert <unit>   (root; systemd runs daily and journal)'
    exit 2
    ;;
esac
OK=1
