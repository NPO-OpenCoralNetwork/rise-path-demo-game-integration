// @ts-check
// The Supabase Auth stand-in of the learner end-to-end checks (e2e/support/auth-stand-in.mjs; Phase 7,
// doc/brushup-2026/ai-access-plan.ja.md). The contract that supabase-js 2.89 (the browser) and the api
// (one GET /auth/v1/user per request, server/middleware/auth.js) rely on, checked with supabase-js
// itself and the api's own token checks (tools/core/oauthToken.js), on port 0; then the fences that keep
// it out of production. The import fence is in architectureBoundaries.test.js (npm run lint:arch), and
// scripts/ci/stack.sh auth is in ciScripts.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
    DEFAULT_PORT, STANDIN_PASSWORD, STANDIN_SWITCH, assertStandInAllowed, startAuthStandIn, userIdFor,
} from '../../e2e/support/auth-stand-in.mjs';
import { decodeTokenClaims, isOAuthClientToken, passwordAuthTime, sessionAuthTime } from '../../tools/core/oauthToken.js';
import { canonicalUserId } from '../../tools/core/accountDeletions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(ROOT, 'e2e/support/auth-stand-in.mjs');
const ALLOWED = { [STANDIN_SWITCH]: '1' };
const UUID_V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
/** A log line of the stand-in: method, path and status, and the grant name for /token. */
const LOG_LINE = /^(GET|POST|PUT|DELETE|OPTIONS) \/auth\/v1\/[a-z/]*(\?grant_type=[a-z_]+)? \d{3}$/;

/** A port nothing listens on right now. */
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const { port } = /** @type {net.AddressInfo} */ (server.address());
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    return port;
}

/** True when something accepts a connection on 127.0.0.1:<port>. @param {number} port */
function listening(port) {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
    });
}

/**
 * Starts a stand-in on a free port with its log lines collected; `run` gets it and the lines; it is
 * always closed afterwards.
 * @template T
 * @param {Partial<import('../../e2e/support/auth-stand-in.mjs').StandInOptions>} options
 * @param {(standIn: { url: string, publicUrl: string, lines: string[] }) => Promise<T>} run
 */
async function withStandIn(options, run) {
    /** @type {string[]} */
    const lines = [];
    const standIn = await startAuthStandIn({ port: 0, env: ALLOWED, log: (line) => lines.push(line), ...options });
    try {
        return await run({ url: standIn.url, publicUrl: standIn.publicUrl, lines });
    } finally {
        await standIn.close();
    }
}

/**
 * A supabase-js client as the browser makes it (services/supabaseClient.ts), with an in-memory storage
 * and every request's header names recorded.
 * @param {string} url
 */
function browserClient(url) {
    /** @type {Map<string, string>} */
    const memory = new Map();
    /** @type {Set<string>} */
    const headerNames = new Set();
    const storage = {
        getItem: (/** @type {string} */ key) => memory.get(key) ?? null,
        setItem: (/** @type {string} */ key, /** @type {string} */ value) => { memory.set(key, value); },
        removeItem: (/** @type {string} */ key) => { memory.delete(key); },
    };
    /** @type {typeof fetch} */
    const recordingFetch = (input, init) => {
        for (const name of new Headers(init?.headers).keys()) headerNames.add(name.toLowerCase());
        return fetch(input, init);
    };
    const client = createClient(url, 'ci-dummy-anon-key', {
        auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: recordingFetch },
    });
    return { client, memory, headerNames, storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token` };
}

/** The api's client (server/middleware/auth.js initSupabase): a service-role key, no session. @param {string} url */
const apiClient = (url) => createClient(url, 'ci-dummy-service-role-key', { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * One request to the stand-in; the JSON body (or null) with the status and headers.
 * @param {string} url @param {string} route @param {{ method?: string, token?: string, body?: unknown, headers?: Record<string, string> }} [options]
 */
async function call(url, route, { method = 'GET', token, body, headers = {} } = {}) {
    const res = await fetch(`${url}${route}`, {
        method,
        headers: { apikey: 'ci-dummy-anon-key', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

/** @param {string} url @param {string} email */
const signIn = (url, email) => call(url, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: STANDIN_PASSWORD } });

describe('e2e/support/auth-stand-in.mjs: the Supabase Auth contract of the learner checks', () => {
    it('refuses to start without RISEPATH_E2E_AUTH_STANDIN=1, under NODE_ENV=production, or on Vercel (exit 2, nothing listens)', async () => {
        const refusals = /** @type {[Record<string, string>, RegExp][]} */ ([
            [{}, /^auth stand-in refused: set RISEPATH_E2E_AUTH_STANDIN=1 \(end-to-end checks only\)$/],
            [{ [STANDIN_SWITCH]: '0' }, /set RISEPATH_E2E_AUTH_STANDIN=1/],
            [{ [STANDIN_SWITCH]: 'true' }, /set RISEPATH_E2E_AUTH_STANDIN=1/],
            [{ [STANDIN_SWITCH]: ' 1' }, /set RISEPATH_E2E_AUTH_STANDIN=1/],
            [{ [STANDIN_SWITCH]: '1', NODE_ENV: 'production' }, /^auth stand-in refused: NODE_ENV is production$/],
            [{ [STANDIN_SWITCH]: '1', VERCEL: '1' }, /^auth stand-in refused: this is a Vercel environment$/],
            [{ [STANDIN_SWITCH]: '1', VERCEL_ENV: 'preview' }, /^auth stand-in refused: this is a Vercel environment$/],
        ]);
        for (const [env, message] of refusals) {
            const port = await freePort();
            const run = spawnSync(process.execPath, [FILE], { env: { PATH: process.env.PATH, E2E_AUTH_PORT: String(port), ...env }, encoding: 'utf8', timeout: 15_000 });
            const what = JSON.stringify(env);
            assert.equal(run.signal, null, `${what}: it exits by itself (a listening server would run until killed)`);
            assert.equal(run.status, 2, `${what}: ${run.stdout}${run.stderr}`);
            assert.match(run.stderr.trim(), message, what);
            assert.equal(run.stdout, '', `${what}: no listening line`);
            assert.equal(await listening(port), false, `${what}: nothing listens on ${port}`);
            // The library refuses the same way, so no other entry point can start it either.
            assert.throws(() => assertStandInAllowed(env), { message }, what);
            await assert.rejects(startAuthStandIn({ port, env, log: () => {} }), { message }, what);
            assert.equal(await listening(port), false, `${what}: startAuthStandIn listened on ${port}`);
        }
        assert.doesNotThrow(() => assertStandInAllowed({ [STANDIN_SWITCH]: '1', NODE_ENV: 'test' }));
        const badPort = spawnSync(process.execPath, [FILE], { env: { PATH: process.env.PATH, ...ALLOWED, E2E_AUTH_PORT: '54390x' }, encoding: 'utf8', timeout: 15_000 });
        assert.equal(badPort.status, 2, badPort.stderr);
        assert.match(badPort.stderr, /E2E_AUTH_PORT must be a port number/);
    });

    it('the command line starts with the switch, also through a symlinked path, logs only its URL and request lines, and stops on SIGTERM', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-standin-'));
        /** @type {import('node:child_process').ChildProcess | undefined} */
        let child;
        try {
            const link = path.join(dir, 'auth-stand-in.mjs');
            fs.symlinkSync(FILE, link);
            const started = spawn(process.execPath, [link], { env: { PATH: process.env.PATH, ...ALLOWED, E2E_AUTH_PORT: '0', E2E_AUTH_PUBLIC_URL: 'http://127.0.0.1:54390' } });
            child = started;
            let out = '';
            let err = '';
            started.stderr.on('data', (chunk) => { err += chunk; });
            const url = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => { started.kill('SIGKILL'); reject(new Error(`no listening line: ${out}${err}`)); }, 15_000);
                started.stdout.on('data', (chunk) => {
                    out += chunk;
                    const m = /^auth stand-in listening on (http:\/\/127\.0\.0\.1:\d+) \(public URL http:\/\/127\.0\.0\.1:54390\)$/m.exec(out);
                    if (m) { clearTimeout(timer); resolve(m[1]); }
                });
                started.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code}: ${out}${err}`)); });
            });
            const signedIn = await signIn(url, 'e2e-cli@example.org');
            assert.equal(signedIn.status, 200);
            assert.equal(decodeTokenClaims(signedIn.json.access_token)?.iss, 'http://127.0.0.1:54390/auth/v1', 'iss is the public URL the browser uses');
            const exited = new Promise((resolve) => started.once('exit', (code, signal) => resolve({ code, signal })));
            started.kill('SIGTERM');
            assert.deepEqual(await exited, { code: 0, signal: null }, 'SIGTERM closes it cleanly');
            const lines = out.trim().split('\n');
            assert.equal(lines.length, 2, out);
            assert.match(lines[1], LOG_LINE);
            assert.equal(lines[1], 'POST /auth/v1/token?grant_type=password 200');
            assert.equal(err, '');
        } finally {
            // A failed assertion before the SIGTERM would leave it listening, and this file would never
            // exit (npm test would hang until the job's timeout instead of failing).
            if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('importing the module starts nothing', () => {
        const started = Date.now();
        const run = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(FILE).href)}); console.log('imported');`], {
            env: { PATH: process.env.PATH, ...ALLOWED, E2E_AUTH_PORT: '0' },
            encoding: 'utf8',
            timeout: 15_000,
        });
        assert.equal(run.signal, null, 'the process exits by itself: no server, no timer');
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout, 'imported\n');
        assert.ok(Date.now() - started < 5_000, 'within a few seconds');
    });

    it('a password sign-in returns the session supabase-js stores; a wrong password or another email is 400 invalid_credentials', async () => {
        await withStandIn({}, async ({ url }) => {
            const browser = browserClient(url);
            assert.equal(browser.storageKey, 'sb-127-auth-token');
            const wrong = await browser.client.auth.signInWithPassword({ email: 'e2e-signin@example.org', password: 'e2e-wrong-password' });
            assert.equal(wrong.error?.status, 400);
            assert.equal(wrong.error?.code, 'invalid_credentials');
            assert.equal(wrong.error?.message, 'Invalid login credentials');
            assert.equal(browser.memory.size, 0, 'nothing stored');

            const email = 'e2e-signin@example.org';
            const { data, error } = await browser.client.auth.signInWithPassword({ email, password: STANDIN_PASSWORD });
            assert.equal(error, null);
            assert.ok(data.session && data.user);
            for (const key of ['access_token', 'token_type', 'expires_in', 'expires_at', 'refresh_token', 'user']) assert.ok(key in data.session, `session.${key}`);
            assert.equal(data.session.token_type, 'bearer');
            assert.equal(data.session.expires_in, 3600);
            assert.equal(data.user.id, userIdFor(email));
            assert.equal(data.user.email, email);
            assert.equal(data.user.aud, 'authenticated');
            assert.equal(data.user.is_anonymous, false);
            assert.equal(data.user.identities?.length, 1, 'one identity: services/legalConsentApi.ts reads an empty list as "already registered"');
            const stored = JSON.parse(browser.memory.get(browser.storageKey) ?? 'null');
            assert.equal(stored?.access_token, data.session.access_token, 'supabase-js kept the session under sb-127-auth-token');
            assert.equal((await browser.client.auth.getSession()).data.session?.user.id, data.user.id);

            // Supabase lower-cases emails: the same learner.
            const upper = await signIn(url, 'E2E-SignIn@Example.org');
            assert.equal(upper.status, 200);
            assert.equal(upper.json.user.id, data.user.id);
            for (const other of ['someone@example.org', 'e2e-a@example.com', 'e2e-@example.org', 'e2e-a_b@example.org', `e2e-${'a'.repeat(61)}@example.org`, 'e2e-a@example.org.evil']) {
                const refused = await signIn(url, other);
                assert.equal(refused.status, 400, other);
                assert.deepEqual(refused.json, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, other);
            }
            const noPassword = await call(url, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email } });
            assert.equal(noPassword.status, 400);
        });
    });

    it('the access token passes the api\'s checks: aud authenticated, no client_id, a lower-case UUID sub, a password amr of now', async () => {
        await withStandIn({ publicUrl: 'http://127.0.0.1:54390' }, async ({ url }) => {
            const email = 'e2e-claims@example.org';
            const { json } = await signIn(url, email);
            const token = json.access_token;
            const claims = decodeTokenClaims(token);
            assert.ok(claims);
            const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
            assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
            assert.equal(isOAuthClientToken(token), false, 'server/middleware/auth.js would not refuse it as an OAuth client token');
            assert.equal(claims.aud, 'authenticated');
            assert.equal(claims.role, 'authenticated');
            assert.ok(!('client_id' in claims), 'no client_id (tools/core/oauthToken.js)');
            assert.equal(claims.sub, userIdFor(email));
            assert.match(String(claims.sub), UUID_V4_SHAPE);
            assert.equal(canonicalUserId(claims.sub), claims.sub, 'already canonical: the account lock key is the same');
            assert.equal(claims.iss, 'http://127.0.0.1:54390/auth/v1');
            assert.equal(claims.email, email);
            assert.equal(claims.is_anonymous, false);
            assert.equal(claims.aal, 'aal1');
            assert.match(String(claims.session_id), /^[0-9a-f-]{36}$/);
            assert.equal(Number(claims.exp) - Number(claims.iat), 3600);
            const password = passwordAuthTime(claims);
            assert.ok(password !== null && Math.abs(password - Date.now() / 1000) <= 5, `a password sign-in of now (server/routes/account.js re-auth): ${password}`);
            assert.equal(sessionAuthTime(claims), password, 'the session\'s sign-in time is that password sign-in');
            // The api's one call per request: getUser with the service-role client.
            const user = await apiClient(url).auth.getUser(token);
            assert.equal(user.error, null);
            assert.equal(user.data.user?.id, claims.sub);
            assert.equal(user.data.user?.email, email);
        });
        assert.equal(userIdFor('e2e-a@example.org'), userIdFor(' E2E-A@example.org '), 'one learner per email, whatever the case');
        assert.notEqual(userIdFor('e2e-a@example.org'), userIdFor('e2e-b@example.org'));
        assert.match(userIdFor('e2e-a@example.org'), UUID_V4_SHAPE);
    });

    it('GET /auth/v1/user answers its own tokens only: a changed payload, another instance\'s token, alg none, an expired token get 401 bad_jwt', async () => {
        let clock = Date.now();
        await withStandIn({ now: () => clock }, async ({ url }) => {
            const { json } = await signIn(url, 'e2e-verify@example.org');
            const token = String(json.access_token);
            const [header, payload, signature] = token.split('.');
            assert.equal((await call(url, '/auth/v1/user', { token })).status, 200);
            const other = Buffer.from(JSON.stringify({ ...decodeTokenClaims(token), sub: userIdFor('e2e-someone-else@example.org') })).toString('base64url');
            const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
            const foreign = await withStandIn({}, async (second) => String((await signIn(second.url, 'e2e-verify@example.org')).json.access_token));
            for (const [what, bad] of [
                ['a changed payload', `${header}.${other}.${signature}`],
                ['another instance\'s token (its own key)', foreign],
                ['alg none, no signature', `${none}.${payload}.`],
                ['alg none, the real signature', `${none}.${payload}.${signature}`],
                ['no signature', `${header}.${payload}.`],
                ['not a JWT', 'not-a-jwt'],
                ['no token', ''],
            ]) {
                const res = await call(url, '/auth/v1/user', { token: bad });
                assert.equal(res.status, 401, what);
                assert.equal(res.json?.error_code, 'bad_jwt', what);
                assert.equal((await apiClient(url).auth.getUser(bad || 'x')).data.user, null, `${what}: the api's getUser gets no user`);
            }
            clock += 3599_000;
            assert.equal((await call(url, '/auth/v1/user', { token })).status, 200, 'valid until exp');
            clock += 2_000;
            const expired = await call(url, '/auth/v1/user', { token });
            assert.equal(expired.status, 401, 'expired');
            assert.equal(expired.json?.error_code, 'bad_jwt');
        });
    });

    it('a refresh keeps amr and session_id; a refresh token works once', async () => {
        let clock = Date.now();
        await withStandIn({ now: () => clock }, async ({ url }) => {
            const browser = browserClient(url);
            const { data } = await browser.client.auth.signInWithPassword({ email: 'e2e-refresh@example.org', password: STANDIN_PASSWORD });
            assert.ok(data.session);
            const first = decodeTokenClaims(data.session.access_token);
            clock += 600_000;
            const refreshed = await browser.client.auth.refreshSession();
            assert.equal(refreshed.error, null);
            assert.ok(refreshed.data.session);
            const second = decodeTokenClaims(refreshed.data.session.access_token);
            assert.ok(first && second);
            assert.equal(Number(second.iat) - Number(first.iat), 600, 'a new token');
            assert.deepEqual(second.amr, first.amr, 'the sign-in time stays: the deletion re-auth and the account check read it');
            assert.equal(passwordAuthTime(second), passwordAuthTime(first));
            assert.equal(second.session_id, first.session_id);
            assert.notEqual(refreshed.data.session.refresh_token, data.session.refresh_token, 'a new refresh token');
            const again = await call(url, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: data.session.refresh_token } });
            assert.equal(again.status, 400, 'the first refresh token was used');
            assert.equal(again.json?.error_code, 'refresh_token_not_found');
            const next = await call(url, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshed.data.session.refresh_token } });
            assert.equal(next.status, 200, 'the new one works once');
            assert.equal(passwordAuthTime(decodeTokenClaims(next.json.access_token)), passwordAuthTime(first));
            const unknown = await call(url, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: 'e2e-unknown' } });
            assert.equal(unknown.status, 400);
        });
    });

    it('logout drops the refresh tokens of its scope (global by default, local, others); supabase-js signs out cleanly', async () => {
        await withStandIn({}, async ({ url }) => {
            const email = 'e2e-logout@example.org';
            const session = async () => /** @type {{ access_token: string, refresh_token: string }} */ ((await signIn(url, email)).json);
            const works = async (/** @type {{ refresh_token: string }} */ s) => (await call(url, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })).status === 200;
            const someoneElse = /** @type {{ refresh_token: string }} */ ((await signIn(url, 'e2e-logout-other@example.org')).json);

            let [a, b] = [await session(), await session()];
            assert.equal((await call(url, '/auth/v1/logout?scope=local', { method: 'POST', token: a.access_token })).status, 204);
            assert.deepEqual([await works(a), await works(b)], [false, true], 'local: this session only');

            [a, b] = [await session(), await session()];
            assert.equal((await call(url, '/auth/v1/logout?scope=others', { method: 'POST', token: a.access_token })).status, 204);
            assert.deepEqual([await works(a), await works(b)], [true, false], 'others: every other session');

            [a, b] = [await session(), await session()];
            assert.equal((await call(url, '/auth/v1/logout', { method: 'POST', token: a.access_token })).status, 204);
            assert.deepEqual([await works(a), await works(b)], [false, false], 'global: all of the learner\'s sessions');
            assert.equal(await works(someoneElse), true, 'another learner keeps theirs');
            assert.equal((await call(url, '/auth/v1/logout', { method: 'POST', token: 'not-a-jwt' })).status, 204, 'an unknown token changes nothing');

            const browser = browserClient(url);
            await browser.client.auth.signInWithPassword({ email, password: STANDIN_PASSWORD });
            assert.equal(browser.memory.size, 1);
            const out = await browser.client.auth.signOut();
            assert.equal(out.error, null);
            assert.equal(browser.memory.size, 0, 'supabase-js removed the session');
        });
    });

    it('CORS echoes the origin and allows the supabase-js headers; an endpoint it does not model is 404 not_implemented', async () => {
        await withStandIn({}, async ({ url }) => {
            const origin = 'http://127.0.0.1:4173';
            const preflight = await fetch(`${url}/auth/v1/token?grant_type=password`, {
                method: 'OPTIONS',
                headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'apikey,authorization,content-type,x-client-info,x-supabase-api-version' },
            });
            assert.equal(preflight.status, 204);
            assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
            assert.match(preflight.headers.get('vary') ?? '', /\bOrigin\b/);
            const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').split(',').map((h) => h.trim().toLowerCase());
            for (const name of ['apikey', 'authorization', 'content-type', 'x-client-info', 'x-supabase-api-version']) assert.ok(allowed.includes(name), `allows ${name}`);
            const methods = (preflight.headers.get('access-control-allow-methods') ?? '').split(',').map((m) => m.trim());
            for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.ok(methods.includes(method), `allows ${method}`);
            const answered = await signIn(url, 'e2e-cors@example.org').then(() => fetch(`${url}/auth/v1/health`, { headers: { origin } }));
            assert.equal(answered.headers.get('access-control-allow-origin'), origin, 'answers carry it too');

            // Every header supabase-js 2.89 sends on these calls is allowed (or CORS-safelisted).
            const browser = browserClient(url);
            await browser.client.auth.signInWithPassword({ email: 'e2e-cors@example.org', password: STANDIN_PASSWORD });
            await browser.client.auth.getUser();
            await browser.client.auth.oauth.listGrants();
            await browser.client.auth.refreshSession();
            await browser.client.auth.signOut();
            const unlisted = [...browser.headerNames].filter((name) => !allowed.includes(name) && !['accept', 'accept-language', 'content-language'].includes(name));
            assert.deepEqual(unlisted, [], 'a browser would block these');
            assert.ok(browser.headerNames.has('x-client-info') && browser.headerNames.has('apikey'), [...browser.headerNames].join(', '));

            for (const [method, route] of [['POST', '/auth/v1/signup'], ['GET', '/auth/v1/settings'], ['PUT', '/auth/v1/user'], ['GET', '/auth/v1/verify?token=x&type=signup'], ['POST', '/auth/v1/token?grant_type=pkce'], ['GET', '/rest/v1/profiles']]) {
                const res = await call(url, route, { method, body: method === 'GET' ? undefined : {} });
                assert.equal(res.status, 404, `${method} ${route}`);
                assert.deepEqual(res.json, { code: 404, error_code: 'not_implemented', msg: 'The e2e auth stand-in does not model this endpoint.' }, `${method} ${route}`);
            }
            const signUp = await browserClient(url).client.auth.signUp({ email: 'e2e-new@example.org', password: STANDIN_PASSWORD });
            assert.equal(signUp.error?.status, 404, 'supabase-js sees the 404 (the suite fails on a 404 from this origin)');
            assert.equal(signUp.error?.code, 'not_implemented');
            const token = String((await signIn(url, 'e2e-cors@example.org')).json.access_token);
            assert.deepEqual((await call(url, '/auth/v1/user/oauth/grants', { token })).json, [], 'connected apps: none');
            assert.equal((await call(url, '/auth/v1/user/oauth/grants?client_id=x', { method: 'DELETE', token })).status, 204);
            assert.equal((await call(url, '/auth/v1/user/oauth/grants')).status, 401, 'own token required');
            assert.equal((await call(url, '/auth/v1/token?grant_type=password', { method: 'POST', body: '{"email":' })).json?.error_code, 'bad_json');
            assert.equal((await call(url, '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(70_000) }) })).status, 413);
        });
    });

    it('logs method, path and status only: never a token, password or email', async () => {
        await withStandIn({}, async ({ url, lines }) => {
            const email = 'e2e-logs@example.org';
            const browser = browserClient(url);
            await browser.client.auth.signInWithPassword({ email, password: 'e2e-wrong-password' });
            const { data } = await browser.client.auth.signInWithPassword({ email, password: STANDIN_PASSWORD });
            assert.ok(data.session);
            const { access_token: access, refresh_token: refresh } = data.session;
            await browser.client.auth.getUser();
            await browser.client.auth.refreshSession();
            await call(url, `/auth/v1/verify?token=${refresh}&email=${email}`);
            await call(url, `/auth/v1/token?grant_type=${encodeURIComponent('password x')}`, { method: 'POST', body: { email, password: STANDIN_PASSWORD } });
            await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:4173' } });
            await browser.client.auth.signOut();
            assert.deepEqual(lines, [
                'POST /auth/v1/token?grant_type=password 400',
                'POST /auth/v1/token?grant_type=password 200',
                'GET /auth/v1/user 200',
                'POST /auth/v1/token?grant_type=refresh_token 200',
                'GET /auth/v1/verify 404',
                'POST /auth/v1/token 404',
                'OPTIONS /auth/v1/token?grant_type=password 204',
                'POST /auth/v1/logout 204',
            ]);
            const text = lines.join('\n');
            for (const secret of [access, access.split('.')[1], refresh, STANDIN_PASSWORD, 'e2e-wrong-password', email, 'e2e-logs', userIdFor(email)]) {
                assert.ok(!text.includes(secret), `the log holds ${secret.slice(0, 12)}…`);
            }
            for (const line of lines) assert.match(line, LOG_LINE);
        });
    });
});

/** The root files Vercel and Docker read. */
const ROOT_DEPLOY_FILES = ['vercel.json', 'docker-compose.yml', 'Dockerfile', '.dockerignore', '.vercelignore', '.env.example'];

/** True when `cwd` is inside a git work tree (false without git). @param {string} cwd */
const inGitCheckout = (cwd) => spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' }).stdout?.trim() === 'true';

/**
 * The files of `root` that the VM or Vercel loads, repo-relative and sorted: deploy/ without the CI-only
 * template folder and the READMEs, plus ROOT_DEPLOY_FILES. In a git checkout these are the tracked and
 * new (not ignored) files, so a change is checked before its commit and the ignored runtime files never
 * count: a CI stack's deploy/risepath-vm/stack.env (a copy of ci/stack.ci.env, there until `stack.sh
 * down`), tunnel.env, hermes-data/. Outside a checkout, a walk that skips the names each folder's
 * .gitignore lists.
 * @param {string} root
 * @returns {string[]}
 */
function deployedFiles(root) {
    const keep = (/** @type {string} */ file) => !file.startsWith('deploy/risepath-vm/ci/') && !file.endsWith('.md')
        && (file.startsWith('deploy/') || ROOT_DEPLOY_FILES.includes(file))
        && fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile() === true;
    if (inGitCheckout(root)) {
        const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'deploy', ...ROOT_DEPLOY_FILES], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        assert.equal(listed.status, 0, listed.stderr);
        return [...new Set(listed.stdout.split('\0').filter(Boolean))].filter(keep).sort();
    }
    /** @param {string} dir @returns {string[]} */
    const walk = (dir) => {
        const gitignore = path.join(root, dir, '.gitignore');
        const ignored = new Set(fs.existsSync(gitignore)
            ? fs.readFileSync(gitignore, 'utf8').split('\n').map((line) => line.trim().replace(/\/$/, '')).filter((line) => line && !line.startsWith('#'))
            : []);
        return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
            if (ignored.has(entry.name)) return [];
            const rel = `${dir}/${entry.name}`;
            return entry.isDirectory() ? walk(rel) : [rel];
        });
    };
    return [...(fs.existsSync(path.join(root, 'deploy')) ? walk('deploy') : []), ...ROOT_DEPLOY_FILES].filter(keep).sort();
}

/**
 * A small tree with a VM folder: tracked-style files, ignored runtime files that name the stand-in (as a
 * live CI stack.env does), the CI template folder and a README.
 * @param {string} dir
 */
function writeDeployTree(dir) {
    /** @type {Record<string, string>} */
    const tree = {
        'deploy/risepath-vm/.gitignore': 'stack.env\nhermes-data/\n',
        'deploy/risepath-vm/stack.env.example': 'SUPABASE_URL=https://your-project.supabase.co\n',
        'deploy/risepath-vm/stack.env': '# risepath-ci-env: CI only.\nSUPABASE_URL=http://auth-stand-in:54390\n',
        'deploy/risepath-vm/hermes-data/state.json': '{"url":"http://auth-stand-in:54390"}\n',
        'deploy/risepath-vm/ci/stack.ci.env': 'SUPABASE_URL=http://auth-stand-in:54390\n',
        'deploy/risepath-vm/README.md': 'The CI stack signs in through auth-stand-in:54390.\n',
        'deploy/vercel/env.production.example': 'VITE_SUPABASE_URL=https://your-project.supabase.co\n',
        'vercel.json': '{}\n',
        'package.json': '{}\n',
    };
    for (const [file, text] of Object.entries(tree)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), text);
    }
}

describe('the auth stand-in stays out of production', () => {
    it('the VM and Vercel file list skips ignored runtime files: outside a git checkout, by the folders\' .gitignore', (t) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-deploy-'));
        try {
            writeDeployTree(dir);
            if (inGitCheckout(dir)) { t.skip('the temp folder is inside a git checkout'); return; }
            assert.deepEqual(deployedFiles(dir), ['deploy/risepath-vm/.gitignore', 'deploy/risepath-vm/stack.env.example', 'deploy/vercel/env.production.example', 'vercel.json']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('the VM and Vercel file list skips ignored runtime files: in a git checkout, tracked and new files only', (t) => {
        if (spawnSync('git', ['--version']).status !== 0) { t.skip('no git'); return; }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-deploy-'));
        try {
            writeDeployTree(dir);
            fs.writeFileSync(path.join(dir, 'deploy/risepath-vm/gone.env.example'), 'X=1\n');
            const git = (/** @type {string[]} */ args) => {
                const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
                assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
            };
            git(['init', '-q']);
            git(['add', 'deploy/risepath-vm/.gitignore', 'deploy/risepath-vm/stack.env.example', 'deploy/risepath-vm/gone.env.example', 'vercel.json']);
            fs.rmSync(path.join(dir, 'deploy/risepath-vm/gone.env.example')); // tracked, deleted in the work tree
            assert.deepEqual(deployedFiles(dir), [
                'deploy/risepath-vm/.gitignore', 'deploy/risepath-vm/stack.env.example',
                'deploy/vercel/env.production.example', // new, not ignored: checked before its commit
                'vercel.json',
            ]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('RISEPATH_E2E_AUTH_STANDIN appears only in e2e/, scripts/ci/stack.sh, server/tests/ and the plan', (t) => {
        // Tracked and new (not ignored) files, so a change is checked before its commit.
        const grep = spawnSync('git', ['grep', '-l', '--untracked', '-I', '-F', STANDIN_SWITCH], { cwd: ROOT, encoding: 'utf8' });
        if (grep.error || grep.status === 128 || /not a git repository/.test(grep.stderr)) { t.skip('not a git checkout (or no git)'); return; }
        const files = grep.stdout.split('\n').filter(Boolean).sort();
        const allowed = (/** @type {string} */ file) => file.startsWith('e2e/') || file.startsWith('server/tests/')
            || file === 'scripts/ci/stack.sh' || file === 'doc/brushup-2026/ai-access-plan.ja.md';
        assert.deepEqual(files.filter((file) => !allowed(file)), [], 'only the stand-in, its starter, the tests and the plan name the switch');
        for (const must of ['e2e/support/auth-stand-in.mjs', 'scripts/ci/stack.sh']) assert.ok(files.includes(must), `git grep found ${must} (${files.join(', ')})`);
    });

    it('nothing the VM or Vercel loads names the stand-in or its port', () => {
        const port = String(DEFAULT_PORT);
        // deploy/ (env examples, compose files, Dockerfiles, systemd, scripts, SQL, Vercel) without the
        // CI-only template folder, the READMEs and the ignored runtime files; the root files Vercel and
        // Docker read.
        const files = deployedFiles(ROOT);
        for (const must of ['deploy/risepath-vm/stack.env.example', 'deploy/risepath-vm/docker-compose.yml', 'deploy/risepath-vm/systemd/risepath-stack.service', 'deploy/vercel/env.production.example', 'vercel.json']) {
            assert.ok(files.includes(must), `checks ${must}`);
        }
        const found = files.filter((file) => {
            const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
            return text.includes('auth-stand-in') || text.includes(port) || text.includes(STANDIN_SWITCH) || text.includes('e2e/support');
        });
        assert.deepEqual(found, [], `the stand-in (auth-stand-in, port ${port}) is CI-only: deploy/risepath-vm/ci/stack.ci.env names it, no production file does`);
    });
});
