import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { createGateway, resetGatewayForTests, setGatewayForTests } from '../llm/index.js';
import { createGuestBudget, createOriginPolicy } from '../llm/guestAccess.js';
import { PersonalityInsight, WritingFeedback } from '../llm/schemas.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const quietLogger = { info: () => {}, warn: () => {} };

/** The real server.js stack (mount order, CORS, limiters, auth), without static files or listen. */
const buildApp = () => createApp({ serveStatic: false });

const LESSON = { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] };
const ANCHOR = { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書くと伝わりやすい。' };

const withServer = async (handler) => {
    const app = await buildApp();
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    try {
        await handler(`http://127.0.0.1:${port}/api/v2`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const postJson = (url, body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
});

/** Parse an SSE body into [{ event, data }]. */
const parseSse = (raw) => raw
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk && !chunk.startsWith(':'))
    .map((chunk) => {
        const event = chunk.match(/^event: (.+)$/m)?.[1];
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        return { event, data: data ? JSON.parse(data) : null };
    });

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK', 'LLM_MOCK_DELAY_MS', 'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'LLM_ALLOWED_ORIGINS', 'LLM_GUEST_DAILY_PER_IP', 'LLM_GUEST_DAILY_TOTAL', 'TRUST_PROXY'];

describe('/api/v2/llm routes (mock provider)', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.LLM_MOCK_DELAY_MS = '0';
        resetGatewayForTests();
        resetPoolForTests();
        setPoolForTests(null);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        resetGatewayForTests();
        resetPoolForTests();
    });

    it('GET /llm/status reports mock:true and no secrets when no keys are set', async () => {
        await withServer(async (base) => {
            const response = await fetch(`${base}/llm/status`);
            assert.equal(response.status, 200);
            const payload = await response.json();
            assert.equal(payload.mock, true);
            assert.equal(payload.providers.anthropic.configured, false);
            assert.equal(payload.providers.gemini.configured, false);
            assert.equal(payload.tasks['tutor.chat'].provider, 'mock');
        });
    });

    it('strict auth mode: GET /llm/status without a token is 200, other /api/v2 paths stay 401', async () => {
        process.env.RISEPATH_STRICT_AUTH = 'true';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak';
        await withServer(async (base) => {
            const response = await fetch(`${base}/llm/status`);
            assert.equal(response.status, 200);
            const text = await response.text();
            assert.ok(!text.includes('should-not-leak'));
            assert.equal(JSON.parse(text).providers.anthropic.configured, true);

            const other = await fetch(`${base}/curricula`);
            assert.equal(other.status, 401);
        });
    });

    it('POST /llm/writing-feedback returns schema-valid feedback', async () => {
        await withServer(async (base) => {
            const response = await postJson(`${base}/llm/writing-feedback`, {
                text: 'I want to learn React because I want to build my own apps for my team.',
                rubric: { clarity: 'State the goal', linking: 'Use because/so', tone: 'Confident' },
                lessonTitle: 'Explaining your motivation',
                locale: 'jp',
            });
            assert.equal(response.status, 200);
            const payload = await response.json();
            assert.equal(payload.ok, true);
            assert.equal(payload.meta.provider, 'mock');
            assert.ok(WritingFeedback.safeParse(payload.data).success);
            assert.match(payload.data.feedback, /[぀-ヿ]/, 'locale jp → Japanese feedback');
        });
    });

    it('POST /llm/writing-feedback validates the body', async () => {
        await withServer(async (base) => {
            const response = await postJson(`${base}/llm/writing-feedback`, { text: 'short', rubric: {} });
            assert.equal(response.status, 400);
            const payload = await response.json();
            assert.equal(payload.error_type, 'invalid_body');
            assert.ok(payload.issues.length > 0);
        });
    });

    it('POST /llm/personality-insight returns a schema-valid insight', async () => {
        await withServer(async (base) => {
            const response = await postJson(`${base}/llm/personality-insight`, {
                scores: { openness: 82, conscientiousness: 55, extraversion: 40, agreeableness: 61, neuroticism: 35 },
                locale: 'en',
            });
            assert.equal(response.status, 200);
            const payload = await response.json();
            assert.ok(PersonalityInsight.safeParse(payload.data).success);
            assert.equal(payload.data.personalityType, 'Curious Explorer');
        });
    });

    it('POST /llm/tutor streams SSE text.delta events then done', async () => {
        await withServer(async (base) => {
            const response = await postJson(`${base}/llm/tutor`, {
                message: 'この部分をもっと簡単に説明して',
                mode: 'explain',
                lesson: LESSON,
                anchor: ANCHOR,
                locale: 'jp',
            });
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type'), /text\/event-stream/);
            const events = parseSse(await response.text());
            assert.equal(events[0].event, 'meta');
            assert.equal(events[0].data.mode, 'explain');
            const deltas = events.filter((e) => e.event === 'text.delta');
            assert.ok(deltas.length > 1, 'answer arrives in several deltas');
            const done = events.at(-1);
            assert.equal(done.event, 'done');
            assert.equal(done.data.provider, 'mock');
            assert.deepEqual(done.data.grounding, { sectionId: 's2', blockId: 'b5' });
            assert.equal(deltas.map((e) => e.data.text).join(''), done.data.text);
            assert.match(done.data.text, /プロンプト/);
        });
    });

    it('POST /llm/tutor is socratic on a quiz before two attempts (hints, no answer)', async () => {
        await withServer(async (base) => {
            const response = await postJson(`${base}/llm/tutor`, {
                message: 'Which option is correct?',
                mode: 'explain',
                lesson: LESSON,
                anchor: { sectionId: 's3', blockId: 'q1', blockType: 'quiz', excerpt: 'What does useState return?' },
                learner: { attemptsOnBlock: 1, chosenOptionId: 'b' },
                locale: 'en',
            });
            const events = parseSse(await response.text());
            assert.equal(events[0].data.mode, 'socratic');
            const done = events.at(-1);
            assert.equal(done.data.mode, 'socratic');
            assert.match(done.data.text, /Hint/);
            assert.match(done.data.text, /\?/);
        });
    });

    it('POST /llm/tutor rejects an excerpt over 1500 characters with 400', async () => {
        await withServer(async (base) => {
            const response = await postJson(`${base}/llm/tutor`, {
                message: 'q',
                anchor: { sectionId: 's', blockId: 'b', blockType: 'markdown', excerpt: 'あ'.repeat(1501) },
            });
            assert.equal(response.status, 400);
        });
    });

    it('returns 503 (JSON) and an SSE error event when no provider is available in production', async () => {
        setGatewayForTests(createGateway({ env: { NODE_ENV: 'production' }, logger: quietLogger }));
        await withServer(async (base) => {
            const json = await postJson(`${base}/llm/personality-insight`, {
                scores: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
            });
            assert.equal(json.status, 503);
            assert.equal((await json.json()).error_type, 'no_provider');

            const sse = await postJson(`${base}/llm/tutor`, { message: 'hi', lesson: LESSON, anchor: ANCHOR });
            const events = parseSse(await sse.text());
            assert.equal(events.at(-1).event, 'error');
            assert.equal(events.at(-1).data.error_type, 'no_provider');
        });
    });

    it('uses the real server.js limiters: the AI limiter covers POST /llm/tutor, not GET /llm/status', async () => {
        await withServer(async (base) => {
            const status = await fetch(`${base}/llm/status`);
            assert.equal(status.headers.get('ratelimit-limit'), '1000', 'global limiter only (dev max)');
            const tutor = await postJson(`${base}/llm/tutor`, { message: 'hi', lesson: LESSON, anchor: ANCHOR });
            assert.equal(tutor.status, 200);
            assert.equal(tutor.headers.get('ratelimit-limit'), '100', 'AI limiter (dev max) on the POST');
            await tutor.text();
        });
    });

    it('answers CORS for the LLM gateway only from app origins, and refuses foreign POSTs', async () => {
        await withServer(async (base) => {
            const preflight = (origin, path = '/llm/tutor') => fetch(`${base}${path}`, {
                method: 'OPTIONS',
                headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
            });
            const evil = await preflight('https://evil.example');
            assert.equal(evil.headers.get('access-control-allow-origin'), null);
            const dev = await preflight('http://localhost:3007');
            assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:3007');
            const otherApi = await preflight('https://evil.example', '/health');
            assert.equal(otherApi.headers.get('access-control-allow-origin'), '*', 'the rest of the API is unchanged');

            const post = await postJson(`${base}/llm/tutor`, { message: 'hi', lesson: LESSON, anchor: ANCHOR }, { Origin: 'https://evil.example' });
            assert.equal(post.status, 403);
            assert.equal((await post.json()).error_type, 'forbidden_origin');
        });
    });

    it('requires lesson + anchor from guests and enforces the guest daily budget', async () => {
        process.env.LLM_GUEST_DAILY_PER_IP = '2';
        await withServer(async (base) => {
            const free = await postJson(`${base}/llm/tutor`, { message: 'Write a haiku about cats' });
            assert.equal(free.status, 400);
            assert.equal((await free.json()).error_type, 'lesson_required');
            const second = await postJson(`${base}/llm/tutor`, { message: 'ok', lesson: LESSON, anchor: ANCHOR });
            assert.equal(second.status, 200);
            await second.text();
            const third = await postJson(`${base}/llm/tutor`, { message: 'ok', lesson: LESSON, anchor: ANCHOR });
            assert.equal(third.status, 429);
            assert.equal((await third.json()).error_type, 'rate_limited');
            assert.ok(Number(third.headers.get('retry-after')) > 0);
        });
    });
});

describe('/api/v2/ai course generator auth', () => {
    const saved = {};
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
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

    it('requires auth in strict mode', async () => {
        process.env.RISEPATH_STRICT_AUTH = 'true';
        await withServer(async (base) => {
            const generate = await postJson(`${base}/ai/generate`, { message: 'Teach me SQL' });
            assert.equal(generate.status, 401);
            const drafts = await fetch(`${base}/ai/drafts`);
            assert.equal(drafts.status, 401);
        });
    });

    it('uses the authenticated (dev fallback) user outside strict mode', async () => {
        process.env.NODE_ENV = 'development';
        await withServer(async (base) => {
            // Passes auth, then stops at the missing database (no PHASE1 user hard-coded in the route).
            const generate = await postJson(`${base}/ai/generate`, { message: 'Teach me SQL' });
            assert.equal(generate.status, 503);
        });
    });
});

describe('guest access helpers', () => {
    it('origin policy: allow-list, same host, dev server; nothing else in production', () => {
        const prod = createOriginPolicy({ env: { NODE_ENV: 'production', LLM_ALLOWED_ORIGINS: 'https://app.example/, https://b.example' } });
        const req = (host) => ({ headers: { host }, app: { get: () => false } });
        assert.equal(prod(undefined, req('api.example')), true);
        assert.equal(prod('https://app.example', req('api.example')), true);
        assert.equal(prod('https://api.example', req('api.example')), true, 'same origin');
        assert.equal(prod('http://localhost:3007', req('api.example')), false);
        assert.equal(prod('https://evil.example', req('api.example')), false);
        assert.equal(prod('not a url', req('api.example')), false);
        const dev = createOriginPolicy({ env: { NODE_ENV: 'development' } });
        assert.equal(dev('http://192.168.1.5:3007', req('localhost:3006')), true);
        assert.equal(dev('https://evil.example', req('localhost:3006')), false);
    });

    it('guest budget: per IP and total, signed-in users skip it, resets each UTC day', () => {
        let now = Date.parse('2026-10-19T10:00:00Z');
        const budget = createGuestBudget({ env: {}, perIp: 2, total: 3, now: () => now });
        const run = (ip, userId = null) => {
            let status = 200;
            let passed = false;
            const res = { set: () => res, status: (code) => { status = code; return res; }, json: () => res };
            budget({ method: 'POST', ip, userId }, res, () => { passed = true; });
            return passed ? 200 : status;
        };
        assert.equal(run('a'), 200);
        assert.equal(run('a'), 200);
        assert.equal(run('a'), 429, 'per-IP cap');
        assert.equal(run('a', 'user-1'), 200, 'signed in: no guest budget');
        assert.equal(run('b'), 200);
        assert.equal(run('c'), 429, 'total cap');
        now = Date.parse('2026-10-20T00:00:01Z');
        assert.equal(run('a'), 200, 'new day');
    });
});
