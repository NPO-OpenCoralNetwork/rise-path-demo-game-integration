// The learner's AI access routes (server/routes/aiAccess.js at /api/v2/user/ai-access) and the
// gate on the real server.js stack: every AI POST refuses before its daily cap, so a refused
// call is never charged. Development mode, tokens mapped to users with setSupabaseForTests.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { resetDailyCapsForTests } from '../middleware/dailyCaps.js';
import { resetGatewayForTests } from '../llm/index.js';
import { CONSENT_POLICY_VERSION, resetAiAccessForTests } from '../safety/access.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';

const ADULT = 'bbbbbbbb-0000-4000-8000-000000000001';
const CHILD = 'bbbbbbbb-0000-4000-8000-000000000002';
const NEW_USER = 'bbbbbbbb-0000-4000-8000-000000000003';
const CONSENTED = 'bbbbbbbb-0000-4000-8000-000000000004';
const TOKENS = { adult: ADULT, child: CHILD, new: NEW_USER, consented: CONSENTED };
const as = (who) => ({ Authorization: `Bearer ${who}` });

const ENV_KEYS = [
    'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI',
    'SAFETY_BLOCKS_BEFORE_PAUSE', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GEMINI_ALLOWED', 'LLM_PROVIDER', 'LLM_MOCK_FALLBACK',
    'LLM_MOCK_DELAY_MS', 'RISE_PATH_BRIDGE_TOKEN', 'VITE_FEATURE_AGENT_CHAT', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY',
];

const FEEDBACK = {
    text: 'I want to learn React because I want to build my own apps for my team.',
    rubric: { clarity: 'State the goal', linking: 'Use because/so', tone: 'Confident' },
    locale: 'en',
};
const LESSON = { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] };
const ANCHOR = { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書くと伝わりやすい。' };

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const call = async (url, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(url, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // SSE or empty
    }
    return { status: response.status, json, text };
};

const consent = (relationship = 'parent', policyVersion = CONSENT_POLICY_VERSION) => ({ relationship, agree: true, policyVersion });

describe('AI access on the server.js stack', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.LLM_PROVIDER = 'mock';
        process.env.LLM_MOCK_DELAY_MS = '0';
        resetGatewayForTests();
        resetDailyCapsForTests();
        resetAiAccessForTests();
        pool = createAiAccessPool({
            ages: { [ADULT]: '1990-05', [CHILD]: '2014-06', [CONSENTED]: '2013-01' },
            consents: [{ user_id: CONSENTED }],
        });
        setPoolForTests(pool);
        setSupabaseForTests({
            auth: { getUser: async (token) => ({ data: { user: TOKENS[token] ? { id: TOKENS[token] } : null }, error: null }) },
        });
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
        resetGatewayForTests();
        resetDailyCapsForTests();
        resetAiAccessForTests();
    });

    describe('/user/ai-access', () => {
        it('GET answers the state and the consent policy version', async () => {
            await withServer(async (base) => {
                const fresh = await call(`${base}/user/ai-access`, { headers: as('new') });
                assert.equal(fresh.status, 200);
                assert.deepEqual(fresh.json, {
                    status: 'needs_age', audience: null, birthYm: null, consent: null, ageEditable: true, policyVersion: CONSENT_POLICY_VERSION,
                });
                const adult = await call(`${base}/user/ai-access`, { headers: as('adult') });
                assert.equal(adult.json.status, 'ready');
                assert.equal(adult.json.audience, 'adult');
                const child = await call(`${base}/user/ai-access`, { headers: as('child') });
                assert.equal(child.json.status, 'needs_guardian_consent');
                assert.equal(child.json.audience, 'minor');
                assert.equal(child.json.birthYm, '2014-06');
            });
        });

        it('PUT /age: 400 for a bad month, then once only (409 age_already_set)', async () => {
            await withServer(async (base) => {
                for (const birthYm of ['2014-13', '2099-01', '1899-12', 201406, undefined]) {
                    const bad = await call(`${base}/user/ai-access/age`, { method: 'PUT', body: { birthYm }, headers: as('new') });
                    assert.equal(bad.status, 400, String(birthYm));
                    assert.equal(bad.json.error_type, 'invalid_birth_ym');
                }
                const set = await call(`${base}/user/ai-access/age`, { method: 'PUT', body: { birthYm: '2015-02' }, headers: as('new') });
                assert.equal(set.status, 200, set.text);
                assert.equal(set.json.status, 'needs_guardian_consent');
                assert.equal(set.json.birthYm, '2015-02');
                assert.equal(set.json.ageEditable, false);
                assert.equal(pool.ages[NEW_USER], '2015-02');

                const again = await call(`${base}/user/ai-access/age`, { method: 'PUT', body: { birthYm: '1990-01' }, headers: as('new') });
                assert.equal(again.status, 409);
                assert.equal(again.json.error_type, 'age_already_set');
                assert.equal(pool.ages[NEW_USER], '2015-02', 'unchanged');

                const adult = await call(`${base}/user/ai-access/age`, { method: 'PUT', body: { birthYm: '2015-02' }, headers: as('adult') });
                assert.equal(adult.status, 409, 'an adult cannot turn into a child either');
            });
        });

        it('POST /guardian-consent: body, version, age and minor checks, then AI is ready; revoke stops it', async () => {
            await withServer(async (base) => {
                const url = `${base}/user/ai-access/guardian-consent`;
                const notAgreed = await call(url, { method: 'POST', body: { ...consent(), agree: false }, headers: as('child') });
                assert.equal(notAgreed.status, 400);
                assert.equal(notAgreed.json.error_type, 'invalid_body');
                assert.equal((await call(url, { method: 'POST', body: consent('teacher'), headers: as('child') })).status, 400);

                const oldText = await call(url, { method: 'POST', body: consent('parent', 'guardian-ai-2025-01'), headers: as('child') });
                assert.equal(oldText.status, 409);
                assert.equal(oldText.json.error_type, 'policy_version_mismatch');
                assert.equal(oldText.json.policyVersion, CONSENT_POLICY_VERSION);

                const noAge = await call(url, { method: 'POST', body: consent(), headers: as('new') });
                assert.equal(noAge.status, 400);
                assert.equal(noAge.json.error_type, 'age_required');
                const adult = await call(url, { method: 'POST', body: consent(), headers: as('adult') });
                assert.equal(adult.status, 400);
                assert.equal(adult.json.error_type, 'not_a_minor');
                assert.equal(pool.consents.length, 1, 'nothing recorded yet');

                const given = await call(url, { method: 'POST', body: consent('guardian'), headers: as('child') });
                assert.equal(given.status, 201, given.text);
                assert.equal(given.json.status, 'ready');
                assert.equal(given.json.consent.method, 'guardian_on_device');
                assert.equal(given.json.consent.relationship, 'guardian');
                const row = pool.consents.at(-1);
                assert.equal(row.user_id, CHILD);
                assert.equal(row.policy_version, CONSENT_POLICY_VERSION);
                assert.equal(row.recorded_by, null);
                assert.ok(!('guardian_name' in row), 'no guardian name stored');

                assert.equal((await call(`${base}/llm/writing-feedback`, { method: 'POST', body: FEEDBACK, headers: as('child') })).status, 200, 'AI works now');

                const revoked = await call(`${url}/revoke`, { method: 'POST', headers: as('child') });
                assert.equal(revoked.status, 200);
                assert.equal(revoked.json.status, 'needs_guardian_consent');
                const stopped = await call(`${base}/llm/writing-feedback`, { method: 'POST', body: FEEDBACK, headers: as('child') });
                assert.equal(stopped.status, 403, 'the cache was invalidated: AI stops at once');
                assert.equal(stopped.json.error_type, 'guardian_consent_required');
            });
        });

        it('answers 503 ai_access_unavailable when the database fails, and writes need a database', async () => {
            pool = createAiAccessPool({ fail: (sql) => sql.includes('user_age') });
            setPoolForTests(pool);
            await withServer(async (base) => {
                const state = await call(`${base}/user/ai-access`, { headers: as('adult') });
                assert.equal(state.status, 503);
                assert.equal(state.json.error_type, 'ai_access_unavailable');
                assert.ok(!state.text.includes('fake failure'), 'no database text');
            });
            setPoolForTests(null);
            await withServer(async (base) => {
                assert.equal((await call(`${base}/user/ai-access`, { headers: as('adult') })).json.audience, 'adult', 'development without a database: adult');
                const put = await call(`${base}/user/ai-access/age`, { method: 'PUT', body: { birthYm: '2010-01' }, headers: as('adult') });
                assert.equal(put.status, 503);
                assert.equal(put.json.error_type, 'ai_access_unavailable');
            });
        });

        it('production without a database: 503, never a pass', async () => {
            process.env.NODE_ENV = 'production';
            process.env.AI_ACCESS_DEV_AUDIENCE = 'adult';
            setPoolForTests(null);
            await withServer(async (base) => {
                const state = await call(`${base}/user/ai-access`, { headers: as('adult') });
                assert.equal(state.status, 503);
                assert.equal(state.json.error_type, 'ai_access_unavailable');
                assert.equal((await call(`${base}/user/ai-access`)).status, 401, 'requireAuth first');
            });
        });
    });

    describe('/safety and /admin mounts', () => {
        it('/admin wants the admin role read on the server; an admin records a paper consent', async () => {
            pool.roles[ADULT] = 'admin';
            await withServer(async (base) => {
                const learner = await call(`${base}/admin/safety/summary`, { headers: as('child') });
                assert.equal(learner.status, 403);
                assert.equal(learner.json.error_type, 'admin_only');
                assert.equal((await call(`${base}/admin/safety/summary`)).status, 403, 'the dev fallback user is no admin');

                const consentByStaff = await call(`${base}/admin/users/${CHILD}/guardian-consent`, { method: 'POST', body: { relationship: 'parent' }, headers: as('adult') });
                assert.equal(consentByStaff.status, 201, consentByStaff.text);
                const row = pool.consents.at(-1);
                assert.equal(row.user_id, CHILD);
                assert.equal(row.method, 'staff_paper_form');
                assert.equal(row.recorded_by, ADULT);
                const child = await call(`${base}/user/ai-access`, { headers: as('child') });
                assert.equal(child.json.status, 'ready', 'the cache was invalidated');

                const staffAge = await call(`${base}/admin/users/${NEW_USER}/age`, { method: 'PUT', body: { birthYm: '2012-03', declaredBy: 'staff' }, headers: as('adult') });
                assert.equal(staffAge.status, 200, staffAge.text);
                assert.equal(pool.ages[NEW_USER], '2012-03');
            });
        });

        it('/safety/reports is open to any signed-in user', async () => {
            await withServer(async (base) => {
                const report = await call(`${base}/safety/reports`, {
                    method: 'POST',
                    body: { surface: 'tutor', reason: 'wrong', answer: 'The answer was wrong.' },
                    headers: as('child'),
                });
                assert.notEqual(report.status, 401);
                assert.notEqual(report.status, 403, 'no AI access needed to report');
                assert.notEqual(report.status, 404);
            });
        });
    });

    describe('the gate on every AI POST', () => {
        const AI_POSTS = [
            ['/llm/writing-feedback', FEEDBACK],
            ['/llm/personality-insight', { scores: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 }, locale: 'jp' }],
            ['/llm/tutor', { message: 'これは何？', lesson: LESSON, anchor: ANCHOR }],
            ['/ai/generate', { message: 'SQLを学びたい' }],
            ['/image', { prompt: 'a cat reading a book' }],
            ['/agent/chat', { skill: 'life-habit-analyst', message: '傾向は？', context: { from: '2026-06-01', to: '2026-06-30', timezone: 'Asia/Tokyo' } }],
        ];

        const ADULTS_ONLY_POSTS = new Set(['/image', '/agent/chat']);

        it('image generation and Hermes chat are adults only, even with a guardian consent', async () => {
            process.env.VITE_FEATURE_AGENT_CHAT = 'true';
            await withServer(async (base) => {
                for (const [path, body] of AI_POSTS.filter(([path]) => ADULTS_ONLY_POSTS.has(path))) {
                    const result = await call(`${base}${path}`, { method: 'POST', body, headers: as('consented') });
                    assert.equal(result.status, 403, `${path}: ${result.text}`);
                    assert.equal(result.json.error_type, 'adults_only', path);
                }
            });
            assert.deepEqual(pool.charged(), [], 'no ai_daily_usage reservation');
        });

        for (const [who, errorType] of [['new', 'age_required'], ['child', 'guardian_consent_required']]) {
            it(`refuses ${who} with 403 ${errorType} and never charges a daily cap`, async () => {
                process.env.VITE_FEATURE_AGENT_CHAT = 'true';
                await withServer(async (base) => {
                    for (const [path, body] of AI_POSTS) {
                        const result = await call(`${base}${path}`, { method: 'POST', body, headers: as(who) });
                        assert.equal(result.status, 403, `${path}: ${result.text}`);
                        // Image generation and Hermes are adults only: a minor hears adults_only there.
                        const expected = who === 'child' && ADULTS_ONLY_POSTS.has(path) ? 'adults_only' : errorType;
                        assert.equal(result.json.error_type, expected, path);
                    }
                });
                assert.deepEqual(pool.charged(), [], 'no ai_daily_usage reservation');
            });
        }

        it('pauses after too many blocked inputs today, without charging', async () => {
            process.env.SAFETY_BLOCKS_BEFORE_PAUSE = '2';
            pool.events.push(
                { user_id: CONSENTED, kind: 'input_blocked', created_at: new Date() },
                { user_id: CONSENTED, kind: 'input_blocked', created_at: new Date() },
            );
            await withServer(async (base) => {
                const result = await call(`${base}/llm/writing-feedback`, { method: 'POST', body: FEEDBACK, headers: as('consented') });
                assert.equal(result.status, 403);
                assert.equal(result.json.error_type, 'ai_paused_safety');
                assert.ok(result.json.paused_until);
            });
            assert.deepEqual(pool.charged(), []);
        });

        it('lets an adult and a consented minor through (and charges them)', async () => {
            await withServer(async (base) => {
                assert.equal((await call(`${base}/llm/writing-feedback`, { method: 'POST', body: FEEDBACK, headers: as('adult') })).status, 200);
                assert.equal(pool.charged().length > 0, true, 'the adult call was charged');
                const before = pool.charged().length;
                assert.equal((await call(`${base}/llm/writing-feedback`, { method: 'POST', body: FEEDBACK, headers: as('consented') })).status, 200);
                assert.ok(pool.charged().length > before);
            });
        });

        it('guests: 401 sign_in_required without LLM_GUEST_AI; GET /llm/status stays open', async () => {
            await withServer(async (base) => {
                const guest = await call(`${base}/llm/tutor`, { method: 'POST', body: { message: 'hi', lesson: LESSON, anchor: ANCHOR } });
                assert.equal(guest.status, 401);
                assert.equal(guest.json.error_type, 'sign_in_required');
                assert.equal((await call(`${base}/llm/status`)).status, 200);
            });
            process.env.LLM_GUEST_AI = 'true';
            await withServer(async (base) => {
                const guest = await call(`${base}/llm/writing-feedback`, { method: 'POST', body: FEEDBACK });
                assert.equal(guest.status, 200, guest.text);
            });
        });

        it('external course drafts and publishing: adults only for a learner JWT', async () => {
            await withServer(async (base) => {
                for (const [path, body] of [
                    ['/ai/curriculum-drafts', { portal_id: 'general', template_id: 'default' }],
                    ['/curricula/cccccccc-0000-4000-8000-000000000001/publish', { curriculum_version_id: 'cccccccc-0000-4000-8000-000000000002' }],
                ]) {
                    const consented = await call(`${base}${path}`, { method: 'POST', body, headers: as('consented') });
                    assert.equal(consented.status, 403, `${path}: ${consented.text}`);
                    assert.equal(consented.json.error_type, 'adults_only', 'even with a guardian consent');
                    assert.equal((await call(`${base}${path}`, { method: 'POST', body, headers: as('new') })).json.error_type, 'age_required');
                    const adult = await call(`${base}${path}`, { method: 'POST', body, headers: as('adult') });
                    assert.notEqual(adult.status, 403, `${path}: an adult passes the gate (${adult.text})`);
                }
            });
        });
    });
});
