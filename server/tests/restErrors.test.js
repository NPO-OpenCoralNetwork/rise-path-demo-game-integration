// REST error answers on the real server.js stack. A response never carries the database's or a
// provider's own text (Postgres messages name tables, hosts and the values sent), and an id that is
// not a UUID answers like an unknown id, with the route's own 404, before any query.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Read when kokoroTts.js is imported (through server.js): a port where no TTS sidecar listens.
process.env.KOKORO_TTS_URL = 'http://127.0.0.1:1';
const { createApp } = await import('../../server.js');
const { setPoolForTests, resetPoolForTests } = await import('../db.js');
const { setSupabaseForTests } = await import('../middleware/auth.js');
const { resetDailyCapsForTests } = await import('../middleware/dailyCaps.js');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GOOD = 'b0000000-0000-4000-8000-000000000002';
const AS_A = { Authorization: 'Bearer token-a' };
const MALFORMED = ['not-a-uuid', `${GOOD}x`];
// No Postgres error code, so tools/core/dbErrors.js classifyDbError takes its fallback branch,
// which puts the message in its own text.
const SECRET = 'relation "secret_table" does not exist (host db.internal:5432)';

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1', 'TRUST_PROXY', 'ORIGIN_SECRET', 'KOKORO_TTS_CACHE_DIR', 'AI_ACCESS_DEV_AUDIENCE'];

const EMPTY = { rowCount: 0, rows: [] };
const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The deleted-account check every signed-in request makes first (tools/core/accountDeletions.js). */
const ACCOUNT_STATE_READ = 'select deleted_at, reopened_at from account_deletions';

/**
 * Mock pool. Like Postgres, a parameter used as a uuid (CAST($n AS uuid), $n::uuid, or the
 * implicit cast of notifications.id = $1) that is not a UUID fails the statement with 22P02.
 * `fail`: every query throws SECRET, except the deleted-account check of sign-in (no tombstone),
 * so each route reaches its own failure; `failAccountState`: only that check throws SECRET;
 * `connectFails`: pool.connect() rejects with it.
 */
function createPool({ fail = false, failAccountState = false, connectFails = false } = {}) {
    const queries = [];
    const run = async (sql, params = []) => {
        const text = norm(sql);
        queries.push({ sql: text, params });
        if (text.startsWith(ACCOUNT_STATE_READ)) {
            if (failAccountState) throw new Error(SECRET);
            return EMPTY;
        }
        if (fail) throw new Error(SECRET);
        const uuidParams = [...text.matchAll(/cast\(\$(\d+) as uuid\)|\$(\d+)::uuid/g)].map(([, a, b]) => Number(a ?? b));
        if (text.startsWith('update notifications set read = true where id = $1')) uuidParams.push(1);
        for (const n of uuidParams) {
            const value = params[n - 1];
            if (typeof value === 'string' && !UUID_RE.test(value)) {
                throw Object.assign(new Error(`invalid input syntax for type uuid: "${value}"`), { code: '22P02' });
            }
        }
        if (text.startsWith('insert into ai_daily_usage')) return { rowCount: 1, rows: [{ count: 1 }] };
        return EMPTY;
    };
    return {
        queries,
        query: run,
        connect: async () => {
            if (connectFails) throw new Error(SECRET);
            return { query: run, release: () => {} };
        },
    };
}

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

const call = async (base, method, urlPath, { headers = AS_A, body, rawBody } = {}) => {
    const response = await fetch(`${base}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text };
};

/** No database or provider text, and no detail/details key, in a response. */
const assertNoLeak = (result, label) => {
    for (const fragment of ['secret_table', 'db.internal', 'invalid input syntax', 'fetch failed', 'ECONNREFUSED', '.js:']) {
        assert.ok(!result.text.includes(fragment), `${label}: "${fragment}" in ${result.text.slice(0, 300)}`);
    }
    assert.ok(result.json && typeof result.json === 'object', `${label}: JSON body, got ${result.text.slice(0, 200)}`);
    assert.ok(!('detail' in result.json) && !('details' in result.json), `${label}: ${result.text.slice(0, 300)}`);
};

const INTAKE = { target_audience: '初学者', goal: '学ぶ', current_level: '初学者', duration_weeks: 4 };
// Long enough to pass the quality rubric, so curriculum-drafts gets as far as saving.
const LONG = 'これは説明文です。'.repeat(80);
const RICH_LESSON = {
    title: 'Lesson 1', objective: '理解する', summary: LONG, explanation: LONG, why_it_matters: LONG,
    key_points: ['a', 'b', 'c'], examples: ['e1', 'e2'], practice: ['p1', 'p2', 'p3', 'p4'],
    checklist: ['c1'], cautions: ['x'], reflection: 'r', takeaway: 't',
};
const RICH = { title: '教材', summary: '要約', modules: [{ title: 'Module 1', goal: '基礎理解', lessons: [RICH_LESSON] }] };
const RAW_PROFILE = {
    big_five: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
    learning_style: 'visual',
    motivation: 'career',
};
const JOURNAL = { module_id: 'm1', lesson_id: 'l1', learned: 'SQL joins' };

const CURRICULUM_NOT_FOUND = { error: 'Curriculum not found' };
const VERSION_NOT_FOUND = { error: 'Curriculum version not found' };

/** [method, path for an id, body for an id, the 404 body]: each route that sends an id to Postgres as a uuid. */
const ID_ROUTES = [
    ['GET', (id) => `/curricula/${id}`, null, { error: 'Not found' }],
    ['GET', (id) => `/jobs/${id}`, null, { error: 'Job not found' }],
    ['GET', (id) => `/curricula/${id}/resume`, null, CURRICULUM_NOT_FOUND],
    ['POST', (id) => `/curricula/${id}/weekly-load`, () => ({}), CURRICULUM_NOT_FOUND],
    ['GET', (id) => `/curricula/${id}/summary-cards`, null, CURRICULUM_NOT_FOUND],
    ['GET', (id) => `/curricula/${id}/weekly-digest`, null, CURRICULUM_NOT_FOUND],
    ['GET', (id) => `/curricula/${id}/encyclopedia`, null, CURRICULUM_NOT_FOUND],
    ['POST', (id) => `/curricula/${id}/journal`, () => JOURNAL, CURRICULUM_NOT_FOUND],
    ['GET', (id) => `/curricula/${id}/journal`, null, CURRICULUM_NOT_FOUND],
    ['GET', (id) => `/adaptation?curriculum_id=${id}`, null, CURRICULUM_NOT_FOUND],
    ['POST', (id) => `/curricula/${id}/publish`, () => ({ curriculum_version_id: GOOD }), VERSION_NOT_FOUND],
    ['POST', () => `/curricula/${GOOD}/publish`, (id) => ({ curriculum_version_id: id }), VERSION_NOT_FOUND],
    ['POST', () => '/ai/curriculum-drafts', (id) => ({ curriculum_id: id, intake: INTAKE, curriculum: RICH }), CURRICULUM_NOT_FOUND],
    ['PUT', (id) => `/user/notifications/${id}/read`, () => ({}), { error: 'Notification not found' }],
];

/** [method, path, body, status, error]: each route's fixed answer when its query fails. */
const FAILING_ROUTES = [
    ['GET', '/curricula', undefined, 500, 'Failed to load curricula'],
    ['GET', `/curricula/${GOOD}`, undefined, 500, 'Failed to load curriculum'],
    ['GET', `/jobs/${GOOD}`, undefined, 500, 'Failed to check job'],
    ['POST', '/ai/curriculum-drafts', { intake: INTAKE, curriculum: RICH }, 500, 'Failed to save curriculum draft'],
    ['POST', '/learner-profiles/assessments', { raw_profile: RAW_PROFILE }, 500, 'Failed to save learner profile'],
    ['GET', '/learner-profiles/latest', undefined, 500, 'Failed to retrieve learner profile'],
    ['GET', `/curricula/${GOOD}/resume`, undefined, 500, 'Failed to build resume card'],
    ['POST', `/curricula/${GOOD}/weekly-load`, {}, 500, 'Failed to adjust weekly load'],
    ['GET', `/curricula/${GOOD}/summary-cards`, undefined, 500, 'Failed to build summary cards'],
    ['GET', `/curricula/${GOOD}/weekly-digest`, undefined, 500, 'Failed to build weekly digest'],
    ['GET', `/curricula/${GOOD}/encyclopedia`, undefined, 500, 'Failed to build encyclopedia'],
    ['POST', `/curricula/${GOOD}/journal`, JOURNAL, 500, 'Failed to save journal entry'],
    ['GET', `/curricula/${GOOD}/journal`, undefined, 500, 'Failed to fetch journal'],
    ['GET', '/journal/recent', undefined, 500, 'Failed to fetch recent journal'],
    ['GET', '/adaptation', undefined, 503, 'Failed to get adaptation signals'],
    ['POST', `/curricula/${GOOD}/publish`, { curriculum_version_id: GOOD }, 500, 'Failed to publish curriculum'],
    ['PUT', '/learner-memory/privacy', { enabled: false }, 500, 'Failed to update AI memory privacy settings'],
    ['PUT', '/life-journal/daily/2026-01-05?timezone=UTC', { reflection: { mood: 'good' } }, 500, 'Failed to save life journal entry'],
    ['GET', '/life-journal/daily/2026-01-05?timezone=UTC', undefined, 500, 'Failed to fetch life journal entry'],
    ['GET', '/life-journal/range?from=2026-01-01&to=2026-01-07&timezone=UTC', undefined, 500, 'Failed to fetch life journal range'],
    ['GET', '/life-journal/analysis?from=2026-01-01&to=2026-01-07&timezone=UTC', undefined, 500, 'Failed to analyze life journal'],
    ['GET', '/life-journal/export?from=2026-01-01&to=2026-01-07&timezone=UTC', undefined, 500, 'Failed to export life journal data'],
    ['DELETE', '/life-journal/data', { confirm: 'DELETE', scope: 'all' }, 500, 'Failed to delete life journal data'],
    ['POST', '/life-journal/advice?timezone=UTC', { from: '2026-01-01', to: '2026-01-07' }, 500, 'Failed to fetch life journal advice'],
    ['PUT', `/user/notifications/${GOOD}/read`, {}, 500, 'Failed to mark read'],
    // Phase 5: XP and badges, and the learning history (with error_type now).
    ['GET', '/user/achievements', undefined, 500, 'XP and badges could not be read.'],
    ['GET', '/user/events', undefined, 500, 'Failed to load events'],
    ['POST', '/user/events', { type: 'lesson_start', title: { en: 'Started: x', jp: '開始: x' }, description: {} }, 500, 'Failed to add event'],
];

describe('REST error answers', () => {
    const saved = {};
    let cacheDir;

    before(() => {
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-errors-tts-'));
    });
    after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        // Outside production: the old answers sent the database text here (lifeJournal.js only here).
        process.env.NODE_ENV = 'development';
        process.env.KOKORO_TTS_CACHE_DIR = cacheDir;
        process.env.AI_ACCESS_DEV_AUDIENCE = 'adult'; // past the AI access gate (aiAccessGate.js) without age rows
        resetDailyCapsForTests();
        setSupabaseForTests({
            auth: { getUser: async (token) => ({ data: { user: token === 'token-a' ? { id: USER_A } : null }, error: null }) },
        });
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
        resetDailyCapsForTests();
    });

    for (const [method, pathFor, bodyFor, notFound] of ID_ROUTES) {
        const label = `${method} ${pathFor(':id').replace(GOOD, ':id')}${pathFor('x') === pathFor('y') ? ' (id in the body)' : ''}`;
        it(`${label}: an id that is not a UUID is ${notFound.error}, and no query carries it`, async () => {
            const pool = createPool();
            setPoolForTests(pool);
            await withServer(async (base) => {
                for (const id of MALFORMED) {
                    const result = await call(base, method, pathFor(id), { body: bodyFor?.(id) });
                    assert.equal(result.status, 404, `${id}: ${result.text.slice(0, 300)}`);
                    assert.deepEqual(result.json, notFound);
                    assertNoLeak(result, id);
                }
            });
            for (const q of pool.queries) {
                assert.ok(!q.params.some((p) => MALFORMED.includes(p)), `sent to Postgres: ${q.sql}`);
            }
            assert.ok(!pool.queries.some((q) => q.sql.startsWith('update notifications')), 'no notification update');
            assert.ok(!pool.queries.some((q) => q.sql === 'begin'), 'no transaction opened');
        });
    }

    it('a well-formed id still reaches the query: unknown ids keep their answers', async () => {
        const pool = createPool();
        setPoolForTests(pool);
        await withServer(async (base) => {
            assert.deepEqual((await call(base, 'GET', `/curricula/${GOOD}`)).json, { error: 'Not found' });
            assert.deepEqual((await call(base, 'GET', `/curricula/${GOOD}/resume`)).json, CURRICULUM_NOT_FOUND);
            assert.equal((await call(base, 'POST', `/curricula/${GOOD}/weekly-load`, { body: {} })).status, 200);
            assert.equal((await call(base, 'GET', `/adaptation?curriculum_id=${GOOD}`)).status, 200);
            const publish = await call(base, 'POST', `/curricula/${GOOD}/publish`, { body: { curriculum_version_id: GOOD } });
            assert.deepEqual([publish.status, publish.json], [404, VERSION_NOT_FOUND]);
            const draft = await call(base, 'POST', '/ai/curriculum-drafts', { body: { curriculum_id: GOOD, intake: INTAKE, curriculum: RICH } });
            assert.deepEqual([draft.status, draft.json], [404, CURRICULUM_NOT_FOUND]);
            const read = await call(base, 'PUT', `/user/notifications/${GOOD}/read`, { body: {} });
            assert.deepEqual([read.status, read.json], [200, { ok: true }]);
            const missing = await call(base, 'POST', `/curricula/${GOOD}/publish`, { body: {} });
            assert.deepEqual([missing.status, missing.json], [400, { error: 'curriculum_version_id required' }]);
        });
        assert.ok(pool.queries.some((q) => q.sql.startsWith('update notifications') && q.params[0] === GOOD));
    });

    for (const [method, urlPath, body, status, error] of FAILING_ROUTES) {
        it(`${method} ${urlPath.split('?')[0].replace(GOOD, ':id')}: a failed query is ${status} "${error}", without the database text`, async () => {
            setPoolForTests(createPool({ fail: true }));
            await withServer(async (base) => {
                const result = await call(base, method, urlPath, { body });
                assert.equal(result.status, status, result.text.slice(0, 300));
                assert.equal(result.json?.error, error, result.text.slice(0, 300));
                assertNoLeak(result, urlPath);
            });
        });
    }

    it('an error no route answered (pool.connect() failing, a body that is not JSON) is JSON without its text', async () => {
        setPoolForTests(createPool({ connectFails: true }));
        await withServer(async (base) => {
            for (const [urlPath, body] of [
                ['/ai/curriculum-drafts', { intake: INTAKE, curriculum: RICH }],
                ['/learner-profiles/assessments', { raw_profile: RAW_PROFILE }],
                [`/curricula/${GOOD}/publish`, { curriculum_version_id: GOOD }],
            ]) {
                const result = await call(base, 'POST', urlPath, { body });
                assert.equal(result.status, 500, `${urlPath}: ${result.text.slice(0, 300)}`);
                assert.deepEqual(result.json, { error: 'Internal Server Error' });
                assertNoLeak(result, urlPath);
            }
            const malformed = await call(base, 'POST', `/curricula/${GOOD}/journal`, { rawBody: '{"learned": ' });
            assert.equal(malformed.status, 400, malformed.text.slice(0, 300));
            assert.deepEqual(malformed.json, { error: 'Bad Request' });
            assertNoLeak(malformed, 'invalid JSON');
        });
    });

    it('a failed deleted-account check at sign-in is 503 auth_unavailable without the database text, and nothing is written', async () => {
        const pool = createPool({ failAccountState: true });
        setPoolForTests(pool);
        const { warn } = console;
        console.warn = () => {};
        try {
            await withServer(async (base) => {
                // requireAuth (curricula) and requireBridgeOrAuth (life journal) both fail closed.
                for (const urlPath of ['/curricula', '/life-journal/daily/2026-01-05?timezone=UTC']) {
                    const result = await call(base, 'GET', urlPath);
                    assert.equal(result.status, 503, `${urlPath}: ${result.text.slice(0, 300)}`);
                    assert.deepEqual(result.json, {
                        error: 'Sign-in cannot be checked right now. Please try again.',
                        error_type: 'auth_unavailable',
                    });
                    assertNoLeak(result, urlPath);
                }
            });
        } finally {
            console.warn = warn;
        }
        assert.ok(pool.queries.length > 0 && pool.queries.every((q) => q.sql.startsWith(ACCOUNT_STATE_READ)), 'no stub insert and no route query after the failed check');
    });

    it('a failed deleted-account check on the LLM gateway (optionalAuth) is 503 ai_access_unavailable, never "sign in", without the database text; TTS stays anonymous', async () => {
        const pool = createPool({ failAccountState: true });
        setPoolForTests(pool);
        const { warn } = console;
        console.warn = () => {};
        const lesson = { courseId: 'vibe', lessonId: 'ch1', title: 'はじめての Vibe Coding', objectives: ['AI と一緒に作る流れを説明できる'] };
        const anchor = { sectionId: 's2', blockId: 'b5', blockType: 'markdown', excerpt: 'プロンプトは「目的・制約・例」の順に書く。' };
        try {
            await withServer(async (base) => {
                const result = await call(base, 'POST', '/llm/tutor', { body: { message: 'これは何？', lesson, anchor } });
                assert.equal(result.status, 503, result.text.slice(0, 300));
                assert.equal(result.json.error_type, 'ai_access_unavailable');
                assertNoLeak(result, 'llm/tutor');
                // An ungated optionalAuth route still answers as anonymous (no 503 there).
                const status = await call(base, 'GET', '/llm/status');
                assert.equal(status.status, 200, status.text.slice(0, 200));
            });
        } finally {
            console.warn = warn;
        }
    });

    it("a rejected token is 401 without the auth provider's text", async () => {
        process.env.NODE_ENV = 'production';
        setPoolForTests(createPool());
        setSupabaseForTests({
            auth: { getUser: async () => ({ data: { user: null }, error: { message: `invalid JWT: ${SECRET}` } }) },
        });
        const { warn } = console;
        console.warn = () => {};
        try {
            await withServer(async (base) => {
                const result = await call(base, 'GET', '/curricula');
                assert.equal(result.status, 401, result.text.slice(0, 300));
                assert.deepEqual(result.json, { error: 'Invalid or expired token' });
                assertNoLeak(result, 'rejected token');
            });
        } finally {
            console.warn = warn;
        }
    });

    it('TTS: an unreachable sidecar is 503 with a fixed text; a failed preference load is a fixed 500', async () => {
        setPoolForTests(createPool());
        await withServer(async (base) => {
            const body = { text: `接続テスト ${Date.now()}`, voice_id: 'jf_alpha', language: 'ja' };
            const unavailable = await call(base, 'POST', '/tts/synthesize', { headers: {}, body });
            assert.equal(unavailable.status, 503, unavailable.text);
            assert.deepEqual(unavailable.json, { error: 'Voice service is unavailable', error_type: 'tts_unavailable' });
            assertNoLeak(unavailable, 'sidecar unreachable');

            setPoolForTests(createPool({ fail: true }));
            // Signed in: the saved voice preferences are read first (tools/core/kokoroTts.js).
            const failed = await call(base, 'POST', '/tts/synthesize', { body });
            assert.ok([500, 503].includes(failed.status), failed.text);
            assert.ok(['TTS synthesis failed', 'Voice service is unavailable'].includes(failed.json?.error), failed.text);
            assertNoLeak(failed, 'preferences failed');

            const invalid = await call(base, 'POST', '/tts/synthesize', { headers: {}, body: { ...body, voice_id: 'nope' } });
            assert.equal(invalid.status, 400, invalid.text);
            assert.equal(invalid.json.error_type, 'validation');
        });
    });

    it('TTS: a text over 1,000 characters is 400 with the cap in the body, before the sidecar or the preferences (Phase 9, D3)', async () => {
        const pool = createPool();
        setPoolForTests(pool);
        await withServer(async (base) => {
            const TOO_LONG = { error: 'text is too long', error_type: 'validation', code: 'text_too_long', max_chars: 1000 };
            for (const headers of [{}, AS_A]) {
                const tooLong = await call(base, 'POST', '/tts/synthesize', { headers, body: { text: '読'.repeat(1001), voice_id: 'jf_alpha', language: 'ja' } });
                assert.equal(tooLong.status, 400, tooLong.text);
                assert.deepEqual(tooLong.json, TOO_LONG);
            }
            assert.ok(!pool.queries.some((q) => q.sql.includes('user_profiles')), 'no preference read');
            // 1,000 characters pass the cap and reach the (unreachable) sidecar: 503, as above.
            const atCap = await call(base, 'POST', '/tts/synthesize', { headers: {}, body: { text: `${'読'.repeat(999)}${Date.now() % 10}`, voice_id: 'jf_alpha', language: 'ja' } });
            assert.equal(atCap.status, 503, atCap.text);
            assert.deepEqual(fs.readdirSync(cacheDir).filter((name) => !name.startsWith('.')), [], 'nothing cached');
        });
    });
});
