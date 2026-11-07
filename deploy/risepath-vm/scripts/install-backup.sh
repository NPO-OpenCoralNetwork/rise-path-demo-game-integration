#!/usr/bin/env bash
# 毎日の控え（バックアップ）を入れる (Phase 9, owner decision D4; design §5.4, §5.9; doc/guides/first-launch.ja.md
# 6.4, 16.3, 13 章 IB0-IB5). The owner runs it on the VM with sudo, from /opt/risepath/deploy/risepath-vm:
#   sudo ./scripts/install-backup.sh --new-key     the first time: makes the key, the timers and the first backup
#   sudo ./scripts/install-backup.sh --import-key  a rebuilt VM (16.3): puts the saved key back (it must match the
#                                                  bucket's newest set) and stops there: no timer starts, so the empty
#                                                  database is never backed up over the restore point
#   sudo ./scripts/install-backup.sh               again later (after a fix, or after 16.3's restore): the units,
#                                                  the timers and one backup, with the key already there
#   sudo ./scripts/install-backup.sh key-id        the VM key's id (16 hex, not secret: launch-record.env BACKUP_KEY_ID)
#   sudo ./scripts/install-backup.sh check-copy    paste the password manager's copy: does it match the VM key?
# `--new-key --replace-key` makes a new key although the bucket holds sets of another key (they stay readable only
# with that old key). A pasted key is read without echo and never printed, logged or put on a command line.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${STACK_DIR}/../.." && pwd)"
# shellcheck source=backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

UNIT_FILES=(risepath-backup.service risepath-backup.timer risepath-backup-journal.service risepath-backup-journal.timer risepath-backup-alert@.service)
OK=0
STEP=IB0
# The terminal stays on fd 3 for the questions; every other command reads nothing (docker would eat typed lines).
exec 3<&0 0< /dev/null

on_exit() {
  local rc=$?
  set +e
  if [[ "${OK}" != 1 ]]; then
    # A command that failed without its own code (set -e) is still named.
    if [[ -z "${BK_SAID}" ]]; then bk_say "${STEP}" '途中で止まりました（思いがけないエラーです）。'; fi
    if [[ "${rc}" == 0 ]]; then rc=1; fi
  fi
  bk_cleanup_tmp
  return "${rc}"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

NEW_KEY=0
IMPORT_KEY=0
REPLACE_KEY=0
COMMAND=install
for arg in "$@"; do
  case "${arg}" in
    --new-key) NEW_KEY=1 ;;
    --import-key) IMPORT_KEY=1 ;;
    --replace-key) REPLACE_KEY=1 ;;
    key-id | check-copy)
      [[ $# -eq 1 ]] || bk_fail IB0 "${arg} には何も付けません。"
      COMMAND="${arg}" ;;
    *) bk_fail IB0 '知らない指定です（--new-key、--import-key、key-id、check-copy のどれかです）。' ;;
  esac
done
if ((NEW_KEY + IMPORT_KEY > 1)); then bk_fail IB0 '--new-key と --import-key は、どちらか 1 つだけを付けます。'; fi
if [[ "${REPLACE_KEY}" == 1 && "${NEW_KEY}" == 0 ]]; then bk_fail IB0 '--replace-key は --new-key といっしょにだけ使います。'; fi

# IB1: root reads the 0600 files and writes /etc and the units.
[[ "$(id -u)" == 0 ]] || bk_fail IB1
[[ -n "$(bk_node_image)" ]] || bk_fail IB0 'Dockerfile に api の行がありません（`git -C /opt/risepath status` で出た行をエージェントに見せます）。'

# read_pasted_key: a pasted key from the terminal, not echoed, into PASTED_KEY (never printed); normalized (white
# space out, lower case) and checked to be 64 hex characters. Then PASTED_ID: its id, computed offline in the crypt
# container (the key reaches it through a pipe from printf, a builtin: never an argv).
PASTED_KEY=''
PASTED_ID=''
read_pasted_key() {
  local pasted=''
  printf '%s' 'しまっておいた鍵（64 文字）を貼って、Enter を押します（画面には出ません）: ' >&2
  IFS= read -rs -u 3 pasted || true
  echo >&2
  pasted="${pasted//[[:space:]]/}"
  pasted="${pasted,,}"
  [[ "${pasted}" =~ ^[0-9a-f]{64}$ ]] || bk_fail IB5 '貼ったものが鍵の形（0〜9 と a〜f の 64 文字）ではありません。パスワード管理の「Rise Path 控えの鍵」をそのまま貼ります。'
  PASTED_KEY="${pasted}"
  PASTED_ID="$(printf '%s\n' "${PASTED_KEY}" | bk_crypt_plain key-id --stdin 2> /dev/null || true)"
  [[ "${PASTED_ID}" =~ ^[0-9a-f]{16}$ ]] || bk_fail IB0 '鍵の key id を計算できません（Docker で node のイメージを動かせません）。鍵は変えていません。'
}

# vm_key_id: the VM key's id into VM_ID. IB5 only when there is no key file; a key file whose id cannot be computed
# (Docker, or a damaged file) is IB0, so the owner is never told that a key is missing which `--new-key` then says is
# there (review round 3, finding 11).
VM_ID=''
vm_key_id() {
  [[ -f "${BK_KEY}" ]] || bk_fail IB5 'この VM に鍵がありません（手順書 6.4）。'
  VM_ID="$(bk_key_id)"
  [[ -n "${VM_ID}" ]] || bk_fail IB0 'この VM の鍵の key id を計算できません（Docker で node のイメージを動かせないか、鍵のファイルの形がちがいます）。鍵は変えていません。'
}
if [[ "${COMMAND}" == key-id ]]; then
  vm_key_id
  echo "key id: ${VM_ID}"
  OK=1
  exit 0
fi
if [[ "${COMMAND}" == check-copy ]]; then
  vm_key_id
  vm_id="${VM_ID}"
  read_pasted_key
  PASTED_KEY=''
  [[ "${PASTED_ID}" == "${vm_id}" ]] || bk_fail IB5 '貼った鍵は、この VM の鍵とちがいます。パスワード管理の控えを見直します（手順書 6.4）。'
  echo "✅ 控えの鍵は合っています（key id ${vm_id}）。"
  OK=1
  exit 0
fi

mkdir -p "${BK_ETC}" "${BK_STATE}"
chmod 755 "${BK_ETC}" "${BK_STATE}"

# IB2: the config. The first run copies the template and stops: the owner writes the bucket name.
if [[ ! -f "${BK_ENV}" ]]; then
  install -m 600 "${STACK_DIR}/backup.env.example" "${BK_ENV}"
  bk_fail IB2 'はじめてなので、設定のファイルを作りました。バケットの名前を書きます。'
fi
chmod 600 "${BK_ENV}"
BUCKET="$(bk_bucket)"
[[ -n "${BUCKET}" ]] || bk_fail IB2
# IB3: a failure must reach someone (the same Slack URL as the safety alerts, stack.env).
[[ -n "$(bk_alert_url)" ]] || bk_fail IB3
# IB4: the VM can write to the bucket and read the size back (one code: the probe's reason under IB4).
bk_probe "${BUCKET}" || bk_fail IB4 "${BK_WHY}"

bk_tmp
bk_gcs_token || bk_fail IB4 'VM のサービスアカウントのトークンをもらえません（メタデータのサーバー）。'
# The key id of the bucket's newest complete set (a stamp of the fixed form and all four objects, as the drill and the
# restore pick them; a stray name such as daily/tmp-check/manifest.json is no set: review round 2, finding 4), or nothing
# when the bucket holds no set. 1: the bucket could not be read; 2: that set's manifest has no readable key id (never
# taken for an empty bucket).
bucket_key_id() {
  local listing stamp id dir="${BK_TMP}/newest"
  mkdir -p "${dir}"
  listing="$(bk_gcs_list "${BUCKET}" daily/)" || return 1
  stamp="$(bk_complete_stamps <<< "${listing}" | sed -n 1p)"
  [[ -n "${stamp}" ]] || return 0
  bk_gcs_get "${BUCKET}" "daily/${stamp}/manifest.json" "${dir}/manifest.json" || return 1
  id="$(bk_manifest_field "${dir}/manifest.json" keyId)"
  [[ "${id}" =~ ^[0-9a-f]{16}$ ]] || return 2
  printf '%s' "${id}"
}
# existing_key_id: bucket_key_id into EXISTING, or the code for a bucket that cannot be read or a key id that cannot be.
EXISTING=''
existing_key_id() {
  local rc=0
  EXISTING="$(bucket_key_id)" || rc=$?
  if [[ "${rc}" == 1 ]]; then bk_fail IB4 'バケットの一覧を読めません。'; fi
  if [[ "${rc}" != 0 ]]; then
    bk_fail IB5 'バケットのいちばん新しい控えの目録（manifest.json）から、鍵の key id を読めません。鍵は変えていません。エージェントに相談します（手順書 17 章）。'
  fi
}
DAYS="$(bk_days BACKUP_RETENTION_DAYS 30)"
write_key() { # <key text>: backup.key, 0600, replaced atomically
  printf '%s\n' "$1" > "${BK_KEY}.tmp"
  chmod 600 "${BK_KEY}.tmp"
  mv -f "${BK_KEY}.tmp" "${BK_KEY}"
}

if [[ "${NEW_KEY}" == 1 ]]; then
  [[ ! -e "${BK_KEY}" ]] || bk_fail IB5 '鍵はもうあります。上書きすると、今までの控えを戻せなくなります（--new-key を付けずに実行します）。'
  existing_key_id
  existing="${EXISTING}"
  if [[ -n "${existing}" ]]; then
    if [[ "${REPLACE_KEY}" != 1 ]]; then
      bk_fail IB5 'このバケットには、ほかの鍵で作った控えがあります。新しい VM なら、`--import-key` で保存した鍵を戻します（手順書 16.3）。'
    fi
    # The bucket's lifecycle (BACKUP_RETENTION_DAYS, finding 9) and about 7 days of soft delete after it.
    echo "⚠️  バケットの今までの控え（key id ${existing}）は、前の鍵でしか戻せません。前の鍵は、その控えがバケットから消えるまで（ライフサイクルの ${DAYS} 日と、消したあと戻せる 7 日ほど）しまっておきます。"
  fi
  key="$(bk_crypt_plain keygen 2> /dev/null || true)"
  [[ "${key}" =~ ^[0-9a-f]{64}$ ]] || bk_fail IB0 '鍵を作れません（Docker で node のイメージを動かせません）。鍵は変えていません。'
  write_key "${key}"
  unset key
  echo "✅ 鍵を作りました（key id $(bk_key_id)）。"
elif [[ "${IMPORT_KEY}" == 1 ]]; then
  read_pasted_key
  id="${PASTED_ID}"
  if [[ -e "${BK_KEY}" ]]; then
    PASTED_KEY=''
    [[ "$(bk_key_id)" == "${id}" ]] || bk_fail IB5 'この VM には、ちがう鍵がもうあります（上書きしません）。エージェントに相談します。'
    echo "✅ この VM の鍵は、貼った鍵と同じです（key id ${id}）。何も変えていません。"
    OK=1
    exit 0
  fi
  existing_key_id
  existing="${EXISTING}"
  if [[ -z "${existing}" ]]; then
    if [[ "$(bk_ask 'バケットに控えがありません。この鍵で始めますか（yes と打って Enter）: ')" != yes ]]; then
      PASTED_KEY=''
      echo 'やめました（何も変えていません）。'
      OK=1
      exit 0
    fi
  elif [[ "${existing}" != "${id}" ]]; then
    PASTED_KEY=''
    bk_fail IB5 "貼った鍵は、バケットの控えの鍵とちがいます（控えの key id: ${existing}、貼った鍵の key id: ${id}）。"
  fi
  write_key "${PASTED_KEY}"
  PASTED_KEY=''
  echo "✅ 鍵を戻しました（key id ${id}）。"
  if [[ -z "${existing}" ]]; then
    # Nothing to restore (finding 8): restore-db.sh would stop at RS4.
    echo '   次に `sudo ./scripts/install-backup.sh` を何も付けずに実行します（戻す控えはありません）。'
  else
    echo '   控えのタイマーは、まだ動かしていません。手順書 16.3 のとおり、先に DB を控えから戻し（エージェントと）、'
    echo '   そのあとで `sudo ./scripts/install-backup.sh` を何も付けずに実行します。'
  fi
  OK=1
  exit 0
elif [[ ! -e "${BK_KEY}" ]]; then
  bk_fail IB0 '`--new-key`（はじめて）か `--import-key`（鍵を戻す）を付けます。'
fi

# The units: copied, loaded, both timers on, then one backup now.
mkdir -p "${BK_UNITS}"
for unit in "${UNIT_FILES[@]}"; do
  install -m 644 "${STACK_DIR}/systemd/${unit}" "${BK_UNITS}/${unit}"
done
systemctl daemon-reload || bk_fail IB0 'systemd が、控えのユニットを読み込めません（systemctl daemon-reload）。'
systemctl enable --now risepath-backup.timer risepath-backup-journal.timer || bk_fail IB0 '控えのタイマーを動かせません（systemctl enable）。'
started_at="$(date -u +%s)"
echo '==> 最初の控えを作ります（数分かかります）'
systemctl start risepath-backup.service || true
last_ok="$(bk_status_get lastOk)"
ok_at="$(bk_epoch "${last_ok}")"
if [[ -z "${ok_at}" ]] || ((ok_at < started_at - 1)); then
  # The step only when this run recorded it: a step left from an earlier attempt would show the wrong fix (finding 7).
  step="$(bk_status_get lastFailStep)"
  fail_at="$(bk_epoch "$(bk_status_get lastFail)")"
  if [[ -z "${fail_at}" ]] || ((fail_at < started_at - 1)); then step=''; fi
  echo "❌ 最初の控えが失敗しました（手順 ${step:-不明}）。"
  if [[ -n "${step}" ]]; then
    bk_say "${step}" '最初の控え（`sudo journalctl -u risepath-backup -n 50` に、くわしい行があります）。'
  else
    echo '   直し方: `sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。'
  fi
  BK_SAID=first-backup
  exit 1
fi
newest="$(find "${BK_LOCAL}" -mindepth 2 -maxdepth 2 -name db.dump.rpbk -printf '%T@ %p\n' 2> /dev/null | sort -n | tail -n 1 | cut -d' ' -f2-)"
echo "✅ 最初の控えができました（$(du -h "${newest}" 2> /dev/null | awk '{print $1}')）。key id: $(bk_key_id)"
echo
echo '次にすること（手順書 6.4・6.5。コマンドは、どれも /opt/risepath/deploy/risepath-vm で実行します）:'
echo '  1. 鍵を VM の外にしまいます: `sudo cat /etc/risepath-backup/backup.key` で出た 64 文字を、パスワード管理の'
echo '     「Rise Path 控えの鍵」に貼り、すぐに `clear` を実行します（手順書 6.4）。'
echo '  2. `sudo ./scripts/install-backup.sh check-copy` に、しまった鍵を貼って確かめます。'
echo '  3. launch-record.env の BACKUP_KEY_COPY に今日の日付を、BACKUP_KEY_ID に上の key id を書きます（手順書 6.4）。'
echo "  4. バケットのライフサイクル（${DAYS} 日で消す。backup.env の BACKUP_RETENTION_DAYS と同じ日数）を確かめます（手順書 3.8）。"
echo '  5. 最初の戻す練習 `sudo ./scripts/restore-drill.sh` をします（手順書 6.5）。'
OK=1
