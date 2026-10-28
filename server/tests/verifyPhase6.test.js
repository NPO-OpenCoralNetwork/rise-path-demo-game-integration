// scripts/db/verify-phase6.mjs without a database: its options and exit codes (shared with
// verify-account-deletion.mjs), and that the checks it runs are the shipped code. The checks
// themselves need a throwaway PostgreSQL 16 (CI's Database checks job runs them:
// scripts/ci/db-checks.sh). A check that could not run here (P4 without psql) is not a pass: exit 3
// unless --allow-skip. Same pins as verifyPhase5.test.js for verify-phase5.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode } from '../../scripts/db/verify-account-deletion.mjs';
import { main } from '../../scripts/db/verify-phase6.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/db/verify-phase6.mjs');
const source = fs.readFileSync(SCRIPT, 'utf8');

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

describe('verify-phase6: options and exit codes', () => {
    it('--help and a missing --url print the usage with the exit codes (0 and 2), and touch no database', async () => {
        const help = await runMain(['--help']);
        assert.equal(help.code, 0);
        const usage = help.lines.join('\n');
        assert.match(usage, /node scripts\/db\/verify-phase6\.mjs --url postgres:\/\/<user>@<host>:<port>\/<empty throwaway database>/);
        assert.match(usage, /--allow-skip/);
        assert.match(usage, /3 a check was skipped/);
        assert.equal((await runMain([])).code, 2);
        assert.equal((await runMain(['--url'])).code, 2, '--url without a value');
    });

    it('uses verify-account-deletion\'s parseArgs and exitCode: a skip exits 3 without --allow-skip, a failure always 1', () => {
        assert.match(source, /import \{ exitCode, parseArgs \} from '\.\/verify-account-deletion\.mjs';/);
        const tail = source.slice(source.indexOf('export async function main('));
        assert.match(tail, /const code = exitCode\(\{ failed: failed\.length, skipped: skipped\.length, allowSkip \}\);[\s\S]*?return code;\n\}/);
        assert.deepEqual(
            [exitCode({ failed: 0, skipped: 1, allowSkip: false }), exitCode({ failed: 0, skipped: 1, allowSkip: true }), exitCode({ failed: 1, skipped: 0, allowSkip: true }), exitCode({ failed: 0, skipped: 0, allowSkip: false })],
            [3, 0, 1, 0],
        );
    });

    it('P4 without psql is a skip, never a pass, and nothing after it runs as the role', () => {
        assert.match(source, /const psql = spawnSync\('psql', \['--version'\], \{ encoding: 'utf8' \}\);\n\s+if \(psql\.status !== 0\) return null;/, 'no psql (status null) or a broken one: null');
        assert.match(source, /const run = runRoleSql\(url\);\n\s+if \(!run\) \{\n\s+skip\('P4', [^\n]+\);\n\s+return false;\n\s+\}/, 'null is skip(\'P4\'), then P4 stops');
        assert.match(source, /function skip\(id, label\) \{\n\s+skipped\.push\(id\);/);
    });

    it('refuses anything but an empty throwaway database in a cluster without the remote role, as a superuser (exit 2); the role it creates is dropped again', () => {
        assert.match(source, /if \(target\.tables > 0 \|\| target\.role \|\| !target\.superuser\) \{[\s\S]*?return 2;/);
        const tail = source.slice(source.indexOf('export async function main('));
        assert.match(tail, /roleRan = true;\n\s+await p4\(pool, url\);/, 'set before P4 runs, so a role P4 left half made is dropped too');
        assert.match(tail, /\} finally \{\n\s+resetPoolForTests\(\);\n\s+if \(roleRan\) \{\n\s+await pool\.query\(`DROP OWNED BY \$\{ROLE\}`\)[^\n]*\n\s+await pool\.query\(`DROP ROLE IF EXISTS \$\{ROLE\}`\)[^\n]*\n[^\n]*\n\s+check\('P4', left === 0,/);
    });

    it('runs the shipped SQL and functions, the shipped role file through psql, and every check P1-P12', () => {
        assert.match(source, /'deploy', 'risepath-vm', 'sql', 'mcp_remote_role\.sql'/);
        assert.match(source, /spawnSync\('psql', \['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `mcp_password=\$\{password\}`, '-d', url, '-f', ROLE_SQL\]/);
        assert.match(source, /crypto\.randomBytes\(16\)\.toString\('hex'\)/, 'a fresh 32-character password, never a fixed one');
        for (const name of ['getReviewQueue', 'gradeReviewCard', 'reviewDueForAgent', 'reviewGradeForAgent', 'enterReviewCards', 'GRADE_REVIEW_CARD_SQL', 'REVIEW_ROWS_SQL']) {
            assert.match(source, new RegExp(`\\b${name}\\b[\\s\\S]*from '\\.\\./\\.\\./tools/core/reviewQueue\\.js'`), name);
        }
        assert.match(source, /import \{ SQL as DELETION_SQL \} from '\.\.\/\.\.\/server\/services\/accountDeletion\.js';/);
        for (let n = 1; n <= 12; n += 1) assert.match(source, new RegExp(`await p${n}\\(pool`), `P${n} runs`);
        assert.match(source, /await p1Before020\(pool, preId\);\n\s+await p1Order\(pool\);/, 'the "not set up" answers are checked on the schema before 020');
        assert.match(source, /types === 'table_not_found,table_not_found,review_unavailable,review_unavailable' && codes === '42703,42P01,42703,42P01'/);
    });
});
