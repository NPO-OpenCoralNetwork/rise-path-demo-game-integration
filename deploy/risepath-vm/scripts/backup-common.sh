# shellcheck shell=bash
# 控え（バックアップ）の共通部分 (Phase 9, owner decision D4; design §5; doc/guides/first-launch.ja.md 6.4, 16 章).
# Sourced by backup.sh, install-backup.sh, restore-drill.sh and restore-db.sh, never run: code from the checkout,
# never a config file. Config values are read with fixed sed patterns (bk_env_value); no file is ever sourced
# here. Nothing prints a value: the bucket name, the webhook URL, the access token and the key stay out of every
# line, every argv and every log.
#
# The caller sets SCRIPT_DIR, STACK_DIR and REPO_ROOT (derived from its own path, so the systemd units' paths
# under /opt/risepath and a test copy both work), runs as root and uses `set -Eeuo pipefail` and `umask 077`.
# RISEPATH_BACKUP_TEST_ROOT moves the host folders below under a test folder (server/tests/backupScripts.test.js
# only): sudo resets the environment and systemd units set none, so on the VM the paths are always the real ones.

BK_ROOT="${RISEPATH_BACKUP_TEST_ROOT:-}"
BK_ETC="${BK_ROOT}/etc/risepath-backup"            # 0755; backup.key and backup.env 0600 (root)
BK_KEY="${BK_ETC}/backup.key"
BK_ENV="${BK_ETC}/backup.env"
BK_STATE="${BK_ROOT}/var/lib/risepath-backup"      # 0755; status.json 0644 (read by preflight.sh)
BK_STATUS="${BK_STATE}/status.json"
BK_LOCAL="${BK_ROOT}/var/backups/risepath"         # 0700: the local copies (3 days), drills and restores
BK_RUN="${BK_ROOT}/run"
BK_LOCK="${BK_RUN}/risepath-backup.lock"           # daily, journal and restore-db.sh: one at a time
BK_STATUS_LOCK="${BK_RUN}/risepath-backup-status.lock"
BK_UNITS="${BK_ROOT}/etc/systemd/system"
BK_PROJECT=risepath                                # the compose project (docker-compose.yml name:)
BK_TABLES=(auth.users user_profiles lesson_progress review_cards xp_awards materials account_deletions legal_acceptances schema_migrations)
# The deletion journal's CSV header: the column names of backup.sh's COPY … HEADER, and scripts/replay-deletions.mjs's
# HEADER (backupScripts.test.js keeps the three equal). restore-db.sh's RS8 starts its joined CSV with it.
BK_JOURNAL_HEADER='kind,user_id,time,requested_by,reopened_at,course_slug,lesson_id,ref_id'
BK_ISO_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
BK_STAMP_RE='^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$'
BK_BUCKET_RE='^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$'
BK_TMP=''

# --- The codes (scripts/deploy/backup-codes.mjs holds the same catalog; backupScripts.test.js keeps them equal) ---
# code|level|title|fix
BK_CODES=(
  'BK1|E|控えを始める前の確かめで止まりました（設定、鍵、DB、ディスクの空きのどれかです）。|「わけ」の行のとおりに直します。わからないときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'BK2|E|控えの前に、DB の行の数を数えられませんでした（まだ何も作っていません）。|DB が動いているかを `cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env ps` で見ます（db の行の STATUS に healthy とあれば動いています）。動いているのに出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'BK3|E|DB の控え（pg_dump）か、その暗号化が失敗しました（外には何も送っていません）。|デプロイと重なったときは、`sudo systemctl start risepath-backup.service` で作り直します。また出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'BK4|E|控えのあとに、DB の行の数を数えられませんでした（外には何も送っていません）。|デプロイと重なったときは、`sudo systemctl start risepath-backup.service` で作り直します。また出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'BK5|E|アップロードされたファイル（uploads）の控えか、その暗号化が失敗しました（外には何も送っていません）。|`sudo systemctl start risepath-backup.service` で作り直します。また出るときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'BK6|E|控えの目録（manifest.json）を作れませんでした（外には何も送っていません）。|`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'BK7|E|控えを Google Cloud のバケットに送れないか、送ったあとの大きさが合いません。|サービスアカウントの 2 つの役割と、backup.env のバケットの名前を見直します（手順書 3.8）。VM を BACKUP_SA_EMAIL なしで作ったときは、手順書 4.1 の 3 つのコマンドで控えのサービスアカウントを付けます。直らないときは、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'BK8|E|VM の中の古い控えを消せませんでした（外への控えはできています）。|`sudo ls -l /var/backups/risepath` で出た行と、`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'JO1|E|削除の記録（1 時間ごと）を控えられませんでした。|次の 1 時間で直ることがあります。2 回続けて知らせが来たときは、`sudo journalctl -u risepath-backup-journal -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  'JO2|W|毎日の控え（バックアップ）が 36 時間できていません。|その日のうちに `sudo journalctl -u risepath-backup -n 50` を見て、エージェントに相談します。止まったまま、バケットのライフサイクルの日数（backup.env の BACKUP_RETENTION_DAYS の日数。「わけ」の行に出ます）を過ぎると、VM の外の控えがなくなります（手順書 17 章）。'
  'IB0|E|控えの設定を続けられません（指定のまちがいか、Docker か systemd が答えません）。|「わけ」の行のとおりに直して、もう一度実行します。Docker か systemd のときは、`sudo docker ps` と `systemctl status risepath-backup.timer` で出た行をエージェントに見せます（手順書 6.4）。'
  'IB1|E|控えの設定は、sudo を付けて実行します。|`sudo ./scripts/install-backup.sh` のように、前に sudo を付けて、もう一度実行します（手順書 6.4）。'
  'IB2|E|控えの設定のファイル（/etc/risepath-backup/backup.env）に、バケットの名前がないか、形がちがいます。|`sudo nano /etc/risepath-backup/backup.env` でバケットの名前を書いてから、もう一度実行します（手順書 6.4）。'
  'IB3|E|失敗の知らせの受け口がありません（https の URL が見つかりません）。|stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書いてから、もう一度実行します（手順書 3.6）。'
  'IB4|E|バケットに試しのファイルを送れません（VM のサービスアカウントか、バケットの設定です）。|VM のサービスアカウントと、バケットの 2 つの役割を見直します（手順書 3.8）。VM を BACKUP_SA_EMAIL なしで作ったときは、手順書 4.1 の 3 つのコマンドで控えのサービスアカウントを付けます。直らないときは、出た行をエージェントに見せます（手順書 17 章）。'
  'IB5|E|鍵の確かめで止めました（鍵がないか、鍵どうしが合いません。鍵は変えていません）。|「わけ」の行のとおりにします。新しい VM で、前の控えがあるときは、`--new-key` ではなく `--import-key` で、しまっておいた鍵を戻します（手順書 16.3）。'
  'DR0|E|戻す練習を始められません（sudo、設定、鍵、Docker、ディスクの空きのどれかです）。|「わけ」の行のとおりに直してから、`sudo ./scripts/restore-drill.sh` をもう一度実行します（手順書 16.1）。'
  'DR1|E|バケットから、使える控えを読み出せません（ないか、36 時間より前か、読めません）。|「わけ」が 36 時間より前のときは、毎日の控えが止まっています。`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。「わけ」がトークンかサービスアカウントの役割のときは、サービスアカウントの 2 つの役割を見直します（手順書 3.8）。控えがまだないときは、手順書 6.4 の最初の控えを先にします。'
  'DR2|E|読み出した控えが、目録（manifest.json）と合いません（ファイルが壊れているか、書きかえられています）。|もう一度実行します。また出るときは、その控えは使えません。出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。'
  'DR3|E|練習用の DB を動かせません（Docker）。|`sudo docker ps -a` を実行し、出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。'
  'DR4|E|控えを練習用の DB に戻せませんでした（鍵がちがうか、控えが壊れています）。|`sudo ./scripts/install-backup.sh key-id` の key id が、launch-record.env の `BACKUP_KEY_ID` と同じかを見て、エージェントに相談します（手順書 16.1）。'
  'DR5|E|戻した DB の中身が、目録と合いません（文字コード、migration、行の数のどれかです）。|出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。'
  'DR6|E|アップロードされたファイルの控えを読めないか、ファイルの数が目録と合いません。|出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。'
  'DR7|W|練習用の DB か、読み出した控えを片付けられませんでした。|`sudo docker rm -f -v risepath-drill-db` を実行します。また出るときは、出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。'
  'RS0|E|戻す前の確かめで止めました（まだ何も変えていません）。|「わけ」の行のとおりに直します。事前チェックのエラーのときは、先にそれを直します（エージェントと。手順書 16.2）。'
  'RS1|E|戻しの途中の印を書くか、控えのタイマーを止めるか、動いている控えが終わるのを待つところで止まりました（DB はまだ変えていません）。|「わけ」の行と、`systemctl status risepath-backup.service` で出た行をエージェントに見せます（手順書 16.2）。'
  'RS2|E|Rise Path の部品（api、mcp など）を止められませんでした（DB はまだ変えていません）。|`cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env ps` で出た行をエージェントに見せます（手順書 16.2）。'
  'RS3|E|戻す前の、削除の記録の書き出しができませんでした（DB はまだ変えていません）。|DB が答えるのに書き出せないときは、戻しを続けません。出た行をエージェントに見せます（手順書 16.2）。'
  'RS4|E|戻す控えを選べないか、読み出した控えが目録か鍵と合いません（DB はまだ変えていません）。|「わけ」の行をエージェントに見せ、`--from` で使う控えを決め直します（手順書 16.2）。'
  'RS5|E|DB を控えから戻せませんでした（DB は空か、途中です）。|ここから先はエージェントと進めます。DB は空か途中なので、同じコマンドに `--current-db-lost` を付けて、もう一度はじめから戻します（最初に書き出した削除の記録も使います。手順書 16.2）。'
  'RS6|E|アップロードされたファイルを控えから戻せませんでした。|出た行をエージェントに見せます。同じコマンドで、もう一度はじめから戻せます（手順書 16.2）。'
  'RS7|E|戻した DB の migration が失敗しました。|出た行をエージェントに見せます。同じコマンドで、もう一度はじめから戻せます（手順書 16.2）。'
  'RS8|E|削除の記録をもう一度当てるところで止まりました（Rise Path は止めたままです）。|出た数と行をエージェントに見せます。DB が答えなかったとき（終わりの番号が 3）は、少し待って、同じコマンドで、もう一度はじめから戻します。削除の記録の行が読めなかったとき（終わりの番号が 1。何行目かが出ます）は、その行をエージェントと調べてから、同じコマンドで、もう一度はじめから戻します（手順書 16.2）。'
  'RS10|E|控えのタイマーと、再起動のときの起動を元に戻すか、戻したあとの控えを作るところで失敗しました（戻しは済んでいます）。|`sudo systemctl enable risepath-stack.service` と `sudo systemctl start risepath-backup.timer risepath-backup-journal.timer` を実行し、出た行をエージェントに見せます（手順書 16.2）。'
  'RS11|E|戻したあとのデプロイ（deploy-stack.sh）が失敗しました（戻しと、削除の記録の当て直しは済んでいます）。|上に出たデプロイのコードを手順書 13 章で見て、エージェントとデプロイを直します（手順書 16.2）。'
)
BK_SAID=''

# bk_say <code> [reason]: the code's lines (title, the optional fixed reason, fix, where to read more).
bk_say() {
  local entry code level title fix mark='❌'
  for entry in "${BK_CODES[@]}"; do
    IFS='|' read -r code level title fix <<< "${entry}"
    if [[ "${code}" == "$1" ]]; then
      if [[ "${level}" == W ]]; then mark='⚠️'; fi
      echo "${mark} [${code}] ${title}"
      if [[ -n "${2:-}" ]]; then echo "   わけ: $2"; fi
      echo "   直し方: ${fix}"
      echo "   くわしく: 手順書 13 章の「${code}」"
      BK_SAID="${code}"
      return 0
    fi
  done
  echo "❌ [$1]"
}

# bk_fail <code> [reason]: print the code and stop (the caller's EXIT trap records the step).
bk_fail() {
  STEP="$1"
  bk_say "$@"
  exit 1
}

# bk_ask <question>: one typed line from the terminal, which install-backup.sh and restore-db.sh keep on fd 3
# (their other commands read /dev/null: docker would otherwise take typed lines). The question goes to stderr.
bk_ask() {
  local answer=''
  printf '%s' "$1" >&2
  IFS= read -r -u 3 answer || true
  printf '%s' "${answer}"
}

bk_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
bk_stamp() { date -u +%Y-%m-%dT%H%M%SZ; }
# bk_stamp_iso <stamp>: 2026-11-02T182300Z → 2026-11-02T18:23:00Z
bk_stamp_iso() { printf '%s:%s:%sZ' "${1:0:13}" "${1:13:2}" "${1:15:2}"; }
# bk_unique: a stamp and 6 random hex characters, for objects that may be written twice in one second (journal, probe).
bk_unique() { printf '%s-%s' "$(bk_stamp)" "$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"; }
# bk_epoch <ISO time>: seconds since 1970, or nothing for anything that is not an ISO time.
bk_epoch() { if [[ "$1" =~ ${BK_ISO_RE} ]]; then date -u -d "$1" +%s 2> /dev/null || true; fi; }
# bk_age_s <ISO time>: its age in seconds, or a huge number when it is empty or unreadable.
bk_age_s() {
  local then
  then="$(bk_epoch "$1")"
  if [[ -z "${then}" ]]; then echo 999999999; else echo $(($(date -u +%s) - then)); fi
}
# Times shown to the owner are Japan time (UTC + 9 hours; Japan has no summer time), and so are the days that
# --date and --from YYYY-MM-DD name: the 03:23 backup of 11-03 has a UTC stamp of 11-02 (review round 1, finding 21).
# bk_jst <ISO time>: 「日本時間 2026-11-03 03:23」, or the ISO text itself when it cannot be read.
bk_jst() {
  local then
  then="$(bk_epoch "$1")"
  if [[ -z "${then}" ]]; then printf '%s' "$1"; else printf '日本時間 %s' "$(date -u -d "@$((then + 32400))" '+%Y-%m-%d %H:%M')"; fi
}
# bk_jst_day <stamp>: the Japan day (YYYY-MM-DD) of a set's stamp, or nothing.
bk_jst_day() {
  local then
  then="$(bk_epoch "$(bk_stamp_iso "$1")")"
  if [[ -n "${then}" ]]; then date -u -d "@$((then + 32400))" +%Y-%m-%d; fi
}

# --- Config: fixed patterns, the last assignment wins (as bash and compose read it); never sourced. -------
# bk_env_value <NAME> <file>: the value of the last line that assigns NAME (`NAME=` with an optional `export`), when
# that line is bare or in one pair of quotes, with an optional ` # comment`, and holds no $, backquote, backslash,
# quote or white space. A last assignment of another form gives nothing, never an earlier line's value: bash and
# compose would use the last line, so an older value here would be a different bucket or URL (review round 3,
# finding 4). Always exits 0.
bk_env_value() {
  local name="$1" file="$2" line
  [[ -r "${file}" ]] || return 0
  line="$(sed -nE "/^[[:space:]]*(export[[:space:]]+)?${name}=/p" "${file}" | tail -n 1)"
  [[ -n "${line}" ]] || return 0
  printf '%s\n' "${line}" \
    | sed -nE "s/^[[:space:]]*(export[[:space:]]+)?${name}=(\"([^\"\$\`\\\\[:space:]]*)\"|'([^'\$\`\\\\[:space:]]*)'|([^\"'\$\`\\\\[:space:]#]*))([[:space:]]+#.*)?[[:space:]]*$/\\3\\4\\5/p"
}

# The bucket from backup.env, or nothing when it is missing or not a bucket name.
bk_bucket() {
  local b
  b="$(bk_env_value BACKUP_BUCKET "${BK_ENV}")"
  if [[ "${b}" =~ ${BK_BUCKET_RE} ]]; then printf '%s' "${b}"; fi
}
# bk_days <NAME> <default>: a whole number of days (1-3650) from backup.env, else the default.
bk_days() {
  local v
  v="$(bk_env_value "$1" "${BK_ENV}")"
  if [[ "${v}" =~ ^[0-9]{1,4}$ ]] && ((10#${v} >= 1 && 10#${v} <= 3650)); then echo $((10#${v})); else echo "$2"; fi
}

# The alert webhook (design §5.4): the first https URL of backup.env's BACKUP_ALERT_WEBHOOK_URL, stack.env's
# AI_CAP_ALERT_WEBHOOK_URL and SAFETY_ALERT_WEBHOOK_URL, in that order. A value that is not one is passed over,
# as the 事前チェック's K1 does (it passes when either stack.env URL works; D9 names one that is not https), so
# `alert: false` (R6) means that no URL at all can carry the alert (review round 1, finding 6). A query string is
# accepted; bk_env_value has already refused quotes, backslashes, $ and white space, so the value is safe in
# curl's config file. Never printed.
BK_URL_RE='^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/%+=,:;@!*()?&#-]*)?$'
bk_alert_url() {
  local v name file
  for name in BACKUP_ALERT_WEBHOOK_URL AI_CAP_ALERT_WEBHOOK_URL SAFETY_ALERT_WEBHOOK_URL; do
    file="${STACK_DIR}/stack.env"
    if [[ "${name}" == BACKUP_ALERT_WEBHOOK_URL ]]; then file="${BK_ENV}"; fi
    v="$(bk_env_value "${name}" "${file}")"
    if [[ "${v}" =~ ${BK_URL_RE} ]]; then
      printf '%s' "${v}"
      return 0
    fi
  done
}

# --- The status file (/var/lib/risepath-backup/status.json, 0644): times, codes, a key id, a boolean. -------
BK_STATUS_KEYS=(lastOk lastFail lastFailStep keyId alert journalLastOk journalLastFail journalLastFailStep staleAlertAt lastDrillOk lastDrillFail lastDrillStep lastDrillSetAt)
bk_status_pattern() {
  case "$1" in
    lastFailStep | journalLastFailStep | lastDrillStep) echo '[A-Z]{2}[0-9]{1,2}' ;;
    keyId) echo '[0-9a-f]{16}' ;;
    alert) echo 'true|false' ;;
    *) echo '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' ;;
  esac
}
# bk_status_read: every known field of the status file into BK_STATUS_VALUES (bash only, one pass; a field that
# does not match its fixed pattern is left out).
declare -A BK_STATUS_VALUES=()
bk_status_read() {
  local line key value pattern
  BK_STATUS_VALUES=()
  [[ -r "${BK_STATUS}" ]] || return 0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" =~ ^[[:space:]]*\"([A-Za-z]+)\"[[:space:]]*:[[:space:]]*\"?([^\",]*)\"?,?[[:space:]]*$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      pattern="$(bk_status_pattern "${key}")"
      if [[ " ${BK_STATUS_KEYS[*]} " == *" ${key} "* && "${value}" =~ ^(${pattern})$ ]]; then BK_STATUS_VALUES[${key}]="${value}"; fi
    fi
  done < "${BK_STATUS}"
}
# bk_status_get <key>: the field, or nothing.
bk_status_get() {
  bk_status_read
  printf '%s' "${BK_STATUS_VALUES[$1]:-}"
}
# bk_status_set <key> <value> [<key> <value>]...: rewrites the file with every known field (atomic, under its lock).
bk_status_set() {
  (
    flock -w 30 8 || exit 1
    local key value out='{' first=1
    bk_status_read
    while [[ $# -ge 2 ]]; do
      if [[ " ${BK_STATUS_KEYS[*]} " == *" $1 "* && "$2" =~ ^($(bk_status_pattern "$1"))$ ]]; then BK_STATUS_VALUES[$1]="$2"; fi
      shift 2
    done
    for key in "${BK_STATUS_KEYS[@]}"; do
      value="${BK_STATUS_VALUES[${key}]:-}"
      [[ -n "${value}" ]] || continue
      if [[ "${first}" == 0 ]]; then out+=','; fi
      first=0
      if [[ "${key}" == alert ]]; then out+=$'\n'"  \"${key}\": ${value}"; else out+=$'\n'"  \"${key}\": \"${value}\""; fi
    done
    out+=$'\n''}'
    mkdir -p "${BK_STATE}"
    chmod 755 "${BK_STATE}"
    printf '%s\n' "${out}" > "${BK_STATUS}.tmp"
    chmod 644 "${BK_STATUS}.tmp"
    mv -f "${BK_STATUS}.tmp" "${BK_STATUS}"
  ) 8> "${BK_STATUS_LOCK}"
}

# --- A restore in progress (restore-db.sh; review round 2, finding 2). -----------------------------------------
# /var/lib/risepath-backup/restore-in-progress (0644) is on the disk, so it outlives a reboot: restore-db.sh writes it at
# RS1 and removes it at RS10 (or when it stops before any run changed the database). While it is there, backup.sh makes
# no backup, even when a reboot starts the timers again (a half-restored database must never become the newest set), and
# the 事前チェック's R9 stops a deploy (it must never be served). Fixed lines, read with fixed patterns, never sourced:
#   started=<ISO time>   stack=enabled|other (risepath-stack.service before the first run)   dbChanged=0|1 (a run reached RS5)
BK_RESTORE_MARK="${BK_STATE}/restore-in-progress"
# bk_restore_field <name>: a field of the marker, or nothing.
bk_restore_field() {
  if [[ -r "${BK_RESTORE_MARK}" ]]; then sed -nE "s/^$1=([A-Za-z0-9:-]{1,40})$/\\1/p" "${BK_RESTORE_MARK}" | tail -n 1; fi
}
# bk_restore_write <started> <stack> <dbChanged>: the marker, replaced atomically; 1 when it cannot be written.
bk_restore_write() {
  mkdir -p "${BK_STATE}" && chmod 755 "${BK_STATE}" || return 1
  printf '%s\n' '# 本番の DB を戻している途中です（restore-db.sh）。消さずに、エージェントと続きをします（手順書 16.2）。' \
    "started=$1" "stack=$2" "dbChanged=$3" > "${BK_RESTORE_MARK}.tmp" || return 1
  chmod 644 "${BK_RESTORE_MARK}.tmp" && mv -f "${BK_RESTORE_MARK}.tmp" "${BK_RESTORE_MARK}"
}

# --- Temp folder (0700, in /run: tmpfs, never on the disk) for the token header and the webhook config. ---
bk_tmp() {
  if [[ -z "${BK_TMP}" ]]; then
    mkdir -p "${BK_RUN}"
    BK_TMP="$(mktemp -d "${BK_RUN}/risepath-backup.XXXXXX")"
    chmod 700 "${BK_TMP}"
  fi
}
bk_cleanup_tmp() { if [[ -n "${BK_TMP}" && -d "${BK_TMP}" ]]; then rm -rf "${BK_TMP}"; fi; }

# --- The alert (one fixed line; Slack reads text, Discord content). The URL goes through curl -K, never argv. -
# bk_post <text>: 0 when the webhook took it.
bk_post() {
  local url text="$1"
  url="$(bk_alert_url)"
  [[ -n "${url}" ]] || return 1
  bk_tmp
  text="${text//\\/\\\\}"
  text="${text//\"/\\\"}"
  printf 'url = "%s"\n' "${url}" > "${BK_TMP}/webhook.cfg"
  printf '{"text":"%s","content":"%s"}\n' "${text}" "${text}" > "${BK_TMP}/alert.json"
  curl -sS --fail --max-time 20 -o /dev/null -K "${BK_TMP}/webhook.cfg" -H 'Content-Type: application/json' \
    --data-binary "@${BK_TMP}/alert.json" < /dev/null
}

# --- Google Cloud Storage over curl, with the VM's service account token (metadata server). --------------
# The token is read into a variable and written by printf (a builtin) into a 0600 header file; curl reads
# it with -H @file. It is never in an argv, a log line or a message.
bk_gcs_token() {
  local resp token
  bk_tmp
  resp="$(curl -sS --fail --max-time 10 -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' < /dev/null 2> /dev/null)" || return 1
  # (No bounded repeat in the pattern: bash's regex engine expands {16,4096} into a very slow automaton.)
  if [[ "${resp}" =~ \"access_token\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9._~+/=-]+)\" ]]; then
    token="${BASH_REMATCH[1]}"
  else
    return 1
  fi
  ((${#token} >= 16 && ${#token} <= 4096)) || return 1
  printf 'Authorization: Bearer %s\n' "${token}" > "${BK_TMP}/auth.hdr"
  chmod 600 "${BK_TMP}/auth.hdr"
}
# Object names here hold [A-Za-z0-9/._-] only; the JSON API wants them with / encoded.
bk_enc() {
  local s="$1" out='' c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "${c}" in
      [A-Za-z0-9._~-]) out+="${c}" ;;
      *) out+="$(printf '%%%02X' "'${c}")" ;;
    esac
  done
  printf '%s' "${out}"
}
# bk_gcs_size <bucket> <object>: the object's size in bytes.
bk_gcs_size() {
  local resp
  resp="$(curl -sS --fail --max-time 60 -H "@${BK_TMP}/auth.hdr" \
    "https://storage.googleapis.com/storage/v1/b/$1/o/$(bk_enc "$2")?fields=size" < /dev/null)" || return 1
  if [[ "${resp}" =~ \"size\"[[:space:]]*:[[:space:]]*\"([0-9]+)\" ]]; then printf '%s' "${BASH_REMATCH[1]}"; else return 1; fi
}
# bk_gcs_put <bucket> <file> <object>: upload once (if-generation-match 0: never over an existing object),
# then read the size back; 1 when either fails or the sizes differ. The caller takes a fresh token just before;
# the size is read with another one, since a large upload can outlast a token (about an hour).
bk_gcs_put() {
  local size remote
  size="$(stat -c %s "$2")" || return 1
  curl -sS --fail --max-time 3600 -o /dev/null -T "$2" -H "@${BK_TMP}/auth.hdr" -H 'x-goog-if-generation-match: 0' \
    "https://storage.googleapis.com/$1/$3" < /dev/null || return 1
  bk_gcs_token || return 1
  remote="$(bk_gcs_size "$1" "$3")" || return 1
  [[ "${remote}" == "${size}" ]]
}
# bk_gcs_get <bucket> <object> <file>
bk_gcs_get() {
  curl -sS --fail --max-time 3600 -o "$3" -H "@${BK_TMP}/auth.hdr" "https://storage.googleapis.com/$1/$2" < /dev/null
}
# bk_gcs_list <bucket> <prefix>: "<name> <size>" per object (every page).
bk_gcs_list() {
  local resp token='' page item name size query
  for ((page = 0; page < 200; page++)); do
    query="prefix=$(bk_enc "$2")&fields=items(name,size),nextPageToken&maxResults=1000"
    if [[ -n "${token}" ]]; then query+="&pageToken=$(bk_enc "${token}")"; fi
    resp="$(curl -sS --fail --max-time 60 -H "@${BK_TMP}/auth.hdr" "https://storage.googleapis.com/storage/v1/b/$1/o?${query}" < /dev/null)" || return 1
    resp="$(printf '%s' "${resp}" | tr -d '[:space:]')"
    while IFS= read -r item; do
      [[ -n "${item}" ]] || continue
      name=''
      size=''
      if [[ "${item}" =~ \"name\":\"([A-Za-z0-9/._-]+)\" ]]; then name="${BASH_REMATCH[1]}"; fi
      if [[ "${item}" =~ \"size\":\"([0-9]+)\" ]]; then size="${BASH_REMATCH[1]}"; fi
      if [[ -n "${name}" && -n "${size}" ]]; then echo "${name} ${size}"; fi
    done < <(printf '%s' "${resp}" | grep -oE '\{"[a-z]+":"[^{}]*\}' || true)
    if [[ "${resp}" =~ \"nextPageToken\":\"([A-Za-z0-9._~+/=-]+)\" ]]; then token="${BASH_REMATCH[1]}"; else return 0; fi
  done
  return 1
}
# bk_probe <bucket>: a fresh token, one small object up and its size read back (backup.sh probe; install-backup.sh's
# IB4, which then prints one code). On a failure BK_WHY holds the reason (no value in it).
BK_WHY=''
bk_probe() {
  local stamp
  bk_tmp
  stamp="$(bk_unique)"
  printf 'Rise Path backup probe %s\n' "${stamp}" > "${BK_TMP}/probe.txt"
  if ! bk_gcs_token; then
    BK_WHY='VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
    return 1
  fi
  if ! bk_gcs_put "$1" "${BK_TMP}/probe.txt" "probe/${stamp}.txt"; then
    BK_WHY='試しのファイルを送れないか、大きさが合いません（役割か、バケットの名前）。'
    return 1
  fi
}

# --- Docker: the api's base image runs the crypt and tar steps, offline. -----------------------------------
# The api's base image (the Dockerfile's `FROM … AS api` line), read once.
BK_NODE_IMAGE="$(sed -nE 's/^FROM ([^ ]+) AS api$/\1/p' "${STACK_DIR}/Dockerfile" 2> /dev/null | head -n 1 || true)"
bk_node_image() { printf '%s' "${BK_NODE_IMAGE}"; }
bk_db_image() { sed -nE 's#^ *image: (pgvector/pgvector:[^ ]+)$#\1#p' "${STACK_DIR}/docker-compose.yml" 2> /dev/null | head -n 1 || true; }
bk_compose() {
  (cd "${STACK_DIR}" && docker compose -p "${BK_PROJECT}" --env-file stack.env -f docker-compose.yml "$@")
}
# bk_crypt encrypt|decrypt|key-id: stdin → stdout, with the VM key mounted read-only. --log-driver none: Docker's
# default json-file driver would also write everything a container prints (the dump, the uploads, a new key) to
# /var/lib/docker/containers/<id>/<id>-json.log on the boot disk, about 4 times its size (review round 2, finding 1).
# Every `docker run` that carries data has it (backupScripts.test.js pins it).
bk_crypt() {
  docker run --rm -i --log-driver none --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m \
    --mount "type=bind,src=${BK_KEY},dst=/key/backup.key,readonly" \
    --mount "type=bind,src=${REPO_ROOT}/scripts/deploy,dst=/crypt,readonly" \
    "${BK_NODE_IMAGE}" node /crypt/backup-crypt.mjs "$1" --key /key/backup.key
}
# bk_crypt_plain keygen | key-id --stdin: the steps that need no key file.
bk_crypt_plain() {
  docker run --rm -i --log-driver none --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m \
    --mount "type=bind,src=${REPO_ROOT}/scripts/deploy,dst=/crypt,readonly" \
    "${BK_NODE_IMAGE}" node /crypt/backup-crypt.mjs "$@"
}
# The VM key's id (16 hex), or nothing.
bk_key_id() {
  local id
  [[ -f "${BK_KEY}" ]] || return 0
  id="$(bk_crypt key-id < /dev/null 2> /dev/null || true)"
  if [[ "${id}" =~ ^[0-9a-f]{16}$ ]]; then printf '%s' "${id}"; fi
}
# The uploads volume of the compose project (labels; never a guessed name).
bk_uploads_volume() {
  docker volume ls -q --filter "label=com.docker.compose.project=${BK_PROJECT}" --filter label=com.docker.compose.volume=uploads 2> /dev/null | head -n 1
}

# --- Sets: daily/<stamp>/{db.dump.rpbk, uploads.tar.rpbk, manifest.json.rpbk, manifest.json} ---------------
# The manifest is uploaded in plain text (install-backup.sh reads its key id on a VM without the key) and once more
# sealed with the VM key (manifest.json.rpbk, rpbk1). The bucket's writer can add objects, so nothing in a plain
# manifest is trusted: its fields must have their fixed forms before anything uses them (bk_check_manifest), and the
# drill and the restore use a set only when its manifest equals the sealed copy (bk_verify_seal), which only the key
# makes (review round 1, finding 1).
BK_COUNT_RE='^(0|[1-9][0-9]{0,14})$'
# bk_manifest_field <file> <key>: a string or number field of a manifest (one field per line, as backup.sh writes it).
bk_manifest_field() {
  sed -nE "s/^  \"$2\": \"?([A-Za-z0-9:._/-]*)\"?,?$/\\1/p" "$1" | head -n 1
}
# bk_manifest_list <file> <key>: the items of an array field, one per line.
bk_manifest_list() {
  sed -nE "s/^  \"$2\": \[(.*)\],?$/\\1/p" "$1" | head -n 1 | tr -d '" ' | tr ',' '\n' | sed '/^$/d'
}
# bk_manifest_tables <file>: the manifest's own table list (`tables`, the BK_TABLES of the backup that wrote it), one per
# line, only when every item is a table name (schema.table or table, lower case). A later phase may add a table to
# BK_TABLES: the sets made before it keep their own list, so counts are matched by name, never by position against
# the current BK_TABLES (review round 3, finding 5).
BK_TABLE_RE='^[a-z_][a-z0-9_]{0,62}(\.[a-z_][a-z0-9_]{0,62})?$'
bk_manifest_tables() {
  local items=() item
  mapfile -t items < <(bk_manifest_list "$1" tables)
  [[ ${#items[@]} -ge 1 ]] || return 1
  for item in "${items[@]}"; do
    [[ "${item}" =~ ${BK_TABLE_RE} ]] || return 1
  done
  printf '%s\n' "${items[@]}"
}
# bk_manifest_counts <file> <key>: countsBefore or countsAfter as "<table> <count>" lines, the manifest's `tables` and
# the counts paired item by item, only when both lists have the same length and every count is a whole number.
# Bash arithmetic evaluates names and subscripts inside a value (`a[$(…)]` runs a command), so no manifest value
# reaches arithmetic without this check.
bk_manifest_counts() {
  local tables=() items=() i
  mapfile -t tables < <(bk_manifest_tables "$1" || true)
  mapfile -t items < <(bk_manifest_list "$1" "$2")
  [[ ${#tables[@]} -ge 1 && ${#items[@]} == "${#tables[@]}" ]] || return 1
  for i in "${!items[@]}"; do
    [[ "${items[i]}" =~ ${BK_COUNT_RE} ]] || return 1
  done
  for i in "${!items[@]}"; do
    printf '%s %s\n' "${tables[i]}" "${items[i]}"
  done
}
# bk_manifest_count <file> <key> <table>: that table's count in countsBefore or countsAfter (a checked whole number),
# or nothing when the manifest has no such table or its counts cannot be read. Always exits 0.
bk_manifest_count() {
  { bk_manifest_counts "$1" "$2" || true; } | awk -v t="$3" '$1 == t { print $2; exit }'
}
# bk_check_manifest <file>: 0 when every field that drives a decision has its fixed form (format, times, key id,
# commit, SHA-256, sizes, file count, migration names). The counts are checked apart (bk_check_counts): the drill
# compares them, the restore only shows them, so they never make a set unusable for a restore.
bk_check_manifest() {
  local f="$1" key m
  [[ -f "${f}" && "$(bk_manifest_field "${f}" format)" == rpbk-manifest/1 ]] || return 1
  for key in createdAt dumpStartedAt dumpFinishedAt; do
    [[ "$(bk_manifest_field "${f}" "${key}")" =~ ${BK_ISO_RE} ]] || return 1
  done
  [[ "$(bk_manifest_field "${f}" keyId)" =~ ^[0-9a-f]{16}$ ]] || return 1
  [[ "$(bk_manifest_field "${f}" commit)" =~ ^([0-9a-f]{40})?$ ]] || return 1
  for key in dbDumpSha256 uploadsSha256; do
    [[ "$(bk_manifest_field "${f}" "${key}")" =~ ^[0-9a-f]{64}$ ]] || return 1
  done
  for key in dbDumpBytes uploadsBytes uploadsFileCount; do
    [[ "$(bk_manifest_field "${f}" "${key}")" =~ ${BK_COUNT_RE} ]] || return 1
  done
  while IFS= read -r m; do
    [[ "${m}" =~ ^[0-9]+_[A-Za-z0-9_.-]+$ ]] || return 1
  done < <(bk_manifest_list "${f}" migrations)
}
# bk_check_counts <file>: 0 when the table list and both count lists can be read (bk_manifest_counts).
bk_check_counts() {
  bk_manifest_counts "$1" countsBefore > /dev/null && bk_manifest_counts "$1" countsAfter > /dev/null
}
# bk_complete_stamps: from a bucket listing on stdin ("<name> <size>" per line), the stamps (BK_STAMP_RE) whose set has
# all four objects, newest first. A stray or planted name (daily/tmp-check/manifest.json) is never a set (review round 2,
# finding 4).
bk_complete_stamps() {
  local listing stamp f
  listing="$(cat)"
  while IFS= read -r stamp; do
    [[ "${stamp}" =~ ${BK_STAMP_RE} ]] || continue
    for f in db.dump.rpbk uploads.tar.rpbk manifest.json.rpbk; do
      grep -qxE "daily/${stamp}/${f//./\\.} [0-9]+" <<< "${listing}" || continue 2
    done
    printf '%s\n' "${stamp}"
  done < <(printf '%s\n' "${listing}" | sed -nE 's#^daily/([^/]+)/manifest\.json [0-9]+$#\1#p' | sort -r)
}
# bk_pick_set <bucket> <dest dir> [<Japan day YYYY-MM-DD>]: the newest complete set: all four objects listed, the
# manifest's sizes equal to the listing's, and its createdAt within 6 hours after the set's stamp (a set copied
# under another stamp is not that day's backup). Downloads only manifest.json into <dest dir> and prints the stamp:
# the caller checks the manifest and the disk before bk_fetch_set downloads the rest. A set without a manifest is
# incomplete by definition and never picked. 1: none; 2: the bucket could not be read.
bk_pick_set() {
  local bucket="$1" dest="$2" day="${3:-}" listing stamp name size db up sealed made at
  listing="$(bk_gcs_list "${bucket}" daily/)" || return 2
  while IFS= read -r stamp; do
    if [[ -n "${day}" && "$(bk_jst_day "${stamp}")" != "${day}" ]]; then continue; fi
    db=''
    up=''
    sealed=''
    while IFS=' ' read -r name size; do
      case "${name}" in
        "daily/${stamp}/db.dump.rpbk") db="${size}" ;;
        "daily/${stamp}/uploads.tar.rpbk") up="${size}" ;;
        "daily/${stamp}/manifest.json.rpbk") sealed="${size}" ;;
      esac
    done <<< "${listing}"
    [[ -n "${db}" && -n "${up}" && -n "${sealed}" ]] || continue
    bk_gcs_get "${bucket}" "daily/${stamp}/manifest.json" "${dest}/manifest.json" || return 2
    made="$(bk_epoch "$(bk_manifest_field "${dest}/manifest.json" createdAt)")"
    at="$(bk_epoch "$(bk_stamp_iso "${stamp}")")"
    if [[ "$(bk_manifest_field "${dest}/manifest.json" dbDumpBytes)" != "${db}" \
        || "$(bk_manifest_field "${dest}/manifest.json" uploadsBytes)" != "${up}" || -z "${made}" || -z "${at}" ]] \
        || ((made < at || made - at > 6 * 3600)); then
      rm -f "${dest}/manifest.json"
      continue
    fi
    printf '%s' "${stamp}"
    return 0
  done < <(bk_complete_stamps <<< "${listing}")
  return 1
}
# bk_fetch_set <bucket> <stamp> <dest dir>: the set's other three objects (the sealed manifest and the two files), each
# with a fresh token: a large download can outlast the token the one before it used (review round 2, finding 3).
bk_fetch_set() {
  local f
  for f in manifest.json.rpbk db.dump.rpbk uploads.tar.rpbk; do
    bk_gcs_token || return 1
    bk_gcs_get "$1" "daily/$2/${f}" "$3/${f}" || return 1
  done
}
# bk_verify_set <dir>: the two files' SHA-256 and sizes equal the manifest's.
bk_verify_set() {
  local f key
  for f in db.dump uploads.tar; do
    key=dbDump
    if [[ "${f}" == uploads.tar ]]; then key=uploads; fi
    [[ -f "$1/${f}.rpbk" ]] || return 1
    [[ "$(sha256sum "$1/${f}.rpbk" | awk '{print $1}')" == "$(bk_manifest_field "$1/manifest.json" "${key}Sha256")" ]] || return 1
    [[ "$(stat -c %s "$1/${f}.rpbk")" == "$(bk_manifest_field "$1/manifest.json" "${key}Bytes")" ]] || return 1
  done
}
# bk_verify_seal <dir>: manifest.json equals its sealed copy decrypted with the VM key (rpbk1 authenticates every
# byte, so a manifest the key did not seal is refused). Needs bk_tmp.
bk_verify_seal() {
  [[ -f "$1/manifest.json.rpbk" ]] || return 1
  bk_crypt decrypt < "$1/manifest.json.rpbk" > "${BK_TMP}/manifest.sealed" 2> /dev/null || return 1
  cmp -s "${BK_TMP}/manifest.sealed" "$1/manifest.json"
}
# bk_tar_count: regular entries of a tar listing on stdin (names not ending in /).
bk_tar_count() { grep -cvE '/$' || true; }
