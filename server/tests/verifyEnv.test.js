// @ts-check
// `npm run env:check` (scripts/verify-env.mjs) and `npm run env:inventory` (scripts/verify-env-inventory.mjs),
// Phase 9 stage 6 (design §8.4 D19, §7.2 D8):
//   - the templates' placeholder `change-me` (a hyphen) counts as a placeholder, as CHANGE_ME and change_me do;
//   - the report prints names and SET / MISSING / PLACEHOLDER only, never a value;
//   - a development .env.local is sent to the local development database (doc/guides/first-launch.ja.md 18 章),
//     a production host (risepath-vm, nexloom-gce, also as risepath-vm.<tailnet>.ts.net) gets a "production database"
//     warning and a Tailscale address its own (review round 1 of Stage 6, findings 5 and 10);
//   - `npm run env:check` still runs main (finding 9).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLACEHOLDER_PATTERNS,
  PRODUCTION_DB_HOSTS,
  checkDatabaseTarget,
  classify,
  parseEnvFile,
  printReport,
  productionDbHostKind,
} from '../../scripts/verify-env.mjs';
import { PLACEHOLDER_PATTERNS as INVENTORY_PATTERNS, classify as inventoryClassify } from '../../scripts/verify-env-inventory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A log that keeps its lines. */
function capture() {
  /** @type {string[]} */
  const lines = [];
  return { lines, log: (/** @type {string} */ line) => { lines.push(String(line)); } };
}

describe('placeholders (D19)', () => {
  it('change-me, change_me and CHANGE_ME are placeholders in both tools; real values are SET; empty is MISSING', () => {
    for (const value of ['change-me', 'CHANGE-ME', 'change_me', 'CHANGE_ME', 'prefix-change-me-suffix', 'YOUR_KEY']) {
      assert.equal(classify('X', value), 'PLACEHOLDER', `verify-env: ${value}`);
      assert.equal(inventoryClassify(value), 'PLACEHOLDER', `verify-env-inventory: ${value}`);
    }
    for (const value of ['0123456789abcdef0123456789abcdef', 'changeme-not-a-placeholder'.replace('-not-a-placeholder', 'x')]) {
      assert.equal(classify('X', value), 'SET', value);
      assert.equal(inventoryClassify(value), 'SET', value);
    }
    assert.equal(classify('X', ''), 'MISSING');
    assert.equal(inventoryClassify(undefined), 'MISSING');
    assert.ok(PLACEHOLDER_PATTERNS.some((re) => String(re) === '/change[-_]me/i'));
    assert.ok(INVENTORY_PATTERNS.some((re) => String(re) === '/change[-_]me/i'));
  });
  it('every change-me line of deploy/risepath-vm/stack.env.example reads as PLACEHOLDER (the old /CHANGE_ME/ read them as SET)', () => {
    const { env } = parseEnvFile(fs.readFileSync(path.join(ROOT, 'deploy/risepath-vm/stack.env.example'), 'utf8'));
    const names = Object.keys(env).filter((k) => /change-me/i.test(env[k]));
    assert.ok(names.includes('POSTGRES_PASSWORD') && names.includes('HERMES_API_KEY') && names.includes('RISE_PATH_BRIDGE_TOKEN'), names.join(', '));
    for (const k of names) assert.equal(classify(k, env[k]), 'PLACEHOLDER', k);
  });
});

describe('the report never prints a value (D19)', () => {
  const SENTINEL = 'SentinelValue7f3c9a';
  /** Every name the report lists, each holding a value that carries the sentinel. */
  const env = {
    VITE_SUPABASE_URL: `https://${SENTINEL}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: `anon-${SENTINEL}`,
    SUPABASE_URL: `https://${SENTINEL}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: `srk-${SENTINEL}`,
    DATABASE_URL_PHASE1: `postgresql://risepath_app:${SENTINEL}pw@127.0.0.1:5433/risepath?sslmode=disable`,
    VITE_DEMO_MODE: `false${SENTINEL}`,
    VITE_API_ENABLED: `true${SENTINEL}`,
    VITE_API_BASE_URL: `/api/v2/${SENTINEL}`,
    PORT: `3006${SENTINEL}`,
    HERMES_API_URL: `http://127.0.0.1:8642/${SENTINEL}`,
    HERMES_API_KEY: `hermes-${SENTINEL}`,
    KOKORO_TTS_URL: `http://127.0.0.1:8880/${SENTINEL}`,
    KOKORO_TTS_DEFAULT_VOICE_JA: `jf_${SENTINEL}`,
    KOKORO_TTS_DEFAULT_VOICE_EN: `af_${SENTINEL}`,
    ANTHROPIC_API_KEY: `ak-${SENTINEL}`,
    GEMINI_ALLOWED: `x${SENTINEL}`,
    GEMINI_API_KEY: `g-${SENTINEL}`,
  };
  const raw = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
  it('lists every name with its status and no sentinel (the old report printed the recommended values)', () => {
    const { lines, log } = capture();
    const blockers = printReport(env, raw, log);
    assert.equal(blockers, 0);
    const out = lines.join('\n');
    for (const key of Object.keys(env)) assert.match(out, new RegExp(`\\b${key}: (?:SET|MISSING|PLACEHOLDER)\\b`), key);
    assert.ok(!out.includes(SENTINEL), out.split('\n').filter((l) => l.includes(SENTINEL)).join('\n'));
    assert.doesNotMatch(out, /value=/);
  });
  it('the database target shows host, name and user, never the password', () => {
    const { lines, log } = capture();
    checkDatabaseTarget({ DATABASE_URL_PHASE1: `postgresql://risepath_app:${SENTINEL}@127.0.0.1:5433/risepath` }, log);
    const out = lines.join('\n');
    assert.match(out, /host: 127\.0\.0\.1/);
    assert.match(out, /database: risepath/);
    assert.match(out, /user: risepath_app/);
    assert.ok(!out.includes(SENTINEL));
  });
});

describe('the development database (D8)', () => {
  it('a production host (risepath-vm, nexloom-gce) gets the warning that names the runbook\'s 18 章; the local development database does not', () => {
    assert.deepEqual([...PRODUCTION_DB_HOSTS].sort(), ['nexloom-gce', 'risepath-vm']);
    // Review round 1 of Stage 6, findings 5 and 10: the full Tailscale MagicDNS name and a GCE internal name are the same
    // hosts (the old local guide told developers to use 「Tailscale 名または 100.x IP」).
    for (const host of ['risepath-vm', 'nexloom-gce', 'RISEPATH-VM', 'risepath-vm.tail1234.ts.net', 'nexloom-gce.c.project.internal', 'risepath-vm.']) {
      const { lines, log } = capture();
      const result = checkDatabaseTarget({ DATABASE_URL_PHASE1: `postgresql://risepath_app:pw@${host}:5432/risepath` }, log);
      assert.equal(result.ok, true, 'a warning, not a blocker');
      const warning = lines.find((l) => l.includes('this is the production database'));
      assert.ok(warning, host);
      assert.match(/** @type {string} */ (warning), /use the local development database \(doc\/guides\/first-launch\.ja\.md 18 章\)/u);
    }
    for (const host of ['127.0.0.1', 'localhost', 'risepath-vm-dev.example', 'my-risepath-vm', 'db', '100.63.255.255', '100.128.0.1', '10.100.64.1']) {
      const { lines, log } = capture();
      checkDatabaseTarget({ DATABASE_URL_PHASE1: `postgresql://risepath_app:pw@${host}:5433/risepath` }, log);
      assert.ok(!lines.some((l) => l.includes('production database') || l.includes('Tailscale address')), host);
    }
  });
  it('a Tailscale address (100.64.0.0/10, fd7a:115c:a1e0::/48) gets its own warning with the 18 章 hint (findings 5, 10)', () => {
    for (const host of ['100.64.0.1', '100.101.102.103', '100.127.255.254', '[fd7a:115c:a1e0::1]']) {
      assert.equal(productionDbHostKind(host), 'tailscale', host);
      const { lines, log } = capture();
      const result = checkDatabaseTarget({ DATABASE_URL_PHASE1: `postgresql://risepath_app:pw@${host}:5432/risepath` }, log);
      assert.equal(result.ok, true, 'a warning, not a blocker');
      const warning = lines.find((l) => l.includes(': a Tailscale address. If it is risepath-vm or nexloom-gce, this is the production database.'));
      assert.ok(warning, `${host}: ${lines.join(' | ')}`);
      assert.match(/** @type {string} */ (warning), /use the local development database \(doc\/guides\/first-launch\.ja\.md 18 章\)/u);
    }
    assert.equal(productionDbHostKind('risepath-vm.tail1234.ts.net'), 'production');
    assert.equal(productionDbHostKind('127.0.0.1'), null);
  });
  it('runbook 9.5 quotes what env:check prints: the target heading, `host:`, and both warnings', () => {
    const runbook = fs.readFileSync(path.join(ROOT, 'doc/guides/first-launch.ja.md'), 'utf8');
    const start = runbook.indexOf('### 9.5 ');
    const step = runbook.slice(start, runbook.indexOf('\n### ', start + 1));
    assert.ok(step.includes('`npm run env:check`'));
    /** @type {[string, string[]][]} */
    const cases = [
      ['postgresql://risepath_app:pw@127.0.0.1:5433/risepath', ['## Database target (no secrets)', 'host: 127.0.0.1']],
      ['postgresql://risepath_app:pw@risepath-vm:5432/risepath', ['this is the production database']],
      ['postgresql://risepath_app:pw@100.101.102.103:5432/risepath', ['Tailscale address']],
    ];
    for (const [url, printed] of cases) {
      const { lines, log } = capture();
      checkDatabaseTarget({ DATABASE_URL_PHASE1: url }, log);
      for (const text of printed) {
        assert.ok(lines.some((l) => l.includes(text)), `env:check prints ${text}`);
        assert.ok(step.includes(text), `9.5 quotes ${text}`);
      }
    }
  });
  // Review round 2 of Stage 6, finding 2: the line 9.5's check catches is a stale DATABASE_URL_PHASE1 with the production
  // password in it. The check prints line numbers and names only (an uppercase name before its `=`), so nothing the
  // owner may paste to the agent holds a value: not an assignment, not a comment, not an `export` line.
  it('runbook 9.5 step 2 prints line numbers and names only, never a value', { skip: spawnSync('bash', ['-c', 'grep --version']).status === 0 ? false : 'needs bash and grep' }, () => {
    const runbook = fs.readFileSync(path.join(ROOT, 'doc/guides/first-launch.ja.md'), 'utf8');
    const start = runbook.indexOf('### 9.5 ');
    const step = runbook.slice(start, runbook.indexOf('\n### ', start + 1));
    const command = [...step.matchAll(/`([^`]+)`/g)].map((m) => m[1]).find((c) => c.startsWith('grep -n -E '));
    assert.ok(command, '9.5 gives the grep');
    const secret = 'S3cretProdPw';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9-envlocal-'));
    try {
      const run = (/** @type {string} */ body) => {
        fs.writeFileSync(path.join(dir, '.env.local'), body);
        const r = spawnSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' });
        return r.stdout;
      };
      const stale = [
        `DATABASE_URL_PHASE1=postgresql://risepath_app:${secret}@risepath-vm:5432/risepath?sslmode=disable`,
        `# old: postgresql://risepath_app:${secret}@nexloom-gce:5432/risepath?sslmode=disable`,
        `export E2E_API_URL=http://risepath-vm:3006/?token=${secret}`,
        `MEMANTO_URL=https://user:${secret}@100.64.1.2/`,
        `GEMINI_API_KEY=${secret}`,
      ].join('\n') + '\n';
      const out = run(stale);
      assert.ok(!out.includes(secret), out);
      assert.deepEqual(out.trim().split('\n'), ['1:DATABASE_URL_PHASE1', '2:', '3:', '4:MEMANTO_URL']);
      assert.equal(run('DATABASE_URL_PHASE1=postgresql://risepath_app:dev@127.0.0.1:5433/risepath?sslmode=disable\n'), '', 'the development database: nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.ok(step.includes('出るのは、行の番号と名前だけです。値は出ません'));
    assert.ok(step.includes('`.env.local` の行の中身は、チャットに貼りません'));
  });
  it('the local setup guide quotes the warning as env:check prints it (no Japanese line the script never prints)', () => {
    const guide = fs.readFileSync(path.join(ROOT, 'doc/guides/env_local_setup_issue15.md'), 'utf8');
    const line = guide.split('\n').find((l) => l.includes('`npm run env:check` は、`.env.local` のホストが'));
    assert.ok(line, 'the guide names the warning');
    const quoted = /`(this is the production database)`/.exec(/** @type {string} */ (line))?.[1];
    assert.ok(quoted, 'the warning is quoted in English, as printed');
    const { lines, log } = capture();
    checkDatabaseTarget({ DATABASE_URL_PHASE1: 'postgresql://risepath_app:pw@risepath-vm:5432/risepath' }, log);
    assert.ok(lines.some((l) => l.includes(`: ${quoted}.`)), lines.join('\n'));
    assert.doesNotMatch(/** @type {string} */ (line), /「本番の DB です」/u);
  });
  it('no message sends the developer to risepath-vm any more', () => {
    for (const env of [{ DATABASE_URL_PHASE1: 'postgresql://u:pw@127.0.0.1:5433/autogrants' }, { DATABASE_URL_PHASE1: 'postgresql://u:pw@db.abcdefghijklmnopqrst.supabase.co:5432/risepath' }]) {
      const { lines, log } = capture();
      const result = checkDatabaseTarget(env, log);
      const out = [...lines, result.ok ? '' : String(result.message)].join('\n');
      assert.doesNotMatch(out, /on risepath-vm|risepath-vm\/risepath/);
      assert.match(out, /local development database \(doc\/guides\/first-launch\.ja\.md 18 章\)/u);
    }
  });
});

describe('the CLIs still run as scripts (the main-module guard)', () => {
  it('env:inventory reads the template and prints names only', () => {
    const r = spawnSync(process.execPath, ['scripts/verify-env-inventory.mjs', '--scope', 'rise-path', '--path', 'secrets.inventory.template'], { cwd: ROOT, encoding: 'utf8' });
    assert.match(r.stdout, /^# Env inventory \(no values\) — scope=rise-path$/m);
    assert.match(r.stdout, /^Summary: SET=\d+ PLACEHOLDER=\d+ MISSING=\d+$/m);
  });
  // Review round 1 of Stage 6, finding 9: `npm run env:check` runs main (a broken main-module guard would print nothing
  // and exit 0, which reads as a pass).
  it('env:check runs main: it prints its heading or the missing-file line, and exits with a status', () => {
    const r = spawnSync(process.execPath, ['scripts/verify-env.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    assert.equal(typeof r.status, 'number', `exited (${r.signal ?? ''})`);
    const out = `${r.stdout}${r.stderr}`;
    assert.match(out, /# Rise Path env check \(\.env\.local\)|\.env\.local not found/);
    if (/\.env\.local not found/.test(out)) assert.equal(r.status, 1, 'no .env.local is a failure');
  });
  it('importing the modules runs nothing (no .env.local read, no exit)', () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/verify-env.mjs'); await import('./scripts/verify-env-inventory.mjs'); console.log('imported');"], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'imported');
  });
});

describe('review round 3 of Stage 6 (findings 7 and 12)', () => {
  const runbook = () => fs.readFileSync(path.join(ROOT, 'doc/guides/first-launch.ja.md'), 'utf8');
  const step95 = () => {
    const text = runbook();
    const start = text.indexOf('### 9.5 ');
    return text.slice(start, text.indexOf('\n### ', start + 1));
  };
  // Finding 7: 9.5's grep also flags the non-database lines older docs told developers to write (the VM's Hermes,
  // Memanto and Kokoro addresses). Its failure path must not send those to the development database.
  it('9.5\'s grep flags the VM addresses of other parts, and its failure path names what to do with each name it prints', { skip: spawnSync('bash', ['-c', 'grep --version']).status === 0 ? false : 'needs bash and grep' }, () => {
    const step = step95();
    const command = [...step.matchAll(/`([^`]+)`/g)].map((m) => m[1]).find((c) => c.startsWith('grep -n -E '));
    assert.ok(command, '9.5 gives the grep');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9-envlocal3-'));
    try {
      fs.writeFileSync(path.join(dir, '.env.local'), [
        'DATABASE_URL_PHASE1=postgresql://risepath_app:dev@127.0.0.1:5433/risepath?sslmode=disable',
        'HERMES_API_URL=http://risepath-vm:8642',
        'MEMANTO_URL=http://risepath-vm:8080',
        'KOKORO_TTS_URL=http://risepath-vm:8880',
      ].join('\n') + '\n');
      const out = spawnSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' }).stdout.trim().split('\n');
      assert.deepEqual(out, ['2:HERMES_API_URL', '3:MEMANTO_URL', '4:KOKORO_TTS_URL']);
      const failure = step.slice(step.indexOf('- うまくいかないとき: '), step.indexOf('- くわしく: '));
      const other = /ほかの名前の行（([^）]+)）は、その行を消すか、エージェントと一緒に `127\.0\.0\.1` の値にします。/u.exec(failure)?.[1] ?? '';
      for (const line of out) assert.ok(other.includes(`\`${line.split(':')[1]}\``), `the failure path names ${line}`);
      assert.match(failure, /`DATABASE_URL_PHASE1` の行は、開発用の DB（18 章）に直します。/u);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  // Finding 12: the template the setup messages name must exist (the tracked one is .env.example).
  it('every `cp <template> .env.local` the developer is told to run names a file that exists', () => {
    const files = ['scripts/verify-env.mjs', 'doc/guides/env_local_setup_issue15.md', 'doc/guides/usage_guide.md', 'doc/guides/env_migration_safety.md'];
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const sources = [...text.matchAll(/\bcp (\S+) \.env\.local\b/g)].map((m) => m[1]);
      assert.ok(sources.length > 0, `${rel} says how to make .env.local`);
      for (const src of sources) assert.ok(fs.existsSync(path.join(ROOT, src)), `${rel}: ${src} exists`);
      assert.doesNotMatch(text, /env\.local\.template/, `${rel}: no template that is not in the repository`);
    }
    assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', '.env.example'], { cwd: ROOT }).status, 0, '.env.example is tracked');
    // What env:check prints when .env.local is missing (run where there is none).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9-noenv-'));
    try {
      fs.mkdirSync(path.join(dir, 'scripts'));
      fs.copyFileSync(path.join(ROOT, 'scripts/verify-env.mjs'), path.join(dir, 'scripts/verify-env.mjs'));
      fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
      const r = spawnSync(process.execPath, [path.join(dir, 'scripts/verify-env.mjs')], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^ {3}Run: cp \.env\.example \.env\.local$/m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
