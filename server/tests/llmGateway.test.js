import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as z from 'zod/v4';
import { createGateway } from '../llm/index.js';
import { LlmError, toClientError } from '../llm/errors.js';
import { MODEL_IDS, resolveTaskRoute, taskEnvKey } from '../llm/models.config.js';
import { toLlmJsonSchema, validateStructured } from '../llm/structured.js';
import { WritingFeedback, TutorRequest, resolveTutorMode } from '../llm/schemas.js';

const quietLogger = { info: () => {}, warn: () => {} };
const userMessage = [{ role: 'user', content: 'hello' }];

/** A provider factory whose generate/stream behaviour is scripted per test. */
function fakeProvider(id, { generate, stream } = {}) {
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
            yield* stream(req, route);
        },
    });
    return { factory, calls };
}

const okResult = (provider, text) => ({ provider, model: `${provider}-model`, text, stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });

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

const anthropicMessage = (body, text, stopReason = 'end_turn') => ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: text === null ? [] : [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
    usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
});

const sendJson = (res, payload) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_test' });
    res.end(JSON.stringify(payload));
};

describe('models.config task routing', () => {
    it('uses Haiku for learner-facing and classification tasks, Sonnet for general and Opus for authoring', () => {
        assert.equal(resolveTaskRoute('tutor.chat', {}).model, MODEL_IDS.anthropic.haiku);
        assert.equal(resolveTaskRoute('tutor.chat', {}).tier, 'cheap');
        assert.equal(resolveTaskRoute('writing.feedback', {}).model, MODEL_IDS.anthropic.haiku);
        assert.equal(resolveTaskRoute('writing.feedback', {}).tier, 'cheap');
        assert.equal(resolveTaskRoute('assessment.insight', {}).model, MODEL_IDS.anthropic.sonnet);
        assert.equal(resolveTaskRoute('lesson.translate', {}).model, MODEL_IDS.anthropic.sonnet);
        assert.equal(resolveTaskRoute('course.outline', {}).model, MODEL_IDS.anthropic.opus);
        assert.equal(resolveTaskRoute('lesson.author', {}).model, MODEL_IDS.anthropic.opus);
        assert.equal(resolveTaskRoute('text.classify', {}).model, MODEL_IDS.anthropic.haiku);
        assert.equal(resolveTaskRoute('lesson.author', {}).stream, true);
    });

    it('honours LLM_TASK_<TASK>=provider:model and LLM_PROVIDER overrides', () => {
        assert.equal(taskEnvKey('tutor.chat'), 'LLM_TASK_TUTOR_CHAT');
        const env = { LLM_TASK_TUTOR_CHAT: 'gemini:gemini-custom' };
        const route = resolveTaskRoute('tutor.chat', env);
        assert.equal(route.provider, 'gemini');
        assert.equal(route.model, 'gemini-custom');
        assert.equal(route.source, 'env');

        const providerOnly = resolveTaskRoute('course.outline', { LLM_TASK_COURSE_OUTLINE: 'gemini' });
        assert.equal(providerOnly.model, MODEL_IDS.gemini.flash);

        const forced = resolveTaskRoute('tutor.chat', { ...env, LLM_PROVIDER: 'mock' });
        assert.equal(forced.provider, 'mock');
        assert.equal(forced.model, MODEL_IDS.mock.default);
        assert.equal(forced.source, 'forced');

        assert.equal(resolveTaskRoute('tutor.chat', { LLM_TASK_TUTOR_CHAT: 'nonsense:x' }).provider, 'anthropic');
    });

    it('rejects unknown tasks', () => {
        assert.throws(() => resolveTaskRoute('nope', {}), /Unknown LLM task/);
    });
});

describe('createGateway provider selection', () => {
    it('returns 503 no_provider without keys in production', async () => {
        const gateway = createGateway({ env: { NODE_ENV: 'production' }, logger: quietLogger });
        await assert.rejects(
            gateway.generate({ task: 'tutor.chat', messages: userMessage }),
            (error) => error instanceof LlmError && error.code === 'no_provider' && error.status === 503,
        );
        const events = [];
        for await (const event of gateway.stream({ task: 'tutor.chat', messages: userMessage })) events.push(event);
        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'error');
        assert.equal(toClientError(events[0].error).status, 503);
        const status = gateway.status();
        assert.equal(status.ok, false);
        assert.equal(status.mock, false);
        assert.equal(status.tasks['tutor.chat'].provider, null);
    });

    it('falls back to mock without keys outside production, and reports mock:true', async () => {
        const gateway = createGateway({ env: { NODE_ENV: 'development', LLM_MOCK_DELAY_MS: '0' }, logger: quietLogger });
        const status = gateway.status();
        assert.equal(status.mock, true);
        assert.equal(status.providers.anthropic.configured, false);
        assert.equal(status.tasks['tutor.chat'].provider, 'mock');
        const result = await gateway.generate({ task: 'tutor.chat', messages: userMessage, locale: 'en' });
        assert.equal(result.provider, 'mock');
        assert.ok(result.text.length > 0);
    });

    it('LLM_MOCK_FALLBACK=false disables the dev mock fallback; LLM_PROVIDER=mock works in production', async () => {
        const strict = createGateway({ env: { LLM_MOCK_FALLBACK: 'false' }, logger: quietLogger });
        await assert.rejects(strict.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'no_provider' });

        const demo = createGateway({ env: { NODE_ENV: 'production', LLM_PROVIDER: 'mock', LLM_MOCK_DELAY_MS: '0' }, logger: quietLogger });
        assert.equal(demo.status().mock, true);
        assert.equal(demo.status().providers.mock.forced, true);
        const result = await demo.generate({ task: 'writing.feedback', messages: userMessage, schema: WritingFeedback, input: { text: 'A short text that is long enough.', locale: 'en' } });
        assert.equal(result.provider, 'mock');
        assert.ok(WritingFeedback.safeParse(result.data).success);
    });

    it('never exposes key material in status()', () => {
        const gateway = createGateway({ env: { ANTHROPIC_API_KEY: 'sk-ant-SECRET-123', GEMINI_API_KEY: 'AIza-SECRET-456', GEMINI_ALLOWED: 'true' }, logger: quietLogger });
        const status = gateway.status();
        const serialized = JSON.stringify(status);
        assert.ok(!serialized.includes('SECRET'));
        assert.equal(status.providers.anthropic.configured, true);
        assert.equal(status.providers.gemini.configured, true);
        assert.equal(status.mock, false);
        assert.deepEqual(status.tasks['tutor.chat'].fallback, [`gemini:${MODEL_IDS.gemini.flashLite}`]);
        assert.deepEqual(status.tasks['assessment.insight'].fallback, [`gemini:${MODEL_IDS.gemini.flash}`]);
    });

    it('falls over to the next configured provider on a retryable failure', async () => {
        const anthropic = fakeProvider('anthropic', {
            generate: () => { throw new LlmError('provider_unavailable', 'overloaded', { provider: 'anthropic' }); },
        });
        const gemini = fakeProvider('gemini', { generate: () => okResult('gemini', 'from gemini') });
        const gateway = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' },
            providers: { anthropic: anthropic.factory, gemini: gemini.factory },
            logger: quietLogger,
        });
        const result = await gateway.generate({ task: 'tutor.chat', messages: userMessage });
        assert.equal(result.provider, 'gemini');
        assert.equal(result.text, 'from gemini');
        assert.equal(anthropic.calls.length, 1);
        assert.equal(gemini.calls[0].route.model, MODEL_IDS.gemini.flashLite, 'tutor.chat is on the cheap tier');
    });

    it('does not fall over on a refusal or a bad request', async () => {
        const anthropic = fakeProvider('anthropic', {
            generate: () => { throw new LlmError('refusal', 'declined', { provider: 'anthropic', retryable: false }); },
        });
        const gemini = fakeProvider('gemini', { generate: () => okResult('gemini', 'x') });
        const gateway = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' },
            providers: { anthropic: anthropic.factory, gemini: gemini.factory },
            logger: quietLogger,
        });
        await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'refusal', status: 422 });
        assert.equal(gemini.calls.length, 0);
    });

    it('a forced provider is not silently swapped for another', async () => {
        const anthropic = fakeProvider('anthropic', {
            generate: () => { throw new LlmError('provider_unavailable', 'down', { provider: 'anthropic' }); },
        });
        const gemini = fakeProvider('gemini', { generate: () => okResult('gemini', 'x') });
        const gateway = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true', LLM_PROVIDER: 'anthropic' },
            providers: { anthropic: anthropic.factory, gemini: gemini.factory },
            logger: quietLogger,
        });
        await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'provider_unavailable' });
        assert.equal(gemini.calls.length, 0);
    });

    it('streams fall over only before any text was sent', async () => {
        const anthropic = fakeProvider('anthropic', {
            // eslint-disable-next-line require-yield
            stream: async function* () { throw new LlmError('timeout', 'slow', { provider: 'anthropic' }); },
        });
        const gemini = fakeProvider('gemini', {
            stream: async function* () {
                yield { type: 'text.delta', text: 'Hi' };
                yield { type: 'done', result: okResult('gemini', 'Hi') };
            },
        });
        const gateway = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' },
            providers: { anthropic: anthropic.factory, gemini: gemini.factory },
            logger: quietLogger,
        });
        const events = [];
        for await (const event of gateway.stream({ task: 'tutor.chat', messages: userMessage })) events.push(event);
        assert.deepEqual(events.map((e) => e.type), ['text.delta', 'done']);
        assert.equal(events[1].result.provider, 'gemini');

        const midStream = fakeProvider('anthropic', {
            stream: async function* () {
                yield { type: 'text.delta', text: 'partial' };
                throw new LlmError('provider_unavailable', 'dropped', { provider: 'anthropic' });
            },
        });
        const gateway2 = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' },
            providers: { anthropic: midStream.factory, gemini: gemini.factory },
            logger: quietLogger,
        });
        const events2 = [];
        for await (const event of gateway2.stream({ task: 'tutor.chat', messages: userMessage })) events2.push(event);
        assert.deepEqual(events2.map((e) => e.type), ['text.delta', 'error']);
        assert.equal(events2[1].error.code, 'provider_unavailable');
    });
});

describe('structured output', () => {
    const Schema = z.object({ score: z.number().int().min(0).max(100), note: z.string().min(1).max(20), tags: z.array(z.string()).min(1).max(3) });

    it('strips keywords providers reject and forces additionalProperties:false', () => {
        const json = toLlmJsonSchema(Schema);
        const text = JSON.stringify(json);
        for (const keyword of ['$schema', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
            assert.ok(!text.includes(`"${keyword}"`), `${keyword} should be stripped`);
        }
        assert.equal(json.additionalProperties, false);
        assert.deepEqual(json.required, ['score', 'note', 'tags']);
    });

    it('validates JSON (fenced or not) with zod', () => {
        assert.equal(validateStructured('```json\n{"score":5,"note":"ok","tags":["a"]}\n```', Schema).ok, true);
        const bad = validateStructured('{"score":500,"note":"ok","tags":[]}', Schema);
        assert.equal(bad.ok, false);
        assert.ok(bad.issues.some((issue) => issue.startsWith('score')));
        assert.equal(validateStructured('not json', Schema).ok, false);
    });

    it('repairs once with the zod issues, then succeeds', async () => {
        const provider = fakeProvider('anthropic', {
            generate: (_req, _route, n) => okResult('anthropic', n === 1 ? '{"score":500,"note":"ok","tags":["a"]}' : '{"score":50,"note":"ok","tags":["a"]}'),
        });
        const gateway = createGateway({ env: { ANTHROPIC_API_KEY: 'a' }, providers: { anthropic: provider.factory }, logger: quietLogger });
        const result = await gateway.generate({ task: 'writing.feedback', messages: userMessage, schema: Schema });
        assert.deepEqual(result.data, { score: 50, note: 'ok', tags: ['a'] });
        assert.equal(result.repaired, true);
        assert.equal(provider.calls.length, 2);
        const repairMessages = provider.calls[1].req.messages;
        assert.equal(repairMessages.length, 3);
        assert.equal(repairMessages[1].role, 'assistant');
        assert.match(repairMessages[2].content, /score/);
    });

    it('fails with invalid_output (502) after one unsuccessful repair, without trying another provider', async () => {
        const anthropic = fakeProvider('anthropic', { generate: () => okResult('anthropic', '{"score":"high"}') });
        const gemini = fakeProvider('gemini', { generate: () => okResult('gemini', '{"score":1,"note":"x","tags":["a"]}') });
        const gateway = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' },
            providers: { anthropic: anthropic.factory, gemini: gemini.factory },
            logger: quietLogger,
        });
        await assert.rejects(gateway.generate({ task: 'writing.feedback', messages: userMessage, schema: Schema }), { code: 'invalid_output', status: 502 });
        assert.equal(anthropic.calls.length, 2);
        assert.equal(gemini.calls.length, 0);
    });
});

describe('Anthropic provider request shape (fake API server)', () => {
    const env = (baseUrl, extra = {}) => ({ ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_BASE_URL: baseUrl, LLM_MAX_RETRIES: '0', ...extra });

    it('sends beta fallbacks, effort, a cached system prefix and a stripped JSON schema', async () => {
        await withFakeAnthropic(({ body, res }) => {
            sendJson(res, anthropicMessage(body, JSON.stringify({ clarityScore: 80, linkingScore: 70, toneScore: 75, feedback: 'Good.', refinedVersion: 'Better.' })));
        }, async (baseUrl, requests) => {
            // writing.feedback defaults to Haiku; an owner's switch back to Sonnet gets the fallbacks.
            const gateway = createGateway({ env: env(baseUrl, { LLM_TASK_WRITING_FEEDBACK: `anthropic:${MODEL_IDS.anthropic.sonnet}` }), logger: quietLogger });
            const result = await gateway.generate({
                task: 'writing.feedback',
                schema: WritingFeedback,
                system: [{ text: 'Stable instructions', cache: true }, { text: 'Per-request line' }],
                messages: userMessage,
            });
            assert.equal(result.provider, 'anthropic');
            assert.equal(result.model, MODEL_IDS.anthropic.sonnet);
            assert.equal(result.data.clarityScore, 80);
            assert.equal(result.usage.cacheReadTokens, 3);

            assert.equal(requests.length, 1);
            const { url, headers, body } = requests[0];
            assert.match(url, /^\/v1\/messages\?beta=true/);
            assert.match(String(headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
            assert.equal(body.fallbacks, 'default');
            assert.equal(body.model, MODEL_IDS.anthropic.sonnet);
            assert.deepEqual(body.thinking, { type: 'adaptive' });
            assert.equal(body.output_config.effort, 'low');
            assert.equal(body.output_config.format.type, 'json_schema');
            assert.equal(body.output_config.format.schema.additionalProperties, false);
            assert.ok(!JSON.stringify(body.output_config.format.schema).includes('"maximum"'));
            assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
            assert.equal(body.system[1].cache_control, undefined);
            assert.equal(body.temperature, undefined);
            assert.equal(body.output_format, undefined);
        });
    });

    it('leaves server-side fallbacks off for Haiku', async () => {
        await withFakeAnthropic(({ body, res }) => sendJson(res, anthropicMessage(body, 'positive')), async (baseUrl, requests) => {
            const gateway = createGateway({ env: env(baseUrl), logger: quietLogger });
            await gateway.generate({ task: 'text.classify', messages: userMessage });
            assert.equal(requests[0].body.model, MODEL_IDS.anthropic.haiku);
            assert.equal(requests[0].body.fallbacks, undefined);
            assert.ok(!String(requests[0].headers['anthropic-beta'] || '').includes('server-side-fallback'));
        });
    });

    it('maps stop_reason refusal and max_tokens to typed errors', async () => {
        let stopReason = 'refusal';
        await withFakeAnthropic(({ body, res }) => sendJson(res, anthropicMessage(body, stopReason === 'refusal' ? null : 'cut', stopReason)), async (baseUrl) => {
            const gateway = createGateway({ env: env(baseUrl), logger: quietLogger });
            await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'refusal', status: 422 });
            stopReason = 'max_tokens';
            await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'max_tokens' });
        });
    });

    it('maps HTTP errors with the SDK error classes (429 → rate_limited, 401 → auth)', async () => {
        let status = 429;
        await withFakeAnthropic(({ res }) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ type: 'error', error: { type: 'x', message: 'nope' } }));
        }, async (baseUrl) => {
            const gateway = createGateway({ env: env(baseUrl, { NODE_ENV: 'production' }), logger: quietLogger });
            await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'rate_limited', status: 429 });
            status = 401;
            await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'auth', status: 503 });
        });
    });

    it('streams text deltas from the SSE response', async () => {
        await withFakeAnthropic(({ body, res }) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            send('message_start', { type: 'message_start', message: { ...anthropicMessage(body, null, null), content: [], stop_reason: null } });
            send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
            for (const text of ['Hel', 'lo']) send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
            send('content_block_stop', { type: 'content_block_stop', index: 0 });
            send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
            send('message_stop', { type: 'message_stop' });
            res.end();
        }, async (baseUrl, requests) => {
            const gateway = createGateway({ env: env(baseUrl), logger: quietLogger });
            const events = [];
            for await (const event of gateway.stream({ task: 'tutor.chat', messages: userMessage })) events.push(event);
            assert.deepEqual(events.filter((e) => e.type === 'text.delta').map((e) => e.text), ['Hel', 'lo']);
            assert.equal(events.at(-1).type, 'done');
            assert.equal(events.at(-1).result.text, 'Hello');
            assert.equal(requests[0].body.stream, true);
            assert.equal(requests[0].body.model, MODEL_IDS.anthropic.haiku, 'the tutor runs on the cheap tier');
            assert.equal(requests[0].body.fallbacks, undefined, 'Haiku has no server-side fallback');
            assert.equal(requests[0].body.output_config.effort, 'low');
        });
    });
});

describe('tutor mode resolution', () => {
    it('is socratic on assessment blocks until two attempts, and when asked', () => {
        const base = { message: 'why?', anchor: { sectionId: 's', blockId: 'b', blockType: 'quiz', excerpt: 'x' } };
        assert.equal(resolveTutorMode(TutorRequest.parse(base)), 'socratic');
        assert.equal(resolveTutorMode(TutorRequest.parse({ ...base, mode: 'explain', learner: { attemptsOnBlock: 1 } })), 'socratic');
        assert.equal(resolveTutorMode(TutorRequest.parse({ ...base, mode: 'explain', learner: { attemptsOnBlock: 2 } })), 'explain');
        assert.equal(resolveTutorMode(TutorRequest.parse({ message: 'why?', mode: 'socratic' })), 'socratic');
        assert.equal(resolveTutorMode(TutorRequest.parse({ message: 'why?' })), 'explain');
    });

    it('rejects excerpts over 1500 characters and accepts the jp locale code', () => {
        const anchor = { sectionId: 's', blockId: 'b', blockType: 'markdown', excerpt: 'x'.repeat(1501) };
        assert.equal(TutorRequest.safeParse({ message: 'q', anchor }).success, false);
        assert.equal(TutorRequest.parse({ message: 'q', locale: 'jp' }).locale, 'ja');
    });
});
