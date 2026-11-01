// @ts-check
/**
 * An in-memory stand-in for the study time tables (server/migrations/022_training_study_time.sql)
 * and what tools/core/trainingTime.js reads of 018 and 021 (auth.users stubs, tombstones, cohorts,
 * memberships). It answers the module's own statements (TRAINING_TIME_SQL, and TRAINING_SQL's
 * locks, cohort and membership reads and tombstone read) and the two requireAuth sends for a session
 * (AUTH_SQL: the tombstone read, and the stub insert with migration 018's rule: no stub for a deleted
 * id until it is re-opened), the way PostgreSQL would, with a clock the test sets (now() and
 * clock_timestamp() alike), the CHECKs the core relies on, and transactions (BEGIN snapshots,
 * ROLLBACK restores; the state's savepoint too; each answered with node-pg's command tag). Any other
 * statement throws, so a changed query fails loudly; the SQL itself runs on PostgreSQL 16 in
 * scripts/db/verify-training.mjs. Not a test file (npm test runs *.test.js).
 */
import { TRAINING_SQL } from '../../../tools/core/training.js';
import { TRAINING_TIME_SQL } from '../../../tools/core/trainingTime.js';
import { jstDayOf, jstDayRange, nextDay } from '../../../shared/training/studyTime.js';

const DAY_MAX_MS = 86_400_000;
/** @param {string} day */
const previousDay = (day) => jstDayOf(jstDayRange(day).start - 1);
/** @param {unknown[]} rows */
const result = (rows) => ({ rowCount: rows.length, rows });
/** A transaction statement's result with its command tag, as node-pg gives it (ROLLBACK TO SAVEPOINT is 'ROLLBACK'). @param {string} command */
const ended = (command) => ({ command, rowCount: 0, rows: [] });
/** A PostgreSQL error with its SQLSTATE. @param {string} code @param {string} message */
const pgError = (code, message) => Object.assign(new Error(message), { code });

/** What requireAuth sends for a session, exactly (tools/core/accountDeletions.js readAccountState, server/db.js ensureAuthUser). */
export const AUTH_SQL = Object.freeze({
    tombstone: 'SELECT deleted_at, reopened_at FROM account_deletions WHERE user_id = $1::uuid',
    stubInsert: 'INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT (id) DO NOTHING',
});

/**
 * @typedef {{ id: string, slug: string, name: string, starts_on: string | null, ends_on: string | null }} Cohort
 * @typedef {{ user_id: string, cohort_id: string, role: string, added_at: number, account_deleted_at: number | null }} Membership
 */

/**
 * @param {{ clock?: number, stubs?: string[], cohorts?: Cohort[], memberships?: Array<Partial<Membership> & { user_id: string, cohort_id: string }>,
 *   tombstones?: Record<string, { deletedAt: number, reopenedAt?: number | null }> }} [seed]
 *   tombstones: account_deletions rows by account id (times in epoch ms)
 */
export function createTrainingTimePool(seed = {}) {
    let state = {
        clock: seed.clock ?? Date.UTC(2026, 10, 10, 3, 0, 0),
        stubs: [...(seed.stubs ?? [])],
        /** @type {Map<string, { deleted_at: number, reopened_at: number | null }>} */
        tombstones: new Map(Object.entries(seed.tombstones ?? {}).map(([user, t]) => [user, { deleted_at: t.deletedAt, reopened_at: t.reopenedAt ?? null }])),
        cohorts: (seed.cohorts ?? []).map((c) => ({ ...c })),
        /** @type {Membership[]} */
        memberships: (seed.memberships ?? []).map((m) => ({ role: 'learner', added_at: Date.UTC(2026, 9, 1), account_deleted_at: null, ...m })),
        /** @type {any[]} */ catalogs: [],
        /** @type {any[]} */ rules: [],
        /** @type {any[]} */ settings: [],
        /** @type {any[]} */ streams: [],
        /** @type {any[]} */ signals: [],
        /** @type {any[]} */ days: [],
        /** @type {any[]} */ unitDays: [],
        next: 1,
    };
    /** @type {typeof state | null} */
    let snapshot = null;
    /** The state at TRAINING_TIME_SQL.savepointState (ROLLBACK TO keeps the savepoint). @type {typeof state | null} */
    let savepoint = null;
    /** @type {{ sql: string, params: unknown[], tx: boolean }[]} */
    const queries = [];
    /** @type {{ sql: string, error: any }[]} */
    const failures = [];
    /** @type {unknown[]} */
    const releases = [];
    /** @type {{ sql: string, run: () => void }[]} */
    const hooks = [];

    const id = () => String(state.next++);
    /** The current value of each day: its newest live row. @param {string} user @param {string} cohort */
    const currentRows = (user, cohort) => {
        /** @type {Map<string, any>} */
        const byDay = new Map();
        for (const d of state.days) {
            if (d.user_id !== user || d.cohort_id !== cohort || d.account_deleted_at !== null) continue;
            const seen = byDay.get(d.day);
            if (!seen || Number(d.id) > Number(seen.id)) byDay.set(d.day, d);
        }
        return [...byDay.values()].sort((x, y) => x.day.localeCompare(y.day));
    };

    /** @param {boolean} tx */
    const runner = (tx) => async (/** @type {string} */ sql, /** @type {any[]} */ params = []) => {
        queries.push({ sql, params, tx });
        for (const hook of hooks.filter((h) => h.sql === sql)) hook.run();
        const failure = failures.find((f) => f.sql === sql);
        if (failure) throw failure.error;
        const [p1, p2] = params;
        switch (sql) {
            case 'BEGIN':
                snapshot = structuredClone(state);
                savepoint = null;
                return ended('BEGIN');
            case 'COMMIT':
                snapshot = null;
                savepoint = null;
                return ended('COMMIT');
            case 'ROLLBACK':
                if (snapshot) state = snapshot;
                snapshot = null;
                savepoint = null;
                return ended('ROLLBACK');
            case TRAINING_TIME_SQL.savepointState:
                if (!snapshot) throw pgError('25P01', 'SAVEPOINT can only be used in transaction blocks');
                savepoint = structuredClone(state);
                return ended('SAVEPOINT');
            case TRAINING_TIME_SQL.rollbackState:
                if (!savepoint) throw pgError('3B001', 'savepoint "live_state" does not exist');
                state = structuredClone(savepoint);
                return ended('ROLLBACK');
            case AUTH_SQL.tombstone: {
                const t = state.tombstones.get(String(p1).toLowerCase());
                return result(t ? [{ deleted_at: new Date(t.deleted_at), reopened_at: t.reopened_at === null ? null : new Date(t.reopened_at) }] : []);
            }
            case AUTH_SQL.stubInsert: {
                // $1::uuid: stored lower case. Migration 018's trigger: no stub for a deleted id until it is re-opened.
                const user = String(p1).toLowerCase();
                const t = state.tombstones.get(user);
                if ((t && t.reopened_at === null) || state.stubs.includes(user)) return result([]);
                state.stubs.push(user);
                return { rowCount: 1, rows: [] };
            }
            case TRAINING_SQL.deletedAccount: {
                const t = state.tombstones.get(String(p1));
                return result(t && t.reopened_at === null ? [{ '?column?': 1 }] : []);
            }
            case TRAINING_SQL.liveMember:
                return result(state.memberships.filter((m) => m.user_id === p1 && m.cohort_id === p2 && m.account_deleted_at === null).map((m) => ({ role: m.role })));
            case TRAINING_TIME_SQL.signalState:
                return result([signalStateOf(String(p1), String(p2), String(params[2]), String(params[3]))]);
            case TRAINING_TIME_SQL.insertStream: {
                const [user, cohort, unit, chain, bornIso, atIso] = params;
                if (!state.stubs.includes(String(user))) return result([]);
                const startedAt = Date.parse(String(atIso));
                const born = Date.parse(String(bornIso));
                const day = jstDayOf(startedAt);
                // ON CONFLICT (user_id, chain_id, day) WHERE account_deleted_at IS NULL DO NOTHING
                if (state.streams.some((s) => s.user_id === user && s.chain_id === chain && s.day === day && s.account_deleted_at === null)) return result([]);
                if (!(born <= startedAt) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(String(unit))) throw pgError('23514', 'new row for relation "training_time_streams" violates check constraint');
                if (!state.cohorts.some((c) => c.id === cohort)) throw pgError('23503', 'training_time_streams_cohort_id_fkey');
                state.streams.push({ id: id(), user_id: user, cohort_id: cohort, unit_key: unit, chain_id: chain, chain_started_at: born, day, started_at: startedAt, account_deleted_at: null });
                return { rowCount: 1, rows: [] };
            }
            case TRAINING_TIME_SQL.insertSignal: {
                const [user, chain, atIso, seq, flags] = params;
                if (!state.stubs.includes(String(user))) return result([]);
                const at = Date.parse(String(atIso));
                const stream = state.streams.find((s) => s.user_id === user && s.chain_id === chain && s.day === jstDayOf(at) && s.account_deleted_at === null);
                // ON CONFLICT (stream_id, seq) DO NOTHING
                if (!stream || state.signals.some((g) => g.stream_id === stream.id && g.seq === seq)) return result([]);
                if (!(Number.isInteger(seq) && seq >= 0) || !(Number.isInteger(flags) && flags >= 0 && flags <= 7)) throw pgError('23514', 'new row for relation "training_time_signals" violates check constraint');
                state.signals.push({ stream_id: stream.id, received_at: at, seq, flags });
                return result([{ seq }]);
            }
            case TRAINING_SQL.lockTimeout:
            case TRAINING_SQL.lock:
            case TRAINING_SQL.learnerLock:
            case TRAINING_TIME_SQL.settingsLock:
            case TRAINING_TIME_SQL.settingsLockShared:
                return result([]);
            case TRAINING_TIME_SQL.jstToday:
                return result([{ today: jstDayOf(state.clock) }]);
            case TRAINING_SQL.cohortBySlug:
                return result(state.cohorts.filter((c) => c.slug === p1).map((c) => ({ ...c })));
            case TRAINING_TIME_SQL.insertCatalog: {
                if (state.catalogs.some((c) => c.sha256 === p2)) return result([]);
                const row = { id: id(), course_key: p1, sha256: p2, manifest: JSON.parse(String(params[2])), loaded_by: params[3], note: params[4] };
                state.catalogs.push(row);
                return result([{ id: row.id }]);
            }
            case TRAINING_TIME_SQL.catalogBySha:
                return result(state.catalogs.filter((c) => c.sha256 === p1).map((c) => ({ id: c.id, course_key: c.course_key })));
            case TRAINING_TIME_SQL.insertRules: {
                if (state.rules.some((r) => r.sha256 === p2)) return result([]);
                const row = { id: id(), algorithm: p1, sha256: p2, params: JSON.parse(String(params[2])), loaded_by: params[3], note: params[4] };
                state.rules.push(row);
                return result([{ id: row.id }]);
            }
            case TRAINING_TIME_SQL.rulesBySha:
                return result(state.rules.filter((r) => r.sha256 === p1).map((r) => ({ id: r.id })));
            case TRAINING_TIME_SQL.cohortForSetting:
                return result(state.cohorts.filter((c) => c.slug === p1).map((c) => ({ id: c.id, starts_on: c.starts_on, ends_on: c.ends_on })));
            case TRAINING_TIME_SQL.settingCourses:
                return result(settingsOf(p1).map((s) => ({ effective_from: s.effective_from, course_key: catalogOf(s).course_key })));
            case TRAINING_TIME_SQL.cohortHasEvidence:
                return result([{ evidence: state.streams.some((s) => s.cohort_id === p1) }]);
            case TRAINING_TIME_SQL.insertSetting: {
                // One clock reading: the day, set_at and the rule (not before today; from tomorrow once a setting is in effect).
                const [cohortId, catalogId, ruleSetId, effectiveFrom, setBy, reason] = params;
                const today = jstDayOf(state.clock);
                const inEffect = state.settings.some((x) => x.cohort_id === cohortId && x.effective_from <= today);
                const from = String(effectiveFrom);
                if (!(from > today || (from === today && !inEffect))) return result([{ today, id: null, effective_from: null }]);
                const row = { id: id(), cohort_id: cohortId, catalog_version_id: catalogId, rule_set_id: ruleSetId, effective_from: from, set_at: new Date(state.clock), set_by: setBy, reason };
                state.settings.push(row);
                return result([{ today, id: row.id, effective_from: row.effective_from }]);
            }
            case TRAINING_TIME_SQL.settingsList:
                return result(settingsOf(p1).map((s) => {
                    const k = catalogOf(s);
                    const r = state.rules.find((x) => x.id === s.rule_set_id);
                    return { id: s.id, effective_from: s.effective_from, set_at: s.set_at, set_by: s.set_by, reason: s.reason, catalog_sha256: k.sha256, course_key: k.course_key, units: k.manifest.units.length, rules_sha256: r.sha256, algorithm: r.algorithm };
                }));
            case TRAINING_TIME_SQL.closeState: {
                const cohort = state.cohorts.find((c) => c.id === p2);
                if (!cohort) return result([]);
                const member = state.memberships.find((m) => m.user_id === p1 && m.cohort_id === p2 && m.role === 'learner' && m.account_deleted_at === null);
                const closed = state.days.filter((d) => d.user_id === p1 && d.cohort_id === p2 && d.kind === 'close' && d.account_deleted_at === null).map((d) => d.day).sort();
                return result([{
                    now_ms: String(state.clock),
                    stub: state.stubs.includes(String(p1)),
                    starts_on: cohort.starts_on,
                    ends_on: cohort.ends_on,
                    added_on: member ? jstDayOf(member.added_at) : null,
                    last_closed: closed.at(-1) ?? null,
                }]);
            }
            case TRAINING_TIME_SQL.closeSettings:
                return result(settingsOf(p1).map((s) => ({
                    id: s.id, effective_from: s.effective_from, rule_set_id: s.rule_set_id, catalog_version_id: s.catalog_version_id,
                    params: structuredClone(state.rules.find((r) => r.id === s.rule_set_id).params), manifest: structuredClone(catalogOf(s).manifest),
                })));
            case TRAINING_TIME_SQL.unitTotals: {
                /** @type {Map<string, { counted: number, over: number }>} */
                const sums = new Map();
                for (const d of currentRows(String(p1), String(p2))) {
                    for (const u of state.unitDays.filter((x) => x.day_id === d.id)) {
                        const s = sums.get(u.unit_key) ?? { counted: 0, over: 0 };
                        sums.set(u.unit_key, { counted: s.counted + u.counted_ms, over: s.over + u.over_cap_ms });
                    }
                }
                return result([...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unit, s]) => ({ unit_key: unit, counted_ms: String(s.counted), over_cap_ms: String(s.over) })));
            }
            case TRAINING_TIME_SQL.evidence: {
                const [user, cohort, fromDay, toDay, fromIso, toIso] = params;
                const lo = previousDay(String(fromDay));
                const hi = nextDay(String(toDay));
                const from = Date.parse(String(fromIso));
                const to = Date.parse(String(toIso));
                const rows = [];
                for (const s of state.streams) {
                    if (s.user_id !== user || s.cohort_id !== cohort || s.account_deleted_at !== null || s.day < lo || s.day > hi) continue;
                    for (const g of state.signals) {
                        if (g.stream_id !== s.id || g.received_at < from || g.received_at > to) continue;
                        rows.push({ chain_id: s.chain_id, unit_key: s.unit_key, born: String(s.chain_started_at), seq: g.seq, at: String(g.received_at), flags: g.flags });
                    }
                }
                rows.sort((x, y) => (x.chain_id < y.chain_id ? -1 : x.chain_id > y.chain_id ? 1 : x.seq - y.seq));
                return result(rows);
            }
            case TRAINING_TIME_SQL.insertDays: {
                const [user, cohort, by, days, algorithms, ruleSetIds, catalogIds, counted, over, signals, digests] = params;
                if (!state.stubs.includes(String(user))) return result([]);
                const rows = [];
                for (const [i, day] of /** @type {string[]} */ (days).entries()) {
                    if (state.days.some((d) => d.user_id === user && d.cohort_id === cohort && d.day === day && d.kind === 'close' && d.account_deleted_at === null)) continue;
                    const c = /** @type {number[]} */ (counted)[i];
                    const o = /** @type {number[]} */ (over)[i];
                    if (!(c >= 0 && o >= 0 && c + o <= DAY_MAX_MS) || !/^[0-9a-f]{64}$/.test(/** @type {string[]} */ (digests)[i])) throw pgError('23514', 'new row for relation "training_time_days" violates check constraint');
                    const row = {
                        id: id(), user_id: user, cohort_id: cohort, day, kind: 'close', algorithm: /** @type {string[]} */ (algorithms)[i],
                        rule_set_id: /** @type {string[]} */ (ruleSetIds)[i], catalog_version_id: /** @type {string[]} */ (catalogIds)[i],
                        counted_ms: c, over_cap_ms: o, signals: /** @type {number[]} */ (signals)[i], evidence_sha256: /** @type {string[]} */ (digests)[i],
                        computed_at: state.clock, computed_by: by, account_deleted_at: null,
                    };
                    state.days.push(row);
                    rows.push({ id: row.id, day: row.day });
                }
                return result(rows);
            }
            case TRAINING_TIME_SQL.insertUnitDays: {
                const [ids, units, counted, over] = /** @type {any[][]} */ (params);
                for (const [i, dayId] of ids.entries()) {
                    if (!(counted[i] > 0 || over[i] > 0) || !state.days.some((d) => d.id === dayId)) throw pgError('23514', 'training_time_unit_days');
                    if (state.unitDays.some((u) => u.day_id === dayId && u.unit_key === units[i])) throw pgError('23505', 'training_time_unit_days_pkey');
                    state.unitDays.push({ day_id: dayId, unit_key: units[i], counted_ms: counted[i], over_cap_ms: over[i] });
                }
                return result([]);
            }
            case TRAINING_TIME_SQL.learners:
                return result(state.memberships
                    .filter((m) => m.cohort_id === p1 && m.role === 'learner' && m.account_deleted_at === null)
                    .sort((x, y) => x.added_at - y.added_at)
                    .map((m) => ({ user_id: m.user_id })));
            case TRAINING_TIME_SQL.currentDays:
                return result(currentRows(String(p1), String(p2)).map((d) => ({ day: d.day, kind: d.kind, counted_ms: d.counted_ms, over_cap_ms: d.over_cap_ms, signals: d.signals })));
            case TRAINING_TIME_SQL.cohortStats: {
                const streams = state.streams.filter((s) => s.cohort_id === p1);
                const days = state.days.filter((d) => d.cohort_id === p1);
                const closed = days.filter((d) => d.kind === 'close' && d.account_deleted_at === null).map((d) => d.day).sort();
                return result([{
                    learners: String(state.memberships.filter((m) => m.cohort_id === p1 && m.role === 'learner' && m.account_deleted_at === null).length),
                    streams: String(streams.length),
                    streams_marked: String(streams.filter((s) => s.account_deleted_at !== null).length),
                    signals: String(state.signals.filter((g) => streams.some((s) => s.id === g.stream_id)).length),
                    days: String(days.length),
                    days_marked: String(days.filter((d) => d.account_deleted_at !== null).length),
                    last_closed: closed.at(-1) ?? null,
                }]);
            }
            default:
                throw new Error(`trainingTimePool: unexpected statement: ${sql.slice(0, 120)}`);
        }
    };

    /** The settings of a cohort in the order effective_from, id. @param {unknown} cohort */
    function settingsOf(cohort) {
        return state.settings.filter((s) => s.cohort_id === cohort).sort((x, y) => x.effective_from.localeCompare(y.effective_from) || Number(x.id) - Number(y.id));
    }
    /** A live stream's last signal (the largest seq). @param {any} stream */
    function lastSignalOf(stream) {
        return state.signals.filter((g) => g.stream_id === stream.id).sort((x, y) => y.seq - x.seq)[0];
    }
    /**
     * TRAINING_TIME_SQL.signalState: one row, with or without a cohort, from one clock reading
     * (whole milliseconds). bigint columns as strings, as node-pg returns them.
     * @param {string} user @param {string} cohortId @param {string} chainId @param {string} unit
     */
    function signalStateOf(user, cohortId, chainId, unit) {
        const now = Math.floor(state.clock);
        const today = jstDayOf(now);
        const cohort = state.cohorts.find((c) => c.id === cohortId);
        const member = cohort && state.memberships.find((m) => m.user_id === user && m.cohort_id === cohortId && m.account_deleted_at === null);
        const settings = cohort ? settingsOf(cohortId) : [];
        const current = settings.filter((s) => s.effective_from <= today).at(-1);
        const yesterdays = settings.filter((s) => s.effective_from <= previousDay(today)).at(-1);
        const live = state.streams.filter((s) => s.user_id === user && s.account_deleted_at === null);
        /** The last signal of a chain over its live streams. @param {any[]} streams */
        const lastOf = (streams) => {
            /** @type {{ s: any, g: any } | null} */
            let found = null;
            for (const s of streams) {
                const g = lastSignalOf(s);
                if (g && (!found || g.seq > found.g.seq)) found = { s, g };
            }
            return found;
        };
        const ch = lastOf(live.filter((s) => s.chain_id === chainId));
        const recent = live.filter((s) => cohort && s.cohort_id === cohortId && s.day >= previousDay(today));
        const places = [...new Set(recent.map((s) => s.chain_id))].sort()
            .map((chain) => lastOf(recent.filter((s) => s.chain_id === chain)))
            .filter((p) => p !== null)
            .map((p) => ({ chain_id: p.s.chain_id, born: p.s.chain_started_at, at: p.g.received_at, flags: p.g.flags }));
        const closed = cohort && state.days
            .filter((d) => d.user_id === user && d.cohort_id === cohortId && d.kind === 'close' && d.account_deleted_at === null)
            .sort((x, y) => y.day.localeCompare(x.day))[0];
        const closedGap = closed ? state.rules.find((r) => r.id === closed.rule_set_id).params.counting.gapMs : null;
        return {
            now_ms: String(now),
            stub: state.stubs.includes(user),
            cohort_id: cohort?.id ?? null,
            role: member?.role ?? null,
            added_on: member ? jstDayOf(member.added_at) : null,
            starts_on: cohort?.starts_on ?? null,
            ends_on: cohort?.ends_on ?? null,
            first_setting: settings[0]?.effective_from ?? null,
            yesterday_gap_ms: yesterdays ? String(state.rules.find((r) => r.id === yesterdays.rule_set_id).params.counting.gapMs) : null,
            params: current ? structuredClone(state.rules.find((r) => r.id === current.rule_set_id).params) : null,
            unit_known: current ? catalogOf(current).manifest.units.some((/** @type {any} */ u) => u.key === unit) : null,
            chain_cohort_id: ch?.s.cohort_id ?? null,
            chain_unit_key: ch?.s.unit_key ?? null,
            chain_born: ch ? String(ch.s.chain_started_at) : null,
            chain_seq: ch?.g.seq ?? null,
            chain_at: ch ? String(ch.g.received_at) : null,
            chain_flags: ch?.g.flags ?? null,
            places,
            last_closed: closed?.day ?? null,
            closed_until_ms: closed ? String(jstDayRange(closed.day).end + closedGap) : null,
        };
    }
    /** @param {any} setting */
    function catalogOf(setting) {
        return state.catalogs.find((c) => c.id === setting.catalog_version_id);
    }

    return {
        get state() { return state; },
        queries,
        releases,
        query: runner(false),
        connect: async () => ({ query: runner(true), release: (/** @type {unknown} */ broken) => releases.push(broken) }),
        /** The statements sent on transaction clients, in order. */
        tx: () => queries.filter((q) => q.tx).map((q) => q.sql),
        /** @param {number} ms */
        setClock: (ms) => { state.clock = ms; },
        /** Make a statement throw (an Error with a SQLSTATE). @param {string} sql @param {any} error */
        failOn: (sql, error) => failures.push({ sql, error }),
        /** Run `run` (move the clock, add a row) just before each matching statement. @param {string} sql @param {() => void} run */
        before: (sql, run) => hooks.push({ sql, run }),
        /**
         * An account deletion as the service commits it (server/services/accountDeletion.js): the
         * tombstone, the marks on the account's memberships, streams and days, and no stub. Another
         * session's commit: an open transaction's ROLLBACK keeps it (it is applied to the snapshot
         * and the savepoint that a rollback restores too), so it can run in a `before` hook, during a
         * lock wait.
         * @param {string} user @param {number} at
         */
        deleteAccount: (user, at) => {
            const copies = [state];
            if (snapshot) copies.push(snapshot);
            if (savepoint) copies.push(savepoint);
            for (const db of copies) {
                db.tombstones.set(user, { deleted_at: at, reopened_at: null });
                for (const rows of [db.memberships, db.streams, db.days]) {
                    for (const row of /** @type {any[]} */ (rows)) if (row.user_id === user && row.account_deleted_at === null) row.account_deleted_at = at;
                }
                db.stubs = db.stubs.filter((s) => s !== user);
            }
        },
        /**
         * A setting as a row (bypassing the script's checks; set_at is given, so a past day is possible).
         * @param {{ cohortId: string, catalogId: string, ruleSetId: string, effectiveFrom: string }} s
         */
        addSetting: (s) => {
            state.settings.push({ id: id(), cohort_id: s.cohortId, catalog_version_id: s.catalogId, rule_set_id: s.ruleSetId, effective_from: s.effectiveFrom, set_at: new Date(Date.UTC(2026, 0, 1)), set_by: 'test', reason: 'test' });
        },
        /**
         * A stored signal at any instant (no lock, no admission: evidence for the tests), in the rows
         * recordSignal writes (TRAINING_TIME_SQL.insertStream and insertSignal; a test compares them):
         * the stream row of the signal's Japan-time day (created by its first signal that day), then
         * the narrow row.
         * @param {{ userId: string, cohortId: string, unit: string, chain: string, born: number, seq: number, at: number, stop?: boolean, focus?: boolean, input?: boolean }} g
         */
        addSignal: (g) => {
            const day = jstDayOf(g.at);
            let stream = state.streams.find((s) => s.user_id === g.userId && s.chain_id === g.chain && s.day === day && s.account_deleted_at === null);
            if (!stream) {
                stream = { id: id(), user_id: g.userId, cohort_id: g.cohortId, unit_key: g.unit, chain_id: g.chain, chain_started_at: g.born, day, started_at: g.at, account_deleted_at: null };
                state.streams.push(stream);
            }
            state.signals.push({ stream_id: stream.id, received_at: g.at, seq: g.seq, flags: (g.stop ? 1 : 0) | (g.focus ? 2 : 0) | (g.input ? 4 : 0) });
        },
    };
}
