import pg from 'pg';
import { isDbUnavailable } from '../tools/core/dbErrors.js';
const { Pool } = pg;

// Environment variable helper
export const PHASE1_USER_ID = process.env.PHASE1_USER_ID || '00000000-0000-0000-0000-000000000001';

let pool = null;
let poolOverrideActive = false;
let poolOverrideForTests = null;

/** @param {import('pg').Pool | null} mockPool */
export function setPoolForTests(mockPool) {
    poolOverrideForTests = mockPool;
    poolOverrideActive = true;
}

export function resetPoolForTests() {
    poolOverrideForTests = null;
    poolOverrideActive = false;
    pool = null;
}

export const isDbConfigured = () => Boolean(process.env.DATABASE_URL_PHASE1?.trim());

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

const nonNegativeInt = (value, fallback) => {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Pool settings. pg waits forever by default, so a database that stopped answering held every
 * request (and the job worker) until the TCP stack gave up. Here getting a connection fails after
 * PG_CONNECT_TIMEOUT_MS, and the server cancels a statement after PG_STATEMENT_TIMEOUT_MS (0 turns
 * that server setting off, for a pooler that rejects it). The client gives up a little after the
 * server's limit (or the default one), for a server that stops answering in the middle of a query.
 * @param {string} connectionString
 * @param {Record<string, string | undefined>} [env]
 */
export function poolConfig(connectionString, env = process.env) {
    const statementMs = nonNegativeInt(env.PG_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS);
    const limitMs = statementMs || DEFAULT_STATEMENT_TIMEOUT_MS;
    return {
        connectionString,
        connectionTimeoutMillis: nonNegativeInt(env.PG_CONNECT_TIMEOUT_MS, 0) || DEFAULT_CONNECT_TIMEOUT_MS,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
        // Without a delay the OS default applies (2 h on Linux), too late to notice a dead peer.
        keepAliveInitialDelayMillis: 10_000,
        ...(statementMs > 0 && { statement_timeout: statementMs }),
        query_timeout: limitMs + Math.min(5_000, limitMs),
    };
}

/**
 * pg-pool only listens for errors on idle clients. A client checked out with pool.connect() that
 * lost its connection mid-query emitted an unhandled 'error' and took the process down. And a
 * client whose query timed out stayed open, possibly inside a transaction, and went back to the
 * pool for the next request. Each client now logs its errors, and is closed after a query that
 * timed out or lost the connection: the server rolls back what it had open, pg-pool drops it on
 * release, and a ROLLBACK queued behind it fails at once instead of waiting for another timeout.
 * @param {import('pg').PoolClient} client
 */
function guardClient(client) {
    client.on('error', (err) => console.warn('[DB] Connection lost:', err.message));
    let closing = false;
    const query = client.query.bind(client);
    client.query = (...args) => {
        const pending = query(...args);
        // Promise queries only: callback and stream queries (pool.query) are handled by pg-pool.
        if (typeof pending?.catch === 'function') {
            pending.catch((err) => {
                if (closing || !isDbUnavailable(err)) return;
                closing = true;
                client.end().catch(() => {});
            });
        }
        return pending;
    };
}

let warnedNoUrl = false;

export const getPool = () => {
    if (poolOverrideActive) return poolOverrideForTests;
    if (pool) return pool;

    const connectionString = process.env.DATABASE_URL_PHASE1?.trim();
    if (!connectionString) {
        // Once: the job worker asks every 2 s, and DB-less dev (demo mode) is a normal setup.
        if (!warnedNoUrl) console.warn("DATABASE_URL_PHASE1 is not set. DB features will fail.");
        warnedNoUrl = true;
        return null;
    }

    pool = new Pool(poolConfig(connectionString));

    // Add global error handler to prevent crash on idle client errors
    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
        // Don't exit process, just log
    });
    pool.on('connect', guardClient);

    return pool;
};

// Note: ensurePhase1User() was removed in Phase 7.
// Supabase Auth is external; GCP Postgres keeps auth.users as an ID stub for FK integrity.

/**
 * Upsert Supabase user UUID into auth.users stub (nexloom-gce risepath).
 * @param {import('pg').Pool | null} pool
 * @param {string} userId
 */
export async function ensureAuthUser(pool, userId) {
    if (!pool || !userId) return;
    await pool.query(
        'INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT (id) DO NOTHING',
        [userId]
    );
}

/** Upsert auth.users stub using the shared pool (all JWT / bridge entry points). */
export async function syncAuthUserStub(userId) {
    const pool = getPool();
    if (!pool || !userId) return;
    try {
        await ensureAuthUser(pool, userId);
    } catch (err) {
        console.warn('[Auth] ensureAuthUser failed:', err.message);
    }
}
