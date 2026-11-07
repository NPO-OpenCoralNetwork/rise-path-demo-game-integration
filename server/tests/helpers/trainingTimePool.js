// @ts-check
/**
 * An in-memory stand-in for the study time tables (server/migrations/022_training_study_time.sql
 * and 023_training_study_time_recounts.sql) and what tools/core/trainingTime.js,
 * trainingTimeCheck.js and trainingTimeRecount.js read of 018 and 021 (auth.users stubs, tombstones,
 * cohorts, memberships). It answers the modules' own statements (TRAINING_TIME_SQL, CHECK_SQL,
 * RECOUNT_SQL, and TRAINING_SQL's locks, cohort and membership reads and tombstone read) and the two
 * requireAuth sends for a session (AUTH_SQL: the tombstone read, and the stub insert with migration
 * 018's rule: no stub for a deleted id until it is re-opened), the way PostgreSQL would, with a clock
 * the test sets (now() and clock_timestamp() alike), the CHECKs and foreign keys the core relies on,
 * and transactions (BEGIN, and the snapshot BEGIN of a staff read, keep a copy that ROLLBACK
 * restores; the state's savepoint too; each answered with node-pg's command tag; a BEGIN whose text
 * ends in READ ONLY refuses every write until it ends; the LOCK TABLE … NOWAIT statements, the
 * shorter lock timeout and the reads of no rows that lock the indexes are answered, nothing waits).
 * Another session's commit during a transaction (a deletion, a close, a signal, a recount) is
 * pool.elsewhere: a ROLLBACK keeps it. Rows
 * ordered by a unit key come in the order of the VM's database collation (en_US.utf8 ignores '-':
 * 'unit1' before 'unit-a'), not JavaScript's. Any other statement throws, so a changed query fails loudly;
 * the SQL itself runs on PostgreSQL 16 in scripts/db/verify-training.mjs. Not a test file (npm test
 * runs *.test.js).
 */
import { TRAINING_SQL } from '../../../tools/core/training.js';
import { TRAINING_TIME_SQL } from '../../../tools/core/trainingTime.js';
import { CHECK_SQL } from '../../../tools/core/trainingTimeCheck.js';
import { RECOUNT_LOCKS, RECOUNT_SQL } from '../../../tools/core/trainingTimeRecount.js';
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
/** A statement that writes (the module's inserts, a WITH … INSERT among them). */
const WRITES = /\b(INSERT\s+INTO|DELETE\s+FROM)\b|\bUPDATE\s+\S+\s+SET\b/i;
const EN_US = new Intl.Collator('en-US', { ignorePunctuation: true });
/**
 * ORDER BY a unit key as en_US.utf8 orders it: '-' ignored first. Keys equal once '-' is removed are
 * then put in code-unit order, which glibc may not do (no test uses such keys).
 * @param {string} a @param {string} b
 */
const byCollation = (a, b) => EN_US.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
/** The LOCK TABLE statements (answered 'LOCK') and the reads of no rows that lock the indexes. */
const LOCKS = new Set([CHECK_SQL.lockCohort, CHECK_SQL.lockLearner, RECOUNT_LOCKS.head[0], RECOUNT_LOCKS.learner[0], RECOUNT_LOCKS.history[0],
    RECOUNT_SQL.lockWritten, RECOUNT_SQL.lockReferenced, RECOUNT_SQL.lockRead]);
const INDEX_READS = new Set([CHECK_SQL.indexesCohort, CHECK_SQL.indexesLearner, RECOUNT_LOCKS.head[2], RECOUNT_LOCKS.learner[2], RECOUNT_LOCKS.history[2],
    RECOUNT_SQL.indexesWrite]);
/** Characters as PostgreSQL's length() counts them (code points). @param {unknown} text */
const chars = (text) => Array.from(String(text)).length;

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
        /** training_time_recomputes (023): a test adds a recount's record with addRecount. @type {any[]} */ recounts: [],
        next: 1,
    };
    /** Inside a REPEATABLE READ READ ONLY transaction (TRAINING_TIME_SQL.beginSnapshot): writes refuse. */
    let readOnly = false;
    /** @type {typeof state | null} */
    let snapshot = null;
    /** The state at TRAINING_TIME_SQL.savepointState (ROLLBACK TO keeps the savepoint). @type {typeof state | null} */
    let savepoint = null;
    /** @type {{ sql: string, params: unknown[], tx: boolean }[]} */
    const queries = [];
    /** @type {{ sql: string, error: any, times: number }[]} */
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
        const failure = failures.find((f) => f.sql === sql && f.times > 0);
        if (failure) {
            failure.times -= 1;
            throw failure.error;
        }
        if (readOnly && WRITES.test(sql)) throw pgError('25006', 'cannot execute a write in a read-only transaction');
        if (LOCKS.has(sql)) return ended('LOCK');
        if (INDEX_READS.has(sql)) return result([]);
        const [p1, p2] = params;
        switch (sql) {
            case 'BEGIN':
            case TRAINING_TIME_SQL.beginSnapshot:
                snapshot = structuredClone(state);
                savepoint = null;
                // As PostgreSQL decides it: by the text (a test pins TRAINING_TIME_SQL.beginSnapshot's).
                readOnly = /\bREAD ONLY$/.test(sql);
                return ended('BEGIN');
            case 'COMMIT':
                snapshot = null;
                savepoint = null;
                readOnly = false;
                return ended('COMMIT');
            case 'ROLLBACK':
                if (snapshot) state = snapshot;
                snapshot = null;
                savepoint = null;
                readOnly = false;
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
                return result([...sums.entries()].sort(([a], [b]) => byCollation(a, b)).map(([unit, s]) => ({ unit_key: unit, counted_ms: String(s.counted), over_cap_ms: String(s.over) })));
            }
            case TRAINING_TIME_SQL.evidence:
                return result(evidenceOf(params));
            case RECOUNT_SQL.fingerprint: {
                // The live rows' ids in day and id order (text), and the count of TRAINING_TIME_SQL.evidence
                // with $3..$6 (bigint, as node-pg returns it).
                const ids = state.days
                    .filter((d) => d.user_id === p1 && d.cohort_id === p2 && d.account_deleted_at === null)
                    .sort((x, y) => x.day.localeCompare(y.day) || Number(x.id) - Number(y.id))
                    .map((d) => String(d.id));
                return result([{ day_ids: ids, evidence: String(evidenceOf(params).length) }]);
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
                        computed_at: state.clock, computed_by: by, account_deleted_at: null, recompute_id: null,
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
            case CHECK_SQL.tryLockTimeout:
                return ended('SET');
            case RECOUNT_SQL.clock:
                return result([{ now_ms: String(Math.floor(state.clock)) }]);
            case RECOUNT_SQL.learnerMember:
                return result(state.memberships
                    .filter((m) => m.user_id === p1 && m.cohort_id === p2 && m.role === 'learner' && m.account_deleted_at === null)
                    .map((m) => ({ added_on: jstDayOf(m.added_at) })));
            case RECOUNT_SQL.insertRecount: {
                const [cohort, fromDay, toDay, ruleSetId, catalogId, planSha, by, reason] = params;
                if (!(String(fromDay) <= String(toDay)) || (ruleSetId === null && catalogId === null) || !/^[0-9a-f]{64}$/.test(String(planSha))
                    || !(chars(by) >= 1 && chars(by) <= 100) || !(chars(reason) >= 1 && chars(reason) <= 500)) {
                    throw pgError('23514', 'new row for relation "training_time_recomputes" violates check constraint');
                }
                if (!state.cohorts.some((c) => c.id === cohort)) throw pgError('23503', 'training_time_recomputes_cohort_id_fkey');
                if (ruleSetId !== null && !state.rules.some((r) => r.id === String(ruleSetId))) throw pgError('23503', 'training_time_recomputes_rule_set_id_fkey');
                if (catalogId !== null && !state.catalogs.some((c) => c.id === String(catalogId))) throw pgError('23503', 'training_time_recomputes_catalog_version_id_fkey');
                const row = {
                    id: id(), cohort_id: cohort, from_day: String(fromDay), to_day: String(toDay), rule_set_id: ruleSetId === null ? null : String(ruleSetId),
                    catalog_version_id: catalogId === null ? null : String(catalogId), plan_sha256: planSha, recomputed_at: state.clock, recomputed_by: by, reason,
                };
                state.recounts.push(row);
                return result([{ id: row.id }]);
            }
            case RECOUNT_SQL.insertRecountDays: {
                const [user, cohort, by, recountId, days, algorithms, ruleSetIds, catalogIds, counted, over, signals, digests] = params;
                // Only while the stub exists: no row at all otherwise.
                if (!state.stubs.includes(String(user))) return result([]);
                const rows = /** @type {string[]} */ (days).map((day, i) => ({
                    user_id: user, cohort_id: cohort, day, kind: 'recompute', algorithm: /** @type {string[]} */ (algorithms)[i],
                    rule_set_id: String(/** @type {string[]} */ (ruleSetIds)[i]), catalog_version_id: String(/** @type {string[]} */ (catalogIds)[i]),
                    counted_ms: /** @type {number[]} */ (counted)[i], over_cap_ms: /** @type {number[]} */ (over)[i], signals: /** @type {number[]} */ (signals)[i],
                    evidence_sha256: /** @type {string[]} */ (digests)[i], computed_at: state.clock, computed_by: by, account_deleted_at: null, recompute_id: String(recountId),
                }));
                // One statement: every row is checked before any is kept (the CHECKs, then the foreign keys).
                for (const r of rows) {
                    if (!(r.counted_ms >= 0 && r.over_cap_ms >= 0 && r.counted_ms + r.over_cap_ms <= DAY_MAX_MS) || !(r.signals >= 0) || !/^[0-9a-f]{64}$/.test(r.evidence_sha256)
                        || !/^study-time\/v[1-9][0-9]{0,2}$/.test(r.algorithm) || !(chars(by) >= 1 && chars(by) <= 100)) {
                        throw pgError('23514', 'new row for relation "training_time_days" violates check constraint');
                    }
                }
                for (const r of rows) {
                    // The cohort, the versions, and a recount of the same cohort (023's composite key).
                    if (!state.cohorts.some((x) => x.id === r.cohort_id)) throw pgError('23503', 'training_time_days_cohort_id_fkey');
                    if (!state.rules.some((x) => x.id === r.rule_set_id)) throw pgError('23503', 'training_time_days_rule_set_id_fkey');
                    if (!state.catalogs.some((x) => x.id === r.catalog_version_id)) throw pgError('23503', 'training_time_days_catalog_version_id_fkey');
                    if (!state.recounts.some((x) => x.id === r.recompute_id && x.cohort_id === r.cohort_id)) throw pgError('23503', 'training_time_days_recompute_fkey');
                }
                const kept = rows.map((r) => ({ id: id(), ...r }));
                state.days.push(...kept);
                return result(kept.map((r) => ({ id: r.id, day: r.day })));
            }
            case RECOUNT_SQL.cohortRecounts:
                return result(state.recounts.filter((r) => r.cohort_id === p1).sort((x, y) => Number(x.id) - Number(y.id)).map((r) => ({
                    id: r.id, recomputed_at: new Date(r.recomputed_at), recomputed_by: r.recomputed_by, reason: r.reason, from_day: r.from_day, to_day: r.to_day,
                    rules_sha256: r.rule_set_id === null ? null : state.rules.find((x) => x.id === r.rule_set_id)?.sha256 ?? null,
                    catalog_sha256: r.catalog_version_id === null ? null : state.catalogs.find((x) => x.id === r.catalog_version_id)?.sha256 ?? null,
                    plan_sha256: r.plan_sha256,
                })));
            case CHECK_SQL.learnerRows:
                return result(state.days
                    .filter((d) => d.user_id === p1 && d.cohort_id === p2 && d.account_deleted_at === null)
                    .sort((x, y) => x.day.localeCompare(y.day) || Number(x.id) - Number(y.id))
                    .map((d) => ({
                        id: d.id, day: d.day, kind: d.kind, algorithm: d.algorithm, rule_set_id: d.rule_set_id, catalog_version_id: d.catalog_version_id,
                        counted_ms: d.counted_ms, over_cap_ms: d.over_cap_ms, signals: d.signals, evidence_sha256: d.evidence_sha256,
                        recompute_id: d.recompute_id ?? null, computed_at: new Date(d.computed_at), computed_by: d.computed_by,
                    })));
            case CHECK_SQL.unitRows: {
                const ids = /** @type {string[]} */ (p1).map(String);
                return result(state.unitDays
                    .filter((u) => ids.includes(u.day_id))
                    .sort((x, y) => Number(x.day_id) - Number(y.day_id) || byCollation(x.unit_key, y.unit_key))
                    .map((u) => ({ day_id: u.day_id, unit_key: u.unit_key, counted_ms: u.counted_ms, over_cap_ms: u.over_cap_ms })));
            }
            case CHECK_SQL.rulesByIds:
            case RECOUNT_SQL.rulesBySha: {
                const match = sql === RECOUNT_SQL.rulesBySha ? (/** @type {any} */ r) => r.sha256 === p1 : (/** @type {any} */ r) => /** @type {string[]} */ (p1).map(String).includes(r.id);
                return result(state.rules.filter(match).sort((x, y) => Number(x.id) - Number(y.id))
                    .map((r) => ({ id: r.id, sha256: r.sha256, algorithm: r.algorithm, params: structuredClone(r.params) })));
            }
            case CHECK_SQL.catalogsByIds:
            case RECOUNT_SQL.catalogBySha: {
                const match = sql === RECOUNT_SQL.catalogBySha ? (/** @type {any} */ c) => c.sha256 === p1 : (/** @type {any} */ c) => /** @type {string[]} */ (p1).map(String).includes(c.id);
                return result(state.catalogs.filter(match).sort((x, y) => Number(x.id) - Number(y.id))
                    .map((c) => ({ id: c.id, sha256: c.sha256, course_key: c.course_key, manifest: structuredClone(c.manifest) })));
            }
            case CHECK_SQL.recountsByIds: {
                const ids = /** @type {string[]} */ (p1).map(String);
                return result(state.recounts.filter((r) => ids.includes(r.id)).sort((x, y) => Number(x.id) - Number(y.id))
                    .map((r) => ({ id: r.id, cohort_id: r.cohort_id, from_day: r.from_day, to_day: r.to_day, rule_set_id: r.rule_set_id, catalog_version_id: r.catalog_version_id })));
            }
            default:
                throw new Error(`trainingTimePool: unexpected statement: ${sql.slice(0, 120)}`);
        }
    };

    /**
     * TRAINING_TIME_SQL.evidence's rows: the live streams of the days $3 - 1 .. $4 + 1, the signals
     * received in [$5, $6] (a NULL day or instant matches nothing), in chain and seq order.
     * @param {unknown[]} params
     */
    function evidenceOf(params) {
        const [user, cohort, fromDay, toDay, fromIso, toIso] = params;
        if ([fromDay, toDay, fromIso, toIso].some((p) => p === null || p === undefined)) return [];
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
        return rows;
    }
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
        // The widest gapMs among the last closed day's live rows, of any kind (max() skips a NULL: a
        // rules row without a gapMs; a gapMs that is not an integer is not modelled, every stored rules
        // version parsed with one).
        const gaps = closed ? state.days
            .filter((d) => d.user_id === user && d.cohort_id === cohortId && d.day === closed.day && d.account_deleted_at === null)
            .map((d) => state.rules.find((r) => r.id === d.rule_set_id)?.params?.counting?.gapMs)
            .filter((g) => typeof g === 'number') : [];
        const closedGap = gaps.length ? Math.max(...gaps) : null;
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
            closed_until_ms: closed && closedGap !== null ? String(jstDayRange(closed.day).end + closedGap) : null,
        };
    }
    /** @param {any} setting */
    function catalogOf(setting) {
        return state.catalogs.find((c) => c.id === setting.catalog_version_id);
    }
    /**
     * Another session's commit, while the code under test may have a transaction open (in a `before`
     * hook, during a lock wait): `commit` runs against the state and against the copies a ROLLBACK or
     * ROLLBACK TO restores (the BEGIN's and the savepoint's), so a rollback keeps it. Ids it takes are
     * past every copy's, the same in each (PostgreSQL never hands out an id twice).
     * @param {() => void} commit uses the pool's helpers (addSignal, addClose, addRecount) or pool.state
     */
    function elsewhere(commit) {
        const current = state;
        const copies = /** @type {Array<typeof state>} */ ([current, snapshot, savepoint].filter((c) => c !== null));
        const start = Math.max(...copies.map((c) => c.next));
        let end = start;
        try {
            for (const copy of copies) {
                state = copy;
                copy.next = start;
                commit();
                end = Math.max(end, copy.next);
            }
        } finally {
            state = current;
        }
        for (const copy of copies) copy.next = end;
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
        /** Make a statement throw (an Error with a SQLSTATE), every time or its next `times`. @param {string} sql @param {any} error @param {number} [times] */
        failOn: (sql, error, times = Infinity) => failures.push({ sql, error, times }),
        /** Run `run` (move the clock, add a row) just before each matching statement. @param {string} sql @param {() => void} run */
        before: (sql, run) => hooks.push({ sql, run }),
        elsewhere,
        /**
         * An account deletion as the service commits it (server/services/accountDeletion.js): the
         * tombstone, the marks on the account's memberships, streams and days, and no stub. Another
         * session's commit (elsewhere): an open transaction's ROLLBACK keeps it, so it can run in a
         * `before` hook, during a lock wait.
         * @param {string} user @param {number} at
         */
        deleteAccount: (user, at) => elsewhere(() => {
            state.tombstones.set(user, { deleted_at: at, reopened_at: null });
            for (const rows of [state.memberships, state.streams, state.days]) {
                for (const row of /** @type {any[]} */ (rows)) if (row.user_id === user && row.account_deleted_at === null) row.account_deleted_at = at;
            }
            state.stubs = state.stubs.filter((s) => s !== user);
        }),
        /**
         * A close row as closeDays appends it (kind 'close'), with its unit rows, at any day (no
         * finality check: a test's other session). Returns the row's id.
         * @param {{ userId: string, cohortId: string, day: string, algorithm?: string, ruleSetId: string, catalogId: string, countedMs: number, overCapMs: number,
         *   signals: number, evidenceSha256: string, units?: Array<[string, number, number]>, computedBy?: string }} row
         */
        addClose: (row) => {
            const dayId = id();
            state.days.push({
                id: dayId, user_id: row.userId, cohort_id: row.cohortId, day: row.day, kind: 'close', algorithm: row.algorithm ?? 'study-time/v1',
                rule_set_id: row.ruleSetId, catalog_version_id: row.catalogId, counted_ms: row.countedMs, over_cap_ms: row.overCapMs, signals: row.signals,
                evidence_sha256: row.evidenceSha256, computed_at: state.clock, computed_by: row.computedBy ?? 'api', account_deleted_at: null, recompute_id: null,
            });
            for (const [unit, counted, over] of row.units ?? []) state.unitDays.push({ day_id: dayId, unit_key: unit, counted_ms: counted, over_cap_ms: over });
            return dayId;
        },
        /**
         * A recount's record (training_time_recomputes) and its rows, as a test sets them (no check:
         * tools/core/trainingTimeRecount.js writes the real ones): each day's row as a recount
         * appends it (kind 'recompute', naming the record), with its unit rows. Returns the record's id.
         * @param {{ cohortId: string, fromDay: string, toDay: string, ruleSetId?: string | null, catalogId?: string | null,
         *   rows?: Array<{ userId: string, day: string, algorithm?: string, ruleSetId: string, catalogId: string, countedMs: number, overCapMs: number,
         *     signals: number, evidenceSha256: string, units?: Array<[string, number, number]> }> }} r
         */
        addRecount: (r) => {
            const record = {
                id: id(), cohort_id: r.cohortId, from_day: r.fromDay, to_day: r.toDay, rule_set_id: r.ruleSetId ?? null, catalog_version_id: r.catalogId ?? null,
                plan_sha256: 'a'.repeat(64), recomputed_at: state.clock, recomputed_by: 'test', reason: 'test',
            };
            state.recounts.push(record);
            for (const row of r.rows ?? []) {
                const dayId = id();
                state.days.push({
                    id: dayId, user_id: row.userId, cohort_id: r.cohortId, day: row.day, kind: 'recompute', algorithm: row.algorithm ?? 'study-time/v1',
                    rule_set_id: row.ruleSetId, catalog_version_id: row.catalogId, counted_ms: row.countedMs, over_cap_ms: row.overCapMs, signals: row.signals,
                    evidence_sha256: row.evidenceSha256, computed_at: state.clock, computed_by: 'test', account_deleted_at: null, recompute_id: record.id,
                });
                for (const [unit, counted, over] of row.units ?? []) state.unitDays.push({ day_id: dayId, unit_key: unit, counted_ms: counted, over_cap_ms: over });
            }
            return record.id;
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
