// @ts-check
// The backup and restore scripts (Phase 9, owner decision D4; design §5.4-§5.6, §5.10; doc/guides/first-launch.ja.md
// 6.4, 16 章): static pins on deploy/risepath-vm/scripts/{backup,backup-common,install-backup,restore-drill,restore-db}.sh,
// the five systemd units, backup.env.example and provision-gce.sh, and a stub harness (server/tests/helpers/
// backupHarness.js) that runs the real scripts with docker, curl, flock, systemctl, runuser, stat, id, df and git
// stubbed: the order of a backup (the manifest last), failures recorded by the EXIT trap and never alerted by the
// script, SIGTERM, the token never shown, JO2 every 12 hours, the drill's choice of a complete and recent set, the key
// guards of install-backup.sh, and the order of a restore (the replay before any service starts, as the owner).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { BACKUP_CODES } from '../../scripts/deploy/backup-codes.mjs';
import { RULES } from '../../scripts/deploy/preflight-rules.mjs';
import {
  BUCKET, COUNTS, JOURNAL_HEADER, KEY_HEX, MIGRATIONS, OTHER_KEY_HEX, REAL_FLOCK, ROOT, STACK, TABLES, TOKEN, UNITS, WEBHOOK, hoursAgo, makeHarness,
} from './helpers/backupHarness.js';

const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SCRIPT = {
  backup: read('deploy/risepath-vm/scripts/backup.sh'),
  common: read('deploy/risepath-vm/scripts/backup-common.sh'),
  install: read('deploy/risepath-vm/scripts/install-backup.sh'),
  drill: read('deploy/risepath-vm/scripts/restore-drill.sh'),
  restore: read('deploy/risepath-vm/scripts/restore-db.sh'),
};
/** @typedef {import('./helpers/backupHarness.js').RunResult} RunResult */
/** Lines without comments. @param {string} text */
const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const bash4 = spawnSync('bash', ['-c', 'declare -A x=(); x[a]=1; : "${x[a],,}"']).status === 0;
const linux = process.platform === 'linux';
const skip = bash4 && linux ? false : 'needs bash ≥ 4 and Linux (GNU date, find -printf, /proc), as on the VM';

/** @type {Array<ReturnType<typeof makeHarness>>} */
const harnesses = [];
const harness = (/** @type {Parameters<typeof makeHarness>[0]} */ opts) => {
  const h = makeHarness(opts);
  harnesses.push(h);
  return h;
};
after(() => { for (const h of harnesses) h.cleanup(); });
/** The index of the first call that contains `needle` (from `from`), or -1. @param {string[]} calls @param {string} needle @param {number} [from] */
const at = (calls, needle, from = 0) => calls.findIndex((c, i) => i >= from && c.includes(needle));
/** Asserts `needles` appear in this order. @param {string[]} calls @param {string[]} needles */
const inOrder = (calls, needles) => {
  let from = 0;
  for (const needle of needles) {
    const i = at(calls, needle, from);
    assert.ok(i >= 0, `"${needle}" after call ${from}:\n${calls.join('\n')}`);
    from = i + 1;
  }
};
/**
 * Review round 2, finding 1: every `docker run` the scripts made that carries data had --log-driver none (Docker's json-file
 * driver would copy it to the boot disk); only the drill's throwaway database (-d) keeps its own server log.
 * @param {ReturnType<typeof makeHarness>} h
 */
const noJsonLog = (h) => {
  const runs = h.argv().filter((a) => a[0] === 'docker' && a[1] === 'run' && !a.includes('-d'));
  assert.ok(runs.length > 0, 'at least one docker run');
  for (const a of runs) assert.equal(a[a.indexOf('--log-driver') + 1], 'none', a.join(' '));
};
/** restore-db.sh's marker (review round 2, finding 2). @param {ReturnType<typeof makeHarness>} h */
const markOf = (h) => path.join(h.root, 'var/lib/risepath-backup/restore-in-progress');
const noToken = (/** @type {ReturnType<typeof makeHarness>} */ h, /** @type {string} */ out) => {
  assert.ok(!out.includes(TOKEN), 'token in the output');
  assert.ok(!JSON.stringify(h.argv()).includes(TOKEN), 'token in an argv');
  assert.ok(!h.calls().join('\n').includes(TOKEN), 'token in a log');
  assert.ok(!out.includes(WEBHOOK) && !JSON.stringify(h.argv()).includes(WEBHOOK), 'webhook URL printed or on a command line');
};

describe('backup scripts: static pins (design §5.10)', () => {
  const RUN = ['backup', 'install', 'drill', 'restore'];
  it('every script: set -Eeuo pipefail, umask 077, an EXIT trap, OK=1 as its last statement, never set -x', async () => {
    for (const name of RUN) {
      const text = SCRIPT[/** @type {keyof typeof SCRIPT} */ (name)];
      assert.match(text, /^set -Eeuo pipefail$/m, name);
      assert.match(text, /^umask 077$/m, name);
      assert.match(text, /^trap on_exit EXIT$/m, name);
      assert.match(text, /^trap 'exit 143' TERM$/m, `${name}: SIGTERM runs the EXIT trap`);
      const lines = code(text).split('\n').map((l) => l.trim()).filter(Boolean);
      assert.equal(lines.at(-1), 'OK=1', `${name}: OK=1 is the last statement`);
      assert.doesNotMatch(code(text), /\bset -[a-zA-Z]*x|set -o xtrace/, `${name}: no xtrace`);
    }
    assert.doesNotMatch(code(SCRIPT.common), /\bset -[a-zA-Z]*x/);
  });
  it('the trap records lastFail and the step unless OK=1, and never posts an alert (systemd OnFailure= does)', async () => {
    const trap = SCRIPT.backup.slice(SCRIPT.backup.indexOf('on_exit() {'), SCRIPT.backup.indexOf('trap on_exit EXIT'));
    assert.match(trap, /if \[\[ "\$\{OK\}" != 1 \]\]; then/);
    assert.match(trap, /daily\) bk_status_set lastFail "\$\(bk_now\)" lastFailStep "\$\{STEP:-BK1\}"/);
    assert.match(trap, /journal\) bk_status_set journalLastFail "\$\(bk_now\)" journalLastFailStep "\$\{STEP:-JO1\}"/);
    assert.doesNotMatch(trap, /bk_post|curl/);
  });
  it('only backup-common.sh is sourced; backup.env and stack.env are read with fixed sed patterns', async () => {
    for (const name of RUN) {
      const sources = [...code(SCRIPT[/** @type {keyof typeof SCRIPT} */ (name)]).matchAll(/^\s*(?:source|\.)\s+(\S+)/gm)].map((m) => m[1]);
      assert.deepEqual(sources, ['"${SCRIPT_DIR}/backup-common.sh"'], name);
    }
    assert.doesNotMatch(code(SCRIPT.common), /^\s*(?:source|\.)\s/m);
    assert.match(SCRIPT.common, /bk_env_value\(\) \{[\s\S]*?sed -nE "s\/\^\[\[:space:\]\]\*\(export/);
    assert.match(SCRIPT.common, /bk_env_value BACKUP_BUCKET "\$\{BK_ENV\}"/);
    assert.match(SCRIPT.common, /file="\$\{STACK_DIR\}\/stack\.env"\n[^\n]*file="\$\{BK_ENV\}"; fi\n\s+v="\$\(bk_env_value "\$\{name\}" "\$\{file\}"\)"/);
  });
  it('pg_dump only through `compose exec -T db … -Fc`; every pipe into or out of the crypt container checks PIPESTATUS', async () => {
    const all = Object.values(SCRIPT).join('\n');
    const dumps = code(all).split('\n').filter((l) => /\bpg_dump -/.test(l));
    assert.deepEqual(dumps.map((l) => l.trim()), ["bk_compose exec -T db sh -c 'pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -Fc' < /dev/null | bk_crypt encrypt > \"${dir}/db.dump.rpbk.part\""]);
    for (const [name, text] of Object.entries(SCRIPT)) {
      const lines = code(text).split('\n');
      lines.forEach((line, i) => {
        if (!/\|\s*bk_crypt|bk_crypt (?:encrypt|decrypt)[^|]*\|\s*(?:docker|bk_compose)|\|\s*$/.test(line) || /bk_crypt_plain|key-id|>> "\$\{CSV\}"/.test(line)) return;
        const next = lines.slice(i, i + 4).join('\n');
        assert.match(next, /st=\("\$\{PIPESTATUS\[@\]\}"\)/, `${name}: PIPESTATUS after "${line.trim()}"`);
        // Review round 1, finding 11: the check after the pipe reads every member's status (a tar or pg_dump that
        // died early still leaves a valid rpbk file of a short archive). The whole pipeline: its continued lines.
        let start = i;
        while (start > 0 && /\\$/.test(lines[start - 1])) start -= 1;
        let end = i;
        while (/\\$/.test(lines[end])) end += 1;
        const pipeline = lines.slice(start, end + 1).join(' ').replace(/'[^']*'/g, "''").replace(/\|\|/g, '');
        const members = (pipeline.match(/\|/g) ?? []).length + 1;
        const check = lines.slice(end + 1).find((l) => /\$\{st\[\d\]\}/.test(l) && /bk_fail/.test(l)) ?? '';
        for (let k = 0; k < members; k += 1) assert.ok(check.includes(`"\${st[${k}]}" == 0`), `${name}: st[${k}] of "${line.trim()}" checked in "${check.trim()}"`);
      });
    }
  });
  it('the crypt container: no network, read-only, every capability dropped, the key mounted read-only; tar of uploads offline and read-only', async () => {
    const crypt = SCRIPT.common.slice(SCRIPT.common.indexOf('bk_crypt() {'), SCRIPT.common.indexOf('# bk_crypt_plain'));
    for (const flag of ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', 'type=bind,src=${BK_KEY},dst=/key/backup.key,readonly', 'dst=/crypt,readonly']) {
      assert.ok(crypt.includes(flag), flag);
    }
    assert.match(SCRIPT.backup, /docker run --rm --log-driver none --network none --read-only --security-opt no-new-privileges --pids-limit 64 \\\n\s+--mount "type=volume,src=\$\{vol\},dst=\/data,readonly"/);
  });
  it('every `docker run` that carries data has --log-driver none (review round 2, finding 1: json-file would copy it to the boot disk)', async () => {
    let n = 0;
    for (const [name, text] of Object.entries(SCRIPT)) {
      const lines = code(text).split('\n');
      lines.forEach((line, i) => {
        if (!/\bdocker run\b/.test(line)) return;
        let end = i;
        while (/\\$/.test(lines[end])) end += 1;
        const command = lines.slice(i, end + 1).join(' ');
        // The drill's throwaway database (-d): its own server log, no data through its stdout.
        if (/docker run -d /.test(command)) return;
        n += 1;
        assert.match(command, /docker run --rm (?:-i )?--log-driver none /, `${name}: ${line.trim()}`);
      });
    }
    assert.equal(n, 5, 'bk_crypt, bk_crypt_plain, the uploads tar of BK5, DR6 and RS6');
  });
  it('the token: only in a 0600 header file read with -H @; uploads never overwrite (x-goog-if-generation-match: 0); the webhook only through -K', async () => {
    const all = code(Object.values(SCRIPT).join('\n'));
    assert.match(SCRIPT.common, /printf 'Authorization: Bearer %s\\n' "\$\{token\}" > "\$\{BK_TMP\}\/auth\.hdr"\n\s+chmod 600 "\$\{BK_TMP\}\/auth\.hdr"/);
    for (const line of all.split('\n').filter((l) => /\bcurl\b/.test(l) && /googleapis|storage/.test(l))) assert.match(line, /-H "@\$\{BK_TMP\}\/auth\.hdr"/, line);
    assert.doesNotMatch(all, /-H\s+"Authorization|-H\s+'Authorization|Bearer \$/);
    assert.match(SCRIPT.common, /-T "\$2" -H "@\$\{BK_TMP\}\/auth\.hdr" -H 'x-goog-if-generation-match: 0'/);
    assert.match(SCRIPT.common, /curl -sS --fail --max-time 20 -o \/dev\/null -K "\$\{BK_TMP\}\/webhook\.cfg"/);
    assert.match(SCRIPT.common, /mktemp -d "\$\{BK_RUN\}\/risepath-backup\.XXXXXX"\)"\n\s+chmod 700/);
  });
  it('the commit is read with safe.directory (root reads a checkout the deploy user owns)', async () => {
    assert.match(SCRIPT.backup, /git -c "safe\.directory=\$\{REPO_ROOT\}" -C "\$\{REPO_ROOT\}" rev-parse HEAD/);
  });
  it('the manifest is uploaded last, after the two files, each followed by its size check (bk_gcs_put reads the size back)', async () => {
    const puts = [...SCRIPT.backup.matchAll(/bk_gcs_put "\$\{BUCKET\}" "\$\{dir\}\/([a-z.]+)"/g)].map((m) => m[1]);
    assert.deepEqual(puts, ['db.dump.rpbk', 'uploads.tar.rpbk', 'manifest.json.rpbk', 'manifest.json']);
    // Review round 1, finding 3: a fresh token right before each upload, and again before its size is read back.
    const lines = code(SCRIPT.backup).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*bk_gcs_put "\$\{BUCKET\}" "\$\{dir\}/.test(line)) assert.match(lines[i - 1], /^\s*bk_gcs_token \|\| bk_fail BK7/, line.trim());
    });
    assert.match(SCRIPT.common, /x-goog-if-generation-match: 0'[^\n]*\\\n[^\n]*\n\s+bk_gcs_token \|\| return 1\n\s+remote="\$\(bk_gcs_size/);
    assert.match(SCRIPT.common, /remote="\$\(bk_gcs_size "\$1" "\$3"\)" \|\| return 1\n\s+\[\[ "\$\{remote\}" == "\$\{size\}" \]\]/);
    assert.ok(SCRIPT.backup.indexOf('bk_status_set lastOk') > SCRIPT.backup.indexOf('"daily/${stamp}/manifest.json"'), 'lastOk only after the manifest');
  });
  it('the systemd units (design §5.6)', async () => {
    const unit = (/** @type {string} */ f) => read(`deploy/risepath-vm/systemd/${f}`);
    assert.match(unit('risepath-backup.timer'), /^OnCalendar=\*-\*-\* 03:23:00 Asia\/Tokyo$/m);
    assert.match(unit('risepath-backup.timer'), /^RandomizedDelaySec=600$/m);
    assert.match(unit('risepath-backup.timer'), /^Persistent=true$/m);
    assert.match(unit('risepath-backup-journal.timer'), /^OnCalendar=hourly$/m);
    assert.match(unit('risepath-backup-journal.timer'), /^RandomizedDelaySec=300$/m);
    assert.match(unit('risepath-backup-journal.timer'), /^Persistent=false$/m);
    for (const [service, mode, timeout] of [['risepath-backup.service', 'daily', 3600], ['risepath-backup-journal.service', 'journal', 300]]) {
      const text = unit(/** @type {string} */ (service));
      assert.match(text, /^OnFailure=risepath-backup-alert@%n\.service$/m, `${service}: OnFailure`);
      assert.match(text, new RegExp(`^ExecStart=/opt/risepath/deploy/risepath-vm/scripts/backup\\.sh ${mode}$`, 'm'));
      assert.match(text, /^Type=oneshot$/m);
      assert.match(text, /^UMask=0077$/m);
      assert.match(text, /^Requires=docker\.service$/m);
      assert.match(text, new RegExp(`^TimeoutStartSec=${timeout}$`, 'm'));
      assert.match(text, /^WorkingDirectory=\/opt\/risepath\/deploy\/risepath-vm$/m);
    }
    const alert = unit('risepath-backup-alert@.service');
    assert.match(alert, /^ExecStart=\/opt\/risepath\/deploy\/risepath-vm\/scripts\/backup\.sh alert %i$/m);
    assert.match(alert, /^TimeoutStartSec=60$/m);
    assert.doesNotMatch(code(alert), /OnFailure/, 'no alert loop');
    for (const f of UNITS) assert.ok(SCRIPT.install.includes(f), `install-backup.sh installs ${f}`);
  });
  it('install-backup.sh: --new-key never replaces a key; --import-key stops before the timers; key-id and check-copy only read', async () => {
    const newKey = SCRIPT.install.slice(SCRIPT.install.indexOf('if [[ "${NEW_KEY}" == 1 ]]; then'), SCRIPT.install.indexOf('elif [[ "${IMPORT_KEY}" == 1 ]]; then'));
    assert.ok(newKey.indexOf('[[ ! -e "${BK_KEY}" ]] || bk_fail IB5') < newKey.indexOf('write_key'), 'refused before writing when a key exists');
    const importKey = SCRIPT.install.slice(SCRIPT.install.indexOf('elif [[ "${IMPORT_KEY}" == 1 ]]; then'), SCRIPT.install.indexOf('elif [[ ! -e "${BK_KEY}" ]]; then'));
    assert.match(importKey, /OK=1\n\s+exit 0\n$/, 'the import branch ends the script');
    assert.doesNotMatch(importKey, /systemctl/);
    assert.ok(SCRIPT.install.indexOf('systemctl enable --now') > SCRIPT.install.indexOf('elif [[ ! -e "${BK_KEY}" ]]; then'));
    assert.match(SCRIPT.install, /IFS= read -rs -u 3 pasted/, 'the pasted key is not echoed');
    assert.match(SCRIPT.install, /printf '%s\\n' "\$\{PASTED_KEY\}" \| bk_crypt_plain key-id --stdin/, 'the key reaches the container through a pipe');
  });
  it('restore-drill.sh: the throwaway database has no network and is removed (with its volume) by the trap', async () => {
    assert.match(SCRIPT.drill, /docker run -d --name "\$\{DRILL_DB\}" --label risepath\.drill=1 --network none/);
    const trap = SCRIPT.drill.slice(SCRIPT.drill.indexOf('on_exit() {'), SCRIPT.drill.indexOf('trap on_exit EXIT'));
    assert.match(trap, /docker rm -f -v "\$\{DRILL_DB\}"/);
    // Review round 1, finding 8: only a container that carries the drill's label is ever removed.
    assert.match(trap, /\[\[ "\$\{STARTED_DB\}" == 1 \]\] && drill_ours && ! docker rm -f -v "\$\{DRILL_DB\}"/);
    assert.match(SCRIPT.drill, /drill_ours\(\) \{ \[\[ "\$\(docker inspect --format '\{\{index \.Config\.Labels "risepath\.drill"\}\}' "\$\{DRILL_DB\}"/);
    assert.match(SCRIPT.drill, /-e POSTGRES_PASSWORD "\$\{DB_IMAGE\}"/, 'the password by name from the environment, never on the command line');
  });
  it('restore-db.sh: needs the confirmation flag; deploy-stack.sh and preflight.sh only through as_owner (runuser), never as root', async () => {
    assert.match(SCRIPT.restore, /\[\[ "\$\{CONFIRMED\}" == 1 \]\] \|\| bk_fail RS0/);
    assert.match(SCRIPT.restore, /as_owner\(\) \{ runuser -u "\$\{OWNER\}" -- "\$@"; \}/);
    const calls = code(SCRIPT.restore).split('\n').filter((l) => /(?:deploy-stack|preflight)\.sh/.test(l) && !/^\s*echo /.test(l));
    assert.ok(calls.length >= 2);
    for (const line of calls) assert.match(line, /^\s*(?:if ! )?as_owner "\$\{SCRIPT_DIR\}\/(?:deploy-stack|preflight)\.sh"/, line.trim());
    assert.match(SCRIPT.restore, /"\$\{OWNER\}" != root/, 'a root-owned checkout is refused');
    assert.doesNotMatch(SCRIPT.restore, /mcp_remote_role\.sql/, 'RS9 is not in Phase 9 (TR9d)');
  });
  it('the bash code table equals scripts/deploy/backup-codes.mjs (code, level, title, fix)', async () => {
    const table = [...SCRIPT.common.matchAll(/^ {2}'([A-Z]{2}\d{1,2})\|([EW])\|([^|]+)\|([^']+)'$/gm)].map((m) => ({ code: m[1], level: m[2], title: m[3], fix: m[4] }));
    assert.deepEqual(table, BACKUP_CODES.map((c) => ({ ...c })));
    for (const c of BACKUP_CODES) {
      for (const text of [c.title, c.fix]) {
        assert.match(text, /[。）]$/, `${c.code}: ${text}`);
        assert.doesNotMatch(text, /だ。|である。/);
      }
    }
    assert.deepEqual(BACKUP_CODES.map((c) => c.code), ['BK1', 'BK2', 'BK3', 'BK4', 'BK5', 'BK6', 'BK7', 'BK8', 'JO1', 'JO2', 'IB0', 'IB1', 'IB2', 'IB3', 'IB4', 'IB5',
      'DR0', 'DR1', 'DR2', 'DR3', 'DR4', 'DR5', 'DR6', 'DR7', 'RS0', 'RS1', 'RS2', 'RS3', 'RS4', 'RS5', 'RS6', 'RS7', 'RS8', 'RS10', 'RS11']);
    // Review round 1: DR1's fix covers each of its reasons (finding 24); BK2 and RS2 name the folder and what a working
    // DB looks like (finding 19).
    const fixOf = (/** @type {string} */ c) => String(BACKUP_CODES.find((b) => b.code === c)?.fix);
    assert.match(fixOf('DR1'), /「わけ」がトークンかサービスアカウントの役割のときは、サービスアカウントの 2 つの役割を見直します（手順書 3\.8）。控えがまだないときは、手順書 6\.4 の最初の控えを先にします。$/);
    assert.match(fixOf('BK2'), /`cd \/opt\/risepath\/deploy\/risepath-vm && docker compose --env-file stack\.env ps` で見ます（db の行の STATUS に healthy とあれば動いています）。/);
    assert.match(fixOf('RS2'), /^`cd \/opt\/risepath\/deploy\/risepath-vm && docker compose --env-file stack\.env ps` で出た行/);
    // Review round 2: IB4 and BK7 name 手順書 4.1's commands for a VM made without BACKUP_SA_EMAIL (finding 16); JO2 names the
    // lifecycle, not a fixed 30 days (finding 9); RS10 puts the boot unit back (finding 2).
    for (const c of ['IB4', 'BK7']) assert.ok(fixOf(c).includes('VM を BACKUP_SA_EMAIL なしで作ったときは、手順書 4.1 の 3 つのコマンドで控えのサービスアカウントを付けます。'), c);
    // Review round 3: JO2 gives no fixed number of days (the script prints BACKUP_RETENTION_DAYS as its reason; finding 8);
    // RS8 covers exit 1 too (finding 1); RS1 owns the marker, also the rewrite right before RS5 (finding 10).
    assert.match(fixOf('JO2'), /バケットのライフサイクルの日数（backup\.env の BACKUP_RETENTION_DAYS の日数。「わけ」の行に出ます）を過ぎると/);
    for (const c of BACKUP_CODES) assert.doesNotMatch(`${c.title}${c.fix}`, /いまは|\d+ 日/, c.code);
    assert.match(fixOf('RS8'), /終わりの番号が 3/);
    assert.match(fixOf('RS8'), /終わりの番号が 1。何行目かが出ます/);
    assert.match(String(BACKUP_CODES.find((b) => b.code === 'RS1')?.title), /^戻しの途中の印を書くか、/);
    assert.match(fixOf('RS10'), /^`sudo systemctl enable risepath-stack\.service` と `sudo systemctl start risepath-backup\.timer risepath-backup-journal\.timer` を実行し/);
    // Every code a script prints is in the catalog.
    const used = new Set(Object.values(SCRIPT).flatMap((t) => [...code(t).matchAll(/\bbk_(?:fail|say) ([A-Z]{2}\d{1,2})\b/g)].map((m) => m[1])));
    for (const c of used) assert.ok(BACKUP_CODES.some((b) => b.code === c), c);
  });
  it('the 事前チェック\'s backup rules name the script that fixes them, now that it exists (R3 → restore-drill.sh, R6 → install-backup.sh; design §2.5)', async () => {
    const fix = (/** @type {string} */ c) => String(RULES.find((r) => r.code === c)?.fix);
    assert.equal(fix('R3'), '`sudo ./scripts/restore-drill.sh` を実行します（手順書 16.1）。');
    assert.equal(fix('R6'), 'stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書いてから、`sudo ./scripts/install-backup.sh` をもう一度実行します（手順書 6.4）。');
    for (const c of ['R3', 'R6']) {
      const script = /\.\/scripts\/([\w-]+\.sh)/.exec(fix(c))?.[1];
      assert.ok(script && fs.existsSync(path.join(STACK, 'scripts', script)), `${c}: ${script}`);
    }
  });
  it('backup.env.example: the four names, each after a Japanese comment; nothing secret', async () => {
    const text = read('deploy/risepath-vm/backup.env.example');
    const names = text.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
    assert.deepEqual(names, ['BACKUP_BUCKET=', 'BACKUP_KEEP_LOCAL_DAYS=3', 'BACKUP_RETENTION_DAYS=30', 'BACKUP_ALERT_WEBHOOK_URL=']);
    for (const line of names) assert.match(text.split('\n')[text.split('\n').indexOf(line) - 1], /^# .*[ぁ-んァ-ン一-龥]/);
    // Review round 1, finding 22: the header never calls the file secret-free while it can hold a webhook URL.
    assert.doesNotMatch(text, /This file holds no secret/);
    assert.match(text, /^# No secret unless BACKUP_ALERT_WEBHOOK_URL is set: that is a Slack webhook URL, so never print, paste or share the$/m);
    // Review round 2, finding 11: the owner opens it with nano, so the header says what to write and when it is secret in Japanese.
    const head = text.split('\n').slice(0, 3).join('\n');
    assert.match(head, /^# 書き方: BACKUP_BUCKET= のうしろにバケットの名前を書いて保存し、install-backup\.sh を、前と同じ指定でもう一度実行します（手順書 6\.4）。$/m);
    assert.match(head, /^# BACKUP_ALERT_WEBHOOK_URL を書いたら、このファイルは秘密です（画面に出したり、どこかに貼ったりしません）。$/m);
  });
  it('provision-gce.sh: BACKUP_SA_EMAIL gives the service account and scope cloud-platform; unset, a warning and the later command', async () => {
    const text = read('deploy/risepath-vm/scripts/provision-gce.sh');
    assert.match(text, /SA_FLAGS=\(--service-account="\$\{BACKUP_SA_EMAIL\}" --scopes=cloud-platform\)/);
    assert.match(text, /--metadata=enable-oslogin=TRUE \\\n\s+\$\{SA_FLAGS\[@\]\+"\$\{SA_FLAGS\[@\]\}"\}/);
    assert.match(text, /gcloud compute instances set-service-account \$\{VM_NAME\}/);
    assert.ok(text.indexOf('BACKUP_SA_EMAIL is not a service account address') < text.indexOf('gcloud config set project'), 'checked before any gcloud call');
  });
});

describe('provision-gce.sh with a gcloud stub (review round 1, finding 23)', { skip }, () => {
  /** Runs provision-gce.sh with a gcloud that logs its calls; `exists` answers describe for the VM. @param {Record<string, string>} env @param {boolean} exists */
  const provision = (env, exists) => {
    const dir = fs.mkdtempSync(path.join(harness().dir, 'gce-'));
    const log = path.join(dir, 'gcloud.log');
    fs.writeFileSync(path.join(dir, 'gcloud'), `#!/usr/bin/env bash\necho "gcloud $*" >> "${log}"\nif [[ "$1 $2 $3" == "compute instances describe" ]]; then exit ${exists ? 0 : 1}; fi\nif [[ "$2 $3" == "resource-policies describe" ]]; then exit 0; fi\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(log, '');
    const r = spawnSync('bash', [path.join(STACK, 'scripts/provision-gce.sh')], { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}`, HOME: dir, GCP_PROJECT: 'demo-proj', ...env }, encoding: 'utf8' });
    return { ...r, calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  };
  const SA = 'risepath-backup@demo-proj.iam.gserviceaccount.com';
  it('an existing VM with BACKUP_SA_EMAIL: nothing changed, the stop / set-service-account / start commands for that account, in Japanese first', () => {
    const r = provision({ BACKUP_SA_EMAIL: SA }, true);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ℹ️  VM はもうあるので、サービスアカウントはここでは変えていません。BACKUP_SA_EMAIL のアカウントにするときは、$/m);
    assert.match(r.stdout, /gcloud compute instances stop risepath-vm --zone=asia-northeast1-b\n\s+gcloud compute instances set-service-account risepath-vm --zone=asia-northeast1-b \\\n\s+--service-account=risepath-backup@demo-proj\.iam\.gserviceaccount\.com --scopes=cloud-platform\n\s+gcloud compute instances start risepath-vm/);
    assert.ok(!r.calls.some((c) => /instances (create|stop|set-service-account|start)/.test(c)), r.calls.join('\n'));
  });
  it('a new VM without BACKUP_SA_EMAIL: the Japanese warning and the three commands; a bad address stops before any gcloud call with a Japanese line', () => {
    const r = provision({}, false);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^⚠️  BACKUP_SA_EMAIL がないので、VM は GCE のふつうのサービスアカウントで動きます。これでは控えを送れません。$/m);
    assert.match(r.stdout, /--service-account=risepath-backup@demo-proj\.iam\.gserviceaccount\.com --scopes=cloud-platform/);
    assert.ok(r.calls.some((c) => c.startsWith('gcloud compute instances create risepath-vm')));
    const bad = provision({ BACKUP_SA_EMAIL: 'not-an-address' }, false);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /^❌ BACKUP_SA_EMAIL が、サービスアカウントの形（名前@プロジェクト\.iam\.gserviceaccount\.com）ではありません。/m);
    assert.deepEqual(bad.calls, []);
  });
});

describe('backup.sh daily: the order, the manifest, the token (stub harness)', { skip, concurrency: true }, () => {
  it('lock → counts → dump → counts → uploads → manifest and its sealed copy → db and uploads up, each size checked → sealed copy, manifest up, size checked → status lastOk', async () => {
    const h = harness();
    const r = await h.run('backup.sh', ['daily']);
    assert.equal(r.status, 0, r.out);
    const calls = h.calls();
    // The two sides of a pipe start together, so only the producers are ordered; each pipe has its crypt step, and the
    // manifest is sealed once.
    assert.equal(calls.filter((c) => c === 'crypt encrypt --key /key/backup.key').length, 3);
    inOrder(calls, ['flock -n 9', 'counts', 'pg_dump', 'counts', 'tar create', 'schema_migrations', 'crypt encrypt',
      'curl token', 'curl put daily/', 'curl size daily/', 'curl put daily/', 'curl size daily/', 'curl put daily/', 'curl size daily/', 'curl put daily/', 'curl size daily/', 'flock -w 30 8']);
    const gcs = calls.filter((c) => /^curl (put|size) /.test(c)).map((c) => c.replace(/daily\/[^/]+\//, ''));
    assert.deepEqual(gcs, ['curl put db.dump.rpbk', 'curl size db.dump.rpbk', 'curl put uploads.tar.rpbk', 'curl size uploads.tar.rpbk',
      'curl put manifest.json.rpbk', 'curl size manifest.json.rpbk', 'curl put manifest.json', 'curl size manifest.json']);
    assert.match(String(calls.filter((c) => c.startsWith('curl put')).at(-1)), /\/manifest\.json$/, 'the manifest after the files');
    // Review round 1, finding 3: a fresh token right before every upload and every size read (one token lasts about
    // an hour; one upload may take up to an hour).
    calls.forEach((c, i) => { if (/^curl (put|size) /.test(c)) assert.equal(calls[i - 1], 'curl token', `a fresh token before ${c}`); });
    const status = h.status();
    assert.match(String(status.lastOk), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(status.alert, true);
    // Review round 2, finding 14: Japan time, as 13 章 says (the object stamp is UTC).
    const stamp = h.objects('daily/')[0].split('/')[1];
    const jst = new Date(Date.parse(stamp.replace(/^(\d{4}-\d\d-\d\dT)(\d\d)(\d\d)(\d\d)Z$/, '$1$2:$3:$4Z')) + 9 * 3_600_000).toISOString().replace(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d).*$/, '$1 $2');
    assert.match(r.stdout, /^✅ 毎日の控えができました（日本時間 \d{4}-\d\d-\d\d \d\d:\d\d、DB .+、ファイル 3 個、key id [0-9a-f]{16}）。$/m);
    assert.ok(r.stdout.includes(`✅ 毎日の控えができました（日本時間 ${jst}、`), r.stdout);
    noJsonLog(h);
    noToken(h, r.out);
  });
  it('the manifest (rpbk-manifest/1): exactly these keys, the sizes and SHA-256 of the uploaded files, the key id, no personal data; the set decrypts', async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    const [dump, manifestName, sealedName, uploads] = h.objects('daily/');
    assert.match(sealedName, /\/manifest\.json\.rpbk$/);
    const manifest = JSON.parse(fs.readFileSync(path.join(h.bucket, manifestName), 'utf8'));
    // The sealed copy is the manifest, byte for byte, encrypted with the VM key (review round 1, finding 1).
    assert.deepEqual(h.decrypt(path.join(h.bucket, sealedName)), fs.readFileSync(path.join(h.bucket, manifestName)));
    assert.deepEqual(Object.keys(manifest), ['format', 'createdAt', 'dumpStartedAt', 'dumpFinishedAt', 'commit', 'keyId', 'migrations', 'tables', 'countsBefore',
      'countsAfter', 'dbDumpBytes', 'dbDumpSha256', 'uploadsBytes', 'uploadsSha256', 'uploadsFileCount']);
    assert.equal(manifest.format, 'rpbk-manifest/1');
    assert.equal(manifest.commit, 'c'.repeat(40));
    assert.deepEqual(manifest.migrations, MIGRATIONS);
    assert.deepEqual(manifest.countsBefore, COUNTS.split(',').map(Number));
    assert.equal(manifest.tables.length, 9);
    assert.equal(manifest.uploadsFileCount, 3);
    const sha = (/** @type {string} */ f) => spawnSync('sha256sum', [f], { encoding: 'utf8' }).stdout.split(' ')[0];
    assert.equal(manifest.dbDumpBytes, fs.statSync(path.join(h.bucket, dump)).size);
    assert.equal(manifest.dbDumpSha256, sha(path.join(h.bucket, dump)));
    assert.equal(manifest.uploadsSha256, sha(path.join(h.bucket, uploads)));
    const keyId = spawnSync(process.execPath, [path.join(ROOT, 'scripts/deploy/backup-crypt.mjs'), 'key-id', '--stdin'], { input: KEY_HEX, encoding: 'utf8' }).stdout.trim();
    assert.equal(manifest.keyId, keyId);
    assert.equal(h.decrypt(path.join(h.bucket, dump)).subarray(0, 5).toString(), 'PGDMP');
    assert.equal(h.decrypt(path.join(h.bucket, uploads)).subarray(0, 7).toString(), 'FAKETAR');
    assert.equal(fs.statSync(path.join(h.root, 'var/backups/risepath')).mode & 0o777, 0o700);
  });
  it('a failure inside a function (the counts after the dump) → lastFail and the step recorded, exit ≠ 0, nothing uploaded, no alert from the script', async () => {
    const h = harness();
    h.setStatus({ lastOk: hoursAgo(20) });
    const r = await h.run('backup.sh', ['daily'], { env: { STUB_COUNTS_FAIL_AT: '2' } });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /^❌ \[BK4\] /m);
    assert.equal(h.status().lastFailStep, 'BK4');
    assert.ok(h.status().lastFail);
    assert.equal(h.status().lastOk, hoursAgo(20).slice(0, 13) + h.status().lastOk?.toString().slice(13), 'lastOk unchanged');
    assert.equal(h.calls().filter((c) => c.startsWith('curl put')).length, 0);
    assert.deepEqual(h.webhooks(), [], 'the trap never posts');
  });
  it('a failed dump → BK3, no upload, no partial file left', async () => {
    const h = harness();
    const r = await h.run('backup.sh', ['daily'], { env: { STUB_DUMP_FAIL: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[BK3\] [\s\S]*わけ: pg_dump（1）か暗号化（0）が 0 で終わりませんでした。/m);
    assert.equal(h.status().lastFailStep, 'BK3');
    assert.equal(h.calls().filter((c) => c.startsWith('curl')).length, 0);
    const local = path.join(h.root, 'var/backups/risepath');
    const files = fs.readdirSync(local).flatMap((d) => fs.readdirSync(path.join(local, d)));
    assert.deepEqual(files, [], 'no .part and no dump');
  });
  it('the db file\'s upload fails or its size does not match → BK7; the manifest is never uploaded; lastOk unchanged', async () => {
    for (const env of [{ STUB_UPLOAD_FAIL: 'db.dump' }, { STUB_SIZE_LIE: 'uploads.tar' }]) {
      const h = harness();
      const r = await h.run('backup.sh', ['daily'], { env });
      assert.equal(r.status, 1, JSON.stringify(env));
      assert.match(r.stdout, /^❌ \[BK7\] /m);
      assert.equal(h.status().lastFailStep, 'BK7');
      assert.equal(h.status().lastOk, undefined);
      assert.deepEqual(h.objects().filter((n) => n.endsWith('manifest.json')), []);
      noToken(h, r.out);
    }
  });
  it('SIGTERM in the middle of the dump (TimeoutStartSec) → lastFail recorded with the step, exit 143', async () => {
    const h = harness();
    const child = h.start('backup.sh', ['daily'], { env: { STUB_DUMP_SLEEP: '20' } });
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    for (let i = 0; i < 200 && !h.calls().some((c) => c.includes('pg_dump')); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(h.calls().some((c) => c.includes('pg_dump')), 'reached the dump');
    process.kill(-/** @type {number} */ (child.pid), 'SIGTERM');
    const code = await new Promise((resolve) => child.on('exit', (c, sig) => resolve(c ?? sig)));
    assert.equal(code, 143, out);
    assert.equal(h.status().lastFailStep, 'BK3');
    assert.match(out, /❌ \[BK3\] [\s\S]*途中で止まりました/);
    assert.deepEqual(h.webhooks(), []);
  });
  it('the lock is held by another run → exit 0 with one line, nothing done or recorded', async () => {
    const h = harness();
    const r = await h.run('backup.sh', ['daily'], { env: { STUB_FLOCK_BUSY: '1' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ほかの控えの処理が動いているので、今回はしません/);
    assert.equal(h.calls().filter((c) => c.startsWith('compose') || c.startsWith('curl')).length, 0);
    assert.equal(h.status().lastFail, undefined);
  });
  it('BK1: no bucket, no key, an unhealthy db, too little disk — each stops before anything is made, recorded, with its reason', async () => {
    const cases = [
      [{ backupEnv: 'BACKUP_BUCKET=Bad_Bucket\n' }, {}, 'バケットの名前'],
      [{ key: null }, {}, '鍵（/etc/risepath-backup/backup.key）がありません'],
      [{}, { STUB_DB_HEALTH: 'starting' }, 'healthy ではありません'],
      [{}, { STUB_DF_KB: '1000' }, 'ディスクの空きが足りません'],
    ];
    for (const [opts, env, reason] of cases) {
      const h = harness(/** @type {any} */ (opts));
      const r = await h.run('backup.sh', ['daily'], { env: /** @type {Record<string, string>} */ (env) });
      assert.equal(r.status, 1, String(reason));
      assert.match(r.stdout, new RegExp(`❌ \\[BK1\\][\\s\\S]*わけ: .*${String(reason).replace(/[()（）/.]/g, '.')}`), String(reason));
      assert.equal(h.status().lastFailStep, 'BK1');
      assert.equal(h.calls().filter((c) => c.includes('pg_dump')).length, 0);
    }
  });
  it('alert: false is recorded when no https webhook resolves (R6), and the backup itself still runs', async () => {
    const h = harness({ stackEnv: 'NODE_ENV=production\nAI_CAP_ALERT_WEBHOOK_URL=http://hooks.slack.com/x\n' });
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    assert.equal(h.status().alert, false);
    const o = harness({ backupEnv: `BACKUP_BUCKET=${BUCKET}\nBACKUP_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T/B/override\n`, stackEnv: 'NODE_ENV=production\n' });
    assert.equal((await o.run('backup.sh', ['daily'])).status, 0);
    assert.equal(o.status().alert, true, 'backup.env\'s override');
  });
  it('--local-only: refused unless stack.env is the CI template byte for byte; with it, project risepath-ci, nothing uploaded or recorded', async () => {
    const h = harness();
    const out = path.join(h.dir, 'out');
    const refused = await h.run('backup.sh', ['daily', '--local-only', '--out', out]);
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /--local-only は、stack\.env が CI の型/);
    const ci = harness({ stackEnv: fs.readFileSync(path.join(STACK, 'ci/stack.ci.env'), 'utf8'), backupEnv: null });
    const r = await ci.run('backup.sh', ['daily', '--local-only', '--out', out]);
    assert.equal(r.status, 0, r.out);
    assert.ok(ci.calls().every((c) => !c.startsWith('compose[') || c.startsWith('compose[risepath-ci]')), 'project risepath-ci');
    assert.equal(ci.calls().filter((c) => c.startsWith('curl')).length, 0);
    assert.deepEqual(ci.status(), {});
    const [set] = fs.readdirSync(out);
    assert.deepEqual(fs.readdirSync(path.join(out, set)).sort(), ['db.dump.rpbk', 'manifest.json', 'manifest.json.rpbk', 'uploads.tar.rpbk']);
    assert.equal((await ci.run('backup.sh', ['daily', '--out', out])).status, 1, '--out alone is refused');
  });
});

describe('backup.sh daily: review round 1 of Stage 5 (findings 5, 6, 7, 11)', { skip, concurrency: true }, () => {
  it('BK1 counts the last uploads archive too: room for twice the last set (dump and uploads) and 1 GiB (finding 5)', async () => {
    const h = harness();
    const last = path.join(h.root, 'var/backups/risepath/2026-01-01T000000Z');
    fs.mkdirSync(last, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(last, 'db.dump.rpbk'), Buffer.alloc(1024));
    fs.writeFileSync(path.join(last, 'uploads.tar.rpbk'), '');
    fs.truncateSync(path.join(last, 'uploads.tar.rpbk'), 1024 ** 3); // sparse: a 1 GiB archive that takes no room here
    // need = 2 × (1 KiB + 1 GiB) + 1 GiB = 3 145 730 KiB; the dump alone would need 1 048 578.
    const short = await h.run('backup.sh', ['daily'], { env: { STUB_DF_KB: '3000000' } });
    assert.equal(short.status, 1, short.out);
    assert.match(short.stdout, /^❌ \[BK1\][\s\S]*わけ: ディスクの空きが足りません（要るのは 4 GB ほどです）。/m);
    assert.equal(h.calls().filter((c) => c.includes('pg_dump')).length, 0);
    assert.equal((await h.run('backup.sh', ['daily'], { env: { STUB_DF_KB: '3200000' } })).status, 0);
  });
  it('BK5: tar failing (a short archive in a valid rpbk file) or no uploads volume → BK5, nothing uploaded, no .part left (finding 11)', async () => {
    for (const [env, reason] of [[{ STUB_TAR_FAIL: '1' }, 'tar（2）か暗号化（0）が 0 で終わりませんでした。'], [{ STUB_VOLUME: '' }, 'uploads のボリュームが見つかりません（最初のデプロイの前です）。']]) {
      const h = harness();
      const r = await h.run('backup.sh', ['daily'], { env: /** @type {Record<string, string>} */ (env) });
      assert.equal(r.status, 1, r.out);
      assert.ok(r.stdout.includes(`❌ [BK5] `) && r.stdout.includes(`わけ: ${reason}`), r.out);
      assert.equal(h.status().lastFailStep, 'BK5');
      assert.equal(h.calls().filter((c) => c.startsWith('curl put')).length, 0);
      const local = path.join(h.root, 'var/backups/risepath');
      const files = fs.readdirSync(local).flatMap((d) => fs.readdirSync(path.join(local, d)));
      assert.deepEqual(files.filter((f) => f.endsWith('.part') || f.startsWith('uploads')), [], 'no partial archive');
    }
  });
  it('BK8 also removes old work folders of a drill or a restore, and pre-restore exports after BACKUP_RETENTION_DAYS; young ones stay (finding 7)', async () => {
    const h = harness();
    const local = path.join(h.root, 'var/backups/risepath');
    const days = (/** @type {number} */ n) => new Date(Date.now() - n * 86_400_000);
    /** @type {Array<[string, number, boolean]>} name, age in days, kept */
    const dirs = [['2026-01-01T000000Z', 4, false], ['drill-2026-01-01T000000Z', 4, false], ['restore-2026-01-01T000000Z', 4, false],
      ['pre-restore-2026-01-01t000000z', 31, false], ['pre-restore-2026-02-01t000000z', 29, true], ['restore-2026-03-01T000000Z', 2, true],
      ['drill-2026-03-01T000000Z', 2, true], ['journal', 40, true]];
    for (const [name, age] of dirs) {
      fs.mkdirSync(path.join(local, name), { recursive: true });
      fs.writeFileSync(path.join(local, name, 'x'), 'x');
      fs.utimesSync(path.join(local, name), days(age), days(age));
    }
    const r = await h.run('backup.sh', ['daily']);
    assert.equal(r.status, 0, r.out);
    for (const [name, , kept] of dirs) assert.equal(fs.existsSync(path.join(local, name)), kept, name);
  });
  it('the alert URL: the first https URL of the three (a rejected one is passed over, as K1 does); a query string is accepted (finding 6)', async () => {
    const SAFETY = 'https://hooks.slack.com/services/T9/B9/safety';
    const cases = [
      // [backup.env override, stack.env, the URL that gets the alert]
      ['', `AI_CAP_ALERT_WEBHOOK_URL=http://hooks.slack.com/x\nSAFETY_ALERT_WEBHOOK_URL=${SAFETY}\n`, SAFETY],
      ['', 'AI_CAP_ALERT_WEBHOOK_URL=https://alerts.example.org/hook?channel=ops&token=abc\n', 'https://alerts.example.org/hook?channel=ops&token=abc'],
      ['BACKUP_ALERT_WEBHOOK_URL=ftp://x/y\n', `AI_CAP_ALERT_WEBHOOK_URL=${WEBHOOK}\n`, WEBHOOK],
      ['BACKUP_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T8/B8/backup\n', `AI_CAP_ALERT_WEBHOOK_URL=${WEBHOOK}\n`, 'https://hooks.slack.com/services/T8/B8/backup'],
    ];
    for (const [override, stack, want] of cases) {
      const h = harness({ backupEnv: `BACKUP_BUCKET=${BUCKET}\n${override}`, stackEnv: `NODE_ENV=production\n${stack}` });
      assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
      assert.equal(h.status().alert, true, want);
      h.setStatus({ lastFail: hoursAgo(0.1), lastFailStep: 'BK7' });
      assert.equal((await h.run('backup.sh', ['alert', 'risepath-backup.service'])).status, 0);
      assert.equal(h.webhooks()[0]?.url, want);
    }
    const none = harness({ stackEnv: 'NODE_ENV=production\nAI_CAP_ALERT_WEBHOOK_URL=http://hooks.slack.com/x\nSAFETY_ALERT_WEBHOOK_URL=hooks.slack.com/y\n' });
    assert.equal((await none.run('backup.sh', ['daily'])).status, 0);
    assert.equal(none.status().alert, false, 'no https URL at all');
  });
});

describe('backup.sh journal, probe, alert (stub harness)', { skip, concurrency: true }, () => {
  it('journal: the five kinds of deletion records, encrypted, to journal/<day>/<stamp>.csv.rpbk; the window is retention + 10 days', async () => {
    const h = harness({ backupEnv: `BACKUP_BUCKET=${BUCKET}\nBACKUP_RETENTION_DAYS=45\n` });
    h.setStatus({ lastOk: hoursAgo(1) });
    const csv = `${JOURNAL_HEADER}\naccount,aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa,2026-11-02T03:30:00.000000Z,self,,,,\n`;
    fs.writeFileSync(path.join(h.stubDir, 'journal.csv'), csv);
    const r = await h.run('backup.sh', ['journal']);
    assert.equal(r.status, 0, r.out);
    const [object] = h.objects('journal/');
    assert.match(object, /^journal\/\d{4}-\d\d-\d\d\/\d{4}-\d\d-\d\dT\d{6}Z-[0-9a-f]{6}\.csv\.rpbk$/);
    assert.equal(h.decrypt(path.join(h.bucket, object)).toString(), csv);
    const sql = fs.readFileSync(path.join(h.stubDir, 'last-journal.sql'), 'utf8');
    for (const table of ['account_deletions', 'lesson_progress_resets', 'lesson_progress_lesson_resets', 'account_consents', 'mcp_oauth_grants']) assert.ok(sql.includes(`FROM ${table}`), table);
    for (const kind of ['account', 'progress', 'lesson', 'consent', 'grant']) assert.ok(sql.includes(`'${kind}'`), kind);
    assert.equal((sql.match(/interval '55 days'/g) ?? []).length, 5);
    assert.match(sql, /TO STDOUT WITH \(FORMAT csv, HEADER\)/);
    assert.doesNotMatch(sql, /%[A-Z]+/, 'every placeholder replaced');
    // The quotes survive bash's ${x//p/r} (the CI-stack rehearsal found them stripped: a syntax error in Postgres).
    assert.equal((sql.match(/to_char\((?:deleted_at|reopened_at|reset_at|revoked_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD'\) \|\| 'T' \|\| to_char\((?:deleted_at|reopened_at|reset_at|revoked_at) AT TIME ZONE 'UTC', 'HH24:MI:SS\.US'\) \|\| 'Z'/g) ?? []).length, 6);
    assert.match(sql, /^ {2}SELECT 'account' AS kind, user_id::text AS user_id, to_char\(deleted_at AT/m);
    assert.ok(h.status().journalLastOk);
    assert.deepEqual(h.webhooks(), []);
    // Review round 2, finding 14: the ✅ line in Japan time (the object name keeps the UTC stamp).
    const stamp = /\/(\d{4}-\d\d-\d\dT\d{6}Z)-/.exec(object)?.[1] ?? '';
    const jst = new Date(Date.parse(stamp.replace(/^(\d{4}-\d\d-\d\dT)(\d\d)(\d\d)(\d\d)Z$/, '$1$2:$3:$4Z')) + 9 * 3_600_000).toISOString().replace(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d).*$/, '$1 $2');
    assert.match(r.stdout, new RegExp(`^✅ 削除の記録を控えました（日本時間 ${jst}）。$`, 'm'));
  });
  it('JO2: lastOk 37 hours old → one fixed line, staleAlertAt written; not again within 12 hours; again after 12 hours; never for a fresh backup', async () => {
    const h = harness();
    h.setStatus({ lastOk: hoursAgo(37) });
    assert.equal((await h.run('backup.sh', ['journal'])).status, 0);
    assert.deepEqual(h.webhooks().map((w) => JSON.parse(w.payload)), [{
      text: '【Rise Path】毎日の控え（バックアップ）が 36 時間できていません。VM で `sudo journalctl -u risepath-backup -n 50` を見てください（手順書 17 章）。',
      content: '【Rise Path】毎日の控え（バックアップ）が 36 時間できていません。VM で `sudo journalctl -u risepath-backup -n 50` を見てください（手順書 17 章）。',
    }]);
    assert.equal(h.webhooks()[0].url, WEBHOOK);
    assert.ok(h.status().staleAlertAt);
    h.reset();
    assert.equal((await h.run('backup.sh', ['journal'])).status, 0);
    assert.deepEqual(h.webhooks(), [], 'not again within 12 hours');
    h.setStatus({ lastOk: hoursAgo(50), staleAlertAt: hoursAgo(13) });
    h.reset();
    const again = await h.run('backup.sh', ['journal']);
    assert.equal(h.webhooks().length, 1, 'again after 12 hours');
    noToken(h, again.out);
    const fresh = harness();
    fresh.setStatus({ lastOk: hoursAgo(35) });
    assert.equal((await fresh.run('backup.sh', ['journal'])).status, 0);
    assert.deepEqual(fresh.webhooks(), []);
  });
  it('JO2 with no backup ever: alerts only while the daily timer is enabled', async () => {
    const on = harness();
    assert.equal((await on.run('backup.sh', ['journal'])).status, 0);
    assert.equal(on.webhooks().length, 1);
    const off = harness();
    assert.equal((await off.run('backup.sh', ['journal'], { env: { STUB_TIMERS_ENABLED: '' } })).status, 0);
    assert.deepEqual(off.webhooks(), []);
  });
  it('a failed journal export records journalLastFail (not the daily lastFail) and exits ≠ 0', async () => {
    const h = harness();
    const r = await h.run('backup.sh', ['journal'], { env: { STUB_JOURNAL_FAIL: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[JO1\] /m);
    assert.equal(h.status().journalLastFailStep, 'JO1');
    assert.equal(h.status().lastFail, undefined);
  });
  it('journal --keep-local <name>: also kept under /var/backups/risepath/<name>; a bucket failure is then only a warning', async () => {
    const h = harness();
    const r = await h.run('backup.sh', ['journal', '--keep-local', 'pre-restore-x'], { env: { STUB_UPLOAD_FAIL: 'journal/' } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /削除の記録はこの VM に控えました。バケットには送れませんでした/);
    assert.equal(fs.readdirSync(path.join(h.root, 'var/backups/risepath/pre-restore-x')).length, 1);
    assert.equal((await h.run('backup.sh', ['journal', '--keep-local', '../x'])).status, 1, 'a name, never a path');
  });
  it('probe: one object up and its size read back', async () => {
    const h = harness();
    const r = await h.run('backup.sh', ['probe']);
    assert.equal(r.status, 0, r.out);
    assert.match(h.objects('probe/')[0], /^probe\/\d{4}-\d\d-\d\dT\d{6}Z-[0-9a-f]{6}\.txt$/);
    inOrder(h.calls(), ['curl token', 'curl put probe/', 'curl size probe/']);
    assert.equal((await harness().run('backup.sh', ['probe'], { env: { STUB_TOKEN_FAIL: '1' } })).status, 1);
  });
  it('alert <unit>: the fixed line with the recorded step (or 不明 when the record is old or missing); only the two units', async () => {
    const h = harness();
    h.setStatus({ lastFail: hoursAgo(0.1), lastFailStep: 'BK7', journalLastFail: hoursAgo(5), journalLastFailStep: 'JO1' });
    assert.equal((await h.run('backup.sh', ['alert', 'risepath-backup.service'])).status, 0);
    assert.equal((await h.run('backup.sh', ['alert', 'risepath-backup-journal.service'])).status, 0);
    assert.deepEqual(h.webhooks().map((w) => JSON.parse(w.payload).text), [
      '【Rise Path】控えの処理（risepath-backup.service）が失敗しました（手順 BK7）。VM で `sudo journalctl -u risepath-backup.service -n 50` を見てください（手順書 17 章）。',
      '【Rise Path】控えの処理（risepath-backup-journal.service）が失敗しました（手順 不明）。VM で `sudo journalctl -u risepath-backup-journal.service -n 50` を見てください（手順書 17 章）。',
    ]);
    for (const bad of ['risepath-stack.service', 'x; rm -rf /', '']) assert.equal((await h.run('backup.sh', ['alert', bad])).status, 2, bad);
    const none = harness({ stackEnv: 'NODE_ENV=production\n' });
    assert.equal((await none.run('backup.sh', ['alert', 'risepath-backup.service'])).status, 1);
    const curlLines = h.argv().filter((a) => a[0] === 'curl');
    assert.ok(curlLines.every((a) => a.includes('-K')), 'the URL through -K only');
    noToken(h, '');
  });
});

describe('backup.sh: a webhook that refuses (review round 1, finding 13)', { skip, concurrency: true }, () => {
  it('alert exits 1 with its line; JO2 whose post fails is a warning, the journal still succeeds and staleAlertAt stays', async () => {
    const h = harness();
    h.setStatus({ lastFail: hoursAgo(0.1), lastFailStep: 'BK3' });
    const a = await h.run('backup.sh', ['alert', 'risepath-backup.service'], { env: { STUB_WEBHOOK_FAIL: '1' } });
    assert.equal(a.status, 1);
    assert.match(a.stdout, /^❌ 失敗の知らせを送れませんでした（受け口がないか、Slack が答えません）。$/m);
    const stale = hoursAgo(13);
    h.setStatus({ lastOk: hoursAgo(40), staleAlertAt: stale });
    const j = await h.run('backup.sh', ['journal'], { env: { STUB_WEBHOOK_FAIL: '1' } });
    assert.equal(j.status, 0, j.out);
    assert.match(j.stdout, /⚠️ \[JO2\] [\s\S]*⚠️  JO2 の知らせを送れませんでした（受け口がないか、Slack が答えません）。次の 1 時間で、もう一度送ります。/);
    assert.equal(h.status().staleAlertAt, stale, 'not moved: the next hour tries again');
    assert.equal(h.webhooks().length, 2, 'both posts were tried');
  });
});

describe('restore-drill.sh (stub harness)', { skip, concurrency: true }, () => {
  /** A UTC stamp `hours` hours ago (and its createdAt 5 seconds later). @param {number} hours */
  const stampAgo = (hours) => {
    const t = new Date(Math.floor((Date.now() - hours * 3_600_000) / 1000) * 1000);
    const iso = t.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return { stamp: iso.replace(/:/g, '').replace(/^(\d{4}-\d\d-\d\dT\d{6})Z$/, '$1Z'), created: new Date(t.getTime() + 5000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  };
  /** A harness with one fresh set (made by the real backup.sh), and a helper that copies it under another stamp. */
  const withSets = async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    const stamp = h.objects('daily/')[0].split('/')[1];
    /**
     * Copies the set to another stamp: the two files and the manifest (edited by `edit`, its createdAt set to the stamp
     * + 5 s unless `keepCreated`), resealed with the key unless `seal` is false.
     * @param {string} to @param {(m: string) => string} [edit] @param {{ seal?: boolean, keepCreated?: boolean }} [opts]
     */
    const copy = (to, edit = (m) => m, { seal = true, keepCreated = false } = {}) => {
      const dir = path.join(h.bucket, 'daily', to);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of ['db.dump.rpbk', 'uploads.tar.rpbk', 'manifest.json.rpbk']) fs.copyFileSync(path.join(h.bucket, 'daily', stamp, f), path.join(dir, f));
      let m = fs.readFileSync(path.join(h.bucket, 'daily', stamp, 'manifest.json'), 'utf8');
      const at = Date.parse(to.replace(/^(\d{4}-\d\d-\d\dT)(\d\d)(\d\d)(\d\d)Z$/, '$1$2:$3:$4Z'));
      if (!keepCreated) m = m.replace(/"createdAt": "[^"]+"/, `"createdAt": "${new Date(at + 5000).toISOString().replace(/\.\d{3}Z$/, 'Z')}"`);
      fs.writeFileSync(path.join(dir, 'manifest.json'), edit(m));
      if (seal) h.seal(dir);
      return dir;
    };
    h.reset();
    return { h, stamp, copy };
  };
  it('the newest complete set: a newer set without a manifest, one whose sizes do not match its manifest, and one copied under a stamp its createdAt does not fit are skipped; lastDrillOk recorded', async () => {
    const { h, stamp, copy } = await withSets();
    fs.mkdirSync(path.join(h.bucket, 'daily/2099-01-01T000000Z'), { recursive: true });
    for (const f of ['db.dump.rpbk', 'uploads.tar.rpbk', 'manifest.json.rpbk']) fs.writeFileSync(path.join(h.bucket, 'daily/2099-01-01T000000Z', f), 'partial');
    copy('2098-01-01T000000Z', (m) => m.replace(/"dbDumpBytes": \d+/, '"dbDumpBytes": 12'));
    copy('2097-01-01T000000Z', (m) => m, { keepCreated: true }); // a genuine set under a later stamp (finding 1)
    const r = await h.run('restore-drill.sh', [], { env: { STUB_PAGE: '2' } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /^✅ 戻す練習は成功しました（日本時間 \d{4}-\d\d-\d\d \d\d:\d\d の控え、表 9 つ、ファイル 3 個）。$/m);
    const gets = h.calls().filter((c) => c.startsWith('curl get'));
    assert.deepEqual(gets, ['curl get daily/2098-01-01T000000Z/manifest.json', 'curl get daily/2097-01-01T000000Z/manifest.json', `curl get daily/${stamp}/manifest.json`,
      `curl get daily/${stamp}/manifest.json.rpbk`, `curl get daily/${stamp}/db.dump.rpbk`, `curl get daily/${stamp}/uploads.tar.rpbk`]);
    assert.ok(h.status().lastDrillOk);
    assert.ok(h.status().lastDrillSetAt);
    inOrder(h.calls(), ['crypt decrypt', 'drill db run -d --name risepath-drill-db --label risepath.drill=1 --network none', 'drill pg_restore', 'drill psql SHOW', 'tar list', 'docker rm -f -v risepath-drill-db']);
    assert.ok(h.calls().some((c) => c.startsWith('drill db run') && c.includes('pw=set') && !c.includes('POSTGRES_PASSWORD=')), 'the password by name only');
    assert.ok(h.calls().some((c) => c.startsWith('tar list') && c.endsWith('net=none')));
    assert.deepEqual(fs.readdirSync(path.join(h.root, 'var/backups/risepath')).filter((d) => d.startsWith('drill-')), [], 'the download removed');
  });
  it('DR1: the newest complete set is 37 hours old → fails, records lastDrillFail, never lastDrillOk; the time is Japan time', async () => {
    const { h, stamp, copy } = await withSets();
    const old = stampAgo(37);
    copy(old.stamp);
    fs.rmSync(path.join(h.bucket, 'daily', stamp), { recursive: true });
    const r = await h.run('restore-drill.sh');
    assert.equal(r.status, 1, r.out);
    const jst = new Date(Date.parse(old.created) + 9 * 3_600_000).toISOString().replace(/T(\d\d:\d\d).*$/, ' $1');
    assert.ok(r.stdout.includes(`❌ [DR1] `) && r.stdout.includes(`わけ: いちばん新しい控え（日本時間 ${jst}）が 36 時間より前です`), r.out);
    assert.equal(h.status().lastDrillOk, undefined);
    assert.equal(h.status().lastDrillStep, 'DR1');
    assert.equal(h.calls().filter((c) => c.startsWith('drill db run') || / get daily\/.*\/db\.dump/.test(c)).length, 0, 'nothing large downloaded');
  });
  it('--date takes a Japan day (finding 21): 18:30 UTC on 01-04 is 03:30 on 01-05 in Japan; any age; records nothing; an empty bucket is DR1', async () => {
    const { h, stamp, copy } = await withSets();
    copy('2026-01-04T183000Z');
    fs.rmSync(path.join(h.bucket, 'daily', stamp), { recursive: true });
    const r = await h.run('restore-drill.sh', ['--date', '2026-01-05']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /日本時間 2026-01-05 03:30 の控え.*--date や --local のときは記録しません/);
    assert.deepEqual(Object.keys(h.status()).filter((k) => k.startsWith('lastDrill')), []);
    const utcDay = await h.run('restore-drill.sh', ['--date', '2026-01-04']);
    assert.equal(utcDay.status, 1);
    assert.match(utcDay.stdout, /わけ: 日本時間 2026-01-04 のそろった控え/);
    const empty = harness();
    assert.equal((await empty.run('restore-drill.sh')).status, 1);
  });
  it('arguments that cannot be read record nothing (finding 14): --local with a missing folder, --date in another form', async () => {
    const h = harness();
    for (const args of [['--local', path.join(h.dir, 'missing')], ['--date', '2026/11/02'], ['--date'], ['--what']]) {
      const r = await h.run('restore-drill.sh', args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stdout, /^❌ \[DR0\] /m);
      assert.deepEqual(h.status(), {}, args.join(' '));
    }
  });
  it('DR2 (a changed byte, same size), DR4 (pg_restore fails), DR5 (counts, migrations, encoding), DR6 (file count): each fails, and the trap still removes the database', async () => {
    const cases = [
      ['DR2', (/** @type {any} */ s) => { const f = path.join(s.h.bucket, 'daily', s.stamp, 'db.dump.rpbk'); const b = fs.readFileSync(f); b[100] ^= 1; fs.writeFileSync(f, b); }, {}],
      ['DR4', () => {}, { STUB_DRILL_RESTORE_FAIL: '1' }],
      ['DR5', () => {}, { STUB_DRILL_COUNTS: '500,4,30,12,8,3,1,2,22' }],
      ['DR5', () => {}, { STUB_DRILL_MIGRATIONS: '000_init' }],
      ['DR5', () => {}, { STUB_DRILL_ENCODING: 'SQL_ASCII' }], // finding 12
      ['DR6', () => {}, { STUB_TAR_LIST: './\n./a.pdf\n' }],
    ];
    for (const [want, prepare, env] of cases) {
      const s = await withSets();
      /** @type {any} */ (prepare)(s);
      const r = await s.h.run('restore-drill.sh', [], { env: /** @type {Record<string, string>} */ (env) });
      assert.equal(r.status, 1, `${want}: ${r.out}`);
      assert.match(r.stdout, new RegExp(`^❌ \\[${want}\\] `, 'm'), r.out);
      assert.equal(s.h.status().lastDrillStep, want);
      if (want !== 'DR2') assert.ok(s.h.calls().includes('docker rm -f -v risepath-drill-db'), `${want}: removed`);
    }
    const enc = await withSets();
    const r = await enc.h.run('restore-drill.sh', [], { env: { STUB_DRILL_ENCODING: 'SQL_ASCII' } });
    assert.match(r.stdout, /わけ: 文字コードが UTF8 ではありません。/);
  });
  it('another key\'s set (finding 2): DR4 with both key ids before anything is downloaded or started', async () => {
    const { h } = await withSets();
    fs.writeFileSync(path.join(h.root, 'etc/risepath-backup/backup.key'), `${OTHER_KEY_HEX}\n`);
    const r = await h.run('restore-drill.sh');
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /^❌ \[DR4\] [\s\S]*わけ: この控えは、ちがう鍵で作られています（控えの key id: [0-9a-f]{16}、この VM の鍵の key id: [0-9a-f]{16}）。/m);
    assert.equal(h.calls().filter((c) => c.startsWith('drill db run') || / get daily\/.*\/db\.dump/.test(c)).length, 0);
  });
  it('a manifest from the bucket\'s writer, without the key (finding 1): counts that would run a command are refused before any arithmetic, nothing is run, nothing recorded as a pass', async () => {
    const { h, stamp, copy } = await withSets();
    const marker = path.join(h.dir, 'pwned');
    // A stamp a minute after the genuine set, so it is the newest and its createdAt fits it.
    const next = new Date(Date.parse(`${stamp.replace(/^(\d{4}-\d\d-\d\dT)(\d\d)(\d\d)(\d\d)Z$/, '$1$2:$3:$4Z')}`) + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
    const payload = (/** @type {string} */ m) => m.replace(/"countsBefore": \[\d+/, `"countsBefore": [BK_TABLES[$(touch\${IFS}${marker})]`);
    for (const seal of [false, true]) {
      // Unsealed: what the bucket's writer can do. Sealed with the key: the form check alone must stop it.
      fs.rmSync(path.join(h.bucket, 'daily', next), { recursive: true, force: true });
      copy(next, payload, { seal });
      h.reset();
      const r = await h.run('restore-drill.sh');
      assert.equal(r.status, 1, r.out);
      assert.ok(!fs.existsSync(marker), `seal=${seal}: the command in the manifest ran`);
      assert.match(r.stdout, /^❌ \[DR1\] [\s\S]*わけ: 目録（manifest\.json）が読めないか、形がちがいます。/m, r.out);
      assert.doesNotMatch(r.stderr, /syntax error|arithmetic/);
      assert.equal(h.status().lastDrillOk, undefined);
      assert.equal(h.calls().filter((c) => c.startsWith('drill db run') || / get daily\/.*\/db\.dump/.test(c)).length, 0);
    }
  });
  it('a well-formed manifest that the key did not seal (finding 1): DR2, nothing restored', async () => {
    const { h, stamp } = await withSets();
    const file = path.join(h.bucket, 'daily', stamp, 'manifest.json');
    // Later counts, as if the set were bigger: well formed, sizes and SHA-256 unchanged, but not what the key sealed.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/"countsBefore": \[\d+/, '"countsBefore": [7'));
    const r = await h.run('restore-drill.sh');
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /^❌ \[DR2\] [\s\S]*わけ: 目録（manifest\.json）が、鍵で暗号化した写し（manifest\.json\.rpbk）と合いません（書きかえられたか、壊れています）。/m);
    assert.equal(h.calls().filter((c) => c.startsWith('drill db run')).length, 0);
    assert.equal(h.status().lastDrillStep, 'DR2');
  });
  it('DR0 checks the room before anything large is downloaded: the download and the throwaway database (finding 5)', async () => {
    const { h } = await withSets();
    // A 70 kB dump: 10 × the dump and 2 GiB, and the download: just over 2 097 152 KiB.
    const r = await h.run('restore-drill.sh', [], { env: { STUB_DF_KB: '2097152' } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /^❌ \[DR0\] [\s\S]*わけ: ディスクの空きが足りません（読み出す控えと練習用の DB に、3 GB ほど要ります）。/m);
    assert.deepEqual(h.calls().filter((c) => c.startsWith('curl get')).map((c) => c.replace(/daily\/[^/]+\//, '')), ['curl get manifest.json'], 'only the manifest');
    assert.equal(h.status().lastDrillStep, 'DR0');
    assert.equal((await h.run('restore-drill.sh', [], { env: { STUB_DF_KB: '2100000' } })).status, 0);
  });
  it('DR1 when the bucket cannot be listed (finding 13)', async () => {
    const { h } = await withSets();
    const r = await h.run('restore-drill.sh', [], { env: { STUB_LIST_FAIL: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[DR1\] [\s\S]*わけ: バケットの一覧か、控えのファイルを読めません（サービスアカウントの役割）。/m);
  });
  it('DR3: a leftover of ours is removed first; a container of another (no label) is never removed; a failed run removes nothing (findings 8, 13)', async () => {
    const ours = await withSets();
    const r1 = await ours.h.run('restore-drill.sh', [], { env: { STUB_LEFTOVER: '1' } });
    assert.equal(r1.status, 0, r1.out);
    inOrder(ours.h.calls(), ['docker rm -f -v risepath-drill-db', 'drill db run', 'docker rm -f -v risepath-drill-db']);
    for (const env of [{ STUB_FOREIGN: '1' }, { STUB_DRILL_RUN_FAIL: '1' }]) {
      const s = await withSets();
      const r = await s.h.run('restore-drill.sh', [], { env });
      assert.equal(r.status, 1, JSON.stringify(env));
      assert.match(r.stdout, /^❌ \[DR3\] [\s\S]*わけ: 練習用の DB のコンテナを作れません/m);
      assert.deepEqual(s.h.calls().filter((c) => c.startsWith('docker rm')), [], `${JSON.stringify(env)}: nothing removed`);
      assert.equal(s.h.status().lastDrillStep, 'DR3');
    }
  });
  it('DR7: a database that cannot be removed is reported (a warning), and the result above stands', async () => {
    const { h } = await withSets();
    const r = await h.run('restore-drill.sh', [], { env: { STUB_RM_FAIL: '1' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /✅ 戻す練習は成功しました[\s\S]*⚠️ \[DR7\] /);
  });
  it('--local <dir>: the set from a folder, no bucket, nothing recorded, the folder kept; DR0 without root', async () => {
    const h = harness();
    const out = path.join(h.dir, 'local');
    const ci = harness({ stackEnv: fs.readFileSync(path.join(STACK, 'ci/stack.ci.env'), 'utf8') });
    assert.equal((await ci.run('backup.sh', ['daily', '--local-only', '--out', out])).status, 0);
    const set = path.join(out, fs.readdirSync(out)[0]);
    const r = await h.run('restore-drill.sh', ['--local', set]);
    assert.equal(r.status, 0, r.out);
    assert.equal(h.calls().filter((c) => c.startsWith('curl')).length, 0);
    assert.deepEqual(h.status(), {});
    assert.ok(fs.existsSync(path.join(set, 'db.dump.rpbk')));
    const user = await h.run('restore-drill.sh', [], { env: { STUB_UID: '1000' } });
    assert.equal(user.status, 1);
    assert.match(user.stdout, /^❌ \[DR0\] [\s\S]*sudo を付けて実行します/m);
  });
});

describe('status.json: what the backup scripts write is what the 事前チェック reads (R2, R3, R4, R6)', { skip, concurrency: true }, () => {
  it('preflight.sh\'s own status_field and alert patterns read lastOk, lastFail, lastDrillOk, keyId and alert from a real run', async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    assert.equal((await h.run('restore-drill.sh')).status, 0);
    assert.equal((await h.run('backup.sh', ['daily'], { env: { STUB_DUMP_FAIL: '1' } })).status, 1);
    const preflight = read('deploy/risepath-vm/scripts/preflight.sh');
    const fn = /^status_field\(\) \{[\s\S]*?^\}$/m.exec(preflight)?.[0];
    const iso = /^\s*iso='([^']+)'$/m.exec(preflight)?.[1];
    const alert = /alert="\$\(sed -nE '([^']+)' "\$\{BACKUP_STATUS\}"/.exec(preflight)?.[1];
    assert.ok(fn && iso && alert, 'the patterns found in preflight.sh');
    const script = `${fn}\nBACKUP_STATUS="$1"\nfor k in lastOk lastFail lastDrillOk; do printf '%s=%s\\n' "$k" "$(status_field "$k" '${iso}')"; done\nprintf 'keyId=%s\\n' "$(status_field keyId '[0-9a-f]{16}')"\nprintf 'alert=%s\\n' "$(sed -nE '${alert}' "$BACKUP_STATUS" | head -n 1)"`;
    const r = spawnSync('bash', ['-c', script, '_', path.join(h.root, 'var/lib/risepath-backup/status.json')], { encoding: 'utf8' });
    const got = Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=')));
    const status = h.status();
    assert.equal(got.lastOk, status.lastOk);
    assert.equal(got.lastFail, status.lastFail);
    assert.equal(got.lastDrillOk, status.lastDrillOk);
    assert.equal(got.keyId, status.keyId);
    assert.equal(got.alert, 'true');
    for (const k of ['lastOk', 'lastFail', 'lastDrillOk', 'keyId']) assert.ok(got[k], k);
    assert.equal(fs.statSync(path.join(h.root, 'var/lib/risepath-backup/status.json')).mode & 0o777, 0o644);
  });
});

describe('install-backup.sh (stub harness)', { skip, concurrency: true }, () => {
  it('IB1 without root; IB2 on the first run (the template copied, 0600, nothing else); IB3 without an https webhook; IB4 when the probe fails', async () => {
    assert.match((await harness().run('install-backup.sh', ['--new-key'], { env: { STUB_UID: '1000' } })).stdout, /^❌ \[IB1\] /m);
    const first = harness({ backupEnv: null, key: null });
    const r = await first.run('install-backup.sh', ['--new-key']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[IB2\] [\s\S]*はじめてなので、設定のファイルを作りました/m);
    const env = path.join(first.root, 'etc/risepath-backup/backup.env');
    assert.equal(fs.readFileSync(env, 'utf8'), fs.readFileSync(path.join(STACK, 'backup.env.example'), 'utf8'));
    assert.equal(fs.statSync(env).mode & 0o777, 0o600);
    assert.ok(!fs.existsSync(path.join(first.root, 'etc/risepath-backup/backup.key')));
    assert.match((await first.run('install-backup.sh', ['--new-key'])).stdout, /^❌ \[IB2\] /m, 'still no bucket');
    const noHook = harness({ key: null, stackEnv: 'NODE_ENV=production\nSAFETY_ALERT_WEBHOOK_URL=http://insecure.example/x\n' });
    assert.match((await noHook.run('install-backup.sh', ['--new-key'])).stdout, /^❌ \[IB3\] /m);
    const probe = harness({ key: null });
    const p = await probe.run('install-backup.sh', ['--new-key'], { env: { STUB_UPLOAD_FAIL: 'probe/' } });
    // Review round 1, finding 18: one block, IB4, with the probe's reason (no BK7 block whose fix names a unit not installed yet).
    assert.match(p.stdout, /^❌ \[IB4\] [\s\S]*わけ: 試しのファイルを送れないか、大きさが合いません（役割か、バケットの名前）。/m);
    assert.doesNotMatch(p.out, /\[BK7\]/);
    assert.equal((p.stdout.match(/^❌ /gm) ?? []).length, 1, 'one error block');
    assert.ok(!fs.existsSync(path.join(probe.root, 'etc/risepath-backup/backup.key')));
    const token = await harness({ key: null }).run('install-backup.sh', ['--new-key'], { env: { STUB_TOKEN_FAIL: '1' } });
    assert.match(token.stdout, /^❌ \[IB4\] [\s\S]*わけ: VM のサービスアカウントのトークンをもらえません/m);
    const list = harness({ key: null });
    const l = await list.run('install-backup.sh', ['--new-key'], { env: { STUB_LIST_FAIL: '1' } });
    assert.match(l.stdout, /^❌ \[IB4\] [\s\S]*わけ: バケットの一覧を読めません。/m, 'finding 13: a bucket that cannot be listed');
    assert.ok(!fs.existsSync(path.join(list.root, 'etc/risepath-backup/backup.key')));
  });
  it('--new-key on an empty bucket: a 0600 key, the five units, both timers enabled, the first backup, its size and key id', async () => {
    const h = harness({ key: null });
    const r = await h.run('install-backup.sh', ['--new-key'], { env: { STUB_SERVICE_RUNS: '1' } });
    assert.equal(r.status, 0, r.out);
    const key = path.join(h.root, 'etc/risepath-backup/backup.key');
    assert.equal(fs.statSync(key).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(key, 'utf8'), /^[0-9a-f]{64}\n$/);
    assert.deepEqual(fs.readdirSync(path.join(h.root, 'etc/systemd/system')).sort(), [...UNITS].sort());
    inOrder(h.calls(), ['curl put probe/', 'curl list daily/', 'crypt keygen', 'systemctl daemon-reload', 'systemctl enable --now risepath-backup.timer risepath-backup-journal.timer', 'systemctl start risepath-backup.service']);
    assert.match(r.stdout, /^✅ 最初の控えができました（.+）。key id: [0-9a-f]{16}$/m);
    // Review round 1, finding 20: the next steps say how the key leaves the VM and what R4 reads (both record lines).
    assert.ok(r.stdout.includes('`sudo cat /etc/risepath-backup/backup.key` で出た 64 文字を、パスワード管理の'), r.out);
    assert.ok(r.stdout.includes('launch-record.env の BACKUP_KEY_COPY に今日の日付を、BACKUP_KEY_ID に上の key id を書きます（手順書 6.4）。'));
    assert.ok(r.stdout.includes('コマンドは、どれも /opt/risepath/deploy/risepath-vm で実行します'), 'finding 19');
    assert.ok(!r.out.includes(fs.readFileSync(key, 'utf8').trim()), 'the key is never printed');
    assert.ok(!JSON.stringify(h.argv()).includes(fs.readFileSync(key, 'utf8').trim()));
    const failed = harness({ key: null });
    const f = await failed.run('install-backup.sh', ['--new-key'], { env: { STUB_SERVICE_RUNS: '1', STUB_DUMP_FAIL: '1' } });
    assert.equal(f.status, 1);
    assert.match(f.stdout, /❌ 最初の控えが失敗しました（手順 BK3）。[\s\S]*❌ \[BK3\] /);
  });
  it('--new-key refuses an existing key and a bucket with another key\'s sets (IB5), changing nothing; --replace-key goes on', async () => {
    const existing = harness();
    const r1 = await existing.run('install-backup.sh', ['--new-key']);
    assert.match(r1.stdout, /^❌ \[IB5\] [\s\S]*わけ: 鍵はもうあります。上書きすると、今までの控えを戻せなくなります/m);
    assert.equal(fs.readFileSync(path.join(existing.root, 'etc/risepath-backup/backup.key'), 'utf8'), `${KEY_HEX}\n`);
    assert.equal((await existing.run('backup.sh', ['daily'])).status, 0);
    const rebuilt = harness({ key: null });
    fs.cpSync(existing.bucket, rebuilt.bucket, { recursive: true });
    const r2 = await rebuilt.run('install-backup.sh', ['--new-key']);
    assert.match(r2.stdout, /^❌ \[IB5\] [\s\S]*わけ: このバケットには、ほかの鍵で作った控えがあります。新しい VM なら、`--import-key`/m);
    assert.ok(!fs.existsSync(path.join(rebuilt.root, 'etc/risepath-backup/backup.key')));
    assert.ok(!rebuilt.calls().some((c) => c.startsWith('systemctl')));
    const r3 = await rebuilt.run('install-backup.sh', ['--new-key', '--replace-key'], { env: { STUB_SERVICE_RUNS: '1' } });
    assert.equal(r3.status, 0, r3.out);
    assert.match(r3.stdout, /前の鍵でしか戻せません/);
  });
  it('--import-key: a mismatched key is refused (IB5); the matching one is written 0600 and no timer is enabled; the pasted key is never shown', async () => {
    const vm = harness();
    assert.equal((await vm.run('backup.sh', ['daily'])).status, 0);
    const rebuilt = harness({ key: null });
    fs.cpSync(vm.bucket, rebuilt.bucket, { recursive: true });
    const bad = await rebuilt.run('install-backup.sh', ['--import-key'], { input: `${OTHER_KEY_HEX}\n` });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /^❌ \[IB5\] [\s\S]*わけ: 貼った鍵は、バケットの控えの鍵とちがいます/m);
    assert.ok(!fs.existsSync(path.join(rebuilt.root, 'etc/risepath-backup/backup.key')));
    for (const input of ['not a key\n', `${KEY_HEX.slice(1)}\n`]) assert.match((await rebuilt.run('install-backup.sh', ['--import-key'], { input })).stdout, /鍵の形（0〜9 と a〜f の 64 文字）ではありません/);
    rebuilt.reset();
    const ok = await rebuilt.run('install-backup.sh', ['--import-key'], { input: `  ${KEY_HEX.toUpperCase()}  \n` });
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.stdout, /^✅ 鍵を戻しました（key id [0-9a-f]{16}）。$/m);
    const key = path.join(rebuilt.root, 'etc/risepath-backup/backup.key');
    assert.equal(fs.readFileSync(key, 'utf8'), `${KEY_HEX}\n`);
    assert.equal(fs.statSync(key).mode & 0o777, 0o600);
    assert.deepEqual(rebuilt.calls().filter((c) => c.startsWith('systemctl')), [], 'no timer before the restore (16.3)');
    for (const out of [bad.out, ok.out]) for (const k of [KEY_HEX, OTHER_KEY_HEX, KEY_HEX.toUpperCase()]) assert.ok(!out.includes(k), 'pasted key printed');
    for (const k of [KEY_HEX, OTHER_KEY_HEX, KEY_HEX.toUpperCase()]) assert.ok(!JSON.stringify(rebuilt.argv()).includes(k), 'pasted key on a command line');
    const again = await rebuilt.run('install-backup.sh', ['--import-key'], { input: `${OTHER_KEY_HEX}\n` });
    assert.match(again.stdout, /この VM には、ちがう鍵がもうあります（上書きしません）/);
    assert.equal(fs.readFileSync(key, 'utf8'), `${KEY_HEX}\n`);
  });
  it('--import-key with an empty bucket asks for yes: anything else writes nothing', async () => {
    const h = harness({ key: null });
    const no = await h.run('install-backup.sh', ['--import-key'], { input: `${KEY_HEX}\nno\n` });
    assert.equal(no.status, 0);
    assert.match(no.stdout, /やめました（何も変えていません）/);
    assert.ok(!fs.existsSync(path.join(h.root, 'etc/risepath-backup/backup.key')));
    const yes = await h.run('install-backup.sh', ['--import-key'], { input: `${KEY_HEX}\nyes\n` });
    assert.equal(yes.status, 0, yes.out);
    assert.ok(fs.existsSync(path.join(h.root, 'etc/risepath-backup/backup.key')));
  });
  it('without a flag and without a key: refused (IB5); key-id prints the id; check-copy compares a pasted copy and writes nothing', async () => {
    assert.match((await harness({ key: null }).run('install-backup.sh')).stdout, /`--new-key`（はじめて）か `--import-key`（鍵を戻す）を付けます/);
    const h = harness();
    const id = await h.run('install-backup.sh', ['key-id']);
    assert.match(id.stdout, /^key id: [0-9a-f]{16}$/m);
    const match = await h.run('install-backup.sh', ['check-copy'], { input: `${KEY_HEX}\n` });
    assert.equal(match.status, 0);
    assert.match(match.stdout, /^✅ 控えの鍵は合っています（key id [0-9a-f]{16}）。$/m);
    const differ = await h.run('install-backup.sh', ['check-copy'], { input: `${OTHER_KEY_HEX}\n` });
    assert.equal(differ.status, 1);
    assert.match(differ.stdout, /貼った鍵は、この VM の鍵とちがいます/);
    assert.deepEqual(h.status(), {}, 'check-copy records nothing (TR9b)');
    assert.equal((await h.run('install-backup.sh', ['--new-key', '--import-key'])).status, 1);
  });
  it('IB0 (review round 1, finding 17): usage mistakes and a Docker or systemd failure have their own neutral code, never the key\'s IB5', async () => {
    const h = harness();
    for (const [args, reason] of [[['--what'], '知らない指定です'], [['key-id', 'x'], 'key-id には何も付けません。'], [['--new-key', '--import-key'], 'どちらか 1 つだけ'],
      [['--replace-key'], '--replace-key は --new-key といっしょにだけ使います。']]) {
      const r = await h.run('install-backup.sh', /** @type {string[]} */ (args));
      assert.equal(r.status, 1, String(args));
      assert.match(r.stdout, /^❌ \[IB0\] 控えの設定を続けられません（指定のまちがいか、Docker か systemd が答えません）。$/m, String(args));
      assert.ok(r.stdout.includes(`わけ: `) && r.stdout.includes(String(reason)), String(args));
      assert.doesNotMatch(r.stdout, /\[IB5\]/);
    }
    assert.doesNotMatch(String(BACKUP_CODES.find((c) => c.code === 'IB5')?.title), /指定/, 'IB5 is about keys only');
    assert.match((await harness({ key: null }).run('install-backup.sh')).stdout, /^❌ \[IB0\] [\s\S]*わけ: `--new-key`（はじめて）か `--import-key`（鍵を戻す）を付けます。/m);
    // systemd does not answer (STUB_SYSTEMCTL_STATUS: daemon-reload fails): named, never a silent exit.
    const sd = harness({ key: null });
    const r = await sd.run('install-backup.sh', ['--new-key'], { env: { STUB_SYSTEMCTL_STATUS: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[IB0\] [\s\S]*わけ: systemd が、控えのユニットを読み込めません（systemctl daemon-reload）。/m);
    // A command without its own code (set -e) still prints a code: the units cannot be copied.
    const ro = harness({ key: null });
    fs.mkdirSync(path.join(ro.root, 'etc/systemd'), { recursive: true });
    fs.writeFileSync(path.join(ro.root, 'etc/systemd/system'), 'not a folder');
    const u = await ro.run('install-backup.sh', ['--new-key']);
    assert.equal(u.status, 1);
    assert.match(u.stdout, /^❌ \[IB0\] [\s\S]*わけ: 途中で止まりました（思いがけないエラーです）。/m);
  });
});

describe('restore-db.sh: the order of a restore (stub harness; findings 2, 3, 26)', { skip, concurrency: true }, () => {
  /** A VM harness with one set and one hourly journal in the bucket; then the calls are reset. */
  const vm = async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    fs.writeFileSync(path.join(h.stubDir, 'journal.csv'), `${JOURNAL_HEADER}\naccount,aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa,2099-01-01T00:00:00.000000Z,self,,,,\n`);
    assert.equal((await h.run('backup.sh', ['journal'])).status, 0);
    h.reset();
    return h;
  };
  const ARGS = ['--from', 'newest', '--yes-replace-production-database'];
  /**
   * Review round 2, finding 2: a stop before any run reached RS5 (the database unchanged) puts the marker, the boot unit and
   * the timers back; the services stay stopped and nothing is deployed.
   * @param {RunResult} r @param {ReturnType<typeof makeHarness>} h
   */
  const released = (r, h) => {
    assert.match(r.stdout, /⚠️  DB はまだ変えていません。控えのタイマーと、VM の再起動のときの起動は、元に戻しました。Rise Path の部品（api など）は止めたままです。/, r.out);
    assert.ok(!fs.existsSync(markOf(h)), 'the marker removed');
    const calls = h.calls();
    if (calls.includes('systemctl disable risepath-stack.service')) assert.ok(at(calls, 'systemctl enable risepath-stack.service') > at(calls, 'systemctl disable risepath-stack.service'), 'the boot unit enabled again');
    assert.ok(calls.includes('systemctl start risepath-backup.timer') && calls.includes('systemctl start risepath-backup-journal.timer'), 'the timers started again');
    assert.ok(!calls.some((c) => c.includes('deploy-stack') || / up /.test(c)), 'nothing deployed');
  };
  /**
   * A stop from RS5 on: the marker (dbChanged=1), the boot unit disabled and the timers stopped, also across a reboot.
   * @param {RunResult} r @param {ReturnType<typeof makeHarness>} h
   */
  const held = (r, h) => {
    assert.match(r.stdout, /⚠️  戻しが途中です（DB は控えから戻しかけています）。控えは作らず、VM を再起動しても Rise Path は動き出しません（\/var\/lib\/risepath-backup\/restore-in-progress）。\n   デプロイはしません。エージェントと、同じコマンドで続きをします（手順書 16\.2）。/, r.out);
    assert.match(fs.readFileSync(markOf(h), 'utf8'), /^dbChanged=1$/m);
    assert.ok(h.calls().includes('systemctl disable risepath-stack.service'));
    assert.ok(!h.calls().some((c) => c.startsWith('systemctl start') || c.startsWith('systemctl enable') || c.includes('deploy-stack')), h.calls().join('\n'));
  };
  it('preflight < timers stopped < lock < services stopped < journal export < dropdb < pg_restore < migrate < replay list < replay --yes < timers started < the first up (in deploy-stack.sh)', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' });
    assert.equal(r.status, 0, r.out);
    const calls = h.calls();
    inOrder(calls, ['preflight as=deploy', 'systemctl stop risepath-backup.timer risepath-backup-journal.timer', 'flock -w 900 9',
      'systemctl disable risepath-stack.service', 'compose[risepath] stop api mcp mcp-public cloudflared as=deploy', 'COPY', 'dropdb', 'exec db pg_restore',
      'run --rm --no-deps -T api npm run db:migrate as=deploy', 'run replay --since', '--yes as=deploy', 'systemctl enable risepath-stack.service',
      'systemctl start risepath-backup.timer', 'systemctl start risepath-backup-journal.timer', 'deploy-stack as=deploy', 'compose[risepath] up -d as=deploy']);
    // Review round 2, finding 2: the marker is gone at the end; `disable` never with --now (its ExecStop would stop the db).
    assert.ok(!fs.existsSync(markOf(h)));
    assert.ok(!calls.some((c) => /^systemctl (?:disable|enable) --now risepath-stack/.test(c)));
    noJsonLog(h);
    const up = at(calls, ' up ');
    assert.ok(up > at(calls, '--yes'), 'no up before the replay');
    assert.equal(calls.filter((c) => /compose\[risepath\] up /.test(c)).length, 1);
    assert.ok(at(calls, 'pg_dump', at(calls, 'systemctl start risepath-backup-journal.timer')) > 0, 'one backup of the restored database (RS10)');
    const manifest = JSON.parse(fs.readFileSync(path.join(h.bucket, h.objects('daily/').find((n) => n.endsWith('manifest.json')) ?? ''), 'utf8'));
    assert.ok(calls.some((c) => c.includes(`run replay --since ${manifest.dumpStartedAt} --yes as=deploy`)), 'the manifest\'s dumpStartedAt');
    const csv = fs.readFileSync(path.join(h.stubDir, 'replay-yes.csv'), 'utf8');
    assert.equal((csv.match(/aaaaaaaa-1111/g) ?? []).length, 3, 'the hourly journal, the pre-restore export (kept and uploaded)');
    assert.ok(csv.startsWith(JOURNAL_HEADER));
    // Review round 3, finding 6: with the real flock, the RS3 export ran inside the lock restore-db.sh holds (backup.sh's
    // bk_lock reuses the descriptor it inherited) and left its file on the VM; RS8 read it.
    assert.ok(REAL_FLOCK, 'util-linux flock');
    const pre = fs.readdirSync(path.join(h.root, 'var/backups/risepath')).filter((d) => d.startsWith('pre-restore-'));
    assert.equal(pre.length, 1);
    assert.equal(fs.readdirSync(path.join(h.root, 'var/backups/risepath', pre[0])).filter((f) => f.endsWith('.csv.rpbk')).length, 1, 'the export file on the VM');
    assert.match(r.stdout, /^ {3}読んだ記録: 戻す前の書き出しから 1、バケットから 2$/m);
    assert.doesNotMatch(r.out, /ほかの控えの処理が動いているので/);
    assert.deepEqual(fs.readdirSync(path.join(h.root, 'var/backups/risepath')).filter((d) => d.startsWith('restore-')), [], 'the plaintext journal removed');
    // Review round 1, finding 7: the plaintext CSV lives only in the 0700 temp folder in /run, never under /var/backups.
    const stdin = calls.filter((c) => c.startsWith('replay stdin '));
    assert.equal(stdin.length, 2);
    for (const c of stdin) assert.ok(c.startsWith(`replay stdin ${path.join(h.root, 'run')}/risepath-backup.`) && c.endsWith('/journal.csv'), c);
    assert.deepEqual(fs.readdirSync(path.join(h.root, 'run')).filter((f) => /^risepath-backup\.(?!lock$)/.test(f)), [], 'the temp folder removed');
    // Finding 3: a fresh token right before RS8's bucket listing (the first one may have expired at the question).
    const list = at(calls, 'curl list journal/');
    assert.ok(list > at(calls, 'db:migrate') && calls[list - 1] === 'curl token', calls.slice(list - 3, list + 1).join(' | '));
    // Finding 2: both files decrypted to the end before the question; finding 21: the time in Japan time.
    inOrder(calls, ['curl get daily/', 'crypt decrypt', 'dropdb']);
    assert.match(r.stdout, /^この控え: 日本時間 \d{4}-\d\d-\d\d \d\d:\d\d に作り始めたもの（コミット ccccccc）$/m);
    assert.match(r.stdout, /^✅ 戻しました（日本時間 \d{4}-\d\d-\d\d \d\d:\d\d の控えと、そのあとの削除の記録）。/m);
    noToken(h, r.out);
  });
  it('deploy-stack.sh and preflight.sh run as the checkout\'s owner through runuser, never as root; a root-owned checkout is refused before anything', async () => {
    const h = await vm();
    assert.equal((await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' })).status, 0);
    const calls = h.calls();
    assert.ok(calls.includes(`runuser -u deploy -- ${path.join(h.stack, 'scripts/preflight.sh')}`));
    assert.ok(calls.includes(`runuser -u deploy -- ${path.join(h.stack, 'scripts/deploy-stack.sh')}`));
    for (const c of calls.filter((c) => /^(preflight|deploy-stack) /.test(c))) assert.match(c, / as=deploy /);
    const root = await vm();
    const r = await root.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_OWNER: 'root' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[RS0\] /m);
    assert.deepEqual(root.calls(), []);
  });
  it('a failed export while the database answers → stop before dropdb; the database unchanged, so the marker, the boot unit and the timers are put back (review round 2, finding 2)', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_JOURNAL_FAIL: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /❌ \[RS3\] /);
    assert.ok(!h.calls().some((c) => c.includes('dropdb')));
    released(r, h);
  });
  it('the database does not answer: stop before dropdb unless --current-db-lost', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_PG_READY: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /❌ \[RS3\] [\s\S]*--current-db-lost/);
    assert.ok(!h.calls().some((c) => c.includes('dropdb')));
    h.reset();
    const lost = await h.run('restore-db.sh', [...ARGS, '--current-db-lost'], { input: 'yes\nyes\n', env: { STUB_PG_READY: '1' } });
    assert.ok(h.calls().some((c) => c.includes('dropdb')), lost.out);
    assert.match(lost.stdout, /最後の 1 時間ぶんの削除の記録はありません/);
  });
  it('the same command again after a stop at RS5: RS3 refuses without --current-db-lost; with it, the emptied database\'s export failing is a warning and the first run\'s export (never uploaded) is replayed, an export older than the dump is not', async () => {
    const h = await vm();
    // The live database's last deletion, only in the pre-restore export: the bucket refuses journals during the first run.
    fs.writeFileSync(path.join(h.stubDir, 'journal.csv'), `${JOURNAL_HEADER}\naccount,bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb,2099-01-01T00:00:00.000000Z,self,,,,\n`);
    const first = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_UPLOAD_FAIL: 'journal/', STUB_RESTORE_FAIL: '1' } });
    assert.equal(first.status, 1, first.out);
    assert.match(first.stdout, /⚠️  削除の記録はこの VM に控えました。バケットには送れませんでした。/);
    assert.match(first.stdout, /❌ \[RS5\] [\s\S]*`--current-db-lost` を付けて、もう一度はじめから戻します/);
    held(first, h);
    assert.ok(!h.objects('journal/').some((n) => n.includes('bbbb')), 'not in the bucket');
    // An export from a restore long ago (before this dump) lies on the VM too: it must not be read.
    const old = path.join(h.root, 'var/backups/risepath/pre-restore-2020-01-01t000000z');
    fs.mkdirSync(old, { recursive: true });
    const keyFile = path.join(h.dir, 'enc.key');
    fs.writeFileSync(keyFile, KEY_HEX);
    fs.writeFileSync(path.join(old, '2020-01-01T000000Z-abcdef.csv.rpbk'), spawnSync(process.execPath, [path.join(ROOT, 'scripts/deploy/backup-crypt.mjs'), 'encrypt', '--key', keyFile],
      { input: `${JOURNAL_HEADER}\naccount,cccccccc-3333-4333-8333-cccccccccccc,2099-01-01T00:00:00.000000Z,self,,,,\n` }).stdout);
    // Again: the database answers but is empty, so its export fails.
    h.reset();
    const again = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_JOURNAL_FAIL: '1' } });
    assert.equal(again.status, 1);
    assert.match(again.stdout, /❌ \[RS3\] [\s\S]*わけ: DB は答えますが、削除の記録を書き出せません。前の戻しが RS5 で止まったあと（DB が空か途中）なら、エージェントと --current-db-lost を付けます。/);
    assert.ok(!h.calls().some((c) => c.includes('dropdb')));
    // Review round 2, finding 2: this run did not touch the database, but the first one did: still held, never released.
    assert.match(again.stdout, /前の戻しの続きです（日本時間 \d{4}-\d\d-\d\d \d\d:\d\d に始めた戻し）。/);
    held(again, h);
    h.reset();
    const lost = await h.run('restore-db.sh', [...ARGS, '--current-db-lost'], { input: 'yes\nyes\n', env: { STUB_JOURNAL_FAIL: '1' } });
    assert.equal(lost.status, 0, lost.out);
    assert.match(lost.stdout, /⚠️  DB は答えますが、削除の記録を書き出せません（--current-db-lost）。前の戻しで書き出した記録が VM にあれば、それを使います。/);
    assert.match(lost.stdout, /読んだ記録: 戻す前の書き出しから 1、バケットから 1/);
    const csv = fs.readFileSync(path.join(h.stubDir, 'replay-yes.csv'), 'utf8');
    assert.match(csv, /bbbbbbbb-2222/, 'the first run\'s export');
    assert.match(csv, /aaaaaaaa-1111/, 'the hourly journal');
    assert.doesNotMatch(csv, /cccccccc-3333/, 'an export older than the dump');
    inOrder(h.calls(), ['COPY', 'dropdb', 'exec db pg_restore', 'run replay --since', '--yes as=deploy', 'systemctl enable risepath-stack.service', 'deploy-stack as=deploy']);
    assert.ok(!fs.existsSync(markOf(h)), 'the marker removed once the replay is done');
  });
  it('a rebuilt VM without the backup units (手順書 16.3, after --import-key): no timer is stopped or started, and the restore runs to the end', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_TIMERS_ENABLED: '', STUB_UNITS_LOADED: '' } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /この VM には、控えのタイマーがまだありません（手順書 16\.3 では正しい状態です）。/);
    assert.ok(!h.calls().some((c) => /^systemctl (stop|start) /.test(c)), h.calls().join('\n'));
    inOrder(h.calls(), ['flock -w 900 9', 'dropdb', '--yes as=deploy', 'deploy-stack as=deploy']);
    // A timer that is running but not enabled is stopped too, and not started again.
    const h2 = await vm();
    const r2 = await h2.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_TIMERS_ENABLED: '', STUB_TIMERS_ACTIVE: 'risepath-backup-journal.timer' } });
    assert.equal(r2.status, 0, r2.out);
    assert.ok(h2.calls().includes('systemctl stop risepath-backup-journal.timer'));
    assert.ok(!h2.calls().some((c) => c.startsWith('systemctl start')));
  });
  it('anything but yes at RS4 stops before dropdb; at RS8 stops before the replay --yes, the timers stopped', async () => {
    const h = await vm();
    const no = await h.run('restore-db.sh', ARGS, { input: 'no\n' });
    assert.match(no.stdout, /❌ \[RS4\] /);
    assert.ok(!h.calls().some((c) => c.includes('dropdb')));
    released(no, h);
    h.reset();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nnope\n' });
    assert.match(r.stdout, /❌ \[RS8\] /);
    assert.ok(!h.calls().some((c) => c.includes('--yes as=')));
    assert.ok(!h.calls().some((c) => c.startsWith('systemctl start') || c.includes(' up ')));
    held(r, h);
  });
  it('a failure before RS10 (the replay answers 3) leaves the timers stopped and no service started', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_REPLAY_YES_STATUS: '3' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /❌ \[RS8\] [\s\S]*終わりの番号 3/);
    assert.ok(!h.calls().some((c) => c.startsWith('systemctl start') || c.includes('deploy-stack')));
    held(r, h);
    assert.doesNotMatch(r.stdout, /DB はまだ変えていません/);
  });
  it('a failing deploy-stack.sh → exit ≠ 0 with the replay done and the timers started again', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_DEPLOY_STATUS: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /❌ \[RS11\] /);
    inOrder(h.calls(), ['--yes as=deploy', 'systemctl enable risepath-stack.service', 'systemctl start risepath-backup.timer', 'deploy-stack as=deploy']);
    assert.doesNotMatch(r.stdout, /戻しが途中です|元に戻しました/);
    assert.ok(!fs.existsSync(markOf(h)), 'the marker removed at RS10: the database is correct');
  });
  it('only the timers that were enabled are started again; a failed backup at RS10 still deploys, then exits 1', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_TIMERS_ENABLED: 'risepath-backup.timer', STUB_UPLOAD_FAIL: 'daily/' } });
    assert.equal(r.status, 1);
    assert.ok(h.calls().includes('systemctl start risepath-backup.timer'));
    assert.ok(!h.calls().includes('systemctl start risepath-backup-journal.timer'));
    assert.match(r.stdout, /❌ \[RS10\] [\s\S]*==> デプロイします（RS11）/);
    assert.ok(h.calls().some((c) => c.startsWith('deploy-stack')));
  });
  // Review round 1, findings 2 and 9: every check of the chosen set runs before the yes question and before dropdb.
  /** Expects a stop at RS4 with `reason`, no dropdb, the timers left stopped and the DB untouched. @param {RunResult} r @param {ReturnType<typeof makeHarness>} h @param {string} reason */
  const stoppedAtRs4 = (r, h, reason) => {
    assert.equal(r.status, 1, r.out);
    assert.ok(r.stdout.includes('❌ [RS4] ') && r.stdout.includes(`わけ: ${reason}`), r.out);
    assert.ok(!h.calls().some((c) => c.includes('dropdb')), 'no dropdb');
    released(r, h);
    assert.doesNotMatch(r.stderr, /この控えで戻しますか/, 'stopped before the question');
  };
  /** The newest set's folder in the fake bucket. @param {ReturnType<typeof makeHarness>} h */
  const setDir = (h) => path.join(h.bucket, 'daily', h.objects('daily/')[0].split('/')[1]);
  it('RS4: a set file that does not match the manifest (SHA-256, same size) stops before dropdb — with --from newest and with --from <folder>', async () => {
    // Another day's dump: the same size, a valid rpbk1 file of the same key, a different SHA-256 (only the manifest check sees it).
    const h = await vm();
    const other = harness();
    assert.equal((await other.run('backup.sh', ['daily'])).status, 0);
    fs.copyFileSync(path.join(setDir(other), 'db.dump.rpbk'), path.join(setDir(h), 'db.dump.rpbk'));
    stoppedAtRs4(await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' }), h, '控えのファイルが、目録の SHA-256 か大きさと合いません。');
    const flipped = await vm();
    const f = path.join(setDir(flipped), 'db.dump.rpbk');
    const b = fs.readFileSync(f);
    b[200] ^= 1;
    fs.writeFileSync(f, b);
    stoppedAtRs4(await flipped.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' }), flipped, '控えのファイルが、目録の SHA-256 か大きさと合いません。');
    const local = await vm();
    const dir = path.join(local.root, 'var/backups/risepath', fs.readdirSync(path.join(local.root, 'var/backups/risepath')).find((d) => /^20/.test(d)) ?? '');
    fs.copyFileSync(path.join(setDir(other), 'db.dump.rpbk'), path.join(dir, 'db.dump.rpbk'));
    stoppedAtRs4(await local.run('restore-db.sh', ['--from', dir, '--yes-replace-production-database'], { input: 'yes\nyes\n' }), local, '控えのファイルが、目録の SHA-256 か大きさと合いません。');
  });
  it('RS4: a set made with another key stops before dropdb with both key ids (a set from before `--new-key --replace-key`)', async () => {
    const h = await vm();
    fs.writeFileSync(path.join(h.root, 'etc/risepath-backup/backup.key'), `${OTHER_KEY_HEX}\n`);
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' });
    assert.match(r.stdout, /わけ: この控えは、ちがう鍵で作られています（控えの key id: [0-9a-f]{16}、この VM の鍵の key id: [0-9a-f]{16}）。--from で、この鍵の控えを選びます。/);
    stoppedAtRs4(r, h, 'この控えは、ちがう鍵で作られています');
    assert.ok(!h.calls().some((c) => / get daily\/.*\/db\.dump/.test(c)), 'nothing large downloaded');
  });
  it('RS4: a manifest the key did not seal (a later dumpStartedAt would skip deletions in the replay) stops before dropdb', async () => {
    const h = await vm();
    const m = path.join(setDir(h), 'manifest.json');
    fs.writeFileSync(m, fs.readFileSync(m, 'utf8').replace(/"dumpStartedAt": "[^"]+"/, '"dumpStartedAt": "2099-01-01T00:00:00Z"'));
    stoppedAtRs4(await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' }), h, '目録（manifest.json）が、鍵で暗号化した写し（manifest.json.rpbk）と合いません（書きかえられたか、壊れています）。');
  });
  it('RS4: a file that matches its manifest but cannot be decrypted to the end stops before dropdb (the dump; the uploads with --with-uploads)', async () => {
    /** @type {Array<[string, string[], string]>} */
    const cases = [['db.dump.rpbk', ARGS, 'DB の控え（db.dump.rpbk）を、最後まで復号できません（鍵か、ファイル）。'],
      ['uploads.tar.rpbk', [...ARGS, '--with-uploads'], 'uploads の控え（uploads.tar.rpbk）を、最後まで復号できません（鍵か、ファイル）。']];
    for (const [file, args, reason] of cases) {
      const h = await vm();
      const dir = setDir(h);
      // Cut to its header (no chunk), with the manifest's size and SHA-256 made to fit and the manifest sealed again.
      const cut = fs.readFileSync(path.join(dir, file)).subarray(0, 20);
      fs.writeFileSync(path.join(dir, file), cut);
      const key = file === 'db.dump.rpbk' ? 'dbDump' : 'uploads';
      const sha = spawnSync('sha256sum', [path.join(dir, file)], { encoding: 'utf8' }).stdout.split(' ')[0];
      const m = path.join(dir, 'manifest.json');
      fs.writeFileSync(m, fs.readFileSync(m, 'utf8').replace(new RegExp(`"${key}Bytes": \\d+`), `"${key}Bytes": 20`).replace(new RegExp(`"${key}Sha256": "[0-9a-f]+"`), `"${key}Sha256": "${sha}"`));
      h.seal(dir);
      stoppedAtRs4(await h.run('restore-db.sh', args, { input: 'yes\nyes\n' }), h, reason);
    }
  });
  it('RS7: a failed migration stops before the replay, the timers and the backup (review round 1, finding 10)', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_MIGRATE_FAIL: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[RS7\] /m);
    assert.ok(h.calls().some((c) => c.includes('db:migrate')));
    assert.ok(!h.calls().some((c) => c.includes('run replay') || c.startsWith('systemctl start') || c.includes('deploy-stack') || c.includes('pg_dump')), h.calls().join('\n'));
    held(r, h);
  });
  it('RS8: the replay list answering 2 (consent or grant rows) stops before the question, the timers stopped; a journal listing that fails stops too (finding 13)', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_REPLAY_LIST_STATUS: '2' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[RS8\] [\s\S]*わけ: 確かめで止まりました（終わりの番号 2）。/m);
    assert.doesNotMatch(r.stderr, /この数で合っていますか/);
    assert.ok(!h.calls().some((c) => c.includes('--yes as=') || c.startsWith('systemctl start') || c.includes('deploy-stack')));
    held(r, h);
    const l = await vm();
    const lr = await l.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_LIST_FAIL: 'journal/' } });
    assert.equal(lr.status, 1);
    assert.match(lr.stdout, /^❌ \[RS8\] [\s\S]*わけ: バケットの削除の記録の一覧を読めません。/m);
    assert.ok(!l.calls().some((c) => c.includes('run replay') || c.startsWith('systemctl start')));
  });
  it('RS1, RS2 and RS5 failures stop the restore with their codes (finding 13)', async () => {
    for (const [code, env, after] of [['RS1', { STUB_SYSTEMCTL_STATUS: '1' }, 'flock -w 900 9'], ['RS2', { STUB_STOP_FAIL: '1' }, 'COPY'], ['RS5', { STUB_DROPDB_FAIL: '1' }, 'exec db pg_restore']]) {
      const h = await vm();
      const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: /** @type {Record<string, string>} */ (env) });
      assert.equal(r.status, 1, String(code));
      assert.match(r.stdout, new RegExp(`^❌ \\[${code}\\] `, 'm'), r.out);
      assert.ok(!h.calls().some((c) => c.includes(String(after))), `${code}: stopped before ${after}`);
      assert.ok(!h.calls().some((c) => c.includes('deploy-stack')), String(code));
      // Review round 2, finding 2: before RS5 the database is unchanged, so everything held is put back (systemd answers
      // nothing at RS1 here, so the trap says what to run); from RS5 on all of it stays held.
      if (code === 'RS2') released(r, h);
      if (code === 'RS1') {
        assert.match(r.stdout, /DB はまだ変えていません。控えのタイマーか、VM の再起動のときの起動を、元に戻せませんでした。`sudo systemctl enable risepath-stack\.service` と/);
        assert.ok(!fs.existsSync(markOf(h)), 'RS1: the marker removed');
      }
      if (code === 'RS5') held(r, h);
    }
  });
  it('RS0 on a rebuilt VM without the backup units (手順書 16.3): the failing 事前チェック names LAUNCH_STAGE=setup, not install-backup.sh first (finding 25)', async () => {
    const rebuilt = await vm();
    const r = await rebuilt.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_PREFLIGHT_STATUS: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^❌ \[RS0\] [\s\S]*わけ: 事前チェックにエラーがあります（上の行）。この VM には控えのタイマーがまだありません。新しい VM（手順書 16\.3）で、エラーが R1 と R3 だけなら、戻し終わるまで launch-record\.env の LAUNCH_STAGE を setup にします（install-backup\.sh は、戻したあとに実行します）。/m);
    const installed = await vm();
    fs.mkdirSync(path.join(installed.root, 'etc/systemd/system'), { recursive: true });
    for (const u of UNITS) fs.writeFileSync(path.join(installed.root, 'etc/systemd/system', u), '');
    const r2 = await installed.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_PREFLIGHT_STATUS: '1' } });
    assert.match(r2.stdout, /わけ: 事前チェックにエラーがあります（上の行）。先にそれを直します。/);
    assert.doesNotMatch(r2.stdout, /LAUNCH_STAGE/);
  });
  it('--from takes a Japan day (finding 21): the 03:30 backup of 01-05 has the UTC stamp 01-04T1830', async () => {
    const h = await vm();
    const from = setDir(h);
    const to = path.join(h.bucket, 'daily/2026-01-04T183000Z');
    fs.renameSync(from, to);
    const m = path.join(to, 'manifest.json');
    fs.writeFileSync(m, fs.readFileSync(m, 'utf8').replace(/"createdAt": "[^"]+"/, '"createdAt": "2026-01-04T18:30:05Z"'));
    h.seal(to);
    const wrong = await h.run('restore-db.sh', ['--from', '2026-01-04', '--yes-replace-production-database'], { input: 'yes\nyes\n' });
    assert.match(wrong.stdout, /^❌ \[RS4\] /m);
    h.reset();
    const r = await h.run('restore-db.sh', ['--from', '2026-01-05', '--yes-replace-production-database'], { input: 'no\n' });
    assert.ok(h.calls().includes('curl get daily/2026-01-04T183000Z/db.dump.rpbk'), r.out);
  });
  it('without --yes-replace-production-database, --from, or root, or with a failing 事前チェック: nothing is touched', async () => {
    for (const [args, env, needle] of [
      [['--from', 'newest'], {}, 'yes-replace-production-database'],
      [['--yes-replace-production-database'], {}, '--from で'],
      [[...ARGS], { STUB_UID: '1000' }, 'sudo を付けて'],
      [['--from', 'last-week', '--yes-replace-production-database'], {}, 'newest か'],
      [[...ARGS], { STUB_PREFLIGHT_STATUS: '1' }, '事前チェックにエラー'],
    ]) {
      const h = await vm();
      const r = await h.run('restore-db.sh', /** @type {string[]} */ (args), { input: 'yes\nyes\n', env: /** @type {Record<string, string>} */ (env) });
      assert.equal(r.status, 1, String(needle));
      assert.match(r.stdout, /^❌ \[RS0\] /m);
      assert.ok(r.stdout.includes(String(needle)), String(needle));
      assert.ok(!h.calls().some((c) => c.startsWith('systemctl') || c.startsWith('compose')), String(needle));
    }
  });
});

describe('review round 2 of Stage 5: a restore held across a reboot, tokens, the bucket\'s key id, DR5\'s band, install messages', { skip, concurrency: true }, () => {
  /** A VM harness with one set and one hourly journal in the bucket; then the calls are reset. */
  const vm = async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    fs.writeFileSync(path.join(h.stubDir, 'journal.csv'), `${JOURNAL_HEADER}\naccount,aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa,2099-01-01T00:00:00.000000Z,self,,,,\n`);
    assert.equal((await h.run('backup.sh', ['journal'])).status, 0);
    h.reset();
    return h;
  };
  const ARGS = ['--from', 'newest', '--yes-replace-production-database'];
  it('finding 2: a restore stopped after RS5 survives a reboot (no backup, the boot unit off, R9\'s marker); the same command continues from the marker and puts the boot unit back', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_REPLAY_YES_STATUS: '3' } });
    assert.equal(r.status, 1, r.out);
    // The marker: on the disk (it outlives a reboot), 0644 (the 事前チェック reads it as the deploy user), fixed lines.
    const mark = fs.readFileSync(markOf(h), 'utf8');
    assert.match(mark, /^started=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\nstack=enabled\ndbChanged=1\n$/m);
    assert.equal(fs.statSync(markOf(h)).mode & 0o777, 0o644);
    assert.ok(h.calls().includes('systemctl disable risepath-stack.service'));
    // "After a reboot": the timers fire again (Persistent=true); backup.sh makes no backup and records nothing.
    h.reset();
    const lastOk = hoursAgo(40);
    h.setStatus({ lastOk });
    const daily = await h.run('backup.sh', ['daily']);
    assert.equal(daily.status, 0, daily.out);
    assert.match(daily.stdout, /^ℹ️  本番の DB を戻している途中です（restore-db\.sh。\/var\/lib\/risepath-backup\/restore-in-progress があります）。戻し終わるまで、控えは作りません（手順書 16\.2）。$/m);
    assert.ok(!h.calls().some((c) => c.includes('pg_dump') || c.startsWith('curl put') || c.includes('flock -n 9')), h.calls().join('\n'));
    assert.equal(h.status().lastFail, undefined);
    // The journal makes no export either, but still says (JO2) that no daily backup was made: a marker left behind is never silent.
    const journal = await h.run('backup.sh', ['journal']);
    assert.equal(journal.status, 0, journal.out);
    assert.ok(!h.calls().some((c) => c.includes('COPY')));
    assert.match(journal.stdout, /^⚠️ \[JO2\] /m);
    assert.equal(h.webhooks().length, 1);
    // The same command again: the marker says the boot unit was enabled, although it is disabled now.
    h.reset();
    const again = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_STACK_ENABLED: '0' } });
    assert.equal(again.status, 0, again.out);
    assert.match(again.stdout, /前の戻しの続きです（日本時間 \d{4}-\d\d-\d\d \d\d:\d\d に始めた戻し）。/);
    inOrder(h.calls(), ['--yes as=deploy', 'systemctl enable risepath-stack.service', 'systemctl start risepath-backup.timer', 'pg_dump', 'deploy-stack as=deploy']);
    assert.ok(!fs.existsSync(markOf(h)));
    assert.notEqual(String(h.status().lastOk), lastOk, 'RS10 backed up the restored database (the marker was gone)');
  });
  it('finding 2: a boot unit that was not enabled is neither disabled nor enabled', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_STACK_ENABLED: '0' } });
    assert.equal(r.status, 0, r.out);
    assert.ok(!h.calls().some((c) => /^systemctl (?:disable|enable) /.test(c)), h.calls().join('\n'));
  });
  it('finding 2: R9 — the marker stops a deploy (error) and is a warning when the 事前チェック runs alone (RS0 of the same command again)', async () => {
    const { checkStack } = await import('../../scripts/deploy/preflight-rules.mjs');
    const { buildInput } = await import('./helpers/preflightFixtures.js');
    const r9 = (/** @type {Record<string, unknown>} */ facts) => checkStack(buildInput('pilot', { facts })).filter((f) => f.code === 'R9').map((f) => f.level);
    assert.deepEqual(r9({ restoreInProgress: true, from: 'deploy' }), ['E']);
    assert.deepEqual(r9({ restoreInProgress: true, from: 'standalone' }), ['W']);
    assert.deepEqual(r9({ restoreInProgress: false, from: 'deploy' }), []);
    const preflight = read('deploy/risepath-vm/scripts/preflight.sh');
    assert.match(preflight, /^BACKUP_RESTORE="\$\{BACKUP_STATUS%\/\*\}\/restore-in-progress"$/m, 'the same file as backup-common.sh\'s BK_RESTORE_MARK');
    assert.match(SCRIPT.common, /^BK_RESTORE_MARK="\$\{BK_STATE\}\/restore-in-progress"$/m);
    assert.match(SCRIPT.common, /^BK_STATE="\$\{BK_ROOT\}\/var\/lib\/risepath-backup"/m);
    assert.match(preflight, /^BACKUP_STATUS=\/var\/lib\/risepath-backup\/status\.json$/m);
  });
  it('finding 3: RS8 and the set\'s download take a fresh token for each object (a token that expires after two requests)', async () => {
    const h = await vm();
    // More hourly journals: a set several days old has many.
    for (let i = 0; i < 3; i += 1) assert.equal((await h.run('backup.sh', ['journal'])).status, 0);
    h.reset();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_TOKEN_USES: '2' } });
    assert.equal(r.status, 0, r.out);
    const calls = h.calls();
    assert.ok(!calls.includes('curl expired'), calls.join('\n'));
    assert.ok(calls.filter((c) => c.startsWith('curl get journal/')).length >= 5, 'four hourly journals and the pre-restore export');
    calls.forEach((c, i) => {
      if (/^curl get (?:journal\/|daily\/[^/]+\/(?:manifest\.json\.rpbk|db\.dump\.rpbk|uploads\.tar\.rpbk)$)/.test(c)) assert.equal(calls[i - 1], 'curl token', `a fresh token before ${c}`);
    });
    noToken(h, r.out);
  });
  it('finding 3: the drill\'s download too', async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    h.reset();
    const r = await h.run('restore-drill.sh', [], { env: { STUB_TOKEN_USES: '2' } });
    assert.equal(r.status, 0, r.out);
    assert.ok(!h.calls().includes('curl expired'));
    noJsonLog(h);
  });
  it('finding 4: install-backup.sh reads the key id of the newest complete set only; a stray name is passed over, an unreadable key id stops (IB5)', async () => {
    const source = harness();
    assert.equal((await source.run('backup.sh', ['daily'])).status, 0);
    const keyFile = (/** @type {ReturnType<typeof makeHarness>} */ h) => path.join(h.root, 'etc/risepath-backup/backup.key');
    const rebuilt = harness({ key: null });
    fs.cpSync(source.bucket, rebuilt.bucket, { recursive: true });
    // A stray or planted name sorts above every real stamp (`t` > `2`), with no key id in it.
    fs.mkdirSync(path.join(rebuilt.bucket, 'daily/tmp-check'), { recursive: true });
    fs.writeFileSync(path.join(rebuilt.bucket, 'daily/tmp-check/manifest.json'), '{\n  "format": "rpbk-manifest/1"\n}\n');
    const r1 = await rebuilt.run('install-backup.sh', ['--new-key']);
    assert.equal(r1.status, 1, r1.out);
    assert.match(r1.stdout, /^❌ \[IB5\] [\s\S]*わけ: このバケットには、ほかの鍵で作った控えがあります/m);
    assert.ok(!fs.existsSync(keyFile(rebuilt)), 'no new key over another key\'s sets');
    // A whole set (all four objects) planted under a name that is no stamp, with another key's id: never the newest set.
    const stray = path.join(rebuilt.bucket, 'daily/zz-planted');
    fs.cpSync(path.join(rebuilt.bucket, 'daily', source.objects('daily/')[0].split('/')[1]), stray, { recursive: true });
    fs.writeFileSync(path.join(stray, 'manifest.json'), fs.readFileSync(path.join(stray, 'manifest.json'), 'utf8').replace(/"keyId": "[0-9a-f]+"/, '"keyId": "ffffffffffffffff"'));
    const r2 = await rebuilt.run('install-backup.sh', ['--import-key'], { input: `${KEY_HEX}\n` });
    assert.equal(r2.status, 0, r2.out);
    assert.doesNotMatch(r2.stderr, /バケットに控えがありません/);
    assert.match(r2.stdout, /^✅ 鍵を戻しました（key id [0-9a-f]{16}）。$/m);
    // A complete set at a newer stamp of the right form whose manifest has no readable key id: not an empty bucket.
    const broken = harness({ key: null });
    fs.cpSync(source.bucket, broken.bucket, { recursive: true });
    const stamp = source.objects('daily/')[0].split('/')[1];
    const newer = path.join(broken.bucket, 'daily/2099-01-01T000000Z');
    fs.cpSync(path.join(broken.bucket, 'daily', stamp), newer, { recursive: true });
    const m = path.join(newer, 'manifest.json');
    fs.writeFileSync(m, fs.readFileSync(m, 'utf8').replace(/"keyId": "[0-9a-f]+"/, '"keyId": "unreadable"'));
    for (const args of [['--new-key'], ['--import-key']]) {
      const r = await broken.run('install-backup.sh', args, { input: `${KEY_HEX}\nyes\n` });
      assert.equal(r.status, 1, `${args}: ${r.out}`);
      assert.match(r.stdout, /^❌ \[IB5\] [\s\S]*わけ: バケットのいちばん新しい控えの目録（manifest\.json）から、鍵の key id を読めません。鍵は変えていません。/m, String(args));
      assert.ok(!fs.existsSync(keyFile(broken)), String(args));
    }
  });
  it('finding 6: DR5\'s band — 1000 rows pass at 990 and 1010 and fail at 989 and 1011 (1 %); 5 rows pass at 0 and 10 and fail at 11 (at least 5)', async () => {
    const live = '1000,5,30,12,8,3,1,2,22';
    const swap = (/** @type {number} */ i, /** @type {number} */ n) => live.split(',').map((v, k) => (k === i ? String(n) : v)).join(',');
    /** @type {Array<[string, string | null]>} */
    const cases = [[swap(0, 1010), null], [swap(0, 990), null], [swap(0, 1011), 'auth.users'], [swap(0, 989), 'auth.users'],
      [swap(1, 10), null], [swap(1, 0), null], [swap(1, 11), 'user_profiles']];
    await Promise.all(cases.map(async ([drill, table]) => {
      const h = harness();
      assert.equal((await h.run('backup.sh', ['daily'], { env: { STUB_COUNTS: live } })).status, 0);
      const r = await h.run('restore-drill.sh', [], { env: { STUB_COUNTS: live, STUB_DRILL_COUNTS: drill } });
      if (table === null) assert.equal(r.status, 0, `${drill}: ${r.out}`);
      else {
        assert.equal(r.status, 1, `${drill}: ${r.out}`);
        assert.ok(r.stdout.includes('❌ [DR5] ') && r.stdout.includes(`わけ: 表 ${table} の行の数が、目録の数とちがいます。`), `${drill}: ${r.out}`);
      }
    }));
  });
  it('finding 7: a first backup that fails without a step of its own says 「手順 不明」 and the journalctl line; a step left from an earlier attempt is not shown', async () => {
    const h = harness({ key: null });
    h.setStatus({ lastFail: hoursAgo(30), lastFailStep: 'BK7' });
    // systemctl start does nothing here (STUB_SERVICE_RUNS unset): the unit failed before backup.sh recorded anything.
    const r = await h.run('install-backup.sh', ['--new-key']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /^❌ 最初の控えが失敗しました（手順 不明）。\n {3}直し方: `sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。$/m);
    assert.doesNotMatch(r.stdout, /\[BK7\]/);
  });
  it('finding 8: --import-key on an empty bucket points to the plain install, not to a restore', async () => {
    const h = harness({ key: null });
    const r = await h.run('install-backup.sh', ['--import-key'], { input: `${KEY_HEX}\nyes\n` });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /^ {3}次に `sudo \.\/scripts\/install-backup\.sh` を何も付けずに実行します（戻す控えはありません）。$/m);
    assert.doesNotMatch(r.stdout, /先に DB を控えから戻し/);
    // With sets in the bucket, the restore comes first (手順書 16.3).
    const source = harness();
    assert.equal((await source.run('backup.sh', ['daily'])).status, 0);
    const rebuilt = harness({ key: null });
    fs.cpSync(source.bucket, rebuilt.bucket, { recursive: true });
    const r2 = await rebuilt.run('install-backup.sh', ['--import-key'], { input: `${KEY_HEX}\n` });
    assert.match(r2.stdout, /手順書 16\.3 のとおり、先に DB を控えから戻し/);
    assert.doesNotMatch(r2.stdout, /戻す控えはありません/);
  });
  it('finding 9: the days in install-backup.sh\'s messages are BACKUP_RETENTION_DAYS, not a fixed 30', async () => {
    const env = `BACKUP_BUCKET=${BUCKET}\nBACKUP_RETENTION_DAYS=45\n`;
    const source = harness({ backupEnv: env });
    assert.equal((await source.run('backup.sh', ['daily'])).status, 0);
    const rebuilt = harness({ key: null, backupEnv: env });
    fs.cpSync(source.bucket, rebuilt.bucket, { recursive: true });
    const r = await rebuilt.run('install-backup.sh', ['--new-key', '--replace-key'], { env: { STUB_SERVICE_RUNS: '1' } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /前の鍵は、その控えがバケットから消えるまで（ライフサイクルの 45 日と、消したあと戻せる 7 日ほど）しまっておきます。/);
    assert.match(r.stdout, /^ {2}4\. バケットのライフサイクル（45 日で消す。backup\.env の BACKUP_RETENTION_DAYS と同じ日数）を確かめます（手順書 3\.8）。$/m);
    assert.doesNotMatch(r.stdout, /30 日/);
    assert.doesNotMatch(code(SCRIPT.install), /30 日/);
  });
  it('finding 15: RS6 without the uploads volume names 手順書 6.1', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', [...ARGS, '--with-uploads'], { input: 'yes\nyes\n', env: { STUB_VOLUME: '' } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /^❌ \[RS6\] [\s\S]*わけ: uploads のボリュームがありません（先に手順書 6\.1 のデプロイをします）。/m);
  });
  it('finding 1: the uploads restore (RS6) has no json-file log either', async () => {
    const h = await vm();
    const r = await h.run('restore-db.sh', [...ARGS, '--with-uploads'], { input: 'yes\nyes\n' });
    assert.equal(r.status, 0, r.out);
    assert.ok(h.calls().some((c) => c.startsWith('tar extract')));
    noJsonLog(h);
  });
});

describe('review round 3 of Stage 5: empty journals, a reboot with db stopped, the lock, config reads, counts by name, messages', { skip, concurrency: true }, () => {
  /** A VM harness with one set and one hourly journal in the bucket; then the calls are reset. */
  const vm = async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    fs.writeFileSync(path.join(h.stubDir, 'journal.csv'), `${JOURNAL_HEADER}\naccount,aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa,2099-01-01T00:00:00.000000Z,self,,,,\n`);
    assert.equal((await h.run('backup.sh', ['journal'])).status, 0);
    h.reset();
    return h;
  };
  const ARGS = ['--from', 'newest', '--yes-replace-production-database'];
  const lockOf = (/** @type {ReturnType<typeof makeHarness>} */ h) => path.join(h.root, 'run/risepath-backup.lock');
  /** Holds the backup lock from another process (real flock) until the returned function is called. @param {ReturnType<typeof makeHarness>} h */
  const holdLock = async (h) => {
    assert.ok(REAL_FLOCK, 'util-linux flock');
    const holder = spawn(REAL_FLOCK, [lockOf(h), 'sleep', '120'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 200 && spawnSync(REAL_FLOCK, ['-n', lockOf(h), 'true']).status === 0; i += 1) await new Promise((r) => setTimeout(r, 25));
    assert.equal(spawnSync(REAL_FLOCK, ['-n', lockOf(h), 'true']).status, 1, 'the lock is held');
    return () => { try { process.kill(-/** @type {number} */ (holder.pid), 'SIGKILL'); } catch { /* gone */ } };
  };
  it('finding 1: --current-db-lost with no journal after the dump: RS8 hands the replay the header only (0 rows), warns, and the restore ends with exit 0', async () => {
    const h = harness();
    assert.equal((await h.run('backup.sh', ['daily'])).status, 0);
    h.reset();
    const r = await h.run('restore-db.sh', [...ARGS, '--current-db-lost'], { input: 'yes\nyes\n', env: { STUB_PG_READY: '1' } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /^ {3}読んだ記録: 戻す前の書き出しから 0、バケットから 0$/m);
    assert.match(r.stdout, /^⚠️  控えのあとの削除の記録が、VM にもバケットにもありません（0 行として確かめます）。控えのあとに受けた削除があっても、当て直せません。事故の記録に書きます（手順書 16\.2）。$/m);
    for (const f of ['replay-list.csv', 'replay-yes.csv']) assert.equal(fs.readFileSync(path.join(h.stubDir, f), 'utf8'), `${JOURNAL_HEADER}\n`, f);
    inOrder(h.calls(), ['dropdb', 'run replay --since', '--yes as=deploy', 'deploy-stack as=deploy']);
    // The real replay reads that CSV as 0 rows and exits 0 (an empty file would be exit 1: 「1 行目が読めません」).
    const { parseJournal, run } = await import('../../scripts/replay-deletions.mjs');
    const handed = fs.readFileSync(path.join(h.stubDir, 'replay-list.csv'));
    assert.deepEqual(parseJournal(handed.toString('utf8')), []);
    /** @type {string[]} */
    const lines = [];
    const deps = /** @type {any} */ ({ state: {}, log: (/** @type {string} */ l) => lines.push(l) });
    assert.equal(await run(['--since', '2026-11-02T18:23:00Z'], { stdin: Readable.from([handed]), deps }), 0, lines.join('\n'));
    assert.ok(lines.includes('当てる: account 0、progress 0、lesson 0'), lines.join('\n'));
    assert.equal(await run(['--since', '2026-11-02T18:23:00Z'], { stdin: Readable.from([Buffer.alloc(0)]), deps }), 1);
  });
  it('finding 2: a held restore after a reboot (db stopped by the boot unit\'s ExecStop): the same command starts only db, then goes on to the end', async () => {
    const h = await vm();
    const first = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n', env: { STUB_REPLAY_YES_STATUS: '3' } });
    assert.equal(first.status, 1, first.out);
    assert.match(fs.readFileSync(markOf(h), 'utf8'), /^dbChanged=1$/m);
    // "The reboot": every container stopped by hand; nothing starts them (the boot unit is disabled).
    for (const args of [ARGS, [...ARGS, '--current-db-lost']]) {
      if (!fs.existsSync(markOf(h))) break;
      h.reset();
      const again = await h.run('restore-db.sh', args, { input: 'yes\nyes\n', env: { STUB_DB_STOPPED: '1' } });
      assert.equal(again.status, 0, again.out);
      assert.match(again.stdout, /^==> DB のコンテナだけを動かします（RS3。ほかの部品は止めたままです）$/m);
      const calls = h.calls();
      inOrder(calls, ['compose[risepath] stop api mcp mcp-public cloudflared as=deploy', 'compose[risepath] up -d --no-deps db as=deploy', 'exec db pg_isready', 'COPY',
        'dropdb', 'exec db pg_restore', '--yes as=deploy', 'deploy-stack as=deploy', 'compose[risepath] up -d as=deploy']);
      // Before the replay only db was started: no api, mcp, mcp-public or cloudflared.
      const ups = calls.filter((c, i) => i < at(calls, '--yes as=deploy') && c.startsWith('compose[') && / up /.test(c));
      assert.deepEqual(ups, ['compose[risepath] up -d --no-deps db as=deploy'], calls.join('\n'));
      assert.ok(!fs.existsSync(markOf(h)));
    }
    // A run that finds db running starts nothing (the full-order test also counts a single up).
    const running = await vm();
    assert.equal((await running.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' })).status, 0);
    assert.ok(!running.calls().some((c) => c.includes('up -d --no-deps db')));
  });
  it('finding 3: journal --keep-local with the lock busy (real flock, held by another process) is JO1 and exit 1, never a skip; the hourly journal and the daily still skip', async () => {
    const h = harness();
    const release = await holdLock(h);
    try {
      const r = await h.run('backup.sh', ['journal', '--keep-local', 'pre-restore-x']);
      assert.equal(r.status, 1, r.out);
      assert.match(r.stdout, /^❌ \[JO1\] [\s\S]*わけ: 控えのロック（\/run\/risepath-backup\.lock）を取れません。/m);
      assert.doesNotMatch(r.stdout, /今回はしません/);
      assert.ok(!fs.existsSync(path.join(h.root, 'var/backups/risepath/pre-restore-x')) || fs.readdirSync(path.join(h.root, 'var/backups/risepath/pre-restore-x')).length === 0);
      for (const mode of ['journal', 'daily']) {
        const skip = await h.run('backup.sh', [mode]);
        assert.equal(skip.status, 0, `${mode}: ${skip.out}`);
        assert.match(skip.stdout, /ほかの控えの処理が動いているので、今回はしません/, mode);
      }
    } finally {
      release();
    }
  });
  it('finding 6: an export that answers 0 but leaves no file on the VM stops RS3 before dropdb (put back as unchanged); with --current-db-lost it is a warning', async () => {
    /** A backup.sh whose `journal --keep-local` answers 0 and writes nothing (as a skipped run would). @param {ReturnType<typeof makeHarness>} h */
    const silentExport = (h) => {
      const real = path.join(h.stack, 'scripts/backup-real.sh');
      fs.renameSync(path.join(h.stack, 'scripts/backup.sh'), real);
      fs.writeFileSync(path.join(h.stack, 'scripts/backup.sh'), `#!/usr/bin/env bash\nif [[ "$1" == journal ]]; then echo 'ℹ️  skipped'; exit 0; fi\nexec bash "${real}" "$@"\n`, { mode: 0o755 });
    };
    const h = await vm();
    silentExport(h);
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /^❌ \[RS3\] [\s\S]*わけ: 書き出しは 0 で終わりましたが、書き出したファイルが VM にありません。/m);
    assert.ok(!h.calls().some((c) => c.includes('dropdb')));
    assert.match(r.stdout, /DB はまだ変えていません。控えのタイマーと、VM の再起動のときの起動は、元に戻しました。/);
    assert.ok(!fs.existsSync(markOf(h)));
    const lost = await vm();
    silentExport(lost);
    const l = await lost.run('restore-db.sh', [...ARGS, '--current-db-lost'], { input: 'yes\nyes\n' });
    assert.equal(l.status, 0, l.out);
    assert.match(l.stdout, /^⚠️  書き出しは 0 で終わりましたが、書き出したファイルが VM にありません（--current-db-lost）。/m);
    assert.match(l.stdout, /読んだ記録: 戻す前の書き出しから 0、バケットから 1/);
  });
  it('finding 4: bk_env_value takes the last assignment; when that line is not a safe value it gives nothing, never an earlier line\'s value', async () => {
    const h = harness();
    const value = (/** @type {string} */ text) => {
      const f = path.join(h.dir, 'probe.env');
      fs.writeFileSync(f, text);
      const r = spawnSync('bash', ['-c', `set -Eeuo pipefail; STACK_DIR="${h.stack}"; source "${path.join(h.stack, 'scripts/backup-common.sh')}"; v="$(bk_env_value BACKUP_BUCKET "${f}")"; printf '[%s]' "$v"`], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    assert.equal(value('BACKUP_BUCKET=old-bucket\nBACKUP_BUCKET=$NEW\n'), '[]');
    assert.equal(value('BACKUP_BUCKET=old-bucket\nBACKUP_BUCKET=new bucket\n'), '[]');
    assert.equal(value('BACKUP_BUCKET=old-bucket\nBACKUP_BUCKET=\n'), '[]');
    assert.equal(value('BACKUP_BUCKET=old-bucket\nexport BACKUP_BUCKET="new-bucket" # note\n'), '[new-bucket]');
    assert.equal(value("BACKUP_BUCKET='q-bucket'\nBACKUP_BUCKET_OLD=zz\n# BACKUP_BUCKET=zz\nOTHER=1\n"), '[q-bucket]');
    assert.equal(value('BACKUP_BUCKET=my-bucket\r\n'), '[my-bucket]');
    assert.equal(value('OTHER=1\n'), '[]');
    // backup.sh then has no bucket (BK1), as bash and compose would not read the older one.
    const d = harness({ backupEnv: `BACKUP_BUCKET=${BUCKET}\nBACKUP_BUCKET=$OTHER_BUCKET\n` });
    const r = await d.run('backup.sh', ['daily']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /^❌ \[BK1\] [\s\S]*わけ: backup\.env にバケットの名前（BACKUP_BUCKET）がないか、形がちがいます/m);
    assert.deepEqual(d.objects(), []);
  });
  it('finding 5: a set made before a table was added to BK_TABLES (and the order changed) still drills and restores; counts are matched by name', async () => {
    const h = await vm();
    // A later checkout: a tenth table, and two tables swapped.
    const common = path.join(h.stack, 'scripts/backup-common.sh');
    const later = ['user_profiles', 'auth.users', ...TABLES.slice(2), 'review_log'];
    fs.writeFileSync(common, fs.readFileSync(common, 'utf8').replace(/^BK_TABLES=\([^)]*\)$/m, `BK_TABLES=(${later.join(' ')})`));
    const drill = await h.run('restore-drill.sh');
    assert.equal(drill.status, 0, drill.out);
    assert.match(drill.stdout, /^✅ 戻す練習は成功しました（日本時間 .+ の控え、表 9 つ、ファイル 3 個）。$/m);
    // The SQL follows this checkout's BK_TABLES (user_profiles first now), only for the set's own tables.
    const sql = h.calls().find((c) => c.startsWith('drill psql') && c.includes('count(*)')) ?? '';
    assert.ok(sql.startsWith('drill psql SELECT (SELECT count(*) FROM user_profil'), sql);
    // A count off in one table is named by that table, whatever its position.
    const counts = COUNTS.split(',');
    counts[TABLES.indexOf('account_deletions')] = '500';
    const off = await h.run('restore-drill.sh', [], { env: { STUB_DRILL_COUNTS: counts.join(',') } });
    assert.equal(off.status, 1, off.out);
    assert.ok(off.stdout.includes('わけ: 表 account_deletions の行の数が、目録の数とちがいます。'), off.out);
    h.reset();
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' });
    assert.equal(r.status, 0, r.out);
    const c = COUNTS.split(',');
    assert.match(r.stdout, new RegExp(`^ {2}アカウント ${c[0]}、レッスンの記録 ${c[2]}、アカウントの削除の記録 ${c[6]}$`, 'm'));
    // A sealed manifest whose counts cannot be read: the drill refuses it (DR1), the restore shows 不明 and goes on.
    const odd = await vm();
    const dir = path.join(odd.bucket, 'daily', odd.objects('daily/')[0].split('/')[1]);
    const m = path.join(dir, 'manifest.json');
    fs.writeFileSync(m, fs.readFileSync(m, 'utf8').replace(/"countsAfter": \[[^\]]*\]/, '"countsAfter": [1, 2]'));
    odd.seal(dir);
    const d = await odd.run('restore-drill.sh');
    assert.equal(d.status, 1, d.out);
    assert.match(d.stdout, /^❌ \[DR1\] /m);
    const rr = await odd.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' });
    assert.equal(rr.status, 0, rr.out);
    assert.match(rr.stdout, /^ {2}アカウント 不明、レッスンの記録 不明、アカウントの削除の記録 不明$/m);
  });
  it('finding 8: JO2 prints the configured days as its reason; no text gives a fixed number of days', async () => {
    const h = harness({ backupEnv: `BACKUP_BUCKET=${BUCKET}\nBACKUP_RETENTION_DAYS=45\n` });
    h.setStatus({ lastOk: hoursAgo(40) });
    const r = await h.run('backup.sh', ['journal']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /^⚠️ \[JO2\] [^\n]+\n {3}わけ: バケットのライフサイクルは 45 日です（backup\.env の BACKUP_RETENTION_DAYS）。$/m);
    const runbook = read('doc/guides/first-launch.ja.md');
    for (const c of ['BK8', 'JO2']) {
      const row = runbook.split('\n').find((l) => l.startsWith(`| ${c} |`)) ?? '';
      assert.ok(row && !/いまは|30 日/.test(row), `${c}: ${row}`);
    }
    assert.doesNotMatch(code(SCRIPT.common) + code(SCRIPT.backup), /いまは 30 日/);
  });
  it('finding 10: the marker rewrite right before dropdb failing is RS1 (nothing changed): everything is put back, no RS5 line', async () => {
    const h = await vm();
    // A run that stopped hard at RS4 (power loss: no trap) left a marker with dbChanged=0; its rewrite now fails.
    fs.writeFileSync(markOf(h), '# x\nstarted=2026-11-02T18:00:00Z\nstack=enabled\ndbChanged=0\n', { mode: 0o644 });
    fs.mkdirSync(`${markOf(h)}.tmp`);
    const r = await h.run('restore-db.sh', ARGS, { input: 'yes\nyes\n' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /前の戻しの続きです/);
    assert.match(r.stdout, /^❌ \[RS1\] 戻しの途中の印を書くか、[\s\S]*わけ: 戻しの途中の印（\/var\/lib\/risepath-backup\/restore-in-progress）を書けません（DB はまだ変えていません）。/m);
    assert.doesNotMatch(r.stdout, /\[RS5\]|戻しが途中です/);
    assert.ok(!h.calls().some((c) => c.includes('dropdb')));
    assert.match(r.stdout, /⚠️  DB はまだ変えていません。控えのタイマーと、VM の再起動のときの起動は、元に戻しました。/);
    assert.ok(!fs.existsSync(markOf(h)), 'the marker removed');
    assert.ok(h.calls().includes('systemctl enable risepath-stack.service'));
  });
  it('finding 11: key-id and check-copy say the key is missing only when it is; a key whose id cannot be computed is IB0', async () => {
    const h = harness();
    for (const cmd of ['key-id', 'check-copy']) {
      const r = await h.run('install-backup.sh', [cmd], { input: `${KEY_HEX}\n`, env: { STUB_CRYPT_FAIL: '1' } });
      assert.equal(r.status, 1, `${cmd}: ${r.out}`);
      assert.match(r.stdout, /^❌ \[IB0\] [\s\S]*わけ: この VM の鍵の key id を計算できません（Docker で node のイメージを動かせないか、鍵のファイルの形がちがいます）。鍵は変えていません。/m, cmd);
      assert.doesNotMatch(r.stdout, /\[IB5\]|鍵がありません/, cmd);
    }
    const none = harness({ key: null });
    for (const cmd of ['key-id', 'check-copy']) {
      const r = await none.run('install-backup.sh', [cmd], { input: `${KEY_HEX}\n` });
      assert.equal(r.status, 1);
      assert.match(r.stdout, /^❌ \[IB5\] [\s\S]*わけ: この VM に鍵がありません（手順書 6\.4）。/m, cmd);
    }
    const ok = await h.run('install-backup.sh', ['key-id']);
    assert.match(ok.stdout, /^key id: [0-9a-f]{16}$/m);
  });
  it('finding 12: 13 章\'s JO1 names the five kinds the journal exports, and the journal\'s SQL has exactly those five', () => {
    const row = read('doc/guides/first-launch.ja.md').split('\n').find((l) => l.startsWith('| JO1 |')) ?? '';
    for (const words of ['アカウントの削除', '学習の記録の消去', '1 つのレッスンのやり直し', '保護者の同意の取り消し', 'AI アプリの切断']) assert.ok(row.includes(words), words);
    assert.deepEqual([...SCRIPT.backup.matchAll(/SELECT '(\w+)'/g)].map((m) => m[1]), ['account', 'progress', 'lesson', 'consent', 'grant']);
  });
  it('findings 1 and 13: the journal header is one text (COPY\'s columns, backup-common.sh, the replay); every Slack line names `journalctl … -n 50`', async () => {
    const { HEADER } = await import('../../scripts/replay-deletions.mjs');
    assert.match(SCRIPT.common, new RegExp(`^BK_JOURNAL_HEADER='${HEADER.join(',')}'$`, 'm'));
    assert.equal(JOURNAL_HEADER, HEADER.join(','));
    const select = /SELECT ('account' AS kind,[\s\S]*?)\n\s+FROM account_deletions/.exec(SCRIPT.backup)?.[1] ?? '';
    assert.deepEqual(select.split(',').map((x) => x.trim()).map((x) => /\bAS (\w+)$/.exec(x)?.[1] ?? x), [...HEADER]);
    const posts = [...code(SCRIPT.backup).matchAll(/bk_post ["']([^\n]+)/g)].map((m) => m[1]);
    assert.equal(posts.length, 2);
    for (const p of posts) assert.match(p, /\\?`sudo journalctl -u [^`\\]+ -n 50\\?`/);
  });
});

describe('provision-gce.sh: the service account commands only when needed (review round 3, finding 9)', { skip }, () => {
  /** @param {Record<string, string>} env @param {boolean} exists */
  const provision = (env, exists) => {
    const dir = fs.mkdtempSync(path.join(harness().dir, 'gce-'));
    const log = path.join(dir, 'gcloud.log');
    fs.writeFileSync(path.join(dir, 'gcloud'), `#!/usr/bin/env bash\necho "gcloud $*" >> "${log}"\nif [[ "$1 $2 $3" == "compute instances describe" ]]; then if [[ "$*" == *--format* ]]; then printf '%s\\n' "\${STUB_SA:-}"; exit "\${STUB_SA_STATUS:-0}"; fi; exit ${exists ? 0 : 1}; fi\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(log, '');
    const r = spawnSync('bash', [path.join(STACK, 'scripts/provision-gce.sh')], { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}`, HOME: dir, GCP_PROJECT: 'demo-proj', ...env }, encoding: 'utf8' });
    return { ...r, calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  };
  const SA = 'risepath-backup@demo-proj.iam.gserviceaccount.com';
  const COMMANDS = /gcloud compute instances set-service-account risepath-vm/;
  it('an existing VM without BACKUP_SA_EMAIL that already runs as another account: no warning, no commands', () => {
    const r = provision({ STUB_SA: SA }, true);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ℹ️  VM はもうあり、GCE のふつうのサービスアカウントではないアカウント（risepath-backup@demo-proj\.iam\.gserviceaccount\.com）で動いています。何も変えていません。$/m);
    assert.doesNotMatch(r.stdout, /⚠️|これでは控えを送れません/);
    assert.doesNotMatch(r.stdout, COMMANDS);
    assert.ok(r.calls.some((c) => c.includes("--format=value(serviceAccounts[0].email)")), r.calls.join('\n'));
  });
  it('an existing VM on GCE\'s default account: the warning and the commands (手順書 4.1); unreadable: the commands, only if needed', () => {
    const d = provision({ STUB_SA: '123456789-compute@developer.gserviceaccount.com' }, true);
    assert.match(d.stdout, /^⚠️  BACKUP_SA_EMAIL がないので、VM は GCE のふつうのサービスアカウントで動きます。これでは控えを送れません。$/m);
    assert.match(d.stdout, /次の 3 つを順に実行します（VM が止まります。手順書 4\.1）:/);
    assert.match(d.stdout, COMMANDS);
    const u = provision({ STUB_SA_STATUS: '1' }, true);
    assert.match(u.stdout, /^ℹ️  VM はもうあるので、サービスアカウントは変えていません（VM のアカウントを読めませんでした）。$/m);
    assert.match(u.stdout, /控えのアカウントが付いていないときだけ、次の 3 つを順に実行します（VM が止まります。手順書 4\.1）:/);
    assert.doesNotMatch(u.stdout, /⚠️/);
    // BACKUP_SA_EMAIL already the VM's account: nothing to do.
    const same = provision({ BACKUP_SA_EMAIL: SA, STUB_SA: SA }, true);
    assert.match(same.stdout, /^ℹ️  VM はもう BACKUP_SA_EMAIL のアカウントで動いています（何も変えていません）。$/m);
    assert.doesNotMatch(same.stdout, COMMANDS);
  });
  it('every place that prints the commands names 手順書 4.1, as the catalog\'s BK7 and IB4 do', () => {
    const text = code(read('deploy/risepath-vm/scripts/provision-gce.sh'));
    const refs = [...text.matchAll(/順に実行します（[^）]*手順書 ([\d.]+)）/g)].map((m) => m[1]);
    assert.ok(refs.length >= 3, String(refs));
    assert.deepEqual([...new Set(refs)], ['4.1']);
    for (const c of ['BK7', 'IB4']) assert.ok(String(BACKUP_CODES.find((b) => b.code === c)?.fix).includes('手順書 4.1 の 3 つのコマンド'), c);
  });
});
