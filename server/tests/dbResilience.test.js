/**
 * A Postgres outage degrades the app instead of hanging it or taking it down.
 *
 * - server/db.js: a connect timeout and TCP keepalive on the shared pool; statement_timeout only
 *   when PG_STATEMENT_TIMEOUT_MS is set; one "not set" warning instead of one per call.
 * - tools/core/dbErrors.js: isDbUnavailable, and classifyDbError reports every outage as
 *   db_connection (routes answer 503 for it).
 * - server/jobWorker.js: the shared pool, one release per claim, and a longer wait between polls
 *   while the database is down.
 * - tools/core/kokoroTts.js: a failed preference read falls back to the default voice.
 * - A ROLLBACK that fails in a catch block (the connection is gone) never replaces the error being
 *   handled.
 *
 * Fake pools and clients only; server/tests/dbOutage.test.js runs real pg pools.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../db.js';
import * as dbErrors from '../../tools/core/dbErrors.js';
import * as jobWorkerModule from '../jobWorker.js';
import * as ragService from '../ragService.js';
import { setEmbeddingClientForTests, resetEmbeddingClientForTests } from '../../tools/core/ragSearch.js';
import { deleteLifeJournalData } from '../services/lifeJournalPrivacyService.js';

// Read when kokoroTts.js is imported (also through routes/ai.js): a port where no TTS sidecar listens.
process.env.KOKORO_TTS_URL = 'http://127.0.0.1:1';
const { loadUserTtsPreferences } = await import('../../tools/core/kokoroTts.js');
const { saveDraftVersion } = await import('../routes/ai.js');

const { JobWorker } = jobWorkerModule;
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CURRICULUM = 'c0000000-0000-4000-8000-000000000001';
const MATERIAL = 'b0000000-0000-4000-8000-000000000002';

/** Replace console[method] while `run` runs and return what it logged. */
const capture = async (method, run) => {
    const original = console[method];
    const lines = [];
    console[method] = (...args) => lines.push(args.map(String).join(' '));
    try {
        await run();
    } finally {
        console[method] = original;
    }
    return lines;
};

describe('shared pool settings', () => {
    it('gives up on a connection after PG_CONNECT_TIMEOUT_MS (10 s by default) and keeps sockets alive', () => {
        const config = db.poolConfig('postgresql://db/rp', {});
        assert.equal(config.connectionString, 'postgresql://db/rp');
        assert.equal(config.connectionTimeoutMillis, 10000);
        assert.equal(config.keepAlive, true);
        assert.equal(config.keepAliveInitialDelayMillis, 10000);
        assert.equal(db.poolConfig('x', { PG_CONNECT_TIMEOUT_MS: '1500' }).connectionTimeoutMillis, 1500);
        // 2^31 ms and more: a Node timer would fire after 1 ms.
        for (const bad of ['', '0', '-1', 'abc', '1.5', '10s', '2147483648']) {
            assert.equal(db.poolConfig('x', { PG_CONNECT_TIMEOUT_MS: bad }).connectionTimeoutMillis, 10000, `PG_CONNECT_TIMEOUT_MS=${bad}`);
        }
    });

    it('sizes the pool from PG_POOL_MAX, and leaves pg its default (10) otherwise', () => {
        assert.equal('max' in db.poolConfig('x', {}), false);
        assert.equal(db.poolConfig('x', { PG_POOL_MAX: '20' }).max, 20);
        for (const bad of ['', '0', '-3', 'many']) {
            assert.equal('max' in db.poolConfig('x', { PG_POOL_MAX: bad }), false, `PG_POOL_MAX=${bad}`);
        }
    });

    it('sends statement_timeout only when PG_STATEMENT_TIMEOUT_MS is set, and never a client query_timeout', () => {
        // A statement_timeout sent at connect overrides the role's own (mcp-public's role has 10 s),
        // and a client-side query_timeout would cut account deletion's SET LOCAL 60 s statements.
        const config = db.poolConfig('x', {});
        assert.equal('statement_timeout' in config, false);
        assert.equal('query_timeout' in config, false);
        assert.equal(db.poolConfig('x', { PG_STATEMENT_TIMEOUT_MS: '30000' }).statement_timeout, 30000);
        assert.equal('query_timeout' in db.poolConfig('x', { PG_STATEMENT_TIMEOUT_MS: '30000' }), false);
        for (const bad of ['', '0', '-5', 'x']) {
            assert.equal('statement_timeout' in db.poolConfig('x', { PG_STATEMENT_TIMEOUT_MS: bad }), false, `PG_STATEMENT_TIMEOUT_MS=${bad}`);
        }
    });

    describe('getPool', () => {
        const KEYS = ['DATABASE_URL_PHASE1', 'PG_CONNECT_TIMEOUT_MS', 'PG_POOL_MAX', 'PG_STATEMENT_TIMEOUT_MS'];
        const saved = {};
        beforeEach(() => {
            for (const key of KEYS) {
                saved[key] = process.env[key];
                delete process.env[key];
            }
            db.resetPoolForTests();
        });
        afterEach(() => {
            db.resetPoolForTests();
            for (const key of KEYS) {
                if (saved[key] === undefined) delete process.env[key];
                else process.env[key] = saved[key];
            }
        });

        it('builds the pool from poolConfig', async () => {
            process.env.DATABASE_URL_PHASE1 = 'postgresql://rp:rp@127.0.0.1:1/rp';
            const pool = db.getPool();
            try {
                assert.equal(pool.options.connectionTimeoutMillis, 10000);
                assert.equal(pool.options.keepAlive, true);
            } finally {
                await pool.end();
            }
        });

        it('warns once, not on every call, when DATABASE_URL_PHASE1 is not set', async () => {
            delete process.env.DATABASE_URL_PHASE1;
            const warnings = await capture('warn', () => {
                for (let i = 0; i < 3; i++) assert.equal(db.getPool(), null);
            });
            assert.equal(warnings.filter((line) => line.includes('DATABASE_URL_PHASE1')).length, 1, warnings.join('\n'));
        });
    });
});

describe('isDbUnavailable and classifyDbError', () => {
    const code = (value) => Object.assign(new Error(`failed (${value})`), { code: value });
    const OUTAGES = [
        ...['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].map(code),
        // admin_shutdown, crash_shutdown, cannot_connect_now, too_many_connections, class 08
        ...['57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006', '08007', '08P01'].map(code),
        // pg-pool and pg raise these as plain Errors without a code.
        new Error('timeout exceeded when trying to connect'),
        new Error('Connection terminated unexpectedly'),
        new Error('Connection terminated due to connection timeout'),
        new Error('Query read timeout'),
        new Error('Client has encountered a connection error and is not queryable'),
        // localhost resolves to ::1 and 127.0.0.1: both refused.
        new AggregateError([code('ECONNREFUSED'), code('ECONNREFUSED')], 'connect failed'),
    ];
    const NOT_OUTAGES = [
        code('23505'), code('42P01'), code('22P02'), code('42501'), code('40P01'), code('0800'), code('E08000'),
        new Error('deadlock detected'),
        new Error('relation "x" does not exist'),
        // After client.end() or pool.end(): a bug to log, not an outage to hide behind a 503.
        new Error('Client was closed and is not queryable'),
        // A provider outage (fetch wraps the socket error): not the database.
        Object.assign(new TypeError('fetch failed'), { cause: code('ECONNREFUSED') }),
        new AggregateError([new Error('a'), code('23505')], 'mixed'),
        null, undefined, 'ECONNREFUSED', 42,
    ];

    it('recognises lost and refused connections, and nothing else', () => {
        for (const err of OUTAGES) assert.equal(dbErrors.isDbUnavailable(err), true, `${err.code ?? err.message}`);
        for (const err of NOT_OUTAGES) assert.equal(dbErrors.isDbUnavailable(err), false, String(err?.code ?? err?.message ?? err));
    });

    it('classifies every outage as db_connection, without the driver text and without a log line', async () => {
        // Callers log (or not) as before, e.g. the achievements hook after a save logs its own line.
        let errors = [];
        const warnings = await capture('warn', async () => {
            errors = await capture('error', () => {
                for (const err of OUTAGES) {
                    const result = dbErrors.classifyDbError(err, 'readThings');
                    assert.equal(result.error_type, 'db_connection', `${err.code ?? err.message}`);
                    assert.equal(result.error, 'Database connection failed during readThings');
                }
            });
        });
        assert.deepEqual([...warnings, ...errors], []);
    });

    it('keeps the other classifications', async () => {
        const quiet = await capture('error', () => {
            assert.equal(dbErrors.classifyDbError(code('42P01'), 'op').error_type, 'table_not_found');
            assert.equal(dbErrors.classifyDbError(code('23505'), 'op').error_type, 'conflict');
            assert.equal(dbErrors.classifyDbError(code('22P02'), 'op').error_type, 'validation');
            assert.equal(dbErrors.classifyDbError(code('42501'), 'op').error_type, 'permission_denied');
            assert.deepEqual(dbErrors.classifyDbError(new Error('deadlock detected'), 'op'), { error: 'op failed', error_type: 'unknown' });
        });
        assert.ok(quiet.length >= 1, 'unknown and permission errors are logged');
    });
});

describe('job worker: one release per claim, backoff while the database is down', () => {
    const connectionLost = () => new Error('Connection terminated unexpectedly');

    /**
     * A pg client stand-in that records queries and releases. Like pg-pool, it throws when it is
     * released while not checked out, and it counts queries made while it is back in the pool.
     */
    const fakeClient = (answer) => {
        const client = {
            checkedOut: false,
            queries: [],
            releases: [],
            queriesAfterRelease: 0,
            async query(sql) {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                if (!client.checkedOut) client.queriesAfterRelease += 1;
                client.queries.push(text);
                const result = answer(text);
                if (result instanceof Error) throw result;
                return result ?? { rowCount: 0, rows: [] };
            },
            release(err) {
                if (!client.checkedOut) throw new Error('Release called on client which has already been released to the pool.');
                client.checkedOut = false;
                client.releases.push(err ?? null);
            },
        };
        return client;
    };

    const fakePool = (client, poolQuery = async () => ({ rowCount: 1, rows: [] })) => ({
        async connect() {
            client.checkedOut = true;
            return client;
        },
        query: poolQuery,
        on() {},
    });

    const claims = (job) => (sql) => (sql.startsWith('SELECT id, user_id, type, payload') ? { rowCount: 1, rows: [job] } : undefined);

    let worker;
    beforeEach(() => {
        worker = new JobWorker();
    });
    afterEach(() => {
        worker.stop();
        db.resetPoolForTests();
    });

    it('releases the client once per poll when the queue is empty (on the shared pool)', async () => {
        const client = fakeClient(() => undefined);
        db.setPoolForTests(fakePool(client));
        for (let i = 0; i < 3; i++) await worker.processNextJob();
        assert.equal(client.releases.length, 3, 'one release per poll');
        assert.deepEqual(client.queries.filter((sql) => sql === 'ROLLBACK').length, 3);
    });

    it('releases once when the jobs table is missing', async () => {
        const missing = Object.assign(new Error('relation "jobs" does not exist'), { code: '42P01' });
        const client = fakeClient((sql) => (sql.startsWith('SELECT id, user_id, type, payload') ? missing : undefined));
        db.setPoolForTests(fakePool(client));
        await capture('log', async () => {
            await worker.processNextJob();
            await worker.processNextJob();
        });
        assert.equal(client.releases.length, 2);
    });

    it('releases once when a job fails, and never touches the client after releasing it', async () => {
        const job = { id: 'job-1', user_id: USER, type: 'unknown-type', payload: {} };
        const client = fakeClient(claims(job));
        const marked = [];
        db.setPoolForTests(fakePool(client, async (sql, params) => {
            marked.push(params);
            return { rowCount: 1, rows: [] };
        }));
        await capture('error', () => worker.processNextJob());
        assert.equal(client.releases.length, 1);
        assert.equal(client.queriesAfterRelease, 0);
        assert.ok(marked.some((params) => params?.[0] === 'job-1' && params?.[1] === 'unknown_job_type'), 'the job is marked with its code');
    });

    it('does not release twice when marking the job fails because the database went away', async () => {
        const job = { id: 'job-2', user_id: USER, type: 'unknown-type', payload: {} };
        const client = fakeClient(claims(job));
        db.setPoolForTests(fakePool(client, async () => {
            throw connectionLost();
        }));
        await capture('error', () => worker.processNextJob().catch(() => {}));
        assert.equal(client.releases.length, 1);
        assert.equal(client.queriesAfterRelease, 0, 'no ROLLBACK on a released client');
    });

    it('drops a client whose connection broke while claiming (its ROLLBACK fails too)', async () => {
        const lost = connectionLost();
        const notQueryable = new Error('Client has encountered a connection error and is not queryable');
        const client = fakeClient((sql) => {
            if (sql.startsWith('SELECT id, user_id, type, payload')) return lost;
            return sql === 'ROLLBACK' ? notQueryable : undefined;
        });
        db.setPoolForTests(fakePool(client));
        await assert.rejects(() => worker.processNextJob(), lost);
        assert.equal(client.releases.length, 1);
        assert.equal(client.releases[0], notQueryable, 'released with the error, so pg-pool discards the client');
    });

    it('keeps a healthy client after a plain SQL error (its ROLLBACK worked)', async () => {
        const denied = Object.assign(new Error('permission denied for table jobs'), { code: '42501' });
        const client = fakeClient((sql) => (sql.startsWith('SELECT id, user_id, type, payload') ? denied : undefined));
        db.setPoolForTests(fakePool(client));
        await assert.rejects(() => worker.processNextJob(), denied);
        assert.deepEqual(client.releases, [null], 'released without an error: pg-pool reuses the connection');
        assert.ok(client.queries.includes('ROLLBACK'));
    });

    it('waits 2 s between polls, doubling after each failed poll while the database is down (60 s at most)', () => {
        assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map(jobWorkerModule.pollDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    });

    it('backs off while the database is down, logs one line per outage, and resets once it is back', async () => {
        let down = true;
        worker.processNextJob = async () => {
            if (down) throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
        };
        const delays = [];
        const warnings = await capture('warn', async () => {
            for (let i = 0; i < 7; i++) delays.push(await worker.tick());
        });
        assert.deepEqual(delays, [4000, 8000, 16000, 32000, 60000, 60000, 60000]);
        assert.equal(warnings.length, 1, warnings.join('\n'));
        assert.doesNotMatch(warnings[0], /127\.0\.0\.1/, 'no address in the log line');
        down = false;
        const back = await capture('log', async () => {
            assert.equal(await worker.tick(), 2000);
            assert.equal(await worker.tick(), 2000);
        });
        assert.equal(back.length, 1, back.join('\n'));
    });

    it('keeps the normal interval for errors that are not an outage', async () => {
        worker.processNextJob = async () => {
            throw new Error('Unknown job type: x');
        };
        await capture('error', async () => {
            assert.equal(await worker.tick(), 2000);
        });
    });

    it('an error from a database that answered ends an outage, so the next outage is logged again', async () => {
        let mode = 'down';
        worker.processNextJob = async () => {
            if (mode === 'down') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
            throw Object.assign(new Error('permission denied for table jobs'), { code: '42501' });
        };
        const lines = [];
        const original = { warn: console.warn, log: console.log, error: console.error };
        for (const method of ['warn', 'log', 'error']) console[method] = (line) => lines.push(`${method} ${line}`);
        try {
            assert.equal(await worker.tick(), 4000);
            mode = 'answered';
            assert.equal(await worker.tick(), 2000);
            mode = 'down';
            assert.equal(await worker.tick(), 4000, 'a new outage starts from the short wait');
        } finally {
            Object.assign(console, original);
        }
        assert.equal(lines.filter((line) => line.startsWith('warn')).length, 2, lines.join('\n'));
        assert.equal(lines.filter((line) => line.includes('reachable again')).length, 1, lines.join('\n'));
    });
});

describe('smaller outage paths', () => {
    afterEach(() => db.resetPoolForTests());

    it('a failed TTS preference read falls back to the default voice instead of failing the request', async () => {
        db.setPoolForTests({
            query: async () => {
                throw new Error('Connection terminated unexpectedly');
            },
        });
        const warnings = await capture('warn', async () => {
            assert.equal(await loadUserTtsPreferences(USER), null);
        });
        assert.equal(warnings.length, 1);
    });

    /**
     * A client whose first statement after BEGIN fails with `original` and whose ROLLBACK fails
     * too, as when the connection is gone. Records its releases.
     */
    const brokenClient = (original) => {
        const client = {
            releases: [],
            async query(sql) {
                const text = String(sql).trim();
                if (text === 'BEGIN') return { rowCount: 0, rows: [] };
                if (text === 'ROLLBACK') throw new Error('Client has encountered a connection error and is not queryable');
                throw original;
            },
            release(err) {
                client.releases.push(err ?? null);
            },
        };
        return client;
    };
    const lostConnection = () => new Error('Connection terminated unexpectedly');

    it('saveDraftVersion (routes/ai.js): a failed ROLLBACK keeps the original error', async () => {
        const original = lostConnection();
        const client = brokenClient(original);
        await assert.rejects(
            saveDraftVersion({ connect: async () => client }, { curriculumId: CURRICULUM, userId: USER, curriculum: {} }),
            (err) => err === original,
        );
        assert.equal(client.releases.length, 1);
    });

    it('deleteLifeJournalData: a failed ROLLBACK keeps the original error', async () => {
        const original = lostConnection();
        const client = brokenClient(original);
        await assert.rejects(
            deleteLifeJournalData({ pool: { connect: async () => client }, userId: USER, scope: 'all' }),
            (err) => err === original,
        );
        assert.equal(client.releases.length, 1);
    });

    it('ingestMaterial (ragService.js): a failed ROLLBACK keeps the original error', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ingest-'));
        const file = path.join(dir, 'notes.txt');
        fs.writeFileSync(file, '教材のテキストです。'.repeat(20));
        const original = lostConnection();
        const client = brokenClient(original);
        // Embeddings off: the chunks are stored without vectors, after a count of the embedded ones.
        setEmbeddingClientForTests(null);
        db.setPoolForTests({ query: async () => ({ rowCount: 1, rows: [{ embedded: 0 }] }), connect: async () => client });
        try {
            await capture('error', () => assert.rejects(
                ragService.ingestMaterial(MATERIAL, file, 'text/plain', USER),
                (err) => err === original,
            ));
        } finally {
            resetEmbeddingClientForTests();
            fs.rmSync(dir, { recursive: true, force: true });
        }
        assert.equal(client.releases.length, 1);
    });

    it('ragService no longer exports the material readers that skipped the owner check', () => {
        assert.equal('getFullMaterialText' in ragService, false);
        assert.equal('getMaterialDetails' in ragService, false);
    });
});
