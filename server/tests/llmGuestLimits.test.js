// Guest tutor limits and the guest daily budget (server/llm/guestAccess.js, server/routes/llm.js):
// - thinking tokens count against max_tokens, so a reply cut off after visible text finishes as
//   `done` with `truncated: true`, not as an error the reader shows as "interrupted";
// - the guest budget is charged only for requests that pass validation and the lesson check,
//   and given back when the call fails before any model ran.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../server.js';
import { createGateway, resetGatewayForTests, setGatewayForTests } from '../llm/index.js';
import { LlmError } from '../llm/errors.js';
import { GUEST_TUTOR_LIMITS, createGuestBudget, refundGuestBudget } from '../llm/guestAccess.js';
import { resolveTaskRoute } from '../llm/models.config.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const quietLogger = { info: () => {}, warn: () => {} };
const userMessage = [{ role: 'user', content: 'hello' }];
const LESSON = { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] };
const ANCHOR = { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書くと伝わりやすい。' };
const SCORES = { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 };

/** Minimal Anthropic Messages API stand-in that records requests. */
async function withFakeAnthropic(respond, handler) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : null;
            requests.push({ url: req.url, headers: req.headers, body });
            respond({ body, res });
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        await handler(`http://127.0.0.1:${port}`, requests);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

/**
 * Stream an Anthropic reply: an optional thinking block, then the text chunks, then stop_reason.
 * @param {{ text?: string[], thinking?: boolean, stopReason: string }} reply
 */
const streamReply = ({ text = [], thinking = false, stopReason }) => ({ body, res }) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    send('message_start', {
        message: {
            id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [],
            stop_reason: null, stop_sequence: null, stop_details: null,
            usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
    });
    let index = 0;
    if (thinking) {
        send('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        send('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig' } });
        send('content_block_stop', { index });
        index += 1;
    }
    if (text.length) {
        send('content_block_start', { index, content_block: { type: 'text', text: '' } });
        for (const chunk of text) send('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } });
        send('content_block_stop', { index });
    }
    send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 4096 } });
    send('message_stop', {});
    res.end();
};

const anthropicEnv = (baseUrl) => ({ ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_BASE_URL: baseUrl, LLM_MAX_RETRIES: '0' });

const collect = async (iterable) => {
    const events = [];
    for await (const event of iterable) events.push(event);
    return events;
};

describe('truncated replies (thinking counts against max_tokens)', () => {
    it('Anthropic: max_tokens after visible text ends with done + truncated, not an error', async () => {
        await withFakeAnthropic(streamReply({ thinking: true, text: ['プロンプトは', '目的から'], stopReason: 'max_tokens' }), async (baseUrl) => {
            const gateway = createGateway({ env: anthropicEnv(baseUrl), logger: quietLogger });
            const events = await collect(gateway.stream({ task: 'tutor.chat', messages: userMessage }));
            assert.deepEqual(events.map((e) => e.type), ['text.delta', 'text.delta', 'done']);
            const { result } = events.at(-1);
            assert.equal(result.text, 'プロンプトは目的から');
            assert.equal(result.truncated, true);
            assert.equal(result.stopReason, 'max_tokens');
            assert.equal(result.provider, 'anthropic');
            assert.equal(result.usage.outputTokens, 4096);
        });
    });

    it('Anthropic: max_tokens before any visible text (thinking used it all) is still a max_tokens error', async () => {
        await withFakeAnthropic(streamReply({ thinking: true, stopReason: 'max_tokens' }), async (baseUrl) => {
            const gateway = createGateway({ env: anthropicEnv(baseUrl), logger: quietLogger });
            const events = await collect(gateway.stream({ task: 'tutor.chat', messages: userMessage }));
            assert.deepEqual(events.map((e) => e.type), ['error']);
            assert.equal(events[0].error.code, 'max_tokens');
        });
    });

    it('Anthropic: a normal end_turn reply has no truncated flag', async () => {
        await withFakeAnthropic(streamReply({ text: ['Hi'], stopReason: 'end_turn' }), async (baseUrl) => {
            const gateway = createGateway({ env: anthropicEnv(baseUrl), logger: quietLogger });
            const events = await collect(gateway.stream({ task: 'tutor.chat', messages: userMessage }));
            assert.equal(events.at(-1).type, 'done');
            assert.equal(events.at(-1).result.truncated, undefined);
            assert.equal(events.at(-1).result.stopReason, 'end');
        });
    });

    it('gateway fallback: a custom provider that throws max_tokens after text still ends with done + truncated', async () => {
        const factory = () => ({
            id: 'gemini',
            async generate() { throw new Error('not used'); },
            async *stream() {
                yield { type: 'text.delta', text: 'Part one, ' };
                yield { type: 'text.delta', text: 'part two' };
                throw new LlmError('max_tokens', 'Gemini reply hit the output limit', { provider: 'gemini', model: 'gemini-x', retryable: false });
            },
        });
        const gateway = createGateway({ env: { GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true', LLM_PROVIDER: 'gemini' }, providers: { gemini: factory }, logger: quietLogger });
        const events = await collect(gateway.stream({ task: 'tutor.chat', messages: userMessage }));
        assert.deepEqual(events.map((e) => e.type), ['text.delta', 'text.delta', 'done']);
        assert.equal(events.at(-1).result.text, 'Part one, part two');
        assert.equal(events.at(-1).result.truncated, true);
        assert.equal(events.at(-1).result.provider, 'gemini');
    });

    it('Gemini (real provider, SDK over a stubbed fetch): text in the MAX_TOKENS chunk is kept and the reply ends truncated', async () => {
        const realFetch = globalThis.fetch;
        let chunks = [];
        globalThis.fetch = async (url, init) => {
            if (!String(url).includes('generativelanguage')) return realFetch(url, init);
            const body = chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join('');
            return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
        const part = (text, finishReason) => ({ candidates: [{ content: { role: 'model', parts: text ? [{ text }] : [] }, ...(finishReason ? { finishReason } : {}) }] });
        const run = () => collect(createGateway({ env: { GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true', LLM_PROVIDER: 'gemini' }, logger: quietLogger })
            .stream({ task: 'tutor.chat', messages: userMessage }));
        try {
            chunks = [part('Part one, '), { ...part('last part', 'MAX_TOKENS'), usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, thoughtsTokenCount: 4000 } }];
            let events = await run();
            assert.deepEqual(events.map((e) => e.type), ['text.delta', 'text.delta', 'done']);
            let { result } = events.at(-1);
            assert.equal(result.text, 'Part one, last part', 'the last chunk\'s text is not lost');
            assert.equal(result.truncated, true);
            assert.equal(result.stopReason, 'max_tokens');
            assert.equal(result.usage.outputTokens, 4010, 'real usage, not zeros');

            chunks = [part('Whole answer in one chunk', 'MAX_TOKENS')];
            events = await run();
            assert.deepEqual(events.map((e) => e.type), ['text.delta', 'done']);
            ({ result } = events.at(-1));
            assert.equal(result.text, 'Whole answer in one chunk');
            assert.equal(result.truncated, true);

            chunks = [part('', 'MAX_TOKENS')];
            events = await run();
            assert.deepEqual(events.map((e) => [e.type, e.error?.code]), [['error', 'max_tokens']], 'thinking used it all: nothing to keep');

            chunks = [part('blocked text', 'SAFETY')];
            events = await run();
            assert.deepEqual(events.map((e) => [e.type, e.error?.code]), [['error', 'refusal']], 'blocked text is never shown');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('leaves room for thinking: tutor max_tokens is at least 4096 for everyone, guests stay at low effort', () => {
        assert.ok(GUEST_TUTOR_LIMITS.maxTokens >= 4096);
        assert.equal(GUEST_TUTOR_LIMITS.effort, 'low');
        assert.ok(resolveTaskRoute('tutor.chat', {}).maxTokens >= GUEST_TUTOR_LIMITS.maxTokens, 'signed-in limit is not below the guest limit');
    });
});

// ---------------------------------------------------------------------------------------------

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK', 'LLM_MOCK_DELAY_MS', 'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'LLM_ALLOWED_ORIGINS', 'LLM_GUEST_DAILY_PER_IP', 'LLM_GUEST_DAILY_TOTAL', 'TRUST_PROXY', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'LLM_GUEST_AI', 'AI_ACCESS_DEV_AUDIENCE'];

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
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

const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const parseSse = (raw) => raw
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk && !chunk.startsWith(':'))
    .map((chunk) => ({ event: chunk.match(/^event: (.+)$/m)?.[1], data: JSON.parse(chunk.match(/^data: (.+)$/m)?.[1] ?? 'null') }));

describe('/api/v2/llm guest tutor and guest budget', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.LLM_MOCK_DELAY_MS = '0';
        // These cases exercise anonymous calls: guests may use AI only with LLM_GUEST_AI=true
        // (server/middleware/aiAccessGate.js); signed-in callers without a pool count as adults.
        process.env.LLM_GUEST_AI = 'true';
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

    it('guest tutor: max_tokens leaves room for thinking, answer kept short by prompt + low effort, truncation ends as done', async () => {
        await withFakeAnthropic(streamReply({ thinking: true, text: ['短い', '答え'], stopReason: 'max_tokens' }), async (baseUrl, requests) => {
            setGatewayForTests(createGateway({ env: anthropicEnv(baseUrl), logger: quietLogger }));
            await withServer(async (base) => {
                const response = await postJson(`${base}/llm/tutor`, { message: 'もっと詳しく', lesson: LESSON, anchor: ANCHOR, locale: 'jp' });
                assert.equal(response.status, 200);
                const events = parseSse(await response.text());
                assert.deepEqual(events.map((e) => e.event), ['meta', 'text.delta', 'text.delta', 'done']);
                const done = events.at(-1).data;
                assert.equal(done.text, '短い答え');
                assert.equal(done.truncated, true);
                assert.deepEqual(done.grounding, { sectionId: 's2', blockId: 'b5' });
            });
            const { body } = requests[0];
            assert.equal(body.max_tokens, GUEST_TUTOR_LIMITS.maxTokens);
            assert.ok(body.max_tokens >= 4096);
            assert.deepEqual(body.thinking, { type: 'adaptive' });
            assert.equal(body.output_config.effort, 'low');
            const last = body.system.at(-1);
            assert.equal(last.text, GUEST_TUTOR_LIMITS.answerRule);
            assert.equal(last.cache_control, undefined, 'the cached tutor prefix stays first and unchanged');
            assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
        });
    });

    it('invalid bodies and lesson_required do not use the per-IP or total guest budget; valid requests do', async () => {
        process.env.LLM_GUEST_DAILY_PER_IP = '1';
        process.env.LLM_GUEST_DAILY_TOTAL = '1';
        await withServer(async (base) => {
            for (let i = 0; i < 3; i += 1) {
                const invalid = await postJson(`${base}/llm/tutor`, { message: '' });
                assert.equal(invalid.status, 400);
                assert.equal((await invalid.json()).error_type, 'invalid_body');
                const free = await postJson(`${base}/llm/tutor`, { message: 'Write a haiku about cats' });
                assert.equal(free.status, 400);
                assert.equal((await free.json()).error_type, 'lesson_required');
                const feedback = await postJson(`${base}/llm/writing-feedback`, { text: 'short', rubric: {} });
                assert.equal(feedback.status, 400);
                assert.equal((await feedback.json()).error_type, 'invalid_body');
                const insight = await postJson(`${base}/llm/personality-insight`, { scores: { openness: 'high' } });
                assert.equal(insight.status, 400);
                assert.equal((await insight.json()).error_type, 'invalid_body');
            }
            const valid = await postJson(`${base}/llm/tutor`, { message: 'ok', lesson: LESSON, anchor: ANCHOR });
            assert.equal(valid.status, 200, 'the budget is still untouched');
            await valid.text();
            const next = await postJson(`${base}/llm/personality-insight`, { scores: SCORES });
            assert.equal(next.status, 429, 'the valid request was charged');
            assert.equal((await next.json()).error_type, 'daily_limit_reached');
        });
    });

    it('a call that fails before any model ran gives the guest request back', async () => {
        process.env.LLM_GUEST_DAILY_PER_IP = '1';
        setGatewayForTests(createGateway({ env: { NODE_ENV: 'production' }, logger: quietLogger }));
        await withServer(async (base) => {
            for (let i = 0; i < 3; i += 1) {
                const sse = await postJson(`${base}/llm/tutor`, { message: 'hi', lesson: LESSON, anchor: ANCHOR });
                assert.equal(sse.status, 200, `tutor attempt ${i + 1} is not 429`);
                const events = parseSse(await sse.text());
                assert.equal(events.at(-1).event, 'error');
                assert.equal(events.at(-1).data.error_type, 'no_provider');
                const json = await postJson(`${base}/llm/personality-insight`, { scores: SCORES });
                assert.equal(json.status, 503, `insight attempt ${i + 1} is not 429`);
                assert.equal((await json.json()).error_type, 'no_provider');
            }
        });
    });
});

describe('guest budget refunds', () => {
    /** Run one POST through the budget; returns [status, res] (200 when it passed). */
    const runner = (budget) => (ip) => {
        let status = 200;
        let passed = false;
        const res = { locals: {}, set: () => res, status: (code) => { status = code; return res; }, json: () => res };
        budget({ method: 'POST', ip, userId: null }, res, () => { passed = true; });
        return [passed ? 200 : status, res];
    };

    it('gives back one request for failures where no model ran, and only once', () => {
        const run = runner(createGuestBudget({ env: {}, perIp: 1, total: 5, now: () => Date.parse('2026-10-19T10:00:00Z') }));
        const [first, res] = run('a');
        assert.equal(first, 200);
        assert.equal(run('a')[0], 429);
        refundGuestBudget(res, new LlmError('timeout', 'slow'));
        assert.equal(run('a')[0], 429, 'a timeout is charged: the model ran');
        refundGuestBudget(res, new LlmError('no_provider', 'none'));
        assert.equal(run('a')[0], 200, 'refunded');
        refundGuestBudget(res, new LlmError('no_provider', 'none'));
        assert.equal(run('a')[0], 429, 'a second refund for the same request does nothing');
    });

    it('counts an IPv6 guest by its /56: addresses in one /64 or /56 share the budget, other /56s do not', () => {
        const run = runner(createGuestBudget({ env: {}, perIp: 2, total: 50, now: () => Date.parse('2026-10-19T10:00:00Z') }));
        assert.equal(run('2001:db8:1:2::5')[0], 200);
        assert.equal(run('2001:db8:1:2:aaaa:bbbb:cccc:9')[0], 200, 'another address in the same /64');
        assert.equal(run('2001:db8:1:2::77')[0], 429, 'a third address in that /64 shares the budget of 2');
        assert.equal(run('2001:db8:1:80::1')[0], 429, 'another /64 inside the same /56 too');
        assert.equal(run('2001:db8:1:100::1')[0], 200, 'the next /56 has its own budget');
        assert.equal(run('2001:db8:2::1')[0], 200, 'another network');
        const [, res] = run('2001:db8:2::2');
        refundGuestBudget(res, new LlmError('no_provider', 'none'));
        assert.equal(run('2001:db8:2:0:ffff::3')[0], 200, 'the refund goes back to the same /56');
        assert.equal(run('::ffff:203.0.113.7')[0], 200);
        assert.equal(run('203.0.113.7')[0], 200, 'IPv4-mapped and plain IPv4 are one address');
        assert.equal(run('203.0.113.7')[0], 429);
        assert.equal(run('127.0.0.1')[0], 200, 'internal addresses count as they are');
        assert.equal(run('127.0.0.2')[0], 200);
    });

    it("does not add yesterday's refund to today's budget", () => {
        let now = Date.parse('2026-10-20T14:59:59Z'); // 23:59:59 JST
        const run = runner(createGuestBudget({ env: {}, perIp: 5, total: 1, now: () => now }));
        const [, yesterday] = run('a');
        now = Date.parse('2026-10-20T15:00:01Z'); // 00:00:01 JST, the next day
        assert.equal(run('b')[0], 200, 'new day');
        refundGuestBudget(yesterday, new LlmError('provider_unavailable', 'down'));
        assert.equal(run('c')[0], 429, 'the total budget for today is still used up');
    });

    it('stays charged when an earlier attempt or a structured first turn already ran a model', async () => {
        const run = runner(createGuestBudget({ env: {}, perIp: 1, total: 5, now: () => Date.parse('2026-10-19T10:00:00Z') }));
        const fake = (id, behave) => () => ({ id, generate: behave.generate, stream: behave.stream });

        // Structured call: the first turn returns invalid JSON (billed), the repair turn hits a 503.
        let calls = 0;
        const structured = createGateway({
            env: { GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true', LLM_PROVIDER: 'gemini' },
            providers: {
                gemini: fake('gemini', {
                    async generate() {
                        calls += 1;
                        if (calls === 1) return { provider: 'gemini', model: 'm', text: 'not json', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
                        throw new LlmError('provider_unavailable', 'down');
                    },
                    async *stream() { /* unused */ },
                }),
            },
            logger: quietLogger,
        });
        const { z } = await import('zod');
        const error = await structured.generate({ task: 'assessment.insight', messages: userMessage, schema: z.object({ a: z.string() }) }).catch((e) => e);
        assert.equal(error.code, 'provider_unavailable');
        assert.equal(error.modelRan, true);
        let [, res] = run('a');
        refundGuestBudget(res, error);
        assert.equal(run('a')[0], 429, 'not refunded: the first turn was billed');

        // Stream: Anthropic times out (the model ran), then Gemini is down.
        const fallback = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' },
            providers: {
                anthropic: fake('anthropic', { async generate() {}, async *stream() { throw new LlmError('timeout', 'slow'); } }),
                gemini: fake('gemini', { async generate() {}, async *stream() { throw new LlmError('provider_unavailable', 'down'); } }),
            },
            logger: quietLogger,
        });
        const events = await collect(fallback.stream({ task: 'tutor.chat', messages: userMessage }));
        assert.deepEqual(events.map((e) => [e.type, e.error?.code, e.error?.modelRan]), [['error', 'provider_unavailable', true]]);
        [, res] = run('b');
        refundGuestBudget(res, events[0].error);
        assert.equal(run('b')[0], 429, 'not refunded: the first provider ran');

        // Both providers down before any model ran: refunded.
        const down = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' },
            providers: {
                anthropic: fake('anthropic', { async generate() {}, async *stream() { throw new LlmError('provider_unavailable', 'down'); } }),
                gemini: fake('gemini', { async generate() {}, async *stream() { throw new LlmError('rate_limited', 'busy'); } }),
            },
            logger: quietLogger,
        });
        const downEvents = await collect(down.stream({ task: 'tutor.chat', messages: userMessage }));
        assert.equal(downEvents[0].error.modelRan, false);
        [, res] = run('c');
        refundGuestBudget(res, downEvents[0].error);
        assert.equal(run('c')[0], 200, 'refunded: no model ran');
    });

    it('Gemini: an unclassified failure counts as "model may have run"; a failed fetch does not', async () => {
        const { mapGeminiError } = await import('../llm/providers/gemini.js');
        const route = { provider: 'gemini', model: 'm' };
        const unknown = mapGeminiError({}, new Error('stream parse failed'), route);
        assert.equal(unknown.code, 'provider_unavailable');
        assert.equal(unknown.modelRan, true);
        const offline = mapGeminiError({}, new TypeError('fetch failed'), route);
        assert.equal(offline.code, 'provider_unavailable');
        assert.equal(offline.modelRan, false);
    });

    it('is a no-op without a charge (signed-in users, other routes)', () => {
        assert.doesNotThrow(() => refundGuestBudget({ locals: {} }, new LlmError('no_provider', 'none')));
        assert.doesNotThrow(() => refundGuestBudget({}, new LlmError('no_provider', 'none')));
        assert.doesNotThrow(() => refundGuestBudget({ locals: {} }, null));
    });
});
