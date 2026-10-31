// @ts-check
// The Phase 7 CI scripts (doc/brushup-2026/ai-access-plan.ja.md): scripts/ci/db-checks.sh, the job
// "Database checks" of .github/workflows/e2e.yml and `npm run ci:db`; scripts/ci/stack.sh, its env
// template deploy/risepath-vm/ci/stack.ci.env and scripts/ci/redact-log.mjs, the jobs "Server stack
// deploy" and "Learner end-to-end" and `npm run ci:stack` | `npm run e2e:local`, with the e2e auth
// stand-in's container; and the 00:00 JST guard (scripts/ci/jst-midnight-guard.mjs). The
// checks themselves need Docker and PostgreSQL 16 (the jobs run them); here the scripts' text is
// pinned, and the parts that must stop before any psql or docker call, or that pick the image, run
// against recording stubs. No test waits on a real network call.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JST_OFFSET_S, secondsToJstMidnight, waitPastJstMidnight } from '../../scripts/ci/jst-midnight-guard.mjs';
import { SECRET_KEY, redact, secretValues } from '../../scripts/ci/redact-log.mjs';
import { isPlaceholder } from '../../scripts/ci/scan-secrets.mjs';
import { DEFAULT_PORT as STANDIN_DEFAULT_PORT } from '../../e2e/support/auth-stand-in.mjs';
import { LATEST_ACCEPTANCE_SQL } from '../../tools/core/legalAcceptance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} file */
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const DB_CHECKS = 'scripts/ci/db-checks.sh';
const script = read(DB_CHECKS);
/** The script without its comment lines, so a word in a comment never satisfies a check. */
const code = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
/** The same without the text of echo and die messages: only what the script runs. */
const commands = code.split('\n').map((line) => line.replace(/\b(echo|die \d) "[\s\S]*$/, '$1')).join('\n');
const IMAGE_RE = /pgvector\/pgvector:[^@\s]+@sha256:[0-9a-f]{64}/g;
const IMAGE = (script.match(IMAGE_RE) ?? [])[0] ?? '';
const DIGEST = IMAGE.slice(IMAGE.indexOf('@') + 1);

/**
 * `timeout` (coreutils) runs db-checks.sh's docker-mode stub runs (runStubbed); a Mac without coreutils
 * skips them. runStack puts a pass-through `timeout` of its own on PATH, so the stack.sh runs never
 * depend on the host's coreutils.
 */
const HAS_TIMEOUT = spawnSync('timeout', ['5', 'true']).status === 0;

/**
 * A folder of links to every executable on this PATH but the names in `hide` (the first of each name,
 * as PATH finds it): a PATH without those commands. @param {string} dir @param {string[]} hide
 */
function linkedPath(dir, hide) {
    fs.mkdirSync(dir);
    for (const from of (process.env.PATH ?? '').split(path.delimiter)) {
        /** @type {string[]} */
        let names;
        try { names = fs.readdirSync(from); } catch { continue; }
        for (const name of names) {
            if (hide.includes(name) || fs.existsSync(path.join(dir, name))) continue;
            try { fs.accessSync(path.join(from, name), fs.constants.X_OK); } catch { continue; }
            fs.symlinkSync(path.join(from, name), path.join(dir, name));
        }
    }
    return dir;
}

/**
 * Runs db-checks.sh with recording stubs for docker, psql and node first on PATH. docker fails
 * `container inspect` (no such container) unless `containerExists`, every `pull` whose image is in
 * `failPull`, and with 125 each subcommand in `dockerFails` ('create', 'start'). psql prints
 * `psql (PostgreSQL) <psqlVersion>` (default 16.15) for --version, `roles` (default 0) for the count of
 * the role risepath_mcp_remote, `databases` (if given) for the count of a database name, and
 * `psqlAnswer` (default nothing) otherwise. Without `nodeFails`, node exits 1, so the script stops at
 * the 00:00 JST guard (set -e), after the image, the server checks and the PG* variables were used;
 * with it, node exits 1 only for the scripts listed, and the script runs to its end. `sleep` only
 * records its argument. `outFiles` lists what the script left in its outputs folder. `hide` lists
 * commands to take off PATH (a stub of that name too): the rest of PATH is then a folder of links to
 * every other command on it. `timeoutStub` adds a pass-through `timeout` (it never kills).
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, failPull?: (image: string) => boolean, psqlAnswer?: string, nodeFails?: string[],
 *   psqlVersion?: string, roles?: string, databases?: string, dockerFails?: string[], containerExists?: boolean, hide?: string[], timeoutStub?: boolean }} [options]
 */
function runStubbed(args, { env = {}, failPull = () => false, psqlAnswer, nodeFails, psqlVersion = '16.15', roles = '0', databases, dockerFails = [], containerExists = false, hide, timeoutStub = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-db-checks-'));
    try {
        const bin = path.join(dir, 'bin');
        fs.mkdirSync(bin);
        const log = path.join(dir, 'calls.log');
        const failing = path.join(dir, 'fail-pull.txt');
        const write = (/** @type {string} */ name, /** @type {string} */ body) => {
            if (!hide?.includes(name)) fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
        };
        write('docker', [
            'echo "docker $*" >> "$STUB_LOG"',
            `if [[ "$1 $2" == "container inspect" ]]; then exit ${containerExists ? 0 : 1}; fi`,
            'if [[ "$1" == pull ]] && grep -qxF -- "${@: -1}" "$STUB_FAIL_PULL"; then exit 1; fi',
            ...dockerFails.map((sub) => `if [[ "$1" == ${sub} ]]; then echo "docker: stub: ${sub} failed" >&2; exit 125; fi`),
            'exit 0',
        ].join('\n'));
        write('psql', [
            'echo "psql PGHOSTADDR=${PGHOSTADDR-<unset>} PGSERVICE=${PGSERVICE-<unset>} PGSERVICEFILE=${PGSERVICEFILE-<unset>} $*" >> "$STUB_LOG"',
            `if [[ "$1" == --version ]]; then echo "psql (PostgreSQL) ${psqlVersion}"; exit 0; fi`,
            `if [[ "$*" == *"SELECT count(*) FROM pg_roles WHERE rolname = 'risepath_mcp_remote'"* ]]; then echo '${roles}'; exit 0; fi`,
            ...(databases === undefined ? [] : [`if [[ "$*" == *"SELECT count(*) FROM pg_database WHERE datname = "* ]]; then echo '${databases}'; exit 0; fi`]),
            ...(psqlAnswer === undefined ? [] : [`echo '${psqlAnswer}'`]),
            'exit 0',
        ].join('\n'));
        write('node', [
            'echo "node $*" >> "$STUB_LOG"',
            nodeFails === undefined ? 'exit 1' : `case "$1" in ${nodeFails.length ? nodeFails.join('|') : "''"}) exit 1 ;; esac\nexit 0`,
        ].join('\n'));
        write('sleep', 'echo "sleep $*" >> "$STUB_LOG"');
        if (timeoutStub) write('timeout', 'shift; exec "$@"');
        const pulls = [IMAGE, `mirror.gcr.io/pgvector/pgvector@${DIGEST}`].filter((image) => failPull(image));
        fs.writeFileSync(failing, pulls.map((image) => `${image}\n`).join(''));
        fs.writeFileSync(log, '');
        let rest = process.env.PATH ?? '';
        if (hide) rest = linkedPath(path.join(dir, 'path'), hide);
        const result = spawnSync('bash', [path.join(ROOT, DB_CHECKS), ...args], {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 60_000,
            env: {
                PATH: `${bin}${path.delimiter}${rest}`,
                HOME: dir,
                STUB_LOG: log,
                STUB_FAIL_PULL: failing,
                RISEPATH_CI_OUT: path.join(dir, 'out'),
                ...env,
            },
        });
        const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
        const outDir = path.join(dir, 'out');
        const outFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir).sort() : [];
        return { status: result.status, out: `${result.stdout}${result.stderr}`, calls, outFiles };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** The timeout-minutes of the e2e.yml step that runs db-checks.sh (jobs.db). */
function dbStepTimeout() {
    const job = read('.github/workflows/e2e.yml').split(/^  db:$/m)[1]?.split(/^  [a-z0-9_-]+:$/m)[0] ?? '';
    const step = job.split(/^      - /m).find((s) => /\brun: bash scripts\/ci\/db-checks\.sh\s*$/m.test(s)) ?? '';
    return Number(/^\s+timeout-minutes: (\d+)$/m.exec(step)?.[1]);
}

describe('scripts/ci/db-checks.sh', () => {
    it('starts the VM\'s db image: the same tag and digest as docker-compose.yml', () => {
        const compose = read('deploy/risepath-vm/docker-compose.yml').match(IMAGE_RE) ?? [];
        assert.equal(compose.length, 1, 'one db image in the VM compose file');
        assert.deepEqual(script.match(IMAGE_RE), compose, 'the job runs the image the VM runs: bump tag and digest in both files');
        assert.equal(script.split('sha256:').length - 1, 1, 'one literal digest; the mirror reference is built from it');
        assert.doesNotMatch(read('.github/workflows/e2e.yml'), /pgvector\/pgvector|sha256:/, 'the workflow names no image of its own');
    });

    it('starts PostgreSQL with production\'s terse error log and the logging collector, and asserts both', () => {
        assert.match(read('deploy/risepath-vm/docker-compose.yml'), /command: \["postgres", "-c", "log_error_verbosity=terse"\]/);
        const run = /docker create --name [^\n]*\\\n([^\n]*)\n/.exec(code);
        assert.ok(run, 'docker create');
        assert.match(run[1], /^\s+"\$\{RUN_IMAGE\}" -c log_error_verbosity=terse -c logging_collector=on > \/dev\/null$/);
        assert.match(code, /expect_eq "log_error_verbosity[^"]*" "\$\(sql postgres 'SHOW log_error_verbosity'\)" terse$/m);
        assert.match(code, /expect_eq "logging_collector[^"]*" "\$\(sql postgres 'SHOW logging_collector'\)" on$/m);
        assert.match(code, /expect_eq "server major" "\$\(sql postgres 'SHOW server_version_num' \| cut -c1-2\)" 16$/m);
    });

    it('runs verify-account-deletion, verify-phase5, verify-phase6 and verify-training in migration order, never with --allow-skip, after the 00:00 JST guard and before the role SQL', () => {
        assert.doesNotMatch(commands, /--allow-skip/, 'a skipped check is not a pass');
        const at = (/** @type {RegExp} */ re) => {
            const m = re.exec(code);
            assert.ok(m, String(re));
            return m.index;
        };
        const order = [
            at(/^node scripts\/ci\/jst-midnight-guard\.mjs --url "\$\{SU\}\/postgres" --budget \d+$/m),
            at(/^run_verify verify-account-deletion scripts\/db\/verify-account-deletion\.mjs verify_del$/m),
            at(/^run_verify verify-phase5 scripts\/db\/verify-phase5\.mjs verify_p5$/m),
            at(/^run_verify verify-phase6 scripts\/db\/verify-phase6\.mjs verify_p6$/m),
            at(/^run_verify verify-training scripts\/db\/verify-training\.mjs verify_tr$/m),
            at(/^status=0; role_sql > /m),
        ];
        assert.deepEqual(order, [...order].sort((a, b) => a - b), 'guard, 018, 019, 020, 022, then the role SQL (the verify scripts refuse while the role exists)');
        assert.equal(code.match(/^run_verify /gm)?.length, 4);
        assert.match(code, /timeout "\$\{VERIFY_TIMEOUT_S\}" node "\$2" --url "\$\{SU\}\/\$3" > "\$\{OUT\}\/\$1\.txt" 2>&1 \|\| status=\$\?/);
        assert.match(code, /if \[\[ "\$\(sql postgres "SELECT count\(\*\) FROM pg_roles WHERE rolname = 'risepath_mcp_remote'"\)" != 0 \]\]; then\n\s+bad /,
            'a role left over from an earlier script is reported before the next one refuses');
    });

    it('bounds each verify script, the guard, the first boot and all the pulls together, inside the workflow step\'s limit', () => {
        const verify = Number(/^VERIFY_TIMEOUT_S=(\d+)$/m.exec(code)?.[1]);
        const guard = Number(/jst-midnight-guard\.mjs --url "\$\{SU\}\/postgres" --budget (\d+)$/m.exec(code)?.[1]);
        const boot = Number(/if ! timeout (\d+) bash -c "until psql /.exec(code)?.[1]);
        const each = Number(/^ {2}PULL_EACH_S=(\d+)$/m.exec(code)?.[1]);
        const pulls = Number(/^ {2}PULL_BUDGET_S=(\d+)$/m.exec(code)?.[1]);
        assert.equal(verify, 180);
        assert.equal(guard, 180);
        assert.equal(boot, 120);
        assert.ok(each > 0 && each < pulls, `each pull ${each} s, all of them ${pulls} s`);
        // One deadline for every attempt and pause: each pull gets what is left, PULL_EACH_S at most.
        assert.match(code, /^ {2}pull_end=\$\(\(SECONDS \+ PULL_BUDGET_S\)\)$/m);
        assert.match(code, /^ {4}local left=\$\(\(pull_end - SECONDS\)\)\n {4}if \[\[ "\$\{left\}" -le 0 \]\]; then return 1; fi\n {4}timeout "\$\(\(left < PULL_EACH_S \? left : PULL_EACH_S\)\)" docker pull -q "\$1" > \/dev\/null$/m);
        assert.equal(commands.match(/docker pull/g)?.length, 1, 'every pull goes through pull()');
        assert.deepEqual(code.match(/^ {4}if pull "\$\{(IMAGE|MIRROR)\}"; then/gm), ['    if pull "${IMAGE}"; then', '    if pull "${MIRROR}"; then']);
        assert.match(code, /if \[\[ "\$\{attempt\}" -eq 3 \|\| \$\(\(pull_end - SECONDS\)\) -le "\$\{pause\}" \]\]; then\n\s+die 1 "[^\n]*re-run the job later"$/m, 'no pause past the deadline');
        const step = dbStepTimeout();
        assert.ok(Number.isInteger(step), 'the Database checks step that runs db-checks.sh has timeout-minutes');
        // The guard waits at most budget + 5 s. The step outlasts every bound plus a minute for the rest
        // (createdb, db-migrate, the role SQL: seconds), so a hang ends with the script's own message, and
        // the step's timeout (a failed step, which keeps the outputs) comes before the job's (a cancel).
        const scripts = code.match(/^run_verify /gm)?.length ?? 0;
        const bounded = scripts * verify + guard + 5 + boot + pulls;
        assert.ok(bounded + 60 <= 60 * step, `${scripts} × ${verify} + ${guard + 5} + ${boot} + ${pulls} = ${bounded} s, plus 60 s, must fit in the step's ${step} min`);
    });

    it('when both registries keep failing, stops after three attempts with the re-run message, bounded, before docker run', { skip: HAS_TIMEOUT ? false : 'needs timeout (coreutils)' }, () => {
        const { status, out, calls } = runStubbed([], { failPull: () => true });
        assert.equal(status, 1, out);
        const mirror = `mirror.gcr.io/pgvector/pgvector@${DIGEST}`;
        assert.deepEqual(calls.filter((line) => line.startsWith('docker pull ')), [1, 2, 3].flatMap(() => [`docker pull -q ${IMAGE}`, `docker pull -q ${mirror}`]));
        assert.match(out, /::warning ::docker pull failed \(attempt 1\); trying again in 10 s\n[\s\S]*::warning ::docker pull failed \(attempt 2\); trying again in 20 s\n/);
        assert.deepEqual(calls.filter((line) => line.startsWith('sleep ')), ['sleep 10', 'sleep 20']);
        assert.match(out.trimEnd().split('\n').at(-1) ?? '', /^❌ docker pull pgvector\/pgvector:0\.8\.7-pg16 failed on Docker Hub and mirror\.gcr\.io \(attempt 3 of 3, \d+ s at most\); re-run the job later$/);
        assert.ok(!calls.some((line) => /^docker (run|create|start) /.test(line) || line.startsWith('psql ') && !line.endsWith(' --version')), 'nothing started');
    });

    it('migrates twice and counts the files with db-migrate\'s own filter instead of naming a number', () => {
        assert.match(code, /^FILES="\$\(ls server\/migrations \| grep -Eci '\^\[0-9\]\+_\.\+\\\.sql\$'\)"$/m, 'case-insensitive, as db-migrate.mjs');
        assert.match(read('scripts/db-migrate.mjs'), /\.filter\(\(name\) => \/\^\\d\+_\.\+\\\.sql\$\/i\.test\(name\)\)/, 'the same filter as db-migrate.mjs');
        assert.equal(code.match(/node scripts\/db-migrate\.mjs > "\$\{OUT\}\/migrate-[12]\.txt"/g)?.length, 2);
        assert.match(code, /"\$\(node scripts\/db-migrate\.mjs --status \| head -1\)" "# Rise Path migrations \(\$\{FILES\} files, \$\{FILES\} applied, 0 pending\)"/);
        assert.match(code, /"\$\(tail -1 "\$\{OUT\}\/migrate-2\.txt"\)" "Nothing to apply\."/);
        assert.doesNotMatch(code, /\b\d+ files\b/, 'no count that goes stale with the next migration');
    });

    it('removes only the container it created, with its volume; never prunes', () => {
        assert.deepEqual(code.match(/docker rm\b[^\n|>]*/g), ['docker rm -f -v "${NAME}" '], 'one docker rm, of its own container');
        assert.match(code, /if \[\[ "\$\{RISEPATH_CI_KEEP:-\}" != 1 \]\]; then docker rm -f -v "\$\{NAME\}"/);
        assert.doesNotMatch(code, /prune|docker volume rm|docker system|docker kill/);
        assert.match(code, /^trap cleanup EXIT$/m);
        assert.match(code, /\n {2}docker create --name "\$\{NAME\}" [^\n]*\\\n[^\n]*\n {2}STARTED=1\n {2}docker start "\$\{NAME\}" /,
            'marked as its own once created, before it is started');
    });

    it('a container that was created but could not start (a busy port) is removed; a refused create removes nothing', { skip: HAS_TIMEOUT ? false : 'needs timeout (coreutils)' }, () => {
        const start = runStubbed([], { dockerFails: ['start'] });
        assert.equal(start.status, 1, start.out);
        assert.match(start.out, /❌ docker start risepath-ci-db failed \(is 127\.0\.0\.1:55432 in use\? set RISEPATH_CI_DB_PORT\)/);
        const started = start.calls.indexOf('docker start risepath-ci-db');
        assert.ok(started >= 0 && started < start.calls.indexOf('docker rm -f -v risepath-ci-db'), 'removed on the way out, so the next run is not refused');
        assert.ok(!start.calls.some((line) => line.startsWith('psql ') && !line.endsWith(' --version')), 'no SQL');

        const create = runStubbed([], { dockerFails: ['create'] });
        assert.notEqual(create.status, 0, create.out);
        assert.ok(create.calls.some((line) => line.startsWith('docker create --name risepath-ci-db ')));
        assert.ok(!create.calls.some((line) => /^docker (start|rm|exec) /.test(line)), `a name taken since the check is someone else's container\n${create.calls.join('\n')}`);
    });

    it('refuses with exit 2 before it changes anything: psql older than 16, a container of its name, the role risepath_mcp_remote, an existing database', { skip: HAS_TIMEOUT ? false : 'needs timeout (coreutils)' }, () => {
        const sqlCalls = (/** @type {string[]} */ calls) => calls.filter((line) => line.startsWith('psql ') && !line.endsWith(' --version'));
        const created = (/** @type {string[]} */ calls) => calls.some((line) => line.includes('CREATE DATABASE'));
        for (const version of ['14.11', '9.6.24']) {
            const old = runStubbed([], { psqlVersion: version });
            assert.equal(old.status, 2, old.out);
            assert.match(old.out, new RegExp(`❌ psql 16 or newer expected: psql \\(PostgreSQL\\) ${version.replaceAll('.', '\\.')}`));
            assert.deepEqual(old.calls.filter((line) => !line.startsWith('psql ')), [], `psql ${version}: no docker or node call`);
        }
        assert.ok(runStubbed([], { psqlVersion: '17.2' }).calls.some((line) => line.startsWith('docker container inspect ')), 'psql 17 is accepted');

        const taken = runStubbed([], { containerExists: true });
        assert.equal(taken.status, 2, taken.out);
        assert.match(taken.out, /❌ A container named risepath-ci-db exists\. Remove it, or set RISEPATH_CI_DB_NAME\./);
        assert.deepEqual(taken.calls.filter((line) => line.startsWith('docker ')), ['docker container inspect risepath-ci-db'], 'neither pulled, started nor removed');

        for (const args of [[], ['--existing-url', 'postgresql://postgres@127.0.0.1:5432']]) {
            const role = runStubbed(args, { roles: '1' });
            assert.equal(role.status, 2, role.out);
            assert.match(role.out, /❌ the role risepath_mcp_remote exists: use an empty cluster \(the role SQL would change its password\)/);
            assert.ok(!role.calls.some((line) => line.startsWith('node ')), 'refused before the 00:00 JST guard waits');
            assert.ok(!created(role.calls), 'no database created');
            assert.equal(sqlCalls(role.calls).filter((line) => !/ -c (SELECT 1|SHOW [a-z_]+|SELECT count\(\*\) FROM pg_roles WHERE rolname = 'risepath_mcp_remote')$/.test(line)).length, 0, 'only reads before the refusal');
        }

        const db = runStubbed([], { nodeFails: [], psqlAnswer: '0', databases: '1' });
        assert.equal(db.status, 2, db.out);
        assert.match(db.out, /❌ database verify_del exists: use an empty cluster/);
        assert.ok(!created(db.calls), 'no database created');
        assert.ok(!db.calls.some((line) => line.startsWith('node scripts/db/')), 'no verify script ran');
    });

    it('stops at the first failing command (set -euo pipefail): a failing 00:00 JST guard ends the job before any database is created', { skip: HAS_TIMEOUT ? false : 'needs timeout (coreutils)' }, () => {
        assert.match(script, /^set -euo pipefail$/m);
        const { status, calls, out } = runStubbed([]);
        assert.equal(status, 1, out);
        assert.equal(calls.filter((line) => line.startsWith('node ')).at(-1)?.split(' ')[1], 'scripts/ci/jst-midnight-guard.mjs', 'the guard is the last node call');
        assert.ok(!calls.some((line) => line.includes('CREATE DATABASE')), 'no database created');
    });

    it('--existing-url refuses a host other than 127.0.0.1, localhost or [::1], a second host and any ?parameters, with exit 2 before any psql or docker call', () => {
        for (const url of [
            'postgresql://postgres@10.0.0.5:5432',
            'postgresql://postgres@db.example.org:5432',
            'postgresql://postgres@127.0.0.1.evil.org:5432',
            'postgresql://postgres@127.0.0.1:5432/?host=evil',
            'postgresql://postgres@127.0.0.1:5432,10.0.0.5:5432',
            'postgresql://postgres@[::1]:5432,db.example.org:5432',
        ]) {
            const { status, out, calls } = runStubbed(['--existing-url', url]);
            assert.equal(status, 2, `${url}: ${out}`);
            assert.match(out, /❌ --existing-url (must point at 127\.0\.0\.1, localhost or \[::1\]|takes no \?parameters or extra hosts)/, url);
            assert.deepEqual(calls, [], `${url}: no psql, docker or node call`);
        }
        // Without user@, the role checks would connect to 'postgresql://…@postgresql://host:port/risepath'.
        for (const url of ['postgresql://127.0.0.1:5432', 'postgres://localhost:5432', 'postgresql://@127.0.0.1:5432']) {
            const { status, out, calls } = runStubbed(['--existing-url', url]);
            assert.equal(status, 2, `${url}: ${out}`);
            assert.match(out, /❌ --existing-url needs the user: postgresql:\/\/user\[:password\]@host:port/, url);
            assert.deepEqual(calls, [], `${url}: no psql, docker or node call`);
        }
    });

    it('takes nothing or exactly --existing-url <url>: the = form, a missing or empty URL, an extra or unknown argument exit 2 before any call (never Docker mode)', () => {
        for (const args of [
            ['--existing-url=postgresql://postgres@127.0.0.1:5432'],
            ['--existing-url'],
            ['--existing-url', ''],
            ['--foo'],
            ['--existing-url', 'postgresql://postgres@127.0.0.1:5432', 'extra'],
            ['postgresql://postgres@127.0.0.1:5432'],
        ]) {
            const { status, out, calls } = runStubbed(args);
            assert.equal(status, 2, `${JSON.stringify(args)}: ${out}`);
            assert.match(out, /❌ usage: db-checks\.sh \[--existing-url postgresql:\/\/user\[:password\]@host:port\]/, JSON.stringify(args));
            assert.deepEqual(calls, [], `${JSON.stringify(args)}: no psql, docker or node call`);
        }
    });

    it('every early stop goes through die(): the ❌ line, and on GitHub Actions an ::error annotation, so the check\'s summary names the cause', () => {
        const parts = code.split(/^die\(\) \{[^\n]*\n[\s\S]*?^\}$/m);
        assert.equal(parts.length, 2, 'one die()');
        assert.doesNotMatch(parts.join(''), /❌/, 'no ❌ line of its own outside die(): its stop would show only "Process completed with exit code 1"');
        assert.match(code, /^die\(\) \{[^\n]*\n {2}echo "❌ \$2"\n {2}if \[\[ -n "\$\{GITHUB_ACTIONS:-\}" \]\]; then echo "::error title=Database checks::\$2"; fi\n {2}exit "\$1"\n\}$/m);
        const USAGE = 'usage: db-checks\\.sh \\[--existing-url postgresql://user\\[:password\\]@host:port\\]';
        const usage = runStubbed(['--foo'], { env: { GITHUB_ACTIONS: 'true' } });
        assert.equal(usage.status, 2, usage.out);
        assert.match(usage.out, new RegExp(`^❌ ${USAGE}\\n::error title=Database checks::${USAGE}$`, 'm'));
        const local = runStubbed(['--foo']);
        assert.equal(local.status, 2, local.out);
        assert.doesNotMatch(local.out, /::error/, 'the annotation only on GitHub Actions');
        if (HAS_TIMEOUT) {
            const start = runStubbed([], { dockerFails: ['start'], env: { GITHUB_ACTIONS: 'true' } });
            assert.equal(start.status, 1, start.out);
            assert.match(start.out, /^::error title=Database checks::docker start risepath-ci-db failed \(is 127\.0\.0\.1:55432 in use\? set RISEPATH_CI_DB_PORT\)$/m);
            const pulls = runStubbed([], { failPull: () => true, env: { GITHUB_ACTIONS: 'true' } });
            assert.equal(pulls.status, 1, pulls.out);
            assert.match(pulls.out.trimEnd().split('\n').at(-1) ?? '', /^::error title=Database checks::docker pull pgvector\/pgvector:0\.8\.7-pg16 failed on Docker Hub and mirror\.gcr\.io /);
        }
    });

    it('refuses a PATH without timeout (both modes) or without docker (Docker mode) with the remedy, before any docker or node call or pause', () => {
        const VERSION_ONLY = ['psql PGHOSTADDR=<unset> PGSERVICE=<unset> PGSERVICEFILE=<unset> --version'];
        for (const args of [[], ['--existing-url', 'postgresql://postgres@127.0.0.1:5999']]) {
            const { status, out, calls } = runStubbed(args, { hide: ['timeout'] });
            assert.equal(status, 2, `${args.join(' ') || 'docker mode'}: ${out}`);
            assert.match(out, /❌ timeout is not on PATH \(coreutils; on a Mac: brew install coreutils, then put its gnubin folder on PATH\)/);
            assert.deepEqual(calls, VERSION_ONLY, 'no docker, node or sleep: the registries are not blamed');
        }
        const noDocker = runStubbed([], { hide: ['docker'], timeoutStub: true });
        assert.equal(noDocker.status, 2, noDocker.out);
        assert.match(noDocker.out, /❌ docker is not on PATH \(without Docker: --existing-url, see the header of this script\)/);
        assert.deepEqual(noDocker.calls, VERSION_ONLY);
        if (HAS_TIMEOUT) {
            const linked = runStubbed([], { hide: [] });
            assert.ok(linked.calls.some((line) => line.startsWith('docker container inspect ')), `the linked PATH runs the script: ${linked.out}`);
        }
    });

    it('db-checks clears PGHOSTADDR, PGSERVICE and PGSERVICEFILE before the first psql, in both modes', { skip: HAS_TIMEOUT ? false : 'needs timeout (coreutils)' }, () => {
        const env = { PGHOSTADDR: '10.0.0.5', PGSERVICE: 'evil', PGSERVICEFILE: '/nonexistent/pg_service.conf' };
        for (const args of [[], ['--existing-url', 'postgresql://postgres@127.0.0.1:5432']]) {
            const { calls, out } = runStubbed(args, { env });
            const psql = calls.filter((line) => line.startsWith('psql '));
            assert.ok(psql.filter((line) => !line.endsWith(' --version')).length > 0, `${args.join(' ') || 'docker mode'}: the script reached its SQL checks\n${out}`);
            for (const line of psql) assert.match(line, /^psql PGHOSTADDR=<unset> PGSERVICE=<unset> PGSERVICEFILE=<unset> /, line);
            assert.ok(calls.some((line) => line.startsWith('node scripts/ci/jst-midnight-guard.mjs')), 'stopped at the guard');
            if (args.length) assert.ok(!calls.some((line) => line.startsWith('docker ')), '--existing-url starts no container');
        }
    });

    it('when Docker Hub refuses, pulls the same digest from mirror.gcr.io, warns, and runs that reference', { skip: HAS_TIMEOUT ? false : 'needs timeout (coreutils)' }, () => {
        assert.match(code, /^ {2}MIRROR="mirror\.gcr\.io\/\$\{IMAGE%%:\*\}@\$\{IMAGE##\*@\}"$/m);
        assert.match(code, /echo "::warning ::docker pull \$\{IMAGE%%@\*\}: Docker Hub failed; using \$\{MIRROR%%@\*\} with the same digest"/);
        assert.doesNotMatch(code, /docker (run|create) [^\n]*\\\n\s+"\$\{IMAGE\}"/, 'the container takes the image that was pulled');
        const mirror = `mirror.gcr.io/pgvector/pgvector@${DIGEST}`;
        const runOf = (/** @type {string[]} */ calls) => calls.find((line) => line.startsWith('docker create '));

        const hub = runStubbed([]);
        assert.deepEqual(hub.calls.filter((line) => /^docker (pull|run|create|start) /.test(line)).map((line) => line.split(' ').slice(0, 3).join(' ')),
            ['docker pull -q', 'docker create --name', 'docker start risepath-ci-db']);
        assert.ok(runOf(hub.calls)?.includes(` ${IMAGE} -c log_error_verbosity=terse -c logging_collector=on`), runOf(hub.calls));
        assert.doesNotMatch(hub.out, /::warning/);

        const fallback = runStubbed([], { failPull: (image) => !image.startsWith('mirror.gcr.io/') });
        assert.deepEqual(fallback.calls.filter((line) => line.startsWith('docker pull ')), [`docker pull -q ${IMAGE}`, `docker pull -q ${mirror}`]);
        assert.ok(runOf(fallback.calls)?.endsWith(` ${mirror} -c log_error_verbosity=terse -c logging_collector=on`), runOf(fallback.calls));
        assert.match(fallback.out, /::warning ::docker pull pgvector\/pgvector:0\.8\.7-pg16: Docker Hub failed; using mirror\.gcr\.io\/pgvector\/pgvector with the same digest/);
        assert.ok(fallback.calls.includes('docker rm -f -v risepath-ci-db'), 'the started container is removed on the way out');
    });

    it('asserts what the role can do after the role SQL: its limits, the tables never granted, a wrong password, xp_awards', () => {
        const role = read('deploy/risepath-vm/sql/mcp_remote_role.sql');
        assert.match(role, /CONNECTION LIMIT 20 /);
        assert.match(role, /^ALTER ROLE risepath_mcp_remote SET statement_timeout = '10s';$/m);
        assert.match(role, /^ALTER ROLE risepath_mcp_remote SET idle_in_transaction_session_timeout = '30s';$/m);
        assert.match(code, /^expect_eq "limits" "\$\(sql postgres "SELECT rolconnlimit \|\| ' ' \|\| \(SELECT string_agg\(c, ',' ORDER BY c\) FROM unnest\(rolconfig\) AS c\) FROM pg_roles WHERE rolname = 'risepath_mcp_remote'"\)" \\\n {2}"20 idle_in_transaction_session_timeout=30s,statement_timeout=10s"$/m);
        const never = ['learning_days', 'lesson_progress_lesson_resets', 'lesson_progress_resets', 'review_log', 'training_cohorts', 'training_memberships', 'xp_awards'];
        for (const table of never) assert.doesNotMatch(role, new RegExp(`^GRANT SELECT[^;]* ON ${table} `, 'm'), `${table} is never readable`);
        assert.match(code, new RegExp(`^expect_eq "never granted" "\\$\\(psql "\\$\\{REMOTE\\}" -X -At -c "SELECT string_agg\\(t \\|\\| '=' \\|\\| has_table_privilege\\(t, 'SELECT'\\), ' ' ORDER BY t\\) FROM unnest\\(ARRAY\\[${never.map((t) => `'${t}'`).join(', ')}\\]\\) AS t"\\)" \\\\\n {2}"${never.map((t) => `${t}=false`).join(' ')}"$`, 'm'));
        assert.match(code, /^expect_eq "the role logs in with its password" "\$\(psql "\$\{REMOTE\}" -X -At -c 'SELECT current_user'\)" risepath_mcp_remote$/m);
        assert.match(code, /^REMOTE="postgresql:\/\/risepath_mcp_remote:\$\{ROLE_PASSWORD\}@\$\{HOSTPORT\}\/risepath"$/m);
        assert.match(code, /^if \[\[ -z "\$\{EXISTING\}" \]\]; then\n {2}if psql "postgresql:\/\/risepath_mcp_remote:ci-dummy-wrong-password-0+@\$\{HOSTPORT\}\/risepath" -X -At -c 'SELECT 1' > \/dev\/null 2>&1; then\n {4}bad "a wrong password logged in"\n {2}else\n {4}ok /m);
        assert.match(code, /^if psql "\$\{REMOTE\}" -X -At -c 'SELECT count\(\*\) FROM xp_awards' > \/dev\/null 2>&1; then bad "the role read xp_awards"; else ok /m);
        // Every training_ table (021, 022 and later), by its name, not a list that a new table would miss
        // (server/tests/migration022.test.js counts them in the migrations).
        assert.match(code, /^expect_eq "no training_ table for the role" "\$\(psql "\$\{REMOTE\}" -X -At -c "SELECT count\(\*\) FILTER \(WHERE has_any_column_privilege\(c\.oid, 'SELECT, INSERT, UPDATE, REFERENCES'\) OR has_table_privilege\(c\.oid, 'DELETE, TRUNCATE'\)\) \|\| ' of ' \|\| count\(\*\) FROM pg_class c JOIN pg_namespace n ON n\.oid = c\.relnamespace WHERE n\.nspname = 'public' AND c\.relkind = 'r' AND c\.relname LIKE 'training\\_%'"\)" \\\n {2}"0 of \d+"$/m);
        assert.doesNotMatch(role, /training_/, 'the role SQL names no training_ table');
    });

    it('Phase 8: the role reads the newest acceptance with the terms check\'s own statement, and never legal_acceptances.id', () => {
        const role = read('deploy/risepath-vm/sql/mcp_remote_role.sql');
        assert.match(role, /^GRANT SELECT \(user_id, terms_version, privacy_version, accepted_at, account_deleted_at\) ON legal_acceptances TO risepath_mcp_remote;$/m);
        const statement = LATEST_ACCEPTANCE_SQL.replace('$1::uuid', "'00000000-0000-4000-8000-000000000000'::uuid");
        assert.ok(code.includes(`expect_eq "reads the newest acceptance (terms check, Phase 8)" "$(psql "\${REMOTE}" -X -At -c "SELECT count(*) FROM (${statement}) a")" 0\n`),
            'db-checks.sh runs exactly LATEST_ACCEPTANCE_SQL as the role');
        assert.match(code, /^if psql "\$\{REMOTE\}" -X -At -c 'SELECT id FROM legal_acceptances LIMIT 1' > \/dev\/null 2>&1; then bad "the role read legal_acceptances\.id"; else ok "the role cannot read legal_acceptances\.id"; fi$/m);
    });

    it('a failed check or a failing verify script fails the job and keeps the PostgreSQL log', { skip: HAS_TIMEOUT ? false : 'needs timeout (coreutils)' }, () => {
        // Every query answers '0' (so `server major` and others fail) and verify-phase5.mjs exits 1;
        // the guard and the other scripts pass. The job is a required check: a failure must end red.
        const { status, out, calls, outFiles } = runStubbed([], { psqlAnswer: '0', nodeFails: ['scripts/db/verify-phase5.mjs'] });
        const lines = out.trimEnd().split('\n');
        assert.equal(status, 1, out);
        assert.ok(lines.includes("FAIL server major: got '0', want '16'"), 'expect_eq reports a wrong value');
        assert.ok(lines.some((line) => line.startsWith('FAIL scripts/db/verify-phase5.mjs: exit 1 (')), 'run_verify reports a failing script');
        assert.ok(lines.includes('ok   scripts/db/verify-account-deletion.mjs: exit 0'), 'the scripts after a failure still run');
        // What the role can do (every query answers '0', and the stub psql lets every login in).
        for (const line of [
            "FAIL the role logs in with its password: got '0', want 'risepath_mcp_remote'",
            "FAIL limits: got '0', want '20 idle_in_transaction_session_timeout=30s,statement_timeout=10s'",
            "FAIL never granted: got '0', want 'learning_days=false lesson_progress_lesson_resets=false lesson_progress_resets=false review_log=false training_cohorts=false training_memberships=false xp_awards=false'",
            "FAIL no training_ table for the role: got '0', want '0 of 9'",
            'FAIL a wrong password logged in',
            'FAIL the role read xp_awards',
            'FAIL the role read legal_acceptances.id',
        ]) assert.ok(lines.includes(line), line);
        assert.match(lines.at(-1) ?? '', /^# Database checks: FAILED \(outputs in .+\)$/, 'the verdict is the last line');
        assert.doesNotMatch(out, /# Database checks: all passed/);
        const exec = calls.indexOf('docker exec risepath-ci-db sh -c cat "$PGDATA"/log/*');
        assert.ok(exec >= 0, 'the PostgreSQL log is copied out on failure');
        assert.ok(exec < calls.indexOf('docker rm -f -v risepath-ci-db'), 'before the container is removed');
        assert.ok(outFiles.includes('postgres.log'), `postgres.log in the outputs folder (${outFiles.join(', ')})`);
    });
});

describe('scripts/ci/jst-midnight-guard.mjs (00:00 JST, Japan time with no daylight saving)', () => {
    it('secondsToJstMidnight: 14:59:00Z → 60, 15:00:00Z → 86400, 15:00:01Z → 86399, 00:00:00Z (09:00 JST) → 54000', () => {
        assert.equal(JST_OFFSET_S, 9 * 3600);
        assert.equal(secondsToJstMidnight(Date.parse('2026-10-27T14:59:00Z')), 60);
        assert.equal(secondsToJstMidnight(Date.parse('2026-10-27T15:00:00Z')), 86_400);
        assert.equal(secondsToJstMidnight(Date.parse('2026-10-27T15:00:01Z')), 86_399);
        assert.equal(secondsToJstMidnight(Date.parse('2026-10-27T00:00:00Z')), 54_000);
        assert.equal(secondsToJstMidnight(Date.parse('2026-10-27T14:59:59.900Z')), 1, 'never 0');
    });

    it('waitPastJstMidnight waits until 00:00:05 JST only inside the budget, reading the database clock', async () => {
        /** @param {string} iso @param {number} budgetS */
        const run = async (iso, budgetS) => {
            /** @type {string[]} */
            const sql = [];
            /** @type {number[]} */
            const slept = [];
            /** @type {string[]} */
            const lines = [];
            const result = await waitPastJstMidnight({
                query: async (text) => { sql.push(text); return { rows: [{ ms: Date.parse(iso) }] }; },
                budgetS,
                log: (line) => lines.push(line),
                sleep: async (ms) => { slept.push(ms); },
            });
            return { result, sql, slept, lines };
        };
        const near = await run('2026-10-27T14:58:00Z', 180);
        assert.deepEqual(near.result, { leftS: 120, waitedS: 125 });
        assert.deepEqual(near.slept, [125_000], 'one computed wait, past 00:00:05 JST');
        assert.match(near.lines.join('\n'), /^::notice title=00:00 JST::120 s to 00:00 JST, less than this run's 180 s: waiting 125 s/);
        assert.match(near.sql[0], /now\(\)/, 'the database clock, as the day checks use');

        const far = await run('2026-10-27T14:50:00Z', 180);
        assert.deepEqual(far.result, { leftS: 600, waitedS: 0 });
        assert.deepEqual(far.slept, []);
        assert.match(far.lines.join('\n'), /^# 00:00 JST is 600 s away \(budget 180 s\): no wait$/);

        assert.deepEqual((await run('2026-10-27T14:57:00Z', 180)).slept, [], 'exactly the budget left: no wait');
        assert.deepEqual((await run('2026-10-27T14:57:01Z', 180)).slept, [184_000], 'one second less: wait');

        for (const budgetS of [0, 901, 1.5, Number.NaN]) {
            await assert.rejects(run('2026-10-27T14:50:00Z', budgetS), RangeError, `budget ${budgetS}`);
        }
    });

    it('the command line needs --url and --budget (exit 2), and importing the module runs nothing', () => {
        const bare = spawnSync(process.execPath, ['scripts/ci/jst-midnight-guard.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });
        assert.equal(bare.status, 2);
        assert.match(bare.stderr, /Usage: node scripts\/ci\/jst-midnight-guard\.mjs --url <postgres url> --budget <seconds, 1-900>/);
        const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/ci/jst-midnight-guard.mjs'); console.log('ok')"],
            { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });
        assert.equal(imported.status, 0, imported.stderr);
        assert.equal(imported.stdout.trim(), 'ok');
    });
});

const STACK_SH = 'scripts/ci/stack.sh';
const stackScript = read(STACK_SH);
/** stack.sh without its comment lines, so a word in a comment never satisfies a check. */
const stackCode = stackScript.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
/** The same without the text of echo and fail messages: only what the script runs. */
const stackCommands = stackCode.split('\n').map((line) => line.replace(/\b(echo|fail) ["'][\s\S]*$/, '$1')).join('\n');
const TEMPLATE = 'deploy/risepath-vm/ci/stack.ci.env';
const template = read(TEMPLATE);
const PG_IMAGE = (read('deploy/risepath-vm/docker-compose.yml').match(IMAGE_RE) ?? [])[0] ?? '';
const PG_DIGEST = PG_IMAGE.slice(PG_IMAGE.indexOf('@') + 1);
const STACK_PORTS = [5432, 3006, 3100];
const STANDIN = 'e2e/support/auth-stand-in.mjs';
/** The stand-in's container (scripts/ci/stack.sh AUTH_NAME). */
const AUTH_NAME = 'risepath-ci-auth';
const MARKER = '# risepath-ci-env:';
/** A production-ready /api/v2/health body, as the api answers it on the CI stack. */
const HEALTH = { ok: true, node_env: 'production', checks: { database: true, supabase_auth: true, production_data_mode: true, strict_auth_mode: true }, database: { migrations: { pending: 0, ok: true } } };
/** A log line with the template's secret values in it (the deploy stub and `compose logs` print it). */
const LEAKY = 'DATABASE_URL_PHASE1=postgresql://risepath_app:ci-dummy-db-password@db:5432/risepath token=ci-dummy-bridge-token';

/** True when something on this machine listens on 127.0.0.1:<port>. @param {number} port */
function busy(port) {
    return spawnSync('bash', ['-c', `(exec 3<> "/dev/tcp/127.0.0.1/${port}") 2> /dev/null`]).status === 0;
}
const BUSY = STACK_PORTS.filter(busy);
const SKIP_IF_PORTS_BUSY = BUSY.length === 0 ? false : `a stack port is in use on this machine (${BUSY.join(', ')}): preflight would refuse it first`;

/**
 * @typedef {{ env?: Record<string, string>, failPull?: (image: string) => boolean, inspectFails?: boolean,
 *   mcpExit?: number, apiExit?: number, standIn?: boolean, health?: unknown, curlExit?: number, deployExit?: number, dfKb?: number, cwd?: string,
 *   hide?: string[], noTimeoutStub?: boolean, redactFails?: boolean, stubs?: Record<string, string>, setup?: (tree: string) => void, inspect?: (tree: string) => void }} StackOptions
 */
/**
 * Runs scripts/ci/stack.sh <args> in a temporary copy of the tree: stack.sh, redact-log.mjs,
 * e2e/support/auth-stand-in.mjs and deploy/risepath-vm/{ci/stack.ci.env, docker-compose.yml, Dockerfile}, with a recording
 * deploy/risepath-vm/scripts/deploy-stack.sh stub that prints LEAKY and exits `deployExit`. Recording
 * docker, curl and sleep stubs come first on PATH (with `dfKb`, df too), the real node after them.
 * docker answers version/info, fails `pull` for images `failPull` names and `image inspect` with
 * `inspectFails`, exits `mcpExit` for the exec into mcp and `apiExit` for the exec into api, and prints LEAKY
 * for `compose logs`; `container inspect` finds the stand-in's container and `logs` prints its lines only
 * with `standIn`; each line logs the COMPOSE_PROJECT_NAME it saw. curl prints `health` (as JSON unless a string) or exits `curlExit`.
 * With `redactFails`, node exits 7 for redact-log.mjs (and runs the real node otherwise). `hide` lists
 * commands to take off PATH: the rest of PATH is then a folder of links to every other command on it.
 * A pass-through `timeout` stub (it runs the command, never kills it: every stub returns at once) is on
 * PATH unless `noTimeoutStub`, so a host without coreutils (stock macOS) runs these tests too.
 * `stubs` adds more bash stubs to the stub folder (name → body), e.g. npm and npx for the e2e steps.
 * @param {string[]} args @param {StackOptions} [options]
 */
function runStack(args, { env = {}, failPull = () => false, inspectFails = false, mcpExit = 0, apiExit = 0, standIn = false, health = HEALTH, curlExit, deployExit = 0, dfKb, cwd, hide, noTimeoutStub = false, redactFails = false, stubs = {}, setup, inspect } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-stack-'));
    try {
        const tree = path.join(dir, 'repo');
        for (const file of [STACK_SH, 'scripts/ci/redact-log.mjs', STANDIN, TEMPLATE, 'deploy/risepath-vm/docker-compose.yml', 'deploy/risepath-vm/Dockerfile']) {
            fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
            fs.copyFileSync(path.join(ROOT, file), path.join(tree, file));
        }
        fs.mkdirSync(path.join(tree, 'deploy/risepath-vm/scripts'));
        fs.writeFileSync(path.join(tree, 'deploy/risepath-vm/scripts/deploy-stack.sh'), [
            'echo "deploy-stack.sh RISEPATH_DEPLOY_SKIP_PULL=${RISEPATH_DEPLOY_SKIP_PULL-<unset>} COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME-<unset>}" >> "$STUB_LOG"',
            `echo '==> deploy ${LEAKY}'`,
            `exit ${deployExit}`,
        ].join('\n'));
        const bin = path.join(dir, 'bin');
        fs.mkdirSync(bin);
        const log = path.join(dir, 'calls.log');
        const failing = path.join(dir, 'fail-pull.txt');
        const healthFile = path.join(dir, 'health.json');
        const write = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
        write('docker', [
            'echo "docker [${COMPOSE_PROJECT_NAME-<unset>}] $*" >> "$STUB_LOG"',
            'case "$1" in',
            '  version) echo "Docker 29.0.0" ;;',
            '  info) echo "Storage driver: overlayfs" ;;',
            '  pull) if grep -qxF -- "${@: -1}" "$STUB_FAIL_PULL"; then exit 1; fi ;;',
            `  image) exit ${inspectFails ? 1 : 0} ;;`,
            `  container) exit ${standIn ? 0 : 1} ;;`,
            `  logs) ${standIn ? `echo '2026-10-27T15:00:00Z auth stand-in listening on http://0.0.0.0:54390'; echo '2026-10-27T15:00:01Z POST /auth/v1/token?grant_type=password 200 Bearer abc.def-ghi'` : 'echo "Error: No such container" >&2; exit 1'} ;;`,
            '  compose)',
            '    if [[ "$2" == version ]]; then echo "Docker Compose version v5.0.0"; exit 0; fi',
            `    if [[ " $* " == *" exec -T mcp "* ]]; then exit ${mcpExit}; fi`,
            `    if [[ " $* " == *" exec -T api "* ]]; then exit ${apiExit}; fi`,
            `    if [[ " $* " == *" logs "* ]]; then echo 'risepath-ci-api-1  | - Environment: production'; echo 'risepath-ci-api-1  | ${LEAKY}'; echo 'risepath-ci-api-1  | Authorization: Bearer abc.def-ghi'; fi`,
            '    ;;',
            'esac',
            'exit 0',
        ].join('\n'));
        write('curl', ['echo "curl $*" >> "$STUB_LOG"', curlExit === undefined ? 'cat "$STUB_HEALTH"' : `exit ${curlExit}`].join('\n'));
        write('sleep', 'echo "sleep $*" >> "$STUB_LOG"');
        if (dfKb !== undefined) write('df', ['echo "Filesystem 1024-blocks Used Available Capacity Mounted on"', `echo "/dev/stub 999999999 1 ${dfKb} 1% /"`].join('\n'));
        if (redactFails) write('node', ['if [[ "$1" == *redact-log.mjs ]]; then echo "node: stub: redact failed" >&2; exit 7; fi', `exec ${JSON.stringify(process.execPath)} "$@"`].join('\n'));
        // preflight, pull and browser only need `timeout` to exist and pass the command through (every stub
        // returns at once), so these runs never depend on the host's coreutils (stock macOS has none).
        if (!noTimeoutStub) write('timeout', 'shift; exec "$@"');
        for (const [name, body] of Object.entries(stubs)) write(name, body);
        let rest = process.env.PATH ?? '';
        if (hide) rest = linkedPath(path.join(dir, 'path'), hide);
        const pulls = [`node:22-slim`, 'mirror.gcr.io/library/node:22-slim', PG_IMAGE, `mirror.gcr.io/pgvector/pgvector@${PG_DIGEST}`].filter((image) => failPull(image));
        fs.writeFileSync(failing, pulls.map((image) => `${image}\n`).join(''));
        fs.writeFileSync(healthFile, typeof health === 'string' ? health : JSON.stringify(health));
        fs.writeFileSync(log, '');
        setup?.(tree);
        const result = spawnSync('bash', [path.join(tree, STACK_SH), ...args], {
            cwd: cwd ?? dir,
            encoding: 'utf8',
            timeout: 60_000,
            env: { PATH: `${bin}${path.delimiter}${rest}`, HOME: dir, STUB_LOG: log, STUB_FAIL_PULL: failing, STUB_HEALTH: healthFile, ...env },
        });
        inspect?.(tree);
        const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => line.split(tree).join('<tree>'));
        return { status: result.status, out: `${result.stdout}${result.stderr}`.split(tree).join('<tree>'), calls };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** The timeout-minutes of the step of an e2e.yml job (default stack) that runs `stack.sh <sub>`. @param {string} sub @param {string} [id] */
function stackStepTimeout(sub, id = 'stack') {
    const job = read('.github/workflows/e2e.yml').split(new RegExp(`^  ${id}:$`, 'm'))[1]?.split(/^  [a-z0-9_-]+:$/m)[0] ?? '';
    const step = job.split(/^      - /m).find((s) => new RegExp(`\\brun: bash scripts/ci/stack\\.sh ${sub}\\s*$`, 'm').test(s)) ?? '';
    return Number(/^\s+timeout-minutes: (\d+)$/m.exec(step)?.[1]);
}

describe('scripts/ci/stack.sh (temporary copy of the tree, stubs)', () => {
    const STACK_ENV = 'deploy/risepath-vm/stack.env';
    const COMPOSE = 'docker [risepath-ci] compose -p risepath-ci --env-file ';

    it('install-env writes stack.env from the template with its marker, mode 0600, and may run again', () => {
        /** @type {{ text?: string, mode?: number }} */
        const seen = {};
        const { status, out } = runStack(['install-env'], {
            setup: (tree) => fs.chmodSync(path.join(tree, TEMPLATE), 0o644),
            inspect: (tree) => {
                seen.text = fs.readFileSync(path.join(tree, STACK_ENV), 'utf8');
                seen.mode = fs.statSync(path.join(tree, STACK_ENV)).mode & 0o777;
            },
        });
        assert.equal(status, 0, out);
        assert.equal(seen.text, template);
        assert.ok(template.startsWith(MARKER), 'the marker is the first line');
        assert.equal(seen.mode, 0o600);
        assert.match(out, /deploy\/risepath-vm\/stack\.env <- ci\/stack\.ci\.env/);
        const again = runStack(['install-env'], { setup: (tree) => fs.copyFileSync(path.join(tree, TEMPLATE), path.join(tree, STACK_ENV)) });
        assert.equal(again.status, 0, `its own file is replaced: ${again.out}`);
    });

    it('install-env refuses a file it did not write (exit 1, bytes unchanged)', () => {
        const mine = 'POSTGRES_PASSWORD=a-developer-s-own-value\n';
        /** @type {string[]} */
        const after = [];
        const { status, out } = runStack(['install-env'], {
            setup: (tree) => fs.writeFileSync(path.join(tree, STACK_ENV), mine),
            inspect: (tree) => after.push(fs.readFileSync(path.join(tree, STACK_ENV), 'utf8')),
        });
        assert.equal(status, 1, out);
        assert.match(out, /❌ deploy\/risepath-vm\/stack\.env exists and was not written by scripts\/ci\/stack\.sh: move it away \(it is never overwritten\)/);
        assert.deepEqual(after, [mine]);
    });

    it('preflight refuses a foreign stack.env, mcp-public.env, billing.env or tunnel.env next to the compose file, before any docker call', () => {
        for (const file of ['stack.env', 'mcp-public.env', 'billing.env', 'tunnel.env']) {
            const { status, out, calls } = runStack(['preflight'], { setup: (tree) => fs.writeFileSync(path.join(tree, 'deploy/risepath-vm', file), 'X=1\n') });
            assert.equal(status, 1, `${file}: ${out}`);
            assert.match(out, new RegExp(`❌ deploy/risepath-vm/${file.replace('.', '\\.')} exists: the CI stack would load it \\(env_file\\)`), file);
            assert.deepEqual(calls, [], `${file}: no docker call`);
        }
        const ours = runStack(['preflight'], { dfKb: 10 * 1048576, setup: (tree) => fs.copyFileSync(path.join(tree, TEMPLATE), path.join(tree, STACK_ENV)) });
        assert.ok(ours.calls.some((line) => line.includes(' version ')), `the file it installed is not foreign: ${ours.out}`);
    });

    it('preflight and pull refuse a PATH without timeout (coreutils; stock macOS), with the remedy, before any docker call', () => {
        for (const sub of ['preflight', 'pull']) {
            const { status, out, calls } = runStack([sub], { dfKb: 10 * 1048576, hide: ['timeout'], noTimeoutStub: true });
            assert.equal(status, 1, `${sub}: ${out}`);
            assert.match(out, /❌ timeout is not on PATH \(coreutils; on a Mac: brew install coreutils, then put its gnubin folder on PATH\)/, sub);
            assert.deepEqual(calls, [], `${sub}: no docker call`);
        }
        const linked = runStack(['preflight'], { dfKb: 10 * 1048576, hide: [] });
        assert.ok(linked.calls.some((line) => line.includes(' version ')), `the linked PATH runs the script: ${linked.out}`);
        // A Mac without coreutils: the host's timeout is gone, the stub's pass-through stays.
        const mac = runStack(['preflight'], { dfKb: 10 * 1048576, hide: ['timeout'] });
        assert.ok(mac.calls.some((line) => line.includes(' version ')), `the stub PATH never depends on the host's coreutils: ${mac.out}`);
    });

    it('preflight prints the Docker, Compose and storage-driver versions (compare them with the VM\'s)', () => {
        const { calls, out } = runStack(['preflight'], { dfKb: 10 * 1048576 });
        assert.deepEqual(calls.slice(0, 3), [
            'docker [risepath-ci] version --format Docker {{.Server.Version}}',
            'docker [risepath-ci] compose version',
            'docker [risepath-ci] info --format Storage driver: {{.Driver}}',
        ]);
        assert.match(out, /Docker 29\.0\.0\nDocker Compose version v5\.0\.0\nStorage driver: overlayfs\n/);
    });

    it('preflight refuses less than 5 GB free on the repo\'s disk', { skip: SKIP_IF_PORTS_BUSY }, () => {
        const low = runStack(['preflight'], { dfKb: 5 * 1048576 - 1 });
        assert.equal(low.status, 1, low.out);
        assert.match(low.out, /Free disk: 4 GB\n❌ only 4 GB free; the CI stack needs 5 GB/);
        const enough = runStack(['preflight'], { dfKb: 5 * 1048576 });
        assert.equal(enough.status, 0, enough.out);
        assert.match(enough.out, /Free disk: 5 GB\n?$/);
    });

    it('preflight names the previous local run\'s images and build cache on a local refusal only', { skip: SKIP_IF_PORTS_BUSY }, () => {
        // down removes the project only (pinned above): the images and the build cache stay for a faster
        // rebuild, and on one disk they can push the next local run under the 5 GB floor.
        const hint = /docker image rm risepath-ci-api risepath-ci-mcp, then docker builder prune/;
        const local = runStack(['preflight'], { dfKb: 4 * 1048576 });
        assert.equal(local.status, 1, local.out);
        assert.match(local.out, /❌ only 4 GB free; the CI stack needs 5 GB \(images, build cache, database\); a previous local run kept its images and build cache: /);
        assert.match(local.out, hint);
        assert.ok(local.calls.includes('docker [risepath-ci] image inspect risepath-ci-api'), local.calls.join('\n'));
        const ci = runStack(['preflight'], { dfKb: 4 * 1048576, env: { CI: 'true' } });
        assert.equal(ci.status, 1, ci.out);
        assert.doesNotMatch(ci.out, hint, 'a CI runner starts empty');
        const none = runStack(['preflight'], { dfKb: 4 * 1048576, inspectFails: true });
        assert.equal(none.status, 1, none.out);
        assert.doesNotMatch(none.out, hint, 'no image of an earlier run');
        const enough = runStack(['preflight'], { dfKb: 5 * 1048576 });
        assert.equal(enough.status, 0, enough.out);
        assert.ok(!enough.calls.some((c) => / image inspect /.test(c)), 'no image lookup when the disk check passes');
    });

    it('preflight refuses a port the stack publishes when something listens on it', { skip: SKIP_IF_PORTS_BUSY }, async () => {
        for (const port of STACK_PORTS) {
            const server = net.createServer();
            await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', () => resolve(undefined)));
            try {
                const { status, out } = runStack(['preflight'], { dfKb: 10 * 1048576 });
                assert.equal(status, 1, `${port}: ${out}`);
                assert.match(out, new RegExp(`❌ port ${port} is in use \\(the CI stack needs it\\)`));
            } finally {
                await new Promise((resolve) => server.close(() => resolve(undefined)));
            }
        }
    });

    it('every compose call names the project risepath-ci; another COMPOSE_PROJECT_NAME is refused (exit 2)', () => {
        const down = runStack(['down']);
        assert.equal(down.status, 0, down.out);
        const compose = down.calls.filter((line) => / compose /.test(line));
        assert.ok(compose.length > 0);
        for (const line of compose) assert.ok(line.startsWith(COMPOSE), line);
        assert.equal(runStack(['down'], { env: { COMPOSE_PROJECT_NAME: 'risepath-ci' } }).status, 0);
        for (const name of ['risepath', 'other']) {
            const refused = runStack(['down'], { env: { COMPOSE_PROJECT_NAME: name } });
            assert.equal(refused.status, 2, refused.out);
            assert.match(refused.out, new RegExp(`❌ COMPOSE_PROJECT_NAME=${name}: this script drives the risepath-ci project only`));
            assert.deepEqual(refused.calls, [], `${name}: no call`);
        }
        assert.deepEqual(stackCode.match(/docker compose [^\n]*/g), ['docker compose -p "${PROJECT}" --env-file "$(envfile)" -f "${STACK}/docker-compose.yml" "$@"; }', 'docker compose version'],
            'one compose wrapper; preflight\'s version line names no project');
    });

    it('deploy <n> runs the tree\'s deploy-stack.sh with RISEPATH_DEPLOY_SKIP_PULL=1, writes deploy-<n>.log and fails when it fails, with an annotation', () => {
        /** @type {string[]} */
        const logs = [];
        const installed = (/** @type {string} */ tree) => fs.copyFileSync(path.join(tree, TEMPLATE), path.join(tree, STACK_ENV));
        const ok = runStack(['deploy', '1'], { setup: installed, inspect: (tree) => logs.push(fs.readFileSync(path.join(tree, '.artifacts/ci/stack/raw/deploy-1.log'), 'utf8')) });
        assert.equal(ok.status, 0, ok.out);
        assert.deepEqual(ok.calls, ['deploy-stack.sh RISEPATH_DEPLOY_SKIP_PULL=1 COMPOSE_PROJECT_NAME=risepath-ci']);
        assert.equal(logs[0], `==> deploy ${LEAKY}\n`, 'the raw log (redacted only by `logs`)');
        assert.match(ok.out, /==> deploy /, 'and the job log');

        const failed = runStack(['deploy', '2'], { deployExit: 3, setup: installed, inspect: (tree) => logs.push(fs.readFileSync(path.join(tree, '.artifacts/ci/stack/raw/deploy-2.log'), 'utf8')) });
        assert.equal(failed.status, 1, `pipefail: tee does not hide a failed deploy: ${failed.out}`);
        assert.match(stackScript, /^set -euo pipefail$/m);
        assert.equal(logs[1], `==> deploy ${LEAKY}\n`, 'the log of a failed deploy is kept for the logs step');
        // deploy-stack.sh prints no annotation: without this one the check's summary shows only the exit code.
        const DEPLOY_FAILED = 'deploy-stack\\.sh exited 3: its last lines above say why \\(deploy-2\\.log\\)';
        assert.match(failed.out, new RegExp(`^❌ ${DEPLOY_FAILED}$`, 'm'));
        assert.doesNotMatch(failed.out, /::error/, 'the annotation only on GitHub Actions');
        const annotated = runStack(['deploy', '2'], { deployExit: 3, setup: installed, env: { GITHUB_ACTIONS: 'true' } });
        assert.equal(annotated.status, 1, annotated.out);
        assert.match(annotated.out, new RegExp(`^❌ ${DEPLOY_FAILED}\\n::error title=Stack::${DEPLOY_FAILED}$`, 'm'));
        assert.doesNotMatch(runStack(['deploy', '1'], { setup: installed, env: { GITHUB_ACTIONS: 'true' } }).out, /::error/, 'a passing deploy has none');

        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-stack-logdir-'));
        try {
            assert.equal(runStack(['deploy', '1'], { setup: installed, env: { RISEPATH_CI_LOG_DIR: elsewhere } }).status, 0);
            assert.deepEqual(fs.readdirSync(elsewhere), ['deploy-1.log'], 'RISEPATH_CI_LOG_DIR moves the raw logs');
        } finally {
            fs.rmSync(elsewhere, { recursive: true, force: true });
        }
        assert.match(stackCode, /^ {2}RISEPATH_DEPLOY_SKIP_PULL=1 bash "\$\{STACK\}\/scripts\/deploy-stack\.sh" 2>&1 \| tee "\$\{LOG_DIR\}\/deploy-\$1\.log" \|\| status=\$\?$/m);
    });

    it('deploy runs only with the template that install-env wrote: a developer\'s or the VM\'s stack.env, or a foreign env file beside it, never reaches deploy-stack.sh', () => {
        const own = 'POSTGRES_PASSWORD=a-developer-s-own-value\n';
        for (const [what, setup, message] of /** @type {[string, (tree: string) => void, RegExp][]} */ ([
            ['no stack.env', () => {}, /❌ deploy\/risepath-vm\/stack\.env is not the CI template: run install-env first/],
            ['a foreign stack.env', (tree) => fs.writeFileSync(path.join(tree, STACK_ENV), own), /❌ deploy\/risepath-vm\/stack\.env is not the CI template: run install-env first/],
            ...['mcp-public.env', 'billing.env', 'tunnel.env'].map((file) => /** @type {[string, (tree: string) => void, RegExp]} */ ([`the template and a foreign ${file}`, (tree) => {
                fs.copyFileSync(path.join(tree, TEMPLATE), path.join(tree, STACK_ENV));
                fs.writeFileSync(path.join(tree, 'deploy/risepath-vm', file), own);
            }, new RegExp(`❌ deploy/risepath-vm/${file.replace('.', '\\.')} exists: the CI stack would load it \\(env_file\\)`)])),
        ])) {
            /** @type {boolean[]} */
            const logged = [];
            const { status, out, calls } = runStack(['deploy', '1'], { setup, inspect: (tree) => logged.push(fs.existsSync(path.join(tree, '.artifacts/ci/stack/raw/deploy-1.log'))) });
            assert.equal(status, 1, `${what}: ${out}`);
            assert.match(out, message, what);
            assert.deepEqual(calls, [], `${what}: no deploy-stack.sh or docker call`);
            assert.deepEqual(logged, [false], `${what}: no deploy log`);
        }
    });

    it('down removes the stand-in first (it is on the project\'s network), then the risepath-ci project with its volume, then only the env file it installed, then the front build', () => {
        /** @type {boolean[]} */
        const left = [];
        /** @type {string[][]} */
        const artifacts = [];
        const own = runStack(['down'], {
            setup: (tree) => {
                fs.copyFileSync(path.join(tree, TEMPLATE), path.join(tree, STACK_ENV));
                for (const file of ['dist/index.html', 'dist/assets/index-x.js', 'test-results/trace.zip', 'logs/compose.log']) {
                    fs.mkdirSync(path.dirname(path.join(tree, '.artifacts/e2e', file)), { recursive: true });
                    fs.writeFileSync(path.join(tree, '.artifacts/e2e', file), 'x\n');
                }
            },
            inspect: (tree) => {
                left.push(fs.existsSync(path.join(tree, STACK_ENV)));
                const dir = path.join(tree, '.artifacts/e2e');
                artifacts.push(fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
            },
        });
        assert.equal(own.status, 0, own.out);
        // The compose build context is the repo root and .dockerignore does not exclude .artifacts: a
        // build left behind would go to Docker with every later local deploy.
        assert.deepEqual(artifacts, [['logs', 'test-results']], 'the front build removed; the logs and test results kept for reading');
        assert.deepEqual(own.calls, [`docker [risepath-ci] rm -f ${AUTH_NAME}`, `${COMPOSE}<tree>/deploy/risepath-vm/stack.env -f <tree>/deploy/risepath-vm/docker-compose.yml down -v --remove-orphans --timeout 10`]);
        const foreign = runStack(['down'], {
            setup: (tree) => fs.writeFileSync(path.join(tree, STACK_ENV), 'X=1\n'),
            inspect: (tree) => left.push(fs.existsSync(path.join(tree, STACK_ENV))),
        });
        assert.equal(foreign.status, 0, foreign.out);
        assert.deepEqual(foreign.calls, [`docker [risepath-ci] rm -f ${AUTH_NAME}`, `${COMPOSE}<tree>/${TEMPLATE} -f <tree>/deploy/risepath-vm/docker-compose.yml down -v --remove-orphans --timeout 10`], 'a foreign stack.env is never read');
        assert.deepEqual(left, [false, true], 'its own stack.env removed; a foreign one kept');
        assert.doesNotMatch(stackCommands, /prune|docker volume rm|docker system|docker rmi|docker image rm/, 'removes nothing but the project');
        assert.deepEqual(stackCode.match(/docker rm [^\n#]*/g)?.map((line) => line.trim()), Array(2).fill('docker rm -f "${AUTH_NAME}" > /dev/null 2>&1 || true'), 'the only container it removes by name is its own stand-in (auth, down)');
        assert.match(stackCode, /^AUTH_NAME="\$\{PROJECT\}-auth"$/m);
    });

    it('pull: both base images from Docker Hub; when it refuses, the same reference from mirror.gcr.io re-tagged to the compose/Dockerfile reference, which must then resolve', () => {
        const pulls = (/** @type {string[]} */ calls) => calls.filter((line) => /^docker \[risepath-ci\] (pull|tag|image) /.test(line)).map((line) => line.replace('docker [risepath-ci] ', ''));
        const hub = runStack(['pull']);
        assert.equal(hub.status, 0, hub.out);
        assert.deepEqual(pulls(hub.calls), ['pull -q node:22-slim', `pull -q ${PG_IMAGE}`]);
        assert.doesNotMatch(hub.out, /::warning/);

        const mirror = runStack(['pull'], { failPull: (image) => !image.startsWith('mirror.gcr.io/') });
        assert.equal(mirror.status, 0, mirror.out);
        assert.deepEqual(pulls(mirror.calls), [
            'pull -q node:22-slim', 'pull -q mirror.gcr.io/library/node:22-slim', 'tag mirror.gcr.io/library/node:22-slim node:22-slim', 'image inspect node:22-slim',
            `pull -q ${PG_IMAGE}`, `pull -q mirror.gcr.io/pgvector/pgvector@${PG_DIGEST}`, `tag mirror.gcr.io/pgvector/pgvector@${PG_DIGEST} pgvector/pgvector:0.8.7-pg16`, `image inspect ${PG_IMAGE}`,
        ]);
        assert.match(mirror.out, /::warning ::docker pull node:22-slim: Docker Hub failed; using mirror\.gcr\.io\/library\/node:22-slim \(a pinned digest is the same image\)/);
        assert.match(mirror.out, /::warning ::docker pull pgvector\/pgvector:0\.8\.7-pg16: Docker Hub failed; using mirror\.gcr\.io\/pgvector\/pgvector \(a pinned digest is the same image\)/);

        // The classic image store cannot re-tag to a digest reference: the inspect fails, and so does the job.
        const classic = runStack(['pull'], { failPull: (image) => !image.startsWith('mirror.gcr.io/'), inspectFails: true });
        assert.equal(classic.status, 1, classic.out);
        assert.equal(pulls(classic.calls).filter((line) => line === 'image inspect node:22-slim').length, 3, 'three attempts');
        assert.deepEqual(classic.calls.filter((line) => line.startsWith('sleep ')), ['sleep 10', 'sleep 20']);
        assert.match(classic.out.trimEnd().split('\n').at(-1) ?? '', /^❌ docker pull node:22-slim failed on Docker Hub and mirror\.gcr\.io \(attempt 3 of 3, 420 s at most for all pulls\); re-run the job later$/);
        assert.ok(!classic.calls.some((line) => line.includes('pgvector')), 'stops at the first image');
    });

    it('pull is bounded: one deadline for every pull and pause, inside the workflow step\'s limit', () => {
        const each = Number(/^PULL_EACH_S=(\d+)$/m.exec(stackCode)?.[1]);
        const budget = Number(/^PULL_BUDGET_S=(\d+)$/m.exec(stackCode)?.[1]);
        assert.ok(each > 0 && each < budget, `each pull ${each} s, all of them ${budget} s`);
        assert.match(stackCode, /^ {2}local image attempt mirror pause pull_end=\$\(\(SECONDS \+ PULL_BUDGET_S\)\)$/m);
        assert.match(stackCode, /^ {4}local left=\$\(\(pull_end - SECONDS\)\)\n {4}if \[\[ "\$\{left\}" -le 0 \]\]; then return 1; fi\n {4}timeout "\$\(\(left < PULL_EACH_S \? left : PULL_EACH_S\)\)" docker pull -q "\$1" > \/dev\/null$/m);
        assert.equal(stackCommands.match(/docker pull/g)?.length, 1, 'every pull goes through pull()');
        assert.match(stackCode, /if \[\[ "\$\{attempt\}" -eq 3 \|\| \$\(\(pull_end - SECONDS\)\) -le "\$\{pause\}" \]\]; then\n\s+fail "[^\n]*re-run the job later"\n/, 'no pause past the deadline');
        const step = stackStepTimeout('pull');
        assert.ok(Number.isInteger(step), 'the stack job\'s pull step has timeout-minutes');
        // Each pull is cut at what is left, so all of them end by the budget; tag and inspect take seconds.
        assert.ok(budget + 60 <= 60 * step, `${budget} s of pulls, plus 60 s, must fit in the step's ${step} min`);
    });

    it('mcp-db asks the admin MCP inside its container whether its database answered', () => {
        const ok = runStack(['mcp-db']);
        assert.equal(ok.status, 0, ok.out);
        assert.equal(ok.calls.length, 1);
        assert.ok(ok.calls[0].startsWith(`${COMPOSE}<tree>/${TEMPLATE} -f <tree>/deploy/risepath-vm/docker-compose.yml exec -T mcp node -e `), ok.calls[0]);
        const down = runStack(['mcp-db'], { mcpExit: 1 });
        assert.equal(down.status, 1, down.out);
        assert.match(down.out, /❌ mcp \/health: the database is not connected/);

        // The snippet itself (mcp's /health is 200 whatever the database says): only db=connected passes.
        const snippet = /compose exec -T mcp node -e "([^"]+)"/.exec(stackCode)?.[1] ?? '';
        assert.match(snippet, /fetch\('http:\/\/127\.0\.0\.1:3100\/health', \{ signal: AbortSignal\.timeout\(20000\) \}\)/, 'bounded: a local run has no step timeout');
        /** @param {string} fake */
        const exitOf = (fake) => spawnSync(process.execPath, ['-e', `globalThis.fetch = ${fake};\n${snippet}`], { encoding: 'utf8', timeout: 20_000 }).status;
        assert.equal(exitOf("async () => ({ json: async () => ({ status: 'ok', db: 'connected' }) })"), 0);
        assert.equal(exitOf("async (url, init) => ({ json: async () => ({ db: init?.signal instanceof AbortSignal ? 'connected' : 'no signal' }) })"), 0, 'the request carries the time limit');
        for (const db of ['disconnected', 'timeout', 'not_configured']) {
            assert.equal(exitOf(`async () => ({ json: async () => ({ status: 'degraded', db: '${db}' }) })`), 1, db);
        }
        assert.equal(exitOf("async () => { throw new Error('ECONNREFUSED'); }"), 1, 'no answer');
        assert.equal(exitOf("async () => ({ json: async () => { throw new SyntaxError('not json'); } })"), 1, 'not JSON');
    });

    it('health reads /api/v2/health from the host and passes only a production-ready snapshot with no pending migration', () => {
        const ok = runStack(['health']);
        assert.equal(ok.status, 0, ok.out);
        // No --fail: a 503 body (ok false, which check) reaches the check and the job log.
        // --max-time: a local npm run ci:stack has no step timeout, and an api that never answers must not hang it.
        assert.deepEqual(ok.calls, ['curl -sS --max-time 20 http://127.0.0.1:3006/api/v2/health']);
        for (const [what, body] of /** @type {[string, unknown][]} */ ([
            ['ok false', { ...HEALTH, ok: false }],
            ['not production', { ...HEALTH, node_env: 'development' }],
            ['strict auth off', { ...HEALTH, checks: { ...HEALTH.checks, strict_auth_mode: false } }],
            ['demo data', { ...HEALTH, checks: { ...HEALTH.checks, production_data_mode: false } }],
            ['a pending migration', { ...HEALTH, database: { migrations: { pending: 1, ok: false } } }],
            ['no migration status', { ...HEALTH, database: { status: 'error' } }],
        ])) {
            const bad = runStack(['health'], { health: body });
            assert.equal(bad.status, 1, `${what}: ${bad.out}`);
            assert.match(bad.out, /^health: \{"ok":/m, what);
            assert.match(bad.out, /❌ \/api\/v2\/health from the host is not production-ready/, what);
        }
        const unreachable = runStack(['health'], { curlExit: 7 });
        assert.equal(unreachable.status, 1, unreachable.out);
        assert.match(unreachable.out, /^health: not JSON: ""$/m);
        assert.match(unreachable.out, /❌ \/api\/v2\/health from the host is not production-ready/);
        const html = runStack(['health'], { health: '<html>' });
        assert.equal(html.status, 1, html.out);
        assert.match(html.out, /^health: not JSON: "<html>"$/m);
    });

    it('auth publishes the stand-in on 127.0.0.1 only, under the alias the template\'s SUPABASE_URL names, with the switch, and checks the api can reach it', () => {
        const installed = (/** @type {string} */ tree) => fs.copyFileSync(path.join(tree, TEMPLATE), path.join(tree, STACK_ENV));
        const { status, out, calls } = runStack(['auth'], { setup: installed });
        assert.equal(status, 0, out);
        const port = new URL(template.match(/^SUPABASE_URL=(.*)$/m)?.[1] ?? '').port;
        assert.equal(port, String(STANDIN_DEFAULT_PORT), 'one port: the template\'s SUPABASE_URL and the stand-in\'s default');
        const health = `curl -fsS --max-time 5 http://127.0.0.1:${port}/auth/v1/health`;
        assert.deepEqual(calls, [
            `docker [risepath-ci] rm -f ${AUTH_NAME}`,
            `docker [risepath-ci] run -d --name ${AUTH_NAME} --network risepath-ci_default --network-alias auth-stand-in`
                + ` -p 127.0.0.1:${port}:${port} --read-only --cap-drop ALL --security-opt no-new-privileges --user node`
                + ` -e RISEPATH_E2E_AUTH_STANDIN=1 -e E2E_AUTH_HOST=0.0.0.0 -e E2E_AUTH_PORT=${port} -e E2E_AUTH_PUBLIC_URL=http://127.0.0.1:${port}`
                + ` --mount type=bind,src=<tree>/${STANDIN},dst=/stand-in/auth-stand-in.mjs,readonly node:22-slim node /stand-in/auth-stand-in.mjs`,
            health,
            health,
            `${COMPOSE}<tree>/${STACK_ENV} -f <tree>/deploy/risepath-vm/docker-compose.yml exec -T api node -e fetch('http://auth-stand-in:${port}/auth/v1/health', { signal: AbortSignal.timeout(20000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`,
        ]);
        assert.match(out, new RegExp(`==> auth stand-in: http://127\\.0\\.0\\.1:${port} \\(browser\\), http://auth-stand-in:${port} \\(api\\)`));
        assert.doesNotMatch(stackCode, new RegExp(`${port}|auth-stand-in:|node:22-slim`), 'stack.sh names no port, alias or image: the template and the Dockerfile do');

        // Another name and port in the template move every part with them; the api's base image too.
        const moved = runStack(['auth'], {
            setup: (tree) => {
                fs.writeFileSync(path.join(tree, TEMPLATE), template.replace(/^SUPABASE_URL=.*$/m, 'SUPABASE_URL=http://other-auth:54391'));
                fs.writeFileSync(path.join(tree, 'deploy/risepath-vm/Dockerfile'), read('deploy/risepath-vm/Dockerfile').replace(/^FROM node:22-slim AS api$/m, 'FROM node:24-slim AS api'));
            },
        });
        assert.equal(moved.status, 0, moved.out);
        const run = moved.calls.find((line) => line.includes(' run -d ')) ?? '';
        for (const part of ['--network-alias other-auth ', '-p 127.0.0.1:54391:54391 ', 'E2E_AUTH_PORT=54391 ', ' node:24-slim node ']) assert.ok(run.includes(part), `${part}: ${run}`);
        assert.ok(moved.calls.some((line) => line.includes("exec -T api node -e fetch('http://other-auth:54391/auth/v1/health'")), moved.calls.join('\n'));
    });

    it('auth refuses a SUPABASE_URL it cannot publish, a missing stand-in file or Dockerfile api stage, before any docker call', () => {
        for (const [what, setup, message] of /** @type {[string, (tree: string) => void, RegExp][]} */ ([
            ['an https URL', (tree) => fs.writeFileSync(path.join(tree, TEMPLATE), template.replace(/^SUPABASE_URL=.*$/m, 'SUPABASE_URL=https://abc.supabase.co')), /❌ SUPABASE_URL of deploy\/risepath-vm\/ci\/stack\.ci\.env is not http:\/\/<name>:<port>/],
            ['a URL with a path', (tree) => fs.writeFileSync(path.join(tree, TEMPLATE), template.replace(/^SUPABASE_URL=.*$/m, 'SUPABASE_URL=http://auth-stand-in:54390/x')), /is not http:\/\/<name>:<port>/],
            ['a quote in the name', (tree) => fs.writeFileSync(path.join(tree, TEMPLATE), template.replace(/^SUPABASE_URL=.*$/m, "SUPABASE_URL=http://a'b:54390")), /is not http:\/\/<name>:<port>/],
            ['no stand-in file', (tree) => fs.rmSync(path.join(tree, STANDIN)), /❌ e2e\/support\/auth-stand-in\.mjs is missing/],
            ['no api stage', (tree) => fs.writeFileSync(path.join(tree, 'deploy/risepath-vm/Dockerfile'), 'FROM node:22-slim\n'), /❌ deploy\/risepath-vm\/Dockerfile has no "FROM <image> AS api" line/],
        ])) {
            const { status, out, calls } = runStack(['auth'], { setup });
            assert.equal(status, 1, `${what}: ${out}`);
            assert.match(out, message, what);
            assert.deepEqual(calls, [], `${what}: no docker call`);
        }
    });

    it('auth fails with the stand-in\'s own log when it never answers, and names the network when the api cannot reach it', () => {
        const silent = runStack(['auth'], { curlExit: 7, standIn: true });
        assert.equal(silent.status, 1, silent.out);
        assert.match(silent.out, /❌ the auth stand-in does not answer on http:\/\/127\.0\.0\.1:54390/);
        assert.match(silent.out, /auth stand-in listening on/, 'its log is printed');
        assert.equal(silent.calls.filter((line) => line.startsWith('sleep ')).length, 30, 'a 30-second readiness poll, not a test wait');
        assert.equal(silent.calls.filter((line) => line.startsWith('curl ')).length, 31);
        assert.ok(!silent.calls.some((line) => / exec -T api /.test(line)), 'the api check never runs');
        const unreachable = runStack(['auth'], { apiExit: 1 });
        assert.equal(unreachable.status, 1, unreachable.out);
        assert.match(unreachable.out, /❌ the api container cannot reach http:\/\/auth-stand-in:54390 \(network risepath-ci_default\)/);
    });

    it('logs writes the compose state and the redacted compose and deploy logs into the folder given (relative to the caller), keeping the raw log', () => {
        const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-stack-caller-'));
        try {
            /** @type {Record<string, string>} */
            const files = {};
            /** @type {string[]} */
            const raw = [];
            const { status, out, calls } = runStack(['logs', 'kept/logs'], {
                cwd: outer,
                setup: (tree) => {
                    fs.copyFileSync(path.join(tree, TEMPLATE), path.join(tree, STACK_ENV));
                    fs.mkdirSync(path.join(tree, '.artifacts/ci/stack/raw'), { recursive: true });
                    fs.writeFileSync(path.join(tree, '.artifacts/ci/stack/raw/deploy-1.log'), `==> deploy ${LEAKY}\n`);
                },
                inspect: (tree) => raw.push(fs.readFileSync(path.join(tree, '.artifacts/ci/stack/raw/deploy-1.log'), 'utf8')),
            });
            for (const name of fs.readdirSync(path.join(outer, 'kept/logs')).sort()) files[name] = fs.readFileSync(path.join(outer, 'kept/logs', name), 'utf8');
            assert.equal(status, 0, out);
            assert.deepEqual(Object.keys(files), ['compose-ps.txt', 'compose.log', 'deploy-1.log']);
            assert.deepEqual(calls.map((line) => line.replace(/ --env-file \S+ -f \S+/, '')), ['docker [risepath-ci] compose -p risepath-ci ps -a', 'docker [risepath-ci] compose -p risepath-ci logs --no-color --timestamps', `docker [risepath-ci] container inspect ${AUTH_NAME}`], 'no stand-in log where auth never ran (Server stack deploy)');
            for (const [name, text] of Object.entries(files)) {
                for (const secret of ['ci-dummy-db-password', 'ci-dummy-bridge-token', 'abc.def-ghi']) assert.ok(!text.includes(secret), `${name} holds ${secret}`);
            }
            assert.match(files['compose.log'], /risepath-ci-api-1 {2}\| - Environment: production/);
            assert.match(files['compose.log'], /DATABASE_URL_PHASE1=<value> token=<value>/);
            assert.match(files['compose.log'], /Bearer <token>/);
            assert.equal(files['deploy-1.log'], '==> deploy DATABASE_URL_PHASE1=<value> token=<value>\n');
            assert.deepEqual(raw, [`==> deploy ${LEAKY}\n`], 'the workspace copy stays raw; only the folder given is uploaded');
            assert.match(out, /Environment: production/, 'the tail of compose.log goes to the job log');
        } finally {
            fs.rmSync(outer, { recursive: true, force: true });
        }
    });

    it('logs adds the stand-in\'s log, redacted, where auth started it', () => {
        /** @type {Record<string, string>} */
        const files = {};
        const { status, out, calls } = runStack(['logs', 'kept'], {
            standIn: true,
            inspect: (tree) => {
                const dir = path.join(path.dirname(tree), 'kept');
                for (const name of fs.readdirSync(dir)) files[name] = fs.readFileSync(path.join(dir, name), 'utf8');
            },
        });
        assert.equal(status, 0, out);
        assert.deepEqual(Object.keys(files).sort(), ['auth-stand-in.log', 'compose-ps.txt', 'compose.log']);
        assert.ok(calls.includes(`docker [risepath-ci] logs --timestamps ${AUTH_NAME}`), calls.join('\n'));
        assert.match(files['auth-stand-in.log'], /^2026-10-27T15:00:01Z POST \/auth\/v1\/token\?grant_type=password 200 Bearer <token>$/m);
        assert.ok(!files['auth-stand-in.log'].includes('abc.def-ghi'));
    });

    it('logs also masks the secret values of env files it did not write (a developer\'s stack.env, billing.env)', () => {
        /** @type {string[]} */
        const kept = [];
        const { status, out } = runStack(['logs', 'kept'], {
            setup: (tree) => {
                fs.writeFileSync(path.join(tree, STACK_ENV), 'POSTGRES_PASSWORD=a-developer-s-own-value\n');
                fs.writeFileSync(path.join(tree, 'deploy/risepath-vm/billing.env'), 'STRIPE_WEBHOOK_SECRET=a-developer-s-billing-value\n');
                fs.mkdirSync(path.join(tree, '.artifacts/ci/stack/raw'), { recursive: true });
                fs.writeFileSync(path.join(tree, '.artifacts/ci/stack/raw/deploy-1.log'), `${LEAKY} a-developer-s-own-value a-developer-s-billing-value\n`);
            },
            inspect: (tree) => kept.push(fs.readFileSync(path.join(path.dirname(tree), 'kept/deploy-1.log'), 'utf8')),
        });
        assert.equal(status, 0, out);
        assert.deepEqual(kept, ['DATABASE_URL_PHASE1=<value> token=<value> <value> <value>\n']);
    });

    it('rehearsal runs the job\'s subcommands in order, and always removes the stack: with the logs when a step fails', { skip: SKIP_IF_PORTS_BUSY }, () => {
        /** @type {{ env: boolean, logs: string[] }[]} */
        const seen = [];
        const look = (/** @type {string} */ tree) => {
            const logs = path.join(tree, '.artifacts/ci/stack/logs');
            seen.push({ env: fs.existsSync(path.join(tree, STACK_ENV)), logs: fs.existsSync(logs) ? fs.readdirSync(logs).sort() : [] });
        };
        const steps = (/** @type {string[]} */ calls) => calls.map((line) => {
            if (line.startsWith('deploy-stack.sh ')) return 'deploy';
            if (line.startsWith('curl ')) return 'health';
            if (/ exec -T mcp /.test(line)) return 'mcp-db';
            if (/ down -v /.test(line) || line === `docker [risepath-ci] rm -f ${AUTH_NAME}`) return 'down';
            if (/ (logs|ps -a)( |$)/.test(line) || line === `docker [risepath-ci] container inspect ${AUTH_NAME}`) return 'logs';
            // image inspect: a refused preflight looks for an earlier local run's images (the disk hint).
            if (/^docker \[risepath-ci\] (version|info|compose version|image inspect risepath-ci-api$)/.test(line)) return 'preflight';
            if (/^docker \[risepath-ci\] pull /.test(line)) return 'pull';
            return line;
        }).filter((step, i, all) => step !== all[i - 1]);

        const pass = runStack(['rehearsal'], { dfKb: 10 * 1048576, inspect: look });
        assert.equal(pass.status, 0, pass.out);
        assert.deepEqual(steps(pass.calls), ['preflight', 'pull', 'deploy', 'mcp-db', 'health', 'down']);
        assert.match(pass.out, /# Server stack deploy: all passed\n/);

        const failed = runStack(['rehearsal'], { dfKb: 10 * 1048576, mcpExit: 1, inspect: look });
        assert.equal(failed.status, 1, failed.out);
        assert.deepEqual(steps(failed.calls), ['preflight', 'pull', 'deploy', 'mcp-db', 'logs', 'down']);
        assert.doesNotMatch(failed.out, /all passed/);

        // A re-run after an earlier failed one: none of that run's logs is kept as this run's.
        const refused = runStack(['rehearsal'], {
            dfKb: 1048576,
            inspect: look,
            setup: (tree) => {
                for (const dir of ['.artifacts/ci/stack/raw', '.artifacts/ci/stack/logs']) fs.mkdirSync(path.join(tree, dir), { recursive: true });
                fs.writeFileSync(path.join(tree, '.artifacts/ci/stack/raw/deploy-1.log'), 'an earlier run\n');
                fs.writeFileSync(path.join(tree, '.artifacts/ci/stack/logs/deploy-1.log'), 'an earlier run\n');
            },
        });
        assert.equal(refused.status, 1, refused.out);
        assert.deepEqual(steps(refused.calls), ['preflight', 'logs', 'down'], 'a refused preflight still tears down');

        assert.deepEqual(seen, [
            { env: false, logs: [] },
            { env: false, logs: ['compose-ps.txt', 'compose.log', 'deploy-1.log'] },
            { env: false, logs: ['compose-ps.txt', 'compose.log'] },
        ], 'stack.env removed every time; logs only after a failure');
    });

    it('rehearsal still removes the stack, and keeps the failed step\'s exit code, when collecting the logs fails', { skip: SKIP_IF_PORTS_BUSY }, () => {
        /** @type {boolean[]} */
        const left = [];
        const { status, out, calls } = runStack(['rehearsal'], { dfKb: 10 * 1048576, deployExit: 3, redactFails: true, inspect: (tree) => left.push(fs.existsSync(path.join(tree, STACK_ENV))) });
        assert.match(out, /node: stub: redact failed/, 'the redaction of deploy-1.log failed inside the EXIT trap');
        assert.match(out, /❌ deploy-stack\.sh exited 3: /, 'the deploy failed with 3');
        assert.equal(status, 1, `the deploy step's exit code (its fail), not the redaction's (7): ${out}`);
        assert.ok(calls.at(-1)?.includes(' down -v --remove-orphans '), `down runs last: ${calls.at(-1)}`);
        assert.deepEqual(left, [false], 'the installed stack.env is removed');
    });

    /** npm stub: records the build and what it saw, then writes a bundle that names VITE_SUPABASE_URL (unless STUB_BUILD_EMPTY=1). */
    const NPM = [
        'echo "npm $* [pwd=$PWD] url=${VITE_SUPABASE_URL-<unset>} anon=${VITE_SUPABASE_ANON_KEY-<unset>} legal=${VITE_FEATURE_LEGAL_PAGES-<unset>} foo=${VITE_FOO-<unset>} options=${NODE_OPTIONS-<unset>}" >> "$STUB_LOG"',
        'mkdir -p .artifacts/e2e/dist/assets',
        'if [[ "${STUB_BUILD_EMPTY:-}" == 1 ]]; then echo "const u = 1;" > .artifacts/e2e/dist/assets/index-x.js; else echo "const u = \"${VITE_SUPABASE_URL}\";" > .artifacts/e2e/dist/assets/index-x.js; fi',
    ].join('\n');
    /** npx stub: records the call and its folder, exits STUB_NPX_EXIT. */
    const NPX = 'echo "npx $* [pwd=$PWD]" >> "$STUB_LOG"\nexit "${STUB_NPX_EXIT:-0}"';
    const E2E_PORTS = [...STACK_PORTS, 4173, STANDIN_DEFAULT_PORT];
    const E2E_BUSY = E2E_PORTS.filter(busy);
    const SKIP_IF_E2E_PORTS_BUSY = E2E_BUSY.length === 0 ? false : `a port of the e2e stack is in use on this machine (${E2E_BUSY.join(', ')}): preflight e2e would refuse it first`;

    it('preflight e2e also refuses the preview\'s port 4173 and the stand-in\'s (the template\'s SUPABASE_URL); preflight takes nothing else', { skip: SKIP_IF_E2E_PORTS_BUSY }, async () => {
        for (const port of [4173, STANDIN_DEFAULT_PORT]) {
            const server = net.createServer();
            await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', () => resolve(undefined)));
            try {
                const e2e = runStack(['preflight', 'e2e'], { dfKb: 10 * 1048576 });
                assert.equal(e2e.status, 1, `${port}: ${e2e.out}`);
                assert.match(e2e.out, new RegExp(`❌ port ${port} is in use \\(the CI stack needs it\\)`));
                const stack = runStack(['preflight'], { dfKb: 10 * 1048576 });
                assert.equal(stack.status, 0, `Server stack deploy needs no ${port}: ${stack.out}`);
            } finally {
                await new Promise((resolve) => server.close(() => resolve(undefined)));
            }
        }
        const free = runStack(['preflight', 'e2e'], { dfKb: 10 * 1048576 });
        assert.equal(free.status, 0, free.out);
        const other = runStack(['preflight', 'nope']);
        assert.equal(other.status, 1, other.out);
        assert.match(other.out, /❌ preflight takes nothing or e2e, not 'nope'/);
        assert.deepEqual(other.calls, [], 'no docker call');
    });

    it('build-front builds build:prod into .artifacts/e2e/dist for the stand-in: its URL, a dummy anon key, no legal-pages flag, local .env VITE_ keys blanked', () => {
        const { status, out, calls } = runStack(['build-front'], {
            stubs: { npm: NPM },
            env: { VITE_FEATURE_LEGAL_PAGES: 'true' },
            setup: (tree) => fs.writeFileSync(path.join(tree, '.env.local'), 'VITE_FOO=a-local-value\nVITE_SUPABASE_URL=https://real.example.org\nOTHER=1\n'),
        });
        assert.equal(status, 0, out);
        assert.deepEqual(calls, [`npm run build:prod -- --outDir .artifacts/e2e/dist --emptyOutDir [pwd=<tree>] url=http://127.0.0.1:${STANDIN_DEFAULT_PORT} anon=ci-dummy-anon-key legal=<unset> foo= options=--max-old-space-size=4096`]);
        assert.match(out, /blanking 1 VITE_\* keys found in local \.env files/);
        assert.match(stackCode, /npm run build:prod -- --outDir \.artifacts\/e2e\/dist --emptyOutDir/, 'the deployed build mode (VITE_DEMO_MODE=false)');
        const empty = runStack(['build-front'], { stubs: { npm: NPM }, env: { STUB_BUILD_EMPTY: '1' } });
        assert.equal(empty.status, 1, empty.out);
        assert.match(empty.out, new RegExp(`❌ the build does not point at the auth stand-in \\(127\\.0\\.0\\.1:${STANDIN_DEFAULT_PORT}\\)`));
        const failed = runStack(['build-front'], { stubs: { npm: 'exit 3' } });
        assert.equal(failed.status, 3, `a failed build fails the step: ${failed.out}`);
    });

    it('build-front blanks the VITE_ keys of every line form Vite\'s dotenv reads: export, indented, `NAME: value`, lower-case', () => {
        // Each key the stub sees, or <unset>: Vite's loadEnv would read every one of these lines.
        const npm = NPM.replace('foo=${VITE_FOO-<unset>}', 'foo=${VITE_FOO-<unset>} bar=${VITE_BAR-<unset>} base=${VITE_APP_BASE_PATH-<unset>} lower=${VITE_lower-<unset>}');
        const { status, out, calls } = runStack(['build-front'], {
            stubs: { npm },
            setup: (tree) => fs.writeFileSync(path.join(tree, '.env.local'), [
                'export VITE_FOO=a-local-value',
                '  VITE_FEATURE_LEGAL_PAGES=true',
                'VITE_BAR: x',
                '\texport\tVITE_APP_BASE_PATH=/app/',
                'VITE_lower=y',
                '# VITE_COMMENTED=1',
                'VITE_SUPABASE_URL=https://real.example.org',
                '',
            ].join('\n')),
        });
        assert.equal(status, 0, out);
        assert.equal(calls.length, 1, calls.join('\n'));
        for (const part of [' foo= ', ' bar= ', ' base= ', ' lower= ', ' legal= ', ` url=http://127.0.0.1:${STANDIN_DEFAULT_PORT} `]) {
            assert.ok(calls[0].includes(part), `${part.trim()}: ${calls[0]}`);
        }
        assert.match(out, /blanking 5 VITE_\* keys found in local \.env files/, 'not the comment, not the stand-in\'s own two keys');
        assert.doesNotMatch(stackCode, /grep -ho '\^VITE_\[A-Z0-9_\]\*'/, 'plain VITE_X= lines are not the only form Vite reads');
    });

    it('browser installs the headless shell with its system packages on CI only, three bounded attempts inside the workflow step', () => {
        const local = runStack(['browser'], { stubs: { npx: NPX } });
        assert.equal(local.status, 0, local.out);
        assert.match(local.out, /Local run: Playwright uses PLAYWRIGHT_CHROMIUM_PATH/);
        assert.deepEqual(local.calls, [], 'nothing is installed on a developer\'s machine');
        const ci = runStack(['browser'], { stubs: { npx: NPX }, env: { CI: 'true' } });
        assert.equal(ci.status, 0, ci.out);
        assert.deepEqual(ci.calls, ['npx playwright install --with-deps --only-shell chromium [pwd=<tree>]']);
        const broken = runStack(['browser'], { stubs: { npx: NPX }, env: { CI: 'true', STUB_NPX_EXIT: '1' } });
        assert.equal(broken.status, 1, broken.out);
        assert.deepEqual(broken.calls.map((line) => line.split(' [')[0]), ['npx playwright install --with-deps --only-shell chromium', 'sleep 15', 'npx playwright install --with-deps --only-shell chromium', 'sleep 30', 'npx playwright install --with-deps --only-shell chromium']);
        assert.match(broken.out, /❌ playwright install failed 3 times; re-run the job later$/m);
        const each = Number(/^BROWSER_EACH_S=(\d+)$/m.exec(stackCode)?.[1]);
        assert.match(stackCode, /timeout "\$\{BROWSER_EACH_S\}" npx playwright install --with-deps --only-shell chromium/);
        const step = stackStepTimeout('browser', 'e2e');
        assert.ok(Number.isInteger(step), 'the e2e job\'s browser step has timeout-minutes');
        assert.ok(3 * each + 15 + 30 <= 60 * step, `3 × ${each} s and the pauses must fit in the step's ${step} min`);
    });

    it('test runs npx playwright test at the repo root, whatever folder it is called from, and fails with it', () => {
        const pass = runStack(['test'], { stubs: { npx: NPX } });
        assert.equal(pass.status, 0, pass.out);
        assert.deepEqual(pass.calls, ['npx playwright test [pwd=<tree>]']);
        const red = runStack(['test'], { stubs: { npx: NPX }, env: { STUB_NPX_EXIT: '1' } });
        assert.equal(red.status, 1, red.out);
    });

    it('e2e runs the Learner end-to-end job\'s subcommands in order, and always removes the stack: with the logs in .artifacts/e2e/logs when a step fails', { skip: SKIP_IF_E2E_PORTS_BUSY }, () => {
        /** @type {{ env: boolean, dist: boolean, logs: string[] }[]} */
        const seen = [];
        const look = (/** @type {string} */ tree) => {
            const logs = path.join(tree, '.artifacts/e2e/logs');
            seen.push({ env: fs.existsSync(path.join(tree, STACK_ENV)), dist: fs.existsSync(path.join(tree, '.artifacts/e2e/dist')), logs: fs.existsSync(logs) ? fs.readdirSync(logs).sort() : [] });
        };
        const steps = (/** @type {string[]} */ calls) => calls.filter((line) => line !== `docker [risepath-ci] rm -f ${AUTH_NAME}`).map((line) => {
            if (line.startsWith('deploy-stack.sh ')) return 'deploy';
            if (line.startsWith('npm run build:prod ')) return 'build-front';
            if (line.startsWith('npx playwright test ')) return 'test';
            if (line.startsWith('curl ') || / exec -T api /.test(line) || line.includes(` run -d --name ${AUTH_NAME} `)) return 'auth';
            if (/ down -v /.test(line)) return 'down';
            if (/ (logs|ps -a)( |$)/.test(line) || line === `docker [risepath-ci] container inspect ${AUTH_NAME}`) return 'logs';
            // image inspect: a refused preflight looks for an earlier local run's images (the disk hint).
            if (/^docker \[risepath-ci\] (version|info|compose version|image inspect risepath-ci-api$)/.test(line)) return 'preflight';
            if (/^docker \[risepath-ci\] pull /.test(line)) return 'pull';
            return line;
        }).filter((step, i, all) => step !== all[i - 1]);
        const stubs = { npm: NPM, npx: NPX };

        const pass = runStack(['e2e'], { dfKb: 10 * 1048576, stubs, inspect: look });
        assert.equal(pass.status, 0, pass.out);
        assert.deepEqual(steps(pass.calls), ['preflight', 'pull', 'deploy', 'auth', 'build-front', 'test', 'down']);
        assert.equal(pass.calls.filter((line) => line === `docker [risepath-ci] rm -f ${AUTH_NAME}`).length, 2, 'auth starts a fresh stand-in; down removes it');
        assert.match(pass.out, /Local run: Playwright uses/, 'browser installs nothing locally');
        assert.match(pass.out, /# Learner end-to-end: all passed\n/);

        const red = runStack(['e2e'], {
            dfKb: 10 * 1048576,
            stubs,
            standIn: true,
            env: { STUB_NPX_EXIT: '1' },
            inspect: look,
            setup: (tree) => {
                fs.mkdirSync(path.join(tree, '.artifacts/e2e/logs'), { recursive: true });
                fs.writeFileSync(path.join(tree, '.artifacts/e2e/logs/compose.log'), 'an earlier run\n');
                fs.writeFileSync(path.join(tree, '.artifacts/e2e/logs/old.log'), 'an earlier run\n');
            },
        });
        assert.equal(red.status, 1, red.out);
        assert.deepEqual(steps(red.calls), ['preflight', 'pull', 'deploy', 'auth', 'build-front', 'test', 'logs', 'down']);
        assert.doesNotMatch(red.out, /all passed/);

        const refused = runStack(['e2e'], { dfKb: 1048576, stubs, inspect: look });
        assert.equal(refused.status, 1, refused.out);
        assert.deepEqual(steps(refused.calls), ['preflight', 'logs', 'down'], 'a refused preflight still tears down');

        assert.deepEqual(seen, [
            { env: false, dist: false, logs: [] },
            { env: false, dist: false, logs: ['auth-stand-in.log', 'compose-ps.txt', 'compose.log', 'deploy-1.log'] },
            { env: false, dist: false, logs: ['compose-ps.txt', 'compose.log'] },
        ], 'stack.env and the front build removed every time; logs only after a failure, and only this run\'s');
    });

    it('the usage names every subcommand; an unknown one exits 2', () => {
        const { status, out, calls } = runStack(['nope']);
        assert.equal(status, 2);
        assert.match(out, /^Usage: bash scripts\/ci\/stack\.sh preflight \[e2e\]\|install-env\|pull\|deploy <n>\|mcp-db\|health\|auth\|build-front\|browser\|test\|logs <dir>\|down\|rehearsal\|e2e$/m);
        assert.deepEqual(calls, []);
        const cases = [...stackCode.matchAll(/^ {2}([a-z0-9-]+)\) cmd_/gm)].map((m) => m[1]);
        assert.deepEqual(cases, ['preflight', 'install-env', 'pull', 'deploy', 'mcp-db', 'health', 'auth', 'build-front', 'browser', 'test', 'logs', 'down', 'rehearsal', 'e2e']);
        for (const sub of cases) assert.match(stackScript, new RegExp(`^#   (\\S+ \\| )?${sub}\\b`, 'm'), `the header documents ${sub}`);
    });
});

describe('deploy/risepath-vm/ci (dummy values only)', () => {
    /** @type {Map<string, string>} */
    const values = new Map();
    for (const line of template.split('\n')) {
        const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
        if (m) values.set(m[1], m[2]);
    }

    it('stack.ci.env: marker first, the exact key set, production switches, deletion on, AI off, gate off, no billing, project risepath-ci', () => {
        assert.ok(template.split('\n')[0].startsWith(`${MARKER} CI only.`));
        for (const line of template.split('\n')) assert.match(line, /^(#.*|[A-Z][A-Z0-9_]*=.*|)$/, `a comment or KEY=value: ${line}`);
        // Every KEY=value line, exactly and in order (the header says so): a changed value is a reviewed change here.
        assert.deepEqual(template.split('\n').filter((line) => /^[A-Z]/.test(line)), [
            'COMPOSE_PROJECT_NAME=risepath-ci',
            'COMPOSE_PROFILES=',
            'POSTGRES_USER=risepath_app',
            'POSTGRES_PASSWORD=ci-dummy-db-password',
            'POSTGRES_DB=risepath',
            'DATABASE_URL_PHASE1=postgresql://risepath_app:ci-dummy-db-password@db:5432/risepath',
            'NODE_ENV=production',
            'VITE_DEMO_MODE=false',
            'SUPABASE_URL=http://auth-stand-in:54390',
            'SUPABASE_SERVICE_ROLE_KEY=ci-dummy-service-role-key',
            'RISE_PATH_BRIDGE_TOKEN=ci-dummy-bridge-token',
            'ANTHROPIC_API_KEY=',
            'GEMINI_API_KEY=',
            'ORIGIN_SECRET=',
            'LLM_ALLOWED_ORIGINS=',
            'MEMANTO_ENABLED=false',
            'MEMANTO_SECRET_KEY=',
            'ACCOUNT_DELETION_ENABLED=true',
        ]);
        assert.match(template, /^# server\/tests\/ciScripts\.test\.js pins every KEY=value line exactly/m, 'the header claims no more than this test checks');
        // Why those values: the reasons below stay true when a value changes on purpose.
        assert.equal(values.get('DATABASE_URL_PHASE1'), `postgresql://${values.get('POSTGRES_USER')}:${values.get('POSTGRES_PASSWORD')}@db:5432/${values.get('POSTGRES_DB')}`, 'the db service with the template\'s own role');
        assert.match(values.get('SUPABASE_URL') ?? '', /^http:\/\/[a-z-]+:\d+$/, 'a name on the stack\'s network, nothing outside it');
        // AI off (no LLM_PROVIDER, mock or task route; LLM_ALLOWED_ORIGINS is the empty origin list), no billing, no edge.
        assert.doesNotMatch(template, /^(LLM_(?!ALLOWED_ORIGINS=$)|STRIPE_|BILLING_|OPENROUTER_|GEMINI_ALLOWED|TRUST_PROXY|HERMES_|TUNNEL_)/m);
        for (const [key, value] of values) {
            if (SECRET_KEY.test(key) && value) assert.ok(isPlaceholder(value), `${key}: scan-secrets must see a dummy`);
            if (value) assert.doesNotMatch(value, /change-me|your-project/i, `${key}: deploy-stack.sh would refuse a template value`);
        }
    });

    it('the template is not git-ignored, and holds the only CI env file there', () => {
        assert.deepEqual(fs.readdirSync(path.join(ROOT, 'deploy/risepath-vm/ci')), ['stack.ci.env']);
        const check = spawnSync('git', ['check-ignore', '-q', TEMPLATE], { cwd: ROOT });
        if (check.error || check.status === 128) return; // not a git checkout
        assert.equal(check.status, 1, `${TEMPLATE} must not be git-ignored (deploy/risepath-vm/.gitignore lists stack.env at any depth)`);
    });
});

describe('scripts/ci/redact-log.mjs', () => {
    it('redact masks the values of secret-named keys, JWTs, Bearer tokens and URL passwords, and keeps names a reader needs', () => {
        const secrets = secretValues(path.join(ROOT, TEMPLATE));
        assert.deepEqual(secrets.sort(), ['ci-dummy-bridge-token', 'ci-dummy-db-password', 'ci-dummy-service-role-key',
            'postgresql://risepath_app:ci-dummy-db-password@db:5432/risepath', '', '', '', ''].sort(), 'the secret-named keys of the template, empty ones included');
        const text = [
            'risepath-ci-api-1  | DATABASE_URL_PHASE1=postgresql://risepath_app:ci-dummy-db-password@db:5432/risepath',
            'risepath-ci-db-1   | FATAL: password authentication failed for user "risepath_app" database "risepath"',
            'risepath-ci-api-1  | - Environment: production',
            'bridge ci-dummy-bridge-token, service ci-dummy-service-role-key',
            'Authorization: Bearer sb-access.token_value',
            'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl',
            'other postgres://someone:hunter22@elsewhere:5432/db',
        ].join('\n');
        const out = redact(text, secrets);
        for (const secret of ['ci-dummy', 'hunter22', 'sb-access', 'eyJ']) assert.ok(!out.includes(secret), `${secret} masked:\n${out}`);
        assert.match(out, /DATABASE_URL_PHASE1=<value>\n/);
        assert.match(out, /bridge <value>, service <value>/);
        assert.match(out, /Bearer <token>/);
        assert.match(out, /jwt <jwt>/);
        assert.match(out, /postgres:\/\/someone:<password>@elsewhere/);
        for (const kept of ['risepath-ci-api-1', 'risepath-ci-db-1', '- Environment: production', 'database "risepath"', 'user "risepath_app"']) {
            assert.ok(out.includes(kept), `${kept} stays readable`);
        }
        assert.equal(redact('NODE_ENV=production risepath', ['risepath', 'abc']), 'NODE_ENV=production <value>', 'values of 4+ characters only');
    });

    it('the command line redacts stdin with the env files given, also through a symlinked checkout; importing it runs nothing', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-redact-'));
        try {
            fs.symlinkSync(ROOT, path.join(dir, 'link'));
            for (const script of [path.join(ROOT, 'scripts/ci/redact-log.mjs'), path.join(dir, 'link/scripts/ci/redact-log.mjs')]) {
                const run = spawnSync(process.execPath, [script, '--env', path.join(ROOT, TEMPLATE)], { input: `x ci-dummy-db-password y\nBearer abc\n`, encoding: 'utf8', timeout: 20_000 });
                assert.equal(run.status, 0, run.stderr);
                assert.equal(run.stdout, 'x <value> y\nBearer <token>\n', script);
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/ci/redact-log.mjs'); console.log('ok')"], { cwd: ROOT, input: 'stdin', encoding: 'utf8', timeout: 20_000 });
        assert.equal(imported.status, 0, imported.stderr);
        assert.equal(imported.stdout, 'ok\n');
    });
});

describe('package.json (Phase 7 local runner)', () => {
    it('ci:db, ci:stack, e2e and e2e:local are exact; the runner is the installed playwright package (no @playwright/test)', (t) => {
        const pkg = JSON.parse(read('package.json'));
        assert.equal(pkg.scripts['ci:db'], 'bash scripts/ci/db-checks.sh');
        assert.equal(pkg.scripts['ci:stack'], 'bash scripts/ci/stack.sh rehearsal');
        assert.equal(pkg.scripts.e2e, 'playwright test');
        assert.equal(pkg.scripts['e2e:local'], 'bash scripts/ci/stack.sh e2e');
        for (const field of ['dependencies', 'devDependencies']) {
            assert.equal(pkg[field]?.['@playwright/test'], undefined, `${field}: no @playwright/test (the runner is playwright/test, owner rule: no new dependency)`);
        }
        assert.ok(pkg.devDependencies?.playwright ?? pkg.dependencies?.playwright, 'playwright is the installed package');
        const installed = path.join(ROOT, 'node_modules/playwright/package.json');
        if (!fs.existsSync(installed)) return t.skip('node_modules is not installed');
        assert.ok(JSON.parse(fs.readFileSync(installed, 'utf8')).exports?.['./test'], 'node_modules/playwright exports ./test');
    });
});
