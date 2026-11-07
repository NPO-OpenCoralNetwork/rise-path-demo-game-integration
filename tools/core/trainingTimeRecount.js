// @ts-check
/**
 * Shared Business Logic — job training, recounts of closed study time days
 * (doc/brushup-2026/training-plan.ja.md §4.9; D12). Tables of server/migrations/022 and 023; each
 * learner's rows are checked and counted with tools/core/trainingTimeCheck.js. Staff run it with
 * scripts/training-time.mjs --recompute.
 *
 * D12: when rules or a unit list change, finalized days change only when a staff member saw the
 * differences and confirmed them, and the old rows, who and why stay.
 *
 * A recount: other versions (rules, a unit list, or both) for the days from..to of a cohort. A day's
 * own versions are its current row's, so a recount never undoes an earlier one, and the version not
 * overridden stays the row's. Every later closed day of each learner is counted again with its own
 * versions and the new carry (each unit's set time counts across days). A day changes when its
 * versions or its values (each unit's too) differ; only those get a 'recompute' row, which names the
 * recount's record. Refused before anything is written, in this order: no cohort, no dates, days
 * outside them; an override not loaded or not countable with this code (invalid_version: the rule
 * countWith applies); a stored setting that does not parse; `to` not final under the wider of the
 * override's gapMs and its setting's (not_final: the day only, never an instant, which would show a
 * rule value, D9); then, once every learner was read: a current row that does not check (unverified:
 * report it, recount nothing), a learner whose days up to `to` are not all closed (not_closed), a
 * unit list of another course than a day's own (course_differs: the day).
 *
 * The plan (its canonical JSON: the cohort, the days, the overrides, who and why, and every changed
 * day before and after; units as [key, counted, over] in code-unit order) is named by its sha256. The
 * dry run (planRecount) reads as --verify does, nothing written and no advisory lock: a snapshot of
 * the cohort, its learners, the overrides, its settings and the database clock, then one snapshot per
 * learner, each locking the tables it reads first, without waiting (lockedSnapshot). A learner's part
 * of the plan depends only on that learner's rows and evidence and on rows that never change (the
 * versions, the recount records) or are only added for days to come (the settings).
 * The write (recountCohort) runs the dry run again and goes on only when the plan's sha256 is the one
 * the staff member confirmed (else plan_changed) and something changes. Then one short READ COMMITTED
 * transaction, whose lock waits end after 20 ms: each learner the plan counted, in id order, its
 * account lock (shared) and its training lock (no signal, close, recount or deletion of theirs commits
 * until it ends); the tables it writes, references and reads, locked without waiting, and their
 * indexes; each of those learners' live row ids and evidence count read again, refused as
 * plan_changed when any differs from the dry run's (day rows are only appended, and a deletion marks
 * them); then the record and each changed learner's rows (only while the stub exists) and unit rows.
 * A lock wait over 20 ms, or a table a migration holds, rolls it back, holding nothing, and it tries
 * again as the check does (LOCK_RETRY: about 10 s, then account_busy). The learners then see the new
 * values, up or down.
 *
 * Failures return { error, error_type } (tools/core/dbErrors.js), never the driver's text.
 */
import { getPool } from '../../server/db.js';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { cohortRange, jstDayRange } from '../../shared/training/studyTime.js';
import { canonicalUserId } from './accountDeletions.js';
import { classifyDbError } from './dbErrors.js';
import { noDatabase } from './dbTransaction.js';
import { TRAINING_SQL, isCalendarDate } from './training.js';
import { SHA256, TRAINING_TIME_SQL, openFrom, parseSettings, settingOf, sha256, textOf } from './trainingTime.js';
import {
    CHECK_SQL,
    INVALID_SETTING,
    LEARNER_TABLES,
    catalogVersionOf,
    countWith,
    currentRows,
    isoTime,
    lockList,
    lockedSnapshot,
    lockedTry,
    readCohort,
    readLearner,
    rulesCause,
    rulesVersionOf,
    sameUnits,
    verifyLearner,
} from './trainingTimeCheck.js';

/** @typedef {import('./dbTransaction.js').CoreError} CoreError */
/** @typedef {import('./training.js').TrainingPool} TrainingPool */
/** @typedef {import('./training.js').Queryable} Queryable */
/** @typedef {import('./trainingTime.js').Setting} Setting */
/** @typedef {import('../../shared/training/studyTime.js').Range} Range */
/** @typedef {import('./trainingTimeCheck.js').Units} Units */
/** @typedef {import('./trainingTimeCheck.js').RulesVersion} RulesVersion */
/** @typedef {import('./trainingTimeCheck.js').CatalogVersion} CatalogVersion */
/** @typedef {import('./trainingTimeCheck.js').LearnerRecords} LearnerRecords */
/** @typedef {import('./trainingTimeCheck.js').Difference} Difference */

/** The tables the write locks: those it inserts into, those their foreign keys reference, those it reads. */
const WRITTEN_TABLES = 'training_time_days, training_time_unit_days, training_time_recomputes';
const REFERENCED_TABLES = 'training_cohorts, training_time_rule_sets, training_catalog_versions';
const READ_TABLES = 'training_time_streams, training_time_signals, auth.users';

/** The statements, exactly as sent. $1 is the canonical account id or the cohort id. */
export const RECOUNT_SQL = Object.freeze({
    // The database clock in whole epoch milliseconds (whether `to` is final), once, in the dry run's first snapshot.
    clock: 'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms',
    rulesBySha: 'SELECT id, sha256, algorithm, params FROM training_time_rule_sets WHERE sha256 = $1',
    catalogBySha: 'SELECT id, sha256, course_key, manifest FROM training_catalog_versions WHERE sha256 = $1',
    // The Japan-time day a live learner membership was added (closeState's expression; no row: not a learner).
    learnerMember: `SELECT to_char((m.added_at AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS added_on FROM training_memberships m
 WHERE m.user_id = $1::uuid AND m.cohort_id = $2::uuid AND m.role = 'learner' AND m.account_deleted_at IS NULL`,
    // The write's tables, after the learners' locks, without waiting: the modes its inserts take on
    // what they write (ROW EXCLUSIVE) and their foreign keys on what they reference (ROW SHARE), and
    // ACCESS SHARE on what it reads; then a read of no rows of all of them (it locks every index).
    // These modes conflict with a migration's DDL, REINDEX and CREATE INDEX only.
    lockWritten: `LOCK TABLE ${WRITTEN_TABLES} IN ROW EXCLUSIVE MODE NOWAIT`,
    lockReferenced: `LOCK TABLE ${REFERENCED_TABLES} IN ROW SHARE MODE NOWAIT`,
    lockRead: `LOCK TABLE ${READ_TABLES} IN ACCESS SHARE MODE NOWAIT`,
    indexesWrite: `SELECT 1 FROM ${WRITTEN_TABLES}, ${REFERENCED_TABLES}, ${READ_TABLES} LIMIT 0`,
    // A learner's live day rows (ids in day and id order) and the count of the evidence the dry run
    // read (the same statement, $3..$6 its days and instants): under the learner's locks, the same ids
    // and count mean the same rows and signals (rows and signals are only appended; a deletion marks).
    fingerprint: `SELECT (SELECT coalesce(array_agg(id::text ORDER BY day, id), '{}') FROM training_time_days
         WHERE user_id = $1::uuid AND cohort_id = $2::uuid AND account_deleted_at IS NULL) AS day_ids,
       (SELECT count(*) FROM (${TRAINING_TIME_SQL.evidence}) e) AS evidence`,
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

/**
 * The statements that start each try, before its reads or writes: the dry run's first snapshot (the
 * cohort and its learners, the overrides, the settings, the clock), each learner's (the membership,
 * the settings, readLearner), a learner's history; the write's, after the learners' locks.
 */
export const RECOUNT_LOCKS = Object.freeze({
    head: lockList('training_cohorts, training_memberships, training_cohort_time_settings, training_time_rule_sets, training_catalog_versions'),
    learner: lockList(`training_memberships, ${LEARNER_TABLES}`),
    history: lockList('training_time_days, training_time_unit_days'),
    write: Object.freeze([RECOUNT_SQL.lockWritten, RECOUNT_SQL.lockReferenced, RECOUNT_SQL.lockRead, RECOUNT_SQL.indexesWrite]),
});

/** The format of a recount plan (its canonical JSON is what the staff member confirms by sha256). */
export const RECOUNT_PLAN = 'risepath.training-recount/v1';

/** A fault the checks before it rule out: nothing is written. */
const FAULT = Object.freeze({ error: 'The recount could not be written.', error_type: 'unknown' });

/**
 * @typedef {{ row: string, rules: string | null, catalog: string | null, countedMs: number, overCapMs: number, units: Units }} Before
 * @typedef {{ algorithm: string, rules: string, catalog: string, ruleSetId: string, catalogVersionId: string, countedMs: number, overCapMs: number,
 *   signals: number, evidenceSha256: string, units: Units }} After
 * @typedef {{ day: string, before: Before, after: After }} ChangedDay
 */

/**
 * One learner's changed days under a recount (the header): from `fromDay` to the last closed day,
 * the overridden versions inside fromDay..toDay and the rows' own elsewhere, each unit's time carried
 * from the stored rows before fromDay, then from the new values.
 * @param {{ records: LearnerRecords, fromDay: string, toDay: string, rules: RulesVersion | null, catalog: CatalogVersion | null, cohort: Range | null }} input
 * @returns {ChangedDay[] | null} null: a day this code cannot count with those versions (the checks
 *   before it rule that out)
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
        if (!counted || !useRules || !useCatalog) return null;
        carried = counted.carriedAfterMs;
        const sameVersions = useRules.id === row.ruleSetId && useCatalog.id === row.catalogVersionId;
        const sameValues = counted.countedMs === row.countedMs && counted.overCapMs === row.overCapMs && sameUnits(counted.units, row.units);
        if (sameVersions && sameValues) continue;
        changed.push({
            day: row.day,
            before: {
                row: row.id,
                rules: records.rules.get(row.ruleSetId)?.sha256 ?? null,
                catalog: records.catalogs.get(row.catalogVersionId)?.sha256 ?? null,
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
 * @typedef {{ status: 'no_cohort' | 'no_dates' | 'outside_dates' | 'no_rules' | 'no_catalog' }
 *   | { status: 'invalid_version', which: 'rules' | 'catalog', cause: 'unknown' | 'rules_row' | 'unparsed' }
 *   | { status: 'not_final', day: string }
 *   | { status: 'unverified', learners: Array<{ userId: string, differences: Difference[] }> }
 *   | { status: 'not_closed', learners: string[] }
 *   | { status: 'course_differs', day: string }} RecountRefusal
 * @typedef {{ status: 'plan', sha256: string, plan: any, learners: Array<{ userId: string, days: ChangedDay[] }> }} RecountPlan
 * @typedef {{ cohortId: string, rulesId: string | null, catalogId: string | null,
 *   locked: Array<{ userId: string, dayIds: string[], signals: number, evidence: NonNullable<LearnerRecords['evidence']> }> }} WriteBasis
 *   locked: each learner the plan counted, with what its snapshot read (the write reads it again)
 * @typedef {{ fromDay: string, toDay: string, rules: string | null, catalog: string | null, by: string, why: string }} RecountInput
 */

/**
 * The recount's input, checked before any statement.
 * @param {{ fromDay: unknown, toDay: unknown, rulesSha256: unknown, catalogSha256: unknown, recomputedBy: unknown, reason: unknown }} input
 * @returns {CoreError | RecountInput}
 */
function recountInput({ fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason }) {
    const by = textOf(recomputedBy, 100);
    const why = textOf(reason, 500);
    if (!by || !why) return { error: 'Who recounts takes 1 to 100 characters and the reason 1 to 500.', error_type: 'validation' };
    if (!isCalendarDate(fromDay) || !isCalendarDate(toDay) || String(fromDay) > String(toDay)) return { error: 'The days are YYYY-MM-DD, the first not after the last.', error_type: 'validation' };
    const rules = rulesSha256 === undefined || rulesSha256 === null ? null : String(rulesSha256);
    const catalog = catalogSha256 === undefined || catalogSha256 === null ? null : String(catalogSha256);
    if ((rules !== null && !SHA256.test(rules)) || (catalog !== null && !SHA256.test(catalog))) return { error: 'The rules and the unit list are named by their sha256 (64 lower-case hex digits).', error_type: 'validation' };
    if (rules === null && catalog === null) return { error: 'A recount takes other rules, another unit list, or both (by sha256).', error_type: 'validation' };
    return { fromDay: String(fromDay), toDay: String(toDay), rules, catalog, by, why };
}

/**
 * The dry run's first snapshot, whose tables RECOUNT_LOCKS.head locked: the cohort and its live
 * learners (in id order), the overrides (null: not asked for, or none has that sha256), the cohort's
 * settings (null when one does not parse) and the database clock. null: no cohort.
 * @param {Queryable} db @param {string} cohortSlug @param {{ rules: string | null, catalog: string | null }} shas
 */
export async function readRecountHead(db, cohortSlug, { rules, catalog }) {
    const read = await readCohort(db, cohortSlug);
    if (!read) return null;
    const rulesRow = rules ? (await db.query(RECOUNT_SQL.rulesBySha, [rules])).rows?.[0] : undefined;
    const catalogRow = catalog ? (await db.query(RECOUNT_SQL.catalogBySha, [catalog])).rows?.[0] : undefined;
    const settings = parseSettings((await db.query(TRAINING_TIME_SQL.closeSettings, [read.cohort.id])).rows ?? []);
    const nowMs = Number((await db.query(RECOUNT_SQL.clock)).rows?.[0]?.now_ms);
    return {
        ...read,
        rules: rulesRow ? rulesVersionOf(rulesRow) : null,
        catalog: catalogRow ? catalogVersionOf(catalogRow) : null,
        settings,
        nowMs,
    };
}

/**
 * One learner's snapshot, whose tables RECOUNT_LOCKS.learner locked: the cohort's settings and every
 * live row with its versions, recounts and evidence (readLearner, the override's window included).
 * null: nothing up to `toDay` counts for the learner (no live learner membership, no setting, or the
 * first day that counts after it), so the recount skips it.
 * @param {Queryable} db
 * @param {{ userId: string, cohort: { id: string, startsOn: string }, toDay: string, rules: RulesVersion | null }} input
 * @returns {Promise<{ settings: Setting[], records: LearnerRecords } | null | CoreError>}
 */
export async function readRecountLearner(db, { userId, cohort, toDay, rules }) {
    const added = (await db.query(RECOUNT_SQL.learnerMember, [userId, cohort.id])).rows?.[0]?.added_on;
    if (added === undefined || added === null) return null;
    const settings = parseSettings((await db.query(TRAINING_TIME_SQL.closeSettings, [cohort.id])).rows ?? []);
    if (!settings) return { ...INVALID_SETTING };
    if (!settings.length || openFrom({ addedOn: String(added), firstSetting: settings[0].effectiveFrom, startsOn: cohort.startsOn, lastClosed: null }).first > toDay) return null;
    return { settings, records: await readLearner(db, userId, cohort.id, rules ? [rules] : []) };
}

/**
 * One learner's part of a recount, after its snapshot (pure): differences the check finds; not
 * closed up to `toDay`; the first day from..toDay whose own unit list is of another course than the
 * override; else the changed days (null: a day that cannot be counted, which the checks rule out).
 * @param {{ settings: Setting[], records: LearnerRecords, cohort: { id: string, startsOn: string, endsOn: string },
 *   fromDay: string, toDay: string, rules: RulesVersion | null, catalog: CatalogVersion | null }} input
 * @returns {{ differences: Difference[] } | { notClosed: true } | { courseDay: string } | { days: ChangedDay[] | null }}
 */
export function planEntry({ settings, records, cohort, fromDay, toDay, rules, catalog }) {
    const range = cohortRange(cohort.startsOn, cohort.endsOn);
    const checked = verifyLearner({ records, settings, cohortId: cohort.id, cohort: range });
    if (checked.differences.length) return { differences: checked.differences };
    const lastClosed = records.rows.filter((r) => r.kind === 'close').at(-1)?.day ?? null;
    if (!lastClosed || lastClosed < toDay) return { notClosed: true };
    if (catalog) {
        for (const row of currentRows(records.rows)) {
            const own = records.catalogs.get(row.catalogVersionId);
            if (row.day >= fromDay && row.day <= toDay && own && own.courseKey !== catalog.courseKey) return { courseDay: row.day };
        }
    }
    return { days: recountLearner({ records, fromDay, toDay, rules, catalog, cohort: range }) };
}

/**
 * The plan's canonical JSON (what the sha256 names): plain data only.
 * @param {{ cohortId: string, input: RecountInput, rules: RulesVersion | null, catalog: CatalogVersion | null, changed: Array<{ userId: string, days: ChangedDay[] }> }} parts
 */
function planOf({ cohortId, input, rules, catalog, changed }) {
    return {
        plan: RECOUNT_PLAN,
        cohort: cohortId,
        from: input.fromDay,
        to: input.toDay,
        rules: rules?.sha256 ?? null,
        catalog: catalog?.sha256 ?? null,
        by: input.by,
        reason: input.why,
        learners: changed.map((l) => ({
            user: l.userId,
            days: l.days.map((d) => ({
                day: d.day,
                before: { row: d.before.row, rules: d.before.rules, catalog: d.before.catalog, countedMs: d.before.countedMs, overCapMs: d.before.overCapMs, units: d.before.units },
                after: {
                    algorithm: d.after.algorithm, rules: d.after.rules, catalog: d.after.catalog, countedMs: d.after.countedMs, overCapMs: d.after.overCapMs,
                    signals: d.after.signals, evidence: d.after.evidenceSha256, units: d.after.units,
                },
            })),
        })),
    };
}

/**
 * The dry run (the header), for planRecount and recountCohort alike: the plan and, for the write, what
 * each learner's snapshot read.
 * @param {{ pool: TrainingPool | null | undefined, cohortSlug: string, input: RecountInput, operation: string,
 *   sleep?: (ms: number) => Promise<void>, now?: () => number }} params
 * @returns {Promise<(RecountPlan & WriteBasis) | RecountRefusal | CoreError>}
 */
async function buildPlan({ pool, cohortSlug, input, operation, sleep, now }) {
    const head = await lockedSnapshot(pool, RECOUNT_LOCKS.head, (db) => readRecountHead(db, cohortSlug, input), sleep, now, operation);
    if (!head) return { status: 'no_cohort' };
    if ('error_type' in head) return head;
    const { cohort, rules, catalog, settings } = head;
    if (!cohort.startsOn || !cohort.endsOn) return { status: 'no_dates' };
    if (input.fromDay < cohort.startsOn || input.toDay > cohort.endsOn) return { status: 'outside_dates' };
    if (input.rules && !rules) return { status: 'no_rules' };
    if (input.catalog && !catalog) return { status: 'no_catalog' };
    const cause = rules ? rulesCause(rules) : null;
    if (cause) return { status: 'invalid_version', which: 'rules', cause };
    if (catalog && !catalog.setMs) return { status: 'invalid_version', which: 'catalog', cause: 'unparsed' };
    if (!settings) return { ...INVALID_SETTING };
    // Final under the override's gapMs and under its setting's (the days' own rules made them final
    // when they closed). The refusal names the day only: an instant would show a rule value (D9).
    const gapMs = Math.max(rules?.rules?.counting.gapMs ?? 0, settingOf(settings, input.toDay)?.rules.counting.gapMs ?? 0);
    if (!(head.nowMs > jstDayRange(input.toDay).end + gapMs)) return { status: 'not_final', day: input.toDay };
    const dated = { id: cohort.id, startsOn: cohort.startsOn, endsOn: cohort.endsOn };
    /** @type {Array<{ userId: string, differences: Difference[] }>} */
    const unverified = [];
    /** @type {string[]} */
    const notClosed = [];
    /** @type {string | null} */
    let courseDay = null;
    /** @type {Array<{ userId: string, days: ChangedDay[] }>} */
    const changed = [];
    /** @type {WriteBasis['locked']} */
    const locked = [];
    for (const userId of head.learners) {
        const read = await lockedSnapshot(pool, RECOUNT_LOCKS.learner, (db) => readRecountLearner(db, { userId, cohort: dated, toDay: input.toDay, rules }), sleep, now, operation);
        if (!read) continue;
        if ('error_type' in read) return read;
        const entry = planEntry({ ...read, cohort: dated, fromDay: input.fromDay, toDay: input.toDay, rules, catalog });
        if ('differences' in entry) unverified.push({ userId, differences: entry.differences });
        else if ('notClosed' in entry) notClosed.push(userId);
        else if ('courseDay' in entry) courseDay = courseDay === null || entry.courseDay < courseDay ? entry.courseDay : courseDay;
        else if (!entry.days) return { ...FAULT };
        else if (entry.days.length) changed.push({ userId, days: entry.days });
        const { records } = read;
        if (records.evidence) locked.push({ userId, dayIds: records.rows.map((r) => r.id), signals: records.signals.length, evidence: records.evidence });
    }
    if (unverified.length) return { status: 'unverified', learners: unverified };
    if (notClosed.length) return { status: 'not_closed', learners: notClosed };
    if (courseDay !== null) return { status: 'course_differs', day: courseDay };
    const plan = planOf({ cohortId: cohort.id, input, rules, catalog, changed });
    return { status: 'plan', sha256: sha256(canonicalJson(plan)), plan, learners: changed, cohortId: cohort.id, rulesId: rules?.id ?? null, catalogId: catalog?.id ?? null, locked };
}

/**
 * Staff: the dry run of a recount (the header): nothing written, no advisory lock.
 * @param {{ cohortSlug: string, fromDay: unknown, toDay: unknown, rulesSha256?: unknown, catalogSha256?: unknown, recomputedBy: unknown, reason: unknown,
 *   pool?: TrainingPool | null, sleep?: (ms: number) => Promise<void>, now?: () => number }} params
 *   sleep and now: as verifyCohort's (the tries for the read locks)
 * @returns {Promise<RecountPlan | RecountRefusal | CoreError>}
 */
export async function planRecount({ cohortSlug, fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason, pool = getPool(), sleep, now }) {
    const input = recountInput({ fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason });
    if ('error_type' in input) return input;
    const built = await buildPlan({ pool, cohortSlug, input, operation: 'planRecount', sleep, now });
    if ('error_type' in built || built.status !== 'plan') return built;
    return { status: 'plan', sha256: built.sha256, plan: built.plan, learners: built.learners };
}

/**
 * Staff: write a recount whose plan has the sha256 the staff member confirmed (the header).
 * @param {{ cohortSlug: string, fromDay: unknown, toDay: unknown, rulesSha256?: unknown, catalogSha256?: unknown, recomputedBy: unknown, reason: unknown, expect: unknown,
 *   pool?: TrainingPool | null, sleep?: (ms: number) => Promise<void>, now?: () => number }} params
 * @returns {Promise<{ status: 'recounted', id: string, learners: number, days: number, sha256: string } | { status: 'unchanged', sha256: string }
 *   | { status: 'plan_changed' } | RecountRefusal | CoreError>} CoreError 'account_busy' when a lock stayed held for about 10 s
 */
export async function recountCohort({ cohortSlug, fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason, expect, pool = getPool(), sleep, now }) {
    const input = recountInput({ fromDay, toDay, rulesSha256, catalogSha256, recomputedBy, reason });
    if ('error_type' in input) return input;
    if (!SHA256.test(String(expect))) return { error: 'The plan is named by its sha256 (64 lower-case hex digits) from the dry run.', error_type: 'validation' };
    const built = await buildPlan({ pool, cohortSlug, input, operation: 'recountCohort', sleep, now });
    if ('error_type' in built || built.status !== 'plan') return built;
    const plan = /** @type {RecountPlan & WriteBasis} */ (built);
    if (plan.sha256 !== expect) return { status: 'plan_changed' };
    if (!plan.learners.length) return { status: 'unchanged', sha256: plan.sha256 };
    return lockedTry(pool, 'recountCohort', (db) => writeLocked(db, plan, input), { sleep, now });
}

/**
 * The write's transaction (the header), after BEGIN and TRAINING_SQL.lockTimeout: the 20 ms lock
 * timeout, the learners' locks, the tables' locks, each learner's rows and evidence count compared
 * with the dry run's, then the inserts.
 * @param {Queryable} db @param {RecountPlan & WriteBasis} plan @param {RecountInput} input
 * @returns {Promise<{ commit: boolean, value: { status: 'recounted', id: string, learners: number, days: number, sha256: string } | { status: 'plan_changed' } | CoreError }>}
 */
async function writeLocked(db, plan, input) {
    /** @param {{ status: 'plan_changed' } | CoreError} value */
    const refuse = (value) => ({ commit: false, value });
    await db.query(CHECK_SQL.tryLockTimeout);
    for (const { userId } of plan.locked) {
        await db.query(TRAINING_SQL.lock, [userId]);
        await db.query(TRAINING_SQL.learnerLock, [userId]);
    }
    for (const sql of RECOUNT_LOCKS.write) await db.query(sql);
    for (const l of plan.locked) {
        const row = (await db.query(RECOUNT_SQL.fingerprint, [l.userId, plan.cohortId, l.evidence.first, l.evidence.last, l.evidence.from, l.evidence.to])).rows?.[0];
        const dayIds = Array.isArray(row?.day_ids) ? row.day_ids.map(String) : [];
        if (canonicalJson(dayIds) !== canonicalJson(l.dayIds) || Number(row?.evidence) !== l.signals) return refuse({ status: 'plan_changed' });
    }
    const record = (await db.query(RECOUNT_SQL.insertRecount, [plan.cohortId, input.fromDay, input.toDay, plan.rulesId, plan.catalogId, plan.sha256, input.by, input.why])).rows?.[0];
    if (!record) return refuse({ ...FAULT });
    let days = 0;
    for (const learner of plan.learners) {
        const d = learner.days;
        const written = (await db.query(RECOUNT_SQL.insertRecountDays, [
            learner.userId, plan.cohortId, input.by, String(record.id),
            d.map((x) => x.day), d.map((x) => x.after.algorithm), d.map((x) => x.after.ruleSetId), d.map((x) => x.after.catalogVersionId),
            d.map((x) => x.after.countedMs), d.map((x) => x.after.overCapMs), d.map((x) => x.after.signals), d.map((x) => x.after.evidenceSha256),
        ])).rows ?? [];
        // Under the learner's locks the stub stays: anything but every day written is a fault.
        if (written.length !== d.length) return refuse({ ...FAULT });
        const idOf = new Map(written.map((r) => [String(r.day), String(r.id)]));
        const units = d.flatMap((x) => x.after.units.map(([unit, countedMs, overCapMs]) => ({ id: idOf.get(x.day), unit, countedMs, overCapMs })));
        if (units.length) {
            await db.query(TRAINING_TIME_SQL.insertUnitDays, [units.map((u) => u.id), units.map((u) => u.unit), units.map((u) => u.countedMs), units.map((u) => u.overCapMs)]);
        }
        days += d.length;
    }
    return { commit: true, value: { status: 'recounted', id: String(record.id), learners: plan.learners.length, days, sha256: plan.sha256 } };
}

/**
 * Staff: a cohort's recounts, oldest first (versions by sha256; never a rule or learner value).
 * @param {{ cohortId: string, pool?: TrainingPool | null }} params
 * @returns {Promise<Array<{ id: string, recomputedAt: string | null, recomputedBy: string, reason: string, fromDay: string, toDay: string,
 *   rulesSha256: string | null, catalogSha256: string | null, planSha256: string }> | CoreError>}
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
 * Staff: a learner's live day rows of a cohort, every row of every day in day and id order (a day's
 * current value is its last row; the earlier ones and the recount that wrote a row show), and each
 * unit's time over the current rows: one snapshot, its tables locked for reading first
 * (lockedSnapshot). No row's time: a close's computed_at minus its day's end would show a rule value
 * (D9).
 * @param {{ userId: unknown, cohortId: string, pool?: TrainingPool | null, sleep?: (ms: number) => Promise<void>, now?: () => number }} params
 * @returns {Promise<{ userId: string, rows: Array<{ id: string, day: string, kind: string, countedMs: number, overCapMs: number, signals: number,
 *   recomputeId: string | null, computedBy: string }>, units: Array<{ unitKey: string, countedMs: number, overCapMs: number }> } | CoreError>}
 */
export async function learnerHistory({ userId: rawUserId, cohortId, pool = getPool(), sleep, now }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return { error: 'An account id (a UUID) is required.', error_type: 'validation' };
    return lockedSnapshot(pool, RECOUNT_LOCKS.history, async (db) => {
        const rows = ((await db.query(CHECK_SQL.learnerRows, [userId, cohortId])).rows ?? []).map((r) => ({
            id: String(r.id),
            day: String(r.day),
            kind: String(r.kind),
            countedMs: Number(r.counted_ms),
            overCapMs: Number(r.over_cap_ms),
            signals: Number(r.signals),
            recomputeId: r.recompute_id === null || r.recompute_id === undefined ? null : String(r.recompute_id),
            computedBy: String(r.computed_by),
        }));
        const units = ((await db.query(TRAINING_TIME_SQL.unitTotals, [userId, cohortId])).rows ?? []).map((r) => ({
            unitKey: String(r.unit_key), countedMs: Number(r.counted_ms), overCapMs: Number(r.over_cap_ms),
        }));
        return { userId, rows, units };
    }, sleep, now, 'learnerHistory');
}
