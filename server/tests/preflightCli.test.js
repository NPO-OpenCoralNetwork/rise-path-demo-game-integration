// @ts-check
// 事前チェック (preflight) CLI and VM wrapper (Phase 9, owner decision D2): scripts/deploy/preflight-vm.mjs,
// deploy/risepath-vm/scripts/preflight.sh and check-mode.sh. The design's tests T2c (the CLI never prints
// a value, over every T2a fixture, both modes, every stage), T7 (the CLI's exit codes), T8 (the wrapper
// end to end without Docker: a docker shim runs the CLI with the local node; the facts JSON; the root
// refusal), T9 (scripts/deploy imports only built-ins and its siblings: the container mounts that folder
// alone) and the check-mode.sh cases (each of the four CI conditions alone selects prod).
// Static pins on the wrapper (T11): vmStackConfig.test.js.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { INTERNAL_CODES, PROFILE_NAMES, STAGES, validateFacts } from '../../scripts/deploy/preflight-rules.mjs';
import { DAY, FIXTURES, baseFacts, baseRecord, buildFiles, buildInput, sentinel } from './helpers/preflightFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STACK = path.join(ROOT, 'deploy/risepath-vm');
const CLI = path.join(ROOT, 'scripts/deploy/preflight-vm.mjs');
const read = (/** @type {string} */ file) => fs.readFileSync(file, 'utf8');
const TEMPLATE = read(path.join(STACK, 'ci/stack.ci.env'));
const bash4 = spawnSync('bash', ['-c', 'x=A; : "${x,,}"']).status === 0;
const skipBash = bash4 ? false : 'needs bash ≥ 4';

/**
 * Writes a stack folder: the given files (env files 0600), the CI template, an optional deploy record.
 * @param {string} dir
 * @param {Record<string, string>} files
 * @param {{ stackMode?: number, lastGreen?: object | null }} [opts]
 */
function writeStack(dir, files, opts = {}) {
  fs.mkdirSync(path.join(dir, 'ci'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ci/stack.ci.env'), TEMPLATE);
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text, { mode: 0o600 });
    fs.chmodSync(path.join(dir, name), name === 'stack.env' && opts.stackMode !== undefined ? opts.stackMode & 0o777 : name === 'launch-record.env' ? 0o644 : 0o600);
  }
  if (opts.lastGreen) {
    fs.mkdirSync(path.join(dir, '.deploy'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.deploy/last-green.json'), JSON.stringify(opts.lastGreen));
  }
}

/**
 * Runs the CLI as a process.
 * @param {string[]} args
 * @param {string} input
 * @param {{ uid?: number, gid?: number }} [as] another user (only when this test runs as root)
 * @param {string} [cli] the CLI's path (a copy another user can read)
 * @returns {Promise<{ status: number | null, out: string }>}
 */
function runCliProcess(args, input, as = {}, cli = CLI) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'pipe', 'pipe'], ...as });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (status) => resolve({ status, out }));
    child.stdin.end(input);
  });
}

describe('T7: the CLI exits 0, 1, 2 or 3', () => {
  // Made and removed by hooks, which run only when a test of this suite runs (--test-name-pattern).
  let dir = '';
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-cli-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const facts = JSON.stringify({ ...baseFacts(), pgdataVolume: false });
  it('0: the CI template in CI mode (the CI banner first); 1: the VM template in prod mode', async () => {
    writeStack(path.join(dir, 'ci0'), { 'stack.env': TEMPLATE });
    const ci = await runCliProcess(['--stack', path.join(dir, 'ci0'), '--mode', 'ci'], facts);
    assert.equal(ci.status, 0, ci.out);
    assert.equal(ci.out.split('\n')[0], '（CI モード: 本番だけの決まりを飛ばしています）');
    writeStack(path.join(dir, 'vm1'), { 'stack.env': read(path.join(STACK, 'stack.env.example')) });
    const vm = await runCliProcess(['--stack', path.join(dir, 'vm1'), '--mode', 'prod'], facts);
    assert.equal(vm.status, 1, vm.out);
    assert.match(vm.out, /^❌ \[B1\] /m);
    assert.match(vm.out, /^==> 事前チェック: エラー 2 件、/m);
  });
  it('2: X3 for CI mode with a stack.env that is not the template (one byte differs)', async () => {
    writeStack(path.join(dir, 'x3'), { 'stack.env': `${TEMPLATE}# extra\n` });
    const r = await runCliProcess(['--stack', path.join(dir, 'x3'), '--mode', 'ci'], facts);
    assert.equal(r.status, 2);
    assert.match(r.out, /^❌ \[X3\] /m);
    const prod = await runCliProcess(['--stack', path.join(dir, 'x3'), '--mode', 'prod'], facts);
    assert.notEqual(prod.status, 2, 'the same folder in prod mode is checked');
  });
  it('2: X4 for bad facts JSON, a missing or unknown fact, and bad arguments', async () => {
    writeStack(path.join(dir, 'x4'), { 'stack.env': TEMPLATE });
    const stack = path.join(dir, 'x4');
    const bad = [
      [['--stack', stack, '--mode', 'prod'], '{not json'],
      [['--stack', stack, '--mode', 'prod'], JSON.stringify({ ...baseFacts(), uid: 'root' })],
      [['--stack', stack, '--mode', 'prod'], JSON.stringify({ ...baseFacts(), more: true })],
      [['--stack', stack, '--mode', 'prod'], ''],
      [['--stack', stack], facts],
      [['--stack', stack, '--mode', 'public'], facts],
      [['--stack', stack, '--mode', 'prod', '--stage', 'public'], facts],
      [['--stack', stack, '--mode', 'prod', '--mode', 'ci'], facts],
      [['--mode', 'prod'], facts],
    ];
    for (const [args, input] of bad) {
      const r = await runCliProcess(/** @type {string[]} */ (args), /** @type {string} */ (input));
      assert.equal(r.status, 2, `${JSON.stringify(args)} ${String(input).slice(0, 20)}`);
      assert.match(r.out, /^❌ \[X4\] /m);
    }
  });
  it('3: X0 for an exception inside the check, printed without its message', async () => {
    const stack = path.join(dir, 'x0');
    writeStack(stack, {});
    fs.mkdirSync(path.join(stack, 'stack.env'));
    const r = await runCliProcess(['--stack', stack, '--mode', 'prod'], facts);
    assert.equal(r.status, 3);
    assert.match(r.out, /^❌ \[X0\] /m);
    assert.ok(!/EISDIR|Error|at /.test(r.out), r.out);
  });
});

// Review round 1, findings 1, 5, 6, 9 and 13: what the CLI reads from the stack folder (the record, the
// files' mode and owner, the stack.env hash against .deploy/last-green.json, a damaged deploy record,
// a file it cannot read, CI mode's template markers), each through a real CLI process. The CLI reads
// the real clock, so these records are dated in the past and the backup facts are fresh now.
describe('T7: what the CLI reads from the stack folder (real processes, real clock)', () => {
  const PAST = '2026-01-05';
  const asRoot = process.getuid?.() === 0;
  // As root every file is readable, so the "cannot read" cases run the CLI as another user.
  const runUid = asRoot ? 1000 : /** @type {number} */ (process.getuid?.() ?? 1000);
  const as = asRoot ? { uid: runUid, gid: runUid } : {};
  let dir = '';
  let cli = CLI;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-cli-'));
    fs.chmodSync(dir, 0o755);
    if (asRoot) {
      // The other user may not reach the checkout: it runs a copy of scripts/deploy from this folder.
      fs.mkdirSync(path.join(dir, 'cli'));
      for (const f of fs.readdirSync(path.dirname(CLI)).filter((name) => name.endsWith('.mjs'))) fs.copyFileSync(path.join(path.dirname(CLI), f), path.join(dir, 'cli', f));
      cli = path.join(dir, 'cli', path.basename(CLI));
    }
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  /**
   * A stack folder clean at a stage against the real clock, with a change; the facts as the CLI's user.
   * @param {string} name
   * @param {string} stage
   * @param {import('./helpers/preflightFixtures.js').Mod} [mod]
   */
  const stackAt = (name, stage, mod = {}) => {
    const record = Object.fromEntries(Object.entries(baseRecord(stage)).map(([k, v]) => [k, v === DAY ? PAST : v]));
    const files = buildFiles(stage, { ...mod, record: mod.record === null ? null : { ...record, ...mod.record } });
    const stack = path.join(dir, name);
    writeStack(stack, files, { stackMode: mod.stackMode });
    if (asRoot) for (const f of Object.keys(files)) fs.chownSync(path.join(stack, f), runUid, runUid);
    const now = Date.now();
    const facts = { ...baseFacts(), uid: runUid, gid: runUid, backupLastOk: new Date(now - 3600_000).toISOString(), drillLastOk: new Date(now - 2 * 86400_000).toISOString(), ...mod.facts };
    return { stack, input: JSON.stringify(facts) };
  };
  /** @param {{ stack: string, input: string }} folder @param {'prod' | 'ci'} [mode] */
  const run = ({ stack, input }, mode = 'prod') => runCliProcess(['--stack', stack, '--mode', mode], input, as, cli);
  /** The codes a run printed, with their marks. @param {string} out */
  const printed = (out) => [...out.matchAll(/^(❌|⚠️|ℹ️) \[([A-Z]\d+)\]/gm)].map((m) => `${m[1]} ${m[2]}`);

  it('a clean pilot stack: the stage from the record, no finding, exit 0', async () => {
    const r = await run(stackAt('clean', 'pilot'));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^==> 事前チェック（preflight\.sh）: 本番の決まり \/ 公開の段階 pilot（launch-record\.env から）$/m);
    assert.deepEqual(printed(r.out), []);
  });
  it('(a) the record is read: pilot with BACKUP_LIFECYCLE empty is ❌ [R5], exit 1', async () => {
    const r = await run(stackAt('r5', 'pilot', { record: { BACKUP_LIFECYCLE: '' } }));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /公開の段階 pilot（launch-record\.env から）/);
    assert.deepEqual(printed(r.out), ['❌ R5']);
  });
  it('(finding 1) a stage with an IME space after it is ❌ [A11] and stops, never a silent setup', async () => {
    for (const [i, value] of ['pilot\u3000', '"pilot "', 'pilot\u00a0'].entries()) {
      const r = await run(stackAt(`a11-${i}`, 'pilot', { record: { LAUNCH_STAGE: value, BACKUP_LIFECYCLE: '' } }));
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /公開の段階 setup（launch-record\.env の LAUNCH_STAGE が読めないので/);
      assert.match(r.out, /^❌ \[A11\] launch-record\.env の LAUNCH_STAGE が読めません/m);
    }
  });
  it('(review 2, finding 1) a protection-off date written after a space or a tab is read: ❌ [V1] at pilot', async () => {
    for (const [i, value] of [PAST, ` ${PAST}`, `\t${PAST}`].entries()) {
      const r = await run(stackAt(`v1-${i}`, 'pilot', { record: { VERCEL_PROTECTION_OFF: value } }));
      assert.equal(r.status, 1, r.out);
      assert.deepEqual(printed(r.out), ['❌ V1'], JSON.stringify(value));
    }
  });
  it('(b) the mode and owner are read: stack.env 0644 is ⚠️ [A7]; 0600 is not', async () => {
    const loose = await run(stackAt('a7', 'pilot', { stackMode: 0o644 }));
    assert.equal(loose.status, 0, loose.out);
    assert.deepEqual(printed(loose.out), ['⚠️ A7']);
    assert.match(loose.out, /^⚠️ \[A7\] stack\.env の権限が 600 でないか、持ち主がちがいます。$/m);
    const tight = await run(stackAt('a7ok', 'pilot', { stackMode: 0o600 }));
    assert.deepEqual(printed(tight.out), []);
  });
  it('(c) a damaged .deploy/last-green.json still counts as a green deploy: no record, tts only → ❌ [A13] (⚠️ without it)', async () => {
    const without = stackAt('a13w', 'setup', { record: null, stack: { COMPOSE_PROFILES: 'tts', TRUST_PROXY: null } });
    assert.ok((await run(without)).out.includes('⚠️ [A13]'));
    const damaged = stackAt('a13e', 'setup', { record: null, stack: { COMPOSE_PROFILES: 'tts', TRUST_PROXY: null } });
    fs.mkdirSync(path.join(damaged.stack, '.deploy'));
    fs.writeFileSync(path.join(damaged.stack, '.deploy/last-green.json'), '{broken');
    const r = await run(damaged);
    assert.equal(r.status, 1, r.out);
    assert.ok(printed(r.out).includes('❌ A13'), r.out);
  });
  it('(d) the stack.env hash is read: equal to last-green\'s → no F5; one byte appended → ⚠️ [F5]', async () => {
    const s = stackAt('f5', 'pilot');
    const file = path.join(s.stack, 'stack.env');
    fs.mkdirSync(path.join(s.stack, '.deploy'));
    fs.writeFileSync(path.join(s.stack, '.deploy/last-green.json'), JSON.stringify({ at: '2026-10-01T00:00:00Z', commit: 'abc', stackEnvSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
    const same = await run(s);
    assert.equal(same.status, 0, same.out);
    assert.deepEqual(printed(same.out), []);
    fs.appendFileSync(file, '\n');
    const changed = await run(s);
    assert.deepEqual(printed(changed.out), ['⚠️ F5']);
  });
  // Review round 3, finding 6: a hash that is not 64 lower-case hex characters is a damaged record: no F5 (nothing
  // to compare), and it still counts as a green deploy (A13 E without a record, tts only).
  it('(d2) a last-green.json whose stackEnvSha256 is not 64 lower-case hex: no F5, still a green deploy for A13', async () => {
    for (const [i, hash] of ['x', 'A'.repeat(64), 'a'.repeat(63), 7].entries()) {
      const s = stackAt(`f5-shape-${i}`, 'pilot');
      fs.mkdirSync(path.join(s.stack, '.deploy'));
      fs.writeFileSync(path.join(s.stack, '.deploy/last-green.json'), JSON.stringify({ at: '2026-10-01T00:00:00Z', commit: 'abc', stackEnvSha256: hash }));
      const r = await run(s);
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(printed(r.out), [], JSON.stringify(hash));
    }
    const noRecord = stackAt('f5-shape-a13', 'setup', { record: null, stack: { COMPOSE_PROFILES: 'tts', TRUST_PROXY: null } });
    fs.mkdirSync(path.join(noRecord.stack, '.deploy'));
    fs.writeFileSync(path.join(noRecord.stack, '.deploy/last-green.json'), JSON.stringify({ stackEnvSha256: 'x' }));
    const r = await run(noRecord);
    assert.equal(r.status, 1, r.out);
    assert.ok(printed(r.out).includes('❌ A13') && !printed(r.out).includes('⚠️ F5'), r.out);
  });
  // Review round 3, finding 3: a deploy record the deploy user cannot read (the file, or its .deploy folder) is
  // ❌ [A15] by name, never X0 or a silent "no green deploy" (A13 stays an error).
  it('(review 3, finding 3) an unreadable .deploy/last-green.json or .deploy folder: ❌ [A15], and ❌ [A13] without a record', async () => {
    for (const what of ['file', 'folder']) {
      const s = stackAt(`a15-${what}`, 'setup', { record: null, stack: { COMPOSE_PROFILES: 'tts', TRUST_PROXY: null } });
      const deployDir = path.join(s.stack, '.deploy');
      fs.mkdirSync(deployDir);
      fs.writeFileSync(path.join(deployDir, 'last-green.json'), JSON.stringify({ stackEnvSha256: 'a'.repeat(64) }), { mode: 0o600 });
      const locked = what === 'file' ? path.join(deployDir, 'last-green.json') : deployDir;
      // As root the CLI runs as another user and the root-owned 0600 file or 0700 folder is closed to it.
      fs.chmodSync(locked, asRoot ? (what === 'file' ? 0o600 : 0o700) : 0o000);
      try {
        const r = await run(s);
        assert.equal(r.status, 1, r.out);
        assert.ok(!r.out.includes('[X0]'), r.out);
        assert.deepEqual(printed(r.out).filter((c) => /A1[35]$/.test(c)), ['❌ A13', '❌ A15'], `${what}: ${r.out}`);
        assert.match(r.out, /^❌ \[A15\] 最後に通ったデプロイの記録（\.deploy\/last-green\.json）が読めません。$/m);
      } finally {
        fs.chmodSync(locked, 0o755);
      }
    }
  });
  // Review round 3, finding 1, as the reviewer ran it: a dated VERCEL_PROTECTION_OFF typed above the template's empty line.
  it('(review 3, finding 1) a dated VERCEL_PROTECTION_OFF above the template\'s empty line: ❌ [A4], exit 1', async () => {
    const s = stackAt('a4-record', 'pilot', { record: { VERCEL_PROTECTION_OFF: null }, recordExtra: `VERCEL_PROTECTION_OFF=${PAST}\nVERCEL_PROTECTION_OFF=\n` });
    const r = await run(s);
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(printed(r.out), ['❌ A4']);
    assert.match(r.out, /^❌ \[A4\] launch-record\.env に同じ名前が 2 回あります（VERCEL_PROTECTION_OFF）$/m);
  });
  it('(finding 13) a file the CLI cannot read is ❌ [A7] by its name, not X0; an unreadable record is not A13', async () => {
    const lock = (/** @type {string} */ file) => {
      if (asRoot) fs.chownSync(file, 0, 0);
      fs.chmodSync(file, asRoot ? 0o600 : 0o000);
    };
    const s = stackAt('unreadable-stack', 'pilot');
    lock(path.join(s.stack, 'stack.env'));
    const r = await run(s);
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(printed(r.out), ['❌ A7']);
    assert.match(r.out, /^❌ \[A7\] stack\.env の権限が 600 でないか、持ち主がちがいます。$/m);
    const rec = stackAt('unreadable-record', 'pilot');
    lock(path.join(rec.stack, 'launch-record.env'));
    const r2 = await run(rec);
    assert.equal(r2.status, 1, r2.out);
    assert.match(r2.out, /^❌ \[A7\] launch-record\.env の権限が/m);
    assert.ok(!/\[A13\]|\[X0\]/.test(r2.out), r2.out);
    // Review round 2, finding 8: the header says the record cannot be read, not that it is missing.
    assert.match(r2.out, /^==> 事前チェック（preflight\.sh）: 本番の決まり \/ 公開の段階 setup（launch-record\.env が読めないので、setup として確かめます）$/m);
    assert.ok(!r2.out.includes('launch-record.env がないので'), r2.out);
  });
  it('(finding 5) CI mode with the template edited in the checkout to equal a real stack.env: X3, exit 2', async () => {
    const s = stackAt('x3-edited', 'pilot');
    fs.copyFileSync(path.join(s.stack, 'stack.env'), path.join(s.stack, 'ci/stack.ci.env'));
    const r = await run(s, 'ci');
    assert.equal(r.status, 2, r.out);
    assert.deepEqual(printed(r.out), ['❌ X3']);
    assert.ok(!r.out.includes('（CI モード: 本番だけの決まりを飛ばしています）'), 'no CI banner');
  });
});

describe('T2c: the CLI never prints a value (every T2a fixture, both modes, every stage)', () => {
  it('stdout and stderr never hold the sentinel', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-sweep-'));
    try {
      /** @type {{ args: string[], input: string, S: string, label: string }[]} */
      const runs = [];
      let n = 0;
      for (const fixture of FIXTURES) {
        const S = sentinel();
        for (const stage of STAGES) {
          const mod = fixture.hit(S);
          const stack = path.join(dir, String(n++));
          const input = buildInput(stage, mod);
          writeStack(stack, buildFiles(stage, mod), { stackMode: mod.stackMode, lastGreen: input.lastGreen });
          for (const mode of ['prod', 'ci']) runs.push({ args: ['--stack', stack, '--mode', mode], input: JSON.stringify(input.facts), S, label: `${fixture.code} ${stage} ${mode}` });
        }
      }
      for (let i = 0; i < runs.length; i += 24) {
        const batch = runs.slice(i, i + 24);
        const results = await Promise.all(batch.map((r) => runCliProcess(r.args, r.input)));
        results.forEach((result, j) => {
          const { S, label } = batch[j];
          assert.ok([0, 1, 2].includes(/** @type {number} */ (result.status)), `${label}: ${result.out}`);
          assert.ok(!result.out.includes(S) && !result.out.toLowerCase().includes(S.toLowerCase()), `${label} printed the sentinel`);
        });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('T9: scripts/deploy imports only node: built-ins and its siblings (the container mounts that folder alone)', () => {
  const dir = path.join(ROOT, 'scripts/deploy');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  it('has the three preflight modules and the 事後の確かめ\'s probe', () => {
    for (const f of ['env-parse.mjs', 'preflight-rules.mjs', 'preflight-vm.mjs', 'postdeploy-probe.mjs']) assert.ok(files.includes(f), f);
  });
  for (const file of files) {
    it(`${file}`, () => {
      const { importedFiles } = ts.preProcessFile(read(path.join(dir, file)), true, true);
      // env-parse.mjs and backup-codes.mjs (a catalog the bash scripts print; Phase 9 stage 5) import nothing.
      assert.ok(importedFiles.length > 0 || file === 'env-parse.mjs' || file === 'backup-codes.mjs');
      for (const { fileName } of importedFiles) {
        const sibling = /^\.\/([\w.-]+\.mjs)$/.exec(fileName);
        assert.ok(fileName.startsWith('node:') || (sibling && files.includes(sibling[1])), `${file} imports ${fileName}`);
      }
      assert.match(read(path.join(dir, file)), /^(?:#!.*\n)?\/\/ @ts-check\n/, `${file}: // @ts-check`);
    });
  }
});

describe('check-mode.sh: CI mode only with all four conditions', { skip: skipBash }, () => {
  let dir = '';
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-mode-'));
    writeStack(path.join(dir, 'tpl'), { 'stack.env': TEMPLATE });
    writeStack(path.join(dir, 'vm'), { 'stack.env': `${TEMPLATE}LLM_GUEST_AI=true\n` });
    writeStack(path.join(dir, 'none'), {});
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  /** @param {string} fromDeploy @param {string} skip @param {string} project @param {string} stack */
  const mode = (fromDeploy, skip, project, stack) => spawnSync('bash', ['-c', 'set -euo pipefail; source "$1"; risepath_check_mode "$2" "$3" "$4" "$5"', '_',
    path.join(STACK, 'scripts/check-mode.sh'), fromDeploy, skip, project, path.join(dir, stack)], { encoding: 'utf8' }).stdout.trim();
  it('ci with --from-deploy, skip-pull 1, project risepath-ci and the template byte for byte', () => {
    assert.equal(mode('1', '1', 'risepath-ci', 'tpl'), 'ci');
  });
  it('each condition alone missing selects prod', () => {
    assert.equal(mode('0', '1', 'risepath-ci', 'tpl'), 'prod', 'not from the deploy');
    assert.equal(mode('1', '', 'risepath-ci', 'tpl'), 'prod', 'skip-pull unset');
    assert.equal(mode('1', 'true', 'risepath-ci', 'tpl'), 'prod', 'skip-pull not exactly 1');
    assert.equal(mode('1', '1', 'risepath', 'tpl'), 'prod', 'the VM project');
    assert.equal(mode('1', '1', '', 'tpl'), 'prod', 'no project');
    assert.equal(mode('1', '1', 'risepath-ci', 'vm'), 'prod', 'stack.env is not the template');
    assert.equal(mode('1', '1', 'risepath-ci', 'none'), 'prod', 'no stack.env');
  });
});

describe('T8: preflight.sh end to end without Docker (a docker shim runs the CLI with this node)', { skip: skipBash }, () => {
  /**
   * A copy of the checkout's parts the wrapper uses: deploy/risepath-vm/{Dockerfile, scripts/preflight.sh,
   * scripts/check-mode.sh} and scripts/deploy/*.mjs, with the backup paths moved into the temp folder.
   * docker and id are shims; `run` maps each --mount src→dst onto the CLI's arguments and runs it here.
   * @param {{ files?: Record<string, string>, args?: string[], env?: Record<string, string>, uid?: string,
   *   dockerfile?: string | null, imageMissing?: boolean, pullFails?: boolean, runStatus?: number, status?: string,
   *   backupFiles?: boolean, units?: Record<string, string>, active?: string[], restoreMark?: boolean, cwd?: string }} [opts]
   */
  function runWrapper(opts = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-sh-'));
    try {
      const stack = path.join(dir, 'repo/deploy/risepath-vm');
      fs.mkdirSync(path.join(stack, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'repo/scripts/deploy'), { recursive: true });
      for (const f of fs.readdirSync(path.join(ROOT, 'scripts/deploy'))) fs.copyFileSync(path.join(ROOT, 'scripts/deploy', f), path.join(dir, 'repo/scripts/deploy', f));
      if (opts.dockerfile !== null) fs.writeFileSync(path.join(stack, 'Dockerfile'), opts.dockerfile ?? read(path.join(STACK, 'Dockerfile')));
      const etc = path.join(dir, 'etc-backup');
      const status = path.join(dir, 'status.json');
      fs.mkdirSync(etc);
      if (opts.backupFiles) for (const f of ['backup.key', 'backup.env']) fs.writeFileSync(path.join(etc, f), 'x', { mode: 0o600 });
      if (opts.status !== undefined) fs.writeFileSync(status, opts.status);
      // restore-db.sh's marker sits beside the status file (preflight.sh BACKUP_RESTORE).
      if (opts.restoreMark) fs.writeFileSync(path.join(dir, 'restore-in-progress'), 'started=2026-11-20T01:02:03Z\nstack=enabled\ndbChanged=1\n');
      const script = read(path.join(STACK, 'scripts/preflight.sh'))
        .replace(/^BACKUP_ETC=.*$/m, `BACKUP_ETC=${etc}`)
        .replace(/^BACKUP_STATUS=.*$/m, `BACKUP_STATUS=${status}`);
      assert.ok(script.includes(`BACKUP_ETC=${etc}`) && script.includes(`BACKUP_STATUS=${status}`), 'the two path lines exist');
      fs.writeFileSync(path.join(stack, 'scripts/preflight.sh'), script, { mode: 0o755 });
      fs.copyFileSync(path.join(STACK, 'scripts/check-mode.sh'), path.join(stack, 'scripts/check-mode.sh'));
      writeStack(stack, opts.files ?? { 'stack.env': read(path.join(STACK, 'stack.env.example')) });
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      // The docker shim is a CommonJS node script, whatever package.json is above the temp folder.
      fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}\n');
      const log = path.join(dir, 'calls.log');
      const factsFile = path.join(dir, 'facts.json');
      fs.writeFileSync(log, '');
      fs.writeFileSync(path.join(bin, 'id'), `#!/usr/bin/env bash\necho "id $*" >> "${log}"\necho ${opts.uid ?? '1000'}\n`, { mode: 0o755 });
      // systemctl is-enabled <unit>: the state of opts.units, else nothing and exit 1 (no such unit). systemctl
      // is-active <unit>: active for the units in opts.active, else inactive and exit 3.
      const units = Object.entries(opts.units ?? {}).map(([unit, state]) => `  ${unit}) echo ${state} ;;`).join('\n');
      const active = (opts.active ?? []).map((unit) => `  ${unit}) echo active; exit 0 ;;`).join('\n');
      fs.writeFileSync(path.join(bin, 'systemctl'), `#!/usr/bin/env bash\nif [[ "$1" == is-active ]]; then\n  case "$2" in\n${active}\n  *) echo inactive; exit 3 ;;\n  esac\nfi\ncase "$2" in\n${units}\n  *) exit 1 ;;\nesac\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, 'docker ' + JSON.stringify(args) + '\\n');
const out = (s) => process.stdout.write(s);
switch (args[0]) {
  case 'image': process.exit(${opts.imageMissing ? 1 : 0});
  case 'pull': process.exit(${opts.pullFails ? 1 : 0});
  case 'info': out('/\\n'); process.exit(0);
  case 'volume': process.exit(0);
  case 'ps': out('db\\napi\\nkokoro-tts\\nhermes\\nBad Name\\n'); process.exit(0);
  case 'run': {
    ${opts.runStatus !== undefined ? `process.exit(${opts.runStatus});` : ''}
    const mounts = args.filter((a, i) => args[i - 1] === '--mount').map((m) => Object.fromEntries(m.split(',').map((kv) => kv.split('='))));
    const at = args.indexOf('node');
    const mapped = args.slice(at + 1).map((a) => { for (const m of mounts) if (a === m.dst || a.startsWith(m.dst + '/')) return m.src + a.slice(m.dst.length); return a; });
    const input = fs.readFileSync(0, 'utf8');
    fs.writeFileSync(${JSON.stringify(factsFile)}, input);
    const r = spawnSync(process.execPath, mapped, { input, stdio: ['pipe', 'inherit', 'inherit'] });
    process.exit(r.status ?? 1);
  }
  default: process.exit(0);
}
`, { mode: 0o755 });
      const result = spawnSync('bash', [path.join(stack, 'scripts/preflight.sh'), ...(opts.args ?? [])], {
        encoding: 'utf8',
        env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir, ...opts.env },
        cwd: opts.cwd ?? dir,
        timeout: 60_000,
      });
      const calls = read(log).split('\n').filter(Boolean);
      const run = calls.filter((l) => l.startsWith('docker ["run"')).map((l) => JSON.parse(l.slice('docker '.length)));
      return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        calls,
        docker: calls.filter((l) => l.startsWith('docker ')),
        run: run[0],
        facts: fs.existsSync(factsFile) ? JSON.parse(read(factsFile)) : null,
        stack,
        repo: path.join(dir, 'repo'),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('a standalone run: prod mode, offline, read-only, the caller\'s uid, both mounts read-only; the template stops with B1', () => {
    const r = runWrapper({ env: { COMPOSE_PROFILES: 'tts,tunnel', MY_EXPORTED_NAME_X: 'value with spaces', LLM_GUEST_AI: 'true' } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^❌ \[B1\] /m);
    assert.match(r.out, /^==> 事前チェック（preflight\.sh）: 本番の決まり \/ 公開の段階 setup/m);
    const args = r.run;
    const flag = (/** @type {string} */ name) => args[args.indexOf(name) + 1];
    assert.equal(flag('--network'), 'none');
    assert.ok(args.includes('--read-only') && args.includes('--rm') && args.includes('-i'));
    assert.equal(flag('--cap-drop'), 'ALL');
    assert.equal(flag('--security-opt'), 'no-new-privileges');
    assert.equal(flag('--user'), '1000:1000');
    assert.deepEqual(args.filter((/** @type {string} */ a, /** @type {number} */ i) => args[i - 1] === '--mount'), [
      `type=bind,src=${r.stack},dst=/stack,readonly`,
      `type=bind,src=${r.repo}/scripts/deploy,dst=/preflight,readonly`,
    ]);
    assert.deepEqual(args.slice(args.indexOf('node:22-slim')), ['node:22-slim', 'node', '/preflight/preflight-vm.mjs', '--stack', '/stack', '--mode', 'prod']);
    // The facts: valid for the engine; names with _ survive; anything else is dropped, never sent.
    assert.ok(validateFacts(r.facts), JSON.stringify(r.facts));
    assert.equal(r.facts.from, 'standalone');
    assert.equal(r.facts.callerProfiles, 'tts,tunnel');
    assert.ok(r.facts.callerExports.includes('MY_EXPORTED_NAME_X') && r.facts.callerExports.includes('LLM_GUEST_AI'));
    assert.ok(!JSON.stringify(r.facts).includes('value with spaces'));
    assert.deepEqual(r.facts.runningServices, ['db', 'api', 'kokoro-tts', 'hermes']);
    assert.equal(r.facts.uid, 1000);
    assert.equal(r.facts.unitStack, 'not-found');
    assert.ok(r.facts.diskFreeKb > 0);
    // F11 from the shell's export, F3 from the running hermes.
    assert.match(r.out, /^❌ \[F11\] このシェルの値が、デプロイに入ってしまいます（LLM_GUEST_AI）$/m);
    assert.match(r.out, /^⚠️ \[F3\] 使っていない機能のコンテナが動いたままです（hermes）$/m);
  });

  // Review round 1 of Stage 2, finding 4: the caller's shell can point Compose at another project (a new, empty
  // pgdata volume) or Docker at another daemon. F12 names them from the exports; a --caller-project the deploy
  // passes counts as an exported COMPOSE_PROJECT_NAME even when the export list leaves it out.
  it('F12: the caller\'s COMPOSE_* (not COMPOSE_PROFILES) and DOCKER_* exports stop a production check; GIT_* stays the caller\'s own', () => {
    const r = runWrapper({ env: { COMPOSE_PROJECT_NAME: 'risepath-old', DOCKER_HOST: 'tcp://10.0.0.9:2375', COMPOSE_PROFILES: 'tts', GIT_SSH_COMMAND: 'ssh -i k' } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^❌ \[F12\] このシェルに、デプロイの道具（Compose、Docker）の動きを変える値があります（COMPOSE_PROJECT_NAME、DOCKER_HOST。/m);
    assert.ok(!r.out.includes('risepath-old') && !r.out.includes('10.0.0.9'), 'names only');
    const forwarded = runWrapper({ args: ['--from-deploy', '--caller-skip-pull', '', '--caller-project', 'risepath-old', '--caller-profiles', '', '--caller-exports', 'HOME PATH'] });
    assert.ok(forwarded.facts.callerExports.includes('COMPOSE_PROJECT_NAME'), JSON.stringify(forwarded.facts.callerExports));
    assert.match(forwarded.out, /^❌ \[F12\] [^\n]*（COMPOSE_PROJECT_NAME。/m);
    const own = runWrapper({ args: ['--from-deploy', '--caller-skip-pull', '', '--caller-project', '', '--caller-profiles', '', '--caller-exports', 'HOME PATH GIT_SSH_COMMAND COMPOSE_PROFILES'] });
    assert.doesNotMatch(own.out, /\[F12\]/);
    assert.deepEqual(own.facts.callerExports, ['HOME', 'PATH', 'GIT_SSH_COMMAND', 'COMPOSE_PROFILES']);
  });

  // Review round 2, finding 4: an unsafe caller value is never dropped to '' (no profile, S2 and B5 silent).
  it('a caller COMPOSE_PROFILES with a quote, a backslash or another character is sent as `unreadable`, and the facts stay valid JSON', () => {
    assert.ok(!PROFILE_NAMES.includes('unreadable'));
    for (const profiles of ['tts" ,"x', 'tts\\', 'tts\nfull', 'tts,tunnel,byoa,ü']) {
      const r = runWrapper({ env: { COMPOSE_PROFILES: profiles } });
      assert.ok(r.facts && validateFacts(r.facts), JSON.stringify(profiles));
      assert.equal(r.facts.callerProfiles, 'unreadable', JSON.stringify(profiles));
      assert.notEqual(r.status, 2, r.out);
      assert.ok(!/\[F1\]/.test(r.out), 'stack.env.example sets COMPOSE_PROFILES, so the caller\'s list is not used');
    }
  });
  it('the reviewer\'s case: stack.env without COMPOSE_PROFILES and the caller\'s tts,tunnel,byoa,ü → ❌ [F1] (tts,tunnel,byoa → ❌ [S2] and [B5])', () => {
    const stack = read(path.join(STACK, 'stack.env.example')).replace(/^COMPOSE_PROFILES=.*\n/m, '');
    assert.ok(!/^COMPOSE_PROFILES=/m.test(stack));
    const odd = runWrapper({ files: { 'stack.env': stack }, env: { COMPOSE_PROFILES: 'tts,tunnel,byoa,ü' } });
    assert.equal(odd.status, 1, odd.out);
    assert.match(odd.out, /^❌ \[F1\] `COMPOSE_PROFILES` に知らない名前があります。$/m);
    assert.match(odd.out, /^⚠️ \[B7\] /m);
    const plain = runWrapper({ files: { 'stack.env': stack }, env: { COMPOSE_PROFILES: 'tts,tunnel,byoa' } });
    assert.match(plain.out, /^❌ \[S2\] /m);
    assert.match(plain.out, /^❌ \[B5\] /m);
  });

  it('--caller-exports is split on spaces with no glob expansion (run from the repo root, where * would match Dockerfile)', () => {
    const r = runWrapper({ args: ['--caller-exports', '* LLM_GUEST_AI ?'], cwd: ROOT });
    assert.deepEqual(r.facts.callerExports, ['LLM_GUEST_AI']);
  });

  it('the deploy\'s call with the four CI conditions: CI mode and exit 0', () => {
    const r = runWrapper({ files: { 'stack.env': TEMPLATE }, args: ['--from-deploy', '--caller-skip-pull', '1', '--caller-project', 'risepath-ci', '--caller-profiles', '', '--caller-exports', 'HOME PATH'] });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.run.at(-1), 'ci');
    assert.equal(r.out.split('\n')[0], '（CI モード: 本番だけの決まりを飛ばしています）');
    assert.equal(r.facts.from, 'deploy');
    assert.deepEqual(r.facts.callerExports, ['HOME', 'PATH']);
    assert.ok(r.docker.some((l) => l.includes('"label=com.docker.compose.project=risepath-ci"')), 'the CI project\'s containers and volume');
  });

  it('the same call with stack.env changed by one line: prod mode', () => {
    const r = runWrapper({ files: { 'stack.env': `${TEMPLATE}LLM_GUEST_AI=true\n` }, args: ['--from-deploy', '--caller-skip-pull', '1', '--caller-project', 'risepath-ci'] });
    assert.equal(r.run.at(-1), 'prod');
    assert.equal(r.status, 1);
    assert.ok(r.docker.some((l) => l.includes('"label=com.docker.compose.project=risepath"')));
  });

  it('the root case (finding 2): X5, exit 2, no docker call at all', () => {
    const r = runWrapper({ uid: '0' });
    assert.equal(r.status, 2);
    assert.match(r.out, /^❌ \[X5\] /m);
    assert.deepEqual(r.docker, []);
  });

  // Final review, finding 6: restore-db.sh's RS0 runs `preflight.sh --for-restore`; the rules read R3 as a warning then.
  it('--for-restore sends "from":"restore" (without it: standalone; with --from-deploy: deploy)', () => {
    assert.equal(runWrapper({ args: ['--for-restore'] }).facts.from, 'restore');
    assert.equal(runWrapper({}).facts.from, 'standalone');
    assert.equal(runWrapper({ args: ['--from-deploy', '--caller-skip-pull', '', '--caller-project', '', '--caller-profiles', '', '--caller-exports', 'HOME PATH'] }).facts.from, 'deploy');
  });

  it('X4 for an unknown, repeated or incomplete flag (no docker call); X1 without the api line; X2 when the image or docker run fails', () => {
    for (const args of [['--stage', 'public'], ['--from-deploy', '--from-deploy'], ['--caller-project'], ['extra'], ['--for-restore', '--for-restore'], ['--from-deploy', '--for-restore'], ['--for-restore', '--from-deploy']]) {
      const r = runWrapper({ args });
      assert.equal(r.status, 2, JSON.stringify(args));
      assert.match(r.out, /^❌ \[X4\] /m);
      assert.deepEqual(r.docker, []);
    }
    const x1 = runWrapper({ dockerfile: 'FROM node:22-slim\n' });
    assert.equal(x1.status, 2);
    assert.match(x1.out, /^❌ \[X1\] /m);
    // Review round 2, finding 3: no Dockerfile at all is X1 too, not sed's English error under set -e.
    const noFile = runWrapper({ dockerfile: null });
    assert.equal(noFile.status, 2, noFile.out);
    assert.match(noFile.out, /^❌ \[X1\] /m);
    assert.match(noFile.out, /^   直し方: /m);
    assert.ok(!/sed:|No such file/.test(noFile.out), noFile.out);
    assert.deepEqual(noFile.docker, []);
    const x2 = runWrapper({ imageMissing: true, pullFails: true });
    assert.equal(x2.status, 2);
    assert.match(x2.out, /^❌ \[X2\] /m);
    assert.equal(x2.run, undefined);
    const pulled = runWrapper({ imageMissing: true });
    assert.ok(pulled.docker.some((l) => l.startsWith('docker ["pull","-q","node:22-slim"]')));
    assert.equal(pulled.status, 1);
    const failedRun = runWrapper({ runStatus: 125 });
    assert.equal(failedRun.status, 2);
    assert.match(failedRun.out, /^❌ \[X2\] /m);
  });

  it('the wrapper prints exactly the catalog\'s titles and fixes for X1, X2, X4 and X5', () => {
    const script = read(path.join(STACK, 'scripts/preflight.sh'));
    for (const code of ['X1', 'X2', 'X4', 'X5']) {
      const x = /** @type {{ title: string, fix: string }} */ (INTERNAL_CODES.find((c) => c.code === code));
      assert.ok(script.includes(`say_code ${code} '${x.title}' '${x.fix}'`), code);
    }
  });

  it('backup facts: files present and the status file\'s fields by fixed patterns; anything else is dropped', () => {
    const ok = runWrapper({
      backupFiles: true,
      units: { 'risepath-stack.service': 'enabled', 'risepath-backup.timer': 'enabled' },
      active: ['risepath-backup.timer', 'risepath-backup-journal.timer'],
      status: '{"lastOk":"2026-11-20T01:02:03Z","lastFail":"2026-11-19T01:02:03.5Z","lastFailStep":"BK7","keyId":"0123456789abcdef","alert":true,"lastDrillOk":"2026-11-10T00:00:00Z"}\n',
    });
    assert.deepEqual([ok.facts.backupKey, ok.facts.backupEnv, ok.facts.backupLastOk, ok.facts.backupLastFail, ok.facts.drillLastOk, ok.facts.backupKeyId, ok.facts.backupAlert],
      [true, true, '2026-11-20T01:02:03Z', '2026-11-19T01:02:03.5Z', '2026-11-10T00:00:00Z', '0123456789abcdef', 'true']);
    const bad = runWrapper({ status: '{"lastOk":"2026-11-20T01:02:03Z\\" x","keyId":"0123456789ABCDEF","alert":"yes"}\n' });
    assert.deepEqual([bad.facts.backupKey, bad.facts.backupLastOk, bad.facts.backupKeyId, bad.facts.backupAlert], [false, '', '', '']);
    assert.ok(validateFacts(bad.facts));
    assert.deepEqual([ok.facts.unitStack, ok.facts.unitBackupTimer, bad.facts.unitStack], ['enabled', 'enabled', 'not-found']);
    // R8's fact (review round 1 of Stage 5, finding 4): true only while both backup timers are active.
    assert.deepEqual([ok.facts.backupTimersActive, bad.facts.backupTimersActive], [true, false]);
    const one = runWrapper({ units: { 'risepath-backup.timer': 'enabled' }, active: ['risepath-backup.timer'] });
    assert.equal(one.facts.backupTimersActive, false, 'the journal timer stopped');
    // R9's fact (review round 2 of Stage 5, finding 2): restore-db.sh's marker beside the status file.
    assert.equal(ok.facts.restoreInProgress, false);
    const held = runWrapper({ restoreMark: true });
    assert.equal(held.facts.restoreInProgress, true);
    assert.ok(validateFacts(held.facts));
  });

  it('finding 1 at the wrapper: a bare value line in stack.env is A9 and is never printed', () => {
    const S = sentinel();
    const r = runWrapper({ files: { 'stack.env': `${read(path.join(STACK, 'stack.env.example'))}${S}\n` } });
    assert.equal(r.status, 1);
    assert.match(r.out, /^❌ \[A9\] stack\.env の \d+ 行目が読めません/m);
    assert.ok(!r.out.includes(S));
  });
});
