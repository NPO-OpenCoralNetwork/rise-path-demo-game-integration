// The staff script for study time (scripts/training-time.mjs) on the in-memory database of
// server/tests/helpers/trainingTimePool.js:
// - nothing happens unless TRAINING_ENABLED is exactly "true" (stdin is not even read);
// - usage errors send nothing; the files come over stdin (refused when nothing is piped);
// - a rules file's values never reach the output: errors name fields, results print sha256 only;
// - each refusal has its message and exit code 2; a busy lock exits 3 and the other learners close.
// The values are artificial, not the school's (training-plan D9).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { EXIT, STDIN_LIMIT, STDIN_WAIT_MS, hms, parseArgs, readStdinFrom, run } from '../../scripts/training-time.mjs';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { loadCatalog, loadRules } from '../../tools/core/trainingTime.js';
import { createTrainingTimePool } from './helpers/trainingTimePool.js';

const S = 1000;
const A = 'aaaaaaaa-2323-4000-8000-0000000000a1';
const B = 'aaaaaaaa-2323-4000-8000-0000000000b2';
const COHORT = 'c2300000-0000-4000-8000-000000000001';
const SLUG = 'web-2026-11';
const ON = { TRAINING_ENABLED: 'true' };
// Artificial values, each a distinctive number, so the output can be searched for them.
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7_301, minSpacingMs: 3_119, maxPlaces: 3 },
    counting: { gapMs: 23_417, creditCapMs: 13_229, idleMs: 101_533, requireFocus: false, overlap: 'drop_conflicts' },
});
const VALUES = ['7301', '3119', '23417', '13229', '101533', 'drop_conflicts', '7,301', '23,417'];
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));

const freshPool = (clock = Date.parse('2026-11-04T03:00:00Z')) => createTrainingTimePool({
    clock,
    stubs: [A, B],
    cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
    memberships: [{ user_id: A, cohort_id: COHORT, added_at: Date.parse('2026-10-31T01:00:00Z') }, { user_id: B, cohort_id: COHORT, added_at: Date.parse('2026-10-31T02:00:00Z') }],
});

/** @param {string[]} argv @param {{ pool?: any, env?: Record<string, string>, stdin?: string | null }} [options] */
async function runWith(argv, { pool = freshPool(), env = ON, stdin = null } = {}) {
    const lines = [];
    let reads = 0;
    const code = await run(argv, {
        getPool: () => pool,
        env,
        log: (line) => lines.push(line),
        readStdin: async () => {
            reads += 1;
            return stdin;
        },
        now: () => pool?.state?.clock ?? Date.now(),
    });
    return { code, out: lines.join('\n'), pool, reads };
}

/** A pool with the sample unit list and the rules loaded, and their sha256. */
async function loaded() {
    const pool = freshPool();
    const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'a', note: 'b', pool }));
    const rules = /** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'a', note: 'b', pool }));
    return { pool, catalog, rules };
}

describe('scripts/training-time.mjs: the switch and the arguments', () => {
    it('refuses everything unless TRAINING_ENABLED is exactly "true" (exit 2), before any statement or reading stdin', async () => {
        for (const env of [{}, { TRAINING_ENABLED: '' }, { TRAINING_ENABLED: 'TRUE' }, { TRAINING_ENABLED: '1' }]) {
            for (const argv of [['--load-rules', '--by', 'a', '--note', 'b'], ['--close', SLUG], ['--stats', SLUG]]) {
                const { code, out, pool, reads } = await runWith(argv, { env, stdin: JSON.stringify(RULES_IN) });
                assert.equal(code, EXIT.refused, JSON.stringify(env));
                assert.match(out, /TRAINING_ENABLED is not "true"/);
                assert.deepEqual([pool.queries.length, reads], [0, 0]);
            }
        }
    });

    it('usage errors (exit 1) send nothing', async () => {
        const sha = 'a'.repeat(64);
        for (const argv of [
            [], ['--bogus'], ['--show'], ['--show', SLUG, '--stats', SLUG], ['--load-catalog'], ['--load-catalog', '--by', 'a'], ['--load-rules', '--note', 'b'],
            ['--load-catalog', 'file.json', '--by', 'a', '--note', 'b'], ['--show', SLUG, '--by', 'a'], ['--stats', SLUG, '--learner', A],
            ['--set', SLUG, '--catalog', sha, '--rules', sha, '--from', '2026-11-05', '--by', 'a'], ['--show', 'Bad Slug'], ['--close', SLUG, '--learner', 'nope'],
            ['--show', SLUG, '--learner', A, '--learner', B], ['--set', SLUG, '--catalog', 'ABC', '--rules', sha, '--from', '2026-11-05', '--by', 'a', '--reason', 'r'],
            ['--set', SLUG, '--catalog', sha, '--rules', sha, '--from', '2026-02-30', '--by', 'a', '--reason', 'r'],
        ]) {
            const { code, pool, reads } = await runWith(argv, { stdin: '{}' });
            assert.equal(code, EXIT.usage, argv.join(' '));
            assert.deepEqual([pool.queries.length, reads], [0, 0], argv.join(' '));
        }
        assert.equal(parseArgs(['--help']).help, true);
        assert.equal((await runWith(['--help'])).code, EXIT.ok);
        assert.deepEqual([hms(0), hms(59_999), hms(3_600_000 + 61_000)], ['0:00:00', '0:00:59', '1:01:01']);
    });
});

describe('scripts/training-time.mjs: loading', () => {
    it('--load-catalog: loads once (sha256 and version), again it is the same version; nothing piped is a usage error; not JSON, too large or invalid is refused', async () => {
        const pool = freshPool();
        const first = await runWith(['--load-catalog', '--by', 'staff-a', '--note', 'sample'], { pool, stdin: JSON.stringify(COURSE) });
        assert.equal(first.code, EXIT.ok);
        assert.match(first.out, /^Loaded the unit list sample-course \(2 unit\(s\)\) as version 1, sha256 [0-9a-f]{64}\.$/);
        const again = await runWith(['--load-catalog', '--by', 'staff-b', '--note', 'again'], { pool, stdin: `\n${JSON.stringify(COURSE, null, 2)}\n` });
        assert.match(again.out, /^Already loaded: the unit list sample-course \(2 unit\(s\)\) is version 1, sha256 [0-9a-f]{64}\. Nothing changed\.$/);
        const none = await runWith(['--load-catalog', '--by', 'a', '--note', 'b'], { pool, stdin: null });
        assert.equal(none.code, EXIT.usage);
        assert.match(none.out, /pipe the file to stdin/);
        assert.equal((await runWith(['--load-catalog', '--by', 'a', '--note', 'b'], { pool, stdin: '{ not json' })).code, EXIT.refused);
        assert.equal((await runWith(['--load-catalog', '--by', 'a', '--note', 'b'], { pool, stdin: ' '.repeat(STDIN_LIMIT + 1) })).code, EXIT.refused);
        const invalid = await runWith(['--load-catalog', '--by', 'a', '--note', 'b'], { pool, stdin: JSON.stringify({ ...COURSE, units: [] }) });
        assert.deepEqual([invalid.code, invalid.out], [EXIT.refused, 'Refused: the unit list is not valid (units). Nothing was loaded.']);
        assert.equal(pool.state.catalogs.length, 1);
    });

    it('stdin: a piped file is read whole; nothing within the wait (under `exec -T` a forgotten file is a pipe from the terminal, not a TTY) or a TTY is "nothing piped"; reading stops just past the limit', async () => {
        assert.equal(STDIN_WAIT_MS, 5000);
        const piped = new PassThrough();
        piped.end(JSON.stringify(COURSE));
        assert.deepEqual(JSON.parse(String(await readStdinFrom(piped, { waitMs: 50 }))), COURSE);
        const silent = new PassThrough();
        const t0 = Date.now();
        assert.equal(await readStdinFrom(silent, { waitMs: 50 }), null);
        assert.ok(Date.now() - t0 < 2000, 'it does not wait for the terminal');
        assert.equal(silent.destroyed, true, 'the terminal pipe is let go, so the script can exit');
        const empty = new PassThrough();
        empty.end();
        assert.equal(await readStdinFrom(empty, { waitMs: 50 }), '', 'an empty pipe (< /dev/null) is read as empty: "not JSON"');
        const tty = Object.assign(new PassThrough(), { isTTY: true });
        assert.equal(await readStdinFrom(tty, { waitMs: 50 }), null);
        const big = new PassThrough();
        big.write('x'.repeat(STDIN_LIMIT));
        big.write('y'.repeat(10));
        const text = String(await readStdinFrom(big, { waitMs: 50 }));
        assert.ok(text.length > STDIN_LIMIT && text.length <= STDIN_LIMIT + 10, 'past the limit, then it stops: the caller refuses');
        assert.equal(big.destroyed, true);
        // The script's message when nothing arrived.
        const { code, out } = await runWith(['--load-catalog', '--by', 'a', '--note', 'b'], { stdin: null });
        assert.deepEqual([code, out], [EXIT.usage, 'Refused: pipe the file to stdin (sudo cat <file> | docker compose … exec -T api node scripts/training-time.mjs …); nothing arrived within 5 s.']);
    });

    it('--load-rules: the output never carries a value, whether the file is loaded, loaded again or refused', async () => {
        const pool = freshPool();
        const outputs = [];
        for (const stdin of [JSON.stringify(RULES_IN), JSON.stringify(RULES_IN), JSON.stringify({ ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 99_000 } })]) {
            outputs.push(await runWith(['--load-rules', '--by', 'a', '--note', 'b'], { pool, stdin }));
        }
        assert.deepEqual(outputs.map((o) => o.code), [EXIT.ok, EXIT.ok, EXIT.refused]);
        assert.match(outputs[0].out, /^Loaded the rules \(study-time\/v1\) as version 1, sha256 [0-9a-f]{64}\.$/);
        assert.match(outputs[1].out, /^Already loaded: the rules \(study-time\/v1\) is version 1/);
        assert.equal(outputs[2].out, 'Refused: the rules file is not valid (counting.creditCapMs > counting.gapMs). Nothing was loaded.');
        for (const { out } of outputs) for (const value of [...VALUES, '99000']) assert.ok(!out.includes(value), `${value} is not printed`);
    });
});

describe('scripts/training-time.mjs: settings, show, close, stats', () => {
    it('--set: from a day; each refusal has its message (exit 2); --show lists the settings by sha256, never a value', async () => {
        const { pool, catalog, rules } = await loaded();
        const set = (from, extra = []) => runWith(['--set', SLUG, '--catalog', catalog.sha256, '--rules', rules.sha256, '--from', from, '--by', 'staff-a', '--reason', 'approved for the cohort', ...extra], { pool });
        const ok = await set('2026-11-04');
        assert.equal(ok.code, EXIT.ok);
        assert.equal(ok.out, `Cohort ${SLUG} uses unit list ${catalog.sha256.slice(0, 12)}… and rules ${rules.sha256.slice(0, 12)}… from 2026-11-04 (setting 3).`);
        const refusals = [await set('2026-11-04'), await set('2026-11-03'), await set('2026-12-01')];
        assert.deepEqual(refusals.map((r) => r.code), [EXIT.refused, EXIT.refused, EXIT.refused]);
        assert.deepEqual(refusals.map((r) => r.out), [
            'Refused: a setting is already in effect today (2026-11-04); a new one starts tomorrow at the earliest.',
            'Refused: 2026-11-03 is before today (2026-11-04, Japan time).',
            'Refused: 2026-12-01 is after the cohort\'s last day.',
        ]);
        const unknown = await runWith(['--set', SLUG, '--catalog', 'f'.repeat(64), '--rules', rules.sha256, '--from', '2026-11-05', '--by', 'a', '--reason', 'r'], { pool });
        assert.deepEqual([unknown.code, unknown.out], [EXIT.refused, 'Refused: no unit list has that sha256 (--load-catalog first).']);
        assert.equal((await set('2026-11-06')).code, EXIT.ok);
        const show = await runWith(['--show', SLUG], { pool });
        assert.equal(show.code, EXIT.ok);
        const lines = show.out.split('\n');
        assert.equal(lines[0], `${SLUG} (${COHORT}): Web, 2026-11-01 … 2026-11-30, 2 setting(s)`);
        assert.match(lines[1], new RegExp(`^  from 2026-11-04 \\(in effect today\\): unit list sample-course \\(2 unit\\(s\\)\\) ${catalog.sha256}, rules study-time/v1 ${rules.sha256}; set 2026-11-04T03:00:00\\.000Z by staff-a: approved for the cohort$`));
        assert.match(lines[2], /^ {2}from 2026-11-06: /);
        for (const value of VALUES) assert.ok(!show.out.includes(value), value);
        const empty = await runWith(['--show', 'nope'], { pool });
        assert.deepEqual([empty.code, empty.out], [EXIT.refused, 'Refused: there is no cohort nope.']);
        // Once there is evidence, another course than the one in effect today is refused.
        pool.addSignal({ userId: A, cohortId: COHORT, unit: 'sample-u1', chain: 'cccccccc-0000-4000-8000-000000000009', born: pool.state.clock, seq: 0, at: pool.state.clock, input: true });
        const other = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, courseKey: 'other-course' }, loadedBy: 'a', note: 'b', pool }));
        const switched = await runWith(['--set', SLUG, '--catalog', other.sha256, '--rules', rules.sha256, '--from', '2026-11-08', '--by', 'a', '--reason', 'r'], { pool });
        assert.deepEqual([switched.code, switched.out], [EXIT.refused, `Refused: ${SLUG} already has study time under the course sample-course; a new setting keeps that course.`]);
    });

    it('--close: every live learner of the cohort, each in its own transaction; --show --learner the closed days and units; --stats the counts', async () => {
        const { pool, catalog, rules } = await loaded();
        pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom: '2026-11-01' });
        const from = Date.parse('2026-11-02T01:00:00Z');
        for (let seq = 0; seq < 12; seq += 1) pool.addSignal({ userId: A, cohortId: COHORT, unit: 'sample-u1', chain: 'cccccccc-0000-4000-8000-000000000001', born: from, seq, at: from + seq * 7 * S, input: true });
        const closed = await runWith(['--close', SLUG], { pool });
        assert.equal(closed.code, EXIT.ok);
        assert.deepEqual(closed.out.split('\n'), [
            `${A}: closed 3 day(s), 2026-11-01 … 2026-11-03`,
            `${B}: closed 3 day(s), 2026-11-01 … 2026-11-03`,
            `${SLUG}: 2 learner(s), 6 day(s) closed.`,
        ]);
        assert.equal(pool.tx().filter((s) => s === 'BEGIN').length, 2, 'one transaction per learner');
        assert.ok(pool.state.days.every((d) => d.computed_by === 'staff'));
        const again = await runWith(['--close', SLUG, '--learner', A.toUpperCase()], { pool });
        assert.deepEqual([again.code, again.out.split('\n')[0]], [EXIT.ok, `${A}: nothing to close (nothing_final)`]);
        const shown = await runWith(['--show', SLUG, '--learner', A], { pool });
        assert.deepEqual(shown.out.split('\n'), [
            `${A} in ${SLUG}: 3 closed day(s), through 2026-11-03`,
            '  2026-11-01    0:00:00  over the set time 0:00:00  signals 0',
            `  2026-11-02    0:01:17  over the set time 0:00:00  signals 12`,
            '  2026-11-03    0:00:00  over the set time 0:00:00  signals 0',
            '  unit sample-u1: 0:01:17 counted, 0:00:00 over the set time',
        ]);
        const stats = await runWith(['--stats', SLUG], { pool });
        assert.equal(stats.out, `${SLUG}: learners 2; streams 1 (0 of deleted accounts); signals 12; day rows 6 (0 of deleted accounts); closed through 2026-11-03`);
    });

    it('--close: a busy lock (55P03) for one learner exits 3 and the others still close; a version that no longer parses exits 2', async () => {
        const { pool, catalog, rules } = await loaded();
        pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom: '2026-11-01' });
        let first = true;
        const busy = Object.assign(new Error('canceling statement due to lock timeout (host db.internal)'), { code: '55P03' });
        const query = pool.connect;
        pool.connect = async () => {
            const client = await query();
            if (!first) return client;
            first = false;
            return { ...client, query: async (sql, params) => (sql === TRAINING_SQL.learnerLock ? Promise.reject(busy) : client.query(sql, params)) };
        };
        const result = await runWith(['--close', SLUG], { pool });
        assert.equal(result.code, EXIT.unavailable);
        assert.deepEqual(result.out.split('\n'), [
            `${A}: not closed.`,
            'Unavailable: a lock was busy for 10 s (an account deletion or a close may be running). Try again.',
            `${B}: closed 3 day(s), 2026-11-01 … 2026-11-03`,
            `${SLUG}: 2 learner(s), 3 day(s) closed.`,
        ]);
        assert.doesNotMatch(result.out, /db\.internal/);
        pool.state.rules[0].params.counting.gapMs = 1;
        const broken = await runWith(['--close', SLUG, '--learner', A], { pool });
        assert.equal(broken.code, EXIT.refused);
        assert.match(broken.out, /a stored rules or unit list version does not parse with this code/);
        assert.equal((await runWith(['--stats', SLUG], { pool: null })).code, EXIT.unavailable);
    });
});
