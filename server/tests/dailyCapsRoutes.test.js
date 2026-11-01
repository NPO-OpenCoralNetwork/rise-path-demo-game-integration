// Daily caps on the real server.js stack (server/middleware/dailyCaps.js): which calls are
// charged, which are given back, and that guests are not counted against the signed-in caps.
// Development mode with no Supabase: a request with a Bearer token (or, on requireAuth routes,
// without one) runs as the dev fallback user, so these act as a signed-in user.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server.js';
import { resetGatewayForTests, setGatewayForTests } from '../llm/index.js';
import { LlmError } from '../llm/errors.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetDailyCapsForTests } from '../middleware/dailyCaps.js';
import { setImageClientForTests } from '../geminiBackendService.js';
import { resetEmbeddingClientForTests } from '../../tools/core/ragSearch.js';
import { resetUploadRootForTests, setUploadRootForTests } from '../uploads.js';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LESSON = { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] };
const ANCHOR = { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書くと伝わりやすい。' };
const FEEDBACK = {
    text: 'I want to learn React because I want to build my own apps for my team.',
    rubric: { clarity: 'State the goal', linking: 'Use because/so', tone: 'Confident' },
    locale: 'en',
};
const AGENT_CHAT = {
    skill: 'life-habit-analyst',
    message: '傾向は？',
    context: { from: '2026-06-01', to: '2026-06-30', timezone: 'Asia/Tokyo' },
    include_diary_excerpts: false,
};
const SIGNED_IN = { Authorization: 'Bearer x' };

const CAP_KEYS = ['LLM', 'COURSE_GENERATION', 'IMAGE', 'AGENT_CHAT', 'EMBEDDINGS']
    .flatMap((kind) => [`AI_CAP_USER_${kind}`, `AI_CAP_IP_${kind}`, `AI_CAP_GLOBAL_${kind}`]);
const DEV_USER = '00000000-0000-0000-0000-000000000001';
const DRAFT_ID = '11111111-2222-4333-8444-555555555555';
const ENV_KEYS = [
    'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_ALLOWED', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK',
    'LLM_MOCK_DELAY_MS', 'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1',
    'RISE_PATH_BRIDGE_TOKEN', 'LLM_ALLOWED_ORIGINS', 'LLM_GUEST_DAILY_PER_IP', 'LLM_GUEST_DAILY_TOTAL', 'TRUST_PROXY',
    'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'HERMES_API_KEY', 'HERMES_API_URL', 'AI_CAP_ALERT_WEBHOOK_URL',
    'VITE_FEATURE_AGENT_CHAT', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI', ...CAP_KEYS,
];

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const postJson = (url, body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
});

/** Status and JSON body (null for a non-JSON body). */
const send = async (url, body, headers) => {
    const response = await postJson(url, body, headers);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // SSE or empty
    }
    return { status: response.status, json, text, headers: response.headers };
};

/** Wait for a condition set by a 'finish' handler after the response was sent. */
const waitFor = async (condition, ms = 1000) => {
    const until = Date.now() + ms;
    while (!condition()) {
        if (Date.now() > until) return false;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return true;
};

/**
 * Mock pg pool: records statements (whitespace-normalized, lowercased), answers the role lookup
 * with no row and every ai_daily_usage upsert with a reserved slot. `answer(sql, params)` may
 * return a result (or throw) for any other statement.
 */
function createMockPool(answer = () => undefined) {
    const queries = [];
    const run = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
        queries.push({ sql: text, params });
        if (text.startsWith('insert into ai_daily_usage')) return { rowCount: 1, rows: [{ count: 1 }] };
        return (await answer(text, params)) ?? { rowCount: 0, rows: [] };
    };
    return {
        queries,
        query: run,
        connect: async () => ({ query: run, release: () => {} }),
        usage: () => queries.filter((q) => q.sql.includes('ai_daily_usage')),
    };
}

const assertDailyLimit = (result, kind, scope) => {
    assert.equal(result.status, 429, result.text);
    assert.equal(result.json.error_type, 'daily_limit_reached');
    assert.equal(result.json.kind, kind);
    assert.equal(result.json.scope, scope);
    if (scope === 'off') {
        assert.equal(result.json.reset_at, undefined, 'a feature turned off promises no reset');
        assert.equal(result.headers.get('retry-after'), null);
        return;
    }
    assert.match(result.json.reset_at, /T15:00:00\.000Z$/, 'resets at 00:00 JST');
    assert.ok(Number(result.headers.get('retry-after')) > 0);
};

/**
 * Gateway double for the course generator (task 'course.generate'); records each generate call.
 * `reply` is the model's text (an object is sent as JSON), or an Error to throw.
 */
const fakeCourseGateway = (reply = { message: 'Here is a plan.', intake: { goal: 'SQL basics' } }) => {
    const calls = [];
    return {
        calls,
        canServe: () => true,
        status: () => ({}),
        async generate(req) {
            calls.push(req);
            if (reply instanceof Error) throw reply;
            const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
            return { provider: 'anthropic', model: 'm', text, stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
        },
        async *stream() {},
    };
};

/**
 * A mock pool whose ai_daily_usage rows count as Postgres does: RESERVE_SQL takes a slot while
 * count < $4, REFUND_SQL gives one back. `answer` as in createMockPool.
 */
function countingPool(answer) {
    const counts = new Map();
    const mock = createMockPool(answer);
    return {
        ...mock,
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
            if (text.startsWith('insert into ai_daily_usage')) {
                mock.queries.push({ sql: text, params });
                const key = params.slice(0, 3).join('|');
                const count = counts.get(key) ?? 0;
                if (count >= params[3]) return { rowCount: 0, rows: [] };
                counts.set(key, count + 1);
                return { rowCount: 1, rows: [{ count: count + 1 }] };
            }
            if (text.startsWith('update ai_daily_usage')) {
                mock.queries.push({ sql: text, params });
                for (const subject of params[2]) {
                    const key = `${params[0]}|${params[1]}|${subject}`;
                    counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
                }
                return { rowCount: 1, rows: [] };
            }
            return mock.query(sql, params);
        },
        async connect() {
            return { query: (sql, params) => this.query(sql, params), release: () => {} };
        },
    };
}

/** A TCP port with nothing listening on it. */
const closedPort = async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    return port;
};

describe('daily caps on the API routes', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.LLM_MOCK_DELAY_MS = '0';
        // Past the AI access gate (aiAccessGate.js) without age rows, so the recorded queries are the
        // caps' alone; guests may use AI (LLM_GUEST_AI). aiAccessRoutes.test.js covers the gate.
        process.env.AI_ACCESS_DEV_AUDIENCE = 'adult';
        process.env.LLM_GUEST_AI = 'true';
        resetGatewayForTests();
        resetPoolForTests();
        setPoolForTests(null);
        resetDailyCapsForTests();
        setImageClientForTests(null);
        resetEmbeddingClientForTests();
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        resetGatewayForTests();
        resetPoolForTests();
        resetDailyCapsForTests();
        setImageClientForTests(null);
        resetEmbeddingClientForTests();
    });

    describe('/llm (signed in)', () => {
        it('counts writing feedback against the per-user cap', async () => {
            process.env.AI_CAP_USER_LLM = '1';
            await withServer(async (base) => {
                const first = await send(`${base}/llm/writing-feedback`, FEEDBACK, SIGNED_IN);
                assert.equal(first.status, 200, first.text);
                assert.equal(first.json.meta.provider, 'mock');
                assertDailyLimit(await send(`${base}/llm/writing-feedback`, FEEDBACK, SIGNED_IN), 'llm', 'user');
                const invalid = await send(`${base}/llm/writing-feedback`, { text: 'short', rubric: {} }, SIGNED_IN);
                assert.equal(invalid.status, 400, 'body validation runs before the cap');
            });
        });

        it('gives the call back when the provider was unavailable', async () => {
            process.env.AI_CAP_USER_LLM = '1';
            setGatewayForTests({
                status: () => ({}),
                generate: async () => { throw new LlmError('provider_unavailable', 'down'); },
                stream: async function* stream() { throw new LlmError('provider_unavailable', 'down'); },
            });
            await withServer(async (base) => {
                for (let i = 0; i < 2; i += 1) {
                    const result = await send(`${base}/llm/writing-feedback`, FEEDBACK, SIGNED_IN);
                    assert.equal(result.status, 503, `attempt ${i + 1} is not 429`);
                    assert.equal(result.json.error_type, 'provider_unavailable');
                }
                for (let i = 0; i < 2; i += 1) {
                    const sse = await send(`${base}/llm/tutor`, { message: 'hi', lesson: LESSON, anchor: ANCHOR }, SIGNED_IN);
                    assert.equal(sse.status, 200, `tutor attempt ${i + 1} is not 429`);
                    assert.match(sse.text, /event: error/);
                }
            });
        });

        it('does not count guests against the per-user cap (only the guest budget applies)', async () => {
            process.env.AI_CAP_USER_LLM = '1';
            process.env.AI_CAP_GLOBAL_LLM = '1';
            await withServer(async (base) => {
                for (let i = 0; i < 2; i += 1) {
                    const guest = await send(`${base}/llm/tutor`, { message: 'ok', lesson: LESSON, anchor: ANCHOR });
                    assert.equal(guest.status, 200, guest.text);
                    assert.match(guest.text, /event: done/);
                }
                const signedIn = await send(`${base}/llm/tutor`, { message: 'ok', lesson: LESSON, anchor: ANCHOR }, SIGNED_IN);
                assert.match(signedIn.text, /event: done/, 'the guests used none of the caps of 1');
                assertDailyLimit(await send(`${base}/llm/tutor`, { message: 'ok', lesson: LESSON, anchor: ANCHOR }, SIGNED_IN), 'llm', 'user');
            });
        });

        it("a tutor turned off (AI_CAP_USER_LLM=0) is off for guests too, without using their budget", async () => {
            process.env.AI_CAP_USER_LLM = '0';
            process.env.LLM_GUEST_DAILY_PER_IP = '1';
            await withServer(async (base) => {
                const ask = (headers) => send(`${base}/llm/tutor`, { message: 'ok', lesson: LESSON, anchor: ANCHOR }, headers);
                assertDailyLimit(await ask(), 'llm', 'off');
                assertDailyLimit(await ask(), 'llm', 'off');
                assertDailyLimit(await send(`${base}/llm/writing-feedback`, FEEDBACK), 'llm', 'off');
                assertDailyLimit(await ask(SIGNED_IN), 'llm', 'off');
                delete process.env.AI_CAP_USER_LLM;
                const guest = await ask();
                assert.equal(guest.status, 200, 'the refused calls used none of the guest budget of 1');
                assert.match(guest.text, /event: done/);
                assertDailyLimit(await ask(), 'llm', 'guest');
            });
        });

        it('the per-minute AI limiter counts an IPv6 guest by its /56, not by each address', async () => {
            process.env.TRUST_PROXY = '1';
            await withServer(async (base) => {
                const from = (ip) => send(`${base}/llm/writing-feedback`, { text: 'short', rubric: {} }, { 'X-Forwarded-For': ip });
                // 100 a minute outside production: alternate four addresses in one /56 (two /64s).
                const addresses = ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:3::1', '2001:db8:1:ff::7'];
                for (let i = 0; i < 100; i += 1) {
                    const result = await from(addresses[i % addresses.length]);
                    assert.equal(result.status, 400, `request ${i + 1} reaches validation`);
                }
                const limited = await from('2001:db8:1:2::99');
                assert.equal(limited.status, 429, 'the 101st from the same /56 is limited');
                assert.match(limited.json.error, /AI rate limit/);
                assert.equal((await from('2001:db8:2::1')).status, 400, 'another /56 has its own count');
            });
        });
    });

    describe('/image', () => {
        it('rejects 4K, an unknown aspect ratio and an over-long prompt before the cap', async () => {
            process.env.AI_CAP_USER_IMAGE = '0';
            await withServer(async (base) => {
                for (const body of [
                    { prompt: 'a cat', image_size: '4K' },
                    { prompt: 'a cat', aspect_ratio: '21:9' },
                    { prompt: 'x'.repeat(4001) },
                ]) {
                    const result = await send(`${base}/image`, body);
                    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 60));
                    assert.equal(result.json.error_type, 'invalid_body');
                }
            });
        });

        /** A Gemini image client whose every call fails like the API does (ApiError carries `status`). */
        const failingImageClient = (status) => {
            const calls = [];
            return {
                calls,
                models: {
                    async generateContent(params) {
                        calls.push(params);
                        throw Object.assign(new Error(`{"error":{"code":${status},"message":"API key AIzaSECRET rejected for /srv/secret/path"}}`), { status });
                    },
                },
            };
        };

        const IMAGE_UNAVAILABLE = { error: 'Image generation is not available on this server.', error_type: 'image_generation_unavailable' };

        it('answers 503 image_generation_unavailable without charging when Gemini is not allowed, even with a key', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
            process.env.GEMINI_API_KEY = 'AIza-test-key';
            const client = failingImageClient(500);
            setImageClientForTests(client);
            const pool = createMockPool();
            setPoolForTests(pool);
            await withServer(async (base) => {
                for (let i = 0; i < 3; i += 1) {
                    const result = await send(`${base}/image`, { prompt: `not allowed ${i} ${Math.random()}` });
                    assert.equal(result.status, 503, `attempt ${i + 1} is not 429`);
                    assert.deepEqual(result.json, IMAGE_UNAVAILABLE);
                }
            });
            assert.equal(client.calls.length, 0, 'Gemini was never called');
            assert.deepEqual(pool.usage(), [], 'nothing was charged');
        });

        it('answers 503 image_generation_unavailable without charging when Gemini is allowed but has no key', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
            process.env.GEMINI_ALLOWED = 'true';
            const prompt = `daily cap test ${Date.now()} ${Math.random()}`;
            await withServer(async (base) => {
                for (let i = 0; i < 2; i += 1) {
                    const result = await send(`${base}/image`, { prompt, aspect_ratio: '16:9', image_size: '1K' });
                    assert.equal(result.status, 503, `attempt ${i + 1} is not 429`);
                    assert.deepEqual(result.json, IMAGE_UNAVAILABLE);
                }
            });
        });

        it('gives the image back when Gemini refuses the key (400, 401, 403) or rate limits (429, answered 503); no provider text', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
            process.env.GEMINI_ALLOWED = 'true';
            await withServer(async (base) => {
                for (const status of [400, 401, 403, 429]) {
                    const client = failingImageClient(status);
                    setImageClientForTests(client);
                    for (let i = 0; i < 2; i += 1) {
                        const result = await send(`${base}/image`, { prompt: `refused ${status} ${i} ${Math.random()}` });
                        assert.equal(result.status, status === 429 ? 503 : 500, `${status}: attempt ${i + 1} is not 429`);
                        assert.deepEqual(result.json, { error: 'Image generation failed', error_type: 'image_failed' });
                        assert.ok(!result.text.includes('SECRET'));
                    }
                    assert.equal(client.calls.length, 2, `${status}: both calls reached Gemini`);
                }
            });
        });

        it('maps GEMINI_NOT_CONFIGURED from the generator to 503 image_generation_unavailable and gives the image back', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
            process.env.GEMINI_ALLOWED = 'true';
            // The pre-check passes (a test client is set), then the generator says it cannot run.
            const calls = [];
            setImageClientForTests({
                models: {
                    async generateContent(params) {
                        calls.push(params);
                        throw Object.assign(new Error('not configured'), { code: 'GEMINI_NOT_CONFIGURED' });
                    },
                },
            });
            await withServer(async (base) => {
                for (let i = 0; i < 2; i += 1) {
                    const result = await send(`${base}/image`, { prompt: `not configured ${i} ${Math.random()}` });
                    assert.equal(result.status, 503, `attempt ${i + 1} is not 429: ${result.text}`);
                    assert.deepEqual(result.json, IMAGE_UNAVAILABLE);
                }
            });
            assert.equal(calls.length, 2, 'both requests passed the pre-check');
        });

        it('keeps the image charged when Gemini fails after accepting the call (500)', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
            process.env.GEMINI_ALLOWED = 'true';
            setImageClientForTests(failingImageClient(500));
            await withServer(async (base) => {
                const first = await send(`${base}/image`, { prompt: `server error ${Math.random()}` });
                assert.equal(first.status, 500);
                assert.deepEqual(first.json, { error: 'Image generation failed', error_type: 'image_failed' });
                assertDailyLimit(await send(`${base}/image`, { prompt: `server error ${Math.random()}` }), 'image', 'user');
            });
        });

        it("answers 429 scope 'off' when image generation is turned off (and available)", async () => {
            process.env.AI_CAP_USER_IMAGE = '0';
            process.env.GEMINI_ALLOWED = 'true';
            setImageClientForTests(failingImageClient(500));
            await withServer(async (base) => {
                assertDailyLimit(await send(`${base}/image`, { prompt: `daily cap off ${Date.now()}` }), 'image', 'off');
            });
        });
    });

    describe('/upload and /rag/index', () => {
        // Uploads go to <root>/uploads (server/uploads.js): a temporary root, removed afterwards.
        let uploadRoot;
        beforeEach(() => {
            uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-daily-caps-uploads-'));
            setUploadRootForTests(uploadRoot);
        });
        afterEach(() => {
            resetUploadRootForTests();
            fs.rmSync(uploadRoot, { recursive: true, force: true });
        });
        const storedFiles = () => {
            const dir = path.join(uploadRoot, 'uploads');
            return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        };

        it('refuses an upload before multer stores the file', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '0';
            const name = `daily-cap-${Date.now()}.txt`;
            await withServer(async (base) => {
                const form = new FormData();
                form.append('file', new Blob(['hello'], { type: 'text/plain' }), name);
                const response = await fetch(`${base}/upload`, { method: 'POST', body: form });
                const json = await response.json();
                assertDailyLimit({ status: response.status, json, text: JSON.stringify(json), headers: response.headers }, 'embeddings', 'off');
            });
            assert.deepEqual(storedFiles(), [], 'nothing was written');
        });

        it('keeps the unit when the stored file cannot be read, so the cap still bounds stored files', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '1';
            setPoolForTests(countingPool((sql) => (sql.startsWith('insert into materials')
                ? { rowCount: 1, rows: [{ id: DRAFT_ID, status: 'uploaded' }] }
                : undefined)));
            const name = `daily-cap-unreadable-${Date.now()}.pdf`;
            const upload = (base) => {
                const form = new FormData();
                // Starts like a PDF (the upload's signature check), but pdf-parse cannot read it.
                form.append('file', new Blob(['%PDF-1.4 not really a PDF'], { type: 'application/pdf' }), name);
                return fetch(`${base}/upload`, { method: 'POST', body: form });
            };
            await withServer(async (base) => {
                const first = await upload(base);
                assert.equal(first.status, 200);
                const stored = await first.json();
                assert.equal(stored.status, 'error', 'the text could not be read');
                assert.equal(stored.error_type, 'extract_failed');
                const second = await upload(base);
                const json = await second.json();
                assertDailyLimit({ status: second.status, json, text: JSON.stringify(json), headers: second.headers }, 'embeddings', 'user');
            });
        });

        it('gives the unit back when the route ends with 503 (no database)', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '1';
            await withServer(async (base) => {
                for (let i = 0; i < 3; i += 1) {
                    const result = await send(`${base}/rag/index`, { material_id: 'm1' });
                    assert.equal(result.status, 503, `attempt ${i + 1} is not 429`);
                }
                process.env.AI_CAP_USER_EMBEDDINGS = '0';
                assertDailyLimit(await send(`${base}/rag/index`, { material_id: 'm1' }), 'embeddings', 'off');
            });
        });

        it('stores an upload without vectors when embeddings are off (ready, keyword search), and keeps the unit', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '1';
            process.env.GEMINI_API_KEY = 'AIza-test-key'; // not used: GEMINI_ALLOWED is not "true"
            const pool = countingPool((sql) => (sql.startsWith('insert into materials')
                ? { rowCount: 1, rows: [{ id: DRAFT_ID, status: 'uploaded' }] }
                : undefined));
            setPoolForTests(pool);
            const name = `daily-cap-keyword-${Date.now()}.txt`;
            const upload = (base) => {
                const form = new FormData();
                form.append('file', new Blob(['Rise Path keyword search material. '.repeat(40)], { type: 'text/plain' }), name);
                return fetch(`${base}/upload`, { method: 'POST', body: form });
            };
            const { log } = console;
            console.log = () => {};
            try {
                await withServer(async (base) => {
                    const first = await upload(base);
                    assert.equal(first.status, 200);
                    assert.equal((await first.json()).status, 'ready', 'stored for keyword search');
                    const second = await upload(base);
                    const json = await second.json();
                    assertDailyLimit({ status: second.status, json, text: JSON.stringify(json), headers: second.headers }, 'embeddings', 'user');
                });
            } finally {
                console.log = log;
            }
            const chunks = pool.queries.filter((q) => q.sql.startsWith('insert into material_chunks'));
            assert.ok(chunks.length > 0);
            assert.ok(chunks.every((q) => /values \(\$1, \$2, \$3, null, \$4, null, null\)/.test(q.sql)), 'no vector, no model');
            assert.ok(pool.queries.some((q) => q.sql.startsWith('update materials set status') && q.params[0] === 'ready'));
        });

        it('gives the /rag/index unit back when embeddings are off; keeps it when they are on', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '1';
            const answer = (sql) => {
                if (sql.startsWith('select 1 from materials')) return { rowCount: 1, rows: [{}] };
                if (sql.startsWith('insert into jobs')) return { rowCount: 1, rows: [{ id: 'job-1', status: 'queued' }] };
                return undefined;
            };
            setPoolForTests(countingPool(answer));
            await withServer(async (base) => {
                for (let i = 0; i < 3; i += 1) {
                    const result = await send(`${base}/rag/index`, { material_id: DRAFT_ID });
                    assert.equal(result.status, 200, `attempt ${i + 1} is not 429`);
                    assert.equal(result.json.status, 'queued');
                    assert.equal(result.json.embeddings, 'off', 'the answer says embeddings are off');
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            });

            resetDailyCapsForTests();
            setPoolForTests(countingPool(answer));
            process.env.GEMINI_ALLOWED = 'true';
            process.env.GEMINI_API_KEY = 'AIza-test-key';
            await withServer(async (base) => {
                assert.equal((await send(`${base}/rag/index`, { material_id: DRAFT_ID })).status, 200);
                assertDailyLimit(await send(`${base}/rag/index`, { material_id: DRAFT_ID }), 'embeddings', 'user');
            });
        });

        it('refuses a file over 10 MB with 413 and gives the unit back; one file per request', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '1';
            // A database to keep the row: without one the route answers 503 before reading the file.
            setPoolForTests(countingPool(() => undefined));
            const name = `daily-cap-large-${Date.now()}.txt`;
            const big = new Uint8Array(10 * 1024 * 1024 + 1);
            await withServer(async (base) => {
                for (let i = 0; i < 2; i += 1) {
                    const form = new FormData();
                    form.append('file', new Blob([big], { type: 'text/plain' }), name);
                    const response = await fetch(`${base}/upload`, { method: 'POST', body: form });
                    const json = await response.json();
                    assert.equal(response.status, 413, `attempt ${i + 1} is not 429`);
                    assert.equal(json.error_type, 'file_too_large');
                }
                const two = new FormData();
                two.append('file', new Blob(['a'], { type: 'text/plain' }), `a-${name}`);
                two.append('file', new Blob(['b'], { type: 'text/plain' }), `b-${name}`);
                const response = await fetch(`${base}/upload`, { method: 'POST', body: two });
                assert.equal(response.status, 400);
                assert.equal((await response.json()).error_type, 'invalid_body');
            });
            assert.deepEqual(storedFiles(), [], 'multer removed the partial files');
        });
    });

    describe('/ai/generate', () => {
        /** The daily cap refund statements sent for course_generation. */
        const refunds = (pool) => pool.usage().filter((q) => q.sql.startsWith('update ai_daily_usage'));

        it('charges a stage call, refunds a 400 sent before the model, and checks the database counters', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            const gateway = fakeCourseGateway();
            setGatewayForTests(gateway);
            await withServer(async (base) => {
                const missing = await send(`${base}/ai/generate`, { stage: 'requirements' });
                assert.equal(missing.status, 400, missing.text);
                const reserved = pool.usage().filter((q) => q.sql.startsWith('insert into ai_daily_usage'));
                assert.deepEqual(reserved.map((q) => [q.params[1], q.params[2]]), [
                    ['course_generation', DEV_USER],
                    ['course_generation', '*'],
                ]);
                assert.ok(pool.queries.some((q) => q.sql.startsWith('select role from user_profiles')));
                assert.ok(await waitFor(() => refunds(pool).length > 0), 'the 400 was refunded');
                assert.deepEqual(refunds(pool)[0].params.slice(1), ['course_generation', [DEV_USER, '*']]);
                assert.equal(gateway.calls.length, 0);
            });
        });

        it('rejects a non-UUID curriculum_id or a bad message with 400 before charging or calling the model', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            const gateway = fakeCourseGateway();
            setGatewayForTests(gateway);
            await withServer(async (base) => {
                for (const body of [
                    { message: 'Teach me SQL', curriculum_id: 'API key' },
                    { message: 'Teach me SQL', curriculum_id: 'GEMINI' },
                    { decision: 'approved', stage: 'roadmap', curriculum_id: 'c1' },
                    { message: 'x'.repeat(4001) },
                    { decision: 'revise', stage: 'requirements', message: 'y'.repeat(4001), curriculum_id: DRAFT_ID },
                    { message: { text: 'Teach me SQL' } },
                    { message: 'Teach me SQL', attachments: [{ material_id: 'API key' }] },
                    { message: 'Teach me SQL', attachments: 'notes.pdf' },
                ]) {
                    const result = await send(`${base}/ai/generate`, body);
                    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
                    assert.equal(result.json.error_type, 'invalid_body');
                }
                assert.deepEqual(pool.usage(), [], 'nothing was charged');
                assert.equal(gateway.calls.length, 0, 'the model was not called');
            });
        });

        it('reads the attached material first for the requirements stage, within the learner\'s own ready materials', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            setGatewayForTests(fakeCourseGateway());
            await withServer(async (base) => {
                const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL', curriculum_id: DRAFT_ID, attachments: [{ material_id: DRAFT_ID }] });
                assert.equal(result.status, 200, result.text);
            });
            const attached = pool.queries.find((q) => /m\.id = any\(\$2::uuid\[\]\)/.test(q.sql));
            assert.ok(attached, 'the attached material was read');
            assert.match(attached.sql, /where m\.status = 'ready' and m\.user_id = \$1 and m\.id = any/);
            assert.deepEqual(attached.params.slice(0, 2), [DEV_USER, [DRAFT_ID]]);
        });

        it('reads the attached material first for a requirements revision too', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            setGatewayForTests(fakeCourseGateway());
            await withServer(async (base) => {
                const result = await send(`${base}/ai/generate`, {
                    decision: 'revise', stage: 'requirements', message: 'Use my notes', curriculum_id: DRAFT_ID, attachments: [{ material_id: DRAFT_ID }],
                });
                assert.equal(result.status, 200, result.text);
                assert.equal(result.json.status, 'revised');
            });
            const attached = pool.queries.find((q) => /m\.id = any\(\$2::uuid\[\]\)/.test(q.sql));
            assert.ok(attached, 'the attached material was read');
            assert.deepEqual(attached.params.slice(0, 2), [DEV_USER, [DRAFT_ID]]);
        });

        it("runs a stage as one 'course.generate' gateway call and reads its JSON reply", async () => {
            setPoolForTests(createMockPool());
            const gateway = fakeCourseGateway('Here is the plan:\n```json\n{"message":"Plan for SQL","intake":{"goal":"SQL basics"}}\n```');
            setGatewayForTests(gateway);
            await withServer(async (base) => {
                const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL', curriculum_id: DRAFT_ID });
                assert.equal(result.status, 200, result.text);
                assert.equal(result.json.message, 'Plan for SQL');
                assert.equal(result.json.pending_approval, 'requirements');
            });
            assert.equal(gateway.calls.length, 1);
            assert.equal(gateway.calls[0].task, 'course.generate');
            assert.equal(gateway.calls[0].userId, DEV_USER);
            assert.deepEqual(gateway.calls[0].messages, [{ role: 'user', content: 'Teach me SQL' }]);
            // Not cancelled when the client goes away: the stage finishes and saves the draft.
            assert.equal(gateway.calls[0].signal, undefined);
        });

        it('answers 422 and saves nothing when the curriculum reply is broken JSON with a parseable nested piece', async () => {
            const broken = '{"curriculum": {"title": {"en": "Intro", "jp": "入門"}, "description": {"en": "Learn the "basics"", "jp": "基本"}, "modules": []}}';
            const pool = createMockPool((sql) => (sql.startsWith('select intake_json, modules_json')
                ? { rowCount: 1, rows: [{ intake_json: { goal: 'SQL' }, modules_json: [{ module_id: 'm1' }] }] }
                : undefined));
            setPoolForTests(pool);
            const gateway = fakeCourseGateway(broken);
            setGatewayForTests(gateway);
            await withServer(async (base) => {
                const result = await send(`${base}/ai/generate`, { decision: 'approved', stage: 'roadmap', curriculum_id: DRAFT_ID });
                assert.equal(gateway.calls.length, 1, 'the model ran');
                assert.equal(result.status, 422, result.text);
                assert.ok(!result.text.includes('カリキュラムが完成しました'));
            });
            const writes = pool.queries.filter((q) => /^(insert into|update) curricul|^begin/.test(q.sql));
            assert.deepEqual(writes, [], 'no curriculum or version row was written');
        });

        it('runs on the mock provider in development without keys (no Gemini)', async () => {
            process.env.GEMINI_API_KEY = 'AIza-test-key'; // ignored: GEMINI_ALLOWED is not "true"
            const pool = createMockPool((sql) => (sql.startsWith('insert into curricula')
                ? { rowCount: 1, rows: [{ id: DRAFT_ID }] }
                : undefined));
            setPoolForTests(pool);
            const { warn } = console;
            console.warn = () => {};
            try {
                await withServer(async (base) => {
                    const result = await send(`${base}/ai/generate`, { message: 'SQL basics' });
                    assert.equal(result.status, 200, result.text);
                    assert.equal(result.json.curriculum_id, DRAFT_ID);
                    assert.match(result.json.message, /SQL basics/);
                });
            } finally {
                console.warn = warn;
            }
            const insert = pool.queries.find((q) => q.sql.startsWith('insert into curricula'));
            assert.equal(JSON.parse(insert.params[2]).goal, 'SQL basics', 'the mock reply parsed into an intake');
        });

        it('keeps the unit when an error after the model mentions "API key" (no refund by message)', async () => {
            const pool = createMockPool((sql) => {
                if (sql.startsWith('update curricula')) throw new Error('invalid input syntax for type uuid: "API key GEMINI"');
            });
            setPoolForTests(pool);
            const gateway = fakeCourseGateway();
            setGatewayForTests(gateway);
            const { error } = console;
            console.error = () => {};
            try {
                await withServer(async (base) => {
                    const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL', curriculum_id: DRAFT_ID });
                    assert.equal(gateway.calls.length, 1, 'the model ran');
                    assert.equal(result.status, 500, result.text);
                    assert.deepEqual(result.json, { error: 'Internal server error' });
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    assert.deepEqual(refunds(pool), [], 'still charged');
                });
            } finally {
                console.error = error;
            }
        });

        it('gives the unit back when the gateway fails before any model ran (by LlmError code, not message)', async () => {
            const cases = [
                ['auth', 503],
                ['rate_limited', 429],
                ['provider_unavailable', 503],
                ['no_provider', 503],
            ];
            const { error } = console;
            console.error = () => {};
            try {
                for (const [code, status] of cases) {
                    resetDailyCapsForTests();
                    const pool = createMockPool();
                    setPoolForTests(pool);
                    const gateway = fakeCourseGateway(new LlmError(code, 'Gemini API key sk-ant-SECRET rejected'));
                    setGatewayForTests(gateway);
                    await withServer(async (base) => {
                        const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL', curriculum_id: DRAFT_ID });
                        assert.equal(gateway.calls.length, 1, `${code}: the gateway was called`);
                        assert.equal(result.status, status, `${code}: ${result.text}`);
                        assert.equal(result.json.error_type, code === 'no_provider' ? 'ai_unavailable' : code);
                        assert.ok(!result.text.includes('SECRET'));
                        assert.ok(await waitFor(() => refunds(pool).length > 0), `${code}: refunded`);
                        assert.deepEqual(refunds(pool)[0].params.slice(1), ['course_generation', [DEV_USER, '*']]);
                    });
                }
            } finally {
                console.error = error;
            }
        });

        it('keeps the unit when a model may have produced output (timeout, cut-off, refusal, or an earlier attempt ran)', async () => {
            const cases = [
                [new LlmError('timeout', 'slow'), 504],
                [new LlmError('max_tokens', 'cut off'), 502],
                [new LlmError('refusal', 'no'), 422],
                [new LlmError('rate_limited', 'second provider', { modelRan: true }), 429],
            ];
            const { error } = console;
            console.error = () => {};
            try {
                for (const [failure, status] of cases) {
                    resetDailyCapsForTests();
                    const pool = createMockPool();
                    setPoolForTests(pool);
                    setGatewayForTests(fakeCourseGateway(failure));
                    await withServer(async (base) => {
                        const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL', curriculum_id: DRAFT_ID });
                        assert.equal(result.status, status, `${failure.code}: ${result.text}`);
                        await new Promise((resolve) => setTimeout(resolve, 50));
                        assert.deepEqual(refunds(pool), [], `${failure.code}: still charged`);
                    });
                }
            } finally {
                console.error = error;
            }
        });

        it('answers 503 ai_unavailable without charging when no provider can serve course.generate', async () => {
            process.env.LLM_MOCK_FALLBACK = 'false';
            process.env.GEMINI_API_KEY = 'AIza-test-key'; // set, but GEMINI_ALLOWED is not "true"
            const pool = createMockPool();
            setPoolForTests(pool);
            const { warn } = console;
            console.warn = () => {};
            try {
                await withServer(async (base) => {
                    const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL' });
                    assert.equal(result.status, 503, result.text);
                    assert.equal(result.json.error_type, 'ai_unavailable');
                    assert.deepEqual(pool.usage(), []);
                });
            } finally {
                console.warn = warn;
            }
        });

        it("answers 429 scope 'off' when course generation is turned off", async () => {
            process.env.AI_CAP_USER_COURSE_GENERATION = '0';
            setPoolForTests(createMockPool());
            setGatewayForTests(fakeCourseGateway());
            await withServer(async (base) => {
                assertDailyLimit(await send(`${base}/ai/generate`, { message: 'Teach me SQL' }), 'course_generation', 'off');
            });
        });

        it('approving the saved curriculum runs no model and is not counted', async () => {
            process.env.AI_CAP_USER_COURSE_GENERATION = '0';
            process.env.LLM_MOCK_FALLBACK = 'false';
            const pool = createMockPool();
            setPoolForTests(pool);
            await withServer(async (base) => {
                const approved = await send(`${base}/ai/generate`, { decision: 'approved', stage: 'curriculum', curriculum_id: DRAFT_ID });
                assert.equal(approved.status, 200, approved.text);
                assert.equal(approved.json.status, 'approved');
                assert.deepEqual(pool.usage(), []);
            });
        });
    });

    describe('/agent/chat (shared chat off)', () => {
        it('answers 404 agent_chat_off and charges nothing when VITE_FEATURE_AGENT_CHAT is not "true"', async () => {
            process.env.HERMES_API_KEY = 'hermes-test-key-0123456789';
            process.env.AI_CAP_USER_AGENT_CHAT = '5';
            const pool = createMockPool();
            setPoolForTests(pool);
            await withServer(async (base) => {
                for (const stream of [false, true]) {
                    const result = await send(`${base}/agent/chat`, { ...AGENT_CHAT, stream });
                    assert.equal(result.status, 404, result.text);
                    assert.equal(result.json.error_type, 'agent_chat_off');
                }
            });
            assert.deepEqual(pool.usage(), [], 'nothing was charged');
        });
    });

    describe('/agent/chat (Hermes not configured)', () => {
        // The shared chat is on for these tests (routes/agent.js isAgentChatEnabled).
        beforeEach(() => { process.env.VITE_FEATURE_AGENT_CHAT = 'true'; });

        it('gives the chat back when Hermes is not configured', async () => {
            process.env.AI_CAP_USER_AGENT_CHAT = '1';
            await withServer(async (base) => {
                for (const stream of [false, false, true, true]) {
                    const result = await send(`${base}/agent/chat`, { ...AGENT_CHAT, stream });
                    assert.equal(result.status, 503, result.text);
                    assert.equal(result.json.error_type, 'hermes_not_configured');
                }
            });
        });

        it('answers 429 when agent chat is off, but validation runs first', async () => {
            process.env.AI_CAP_USER_AGENT_CHAT = '0';
            await withServer(async (base) => {
                const invalid = await send(`${base}/agent/chat`, { skill: 'nope' });
                assert.equal(invalid.status, 422);
                assertDailyLimit(await send(`${base}/agent/chat`, AGENT_CHAT), 'agent_chat', 'off');
            });
        });
    });

    describe('/agent/chat (Hermes configured)', () => {
        // The shared chat is on for these tests (routes/agent.js isAgentChatEnabled).
        beforeEach(() => { process.env.VITE_FEATURE_AGENT_CHAT = 'true'; });

        it('gives the chat back when the connection to Hermes is refused', async () => {
            process.env.AI_CAP_USER_AGENT_CHAT = '1';
            process.env.HERMES_API_KEY = 'test-key';
            process.env.HERMES_API_URL = `http://127.0.0.1:${await closedPort()}`;
            await withServer(async (base) => {
                for (const stream of [false, false, true, true]) {
                    const result = await send(`${base}/agent/chat`, { ...AGENT_CHAT, stream });
                    assert.equal(result.status, 503, result.text);
                    assert.equal(result.json.error_type, 'hermes_unreachable');
                }
            });
        });

        /** A stand-in Hermes that answers every request with `status` and an upstream message. */
        const fakeHermes = async (status) => {
            const server = http.createServer((req, res) => {
                req.resume();
                req.on('end', () => {
                    res.writeHead(status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'OpenRouter: key sk-or-SECRET is invalid (/srv/hermes/secret.yaml)' } }));
                });
            });
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            process.env.HERMES_API_URL = `http://127.0.0.1:${server.address().port}`;
            return server;
        };

        it('gives the chat back when Hermes refuses its key (401/403), answers 502, and hides the upstream text', async () => {
            process.env.AI_CAP_USER_AGENT_CHAT = '1';
            process.env.HERMES_API_KEY = 'test-key';
            for (const status of [401, 403]) {
                const hermes = await fakeHermes(status);
                try {
                    await withServer(async (base) => {
                        for (const stream of [false, false, true, true]) {
                            const result = await send(`${base}/agent/chat`, { ...AGENT_CHAT, stream });
                            assert.equal(result.status, 502, `${status}: ${result.text}`);
                            assert.deepEqual(result.json, { error: 'Hermes API error', error_type: 'hermes_api_error' });
                            assert.ok(!result.text.includes('SECRET'));
                        }
                    });
                } finally {
                    await new Promise((resolve) => hermes.close(resolve));
                }
            }
        });

        it('keeps the chat charged for any other Hermes error: 400 answers 502, 429 and 5xx answer 503', async () => {
            process.env.AI_CAP_USER_AGENT_CHAT = '1';
            process.env.HERMES_API_KEY = 'test-key';
            for (const [status, expected] of [[400, 502], [429, 503], [500, 503]]) {
                resetDailyCapsForTests();
                const hermes = await fakeHermes(status);
                try {
                    await withServer(async (base) => {
                        const first = await send(`${base}/agent/chat`, AGENT_CHAT);
                        assert.equal(first.status, expected, `${status}: ${first.text}`);
                        assert.deepEqual(first.json, { error: 'Hermes API error', error_type: 'hermes_api_error' });
                        assertDailyLimit(await send(`${base}/agent/chat`, { ...AGENT_CHAT, stream: true }), 'agent_chat', 'user');
                    });
                } finally {
                    await new Promise((resolve) => hermes.close(resolve));
                }
            }
        });

        it('gives the chat back, and never calls Hermes, when the turn binding cannot be written', async () => {
            process.env.AI_CAP_USER_AGENT_CHAT = '1';
            process.env.HERMES_API_KEY = 'test-key';
            let hermesCalls = 0;
            const hermes = http.createServer((req, res) => {
                hermesCalls += 1;
                req.resume();
                res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"output_text":"should not happen"}');
            });
            await new Promise((resolve) => hermes.listen(0, '127.0.0.1', resolve));
            process.env.HERMES_API_URL = `http://127.0.0.1:${hermes.address().port}`;
            const pool = createMockPool((sql) => {
                if (sql.startsWith('insert into agent_session_binding')) throw new Error('connection terminated unexpectedly');
            });
            setPoolForTests(pool);
            const { error } = console;
            console.error = () => {};
            try {
                await withServer(async (base) => {
                    for (const stream of [false, true]) {
                        const result = await send(`${base}/agent/chat`, { ...AGENT_CHAT, stream });
                        assert.equal(result.status, 503, result.text);
                        assert.deepEqual(result.json, { error: 'Agent session could not be started', error_type: 'agent_session_unavailable' });
                        assert.ok(await waitFor(() => pool.usage().filter((q) => q.sql.startsWith('update ai_daily_usage')).length === (stream ? 2 : 1)), 'refunded');
                    }
                });
                assert.equal(hermesCalls, 0, 'Hermes was never called');
            } finally {
                console.error = error;
                await new Promise((resolve) => hermes.close(resolve));
            }
        });

        it('keeps the chat charged when Hermes drops the connection after the request was sent', async () => {
            process.env.AI_CAP_USER_AGENT_CHAT = '1';
            process.env.HERMES_API_KEY = 'test-key';
            const hermes = net.createServer((socket) => socket.once('data', () => socket.destroy()));
            await new Promise((resolve) => hermes.listen(0, '127.0.0.1', resolve));
            process.env.HERMES_API_URL = `http://127.0.0.1:${hermes.address().port}`;
            try {
                await withServer(async (base) => {
                    const first = await send(`${base}/agent/chat`, AGENT_CHAT);
                    assert.equal(first.status, 503, first.text);
                    assert.equal(first.json.error_type, 'hermes_interrupted');
                    assertDailyLimit(await send(`${base}/agent/chat`, { ...AGENT_CHAT, stream: true }), 'agent_chat', 'user');
                });
            } finally {
                await new Promise((resolve) => hermes.close(resolve));
            }
        });
    });
});
