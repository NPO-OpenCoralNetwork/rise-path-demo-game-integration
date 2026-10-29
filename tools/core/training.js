// @ts-check
/**
 * Shared Business Logic — job training (doc/brushup-2026/training-plan.ja.md D1, D3, D7; §4.1, §4.3).
 * Tables training_cohorts and training_memberships (server/migrations/021_training_cohorts.sql).
 *
 * A membership's user_id has no foreign key to auth.users (D3, like legal_acceptances): account
 * deletion marks it (account_deleted_at, server/services/accountDeletion.js) and never deletes it.
 * The learner's own reads see unmarked rows only, so an account re-opened under the same id starts
 * with no cohort; the staff list shows marked rows too. A membership is written only under the
 * account's shared lock and only while the auth.users stub exists (the rule of
 * server/routes/legal.js): a deletion holds the same lock exclusively, so no row outlives it unmarked.
 *
 * Callers: GET /api/v2/training/me (server/routes/training.js) and the staff script
 * scripts/training-admin.mjs. Failures return { error, error_type } (tools/core/dbErrors.js), never
 * the driver's text.
 */
import { getPool } from '../../server/db.js';
import { accountLockKey, canonicalUserId } from './accountDeletions.js';
import { classifyDbError } from './dbErrors.js';
import { noDatabase } from './dbTransaction.js';

/** @typedef {import('./dbTransaction.js').CoreError} CoreError */
/** @typedef {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number | null }> }} Queryable */
/** @typedef {Queryable & { connect?: () => Promise<Queryable & { release: (error?: unknown) => void }> }} TrainingPool */
/** @typedef {{ cohortId: string, name: string, role: string }} TrainingCohort */

/** The roles of a membership (D7: 受講者・講師・確認用・職員). */
export const TRAINING_ROLES = Object.freeze(['learner', 'instructor', 'examiner', 'staff']);

/** A cohort's slug: the same rule as a course slug (migration 021 checks it too). */
export const COHORT_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** How long adding a member waits for the account lock (a deletion in progress) before giving up. */
export const TRAINING_LOCK_TIMEOUT = '10s';

/** The statements, exactly as sent ($1 is the canonical account id where a statement takes one). */
export const TRAINING_SQL = Object.freeze({
    me: `SELECT c.id AS cohort_id, c.name, m.role
  FROM training_memberships m
  JOIN training_cohorts c ON c.id = m.cohort_id
 WHERE m.user_id = $1::uuid AND m.account_deleted_at IS NULL
 ORDER BY c.starts_on, c.id`,
    // Staff (scripts/training-admin.mjs). $1 slug, $2 name, $3 and $4 the dates (or NULL).
    createCohort: 'INSERT INTO training_cohorts (slug, name, starts_on, ends_on) VALUES ($1, $2, $3::date, $4::date) ON CONFLICT (slug) DO NOTHING RETURNING id',
    // Dates as text: pg reads a DATE as local midnight, so east of UTC (Asia/Tokyo) a Date of
    // 2026-11-01 would print as 2026-10-31 (the to_char rule of achievements.js and reviewQueue.js).
    cohortBySlug: "SELECT id, slug, name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on FROM training_cohorts WHERE slug = $1",
    lockTimeout: `SET LOCAL lock_timeout = '${TRAINING_LOCK_TIMEOUT}'`,
    // Its own statement, so the INSERT below reads a snapshot taken after a deletion it waited for.
    lock: `SELECT pg_advisory_xact_lock_shared(${accountLockKey(1)})`,
    // Only while the stub exists: a deleted account has none (migration 018's trigger keeps it away).
    // added_at is always the default, so the deletion's mark is never earlier than it (the CHECK).
    addMember: 'INSERT INTO training_memberships (cohort_id, user_id, role) SELECT $2::uuid, $1::uuid, $3 WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid) ON CONFLICT (cohort_id, user_id) WHERE account_deleted_at IS NULL DO NOTHING RETURNING id',
    liveMember: 'SELECT role FROM training_memberships WHERE user_id = $1::uuid AND cohort_id = $2::uuid AND account_deleted_at IS NULL',
    deletedAccount: 'SELECT 1 FROM account_deletions WHERE user_id = $1::uuid AND reopened_at IS NULL',
    // Marked rows too: the staff list is a record (D3); $1 is the cohort id here.
    members: 'SELECT user_id, role, added_at, account_deleted_at FROM training_memberships WHERE cohort_id = $1::uuid ORDER BY added_at, id',
});

/** @param {unknown} value @returns {string | null} */
const isoTime = (value) => {
    if (value === null || value === undefined) return null;
    const ms = new Date(/** @type {any} */ (value)).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** A calendar date as YYYY-MM-DD that exists (2026-02-30 does not). @param {unknown} value */
export const isCalendarDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/**
 * The caller's cohorts and role in each (GET /api/v2/training/me). One statement, live rows only.
 * @param {{ userId: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ learnerId: string, cohorts: TrainingCohort[] } | CoreError>}
 */
export async function getTrainingMe({ userId: rawUserId, pool = getPool() }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return { error: 'A signed-in learner is required.', error_type: 'validation' };
    if (!pool) return noDatabase();
    try {
        const { rows } = await pool.query(TRAINING_SQL.me, [userId]);
        return {
            learnerId: userId,
            cohorts: rows.map((row) => ({ cohortId: String(row.cohort_id), name: String(row.name), role: String(row.role) })),
        };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'getTrainingMe');
    }
}

/**
 * @typedef {{ id: string, slug: string, name: string, startsOn: string | null, endsOn: string | null }} CohortRow
 */

/** @param {any} row @returns {CohortRow} */
const cohortOf = (row) => ({ id: String(row.id), slug: String(row.slug), name: String(row.name), startsOn: row.starts_on ?? null, endsOn: row.ends_on ?? null });

/**
 * Staff: create a cohort. An existing slug is left as it is ('exists', with its stored values).
 * @param {{ slug: string, name: string, startsOn?: string | null, endsOn?: string | null, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'created' | 'exists', cohort: CohortRow } | CoreError>}
 */
export async function createCohort({ slug, name, startsOn = null, endsOn = null, pool = getPool() }) {
    if (!COHORT_SLUG.test(String(slug))) return { error: 'The slug takes a-z, 0-9 and "-" (up to 80, not starting with "-").', error_type: 'validation' };
    const title = String(name ?? '').trim();
    if (!title || Array.from(title).length > 200) return { error: 'The name takes 1 to 200 characters.', error_type: 'validation' };
    for (const date of [startsOn, endsOn]) {
        if (date !== null && !isCalendarDate(date)) return { error: 'Dates are YYYY-MM-DD.', error_type: 'validation' };
    }
    if (startsOn && endsOn && endsOn < startsOn) return { error: 'The end date is before the start date.', error_type: 'validation' };
    if (!pool) return noDatabase();
    try {
        const inserted = (await pool.query(TRAINING_SQL.createCohort, [slug, title, startsOn, endsOn])).rows?.[0];
        const row = (await pool.query(TRAINING_SQL.cohortBySlug, [slug])).rows?.[0];
        if (!row) return { error: 'The cohort could not be read back.', error_type: 'unknown' };
        return { status: inserted ? 'created' : 'exists', cohort: cohortOf(row) };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'createCohort');
    }
}

/**
 * Staff: add an account to a cohort with a role, under the account's shared lock and only while its
 * auth.users stub exists (a person who has never signed in to this deployment has none yet).
 * @param {{ cohortSlug: string, userId: unknown, role: string, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'added' | 'already', role: string }
 *   | { status: 'role_differs', role: string }
 *   | { status: 'no_cohort' | 'deleted_account' | 'no_account' }
 *   | CoreError>} CoreError 'account_busy' when the lock wait passed TRAINING_LOCK_TIMEOUT
 */
export async function addMember({ cohortSlug, userId: rawUserId, role, pool = getPool() }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return { error: 'An account id (a UUID) is required.', error_type: 'validation' };
    if (!TRAINING_ROLES.includes(role)) return { error: `The role is one of ${TRAINING_ROLES.join(', ')}.`, error_type: 'validation' };
    if (!COHORT_SLUG.test(String(cohortSlug))) return { error: 'Unknown cohort slug.', error_type: 'validation' };
    if (!pool?.connect) return noDatabase();
    /** @type {any} */
    let client;
    /** @type {string} */
    let cohortId;
    try {
        // Cohorts are never deleted, so the id read before the lock stays valid.
        const cohort = (await pool.query(TRAINING_SQL.cohortBySlug, [cohortSlug])).rows?.[0];
        if (!cohort) return { status: 'no_cohort' };
        cohortId = String(cohort.id);
        client = await pool.connect();
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'addMember');
    }
    let broken = false;
    try {
        await client.query('BEGIN');
        await client.query(TRAINING_SQL.lockTimeout);
        await client.query(TRAINING_SQL.lock, [userId]);
        /** @type {{ status: any, role?: string }} */
        let outcome;
        if ((await client.query(TRAINING_SQL.addMember, [userId, cohortId, role])).rows?.[0]) outcome = { status: 'added', role };
        else {
            const live = (await client.query(TRAINING_SQL.liveMember, [userId, cohortId])).rows?.[0];
            if (live) outcome = { status: String(live.role) === role ? 'already' : 'role_differs', role: String(live.role) };
            else if (((await client.query(TRAINING_SQL.deletedAccount, [userId])).rowCount ?? 0) > 0) outcome = { status: 'deleted_account' };
            else outcome = { status: 'no_account' };
        }
        await client.query(outcome.status === 'added' ? 'COMMIT' : 'ROLLBACK');
        return /** @type {any} */ (outcome);
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            broken = true;
        }
        // lock_timeout (55P03): an account deletion held the lock longer than TRAINING_LOCK_TIMEOUT.
        if (/** @type {any} */ (err)?.code === '55P03') return { error: 'The account is busy. Try again.', error_type: 'account_busy' };
        return classifyDbError(/** @type {any} */ (err), 'addMember');
    } finally {
        client.release(broken);
    }
}

/**
 * Staff: a cohort and every membership it ever had (marked rows too, D3).
 * @param {{ cohortSlug: string, pool?: TrainingPool | null }} params
 * @returns {Promise<{ cohort: CohortRow, members: { userId: string, role: string, addedAt: string | null, accountDeletedAt: string | null }[] }
 *   | { status: 'no_cohort' } | CoreError>}
 */
export async function listMembers({ cohortSlug, pool = getPool() }) {
    if (!COHORT_SLUG.test(String(cohortSlug))) return { error: 'Unknown cohort slug.', error_type: 'validation' };
    if (!pool) return noDatabase();
    try {
        const row = (await pool.query(TRAINING_SQL.cohortBySlug, [cohortSlug])).rows?.[0];
        if (!row) return { status: 'no_cohort' };
        const cohort = cohortOf(row);
        const { rows } = await pool.query(TRAINING_SQL.members, [cohort.id]);
        return {
            cohort,
            members: rows.map((m) => ({ userId: String(m.user_id), role: String(m.role), addedAt: isoTime(m.added_at), accountDeletedAt: isoTime(m.account_deleted_at) })),
        };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'listMembers');
    }
}
