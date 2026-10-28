import pg from 'pg';
import { describeError } from './utils/redactUrl.js';
const { Pool } = pg;

/** Marks a pg client that pool.connect() handed out and that was not released yet. */
const CHECKED_OUT = Symbol('checkedOut');

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
    warnedNoUrl = false;
}

export const isDbConfigured = () => Boolean(process.env.DATABASE_URL_PHASE1?.trim());

// As long as account deletion's lock_timeout (10 s, accountDeletion.js): a burst that fills the pool
// behind its locks still gets a connection.
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
// Without a delay the OS default applies (2 h on Linux): far too late to notice a dead peer.
const KEEPALIVE_INITIAL_DELAY_MS = 10_000;
// Node timers fire after 1 ms beyond this, so a larger value would mean "no wait at all".
const MAX_TIMER_MS = 2_147_483_647;

/** @param {string | undefined} value @returns {number} the positive integer it spells (a timer's range), else 0 */
const positiveInt = (value) => {
    const text = String(value ?? '').trim();
    const n = /^\d+$/.test(text) ? Number(text) : 0;
    return n <= MAX_TIMER_MS ? n : 0;
};

/**
 * Settings of the shared pool. pg waits forever by default, so a database that accepted
 * connections but stopped answering held every request forever. Getting a connection now fails
 * after PG_CONNECT_TIMEOUT_MS (10 s). pg-pool applies the same limit to a checkout queued behind a
 * full pool (PG_POOL_MAX clients, pg's default 10): one that waits longer fails as an outage too.
 *
 * statement_timeout is sent only when PG_STATEMENT_TIMEOUT_MS is set: a value sent at connect time
 * overrides the role's own (mcp-public's risepath_mcp_remote has 10 s, mcp_remote_role.sql). There
 * is no client-side query_timeout: account deletion runs statements for up to 60 s (SET LOCAL).
 * @param {string} connectionString
 * @param {Record<string, string | undefined>} [env]
 */
export function poolConfig(connectionString, env = process.env) {
    const statementMs = positiveInt(env.PG_STATEMENT_TIMEOUT_MS);
    const max = positiveInt(env.PG_POOL_MAX);
    return {
        connectionString,
        connectionTimeoutMillis: positiveInt(env.PG_CONNECT_TIMEOUT_MS) || DEFAULT_CONNECT_TIMEOUT_MS,
        keepAlive: true,
        keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
        ...(max > 0 ? { max } : {}),
        ...(statementMs > 0 ? { statement_timeout: statementMs } : {}),
    };
}

let warnedNoUrl = false;

export const getPool = () => {
    if (poolOverrideActive) return poolOverrideForTests;
    if (pool) return pool;
    
    const connectionString = process.env.DATABASE_URL_PHASE1?.trim();
    if (!connectionString) {
        // Once: the job worker asks every few seconds, and a database-less dev setup is normal.
        if (!warnedNoUrl) console.warn("DATABASE_URL_PHASE1 is not set. DB features will fail.");
        warnedNoUrl = true;
        return null;
    }
    
    pool = new Pool(poolConfig(connectionString));
    
    // Add global error handler to prevent crash on idle client errors
    pool.on('error', (err) => {
        console.error(`[DB] idle connection lost: ${describeError(err)}`);
        // Don't exit process, just log
    });
    // pg-pool listens for errors only while a client is idle. pg emits 'error' on a checked-out
    // client whose connection drops (a Postgres restart in the middle of a pool.connect()
    // transaction), and without a listener that took the whole process down. The query in flight
    // still fails, and pg-pool drops the broken client when it is released. Idle clients are
    // logged by the handler above, so this one logs only clients in use.
    pool.on('connect', (client) => {
        client.on('error', (err) => {
            if (client[CHECKED_OUT]) console.warn(`[DB] connection lost while in use: ${describeError(err)}`);
        });
    });
    pool.on('acquire', (client) => {
        client[CHECKED_OUT] = true;
    });
    pool.on('release', (_err, client) => {
        client[CHECKED_OUT] = false;
    });

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
