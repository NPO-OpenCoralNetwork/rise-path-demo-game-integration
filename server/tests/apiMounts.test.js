import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { ORIGIN_SECRET_HEADER } from '../middleware/originGate.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

/**
 * Which auth and limiter each /api/v2 mount in server.js ends up with, in production (strict auth,
 * no dev fallback). Supabase is not initialized here, so no JWT validates: a 401 means "this
 * mount wants a JWT", a 200 or 503 means the request passed auth.
 */
const BRIDGE_TOKEN = 'test-bridge-token-for-api-mounts';
const SECRET = 'test-origin-secret-for-api-mounts-0123456789';
const quietLogger = { warn: () => {} };

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'TRUST_PROXY', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'HERMES_API_KEY'];

const withApp = async (originGate, handler) => {
    const app = await createApp({ serveStatic: false, originGate });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const bridge = { 'x-nexloom-bridge-token': BRIDGE_TOKEN };

describe('server.js /api/v2 mounts (production)', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        resetPoolForTests();
        setPoolForTests(null);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        resetPoolForTests();
    });

    it('content routes want a JWT and no longer pay the AI limiter of the agent mount', async () => {
        await withApp(undefined, async (base) => {
            for (let i = 0; i < 12; i += 1) {
                const response = await fetch(`${base}/api/v2/curricula`, { headers: bridge });
                assert.equal(response.status, 401, `request ${i + 1}: requireAuth wants a JWT, not 429`);
            }
        });
    });

    it('learner memory and the agent proxy still require auth; the bridge token works from loopback', async () => {
        await withApp(undefined, async (base) => {
            assert.equal((await fetch(`${base}/api/v2/learner-memory`)).status, 401);
            assert.equal((await fetch(`${base}/api/v2/agent/health`)).status, 401);
            assert.equal((await fetch(`${base}/api/v2/learner-memory`, { headers: bridge })).status, 503, 'passed auth, then no DB');
            const health = await fetch(`${base}/api/v2/agent/health`, { headers: bridge });
            assert.equal(health.status, 200);
            assert.equal((await health.json()).ok, true);
        });
    });

    it('with ORIGIN_SECRET set: loopback keeps bridge auth, an edge request needs a JWT', async () => {
        process.env.ORIGIN_SECRET = SECRET;
        await withApp(undefined, async (base) => {
            assert.equal((await fetch(`${base}/api/v2/agent/health`, { headers: bridge })).status, 200);
        });
        await withApp({ exemptLoopback: false, logger: quietLogger }, async (base) => {
            const edge = { ...bridge, [ORIGIN_SECRET_HEADER]: SECRET };
            assert.equal((await fetch(`${base}/api/v2/agent/health`, { headers: edge })).status, 401);
            const bearer = { Authorization: `Bearer ${BRIDGE_TOKEN}`, [ORIGIN_SECRET_HEADER]: SECRET };
            assert.equal((await fetch(`${base}/api/v2/agent/health`, { headers: bearer })).status, 401);
        });
    });

    it('the legacy POST /api/generate-audio is gone', async () => {
        await withApp(undefined, async (base) => {
            const response = await fetch(`${base}/api/generate-audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 'course-1', chapters: [] }),
            });
            assert.equal(response.status, 404);
        });
    });
});
