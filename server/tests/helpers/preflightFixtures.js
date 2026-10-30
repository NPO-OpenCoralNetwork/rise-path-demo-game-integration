// @ts-check
// Fixtures for the 事前チェック (preflight) tests (Phase 9; scripts/deploy/preflight-rules.mjs), shared by
// deployPreflight.test.js (the engine: T1, T2a, T5) and preflightCli.test.js (the CLI sweep, T2c).
//
// BASE is a finished production stack (tts and tunnel, every record key dated, backups and drill
// fresh): checkStack returns no finding for it at any stage, in either mode. Each entry of FIXTURES
// changes it so that one rule fires (`hit`) or just does not (`miss`). `hit(S)` takes a name-shaped
// sentinel and puts it inside the value that triggers the rule where the rule reads a value (D1's URL,
// F1's profile name, A5's `$`, A9's bare line …), else into an unrelated value; a rule that copied a
// value into a finding would carry it (T2a). `levels` is the expected level at setup/pilot/minors/
// public ('-' = no finding), `ci` whether the rule runs in CI mode.

export const NOW = new Date('2026-11-20T03:00:00.000Z');
export const DAY = '2026-11-01';
const hoursAgo = (/** @type {number} */ h) => new Date(NOW.getTime() - h * 3600_000).toISOString();

export const PG_PASSWORD = 'pg0123456789abcdef0123456789abcdef';

/** @type {Record<string, string>} */
export const BASE_STACK = {
  COMPOSE_PROFILES: 'tts,tunnel',
  POSTGRES_USER: 'risepath_app',
  POSTGRES_PASSWORD: PG_PASSWORD,
  POSTGRES_DB: 'risepath',
  DATABASE_URL_PHASE1: `postgresql://risepath_app:${PG_PASSWORD}@db:5432/risepath`,
  NODE_ENV: 'production',
  VITE_DEMO_MODE: 'false',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'srk0123456789abcdef0123456789abcdef',
  RISE_PATH_BRIDGE_TOKEN: 'bt0123456789abcdef0123456789abcdef0123',
  ANTHROPIC_API_KEY: 'ak0123456789abcdef0123456789abcdef',
  ORIGIN_SECRET: 'os0123456789abcdef0123456789abcdef0123',
  TRUST_PROXY: '1',
  LLM_ALLOWED_ORIGINS: 'https://app.example.org',
  AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T0/B0/x',
  ACCOUNT_DELETION_ENABLED: 'true',
  MEMANTO_ENABLED: 'false',
};

/** A complete mcp-public.env for a byoa stack. @type {Record<string, string>} */
export const GOOD_MCP = {
  DATABASE_URL_PHASE1: 'postgresql://risepath_mcp_remote:mcp0123456789abcdef@db:5432/risepath',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_ANON_KEY: 'anon0123456789abcdef',
  MCP_PUBLIC_RESOURCE_URL: 'https://mcp.example.org/mcp',
};

/** The record at a stage: every key dated; protection off and the legal pages on only at public. */
export function baseRecord(/** @type {string} */ stage) {
  return {
    LAUNCH_STAGE: stage,
    VERCEL_PROTECTION_ON: DAY,
    VERCEL_PROTECTION_OFF: stage === 'public' ? DAY : '',
    ALERT_WATCHER: '事務局の当番（2 人）',
    ALERT_CHECK: '平日の 10 時と 16 時',
    BACKUP_LIFECYCLE: DAY,
    BACKUP_KEY_COPY: DAY,
    BACKUP_KEY_ID: '0123456789abcdef',
    ALERT_TEST: DAY,
    MAC_DEV_DB_SEPARATE: DAY,
    SUPABASE_CURRENT_PASSWORD_ON: DAY,
    PASSWORD_CHANGE_CHECK: DAY,
    PROD_AMR_CHECK: DAY,
    VERCEL_LEGAL_PAGES_ON: stage === 'public' ? DAY : '',
    DECIDED_BYOA: '',
    DECIDED_MEMORY: '',
    DECIDED_BILLING: '',
    MINORS_POLICY_DECIDED: DAY,
  };
}

/** @returns {import('../../../scripts/deploy/preflight-rules.mjs').Facts} */
export function baseFacts() {
  return {
    uid: 1000,
    gid: 1000,
    diskFreeKb: 50 * 1024 * 1024,
    unitStack: 'enabled',
    unitBackupTimer: 'enabled',
    pgdataVolume: true,
    runningServices: ['db', 'api', 'mcp', 'kokoro-tts', 'cloudflared'],
    callerProfiles: '',
    callerExports: [],
    backupKey: true,
    backupEnv: true,
    backupLastOk: hoursAgo(2),
    backupLastFail: '',
    drillLastOk: hoursAgo(72),
    backupKeyId: '0123456789abcdef',
    backupAlert: 'true',
    from: 'standalone',
  };
}

/** `NAME=value` lines; a null value drops the name. @param {Record<string, string | null>} map */
export const envText = (map) => Object.entries(map).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

/**
 * A change to BASE. Maps merge into the base map (null drops a name); `*Extra` appends raw lines.
 * @typedef {{
 *   stack?: Record<string, string | null>, stackExtra?: string, noStack?: boolean, crlf?: boolean,
 *   tunnel?: Record<string, string | null> | null, mcp?: Record<string, string | null>,
 *   billing?: Record<string, string | null>,
 *   record?: Record<string, string | null> | null, recordExtra?: string,
 *   facts?: Partial<import('../../../scripts/deploy/preflight-rules.mjs').Facts>,
 *   stackMode?: number, lastGreen?: { stackEnvSha256?: string } | null, unreadable?: string[],
 * }} Mod
 */

/**
 * The files of a stack folder for a stage and a change.
 * @param {string} stage
 * @param {Mod} [mod]
 * @returns {Record<string, string>}
 */
export function buildFiles(stage, mod = {}) {
  /** @type {Record<string, string>} */
  const files = {};
  if (!mod.noStack) {
    let text = envText({ ...BASE_STACK, ...mod.stack }) + (mod.stackExtra ?? '');
    if (mod.crlf) text = text.replace(/\n/g, '\r\n');
    files['stack.env'] = text;
  }
  if (mod.tunnel !== null) files['tunnel.env'] = envText({ TUNNEL_TOKEN: 'tunnel0123456789', ...mod.tunnel });
  if (mod.mcp) files['mcp-public.env'] = envText(mod.mcp);
  if (mod.billing) files['billing.env'] = envText(mod.billing);
  if (mod.record !== null) files['launch-record.env'] = envText({ ...baseRecord(stage), ...mod.record }) + (mod.recordExtra ?? '');
  return files;
}

/**
 * checkStack's input for a stage and a change.
 * @param {string} stage
 * @param {Mod} [mod]
 * @param {'prod' | 'ci'} [mode]
 * @returns {import('../../../scripts/deploy/preflight-rules.mjs').CheckInput}
 */
export function buildInput(stage, mod = {}, mode = 'prod') {
  const files = buildFiles(stage, mod);
  /** @type {Record<string, { mode: number, uid: number }>} */
  const stats = {};
  for (const name of ['stack.env', 'tunnel.env', 'mcp-public.env', 'billing.env']) {
    if (files[name] !== undefined) stats[name] = { mode: name === 'stack.env' && mod.stackMode !== undefined ? mod.stackMode : 0o100600, uid: 1000 };
  }
  return {
    mode,
    files,
    stats,
    facts: { ...baseFacts(), ...mod.facts },
    lastGreen: mod.lastGreen === undefined ? { stackEnvSha256: 'a'.repeat(64) } : mod.lastGreen,
    stackEnvSha256: 'a'.repeat(64),
    ...(mod.unreadable ? { unreadable: mod.unreadable } : {}),
    now: NOW,
  };
}

/** A value that is not the template's, not short: S twice. */
const twice = (/** @type {string} */ s) => `${s}${s}`;

/**
 * @typedef {{ code: string, levels: string, ci: 'run' | 'skip', hit: (s: string) => Mod, miss: Mod }} Fixture
 * @type {Fixture[]}
 */
export const FIXTURES = [
  // A. Files and parsing
  { code: 'A1', levels: 'EEEE', ci: 'run', hit: (s) => ({ noStack: true, tunnel: { TUNNEL_TOKEN: s } }), miss: {} },
  { code: 'A2', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { SUPABASE_SERVICE_ROLE_KEY: `ci-dummy-${s}` } }), miss: { stack: { SUPABASE_SERVICE_ROLE_KEY: 'srk-ci-dummy-0123456789abcdef0123' } } },
  { code: 'A3', levels: 'EEEE', ci: 'run', hit: (s) => ({ crlf: true, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'A4', levels: 'WWWW', ci: 'run', hit: (s) => ({ stackExtra: `KOKORO_TTS_DEFAULT_VOICE_EN=${s}\nKOKORO_TTS_DEFAULT_VOICE_EN=${s}\n` }), miss: { stackExtra: 'KOKORO_TTS_DEFAULT_VOICE_EN=af_bella\n' } },
  { code: 'A5', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { KOKORO_TTS_DEFAULT_VOICE_EN: `x$${s}` } }), miss: { stack: { KOKORO_TTS_DEFAULT_VOICE_EN: "'x$y'" } } },
  { code: 'A6', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { KOKORO_TTS_VOICE_EN: s } }), miss: { stack: { KOKORO_TTS_DEFAULT_VOICE_EN: 'af_bella' } } },
  { code: 'A7', levels: 'WWWW', ci: 'run', hit: (s) => ({ stackMode: 0o100644, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stackMode: 0o100600 } },
  { code: 'A8', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { TUNNEL_TOKEN: s } }), miss: { tunnel: { TUNNEL_TOKEN: 'tunnel0123456789' } } },
  { code: 'A9', levels: 'EEEE', ci: 'run', hit: (s) => ({ stackExtra: `${s}\nKOKORO_TTS_URL : ${s}\n` }), miss: { stackExtra: 'KOKORO_TTS_URL=http://kokoro-tts:8880\n' } },
  // A10 is W for a name far from every record key; a typo of one is E (deployPreflight.test.js T5).
  { code: 'A10', levels: 'WWWW', ci: 'skip', hit: (s) => ({ recordExtra: `OWNER_NOTE=${s}\n` }), miss: {} },
  { code: 'A11', levels: 'EEEE', ci: 'skip', hit: (s) => ({ record: { BACKUP_KEY_ID: s } }), miss: { record: { BACKUP_KEY_ID: 'fedcba9876543210' }, facts: { backupKeyId: 'fedcba9876543210' } } },
  { code: 'A12', levels: 'EEEE', ci: 'skip', hit: (s) => ({ record: { ALERT_TEST: '2026-11-25' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { record: { ALERT_TEST: '2026-11-21' } } },
  { code: 'A13', levels: 'EEEE', ci: 'skip', hit: (s) => ({ record: null, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'A14', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { KOKORO_TTS_DEFAULT_VOICE_EN: `jf#${s}` } }), miss: { stack: { KOKORO_TTS_DEFAULT_VOICE_EN: 'jf_alpha' } } },
  // A15: the CLI passes the deploy record's path in `unreadable` (preflightCli.test.js T7 runs it for real).
  { code: 'A15', levels: 'EEEE', ci: 'skip', hit: (s) => ({ unreadable: ['.deploy/last-green.json'], stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { unreadable: ['.deploy'] } },
  // B. Required and exact values
  { code: 'B1', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { RISE_PATH_BRIDGE_TOKEN: `change-me-${s}` } }), miss: { stack: { RISE_PATH_BRIDGE_TOKEN: 'bt-changeme0123456789abcdef0123456789' } } },
  { code: 'B2', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { ANTHROPIC_API_KEY: '', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'B3', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { NODE_ENV: s } }), miss: { stack: { NODE_ENV: '' } } },
  { code: 'B4', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { ORIGIN_SECRET: s } }), miss: { stack: { ORIGIN_SECRET: twice('os0123456789abcd') } } },
  { code: 'B5', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { COMPOSE_PROFILES: 'tts,tunnel,byoa' }, mcp: { ...GOOD_MCP, SUPABASE_ANON_KEY: `change-me-${s}` } }), miss: { stack: { COMPOSE_PROFILES: 'tts,tunnel,byoa' }, mcp: GOOD_MCP, record: { DECIDED_BYOA: DAY } } },
  { code: 'B6', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { PORT: s } }), miss: { stack: { PORT: '3006' } } },
  { code: 'B7', levels: 'WWWW', ci: 'skip', hit: (s) => ({ stack: { COMPOSE_PROFILES: null, KOKORO_TTS_DEFAULT_VOICE_EN: s }, facts: { callerProfiles: 'tts,tunnel' } }), miss: { stack: { COMPOSE_PROFILES: 'tts,tunnel' } } },
  // C. Dangerous values
  { code: 'C1', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { GEMINI_ALLOWED: 'true', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { GEMINI_ALLOWED: '' } } },
  { code: 'C2', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { GOOGLE_API_KEY: s } }), miss: { stack: { GOOGLE_API_KEY: '', GEMINI_API_KEY: '' } } },
  { code: 'C3', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { LLM_GUEST_AI: 'true', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { LLM_GUEST_AI: 'false' } } },
  { code: 'C4', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { LLM_TASK_TUTOR_CHAT: `${s}:any-model` } }), miss: { stack: { LLM_TASK_TUTOR_CHAT: 'anthropic:any-model', LLM_PROVIDER: 'anthropic' } } },
  { code: 'C5', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { ANTHROPIC_BASE_URL: `http://${s}.example` } }), miss: { stack: { ANTHROPIC_BASE_URL: '' } } },
  { code: 'C6', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { AI_ACCESS_DEV_AUDIENCE: s } }), miss: { stack: { AI_ACCESS_DEV_AUDIENCE: '' } } },
  { code: 'C7', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { RISE_PATH_ACTIVE_SESSION_KEY: s } }), miss: { stack: { RISE_PATH_ACTIVE_SESSION_KEY: '' } } },
  { code: 'C8', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { COMPOSE_PROJECT_NAME: s } }), miss: {} },
  { code: 'C9', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { RISEPATH_STRICT_AUTH: s } }), miss: { stack: { RISEPATH_STRICT_AUTH: 'true' } } },
  { code: 'C10', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { RETENTION_AI_USAGE_DAYS: s } }), miss: { stack: { RETENTION_AI_USAGE_DAYS: '30', RETENTION_ENABLED: 'true' } } },
  { code: 'C11', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { TRUST_PROXY: 'true', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { TRUST_PROXY: '1' } } },
  { code: 'C12', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { ORIGIN_SECRET_PREVIOUS: twice(s) } }), miss: { stack: { ORIGIN_SECRET_PREVIOUS: '' } } },
  { code: 'C13', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { OPENROUTER_API_KEY: `change-me-${s}` } }), miss: { stack: { OPENROUTER_API_KEY: '' } } },
  { code: 'C14', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { LLM_GUEST_AI: 'TRUE', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { LLM_GUEST_AI: 'false' } } },
  { code: 'C15', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { LEGAL_TERMS_REQUIRED: s } }), miss: { stack: { LEGAL_TERMS_REQUIRED: 'false' } } },
  { code: 'C17', levels: 'WWWW', ci: 'run', hit: (s) => ({ stack: { RP_LESSON_FS_WRITE: s } }), miss: {} },
  // D. Format and strength
  { code: 'D1', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { SUPABASE_URL: `http://${s}.example` } }), miss: { stack: { SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co' } } },
  { code: 'D2', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { DATABASE_URL_PHASE1: `postgresql://risepath_app:${PG_PASSWORD}@${s}:5432/risepath` } }), miss: { stack: { DATABASE_URL_PHASE1: `postgresql://risepath_app:${PG_PASSWORD}@db/risepath` } } },
  { code: 'D3', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { RISE_PATH_BRIDGE_TOKEN: s } }), miss: { stack: { RISE_PATH_BRIDGE_TOKEN: 'b'.repeat(16) + '0123456789abcdef' } } },
  { code: 'D4', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { ORIGIN_SECRET: twice(s), SUPABASE_SERVICE_ROLE_KEY: twice(s) } }), miss: { stack: { AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T0/B0/x', SAFETY_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T0/B0/x' } } },
  { code: 'D6', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { LLM_ALLOWED_ORIGINS: `https://app.example.org,http://${s}.example` } }), miss: { stack: { LLM_ALLOWED_ORIGINS: 'https://app.example.org,https://www.example.org' } } },
  { code: 'D9', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { SAFETY_ALERT_WEBHOOK_URL: `http://${s}.example` } }), miss: { stack: { SAFETY_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T1/B1/y' } } },
  // E. Across files
  { code: 'E5', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { MEMANTO_SECRET_KEY: twice(s), MEMANTO_ENABLED: 'false' } }), miss: { stack: { MEMANTO_SECRET_KEY: 'change-me-memanto-secret' } } },
  // F. Profiles, host and checkout
  { code: 'F1', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { COMPOSE_PROFILES: `tts,tunnel,${s}` } }), miss: { stack: { COMPOSE_PROFILES: 'tts, tunnel' } } },
  { code: 'F3', levels: 'WWWW', ci: 'run', hit: (s) => ({ facts: { runningServices: ['db', 'api', 'mcp', 'kokoro-tts', 'cloudflared', 'hermes'] }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { facts: { runningServices: ['db', 'api', 'mcp', 'kokoro-tts', 'cloudflared', 'not-a-service'] } } },
  { code: 'F5', levels: 'WWWW', ci: 'skip', hit: (s) => ({ lastGreen: { stackEnvSha256: 'b'.repeat(64) }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { lastGreen: { stackEnvSha256: 'b'.repeat(64) }, facts: { from: 'deploy' } } },
  { code: 'F6', levels: 'EEEE', ci: 'run', hit: (s) => ({ facts: { diskFreeKb: 4 * 1024 * 1024 }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { facts: { diskFreeKb: 10 * 1024 * 1024 } } },
  { code: 'F9', levels: 'IIII', ci: 'run', hit: (s) => ({ facts: { pgdataVolume: false }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'F11', levels: 'EEEE', ci: 'skip', hit: (s) => ({ facts: { callerExports: ['HOME', 'LLM_GUEST_AI'] }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { facts: { callerExports: ['HOME', 'NODE_ENV', 'COMPOSE_PROFILES'] } } },
  // S. Optional services
  { code: 'S1', levels: 'EEEE', ci: 'run', hit: (s) => ({ stack: { COMPOSE_PROFILES: 'tts,tunnel,full', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'S2', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { COMPOSE_PROFILES: 'tts,tunnel,byoa' }, mcp: { ...GOOD_MCP, SUPABASE_ANON_KEY: twice(s) } }), miss: { stack: { COMPOSE_PROFILES: 'tts,tunnel,byoa' }, mcp: GOOD_MCP, record: { DECIDED_BYOA: DAY } } },
  { code: 'S3', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { MEMANTO_ENABLED: 'true', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { MEMANTO_ENABLED: 'true' }, record: { DECIDED_MEMORY: DAY } } },
  { code: 'S4', levels: 'EEEE', ci: 'skip', hit: (s) => ({ billing: { BILLING_ENABLED: 'true', BILLING_TEST_USER_IDS: s } }), miss: { billing: { BILLING_ENABLED: 'true' }, record: { DECIDED_BILLING: DAY } } },
  { code: 'S5', levels: 'WWWW', ci: 'skip', hit: (s) => ({ stack: { COMPOSE_PROFILES: 'tunnel', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'S6', levels: '-WWW', ci: 'skip', hit: (s) => ({ stack: { COMPOSE_PROFILES: 'tts', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  // G, K, M, R, V. Order, stage and record rules
  { code: 'G1', levels: 'EEEE', ci: 'skip', hit: (s) => ({ record: { PROD_AMR_CHECK: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { ACCOUNT_DELETION_ENABLED: 'false' }, record: { PROD_AMR_CHECK: '', VERCEL_LEGAL_PAGES_ON: '' } } },
  { code: 'G2', levels: 'EEEE', ci: 'skip', hit: (s) => ({ stack: { LEGAL_TERMS_REQUIRED: 'true', KOKORO_TTS_DEFAULT_VOICE_EN: s }, record: { VERCEL_LEGAL_PAGES_ON: '' } }), miss: { stack: { LEGAL_TERMS_REQUIRED: 'false' }, record: { VERCEL_LEGAL_PAGES_ON: '' } } },
  { code: 'G3', levels: '---E', ci: 'skip', hit: (s) => ({ stack: { ACCOUNT_DELETION_ENABLED: 'false', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { ACCOUNT_DELETION_ENABLED: 'yes' } } },
  { code: 'G5', levels: '--EE', ci: 'skip', hit: (s) => ({ record: { MINORS_POLICY_DECIDED: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'K1', levels: '-WEE', ci: 'skip', hit: (s) => ({ stack: { AI_CAP_ALERT_WEBHOOK_URL: '', KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { stack: { AI_CAP_ALERT_WEBHOOK_URL: '', SAFETY_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T1/B1/y' } } },
  { code: 'K3', levels: 'WWWW', ci: 'skip', hit: (s) => ({ stack: { AI_CAP_ALERT_WEBHOOK_URL: `https://${s}.example/x` } }), miss: { stack: { AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T2/B2/z' } } },
  { code: 'K4', levels: '-WEE', ci: 'skip', hit: (s) => ({ record: { ALERT_CHECK: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { record: { ALERT_CHECK: 'x'.repeat(80) } } },
  { code: 'K5', levels: '-WEE', ci: 'skip', hit: (s) => ({ record: { ALERT_TEST: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'M1', levels: 'WEEE', ci: 'skip', hit: (s) => ({ record: { MAC_DEV_DB_SEPARATE: null }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'R1', levels: 'WEEE', ci: 'skip', hit: (s) => ({ facts: { unitBackupTimer: 'disabled' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'R2', levels: '-WWW', ci: 'skip', hit: (s) => ({ facts: { backupLastOk: hoursAgo(37) }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { facts: { backupLastOk: hoursAgo(35), backupLastFail: hoursAgo(40) } } },
  { code: 'R3', levels: '-EEE', ci: 'skip', hit: (s) => ({ facts: { drillLastOk: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { facts: { drillLastOk: hoursAgo(24 * 35 - 1) } } },
  { code: 'R4', levels: '-EEE', ci: 'skip', hit: (s) => ({ record: { BACKUP_KEY_ID: 'fedcba9876543210' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { record: { BACKUP_KEY_ID: 'fedcba9876543210' }, facts: { backupKeyId: 'fedcba9876543210' } } },
  { code: 'R5', levels: '-EEE', ci: 'skip', hit: (s) => ({ record: { BACKUP_LIFECYCLE: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'R6', levels: '-EEE', ci: 'skip', hit: (s) => ({ facts: { backupAlert: 'false' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: { facts: { backupAlert: '' } } },
  { code: 'V1', levels: 'EEE-', ci: 'skip', hit: (s) => ({ record: { VERCEL_PROTECTION_ON: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
  { code: 'V3', levels: '---E', ci: 'skip', hit: (s) => ({ record: { VERCEL_PROTECTION_OFF: '' }, stack: { KOKORO_TTS_DEFAULT_VOICE_EN: s } }), miss: {} },
];

/** A name-shaped sentinel (passes the formatter's name filter): SENTINELX9F3 + 16 upper-case hex. */
export function sentinel() {
  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  return `SENTINELX9F3${hex}`;
}
