#!/usr/bin/env node
// @ts-check
/**
 * Smoke test for the public edge: Vercel app.<domain> → Cloudflare Tunnel api.<domain> → api:3006.
 * Run from any machine after the cutover (deploy/vercel/README.md, 確認チェックリスト; doc/guides/
 * first-launch.ja.md, at the end of 手順書 10.3, right after the Vercel protection comes off). Uses Node's
 * built-in fetch only; reads shell variables only, never .env.local or stack.env.
 *
 * Usage:
 *   PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge
 *   SMOKE_BEARER=<Supabase access token> ...   # optional: Authorization survives the route (check 9)
 *   PUBLIC_MCP_URL=https://mcp.<domain> ...    # optional: check 14's host (default: api. → mcp.)
 *   SMOKE_BYOA=1 ...                           # only once AI apps are connected (byoa): check 14 wants 200
 *
 * Checks 0 (https only) and 10-14 (Phase 9, design §6.2): the AI settings the api reports, CORS for
 * another site and for the app, a guest's tutor call refused by the AI access gate, the security headers,
 * and the remote MCP host closed while byoa is off. Exits 1 when a required check fails. SMOKE_BEARER and
 * response bodies are never printed. runEdgeSmoke is the testable core (server/tests/smokePublicEdge.test.js).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 30_000;
const FORGED_SECRET = 'smoke-forged-value';
/** Another site's origin (check 11): the API must not let it read answers. */
export const FOREIGN_ORIGIN = 'https://evil.example';
/**
 * A guest's tutor question from inside a lesson (check 12). It passes the body check and the
 * lesson-only rule for guests (server/routes/llm.js requireLessonForGuests), so the refusal that comes
 * back is the AI access gate's (server/middleware/aiAccessGate.js: 401 sign_in_required), before the
 * guest budget and any model. An empty body would stop at the body check with 400.
 */
export const TUTOR_GUEST_PROBE = Object.freeze({
  message: 'smoke:edge',
  lesson: { courseId: 'smoke-edge', lessonId: 'smoke-edge', title: 'smoke:edge', objectives: [] },
  anchor: { sectionId: 'smoke-edge', blockId: 'smoke-edge', blockType: 'paragraph', excerpt: 'smoke:edge' },
});
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * @typedef {{ res: Response | null, body: string, error: any }} Answer
 */

/**
 * The checks. Returns the counts; prints one line per check (never a body or the bearer).
 * @param {{ app: string, api: string, mcp?: string | null, bearer?: string, fetchImpl?: typeof fetch,
 *   log?: (line: string) => void, byoa?: boolean, allowHttpLoopback?: boolean }} options
 *   app, api, mcp: origins. allowHttpLoopback lets tests use http://127.0.0.1 (check 0 refuses http otherwise).
 * @returns {Promise<{ passes: number, failures: number }>}
 */
export async function runEdgeSmoke({ app, api, mcp = null, bearer = '', fetchImpl = fetch, log = console.log, byoa = false, allowHttpLoopback = false }) {
  let failures = 0;
  let passes = 0;
  /** @param {string} text */
  const pass = (text) => {
    passes += 1;
    log(`✅ ${text}`);
  };
  /** @param {string} text */
  const fail = (text) => {
    failures += 1;
    log(`❌ ${text}`);
  };
  /** @param {boolean} ok @param {string} text @param {string} [detail] */
  const check = (ok, text, detail) => (ok ? pass(text) : fail(detail ? `${text} — ${detail}` : text));

  /**
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<Answer>}
   */
  const request = async (url, init = {}) => {
    try {
      const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
      const body = await res.text();
      return { res, body, error: null };
    } catch (error) {
      return { res: null, body: '', error };
    }
  };
  // redact: print only the error's name, for a request that carries Authorization (undici puts the
  // rejected header value in the message).
  /** @param {Answer} answer @param {{ redact?: boolean }} [opts] */
  const statusOf = ({ res, error }, { redact = false } = {}) =>
    (error ? `unreachable (${redact ? error?.name : error?.message})` : String(res?.status));
  /** @param {Response | null} res @param {string} name */
  const header = (res, name) => res?.headers.get(name) ?? '';

  // 0. Every origin is https: the edge never carries a learner's session over plain http.
  /** @param {string} origin */
  const httpsOk = (origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' || (allowHttpLoopback && url.protocol === 'http:' && LOOPBACK.has(url.hostname));
    } catch {
      return false;
    }
  };
  const named = /** @type {[string, string][]} */ ([['PUBLIC_APP_URL', app], ['PUBLIC_API_URL', api], ...(mcp ? [['PUBLIC_MCP_URL', mcp]] : [])]);
  const plain = named.filter(([, origin]) => !httpsOk(origin)).map(([name]) => name);
  check(plain.length === 0, '0. PUBLIC_APP_URL and PUBLIC_API_URL use https://', `not https: ${plain.join(', ')} (no request sent)`);
  if (plain.length > 0) return { passes, failures };

  // 1. The app's health goes through the Vercel route and the gate; the edge view is ok/status only.
  const health = await request(`${app}/api/v2/health`);
  const healthJson = parseJson(health.body);
  const healthKeys = healthJson && typeof healthJson === 'object' ? Object.keys(healthJson).sort().join(',') : '';
  check(
    [200, 503].includes(health.res?.status ?? 0) && healthKeys === 'ok,status',
    `1. GET app /api/v2/health → ${statusOf(health)} with keys {ok,status}`,
    `got keys {${healthKeys || 'no JSON'}}`,
  );
  if (health.res?.status === 503) log('   ⚠️  status=degraded: check the VM (docker compose ps, logs api)');

  // 2. Direct hits on api.<domain> are refused, with no secret and with a guessed one.
  const direct = await request(`${api}/api/v2/health`);
  check(direct.res?.status === 403, `2a. GET api /api/v2/health without x-origin-secret → ${statusOf(direct)} (want 403)`);
  const forgedDirect = await request(`${api}/api/v2/health`, { headers: { 'x-origin-secret': FORGED_SECRET } });
  check(forgedDirect.res?.status === 403, `2b. GET api /api/v2/health with a forged x-origin-secret → ${statusOf(forgedDirect)} (want 403)`);

  // 3. API responses are never served from Vercel's cache.
  /** @type {Answer | null} */
  let llmStatus = null;
  for (const attempt of [1, 2]) {
    const status = await request(`${app}/api/v2/llm/status`);
    if (attempt === 1) llmStatus = status;
    const cacheControl = header(status.res, 'cache-control');
    const vercelCache = header(status.res, 'x-vercel-cache').toUpperCase();
    const problems = [];
    if (status.res?.status !== 200) problems.push(`status ${statusOf(status)}`);
    if (!/no-store/i.test(cacheControl)) problems.push(`cache-control "${cacheControl}"`);
    if (vercelCache === 'HIT' || vercelCache === 'STALE') problems.push(`x-vercel-cache ${vercelCache}`);
    check(
      problems.length === 0,
      `3${attempt === 1 ? 'a' : 'b'}. GET app /api/v2/llm/status → 200, no-store, x-vercel-cache ${vercelCache || '(none)'}`,
      problems.join(', '),
    );
  }

  // 4. Informational: does the route's `set` transform replace a visitor's x-origin-secret?
  const forgedApp = await request(`${app}/api/v2/llm/status`, { headers: { 'x-origin-secret': FORGED_SECRET } });
  if (forgedApp.res?.status === 200) {
    log('ℹ️  4. Forged x-origin-secret via app → 200: Vercel\'s set replaces the visitor\'s value');
  } else if (forgedApp.res?.status === 403) {
    log('ℹ️  4. Forged x-origin-secret via app → 403: the visitor\'s value is kept and fails closed');
  } else {
    log(`ℹ️  4. Forged x-origin-secret via app → ${statusOf(forgedApp)}`);
  }

  // 5. The deleted legacy TTS endpoint stays gone.
  const legacyAudio = await request(`${app}/api/generate-audio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  check(legacyAudio.res?.status === 404, `5. POST app /api/generate-audio → ${statusOf(legacyAudio)} (want 404)`);

  // 6. Uploads are not proxied: the SPA answers instead.
  const uploads = await request(`${app}/uploads/smoke-check.txt`);
  const uploadsType = header(uploads.res, 'content-type');
  check(
    uploads.res?.status === 200 && /^text\/html/i.test(uploadsType),
    `6. GET app /uploads/smoke-check.txt → ${statusOf(uploads)} ${uploadsType || '(no content-type)'} (want the SPA's text/html)`,
  );

  // 7. Missing build chunks are a clean 404, not index.html.
  const chunk = await request(`${app}/assets/smoke-missing.js`);
  check(chunk.res?.status === 404, `7. GET app /assets/smoke-missing.js → ${statusOf(chunk)} (want 404)`);

  // 8. The query string reaches the API; confirm in the api log on the VM.
  const smokeId = crypto.randomBytes(6).toString('hex');
  const query = await request(`${app}/api/v2/llm/status?smoke=${smokeId}`);
  check(query.res?.status === 200, `8. GET app /api/v2/llm/status?smoke=${smokeId} → ${statusOf(query)} (want 200)`);
  log('   On the VM (deploy/risepath-vm), this should print one line:');
  log(`   docker compose --env-file stack.env logs api | grep smoke=${smokeId}`);

  // 9. Authorization survives the route (optional).
  if (bearer) {
    const profile = await request(`${app}/api/v2/user/profile`, { headers: { authorization: `Bearer ${bearer}` } });
    check(
      profile.res?.status === 200,
      `9. GET app /api/v2/user/profile with Authorization → ${statusOf(profile, { redact: true })} (want 200)`,
    );
  }

  // 10. The AI settings the api reports (check 3's answer; server/llm/index.js status()): the model key is
  // there, Gemini is not allowed, no mock and no provider forced other than anthropic (preflight C4).
  const s = parseJson(llmStatus?.body ?? '');
  const wrong = [];
  if (s?.providers?.anthropic?.configured !== true) wrong.push('providers.anthropic.configured');
  if (s?.providers?.gemini?.allowed !== false) wrong.push('providers.gemini.allowed');
  if (s?.mock !== false) wrong.push('mock');
  if (!s || !(s.forced_provider === null || s.forced_provider === 'anthropic')) wrong.push('forced_provider');
  check(wrong.length === 0, '10. GET app /api/v2/llm/status: anthropic configured, Gemini not allowed, no mock, no other forced provider',
    `not as wanted: ${wrong.join(', ')}`);

  // 11. CORS: another site gets no access-control-allow-origin; the app's own origin gets itself back.
  // Whether Vercel forwards Origin is not documented: without the header for the app, ℹ️ only.
  const foreign = await request(`${app}/api/v2/llm/status`, { headers: { origin: FOREIGN_ORIGIN } });
  check(
    foreign.res?.status === 200 && header(foreign.res, 'access-control-allow-origin') === '',
    `11a. GET app /api/v2/llm/status with Origin ${FOREIGN_ORIGIN} → ${statusOf(foreign)}, no access-control-allow-origin`,
    header(foreign.res, 'access-control-allow-origin') ? 'the API allows that origin' : undefined,
  );
  const own = await request(`${app}/api/v2/llm/status`, { headers: { origin: app } });
  const ownAllowed = header(own.res, 'access-control-allow-origin');
  if (own.res?.status === 200 && ownAllowed === '') {
    log('ℹ️  11b. Origin of the app → no access-control-allow-origin: the route may not forward Origin (the app\'s own requests are same-origin and need none)');
  } else {
    check(own.res?.status === 200 && ownAllowed === app, `11b. GET app /api/v2/llm/status with the app's Origin → ${statusOf(own)}, access-control-allow-origin is the app`,
      ownAllowed ? 'another origin is allowed' : undefined);
  }

  // 12. A guest's tutor question is refused by the AI access gate, before any model or budget.
  const tutor = await request(`${app}/api/v2/llm/tutor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: app },
    body: JSON.stringify(TUTOR_GUEST_PROBE),
  });
  const tutorType = parseJson(tutor.body)?.error_type;
  check(
    tutor.res?.status === 401 && tutorType === 'sign_in_required',
    `12. POST app /api/v2/llm/tutor as a guest → ${statusOf(tutor)} (want 401 sign_in_required)`,
    typeof tutorType === 'string' && /^[a-z_]{1,40}$/.test(tutorType) ? `error_type ${tutorType}` : 'no error_type',
  );

  // 13. Security headers: the app's page may not be framed by another site or sniffed; no API answer
  // names its framework.
  const page = await request(`${app}/`);
  const frame = header(page.res, 'x-frame-options').toUpperCase();
  const sniff = header(page.res, 'x-content-type-options').toLowerCase();
  check(page.res?.status === 200 && frame === 'SAMEORIGIN' && sniff === 'nosniff',
    `13a. GET app / → ${statusOf(page)}, X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff`,
    `X-Frame-Options ${frame || '(none)'}, X-Content-Type-Options ${sniff || '(none)'}`);
  const powered = [direct, forgedDirect, llmStatus, foreign, own, tutor].filter((a) => a?.res && header(a.res, 'x-powered-by') !== '').length;
  check(powered === 0, '13b. API answers carry no X-Powered-By', `${powered} answer(s) carry it`);

  // 14. The remote MCP host: closed while AI apps are not connected (byoa off, owner decision D3).
  if (!mcp) {
    log('ℹ️  14. skipped: PUBLIC_API_URL does not start with api. (set PUBLIC_MCP_URL to check the mcp. host)');
  } else {
    const prm = await request(`${mcp}/.well-known/oauth-protected-resource`);
    const code = prm.res?.status ?? 0;
    if (byoa) {
      const doc = parseJson(prm.body);
      check(code === 200 && Boolean(doc) && typeof doc === 'object', `14. GET mcp /.well-known/oauth-protected-resource → ${statusOf(prm)} (SMOKE_BYOA=1: want 200 JSON)`);
    } else {
      check(prm.error !== null || code < 200 || code > 299,
        `14. GET mcp /.well-known/oauth-protected-resource → ${prm.error ? 'no answer' : statusOf(prm)} (byoa off: want no answer or not 2xx)`);
    }
  }
  return { passes, failures };
}

/** @param {string} body */
function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** @param {string} [message] @returns {never} */
function usage(message) {
  if (message) console.error(`❌ ${message}\n`);
  console.error([
    'Usage:',
    '  PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge',
    '',
    'Optional: SMOKE_BEARER=<Supabase access token> (exported in this shell only; never printed)',
    'also checks that Authorization reaches the API through the Vercel route.',
    'Optional: PUBLIC_MCP_URL=https://mcp.<domain> (default: the API URL with api. → mcp.);',
    'SMOKE_BYOA=1 only once AI apps are connected (byoa).',
  ].join('\n'));
  process.exit(1);
}

/** @param {string} name @param {string | undefined} raw @returns {string} the origin */
function readOrigin(name, raw) {
  const value = (raw || '').trim();
  if (!value) usage(`${name} is not set`);
  let url;
  try {
    url = new URL(value);
  } catch {
    usage(`${name} is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') usage(`${name} must be an https URL`);
  return url.origin;
}

/**
 * The CLI: shell variables only. http:// origins reach check 0, which refuses them before any request.
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>} the exit code
 */
export async function main(env = process.env) {
  const app = readOrigin('PUBLIC_APP_URL', env.PUBLIC_APP_URL);
  const api = readOrigin('PUBLIC_API_URL', env.PUBLIC_API_URL);
  let mcp = null;
  if ((env.PUBLIC_MCP_URL || '').trim()) {
    mcp = readOrigin('PUBLIC_MCP_URL', env.PUBLIC_MCP_URL);
  } else {
    const url = new URL(api);
    if (url.hostname.startsWith('api.')) {
      url.hostname = `mcp.${url.hostname.slice('api.'.length)}`;
      mcp = url.origin;
    }
  }
  // The token with or without a leading "Bearer ". A value a header cannot carry is refused unechoed.
  const bearer = (env.SMOKE_BEARER || '').trim().replace(/^bearer\s+/i, '');
  if (bearer && !/^[\x21-\x7e]+$/.test(bearer)) {
    usage('SMOKE_BEARER has characters a header cannot carry (want printable ASCII, no spaces or line breaks)');
  }
  const byoa = env.SMOKE_BYOA === '1';
  console.log('# Rise Path public edge smoke');
  console.log(`App: ${app}`);
  console.log(`API: ${api}`);
  console.log(`MCP: ${mcp ?? '(not checked)'}${byoa ? ' (SMOKE_BYOA=1)' : ''}`);
  console.log(`Bearer: ${bearer ? 'set (not printed)' : 'not set (check 9 skipped)'}\n`);
  const { passes, failures } = await runEdgeSmoke({ app, api, mcp, bearer, byoa });
  console.log(`\n${failures === 0 ? '✅' : '❌'} ${passes} passed, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`❌ smoke:edge crashed: ${error?.name ?? 'Error'}`);
    process.exit(1);
  });
}
