/**
 * The app keeps answering when Postgres is down (Phase 1 / P1-4).
 *
 * - The shared pool had no connect timeout: with the database host up but Postgres not answering,
 *   every request waited forever. Routes now fail fast and answer 503 { error_type: 'db_connection' }.
 * - The job worker leaked a client on every empty poll (about one every 2 s, so its pool ran dry in
 *   ~20 s), released twice when a job failed, and rolled back on a client it had already released.
 *   It now uses the shared pool, releases exactly once and backs off while the database is down.
 *
 * Real pg pools against a TCP server that never answers and a port that refuses connections.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createApp } from '../../server.js';
import { getPool, setPoolForTests, resetPoolForTests } from '../db.js';
import { JobWorker } from '../jobWorker.js';

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'PG_CONNECT_TIMEOUT_MS',
    'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'];

/** A TCP server that accepts connections and never says anything, like a hung Postgres. */
const silentServer = async () => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `postgresql://rp:rp@127.0.0.1:${server.address().port}/rp`,
        close: async () => {
            for (const socket of sockets) socket.destroy();
            await new Promise((resolve) => server.close(resolve));
        },
    };
};

/** A port nothing listens on: connections are refused at once. */
const refusedUrl = async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    return `postgresql://rp:rp@127.0.0.1:${port}/rp`;
};

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2`);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
};

describe('routes answer 503 when the database cannot be reached', () => {
    const saved = {};
    let hole = null;
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development'; // dev fallback user, so requests reach the routes
        process.env.PG_CONNECT_TIMEOUT_MS = '200';
        resetPoolForTests();
    });
    afterEach(async () => {
        await hole?.close();
        hole = null;
        await getPool()?.end().catch(() => {});
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    const expect503 = async (url, init = {}) => {
        const started = Date.now();
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
        const elapsed = Date.now() - started;
        assert.equal(response.status, 503, `${url}: ${response.status}`);
        const body = await response.json();
        assert.equal(body.error_type, 'db_connection');
        assert.equal(response.headers.get('retry-after'), '10');
        assert.doesNotMatch(JSON.stringify(body), /timeout|ECONNREFUSED|127\.0\.0\.1/i, 'no driver detail in the body');
        assert.ok(elapsed < 3000, `answered after ${elapsed} ms`);
    };

    it('Postgres accepts the connection but never answers', async () => {
        hole = await silentServer();
        process.env.DATABASE_URL_PHASE1 = hole.url;
        await withServer(async (base) => {
            await expect503(`${base}/user/profile`);
            await expect503(`${base}/curricula`);
        });
    });

    it('a route that connects before its try still answers 503 JSON (last error handler)', async () => {
        process.env.DATABASE_URL_PHASE1 = await refusedUrl();
        await withServer(async (base) => {
            await expect503(`${base}/user/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: 'Learner' }),
            });
        });
    });

    it('the database port refuses connections', async () => {
        process.env.DATABASE_URL_PHASE1 = await refusedUrl();
        await withServer(async (base) => {
            await expect503(`${base}/user/profile`);
            await expect503(`${base}/curricula`);
        });
    });
});

describe('job worker: one release per claim, backoff while the database is down', () => {
    const connectionLost = () => new Error('Connection terminated unexpectedly');

    /**
     * A pg client stand-in that records queries and releases. Like pg, it throws when released while
     * it is not checked out, and it counts queries made while it is back in the pool.
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

    let worker;
    beforeEach(() => {
        worker = new JobWorker();
    });
    afterEach(() => {
        worker.stop();
        resetPoolForTests();
    });

    it('releases the client once when the queue is empty', async () => {
        const client = fakeClient(() => undefined);
        setPoolForTests(fakePool(client));
        for (let i = 0; i < 3; i++) await worker.processNextJob();
        assert.equal(client.releases.length, 3, 'one release per poll');
        assert.ok(client.queries.includes('ROLLBACK'));
    });

    it('releases once when a job fails, and never touches the client after releasing it', async () => {
        const job = { id: 'job-1', user_id: 'user-1', type: 'unknown-type', payload: {} };
        const client = fakeClient((sql) => (sql.startsWith('SELECT id, user_id, type, payload') ? { rowCount: 1, rows: [job] } : undefined));
        const marked = [];
        setPoolForTests(fakePool(client, async (sql, params) => {
            marked.push(params);
            return { rowCount: 1, rows: [] };
        }));
        await worker.processNextJob();
        assert.equal(client.releases.length, 1);
        assert.equal(client.queriesAfterRelease, 0);
        assert.ok(marked.some((params) => params?.[0] === 'job-1'), 'the job is marked');
    });

    it('does not release twice when marking the job fails because the database went away', async () => {
        const job = { id: 'job-2', user_id: 'user-1', type: 'unknown-type', payload: {} };
        const client = fakeClient((sql) => (sql.startsWith('SELECT id, user_id, type, payload') ? { rowCount: 1, rows: [job] } : undefined));
        setPoolForTests(fakePool(client, async () => {
            throw connectionLost();
        }));
        await worker.processNextJob().catch(() => {});
        assert.equal(client.releases.length, 1);
        assert.equal(client.queriesAfterRelease, 0, 'no ROLLBACK on a released client');
    });

    it('drops a client whose connection broke while claiming', async () => {
        const lost = connectionLost();
        const client = fakeClient((sql) => (sql.startsWith('SELECT id, user_id, type, payload') ? lost : undefined));
        setPoolForTests(fakePool(client));
        await assert.rejects(() => worker.processNextJob());
        assert.equal(client.releases.length, 1);
        assert.ok(client.releases[0], 'released with the error, so pg discards the client');
    });

    it('waits longer after each failed poll while the database is down, and resets once it is back', async () => {
        let down = true;
        worker.processNextJob = async () => {
            if (down) throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
        };
        const delays = [];
        for (let i = 0; i < 7; i++) delays.push(await worker.tick());
        assert.deepEqual(delays, [4000, 8000, 16000, 32000, 60000, 60000, 60000]);
        down = false;
        assert.equal(await worker.tick(), 2000);
    });

    it('keeps the normal interval for errors that are not an outage', async () => {
        worker.processNextJob = async () => {
            throw new Error('Unknown job type: x');
        };
        assert.equal(await worker.tick(), 2000);
    });
});
