// Supabase Auth that cannot answer is not a refusal of the learner's session. auth-js 2.89 does not
// throw when it cannot reach Supabase Auth or gets a 5xx: getUser resolves with { error }. The api
// guards (server/middleware/auth.js, bridgeAuth.js) answered 401 to every such error, which the app
// shows as 「ログインし直す」. Now they answer 503 auth_unavailable (optionalAuth flags the request:
// the AI gate answers 503 ai_access_unavailable), and so does the SSE MCP server
// (mcp-server/sseUserAuth.js). tools/core/authUnavailable.js decides which errors mean "cannot
// answer"; here it is checked against the installed auth-js: its error classes, and its fetch
// handling against a stand-in Supabase Auth server.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
    AuthApiError,
    AuthRetryableFetchError,
    AuthSessionMissingError,
    AuthUnknownError,
    createClient,
} from '@supabase/supabase-js';
import { createApp } from '../../server.js';
import { extractBearerToken, optionalAuth, requireAuth, setSupabaseForTests } from '../middleware/auth.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import { aiAccessGate } from '../middleware/aiAccessGate.js';
import { PHASE1_USER_ID, resetPoolForTests, setPoolForTests } from '../db.js';
import { readAccountState } from '../../tools/core/accountDeletions.js';
import { decodeTokenClaims, isOAuthClientToken, sessionAuthTime } from '../../tools/core/oauthToken.js';
import { createAccountDeletionPool } from './helpers/accountDeletionPool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEARNER = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const COURSE = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const BRIDGE_TOKEN = 'test-bridge-token-for-auth-unavailable';
const AUTH_UNAVAILABLE = { error: 'Sign-in cannot be checked right now. Please try again.', error_type: 'auth_unavailable' };
// Loaded inside the tests, so the other tests still run where the module does not exist yet.
const loadClassifier = () => import('../../tools/core/authUnavailable.js');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A learner session token as Supabase issues it (unsigned: the stand-in does not check it). */
const session = (sub = LEARNER) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
    sub,
    aud: 'authenticated',
    role: 'authenticated',
    iat: 1_790_000_000,
    exp: 4_000_000_000,
    amr: [{ method: 'password', timestamp: 1_790_000_000 }],
})}.c2ln`;

/**
 * What Supabase Auth answers to GET /auth/v1/user, as GoTrue does (JSON with `code`; the API version
 * header makes auth-js read it), and what a gateway or CDN in front of it answers while it is down.
 * reset: the connection is dropped.
 */
const ANSWERS = {
    user: [200, { id: LEARNER, aud: 'authenticated', role: 'authenticated' }],
    bad_jwt: [403, { code: 'bad_jwt', message: 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired' }],
    no_authorization: [401, { code: 'no_authorization', message: 'This endpoint requires a valid Bearer token' }],
    session_not_found: [403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' }],
    user_not_found: [404, { code: 'user_not_found', message: 'User from sub claim in JWT does not exist' }],
    unexpected_failure: [500, { code: 'unexpected_failure', message: 'Unexpected failure, please check server logs for more information' }],
    over_request_rate_limit: [429, { code: 'over_request_rate_limit', message: 'Request rate limit reached' }],
    bad_gateway: [502, 'Bad Gateway'],
    service_unavailable: [503, 'Service Unavailable'],
    gateway_timeout: [504, 'Gateway Timeout'],
    cdn_error_page: [522, '<!DOCTYPE html><html><body>Connection timed out</body></html>'],
    reset: null,
};
const REFUSALS = ['bad_jwt', 'no_authorization', 'session_not_found', 'user_not_found'];
const CANNOT_ANSWER = ['unexpected_failure', 'over_request_rate_limit', 'bad_gateway', 'service_unavailable', 'gateway_timeout', 'cdn_error_page', 'reset'];

/** A stand-in Supabase Auth server; `answer` names the reply (ANSWERS) to every request. */
async function startAuthStandIn() {
    const standIn = { answer: 'user', requests: 0, url: '', close: async () => {} };
    const server = http.createServer((req, res) => {
        standIn.requests += 1;
        const reply = ANSWERS[standIn.answer];
        if (!reply) {
            req.socket.destroy();
            return;
        }
        const [status, body] = reply;
        if (typeof body === 'string') {
            res.writeHead(status, { 'Content-Type': body.startsWith('<') ? 'text/html' : 'text/plain' });
            res.end(body);
        } else {
            res.writeHead(status, { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' });
            res.end(JSON.stringify(body));
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    standIn.url = `http://127.0.0.1:${server.address().port}`;
    standIn.close = () => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });
    return standIn;
}

/** A port nothing listens on. */
const freePort = () => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = /** @type {net.AddressInfo} */ (probe.address());
        probe.close(() => resolve(port));
    });
});

/** The api's Supabase client (server/middleware/auth.js initSupabase), without a stored session. */
const supabaseAt = (url) => createClient(url, 'test-service-role-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const accountReads = (pool) => pool.state.queries.filter((q) => q.sql.startsWith('select deleted_at, reopened_at from account_deletions')).length;
const stubInserts = (pool) => pool.state.queries.filter((q) => q.sql.startsWith('insert into auth.users')).length;

const listen = async (app, handler) => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        await handler(async (urlPath, { token, method = 'GET', body } = {}) => {
            const response = await fetch(`${base}${urlPath}`, {
                method,
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            const text = await response.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* not JSON */ }
            return { status: response.status, json };
        });
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

/** The three guards, each on its own path; optionalAuth as the LLM gateway mounts it (then the AI gate). */
const guardsApp = () => {
    const app = express();
    const answer = (req, res) => res.json({ userId: req.userId ?? null, authMethod: req.authMethod });
    app.get('/required', requireAuth, answer);
    app.get('/bridge', requireBridgeOrAuth, answer);
    app.get('/gated', optionalAuth, aiAccessGate(), answer);
    return app;
};

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'TRUST_PROXY',
    'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'HERMES_API_KEY', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI', 'LEGAL_TERMS_REQUIRED'];

/** Production, with the bridge token set; auth-js and the guards log to the console, which is muted. */
const useProduction = () => {
    const saved = {};
    let warn;
    let error;
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        warn = console.warn;
        error = console.error;
        console.warn = () => {};
        console.error = () => {};
    });
    afterEach(() => {
        console.warn = warn;
        console.error = error;
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });
};

describe('tools/core/authUnavailable.js: which getUser errors mean that Supabase Auth could not answer', () => {
    it('no connection, a 502-504, any other 5xx, a 429, and an error page that is not JSON', async () => {
        const { isAuthUnavailable } = await loadClassifier();
        for (const error of [
            new AuthRetryableFetchError('fetch failed', 0),
            new AuthRetryableFetchError('Bad Gateway', 502),
            new AuthRetryableFetchError('Service Unavailable', 503),
            new AuthRetryableFetchError('Gateway Timeout', 504),
            new AuthApiError('Unexpected failure', 500, 'unexpected_failure'),
            new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'),
            new AuthUnknownError('Unexpected token < in JSON at position 0', new SyntaxError('Unexpected token <')),
        ]) {
            assert.equal(isAuthUnavailable(error), true, `${error.name} ${error.status}`);
        }
    });

    it('not a refusal of the token (4xx answers, a session that no longer exists), nor anything else', async () => {
        const { isAuthUnavailable } = await loadClassifier();
        for (const error of [
            new AuthApiError('invalid JWT', 403, 'bad_jwt'),
            new AuthApiError('This endpoint requires a valid Bearer token', 401, 'no_authorization'),
            new AuthApiError('User from sub claim in JWT does not exist', 404, 'user_not_found'),
            new AuthSessionMissingError(),
            { message: 'invalid JWT' },
            new Error('fetch failed'),
            null,
            undefined,
            'AuthRetryableFetchError',
            503,
        ]) {
            assert.equal(isAuthUnavailable(error), false, String(error?.name ?? error));
        }
    });
});

describe('the installed auth-js against a stand-in Supabase Auth, through the guards (production)', () => {
    useProduction();
    let standIn;
    before(async () => { standIn = await startAuthStandIn(); });
    after(async () => { await standIn?.close(); });

    it('a token Supabase Auth refuses stays "not signed in" at every guard: 401', async () => {
        setPoolForTests(createAccountDeletionPool());
        setSupabaseForTests(supabaseAt(standIn.url));
        await listen(guardsApp(), async (request) => {
            for (const answer of REFUSALS) {
                standIn.answer = answer;
                const required = await request('/required', { token: session() });
                assert.equal(required.status, 401, answer);
                assert.deepEqual(required.json, { error: 'Invalid or expired token' }, answer);
                assert.equal((await request('/bridge', { token: session() })).status, 401, answer);
                const gated = await request('/gated', { token: session() });
                assert.equal(gated.status, 401, answer);
                assert.equal(gated.json?.error_type, 'sign_in_required', answer);
            }
        });
    });

    it('Supabase Auth that cannot answer is 503 at every guard (ai_access_unavailable at the AI gate), with no account read and no stub write', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        setSupabaseForTests(supabaseAt(standIn.url));
        await listen(guardsApp(), async (request) => {
            for (const answer of CANNOT_ANSWER) {
                standIn.answer = answer;
                const required = await request('/required', { token: session() });
                assert.equal(required.status, 503, answer);
                assert.deepEqual(required.json, AUTH_UNAVAILABLE, answer);
                const bridge = await request('/bridge', { token: session() });
                assert.equal(bridge.status, 503, answer);
                assert.deepEqual(bridge.json, AUTH_UNAVAILABLE, answer);
                const gated = await request('/gated', { token: session() });
                assert.equal(gated.status, 503, answer);
                assert.equal(gated.json?.error_type, 'ai_access_unavailable', answer);
            }
        });
        assert.equal(accountReads(pool), 0);
        assert.equal(stubInserts(pool), 0);
    });

    it('nothing listens at SUPABASE_URL: 503; and a learner Supabase Auth names gets through', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        setSupabaseForTests(supabaseAt(`http://127.0.0.1:${await freePort()}`));
        await listen(guardsApp(), async (request) => {
            const required = await request('/required', { token: session() });
            assert.equal(required.status, 503);
            assert.deepEqual(required.json, AUTH_UNAVAILABLE);
            assert.equal((await request('/bridge', { token: session() })).status, 503);
            assert.equal(stubInserts(pool), 0);

            setSupabaseForTests(supabaseAt(standIn.url));
            standIn.answer = 'user';
            const through = await request('/required', { token: session() });
            assert.equal(through.status, 200);
            assert.deepEqual(through.json, { userId: LEARNER, authMethod: 'supabase-jwt' });
            assert.equal(stubInserts(pool), 1);
        });
    });
});

describe('the api while Supabase Auth is down (production)', () => {
    useProduction();

    it('the library, a course, its resume card, lesson records and the voice probe answer 503 auth_unavailable to a signed-in learner; the AI tutor 503 ai_access_unavailable', async () => {
        const pool = createAccountDeletionPool();
        setPoolForTests(pool);
        setSupabaseForTests(supabaseAt(`http://127.0.0.1:${await freePort()}`));
        await listen(await createApp({ serveStatic: false }), async (request) => {
            for (const [method, urlPath, body] of [
                ['GET', '/api/v2/curricula'],
                ['GET', `/api/v2/curricula/${COURSE}`],
                ['GET', `/api/v2/curricula/${COURSE}/resume`],
                ['GET', '/api/v2/user/lesson-progress'],
                ['PUT', '/api/v2/user/lesson-progress', { epoch: null, records: [] }],
                ['GET', '/api/v2/tts/health'],
            ]) {
                const response = await request(urlPath, { method, token: session(), body });
                assert.equal(response.status, 503, `${method} ${urlPath}: ${JSON.stringify(response.json)}`);
                assert.deepEqual(response.json, AUTH_UNAVAILABLE, `${method} ${urlPath}`);
            }
            const tutor = await request('/api/v2/llm/tutor', {
                method: 'POST',
                token: session(),
                body: {
                    message: 'これは何？',
                    lesson: { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] },
                    anchor: { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書く。' },
                },
            });
            assert.equal(tutor.status, 503, JSON.stringify(tutor.json));
            assert.equal(tutor.json?.error_type, 'ai_access_unavailable');
        });
        assert.equal(accountReads(pool), 0);
        assert.equal(stubInserts(pool), 0);
    });
});

describe('mcp-server/sseUserAuth.js: a session that could not be checked', () => {
    const resolverWith = async (getUser, dev) => {
        const { createSseUserResolver } = await import('../../mcp-server/sseUserAuth.js');
        return createSseUserResolver({
            getSupabase: () => ({ auth: { getUser } }),
            getPool: () => null,
            readAccountState,
            decodeTokenClaims,
            sessionAuthTime,
            isOAuthClientToken,
            extractBearerToken,
            bridgeToken: () => BRIDGE_TOKEN,
            allowDevFallback: () => dev,
            phase1UserId: PHASE1_USER_ID,
            logger: { error: () => {} },
        });
    };
    const learner = () => ({ headers: { authorization: `Bearer ${session()}` } });

    it('Supabase Auth that cannot answer: null, marked so the caller answers 503, never the dev user', async () => {
        const { sessionCheckUnavailable } = await import('../../mcp-server/sseUserAuth.js');
        const unavailable = async () => ({ data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) });
        for (const dev of [false, true]) {
            const req = learner();
            assert.equal(await (await resolverWith(unavailable, dev))(req), null, `dev ${dev}`);
            assert.equal(req.authMethod, 'auth-unavailable');
            assert.equal(sessionCheckUnavailable(req), true);
        }
    });

    it('a token Supabase Auth refuses: as before (null and 401 in production, the dev user in development)', async () => {
        const { sessionCheckUnavailable } = await import('../../mcp-server/sseUserAuth.js');
        const refuse = async () => ({ data: { user: null }, error: new AuthApiError('invalid JWT', 403, 'bad_jwt') });
        const req = learner();
        assert.equal(await (await resolverWith(refuse, false))(req), null);
        assert.equal(sessionCheckUnavailable(req), false);
        assert.equal(await (await resolverWith(refuse, true))(learner()), PHASE1_USER_ID);
    });

    it('sessionCheckUnavailable: only a session whose check could not run (Supabase Auth, or the account check)', async () => {
        const { sessionCheckUnavailable } = await import('../../mcp-server/sseUserAuth.js');
        for (const authMethod of ['auth-unavailable', 'account-check-failed']) {
            assert.equal(sessionCheckUnavailable({ headers: {}, authMethod }), true, authMethod);
        }
        for (const authMethod of [undefined, 'account-deleted', 'oauth-client-refused', 'supabase-jwt', 'dev-fallback']) {
            assert.equal(sessionCheckUnavailable({ headers: {}, authMethod }), false, String(authMethod));
        }
    });
});

/** Spawn the MCP server with --sse on a free port; resolves once it listens. */
async function startSseServer(env) {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp-server/index.js'), '--sse', String(port)], {
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'production',
            RISE_PATH_MCP_PROFILE: 'learner',
            DATABASE_URL_PHASE1: '',
            RISE_PATH_ACTIVE_SESSION_KEY: '',
            HERMES_ACTIVE_SESSION_KEY: '',
            X_HERMES_SESSION_KEY: '',
            VITE_SUPABASE_URL: '',
            SUPABASE_ANON_KEY: '',
            VITE_SUPABASE_ANON_KEY: '',
            ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`SSE server did not start:\n${stderr}`)), 15000);
        child.stdout.on('data', (chunk) => {
            if (String(chunk).includes('running on')) { clearTimeout(timer); resolve(undefined); }
        });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`SSE server exited ${code}:\n${stderr}`)); });
    });
    return { child, base: `http://127.0.0.1:${port}` };
}

describe('MCP server (SSE, production) while Supabase Auth is down', () => {
    let standIn;
    let server;
    before(async () => {
        standIn = await startAuthStandIn();
        server = await startSseServer({
            SUPABASE_URL: standIn.url,
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            RISE_PATH_BRIDGE_TOKEN: BRIDGE_TOKEN,
            // Nothing listens there: the account check of a learner Supabase Auth names fails.
            DATABASE_URL_PHASE1: `postgresql://rp_user:rp_pass@127.0.0.1:${await freePort()}/rp_test`,
        });
    });
    after(async () => {
        server?.child.kill();
        await standIn?.close();
    });

    const open = (token) => fetch(`${server.base}/sse`, { headers: { Authorization: `Bearer ${token}` } });

    it('GET /sse with a learner token: 503 auth_unavailable while Supabase Auth cannot answer, 401 when it refuses the token', async () => {
        for (const answer of ['reset', 'service_unavailable', 'unexpected_failure']) {
            standIn.answer = answer;
            const response = await open(session());
            assert.equal(response.status, 503, answer);
            assert.deepEqual(await response.json(), AUTH_UNAVAILABLE, answer);
        }
        standIn.answer = 'bad_jwt';
        const refused = await open(session());
        assert.equal(refused.status, 401);
        assert.deepEqual(await refused.json(), { error: 'Authentication required' });
    });

    it('GET /sse with a learner token whose account check cannot reach the database: 503 auth_unavailable, as the app API answers', async () => {
        standIn.answer = 'user';
        const response = await open(session());
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), AUTH_UNAVAILABLE);
    });

    it('POST /messages/:id with a learner token: 503 auth_unavailable while Supabase Auth cannot answer, 401 when it refuses the token', async () => {
        // A session to post to: the bridge's (its token never asks Supabase).
        const controller = new AbortController();
        const stream = await fetch(`${server.base}/sse`, { headers: { 'x-nexloom-bridge-token': BRIDGE_TOKEN }, signal: controller.signal });
        assert.equal(stream.status, 200);
        const reader = stream.body.getReader();
        const decoder = new TextDecoder();
        let events = '';
        while (!/event: endpoint\ndata: \S+\n/.test(events)) {
            const { value, done } = await reader.read();
            if (done) break;
            events += decoder.decode(value, { stream: true });
        }
        const messages = /event: endpoint\ndata: (\S+)\n/.exec(events)?.[1];
        assert.ok(messages?.startsWith('/messages/'), events);
        const post = () => fetch(`${server.base}${messages}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        });
        try {
            standIn.answer = 'reset';
            const unavailable = await post();
            assert.equal(unavailable.status, 503);
            assert.deepEqual(await unavailable.json(), AUTH_UNAVAILABLE);
            standIn.answer = 'bad_jwt';
            const refused = await post();
            assert.equal(refused.status, 401);
            assert.deepEqual(await refused.json(), { error: 'Authentication required' });
        } finally {
            controller.abort();
        }
    });
});
