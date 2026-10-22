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
import { setGenAIForTests } from '../services/aiGenerator.js';
import { setImageClientForTests } from '../geminiBackendService.js';

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
    'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK',
    'LLM_MOCK_DELAY_MS', 'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1',
    'RISE_PATH_BRIDGE_TOKEN', 'LLM_ALLOWED_ORIGINS', 'LLM_GUEST_DAILY_PER_IP', 'LLM_GUEST_DAILY_TOTAL', 'TRUST_PROXY',
    'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'HERMES_API_KEY', 'HERMES_API_URL', 'AI_CAP_ALERT_WEBHOOK_URL', ...CAP_KEYS,
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

/** Fake @google/genai client for the course generator; records each generateContent call. */
const fakeGenAI = (reply = { message: 'Here is a plan.', intake: { goal: 'SQL basics' } }) => {
    const calls = [];
    return {
        calls,
        models: {
            async generateContent(params) {
                calls.push(params);
                return { text: JSON.stringify(reply) };
            },
        },
    };
};

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
        resetGatewayForTests();
        resetPoolForTests();
        setPoolForTests(null);
        resetDailyCapsForTests();
        setGenAIForTests(null);
        setImageClientForTests(null);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        resetGatewayForTests();
        resetPoolForTests();
        resetDailyCapsForTests();
        setGenAIForTests(null);
        setImageClientForTests(null);
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

        it('gives the image back when the Gemini key is missing', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
            const prompt = `daily cap test ${Date.now()} ${Math.random()}`;
            await withServer(async (base) => {
                for (let i = 0; i < 2; i += 1) {
                    const result = await send(`${base}/image`, { prompt, aspect_ratio: '16:9', image_size: '1K' });
                    assert.equal(result.status, 500, `attempt ${i + 1} is not 429`);
                    assert.deepEqual(result.json, { error: 'Image generation failed', error_type: 'image_failed' });
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

        it('gives the image back when Gemini refuses the key (400, 401, 403) or rate limits (429, answered 503); no provider text', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
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

        it('keeps the image charged when Gemini fails after accepting the call (500)', async () => {
            process.env.AI_CAP_USER_IMAGE = '1';
            setImageClientForTests(failingImageClient(500));
            await withServer(async (base) => {
                const first = await send(`${base}/image`, { prompt: `server error ${Math.random()}` });
                assert.equal(first.status, 500);
                assert.deepEqual(first.json, { error: 'Image generation failed', error_type: 'image_failed' });
                assertDailyLimit(await send(`${base}/image`, { prompt: `server error ${Math.random()}` }), 'image', 'user');
            });
        });

        it("answers 429 scope 'off' when image generation is turned off", async () => {
            process.env.AI_CAP_USER_IMAGE = '0';
            await withServer(async (base) => {
                assertDailyLimit(await send(`${base}/image`, { prompt: `daily cap off ${Date.now()}` }), 'image', 'off');
            });
        });
    });

    describe('/upload and /rag/index', () => {
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
            const uploads = path.join(ROOT, 'public/uploads');
            const stored = fs.existsSync(uploads) ? fs.readdirSync(uploads).filter((file) => file.endsWith(name)) : [];
            assert.deepEqual(stored, [], 'nothing was written');
        });

        it('keeps the unit when the stored file cannot be read, so the cap still bounds stored files', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '1';
            // ai_daily_usage counted as Postgres does: RESERVE_SQL takes a slot while count < $4, REFUND_SQL gives one back.
            const counts = new Map();
            const mock = createMockPool((sql) => (sql.startsWith('insert into materials')
                ? { rowCount: 1, rows: [{ id: DRAFT_ID, status: 'uploaded' }] }
                : undefined));
            setPoolForTests({
                ...mock,
                async query(sql, params = []) {
                    const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
                    if (text.startsWith('insert into ai_daily_usage')) {
                        const key = params.slice(0, 3).join('|');
                        const count = counts.get(key) ?? 0;
                        if (count >= params[3]) return { rowCount: 0, rows: [] };
                        counts.set(key, count + 1);
                        return { rowCount: 1, rows: [{ count: count + 1 }] };
                    }
                    if (text.startsWith('update ai_daily_usage')) {
                        for (const subject of params[2]) {
                            const key = `${params[0]}|${params[1]}|${subject}`;
                            counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
                        }
                        return { rowCount: 1, rows: [] };
                    }
                    return mock.query(sql, params);
                },
            });
            const name = `daily-cap-unreadable-${Date.now()}.pdf`;
            const upload = (base) => {
                const form = new FormData();
                form.append('file', new Blob(['not a PDF'], { type: 'application/pdf' }), name);
                return fetch(`${base}/upload`, { method: 'POST', body: form });
            };
            const uploads = path.join(ROOT, 'public/uploads');
            try {
                await withServer(async (base) => {
                    const first = await upload(base);
                    assert.equal(first.status, 200);
                    assert.equal((await first.json()).status, 'uploaded', 'the text could not be read');
                    const second = await upload(base);
                    const json = await second.json();
                    assertDailyLimit({ status: second.status, json, text: JSON.stringify(json), headers: second.headers }, 'embeddings', 'user');
                });
            } finally {
                for (const file of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) {
                    if (file.endsWith(name)) fs.unlinkSync(path.join(uploads, file));
                }
            }
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

        it('refuses a file over 10 MB with 413 and gives the unit back; one file per request', async () => {
            process.env.AI_CAP_USER_EMBEDDINGS = '1';
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
            const uploads = path.join(ROOT, 'public/uploads');
            const stored = fs.existsSync(uploads) ? fs.readdirSync(uploads).filter((file) => file.endsWith(name)) : [];
            assert.deepEqual(stored, [], 'multer removed the partial files');
        });
    });

    describe('/ai/generate', () => {
        it('charges a stage call, refunds a 400 sent before Gemini, and checks the database counters', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            const gemini = fakeGenAI();
            setGenAIForTests(gemini);
            await withServer(async (base) => {
                const missing = await send(`${base}/ai/generate`, { stage: 'requirements' });
                assert.equal(missing.status, 400, missing.text);
                const reserved = pool.usage().filter((q) => q.sql.startsWith('insert into ai_daily_usage'));
                assert.deepEqual(reserved.map((q) => [q.params[1], q.params[2]]), [
                    ['course_generation', DEV_USER],
                    ['course_generation', '*'],
                ]);
                assert.ok(pool.queries.some((q) => q.sql.startsWith('select role from user_profiles')));
                assert.ok(await waitFor(() => pool.usage().some((q) => q.sql.startsWith('update ai_daily_usage'))), 'the 400 was refunded');
                const refund = pool.usage().find((q) => q.sql.startsWith('update ai_daily_usage'));
                assert.deepEqual(refund.params.slice(1), ['course_generation', [DEV_USER, '*']]);
                assert.equal(gemini.calls.length, 0);
            });
        });

        it('rejects a non-UUID curriculum_id or a bad message with 400 before charging or calling Gemini', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            const gemini = fakeGenAI();
            setGenAIForTests(gemini);
            await withServer(async (base) => {
                for (const body of [
                    { message: 'Teach me SQL', curriculum_id: 'API key' },
                    { message: 'Teach me SQL', curriculum_id: 'GEMINI' },
                    { decision: 'approved', stage: 'roadmap', curriculum_id: 'c1' },
                    { message: 'x'.repeat(4001) },
                    { decision: 'revise', stage: 'requirements', message: 'y'.repeat(4001), curriculum_id: DRAFT_ID },
                    { message: { text: 'Teach me SQL' } },
                ]) {
                    const result = await send(`${base}/ai/generate`, body);
                    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
                    assert.equal(result.json.error_type, 'invalid_body');
                }
                assert.deepEqual(pool.usage(), [], 'nothing was charged');
                assert.equal(gemini.calls.length, 0, 'Gemini was not called');
            });
        });

        it('keeps the unit when an error after Gemini mentions "API key" (no refund by message)', async () => {
            const pool = createMockPool((sql) => {
                if (sql.startsWith('update curricula')) throw new Error('invalid input syntax for type uuid: "API key GEMINI"');
            });
            setPoolForTests(pool);
            const gemini = fakeGenAI();
            setGenAIForTests(gemini);
            await withServer(async (base) => {
                const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL', curriculum_id: DRAFT_ID });
                assert.equal(gemini.calls.length, 1, 'Gemini ran');
                assert.equal(result.status, 503, result.text);
                await new Promise((resolve) => setTimeout(resolve, 50));
                assert.ok(!pool.usage().some((q) => q.sql.startsWith('update ai_daily_usage')), 'still charged');
            });
        });

        it('gives the unit back when Gemini refuses the key (by status, not message)', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            const calls = [];
            setGenAIForTests({
                models: {
                    async generateContent(params) {
                        calls.push(params);
                        throw Object.assign(new Error('Forbidden'), { status: 403 });
                    },
                },
            });
            await withServer(async (base) => {
                const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL', curriculum_id: DRAFT_ID });
                assert.equal(calls.length, 1, 'Gemini was called');
                assert.equal(result.status, 500, result.text);
                assert.ok(await waitFor(() => pool.usage().some((q) => q.sql.startsWith('update ai_daily_usage'))), 'refunded');
                const refund = pool.usage().find((q) => q.sql.startsWith('update ai_daily_usage'));
                assert.deepEqual(refund.params.slice(1), ['course_generation', [DEV_USER, '*']]);
            });
        });

        it('answers 503 without charging when no Gemini key is set', async () => {
            const pool = createMockPool();
            setPoolForTests(pool);
            await withServer(async (base) => {
                const result = await send(`${base}/ai/generate`, { message: 'Teach me SQL' });
                assert.equal(result.status, 503, result.text);
                assert.equal(result.json.error_type, 'ai_unavailable');
                assert.deepEqual(pool.usage(), []);
            });
        });

        it("answers 429 scope 'off' when course generation is turned off", async () => {
            process.env.AI_CAP_USER_COURSE_GENERATION = '0';
            setPoolForTests(createMockPool());
            setGenAIForTests(fakeGenAI());
            await withServer(async (base) => {
                assertDailyLimit(await send(`${base}/ai/generate`, { message: 'Teach me SQL' }), 'course_generation', 'off');
            });
        });

        it('approving the saved curriculum runs no model and is not counted', async () => {
            process.env.AI_CAP_USER_COURSE_GENERATION = '0';
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

    describe('/agent/chat (Hermes not configured)', () => {
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
