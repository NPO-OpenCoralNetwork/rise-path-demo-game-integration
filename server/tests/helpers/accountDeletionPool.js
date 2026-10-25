// @ts-check
/**
 * A stateful stand-in for the tables the deleted-account check touches (migration 018:
 * account_deletions and the auth.users trigger; 016: lesson_progress_resets), answering the
 * statements of tools/core/accountDeletions.js the way Postgres would. Unknown statements answer
 * no rows, like the other helper pools. Every statement is recorded, normalised (lower case, single
 * spaces), with its parameters and whether it ran on a connected client (`tx: true`).
 */

const EMPTY = Object.freeze({ rowCount: 0, rows: Object.freeze([]) });
export const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
const SKEW_CLAUSE = "to_timestamp($2::double precision) > deleted_at + interval '30 seconds'";

/**
 * @param {{
 *   tombstones?: Record<string, { deletedAt: Date | string, reopenedAt?: Date | string | null }>,
 *   failRead?: boolean,
 *   onLock?: (state: any) => void,
 *   now?: () => Date,
 * }} [options]
 *   tombstones: account_deletions rows by (lower-case) id; failRead: the tombstone read throws;
 *   onLock: runs when the shared account lock is taken (a deletion that committed meanwhile)
 */
export function createAccountDeletionPool({ tombstones = {}, failRead = false, onLock, now = () => new Date() } = {}) {
    const state = {
        /** @type {Map<string, { deleted_at: Date, reopened_at: Date | null }>} */
        tombstones: new Map(Object.entries(tombstones).map(([id, t]) => [id, {
            deleted_at: new Date(t.deletedAt),
            reopened_at: t.reopenedAt ? new Date(t.reopenedAt) : null,
        }])),
        /** @type {Set<string>} */
        stubs: new Set(),
        /** @type {Map<string, { reset_at: Date }>} */
        resets: new Map(),
        /** @type {{ sql: string, params: unknown[], tx: boolean }[]} */
        queries: [],
        connects: 0,
        releases: 0,
    };

    /** @param {boolean} tx */
    const runner = (tx) => async (/** @type {string} */ sql, /** @type {any[]} */ params = []) => {
        const text = norm(sql);
        state.queries.push({ sql: text, params, tx });
        if (text.startsWith('select deleted_at, reopened_at from account_deletions where user_id = $1::uuid')) {
            if (failRead) throw new Error('relation "account_deletions" does not exist (db.internal)');
            const row = state.tombstones.get(String(params[0]));
            return row ? { rowCount: 1, rows: [{ ...row }] } : EMPTY;
        }
        if (text.startsWith('select pg_advisory_xact_lock_shared(')) {
            onLock?.(state);
            return { rowCount: 1, rows: [{}] };
        }
        if (text.startsWith('update account_deletions set reopened_at = now()')) {
            const row = state.tombstones.get(String(params[0]));
            if (!row || row.reopened_at) return EMPTY;
            if (text.includes(SKEW_CLAUSE) && !(Number(params[1]) > row.deleted_at.getTime() / 1000 + 30)) return EMPTY;
            row.reopened_at = now();
            return { rowCount: 1, rows: [{ reopened_at: row.reopened_at }] };
        }
        if (text.startsWith('insert into auth.users')) {
            const id = String(params[0]);
            const row = state.tombstones.get(id);
            // users_skip_deleted_account: no stub while the account is deleted and not re-opened.
            if ((row && !row.reopened_at) || state.stubs.has(id)) return EMPTY;
            state.stubs.add(id);
            return { rowCount: 1, rows: [] };
        }
        if (text.startsWith('insert into lesson_progress_resets')) {
            const id = String(params[0]);
            state.resets.set(id, { reset_at: state.tombstones.get(id)?.reopened_at ?? now() });
            return { rowCount: 1, rows: [] };
        }
        return EMPTY;
    };

    return {
        state,
        query: runner(false),
        connect: async () => {
            state.connects += 1;
            return { query: runner(true), release: () => { state.releases += 1; } };
        },
    };
}
