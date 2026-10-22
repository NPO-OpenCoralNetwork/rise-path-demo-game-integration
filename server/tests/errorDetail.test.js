/**
 * Failed requests do not hand error text to clients in production (PLAN §6.4).
 *
 * The content, curriculum, TTS and learner-memory routes answered with the driver's or the
 * service's message (SQL, column names, file paths, internal addresses, ffmpeg output), the
 * adaptation route relayed classifyDbError's text, the jobs route the worker's exception text,
 * and the agent routes Hermes' error body (a provider's billing or rate-limit text). errorDetail
 * keeps that text for development; production answers carry only the route's own words, and the
 * text goes to the log where the error is handled.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { errorDetail } from '../errorDetail.js';
import ttsRoutes from '../routes/tts.js';
import contentRoutes from '../routes/content.js';
import chatgptCurriculumRoutes from '../routes/chatgptCurriculum.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1',
    'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY'];
const BRIDGE = 'test-bridge-token-0123456789';

const saved = {};
const isolateEnv = () => {
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
    });
    afterEach(() => {
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });
};

/** Runs `app` on a free port for `handler(base)`. */
const serve = async (app, handler) => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    try {
        return await handler(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
};

/** A bare app with one router and no auth in front, so a production-mode request reaches the route. */
const bareApp = (router, { userId } = {}) => {
    const app = express();
    app.use(express.json());
    if (userId) app.use((req, res, next) => { req.userId = userId; next(); });
    app.use('/api/v2', router);
    return app;
};

describe('errorDetail', () => {
    isolateEnv();

    it('gives the text while developing: errors, text and objects', () => {
        process.env.NODE_ENV = 'development';
        assert.deepEqual(errorDetail(new Error('relation "x" does not exist')), { detail: 'relation "x" does not exist' });
        assert.deepEqual(errorDetail('Hermes: insufficient credits'), { detail: 'Hermes: insufficient credits' });
        assert.deepEqual(errorDetail({ detail: [{ msg: 'field required' }] }), { detail: '{"detail":[{"msg":"field required"}]}' });
        assert.deepEqual(errorDetail(undefined), {});
    });

    it('gives nothing in production, or in strict auth mode without NODE_ENV', () => {
        process.env.NODE_ENV = 'production';
        assert.deepEqual(errorDetail(new Error('connect ECONNREFUSED 172.18.0.2:5432')), {});
        assert.deepEqual(errorDetail('provider message'), {});
        delete process.env.NODE_ENV;
        process.env.VITE_DEMO_MODE = 'false';
        assert.deepEqual(errorDetail('provider message'), {});
    });
});

describe('routes in production', () => {
    isolateEnv();
    beforeEach(() => {
        process.env.NODE_ENV = 'production';
    });

    it('TTS: a sidecar failure is answered in our words, its text goes to the log', async (t) => {
        const warn = t.mock.method(console, 'warn', () => {});
        const realFetch = globalThis.fetch;
        t.mock.method(globalThis, 'fetch', (url, init) => (String(url).startsWith('http://127.0.0.1:8880')
            ? Promise.resolve(new Response('{"detail":"/tmp/tmpab12/in.wav: ffmpeg exited with status 1"}', { status: 500 }))
            : realFetch(url, init)));
        const body = await serve(bareApp(ttsRoutes), async (base) => {
            const response = await realFetch(`${base}/api/v2/tts/synthesize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: `テスト ${crypto.randomUUID()}` }),
            });
            assert.equal(response.status, 503);
            return response.json();
        });
        assert.deepEqual(body, { error: 'Voice service is unavailable', error_type: 'tts_unavailable' });
        assert.ok(warn.mock.calls.some((call) => call.arguments.join(' ').includes('/tmp/tmpab12/in.wav')), 'the sidecar text is logged');
    });

    it('TTS: a bad request still says what was wrong', async () => {
        const body = await serve(bareApp(ttsRoutes), async (base) => {
            const response = await fetch(`${base}/api/v2/tts/synthesize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: 'x', speed: 9 }),
            });
            assert.equal(response.status, 400);
            return response.json();
        });
        assert.equal(body.error_type, 'validation');
        assert.match(body.error, /speed/);
    });

    it('adaptation signals: the database message is logged, not answered', async (t) => {
        const warn = t.mock.method(console, 'warn', () => {});
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE;
        setPoolForTests({
            query: async (sql) => {
                if (/auth\.users/.test(sql)) return { rowCount: 1, rows: [] };
                throw Object.assign(new Error('column "mood" does not exist'), { code: '42703' });
            },
        });
        const body = await serve(bareApp(chatgptCurriculumRoutes), async (base) => {
            const response = await fetch(`${base}/api/v2/adaptation`, { headers: { 'x-nexloom-bridge-token': BRIDGE } });
            assert.equal(response.status, 500, 'not a 503: the database is reachable');
            return response.json();
        });
        assert.deepEqual(body, { ok: false, error: 'Failed to get adaptation signals', error_type: 'unknown' });
        assert.ok(warn.mock.calls.some((call) => call.arguments.join(' ').includes('column "mood" does not exist')));
    });

    it('jobs: the owner learns that processing failed, not the worker\'s exception text', async () => {
        setPoolForTests({
            query: async () => ({ rowCount: 1, rows: [{ status: 'error', progress: 0, error: "ENOENT: no such file or directory, open '/app/uploads/x.pdf'" }] }),
        });
        const body = await serve(bareApp(contentRoutes, { userId: '11111111-1111-4111-8111-111111111111' }), async (base) => {
            const response = await fetch(`${base}/api/v2/jobs/22222222-2222-4222-8222-222222222222`);
            assert.equal(response.status, 200);
            return response.json();
        });
        assert.deepEqual(body, { status: 'error', progress: 0, error: 'Processing failed' });
    });

    it('a failing curriculum route over the bridge token, through the real app', async (t) => {
        t.mock.method(console, 'error', () => {});
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE;
        setPoolForTests({
            query: async (sql) => {
                if (/auth\.users/.test(sql)) return { rowCount: 1, rows: [] };
                throw Object.assign(new Error('column j.secret_internal does not exist'), { code: '42703' });
            },
        });
        const body = await serve(await createApp({ serveStatic: false }), async (base) => {
            const response = await fetch(`${base}/api/v2/journal/recent`, { headers: { 'x-nexloom-bridge-token': BRIDGE } });
            assert.equal(response.status, 500);
            return response.json();
        });
        assert.deepEqual(body, { error: 'Failed to fetch recent journal' });
    });
});

describe('routes while developing', () => {
    isolateEnv();

    it('keep the text, for the developer', async (t) => {
        t.mock.method(console, 'error', () => {});
        process.env.NODE_ENV = 'development';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE;
        setPoolForTests({
            query: async (sql) => {
                if (/auth\.users/.test(sql)) return { rowCount: 1, rows: [] };
                throw Object.assign(new Error('column j.secret_internal does not exist'), { code: '42703' });
            },
        });
        const body = await serve(await createApp({ serveStatic: false }), async (base) => {
            const response = await fetch(`${base}/api/v2/journal/recent`, { headers: { 'x-nexloom-bridge-token': BRIDGE } });
            return response.json();
        });
        assert.equal(body.detail, 'column j.secret_internal does not exist');
    });
});

describe('route sources', () => {
    it('no route puts an error\'s .message or a service\'s .detail straight into a response field', () => {
        // Only that direct form: relays of structured results (TTS, adaptation, jobs) are checked
        // by the production tests above. ai.js `message: result.message` is the generator's reply,
        // not an error; health.js keeps its full snapshot for loopback and Tailscale callers (the
        // public edge gets ok/status only).
        const allowed = new Set(['server/routes/ai.js:message: result.message', 'server/routes/health.js:message: err.message']);
        const offenders = [];
        for (const name of fs.readdirSync(path.join(ROOT, 'server/routes'))) {
            if (!name.endsWith('.js')) continue;
            const file = `server/routes/${name}`;
            for (const line of read(file).split('\n')) {
                if (line.includes('console.')) continue;
                const match = line.match(/\b(detail|details|error|message): *([A-Za-z_$][\w$]*\??\.(?:message|detail))\b/);
                if (match && !allowed.has(`${file}:${match[1]}: ${match[2]}`)) offenders.push(`${file}: ${line.trim()}`);
            }
        }
        assert.deepEqual(offenders, []);
    });

    it('the agent routes log Hermes failures before answering', () => {
        const agent = read('server/routes/agent.js');
        assert.match(agent, /console\.warn\('\[Agent Proxy\] Hermes stream failed:'[^\n]*\n\s+return res\.status\(streamResult\.status\)/);
        assert.match(agent, /console\.warn\('\[Agent Proxy\] Hermes request failed:'[^\n]*\n\s+return res\.status\(result\.status\)/);
    });
});
