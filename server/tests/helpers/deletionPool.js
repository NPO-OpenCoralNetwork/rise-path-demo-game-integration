// @ts-check
/**
 * An in-memory database for the account deletion tests (server/services/accountDeletion.js, the
 * account routes on the server.js stack, scripts/delete-account-data.mjs). It answers the exact
 * statements the deletion sends (written out here independently, whitespace-collapsed, lower
 * case: SQL below) the way Postgres would, with the semantics they rely on:
 *   - account_deletions (no FK) and the auth.users trigger of migration 018 (no stub for a deleted
 *     id until it is re-opened), the re-open statements of tools/core/accountDeletions.js;
 *   - DELETE FROM auth.users cascades the learner's own rows (materials, consents, grants and
 *     every table in `owned`), sets billing rows' user_id NULL, and leaves the no-FK tables
 *     (legal_acceptances, the proof tables, ai_daily_usage, account_deletions);
 *   - transactions: BEGIN snapshots, ROLLBACK restores; clock_timestamp() comes from `clock`.
 * Any other statement that names one of these tables throws, so a changed query fails loudly.
 * Every statement is recorded (normalised, with its parameters, `tx` when it ran on a client) and
 * pushed to `events` as `sql:<name>` (the key in SQL), so tests can check the order against the
 * HTTP calls their fakes push to the same list. failOn(re, error) makes matching statements throw.
 * Not a test file (npm test runs *.test.js).
 */

export const norm = (/** @type {string} */ sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

export const SQL = Object.freeze({
    tombstone: 'select deleted_at, reopened_at from account_deletions where user_id = $1::uuid',
    // $2: the api runs in Stripe live mode; then only live-mode rows count (a test-mode row is never synced again).
    renewingLocal: "select 1 from billing_subscriptions where user_id = $1::uuid and (livemode or not $2::boolean) and status not in ('canceled', 'incomplete_expired') and not cancel_at_period_end and cancel_at is null limit 1",
    openSubscriptions: "select status, cancel_at_period_end, cancel_at from billing_subscriptions where user_id = $1::uuid and (livemode or not $2::boolean) and status not in ('canceled', 'incomplete_expired')",
    customers: 'select stripe_customer_id, livemode from billing_customers where user_id = $1::uuid',
    lockTimeout: "set local lock_timeout = '10s'",
    statementTimeout: "set local statement_timeout = '60s'",
    lock: "select pg_advisory_xact_lock(hashtextextended('rp:account:' || $1::uuid::text, 0))",
    tombstoneForUpdate: 'select deleted_at, reopened_at from account_deletions where user_id = $1::uuid for update',
    uploads: 'select storage_path from materials where user_id = $1::uuid and storage_path is not null',
    writeTombstone: norm(`insert into account_deletions (user_id, deleted_at, requested_by) values ($1::uuid, clock_timestamp(), $2)
        on conflict (user_id) do update set deleted_at = excluded.deleted_at, requested_by = excluded.requested_by, reopened_at = null
        returning deleted_at`),
    // The proofs read deleted_at from the tombstone row (exact to the microsecond), never a parameter.
    markAcceptances: 'update legal_acceptances set account_deleted_at = (select deleted_at from account_deletions where user_id = $1::uuid) where user_id = $1::uuid and account_deleted_at is null',
    copyConsents: norm(`insert into account_consent_proofs (consent_id, user_id, kind, policy_version, method, given_at, revoked_at, account_deleted_at)
        select id, user_id, kind, policy_version, method, given_at, revoked_at, (select deleted_at from account_deletions where user_id = $1::uuid) from account_consents where user_id = $1::uuid
        on conflict (consent_id) do nothing`),
    copyGrants: norm(`insert into ai_app_provision_records (user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at, account_deleted_at)
        select user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at, (select deleted_at from account_deletions where user_id = $1::uuid) from mcp_oauth_grants
        where user_id = $1::uuid and (first_seen_at is not null or last_used_at is not null)
        on conflict do nothing`),
    deleteOldUsage: "delete from ai_daily_usage where subject = $1::uuid::text and usage_day < (now() at time zone 'asia/tokyo')::date",
    deleteStub: 'delete from auth.users where id = $1::uuid',
    // Others that reach these tables: sign-in (server/db.js, accountDeletions.js), Memanto's meta row.
    stubInsert: 'insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing',
    memoryMeta: 'delete from learner_memory_meta where user_id = $1',
    reopenLock: "select pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || $1::uuid::text, 0))",
    reopen: "update account_deletions set reopened_at = now() where user_id = $1::uuid and reopened_at is null and to_timestamp($2::double precision) > deleted_at + interval '30 seconds' returning reopened_at",
    reopenEpoch: 'insert into lesson_progress_resets (user_id) values ($1::uuid) on conflict (user_id) do update set epoch = gen_random_uuid(), reset_at = now()',
});
const NAME_OF = new Map(Object.entries(SQL).map(([name, text]) => [text, name]));
const KNOWN_TABLES = /account_deletions|auth\.users|billing_|materials|legal_acceptances|account_consent|mcp_oauth_grants|ai_app_provision_records|ai_daily_usage|learner_memory_meta|lesson_progress_resets/;
const EMPTY = Object.freeze({ rowCount: 0, rows: Object.freeze([]) });
const TERMINAL = new Set(['canceled', 'incomplete_expired']);

/** Today's date in Japan (YYYY-MM-DD), as (now() AT TIME ZONE 'Asia/Tokyo')::date. @param {Date} at */
export const jstDay = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
/** @param {string} day @param {number} delta */
export const shiftDay = (day, delta) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);

/**
 * @typedef {{
 *   stubs?: string[],
 *   tombstones?: Record<string, { deletedAt: Date | string, reopenedAt?: Date | string | null, requestedBy?: string }>,
 *   subscriptions?: Array<{ user_id: string | null, status: string, cancel_at_period_end?: boolean, cancel_at?: Date | null, livemode?: boolean }>,
 *   customers?: Array<{ stripe_customer_id: string, user_id: string | null, livemode: boolean }>,
 *   materials?: Array<{ user_id: string, storage_path: string | null }>,
 *   acceptances?: Array<{ user_id: string, terms_version: string, privacy_version: string, account_deleted_at?: Date | null }>,
 *   consents?: Array<{ id: string, user_id: string, kind?: string, policy_version?: string, method?: string, given_at?: Date, revoked_at?: Date | null }>,
 *   grants?: Array<{ user_id: string, client_id: string, client_name?: string | null, first_seen_at?: Date | null, last_used_at?: Date | null, revoked_at?: Date | null }>,
 *   usage?: Array<{ usage_day: string, kind: string, subject: string, count: number }>,
 *   owned?: Record<string, string[]>,
 *   clock?: () => Date,
 *   events?: string[],
 * }} DeletionSeed
 *   owned: table → user ids with a row there (cascaded with the stub)
 */

/** @param {DeletionSeed} [seed] */
export function createDeletionPool(seed = {}) {
    const clock = seed.clock ?? (() => new Date());
    const events = seed.events ?? [];
    let state = {
        stubs: new Set(seed.stubs ?? []),
        tombstones: new Map(Object.entries(seed.tombstones ?? {}).map(([id, t]) => [id, {
            deleted_at: new Date(t.deletedAt),
            reopened_at: t.reopenedAt ? new Date(t.reopenedAt) : null,
            requested_by: t.requestedBy ?? 'self',
        }])),
        subscriptions: (seed.subscriptions ?? []).map((s) => ({ cancel_at_period_end: false, cancel_at: null, livemode: false, ...s })),
        customers: (seed.customers ?? []).map((c) => ({ ...c })),
        materials: (seed.materials ?? []).map((m) => ({ ...m })),
        acceptances: (seed.acceptances ?? []).map((a) => ({ account_deleted_at: null, ...a })),
        consents: (seed.consents ?? []).map((c) => ({ kind: 'guardian_ai', policy_version: 'guardian-ai-2026-10', method: 'guardian_on_device', given_at: new Date('2026-10-01T00:00:00Z'), revoked_at: null, ...c })),
        /** @type {Map<string, any>} */
        consentProofs: new Map(),
        grants: (seed.grants ?? []).map((g) => ({ client_name: null, first_seen_at: null, last_used_at: null, revoked_at: null, ...g })),
        /** @type {any[]} */
        provision: [],
        usage: (seed.usage ?? []).map((u) => ({ ...u })),
        owned: Object.fromEntries(Object.entries(seed.owned ?? {}).map(([table, ids]) => [table, [...ids]])),
        /** @type {Map<string, Date>} */
        resets: new Map(),
        memoryMeta: new Set(),
    };
    /** @type {typeof state | null} */
    let snapshot = null;
    /** @type {Date | null} */
    let txNow = null;
    /** @type {{ sql: string, params: unknown[], tx: boolean }[]} */
    const queries = [];
    /** @type {{ re: RegExp, error: any, once: boolean }[]} */
    const failures = [];
    let connects = 0;
    let releases = 0;
    let connectError = null;

    const clone = (/** @type {typeof state} */ s) => ({
        ...structuredClone({ ...s, stubs: [...s.stubs], memoryMeta: [...s.memoryMeta] }),
        stubs: new Set(s.stubs),
        memoryMeta: new Set(s.memoryMeta),
    });

    /** @param {boolean} tx */
    const runner = (tx) => async (/** @type {string} */ sql, /** @type {any[]} */ params = []) => {
        const text = norm(sql);
        queries.push({ sql: text, params, tx });
        const name = NAME_OF.get(text) ?? (text === 'begin' || text === 'commit' || text === 'rollback' ? text : `other:${text.slice(0, 40)}`);
        events.push(`sql:${name}`);
        if (text === 'begin') {
            snapshot = clone(state);
            txNow = clock();
            return EMPTY;
        }
        if (text === 'commit') {
            snapshot = null;
            txNow = null;
            return EMPTY;
        }
        if (text === 'rollback') {
            if (snapshot) state = snapshot;
            snapshot = null;
            txNow = null;
            return EMPTY;
        }
        const failure = failures.find((f) => f.re.test(text));
        if (failure) {
            if (failure.once) failures.splice(failures.indexOf(failure), 1);
            throw failure.error;
        }
        // $1::uuid casts: the stored ids are lower case, as Postgres compares uuids.
        const id = typeof params[0] === 'string' ? params[0].toLowerCase() : params[0];
        const now = () => txNow ?? clock();
        /** (SELECT deleted_at FROM account_deletions WHERE user_id = $1::uuid): NULL without a row. @param {string} key */
        const tombstoneTime = (key) => {
            const t = state.tombstones.get(key);
            return t ? new Date(t.deleted_at) : null;
        };
        switch (text) {
            case SQL.tombstone:
            case SQL.tombstoneForUpdate: {
                const t = state.tombstones.get(id);
                return t ? { rowCount: 1, rows: [{ deleted_at: t.deleted_at, reopened_at: t.reopened_at }] } : EMPTY;
            }
            case SQL.renewingLocal: {
                if (typeof params[1] !== 'boolean') throw new TypeError('renewingLocal: $2 (the api is live) must be a boolean');
                const hit = state.subscriptions.some((s) => s.user_id === id && (s.livemode || !params[1]) && !TERMINAL.has(s.status) && !s.cancel_at_period_end && s.cancel_at == null);
                return hit ? { rowCount: 1, rows: [{ '?column?': 1 }] } : EMPTY;
            }
            case SQL.openSubscriptions: {
                if (typeof params[1] !== 'boolean') throw new TypeError('openSubscriptions: $2 (the api is live) must be a boolean');
                const rows = state.subscriptions.filter((s) => s.user_id === id && (s.livemode || !params[1]) && !TERMINAL.has(s.status))
                    .map((s) => ({ status: s.status, cancel_at_period_end: Boolean(s.cancel_at_period_end), cancel_at: s.cancel_at ?? null }));
                return { rowCount: rows.length, rows };
            }
            case SQL.customers: {
                const rows = state.customers.filter((c) => c.user_id === id).map((c) => ({ stripe_customer_id: c.stripe_customer_id, livemode: c.livemode }));
                return { rowCount: rows.length, rows };
            }
            case SQL.lockTimeout:
            case SQL.statementTimeout:
                return EMPTY;
            case SQL.lock:
            case SQL.reopenLock:
                return { rowCount: 1, rows: [{}] };
            case SQL.uploads: {
                const rows = state.materials.filter((m) => m.user_id === id && m.storage_path !== null).map((m) => ({ storage_path: m.storage_path }));
                return { rowCount: rows.length, rows };
            }
            case SQL.writeTombstone: {
                const deletedAt = clock();
                state.tombstones.set(id, { deleted_at: deletedAt, reopened_at: null, requested_by: params[1] });
                return { rowCount: 1, rows: [{ deleted_at: deletedAt }] };
            }
            case SQL.markAcceptances: {
                const at = tombstoneTime(id);
                let n = 0;
                for (const a of state.acceptances) {
                    if (a.user_id === id && a.account_deleted_at === null) {
                        a.account_deleted_at = at;
                        n += 1;
                    }
                }
                return { rowCount: n, rows: [] };
            }
            case SQL.copyConsents: {
                const at = tombstoneTime(id);
                let n = 0;
                for (const c of state.consents.filter((x) => x.user_id === id)) {
                    if (state.consentProofs.has(c.id)) continue;
                    state.consentProofs.set(c.id, { consent_id: c.id, user_id: c.user_id, kind: c.kind, policy_version: c.policy_version, method: c.method, given_at: c.given_at, revoked_at: c.revoked_at, account_deleted_at: at });
                    n += 1;
                }
                return { rowCount: n, rows: [] };
            }
            case SQL.copyGrants: {
                const at = tombstoneTime(id);
                let n = 0;
                for (const g of state.grants.filter((x) => x.user_id === id && (x.first_seen_at !== null || x.last_used_at !== null))) {
                    state.provision.push({ ...g, account_deleted_at: at });
                    n += 1;
                }
                return { rowCount: n, rows: [] };
            }
            case SQL.deleteOldUsage: {
                const today = jstDay(now());
                const before = state.usage.length;
                state.usage = state.usage.filter((u) => !(u.subject === id && u.usage_day < today));
                return { rowCount: before - state.usage.length, rows: [] };
            }
            case SQL.deleteStub: {
                const had = state.stubs.delete(id);
                // ON DELETE CASCADE / SET NULL of every FK to auth.users (001–018).
                state.materials = state.materials.filter((m) => m.user_id !== id);
                state.consents = state.consents.filter((c) => c.user_id !== id);
                state.grants = state.grants.filter((g) => g.user_id !== id);
                state.resets.delete(id);
                state.memoryMeta.delete(id);
                for (const table of Object.keys(state.owned)) state.owned[table] = state.owned[table].filter((u) => u !== id);
                for (const c of state.customers) if (c.user_id === id) c.user_id = null;
                for (const s of state.subscriptions) if (s.user_id === id) s.user_id = null;
                return { rowCount: had ? 1 : 0, rows: [] };
            }
            case SQL.stubInsert: {
                const t = state.tombstones.get(id);
                // users_skip_deleted_account: no stub while the account is deleted and not re-opened.
                if ((t && !t.reopened_at) || state.stubs.has(id)) return EMPTY;
                state.stubs.add(id);
                return { rowCount: 1, rows: [] };
            }
            case SQL.memoryMeta: {
                const had = state.memoryMeta.delete(id);
                return { rowCount: had ? 1 : 0, rows: [] };
            }
            case SQL.reopen: {
                const t = state.tombstones.get(id);
                if (!t || t.reopened_at || !(Number(params[1]) > t.deleted_at.getTime() / 1000 + 30)) return EMPTY;
                t.reopened_at = now();
                return { rowCount: 1, rows: [{ reopened_at: t.reopened_at }] };
            }
            case SQL.reopenEpoch:
                state.resets.set(id, now());
                return { rowCount: 1, rows: [] };
            default:
                if (KNOWN_TABLES.test(text)) throw new Error(`deletionPool: unexpected statement: ${text}`);
                return EMPTY;
        }
    };

    return {
        events,
        queries,
        query: runner(false),
        connect: async () => {
            if (connectError) throw connectError;
            connects += 1;
            return { query: runner(true), release: () => { releases += 1; } };
        },
        get state() {
            return state;
        },
        get connects() {
            return connects;
        },
        get releases() {
            return releases;
        },
        inTransaction: () => snapshot !== null,
        /** Statement names in order (the SQL keys; 'begin', 'commit', 'rollback'). */
        names: () => events.filter((e) => e.startsWith('sql:')).map((e) => e.slice(4)),
        /** Matching statements throw `error` (an Error with a Postgres code). */
        failOn: (/** @type {RegExp} */ re, /** @type {any} */ error, { once = false } = {}) => failures.push({ re, error, once }),
        failConnect: (/** @type {any} */ error) => {
            connectError = error;
        },
        /** Marks Memanto's meta row for a user (learner_memory_meta). */
        addMemoryMeta: (/** @type {string} */ id) => state.memoryMeta.add(id),
    };
}
