// scripts/db/verify-account-deletion.mjs without a database: its options and exit codes. The checks
// themselves need a throwaway PostgreSQL 16 (the Phase 4 stage gates run them). A check that could
// not run here (R11 without a readable server log, e.g. a cluster that logs to stdout) is not a
// pass: the script exits 3 unless --allow-skip is given, so a gate cannot go green without it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode, main, parseArgs } from '../../scripts/db/verify-account-deletion.mjs';

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

    it('--help and a missing --url print the usage with the exit codes (0 and 2), and touch no database', async () => {
        const help = await runMain(['--help']);
        assert.equal(help.code, 0);
        assert.match(help.lines.join('\n'), /--allow-skip/);
        assert.match(help.lines.join('\n'), /3 a check was skipped/);
        const missing = await runMain([]);
        assert.equal(missing.code, 2);
    });
});
