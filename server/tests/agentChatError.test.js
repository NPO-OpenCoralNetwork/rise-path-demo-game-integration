// mapAgentChatError (services/agentApi.ts): the text FloatingChatbot and LifeJournalChatView show
// for a failed agent chat. Fixed error types get the app's own (localized) copy, never the
// server's English message. agentApi.ts imports Vite modules (import.meta.env, extensionless
// paths), so it is bundled with esbuild (a Vite dependency) and imported from a data: URL.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const COPY = {
    genericError: 'エラーが発生しました。もう一度お試しください。',
    hermesUnavailable: 'エージェントは今使えません。',
    rateLimited: '混み合っています。',
    loginRequired: 'ログインしてください。',
    dailyLimit: '今日の上限に達しました。',
    featurePaused: 'この機能は停止中です。',
};

describe('mapAgentChatError', () => {
    let agentApi;

    before(async () => {
        const result = await build({
            stdin: { contents: "export { mapAgentChatError, AgentApiError } from './services/agentApi';", resolveDir: ROOT, loader: 'ts' },
            bundle: true,
            write: false,
            format: 'esm',
            platform: 'browser',
            define: { 'import.meta.env': '{}' },
            logLevel: 'silent',
        });
        agentApi = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    });

    it('shows the generic copy for 503 ai_unavailable, not the server text', () => {
        const err = new agentApi.AgentApiError('This AI feature is busy right now. Please try again in a few minutes.', 503, 'ai_unavailable');
        assert.equal(agentApi.mapAgentChatError(err, COPY), COPY.genericError);
    });

    it('shows the generic copy for 503 agent_session_unavailable (the turn binding was not written), not the server text', () => {
        const err = new agentApi.AgentApiError('Agent session could not be started', 503, 'agent_session_unavailable');
        assert.equal(agentApi.mapAgentChatError(err, COPY), COPY.genericError);
    });

    it('keeps the daily-limit and Hermes copy', () => {
        const limit = new agentApi.AgentApiError('Daily limit reached', 429, 'daily_limit_reached', undefined, { kind: 'agent_chat', scope: 'user' });
        assert.equal(agentApi.mapAgentChatError(limit, COPY), COPY.dailyLimit);
        const off = new agentApi.AgentApiError('Daily limit reached', 429, 'daily_limit_reached', undefined, { kind: 'agent_chat', scope: 'off' });
        assert.equal(agentApi.mapAgentChatError(off, COPY), COPY.featurePaused);
        assert.equal(agentApi.mapAgentChatError(new agentApi.AgentApiError('x', 502, 'hermes_unreachable'), COPY), COPY.hermesUnavailable);
    });
});
