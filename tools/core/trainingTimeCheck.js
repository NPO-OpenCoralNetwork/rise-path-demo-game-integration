// @ts-check
/**
 * Shared Business Logic — job training, the check of closed study time days
 * (doc/brushup-2026/training-plan.ja.md §4.9; D12). Tables of server/migrations/022 and 023; the
 * counting is shared/training/studyTime.js, each day with its own version
 * (shared/training/countingVersions.js). Staff run it with scripts/training-time.mjs --verify.
 *
 * A closed day's value never changes by itself: a close appends one row per day, and the current
 * value of a day is its newest live row (tools/core/trainingTime.js). D12: when rules or a unit list
 * change, finalized days change only when a staff member saw the differences and confirmed them (a
 * recount, migration 023), and the old rows, who and why stay.
 *
 * The check (verifyCohort): every current row of a learner, in day order, with the unit time carried
 * from the stored rows before it (as the close or recount that wrote it carried it): its
 * versions are ones this code can count (a version it does not have is never counted with another);
 * a close row's versions are the cohort's setting of its day, and a recount row's those of its
 * recount (the override inside the recount's days, the row it replaced for the version not
 * overridden, and the row it replaced outside those days); its evidence (the signals in its window,
 * their count and sha256) and its values (counted, over the set time, each unit) are what its
 * versions give. The cohort and its learners, then each learner, are read in a REPEATABLE READ READ
 * ONLY snapshot of their own, so a signal, a close or an account deletion committing meanwhile is not
 * half seen. Before its snapshot, each locks the tables it reads in ACCESS SHARE mode, NOWAIT
 * (lockedSnapshot): a migration's DDL on them is never read through an older snapshot (a table
 * rewrite is not MVCC-safe: such a snapshot sees the table empty); while DDL holds or waits for one of
 * them, the try rolls back, holding nothing, and the next starts LOCK_RETRY.everyMs after it started
 * (at once after a longer try), for about the lock timeout (then account_busy). Any other lock wait
 * of a try ends after 20 ms, a try that starts over too: on an index a REINDEX holds, before the try
 * has read anything (a read of no rows of its tables locks all their indexes); on a TOAST table or
 * its index (a value stored out of line, which a read locks only while it fetches it), during the
 * reads. So it never waits long while holding a lock, far under PostgreSQL's deadlock_timeout, and a
 * migration is not cancelled as a deadlock with it. ACCESS SHARE conflicts only with ACCESS
 * EXCLUSIVE, so signals, closes and deletion marks go on, and no advisory lock is taken. It writes
 * nothing.
 *
 * Failures return { error, error_type } (tools/core/dbErrors.js), never the driver's text.
 */
import { getPool } from '../../server/db.js';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { parseCourseManifest, setMsOf } from '../../shared/training/courseManifest.js';
import { countingVersion } from '../../shared/training/countingVersions.js';
import { cohortRange, jstDayRange } from '../../shared/training/studyTime.js';
import { parseTimeRules } from '../../shared/training/timeRules.js';
import { canonicalUserId } from './accountDeletions.js';
import { TRAINING_SQL } from './training.js';
import { TRAINING_TIME_SQL, evidenceDigest, parseSettings, settingOf, signalOf, transaction } from './trainingTime.js';

/** @typedef {import('./dbTransaction.js').CoreError} CoreError */
/** @typedef {import('./training.js').TrainingPool} TrainingPool */
/** @typedef {import('./training.js').Queryable} Queryable */
/** @typedef {import('./trainingTime.js').Setting} Setting */
/** @typedef {import('../../shared/training/studyTime.js').Signal} Signal */
/** @typedef {import('../../shared/training/studyTime.js').TimeRules} TimeRules */
/** @typedef {import('../../shared/training/studyTime.js').Range} Range */

/** A day's units as [unit key, counted ms, over the set time ms], in code-unit order of the key. @typedef {Array<[string, number, number]>} Units */
/**
 * A live day row (training_time_days), units only on the current rows.
 * @typedef {{ id: string, day: string, kind: string, algorithm: string, ruleSetId: string, catalogVersionId: string, countedMs: number,
 *   overCapMs: number, signals: number, evidenceSha256: string, recomputeId: string | null, computedAt: string | null, computedBy: string, units: Units }} DayRow
 */
/**
 * A rules version: null rules when it does not parse with this code; declared, the algorithm its
 * params name (kept when they do not parse; null when they name none).
 * @typedef {{ id: string, sha256: string, algorithm: string, declared: string | null, rules: TimeRules | null }} RulesVersion
 */
/** A unit list version: null setMs when it does not parse. @typedef {{ id: string, sha256: string, courseKey: string, setMs: Map<string, number> | null }} CatalogVersion */
/** @typedef {{ id: string, cohortId: string, fromDay: string, toDay: string, ruleSetId: string | null, catalogVersionId: string | null }} RecountRecord */
/**
 * What one learner's check and recount read: every live row, the versions and recounts they name,
 * the evidence of the closed days.
 * @typedef {{ rows: DayRow[], rules: Map<string, RulesVersion>, catalogs: Map<string, CatalogVersion>, recounts: Map<string, RecountRecord>, signals: Signal[] }} LearnerRecords
 */
/** @typedef {{ day: string, what: 'version' | 'setting' | 'recount' | 'evidence' | 'values', detail: Record<string, unknown> }} Difference */

/** The tables a snapshot's reads use: the cohort's (readCohort), a learner's (closeSettings, readLearner). */
const COHORT_TABLES = 'training_cohorts, training_memberships';
const LEARNER_TABLES = 'training_cohort_time_settings, training_time_rule_sets, training_catalog_versions, training_time_days, training_time_unit_days, '
    + 'training_time_recomputes, training_time_streams, training_time_signals';

/** The statements, exactly as sent. $1 is the canonical account id, or the ids to read. */
export const CHECK_SQL = Object.freeze({
    // First in a snapshot, before any SELECT (a LOCK takes no snapshot): its tables, without waiting.
    lockCohort: `LOCK TABLE ${COHORT_TABLES} IN ACCESS SHARE MODE NOWAIT`,
    lockLearner: `LOCK TABLE ${LEARNER_TABLES} IN ACCESS SHARE MODE NOWAIT`,
    // Then any other lock wait of the try ends after 20 ms, well under PostgreSQL's deadlock_timeout
    // (1 s); and planning a read of all its tables locks every index of them, so a wait on one comes
    // first, before the try has read anything (a REINDEX holds its index in ACCESS EXCLUSIVE mode, and
    // its table only in SHARE mode, which the LOCK's ACCESS SHARE does not conflict with). A TOAST
    // table and its index are locked only while a read fetches a value stored out of line: a wait
    // there comes during the reads, and ends after 20 ms as well.
    tryLockTimeout: "SET LOCAL lock_timeout = '20ms'",
    indexesCohort: `SELECT 1 FROM ${COHORT_TABLES} LIMIT 0`,
    indexesLearner: `SELECT 1 FROM ${LEARNER_TABLES} LIMIT 0`,
    // Every live row of a learner in a cohort, in day and id order (the newest of a day is its current value).
    learnerRows: `SELECT id, to_char(day, 'YYYY-MM-DD') AS day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals,
       evidence_sha256, recompute_id, computed_at, computed_by
  FROM training_time_days
 WHERE user_id = $1::uuid AND cohort_id = $2::uuid AND account_deleted_at IS NULL
 ORDER BY day, id`,
    unitRows: 'SELECT day_id, unit_key, counted_ms, over_cap_ms FROM training_time_unit_days WHERE day_id = ANY($1::bigint[]) ORDER BY day_id, unit_key',
    rulesByIds: 'SELECT id, sha256, algorithm, params FROM training_time_rule_sets WHERE id = ANY($1::bigint[]) ORDER BY id',
    catalogsByIds: 'SELECT id, sha256, course_key, manifest FROM training_catalog_versions WHERE id = ANY($1::bigint[]) ORDER BY id',
    recountsByIds: `SELECT id, cohort_id, to_char(from_day, 'YYYY-MM-DD') AS from_day, to_char(to_day, 'YYYY-MM-DD') AS to_day, rule_set_id, catalog_version_id
  FROM training_time_recomputes WHERE id = ANY($1::bigint[]) ORDER BY id`,
});

/** @param {unknown} value @returns {string | null} */
export const isoTime = (value) => {
    if (value === null || value === undefined) return null;
    const time = new Date(/** @type {any} */ (value)).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/**
 * Code-unit order of the unit keys. Not the database's: its collation may order them otherwise (the
 * VM's en_US.utf8 ignores '-', so 'unit1' comes before 'unit-a' there).
 * @param {[string, number, number]} x @param {[string, number, number]} y
 */
const byKey = (x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);

/** @param {import('../../shared/training/studyTime.js').UnitTime[]} units @returns {Units} */
export const unitsOf = (units) => units
    .filter((u) => u.countedMs > 0 || u.overCapMs > 0)
    .map((u) => /** @type {[string, number, number]} */ ([u.unit, u.countedMs, u.overCapMs]))
    .sort(byKey);

/** @param {Units} a @param {Units} b */
export const sameUnits = (a, b) => canonicalJson(a) === canonicalJson(b);

/** A rules row parsed again (null rules when it does not parse with this code). @param {any} row @returns {RulesVersion} */
export function rulesVersionOf(row) {
    const parsed = parseTimeRules(row.params);
    const declared = typeof row.params?.algorithm === 'string' ? row.params.algorithm : null;
    return { id: String(row.id), sha256: String(row.sha256), algorithm: String(row.algorithm), declared, rules: 'errors' in parsed ? null : parsed.rules };
}

/** A unit list row parsed again (null setMs when it does not parse). @param {any} row @returns {CatalogVersion} */
export function catalogVersionOf(row) {
    const parsed = parseCourseManifest(row.manifest);
    return { id: String(row.id), sha256: String(row.sha256), courseKey: String(row.course_key), setMs: 'errors' in parsed ? null : setMsOf(parsed.manifest) };
}

/**
 * The current row of each day (its newest live row), in day order.
 * @param {DayRow[]} rows (in day and id order)
 */
export function currentRows(rows) {
    /** @type {Map<string, DayRow>} */
    const byDay = new Map();
    for (const row of rows) byDay.set(row.day, row);
    return [...byDay.values()];
}

/**
 * The live row a row replaced: the newest live row of its day with a smaller id.
 * @param {DayRow[]} rows (in day and id order) @param {DayRow} row
 */
function replacedBy(rows, row) {
    /** @type {DayRow | null} */
    let found = null;
    for (const r of rows) if (r.day === row.day && Number(r.id) < Number(row.id)) found = r;
    return found;
}

/**
 * Count one day with given versions and the time carried from the days before: its result and the
 * evidence of its window. null when this code cannot count those versions.
 * @param {{ day: string, rules: RulesVersion | undefined, catalog: CatalogVersion | undefined, signals: Signal[], carriedMs: Map<string, number>, cohort: Range | null }} input
 */
export function countWith({ day, rules, catalog, signals, carriedMs, cohort }) {
    const version = countingVersion(rules?.rules?.algorithm);
    if (!rules?.rules || !catalog?.setMs || !version || rules.algorithm !== rules.rules.algorithm) return null;
    const result = version.countDay({ day, signals, rules: rules.rules, setMs: catalog.setMs, carriedMs, cohort });
    const { start, end } = jstDayRange(day);
    const window = version.evidenceWindow(start, end, rules.rules.counting);
    const evidence = signals.filter((s) => s.at >= window.from && s.at <= window.to);
    const units = unitsOf(result.units);
    return {
        algorithm: rules.rules.algorithm,
        countedMs: result.countedMs,
        overCapMs: units.reduce((n, u) => n + u[2], 0),
        units,
        signals: evidence.length,
        evidenceSha256: evidenceDigest(evidence),
        carriedAfterMs: result.carriedAfterMs,
    };
}

/**
 * Check one learner's current rows (the header): each difference found, with the day.
 * @param {{ records: LearnerRecords, settings: Setting[], cohortId: string, cohort: Range | null }} input
 * @returns {{ days: number, differences: Difference[] }}
 */
export function verifyLearner({ records, settings, cohortId, cohort }) {
    const current = currentRows(records.rows);
    /** @type {Difference[]} */
    const differences = [];
    /** @type {Map<string, number>} */
    let carried = new Map();
    for (const row of current) {
        const rules = records.rules.get(row.ruleSetId);
        const catalog = records.catalogs.get(row.catalogVersionId);
        const counted = countWith({ day: row.day, rules, catalog, signals: records.signals, carriedMs: carried, cohort });
        const provenance = provenanceOf({ row, rows: records.rows, recounts: records.recounts, settings, cohortId });
        if (provenance) differences.push({ day: row.day, ...provenance });
        if (!counted || counted.algorithm !== row.algorithm) {
            differences.push({ day: row.day, what: 'version', detail: { algorithm: row.algorithm, rulesAlgorithm: rules?.algorithm ?? null, cause: versionCause(rules, catalog), rules: rules?.sha256 ?? null, catalog: catalog?.sha256 ?? null } });
        } else {
            if (counted.signals !== row.signals || counted.evidenceSha256 !== row.evidenceSha256) {
                differences.push({ day: row.day, what: 'evidence', detail: { stored: row.signals, found: counted.signals } });
            }
            if (counted.countedMs !== row.countedMs || counted.overCapMs !== row.overCapMs || !sameUnits(counted.units, row.units)) {
                differences.push({ day: row.day, what: 'values', detail: { stored: valuesOf(row), counted: valuesOf(counted) } });
            }
        }
        // The next day carries the stored units, as the close or recount that wrote it did.
        carried = new Map(carried);
        for (const [unit, countedMs] of row.units) carried.set(unit, (carried.get(unit) ?? 0) + countedMs);
    }
    return { days: current.length, differences };
}

/** @param {{ countedMs: number, overCapMs: number, units: Units }} v */
const valuesOf = (v) => ({ countedMs: v.countedMs, overCapMs: v.overCapMs, units: v.units });

/**
 * Why a row is not counted with its versions: 'unknown' (its rules name an algorithm this code has no
 * counting version of), 'rules_row' (the rules row names another algorithm than its rules), 'unparsed'
 * (its rules or unit list version does not parse with this code), 'row' (the day row names another
 * algorithm than its rules). The algorithm the rules name comes first: a version this code does not
 * have is that, not a version that does not parse.
 * @param {RulesVersion | undefined} rules @param {CatalogVersion | undefined} catalog
 */
function versionCause(rules, catalog) {
    if (rules?.declared && !countingVersion(rules.declared)) return rules.algorithm === rules.declared ? 'unknown' : 'rules_row';
    if (!rules?.rules || !catalog?.setMs) return 'unparsed';
    if (rules.algorithm !== rules.rules.algorithm) return 'rules_row';
    return 'row';
}

/**
 * Whether a current row's versions are the ones it was allowed to use: a close row the cohort's
 * setting of its day; a recount row its recount's override inside the recount's days (the version not
 * overridden: the row it replaced) and the row it replaced outside them. null when they are.
 * @param {{ row: DayRow, rows: DayRow[], recounts: Map<string, RecountRecord>, settings: Setting[], cohortId: string }} input
 * @returns {{ what: 'setting' | 'recount', detail: Record<string, unknown> } | null}
 */
function provenanceOf({ row, rows, recounts, settings, cohortId }) {
    if (row.kind === 'close') {
        const setting = settingOf(settings, row.day);
        if (setting && setting.ruleSetId === row.ruleSetId && setting.catalogVersionId === row.catalogVersionId) return null;
        return { what: 'setting', detail: { setting: setting?.id ?? null } };
    }
    const recount = row.recomputeId ? recounts.get(row.recomputeId) : undefined;
    const replaced = replacedBy(rows, row);
    if (!recount || recount.cohortId !== cohortId || !replaced) return { what: 'recount', detail: { recount: row.recomputeId } };
    const inside = row.day >= recount.fromDay && row.day <= recount.toDay;
    const rules = inside && recount.ruleSetId ? recount.ruleSetId : replaced.ruleSetId;
    const catalog = inside && recount.catalogVersionId ? recount.catalogVersionId : replaced.catalogVersionId;
    return rules === row.ruleSetId && catalog === row.catalogVersionId ? null : { what: 'recount', detail: { recount: row.recomputeId } };
}

/**
 * Read what a learner's check and recount need, in the caller's transaction: every live row, the
 * unit rows of the current ones, the versions and recounts they name, and the evidence of the closed
 * days (the widest window of the versions used, `extra` included). In a REPEATABLE READ snapshot the
 * caller has locked the tables first (CHECK_SQL.lockLearner, lockedSnapshot).
 * @param {Queryable} db @param {string} userId @param {string} cohortId @param {RulesVersion[]} [extra]
 * @returns {Promise<LearnerRecords>}
 */
export async function readLearner(db, userId, cohortId, extra = []) {
    /** @type {DayRow[]} */
    const rows = ((await db.query(CHECK_SQL.learnerRows, [userId, cohortId])).rows ?? []).map((r) => ({
        id: String(r.id),
        day: String(r.day),
        kind: String(r.kind),
        algorithm: String(r.algorithm),
        ruleSetId: String(r.rule_set_id),
        catalogVersionId: String(r.catalog_version_id),
        countedMs: Number(r.counted_ms),
        overCapMs: Number(r.over_cap_ms),
        signals: Number(r.signals),
        evidenceSha256: String(r.evidence_sha256),
        recomputeId: r.recompute_id === null || r.recompute_id === undefined ? null : String(r.recompute_id),
        computedAt: isoTime(r.computed_at),
        computedBy: String(r.computed_by),
        units: [],
    }));
    /** @type {LearnerRecords} */
    const records = { rows, rules: new Map(), catalogs: new Map(), recounts: new Map(), signals: [] };
    if (!rows.length) return records;
    const current = currentRows(rows);
    const byId = new Map(current.map((r) => [r.id, r]));
    for (const u of (await db.query(CHECK_SQL.unitRows, [current.map((r) => r.id)])).rows ?? []) {
        byId.get(String(u.day_id))?.units.push([String(u.unit_key), Number(u.counted_ms), Number(u.over_cap_ms)]);
    }
    // The rows come in the database collation's order; the counted units are in code-unit order.
    for (const r of current) r.units.sort(byKey);
    const ruleIds = [...new Set(rows.map((r) => r.ruleSetId))];
    const catalogIds = [...new Set(rows.map((r) => r.catalogVersionId))];
    for (const r of (await db.query(CHECK_SQL.rulesByIds, [ruleIds])).rows ?? []) records.rules.set(String(r.id), rulesVersionOf(r));
    for (const r of (await db.query(CHECK_SQL.catalogsByIds, [catalogIds])).rows ?? []) records.catalogs.set(String(r.id), catalogVersionOf(r));
    const recountIds = [...new Set(rows.map((r) => r.recomputeId).filter((id) => id !== null))];
    if (recountIds.length) {
        for (const r of (await db.query(CHECK_SQL.recountsByIds, [recountIds])).rows ?? []) {
            records.recounts.set(String(r.id), {
                id: String(r.id),
                cohortId: String(r.cohort_id),
                fromDay: String(r.from_day),
                toDay: String(r.to_day),
                ruleSetId: r.rule_set_id === null || r.rule_set_id === undefined ? null : String(r.rule_set_id),
                catalogVersionId: r.catalog_version_id === null || r.catalog_version_id === undefined ? null : String(r.catalog_version_id),
            });
        }
    }
    let back = 0;
    let ahead = 0;
    for (const version of [...records.rules.values(), ...extra]) {
        if (!version.rules) continue;
        back = Math.max(back, version.rules.counting.idleMs, version.rules.counting.gapMs);
        ahead = Math.max(ahead, version.rules.counting.gapMs);
    }
    const first = current[0].day;
    const last = current[current.length - 1].day;
    const from = new Date(jstDayRange(first).start - back).toISOString();
    const to = new Date(jstDayRange(last).end + ahead).toISOString();
    records.signals = ((await db.query(TRAINING_TIME_SQL.evidence, [userId, cohortId, first, last, from, to])).rows ?? []).map(signalOf);
    return records;
}

/**
 * Staff: check a cohort's closed days (the header), every live learner or one.
 * @param {{ cohortSlug: string, learner?: unknown, pool?: TrainingPool | null, sleep?: (ms: number) => Promise<void>, now?: () => number }} params
 *   sleep: the wait between tries for the read locks, and now: the clock in ms it is measured with
 *   (lockedSnapshot)
 * @returns {Promise<{ status: 'checked', learners: Array<{ userId: string, days: number, differences: Difference[] }> }
 *   | { status: 'no_cohort' | 'not_a_learner' } | CoreError>} CoreError 'invalid_setting' when a
 *   stored setting does not parse with this code
 */
export async function verifyCohort({ cohortSlug, learner, pool = getPool(), sleep = pause, now = monotonic }) {
    const one = learner === undefined || learner === null ? null : canonicalUserId(learner);
    if (learner !== undefined && learner !== null && !one) return { error: 'An account id (a UUID) is required.', error_type: 'validation' };
    const head = await lockedSnapshot(pool, SNAPSHOT_LOCKS.cohort, (db) => readCohort(db, cohortSlug), sleep, now);
    if (!head) return { status: 'no_cohort' };
    if ('error_type' in head) return head;
    const { cohort, learners } = head;
    if (one && !learners.includes(one)) return { status: 'not_a_learner' };
    /** @type {Array<{ userId: string, days: number, differences: Difference[] }>} */
    const out = [];
    for (const userId of one ? [one] : learners) {
        const checked = await lockedSnapshot(pool, SNAPSHOT_LOCKS.learner, async (db) => {
            const settings = parseSettings((await db.query(TRAINING_TIME_SQL.closeSettings, [cohort.id])).rows ?? []);
            /** @type {{ days: number, differences: Difference[] } | CoreError} */
            const value = settings
                ? verifyLearner({ records: await readLearner(db, userId, cohort.id), settings, cohortId: cohort.id, cohort: cohortRange(cohort.startsOn, cohort.endsOn) })
                : { ...INVALID_SETTING };
            return value;
        }, sleep, now);
        if ('error_type' in checked) return checked;
        out.push({ userId, ...checked });
    }
    return { status: 'checked', learners: out };
}

/** A stored version that no longer parses with this code stops the counting (no guess). */
export const INVALID_SETTING = Object.freeze({ error: 'A stored rules or unit list version does not parse with this code.', error_type: 'invalid_setting' });

/**
 * The tries for a snapshot's read locks: 100, each started 0.1 s after the last one started, or at
 * once after a try over 0.1 s (a try that waited 20 ms sleeps 80), so about TRAINING_LOCK_TIMEOUT
 * (10 s) in all while tries take under 0.1 s.
 */
export const LOCK_RETRY = Object.freeze({ tries: 100, everyMs: 100 });
/** @param {number} ms @returns {Promise<void>} */
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** A clock in ms that only goes forward. */
const monotonic = () => performance.now();
/** A try that found one of its tables or their indexes locked. */
const LOCKED = Object.freeze({ locked: true });
/** The statements that start a snapshot's try, before its reads. */
export const SNAPSHOT_LOCKS = Object.freeze({
    cohort: Object.freeze([CHECK_SQL.lockCohort, CHECK_SQL.tryLockTimeout, CHECK_SQL.indexesCohort]),
    learner: Object.freeze([CHECK_SQL.lockLearner, CHECK_SQL.tryLockTimeout, CHECK_SQL.indexesLearner]),
});

/**
 * A REPEATABLE READ READ ONLY snapshot that first locks its tables (a LOCK … IN ACCESS SHARE MODE
 * NOWAIT; it takes no snapshot), lowers its lock timeout to 20 ms and plans a read of all of them
 * (locking their indexes), then runs `work` and rolls back. A 55P03 anywhere in a try (one of the
 * tables held or waited for in a conflicting mode, a migration's DDL; or, for 20 ms, an index a
 * REINDEX holds, or a TOAST table or its index while a read fetches a value stored out of line) rolls
 * the try back, holding nothing; any other error ends it (transaction() classifies it). The next try
 * starts LOCK_RETRY.everyMs after the last one started (at once after a longer try), and after
 * LOCK_RETRY.tries tries, about 10 s, account_busy. So a try waits at most 20 ms while it holds a
 * lock, far under PostgreSQL's deadlock_timeout (1 s): a migration that locks two of these tables is
 * not cancelled as a deadlock with it. No table rewrite commits between its snapshot and its reads.
 * @template T
 * @param {TrainingPool | null | undefined} pool @param {readonly string[]} locks SNAPSHOT_LOCKS.cohort or .learner
 * @param {(db: Queryable) => Promise<T>} work @param {(ms: number) => Promise<void>} sleep
 * @param {() => number} now the clock in ms the tries are spaced with
 * @returns {Promise<T | CoreError>}
 */
export async function lockedSnapshot(pool, locks, work, sleep, now) {
    /** @type {(db: Queryable) => Promise<{ commit: boolean, value: T | typeof LOCKED }>} */
    const attempt = async (db) => {
        try {
            for (const sql of locks) await db.query(sql);
            return { commit: false, value: await work(db) };
        } catch (err) {
            if (/** @type {any} */ (err)?.code === '55P03') return { commit: false, value: LOCKED };
            throw err;
        }
    };
    for (let tries = 1; ; tries += 1) {
        const began = now();
        const value = await transaction(pool, 'verifyCohort', attempt, { snapshot: true });
        if (value !== LOCKED) return /** @type {T | CoreError} */ (value);
        if (tries >= LOCK_RETRY.tries) return { error: 'A table stayed locked. Try again.', error_type: 'account_busy' };
        await sleep(Math.max(0, LOCK_RETRY.everyMs - (now() - began)));
    }
}

/**
 * A cohort and its live learners (in id order, the order every lock is taken in), in the caller's
 * transaction, whose snapshot has locked their two tables (CHECK_SQL.lockCohort, lockedSnapshot).
 * Errors are thrown, for transaction() to classify. null: no cohort.
 * @param {Queryable} db @param {string} cohortSlug
 * @returns {Promise<{ cohort: { id: string, startsOn: string | null, endsOn: string | null }, learners: string[] } | null>}
 */
export async function readCohort(db, cohortSlug) {
    const row = (await db.query(TRAINING_SQL.cohortBySlug, [cohortSlug])).rows?.[0];
    if (!row) return null;
    const cohort = { id: String(row.id), startsOn: row.starts_on ?? null, endsOn: row.ends_on ?? null };
    const learners = ((await db.query(TRAINING_TIME_SQL.learners, [cohort.id])).rows ?? []).map((r) => String(r.user_id)).sort();
    return { cohort, learners };
}

