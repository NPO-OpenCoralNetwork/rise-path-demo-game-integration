// Admin safety routes (server/routes/adminSafety.js) mounted the way server.js mounts them, minus
// requireAuth/requireAdmin (requireAdmin has its own tests): a signed-in admin is assumed.
// The access state comes from the fake pool in helpers/aiAccessPool.js.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import adminSafetyRoutes from '../routes/adminSafety.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { createSafetyEvents, resetSafetyEventsForTests } from '../safety/events.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADULT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NEW_USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REPORT_ID = '99999999-9999-4999-8999-999999999999';

const withAdmin = async (handler) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.userId = ADMIN;
        next();
    });
    app.use('/api/v2/admin', adminSafetyRoutes);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/admin`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
};

const call = async (url, { method = 'GET', body } = {}) => {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
};

describe('admin safety routes', () => {
    const saved = {};
    const savedConsole = { info: console.info, warn: console.warn, error: console.error };
    let pool;

    const makePool = (answer) => createAiAccessPool({
        ages: { [CHILD]: '2014-04', [ADULT]: '1990-01' },
        answer,
    });

    beforeEach(() => {
        for (const key of ['NODE_ENV', 'AI_ACCESS_DEV_AUDIENCE', 'SAFETY_BLOCKS_BEFORE_PAUSE']) saved[key] = process.env[key];
        process.env.NODE_ENV = 'development';
        delete process.env.AI_ACCESS_DEV_AUDIENCE;
        delete process.env.SAFETY_BLOCKS_BEFORE_PAUSE;
        resetAiAccessForTests();
        resetSafetyEventsForTests();
        console.info = () => {};
        console.warn = () => {};
        console.error = () => {};
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        Object.assign(console, savedConsole);
        resetPoolForTests();
    });

    it('GET /safety/summary counts by kind, category, surface and day without learner text, and prunes', async () => {
        pool = makePool((sql) => {
            if (sql.startsWith('select kind, category, surface, audience')) {
                return { rows: [
                    { kind: 'input_blocked', category: 'personal_info', surface: 'tutor', audience: 'minor', n: 3 },
                    { kind: 'input_blocked', category: 'violence', surface: 'tutor', audience: 'minor', n: 1 },
                    { kind: 'user_report', category: 'harmful', surface: 'tutor', audience: 'adult', n: 2 },
                ] };
            }
            if (sql.startsWith("select to_char(created_at at time zone 'asia/tokyo'")) return { rows: [{ day: '2026-10-22', kind: 'input_blocked', n: 4 }] };
            if (sql.startsWith('select count(*)::int as n from ai_safety_events where kind')) return { rows: [{ n: 2 }] };
            return undefined;
        });
        setPoolForTests(pool);
        await withAdmin(async (base) => {
            const result = await call(`${base}/safety/summary?days=9999`);
            assert.equal(result.status, 200);
            assert.equal(result.json.days, 365, 'days is capped at a year');
            assert.deepEqual(result.json.totals, { input_blocked: 4, user_report: 2 });
            assert.equal(result.json.groups.length, 3);
            assert.deepEqual(result.json.byDay, [{ day: '2026-10-22', kind: 'input_blocked', count: 4 }]);
            assert.equal(result.json.openReports, 2);
            assert.ok(!JSON.stringify(result.json).includes('detail'));
        });
        const prune = pool.queries.filter((q) => q.sql.startsWith('update ai_safety_events set detail = null') || q.sql.startsWith('delete from ai_safety_events'));
        assert.equal(prune.length, 2);
        assert.deepEqual(prune.map((q) => q.params[0]), [90, 365]);
    });

    it('GET /safety/reports lists reports with their text, filters by status, and marks cleared text', async () => {
        let seen;
        pool = makePool((sql, params) => {
            if (sql.startsWith('select id, created_at, user_id, audience, surface, category,')) {
                seen = { sql, params };
                return { rows: [
                    { id: REPORT_ID, created_at: new Date('2026-10-20T01:00:00Z'), user_id: CHILD, audience: 'minor', surface: 'tutor', category: 'harmful', detail: { reason: 'harmful', answer: 'A', question: 'Q', context: { lessonId: 'l1' } }, status: 'open', reviewed_by: null, reviewed_at: null },
                    { id: 'r2', created_at: new Date('2026-06-01T01:00:00Z'), user_id: null, audience: null, surface: 'other', category: 'wrong', detail: null, status: 'open', reviewed_by: null, reviewed_at: null },
                ] };
            }
            return undefined;
        });
        setPoolForTests(pool);
        await withAdmin(async (base) => {
            const result = await call(`${base}/safety/reports?status=open&limit=500`);
            assert.equal(result.status, 200);
            assert.deepEqual(seen.params, [200, 90, 365, 'open'], 'limit is capped; retention days and status are parameters');
            // Retention holds even before the next prune: text past 90 days reads as null, rows past 365 days are not listed.
            assert.match(seen.sql, /case when created_at < now\(\) - make_interval\(days => \$2::int\) then null else detail end as detail/);
            assert.match(seen.sql, /created_at >= now\(\) - make_interval\(days => \$3::int\)/);
            const [first, second] = result.json.reports;
            assert.equal(first.answer, 'A');
            assert.equal(first.question, 'Q');
            assert.deepEqual(first.context, { lessonId: 'l1' });
            assert.equal(first.reason, 'harmful');
            assert.equal(first.textCleared, false);
            assert.equal(first.createdAt, '2026-10-20T01:00:00.000Z');
            assert.equal(second.textCleared, true);
            assert.equal(second.answer, null);

            assert.equal((await call(`${base}/safety/reports?status=all`)).status, 200);
            assert.deepEqual(seen.params, [50, 90, 365]);
            assert.equal((await call(`${base}/safety/reports?status=deleted`)).status, 400);
            assert.equal((await call(`${base}/safety/reports?before=yesterday`)).status, 400);
        });
    });

    it('POST /safety/reports/:id/review records the reviewing admin; unknown ids are 404', async () => {
        pool = makePool((sql, params) => {
            if (sql.startsWith("update ai_safety_events set status = 'reviewed'")) {
                return params[0] === REPORT_ID ? { rowCount: 1, rows: [{ id: REPORT_ID, reviewed_at: new Date('2026-10-22T03:00:00Z') }] } : { rowCount: 0, rows: [] };
            }
            return undefined;
        });
        setPoolForTests(pool);
        await withAdmin(async (base) => {
            const ok = await call(`${base}/safety/reports/${REPORT_ID}/review`, { method: 'POST' });
            assert.equal(ok.status, 200);
            assert.equal(ok.json.reviewedAt, '2026-10-22T03:00:00.000Z');
            const update = pool.queries.find((q) => q.sql.startsWith("update ai_safety_events set status = 'reviewed'"));
            assert.deepEqual(update.params, [REPORT_ID, ADMIN]);
            assert.match(update.sql, /kind = 'user_report'/);
            assert.equal((await call(`${base}/safety/reports/not-a-uuid/review`, { method: 'POST' })).status, 404);
            assert.equal((await call(`${base}/safety/reports/${NEW_USER}/review`, { method: 'POST' })).status, 404);
        });
    });

    it("GET /users/:userId/ai-access shows the learner's state, policy version and recent events", async () => {
        pool = makePool((sql) => (sql.startsWith('select kind, count(*)::int as n from ai_safety_events where user_id') ? { rows: [{ kind: 'input_blocked', n: 2 }] } : undefined));
        setPoolForTests(pool);
        await withAdmin(async (base) => {
            const child = await call(`${base}/users/${CHILD}/ai-access`);
            assert.equal(child.status, 200);
            assert.equal(child.json.status, 'needs_guardian_consent');
            assert.equal(child.json.audience, 'minor');
            assert.equal(child.json.birthYm, '2014-04');
            assert.equal(child.json.policyVersion, 'guardian-ai-2026-10');
            assert.deepEqual(child.json.recentEvents, { input_blocked: 2 });
            assert.equal((await call(`${base}/users/${NEW_USER}/ai-access`)).json.status, 'needs_age');
            assert.equal((await call(`${base}/users/nope/ai-access`)).status, 404);
        });
    });

    it('PUT /users/:userId/age records a guardian or staff declaration and may correct an existing one', async () => {
        pool = makePool();
        setPoolForTests(pool);
        await withAdmin(async (base) => {
            assert.equal((await call(`${base}/users/${NEW_USER}/age`, { method: 'PUT', body: { birthYm: '2013-05', declaredBy: 'self' } })).status, 400);
            const bad = await call(`${base}/users/${NEW_USER}/age`, { method: 'PUT', body: { birthYm: '2013-13', declaredBy: 'staff' } });
            assert.equal(bad.status, 400);
            assert.equal(bad.json.error_type, 'invalid_birth_ym');
            const future = await call(`${base}/users/${NEW_USER}/age`, { method: 'PUT', body: { birthYm: '2999-01', declaredBy: 'staff' } });
            assert.equal(future.status, 400);

            const set = await call(`${base}/users/${NEW_USER}/age`, { method: 'PUT', body: { birthYm: '2013-05', declaredBy: 'guardian' } });
            assert.equal(set.status, 200);
            assert.equal(set.json.status, 'needs_guardian_consent');
            assert.equal(pool.ages[NEW_USER], '2013-05');

            const corrected = await call(`${base}/users/${CHILD}/age`, { method: 'PUT', body: { birthYm: '2000-01', declaredBy: 'staff' } });
            assert.equal(corrected.status, 200);
            assert.equal(corrected.json.audience, 'adult');
            assert.equal(corrected.json.status, 'ready');
        });
    });

    it('PUT /users/:userId/age answers 404 for a user that does not exist (foreign key)', async () => {
        pool = makePool();
        // The helper answers user_age inserts itself; wrap it so the database refuses the row.
        const inner = pool.query;
        pool.query = async (sql, params) => {
            if (String(sql).toLowerCase().includes('insert into user_age')) throw Object.assign(new Error('fk'), { code: '23503' });
            return inner(sql, params);
        };
        setPoolForTests(pool);
        await withAdmin(async (base) => {
            const result = await call(`${base}/users/${NEW_USER}/age`, { method: 'PUT', body: { birthYm: '2013-05', declaredBy: 'staff' } });
            assert.equal(result.status, 404);
            assert.equal(result.json.error_type, 'user_not_found');
        });
    });

    it('POST /users/:userId/guardian-consent records a paper form by this admin, for minors only; revoke stops AI again', async () => {
        pool = makePool();
        setPoolForTests(pool);
        await withAdmin(async (base) => {
            assert.equal((await call(`${base}/users/${CHILD}/guardian-consent`, { method: 'POST', body: { relationship: 'aunt' } })).status, 400);
            const noAge = await call(`${base}/users/${NEW_USER}/guardian-consent`, { method: 'POST', body: { relationship: 'parent' } });
            assert.equal(noAge.json.error_type, 'age_required');
            const adult = await call(`${base}/users/${ADULT}/guardian-consent`, { method: 'POST', body: { relationship: 'parent' } });
            assert.equal(adult.status, 400);
            assert.equal(adult.json.error_type, 'not_a_minor');

            const given = await call(`${base}/users/${CHILD}/guardian-consent`, { method: 'POST', body: { relationship: 'guardian' } });
            assert.equal(given.status, 201);
            assert.equal(given.json.status, 'ready');
            assert.equal(given.json.consent.method, 'staff_paper_form');
            const row = pool.consents.at(-1);
            assert.equal(row.recorded_by, ADMIN);
            assert.equal(row.relationship, 'guardian');
            assert.equal(row.method, 'staff_paper_form');

            const revoked = await call(`${base}/users/${CHILD}/guardian-consent/revoke`, { method: 'POST' });
            assert.equal(revoked.status, 200);
            assert.equal(revoked.json.revoked, 1);
            assert.equal(revoked.json.status, 'needs_guardian_consent');
        });
    });

    it('answers 503 without a database', async () => {
        setPoolForTests(null);
        await withAdmin(async (base) => {
            assert.equal((await call(`${base}/safety/summary`)).status, 503);
            assert.equal((await call(`${base}/safety/reports`)).status, 503);
            assert.equal((await call(`${base}/users/${CHILD}/ai-access`)).status, 503);
        });
    });
});

describe('safety events: storage, retention and alerts', () => {
    const quietLogger = () => {
        const lines = [];
        return { lines, info: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) };
    };

    it('stores report text only for user_report, never for blocked events; guests are counted by address', async () => {
        const queries = [];
        const pool = { query: async (sql, params) => { queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim().toLowerCase(), params }); return { rowCount: 1, rows: [{ n: 0 }] }; } };
        const events = createSafetyEvents({ getPool: () => pool, env: {}, logger: quietLogger(), fetch: null });
        await events.record({ kind: 'input_blocked', surface: 'tutor', userId: null, ip: '203.0.113.7', audience: 'adult', category: 'other', detail: { answer: 'secret' } });
        await events.record({ kind: 'user_report', surface: 'tutor', userId: ADULT, category: 'wrong', detail: { reason: 'wrong', answer: 'A' } });
        const inserts = queries.filter((q) => q.sql.startsWith('insert into ai_safety_events'));
        assert.equal(inserts[0].params[0], null);
        assert.equal(inserts[0].params[1], 'ip:203.0.113.7');
        assert.equal(inserts[0].params[6], null, 'a blocked event never keeps text');
        assert.equal(inserts[1].params[0], ADULT);
        assert.equal(inserts[1].params[1], null, 'a signed-in event keeps the user only in user_id (NULL after account deletion)');
        assert.deepEqual(JSON.parse(inserts[1].params[6]), { reason: 'wrong', answer: 'A' });
    });

    it('migration 014: subject is NULL for signed-in users and can hold only a guest address, so deleting an account leaves no id', () => {
        const sql = readFileSync(new URL('../migrations/014_minor_safeguards.sql', import.meta.url), 'utf8');
        const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS ai_safety_events'));
        const columns = Object.fromEntries(table.split('\n').map((line) => line.trim().match(/^(\w+)\s+(.*?),?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
        assert.match(columns.user_id, /REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
        assert.doesNotMatch(columns.subject, /NOT NULL/);
        assert.match(columns.subject, /CHECK \(subject IS NULL OR subject LIKE 'ip:%'\)/);
        // A CHECK that user_id or subject is set would make ON DELETE SET NULL fail for signed-in rows
        // (subject NULL), so account deletion would be refused.
        assert.doesNotMatch(table, /user_id IS NOT NULL OR subject IS NOT NULL/i);
    });

    it('prunes at most once an hour per process: report text after 90 days, events after 365', async () => {
        let t = Date.parse('2026-10-22T00:00:00Z');
        const queries = [];
        const pool = { query: async (sql, params) => { queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim().toLowerCase(), params }); return { rowCount: 0, rows: [] }; } };
        const events = createSafetyEvents({ getPool: () => pool, env: {}, now: () => t, logger: quietLogger(), fetch: null });
        assert.equal(await events.maybePrune(), true);
        assert.equal(await events.maybePrune(), false);
        t += 59 * 60 * 1000;
        assert.equal(await events.maybePrune(), false);
        t += 2 * 60 * 1000;
        assert.equal(await events.maybePrune(), true);
        assert.equal(queries.length, 4);
        assert.match(queries[0].sql, /^update ai_safety_events set detail = null where kind = 'user_report'/);
        assert.match(queries[1].sql, /^delete from ai_safety_events where created_at < now\(\)/);
    });

    it('alerts without learner text to SAFETY_ALERT_WEBHOOK_URL (https only), falling back to AI_CAP_ALERT_WEBHOOK_URL, at most once a minute per kind', async () => {
        let t = 0;
        const posts = [];
        const fetchImpl = async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
        const env = { SAFETY_ALERT_WEBHOOK_URL: 'https://hooks.example/safety', AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.example/caps' };
        const logger = quietLogger();
        const events = createSafetyEvents({ getPool: () => null, env, now: () => t, logger, fetch: fetchImpl });
        await events.record({ kind: 'user_report', surface: 'tutor', userId: CHILD, audience: 'minor', category: 'harmful', detail: { answer: 'SECRET ANSWER' } });
        await events.record({ kind: 'user_report', surface: 'tutor', userId: CHILD, category: 'harmful', detail: { answer: 'x' } });
        t += 61_000;
        await events.record({ kind: 'user_report', surface: 'tutor', userId: CHILD, category: 'wrong', detail: { answer: 'x' } });
        await events.record({ kind: 'input_blocked', surface: 'tutor', userId: CHILD, category: 'other' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(posts.length, 2, 'the second report within a minute is folded into the next line; blocked inputs do not alert');
        assert.equal(posts[0].url, 'https://hooks.example/safety');
        assert.match(posts[0].body.text, /new report/);
        assert.match(posts[0].body.text, /cccccccc/);
        assert.ok(!posts[0].body.text.includes(CHILD), 'only an 8-character user prefix');
        assert.match(posts[1].body.text, /\+1 more/);
        assert.ok(!JSON.stringify(posts).includes('SECRET'));

        const fallback = [];
        const viaCaps = createSafetyEvents({ getPool: () => null, env: { AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.example/caps' }, logger: quietLogger(), fetch: async (url) => { fallback.push(url); return { ok: true }; } });
        await viaCaps.record({ kind: 'support_shown', surface: 'tutor', userId: CHILD, category: 'self_harm' });
        assert.deepEqual(fallback, ['https://hooks.example/caps']);

        const insecure = [];
        const httpLogger = quietLogger();
        const viaHttp = createSafetyEvents({ getPool: () => null, env: { SAFETY_ALERT_WEBHOOK_URL: 'http://localhost:9/x' }, logger: httpLogger, fetch: async (url) => { insecure.push(url); return { ok: true }; } });
        await viaHttp.record({ kind: 'check_failed', surface: 'tutor', userId: CHILD });
        assert.deepEqual(insecure, [], 'http is refused for safety alerts');
        assert.ok(httpLogger.lines.some((l) => /SAFETY_ALERT_WEBHOOK_URL must use https/.test(l)));
        assert.ok(!httpLogger.lines.some((l) => l.includes('localhost:9')), 'the webhook URL is never logged');
    });

    it('alerts when a learner reaches SAFETY_BLOCKS_BEFORE_PAUSE blocked inputs today', async () => {
        const posts = [];
        let blocked = 2;
        const pool = { query: async (sql) => (String(sql).includes('count(*)') ? { rowCount: 1, rows: [{ n: blocked }] } : { rowCount: 1, rows: [] }) };
        const events = createSafetyEvents({ getPool: () => pool, env: { SAFETY_BLOCKS_BEFORE_PAUSE: '3', SAFETY_ALERT_WEBHOOK_URL: 'https://hooks.example/s' }, logger: quietLogger(), fetch: async (url, init) => { posts.push(JSON.parse(init.body).text); return { ok: true }; } });
        await events.record({ kind: 'input_blocked', surface: 'tutor', userId: CHILD, category: 'other' });
        blocked = 3;
        await events.record({ kind: 'input_blocked', surface: 'tutor', userId: CHILD, category: 'other' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(posts.length, 1);
        assert.match(posts[0], /AI paused until 00:00 JST/);
    });
});
