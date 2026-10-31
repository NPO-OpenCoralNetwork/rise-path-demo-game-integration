#!/usr/bin/env bash
# 控えから本番の DB を戻す (Phase 9, owner decision D4; design §5.4, §5.8; doc/guides/first-launch.ja.md 16.2, 16.3,
# 13 章 RS0-RS11). Only in an emergency and only with the agent, on the VM, from /opt/risepath/deploy/risepath-vm:
#   sudo ./scripts/restore-db.sh --from newest|YYYY-MM-DD|<folder> --yes-replace-production-database \
#     [--with-uploads] [--current-db-lost]
# A date is a Japan day (the newest complete set made that day, Japan time); times shown are Japan time.
# It runs as root (it reads the key and replaces the database); every step that touches the checkout or deploys runs
# as the checkout's owner (runuser), never as root: the 事前チェック refuses root and a root deploy would leave
# root-owned files. Start it inside tmux (手順書 16.2): a dropped SSH connection (SIGHUP) stops it partway. The order
# (findings 2, 3, 26) keeps every deletion learners asked for after the backup:
#   RS0  the 事前チェック must pass (nothing touched yet)
#   RS1  the restore marked on the disk (/var/lib/risepath-backup/restore-in-progress, backup-common.sh: it outlives a
#        reboot; while it is there backup.sh makes no backup and the 事前チェック's R9 stops a deploy), the backup timers
#        that exist stopped (the enabled ones remembered; a rebuilt VM, 16.3, has none yet) and the backup lock held: no
#        backup runs meanwhile. The same command again after a stop finds the marker and goes on with it
#   RS2  the boot unit (risepath-stack.service) disabled, so a reboot does not start Rise Path (review round 2, finding 2);
#        api, mcp, mcp-public and cloudflared stopped: nothing writes, learners see that Rise Path cannot be reached
#   RS3  only db started when it is not running (after a reboot during a held restore: the boot unit is off and its
#        ExecStop stopped every service; the others stay stopped). The deletion records exported from the live
#        database while it still answers, and the export file found on the VM (else stop, unless --current-db-lost:
#        then the last hour's records are lost). The same command again after a stop at RS5 (the database answers but
#        is empty or half restored) needs --current-db-lost: the first run's export stays on the VM and RS8 still
#        reads it
#   RS4  the set picked; its manifest checked (fixed forms, this VM's key id); the files downloaded and checked
#        against the manifest, the manifest against its sealed copy, and both files decrypted to the end (every
#        chunk authenticated): only then its time, commit and counts shown, and a yes
#   RS5  the database dropped, made again and restored (pg_restore, one transaction)
#   RS6  --with-uploads (the volume was lost): the uploads restored
#   RS7  the migrations newer than the dump (no service started)
#   RS8  the deletions after the dump re-applied (scripts/replay-deletions.mjs) from every pre-restore export and
#        every bucket journal made since the dump started (less 15 minutes; none at all is 0 rows, with a warning):
#        the counts first, a yes, then --yes;
#        still with every learner-facing service stopped, so no deleted account is ever served again. The joined
#        plaintext CSV lives only in the 0700 temp folder in /run (tmpfs: gone after a reboot)
#   RS10 the marker removed, the boot unit enabled again (when it was), the lock released, the timers that were on
#        started again, one backup of the restored database
#   RS11 deploy-stack.sh (事前チェック, build, up, smoke, 事後の確かめ): learners come back
# RS9 (the byoa role SQL) is not in Phase 9 (byoa is off at the first launch). A stop from RS5 on keeps the marker, the
# boot unit disabled and the timers stopped, also after a reboot: a half-restored database must never become the newest
# backup nor be served. A stop before any run reached RS5 (the database unchanged) puts the three back as they were; the
# services stay stopped.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${STACK_DIR}/../.." && pwd)"
# shellcheck source=backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"
cd "${STACK_DIR}"
# The terminal stays on fd 3 for the two questions; every other command reads nothing.
exec 3<&0 0< /dev/null

OK=0
STEP=RS0
FROM=''
CONFIRMED=0
WITH_UPLOADS=0
DB_LOST=0
HELD=0
RELEASED=0
ENABLED_TIMERS=()
WORK=''

# release_hold: the marker removed, the boot unit enabled again when it was enabled before the first run, the timers that
# were on started again (RS10, or the trap when no run has changed the database). 1 when any of them failed.
release_hold() {
  local timer stack failed=0
  stack="$(bk_restore_field stack)"
  rm -f "${BK_RESTORE_MARK}" || failed=1
  if [[ "${stack}" == enabled ]]; then systemctl enable risepath-stack.service || failed=1; fi
  for timer in ${ENABLED_TIMERS[@]+"${ENABLED_TIMERS[@]}"}; do
    systemctl start "${timer}" || failed=1
  done
  RELEASED=1
  return "${failed}"
}

on_exit() {
  local rc=$?
  set +e
  if [[ "${OK}" != 1 ]]; then
    if [[ "${BK_SAID}" != "${STEP}" ]]; then bk_say "${STEP}" '途中で止まりました（思いがけないエラーです）。'; fi
    if [[ "${HELD}" == 1 && "${RELEASED}" == 0 ]]; then
      if [[ "$(bk_restore_field dbChanged)" == 0 ]]; then
        # No run has changed the database: the live one is still the true one, so backups and the boot unit come back.
        if release_hold; then
          echo '⚠️  DB はまだ変えていません。控えのタイマーと、VM の再起動のときの起動は、元に戻しました。Rise Path の部品（api など）は止めたままです。'
        else
          echo '⚠️  DB はまだ変えていません。控えのタイマーか、VM の再起動のときの起動を、元に戻せませんでした。`sudo systemctl enable risepath-stack.service` と `sudo systemctl start risepath-backup.timer risepath-backup-journal.timer` を実行し、出た行をエージェントに見せます。'
        fi
        echo '   続けるときは、「わけ」の行のとおりに直してから、同じコマンドをもう一度実行します。やめて Rise Path を動かし直すときは、`./scripts/deploy-stack.sh` を実行します（sudo なし）。'
      else
        echo '⚠️  戻しが途中です（DB は控えから戻しかけています）。控えは作らず、VM を再起動しても Rise Path は動き出しません（/var/lib/risepath-backup/restore-in-progress）。'
        echo '   デプロイはしません。エージェントと、同じコマンドで続きをします（手順書 16.2）。'
      fi
    fi
    if [[ "${rc}" == 0 ]]; then rc=1; fi
  fi
  # The downloaded set goes, and the plaintext journal with the /run temp folder; the encrypted pre-restore export
  # stays (backup.sh's BK8 removes it after BACKUP_RETENTION_DAYS).
  if [[ -n "${WORK}" && -d "${WORK}" ]]; then rm -rf "${WORK}"; fi
  bk_cleanup_tmp
  return "${rc}"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) [[ -z "${FROM}" && $# -ge 2 && -n "$2" ]] || bk_fail RS0 '--from のあとに newest か日付（日本時間の日。2026-11-02）か、控えのフォルダを書きます。'; FROM="$2"; shift 2 ;;
    --yes-replace-production-database) CONFIRMED=1; shift ;;
    --with-uploads) WITH_UPLOADS=1; shift ;;
    --current-db-lost) DB_LOST=1; shift ;;
    *) bk_fail RS0 '知らない指定です（--from、--yes-replace-production-database、--with-uploads、--current-db-lost だけです）。' ;;
  esac
done
[[ -n "${FROM}" ]] || bk_fail RS0 '--from で、どの控えから戻すかを書きます（エージェントと決めます）。'
[[ "${CONFIRMED}" == 1 ]] || bk_fail RS0 '本番の DB を置きかえるので、--yes-replace-production-database を付けます（エージェントと）。'
if [[ "${FROM}" != newest && ! "${FROM}" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}$ && ! -d "${FROM}" ]]; then
  bk_fail RS0 '--from は newest か、日付（日本時間の日。2026-11-02 の形）か、あるフォルダです。'
fi
[[ "$(id -u)" == 0 ]] || bk_fail RS0 'sudo を付けて実行します。'
OWNER="$(stat -c %U "${REPO_ROOT}" 2> /dev/null || true)"
[[ -n "${OWNER}" && "${OWNER}" != root && "${OWNER}" =~ ^[a-z_][a-z0-9_.-]{0,31}$ ]] \
  || bk_fail RS0 'リポジトリ（/opt/risepath）の持ち主が、デプロイする人ではありません（root のファイルが残っています）。'
# Every step that touches the checkout or calls the deploy: as the checkout's owner, never as root.
as_owner() { runuser -u "${OWNER}" -- "$@"; }
owner_compose() { as_owner docker compose --env-file stack.env -f docker-compose.yml "$@"; }
[[ -f "${BK_KEY}" ]] || bk_fail RS0 'この VM に鍵がありません。新しい VM なら、先に `sudo ./scripts/install-backup.sh --import-key` で鍵を戻します（手順書 16.3）。'
BUCKET="$(bk_bucket)"
[[ -n "${BUCKET}" ]] || bk_fail RS0 'backup.env にバケットの名前（BACKUP_BUCKET）がないか、形がちがいます（手順書 6.4）。'
IMAGE="$(bk_node_image)"
[[ -n "${IMAGE}" ]] || bk_fail RS0 'Dockerfile に api の行がありません。'

# RS0: the 事前チェック, before anything is touched.
echo '==> 事前チェック（RS0）'
if ! as_owner "${SCRIPT_DIR}/preflight.sh"; then
  # A rebuilt VM (手順書 16.3) has no backup unit yet (`--import-key` installs none), so at pilot the 事前チェック stops
  # on R1 and R3. Installing the backup first (R1's own fix) would back up the empty database as the newest set.
  if [[ ! -e "${BK_UNITS}/risepath-backup.timer" && ! -e "${BK_UNITS}/risepath-backup-journal.timer" ]]; then
    bk_fail RS0 '事前チェックにエラーがあります（上の行）。この VM には控えのタイマーがまだありません。新しい VM（手順書 16.3）で、エラーが R1 と R3 だけなら、戻し終わるまで launch-record.env の LAUNCH_STAGE を setup にします（install-backup.sh は、戻したあとに実行します）。'
  fi
  bk_fail RS0 '事前チェックにエラーがあります（上の行）。先にそれを直します。'
fi

# RS1: no backup runs during the restore (the marker on the disk, the timers stopped, then the lock that daily and
# journal take).
STEP=RS1
echo '==> 戻しの途中の印を書き、控えのタイマーを止めます（RS1）'
# Only timers that exist are stopped: a rebuilt VM (手順書 16.3) has none yet (`--import-key` installs no unit), and
# `systemctl stop` of a unit that is not loaded fails. They stay enabled (the same command again must pass the 事前チェック,
# whose R1 is an error for a timer that is not enabled); the marker keeps backup.sh from backing up meanwhile, even after
# a reboot.
STOP_TIMERS=()
for timer in risepath-backup.timer risepath-backup-journal.timer; do
  enabled="$(systemctl is-enabled "${timer}" 2> /dev/null || true)"
  active="$(systemctl is-active "${timer}" 2> /dev/null || true)"
  if [[ "${enabled}" == enabled ]]; then ENABLED_TIMERS+=("${timer}"); fi
  if [[ "${enabled}" == enabled || "${active}" == active ]]; then STOP_TIMERS+=("${timer}"); fi
done
if [[ -e "${BK_RESTORE_MARK}" ]]; then
  # The same command again after a stop: the first run's marker says what to put back at the end.
  echo "   前の戻しの続きです（$(bk_jst "$(bk_restore_field started)") に始めた戻し）。"
else
  stack=other
  if [[ "$(systemctl is-enabled risepath-stack.service 2> /dev/null || true)" == enabled ]]; then stack=enabled; fi
  bk_restore_write "$(bk_now)" "${stack}" 0 || bk_fail RS1 '戻しの途中の印（/var/lib/risepath-backup/restore-in-progress）を書けません。'
fi
HELD=1
if [[ ${#STOP_TIMERS[@]} -gt 0 ]]; then
  systemctl stop "${STOP_TIMERS[@]}" || bk_fail RS1 'タイマーを止められません。'
else
  echo '   この VM には、控えのタイマーがまだありません（手順書 16.3 では正しい状態です）。'
fi
mkdir -p "${BK_RUN}"
exec 9> "${BK_LOCK}"
flock -w 900 9 || bk_fail RS1 '15 分待っても、動いている控えが終わりません。'

# RS2: nothing writes to the database from here on.
STEP=RS2
echo '==> Rise Path の部品を止めます（RS2。戻すあいだは、アプリにつながりません）'
# The boot unit runs `docker compose up -d` at every boot: disabled until RS10, so a reboot never serves a database that
# is restored but not yet replayed. `disable` without --now: its ExecStop would also stop the db that RS3 reads.
if [[ "$(bk_restore_field stack)" == enabled ]]; then
  systemctl disable risepath-stack.service || bk_fail RS2 'VM の再起動のときの起動（risepath-stack.service）を切れません。'
fi
owner_compose stop api mcp mcp-public cloudflared || bk_fail RS2

# RS3: the last records from the live database, before anything is replaced.
STEP=RS3
# db only, when it is not running: after a reboot during a held restore the boot unit is off, and its ExecStop ran
# `docker compose stop`, which marks every container stopped by hand, so `restart: unless-stopped` starts none of them.
# RS3 and RS5 need db; api, mcp, mcp-public and cloudflared stay stopped until RS11 (review round 3, finding 2).
db_health() { bk_compose ps --format '{{.Health}}' db < /dev/null 2> /dev/null | head -n 1 || true; }
if [[ -z "$(db_health)" ]]; then
  echo '==> DB のコンテナだけを動かします（RS3。ほかの部品は止めたままです）'
  owner_compose up -d --no-deps db || bk_fail RS3 'DB のコンテナを動かせません（docker compose up -d --no-deps db）。'
  for _ in $(seq 1 60); do
    if [[ "$(db_health)" == healthy ]]; then break; fi
    sleep 2
  done
fi
PRE_NAME="pre-restore-$(bk_stamp | tr 'A-Z' 'a-z')"
if bk_compose exec -T db sh -c 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > /dev/null 2>&1; then
  echo '==> いまの DB から、削除の記録を書き出します（RS3）'
  if ! "${SCRIPT_DIR}/backup.sh" journal --keep-local "${PRE_NAME}"; then
    # Again after a restore that stopped at RS5: the database answers but is empty or half restored, so there is
    # nothing to export. The first run's export stays on the VM, and RS8 reads it.
    [[ "${DB_LOST}" == 1 ]] || bk_fail RS3 'DB は答えますが、削除の記録を書き出せません。前の戻しが RS5 で止まったあと（DB が空か途中）なら、エージェントと --current-db-lost を付けます。'
    echo '⚠️  DB は答えますが、削除の記録を書き出せません（--current-db-lost）。前の戻しで書き出した記録が VM にあれば、それを使います。'
  elif ! compgen -G "${BK_LOCAL}/${PRE_NAME}/*.csv.rpbk" > /dev/null; then
    # backup.sh answered 0 but wrote no file (it would skip a run whose lock it cannot take): an export that did not
    # happen must never pass for one, or the replay would miss the last hour's deletions (review round 3, finding 6).
    [[ "${DB_LOST}" == 1 ]] || bk_fail RS3 '書き出しは 0 で終わりましたが、書き出したファイルが VM にありません。'
    echo '⚠️  書き出しは 0 で終わりましたが、書き出したファイルが VM にありません（--current-db-lost）。前の戻しで書き出した記録が VM にあれば、それを使います。'
  fi
elif [[ "${DB_LOST}" == 1 ]]; then
  echo '⚠️  DB が答えません（--current-db-lost）。最後の 1 時間ぶんの削除の記録はありません（前の戻しで書き出した記録が VM にあれば、それを使います）。'
else
  bk_fail RS3 'DB が答えません。DB がなくなったときだけ、エージェントと --current-db-lost を付けます。'
fi

# RS4: the set, checked to the last byte, shown, confirmed. Nothing here changes the database.
STEP=RS4
WORK="${BK_LOCAL}/restore-$(bk_stamp)"
mkdir -p "${BK_LOCAL}"
chmod 700 "${BK_LOCAL}"
mkdir -m 700 "${WORK}"
bk_tmp
KEY_ID="$(bk_key_id)"
[[ -n "${KEY_ID}" ]] || bk_fail RS4 'この VM の鍵を読めません（鍵の形がちがうか、Docker で node のイメージを動かせません）。'
if [[ -d "${FROM}" ]]; then
  SET_DIR="$(cd "${FROM}" && pwd)"
  for f in manifest.json manifest.json.rpbk db.dump.rpbk uploads.tar.rpbk; do
    [[ -f "${SET_DIR}/${f}" ]] || bk_fail RS4 "${f} がフォルダにありません。"
  done
else
  SET_DIR="${WORK}/set"
  mkdir -m 700 "${SET_DIR}"
  day=''
  if [[ "${FROM}" != newest ]]; then day="${FROM}"; fi
  bk_gcs_token || bk_fail RS4 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  rc=0
  STAMP="$(bk_pick_set "${BUCKET}" "${SET_DIR}" "${day}")" || rc=$?
  if [[ "${rc}" != 0 ]]; then bk_fail RS4 "そろった控え（manifest.json と 3 つのファイル）を、バケットから読み出せません（${FROM}）。"; fi
fi
bk_check_manifest "${SET_DIR}/manifest.json" || bk_fail RS4 '目録（manifest.json）が読めないか、形がちがいます。'
SET_KEY="$(bk_manifest_field "${SET_DIR}/manifest.json" keyId)"
[[ "${SET_KEY}" == "${KEY_ID}" ]] \
  || bk_fail RS4 "この控えは、ちがう鍵で作られています（控えの key id: ${SET_KEY}、この VM の鍵の key id: ${KEY_ID}）。--from で、この鍵の控えを選びます。"
if [[ ! -d "${FROM}" ]]; then
  need_kb=$((($(bk_manifest_field "${SET_DIR}/manifest.json" dbDumpBytes) + $(bk_manifest_field "${SET_DIR}/manifest.json" uploadsBytes)) / 1024 + 1048576))
  free_kb="$(df -Pk "${BK_LOCAL}" 2> /dev/null | awk 'NR==2 {print $4}')"
  [[ "${free_kb}" =~ ^[0-9]+$ ]] && ((free_kb >= need_kb)) || bk_fail RS4 "ディスクの空きが足りません（読み出す控えに $((need_kb / 1048576 + 1)) GB ほど要ります）。"
  bk_gcs_token || bk_fail RS4 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  bk_fetch_set "${BUCKET}" "${STAMP}" "${SET_DIR}" || bk_fail RS4 "控えのファイルを、バケットから読み出せません（${FROM}）。"
fi
bk_verify_set "${SET_DIR}" || bk_fail RS4 '控えのファイルが、目録の SHA-256 か大きさと合いません。'
bk_verify_seal "${SET_DIR}" || bk_fail RS4 '目録（manifest.json）が、鍵で暗号化した写し（manifest.json.rpbk）と合いません（書きかえられたか、壊れています）。'
echo '==> 控えを最後まで復号して確かめます（RS4）'
bk_crypt decrypt < "${SET_DIR}/db.dump.rpbk" > /dev/null || bk_fail RS4 'DB の控え（db.dump.rpbk）を、最後まで復号できません（鍵か、ファイル）。'
if [[ "${WITH_UPLOADS}" == 1 ]]; then
  bk_crypt decrypt < "${SET_DIR}/uploads.tar.rpbk" > /dev/null || bk_fail RS4 'uploads の控え（uploads.tar.rpbk）を、最後まで復号できません（鍵か、ファイル）。'
fi
SINCE="$(bk_manifest_field "${SET_DIR}/manifest.json" dumpStartedAt)"
COMMIT="$(bk_manifest_field "${SET_DIR}/manifest.json" commit)"
# The counts are only shown, by the manifest's own table names (a set made before a table was added to BK_TABLES has
# its own list): a count that cannot be read is 不明, never a reason to refuse the set (review round 3, finding 5).
count_of() { local n; n="$(bk_manifest_count "${SET_DIR}/manifest.json" countsAfter "$1")"; printf '%s' "${n:-不明}"; }
echo "この控え: $(bk_jst "${SINCE}") に作り始めたもの（コミット ${COMMIT:0:7}）"
echo "  アカウント $(count_of auth.users)、レッスンの記録 $(count_of lesson_progress)、アカウントの削除の記録 $(count_of account_deletions)"
[[ "$(bk_ask 'この控えで戻しますか（yes と打って Enter）: ')" == yes ]] || bk_fail RS4 'yes と答えなかったので、やめました。'

# RS5: the database replaced by the set.
echo '==> DB を控えから戻します（RS5）'
# From here the database is no longer the live one: the marker says so for every later run, so a stop keeps it all held.
# Writing it is still RS1's (the step that owns the marker): nothing is changed yet, and the trap puts everything back
# (review round 3, finding 10).
bk_restore_write "$(bk_restore_field started)" "$(bk_restore_field stack)" 1 \
  || bk_fail RS1 '戻しの途中の印（/var/lib/risepath-backup/restore-in-progress）を書けません（DB はまだ変えていません）。'
STEP=RS5
bk_compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -T template0 -E UTF8 "$POSTGRES_DB"' \
  || bk_fail RS5 'DB を作り直せません（dropdb か createdb）。'
set +e
bk_crypt decrypt < "${SET_DIR}/db.dump.rpbk" \
  | bk_compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error --single-transaction'
st=("${PIPESTATUS[@]}")
set -e
[[ "${st[0]}" == 0 && "${st[1]}" == 0 ]] || bk_fail RS5 "復号（${st[0]}）か pg_restore（${st[1]}）が 0 で終わりませんでした。"

# RS6: the uploads, only when their volume was lost.
if [[ "${WITH_UPLOADS}" == 1 ]]; then
  STEP=RS6
  echo '==> アップロードされたファイルを戻します（RS6）'
  vol="$(bk_uploads_volume)"
  [[ -n "${vol}" ]] || bk_fail RS6 'uploads のボリュームがありません（先に手順書 6.1 のデプロイをします）。'
  set +e
  bk_crypt decrypt < "${SET_DIR}/uploads.tar.rpbk" \
    | docker run --rm -i --log-driver none --network none --security-opt no-new-privileges --mount "type=volume,src=${vol},dst=/data" "${IMAGE}" tar -C /data -xf -
  st=("${PIPESTATUS[@]}")
  set -e
  [[ "${st[0]}" == 0 && "${st[1]}" == 0 ]] || bk_fail RS6 "復号（${st[0]}）か tar（${st[1]}）が 0 で終わりませんでした。"
fi

# RS7: the migrations newer than the dump; no service starts.
STEP=RS7
echo '==> migration（RS7）'
owner_compose run --rm --no-deps -T api npm run db:migrate || bk_fail RS7

# RS8: the deletions after the dump, while every learner-facing service is still stopped.
STEP=RS8
echo '==> 控えのあとの削除の記録を集めます（RS8）'
FROM_STAMP="$(date -u -d "${SINCE} - 15 minutes" +%Y-%m-%dT%H%M%SZ)"
CSV="${BK_TMP}/journal.csv"
# The header first: with no journal at all (the database lost before the first hourly journal after the dump, or the
# hourly journals failing since) the replay reads 0 rows instead of an empty file (review round 3, finding 1).
printf '%s\n' "${BK_JOURNAL_HEADER}" > "${CSV}"
pre=0
# Every export made before a restore and not older than the window: this run's (RS3), and an earlier run's when this
# is the same command again (its export may never have reached the bucket). Rows already applied are skipped.
shopt -s nullglob
for file in "${BK_LOCAL}"/pre-restore-*/*.csv.rpbk; do
  [[ "${file##*/}" =~ ^(20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z)(-[0-9a-f]{6})?\.csv\.rpbk$ ]] || continue
  [[ ! "${BASH_REMATCH[1]}" < "${FROM_STAMP}" ]] || continue
  pre=$((pre + 1))
  bk_crypt decrypt < "${file}" >> "${CSV}" || bk_fail RS8 '戻す前に書き出した削除の記録を読めません。'
done
shopt -u nullglob
# A fresh token: the one from RS4 may have expired during the question, the restore or the migrations.
bk_gcs_token || bk_fail RS8 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
listing="$(bk_gcs_list "${BUCKET}" journal/)" || bk_fail RS8 'バケットの削除の記録の一覧を読めません。'
n=0
while IFS=' ' read -r name _; do
  [[ "${name}" =~ ^journal/[0-9-]+/(20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z)(-[0-9a-f]{6})?\.csv\.rpbk$ ]] || continue
  [[ ! "${BASH_REMATCH[1]}" < "${FROM_STAMP}" ]] || continue
  n=$((n + 1))
  # A fresh token for each journal: a set several days old has many, and the metadata server may hand out a token with
  # only minutes left (review round 2, finding 3).
  bk_gcs_token || bk_fail RS8 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
  bk_gcs_get "${BUCKET}" "${name}" "${WORK}/journal-${n}.rpbk" || bk_fail RS8 'バケットの削除の記録を読み出せません。'
  bk_crypt decrypt < "${WORK}/journal-${n}.rpbk" >> "${CSV}" || bk_fail RS8 'バケットの削除の記録を読めません（鍵か、ファイル）。'
done <<< "${listing}"
echo "   読んだ記録: 戻す前の書き出しから ${pre}、バケットから ${n}"
if ((pre + n == 0)); then
  echo '⚠️  控えのあとの削除の記録が、VM にもバケットにもありません（0 行として確かめます）。控えのあとに受けた削除があっても、当て直せません。事故の記録に書きます（手順書 16.2）。'
fi
rc=0
owner_compose run --rm --no-deps -T api node scripts/replay-deletions.mjs --since "${SINCE}" < "${CSV}" || rc=$?
[[ "${rc}" == 0 ]] || bk_fail RS8 "確かめで止まりました（終わりの番号 ${rc}）。"
[[ "$(bk_ask 'この数で合っていますか（yes と打って Enter）: ')" == yes ]] || bk_fail RS8 'yes と答えなかったので、やめました（DB は戻しましたが、削除の記録はまだ当てていません）。'
rc=0
owner_compose run --rm --no-deps -T api node scripts/replay-deletions.mjs --since "${SINCE}" --yes < "${CSV}" || rc=$?
[[ "${rc}" == 0 ]] || bk_fail RS8 "当て直しが終わりませんでした（終わりの番号 ${rc}）。"
rm -f "${CSV}"

# RS10: backups and the boot unit again (from here a failure leaves them running: the database is correct).
STEP=RS10
echo '==> 戻しの途中の印を消し、再起動のときの起動と控えのタイマーを元に戻し、戻した DB の控えを作ります（RS10）'
exec 9>&-
RS10_FAILED=0
release_hold || RS10_FAILED=1
"${SCRIPT_DIR}/backup.sh" daily || RS10_FAILED=1
if [[ "${RS10_FAILED}" == 1 ]]; then bk_say RS10 'Rise Path を動かすのを先にします（このあと RS11）。'; fi

# RS11: the deploy brings learners back.
STEP=RS11
echo '==> デプロイします（RS11）'
as_owner "${SCRIPT_DIR}/deploy-stack.sh" || bk_fail RS11
if [[ "${RS10_FAILED}" == 1 ]]; then
  STEP=RS10
  BK_SAID=RS10
  exit 1
fi
echo "✅ 戻しました（$(bk_jst "${SINCE}") の控えと、そのあとの削除の記録）。手順書 16.2 のとおり、学習者に知らせ、事故の記録を書きます。"
OK=1
