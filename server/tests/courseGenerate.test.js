// /api/v2/ai/generate on the LLM gateway: JSON replies (server/services/aiGenerator.js
// parseJsonReply), the stage calls, the prompts, and the daily cap refund rules by LlmError code
// (server/routes/ai.js).
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetGatewayForTests, setGatewayForTests } from '../llm/index.js';
import { LlmError } from '../llm/errors.js';
import {
    COURSE_GENERATE_TASK,
    generateCurriculum,
    generateRequirements,
    generateRoadmap,
    isCourseGenerationAvailable,
    isStageReply,
    parseJsonReply,
} from '../services/aiGenerator.js';
import { JSON_ONLY_RULE, buildCurriculumPrompt, buildRequirementsPrompt, buildRoadmapPrompt } from '../services/aiPrompts.js';
import { courseGenerationError, refundsCourseGeneration } from '../routes/ai.js';

/** A gateway double that records generate() requests and answers with `text`. */
const fakeGateway = (text, extra = {}) => {
    const requests = [];
    return {
        requests,
        async generate(req) {
            requests.push(req);
            return { provider: 'anthropic', model: 'm', text, stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
        },
        async *stream() {},
        status: () => ({}),
        ...extra,
    };
};

afterEach(() => resetGatewayForTests());

describe('parseJsonReply', () => {
    it('reads plain JSON, with surrounding whitespace or a BOM', () => {
        assert.deepEqual(parseJsonReply('{"message":"hi","intake":{"goal":"SQL"}}'), { message: 'hi', intake: { goal: 'SQL' } });
        assert.deepEqual(parseJsonReply('\n  {"a":1}\n'), { a: 1 });
        assert.deepEqual(parseJsonReply('﻿{"a":1}'), { a: 1 });
    });

    it('reads a ```json fenced block, or a bare ``` fence, with text around it', () => {
        assert.deepEqual(parseJsonReply('Here you go:\n```json\n{"a":1}\n```\nEnjoy!'), { a: 1 });
        assert.deepEqual(parseJsonReply('```\n{"b":2}\n```'), { b: 2 });
        assert.deepEqual(parseJsonReply('```JSON {"c":3}```'), { c: 3 });
    });

    it('reads the first balanced {...} after prose, ignoring braces inside strings', () => {
        assert.deepEqual(parseJsonReply('Sure! {"message":"use {curly} braces","n":1} Thanks.'), { message: 'use {curly} braces', n: 1 });
        assert.deepEqual(parseJsonReply('note {not json} then {"ok":true}'), { ok: true });
        assert.deepEqual(parseJsonReply('{"s":"escaped \\" quote }"}'), { s: 'escaped " quote }' });
    });

    it('keeps a curriculum whose strings contain code fences', () => {
        const reply = JSON.stringify({ curriculum: { modules: [{ code: '```python\nprint(1)\n```' }] } });
        assert.deepEqual(parseJsonReply(reply), JSON.parse(reply));
        const fenced = `\`\`\`json\n${reply}\n\`\`\``;
        assert.deepEqual(parseJsonReply(fenced), JSON.parse(reply), 'the inner fence does not cut the outer block short');
    });

    it('gives up after 50 unmatched { and returns null, even when a valid object follows', () => {
        const noise = '{ '.repeat(51);
        assert.equal(parseJsonReply(`${noise}{"ok":true}`), null);
        assert.deepEqual(parseJsonReply(`${'{ '.repeat(10)}{"ok":true}`), { ok: true }, 'under the bound it still finds the object');
    });

    it('returns null for no object: empty, prose, arrays, scalars, truncated JSON, non-strings', () => {
        for (const text of ['', '   ', 'no json here', '[1,2]', '42', '"str"', '{"a":1', '{"message":"cut off', null, undefined, 3]) {
            assert.equal(parseJsonReply(text), null, String(text));
        }
    });
});

describe('aiGenerator stages call the gateway (task course.generate)', () => {
    it('requirements: one call with the system prompt, the message, stage input and the signal', async () => {
        const gateway = fakeGateway('```json\n{"message":"plan","intake":{"goal":"SQL"}}\n```');
        setGatewayForTests(gateway);
        const signal = new AbortController().signal;
        const result = await generateRequirements('Teach me SQL', undefined, {}, { signal });
        assert.deepEqual(result, { message: 'plan', intake: { goal: 'SQL' } });
        assert.equal(gateway.requests.length, 1);
        const [req] = gateway.requests;
        assert.equal(req.task, COURSE_GENERATE_TASK);
        assert.equal(req.task, 'course.generate');
        assert.deepEqual(req.messages, [{ role: 'user', content: 'Teach me SQL' }]);
        assert.equal(req.system[0].text, buildRequirementsPrompt({}, ''));
        assert.deepEqual(req.input, { stage: 'requirements', message: 'Teach me SQL' });
        assert.equal(req.signal, signal);
        assert.equal(req.schema, undefined, 'free-form JSON: no structured-output schema');
    });

    it('roadmap and curriculum parse their objects; a reply with no object keeps the text', async () => {
        setGatewayForTests(fakeGateway('Roadmap below.\n{"message":"m","modules":[{"module_id":"m1"}]}'));
        assert.deepEqual(await generateRoadmap({ goal: 'SQL' }, 'u1', {}), { message: 'm', modules: [{ module_id: 'm1' }] });

        setGatewayForTests(fakeGateway('{"curriculum":{"title":"T","modules":[{"module_id":"m1"}]}}'));
        assert.deepEqual(await generateCurriculum({}, [], 'u1', {}), { curriculum: { title: 'T', modules: [{ module_id: 'm1' }] } });

        setGatewayForTests(fakeGateway('Sorry, I cannot.'));
        assert.deepEqual(await generateCurriculum({}, [], 'u1', {}), { curriculum: null, rawText: 'Sorry, I cannot.' });
        assert.deepEqual(await generateRoadmap({}, 'u1', {}), { message: 'Sorry, I cannot.', modules: null });
    });

    it('a broken reply whose nested piece parses is not taken as the stage result', async () => {
        // One unescaped quote: the whole reply does not parse, but its {en, jp} title does.
        const broken = '{"curriculum": {"title": {"en": "Intro", "jp": "入門"}, "description": {"en": "Learn the "basics"", "jp": "基本"}, "modules": []}}';
        assert.deepEqual(parseJsonReply(broken), { en: 'Intro', jp: '入門' }, 'the parser alone returns the fragment');
        setGatewayForTests(fakeGateway(broken));
        assert.deepEqual(await generateCurriculum({}, [], 'u1', {}), { curriculum: null, rawText: broken });
        assert.deepEqual(await generateRoadmap({}, 'u1', {}), { message: broken, modules: null });
        assert.deepEqual(await generateRequirements('SQL', 'u1', {}), { message: broken, intake: null });
    });

    it('an earlier object of another shape (an echoed input or an example) does not hide the stage object', async () => {
        const accept = (value) => isStageReply('requirements', value);
        assert.deepEqual(parseJsonReply('例: {"a":1}\n{"message":"m","intake":{"goal":"g"}}', accept), { message: 'm', intake: { goal: 'g' } });
        assert.deepEqual(
            parseJsonReply('```json\n{"example":true}\n```\n```json\n{"message":"m","intake":{"goal":"g"}}\n```', accept),
            { message: 'm', intake: { goal: 'g' } },
        );

        // The roadmap stage echoes its input (an intake with many nested objects) before answering:
        // the echo is skipped whole, so its nested braces do not use up the 50 attempts.
        const echoedIntake = JSON.stringify({ goal: 'SQL', topics: Array.from({ length: 60 }, (_, i) => ({ id: i })) });
        setGatewayForTests(fakeGateway(`要件: ${echoedIntake}\n{"message":"m","modules":[{"module_id":"m1"}]}`));
        assert.deepEqual(await generateRoadmap({ goal: 'SQL' }, 'u1', {}), { message: 'm', modules: [{ module_id: 'm1' }] });
    });

    it('isStageReply checks each stage shape', () => {
        assert.equal(isStageReply('requirements', { message: 'm', intake: { goal: 'SQL' } }), true);
        assert.equal(isStageReply('requirements', { message: 'm', intake: null }), false);
        assert.equal(isStageReply('requirements', { en: 'Intro', jp: '入門' }), false);
        assert.equal(isStageReply('roadmap', { modules: [] }), true);
        assert.equal(isStageReply('roadmap', { modules: 'x' }), false);
        assert.equal(isStageReply('curriculum', { curriculum: { modules: [{}] } }), true);
        assert.equal(isStageReply('curriculum', { curriculum: { modules: [] } }), false, 'no modules');
        assert.equal(isStageReply('curriculum', { title: 'T', modules: [{}] }), false, 'no curriculum wrapper');
        assert.equal(isStageReply('curriculum', { curriculum: [{ modules: [{}] }] }), false);
    });

    it('gateway errors propagate as LlmError for the route to map', async () => {
        setGatewayForTests({
            async generate() { throw new LlmError('rate_limited', 'slow down'); },
            async *stream() {},
            status: () => ({}),
        });
        await assert.rejects(generateRoadmap({}, 'u1', {}), { code: 'rate_limited' });
    });

    it('isCourseGenerationAvailable asks the gateway (canServe, else its status)', () => {
        setGatewayForTests(fakeGateway('', { canServe: (task) => task === 'course.generate' }));
        assert.equal(isCourseGenerationAvailable(), true);
        setGatewayForTests(fakeGateway('', { canServe: () => false }));
        assert.equal(isCourseGenerationAvailable(), false);
        setGatewayForTests(fakeGateway('', { status: () => ({ tasks: { 'course.generate': { provider: null } } }) }));
        assert.equal(isCourseGenerationAvailable(), false);
        setGatewayForTests(fakeGateway('', { status: () => ({ tasks: { 'course.generate': { provider: 'anthropic' } } }) }));
        assert.equal(isCourseGenerationAvailable(), true);
    });
});

describe('course prompts ask for exactly one JSON object, no fences', () => {
    for (const [name, build] of [['requirements', () => buildRequirementsPrompt({}, '')], ['roadmap', () => buildRoadmapPrompt({})], ['curriculum', () => buildCurriculumPrompt({})]]) {
        it(name, () => {
            const prompt = build();
            assert.ok(prompt.trimEnd().endsWith(JSON_ONLY_RULE), 'ends with the JSON-only rule');
            const withoutRule = prompt.slice(0, prompt.lastIndexOf(JSON_ONLY_RULE));
            assert.ok(!withoutRule.includes('```'), 'no fenced example the model would copy');
            assert.match(JSON_ONLY_RULE, /JSON オブジェクト 1 つだけ/);
        });
    }
});

describe('/ai/generate daily cap refund by LlmError code', () => {
    it('gives the unit back only when no model ran', () => {
        for (const code of ['no_provider', 'provider_unavailable', 'auth', 'rate_limited']) {
            assert.equal(refundsCourseGeneration(new LlmError(code, 'x')), true, code);
            assert.equal(refundsCourseGeneration(new LlmError(code, 'x', { modelRan: true })), false, `${code} after an attempt that ran`);
        }
        for (const code of ['timeout', 'aborted', 'refusal', 'max_tokens', 'invalid_output', 'provider_error', 'bad_request']) {
            assert.equal(refundsCourseGeneration(new LlmError(code, 'x')), false, code);
        }
    });

    it('keeps the unit for errors that are not LlmError, whatever their message or status', () => {
        assert.equal(refundsCourseGeneration(new Error('API key GEMINI invalid')), false);
        assert.equal(refundsCourseGeneration(Object.assign(new Error('Forbidden'), { status: 403 })), false);
        assert.equal(refundsCourseGeneration(Object.assign(new Error('x'), { code: 'GEMINI_NOT_CONFIGURED' })), false);
        assert.equal(refundsCourseGeneration(undefined), false);
    });

    it('answers by code without provider text; no_provider is 503 ai_unavailable', () => {
        assert.deepEqual(courseGenerationError(new LlmError('no_provider', 'secret detail')), {
            status: 503, body: { error: 'AI service is temporarily unavailable', error_type: 'ai_unavailable' },
        });
        const cases = { rate_limited: 429, timeout: 504, auth: 503, provider_unavailable: 503, max_tokens: 502, refusal: 422 };
        for (const [code, status] of Object.entries(cases)) {
            const { status: got, body } = courseGenerationError(new LlmError(code, 'sk-ant-SECRET'));
            assert.equal(got, status, code);
            assert.equal(body.error_type, code);
            assert.ok(!JSON.stringify(body).includes('SECRET'));
        }
        assert.deepEqual(courseGenerationError(new Error('db down: /srv/secret')), { status: 500, body: { error: 'Internal server error' } });
    });
});
