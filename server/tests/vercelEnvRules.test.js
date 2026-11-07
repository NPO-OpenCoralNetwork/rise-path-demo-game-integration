// @ts-check
// The Vercel build's env check (Phase 9, owner decision D5; design §2.10, T10): scripts/deploy/vercel-env-rules.mjs
// and vite.config.ts's vercel-env-guard plugin.
// - each rule: a hit and a near miss; errors only for values that are present;
// - the plugin returns at once unless VERCEL=1 (resolved with Vite's own resolveConfig, as legalRelease.test.js);
//   CI's build:prod, the e2e front build and the e2e workflow never set VERCEL; CI's sentinel env gives no problem;
// - no value, or part of one, in any problem or build-log line (a sentinel inside every triggering value);
// - VERCEL_AUTOMATION_BYPASS_SECRET is never read (a recording Proxy), nor any process-env name outside ENV_NAMES.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_NAMES, VERCEL_RULES, formatVercelProblems, vercelEnvProblems } from '../../scripts/deploy/vercel-env-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** @typedef {Record<string, string | undefined>} Env */
/** Codes of a result, errors then warnings. @param {{ errors: string[], warnings: string[] }} r */
const codes = (r) => ({ errors: r.errors.map((l) => l.split(':')[0]), warnings: r.warnings.map((l) => l.split(':')[0]) });
const NONE = { errors: [], warnings: [] };
/** A JWT-shaped key with this payload (no real signature). @param {object} payload */
const jwt = (payload) => ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(payload), 'sig'].map((p, i) => (i < 2 ? Buffer.from(p).toString('base64url') : p)).join('.');
const ANON = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon' });
const SERVICE = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'service_role' });
/** What a correct Production scope holds (deploy/vercel/env.production.example, filled in). */
const GOOD_VITE = {
  VITE_DEMO_MODE: 'false',
  VITE_API_ENABLED: 'true',
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_ANON_KEY: ANON,
};
const GOOD_ENV = { VERCEL: '1', VERCEL_ENV: 'production', API_ORIGIN: 'https://api.example.org', ORIGIN_SECRET: 'a'.repeat(64) };
/** @param {Env} vite @param {Env} [env] */
const check = (vite, env = GOOD_ENV) => codes(vercelEnvProblems({ env, viteEnv: { ...GOOD_VITE, ...vite } }));

describe('vercelEnvProblems: each rule, a hit and a near miss', () => {
  it('a correct Production env (the example, filled in) has no problem', () => {
    assert.deepEqual(check({}), NONE);
    assert.deepEqual(check({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc123' }), NONE, 'the new publishable key');
    assert.deepEqual(codes(vercelEnvProblems({})), NONE, 'nothing set');
  });

  it('VB1: VITE_API_BASE_URL set (any value); unset or blank is fine', () => {
    assert.deepEqual(check({ VITE_API_BASE_URL: 'http://risepath-vm:3006/api/v2' }), { errors: ['VB1'], warnings: [] });
    assert.deepEqual(check({ VITE_API_BASE_URL: '/api/v2' }).errors, ['VB1']);
    assert.deepEqual(check({ VITE_API_BASE_URL: '' }), NONE);
    assert.deepEqual(check({ VITE_API_BASE_URL: '  ' }), NONE);
  });

  it('VB2: VITE_FEATURE_TRAINING or VITE_FEATURE_AGENT_CHAT exactly "true" (the app\'s own reading), names both', () => {
    assert.deepEqual(check({ VITE_FEATURE_TRAINING: 'true' }).errors, ['VB2']);
    assert.deepEqual(check({ VITE_FEATURE_AGENT_CHAT: 'true' }).errors, ['VB2']);
    const both = vercelEnvProblems({ viteEnv: { VITE_FEATURE_TRAINING: 'true', VITE_FEATURE_AGENT_CHAT: 'true' } });
    assert.deepEqual(both.errors, ['VB2: Set to "true": VITE_FEATURE_TRAINING, VITE_FEATURE_AGENT_CHAT. Delete these: the job-training section and the shared AI chat are not offered in the public app.']);
    for (const value of ['false', 'TRUE', '1', '']) assert.deepEqual(check({ VITE_FEATURE_TRAINING: value, VITE_FEATURE_AGENT_CHAT: value }), NONE, value);
  });

  it('VB3: VITE_SUPABASE_URL present and not https://', () => {
    for (const value of ['http://abc.supabase.co', 'abc.supabase.co', 'ftp://abc.supabase.co', 'https://user:pw@abc.supabase.co']) {
      assert.deepEqual(check({ VITE_SUPABASE_URL: value }).errors, ['VB3'], value);
    }
    assert.deepEqual(check({ VITE_SUPABASE_URL: 'https://auth.example.org' }), NONE, 'a custom domain');
    assert.deepEqual(check({ VITE_SUPABASE_URL: undefined }), NONE, 'unset: not refused');
  });

  it('VB4: VITE_SUPABASE_ANON_KEY is a service_role JWT or an sb_secret_ key', () => {
    assert.deepEqual(check({ VITE_SUPABASE_ANON_KEY: SERVICE }).errors, ['VB4']);
    assert.deepEqual(check({ VITE_SUPABASE_ANON_KEY: 'sb_secret_abc123' }).errors, ['VB4']);
    assert.deepEqual(check({ VITE_SUPABASE_ANON_KEY: ` ${SERVICE} ` }).errors, ['VB4'], 'spaces around it');
    // Pasted with quotes or its name in front (Vercel keeps them, and the bundle would still carry the key).
    for (const value of ['"sb_secret_abc"', "'sb_secret_abc'", '`sb_secret_abc`', ' "sb_secret_abc" ', 'VITE_SUPABASE_ANON_KEY=sb_secret_abc', `"${SERVICE}"`]) {
      assert.deepEqual(check({ VITE_SUPABASE_ANON_KEY: value }).errors, ['VB4'], value.slice(0, 30));
    }
    for (const value of [ANON, 'your-anon-key', 'a.b.c', `${SERVICE}.extra`, jwt({ role: 'authenticated' }), 'sb_publishable_x', '"sb_publishable_x"', `"${ANON}"`]) {
      assert.deepEqual(check({ VITE_SUPABASE_ANON_KEY: value }), NONE, value.slice(0, 20));
    }
  });

  it('VB5: VITE_FEATURE_LEGAL_PAGES=true without an https:// or mailto: VITE_SUPPORT_CONTACT (config/support.ts)', () => {
    for (const value of [undefined, '', 'http://forms.example.org/x', 'support@example.org', 'mailto:a@example.org,b@example.org', 'mailto:a@example.org?subject=x', 'https://user@forms.example.org']) {
      assert.deepEqual(check({ VITE_FEATURE_LEGAL_PAGES: 'true', VITE_SUPPORT_CONTACT: value }).errors, ['VB5'], String(value));
    }
    for (const value of ['https://forms.example.org/rise-path', 'mailto:support@example.org', ' https://forms.example.org ']) {
      assert.deepEqual(check({ VITE_FEATURE_LEGAL_PAGES: 'true', VITE_SUPPORT_CONTACT: value }), NONE, value);
    }
    assert.deepEqual(check({ VITE_FEATURE_LEGAL_PAGES: 'TRUE' }), NONE, 'the flag is off unless exactly "true"');
  });

  it('VB5 refuses exactly the contacts the app would not show (parity with config/support.ts parseSupportContact)', async () => {
    // config/support.ts reads import.meta.env, so it is bundled with esbuild (a Vite dependency) to call it here.
    const { build } = await import('esbuild');
    const out = await build({
      entryPoints: [path.join(ROOT, 'config/support.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      define: { 'import.meta.env': '{}' },
      logLevel: 'silent',
    });
    const { parseSupportContact } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
    const values = [
      undefined, '', '   ', 'support@example.org', 'http://forms.example.org/x', 'ftp://forms.example.org', 'https://',
      'https://forms.example.org/rise-path', ' https://forms.example.org ', 'https://forms.example.org:8443/x',
      'https://user@forms.example.org', 'https://user:pw@forms.example.org', 'https://例え.jp/問い合わせ',
      'mailto:support@example.org', 'MAILTO:support@example.org', ' mailto:support@example.org ', 'mailto: support@example.org',
      'mailto:a@example.org,b@example.org', 'mailto:a@example.org;b@example.org', 'mailto:a@example.org?subject=x',
      'mailto:support@example', 'mailto:support@ex/ample.org', 'javascript:alert(1)', 'data:text/html,x',
    ];
    for (const value of values) {
      const shown = parseSupportContact(value) !== null;
      const refused = vercelEnvProblems({ env: {}, viteEnv: { VITE_FEATURE_LEGAL_PAGES: 'true', VITE_SUPPORT_CONTACT: value } })
        .errors.some((line) => line.startsWith('VB5:'));
      assert.equal(refused, !shown, `${JSON.stringify(value)}: the app ${shown ? 'shows' : 'ignores'} it`);
    }
  });

  it('VB6: VITE_APP_BASE_PATH present and not "/"', () => {
    assert.deepEqual(check({ VITE_APP_BASE_PATH: '/app/' }).errors, ['VB6']);
    assert.deepEqual(check({ VITE_APP_BASE_PATH: '/' }), NONE);
    assert.deepEqual(check({ VITE_APP_BASE_PATH: '' }), NONE);
  });

  it('VB7 (warning): VITE_FEATURE_BILLING exactly "true"', () => {
    assert.deepEqual(check({ VITE_FEATURE_BILLING: 'true' }), { errors: [], warnings: ['VB7'] });
    assert.deepEqual(check({ VITE_FEATURE_BILLING: 'false' }), NONE);
  });

  it('VB8 (warning): any VITE_NEXLOOM_SUPABASE_* set, by name', () => {
    const r = vercelEnvProblems({ viteEnv: { VITE_NEXLOOM_SUPABASE_URL: 'https://x.supabase.co', VITE_NEXLOOM_SUPABASE_ANON_KEY: ANON } });
    assert.deepEqual(r.warnings, ['VB8: Set: VITE_NEXLOOM_SUPABASE_ANON_KEY, VITE_NEXLOOM_SUPABASE_URL. A session from the Nexloom project reaches neither account deletion nor consent on the server.']);
    assert.deepEqual(check({ VITE_NEXLOOM_SUPABASE_URL: '' }), NONE);
  });

  it('VB9 (warning): a Preview build with VITE_SUPABASE_*, API_ORIGIN or ORIGIN_SECRET; never outside Preview', () => {
    const preview = { VERCEL: '1', VERCEL_ENV: 'preview' };
    const r = vercelEnvProblems({ env: { ...preview, API_ORIGIN: 'https://api.example.org', ORIGIN_SECRET: 'x' }, viteEnv: GOOD_VITE });
    assert.deepEqual(r.warnings, ['VB9: A Preview build has VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL, API_ORIGIN, ORIGIN_SECRET: previews would use the production sign-in, database or LLM budget.']);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(codes(vercelEnvProblems({ env: { ...preview, API_ORIGIN: 'https://api.example.org' } })).warnings, ['VB9']);
    assert.deepEqual(codes(vercelEnvProblems({ env: preview, viteEnv: { VITE_DEMO_MODE: 'false' } })), NONE, 'a clean Preview');
    assert.deepEqual(codes(vercelEnvProblems({ env: { ...preview, API_ORIGIN: '', ORIGIN_SECRET: '' } })), NONE, 'blank values');
    assert.deepEqual(codes(vercelEnvProblems({ env: { VERCEL_ENV: 'development', API_ORIGIN: 'x', ORIGIN_SECRET: 'x' }, viteEnv: GOOD_VITE })), NONE);
  });

  it('VB10 (warning, Production): API_ORIGIN is not https:// with a host only', () => {
    for (const value of ['http://api.example.org', 'https://api.example.org/', 'https://api.example.org/api', 'https://api.example.org?x=1', 'https://u:p@api.example.org', 'api.example.org', 'https://']) {
      assert.deepEqual(check({}, { ...GOOD_ENV, API_ORIGIN: value }), { errors: [], warnings: ['VB10'] }, value);
    }
    for (const value of ['https://api.example.org', 'https://api.example.org:8443', 'https://API.Example.org']) assert.deepEqual(check({}, { ...GOOD_ENV, API_ORIGIN: value }), NONE, value);
    assert.deepEqual(check({}, { ...GOOD_ENV, API_ORIGIN: undefined }), NONE, 'unset: not seen by the build, never refused');
    assert.deepEqual(check({}, { ...GOOD_ENV, VERCEL_ENV: undefined, API_ORIGIN: 'http://x' }), NONE, 'outside Production');
  });

  it('VB11 (warning, Production): ORIGIN_SECRET shorter than 32 characters', () => {
    assert.deepEqual(check({}, { ...GOOD_ENV, ORIGIN_SECRET: 'a'.repeat(31) }).warnings, ['VB11']);
    assert.deepEqual(check({}, { ...GOOD_ENV, ORIGIN_SECRET: 'a'.repeat(32) }), NONE);
    assert.deepEqual(check({}, { ...GOOD_ENV, ORIGIN_SECRET: '' }), NONE);
    assert.deepEqual(check({}, { ...GOOD_ENV, VERCEL_ENV: 'preview', ORIGIN_SECRET: 'short' }).warnings, ['VB9'], 'Preview: VB9, not VB11');
  });

  it('the catalog: VB1-VB11 in order, unique, errors before warnings, English one-liners', () => {
    assert.deepEqual(VERCEL_RULES.map((r) => r.code), Array.from({ length: 11 }, (_, i) => `VB${i + 1}`));
    const levels = VERCEL_RULES.map((r) => r.level).join('');
    assert.match(levels, /^E+W+$/);
    for (const r of VERCEL_RULES) {
      assert.ok(!r.message.includes('\n') && !r.message.includes('|') && /^[\x20-\x7e]+$/.test(r.message), r.code);
      assert.ok(r.message.endsWith('.'), r.code);
    }
  });
});

describe('no value in any problem or build-log line', () => {
  const S = `SENTINELX9F3${Date.now().toString(16).toUpperCase()}`;
  /** Every rule hit, with the sentinel inside each triggering value (a key name may be printed; a value never). */
  const cases = /** @type {[string, Env, Env][]} */ ([
    ['VB1', { VITE_API_BASE_URL: `http://${S}.example/api/v2` }, {}],
    ['VB3', { VITE_SUPABASE_URL: `http://${S}.supabase.co` }, {}],
    ['VB4', { VITE_SUPABASE_ANON_KEY: `sb_secret_${S}` }, {}],
    ['VB4', { VITE_SUPABASE_ANON_KEY: `"sb_secret_${S}"` }, {}],
    ['VB4', { VITE_SUPABASE_ANON_KEY: jwt({ ref: S, role: 'service_role', note: S }) }, {}],
    ['VB5', { VITE_FEATURE_LEGAL_PAGES: 'true', VITE_SUPPORT_CONTACT: `ftp://${S}` }, {}],
    ['VB6', { VITE_APP_BASE_PATH: `/${S}/` }, {}],
    ['VB8', { VITE_NEXLOOM_SUPABASE_URL: `https://${S}.supabase.co` }, {}],
    ['VB9', { VITE_SUPABASE_URL: `https://${S}.supabase.co` }, { VERCEL_ENV: 'preview', API_ORIGIN: `https://${S}`, ORIGIN_SECRET: S }],
    ['VB10', {}, { VERCEL_ENV: 'production', API_ORIGIN: `http://${S}.example/path` }],
    ['VB11', {}, { VERCEL_ENV: 'production', ORIGIN_SECRET: S.slice(0, 20) }],
  ]);
  for (const [code, vite, env] of cases) {
    it(`${code}`, () => {
      const result = vercelEnvProblems({ env, viteEnv: vite });
      const all = [...result.errors, ...result.warnings];
      assert.ok(all.some((line) => line.startsWith(`${code}: `)), `${code} fires: ${all.join(' / ')}`);
      const { error, warnings } = formatVercelProblems(result);
      const out = [JSON.stringify(result), String(error), ...warnings].join('\n');
      assert.ok(!out.includes(S) && !out.toLowerCase().includes(S.toLowerCase()), `${code}: ${out}`);
      assert.ok(!out.includes(S.slice(0, 20)), `${code}: no part of a value`);
    });
  }

  it('a key name that is not a plain upper-case name is never printed either (the app reads none such)', () => {
    const r = vercelEnvProblems({ viteEnv: { [`VITE_NEXLOOM_SUPABASE_${S.toLowerCase()}`]: 'x', 'VITE_NEXLOOM_SUPABASE_A B': 'y', [`VITE_SUPABASE_${S.toLowerCase()}`]: 'z' }, env: { VERCEL_ENV: 'preview' } });
    assert.deepEqual(r, { errors: [], warnings: [] });
  });
});

describe('what the check reads', () => {
  /**
   * A Proxy that records every value read (get, has) and, with `listing`, every listing of the names
   * (Object.keys reads names and descriptors: recorded as '<listed>').
   * @param {Env} target @param {Set<string | symbol>} reads @param {boolean} [listing]
   */
  const recording = (target, reads, listing = false) => new Proxy(target, {
    get(t, key) {
      reads.add(key);
      return Reflect.get(t, key);
    },
    has(t, key) {
      reads.add(key);
      return Reflect.has(t, key);
    },
    ...(listing ? {
      ownKeys(t) {
        reads.add('<listed>');
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, key) {
        reads.add(key);
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
    } : {}),
  });

  it('never reads VERCEL_AUTOMATION_BYPASS_SECRET, and from the process env only ENV_NAMES', () => {
    const env = {
      ...GOOD_ENV,
      VERCEL_ENV: 'preview',
      VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-sentinel',
      VITE_API_BASE_URL: 'x',
      PATH: '/usr/bin',
      HOME: 'x',
      ANTHROPIC_API_KEY: 'k',
    };
    const vite = { ...GOOD_VITE, VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-sentinel', VITE_NEXLOOM_SUPABASE_URL: 'https://x.supabase.co' };
    const envReads = new Set();
    const viteReads = new Set();
    // The process env is never listed (no Object.keys), and only ENV_NAMES are read from it. Vite's env holds VITE_
    // names only (loadEnv's prefix); its names are listed for the VITE_NEXLOOM_SUPABASE_ and VITE_SUPABASE_ rules.
    const result = vercelEnvProblems({ env: recording(env, envReads, true), viteEnv: recording(vite, viteReads) });
    assert.ok(result.warnings.length > 0, 'the rules ran');
    assert.deepEqual([...envReads].filter((k) => !ENV_NAMES.includes(String(k))), [], 'process env: only ENV_NAMES, never listed');
    assert.ok(!viteReads.has('VERCEL_AUTOMATION_BYPASS_SECRET'), 'Vite env: not the bypass secret');
    assert.ok([...viteReads].every((k) => String(k).startsWith('VITE_')), [...viteReads].join(', '));
    assert.deepEqual([...ENV_NAMES], ['VERCEL_ENV', 'API_ORIGIN', 'ORIGIN_SECRET']);
  });

  it('neither the module nor vite.config.ts names the bypass secret outside a comment', () => {
    const code = (/** @type {string} */ text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const file of ['scripts/deploy/vercel-env-rules.mjs', 'vite.config.ts']) {
      assert.ok(!code(read(file)).includes('VERCEL_AUTOMATION_BYPASS_SECRET'), file);
    }
  });
});

describe('vite.config.ts vercel-env-guard: inert unless VERCEL=1', () => {
  const KEYS = ['VERCEL', 'VERCEL_ENV', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'API_ORIGIN', 'ORIGIN_SECRET', 'VITE_API_BASE_URL', 'VITE_FEATURE_TRAINING', 'VITE_SUPABASE_URL', 'VITE_FEATURE_BILLING', 'NODE_ENV', 'VITE_USER_NODE_ENV'];
  /** @param {string} key @param {string | undefined} value */
  const setEnv = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  /**
   * Resolves vite.config.ts the way `vite build` does, then calls the plugin's buildStart with a fake plugin
   * context (error() throws like Rollup's). Every variable is put back afterwards.
   * @param {Env} vars
   */
  async function runGuard(vars) {
    const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    for (const key of KEYS) setEnv(key, undefined);
    for (const [key, value] of Object.entries(vars)) setEnv(key, value);
    try {
      const { resolveConfig } = await import('vite');
      const config = await resolveConfig({ configFile: path.join(ROOT, 'vite.config.ts'), root: ROOT, logLevel: 'silent' }, 'build', 'production', 'production');
      const plugin = /** @type {any} */ (config.plugins.find((p) => p && p.name === 'vercel-env-guard'));
      assert.ok(plugin, 'the plugin is registered');
      assert.equal(plugin.apply, 'build', 'never in the dev server');
      const errors = /** @type {string[]} */ ([]);
      const warnings = /** @type {string[]} */ ([]);
      let returned;
      try {
        returned = await plugin.buildStart.call({
          warn: (/** @type {string} */ message) => { warnings.push(message); },
          error: (/** @type {string} */ message) => {
            errors.push(message);
            throw new Error(message);
          },
        });
      } catch (error) {
        if (!errors.length) throw error;
      }
      return { errors, warnings, returned };
    } finally {
      for (const key of KEYS) setEnv(key, saved[key]);
    }
  }

  const BAD = {
    VERCEL_ENV: 'production',
    VITE_API_BASE_URL: 'http://risepath-vm:3006/api/v2',
    VITE_FEATURE_TRAINING: 'true',
    VITE_SUPABASE_URL: 'http://abc.supabase.co',
    VITE_FEATURE_BILLING: 'true',
    API_ORIGIN: 'http://api.example.org/x',
    ORIGIN_SECRET: 'q7Zp',
  };

  it('does nothing without VERCEL=1, even with every rule hit (CI\'s build:prod, the e2e front build, a local build)', async () => {
    for (const value of [undefined, '', '0', 'true', 'TRUE', ' 1']) {
      const { errors, warnings, returned } = await runGuard({ ...BAD, VERCEL: value });
      assert.deepEqual({ errors, warnings, returned }, { errors: [], warnings: [], returned: undefined }, JSON.stringify(value));
    }
  });

  it('with VERCEL=1 stops the build on an error and prints the warnings, names only', async () => {
    const S = 'bypass-SENTINELX9F3';
    const { errors, warnings } = await runGuard({ ...BAD, VERCEL: '1', VERCEL_AUTOMATION_BYPASS_SECRET: S });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^This Vercel build stops: fix these in Vercel's Environment Variables, then Redeploy \(doc\/guides\/first-launch\.ja\.md, chapter 13 \(VB codes\)\)\.\n- VB1: /);
    for (const code of ['VB1', 'VB2', 'VB3']) assert.match(errors[0], new RegExp(`\\n- ${code}: `), code);
    // A developer's own .env files (loadEnv) may add a warning; these three come from BAD.
    const warned = warnings.map((w) => w.split(':')[0]);
    for (const code of ['VB7', 'VB10', 'VB11']) assert.ok(warned.includes(code), code);
    for (const w of warnings) assert.match(w, /^VB\d+: .+ \(doc\/guides\/first-launch\.ja\.md, chapter 13 \(VB codes\)\)$/);
    const out = [...errors, ...warnings].join('\n');
    for (const value of [S, 'risepath-vm', 'abc.supabase.co', 'api.example.org', 'q7Zp']) assert.ok(!out.includes(value), value);
  });

  it('with VERCEL=1 and VITE_API_BASE_URL alone (the local verification of design §10): VB1 stops it', async () => {
    const { errors, warnings } = await runGuard({ VERCEL: '1', VERCEL_ENV: 'production', VITE_API_BASE_URL: 'x' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /\n- VB1: VITE_API_BASE_URL is set\./);
    assert.ok(warnings.every((w) => !w.includes('VB1')));
  });

  it('returns before it imports the rules: the VERCEL check is the first statement of buildStart', () => {
    const config = read('vite.config.ts');
    const start = config.indexOf("name: 'vercel-env-guard'");
    assert.ok(start > config.indexOf("name: 'legal-release-guard'"), 'next to (after) legal-release-guard');
    const block = config.slice(start, config.indexOf('\n        },', start));
    assert.match(block, /apply: 'build',\n\s+async buildStart\(\) \{\n\s+if \(process\.env\.VERCEL !== '1'\) return;\n\s+const \{ vercelEnvProblems, formatVercelProblems \} = await import\('\.\/scripts\/deploy\/vercel-env-rules\.mjs'\);/);
    assert.match(block, /vercelEnvProblems\(\{ env: process\.env, viteEnv: env \}\)/);
  });
});

describe('CI never sets VERCEL, and its sentinel env gives no problem', () => {
  it('ci.yml, e2e.yml, scripts/ci/stack.sh and the e2e config set no VERCEL', () => {
    for (const file of ['.github/workflows/ci.yml', '.github/workflows/e2e.yml', 'scripts/ci/stack.sh', 'playwright.config.ts', 'package.json']) {
      assert.doesNotMatch(read(file), /\bVERCEL\w*\s*[:=]/, file);
    }
  });

  it('the build:prod step\'s env (the sentinel keys) has no problem, even read as a Vercel Production build', () => {
    const ci = read('.github/workflows/ci.yml');
    const step = ci.slice(ci.indexOf('- name: Production build with sentinel keys'));
    const block = step.slice(step.indexOf('env:'), step.indexOf('run: npm run build:prod'));
    const env = Object.fromEntries([...block.matchAll(/^\s+([A-Z][A-Z0-9_]*): (.+)$/gm)].map((m) => [m[1], m[2].trim()]));
    assert.ok(Object.keys(env).length >= 20 && env.ORIGIN_SECRET && env.VITE_GEMINI_API_KEY, Object.keys(env).join(', '));
    const viteEnv = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('VITE_')));
    assert.deepEqual(codes(vercelEnvProblems({ env, viteEnv })), NONE);
    // As if Vercel ran it, in any scope: no error (Preview warns about the server names, Production about the short secret).
    assert.deepEqual(codes(vercelEnvProblems({ env: { ...env, VERCEL: '1', VERCEL_ENV: 'preview' }, viteEnv })), { errors: [], warnings: ['VB9'] });
    assert.deepEqual(codes(vercelEnvProblems({ env: { ...env, VERCEL: '1', VERCEL_ENV: 'production' }, viteEnv })), { errors: [], warnings: ['VB11'] });
  });
});
