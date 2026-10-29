// @ts-check
/**
 * An in-memory stand-in for the tables GET
 * /api/v2/training/me touches. It answers the statements requireAuth sends for a session (the
 * tombstone read and the auth.users stub insert, with migration 018's trigger: no stub for a deleted
 * id until it is re-opened) and the training statements (written out here independently,
 * whitespace-collapsed, lower case), the way Postgres would. Any other statement that names one of
 * these tables throws, so a changed query fails loudly. Not a test file (npm test runs *.test.js).
 */

export const norm = (/** @type {string} */ sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

export const TRAINING_POOL_SQL = Object.freeze({
    tombstone: 'select deleted_at, reopened_at from account_deletions where user_id = $1::uuid',
    stubInsert: 'insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing',
    me: 'select c.id as cohort_id, c.name, m.role from training_memberships m join training_cohorts c on c.id = m.cohort_id where m.user_id = $1::uuid and m.account_deleted_at is null order by c.starts_on, c.id',
});
const KNOWN_TABLES = /account_deletions|auth\.users|training_/;
const EMPTY = Object.freeze({ rowCount: 0, rows: Object.freeze([]) });

/**
 * @param {{
 *   tombstones?: Record<string, { deletedAt: Date | string, reopenedAt?: Date | string | null }>,
 *   cohorts?: Array<{ id: string, name: string, starts_on: string }>,
 *   memberships?: Array<{ cohort_id: string, user_id: string, role: string, account_deleted_at?: Date | null }>,
 * }} [seed]
 */
export function createTrainingPool(seed = {}) {
    const state = {
        tombstones: new Map(Object.entries(seed.tombstones ?? {}).map(([id, t]) => [id, { deleted_at: new Date(t.deletedAt), reopened_at: t.reopenedAt ? new Date(t.reopenedAt) : null }])),
        stubs: new Set(),
        cohorts: (seed.cohorts ?? []).map((c) => ({ ...c })),
        memberships: (seed.memberships ?? []).map((m) => ({ account_deleted_at: null, ...m })),
        /** @type {{ sql: string, params: unknown[] }[]} */
        queries: [],
    };
    /** @type {{ re: RegExp, error: any } | null} */
    let failure = null;
    /** @type {any} */
    let connectError = null;
    const query = async (/** @type {string} */ sql, /** @type {any[]} */ params = []) => {
        const text = norm(sql);
        state.queries.push({ sql: text, params });
        if (failure && failure.re.test(text)) throw failure.error;
        const id = typeof params[0] === 'string' ? params[0].toLowerCase() : params[0];
        switch (text) {
            case TRAINING_POOL_SQL.tombstone: {
                const t = state.tombstones.get(id);
                return t ? { rowCount: 1, rows: [{ ...t }] } : EMPTY;
            }
            case TRAINING_POOL_SQL.stubInsert: {
                const t = state.tombstones.get(id);
                if ((t && !t.reopened_at) || state.stubs.has(id)) return EMPTY;
                state.stubs.add(id);
                return { rowCount: 1, rows: [] };
            }
            case TRAINING_POOL_SQL.me: {
                const rows = state.memberships
                    .filter((m) => m.user_id === id && m.account_deleted_at === null)
                    .map((m) => ({ m, c: state.cohorts.find((c) => c.id === m.cohort_id) }))
                    .filter(({ c }) => c)
                    .sort((a, b) => (a.c.starts_on + a.c.id).localeCompare(b.c.starts_on + b.c.id))
                    .map(({ m, c }) => ({ cohort_id: c.id, name: c.name, role: m.role }));
                return { rowCount: rows.length, rows };
            }
            default:
                if (KNOWN_TABLES.test(text)) throw new Error(`trainingPool: unexpected statement: ${text}`);
                return EMPTY;
        }
    };
    return {
        state,
        query,
        connect: async () => {
            if (connectError) throw connectError;
            return { query, release: () => {} };
        },
        /** Training statements in order (not the sign-in's). */
        trainingStatements: () => state.queries.map((q) => q.sql).filter((s) => /training_/.test(s)),
        /** Matching statements throw `error` (an Error with a Postgres code); null clears it. */
        fail: (/** @type {RegExp} */ re, /** @type {any} */ error) => { failure = error ? { re, error } : null; },
        failConnect: (/** @type {any} */ error) => { connectError = error; },
    };
}
