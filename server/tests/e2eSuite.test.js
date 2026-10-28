// @ts-check
// The learner end-to-end suite (Phase 7, owner decision P1 C; doc/brushup-2026/ai-access-plan.ja.md):
// playwright.config.ts, e2e/global-setup.ts, e2e/fixtures.ts, e2e/learner.spec.ts and e2e/support/.
// The suite itself needs the CI stack and a browser ("Learner end-to-end" in .github/workflows/e2e.yml,
// npm run e2e:local); here its rules are pinned as text: one worker and no retries, the global setup
// with its 00:00 JST guard and auth chain, the guards that run for every test, no sleeps, the five
// required flows, one port and one database from the CI env template, and the one SQL time nudge.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../../e2e/support/auth-stand-in.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} file */
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** Code without // comment lines, so a word in a comment never satisfies a check. @param {string} text */
const codeOf = (text) => text.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');

const CONFIG = 'playwright.config.ts';
const config = codeOf(read(CONFIG));
const SPEC = 'e2e/learner.spec.ts';
const spec = read(SPEC);
const specCode = codeOf(spec);
const fixtures = codeOf(read('e2e/fixtures.ts'));
const globalSetup = codeOf(read('e2e/global-setup.ts'));
const env = codeOf(read('e2e/support/env.ts'));
const template = read('deploy/risepath-vm/ci/stack.ci.env');

/** Every file under e2e/, repo-relative. @param {string} [dir] @returns {string[]} */
function e2eFiles(dir = 'e2e') {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        return entry.isDirectory() ? e2eFiles(rel) : [rel];
    });
}

/** The five flows the owner requires (P1 C), in the order they run. */
const FLOWS = [
    'review: a marked card is saved, waits for its day, then 「覚えた」 records it and today\'s count goes down',
    'lesson finish: XP 50 and the first-lesson badge come from the server',
    'one-lesson reset removes that lesson\'s review cards and keeps the XP',
    'logout with unsaved learning asks first; staying signed in keeps the mark, which saves once online',
    'account deletion asks for the password again (fresh amr) and ends the old session',
];

describe('the learner end-to-end suite (Phase 7, P1 C)', () => {
    it('config: e2e/*.spec.ts only, one worker, no retries, forbidOnly on CI, traces and screenshots of failures under .artifacts/e2e', () => {
        for (const line of [
            "testDir: 'e2e',",
            'testMatch: /\\.spec\\.ts$/,',
            'workers: 1,',
            'fullyParallel: false,',
            'retries: 0,',
            'forbidOnly: Boolean(process.env.CI),',
            "outputDir: '.artifacts/e2e/test-results',",
            "trace: 'retain-on-failure',",
            "screenshot: 'only-on-failure',",
        ]) assert.ok(config.split('\n').some((l) => l.trim() === line), `${CONFIG}: ${line}`);
        assert.match(config, /from 'playwright\/test'/, 'the runner inside the installed playwright package');
        assert.match(read('.gitignore'), /^\.artifacts\/$/m, '.artifacts/ (builds, traces, logs) is never committed');
    });

    it('the config runs e2e/global-setup.ts', () => {
        assert.ok(config.split('\n').some((l) => l.trim() === "globalSetup: './e2e/global-setup.ts',"), `${CONFIG}: globalSetup`);
        assert.ok(fs.existsSync(path.join(ROOT, 'e2e/global-setup.ts')));
        assert.match(globalSetup, /^export default async function globalSetup\(\)/m);
    });

    it('global setup waits past 00:00 JST with the suite\'s budget and proves the auth chain', () => {
        assert.match(globalSetup, /^import \{ waitPastJstMidnight \} from '\.\.\/scripts\/ci\/jst-midnight-guard\.mjs';$/m);
        assert.match(globalSetup, /await waitPastJstMidnight\(\{ query: \(sql\) => pool\.query\(sql\), budgetS: E2E\.dayBudgetS \}\);/);
        assert.match(env, /^ {2}dayBudgetS: 480,$/m, 'the whole suite on one Japan-time day (about 1.5-4.5 min, so 480 s)');
        assert.match(globalSetup, /\/auth\/v1\/token\?grant_type=password/, 'a stand-in sign-in');
        assert.match(globalSetup, /\/api\/v2\/user\/ai-access`, \{ headers: \{ authorization: `Bearer \$\{session\.body\.access_token\}` \} \}/, 'the api accepts that token');
        assert.match(read('scripts/ci/jst-midnight-guard.mjs'), /e2e\/global-setup\.ts \(480 s\)/, 'the guard names its callers');
    });

    it('global setup refuses a build without the stand-in, a dev, non-strict or unmigrated api, no preview proxy and no database', () => {
        /** The text of `await check('<name>', …);` in global setup, up to the next await. @param {string} name */
        const call = (name) => {
            const start = globalSetup.indexOf(`await check('${name}', `);
            assert.ok(start > 0, `global setup checks ${name}`);
            return globalSetup.slice(start, globalSetup.indexOf('await ', start + 1)).trim();
        };
        assert.match(globalSetup, /if \(!ok\(value\)\) throw new Error\(`global setup, \$\{name\}: /, 'a check that is not ok stops the run');
        const build = call('the front build');
        assert.ok(build.includes(".readFileSync(path.join(assets, f), 'utf8').includes(`127.0.0.1:${E2E.authPort}`)"), 'a built asset names the stand-in');
        assert.ok(build.endsWith("(v) => v === 'ok', BUILD);"), build);
        const api = call('api health');
        assert.ok(api.includes('get(`${E2E.apiUrl}/api/v2/health`)'), api);
        for (const condition of ['r.status === 200', "r.body?.node_env === 'production'", 'r.body?.checks?.strict_auth_mode === true', 'r.body?.database?.migrations?.pending === 0']) {
            assert.ok(api.includes(condition), `api health: ${condition} (the suite never runs against a dev, non-strict or unmigrated api)`);
        }
        assert.doesNotMatch(api, /\|\||!==/, 'api health: every condition must hold');
        assert.ok(call('the preview proxy').includes('get(`${E2E.appUrl}/api/v2/health`), (r) => r.status === 200,'), 'vite preview reaches the api through /api');
        const db = call('the stack database');
        assert.ok(db.includes("pool.query('SELECT 1 AS one')") && db.includes('r.rows[0]?.one === 1'), db);
    });

    it('the guards fixture runs for every test and fails on a 429, a learner-route 5xx and an auth endpoint the stand-in does not model', () => {
        const start = fixtures.indexOf('  guards: [async ');
        assert.ok(start > 0, 'e2e/fixtures.ts declares guards: [async …');
        const end = fixtures.indexOf('}, { auto: true }],', start);
        assert.ok(end > start, 'guards ends with }, { auto: true }]: it runs without being asked for');
        const block = fixtures.slice(start, end);
        assert.match(block, /expect\(api\.filter\(\(s\) => s\.status === 429\), '[^']*'\)\.toEqual\(\[\]\);/);
        assert.match(block, /expect\(api\.filter\(\(s\) => s\.status >= 500 && s\.path\.startsWith\('\/api\/v2\/user\/'\)\), '[^']*'\)\.toEqual\(\[\]\);/);
        assert.match(block, /expect\(auth\.filter\(\(s\) => s\.status === 404\), '[^']*'\)\.toEqual\(\[\]\);/);
        assert.match(block, /testInfo\.attach\('api-requests\.json'/, 'every test attaches its request log with the per-minute peak');
        assert.match(block, /peakPerMinute/);
    });

    it('every spec takes test and expect from ./fixtures.ts', () => {
        const specs = e2eFiles().filter((f) => f.endsWith('.spec.ts'));
        assert.deepEqual(specs, [SPEC], 'one spec file');
        for (const file of specs) {
            const text = codeOf(read(file));
            assert.match(text, /^import \{ test, expect[^}]*\} from '\.\/fixtures\.ts';$/m, `${file}: test and expect from ./fixtures.ts`);
            assert.doesNotMatch(text, /from ['"](@?playwright\/test|playwright)['"]/, `${file}: never from playwright/test directly (the guards would not run)`);
        }
    });

    it('serves the production build with vite preview on a fixed port with the api proxy', () => {
        assert.match(config, /\+ `npx vite preview --outDir \$\{E2E\.distDir\} --host 127\.0\.0\.1 --port \$\{new URL\(E2E\.appUrl\)\.port\} --strictPort`,/);
        assert.match(config, /command: `test -f \$\{E2E\.distDir\}\/index\.html \|\| \{ echo "[^"]*run bash scripts\/ci\/stack\.sh build-front" >&2; exit 1; \}; `/, 'no build: a message instead of a 60 s wait');
        assert.match(config, /env: \{ API_PROXY_TARGET: E2E\.apiUrl \},/);
        assert.match(config, /reuseExistingServer: false,/);
        assert.match(env, /^ {2}appUrl: 'http:\/\/127\.0\.0\.1:4173',$/m);
        assert.match(env, /^ {2}apiUrl: 'http:\/\/127\.0\.0\.1:3006',$/m);
        assert.match(env, /^ {2}distDir: '\.artifacts\/e2e\/dist',$/m);
        assert.match(read('scripts/ci/stack.sh'), /npm run build:prod -- --outDir \.artifacts\/e2e\/dist --emptyOutDir/, 'stack.sh build-front writes the folder the preview serves');
        assert.match(read('vite.config.ts'), /vite preview in the end-to-end checks \(preview inherits server\.proxy/, 'the proxy comment says preview uses it too');
    });

    it('the specs and fixtures never sleep or fake the clock', () => {
        const files = e2eFiles().filter((f) => /\.(ts|mjs|js)$/.test(f));
        assert.ok(files.length >= 8, files.join(', '));
        for (const file of files) {
            const text = codeOf(read(file));
            for (const pattern of [/waitForTimeout\(/, /(?<!test\.)\bsetTimeout\(/, /page\.clock|\.clock\.install|\bclock\.(install|setFixedTime|setSystemTime)/, /\bsleep\(/]) {
                assert.doesNotMatch(text, pattern, `${file}: ${pattern} (wait for what the app shows or the server stored)`);
            }
        }
    });

    it('the five required flows are in the suite, each with its own learner', () => {
        const titles = [...specCode.matchAll(/^test\('((?:[^'\\]|\\.)*)', async \(\{([^}]*)\}\) => \{$/gm)].map((m) => ({ title: m[1].replace(/\\'/g, "'"), fixtures: m[2] }));
        assert.deepEqual(titles.map((t) => t.title), FLOWS);
        for (const t of titles) assert.match(t.fixtures, /\blearner\b/, `${t.title}: a fresh learner`);
        assert.doesNotMatch(specCode, /test\.(only|skip|fixme)\(|\.describe\.(only|skip)/, 'no test is left out (a skip needs the owner and an issue)');
        assert.match(fixtures, /email = `e2e-t\$\{testInfo\.testId\.slice\(0, 8\)\.toLowerCase\(\)\}-\$\{Date\.now\(\)\.toString\(36\)\}@example\.org`/, 'one learner per test');
    });

    it('one port for the stand-in: the CI env template, the stand-in default, the specs and stack.sh', () => {
        const url = new URL(template.match(/^SUPABASE_URL=(.*)$/m)?.[1] ?? '');
        assert.equal(Number(url.port), DEFAULT_PORT);
        assert.match(env, /^const authPort = Number\(new URL\(ci\.SUPABASE_URL\)\.port\);$/m, 'the specs read it from the template');
        assert.doesNotMatch(codeOf(read('scripts/ci/stack.sh')), new RegExp(`\\b${DEFAULT_PORT}\\b`), 'stack.sh reads it from the template');
        assert.doesNotMatch(config + specCode + fixtures + globalSetup, new RegExp(`\\b${DEFAULT_PORT}\\b`), 'no second copy of the port');
    });

    it('the specs reach only the template\'s database on 127.0.0.1:5432', () => {
        assert.match(env, /^ {2}databaseUrl: `postgresql:\/\/\$\{ci\.POSTGRES_USER\}:\$\{ci\.POSTGRES_PASSWORD\}@127\.0\.0\.1:5432\/\$\{ci\.POSTGRES_DB\}`,$/m);
        assert.match(env, /readFileSync\(new URL\('\.\.\/\.\.\/deploy\/risepath-vm\/ci\/stack\.ci\.env', import\.meta\.url\)/);
        for (const file of e2eFiles().filter((f) => f !== 'e2e/support/auth-stand-in.mjs')) {
            const text = codeOf(read(file));
            assert.doesNotMatch(text, /process\.env/, `${file}: no environment override (the specs' SQL never reaches another database)`);
            assert.doesNotMatch(text, /DATABASE_URL/, file);
        }
        assert.match(fixtures, /new pg\.Pool\(\{ connectionString: E2E\.databaseUrl/);
        assert.match(globalSetup, /new pg\.Pool\(\{ connectionString: E2E\.databaseUrl/);
    });

    it('the time nudge lives in e2e/support/sql.ts, and the spec runs the control first', () => {
        const sql = read('e2e/support/sql.ts');
        assert.match(sql, /^export const NUDGE_DUE_TODAY_SQL = `UPDATE review_cards$/m);
        assert.match(sql, /^export const SHORTCUT_DUE_TODAY_SQL = `UPDATE review_cards$/m);
        assert.match(spec, /^import \{ NUDGE_DUE_TODAY_SQL, SHORTCUT_DUE_TODAY_SQL \} from '\.\/support\/sql\.ts';$/m);
        assert.doesNotMatch(specCode, /UPDATE\s+review_cards/i, 'no inline data change in the spec');
        for (const file of e2eFiles()) assert.doesNotMatch(read(file), /UPDATE\s+learning_days/i, `${file}: learning days are never moved (scope guard S-7)`);
        const control = specCode.indexOf('SHORTCUT_DUE_TODAY_SQL, [learner.id]');
        const nudge = specCode.indexOf('NUDGE_DUE_TODAY_SQL, [learner.id]');
        assert.ok(control > 0 && nudge > control, 'the control runs before the nudge');
        assert.match(specCode.slice(control, nudge), /toBe\('23514'\)/, 'the shortcut is refused by the table (check_violation)');
        assert.match(specCode.slice(control, nudge), /ROLLBACK/, 'inside a rolled-back transaction');
        assert.equal(specCode.match(/NUDGE_DUE_TODAY_SQL, \[/g)?.length, 1, 'one nudge');
    });
});
