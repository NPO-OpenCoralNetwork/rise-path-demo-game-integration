/**
 * Reads of curricula, learner profiles, materials and jobs are scoped to the caller.
 *
 * resume / summary-cards / weekly-digest / encyclopedia loaded a curriculum by id alone, the
 * learner_profiles reads in chatgptCurriculum.js took any profile id, /rag/index queued any
 * material, GET /jobs/:id returned any job, the job worker ingested any material, and journal
 * listings joined in the title of any curriculum id a journal entry named.
 *
 * The fake pool behaves like Postgres: a row matches on id, and on owner only when the SQL filters
 * by owner; a malformed id in a uuid cast throws 22P02. Unscoped queries therefore leak in these
 * tests exactly as they would against a real database.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import chatgptCurriculumRoutes from '../routes/chatgptCurriculum.js';
import contentRoutes from '../routes/content.js';
import { getRecent } from '../../tools/core/journal.js';
import { getOwnedLearnerProfile } from '../../tools/core/learnerProfile.js';
import { getOwnedCurriculumContent } from '../../tools/core/curriculum.js';
import { isUuid } from '../../tools/core/ids.js';
import { PHASE1_USER_ID, setPoolForTests, resetPoolForTests } from '../db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BRIDGE_TOKEN = 'test-bridge-token-not-a-secret';
// Bridge-token callers act as PHASE1_USER_ID (server/middleware/bridgeAuth.js).
const CALLER = PHASE1_USER_ID;
const VICTIM = '00000000-0000-0000-0000-0000000000ee';

const CUR_OWN = '11111111-1111-1111-1111-111111111111';
const CUR_VICTIM = '22222222-2222-2222-2222-222222222222';
const LP_OWN = '33333333-3333-3333-3333-333333333333';
const LP_VICTIM = '44444444-4444-4444-4444-444444444444';
const MAT_OWN = '55555555-5555-5555-5555-555555555555';
const MAT_VICTIM = '66666666-6666-6666-6666-666666666666';
const JOB_OWN = '77777777-7777-7777-7777-777777777777';
const JOB_VICTIM = '88888888-8888-8888-8888-888888888888';

const sampleCurriculum = (title) => ({
    title,
    modules: [{ module_id: 'm1', title: 'Module 1', lessons: [{ lesson_id: 'l1', title: 'Lesson 1', key_points: ['point'] }] }],
});

const DATA = {
    curricula: [
        { id: CUR_OWN, user_id: CALLER, content_json: sampleCurriculum('My course') },
        { id: CUR_VICTIM, user_id: VICTIM, content_json: sampleCurriculum('Victim private course') },
    ],
    learner_profiles: [
        { id: LP_OWN, user_id: CALLER, version: 1, raw_profile: { lifestyle: { weekly_capacity_min: 300 } }, derived_learning_profile: { pace: 'high' }, applied_rules: [] },
        { id: LP_VICTIM, user_id: VICTIM, version: 1, raw_profile: { lifestyle: { weekly_capacity_min: 300 } }, derived_learning_profile: { pace: 'high' }, applied_rules: [] },
    ],
    materials: [
        { id: MAT_OWN, user_id: CALLER, storage_path: 'public/uploads/own.txt', type: 'txt' },
        { id: MAT_VICTIM, user_id: VICTIM, storage_path: 'public/uploads/victim.txt', type: 'txt' },
    ],
    jobs: [
        { id: JOB_OWN, user_id: CALLER, status: 'done', progress: 100, error: null },
        { id: JOB_VICTIM, user_id: VICTIM, status: 'error', progress: 0, error: 'victim job detail' },
    ],
};

const rowsResult = (rows) => ({ rows, rowCount: rows.length });
const ownerPlaceholder = (sql, column) => {
    const match = new RegExp(`${column}\\s*=\\s*CAST\\(\\$(\\d+) AS uuid\\)`, 'i').exec(sql) ?? new RegExp(`${column}\\s*=\\s*\\$(\\d+)`, 'i').exec(sql);
    return match ? Number(match[1]) - 1 : -1;
};
/** Row matches the id ($1) and, only when the SQL filters by owner, the owner placeholder. */
const pick = (table, sql, params, ownerColumn) => {
    const ownerIdx = ownerPlaceholder(sql, ownerColumn);
    return DATA[table].filter((row) => row.id === params[0] && (ownerIdx < 0 || params[ownerIdx] === row.user_id));
};

const createFakePool = () => {
    const queries = [];
    return {
        queries,
        async query(sql, params = []) {
            const text = String(sql);
            queries.push({ sql: text, params });
            for (const [i, value] of params.entries()) {
                if (new RegExp(`CAST\\(\\$${i + 1} AS uuid\\)|\\$${i + 1}::uuid`, 'i').test(text) && typeof value === 'string' && !isUuid(value)) {
                    throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
                }
            }
            if (/from curricula c/i.test(text) && /curriculum_versions/i.test(text)) {
                return rowsResult(pick('curricula', text, params, 'c\\.user_id').map((row) => ({ content_json: row.content_json })));
            }
            if (/from learner_profiles/i.test(text) && /\bid\s*=\s*CAST\(\$1/i.test(text)) {
                return rowsResult(pick('learner_profiles', text, params, '(?<![\\w.])user_id'));
            }
            if (/from materials/i.test(text)) return rowsResult(pick('materials', text, params, '(?<![\\w.])user_id'));
            if (/from jobs/i.test(text) && /select status/i.test(text)) {
                return rowsResult(pick('jobs', text, params, '(?<![\\w.])user_id').map(({ status, progress, error }) => ({ status, progress, error })));
            }
            if (/insert into jobs/i.test(text)) return rowsResult([{ id: JOB_OWN, status: 'queued' }]);
            return rowsResult([]);
        },
    };
};

const withServer = async (router, handler, { userId } = {}) => {
    const app = express();
    app.use(express.json());
    if (userId) {
        app.use('/api/v2', (req, _res, next) => {
            req.userId = userId;
            next();
        });
    }
    app.use('/api/v2', router);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await handler(base);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const bridgeHeaders = { 'x-nexloom-bridge-token': BRIDGE_TOKEN };
const postJson = (url, body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
});

const ENV_KEYS = ['RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1', 'NODE_ENV', 'VITE_DEMO_MODE', 'RISEPATH_STRICT_AUTH'];

describe('ownership scope', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
        delete process.env.DATABASE_URL_PHASE1;
        delete process.env.NODE_ENV;
        delete process.env.VITE_DEMO_MODE;
        delete process.env.RISEPATH_STRICT_AUTH;
        pool = createFakePool();
        setPoolForTests(pool);
    });

    afterEach(() => {
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    describe('curriculum content (chatgptCurriculum routes)', () => {
        for (const route of ['resume', 'summary-cards', 'weekly-digest', 'encyclopedia']) {
            it(`GET /curricula/:id/${route}: another user's is 404, a malformed id is 404, your own is 200`, async () => {
                await withServer(chatgptCurriculumRoutes, async (base) => {
                    const foreign = await fetch(`${base}/api/v2/curricula/${CUR_VICTIM}/${route}`, { headers: bridgeHeaders });
                    const foreignText = await foreign.text();
                    assert.equal(foreign.status, 404, foreignText);
                    assert.doesNotMatch(foreignText, /Victim private course/);

                    const malformed = await fetch(`${base}/api/v2/curricula/not-a-uuid/${route}`, { headers: bridgeHeaders });
                    assert.equal(malformed.status, 404, await malformed.text());

                    const own = await fetch(`${base}/api/v2/curricula/${CUR_OWN}/${route}`, { headers: bridgeHeaders });
                    assert.equal(own.status, 200, await own.text());
                });
            });
        }
    });

    describe('learner profiles (chatgptCurriculum routes)', () => {
        it('POST /curricula/:id/weekly-load ignores another user\'s profile', async () => {
            await withServer(chatgptCurriculumRoutes, async (base) => {
                const post = (learnerProfileId) => postJson(`${base}/api/v2/curricula/${CUR_OWN}/weekly-load`, { learner_profile_id: learnerProfileId }, bridgeHeaders);

                const foreign = await post(LP_VICTIM);
                assert.equal(foreign.status, 200);
                assert.equal((await foreign.json()).adjusted_minutes, 60); // default base: profile not readable

                const malformed = await post('not-a-uuid');
                assert.equal(malformed.status, 200);
                assert.equal((await malformed.json()).adjusted_minutes, 60);

                const own = await post(LP_OWN);
                assert.equal(own.status, 200);
                assert.equal((await own.json()).adjusted_minutes, 201); // weekly_capacity_min 300 x 0.67
            });
        });

        it('POST /ai/generation-kit only personalizes with your own profile', async () => {
            await withServer(chatgptCurriculumRoutes, async (base) => {
                const kit = async (learnerProfileId) => (await postJson(`${base}/api/v2/ai/generation-kit`, {
                    learner_profile_id: learnerProfileId,
                    include_personalization: true,
                }, bridgeHeaders)).json();

                assert.equal((await kit(LP_VICTIM)).personalization?.derived_learning_profile, undefined);
                assert.deepEqual((await kit(LP_OWN)).personalization?.derived_learning_profile, { pace: 'high' });
            });
        });

        it('POST /ai/validate-intake only summarizes your own profile', async () => {
            await withServer(chatgptCurriculumRoutes, async (base) => {
                const kit = await (await postJson(`${base}/api/v2/ai/generation-kit`, {}, bridgeHeaders)).json();
                const validate = async (learnerProfileId) => (await postJson(`${base}/api/v2/ai/validate-intake`, {
                    policy_version: kit.policy_version,
                    intake: {},
                    learner_profile_id: learnerProfileId,
                }, bridgeHeaders)).json();

                assert.equal((await validate(LP_VICTIM)).normalized_personalization, undefined);
                assert.deepEqual((await validate(LP_OWN)).normalized_personalization, { pace: 'high' });
            });
        });
    });

    describe('malformed ids are 404, not a database error', () => {
        it('journal, publish and draft routes reject malformed curriculum ids before querying', async () => {
            await withServer(chatgptCurriculumRoutes, async (base) => {
                const responses = [
                    await fetch(`${base}/api/v2/curricula/not-a-uuid/journal`, { headers: bridgeHeaders }),
                    await postJson(`${base}/api/v2/curricula/not-a-uuid/journal`, { module_id: 'm1', lesson_id: 'l1', learned: 'x' }, bridgeHeaders),
                    await postJson(`${base}/api/v2/curricula/not-a-uuid/publish`, { curriculum_version_id: CUR_OWN }, bridgeHeaders),
                    await postJson(`${base}/api/v2/curricula/${CUR_OWN}/publish`, { curriculum_version_id: 'not-a-uuid' }, bridgeHeaders),
                    await postJson(`${base}/api/v2/ai/curriculum-drafts`, { curriculum_id: 'not-a-uuid' }, bridgeHeaders),
                ];
                for (const res of responses) assert.equal(res.status, 404, `${res.url}: ${await res.text()}`);
            });
        });

        it('GET /curricula/:id (content) rejects a malformed id', async () => {
            await withServer(contentRoutes, async (base) => {
                const res = await fetch(`${base}/api/v2/curricula/not-a-uuid`);
                assert.equal(res.status, 404, await res.text());
            }, { userId: CALLER });
        });
    });

    describe('materials and jobs (content routes)', () => {
        it('POST /rag/index only queues your own materials', async () => {
            await withServer(contentRoutes, async (base) => {
                for (const materialId of [MAT_VICTIM, 'not-a-uuid']) {
                    const res = await postJson(`${base}/api/v2/rag/index`, { material_id: materialId });
                    assert.equal(res.status, 404, await res.text());
                }
                assert.equal(pool.queries.filter((q) => /insert into jobs/i.test(q.sql)).length, 0);

                const own = await postJson(`${base}/api/v2/rag/index`, { material_id: MAT_OWN });
                assert.equal(own.status, 200, await own.text());
            }, { userId: CALLER });
        });

        it('GET /jobs/:id only returns your own jobs', async () => {
            await withServer(contentRoutes, async (base) => {
                for (const jobId of [JOB_VICTIM, 'not-a-uuid']) {
                    const res = await fetch(`${base}/api/v2/jobs/${jobId}`);
                    const text = await res.text();
                    assert.equal(res.status, 404, text);
                    assert.doesNotMatch(text, /victim job detail/);
                }
                assert.equal((await fetch(`${base}/api/v2/jobs/${JOB_OWN}`)).status, 200);
            }, { userId: CALLER });
        });

        // The worker still has its own pool (switching it to the shared one is P1-4), so the lookup
        // is checked in the source rather than run against the fake pool.
        it('the job worker only looks up the job owner\'s material', () => {
            const src = fs.readFileSync(path.join(ROOT, 'server/jobWorker.js'), 'utf8');
            assert.match(src, /FROM materials WHERE id = \$1 AND user_id = \$2'/);
            assert.match(src, /\[material_id, job\.user_id\]/);
        });
    });

    describe('journal listings', () => {
        it('getRecent (MCP journal-recent) only joins titles of curricula the user owns', async () => {
            const result = await getRecent({ userId: CALLER, limit: 5 });
            assert.deepEqual(result, { entries: [] });
            assert.match(pool.queries[0].sql, /JOIN\s+curricula\s+c\s+ON\s+c\.id\s*=\s*j\.curriculum_id\s+AND\s+c\.user_id\s*=\s*j\.user_id/i);
        });

        it('GET /journal/recent only joins titles of curricula the user owns', async () => {
            await withServer(chatgptCurriculumRoutes, async (base) => {
                assert.equal((await fetch(`${base}/api/v2/journal/recent`, { headers: bridgeHeaders })).status, 200);
            });
            const query = pool.queries.find((q) => /from learning_journal j/i.test(q.sql));
            assert.match(query.sql, /join\s+curricula\s+c\s+on\s+c\.id\s*=\s*j\.curriculum_id\s+and\s+c\.user_id\s*=\s*j\.user_id/i);
        });
    });

    describe('owner-scoped accessors (tools/core)', () => {
        it('getOwnedCurriculumContent returns content only for the owner and never queries a malformed id', async () => {
            assert.deepEqual(await getOwnedCurriculumContent({ curriculumId: CUR_OWN, userId: CALLER }), sampleCurriculum('My course'));
            assert.equal(await getOwnedCurriculumContent({ curriculumId: CUR_VICTIM, userId: CALLER }), null);
            const before = pool.queries.length;
            for (const id of ['not-a-uuid', '', undefined]) {
                assert.equal(await getOwnedCurriculumContent({ curriculumId: id, userId: CALLER }), null);
            }
            assert.equal(await getOwnedCurriculumContent({ curriculumId: CUR_OWN, userId: undefined }), null);
            assert.equal(pool.queries.length, before);
        });

        it('getOwnedLearnerProfile returns the row only for the owner and never queries a malformed id', async () => {
            const own = await getOwnedLearnerProfile({ profileId: LP_OWN, userId: CALLER });
            assert.equal(own.id, LP_OWN);
            assert.equal(await getOwnedLearnerProfile({ profileId: LP_VICTIM, userId: CALLER }), null);
            const before = pool.queries.length;
            assert.equal(await getOwnedLearnerProfile({ profileId: 'not-a-uuid', userId: CALLER }), null);
            assert.equal(await getOwnedLearnerProfile({ profileId: LP_OWN, userId: undefined }), null);
            assert.equal(pool.queries.length, before);
        });
    });
});

describe('chatgptCurriculum.js has no unscoped profile or curriculum reads left', () => {
    it('reads go through the owner-scoped accessors', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server/routes/chatgptCurriculum.js'), 'utf8');
        const sql = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
        const byIdProfileReads = sql.filter((s) => /from\s+learner_profiles/i.test(s) && /\bid\s*=\s*CAST/i.test(s));
        const versionContentReads = sql.filter((s) => /from\s+curricula\s+c/i.test(s) && /current_version_id/i.test(s));
        assert.deepEqual(byIdProfileReads, [], 'use getOwnedLearnerProfile');
        assert.deepEqual(versionContentReads, [], 'use getOwnedCurriculumContent');
    });
});
