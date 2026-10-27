// @ts-check
// .github/workflows/e2e.yml (Phase 7, doc/brushup-2026/ai-access-plan.ja.md; owner decisions
// P1-P5): text checks with node:fs only (no YAML dependency, as vmStackConfig.test.js). The job names
// are the required checks of main's branch rule, so they are pinned. GitHub rejects the whole file
// when an expression uses a context its key does not allow (a job-level env cannot read runner.*), and
// then no job of any trigger starts: the narrow rule below pins that class. A job timeout ends as a
// cancel, which skips the failure() steps, so every step has its own timeout and the job's covers them all.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = '.github/workflows/e2e.yml';
const text = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');

/** The check names main's branch rule lists (P5), with each job's runner (design §0.3 #8). */
const JOBS = {
    db: { name: 'Database checks', runsOn: 'ubuntu-24.04' },
    stack: { name: 'Server stack deploy', runsOn: 'ubuntu-26.04' },
    e2e: { name: 'Learner end-to-end', runsOn: 'ubuntu-26.04' },
};
const ACTIONS = ['actions/checkout@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4'];

/** @typedef {{ line: number, path: string[], text: string, value: string }} Entry */

/**
 * Each non-blank, non-comment line with its key path by indentation (2 spaces; sequence items are
 * numbered, e.g. jobs/db/steps/#3/env/RISEPATH_CI_OUT). The lines of a block scalar (`run: |`)
 * get the path of their key. The file has no anchors and no flow mappings.
 * @param {string} source @returns {Entry[]}
 */
function keyPaths(source) {
    /** @type {Entry[]} */
    const out = [];
    /** @type {{ indent: number, key: string }[]} */
    const stack = [];
    /** @type {Map<string, number>} */
    const items = new Map();
    let scalarIndent = -1;
    for (const [i, raw] of source.split('\n').entries()) {
        const indent = raw.length - raw.trimStart().length;
        const trimmed = raw.trim();
        if (scalarIndent >= 0) {
            if (!trimmed) continue;
            if (indent > scalarIndent) {
                out.push({ line: i + 1, path: stack.map((s) => s.key), text: trimmed, value: trimmed });
                continue;
            }
            scalarIndent = -1;
        }
        if (!trimmed || trimmed.startsWith('#')) continue;
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        let rest = trimmed;
        let keyIndent = indent;
        if (rest === '-' || rest.startsWith('- ')) {
            const parent = stack.map((s) => s.key).join('/');
            const n = (items.get(parent) ?? -1) + 1;
            items.set(parent, n);
            stack.push({ indent, key: `#${n}` });
            rest = rest.slice(1).trimStart();
            keyIndent = indent + 2;
            if (!rest) continue;
        }
        const m = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(rest);
        if (m) {
            const value = (m[2] ?? '').trim();
            out.push({ line: i + 1, path: [...stack.map((s) => s.key), m[1]], text: rest, value });
            stack.push({ indent: keyIndent, key: m[1] });
            if (/^[|>][-+]?$/.test(value)) scalarIndent = keyIndent;
        } else {
            out.push({ line: i + 1, path: stack.map((s) => s.key), text: rest, value: rest });
        }
    }
    return out;
}

const entries = keyPaths(text);
/** @param {string} key */
const at = (key) => entries.filter((e) => e.path.join('/') === key);
/** @param {string} key */
const valueOf = (key) => at(key)[0]?.value.replace(/^'(.*)'$/, '$1');
const jobIds = [...new Set(entries.filter((e) => e.path[0] === 'jobs' && e.path.length >= 2).map((e) => e.path[1]))];

/**
 * The steps of one job, in order.
 * @param {string} job
 * @returns {{ id: string, name?: string, if?: string, timeout?: string, run?: string, uses?: string, with: Record<string, string>, env: Record<string, string> }[]}
 */
function steps(job) {
    const ids = [...new Set(entries.filter((e) => e.path[0] === 'jobs' && e.path[1] === job && e.path[2] === 'steps' && /^#\d+$/.test(e.path[3] ?? ''))
        .map((e) => e.path[3]))];
    return ids.map((id) => {
        const base = `jobs/${job}/steps/${id}`;
        /** @param {string} key @returns {Record<string, string>} */
        const map = (key) => Object.fromEntries(entries.filter((x) => x.path.join('/').startsWith(`${base}/${key}/`) && x.path.length === 6)
            .map((e) => [e.path[5], e.value]));
        return {
            id,
            name: valueOf(`${base}/name`),
            if: valueOf(`${base}/if`),
            timeout: valueOf(`${base}/timeout-minutes`),
            run: valueOf(`${base}/run`),
            uses: valueOf(`${base}/uses`),
            with: map('with'),
            env: map('env'),
        };
    });
}

/**
 * The subcommands `scripts/ci/stack.sh <fn>` runs, in order: the `cmd_*` lines (one per line, two-space
 * indent) of `cmd_<fn>() { … }`, with _ as - and the argument kept (`cmd_deploy 1` → `deploy 1`).
 * @param {string} fn
 */
function stackOrder(fn) {
    const body = /^cmd_([a-z_]+)\(\) \{[^\n]*\n([\s\S]*?)^\}$/gm;
    for (const m of fs.readFileSync(path.join(ROOT, 'scripts/ci/stack.sh'), 'utf8').matchAll(body)) {
        if (m[1] !== fn) continue;
        return [...m[2].matchAll(/^ {2}cmd_([a-z_]+)( [^\n;|&]+)?$/gm)].map((c) => `${c[1].replaceAll('_', '-')}${c[2] ?? ''}`);
    }
    return [];
}

describe('e2e.yml: triggers, permissions and jobs (Phase 7, P2 and P5)', () => {
    it('keyPaths numbers steps, keeps block-scalar lines under their key and skips comments', () => {
        const sample = 'on:\n  push:\n    branches: [main]\n# c\njobs:\n  a:\n    steps:\n      - uses: x\n        with:\n          k: v\n      - run: |\n          echo b: c\n';
        const paths = keyPaths(sample).map((e) => e.path.join('/'));
        assert.deepEqual(paths, ['on', 'on/push', 'on/push/branches', 'jobs', 'jobs/a', 'jobs/a/steps', 'jobs/a/steps/#0/uses',
            'jobs/a/steps/#0/with', 'jobs/a/steps/#0/with/k', 'jobs/a/steps/#1/run', 'jobs/a/steps/#1/run']);
    });

    it('runs on every pull request, on pushes to main, nightly away from 00:00 JST, and by hand (P2); never pull_request_target', () => {
        const on = entries.filter((e) => e.path[0] === 'on');
        assert.deepEqual(at('on/pull_request').map((e) => e.value), [''], 'pull_request with nothing under it');
        assert.equal(on.filter((e) => e.path[1] === 'pull_request' && e.path.length > 2).length, 0, 'no paths or branches filter: a required check must report on every pull request');
        assert.equal(valueOf('on/push/branches'), '[main]');
        assert.equal(on.filter((e) => e.path[1] === 'push' && e.path.length > 2).length, 1, 'push: branches only');
        const crons = entries.filter((e) => e.path.join('/').match(/^on\/schedule\/#\d+\/cron$/)).map((e) => e.value.replace(/^'(.*)'$/, '$1'));
        assert.equal(crons.length, 1, 'one nightly run');
        const [minute, hour] = crons[0].split(/\s+/);
        assert.match(minute, /^\d+$/);
        assert.match(hour, /^\d+$/, 'one fixed UTC hour');
        assert.ok(![14, 15].includes(Number(hour)), `the nightly run at ${hour}:${minute} UTC is near 00:00 JST (15:00 UTC), when learning days change`);
        assert.deepEqual(at('on/workflow_dispatch').map((e) => e.value), ['']);
        assert.doesNotMatch(text, /pull_request_target/, 'fork code must never run with a write token or secrets');
    });

    it('is read-only and uses no secrets, so fork pull requests run it', () => {
        assert.deepEqual(entries.filter((e) => e.path[0] === 'permissions').map((e) => e.path.join('/') + ' ' + e.value),
            ['permissions ', 'permissions/contents read']);
        assert.equal(entries.filter((e) => e.path[0] === 'jobs' && e.path[2] === 'permissions').length, 0, 'no job-level permissions');
        assert.doesNotMatch(text, /secrets\./);
        assert.doesNotMatch(text, /:\s*write\b/);
    });

    it('each job present is one the branch rule lists, by these names (P5); db on ubuntu-24.04 (psql 16), the stack jobs on ubuntu-26.04 (the VM\'s Docker and Compose majors)', () => {
        // Phase 7 adds db (stage 1) and stack (stage 2); the e2e job comes with its own stage.
        assert.ok(jobIds.includes('db'), 'the Database checks job');
        assert.ok(jobIds.includes('stack'), 'the Server stack deploy job');
        for (const id of jobIds) {
            const want = JOBS[/** @type {keyof typeof JOBS} */ (id)];
            assert.ok(want, `job ${id} is not one of ${Object.keys(JOBS).join(', ')}: the branch rule would not list it`);
            assert.equal(valueOf(`jobs/${id}/name`), want.name, `job ${id}: the check name is the required check's`);
            assert.equal(valueOf(`jobs/${id}/runs-on`), want.runsOn, `job ${id}: runner`);
        }
        assert.doesNotMatch(text, /^\s*(strategy|matrix):/m, 'a matrix appends values to the check name');
    });

    it('job-level env holds literals only, and runner.* appears only under a step\'s env or with', () => {
        for (const id of jobIds) {
            const env = entries.filter((e) => e.path[0] === 'jobs' && e.path[1] === id && e.path[2] === 'env' && e.path.length === 4);
            for (const e of env) {
                assert.doesNotMatch(e.text, /\$\{\{/, `${WORKFLOW}:${e.line}: an expression in jobs.${id}.env`);
                assert.equal(`${e.path[3]}: ${e.value}`, 'COMPOSE_PROJECT_NAME: risepath-ci', `${WORKFLOW}:${e.line}: jobs.${id}.env`);
            }
        }
        const runner = entries.filter((e) => /\$\{\{\s*!?\s*runner\./.test(e.text));
        assert.ok(runner.length > 0, 'the outputs folder is under runner.temp');
        for (const e of runner) {
            assert.match(e.path.join('/'), /^jobs\/[^/]+\/steps\/#\d+\/(env|with)\//, `${WORKFLOW}:${e.line}: runner.* in ${e.path.join('/')}`);
        }
    });

    it('every step has its own timeout, and each job\'s is at least the sum of its steps\' plus 2 minutes, so a hang fails a step and the failure() steps still run', () => {
        for (const id of jobIds) {
            const job = Number(valueOf(`jobs/${id}/timeout-minutes`));
            assert.ok(Number.isInteger(job) && job > 0, `job ${id} has timeout-minutes`);
            const list = steps(id);
            assert.ok(list.length > 0);
            for (const step of list) {
                const t = Number(step.timeout);
                assert.ok(Number.isInteger(t) && t > 0, `job ${id}, step ${step.name ?? step.uses ?? step.id}: no timeout-minutes`);
                assert.ok(t < job, `job ${id}, step ${step.name ?? step.uses}: ${t} min is not below the job's ${job}`);
            }
            // Worst case: every step before the failure() steps uses its whole limit, then they run too.
            // The 2 minutes are for the job's set-up and the actions' post steps, which have no limit of their own.
            const sum = list.reduce((total, s) => total + Number(s.timeout), 0);
            assert.ok(job >= sum + 2, `job ${id}: ${job} min, its steps' limits add up to ${sum}: a job timeout would cancel the failure() steps`);
        }
    });

    it('uses only checkout, setup-node and upload-artifact (P4); uploads only on failure, named per attempt, kept 7 days at most, from the folder the checks write', () => {
        const uses = entries.filter((e) => e.path.at(-1) === 'uses').map((e) => e.value);
        assert.ok(uses.length > 0);
        for (const u of uses) assert.ok(ACTIONS.includes(u), `${u} is not allowed (P4: no buildx, cache or third-party action)`);
        for (const id of jobIds) {
            const checkouts = steps(id).filter((step) => step.uses === 'actions/checkout@v4');
            assert.equal(checkouts.length, 1, `${id}: one checkout`);
            // No token left in .git/config: the stack job builds images with the whole checkout as the context.
            for (const step of checkouts) assert.equal(step.with['persist-credentials'], 'false', `${id}: checkout with persist-credentials: false`);
            for (const step of steps(id)) {
                if (step.uses === 'actions/upload-artifact@v4') {
                    assert.equal(step.if, 'failure()', `${id}: ${step.name} uploads only when the job failed (P4)`);
                    assert.ok(Number(step.with['retention-days']) <= 7 && Number(step.with['retention-days']) > 0, `${id}: ${step.name} retention`);
                    assert.match(step.with.name ?? '', /-\$\{\{ github\.run_attempt \}\}$/, `${id}: ${step.name}: a re-run needs a new artifact name`);
                }
                if (/stack\.sh logs\b/.test(step.run ?? '')) assert.equal(step.if, 'failure()', `${id}: ${step.name}`);
            }
        }
        // if-no-files-found: ignore would hide an upload path that drifted from the folder the checks write.
        const db = steps('db');
        const checks = db.filter((s) => s.run === 'bash scripts/ci/db-checks.sh');
        assert.equal(checks.length, 1, 'jobs.db runs db-checks.sh once');
        assert.match(checks[0].env.RISEPATH_CI_OUT ?? '', /^\$\{\{ runner\.temp \}\}\/\S+$/, 'db-checks.sh writes under runner.temp');
        assert.deepEqual(db.filter((s) => s.uses === 'actions/upload-artifact@v4').map((s) => s.with.path), [checks[0].env.RISEPATH_CI_OUT],
            'jobs.db keeps exactly the folder db-checks.sh writes (its RISEPATH_CI_OUT)');
        const stack = steps('stack');
        const logs = stack.filter((s) => /^bash scripts\/ci\/stack\.sh logs /.test(s.run ?? ''));
        assert.deepEqual(logs.map((s) => s.run), ['bash scripts/ci/stack.sh logs "$RUNNER_TEMP/stack-artifacts"'], 'jobs.stack collects the logs once, under the runner\'s temp folder');
        assert.deepEqual(stack.filter((s) => s.uses === 'actions/upload-artifact@v4').map((s) => s.with.path), ['${{ runner.temp }}/stack-artifacts'],
            'jobs.stack keeps exactly the folder its logs step writes ($RUNNER_TEMP is runner.temp)');
        assert.ok(stack.findIndex((s) => s.uses === 'actions/upload-artifact@v4') > stack.indexOf(logs[0]), 'the upload comes after the logs step');
    });

    it('the stack job runs scripts/ci/stack.sh subcommands only, in the order of npm run ci:stack, and always removes the stack last', () => {
        const list = steps('stack');
        assert.deepEqual(list.slice(0, 2).map((s) => s.uses), ['actions/checkout@v4', 'actions/setup-node@v4'], 'checkout and setup first');
        const subcommand = (/** @type {{ run?: string }} */ s) => /^bash scripts\/ci\/stack\.sh ([a-z-]+(?: \S+)?)$/.exec(s.run ?? '')?.[1];
        for (const step of list.slice(2)) {
            if (step.uses) {
                assert.equal(step.uses, 'actions/upload-artifact@v4', step.name);
                continue;
            }
            if (step.name === 'Disk use') {
                assert.equal(step.run, 'df -h / && docker system df');
                assert.equal(step.if, 'always()');
                continue;
            }
            assert.ok(subcommand(step), `${step.name}: every other step is one stack.sh subcommand (${step.run})`);
        }
        const order = stackOrder('rehearsal');
        assert.deepEqual(order, ['preflight', 'install-env', 'pull', 'deploy 1', 'mcp-db', 'health']);
        assert.deepEqual(list.filter((s) => !s.if && s.run).map(subcommand), order, 'the steps without if: are `npm run ci:stack`, in its order');
        for (const step of list.filter((s) => /^logs\b/.test(subcommand(s) ?? ''))) assert.equal(step.if, 'failure()', step.name);
        const last = list.at(-1);
        assert.equal(subcommand(last ?? {}), 'down', 'the last step removes the stack');
        assert.equal(last?.if, 'always()', 'also after a failed or timed-out step, and after a cancel');
        assert.equal(list.filter((s) => subcommand(s) === 'down').length, 1);
        for (const line of entries.filter((e) => e.path.join('/').startsWith('jobs/stack/steps/') && e.path.includes('run'))) {
            assert.doesNotMatch(line.value, /deploy-stack\.sh|docker compose/, `${WORKFLOW}:${line.line}: compose and the deploy run only through stack.sh`);
        }
    });

    it('the deploy step runs the real deploy-stack.sh with the pull opt-out (P3), in the risepath-ci project', () => {
        assert.deepEqual(steps('stack').filter((s) => /\bdeploy\b/.test(s.run ?? '')).map((s) => s.run), ['bash scripts/ci/stack.sh deploy 1']);
        assert.equal(valueOf('jobs/stack/env/COMPOSE_PROJECT_NAME'), 'risepath-ci');
        const stack = fs.readFileSync(path.join(ROOT, 'scripts/ci/stack.sh'), 'utf8');
        const body = /^cmd_deploy\(\) \{[^\n]*\n([\s\S]*?)^\}$/m.exec(stack)?.[1];
        assert.equal(body?.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n'), [
            "  ours \"${STACK}/stack.env\" || fail 'deploy/risepath-vm/stack.env is not the CI template: run install-env first'",
            '  refuse_foreign_env',
            '  mkdir -p "${LOG_DIR}"',
            '  RISEPATH_DEPLOY_SKIP_PULL=1 bash "${STACK}/scripts/deploy-stack.sh" 2>&1 | tee "${LOG_DIR}/deploy-$1.log"',
            '',
        ].join('\n'), 'only the installed template and no foreign env file reach deploy-stack.sh, with the opt-out');
        assert.doesNotMatch(text, /RISEPATH_DEPLOY_SKIP_PULL/, 'only stack.sh sets the opt-out; the workflow never does');
    });

    it('concurrency per event and ref; only pull requests cancel a running run; bash -eo pipefail by default; no continue-on-error', () => {
        assert.match(valueOf('concurrency/group') ?? '', /github\.event_name/, 'a nightly run must not replace a pending push run on main (GitHub keeps one pending run per group)');
        assert.equal(valueOf('concurrency/cancel-in-progress'), "${{ github.event_name == 'pull_request' }}");
        assert.equal(valueOf('defaults/run/shell'), 'bash', 'named bash runs with -eo pipefail');
        assert.doesNotMatch(text, /continue-on-error/);
    });

    it('no legal-pages flag, no key or model name, no local or runner-home path, no --existing-url', () => {
        assert.doesNotMatch(text, /VITE_FEATURE_LEGAL_PAGES/);
        assert.doesNotMatch(text, /(ANTHROPIC|GEMINI|OPENAI|STRIPE)_[A-Z_]*:/);
        assert.doesNotMatch(text, /claude-(opus|sonnet|haiku)/);
        assert.doesNotMatch(text, /\/home\/|\/tmp\/|\/Users\//);
        assert.doesNotMatch(text, /--existing-url/, 'CI runs the VM\'s image, never a cluster of its own');
    });
});
