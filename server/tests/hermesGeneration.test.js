// The account generation in Hermes keys (Phase 4, design §5.14): a re-opened account keeps its
// UUID (the shared login stays), so the Hermes conversation and session keys, which Hermes stores
// with store: true, carry ':g<epoch seconds of the re-open>'. An account that was never deleted
// (generation null) keeps today's keys, so stored conversations stay reachable.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import agentRoutes from '../routes/agent.js';
import {
    buildConversationKey,
    buildSessionKey,
    callHermesResponses,
    streamHermesChatCompletions,
} from '../services/hermesAgentService.js';
import { clearAgentChatConsentForTests } from '../../tools/core/agentSessionStore.js';
import { clearMcpUserScopeForTests } from '../../tools/core/mcpUserScope.js';

const ID = 'abcdef01-2345-4678-9abc-def012345678';
const GEN = 1_792_000_000;
const ENV_KEYS = ['HERMES_API_KEY', 'HERMES_API_URL', 'VITE_FEATURE_AGENT_CHAT', 'NODE_ENV', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN'];

describe('Hermes keys with the account generation', () => {
    it('without a generation the keys are unchanged; with one they end in :g<n>', () => {
        assert.equal(buildConversationKey(ID, 'learning-coach'), `rp:user:${ID}:learning-coach`);
        assert.equal(buildSessionKey(ID), `rp:user:${ID}`);
        assert.equal(buildConversationKey(ID, 'learning-coach', null), `rp:user:${ID}:learning-coach`);
        assert.equal(buildSessionKey(ID, null), `rp:user:${ID}`);
        assert.equal(buildConversationKey(ID, 'learning-coach', GEN), `rp:user:${ID}:learning-coach:g${GEN}`);
        assert.equal(buildSessionKey(ID, GEN), `rp:user:${ID}:g${GEN}`);
    });

    it('anything but a positive whole number counts as no generation', () => {
        for (const value of [0, -5, 1.5, NaN, Infinity, '1792000000', undefined, {}]) {
            assert.equal(buildSessionKey(ID, value), `rp:user:${ID}`, String(value));
            assert.equal(buildConversationKey(ID, 'content-search', value), `rp:user:${ID}:content-search`, String(value));
        }
    });
});

describe('the generation reaches Hermes', () => {
    const saved = {};
    const realFetch = globalThis.fetch;
    const reply = { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) };

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        process.env.HERMES_API_KEY = 'test-key';
        process.env.HERMES_API_URL = 'http://hermes.test';
        process.env.VITE_FEATURE_AGENT_CHAT = 'true';
        process.env.NODE_ENV = 'development';
        delete process.env.DATABASE_URL_PHASE1;
        delete process.env.RISE_PATH_BRIDGE_TOKEN;
        clearAgentChatConsentForTests();
        clearMcpUserScopeForTests();
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        clearAgentChatConsentForTests();
        clearMcpUserScopeForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('callHermesResponses and streamHermesChatCompletions send the generation in the conversation and session keys', async () => {
        /** @type {any[]} */
        const sent = [];
        const fetchImpl = async (_url, init) => {
            sent.push({ body: JSON.parse(init.body), key: init.headers['X-Hermes-Session-Key'] });
            return { ...reply, body: null };
        };
        const base = { userId: ID, skill: 'learning-coach', message: 'q', context: {}, includeDiaryExcerpts: false, fetchImpl };
        assert.equal((await callHermesResponses({ ...base, generation: GEN })).ok, true);
        assert.equal((await streamHermesChatCompletions({ ...base, generation: GEN })).ok, true);
        assert.equal((await callHermesResponses(base)).ok, true);
        assert.deepEqual(sent.map((s) => [s.body.conversation, s.key]), [
            [`rp:user:${ID}:learning-coach:g${GEN}`, `rp:user:${ID}:g${GEN}`],
            [`rp:user:${ID}:learning-coach:g${GEN}`, `rp:user:${ID}:g${GEN}`],
            [`rp:user:${ID}:learning-coach`, `rp:user:${ID}`],
        ]);
    });

    it('POST /api/v2/agent/chat passes req.accountGeneration (requireAuth / requireBridgeOrAuth set it)', async () => {
        /** @type {any[]} */
        const bodies = [];
        globalThis.fetch = async (url, init) => {
            if (String(url).startsWith('http://hermes.test')) {
                bodies.push({ body: JSON.parse(init.body), key: init.headers['X-Hermes-Session-Key'] });
                return reply;
            }
            return realFetch(url, init);
        };
        for (const generation of [GEN, null]) {
            const app = express();
            app.use(express.json());
            app.use((req, res, next) => {
                req.userId = ID;
                req.authMethod = 'supabase-jwt';
                req.accountGeneration = generation;
                next();
            });
            app.use('/api/v2', agentRoutes);
            const server = await new Promise((resolve) => {
                const s = app.listen(0, '127.0.0.1', () => resolve(s));
            });
            try {
                const response = await realFetch(`http://127.0.0.1:${server.address().port}/api/v2/agent/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ skill: 'learning-coach', message: 'なぜ？' }),
                });
                assert.equal(response.status, 200, await response.clone().text());
                const json = await response.json();
                assert.equal(json.conversation, generation ? `rp:user:${ID}:learning-coach:g${GEN}` : `rp:user:${ID}:learning-coach`);
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        }
        assert.deepEqual(bodies.map((b) => b.key), [`rp:user:${ID}:g${GEN}`, `rp:user:${ID}`]);
    });

    it('the route passes the generation to both Hermes calls', () => {
        const source = readFileSync(new URL('../routes/agent.js', import.meta.url), 'utf8');
        assert.match(source, /const generation = req\.accountGeneration \?\? null;/);
        assert.equal(source.match(/^\s+generation,$/gm)?.length, 2, 'streamHermesChatCompletions and callHermesResponses');
    });
});
