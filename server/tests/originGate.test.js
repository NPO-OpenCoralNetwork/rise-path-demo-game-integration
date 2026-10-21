import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../../server.js';
import { ORIGIN_SECRET_HEADER, createOriginGate, readOriginSecrets } from '../middleware/originGate.js';
import { resetGatewayForTests } from '../llm/index.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const SECRET = 'test-origin-secret-current-0123456789abcdef';
const PREVIOUS = 'test-origin-secret-previous-0123456789abcdef';
const LESSON = { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] };
const ANCHOR = { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書くと伝わりやすい。' };
const quietLogger = { warn: () => {} };

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK', 'LLM_MOCK_DELAY_MS', 'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'LLM_ALLOWED_ORIGINS', 'LLM_GUEST_DAILY_PER_IP', 'LLM_GUEST_DAILY_TOTAL', 'TRUST_PROXY', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS'];

/** Listens on 127.0.0.1; tests that need the gate to see a non-loopback caller turn the exemption off. */
const listen = async (app, handler) => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(server.address().port);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

/** The real server.js stack, without static files. */
const withApp = async (originGate, handler) => {
    const app = await createApp({ serveStatic: false, originGate });
    await listen(app, (port) => handler(`http://127.0.0.1:${port}`));
};

/** node:http, not fetch: fetch normalizes %2e%2e and '..' before sending. */
const rawGet = (port, rawPath, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: rawPath, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
});

const saved = {};
const saveEnv = () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'development';
    process.env.LLM_MOCK_DELAY_MS = '0';
    resetGatewayForTests();
    resetPoolForTests();
    setPoolForTests(null);
};
const restoreEnv = () => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    resetGatewayForTests();
    resetPoolForTests();
};

describe('readOriginSecrets', () => {
    const refuses = (env, name, value) => assert.throws(() => readOriginSecrets(env), (error) => {
        assert.ok(error.message.includes(name), `names ${name}: ${error.message}`);
        assert.ok(!error.message.includes(value), 'does not echo the value');
        return true;
    });

    it('is off when ORIGIN_SECRET is unset, and the gate then passes every request through', () => {
        assert.deepEqual(readOriginSecrets({}), []);
        assert.deepEqual(readOriginSecrets({ ORIGIN_SECRET: '  ' }), []);
        const gate = createOriginGate({ env: {} });
        assert.equal(gate.enabled, false);
        let passed = false;
        gate({ headers: {}, socket: { remoteAddress: '203.0.113.9' } }, {}, () => { passed = true; });
        assert.equal(passed, true);
    });

    it('refuses short, $-prefixed and change-me values without echoing them', () => {
        refuses({ ORIGIN_SECRET: 'too-short-origin-value' }, 'ORIGIN_SECRET', 'too-short-origin-value');
        const unexpanded = '${ORIGIN_SECRET_FROM_THE_SHELL_NOT_EXPANDED}';
        refuses({ ORIGIN_SECRET: unexpanded }, 'ORIGIN_SECRET', unexpanded);
        const placeholder = 'please-CHANGE-ME-before-the-first-deploy';
        refuses({ ORIGIN_SECRET: placeholder }, 'ORIGIN_SECRET', placeholder);
        refuses({ ORIGIN_SECRET: SECRET, ORIGIN_SECRET_PREVIOUS: 'short-previous' }, 'ORIGIN_SECRET_PREVIOUS', 'short-previous');
    });

    it('refuses ORIGIN_SECRET_PREVIOUS without ORIGIN_SECRET', () => {
        refuses({ ORIGIN_SECRET_PREVIOUS: PREVIOUS }, 'ORIGIN_SECRET_PREVIOUS', PREVIOUS);
    });

    it('returns one SHA-256 digest per accepted value', () => {
        const digests = readOriginSecrets({ ORIGIN_SECRET: ` ${SECRET} `, ORIGIN_SECRET_PREVIOUS: PREVIOUS });
        assert.equal(digests.length, 2);
        assert.ok(digests.every((digest) => digest.length === 32));
    });
});

describe('origin gate in the server.js stack', () => {
    beforeEach(saveEnv);
    afterEach(restoreEnv);

    it('answers 403 without the current or previous secret, 200 with either', async () => {
        process.env.ORIGIN_SECRET = SECRET;
        process.env.ORIGIN_SECRET_PREVIOUS = PREVIOUS;
        const lines = [];
        const logger = { warn: (line) => lines.push(String(line)) };
        await withApp({ exemptLoopback: false, logger }, async (base) => {
            const status = (headers) => fetch(`${base}/api/v2/llm/status`, { headers });
            const none = await status({});
            assert.equal(none.status, 403);
            assert.deepEqual(await none.json(), { error: 'forbidden' });
            assert.equal(none.headers.get('cache-control'), 'no-store');
            assert.equal((await status({ [ORIGIN_SECRET_HEADER]: 'wrong-origin-secret-value-0123456789' })).status, 403);
            assert.equal((await status({ [ORIGIN_SECRET_HEADER]: '$ORIGIN_SECRET' })).status, 403);
            assert.equal((await status({ [ORIGIN_SECRET_HEADER]: SECRET })).status, 200);
            assert.equal((await status({ [ORIGIN_SECRET_HEADER]: PREVIOUS })).status, 200);
        });
        assert.equal(lines.length, 1, 'at most one refusal line per minute');
        assert.match(lines[0], /refused 1 request/);
        assert.ok(!lines[0].includes('wrong-origin'), 'the log holds no header value');
    });

    it('refuses a 60 MB body without the secret with 403 before the JSON parser (not 413)', async () => {
        process.env.ORIGIN_SECRET = SECRET;
        await withApp({ exemptLoopback: false, logger: quietLogger }, async (base) => {
            const body = `{"message":"${'x'.repeat(60 * 1024 * 1024)}"}`;
            const response = await fetch(`${base}/api/v2/llm/tutor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            assert.equal(response.status, 403);
        });
    });

    it('keys the guest budget on the first X-Forwarded-For entry of an edge request', async () => {
        process.env.ORIGIN_SECRET = SECRET;
        process.env.TRUST_PROXY = '1';
        process.env.LLM_GUEST_DAILY_PER_IP = '1';
        await withApp({ exemptLoopback: false, logger: quietLogger }, async (base) => {
            const ask = (forwardedFor) => fetch(`${base}/api/v2/llm/tutor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', [ORIGIN_SECRET_HEADER]: SECRET, 'X-Forwarded-For': forwardedFor },
                body: JSON.stringify({ message: 'ok', lesson: LESSON, anchor: ANCHOR }),
            });
            const first = await ask('203.0.113.10, 198.51.100.7');
            assert.equal(first.status, 200);
            await first.text();
            const other = await ask('203.0.113.11, 198.51.100.7');
            assert.equal(other.status, 200, 'another visitor behind the same Vercel hop has its own budget');
            await other.text();
            const again = await ask('203.0.113.10, 198.51.100.7');
            assert.equal(again.status, 429);
            assert.equal((await again.json()).error_type, 'rate_limited');
        });
    });

    it('exempts loopback callers by default', async () => {
        process.env.ORIGIN_SECRET = SECRET;
        await withApp(undefined, async (base) => {
            assert.equal((await fetch(`${base}/api/v2/llm/status`)).status, 200);
        });
    });

    it('sends nosniff, no x-powered-by, and no-store on /api/ responses', async () => {
        await withApp(undefined, async (base) => {
            const status = await fetch(`${base}/api/v2/llm/status`);
            assert.equal(status.status, 200);
            assert.equal(status.headers.get('x-powered-by'), null);
            assert.equal(status.headers.get('x-content-type-options'), 'nosniff');
            const portals = await fetch(`${base}/api/learning-portals`);
            assert.equal(portals.status, 200);
            assert.equal(portals.headers.get('cache-control'), 'no-store');
            assert.equal(portals.headers.get('x-content-type-options'), 'nosniff');
        });
    });
});

describe('origin gate edge path allowlist', () => {
    let dir;
    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-gate-'));
        fs.mkdirSync(path.join(dir, 'uploads'));
        fs.writeFileSync(path.join(dir, 'uploads', 'x.html'), '<p>uploaded</p>');
    });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const buildApp = ({ gate = true } = {}) => {
        const app = express();
        if (gate) app.use(createOriginGate({ env: { ORIGIN_SECRET: SECRET }, exemptLoopback: false, logger: quietLogger }));
        app.get('/api/echo', (req, res) => res.json({ hasSecret: ORIGIN_SECRET_HEADER in req.headers, gate: req.originGate }));
        app.use(express.static(dir));
        return app;
    };
    const withSecret = { [ORIGIN_SECRET_HEADER]: SECRET };

    it('answers 404 for traversal and for paths the edge does not proxy', async () => {
        await listen(buildApp(), async (port) => {
            for (const rawPath of ['/api/..%2fuploads/x.html', '/api/%2e%2e/uploads/x.html', '/api/%2E%2E/uploads/x.html', '/api/../uploads/x.html', '/api/a%5c..%5cuploads/x.html', '/uploads/x.html', '/']) {
                const response = await rawGet(port, rawPath, withSecret);
                assert.equal(response.status, 404, rawPath);
                assert.deepEqual(JSON.parse(response.body), { error: 'not_found' }, rawPath);
            }
            const audio = await rawGet(port, `/audio/cache/${'a'.repeat(64)}.mp3`, withSecret);
            assert.equal(audio.status, 404, 'allowed through the gate; express.static has no such file');
            assert.notEqual(audio.body, JSON.stringify({ error: 'not_found' }));
        });
    });

    it('is what stops the traversal: without the gate the same request reads the file', async () => {
        await listen(buildApp({ gate: false }), async (port) => {
            const response = await rawGet(port, '/api/..%2fuploads/x.html');
            assert.equal(response.status, 200);
            assert.match(response.body, /uploaded/);
        });
    });

    it('removes the secret header before the route handlers run', async () => {
        await listen(buildApp(), async (port) => {
            const response = await rawGet(port, '/api/echo', withSecret);
            assert.equal(response.status, 200);
            assert.deepEqual(JSON.parse(response.body), { hasSecret: false, gate: 'edge' });
        });
    });
});
