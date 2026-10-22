// Phase 0 (doc/brushup-2026/ai-access-plan.ja.md), front end:
// - features.agentChat (config/features.ts) is on only when VITE_FEATURE_AGENT_CHAT is exactly "true".
// - Learner-facing agent chat errors never show the server's text or name Hermes / HERMES_API_KEY.
// - generateImagePreview (services/curriculumApi.ts) marks "image generation is not available
//   here" (only error_type 'image_generation_unavailable') so image blocks show a placeholder;
//   other 503s are short outages.
// The .ts modules import Vite-only things (import.meta.env, extensionless paths), so each is
// bundled with esbuild (a Vite dependency) and imported from a data: URL, as in
// agentChatError.test.js.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function load(contents, env = {}) {
    const result = await build({
        stdin: { contents, resolveDir: ROOT, loader: 'ts' },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        define: { 'import.meta.env': JSON.stringify(env) },
        logLevel: 'silent',
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

describe('features.agentChat', () => {
    const FEATURES = "export { features } from './config/features';";

    it('is off when VITE_FEATURE_AGENT_CHAT is unset', async () => {
        const { features } = await load(FEATURES, {});
        assert.equal(features.agentChat, false);
    });

    it('is on only for exactly "true"', async () => {
        assert.equal((await load(FEATURES, { VITE_FEATURE_AGENT_CHAT: 'true' })).features.agentChat, true);
        for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', '', 'false']) {
            const { features } = await load(FEATURES, { VITE_FEATURE_AGENT_CHAT: value });
            assert.equal(features.agentChat, false, `"${value}" must not turn the shared chat on`);
        }
    });
});

describe('agent chat errors shown to learners', () => {
    let agentApi;
    const COPY = {
        genericError: 'エラーが発生しました。もう一度お試しください。',
        hermesUnavailable: 'AI コーチは今使えません。しばらくしてからもう一度お試しください。',
        rateLimited: '混み合っています。',
        loginRequired: 'ログインしてください。',
    };

    before(async () => {
        agentApi = await load("export { mapAgentChatError, AgentApiError } from './services/agentApi';");
    });

    it('never shows the server text, even for an unknown error type', () => {
        const err = new agentApi.AgentApiError('Hermes API is not configured (set HERMES_API_KEY)', 500, 'something_new');
        assert.equal(agentApi.mapAgentChatError(err, COPY), COPY.genericError);
        const plain = new agentApi.AgentApiError('Stream interrupted', 500);
        assert.equal(agentApi.mapAgentChatError(plain, COPY), COPY.genericError);
    });

    it('maps every Hermes failure to the plain "unavailable" copy', () => {
        for (const type of ['hermes_not_configured', 'hermes_unreachable', 'hermes_api_error']) {
            const err = new agentApi.AgentApiError('Hermes API error', 503, type);
            assert.equal(agentApi.mapAgentChatError(err, COPY), COPY.hermesUnavailable);
        }
    });

    it('keeps Hermes and HERMES_API_KEY out of the chat views\' learner-facing copy', () => {
        for (const file of ['components/common/FloatingChatbot.tsx', 'components/features/life-journal/LifeJournalChatView.tsx']) {
            const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
            const strings = [...source.matchAll(/^\s*hermesUnavailable:\s*(['"])(.*)\1,?\s*$/gm)].map((m) => m[2]);
            assert.equal(strings.length, 2, `${file}: expected an EN and a JP hermesUnavailable string`);
            for (const text of strings) {
                assert.doesNotMatch(text, /hermes|HERMES_API_KEY/i, `${file}: "${text}"`);
            }
        }
    });
});

describe('generateImagePreview when image generation is unavailable', () => {
    let curriculumApi;
    const realFetch = globalThis.fetch;

    before(async () => {
        curriculumApi = await load(
            "export { generateImagePreview, isImageGenerationUnavailable, IMAGE_GENERATION_UNAVAILABLE } from './services/curriculumApi';",
        );
    });
    after(() => {
        globalThis.fetch = realFetch;
    });

    const answer = (status, body) => {
        globalThis.fetch = async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
            headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json' },
        });
    };
    const failure = async () => {
        try {
            await curriculumApi.generateImagePreview('a cat reading a book');
        } catch (err) {
            return err;
        }
        assert.fail('generateImagePreview should have thrown');
    };

    it('treats 503 image_generation_unavailable as unavailable', async () => {
        answer(503, { error: 'Image generation is not available', error_type: curriculumApi.IMAGE_GENERATION_UNAVAILABLE });
        const err = await failure();
        assert.equal(err.status, 503);
        assert.equal(err.errorType, 'image_generation_unavailable');
        assert.equal(curriculumApi.isImageGenerationUnavailable(err), true);
    });

    it('does not treat other 503s as unavailable: a provider rate limit, the outage share, a non-JSON 503', async () => {
        answer(503, { error: 'Image generation failed', error_type: 'image_failed' });
        assert.equal(curriculumApi.isImageGenerationUnavailable(await failure()), false);
        answer(503, { error: 'AI is busy right now', error_type: 'ai_unavailable' });
        assert.equal(curriculumApi.isImageGenerationUnavailable(await failure()), false);
        answer(503, '<html>Service Unavailable</html>');
        assert.equal(curriculumApi.isImageGenerationUnavailable(await failure()), false);
    });

    it('treats the error_type as unavailable at any status', () => {
        assert.equal(curriculumApi.isImageGenerationUnavailable({ status: 500, errorType: 'image_generation_unavailable' }), true);
    });

    it('does not treat other failures or daily limits as unavailable', async () => {
        answer(500, { error: 'Image generation failed', error_type: 'image_failed' });
        assert.equal(curriculumApi.isImageGenerationUnavailable(await failure()), false);
        answer(429, { error: 'Daily limit reached', error_type: 'daily_limit_reached', kind: 'image', scope: 'user' });
        const limited = await failure();
        assert.equal(limited.errorType, 'daily_limit_reached');
        assert.equal(curriculumApi.isImageGenerationUnavailable(limited), false);
        for (const value of [null, undefined, 'x', new Error('boom')]) {
            assert.equal(curriculumApi.isImageGenerationUnavailable(value), false);
        }
    });
});
