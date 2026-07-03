import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import agentRoutes from '../routes/agent.js';

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

describe('POST /api/v2/agent/chat diary excerpt gate', () => {
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