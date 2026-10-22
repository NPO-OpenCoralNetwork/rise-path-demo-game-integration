/**
 * CORS for the app's own origins only, and a 2 MB JSON body limit (PLAN §6.4).
 *
 * - The API answered CORS for any origin (only the LLM gateway checked), so a page on any site
 *   could read the API's answers to its visitors' browsers and send it JSON requests.
 * - express.json accepted 50 MB bodies on every route; the largest real JSON (a curriculum draft)
 *   is far below 2 MB, and uploads are multipart, which this parser does not read.
 * - A body the parser refused got Express's HTML error page instead of JSON.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'LLM_ALLOWED_ORIGINS', 'DATABASE_URL_PHASE1', 'TRUST_PROXY',
    'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS'];

describe('API CORS and body limit', () => {
    const saved = {};
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.LLM_ALLOWED_ORIGINS = 'https://app.example';
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

    const withServer = async (handler) => {
        const app = await createApp({ serveStatic: false });
        const server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        try {
            await handler(`http://127.0.0.1:${server.address().port}`, server.address().port);
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    };

    const preflight = (base, origin, path) => fetch(`${base}${path}`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' },
    });

    const postJson = (base, path, body, contentType = 'application/json') => fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
    });

    it('answers CORS on every API route only for the app\'s own origins', async () => {
        await withServer(async (base) => {
            for (const path of ['/api/v2/tts/synthesize', '/api/v2/curricula', '/api/v2/health', '/api/v2/llm/tutor']) {
                const evil = await preflight(base, 'https://evil.example', path);
                assert.equal(evil.headers.get('access-control-allow-origin'), null, `${path} from another site`);
                const app = await preflight(base, 'https://app.example', path);
                assert.equal(app.headers.get('access-control-allow-origin'), 'https://app.example', `${path} from the app`);
            }
            const sameHost = await preflight(base, base, '/api/v2/curricula');
            assert.equal(sameHost.headers.get('access-control-allow-origin'), base, 'the page and the API on one host');
            const get = await fetch(`${base}/api/v2/health`, { headers: { Origin: 'https://evil.example' } });
            assert.equal(get.headers.get('access-control-allow-origin'), null, 'a simple GET too');
        });
    });

    it('ends a refused preflight at once: no auth, no rate limit', async () => {
        await withServer(async (base) => {
            const refused = await preflight(base, 'https://evil.example', '/api/v2/user/profile');
            assert.equal(refused.status, 204, 'not a 401 from the auth guard');
            assert.match(refused.headers.get('vary') ?? '', /Origin/);
            // /api/v2/ai/* sits behind the AI limiter (10 a minute in production).
            for (let i = 0; i < 12; i++) {
                const response = await preflight(base, 'https://evil.example', '/api/v2/ai/generation-kit');
                assert.equal(response.status, 204, `preflight ${i + 1}`);
            }
        });
    });

    it('behind a proxy (TRUST_PROXY=1) counts the forwarded host as the same host', async () => {
        process.env.TRUST_PROXY = '1';
        await withServer(async (base, port) => {
            const response = await new Promise((resolve, reject) => {
                const req = http.request({
                    host: '127.0.0.1',
                    port,
                    path: '/api/v2/curricula',
                    method: 'OPTIONS',
                    headers: {
                        Host: 'api.example',
                        'X-Forwarded-Host': 'app2.example',
                        Origin: 'https://app2.example',
                        'Access-Control-Request-Method': 'POST',
                    },
                }, (res) => {
                    res.resume();
                    res.on('end', () => resolve(res));
                });
                req.on('error', reject);
                req.end();
            });
            assert.equal(response.headers['access-control-allow-origin'], 'https://app2.example');
        });
    });

    it('answers JSON for a body it refuses: 413 over 2 MB, 400 malformed, 415 unsupported charset', async () => {
        await withServer(async (base) => {
            const big = await postJson(base, '/api/v2/tts/synthesize', JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024 + 10) }));
            assert.equal(big.status, 413);
            assert.deepEqual(await big.json(), { error: 'The request body is larger than 2 MB.', error_type: 'payload_too_large' });

            const broken = await postJson(base, '/api/v2/tts/synthesize', '{"text": ');
            assert.equal(broken.status, 400);
            assert.deepEqual(await broken.json(), { error: 'The request body is not valid JSON.', error_type: 'validation' });

            const latin1 = await postJson(base, '/api/v2/tts/synthesize', '{"text":"x"}', 'application/json; charset=latin1');
            assert.equal(latin1.status, 415);
            assert.equal((await latin1.json()).error_type, 'unsupported_media_type');
        });
    });

    it('still hands a large JSON body under the limit to the route', async () => {
        process.env.NODE_ENV = 'development'; // dev fallback user, so the request reaches the route
        await withServer(async (base) => {
            const response = await fetch(`${base}/api/v2/user/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: 'x'.repeat(1024 * 1024) }),
            });
            // The route ran: without a database it answers 503 'DB not configured'.
            assert.equal(response.status, 503);
            assert.equal((await response.json()).error, 'DB not configured');
        });
    });
});
