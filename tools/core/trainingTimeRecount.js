// @ts-check
/**
 * Shared Business Logic — job training, recounts of closed study time days
 * (doc/brushup-2026/training-plan.ja.md §4.9; D12). Tables of server/migrations/022 and 023; the
 * check of each learner's rows is tools/core/trainingTimeCheck.js. Staff run it with
 * scripts/training-time.mjs --recompute.
 *
 * D12: when rules or a unit list change, finalized days change only when a staff member saw the
 * differences and confirmed them, and the old rows, who and why stay.
 *
 * A recount: other versions (rules, a unit list, or both) for the days from..to of a cohort. A
 * day's own versions are its current row's, so a recount never undoes an earlier one, and the
 * version not overridden stays the row's. Every later closed day of each learner is counted again
 * with its own versions and the new carry (each unit's set time counts across days). A day changes
 * when its versions or its values differ; only those get a 'recompute' row, which names the recount.
 * Refused before anything is written: a current row that does not check (unverified: report it,
 * recount nothing), a learner whose days up to `to` are not all closed (not_closed), `to` not final
 * under the override's gapMs (not_final; the day only, never an instant that would show a rule value),
 * a unit list of another course (course_differs).
 * The plan (its canonical JSON: the cohort, the days, the overrides, who and why, and every changed
 * day before and after) is named by its sha256. The dry run (planRecount) reads one snapshot and takes
 * no lock. The write (recountCohort) takes every live learner's account lock (shared) and training
 * lock, in id order, builds the plan again from statements sent after the locks (so no signal,
 * close, recount or deletion of theirs commits meanwhile), writes only when its sha256 is the one the
 * staff member confirmed, then appends the recount's record and its rows (only while each learner's
 * stub exists) in one transaction. The learners then see the new values, up or down.
 *
 * Failures return { error, error_type } (tools/core/dbErrors.js), never the driver's text.
 */
import crypto from 'node:crypto';
import { getPool } from '../../server/db.js';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { countingVersion } from '../../shared/training/countingVersions.js';
import { cohortRange, jstDayRange } from '../../shared/training/studyTime.js';
import { canonicalUserId } from './accountDeletions.js';
import { classifyDbError } from './dbErrors.js';
import { noDatabase } from './dbTransaction.js';
import { TRAINING_SQL } from './training.js';
import { TRAINING_TIME_SQL, parseSettings, transaction } from './trainingTime.js';
import {
    CHECK_SQL,
    INVALID_SETTING,
    catalogVersionOf,
    cohortFrom,
    countWith,
    currentRows,
    isoTime,
    liveLearners,
    readLearner,
    rulesVersionOf,
    sameUnits,
    verifyLearner,
} from './trainingTimeCheck.js';

/** @typedef {import('./dbTransaction.js').CoreError} CoreError */
/** @typedef {import('./training.js').TrainingPool} TrainingPool */
/** @typedef {import('./training.js').Queryable} Queryable */
/** @typedef {import('../../shared/training/studyTime.js').Range} Range */
/** @typedef {import('./trainingTimeCheck.js').Units} Units */
/** @typedef {import('./trainingTimeCheck.js').RulesVersion} RulesVersion */
/** @typedef {import('./trainingTimeCheck.js').CatalogVersion} CatalogVersion */
/** @typedef {import('./trainingTimeCheck.js').LearnerRecords} LearnerRecords */
/** @typedef {import('./trainingTimeCheck.js').Difference} Difference */

/** The statements, exactly as sent. $1 is the canonical account id or the cohort id. */
export const RECOUNT_SQL = Object.freeze({
    clock: 'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms',
    rulesBySha: 'SELECT id, sha256, algorithm, params FROM training_time_rule_sets WHERE sha256 = $1',
    catalogBySha: 'SELECT id, sha256, course_key, manifest FROM training_catalog_versions WHERE sha256 = $1',
    // The record of a recount a staff member confirmed. No learner's value (023).
    insertRecount: `INSERT INTO training_time_recomputes (cohort_id, from_day, to_day, rule_set_id, catalog_version_id, plan_sha256, recomputed_by, reason)
VALUES ($1::uuid, $2::date, $3::date, $4, $5, $6, $7, $8) RETURNING id`,
    // A learner's recount rows, in day order (the order their ids take), only while the stub exists;
    // computed_at is the default (the insert's clock), so a deletion's mark is never earlier.
    insertRecountDays: `INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
SELECT $1::uuid, $2::uuid, d.day, 'recompute', d.algorithm, d.rule_set_id, d.catalog_version_id, d.counted_ms, d.over_cap_ms, d.signals, d.evidence_sha256, $3, $4
  FROM unnest($5::date[], $6::text[], $7::bigint[], $8::bigint[], $9::integer[], $10::integer[], $11::integer[], $12::text[])
       WITH ORDINALITY AS d(day, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, ord)
 WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid)
 ORDER BY d.ord
RETURNING id, to_char(day, 'YYYY-MM-DD') AS day`,
    // Staff: a cohort's recounts (versions by sha256; never a rule value or a learner's value).
    cohortRecounts: `SELECT r.id, r.recomputed_at, r.recomputed_by, r.reason, to_char(r.from_day, 'YYYY-MM-DD') AS from_day, to_char(r.to_day, 'YYYY-MM-DD') AS to_day,
       y.sha256 AS rules_sha256, k.sha256 AS catalog_sha256, r.plan_sha256
  FROM training_time_recomputes r
  LEFT JOIN training_time_rule_sets y ON y.id = r.rule_set_id
  LEFT JOIN training_catalog_versions k ON k.id = r.catalog_version_id
 WHERE r.cohort_id = $1::uuid ORDER BY r.id`,
});

/** The format of a recount plan (its canonical JSON is what the staff member confirms by sha256). */
export const RECOUNT_PLAN = 'risepath.training-recount/v1';

const SHA256 = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} text */
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** Trimmed text of 1 to `max` characters, else null (the migrations' CHECKs). @param {unknown} value @param {number} max */
const textOf = (value, max) => {
    const text = String(value ?? '').trim();
    return text && Array.from(text).length <= max ? text : null;
};

/** @param {unknown} day */
const isDay = (day) => {
    if (typeof day !== 'string' || !DAY.test(day)) return false;
    try {
        jstDayRange(day);
        return true;
    } catch {
        return false;
    }
};

/**
 * @typedef {{ row: string, rules: string, catalog: string, countedMs: number, overCapMs: number, units: Units }} Before
 * @typedef {{ algorithm: string, rules: string, catalog: string, ruleSetId: string, catalogVersionId: string, countedMs: number, overCapMs: number,
 *   signals: number, evidenceSha256: string, units: Units }} After
 * @typedef {{ day: string, before: Before, after: After }} ChangedDay
 */

/**
 * One learner's changed days under a recount (the header): from `fromDay` (or the learner's first
 * row) to the last closed day, overridden versions inside fromDay..toDay, the rows' own elsewhere.
 * @param {{ records: LearnerRecords, fromDay: string, toDay: string, rules: RulesVersion | null, catalog: CatalogVersion | null, cohort: Range | null }} input
 * @returns {ChangedDay[] | { unknown: string }} unknown: a day this code cannot count with those versions
 */
export function recountLearner({ records, fromDay, toDay, rules, catalog, cohort }) {
    /** @type {ChangedDay[]} */
    const changed = [];
    /** @type {Map<string, number>} */
    let carried = new Map();
    for (const row of currentRows(records.rows)) {
        if (row.day < fromDay) {
            carried = new Map(carried);
            for (const [unit, countedMs] of row.units) carried.set(unit, (carried.get(unit) ?? 0) + countedMs);
            continue;
        }
        const inside = row.day <= toDay;
        const useRules = inside && rules ? rules : records.rules.get(row.ruleSetId);
        const useCatalog = inside && catalog ? catalog : records.catalogs.get(row.catalogVersionId);
        const counted = countWith({ day: row.day, rules: useRules, catalog: useCatalog, signals: records.signals, carriedMs: carried, cohort });
        if (!counted || !useRules || !useCatalog) return { unknown: row.day };
        carried = counted.carriedAfterMs;
        const sameVersions = useRules.id === row.ruleSetId && useCatalog.id === row.catalogVersionId;
        const sameValues = counted.countedMs === row.countedMs && counted.overCapMs === row.overCapMs && sameUnits(counted.units, row.units);
        if (sameVersions && sameValues) continue;
        changed.push({
            day: row.day,
            before: {
                row: row.id,
                rules: records.rules.get(row.ruleSetId)?.sha256 ?? row.ruleSetId,
                catalog: records.catalogs.get(row.catalogVersionId)?.sha256 ?? row.catalogVersionId,
                countedMs: row.countedMs,
                overCapMs: row.overCapMs,
                units: row.units,
            },
            after: {
                algorithm: counted.algorithm,
                rules: useRules.sha256,
                catalog: useCatalog.sha256,
                ruleSetId: useRules.id,
                catalogVersionId: useCatalog.id,
                countedMs: counted.countedMs,
                overCapMs: counted.overCapMs,
                signals: counted.signals,
                evidenceSha256: counted.evidenceSha256,
                units: counted.units,
            },
        });
    }
    return changed;
}

/**
 * @typedef {{ status: 'plan', sha256: string, plan: any, learners: Array<{ userId: string, days: ChangedDay[] }>, rulesId: string | null, catalogId: string | null }} RecountPlan
 * @typedef {{ status: 'no_cohort' | 'no_rules' | 'no_catalog' | 'outside_dates' | 'invalid_version' }
 *   | { status: 'not_final', day: string }
 *   | { status: 'course_differs', userId: string, day: string }
 *   | { status: 'not_closed', learners: string[] }
 *   | { status: 'unverified', learners: Array<{ userId: string, differences: Difference[] }> }
 *   | { status: 'unknown_version', userId: string, day: string }} RecountRefusal
 */

/**
 * The recount's input, checked before any statement.
 * @param {{ fromDay: unknown, toDay: unknown, rulesSha256: unknown, catalogSha256: unknown, recomputedBy: unknown, reason: unknown }} input
 * @returns {CoreError | { by: string, why: string, fromDay: string, toDay: string, rules: string | null, catalog: string | null }}
 */
function recountInput({ fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason }) {
    const by = textOf(recomputedBy, 100);
    const why = textOf(reason, 500);
    if (!by || !why) return { error: 'Who recounts takes 1 to 100 characters and the reason 1 to 500.', error_type: 'validation' };
    if (!isDay(fromDay) || !isDay(toDay) || String(fromDay) > String(toDay)) return { error: 'The days are YYYY-MM-DD, the first not after the last.', error_type: 'validation' };
    const rules = rulesSha256 === undefined || rulesSha256 === null ? null : String(rulesSha256);
    const catalog = catalogSha256 === undefined || catalogSha256 === null ? null : String(catalogSha256);
    if ((rules && !SHA256.test(rules)) || (catalog && !SHA256.test(catalog))) return { error: 'The rules and the unit list are named by their sha256 (64 lower-case hex digits).', error_type: 'validation' };
    if (!rules && !catalog) return { error: 'A recount takes other rules, another unit list, or both (by sha256).', error_type: 'validation' };
    return { by, why, fromDay: String(fromDay), toDay: String(toDay), rules, catalog };
}

/**
 * Build the plan in the caller's transaction (the dry run's snapshot, or the write's locks): the
 * refusals and the changed days of the header, and the plan's canonical JSON and sha256.
 * @param {Queryable} db
 * @param {{ cohort: { id: string, startsOn: string | null, endsOn: string | null }, learners: string[], fromDay: string, toDay: string,
 *   rules: string | null, catalog: string | null, by: string, why: string }} input
 * @returns {Promise<RecountPlan | RecountRefusal | CoreError>}
 */
async function buildPlan(db, { cohort, learners, fromDay, toDay, rules: rulesSha, catalog: catalogSha, by, why }) {
    if (!cohort.startsOn || !cohort.endsOn || fromDay < cohort.startsOn || toDay > cohort.endsOn) return { status: 'outside_dates' };
    const settings = parseSettings((await db.query(TRAINING_TIME_SQL.closeSettings, [cohort.id])).rows ?? []);
    if (!settings) return { ...INVALID_SETTING };
    /** @type {RulesVersion | null} */
    let rules = null;
    if (rulesSha) {
        const row = (await db.query(RECOUNT_SQL.rulesBySha, [rulesSha])).rows?.[0];
        if (!row) return { status: 'no_rules' };
        rules = rulesVersionOf(row);
        if (!rules.rules || !countingVersion(rules.rules.algorithm)) return { status: 'invalid_version' };
    }
    /** @type {CatalogVersion | null} */
    let catalog = null;
    if (catalogSha) {
        const row = (await db.query(RECOUNT_SQL.catalogBySha, [catalogSha])).rows?.[0];
        if (!row) return { status: 'no_catalog' };
        catalog = catalogVersionOf(row);
        if (!catalog.setMs) return { status: 'invalid_version' };
    }
    const nowMs = Number((await db.query(RECOUNT_SQL.clock)).rows?.[0]?.now_ms);
    // Final under the override's gapMs too (the days' own rules made them final when they closed).
    // The refusal names the day only: an instant would show a rule value (D9).
    if (rules?.rules && !(nowMs > jstDayRange(toDay).end + rules.rules.counting.gapMs)) return { status: 'not_final', day: toDay };
    const range = cohortRange(cohort.startsOn, cohort.endsOn);
    /** @type {string[]} */
    const notClosed = [];
    /** @type {Array<{ userId: string, differences: Difference[] }>} */
    const unverified = [];
    /** @type {Array<{ userId: string, days: ChangedDay[] }>} */
    const changed = [];
    for (const userId of learners) {
        const state = (await db.query(TRAINING_TIME_SQL.closeState, [userId, cohort.id])).rows?.[0];
        if (!state?.stub || !state.added_on) continue;
        const firstDay = [String(state.added_on), settings[0]?.effectiveFrom ?? String(cohort.startsOn), String(cohort.startsOn)].sort().at(-1) ?? String(cohort.startsOn);
        if (firstDay > toDay) continue;
        const lastClosed = state.last_closed ? String(state.last_closed) : null;
        if (!lastClosed || lastClosed < toDay) {
            notClosed.push(userId);
            continue;
        }
        const records = await readLearner(db, userId, cohort.id, rules ? [rules] : []);
        const checked = verifyLearner({ records, settings, cohortId: cohort.id, cohort: range });
        if (checked.differences.length) {
            unverified.push({ userId, differences: checked.differences });
            continue;
        }
        if (catalog) {
            for (const row of currentRows(records.rows)) {
                const own = records.catalogs.get(row.catalogVersionId);
                if (row.day >= fromDay && row.day <= toDay && own && own.courseKey !== catalog.courseKey) return { status: 'course_differs', userId, day: row.day };
            }
        }
        const days = recountLearner({ records, fromDay, toDay, rules, catalog, cohort: range });
        if ('unknown' in days) return { status: 'unknown_version', userId, day: days.unknown };
        if (days.length) changed.push({ userId, days });
    }
    if (notClosed.length) return { status: 'not_closed', learners: notClosed };
    if (unverified.length) return { status: 'unverified', learners: unverified };
    const plan = {
        plan: RECOUNT_PLAN,
        cohort: cohort.id,
        from: fromDay,
        to: toDay,
        rules: rules?.sha256 ?? null,
        catalog: catalog?.sha256 ?? null,
        by,
        reason: why,
        learners: changed.map((l) => ({
            user: l.userId,
            days: l.days.map((d) => ({
                day: d.day,
                before: d.before,
                after: { algorithm: d.after.algorithm, rules: d.after.rules, catalog: d.after.catalog, countedMs: d.after.countedMs, overCapMs: d.after.overCapMs, signals: d.after.signals, evidence: d.after.evidenceSha256, units: d.after.units },
            })),
        })),
    };
    return { status: 'plan', sha256: sha256(canonicalJson(plan)), plan, learners: changed, rulesId: rules?.id ?? null, catalogId: catalog?.id ?? null };
}

/**
 * Staff: the dry run of a recount (the header): one snapshot, no lock, nothing written.
 * @param {{ cohortSlug: string, fromDay: unknown, toDay: unknown, rulesSha256?: unknown, catalogSha256?: unknown, recomputedBy: unknown, reason: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<RecountPlan | RecountRefusal | CoreError>}
 */
export async function planRecount({ cohortSlug, fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason, pool = getPool() }) {
    const input = recountInput({ fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason });
    if ('error_type' in input) return input;
    const cohort = await cohortFrom(pool, cohortSlug);
    if (!cohort) return { status: 'no_cohort' };
    if ('error_type' in cohort) return cohort;
    return transaction(pool, 'planRecount', async (db) => {
        const learners = await liveLearners(db, cohort.id);
        if ('error_type' in learners) return { commit: false, value: learners };
        return { commit: false, value: await buildPlan(db, { cohort, learners, ...input }) };
    }, { snapshot: true });
}

/**
 * Staff: write a recount whose plan has the sha256 the staff member confirmed (the header).
 * @param {{ cohortSlug: string, fromDay: unknown, toDay: unknown, rulesSha256?: unknown, catalogSha256?: unknown, recomputedBy: unknown, reason: unknown, expect: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'recounted', id: string, learners: number, days: number, sha256: string } | { status: 'unchanged', sha256: string }
 *   | { status: 'plan_changed', sha256: string } | RecountRefusal | CoreError>}
 */
export async function recountCohort({ cohortSlug, fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason, expect, pool = getPool() }) {
    const input = recountInput({ fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason });
    if ('error_type' in input) return input;
    if (!SHA256.test(String(expect))) return { error: 'The plan is named by its sha256 (64 lower-case hex digits) from the dry run.', error_type: 'validation' };
    const cohort = await cohortFrom(pool, cohortSlug);
    if (!cohort) return { status: 'no_cohort' };
    if ('error_type' in cohort) return cohort;
    return transaction(pool, 'recountCohort', async (db) => {
        /** @param {any} value */
        const refuse = (value) => ({ commit: false, value });
        const learners = await liveLearners(db, cohort.id);
        if ('error_type' in learners) return refuse(learners);
        // Every live learner's locks, in id order (as one close each would take them), before the
        // plan is built again: none of their signals, closes, recounts or deletions commits meanwhile.
        for (const userId of learners) {
            await db.query(TRAINING_SQL.lock, [userId]);
            await db.query(TRAINING_SQL.learnerLock, [userId]);
        }
        const built = await buildPlan(db, { cohort, learners, ...input });
        if ('error_type' in built || built.status !== 'plan') return refuse(built);
        const plan = /** @type {RecountPlan} */ (built);
        if (plan.sha256 !== expect) return refuse({ status: 'plan_changed', sha256: plan.sha256 });
        if (!plan.learners.length) return refuse({ status: 'unchanged', sha256: plan.sha256 });
        const record = (await db.query(RECOUNT_SQL.insertRecount, [cohort.id, input.fromDay, input.toDay, plan.rulesId, plan.catalogId, plan.sha256, input.by, input.why])).rows?.[0];
        if (!record) return refuse({ error: 'The recount could not be written.', error_type: 'unknown' });
        let days = 0;
        for (const learner of plan.learners) {
            const d = learner.days;
            const written = (await db.query(RECOUNT_SQL.insertRecountDays, [
                learner.userId, cohort.id, input.by, String(record.id),
                d.map((x) => x.day), d.map((x) => x.after.algorithm), d.map((x) => x.after.ruleSetId), d.map((x) => x.after.catalogVersionId),
                d.map((x) => x.after.countedMs), d.map((x) => x.after.overCapMs), d.map((x) => x.after.signals), d.map((x) => x.after.evidenceSha256),
            ])).rows ?? [];
            // Under the learner's locks the stub stays: anything but every day written is a fault.
            if (written.length !== d.length) return refuse({ error: 'The recount could not be written.', error_type: 'unknown' });
            const idOf = new Map(written.map((r) => [String(r.day), String(r.id)]));
            const units = d.flatMap((x) => x.after.units.map(([unit, countedMs, overCapMs]) => ({ id: idOf.get(x.day), unit, countedMs, overCapMs })));
            if (units.length) {
                await db.query(TRAINING_TIME_SQL.insertUnitDays, [units.map((u) => u.id), units.map((u) => u.unit), units.map((u) => u.countedMs), units.map((u) => u.overCapMs)]);
            }
            days += d.length;
        }
        return { commit: true, value: { status: 'recounted', id: String(record.id), learners: plan.learners.length, days, sha256: plan.sha256 } };
    });
}

/**
 * Staff: a cohort's recounts, oldest first (versions by sha256; never a rule or learner value).
 * @param {{ cohortId: string, pool?: TrainingPool | null }} params
 */
export async function cohortRecounts({ cohortId, pool = getPool() }) {
    if (!pool) return noDatabase();
    try {
        return ((await pool.query(RECOUNT_SQL.cohortRecounts, [cohortId])).rows ?? []).map((r) => ({
            id: String(r.id),
            recomputedAt: isoTime(r.recomputed_at),
            recomputedBy: String(r.recomputed_by),
            reason: String(r.reason),
            fromDay: String(r.from_day),
            toDay: String(r.to_day),
            rulesSha256: r.rules_sha256 ? String(r.rules_sha256) : null,
            catalogSha256: r.catalog_sha256 ? String(r.catalog_sha256) : null,
            planSha256: String(r.plan_sha256),
        }));
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'cohortRecounts');
    }
}

/**
 * Staff: a learner's live day rows of a cohort, every row of every day (the current one last), so
 * the earlier values and the recount that wrote a row show.
 * @param {{ userId: unknown, cohortId: string, pool?: TrainingPool | null }} params
 */
export async function learnerHistory({ userId: rawUserId, cohortId, pool = getPool() }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return { error: 'An account id (a UUID) is required.', error_type: 'validation' };
    if (!pool) return noDatabase();
    try {
        return ((await pool.query(CHECK_SQL.learnerRows, [userId, cohortId])).rows ?? []).map((r) => ({
            id: String(r.id),
            day: String(r.day),
            kind: String(r.kind),
            countedMs: Number(r.counted_ms),
            overCapMs: Number(r.over_cap_ms),
            recomputeId: r.recompute_id === null || r.recompute_id === undefined ? null : String(r.recompute_id),
            computedAt: isoTime(r.computed_at),
            computedBy: String(r.computed_by),
        }));
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'learnerHistory');
    }
}
