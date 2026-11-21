// The OpenAI-compatible provider (server/llm/providers/openaiCompatible.js) and how the gateway routes
// to it: only where LLM_PROVIDER or LLM_TASK_<TASK> names `openai`, never as a fallback
// (doc/brushup-2026/ai-access-plan.ja.md 14 章 K3). A local HTTP server stands in for the API.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as z from 'zod/v4';
import { createGateway } from '../llm/index.js';
import { LlmError } from '../llm/errors.js';
import { MODEL_IDS, PROVIDER_FALLBACK_ORDER, resolveTaskRoute } from '../llm/models.config.js';
import { MINOR_SAFETY } from '../llm/prompts/shared.js';
import { chatCompletionsUrl, createOpenAICompatibleProvider, normalizeUsage } from '../llm/providers/openaiCompatible.js';

const quietLogger = { info: () => {}, warn: () => {} };
const userMessage = [{ role: 'user', content: 'hello' }];
const MODEL = 'local-model';
const TOKEN = 'test-openai-token';

/** A provider factory whose generate behaviour is scripted per test. */
function fakeProvider(id, { generate } = {}) {
    const calls = [];
    const factory = () => ({
        id,
        async generate(req, route) {
            calls.push({ req, route });
            if (!generate) throw new Error('generate not scripted');
            return generate(req, route, calls.length);
        },
        async *stream(req, route) {
            calls.push({ req, route });
        },
    });
    return { factory, calls };
}

const okResult = (provider, text) => ({ provider, model: `${provider}-model`, text, stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });

/** A stand-in OpenAI-compatible server: records each request and answers with `respond`. */
async function withServer(respond, run) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (part) => { raw += part; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : null;
            requests.push({ method: req.method, url: req.url, headers: req.headers, body });
            respond({ body, res, n: requests.length });
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        await run(`http://127.0.0.1:${port}/v1/`, requests);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}

const sendJson = (res, status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
};

const completion = (body, content, finish = 'stop', message = {}) => ({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: `${body.model}-0601`,
    choices: [{ index: 0, message: { role: 'assistant', content, ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 12, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 3 } },
});

const chunk = (content, finish = null) => ({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: `${MODEL}-0601`,
    choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finish }],
});

/**
 * Answer with server-sent events, written 5 bytes at a time so that lines and UTF-8 characters
 * split across reads. A string event is written as it is (a comment line, for one).
 */
function sendEvents(res, events, { done = true } = {}) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const text = events.map((event) => (typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`)).join('')
        + (done ? 'data: [DONE]\n\n' : '');
    const bytes = Buffer.from(text, 'utf8');
    let at = 0;
    const step = () => {
        if (at >= bytes.length) {
            res.end();
            return;
        }
        res.write(bytes.subarray(at, at + 5));
        at += 5;
        setImmediate(step);
    };
    step();
}

const routeFor = (task = 'tutor.chat') => resolveTaskRoute(task, { LLM_PROVIDER: 'openai', OPENAI_MODEL: MODEL });
const provider = (baseURL, options = {}) => createOpenAICompatibleProvider({ baseURL, apiKey: TOKEN, maxRetries: 0, timeoutMs: 5000, ...options });
const ask = (p, extra = {}) => p.generate({ task: 'tutor.chat', messages: userMessage, ...extra }, routeFor());
const collect = async (iterable) => {
    const events = [];
    for await (const event of iterable) events.push(event);
    return events;
};

describe('models.config: the openai route', () => {
    it('takes its model from OPENAI_MODEL or provider:model (colons kept), and is never a fallback', () => {
        const forced = resolveTaskRoute('tutor.chat', { LLM_PROVIDER: 'openai', OPENAI_MODEL: ` ${MODEL} ` });
        assert.equal(forced.provider, 'openai');
        assert.equal(forced.model, MODEL);
        assert.equal(forced.source, 'forced');
        const perTask = resolveTaskRoute('tutor.chat', { LLM_TASK_TUTOR_CHAT: 'openai:org/some-model:free', OPENAI_MODEL: 'other' });
        assert.equal(perTask.model, 'org/some-model:free');
        assert.equal(perTask.source, 'env');
        assert.equal(resolveTaskRoute('tutor.chat', { LLM_PROVIDER: 'openai' }).model, '');
        assert.equal(resolveTaskRoute('tutor.chat', { OPENAI_MODEL: MODEL }).provider, 'anthropic');
        assert.ok(!PROVIDER_FALLBACK_ORDER.includes(/** @type {any} */ ('openai')));
    });
});

describe('gateway: where learner text may go', () => {
    it('sends nothing to an OpenAI-compatible server that no route names, and shows no URL or key', async () => {
        const openai = fakeProvider('openai', { generate: () => okResult('openai', 'x') });
        const env = { NODE_ENV: 'production', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_API_KEY: TOKEN, OPENAI_MODEL: MODEL };
        const gateway = createGateway({ env, logger: quietLogger, providers: { openai: openai.factory } });
        await assert.rejects(
            gateway.generate({ task: 'tutor.chat', messages: userMessage }),
            (error) => error instanceof LlmError && error.code === 'no_provider',
        );
        const status = gateway.status();
        assert.deepEqual(status.providers.openai, { configured: true });
        assert.equal(status.ok, false);
        assert.equal(status.tasks['tutor.chat'].provider, null);
        const shown = JSON.stringify(status);
        assert.ok(!shown.includes(TOKEN) && !shown.includes('127.0.0.1:9'));
        assert.equal(openai.calls.length, 0);
    });

    it('does not fall back to it when Anthropic fails', async () => {
        const anthropic = fakeProvider('anthropic', { generate: () => { throw new LlmError('provider_unavailable', 'down'); } });
        const openai = fakeProvider('openai', { generate: () => okResult('openai', 'x') });
        const env = { ANTHROPIC_API_KEY: 'anthropic-test', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_MODEL: MODEL, LLM_MOCK_FALLBACK: 'false' };
        const gateway = createGateway({ env, logger: quietLogger, providers: { anthropic: anthropic.factory, openai: openai.factory } });
        await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), (error) => error.code === 'provider_unavailable');
        assert.equal(openai.calls.length, 0);
        assert.ok(gateway.status().tasks['tutor.chat'].fallback.every((route) => !route.startsWith('openai:')));
    });

    it('needs a model name: a forced openai route without OPENAI_MODEL has no provider', async () => {
        const gateway = createGateway({ env: { NODE_ENV: 'production', LLM_PROVIDER: 'openai', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' }, logger: quietLogger });
        assert.equal(gateway.firstProvider('tutor.chat'), null);
        await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), (error) => error.code === 'no_provider');
    });

    it('warns once at start when a route names it but OPENAI_BASE_URL or the model is missing', () => {
        const warned = (env) => {
            const warnings = [];
            createGateway({ env, logger: { info: () => {}, warn: (message) => warnings.push(String(message)) } });
            return warnings.filter((message) => message.includes('OpenAI-compatible'));
        };
        const noUrl = warned({ ANTHROPIC_API_KEY: 'anthropic-test', LLM_TASK_TUTOR_CHAT: 'openai', OPENAI_MODEL: MODEL });
        assert.equal(noUrl.length, 1);
        assert.match(noUrl[0], /^\[LLM\] tutor\.chat: routed to an OpenAI-compatible server/);
        assert.equal(warned({ LLM_TASK_TUTOR_CHAT: 'openai', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' }).length, 1);
        assert.equal(warned({ LLM_TASK_TUTOR_CHAT: `openai:${MODEL}`, OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' }).length, 0);
        assert.equal(warned({ OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' }).length, 0);
        const forced = warned({ LLM_PROVIDER: 'openai', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' });
        assert.equal(forced.length, 1);
        assert.ok(forced[0].includes('tutor.chat') && forced[0].includes('writing.feedback'));
    });

    it('a per-task route to it falls back to Anthropic like any other route', async () => {
        const openai = fakeProvider('openai', { generate: () => { throw new LlmError('provider_unavailable', 'down', { provider: 'openai' }); } });
        const anthropic = fakeProvider('anthropic', { generate: () => okResult('anthropic', 'from Claude') });
        const env = { ANTHROPIC_API_KEY: 'anthropic-test', LLM_TASK_TUTOR_CHAT: 'openai', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_MODEL: MODEL };
        const gateway = createGateway({ env, logger: quietLogger, providers: { anthropic: anthropic.factory, openai: openai.factory } });
        const result = await gateway.generate({ task: 'tutor.chat', messages: userMessage });
        assert.equal(result.provider, 'anthropic');
        assert.equal(openai.calls[0].route.model, MODEL);
        assert.equal(anthropic.calls[0].route.model, MODEL_IDS.anthropic.haiku);
        assert.deepEqual(gateway.status().tasks['tutor.chat'].fallback, [`anthropic:${MODEL_IDS.anthropic.haiku}`]);
    });

    it('streams from it under LLM_PROVIDER=openai, with the minor safety rules last in the system message', async () => {
        await withServer(({ res }) => sendEvents(res, [chunk('ok'), chunk(null, 'stop')]), async (base, requests) => {
            const env = { NODE_ENV: 'production', LLM_PROVIDER: 'openai', OPENAI_BASE_URL: base, OPENAI_MODEL: MODEL, LLM_MAX_RETRIES: '0' };
            const gateway = createGateway({ env, logger: quietLogger });
            assert.equal(gateway.status().ok, true);
            assert.equal(gateway.status().tasks['tutor.chat'].provider, 'openai');
            const events = await collect(gateway.stream({ task: 'tutor.chat', audience: 'minor', system: 'Be kind.', messages: userMessage }));
            assert.equal(events.at(-1).type, 'done');
            assert.equal(events.at(-1).result.provider, 'openai');
            const [system] = requests[0].body.messages;
            assert.equal(system.role, 'system');
            assert.ok(system.content.startsWith('Be kind.\n\n'));
            assert.ok(system.content.endsWith(MINOR_SAFETY));
        });
    });
});

describe('openai provider: one call', () => {
    it('posts a chat completion: path, key, model, one system message first, max_completion_tokens, no effort or user id', async () => {
        await withServer(({ body, res }) => sendJson(res, 200, completion(body, 'Hi there')), async (base, requests) => {
            const result = await ask(provider(base), { userId: 'user-123', system: [{ text: 'stable', cache: true }, { text: 'per call' }] });
            assert.equal(result.text, 'Hi there');
            assert.equal(result.provider, 'openai');
            assert.equal(result.model, `${MODEL}-0601`);
            assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 0 });
            const [{ method, url, headers, body }] = requests;
            assert.equal(method, 'POST');
            assert.equal(url, '/v1/chat/completions');
            assert.equal(headers.authorization, 'Bearer ' + TOKEN);
            assert.equal(body.model, MODEL);
            assert.deepEqual(body.messages, [{ role: 'system', content: 'stable\n\nper call' }, { role: 'user', content: 'hello' }]);
            assert.equal(body.max_completion_tokens, routeFor().maxTokens);
            for (const key of ['max_tokens', 'stream', 'response_format', 'reasoning_effort', 'temperature', 'user', 'metadata']) {
                assert.ok(!(key in body), key);
            }
            assert.ok(!JSON.stringify(body).includes('user-123'));
        });
        assert.deepEqual(normalizeUsage(undefined), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    });

    it('sends no Authorization header without a key, and the limit in max_tokens when OPENAI_MAX_TOKENS_FIELD says so', async () => {
        await withServer(({ body, res }) => sendJson(res, 200, completion(body, 'ok')), async (base, requests) => {
            await ask(provider(base, { apiKey: '', maxTokensField: 'max_tokens' }));
            assert.equal(requests[0].headers.authorization, undefined);
            assert.equal(requests[0].body.max_tokens, routeFor().maxTokens);
            assert.ok(!('max_completion_tokens' in requests[0].body));
            await ask(provider(base, { maxTokensField: 'max_output' }));
            assert.equal(requests[1].body.max_completion_tokens, routeFor().maxTokens);
        });
        assert.equal(chatCompletionsUrl('http://h/v1'), 'http://h/v1/chat/completions');
        assert.equal(chatCompletionsUrl('http://h/v1//'), 'http://h/v1/chat/completions');
    });

    it('caps the limit at OPENAI_MAX_OUTPUT_TOKENS and leaves response_format out with OPENAI_RESPONSE_FORMAT=none', async () => {
        await withServer(({ body, res }) => sendJson(res, 200, completion(body, '{"score":3}')), async (base, requests) => {
            const env = {
                NODE_ENV: 'production', LLM_PROVIDER: 'openai', OPENAI_BASE_URL: base, OPENAI_MODEL: MODEL, LLM_MAX_RETRIES: '0',
                OPENAI_MAX_OUTPUT_TOKENS: '1000', OPENAI_RESPONSE_FORMAT: 'none',
            };
            const gateway = createGateway({ env, logger: quietLogger });
            const result = await gateway.generate({ task: 'writing.feedback', schema: z.object({ score: z.number().int() }), messages: userMessage });
            assert.deepEqual(result.data, { score: 3 });
            const [{ body }] = requests;
            assert.ok(resolveTaskRoute('writing.feedback', env).maxTokens > 1000);
            assert.equal(body.max_completion_tokens, 1000);
            assert.ok(!('response_format' in body));
            assert.match(body.messages[0].content, /^Reply with one JSON object only/);
        });
        await withServer(({ body, res }) => sendJson(res, 200, completion(body, 'ok')), async (base, requests) => {
            const limit = routeFor().maxTokens;
            for (const maxOutputTokens of [limit + 1, '0', '-5', 'many', undefined]) await ask(provider(base, { maxOutputTokens }));
            assert.deepEqual(requests.map((r) => r.body.max_completion_tokens), [limit, limit, limit, limit, limit]);
            await ask(provider(base, { maxOutputTokens: 100, maxTokensField: 'max_tokens' }));
            assert.equal(requests.at(-1).body.max_tokens, 100);
            await ask(provider(base, { responseFormat: 'json_object' }), { schema: z.object({ a: z.string() }) });
            assert.equal(requests.at(-1).body.response_format.type, 'json_schema');
        });
    });

    it('joins turns in a row from one role into one message', async () => {
        await withServer(({ body, res }) => sendJson(res, 200, completion(body, 'ok')), async (base, requests) => {
            const messages = [
                { role: 'user', content: 'first' }, { role: 'user', content: 'second' },
                { role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'third' },
            ];
            await ask(provider(base), { messages });
            assert.deepEqual(requests[0].body.messages, [
                { role: 'user', content: 'first\n\nsecond' },
                { role: 'assistant', content: 'a\n\nb' },
                { role: 'user', content: 'third' },
            ]);
            assert.equal(messages[0].content, 'first');
        });
    });

    it('asks for JSON with response_format and the schema in the system message; the gateway validates and repairs', async () => {
        const Schema = z.object({ score: z.number().int(), note: z.string(), tags: z.array(z.string()).optional() });
        const replies = ['{"score":"high"}', '{"score":4,"note":"ok"}'];
        await withServer(({ body, res, n }) => sendJson(res, 200, completion(body, replies[n - 1])), async (base, requests) => {
            const env = { NODE_ENV: 'production', LLM_PROVIDER: 'openai', OPENAI_BASE_URL: base, OPENAI_MODEL: MODEL, LLM_MAX_RETRIES: '0' };
            const gateway = createGateway({ env, logger: quietLogger });
            const result = await gateway.generate({ task: 'writing.feedback', schema: Schema, system: 'Judge it.', messages: userMessage });
            assert.deepEqual(result.data, { score: 4, note: 'ok' });
            assert.equal(result.repaired, true);
            assert.equal(result.provider, 'openai');
            const first = requests[0].body;
            assert.equal(first.response_format.type, 'json_schema');
            assert.equal(first.response_format.json_schema.name, 'writing_feedback');
            assert.equal(first.response_format.json_schema.strict, false);
            assert.deepEqual([...first.response_format.json_schema.schema.required].sort(), ['note', 'score']);
            assert.match(first.messages[0].content, /^Judge it\.\n\nReply with one JSON object only/);
            assert.ok(first.messages[0].content.endsWith(JSON.stringify(first.response_format.json_schema.schema)));
            const repair = requests[1].body.messages.at(-1);
            assert.equal(repair.role, 'user');
            assert.match(repair.content, /did not match the required schema/);
        });
    });

    it('maps HTTP errors to typed errors, retries a 5xx before giving up, and reads an error sent with 200', async () => {
        const cases = [[401, 'auth'], [403, 'auth'], [402, 'auth'], [429, 'rate_limited'], [404, 'provider_error'], [400, 'bad_request'], [500, 'provider_unavailable'], [504, 'timeout']];
        let status = 0;
        await withServer(({ res }) => sendJson(res, status, { error: { message: 'no', type: 'test' } }), async (base) => {
            for (const [code, want] of cases) {
                status = code;
                await assert.rejects(
                    ask(provider(base)),
                    (error) => error instanceof LlmError && error.code === want && error.provider === 'openai' && error.modelRan === false,
                    String(code),
                );
            }
        });
        await withServer(({ body, res, n }) => (n === 1 ? sendJson(res, 503, { error: {} }) : sendJson(res, 200, completion(body, 'ok'))), async (base, requests) => {
            assert.equal((await ask(provider(base, { maxRetries: 1 }))).text, 'ok');
            assert.equal(requests.length, 2);
        });
        // OpenRouter sends some errors inside a 200 reply, with an HTTP-like code.
        await withServer(({ res }) => sendJson(res, 200, { error: { code: 402, message: 'Insufficient credits' } }), async (base) => {
            await assert.rejects(ask(provider(base)), (error) => error.code === 'auth' && error.modelRan === true);
        });
    });

    it('turns a cut-off reply into max_tokens and a refusal or content filter into refusal', async () => {
        let finish = 'length';
        let message = {};
        await withServer(({ body, res }) => sendJson(res, 200, completion(body, 'partial', finish, message)), async (base) => {
            await assert.rejects(ask(provider(base)), (error) => error.code === 'max_tokens' && error.retryable === false);
            finish = 'content_filter';
            await assert.rejects(ask(provider(base)), (error) => error.code === 'refusal');
            finish = 'stop';
            message = { refusal: 'I cannot help with that.' };
            await assert.rejects(ask(provider(base)), (error) => error.code === 'refusal');
        });
    });

    it('a failed connection is provider_unavailable (nothing ran); a silent server times out; the caller can abort', async () => {
        const closedPort = await new Promise((resolve) => {
            const server = http.createServer();
            server.listen(0, '127.0.0.1', () => {
                const { port } = server.address();
                server.close(() => resolve(port));
            });
        });
        await assert.rejects(ask(provider(`http://127.0.0.1:${closedPort}/v1`)), (error) => error.code === 'provider_unavailable' && error.modelRan === false);
        await withServer(() => {}, async (base) => {
            await assert.rejects(ask(provider(base, { timeoutMs: 100 })), (error) => error.code === 'timeout');
            const controller = new AbortController();
            const pending = ask(provider(base), { signal: controller.signal });
            setTimeout(() => controller.abort(), 50);
            await assert.rejects(pending, (error) => error.code === 'aborted');
        });
    });
});

describe('openai provider: streaming', () => {
    it('streams deltas from events split across reads, skips keep-alive comments, and takes usage from the last chunk', async () => {
        const usageChunk = { id: 'chatcmpl-test', object: 'chat.completion.chunk', model: `${MODEL}-0601`, choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } };
        const events = [': OPENROUTER PROCESSING\n\n', chunk('こんにちは、'), chunk('世界'), chunk(null, 'stop'), usageChunk];
        await withServer(({ res }) => sendEvents(res, events), async (base, requests) => {
            const out = await collect(provider(base).stream({ task: 'tutor.chat', messages: userMessage }, routeFor()));
            assert.equal(out.filter((e) => e.type === 'text.delta').map((e) => e.text).join(''), 'こんにちは、世界');
            const done = out.at(-1);
            assert.equal(done.type, 'done');
            assert.equal(done.result.text, 'こんにちは、世界');
            assert.equal(done.result.stopReason, 'end');
            assert.equal(done.result.model, `${MODEL}-0601`);
            assert.deepEqual(done.result.usage, { inputTokens: 20, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
            assert.equal(requests[0].body.stream, true);
            assert.deepEqual(requests[0].body.stream_options, { include_usage: true });
        });
    });

    it('keeps the text of a reply cut off after some text, and fails one cut off before any or filtered', async () => {
        let events = [chunk('Part of'), chunk(' it'), chunk(null, 'length')];
        await withServer(({ res }) => sendEvents(res, events), async (base) => {
            const done = (await collect(provider(base).stream({ task: 'tutor.chat', messages: userMessage }, routeFor()))).at(-1);
            assert.equal(done.result.text, 'Part of it');
            assert.equal(done.result.truncated, true);
            assert.equal(done.result.stopReason, 'max_tokens');
            events = [chunk(null, 'length')];
            await assert.rejects(collect(provider(base).stream({ task: 'tutor.chat', messages: userMessage }, routeFor())), (error) => error.code === 'max_tokens');
            events = [chunk('Some'), chunk(null, 'content_filter')];
            await assert.rejects(collect(provider(base).stream({ task: 'tutor.chat', messages: userMessage }, routeFor())), (error) => error.code === 'refusal');
        });
    });

    it('fails a stream that ends without finishing, or that carries an error, as a call where a model ran', async () => {
        let events = [chunk('Half')];
        let done = false;
        await withServer(({ res }) => sendEvents(res, events, { done }), async (base) => {
            await assert.rejects(
                collect(provider(base).stream({ task: 'tutor.chat', messages: userMessage }, routeFor())),
                (error) => error.code === 'provider_error' && error.modelRan === true,
            );
            events = [chunk('Half'), { error: { code: 502, message: 'Upstream error' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] }];
            done = true;
            await assert.rejects(
                collect(provider(base).stream({ task: 'tutor.chat', messages: userMessage }, routeFor())),
                (error) => error.code === 'provider_unavailable' && error.modelRan === true,
            );
        });
    });

    it('streams a long task even for generate(), so the timeout bounds each wait and not the whole reply', async () => {
        const parts = [chunk('{"a":'), chunk('1'), chunk(','), chunk('"b":2}'), chunk(null, 'stop')];
        await withServer(({ res }) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            let i = 0;
            const next = () => {
                if (i < parts.length) {
                    res.write(`data: ${JSON.stringify(parts[i])}\n\n`);
                    i += 1;
                    setTimeout(next, 50);
                } else {
                    res.end('data: [DONE]\n\n');
                }
            };
            next();
        }, async (base, requests) => {
            const route = routeFor('course.generate');
            const result = await provider(base, { timeoutMs: 150 }).generate({ task: 'course.generate', messages: userMessage }, route);
            assert.equal(result.text, '{"a":1,"b":2}');
            assert.equal(result.stopReason, 'end');
            assert.equal(requests[0].body.stream, true);
            assert.equal(requests[0].body.max_completion_tokens, route.maxTokens);
        });
    });
});
