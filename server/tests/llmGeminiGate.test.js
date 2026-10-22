// Phase 0 AI access: Gemini only with GEMINI_ALLOWED=true (its API terms exclude services that
// people under 18 use), learner-facing tasks on the cheap Claude tier, and the 'course.generate'
// task that replaced the direct Gemini call in server/services/aiGenerator.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_KEY_IGNORED_WARNING, createGateway, geminiKeyIgnored, warnIfGeminiKeyIgnored } from '../llm/index.js';
import { LlmError } from '../llm/errors.js';
import { MODEL_IDS, TASKS, isGeminiAllowed, resolveTaskRoute } from '../llm/models.config.js';
import { parseJsonReply } from '../services/aiGenerator.js';
import { generateImageWithGemini, setImageClientForTests } from '../geminiBackendService.js';

const userMessage = [{ role: 'user', content: 'hello' }];
const okResult = (provider, text) => ({ provider, model: `${provider}-model`, text, stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });

/** A logger that records warnings. */
const recordingLogger = () => {
    const warnings = [];
    return { warnings, info: () => {}, warn: (...args) => warnings.push(args.join(' ')) };
};

/** A provider factory that records whether it was built and called. */
const spyProvider = (id, generate = () => okResult(id, `from ${id}`)) => {
    const state = { built: 0, calls: 0 };
    const factory = () => {
        state.built += 1;
        return {
            id,
            async generate() {
                state.calls += 1;
                return generate();
            },
            async *stream() {
                state.calls += 1;
                yield { type: 'done', result: okResult(id, 'x') };
            },
        };
    };
    return { factory, state };
};

describe('isGeminiAllowed', () => {
    it('is true only for GEMINI_ALLOWED exactly "true"', () => {
        assert.equal(isGeminiAllowed({ GEMINI_ALLOWED: 'true' }), true);
        for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) {
            assert.equal(isGeminiAllowed({ GEMINI_ALLOWED: value }), false, JSON.stringify(value));
        }
        assert.equal(isGeminiAllowed({}), false);
    });

    it('reads process.env by default', () => {
        const saved = process.env.GEMINI_ALLOWED;
        try {
            delete process.env.GEMINI_ALLOWED;
            assert.equal(isGeminiAllowed(), false);
            process.env.GEMINI_ALLOWED = 'true';
            assert.equal(isGeminiAllowed(), true);
        } finally {
            if (saved === undefined) delete process.env.GEMINI_ALLOWED;
            else process.env.GEMINI_ALLOWED = saved;
        }
    });
});

describe('gateway: the Gemini key counts only when GEMINI_ALLOWED=true', () => {
    for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
        it(`${key} without GEMINI_ALLOWED: reported unconfigured, never built or called, one warning`, async () => {
            const logger = recordingLogger();
            const anthropic = spyProvider('anthropic', () => { throw new LlmError('provider_unavailable', 'down', { provider: 'anthropic' }); });
            const gemini = spyProvider('gemini');
            const gateway = createGateway({
                env: { ANTHROPIC_API_KEY: 'a', [key]: 'AIza-SECRET' },
                providers: { anthropic: anthropic.factory, gemini: gemini.factory },
                logger,
            });
            assert.deepEqual(logger.warnings, [GEMINI_KEY_IGNORED_WARNING]);
            assert.match(logger.warnings[0], /GEMINI_ALLOWED/);
            assert.ok(!logger.warnings[0].includes('SECRET'));

            const status = gateway.status();
            assert.deepEqual(status.providers.gemini, { configured: false, allowed: false });
            assert.deepEqual(status.tasks['tutor.chat'].fallback, [], 'no Gemini fallback');

            await assert.rejects(gateway.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'provider_unavailable' });
            assert.equal(anthropic.state.calls, 1);
            assert.equal(gemini.state.built, 0, 'no Gemini client');
            assert.equal(gemini.state.calls, 0);
        });
    }

    it('LLM_PROVIDER=gemini or LLM_TASK_*=gemini without GEMINI_ALLOWED never reaches Gemini', async () => {
        const gemini = spyProvider('gemini');
        const forced = createGateway({
            env: { NODE_ENV: 'production', GEMINI_API_KEY: 'g', LLM_PROVIDER: 'gemini' },
            providers: { gemini: gemini.factory },
            logger: recordingLogger(),
        });
        await assert.rejects(forced.generate({ task: 'tutor.chat', messages: userMessage }), { code: 'no_provider', status: 503 });
        assert.equal(forced.canServe('tutor.chat'), false);

        const anthropic = spyProvider('anthropic');
        const perTask = createGateway({
            env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', LLM_TASK_TUTOR_CHAT: 'gemini' },
            providers: { anthropic: anthropic.factory, gemini: gemini.factory },
            logger: recordingLogger(),
        });
        const result = await perTask.generate({ task: 'tutor.chat', messages: userMessage });
        assert.equal(result.provider, 'anthropic', 'falls through to the configured provider');
        assert.equal(gemini.state.built, 0);
    });

    it('with GEMINI_ALLOWED=true the key is used as before, and nothing is logged', async () => {
        const logger = recordingLogger();
        const gemini = spyProvider('gemini');
        const gateway = createGateway({
            env: { GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true', LLM_PROVIDER: 'gemini' },
            providers: { gemini: gemini.factory },
            logger,
        });
        assert.deepEqual(logger.warnings, []);
        assert.deepEqual(gateway.status().providers.gemini, { configured: true, allowed: true });
        const result = await gateway.generate({ task: 'tutor.chat', messages: userMessage });
        assert.equal(result.provider, 'gemini');
        assert.equal(gemini.state.calls, 1);
    });

    it('warnIfGeminiKeyIgnored: only for a key that GEMINI_ALLOWED keeps off', () => {
        const cases = [
            [{}, false],
            [{ GEMINI_ALLOWED: 'true' }, false],
            [{ GEMINI_API_KEY: '  ' }, false],
            [{ GEMINI_API_KEY: 'g', GEMINI_ALLOWED: 'true' }, false],
            [{ GEMINI_API_KEY: 'g' }, true],
            [{ GOOGLE_API_KEY: 'g', GEMINI_ALLOWED: 'yes' }, true],
            [{ VITE_GEMINI_API_KEY: 'g' }, false],
        ];
        for (const [env, expected] of cases) {
            const logger = recordingLogger();
            assert.equal(geminiKeyIgnored(env), expected, JSON.stringify(env));
            assert.equal(warnIfGeminiKeyIgnored(env, logger), expected);
            assert.equal(logger.warnings.length, expected ? 1 : 0);
        }
    });
});

describe("task 'course.generate' and the cheap tier", () => {
    it('course.generate runs on Anthropic, cheap tier (Haiku), low effort, 32000 tokens, streamed', () => {
        assert.deepEqual(TASKS['course.generate'], { tier: 'cheap', provider: 'anthropic', effort: 'low', maxTokens: 32000, stream: true });
        const route = resolveTaskRoute('course.generate', {});
        assert.equal(route.provider, 'anthropic');
        assert.equal(route.model, MODEL_IDS.anthropic.haiku);
        assert.equal(route.tier, 'cheap');
        assert.equal(route.effort, 'low');
        assert.equal(route.maxTokens, 32000);
        assert.equal(route.stream, true);
    });

    it('tutor.chat and writing.feedback default to Haiku; an owner can switch one back per task', () => {
        for (const task of ['tutor.chat', 'writing.feedback', 'course.generate']) {
            assert.equal(TASKS[task].tier, 'cheap', task);
            assert.equal(resolveTaskRoute(task, {}).model, MODEL_IDS.anthropic.haiku, task);
        }
        const sonnet = MODEL_IDS.anthropic.sonnet;
        assert.equal(resolveTaskRoute('tutor.chat', { LLM_TASK_TUTOR_CHAT: `anthropic:${sonnet}` }).model, sonnet);
        assert.equal(resolveTaskRoute('writing.feedback', { LLM_TASK_WRITING_FEEDBACK: `anthropic:${sonnet}` }).model, sonnet);
        assert.equal(resolveTaskRoute('course.generate', { LLM_TASK_COURSE_GENERATE: `anthropic:${sonnet}` }).model, sonnet);
        assert.equal(resolveTaskRoute('tutor.chat', { LLM_TASK_WRITING_FEEDBACK: `anthropic:${sonnet}` }).model, MODEL_IDS.anthropic.haiku, 'per task');
    });

    it('the gateway sends course.generate to Anthropic with the Haiku route', async () => {
        const seen = [];
        const gateway = createGateway({
            env: { ANTHROPIC_API_KEY: 'a' },
            providers: {
                anthropic: () => ({
                    id: 'anthropic',
                    async generate(req, route) {
                        seen.push(route);
                        return okResult('anthropic', '{"message":"ok"}');
                    },
                    async *stream() {},
                }),
            },
            logger: recordingLogger(),
        });
        const result = await gateway.generate({ task: 'course.generate', messages: userMessage });
        assert.equal(result.provider, 'anthropic');
        assert.equal(seen[0].model, MODEL_IDS.anthropic.haiku);
        assert.equal(seen[0].stream, true);
        assert.equal(seen[0].maxTokens, 32000);
    });

    it('canServe: a configured provider, or the mock outside production; never an unknown task', () => {
        const quiet = recordingLogger();
        assert.equal(createGateway({ env: { NODE_ENV: 'production' }, logger: quiet }).canServe('course.generate'), false);
        assert.equal(createGateway({ env: { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'a' }, logger: quiet }).canServe('course.generate'), true);
        assert.equal(createGateway({ env: { NODE_ENV: 'development' }, logger: quiet }).canServe('course.generate'), true);
        assert.equal(createGateway({ env: { NODE_ENV: 'development', LLM_MOCK_FALLBACK: 'false' }, logger: quiet }).canServe('course.generate'), false);
        assert.equal(createGateway({ env: { ANTHROPIC_API_KEY: 'a' }, logger: quiet }).canServe('no.such.task'), false);
    });

    it('the mock answers each course.generate stage with one JSON object of the stage shape', async () => {
        const gateway = createGateway({ env: { NODE_ENV: 'development', LLM_MOCK_DELAY_MS: '0' }, logger: recordingLogger() });
        const ask = async (input) => parseJsonReply((await gateway.generate({ task: 'course.generate', messages: userMessage, input })).text);

        const requirements = await ask({ stage: 'requirements', message: 'SQL basics' });
        assert.equal(requirements.intake.goal, 'SQL basics');
        assert.match(requirements.message, /SQL basics/);

        const roadmap = await ask({ stage: 'roadmap', intake: requirements.intake });
        assert.ok(roadmap.modules.length >= 3);
        assert.ok(roadmap.modules.every((m) => m.lessons.length > 0));

        const curriculum = await ask({ stage: 'curriculum', modules: roadmap.modules });
        assert.equal(curriculum.curriculum.modules.length, roadmap.modules.length);
        const lesson = curriculum.curriculum.modules[0].lessons[0];
        assert.ok(lesson.sections.length >= 3);
        assert.ok(lesson.sections.every((s) => s.content.length >= 3));
    });
});

describe('generateImageWithGemini makes no client call unless GEMINI_ALLOWED=true', () => {
    it('throws GEMINI_NOT_CONFIGURED before calling a set test client when GEMINI_ALLOWED is unset or not "true"', async () => {
        const saved = { allowed: process.env.GEMINI_ALLOWED, key: process.env.GEMINI_API_KEY };
        const calls = [];
        setImageClientForTests({ models: { async generateContent(params) { calls.push(params); return {}; } } });
        process.env.GEMINI_API_KEY = 'AIza-test-key';
        try {
            for (const value of [undefined, '', 'TRUE', '1']) {
                if (value === undefined) delete process.env.GEMINI_ALLOWED;
                else process.env.GEMINI_ALLOWED = value;
                await assert.rejects(generateImageWithGemini({ prompt: 'a cat' }), { code: 'GEMINI_NOT_CONFIGURED' }, JSON.stringify(value));
            }
            assert.equal(calls.length, 0, 'the client was never called');
        } finally {
            setImageClientForTests(null);
            if (saved.allowed === undefined) delete process.env.GEMINI_ALLOWED;
            else process.env.GEMINI_ALLOWED = saved.allowed;
            if (saved.key === undefined) delete process.env.GEMINI_API_KEY;
            else process.env.GEMINI_API_KEY = saved.key;
        }
    });
});
