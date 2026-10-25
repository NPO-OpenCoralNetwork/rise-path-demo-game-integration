// @ts-check
/**
 * An in-memory database for the legal routes (server/routes/legal.js) on the server.js stack. It
 * answers the statements requireAuth sends for a session (the tombstone read and the auth.users
 * stub insert, with migration 018's trigger: no stub for a deleted id until it is re-opened) and
 * the legal statements (written out here independently, whitespace-collapsed, lower case), the way
 * Postgres would:
 *   - legal_document_versions: append only (ON CONFLICT DO NOTHING keeps the stored hash);
 *   - legal_acceptances: the live unique index (user, terms, privacy) WHERE account_deleted_at IS
 *     NULL, the insert only WHERE EXISTS the stub, accepted_at from `clock`;
 *   - transactions: BEGIN snapshots, ROLLBACK restores, COMMIT keeps.
 * Any other statement that names one of these tables throws, so a changed query fails loudly.
 * Every statement is recorded (normalised, with its parameters and `tx` when it ran on a client).
 * failOn(re, error) makes matching statements throw (BEGIN, COMMIT and ROLLBACK too); releasedWith
 * lists each client release's argument (pg destroys a client released with an error); onStatement(name,
 * fn) runs fn(state) just before the named statement is answered (to let a deletion commit while the
 * request runs).
 * Not a test file (npm test runs *.test.js).
 */

export const norm = (/** @type {string} */ sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

export const LEGAL_POOL_SQL = Object.freeze({
    tombstone: 'select deleted_at, reopened_at from account_deletions where user_id = $1::uuid',
    stubInsert: 'insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing',
    latest: 'select terms_version, privacy_version, accepted_at from legal_acceptances where user_id = $1::uuid and account_deleted_at is null order by accepted_at desc limit 1',
    lockTimeout: "set local lock_timeout = '10s'",
    lock: "select pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || $1::uuid::text, 0))",
    insertVersions: "insert into legal_document_versions (version, document, sha256) values ($1, 'terms', $3), ($2, 'privacy', $4) on conflict (version) do nothing",
    readVersions: 'select version, sha256 from legal_document_versions where version in ($1, $2)',
    insertAcceptance: norm(`insert into legal_acceptances (user_id, terms_version, privacy_version)
        select $1::uuid, $2, $3 where exists (select 1 from auth.users where id = $1::uuid)
        on conflict (user_id, terms_version, privacy_version) where account_deleted_at is null do nothing
        returning accepted_at`),
    existingAcceptance: 'select accepted_at from legal_acceptances where user_id = $1::uuid and terms_version = $2 and privacy_version = $3 and account_deleted_at is null',
    deletedAccount: 'select 1 from account_deletions where user_id = $1::uuid and reopened_at is null',
});
const NAME_OF = new Map(Object.entries(LEGAL_POOL_SQL).map(([name, text]) => [text, name]));
const KNOWN_TABLES = /account_deletions|auth\.users|legal_/;
const EMPTY = Object.freeze({ rowCount: 0, rows: Object.freeze([]) });

/**
 * @typedef {{
 *   stubs?: string[],
 *   tombstones?: Record<string, { deletedAt: Date | string, reopenedAt?: Date | string | null }>,
 *   versions?: Array<{ version: string, document: string, sha256: string }>,
 *   acceptances?: Array<{ user_id: string, terms_version: string, privacy_version: string, accepted_at?: Date, account_deleted_at?: Date | null }>,
 *   clock?: () => Date,
 * }} LegalSeed
 */

/** @param {LegalSeed} [seed] */
export function createLegalPool(seed = {}) {
    const clock = seed.clock ?? (() => new Date());
    let state = {
        stubs: new Set(seed.stubs ?? []),
        tombstones: new Map(Object.entries(seed.tombstones ?? {}).map(([id, t]) => [id, {
            deleted_at: new Date(t.deletedAt),
            reopened_at: t.reopenedAt ? new Date(t.reopenedAt) : null,
        }])),
        versions: new Map((seed.versions ?? []).map((v) => [v.version, { ...v }])),
        acceptances: (seed.acceptances ?? []).map((a) => ({ accepted_at: clock(), account_deleted_at: null, ...a })),
    };
    /** @type {typeof state | null} */
    let snapshot = null;
    /** @type {{ sql: string, params: unknown[], tx: boolean }[]} */
    const queries = [];
    /** @type {{ re: RegExp, error: any }[]} */
    const failures = [];
    /** @type {Map<string, (s: typeof state) => void>} */
    const hooks = new Map();
    let connects = 0;
    let releases = 0;
    /** What each release() was called with (pg destroys a client released with an error or true). */
    /** @type {unknown[]} */
    const releasedWith = [];

    const clone = (/** @type {typeof state} */ s) => ({
        stubs: new Set(s.stubs),
        tombstones: new Map([...s.tombstones].map(([k, v]) => [k, { ...v }])),
        versions: new Map([...s.versions].map(([k, v]) => [k, { ...v }])),
        acceptances: s.acceptances.map((a) => ({ ...a })),
    });
    /** The 018 trigger: a stub insert for a deleted, not re-opened id is skipped. @param {string} id */
    const deleted = (id) => {
        const t = state.tombstones.get(id);
        return Boolean(t && !t.reopened_at);
    };

    /** @param {boolean} tx */
    const runner = (tx) => async (/** @type {string} */ sql, /** @type {any[]} */ params = []) => {
        const text = norm(sql);
        queries.push({ sql: text, params, tx });
        const failure = failures.find((f) => f.re.test(text));
        if (failure) throw failure.error;
        if (text === 'begin') {
            snapshot = clone(state);
            return EMPTY;
        }
        if (text === 'commit') {
            snapshot = null;
            return EMPTY;
        }
        if (text === 'rollback') {
            if (snapshot) state = snapshot;
            snapshot = null;
            return EMPTY;
        }
        const name = NAME_OF.get(text);
        if (name && hooks.has(name)) hooks.get(name)?.(state);
        // $1::uuid casts: stored ids are lower case, as Postgres compares uuids.
        const lower = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.toLowerCase() : v);
        switch (name) {
            case 'tombstone': {
                const t = state.tombstones.get(String(lower(params[0])));
                return t ? { rowCount: 1, rows: [{ deleted_at: t.deleted_at, reopened_at: t.reopened_at }] } : EMPTY;
            }
            case 'stubInsert': {
                const id = String(lower(params[0]));
                if (state.stubs.has(id) || deleted(id)) return EMPTY;
                state.stubs.add(id);
                return { rowCount: 1, rows: [] };
            }
            case 'latest': {
                const id = String(lower(params[0]));
                const rows = state.acceptances
                    .filter((a) => a.user_id === id && !a.account_deleted_at)
                    .sort((a, b) => new Date(b.accepted_at).getTime() - new Date(a.accepted_at).getTime())
                    .slice(0, 1)
                    .map((a) => ({ terms_version: a.terms_version, privacy_version: a.privacy_version, accepted_at: a.accepted_at }));
                return { rowCount: rows.length, rows };
            }
            case 'lockTimeout':
                return EMPTY;
            case 'lock':
                if (!tx) throw new Error('the account lock must be taken inside the transaction');
                return { rowCount: 1, rows: [{ pg_advisory_xact_lock_shared: '' }] };
            case 'insertVersions': {
                const [terms, privacy, termsSha, privacySha] = params;
                let n = 0;
                for (const [version, document, sha256] of [[terms, 'terms', termsSha], [privacy, 'privacy', privacySha]]) {
                    if (!state.versions.has(String(version))) {
                        state.versions.set(String(version), { version: String(version), document: String(document), sha256: String(sha256) });
                        n += 1;
                    }
                }
                return { rowCount: n, rows: [] };
            }
            case 'readVersions': {
                const rows = params.map((v) => state.versions.get(String(v))).filter(Boolean).map((v) => ({ version: v?.version, sha256: v?.sha256 }));
                return { rowCount: rows.length, rows };
            }
            case 'insertAcceptance': {
                const [rawId, terms, privacy] = params;
                const id = String(lower(rawId));
                if (!tx) throw new Error('the acceptance must be written inside the transaction');
                if (!state.versions.has(String(terms)) || !state.versions.has(String(privacy))) {
                    throw Object.assign(new Error('insert or update on table "legal_acceptances" violates foreign key constraint'), { code: '23503' });
                }
                if (!state.stubs.has(id)) return EMPTY;
                if (state.acceptances.some((a) => a.user_id === id && a.terms_version === terms && a.privacy_version === privacy && !a.account_deleted_at)) return EMPTY;
                const row = { user_id: id, terms_version: String(terms), privacy_version: String(privacy), accepted_at: clock(), account_deleted_at: null };
                state.acceptances.push(row);
                return { rowCount: 1, rows: [{ accepted_at: row.accepted_at }] };
            }
            case 'existingAcceptance': {
                const [rawId, terms, privacy] = params;
                const id = String(lower(rawId));
                const rows = state.acceptances
                    .filter((a) => a.user_id === id && a.terms_version === terms && a.privacy_version === privacy && !a.account_deleted_at)
                    .map((a) => ({ accepted_at: a.accepted_at }));
                return { rowCount: rows.length, rows };
            }
            case 'deletedAccount':
                return deleted(String(lower(params[0]))) ? { rowCount: 1, rows: [{ '?column?': 1 }] } : EMPTY;
            default:
                if (KNOWN_TABLES.test(text)) throw new Error(`legalPool: unexpected statement: ${text}`);
                return EMPTY;
        }
    };

    const pool = {
        query: runner(false),
        connect: async () => {
            connects += 1;
            const query = runner(true);
            return {
                query,
                release: (/** @type {unknown} */ error) => {
                    releases += 1;
                    releasedWith.push(error);
                },
            };
        },
        get state() {
            return state;
        },
        queries,
        /** @param {RegExp} re @param {any} error */
        failOn(re, error) {
            failures.push({ re, error });
        },
        /** @param {keyof typeof LEGAL_POOL_SQL} name @param {(s: typeof state) => void} fn */
        onStatement(name, fn) {
            hooks.set(name, fn);
        },
        /** Statements after BEGIN on clients, by name ('begin', 'commit', 'rollback' or the LEGAL_POOL_SQL key). */
        txNames() {
            return queries.filter((q) => q.tx).map((q) => NAME_OF.get(q.sql) ?? q.sql);
        },
        get connects() {
            return connects;
        },
        get releases() {
            return releases;
        },
        releasedWith,
    };
    return pool;
}
