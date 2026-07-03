import pg from 'pg';
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

export const getPool = () => {
    if (poolOverrideActive) return poolOverrideForTests;
    if (pool) return pool;
    
    const connectionString = process.env.DATABASE_URL_PHASE1?.trim();
    if (!connectionString) {
        console.warn("DATABASE_URL_PHASE1 is not set. DB features will fail.");
        return null;
    }
    
    pool = new Pool({ connectionString });
    
    // Add global error handler to prevent crash on idle client errors
    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
        // Don't exit process, just log
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
