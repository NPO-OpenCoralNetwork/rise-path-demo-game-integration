#!/usr/bin/env node
/**
 * Smoke test for the public edge: Vercel app.<domain> → Cloudflare Tunnel api.<domain> → api:3006.
 * Run from any machine after the cutover (deploy/vercel/README.md, 確認チェックリスト). Uses Node's
 * built-in fetch only; reads shell variables only, never .env.local or stack.env.
 *
 * Usage:
 *   PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge
 *   SMOKE_BEARER=<Supabase access token> ...   # optional: Authorization survives the route
 *
 * Exits 1 when a required check fails. SMOKE_BEARER and response bodies are never printed.
 */
import crypto from 'node:crypto';

const TIMEOUT_MS = 30_000;
const FORGED_SECRET = 'smoke-forged-value';

function usage(message) {
  if (message) console.error(`❌ ${message}\n`);
  console.error([
    'Usage:',
    '  PUBLIC_APP_URL=https://app.<domain> PUBLIC_API_URL=https://api.<domain> npm run smoke:edge',
    '',
    'Optional: SMOKE_BEARER=<Supabase access token> (exported in this shell only; never printed)',
    'also checks that Authorization reaches the API through the Vercel route.',
  ].join('\n'));
  process.exit(1);
}

/** @param {string} name */
function readOrigin(name) {
  const raw = (process.env[name] || '').trim();
  if (!raw) usage(`${name} is not set`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    usage(`${name} is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') usage(`${name} must be an http(s) URL`);
  return url.origin;
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<{ res: Response | null, body: string, error: Error | null }>}
 */
async function request(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
    const body = await res.text();
    return { res, body, error: null };
  } catch (error) {
    return { res: null, body: '', error };
  }
}

// redact: print only the error's name, for a request that carries Authorization (undici puts the
// rejected header value in the message).
const statusOf = ({ res, error }, { redact = false } = {}) =>
  (error ? `unreachable (${redact ? error.name : error.message})` : String(res.status));
const header = (res, name) => res?.headers.get(name) ?? '';

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function main() {
  const app = readOrigin('PUBLIC_APP_URL');
  const api = readOrigin('PUBLIC_API_URL');
  // The token with or without a leading "Bearer ". A value a header cannot carry is refused unechoed.
  const bearer = (process.env.SMOKE_BEARER || '').trim().replace(/^bearer\s+/i, '');
  if (bearer && !/^[\x21-\x7e]+$/.test(bearer)) {
    usage('SMOKE_BEARER has characters a header cannot carry (want printable ASCII, no spaces or line breaks)');
  }
  let failures = 0;
  let passes = 0;

  const pass = (text) => {
    passes += 1;
    console.log(`✅ ${text}`);
  };
  const fail = (text) => {
    failures += 1;
    console.log(`❌ ${text}`);
  };
  const check = (ok, text, detail) => (ok ? pass(text) : fail(detail ? `${text} — ${detail}` : text));

  console.log('# Rise Path public edge smoke');
  console.log(`App: ${app}`);
  console.log(`API: ${api}`);
  console.log(`Bearer: ${bearer ? 'set (not printed)' : 'not set (check 9 skipped)'}\n`);

  // 1. The app's health goes through the Vercel route and the gate; the edge view is ok/status only.
  const health = await request(`${app}/api/v2/health`);
  const healthJson = parseJson(health.body);
  const healthKeys = healthJson && typeof healthJson === 'object' ? Object.keys(healthJson).sort().join(',') : '';
  check(
    [200, 503].includes(health.res?.status) && healthKeys === 'ok,status',
    `1. GET app /api/v2/health → ${statusOf(health)} with keys {ok,status}`,
    `got keys {${healthKeys || 'no JSON'}}`,
  );
  if (health.res?.status === 503) console.log('   ⚠️  status=degraded: check the VM (docker compose ps, logs api)');

  // 2. Direct hits on api.<domain> are refused, with no secret and with a guessed one.
  const direct = await request(`${api}/api/v2/health`);
  check(direct.res?.status === 403, `2a. GET api /api/v2/health without x-origin-secret → ${statusOf(direct)} (want 403)`);
  const forgedDirect = await request(`${api}/api/v2/health`, { headers: { 'x-origin-secret': FORGED_SECRET } });
  check(forgedDirect.res?.status === 403, `2b. GET api /api/v2/health with a forged x-origin-secret → ${statusOf(forgedDirect)} (want 403)`);

  // 3. API responses are never served from Vercel's cache.
  for (const attempt of [1, 2]) {
    const status = await request(`${app}/api/v2/llm/status`);
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
    console.log('ℹ️  4. Forged x-origin-secret via app → 200: Vercel\'s set replaces the visitor\'s value');
  } else if (forgedApp.res?.status === 403) {
    console.log('ℹ️  4. Forged x-origin-secret via app → 403: the visitor\'s value is kept and fails closed');
  } else {
    console.log(`ℹ️  4. Forged x-origin-secret via app → ${statusOf(forgedApp)}`);
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
  console.log('   On the VM (deploy/risepath-vm), this should print one line:');
  console.log(`   docker compose --env-file stack.env logs api | grep smoke=${smokeId}`);

  // 9. Authorization survives the route (optional).
  if (bearer) {
    const profile = await request(`${app}/api/v2/user/profile`, { headers: { authorization: `Bearer ${bearer}` } });
    check(
      profile.res?.status === 200,
      `9. GET app /api/v2/user/profile with Authorization → ${statusOf(profile, { redact: true })} (want 200)`,
    );
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} ${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`❌ smoke:edge crashed: ${error.message}`);
  process.exit(1);
});
