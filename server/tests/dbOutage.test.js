/**
 * Postgres outages on the real server.js stack, with real pg pools.
 *
 * - The shared pool had no connect timeout: when Postgres accepted connections but never answered,
 *   every request waited forever. They now fail after PG_CONNECT_TIMEOUT_MS and answer 503.
 * - An error no route answered was a 500 even when the database was down; it is now a 503 with
 *   Retry-After.
 * - pg emits 'error' on a checked-out client whose connection drops, and pg-pool listens only on
 *   idle clients: a connection lost in the middle of a transaction took the process down.
 *
 * Servers: one that accepts and never answers, one that completes the startup handshake and drops
 * the connection on the first query, and a port that refuses connections.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

// Read when kokoroTts.js is imported (through server.js): a port where no TTS sidecar listens.
process.env.KOKORO_TTS_URL = 'http://127.0.0.1:1';
const { createApp } = await import('../../server.js');
const { getPool, resetPoolForTests } = await import('../db.js');
const { isDbUnavailable } = await import('../../tools/core/dbErrors.js');

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'PG_CONNECT_TIMEOUT_MS', 'PG_STATEMENT_TIMEOUT_MS',
    'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET'];

/** Listen on a free loopback port; `close` destroys open sockets first. */
const listen = async (onSocket) => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        onSocket(socket);
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

/** Accepts connections and never says anything, like a hung Postgres. */
const silentPostgres = () => listen(() => {});

/** Completes the startup handshake (AuthenticationOk, ReadyForQuery), then drops the connection on the first query. */
const droppingPostgres = () => listen((socket) => {
    let started = false;
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
        if (started) {
            socket.destroy();
            return;
        }
        pending = Buffer.concat([pending, chunk]);
        if (pending.length < 4 || pending.length < pending.readInt32BE(0)) return;
        started = true;
        socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
    });
});

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
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2`);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
};

/** fetch with a deadline: a request that hangs fails the test instead of the run. */
const request = async (url, init = {}) => {
    const started = Date.now();
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, json: JSON.parse(text), elapsed: Date.now() - started };
};

const PROFILE_PUT = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'Learner' }),
};

describe('requests while Postgres cannot serve them', () => {
    const saved = {};
    let fake = null;
    let quiet;
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development'; // the dev fallback user, so requests reach the routes
        process.env.PG_CONNECT_TIMEOUT_MS = '200';
        resetPoolForTests();
        // The routes log the failures (warn and error); keep the test output readable.
        quiet = { warn: console.warn, error: console.error };
        console.warn = () => {};
        console.error = () => {};
    });
    afterEach(async () => {
        console.warn = quiet.warn;
        console.error = quiet.error;
        await fake?.close();
        fake = null;
        await getPool()?.end().catch(() => {});
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('a connection that never answers fails after PG_CONNECT_TIMEOUT_MS, as an outage', { timeout: 10_000 }, async () => {
        fake = await silentPostgres();
        process.env.DATABASE_URL_PHASE1 = fake.url;
        const started = Date.now();
        const error = await getPool().query('SELECT 1').then(() => null, (err) => err);
        assert.ok(error, 'the query fails');
        assert.ok(Date.now() - started < 2000, `failed after ${Date.now() - started} ms`);
        assert.equal(isDbUnavailable(error), true, error.message);
    });

    it('a route answers 503 within the connect timeout when Postgres accepts but never answers', { timeout: 10_000 }, async () => {
        fake = await silentPostgres();
        process.env.DATABASE_URL_PHASE1 = fake.url;
        await withServer(async (base) => {
            const result = await request(`${base}/user/lesson-progress`);
            assert.equal(result.status, 503, result.text);
            assert.equal(result.json.error_type, 'lesson_progress_unavailable');
            assert.ok(result.elapsed < 3000, `answered after ${result.elapsed} ms`);
        });
    });

    it('an error no route answered is a 503 with Retry-After when the database refuses connections', { timeout: 10_000 }, async () => {
        process.env.DATABASE_URL_PHASE1 = await refusedUrl();
        await withServer(async (base) => {
            // PUT /user/profile calls pool.connect() before its try, so the error reaches the last handler.
            const result = await request(`${base}/user/profile`, PROFILE_PUT);
            assert.equal(result.status, 503, result.text);
            assert.deepEqual(result.json, { error: 'Service Unavailable' });
            assert.equal(result.headers.get('retry-after'), '10');
        });
    });

    it('a connection lost in the middle of a transaction answers JSON and does not take the process down', { timeout: 10_000 }, async () => {
        fake = await droppingPostgres();
        process.env.DATABASE_URL_PHASE1 = fake.url;
        await withServer(async (base) => {
            const result = await request(`${base}/user/profile`, PROFILE_PUT);
            assert.ok(result.status >= 500, result.text);
            assert.equal(typeof result.json.error, 'string');
            assert.doesNotMatch(result.text, /Connection terminated|127\.0\.0\.1/, 'no driver text in the body');
            // The process is still serving.
            const again = await request(`${base}/user/profile`, PROFILE_PUT);
            assert.ok(again.status >= 500, again.text);
        });
    });
});
