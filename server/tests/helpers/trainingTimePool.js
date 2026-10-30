// @ts-check
/**
 * An in-memory stand-in for the study time tables (server/migrations/022_training_study_time.sql)
 * and what tools/core/trainingTime.js reads of 018 and 021 (auth.users stubs, cohorts,
 * memberships). It answers the module's own statements (TRAINING_TIME_SQL, and TRAINING_SQL's
 * locks and cohort read) the way PostgreSQL would, with a clock the test sets (now() and
 * clock_timestamp() alike), the CHECKs the core relies on, and transactions (BEGIN snapshots,
 * ROLLBACK restores). Any other statement throws, so a changed query fails loudly; the SQL itself
 * runs on PostgreSQL 16 in scripts/db/verify-training.mjs. Not a test file (npm test runs *.test.js).
 */
import { TRAINING_SQL } from '../../../tools/core/training.js';
import { TRAINING_TIME_SQL } from '../../../tools/core/trainingTime.js';
import { jstDayOf, jstDayRange, nextDay } from '../../../shared/training/studyTime.js';

const DAY_MAX_MS = 86_400_000;
/** @param {string} day */
const previousDay = (day) => jstDayOf(jstDayRange(day).start - 1);
/** @param {unknown[]} rows */
const result = (rows) => ({ rowCount: rows.length, rows });
/** A PostgreSQL error with its SQLSTATE. @param {string} code @param {string} message */
const pgError = (code, message) => Object.assign(new Error(message), { code });

/**
 * @typedef {{ id: string, slug: string, name: string, starts_on: string | null, ends_on: string | null }} Cohort
 * @typedef {{ user_id: string, cohort_id: string, role: string, added_at: number, account_deleted_at: number | null }} Membership
 */

/**
 * @param {{ clock?: number, stubs?: string[], cohorts?: Cohort[], memberships?: Array<Partial<Membership> & { user_id: string, cohort_id: string }> }} [seed]
 */
export function createTrainingTimePool(seed = {}) {
    let state = {
        clock: seed.clock ?? Date.UTC(2026, 10, 10, 3, 0, 0),
        stubs: [...(seed.stubs ?? [])],
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
    /** @type {{ sql: string, params: unknown[], tx: boolean }[]} */
    const queries = [];
    /** @type {{ sql: string, error: any }[]} */
    const failures = [];
    /** @type {unknown[]} */
    const releases = [];

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
        const failure = failures.find((f) => f.sql === sql);
        if (failure) throw failure.error;
        const [p1, p2] = params;
        switch (sql) {
            case 'BEGIN':
                snapshot = structuredClone(state);
                return result([]);
            case 'COMMIT':
                snapshot = null;
                return result([]);
            case 'ROLLBACK':
                if (snapshot) state = snapshot;
                snapshot = null;
                return result([]);
            case TRAINING_SQL.lockTimeout:
            case TRAINING_SQL.lock:
            case TRAINING_SQL.learnerLock:
                return result([]);
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
                return result(state.cohorts.filter((c) => c.slug === p1).map((c) => ({ id: c.id, starts_on: c.starts_on, ends_on: c.ends_on, today: jstDayOf(state.clock) })));
            case TRAINING_TIME_SQL.settingCourses:
                return result(settingsOf(p1).map((s) => ({ effective_from: s.effective_from, course_key: catalogOf(s).course_key })));
            case TRAINING_TIME_SQL.cohortHasEvidence:
                return result([{ evidence: state.streams.some((s) => s.cohort_id === p1) }]);
            case TRAINING_TIME_SQL.insertSetting: {
                const [cohortId, catalogId, ruleSetId, effectiveFrom, setBy, reason] = params;
                if (String(effectiveFrom) < jstDayOf(state.clock)) throw pgError('23514', 'new row for relation "training_cohort_time_settings" violates check constraint');
                const row = { id: id(), cohort_id: cohortId, catalog_version_id: catalogId, rule_set_id: ruleSetId, effective_from: effectiveFrom, set_at: new Date(state.clock), set_by: setBy, reason };
                state.settings.push(row);
                return result([{ id: row.id, effective_from: row.effective_from }]);
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
        /**
         * A setting as a row (bypassing the script's checks; set_at is given, so a past day is possible).
         * @param {{ cohortId: string, catalogId: string, ruleSetId: string, effectiveFrom: string }} s
         */
        addSetting: (s) => {
            state.settings.push({ id: id(), cohort_id: s.cohortId, catalog_version_id: s.catalogId, rule_set_id: s.ruleSetId, effective_from: s.effectiveFrom, set_at: new Date(Date.UTC(2026, 0, 1)), set_by: 'test', reason: 'test' });
        },
        /**
         * A stored signal, as the write path of part 2b stores it: the stream row of the signal's
         * Japan-time day (created by its first signal that day), then the narrow row.
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
