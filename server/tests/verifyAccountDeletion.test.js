// scripts/db/verify-account-deletion.mjs without a database: its options and exit codes. The checks
// themselves need a throwaway PostgreSQL 16 (CI's Database checks job runs them:
// scripts/ci/db-checks.sh). A check that could not run here (R11 without a readable server log, e.g.
// a cluster that logs to stdout) is not a pass: the script exits 3 unless --allow-skip is given, so a
// gate cannot go green without it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode, main, parseArgs, readLogUntil } from '../../scripts/db/verify-account-deletion.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/db/verify-account-deletion.mjs');

/** Runs main() with console.log captured. @param {string[]} argv */
async function runMain(argv) {
    const lines = [];
    const log = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
        return { code: await main(argv), lines };
    } finally {
        console.log = log;
    }
}

describe('verify-account-deletion: options and exit codes', () => {
    it('parses --url, --log-file and --allow-skip', () => {
        assert.deepEqual(parseArgs(['--url', 'postgres://x@127.0.0.1:1/verify']),
            { url: 'postgres://x@127.0.0.1:1/verify', logFile: '', allowSkip: false, help: false });
        assert.deepEqual(parseArgs(['--url', 'postgres://x@127.0.0.1:1/verify', '--log-file', 'pg.log', '--allow-skip']),
            { url: 'postgres://x@127.0.0.1:1/verify', logFile: 'pg.log', allowSkip: true, help: false });
    });

    it('R: a skipped check exits 3 (not 0) unless --allow-skip; a failure always exits 1', () => {
        assert.equal(exitCode({ failed: 0, skipped: 0, allowSkip: false }), 0);
        assert.equal(exitCode({ failed: 0, skipped: 1, allowSkip: false }), 3, 'R11 skipped is not a pass');
        assert.equal(exitCode({ failed: 0, skipped: 1, allowSkip: true }), 0, '--allow-skip accepts the gap');
        assert.equal(exitCode({ failed: 2, skipped: 0, allowSkip: false }), 1);
        assert.equal(exitCode({ failed: 1, skipped: 1, allowSkip: false }), 1, 'a failure wins over a skip');
        assert.equal(exitCode({ failed: 1, skipped: 1, allowSkip: true }), 1, '--allow-skip never hides a failure');
    });

    it('R: main() returns exitCode() with the failed and skipped counts and --allow-skip', () => {
        const source = fs.readFileSync(SCRIPT, 'utf8');
        const tail = source.slice(source.indexOf('export async function main('));
        assert.match(tail, /const code = exitCode\(\{ failed: failed\.length, skipped: skipped\.length, allowSkip \}\);[\s\S]*?return code;\n\}/);
        assert.doesNotMatch(tail, /return failed\.length \? 1 : 0/);
        assert.match(source, /function r11\([\s\S]*?if \(!start\) \{\n\s+skip\('R11'/, 'R11 without a log is a skip, never a pass');
    });

    it('R11 quotes each verbosity value (a bare default is SET\'s DEFAULT, the server\'s terse) and polls the log for both statements instead of a fixed wait', () => {
        const source = fs.readFileSync(SCRIPT, 'utf8');
        const r11 = source.slice(source.indexOf('async function r11('), source.indexOf('export async function main('));
        assert.match(r11, /client\.query\(`SET log_error_verbosity = '\$\{verbosity\}'`\)/);
        assert.doesNotMatch(source, /SET log_error_verbosity = \$\{/, 'unquoted, `default` means the server setting');
        assert.match(r11, /const cases = \/\*\* @type \{const\} \*\/ \(\['default', 'terse'\]\);/, 'a fixed list: nothing else reaches the SET');
        assert.match(r11, /readLogUntil\(pool, logFile, start\.size, cases\.map\(\(verbosity\) => `r11-\$\{verbosity\}-\$\{nonce\}`\), 5_000\);/,
            'both statements, up to 5 s (the poll itself: the next test)');
        assert.doesNotMatch(r11, /await sleep\(300\)/);
    });

    it('R11 readLogUntil reads the log again every 100 ms until both statements are in, and stops once its time is up', async () => {
        const markers = ['r11-default-ab12', 'r11-terse-ab12'];
        /** A pool whose server log (pg_current_logfile) reads as `textAt(read number)`. @param {(read: number) => string} textAt */
        const fakePool = (textAt) => {
            /** @type {unknown[][]} */
            const reads = [];
            const pool = {
                /** @param {string} sql @param {unknown[]} [params] */
                query: async (sql, params = []) => {
                    if (sql.includes('pg_current_logfile')) return { rows: [{ file: 'log/postgresql.log' }] };
                    if (sql.includes('pg_stat_file')) return { rows: [{ size: '900' }] };
                    if (sql.includes('pg_read_file')) {
                        // A loop without a time limit (or a wait) would never end on this fake clock.
                        if (reads.length >= 50) throw new Error('read the log 50 times: no time limit?');
                        reads.push(params);
                        return { rows: [{ text: textAt(reads.length) }] };
                    }
                    throw new Error(`unexpected query: ${sql}`);
                },
            };
            return { pool: /** @type {any} */ (pool), reads };
        };
        let t = 0;
        /** @type {number[]} */
        const slept = [];
        const clock = { now: () => t, sleep: async (/** @type {number} */ ms) => { slept.push(ms); t += ms; } };
        const both = 'ERROR:  insert or update on table "jobs" violates foreign key constraint\nSTATEMENT:  /* r11-default-ab12 */ INSERT\n'
            + 'ERROR:  insert or update on table "jobs" violates foreign key constraint\nSTATEMENT:  /* r11-terse-ab12 */ INSERT\n';

        // The collector writes late: two reads find nothing, the third has both statements.
        const late = fakePool((n) => (n < 3 ? '' : both));
        const log = await readLogUntil(late.pool, '', 400, markers, 5_000, clock);
        assert.equal(late.reads.length, 3, 'read until both are in, then no more');
        assert.deepEqual(slept, [100, 100]);
        assert.deepEqual(late.reads[0], ['log/postgresql.log', 400, 500], 'from the offset to the end');
        assert.equal(log?.text, both);
        assert.equal(log?.source, 'pg_current_logfile()');

        // Only one statement ever arrives (a marker in a line without STATEMENT: does not count):
        // reads until the time is up, then returns the last read for the checks to report.
        t = 0;
        slept.length = 0;
        const one = 'STATEMENT:  /* r11-default-ab12 */ INSERT\nERROR:  r11-terse-ab12 in a message\n';
        const never = fakePool(() => one);
        const last = await readLogUntil(never.pool, '', 400, markers, 1_000, clock);
        assert.equal(never.reads.length, 11, 'reads at 0, 100, …, 1000 ms, then stops');
        assert.equal(slept.length, 10);
        assert.equal(last?.text, one);
    });

    it('--help and a missing --url print the usage with the exit codes (0 and 2), and touch no database', async () => {
        const help = await runMain(['--help']);
        assert.equal(help.code, 0);
        assert.match(help.lines.join('\n'), /--allow-skip/);
        assert.match(help.lines.join('\n'), /3 a check was skipped/);
        const missing = await runMain([]);
        assert.equal(missing.code, 2);
    });
});
