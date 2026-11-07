// @ts-check
/**
 * The Vercel build's env check (Phase 9, owner decision D5; doc/guides/first-launch.ja.md 13 章, codes VB1-VB11).
 * vite.config.ts's `vercel-env-guard` plugin imports this module only when process.env.VERCEL is '1' (Vercel's
 * build sets it); CI's build:prod and the e2e front build never set it, so there the plugin returns at once.
 * Errors stop the Vercel build (the deployment that is live stays live); warnings are printed in its build log.
 *
 * The rules are for the public app's Vercel project only. The job-training school's build (its own Vercel
 * project from the `release` branch, doc/brushup-2026/training-plan.ja.md D8 and §4.7) turns on
 * VITE_FEATURE_TRAINING, which VB2 refuses: it needs its own switch here (as preflight C6 does for
 * TRAINING_ENABLED on the VM) before `release` gets this code.
 *
 * Errors are about values that are present: an unset value is never refused (whether Vercel's build step sees
 * VERCEL_ENV and the names without VITE_ is not confirmed; without them those rules simply do not run).
 *
 * Value safety: a problem is an English one-liner with a code and names only, never a value or a part of one.
 * Only the names in ENV_NAMES are read from the process env, and VITE_ names from Vite's env; never
 * VERCEL_AUTOMATION_BYPASS_SECRET (Vercel sets it in builds). Pure; built-ins only.
 */
import { Buffer } from 'node:buffer';

/** @typedef {'E' | 'W'} Level */
/** @typedef {{ code: string, level: Level, message: string }} VercelRule */
/** @typedef {{ errors: string[], warnings: string[] }} VercelProblems */

/**
 * Every code, in order. `message` is printed as `<code>: <message>`; {names} is replaced by the names that
 * triggered the rule (never their values).
 */
export const VERCEL_RULES = Object.freeze(/** @type {readonly VercelRule[]} */ ([
  { code: 'VB1', level: 'E', message: 'VITE_API_BASE_URL is set. Delete it: unset, the app calls /api/v2 on its own address and vercel.json forwards that to the API.' },
  { code: 'VB2', level: 'E', message: 'Set to "true": {names}. Delete these: the job-training section and the shared AI chat are not offered in the public app.' },
  { code: 'VB3', level: 'E', message: 'VITE_SUPABASE_URL is not an https:// address.' },
  { code: 'VB4', level: 'E', message: 'VITE_SUPABASE_ANON_KEY holds a secret key (service_role or sb_secret_). Put the anon key there, and replace the secret key in Supabase: it may have been exposed.' },
  { code: 'VB5', level: 'E', message: 'VITE_FEATURE_LEGAL_PAGES is "true" but VITE_SUPPORT_CONTACT is not an https:// address or a mailto: address.' },
  { code: 'VB6', level: 'E', message: 'VITE_APP_BASE_PATH is set to something other than "/". Delete it: the app is served at the root of its address.' },
  { code: 'VB7', level: 'W', message: 'VITE_FEATURE_BILLING is "true": the paid plan stays off at the first launch.' },
  { code: 'VB8', level: 'W', message: 'Set: {names}. A session from the Nexloom project reaches neither account deletion nor consent on the server.' },
  { code: 'VB9', level: 'W', message: 'A Preview build has {names}: previews would use the production sign-in, database or LLM budget.' },
  { code: 'VB10', level: 'W', message: 'API_ORIGIN is not https:// with a host only (no path, no trailing slash).' },
  { code: 'VB11', level: 'W', message: 'ORIGIN_SECRET is shorter than 32 characters.' },
]));

/** The only names read from the process env (Vite's env gives the VITE_ ones). */
export const ENV_NAMES = Object.freeze(['VERCEL_ENV', 'API_ORIGIN', 'ORIGIN_SECRET']);

/** Where the build log sends the reader. */
export const VERCEL_RUNBOOK = 'doc/guides/first-launch.ja.md, chapter 13 (VB codes)';

const BY_CODE = new Map(VERCEL_RULES.map((rule) => [rule.code, rule]));
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;
/** config/support.ts parseSupportContact: mailto: with exactly one address and no query. */
const MAIL = /^mailto:([^\s@,;?&#/:]+@[^\s@,;?&#/:]+\.[^\s@,;?&#/:]+)$/i;
const HTTPS_ORIGIN = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/;

/** @param {unknown} value */
const present = (value) => typeof value === 'string' && value.trim() !== '';

/** @param {string} value an https:// URL with a host and no user name or password */
function isHttpsUrl(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** config/support.ts: an https:// URL or mailto: with one address. @param {unknown} value */
function isSupportContact(value) {
  if (!present(value)) return false;
  const text = /** @type {string} */ (value).trim();
  return MAIL.test(text) || isHttpsUrl(text);
}

/**
 * A Supabase secret key: sb_secret_… anywhere (quotes or a `NAME=` pasted in front of it still ship it), or a
 * JWT whose payload says role service_role. @param {string} value
 */
function isSecretSupabaseKey(value) {
  const key = value.trim();
  if (/\bsb_secret_/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Boolean(payload) && typeof payload === 'object' && payload.role === 'service_role';
  } catch {
    return false;
  }
}

/** Reads `name` from an env object. @param {Record<string, string | undefined>} source @param {string} name */
const get = (source, name) => source[name];

/**
 * The problems of a Vercel build's env.
 * @param {{ env?: Record<string, string | undefined>, viteEnv?: Record<string, string | undefined> }} input
 *   env: the process env (only ENV_NAMES are read); viteEnv: Vite's loadEnv(mode, root, 'VITE_') result.
 * @returns {VercelProblems}
 */
export function vercelEnvProblems({ env = {}, viteEnv = {} } = {}) {
  /** @type {VercelProblems} */
  const out = { errors: [], warnings: [] };
  /** @param {string} code @param {string[]} [names] */
  const add = (code, names = []) => {
    const rule = /** @type {VercelRule} */ (BY_CODE.get(code));
    const shown = names.filter((n) => NAME_RE.test(n));
    const line = `${code}: ${rule.message.replace('{names}', shown.join(', '))}`;
    (rule.level === 'E' ? out.errors : out.warnings).push(line);
  };
  const vite = (/** @type {string} */ name) => get(viteEnv, name);
  const viteNames = Object.keys(viteEnv).filter((name) => NAME_RE.test(name)).sort();

  if (present(vite('VITE_API_BASE_URL'))) add('VB1');
  const shownFlags = ['VITE_FEATURE_TRAINING', 'VITE_FEATURE_AGENT_CHAT'].filter((name) => vite(name) === 'true');
  if (shownFlags.length) add('VB2', shownFlags);
  const supabaseUrl = vite('VITE_SUPABASE_URL');
  if (present(supabaseUrl) && !isHttpsUrl(/** @type {string} */ (supabaseUrl))) add('VB3');
  const anonKey = vite('VITE_SUPABASE_ANON_KEY');
  if (present(anonKey) && isSecretSupabaseKey(/** @type {string} */ (anonKey))) add('VB4');
  if (vite('VITE_FEATURE_LEGAL_PAGES') === 'true' && !isSupportContact(vite('VITE_SUPPORT_CONTACT'))) add('VB5');
  const basePath = vite('VITE_APP_BASE_PATH');
  if (present(basePath) && /** @type {string} */ (basePath).trim() !== '/') add('VB6');

  if (vite('VITE_FEATURE_BILLING') === 'true') add('VB7');
  const nexloom = viteNames.filter((name) => name.startsWith('VITE_NEXLOOM_SUPABASE_') && present(vite(name)));
  if (nexloom.length) add('VB8', nexloom);

  const scope = get(env, 'VERCEL_ENV');
  const apiOrigin = get(env, 'API_ORIGIN');
  const originSecret = get(env, 'ORIGIN_SECRET');
  if (scope === 'preview') {
    const leaked = [
      ...viteNames.filter((name) => name.startsWith('VITE_SUPABASE_') && present(vite(name))),
      ...(present(apiOrigin) ? ['API_ORIGIN'] : []),
      ...(present(originSecret) ? ['ORIGIN_SECRET'] : []),
    ];
    if (leaked.length) add('VB9', leaked);
  }
  if (scope === 'production') {
    if (present(apiOrigin) && !HTTPS_ORIGIN.test(/** @type {string} */ (apiOrigin))) add('VB10');
    if (present(originSecret) && /** @type {string} */ (originSecret).length < 32) add('VB11');
  }
  return out;
}

/**
 * The build log's lines for a result (Vite puts `[plugin vercel-env-guard]` in front of each): each warning with
 * where to read more, and the errors as one message.
 * @param {VercelProblems} problems
 * @returns {{ error: string | null, warnings: string[] }} error: one message that stops the build (null: none)
 */
export function formatVercelProblems(problems) {
  const warnings = problems.warnings.map((line) => `${line} (${VERCEL_RUNBOOK})`);
  const error = problems.errors.length
    ? `This Vercel build stops: fix these in Vercel's Environment Variables, then Redeploy (${VERCEL_RUNBOOK}).\n- ${problems.errors.join('\n- ')}`
    : null;
  return { error, warnings };
}
