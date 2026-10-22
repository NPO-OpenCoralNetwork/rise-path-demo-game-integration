// Rows belong to the user who made them: two signed-in users on the real server.js stack. User B
// owns a learner profile, a curriculum, a material and a job; user A asks for each by id and gets
// 404 (and B still gets them). The mock pool behaves like Postgres for these reads: a query sees
// B's rows when it is not scoped to a user, or is scoped to B.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests, PHASE1_USER_ID } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { resetDailyCapsForTests } from '../middleware/dailyCaps.js';
import { JobWorker, jobErrorCode } from '../jobWorker.js';
import { logEntry, getRecent } from '../../tools/core/journal.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROFILE_B = 'b0000000-0000-4000-8000-000000000001';
const CURRICULUM_B = 'b0000000-0000-4000-8000-000000000002';
const MATERIAL_B = 'b0000000-0000-4000-8000-000000000003';
const JOB_B = 'b0000000-0000-4000-8000-000000000004';
const AS_A = { Authorization: 'Bearer token-a' };
const AS_B = { Authorization: 'Bearer token-b' };

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1', 'TRUST_PROXY', 'ORIGIN_SECRET', 'AI_ACCESS_DEV_AUDIENCE'];

const PROFILE_ROW = {
    id: PROFILE_B,
    version: 1,
    raw_profile: { big_five: { openness: 0.9 }, lifestyle: { weekly_capacity_min: 300 } },
    derived_learning_profile: { pace: 'steady_small_steps' },
    applied_rules: [],
};

const INTAKE = { target_audience: '初学者', goal: '学ぶ', current_level: '初学者', duration_weeks: 4 };
const THIN_CURRICULUM = {
    title: '薄い教材',
    summary: '短い要約',
    modules: [{ title: 'Module 1', goal: '基礎理解', lessons: [{ title: 'Lesson 1', objective: '理解する' }] }],
};

const EMPTY = { rowCount: 0, rows: [] };
const one = (row) => ({ rowCount: 1, rows: [row] });

/** Whitespace-normalized, lowercased SQL. */
const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mock pool holding B's rows. `visible` is the ownership rule Postgres applies: an unscoped query
 * sees everyone's rows, a scoped one only the rows of the user it names. As in Postgres, a
 * parameter cast to uuid that is not a UUID fails the statement (22P02). `jobError` is the error
 * stored on B's failed job.
 */
function createOwnedPool({ jobError = 'file_missing' } = {}) {
    const queries = [];
    const run = async (sql, params = []) => {
        const text = norm(sql);
        queries.push({ sql: text, params });
        for (const [, cast, colon] of text.matchAll(/cast\(\$(\d+) as uuid\)|\$(\d+)::uuid/g)) {
            const value = params[Number(cast ?? colon) - 1];
            if (typeof value === 'string' && !UUID_RE.test(value)) {
                throw Object.assign(new Error(`invalid input syntax for type uuid: "${value}"`), { code: '22P02' });
            }
        }
        const scoped = /user_id = (cast\(\$\d+ as uuid\)|\$\d+::uuid|\$\d+\b)/.test(text);
        const visible = !scoped || params.includes(USER_B);
        if (text.startsWith('insert into ai_daily_usage')) return one({ count: 1 });
        if (text.includes('from learner_profiles')) return visible ? one(PROFILE_ROW) : EMPTY;
        if (text.includes('from curricula c') && text.includes('content_json')) return visible ? one({ content_json: { title: 'B', modules: [] } }) : EMPTY;
        if (text.startsWith('select 1 from curricula')) return visible ? one({ '?column?': 1 }) : EMPTY;
        if (text.startsWith('insert into learning_journal')) return one({ id: 'j1', created_at: '2026-10-22T00:00:00Z' });
        if (text.includes('from learning_journal j')) {
            // A's own entry that points at B's curriculum (written before the ownership check).
            return one({ curriculum_id: CURRICULUM_B, curriculum_title: text.includes('c.user_id = j.user_id') ? null : 'B private title' });
        }
        if (text.startsWith('select 1 from materials')) return visible ? one({ '?column?': 1 }) : EMPTY;
        if (text.startsWith('insert into jobs')) return one({ id: JOB_B, status: 'queued' });
        if (text.startsWith('select status, progress, error from jobs')) return visible ? one({ status: 'error', progress: 0, error: jobError }) : EMPTY;
        return EMPTY;
    };
    return {
        queries,
        query: run,
        connect: async () => ({ query: run, release: () => {} }),
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

const call = async (base, method, path, headers, body) => {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
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

/** Each route that takes another user's id, with the request that names B's row. */
const ROUTES = [
    ['POST', '/ai/generation-kit', { include_personalization: true, learner_profile_id: PROFILE_B }],
    ['POST', '/ai/validate-intake', { learner_profile_id: PROFILE_B, intake: INTAKE }],
    ['POST', '/ai/curriculum-drafts', { learner_profile_id: PROFILE_B, intake: INTAKE, curriculum: THIN_CURRICULUM }],
    ['POST', `/curricula/${CURRICULUM_B}/weekly-load`, { learner_profile_id: PROFILE_B }],
    ['GET', `/curricula/${CURRICULUM_B}/resume`],
    ['GET', `/curricula/${CURRICULUM_B}/summary-cards`],
    ['GET', `/curricula/${CURRICULUM_B}/weekly-digest`],
    ['GET', `/curricula/${CURRICULUM_B}/encyclopedia`],
    ['POST', `/curricula/${CURRICULUM_B}/journal`, { module_id: 'm1', lesson_id: 'l1', learned: 'SQL joins' }],
    ['POST', '/rag/index', { material_id: MATERIAL_B }],
    ['GET', `/jobs/${JOB_B}`],
];

describe('routes read only the caller\'s own rows', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.AI_ACCESS_DEV_AUDIENCE = 'adult'; // past the AI access gate (aiAccessGate.js) without age rows
        pool = createOwnedPool();
        setPoolForTests(pool);
        resetDailyCapsForTests();
        setSupabaseForTests({
            auth: {
                getUser: async (token) => ({
                    data: { user: token === 'token-a' ? { id: USER_A } : token === 'token-b' ? { id: USER_B } : null },
                    error: null,
                }),
            },
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

    for (const [method, path, body] of ROUTES) {
        it(`${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}: 404 for another user, served for the owner`, async () => {
            await withServer(async (base) => {
                const stranger = await call(base, method, path, AS_A, body);
                assert.equal(stranger.status, 404, stranger.text);
                assert.ok(!stranger.text.includes('big_five') && !stranger.text.includes('file_missing'), 'nothing of B leaks');
                const owner = await call(base, method, path, AS_B, body);
                assert.notEqual(owner.status, 404, `the owner still gets it: ${owner.text}`);
                assert.ok(owner.status < 500, owner.text);
            });
        });
    }

    it('checks the curriculum before writing a journal entry, and never joins another user\'s curriculum title', async () => {
        await withServer(async (base) => {
            await call(base, 'POST', `/curricula/${CURRICULUM_B}/journal`, AS_A, { module_id: 'm1', lesson_id: 'l1', learned: 'x' });
            assert.ok(!pool.queries.some((q) => q.sql.startsWith('insert into learning_journal')), 'no entry for B\'s curriculum');
            const recent = await call(base, 'GET', '/journal/recent', AS_A);
            assert.equal(recent.status, 200, recent.text);
            assert.equal(recent.json.entries[0].curriculum_title, null);
        });
    });

    it('a learner_profile_id that is not a UUID is the same 404 as an unknown one, and never reaches Postgres', async () => {
        await withServer(async (base) => {
            for (const [method, path, body] of ROUTES.filter(([, , b]) => b?.learner_profile_id)) {
                for (const learner_profile_id of ['not-a-uuid', `${PROFILE_B}x`]) {
                    const result = await call(base, method, path, AS_B, { ...body, learner_profile_id });
                    assert.equal(result.status, 404, `${path} ${learner_profile_id}: ${result.text.slice(0, 200)}`);
                    assert.equal(result.json.error, 'Learner profile not found');
                    assert.ok(!result.text.includes('invalid input syntax'), 'no Postgres detail');
                }
            }
            assert.ok(!pool.queries.some((q) => q.sql.includes('from learner_profiles')), 'no profile lookup was sent');
            assert.ok(!pool.queries.some((q) => q.sql.startsWith('insert into curricula')), 'no course saved');
        });
    });

    it('/jobs/:id: an error stored before the worker kept short codes reads as job_failed', async () => {
        pool = createOwnedPool({ jobError: "ENOENT: no such file or directory, open '/srv/app/public/uploads/secret.pdf'" });
        setPoolForTests(pool);
        await withServer(async (base) => {
            const result = await call(base, 'GET', `/jobs/${JOB_B}`, AS_B);
            assert.equal(result.status, 200, result.text);
            assert.deepEqual(result.json, { status: 'error', progress: 0, error: 'job_failed' });
        });
        setPoolForTests(createOwnedPool());
        await withServer(async (base) => {
            assert.equal((await call(base, 'GET', `/jobs/${JOB_B}`, AS_B)).json.error, 'file_missing', 'a short code is shown as stored');
        });
    });

    it('a bridge caller is the shared PHASE1 user: x-nexloom-user-id selects no one', async () => {
        process.env.RISE_PATH_BRIDGE_TOKEN = 'bridge-secret';
        await withServer(async (base) => {
            for (const auth of [{ 'x-nexloom-bridge-token': 'bridge-secret' }, { Authorization: 'Bearer bridge-secret' }]) {
                const headers = { ...auth, 'x-nexloom-user-id': USER_B };
                assert.equal((await call(base, 'GET', `/curricula/${CURRICULUM_B}/resume`, headers)).status, 404);
                const kit = await call(base, 'POST', '/ai/generation-kit', headers, { include_personalization: true, learner_profile_id: PROFILE_B });
                assert.equal(kit.status, 404, kit.text);
            }
            const scoped = pool.queries.filter((q) => q.sql.includes('from learner_profiles') || q.sql.includes('from curricula c'));
            assert.equal(scoped.length, 4);
            for (const q of scoped) assert.deepEqual(q.params.slice(1), [PHASE1_USER_ID]);
        });
    });

    it('/rag/index: a material_id that is not a UUID is 400; a refused request gives the embeddings unit back', async () => {
        await withServer(async (base) => {
            for (const material_id of ['m1', 42, '../../etc/passwd', undefined]) {
                const result = await call(base, 'POST', '/rag/index', AS_A, { material_id });
                assert.equal(result.status, 400, String(material_id));
                assert.equal(result.json.error_type, 'invalid_body');
            }
            const before = pool.queries.filter((q) => q.sql.startsWith('update ai_daily_usage')).length;
            assert.equal((await call(base, 'POST', '/rag/index', AS_A, { material_id: MATERIAL_B })).status, 404);
            const until = Date.now() + 1000;
            while (pool.queries.filter((q) => q.sql.startsWith('update ai_daily_usage')).length === before && Date.now() < until) {
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
            assert.equal(pool.queries.filter((q) => q.sql.startsWith('update ai_daily_usage')).length, before + 1, 'the 404 was refunded');
            assert.ok(!pool.queries.some((q) => q.sql.startsWith('insert into jobs') && q.params[0] === USER_A), 'no job queued for A');
        });
    });
});

describe('MCP journal tools (tools/core/journal.js, behind journal-log and journal-recent)', () => {
    let pool;
    beforeEach(() => {
        pool = createOwnedPool();
        setPoolForTests(pool);
    });
    afterEach(() => resetPoolForTests());

    it("journal-log refuses another user's curriculum and writes nothing", async () => {
        const entry = { curriculumId: CURRICULUM_B, moduleId: 'm1', lessonId: 'l1', learned: 'SQL joins' };
        const refused = await logEntry({ userId: USER_A, ...entry });
        assert.equal(refused.error_type, 'not_found');
        assert.ok(!pool.queries.some((q) => q.sql.startsWith('insert into learning_journal')), 'no entry for B\'s curriculum');
        const saved = await logEntry({ userId: USER_B, ...entry });
        assert.equal(saved.status, 'saved', JSON.stringify(saved));
        assert.deepEqual(pool.queries.filter((q) => q.sql.startsWith('insert into learning_journal')).map((q) => q.params[0]), [USER_B]);
    });

    it("journal-recent never joins another user's curriculum title", async () => {
        const recent = await getRecent({ userId: USER_A });
        assert.equal(recent.entries[0].curriculum_id, CURRICULUM_B);
        assert.equal(recent.entries[0].curriculum_title, null);
    });
});

describe('job worker', () => {
    /** A pool for handleJob: materials owned by B; records the error stored for the job. */
    const workerPool = (storagePath = 'public/uploads/does-not-exist-daily-caps.txt') => {
        const queries = [];
        return {
            queries,
            stored: () => queries.find((q) => q.sql.startsWith('update jobs') && q.sql.includes("status = 'error'"))?.params[1],
            async query(sql, params = []) {
                const text = norm(sql);
                queries.push({ sql: text, params });
                if (text.startsWith('select storage_path, type from materials')) {
                    const scoped = text.includes('user_id = $2');
                    return !scoped || params[1] === USER_B ? one({ storage_path: storagePath, type: 'txt' }) : EMPTY;
                }
                return EMPTY;
            },
        };
    };

    afterEach(() => resetPoolForTests());

    it("does not ingest another user's material: the job fails with material_not_found", async () => {
        const pool = workerPool();
        const worker = new JobWorker({ getPool: () => pool });
        await worker.handleJob({ id: 'job-1', user_id: USER_A, type: 'ingest', payload: { material_id: MATERIAL_B } });
        const select = pool.queries.find((q) => q.sql.startsWith('select storage_path'));
        assert.deepEqual(select.params, [MATERIAL_B, USER_A]);
        assert.equal(pool.stored(), 'material_not_found');
    });

    it('stores a short error code, never the raw message (absolute paths, file names)', async () => {
        const pool = workerPool('public/uploads/secret-name-daily-caps.txt');
        // ingestMaterial reads the shared pool (server/db.js) before it opens the file.
        setPoolForTests({ query: async () => EMPTY, connect: async () => ({ query: async () => EMPTY, release: () => {} }) });
        const worker = new JobWorker({ getPool: () => pool });
        await worker.handleJob({ id: 'job-2', user_id: USER_B, type: 'ingest', payload: { material_id: MATERIAL_B } });
        assert.equal(pool.stored(), 'file_missing');
        await worker.handleJob({ id: 'job-3', user_id: USER_B, type: 'resize', payload: {} });
        assert.equal(pool.queries.filter((q) => q.sql.startsWith('update jobs')).at(-1).params[1], 'unknown_job_type');
        for (const q of pool.queries) assert.ok(!JSON.stringify(q.params).includes('secret-name'), 'no file name stored');
    });

    it('jobErrorCode maps failures to fixed codes', () => {
        assert.equal(jobErrorCode(Object.assign(new Error('ENOENT: /srv/app/public/uploads/x.pdf'), { code: 'ENOENT' })), 'file_missing');
        assert.equal(jobErrorCode(Object.assign(new Error('bad PDF'), { ingestStage: 'extract' })), 'extract_failed');
        assert.equal(jobErrorCode(Object.assign(new Error('quota'), { ingestStage: 'embed' })), 'embed_failed');
        assert.equal(jobErrorCode(new Error('deadlock')), 'job_failed');
        assert.equal(jobErrorCode(undefined), 'job_failed');
    });
});
