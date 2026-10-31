// @ts-check
// 事後の確かめ (Phase 9; design §6.1, §6.3; Scope guard TR2, TR10): scripts/deploy/postdeploy-probe.mjs (the
// checks P1-P6 and P8, run in the api container) and deploy/risepath-vm/scripts/postdeploy-check.sh (the host
// facts, the exit codes and the deploy record P13). The probe runs against fake api, mcp and kokoro servers on
// loopback; the fake api answers 401 on /api/v2/tts/health without a token, as strict production does
// (authOnce.test.js), so a probe that went back to that route would fail P4 (finding 21). The wrapper runs
// from a temporary copy with docker, id, systemctl and git stubs; its docker stub runs the real probe against
// the same fakes. Static pins of the wrapper: vmStackConfig.test.js.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ALL_CODES, DEPLOY_CODES, NAME_UNSHOWN, POSTDEPLOY_CODES, defaultEndpoints, formatFindings, probe, ranCodes, runCli, validateFacts,
} from '../../scripts/deploy/postdeploy-probe.mjs';
import { runCli as runPreflightCli } from '../../scripts/deploy/preflight-vm.mjs';
import { PROFILE_NAMES } from '../../scripts/deploy/preflight-rules.mjs';
import { baseFacts } from './helpers/preflightFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STACK = path.join(ROOT, 'deploy/risepath-vm');
const PROBE = path.join(ROOT, 'scripts/deploy/postdeploy-probe.mjs');
const read = (/** @type {string} */ file) => fs.readFileSync(file, 'utf8');
const bash4 = spawnSync('bash', ['-c', 'x=A; : "${x,,}"']).status === 0;
const skipBash = bash4 ? false : 'needs bash ≥ 4';

const goodHealth = () => ({
  ok: true,
  ready_for_prod_data: true,
  node_env: 'production',
  checks: { strict_auth_mode: true, production_data_mode: true },
  database: { ok: true, migrations: { pending: 0, ok: true, pending_versions: [] } },
});
const goodLlm = () => ({
  ok: true,
  mock: false,
  forced_provider: null,
  providers: { anthropic: { configured: true }, gemini: { configured: false, allowed: false }, mock: { available: false, forced: false } },
  tasks: {},
});
/** @type {{ health: any, healthStatus: number, llm: any, llmStatus: number, mcp: any, kokoro: any, kokoroStatus: number, paths: string[] }} */
const state = { health: null, healthStatus: 200, llm: null, llmStatus: 200, mcp: null, kokoro: null, kokoroStatus: 200, paths: [] };
const reset = () => Object.assign(state, {
  health: goodHealth(), healthStatus: 200, llm: goodLlm(), llmStatus: 200, mcp: { status: 'ok', db: 'connected' },
  kokoro: { status: 'ok', engine: 'kokoro' }, kokoroStatus: 200, paths: [],
});

/** @param {http.RequestListener} handler @returns {Promise<{ url: string, server: http.Server }>} */
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}
/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

/** @type {{ api: string, mcp: string, kokoro: string }} */
let endpoints = { api: '', mcp: '', kokoro: '' };
/** A loopback port nothing listens on. */
let deadUrl = '';
/** @type {http.Server[]} */
const servers = [];

before(async () => {
  reset();
  const api = await serve((req, res) => {
    state.paths.push(`api ${req.url}`);
    if (req.url === '/api/v2/health') return json(res, state.healthStatus, state.health);
    if (req.url === '/api/v2/llm/status') return json(res, state.llmStatus, state.llm);
    // Strict production: requireAuth on /api/v2 answers a request without a token first (N15).
    if (req.url === '/api/v2/tts/health') return json(res, 401, { error: 'unauthorized' });
    return json(res, 404, { error: 'not_found' });
  });
  const mcp = await serve((req, res) => {
    state.paths.push(`mcp ${req.url}`);
    return req.url === '/health' ? json(res, 200, state.mcp) : json(res, 404, {});
  });
  const kokoro = await serve((req, res) => {
    state.paths.push(`kokoro ${req.url}`);
    return req.url === '/health' ? json(res, state.kokoroStatus, state.kokoro) : json(res, 404, {});
  });
  const dead = await serve(() => {});
  deadUrl = dead.url;
  await new Promise((resolve) => dead.server.close(resolve));
  servers.push(api.server, mcp.server, kokoro.server);
  endpoints = { api: api.url, mcp: mcp.url, kokoro: kokoro.url };
});
after(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
});

/** @returns {import('../../scripts/deploy/postdeploy-probe.mjs').Facts} */
const facts = (/** @type {Partial<import('../../scripts/deploy/postdeploy-probe.mjs').Facts>} */ mod = {}) => ({
  profiles: 'tts,tunnel', cloudflared: 'healthy', unitStack: 'enabled', retentionLines: 1, ...mod,
});
/** The findings as `code:name|name`. @param {import('../../scripts/deploy/postdeploy-probe.mjs').Finding[]} findings */
const short = (findings) => findings.map((f) => `${f.level} ${f.code}${f.names ? `:${f.names.join('|')}` : ''}`);
/** @param {'prod' | 'ci'} mode @param {Partial<import('../../scripts/deploy/postdeploy-probe.mjs').Facts>} [mod] */
const run = (mode, mod = {}) => probe({ mode, facts: facts(mod), endpoints });
/** @param {string[]} argv @param {string} stdinText @param {{ api: string, mcp: string, kokoro: string }} [at] */
async function cli(argv, stdinText, at = endpoints) {
  /** @type {string[]} */
  const out = [];
  const status = await runCli({ argv, stdinText, write: (line) => out.push(line), endpoints: at });
  return { status, out: out.join('\n') };
}

describe('postdeploy-probe.mjs: the checks against fake servers', () => {
  beforeEach(reset);

  it('a good production stack with tts and tunnel: no finding, exit 0, every check named', async () => {
    assert.deepEqual(short(await run('prod')), []);
    const r = await cli(['--mode', 'prod'], JSON.stringify(facts()));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.out, [
      '==> 事後の確かめ（postdeploy-check.sh）: 本番の確かめ',
      '==> 確かめたコード: P1、P2、P3、P4、P5、P6、P8',
      '==> 事後の確かめ: エラー 0 件、注意 0 件。',
    ].join('\n'));
  });

  it('P1: each field of /api/v2/health the CI stack checks, and no answer', async () => {
    /** @type {[string, (h: any) => void][]} */
    const cases = [
      ['ok', (h) => { h.ok = false; }],
      ['node_env', (h) => { h.node_env = 'development'; }],
      ['checks.strict_auth_mode', (h) => { h.checks.strict_auth_mode = false; }],
      ['checks.production_data_mode', (h) => { delete h.checks.production_data_mode; }],
      ['database.migrations.pending', (h) => { h.database.migrations.pending = 1; }],
      ['database.migrations.pending', (h) => { delete h.database; }],
    ];
    for (const [name, change] of cases) {
      reset();
      change(state.health);
      state.healthStatus = 503;
      assert.deepEqual(short(await run('prod')), [`E P1:${name}`], name);
      assert.deepEqual(short(await run('ci')), [`E P1:${name}`], `${name} (CI: runs too)`);
    }
    reset();
    state.health = 'not json';
    assert.deepEqual(short(await run('prod')), ['E P1:no-answer']);
    const down = await probe({ mode: 'prod', facts: facts(), endpoints: { ...endpoints, api: deadUrl } });
    assert.deepEqual(short(down), ['E P1:no-answer', 'E P3:no-answer']);
  });

  it('P2: mcp answers 200 either way; only db: connected passes', async () => {
    state.mcp = { status: 'degraded', db: 'error' };
    assert.deepEqual(short(await run('ci')), ['E P2:db']);
    state.mcp = { status: 'ok', db: 'not_configured' };
    assert.deepEqual(short(await run('prod')), ['E P2:db']);
    const down = await probe({ mode: 'prod', facts: facts(), endpoints: { ...endpoints, mcp: deadUrl } });
    assert.deepEqual(short(down), ['E P2:no-answer']);
  });

  it('P3: the AI settings; the model key only in production (the CI stack has none)', async () => {
    state.llm.providers.anthropic.configured = false;
    assert.deepEqual(short(await run('prod')), ['E P3:providers.anthropic.configured']);
    assert.deepEqual(short(await run('ci')), [], 'CI mode drops the anthropic clause');
    /** @type {[string, (s: any) => void][]} */
    const cases = [
      ['providers.gemini.allowed', (s) => { s.providers.gemini.allowed = true; }],
      ['providers.gemini.allowed', (s) => { delete s.providers.gemini; }],
      ['mock', (s) => { s.mock = true; }],
      ['forced_provider', (s) => { s.forced_provider = 'mock'; }],
      ['forced_provider', (s) => { s.forced_provider = 'gemini'; }],
      ['forced_provider', (s) => { delete s.forced_provider; }],
    ];
    for (const [name, change] of cases) {
      reset();
      change(state.llm);
      for (const mode of /** @type {const} */ (['prod', 'ci'])) assert.deepEqual(short(await run(mode)), [`E P3:${name}`], `${mode} ${name}`);
    }
    reset();
    state.llm.forced_provider = 'anthropic';
    assert.deepEqual(short(await run('prod')), [], 'LLM_PROVIDER=anthropic is allowed (preflight C4)');
    reset();
    state.llmStatus = 503;
    assert.deepEqual(short(await run('prod')), ['E P3:no-answer']);
  });

  it('P4: the kokoro sidecar itself when tts or full is listed, never /api/v2/tts/health (401 in strict production)', async () => {
    await run('prod');
    assert.ok(state.paths.includes('kokoro /health'));
    assert.ok(!state.paths.some((p) => p.includes('/tts/')), 'the api\'s TTS route is never asked');
    for (const profiles of ['tts', 'full', 'tunnel,tts']) {
      reset();
      state.kokoro = { status: 'loading' };
      assert.deepEqual(short(await run('ci', { profiles })), ['E P4'], profiles);
    }
    reset();
    state.kokoroStatus = 500;
    assert.deepEqual(short(await run('prod')), ['E P4']);
    const down = await probe({ mode: 'prod', facts: facts(), endpoints: { ...endpoints, kokoro: deadUrl } });
    assert.deepEqual(short(down), ['E P4']);
    for (const profiles of ['', 'tunnel']) {
      reset();
      state.kokoro = { status: 'loading' };
      assert.deepEqual(short(await run('prod', { profiles })), [], `${profiles}: P4 not run`);
      assert.ok(!state.paths.includes('kokoro /health'), `${profiles}: the sidecar is not asked`);
    }
    // A name no profile has is not a silent skip (P15, below).
    for (const profiles of ['tunnelx', 'ttsx']) {
      reset();
      state.kokoro = { status: 'loading' };
      assert.deepEqual(short(await run('prod', { profiles })), ['E P15'], `${profiles}: P15, P4 not run`);
      assert.ok(!state.paths.includes('kokoro /health'), `${profiles}: the sidecar is not asked`);
    }
  });

  // Review round 1 of Stage 2, finding 1: a COMPOSE_PROFILES line the wrapper cannot read arrives as
  // `unreadable`; the probe cannot tell whether P4 and P5 apply, so it fails closed in both modes.
  it('P15: a profile the check does not know (`unreadable` included) is an error, never a skipped P4 or P5', async () => {
    assert.ok(!PROFILE_NAMES.includes('unreadable'));
    for (const mode of /** @type {const} */ (['prod', 'ci'])) {
      assert.deepEqual(short(await run(mode, { profiles: 'unreadable' })), ['E P15'], mode);
      assert.deepEqual(short(await run(mode, { profiles: 'tts,tunel' })), ['E P15'], `${mode}: tts still checked (P4 passes), the typo reported`);
    }
    for (const profiles of PROFILE_NAMES) assert.ok(!short(await run('ci', { profiles })).includes('E P15'), profiles);
    const r = await cli(['--mode', 'prod'], JSON.stringify(facts({ profiles: 'unreadable' })));
    assert.equal(r.status, 10, r.out);
    const p15 = /** @type {{ title: string, fix: string }} */ (POSTDEPLOY_CODES.find((c) => c.code === 'P15'));
    assert.ok(r.out.includes(`❌ [P15] ${p15.title}\n   直し方: ${p15.fix}\n   くわしく: 手順書 13 章の「P15」`), r.out);
    assert.match(r.out, /==> 確かめたコード: P1、P2、P3、P6、P8\n/, 'P4 and P5 are not counted as checked');
  });

  it('P5, P6: host facts in production only; P8 in both modes', async () => {
    for (const cloudflared of ['unhealthy', 'starting', '']) {
      assert.deepEqual(short(await run('prod', { cloudflared })), ['E P5'], cloudflared);
      assert.deepEqual(short(await run('prod', { cloudflared, profiles: 'tts' })), [], `${cloudflared}: no tunnel, no P5`);
      assert.deepEqual(short(await run('ci', { cloudflared })), [], `${cloudflared}: CI mode`);
    }
    for (const unitStack of ['disabled', 'not-found', '']) {
      assert.deepEqual(short(await run('prod', { unitStack })), ['W P6'], unitStack);
      assert.deepEqual(short(await run('ci', { unitStack })), [], `${unitStack}: CI mode`);
    }
    assert.deepEqual(short(await run('prod', { retentionLines: 0 })), ['W P8']);
    assert.deepEqual(short(await run('ci', { retentionLines: 0 })), ['W P8']);
    assert.deepEqual(short(await run('ci', { retentionLines: 3 })), []);
  });

  it('the report: errors before warnings, the fixed text of each code, the checks that ran; exit 10 with an error, 0 with warnings only', async () => {
    state.mcp = { db: 'error' };
    const r = await cli(['--mode', 'prod'], JSON.stringify(facts({ unitStack: 'disabled' })));
    assert.equal(r.status, 10);
    const p2 = /** @type {{ title: string, fix: string }} */ (POSTDEPLOY_CODES.find((c) => c.code === 'P2'));
    const p6 = /** @type {{ title: string, fix: string }} */ (POSTDEPLOY_CODES.find((c) => c.code === 'P6'));
    assert.equal(r.out, [
      '==> 事後の確かめ（postdeploy-check.sh）: 本番の確かめ',
      `❌ [P2] ${p2.title.replace('{names}', 'db')}`,
      `   直し方: ${p2.fix}`,
      '   くわしく: 手順書 13 章の「P2」',
      `⚠️ [P6] ${p6.title}`,
      `   直し方: ${p6.fix}`,
      '   くわしく: 手順書 13 章の「P6」',
      '==> 確かめたコード: P1、P2、P3、P4、P5、P6、P8',
      '==> 事後の確かめ: エラー 1 件、注意 1 件。',
    ].join('\n'));
    reset();
    const ci = await cli(['--mode', 'ci'], JSON.stringify(facts({ profiles: '', retentionLines: 0 })));
    assert.equal(ci.status, 0, 'warnings only');
    assert.match(ci.out, /^（CI モード: 本番だけの確かめを飛ばしています）\n==> 事後の確かめ（postdeploy-check.sh）: CI の確かめ\n⚠️ \[P8\] /);
    assert.match(ci.out, /==> 確かめたコード: P1、P2、P3、P8\n/);
    assert.deepEqual(ranCodes('ci', facts({ profiles: 'tts,tunnel' })), ['P1', 'P2', 'P3', 'P4', 'P8']);
  });

  it('never prints a value: a sentinel in every answer and field reaches no line', async () => {
    const S = `SENTINELX9F3${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    state.health = { ok: S, node_env: S, checks: { strict_auth_mode: S, production_data_mode: S }, database: { migrations: { pending: S } }, [S]: S };
    state.llm = { mock: S, forced_provider: S, providers: { anthropic: { configured: S }, gemini: { allowed: S } }, [S]: S };
    state.mcp = { db: S, error: S };
    state.kokoro = { status: S, detail: S };
    const r = await cli(['--mode', 'prod'], JSON.stringify(facts({ unitStack: 'disabled', retentionLines: 0, cloudflared: 'unhealthy' })));
    assert.equal(r.status, 10);
    for (const code of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P8']) assert.match(r.out, new RegExp(`\\[${code}\\]`), code);
    assert.ok(!r.out.includes(S), r.out);
    assert.ok(!r.out.toLowerCase().includes(S.toLowerCase()));
  });

  it('the formatter shows only a code\'s own field names; an unknown code prints as P0', () => {
    const lines = formatFindings([
      { code: 'P1', level: 'E', names: ['ok', 'SECRETVALUE', 'db'] },
      { code: 'P3', level: 'E', names: ['https://evil.example/x'] },
      { code: 'Z9', level: 'E' },
    ], { mode: 'prod', facts: facts() }).join('\n');
    assert.match(lines, /\[P1\] api が本番の形で動いていません（ok、（名前を表示できません））。/);
    assert.ok(lines.includes(`[P3] AI の設定が本番の形ではありません（${NAME_UNSHOWN}）。`));
    assert.ok(!lines.includes('SECRETVALUE') && !lines.includes('evil') && !lines.includes('Z9'));
    assert.match(lines, /^❌ \[P0\] /m);
  });
});

describe('postdeploy-probe.mjs: arguments, facts and the catalog', () => {
  beforeEach(reset);

  it('exit 11 with P0 for bad arguments or facts, before any request', async () => {
    const good = JSON.stringify(facts());
    for (const argv of [[], ['--mode'], ['--mode', 'x'], ['--mode', 'prod', '--x'], ['--stage', 'prod']]) {
      const r = await cli(argv, good);
      assert.equal(r.status, 11, JSON.stringify(argv));
      assert.match(r.out, /^❌ \[P0\] /);
    }
    for (const bad of ['', '{', 'null', '[]', JSON.stringify({ ...facts(), extra: 1 }), JSON.stringify({ profiles: 'tts' }),
      JSON.stringify(facts({ profiles: 'TTS' })), JSON.stringify(facts({ profiles: 'tts"x' })), JSON.stringify(facts({ cloudflared: 'Healthy' })),
      JSON.stringify(facts({ unitStack: 'en abled' })), JSON.stringify(facts({ retentionLines: -1 })), JSON.stringify(facts({ retentionLines: 1.5 })),
      JSON.stringify({ ...facts(), retentionLines: '1' })]) {
      const r = await cli(['--mode', 'prod'], bad);
      assert.equal(r.status, 11, bad);
      assert.match(r.out, /^❌ \[P0\] /, bad);
    }
    assert.deepEqual(state.paths, [], 'nothing was asked');
    assert.ok(validateFacts(facts()));
  });

  it('the endpoints inside the api container: its own PORT and MCP_SSE_PORT, the sidecar by name', () => {
    assert.deepEqual(defaultEndpoints({}), { api: 'http://127.0.0.1:3006', mcp: 'http://mcp:3100', kokoro: 'http://kokoro-tts:8880' });
    assert.deepEqual(defaultEndpoints({ PORT: '3007', MCP_SSE_PORT: '3101' }), { api: 'http://127.0.0.1:3007', mcp: 'http://mcp:3101', kokoro: 'http://kokoro-tts:8880' });
    assert.deepEqual(defaultEndpoints({ PORT: 'evil.example/x', MCP_SSE_PORT: '' }), { api: 'http://127.0.0.1:3006', mcp: 'http://mcp:3100', kokoro: 'http://kokoro-tts:8880' });
  });

  it('the catalog: DB0, DB1 then P0-P16 without the removed numbers; one level each; です・ます text ending in 。 or ）', () => {
    assert.deepEqual([...ALL_CODES], ['DB0', 'DB1', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P8', 'P13', 'P15', 'P16']);
    assert.equal(new Set(ALL_CODES).size, ALL_CODES.length);
    for (const c of [...DEPLOY_CODES, ...POSTDEPLOY_CODES]) {
      assert.ok(['E', 'W', 'I'].includes(c.level), c.code);
      for (const text of [c.title, c.fix]) {
        assert.match(text, /[。）]$/, `${c.code}: ${text}`);
        assert.doesNotMatch(text, /だ。|である。/, c.code);
      }
      assert.equal(c.title.includes('{names}'), Boolean(c.names), `${c.code}: {names} only with a fixed list`);
    }
    assert.deepEqual(POSTDEPLOY_CODES.filter((c) => c.level === 'W').map((c) => c.code), ['P6', 'P8']);
  });

  // Review round 1 of Stage 2, findings 2, 6, 7, 8, 10: what each fix sends the owner (or an agent) to do.
  it('the fixes: DB0 never says to make the DB again, DB1 copies the data first; P3, P5, P15 end with the redeploy; P6 cites the second bootstrap run (6.1)', () => {
    const text = (/** @type {string} */ code) => /** @type {{ title: string, fix: string }} */ ([...DEPLOY_CODES, ...POSTDEPLOY_CODES].find((c) => c.code === code));
    assert.match(text('DB0').title, /答えがありませんでした/);
    assert.match(text('DB0').fix, /DB は作り直しません/);
    assert.doesNotMatch(text('DB0').fix, /作り直します/);
    assert.match(text('DB1').fix, /作り直す前に、もう一度文字コードを確かめ、データの控えを取ります。手順書 16 章/);
    const redeploy = '直したら `./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。';
    for (const code of ['P3', 'P5', 'P15']) assert.ok(text(code).fix.endsWith(redeploy), code);
    assert.match(text('P6').fix, /`\.\/scripts\/bootstrap-vm\.sh` をもう一度、最後まで実行します（手順書 6\.1）。$/);
    const runbook = read(path.join(ROOT, 'doc/guides/first-launch.ja.md'));
    assert.match(runbook, /^### 6\.1 最初のデプロイをする$/m, '6.1 is the first deploy (bootstrap-vm.sh run to the end)');
    assert.match(runbook, /^### 4\.5 .*1 回目の準備をする$/m, '4.5 is only the first, stopping run');
    assert.match(text('P16').fix, /deploy-stack\.sh` をもう一度実行します/);
  });

  it('the CLI as a process: --mode and the facts on stdin; nothing it cannot reach is printed', () => {
    // From the host, the stack's names (mcp, kokoro-tts) do not resolve and 127.0.0.1:<PORT> is closed.
    const r = spawnSync(process.execPath, [PROBE, '--mode', 'ci'], {
      input: JSON.stringify(facts({ profiles: '' })), encoding: 'utf8', timeout: 60_000,
      env: { PATH: process.env.PATH, PORT: new URL(deadUrl).port, MCP_SSE_PORT: '1' },
    });
    assert.equal(r.status, 10, r.stdout + r.stderr);
    assert.match(r.stdout, /^❌ \[P1\] api が本番の形で動いていません（no-answer）。$/m);
    assert.match(r.stdout, /^❌ \[P2\] MCP が DB につながっていません（no-answer）。$/m);
    assert.equal(r.stderr, '');
  });
});

describe('postdeploy-check.sh: the host facts, the exit codes and the deploy record (stubs; the real probe)', { skip: skipBash }, () => {
  beforeEach(reset);
  const TEMPLATE = read(path.join(STACK, 'ci/stack.ci.env'));
  const VM_ENV = TEMPLATE.replace(/^# risepath-ci-env:.*\n/, '').replace(/^COMPOSE_PROJECT_NAME=.*\n/m, '').replace(/^COMPOSE_PROFILES=$/m, 'COMPOSE_PROFILES=tts,tunnel');

  /**
   * Runs a copy of postdeploy-check.sh (with check-mode.sh, ci/stack.ci.env and stack.env) with stubs: id
   * (`uid`), systemctl (`unit`), git (one sha) and docker, which logs each call, answers `ps --format
   * {{.Health}} cloudflared` with `health`, prints the retention line `retention` times for `logs`, and for
   * the probe exec either exits `probeStatus` or (when it is undefined) runs the real probe with this node
   * against the fake servers (so the script runs asynchronously: the servers live in this process).
   * @param {{ args?: string[], stackEnv?: string | null, uid?: string, unit?: string, health?: string, retention?: number,
   *   probeStatus?: number, env?: Record<string, string>, keep?: (stackDir: string) => void }} [opts]
   */
  async function runCheck(opts = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postdeploy-sh-'));
    try {
      const stackDir = path.join(dir, 'repo/deploy/risepath-vm');
      fs.mkdirSync(path.join(stackDir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(stackDir, 'ci'));
      for (const f of ['postdeploy-check.sh', 'check-mode.sh']) fs.copyFileSync(path.join(STACK, 'scripts', f), path.join(stackDir, 'scripts', f));
      fs.writeFileSync(path.join(stackDir, 'ci/stack.ci.env'), TEMPLATE);
      if (opts.stackEnv !== null) fs.writeFileSync(path.join(stackDir, 'stack.env'), opts.stackEnv ?? VM_ENV, { mode: 0o600 });
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}\n');
      const log = path.join(dir, 'calls.log');
      const factsLog = path.join(dir, 'facts.log');
      for (const f of [log, factsLog]) fs.writeFileSync(f, '');
      const stub = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
      stub('id', `echo "id $*" >> "${log}"; echo ${opts.uid ?? '1000'}`);
      stub('systemctl', `case "$2" in risepath-stack.service) echo ${opts.unit ?? 'enabled'} ;; *) exit 1 ;; esac`);
      stub('git', `echo "git $*" >> "${log}"; echo ${'c'.repeat(40)}`);
      fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, 'docker ' + JSON.stringify(args) + '\\n');
const line = args.join(' ');
if (args.includes('logs')) { process.stdout.write('[Retention] on, hourly: x\\n'.repeat(${opts.retention ?? 1}) + 'other line\\n'); process.exit(0); }
if (args.includes('ps') && args.includes('{{.Health}}')) { process.stdout.write(${JSON.stringify(`${opts.health ?? 'healthy'}\n`)}); process.exit(0); }
if (line.includes('postdeploy-probe.mjs')) {
  const input = fs.readFileSync(0, 'utf8');
  fs.appendFileSync(${JSON.stringify(factsLog)}, input + '\\n');
  ${opts.probeStatus !== undefined ? `process.exit(${opts.probeStatus});` : ''}
  const argv = args.slice(args.findIndex((a) => a.endsWith('/postdeploy-probe.mjs')) + 1);
  const code = 'import(process.env.PROBE).then((m) => m.runCli({ argv: JSON.parse(process.env.ARGV), stdinText: process.env.INPUT, write: (l) => process.stdout.write(l + "\\\\n"), endpoints: JSON.parse(process.env.ENDPOINTS) })).then((c) => { process.exitCode = c; })';
  const r = spawnSync(process.execPath, ['-e', code], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PROBE: ${JSON.stringify(PROBE)}, ARGV: JSON.stringify(argv), INPUT: input, ENDPOINTS: ${JSON.stringify(JSON.stringify(endpoints))} } });
  process.exit(r.status ?? 1);
}
process.exit(0);
`, { mode: 0o755 });
      const result = await new Promise((resolve) => {
        const child = spawn('bash', [path.join(stackDir, 'scripts/postdeploy-check.sh'), ...(opts.args ?? [])], {
          cwd: dir, timeout: 60_000, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir, ...opts.env },
        });
        let stdout = '';
        child.stdout.on('data', (c) => { stdout += c; });
        child.stderr.on('data', (c) => { stdout += c; });
        child.on('close', (status) => resolve({ status, stdout, stderr: '' }));
      });
      const calls = read(log).split('\n').filter(Boolean);
      const recordFile = path.join(stackDir, '.deploy/last-green.json');
      const record = fs.existsSync(recordFile) ? JSON.parse(read(recordFile)) : null;
      opts.keep?.(stackDir);
      return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        docker: calls.filter((l) => l.startsWith('docker ')).map((l) => JSON.parse(l.slice('docker '.length))),
        git: calls.filter((l) => l.startsWith('git ')),
        facts: read(factsLog).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
        record,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const sha256 = (/** @type {string} */ text) => crypto.createHash('sha256').update(text).digest('hex');
  // --profiles stays last (the tests below replace its value); --stack-sha is the hash deploy-stack.sh took.
  const DEPLOY = ['--from-deploy', '--caller-skip-pull', '', '--caller-project', '', '--stack-sha', sha256(VM_ENV), '--profiles', 'tts,tunnel'];
  const CI_DEPLOY = ['--from-deploy', '--caller-skip-pull', '1', '--caller-project', 'risepath-ci', '--profiles', ''];
  const modeOf = (/** @type {string[][]} */ docker) => docker.filter((a) => a.includes('scripts/deploy/postdeploy-probe.mjs')).map((a) => a[a.indexOf('--mode') + 1]);

  it('P0 for root, an unknown, repeated or incomplete flag, or no stack.env: exit 2, no docker call', async () => {
    for (const opts of [{ uid: '0' }, { args: ['--stage', 'pilot'] }, { args: ['--from-deploy', '--from-deploy'] }, { args: ['--profiles'] },
      { args: ['--caller-project', 'a', '--caller-project', 'b'] }, { args: ['--stack-sha', 'a', '--stack-sha', 'b'] }, { args: ['--stack-sha'] }, { stackEnv: null }]) {
      const r = await runCheck(opts);
      assert.equal(r.status, 2, JSON.stringify(opts));
      assert.equal(r.out.split('\n').filter(Boolean).length, 3, r.out);
      assert.match(r.out, /^❌ \[P0\] 事後の確かめを実行できません/);
      assert.deepEqual(r.docker, [], JSON.stringify(opts));
    }
  });

  it('from the deploy: the real probe passes a good stack, the record is written (P13) and its hash is the one the 事前チェック compares (F5)', async () => {
    /** @type {string[]} */
    const preflight = [];
    const r = await runCheck({
      args: DEPLOY,
      keep: (stackDir) => {
        const facts = { ...baseFacts(), from: 'standalone', unitStack: 'enabled' };
        for (const mutate of [false, true]) {
          if (mutate) fs.appendFileSync(path.join(stackDir, 'stack.env'), '\n');
          /** @type {string[]} */
          const out = [];
          runPreflightCli({ argv: ['--stack', stackDir, '--mode', 'prod'], stdinText: JSON.stringify(facts), write: (l) => out.push(l) });
          preflight.push(out.some((l) => l.startsWith('⚠️ [F5]')) ? 'F5' : 'no F5');
        }
      },
    });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /==> 事後の確かめ: エラー 0 件、注意 0 件。\nℹ️ \[P13\] 通ったデプロイを記録しました（\.deploy\/last-green\.json）。\n/);
    assert.deepEqual(Object.keys(r.record), ['at', 'commit', 'stackEnvSha256']);
    assert.equal(r.record.stackEnvSha256, sha256(VM_ENV));
    assert.equal(r.record.commit, 'c'.repeat(40));
    assert.deepEqual(preflight, ['no F5', 'F5'], 'the record\'s hash equals the 事前チェック\'s; a changed stack.env warns');
    assert.deepEqual(r.facts, [{ profiles: 'tts,tunnel', cloudflared: 'healthy', unitStack: 'enabled', retentionLines: 1 }]);
    assert.deepEqual(modeOf(r.docker), ['prod']);
  });

  it('standalone: production rules, the profiles from stack.env (or this shell), no deploy record', async () => {
    const alone = await runCheck();
    assert.equal(alone.status, 0, alone.out);
    assert.equal(alone.record, null, 'a standalone run never records a stack.env that was not deployed');
    assert.equal(alone.git.length, 0);
    assert.deepEqual(alone.facts.map((f) => f.profiles), ['tts,tunnel']);
    // Review round 1 of Stage 2, finding 1: the last line, read as bash reads it (a # comment after the value or
    // after its closing quote included); any line or value this cannot read is `unreadable` (P15), never ''.
    const line = (/** @type {string} */ text) => VM_ENV.replace('COMPOSE_PROFILES=tts,tunnel', text);
    /** @type {[string, Record<string, string>, string][]} */
    const cases = [
      [line('export COMPOSE_PROFILES="tts"'), {}, 'tts'],
      [line("COMPOSE_PROFILES='tts, tunnel'"), {}, 'tts,tunnel'],
      [line('COMPOSE_PROFILES="tts,tunnel" # public edge'), {}, 'tts,tunnel'],
      [line("COMPOSE_PROFILES='tts' # c"), {}, 'tts'],
      [line('COMPOSE_PROFILES=tts,tunnel # c'), {}, 'tts,tunnel'],
      [line('  export  COMPOSE_PROFILES=tts\t# c'), {}, 'tts'],
      [line('COMPOSE_PROFILES='), { COMPOSE_PROFILES: 'tts' }, ''],
      [line('COMPOSE_PROFILES=""  # none yet'), { COMPOSE_PROFILES: 'tts' }, ''],
      [VM_ENV.replace('COMPOSE_PROFILES=tts,tunnel\n', ''), { COMPOSE_PROFILES: 'tts' }, 'tts'],
      [line('COMPOSE_PROFILES=tts\nCOMPOSE_PROFILES=tts,tunnel'), {}, 'tts,tunnel'],
      // Fail closed:
      [VM_ENV.replace('COMPOSE_PROFILES=tts,tunnel\n', ''), { COMPOSE_PROFILES: 'tts,"$(x)"' }, 'unreadable'],
      [line('COMPOSE_PROFILES=tts;x'), {}, 'unreadable'],
      [line('COMPOSE_PROFILES=TTS'), {}, 'unreadable'],
      [line('COMPOSE_PROFILES=tts tunnel'), {}, 'unreadable'],
      [line('COMPOSE_PROFILES=tts#x'), {}, 'unreadable'],
      [line('COMPOSE_PROFILES="tts\''), {}, 'unreadable'],
      [line('COMPOSE_PROFILES="tts" x'), {}, 'unreadable'],
      [line('COMPOSE_PROFILES=tts,tunnel\nCOMPOSE_PROFILES="tts" x'), {}, 'unreadable'],
    ];
    for (const [stackEnv, env, want] of cases) {
      const r = await runCheck({ stackEnv, env });
      assert.deepEqual(r.facts.map((f) => f.profiles), [want], `${JSON.stringify(stackEnv.match(/^.*COMPOSE_PROFILES[^]*?$/m)?.[0])} ${JSON.stringify(env)}`);
      assert.ok(validateFacts(r.facts[0]));
    }
  });

  it('standalone, the reviewer\'s line: a quoted list with a comment still checks P4 and P5; an unreadable one stops with P15 (exit 1)', async () => {
    const asked = (/** @type {string[][]} */ docker) => docker.filter((a) => a.includes('{{.Health}}')).length;
    const commented = await runCheck({ stackEnv: VM_ENV.replace('COMPOSE_PROFILES=tts,tunnel', 'COMPOSE_PROFILES="tts,tunnel" # public edge'), health: 'unhealthy' });
    assert.equal(commented.status, 1, commented.out);
    assert.equal(asked(commented.docker), 1, 'cloudflared\'s health is asked');
    assert.match(commented.out, /^❌ \[P5\] /m);
    assert.match(commented.out, /==> 確かめたコード: P1、P2、P3、P4、P5、P6、P8\n/);
    const unreadable = await runCheck({ stackEnv: VM_ENV.replace('COMPOSE_PROFILES=tts,tunnel', 'COMPOSE_PROFILES=TTS,tunnel') });
    assert.equal(unreadable.status, 1, unreadable.out);
    assert.match(unreadable.out, /^❌ \[P15\] /m);
    assert.equal(unreadable.record, null);
  });

  it('cloudflared\'s health is asked only in production with tunnel; a tunnel that is not healthy is P5 and no record', async () => {
    const asked = (/** @type {string[][]} */ docker) => docker.filter((a) => a.includes('{{.Health}}')).length;
    const bad = await runCheck({ args: DEPLOY, health: 'unhealthy' });
    assert.equal(bad.status, 1, bad.out);
    assert.match(bad.out, /^❌ \[P5\] 公開の入り口（cloudflared）が healthy ではありません。$/m);
    assert.equal(bad.record, null);
    assert.equal(asked(bad.docker), 1);
    const odd = await runCheck({ args: DEPLOY, health: 'Healthy; x' });
    assert.deepEqual(odd.facts.map((f) => f.cloudflared), [''], 'anything but a lower-case word is sent as empty');
    assert.equal(asked((await runCheck({ args: [...DEPLOY.slice(0, -1), 'tts'] })).docker), 0, 'no tunnel');
    // CI mode with tunnel in the list (the CI template has none; the deploy passes whatever it computed).
    const ci = await runCheck({ args: [...CI_DEPLOY.slice(0, -1), 'tunnel'], stackEnv: TEMPLATE });
    assert.equal(ci.status, 0, ci.out);
    assert.equal(asked(ci.docker), 0, 'CI mode');
    assert.deepEqual(ci.facts.map((f) => f.cloudflared), ['']);
    assert.deepEqual(modeOf(ci.docker), ['ci']);
    assert.equal(ci.record, null, 'no record in CI mode');
    assert.deepEqual(ci.git, [], 'CI makes no git call');
  });

  // Review round 1 of Stage 2, finding 3: the record vouches only for the stack.env the 事前チェック read.
  it('P16: from the deploy, a stack.env that is not the one deploy-stack.sh hashed (or no hash) is never recorded; exit 1', async () => {
    const p16 = /** @type {{ title: string, fix: string }} */ (POSTDEPLOY_CODES.find((c) => c.code === 'P16'));
    const at = DEPLOY.indexOf('--stack-sha') + 1;
    for (const given of [sha256(`${VM_ENV}# edited during the deploy\n`), '', 'A'.repeat(64), 'x']) {
      const r = await runCheck({ args: [...DEPLOY.slice(0, at), given, ...DEPLOY.slice(at + 1)] });
      assert.equal(r.status, 1, `${given}: ${r.out}`);
      assert.ok(r.out.endsWith(`❌ [P16] ${p16.title}\n   直し方: ${p16.fix}\n   くわしく: 手順書 13 章の「P16」\n`), r.out);
      assert.equal(r.record, null, given);
      assert.doesNotMatch(r.out, /\[P13\]/);
    }
    const noFlag = await runCheck({ args: DEPLOY.filter((_, i) => i !== at - 1 && i !== at) });
    assert.equal(noFlag.status, 1, noFlag.out);
    assert.match(noFlag.out, /^❌ \[P16\] /m);
    assert.equal(noFlag.record, null);
    // The probe's errors come first: P16 is only about a run that would otherwise be recorded.
    state.mcp = { db: 'error' };
    const errors = await runCheck({ args: [...DEPLOY.slice(0, at), '', ...DEPLOY.slice(at + 1)] });
    assert.equal(errors.status, 1);
    assert.doesNotMatch(errors.out, /\[P16\]/);
    reset();
    // Standalone and CI mode never record, so the hash is not asked for.
    assert.equal((await runCheck()).status, 0);
    const ci = await runCheck({ args: CI_DEPLOY, stackEnv: TEMPLATE });
    assert.equal(ci.status, 0, ci.out);
  });

  it('the boot unit and the retention line: warnings only, the record is still written', async () => {
    const r = await runCheck({ args: DEPLOY, unit: 'disabled', retention: 0 });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^⚠️ \[P6\] /m);
    assert.match(r.out, /^⚠️ \[P8\] /m);
    assert.ok(r.record);
    assert.deepEqual((await runCheck({ args: DEPLOY, retention: 3 })).facts.map((f) => f.retentionLines), [3]);
  });

  it('the probe\'s status: 10 → exit 1, 11 → exit 2 (the probe printed P0), anything else (the api is not running) → P0, exit 2; never a record', async () => {
    state.mcp = { db: 'error' };
    const errors = await runCheck({ args: DEPLOY });
    assert.equal(errors.status, 1, errors.out);
    assert.match(errors.out, /^❌ \[P2\] /m);
    assert.equal(errors.record, null);
    reset();
    /** @type {[number, number, number][]} */
    const table = [[10, 1, 0], [11, 2, 0], [1, 2, 1], [125, 2, 1], [137, 2, 1]];
    for (const [probeStatus, exit, p0] of table) {
      const r = await runCheck({ args: DEPLOY, probeStatus });
      assert.equal(r.status, exit, `${probeStatus}: ${r.out}`);
      assert.equal((r.out.match(/\[P0\]/g) ?? []).length, p0, `${probeStatus}: P0 lines`);
      assert.equal(r.record, null, `${probeStatus}: no record`);
    }
  });
});
