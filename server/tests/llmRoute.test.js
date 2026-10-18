import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLlmRouter } from '../routes/llm.js';
import aiRoutes from '../routes/ai.js';
import { createGateway, resetGatewayForTests, setGatewayForTests } from '../llm/index.js';
import { PersonalityInsight, WritingFeedback } from '../llm/schemas.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const quietLogger = { info: () => {}, warn: () => {} };

/** Same mount order as server.js: health → llm (optionalAuth) → ai → blanket /api/v2 auth. */
const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v2/llm', optionalAuth, createLlmRouter());
    app.use(['/api/v2/ai/generate', '/api/v2/ai/drafts'], requireAuth);
    app.use('/api/v2/ai', aiRoutes);
    app.use('/api/v2', requireBridgeOrAuth, (_req, _res, next) => next());
    app.use('/api/v2', requireAuth, (_req, res) => res.status(404).json({ error: 'not found' }));
    return app;
};

const withServer = async (handler) => {
    const server = await new Promise((resolve) => {
        const s = buildApp().listen(0, () => resolve(s));
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

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK', 'LLM_MOCK_DELAY_MS', 'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN'];

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
                lesson: { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] },
                anchor: { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書くと伝わりやすい。' },
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

            const sse = await postJson(`${base}/llm/tutor`, { message: 'hi' });
            const events = parseSse(await sse.text());
            assert.equal(events.at(-1).event, 'error');
            assert.equal(events.at(-1).data.error_type, 'no_provider');
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
