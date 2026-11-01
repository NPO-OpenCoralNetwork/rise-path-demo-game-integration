// @ts-check
// 事前チェック (preflight) engine (Phase 9, owner decision D2): scripts/deploy/env-parse.mjs and
// scripts/deploy/preflight-rules.mjs. The design's tests T1 (a hit and a near miss per rule, per stage and
// per CI column), T2a (no rule copies a value into a finding), T2b (the formatter drops what is not a
// name), T3 (the two templates), T4 (the parser, with a bash parity table), T5 (the launch record),
// T5b (the profiles the deploy passes to Compose) and T6 (the catalog against the repo). The CLI and the
// VM wrapper: preflightCli.test.js; the runbook's 13 and 14 章: firstLaunchRunbook.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ERROR_KINDS, entryMap, parseEnvText } from '../../scripts/deploy/env-parse.mjs';
import {
  ATTESTATIONS, COMPOSE_INTERPOLATED, FACT_KEYS, INTERNAL_CODES, KNOWN_KEYS, NAME_UNSHOWN, PROFILE_NAMES, RETENTION_RANGES,
  RULES, SERVICE_PROFILES, STAGES, checkStack, effectiveProfiles, formatFindings, isCiDummyStack, isDeployToolName, isKnownKey, levelAt, readSwitch,
  recordValuesAsWritten, resolveStage, validateFacts,
} from '../../scripts/deploy/preflight-rules.mjs';
import { readEnvSwitch } from '../utils/envSwitch.js';
import { RETENTION_RULES } from '../services/retention.js';
import { BASE_STACK, FIXTURES, GOOD_MCP, NOW, PG_PASSWORD, PILOT_ID, PILOT_ID_2, baseFacts, buildInput, envText, sentinel } from './helpers/preflightFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STACK = path.join(ROOT, 'deploy/risepath-vm');
const read = (/** @type {string} */ file) => fs.readFileSync(file, 'utf8');

/** @param {import('../../scripts/deploy/preflight-rules.mjs').Finding[]} findings @param {string} code */
const of = (findings, code) => findings.filter((f) => f.code === code);
/** @param {import('../../scripts/deploy/preflight-rules.mjs').Finding[]} findings */
const errors = (findings) => [...new Set(findings.filter((f) => f.level === 'E').map((f) => f.code))].sort();

describe('the base fixture (a finished production stack)', () => {
  for (const stage of STAGES) {
    it(`has no finding at ${stage}, in prod and in CI mode`, () => {
      assert.deepEqual(checkStack(buildInput(stage)), []);
      assert.deepEqual(checkStack(buildInput(stage, {}, 'ci')), []);
    });
  }
});

describe('T1: each rule fires on its fixture and not on the near miss, per stage and CI column', () => {
  const S = 'SENTINELX9F30000000000000000';
  it('every rule of the catalog has a fixture, and the fixture agrees with the catalog', () => {
    assert.deepEqual(FIXTURES.map((f) => f.code), RULES.map((r) => r.code));
    for (const f of FIXTURES) {
      const rule = /** @type {import('../../scripts/deploy/preflight-rules.mjs').Rule} */ (RULES.find((r) => r.code === f.code));
      assert.equal(f.ci, rule.ci, `${f.code}: CI column`);
      if (rule.level !== 'dyn') {
        for (const [i, stage] of STAGES.entries()) assert.equal(f.levels[i], levelAt(f.code, stage) ?? '-', `${f.code} at ${stage}`);
      }
    }
  });
  for (const fixture of FIXTURES) {
    it(`${fixture.code}: hit at ${fixture.levels}, CI ${fixture.ci}; the near miss never`, () => {
      for (const [i, stage] of STAGES.entries()) {
        const hit = of(checkStack(buildInput(stage, fixture.hit(S))), fixture.code);
        const want = fixture.levels[i];
        if (want === '-') assert.equal(hit.length, 0, `${fixture.code} must not fire at ${stage}`);
        else assert.deepEqual([...new Set(hit.map((f) => f.level))], [want], `${fixture.code} at ${stage}`);
        assert.equal(of(checkStack(buildInput(stage, fixture.miss)), fixture.code).length, 0, `${fixture.code} near miss at ${stage}`);
      }
      const ciHit = of(checkStack(buildInput('pilot', fixture.hit(S), 'ci')), fixture.code);
      assert.equal(ciHit.length > 0, fixture.ci === 'run', `${fixture.code} in CI mode`);
      assert.equal(of(checkStack(buildInput('pilot', fixture.miss, 'ci')), fixture.code).length, 0);
    });
  }

  it('named cases (finding 9): RISEPATH_STRICT_AUTH=true is allowed, =1 is C9', () => {
    assert.equal(of(checkStack(buildInput('pilot', { stack: { RISEPATH_STRICT_AUTH: 'true' } })), 'C9').length, 0);
    assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { RISEPATH_STRICT_AUTH: '1' } })), 'C9')[0].names, ['RISEPATH_STRICT_AUTH']);
    assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { E2E_BASE_URL: 'x', SMOKE_TARGET: 'y', RISEPATH_DEPLOY_SKIP_PULL: '1' } })), 'C9')[0].names, ['E2E_BASE_URL', 'SMOKE_TARGET', 'RISEPATH_DEPLOY_SKIP_PULL']);
  });

  it('named cases: a custom Supabase domain is D1 W (not E); an http one is E', () => {
    assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { SUPABASE_URL: 'https://auth.example.org' } })), 'D1').map((f) => f.level), ['W']);
    assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' } })), 'D1').map((f) => f.level), ['E']);
    assert.deepEqual(of(checkStack(buildInput('pilot', { mcp: { SUPABASE_URL: 'https://abc.supabase.co.example.org' } })), 'D1').map((f) => [f.level, f.file]), [['W', 'mcp-public.env']]);
  });

  it('named cases: the same webhook URL twice is not D4; two empty or template secrets are not D4', () => {
    const hooks = 'https://hooks.slack.com/services/T9/B9/q';
    assert.equal(of(checkStack(buildInput('pilot', { stack: { AI_CAP_ALERT_WEBHOOK_URL: hooks, SAFETY_ALERT_WEBHOOK_URL: hooks } })), 'D4').length, 0);
    assert.equal(of(checkStack(buildInput('pilot', { stack: { HERMES_API_KEY: '', OPENROUTER_API_KEY: '', MEMANTO_SECRET_KEY: '' } })), 'D4').length, 0);
    assert.equal(of(checkStack(buildInput('pilot', { stack: { HERMES_API_KEY: 'change-me', OPENROUTER_API_KEY: 'change-me' } })), 'D4').length, 0);
  });

  it('named cases: C11 with the tunnel and TRUST_PROXY other than 1 is a warning; F6 under 10 GB is a warning with the GB', () => {
    assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { TRUST_PROXY: '2' } })), 'C11').map((f) => f.level), ['W']);
    assert.equal(of(checkStack(buildInput('pilot', { stack: { TRUST_PROXY: null, COMPOSE_PROFILES: 'tts' } })), 'C11').length, 0);
    assert.deepEqual(of(checkStack(buildInput('pilot', { facts: { diskFreeKb: 8 * 1024 * 1024 + 5 } })), 'F6'), [{ code: 'F6', level: 'W', gb: 8 }]);
  });

  it('named cases: S4 refuses a live Stripe key even with DECIDED_BILLING; G3 fires before public once the legal pages are dated', () => {
    const live = `sk_live_${'x'.repeat(4)}`;
    assert.equal(of(checkStack(buildInput('pilot', { billing: { STRIPE_SECRET_KEY: live }, record: { DECIDED_BILLING: '2026-11-01' } })), 'S4').length, 1);
    assert.equal(of(checkStack(buildInput('pilot', { stack: { ACCOUNT_DELETION_ENABLED: 'false' }, record: { VERCEL_LEGAL_PAGES_ON: '2026-11-01' } })), 'G3').length, 1);
  });

  it('named cases: V1 at setup is a warning without the tunnel and an error with it', () => {
    assert.deepEqual(of(checkStack(buildInput('setup', { record: { VERCEL_PROTECTION_ON: '' }, stack: { COMPOSE_PROFILES: 'tts' } })), 'V1').map((f) => f.level), ['W']);
    assert.deepEqual(of(checkStack(buildInput('setup', { record: { VERCEL_PROTECTION_ON: '' } })), 'V1').map((f) => f.level), ['E']);
    // Protection dated but already off: no longer protected below public.
    assert.deepEqual(of(checkStack(buildInput('pilot', { record: { VERCEL_PROTECTION_OFF: '2026-11-02' } })), 'V1').map((f) => f.level), ['E']);
  });

  it('A1: without stack.env nothing else is checked', () => {
    assert.deepEqual(checkStack(buildInput('pilot', { noStack: true })), [{ code: 'A1', level: 'E' }]);
  });

  it('B5 names what deploy-stack.sh refuses in mcp-public.env (names only)', () => {
    const found = of(checkStack(buildInput('pilot', {
      stack: { COMPOSE_PROFILES: 'tts,byoa' },
      mcp: { DATABASE_URL_PHASE1: 'postgresql://risepath_app:x@db:5432/risepath', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: 'a', MCP_PUBLIC_RESOURCE_URL: 'https://mcp.example.org/mcp', ANTHROPIC_API_KEY: 'k', HERMES_X: 'y', APP_PUBLIC_URL: 'https://app.your-domain.example' },
    })), 'B5');
    assert.deepEqual(found[0].names, ['COMPOSE_PROFILES', 'APP_PUBLIC_URL', 'ANTHROPIC_API_KEY', 'HERMES_X', 'DATABASE_URL_PHASE1']);
  });

  it('A6 does not repeat a name another finding already names in that file', () => {
    const found = checkStack(buildInput('pilot', { stack: { RISEPATH_DEPLOY_SKIP_PULL: '1', TYPO_NAME: 'x' } }));
    assert.deepEqual(of(found, 'A6').flatMap((f) => f.names), ['TYPO_NAME']);
  });

  // Review round 1, finding 2: the server's Memanto bridge is on for anything but exactly `false`
  // (learnerMemoryBridge.js isMemantoEnabled), and Compose always sets MEMANTO_API_URL.
  it('S3 reads MEMANTO_ENABLED as the server does: 1, TRUE, no, yes, False are on (S3 E, not C14); empty and false are off', () => {
    for (const value of ['1', 'TRUE', 'no', 'yes', 'False', 'true', 'off', '0']) {
      for (const stage of STAGES) {
        const found = checkStack(buildInput(stage, { stack: { MEMANTO_ENABLED: value } }));
        assert.deepEqual(of(found, 'S3').map((f) => f.level), ['E'], `${value} at ${stage}`);
        assert.ok(!of(found, 'C14').some((f) => f.names?.includes('MEMANTO_ENABLED')), `${value}: C14 never names MEMANTO_ENABLED`);
      }
      assert.equal(of(checkStack(buildInput('pilot', { stack: { MEMANTO_ENABLED: value }, record: { DECIDED_MEMORY: '2026-11-01' } })), 'S3').length, 0, `${value} with DECIDED_MEMORY`);
    }
    for (const value of ['false', '', null]) assert.equal(of(checkStack(buildInput('pilot', { stack: { MEMANTO_ENABLED: value } })), 'S3').length, 0, String(value));
  });
  it('S3 also fires for a MEMANTO_API_URL other than Compose\'s default (learner memory would go to that host)', () => {
    assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { MEMANTO_API_URL: 'https://mem.example.net' } })), 'S3').map((f) => f.level), ['E']);
    for (const url of ['http://memanto:8000', '', null]) assert.equal(of(checkStack(buildInput('pilot', { stack: { MEMANTO_API_URL: url } })), 'S3').length, 0, String(url));
  });

  // Finding 3: billing.env reaches the api after stack.env (env_file order), so a policy name there
  // would override stack.env where the C rules never look.
  it('A8: billing.env holds only STRIPE_*, BILLING_* and AI_CAP_SUPPORTER_GLOBAL_* (its example passes)', () => {
    const policy = { LLM_MOCK_FALLBACK: 'true', ANTHROPIC_BASE_URL: 'http://evil.example', TRUST_PROXY: 'true', LLM_PROVIDER: 'mock', RISE_PATH_ACTIVE_SESSION_KEY: 'abc', LLM_TASK_TUTOR_CHAT: 'mock', VITE_FEATURE_AGENT_CHAT: 'true', RP_LESSON_FS_WRITE: '1' };
    for (const [key, value] of Object.entries(policy)) {
      const found = of(checkStack(buildInput('pilot', { billing: { BILLING_ENABLED: '', [key]: value } })), 'A8');
      assert.deepEqual(found, [{ code: 'A8', level: 'E', file: 'billing.env', names: [key] }], key);
    }
    const example = read(path.join(STACK, 'billing.env.example'));
    const files = { ...buildInput('pilot').files, 'billing.env': example };
    assert.equal(of(checkStack({ ...buildInput('pilot'), files }), 'A8').length, 0, 'billing.env.example as billing.env');
    assert.equal(of(checkStack(buildInput('pilot', { billing: { AI_CAP_SUPPORTER_GLOBAL_LLM: '100', STRIPE_PRICE_ID: 'price_x', BILLING_TOS_URL: '' } })), 'A8').length, 0);
  });

  // Finding 7: `set -a; source stack.env` exports every name to git, docker and the re-run.
  it('C8 refuses names that change the deploy\'s tools: DOCKER_*, COMPOSE_* (not COMPOSE_PROFILES), BASH*, PATH, IFS, ENV, HOME, LD_*, GIT_*, bash\'s read-only names', () => {
    const names = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'COMPOSE_ENV_FILES', 'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'PATH', 'IFS', 'ENV', 'HOME', 'BASH', 'BASH_ENV',
      'LD_PRELOAD', 'LD_LIBRARY_PATH', 'GIT_SSH_COMMAND', 'GIT_DIR', 'UID', 'EUID', 'PPID', 'SHELLOPTS', 'BASHOPTS', 'BASH_VERSINFO', 'SCRIPT_DIR', 'STACK_DIR', 'REPO_ROOT'];
    for (const name of names) {
      assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { [name]: 'x' } })), 'C8').map((f) => [f.level, f.names]), [['E', [name]]], name);
      assert.equal(of(checkStack(buildInput('pilot', { stack: { [name]: 'x' } }, 'ci')), 'C8').length, 0, `${name}: C8 skips in CI mode`);
    }
    for (const name of ['COMPOSE_PROFILES', 'POSTGRES_USER', 'GITHUB_X', 'DOCKERFILE', 'PATHS', 'HOMEPAGE']) assert.ok(!isDeployToolName(name), name);
  });
  it('C8 or C9 refuses every variable deploy-stack.sh sets before it sources stack.env (a stack.env line would change it)', () => {
    const script = read(path.join(STACK, 'scripts/deploy-stack.sh'));
    const head = script.slice(0, script.indexOf('source stack.env'));
    const assigned = [...head.matchAll(/^\s*(?:readonly\s+|export\s+|local\s+)?([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]);
    assert.ok(assigned.includes('REPO_ROOT') && assigned.includes('RISEPATH_CALLER_SKIP_PULL'), assigned.join(' '));
    for (const name of assigned) {
      const found = checkStack(buildInput('pilot', { stack: { [name]: 'x' } }));
      assert.ok(of(found, 'C8').length + of(found, 'C9').length > 0, name);
    }
  });
  it('C8 refuses bash\'s read-only variables (sourcing stack.env would stop on them)', { skip: spawnSync('bash', ['-c', 'true']).status === 0 ? false : 'needs bash' }, () => {
    const out = spawnSync('bash', ['-c', 'readonly -p'], { encoding: 'utf8', env: { PATH: process.env.PATH } }).stdout;
    const names = [...out.matchAll(/^declare -\S+ ([A-Z_][A-Z0-9_]*)/gm)].map((m) => m[1]);
    assert.ok(names.includes('UID'), out);
    for (const name of names) assert.ok(isDeployToolName(name), name);
  });

  // Finding 8.
  it('D2: a `%` typo in the user part of DATABASE_URL_PHASE1 is D2, not an exception', () => {
    const found = checkStack(buildInput('pilot', { stack: { DATABASE_URL_PHASE1: `postgresql://risepath%ZZapp:${PG_PASSWORD}@db:5432/risepath` } }));
    assert.deepEqual(of(found, 'D2').map((f) => f.names), [['DATABASE_URL_PHASE1', 'POSTGRES_USER']]);
  });
  // Review round 2, finding 5: the D2 and B5 branches no fixture reached.
  it('D2: a password that does not decode (`%zz`) is compared as written: equal is no D2 and no exception, different is D2', () => {
    const raw = 'pg%zz0123456789abcdef0123456789';
    assert.ok(raw.length >= 24);
    const same = checkStack(buildInput('pilot', { stack: { POSTGRES_PASSWORD: raw, DATABASE_URL_PHASE1: `postgresql://risepath_app:${raw}@db:5432/risepath` } }));
    assert.deepEqual(of(same, 'D2'), []);
    const other = checkStack(buildInput('pilot', { stack: { DATABASE_URL_PHASE1: `postgresql://risepath_app:${raw}@db:5432/risepath` } }));
    assert.deepEqual(of(other, 'D2').map((f) => f.names), [['DATABASE_URL_PHASE1', 'POSTGRES_PASSWORD']]);
  });
  it('D2: a URL that is not postgres, or does not parse, names DATABASE_URL_PHASE1 only', () => {
    for (const url of [`mysql://risepath_app:${PG_PASSWORD}@db:5432/risepath`, '//db/risepath']) {
      assert.deepEqual(of(checkStack(buildInput('pilot', { stack: { DATABASE_URL_PHASE1: url } })), 'D2').map((f) => f.names), [['DATABASE_URL_PHASE1']], url);
    }
  });
  it('B5: byoa (with the tunnel) and no mcp-public.env names the four values that file must hold', () => {
    const found = checkStack(buildInput('pilot', { stack: { COMPOSE_PROFILES: 'tts,tunnel,byoa' }, record: { DECIDED_BYOA: '2026-11-01' } }));
    assert.deepEqual(of(found, 'B5').map((f) => f.names), [['DATABASE_URL_PHASE1', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'MCP_PUBLIC_RESOURCE_URL']]);
  });
  it('C4 reads the provider as the server does (trimmed, lower case, before `:`)', () => {
    for (const stack of [{ LLM_PROVIDER: 'Anthropic' }, { LLM_PROVIDER: 'ANTHROPIC' }, { LLM_PROVIDER: 'anthropic:some-model' }, { LLM_PROVIDER: "' anthropic '" }, { LLM_TASK_TUTOR_CHAT: 'Anthropic:any-model' }, { LLM_TASK_TUTOR_CHAT: "' anthropic'" }]) {
      assert.equal(of(checkStack(buildInput('pilot', { stack })), 'C4').length, 0, JSON.stringify(stack));
    }
    for (const [stack, names] of /** @type {[Record<string, string>, string[]][]} */ ([[{ LLM_PROVIDER: 'Gemini' }, ['LLM_PROVIDER']], [{ LLM_PROVIDER: 'mock' }, ['LLM_PROVIDER']], [{ LLM_TASK_TUTOR_CHAT: 'MOCK' }, ['LLM_TASK_TUTOR_CHAT']], [{ LLM_TASK_X: 'gemini:any' }, ['LLM_TASK_X']]])) {
      assert.deepEqual(of(checkStack(buildInput('pilot', { stack })), 'C4').map((f) => f.names), [names], JSON.stringify(stack));
    }
  });
});

// Review round 1, finding 13: a file that exists but the deploy user cannot read (root-owned after
// `sudo cp`) is A7 as an error, by its name; before, the CLI stopped on X0 with no hint.
describe('A7: a file the deploy user cannot read', () => {
  it('stack.env unreadable: only A7 E for it (not A1, nothing else can be checked)', () => {
    const input = buildInput('pilot', { noStack: true });
    assert.deepEqual(checkStack({ ...input, unreadable: ['stack.env'] }), [{ code: 'A7', level: 'E', file: 'stack.env' }]);
    assert.deepEqual(checkStack({ ...input, unreadable: ['stack.env', 'billing.env'] }).map((f) => [f.code, f.level, f.file]), [['A7', 'E', 'stack.env'], ['A7', 'E', 'billing.env']]);
  });
  it('the record or another env file unreadable: A7 E naming it, and no A13 for an unreadable record', () => {
    const noRecord = buildInput('pilot', { record: null });
    const found = checkStack({ ...noRecord, unreadable: ['launch-record.env'] });
    assert.deepEqual(of(found, 'A7'), [{ code: 'A7', level: 'E', file: 'launch-record.env' }]);
    assert.equal(of(found, 'A13').length, 0);
    const tunnel = checkStack({ ...buildInput('pilot', { tunnel: null }), unreadable: ['tunnel.env'] });
    assert.deepEqual(of(tunnel, 'A7'), [{ code: 'A7', level: 'E', file: 'tunnel.env' }]);
    assert.ok(of(checkStack({ ...buildInput('pilot'), unreadable: ['not-a-file.env'] }), 'A7').length === 0, 'only the five file names');
    assert.equal(of(checkStack({ ...buildInput('pilot', { noStack: true }), unreadable: ['stack.env'] }, ), 'A7')[0].level, 'E');
  });
  it('formats as the catalog\'s A7 lines with the file name', () => {
    const lines = formatFindings([{ code: 'A7', level: 'E', file: 'stack.env' }], { mode: 'prod', stage: 'setup' });
    assert.ok(lines.includes('❌ [A7] stack.env の権限が 600 でないか、持ち主がちがいます。'), lines.join('\n'));
  });
});

// Review round 1, finding 5: CI mode needs the CI template's own dummy markers, not only equality with
// the template in the same checkout.
describe('isCiDummyStack: the CI template\'s dummy markers (X3)', () => {
  const template = read(path.join(STACK, 'ci/stack.ci.env'));
  it('holds for ci/stack.ci.env as it is', () => {
    assert.equal(isCiDummyStack(template), true);
  });
  it('fails for each marker taken away', () => {
    const swap = (/** @type {RegExp} */ re, /** @type {string} */ line) => {
      assert.match(template, re);
      return template.replace(re, line);
    };
    const variants = {
      'no first line': template.split('\n').slice(1).join('\n'),
      'a real Supabase URL': swap(/^SUPABASE_URL=.*$/m, 'SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co'),
      'a real service key': swap(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, 'SUPABASE_SERVICE_ROLE_KEY=srk0123456789abcdef'),
      'a model key': swap(/^ANTHROPIC_API_KEY=.*$/m, 'ANTHROPIC_API_KEY=ak0123456789'),
      'profiles': swap(/^COMPOSE_PROFILES=.*$/m, 'COMPOSE_PROFILES=tts,tunnel,byoa'),
      'an edge secret': swap(/^ORIGIN_SECRET=.*$/m, 'ORIGIN_SECRET=os0123456789abcdef0123456789abcdef'),
      'the VM project': swap(/^COMPOSE_PROJECT_NAME=.*$/m, 'COMPOSE_PROJECT_NAME=risepath'),
      'a second SUPABASE_URL below': `${template}SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\n`,
      'a tunnel token': `${template}TUNNEL_TOKEN=t0123456789\n`,
    };
    for (const [label, text] of Object.entries(variants)) assert.equal(isCiDummyStack(text), false, label);
  });
});

describe('T2a: no rule copies a value into a finding (finding 24)', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.code}: the sentinel inside the triggering value never reaches a raw finding`, () => {
      const S = sentinel();
      for (const stage of STAGES) {
        for (const mode of /** @type {const} */ (['prod', 'ci'])) {
          const findings = checkStack(buildInput(stage, fixture.hit(S), mode));
          assert.ok(!JSON.stringify(findings).includes(S), `${fixture.code} ${stage} ${mode}`);
          assert.ok(!JSON.stringify(findings).toLowerCase().includes(S.toLowerCase()), `${fixture.code} ${stage} ${mode} (any case)`);
        }
        if (fixture.levels[STAGES.indexOf(stage)] !== '-') {
          assert.ok(of(checkStack(buildInput(stage, fixture.hit(S))), fixture.code).length > 0, `${fixture.code} still fires at ${stage}`);
        }
      }
    });
  }
});

describe('T2b: the formatter prints only names, file names and whole numbers', () => {
  const S = sentinel();
  const lower = S.toLowerCase();
  const bad = [
    { code: 'A6', level: 'W', file: 'stack.env', names: [lower] },
    { code: 'A6', level: 'W', file: 'stack.env', names: [`${S}-X`] },
    { code: 'A6', level: 'W', file: 'stack.env', names: [`${S}=1`] },
    { code: 'A6', level: 'W', file: 'stack.env', names: [`${S} X`] },
    { code: 'A6', level: 'W', file: `${S}.env`, names: ['NODE_ENV'] },
    { code: 'A9', level: 'E', file: 'stack.env', line: /** @type {any} */ (S) },
    { code: 'A9', level: 'E', file: 'stack.env', line: 1.5 },
    { code: 'F6', level: 'E', gb: /** @type {any} */ (`${S}`) },
    { code: 'B1', level: 'E', names: /** @type {any} */ (S) },
    { code: S, level: 'E', names: ['NODE_ENV'] },
    { code: 'B1', level: /** @type {any} */ (S), names: ['NODE_ENV'] },
  ];
  it('drops every non-name and prints the placeholder instead', () => {
    const text = formatFindings(/** @type {any} */ (bad), { mode: 'prod', stage: 'pilot' }).join('\n');
    assert.ok(!text.includes(S) && !text.toLowerCase().includes(lower), text);
    assert.ok(text.includes(NAME_UNSHOWN));
    assert.ok(text.includes('[X0]'), 'an unknown code is printed as X0, never as given');
  });
  it('keeps a valid name next to a dropped one, and the compose service names', () => {
    const text = formatFindings([{ code: 'A4', level: 'W', file: 'stack.env', names: ['NODE_ENV', lower] }, { code: 'F3', level: 'W', names: ['kokoro-tts'] }], { mode: 'prod', stage: 'pilot' }).join('\n');
    assert.match(text, /NODE_ENV、（名前を表示できません）/);
    assert.match(text, /（kokoro-tts）/);
  });
  it('prints the header, each finding with its fix and the 13 章 pointer, and the counts', () => {
    const lines = formatFindings([{ code: 'B2', level: 'E' }, { code: 'F9', level: 'I' }, { code: 'C2', level: 'W', names: ['GEMINI_API_KEY'] }], { mode: 'prod', stage: 'pilot' });
    assert.deepEqual(lines, [
      '==> 事前チェック（preflight.sh）: 本番の決まり / 公開の段階 pilot（launch-record.env から）',
      '❌ [B2] `ANTHROPIC_API_KEY` が空です（AI の機能が動きません）',
      '   直し方: Anthropic のコンソールで、この VM 用の鍵を作って書きます（手順書 3.5）。',
      '   くわしく: 手順書 13 章の「B2」',
      '⚠️ [C2] Gemini の鍵が入っています: GEMINI_API_KEY（使われませんが、空にする決まりです）',
      '   直し方: stack.env の、その値を空にします。',
      '   くわしく: 手順書 13 章の「C2」',
      'ℹ️ [F9] 新しい DB です。`POSTGRES_PASSWORD` は、この最初の起動で固定されます。',
      '   直し方: あとで `POSTGRES_PASSWORD` を変えないでください（変えるときは、エージェントに相談します）。',
      '   くわしく: 手順書 13 章の「F9」',
      '==> 事前チェック: エラー 1 件、注意 1 件、お知らせ 1 件。エラーを直すまで、デプロイは止まります（何も変えていません）。',
    ]);
    const ci = formatFindings([], { mode: 'ci', stage: 'setup' });
    assert.equal(ci[0], '（CI モード: 本番だけの決まりを飛ばしています）');
    assert.equal(ci.at(-1), '==> 事前チェック: エラー 0 件、注意 0 件、お知らせ 0 件（何も変えていません）。');
  });
});

describe('T3: the two templates', () => {
  it('stack.env.example (as bootstrap-vm.sh copies it): B1 for the five names and B2', () => {
    const found = checkStack({ mode: 'prod', files: { 'stack.env': read(path.join(STACK, 'stack.env.example')) }, facts: baseFacts(), lastGreen: null, now: NOW });
    assert.deepEqual(of(found, 'B1')[0].names, ['POSTGRES_PASSWORD', 'DATABASE_URL_PHASE1', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RISE_PATH_BRIDGE_TOKEN']);
    assert.deepEqual(errors(found), ['B1', 'B2']);
  });
  it('ci/stack.ci.env: zero errors in CI mode; in prod mode A2, B2, C8, D1, D3 and G1 (its deletion switch)', () => {
    const text = read(path.join(STACK, 'ci/stack.ci.env'));
    const facts = { ...baseFacts(), pgdataVolume: false };
    assert.deepEqual(errors(checkStack({ mode: 'ci', files: { 'stack.env': text }, facts, lastGreen: null, now: NOW })), []);
    assert.deepEqual(errors(checkStack({ mode: 'prod', files: { 'stack.env': text }, facts, lastGreen: null, now: NOW })), ['A2', 'B2', 'C8', 'D1', 'D3', 'G1']);
  });
});

describe('T4: the parser reads what bash would, and flags what bash would run, expand or fail on', () => {
  /** @param {string} text */
  const kinds = (text) => parseEnvText(text).problems.map((p) => p.kind);
  it('reads NAME=value, export, quotes, comments, blank lines and a value after =', () => {
    const p = parseEnvText("# c\n\nA=1\nexport B=two\nC='x y'\nD=\"p q\"\n  E=e # note\nF=\nG==g\nH='a b' # c\n");
    assert.deepEqual([...entryMap(p.entries)], [['A', '1'], ['B', 'two'], ['C', 'x y'], ['D', 'p q'], ['E', 'e'], ['F', ''], ['G', '=g'], ['H', 'a b']]);
    assert.deepEqual(p.problems.map((x) => [x.kind, x.line]), [['hash', 7]]);
  });
  it('reports a line that is not an assignment by its number only (a pasted value is never a key)', () => {
    const p = parseEnvText('SECRETVALUE\nNAME: v\nNAME = v\nNAME+=v\nexport NAME\n1A=x\nA-B=x\n');
    assert.deepEqual(p.problems, [1, 2, 3, 4, 5, 6, 7].map((line) => ({ kind: 'not-assignment', line })));
    assert.deepEqual(p.entries, []);
  });
  it('classifies runs, expands, backslash, quotes, hash, CRLF and duplicates', () => {
    assert.deepEqual(kinds('A=x y\n'), ['runs']);
    for (const ch of [';', '&', '|', '<', '>', '(', ')']) assert.deepEqual(kinds(`A=x${ch}y\n`), ['runs'], ch);
    assert.deepEqual(kinds('A=$X\n'), ['expands']);
    assert.deepEqual(kinds('A=`id`\n'), ['expands']);
    assert.deepEqual(kinds('A="$X"\n'), ['expands']);
    assert.deepEqual(kinds('A=~/x\n'), ['expands']);
    assert.deepEqual(kinds("A='$X'\n"), []);
    assert.deepEqual(kinds('A=x\\y\n'), ['backslash']);
    assert.deepEqual(kinds('A="x\\y"\n'), ['backslash']);
    assert.deepEqual(kinds("A='x\n"), ['unbalanced-quote']);
    assert.deepEqual(kinds('A="x\n'), ['unbalanced-quote']);
    assert.deepEqual(kinds("A=x'y'\n"), ['stray-quote']);
    assert.deepEqual(kinds('A="x"y\n'), ['stray-quote']);
    assert.deepEqual(kinds('A=x#y\n'), ['hash']);
    assert.deepEqual(kinds('A=x #y\n'), ['hash']);
    assert.deepEqual(kinds('A=x\t #y\n'), ['hash']);
    assert.deepEqual(kinds('A=x\r\nB=y\r\n'), ['crlf']);
    assert.deepEqual(kinds('A=1\nA=2\n'), ['duplicate']);
    assert.ok(!ERROR_KINDS.includes('hash') && !ERROR_KINDS.includes('duplicate'));
  });
  // Review round 2, finding 2: bash brace-expands the argument of `export` (`export K={a,b}` is
  // `export K=a K=b`), never a plain assignment; Compose has no brace expansion.
  it('an unquoted { on an export line expands (bash brace expansion); a plain assignment or a quoted value does not', () => {
    for (const line of ['export K={a,b}', 'export K=x{1..2}', 'export K=a{b,c}d', 'export\tK={a,b}']) assert.deepEqual(kinds(`${line}\n`), ['expands'], line);
    for (const line of ['K={a,b}', "export K='{a,b}'", 'export K="{a,b}"']) assert.deepEqual(kinds(`${line}\n`), [], line);
    const found = checkStack(buildInput('pilot', { stackExtra: 'export LLM_GUEST_AI={false,true}\n' }));
    assert.deepEqual(of(found, 'A5').map((f) => [f.level, f.names]), [['E', ['LLM_GUEST_AI']]]);
  });
  // Review round 3, finding 2: Compose trims the white space before an unquoted value and cuts a comment
  // only at ` #`, so a `#` after an empty value or right after a tab reaches the container, while bash drops it.
  it('a # comment after an empty value or right after a tab is an error (comment: Compose keeps it, bash drops it); after a space it is hash', () => {
    for (const line of ['A= #x', 'A=\t#x', 'A=  #', 'A=v\t#x', 'A=v \t#x', 'A=v\t#x #y']) assert.deepEqual(kinds(`${line}\n`), ['comment'], JSON.stringify(line));
    for (const line of ['A=v #x', 'A=v\t #x', 'A=v  #x', 'A=#x']) assert.deepEqual(kinds(`${line}\n`), ['hash'], JSON.stringify(line));
    for (const line of ['A="a"\t#x', "A='a'\t#x", 'A="a" #x']) assert.deepEqual(kinds(`${line}\n`), [], JSON.stringify(line));
    assert.ok(ERROR_KINDS.includes('comment'));
    const found = checkStack(buildInput('pilot', { stackExtra: 'LLM_MOCK_FALLBACK=false\t# off\nKOKORO_TTS_DEFAULT_VOICE_EN= # later\n' }));
    assert.deepEqual(of(found, 'A5').map((f) => [f.level, f.file, f.names]), [['E', 'stack.env', ['LLM_MOCK_FALLBACK', 'KOKORO_TTS_DEFAULT_VOICE_EN']]]);
    assert.deepEqual(of(found, 'A14'), [], 'the error replaces the warning');
  });
  it('flags a white-space character other than space and tab in an unquoted value (space: Compose trims it, bash keeps it)', () => {
    for (const ch of ['\u3000', '\u00a0', '\u2003', '\u000b', '\u000c', '\u0085', '\u2028']) {
      for (const value of [`true${ch}`, `${ch}true`, `a${ch}b`]) assert.deepEqual(kinds(`A=${value}\n`), ['space'], JSON.stringify(value));
      assert.deepEqual(kinds(`A="true${ch}"\nB='true${ch}'\n`), [], 'quoted: both keep it');
    }
    assert.deepEqual(kinds('A=true\u200b\nB=true\ufeff\n'), [], 'not White_Space: both keep it');
    assert.ok(ERROR_KINDS.includes('space'));
    const found = checkStack(buildInput('pilot', { stack: { LLM_MOCK_FALLBACK: 'true\u3000' } }));
    assert.deepEqual(of(found, 'A5').map((f) => [f.level, f.file, f.names]), [['E', 'stack.env', ['LLM_MOCK_FALLBACK']]]);
  });

  // Final review, finding 1: Compose reads `\'` inside single quotes as an escaped quote, so an odd run
  // of backslashes before the closing quote runs past it (and prints the value); bash ends the value there.
  it('an odd run of backslashes right before a closing single quote is backslash (Compose runs past the quote); an even run or one inside is not', () => {
    for (const line of ["K='a\\'", "K='\\'", "K='a\\\\\\'", "K='a\\' # c"]) assert.deepEqual(kinds(`${line}\n`), ['backslash'], JSON.stringify(line));
    for (const line of ["K='a\\\\'", "K='a\\b'", "K='\\\\'"]) assert.deepEqual(kinds(`${line}\n`), [], JSON.stringify(line));
    assert.ok(ERROR_KINDS.includes('backslash'));
    const found = checkStack(buildInput('pilot', { stack: { ORIGIN_SECRET: `'${'o'.repeat(40)}\\'` } }));
    assert.deepEqual(of(found, 'A5').map((f) => [f.level, f.file, f.names]), [['E', 'stack.env', ['ORIGIN_SECRET']]]);
  });

  // What Compose (v5.6.0, `docker compose config` with this file as env_file; review round 1) gives the
  // container for each unquoted or quoted value: trailing Unicode White_Space trimmed from unquoted
  // values only. Either the parser reports an error kind, or it reads exactly Compose's value.
  it('parity with Compose: every line is flagged, or the parser reads Compose\'s value', () => {
    /** @type {[string, string][]} */
    const table = [
      ['true\u3000', 'true'], ['true\u00a0', 'true'], ['true\u2003', 'true'], ['true\u000b', 'true'], ['true\u000c', 'true'],
      ['true\u0085', 'true'], ['true\u2028', 'true'], ['\u3000true', '\u3000true'], ['a\u3000b', 'a\u3000b'], ['a\u00a0b', 'a\u00a0b'],
      ['true\u200b', 'true\u200b'], ['true\ufeff', 'true\ufeff'], ['"true\u3000"', 'true\u3000'], ["'true\u00a0'", 'true\u00a0'],
      ['true', 'true'], ['true\t', 'true'], ['true ', 'true'],
      // Review round 3, finding 2 (Compose v5.6.0, measured again for this round): `#` after white space.
      [' #x', '#x'], ['\t#x', '#x'], [' # c', '# c'], ['  #', '#'], ['v\t#x', 'v\t#x'], ['v \t#x', 'v \t#x'], ['v\t#x #y', 'v\t#x'],
      ['true\t# c', 'true\t# c'], ['false\t#x', 'false\t#x'], ['v\t#', 'v\t#'], ['v #x', 'v'], ['v\t #x', 'v'], ['v  #x', 'v'],
      ['v #x #y', 'v'], ['v #', 'v'], ['#x', '#x'], ['v#x', 'v#x'], ['"a"\t#x', 'a'], ['"a" #x', 'a'], ["'a'\t#x", 'a'], [' ', ''], ['\t', ''],
      // Final review, finding 1: an even run of backslashes before the closing single quote, or one inside it.
      ["'a\\\\'", 'a\\\\'], ["'a\\b'", 'a\\b'],
    ];
    for (const [value, compose] of table) {
      const parsed = parseEnvText(`K=${value}\n`);
      const flagged = parsed.problems.some((p) => ERROR_KINDS.includes(p.kind));
      assert.ok(flagged || entryMap(parsed.entries).get('K') === compose, JSON.stringify(value));
    }
    // Files Compose v5.6.0 refuses (`unterminated quoted value …` or `unexpected character "'" in variable
    // name …`, each printing a value; final review, finding 1): the parser must report an error kind.
    const rejected = ["K='a\\'\nB=x\n", "K='\\'\n", "K='a\\'\nB='xyz'\n", "K='a\\\\\\'\n", "K='a\\' # c\n"];
    for (const text of rejected) {
      const parsed = parseEnvText(text);
      assert.ok(parsed.problems.some((p) => ERROR_KINDS.includes(p.kind)), `Compose fails on ${JSON.stringify(text)}, the parser must report an error`);
    }
  });

  // Each case: either bash fails on it (and the parser reports an error kind), or bash assigns the
  // value the parser reports. A case the parser calls an error may still succeed in bash (the parser
  // is stricter, never looser).
  const bash4 = spawnSync('bash', ['-c', 'x=A; : "${x,,}"']).status === 0;
  it('parity with bash: set -euo pipefail; set -a; source', { skip: bash4 ? false : 'needs bash ≥ 4' }, () => {
    const cases = [
      'K=plain', 'K=', 'export K=x', "K='a b'", 'K="a b"', 'K=a b', 'K=a;b', 'K=a&b', 'K=a|b', 'K=(a)', 'K=$HOME', 'K=${HOME}',
      'K=`echo x`', 'K="$HOME"', 'K=a\\b', "K='unclosed", 'K="unclosed', "K=a'b'", 'K=a#b', 'K=a #b', 'K=~', 'K=x:~/y',
      'K=a=b', 'K="a" # c', "K='a$b'", 'K=a\r', 'K = v', 'K: v', 'K', 'eyJhbGciOiJ', 'K==b', 'K=  ', 'K=ä', 'K=a b c',
      // Review round 2, finding 2: brace expansion after export (bash gives K=b and K=x2).
      'export K={a,b}', 'export K=x{1..2}', 'export K={a}', 'K={a,b}', "export K='{a,b}'", 'export K=*', 'K=*',
      // Review round 3, finding 2: a comment after white space.
      'K= #x', 'K=\t#x', 'K=v\t#x', 'K=v\t #x', 'K=v #x #y', 'K="a"\t#x',
      // Final review, finding 1: bash reads these; the parser flags the first two (Compose runs past the quote).
      "K='a\\'", "K='\\'", "K='a\\\\'",
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-parity-'));
    try {
      for (const line of cases) {
        const file = path.join(dir, 'f');
        fs.writeFileSync(file, `${line}\n`);
        const run = spawnSync('bash', ['-c', 'set -euo pipefail; set -a; source ./f > /dev/null 2>&1; printf %s "${K-<unset>}"'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/nonexistent-home' } });
        const parsed = parseEnvText(`${line}\n`);
        const flagged = parsed.problems.some((p) => ERROR_KINDS.includes(p.kind));
        const value = entryMap(parsed.entries).get('K');
        if (run.status !== 0) {
          assert.ok(flagged, `bash fails on ${JSON.stringify(line)}, the parser must report an error`);
        } else if (!flagged) {
          assert.equal(run.stdout, value ?? '<unset>', `value of ${JSON.stringify(line)}`);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('T5: the launch record', () => {
  /** @param {string} stage @param {import('./helpers/preflightFixtures.js').Mod} mod @param {string} code */
  const codeAt = (stage, mod, code) => of(checkStack(buildInput(stage, mod)), code);
  it('A11: dates that are not calendar dates, an unknown or missing stage, a bad key id, text over 80 characters', () => {
    assert.deepEqual(codeAt('pilot', { record: { ALERT_TEST: '2026-02-30', BACKUP_LIFECYCLE: '2026/11/01' } }, 'A11')[0].names, ['BACKUP_LIFECYCLE', 'ALERT_TEST']);
    assert.deepEqual(codeAt('pilot', { record: { LAUNCH_STAGE: 'Pilot' } }, 'A11')[0].names, ['LAUNCH_STAGE']);
    assert.deepEqual(codeAt('pilot', { record: { LAUNCH_STAGE: null } }, 'A11')[0].names, ['LAUNCH_STAGE']);
    assert.deepEqual(codeAt('pilot', { record: { BACKUP_KEY_ID: '0123456789ABCDEF' } }, 'A11')[0].names, ['BACKUP_KEY_ID']);
    assert.deepEqual(codeAt('pilot', { record: { ALERT_WATCHER: 'x'.repeat(81) } }, 'A11')[0].names, ['ALERT_WATCHER']);
    assert.equal(codeAt('pilot', { record: { ALERT_WATCHER: 'あ'.repeat(80) } }, 'A11').length, 0);
  });
  it('A11 and K4 measure a text key whole: the record is never sourced, so a space does not end it', () => {
    const long = `${'あい '.repeat(26)}あいう`; // 81 characters, with spaces
    assert.equal(long.length, 81);
    assert.deepEqual(codeAt('pilot', { record: { ALERT_WATCHER: long } }, 'A11')[0].names, ['ALERT_WATCHER']);
    assert.deepEqual(codeAt('pilot', { record: { ALERT_WATCHER: long } }, 'K4').map((f) => [f.level, f.names]), [['W', ['ALERT_WATCHER']]]);
    assert.deepEqual(codeAt('minors', { record: { ALERT_CHECK: `"${long}"` } }, 'A11')[0].names, ['ALERT_CHECK'], 'quoted: the quotes do not count');
    assert.equal(codeAt('pilot', { record: { ALERT_WATCHER: long.slice(0, 80) } }, 'A11').length, 0);
    assert.equal(codeAt('minors', { record: { ALERT_WATCHER: '事務局の当番（2 人）', ALERT_CHECK: '平日の 10 時と 16 時' } }, 'K4').length, 0);
    assert.deepEqual(
      [...recordValuesAsWritten('export ALERT_WATCHER="事務局 の 当番"\r\nALERT_CHECK=  平日 の 朝  \nALERT_CHECK=夕方\nnot a line\n')],
      [['ALERT_WATCHER', '事務局 の 当番'], ['ALERT_CHECK', '夕方']],
    );
  });
  // Review round 3, finding 1: the last line of a name wins, so a record key written twice could turn a gate off
  // (a template's empty line under a dated one) or lower the stage; it stops the deploy. Any other name twice warns.
  it('A4: a record key written twice is an error (the last line wins); another name twice is a warning', () => {
    const findings = checkStack(buildInput('pilot', { recordExtra: 'LAUNCH_STAGE=setup\n' }));
    assert.deepEqual(of(findings, 'A4'), [{ code: 'A4', level: 'E', file: 'launch-record.env', names: ['LAUNCH_STAGE'] }]);
    assert.equal(of(checkStack(buildInput('pilot')), 'A4').length, 0);
    assert.deepEqual(of(checkStack(buildInput('pilot', { recordExtra: 'ALERT_TEST=2026-11-01\n' })), 'A4').map((f) => f.level), ['E'], 'the same date twice too');
    const other = checkStack(buildInput('pilot', { recordExtra: 'OWNER_NOTE=a\nOWNER_NOTE=b\n' }));
    assert.deepEqual(of(other, 'A4').map((f) => [f.level, f.names]), [['W', ['OWNER_NOTE']]]);
    assert.ok(!other.some((f) => f.level === 'E'), 'a far unknown name never stops the deploy');
    // The stack's env files keep the warning (bash and Compose agree on the last line there).
    assert.deepEqual(of(checkStack(buildInput('pilot', { stackExtra: 'KOKORO_TTS_DEFAULT_VOICE_EN=a\nKOKORO_TTS_DEFAULT_VOICE_EN=b\n' })), 'A4').map((f) => f.level), ['W']);
  });
  /** A record at a stage with `key` taken out of the template lines and written on the two given lines instead. */
  const twoLines = (/** @type {string} */ stage, /** @type {string} */ key, /** @type {string[]} */ values, /** @type {import('./helpers/preflightFixtures.js').Mod} */ mod = {}) => checkStack(buildInput(stage, {
    ...mod, record: { ...mod.record, [key]: null }, recordExtra: values.map((v) => `${key}=${v}\n`).join(''),
  }));
  it('invariant (two lines): below public, a dated VERCEL_PROTECTION_OFF line stops the deploy above or below an empty one', () => {
    for (const stage of ['setup', 'pilot', 'minors']) {
      for (const values of [['2026-11-05', ''], ['', '2026-11-05'], ['2026-11-05', '2026-11-05'], [' 2026-11-05', ''], ['2026-11-05', '""']]) {
        const found = twoLines(stage, 'VERCEL_PROTECTION_OFF', values);
        const stops = found.some((f) => f.level === 'E' && (f.code === 'V1' || ((f.code === 'A4' || f.code === 'A11') && f.names?.includes('VERCEL_PROTECTION_OFF'))));
        assert.ok(stops, `${stage} ${JSON.stringify(values)}`);
      }
    }
  });
  it('invariant (two lines): a dated VERCEL_LEGAL_PAGES_ON with deletion off stops the deploy, above or below an empty line', () => {
    for (const stage of ['setup', 'pilot', 'minors']) {
      for (const values of [['2026-11-05', ''], ['', '2026-11-05']]) {
        const found = twoLines(stage, 'VERCEL_LEGAL_PAGES_ON', values, { stack: { ACCOUNT_DELETION_ENABLED: 'false' } });
        assert.ok(found.some((f) => f.level === 'E' && (f.code === 'G3' || (f.code === 'A4' && f.names?.includes('VERCEL_LEGAL_PAGES_ON')))), `${stage} ${JSON.stringify(values)}`);
      }
    }
  });
  it('invariant (two lines): a stage written above a lower one never passes as the lower stage', () => {
    for (const [i, upper] of STAGES.entries()) {
      for (const lower of STAGES.slice(0, i)) {
        const found = twoLines(upper, 'LAUNCH_STAGE', [upper, lower]);
        assert.ok(found.some((f) => f.level === 'E' && f.code === 'A4' && f.names?.includes('LAUNCH_STAGE')), `${upper} above ${lower}`);
      }
    }
  });
  // Review round 3, finding 4: the stage line is read shell-style, so text after a space used to be dropped.
  it('A11 for a stage line with more text after a space or a tab (`setup → pilot`, `setup pilot`, `pilot;`); a # memo is fine', () => {
    for (const value of ['setup → pilot', 'setup pilot', 'setup\tpublic', 'public\tpilot', 'pilot;', 'pilot x', '"pilot']) {
      const recordExtra = `LAUNCH_STAGE=${value}\n`;
      assert.deepEqual(resolveStage(`LAUNCH_STAGE=${value}\n`), { stage: 'setup', source: 'unreadable' }, JSON.stringify(value));
      const found = checkStack(buildInput('pilot', { record: { LAUNCH_STAGE: null }, recordExtra }));
      assert.deepEqual(of(found, 'A11').map((f) => [f.level, f.names]), [['E', ['LAUNCH_STAGE']]], JSON.stringify(value));
    }
    for (const value of ['pilot # now', 'pilot\t# now', 'pilot  # 10.1 から', "'pilot' # now", 'pilot ']) {
      assert.deepEqual(resolveStage(`LAUNCH_STAGE=${value}\n`), { stage: 'pilot', source: 'record' }, JSON.stringify(value));
    }
  });
  // Review round 3, finding 5: a text key holds one line of text (design §2.4); a control character or a line
  // separator inside it is A11, and K4 does not count it as written.
  it('A11 and K4 for a text key with a control character or a line separator inside (U+2028, CR, U+0007)', () => {
    for (const key of ['ALERT_WATCHER', 'ALERT_CHECK']) {
      for (const value of ['当番\u2028x', '当番\rx', '当番\u0007', '当番\u0085x', '当番\u2029x']) {
        const found = checkStack(buildInput('pilot', { record: { [key]: value } }));
        assert.deepEqual(of(found, 'A11').map((f) => [f.level, f.names]), [['E', [key]]], `${key} ${JSON.stringify(value)}`);
        assert.deepEqual(of(found, 'K4').map((f) => [f.level, f.names]), [['W', [key]]], `${key} ${JSON.stringify(value)}`);
      }
      assert.equal(of(checkStack(buildInput('pilot', { record: { [key]: '当番 x\u00a0y' } })), 'A11').length, 0, 'other white space is text');
    }
  });
  it('an unreadable stage is checked as setup, and says so', () => {
    assert.deepEqual(resolveStage('LAUNCH_STAGE=later\n'), { stage: 'setup', source: 'unreadable' });
    assert.deepEqual(resolveStage(undefined), { stage: 'setup', source: 'missing' });
    assert.deepEqual(resolveStage('LAUNCH_STAGE=minors\n'), { stage: 'minors', source: 'record' });
  });
  // Review round 1, finding 1: A11 and the stage rules read the stage one way, so a stage with a space
  // around it (an IME's U+3000, U+00A0) is A11, never a silent setup with every gate off.
  it('A11 for a stage written with a space around it: "pilot ", " public", pilot+U+3000, pilot+U+00A0', () => {
    for (const value of ['"pilot "', '" public"', 'pilot\u3000', 'pilot\u00a0', "'minors '"]) {
      const found = checkStack(buildInput('pilot', { record: { LAUNCH_STAGE: value, BACKUP_LIFECYCLE: '' } }));
      assert.deepEqual(of(found, 'A11').map((f) => [f.level, f.names]), [['E', ['LAUNCH_STAGE']]], JSON.stringify(value));
      assert.ok(found.some((f) => f.level === 'E'), 'the deploy stops');
    }
  });
  it('invariant: every record whose stage is unreadable has an A11 error naming LAUNCH_STAGE; a readable one never', () => {
    const spellings = ['setup', 'pilot', 'minors', 'public', '"pilot"', "'public'", 'pilot # now', 'Pilot', 'PUBLIC', 'later', '', '"pilot "', '" public"',
      'pilot\u3000', '\u3000pilot', 'pilot\u00a0', 'pilot\u2003', 'pi lot', 'pilot\r', '"pilot', 'pilot;', 'pilot,public', '$STAGE', 'ｐｉｌｏｔ', 'pilot\u200b'];
    for (const value of spellings) {
      for (const recordExtra of ['', `LAUNCH_STAGE=${value}\n`]) {
        const input = buildInput('pilot', recordExtra ? { recordExtra } : { record: { LAUNCH_STAGE: value } });
        const { source } = resolveStage(input.files['launch-record.env']);
        const a11 = of(checkStack(input), 'A11').filter((f) => f.names?.includes('LAUNCH_STAGE'));
        if (source === 'unreadable') assert.deepEqual(a11.map((f) => f.level), ['E'], JSON.stringify(value));
        else assert.equal(a11.length, 0, JSON.stringify(value));
      }
    }
  });
  // Review round 2, finding 1: the dates and the key id are read as written, never shell-style (where
  // `KEY= 2026-11-05` is empty): a space or a tab after = never turns a gate off.
  it('V1 and G3 read a date written with a space or a tab after =, as written', () => {
    for (const pad of [' ', '\t', '  ', ' \t', '\u3000']) {
      const off = { VERCEL_PROTECTION_OFF: `${pad}2026-11-05` };
      assert.deepEqual(codeAt('pilot', { record: off }, 'V1').map((f) => f.level), ['E'], `V1 ${JSON.stringify(pad)}`);
      assert.deepEqual(codeAt('minors', { record: off }, 'V1').map((f) => f.level), ['E'], `V1 minors ${JSON.stringify(pad)}`);
      assert.equal(codeAt('pilot', { record: off }, 'A11').length, 0, 'read, so not unreadable');
      const legal = { stack: { ACCOUNT_DELETION_ENABLED: 'false' }, record: { VERCEL_LEGAL_PAGES_ON: `${pad}2026-11-05` } };
      assert.deepEqual(codeAt('pilot', legal, 'G3').map((f) => f.level), ['E'], `G3 ${JSON.stringify(pad)}`);
    }
    // The other date rules and the key id read the same way (no R4, R5 for a padded but right value).
    assert.equal(codeAt('pilot', { record: { BACKUP_LIFECYCLE: ' 2026-11-01' } }, 'R5').length, 0);
    assert.equal(codeAt('pilot', { record: { BACKUP_KEY_ID: '\t0123456789abcdef', BACKUP_KEY_COPY: ' 2026-11-01' } }, 'R4').length, 0);
    assert.deepEqual(codeAt('public', { record: { VERCEL_PROTECTION_ON: ' 2026-11-03', VERCEL_PROTECTION_OFF: '\t2026-11-02' } }, 'V3')[0].names, ['VERCEL_PROTECTION_ON', 'VERCEL_PROTECTION_OFF']);
  });
  it('invariant: below public and without a pilot list, a VERCEL_PROTECTION_OFF line with anything in it stops the deploy (V1, or A11 naming it)', () => {
    const spellings = ['2026-11-05', ' 2026-11-05', '\t2026-11-05', '2026-11-05 ', '"2026-11-05"', "' 2026-11-05'", '\u30002026-11-05', '2026-11-05\u3000',
      '2026-11-05 # 外した', '2026/11/05', '２０２６-１１-０５', '2026−11−05', '2026-11-05 2026-11-06', '"2026-11-05', '$DATE', 'yes', '2026-11-05;', 'x 2026-11-05'];
    for (const value of spellings) {
      for (const stage of ['setup', 'pilot', 'minors']) {
        const found = checkStack(buildInput(stage, { record: { VERCEL_PROTECTION_OFF: value } }));
        const stops = found.some((f) => f.level === 'E' && (f.code === 'V1' || (f.code === 'A11' && f.names?.includes('VERCEL_PROTECTION_OFF'))));
        assert.ok(stops, `${stage} ${JSON.stringify(value)}`);
      }
    }
  });
  it('A10: an unknown record name a typo away from a record key is an error (that record would be dropped); any other name is a warning', () => {
    for (const name of ['VERCEL_PROTECTON_OFF', 'VERCEL_PROTECTION_OF', 'VERCEL_PROTECTION_OFF_', 'vercel_protection_off', 'VERCEL_LEGAL_PAGE_ON', 'ALERT_WATCHR', 'LAUNCH_STAGES']) {
      assert.deepEqual(codeAt('pilot', { recordExtra: `${name}=2026-11-05\n` }, 'A10').map((f) => [f.level, f.names]), [['E', [name]]], name);
    }
    for (const name of ['OWNER_NOTE', 'MEMO', 'VERCEL_OFF']) assert.deepEqual(codeAt('pilot', { recordExtra: `${name}=x\n` }, 'A10').map((f) => f.level), ['W'], name);
    // The reviewer's case: protection written off under a misspelt name, no V1 (protection reads as on), the deploy stops on A10.
    const found = checkStack(buildInput('pilot', { recordExtra: 'VERCEL_PROTECTON_OFF=2026-11-05\n' }));
    assert.deepEqual(of(found, 'V1'), []);
    assert.ok(found.some((f) => f.level === 'E' && f.code === 'A10'));
  });
  it('A12: a date after today + 1 day', () => {
    assert.equal(codeAt('pilot', { record: { ALERT_TEST: '2026-11-21' } }, 'A12').length, 0);
    assert.deepEqual(codeAt('pilot', { record: { ALERT_TEST: '2026-11-22' } }, 'A12')[0].names, ['ALERT_TEST']);
  });
  it('G1: the three checks in order, both ways', () => {
    assert.deepEqual(codeAt('pilot', { record: { SUPABASE_CURRENT_PASSWORD_ON: '2026-11-02', PASSWORD_CHANGE_CHECK: '2026-11-01', PROD_AMR_CHECK: '2026-11-03' } }, 'G1')[0].names,
      ['SUPABASE_CURRENT_PASSWORD_ON', 'PASSWORD_CHANGE_CHECK', 'PROD_AMR_CHECK']);
    assert.equal(codeAt('pilot', { record: { SUPABASE_CURRENT_PASSWORD_ON: '2026-11-01', PASSWORD_CHANGE_CHECK: '2026-11-02', PROD_AMR_CHECK: '2026-11-03' } }, 'G1').length, 0);
    assert.equal(codeAt('pilot', { record: { SUPABASE_CURRENT_PASSWORD_ON: '2026-11-04', PROD_AMR_CHECK: '2026-11-03' } }, 'G1').length, 1);
    assert.deepEqual(codeAt('pilot', { record: { PASSWORD_CHANGE_CHECK: '2026-13-01' } }, 'G1')[0].names, ['PASSWORD_CHANGE_CHECK']);
  });
  it('A13: a missing record is a warning before the first green deploy without the tunnel, else an error', () => {
    const w = codeAt('setup', { record: null, lastGreen: null, stack: { COMPOSE_PROFILES: 'tts' } }, 'A13');
    assert.deepEqual(w.map((f) => f.level), ['W']);
    assert.deepEqual(codeAt('setup', { record: null, lastGreen: null }, 'A13').map((f) => f.level), ['E'], 'tunnel listed');
    assert.deepEqual(codeAt('setup', { record: null, stack: { COMPOSE_PROFILES: 'tts' } }, 'A13').map((f) => f.level), ['E'], 'a green deploy exists');
    assert.deepEqual(codeAt('setup', { record: null, lastGreen: {}, stack: { COMPOSE_PROFILES: 'tts' } }, 'A13').map((f) => f.level), ['E'], 'a damaged deploy record still counts');
  });
  // Review round 3, finding 3: a deploy record the deploy user cannot read is A15, and it still counts for A13.
  it('A15: an unreadable deploy record is an error and still counts as a green deploy (A13 E)', () => {
    const found = checkStack(buildInput('setup', { record: null, lastGreen: null, unreadable: ['.deploy/last-green.json'], stack: { COMPOSE_PROFILES: 'tts' } }));
    assert.deepEqual(of(found, 'A15').map((f) => f.level), ['E']);
    assert.deepEqual(of(found, 'A13').map((f) => f.level), ['E']);
    assert.deepEqual(of(found, 'A7'), [], 'not A7: it is not one of the five files');
    assert.deepEqual(of(checkStack(buildInput('setup', { record: null, lastGreen: null, stack: { COMPOSE_PROFILES: 'tts' } })), 'A13').map((f) => f.level), ['W']);
  });
  it('R3: a drill older than 35 days is a warning at pilot and minors and an error at public; R4 compares the key id', () => {
    const old = new Date(NOW.getTime() - 36 * 24 * 3600_000).toISOString();
    assert.deepEqual(STAGES.map((stage) => codeAt(stage, { facts: { drillLastOk: old } }, 'R3').map((f) => f.level).join('')), ['', 'W', 'W', 'E']);
    assert.deepEqual(codeAt('pilot', { facts: { backupKeyId: 'fedcba9876543210' } }, 'R4')[0].names, ['BACKUP_KEY_ID']);
    assert.equal(codeAt('pilot', { facts: { backupKeyId: '' } }, 'R4').length, 0, 'no backup yet: nothing to compare (R1 speaks)');
    assert.deepEqual(codeAt('pilot', { record: { BACKUP_KEY_COPY: '', BACKUP_KEY_ID: '' } }, 'R4')[0].names, ['BACKUP_KEY_COPY', 'BACKUP_KEY_ID']);
  });
  // Final review, finding 6: restore-db.sh's RS0 (preflight.sh --for-restore) must pass at public with an old drill or none
  // (a drill cannot pass while backups have stopped); a deploy or a standalone check still stops at public.
  it('R3 for a restore (from: restore) is a warning at every stage but setup, old or missing; otherwise unchanged; the facts accept only the three froms', () => {
    const old = new Date(NOW.getTime() - 36 * 24 * 3600_000).toISOString();
    const levels = (/** @type {Record<string, unknown>} */ facts) => STAGES.map((stage) => codeAt(stage, { facts }, 'R3').map((f) => f.level).join(''));
    assert.deepEqual(levels({ drillLastOk: old, from: 'restore' }), ['', 'W', 'W', 'W']);
    assert.deepEqual(levels({ drillLastOk: '', from: 'restore' }), ['', 'W', 'W', 'W']);
    assert.deepEqual(levels({ drillLastOk: old, from: 'standalone' }), ['', 'W', 'W', 'E']);
    assert.deepEqual(levels({ drillLastOk: old, from: 'deploy' }), ['', 'W', 'W', 'E']);
    assert.deepEqual(levels({ drillLastOk: '', from: 'deploy' }), ['', 'E', 'E', 'E']);
    for (const from of ['deploy', 'standalone', 'restore']) assert.ok(validateFacts({ ...baseFacts(), from }), from);
    for (const from of ['', 'Restore', 'other']) assert.ok(!validateFacts({ ...baseFacts(), from }), from);
  });
  it('V3: protection off at public, on or after the day it went on (the order rule ON ≤ OFF), both ways', () => {
    assert.deepEqual(codeAt('public', { record: { VERCEL_PROTECTION_ON: '2026-11-03', VERCEL_PROTECTION_OFF: '2026-11-02' } }, 'V3')[0].names, ['VERCEL_PROTECTION_ON', 'VERCEL_PROTECTION_OFF']);
    assert.equal(codeAt('public', { record: { VERCEL_PROTECTION_ON: '2026-11-02', VERCEL_PROTECTION_OFF: '2026-11-02' } }, 'V3').length, 0);
    assert.deepEqual(codeAt('public', { record: { VERCEL_PROTECTION_OFF: '' } }, 'V3')[0].names, ['VERCEL_PROTECTION_OFF']);
  });

  // Phase 9 stage 3 (D1; design §3.5, §2.5 V1-V4): the pilot list, read from stack.env as the api reads it.
  const LIST = `${PILOT_ID},${PILOT_ID_2}`;
  it('V1 branch (a): a valid pilot list lets the edge open below public, protection on or off', () => {
    for (const stage of ['setup', 'pilot', 'minors']) {
      for (const record of [{ VERCEL_PROTECTION_OFF: '2026-11-02' }, { VERCEL_PROTECTION_ON: '' }, { VERCEL_PROTECTION_ON: '', VERCEL_PROTECTION_OFF: '' }]) {
        assert.equal(codeAt(stage, { stack: { PILOT_ACCOUNT_IDS: LIST }, record }, 'V1').length, 0, `${stage} ${JSON.stringify(record)}`);
      }
      // One upper-case id is still an id (the api compares in lower case); quoted as bash and Compose read it.
      assert.equal(codeAt(stage, { stack: { PILOT_ACCOUNT_IDS: PILOT_ID.toUpperCase() }, record: { VERCEL_PROTECTION_OFF: '2026-11-02' } }, 'V1').length, 0);
      assert.equal(codeAt(stage, { stackExtra: `PILOT_ACCOUNT_IDS="${LIST}"\n`, record: { VERCEL_PROTECTION_OFF: '2026-11-02' } }, 'V1').length, 0, `${stage} quoted`);
    }
  });
  it('V1: an empty, blank or partly invalid list is no list (protection off → V1 E below public; V2 names the bad entries)', () => {
    for (const value of ['', `${PILOT_ID},nope`, `${PILOT_ID},`, ',', 'nope', `${PILOT_ID};${PILOT_ID_2}`, `{${PILOT_ID}}`, PILOT_ID.replace(/-/g, '')]) {
      for (const stage of ['pilot', 'minors']) {
        const found = checkStack(buildInput(stage, { stack: { PILOT_ACCOUNT_IDS: value }, record: { VERCEL_PROTECTION_OFF: '2026-11-02' } }));
        assert.deepEqual(of(found, 'V1').map((f) => f.level), ['E'], `${stage} ${JSON.stringify(value)}`);
      }
    }
    // The list in another file is not the api's list (A8 refuses it in billing.env; tunnel.env never reaches the api).
    const found = checkStack(buildInput('pilot', { tunnel: { TUNNEL_TOKEN: 'eyJhIjoiYiJ9', PILOT_ACCOUNT_IDS: LIST }, record: { VERCEL_PROTECTION_OFF: '2026-11-02' } }));
    assert.deepEqual(of(found, 'V1').map((f) => f.level), ['E']);
  });
  it('V2: one finding per entry that is not a UUID, by position (never the entry), at most 10; an empty value is no list', () => {
    assert.deepEqual(codeAt('pilot', { stack: { PILOT_ACCOUNT_IDS: `${PILOT_ID},abc,${PILOT_ID_2},,x` } }, 'V2'), [{ code: 'V2', level: 'E', n: 2 }, { code: 'V2', level: 'E', n: 4 }, { code: 'V2', level: 'E', n: 5 }]);
    assert.deepEqual(codeAt('pilot', { stack: { PILOT_ACCOUNT_IDS: ',' } }, 'V2').map((f) => f.n), [1, 2], 'set with no valid id (the api refuses everyone)');
    assert.equal(codeAt('pilot', { stack: { PILOT_ACCOUNT_IDS: Array.from({ length: 15 }, () => 'x').join(',') } }, 'V2').length, 10);
    for (const value of ['', null]) assert.equal(codeAt('pilot', { stack: { PILOT_ACCOUNT_IDS: value } }, 'V2').length, 0, String(value));
    assert.equal(codeAt('pilot', { stack: { PILOT_ACCOUNT_IDS: `${PILOT_ID.toUpperCase()},${PILOT_ID_2}` } }, 'V2').length, 0);
  });
  it('V3 at public: the list still set (any value) is an error naming PILOT_ACCOUNT_IDS; an empty line is no list', () => {
    assert.deepEqual(codeAt('public', { stack: { PILOT_ACCOUNT_IDS: LIST } }, 'V3').map((f) => [f.level, f.names]), [['E', ['PILOT_ACCOUNT_IDS']]]);
    assert.deepEqual(codeAt('public', { stack: { PILOT_ACCOUNT_IDS: 'nope' } }, 'V3')[0].names, ['PILOT_ACCOUNT_IDS']);
    assert.deepEqual(codeAt('public', { stack: { PILOT_ACCOUNT_IDS: LIST }, record: { VERCEL_PROTECTION_OFF: '' } }, 'V3')[0].names, ['PILOT_ACCOUNT_IDS', 'VERCEL_PROTECTION_OFF']);
    assert.equal(codeAt('public', { stack: { PILOT_ACCOUNT_IDS: '' } }, 'V3').length, 0);
    for (const stage of ['setup', 'pilot', 'minors']) assert.equal(codeAt(stage, { stack: { PILOT_ACCOUNT_IDS: LIST } }, 'V3').length, 0, stage);
  });
  it('V4: byoa (listed or decided) with the list is an error at every stage; either alone is not V4', () => {
    for (const stage of STAGES) {
      assert.deepEqual(codeAt(stage, { stack: { PILOT_ACCOUNT_IDS: LIST }, record: { DECIDED_BYOA: '2026-11-02' } }, 'V4').map((f) => [f.level, f.names]), [['E', ['DECIDED_BYOA', 'PILOT_ACCOUNT_IDS']]], stage);
      assert.deepEqual(codeAt(stage, { stack: { PILOT_ACCOUNT_IDS: LIST, COMPOSE_PROFILES: 'tts,tunnel,byoa' }, mcp: GOOD_MCP }, 'V4')[0].names, ['COMPOSE_PROFILES', 'PILOT_ACCOUNT_IDS'], stage);
      assert.equal(codeAt(stage, { record: { DECIDED_BYOA: '2026-11-02' } }, 'V4').length, 0);
      assert.equal(codeAt(stage, { stack: { PILOT_ACCOUNT_IDS: LIST } }, 'V4').length, 0);
    }
  });
  // Review round 1, finding 9: a space after a comma stops the preflight with A5, whose fix is printed before the owner
  // reads 手順書 10.1; it must not send them to `openssl rand` (random hex: V2 on every entry) or only to quoting.
  it('A5 on the list (a space after a comma): the printed fix says to remove the spaces and points to 手順書 10.1; no id printed', () => {
    for (const line of [`PILOT_ACCOUNT_IDS=${PILOT_ID}, ${PILOT_ID_2}`, `PILOT_ACCOUNT_IDS=${PILOT_ID} ,${PILOT_ID_2}`]) {
      const found = checkStack(buildInput('pilot', { stackExtra: `${line}\n`, record: { VERCEL_PROTECTION_OFF: '2026-11-02' } }));
      assert.deepEqual(of(found, 'A5').map((f) => [f.level, f.names]), [['E', ['PILOT_ACCOUNT_IDS']]], line);
      const out = formatFindings(of(found, 'A5'), { mode: 'prod', stage: 'pilot' });
      const fix = out.find((l) => l.startsWith('   直し方: ')) ?? '';
      assert.ok(fix.includes('stack.env の `PILOT_ACCOUNT_IDS` のときは、空白を消し、User UID をカンマだけで区切ります（手順書 10.1）'), fix);
      for (const secret of [PILOT_ID, PILOT_ID_2]) assert.ok(!out.join('\n').includes(secret), 'no id');
    }
  });
  it('the pilot list never reaches a finding: names only, positions only', () => {
    const value = `${PILOT_ID},SENTINELX9F3ABCDEF0123456789,${PILOT_ID_2}`;
    for (const stage of STAGES) {
      const found = checkStack(buildInput(stage, { stack: { PILOT_ACCOUNT_IDS: value, COMPOSE_PROFILES: 'tts,tunnel,byoa' }, mcp: GOOD_MCP, record: { DECIDED_BYOA: '2026-11-02', VERCEL_PROTECTION_OFF: '2026-11-02' } }));
      const text = JSON.stringify(found) + formatFindings(found, { mode: 'prod', stage }).join('\n');
      for (const secret of [PILOT_ID, PILOT_ID_2, 'SENTINELX9F3']) assert.ok(!text.includes(secret), `${stage}: ${secret}`);
      assert.ok(found.some((f) => f.code === 'V2' && f.n === 2), stage);
    }
  });
  it('R2: a failure after the last success', () => {
    assert.equal(codeAt('pilot', { facts: { backupLastFail: new Date(NOW.getTime() - 3600_000).toISOString() } }, 'R2').length, 1);
  });
  it('the stage tables of G5, K, M, R and V are in the catalog (T1 checks each column)', () => {
    assert.deepEqual(['K1', 'K4', 'K5', 'M1', 'R1', 'R2', 'R4', 'R5', 'R6', 'V3'].map((c) => STAGES.map((s) => levelAt(c, s) ?? '-').join('')),
      ['-WEE', '-WEE', '-WEE', 'WEEE', 'WEEE', '-WWW', '-EEE', '-EEE', '-EEE', '---E']);
  });
});

describe('T5b: the profiles the deploy passes to Compose (fixed table; vmStackConfig.test.js T5b compares the engine with the real deploy-stack.sh)', () => {
  const table = [
    { stack: { COMPOSE_PROFILES: 'tts' }, caller: 'tts,tunnel', want: ['tts'] },
    { stack: {}, caller: 'tts,tunnel', want: ['tts', 'tunnel'] },
    { stack: { COMPOSE_PROFILES: '' }, caller: 'tts', want: [] },
    { stack: { COMPOSE_PROFILES: 'tts, tunnel' }, caller: '', want: ['tts', 'tunnel'] },
    { stack: { COMPOSE_PROFILES: 'tts', MEMANTO_SECRET_KEY: 'm'.repeat(32) }, caller: '', want: ['tts', 'memory'] },
    { stack: { COMPOSE_PROFILES: 'tts,memory', MEMANTO_SECRET_KEY: 'm'.repeat(32) }, caller: '', want: ['tts', 'memory'] },
    { stack: { COMPOSE_PROFILES: 'tts', MEMANTO_SECRET_KEY: 'change-me-memanto-secret' }, caller: '', want: ['tts'] },
    { stack: { MEMANTO_SECRET_KEY: 'm' }, caller: '', want: ['memory'] },
  ];
  for (const { stack, caller, want } of table) {
    it(`${JSON.stringify(stack)} with caller ${JSON.stringify(caller)} → ${JSON.stringify(want)}`, () => {
      assert.deepEqual(effectiveProfiles({ stackEnv: new Map(Object.entries(stack)), callerProfiles: caller }), want);
    });
  }
});

describe('T6: the catalog against the repository', () => {
  /** Assignment names, commented or not, of an env example file. @param {string} text */
  const exampleKeys = (text) => [...text.matchAll(/^#?[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]);
  const composeCode = (/** @type {string} */ file) => read(file).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  const interpolated = (/** @type {string} */ file) => [...new Set([...composeCode(file).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort();

  it('KNOWN_KEYS (with its name families) holds every name of the four *.example files and every ${NAME of docker-compose.yml', () => {
    for (const file of ['stack.env.example', 'tunnel.env.example', 'mcp-public.env.example', 'billing.env.example']) {
      for (const key of exampleKeys(read(path.join(STACK, file)))) assert.ok(isKnownKey(key), `${key} (${file})`);
    }
    for (const key of interpolated(path.join(STACK, 'docker-compose.yml'))) assert.ok(KNOWN_KEYS.has(key), key);
    assert.ok(!isKnownKey('KOKORO_TTS_VOICE_EN') && !isKnownKey('LLM_TASK_') && !isKnownKey('AI_CAP_LLM'));
  });
  it('COMPOSE_INTERPOLATED is exactly the ${NAME list of docker-compose.yml', () => {
    assert.deepEqual([...COMPOSE_INTERPOLATED].sort(), interpolated(path.join(STACK, 'docker-compose.yml')));
  });
  it('SERVICE_PROFILES and PROFILE_NAMES match the compose files', () => {
    /** @type {Record<string, string[]>} */
    const found = {};
    for (const file of ['docker-compose.yml', 'docker-compose.memanto.yml']) {
      const body = composeCode(path.join(STACK, file)).split(/^services:\s*$/m)[1].split(/^\S/m)[0];
      let current = '';
      let inProfiles = false;
      for (const line of body.split('\n')) {
        const service = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
        if (service) {
          current = service[1];
          found[current] = [];
          inProfiles = false;
        } else if (/^ {4}profiles:\s*$/.test(line)) {
          inProfiles = true;
        } else if (inProfiles && /^ {6}- /.test(line)) {
          found[current].push(line.replace(/^ {6}- /, '').trim());
        } else if (/^ {4}\S/.test(line)) {
          inProfiles = false;
        }
      }
    }
    assert.deepEqual(found, Object.fromEntries(Object.entries(SERVICE_PROFILES).map(([k, v]) => [k, [...v]])));
    assert.deepEqual([...new Set(Object.values(found).flat())].sort(), [...PROFILE_NAMES].sort());
  });
  it('codes are unique; every title and fix ends with 。 or ） (です・ます); placeholders are the five', () => {
    const codes = [...RULES.map((r) => r.code), ...INTERNAL_CODES.map((x) => x.code)];
    assert.equal(new Set(codes).size, codes.length);
    for (const r of [...RULES, ...INTERNAL_CODES]) {
      for (const text of [r.title, r.fix]) {
        assert.match(text, /[。）]$/, `${r.code}: ${text}`);
        for (const m of text.matchAll(/\{([a-z]+)\}/g)) assert.ok(['names', 'file', 'line', 'gb', 'n'].includes(m[1]), `${r.code}: {${m[1]}}`);
        assert.ok(!/(?:だ|である)。/.test(text), `${r.code}: plain form`);
      }
    }
  });
  // Review round 3, finding 9: the owner has four env files and a record; a fix that deletes a line or empties a value says which file.
  it('every fix that deletes a line or empties a value names the file', () => {
    for (const r of RULES) {
      if (/消し|消す|空に/.test(r.fix)) assert.match(r.fix, /stack\.env|billing\.env|launch-record\.env|\{file\}/, `${r.code}: ${r.fix}`);
    }
  });
  it('levels use the notation; dynamic rules are exactly the ones the engine computes', () => {
    for (const r of RULES) assert.match(r.level, /^(?:[EWI]|dyn|[EWI–]\/[EWI–]\/[EWI–]\/[EWI–])$/, r.code);
    // R9 (Phase 9 stage 5, review round 2): E for a deploy, W when the 事前チェック runs alone.
    assert.deepEqual(RULES.filter((r) => r.level === 'dyn').map((r) => r.code), ['A4', 'A7', 'A10', 'A13', 'C11', 'D1', 'F5', 'F6', 'G3', 'G5', 'R3', 'R9', 'V1']);
  });
  it('leaves out what the Scope guard removed or deferred; the pilot-list parts are in, in the same change (Phase 9 stage 3, finding 25)', () => {
    const codes = new Set(RULES.map((r) => r.code));
    for (const code of ['C16', 'D5', 'D7', 'D8', 'E1', 'E2', 'E3', 'E4', 'F4', 'F7', 'F8', 'F10', 'G4', 'G6', 'G7', 'G8', 'R7']) assert.ok(!codes.has(code), code);
    for (const code of ['V1', 'V2', 'V3', 'V4']) assert.ok(codes.has(code), code);
    assert.ok(KNOWN_KEYS.has('PILOT_ACCOUNT_IDS'));
  });
  it('ATTESTATIONS are the 18 keys of TR3, each with a known kind', () => {
    assert.deepEqual(ATTESTATIONS.map((a) => a.key).sort(), [
      'ALERT_CHECK', 'ALERT_TEST', 'ALERT_WATCHER', 'BACKUP_KEY_COPY', 'BACKUP_KEY_ID', 'BACKUP_LIFECYCLE', 'DECIDED_BILLING', 'DECIDED_BYOA',
      'DECIDED_MEMORY', 'LAUNCH_STAGE', 'MAC_DEV_DB_SEPARATE', 'MINORS_POLICY_DECIDED', 'PASSWORD_CHANGE_CHECK', 'PROD_AMR_CHECK',
      'SUPABASE_CURRENT_PASSWORD_ON', 'VERCEL_LEGAL_PAGES_ON', 'VERCEL_PROTECTION_OFF', 'VERCEL_PROTECTION_ON',
    ]);
  });
  it('every 手順書 reference in RULES, INTERNAL_CODES and ATTESTATIONS resolves to a runbook heading (finding 17)', () => {
    const runbook = read(path.join(ROOT, 'doc/guides/first-launch.ja.md'));
    const texts = [...RULES, ...INTERNAL_CODES].flatMap((r) => [r.title, r.fix]);
    for (const text of texts) {
      for (const m of text.matchAll(/手順書 (\d+(?:\.\d+)?(?:[・〜]\d+(?:\.\d+)?)*)( 章)?/g)) {
        for (const ref of m[1].split(/[・〜]/)) {
          const re = ref.includes('.') ? new RegExp(`^### ${ref.replace('.', '\\.')} `, 'm') : new RegExp(`^## ${ref}\\. `, 'm');
          assert.match(runbook, re, `手順書 ${ref} (${text})`);
        }
      }
    }
    for (const a of ATTESTATIONS) if (a.step) assert.match(runbook, new RegExp(`^### ${a.step.replace('.', '\\.')} `, 'm'), `${a.key}: ${a.step}`);
  });
  it('the switch and retention copies equal server/utils/envSwitch.js and server/services/retention.js', () => {
    for (const v of ['true', 'TRUE', ' yes ', '1', 'on', '', 'false', 'off', 'no', '0', 'ture', 'enabled', undefined]) assert.deepEqual(readSwitch(v), readEnvSwitch(v), String(v));
    assert.deepEqual(RETENTION_RANGES, Object.fromEntries(RETENTION_RULES.map((r) => [r.env, [r.min, r.max]])));
  });
  it('validateFacts takes exactly the facts preflight.sh writes', () => {
    assert.ok(validateFacts(baseFacts()));
    assert.equal(validateFacts({ ...baseFacts(), extra: 1 }), null);
    for (const key of FACT_KEYS) {
      const facts = /** @type {Record<string, unknown>} */ ({ ...baseFacts() });
      delete facts[key];
      assert.equal(validateFacts(facts), null, key);
    }
    assert.equal(validateFacts({ ...baseFacts(), callerProfiles: 'tts"' }), null);
    assert.equal(validateFacts({ ...baseFacts(), runningServices: ['Bad Name'] }), null);
    assert.equal(validateFacts({ ...baseFacts(), backupKeyId: 'xyz' }), null);
    assert.equal(validateFacts({ ...baseFacts(), uid: -1 }), null);
    assert.equal(validateFacts([]), null);
  });
  it('envText round-trips through the parser (the fixtures write what they mean)', () => {
    assert.deepEqual(Object.fromEntries(entryMap(parseEnvText(envText(BASE_STACK)).entries)), BASE_STACK);
  });
});
