#!/usr/bin/env node
// @ts-check
/**
 * A stand-in for the Supabase Auth endpoints that the learner end-to-end checks reach (Phase 7;
 * doc/brushup-2026/ai-access-plan.ja.md). CI and local test runs only: it refuses to start without
 * RISEPATH_E2E_AUTH_STANDIN=1, under NODE_ENV=production and on Vercel; no runtime image contains
 * e2e/ (the api and mcp stages of deploy/risepath-vm/Dockerfile and the production stage of the root
 * Dockerfile copy explicit folder lists; the root builder stage's `COPY . .` keeps only dist/); and
 * `npm run lint:arch` fails when code outside e2e/ and server/tests/ imports it
 * (server/tests/architectureBoundaries.test.js). Node built-ins only.
 *
 * Callers: supabase-js 2.89 in the browser (a production build whose VITE_SUPABASE_URL points here)
 * and the api, which checks every bearer token with one GET /auth/v1/user (server/middleware/auth.js).
 * scripts/ci/stack.sh auth runs it in a container on the CI stack's network.
 *
 * Learners: any email e2e-<a-z0-9->@example.org with STANDIN_PASSWORD. The user id is derived from
 * the email (userIdFor), so a fresh email is a fresh learner and a test knows the id beforehand.
 * Tokens are HS256 JWTs signed with a key made at start and never stored or printed: they are
 * worthless anywhere else, and the real Supabase rejects them. The claims are the ones the api reads
 * (tools/core/oauthToken.js): aud authenticated, no client_id, a lower-case UUID sub, and the
 * password sign-in time in amr, which a refresh keeps (as Supabase does; account deletion needs a
 * password sign-in of the last 120 s, server/routes/account.js).
 *
 * Each request logs one line: METHOD /auth/v1/<path>[?grant_type=<grant>] <status>. Never a body,
 * header, token, email or password.
 *
 *   RISEPATH_E2E_AUTH_STANDIN=1 node e2e/support/auth-stand-in.mjs
 *     E2E_AUTH_HOST (default 127.0.0.1), E2E_AUTH_PORT (default 54390), E2E_AUTH_PUBLIC_URL (default
 *     http://127.0.0.1:<port>; the tokens' iss is <public url>/auth/v1)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

/** The switch the stand-in needs, set only by scripts/ci/stack.sh auth and the tests. */
export const STANDIN_SWITCH = 'RISEPATH_E2E_AUTH_STANDIN';
/** The one password every e2e learner signs in with (a dummy: nothing else accepts it). */
export const STANDIN_PASSWORD = 'e2e-dummy-password';
/** The port of deploy/risepath-vm/ci/stack.ci.env's SUPABASE_URL (server/tests pins them equal). */
export const DEFAULT_PORT = 54390;
/** The emails it signs in: e2e-<1-60 of a-z, 0-9, ->@example.org (example.org is reserved, RFC 2606). */
export const LEARNER_EMAIL = /^e2e-[a-z0-9-]{1,60}@example\.org$/;

const TTL_S = 3600;
const MAX_BODY_BYTES = 64 * 1024;
const ALLOW_HEADERS = 'apikey, authorization, content-type, x-client-info, x-supabase-api-version';
const ALLOW_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

/**
 * Throws, with the reason, unless this environment may run the stand-in: the switch is exactly '1',
 * NODE_ENV is not production, and neither VERCEL nor VERCEL_ENV is set.
 * @param {Record<string, string | undefined>} env
 */
export function assertStandInAllowed(env) {
  if (env[STANDIN_SWITCH] !== '1') throw new Error(`auth stand-in refused: set ${STANDIN_SWITCH}=1 (end-to-end checks only)`);
  if (env.NODE_ENV === 'production') throw new Error('auth stand-in refused: NODE_ENV is production');
  if (env.VERCEL !== undefined || env.VERCEL_ENV !== undefined) throw new Error('auth stand-in refused: this is a Vercel environment');
}

/**
 * The user id of an e2e learner: a lower-case, v4-shaped UUID from the SHA-256 of the email, so
 * tools/core/accountDeletions.js canonicalUserId(id) === id.
 * @param {string} email
 */
export function userIdFor(email) {
  const h = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** @param {unknown} value */
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** @param {string} segment @returns {Record<string, any> | null} */
function decodeSegment(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ sub: string, email: string, amrAt: number, sessionId: string }} Session
 * @typedef {{ host?: string, port?: number, publicUrl?: string, env?: Record<string, string | undefined>,
 *   log?: (line: string) => void, now?: () => number }} StandInOptions
 */

/**
 * Starts the stand-in. It refuses (rejects) as assertStandInAllowed does. `port` 0 picks a free port;
 * `now` (milliseconds) is the clock for iat, exp and amr. Resolves with the listening URL and close().
 * @param {StandInOptions} [options]
 * @returns {Promise<{ url: string, publicUrl: string, close: () => Promise<void> }>}
 */
export async function startAuthStandIn({ host = '127.0.0.1', port = DEFAULT_PORT, publicUrl, env = process.env, log = (line) => console.log(line), now = Date.now } = {}) {
  assertStandInAllowed(env);
  const key = crypto.randomBytes(32);
  /** Refresh tokens, each usable once. @type {Map<string, Session>} */
  const refreshTokens = new Map();
  /** When each learner first signed in to this instance (their created_at). @type {Map<string, string>} */
  const created = new Map();
  /** @type {string} */
  let issuer = '';

  const nowS = () => Math.floor(now() / 1000);
  const iso = () => new Date(now()).toISOString();
  /** @param {string} data */
  const mac = (data) => crypto.createHmac('sha256', key).update(data).digest('base64url');
  /** @param {Record<string, unknown>} claims */
  const sign = (claims) => {
    const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
    return `${data}.${mac(data)}`;
  };
  /**
   * The claims of a token this instance signed and that has not expired, else null.
   * @param {string} token
   */
  const verify = (token) => {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    if (decodeSegment(h)?.alg !== 'HS256') return null;
    const want = Buffer.from(mac(`${h}.${p}`));
    const got = Buffer.from(s);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    const claims = decodeSegment(p);
    return claims && typeof claims.exp === 'number' && claims.exp > nowS() && typeof claims.sub === 'string' ? claims : null;
  };
  /** @param {string} sub @param {string} email */
  const userOf = (sub, email) => {
    const at = iso();
    const createdAt = created.get(sub) ?? at;
    return {
      id: sub,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: createdAt,
      confirmed_at: createdAt,
      phone: '',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [{
        identity_id: sub, id: sub, user_id: sub, provider: 'email', email,
        identity_data: { sub, email, email_verified: true, phone_verified: false },
        created_at: createdAt, updated_at: at, last_sign_in_at: at,
      }],
      created_at: createdAt,
      updated_at: at,
      last_sign_in_at: at,
      is_anonymous: false,
    };
  };
  /** A new access token and a one-time refresh token for a session. @param {Session} session */
  const sessionJson = (session) => {
    const iat = nowS();
    const accessToken = sign({
      iss: issuer, sub: session.sub, aud: 'authenticated', exp: iat + TTL_S, iat,
      email: session.email, phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
      role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: session.amrAt }],
      session_id: session.sessionId, is_anonymous: false,
    });
    const refreshToken = crypto.randomBytes(24).toString('base64url');
    refreshTokens.set(refreshToken, session);
    return {
      access_token: accessToken, token_type: 'bearer', expires_in: TTL_S, expires_at: iat + TTL_S,
      refresh_token: refreshToken, user: userOf(session.sub, session.email),
    };
  };

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  const handle = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stand-in');
    const path = url.pathname;
    const grant = url.searchParams.get('grant_type');
    /** @param {number} status @param {unknown} [body] */
    const send = (status, body) => {
      /** @type {Record<string, string>} */
      const headers = { 'access-control-allow-headers': ALLOW_HEADERS, 'access-control-allow-methods': ALLOW_METHODS, vary: 'Origin' };
      if (typeof req.headers.origin === 'string') headers['access-control-allow-origin'] = req.headers.origin;
      if (body !== undefined) headers['content-type'] = 'application/json';
      res.writeHead(status, headers);
      res.end(body === undefined ? '' : JSON.stringify(body));
      // Method, path and status only; the grant name only when it is a plain word.
      const shownPath = path.replace(/[^\x21-\x7e]/g, '?').slice(0, 120);
      const shownGrant = grant && /^[a-z_]{1,40}$/.test(grant) ? `?grant_type=${grant}` : '';
      log(`${String(req.method).slice(0, 10)} ${shownPath}${shownGrant} ${status}`);
    };
    /** @param {number} status @param {string} errorCode @param {string} msg */
    const fail = (status, errorCode, msg) => send(status, { code: status, error_code: errorCode, msg });

    if (req.method === 'OPTIONS') return send(204);
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) return fail(413, 'request_too_large', 'The request body is too large.');
    }
    /** @type {Record<string, unknown>} */
    let body = {};
    if (raw) {
      const parsed = (() => { try { return JSON.parse(raw); } catch { return undefined; } })();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'bad_json', 'The request body is not a JSON object.');
      body = parsed;
    }
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

    if (path === '/auth/v1/health' && req.method === 'GET') return send(200, { name: 'rise-path-e2e-auth-stand-in' });
    if (path === '/auth/v1/token' && req.method === 'POST' && grant === 'password') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!LEARNER_EMAIL.test(email) || body.password !== STANDIN_PASSWORD) return fail(400, 'invalid_credentials', 'Invalid login credentials');
      const sub = userIdFor(email);
      if (!created.has(sub)) created.set(sub, iso());
      return send(200, sessionJson({ sub, email, amrAt: nowS(), sessionId: crypto.randomUUID() }));
    }
    if (path === '/auth/v1/token' && req.method === 'POST' && grant === 'refresh_token') {
      const token = typeof body.refresh_token === 'string' ? body.refresh_token : '';
      const session = refreshTokens.get(token);
      if (!session) return fail(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      refreshTokens.delete(token);
      return send(200, sessionJson(session)); // the same sign-in time (amr) and session_id
    }
    if (path === '/auth/v1/user' && req.method === 'GET') {
      const claims = verify(bearer);
      return claims ? send(200, userOf(claims.sub, String(claims.email ?? ''))) : fail(401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature');
    }
    if (path === '/auth/v1/logout' && req.method === 'POST') {
      // supabase-js ignores 401, 403 and 404 here, so an unknown token is not an error either.
      const claims = verify(bearer);
      const scope = url.searchParams.get('scope') ?? 'global';
      if (claims) {
        for (const [token, session] of refreshTokens) {
          const own = session.sessionId === claims.session_id;
          if (session.sub === claims.sub && (scope === 'global' || (scope === 'local' && own) || (scope === 'others' && !own))) refreshTokens.delete(token);
        }
      }
      return send(204);
    }
    if (path === '/auth/v1/user/oauth/grants' && (req.method === 'GET' || req.method === 'DELETE')) {
      if (!verify(bearer)) return fail(401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature');
      return req.method === 'DELETE' ? send(204) : send(200, []);
    }
    return fail(404, 'not_implemented', 'The e2e auth stand-in does not model this endpoint.');
  };
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { // an aborted upload, for one: answer if still possible, never crash
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end();
    });
  });

  /** @type {number} */
  const bound = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port));
  });
  const shownHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  const resolvedPublicUrl = (publicUrl ?? `http://127.0.0.1:${bound}`).replace(/\/+$/, '');
  issuer = `${resolvedPublicUrl}/auth/v1`; // set before the event loop can deliver a request
  return {
    url: `http://${shownHost}:${bound}`,
    publicUrl: resolvedPublicUrl,
    close: () => new Promise((resolve) => {
      server.close(() => resolve(undefined));
      server.closeAllConnections();
    }),
  };
}

/** True when this file is the program node runs (also through a symlinked path). */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    assertStandInAllowed(process.env);
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exit(2);
  }
  const portText = process.env.E2E_AUTH_PORT ?? String(DEFAULT_PORT);
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || port > 65535) {
    console.error(`auth stand-in refused: E2E_AUTH_PORT must be a port number (0-65535), not "${portText.slice(0, 20)}"`);
    process.exit(2);
  }
  const host = process.env.E2E_AUTH_HOST || '127.0.0.1';
  startAuthStandIn({ host, port, publicUrl: process.env.E2E_AUTH_PUBLIC_URL || undefined }).then(({ url, publicUrl, close }) => {
    // The address it is bound to (0.0.0.0 inside its container), and the URL its tokens name.
    const bound = `http://${host.includes(':') ? `[${host}]` : host}:${new URL(url).port}`;
    console.log(`auth stand-in listening on ${bound} (public URL ${publicUrl})`);
    for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.on(signal, () => { close().then(() => process.exit(0)); });
  }, (error) => {
    console.error(`auth stand-in failed to start: ${error?.code ?? error?.message ?? error}`);
    process.exit(1);
  });
}
