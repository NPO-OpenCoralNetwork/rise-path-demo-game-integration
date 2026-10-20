/**
 * scripts/ci/check-assets.mjs: large binary assets need a credit in assets/credits.json.
 * Large files are generated at runtime in a temp folder; nothing large is committed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets, isAsset, loadCredits, parseSize, DEFAULT_MAX_BYTES } from '../../scripts/ci/check-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'check-assets.mjs');
const MIB = 1024 * 1024;

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: cleanEnv() });
const gitIn = (cwd, args) => {
  const res = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', env: cleanEnv() });
  assert.equal(res.status, 0, res.stderr);
};

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-assets-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
const write = (dir, rel, content) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const bytes = (n) => Buffer.alloc(n, 1);
const credits = (dir, assets, rel = 'assets/credits.json') => write(dir, rel, JSON.stringify({ version: 1, assets }));

describe('check-assets', () => {
  it('knows the binary asset types; SVG and code are not assets', () => {
    for (const f of ['a.png', 'b.JPG', 'c.webp', 'd.mp3', 'e.wav', 'f.mp4', 'g.woff2', 'h.glb', 'i.fbx', 'j.pdf', 'k.zip', 'l.gltf']) assert.ok(isAsset(f), f);
    for (const f of ['a.svg', 'b.json', 'c.js', 'd.md', 'png']) assert.ok(!isAsset(f), f);
    assert.equal(DEFAULT_MAX_BYTES, MIB);
  });

  it('parses sizes in bytes, KiB and MiB', () => {
    assert.equal(parseSize('1048576'), MIB);
    assert.equal(parseSize('1MiB'), MIB);
    assert.equal(parseSize('2 MB'), 2 * MIB);
    assert.equal(parseSize('512KiB'), 512 * 1024);
    assert.throws(() => parseSize('big'), /invalid size/);
    assert.throws(() => parseSize('0'), /positive/);
  });

  it('fails on a large asset without a credit, passes once it is credited', () => {
    const dir = path.join(tmp, 'credit');
    write(dir, 'public/audio/theme.mp3', bytes(MIB + 512 * 1024));
    write(dir, 'public/img/small.png', bytes(1000));
    write(dir, 'public/img/huge.svg', bytes(2 * MIB));
    credits(dir, []);
    let res = run(['public/audio/theme.mp3', 'public/img/small.png', 'public/img/huge.svg'], dir);
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stdout, /^public\/audio\/theme\.mp3: 1\.5 MiB asset without a credit: add \{ "path", "source", "license" \} for it to assets\/credits\.json$/m);
    assert.doesNotMatch(res.stdout, /small\.png|huge\.svg/);
    assert.match(res.stdout, /1 of 1 asset\(s\) over 1\.0 MiB have no credit/);

    const gh = run(['--format', 'github', 'public/audio/theme.mp3'], dir);
    assert.match(gh.stdout, /^::error file=public\/audio\/theme\.mp3,title=check-assets::1\.5 MiB asset without a credit/m);

    credits(dir, [{ path: 'public/audio/theme.mp3', source: 'Recorded for Rise Path by the team', license: 'CC-BY-4.0', author: 'Rise Path' }]);
    res = run(['public/audio/theme.mp3', 'public/img/small.png'], dir);
    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /1 asset\(s\) over 1\.0 MiB, all credited/);
  });

  it('credits may use globs; the limit is configurable', () => {
    const dir = path.join(tmp, 'glob');
    write(dir, 'public/pack/a/one.png', bytes(MIB + 1));
    write(dir, 'public/pack/b/two.png', bytes(MIB + 1));
    write(dir, 'public/other/three.png', bytes(300 * 1024));
    credits(dir, [{ path: 'public/pack/**', source: 'https://example.org/pack', license: 'CC0-1.0' }]);
    assert.equal(run(['public/pack/a/one.png', 'public/pack/b/two.png'], dir).status, 0);
    assert.equal(run(['public/other/three.png'], dir).status, 0, 'under the default limit');
    const res = run(['--max-size', '256KiB', 'public/other/three.png'], dir);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /over 0\.3 MiB/);
    assert.equal(run(['--max-size', 'huge', 'public/other/three.png'], dir).status, 2);
  });

  it('a missing credits file means no credits; a malformed one is an error (exit 2)', () => {
    const dir = path.join(tmp, 'malformed');
    write(dir, 'big.wav', bytes(MIB + 1));
    assert.equal(run(['big.wav'], dir).status, 1);
    const bad = [
      { version: 2, assets: [] },
      { version: 1 },
      { version: 1, assets: [{ path: 'big.wav', source: 'somewhere' }] },
      { version: 1, assets: [{ path: 'big.wav', source: 'somewhere', license: ' ' }] },
      { version: 1, assets: [{ path: 'big.wav', source: 'somewhere', license: 'MIT', licence: 'MIT' }] },
      { version: 1, assets: [{ path: 'big.wav', source: 'somewhere', license: 'MIT', author: 3 }] },
    ];
    for (const data of bad) {
      write(dir, 'assets/credits.json', JSON.stringify(data));
      const res = run(['big.wav'], dir);
      assert.equal(res.status, 2, JSON.stringify(data));
      assert.match(res.stderr, /credits\.json/);
    }
    write(dir, 'assets/credits.json', '{');
    assert.throws(() => loadCredits(path.join(dir, 'assets/credits.json')), /not valid JSON/);
    write(dir, 'other-credits.json', JSON.stringify({ version: 1, assets: [{ path: '*.wav', source: 'x', license: 'MIT' }] }));
    assert.equal(run(['--credits', 'other-credits.json', 'big.wav'], dir).status, 0, '--credits picks another file');
  });

  it('checkAssets skips missing files, node_modules and dist', () => {
    const dir = path.join(tmp, 'skip');
    write(dir, 'node_modules/pkg/big.png', bytes(MIB + 1));
    write(dir, 'dist/big.png', bytes(MIB + 1));
    assert.equal(run(['node_modules/pkg/big.png', 'dist/big.png'], dir).status, 0);
    assert.deepEqual(checkAssets(['gone.png'], { root: dir, credits: [] }), { missing: [], large: 0 });
  });

  it('--diff checks only assets added or changed since the merge base', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    gitIn(repo, ['init', '-q', '-b', 'main']);
    write(repo, 'public/old.png', bytes(MIB + 1)); // already on main
    credits(repo, []);
    gitIn(repo, ['add', '.']);
    gitIn(repo, ['commit', '-q', '--no-verify', '-m', 'base']);
    gitIn(repo, ['checkout', '-q', '-b', 'feature']);
    assert.equal(run(['--diff', 'main'], repo).status, 0);

    write(repo, 'public/new.ogg', bytes(MIB + 1));
    gitIn(repo, ['add', '.']);
    gitIn(repo, ['commit', '-q', '--no-verify', '-m', 'add audio']);
    let res = run(['--diff', 'main'], repo);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /^public\/new\.ogg: /m);
    assert.doesNotMatch(res.stdout, /old\.png/);

    credits(repo, [{ path: 'public/new.ogg', source: 'Generated with a synthesizer preset', license: 'CC0-1.0' }]);
    res = run(['--diff', 'main'], repo);
    assert.equal(res.status, 0, res.stdout);
    assert.equal(run(['--all'], repo).status, 1, '--all also reports the old uncredited asset');
  });

  it('the repository credits file is valid', () => {
    const entries = loadCredits(path.join(ROOT, 'assets', 'credits.json'));
    assert.ok(Array.isArray(entries));
  });
});
