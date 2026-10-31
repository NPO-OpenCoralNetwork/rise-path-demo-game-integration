// @ts-check
// A stub harness for the backup and restore scripts (Phase 9, D4; design §5.10): a copy of
// deploy/risepath-vm/scripts/{backup,backup-common,install-backup,restore-drill,restore-db}.sh in a temp checkout,
// RISEPATH_BACKUP_TEST_ROOT for /etc, /var and /run, and stubs on PATH for docker, curl, systemctl, runuser, stat, id,
// df and git. The stubs log every call in order (calls.log), keep a fake bucket in a folder, and run the real
// scripts/deploy/backup-crypt.mjs for the crypt container (its read-only mounts mapped back to the host), so sets,
// journals and manifests are real rpbk1 files. preflight.sh and deploy-stack.sh are recorders. flock logs its call and
// runs the real util-linux flock (review round 3, finding 6: a stub that always grants the lock let the lock sharing
// between restore-db.sh and its RS3 export go untested); STUB_FLOCK_BUSY=1 still makes `flock -n` fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const STACK = path.join(ROOT, 'deploy/risepath-vm');
export const SCRIPTS = ['backup.sh', 'backup-common.sh', 'install-backup.sh', 'restore-drill.sh', 'restore-db.sh'];
export const UNITS = ['risepath-backup.service', 'risepath-backup.timer', 'risepath-backup-journal.service', 'risepath-backup-journal.timer', 'risepath-backup-alert@.service'];
/** A sentinel access token: it must never appear in any output, log or argv. */
export const TOKEN = 'ya29.SENTINEL-TOKEN-0123456789abcdef';
export const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SENTINELHOOK';
export const BUCKET = 'demo-proj-risepath-backup';
export const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
export const OTHER_KEY_HEX = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
/** The fake row counts of the nine tables (BK2, BK4) and the migrations (BK6). */
export const COUNTS = '5,4,30,12,8,3,1,2,22';
export const MIGRATIONS = ['000_init', '001_more', '021_training_cohorts'];
/** The fake uploads archive's listing: 3 files. */
export const TAR_LIST = './\n./a.pdf\n./sub/\n./sub/b.pdf\n./c.png\n';
export const JOURNAL_HEADER = 'kind,user_id,time,requested_by,reopened_at,course_slug,lesson_id,ref_id';

const realStat = ['/usr/bin/stat', '/bin/stat'].find((p) => fs.existsSync(p)) ?? 'stat';
/** util-linux flock (on the VM, on the CI runners and here); the tests that need real locking assert it is found. */
export const REAL_FLOCK = ['/usr/bin/flock', '/bin/flock'].find((p) => fs.existsSync(p)) ?? '';
/** BK_TABLES as backup-common.sh has it: the fake database answers each table's count by name. */
export const TABLES = /** @type {string[]} */ (/^BK_TABLES=\(([^)]*)\)$/m.exec(fs.readFileSync(path.join(ROOT, 'deploy/risepath-vm/scripts/backup-common.sh'), 'utf8'))?.[1].split(' ') ?? []);

const DOCKER_STUB = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const env = process.env;
const log = (line) => fs.appendFileSync(env.STUB_LOG, line + '\\n');
fs.appendFileSync(env.STUB_ARGV, JSON.stringify(['docker', ...args]) + '\\n');
const stdin = () => { try { return fs.readFileSync(0); } catch { return Buffer.alloc(0); } };
const as = env.STUB_AS_USER ? ' as=' + env.STUB_AS_USER : '';
const fail = (code) => process.exit(code);
// STUB_COUNTS: the live database's counts of the nine tables in TABLES' order (BK2, BK4: the manifest's before and
// after); STUB_DRILL_COUNTS the throwaway database's (DR5). Each table asked is answered by its name (review round 3,
// finding 5); a table that is not one of the nine has STUB_NEW_TABLE_COUNT rows (default 7).
const TABLES = ${JSON.stringify(TABLES)};
const sqlAnswer = (sql, drill) => {
  if (/count\\(\\*\\)/.test(sql)) {
    const list = (drill ? env.STUB_DRILL_COUNTS || env.STUB_COUNTS || ${JSON.stringify(COUNTS)} : env.STUB_COUNTS || ${JSON.stringify(COUNTS)}).split(',');
    const asked = [...sql.matchAll(/count\\(\\*\\) FROM ([a-z_.]+)\\)/g)].map((m) => m[1]);
    return asked.map((t) => (TABLES.includes(t) ? list[TABLES.indexOf(t)] : env.STUB_NEW_TABLE_COUNT || '7')).join(',') + '\\n';
  }
  if (/SHOW server_encoding/.test(sql)) return (drill ? env.STUB_DRILL_ENCODING || 'UTF8' : 'UTF8') + '\\n';
  if (/FROM schema_migrations/.test(sql)) return (drill && env.STUB_DRILL_MIGRATIONS !== undefined ? env.STUB_DRILL_MIGRATIONS : ${JSON.stringify(MIGRATIONS.join('\n'))}) + '\\n';
  return '';
};
if (args[0] === 'image' || args[0] === 'info') fail(0);
if (args[0] === 'volume') { log('docker volume ls'); process.stdout.write(env.STUB_VOLUME === undefined ? 'risepath_uploads\\n' : env.STUB_VOLUME); fail(0); }
// The drill container's state: STUB_DIR/drill-db exists while "our" container (label risepath.drill=1) exists;
// STUB_LEFTOVER=1 starts with one; STUB_FOREIGN=1 means another container (no label) holds the name.
const drillFile = env.STUB_DIR + '/drill-db';
if (env.STUB_LEFTOVER === '1' && !fs.existsSync(env.STUB_DIR + '/leftover-used')) { fs.writeFileSync(drillFile, ''); fs.writeFileSync(env.STUB_DIR + '/leftover-used', ''); }
if (args[0] === 'inspect') {
  log('docker inspect');
  if (fs.existsSync(drillFile)) { process.stdout.write('1\\n'); fail(0); }
  if (env.STUB_FOREIGN === '1') { process.stdout.write('\\n'); fail(0); }
  fail(1);
}
if (args[0] === 'rm') {
  log('docker rm ' + args.slice(1).join(' '));
  if (env.STUB_RM_FAIL === '1') fail(1);
  fs.rmSync(drillFile, { force: true });
  fail(0);
}
if (args[0] === 'run') {
  const at = args.findIndex((a, i) => i > 0 && !a.startsWith('-') && !['--mount', '--name', '--label', '--network', '--security-opt', '--pids-limit', '--memory', '--cap-drop', '--user', '--log-driver', '-e'].includes(args[i - 1]));
  const image = args[at];
  const cmd = args.slice(at + 1);
  if (cmd[0] === 'node' && cmd[1] === '/crypt/backup-crypt.mjs') {
    log('crypt ' + cmd.slice(2).join(' '));
    // STUB_CRYPT_FAIL=1: Docker cannot run the node image (the key file itself is fine).
    if (env.STUB_CRYPT_FAIL === '1') fail(125);
    const mounts = args.filter((a, i) => args[i - 1] === '--mount').map((m) => Object.fromEntries(m.split(',').map((kv) => kv.split('='))));
    const mapped = cmd.slice(1).map((a) => { for (const m of mounts) if (a === m.dst || a.startsWith(m.dst + '/')) return m.src + a.slice(m.dst.length); return a; });
    const r = spawnSync(process.execPath, mapped, { stdio: 'inherit' });
    fail(r.status ?? 1);
  }
  if (cmd[0] === 'tar' && cmd.includes('-cvf')) {
    log('tar create ' + args.filter((a, i) => args[i - 1] === '--mount').join(' ') + ' net=' + args[args.indexOf('--network') + 1]);
    if (env.STUB_TAR_FAIL === '1') fail(2);
    process.stdout.write(Buffer.concat([Buffer.from('FAKETAR'), Buffer.alloc(4000, 7)]));
    process.stderr.write(${JSON.stringify(TAR_LIST)});
    fail(0);
  }
  if (cmd[0] === 'tar' && cmd.includes('-tf')) {
    const data = stdin();
    log('tar list ' + data.length + ' net=' + args[args.indexOf('--network') + 1]);
    process.stdout.write(data.subarray(0, 7).toString() === 'FAKETAR' ? (env.STUB_TAR_LIST || ${JSON.stringify(TAR_LIST)}) : '');
    fail(data.subarray(0, 7).toString() === 'FAKETAR' ? 0 : 2);
  }
  if (cmd[0] === 'tar' && cmd.includes('-xf')) { const data = stdin(); log('tar extract ' + data.length + ' ' + args.filter((a, i) => args[i - 1] === '--mount').join(' ')); fail(data.subarray(0, 7).toString() === 'FAKETAR' ? 0 : 2); }
  if (args.includes('-d') && args.includes('risepath-drill-db')) {
    log('drill db run ' + args.slice(1, at).join(' ') + ' image=' + image + ' pw=' + (env.POSTGRES_PASSWORD ? 'set' : 'unset'));
    // The name is taken (a leftover, ours or not) or the run fails: no container of ours is made.
    if (env.STUB_DRILL_RUN_FAIL === '1' || env.STUB_FOREIGN === '1' || fs.existsSync(drillFile)) fail(125);
    fs.writeFileSync(drillFile, '');
    process.stdout.write('0123456789ab\\n');
    fail(0);
  }
  log('docker run ' + args.slice(1).join(' '));
  fail(0);
}
if (args[0] === 'exec') {
  const rest = args.slice(1).filter((a) => a !== '-i');
  const tool = rest[1];
  if (tool === 'pg_isready') { log('drill pg_isready'); fail(0); }
  if (tool === 'pg_restore') {
    const data = stdin();
    log('drill pg_restore ' + data.length + ' ' + rest.slice(2).join(' '));
    fail(data.subarray(0, 5).toString() === 'PGDMP' && env.STUB_DRILL_RESTORE_FAIL !== '1' ? 0 : 1);
  }
  if (tool === 'psql') { const sql = stdin().toString(); log('drill psql ' + sql.trim().slice(0, 40)); process.stdout.write(sqlAnswer(sql, true)); fail(0); }
  log('docker exec ' + rest.join(' '));
  fail(0);
}
if (args[0] === 'compose') {
  let i = 1;
  let project = 'risepath';
  while (i < args.length && ['-p', '--env-file', '-f', '--profile'].includes(args[i])) { if (args[i] === '-p') project = args[i + 1]; i += 2; }
  const sub = args.slice(i);
  const cmd = sub[0] === 'exec' ? sub[sub.length - 1] : '';
  const line = 'compose[' + project + '] ' + (sub[0] === 'exec' ? 'exec ' + sub[2] + ' ' + cmd : sub.join(' ')) + as;
  // STUB_DB_STOPPED=1: db was stopped (a reboot ran the boot unit's ExecStop, \`docker compose stop\`): \`ps\` lists no
  // container and \`exec\` fails until an \`up\` starts it (review round 3, finding 2).
  const dbDown = env.STUB_DB_STOPPED === '1' && !fs.existsSync(env.STUB_DIR + '/db-started');
  if (sub[0] === 'ps') { log(line); process.stdout.write(dbDown ? '' : (env.STUB_DB_HEALTH ?? 'healthy') + '\\n'); fail(0); }
  if (sub[0] === 'up') { fs.writeFileSync(env.STUB_DIR + '/db-started', ''); log(line); fail(0); }
  if (sub[0] === 'exec' && dbDown) { log(line + ' (db not running)'); fail(1); }
  if (sub[0] === 'exec') {
    if (/pg_isready/.test(cmd)) { log(line); fail(env.STUB_PG_READY === '1' ? 1 : 0); }
    if (/pg_dump/.test(cmd)) {
      log(line);
      if (env.STUB_DUMP_SLEEP) { spawnSync('sleep', [env.STUB_DUMP_SLEEP]); }
      process.stdout.write(Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(70000, 3)]));
      fail(env.STUB_DUMP_FAIL === '1' ? 1 : 0);
    }
    if (/dropdb/.test(cmd)) { log(line); fail(env.STUB_DROPDB_FAIL === '1' ? 1 : 0); }
    if (/pg_restore/.test(cmd)) { const data = stdin(); log(line + ' bytes=' + data.length); fail(data.subarray(0, 5).toString() === 'PGDMP' && env.STUB_RESTORE_FAIL !== '1' ? 0 : 1); }
    if (/psql/.test(cmd)) {
      const sql = stdin().toString();
      if (/COPY \\(/.test(sql)) {
        log(line + ' COPY');
        fs.writeFileSync(env.STUB_DIR + '/last-journal.sql', sql);
        if (env.STUB_JOURNAL_FAIL === '1') fail(1);
        process.stdout.write(fs.existsSync(env.STUB_DIR + '/journal.csv') ? fs.readFileSync(env.STUB_DIR + '/journal.csv') : ${JSON.stringify(JOURNAL_HEADER + '\n')});
        fail(0);
      }
      if (/count\\(\\*\\)/.test(sql)) {
        const n = Number(fs.existsSync(env.STUB_DIR + '/counts.n') ? fs.readFileSync(env.STUB_DIR + '/counts.n', 'utf8') : 0) + 1;
        fs.writeFileSync(env.STUB_DIR + '/counts.n', String(n));
        log(line + ' counts');
        if (env.STUB_COUNTS_FAIL_AT === String(n)) fail(2);
      } else log(line + ' ' + sql.trim().slice(0, 40));
      process.stdout.write(sqlAnswer(sql, false));
      fail(0);
    }
    log(line);
    fail(0);
  }
  if (sub[0] === 'run' && sub.includes('replay-deletions.mjs') || sub.includes('scripts/replay-deletions.mjs')) {
    // Where the CSV comes from (stdin is the file restore-db.sh redirects): it must never be under /var/backups.
    let from = '';
    try { from = fs.readlinkSync('/proc/self/fd/0'); } catch { from = 'unknown'; }
    log('replay stdin ' + from);
    const data = stdin();
    const yes = sub.includes('--yes');
    fs.writeFileSync(env.STUB_DIR + '/replay-' + (yes ? 'yes' : 'list') + '.csv', data);
    log('compose[' + project + '] run replay ' + sub.slice(sub.indexOf('--since')).join(' ') + as);
    process.stdout.write('当てる: account 1、progress 0、lesson 0\\n');
    fail(Number(yes ? env.STUB_REPLAY_YES_STATUS || 0 : env.STUB_REPLAY_LIST_STATUS || 0));
  }
  if (sub[0] === 'run') { log(line); fail(env.STUB_MIGRATE_FAIL === '1' ? 1 : 0); }
  if (sub[0] === 'stop') { log(line); fail(env.STUB_STOP_FAIL === '1' ? 1 : 0); }
  log(line);
  fail(0);
}
log('docker ' + args.join(' '));
fail(0);
`;

const CURL_STUB = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.STUB_ARGV, JSON.stringify(['curl', ...args]) + '\\n');
const log = (line) => fs.appendFileSync(env.STUB_LOG, line + '\\n');
const headers = [];
let config = '', upload = '', out = '', data = '', url = '';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-H') headers.push(args[++i]);
  else if (a === '-K') config = args[++i];
  else if (a === '-T') upload = args[++i];
  else if (a === '-o') out = args[++i];
  else if (a === '--data-binary') data = args[++i];
  else if (a === '--max-time') i++;
  else if (/^https?:/.test(a)) url = a;
}
const write = (text) => { if (out && out !== '/dev/null') fs.writeFileSync(out, text); else if (!out) process.stdout.write(text); };
if (config) {
  const target = /url = "([^"]+)"/.exec(fs.readFileSync(config, 'utf8'))?.[1] ?? '';
  const payload = data.startsWith('@') ? fs.readFileSync(data.slice(1), 'utf8') : data;
  fs.appendFileSync(env.STUB_WEBHOOK_LOG, JSON.stringify({ url: target, payload }) + '\\n');
  log('curl webhook');
  process.exit(env.STUB_WEBHOOK_FAIL === '1' ? 22 : 0);
}
// STUB_TOKEN_USES=k: each token is new (the sentinel and a number) and expires after k requests (a cached token with
// minutes left, review round 2 finding 3).
const uses = Number(env.STUB_TOKEN_USES || 0);
if (url.startsWith('http://metadata.google.internal/')) {
  log('curl token');
  if (env.STUB_TOKEN_FAIL === '1') process.exit(22);
  let token = '${TOKEN}';
  if (uses) {
    const genFile = path.join(env.STUB_DIR, 'token.gen');
    const gen = Number(fs.existsSync(genFile) ? fs.readFileSync(genFile, 'utf8') : 0) + 1;
    fs.writeFileSync(genFile, String(gen));
    token += '.g' + gen;
  }
  process.stdout.write('{"access_token":"' + token + '","expires_in":3599,"token_type":"Bearer"}');
  process.exit(0);
}
const auth = headers.filter((h) => h.startsWith('@')).map((h) => fs.readFileSync(h.slice(1), 'utf8')).join('');
const bearer = /Authorization: Bearer (\\S+)/.exec(auth)?.[1] ?? '';
if (!bearer.startsWith('${TOKEN}')) { log('curl unauthorized'); process.exit(22); }
if (uses) {
  const countFile = path.join(env.STUB_DIR, 'token-uses' + bearer.slice('${TOKEN}'.length));
  const n = Number(fs.existsSync(countFile) ? fs.readFileSync(countFile, 'utf8') : 0) + 1;
  fs.writeFileSync(countFile, String(n));
  if (n > uses) { log('curl expired'); process.exit(22); }
}
const bucketDir = env.STUB_BUCKET_DIR;
const u = new URL(url);
const parts = u.pathname.split('/').filter(Boolean);
if (parts[0] === 'storage' && parts[1] === 'v1') {
  if (parts[3] !== '${BUCKET}') process.exit(22);
  if (parts.length === 6) {
    const object = decodeURIComponent(parts[5]);
    log('curl size ' + object);
    const file = path.join(bucketDir, object);
    if (!fs.existsSync(file)) process.exit(22);
    let size = fs.statSync(file).size;
    if (env.STUB_SIZE_LIE && object.includes(env.STUB_SIZE_LIE)) size += 1;
    write('{\\n  "size": "' + size + '"\\n}\\n');
    process.exit(0);
  }
  const prefix = u.searchParams.get('prefix') ?? '';
  log('curl list ' + prefix);
  // STUB_LIST_FAIL: 1 fails every listing, a prefix (journal/, daily/) only that one.
  if (env.STUB_LIST_FAIL === '1' || (env.STUB_LIST_FAIL && prefix.startsWith(env.STUB_LIST_FAIL))) process.exit(22);
  const all = [];
  const walk = (dir, rel) => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(path.join(dir, e.name), r); else all.push(r); } };
  walk(bucketDir, '');
  const names = all.filter((n) => n.startsWith(prefix)).sort();
  const page = Number(env.STUB_PAGE || 1000);
  const start = Number(u.searchParams.get('pageToken') || 0);
  const items = names.slice(start, start + page).map((n) => '    {\\n      "name": "' + n + '",\\n      "size": "' + fs.statSync(path.join(bucketDir, n)).size + '"\\n    }');
  const next = start + page < names.length ? ',\\n  "nextPageToken": "' + (start + page) + '"' : '';
  write(items.length ? '{\\n  "items": [\\n' + items.join(',\\n') + '\\n  ]' + next + '\\n}\\n' : '{}\\n');
  process.exit(0);
}
if (parts[0] !== '${BUCKET}') process.exit(22);
const object = parts.slice(1).join('/');
const file = path.join(bucketDir, object);
if (upload) {
  log('curl put ' + object);
  if (env.STUB_UPLOAD_FAIL && object.includes(env.STUB_UPLOAD_FAIL)) process.exit(22);
  if (fs.existsSync(file) && headers.includes('x-goog-if-generation-match: 0')) process.exit(22);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(upload, file);
  process.exit(0);
}
log('curl get ' + object);
if (!fs.existsSync(file)) process.exit(22);
fs.copyFileSync(file, out);
process.exit(0);
`;

/**
 * @typedef {{ dir: string, repo: string, stack: string, root: string, bucket: string, stubDir: string,
 *   env: Record<string, string>, run: (script: string, args?: string[], opts?: { env?: Record<string, string>, input?: string }) => Promise<RunResult>,
 *   start: (script: string, args?: string[], opts?: { env?: Record<string, string> }) => import('node:child_process').ChildProcess,
 *   calls: () => string[], argv: () => string[][], webhooks: () => Array<{ url: string, payload: string }>, status: () => Record<string, string | boolean>,
 *   setStatus: (fields: Record<string, string | boolean>) => void, reset: () => void, objects: (prefix?: string) => string[], cleanup: () => void,
 *   decrypt: (file: string, keyHex?: string) => Buffer, encrypt: (data: Buffer | string, keyHex?: string) => Buffer,
 *   seal: (setDir: string, keyHex?: string) => void }} Harness
 * @typedef {{ status: number | null, stdout: string, stderr: string, out: string }} RunResult
 */

/**
 * A fresh harness. `stackEnv` replaces the stack.env (default: a VM-like file whose only line the scripts read is
 * the Slack URL); `backupEnv` the backup.env (null: none); `key` the key (null: none).
 * @param {{ stackEnv?: string, backupEnv?: string | null, key?: string | null }} [opts]
 * @returns {Harness}
 */
export function makeHarness({ stackEnv, backupEnv = `BACKUP_BUCKET=${BUCKET}\nBACKUP_KEEP_LOCAL_DAYS=3\nBACKUP_RETENTION_DAYS=30\nBACKUP_ALERT_WEBHOOK_URL=\n`, key = KEY_HEX } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-harness-'));
  const repo = path.join(dir, 'repo');
  const stack = path.join(repo, 'deploy/risepath-vm');
  const root = path.join(dir, 'root');
  const bucket = path.join(dir, 'bucket');
  const stubDir = path.join(dir, 'stub');
  const bin = path.join(dir, 'bin');
  for (const d of [path.join(stack, 'scripts'), path.join(stack, 'systemd'), path.join(stack, 'ci'), path.join(repo, 'scripts/deploy'), path.join(repo, '.git'),
    path.join(root, 'etc/risepath-backup'), path.join(root, 'var/lib/risepath-backup'), path.join(root, 'var/backups'), path.join(root, 'run'), bucket, stubDir, bin]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const f of SCRIPTS) fs.copyFileSync(path.join(STACK, 'scripts', f), path.join(stack, 'scripts', f));
  for (const f of UNITS) fs.copyFileSync(path.join(STACK, 'systemd', f), path.join(stack, 'systemd', f));
  for (const f of ['Dockerfile', 'docker-compose.yml', 'backup.env.example']) fs.copyFileSync(path.join(STACK, f), path.join(stack, f));
  fs.copyFileSync(path.join(STACK, 'ci/stack.ci.env'), path.join(stack, 'ci/stack.ci.env'));
  fs.copyFileSync(path.join(ROOT, 'scripts/deploy/backup-crypt.mjs'), path.join(repo, 'scripts/deploy/backup-crypt.mjs'));
  fs.writeFileSync(path.join(stack, 'stack.env'), stackEnv ?? `NODE_ENV=production\nPOSTGRES_USER=risepath_app\nAI_CAP_ALERT_WEBHOOK_URL=${WEBHOOK}\n`, { mode: 0o600 });
  for (const name of ['preflight', 'deploy-stack']) {
    fs.writeFileSync(path.join(stack, 'scripts', `${name}.sh`), [
      '#!/usr/bin/env bash',
      `echo "${name} as=\${STUB_AS_USER:-none} uid=$(id -u)" >> "$STUB_LOG"`,
      name === 'deploy-stack' ? 'cd "$(dirname "$0")/.." && docker compose --env-file stack.env -f docker-compose.yml up -d' : ':',
      `exit "\${STUB_${name === 'preflight' ? 'PREFLIGHT' : 'DEPLOY'}_STATUS:-0}"`,
    ].join('\n'), { mode: 0o755 });
  }
  if (backupEnv !== null) fs.writeFileSync(path.join(root, 'etc/risepath-backup/backup.env'), backupEnv, { mode: 0o600 });
  if (key !== null) fs.writeFileSync(path.join(root, 'etc/risepath-backup/backup.key'), `${key}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}\n');
  fs.writeFileSync(path.join(bin, 'docker'), DOCKER_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
  const stub = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  stub('flock', `echo "flock $*" >> "$STUB_LOG"; if [[ "$STUB_FLOCK_BUSY" == 1 && " $* " == *" -n "* ]]; then exit 1; fi; ${REAL_FLOCK ? `exec ${REAL_FLOCK} "$@"` : 'exit 0'}`);
  stub('systemctl', [
    'echo "systemctl $*" >> "$STUB_LOG"',
    'case "$1" in',
    // The boot unit risepath-stack.service: enabled unless STUB_STACK_ENABLED=0.
    '  is-enabled) if [[ "$2" == risepath-stack.service ]]; then if [[ "${STUB_STACK_ENABLED:-1}" == 1 ]]; then echo enabled; else echo disabled; exit 1; fi;',
    '    elif [[ ",${STUB_TIMERS_ENABLED-risepath-backup.timer,risepath-backup-journal.timer}," == *",$2,"* ]]; then echo enabled; else echo disabled; exit 1; fi ;;',
    '  is-active) if [[ ",${STUB_TIMERS_ACTIVE-}," == *",$2,"* ]]; then echo active; else echo inactive; exit 3; fi ;;',
    // A unit that is not installed (STUB_UNITS_LOADED, default both timers) cannot be stopped: systemctl exits 5.
    '  stop) for u in "${@:2}"; do if [[ ",${STUB_UNITS_LOADED-risepath-backup.timer,risepath-backup-journal.timer}," != *",$u,"* ]]; then echo "Failed to stop $u: Unit $u not loaded." >&2; exit 5; fi; done ;;',
    // Nor started (a VM rebuilt by 手順書 16.3 has none until install-backup.sh runs; a service is loaded with its timer).
    '  start) for u in "${@:2}"; do case "$u" in risepath-backup.timer|risepath-backup-journal.timer|risepath-backup.service|risepath-backup-journal.service)',
    '      t="${u%.service}"; t="${t%.timer}.timer"; if [[ ",${STUB_UNITS_LOADED-risepath-backup.timer,risepath-backup-journal.timer}," != *",$t,"* ]]; then echo "Failed to start $u: Unit $u not found." >&2; exit 5; fi ;; esac; done',
    '    if [[ "$2" == risepath-backup.service && "$STUB_SERVICE_RUNS" == 1 ]]; then bash "$STUB_REPO/deploy/risepath-vm/scripts/backup.sh" daily >> "$STUB_DIR/service.out" 2>&1; exit $?; fi ;;',
    'esac',
    'exit "${STUB_SYSTEMCTL_STATUS:-0}"',
  ].join('\n'));
  stub('runuser', 'echo "runuser $*" >> "$STUB_LOG"; [[ "$1" == -u && "$3" == -- ]] || exit 1; user="$2"; shift 3; STUB_AS_USER="$user" exec "$@"');
  stub('stat', `if [[ "$1" == -c && "$2" == %U ]]; then echo "\${STUB_OWNER:-deploy}"; exit 0; fi; exec ${realStat} "$@"`);
  stub('id', 'case "$1" in -u) echo "${STUB_UID:-0}" ;; -g) echo 0 ;; *) echo root ;; esac');
  stub('df', 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nstub 200000000 1 ${STUB_DF_KB:-100000000} 1%% /\\n"');
  stub('git', 'echo cccccccccccccccccccccccccccccccccccccccc');
  const files = { log: path.join(dir, 'calls.log'), argv: path.join(dir, 'argv.log'), webhook: path.join(dir, 'webhook.log') };
  const reset = () => {
    for (const f of Object.values(files)) fs.writeFileSync(f, '');
    for (const f of ['counts.n', 'drill-db', 'leftover-used', 'db-started']) fs.rmSync(path.join(stubDir, f), { force: true });
  };
  reset();
  /** @type {Record<string, string>} */
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: dir,
    LANG: 'C.UTF-8',
    RISEPATH_BACKUP_TEST_ROOT: root,
    STUB_LOG: files.log,
    STUB_ARGV: files.argv,
    STUB_WEBHOOK_LOG: files.webhook,
    STUB_BUCKET_DIR: bucket,
    STUB_DIR: stubDir,
    STUB_REPO: repo,
  };
  const read = (/** @type {string} */ f) => fs.readFileSync(f, 'utf8');
  /** The real crypt module. @param {string} mode @param {Buffer} input @param {string} keyHex */
  const crypt = (mode, input, keyHex) => {
    const keyFile = path.join(dir, 'crypt.key');
    fs.writeFileSync(keyFile, keyHex);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/deploy/backup-crypt.mjs'), mode, '--key', keyFile], { input });
    if (r.status !== 0) throw new Error(`${mode} failed: ${r.stderr}`);
    return r.stdout;
  };
  const statusFile = path.join(root, 'var/lib/risepath-backup/status.json');
  return {
    dir, repo, stack, root, bucket, stubDir, env,
    run: (script, args = [], opts = {}) => new Promise((resolve, reject) => {
      // Asynchronous, so the harness suites' tests run side by side (each has its own folders).
      const child = spawn('bash', [path.join(stack, 'scripts', script), ...args], { env: { ...env, ...(opts.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
      child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
      child.on('error', reject);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr, out: stdout + stderr });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input ?? '');
    }),
    start: (script, args = [], opts = {}) => spawn('bash', [path.join(stack, 'scripts', script), ...args], { env: { ...env, ...(opts.env ?? {}) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }),
    calls: () => read(files.log).split('\n').filter(Boolean),
    argv: () => read(files.argv).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    webhooks: () => read(files.webhook).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    status: () => (fs.existsSync(statusFile) ? JSON.parse(read(statusFile)) : {}),
    setStatus: (fields) => {
      const body = Object.entries(fields).map(([k, v]) => `  "${k}": ${typeof v === 'boolean' ? v : `"${v}"`}`).join(',\n');
      fs.writeFileSync(statusFile, `{\n${body}\n}\n`);
    },
    reset,
    objects: (prefix = '') => {
      /** @type {string[]} */
      const all = [];
      const walk = (/** @type {string} */ d, /** @type {string} */ rel) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(path.join(d, e.name), r);
          else all.push(r);
        }
      };
      walk(bucket, '');
      return all.filter((n) => n.startsWith(prefix)).sort();
    },
    decrypt: (file, keyHex = KEY_HEX) => crypt('decrypt', fs.readFileSync(file), keyHex),
    encrypt: (data, keyHex = KEY_HEX) => crypt('encrypt', Buffer.from(data), keyHex),
    // A set's manifest.json sealed again (manifest.json.rpbk), as backup.sh writes it: for a test that edits a manifest.
    seal: (setDir, keyHex = KEY_HEX) => fs.writeFileSync(path.join(setDir, 'manifest.json.rpbk'), crypt('encrypt', fs.readFileSync(path.join(setDir, 'manifest.json')), keyHex)),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** An ISO time `hours` hours ago (seconds precision, like the scripts write). @param {number} hours */
export const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
