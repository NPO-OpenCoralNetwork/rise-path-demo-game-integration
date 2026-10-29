// The lesson progress API (server/routes/lessonProgress.js at /api/v2/user/lesson-progress) on the
// real server.js stack, with an in-memory lesson_progress (helpers/lessonProgressPool.js, exact
// SQL): auth, the merge, the reset epoch, per-record rejections, body limits, the per-user write
// limit and error answers. Also pins migration 016's CHECKs to the one id rule and LESSON_STATES.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { getPublishedLesson, isSafeSlug } from '../../tools/core/courseCatalog.js';
import { PROGRESS_MAX_BYTES, SAVE_BATCH_MAX } from '../../tools/core/lessonProgress.js';
import { LESSON_PROGRESS_WRITES_PER_MINUTE } from '../routes/lessonProgress.js';
import { LESSON_STATES, lessonPct, lessonState } from '../../shared/lesson/progress.js';
import { createLessonProgressPool, SQL } from './helpers/lessonProgressPool.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const CLAUDE = '11111111-2222-4000-8000-000000000001';
const MCP_URL = 'https://mcp.example.org/mcp';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const ch1 = getPublishedLesson(VIBE, CH1);

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ role: 'authenticated', exp: 4_000_000_000, ...payload })}.c2ln`;
const TOKENS = {
    alice: jwt({ sub: ALICE, aud: 'authenticated' }),
    bob: jwt({ sub: BOB, aud: 'authenticated' }),
    aliceAgent: jwt({ sub: ALICE, aud: MCP_URL, client_id: CLAUDE }),
};
const USERS = { [TOKENS.alice]: ALICE, [TOKENS.bob]: BOB, [TOKENS.aliceAgent]: ALICE };
const as = (who) => ({ Authorization: `Bearer ${TOKENS[who]}` });

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'RP_CONTENT_DIR'];
const EPOCH = 'cccccccc-0000-4000-8000-000000000001';

const record = (overrides = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z', ...overrides });

// The after-save hook (Phase 5 stage 2: XP and the learning day) is a no-op here, so the statement
// pins below see only the save's own SQL (server/tests/lessonResetRoutes.test.js tests the hook).
const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false, lessonProgress: { afterSave: () => {} } });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/user/lesson-progress`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const call = async (url, { method = 'GET', headers = {}, body, rawBody } = {}) => {
    const init = { method, headers: { ...headers } };
    if (rawBody !== undefined || body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = rawBody ?? JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text };
};

const quiet = async (fn) => {
    const { error, warn } = console;
    console.error = () => {};
    console.warn = () => {};
    try {
        return await fn();
    } finally {
        console.error = error;
        console.warn = warn;
    }
};

describe('/api/v2/user/lesson-progress', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        resetPoolForTests();
        pool = createLessonProgressPool({
            rows: [
                {
                    user_id: ALICE, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, pct: 5, state: 'in_progress',
                    progress: record({ seen: ['hook-b1'], answers: { 'check-quiz/q4': { attempts: 1, correct: true, chosen: ['b'], firstTry: true } } }),
                },
                { user_id: BOB, course_slug: VIBE, lesson_id: CH1, content_hash: ch1.hash, pct: 1, state: 'in_progress', progress: record({ seen: ['s1-b1'] }) },
            ],
            resets: { [BOB]: EPOCH },
        });
        setPoolForTests(pool);
        setSupabaseForTests({
            auth: { getUser: async (token) => ({ data: { user: USERS[token] ? { id: USERS[token] } : null }, error: null }) },
        });
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });

    it('GET returns only the caller\'s records and epoch (null until the first delete)', async () => {
        await withServer(async (base) => {
            const alice = await call(base, { headers: as('alice') });
            assert.equal(alice.status, 200, alice.text);
            assert.equal(alice.json.ok, true);
            assert.equal(alice.json.epoch, null);
            assert.deepEqual(alice.json.records, [{
                courseSlug: VIBE,
                lessonId: CH1,
                progress: record({ seen: ['hook-b1'], answers: { 'check-quiz/q4': { attempts: 1, correct: true, chosen: ['b'], firstTry: true } } }),
                pct: 5,
                state: 'in_progress',
                updatedAt: '2026-10-20T00:00:00.000Z',
                lessonEpoch: null,
                lessonResetAt: null,
            }]);
            const bob = await call(base, { headers: as('bob') });
            assert.equal(bob.json.epoch, EPOCH);
            assert.deepEqual(bob.json.records.map((r) => r.progress.seen), [['s1-b1']]);
            const reads = pool.queries.filter((q) => q.sql === SQL.selectEpoch || q.sql === SQL.selectRowsWithEpochs);
            assert.deepEqual(reads.map((q) => [q.sql === SQL.selectEpoch ? 'epoch' : 'rows', q.params]), [
                ['epoch', [ALICE]], ['rows', [ALICE]], ['epoch', [BOB]], ['rows', [BOB]],
            ], 'the epoch is read before the rows; the user id comes from the token only');
        });
    });

    it('PUT merges into the stored record and answers with the merged records, pct and state', async () => {
        await withServer(async (base) => {
            const progress = record({
                seen: ['s1-b1'],
                answers: { 'check-quiz/q4': { attempts: 2, correct: false, chosen: ['a'], firstTry: false, revealed: true } },
                checks: { 'card:cards/c1': true },
                updatedAt: '2026-10-21T00:00:00.000Z',
                summary: { pct: 100, state: 'mastered' },
            });
            const put = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress }] } });
            assert.equal(put.status, 200, put.text);
            assert.equal(put.json.ok, true);
            assert.equal(put.json.epoch, null);
            assert.deepEqual(put.json.rejected, []);
            const [merged] = put.json.records;
            assert.deepEqual(merged.progress.seen, ['hook-b1', 's1-b1']);
            assert.deepEqual(merged.progress.answers['check-quiz/q4'], { attempts: 1, correct: true, chosen: ['b'], firstTry: true, revealed: true }, 'a correct server answer is final');
            assert.deepEqual(merged.progress.checks, { 'card:cards/c1': true });
            assert.equal(merged.progress.summary, undefined);
            assert.equal(merged.pct, lessonPct(ch1.lesson, merged.progress));
            assert.equal(merged.state, lessonState(ch1.lesson, merged.progress));
            assert.equal(merged.updatedAt, '2026-10-21T00:00:00.000Z');
            assert.deepEqual(pool.row(ALICE, VIBE, CH1).progress, merged.progress);
            assert.deepEqual(pool.row(BOB, VIBE, CH1).progress.seen, ['s1-b1'], 'Bob untouched');
            assert.deepEqual(pool.progressStatements(), ['begin', SQL.advisoryLock, SQL.selectEpoch, SQL.selectLessonEpochs, SQL.insertPlaceholder, SQL.lockRow, SQL.updateRow, 'commit']);
            const update = pool.queries.find((q) => q.sql === SQL.updateRow);
            assert.deepEqual(update.params.slice(0, 3), [ALICE, VIBE, CH1]);
            assert.equal(update.params[6], ch1.hash, 'content_hash = the catalog lesson the pct/state came from');
        });
    });

    it('PUT with a stale epoch answers 409 progress_reset with the current epoch and saves nothing', async () => {
        await withServer(async (base) => {
            const stale = await call(base, { method: 'PUT', headers: as('bob'), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) }] } });
            assert.equal(stale.status, 409);
            assert.equal(stale.json.error_type, 'progress_reset');
            assert.equal(stale.json.epoch, EPOCH);
            assert.deepEqual(pool.row(BOB, VIBE, CH1).progress.seen, ['s1-b1']);
            const current = await call(base, { method: 'PUT', headers: as('bob'), body: { epoch: EPOCH, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) }] } });
            assert.equal(current.status, 200, current.text);
            assert.equal(current.json.epoch, EPOCH);
        });
    });

    it('a lesson that is not published (or breaks the id rule) is rejected per record, the rest is saved', async () => {
        await withServer(async (base) => {
            const put = await call(base, {
                method: 'PUT',
                headers: as('alice'),
                body: {
                    epoch: null,
                    records: [
                        { courseSlug: VIBE, lessonId: 'vibe-ch1.5', progress: record() },
                        { courseSlug: 'Vibe', lessonId: CH1, progress: record() },
                        { courseSlug: VIBE, lessonId: 'vibe-ch99', progress: record() },
                        { lessonId: CH1, progress: record() },
                        { courseSlug: 'claude-code', lessonId: 'cc-01-first-session', progress: record({ seen: ['hook-b1'] }) },
                    ],
                },
            });
            assert.equal(put.status, 200, put.text);
            assert.deepEqual(put.json.rejected, [
                { courseSlug: VIBE, lessonId: 'vibe-ch1.5', error_type: 'unknown_lesson' },
                { courseSlug: 'Vibe', lessonId: CH1, error_type: 'unknown_lesson' },
                { courseSlug: VIBE, lessonId: 'vibe-ch99', error_type: 'unknown_lesson' },
                { courseSlug: null, lessonId: CH1, error_type: 'unknown_lesson' },
            ]);
            assert.deepEqual(put.json.records.map((r) => r.lessonId), ['cc-01-first-session']);
            assert.ok(pool.row(ALICE, 'claude-code', 'cc-01-first-session'));
        });
    });

    it('a malformed body answers 400 validation before any query', async () => {
        await withServer(async (base) => {
            const records = (n) => Array.from({ length: n }, () => ({ courseSlug: VIBE, lessonId: CH1, progress: record() }));
            const bodies = [
                { records: records(1) },
                { epoch: 'not-a-uuid', records: records(1) },
                { epoch: 5, records: records(1) },
                { epoch: null, records: [] },
                { epoch: null, records: records(SAVE_BATCH_MAX + 1) },
                { epoch: null, records: 'all' },
                { epoch: null, records: [null] },
                { epoch: null, records: [['vibe-coding', 'vibe-ch1']] },
                [],
            ];
            for (const body of bodies) {
                const response = await call(base, { method: 'PUT', headers: as('alice'), body });
                assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
                assert.equal(response.json.error_type, 'validation');
            }
            const notJson = await call(base, { method: 'PUT', headers: as('alice'), rawBody: '{"epoch": null, "records": [' });
            assert.equal(notJson.status, 400);
            assert.equal(notJson.json.error_type, 'validation');
            const noBody = await call(base, { method: 'PUT', headers: as('alice') });
            assert.equal(noBody.status, 400);
            assert.equal(pool.progressStatements().length, 0);
            assert.equal((await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: records(SAVE_BATCH_MAX) } })).status, 200, '25 records are fine');
        });
    });

    it('a body over 256 kb answers 413 (its own limit, not the global 2 MB one)', async () => {
        await withServer(async (base) => {
            const big = { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: Array.from({ length: 3000 }, (_, i) => `b${i}-${'x'.repeat(80)}`) }) }] };
            assert.ok(JSON.stringify(big).length > 256 * 1024);
            const response = await call(base, { method: 'PUT', headers: as('alice'), body: big });
            assert.equal(response.status, 413);
            assert.equal(response.json.error_type, 'body_too_large');
            assert.equal(pool.progressStatements().length, 0);
        });
    });

    it('the 256 kb limit is this mount\'s only: the legacy /api/v2/user/progress routes keep the global parser', async () => {
        await withServer(async (base) => {
            const legacy = base.replace('/lesson-progress', '/progress');
            const completedStages = Array.from({ length: 3000 }, (_, i) => `stage-${i}-${'x'.repeat(80)}`);
            assert.ok(JSON.stringify({ completedStages }).length > 256 * 1024);
            const put = await call(`${legacy}/vibe-coding`, { method: 'PUT', headers: as('alice'), body: { completedStages, completedSteps: {} } });
            assert.equal(put.status, 200, put.text);
            const insert = pool.queries.find((q) => q.sql.startsWith('insert into user_progress'));
            assert.ok(insert, 'the legacy route ran');
            assert.deepEqual([insert.params[0], insert.params[1], insert.params[2].length], [ALICE, 'vibe-coding', completedStages.length]);
            const get = await call(legacy, { headers: as('alice') });
            assert.equal(get.status, 200, get.text);
            assert.deepEqual(Object.keys(get.json.progress), ['vibe-coding']);
            assert.equal(get.json.progress['vibe-coding'].completedStages.length, completedStages.length, 'the legacy row as stored');
            assert.equal(pool.progressStatements().length, 0, 'lesson_progress untouched');
        });
    });

    it('DELETE removes the caller\'s records and sets a new epoch; the old epoch is then refused', async () => {
        await withServer(async (base) => {
            const deleted = await call(base, { method: 'DELETE', headers: as('alice') });
            assert.equal(deleted.status, 200, deleted.text);
            assert.equal(deleted.json.ok, true);
            assert.equal(deleted.json.deleted, 1);
            assert.match(deleted.json.epoch, /^[0-9a-f-]{36}$/);
            assert.equal(pool.row(ALICE, VIBE, CH1), undefined);
            assert.ok(pool.row(BOB, VIBE, CH1), 'Bob keeps his records');
            assert.equal(pool.epochOf(BOB), EPOCH);

            const get = await call(base, { headers: as('alice') });
            assert.deepEqual([get.json.epoch, get.json.records], [deleted.json.epoch, []]);
            // A device that loaded before the delete still holds epoch null: its upload is refused.
            const late = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record({ seen: ['hook-b1'] }) }] } });
            assert.equal(late.status, 409);
            assert.equal(late.json.epoch, deleted.json.epoch);
            assert.equal(pool.row(ALICE, VIBE, CH1), undefined, 'the deleted progress stays deleted');
        });
    });

    it('PUT and DELETE are limited per learner (30 a minute); GET is not, and other learners are unaffected', async () => {
        await withServer(async (base) => {
            const body = { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] };
            for (let i = 0; i < LESSON_PROGRESS_WRITES_PER_MINUTE; i += 1) {
                assert.equal((await call(base, { method: 'PUT', headers: as('alice'), body })).status, 200, `write ${i + 1}`);
            }
            const limited = await call(base, { method: 'PUT', headers: as('alice'), body });
            assert.equal(limited.status, 429);
            assert.equal(limited.json.error_type, 'rate_limited');
            assert.equal((await call(base, { method: 'DELETE', headers: as('alice') })).status, 429);
            assert.equal((await call(base, { headers: as('alice') })).status, 200);
            assert.equal((await call(base, { method: 'PUT', headers: as('bob'), body: { ...body, epoch: EPOCH } })).status, 200);
        });
        assert.equal(LESSON_PROGRESS_WRITES_PER_MINUTE, 30);
    });

    it('an agent\'s OAuth token, or no token, is refused before any query', async () => {
        await withServer(async (base) => {
            for (const method of ['GET', 'PUT', 'DELETE']) {
                const body = method === 'PUT' ? { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } : undefined;
                const agent = await call(base, { method, headers: as('aliceAgent'), body });
                assert.equal(agent.status, 401, `${method} agent`);
                assert.equal(agent.json.error_type, 'oauth_client_token');
                assert.equal((await call(base, { method, body })).status, 401, `${method} anonymous`);
            }
            assert.equal(pool.progressStatements().length, 0);
        });
    });

    it('without a database: 503 lesson_progress_unavailable', async () => {
        setPoolForTests(null);
        await withServer(async (base) => {
            for (const method of ['GET', 'PUT', 'DELETE']) {
                const body = method === 'PUT' ? { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } : undefined;
                const response = await call(base, { method, headers: as('alice'), body });
                assert.equal(response.status, 503, method);
                assert.equal(response.json.error_type, 'lesson_progress_unavailable');
            }
        });
    });

    it('database failures answer 503 or 500 with an error_type and never the driver text', async () => {
        await withServer(async (base) => {
            await quiet(async () => {
                pool.fail({ code: '42P01' });
                for (const method of ['GET', 'PUT', 'DELETE']) {
                    const body = method === 'PUT' ? { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } : undefined;
                    const response = await call(base, { method, headers: as('alice'), body });
                    assert.equal(response.status, 503, method);
                    assert.equal(response.json.error_type, 'lesson_progress_unavailable');
                    assert.doesNotMatch(response.text, /relation|db\.internal|lesson_progress"/);
                }
                pool.fail({});
                const failed = await call(base, { method: 'PUT', headers: as('alice'), body: { epoch: null, records: [{ courseSlug: VIBE, lessonId: CH1, progress: record() }] } });
                assert.equal(failed.status, 500);
                assert.equal(failed.json.error_type, 'lesson_progress_failed');
                assert.doesNotMatch(failed.text, /relation|db\.internal/);
            });
            assert.equal(pool.inTransaction(), false, 'every failed transaction rolled back');
        });
    });
});

describe('016_lesson_progress.sql', () => {
    const sql = readFileSync(new URL('../migrations/016_lesson_progress.sql', import.meta.url), 'utf8')
        .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    const lower = sql.replace(/\s+/g, ' ').toLowerCase();

    it('course_slug and lesson_id CHECKs are the one id rule (SAFE_SLUG, at most 80 characters)', () => {
        for (const column of ['course_slug', 'lesson_id']) {
            const match = new RegExp(`${column}\\s+text\\s+NOT NULL CHECK \\(${column} ~ '([^']+)'\\)`).exec(sql);
            assert.ok(match, column);
            const check = new RegExp(match[1]);
            const samples = ['a', 'vibe-ch1', 'cc-01-first-session', '0', 'a'.repeat(80), 'a'.repeat(81), '', '-a', 'A', 'ch1.5', 'ch_1', 'a/b', 'é', 'a b', 'vibe-coding\n'];
            for (const sample of samples) assert.equal(check.test(sample), isSafeSlug(sample), `${column} ${JSON.stringify(sample)}`);
        }
    });

    it('the state CHECK lists LESSON_STATES; pct, size and keys are bounded', () => {
        const states = /state\s+text\s+NOT NULL DEFAULT 'not_started' CHECK \(state IN \(([^)]+)\)\)/.exec(sql);
        assert.ok(states);
        assert.deepEqual(states[1].split(',').map((s) => s.trim().replace(/'/g, '')), [...LESSON_STATES]);
        assert.match(lower, /pct smallint not null default 0 check \(pct between 0 and 100\)/);
        assert.match(lower, new RegExp(`progress jsonb not null check \\(jsonb_typeof\\(progress\\) = 'object' and octet_length\\(progress::text\\) <= ${PROGRESS_MAX_BYTES}\\)`));
        assert.match(lower, /content_hash text null check \(content_hash is null or length\(content_hash\) <= 80\)/);
        assert.match(lower, /progress_updated_at timestamptz not null/);
        assert.match(lower, /primary key \(user_id, course_slug, lesson_id\)/);
    });

    it('both tables cascade on account deletion; the epoch is a random uuid; no sequences', () => {
        assert.match(lower, /create table if not exists lesson_progress \( user_id uuid not null references auth\.users\(id\) on delete cascade/);
        assert.match(lower, /create table if not exists lesson_progress_resets \( user_id uuid primary key references auth\.users\(id\) on delete cascade, epoch uuid not null default gen_random_uuid\(\), reset_at timestamptz not null default now\(\)/);
        assert.doesNotMatch(lower, /serial|sequence|identity/, 'the remote role has no sequence privileges');
        assert.match(lower, /create trigger lesson_progress_updated_at before update on lesson_progress for each row execute function set_updated_at\(\); exception when duplicate_object then null;/);
        assert.doesNotMatch(lower, /row level security/);
    });

    it('is listed in the migrations README chain', () => {
        const readme = readFileSync(new URL('../migrations/README.md', import.meta.url), 'utf8');
        assert.match(readme, /\| `016_lesson_progress\.sql` \|/);
    });
});
