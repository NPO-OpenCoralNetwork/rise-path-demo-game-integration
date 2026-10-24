// @ts-check
/**
 * Deleted Rise Path accounts (Phase 4, doc/brushup-2026/ai-access-plan.ja.md §8; migration 018).
 *
 * Deleting an account removes its Rise Path data and writes a row to account_deletions (the
 * tombstone). The Supabase login is shared with Nexloom and P-School and stays, so its sessions keep
 * working at Supabase: every Rise Path entry point asks readAccountState after the token was
 * verified. A session that signed in (newest JWT `amr` time, tools/core/oauthToken.js
 * sessionAuthTime) no later than deleted_at + ACCOUNT_SKEW_SECONDS belongs to the deleted account
 * and is refused. A session that signed in later is the person coming back: the app API re-opens
 * the account (reopenAccount: a new, empty account under the same id, whose generation separates
 * keys that outlive the data, such as Hermes conversations and the Stripe Customer key). Agents and
 * the SSE MCP never re-open (mayReopen false).
 *
 * Every id is lower-cased once (canonicalUserId) and every statement casts it ($1::uuid), so an
 * upper-case id takes the same advisory lock as the auth.users trigger of migration 018 and as the
 * deletion: the lock key is always 'rp:account:' || <id>::uuid::text.
 */
import { UUID_RE } from '../../server/utils/ids.js';

/** Clock-skew margin between the database (deleted_at) and Supabase (amr timestamps). */
export const ACCOUNT_SKEW_SECONDS = 30;

/**
 * Lower-case canonical form of a UUID (server/utils/ids.js isUuid also accepts upper case), or
 * null for anything else.
 * @param {unknown} value
 * @returns {string | null}
 */
export function canonicalUserId(value) {
    return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * The account lock key as SQL for parameter n: the same text the auth.users trigger hashes
 * (NEW.id::text is canonical), whatever case the id arrived in.
 * @param {number} n
 */
export const accountLockKey = (n) => `hashtextextended('rp:account:' || $${n}::uuid::text, 0)`;

/**
 * reopened_at → whole epoch seconds (the account generation), or null.
 * @param {unknown} reopenedAt
 * @returns {number | null}
 */
export const accountGeneration = (reopenedAt) => {
    if (!reopenedAt) return null;
    const ms = new Date(/** @type {any} */ (reopenedAt)).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/** @param {unknown} value @returns {number} epoch seconds, NaN when it is not a time */
const epochSeconds = (value) => (value ? new Date(/** @type {any} */ (value)).getTime() / 1000 : NaN);

/**
 * Whether a session that signed in at authTime belongs to the account deleted at deletedAt.
 * A missing or unreadable time counts as belonging to it (fail closed). Also used by the deletion
 * service (server/services/accountDeletion.js) for its "already deleted" answer.
 * @param {number | null | undefined} authTime
 * @param {unknown} deletedAt
 */
export const signedInBeforeDeletion = (authTime, deletedAt) => {
    const deleted = epochSeconds(deletedAt);
    if (typeof authTime !== 'number' || !Number.isFinite(authTime) || !Number.isFinite(deleted)) return true;
    return authTime <= deleted + ACCOUNT_SKEW_SECONDS;
};

/** @typedef {{ state: 'ok', generation: number | null } | { state: 'deleted' }} AccountState */
/** @typedef {{ query: (sql: string, params?: unknown[]) => Promise<any> }} Queryable */
/** @typedef {Queryable & { connect?: () => Promise<Queryable & { release: () => void }> }} AccountPool */

/** @type {AccountState} */
const NEVER_DELETED = Object.freeze({ state: 'ok', generation: null });
/** @type {AccountState} */
const DELETED = Object.freeze({ state: 'deleted' });

/**
 * The state of the account a verified token names. One primary-key lookup per call, no cache (the
 * staff script could not clear one in the api).
 * - no pool: ok (nothing stored, nothing to protect; like server/db.js syncAuthUserStub)
 * - no tombstone: ok, generation null
 * - tombstone and the session signed in no later than deleted_at + 30 s (or has no sign-in
 *   time): deleted, also after a re-open
 * - re-opened: ok with its generation
 * - not re-opened: mayReopen (the app API) re-opens it now; otherwise (agents, SSE MCP) deleted
 * A query error throws: the caller fails closed (503), never as "not deleted".
 * @param {AccountPool | null | undefined} pool
 * @param {unknown} userId the token's user id (any case)
 * @param {number | null} authTime tools/core/oauthToken.js sessionAuthTime
 * @param {{ mayReopen?: boolean }} [options]
 * @returns {Promise<AccountState>}
 */
export async function readAccountState(pool, userId, authTime, { mayReopen = false } = {}) {
    if (!pool) return NEVER_DELETED;
    const id = canonicalUserId(userId);
    // Supabase user ids are UUIDs; anything else cannot be checked, so it is not let through.
    if (!id) throw new TypeError('readAccountState: the account id is not a UUID');
    const result = await pool.query(
        'SELECT deleted_at, reopened_at FROM account_deletions WHERE user_id = $1::uuid',
        [id],
    );
    const row = result?.rows?.[0];
    if (!row) return NEVER_DELETED;
    if (signedInBeforeDeletion(authTime, row.deleted_at)) return DELETED;
    if (row.reopened_at) return { state: 'ok', generation: accountGeneration(row.reopened_at) };
    if (!mayReopen) return DELETED;
    const reopenedAt = await reopenAccount(pool, id, authTime);
    return reopenedAt ? { state: 'ok', generation: accountGeneration(reopenedAt) } : DELETED;
}

/**
 * Re-opens a deleted account for a session that signed in after the deletion, in one transaction:
 * the shared account lock first (the deletion holds it exclusively until COMMIT: same lock order,
 * no deadlock), then reopened_at = now(); only when that UPDATE returned the row, the auth.users
 * stub (the trigger lets it through now) and a new lesson-progress epoch whose reset_at equals
 * reopened_at (how the lesson-progress GET recognises a re-opened account). When a parallel first
 * request re-opened it already, its reopened_at is read back, so both get the same generation and
 * no second epoch is made.
 * The UPDATE also checks the session against deleted_at again (under the lock): if the account was
 * re-opened and deleted again since the caller's read, this older session stays refused.
 * @param {AccountPool} pool
 * @param {unknown} userId
 * @param {number | null} authTime
 * @returns {Promise<Date | null>} the reopened_at that admits this session, else null (deleted)
 */
export async function reopenAccount(pool, userId, authTime) {
    const id = canonicalUserId(userId);
    if (!id) throw new TypeError('reopenAccount: the account id is not a UUID');
    if (typeof authTime !== 'number' || !Number.isFinite(authTime)) return null;
    if (typeof pool?.connect !== 'function') throw new TypeError('reopenAccount needs a pool with connect()');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock_shared(${accountLockKey(1)})`, [id]);
        const updated = await client.query(
            `UPDATE account_deletions SET reopened_at = now()
              WHERE user_id = $1::uuid AND reopened_at IS NULL
                AND to_timestamp($2::double precision) > deleted_at + interval '${ACCOUNT_SKEW_SECONDS} seconds'
              RETURNING reopened_at`,
            [id, authTime],
        );
        /** @type {Date | null} */
        let reopenedAt = updated?.rows?.[0]?.reopened_at ?? null;
        if (reopenedAt) {
            await client.query('INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT (id) DO NOTHING', [id]);
            await client.query(
                `INSERT INTO lesson_progress_resets (user_id) VALUES ($1::uuid)
                 ON CONFLICT (user_id) DO UPDATE SET epoch = gen_random_uuid(), reset_at = now()`,
                [id],
            );
        } else {
            const again = await client.query(
                'SELECT deleted_at, reopened_at FROM account_deletions WHERE user_id = $1::uuid',
                [id],
            );
            const row = again?.rows?.[0];
            reopenedAt = row?.reopened_at && !signedInBeforeDeletion(authTime, row.deleted_at) ? row.reopened_at : null;
        }
        await client.query('COMMIT');
        return reopenedAt;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
