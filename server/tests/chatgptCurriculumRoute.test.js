import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import chatgptCurriculumRoutes from '../routes/chatgptCurriculum.js';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v2', chatgptCurriculumRoutes);
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

describe('chatgptCurriculum route quality gate', () => {
    it('returns 422 before DB access when lesson quality is too thin', async () => {
        const originalToken = process.env.RISE_PATH_BRIDGE_TOKEN;
        const originalDb = process.env.DATABASE_URL_PHASE1;
        process.env.RISE_PATH_BRIDGE_TOKEN = '';
        delete process.env.DATABASE_URL_PHASE1;

        try {
            await withServer(async (baseUrl) => {
                const response = await fetch(`${baseUrl}/api/v2/ai/curriculum-drafts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        portal_id: 'general',
                        template_id: 'default',
                        policy_version: '2026-03-10.a',
                        intake: {
                            target_audience: '初学者',
                            goal: '学ぶ',
                            current_level: '初学者',
                            duration_weeks: 4,
                        },
                        curriculum: {
                            title: '薄い教材',
                            summary: '短い要約',
                            modules: [
                                {
                                    title: 'Module 1',
                                    goal: '基礎理解',
                                    lessons: [
                                        {
                                            title: 'Lesson 1',
                                            objective: '理解する',
                                        },
                                    ],
                                },
                            ],
                        },
                    }),
                });

                assert.equal(response.status, 422);
                const payload = await response.json();
                assert.equal(payload.error, 'quality rubric validation failed');
                assert.ok(Array.isArray(payload.quality_violations));
                assert.ok(payload.quality_violations.some((entry) => entry.includes('minimum is 6')));
            });
        } finally {
            if (originalToken === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
            else process.env.RISE_PATH_BRIDGE_TOKEN = originalToken;

            if (originalDb === undefined) delete process.env.DATABASE_URL_PHASE1;
            else process.env.DATABASE_URL_PHASE1 = originalDb;
        }
    });
});
