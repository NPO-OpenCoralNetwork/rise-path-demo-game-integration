/**
 * scripts/ci/scan-secrets.mjs: every rule, masking, the allowlist, binary and node_modules/dist
 * skipping, and --diff mode against a temporary git repository.
 *
 * Fake secrets are assembled at runtime from fragments and generated characters, so this file
 * holds no key-shaped literal and the scanner does not flag it (checked below).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, scanFiles, maskValue, loadAllowlist, isPlaceholder, RULE_IDS } from '../../scripts/ci/scan-secrets.mjs';
import { globToRegExp } from '../../scripts/ci/common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'scan-secrets.mjs');

/** Deterministic mixed-case base62 characters (never a run of identical characters). */
function chars(n, seed = 1) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let state = seed;
  let out = '';
  while (out.length < n) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const c = alphabet[(state >>> 16) % 62];
    if (c !== out[out.length - 1]) out += c;
  }
  return out;
}
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const DASHES = '-'.repeat(5);
const pem = (kind) => `${DASHES}BEGIN ${kind}${'PRIVATE'} KEY${DASHES}`;
const pemEnd = (kind) => `${DASHES}END ${kind}${'PRIVATE'} KEY${DASHES}`;
const sep = '/';

const FAKE = {
  google: ['AI', 'za'].join('') + chars(35, 2),
  anthropic: ['sk', 'ant', 'api03'].join('-') + '-' + chars(90, 3),
  openaiProject: ['sk', 'proj'].join('-') + '-' + chars(64, 4),
  openaiLegacy: 'sk' + '-' + chars(48, 5),
  github: 'gh' + 'p_' + chars(36, 6),
  githubPat: 'github' + '_pat_' + chars(22, 7) + '_' + chars(59, 8),
  slack: 'xo' + 'xb-' + '123456789012-' + '9876543210987-' + chars(24, 9),
  serviceJwt: [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ iss: 'supabase', ref: 'demo', role: 'service_role' }), chars(43, 10)].join('.'),
  anonJwt: [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ iss: 'supabase', ref: 'demo', role: 'anon' }), chars(43, 11)].join('.'),
  pemBody: chars(64, 12),
  macHome: [sep + 'Users', 'alice', 'work', 'notes.md'].join(sep),
  volume: [sep + 'Volumes', 'Backup', 'repo'].join(sep),
  linuxHome: [sep + 'home', 'bob', 'project'].join(sep),
  sessionTmp: [sep + 'tmp', 'claude-501', 'x'].join(sep),
};

const rulesOf = (text) => scanText(text).map((f) => f.rule);

/** git without inherited GIT_* variables (tests may run inside a hook). */
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: cleanEnv() });
const gitIn = (cwd, args) => {
  const res = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', env: cleanEnv() });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
};

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-secrets-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
const write = (dir, rel, content) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

describe('scan-secrets rules', () => {
  it('detects each token type', () => {
    assert.deepEqual(rulesOf(`GEMINI_API_KEY="${FAKE.google}"`), ['google-api-key']);
    assert.deepEqual(rulesOf(`ANTHROPIC_API_KEY=${FAKE.anthropic}`), ['anthropic-api-key']);
    assert.deepEqual(rulesOf(`key: '${FAKE.openaiProject}'`), ['openai-api-key']);
    assert.deepEqual(rulesOf(`key: '${FAKE.openaiLegacy}'`), ['openai-api-key']);
    assert.deepEqual(rulesOf(`token ${FAKE.github}`), ['github-token']);
    assert.deepEqual(rulesOf(`token ${FAKE.githubPat}`), ['github-token']);
    assert.deepEqual(rulesOf(`SLACK_TOKEN=${FAKE.slack}`), ['slack-token']);
  });

  it('detects a PEM private key block, also inside a JSON string, but not the header in prose', () => {
    const block = [pem('RSA '), FAKE.pemBody, FAKE.pemBody, pemEnd('RSA ')].join('\n');
    assert.deepEqual(rulesOf(block), ['private-key']);
    assert.deepEqual(rulesOf(`{"private_key": "${pem('')}\\n${FAKE.pemBody}\\n${pemEnd('')}\\n"}`), ['private-key']);
    assert.deepEqual(rulesOf([pem('ENCRYPTED '), 'Proc-Type: 4,ENCRYPTED', '', FAKE.pemBody].join('\n')), ['private-key']);
    assert.deepEqual(rulesOf(`A key file starts with \`${pem('')}\` and must never be committed.`), []);
  });

  it('flags a JWT only when its payload role is service_role', () => {
    assert.deepEqual(rulesOf(`SUPABASE_SERVICE_ROLE_KEY=${FAKE.serviceJwt}`), ['service-role-jwt']);
    assert.deepEqual(rulesOf(`VITE_SUPABASE_ANON_KEY=${FAKE.anonJwt}`), []);
  });

  it('flags absolute personal paths like server/tests/docPaths.test.js, plus any Linux home folder', () => {
    for (const p of [FAKE.macHome, FAKE.volume, FAKE.linuxHome, FAKE.sessionTmp]) {
      assert.deepEqual(rulesOf(`see ${p} for details`), ['absolute-personal-path'], p);
      assert.deepEqual(rulesOf(`"cwd": "${p}"`), ['absolute-personal-path'], p);
    }
    // The rule text itself, URL paths and repo-relative paths are fine.
    assert.deepEqual(rulesOf(`No folders under ${sep}Users or ${sep}Volumes in commits.`), []);
    assert.deepEqual(rulesOf(`https://example.com/news${sep}home${sep}2025/en`), []);
    assert.deepEqual(rulesOf('server/tests/docPaths.test.js and ~/project'), []);
    // docPaths.test.js forbids the sandbox home anywhere, even mid-URL; so does the scanner.
    assert.deepEqual(rulesOf(`https://example.com/x${[sep + 'home', 'user', 'repo'].join(sep)}`), ['absolute-personal-path']);
  });

  it('ignores prose, short test values and placeholders', () => {
    const prose = [
      'Install sk-learn, then read the sk- prefix docs.',
      `ANTHROPIC_API_KEY='${['sk', 'ant'].join('-')}-test'`,
      `export GEMINI_API_KEY="${['AI', 'za'].join('')}Sy..."`,
      `GEMINI_API_KEY=${['AI', 'za'].join('')}${'X'.repeat(35)}`,
      `OPENAI_API_KEY=${['sk', 'proj'].join('-')}-your_key_${chars(30, 13)}`,
      'xo' + 'xb-your-token-here',
      `the prefixes ${'gh'}p_ and ${'xo'}xb- identify tokens`,
    ].join('\n');
    assert.deepEqual(scanText(prose), []);
    assert.equal(isPlaceholder('X'.repeat(35)), true);
    assert.equal(isPlaceholder(chars(35, 14)), false);
  });

  it('reports 1-based line numbers', () => {
    const findings = scanText(`one\ntwo\nkey=${FAKE.github}\n\n${FAKE.macHome}\n`);
    assert.deepEqual(findings.map((f) => [f.line, f.rule]), [[3, 'github-token'], [5, 'absolute-personal-path']]);
  });

  it('every rule id is covered by these tests', () => {
    assert.deepEqual([...RULE_IDS].sort(), ['absolute-personal-path', 'anthropic-api-key', 'github-token', 'google-api-key',
      'openai-api-key', 'private-key', 'service-role-jwt', 'slack-token']);
  });
});

describe('scan-secrets masking', () => {
  it('never returns the secret, only a prefix and the length', () => {
    const secrets = [FAKE.google, FAKE.anthropic, FAKE.openaiProject, FAKE.openaiLegacy, FAKE.github, FAKE.githubPat, FAKE.slack, FAKE.serviceJwt];
    for (const secret of secrets) {
      const [finding] = scanText(`value=${secret}`);
      assert.ok(finding, secret.slice(0, 4));
      // Only the public type prefix (at most 8 characters) is shown before the asterisks.
      const visible = finding.masked.slice(0, finding.masked.indexOf('*'));
      assert.ok(secret.startsWith(visible) && visible.length <= 8, `${finding.rule}: shows only "${visible}"`);
      assert.ok(!finding.masked.includes(secret.slice(-12)), `${finding.rule}: masked value hides the secret part`);
      assert.match(finding.masked, new RegExp(`\\(${secret.length} chars\\)`));
    }
    const [key] = scanText([pem(''), FAKE.pemBody].join('\n'));
    assert.ok(!key.masked.includes(FAKE.pemBody.slice(0, 16)));
    for (const [p, name] of [[FAKE.macHome, 'alice'], [FAKE.volume, 'Backup'], [FAKE.linuxHome, 'bob'], [FAKE.sessionTmp, '501']]) {
      const [home] = scanText(p);
      assert.ok(!home.masked.includes(name), `${home.masked} hides the folder name`);
    }
    assert.equal(maskValue('abcdefgh', 6), 'abcd******** (8 chars)', 'at least 4 characters are always hidden');
  });

  it('the CLI prints file:line, rule and the masked value, and exits 1', () => {
    write(tmp, 'mask/config.js', `export const key = '${FAKE.anthropic}';\n`);
    const res = run(['mask/config.js'], tmp);
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stdout, /^mask\/config\.js:1: \[anthropic-api-key\] sk-ant-\*{8} \(\d+ chars\)$/m);
    assert.ok(!res.stdout.includes(FAKE.anthropic.slice(7)), 'stdout never holds the key');
    const gh = run(['--format', 'github', 'mask/config.js'], tmp);
    assert.match(gh.stdout, /^::error file=mask\/config\.js,line=1,title=scan-secrets anthropic-api-key::anthropic-api-key: sk-ant-\*{8}/m);
    assert.ok(!gh.stdout.includes(FAKE.anthropic.slice(7)));
  });

  it('exits 0 on clean files and 2 on usage errors', () => {
    write(tmp, 'clean/readme.md', '# Clean\nNothing secret here.\n');
    assert.equal(run(['clean/readme.md'], tmp).status, 0);
    assert.equal(run([], tmp).status, 2, 'no input mode');
    assert.equal(run(['--all', 'clean/readme.md'], tmp).status, 2, 'two input modes');
    assert.equal(run(['--bogus', 'clean/readme.md'], tmp).status, 2);
    assert.equal(run(['clean/missing.md'], tmp).status, 2);
  });
});

describe('scan-secrets allowlist', () => {
  it('suppresses a finding by path glob and rule, and nothing else', () => {
    write(tmp, 'allow/fixtures/sample.txt', `${FAKE.linuxHome}\n${FAKE.github}\n`);
    write(tmp, 'allow/other.txt', `${FAKE.linuxHome}\n`);
    write(tmp, 'allow/list.json', JSON.stringify({ entries: [
      { path: 'allow/fixtures/**', rule: 'absolute-personal-path', reason: 'Sample paths from upstream documentation.' },
    ] }));
    const res = run(['--allow', 'allow/list.json', 'allow/fixtures/sample.txt', 'allow/other.txt'], tmp);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /allow\/fixtures\/sample\.txt:2: \[github-token\]/, 'other rules in the same file still count');
    assert.match(res.stdout, /allow\/other\.txt:1: \[absolute-personal-path\]/, 'other paths still count');
    assert.doesNotMatch(res.stdout, /sample\.txt:1:/);
    assert.match(res.stdout, /1 allowlisted/);
  });

  it('a "*" rule covers every rule for the path', () => {
    write(tmp, 'allow/star.json', JSON.stringify({ entries: [{ path: 'allow/fixtures/*.txt', rule: '*', reason: 'Fixture file for the scanner.' }] }));
    assert.equal(run(['--allow', 'allow/star.json', 'allow/fixtures/sample.txt'], tmp).status, 0);
  });

  it('rejects malformed entries (exit 2)', () => {
    const bad = [
      { entries: [{ path: 'x', rule: 'no-such-rule', reason: 'Some long reason.' }] },
      { entries: [{ path: 'x', rule: '*' }] },
      { entries: [{ rule: '*', reason: 'Some long reason.' }] },
      { list: [] },
    ];
    for (const [i, data] of bad.entries()) {
      write(tmp, `allow/bad${i}.json`, JSON.stringify(data));
      const res = run(['--allow', `allow/bad${i}.json`, 'clean/readme.md'], tmp);
      assert.equal(res.status, 2, JSON.stringify(data));
      assert.match(res.stderr, /allowlist/);
    }
    write(tmp, 'allow/broken.json', '{ "entries": [');
    assert.throws(() => loadAllowlist(path.join(tmp, 'allow/broken.json')), /not valid JSON/);
  });

  it('globs: ** spans folders, * stays within one', () => {
    assert.ok(globToRegExp('docs/**/*.md').test('docs/a/b/c.md'));
    assert.ok(globToRegExp('docs/**/*.md').test('docs/c.md'));
    assert.ok(!globToRegExp('docs/*.md').test('docs/a/c.md'));
    assert.ok(!globToRegExp('docs/*.md').test('docsXc.md'));
    assert.ok(globToRegExp('a?c.(1).txt').test('abc.(1).txt'));
  });

  it('the repository allowlist is valid and every entry has a reason', () => {
    const entries = loadAllowlist(path.join(ROOT, 'scripts', 'ci', 'scan-secrets.allow.json'));
    for (const e of entries) assert.ok(e.reason.length >= 10);
  });
});

describe('scan-secrets skipping', () => {
  it('skips binary files and node_modules/ or dist/ folders', () => {
    write(tmp, 'skip/image.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), Buffer.from(FAKE.github)]));
    write(tmp, 'skip/node_modules/pkg/index.js', `module.exports = '${FAKE.github}';\n`);
    write(tmp, 'skip/dist/assets/app.js', `const k='${FAKE.github}';\n`);
    const res = run(['skip/image.png', 'skip/node_modules/pkg/index.js', 'skip/dist/assets/app.js'], tmp);
    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /no findings in 0 text file/);
    const direct = scanFiles(['skip/image.png'], { root: tmp });
    assert.equal(direct.scanned, 0);
  });
});

describe('scan-secrets --diff', () => {
  it('scans only files added or changed since the merge base, including uncommitted ones', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    gitIn(repo, ['init', '-q', '-b', 'main']);
    write(repo, 'old.txt', `${FAKE.github}\n`); // already on main: not part of the diff
    write(repo, 'keep.txt', 'unchanged\n');
    gitIn(repo, ['add', '.']);
    gitIn(repo, ['commit', '-q', '--no-verify', '-m', 'base']);
    gitIn(repo, ['checkout', '-q', '-b', 'feature']);

    write(repo, 'clean.md', 'nothing here\n');
    gitIn(repo, ['add', '.']);
    gitIn(repo, ['commit', '-q', '--no-verify', '-m', 'clean change']);
    let res = run(['--diff', 'main'], repo);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /no findings in 1 text file/);

    write(repo, 'added.js', `const key = '${FAKE.google}';\n`);
    gitIn(repo, ['add', '.']);
    gitIn(repo, ['commit', '-q', '--no-verify', '-m', 'add key']);
    write(repo, 'keep.txt', `unchanged\n${FAKE.macHome}\n`); // uncommitted edit
    write(repo, 'untracked.cfg', `${FAKE.slack}\n`); // untracked file
    res = run(['--diff', 'main'], repo);
    assert.equal(res.status, 1);
    const files = res.stdout.split('\n').filter((l) => /^\S+:\d+: \[/.test(l)).map((l) => l.split(':')[0]).sort();
    assert.deepEqual(files, ['added.js', 'keep.txt', 'untracked.cfg']);
    assert.doesNotMatch(res.stdout, /old\.txt/);

    // A deleted file is not scanned; an unknown base is a usage error.
    fs.rmSync(path.join(repo, 'untracked.cfg'));
    gitIn(repo, ['rm', '-q', 'added.js']);
    res = run(['--diff', 'main'], repo);
    assert.deepEqual(res.stdout.split('\n').filter((l) => /^\S+:\d+: \[/.test(l)).map((l) => l.split(':')[0]), ['keep.txt']);
    const bad = run(['--diff', 'no-such-ref'], repo);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /cannot diff against "no-such-ref"/);
  });
});

describe('scan-secrets on its own files', () => {
  it('the scanner, its helpers and the CI guard tests hold nothing it would flag', () => {
    const own = ['scripts/ci/scan-secrets.mjs', 'scripts/ci/check-assets.mjs', 'scripts/ci/common.mjs', 'scripts/ci/scan-secrets.allow.json',
      'server/tests/scanSecrets.test.js', 'server/tests/checkAssets.test.js', 'server/tests/architectureBoundaries.test.js', 'assets/credits.json'];
    const { findings, scanned } = scanFiles(own, { root: ROOT });
    assert.equal(scanned, own.length);
    assert.deepEqual(findings, []);
  });
});
