// Retention (Phase 4, owner decisions D4 and D5; server/services/retention.js): the settings, the
// exact statements, batching, the advisory lock, failure handling, the orphan upload sweep and the
// api's timer. The statements themselves ran on PostgreSQL 16 (scripts/db/verify-account-deletion.mjs R10).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BATCH_LIMIT,
    MAX_BATCHES_PER_STEP,
    ORPHAN_UPLOAD_HOURS,
    RETENTION_ENV_KEYS,
    RETENTION_INTERVAL_MS,
    RETENTION_LOCK_SQL,
    RETENTION_RULES,
    RETENTION_STEPS,
    RETENTION_UNLOCK_SQL,
    UPLOAD_CHUNK,
    UPLOAD_REFERENCES_SQL,
    readRetentionConfig,
    retentionStartupLine,
    runRetention,
    sweepOrphanUploads,
} from '../services/retention.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = fs.readFileSync(path.join(ROOT, 'server/services/retention.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HOUR = 60 * 60 * 1000;
const DEFAULTS = { ai_daily_usage: 30, processing: 365, deletion_proof: 5, ai_app_records: 3 };
const STEP_NAMES = ['ai_daily_usage', 'jobs', 'mcp_tool_calls', 'mcp_sessions', 'legal_acceptances', 'account_consent_proofs', 'ai_app_provision_records', 'account_deletions'];

const sqlOf = (step) => RETENTION_STEPS.find((s) => s.step === step).sql;
const stepOf = (sql) => RETENTION_STEPS.find((s) => s.sql === sql)?.step;

/**
 * A pool with one client. rowCounts: per step a number (every batch) or a list (one per batch, then 0).
 * fail: step names whose statement throws ('uploads' for the materials query).
 */
function fakePool({ locked = true, rowCounts = {}, fail = [], references = [], lockFails = false, unlockFails = false, connect } = {}) {
    const calls = [];
    const released = [];
    const lists = Object.fromEntries(Object.entries(rowCounts).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
    const client = {
        async query(sql, params) {
            calls.push({ sql, params, step: sql === RETENTION_LOCK_SQL ? 'lock' : sql === RETENTION_UNLOCK_SQL ? 'unlock' : sql === UPLOAD_REFERENCES_SQL ? 'uploads' : stepOf(sql) ?? 'other' });
            if (sql === RETENTION_LOCK_SQL) {
                if (lockFails) throw new Error('connection terminated');
                return { rows: [{ locked }] };
            }
            if (sql === RETENTION_UNLOCK_SQL) {
                if (unlockFails) throw new Error('connection terminated');
                return { rows: [{ pg_advisory_unlock: true }] };
            }
            if (sql === UPLOAD_REFERENCES_SQL) {
                if (fail.includes('uploads')) throw new Error('materials unavailable');
                return { rows: params[0].filter((p) => references.includes(p)).map((p) => ({ storage_path: p })) };
            }
            const step = stepOf(sql);
            if (!step) throw new Error(`unexpected statement: ${sql}`);
            if (fail.includes(step)) throw new Error(`relation "${step}" does not exist`);
            const value = lists[step];
            const n = Array.isArray(value) ? (value.length ? value.shift() : 0) : (value ?? 0);
            return { rowCount: n, rows: [] };
        },
        release(error) {
            released.push(error ?? null);
        },
    };
    return {
        pool: { connect: connect ?? (async () => client) },
        calls,
        released,
        statements: () => calls.filter((c) => STEP_NAMES.includes(c.step)),
    };
}

const quietLogger = () => {
    const lines = { log: [], warn: [] };
    return { lines, logger: { log: (line) => lines.log.push(line), warn: (line) => lines.warn.push(line) } };
};

let emptyRoot;
beforeEach(() => {
    emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-retention-empty-'));
});
afterEach(() => fs.rmSync(emptyRoot, { recursive: true, force: true }));

const run = (fake, { env = {}, logger = quietLogger().logger, uploadRoot = emptyRoot, now } = {}) =>
    runRetention({ pool: fake.pool, config: readRetentionConfig(env), logger, uploadRoot, now });

describe('retention settings (readRetentionConfig)', () => {
    it('four rules with the D4/D5 defaults; on with nothing set', () => {
        assert.deepEqual(RETENTION_RULES.map((r) => [r.name, r.env, r.unit, r.def, r.min, r.max]), [
            ['ai_daily_usage', 'RETENTION_AI_USAGE_DAYS', 'days', 30, 2, 400],
            ['processing', 'RETENTION_PROCESSING_DAYS', 'days', 365, 30, 3650],
            ['deletion_proof', 'RETENTION_DELETION_PROOF_YEARS', 'years', 5, 1, 10],
            ['ai_app_records', 'RETENTION_AI_APP_RECORD_YEARS', 'years', 3, 1, 10],
        ]);
        assert.deepEqual(RETENTION_ENV_KEYS, ['RETENTION_ENABLED', 'RETENTION_AI_USAGE_DAYS', 'RETENTION_PROCESSING_DAYS', 'RETENTION_DELETION_PROOF_YEARS', 'RETENTION_AI_APP_RECORD_YEARS']);
        assert.deepEqual(readRetentionConfig({}), { enabled: true, values: DEFAULTS, problems: [] });
        // docker-compose.yml passes every name as ${NAME:-}: empty and blank are unset.
        const empty = Object.fromEntries(RETENTION_ENV_KEYS.map((k) => [k, '']));
        assert.deepEqual(readRetentionConfig(empty), { enabled: true, values: DEFAULTS, problems: [] });
        assert.deepEqual(readRetentionConfig({ RETENTION_PROCESSING_DAYS: '   ' }), { enabled: true, values: DEFAULTS, problems: [] });
        assert.equal(ORPHAN_UPLOAD_HOURS, 24);
        assert.equal(BATCH_LIMIT, 5000);
        assert.equal(MAX_BATCHES_PER_STEP, 20);
        assert.equal(UPLOAD_CHUNK, 1000);
    });

    it('whole numbers within the range are used, at both ends', () => {
        const config = readRetentionConfig({
            RETENTION_AI_USAGE_DAYS: '2', RETENTION_PROCESSING_DAYS: ' 3650 ', RETENTION_DELETION_PROOF_YEARS: '10', RETENTION_AI_APP_RECORD_YEARS: '1',
        });
        assert.deepEqual(config, { enabled: true, values: { ai_daily_usage: 2, processing: 3650, deletion_proof: 10, ai_app_records: 1 }, problems: [] });
    });

    it('RETENTION_ENABLED: false/0/off/no (any case) turn it off; true/1/on/yes, unset or empty leave it on', () => {
        for (const value of ['false', 'FALSE', ' False ', '0', 'off', 'no']) {
            const config = readRetentionConfig({ RETENTION_ENABLED: value });
            assert.equal(config.enabled, false, value);
            assert.deepEqual(config.problems, [], value);
        }
        for (const value of [undefined, '', 'true', 'TRUE', '1', 'on', 'yes']) {
            assert.equal(readRetentionConfig({ RETENTION_ENABLED: value }).enabled, true, String(value));
        }
    });

    it('R: an unrecognised RETENTION_ENABLED turns it off with one problem (a deleting job fails closed)', () => {
        for (const value of ['ture', 'enabled', 'flase', '2']) {
            const config = readRetentionConfig({ RETENTION_ENABLED: value });
            assert.equal(config.enabled, false, value);
            assert.deepEqual(config.problems, ["RETENTION_ENABLED has an unrecognised value: retention is off (use 'true' or 'false')"], value);
        }
    });

    it('R: an invalid or out-of-range value turns THAT rule off, never the default or the nearest bound', () => {
        const cases = [
            ['RETENTION_AI_USAGE_DAYS', '1', 'ai_daily_usage', 'RETENTION_AI_USAGE_DAYS=1 is not a whole number from 2 to 400: AI usage counts are kept until it is fixed'],
            ['RETENTION_AI_USAGE_DAYS', '401', 'ai_daily_usage', 'RETENTION_AI_USAGE_DAYS=401 is not a whole number from 2 to 400: AI usage counts are kept until it is fixed'],
            ['RETENTION_PROCESSING_DAYS', 'abc', 'processing', 'RETENTION_PROCESSING_DAYS=abc is not a whole number from 30 to 3650: jobs and AI-app tool records are kept until it is fixed'],
            ['RETENTION_PROCESSING_DAYS', '90x', 'processing', 'RETENTION_PROCESSING_DAYS=90x is not a whole number from 30 to 3650: jobs and AI-app tool records are kept until it is fixed'],
            ['RETENTION_PROCESSING_DAYS', '365.5', 'processing', 'RETENTION_PROCESSING_DAYS=365.5 is not a whole number from 30 to 3650: jobs and AI-app tool records are kept until it is fixed'],
            ['RETENTION_PROCESSING_DAYS', '-30', 'processing', 'RETENTION_PROCESSING_DAYS=-30 is not a whole number from 30 to 3650: jobs and AI-app tool records are kept until it is fixed'],
            ['RETENTION_PROCESSING_DAYS', '1e3', 'processing', 'RETENTION_PROCESSING_DAYS=1e3 is not a whole number from 30 to 3650: jobs and AI-app tool records are kept until it is fixed'],
            ['RETENTION_DELETION_PROOF_YEARS', '0', 'deletion_proof', 'RETENTION_DELETION_PROOF_YEARS=0 is not a whole number from 1 to 10: deletion records and consent proofs of deleted accounts are kept until it is fixed'],
            ['RETENTION_DELETION_PROOF_YEARS', '11', 'deletion_proof', 'RETENTION_DELETION_PROOF_YEARS=11 is not a whole number from 1 to 10: deletion records and consent proofs of deleted accounts are kept until it is fixed'],
            ['RETENTION_AI_APP_RECORD_YEARS', 'three', 'ai_app_records', 'RETENTION_AI_APP_RECORD_YEARS=three is not a whole number from 1 to 10: AI-app records of deleted accounts are kept until it is fixed'],
        ];
        for (const [env, value, rule, problem] of cases) {
            const config = readRetentionConfig({ [env]: value });
            assert.equal(config.enabled, true, `${env}=${value}: the others still run`);
            assert.equal(config.values[rule], null, `${env}=${value}`);
            for (const other of Object.keys(DEFAULTS)) if (other !== rule) assert.equal(config.values[other], DEFAULTS[other], `${env}=${value}: ${other}`);
            assert.deepEqual(config.problems, [problem]);
        }
        // A long or odd value is cut to 20 printable characters in the line.
        const odd = readRetentionConfig({ RETENTION_AI_USAGE_DAYS: `30\u0007${'9'.repeat(40)}` });
        assert.equal(odd.values.ai_daily_usage, null);
        assert.match(odd.problems[0], /^RETENTION_AI_USAGE_DAYS=30\?9{17} is not a whole number/);
    });

    it('the start-up line names the periods, a rule that is off, and why retention is off', () => {
        assert.equal(retentionStartupLine(readRetentionConfig({})),
            '[Retention] on, hourly: ai_daily_usage 30 days, processing 365 days, deletion_proof 5 years, ai_app_records 3 years, orphan uploads after 24 h');
        assert.match(retentionStartupLine(readRetentionConfig({ RETENTION_PROCESSING_DAYS: 'x' })), /processing kept \(setting invalid\)/);
        assert.equal(retentionStartupLine(readRetentionConfig({ RETENTION_ENABLED: 'false' })), '[Retention] off (RETENTION_ENABLED=false)');
        assert.equal(retentionStartupLine(readRetentionConfig({ RETENTION_ENABLED: 'maybe' })), '[Retention] off (RETENTION_ENABLED has an unrecognised value)');
    });
});

describe('retention statements (exact SQL, design §6.2)', () => {
    it('the steps run in this order, each with its rule (proofs before the tombstones)', () => {
        assert.deepEqual(RETENTION_STEPS.map((s) => [s.step, s.rule]), [
            ['ai_daily_usage', 'ai_daily_usage'],
            ['jobs', 'processing'],
            ['mcp_tool_calls', 'processing'],
            ['mcp_sessions', 'processing'],
            ['legal_acceptances', 'deletion_proof'],
            ['account_consent_proofs', 'deletion_proof'],
            ['ai_app_provision_records', 'ai_app_records'],
            ['account_deletions', 'deletion_proof'],
        ]);
    });

    it('ai_daily_usage: Japan-time days, keeps today and the $1 days before, $2 rows per batch, by its primary key', () => {
        assert.equal(sqlOf('ai_daily_usage'),
            "WITH doomed AS (SELECT usage_day, kind, subject FROM ai_daily_usage WHERE usage_day < (now() AT TIME ZONE 'Asia/Tokyo')::date - $1::int LIMIT $2) DELETE FROM ai_daily_usage u USING doomed d WHERE u.usage_day = d.usage_day AND u.kind = d.kind AND u.subject = d.subject");
    });

    it('R: jobs are pruned in every status (a job left running by a stopped worker too), oldest first', () => {
        const jobs = sqlOf('jobs');
        assert.equal(jobs, 'DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE updated_at < now() - make_interval(days => $1) ORDER BY updated_at LIMIT $2)');
        assert.doesNotMatch(jobs, /status/i);
    });

    it('MCP tool calls and sessions: 1 year by default', () => {
        assert.equal(sqlOf('mcp_tool_calls'), 'DELETE FROM mcp_tool_calls WHERE id IN (SELECT id FROM mcp_tool_calls WHERE created_at < now() - make_interval(days => $1) ORDER BY created_at LIMIT $2)');
        assert.equal(sqlOf('mcp_sessions'), 'DELETE FROM mcp_sessions WHERE id IN (SELECT id FROM mcp_sessions WHERE started_at < now() - make_interval(days => $1) LIMIT $2)');
    });

    it('the proofs of deleted accounts: only rows whose account_deleted_at is older than the period (live acceptances have NULL)', () => {
        assert.equal(sqlOf('legal_acceptances'), 'DELETE FROM legal_acceptances WHERE id IN (SELECT id FROM legal_acceptances WHERE account_deleted_at < now() - make_interval(years => $1) LIMIT $2)');
        assert.equal(sqlOf('account_consent_proofs'), 'DELETE FROM account_consent_proofs WHERE consent_id IN (SELECT consent_id FROM account_consent_proofs WHERE account_deleted_at < now() - make_interval(years => $1) LIMIT $2)');
        assert.equal(sqlOf('ai_app_provision_records'), 'DELETE FROM ai_app_provision_records r USING (SELECT user_id, client_id, account_deleted_at FROM ai_app_provision_records WHERE account_deleted_at < now() - make_interval(years => $1) LIMIT $2) d WHERE r.user_id = d.user_id AND r.client_id = d.client_id AND r.account_deleted_at = d.account_deleted_at');
        assert.equal(sqlOf('account_deletions'), 'DELETE FROM account_deletions WHERE user_id IN (SELECT user_id FROM account_deletions WHERE deleted_at < now() - make_interval(years => $1) LIMIT $2)');
        assert.equal(UPLOAD_REFERENCES_SQL, 'SELECT storage_path FROM materials WHERE storage_path = ANY($1)');
        assert.equal(RETENTION_LOCK_SQL, "SELECT pg_try_advisory_lock(hashtextextended('risepath:retention', 0)) AS locked");
        assert.equal(RETENTION_UNLOCK_SQL, "SELECT pg_advisory_unlock(hashtextextended('risepath:retention', 0))");
    });

    it('R: the module deletes only from its eight tables: never auth.users, profiles, learning events, progress, live consents or billing', () => {
        const targets = [...MODULE.matchAll(/DELETE\s+FROM\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase());
        assert.deepEqual([...new Set(targets)].sort(), [...STEP_NAMES].sort());
        for (const forbidden of ['auth.users', 'user_profiles', 'learning_events', 'lesson_progress', 'account_consents', 'billing_']) {
            assert.ok(!targets.some((t) => t === forbidden || (forbidden.endsWith('_') && t.startsWith(forbidden))), forbidden);
            assert.ok(!MODULE.includes(`DELETE FROM ${forbidden}`), forbidden);
        }
        assert.doesNotMatch(MODULE, /\bTRUNCATE\b|\bDROP\s+(TABLE|SCHEMA)\b|\bUPDATE\s+[a-z_.]+\s+SET\b/i);
    });
});

describe('a retention run (runRetention)', () => {
    it('runs every step once with its period and the batch size, under the lock, then unlocks and releases', async () => {
        const fake = fakePool();
        const { lines, logger } = quietLogger();
        const result = await run(fake, { logger });
        assert.equal(result.ran, true);
        assert.deepEqual(fake.calls.map((c) => c.step), ['lock', ...STEP_NAMES, 'unlock']);
        assert.deepEqual(fake.statements().map((c) => c.params), [[30, 5000], [365, 5000], [365, 5000], [365, 5000], [5, 5000], [5, 5000], [3, 5000], [5, 5000]]);
        assert.deepEqual(fake.released, [null]);
        assert.deepEqual(result.deleted, Object.fromEntries([...STEP_NAMES, 'uploads'].map((k) => [k, 0])));
        assert.deepEqual(lines, { log: [], warn: [] }, 'nothing deleted: no line');
    });

    it('custom periods reach the statements', async () => {
        const fake = fakePool();
        await run(fake, { env: { RETENTION_AI_USAGE_DAYS: '7', RETENTION_PROCESSING_DAYS: '90', RETENTION_DELETION_PROOF_YEARS: '6', RETENTION_AI_APP_RECORD_YEARS: '4' } });
        assert.deepEqual(fake.statements().map((c) => c.params[0]), [7, 90, 90, 90, 6, 6, 4, 6]);
    });

    it('batches: a step repeats while a batch was full, and stops below 5000 or after 20 batches', async () => {
        const fake = fakePool({ rowCounts: { jobs: [5000, 5000, 12], ai_daily_usage: 5000, mcp_tool_calls: [4999] } });
        const { lines, logger } = quietLogger();
        const result = await run(fake, { logger });
        const per = (step) => fake.statements().filter((c) => c.step === step).length;
        assert.equal(per('ai_daily_usage'), 20);
        assert.equal(per('jobs'), 3);
        assert.equal(per('mcp_tool_calls'), 1);
        assert.equal(per('mcp_sessions'), 1);
        assert.equal(result.deleted.ai_daily_usage, 100000);
        assert.equal(result.deleted.jobs, 10012);
        assert.equal(result.deleted.mcp_tool_calls, 4999);
        assert.deepEqual(lines.log, ['[Retention] deleted ai_daily_usage=100000 jobs=10012 mcp_tool_calls=4999 mcp_sessions=0 legal_acceptances=0 account_consent_proofs=0 ai_app_provision_records=0 account_deletions=0 uploads=0']);
    });

    it('a failing step is logged and the next steps still run', async () => {
        const fake = fakePool({ fail: ['jobs', 'legal_acceptances'], rowCounts: { account_deletions: 2 } });
        const { lines, logger } = quietLogger();
        const result = await run(fake, { logger });
        assert.equal(result.ran, true);
        assert.deepEqual(fake.calls.map((c) => c.step), ['lock', ...STEP_NAMES, 'unlock']);
        assert.deepEqual(lines.warn, [
            '[Retention] jobs failed: relation "jobs" does not exist',
            '[Retention] legal_acceptances failed: relation "legal_acceptances" does not exist',
        ]);
        assert.equal(result.deleted.account_deletions, 2);
        assert.match(lines.log[0], /account_deletions=2/);
        assert.deepEqual(fake.released, [null]);
    });

    it('R: a rule that is off runs none of its statements; the problem is logged on every run', async () => {
        const env = { RETENTION_PROCESSING_DAYS: 'abc' };
        for (let i = 0; i < 2; i += 1) {
            const fake = fakePool();
            const { lines, logger } = quietLogger();
            const result = await run(fake, { env, logger });
            assert.deepEqual(fake.statements().map((c) => c.step), ['ai_daily_usage', 'legal_acceptances', 'account_consent_proofs', 'ai_app_provision_records', 'account_deletions']);
            assert.ok(!('jobs' in result.deleted));
            assert.deepEqual(lines.warn, ['[Retention] RETENTION_PROCESSING_DAYS=abc is not a whole number from 30 to 3650: jobs and AI-app tool records are kept until it is fixed']);
        }
    });

    it('the lock not acquired (another api runs it): no statements, no unlock, the client released', async () => {
        const fake = fakePool({ locked: false });
        const result = await run(fake);
        assert.deepEqual(result, { ran: false, deleted: {} });
        assert.deepEqual(fake.calls.map((c) => c.step), ['lock']);
        assert.deepEqual(fake.released, [null]);
    });

    it('off, or without a database: no connection at all', async () => {
        let connects = 0;
        const fake = fakePool({ connect: async () => { connects += 1; throw new Error('unexpected'); } });
        assert.deepEqual(await run(fake, { env: { RETENTION_ENABLED: 'false' } }), { ran: false, deleted: {} });
        assert.deepEqual(await run(fake, { env: { RETENTION_ENABLED: 'bogus' } }), { ran: false, deleted: {} });
        assert.deepEqual(await runRetention({ pool: null, config: readRetentionConfig({}), logger: quietLogger().logger }), { ran: false, deleted: {} });
        assert.equal(connects, 0);
    });

    it('never rejects: no connection, a lost lock query, a lost unlock', async () => {
        {
            const { lines, logger } = quietLogger();
            const fake = fakePool({ connect: async () => { throw new Error('connect ECONNREFUSED'); } });
            assert.deepEqual(await run(fake, { logger }), { ran: false, deleted: {} });
            assert.deepEqual(lines.warn, ['[Retention] skipped: no database connection (connect ECONNREFUSED)']);
        }
        {
            const { lines, logger } = quietLogger();
            const fake = fakePool({ lockFails: true });
            assert.deepEqual(await run(fake, { logger }), { ran: false, deleted: {} });
            assert.deepEqual(lines.warn, ['[Retention] skipped: the lock could not be read (connection terminated)']);
            assert.equal(fake.released.length, 1);
            assert.ok(fake.released[0] instanceof Error, 'a broken client is destroyed, not returned to the pool');
        }
        {
            // The session lock ends with the connection: a client whose unlock failed is destroyed.
            const fake = fakePool({ unlockFails: true });
            const result = await run(fake);
            assert.equal(result.ran, true);
            assert.ok(fake.released[0] instanceof Error);
        }
    });

    it('R: one run at a time in a process (a second call while one runs does nothing)', async () => {
        let open;
        const gate = new Promise((resolve) => { open = resolve; });
        const inner = fakePool();
        let connects = 0;
        const slow = { ...inner, pool: { connect: async () => { connects += 1; await gate; return inner.pool.connect(); } } };
        const first = run(slow);
        const secondRun = run(slow);
        const second = await Promise.race([secondRun, new Promise((resolve) => setTimeout(() => resolve('still waiting for a connection'), 200))]);
        open();
        await secondRun;
        assert.deepEqual(second, { ran: false, deleted: {} });
        assert.equal((await first).ran, true);
        assert.equal(connects, 1);
        assert.equal((await run(slow)).ran, true, 'free again after the first run');
    });
});

describe('orphan upload files (sweepOrphanUploads)', () => {
    let root;
    let dir;
    const now = Date.now();
    const old = (now - (ORPHAN_UPLOAD_HOURS + 1) * HOUR) / 1000;
    const recent = (now - (ORPHAN_UPLOAD_HOURS - 1) * HOUR) / 1000;
    const file = (name, mtime = old, content = 'x') => {
        const p = path.join(dir, name);
        fs.writeFileSync(p, content);
        fs.utimesSync(p, mtime, mtime);
        return p;
    };
    const exists = (p) => {
        try {
            fs.lstatSync(p);
            return true;
        } catch {
            return false;
        }
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-retention-'));
        dir = path.join(root, 'public', 'uploads');
        fs.mkdirSync(dir, { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('R: removes only upload-named regular files older than 24 h that no materials row names', async () => {
        const orphan = file('1700000000000-orphan.txt');
        const referenced = file('1700000000001-referenced.txt');
        const fresh = file('1700000000002-fresh.txt', recent);
        const unnamed = file('notes.txt');
        const short = file('170000000000-twelve-digits.txt');
        const canary = path.join(root, '1700000000009-outside.txt');
        fs.writeFileSync(canary, 'keep me');
        fs.utimesSync(canary, old, old);
        const link = path.join(dir, '1700000000003-link.txt');
        fs.symlinkSync(canary, link);
        fs.lutimesSync(link, old, old);
        const sub = path.join(dir, '1700000000004-dir');
        fs.mkdirSync(sub);
        fs.utimesSync(sub, old, old);
        const fake = fakePool({ references: ['public/uploads/1700000000001-referenced.txt'] });
        const client = await fake.pool.connect();

        const result = await sweepOrphanUploads({ client, uploadRoot: root, now: () => now });
        assert.deepEqual(result, { removed: 1, failed: 0 });
        assert.equal(exists(orphan), false, 'the orphan is gone');
        for (const kept of [referenced, fresh, unnamed, short, link, sub, canary]) assert.equal(exists(kept), true, kept);
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the symlink itself stays');
        assert.equal(fs.readFileSync(canary, 'utf8'), 'keep me', 'the file outside the folder is untouched');
        // One materials query with the two old regular upload files, as the upload route stores them.
        const queries = fake.calls.filter((c) => c.step === 'uploads');
        assert.deepEqual(queries.map((c) => c.params[0]), [['public/uploads/1700000000000-orphan.txt', 'public/uploads/1700000000001-referenced.txt']]);
    });

    it('R: a failing materials query removes nothing', async () => {
        const orphan = file('1700000000000-orphan.txt');
        const fake = fakePool({ fail: ['uploads'] });
        await assert.rejects(sweepOrphanUploads({ client: await fake.pool.connect(), uploadRoot: root, now: () => now }), /materials unavailable/);
        assert.equal(exists(orphan), true);
        // Inside a run it is one warning line; the other steps were done before.
        const { lines, logger } = quietLogger();
        const result = await run(fakePool({ fail: ['uploads'] }), { logger, uploadRoot: root, now: () => now });
        assert.equal(result.ran, true);
        assert.deepEqual(lines.warn, ['[Retention] uploads failed: materials unavailable']);
        assert.equal(exists(orphan), true);
    });

    it('no uploads folder: nothing to do; looked at in chunks of 1000, oldest name first', async () => {
        assert.deepEqual(await sweepOrphanUploads({ client: (await fakePool().pool.connect()), uploadRoot: path.join(root, 'missing'), now: () => now }), { removed: 0, failed: 0 });
        const names = [];
        for (let i = 0; i < UPLOAD_CHUNK + 5; i += 1) names.push(file(`${String(1700000000000 + i)}-f.txt`));
        const fake = fakePool({ references: ['public/uploads/1700000000000-f.txt'] });
        const { lines, logger } = quietLogger();
        const result = await run(fake, { logger, uploadRoot: root, now: () => now });
        const queries = fake.calls.filter((c) => c.step === 'uploads');
        assert.deepEqual(queries.map((c) => c.params[0].length), [UPLOAD_CHUNK, 5]);
        assert.equal(queries[0].params[0][0], 'public/uploads/1700000000000-f.txt');
        assert.equal(result.deleted.uploads, UPLOAD_CHUNK + 4);
        assert.equal(exists(names[0]), true);
        assert.match(lines.log[0], new RegExp(`uploads=${UPLOAD_CHUNK + 4}$`));
    });
});

describe('server.js: the retention timer', () => {
    const main = SERVER.slice(SERVER.indexOf('async function main()'));
    const createApp = SERVER.slice(SERVER.indexOf('export async function createApp'), SERVER.indexOf('async function main()'));

    it('R: main() reads the settings once, logs the problems and the start-up line, runs at start and hourly (unref)', () => {
        assert.match(main, /const retention = readRetentionConfig\(process\.env\);\n\s*for \(const problem of retention\.problems\) console\.warn\(`\[Retention\] \$\{problem\}`\);\n\s*console\.log\(retentionStartupLine\(retention\)\);\n\s*if \(retention\.enabled\) \{\n\s*void runRetention\(\{ config: retention \}\);\n\s*setInterval\(\(\) => void runRetention\(\{ config: retention \}\), RETENTION_INTERVAL_MS\)\.unref\(\);\n\s*\}/);
        assert.equal(RETENTION_INTERVAL_MS, 60 * 60 * 1000);
    });

    it('createApp starts no timer (tests import server.js)', () => {
        assert.ok(createApp.length > 1000);
        assert.doesNotMatch(createApp, /runRetention|readRetentionConfig|setInterval/);
    });
});
