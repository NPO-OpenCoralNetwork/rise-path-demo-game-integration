// Minor safeguards on the AI routes (server/routes/llm.js, server/routes/ai.js through the real
// server.js stack) and the report route (server/routes/safety.js). Development mode: a Bearer
// token runs as the dev fallback user, and AI_ACCESS_DEV_AUDIENCE sets the audience the access
// gate hands to the routes (server/middleware/aiAccessGate.js; ignored in production).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../../server.js';
import { createGateway, resetGatewayForTests, setGatewayForTests } from '../llm/index.js';
import { LlmError } from '../llm/errors.js';
import { MINOR_SAFETY } from '../llm/prompts/shared.js';
import { createMockProvider } from '../llm/providers/mock.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetDailyCapsForTests } from '../middleware/dailyCaps.js';
import { resetSafetyScreenCacheForTests } from '../safety/moderation.js';
import { resetSafetyEventsForTests } from '../safety/events.js';
import { resetAiAccessForTests } from '../safety/access.js';
import safetyRoutes, { REPORTS_PER_DAY, resetSafetyRoutesForTests } from '../routes/safety.js';

const SIGNED_IN = { Authorization: 'Bearer x' };
const DEV_USER = '00000000-0000-0000-0000-000000000001';
const DRAFT_ID = '11111111-2222-4333-8444-555555555555';
const LESSON = { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] };
const ANCHOR = { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書くと伝わりやすい。' };
const FEEDBACK = {
    text: 'I want to learn React because I want to build my own apps for my team.',
    rubric: { clarity: 'State the goal', linking: 'Use because/so', tone: 'Confident' },
    locale: 'en',
};
const SCORES = { scores: { openness: 60, conscientiousness: 50, extraversion: 40, agreeableness: 70, neuroticism: 30 }, locale: 'ja' };
const ALLOW = { verdict: 'allow', category: 'none', support: 'no' };
const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const ENV_KEYS = [
    'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK', 'LLM_MOCK_DELAY_MS', 'NODE_ENV',
    'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'LLM_ALLOWED_ORIGINS', 'TRUST_PROXY',
    'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI', 'SAFETY_ALERT_WEBHOOK_URL',
    'AI_CAP_ALERT_WEBHOOK_URL', 'SAFETY_BLOCKS_BEFORE_PAUSE',
];

/** A pool that records statements and counts ai_daily_usage reservations as taken. */
function recordingPool(answer = () => undefined) {
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
        refunds: () => queries.filter((q) => q.sql.startsWith('update ai_daily_usage')),
        events: () => queries.filter((q) => q.sql.startsWith('insert into ai_safety_events')).map((q) => ({ kind: q.params[4], category: q.params[5], audience: q.params[2], surface: q.params[3], detail: q.params[6] })),
    };
}

/**
 * The mock provider with a scripted safety screen (`verdict(input)` → verdict or Error, input is
 * { direction, text }) and, optionally, a scripted tutor answer. Records every request.
 */
function scriptedMock({ verdict = () => ALLOW, tutorText = null, courseReply = null } = {}) {
    const real = createMockProvider({ delayMs: 0 });
    const calls = [];
    const factory = () => ({
        id: 'mock',
        async generate(req, route) {
            calls.push(req);
            if (req.task === 'safety.screen') {
                const v = verdict(req.input);
                if (v instanceof Error) throw v;
                return { provider: 'mock', model: 'm', text: JSON.stringify(v), stopReason: 'end', usage: USAGE };
            }
            if (req.task === 'course.generate' && courseReply) {
                return { provider: 'mock', model: 'm', text: JSON.stringify(courseReply), stopReason: 'end', usage: USAGE };
            }
            return real.generate(req, route);
        },
        async *stream(req, route) {
            calls.push(req);
            if (tutorText) {
                for (const chunk of tutorText.match(/[\s\S]{1,6}/g)) yield { type: 'text.delta', text: chunk };
                yield { type: 'done', result: { provider: 'mock', model: 'm', text: tutorText, stopReason: 'end', usage: USAGE } };
                return;
            }
            yield* real.stream(req, route);
        },
    });
    const useIt = () => setGatewayForTests(createGateway({ env: { NODE_ENV: 'development' }, providers: { mock: factory }, logger: { info() {}, warn() {} } }));
    return {
        useIt,
        calls,
        screens: (direction) => calls.filter((r) => r.task === 'safety.screen' && (!direction || r.input.direction === direction)),
        main: () => calls.filter((r) => r.task !== 'safety.screen'),
    };
}

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
};

const post = async (url, body, headers = SIGNED_IN) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* SSE */ }
    return { status: response.status, text, json, headers: response.headers };
};

const parseSse = (raw) => raw.split('\n\n').map((c) => c.trim()).filter((c) => c && !c.startsWith(':')).map((chunk) => ({
    event: chunk.match(/^event: (.+)$/m)?.[1],
    data: JSON.parse(chunk.match(/^data: (.+)$/m)?.[1] ?? 'null'),
}));

/** Wait for fire-and-forget refunds and event writes. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('minor safeguards on the AI routes', () => {
    const saved = {};
    const savedConsole = { warn: console.warn, info: console.info, log: console.log, error: console.error };
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.AI_ACCESS_DEV_AUDIENCE = 'minor';
        resetGatewayForTests();
        resetDailyCapsForTests();
        resetSafetyScreenCacheForTests();
        resetSafetyEventsForTests();
        resetAiAccessForTests();
        pool = recordingPool();
        setPoolForTests(pool);
        console.warn = () => {};
        console.info = () => {};
        console.log = () => {};
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        Object.assign(console, savedConsole);
        resetGatewayForTests();
        resetPoolForTests();
        resetDailyCapsForTests();
    });

    describe('/llm/tutor', () => {
        it("a minor's answer is screened as a whole, then sent as one delta and done", async () => {
            const mock = scriptedMock({ tutorText: 'プロンプトは目的から書きます。次に制約を足しましょう。' });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: 'もっと簡単に説明して', lesson: LESSON, anchor: ANCHOR, locale: 'jp' });
                assert.equal(result.status, 200, result.text);
                const events = parseSse(result.text);
                assert.deepEqual(events.map((e) => e.event), ['meta', 'text.delta', 'done']);
                assert.equal(events[1].data.text, 'プロンプトは目的から書きます。次に制約を足しましょう。');
                assert.equal(events[2].data.text, events[1].data.text);
            });
            assert.equal(mock.screens('input').length, 1);
            assert.equal(mock.screens('output').length, 1);
            const [tutor] = mock.main();
            assert.equal(tutor.audience, 'minor');
            assert.equal(tutor.system.at(-1).text, MINOR_SAFETY, 'the child-safety part is sent last');
            assert.match(mock.screens('input')[0].input.text, /もっと簡単に説明して/);
            assert.match(mock.screens('input')[0].input.text, /目的・制約・例/, 'the excerpt is screened too');
        });

        it('an adult is not screened and still gets the answer in several deltas', async () => {
            process.env.AI_ACCESS_DEV_AUDIENCE = 'adult';
            const mock = scriptedMock({ tutorText: 'An answer that arrives in several small pieces.' });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: 'explain', lesson: LESSON, anchor: ANCHOR });
                const events = parseSse(result.text);
                assert.ok(events.filter((e) => e.event === 'text.delta').length > 1);
                assert.equal(events.at(-1).event, 'done');
            });
            assert.equal(mock.screens().length, 0);
            assert.equal(mock.main()[0].audience, 'adult');
            assert.ok(mock.main()[0].system.every((part) => part.text !== MINOR_SAFETY));
        });

        it('a classifier-blocked input answers 422 JSON before the stream opens, keeps the unit (the classifier ran) and never calls the tutor', async () => {
            const mock = scriptedMock({ verdict: (input) => (input.text.includes('BAD') ? { verdict: 'block', category: 'violence', support: 'no' } : ALLOW) });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: 'BAD words', lesson: LESSON, anchor: ANCHOR });
                assert.equal(result.status, 422);
                assert.match(result.headers.get('content-type'), /application\/json/);
                assert.deepEqual({ ...result.json, error: undefined }, { error: undefined, error_type: 'content_blocked', category: 'violence', support: false });
                await settle();
            });
            assert.equal(mock.main().length, 0);
            assert.equal(pool.refunds().length, 0, 'the classifier call bounds spend through the daily unit');
            assert.deepEqual(pool.events().map((e) => [e.kind, e.category, e.audience, e.surface]), [['input_blocked', 'violence', 'minor', 'tutor']]);
            assert.ok(!JSON.stringify(pool.queries.filter((q) => q.sql.includes('ai_safety_events'))).includes('BAD words'));
        });

        it('a classifier support block keeps the unit charged too, so distress paraphrases cannot loop the classifier for free', async () => {
            const mock = scriptedMock({ verdict: (input) => (input.text.includes('SAD') ? { verdict: 'block', category: 'self_harm', support: 'yes' } : ALLOW) });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: 'SAD paraphrase', lesson: LESSON, anchor: ANCHOR });
                assert.equal(result.status, 422);
                assert.equal(result.json.support, true);
                await settle();
            });
            assert.equal(pool.refunds().length, 0);
            assert.deepEqual(pool.events().map((e) => e.kind), ['support_shown']);
        });

        it('a pre-filter block (no model call) gives the unit back', async () => {
            const mock = scriptedMock();
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: '電話は090-1234-5678です', lesson: LESSON, anchor: ANCHOR });
                assert.equal(result.status, 422);
                assert.equal(result.json.category, 'personal_info');
                await settle();
            });
            assert.equal(mock.calls.length, 0);
            assert.equal(pool.refunds().length, 1);
        });

        it('every free-text field of the prompt is screened: ids, level, block type and code language', async () => {
            const mock = scriptedMock({ verdict: (input) => (input.text.includes('[[mock-block]]') ? { verdict: 'block', category: 'other', support: 'no' } : ALLOW) });
            mock.useIt();
            await withServer(async (base) => {
                const forged = await post(`${base}/llm/tutor`, { message: 'hello', lesson: LESSON, anchor: { ...ANCHOR, sectionId: '[[mock-block]] s2' } });
                assert.equal(forged.status, 422, forged.text);
                assert.equal(forged.json.error_type, 'content_blocked');

                const phone = await post(`${base}/llm/tutor`, {
                    message: 'hello', lesson: { ...LESSON, level: 'x' }, anchor: ANCHOR,
                    learner: { chosenOptionId: 'call me 090-1234-5678' },
                });
                assert.equal(phone.status, 422);
                assert.equal(phone.json.category, 'personal_info');
                await settle();
            });
            assert.equal(mock.main().length, 0);
            const screened = mock.screens('input')[0].input.text;
            assert.match(screened, /\[\[mock-block\]\] s2/);
        });

        it("a sample phone number or email in an earlier AI answer is not the learner's input: no pre-filter block", async () => {
            const mock = scriptedMock({ tutorText: 'ハイフンなしは \\d{11} で書けます。' });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, {
                    message: 'ありがとう！次はハイフンなしも通すには？', lesson: LESSON, anchor: ANCHOR,
                    history: [
                        { role: 'user', content: '携帯電話番号かどうかを調べる正規表現を教えて' },
                        { role: 'assistant', content: "090-1234-5678 のような番号に合います。SELECT * FROM users WHERE email = 'hanako@gmail.com';" },
                    ],
                });
                assert.equal(result.status, 200, result.text);
                assert.equal(parseSse(result.text).at(-1).event, 'done');
                await settle();
            });
            assert.equal(mock.main().length, 1);
            assert.deepEqual(pool.events(), []);
            assert.match(mock.screens('input')[0].input.text, /090-1234-5678/, 'the classifier still screens the earlier answer');
        });

        it('distress in a history turn: 422 with support, no model call at all, a support_shown event', async () => {
            const mock = scriptedMock();
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, {
                    message: '続きを教えて', lesson: LESSON, anchor: ANCHOR,
                    history: [{ role: 'user', content: 'もう消えたい' }, { role: 'assistant', content: 'ok' }],
                });
                assert.equal(result.status, 422);
                assert.equal(result.json.support, true);
                assert.equal(result.json.category, 'self_harm');
                await settle();
            });
            assert.equal(mock.calls.length, 0);
            assert.deepEqual(pool.events().map((e) => e.kind), ['support_shown']);
        });

        it('a held-back answer ends with the error event (content_blocked) and keeps the unit charged', async () => {
            const mock = scriptedMock({
                tutorText: 'This answer is UNSAFE for children.',
                verdict: (input) => (input.direction === 'output' && input.text.includes('UNSAFE') ? { verdict: 'block', category: 'sexual', support: 'no' } : ALLOW),
            });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: 'tell me', lesson: LESSON, anchor: ANCHOR });
                assert.equal(result.status, 200);
                const events = parseSse(result.text);
                assert.deepEqual(events.map((e) => e.event), ['meta', 'error']);
                assert.equal(events[1].data.error_type, 'content_blocked');
                assert.equal(events[1].data.category, 'sexual');
                assert.equal(events[1].data.support, false);
                assert.ok(!result.text.includes('UNSAFE'), 'no part of the answer reached the learner');
                await settle();
            });
            assert.equal(pool.refunds().length, 0);
            assert.deepEqual(pool.events().map((e) => e.kind), ['output_blocked']);
        });

        it('fails closed: a failed input check answers 503 and refunds; a failed output check sends the error event', async () => {
            const failInput = scriptedMock({ verdict: () => new LlmError('provider_unavailable', 'down') });
            failInput.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: 'hi', lesson: LESSON, anchor: ANCHOR });
                assert.equal(result.status, 503);
                assert.equal(result.json.error_type, 'safety_check_unavailable');
                await settle();
            });
            assert.equal(failInput.main().length, 0);
            assert.equal(pool.refunds().length, 1);

            resetSafetyScreenCacheForTests();
            const failOutput = scriptedMock({ tutorText: 'fine answer', verdict: (input) => (input.direction === 'output' ? new LlmError('timeout', 'slow') : ALLOW) });
            failOutput.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/tutor`, { message: 'hello again', lesson: LESSON, anchor: ANCHOR });
                const events = parseSse(result.text);
                assert.deepEqual(events.map((e) => e.event), ['meta', 'error']);
                assert.equal(events[1].data.error_type, 'safety_check_unavailable');
                assert.ok(!result.text.includes('fine answer'));
            });
        });
    });

    describe('/llm/writing-feedback and /llm/personality-insight', () => {
        it('writing feedback: the input is screened (422 on a block, unit kept after a classifier call), the result before it is returned', async () => {
            const mock = scriptedMock({ verdict: (input) => (input.text.includes('BAD') ? { verdict: 'block', category: 'hate', support: 'no' } : ALLOW) });
            mock.useIt();
            await withServer(async (base) => {
                const blocked = await post(`${base}/llm/writing-feedback`, { ...FEEDBACK, goal: 'BAD goal text' });
                assert.equal(blocked.status, 422);
                assert.equal(blocked.json.category, 'hate');
                await settle();
                assert.equal(pool.refunds().length, 0);
                assert.equal(mock.main().length, 0);

                const ok = await post(`${base}/llm/writing-feedback`, FEEDBACK);
                assert.equal(ok.status, 200, ok.text);
                assert.equal(mock.main()[0].audience, 'minor');
                assert.equal(mock.screens('output').length, 1);
                assert.match(mock.screens('output')[0].input.text, new RegExp(ok.json.data.feedback.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            });
        });

        it('writing feedback: a held-back result answers 422 and keeps the unit', async () => {
            const mock = scriptedMock({ verdict: (input) => (input.direction === 'output' ? { verdict: 'block', category: 'other', support: 'no' } : ALLOW) });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/writing-feedback`, FEEDBACK);
                assert.equal(result.status, 422);
                assert.equal(result.json.error_type, 'content_blocked');
                assert.equal(result.json.data, undefined);
                await settle();
            });
            assert.equal(pool.refunds().length, 0);
            assert.deepEqual(pool.events().map((e) => e.kind), ['output_blocked']);
        });

        it('personality insight: no text input to screen; the insight is screened before it is returned', async () => {
            const mock = scriptedMock();
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/llm/personality-insight`, SCORES);
                assert.equal(result.status, 200, result.text);
            });
            assert.equal(mock.screens('input').length, 0);
            assert.equal(mock.screens('output').length, 1);
            assert.equal(mock.main()[0].audience, 'minor');
            assert.equal(mock.main()[0].system.at(-1).text, MINOR_SAFETY);
        });

        it('GET /llm/status stays public: no token, no age, no gate', async () => {
            await withServer(async (base) => {
                const response = await fetch(`${base}/llm/status`);
                assert.equal(response.status, 200);
                assert.ok((await response.json()).tasks['safety.screen']);
            });
        });
    });

    describe('/ai/generate (course generation)', () => {
        const curriculaWrites = () => pool.queries.filter((q) => /^(insert into curricula|update curricula)/.test(q.sql));

        it('a blocked topic answers 422, keeps the unit (the classifier ran), calls no model and saves nothing', async () => {
            const mock = scriptedMock({ verdict: (input) => (input.text.includes('BAD') ? { verdict: 'block', category: 'dangerous', support: 'no' } : ALLOW) });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/ai/generate`, { message: 'BAD topic' });
                assert.equal(result.status, 422, result.text);
                assert.equal(result.json.error_type, 'content_blocked');
                assert.equal(result.json.category, 'dangerous');
                await settle();
            });
            assert.equal(mock.main().length, 0);
            assert.equal(pool.refunds().length, 0);
            assert.deepEqual(curriculaWrites(), []);
        });

        it('a held-back stage result answers 422, keeps the unit and is never written to curricula', async () => {
            const mock = scriptedMock({
                courseReply: { message: 'Plan with UNSAFE content', intake: { goal: 'x' } },
                verdict: (input) => (input.direction === 'output' && input.text.includes('UNSAFE') ? { verdict: 'block', category: 'violence', support: 'no' } : ALLOW),
            });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/ai/generate`, { message: 'Teach me fractions', curriculum_id: DRAFT_ID });
                assert.equal(result.status, 422, result.text);
                assert.equal(result.json.category, 'violence');
                await settle();
            });
            assert.equal(mock.main().length, 1);
            assert.equal(mock.main()[0].audience, 'minor');
            assert.equal(pool.refunds().length, 0);
            assert.deepEqual(curriculaWrites(), []);
            assert.deepEqual(pool.events().map((e) => [e.kind, e.surface]), [['output_blocked', 'course_generation']]);
        });

        it('an allowed stage is saved as before', async () => {
            const mock = scriptedMock({ courseReply: { message: 'Plan for fractions', intake: { goal: 'fractions' } } });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/ai/generate`, { message: 'Teach me fractions', curriculum_id: DRAFT_ID });
                assert.equal(result.status, 200, result.text);
                assert.equal(result.json.message, 'Plan for fractions');
            });
            assert.equal(curriculaWrites().length, 1);
            assert.equal(mock.screens('input').length, 1);
            assert.equal(mock.screens('output').length, 1);
        });

        it('a revision: the feedback is screened before the roadmap model runs', async () => {
            pool = recordingPool((sql) => (sql.startsWith('select intake_json from curricula') ? { rowCount: 1, rows: [{ intake_json: { goal: 'fractions' } }] } : undefined));
            setPoolForTests(pool);
            const mock = scriptedMock({ verdict: (input) => (input.text.includes('BAD') ? { verdict: 'block', category: 'bullying', support: 'no' } : ALLOW) });
            mock.useIt();
            await withServer(async (base) => {
                const result = await post(`${base}/ai/generate`, { decision: 'revise', stage: 'roadmap', message: 'BAD feedback', curriculum_id: DRAFT_ID });
                assert.equal(result.status, 422, result.text);
                await settle();
            });
            assert.equal(mock.main().length, 0);
            assert.equal(pool.refunds().length, 0, 'the classifier ran, so the unit stays charged');
        });
    });
});

describe('POST /api/v2/safety/reports', () => {
    const savedEnv = {};
    const savedConsole = { warn: console.warn, info: console.info };
    const REPORT = { surface: 'tutor', reason: 'harmful', answer: 'The AI said something odd.', question: 'What is 2+2?', note: 'Please check', context: { courseId: 'vibe', lessonId: 'ch1', blockId: 'b5' } };

    const withReports = async (handler, userId = DEV_USER) => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.userId = req.get('x-test-user') === 'none' ? null : userId;
            next();
        });
        app.use('/api/v2/safety', safetyRoutes);
        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        try {
            await handler(`http://127.0.0.1:${server.address().port}/api/v2/safety`);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    };

    beforeEach(() => {
        for (const key of ['NODE_ENV', 'AI_ACCESS_DEV_AUDIENCE', 'SAFETY_ALERT_WEBHOOK_URL', 'AI_CAP_ALERT_WEBHOOK_URL']) savedEnv[key] = process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.AI_ACCESS_DEV_AUDIENCE = 'minor';
        delete process.env.SAFETY_ALERT_WEBHOOK_URL;
        delete process.env.AI_CAP_ALERT_WEBHOOK_URL;
        resetSafetyRoutesForTests();
        resetSafetyEventsForTests();
        console.warn = () => {};
        console.info = () => {};
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        Object.assign(console, savedConsole);
        resetPoolForTests();
    });

    it('stores a report with its text (detail) and the reporter, and answers 201', async () => {
        const pool = recordingPool();
        setPoolForTests(pool);
        await withReports(async (base) => {
            const result = await post(`${base}/reports`, REPORT, {});
            assert.equal(result.status, 201, result.text);
            assert.deepEqual(result.json, { ok: true });
        });
        const insert = pool.queries.find((q) => q.sql.startsWith('insert into ai_safety_events'));
        assert.equal(insert.params[0], DEV_USER);
        assert.equal(insert.params[1], null, 'no copy of the user id in subject: it would survive account deletion');
        assert.equal(insert.params[2], 'minor', 'the reporter audience, for triage');
        assert.equal(insert.params[3], 'tutor');
        assert.equal(insert.params[4], 'user_report');
        assert.equal(insert.params[5], 'harmful');
        assert.deepEqual(JSON.parse(insert.params[6]), { reason: 'harmful', answer: REPORT.answer, question: REPORT.question, note: REPORT.note, context: REPORT.context });
    });

    it('validates the body: surface, reason and the text caps', async () => {
        setPoolForTests(recordingPool());
        await withReports(async (base) => {
            for (const body of [
                {},
                { ...REPORT, surface: 'chat' },
                { ...REPORT, reason: 'boring' },
                { ...REPORT, answer: '' },
                { ...REPORT, answer: 'a'.repeat(4001) },
                { ...REPORT, question: 'q'.repeat(2001) },
                { ...REPORT, note: 'n'.repeat(501) },
            ]) {
                const result = await post(`${base}/reports`, body, {});
                assert.equal(result.status, 400, JSON.stringify(body).slice(0, 60));
                assert.equal(result.json.error_type, 'invalid_body');
            }
        });
    });

    it('needs a signed-in user', async () => {
        await withReports(async (base) => {
            const result = await post(`${base}/reports`, REPORT, { 'x-test-user': 'none' });
            assert.equal(result.status, 401);
        });
    });

    it(`allows ${REPORTS_PER_DAY} reports per user per Japan-time day, then 429 report_limit`, async () => {
        let count = REPORTS_PER_DAY - 1;
        const pool = recordingPool((sql, params) => {
            if (sql.startsWith('select count(*)::int as n from ai_safety_events')) {
                assert.equal(params[0], DEV_USER);
                assert.equal(params[1], 'user_report');
                assert.match(params[2], /T15:00:00\.000Z$/, 'counted from 00:00 JST');
                return { rowCount: 1, rows: [{ n: count }] };
            }
            return undefined;
        });
        setPoolForTests(pool);
        await withReports(async (base) => {
            assert.equal((await post(`${base}/reports`, REPORT, {})).status, 201);
            count = REPORTS_PER_DAY;
            const limited = await post(`${base}/reports`, REPORT, {});
            assert.equal(limited.status, 429);
            assert.equal(limited.json.error_type, 'report_limit');
        });
    });

    it('without a database: counted in memory outside production, 503 in production', async () => {
        setPoolForTests(null);
        await withReports(async (base) => {
            for (let i = 0; i < REPORTS_PER_DAY; i += 1) assert.equal((await post(`${base}/reports`, REPORT, {})).status, 201);
            assert.equal((await post(`${base}/reports`, REPORT, {})).status, 429);
        });
        process.env.NODE_ENV = 'production';
        await withReports(async (base) => {
            const result = await post(`${base}/reports`, REPORT, {});
            assert.equal(result.status, 503);
            assert.equal(result.json.error_type, 'reports_unavailable');
        });
    });

    it('answers 503 when the report cannot be written', async () => {
        setPoolForTests(recordingPool((sql) => {
            if (sql.startsWith('insert into ai_safety_events')) throw new Error('db down');
            return undefined;
        }));
        const savedError = console.error;
        console.error = () => {};
        try {
            await withReports(async (base) => {
                const result = await post(`${base}/reports`, REPORT, {});
                assert.equal(result.status, 503);
            });
        } finally {
            console.error = savedError;
        }
    });
});
