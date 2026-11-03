// The staff script for study time (scripts/training-time.mjs) on the in-memory database of
// server/tests/helpers/trainingTimePool.js:
// - nothing happens unless TRAINING_ENABLED is exactly "true" (stdin is not even read);
// - usage errors send nothing; the files come over stdin (refused when nothing is piped);
// - a rules file's values never reach the output: errors name fields, results print sha256 only;
// - each refusal has its message and exit code 2; a busy lock exits 3 and the other learners close;
// - --verify prints ok or each difference (exit 4), never a rule value, and writes nothing;
// - --recompute: the dry run prints each changed day before and after (each difference is the
//   printed after minus the printed before) and the plan's sha256, and writes nothing; --expect
//   writes that plan only; each refusal has its message and exit code (4: closed days that do not
//   check); a lock busy for every try exits 3 with the tries' waits injected; no rule value, and no
//   instant in a dry run or a refusal;
// - --show lists the recounts, and a learner's days with their earlier rows and the recount that
//   wrote each, never a row's time.
// The values are artificial, not the school's (training-plan D9).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { EXIT, STDIN_LIMIT, STDIN_WAIT_MS, USAGE, hms, parseArgs, readStdinFrom, run, signed, unitLines } from '../../scripts/training-time.mjs';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { TRAINING_TIME_SQL, loadCatalog, loadRules } from '../../tools/core/trainingTime.js';
import { CHECK_SQL, LOCK_RETRY } from '../../tools/core/trainingTimeCheck.js';
import { RECOUNT_LOCKS } from '../../tools/core/trainingTimeRecount.js';
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
// A recount's rules: a pair counts up to 5.303 s and breaks after 29.683 s (RULES_IN: 13.229 s, 23.417 s).
const RULES_2 = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7_301, minSpacingMs: 3_119, maxPlaces: 3 },
    counting: { gapMs: 29_683, creditCapMs: 5_303, idleMs: 97_651, requireFocus: false, overlap: 'prefer_focus_latest' },
});
const VALUES = ['7301', '3119', '23417', '13229', '101533', 'drop_conflicts', '7,301', '23,417', '29683', '5303', '97651', 'prefer_focus_latest', '29,683', '5,303', '97,651'];
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));
/** An instant as an output would print it (toISOString). */
const ISO_TIME = /\d{4}-\d\d-\d\dT\d\d:\d\d/;

/**
 * No rule value in an output: none of VALUES (or `more`) once every run of 12 to 64 hex digits (a
 * sha256, or the first 12 digits of one) is masked, so a sha256 never matches a value.
 * @param {string} out @param {string[]} [more]
 */
function noRuleValue(out, more = []) {
    const masked = out.replace(/[0-9a-f]{12,64}/g, '#');
    for (const value of [...VALUES, ...more]) assert.ok(!masked.includes(value), `${value} is not printed`);
}

const freshPool = (clock = Date.parse('2026-11-04T03:00:00Z')) => createTrainingTimePool({
    clock,
    stubs: [A, B],
    cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
    memberships: [{ user_id: A, cohort_id: COHORT, added_at: Date.parse('2026-10-31T01:00:00Z') }, { user_id: B, cohort_id: COHORT, added_at: Date.parse('2026-10-31T02:00:00Z') }],
});

/**
 * The script with the in-memory pool; the waits between lock tries are recorded, not waited.
 * @param {string[]} argv @param {{ pool?: any, env?: Record<string, string>, stdin?: string | null }} [options]
 */
async function runWith(argv, { pool = freshPool(), env = ON, stdin = null } = {}) {
    const lines = [];
    /** @type {number[]} */
    const sleeps = [];
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
        sleep: async (ms) => {
            sleeps.push(ms);
        },
    });
    return { code, out: lines.join('\n'), pool, reads, sleeps };
}

const REASON = 'the provider confirmed new rules';
/** --recompute's arguments, without --dry-run or --expect. */
const recompute = ({ slug = SLUG, from = '2026-11-01', to = '2026-11-02', rules = '', catalog = '', by = 'staff-a', reason = REASON } = {}) => [
    '--recompute', slug, '--from', from, '--to', to,
    ...(rules ? ['--rules', rules] : []), ...(catalog ? ['--catalog', catalog] : []),
    '--by', by, '--reason', reason,
];
/** The plan's sha256 a dry run printed. @param {string} out */
const planSha = (out) => String(/^Plan sha256 ([0-9a-f]{64})\./m.exec(out)?.[1]);

/** A pool with the sample unit list and the rules loaded, and their sha256. */
async function loaded() {
    const pool = freshPool();
    const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'a', note: 'b', pool }));
    const rules = /** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'a', note: 'b', pool }));
    return { pool, catalog, rules };
}

/**
 * A cohort closed through 11-03 by --close under RULES_IN (from 11-01), with RULES_2 loaded. Each
 * day's study is one chain at 10:00 JST with an input on every signal, its pairs as listed:
 * - A, sample-u2 (30 minutes): 11-01 eleven pairs of 7 s: 77 s (RULES_2 credits 5.303 s of each:
 *   58.333 s); 11-02 nine of 5.303 s, one of 1.767 s, one of 9.906 s and one of 25 s, a break under
 *   RULES_IN: 59.4 s (RULES_2: 60.1 s);
 * - B, sample-u1 (2 minutes): 11-01 as A's; 11-03 the same 77 s, of which 43 s fit under the set time
 *   after 11-01 (34 s over; after 11-01's 58.333 s, 61.667 s fit and 15.333 s are over).
 */
async function recountable() {
    const { pool, catalog, rules } = await loaded();
    const rules2 = /** @type {any} */ (await loadRules({ input: RULES_2, loadedBy: 'a', note: 'b', pool }));
    pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom: '2026-11-01' });
    let chain = 10;
    const study = (/** @type {string} */ userId, /** @type {string} */ unit, /** @type {string} */ day, /** @type {number[]} */ pairs) => {
        chain += 1;
        const id = `cccccccc-0000-4000-8000-${String(chain).padStart(12, '0')}`;
        const born = Date.parse(`${day}T01:00:00Z`);
        let at = born;
        pool.addSignal({ userId, cohortId: COHORT, unit, chain: id, born, seq: 0, at, input: true });
        pairs.forEach((ms, i) => {
            at += ms;
            pool.addSignal({ userId, cohortId: COHORT, unit, chain: id, born, seq: i + 1, at, input: true });
        });
    };
    study(A, 'sample-u2', '2026-11-01', Array(11).fill(7 * S));
    study(A, 'sample-u2', '2026-11-02', [...Array(9).fill(5_303), 1_767, 9_906, 25 * S]);
    study(B, 'sample-u1', '2026-11-01', Array(11).fill(7 * S));
    study(B, 'sample-u1', '2026-11-03', Array(11).fill(7 * S));
    assert.equal((await runWith(['--close', SLUG], { pool })).code, EXIT.ok);
    return { pool, catalog, rules, rules2 };
}

/**
 * Every "h:mm:ss → h:mm:ss (±h:mm:ss)" of an output: the difference is the printed after minus the
 * printed before, "±" only when they are the same. Returns how many there are.
 * @param {string} out
 */
function differencesMatch(out) {
    const seconds = (/** @type {string} */ t) => t.split(':').reduce((n, part) => n * 60 + Number(part), 0);
    const found = [...out.matchAll(/(\d+:\d\d:\d\d) → (\d+:\d\d:\d\d) \(([+±-])(\d+:\d\d:\d\d)\)/g)];
    for (const [text, before, after, sign, difference] of found) {
        const printed = seconds(after) - seconds(before);
        assert.equal(sign === '-' ? -seconds(difference) : seconds(difference), printed, text);
        assert.equal(sign === '±', printed === 0, text);
    }
    return found.length;
}

describe('scripts/training-time.mjs: the switch and the arguments', () => {
    it('refuses everything unless TRAINING_ENABLED is exactly "true" (exit 2), before any statement or reading stdin', async () => {
        for (const env of [{}, { TRAINING_ENABLED: '' }, { TRAINING_ENABLED: 'TRUE' }, { TRAINING_ENABLED: '1' }]) {
            for (const argv of [
                ['--load-rules', '--by', 'a', '--note', 'b'], ['--close', SLUG], ['--stats', SLUG], ['--verify', SLUG],
                [...recompute({ rules: 'a'.repeat(64) }), '--dry-run'], [...recompute({ rules: 'a'.repeat(64) }), '--expect', 'b'.repeat(64)],
            ]) {
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
            ['--verify'], ['--verify', SLUG, '--by', 'a'], ['--verify', SLUG, '--learner', 'nope'], ['--verify', SLUG, '--stats', SLUG],
        ]) {
            const { code, pool, reads } = await runWith(argv, { stdin: '{}' });
            assert.equal(code, EXIT.usage, argv.join(' '));
            assert.deepEqual([pool.queries.length, reads], [0, 0], argv.join(' '));
        }
        assert.equal(parseArgs(['--help']).help, true);
        assert.equal((await runWith(['--help'])).code, EXIT.ok);
        assert.deepEqual([hms(0), hms(59_999), hms(3_600_000 + 61_000)], ['0:00:00', '0:00:59', '1:01:01']);
        // A difference is of the whole seconds hms prints: 1:17 → 0:58 is 19 s (the values differ by
        // 18.667 s), 0:59 → 1:00 is 1 s (0.2 s), 0:59 → 0:59 nothing (0.8 s).
        assert.deepEqual([signed(77_000, 58_333), signed(59_900, 60_100), signed(59_100, 59_900), signed(0, 0), signed(1_000, 3_601_999)],
            ['-0:00:19', '+0:00:01', '±0:00:00', '±0:00:00', '+1:00:00']);
        // A changed day's unit lines show a change when a unit's counted time or its time over the set
        // time prints differently (either column, any unit), not when each prints the same.
        assert.deepEqual([
            unitLines([['u1', 60_000, 30_000]], [['u1', 60_000, 0]]).shown,
            unitLines([['u1', 60_000, 0]], [['u1', 30_000, 0]]).shown,
            unitLines([['u1', 1_000, 0], ['u2', 60_400, 0]], [['u1', 2_000, 0], ['u2', 60_000, 400]]).shown,
            unitLines([['u1', 60_400, 0]], [['u1', 60_000, 400]]).shown,
            unitLines([], [['u1', 900, 0]]).shown,
        ], [true, true, true, false, false]);
        assert.deepEqual(unitLines([['u2', 1_000, 0]], [['u1', 2_000, 0]]).lines,
            ['    unit u1: 0:00:00 → 0:00:02 counted, 0:00:00 → 0:00:00 over the set time', '    unit u2: 0:00:01 → 0:00:00 counted, 0:00:00 → 0:00:00 over the set time']);
    });

    it('--recompute: exactly one of --dry-run or --expect, --rules or --catalog or both; --to, --expect, --dry-run and --learner only where they go; then the core\'s checks of the input; each exit 1 before any statement, stdin not read', async () => {
        const sha = 'a'.repeat(64);
        const argv = recompute({ rules: sha });
        for (const [args, message] of [
            [[...argv, '--dry-run', '--expect', sha], '--recompute needs exactly one of --dry-run or --expect'],
            [argv, '--recompute needs exactly one of --dry-run or --expect'],
            [[...argv, '--dry-run', 'yes'], 'unknown argument yes'],
            [[...argv, '--dry-run', '--dry-run'], '--dry-run is given twice'],
            [[...argv, '--expect'], '--expect needs a value'],
            [[...recompute(), '--dry-run'], '--recompute needs --rules, --catalog or both'],
            [['--recompute', SLUG, '--to', '2026-11-02', '--rules', sha, '--by', 'a', '--reason', 'r', '--dry-run'], '--recompute needs --from'],
            [[...argv, '--dry-run', '--learner', A], '--learner does not go with --recompute'],
            [[...argv, '--dry-run', '--note', 'n'], '--note does not go with --recompute'],
            [['--show', SLUG, '--to', '2026-11-02'], '--to does not go with --show'],
            [['--verify', SLUG, '--expect', sha], '--expect does not go with --verify'],
            [['--close', SLUG, '--dry-run'], '--dry-run does not go with --close'],
            [['--load-rules', '--dry-run', '--by', 'a', '--note', 'b'], '--dry-run does not go with --load-rules'],
            [['--set', SLUG, '--catalog', sha, '--rules', sha, '--from', '2026-11-05', '--to', '2026-11-06', '--by', 'a', '--reason', 'r'], '--to does not go with --set'],
            [['--recompute', 'Bad Slug', ...argv.slice(2), '--dry-run'], 'a cohort slug takes a-z, 0-9 and "-" (up to 80, not starting with "-")'],
        ]) {
            const { code, out, pool, reads } = await runWith(/** @type {string[]} */ (args), { stdin: '{}' });
            assert.deepEqual([code, out], [EXIT.usage, `${message}\n${USAGE}`], args.join(' '));
            assert.deepEqual([pool.queries.length, reads], [0, 0], args.join(' '));
        }
        // The core module's checks (tools/core/trainingTimeRecount.js): a day, the days' order, a
        // sha256 in upper case, --by over 100 and --reason over 500 characters (code points, here
        // outside the BMP: 2 UTF-16 units each), --expect not a sha256. Its message, then the usage.
        for (const args of [
            [...recompute({ from: '2026-02-30', rules: sha }), '--dry-run'],
            [...recompute({ from: '2026-11-03', to: '2026-11-02', rules: sha }), '--dry-run'],
            [...recompute({ rules: sha.toUpperCase() }), '--dry-run'],
            [...recompute({ catalog: 'F'.repeat(64) }), '--expect', sha],
            [...recompute({ rules: sha, by: '𝒜'.repeat(101) }), '--dry-run'],
            [...recompute({ rules: sha, reason: '😀'.repeat(501) }), '--dry-run'],
            [...argv, '--expect', 'nope'],
            [...argv, '--expect', sha.toUpperCase()],
        ]) {
            const { code, out, pool, reads } = await runWith(args, { stdin: '{}' });
            const [message, ...usage] = out.split('\n');
            assert.deepEqual([code, usage.join('\n')], [EXIT.usage, USAGE], args.join(' '));
            assert.match(message, /^(Who recounts|The days|The rules and the unit list|The plan) /, args.join(' '));
            assert.deepEqual([pool.queries.length, reads], [0, 0], args.join(' '));
        }
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
        for (const { out } of outputs) noRuleValue(out, ['99000']);
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
        assert.equal(lines[0], `${SLUG} (${COHORT}): Web, 2026-11-01 … 2026-11-30, 2 setting(s), 0 recount(s)`);
        assert.match(lines[1], new RegExp(`^  from 2026-11-04 \\(in effect today\\): unit list sample-course \\(2 unit\\(s\\)\\) ${catalog.sha256}, rules study-time/v1 ${rules.sha256}; set 2026-11-04T03:00:00\\.000Z by staff-a: approved for the cohort$`));
        assert.match(lines[2], /^ {2}from 2026-11-06: /);
        assert.equal(lines.length, 3);
        noRuleValue(show.out);
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

    it('--verify: every learner\'s closed days, ok (exit 0) or each difference (exit 4, never a rule value); one learner; a cohort or learner that is not there is refused', async () => {
        const { pool, catalog, rules } = await loaded();
        pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom: '2026-11-01' });
        const from = Date.parse('2026-11-02T01:00:00Z');
        for (let seq = 0; seq < 12; seq += 1) pool.addSignal({ userId: A, cohortId: COHORT, unit: 'sample-u1', chain: 'cccccccc-0000-4000-8000-000000000001', born: from, seq, at: from + seq * 7 * S, input: true });
        await runWith(['--close', SLUG], { pool });
        const ok = await runWith(['--verify', SLUG], { pool });
        assert.deepEqual([ok.code, ok.out.split('\n')], [EXIT.ok, [
            `${A}: ok (3 day(s))`,
            `${B}: ok (3 day(s))`,
            `Checked ${SLUG}: 2 learner(s), 6 day(s); all match.`,
        ]]);
        assert.ok(pool.state.days.every((d) => d.kind === 'close'), 'nothing written');
        const row = pool.state.days.find((d) => d.user_id === A && d.day === '2026-11-02');
        row.counted_ms += 1000;
        pool.addSignal({ userId: A, cohortId: COHORT, unit: 'sample-u1', chain: 'cccccccc-0000-4000-8000-000000000002', born: from, seq: 0, at: Date.parse('2026-11-03T02:00:00Z'), input: true });
        const differs = await runWith(['--verify', SLUG, '--learner', A.toUpperCase()], { pool });
        assert.equal(differs.code, EXIT.differs);
        assert.deepEqual(differs.out.split('\n'), [
            `${A}: 2 difference(s) in 3 day(s)`,
            '  2026-11-02: the values differ: stored 0:01:18 (over the set time 0:00:00), counted 0:01:17 (over the set time 0:00:00)',
            '  2026-11-03: the evidence differs from when it was counted (signals 0 then, 1 now, or their content)',
            `Checked ${SLUG}: 1 learner(s), 3 day(s); 2 difference(s) in 1 learner(s). Keep this output in the school (learners' ids and times); report privately (SECURITY.md) that --verify found differences, without learner data, and change nothing until they are understood.`,
        ]);
        noRuleValue(differs.out);
        // The day's totals as stored, its time on another unit: the split differs. (Each check ends in a
        // ROLLBACK, which puts back a copy of the state: read the rows again.)
        const again = pool.state.days.find((d) => d.user_id === A && d.day === '2026-11-02');
        again.counted_ms -= 1000;
        pool.state.unitDays.find((u) => u.day_id === again.id).unit_key = 'sample-u2';
        const split = await runWith(['--verify', SLUG, '--learner', A], { pool });
        assert.deepEqual([split.code, split.out.split('\n').slice(0, 2)], [EXIT.differs, [`${A}: 2 difference(s) in 3 day(s)`, "  2026-11-02: the time per unit differs (the day's totals match)"]]);
        // The unit put back. Then a recount row of 11-01 naming a unit list its recount did not use,
        // 11-02's close row naming a unit list that is not its day's setting (K2 differs in a unit not
        // studied: the same values), 11-03 counted with a version this code does not have.
        const day = (/** @type {string} */ d) => pool.state.days.find((r) => r.user_id === A && r.day === d);
        pool.state.unitDays.find((u) => u.day_id === day('2026-11-02').id).unit_key = 'sample-u1';
        const k2 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: COURSE.units.map((/** @type {any} */ u) => (u.key === 'sample-u2' ? { ...u, setMinutes: 31 } : u)) }, loadedBy: 'a', note: 'b', pool }));
        const close01 = day('2026-11-01');
        const recount = pool.addRecount({ cohortId: COHORT, fromDay: '2026-11-01', toDay: '2026-11-01', ruleSetId: rules.id,
            rows: [{ userId: A, day: '2026-11-01', ruleSetId: rules.id, catalogId: k2.id, countedMs: 0, overCapMs: 0, signals: close01.signals, evidenceSha256: close01.evidence_sha256 }] });
        day('2026-11-02').catalog_version_id = k2.id;
        day('2026-11-03').algorithm = 'study-time/v9';
        const kinds = await runWith(['--verify', SLUG, '--learner', A], { pool });
        assert.deepEqual([kinds.code, kinds.out.split('\n').slice(0, 4)], [EXIT.differs, [
            `${A}: 3 difference(s) in 3 day(s)`,
            `  2026-11-01: its versions are not those of its recount ${recount}`,
            "  2026-11-02: its versions are not the cohort's setting of that day",
            "  2026-11-03: counted with study-time/v9, not with its rules' algorithm (study-time/v1)",
        ]]);
        // The rules row naming another algorithm than its rules (every day), then a unit list version
        // this code cannot parse (the two days that name it).
        day('2026-11-03').algorithm = 'study-time/v1';
        pool.state.rules.find((/** @type {any} */ r) => r.id === rules.id).algorithm = 'study-time/v9';
        const rulesRow = await runWith(['--verify', SLUG, '--learner', A], { pool });
        assert.ok(rulesRow.out.split('\n').includes('  2026-11-03: its rules row names study-time/v9, another algorithm than its rules'), rulesRow.out);
        pool.state.rules.find((/** @type {any} */ r) => r.id === rules.id).algorithm = 'study-time/v1';
        pool.state.catalogs.find((/** @type {any} */ k) => k.id === k2.id).manifest.schema = 'risepath.training-course/v9';
        const unparsed = await runWith(['--verify', SLUG, '--learner', A], { pool });
        assert.deepEqual(unparsed.out.split('\n').filter((l) => l.includes('does not parse')),
            ['  2026-11-01: its rules or unit list version does not parse with this code', '  2026-11-02: its rules or unit list version does not parse with this code']);
        pool.state.catalogs.find((/** @type {any} */ k) => k.id === k2.id).manifest.schema = COURSE.schema;
        // A recount of 11-01 with rules of study-time/v2 (the row as newer code would load it), then
        // with v1 rules that do not parse with this code.
        pool.state.rules.push({ id: '900', algorithm: 'study-time/v2', sha256: 'c'.repeat(64), params: { ...structuredClone(RULES_IN), algorithm: 'study-time/v2' }, loaded_by: 'a', note: 'b' });
        const now01 = pool.state.days.filter((/** @type {any} */ r) => r.user_id === A && r.day === '2026-11-01').at(-1);
        pool.addRecount({ cohortId: COHORT, fromDay: '2026-11-01', toDay: '2026-11-01', ruleSetId: '900',
            rows: [{ userId: A, day: '2026-11-01', ruleSetId: '900', catalogId: now01.catalog_version_id, countedMs: 0, overCapMs: 0, signals: now01.signals, evidenceSha256: now01.evidence_sha256 }] });
        const unknown = await runWith(['--verify', SLUG, '--learner', A], { pool });
        assert.ok(unknown.out.split('\n').includes('  2026-11-01: its rules are study-time/v2, which this code cannot count'), unknown.out);
        Object.assign(pool.state.rules.find((/** @type {any} */ r) => r.id === '900'), { algorithm: 'study-time/v1', params: { ...structuredClone(RULES_IN), counting: { ...RULES_IN.counting, gapMs: 1 } } });
        const rulesUnparsed = await runWith(['--verify', SLUG, '--learner', A], { pool });
        assert.ok(rulesUnparsed.out.split('\n').includes('  2026-11-01: its rules or unit list version does not parse with this code'), rulesUnparsed.out);
        const nobody = await runWith(['--verify', SLUG, '--learner', 'aaaaaaaa-2222-4000-8000-0000000000e0'], { pool });
        assert.deepEqual([nobody.code, nobody.out], [EXIT.refused, `Refused: aaaaaaaa-2222-4000-8000-0000000000e0 is not a learner of ${SLUG}.`]);
        const none = await runWith(['--verify', 'nope'], { pool });
        assert.deepEqual([none.code, none.out], [EXIT.refused, 'Refused: there is no cohort nope.']);
        pool.state.rules[0].params.counting.gapMs = 1;
        const broken = await runWith(['--verify', SLUG], { pool });
        assert.deepEqual([broken.code, broken.out], [EXIT.refused, 'Refused: a stored rules or unit list version does not parse with this code. Nothing was changed; ask the developers.']);
        // Any other error is no busy lock: a database without migration 023 (the LOCK names its table)
        // ends at the first try.
        pool.state.rules[0].params.counting.gapMs = RULES_IN.counting.gapMs;
        pool.failOn(CHECK_SQL.lockLearner, Object.assign(new Error('relation "training_time_recomputes" does not exist'), { code: '42P01' }), 1);
        const sent0 = pool.queries.length;
        const missing = await runWith(['--verify', SLUG], { pool });
        assert.deepEqual([missing.code, missing.out, pool.queries.slice(sent0).filter((q) => q.sql === CHECK_SQL.lockLearner).length],
            [EXIT.unavailable, 'Unavailable: the database could not do it (table_not_found). Try again later.', 1]);
        // A migration's DDL holding a table makes the snapshot's LOCK … NOWAIT fail; a REINDEX holding
        // one of their indexes makes its read of no rows wait 20 ms and fail (a learner's, then the
        // cohort's). Each is tried LOCK_RETRY.tries times, then exit 3. failOn keeps every failure, so
        // each comes earlier than the last, and the run stops at it.
        for (const sql of [CHECK_SQL.indexesLearner, CHECK_SQL.lockLearner, CHECK_SQL.indexesCohort, CHECK_SQL.lockCohort]) {
            pool.failOn(sql, Object.assign(new Error('could not obtain lock on relation'), { code: '55P03' }));
            const busy = await runWith(['--verify', SLUG], { pool });
            assert.deepEqual([busy.code, busy.out], [EXIT.unavailable, 'Unavailable: a lock was busy for 10 s (a migration may be running). Try again.'], sql.slice(0, 50));
            assert.deepEqual(pool.tx().slice(-2), [sql, 'ROLLBACK'], `stopped at ${sql.slice(0, 50)}`);
        }
        assert.equal((await runWith(['--verify', SLUG], { pool: null })).code, EXIT.unavailable);
    });
});

describe('scripts/training-time.mjs: recounts (--recompute) and their record (--show)', () => {
    it('--recompute --dry-run: each changed day before and after (the difference of the printed seconds), the totals and the plan\'s sha256, nothing written; --expect writes that plan; then nothing is left to recount; a plan not the one confirmed is refused, no sha256 printed', async () => {
        const { pool, rules, rules2 } = await recountable();
        const argv = recompute({ rules: rules2.sha256 });
        const kept = () => structuredClone({ days: pool.state.days, unitDays: pool.state.unitDays, recounts: pool.state.recounts });
        const before = kept();
        const sent0 = pool.queries.length;
        const dry = await runWith([...argv, '--dry-run'], { pool });
        const sha = planSha(dry.out);
        const [r1, r2] = [`${rules.sha256.slice(0, 12)}…`, `${rules2.sha256.slice(0, 12)}…`];
        const lines = [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-02: rules ${rules2.sha256}, unit list each day's own; by staff-a: ${REASON}`,
            `${A}: 2 day(s)`,
            `  2026-11-01  0:01:17 → 0:00:58 (-0:00:19), over the set time 0:00:00 → 0:00:00; rules ${r1} → ${r2}`,
            '    unit sample-u2: 0:01:17 → 0:00:58 counted, 0:00:00 → 0:00:00 over the set time',
            `  2026-11-02  0:00:59 → 0:01:00 (+0:00:01), over the set time 0:00:00 → 0:00:00; rules ${r1} → ${r2}`,
            '    unit sample-u2: 0:00:59 → 0:01:00 counted, 0:00:00 → 0:00:00 over the set time',
            `${B}: 3 day(s)`,
            `  2026-11-01  0:01:17 → 0:00:58 (-0:00:19), over the set time 0:00:00 → 0:00:00; rules ${r1} → ${r2}`,
            '    unit sample-u1: 0:01:17 → 0:00:58 counted, 0:00:00 → 0:00:00 over the set time',
            // Its versions only (no study that day).
            `  2026-11-02  0:00:00 → 0:00:00 (±0:00:00), over the set time 0:00:00 → 0:00:00; rules ${r1} → ${r2}`,
            // After the range: its own versions, the new carry.
            '  2026-11-03  0:00:43 → 0:01:01 (+0:00:18), over the set time 0:00:34 → 0:00:15',
            '    unit sample-u1: 0:00:43 → 0:01:01 counted, 0:00:34 → 0:00:15 over the set time',
            '2 learner(s), 5 day(s) change: counted 0:04:16 → 0:03:58 (-0:00:18).',
            `Plan sha256 ${sha}. Nothing was written. To write it, run the same command with --expect ${sha} instead of --dry-run.`,
        ];
        assert.deepEqual([dry.code, dry.out.split('\n')], [EXIT.ok, lines]);
        // 77 s → 58.333 s prints -0:00:19 (not the 18.667 s between the values), 59.4 s → 60.1 s +0:00:01
        // (not 0.7 s), and the totals 256.4 s → 238.433 s -0:00:18 (not 17.967 s).
        assert.equal(differencesMatch(dry.out), 6);
        const sent = pool.queries.slice(sent0).map((q) => q.sql);
        assert.ok(!sent.some((q) => /^\s*INSERT/i.test(q) || q === TRAINING_SQL.lock || q === TRAINING_SQL.learnerLock), 'reads only, no advisory lock');
        assert.deepEqual(kept(), before, 'nothing written');
        noRuleValue(dry.out);
        assert.doesNotMatch(dry.out, ISO_TIME);
        // Both overrides: another unit list of the course too (sample-u2 at 31 minutes, nothing over
        // its set time): the same days and values, each overridden day naming both versions.
        const k2 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: COURSE.units.map((/** @type {any} */ u) => (u.key === 'sample-u2' ? { ...u, setMinutes: 31 } : u)) }, loadedBy: 'a', note: 'b', pool }));
        const both = await runWith([...recompute({ rules: rules2.sha256, catalog: k2.sha256 }), '--dry-run'], { pool });
        const [k1Short, k2Short] = [`${String(pool.state.catalogs[0].sha256).slice(0, 12)}…`, `${k2.sha256.slice(0, 12)}…`];
        assert.deepEqual([both.code, both.out.split('\n')], [EXIT.ok, [
            lines[0].replace("unit list each day's own", `unit list ${k2.sha256}`),
            ...lines.slice(1, -1).map((l) => (l.endsWith(`; rules ${r1} → ${r2}`) ? `${l}; unit list ${k1Short} → ${k2Short}` : l)),
            `Plan sha256 ${planSha(both.out)}. Nothing was written. To write it, run the same command with --expect ${planSha(both.out)} instead of --dry-run.`,
        ]]);
        assert.notEqual(planSha(both.out), sha);
        assert.deepEqual(kept(), before, 'nothing written');
        // --by and --reason up to 100 and 500 characters (code points outside the BMP), as the plan binds them.
        const long = await runWith([...recompute({ rules: rules2.sha256, by: '𝒜'.repeat(100), reason: '😀'.repeat(500) }), '--dry-run'], { pool });
        assert.deepEqual([long.code, long.out.split('\n')[0]], [EXIT.ok, `Recount of ${SLUG}, 2026-11-01 … 2026-11-02: rules ${rules2.sha256}, unit list each day's own; by ${'𝒜'.repeat(100)}: ${'😀'.repeat(500)}`]);
        assert.notEqual(planSha(long.out), sha, 'the plan binds who and why');

        const write = await runWith([...argv, '--expect', sha], { pool });
        const recount = pool.state.recounts.at(-1);
        assert.deepEqual([write.code, write.out], [EXIT.ok, `Recounted 5 day(s) of 2 learner(s) in ${SLUG} (recount ${recount.id}, plan ${sha}). The earlier rows stay; the learners see the new values.`]);
        assert.deepEqual(pool.state.recounts.map((r) => [r.from_day, r.to_day, r.rule_set_id, r.catalog_version_id, r.plan_sha256, r.recomputed_by, r.reason]),
            [['2026-11-01', '2026-11-02', rules2.id, null, sha, 'staff-a', REASON]]);
        assert.deepEqual(pool.state.days.map((d) => [d.user_id === A ? 'A' : 'B', d.day, d.kind, d.counted_ms]), [
            ['A', '2026-11-01', 'close', 77_000], ['A', '2026-11-02', 'close', 59_400], ['A', '2026-11-03', 'close', 0],
            ['B', '2026-11-01', 'close', 77_000], ['B', '2026-11-02', 'close', 0], ['B', '2026-11-03', 'close', 43_000],
            ['A', '2026-11-01', 'recompute', 58_333], ['A', '2026-11-02', 'recompute', 60_100],
            ['B', '2026-11-01', 'recompute', 58_333], ['B', '2026-11-02', 'recompute', 0], ['B', '2026-11-03', 'recompute', 61_667],
        ], 'the earlier rows stay');
        assert.doesNotMatch(write.out, ISO_TIME);
        noRuleValue(write.out);
        const verified = await runWith(['--verify', SLUG], { pool });
        assert.deepEqual([verified.code, verified.out.split('\n').at(-1)], [EXIT.ok, `Checked ${SLUG}: 2 learner(s), 6 day(s); all match.`]);

        // The same dry run again: nothing changes (its plan's sha256, without the invitation).
        const again = await runWith([...argv, '--dry-run'], { pool });
        const empty = planSha(again.out);
        assert.deepEqual([again.code, again.out.split('\n')], [EXIT.ok, [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-02: rules ${rules2.sha256}, unit list each day's own; by staff-a: ${REASON}`,
            'No day changes; nothing to write.',
            `Plan sha256 ${empty}.`,
        ]]);
        const unchanged = await runWith([...argv, '--expect', empty], { pool });
        assert.deepEqual([unchanged.code, unchanged.out], [EXIT.ok, `Nothing to recount: no day changes (plan ${empty}). Nothing was written.`]);
        // The first plan again (it was written), or another reason than the dry run's: refused, and
        // no sha256 is printed (the new plan is reviewed with --dry-run).
        for (const args of [[...argv, '--expect', sha], [...recompute({ rules: rules2.sha256, reason: 'another reason' }), '--expect', empty]]) {
            const stale = await runWith(args, { pool });
            assert.deepEqual([stale.code, stale.out], [EXIT.refused, 'Refused: the plan is not the one confirmed: something changed since the dry run, or --from, --to, --rules, --catalog, --by or --reason differ. Nothing was written; run --dry-run again and review it.']);
            assert.doesNotMatch(stale.out, /[0-9a-f]{64}/);
            noRuleValue(stale.out);
        }
        assert.equal(pool.state.recounts.length, 1);
        for (const out of [both.out, long.out, again.out, unchanged.out]) noRuleValue(out);
    });

    it('--recompute refusals: each its message and exit code 2, a day but never an instant, no rule value; closed days that do not check exit 4 with each difference, from the dry run and the write alike', async () => {
        const { pool, rules, rules2 } = await recountable();
        /** @param {string[]} argv @param {string} [last] */
        const refused = async (argv, last = '--dry-run') => {
            const r = await runWith([...argv, ...(last === '--dry-run' ? [last] : ['--expect', last])], { pool });
            noRuleValue(r.out);
            assert.doesNotMatch(r.out, ISO_TIME);
            return [r.code, r.out];
        };
        const rejected = (/** @type {string} */ text) => [EXIT.refused, text];
        assert.deepEqual(await refused(recompute({ slug: 'nope', rules: rules2.sha256 })), rejected('Refused: there is no cohort nope.'));
        pool.state.cohorts.push({ id: 'c2300000-0000-4000-8000-000000000002', slug: 'no-dates', name: 'Undated', starts_on: null, ends_on: null });
        assert.deepEqual(await refused(recompute({ slug: 'no-dates', rules: rules2.sha256 })), rejected('Refused: no-dates has no start and end dates; study time counts nothing in it.'));
        assert.deepEqual(await refused(recompute({ from: '2026-10-31', rules: rules2.sha256 })), rejected(`Refused: 2026-10-31 … 2026-11-02 is not within ${SLUG}'s dates.`));
        assert.deepEqual(await refused(recompute({ rules: 'e'.repeat(64) })), rejected('Refused: no rules have that sha256 (--load-rules first).'));
        assert.deepEqual(await refused(recompute({ catalog: 'e'.repeat(64) })), rejected('Refused: no unit list has that sha256 (--load-catalog first).'));
        // Versions this code cannot count with: rules of an algorithm it does not have (as newer code
        // would load them), a rules row naming another algorithm than its rules, rules that do not
        // parse with this code; a unit list that does not parse with this code.
        pool.state.rules.push(
            { id: '901', algorithm: 'study-time/v2', sha256: '1'.repeat(64), params: { ...structuredClone(RULES_IN), algorithm: 'study-time/v2' }, loaded_by: 'a', note: 'b' },
            { id: '902', algorithm: 'study-time/v9', sha256: '2'.repeat(64), params: structuredClone(RULES_IN), loaded_by: 'a', note: 'b' },
            { id: '903', algorithm: 'study-time/v1', sha256: '3'.repeat(64), params: { ...structuredClone(RULES_IN), counting: { ...RULES_IN.counting, gapMs: 1 } }, loaded_by: 'a', note: 'b' },
        );
        pool.state.catalogs.push({ id: '904', course_key: 'sample-course', sha256: '4'.repeat(64), manifest: { ...structuredClone(COURSE), schema: 'risepath.training-course/v9' }, loaded_by: 'a', note: 'b' });
        assert.deepEqual(await refused(recompute({ rules: '1'.repeat(64) })), rejected('Refused: --rules names a version this code does not have; ask the developers.'));
        assert.deepEqual(await refused(recompute({ rules: '2'.repeat(64) })), rejected('Refused: --rules names a version whose rules row names another algorithm than its rules; ask the developers.'));
        assert.deepEqual(await refused(recompute({ rules: '3'.repeat(64) })), rejected('Refused: --rules names a version that does not parse with this code; ask the developers.'));
        assert.deepEqual(await refused(recompute({ catalog: '4'.repeat(64) })), rejected('Refused: --catalog names a version that does not parse with this code; ask the developers.'));
        // 11-02 ends at 15:00:00Z. 25 s after: final under its setting's rules, not under RULES_2;
        // with --catalog alone its setting's rules decide: 20 s after, not final either. The day only.
        const k2 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: COURSE.units.map((/** @type {any} */ u) => (u.key === 'sample-u2' ? { ...u, setMinutes: 31 } : u)) }, loadedBy: 'a', note: 'b', pool }));
        pool.setClock(Date.parse('2026-11-02T15:00:25Z'));
        assert.deepEqual(await refused(recompute({ rules: rules2.sha256 })), rejected('Refused: 2026-11-02 is not final yet under those rules or its own. Try again later.'));
        pool.setClock(Date.parse('2026-11-02T15:00:20Z'));
        assert.deepEqual(await refused(recompute({ catalog: k2.sha256 })), rejected('Refused: 2026-11-02 is not final yet. Try again later.'));
        pool.setClock(Date.parse('2026-11-04T03:00:00Z'));
        // A stored setting that no longer parses with this code.
        pool.state.rules.find((/** @type {any} */ r) => r.id === rules.id).params.counting.gapMs = 1;
        assert.deepEqual(await refused(recompute({ rules: rules2.sha256 })), rejected('Refused: a stored rules or unit list version does not parse with this code. Nothing was changed; ask the developers.'));
        pool.state.rules.find((/** @type {any} */ r) => r.id === rules.id).params.counting.gapMs = RULES_IN.counting.gapMs;
        // A unit list of another course than a day's own: the first such day of the range.
        const other = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, courseKey: 'other-course' }, loadedBy: 'a', note: 'b', pool }));
        assert.deepEqual(await refused(recompute({ catalog: other.sha256 })), rejected('Refused: the --catalog unit list is of another course than 2026-11-01\'s own; a recount keeps each day\'s course.'));
        // A closed day that does not check: each difference as --verify prints it, exit 4, from the
        // dry run and from the write (whatever its --expect); nothing is written.
        pool.state.days.find((/** @type {any} */ d) => d.user_id === A && d.day === '2026-11-02').counted_ms += 1000;
        const differs = [EXIT.differs, [
            `Refused: 1 learner(s) have closed days that do not check (as --verify ${SLUG} finds them).`,
            `${A}: 1 difference(s)`,
            '  2026-11-02: the values differ: stored 0:01:00 (over the set time 0:00:00), counted 0:00:59 (over the set time 0:00:00)',
            "Keep this output in the school (learners' ids and times); report privately (SECURITY.md) that --recompute found closed days that do not check, without learner data, and recount nothing until they are understood.",
        ].join('\n')];
        assert.deepEqual(await refused(recompute({ rules: rules2.sha256 })), differs);
        assert.deepEqual(await refused(recompute({ rules: rules2.sha256 }), 'f'.repeat(64)), differs);
        pool.state.days.find((/** @type {any} */ d) => d.user_id === A && d.day === '2026-11-02').counted_ms -= 1000;
        // A learner whose days up to --to are not all closed.
        const C = 'aaaaaaaa-2323-4000-8000-0000000000c3';
        pool.state.stubs.push(C);
        pool.state.memberships.push({ user_id: C, cohort_id: COHORT, role: 'learner', added_at: Date.parse('2026-10-31T03:00:00Z'), account_deleted_at: null });
        assert.deepEqual(await refused(recompute({ rules: rules2.sha256 })), rejected(`Refused: 1 learner(s) have days up to 2026-11-02 that are not closed. Run --close ${SLUG} first: ${C}`));
        assert.deepEqual(pool.state.recounts, []);
        assert.equal(pool.state.days.filter((/** @type {any} */ d) => d.kind === 'recompute').length, 0);
        assert.equal((await runWith([...recompute({ rules: rules2.sha256 }), '--dry-run'], { pool: null })).code, EXIT.unavailable);
    });

    it('--recompute: a lock busy for every try exits 3 (the waits between the tries are the script\'s sleep), naming what may hold it: a migration for the dry run, which reads as --verify; for the write also learners\' requests and a deletion', async () => {
        const busy = () => Object.assign(new Error('could not obtain lock on relation (host db.internal)'), { code: '55P03' });
        const first = await recountable();
        first.pool.failOn(RECOUNT_LOCKS.learner[0], busy());
        const dry = await runWith([...recompute({ rules: first.rules2.sha256 }), '--dry-run'], { pool: first.pool });
        assert.deepEqual([dry.code, dry.out], [EXIT.unavailable, 'Unavailable: a lock was busy for 10 s (a migration may be running). Try again.']);
        assert.equal(dry.sleeps.length, LOCK_RETRY.tries - 1);
        assert.deepEqual(first.pool.tx().slice(-2), [RECOUNT_LOCKS.learner[0], 'ROLLBACK']);
        // --show --learner reads the same way.
        first.pool.failOn(RECOUNT_LOCKS.history[0], busy());
        const shown = await runWith(['--show', SLUG, '--learner', A], { pool: first.pool });
        assert.deepEqual([shown.code, shown.out, shown.sleeps.length], [EXIT.unavailable, 'Unavailable: a lock was busy for 10 s (a migration may be running). Try again.', LOCK_RETRY.tries - 1]);

        const second = await recountable();
        const argv = recompute({ rules: second.rules2.sha256 });
        const sha = planSha((await runWith([...argv, '--dry-run'], { pool: second.pool })).out);
        second.pool.failOn(TRAINING_SQL.learnerLock, busy());
        const write = await runWith([...argv, '--expect', sha], { pool: second.pool });
        assert.deepEqual([write.code, write.out], [EXIT.unavailable, "Unavailable: a lock was busy for 10 s (learners' requests, an account deletion or a migration may be running). Try again."]);
        assert.equal(write.sleeps.length, LOCK_RETRY.tries - 1);
        assert.deepEqual(second.pool.state.recounts, [], 'nothing written');
        for (const out of [dry.out, shown.out, write.out]) {
            assert.doesNotMatch(out, /db\.internal/);
            noRuleValue(out);
        }
    });

    it('--show: the recounts after the settings; --show --learner each day\'s current row (the recount that wrote it), its earlier rows with who closed or recounted them, never a row\'s time', async () => {
        const { pool, catalog, rules, rules2 } = await recountable();
        /** A recount through the script: the dry run, then --expect its sha256. @param {Parameters<typeof recompute>[0]} over */
        const recountWith = async (over) => {
            const argv = recompute(over);
            const dry = await runWith([...argv, '--dry-run'], { pool });
            const written = await runWith([...argv, '--expect', planSha(dry.out)], { pool });
            assert.equal(written.code, EXIT.ok, written.out);
            return { dry: dry.out, sha: planSha(dry.out), id: String(pool.state.recounts.at(-1).id) };
        };
        const first = await recountWith({ rules: rules2.sha256 });
        pool.setClock(Date.parse('2026-11-04T05:00:00Z'));
        // 11-01 back to RULES_IN: 11-02 keeps its own (the first recount's) versions and values; B's
        // 11-03 goes back with the carry. 178.333 s → 197 s prints +0:00:19 (not 18.667 s).
        const second = await recountWith({ to: '2026-11-01', rules: rules.sha256, by: 'staff-b', reason: 'back to the first rules' });
        assert.equal(second.dry.split('\n').at(-2), '2 learner(s), 3 day(s) change: counted 0:02:58 → 0:03:17 (+0:00:19).');
        assert.equal(differencesMatch(second.dry), 4);
        const show = await runWith(['--show', SLUG], { pool });
        assert.deepEqual([show.code, show.out.split('\n')], [EXIT.ok, [
            `${SLUG} (${COHORT}): Web, 2026-11-01 … 2026-11-30, 1 setting(s), 2 recount(s)`,
            `  from 2026-11-01 (in effect today): unit list sample-course (2 unit(s)) ${catalog.sha256}, rules study-time/v1 ${rules.sha256}; set 2026-01-01T00:00:00.000Z by test: test`,
            `  recount ${first.id}, 2026-11-01 … 2026-11-02: rules ${rules2.sha256}, unit list each day's own; plan ${first.sha}; 2026-11-04T03:00:00.000Z by staff-a: ${REASON}`,
            `  recount ${second.id}, 2026-11-01 … 2026-11-01: rules ${rules.sha256}, unit list each day's own; plan ${second.sha}; 2026-11-04T05:00:00.000Z by staff-b: back to the first rules`,
        ]]);
        const sent0 = pool.queries.length;
        const a = await runWith(['--show', SLUG, '--learner', A], { pool });
        const sent = pool.queries.slice(sent0).map((q) => q.sql);
        assert.deepEqual([sent.filter((q) => q === CHECK_SQL.learnerRows).length, sent.filter((q) => q === TRAINING_TIME_SQL.currentDays).length], [1, 0], 'one read of the rows');
        assert.deepEqual([a.code, a.out.split('\n')], [EXIT.ok, [
            `${A} in ${SLUG}: 3 closed day(s), through 2026-11-03`,
            `  2026-11-01    0:01:17  over the set time 0:00:00  signals 12  (recount ${second.id})`,
            '    earlier: 0:01:17, over the set time 0:00:00, closed by staff',
            `    earlier: 0:00:58, over the set time 0:00:00, recount ${first.id} by staff-a`,
            `  2026-11-02    0:01:00  over the set time 0:00:00  signals 13  (recount ${first.id})`,
            '    earlier: 0:00:59, over the set time 0:00:00, closed by staff',
            '  2026-11-03    0:00:00  over the set time 0:00:00  signals 0',
            '  unit sample-u2: 0:02:17 counted, 0:00:00 over the set time',
        ]]);
        const b = await runWith(['--show', SLUG, '--learner', B.toUpperCase()], { pool });
        assert.deepEqual([b.code, b.out.split('\n')], [EXIT.ok, [
            `${B} in ${SLUG}: 3 closed day(s), through 2026-11-03`,
            `  2026-11-01    0:01:17  over the set time 0:00:00  signals 12  (recount ${second.id})`,
            '    earlier: 0:01:17, over the set time 0:00:00, closed by staff',
            `    earlier: 0:00:58, over the set time 0:00:00, recount ${first.id} by staff-a`,
            `  2026-11-02    0:00:00  over the set time 0:00:00  signals 0  (recount ${first.id})`,
            '    earlier: 0:00:00, over the set time 0:00:00, closed by staff',
            `  2026-11-03    0:00:43  over the set time 0:00:34  signals 12  (recount ${second.id})`,
            '    earlier: 0:00:43, over the set time 0:00:34, closed by staff',
            `    earlier: 0:01:01, over the set time 0:00:15, recount ${first.id} by staff-a`,
            '  unit sample-u1: 0:02:00 counted, 0:00:34 over the set time',
        ]]);
        for (const out of [a.out, b.out]) assert.doesNotMatch(out, ISO_TIME, 'no row\'s time');
        for (const out of [first.dry, second.dry, show.out, a.out, b.out]) noRuleValue(out);
        const nobody = await runWith(['--show', SLUG, '--learner', 'aaaaaaaa-2323-4000-8000-0000000000e0'], { pool });
        assert.deepEqual([nobody.code, nobody.out], [EXIT.ok, 'aaaaaaaa-2323-4000-8000-0000000000e0 in web-2026-11: 0 closed day(s)']);
    });

    it('--recompute --dry-run: a unit counted on one side only (before, or after); a unit list alone that moves set time between two units (the totals stay, the split changes), on the recounted day and on a later one; values that change although each prints as before are named, with or without a change of versions', async () => {
        const study = (/** @type {any} */ pool, /** @type {string} */ userId, /** @type {string} */ unit, /** @type {number} */ chain, /** @type {number} */ born, /** @type {number[]} */ pairs) => {
            const id = `cccccccc-0000-4000-8000-${String(chain).padStart(12, '0')}`;
            let at = born;
            pool.addSignal({ userId, cohortId: COHORT, unit, chain: id, born, seq: 0, at, input: true });
            pairs.forEach((ms, i) => {
                at += ms;
                pool.addSignal({ userId, cohortId: COHORT, unit, chain: id, born, seq: i + 1, at, input: true });
            });
        };
        const short = (/** @type {string} */ sha) => `${sha.slice(0, 12)}…`;
        // Rules that count only time with focus: the fixture's signals have none, so a unit's time goes
        // to zero (its line keeps the unit, 0:00:00 after).
        const one = await recountable();
        const focus = /** @type {any} */ (await loadRules({ input: { ...RULES_IN, counting: { ...RULES_IN.counting, requireFocus: true } }, loadedBy: 'a', note: 'b', pool: one.pool }));
        const zero = await runWith([...recompute({ to: '2026-11-01', rules: focus.sha256 }), '--dry-run'], { pool: one.pool });
        assert.deepEqual([zero.code, zero.out.split('\n')], [EXIT.ok, [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-01: rules ${focus.sha256}, unit list each day's own; by staff-a: ${REASON}`,
            `${A}: 1 day(s)`,
            `  2026-11-01  0:01:17 → 0:00:00 (-0:01:17), over the set time 0:00:00 → 0:00:00; rules ${short(one.rules.sha256)} → ${short(focus.sha256)}`,
            '    unit sample-u2: 0:01:17 → 0:00:00 counted, 0:00:00 → 0:00:00 over the set time',
            `${B}: 2 day(s)`,
            `  2026-11-01  0:01:17 → 0:00:00 (-0:01:17), over the set time 0:00:00 → 0:00:00; rules ${short(one.rules.sha256)} → ${short(focus.sha256)}`,
            '    unit sample-u1: 0:01:17 → 0:00:00 counted, 0:00:00 → 0:00:00 over the set time',
            '  2026-11-03  0:00:43 → 0:01:17 (+0:00:34), over the set time 0:00:34 → 0:00:00',
            '    unit sample-u1: 0:00:43 → 0:01:17 counted, 0:00:34 → 0:00:00 over the set time',
            '2 learner(s), 3 day(s) change: counted 0:03:17 → 0:01:17 (-0:02:00).',
            `Plan sha256 ${planSha(zero.out)}. Nothing was written. To write it, run the same command with --expect ${planSha(zero.out)} instead of --dry-run.`,
        ]]);
        // Two units of 1 and 2 minutes, each studied 3 minutes on 11-01 (A); another unit list of the
        // course with the set times swapped: 3 minutes counted and 3 over either way, split otherwise.
        const unit = (/** @type {string} */ key, /** @type {number} */ setMinutes) => ({ key, title: { jp: key, en: key }, setMinutes });
        const { pool, rules } = await loaded();
        const xy = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 1), unit('unit-y', 2)] }, loadedBy: 'a', note: 'b', pool }));
        const yx = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 2), unit('unit-y', 1)] }, loadedBy: 'a', note: 'b', pool }));
        pool.addSetting({ cohortId: COHORT, catalogId: xy.id, ruleSetId: rules.id, effectiveFrom: '2026-11-01' });
        study(pool, A, 'unit-x', 31, Date.parse('2026-11-01T01:00:00Z'), Array(30).fill(6 * S));
        study(pool, A, 'unit-y', 32, Date.parse('2026-11-01T02:00:00Z'), Array(30).fill(6 * S));
        assert.equal((await runWith(['--close', SLUG], { pool })).code, EXIT.ok);
        const swapped = await runWith([...recompute({ to: '2026-11-01', catalog: yx.sha256 }), '--dry-run'], { pool });
        const list = `; unit list ${short(xy.sha256)} → ${short(yx.sha256)}`;
        assert.deepEqual([swapped.code, swapped.out.split('\n')], [EXIT.ok, [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-01: rules each day's own, unit list ${yx.sha256}; by staff-a: ${REASON}`,
            `${A}: 1 day(s)`,
            `  2026-11-01  0:03:00 → 0:03:00 (±0:00:00), over the set time 0:03:00 → 0:03:00${list}`,
            '    unit unit-x: 0:01:00 → 0:02:00 counted, 0:02:00 → 0:01:00 over the set time',
            '    unit unit-y: 0:02:00 → 0:01:00 counted, 0:01:00 → 0:02:00 over the set time',
            `${B}: 1 day(s)`,
            `  2026-11-01  0:00:00 → 0:00:00 (±0:00:00), over the set time 0:00:00 → 0:00:00${list}`,
            '2 learner(s), 2 day(s) change: counted 0:03:00 → 0:03:00 (±0:00:00).',
            `Plan sha256 ${planSha(swapped.out)}. Nothing was written. To write it, run the same command with --expect ${planSha(swapped.out)} instead of --dry-run.`,
        ]]);
        // B on 11-01: ten pairs of 6.93 s and one of 7.5 s (76.8 s); rules whose pair counts up to 7 s
        // give 76.3 s. 11-03 (its own rules) then counts 43.7 s and 33.3 s over instead of 43.2 s and
        // 33.8 s: on both days each value prints as before, so each line says its values change by less
        // than a second (11-01 also changes its rules; A's 11-01 changes only its rules, no mark).
        const sub = await loaded();
        const capped = /** @type {any} */ (await loadRules({ input: { ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 7 * S } }, loadedBy: 'a', note: 'b', pool: sub.pool }));
        sub.pool.addSetting({ cohortId: COHORT, catalogId: sub.catalog.id, ruleSetId: sub.rules.id, effectiveFrom: '2026-11-01' });
        study(sub.pool, B, 'sample-u1', 33, Date.parse('2026-11-01T01:00:00Z'), [...Array(10).fill(6_930), 7_500]);
        study(sub.pool, B, 'sample-u1', 34, Date.parse('2026-11-03T01:00:00Z'), Array(11).fill(7 * S));
        assert.equal((await runWith(['--close', SLUG], { pool: sub.pool })).code, EXIT.ok);
        const hidden = await runWith([...recompute({ to: '2026-11-01', rules: capped.sha256 }), '--dry-run'], { pool: sub.pool });
        const versions = `; rules ${short(sub.rules.sha256)} → ${short(capped.sha256)}`;
        assert.deepEqual([hidden.code, hidden.out.split('\n')], [EXIT.ok, [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-01: rules ${capped.sha256}, unit list each day's own; by staff-a: ${REASON}`,
            `${A}: 1 day(s)`,
            `  2026-11-01  0:00:00 → 0:00:00 (±0:00:00), over the set time 0:00:00 → 0:00:00${versions}`,
            `${B}: 2 day(s)`,
            `  2026-11-01  0:01:16 → 0:01:16 (±0:00:00), over the set time 0:00:00 → 0:00:00${versions}; its values change by less than a second`,
            '    unit sample-u1: 0:01:16 → 0:01:16 counted, 0:00:00 → 0:00:00 over the set time',
            '  2026-11-03  0:00:43 → 0:00:43 (±0:00:00), over the set time 0:00:33 → 0:00:33; its values change by less than a second',
            '    unit sample-u1: 0:00:43 → 0:00:43 counted, 0:00:33 → 0:00:33 over the set time',
            '2 learner(s), 3 day(s) change: counted 0:02:00 → 0:02:00 (±0:00:00).',
            `Plan sha256 ${planSha(hidden.out)}. Nothing was written. To write it, run the same command with --expect ${planSha(hidden.out)} instead of --dry-run.`,
        ]]);
        // The mirror of the first case: rules that count only time with focus in the setting (the day
        // closed at 0, no unit row), recounted with rules that count it: the unit appears after.
        const gain = await loaded();
        const focusOnly = /** @type {any} */ (await loadRules({ input: { ...RULES_IN, counting: { ...RULES_IN.counting, requireFocus: true } }, loadedBy: 'a', note: 'b', pool: gain.pool }));
        gain.pool.addSetting({ cohortId: COHORT, catalogId: gain.catalog.id, ruleSetId: focusOnly.id, effectiveFrom: '2026-11-01' });
        study(gain.pool, A, 'sample-u2', 35, Date.parse('2026-11-01T01:00:00Z'), Array(11).fill(7 * S));
        assert.equal((await runWith(['--close', SLUG], { pool: gain.pool })).code, EXIT.ok);
        const gained = await runWith([...recompute({ to: '2026-11-01', rules: gain.rules.sha256 }), '--dry-run'], { pool: gain.pool });
        const counted = `; rules ${short(focusOnly.sha256)} → ${short(gain.rules.sha256)}`;
        assert.deepEqual([gained.code, gained.out.split('\n')], [EXIT.ok, [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-01: rules ${gain.rules.sha256}, unit list each day's own; by staff-a: ${REASON}`,
            `${A}: 1 day(s)`,
            `  2026-11-01  0:00:00 → 0:01:17 (+0:01:17), over the set time 0:00:00 → 0:00:00${counted}`,
            '    unit sample-u2: 0:00:00 → 0:01:17 counted, 0:00:00 → 0:00:00 over the set time',
            `${B}: 1 day(s)`,
            `  2026-11-01  0:00:00 → 0:00:00 (±0:00:00), over the set time 0:00:00 → 0:00:00${counted}`,
            '2 learner(s), 2 day(s) change: counted 0:00:00 → 0:01:17 (+0:01:17).',
            `Plan sha256 ${planSha(gained.out)}. Nothing was written. To write it, run the same command with --expect ${planSha(gained.out)} instead of --dry-run.`,
        ]]);
        // A later day whose totals stay and whose split between units moves by whole seconds: its unit
        // lines show it, so no mark. Unit lists of 1 and 2 minutes from 11-01, three units of 4 minutes
        // from 11-02; A studies unit-x and unit-y 90 s each on 11-01, 240 s each and unit-z 60 s on
        // 11-02; 11-01 recounted with the 1 and 2 minutes swapped moves 30 s of carry between them.
        const split = await loaded();
        const xy2 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 1), unit('unit-y', 2)] }, loadedBy: 'a', note: 'b', pool: split.pool }));
        const yx2 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 2), unit('unit-y', 1)] }, loadedBy: 'a', note: 'b', pool: split.pool }));
        const xyz = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 4), unit('unit-y', 4), unit('unit-z', 4)] }, loadedBy: 'a', note: 'b', pool: split.pool }));
        split.pool.addSetting({ cohortId: COHORT, catalogId: xy2.id, ruleSetId: split.rules.id, effectiveFrom: '2026-11-01' });
        split.pool.addSetting({ cohortId: COHORT, catalogId: xyz.id, ruleSetId: split.rules.id, effectiveFrom: '2026-11-02' });
        study(split.pool, A, 'unit-x', 36, Date.parse('2026-11-01T01:00:00Z'), Array(15).fill(6 * S));
        study(split.pool, A, 'unit-y', 37, Date.parse('2026-11-01T02:00:00Z'), Array(15).fill(6 * S));
        study(split.pool, A, 'unit-x', 38, Date.parse('2026-11-02T01:00:00Z'), Array(40).fill(6 * S));
        study(split.pool, A, 'unit-y', 39, Date.parse('2026-11-02T02:00:00Z'), Array(40).fill(6 * S));
        study(split.pool, A, 'unit-z', 40, Date.parse('2026-11-02T03:00:00Z'), Array(10).fill(6 * S));
        assert.equal((await runWith(['--close', SLUG], { pool: split.pool })).code, EXIT.ok);
        const moved = await runWith([...recompute({ to: '2026-11-01', catalog: yx2.sha256 }), '--dry-run'], { pool: split.pool });
        const swap = `; unit list ${short(xy2.sha256)} → ${short(yx2.sha256)}`;
        assert.deepEqual([moved.code, moved.out.split('\n')], [EXIT.ok, [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-01: rules each day's own, unit list ${yx2.sha256}; by staff-a: ${REASON}`,
            `${A}: 2 day(s)`,
            `  2026-11-01  0:02:30 → 0:02:30 (±0:00:00), over the set time 0:00:30 → 0:00:30${swap}`,
            '    unit unit-x: 0:01:00 → 0:01:30 counted, 0:00:30 → 0:00:00 over the set time',
            '    unit unit-y: 0:01:30 → 0:01:00 counted, 0:00:00 → 0:00:30 over the set time',
            '  2026-11-02  0:06:30 → 0:06:30 (±0:00:00), over the set time 0:02:30 → 0:02:30',
            '    unit unit-x: 0:03:00 → 0:02:30 counted, 0:01:00 → 0:01:30 over the set time',
            '    unit unit-y: 0:02:30 → 0:03:00 counted, 0:01:30 → 0:01:00 over the set time',
            '    unit unit-z: 0:01:00 → 0:01:00 counted, 0:00:00 → 0:00:00 over the set time',
            `${B}: 1 day(s)`,
            `  2026-11-01  0:00:00 → 0:00:00 (±0:00:00), over the set time 0:00:00 → 0:00:00${swap}`,
            '2 learner(s), 3 day(s) change: counted 0:09:00 → 0:09:00 (±0:00:00).',
            `Plan sha256 ${planSha(moved.out)}. Nothing was written. To write it, run the same command with --expect ${planSha(moved.out)} instead of --dry-run.`,
        ]]);
        // Units that move by less than a second while the day's totals stay exactly the same: two units
        // studied 60.4 s each under 1 and 2 minutes (60 s + 0.4 s over, 60.4 s), then 2 and 1 minutes
        // (60.4 s, 60 s + 0.4 s over); on 11-02 (4 minutes each, 240 s each) the carry moves 0.4 s.
        const tiny = await loaded();
        const xy3 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 1), unit('unit-y', 2)] }, loadedBy: 'a', note: 'b', pool: tiny.pool }));
        const yx3 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 2), unit('unit-y', 1)] }, loadedBy: 'a', note: 'b', pool: tiny.pool }));
        const xy4 = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [unit('unit-x', 4), unit('unit-y', 4)] }, loadedBy: 'a', note: 'b', pool: tiny.pool }));
        tiny.pool.addSetting({ cohortId: COHORT, catalogId: xy3.id, ruleSetId: tiny.rules.id, effectiveFrom: '2026-11-01' });
        tiny.pool.addSetting({ cohortId: COHORT, catalogId: xy4.id, ruleSetId: tiny.rules.id, effectiveFrom: '2026-11-02' });
        study(tiny.pool, A, 'unit-x', 41, Date.parse('2026-11-01T01:00:00Z'), Array(10).fill(6_040));
        study(tiny.pool, A, 'unit-y', 42, Date.parse('2026-11-01T02:00:00Z'), Array(10).fill(6_040));
        study(tiny.pool, A, 'unit-x', 43, Date.parse('2026-11-02T01:00:00Z'), Array(40).fill(6 * S));
        study(tiny.pool, A, 'unit-y', 44, Date.parse('2026-11-02T02:00:00Z'), Array(40).fill(6 * S));
        assert.equal((await runWith(['--close', SLUG], { pool: tiny.pool })).code, EXIT.ok);
        const small = await runWith([...recompute({ to: '2026-11-01', catalog: yx3.sha256 }), '--dry-run'], { pool: tiny.pool });
        const swap3 = `; unit list ${short(xy3.sha256)} → ${short(yx3.sha256)}`;
        assert.deepEqual([small.code, small.out.split('\n')], [EXIT.ok, [
            `Recount of ${SLUG}, 2026-11-01 … 2026-11-01: rules each day's own, unit list ${yx3.sha256}; by staff-a: ${REASON}`,
            `${A}: 2 day(s)`,
            `  2026-11-01  0:02:00 → 0:02:00 (±0:00:00), over the set time 0:00:00 → 0:00:00${swap3}; its values change by less than a second`,
            '    unit unit-x: 0:01:00 → 0:01:00 counted, 0:00:00 → 0:00:00 over the set time',
            '    unit unit-y: 0:01:00 → 0:01:00 counted, 0:00:00 → 0:00:00 over the set time',
            '  2026-11-02  0:05:59 → 0:05:59 (±0:00:00), over the set time 0:02:00 → 0:02:00',
            '    unit unit-x: 0:03:00 → 0:02:59 counted, 0:01:00 → 0:01:00 over the set time',
            '    unit unit-y: 0:02:59 → 0:03:00 counted, 0:01:00 → 0:01:00 over the set time',
            `${B}: 1 day(s)`,
            `  2026-11-01  0:00:00 → 0:00:00 (±0:00:00), over the set time 0:00:00 → 0:00:00${swap3}`,
            '2 learner(s), 3 day(s) change: counted 0:08:00 → 0:08:00 (±0:00:00).',
            `Plan sha256 ${planSha(small.out)}. Nothing was written. To write it, run the same command with --expect ${planSha(small.out)} instead of --dry-run.`,
        ]]);
        for (const out of [zero.out, swapped.out, hidden.out, gained.out, moved.out, small.out]) {
            noRuleValue(out, ['7000', '6930', '7500']);
            assert.doesNotMatch(out, ISO_TIME);
            differencesMatch(out);
        }
    });
});
