import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import agentRoutes, { isAgentChatEnabled, startSseHeartbeat } from '../routes/agent.js';

const optedInPool = {
    query: async () => ({
        rowCount: 1,
        rows: [{
            preferences: {
                privacy: { life_journal: { allow_diary_excerpts_in_ai: true } },
            },
        }],
    }),
};

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v2', requireBridgeOrAuth, agentRoutes);
    return app;
};

const withServer = async (handler) => {
    const app = buildApp();
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    try {
        await handler(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }
};

describe('POST /api/v2/agent/chat is off unless VITE_FEATURE_AGENT_CHAT is exactly "true"', () => {
    it('isAgentChatEnabled reads the same switch as the front end', () => {
        assert.equal(isAgentChatEnabled({}), false);
        assert.equal(isAgentChatEnabled({ VITE_FEATURE_AGENT_CHAT: 'true' }), true);
        for (const value of ['', 'TRUE', '1', 'yes', ' true', 'false']) {
            assert.equal(isAgentChatEnabled({ VITE_FEATURE_AGENT_CHAT: value }), false, JSON.stringify(value));
        }
    });

    it('answers 404 agent_chat_off before validation or Hermes, even with Hermes configured', async () => {
        const saved = ['VITE_FEATURE_AGENT_CHAT', 'HERMES_API_KEY', 'NODE_ENV', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1']
            .map((key) => [key, process.env[key]]);
        delete process.env.VITE_FEATURE_AGENT_CHAT;
        delete process.env.RISE_PATH_BRIDGE_TOKEN;
        delete process.env.DATABASE_URL_PHASE1;
        process.env.HERMES_API_KEY = 'configured-hermes-key';
        process.env.NODE_ENV = 'development';
        const realFetch = globalThis.fetch;
        const outbound = [];
        try {
            await withServer(async (baseUrl) => {
                globalThis.fetch = async (...args) => {
                    outbound.push(String(args[0]));
                    return realFetch(...args);
                };
                for (const body of [{ skill: 'life-habit-analyst', message: '傾向は？' }, { skill: 'nope' }]) {
                    const response = await realFetch(`${baseUrl}/api/v2/agent/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    assert.equal(response.status, 404);
                    assert.equal((await response.json()).error_type, 'agent_chat_off');
                }
                assert.deepEqual(outbound, [], 'Hermes was not called');
            });
        } finally {
            globalThis.fetch = realFetch;
            for (const [key, value] of saved) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });
});

describe('POST /api/v2/agent/chat diary excerpt gate', () => {
    let prevAgentChat;
    before(() => {
        prevAgentChat = process.env.VITE_FEATURE_AGENT_CHAT;
        process.env.VITE_FEATURE_AGENT_CHAT = 'true'; // the shared chat is on for these tests
    });
    after(() => {
        if (prevAgentChat === undefined) delete process.env.VITE_FEATURE_AGENT_CHAT;
        else process.env.VITE_FEATURE_AGENT_CHAT = prevAgentChat;
    });

    it('returns 403 diary_excerpts_not_allowed when excerpts requested without opt-in', async () => {
        const prevDb = process.env.DATABASE_URL_PHASE1;
        const prevNodeEnv = process.env.NODE_ENV;
        const prevBridge = process.env.RISE_PATH_BRIDGE_TOKEN;
        delete process.env.DATABASE_URL_PHASE1;
        process.env.NODE_ENV = 'development';
        delete process.env.RISE_PATH_BRIDGE_TOKEN;

        try {
            await withServer(async (baseUrl) => {
                const response = await fetch(`${baseUrl}/api/v2/agent/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        skill: 'life-habit-analyst',
                        message: '睡眠と集中の関係は？',
                        context: {
                            from: '2026-06-01',
                            to: '2026-06-30',
                            timezone: 'Asia/Tokyo',
                        },
                        include_diary_excerpts: true,
                    }),
                });

                assert.equal(response.status, 403);
                const payload = await response.json();
                assert.equal(payload.error_type, 'diary_excerpts_not_allowed');
                assert.match(payload.error, /Privacy/i);
            });
        } finally {
            resetPoolForTests();
            if (prevDb === undefined) delete process.env.DATABASE_URL_PHASE1;
            else process.env.DATABASE_URL_PHASE1 = prevDb;
            if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prevNodeEnv;
            if (prevBridge === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
            else process.env.RISE_PATH_BRIDGE_TOKEN = prevBridge;
        }
    });

    it('passes diary gate when user opted in and proceeds past 403', async () => {
        const prevDb = process.env.DATABASE_URL_PHASE1;
        const prevNodeEnv = process.env.NODE_ENV;
        const prevBridge = process.env.RISE_PATH_BRIDGE_TOKEN;
        const prevHermesKey = process.env.HERMES_API_KEY;
        delete process.env.DATABASE_URL_PHASE1;
        delete process.env.HERMES_API_KEY;
        process.env.NODE_ENV = 'development';
        delete process.env.RISE_PATH_BRIDGE_TOKEN;
        setPoolForTests(optedInPool);

        try {
            await withServer(async (baseUrl) => {
                const response = await fetch(`${baseUrl}/api/v2/agent/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        skill: 'life-habit-analyst',
                        message: '睡眠と集中の関係は？',
                        context: {
                            from: '2026-06-01',
                            to: '2026-06-30',
                            timezone: 'Asia/Tokyo',
                        },
                        include_diary_excerpts: true,
                    }),
                });

                const payload = await response.json();
                assert.notEqual(payload.error_type, 'diary_excerpts_not_allowed');
                assert.equal(payload.error_type, 'hermes_not_configured');
            });
        } finally {
            resetPoolForTests();
            if (prevDb === undefined) delete process.env.DATABASE_URL_PHASE1;
            else process.env.DATABASE_URL_PHASE1 = prevDb;
            if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prevNodeEnv;
            if (prevBridge === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
            else process.env.RISE_PATH_BRIDGE_TOKEN = prevBridge;
            if (prevHermesKey === undefined) delete process.env.HERMES_API_KEY;
            else process.env.HERMES_API_KEY = prevHermesKey;
        }
    });

    it('does not return diary_excerpts_not_allowed when excerpts not requested', async () => {
        const prevDb = process.env.DATABASE_URL_PHASE1;
        const prevNodeEnv = process.env.NODE_ENV;
        const prevBridge = process.env.RISE_PATH_BRIDGE_TOKEN;
        const prevHermesKey = process.env.HERMES_API_KEY;
        delete process.env.DATABASE_URL_PHASE1;
        delete process.env.HERMES_API_KEY;
        process.env.NODE_ENV = 'development';
        delete process.env.RISE_PATH_BRIDGE_TOKEN;

        try {
            await withServer(async (baseUrl) => {
                const response = await fetch(`${baseUrl}/api/v2/agent/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        skill: 'life-habit-analyst',
                        message: '傾向は？',
                        context: {
                            from: '2026-06-01',
                            to: '2026-06-30',
                            timezone: 'Asia/Tokyo',
                        },
                        include_diary_excerpts: false,
                    }),
                });

                const payload = await response.json();
                assert.notEqual(payload.error_type, 'diary_excerpts_not_allowed');
            });
        } finally {
            resetPoolForTests();
            if (prevDb === undefined) delete process.env.DATABASE_URL_PHASE1;
            else process.env.DATABASE_URL_PHASE1 = prevDb;
            if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prevNodeEnv;
            if (prevBridge === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
            else process.env.RISE_PATH_BRIDGE_TOKEN = prevBridge;
            if (prevHermesKey === undefined) delete process.env.HERMES_API_KEY;
            else process.env.HERMES_API_KEY = prevHermesKey;
        }
    });
});

describe('startSseHeartbeat', () => {
    it('pings only while idle and between events, and stops on stop()', () => {
        mock.timers.enable({ apis: ['setInterval'] });
        const writes = [];
        const res = { writableEnded: false, write: (text) => { writes.push(text); return true; } };
        const pings = () => writes.filter((text) => text === ': ping\n\n').length;
        try {
            const heartbeat = startSseHeartbeat(res, { intervalMs: 1000 });
            mock.timers.tick(1000);
            assert.equal(pings(), 1, 'an idle tick before the first chunk pings');

            heartbeat.write('data: {"a":');
            mock.timers.tick(1000);
            mock.timers.tick(1000);
            mock.timers.tick(1000);
            assert.equal(pings(), 1, 'no ping inside an unfinished event');

            heartbeat.write('1}\n\n');
            mock.timers.tick(1000);
            mock.timers.tick(1000);
            assert.equal(pings(), 2, 'a ping follows the closing blank line within two ticks');
            assert.deepEqual(writes.slice(1, 3), ['data: {"a":', '1}\n\n'], 'chunks are forwarded unchanged');

            heartbeat.stop();
            mock.timers.tick(5000);
            assert.equal(pings(), 2, 'no ping after stop()');
        } finally {
            mock.timers.reset();
        }
    });
});
