// scripts/db/verify-phase5.mjs without a database: its options and exit codes (shared with
// verify-account-deletion.mjs), and that the checks it runs are the shipped code. The checks
// themselves need a throwaway PostgreSQL 16 (CI's Database checks job runs them:
// scripts/ci/db-checks.sh). A check that could not run here (P4 without psql) is not a pass: exit 3
// unless --allow-skip.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../scripts/db/verify-phase5.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/db/verify-phase5.mjs');
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

describe('verify-phase5: options and exit codes', () => {
    it('--help and a missing --url print the usage with the exit codes (0 and 2), and touch no database', async () => {
        const help = await runMain(['--help']);
        assert.equal(help.code, 0);
        assert.match(help.lines.join('\n'), /--url postgres:\/\/<user>@<host>:<port>\/<empty throwaway database>/);
        assert.match(help.lines.join('\n'), /--allow-skip/);
        assert.match(help.lines.join('\n'), /3 a check was skipped/);
        assert.equal((await runMain([])).code, 2);
        assert.equal((await runMain(['--url'])).code, 2, '--url without a value');
    });

    it('uses verify-account-deletion\'s parseArgs and exitCode: a skip exits 3 without --allow-skip, a failure always 1', () => {
        assert.match(source, /import \{ exitCode, parseArgs \} from '\.\/verify-account-deletion\.mjs';/);
        const tail = source.slice(source.indexOf('export async function main('));
        assert.match(tail, /const code = exitCode\(\{ failed: failed\.length, skipped: skipped\.length, allowSkip \}\);[\s\S]*?return code;\n\}/);
        assert.match(source, /if \(psql\.status !== 0\) \{\n\s+skip\('P4'/, 'P4 without psql is a skip, never a pass');
    });

    it('refuses anything but an empty throwaway database in a cluster without the remote role, as a superuser (exit 2)', () => {
        assert.match(source, /if \(target\.tables > 0 \|\| target\.role \|\| !target\.superuser\) \{[\s\S]*?return 2;/);
        assert.match(source, /DROP OWNED BY \$\{ROLE\}[\s\S]*DROP ROLE IF EXISTS \$\{ROLE\}/, 'the role it creates is dropped again');
    });

    it('runs the shipped SQL and functions, the shipped role file through psql, and every check P1-P10', () => {
        for (const name of ['resetLessonProgress', 'saveLessonProgress', 'deleteAllLessonProgress', 'applyQuizCheck', 'markLessonProgress', 'getLessonProgress', 'ACCOUNT_STUB_SHARE_SQL', 'RESET_LESSON_EPOCH_SQL']) {
            assert.match(source, new RegExp(`\\b${name}\\b[\\s\\S]*from '\\.\\./\\.\\./tools/core/lessonProgress\\.js'`), name);
        }
        assert.match(source, /import \{\n {4}BLENDER_XP_SQL, LEARNING_DAY_SQL, LESSON_XP_SQL, XP_LOCK_SQL, getAchievements, noteBlenderProgress, noteLearning,\n\} from '\.\.\/\.\.\/tools\/core\/achievements\.js';/);
        assert.match(source, /await p5Read\(pool\);/, 'stage 2: the achievements read and the hooks on Postgres');
        assert.match(source, /import \{ SQL as DELETION_SQL \} from '\.\.\/\.\.\/server\/services\/accountDeletion\.js';/);
        assert.match(source, /'deploy', 'risepath-vm', 'sql', 'mcp_remote_role\.sql'/);
        assert.match(source, /spawnSync\('psql', \['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `mcp_password=\$\{password\}`, '-d', url, '-f', ROLE_SQL\]/);
        assert.match(source, /crypto\.randomBytes\(16\)\.toString\('hex'\)/, 'a fresh 32-character password, never a fixed one');
        for (let n = 1; n <= 10; n += 1) assert.match(source, new RegExp(`await p${n}\\(pool`), `P${n} runs`);
        assert.match(source, /inst\.state\.skip = \(text\) => text === stubShare;/, 'P10 has a control without the stub KEY SHARE');
        assert.match(source, /variant === 'control' \? deleteAllBefore\(pool, user\) : deleteAllLessonProgress\(\{ userId: user \}\)/, 'P6 races delete-all with an AI app\'s write, with a control');
    });
});
