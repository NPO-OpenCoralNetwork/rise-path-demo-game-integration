// @ts-check
// The by-hand path after a restore stopped at RS8 on consent or grant rows (Phase 9, D4; Scope guard TR9a: the replay
// stops with exit 2 and 「エージェントと手で戻します（手順書 16.2）」, and the automatic replay of those two kinds is plan
// 13.5). Stage 5's review accepted the stop as fail-closed because the by-hand path would be written down; it lives in
// deploy/risepath-vm/README.md 「戻しが RS8 で止まったとき」, and runbook 16.2 sends the agent there. These tests run the
// README's own commands in the backup stub harness (the RS8 lines of restore-db.sh it points at, the two greps) and
// check its SQL and RS10 commands against the schema, the revoke route, the journal export and the restore script.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HEADER, STOP_CONSENT_GRANT, isoMicros, parseJournal, planReplay } from '../../scripts/replay-deletions.mjs';
import { ROOT, makeHarness } from './helpers/backupHarness.js';

const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const README = read('deploy/risepath-vm/README.md');
const HEADING = '### 戻しが RS8 で止まったとき（保護者の同意の取り消しか、AI アプリの切断の記録）';
const SECTION = README.slice(README.indexOf(HEADING), README.indexOf('## CI での予行（Phase 7）'));
const RESTORE = read('deploy/risepath-vm/scripts/restore-db.sh');
/** A numbered step of the section. @param {number} n */
const step = (n) => SECTION.slice(SECTION.indexOf(`\n${n}. **`), n < 5 ? SECTION.indexOf(`\n${n + 1}. **`) : undefined);
/** The `code` spans of a text, in order. @param {string} text */
const spans = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** The RS8 lines the README points at: from `FROM_STAMP=` to the `読んだ記録:` echo, as restore-db.sh has them. */
function rs8Lines(/** @type {string} */ script) {
  const lines = script.split('\n');
  const from = lines.findIndex((l) => l.startsWith('FROM_STAMP='));
  const to = lines.findIndex((l) => l.startsWith('echo "   読んだ記録:'));
  assert.ok(from > 0 && to > from, 'restore-db.sh still has both anchors, in order');
  return lines.slice(from, to + 1).join('\n');
}

const bash4 = spawnSync('bash', ['-c', 'declare -A x=(); x[a]=1; : "${x[a],,}"']).status === 0;
const skip = bash4 && process.platform === 'linux' ? false : 'needs bash ≥ 4 and Linux (GNU date), as on the VM';

/** @type {Array<ReturnType<typeof makeHarness>>} */
const harnesses = [];
after(() => { for (const h of harnesses) h.cleanup(); });

describe('runbook 16.2 sends the agent to the written by-hand path (TR9a)', () => {
  it('the README has the section in its 控え chapter, and 16.2 and the replay\'s stop line point to it', () => {
    assert.ok(SECTION.startsWith(HEADING), 'the heading');
    assert.ok(README.indexOf(HEADING) > README.indexOf('## 控え（バックアップ、Phase 9）'), 'inside the 控え chapter');
    const runbook = read('doc/guides/first-launch.ja.md');
    const s162 = runbook.slice(runbook.indexOf('### 16.2 '), runbook.indexOf('### 16.3 '));
    assert.match(s162, /\[VM の README の「戻しが RS8 で止まったとき」\]\(\.\.\/\.\.\/deploy\/risepath-vm\/README\.md\)のとおりに手で当て直します/u);
    assert.ok(STOP_CONSENT_GRANT.includes('手順書 16.2'), 'the replay sends the owner to 16.2');
    for (const n of [1, 2, 3, 4, 5]) assert.ok(step(n).length > 20, `step ${n}`);
  });
});

describe('step 1: the README\'s commands rebuild RS8\'s journal (stub harness)', () => {
  it('names the variables the RS8 lines read, and nothing else is needed from restore-db.sh', () => {
    const s1 = spans(step(1));
    assert.deepEqual(s1.slice(0, 10), [
      'sudo -i',
      'cd /opt/risepath/deploy/risepath-vm',
      'SCRIPT_DIR=$PWD/scripts STACK_DIR=$PWD REPO_ROOT=/opt/risepath',
      'source scripts/backup-common.sh',
      'bk_tmp',
      'OWNER="$(stat -c %U /opt/risepath)"',
      'SINCE=<「控えの始まり」の UTC の時刻>',
      'BUCKET="$(bk_bucket)"',
      'WORK="${BK_TMP}"',
      'scripts/restore-db.sh',
    ]);
    assert.ok(step(1).includes('`FROM_STAMP=` の行から、`読んだ記録:` を出す `echo` の行まで'));
    // Every variable the RS8 lines read comes from backup-common.sh, the README's list, or the lines themselves.
    const lines = rs8Lines(RESTORE);
    const used = new Set([...lines.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    const own = new Set([...lines.matchAll(/(?:^|[\s;(])([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]).concat(['file', 'name', 'BASH_REMATCH']));
    const common = new Set([...read('deploy/risepath-vm/scripts/backup-common.sh').matchAll(/^(BK_[A-Z_]+)=/gm)].map((m) => m[1]));
    const readme = new Set(['SINCE', 'BUCKET', 'WORK']);
    for (const v of used) assert.ok(own.has(v) || common.has(v) || readme.has(v), `RS8 reads ${v}, which step 1 does not set`);
  });

  it('runs: the window\'s pre-restore export and bucket journals, decrypted after one header; step 3\'s grep leaves a journal the replay applies', { skip }, async () => {
    const h = makeHarness();
    harnesses.push(h);
    const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    const CLIENT = '44444444-4444-4444-8444-444444444444';
    const CONSENT = '55555555-5555-4555-8555-555555555555';
    const SINCE = '2026-11-01T03:00:00Z';
    const journal = (/** @type {string[]} */ ...rows) => `${HEADER.join(',')}\n${rows.join('\n')}\n`;
    // Before the window (its stamp is older than SINCE − 15 minutes): never read.
    const old = journal(`progress,${U[2]},2026-11-01T01:59:00.000000Z,,,,,`);
    const inWindow = journal(`lesson,${U[0]},2026-11-01T03:40:00.000000Z,,,course-a,lesson-1,`, `grant,${U[1]},2026-11-01T03:50:00.000000Z,,,,,${CLIENT}`);
    const pre = journal(`account,${U[2]},2026-11-01T04:30:00.000000Z,self,,,,`, `consent,${U[0]},2026-11-01T04:40:00.000000Z,,,,,${CONSENT}`);
    const put = (/** @type {string} */ rel, /** @type {string} */ csv) => {
      fs.mkdirSync(path.dirname(rel), { recursive: true });
      fs.writeFileSync(rel, h.encrypt(csv));
    };
    put(path.join(h.bucket, 'journal/2026-11-01/2026-11-01T020000Z.csv.rpbk'), old);
    put(path.join(h.bucket, 'journal/2026-11-01/2026-11-01T040000Z.csv.rpbk'), inWindow);
    put(path.join(h.root, 'var/backups/risepath/pre-restore-x/2026-11-01T050000Z-0a1b2c.csv.rpbk'), pre);

    // The README's step 1 as written (the VM's /opt/risepath is the harness's checkout), the RS8 lines of the
    // harness's restore-db.sh, then step 2's and step 3's greps, also as written.
    const s1 = spans(step(1));
    const greps = [...spans(step(2)), ...spans(step(3))].filter((c) => c.startsWith('grep '));
    assert.deepEqual(greps, [`grep -E '^(consent|grant),' "\${BK_TMP}/journal.csv" | sort -u`, `grep -v -E '^(consent|grant),' "\${BK_TMP}/journal.csv" > "\${BK_TMP}/rest.csv"`]);
    const vm = (/** @type {string} */ c) => c.replaceAll('/opt/risepath/deploy/risepath-vm', h.stack).replaceAll('/opt/risepath', h.repo);
    const script = [
      'set -Eeuo pipefail',
      ...s1.slice(1, 9).map((c) => (c.startsWith('SINCE=') ? `SINCE=${SINCE}` : vm(c))),
      rs8Lines(fs.readFileSync(path.join(h.stack, 'scripts/restore-db.sh'), 'utf8')),
      `${greps[0]} > "\${BK_TMP}/stop.csv"`,
      greps[1],
      'printf "%s\\n" "${BK_TMP}"',
    ].join('\n');
    fs.writeFileSync(path.join(h.stack, 'scripts/byhand.sh'), script, { mode: 0o755 });
    const r = await h.run('byhand.sh');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /読んだ記録: 戻す前の書き出しから 1、バケットから 1/u);
    const tmp = r.stdout.trim().split('\n').at(-1) ?? '';
    assert.ok(tmp.startsWith(path.join(h.root, 'run/risepath-backup.')), tmp);
    const all = fs.readFileSync(path.join(tmp, 'journal.csv'), 'utf8');
    assert.equal(all.split('\n')[0], HEADER.join(','), 'one header first');
    assert.ok(!all.includes('2026-11-01T01:59:00'), 'the journal before the window is not read');
    const since = /** @type {bigint} */ (isoMicros(SINCE));
    const full = planReplay(parseJournal(all), since);
    assert.deepEqual(full.stop.map((row) => row.kind).sort(), ['consent', 'grant'], 'the whole journal stops the replay (as RS8 did)');
    // Step 2's list holds the two rows to apply by hand, with the ids the SQL takes.
    const stop = fs.readFileSync(path.join(tmp, 'stop.csv'), 'utf8').trim().split('\n');
    assert.deepEqual(stop, [`consent,${U[0]},2026-11-01T04:40:00.000000Z,,,,,${CONSENT}`, `grant,${U[1]},2026-11-01T03:50:00.000000Z,,,,,${CLIENT}`]);
    // Step 3's journal: the replay no longer stops, and applies the other rows in the window.
    const rest = planReplay(parseJournal(fs.readFileSync(path.join(tmp, 'rest.csv'), 'utf8')), since);
    assert.equal(rest.stop.length, 0);
    assert.deepEqual(rest.apply.map((row) => row.kind), ['lesson', 'account']);
  });
});

describe('step 2: the SQL matches the schema, the revoke route and the journal export', () => {
  const s2 = step(2);
  const consent = /`(UPDATE account_consents SET revoked_at = now\(\) WHERE id = '<ref_id>' AND user_id = '<user_id>' AND revoked_at IS NULL;)`/.exec(s2)?.[1];
  const grant = /`INSERT INTO auth\.users \(id\) VALUES \('<user_id>'\) ON CONFLICT \(id\) DO NOTHING; (INSERT INTO mcp_oauth_grants \(([^)]+)\) VALUES \('<user_id>', '<ref_id>', NULL, NULL, NULL, now\(\)\) ON CONFLICT \(user_id, client_id\) DO UPDATE SET revoked_at = now\(\);)`/.exec(s2);
  it('names the CSV columns as the journal writes them', () => {
    assert.ok(s2.includes(`\`${HEADER.join(',')}\``));
    assert.ok(read('deploy/risepath-vm/scripts/backup-common.sh').includes(`BK_JOURNAL_HEADER='${HEADER.join(',')}'`));
  });
  it('ref_id is the consent id and the AI app\'s client id (backup.sh\'s journal export)', () => {
    const backup = read('deploy/risepath-vm/scripts/backup.sh');
    assert.match(backup, /SELECT 'consent', user_id::text, %TIME\(revoked_at\)%, NULL, NULL, NULL, NULL, id::text\n\s+FROM account_consents /);
    assert.match(backup, /SELECT 'grant', user_id::text, %TIME\(revoked_at\)%, NULL, NULL, NULL, NULL, client_id::text\n\s+FROM mcp_oauth_grants /);
    assert.ok(s2.includes('`consent`（`ref_id` は同意の id）') && s2.includes('`grant`（`ref_id` は AI アプリの client id。'));
  });
  it('consent: one consent by id, only while it is still active (migration 014\'s columns)', () => {
    assert.ok(consent, 'the consent UPDATE');
    const m014 = read('server/migrations/014_minor_safeguards.sql');
    for (const col of ['id             uuid        PRIMARY KEY', 'user_id        uuid        NOT NULL', 'revoked_at     timestamptz NULL']) assert.ok(m014.includes(col), col);
  });
  // Review round 1 of Stage 6, finding 2: the verifier refuses only tokens issued before revoked_at, so a restored row
  // that still holds an older revoke (before the dump) must be moved to now, as the revoke route always does. Keeping the
  // old time would let tokens from a reconnect between that revoke and the journal's revoke through again.
  it('grant: the revoke route\'s own upsert (same columns, same conflict key), and it always moves the revoke to now', () => {
    assert.ok(grant, 'the grant INSERT');
    assert.doesNotMatch(s2, /mcp_oauth_grants\.revoked_at IS NULL/, 'no guard that keeps an older revoke');
    const route = read('server/routes/connectedApps.js');
    assert.match(route, new RegExp(`INSERT INTO mcp_oauth_grants \\(${grant[2]}\\)`), 'the same column list as POST /:clientId/revoke');
    assert.match(route, /ON CONFLICT \(user_id, client_id\) DO UPDATE\s+SET revoked_at = now\(\)/);
    assert.doesNotMatch(route, /DO UPDATE[^`]*WHERE mcp_oauth_grants\.revoked_at IS NULL/, 'the route moves an earlier revoke too');
    assert.match(read('server/migrations/015_mcp_oauth_grants.sql'), /PRIMARY KEY \(user_id, client_id\)/);
    // Why: revoked_at is a cutoff (tokens issued after it pass: a new consent).
    assert.match(read('mcp-server/oauthVerifier.js'), /revoked_at IS NOT NULL AND revoked_at > to_timestamp\(\$3\)/);
    assert.ok(s2.includes('`mcp-server/oauthVerifier.js` は、取り消しの時刻より前に出たトークンを断ります'), 'the README says why');
  });
  // Review round 3 of Stage 6, finding 1: a learner who first signed in after the dump has no auth.users stub in the
  // restored database, and mcp_oauth_grants.user_id references it, so the grant INSERT alone fails with a foreign-key
  // error and the revoke is never recorded. The README writes the stub first, in the same -c (one transaction), as the
  // app (server/db.js ensureAuthUser) and the re-open path (tools/core/accountDeletions.js) do. Real-PG proof of a user
  // with no stub: SP/p9/build/s6r3/pg/grant-proof.txt (the old statement: FK error; the README's: INSERT 0 1 twice).
  it('grant: the auth.users stub first, in the same -c, as the app writes it; the README says what each output means', () => {
    const both = /`(INSERT INTO auth\.users \(id\) VALUES \('<user_id>'\) ON CONFLICT \(id\) DO NOTHING;) INSERT INTO mcp_oauth_grants /.exec(s2);
    assert.ok(both, 'the stub statement opens the grant line');
    const stub = both[1].replace("'<user_id>'", '$1::uuid').replace(/;$/, '');
    assert.ok(read('server/db.js').includes(`'${stub}'`), 'server/db.js ensureAuthUser writes the same stub');
    assert.ok(read('tools/core/accountDeletions.js').includes(`'${stub}'`), 'accountDeletions.js writes the same stub');
    assert.match(read('server/migrations/015_mcp_oauth_grants.sql'), /user_id\s+uuid\s+NOT NULL REFERENCES auth\.users\(id\)/, 'the foreign key the stub satisfies');
    assert.match(read('server/migrations/000_extensions_and_auth.sql'), /CREATE TABLE IF NOT EXISTS auth\.users \(\n\s+id UUID PRIMARY KEY,\n\s+created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)\n\);/, 'id is the only column without a default');
    assert.ok(s2.includes('`grant` は 2 つの文を 1 つの `-c` に入れます'), 'one -c: one transaction, so an error changes nothing');
    assert.ok(s2.includes('控えのあとに、はじめてログインした学習者は、戻した DB にこの行がなく'), 'why');
    assert.match(s2, /`grant` では 2 行出ます。1 行目（ID の行）は `INSERT 0 1` か `INSERT 0 0`（もうあったとき）で、2 行目が `INSERT 0 1` なら、取り消しが記録されています。`ERROR` の行が出たら、何も変わっていません。その行を事故の記録に写して止めます（3 には進みません）。/u);
  });
});

describe('steps 3-5: the replay, RS10 and RS11 as restore-db.sh does them', () => {
  it('step 3 runs the replay as the checkout\'s owner, first without and then with --yes', () => {
    const s3 = step(3);
    assert.ok(s3.includes('`runuser -u "${OWNER}" -- docker compose --env-file stack.env run --rm --no-deps -T api node scripts/replay-deletions.mjs --since "${SINCE}" < "${BK_TMP}/rest.csv"`'));
    assert.ok(s3.indexOf('`--yes`') > s3.indexOf('数を見ます'));
    assert.match(RESTORE, /owner_compose run --rm --no-deps -T api node scripts\/replay-deletions\.mjs --since "\$\{SINCE\}" < "\$\{CSV\}"/);
  });
  /** Step 4's commands (its `code` spans that hold a space: the names and the marker's path are not commands). */
  const step4 = () => spans(step(4)).filter((c) => c.includes(' '));
  it('step 4 is RS10 (the boot unit only when it was enabled, the marker, the enabled timers only, one backup); step 5 deploys without sudo and cleans /run', () => {
    assert.deepEqual(step4(), [
      'if [[ "$(bk_restore_field stack)" == enabled ]]; then systemctl enable risepath-stack.service; fi',
      'rm "${BK_RESTORE_MARK}"',
      'for t in risepath-backup.timer risepath-backup-journal.timer; do if [[ "$(systemctl is-enabled "$t" 2> /dev/null)" == enabled ]]; then systemctl start "$t"; fi; done',
      './scripts/backup.sh daily',
    ]);
    assert.ok(step(4).includes('`/var/lib/risepath-backup/restore-in-progress`'), 'the marker named for the reader');
    const common = read('deploy/risepath-vm/scripts/backup-common.sh');
    assert.match(common, /^BK_STATE="\$\{BK_ROOT\}\/var\/lib\/risepath-backup"/m);
    assert.match(common, /^BK_RESTORE_MARK="\$\{BK_STATE\}\/restore-in-progress"$/m);
    assert.match(common, /"started=\$1" "stack=\$2" "dbChanged=\$3"/, 'the marker keeps the boot unit\'s state as stack=');
    // restore-db.sh's RS10, which step 4 copies: the boot unit as the marker says, the timers that were enabled, backup.sh daily.
    assert.match(RESTORE, /if \[\[ "\$\{stack\}" == enabled \]\]; then systemctl enable risepath-stack\.service/);
    assert.match(RESTORE, /if \[\[ "\$\{enabled\}" == enabled \]\]; then ENABLED_TIMERS\+=\("\$\{timer\}"\); fi/);
    assert.match(RESTORE, /for timer in \$\{ENABLED_TIMERS\[@\]\+"\$\{ENABLED_TIMERS\[@\]\}"\}; do\n\s+systemctl start "\$\{timer\}"/);
    assert.match(RESTORE, /"\$\{SCRIPT_DIR\}\/backup\.sh" daily \|\| RS10_FAILED=1/);
    assert.doesNotMatch(step(4), /systemctl start risepath-backup\.service/, 'no unit a rebuilt VM does not have');
    const s5 = step(5);
    assert.ok(s5.includes('`bk_cleanup_tmp`') && s5.includes('sudo を付けずに `./scripts/deploy-stack.sh`'));
  });
  // Review round 2 of Stage 6, finding 3: on a VM rebuilt by runbook 16.3 the backup units do not exist yet (--import-key
  // installs none), so starting them fails; step 4 must start only the enabled timers and back up with backup.sh itself.
  for (const [label, env, started] of /** @type {[string, Record<string, string>, string[]][]} */ ([
    ['a VM rebuilt by 16.3 (no backup unit yet)', { STUB_UNITS_LOADED: '', STUB_TIMERS_ENABLED: '' }, []],
    ['a VM with both timers enabled', {}, ['systemctl start risepath-backup.timer', 'systemctl start risepath-backup-journal.timer']],
  ])) {
    it(`step 4 runs as written on ${label}: the boot unit back, the marker gone, ${started.length ? 'both timers started' : 'no timer started'}, one daily backup`, { skip }, async () => {
      const h = makeHarness();
      harnesses.push(h);
      const vm = (/** @type {string} */ c) => c.replaceAll('/opt/risepath/deploy/risepath-vm', h.stack).replaceAll('/opt/risepath', h.repo);
      const script = [
        'set -Eeuo pipefail',
        // Step 1's first commands (the folder, the variables, backup-common.sh), then the marker RS1 wrote (stack=enabled).
        ...spans(step(1)).slice(1, 4).map(vm),
        'bk_restore_write "$(bk_now)" enabled 1',
        ...step4(),
      ].join('\n');
      fs.writeFileSync(path.join(h.stack, 'scripts/rs10byhand.sh'), script, { mode: 0o755 });
      const r = await h.run('rs10byhand.sh', [], { env });
      assert.equal(r.status, 0, r.out);
      const calls = h.calls();
      assert.ok(calls.includes('systemctl enable risepath-stack.service'), 'the boot unit enabled again');
      assert.equal(fs.existsSync(path.join(h.root, 'var/lib/risepath-backup/restore-in-progress')), false, 'the marker is gone');
      assert.deepEqual(calls.filter((c) => c.startsWith('systemctl start ')), started);
      assert.equal(h.objects('daily/').filter((o) => o.endsWith('/manifest.json')).length, 1, 'one daily set of the restored database');
    });
  }
});
