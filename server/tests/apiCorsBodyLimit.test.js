/**
 * CORS for the app's own origins only, and a 2 MB JSON body limit, on the real server.js stack
 * (PLAN §6.4.4).
 *
 * - CORS: every route answers only the origins of server/llm/guestAccess.js createOriginPolicy
 *   (LLM_ALLOWED_ORIGINS, the same host, local pages outside production). Only the LLM gateway
 *   did; the rest of the API answered any site with '*'. A refused preflight ends before auth and
 *   the rate limits.
 * - Body: the global JSON parser takes 2 MB (it took 50 MB); the last handler answers its
 *   refusals as JSON.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const APP = 'https://app.example';
const EVIL = 'https://evil.example';
const LIMIT_BYTES = 2 * 1024 * 1024;

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'LLM_ALLOWED_ORIGINS', 'LLM_GUEST_AI', 'DATABASE_URL_PHASE1',
    'TRUST_PROXY', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS'];

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    try {
        await handler(`http://127.0.0.1:${port}`, port);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
};

const preflight = (base, origin, path, method = 'POST') => fetch(`${base}${path}`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type' },
});

const post = (base, path, body, contentType = 'application/json') => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
});

/** A JSON body of exactly `bytes` bytes: {"message":"xx…"}. */
const jsonOfSize = (bytes) => JSON.stringify({ message: 'x'.repeat(bytes - JSON.stringify({ message: '' }).length) });

/** A preflight through a proxy that forwards the page's host (fetch cannot set Host). */
const forwardedPreflight = (port) => new Promise((resolve, reject) => {
    const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/api/v2/user/profile',
        method: 'OPTIONS',
        headers: {
            Host: 'api.example',
            'X-Forwarded-Host': 'app2.example',
            Origin: 'https://app2.example',
            'Access-Control-Request-Method': 'PUT',
        },
    }, (res) => {
        res.resume();
        res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
});

describe('API CORS and JSON body limit (server.js)', () => {
    const saved = {};
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.LLM_ALLOWED_ORIGINS = APP;
        resetPoolForTests();
        setPoolForTests(null);
    });
    afterEach(() => {
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it("answers CORS on every route only for the app's own origins", async () => {
        await withServer(async (base) => {
            for (const path of ['/api/v2/user/profile', '/api/v2/tts/synthesize', '/api/v2/ai/curriculum-drafts', '/api/v2/billing/plan', '/api/v2/llm/tutor']) {
                const refused = await preflight(base, EVIL, path);
                assert.equal(refused.status, 204, path);
                assert.equal(refused.headers.get('access-control-allow-origin'), null, `${path}: not for another site`);
                assert.match(refused.headers.get('vary') ?? '', /\bOrigin\b/, `${path}: Vary`);
                const allowed = await preflight(base, APP, path);
                assert.equal(allowed.status, 204, path);
                assert.equal(allowed.headers.get('access-control-allow-origin'), APP, `${path}: for the app`);
                const headers = (allowed.headers.get('access-control-allow-headers') ?? '').split(',');
                assert.ok(headers.includes('authorization') && headers.includes('content-type'), `${path}: ${headers}`);
            }
            const sameHost = await preflight(base, base, '/api/v2/user/profile');
            assert.equal(sameHost.headers.get('access-control-allow-origin'), base, 'the page and the API on one host');
            const devServer = await preflight(base, 'http://localhost:3007', '/api/v2/user/profile');
            assert.equal(devServer.headers.get('access-control-allow-origin'), null, 'no local pages in production');
            const opaque = await preflight(base, 'null', '/api/v2/user/profile');
            assert.equal(opaque.headers.get('access-control-allow-origin'), null, 'a sandboxed page or a file');

            // A simple request still runs (CORS is not access control), but another site cannot read the answer.
            for (const [origin, expected] of [[EVIL, null], [APP, APP], [undefined, null]]) {
                const response = await fetch(`${base}/api/v2/health`, { headers: origin ? { Origin: origin } : {} });
                assert.equal(typeof (await response.json()).ok, 'boolean', `GET from ${origin}: the route answered`);
                assert.equal(response.headers.get('access-control-allow-origin'), expected, `GET from ${origin}`);
                assert.match(response.headers.get('vary') ?? '', /\bOrigin\b/, `GET from ${origin}: Vary`);
            }
        });
    });

    it('in development also answers local pages, on every route', async () => {
        process.env.NODE_ENV = 'development';
        await withServer(async (base) => {
            const devServer = await preflight(base, 'http://localhost:3007', '/api/v2/user/profile', 'PUT');
            assert.equal(devServer.headers.get('access-control-allow-origin'), 'http://localhost:3007');
            const evil = await preflight(base, EVIL, '/api/v2/user/profile', 'PUT');
            assert.equal(evil.headers.get('access-control-allow-origin'), null);
        });
    });

    it('ends a refused preflight at once: no auth, no rate limit', async () => {
        await withServer(async (base) => {
            // /api/v2/ai/* is behind the AI limiter: 10 a minute in production.
            for (let i = 0; i < 12; i += 1) {
                const response = await preflight(base, EVIL, '/api/v2/ai/generation-kit');
                assert.equal(response.status, 204, `preflight ${i + 1}`);
                assert.equal(response.headers.get('ratelimit-limit'), null, `preflight ${i + 1}: no limiter`);
            }
            const refused = await preflight(base, EVIL, '/api/v2/user/profile', 'PUT');
            assert.equal(refused.status, 204, 'not the 401 of requireAuth');
            assert.equal(await refused.text(), '');
            // An OPTIONS without an Origin (not a browser's) ends at CORS too, with no origin allowed.
            const bare = await fetch(`${base}/api/v2/user/profile`, { method: 'OPTIONS' });
            assert.equal(bare.status, 204, 'not the 401 of requireAuth');
            assert.equal(bare.headers.get('access-control-allow-origin'), null);
        });
    });

    it('counts a forwarded host as the same host only behind a trusted proxy', async () => {
        process.env.TRUST_PROXY = '1';
        await withServer(async (base, port) => {
            assert.equal((await forwardedPreflight(port)).headers['access-control-allow-origin'], 'https://app2.example');
        });
        delete process.env.TRUST_PROXY;
        await withServer(async (base, port) => {
            assert.equal((await forwardedPreflight(port)).headers['access-control-allow-origin'], undefined, 'X-Forwarded-Host from anyone');
        });
    });

    it('takes a JSON body of up to 2 MB and refuses a larger one with JSON', async () => {
        await withServer(async (base) => {
            // The tutor validates its body before anything else that answers (server/routes/llm.js),
            // so its 400 shows that the body was parsed and reached the route.
            const atLimit = await post(base, '/api/v2/llm/tutor', jsonOfSize(LIMIT_BYTES));
            assert.equal(atLimit.status, 400);
            assert.equal((await atLimit.json()).error, 'Invalid request body', 'parsed and handed to the route');

            // The last handler answers the parser's refusals: JSON with the status's text.
            const over = await post(base, '/api/v2/llm/tutor', jsonOfSize(LIMIT_BYTES + 1));
            assert.equal(over.status, 413);
            assert.deepEqual(await over.json(), { error: 'Payload Too Large' });
            const latin1 = await post(base, '/api/v2/tts/synthesize', '{"text":"x"}', 'application/json; charset=latin1');
            assert.equal(latin1.status, 415);
            assert.deepEqual(await latin1.json(), { error: 'Unsupported Media Type' });
        });
    });
});
