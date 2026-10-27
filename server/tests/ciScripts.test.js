// @ts-check
// The Phase 7 CI scripts (doc/brushup-2026/ai-access-plan.ja.md): scripts/ci/db-checks.sh, the job
// "Database checks" of .github/workflows/e2e.yml and `npm run ci:db`, and the 00:00 JST guard
// (scripts/ci/jst-midnight-guard.mjs). The checks themselves need Docker and PostgreSQL 16 (the job
// runs them); here the script's text is pinned, and the parts that must stop before any psql or docker
// call, or that pick the image, run against recording stubs. No test waits on a real network call.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JST_OFFSET_S, secondsToJstMidnight, waitPastJstMidnight } from '../../scripts/ci/jst-midnight-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} file */
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const DB_CHECKS = 'scripts/ci/db-checks.sh';
const script = read(DB_CHECKS);
/** The script without its comment lines, so a word in a comment never satisfies a check. */
const code = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
/** The same without the text of echo messages: only what the script runs. */
const commands = code.split('\n').map((line) => line.replace(/\becho "[\s\S]*$/, 'echo')).join('\n');
const IMAGE_RE = /pgvector\/pgvector:[^@\s]+@sha256:[0-9a-f]{64}/g;
const IMAGE = (script.match(IMAGE_RE) ?? [])[0] ?? '';
const DIGEST = IMAGE.slice(IMAGE.indexOf('@') + 1);

/** `timeout` (coreutils) runs the docker-mode stub runs; a Mac without coreutils skips them. */
const HAS_TIMEOUT = spawnSync('timeout', ['5', 'true']).status === 0;

/**
 * Runs db-checks.sh with recording stubs for docker, psql and node first on PATH. docker fails
 * `container inspect` (no such container) unless `containerExists`, every `pull` whose image is in
 * `failPull`, and with 125 each subcommand in `dockerFails` ('create', 'start'). psql prints
 * `psql (PostgreSQL) <psqlVersion>` (default 16.15) for --version, `roles` (default 0) for the count of
 * the role risepath_mcp_remote, `databases` (if given) for the count of a database name, and
 * `psqlAnswer` (default nothing) otherwise. Without `nodeFails`, node exits 1, so the script stops at
 * the 00:00 JST guard (set -e), after the image, the server checks and the PG* variables were used;
 * with it, node exits 1 only for the scripts listed, and the script runs to its end. `sleep` only
 * records its argument. `outFiles` lists what the script left in its outputs folder.
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, failPull?: (image: string) => boolean, psqlAnswer?: string, nodeFails?: string[],
 *   psqlVersion?: string, roles?: string, databases?: string, dockerFails?: string[], containerExists?: boolean }} [options]
 */
function runStubbed(args, { env = {}, failPull = () => false, psqlAnswer, nodeFails, psqlVersion = '16.15', roles = '0', databases, dockerFails = [], containerExists = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-db-checks-'));
    try {
        const bin = path.join(dir, 'bin');
        fs.mkdirSync(bin);
        const log = path.join(dir, 'calls.log');
        const failing = path.join(dir, 'fail-pull.txt');
        const write = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
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
        const pulls = [IMAGE, `mirror.gcr.io/pgvector/pgvector@${DIGEST}`].filter((image) => failPull(image));
        fs.writeFileSync(failing, pulls.map((image) => `${image}\n`).join(''));
        fs.writeFileSync(log, '');
        const result = spawnSync('bash', [path.join(ROOT, DB_CHECKS), ...args], {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 60_000,
            env: {
                PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
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

    it('runs verify-account-deletion, verify-phase5 and verify-phase6 in migration order, never with --allow-skip, after the 00:00 JST guard and before the role SQL', () => {
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
            at(/^status=0; role_sql > /m),
        ];
        assert.deepEqual(order, [...order].sort((a, b) => a - b), 'guard, 018, 019, 020, then the role SQL (the verify scripts refuse while the role exists)');
        assert.equal(code.match(/^run_verify /gm)?.length, 3);
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
        assert.match(code, /if \[\[ "\$\{attempt\}" -eq 3 \|\| \$\(\(pull_end - SECONDS\)\) -le "\$\{pause\}" \]\]; then\n[^\n]*re-run the job later"\n\s+exit 1$/m, 'no pause past the deadline');
        const step = dbStepTimeout();
        assert.ok(Number.isInteger(step), 'the Database checks step that runs db-checks.sh has timeout-minutes');
        // The guard waits at most budget + 5 s. The step outlasts every bound plus a minute for the rest
        // (createdb, db-migrate, the role SQL: seconds), so a hang ends with the script's own message, and
        // the step's timeout (a failed step, which keeps the outputs) comes before the job's (a cancel).
        const bounded = 3 * verify + guard + 5 + boot + pulls;
        assert.ok(bounded + 60 <= 60 * step, `3 × ${verify} + ${guard + 5} + ${boot} + ${pulls} = ${bounded} s, plus 60 s, must fit in the step's ${step} min`);
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
        const never = ['learning_days', 'lesson_progress_lesson_resets', 'lesson_progress_resets', 'review_log', 'xp_awards'];
        for (const table of never) assert.doesNotMatch(role, new RegExp(`^GRANT SELECT[^;]* ON ${table} `, 'm'), `${table} is never readable`);
        assert.match(code, new RegExp(`^expect_eq "never granted" "\\$\\(psql "\\$\\{REMOTE\\}" -X -At -c "SELECT string_agg\\(t \\|\\| '=' \\|\\| has_table_privilege\\(t, 'SELECT'\\), ' ' ORDER BY t\\) FROM unnest\\(ARRAY\\[${never.map((t) => `'${t}'`).join(', ')}\\]\\) AS t"\\)" \\\\\n {2}"${never.map((t) => `${t}=false`).join(' ')}"$`, 'm'));
        assert.match(code, /^expect_eq "the role logs in with its password" "\$\(psql "\$\{REMOTE\}" -X -At -c 'SELECT current_user'\)" risepath_mcp_remote$/m);
        assert.match(code, /^REMOTE="postgresql:\/\/risepath_mcp_remote:\$\{ROLE_PASSWORD\}@\$\{HOSTPORT\}\/risepath"$/m);
        assert.match(code, /^if \[\[ -z "\$\{EXISTING\}" \]\]; then\n {2}if psql "postgresql:\/\/risepath_mcp_remote:ci-dummy-wrong-password-0+@\$\{HOSTPORT\}\/risepath" -X -At -c 'SELECT 1' > \/dev\/null 2>&1; then\n {4}bad "a wrong password logged in"\n {2}else\n {4}ok /m);
        assert.match(code, /^if psql "\$\{REMOTE\}" -X -At -c 'SELECT count\(\*\) FROM xp_awards' > \/dev\/null 2>&1; then bad "the role read xp_awards"; else ok /m);
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
            "FAIL never granted: got '0', want 'learning_days=false lesson_progress_lesson_resets=false lesson_progress_resets=false review_log=false xp_awards=false'",
            'FAIL a wrong password logged in',
            'FAIL the role read xp_awards',
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

describe('package.json (Phase 7 local runner)', () => {
    it('ci:db runs scripts/ci/db-checks.sh', () => {
        const pkg = JSON.parse(read('package.json'));
        assert.equal(pkg.scripts['ci:db'], 'bash scripts/ci/db-checks.sh');
    });
});
