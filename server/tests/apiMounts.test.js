import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { ORIGIN_SECRET_HEADER } from '../middleware/originGate.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

/**
 * Which auth and limiter each /api/v2 mount in server.js ends up with, in production (strict auth,
 * no dev fallback). Supabase is not initialized here, so no JWT validates: a 401 means "this
 * mount wants a JWT", a 200 or 503 means the request passed auth.
 */
const BRIDGE_TOKEN = 'test-bridge-token-for-api-mounts';
const SECRET = 'test-origin-secret-for-api-mounts-0123456789';
const quietLogger = { warn: () => {} };

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'TRUST_PROXY', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'HERMES_API_KEY', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI', 'VITE_FEATURE_AGENT_CHAT'];

const withApp = async (originGate, handler) => {
    const app = await createApp({ serveStatic: false, originGate });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const bridge = { 'x-nexloom-bridge-token': BRIDGE_TOKEN };

describe('server.js /api/v2 mounts (production)', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        resetPoolForTests();
        setPoolForTests(null);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        resetPoolForTests();
    });

    it('content routes want a JWT and no longer pay the AI limiter of the agent mount', async () => {
        await withApp(undefined, async (base) => {
            for (let i = 0; i < 12; i += 1) {
                const response = await fetch(`${base}/api/v2/curricula`, { headers: bridge });
                assert.equal(response.status, 401, `request ${i + 1}: requireAuth wants a JWT, not 429`);
            }
        });
    });

    it('learner memory and the agent proxy still require auth; the bridge token works from loopback', async () => {
        await withApp(undefined, async (base) => {
            assert.equal((await fetch(`${base}/api/v2/learner-memory`)).status, 401);
            assert.equal((await fetch(`${base}/api/v2/agent/health`)).status, 401);
            assert.equal((await fetch(`${base}/api/v2/learner-memory`, { headers: bridge })).status, 503, 'passed auth, then no DB');
            const health = await fetch(`${base}/api/v2/agent/health`, { headers: bridge });
            assert.equal(health.status, 200);
            assert.equal((await health.json()).ok, true);
        });
    });

    it('with ORIGIN_SECRET set: loopback keeps bridge auth, an edge request needs a JWT', async () => {
        process.env.ORIGIN_SECRET = SECRET;
        await withApp(undefined, async (base) => {
            assert.equal((await fetch(`${base}/api/v2/agent/health`, { headers: bridge })).status, 200);
        });
        await withApp({ exemptLoopback: false, logger: quietLogger }, async (base) => {
            const edge = { ...bridge, [ORIGIN_SECRET_HEADER]: SECRET };
            assert.equal((await fetch(`${base}/api/v2/agent/health`, { headers: edge })).status, 401);
            const bearer = { Authorization: `Bearer ${BRIDGE_TOKEN}`, [ORIGIN_SECRET_HEADER]: SECRET };
            assert.equal((await fetch(`${base}/api/v2/agent/health`, { headers: bearer })).status, 401);
        });
    });

    it('the AI access, safety and admin mounts want a JWT', async () => {
        await withApp(undefined, async (base) => {
            assert.equal((await fetch(`${base}/api/v2/user/ai-access`)).status, 401);
            assert.equal((await fetch(`${base}/api/v2/user/ai-access/age`, { method: 'PUT', headers: bridge })).status, 401, 'not a bridge route');
            assert.equal((await fetch(`${base}/api/v2/safety/reports`, { method: 'POST' })).status, 401);
            assert.equal((await fetch(`${base}/api/v2/admin/safety/summary`, { headers: bridge })).status, 401);
        });
    });

    it('the connected-apps mount wants a JWT, not the bridge token', async () => {
        await withApp(undefined, async (base) => {
            assert.equal((await fetch(`${base}/api/v2/user/connected-apps`)).status, 401);
            assert.equal((await fetch(`${base}/api/v2/user/connected-apps`, { headers: bridge })).status, 401);
            const revoke = await fetch(`${base}/api/v2/user/connected-apps/11111111-2222-4000-8000-000000000001/revoke`, { method: 'POST', headers: bridge });
            assert.equal(revoke.status, 401);
        });
    });

    it('the lesson-progress mount wants a JWT, not the bridge token (it is not under the bridge routes)', async () => {
        await withApp(undefined, async (base) => {
            for (const method of ['GET', 'PUT', 'DELETE']) {
                const init = method === 'PUT'
                    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ epoch: null, records: [] }) }
                    : { method };
                assert.equal((await fetch(`${base}/api/v2/user/lesson-progress`, init)).status, 401, `${method} without a JWT`);
                assert.equal((await fetch(`${base}/api/v2/user/lesson-progress`, { ...init, headers: { ...init.headers, ...bridge } })).status, 401, `${method} bridge`);
            }
            // Phase 5: starting one lesson over, on the same mount.
            const reset = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ epoch: null, courseSlug: 'vibe-coding', lessonId: 'vibe-ch1' }) };
            assert.equal((await fetch(`${base}/api/v2/user/lesson-progress/lesson-reset`, reset)).status, 401, 'POST /lesson-reset without a JWT');
            assert.equal((await fetch(`${base}/api/v2/user/lesson-progress/lesson-reset`, { ...reset, headers: { ...reset.headers, ...bridge } })).status, 401, 'POST /lesson-reset bridge');
        });
    });

    it('the account deletion mount (Phase 4) wants a JWT, not the bridge token', async () => {
        await withApp(undefined, async (base) => {
            for (const method of ['GET', 'POST']) {
                const init = method === 'POST'
                    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'delete-my-account' }) }
                    : { method };
                assert.equal((await fetch(`${base}/api/v2/user/account/deletion`, init)).status, 401, `${method} without a JWT`);
                const viaBridge = await fetch(`${base}/api/v2/user/account/deletion`, { ...init, headers: { ...init.headers, ...bridge } });
                assert.equal(viaBridge.status, 401, `${method} bridge`);
            }
        });
    });

    it('the legal mount (Phase 4) wants a JWT, not the bridge token', async () => {
        await withApp(undefined, async (base) => {
            const body = JSON.stringify({ termsVersion: 'terms-draft-2026-10-22', privacyVersion: 'privacy-draft-2026-10-22' });
            for (const [method, path] of [['GET', '/api/v2/user/legal'], ['POST', '/api/v2/user/legal/acceptance']]) {
                const init = method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body } : { method };
                assert.equal((await fetch(`${base}${path}`, init)).status, 401, `${method} without a JWT`);
                const viaBridge = await fetch(`${base}${path}`, { ...init, headers: { ...init.headers, ...bridge } });
                assert.equal(viaBridge.status, 401, `${method} bridge`);
            }
        });
    });

    it('the achievements and learning-history mounts (Phase 5) want a JWT, not the bridge token', async () => {
        await withApp(undefined, async (base) => {
            for (const [method, path] of [['GET', '/api/v2/user/achievements'], ['GET', '/api/v2/user/events'], ['POST', '/api/v2/user/events']]) {
                const init = method === 'POST'
                    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lesson_start', title: {}, description: {} }) }
                    : { method };
                assert.equal((await fetch(`${base}${path}`, init)).status, 401, `${method} ${path} without a JWT`);
                const viaBridge = await fetch(`${base}${path}`, { ...init, headers: { ...init.headers, ...bridge } });
                assert.equal(viaBridge.status, 401, `${method} ${path} bridge`);
            }
        });
    });

    it('the review queue mount (Phase 6) wants a JWT, not the bridge token, for the read and the grade', async () => {
        await withApp(undefined, async (base) => {
            const grade = { courseSlug: 'vibe-coding', lessonId: 'vibe-ch1', cardId: 'card-frontend', rating: 'good' };
            for (const [method, path] of [['GET', '/api/v2/user/review'], ['POST', '/api/v2/user/review/grade']]) {
                const init = method === 'POST'
                    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(grade) }
                    : { method };
                assert.equal((await fetch(`${base}${path}`, init)).status, 401, `${method} ${path} without a JWT`);
                const viaBridge = await fetch(`${base}${path}`, { ...init, headers: { ...init.headers, ...bridge } });
                assert.equal(viaBridge.status, 401, `${method} ${path} bridge`);
            }
        });
    });

    it('a connected agent\'s OAuth token is refused on JWT, bridge/JWT and LLM mounts', async () => {
        const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const agentToken = `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
            sub: 'cccccccc-0000-4000-8000-000000000001', aud: 'https://mcp.example.org/mcp', role: 'authenticated',
            client_id: 'dddddddd-0000-4000-8000-000000000001', exp: 4_000_000_000,
        })}.c2ln`;
        const agent = { Authorization: `Bearer ${agentToken}` };
        await withApp(undefined, async (base) => {
            for (const path of ['/api/v2/user/connected-apps', '/api/v2/user/ai-access', '/api/v2/user/lesson-progress', '/api/v2/user/account/deletion', '/api/v2/user/legal', '/api/v2/user/achievements', '/api/v2/user/events', '/api/v2/user/review', '/api/v2/curricula', '/api/v2/learner-memory', '/api/v2/agent/health']) {
                const response = await fetch(`${base}${path}`, { headers: agent });
                assert.equal(response.status, 401, path);
                assert.equal((await response.json()).error_type, 'oauth_client_token', path);
            }
            const deletion = await fetch(`${base}/api/v2/user/account/deletion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...agent },
                body: JSON.stringify({ confirm: 'delete-my-account' }),
            });
            assert.deepEqual([deletion.status, (await deletion.json()).error_type], [401, 'oauth_client_token'], 'an agent can never delete the account');
            const acceptance = await fetch(`${base}/api/v2/user/legal/acceptance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...agent },
                body: JSON.stringify({ termsVersion: 'terms-draft-2026-10-22', privacyVersion: 'privacy-draft-2026-10-22' }),
            });
            assert.deepEqual([acceptance.status, (await acceptance.json()).error_type], [401, 'oauth_client_token'], 'an agent never accepts the terms for the person');
            const review = await fetch(`${base}/api/v2/user/review/grade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...agent },
                body: JSON.stringify({ courseSlug: 'vibe-coding', lessonId: 'vibe-ch1', cardId: 'card-frontend', rating: 'good' }),
            });
            assert.deepEqual([review.status, (await review.json()).error_type], [401, 'oauth_client_token'], 'an AI app grades only through the MCP review tools');
            // optionalAuth (the LLM gateway): the agent counts as a guest, so an AI POST wants sign-in.
            const tutor = await fetch(`${base}/api/v2/llm/tutor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...agent },
                body: JSON.stringify({
                    message: 'hi',
                    lesson: { courseId: 'vibe', lessonId: 'ch1', title: 'Vibe Coding', objectives: ['explain the flow'] },
                    anchor: { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'Write the goal first.' },
                }),
            });
            assert.equal(tutor.status, 401);
            assert.equal((await tutor.json()).error_type, 'sign_in_required');
        });
    });

    it('AI POSTs: guests get 401 sign_in_required, GET /llm/status stays public', async () => {
        process.env.AI_ACCESS_DEV_AUDIENCE = 'adult'; // ignored in production
        await withApp(undefined, async (base) => {
            const status = await fetch(`${base}/api/v2/llm/status`);
            assert.equal(status.status, 200);
            await status.text();
            const guest = await fetch(`${base}/api/v2/llm/tutor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'hi',
                    lesson: { courseId: 'vibe', lessonId: 'ch1', title: 'Vibe Coding', objectives: ['explain the flow'] },
                    anchor: { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'Write the goal first.' },
                }),
            });
            assert.equal(guest.status, 401);
            assert.equal((await guest.json()).error_type, 'sign_in_required');
        });
    });

    it('without a database the AI access gate fails closed (503), even for the bridge user', async () => {
        process.env.AI_ACCESS_DEV_AUDIENCE = 'adult'; // ignored in production
        process.env.VITE_FEATURE_AGENT_CHAT = 'true';
        await withApp(undefined, async (base) => {
            const chat = await fetch(`${base}/api/v2/agent/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...bridge },
                body: JSON.stringify({ skill: 'life-habit-analyst', message: 'hi' }),
            });
            assert.equal(chat.status, 503);
            assert.equal((await chat.json()).error_type, 'ai_access_unavailable');
            // External course drafts: the bridge token is the operator path, not gated (then no DB).
            const draft = await fetch(`${base}/api/v2/ai/curriculum-drafts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...bridge },
                body: JSON.stringify({}),
            });
            assert.notEqual(draft.status, 403);
            assert.notEqual((await draft.json()).error_type, 'ai_access_unavailable');
        });
    });

    it('the legacy POST /api/generate-audio is gone', async () => {
        await withApp(undefined, async (base) => {
            const response = await fetch(`${base}/api/generate-audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 'course-1', chapters: [] }),
            });
            assert.equal(response.status, 404);
        });
    });
});
