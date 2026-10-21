/**
 * /api/v2 auth and AI-limit wiring on the real app (createApp).
 *
 * Guards used to be mounted on the whole /api/v2 prefix, so one request ran up to four of them
 * (four Supabase getUser calls), ordinary reads spent the 10/min AI budget, /image counted twice,
 * and in strict mode the learner-memory guard answered 401 for the public TTS probe.
 * Each guard now covers only its own paths, guards share one getUser call per request, and only
 * the expensive POSTs (/ai/generate, /image, /upload, /rag/index, /tts/synthesize, /agent/chat)
 * spend the AI budget. TTS synthesis keeps needing a user in strict mode.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests, resetSupabaseForTests } from '../middleware/auth.js';
import { isBridgeToken } from '../middleware/bridgeToken.js';

// tools/core/kokoroTts.js reads KOKORO_TTS_URL at import: point it at a closed port before the app
// is imported, so no test can reach a real TTS sidecar running on this machine.
process.env.KOKORO_TTS_URL = 'http://127.0.0.1:9';
const { createApp } = await import('../../server.js');

const USER_A = '00000000-0000-0000-0000-0000000000aa';
const JWT_A = 'jwt-for-user-a';
const BRIDGE_TOKEN = 'test-bridge-token-not-a-secret';
const AI_LIMIT = 10; // production max per minute (server.js aiLimiter)

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1',
    'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'MEMANTO_ENABLED'];

/** Fake Supabase admin client: JWT_A is user A, anything else is rejected. Counts getUser calls. */
const createFakeSupabase = () => {
    const calls = [];
    return {
        calls,
        auth: {
            async getUser(token) {
                calls.push(token);
                if (token === JWT_A) return { data: { user: { id: USER_A } }, error: null };
                return { data: { user: null }, error: { message: 'invalid token' } };
            },
        },
    };
};

const fakePool = () => ({
    async query() {
        return { rows: [], rowCount: 0 };
    },
});

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await handler(base);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const jwt = { Authorization: `Bearer ${JWT_A}` };
const bridge = { 'x-nexloom-bridge-token': BRIDGE_TOKEN };
const postJson = (url, body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
});

describe('/api/v2 auth and AI-limit matrix (strict mode)', () => {
    const saved = {};
    let supabase;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        delete process.env.DATABASE_URL_PHASE1;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.MEMANTO_ENABLED;
        resetPoolForTests();
        setPoolForTests(fakePool());
        supabase = createFakeSupabase();
        setSupabaseForTests(supabase);
    });

    afterEach(() => {
        resetSupabaseForTests();
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('public probes need no token', async () => {
        await withServer(async (base) => {
            for (const path of ['/api/v2/health', '/api/v2/tts/health']) {
                const res = await fetch(`${base}${path}`);
                assert.notEqual(res.status, 401, path);
            }
        });
    });

    it('TTS synthesis needs a user in strict mode and spends the AI budget', async () => {
        await withServer(async (base) => {
            const guest = await postJson(`${base}/api/v2/tts/synthesize`, { text: 'こんにちは' });
            assert.equal(guest.status, 401);

            // Empty text is rejected by the route before any synthesis.
            for (let i = 1; i <= AI_LIMIT; i += 1) {
                const res = await postJson(`${base}/api/v2/tts/synthesize`, { text: '' }, jwt);
                assert.equal(res.status, 400, `request ${i}: ${await res.text()}`);
            }
            assert.equal((await postJson(`${base}/api/v2/tts/synthesize`, { text: '' }, jwt)).status, 429);
        });
    });

    it('learner memory still needs a bridge token or a user', async () => {
        await withServer(async (base) => {
            assert.equal((await fetch(`${base}/api/v2/learner-memory/privacy`)).status, 401);
        });
    });

    it('the bridge token sent as a bearer token is not a user token and never reaches Supabase', async () => {
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/v2/curricula`, { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } });
            assert.equal(res.status, 401);
            assert.deepEqual(supabase.calls, []);
        });
    });

    for (const [path, body] of [['/api/v2/ai/generate', {}], ['/api/v2/upload', {}], ['/api/v2/rag/index', {}]]) {
        it(`POST ${path} spends the AI budget`, async () => {
            await withServer(async (base) => {
                for (let i = 1; i <= AI_LIMIT; i += 1) {
                    const res = await postJson(`${base}${path}`, body, jwt);
                    assert.notEqual(res.status, 429, `request ${i}`);
                }
                assert.equal((await postJson(`${base}${path}`, body, jwt)).status, 429);
            });
        });
    }

    it('content routes need a user token, and a request validates it once', async () => {
        await withServer(async (base) => {
            const guest = await fetch(`${base}/api/v2/curricula`);
            assert.equal(guest.status, 401);

            const user = await fetch(`${base}/api/v2/curricula`, { headers: jwt });
            assert.equal(user.status, 200, await user.text());
            assert.deepEqual(supabase.calls, [JWT_A], 'one getUser call for the whole request');
        });
    });

    it('/image validates the token once and spends the AI budget once per request', async () => {
        await withServer(async (base) => {
            for (let i = 1; i <= AI_LIMIT; i += 1) {
                const res = await postJson(`${base}/api/v2/image`, { prompt: '' }, jwt);
                assert.equal(res.status, 400, `request ${i}: ${await res.text()}`);
            }
            assert.equal(supabase.calls.length, AI_LIMIT, 'one getUser call per request');
            const over = await postJson(`${base}/api/v2/image`, { prompt: '' }, jwt);
            assert.equal(over.status, 429);
        });
    });

    it('ordinary reads and job polling do not spend the AI budget', async () => {
        await withServer(async (base) => {
            for (let i = 1; i <= AI_LIMIT + 2; i += 1) {
                const list = await fetch(`${base}/api/v2/curricula`, { headers: jwt });
                assert.equal(list.status, 200, `curricula ${i}`);
                const job = await fetch(`${base}/api/v2/jobs/00000000-0000-0000-0000-000000000123`, { headers: jwt });
                assert.notEqual(job.status, 429, `jobs ${i}`);
            }
        });
    });

    it('agent chat spends the AI budget; agent health does not, and both need auth', async () => {
        await withServer(async (base) => {
            assert.equal((await fetch(`${base}/api/v2/agent/health`)).status, 401);
            for (let i = 1; i <= AI_LIMIT + 2; i += 1) {
                assert.equal((await fetch(`${base}/api/v2/agent/health`, { headers: jwt })).status, 200);
            }
            for (let i = 1; i <= AI_LIMIT; i += 1) {
                const res = await postJson(`${base}/api/v2/agent/chat`, {}, jwt);
                assert.equal(res.status, 422, `chat ${i}`);
            }
            assert.equal((await postJson(`${base}/api/v2/agent/chat`, {}, jwt)).status, 429);
        });
    });

    it('bridge-token routes authenticate without calling Supabase', async () => {
        await withServer(async (base) => {
            const recent = await fetch(`${base}/api/v2/journal/recent`, { headers: bridge });
            assert.equal(recent.status, 200, await recent.text());
            const memory = await fetch(`${base}/api/v2/learner-memory/privacy`, { headers: bridge });
            assert.notEqual(memory.status, 401, await memory.text());
            assert.deepEqual(supabase.calls, []);
        });
    });

    it('the legacy /api/generate-audio route is gone', async () => {
        await withServer(async (base) => {
            const res = await postJson(`${base}/api/generate-audio`, { id: '../../escape', chapters: [] });
            assert.equal(res.status, 404);
        });
    });
});

describe('/api/v2 auth outside strict mode (dev/demo)', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        process.env.NODE_ENV = 'development';
        delete process.env.RISEPATH_STRICT_AUTH;
        delete process.env.VITE_DEMO_MODE;
        delete process.env.DATABASE_URL_PHASE1;
        resetPoolForTests();
        setPoolForTests(fakePool());
        setSupabaseForTests(createFakeSupabase());
    });

    afterEach(() => {
        resetSupabaseForTests();
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('guests may use TTS synthesis', async () => {
        await withServer(async (base) => {
            const res = await postJson(`${base}/api/v2/tts/synthesize`, { text: '' });
            assert.equal(res.status, 400, await res.text()); // reached the route (validation), not 401
        });
    });
});

describe('isBridgeToken', () => {
    const saved = process.env.RISE_PATH_BRIDGE_TOKEN;
    afterEach(() => {
        if (saved === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
        else process.env.RISE_PATH_BRIDGE_TOKEN = saved;
    });

    it('matches only the configured token', () => {
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        assert.equal(isBridgeToken(BRIDGE_TOKEN), true);
        assert.equal(isBridgeToken(` ${BRIDGE_TOKEN} `), true);
        for (const value of [`${BRIDGE_TOKEN}x`, BRIDGE_TOKEN.slice(0, -1), '', null, undefined, 42]) {
            assert.equal(isBridgeToken(value), false, String(value));
        }
    });

    it('never matches when no token is configured', () => {
        delete process.env.RISE_PATH_BRIDGE_TOKEN;
        assert.equal(isBridgeToken(''), false);
        assert.equal(isBridgeToken('anything'), false);
    });
});
